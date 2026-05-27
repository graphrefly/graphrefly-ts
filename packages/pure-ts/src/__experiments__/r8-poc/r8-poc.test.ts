/**
 * Sanity tests — both Baseline and R8 must produce identical output on
 * the workloads the bench measures. If they diverge, the bench is invalid.
 */

import { describe, expect, it } from "vitest";
import { baselineNode } from "./baseline.js";
import type { Actions, Ctx, TinyNode } from "./protocol.js";
import { r8Node } from "./r8.js";

const lastOrPrev =
	(idx: number) =>
	(batchData: ReadonlyArray<unknown[] | null>, ctx: Ctx): unknown => {
		const b = batchData[idx];
		return b != null && b.length > 0 ? b.at(-1) : ctx.prevData[idx];
	};

function runDoubler(make: typeof baselineNode | typeof r8Node): number[] {
	const a = make<number>([], undefined, 0);
	const d = make<number>([a], (batchData, actions, ctx) => {
		const v = lastOrPrev(0)(batchData, ctx) as number;
		(actions as Actions<number>).emit(v * 2);
	});
	const received: number[] = [];
	d.subscribe((msg) => {
		if (msg[0] === "DATA") received.push(msg[1] as number);
	});
	for (let i = 1; i <= 5; i++) a.pushExternal(i);
	return received;
}

function runDiamond(make: typeof baselineNode | typeof r8Node): number[] {
	const a = make<number>([], undefined, 0);
	const b = make<number>([a], (batchData, actions, ctx) => {
		const v = lastOrPrev(0)(batchData, ctx) as number;
		(actions as Actions<number>).emit(v + 1);
	});
	const c = make<number>([a], (batchData, actions, ctx) => {
		const v = lastOrPrev(0)(batchData, ctx) as number;
		(actions as Actions<number>).emit(v * 10);
	});
	const d = make<number>(
		[b as TinyNode<unknown>, c as TinyNode<unknown>],
		(batchData, actions, ctx) => {
			const x = lastOrPrev(0)(batchData, ctx) as number;
			const y = lastOrPrev(1)(batchData, ctx) as number;
			(actions as Actions<number>).emit(x + y);
		},
	);
	const received: number[] = [];
	d.subscribe((msg) => {
		if (msg[0] === "DATA") received.push(msg[1] as number);
	});
	for (let i = 1; i <= 3; i++) a.pushExternal(i);
	return received;
}

describe("R8 PoC parity", () => {
	it("doubler chain matches between baseline and r8", () => {
		const base = runDoubler(baselineNode);
		const r8 = runDoubler(r8Node);
		expect(r8).toEqual(base);
		// Derived has not run a wave at subscribe time, so no push-on-subscribe.
		// Each pushExternal(i) triggers one wave → one DATA emission.
		expect(base).toEqual([2, 4, 6, 8, 10]);
	});

	it("diamond fan-in matches", () => {
		const base = runDiamond(baselineNode);
		const r8 = runDiamond(r8Node);
		expect(r8).toEqual(base);
		// Diamond fires d.fn once per wave: (a+1) + (a*10)
		// No initial wave → no push-on-subscribe value.
		// push 1: 2 + 10 = 12; push 2: 3 + 20 = 23; push 3: 4 + 30 = 34
		expect(base).toEqual([12, 23, 34]);
	});
});
