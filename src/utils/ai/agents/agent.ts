/**
 * Phase 13.G — `AgentBundle<TIn, TOut>` interface + `class AgentGraph extends Graph`.
 *
 * Source: `archive/docs/SESSION-multi-agent-gap-analysis.md` G1 lock B.
 *
 * Composes the existing substrate (`agentLoop`, `toolRegistry`,
 * `agentMemory`) into a typed inbox/outbox subgraph that other parts of a
 * multi-agent system can wire to. Sibling preset `agent()` (in
 * `./presets.ts`) is the ergonomic factory; this file is the contract.
 *
 * **Cross-cut #1 lock (no `agent.run()`):** caller-side runtime entry is
 * `bundle.in.emit(input)` + `awaitSettled(bundle.out)`. The legacy
 * `agentLoop.run()` is still available on `bundle.graph.loop` for
 * single-shot Promise-bridge use cases, but `agent()` does NOT expose a
 * `run()` method on the bundle.
 *
 * **Memory partition default:** private memory per agent (each `agent(...)`
 * call creates its own `AgentMemoryGraph` if none passed). Pass an explicit
 * shared instance for §29 handoff context-transfer.
 */

import { batch } from "@graphrefly/pure-ts/core/batch.js";
import { DATA, INVALIDATE, RESOLVED } from "@graphrefly/pure-ts/core/messages.js";
import { type Node, node } from "@graphrefly/pure-ts/core/node.js";
import { keepalive } from "@graphrefly/pure-ts/extra";
import { Graph, type GraphOptions } from "@graphrefly/pure-ts/graph/graph.js";
import { type AgentLoopGraph, agentLoop } from "../../../presets/ai/agent-loop.js";
import type { AgentMemoryGraph } from "../../../presets/ai/agent-memory.js";
import {
	type SubscriptionGraph,
	subscription,
	type TopicGraph,
	topic,
} from "../../messaging/index.js";
import { aiMeta } from "../_internal.js";
import type {
	InputTokens,
	LLMAdapter,
	LLMResponse,
	OutputTokens,
	TokenUsage,
	ToolDefinition,
} from "../adapters/core/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of an {@link AgentGraph}.
 *
 * - `idle` — no input has been received since construction or last reset.
 * - `running` — inputs are flowing through the underlying agentLoop
 *   (collapses the loop's `thinking` + `acting` substates so consumers
 *   don't have to model the tool-call inner loop).
 * - `verifying` — verifier subgraph is in flight (reserved; lights up when
 *   the verifier slot is added in a future wave per G7 recipe).
 * - `done` — the most recent input has settled with a verified response.
 * - `error` — the loop or verifier produced a terminal error.
 *
 * **Note (Phase 13.G, 2026-05-01):** v1 of `agent()` has no built-in
 * verifier slot — `verifying` is reserved but never produced. When a
 * verifier consumer surfaces, this enum widens (non-breaking type
 * widening; existing consumers see the same `idle | running | done | error`
 * subset).
 */
export type AgentStatus = "idle" | "running" | "verifying" | "done" | "error";

/**
 * Aggregated cost for an agent's run, surfaced as a `Node<CostState>` on
 * the bundle. **Wraps the canonical {@link TokenUsage}** so consumers get
 * the full provider-disaggregated token classes (cache-read /
 * cache-write-5m / cache-write-1h / audio / image / video / tool-use /
 * reasoning / prediction-accepted / prediction-rejected / extensions /
 * auxiliary non-token costs / raw escape-hatch) without losing fidelity
 * for downstream pricing. USD conversion is a downstream `derived` over
 * `usage`.
 *
 * - `usage` — accumulated {@link TokenUsage} across all turns of the
 *   current input.
 * - `turns` — number of completed agentLoop iterations (LLM invocations).
 *
 * **Counter scope:** resets to {@link ZERO_COST} on each new `bundle.in`
 * emit (per-input cost rather than per-agent-lifetime). Sum across multiple
 * inputs by snapshotting `cost` at `done` and accumulating externally —
 * a per-lifetime cost is a downstream `scan` over this.
 *
 * **Helpers.** Use `sumInputTokens(usage)` / `sumOutputTokens(usage)` from
 * `@graphrefly/graphrefly-ts` to flatten to scalars when the caller wants
 * a single number.
 */
export interface CostState {
	readonly usage: TokenUsage;
	readonly turns: number;
}

const EMPTY_INPUT: InputTokens = Object.freeze({ regular: 0 });
const EMPTY_OUTPUT: OutputTokens = Object.freeze({ regular: 0 });
const EMPTY_USAGE: TokenUsage = Object.freeze({ input: EMPTY_INPUT, output: EMPTY_OUTPUT });

/** Empty cost. Used as the initial value and the per-input reset baseline. */
export const ZERO_COST: CostState = Object.freeze({ usage: EMPTY_USAGE, turns: 0 });

// ---------------------------------------------------------------------------
// TokenUsage accumulator
// ---------------------------------------------------------------------------

function addOptional(a: number | undefined, b: number | undefined): number | undefined {
	if (a == null && b == null) return undefined;
	return (a ?? 0) + (b ?? 0);
}

function addExtensions(
	a: Record<string, number> | undefined,
	b: Record<string, number> | undefined,
): Record<string, number> | undefined {
	if (a == null && b == null) return undefined;
	const out: Record<string, number> = { ...(a ?? {}) };
	for (const [k, v] of Object.entries(b ?? {})) {
		out[k] = (out[k] ?? 0) + v;
	}
	return out;
}

/**
 * Accumulates two {@link TokenUsage} snapshots. All field classes are
 * summed; optional fields propagate as `undefined` when absent from both
 * sides, otherwise treated as 0 for the missing side. `auxiliary` and
 * `extensions` merge by key. `raw` is dropped — it's a per-call escape
 * hatch, not summable.
 *
 * @category extra
 */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
	const out: TokenUsage = {
		input: {
			regular: a.input.regular + b.input.regular,
			...(addOptional(a.input.cacheRead, b.input.cacheRead) !== undefined && {
				cacheRead: addOptional(a.input.cacheRead, b.input.cacheRead) as number,
			}),
			...(addOptional(a.input.cacheWrite5m, b.input.cacheWrite5m) !== undefined && {
				cacheWrite5m: addOptional(a.input.cacheWrite5m, b.input.cacheWrite5m) as number,
			}),
			...(addOptional(a.input.cacheWrite1h, b.input.cacheWrite1h) !== undefined && {
				cacheWrite1h: addOptional(a.input.cacheWrite1h, b.input.cacheWrite1h) as number,
			}),
			...(addOptional(a.input.cacheWriteOther, b.input.cacheWriteOther) !== undefined && {
				cacheWriteOther: addOptional(a.input.cacheWriteOther, b.input.cacheWriteOther) as number,
			}),
			...(addOptional(a.input.audio, b.input.audio) !== undefined && {
				audio: addOptional(a.input.audio, b.input.audio) as number,
			}),
			...(addOptional(a.input.image, b.input.image) !== undefined && {
				image: addOptional(a.input.image, b.input.image) as number,
			}),
			...(addOptional(a.input.video, b.input.video) !== undefined && {
				video: addOptional(a.input.video, b.input.video) as number,
			}),
			...(addOptional(a.input.toolUse, b.input.toolUse) !== undefined && {
				toolUse: addOptional(a.input.toolUse, b.input.toolUse) as number,
			}),
			...(addExtensions(a.input.extensions, b.input.extensions) !== undefined && {
				extensions: addExtensions(a.input.extensions, b.input.extensions) as Record<string, number>,
			}),
		},
		output: {
			regular: a.output.regular + b.output.regular,
			...(addOptional(a.output.reasoning, b.output.reasoning) !== undefined && {
				reasoning: addOptional(a.output.reasoning, b.output.reasoning) as number,
			}),
			...(addOptional(a.output.audio, b.output.audio) !== undefined && {
				audio: addOptional(a.output.audio, b.output.audio) as number,
			}),
			...(addOptional(a.output.predictionAccepted, b.output.predictionAccepted) !== undefined && {
				predictionAccepted: addOptional(
					a.output.predictionAccepted,
					b.output.predictionAccepted,
				) as number,
			}),
			...(addOptional(a.output.predictionRejected, b.output.predictionRejected) !== undefined && {
				predictionRejected: addOptional(
					a.output.predictionRejected,
					b.output.predictionRejected,
				) as number,
			}),
			...(addExtensions(a.output.extensions, b.output.extensions) !== undefined && {
				extensions: addExtensions(a.output.extensions, b.output.extensions) as Record<
					string,
					number
				>,
			}),
		},
		...(addExtensions(a.auxiliary, b.auxiliary) !== undefined && {
			auxiliary: addExtensions(a.auxiliary, b.auxiliary) as Record<string, number>,
		}),
	};
	return out;
}

/**
 * Spec for {@link agent} (in `./presets.ts`). Required fields are minimal —
 * `name` and `adapter` cover the common case where the input is a string
 * and the output is the raw `LLMResponse`. Optional fields shape the
 * agent's behavior:
 *
 * - **Mappers** (`inMapper` / `outMapper`) translate between caller-typed
 *   `TIn` / `TOut` and the loop's internal `string` / `LLMResponse`. Default
 *   identity mappers are wired automatically when `TIn` extends `string`
 *   and `TOut` extends `LLMResponse`.
 * - **`tools`** is a reactive `NodeInput<readonly ToolDefinition[]>` —
 *   `agent()` subscribes and reconciles the underlying `toolRegistry`'s
 *   registrations on each emit. Static-array form is also accepted.
 * - **`memory`** is an explicit `AgentMemoryGraph` instance for shared
 *   memory across agents (§29 handoff context transfer). Default: private
 *   memory per agent (each `agent()` call mints its own).
 * - **`maxIterations`** caps the underlying agentLoop's tool-call inner
 *   loop. Default 10 (matches `agentLoop`).
 * - **Verifier slot** is intentionally not in v1 — G7 reframe locks it as
 *   a caller-composed recipe. When a real consumer surfaces, a
 *   `verifier?: (out: Node<TOut>) => NodeInput<VerifierResult>` field
 *   lands here additively.
 */
export interface AgentSpec<TIn, TOut> {
	/** Local mount name when wired to a parent graph. Required. */
	readonly name: string;
	/** LLM adapter for the underlying agentLoop. Required. */
	readonly adapter: LLMAdapter;
	/** Optional system prompt. Static today; reactive widening pending. */
	readonly systemPrompt?: string;
	/**
	 * Optional reactive tool list. When a Node, the agent subscribes and
	 * reconciles the underlying `toolRegistry` registrations on each emit
	 * (additions registered, removals unregistered). When a static array,
	 * tools are registered once at construction.
	 */
	readonly tools?: Node<readonly ToolDefinition[]> | readonly ToolDefinition[];
	/**
	 * Optional shared memory. Default: private (agent mints its own
	 * `AgentMemoryGraph` if needed; not yet wired into the loop's chat —
	 * that wiring is a separate follow-up). Pass an explicit instance to
	 * share memory across agents for §29 handoff context transfer.
	 */
	readonly memory?: AgentMemoryGraph<unknown>;
	/**
	 * Maps caller-typed input → string for the underlying chat. Defaults to
	 * identity when `TIn extends string`; required otherwise.
	 */
	readonly inMapper?: (input: TIn) => string;
	/**
	 * Maps the agentLoop's `LLMResponse` → caller-typed output. Defaults to
	 * identity when `TOut extends LLMResponse`; required otherwise.
	 */
	readonly outMapper?: (response: LLMResponse) => TOut;
	/** Caps tool-call inner-loop iterations. Default 10. */
	readonly maxIterations?: number;
	/** Escape hatch for non-core fields. Surfaced in `describe()` via meta. */
	readonly meta?: Record<string, unknown>;
}

/**
 * Public contract for an agent — typed inbox/outbox + lifecycle / cost
 * observables + the underlying graph for inspection / mounting.
 *
 * **Reactive entry:** caller writes to `in` (e.g. `bundle.in.emit(input)`).
 * The agent reactively kicks the underlying loop and produces `out`.
 *
 * **Reactive exit:** caller reads `out` via `subscribe` (continuous) or
 * `awaitSettled(out)` (single-shot). Both `in` and `out` stay SENTINEL
 * (`cache === undefined`) until the first real emission — no `null`
 * push-on-subscribe trap (per `feedback_use_prevdata_for_sentinel`).
 *
 * **Cross-graph wiring:** the bundle's `graph` is mountable under any
 * parent via `parent.mount(name, bundle.graph)`. After mount, the bundle's
 * Nodes are reachable through both the bundle reference (direct) and via
 * `parent.node("<name>::out")` etc. (qualified path).
 */
export interface AgentBundle<TIn, TOut> {
	readonly in: Node<TIn>;
	readonly out: Node<TOut>;
	readonly status: Node<AgentStatus>;
	readonly cost: Node<CostState>;
	readonly graph: AgentGraph<TIn, TOut>;
}

// ---------------------------------------------------------------------------
// AgentGraph
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set<AgentStatus>(["done", "error"]);

/**
 * Graph subclass implementing {@link AgentBundle}. Mounts an inner
 * {@link AgentLoopGraph} at `loop/`; `in` / `out` / `status` / `cost`
 * surface the bundle contract as top-level nodes.
 *
 * Construction is internal — use the {@link agent} factory in
 * `./presets.ts` for normal use. Direct `new AgentGraph(name, spec)` is
 * supported for callers that want full control over mount order.
 *
 * **Topology:**
 * ```
 * <name>
 * ├── loop                  (AgentLoopGraph subgraph)
 * │   ├── chat
 * │   ├── tools
 * │   ├── status / turn / aborted / lastResponse / ...
 * ├── in                    (Node<TIn>, SENTINEL until first emit)
 * ├── out                   (Node<TOut>, SENTINEL until first response)
 * ├── status                (Node<AgentStatus>, mirror of loop.status)
 * └── cost                  (Node<CostState>)
 * ```
 *
 * **Lifecycle:**
 * - On `in` emit: `inMapper` projects to `string`; appended to
 *   `loop.chat`; loop status reset (`turn=0`, `aborted=false`,
 *   `status="thinking"`); per-input cost counters reset to zero.
 * - On `loop.lastResponse` emit: cost rolls forward; `out` emits
 *   `outMapper(response)`.
 * - On `loop.status="done"`: agent's status emits `"done"`.
 * - On `loop.status="error"` (or any ERROR propagation): agent's status
 *   emits `"error"`.
 */
export class AgentGraph<TIn, TOut> extends Graph {
	/** The agent's typed inbox. Writable; `in.emit(value)` kicks the loop. */
	readonly in: Node<TIn>;
	/** The agent's typed outbox. SENTINEL until first response. */
	readonly out: Node<TOut>;
	/** Lifecycle status (translated from the underlying loop's substates). */
	readonly status: Node<AgentStatus>;
	/** Cumulative cost for the current / most-recent input. */
	readonly cost: Node<CostState>;
	/** The underlying agentLoop — exposed for inspection / advanced wiring. */
	readonly loop: AgentLoopGraph;
	/** Optional shared memory subgraph (mounted at `memory/` if provided). */
	readonly memory: AgentMemoryGraph<unknown> | null;

	constructor(spec: AgentSpec<TIn, TOut>, opts?: GraphOptions) {
		super(spec.name, opts);

		// --- 1. Mount the agentLoop subgraph. ------------------------------
		const initialTools = Array.isArray(spec.tools)
			? (spec.tools as readonly ToolDefinition[])
			: undefined;
		this.loop = agentLoop(`${spec.name}-loop`, {
			adapter: spec.adapter,
			...(spec.systemPrompt != null ? { systemPrompt: spec.systemPrompt } : {}),
			...(initialTools != null ? { tools: initialTools } : {}),
			...(spec.maxIterations != null ? { maxTurns: spec.maxIterations } : {}),
		});
		this.mount("loop", this.loop);

		// --- 2. Reactive tools subscription (if Node-form). ----------------
		// agentLoop's tools are static-array at construction; we reconcile
		// dynamically by subscribing to the user's reactive Node and
		// register/unregister against the inner toolRegistry.
		if (spec.tools != null && !Array.isArray(spec.tools)) {
			const toolsNode = spec.tools as Node<readonly ToolDefinition[]>;
			const registered = new Set<string>();
			const unsubTools = toolsNode.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] !== DATA) continue;
					const next = m[1] as readonly ToolDefinition[];
					const nextNames = new Set(next.map((t) => t.name));
					// Unregister missing.
					for (const name of registered) {
						if (!nextNames.has(name)) {
							this.loop.tools.unregister(name);
							registered.delete(name);
						}
					}
					// Register new (idempotent guard via local tracking).
					for (const tool of next) {
						if (!registered.has(tool.name)) {
							this.loop.tools.register(tool);
							registered.add(tool.name);
						}
					}
				}
			});
			this.addDisposer(unsubTools);
		}

		// --- 3. Optional shared memory subgraph (passed through). ----------
		// v1: memory is mounted but NOT yet wired into the loop's chat — the
		// chat-context-from-memory glue is a separate follow-up. Mounting it
		// here gives the bundle a stable surface for §29 handoff (callers
		// can pass the SAME instance to multiple agents for shared memory).
		this.memory = spec.memory ?? null;
		if (this.memory != null) {
			this.mount("memory", this.memory);
		}

		// --- 4. `in` — the typed inbox. ------------------------------------
		// SENTINEL until first emit; `equals: () => false` so re-emitting the
		// same value still kicks (no spurious dedup of repeat inputs).
		this.in = node<TIn>([], {
			name: "in",
			describeKind: "state",
			meta: aiMeta("agent_in"),
			equals: () => false,
		});
		this.add(this.in, { name: "in" });

		// --- 5. `cost` — per-input token counters. -------------------------
		const costNode = node<CostState>([], {
			name: "cost",
			describeKind: "state",
			meta: aiMeta("agent_cost"),
			initial: ZERO_COST,
		});
		this.add(costNode, { name: "cost" });
		this.cost = costNode;

		// --- 6. `out` — the typed outbox. ----------------------------------
		// Derived from `loop.lastResponse`. SENTINEL while `loop.lastResponse`
		// has never emitted a real response (F9 fix: the loop now stays
		// SENTINEL too — no more eager `null` placeholder), so the SENTINEL
		// detector inside the fn is `prevData[0] === undefined`. Between
		// runs, `loop.lastResponse.down([[INVALIDATE]])` clears that
		// `prevData` slot back to undefined, so this derived correctly gates
		// to RESOLVED on the next status="idle" wave.
		const outMapper = spec.outMapper ?? defaultOutMapper<TOut>();
		const outNode = node<TOut>(
			[this.loop.lastResponse],
			(data, a, ctx) => {
				const batch0 = data[0];
				const resp =
					batch0 != null && batch0.length > 0
						? (batch0.at(-1) as LLMResponse | undefined)
						: (ctx.prevData[0] as LLMResponse | undefined);
				if (resp === undefined) {
					a.down([[RESOLVED]]);
					return;
				}
				a.emit(outMapper(resp));
			},
			{
				name: "out",
				describeKind: "derived",
				meta: aiMeta("agent_out"),
				// Each in.emit may produce a structurally-equal response (e.g.
				// from a deterministic adapter) — disable framework dedup so
				// repeat emits propagate and `awaitSettled({skipCurrent:true})`
				// sees them. Callers can wrap with `distinctUntilChanged` if
				// they want change-only semantics.
				equals: () => false,
			},
		);
		this.add(outNode, { name: "out" });
		this.out = outNode;

		// --- 7. `status` — translated from loop.status. --------------------
		// Mirror via §32 pattern: a state node downstream consumers depend on,
		// reset and updated by an effect listening to loop.status.
		const statusNode = node<AgentStatus>([], {
			name: "status",
			describeKind: "state",
			meta: aiMeta("agent_status"),
			initial: "idle",
		});
		this.add(statusNode, { name: "status" });
		this.status = statusNode;

		const statusMirrorEff = node(
			[this.loop.status],
			(data, _a, ctx) => {
				const batch0 = data[0];
				const loopStatus =
					batch0 != null && batch0.length > 0
						? (batch0.at(-1) as string)
						: ((ctx.prevData[0] as string | undefined) ?? "idle");
				const next: AgentStatus =
					loopStatus === "idle"
						? "idle"
						: loopStatus === "thinking" || loopStatus === "acting"
							? "running"
							: loopStatus === "done"
								? "done"
								: loopStatus === "error"
									? "error"
									: "idle";
				if (statusNode.cache !== next) statusNode.emit(next);
			},
			{ describeKind: "effect", meta: aiMeta("agent_status_mirror") },
		);
		this.addDisposer(keepalive(statusMirrorEff));

		// --- 8. Cost-rollup effect. ---------------------------------------
		// Rolls forward on each loop.lastResponse emission. Reads
		// loop.turn.cache for the iteration count (sole-owner-reactive-reader
		// per Phase 12 D1 lock — loop is mounted as a subgraph of this Graph).
		// SENTINEL gate: `prevData[0] === undefined` means no response has
		// ever been delivered for this run (post-INVALIDATE reset between
		// runs), so the rollup short-circuits.
		const costEff = node(
			[this.loop.lastResponse],
			(data, _a, ctx) => {
				const batch0 = data[0];
				const resp =
					batch0 != null && batch0.length > 0
						? (batch0.at(-1) as LLMResponse | undefined)
						: (ctx.prevData[0] as LLMResponse | undefined);
				if (resp === undefined) return;
				const prev = (costNode.cache as CostState | undefined) ?? ZERO_COST;
				const turns = (this.loop.turn.cache as number | undefined) ?? prev.turns;
				const next: CostState = {
					usage: resp.usage != null ? addUsage(prev.usage, resp.usage) : prev.usage,
					turns,
				};
				costNode.emit(next);
			},
			{ describeKind: "effect", meta: aiMeta("agent_cost_rollup") },
		);
		this.addDisposer(keepalive(costEff));

		// --- 9. `in` → input queue → drain → kick the loop. ----------------
		// Phase 13.G/H + /qa N1(b) lock (2026-05-01): bundle.in is a
		// writable surface, but kicks are queued through an internal
		// hub-style topic + cursor subscription. Out-of-the-box queueing —
		// caller fires `in.emit(x)` while the agent is mid-run; the input
		// is parked on the queue and picked up when the loop returns to
		// `idle` / `done` / `error`. No mid-run reset / cost-leak hazard
		// (which the prior raw `in.subscribe → kick` path had).
		//
		// Topology:
		//   `in` (state Node, writable) → `inputBridge` (subscribe →
		//   publish) → `inputTopic` (TopicGraph<TIn>) → `inputSub`
		//   (SubscriptionGraph<TIn>) → `drainEffect` (effect on
		//   [inputSub.available, loop.status]) → loop kick.
		const inMapper = spec.inMapper ?? defaultInMapper<TIn>();
		const inputTopic: TopicGraph<TIn> = topic<TIn>("input-topic");
		this.mount("input-topic", inputTopic);
		const inputSub: SubscriptionGraph<TIn> = subscription<TIn>("input-sub", inputTopic, {
			from: "now",
		});
		this.mount("input-sub", inputSub);

		// Bridge: `in.emit(x)` publishes to the topic. Validates the
		// caller-supplied input via `inMapper` at the boundary so the
		// type error surfaces in the caller's stack frame (not later
		// during drain). Per the F9 SENTINEL trap, `in` cache is
		// `undefined` until the first emit; push-on-subscribe delivers
		// nothing.
		const inputBridge = this.in.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] !== DATA) continue;
				const input = m[1] as TIn;
				// Boundary type-check: throws if TIn is not string and no
				// inMapper supplied. Better here than at drain time so the
				// caller's `in.emit(...)` raises synchronously.
				inMapper(input);
				inputTopic.publish(input);
			}
		});
		this.addDisposer(inputBridge);

		// Drain effect: when an input is pending AND the loop is ready
		// (`idle` / `done` / `error`), pull one and kick. Re-entrancy
		// guard via `loop.status` — `thinking` / `acting` skip.
		const drainEffect = node(
			[inputSub.available, this.loop.status],
			(data, _a, ctx) => {
				const availBatch = data[0];
				const statusBatch = data[1];
				const avail =
					(availBatch != null && availBatch.length > 0
						? (availBatch.at(-1) as readonly TIn[])
						: ((ctx.prevData[0] as readonly TIn[] | undefined) ?? [])) ?? [];
				const stat =
					(statusBatch != null && statusBatch.length > 0
						? (statusBatch.at(-1) as string)
						: ((ctx.prevData[1] as string | undefined) ?? "idle")) ?? "idle";
				if (avail.length === 0) return;
				if (stat === "thinking" || stat === "acting") return;
				const result = inputSub.pullAndAck(1);
				if (result.items.length === 0) return;
				const input = result.items[0] as TIn;
				const userMsg = inMapper(input);
				batch(() => {
					// Reset per-input accumulators so cost/turns don't include
					// the previous input. `lastResponse` is reset via plain
					// `[[INVALIDATE]]` — under DS-13.5.A INVALIDATE both clears
					// `_cached` AND settles the consuming wave (decrements
					// `_dirtyDepCount` like RESOLVED), so dependents like
					// `out` / `costEff` fire on the next status transition
					// without staying wedged in DIRTY. Pre-DS-13.5.A this used
					// the `[[INVALIDATE], [RESOLVED]]` paired-reset workaround.
					this.loop.lastResponse.down([[INVALIDATE]]);
					this.loop.turn.emit(0);
					this.loop.aborted.emit(false);
					costNode.emit(ZERO_COST);
					this.loop.chat.append("user", userMsg);
					this.loop.status.emit("thinking");
				});
			},
			{ describeKind: "effect", meta: aiMeta("agent_input_drain") },
		);
		this.addDisposer(keepalive(drainEffect));

		// `out` and `status` keepalives are unnecessary because the cost /
		// status effects above already activate `loop.lastResponse` and
		// `loop.status` — the derived `out` reads from a kept-alive source.
		// We do keep `out` alive explicitly so `awaitSettled(bundle.out,
		// { skipCurrent: true })` works even when no other consumer
		// subscribes between input and response.
		this.addDisposer(keepalive(this.out));

		// Surface in describe.
		void TERMINAL_STATUSES;
	}
}

// ---------------------------------------------------------------------------
// Default mappers
// ---------------------------------------------------------------------------

/**
 * Default `inMapper` for `TIn extends string`. Asserts the runtime type at
 * the boundary so callers who omit `inMapper` for a non-string `TIn` get a
 * clear error rather than a silent passthrough.
 */
function defaultInMapper<TIn>(): (input: TIn) => string {
	return (input) => {
		if (typeof input !== "string") {
			throw new TypeError(
				`agent: inMapper is required when TIn is not a string (got ${typeof input}). Pass spec.inMapper.`,
			);
		}
		return input;
	};
}

/**
 * Default `outMapper` for `TOut extends LLMResponse`. Asserts the response
 * shape at the boundary; callers with a non-LLMResponse `TOut` must
 * provide `outMapper`.
 */
function defaultOutMapper<TOut>(): (response: LLMResponse) => TOut {
	return (response) => response as unknown as TOut;
}
