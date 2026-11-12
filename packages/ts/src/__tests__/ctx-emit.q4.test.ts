/** The user's Q4: ctx.emit(...values) sends exactly one array per call. */

import { describe, expect, it } from "vitest";
import { depBatch } from "../ctx/types.js";
import { graph, type Message } from "../index.js";

describe("ctx.emit (Q4)", () => {
	it("sends its values as one array per call, never merging calls", () => {
		const g = graph();
		const s = g.state(0, { name: "s" });
		const n = g.node<number>(
			[s],
			(ctx) => {
				if (depBatch(ctx, 0) === null) return;
				ctx.emit(1, 2);
				ctx.emit(3);
				ctx.emit();
			},
			{ name: "n" },
		);
		const arrays: Message[][] = [];
		n.subscribe((msgs) => {
			if (msgs[0]?.[0] !== "START") arrays.push([...msgs]);
		});
		s.set(1);
		expect(arrays).toEqual([
			[["PENDING"], ["DATA", 1], ["DATA", 2]],
			[["PENDING"], ["DATA", 3]],
		]);
	});
});
