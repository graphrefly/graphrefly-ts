/**
 * D797 kernel migration, phase 5 (graphrefly-ts:D797-KERNEL-MIGRATION-TS): the request queue.
 *
 * TS harness for the request-order clauses of the root scenarios C-6, C-28, C-29 and C-34 in
 * ~/src/graphrefly/spec/conformance.jsonl, against R-request-order@2.
 */

import { describe, expect, it } from "vitest";
import { batch } from "../batch/batch.js";
import { depLatest } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import type { Wave } from "../protocol/messages.js";

function arrays(): { log: Wave[]; sink: (msgs: Wave) => void } {
	const log: Wave[] = [];
	return { log, sink: (msgs) => log.push(msgs) };
}

describe("C-28: sink requests run after the whole fanout", () => {
	it("a set and a subscribe from a sink wait until every sink has its array", () => {
		const g = graph();
		const a = g.state(0, { name: "a" });
		const first = arrays();
		const second = arrays();
		const late = arrays();
		let done = false;
		a.subscribe((msgs) => {
			first.log.push(msgs);
			if (!done && msgs.some((m) => m[0] === "DATA" && m[1] === 1)) {
				done = true;
				a.set(2);
				a.subscribe(late.sink);
				expect(second.log.at(-1)).toEqual([["START"], ["DATA", 0]]);
				expect(late.log).toEqual([]);
			}
		});
		a.subscribe(second.sink);
		a.set(1);
		expect(second.log).toEqual([
			[["START"], ["DATA", 0]],
			[["PENDING"], ["DATA", 1]],
			[["PENDING"], ["DATA", 2]],
		]);
		// The queue keeps request order: the set ran first, so the subscriber starts from 2.
		expect(late.log).toEqual([[["START"], ["DATA", 2]]]);
	});

	it("a batch opened from a sink stages at once and commits after the wave as one wave", () => {
		const g = graph();
		const a = g.state(0, { name: "a" });
		const log = arrays();
		let result: unknown;
		let readInBody: unknown;
		a.subscribe((msgs) => {
			if (result === undefined && msgs.some((m) => m[0] === "DATA" && m[1] === 1)) {
				result = batch(() => {
					readInBody = a.cache;
					a.set(5);
					a.set(6);
					return "done";
				});
				expect(a.cache).toBe(1);
			}
		});
		a.subscribe(log.sink);
		a.set(1);
		expect(result).toBe("done");
		expect(readInBody).toBe(1);
		expect(log.log.slice(1)).toEqual([
			[["PENDING"], ["DATA", 1]],
			[["PENDING"], ["DATA", 5], ["DATA", 6]],
		]);
	});
});

describe("C-29: a batch delivers nothing before commit; its requests follow the commit", () => {
	it("commits the sets as one wave, then runs the subscribe against the committed value", () => {
		const g = graph();
		const a = g.state(0, { name: "a" });
		const b = g.node<number>([a], (ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]), {
			name: "b",
		});
		const s = arrays();
		const t = arrays();
		b.subscribe(s.sink);
		s.log.length = 0;
		batch(() => {
			a.set(1);
			b.subscribe(t.sink);
			expect(a.cache).toBe(0);
			expect(s.log).toEqual([]);
			expect(t.log).toEqual([]);
		});
		expect(s.log).toEqual([[["PENDING"], ["DATA", 1]]]);
		expect(t.log).toEqual([[["START"], ["DATA", 1]]]);
	});

	it("a throwing body commits nothing and drops its requests", () => {
		const g = graph();
		const a = g.state(0, { name: "a" });
		const s = arrays();
		const t = arrays();
		a.subscribe(s.sink);
		s.log.length = 0;
		expect(() =>
			batch(() => {
				a.set(1);
				a.subscribe(t.sink);
				throw new Error("body");
			}),
		).toThrow("body");
		expect(s.log).toEqual([]);
		expect(t.log).toEqual([]);
		expect(a.cache).toBe(0);
	});

	it("refuses an async body; a promise body commits its synchronous part and tells the reporter", () => {
		const reports: unknown[] = [];
		const g = graph({ report: (failure) => reports.push(failure.error) });
		const a = g.state(0, { name: "a" });
		let ran = false;
		expect(() =>
			g.batch(async () => {
				ran = true;
			}),
		).toThrow(/async/);
		expect(ran).toBe(false);
		g.batch(() => {
			a.set(1);
			return Promise.resolve();
		});
		expect(a.cache).toBe(1);
		expect(reports).toHaveLength(1);
	});

	it("a nested batch joins the outer commit and returns its value", () => {
		const g = graph();
		const a = g.state(0, { name: "a" });
		const b = g.state(0, { name: "b" });
		const s = arrays();
		g.node<number>([a, b], (ctx) => ctx.down([["DATA", 1]]), { name: "n" }).subscribe(s.sink);
		s.log.length = 0;
		let inner: unknown;
		batch(() => {
			a.set(1);
			inner = batch(() => {
				b.set(1);
				return "inner";
			});
			expect(s.log).toEqual([]);
		});
		expect(inner).toBe("inner");
		expect(s.log).toEqual([[["PENDING"], ["DATA", 1]]]);
	});

	it("set(fn) runs at the commit in staging order, and a throw commits nothing", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(0, { name: "b" });
		const seen: unknown[] = [];
		batch(() => {
			a.set((v) => {
				seen.push(v);
				return (v as number) + 1;
			});
			a.set(10);
			a.set((v) => {
				seen.push(v);
				return (v as number) + 1;
			});
			a.invalidate();
			a.set((v) => {
				seen.push(v);
				return 99;
			});
		});
		expect(seen).toEqual([1, 10, undefined]);
		expect(a.cache).toBe(99);

		expect(() =>
			batch(() => {
				b.set(1);
				a.set(() => {
					throw new Error("fn");
				});
			}),
		).toThrow("fn");
		expect(b.cache).toBe(0);
		expect(a.cache).toBe(99);
	});

	it("a function returning its argument writes nothing; an equal plain value is written", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const s = arrays();
		a.subscribe(s.sink);
		s.log.length = 0;
		a.set((v) => v as number);
		expect(s.log).toEqual([]);
		a.set(1);
		expect(s.log).toEqual([[["PENDING"], ["DATA", 1]]]);
	});
});

describe("C-34: a subscribe made during a fanout runs after it", () => {
	it("gives the late sink the ended node's snapshot after the fanout", () => {
		const g = graph();
		const t = g.state<number>(0, { name: "t" });
		const s = g.node<number>(
			[t],
			(ctx) => {
				if (depLatest(ctx, 0) === 1) ctx.down([["DATA", 1], ["COMPLETE"]]);
			},
			{ name: "s" },
		);
		const z = arrays();
		const order: string[] = [];
		let subscribed = false;
		s.subscribe((msgs) => {
			if (!subscribed && msgs.some((m) => m[0] === "COMPLETE")) {
				subscribed = true;
				s.subscribe((m) => {
					order.push("z");
					z.log.push(m);
				});
			}
			order.push("x");
		});
		s.subscribe(() => order.push("y"));
		order.length = 0;
		t.set(1);
		expect(order).toEqual(["x", "y", "z"]);
		expect(z.log).toEqual([[["START"], ["DATA", 1], ["COMPLETE"]]]);
	});
});
