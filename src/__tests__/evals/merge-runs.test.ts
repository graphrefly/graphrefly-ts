import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergeAndWriteResults, mergeRuns } from "../../../evals/lib/reporter.js";
import type { EvalRun, TaskResult } from "../../../evals/lib/types.js";

function task(id: string, treatment: "graphspec" | "functions", valid: boolean): TaskResult {
	return {
		task_id: id,
		treatment,
		raw_output: "",
		valid,
		runnable: valid,
		judge_scores: [],
		latency_ms: 100,
		token_count: { input: 1000, output: 200 },
		cost_usd: 0.01,
	};
}

function makeRun(runId: string, tasks: TaskResult[], totalCost = 0.1): EvalRun {
	return {
		run_id: runId,
		timestamp: new Date().toISOString(),
		layer: "L0",
		model: "gemini-2.0-flash",
		provider: "google",
		schema_version: "scaffold",
		scores: {
			"L0-M1-graphspec-error-rate": 0,
			"L0-M1-functions-error-rate": 0,
			"L0-M1-ratio": 0,
		},
		tasks,
		total_cost_usd: totalCost,
		rate_limit_stats: {
			total_retries: 1,
			total_wait_ms: 500,
			effective_rpm: 60,
			effective_tpm: 100_000,
		},
	};
}

describe("mergeRuns", () => {
	it("carries over prior tasks not in the new run", () => {
		const prev = makeRun("l0-trial1", [
			task("t1", "graphspec", true),
			task("t1", "functions", true),
		]);
		const current = makeRun("l0-trial1", [
			task("t2", "graphspec", true),
			task("t2", "functions", true),
		]);
		const merged = mergeRuns(prev, current);
		expect(merged.tasks).toHaveLength(4);
		const ids = merged.tasks.map((t) => `${t.task_id}::${t.treatment}`);
		expect(ids).toEqual(["t1::graphspec", "t1::functions", "t2::graphspec", "t2::functions"]);
	});

	it("dedupes by task_id+treatment, last write wins", () => {
		const prev = makeRun("l0-trial1", [task("t1", "graphspec", false)]);
		const current = makeRun("l0-trial1", [task("t1", "graphspec", true)]);
		const merged = mergeRuns(prev, current);
		expect(merged.tasks).toHaveLength(1);
		expect(merged.tasks[0]?.valid).toBe(true);
	});

	it("recomputes L0 scores over the merged set", () => {
		// 2 graphspec tasks: 1 valid, 1 invalid → graphspec error rate = 0.5
		// 2 functions tasks: 0 valid, 2 invalid → functions error rate = 1.0
		const prev = makeRun("l0-trial1", [
			task("t1", "graphspec", true),
			task("t1", "functions", false),
		]);
		const current = makeRun("l0-trial1", [
			task("t2", "graphspec", false),
			task("t2", "functions", false),
		]);
		const merged = mergeRuns(prev, current);
		expect(merged.scores["L0-M1-graphspec-error-rate"]).toBeCloseTo(0.5);
		expect(merged.scores["L0-M1-functions-error-rate"]).toBeCloseTo(1.0);
		expect(merged.scores["L0-M1-ratio"]).toBeCloseTo(0.5);
	});

	it("sums total_cost_usd and rate-limit totals", () => {
		const prev = makeRun("l0-trial1", [task("t1", "graphspec", true)], 0.05);
		const current = makeRun("l0-trial1", [task("t2", "graphspec", true)], 0.07);
		const merged = mergeRuns(prev, current);
		expect(merged.total_cost_usd).toBeCloseTo(0.12);
		expect(merged.rate_limit_stats?.total_retries).toBe(2);
		expect(merged.rate_limit_stats?.total_wait_ms).toBe(1000);
	});

	it("uses the new run's timestamp + scores' shape (newer metadata wins)", () => {
		const prev = makeRun("l0-trial1", [task("t1", "graphspec", true)]);
		prev.timestamp = "2026-01-01T00:00:00.000Z";
		prev.model = "old-model";
		const current = makeRun("l0-trial1", [task("t2", "graphspec", true)]);
		const merged = mergeRuns(prev, current);
		expect(merged.timestamp).toBe(current.timestamp);
		expect(merged.model).toBe(current.model);
	});
});

describe("mergeAndWriteResults", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "merge-runs-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("writes the run as-is when no prior file exists", async () => {
		const path = join(dir, "fresh.json");
		const run = makeRun("l0-fresh", [task("t1", "graphspec", true)]);
		const persisted = await mergeAndWriteResults(run, path);
		expect(persisted.tasks).toHaveLength(1);
		const ondisk = JSON.parse(readFileSync(path, "utf-8")) as EvalRun;
		expect(ondisk.run_id).toBe("l0-fresh");
	});

	it("merges new tasks into an existing file with the same run_id", async () => {
		const path = join(dir, "trial1.json");
		const first = makeRun("l0-trial1", [
			task("t1", "graphspec", true),
			task("t1", "functions", true),
		]);
		await mergeAndWriteResults(first, path);

		const second = makeRun("l0-trial1", [
			task("t2", "graphspec", true),
			task("t2", "functions", true),
		]);
		const persisted = await mergeAndWriteResults(second, path);

		expect(persisted.tasks).toHaveLength(4);
		const ondisk = JSON.parse(readFileSync(path, "utf-8")) as EvalRun;
		expect(ondisk.tasks).toHaveLength(4);
	});

	it("throws on run_id mismatch — refuses to silently overwrite", async () => {
		const path = join(dir, "trial1.json");
		writeFileSync(path, JSON.stringify(makeRun("l0-existing", [task("t1", "graphspec", true)])));

		const wrong = makeRun("l0-different", [task("t2", "graphspec", true)]);
		await expect(mergeAndWriteResults(wrong, path)).rejects.toThrow(/Run id mismatch/);
	});
});
