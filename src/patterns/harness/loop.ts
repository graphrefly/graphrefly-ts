/**
 * harnessLoop() factory (roadmap §9.0).
 *
 * Wires the static 7-stage topology: INTAKE → TRIAGE → QUEUE → GATE →
 * EXECUTE → VERIFY → REFLECT. Static topology, flowing data — the Kafka
 * insight applied to human+LLM collaboration.
 *
 * **Hub model (Wave B Unit 20 C + Q1).** All reactive-wire-crossing topics
 * live in one `MessagingHubGraph` exposed as `HarnessGraph.queues`: the
 * four per-route queues, an `__unrouted` dead-letter, plus `intake`,
 * `retry`, `verify-results`, and the `triage-output` fan-in topic. The
 * router is a single derived/effect pair that publishes to `triage-output`;
 * per-route `topicBridge`s fan out by `map:` predicate. Routing is data
 * (topic name), not code — every routing decision is a visible edge in
 * `describe()` / `explain()`.
 *
 * @module
 */

import { monotonicNs } from "../../core/clock.js";
import { derived, type Node } from "../../core/index.js";
import { node } from "../../core/node.js";
import { effect, state } from "../../core/sugar.js";
import { merge, withLatestFrom } from "../../extra/operators.js";
import { Graph } from "../../graph/graph.js";
import { trackingKey, tryIncrementBounded } from "../_internal.js";
import type { LLMAdapter } from "../ai/index.js";
import { promptNode } from "../ai/index.js";
import { type JobQueueGraph, jobQueue } from "../job-queue/index.js";
import {
	type MessagingHubGraph,
	messagingHub,
	type TopicGraph,
	topicBridge,
} from "../messaging/index.js";
import { type GateController, gate } from "../orchestration/index.js";
import {
	DEFAULT_DECAY_RATE,
	DEFAULT_QUEUE_CONFIGS,
	DEFAULT_SEVERITY_WEIGHTS,
	defaultErrorClassifier,
	QUEUE_NAMES,
} from "./defaults.js";
import { type StrategyModelBundle, type StrategySnapshot, strategyModel } from "./strategy.js";
import type {
	ErrorClassifier,
	ExecuteOutput,
	ExecutePromptFn,
	ExecutionResult,
	HarnessExecutor,
	HarnessLoopOptions,
	HarnessVerifier,
	IntakeItem,
	QueueConfig,
	QueueRoute,
	TriagedItem,
	TriagePromptFn,
	VerifyOutput,
	VerifyPromptFn,
	VerifyResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Default prompts
// ---------------------------------------------------------------------------

const DEFAULT_TRIAGE_PROMPT = `You are a triage classifier for a reactive collaboration harness.

Given an intake item, classify it and output JSON:
{
  "rootCause": "composition" | "missing-fn" | "bad-docs" | "schema-gap" | "regression" | "unknown",
  "intervention": "template" | "catalog-fn" | "docs" | "wrapper" | "schema-change" | "investigate",
  "route": "auto-fix" | "needs-decision" | "investigation" | "backlog",
  "priority": <number 0-100>,
  "triageReasoning": "<one sentence>"
}

Strategy model (past effectiveness):
{{strategy}}

Intake item:
{{item}}`;

const DEFAULT_EXECUTE_PROMPT = `You are an implementation agent.

Given a triaged issue with root cause and intervention type, produce a fix.

Issue:
{{item}}

Output JSON:
{
  "outcome": "success" | "failure" | "partial",
  "detail": "<description of what was done or what failed>"
}`;

const DEFAULT_VERIFY_PROMPT = `You are a QA reviewer.

Given an execution result, verify whether the fix is correct.

Execution:
{{execution}}

Original issue:
{{item}}

Output JSON:
{
  "verified": true/false,
  "findings": ["<finding1>", ...],
  "errorClass": "self-correctable" | "structural"  // only if verified=false
}`;

// ---------------------------------------------------------------------------
// Hub topic names (internal constants — strings are the routing API)
// ---------------------------------------------------------------------------

const TOPIC_INTAKE = "intake";
const TOPIC_TRIAGE_OUTPUT = "triage-output";
const TOPIC_RETRY = "retry";
const TOPIC_VERIFY_RESULTS = "verify-results";
const TOPIC_UNROUTED = "__unrouted";

// ---------------------------------------------------------------------------
// Default LLM executor / verifier factories
// ---------------------------------------------------------------------------

/**
 * Build the default EXECUTE slot — a `promptNode` driven by the given
 * adapter and prompt template. This is the factory behind the harness's
 * zero-config execute stage.
 *
 * Obeys all four rules of the {@link HarnessExecutor} contract: `promptNode`
 * internally uses `switchMap` + `fromAny` for cancellation (rule 2), emits
 * once per resolved LLM invocation (rules 1 + 4), and reads the triaged
 * item exclusively through its `deps` argument (rule 3).
 *
 * @param adapter - LLMAdapter for the execute call.
 * @param prompt  - Prompt template (string or `(item) => string`). Defaults
 *                   to the harness's built-in execute prompt.
 */
export function defaultLlmExecutor<A = unknown>(
	adapter: LLMAdapter,
	prompt?: string | ExecutePromptFn,
): HarnessExecutor<A> {
	const promptFn: ExecutePromptFn =
		typeof prompt === "function"
			? prompt
			: (item) => (prompt ?? DEFAULT_EXECUTE_PROMPT).replace("{{item}}", JSON.stringify(item));
	return (input: Node<TriagedItem | null>): Node<ExecuteOutput<A> | null> =>
		promptNode<ExecuteOutput<A>>(
			adapter,
			[input as Node<unknown>],
			promptFn as (v: unknown) => string,
			{
				name: "execute",
				format: "json",
			},
		);
}

/**
 * Build the default VERIFY slot — a `promptNode` that reviews a
 * pre-paired `[executeOutput, item]` context node. The harness creates
 * the pairing (via `withLatestFrom(executeNode, executeInput)`) once and
 * shares it with both the verifier and the internal fast-retry
 * dispatcher, so the default verifier can consume the context directly
 * without building its own withLatestFrom.
 *
 * @param adapter - LLMAdapter for the verify call.
 * @param prompt  - Prompt template. Defaults to the harness's built-in
 *                   verify prompt (receives the full pair, extracts both).
 */
export function defaultLlmVerifier<A = unknown>(
	adapter: LLMAdapter,
	prompt?: string | VerifyPromptFn<A>,
): HarnessVerifier<A> {
	const promptFn: VerifyPromptFn<A> =
		typeof prompt === "function"
			? prompt
			: (pair) => {
					const [execution, item] = pair;
					return (prompt ?? DEFAULT_VERIFY_PROMPT)
						.replace("{{execution}}", JSON.stringify(execution))
						.replace("{{item}}", JSON.stringify(item));
				};
	return (
		context: Node<readonly [ExecuteOutput<A> | null, TriagedItem | null] | null>,
	): Node<VerifyOutput | null> =>
		promptNode<VerifyOutput>(
			adapter,
			[context as Node<unknown>],
			(pair) => {
				if (pair == null) return "";
				return promptFn(pair as readonly [ExecuteOutput<A> | null, TriagedItem | null]);
			},
			{
				name: "verify",
				format: "json",
			},
		);
}

// ---------------------------------------------------------------------------
// HarnessGraph
// ---------------------------------------------------------------------------

/**
 * The graph returned by {@link harnessLoop}. Wraps a single
 * {@link MessagingHubGraph} that owns all reactive-wire-crossing topics
 * (intake, per-route queues, `__unrouted`, retry, verify-results,
 * triage-output). Sugar getters expose the canonical topics so the
 * surface stays ergonomic.
 */
export class HarnessGraph<A = unknown> extends Graph {
	/** Messaging hub — the routing-data plane. Queue topics live here. */
	readonly queues: MessagingHubGraph;

	/**
	 * Per-route JobQueueGraph mirrors (Unit 20 D). Each triaged item that
	 * reaches a queue is also enqueued here, giving reactive `depth` +
	 * `pending` + `jobs` observables. `fastRetry` terminal decisions
	 * {@link JobQueueGraph.ack ack} / {@link JobQueueGraph.nack nack} the
	 * matching job. The executor dataflow is unchanged — claim/ack/nack
	 * runs as an audit-side layer (per Unit 21's "interface unchanged"
	 * decision). Inspect via `harness.jobs.get(route).depth.cache` for
	 * backpressure metrics.
	 */
	readonly jobs: ReadonlyMap<QueueRoute, JobQueueGraph<TriagedItem>>;

	/** Per-route gate controllers (only for gated queues). */
	readonly gates: ReadonlyMap<QueueRoute, GateController<TriagedItem>>;

	/** Strategy model bundle — record outcomes, lookup effectiveness. */
	readonly strategy: StrategyModelBundle;

	/** Global retry count across all items (circuit breaker). Reactive — subscribable. */
	readonly totalRetries: Node<number>;

	/** Global reingestion count across all items (circuit breaker). Reactive — subscribable. */
	readonly totalReingestions: Node<number>;

	/**
	 * Per-route priority score nodes, populated only when `opts.priority` is
	 * set on {@link harnessLoop}. Each node emits a score combining severity,
	 * attention decay, and strategy-model effectiveness for the route's
	 * current head-of-queue item. `undefined` means the caller did not opt
	 * in to priority scoring.
	 */
	readonly priorityScores?: ReadonlyMap<QueueRoute, Node<number>>;

	constructor(
		name: string,
		queues: MessagingHubGraph,
		jobs: Map<QueueRoute, JobQueueGraph<TriagedItem>>,
		gates: Map<QueueRoute, GateController<TriagedItem>>,
		strategy: StrategyModelBundle,
		totalRetries: Node<number>,
		totalReingestions: Node<number>,
		priorityScores?: Map<QueueRoute, Node<number>>,
	) {
		super(name);
		this.queues = queues;
		this.jobs = jobs;
		this.gates = gates;
		this.strategy = strategy;
		this.totalRetries = totalRetries;
		this.totalReingestions = totalReingestions;
		this.priorityScores = priorityScores;
	}

	/** Intake topic — publish items here to enter the loop. */
	get intake(): TopicGraph<IntakeItem> {
		return this.queues.topic<IntakeItem>(TOPIC_INTAKE);
	}

	/** Verify results topic — subscribe to see verification outcomes. */
	get verifyResults(): TopicGraph<VerifyResult<A>> {
		return this.queues.topic<VerifyResult<A>>(TOPIC_VERIFY_RESULTS);
	}

	/** Retry feedback topic — fast-retry re-entry point. */
	get retry(): TopicGraph<TriagedItem> {
		return this.queues.topic<TriagedItem>(TOPIC_RETRY);
	}

	/** Dead-letter topic for items whose LLM-chosen route is unknown. */
	get unrouted(): TopicGraph<TriagedItem> {
		return this.queues.topic<TriagedItem>(TOPIC_UNROUTED);
	}

	/**
	 * Stage-label → observe-path map for the 7 pipeline stages (Unit 22 C).
	 *
	 * Decouples inspection tools (`harnessTrace`, `harnessProfile`, custom
	 * dashboards) from mount-structure churn: hub migration, future stage
	 * splits, or gate remounting won't require edits to `trace.ts` as long
	 * as this method stays accurate. Returned paths are resolvable via
	 * `harness.observe(path)` / `harness.resolve(path)`.
	 *
	 * Each stage yields `{ label, paths }` because QUEUE and GATE legitimately
	 * have multiple paths (one per route). Consumers iterate paths per stage
	 * and attach observers as needed.
	 */
	stageNodes(): ReadonlyArray<{ label: string; paths: readonly string[] }> {
		// Defensive-by-construction (matching `harnessProfile`): drop any
		// queue/intake/verify-results path whose backing topic is no longer
		// in the hub (e.g. after a `queues.removeTopic(name)` during teardown).
		// Without this guard, `harnessTrace` would surface spurious
		// `observe-unavailable` errors for absent topics.
		const hub = this.queues;
		const resolveHubPath = (name: string): string | null =>
			hub.has(name) ? `queues::${name}::latest` : null;
		const includeIf = <T>(value: T | null | undefined): readonly T[] =>
			value == null ? [] : [value];

		const queuePaths = QUEUE_NAMES.flatMap((r) => includeIf(resolveHubPath(r)));
		const gatePaths: string[] = [];
		for (const [route] of this.gates) {
			gatePaths.push(`gates::${route}/gate`);
		}
		return [
			{ label: "INTAKE", paths: includeIf(resolveHubPath("intake")) },
			{ label: "TRIAGE", paths: ["triage"] },
			{ label: "QUEUE", paths: queuePaths },
			{ label: "GATE", paths: gatePaths },
			{ label: "EXECUTE", paths: ["execute"] },
			{ label: "VERIFY", paths: includeIf(resolveHubPath("verify-results")) },
			{ label: "REFLECT", paths: ["reflect"] },
			{ label: "STRATEGY", paths: ["strategy"] },
		];
	}
}

// ---------------------------------------------------------------------------
// harnessLoop factory
// ---------------------------------------------------------------------------

/**
 * Wire the reactive collaboration loop as a static-topology graph.
 *
 * The loop has 7 stages:
 * 1. **INTAKE** — items arrive from multiple sources via `intake.publish()`
 * 2. **TRIAGE** — promptNode classifies, routes, and prioritizes
 * 3. **QUEUE** — 4 priority-ordered TopicGraphs (auto-fix, needs-decision, investigation, backlog)
 * 4. **GATE** — human approval on configurable queues
 * 5. **EXECUTE** — promptNode or human implements the fix
 * 6. **VERIFY** — promptNode reviews + optional fast-retry
 * 7. **REFLECT** — strategy model records outcomes
 *
 * @param name - Graph name.
 * @param opts - Configuration.
 * @returns HarnessGraph with controller accessors.
 */
export function harnessLoop<A = unknown>(
	name: string,
	opts: HarnessLoopOptions<A>,
): HarnessGraph<A> {
	const adapter = opts.adapter;
	const maxRetries = opts.maxRetries ?? 2;
	const retainedLimit = opts.retainedLimit ?? 1000;
	const errorClassifier: ErrorClassifier = opts.errorClassifier ?? defaultErrorClassifier;

	// Merge queue configs with defaults
	const queueConfigs = new Map<QueueRoute, QueueConfig>();
	for (const route of QUEUE_NAMES) {
		queueConfigs.set(route, {
			...DEFAULT_QUEUE_CONFIGS[route],
			...opts.queues?.[route],
		});
	}

	// --- Messaging hub (Wave B Q1 Option A) ---
	// One hub for every reactive-wire-crossing topic in the harness.
	const queuesHub = messagingHub(`${name}/queues`, {
		defaultTopicOptions: { retainedLimit },
	});

	// Eagerly create the canonical topics so they appear in `describe()` even
	// before any publish, and so `harness.queues.has(route)` answers `true`
	// from the moment the harness is constructed.
	const intake = queuesHub.topic<IntakeItem>(TOPIC_INTAKE);
	const triageOutput = queuesHub.topic<TriagedItem>(TOPIC_TRIAGE_OUTPUT);
	const retryTopic = queuesHub.topic<TriagedItem>(TOPIC_RETRY);
	const verifyResults = queuesHub.topic<VerifyResult<A>>(TOPIC_VERIFY_RESULTS);
	const queueTopics = new Map<QueueRoute, TopicGraph<TriagedItem>>();
	for (const route of QUEUE_NAMES) {
		queueTopics.set(route, queuesHub.topic<TriagedItem>(route));
	}
	const unroutedTopic = queuesHub.topic<TriagedItem>(TOPIC_UNROUTED);

	// --- Strategy model (used by triage + reflect) ---
	const strategy = strategyModel();

	// --- Stage 2: TRIAGE ---
	// Strategy context uses withLatestFrom: intake.latest is the reactive trigger,
	// strategy.node is sampled without being a trigger. This breaks the feedback
	// cycle (verify → strategy.record() → strategy.node) reactively — strategy
	// changes don't re-fire triage, only new intake items do.
	const triageInput = withLatestFrom(
		intake.latest as Node<unknown>,
		strategy.node as Node<unknown>,
	);

	const triagePromptRaw = opts.triagePrompt;
	const triagePromptFn: TriagePromptFn =
		typeof triagePromptRaw === "function"
			? triagePromptRaw
			: (pair) => {
					const [item, strat] = pair;
					return (triagePromptRaw ?? DEFAULT_TRIAGE_PROMPT)
						.replace("{{strategy}}", JSON.stringify(Array.from(strat.entries())))
						.replace("{{item}}", JSON.stringify(item));
				};

	const triageNode = promptNode<TriagedItem>(
		adapter as LLMAdapter,
		[triageInput as Node<unknown>],
		(pair: unknown) => {
			const asPair = pair as readonly [IntakeItem | null, StrategySnapshot] | null;
			if (!asPair || !asPair[0]) return "";
			return triagePromptFn(asPair as readonly [IntakeItem, StrategySnapshot]);
		},
		{
			name: "triage",
			format: "json",
		},
	);

	// --- Stage 3: QUEUE (hub routing) ---
	//
	// The router is now a thin effect that publishes the merged TriagedItem
	// to `triage-output`. `topicBridge`s fan it out to the per-route queues
	// by filtering on `item.route`. Unknown routes flow into `__unrouted` so
	// misclassified items become a subscribable dead-letter signal instead
	// of a silent drop.
	//
	// Sample `triageInput` (not `intake.latest`) — triageInput holds the
	// [item, strategy] pair that *triggered* this triage, so the router
	// pairs the item with its own classification even if a newer intake
	// arrived mid-LLM-call. triageNode triggers; triageInput is sampled.
	const routerInput = withLatestFrom(triageNode as Node<unknown>, triageInput as Node<unknown>);
	const router = effect([routerInput as Node<unknown>], ([pair]) => {
		if (pair == null) return;
		const [classification, triagePair] = pair as [
			TriagedItem | null,
			[IntakeItem | null, StrategySnapshot] | null,
		];
		if (!classification?.route) return;
		const intakeItem = triagePair?.[0];
		// Intake fields win over classification: the LLM only owns the five
		// triage-classification fields (rootCause, intervention, route,
		// priority, triageReasoning); any intake state it accidentally
		// returns (e.g. a regurgitated `affectsAreas`) is overwritten by the
		// real intake value via the trailing spread.
		//
		// The `$retries` / `$reingestions` rename in Unit 15 D is an
		// orthogonal defense — the `$`-prefix keys are unlikely to survive
		// an LLM JSON round-trip at all, so even if spread order regressed
		// the counters would be protected.
		const merged: TriagedItem = { ...classification, ...intakeItem } as TriagedItem;
		triageOutput.publish(merged);
	});
	const routerUnsub = router.subscribe(() => {});

	// TopicBridges fan triage-output into per-route queues (visible edges).
	// `knownRoutes` as a Set for O(1) membership on every triage publish —
	// keeps the unrouted predicate cheap even if QUEUE_NAMES grows.
	const knownRoutes = new Set<string>(QUEUE_NAMES);
	for (const route of QUEUE_NAMES) {
		topicBridge<TriagedItem>(`bridge/${route}`, triageOutput, queueTopics.get(route)!, {
			map: (item) => (item.route === route ? item : undefined),
		});
	}
	topicBridge<TriagedItem>("bridge/__unrouted", triageOutput, unroutedTopic, {
		map: (item) => (knownRoutes.has(item.route) ? undefined : item),
	});

	// --- JobQueueGraph audit layer (Unit 20 D) ---
	//
	// One jobQueue per route mirrors the queue topic's publishes so
	// dashboards get a subscribable `depth` / `pending` / `jobs` view of
	// in-progress items. Identity is established at enqueue time (the
	// returned `id` is paired with `trackingKey(item)`); terminal decisions
	// in `fastRetry` call `JobQueueGraph.remove(id)` (added Wave B QA) to
	// delete by id regardless of state — avoids the FIFO-head-mismatch
	// class where `claim(1)` would pop the wrong job for out-of-order
	// verify waves.
	//
	// **Retry handling:** fast-retry does NOT touch the audit layer. The
	// retry flows through a separate `retry` topic (not mirrored) and
	// eventually terminates through verify; ONLY the terminal
	// (verified / structural) decision removes the job. The audit entry
	// stays alive across retries — `depth` reflects "items still being
	// worked on" including mid-retry.
	//
	// **Ring-buffer safety:** we detect new items via a `WeakSet<object>`
	// keyed on item identity, not an `array.length` cursor. Once the
	// topic's internal ring buffer trims the head (retainedLimit), the
	// dropped entries become unreachable and the WeakSet auto-prunes —
	// no cursor drift, no silent mirror halt after N publishes.
	const jobQueues = new Map<QueueRoute, JobQueueGraph<TriagedItem>>();
	const routeJobIds = new Map<string, { route: QueueRoute; id: string }>();
	for (const route of QUEUE_NAMES) {
		jobQueues.set(route, jobQueue<TriagedItem>(`jobs/${route}`));
	}
	const jobMirrorUnsubs: Array<() => void> = [];
	for (const route of QUEUE_NAMES) {
		const topic = queueTopics.get(route)!;
		const jq = jobQueues.get(route)!;
		const seen = new WeakSet<object>();
		const mirror = effect(
			[topic.events as Node<unknown>],
			([events]) => {
				const arr = (events ?? []) as readonly TriagedItem[];
				for (const item of arr) {
					if (seen.has(item as unknown as object)) continue;
					seen.add(item as unknown as object);
					const id = jq.enqueue(item);
					routeJobIds.set(trackingKey(item), { route, id });
				}
			},
			{ name: `jobs/${route}-mirror` },
		);
		jobMirrorUnsubs.push(mirror.subscribe(() => {}));
	}

	function ackJob(item: TriagedItem): void {
		const key = trackingKey(item);
		const entry = routeJobIds.get(key);
		if (!entry) return;
		jobQueues.get(entry.route)?.removeById(entry.id);
		routeJobIds.delete(key);
	}

	// --- Stage 4: GATE ---
	//
	// Gates live in a standalone `gateGraph` mounted on the harness. Each
	// gated queue's `latest` node is re-registered inside `gateGraph` under
	// a canonical name so the gate primitive resolves it by path — the hub
	// topic itself is already mounted inside `queuesHub` so it cannot be
	// re-mounted here. (Unit 17 B's gateGraph.mount shape is inapplicable
	// once queues live in a hub; the ::source registration is the remaining
	// pragmatic bridge.)
	const gateGraph = new Graph("gates");
	const gateControllers = new Map<QueueRoute, GateController<TriagedItem>>();
	for (const route of QUEUE_NAMES) {
		const config = queueConfigs.get(route)!;
		if (!config.gated) continue;
		const topic = queueTopics.get(route)!;
		gateGraph.add(topic.latest as Node<unknown>, { name: `${route}/source` });
		const ctrl = gate<TriagedItem>(gateGraph, `${route}/gate`, `${route}/source`, {
			maxPending: config.maxPending,
			startOpen: config.startOpen,
		});
		gateControllers.set(route, ctrl);
	}

	// --- Stage 5: EXECUTE ---
	// Merge all gate outputs + ungated queue latests + retry feedback into a
	// single execute input using the merge() operator (no imperative .down()).
	const queueOutputs: Node<TriagedItem | null>[] = [];
	for (const route of QUEUE_NAMES) {
		const config = queueConfigs.get(route)!;
		if (config.gated && gateControllers.has(route)) {
			queueOutputs.push(gateControllers.get(route)!.node as Node<TriagedItem | null>);
		} else {
			queueOutputs.push(queueTopics.get(route)!.latest as Node<TriagedItem | null>);
		}
	}
	queueOutputs.push(retryTopic.latest as Node<TriagedItem | null>);

	const executeInput = merge<TriagedItem | null>(...queueOutputs);

	const executor: HarnessExecutor<A> =
		opts.executor ?? defaultLlmExecutor<A>(adapter as LLMAdapter, opts.executePrompt);
	const executeNode = executor(executeInput as Node<TriagedItem | null>);

	// --- Execute context: [execOutput, item] captured once per execute-wave ---
	//
	// executeInput feeds into executeNode (dep) AND later into verifyNode (dep).
	// Without this node, verifyNode would fire twice per wave in the retry path:
	// once when executeNode settles (with stale item from prevData), and once when
	// executeInput delivers the retry item directly. The second fire would pair the
	// correct item with a verify output that was computed using the wrong item.
	//
	// withLatestFrom(executeNode, executeInput) fires exactly once per execute-wave:
	// executeInput notifies executeNode first (depth-first), executeNode runs fn and
	// settles in executeContextNode.dep[0], then executeInput settles in dep[1].
	// dirtyDepCount reaches 0 only after both settle → fn runs once with correct data.
	//
	// **This wiring relies on the {@link HarnessExecutor} contract rule 4** —
	// a custom `executor` must emit DATA on result completion, not on input
	// arrival. An executor that synchronously mirrors its input into DATA
	// would fire this node on every input wave with a stale/placeholder value
	// and then fire again on the real result. `refineExecutor` and the
	// default LLM executor both satisfy this. See `HarnessExecutor` JSDoc
	// in `types.ts` for the full contract.
	const executeContextNode = withLatestFrom(
		executeNode as Node<unknown>,
		executeInput as Node<unknown>,
	);

	// --- Stage 6: VERIFY ---
	// Verifier receives the shared `executeContextNode` pre-paired above.
	// `defaultLlmVerifier` and `evalVerifier` both consume the context
	// directly — no second `withLatestFrom` wrap. The harness also uses the
	// same node as `verifyContext`'s secondary dep for fast-retry, so exec
	// + item are sampled once per wave total.
	const verifier: HarnessVerifier<A> =
		opts.verifier ?? defaultLlmVerifier<A>(adapter as LLMAdapter, opts.verifyPrompt);
	const verifyNode = verifier(
		executeContextNode as Node<readonly [ExecuteOutput<A> | null, TriagedItem | null] | null>,
	);

	// --- Fast-retry path ---
	// verifyContext = withLatestFrom(verifyNode, executeContextNode):
	//   [verifyOutput, [execOutput, item]]
	// Fires once when verifyNode settles; executeContextNode is sampled as secondary.
	const verifyContext = withLatestFrom(
		verifyNode as Node<unknown>,
		executeContextNode as Node<unknown>,
	);

	const maxReingestions = opts.maxReingestions ?? 1;
	const maxTotalRetries = Math.min(opts.maxTotalRetries ?? maxRetries * 10, 100);
	const maxTotalReingestions = Math.min(opts.maxTotalReingestions ?? maxReingestions * 10, 100);
	const totalRetries = state(0);
	const totalReingestions = state(0);

	// Uses shared `tryIncrementBounded` (patterns/_internal.ts) — documented
	// P3 exception for self-owned counters read+written from a single call
	// site (`fastRetry` effect below).

	// --- fastRetry sub-functions (Unit 18b B extraction) ---
	//
	// The original fastRetry body mixed result assembly, terminal-success
	// recording, retry re-publish, and structural reingestion into one
	// closure. Unit 18b B extracts each branch into a named helper so
	// the reactive wiring is obviously "one node, three branches, no
	// imperative feedback cycles." E3 (post-1.0) will make each branch a
	// reactive derived + thin effect pair.

	function assembleResults(
		vo: VerifyOutput,
		execRaw: ExecuteOutput<A> | null,
		item: TriagedItem,
	): VerifyResult<A> {
		const exec: ExecutionResult<A> = {
			item,
			outcome: execRaw?.outcome ?? "failure",
			detail: execRaw?.detail ?? "unknown",
			artifact: execRaw?.artifact,
		};
		return {
			item,
			execution: exec,
			verified: vo.verified,
			findings: vo.findings ?? [],
			errorClass: vo.errorClass,
		};
	}

	function handleVerified(vr: VerifyResult<A>, item: TriagedItem): void {
		strategy.record(item.rootCause, item.intervention, true);
		verifyResults.publish(vr);
		// Unit 20 D: terminal success → ack the audit job.
		ackJob(item);
	}

	function handleRetry(vr: VerifyResult<A>, item: TriagedItem): void {
		const key = trackingKey(item);
		const itemRetries = item.$retries ?? 0;
		const retryItem: TriagedItem = {
			...item,
			$retries: itemRetries + 1,
			summary: `[RETRY ${itemRetries + 1}/${maxRetries}] ${key} — Previous attempt failed: ${vr.findings.join("; ")}`,
			relatedTo: [key],
		};
		retryTopic.publish(retryItem);
		// The audit job stays alive across retries — only terminal (verified /
		// structural) decisions remove the job. This keeps `depth` meaningful
		// as "items still being worked on" (retries included).
	}

	function handleStructural(vr: VerifyResult<A>, item: TriagedItem): void {
		// Structural failure or max retries exceeded → record + publish +
		// reingest (if within caps).
		strategy.record(item.rootCause, item.intervention, false);
		verifyResults.publish(vr);
		// Unit 20 D: structural failure is terminal for this attempt → ack.
		ackJob(item);
		const key = trackingKey(item);
		const itemReingestions = item.$reingestions ?? 0;
		if (
			itemReingestions < maxReingestions &&
			tryIncrementBounded(totalReingestions, maxTotalReingestions)
		) {
			// Unit 18b C: source + severity preserved from original item so
			// reingested items keep their provenance (was hardcoded "eval" / "high").
			intake.publish({
				source: item.source,
				summary: `Verification failed for: ${key}`,
				evidence: vr.findings.join("\n"),
				affectsAreas: item.affectsAreas,
				affectsEvalTasks: item.affectsEvalTasks,
				severity: item.severity ?? "high",
				relatedTo: [key],
				$reingestions: itemReingestions + 1,
			});
		}
	}

	// Use raw node() so we can check batchData[0] directly — effect() falls back
	// to ctx.prevData[0] when verifyContext emits RESOLVED (secondary-only wave),
	// which would re-fire with stale context and create phantom retries.
	const fastRetry = node([verifyContext as Node<unknown>], (batchData, _actions) => {
		const batch = batchData[0];
		if (batch == null || batch.length === 0) return; // RESOLVED or not involved — skip
		const ctxVal = batch[batch.length - 1];
		if (ctxVal == null) return;
		// verifyContext shape: [verifyOutput, [execOutput, item]]
		const [vo, execCtx] = ctxVal as [
			VerifyOutput | null,
			[ExecuteOutput<A> | null, TriagedItem | null] | null,
		];
		const [execRaw, item] = execCtx ?? [null, null];
		if (!vo || !item) return;

		// Unit 18b D: null-execRaw guard. When the executor emits null (parse
		// failure, LLM timeout, aborted run), we have no outcome/detail to
		// assemble — surface that as a structural failure with a specific
		// detail message so the audit trail shows the cause. Without this
		// guard, `outcome: "failure"` + `detail: "unknown"` would masquerade
		// as a normal failed run.
		if (execRaw == null) {
			const stubExec: ExecutionResult<A> = {
				item,
				outcome: "failure",
				detail: "executor returned null",
			};
			const stubVr: VerifyResult<A> = {
				item,
				execution: stubExec,
				verified: false,
				findings: ["executor returned null"],
				errorClass: "structural",
			};
			handleStructural(stubVr, item);
			return;
		}

		const vr = assembleResults(vo, execRaw, item);

		if (vr.verified) {
			handleVerified(vr, item);
			return;
		}

		// Unit 18b E: pass the executor's real outcome through to the
		// classifier — hardcoded "failure" discarded nuance that custom
		// classifiers branch on (e.g. treating "partial" differently).
		const errClass =
			vr.errorClass ??
			errorClassifier({
				item,
				outcome: execRaw.outcome,
				detail: vr.findings.join("; "),
			});

		const itemRetries = item.$retries ?? 0;

		if (
			errClass === "self-correctable" &&
			itemRetries < maxRetries &&
			tryIncrementBounded(totalRetries, maxTotalRetries)
		) {
			handleRetry(vr, item);
		} else {
			handleStructural(vr, item);
		}
	});

	const fastRetryUnsub = fastRetry.subscribe(() => {}); // keepalive (COMPOSITION-GUIDE §1)

	// --- Stage 7: REFLECT ---
	// Strategy model is already updated in the fast-retry/verify effect above.
	// Hypothesis generation and memory distillation are pluggable extensions
	// wired externally via verifyResults topic subscription — not hardcoded here.
	//
	// The reflect node is a reactive pass-through whose sole purpose is to
	// surface the 7th stage in `harnessTrace`, `describe()`, and `explain()`.
	// `equals: () => false` disables Object.is absorption so each verify
	// wave produces an observable REFLECT tick — without this, `null === null`
	// would collapse every emit after the first into RESOLVED and the trace
	// would show a single REFLECT event over the whole run.
	const reflectNode = derived([fastRetry as Node<unknown>], () => null, {
		name: "reflect",
		equals: () => false,
	});

	// --- Optional priority scoring (Unit 19) ---
	let priorityScores: Map<QueueRoute, Node<number>> | undefined;
	if (opts.priority) {
		priorityScores = buildPriorityScores(queueTopics, strategy, opts);
	}

	// --- Assemble HarnessGraph ---
	const harness = new HarnessGraph<A>(
		name,
		queuesHub,
		jobQueues,
		gateControllers,
		strategy,
		totalRetries,
		totalReingestions,
		priorityScores,
	);

	// Register disposers for unregistered internal nodes (D1/D2 fix)
	harness.addDisposer(routerUnsub);
	harness.addDisposer(fastRetryUnsub);
	harness.addDisposer(strategy.dispose);
	for (const unsub of jobMirrorUnsubs) harness.addDisposer(unsub);

	// Register stage nodes for introspection (harnessTrace, describe, observe).
	// Unit 18 B+C: surface the pre-1.0 anonymous intermediaries so
	// `explain(execute, verify)`, `explain(triage, execute)`, `explain(verify,
	// reflect)` walk named nodes end-to-end.
	harness.add(triageNode as Node<unknown>, { name: "triage" });
	harness.add(executeInput as Node<unknown>, { name: "execute-input" });
	harness.add(executeNode as Node<unknown>, { name: "execute" });
	harness.add(executeContextNode as Node<unknown>, { name: "execute-context" });
	harness.add(verifyNode as Node<unknown>, { name: "verify" });
	harness.add(verifyContext as Node<unknown>, { name: "verify-context" });
	harness.add(fastRetry as Node<unknown>, { name: "verify-dispatch" });
	harness.add(reflectNode as Node<unknown>, { name: "reflect" });
	harness.add(strategy.node as Node<unknown>, { name: "strategy" });
	// Reflect is a topology marker — it has no downstream subscriber by
	// default. Subscribe here so its fn registers as a reactive edge visible
	// in `describe()` / `explain()` immediately on harness construction.
	harness.addDisposer(reflectNode.subscribe(() => undefined));
	if (priorityScores) {
		for (const [route, score] of priorityScores) {
			harness.add(score as Node<unknown>, { name: `priority/${route}` });
			harness.addDisposer(score.subscribe(() => {}));
		}
	}

	// Mount subgraphs
	harness.mount("queues", queuesHub);
	harness.mount("gates", gateGraph);
	for (const [route, jq] of jobQueues) {
		harness.mount(`jobs/${route}`, jq);
	}

	return harness;
}

// ---------------------------------------------------------------------------
// Priority scoring wiring (Unit 19 decision 2)
// ---------------------------------------------------------------------------

function buildPriorityScores<A>(
	queueTopics: Map<QueueRoute, TopicGraph<TriagedItem>>,
	strategy: StrategyModelBundle,
	opts: HarnessLoopOptions<A>,
): Map<QueueRoute, Node<number>> {
	// QA decision (Option A): `opts.lastInteractionNs` is required when
	// `opts.priority` is set. An auto-default would seed `state(monotonicNs())`
	// at construction time and never advance — score nodes only re-derive
	// when topic.latest or strategy.node settles, so decay would freeze for
	// idle queues and look like a silent correctness bug. Force callers to
	// supply an explicit tick source (typical: a `fromTimer` driven node or
	// a human-interaction bump state).
	if (!opts.lastInteractionNs) {
		throw new Error(
			"harnessLoop: `opts.priority` requires `opts.lastInteractionNs` — pass a Node<number> (e.g. `fromTimer(60_000)` or a `state(monotonicNs())` you bump on human interaction). Priority scores only decay when this node settles; an internal default would freeze age at construction time.",
		);
	}
	const lastInteractionNs = opts.lastInteractionNs;
	const signals = opts.priority ?? {};
	// D2: pull severity weights + decay rate from defaults.ts rather than
	// re-hardcoding literals. `{ ...DEFAULT, ...override }` keeps the tuning
	// single-source.
	const severityWeights = {
		...DEFAULT_SEVERITY_WEIGHTS,
		...signals.severityWeights,
	} as Record<string, number>;
	const decayRate = signals.decayRate ?? DEFAULT_DECAY_RATE;
	const effectivenessThreshold = signals.effectivenessThreshold ?? 0.7;
	const effectivenessBoost = signals.effectivenessBoost ?? 15;

	const scores = new Map<QueueRoute, Node<number>>();
	for (const [route, topic] of queueTopics) {
		// Score the head-of-queue item — null heads yield 0 ("no pressure").
		const score = derived<number>(
			[
				topic.latest as Node<unknown>,
				strategy.node as Node<unknown>,
				lastInteractionNs as Node<unknown>,
			],
			(vals) => {
				const item = vals[0] as TriagedItem | null;
				if (item == null) return 0;
				const baseWeight = severityWeights[item.severity ?? "medium"] ?? 40;
				const ageSeconds = (monotonicNs() - (vals[2] as number)) / 1e9;
				let s = baseWeight * Math.exp(-decayRate * Math.max(0, ageSeconds));
				const key = `${item.rootCause}→${item.intervention}`;
				const strat = vals[1] as ReadonlyMap<string, { successRate: number }>;
				const entry = strat?.get(key);
				if (entry && entry.successRate >= effectivenessThreshold) {
					s += effectivenessBoost;
				}
				return s;
			},
			{ name: `priority/${route}` },
		);
		scores.set(route, score);
	}
	return scores;
}
