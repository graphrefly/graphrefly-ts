/**
 * Tests nailing down actual behaviour for multi-message dep deliveries and
 * multi-emit-in-batch scenarios. These exist to ground the "K+1 diamond"
 * investigation in observed behavior rather than code tracing.
 *
 * Documented bug candidates surfaced by this file:
 *
 * - **Bug 1 (per-message fn invocation)**: multi-message batch delivered to
 *   a dep subscriber triggers `_maybeRunFnOnSettlement` per-message instead
 *   of once, violating `_execFn`'s documented "full wave batch" contract
 *   (see node.ts:1462–1466).
 *
 * - **Bug 2 (multi-emit-in-batch K+1 at fan-in)**: K `.emit()` calls inside
 *   one `batch(() => ...)` scope produce K+1 downstream settlements at a
 *   diamond fan-in node, not K (as the deferred-but-separate semantic would
 *   predict) and not 1 (as atomic coalescing would predict).
 *
 * Tests use raw `node([deps], fn)` so `fn` receives the raw `batchData`
 * (per-dep array of wave values) instead of the pre-unwrapped scalar that
 * `derived()` sugar hands to its user fn.
 */

import { describe, expect, it } from "vitest";
import { batch } from "../../core/batch.js";
import { DATA, START } from "../../core/messages.js";
import { node } from "../../core/node.js";

// Snapshot a batchData argument to a comparable shape.
function snapBatch(batchData: readonly (readonly unknown[] | undefined)[]): unknown[] {
	return batchData.map((b) => (b === undefined ? undefined : [...b]));
}

describe("multi-message delivery — fn-run contract", () => {
	it("single-dep: multi-DATA .down() on source fires derived fn per message today (design intent: once)", () => {
		const a = node([], { initial: 0 });
		const runs: unknown[][] = [];
		const b = node([a], (batchData, actions) => {
			runs.push(snapBatch(batchData));
			const last = (batchData[0] ?? []).at(-1);
			actions.emit(last as number);
		});
		const unsub = b.subscribe(() => {});
		runs.length = 0;

		(a as unknown as { down: (m: readonly (readonly [symbol, unknown?])[]) => void }).down([
			[DATA, 10],
			[DATA, 20],
			[DATA, 30],
		]);

		// Snapshot the observed behaviour. Under the current implementation
		// fn runs 3 times. Under the intended semantic (node.ts:1462 comment)
		// it should run once with batchData = [[10, 20, 30]].
		expect({ runCount: runs.length, runs }).toMatchSnapshot();
		unsub();
	});

	it("single-dep: source.emit() three times outside batch fires fn three times (one per wave)", () => {
		const a = node([], { initial: 0 });
		const runs: unknown[][] = [];
		const b = node([a], (batchData, actions) => {
			runs.push(snapBatch(batchData));
			actions.emit((batchData[0] ?? []).at(-1) as number);
		});
		const unsub = b.subscribe(() => {});
		runs.length = 0;

		(a as unknown as { emit: (v: number) => void }).emit(1);
		(a as unknown as { emit: (v: number) => void }).emit(2);
		(a as unknown as { emit: (v: number) => void }).emit(3);

		expect({ runCount: runs.length, runs }).toMatchSnapshot();
		unsub();
	});

	it("single-dep: K emits inside batch — documents current fn-run count at derived", () => {
		const a = node([], { initial: 0 });
		const runs: unknown[][] = [];
		const b = node([a], (batchData, actions) => {
			runs.push(snapBatch(batchData));
			actions.emit((batchData[0] ?? []).at(-1) as number);
		});
		const unsub = b.subscribe(() => {});
		runs.length = 0;

		batch(() => {
			(a as unknown as { emit: (v: number) => void }).emit(1);
			(a as unknown as { emit: (v: number) => void }).emit(2);
			(a as unknown as { emit: (v: number) => void }).emit(3);
		});

		expect({ runCount: runs.length, runs }).toMatchSnapshot();
		unsub();
	});

	it("diamond: K emits inside batch — fan-in D's fn-run count (the K+1 finding)", () => {
		const a = node([], { initial: 0 });
		const b = node([a], (batchData, actions) => {
			actions.emit((batchData[0] ?? []).at(-1) as number);
		});
		const c = node([a], (batchData, actions) => {
			actions.emit(((batchData[0] ?? []).at(-1) as number) + 10);
		});
		const dRuns: unknown[][] = [];
		const d = node([b, c], (batchData, actions) => {
			dRuns.push(snapBatch(batchData));
			const bv = ((batchData[0] ?? []).at(-1) as number) ?? 0;
			const cv = ((batchData[1] ?? []).at(-1) as number) ?? 0;
			actions.emit(bv + cv);
		});
		const unsub = d.subscribe(() => {});
		dRuns.length = 0;

		batch(() => {
			(a as unknown as { emit: (v: number) => void }).emit(1);
			(a as unknown as { emit: (v: number) => void }).emit(2);
		});

		expect({
			runCount: dRuns.length,
			runs: dRuns,
			finalD: (d as unknown as { cache?: number }).cache,
		}).toMatchSnapshot();
		unsub();
	});
});

describe("multi-message delivery — subscriber batch structure", () => {
	it("derived's own subscriber sees multi-DATA from a single source .down() as how many sink calls?", () => {
		const a = node([], { initial: 0 });
		const b = node([a], (batchData, actions) => {
			actions.emit((batchData[0] ?? []).at(-1) as number);
		});

		const sinkCalls: readonly [string, unknown?][][] = [];
		const unsub = b.subscribe((msgs) => {
			const call = (msgs as readonly [symbol, unknown?][])
				.filter((m) => m[0] !== START)
				.map((m) => [(m[0] as symbol).description, m[1]] as [string, unknown]);
			if (call.length > 0) sinkCalls.push(call);
		});
		sinkCalls.length = 0;

		(a as unknown as { down: (m: readonly (readonly [symbol, unknown?])[]) => void }).down([
			[DATA, 10],
			[DATA, 20],
			[DATA, 30],
		]);

		expect({ sinkCallCount: sinkCalls.length, calls: sinkCalls }).toMatchSnapshot();
		unsub();
	});

	it("diamond: K=2 emits in batch — per-node sink call counts", () => {
		const a = node([], { initial: 0 });
		const b = node([a], (batchData, actions) => {
			actions.emit((batchData[0] ?? []).at(-1) as number);
		});
		const c = node([a], (batchData, actions) => {
			actions.emit(((batchData[0] ?? []).at(-1) as number) + 10);
		});
		const d = node([b, c], (batchData, actions) => {
			const bv = ((batchData[0] ?? []).at(-1) as number) ?? 0;
			const cv = ((batchData[1] ?? []).at(-1) as number) ?? 0;
			actions.emit(bv + cv);
		});

		const calls = { a: 0, b: 0, c: 0, d: 0 };
		const ua = a.subscribe((msgs) => {
			if ((msgs as readonly [symbol, unknown?][]).some((m) => m[0] !== START)) calls.a += 1;
		});
		const ub = b.subscribe((msgs) => {
			if ((msgs as readonly [symbol, unknown?][]).some((m) => m[0] !== START)) calls.b += 1;
		});
		const uc = c.subscribe((msgs) => {
			if ((msgs as readonly [symbol, unknown?][]).some((m) => m[0] !== START)) calls.c += 1;
		});
		const ud = d.subscribe((msgs) => {
			if ((msgs as readonly [symbol, unknown?][]).some((m) => m[0] !== START)) calls.d += 1;
		});
		// Reset after activation.
		calls.a = 0;
		calls.b = 0;
		calls.c = 0;
		calls.d = 0;

		batch(() => {
			(a as unknown as { emit: (v: number) => void }).emit(1);
			(a as unknown as { emit: (v: number) => void }).emit(2);
		});

		expect(calls).toMatchSnapshot();
		ua();
		ub();
		uc();
		ud();
	});
});
