/**
 * D797 kernel migration, phase 5 (graphrefly-ts:D797-KERNEL-MIGRATION-TS): the request queue.
 *
 * TS harness for the request-order clauses of the root scenarios C-6, C-28, C-29 and C-34 in
 * ~/src/graphrefly/spec/conformance.jsonl, against R-request-order@2, and the rewire and replace
 * scenarios C-11, C-35, C-37 and C-40's replace clause, against R-request-order@2, R-lifetime@2
 * and R-node@2.
 */

import { describe, expect, it } from "vitest";
import { batch } from "../batch/batch.js";
import { type Ctx, depBatch, depLatest } from "../ctx/types.js";
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

describe("C-35: rewire keeps the instance and runs between waves", () => {
	function setup() {
		const g = graph();
		const b = g.state(1, { name: "b" });
		const c = g.state(10, { name: "c" });
		const e = g.state(0, { name: "e" });
		e.complete();
		const gNode = g.state<number>(undefined as unknown as number, { name: "g" });
		let kept: Ctx | undefined;
		const runs: unknown[][] = [];
		const d = g.node<number>(
			[b],
			(ctx) => {
				kept = ctx;
				runs.push(ctx.waveData.map((w) => w.flat()));
				ctx.state.set(((ctx.state.get<number>() ?? 0) as number) + 1);
				ctx.down([["DATA", (depLatest(ctx, 0) as number) * 1]]);
			},
			{ name: "d" },
		);
		const sink: Wave[] = [];
		const stop = d.subscribe((msgs) => sink.push(msgs));
		return { g, b, c, e, gNode, d, runs, sink, stop, ctx: () => kept as Ctx };
	}

	it("adds, reorders, removes and refuses as the rule says; the definition stays", () => {
		const f = setup();
		f.runs.length = 0;
		f.sink.length = 0;
		f.ctx().rewire([f.b, f.c]);
		expect(f.runs).toEqual([[[], [10]]]); // C's snapshot is one ordinary input wave
		expect(f.sink.some((a) => a[0]?.[0] === "START")).toBe(false);
		expect(f.d.deps).toEqual([f.b, f.c]);
		f.runs.length = 0;
		f.ctx().rewire([f.c, f.b]); // reorder: records kept, no run
		expect(f.runs).toEqual([]);
		f.ctx().rewire([f.c]); // remove B silently
		expect(f.runs).toEqual([]);
		f.b.set(2);
		expect(f.runs).toEqual([]); // B no longer drives D
		f.c.set(11);
		expect(f.runs).toHaveLength(1);
		f.runs.length = 0;
		f.ctx().rewire([f.c]); // the current list: nothing
		expect(f.runs).toEqual([]);
		f.ctx().rewire([f.c, f.gNode]); // G has no snapshot: no run
		expect(f.runs).toEqual([]);
		f.gNode.set(5);
		expect(f.runs).toHaveLength(1);
		expect(() => f.ctx().rewire([f.c, f.c])).toThrow(/duplicate/);
		expect(() => f.ctx().rewire([f.d])).toThrow(/itself/);
		const after = f.g.node<number>([f.d], () => {}, { name: "after" });
		after.subscribe(() => {});
		expect(() => f.ctx().rewire([f.c, after])).toThrow(/depends on it/);
		expect(f.g.definition(f.d).deps).toEqual([f.b]);
	});

	it("goes back to the declared dependencies when the lifetime closes; old ctx rewires drop", () => {
		const f = setup();
		f.ctx().rewire([f.c]);
		const old = f.ctx();
		f.stop();
		expect(f.d.deps).toEqual([f.b]);
		f.d.subscribe(() => {});
		expect(f.d.deps).toEqual([f.b]);
		old.rewire([f.c]); // through the closed lifetime's ctx: dropped
		expect(f.d.deps).toEqual([f.b]);
	});

	it("a rewire asked for inside the function waits until the wave ends", () => {
		const g = graph();
		const a = g.state(0, { name: "a" });
		const extra = g.state(7, { name: "extra" });
		const seen: number[] = [];
		const d = g.node<number>([a], (ctx) => {
			seen.push(ctx.waveData.length);
			if (depLatest(ctx, 0) === 1 && ctx.waveData.length === 1) ctx.rewire([a, extra]);
		});
		d.subscribe(() => {});
		a.set(1);
		expect(seen).toEqual([1, 1, 2]); // the rewire's run comes after the wave that asked
	});

	it("adding an ended dependency gives its snapshot, so its COMPLETE counts", () => {
		const g = graph();
		const s = g.state(1, { name: "s" });
		const e = g.state(2, { name: "e" });
		e.complete();
		let kept: Ctx | undefined;
		const d = g.node<number>([s], (ctx) => {
			kept = ctx;
		});
		d.subscribe(() => {});
		kept?.rewire([s, e]);
		expect(d.status.output).toBe("open"); // S has not ended
		s.complete();
		expect(d.status.output).toBe("completed");
	});
});

describe("C-11: a node rewires itself from its function, for its lifetime", () => {
	it("forwards the inner, releases the old inner, and starts again on [S] in a new lifetime", () => {
		const g = graph();
		const s = g.state<string>(undefined as unknown as string, { name: "s" });
		const inners = new Map<string, ReturnType<typeof g.state<number>>>();
		const innerOf = (v: string) => {
			let inner = inners.get(v);
			if (inner === undefined) {
				inner = g.state<number>(undefined as unknown as number, { name: `inner-${v}` });
				inners.set(v, inner);
			}
			return inner;
		};
		const out: Wave[] = [];
		const op = g.node<number>(
			[s],
			(ctx) => {
				ctx.state.set("kept");
				for (const v of depBatch(ctx, 0) ?? []) ctx.rewire([s, innerOf(v as string)]);
				for (let i = 1; i < ctx.waveData.length; i++)
					for (const x of depBatch(ctx, i) ?? []) ctx.down([["DATA", x as number]]);
			},
			{ name: "op", complete: "manual" },
		);
		const stop = op.subscribe((msgs) => out.push(msgs));
		s.set("a");
		expect(op.deps).toEqual([s, inners.get("a")]);
		const innerA = inners.get("a") as ReturnType<typeof g.state<number>>;
		innerA.set(1);
		expect(out.at(-1)).toEqual([["PENDING"], ["DATA", 1]]);
		s.set("b");
		expect(op.deps).toEqual([s, inners.get("b")]);
		expect((innerA as unknown as { _subscriberCount(): number })._subscriberCount()).toBe(0);
		expect(op.cache).toBe(1); // OP keeps its value across the rewires
		stop();
		// The lifetime closed: back on the declared [S].
		expect(op.deps).toEqual([s]);
		// The new lifetime starts on [S]; its first run sees S's snapshot and rewires again.
		op.subscribe(() => {});
		expect(op.deps).toEqual([s, inners.get("b")]);
	});
});

describe("C-37: a closed lifetime revokes old work while the node remains", () => {
	it("rewire keeps the lifetime; after a close the old ctx.down is dropped", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(2, { name: "b" });
		const ctxs: Ctx[] = [];
		const n = g.node<number>([a], (ctx) => {
			ctxs.push(ctx);
		});
		const log: Wave[] = [];
		const stop = n.subscribe((msgs) => log.push(msgs));
		const first = ctxs[0] as Ctx;
		first.rewire([a, b]);
		first.down([["DATA", 9]]); // late output from before the rewire, same lifetime
		expect(log.at(-1)).toEqual([["PENDING"], ["DATA", 9]]);
		stop();
		n.subscribe((msgs) => log.push(msgs));
		const count = log.length;
		first.down([["DATA", 10]]);
		expect(log).toHaveLength(count);
		expect(n.deps).toEqual([a]);
		expect(ctxs.at(-1)).not.toBe(first);
	});
});

describe("C-40: replace gives an ended node a new instance", () => {
	it("its sink receives START and the new snapshot after the old COMPLETE", () => {
		const g = graph();
		const s = g.state(1, { name: "s" });
		s.complete();
		const t = g.state(5, { name: "t" });
		const d = g.node<number>([s], (ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]), {
			name: "d",
		});
		const log: Wave[] = [];
		d.subscribe((msgs) => log.push(msgs));
		expect(d.status.output).toBe("completed");
		g.replace(d, [t], (ctx) => ctx.down([["DATA", (depLatest(ctx, 0) as number) * 2]]), {
			recipe: { ref: "double" },
		});
		expect(log.at(-1)).toEqual([["START"], ["DATA", 10]]);
		expect(d.status.output).toBe("open");
		expect(g.definition(d)).toMatchObject({ deps: [t], recipe: { ref: "double" } });
		t.set(6);
		expect(d.cache).toBe(12);
		expect(() => g.replace(s, [], () => {})).toThrow(/state node/);
	});
});
