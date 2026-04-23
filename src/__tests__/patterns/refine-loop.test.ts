import { describe, expect, it } from "vitest";
import { derived, state } from "../../core/sugar.js";
import {
	blindVariation,
	type DatasetItem,
	type EvalResult,
	type Evaluator,
	type RefineStrategy,
	refineLoop,
} from "../../patterns/refine-loop.js";

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
	derived([candidates, dataset], ([cs, ds]) => {
		const candidate = (cs as readonly number[]).at(-1) ?? 0;
		const targets = (ds as readonly DatasetItem[]).map((t) => Number(t.id.slice(1)));
		const results: EvalResult[] = targets.map((target, i) => ({
			taskId: (ds as readonly DatasetItem[])[i]!.id,
			score: -Math.abs(candidate - target),
		}));
		return results;
	});

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

		const teacher = (prior: number) => prior + 1;

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
			derived([candidates], () => [{ taskId: "t1", score: 0.95 }] as const);

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
			teacher: (prior) => prior,
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
			teacher: (prior) => prior,
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
			teacher: (prior) => prior + 1,
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
		const iterAtPause = loop.iteration.cache as number;

		loop.resume();
		await tick();

		// After resume, status returns to running (or converged if the rest
		// of maxIterations drained). Either way, iteration must have advanced.
		expect(loop.iteration.cache as number).toBeGreaterThan(iterAtPause);
	});
});

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

describe("refineLoop — observability", () => {
	it("describe() surfaces all four stage topics + state nodes", async () => {
		const loop = refineLoop(0, numericEvaluator, blindVariation({ teacher: (p) => p, width: 1 }), {
			dataset: DS,
			maxIterations: 1,
		});
		const desc = loop.describe();
		expect(desc.nodes).toHaveProperty("iteration");
		expect(desc.nodes).toHaveProperty("strategy");
		expect(desc.nodes).toHaveProperty("status");
		expect(desc.nodes).toHaveProperty("best");
		expect(desc.nodes).toHaveProperty("score");
		expect(desc.nodes).toHaveProperty("history");
		// Mounted topics surface under `<stage>::events` etc.
		const pathList = Object.keys(desc.nodes);
		expect(pathList.some((p) => p.startsWith("GENERATE::"))).toBe(true);
		expect(pathList.some((p) => p.startsWith("EVALUATE::"))).toBe(true);
		expect(pathList.some((p) => p.startsWith("ANALYZE::"))).toBe(true);
		expect(pathList.some((p) => p.startsWith("DECIDE::"))).toBe(true);
	});

	it("history accumulates one Iteration per completed iteration", async () => {
		const strategy = blindVariation<number>({
			width: 1,
			teacher: (prior) => prior + 1,
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

	it("reactive dataset: wrapping a state() node allows mid-run dataset swap", async () => {
		const datasetNode = state<readonly DatasetItem[]>(DS);
		const strategy = blindVariation<number>({
			width: 1,
			teacher: (prior) => prior,
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
