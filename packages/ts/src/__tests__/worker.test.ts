import { describe, expect, it } from "vitest";
import { depBatch } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import { type WorkerDerivedJob, type WorkerDerivedSettle, workerDerived } from "../graph/worker.js";

interface CapturedWorker<TInput, TResult> {
	readonly job: WorkerDerivedJob<TInput, TResult>;
	readonly settle: WorkerDerivedSettle<TResult>;
}

describe("workerDerived — backend-required helper-first worker slice (D148)", () => {
	it("prepares owned input on the graph thread and emits backend completion as a later wave", () => {
		const g = graph();
		const src = g.state(0, { name: "src" });
		const jobs: CapturedWorker<number, number>[] = [];
		const doubled = workerDerived<number, number>(g, [src], {
			name: "worker/doubled",
			prepare(ctx) {
				const batch = depBatch(ctx, 0);
				const value = batch === null ? undefined : (batch.at(-1) as number | undefined);
				return value === 0 ? undefined : value;
			},
			compute(input) {
				return input * 2;
			},
			backend: {
				run(job, settle) {
					jobs.push({ job, settle });
				},
			},
		});
		const seen: unknown[] = [];
		doubled.subscribe((msg) => seen.push(msg));

		src.set(2);
		expect(jobs).toHaveLength(1);
		expect(seen).not.toContainEqual(["DATA", 4]);

		jobs[0].settle({ ok: true, value: jobs[0].job.compute(jobs[0].job.input) });
		expect(seen).toContainEqual(["DATA", 4]);
		expect(g.describe().edges).toContainEqual({ from: "src", to: "worker/doubled" });
	});

	it("fences stale completions and prepare-empty waves before graph mutation", () => {
		const g = graph();
		const src = g.state(0, { name: "src" });
		const jobs: CapturedWorker<number, number>[] = [];
		const worker = workerDerived<number, number>(g, [src], {
			name: "worker",
			prepare(ctx) {
				const value = depBatch(ctx, 0)?.at(-1) as number | undefined;
				return value === 0 ? undefined : value;
			},
			compute(input) {
				return input * 10;
			},
			backend: {
				run(job, settle) {
					jobs.push({ job, settle });
				},
			},
		});
		const seen: unknown[] = [];
		worker.subscribe((msg) => seen.push(msg));

		src.set(1);
		src.set(2);
		jobs[0].settle({ ok: true, value: jobs[0].job.compute(jobs[0].job.input) });
		expect(seen).not.toContainEqual(["DATA", 10]);

		jobs[1].settle({ ok: true, value: jobs[1].job.compute(jobs[1].job.input) });
		expect(seen).toContainEqual(["DATA", 20]);

		src.set(3);
		src.set(0);
		jobs[2].settle({ ok: true, value: jobs[2].job.compute(jobs[2].job.input) });
		expect(seen).not.toContainEqual(["DATA", 30]);
	});

	it("rejects synchronous backend completion instead of mutating graph as worker output", () => {
		const g = graph();
		const src = g.state(1, { name: "src" });
		const worker = workerDerived<number, number>(g, [src], {
			name: "worker",
			prepare(ctx) {
				const value = depBatch(ctx, 0)?.at(-1) as number | undefined;
				return value === 0 ? undefined : value;
			},
			compute(input) {
				return input + 1;
			},
			backend: {
				run(job, settle) {
					settle({ ok: true, value: job.compute(job.input) });
				},
			},
		});
		const seen: unknown[] = [];
		worker.subscribe((msg) => seen.push(msg));

		src.set(2);

		expect(seen).not.toContainEqual(["DATA", 3]);
		expect(seen).toContainEqual([
			"ERROR",
			expect.objectContaining({
				message: "workerDerived: backend completions must arrive after backend.run returns",
			}),
		]);
	});

	it("closes a synchronously misused settlement so later backend calls cannot emit DATA", () => {
		const g = graph();
		const src = g.state(1, { name: "src" });
		let captured: WorkerDerivedSettle<number> | undefined;
		const worker = workerDerived<number, number>(g, [src], {
			name: "worker",
			prepare(ctx) {
				const value = depBatch(ctx, 0)?.at(-1) as number | undefined;
				return value === 0 ? undefined : value;
			},
			compute(input) {
				return input + 1;
			},
			backend: {
				run(job, settle) {
					captured = settle;
					try {
						settle({ ok: true, value: job.compute(job.input) });
					} catch {
						// Backend misuse may catch the synchronous guard; the helper still closes it.
					}
				},
			},
		});
		const seen: unknown[] = [];
		worker.subscribe((msg) => seen.push(msg));

		src.set(2);
		captured?.({ ok: true, value: 3 });

		expect(seen).toContainEqual([
			"ERROR",
			expect.objectContaining({
				message: "workerDerived: backend completions must arrive after backend.run returns",
			}),
		]);
		expect(seen).not.toContainEqual(["DATA", 3]);
	});

	it("does not retain or cancel an already accepted backend completion", () => {
		const g = graph();
		const src = g.state(0, { name: "src" });
		let canceled = 0;
		let captured: CapturedWorker<number, number> | undefined;
		const worker = workerDerived<number, number>(g, [src], {
			name: "worker",
			prepare(ctx) {
				const value = depBatch(ctx, 0)?.at(-1) as number | undefined;
				return value === 0 ? undefined : value;
			},
			compute(input) {
				return input;
			},
			backend: {
				run(job, settle) {
					captured = { job, settle };
					return () => {
						canceled += 1;
					};
				},
			},
		});
		const seen: unknown[] = [];
		worker.subscribe((msg) => seen.push(msg));

		src.set(1);
		captured?.settle({ ok: true, value: 1 });
		src.set(2);

		expect(seen).toContainEqual(["DATA", 1]);
		expect(canceled).toBe(0);
	});

	it("cooperatively cancels superseded backend jobs", () => {
		const g = graph();
		const src = g.state(0, { name: "src" });
		let canceled = 0;
		const worker = workerDerived<number, number>(g, [src], {
			name: "worker",
			prepare(ctx) {
				return depBatch(ctx, 0)?.at(-1) as number | undefined;
			},
			compute(input) {
				return input;
			},
			backend: {
				run() {
					return () => {
						canceled += 1;
					};
				},
			},
		});
		worker.subscribe(() => undefined);

		src.set(1);
		src.set(2);
		src.set(0);

		expect(canceled).toBeGreaterThanOrEqual(2);
	});

	it("routes prepare errors as graph ERROR and does not submit a backend job", () => {
		const g = graph();
		const src = g.state(1, { name: "src" });
		let submitted = false;
		const worker = workerDerived<number, number>(g, [src], {
			name: "worker",
			prepare() {
				throw new Error("prepare failed");
			},
			compute(input) {
				return input + 1;
			},
			backend: {
				run() {
					submitted = true;
				},
			},
		});
		const seen: unknown[] = [];
		worker.subscribe((msg) => seen.push(msg));

		src.set(2);

		expect(submitted).toBe(false);
		expect(seen).toContainEqual(["ERROR", expect.objectContaining({ message: "prepare failed" })]);
	});

	it("passes a cloned owned input to the backend", () => {
		const g = graph();
		const src = g.state({ count: 1 }, { name: "src" });
		const inputs: { count: number }[] = [];
		const worker = workerDerived<{ count: number }, number>(g, [src], {
			name: "worker",
			prepare(ctx) {
				return depBatch(ctx, 0)?.at(-1) as { count: number } | undefined;
			},
			compute(input) {
				return input.count;
			},
			backend: {
				run(job) {
					inputs.push(job.input);
				},
			},
		});
		worker.subscribe(() => undefined);

		const next = { count: 2 };
		src.set(next);

		expect(inputs.at(-1)).toEqual(next);
		expect(inputs.at(-1)).not.toBe(next);
	});

	it("rejects non-cloneable worker inputs before backend submission", () => {
		const g = graph();
		const src = g.state(0, { name: "src" });
		let submitted = false;
		const worker = workerDerived<() => number, number>(g, [src], {
			name: "worker",
			prepare() {
				return () => 1;
			},
			compute(input) {
				return input();
			},
			backend: {
				run() {
					submitted = true;
				},
			},
		});
		const seen: unknown[] = [];
		worker.subscribe((msg) => seen.push(msg));

		src.set(1);

		expect(submitted).toBe(false);
		expect(seen).toContainEqual([
			"ERROR",
			expect.objectContaining({ message: "workerDerived: input must be owned and cloneable" }),
		]);
	});

	it("rejects symbol worker inputs before backend submission", () => {
		const g = graph();
		const src = g.state(0, { name: "src" });
		let submitted = false;
		const worker = workerDerived<symbol, number>(g, [src], {
			name: "worker",
			prepare() {
				return Symbol("not-cloneable");
			},
			compute() {
				return 1;
			},
			backend: {
				run() {
					submitted = true;
				},
			},
		});
		const seen: unknown[] = [];
		worker.subscribe((msg) => seen.push(msg));

		src.set(1);

		expect(submitted).toBe(false);
		expect(seen).toContainEqual([
			"ERROR",
			expect.objectContaining({ message: "workerDerived: input must be owned and cloneable" }),
		]);
	});
});
