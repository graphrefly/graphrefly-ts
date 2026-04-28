/**
 * Reactive agent loop — autonomous multi-turn LLM agent with tool execution.
 */

export type AgentLoopStatus = "idle" | "thinking" | "acting" | "done" | "error";

import { batch } from "../../../core/batch.js";
import { DATA, ERROR, RESOLVED } from "../../../core/messages.js";
import { placeholderArgs } from "../../../core/meta.js";
import { type Node, node as nodeFactory } from "../../../core/node.js";
import { effect, state } from "../../../core/sugar.js";
import { switchMap } from "../../../extra/operators.js";
import { awaitSettled, fromAny, keepalive } from "../../../extra/sources.js";
import { Graph, type GraphOptions } from "../../../graph/graph.js";
import { aiMeta } from "../_internal.js";
import type {
	ChatMessage,
	LLMAdapter,
	LLMResponse,
	ToolCall,
	ToolDefinition,
} from "../adapters/core/types.js";
import { type ChatStreamGraph, chatStream } from "../agents/chat-stream.js";
import { type ToolResult, toolExecution } from "../agents/tool-execution.js";
import { type ToolRegistryGraph, toolRegistry } from "../agents/tool-registry.js";

export type { ToolResult } from "../agents/tool-execution.js";

// ---------------------------------------------------------------------------
// agentLoop
// ---------------------------------------------------------------------------

export type AgentLoopOptions = {
	graph?: GraphOptions;
	adapter: LLMAdapter;
	tools?: readonly ToolDefinition[];
	systemPrompt?: string;
	maxTurns?: number;
	stopWhen?: (response: LLMResponse) => boolean;
	onToolCall?: (call: ToolCall) => void;
	maxMessages?: number;
	model?: string;
	temperature?: number;
	maxTokens?: number;
	/**
	 * Reactive tool-call splice (COMPOSITION-GUIDE §31 "interception is security").
	 * When set, the raw `toolCalls` node is piped through this transform before
	 * reaching the executor. The transform is a pure reactive composition —
	 * `(calls: Node<readonly ToolCall[]>) => Node<readonly ToolCall[]>` — so the
	 * gate is visible in `describe()` / `explain()` as a real edge (no hidden
	 * imperative wraps; §24).
	 *
	 * Typical uses:
	 * - **Filter / block** — `derived([calls, policy], ([raw, p]) => raw.filter(p))`
	 * - **Throttle / debounce** — `throttle(calls, windowMs)`
	 * - **Human-in-the-loop approval** — pipe through a `gate` controller so
	 *   calls wait for human approval before reaching the executor.
	 *
	 * The public `agent.toolCalls` node surfaces the POST-intercept stream, so
	 * audit / telemetry consumers see what the executor actually runs. The raw
	 * pre-intercept stream is not exposed — tests that need it should run
	 * without `interceptToolCalls` set (the identity case).
	 */
	interceptToolCalls?: (calls: Node<readonly ToolCall[]>) => Node<readonly ToolCall[]>;
};

/**
 * Reactive agent loop.
 *
 * The loop is a reactive state machine wired entirely from graph primitives:
 * `chat.messages` + `tools.schemas` + gating state feed a `promptInput`
 * derived; `switchMap` turns non-null inputs into an LLM invocation via
 * `fromAny(adapter.invoke(...))`. The LLM response drives chat writes and
 * status transitions via effects. Tool calls flow through a reactive
 * executor (`retrySource` + `rescue`) that retries once on error and
 * surfaces terminal errors as JSON-shaped `ToolResult` payloads for the
 * LLM to react to.
 *
 * **No imperative control flow inside the reactive layer** (spec §5.8-5.12):
 * no `while` loops, no manual `await adapter.invoke`, no polling.
 * `agent.run()` is a thin `awaitSettled` bridge so callers can still `await`
 * the loop if they want a Promise.
 *
 * Public surface:
 * - `chat` / `tools` — subgraphs (imperative `append` at boundary, reactive `executeReactive` for tool invocation)
 * - `status` / `turn` / `aborted` — state nodes with explicit initials
 * - `lastResponse` / `toolCalls` / `toolResults` — reactive outputs (SENTINEL until first emission; callers use `awaitSettled` / `subscribe`)
 * - `run(userMessage?, signal?)` — optional user append + Promise bridge
 * - `abort()` — imperative abort shim; flips `aborted` state
 *
 * **Lifecycle: single-mount.** `AgentLoopGraph` instances expect to be
 * constructed once and used until `destroy()`. The internal closure mirrors
 * (`latestTurn` / `latestAborted` / `latestStatus` / `latestMessages` /
 * `latestSchemas`) are wired by subscribe-and-capture at construction time;
 * their corresponding `addDisposer`-registered subscriptions are torn down
 * on subgraph unmount or `destroy()`. After teardown the mirrors freeze at
 * their last value, so re-using a destroyed instance — calling `run()`
 * again, or remounting under a new parent — would silently feed stale
 * mirror data into `promptInput`. If you need to "reset" an agent, build a
 * fresh `AgentLoopGraph` instance instead of recycling.
 */
export class AgentLoopGraph extends Graph {
	readonly chat: ChatStreamGraph;
	readonly tools: ToolRegistryGraph;

	/** Current agent status. `initial: "idle"` — always has a real value. */
	readonly status: Node<AgentLoopStatus>;
	/** Turn count (completed LLM invocations this run). `initial: 0`. */
	readonly turn: Node<number>;
	/** Aborted flag; flipped by `abort()` or external `AbortSignal`. `initial: false`. */
	readonly aborted: Node<boolean>;

	/**
	 * Most recent LLM response. State-backed mirror driven by the response
	 * effect. `initial: null` — subscribers can read the cache synchronously;
	 * `awaitSettled(lastResponse)` or `firstWhere(lastResponse, v => v != null)`
	 * bridges to the first non-null value as a Promise.
	 */
	readonly lastResponse: Node<LLMResponse | null>;
	/** Tool-call batch emitted by the most recent LLM response. SENTINEL. */
	readonly toolCalls: Node<readonly ToolCall[]>;
	/** Tool-result batch (one entry per call) after reactive execution. SENTINEL. */
	readonly toolResults: Node<readonly ToolResult[]>;

	private readonly _terminalResult: Node<LLMResponse>;
	private readonly _disposeRunWiring: () => void;
	/** Guards against overlapping `run()` calls. */
	private _running = false;
	/**
	 * Abort controller for the currently-running `adapter.invoke`. Minted per
	 * switchMap project; aborted when the reactive `aborted` node flips true
	 * OR when the caller's external `AbortSignal` fires. Threaded into
	 * `adapter.invoke({ signal })` AND `fromAny(promise, { signal })`, so the
	 * reactive layer sees ERROR when the wire call is cancelled.
	 */
	private _currentAbortController: AbortController | null = null;

	constructor(name: string, opts: AgentLoopOptions) {
		super(name, opts.graph);

		// Mount chat subgraph
		this.chat = chatStream(`${name}-chat`, { maxMessages: opts.maxMessages });
		this.mount("chat", this.chat);

		// Mount tool registry subgraph
		this.tools = toolRegistry(`${name}-tools`);
		this.mount("tools", this.tools);

		if (opts.tools) {
			for (const tool of opts.tools) {
				this.tools.register(tool);
			}
		}

		// --- State nodes (always have a real value; explicit initials) ---
		this.status = state<AgentLoopStatus>("idle", {
			name: "status",
			describeKind: "state",
			meta: aiMeta("agent_status"),
		});
		this.add(this.status, { name: "status" });

		this.turn = state<number>(0, {
			name: "turn",
			describeKind: "state",
			meta: aiMeta("agent_turn_count"),
		});
		this.add(this.turn, { name: "turn" });

		this.aborted = state<boolean>(false, {
			name: "aborted",
			describeKind: "state",
			meta: aiMeta("agent_aborted"),
		});
		this.add(this.aborted, { name: "aborted" });

		// --- Reactive pipeline ---
		//
		// Closure-held mirrors (COMPOSITION-GUIDE §28). Subscribe once at
		// construction and keep a plain closure variable updated by the
		// handler. Effects / raw-node fns then consult the mirror
		// synchronously — the P3 "no `.cache` reads inside a reactive
		// callback" rule routes around that gray zone.
		//
		// Symmetry matters: `latestTurn` / `latestAborted` / `latestStatus`
		// plus `latestMessages` / `latestSchemas` all feed the same
		// `promptInput` raw node. Mixing "some mirrors, some inline
		// `.cache` reads" was the pre-Wave-B shape and made the reactive
		// fn body harder to audit — every cross-graph read now goes
		// through the same subscribe-and-mirror template.
		//
		// **Pattern note on `latestTurn` staleness under in-batch reads.**
		// Effect 1 emits `turnNode.emit(next)` inside its batch; Effect 2
		// reads `latestTurn` on the following wave (after toolResults
		// settle). Because batch drain is FIFO, `turnSub`'s handler runs
		// before Effect 2's next wave fires, so `latestTurn` is up-to-date
		// by the time Effect 2 reads it. This invariant is stable as long
		// as `turnNode.emit` remains inside Effect 1's batch — a future
		// refactor that un-batches the emit would regress silently.
		let latestTurn = 0;
		const turnSub = this.turn.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) latestTurn = m[1] as number;
		});
		let latestAborted = false;
		const abortedSub = this.aborted.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) latestAborted = m[1] as boolean;
		});
		// Seed from the subgraph's current cache (chat.messages is a
		// ReactiveLogBundle, always starts with a cached snapshot) so the
		// first `promptInput` wave sees the full conversation, even if the
		// subscribe happens before any append. Same seeding discipline as
		// `latestStatus` below.
		//
		// **Ordering invariant (load-bearing).** `promptInput`'s ONLY
		// reactive dep is `statusNode`; `latestMessages` and `latestSchemas`
		// are sampled from closures. Inside Effect 1's batch, `chat.append`
		// fires before the status transition, so `messagesSub`'s handler
		// drains (→ updates `latestMessages`) before any downstream wave
		// reads the mirror. If a future refactor adds `chat.messageCount`
		// (or any message-driven dep) as a reactive trigger on
		// `promptInput`, the closure mirror could lag the actual array by
		// one wave inside Effect 1's own batch — that is exactly the
		// feedback-cycle hazard COMPOSITION-GUIDE §7 warns against, and
		// the current "only status triggers" gating is what keeps this
		// mirror shape safe.
		let latestMessages: readonly ChatMessage[] =
			(this.chat.messages.cache as readonly ChatMessage[] | undefined) ?? [];
		const messagesSub = this.chat.messages.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) latestMessages = m[1] as readonly ChatMessage[];
			}
		});
		// `tools.schemas` has `initial: []`, so the cache is always seeded.
		let latestSchemas: readonly ToolDefinition[] =
			(this.tools.schemas.cache as readonly ToolDefinition[] | undefined) ?? [];
		const schemasSub = this.tools.schemas.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) latestSchemas = m[1] as readonly ToolDefinition[];
			}
		});

		const adapter = opts.adapter;
		const systemPrompt = opts.systemPrompt;
		const model = opts.model;
		const temperature = opts.temperature;
		const maxTokens = opts.maxTokens;
		const maxTurns = opts.maxTurns ?? 10;
		const stopWhen = opts.stopWhen;

		// Capture `this` for closures that don't bind `this`.
		const chat = this.chat;
		const tools = this.tools;
		const statusNode = this.status;
		const turnNode = this.turn;
		const abortedNode = this.aborted;

		// promptInput: STATUS is the only reactive trigger — chat.messages,
		// tools.schemas, turn, aborted are sampled via closure-held mirrors
		// (all populated by subscribe-and-capture above). This prevents the
		// classic feedback cycle (COMPOSITION-GUIDE §7): if chat.messageCount
		// were a reactive dep here, effect 1's `chat.append` would trigger a
		// promptInput wave, which under effect-1's batch would see status
		// STILL "thinking" (pre-drain) and fire a spurious LLM invocation.
		// By gating only on status, chat writes don't re-trigger — only
		// explicit status transitions do.
		const promptInput: Node<InvokeInput> = nodeFactory<InvokeInput>(
			[statusNode],
			(data, actions, ctx) => {
				const stat = readLatest<AgentLoopStatus>(data, ctx.prevData, 0, "idle");
				if (stat !== "thinking" || latestAborted || latestTurn >= maxTurns) {
					actions.down([[RESOLVED]]);
					return;
				}
				// Don't invoke with an empty conversation — most adapters reject
				// this or return degenerate responses. RESOLVED holds the loop
				// idle until the caller appends something to chat.
				if (latestMessages.length === 0) {
					actions.down([[RESOLVED]]);
					return;
				}
				actions.emit({ messages: latestMessages, tools: latestSchemas });
			},
			{
				name: "promptInput",
				describeKind: "derived",
				meta: aiMeta("agent_prompt_input", {
					// COMPOSITION-GUIDE §28 closure-mirror reads. These are NOT
					// reactive deps (statusNode is the only one); listed here so
					// inspection tooling can surface "what other state samples
					// fold into this node's fn body" without grepping source.
					closureReads: ["aborted", "turn", "chat.messages", "tools.schemas"],
				}),
			},
		);

		const llmResponse: Node<LLMResponse> = switchMap(
			promptInput,
			(input) => {
				const controller = new AbortController();
				this._currentAbortController = controller;
				if (latestAborted) {
					controller.abort(new Error("agentLoop: aborted"));
				}
				// Wave A Unit B-CC fix: drop the `Promise.resolve(adapter.invoke(...))`
				// wrapper. `adapter.invoke` returns a `NodeInput<LLMResponse>`
				// (Promise | Node | raw). `fromAny` already handles all three
				// shapes; the manual `Promise.resolve` wrapper would force a
				// Node-returning adapter into an extra microtask hop and lose
				// reactivity (see Unit 11 + Unit 1 for the parallel cleanup).
				return fromAny(
					adapter.invoke(input.messages, {
						tools: input.tools.length > 0 ? input.tools : undefined,
						systemPrompt,
						model,
						temperature,
						maxTokens,
						signal: controller.signal,
					}),
					{ signal: controller.signal },
				);
			},
			{ equals: () => false },
		);

		// State mirror for `lastResponse` — exists for **cross-run reset
		// semantics**, NOT the §32 mid-wave hazard.
		//
		// Why: `llmResponse` is a switchMap output; its cache persists across
		// `run()` calls (switchMap's output node has no built-in reset path —
		// the cache stays at the last DATA the inner emitted). A second
		// `run()` with a pre-aborted signal would otherwise have
		// `_terminalResult` evaluate `stat=done` (driven by `effAbort`) +
		// `resp=<prior run's response>` (cached on `llmResponse`) and resolve
		// the Promise with stale data instead of rejecting with AbortError.
		// The mirror is reset to `null` in `run()`'s reset batch, so the abort
		// path correctly emits `[[ERROR, AbortError]]` from terminalResult's
		// `stat="done" && resp==null → ERROR` guard.
		//
		// What this does NOT solve: the §32 mid-wave "stale peer-read"
		// hazard. Investigation (2026-04-25) confirmed `_dirtyDepCount`
		// gating in `_maybeRunFnOnSettlement` already prevents that — when
		// `effResponse`'s nested batch fires `status="done"` mid-iteration,
		// terminal's status dep settles but its `llmResponse` (or mirror)
		// dep is still DIRTY from Phase 1, so the fn does not run until
		// Phase 2 visits both deps. Verified by fast-check invariant `#12b
		// nested-drain-peer-consistency-compound` and by the multi-turn
		// `executes tool calls and loops` test passing under either dep
		// shape (`[statusNode, llmResponse]` or `[statusNode, lastResponseState]`).
		//
		// Verified by: QA C3 regression tests (`run() with pre-aborted
		// signal rejects AbortError` and `second run() with pre-aborted
		// signal rejects AbortError (no stale response leak)`) — both
		// fail when `_terminalResult` is rewired to depend on `llmResponse`
		// directly. See COMPOSITION-GUIDE §32 (cross-wave reset reframe).
		const lastResponseState = state<LLMResponse | null>(null, {
			name: "lastResponse",
			describeKind: "state",
			meta: aiMeta("agent_last_response"),
		});
		this.lastResponse = lastResponseState;

		// toolCalls: raw node that emits DATA only when status === "acting" and
		// the current response has tool calls. Otherwise emits RESOLVED. Using
		// DATA([]) for the idle case would cause switchMap(toolCalls) to
		// re-dispatch its inner (creating a fresh state([]) source whose
		// emissions re-trigger effects downstream). RESOLVED keeps the inner
		// alive and lets upstream waves pass through without re-dispatch.
		// Inner raw tool-call stream — name `toolCallsRaw` so the post-intercept
		// public surface (`this.toolCalls`) is unambiguous in `describe()`.
		// QA-fix: previously the inner was named `"toolCalls"`, which collided
		// with `this.toolCalls` if the user-supplied interceptor returned a
		// wrapper that internally retained a reference to this raw node —
		// `describe()` would render two distinct nodes both labeled `"toolCalls"`.
		const toolCallsRaw = nodeFactory<readonly ToolCall[]>(
			[lastResponseState, statusNode],
			(data, actions, ctx) => {
				const resp = readLatest<LLMResponse | null | undefined>(data, ctx.prevData, 0, null);
				const stat = readLatest<AgentLoopStatus>(data, ctx.prevData, 1, "idle");
				if (stat !== "acting") {
					actions.down([[RESOLVED]]);
					return;
				}
				const calls = resp?.toolCalls;
				if (calls == null || calls.length === 0) {
					actions.down([[RESOLVED]]);
					return;
				}
				actions.emit(calls);
			},
			{
				name: "toolCallsRaw",
				describeKind: "derived",
				meta: aiMeta("agent_tool_calls_raw"),
			},
		);
		// Reactive splice (D9 / COMPOSITION-GUIDE §31). When `interceptToolCalls`
		// is set, the raw tool-call stream is transformed in the graph — the
		// executor sees the gated stream, and `agent.toolCalls` surfaces the
		// post-intercept view so audit / telemetry match reality.
		const gatedToolCallsNode = opts.interceptToolCalls
			? opts.interceptToolCalls(toolCallsRaw)
			: toolCallsRaw;
		this.toolCalls = gatedToolCallsNode;

		// Delegate per-call fan-out + retry + rescue to the `toolExecution`
		// primitive. `toolCallsRaw` already gates empty batches to RESOLVED,
		// so `toolExecution`'s "non-empty batch only" contract is satisfied
		// upstream. `retryCount: 1` matches the pre-extraction behaviour
		// (one retry after first failure = 2 attempts total).
		const toolResultsNode: Node<readonly ToolResult[]> = toolExecution({
			toolCalls: gatedToolCallsNode,
			tools,
			retryCount: 1,
		});
		this.toolResults = toolResultsNode;

		// --- State-machine effects ---
		// Effect 1: LLM response landed → write lastResponse mirror + chat,
		// transition status, increment turn. Emission ORDER inside the batch
		// matters (drain is FIFO under any outer-batch depth):
		//   1. `lastResponseState.emit(response)` FIRST — so when the drain
		//      fires the status=done wave later in the queue, `_terminalResult`'s
		//      dep on `lastResponseState` has already been updated.
		//   2. `statusNode.emit(nextStatus)` — drives state machine.
		//   3. `turnNode.emit(next)` — counter.
		//   4. `chat.append(...)` LAST — chat.messageCount wave now sees the
		//      new status (so `promptInput` gates correctly).
		// Without (1) first, `_terminalResult` reads stale `prevData` for
		// lastResponse when status transitions synchronously during drain.
		//
		// **Invariant independence from outer batch depth.** `downWithBatch`
		// preserves FIFO drain order regardless of nesting — whether the
		// outer batch is at depth 0 (common: Promise microtask) or depth >0
		// (user-composed `batch()` scope around `agent.run()`), the emissions
		// above drain in the order they were enqueued. The state-mirror
		// pattern holds in both cases.
		//
		// **Abort guard (C2 defense-in-depth).** If the `aborted` state has
		// flipped true between `adapter.invoke`'s Promise resolution and this
		// effect firing (micro-race), bail out so we don't append to chat or
		// execute tool calls for an abandoned run. The controller.abort() in
		// effAbort also fires the signal, which causes `fromAny` to emit
		// ERROR — but that ERROR propagation arrives in a separate wave, so
		// this guard covers the "Promise already resolved before abort hit
		// the controller" case.
		const effResponse = effect([llmResponse], ([resp]) => {
			if (latestAborted) return;
			const response = resp as LLMResponse;
			const next = latestTurn + 1;
			const hasToolCalls = response.toolCalls != null && response.toolCalls.length > 0;
			const naturalStop =
				response.finishReason === "end_turn" &&
				(!response.toolCalls || response.toolCalls.length === 0);
			const customStop = stopWhen?.(response) === true;
			const capReached = next >= maxTurns;
			const nextStatus: AgentLoopStatus =
				customStop || naturalStop || !hasToolCalls || capReached ? "done" : "acting";
			batch(() => {
				lastResponseState.emit(response);
				statusNode.emit(nextStatus);
				turnNode.emit(next);
				chat.append("assistant", response.content, {
					toolCalls: response.toolCalls,
				});
			});
		});

		// Effect 2: Tool results landed → append to chat, transition to
		// thinking (or done if turn cap reached). Same ordering discipline —
		// status emits before chat mutations. Abort guard mirrors effResponse.
		const effResults = effect([toolResultsNode], ([results]) => {
			if (latestAborted) return;
			const arr = results as readonly ToolResult[];
			if (arr.length === 0) return;
			const nextStatus: AgentLoopStatus = latestTurn >= maxTurns ? "done" : "thinking";
			batch(() => {
				statusNode.emit(nextStatus);
				for (const r of arr) chat.appendToolResult(r.id, r.content);
			});
		});

		// Effect 3: external abort → cancel in-flight wire call + terminal status.
		// Aborting the controller causes the switchMap inner's `fromAny` to
		// emit ERROR (signal-bound), which tears down the subscription. The
		// `status="done"` emit drives `_terminalResult` to resolve `run()`'s
		// Promise (via AbortError when `resp == null`, see C3).
		//
		// Unit 4 Q5: status guard — if status is already "done" (the natural-
		// completion path raced the abort), skip the redundant emit so the
		// status-node event log isn't polluted with a trailing duplicate.
		// Closure-mirror `latestStatus` keeps the comparison synchronous and
		// P3-compliant. Seeded from `statusNode.cache` to match the §28
		// factory-time-seed pattern that `latestTurn` / `latestAborted` use
		// — the literal `"idle"` would silently drift if the constructor
		// initial value ever changed.
		let latestStatus: AgentLoopStatus = (statusNode.cache as AgentLoopStatus | undefined) ?? "idle";
		const statusSub = statusNode.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) latestStatus = m[1] as AgentLoopStatus;
		});
		const effAbort = effect([abortedNode], ([isAborted]) => {
			if (isAborted === true) {
				this._currentAbortController?.abort(new Error("agentLoop: aborted"));
				if (latestStatus !== "done") statusNode.emit("done");
			}
		});

		// Keepalive so the pipeline stays activated even without external
		// subscribers. Callers don't need to subscribe to `llmResponse` /
		// `toolResults` for the loop to run.
		const kaResponse = keepalive(effResponse);
		const kaResults = keepalive(effResults);
		const kaAbort = keepalive(effAbort);

		// terminalResult emits the final `LLMResponse` on each "done"
		// transition. The old compound `{response, runVersion}` shape existed
		// to let a re-entrant caller's `awaitSettled` predicate filter out
		// the PREVIOUS run's cached DATA; that job now belongs to
		// `awaitSettled({skipCurrent: true})` (extra/sources.ts) which
		// ignores the initial push-on-subscribe DATA and resolves only on
		// fresh post-subscribe emissions. Retiring the stamp removes a
		// closure-held counter and a per-emission object allocation from
		// the hot path.
		//
		// C3 (abort-before-response) unchanged: when `stat === "done"` but
		// `resp == null`, emit `ERROR(AbortError)` so the awaiting Promise
		// rejects instead of hanging on a RESOLVED.
		this._terminalResult = nodeFactory<LLMResponse>(
			[statusNode, lastResponseState],
			(data, actions, ctx) => {
				const stat = readLatest<AgentLoopStatus>(data, ctx.prevData, 0, "idle");
				const resp = readLatest<LLMResponse | null | undefined>(data, ctx.prevData, 1, null);
				if (stat === "done") {
					if (resp != null) {
						actions.emit(resp);
						return;
					}
					const err = new Error("agentLoop: aborted") as Error & { name: string };
					err.name = "AbortError";
					actions.down([[ERROR, err]]);
					return;
				}
				if (stat === "error") {
					actions.down([[ERROR, new Error("agentLoop: errored")]]);
					return;
				}
				actions.down([[RESOLVED]]);
			},
			{
				name: "terminalResult",
				describeKind: "derived",
				meta: aiMeta("agent_terminal_result"),
			},
		);
		// Wave B-CC Q2/C: register intermediate pipeline nodes so consumers
		// can `observe(path)` them by name (e.g. `agent.observe("promptInput")`).
		// They were already visible in `describe()` via dep traversal, but not
		// path-addressable. Tools using the `observe`-by-path API now work.
		//
		// QA-fix (#5 stability): registrations live AFTER ALL dependent nodes
		// are constructed (`promptInput → llmResponse → effResponse →
		// lastResponseState → toolCallsRaw → toolResultsNode → effResults →
		// effAbort → _terminalResult`). Topology event-stream consumers
		// subscribed at construction time now see registrations in an order
		// where every edge between two registered nodes is already valid —
		// no transient partial graph slipping through to live mermaid / d2
		// renderers.
		this.add(promptInput as Node<unknown>, { name: "promptInput" });
		this.add(llmResponse as Node<unknown>, { name: "llmResponse" });
		this.add(this.lastResponse as Node<unknown>, { name: "lastResponse" });
		// When no interceptor is configured, `this.toolCalls === toolCallsRaw` —
		// registering the same instance under two names trips the per-graph
		// `_nodeToName` collision check. Register the raw under `toolCalls`
		// directly in that case; otherwise register both (raw + post-intercept).
		if (this.toolCalls === toolCallsRaw) {
			this.add(this.toolCalls as Node<unknown>, { name: "toolCalls" });
		} else {
			this.add(toolCallsRaw as Node<unknown>, { name: "toolCallsRaw" });
			this.add(this.toolCalls as Node<unknown>, { name: "toolCalls" });
		}
		this.add(toolResultsNode as Node<unknown>, { name: "toolResults" });
		this.add(this._terminalResult as Node<unknown>, { name: "terminalResult" });

		// Register subscriptions via `addDisposer` so they tear down on
		// subgraph unmount (not just explicit `destroy()`). A caller that
		// unmounts the AgentLoopGraph from its parent via `graph.remove(...)`
		// would otherwise keep `turnSub` / `abortedSub` live against dead state.
		this.addDisposer(turnSub);
		this.addDisposer(abortedSub);
		this.addDisposer(statusSub);
		this.addDisposer(messagesSub);
		this.addDisposer(schemasSub);
		this.addDisposer(kaResponse);
		this.addDisposer(kaResults);
		this.addDisposer(kaAbort);
		this._disposeRunWiring = (): void => {
			// addDisposer takes care of teardown; this shim stays for the
			// `destroy()` override's idempotency contract (safe no-op if the
			// disposers already fired).
		};
	}

	/**
	 * Bridge to `Promise<LLMResponse>` over the reactive pipeline.
	 *
	 * - If `userMessage` is provided, appends it as a user message and
	 *   transitions status to `"thinking"` to kick the loop.
	 * - If `signal` is provided, binds it to the reactive `aborted` node
	 *   AND threads into `adapter.invoke({ signal })` so the wire call can
	 *   cancel mid-flight. The reactive `aborted` state + effect 3 guarantee
	 *   that even an adapter that ignores `signal` will stop emitting into
	 *   the agent graph.
	 * - Resolves when `status === "done"` with the final LLM response.
	 *   Rejects with `AbortError` when the abort signal fires pre-response.
	 *   Rejects with the stage error when `status === "error"`.
	 *
	 * **Concurrency:** `run()` refuses to overlap with a pending call on the
	 * same agent. Attempting to call `run()` while a previous `run()` is
	 * still in-flight throws a `RangeError` immediately. Stale-resolution
	 * safety is provided by `awaitSettled({skipCurrent: true})`, which
	 * ignores the cached initial DATA from any previous run and resolves
	 * only on a fresh post-subscribe emission of `_terminalResult`.
	 */
	async run(userMessage?: string, signal?: AbortSignal): Promise<LLMResponse | null> {
		if (this._running) {
			throw new RangeError(
				`agentLoop "${this.name}": run() called while a previous run() is still pending — await the previous run before starting another, or call abort() first`,
			);
		}
		this._running = true;

		let offAbort: (() => void) | undefined;
		try {
			// Reset per-run state. `lastResponse` MUST be cleared here —
			// without it, `_terminalResult` would read the prior run's
			// cached response during a second `run()` with a pre-aborted
			// signal: `effAbort` drives `status → "done"`, `_terminalResult`
			// evaluates `stat="done"` + `resp=<prior respA>` and emits DATA
			// as a fresh post-subscribe signal → `awaitSettled` resolves
			// with the stale response instead of rejecting with AbortError.
			// The C3 `stat=done && resp==null → ERROR` guard in
			// `_terminalResult` is only correct once the reset clears the
			// cache.
			batch(() => {
				this.turn.emit(0);
				this.aborted.emit(false);
				this.status.emit("idle");
				this.lastResponse.emit(null);
			});
			if (userMessage != null) this.chat.append("user", userMessage);

			// Subscribe to `_terminalResult` BEFORE transitioning to
			// "thinking" — otherwise a synchronous adapter (mock tests,
			// offline stubs) would drain status → done → DATA on
			// `_terminalResult` before `awaitSettled` had a chance to
			// subscribe, and `skipCurrent: true` would swallow the only
			// DATA this run will produce. `awaitSettled` / `firstWhere`
			// subscribes synchronously during the `async` function's
			// initial execution slice, so calling it before the kick
			// guarantees the subscription is in place when the pipeline
			// starts draining.
			//
			// `skipCurrent: true` still matters: on the second `run()`
			// call `_terminalResult` holds cached DATA from the prior run,
			// and push-on-subscribe would resolve immediately with that
			// stale value without the skip.
			const resultPromise = awaitSettled(this._terminalResult, { skipCurrent: true });

			if (signal != null) {
				if (signal.aborted) {
					this.aborted.emit(true);
				} else {
					const listener = (): void => this.aborted.emit(true);
					signal.addEventListener("abort", listener, { once: true });
					offAbort = (): void => signal.removeEventListener("abort", listener);
				}
			}

			// Kick — transition to "thinking" fires promptInput → llmResponse.
			// Skip the kick when the signal was already aborted: `effAbort`
			// has driven `status → "done"` above, and a trailing
			// `thinking` emit would produce a non-monotonic `idle → done →
			// thinking` sequence in the status-event log for no reactive
			// benefit (promptInput gates on `!latestAborted` anyway).
			if (signal?.aborted !== true) {
				this.status.emit("thinking");
			}

			return await resultPromise;
		} finally {
			offAbort?.();
			this._running = false;
			this._currentAbortController = null;
		}
	}

	/**
	 * Flip the reactive `aborted` state. Equivalent to setting an external
	 * `AbortSignal` — the pipeline observes and transitions to `"done"`.
	 */
	abort(): void {
		this.aborted.emit(true);
	}

	override destroy(): void {
		try {
			this._disposeRunWiring();
		} catch {
			/* best-effort: disposing keepalives shouldn't block destroy */
		}
		super.destroy();
	}
}

/**
 * Read the latest value for dep `i` inside a raw-`node()` fn body.
 *
 * Checks `batchData[i]` first (this-wave DATA from the dep), falls back to
 * `ctx.prevData[i]` (last DATA from prior waves), and finally to `fallback`
 * when the dep has never emitted (SENTINEL). Matches the unwrap semantics
 * `derived`'s sugar applies, so raw nodes can read deps uniformly.
 *
 * @internal
 */
function readLatest<T>(
	batchData: readonly (readonly unknown[] | undefined)[],
	prevData: readonly unknown[],
	index: number,
	fallback: T,
): T {
	const batch = batchData[index];
	if (batch != null && batch.length > 0) return batch[batch.length - 1] as T;
	const prev = prevData[index];
	return (prev !== undefined ? prev : fallback) as T;
}

/** @internal Shape of the LLM invocation input — constructed inside `promptInput`. */
interface InvokeInput {
	readonly messages: readonly ChatMessage[];
	readonly tools: readonly ToolDefinition[];
}

export function agentLoop(name: string, opts: AgentLoopOptions): AgentLoopGraph {
	const g = new AgentLoopGraph(name, opts);
	// Tier 1.5.3 Phase 2.5 (DG1=B): tag the Graph with its constructing
	// factory so `describe()` exposes provenance. Opts include non-JSON
	// fields (`adapter`, `tools`, `stopWhen`, `onToolCall`,
	// `interceptToolCalls`, etc.) so route through `placeholderArgs`
	// (DG2=ii).
	g.tagFactory("agentLoop", placeholderArgs(opts as unknown as Record<string, unknown>));
	return g;
}
