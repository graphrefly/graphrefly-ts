/**
 * refineLoop — universal prompt/artifact optimization loop as a reactive Graph.
 *
 * Roadmap §9.8 (Wave 2.5). The loop is a 4-topic reactive pipeline:
 *
 *   iterationTrigger ──▶ GENERATE ──▶ EVALUATE ──▶ ANALYZE ──▶ DECIDE
 *                            │                                   │
 *                            └───────  feedback + trigger  ◀─────┘
 *
 * Each stage is a `TopicGraph` so dispatches stay O(1) per subscriber (cursor-
 * based) and every iteration is observable, replayable, and checkpointable.
 *
 * Composition invariants (from COMPOSITION-GUIDE):
 *  - §7 feedback cycle: only `iterationTrigger` drives re-generation. Strategy
 *    + feedback + dataset are read via closure updaters (§28 factory-time seed)
 *    so mid-run swaps apply to the NEXT iteration, never retrigger the current.
 *  - §28 factory-time seed: strategy, lastFeedback, prevCandidates, dataset
 *    closures captured at wiring time + updated via subscribe handlers so the
 *    first activation doesn't drop the initial pair.
 *  - §32 nested-drain state-mirror: the decide-effect writes `lastFeedback`
 *    BEFORE bumping `iterationTrigger` inside its `batch()`, guaranteeing the
 *    mirror is current when the next-iteration wave reaches the generate fn.
 *  - §19 terminal-emission: history / best emit once per iteration (settled),
 *    not on every intermediate wave.
 *  - §27 attachSnapshotStorage: the whole graph is checkpointable — pause overnight,
 *    resume tomorrow from the exact iteration count, candidate set, strategy.
 *
 * Scope clamp (v1): core factory + `RefineStrategy<T>` + `blindVariation` and
 * `errorCritique` built-ins + budget gating + checkpoint/resume.
 * `mutateAndRefine` / registry / `autoSelectStrategy` / `optimizeCatalog` /
 * `refineExecutor` are deferred.
 *
 * @module
 */

import { batch } from "../../../core/batch.js";
import { monotonicNs } from "../../../core/clock.js";
import { DATA, ERROR, RESOLVED } from "../../../core/messages.js";
import { placeholderArgs } from "../../../core/meta.js";
// `createNode` is the local alias for `node` so calls don't shadow
// `Graph.prototype.node` when the file's body inadvertently references the
// graph's `.node()` method. B5f keeps protocol-primitive construction visually
// distinct from graph-instance method dispatch.
import { node as createNode, type Node } from "../../../core/node.js";
import { tryIncrementBounded } from "../../../extra/mutation/index.js";
import { switchMap } from "../../../extra/operators.js";
import type { NodeInput } from "../../../extra/sources.js";
import { Graph, type GraphOptions } from "../../../graph/graph.js";
import { messagingHub, type TopicGraph } from "../../messaging/index.js";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** A single task row — the unit the evaluator scores one candidate against. */
export interface DatasetItem {
	readonly id: string;
	readonly [k: string]: unknown;
}

/**
 * One candidate's score on one task. Higher is better by convention.
 *
 * Set `candidateIndex` when the evaluator fans out scores across multiple
 * candidates (e.g. `candidates × tasks`). `pickBest` aggregates mean scores
 * per `candidateIndex` when present; when absent, falls back to positional
 * alignment (`scores[i]` ↔ `candidates[i]`).
 */
export interface EvalResult {
	readonly taskId: string;
	readonly score: number;
	readonly error?: string;
	readonly detail?: unknown;
	/** 0-based index into the `candidates` batch this score belongs to. */
	readonly candidateIndex?: number;
}

/** Aggregated feedback the strategy produces from a scores batch. */
export interface Feedback {
	readonly summary: string;
	readonly critique?: unknown;
	readonly weakTasks?: readonly string[];
	readonly score: number;
}

/**
 * Strategy interface — plain object, no base class. Strategies implement three
 * pure hooks; the loop infrastructure wraps them in reactive nodes so every
 * decision is visible in `describe()`.
 *
 * `generate` may be sync or async. Async generates yield a microtask per
 * iteration — that's what gives `pause()` / `setStrategy()` a window to
 * interleave. **A fully synchronous `generate` will drain the entire loop
 * during factory activation** (all iterations run before `refineLoop()`
 * returns), which is usually not what you want for observable, steerable
 * loops. Real strategies that call LLMs / evals are async and Just Work;
 * custom sync strategies for tests are fine but should be marked `async`
 * to match real cadence.
 */
export interface RefineStrategy<T> {
	readonly name: string;
	/** Produce initial candidates from the seed. Called at iteration 0. */
	seed(seed: T): readonly T[];
	/** Reduce scores to feedback. Pure function. */
	analyze(scores: readonly EvalResult[], candidates: readonly T[]): Feedback;
	/**
	 * Generate next-iteration candidates from feedback + prior candidates.
	 * Async allowed — the loop awaits via `fromAny`.
	 */
	generate(feedback: Feedback, candidates: readonly T[]): Promise<readonly T[]> | readonly T[];
}

/**
 * Evaluator shape — Shape 4 (2026-04-22): both `candidates` and `dataset` are
 * reactive nodes; the evaluator's returned node IS the EVALUATE topic's source
 * (no glue). Implementers can batch-eval (e.g. `funnel` with concurrency) or
 * map per-candidate — user's code.
 *
 * **Cancel-on-input contract (load-bearing).** Evaluators with async work
 * (LLM calls, network requests, etc.) MUST cancel any in-flight work when
 * `candidates` emits a new batch. The canonical pattern is `switchMap` over
 * `candidates`. If an evaluator does NOT cancel — e.g. naively kicks a
 * `Promise.all` per-batch and emits whatever resolves — late scores from a
 * prior iteration can arrive after the loop has already moved to the next
 * iteration (especially after `pause()` / `resume()`). Such stale scores
 * trip {@link refineLoop}'s `feedbackEnvelopeNode` with mismatched
 * `iter`/`scores`/`items`, producing an incorrect `DecideEvent` and (worse)
 * marking the iter as decided so the real iter's scores get skipped by
 * de-dup, stalling the loop. See `optimizations.md` "refineLoop async-
 * evaluator stale-scores follow-up" for the proposed `wrapEvaluator()`
 * helper that would enforce cancellation.
 *
 * **`EvalResult.candidateIndex` semantics.** Optional per-result field.
 * When present, multi-candidate aggregators ({@link errorCritique}'s
 * `pickBest`) score per index, picking the candidate with the highest
 * mean score. When absent across all results, those aggregators fall back
 * to positional matching against `candidates[0]` — meaning a strategy that
 * generates >1 candidate but emits unindexed scores effectively only ever
 * critiques the first candidate. Set `candidateIndex` whenever the
 * evaluator's score corresponds to a specific candidate in the batch.
 */
export type Evaluator<T> = (
	candidates: Node<readonly T[]>,
	dataset: Node<readonly DatasetItem[]>,
) => Node<readonly EvalResult[]>;

// ---------------------------------------------------------------------------
// Convergence
// ---------------------------------------------------------------------------

/**
 * Early-stop controls. Each field fans into its own derived node; the four
 * combine via `||` into `converged: Node<boolean>`. Callers see exactly
 * which rule tripped via `status` / the DECIDE topic's `reason`.
 */
export interface ConvergenceOptions {
	/** Stop when aggregate score has not improved for N iterations. */
	patience?: number;
	/** Stop when aggregate score reaches or exceeds this. */
	minScore?: number;
	/** Stop when absolute delta between consecutive scores falls below this. */
	minDelta?: number;
	/** Stop after N total evaluations (iteration count × per-iter candidates). */
	maxEvaluations?: number;
	/** Stop after N iterations. Always set a finite bound in production. */
	maxIterations?: number;
}

// ---------------------------------------------------------------------------
// Topic payloads (one per stage)
// ---------------------------------------------------------------------------

/** Emitted to the GENERATE topic each time the strategy produces a batch. */
export interface GenerateEvent<T> {
	readonly iteration: number;
	readonly candidates: readonly T[];
	readonly timestamp_ns: number;
}

/** Emitted to the EVALUATE topic when scores settle for an iteration. */
export interface EvaluateEvent<T> {
	readonly iteration: number;
	readonly candidates: readonly T[];
	readonly scores: readonly EvalResult[];
	readonly timestamp_ns: number;
}

/** Emitted to the ANALYZE topic — strategy's reduction over scores. */
export interface AnalyzeEvent<T> {
	readonly iteration: number;
	readonly candidates: readonly T[];
	readonly feedback: Feedback;
	readonly timestamp_ns: number;
}

/** Emitted to the DECIDE topic — branch taken this iteration. */
export interface DecideEvent {
	readonly iteration: number;
	readonly decision: "continue" | "converged" | "budget" | "paused";
	readonly reason?: string;
	readonly timestamp_ns: number;
}

// ---------------------------------------------------------------------------
// Status + history
// ---------------------------------------------------------------------------

export type RefineStatus = "running" | "converged" | "budget" | "paused" | "errored";

/**
 * **Internal envelope** — carries the iteration number alongside the
 * candidates batch so `iter` rides the data wave through the pipeline. Lets
 * downstream stages read iter from a real reactive edge instead of from
 * `iterationTrigger.cache` (P3 violation; see /qa D1, 2026-05-01).
 *
 * Sidecar `candidatesItemsNode = derived([candidatesNode], ([env]) => env.items)`
 * preserves the user-facing `Evaluator<T>` API (which sees `Node<readonly T[]>`).
 */
interface CandidatesEnvelope<T> {
	readonly iter: number;
	readonly items: readonly T[];
}

/**
 * **Internal envelope** — assembled by `feedbackEnvelopeNode` from
 * `userScoresNode` + `candidatesNode`. Carries iter + items + scores +
 * feedback together as the trigger payload for `decideEffect` (`§16` nested
 * `withLatestFrom` advisory-samples history / budget / pause). Lets
 * `decideEffect` read iter from the envelope (no `iterationTrigger.cache` read)
 * AND ensures decideEffect only fires when the user evaluator has actually
 * emitted fresh scores (gate via `batchData[scores]` length, eliminating
 * spurious decides on candidates-only fan-out waves).
 */
interface FeedbackEnvelope<T> {
	readonly iter: number;
	readonly items: readonly T[];
	readonly scores: readonly EvalResult[];
	readonly feedback: Feedback;
}

export interface Iteration<T> {
	readonly n: number;
	readonly candidates: readonly T[];
	readonly scores: readonly EvalResult[];
	readonly feedback: Feedback;
	/** `null` iff the candidate batch for this iteration was empty. */
	readonly best: T | null;
	readonly bestScore: number;
	readonly timestamp_ns: number;
}

// ---------------------------------------------------------------------------
// Factory + returned graph
// ---------------------------------------------------------------------------

export interface RefineLoopOptions extends ConvergenceOptions {
	/** Reactive dataset OR a plain array (auto-wrapped into `state`). */
	dataset: NodeInput<readonly DatasetItem[]> | readonly DatasetItem[];
	/** Total teacher calls cap across iterations. Default: unlimited. */
	budget?: number;
	/** Graph name. Default: `"refine-loop"`. */
	name?: string;
	/** Extra graph options forwarded to the underlying `Graph`. */
	graph?: GraphOptions;
}

/**
 * `class RefineLoopGraph<T> extends Graph` — the universal prompt/artifact
 * optimization loop as a reactive Graph subclass.
 *
 * Constructed via the {@link refineLoop} factory in normal use; exported as a
 * class so consumers can `instanceof`-narrow on returned values (Phase 13.G
 * `agent(spec)` is the consumer that motivated the migration). All
 * observability tools (`describe`, `explain`, `observe`, `attachSnapshotStorage`,
 * `snapshot`) Just Work since this `extends Graph`.
 *
 * **Phase 12.D (2026-04-30):** Migrated from `Object.assign(graph, ...)` factory
 * pattern to `class extends Graph` (Tier R5.1 deferral lifted; mirrors the
 * `MemoryWith*Graph` precedent). `setStrategy` / `pause` / `resume` are now
 * instance methods that read `this.strategy` / `this._pauseState` / `this.status`
 * / `this._iteration` instead of factory-local closures.
 */
export class RefineLoopGraph<T> extends Graph {
	readonly best: Node<T | null>;
	/**
	 * Best score so far. Pseudo-private (`_score`) to avoid colliding with any
	 * future `Graph.prototype.score` method (B5d forward-compat hazard
	 * prevention). Typed-public — read via `loop._score.cache` /
	 * `loop._score.subscribe(...)` from external code.
	 */
	readonly _score: Node<number>;
	readonly status: Node<RefineStatus>;
	readonly history: Node<readonly Iteration<T>[]>;
	readonly strategy: Node<RefineStrategy<T>>;
	/**
	 * Monotonic iteration counter. Pseudo-private (`_iteration`) to avoid
	 * colliding with any future `Graph.prototype.iteration` method (B5d
	 * forward-compat hazard prevention). Typed-public — read via
	 * `loop._iteration.cache` / `loop._iteration.subscribe(...)`.
	 */
	readonly _iteration: Node<number>;
	/** Stage topic — subscribe for per-stage streaming / cursor consumers. */
	readonly generate: TopicGraph<GenerateEvent<T>>;
	/** Stage topic — subscribe for per-stage streaming / cursor consumers. */
	readonly evaluate: TopicGraph<EvaluateEvent<T>>;
	/** Stage topic — subscribe for per-stage streaming / cursor consumers. */
	readonly analyze: TopicGraph<AnalyzeEvent<T>>;
	/** Stage topic — subscribe for per-stage streaming / cursor consumers. */
	readonly decide: TopicGraph<DecideEvent>;

	/** Internal: paused-flag node. Mounted as "paused" in describe(). */
	private readonly _pauseState: Node<boolean>;

	constructor(
		seed: T,
		evaluator: Evaluator<T>,
		initialStrategy: RefineStrategy<T>,
		opts: RefineLoopOptions,
	) {
		const name = opts.name ?? "refine-loop";
		super(name, opts.graph);

		// /qa A2 (2026-04-30): tag the Graph with its constructing factory so
		// `describe()` / `compileSpec` round-trip surfaces provenance — mirrors
		// the `agentMemory` pattern. `seed` / `evaluator` / `initialStrategy`
		// and option fields are non-JSON (functions, strategies); route through
		// `placeholderArgs` (DG2=ii) which substitutes `"<function>"` /
		// `"<Node>"` / `"<unserializable>"` for non-JSON values.
		this.tagFactory(
			"refineLoop",
			placeholderArgs({ seed, evaluator, initialStrategy, ...opts } as unknown as Record<
				string,
				unknown
			>),
		);

		// --- Dataset: auto-wrap arrays into a state node ------------------------
		const datasetNode: Node<readonly DatasetItem[]> = isNode<readonly DatasetItem[]>(opts.dataset)
			? opts.dataset
			: createNode<readonly DatasetItem[]>([], {
					name: "dataset",
					initial: opts.dataset as readonly DatasetItem[],
				});
		this.add(datasetNode, { name: "dataset" });

		// --- State nodes --------------------------------------------------------
		const iterationTrigger = createNode<number>([], { name: "iteration", initial: 0 });
		this.add(iterationTrigger, { name: "iteration" });

		const strategyNode = createNode<RefineStrategy<T>>([], {
			name: "strategy",
			initial: initialStrategy,
			equals: () => false, // always propagate strategy swaps
		});
		this.add(strategyNode, { name: "strategy" });

		const lastFeedbackState = createNode<Feedback | null>([], {
			name: "lastFeedback",
			initial: null,
		});
		this.add(lastFeedbackState, { name: "lastFeedback" });

		const prevCandidatesState = createNode<readonly T[]>([], {
			name: "prevCandidates",
			initial: [],
		});
		this.add(prevCandidatesState, { name: "prevCandidates" });

		const pauseState = createNode<boolean>([], { name: "paused", initial: false });
		this.add(pauseState, { name: "paused" });

		const statusState = createNode<RefineStatus>([], { name: "status", initial: "running" });
		this.add(statusState, { name: "status" });

		const historyState = createNode<readonly Iteration<T>[]>([], {
			name: "history",
			initial: [],
			equals: () => false, // append-style; reactive consumers want every push
		});
		this.add(historyState, { name: "history" });

		const bestState = createNode<T | null>([], { name: "best", initial: null });
		this.add(bestState, { name: "best" });

		const scoreState = createNode<number>([], { name: "score", initial: Number.NEGATIVE_INFINITY });
		this.add(scoreState, { name: "score" });

		// --- Budget counter -----------------------------------------------------
		const budgetState = createNode<number>([], { name: "budget-used", initial: 0 });
		this.add(budgetState, { name: "budget-used" });

		// --- Stage hub (Shape B + C-aspects) ------------------------------------
		// One messagingHub instead of four standalone TopicGraphs. Topics are
		// eagerly created so the public accessors (loop.generate etc.) are
		// available immediately without waiting for the first event to fire.
		// The hub is mounted in this so all stage topics appear under "stages::"
		// in describe()/explain() — visible edges, not closure-held singletons.
		const hub = messagingHub("stages");
		this.mount("stages", hub);
		const hubGenerateTopic = hub.topic<GenerateEvent<T>>("generate");
		const hubEvaluateTopic = hub.topic<EvaluateEvent<T>>("evaluate");
		const hubAnalyzeTopic = hub.topic<AnalyzeEvent<T>>("analyze");
		const hubDecideTopic = hub.topic<DecideEvent>("decide");

		// /qa A1 (2026-04-30): assign the public field surface BEFORE wiring
		// any effect / subscribe activation below. A synchronous strategy can
		// drain the entire GENERATE → EVALUATE → ANALYZE → DECIDE cascade
		// during the constructor body (see strategy doc above); fields must be
		// reachable in case any future subscribe handler dereferences `this.X`
		// during that synchronous drain. Defensive — no current handler reads
		// `this.<field>`, but keeping construction-order safe avoids future
		// undefined-field crashes.
		this.best = bestState as Node<T | null>;
		this._score = scoreState;
		this.status = statusState;
		this.history = historyState;
		this.strategy = strategyNode;
		this._iteration = iterationTrigger;
		this.generate = hubGenerateTopic;
		this.evaluate = hubEvaluateTopic;
		this.analyze = hubAnalyzeTopic;
		this.decide = hubDecideTopic;
		this._pauseState = pauseState;

		// --- Factory-time seed closures (§28) -----------------------------------
		// These mirror the reactive dep values so the generate fn can read them
		// without the multi-dep push-on-subscribe initial-pair drop. Per
		// COMPOSITION-GUIDE-PROTOCOL.md §28: "The closure reads inside the
		// reactive fn are NOT P3 violations — they read a closure variable,
		// not a `.cache`." Subscribe handlers run synchronously on dep DATA,
		// so the closure mirrors are always current by the time the generate
		// fn fires for the next iter.
		let latestStrategy: RefineStrategy<T> = initialStrategy;
		let latestFeedback: Feedback | null = null;
		let latestPrevCandidates: readonly T[] = [];
		this.addDisposer(
			strategyNode.subscribe((msgs) => {
				for (const m of msgs) if (m[0] === DATA) latestStrategy = m[1] as RefineStrategy<T>;
			}),
		);
		this.addDisposer(
			lastFeedbackState.subscribe((msgs) => {
				for (const m of msgs) if (m[0] === DATA) latestFeedback = m[1] as Feedback | null;
			}),
		);
		this.addDisposer(
			prevCandidatesState.subscribe((msgs) => {
				for (const m of msgs) if (m[0] === DATA) latestPrevCandidates = m[1] as readonly T[];
			}),
		);

		// --- GENERATE: iterationTrigger → candidates ----------------------------
		// switchMap cancels any in-flight generate when a new iteration fires.
		// At iteration 0, strategy.seed(seed). At iteration > 0, strategy.generate.
		//
		// Sync strategies emit in the same wave as `iterationTrigger` — no microtask
		// bridge. This eliminates the per-topic iteration race (Edge #5): all four
		// stage effects drain under one wave, so iteration numbers across
		// GENERATE / EVALUATE / ANALYZE / DECIDE are guaranteed identical.
		//
		// Async strategies still cross a Promise boundary — that's the strategy's
		// async-source contract (spec §5.10: async boundaries belong in sources).
		// Cancellation on strategy swap / pause / new iteration uses switchMap's
		// inner-node unsubscribe + a `cancelled` flag so late Promise resolutions
		// don't emit into a torn-down switchMap slot.
		//
		// **/qa D1 (2026-05-01) — envelope shape:** the inner producer emits
		// `{iter, items}` so `iter` rides the data wave through every downstream
		// stage. Eliminates the cross-node `iterationTrigger.cache` P3 violation
		// in `decideEffect` (and the resume-stall failure mode it caused). User-
		// facing evaluator API stays `Node<readonly T[]>` via the
		// `candidatesItemsNode` sidecar derived below.
		const candidatesNode = switchMap<number, CandidatesEnvelope<T>>(
			iterationTrigger,
			(iter) => {
				const strat = latestStrategy;
				const isSeed = iter === 0 || latestFeedback == null;
				return createNode<CandidatesEnvelope<T>>(
					[],
					(_data, actions) => {
						let cancelled = false;
						try {
							const result = isSeed
								? strat.seed(seed)
								: strat.generate(latestFeedback as Feedback, latestPrevCandidates);
							if (result instanceof Promise) {
								result.then(
									(v) => {
										if (!cancelled) actions.emit({ iter, items: v });
									},
									(err) => {
										if (!cancelled) actions.down([[ERROR, err]]);
									},
								);
								return () => {
									cancelled = true;
								};
							}
							actions.emit({ iter, items: result });
						} catch (err) {
							cancelled = true;
							actions.down([[ERROR, err]]);
						}
						return undefined;
					},
					{ describeKind: "producer" },
				);
			},
			{ name: "candidates" },
		);
		this.add(candidatesNode, { name: "candidates" });

		// User-facing items sidecar: preserves the `Evaluator<T>` API
		// (`(candidates: Node<readonly T[]>, dataset: Node<readonly DatasetItem[]>) => ...`)
		// while the internal pipeline reads iter from the envelope.
		const candidatesItemsNode = createNode<readonly T[]>(
			[candidatesNode],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const env = data[0] as CandidatesEnvelope<T> | undefined;
				if (env === undefined) {
					actions.down([[RESOLVED]]);
					return;
				}
				actions.emit(env.items);
			},
			{ name: "candidates-items", describeKind: "derived" },
		);
		this.add(candidatesItemsNode, { name: "candidates-items" });

		// Error watcher — strategy throws surface as ERROR on `candidatesNode`.
		// Promote to `status = "errored"` so callers don't have to subscribe to
		// the error channel directly.
		const errorWatcher = createNode(
			[candidatesNode],
			(_batchData, _actions, ctx) => {
				const terminal = ctx.terminalDeps[0];
				if (terminal !== undefined && terminal !== true) {
					statusState.emit("errored");
				}
			},
			{ name: "error-watcher", describeKind: "effect", errorWhenDepsError: false },
		);
		this.add(errorWatcher, { name: "error-watcher" });
		this.addDisposer(errorWatcher.subscribe(() => undefined));

		// GENERATE stage: three nodes replace one monolithic effect.
		// (1) derived computes the event payload — reactive edge visible in explain().
		// (2) publish effect routes the derived event to the hub topic.
		// (3) mirror effect keeps prevCandidatesState in sync for §28 closure reads.
		// Budget accounting stays in decideEffect (single authority).
		// /qa D1: iter + items both come from the candidates envelope — no
		// separate `iterationTrigger` dep, no cross-node cache reads.
		const generateEventNode = createNode<GenerateEvent<T>>(
			[candidatesNode],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const env = data[0] as CandidatesEnvelope<T>;
				actions.emit({
					iteration: env.iter,
					candidates: env.items,
					timestamp_ns: monotonicNs(),
				});
			},
			{ name: "generate-event", describeKind: "derived" },
		);
		this.add(generateEventNode, { name: "generate-event" });
		this.addDisposer(generateEventNode.subscribe(() => undefined));

		const generatePublishEffect = createNode(
			[generateEventNode],
			(batchData, _actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				hubGenerateTopic.publish(data[0] as GenerateEvent<T>);
			},
			{ name: "generate-publish", describeKind: "effect" },
		);
		this.add(generatePublishEffect, { name: "generate-publish" });
		this.addDisposer(generatePublishEffect.subscribe(() => undefined));

		const generateMirrorEffect = createNode(
			[candidatesNode],
			(batchData, _actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const env = data[0] as CandidatesEnvelope<T>;
				prevCandidatesState.emit(env.items);
			},
			{ name: "generate-mirror", describeKind: "effect" },
		);
		this.add(generateMirrorEffect, { name: "generate-mirror" });
		this.addDisposer(generateMirrorEffect.subscribe(() => undefined));

		// --- EVALUATE: candidates × dataset → scores ----------------------------
		// User evaluator sees the items sidecar (preserves `Evaluator<T>` API).
		const scoresNode = evaluator(candidatesItemsNode, datasetNode);
		this.add(scoresNode, { name: "scores" });

		// EVALUATE stage: derived event node + publish effect.
		// /qa D1: iter from candidates envelope; gate on `scoresFired` so a
		// candidates-only fan-out wave (e.g. async eval still in flight) does
		// NOT publish a stale evaluate event.
		const evaluateEventNode = createNode<EvaluateEvent<T>>(
			[scoresNode, candidatesNode],
			(batchData, actions, ctx) => {
				const scoresFired = batchData[0] != null && batchData[0].length > 0;
				if (!scoresFired) {
					actions.down([[RESOLVED]]);
					return;
				}
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const scores = data[0] as readonly EvalResult[];
				const env = data[1] as CandidatesEnvelope<T>;
				actions.emit({
					iteration: env.iter,
					candidates: env.items,
					scores,
					timestamp_ns: monotonicNs(),
				});
			},
			{ name: "evaluate-event", describeKind: "derived" },
		);
		this.add(evaluateEventNode, { name: "evaluate-event" });
		this.addDisposer(evaluateEventNode.subscribe(() => undefined));

		const evaluatePublishEffect = createNode(
			[evaluateEventNode],
			(batchData, _actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				hubEvaluateTopic.publish(data[0] as EvaluateEvent<T>);
			},
			{ name: "evaluate-publish", describeKind: "effect" },
		);
		this.add(evaluatePublishEffect, { name: "evaluate-publish" });
		this.addDisposer(evaluatePublishEffect.subscribe(() => undefined));

		// --- ANALYZE: strategy.analyze(scores, candidates) → feedbackEnvelope ---
		// /qa D1: feedbackEnvelope is the canonical iter-tagged trigger payload
		// for the DECIDE stage. Gates on `scoresFired` so a candidates-only
		// wave (async eval not settled yet) does NOT emit stale feedback into
		// `decideEffect`. When the user evaluator emits, both deps' caches are
		// consistent (candidates envelope carries iter that matches the scores
		// the user just produced — *assuming the user evaluator cancels async
		// work on candidates change; see Evaluator<T> JSDoc contract*).
		const feedbackEnvelopeNode = createNode<FeedbackEnvelope<T>>(
			[scoresNode, candidatesNode],
			(batchData, actions, ctx) => {
				const scoresFired = batchData[0] != null && batchData[0].length > 0;
				if (!scoresFired) {
					actions.down([[RESOLVED]]);
					return;
				}
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const scores = data[0] as readonly EvalResult[];
				const env = data[1] as CandidatesEnvelope<T>;
				actions.emit({
					iter: env.iter,
					items: env.items,
					scores,
					feedback: latestStrategy.analyze(scores, env.items),
				});
			},
			{ name: "feedback-envelope", describeKind: "derived" },
		);
		this.add(feedbackEnvelopeNode, { name: "feedback-envelope" });

		// User-facing feedback projection sidecar — preserves `feedback` path
		// for observers that consume the bare `Feedback` shape via
		// `loop.observe("feedback")` etc.
		const feedbackNode = createNode<Feedback>(
			[feedbackEnvelopeNode],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const fbEnv = data[0] as FeedbackEnvelope<T>;
				actions.emit(fbEnv.feedback);
			},
			{ name: "feedback", describeKind: "derived" },
		);
		this.add(feedbackNode, { name: "feedback" });

		// ANALYZE stage: derived event node + publish effect.
		// /qa D1: pull iter + items from feedbackEnvelopeNode (single source of
		// truth for the analyze beat). No cross-node cache reads.
		const analyzeEventNode = createNode<AnalyzeEvent<T>>(
			[feedbackEnvelopeNode],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const fbEnv = data[0] as FeedbackEnvelope<T>;
				actions.emit({
					iteration: fbEnv.iter,
					candidates: fbEnv.items,
					feedback: fbEnv.feedback,
					timestamp_ns: monotonicNs(),
				});
			},
			{ name: "analyze-event", describeKind: "derived" },
		);
		this.add(analyzeEventNode, { name: "analyze-event" });
		this.addDisposer(analyzeEventNode.subscribe(() => undefined));

		const analyzePublishEffect = createNode(
			[analyzeEventNode],
			(batchData, _actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				hubAnalyzeTopic.publish(data[0] as AnalyzeEvent<T>);
			},
			{ name: "analyze-publish", describeKind: "effect" },
		);
		this.add(analyzePublishEffect, { name: "analyze-publish" });
		this.addDisposer(analyzePublishEffect.subscribe(() => undefined));

		// --- Convergence: four derived nodes fanning into one boolean -----------
		const patienceNode = createNode<boolean>(
			[historyState],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const h = data[0] as readonly Iteration<T>[];
				if (opts.patience == null || h.length <= opts.patience) {
					actions.emit(false);
					return;
				}
				// No improvement over the last `patience` iterations.
				const lookback = h.slice(-(opts.patience + 1));
				const baseline = lookback[0]!.bestScore;
				actions.emit(lookback.slice(1).every((i) => i.bestScore <= baseline));
			},
			{ name: "patience-check", describeKind: "derived" },
		);
		this.add(patienceNode, { name: "patience-check" });

		const minScoreNode = createNode<boolean>(
			[scoreState],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(opts.minScore != null && (data[0] as number) >= opts.minScore);
			},
			{ name: "min-score-check", describeKind: "derived" },
		);
		this.add(minScoreNode, { name: "min-score-check" });

		const minDeltaNode = createNode<boolean>(
			[historyState],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const h = data[0] as readonly Iteration<T>[];
				if (opts.minDelta == null || h.length < 2) {
					actions.emit(false);
					return;
				}
				const prev = h[h.length - 2]!.bestScore;
				const curr = h[h.length - 1]!.bestScore;
				actions.emit(Math.abs(curr - prev) < opts.minDelta);
			},
			{ name: "min-delta-check", describeKind: "derived" },
		);
		this.add(minDeltaNode, { name: "min-delta-check" });

		const maxEvalsNode = createNode<boolean>(
			[budgetState],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(opts.maxEvaluations != null && (data[0] as number) >= opts.maxEvaluations);
			},
			{ name: "max-evaluations-check", describeKind: "derived" },
		);
		this.add(maxEvalsNode, { name: "max-evaluations-check" });

		const maxIterNode = createNode<boolean>(
			[iterationTrigger],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(opts.maxIterations != null && (data[0] as number) >= opts.maxIterations);
			},
			{ name: "max-iterations-check", describeKind: "derived" },
		);
		this.add(maxIterNode, { name: "max-iterations-check" });

		const budgetExhaustedNode = createNode<boolean>(
			[budgetState],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(opts.budget != null && (data[0] as number) >= opts.budget);
			},
			{ name: "budget-exhausted-check", describeKind: "derived" },
		);
		this.add(budgetExhaustedNode, { name: "budget-exhausted-check" });

		// Activate convergence derivations so their cache stays current — decideEffect
		// reads their cache via external-boundary reads (§28). They must NOT be direct
		// deps: that would create a feedback cycle (decideEffect writes history/score,
		// convergence derives from those, cycle).
		this.addDisposer(patienceNode.subscribe(() => undefined));
		this.addDisposer(minScoreNode.subscribe(() => undefined));
		this.addDisposer(minDeltaNode.subscribe(() => undefined));
		this.addDisposer(maxEvalsNode.subscribe(() => undefined));
		this.addDisposer(maxIterNode.subscribe(() => undefined));
		this.addDisposer(budgetExhaustedNode.subscribe(() => undefined));

		const convergedNode = createNode<{ converged: boolean; reason?: string }>(
			[patienceNode, minScoreNode, minDeltaNode, maxEvalsNode, maxIterNode],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const [p, ms, md, me, mi] = data;
				if (p) {
					actions.emit({ converged: true, reason: "patience" });
					return;
				}
				if (ms) {
					actions.emit({ converged: true, reason: "min-score" });
					return;
				}
				if (md) {
					actions.emit({ converged: true, reason: "min-delta" });
					return;
				}
				if (me) {
					actions.emit({ converged: true, reason: "max-evaluations" });
					return;
				}
				if (mi) {
					actions.emit({ converged: true, reason: "max-iterations" });
					return;
				}
				actions.emit({ converged: false });
			},
			{ name: "converged", describeKind: "derived" },
		);
		this.add(convergedNode, { name: "converged" });
		this.addDisposer(convergedNode.subscribe(() => undefined));

		// --- DECIDE: feedbackEnvelope settles → fire next iteration OR terminate ---
		// **/qa D1 (2026-05-01) — reactive form via §32 envelope + sole-owner
		// `.cache` reads + reactive `pauseState` dep.** Two patterns at play:
		//
		// - **`iter` rides with the feedbackEnvelope payload** (§32 envelope).
		//   Eliminates the original `iterationTrigger.cache` cross-node read
		//   that caused the resume-stall (where iter.cache was bumped past
		//   the candidates batch we're processing).
		//
		// - **`historyState` / `budgetState` are read via `.cache`** as a
		//   sole-owner pattern: decideEffect is the SOLE WRITER + sole
		//   reactive READER, both declared in the same enclosing constructor
		//   scope. Reading their `.cache` here is "read your own scratchpad"
		//   semantically, even though they're sibling Node objects. Adding
		//   them as direct deps would create the §7 self-feedback cycle
		//   (decideEffect writes them, would re-trigger itself); closure
		//   mirrors would just duplicate state already held in the nodes
		//   themselves. The comment block belongs to /qa D1 follow-up
		//   (2026-05-01) — explicit user lock that sole-owner-and-reader
		//   nodes in the same enclosing scope are a sanctioned `.cache` read
		//   form.
		//
		// - **`pauseState` is a direct dep** because it's an EXTERNAL CONTROL
		//   INPUT — written by `pause()` / `resume()` imperative methods at
		//   the user-call boundary, NOT by decideEffect. Making it a real
		//   declared edge surfaces "this decision considers pause state" in
		//   `describe()` / `explain()` topology. The `feedbackFired` gate
		//   below skips fn body execution when only pauseState fired (no new
		//   iteration to decide).
		//
		// Trigger semantics: feedbackEnvelopeNode itself only fires when the
		// user evaluator emits fresh scores (gate via `batchData[scoresIdx]`
		// in feedbackEnvelopeNode), so a candidates-only fan-out wave (async
		// eval still in flight after `resume()`) does NOT spuriously trigger
		// decideEffect.
		//
		// **Score-staleness contract:** if the user's `Evaluator<T>` does NOT
		// cancel its async work when `candidates` changes, late scores from a
		// prior iter can emit to scoresNode and trip feedbackEnvelopeNode +
		// decideEffect with the new candidates' iter tag but stale scores
		// data. See `Evaluator<T>` JSDoc (cancel-on-input contract) and
		// `optimizations.md` "refineLoop async-evaluator stale-scores
		// follow-up" for the wrapper proposal.
		//
		// Track last-decided iteration to avoid re-deciding when feedbackEnv
		// re-fires within one wave (e.g. async evaluator emits multiple
		// scores per candidates change).
		let lastDecidedIteration = -1;
		const decideEffect = createNode(
			[feedbackEnvelopeNode, pauseState],
			(batchData, _actions, ctx) => {
				// `pauseState` is declared dep #1 — gate skips fn body when
				// only pauseState fired (no new iteration to decide; we just
				// want pauseState's prevData to advance for the next feedback
				// fire).
				const feedbackFired = batchData[0] != null && batchData[0].length > 0;
				if (!feedbackFired) return;

				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const fbEnv = data[0] as FeedbackEnvelope<T>;
				const paused = data[1] as boolean;

				const i = fbEnv.iter;
				const fb = fbEnv.feedback;
				const cs = fbEnv.items;
				const scores = fbEnv.scores;

				// De-dup: only run once per iteration. fn may fire multiple
				// times per wave as feedbackEnvelopeNode settles.
				if (i <= lastDecidedIteration) return;
				lastDecidedIteration = i;

				// Sole-owner `.cache` reads — decideEffect is the SOLE
				// writer and sole reactive reader of these state nodes.
				const currentHistory = historyState.cache as readonly Iteration<T>[];
				const currentBudget = budgetState.cache as number;

				// Compute next history / score.
				const { best, bestScore } = pickBest(cs, scores);
				const iteration: Iteration<T> = {
					n: i,
					candidates: cs,
					scores,
					feedback: fb,
					best,
					bestScore,
					timestamp_ns: monotonicNs(),
				};
				const nextHistory = [...currentHistory, iteration];
				// Budget accounting — decideEffect is the single authority.
				const nextBudget = currentBudget + cs.length;

				// Inline convergence checks — single source of truth. The derived
				// `convergedNode` + friends exist for describe()/observe() surface;
				// inlining here avoids a drain-round-trip deadlock where decideEffect
				// would need convergedNode.cache to update before running, but
				// convergedNode needs historyState.emit from inside decideEffect.
				let decision: DecideEvent["decision"] = "continue";
				let reason: string | undefined;
				const budgetOut = opts.budget != null && nextBudget >= opts.budget;
				if (budgetOut) {
					decision = "budget";
					reason = "budget";
				} else if (opts.minScore != null && fb.score >= opts.minScore) {
					decision = "converged";
					reason = "min-score";
				} else if (opts.maxIterations != null && i >= opts.maxIterations) {
					decision = "converged";
					reason = "max-iterations";
				} else if (opts.maxEvaluations != null && nextBudget >= opts.maxEvaluations) {
					decision = "converged";
					reason = "max-evaluations";
				} else if (opts.minDelta != null && nextHistory.length >= 2) {
					const prev = nextHistory[nextHistory.length - 2]!.bestScore;
					const curr = nextHistory[nextHistory.length - 1]!.bestScore;
					if (Math.abs(curr - prev) < opts.minDelta) {
						decision = "converged";
						reason = "min-delta";
					}
				} else if (opts.patience != null && nextHistory.length > opts.patience) {
					const lookback = nextHistory.slice(-(opts.patience + 1));
					const baseline = lookback[0]!.bestScore;
					if (lookback.slice(1).every((it) => it.bestScore <= baseline)) {
						decision = "converged";
						reason = "patience";
					}
				}
				// paused takes precedence over continue — if paused AND no convergence,
				// we pause. Otherwise if converged we stop for real.
				if (decision === "continue" && paused) {
					decision = "paused";
				}

				// All emissions in one batch — drain order is feedback mirror first
				// (§32), then iterationTrigger, so the next generate sees fresh fb.
				// `lastFeedbackState` is always mirrored (regardless of decision) so
				// resume-after-pause gets current feedback; only `iterationTrigger`
				// is gated on `continue`.
				batch(() => {
					bestState.emit(best);
					scoreState.emit(fb.score);
					historyState.emit(nextHistory);
					budgetState.emit(nextBudget);
					lastFeedbackState.emit(fb);
					hubDecideTopic.publish({
						iteration: i,
						decision,
						reason,
						timestamp_ns: monotonicNs(),
					});

					if (decision === "continue") {
						iterationTrigger.emit(i + 1);
					} else {
						statusState.emit(
							decision === "converged" ? "converged" : decision === "budget" ? "budget" : "paused",
						);
					}
				});
			},
			{ name: "decide-bridge", describeKind: "effect" },
		);
		this.add(decideEffect, { name: "decide-bridge" });
		this.addDisposer(decideEffect.subscribe(() => undefined));

		// /qa A1 (2026-04-30): public field surface (best / score / status /
		// history / strategy / iteration / generate / evaluate / analyze /
		// decide / _pauseState) is assigned EARLIER, immediately after the
		// stage hub is mounted (search "qa A1" above). Doing the assignment
		// before any subscribe activation keeps `this.<field>` reachable
		// during a synchronous strategy drain.
	}

	/** Swap the active strategy mid-run (human-in-the-loop handoff). */
	setStrategy(next: RefineStrategy<T>): void {
		this.strategy.emit(next);
	}

	/** Pause after the current iteration completes. */
	pause(): void {
		this._pauseState.emit(true);
	}

	/**
	 * Resume a paused loop. Idempotent: only un-pauses from the "paused"
	 * terminal state. Converged / budget / errored are permanent — a user
	 * wanting to start over should construct a fresh refineLoop.
	 */
	resume(): void {
		if (this.status.cache !== "paused") return;
		batch(() => {
			this._pauseState.emit(false);
			this.status.emit("running" as RefineStatus);
			this._iteration.emit((this._iteration.cache as number) + 1);
		});
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Structural type-guard for `Node<T>`. Checks the three core Node methods
 * (`subscribe`, `down`, `emit`) as callable properties — rejects plain objects
 * with a single `subscribe` field that happen to look like a Node but aren't.
 */
function isNode<T>(x: unknown): x is Node<T> {
	if (typeof x !== "object" || x === null) return false;
	const obj = x as Record<string, unknown>;
	return (
		typeof obj.subscribe === "function" &&
		typeof obj.down === "function" &&
		typeof obj.emit === "function"
	);
}

function pickBest<T>(
	candidates: readonly T[],
	scores: readonly EvalResult[],
): { best: T | null; bestScore: number } {
	// Empty batch → no best. Use `null` per COMPOSITION-GUIDE §3: `undefined`
	// is the protocol SENTINEL, `null` is the domain sentinel for "no value".
	if (candidates.length === 0) {
		return { best: null, bestScore: Number.NEGATIVE_INFINITY };
	}
	if (candidates.length === 1) {
		const mean = meanScore(scores);
		return { best: candidates[0]!, bestScore: mean };
	}
	// Fan-out aware: when any score carries `candidateIndex`, aggregate mean
	// score per candidate. When absent, fall back to positional `scores[i]` ↔
	// `candidates[i]` alignment (one-score-per-candidate convention).
	const hasFanOut = scores.some((s) => typeof s.candidateIndex === "number");
	if (hasFanOut) {
		const sums = new Array<{ sum: number; count: number }>(candidates.length);
		for (let i = 0; i < candidates.length; i++) sums[i] = { sum: 0, count: 0 };
		for (const s of scores) {
			const idx = s.candidateIndex;
			if (typeof idx === "number" && idx >= 0 && idx < candidates.length) {
				sums[idx]!.sum += s.score;
				sums[idx]!.count += 1;
			}
		}
		let best = candidates[0]!;
		let bestScore = sums[0]!.count > 0 ? sums[0]!.sum / sums[0]!.count : Number.NEGATIVE_INFINITY;
		for (let i = 1; i < candidates.length; i++) {
			const avg = sums[i]!.count > 0 ? sums[i]!.sum / sums[i]!.count : Number.NEGATIVE_INFINITY;
			if (avg > bestScore) {
				bestScore = avg;
				best = candidates[i]!;
			}
		}
		return { best, bestScore };
	}
	let best = candidates[0]!;
	let bestScore = scores[0]?.score ?? Number.NEGATIVE_INFINITY;
	for (let i = 1; i < candidates.length; i++) {
		const s = scores[i]?.score ?? Number.NEGATIVE_INFINITY;
		if (s > bestScore) {
			bestScore = s;
			best = candidates[i]!;
		}
	}
	return { best, bestScore };
}

function meanScore(scores: readonly EvalResult[]): number {
	if (scores.length === 0) return Number.NEGATIVE_INFINITY;
	let sum = 0;
	for (const s of scores) sum += s.score;
	return sum / scores.length;
}

// ---------------------------------------------------------------------------
// refineLoop factory
// ---------------------------------------------------------------------------

/**
 * Construct a {@link RefineLoopGraph} — the universal prompt/artifact
 * optimization loop. Thin wrapper over `new RefineLoopGraph(...)` for
 * call-site ergonomics.
 */
export function refineLoop<T>(
	seed: T,
	evaluator: Evaluator<T>,
	initialStrategy: RefineStrategy<T>,
	opts: RefineLoopOptions,
): RefineLoopGraph<T> {
	return new RefineLoopGraph<T>(seed, evaluator, initialStrategy, opts);
}

// ---------------------------------------------------------------------------
// Built-in strategy: blindVariation
// ---------------------------------------------------------------------------

/**
 * Context passed to a `blindVariation` teacher per call. `reportCost` is a
 * per-call hook — see `BlindVariationOptions.tokens`.
 */
export interface BlindVariationContext<T> {
	readonly prior: T;
	/**
	 * Report tokens consumed by this teacher call. Aggregated per iteration
	 * and flushed to `opts.tokens` in the strategy's `finally` block so
	 * partial spend is preserved when the teacher throws mid-batch.
	 */
	readonly reportCost: (tokens: number) => void;
}

export interface BlindVariationOptions<T> {
	/** Name — default: `"blindVariation"`. */
	name?: string;
	/** Number of candidates generated per iteration. Default: 4. */
	width?: number;
	/**
	 * Run teacher calls in parallel via `Promise.all`. Default `true` — the
	 * common case (independent LLM calls). Set `false` to run sequentially
	 * via `for/await` when teachers share stateful resources (rate limiters,
	 * rolling context, serial API ordering) that don't tolerate concurrency.
	 */
	parallel?: boolean;
	/**
	 * Optional cost counter node. Running total tokens reported via
	 * `ctx.reportCost` during each iteration is added to this node in the
	 * strategy's `finally` block — fires on success AND on teacher throw so
	 * partial spend is never lost. User owns the node; wire to `budgetGate`,
	 * `attachSnapshotStorage`, telemetry, etc.
	 */
	tokens?: Node<number>;
	/**
	 * Teacher — given `{prior, reportCost}`, produce one variant. Async
	 * allowed. Called `width` times per iteration. Call `ctx.reportCost(n)`
	 * to track tokens consumed per call (optional, no-op if `opts.tokens`
	 * is not set).
	 */
	teacher: (ctx: BlindVariationContext<T>) => Promise<T> | T;
}

/**
 * Simplest built-in strategy: generate N variants per iteration via the
 * supplied `teacher`; no feedback-informed steering (equivalent to Random
 * Search). Validates the loop infrastructure end-to-end and is the baseline
 * every other strategy should outperform.
 *
 * `analyze` records the mean score and flags the worst task — strategies that
 * care about per-task critique layer on top.
 */
export function blindVariation<T>(opts: BlindVariationOptions<T>): RefineStrategy<T> {
	const width = opts.width ?? 4;
	const name = opts.name ?? "blindVariation";
	return {
		name,
		seed(seed) {
			// Iteration 0 emits just the seed — strategy.seed is synchronous by
			// contract, so we can't call an async teacher here. `width`-many
			// teacher-produced variants begin at iteration 1 via `generate`.
			return [seed];
		},
		analyze(scores, _candidates) {
			const score = meanScore(scores);
			let worst: EvalResult | null = null;
			for (const s of scores) {
				if (!worst || s.score < worst.score) worst = s;
			}
			return {
				summary: `blindVariation iteration: mean=${score.toFixed(3)}, n=${scores.length}`,
				score,
				weakTasks: worst ? [worst.taskId] : [],
			};
		},
		async generate(_feedback, candidates) {
			if (candidates.length === 0) {
				// Empty candidate batch is a contract violation — either the
				// seed was empty or a previous generate returned nothing. Surface
				// as an error rather than silently returning [] (which would
				// stall the loop in an infinite zero-candidate cycle).
				throw new Error(
					"blindVariation.generate: empty candidate batch — cannot derive prior for teacher",
				);
			}
			// Pick the current "recent best" — `null` IS a valid domain value
			// per COMPOSITION-GUIDE §3; the length guard above has already
			// filtered the `undefined` protocol sentinel.
			const prior = candidates[candidates.length - 1] as T;
			let iterCost = 0;
			const reportCost = (n: number) => {
				iterCost += n;
			};
			const ctx: BlindVariationContext<T> = { prior, reportCost };
			try {
				if (opts.parallel !== false) {
					return await Promise.all(Array.from({ length: width }, () => opts.teacher(ctx)));
				}
				const out: T[] = [];
				for (let i = 0; i < width; i++) {
					out.push(await opts.teacher(ctx));
				}
				return out;
			} finally {
				if (opts.tokens != null && iterCost > 0) {
					// /qa D1 follow-up (2026-05-01): replaced direct `.cache` read
					// + emit with `tryIncrementBounded`, which encapsulates the
					// self-owned-counter `.cache` access in the canonical helper
					// (sole sanctioned site per its JSDoc). Cap is unbounded for
					// the token meter.
					tryIncrementBounded(opts.tokens, Number.MAX_SAFE_INTEGER, iterCost);
				}
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Built-in strategy: errorCritique
// ---------------------------------------------------------------------------

/**
 * Context passed to an `errorCritique` teacher. `critique` is the pre-formatted
 * summary a prompt template can drop in verbatim; `failures` carries the
 * structured evidence (per-task error / score / detail) for richer prompts.
 */
export interface ErrorCritiqueContext<T> {
	readonly prior: T;
	readonly critique: string;
	readonly failures: readonly EvalResult[];
	/**
	 * Report tokens consumed by this teacher call. Aggregated per iteration
	 * and flushed to `opts.tokens` in the strategy's `finally` block so
	 * partial spend is preserved when the teacher throws mid-batch.
	 */
	readonly reportCost: (tokens: number) => void;
}

export interface ErrorCritiqueOptions<T> {
	/** Name — default: `"errorCritique"`. */
	name?: string;
	/** Number of candidates generated per iteration. Default: 4. */
	width?: number;
	/**
	 * Cut-off below which a task is classified as a failure and fed into the
	 * critique. Default: the batch mean — any task scoring below the batch
	 * mean is a failure. Pass a number for an absolute cut-off, or a function
	 * for per-batch computation (e.g. a percentile). When the default mean
	 * is non-finite (NaN / ±Infinity from a degenerate evaluator), ALL scores
	 * are treated as failures so the critique loop continues to steer.
	 */
	failureThreshold?: number | ((scores: readonly EvalResult[]) => number);
	/** Cap on failure samples packed into the critique. Default: 5. */
	maxFailureSamples?: number;
	/**
	 * Format failures into the `critique` string passed to the teacher. Default
	 * joins `- taskId (score=N) | error: …` lines. Override to shape LLM prompts.
	 *
	 * **Note:** the `feedback` argument is a shell with `{score, weakTasks}`
	 * populated; `summary` is empty because `analyze` computes the final summary
	 * AFTER `formatCritique` runs (the summary embeds the formatted count).
	 * Rely on `failures` and `feedback.score` — do not read `feedback.summary`
	 * here.
	 */
	formatCritique?: (failures: readonly EvalResult[], feedback: Feedback) => string;
	/**
	 * Run teacher calls in parallel via `Promise.all`. Default `true` — the
	 * common case (independent LLM calls). Set `false` to run sequentially
	 * via `for/await` when teachers share stateful resources (rate limiters,
	 * rolling context, serial API ordering) that don't tolerate concurrency.
	 */
	parallel?: boolean;
	/**
	 * Optional cost counter node. Running total tokens reported via
	 * `ctx.reportCost` during each iteration is added to this node in the
	 * strategy's `finally` block — fires on success AND on teacher throw so
	 * partial spend is never lost. User owns the node; wire to `budgetGate`,
	 * `attachSnapshotStorage`, telemetry, etc.
	 */
	tokens?: Node<number>;
	/**
	 * Teacher — given `{prior, critique, failures, reportCost}`, produce one
	 * refined variant. Called `width` times per iteration. Async allowed.
	 * Call `ctx.reportCost(n)` to track tokens consumed per call (optional,
	 * no-op if `opts.tokens` is not set).
	 */
	teacher: (ctx: ErrorCritiqueContext<T>) => Promise<T> | T;
}

/**
 * Private payload stashed inside `Feedback.critique` so `generate` can recover
 * the analyze-time prior + failure set without another pass over scores.
 */
interface ErrorCritiquePrivate<T> {
	readonly kind: "errorCritique";
	readonly best: T | null;
	readonly failures: readonly EvalResult[];
	readonly critiqueText: string;
}

function isErrorCritiquePrivate<T>(v: unknown): v is ErrorCritiquePrivate<T> {
	return typeof v === "object" && v !== null && (v as { kind?: unknown }).kind === "errorCritique";
}

function defaultFormatCritique(failures: readonly EvalResult[], feedback: Feedback): string {
	if (failures.length === 0) {
		return `No task scored below the batch mean (${feedback.score.toFixed(3)}). Reinforce the current direction.`;
	}
	const lines = failures.map((f) => {
		const err = f.error != null ? ` | error: ${f.error}` : "";
		return `- ${f.taskId} (score=${f.score.toFixed(3)})${err}`;
	});
	return `Failures below threshold:\n${lines.join("\n")}`;
}

/**
 * Critique-driven strategy (ProTeGi-style "textual gradient"). Each iteration:
 *   1. `analyze` classifies tasks scoring below a threshold as failures, picks
 *      the best candidate from the batch, and packs both plus a formatted
 *      critique string into `feedback.critique` as a private payload.
 *   2. `generate` unpacks that payload and calls the teacher with
 *      `{prior, critique, failures, reportCost}` `width` times, returning the
 *      refined batch.
 *
 * The teacher receives a pre-formatted string (drop into an LLM prompt) AND
 * the structured failure list (for richer prompts that want per-task detail).
 * Throws on empty candidate batches — matches `blindVariation`'s contract
 * (no silent zero-candidate cycles).
 *
 * When `setStrategy()` swaps this strategy in mid-run, the first `generate`
 * may receive a `Feedback` produced by the prior strategy (no private payload);
 * the fallback path uses `candidates[last]` as the prior and the feedback
 * summary as the critique, so the loop keeps running without a stall. When a
 * private payload IS present, `priv.critiqueText` takes precedence over any
 * edits a caller made to `feedback.summary` — treat `critique` as the
 * strategy-owned channel.
 */
export function errorCritique<T>(opts: ErrorCritiqueOptions<T>): RefineStrategy<T> {
	const width = opts.width ?? 4;
	const name = opts.name ?? "errorCritique";
	const maxFailureSamples = opts.maxFailureSamples ?? 5;
	const format = opts.formatCritique ?? defaultFormatCritique;

	return {
		name,
		seed(seed) {
			// Iteration 0 emits just the seed. The critique loop begins at
			// iteration 1, once real scores exist to derive failures from.
			return [seed];
		},
		analyze(scores, candidates) {
			const score = meanScore(scores);
			const userThreshold =
				typeof opts.failureThreshold === "function"
					? opts.failureThreshold(scores)
					: opts.failureThreshold;
			// A1: when the user didn't supply a threshold AND the batch-mean
			// default is non-finite (e.g. evaluator produced NaN / ±Infinity),
			// treat every score as a failure instead of filtering with `< NaN`
			// (which would be false for every score → silent no-op).
			const thresholdUnresolvable = userThreshold === undefined && !Number.isFinite(score);
			const threshold = userThreshold ?? score;
			const allFailures = thresholdUnresolvable
				? [...scores].sort((a, b) => a.score - b.score)
				: scores
						.filter((s) => s.score < threshold)
						.slice()
						.sort((a, b) => a.score - b.score);
			const failures = allFailures.slice(0, maxFailureSamples);

			const { best, bestScore } = pickBest(candidates, scores);
			const feedbackShell: Feedback = {
				summary: "",
				score,
				weakTasks: failures.map((f) => f.taskId),
			};
			const critiqueText = format(failures, feedbackShell);

			const priv: ErrorCritiquePrivate<T> = {
				kind: "errorCritique",
				best,
				failures,
				critiqueText,
			};
			const retainedSuffix =
				allFailures.length > failures.length ? ` (top ${failures.length} retained)` : "";
			return {
				summary: `errorCritique iteration: mean=${score.toFixed(3)}, failures=${allFailures.length}${retainedSuffix}/${scores.length}, bestScore=${bestScore.toFixed(3)}`,
				critique: priv,
				weakTasks: failures.map((f) => f.taskId),
				score,
			};
		},
		async generate(feedback, candidates) {
			// N1: Length guard FIRST. The only protocol-sentinel risk is
			// `undefined` sneaking in via an empty candidates array; after
			// this check, `null` values (including `priv.best === null` when
			// T admits null) flow through as domain-valid per
			// COMPOSITION-GUIDE §3 / spec §1.
			if (candidates.length === 0) {
				throw new Error(
					"errorCritique.generate: empty candidate batch — cannot derive prior for teacher",
				);
			}
			const priv = isErrorCritiquePrivate<T>(feedback.critique) ? feedback.critique : undefined;
			const prior: T =
				priv !== undefined ? (priv.best as T) : (candidates[candidates.length - 1] as T);
			const critique = priv?.critiqueText ?? feedback.summary;
			const failures = priv?.failures ?? [];
			let iterCost = 0;
			const reportCost = (n: number) => {
				iterCost += n;
			};
			const ctx: ErrorCritiqueContext<T> = { prior, critique, failures, reportCost };
			try {
				if (opts.parallel !== false) {
					return await Promise.all(Array.from({ length: width }, () => opts.teacher(ctx)));
				}
				const out: T[] = [];
				for (let i = 0; i < width; i++) {
					out.push(await opts.teacher(ctx));
				}
				return out;
			} finally {
				if (opts.tokens != null && iterCost > 0) {
					// /qa D1 follow-up (2026-05-01): replaced direct `.cache` read
					// + emit with `tryIncrementBounded`, which encapsulates the
					// self-owned-counter `.cache` access in the canonical helper.
					tryIncrementBounded(opts.tokens, Number.MAX_SAFE_INTEGER, iterCost);
				}
			}
		},
	};
}
