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
 * **EXECUTE/VERIFY via JobFlow (Tier 6.5 C2 lock, 2026-04-28).** The
 * stages 5–6 EXECUTE → VERIFY pair runs through an internal `executeFlow`
 * JobFlow with two stages (`execute`, `verify`). Each stage's pump owns
 * `claim → work → ack` for one claim; the verify stage's payload contains
 * `{ item, execution, verify }` so the post-completed dispatch effect can
 * route the 3-way verdict (verified / self-correctable retry / structural
 * + reingest) without any cross-wave `withLatestFrom` pairing. Items
 * arriving from per-route topics + retry feedback enter via a single
 * `enqueueEffect` that pushes to `executeFlow.queue("execute")`.
 *
 * @module
 */

import { monotonicNs } from "../../../core/clock.js";
import { derived, type Node } from "../../../core/index.js";
import { placeholderArgs } from "../../../core/meta.js";
import { effect, state } from "../../../core/sugar.js";
import { tryIncrementBounded } from "../../../extra/mutation/index.js";
import { merge, withLatestFrom } from "../../../extra/operators.js";
import { Graph } from "../../../graph/graph.js";
import { trackingKey } from "../../_internal/index.js";
import { _oneShotLlmCall, stripFences } from "../../ai/_internal.js";
import type { ChatMessage, LLMAdapter } from "../../ai/index.js";
import { promptNode } from "../../ai/index.js";
import {
	type JobEnvelope,
	type JobFlowGraph,
	type JobQueueGraph,
	jobFlow,
	jobQueue,
} from "../../job-queue/index.js";
import {
	type MessagingHubGraph,
	messagingHub,
	type TopicGraph,
	topicBridge,
} from "../../messaging/index.js";
import { type GateController, pipelineGraph } from "../../orchestration/index.js";
import {
	DEFAULT_DECAY_RATE,
	DEFAULT_EXECUTE_PROMPT,
	DEFAULT_QUEUE_CONFIGS,
	DEFAULT_SEVERITY_WEIGHTS,
	DEFAULT_TRIAGE_PROMPT,
	DEFAULT_VERIFY_PROMPT,
	defaultErrorClassifier,
	QUEUE_NAMES,
	resolvePromptFn,
} from "../defaults.js";
import { type StrategyModelBundle, type StrategySnapshot, strategyModel } from "../strategy.js";
import type {
	ErrorClassifier,
	ExecuteOutput,
	ExecutePromptFn,
	ExecutionResult,
	HarnessExecutor,
	HarnessJobPayload,
	HarnessLoopOptions,
	HarnessVerifier,
	IntakeItem,
	QueueConfig,
	QueueRoute,
	TriagedItem,
	VerifyOutput,
	VerifyPromptFn,
	VerifyResult,
} from "../types.js";

// ---------------------------------------------------------------------------
// Hub topic names (internal constants — strings are the routing API)
// ---------------------------------------------------------------------------

const TOPIC_INTAKE = "intake";
const TOPIC_TRIAGE_OUTPUT = "triage-output";
const TOPIC_RETRY = "retry";
const TOPIC_VERIFY_RESULTS = "verify-results";
const TOPIC_UNROUTED = "__unrouted";

// ---------------------------------------------------------------------------
// Default LLM executor / verifier work fns (Tier 6.5 C2)
// ---------------------------------------------------------------------------

/**
 * Build the default EXECUTE work fn — calls `adapter.invoke()` once per
 * claimed job, parses the JSON response into an `ExecuteOutput<A>`, and
 * returns a {@link HarnessJobPayload} with `execution` filled in.
 *
 * Errors (parse failure, adapter throw, malformed JSON) are caught and
 * surfaced as a `failure`-outcome payload — the dispatch effect routes
 * the item rather than dropping it via pump nack (see C2 contract on
 * {@link HarnessExecutor}).
 *
 * Subsumes the pre-Tier-6.5 `promptNode`-based default: per-claim LLM
 * calls don't benefit from `promptNode`'s cross-wave switchMap, and a
 * fresh per-claim subgraph would be wasteful. Direct `adapter.invoke`
 * is the right shape inside JobFlow pumps.
 *
 * @param adapter - LLMAdapter for the execute call.
 * @param prompt  - Prompt template (string or `(item) => string`). Defaults
 *                   to the harness's built-in execute prompt.
 */
export function defaultLlmExecutor<A = unknown>(
	adapter: LLMAdapter,
	prompt?: string | ExecutePromptFn,
): HarnessExecutor<A> {
	const promptFn = resolvePromptFn<TriagedItem>(prompt, DEFAULT_EXECUTE_PROMPT, (tpl, item) =>
		tpl.replace("{{item}}", JSON.stringify(item)),
	);
	return (job, opts) => {
		const item = job.payload.item;
		const messages: readonly ChatMessage[] = [{ role: "user", content: promptFn(item) }];
		// Bridge-layer flakes get `outcome: "failure"` with no `errorClass`.
		// The dispatch effect's `errorClassifier` runs over `detail` and the
		// default classifier matches `parse|json|config|validation|syntax`,
		// so parse-error flakes route to retry. Adapter HTTP/network failures
		// without a keyword fall through to structural per the existing
		// asymmetry (executor side relies on classifier; verifier side sets
		// errorClass directly per qa F3).
		const failurePayload = (detail: string): HarnessJobPayload<A> => ({
			...job.payload,
			execution: { item, outcome: "failure", detail },
		});
		const formatErr = (err: unknown): string => (err instanceof Error ? err.message : String(err));
		// One-shot bridge via `_oneShotLlmCall` (patterns/ai/_internal.ts).
		// Helper owns subscription / abort / first-DATA capture / COMPLETE
		// arm; this site owns parse + validate + payload mapping. Pump-
		// supplied `opts.signal` (Tier 6.5 2.5b) cascades into adapter +
		// fromAny via `parentSignal`.
		return _oneShotLlmCall<HarnessJobPayload<A>>(adapter, messages, {
			parentSignal: opts?.signal,
			onSuccess: (resp) => {
				let parsed: unknown;
				try {
					parsed = JSON.parse(stripFences(String(resp.content)));
				} catch (err) {
					return failurePayload(`execute parse error: ${formatErr(err)}`);
				}
				// Validate plain object before field access — non-object JSON
				// (`null` / number / array / string) silently masks malformed
				// responses unless caught here. Surfaced via parse-error keyword
				// for classifier routing.
				if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
					return failurePayload(
						`execute parse error: non-object response: ${JSON.stringify(parsed)}`,
					);
				}
				const obj = parsed as Partial<ExecuteOutput<A>>;
				return {
					...job.payload,
					execution: {
						item,
						outcome: obj.outcome ?? "failure",
						detail: obj.detail ?? "unknown",
						artifact: obj.artifact,
					},
				};
			},
			onFailure: (kind, err) => {
				if (kind === "complete") {
					return failurePayload("adapter completed without emitting DATA");
				}
				return failurePayload(`executor failed: ${formatErr(err)}`);
			},
		});
	};
}

/**
 * Build the default VERIFY work fn — calls `adapter.invoke()` once per
 * claimed job to review the prior-stage execution, parses the JSON
 * response into a `VerifyOutput`, and returns a {@link HarnessJobPayload}
 * with `verify` filled in.
 *
 * Same C2 error semantics as {@link defaultLlmExecutor}: parse / adapter
 * failures are surfaced as a structural-failure verify payload so the
 * dispatch effect routes the item.
 */
export function defaultLlmVerifier<A = unknown>(
	adapter: LLMAdapter,
	prompt?: string | VerifyPromptFn<A>,
): HarnessVerifier<A> {
	const promptFn = resolvePromptFn<readonly [ExecuteOutput<A> | null, TriagedItem | null]>(
		prompt,
		DEFAULT_VERIFY_PROMPT,
		(tpl, pair) => {
			const [execution, item] = pair;
			return tpl
				.replace("{{execution}}", JSON.stringify(execution))
				.replace("{{item}}", JSON.stringify(item));
		},
	);
	return (job, opts) => {
		const { item, execution } = job.payload;
		if (execution == null) {
			// Defensive — verify stage runs after execute; if execution is
			// missing, surface as STRUCTURAL failure rather than throw. This is
			// the only structural-classified path here: it indicates a topology
			// bug (verify ran without execute), not an LLM-bridge flake. Bridge
			// flakes (parse / adapter throw / ERROR / COMPLETE-without-DATA) get
			// `errorClass: "self-correctable"` below so the dispatch effect's
			// retry budget absorbs them before reingest fires (qa F3).
			return {
				...job.payload,
				verify: {
					verified: false,
					findings: ["verifier: prior execute stage produced no execution"],
					errorClass: "structural",
				},
			} satisfies HarnessJobPayload<A>;
		}
		const messages: readonly ChatMessage[] = [
			{ role: "user", content: promptFn([execution, item]) },
		];
		// Bridge-layer flakes: classify as self-correctable so the dispatch
		// effect routes via the retry budget first. Persistent flakes still
		// fall through to structural after `maxRetries` exhaustion (qa F3).
		const failurePayload = (finding: string): HarnessJobPayload<A> => ({
			...job.payload,
			verify: {
				verified: false,
				findings: [finding],
				errorClass: "self-correctable",
			},
		});
		const formatErr = (err: unknown): string => (err instanceof Error ? err.message : String(err));
		// One-shot bridge — see `_oneShotLlmCall` JSDoc. Helper owns the
		// subscribe + capture + abort + COMPLETE arm; this site owns parse +
		// validate + verify-payload mapping. Pump-supplied `opts.signal`
		// (Tier 6.5 2.5b) cascades into adapter + fromAny via `parentSignal`.
		return _oneShotLlmCall<HarnessJobPayload<A>>(adapter, messages, {
			parentSignal: opts?.signal,
			onSuccess: (resp) => {
				let parsed: unknown;
				try {
					parsed = JSON.parse(stripFences(String(resp.content)));
				} catch (err) {
					return failurePayload(`verify parse error: ${formatErr(err)}`);
				}
				if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
					return failurePayload(
						`verify parse error: non-object response: ${JSON.stringify(parsed)}`,
					);
				}
				const obj = parsed as Partial<VerifyOutput>;
				return {
					...job.payload,
					verify: {
						verified: obj.verified === true,
						findings: obj.findings ?? [],
						errorClass: obj.errorClass,
					},
				};
			},
			onFailure: (kind, err) => {
				if (kind === "complete") {
					return failurePayload("verifier completed without emitting DATA");
				}
				return failurePayload(`verifier failed: ${formatErr(err)}`);
			},
		});
	};
}

// ---------------------------------------------------------------------------
// HarnessGraph
// ---------------------------------------------------------------------------

/**
 * The graph returned by {@link harnessLoop}. Wraps a single
 * {@link MessagingHubGraph} that owns all reactive-wire-crossing topics
 * (intake, per-route queues, `__unrouted`, retry, verify-results,
 * triage-output), plus an `executeFlow` JobFlow that owns the
 * EXECUTE → VERIFY pipeline (Tier 6.5 C2). Sugar getters expose the
 * canonical topics so the surface stays ergonomic.
 */
export class HarnessGraph<A = unknown> extends Graph {
	/** Messaging hub — the routing-data plane. Queue topics live here. */
	readonly queues: MessagingHubGraph;

	/**
	 * EXECUTE → VERIFY JobFlow (Tier 6.5 C2). Pumps own claim/ack/nack
	 * lifecycle for each stage. Inspect via:
	 * - `harness.executeFlow.queue("execute").pending` — pending depth.
	 * - `harness.executeFlow.queue("verify").pending` — items mid-execute.
	 * - `harness.executeFlow.completed` — verified items waiting for the
	 *   dispatch effect's 3-way routing.
	 * - `harness.executeFlow.completedCount` — total terminal completions.
	 */
	readonly executeFlow: JobFlowGraph<HarnessJobPayload<A>>;

	/**
	 * Per-route JobQueueGraph audit mirrors. Each triaged item that reaches
	 * a queue is also enqueued here, giving reactive `depth` + `pending` +
	 * `jobs` observables per route. The dispatch effect ack/removeBy-id's
	 * the matching job on terminal verdict. The executeFlow JobFlow handles
	 * the EXECUTE → VERIFY data flow; this is a parallel audit-side ledger
	 * for per-route depth metrics. Inspect via
	 * `harness.jobs.get(route).depth.cache` for backpressure metrics.
	 */
	readonly jobs: ReadonlyMap<QueueRoute, JobQueueGraph<TriagedItem>>;

	/** Per-route gate controllers (only for gated queues). */
	readonly gates: ReadonlyMap<QueueRoute, GateController<TriagedItem>>;

	/**
	 * Per-route queue topics — typed accessor for the four
	 * {@link QUEUE_NAMES} entries (`auto-fix`, `needs-decision`,
	 * `investigation`, `backlog`). Mirrors the `gates` / `jobs` map
	 * shape so callers can iterate `[route, topic]` pairs without
	 * hand-rolling `harness.queues.topicNames()` + meta-topic exclusion.
	 *
	 * Excludes the meta topics that share the hub:
	 * `intake` (use {@link intake}), `verify-results` (use
	 * {@link verifyResults}), `retry` (use {@link retry}), `__unrouted`
	 * (use {@link unrouted}), and the internal `triage-output` fan-in.
	 */
	readonly queueTopics: ReadonlyMap<QueueRoute, TopicGraph<TriagedItem>>;

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

	/**
	 * REFLECT-stage tick marker — emits one DATA per terminal verdict observed
	 * on `executeFlow.completed`. `equals: () => false` so each completion
	 * produces an observable tick (no Object.is collapse on identical
	 * `null` payloads). Inspection tools (`harnessTrace`, dashboards) can
	 * subscribe directly here instead of resolving by string path
	 * (`harness.node("reflect")`) — the field is the lock against rename
	 * drift.
	 */
	readonly reflect: Node<null>;

	constructor(
		name: string,
		queues: MessagingHubGraph,
		executeFlow: JobFlowGraph<HarnessJobPayload<A>>,
		queueTopics: Map<QueueRoute, TopicGraph<TriagedItem>>,
		jobs: Map<QueueRoute, JobQueueGraph<TriagedItem>>,
		gates: Map<QueueRoute, GateController<TriagedItem>>,
		strategy: StrategyModelBundle,
		totalRetries: Node<number>,
		totalReingestions: Node<number>,
		reflect: Node<null>,
		priorityScores?: Map<QueueRoute, Node<number>>,
	) {
		super(name);
		this.queues = queues;
		this.executeFlow = executeFlow;
		this.queueTopics = queueTopics;
		this.jobs = jobs;
		this.gates = gates;
		this.strategy = strategy;
		this.totalRetries = totalRetries;
		this.totalReingestions = totalReingestions;
		this.reflect = reflect;
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
	 * Stage-label → observe-path map for the 7 pipeline stages.
	 *
	 * Decouples inspection tools (`harnessTrace`, `harnessProfile`, custom
	 * dashboards) from mount-structure churn: hub migration, future stage
	 * splits, gate remounting, or the Tier 6.5 C2 JobFlow rewire shouldn't
	 * require edits to `trace.ts` as long as this method stays accurate.
	 *
	 * Each stage yields `{ label, paths }`; consumers iterate paths per
	 * stage and attach observers. Tier 6.5: EXECUTE / VERIFY paths now
	 * resolve to the `executeFlow` stage queues + the `verify-dispatch`
	 * effect node.
	 */
	stageNodes(): ReadonlyArray<{ label: string; paths: readonly string[] }> {
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
			{ label: "EXECUTE", paths: ["executeFlow::execute::events"] },
			{ label: "VERIFY", paths: ["executeFlow::verify::events"] },
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
 * 5. **EXECUTE** — JobFlow `execute` stage; user-supplied or default work fn
 * 6. **VERIFY** — JobFlow `verify` stage; verifies the executed artifact
 * 7. **REFLECT** — strategy model records outcomes; dispatch effect routes 3-way
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

	const queueConfigs = new Map<QueueRoute, QueueConfig>();
	for (const route of QUEUE_NAMES) {
		queueConfigs.set(route, {
			...DEFAULT_QUEUE_CONFIGS[route],
			...opts.queues?.[route],
		});
	}

	// --- Messaging hub (Wave B Q1 Option A) ---
	const queuesHub = messagingHub(`${name}/queues`, {
		defaultTopicOptions: { retainedLimit },
	});

	// Eagerly create canonical topics so they appear in `describe()` from
	// construction time and `harness.queues.has(route)` answers `true`
	// before any publish.
	const intake = queuesHub.topic<IntakeItem>(TOPIC_INTAKE);
	const triageOutput = queuesHub.topic<TriagedItem>(TOPIC_TRIAGE_OUTPUT);
	const retryTopic = queuesHub.topic<TriagedItem>(TOPIC_RETRY);
	const verifyResults = queuesHub.topic<VerifyResult<A>>(TOPIC_VERIFY_RESULTS);
	const queueTopics = new Map<QueueRoute, TopicGraph<TriagedItem>>();
	for (const route of QUEUE_NAMES) {
		queueTopics.set(route, queuesHub.topic<TriagedItem>(route));
	}
	const unroutedTopic = queuesHub.topic<TriagedItem>(TOPIC_UNROUTED);

	// --- Strategy model (used by triage + dispatch) ---
	const strategy = strategyModel();

	// --- Stage 2: TRIAGE ---
	// triageInput pairs intake.latest (trigger) with strategy.node
	// (advisory, sampled via withLatestFrom). Breaks the feedback cycle
	// (verify → strategy.record → strategy.node would otherwise re-fire
	// triage on every recorded outcome).
	const triageInput = withLatestFrom(
		intake.latest as Node<unknown>,
		strategy.node as Node<unknown>,
	);

	const triagePromptFn = resolvePromptFn<readonly [IntakeItem, StrategySnapshot]>(
		opts.triagePrompt,
		DEFAULT_TRIAGE_PROMPT,
		(tpl, pair) => {
			const [item, strat] = pair;
			return tpl
				.replace("{{strategy}}", JSON.stringify(Array.from(strat.entries())))
				.replace("{{item}}", JSON.stringify(item));
		},
	);

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
	// Router is a thin effect that publishes the merged TriagedItem to
	// `triage-output`. `topicBridge`s fan it out to per-route queues by
	// filtering on `item.route`. Unknown routes flow into `__unrouted` so
	// misclassified items become a subscribable dead-letter signal.
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
		// returns is overwritten by the real intake value via the trailing
		// spread.
		const merged: TriagedItem = { ...classification, ...intakeItem } as TriagedItem;
		triageOutput.publish(merged);
	});
	const routerUnsub = router.subscribe(() => {});

	// TopicBridges fan triage-output into per-route queues (visible edges).
	const knownRoutes = new Set<string>(QUEUE_NAMES);
	for (const route of QUEUE_NAMES) {
		topicBridge<TriagedItem>(`bridge/${route}`, triageOutput, queueTopics.get(route)!, {
			map: (item) => (item.route === route ? item : undefined),
		});
	}
	topicBridge<TriagedItem>("bridge/__unrouted", triageOutput, unroutedTopic, {
		map: (item) => (knownRoutes.has(item.route) ? undefined : item),
	});

	// --- Per-route audit JobQueueGraphs (parallel ledger) ---
	//
	// One jobQueue per route mirrors the route topic's publishes so
	// dashboards get a subscribable `depth` / `pending` / `jobs` view of
	// in-progress items. Identity is established at enqueue time (the
	// returned `id` is paired with `trackingKey(item)`); the dispatch
	// effect calls `JobQueueGraph.removeById(id)` on terminal verdict.
	//
	// This audit ledger runs in parallel with the `executeFlow` JobFlow
	// (Tier 6.5 C2). The two are complementary:
	// - This ledger gives **per-route** depth/pending observables
	//   ("how backed up is auto-fix?").
	// - executeFlow gives **per-stage** depth/pending observables
	//   ("how many items are mid-execute?").
	//
	// **Retry handling.** Retry items republished to `retryTopic` flow
	// into executeFlow (via the enqueue effect) but NOT into per-route
	// audit jq's (retryTopic isn't mirrored). The audit job stays alive
	// across retries — only terminal (verified / structural) decisions
	// remove it. `depth` reflects "items still being worked on".
	//
	// **Ring-buffer safety.** WeakSet keyed on item identity; once the
	// topic's ring buffer trims the head, dropped entries become
	// unreachable and the WeakSet auto-prunes.
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
	// Per-route gates between `topic.latest` and the executeFlow enqueue.
	// Foreign-node-accept (Session B.1): pass `topic.latest` directly; the
	// gate factory auto-adds the source under `${name}/source` inside its
	// own graph if not already registered.
	const gateGraph = pipelineGraph("gates");
	const gateControllers = new Map<QueueRoute, GateController<TriagedItem>>();
	for (const route of QUEUE_NAMES) {
		const config = queueConfigs.get(route)!;
		if (!config.gated) continue;
		const topic = queueTopics.get(route)!;
		const ctrl = gateGraph.approvalGate<TriagedItem>(
			`${route}/gate`,
			topic.latest as Node<unknown>,
			{
				maxPending: config.maxPending,
				startOpen: config.startOpen,
			},
		);
		gateControllers.set(route, ctrl);
	}

	// --- executeInput: merge of post-gate route latests + retry feedback ---
	const queueOutputs: Node<TriagedItem | null>[] = [];
	for (const route of QUEUE_NAMES) {
		const config = queueConfigs.get(route)!;
		if (config.gated && gateControllers.has(route)) {
			queueOutputs.push(gateControllers.get(route)!.output as Node<TriagedItem | null>);
		} else {
			queueOutputs.push(queueTopics.get(route)!.latest as Node<TriagedItem | null>);
		}
	}
	queueOutputs.push(retryTopic.latest as Node<TriagedItem | null>);

	const executeInput = merge<TriagedItem | null>(...queueOutputs);

	// --- Stages 5+6: EXECUTE → VERIFY via JobFlow (Tier 6.5 C2) ---
	const executor: HarnessExecutor<A> =
		opts.executor ?? defaultLlmExecutor<A>(adapter as LLMAdapter, opts.executePrompt);
	const verifier: HarnessVerifier<A> =
		opts.verifier ?? defaultLlmVerifier<A>(adapter as LLMAdapter, opts.verifyPrompt);

	// Per-stage `maxPerPump` caps via the JobFlow `StageDef.maxPerPump`
	// extension (Tier 6.5 D1 follow-up). Each stage gets its own cap;
	// callers can pin execute at a low concurrency for cost control while
	// leaving verify unbounded (or vice versa). Defaults to
	// `Number.MAX_SAFE_INTEGER` per stage — matches today's unbounded
	// `merge()` parallelism.
	const executeMaxPerPump = opts.executeMaxPerPump ?? Number.MAX_SAFE_INTEGER;
	const verifyMaxPerPump = opts.verifyMaxPerPump ?? Number.MAX_SAFE_INTEGER;

	const executeFlow = jobFlow<HarnessJobPayload<A>>(`${name}/executeFlow`, {
		stages: [
			{ name: "execute", work: (job) => executor(job), maxPerPump: executeMaxPerPump },
			{ name: "verify", work: (job) => verifier(job), maxPerPump: verifyMaxPerPump },
		],
	});

	// Enqueue effect: per-item bridge from the reactive `executeInput`
	// stream into the JobFlow. Each non-null item becomes one JobEnvelope
	// at the execute stage. Retry items (via `retryTopic`) re-enter the
	// flow as fresh enqueues with their `$retries` counter bumped.
	const enqueueEffect = effect(
		[executeInput as Node<unknown>],
		([item]) => {
			if (item == null) return;
			executeFlow.enqueue({ item: item as TriagedItem });
		},
		{ name: "execute-enqueue" },
	);
	const enqueueUnsub = enqueueEffect.subscribe(() => {});

	// --- Stage 7: dispatch effect (REFLECT + retry/structural routing) ---
	//
	// Replaces the pre-Tier-6.5 `fastRetry` effect. Reads completed
	// JobEnvelopes from `executeFlow.completed`, identifies new ones via
	// WeakSet, and dispatches the 3-way verdict:
	//
	// 1. **Verified** → record success, publish VerifyResult, ack audit job.
	// 2. **Self-correctable + retries available** → republish to retryTopic
	//    with $retries bumped (no audit ack — retry stays in the audit ledger).
	// 3. **Structural / retries exhausted** → record failure, publish
	//    VerifyResult, ack audit job, reingest if reingestion budget remains.
	//
	// Imperative cross-graph publish from inside an effect is sanctioned
	// per COMPOSITION-GUIDE §32 / §35 for terminal side-effects with audit
	// trails (here: verifyResults / retry / intake topics).
	const maxReingestions = opts.maxReingestions ?? 1;
	const maxTotalRetries = Math.min(opts.maxTotalRetries ?? maxRetries * 10, 100);
	const maxTotalReingestions = Math.min(opts.maxTotalReingestions ?? maxReingestions * 10, 100);
	const totalRetries = state(0);
	const totalReingestions = state(0);

	function assembleResult(
		execution: ExecutionResult<A>,
		verify: VerifyOutput,
		item: TriagedItem,
	): VerifyResult<A> {
		return {
			item,
			execution,
			verified: verify.verified,
			findings: verify.findings ?? [],
			errorClass: verify.errorClass,
		};
	}

	function handleVerified(vr: VerifyResult<A>, item: TriagedItem): void {
		strategy.record(item.rootCause, item.intervention, true);
		verifyResults.publish(vr);
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
		// Audit job stays alive across retries — only terminal (verified /
		// structural) decisions remove it.
	}

	function handleStructural(vr: VerifyResult<A>, item: TriagedItem): void {
		strategy.record(item.rootCause, item.intervention, false);
		verifyResults.publish(vr);
		ackJob(item);
		const key = trackingKey(item);
		const itemReingestions = item.$reingestions ?? 0;
		if (
			itemReingestions < maxReingestions &&
			tryIncrementBounded(totalReingestions, maxTotalReingestions)
		) {
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

	// Monotonic length cursor (qa F4) — `executeFlow.completed` retains up to
	// `DEFAULT_COMPLETED_RETAINED_LIMIT` (1024) entries; each new completion
	// emits a fresh snapshot containing every retained job. A naive
	// `WeakSet.has` walk is O(retainedLimit) per emit. Track the last-seen
	// length and only iterate the new tail. The cursor is capped at the
	// snapshot length to handle ring-buffer trims (when the retained log
	// drops oldest entries past the limit, `arr.length` shrinks and the
	// cursor catches up automatically).
	let dispatchCursor = 0;
	const dispatchEffect = effect(
		[executeFlow.completed as Node<unknown>],
		([log]) => {
			const arr = (log ?? []) as readonly JobEnvelope<HarnessJobPayload<A>>[];
			// Trim handling: if the retained log shrunk below our cursor, the
			// missing entries are gone (we already processed them or the trim
			// happened mid-flight); just clamp.
			if (dispatchCursor > arr.length) dispatchCursor = arr.length;
			const start = dispatchCursor;
			dispatchCursor = arr.length;
			for (let i = start; i < arr.length; i++) {
				const job = arr[i] as JobEnvelope<HarnessJobPayload<A>>;
				const { item, execution, verify } = job.payload;
				// Defensive — both should always be present in a verify-stage
				// completion. If either is missing, log via verifyResults so the
				// failure is observable but don't block the dispatch effect.
				if (execution == null || verify == null) {
					ackJob(item);
					continue;
				}
				const vr = assembleResult(execution, verify, item);
				if (vr.verified) {
					handleVerified(vr, item);
					continue;
				}
				const errClass =
					vr.errorClass ??
					errorClassifier({
						item,
						outcome: execution.outcome,
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
			}
		},
		{ name: "verify-dispatch" },
	);
	const dispatchUnsub = dispatchEffect.subscribe(() => {});

	// REFLECT — topology marker derived from completed-log emissions.
	// `equals: () => false` disables Object.is absorption so each
	// completion produces an observable REFLECT tick (one per verify
	// wave). Without this, `null === null` would collapse every emit
	// after the first into RESOLVED and the trace would show a single
	// REFLECT event over the whole run.
	const reflectNode = derived([executeFlow.completed as Node<unknown>], () => null, {
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
		executeFlow,
		queueTopics,
		jobQueues,
		gateControllers,
		strategy,
		totalRetries,
		totalReingestions,
		reflectNode as Node<null>,
		priorityScores,
	);

	// Register disposers for unregistered internal nodes.
	harness.addDisposer(routerUnsub);
	harness.addDisposer(enqueueUnsub);
	harness.addDisposer(dispatchUnsub);
	harness.addDisposer(strategy.dispose);
	for (const unsub of jobMirrorUnsubs) harness.addDisposer(unsub);

	// Register stage nodes for introspection (harnessTrace, describe,
	// observe). Tier 6.3: triage-input + router-input named so
	// `explain(intake.latest, reflect)` walks named nodes end-to-end with
	// no `<anonymous>` entries.
	harness.add(triageInput as Node<unknown>, { name: "triage-input" });
	harness.add(triageNode as Node<unknown>, { name: "triage" });
	harness.add(routerInput as Node<unknown>, { name: "router-input" });
	harness.add(executeInput as Node<unknown>, { name: "execute-input" });
	harness.add(enqueueEffect as Node<unknown>, { name: "execute-enqueue" });
	harness.add(dispatchEffect as Node<unknown>, { name: "verify-dispatch" });
	harness.add(reflectNode as Node<unknown>, { name: "reflect" });
	harness.add(strategy.node as Node<unknown>, { name: "strategy" });
	// Reflect is a topology marker — subscribe so its fn registers as a
	// reactive edge visible in `describe()` / `explain()` immediately on
	// harness construction.
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
	harness.mount("executeFlow", executeFlow);
	for (const [route, jq] of jobQueues) {
		harness.mount(`jobs/${route}`, jq);
	}

	// Tier 1.5.3 Phase 2.5 (DG1=B): tag the Graph with its constructing
	// factory so `describe()` exposes provenance.
	harness.tagFactory("harnessLoop", placeholderArgs(opts as unknown as Record<string, unknown>));

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
	if (!opts.lastInteractionNs) {
		throw new Error(
			"harnessLoop: `opts.priority` requires `opts.lastInteractionNs` — pass a Node<number> (e.g. `fromTimer(60_000)` or a `state(monotonicNs())` you bump on human interaction). Priority scores only decay when this node settles; an internal default would freeze age at construction time.",
		);
	}
	const lastInteractionNs = opts.lastInteractionNs;
	const signals = opts.priority ?? {};
	const severityWeights = {
		...DEFAULT_SEVERITY_WEIGHTS,
		...signals.severityWeights,
	} as Record<string, number>;
	const decayRate = signals.decayRate ?? DEFAULT_DECAY_RATE;
	const effectivenessThreshold = signals.effectivenessThreshold ?? 0.7;
	const effectivenessBoost = signals.effectivenessBoost ?? 15;

	const scores = new Map<QueueRoute, Node<number>>();
	for (const [route, topic] of queueTopics) {
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
