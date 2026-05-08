import { describe, expect, it } from "vitest";
import { node } from "../../core/node.js";

import {
	blindVariation,
	type DatasetItem,
	type ErrorCritiqueContext,
	type EvalResult,
	type Evaluator,
	errorCritique,
	type Feedback,
	type RefineStrategy,
	refineLoop,
} from "../../patterns/harness/presets/refine-loop.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DS: readonly DatasetItem[] = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];

/**
 * Trivial evaluator — scores a numeric candidate by distance to the per-task
 * target. Higher score = closer. Each task has a different target so the
 * aggregate score reflects how well the candidate does overall.
 */
const numericEvaluator: Evaluator<number> = (candidates, dataset) =>
	node(
		[candidates, dataset],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const candidate = (data[0] as readonly number[]).at(-1) ?? 0;
			const targets = (data[1] as readonly DatasetItem[]).map((t) => Number(t.id.slice(1)));
			const results: EvalResult[] = targets.map((target, i) => ({
				taskId: (data[1] as readonly DatasetItem[])[i]!.id,
				score: -Math.abs(candidate - target),
			}));
			actions.emit(results);
		},
		{ describeKind: "derived" },
	);

/** Drain any settled async work so iteration effects propagate. */
async function tick(rounds = 30): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		await new Promise((r) => setTimeout(r, 0));
	}
}

// ---------------------------------------------------------------------------
// Basic wiring
// ---------------------------------------------------------------------------

describe("refineLoop — basic wiring", () => {
	it("runs iterations, publishes to all four topics, and converges on maxIterations", async () => {
		const generateEvents: number[] = [];
		const evaluateEvents: number[] = [];
		const analyzeEvents: number[] = [];
		const decideEvents: string[] = [];

		const teacher = (ctx: { prior: number }) => ctx.prior + 1;

		const loop = refineLoop(0, numericEvaluator, blindVariation({ teacher, width: 1 }), {
			dataset: DS,
			maxIterations: 3,
		});

		loop.generate.events.subscribe(() => undefined);
		loop.evaluate.events.subscribe(() => undefined);
		loop.analyze.events.subscribe(() => undefined);
		loop.decide.events.subscribe(() => undefined);

		const genUnsub = loop.generate.latest.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === Symbol.for("graphrefly.DATA")) {
					// no-op: we use the events log below
				}
			}
		});
		void genUnsub;

		// Activate the loop by subscribing to a terminal observable.
		loop.status.subscribe(() => undefined);
		loop.best.subscribe(() => undefined);
		loop.history.subscribe(() => undefined);

		await tick();
		await tick();

		for (const e of loop.generate.retained()) generateEvents.push(e.iteration);
		for (const e of loop.evaluate.retained()) evaluateEvents.push(e.iteration);
		for (const e of loop.analyze.retained()) analyzeEvents.push(e.iteration);
		for (const e of loop.decide.retained()) decideEvents.push(e.decision);

		// At least one iteration's worth of events flowed through every stage.
		expect(generateEvents.length).toBeGreaterThanOrEqual(1);
		expect(evaluateEvents.length).toBeGreaterThanOrEqual(1);
		expect(analyzeEvents.length).toBeGreaterThanOrEqual(1);
		expect(decideEvents.length).toBeGreaterThanOrEqual(1);
		// maxIterations=3 should eventually surface "converged" in decide.
		expect(decideEvents).toContain("converged");
		expect(loop.status.cache).toBe("converged");
	});
});

// ---------------------------------------------------------------------------
// Convergence rules
// ---------------------------------------------------------------------------

describe("refineLoop — convergence rules", () => {
	it("stops on minScore when the score crosses the threshold", async () => {
		// Candidates just repeat the seed; evaluator returns a fixed high score.
		const strategy: RefineStrategy<number> = {
			name: "identity",
			seed(s) {
				return [s];
			},
			analyze(scores) {
				return { summary: "", score: scores[0]?.score ?? 0 };
			},
			generate(_fb, candidates) {
				return candidates;
			},
		};
		const highScoreEvaluator: Evaluator<number> = (candidates, _ds) =>
			node(
				[candidates],
				(batchData, actions, ctx) => {
					const _data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					actions.emit([{ taskId: "t1", score: 0.95 }] as const);
				},
				{ describeKind: "derived" },
			);

		const loop = refineLoop(0, highScoreEvaluator, strategy, {
			dataset: DS,
			minScore: 0.9,
			maxIterations: 100,
		});
		loop.status.subscribe(() => undefined);
		loop.history.subscribe(() => undefined);
		await tick();

		expect(loop.status.cache).toBe("converged");
		const lastDecision = loop.decide.retained().at(-1)!;
		expect(lastDecision.reason).toBe("min-score");
	});

	it("stops on maxEvaluations when the budget counter crosses the cap", async () => {
		const strategy = blindVariation<number>({
			width: 2,
			teacher: (ctx) => ctx.prior,
		});
		const loop = refineLoop(0, numericEvaluator, strategy, {
			dataset: DS,
			maxEvaluations: 4,
			maxIterations: 100,
		});
		loop.status.subscribe(() => undefined);
		loop.history.subscribe(() => undefined);
		await tick();

		expect(loop.status.cache).toBe("converged");
		const lastDecision = loop.decide.retained().at(-1)!;
		expect(lastDecision.reason).toBe("max-evaluations");
	});

	it("stops on budget exhaustion (separate from maxEvaluations)", async () => {
		const strategy = blindVariation<number>({
			width: 2,
			teacher: (ctx) => ctx.prior,
		});
		const loop = refineLoop(0, numericEvaluator, strategy, {
			dataset: DS,
			budget: 3,
			maxIterations: 100,
		});
		loop.status.subscribe(() => undefined);
		loop.history.subscribe(() => undefined);
		await tick();

		expect(loop.status.cache).toBe("budget");
		const lastDecision = loop.decide.retained().at(-1)!;
		expect(lastDecision.decision).toBe("budget");
	});
});

// ---------------------------------------------------------------------------
// Strategy swap (human-in-the-loop)
// ---------------------------------------------------------------------------

describe("refineLoop — strategy swap", () => {
	it("setStrategy swaps the active strategy mid-run; next iteration uses the new one", async () => {
		const calls: string[] = [];
		// Strategies are intentionally async: a sync `generate` drains the whole
		// loop synchronously inside the factory's activation cascade, leaving
		// no window for `pause()` / `setStrategy()` to interleave. Real
		// strategies are LLM calls (async); async variants here match that.
		const stratA: RefineStrategy<number> = {
			name: "A",
			seed(s) {
				calls.push("A.seed");
				return [s];
			},
			analyze(scores) {
				return { summary: "A", score: scores[0]?.score ?? 0 };
			},
			async generate(_fb, candidates) {
				calls.push("A.generate");
				return [...candidates];
			},
		};
		const stratB: RefineStrategy<number> = {
			name: "B",
			seed(s) {
				calls.push("B.seed");
				return [s];
			},
			analyze(scores) {
				return { summary: "B", score: scores[0]?.score ?? 0 };
			},
			async generate(_fb, candidates) {
				calls.push("B.generate");
				return candidates.map((c) => c + 100);
			},
		};

		// Pause immediately so the loop halts after iter 0 (A.seed only).
		// Under Promise.resolve-backed switchMap, the whole loop can drain in
		// a single tick — pausing synchronously catches the first decide wave.
		const loop = refineLoop(1, numericEvaluator, stratA, {
			dataset: DS,
			maxIterations: 20,
		});
		loop.status.subscribe(() => undefined);
		loop.history.subscribe(() => undefined);

		loop.pause();
		await tick(5);
		expect(calls[0]).toBe("A.seed");

		// Swap and resume — iter 1+ should use B.generate.
		loop.setStrategy(stratB);
		loop.resume();
		await tick(10);

		expect(calls.some((c) => c === "B.generate")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Pause / resume
// ---------------------------------------------------------------------------

describe("refineLoop — pause/resume", () => {
	it("pause() stops the loop at the next decision and resume() continues it", async () => {
		const strategy = blindVariation<number>({
			width: 1,
			teacher: (ctx) => ctx.prior + 1,
		});
		const loop = refineLoop(0, numericEvaluator, strategy, {
			dataset: DS,
			maxIterations: 100,
		});
		loop.status.subscribe(() => undefined);
		loop.history.subscribe(() => undefined);

		// Pause BEFORE letting the async microtask queue drain — the loop runs
		// one iteration per microtask (fromAny + Promise.resolve), so by the
		// time a single `await tick()` completes the whole 100-iteration run
		// has already finished. Pausing synchronously catches the very next
		// decide wave.
		loop.pause();
		await tick();

		expect(loop.status.cache).toBe("paused");
		const iterAtPause = loop._iteration.cache as number;

		loop.resume();
		await tick();

		// After resume, status returns to running (or converged if the rest
		// of maxIterations drained). Either way, iteration must have advanced.
		expect(loop._iteration.cache as number).toBeGreaterThan(iterAtPause);
	});
});

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

describe("refineLoop — observability", () => {
	it("describe() surfaces all four stage topics + state nodes", async () => {
		const loop = refineLoop(
			0,
			numericEvaluator,
			blindVariation({ teacher: (ctx) => ctx.prior, width: 1 }),
			{ dataset: DS, maxIterations: 1 },
		);
		const desc = loop.describe();
		expect(desc.nodes).toHaveProperty("iteration");
		expect(desc.nodes).toHaveProperty("strategy");
		expect(desc.nodes).toHaveProperty("status");
		expect(desc.nodes).toHaveProperty("best");
		expect(desc.nodes).toHaveProperty("score");
		expect(desc.nodes).toHaveProperty("history");
		// Stage topics surface under stages::<stage>::events etc. (hub mount).
		const pathList = Object.keys(desc.nodes);
		expect(pathList.some((p) => p.startsWith("stages::generate::"))).toBe(true);
		expect(pathList.some((p) => p.startsWith("stages::evaluate::"))).toBe(true);
		expect(pathList.some((p) => p.startsWith("stages::analyze::"))).toBe(true);
		expect(pathList.some((p) => p.startsWith("stages::decide::"))).toBe(true);
	});

	it("history accumulates one Iteration per completed iteration", async () => {
		const strategy = blindVariation<number>({
			width: 1,
			teacher: (ctx) => ctx.prior + 1,
		});
		const loop = refineLoop(0, numericEvaluator, strategy, {
			dataset: DS,
			maxIterations: 3,
		});
		loop.status.subscribe(() => undefined);
		loop.history.subscribe(() => undefined);
		await tick();

		const hist = loop.history.cache as readonly { n: number }[];
		expect(hist.length).toBeGreaterThanOrEqual(1);
		for (let i = 1; i < hist.length; i++) {
			expect(hist[i]!.n).toBeGreaterThanOrEqual(hist[i - 1]!.n);
		}
	});

	it("reactive dataset: wrapping a node([]) node allows mid-run dataset swap", async () => {
		const datasetNode = node<readonly DatasetItem[]>([], { initial: DS });
		const strategy = blindVariation<number>({
			width: 1,
			teacher: (ctx) => ctx.prior,
		});
		const loop = refineLoop(0, numericEvaluator, strategy, {
			dataset: datasetNode,
			maxIterations: 3,
		});
		loop.status.subscribe(() => undefined);
		loop.history.subscribe(() => undefined);
		await tick();

		// Swap the dataset — next iteration's evaluation uses the new set.
		datasetNode.emit([{ id: "t10" }, { id: "t20" }]);
		await tick();

		expect(loop.status.cache).toBe("converged"); // maxIterations=3
	});
});

// ---------------------------------------------------------------------------
// errorCritique strategy
// ---------------------------------------------------------------------------

describe("errorCritique — built-in strategy", () => {
	/**
	 * Evaluator that fans out scores across all candidates × all tasks and
	 * stamps each score with `candidateIndex` so `pickBest` aggregates per
	 * candidate (D1). Targets are parsed from task IDs (`"t1"` → 1, etc.);
	 * higher score = closer to target.
	 */
	const perTaskEvaluator: Evaluator<number> = (candidates, dataset) =>
		node(
			[candidates, dataset],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const cands = data[0] as readonly number[];
				const tasks = data[1] as readonly DatasetItem[];
				const out: EvalResult[] = [];
				for (let ci = 0; ci < cands.length; ci++) {
					const c = cands[ci]!;
					for (const t of tasks) {
						const target = Number(t.id.slice(1));
						out.push({ taskId: t.id, score: -Math.abs(c - target), candidateIndex: ci });
					}
				}
				actions.emit(out);
			},
			{ describeKind: "derived" },
		);

	it("seeds with just the seed at iteration 0", () => {
		const strategy = errorCritique<number>({
			teacher: (ctx) => ctx.prior + 1,
			width: 4,
		});
		const out = strategy.seed(42);
		expect(out).toEqual([42]);
	});

	it("calls the teacher `width` times per iteration", async () => {
		const teacherCalls: ErrorCritiqueContext<number>[] = [];
		const strategy = errorCritique<number>({
			width: 3,
			teacher: (ctx) => {
				teacherCalls.push(ctx);
				return ctx.prior + 1;
			},
		});
		const loop = refineLoop(0, perTaskEvaluator, strategy, {
			dataset: DS,
			maxIterations: 2,
		});
		loop.status.subscribe(() => undefined);
		loop.history.subscribe(() => undefined);
		await tick();

		// At least one iteration of critique-driven generation — so at least
		// `width` teacher calls. maxIterations=2 means 1 critique pass after
		// the seed iteration.
		expect(teacherCalls.length).toBeGreaterThanOrEqual(3);
	});

	it("teacher receives the best candidate as `prior` (highest score wins)", async () => {
		const priors: number[] = [];
		// Strategy under test: capture prior values passed to the teacher.
		const strategy = errorCritique<number>({
			width: 1,
			teacher: (ctx) => {
				priors.push(ctx.prior);
				// Return prior unchanged so candidates[0] stays stable across
				// iterations (converges quickly via maxIterations).
				return ctx.prior;
			},
		});
		// Seed of 2 → perTaskEvaluator scores it against targets from DS
		// ({t1: 1, t2: 2, t3: 3}). Best candidate is the seed itself at iter 0.
		const loop = refineLoop(2, perTaskEvaluator, strategy, {
			dataset: DS,
			maxIterations: 3,
		});
		loop.status.subscribe(() => undefined);
		loop.history.subscribe(() => undefined);
		await tick();

		// First teacher call (iter 1) must have received the seed (2) as prior
		// since that was the only candidate at iter 0.
		expect(priors[0]).toBe(2);
	});

	it("populates `failures` with tasks below the default (batch-mean) threshold", async () => {
		const critiqueCalls: ErrorCritiqueContext<number>[] = [];
		const strategy = errorCritique<number>({
			width: 1,
			teacher: (ctx) => {
				critiqueCalls.push(ctx);
				return ctx.prior;
			},
		});
		const loop = refineLoop(0, perTaskEvaluator, strategy, {
			dataset: DS,
			maxIterations: 2,
		});
		loop.status.subscribe(() => undefined);
		loop.history.subscribe(() => undefined);
		await tick();

		// Seed=0 scored against targets 1/2/3 gives scores [-1, -2, -3].
		// Mean = -2. Only -3 (t3) is < -2, so failures should contain only t3.
		expect(critiqueCalls.length).toBeGreaterThanOrEqual(1);
		const firstCritique = critiqueCalls[0]!;
		expect(firstCritique.failures.map((f) => f.taskId)).toEqual(["t3"]);
	});

	it("respects a numeric `failureThreshold` (absolute cut-off)", async () => {
		const critiqueCalls: ErrorCritiqueContext<number>[] = [];
		const strategy = errorCritique<number>({
			width: 1,
			failureThreshold: -1.5, // any task scoring below -1.5 is a failure
			teacher: (ctx) => {
				critiqueCalls.push(ctx);
				return ctx.prior;
			},
		});
		const loop = refineLoop(0, perTaskEvaluator, strategy, {
			dataset: DS,
			maxIterations: 2,
		});
		loop.status.subscribe(() => undefined);
		loop.history.subscribe(() => undefined);
		await tick();

		// seed=0 → scores [-1, -2, -3]. Below -1.5: t2 and t3.
		const first = critiqueCalls[0]!;
		expect(first.failures.map((f) => f.taskId).sort()).toEqual(["t2", "t3"]);
	});

	it("accepts a function `failureThreshold` for per-batch computation", async () => {
		const critiqueCalls: ErrorCritiqueContext<number>[] = [];
		const strategy = errorCritique<number>({
			width: 1,
			// Threshold = the minimum score — nothing is strictly below it, so
			// failures must be empty.
			failureThreshold: (scores) => Math.min(...scores.map((s) => s.score)),
			teacher: (ctx) => {
				critiqueCalls.push(ctx);
				return ctx.prior;
			},
		});
		const loop = refineLoop(0, perTaskEvaluator, strategy, {
			dataset: DS,
			maxIterations: 2,
		});
		loop.status.subscribe(() => undefined);
		loop.history.subscribe(() => undefined);
		await tick();

		expect(critiqueCalls[0]!.failures).toEqual([]);
	});

	it("clips failures to `maxFailureSamples`", async () => {
		const critiqueCalls: ErrorCritiqueContext<number>[] = [];
		// 5 tasks; set maxFailureSamples=2. Use an all-negative score range
		// and threshold large enough that every task fails.
		const bigDS: readonly DatasetItem[] = [
			{ id: "t1" },
			{ id: "t2" },
			{ id: "t3" },
			{ id: "t4" },
			{ id: "t5" },
		];
		const strategy = errorCritique<number>({
			width: 1,
			failureThreshold: 0, // every score is < 0, everything fails
			maxFailureSamples: 2,
			teacher: (ctx) => {
				critiqueCalls.push(ctx);
				return ctx.prior;
			},
		});
		const loop = refineLoop(0, perTaskEvaluator, strategy, {
			dataset: bigDS,
			maxIterations: 2,
		});
		loop.status.subscribe(() => undefined);
		loop.history.subscribe(() => undefined);
		await tick();

		const first = critiqueCalls[0]!;
		expect(first.failures.length).toBe(2);
		// Worst failures are prioritised — t5 (-5) and t4 (-4) are the bottom 2.
		expect(first.failures.map((f) => f.taskId)).toEqual(["t5", "t4"]);
	});

	it("uses a custom `formatCritique` when provided", async () => {
		const seen: string[] = [];
		const strategy = errorCritique<number>({
			width: 1,
			formatCritique: (failures) => `FAILS=${failures.length}`,
			teacher: (ctx) => {
				seen.push(ctx.critique);
				return ctx.prior;
			},
		});
		const loop = refineLoop(0, perTaskEvaluator, strategy, {
			dataset: DS,
			maxIterations: 2,
		});
		loop.status.subscribe(() => undefined);
		loop.history.subscribe(() => undefined);
		await tick();

		expect(seen[0]).toMatch(/^FAILS=\d+$/);
	});

	it("generate throws on empty candidate batch (direct unit test)", async () => {
		// N2: Test strategy.generate() directly with synthetic inputs — no loop,
		// no timing races. Deterministic enforcement of the length-guard throw.
		const strategy = errorCritique<number>({
			width: 1,
			teacher: (ctx) => ctx.prior,
		});
		const feedback: Feedback = { summary: "irrelevant", score: 0 };
		await expect(strategy.generate(feedback, [])).rejects.toThrow(/empty candidate batch/);
	});

	it("generate falls back to candidates[last] + feedback.summary on foreign Feedback (direct unit test)", async () => {
		// N2: Verify the strategy-swap fallback path as a pure unit test.
		const seen: ErrorCritiqueContext<number>[] = [];
		const strategy = errorCritique<number>({
			width: 1,
			teacher: (ctx) => {
				seen.push(ctx);
				return ctx.prior + 1;
			},
		});
		// Foreign feedback — no errorCritique private payload.
		const feedback: Feedback = { summary: "from-A", score: 0 };
		const out = await strategy.generate(feedback, [10, 42]);

		expect(seen).toHaveLength(1);
		expect(seen[0]!.prior).toBe(42); // candidates[last]
		expect(seen[0]!.critique).toBe("from-A"); // feedback.summary
		expect(seen[0]!.failures).toEqual([]);
		expect(out).toEqual([43]);
	});

	it("generate prefers priv.best over candidates[last] when the private payload is present (direct unit test)", async () => {
		// N2 + D1: confirms priv-payload path works even when candidates[last]
		// differs from priv.best.
		const seen: ErrorCritiqueContext<number>[] = [];
		const strategy = errorCritique<number>({
			width: 1,
			teacher: (ctx) => {
				seen.push(ctx);
				return ctx.prior;
			},
		});
		// Inject a synthetic Feedback that claims best=99 via the priv channel.
		// Use analyze to build a real priv payload, then replace the critique.
		const synthetic = strategy.analyze(
			[
				{ taskId: "t1", score: 10, candidateIndex: 0 },
				{ taskId: "t1", score: -5, candidateIndex: 1 },
			],
			[99, 7],
		);
		// priv.best should be 99 (higher score at candidateIndex 0).
		const out = await strategy.generate(synthetic, [0, 0]); // candidates[last]=0
		expect(seen).toHaveLength(1);
		expect(seen[0]!.prior).toBe(99); // from priv, not candidates[last]
		expect(out).toEqual([99]);
	});

	it("converges on minScore when the teacher improves toward the target", async () => {
		// Teacher always moves prior up by 1. With seed=0 and targets {1,2,3},
		// the single-task evaluator below will reach -0 (perfect) quickly.
		const singleTaskEvaluator: Evaluator<number> = (candidates) =>
			node(
				[candidates],
				(batchData, actions, ctx) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					const c = (data[0] as readonly number[]).at(-1) ?? 0;
					actions.emit([{ taskId: "t2", score: -Math.abs(c - 2) }] as const);
				},
				{ describeKind: "derived" },
			);

		const strategy = errorCritique<number>({
			width: 1,
			teacher: (ctx) => ctx.prior + 1,
		});
		const loop = refineLoop(0, singleTaskEvaluator, strategy, {
			dataset: [{ id: "t2" }],
			minScore: -0.0001,
			maxIterations: 20,
		});
		loop.status.subscribe(() => undefined);
		loop.history.subscribe(() => undefined);
		loop.best.subscribe(() => undefined);
		await tick();

		expect(loop.status.cache).toBe("converged");
		expect(loop.best.cache).toBe(2);
	});

	// -------------------------------------------------------------------------
	// A1: NaN threshold fallback
	// -------------------------------------------------------------------------

	it("treats all scores as failures when the default (batch-mean) threshold is non-finite", async () => {
		// A1: evaluator produces NaN scores → meanScore is NaN → default
		// threshold is NaN. Guard: all scores become failures instead of
		// filtering with `< NaN` (always false → silent no-op).
		const strategy = errorCritique<number>({
			width: 1,
			teacher: (ctx) => ctx.prior,
		});
		const fb = strategy.analyze(
			[
				{ taskId: "t1", score: Number.NaN },
				{ taskId: "t2", score: Number.NaN },
			],
			[0],
		);
		const priv = fb.critique as { failures: readonly EvalResult[] };
		expect(priv.failures).toHaveLength(2);
		expect(priv.failures.map((f) => f.taskId).sort()).toEqual(["t1", "t2"]);
	});

	it("still respects a user-supplied numeric threshold when scores are NaN (no fallback)", async () => {
		// A1 scope check: the all-failures fallback ONLY fires when the user
		// didn't supply a threshold. A numeric threshold is used as-is.
		const strategy = errorCritique<number>({
			width: 1,
			failureThreshold: 0,
			teacher: (ctx) => ctx.prior,
		});
		const fb = strategy.analyze([{ taskId: "t1", score: Number.NaN }], [0]);
		const priv = fb.critique as { failures: readonly EvalResult[] };
		// NaN < 0 is false, so NO failures — user-threshold is honoured.
		expect(priv.failures).toHaveLength(0);
	});

	// -------------------------------------------------------------------------
	// D1: candidateIndex fan-out aggregation in pickBest
	// -------------------------------------------------------------------------

	it("pickBest aggregates mean per candidateIndex when scores fan out", async () => {
		// Direct test via analyze: 2 candidates × 2 tasks = 4 scores. Candidate 0
		// scores (10, 8) = mean 9; candidate 1 scores (5, 7) = mean 6. Best = 0.
		const strategy = errorCritique<number>({
			width: 1,
			teacher: (ctx) => ctx.prior,
		});
		const fb = strategy.analyze(
			[
				{ taskId: "t1", score: 10, candidateIndex: 0 },
				{ taskId: "t2", score: 8, candidateIndex: 0 },
				{ taskId: "t1", score: 5, candidateIndex: 1 },
				{ taskId: "t2", score: 7, candidateIndex: 1 },
			],
			[100, 200],
		);
		const priv = fb.critique as { best: number };
		expect(priv.best).toBe(100); // candidates[0], mean 9 beats candidates[1], mean 6
	});

	it("pickBest falls back to positional alignment when candidateIndex is absent", async () => {
		// Without candidateIndex, scores[i] ↔ candidates[i] by position.
		const strategy = errorCritique<number>({
			width: 1,
			teacher: (ctx) => ctx.prior,
		});
		const fb = strategy.analyze(
			[
				{ taskId: "t1", score: 3 },
				{ taskId: "t2", score: 9 },
			],
			[100, 200],
		);
		const priv = fb.critique as { best: number };
		expect(priv.best).toBe(200); // scores[1]=9 > scores[0]=3 → candidates[1]
	});

	// -------------------------------------------------------------------------
	// D2: tokens companion node (on success AND teacher-throw path)
	// -------------------------------------------------------------------------

	it("writes running-total tokens to `opts.tokens` after each iteration (success path)", async () => {
		const tokens = node<number>([], { name: "tokens", initial: 0 });
		const strategy = errorCritique<number>({
			width: 2,
			tokens,
			teacher: (ctx) => {
				ctx.reportCost(7);
				return ctx.prior;
			},
		});
		// Activate the tokens node so .cache stays fresh.
		tokens.subscribe(() => undefined);
		const fb: Feedback = { summary: "", score: 0 };
		await strategy.generate(fb, [42]);
		// 2 teacher calls × 7 tokens = 14. No prior value, so final is 14.
		expect(tokens.cache).toBe(14);
	});

	it("delivers partial tokens on teacher throw via finally (no spend lost)", async () => {
		const tokens = node<number>([], { name: "tokens-err", initial: 0 });
		tokens.subscribe(() => undefined);
		let calls = 0;
		const strategy = errorCritique<number>({
			width: 3,
			tokens,
			// Sequential mode so we can reason about call count before the throw.
			parallel: false,
			teacher: (ctx) => {
				calls++;
				ctx.reportCost(5);
				if (calls === 3) throw new Error("teacher-failure");
				return ctx.prior;
			},
		});
		const fb: Feedback = { summary: "", score: 0 };
		await expect(strategy.generate(fb, [1])).rejects.toThrow("teacher-failure");
		// 3 calls reported cost before the 3rd threw: 15 tokens total.
		expect(tokens.cache).toBe(15);
	});

	it("accumulates tokens across iterations (prev + delta)", async () => {
		const tokens = node<number>([], { name: "tokens-prev", initial: 100 });
		tokens.subscribe(() => undefined);
		const strategy = errorCritique<number>({
			width: 1,
			tokens,
			teacher: (ctx) => {
				ctx.reportCost(30);
				return ctx.prior;
			},
		});
		const fb: Feedback = { summary: "", score: 0 };
		await strategy.generate(fb, [1]);
		expect(tokens.cache).toBe(130);
		await strategy.generate(fb, [1]);
		expect(tokens.cache).toBe(160);
	});

	it("no-op on tokens when the teacher never calls reportCost", async () => {
		const tokens = node<number>([], { name: "tokens-unused", initial: 0 });
		tokens.subscribe(() => undefined);
		const strategy = errorCritique<number>({
			width: 2,
			tokens,
			teacher: (ctx) => ctx.prior, // no reportCost call
		});
		const fb: Feedback = { summary: "", score: 0 };
		await strategy.generate(fb, [1]);
		expect(tokens.cache).toBe(0); // no write when iterCost === 0
	});

	// -------------------------------------------------------------------------
	// D3: parallel vs sequential teacher invocation
	// -------------------------------------------------------------------------

	it("runs teacher calls in parallel by default (Promise.all)", async () => {
		// If parallel, all N teachers start before any completes. Detect this
		// by checking how many are "in-flight" when the first deferred resolves.
		let inFlight = 0;
		let maxInFlight = 0;
		const strategy = errorCritique<number>({
			width: 4,
			// parallel: true (default)
			teacher: async (ctx) => {
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await new Promise((r) => setTimeout(r, 0));
				inFlight--;
				return ctx.prior;
			},
		});
		const fb: Feedback = { summary: "", score: 0 };
		await strategy.generate(fb, [1]);
		expect(maxInFlight).toBe(4); // all 4 calls in-flight simultaneously
	});

	it("runs teacher calls sequentially when parallel: false", async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const strategy = errorCritique<number>({
			width: 4,
			parallel: false,
			teacher: async (ctx) => {
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await new Promise((r) => setTimeout(r, 0));
				inFlight--;
				return ctx.prior;
			},
		});
		const fb: Feedback = { summary: "", score: 0 };
		await strategy.generate(fb, [1]);
		expect(maxInFlight).toBe(1); // only one call in-flight at a time
	});

	it("blindVariation also supports parallel (default) vs sequential", async () => {
		let maxInFlight = 0;
		let inFlight = 0;
		const makeStrategy = (parallel: boolean) =>
			blindVariation<number>({
				width: 3,
				parallel,
				teacher: async (ctx) => {
					inFlight++;
					maxInFlight = Math.max(maxInFlight, inFlight);
					await new Promise((r) => setTimeout(r, 0));
					inFlight--;
					return ctx.prior;
				},
			});
		// Sequential: at most 1 in-flight.
		maxInFlight = 0;
		inFlight = 0;
		await makeStrategy(false).generate({ summary: "", score: 0 }, [1]);
		expect(maxInFlight).toBe(1);
		// Parallel (default): all 3 in-flight at once.
		maxInFlight = 0;
		inFlight = 0;
		await makeStrategy(true).generate({ summary: "", score: 0 }, [1]);
		expect(maxInFlight).toBe(3);
	});

	it("blindVariation also writes to opts.tokens", async () => {
		const tokens = node<number>([], { name: "bv-tokens", initial: 0 });
		tokens.subscribe(() => undefined);
		const strategy = blindVariation<number>({
			width: 2,
			tokens,
			teacher: (ctx) => {
				ctx.reportCost(11);
				return ctx.prior;
			},
		});
		await strategy.generate({ summary: "", score: 0 }, [1]);
		expect(tokens.cache).toBe(22);
	});
});
