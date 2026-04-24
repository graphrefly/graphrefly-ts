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
 *  - §27 attachStorage: the whole graph is checkpointable — pause overnight,
 *    resume tomorrow from the exact iteration count, candidate set, strategy.
 *
 * Scope clamp (v1): core factory + `RefineStrategy<T>` + `blindVariation` and
 * `errorCritique` built-ins + budget gating + checkpoint/resume.
 * `mutateAndRefine` / registry / `autoSelectStrategy` / `optimizeCatalog` /
 * `refineExecutor` are deferred.
 *
 * @module
 */

import { batch } from "../../core/batch.js";
import { monotonicNs } from "../../core/clock.js";
import { DATA, ERROR } from "../../core/messages.js";
import { type Node, node } from "../../core/node.js";
import { derived, effect, state } from "../../core/sugar.js";
import { switchMap } from "../../extra/operators.js";
import type { NodeInput } from "../../extra/sources.js";
import { Graph, type GraphOptions } from "../../graph/graph.js";
import { messagingHub, type TopicGraph } from "../messaging/index.js";

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
 * Return type — extends Graph so all observability tools (`describe`,
 * `explain`, `observe`, `attachStorage`, `snapshot`) Just Work.
 */
export interface RefineLoopGraph<T> extends Graph {
	readonly best: Node<T | null>;
	readonly score: Node<number>;
	readonly status: Node<RefineStatus>;
	readonly history: Node<readonly Iteration<T>[]>;
	readonly strategy: Node<RefineStrategy<T>>;
	readonly iteration: Node<number>;
	/** Stage topics — subscribe for per-stage streaming / cursor consumers. */
	readonly generate: TopicGraph<GenerateEvent<T>>;
	readonly evaluate: TopicGraph<EvaluateEvent<T>>;
	readonly analyze: TopicGraph<AnalyzeEvent<T>>;
	readonly decide: TopicGraph<DecideEvent>;
	/** Swap the active strategy mid-run (human-in-the-loop handoff). */
	setStrategy(next: RefineStrategy<T>): void;
	/** Pause after the current iteration completes. */
	pause(): void;
	/** Resume a paused loop. */
	resume(): void;
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

export function refineLoop<T>(
	seed: T,
	evaluator: Evaluator<T>,
	initialStrategy: RefineStrategy<T>,
	opts: RefineLoopOptions,
): RefineLoopGraph<T> {
	const name = opts.name ?? "refine-loop";
	const g = new Graph(name, opts.graph);

	// --- Dataset: auto-wrap arrays into a state node ------------------------
	const datasetNode: Node<readonly DatasetItem[]> = isNode<readonly DatasetItem[]>(opts.dataset)
		? opts.dataset
		: state<readonly DatasetItem[]>(opts.dataset as readonly DatasetItem[], { name: "dataset" });
	g.add(datasetNode, { name: "dataset" });

	// --- State nodes --------------------------------------------------------
	const iterationTrigger = state<number>(0, { name: "iteration" });
	g.add(iterationTrigger, { name: "iteration" });

	const strategyNode = state<RefineStrategy<T>>(initialStrategy, {
		name: "strategy",
		equals: () => false, // always propagate strategy swaps
	});
	g.add(strategyNode, { name: "strategy" });

	const lastFeedbackState = state<Feedback | null>(null, { name: "lastFeedback" });
	g.add(lastFeedbackState, { name: "lastFeedback" });

	const prevCandidatesState = state<readonly T[]>([], { name: "prevCandidates" });
	g.add(prevCandidatesState, { name: "prevCandidates" });

	const pauseState = state<boolean>(false, { name: "paused" });
	g.add(pauseState, { name: "paused" });

	const statusState = state<RefineStatus>("running", { name: "status" });
	g.add(statusState, { name: "status" });

	const historyState = state<readonly Iteration<T>[]>([], {
		name: "history",
		equals: () => false, // append-style; reactive consumers want every push
	});
	g.add(historyState, { name: "history" });

	const bestState = state<T | null>(null, { name: "best" });
	g.add(bestState, { name: "best" });

	const scoreState = state<number>(Number.NEGATIVE_INFINITY, { name: "score" });
	g.add(scoreState, { name: "score" });

	// --- Budget counter -----------------------------------------------------
	const budgetState = state<number>(0, { name: "budget-used" });
	g.add(budgetState, { name: "budget-used" });

	// --- Stage hub (Shape B + C-aspects) ------------------------------------
	// One messagingHub instead of four standalone TopicGraphs. Topics are
	// eagerly created so the public accessors (loop.generate etc.) are
	// available immediately without waiting for the first event to fire.
	// The hub is mounted in g so all stage topics appear under "stages::"
	// in describe()/explain() — visible edges, not closure-held singletons.
	const hub = messagingHub("stages");
	g.mount("stages", hub);
	const hubGenerateTopic = hub.topic<GenerateEvent<T>>("generate");
	const hubEvaluateTopic = hub.topic<EvaluateEvent<T>>("evaluate");
	const hubAnalyzeTopic = hub.topic<AnalyzeEvent<T>>("analyze");
	const hubDecideTopic = hub.topic<DecideEvent>("decide");

	// --- Factory-time seed closures (§28) -----------------------------------
	// These mirror the reactive dep values so the generate fn can read them
	// without the multi-dep push-on-subscribe initial-pair drop.
	let latestStrategy: RefineStrategy<T> = initialStrategy;
	let latestFeedback: Feedback | null = null;
	let latestPrevCandidates: readonly T[] = [];
	g.addDisposer(
		strategyNode.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) latestStrategy = m[1] as RefineStrategy<T>;
		}),
	);
	g.addDisposer(
		lastFeedbackState.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) latestFeedback = m[1] as Feedback | null;
		}),
	);
	g.addDisposer(
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
	const candidatesNode = switchMap<number, readonly T[]>(
		iterationTrigger,
		(iter) => {
			const strat = latestStrategy;
			const isSeed = iter === 0 || latestFeedback == null;
			return node<readonly T[]>(
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
									if (!cancelled) actions.emit(v);
								},
								(err) => {
									if (!cancelled) actions.down([[ERROR, err]]);
								},
							);
							return () => {
								cancelled = true;
							};
						}
						actions.emit(result);
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
	g.add(candidatesNode, { name: "candidates" });

	// Error watcher — strategy throws surface as ERROR on `candidatesNode`.
	// Promote to `status = "errored"` so callers don't have to subscribe to
	// the error channel directly.
	const errorWatcher = effect(
		[candidatesNode],
		(_data, _actions, ctx) => {
			const terminal = ctx.terminalDeps[0];
			if (terminal !== undefined && terminal !== true) {
				statusState.emit("errored");
			}
		},
		{ name: "error-watcher", errorWhenDepsError: false },
	);
	g.add(errorWatcher, { name: "error-watcher" });
	g.addDisposer(errorWatcher.subscribe(() => undefined));

	// GENERATE stage: three nodes replace one monolithic effect.
	// (1) derived computes the event payload — reactive edge visible in explain().
	// (2) publish effect routes the derived event to the hub topic.
	// (3) mirror effect keeps prevCandidatesState in sync for §28 closure reads.
	// Budget accounting stays in decideEffect (single authority).
	const generateEventNode = derived<GenerateEvent<T>>(
		[candidatesNode, iterationTrigger],
		([candidates, iter]) => ({
			iteration: iter as number,
			candidates: candidates as readonly T[],
			timestamp_ns: monotonicNs(),
		}),
		{ name: "generate-event" },
	);
	g.add(generateEventNode, { name: "generate-event" });
	g.addDisposer(generateEventNode.subscribe(() => undefined));

	const generatePublishEffect = effect(
		[generateEventNode],
		([evt]) => {
			hubGenerateTopic.publish(evt as GenerateEvent<T>);
		},
		{ name: "generate-publish" },
	);
	g.add(generatePublishEffect, { name: "generate-publish" });
	g.addDisposer(generatePublishEffect.subscribe(() => undefined));

	const generateMirrorEffect = effect(
		[candidatesNode],
		([cs]) => {
			prevCandidatesState.emit(cs as readonly T[]);
		},
		{ name: "generate-mirror" },
	);
	g.add(generateMirrorEffect, { name: "generate-mirror" });
	g.addDisposer(generateMirrorEffect.subscribe(() => undefined));

	// --- EVALUATE: candidates × dataset → scores ----------------------------
	const scoresNode = evaluator(candidatesNode, datasetNode);
	g.add(scoresNode, { name: "scores" });

	// EVALUATE stage: derived event node + publish effect.
	const evaluateEventNode = derived<EvaluateEvent<T>>(
		[scoresNode, candidatesNode, iterationTrigger],
		([scores, candidates, iter]) => ({
			iteration: iter as number,
			candidates: candidates as readonly T[],
			scores: scores as readonly EvalResult[],
			timestamp_ns: monotonicNs(),
		}),
		{ name: "evaluate-event" },
	);
	g.add(evaluateEventNode, { name: "evaluate-event" });
	g.addDisposer(evaluateEventNode.subscribe(() => undefined));

	const evaluatePublishEffect = effect(
		[evaluateEventNode],
		([evt]) => {
			hubEvaluateTopic.publish(evt as EvaluateEvent<T>);
		},
		{ name: "evaluate-publish" },
	);
	g.add(evaluatePublishEffect, { name: "evaluate-publish" });
	g.addDisposer(evaluatePublishEffect.subscribe(() => undefined));

	// --- ANALYZE: strategy.analyze(scores, candidates) → feedback -----------
	const feedbackNode = derived<Feedback>(
		[scoresNode, candidatesNode],
		([scores, candidates]) => {
			return latestStrategy.analyze(scores as readonly EvalResult[], candidates as readonly T[]);
		},
		{ name: "feedback" },
	);
	g.add(feedbackNode, { name: "feedback" });

	// ANALYZE stage: derived event node + publish effect.
	const analyzeEventNode = derived<AnalyzeEvent<T>>(
		[feedbackNode, candidatesNode, iterationTrigger],
		([feedback, candidates, iter]) => ({
			iteration: iter as number,
			candidates: candidates as readonly T[],
			feedback: feedback as Feedback,
			timestamp_ns: monotonicNs(),
		}),
		{ name: "analyze-event" },
	);
	g.add(analyzeEventNode, { name: "analyze-event" });
	g.addDisposer(analyzeEventNode.subscribe(() => undefined));

	const analyzePublishEffect = effect(
		[analyzeEventNode],
		([evt]) => {
			hubAnalyzeTopic.publish(evt as AnalyzeEvent<T>);
		},
		{ name: "analyze-publish" },
	);
	g.add(analyzePublishEffect, { name: "analyze-publish" });
	g.addDisposer(analyzePublishEffect.subscribe(() => undefined));

	// --- Convergence: four derived nodes fanning into one boolean -----------
	const patienceNode = derived<boolean>(
		[historyState],
		([hist]) => {
			const h = hist as readonly Iteration<T>[];
			if (opts.patience == null || h.length <= opts.patience) return false;
			// No improvement over the last `patience` iterations.
			const lookback = h.slice(-(opts.patience + 1));
			const baseline = lookback[0]!.bestScore;
			return lookback.slice(1).every((i) => i.bestScore <= baseline);
		},
		{ name: "patience-check" },
	);
	g.add(patienceNode, { name: "patience-check" });

	const minScoreNode = derived<boolean>(
		[scoreState],
		([s]) => opts.minScore != null && (s as number) >= opts.minScore,
		{ name: "min-score-check" },
	);
	g.add(minScoreNode, { name: "min-score-check" });

	const minDeltaNode = derived<boolean>(
		[historyState],
		([hist]) => {
			const h = hist as readonly Iteration<T>[];
			if (opts.minDelta == null || h.length < 2) return false;
			const prev = h[h.length - 2]!.bestScore;
			const curr = h[h.length - 1]!.bestScore;
			return Math.abs(curr - prev) < opts.minDelta;
		},
		{ name: "min-delta-check" },
	);
	g.add(minDeltaNode, { name: "min-delta-check" });

	const maxEvalsNode = derived<boolean>(
		[budgetState],
		([used]) => opts.maxEvaluations != null && (used as number) >= opts.maxEvaluations,
		{ name: "max-evaluations-check" },
	);
	g.add(maxEvalsNode, { name: "max-evaluations-check" });

	const maxIterNode = derived<boolean>(
		[iterationTrigger],
		([i]) => opts.maxIterations != null && (i as number) >= opts.maxIterations,
		{ name: "max-iterations-check" },
	);
	g.add(maxIterNode, { name: "max-iterations-check" });

	const budgetExhaustedNode = derived<boolean>(
		[budgetState],
		([used]) => opts.budget != null && (used as number) >= opts.budget,
		{ name: "budget-exhausted-check" },
	);
	g.add(budgetExhaustedNode, { name: "budget-exhausted-check" });

	// Activate convergence derivations so their cache stays current — decideEffect
	// reads their cache via external-boundary reads (§28). They must NOT be direct
	// deps: that would create a feedback cycle (decideEffect writes history/score,
	// convergence derives from those, cycle).
	g.addDisposer(patienceNode.subscribe(() => undefined));
	g.addDisposer(minScoreNode.subscribe(() => undefined));
	g.addDisposer(minDeltaNode.subscribe(() => undefined));
	g.addDisposer(maxEvalsNode.subscribe(() => undefined));
	g.addDisposer(maxIterNode.subscribe(() => undefined));
	g.addDisposer(budgetExhaustedNode.subscribe(() => undefined));

	const convergedNode = derived<{ converged: boolean; reason?: string }>(
		[patienceNode, minScoreNode, minDeltaNode, maxEvalsNode, maxIterNode],
		([p, ms, md, me, mi]) => {
			if (p) return { converged: true, reason: "patience" };
			if (ms) return { converged: true, reason: "min-score" };
			if (md) return { converged: true, reason: "min-delta" };
			if (me) return { converged: true, reason: "max-evaluations" };
			if (mi) return { converged: true, reason: "max-iterations" };
			return { converged: false };
		},
		{ name: "converged" },
	);
	g.add(convergedNode, { name: "converged" });
	g.addDisposer(convergedNode.subscribe(() => undefined));

	// --- DECIDE: feedback settles → fire next iteration OR terminate --------
	// §32 nested-drain state-mirror: inside batch(), `lastFeedback` emission
	// drains BEFORE `iterationTrigger` emission. The closure updater for
	// `latestFeedback` runs between them, so the next generate sees the fresh
	// feedback.
	// Track last-decided iteration to avoid re-deciding when deps re-fire in the
	// same iteration (the fn can fire multiple times per wave as deps settle).
	let lastDecidedIteration = -1;
	const decideEffect = effect(
		[feedbackNode, scoresNode, candidatesNode],
		([feedback, scoresIn, candidates]) => {
			// Read iteration from cache — it's always latest. Using it as a fn
			// dep produces stale reads when iterationTrigger's wave and the
			// candidates-cascade wave land in different drain cycles (candidates
			// arrive async via switchMap, so prevData[iter] can be from an
			// earlier wave than the fresh feedback).
			const i = iterationTrigger.cache as number;
			const fb = feedback as Feedback;
			const cs = candidates as readonly T[];
			const scores = scoresIn as readonly EvalResult[];

			// De-dup: only run once per iteration. The effect may fire multiple
			// times as feedback/scores/candidates settle within one wave.
			if (i <= lastDecidedIteration) return;
			lastDecidedIteration = i;

			// Compute next history / score BEFORE writing — we need these values
			// to evaluate convergence inline (the derived convergenceNodes would
			// require a full drain cycle before their cache updates, which
			// doesn't happen inside our current batch).
			const { best, bestScore } = pickBest(cs, scores);
			const currentHistory = historyState.cache as readonly Iteration<T>[];
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
			// Budget accounting — decideEffect is the single authority. Compute
			// the post-this-iteration total from the prior budget + this wave's
			// candidate count, so convergence checks use the correct value
			// regardless of whether generateEffect or decideEffect drained first.
			const nextBudget = (budgetState.cache as number) + cs.length;

			// Inline convergence checks — single source of truth. The derived
			// `convergedNode` + friends exist for describe()/observe() surface;
			// inlining here avoids a drain-round-trip deadlock where decideEffect
			// would need convergedNode.cache to update before running, but
			// convergedNode needs historyState.emit from inside decideEffect.
			let decision: DecideEvent["decision"] = "continue";
			let reason: string | undefined;
			const budgetOut = opts.budget != null && nextBudget >= opts.budget;
			const paused = pauseState.cache as boolean;
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
		{ name: "decide-bridge" },
	);
	g.add(decideEffect, { name: "decide-bridge" });
	g.addDisposer(decideEffect.subscribe(() => undefined));

	// --- Assemble the returned graph ----------------------------------------
	const out = Object.assign(g, {
		best: bestState as Node<T | null>,
		score: scoreState,
		status: statusState,
		history: historyState,
		strategy: strategyNode,
		iteration: iterationTrigger,
		generate: hubGenerateTopic,
		evaluate: hubEvaluateTopic,
		analyze: hubAnalyzeTopic,
		decide: hubDecideTopic,
		setStrategy(next: RefineStrategy<T>): void {
			strategyNode.emit(next);
		},
		pause(): void {
			pauseState.emit(true);
		},
		resume(): void {
			// Idempotent: only un-pause from the "paused" terminal state.
			// Converged / budget / errored are permanent — a user wanting to
			// start over should construct a fresh refineLoop.
			if (statusState.cache !== "paused") return;
			batch(() => {
				pauseState.emit(false);
				statusState.emit("running");
				iterationTrigger.emit((iterationTrigger.cache as number) + 1);
			});
		},
	}) as RefineLoopGraph<T>;

	return out;
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
	 * `attachStorage`, telemetry, etc.
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
					// Self-owned counter boundary read (P3 gray zone, same pattern
					// as `tryIncrementBounded` in patterns/_internal.ts).
					const prev = (opts.tokens.cache as number | undefined) ?? 0;
					opts.tokens.emit(prev + iterCost);
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
	 * `attachStorage`, telemetry, etc.
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
					// Self-owned counter boundary read (P3 gray zone, same
					// pattern as `tryIncrementBounded` in patterns/_internal.ts).
					const prev = (opts.tokens.cache as number | undefined) ?? 0;
					opts.tokens.emit(prev + iterCost);
				}
			}
		},
	};
}
