/**
 * D797 kernel migration, phase 5 (graphrefly-ts:D797-KERNEL-MIGRATION-TS): the request queue.
 *
 * TS harness for the request-order clauses of the root scenarios C-6, C-28, C-29 and C-34 in
 * ~/src/graphrefly/spec/conformance.jsonl, against R-request-order@2, and the rewire and replace
 * scenarios C-11, C-35, C-37 and C-40's replace clause, against R-request-order@2, R-lifetime@2
 * and R-node@2.
 */

import { describe, expect, it } from "vitest";
import type { Ctx } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import { subscriberCountOfNode } from "../node/runtime-accessors.js";
import type { Wave } from "../protocol/messages.js";
import { arraySink, collect } from "./helpers/collect.js";

const plus1 = (ctx: Ctx) => ctx.down([["DATA", (ctx.deps[0].value as number) + 1]]);

describe("C-6: a function's write to its own upstream is a later request, never a reentry", () => {
	it("runs as a request after the wave; the loop ends when the composition stops writing", () => {
		// state S -> D (= n+1) -> E; E writes S while D is below 3, closing S->D->E->S.
		const g = graph();
		const s = g.node<number>([], null, { initial: 0 });
		const d = g.node<number>([s], plus1);
		const runs: number[] = [];
		const e = g.node<number>([d], (ctx: Ctx) => {
			const v = ctx.deps[0].value as number;
			runs.push(v);
			if (v < 3) s.set(v);
		});
		expect(() => e.subscribe(() => {})).not.toThrow();
		expect(runs).toEqual([1, 2, 3]);
		expect(d.cache).toBe(3);
		expect(e.status.output).toBe("open");
	});

	it("an acyclic chain does NOT throw (the guard does not false-positive)", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 1 });
		const d = g.node<number>([s], plus1);
		const e = g.node<number>([d], (ctx: Ctx) => ctx.down([["DATA", ctx.deps[0].value as number]]));
		expect(() => e.subscribe(() => {})).not.toThrow();
		expect(e.cache).toBe(2);
	});
});

describe("C-28: sink requests run after the whole fanout", () => {
	it("a set and a subscribe from a sink wait until every sink has its array", () => {
		const g = graph();
		const a = g.state(0, { name: "a" });
		const first = arraySink();
		const second = arraySink();
		const late = arraySink();
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
		const log = arraySink();
		let result: unknown;
		let readInBody: unknown;
		a.subscribe((msgs) => {
			if (result === undefined && msgs.some((m) => m[0] === "DATA" && m[1] === 1)) {
				result = g.batch(() => {
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
		const b = g.node<number>([a], (ctx) => ctx.down([["DATA", ctx.deps[0].value as number]]), {
			name: "b",
		});
		const s = arraySink();
		const t = arraySink();
		b.subscribe(s.sink);
		s.log.length = 0;
		g.batch(() => {
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
		const s = arraySink();
		const t = arraySink();
		a.subscribe(s.sink);
		s.log.length = 0;
		expect(() =>
			g.batch(() => {
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
		const s = arraySink();
		g.node<number>([a, b], (ctx) => ctx.down([["DATA", 1]]), { name: "n" }).subscribe(s.sink);
		s.log.length = 0;
		let inner: unknown;
		g.batch(() => {
			a.set(1);
			inner = g.batch(() => {
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
		g.batch(() => {
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
			g.batch(() => {
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
		const s = arraySink();
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
				if (ctx.deps[0].value === 1) ctx.down([["DATA", 1], ["COMPLETE"]]);
			},
			{ name: "s" },
		);
		const z = arraySink();
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
				runs.push(ctx.deps.map((d) => d.waves.flat()));
				ctx.state.set(((ctx.state.get<number>() ?? 0) as number) + 1);
				ctx.down([["DATA", (ctx.deps[0].value as number) * 1]]);
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
			seen.push(ctx.deps.length);
			if (ctx.deps[0].value === 1 && ctx.deps.length === 1) ctx.rewire([a, extra]);
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
				for (const v of ctx.deps[0].waves.flat()) ctx.rewire([s, innerOf(v as string)]);
				for (let i = 1; i < ctx.deps.length; i++)
					for (const x of ctx.deps[i].waves.flat()) ctx.down([["DATA", x as number]]);
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
		expect(subscriberCountOfNode(innerA)).toBe(0);
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
		expect(ctxs.at(-1) === first).toBe(false);
	});
});

describe("C-40: replace gives an ended node a new instance", () => {
	it("its sink receives START and the new snapshot after the old COMPLETE", () => {
		const g = graph();
		const s = g.state(1, { name: "s" });
		s.complete();
		const t = g.state(5, { name: "t" });
		const d = g.node<number>([s], (ctx) => ctx.down([["DATA", ctx.deps[0].value as number]]), {
			name: "d",
		});
		const log: Wave[] = [];
		d.subscribe((msgs) => log.push(msgs));
		expect(d.status.output).toBe("completed");
		g.replace(d, [t], (ctx) => ctx.down([["DATA", (ctx.deps[0].value as number) * 2]]), {
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

/**
 * Later output (Codex review §5.1): a quiet node's run output and a ctx.down after the function
 * returned both go out after the current wave, as a wave of their own (R-wave@2), are requests of
 * the node's graph (R-request-order@2), and are dropped when they run if the lifetime they were
 * made in has closed, the node has ended or it is released (R-lifetime@2).
 */
describe("R-wave@2 / C-16: a quiet node's activation snapshot comes before its run output", () => {
	const times10 = (ctx: Ctx) => ctx.down([["DATA", (ctx.deps[0].value as number) * 10]]);
	const hasData = (msgs: Wave, v: unknown) => msgs.some((m) => m[0] === "DATA" && m[1] === v);

	it("the first sink gets a bare START, then the first run's output as a wave of its own", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const q = g.node<number>([a], times10, { name: "q", quiet: true });
		const first = collect(q);
		expect(first.arrays).toEqual([[["START"]], [["PENDING"], ["DATA", 10]]]);
		// A later sink's START carries the published output.
		expect(collect(q).arrays).toEqual([[["START"], ["DATA", 10]]]);
		a.set(2);
		expect(first.arrays.at(-1)).toEqual([["PENDING"], ["DATA", 20]]);
	});

	it("a sink subscribed in the same wave as the activating one also gets START before the output", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const t = g.state(0, { name: "t" });
		const q = g.node<number>([a], times10, { name: "q", quiet: true });
		const first = arraySink();
		const second = arraySink();
		t.subscribe((msgs) => {
			if (!hasData(msgs, 1)) return;
			q.subscribe(first.sink); // activates q; its output is queued after the next subscribe
			q.subscribe(second.sink);
		});
		t.set(1);
		expect(first.log).toEqual([[["START"]], [["PENDING"], ["DATA", 10]]]);
		expect(second.log).toEqual([[["START"]], [["PENDING"], ["DATA", 10]]]);
	});

	it("a dependent activated through q sees q's first output as one later input wave", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const q = g.node<number>([a], times10, { name: "q", quiet: true });
		const runs: unknown[][][] = [];
		const d = g.node<number>([q], (ctx) => {
			runs.push(ctx.deps[0].waves.map((w) => [...w]));
		});
		collect(d);
		// d's activation run sees q's empty snapshot; q's first output is d's next input wave.
		expect(runs).toEqual([[], [[10]]]);
	});
});

describe("R-wave@2 / R-terminals: a quiet node's auto terminal and its run output keep their order", () => {
	const quietTimes10 = (g: ReturnType<typeof graph>, a: Node<number>) =>
		g.node<number>(
			[a],
			(ctx) => {
				for (const v of ctx.deps[0].waves.flat()) ctx.down([["DATA", (v as number) * 10]]);
			},
			{ name: "q", quiet: true },
		);

	it("one input wave of DATA and COMPLETE: the run's output, then the auto COMPLETE, in one later wave", () => {
		const g = graph();
		const a = g.state(0, { name: "a" });
		const q = quietTimes10(g, a);
		const runs: [unknown[][], unknown][] = [];
		const d = g.node<number>([q], (ctx) => {
			runs.push([ctx.deps[0].waves.map((w) => [...w]), ctx.deps[0].terminal]);
		});
		collect(d);
		const s = collect(q);
		s.arrays.length = 0;
		runs.length = 0;
		g.batch(() => {
			a.set(1);
			a.complete();
		});
		expect(s.arrays).toEqual([
			[["PENDING"], ["DATA", 10]],
			[["PENDING"], ["COMPLETE"]],
		]);
		expect(runs).toEqual([[[[10]], { kind: "complete" }]]); // one run of d on both arrays
		expect(q.status.output).toBe("completed");
	});

	it("a COMPLETE requested before q's output is queued still follows that output", () => {
		const g = graph();
		const a = g.state(0, { name: "a" });
		// a's first sink asks for COMPLETE in the wave of DATA 1, before q queues its output.
		a.subscribe((msgs) => {
			if (msgs.some((m) => m[0] === "DATA" && m[1] === 1)) a.complete();
		});
		const q = quietTimes10(g, a);
		const s = collect(q);
		s.arrays.length = 0;
		a.set(1);
		expect(s.arrays).toEqual([
			[["PENDING"], ["DATA", 10]],
			[["PENDING"], ["COMPLETE"]],
		]);
	});

	it("an auto ERROR in the input wave ends q without its run; an ERROR in a later request follows the output", () => {
		const boom = new Error("boom");
		const g = graph();
		const a = g.state(0, { name: "a" });
		const q = quietTimes10(g, a);
		const s = collect(q);
		s.arrays.length = 0;
		g.batch(() => {
			a.set(1);
			a.error(boom);
		});
		expect(s.arrays).toEqual([[["PENDING"], ["ERROR", boom]]]);

		const g2 = graph();
		const b = g2.state(0, { name: "b" });
		b.subscribe((msgs) => {
			if (msgs.some((m) => m[0] === "DATA" && m[1] === 1)) b.error(boom);
		});
		const q2 = quietTimes10(g2, b);
		const s2 = collect(q2);
		s2.arrays.length = 0;
		b.set(1);
		expect(s2.arrays).toEqual([
			[["PENDING"], ["DATA", 10]],
			[["PENDING"], ["ERROR", boom]],
		]);
	});
});

describe("R-lifetime@2: a quiet node's output from before its first run belongs to its activation", () => {
	const boom = new Error("boom");
	const setup = () => {
		const g = graph();
		const e = g.state(0, { name: "e" });
		e.error(boom);
		const t = g.state(0, { name: "t" });
		// An auto ERROR from an ended dependency ends q at activation without running its function.
		let ran = 0;
		const q = g.node<number>(
			[e],
			(ctx) => {
				ran++;
				ctx.down([["DATA", 1]]);
			},
			{ name: "q", quiet: true },
		);
		return { g, t, q, ran: () => ran };
	};

	it("stands while q is still active", () => {
		const { q, ran } = setup();
		const s = collect(q);
		expect(s.arrays).toEqual([[["START"]], [["PENDING"], ["ERROR", boom]]]);
		expect(ran()).toBe(0);
		expect(q.status.output).toBe("errored");
	});

	it("is dropped when q is deactivated before it goes out", () => {
		const { t, q } = setup();
		const log = arraySink();
		t.subscribe((msgs) => {
			if (!msgs.some((m) => m[0] === "DATA" && m[1] === 1)) return;
			// Both are requests: the subscribe activates q and queues its ERROR after the stop.
			const stop = q.subscribe(log.sink);
			stop();
		});
		t.set(1);
		expect(log.log).toEqual([[["START"]]]);
		expect(q.status).toMatchObject({ output: "open", lifecycle: "inactive" });
	});

	it("does not cross a replace into the new instance (C-40, R-node@2)", () => {
		const { g, t, q } = setup();
		const ok = g.state(5, { name: "ok" });
		const log = arraySink();
		t.subscribe((msgs) => {
			if (!msgs.some((m) => m[0] === "DATA" && m[1] === 1)) return;
			// The replace is asked for first, so it runs before the old instance's queued ERROR.
			q.subscribe(log.sink);
			g.replace(q, [ok], (ctx) => ctx.down([["DATA", (ctx.deps[0].value as number) * 10]]));
		});
		t.set(1);
		expect(log.log).toEqual([[["START"]], [["START"]], [["PENDING"], ["DATA", 50]]]);
		expect(q.status.output).toBe("open");
	});
});

describe("C-25 / D110: a quiet node's output made while a commit is delivered shares the commit's fate", () => {
	const quietTimes10 = (g: ReturnType<typeof graph>, a: Node<number>) =>
		g.node<number>([a], (ctx) => ctx.down([["DATA", (ctx.deps[0].value as number) * 10]]), {
			name: "q",
			quiet: true,
		});

	it("is dropped when the commit fails after q ran on it", () => {
		const g = graph();
		const a = g.state(0, { name: "a" });
		const c = g.state(0, { name: "c" });
		const q = quietTimes10(g, a);
		const as = collect(a);
		const qs = collect(q);
		as.arrays.length = 0;
		qs.arrays.length = 0;
		// a delivers first, so q runs and queues DATA 10; c's write then fails the commit.
		expect(() =>
			g.batch(() => {
				a.set(1);
				c.set(() => undefined as unknown as number);
			}),
		).toThrow(/non-SENTINEL/);
		expect(as.arrays).toEqual([[["PENDING"], ["DATA", 1]]]);
		expect(qs.arrays).toEqual([]);
		expect(q.cache).toBe(0);
	});

	it("is delivered after a commit that succeeds", () => {
		const g = graph();
		const a = g.state(0, { name: "a" });
		const c = g.state(0, { name: "c" });
		const q = quietTimes10(g, a);
		const qs = collect(q);
		qs.arrays.length = 0;
		g.batch(() => {
			a.set(1);
			c.set(() => 5);
		});
		expect(qs.arrays).toEqual([[["PENDING"], ["DATA", 10]]]);
	});
});

describe("R-wave@2 / R-lifetime@2: a ctx.down after the function returned", () => {
	const keeper = (g: ReturnType<typeof graph>) => {
		const ctxs: Ctx[] = [];
		const src = g.node<string>(
			[],
			(ctx) => {
				ctxs.push(ctx);
			},
			{ name: "src" },
		);
		return { src, ctxs };
	};
	const onData = (node: Node<number>, v: number, act: () => void) =>
		node.subscribe((msgs) => {
			if (msgs.some((m) => m[0] === "DATA" && m[1] === v)) act();
		});

	it("is delivered at once outside a wave, and during a wave as its own wave after it", () => {
		const g = graph();
		const t = g.state(0, { name: "t" });
		const { src, ctxs } = keeper(g);
		const order: string[] = [];
		const s = collect(src);
		src.subscribe((msgs) => {
			if (msgs[0]?.[0] !== "START") order.push("src");
		});
		s.arrays.length = 0;
		(ctxs[0] as Ctx).down([["DATA", "now"]]);
		expect(s.arrays).toEqual([[["PENDING"], ["DATA", "now"]]]);

		onData(t, 1, () => (ctxs[0] as Ctx).down([["DATA", "late"]]));
		t.subscribe(() => order.push("t second"));
		order.length = 0;
		t.set(1);
		expect(order).toEqual(["t second", "src"]);
		expect(s.arrays.at(-1)).toEqual([["PENDING"], ["DATA", "late"]]);
	});

	it("is dropped after its lifetime closed: at the call, and when it runs after a queued close", () => {
		const g = graph();
		const t = g.state(0, { name: "t" });
		const { src, ctxs } = keeper(g);
		src.subscribe(() => {})();
		const log = arraySink();
		const stop = src.subscribe(log.sink);
		log.log.length = 0;
		(ctxs[0] as Ctx).down([["DATA", "stale"]]); // the first lifetime's ctx
		expect(log.log).toEqual([]);
		expect(src.cache).toBeUndefined();

		// The last sink's leave is asked for first, so the lifetime closes before the queued output.
		const current = ctxs[1] as Ctx;
		onData(t, 1, () => {
			stop();
			current.down([["DATA", "after close"]]);
		});
		t.set(1);
		expect(current.signal.aborted).toBe(true);
		expect(log.log).toEqual([]);
		expect(src.cache).toBeUndefined(); // published on the inactive node, it would be retained
	});

	it("is dropped after a replace gave the node a new instance", () => {
		const g = graph();
		const t = g.state(0, { name: "t" });
		const { src, ctxs } = keeper(g);
		const s = collect(src);
		onData(t, 1, () => {
			g.replace(src, [], () => {});
			(ctxs[0] as Ctx).down([["DATA", "old instance"]]);
		});
		s.arrays.length = 0;
		t.set(1);
		expect(s.arrays).toEqual([[["START"]]]);
		expect(src.cache).toBeUndefined();
	});

	it("made while a commit is delivered, is a request like set and survives a failed commit (R-request-order@2)", () => {
		const g = graph();
		const a = g.state(0, { name: "a" });
		const c = g.state(0, { name: "c" });
		const { src, ctxs } = keeper(g);
		const s = collect(src);
		onData(a, 1, () => (ctxs[0] as Ctx).down([["DATA", "late"]]));
		s.arrays.length = 0;
		expect(() =>
			g.batch(() => {
				a.set(1);
				c.set(() => undefined as unknown as number);
			}),
		).toThrow(/non-SENTINEL/);
		expect(s.arrays).toEqual([[["PENDING"], ["DATA", "late"]]]);
		s.arrays.length = 0;
		g.batch(() => a.set(2));
		onData(a, 3, () => (ctxs[0] as Ctx).down([["DATA", "committed"]]));
		g.batch(() => a.set(3));
		expect(s.arrays).toEqual([[["PENDING"], ["DATA", "committed"]]]);
	});

	it("is dropped after the node ended, also when both were queued in one wave", () => {
		const g = graph();
		const t = g.state(0, { name: "t" });
		const { src, ctxs } = keeper(g);
		const s = collect(src);
		onData(t, 1, () => {
			(ctxs[0] as Ctx).down([["COMPLETE"]]);
			(ctxs[0] as Ctx).down([["DATA", "after end"]]);
		});
		s.arrays.length = 0;
		t.set(1);
		expect(s.arrays).toEqual([[["PENDING"], ["COMPLETE"]]]);
		(ctxs[0] as Ctx).down([["DATA", "later still"]]);
		expect(s.arrays).toHaveLength(1);
		expect(src.cache).toBeUndefined();
	});
});
