/**
 * A run whose value count follows its input sends them with `ctx.down`, not `ctx.emit(...values)`:
 * spreading that many arguments exceeds the engine's limit (on Node 24, past about 120,000).
 */
import { describe, expect, it } from "vitest";
import { lightReactiveView } from "../graph/data-structures/core.js";
import { graph } from "../index.js";

describe("a run with more values than a call can spread", () => {
	it("a light view's delta forwards 200,000 values received in one array as one array", () => {
		const count = 200_000;
		const g = graph();
		const source = g.producer<number>(
			(ctx) => ctx.down(Array.from({ length: count }, (_, i) => ["DATA", i + 1] as const)),
			{ name: "source" },
		);
		const view = lightReactiveView<number, null>(g, source, {
			factory: "test.view",
			materializeSnapshot: () => null,
		});
		const arrays: number[] = [];
		view.delta.subscribe((msgs) => {
			const values = msgs.filter((m) => m[0] === "DATA").length;
			if (values > 0) arrays.push(values);
		});
		expect(arrays).toEqual([count]);
		expect(view.delta.cache).toBe(count);
	});
});
