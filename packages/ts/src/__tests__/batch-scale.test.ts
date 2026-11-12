/**
 * R-request-order: a batch stages one array per node and appends to it in place, so N writes to
 * one node cost O(N). Before, each write copied and scanned the staged array: 100,000 writes took
 * about 56 s; now about 30 ms.
 */
import { describe, expect, it } from "vitest";
import { graph } from "../index.js";

describe("a batch with many writes to one node", () => {
	it("commits 100,000 writes as one array in well under a second", () => {
		const count = 100_000;
		const g = graph();
		const s = g.state(0, { name: "s" });
		const arrays: number[] = [];
		s.subscribe((msgs) => {
			const values = msgs.filter((m) => m[0] === "DATA").length;
			if (values > 0) arrays.push(values);
		});
		arrays.length = 0;
		const start = performance.now();
		g.batch(() => {
			for (let i = 1; i <= count; i++) s.set(i);
		});
		const ms = performance.now() - start;
		expect(arrays).toEqual([count]);
		expect(s.cache).toBe(count);
		expect(ms).toBeLessThan(1000);
	});

	it("still refuses a write after a staged terminal, for down and for set(fn)", () => {
		const g = graph();
		const s = g.state(0, { name: "s" });
		expect(() =>
			g.batch(() => {
				s.set(1);
				s.complete();
				s.set(2);
			}),
		).toThrow("a terminal must be the last message of its array (R-wave)");
		const t = g.state(0, { name: "t" });
		expect(() =>
			g.batch(() => {
				t.complete();
				t.set((n) => (n ?? 0) + 1);
			}),
		).toThrow("set: a terminal must be the last message of its array (R-wave)");
	});
});
