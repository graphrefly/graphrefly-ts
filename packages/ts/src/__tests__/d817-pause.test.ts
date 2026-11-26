/**
 * D817 kernel report, phase 2 (graphrefly-ts:D817-KERNEL-REPORT-TS, graphrefly-ts:D194 (3)): the
 * pause module.
 *
 * TS harness for the root scenarios C-30, C-31, C-46 (its pause clause) and C-60 (4) in
 * ~/src/graphrefly/spec/conformance.jsonl, against R-pause@2 (graphrefly:D830) with R-wave@4,
 * R-terminals@2, R-invalidation@2, R-lifetime@2, R-request-order@7 and R-checkpoint@3. The cases
 * follow the scenario first and reference/modules/pause.test.mjs, pause.replay.test.mjs and the
 * pause clause of reference/modules/checkpoint.test.mjs second; those are candidate evidence only.
 */
import { describe, expect, it } from "vitest";
import type { NodeFn } from "../ctx/types.js";
import type { HostFailure } from "../graph/graph-types.js";
import { pausable, pausableOf, pauseLocks } from "../graph/pause.js";
import {
	defaultRestoreRegistry,
	type Graph,
	graph,
	type Message,
	type Node,
	restoreGraph,
	type StateNode,
} from "../index.js";
import type { Wave } from "../protocol/messages.js";

const none = <T>() => undefined as unknown as T;
const pending = (...msgs: Message[]): Wave => [["PENDING"], ...msgs];
const RESOLVED: Wave = pending(["RESOLVED"]);
const asState = <T>(n: Node<unknown> | undefined) => n as unknown as StateNode<T>;
const isData = (m: Message) => m[0] === "DATA";

/** A sink that keeps every array it receives. */
function record(n: Node<unknown>) {
	const arrays: Wave[] = [];
	const stop = n.subscribe((w) => arrays.push(w));
	return { arrays, stop };
}
/** The arrays a sink received while `body` ran. */
function during(arrays: readonly Wave[], body: () => void): Wave[] {
	const start = arrays.length;
	body();
	return arrays.slice(start);
}
const dataOf = (w: Wave) => w.filter(isData).map((m) => m[1]);
/** The DATA payloads of each array that carried DATA, keeping array boundaries. */
const dataArrays = (arrays: readonly Wave[]) => arrays.map(dataOf).filter((d) => d.length > 0);
const roundTrip = (g: Graph) => JSON.parse(JSON.stringify(g.checkpoint()));

/** C-30's topology: state a, x = a * 10 counting its runs, pausable p after x with a sink. */
function c30() {
	const g = graph();
	const a = g.state(1, { name: "a" });
	const runs = { x: 0 };
	const x = g.derived(
		[a],
		(v) => {
			runs.x++;
			return v * 10;
		},
		{ name: "x" },
	);
	const p = pausable(g, x, { name: "p" });
	return { g, a, x, p, runs };
}

describe("C-30 (R-pause@2): a pausable holds arrays until the last lock is released", () => {
	it("x keeps computing while paused; the resume sends both held arrays in one wave, each as it arrived, without rerunning x", () => {
		const f = c30();
		const s = record(f.p.node);
		// Placed before a node, the pausable's release is one input wave of that node.
		const seen: unknown[][][] = [];
		const after = f.g.node(
			[f.p.node],
			(ctx) => void seen.push(ctx.deps[0].waves.map((w) => [...w])),
			{
				name: "after",
			},
		);
		record(after);
		const lock = f.p.pause();
		f.runs.x = 0;
		expect(during(s.arrays, () => f.a.set(2))).toEqual([RESOLVED]);
		expect(during(s.arrays, () => f.a.set(3))).toEqual([RESOLVED]);
		expect(f.runs.x).toBe(2);
		seen.length = 0;
		expect(during(s.arrays, () => f.p.resume(lock))).toEqual([
			pending(["DATA", 20]),
			pending(["DATA", 30]),
		]);
		expect(f.runs.x).toBe(2);
		expect(seen).toEqual([[[20], [30]]]);
	});

	it("two re-pauses from the sink during the resume wave are sets with a function that apply after it; both locks hold", () => {
		const f = c30();
		const again: string[] = [];
		let armed = false;
		const arrays: Wave[] = [];
		f.p.node.subscribe((w) => {
			arrays.push(w);
			if (armed && again.length === 0 && w.some(isData)) again.push(f.p.pause(), f.p.pause());
		});
		const lock = f.p.pause();
		f.a.set(2);
		f.a.set(3);
		armed = true;
		expect(during(arrays, () => f.p.resume(lock))).toEqual([
			pending(["DATA", 20]),
			pending(["DATA", 30]),
			RESOLVED,
			RESOLVED,
		]);
		expect(new Set(again).size).toBe(2);
		expect(f.p.locks.cache).toEqual(again);
		expect(during(arrays, () => f.a.set(4))).toEqual([RESOLVED]);
		expect(during(arrays, () => f.p.resume(again[0]))).toEqual([RESOLVED]);
		expect(f.p.locks.cache).toEqual([again[1]]);
		// Resuming a lock nobody holds writes nothing and starts no wave.
		const lockArrays = record(f.p.locks).arrays;
		const before = lockArrays.length;
		expect(during(arrays, () => f.p.resume("nobody"))).toEqual([]);
		expect(lockArrays.length).toBe(before);
		expect(during(arrays, () => f.p.resume(again[1]))).toEqual([pending(["DATA", 40])]);
	});

	it("the lock state is the only copy: the handle releases a lock written into the state directly", () => {
		const f = c30();
		const s = record(f.p.node);
		f.p.locks.set(Object.freeze(["p#saved"])); // as a restore brings it back
		expect(during(s.arrays, () => f.a.set(2))).toEqual([RESOLVED]);
		expect(during(s.arrays, () => f.p.resume("p#saved"))).toEqual([pending(["DATA", 20])]);
		expect(f.p.locks.cache).toEqual([]);
	});

	it("an INVALIDATE passes at once and discards what was held; x (manual INVALIDATE) sees it once", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		let invalidations = 0;
		const x = g.node<number>(
			[a],
			(ctx) => {
				if (ctx.deps[0].invalidated) {
					invalidations++;
					ctx.down([["INVALIDATE"]]);
				}
				for (const w of ctx.deps[0].waves)
					if (w.length > 0) ctx.down(w.map((v) => ["DATA", (v as number) * 10] as Message));
			},
			{ name: "x", invalidate: "manual" },
		);
		const p = pausable(g, x, { name: "p" });
		const s = record(p.node);
		const lock = p.pause();
		a.set(2);
		expect(during(s.arrays, () => a.invalidate())).toEqual([pending(["INVALIDATE"])]);
		expect(during(s.arrays, () => a.set(3))).toEqual([RESOLVED]);
		expect(during(s.arrays, () => p.resume(lock))).toEqual([pending(["DATA", 30])]);
		expect(invalidations).toBe(1);
	});

	it("a source paused before its first activation reads the lock and starts no work; the resume starts it", () => {
		const g = graph();
		const control = pauseLocks(g, { name: "src" });
		const started: string[] = [];
		const src = g.node<string>(
			[control.locks],
			(ctx) => {
				if ((ctx.deps[0].value as readonly string[]).length > 0) return;
				started.push("work");
				ctx.down([["DATA", "first"]]);
			},
			{ name: "srcNode" },
		);
		const lock = control.pause();
		expect(src.status.lifecycle).toBe("inactive");
		const s = record(src);
		expect(s.arrays).toEqual([[["START"]]]);
		expect(started).toEqual([]);
		expect(during(s.arrays, () => control.resume(lock))).toEqual([pending(["DATA", "first"])]);
		expect(started).toEqual(["work"]);
	});

	it("work a source started before a pause may still publish while paused", () => {
		const g = graph();
		const control = pauseLocks(g, { name: "src" });
		let finish: ((v: string) => void) | undefined;
		const src = g.node<string>(
			[control.locks],
			(ctx) => {
				if ((ctx.deps[0].value as readonly string[]).length > 0 || finish) return;
				finish = (v) => ctx.down([["DATA", v]]);
			},
			{ name: "srcNode" },
		);
		const s = record(src);
		control.pause();
		expect(during(s.arrays, () => finish?.("late"))).toEqual([pending(["DATA", "late"])]);
	});

	// The scenario's p is after x; an [DATA, terminal] array reaches p as one array only from a
	// node that sends it as one, so this clause puts p directly after the state a (as the reference does).
	for (const [name, end, terminal] of [
		["COMPLETE", (a: StateNode<number>) => a.complete(), ["COMPLETE"]],
		["ERROR", (a: StateNode<number>) => a.error("boom"), ["ERROR", "boom"]],
	] as const)
		it(`unpaused, p forwards [PENDING, DATA, ${name}] unchanged; paused, only the terminal goes and what was held is discarded`, () => {
			const g = graph();
			const a = g.state(0, { name: "a" });
			const p = pausable(g, a, { name: "p" });
			const s = record(p.node);
			expect(
				during(s.arrays, () =>
					g.batch(() => {
						a.set(5);
						end(a);
					}),
				),
			).toEqual([pending(["DATA", 5], terminal as Message)]);
			const h = graph();
			const b = h.state(0, { name: "a" });
			const q = pausable(h, b, { name: "p" });
			const t = record(q.node);
			q.pause();
			b.set(4);
			expect(
				during(t.arrays, () =>
					h.batch(() => {
						b.set(5);
						end(b);
					}),
				),
			).toEqual([pending(terminal as Message)]);
			expect(q.node.cache).toBe(0);
		});
});

describe("C-31 (R-lifetime@2, R-terminals@2, R-pause@2): state across close, a sealed state, and locks that outlive the pausable", () => {
	it("the state keeps its value across close, and a write queued behind the close still applies", () => {
		const g = graph();
		const s = g.state(10, { name: "s" });
		let armed = false;
		const stop = s.subscribe((w) => {
			if (!armed || !w.some((m) => isData(m) && m[1] === 20)) return;
			armed = false;
			stop();
			s.set(21);
		});
		armed = true;
		s.set(20);
		expect(s.status.lifecycle).toBe("inactive");
		expect(s.cache).toBe(21);
	});

	it("after COMPLETE a write queued behind the terminal is dropped and reported; a new subscriber gets [START, DATA, COMPLETE]", () => {
		const reports: HostFailure[] = [];
		const g = graph({ report: (failure) => reports.push(failure) });
		const s = g.state(10, { name: "s" });
		const k = g.state(0, { name: "k" });
		record(s);
		k.subscribe((w) => {
			if (!w.some((m) => isData(m) && m[1] === 1)) return;
			s.complete();
			s.set(99);
		});
		k.set(1);
		expect(s.status.output).toBe("completed");
		expect(s.cache).toBe(10);
		expect(reports).toHaveLength(1);
		expect(record(s).arrays).toEqual([[["START"], ["DATA", 10], ["COMPLETE"]]]);
	});

	it("p's lock stays after o leaves; o's new subscription gets [START] only and the resume sends [PENDING, DATA 30]", () => {
		const g = graph();
		const s = g.state(20, { name: "s" });
		record(s);
		const p = pausable(g, s, { name: "p" });
		const o = record(p.node);
		const lock = p.pause();
		s.set(30);
		o.stop();
		expect(p.node.status.lifecycle).toBe("inactive");
		expect(p.locks.cache).toEqual([lock]);
		const again = record(p.node);
		expect(again.arrays).toEqual([[["START"]]]);
		expect(during(again.arrays, () => p.resume(lock))).toEqual([pending(["DATA", 30])]);
	});

	it("q passes the COMPLETE at once and discards the DATA held with it; the resume sends nothing and q keeps its value", () => {
		const g = graph();
		let ctxDown: ((w: Wave) => void) | undefined;
		const fn: NodeFn = (ctx) => {
			if (ctxDown !== undefined) return;
			ctxDown = (w) => ctx.down(w);
			ctx.down([["DATA", 20]]);
		};
		const src = g.node<number>([], fn, { name: "src" });
		const q = pausable(g, src, { name: "q" });
		const o = record(q.node);
		const lock = q.pause();
		expect(during(o.arrays, () => ctxDown?.([["DATA", 30], ["COMPLETE"]]))).toEqual([
			pending(["COMPLETE"]),
		]);
		expect(during(o.arrays, () => q.resume(lock))).toEqual([]);
		expect(q.node.cache).toBe(20);
		expect(q.node.status.output).toBe("completed");
	});

	it("the locks survive the pausable's terminal", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const p = pausable(g, a, { name: "p" });
		record(p.node);
		const lock = p.pause();
		a.complete();
		expect(p.node.status.output).toBe("completed");
		expect(p.locks.cache).toEqual([lock]);
	});
});

describe("C-60 (4) (R-pause@2): in a wave that also changes the locks, the locks after the wave decide for the terminal", () => {
	for (const [name, end, terminal] of [
		["COMPLETE", (a: StateNode<number>) => a.complete(), ["COMPLETE"]],
		["ERROR", (a: StateNode<number>) => a.error("boom"), ["ERROR", "boom"]],
	] as const) {
		for (const order of ["release first", "terminal first"] as const)
			it(`${name}, ${order}: released in the terminal's wave, P sends what it held, each as it arrived, then the terminal`, () => {
				const g = graph();
				const a = g.state(0, { name: "a" });
				const p = pausable(g, a, { name: "p" });
				const s = record(p.node);
				const lock = p.pause();
				a.set(5);
				a.set(6);
				const got = during(s.arrays, () =>
					g.batch(() => {
						if (order === "release first") {
							p.resume(lock);
							end(a);
						} else {
							end(a);
							p.resume(lock);
						}
					}),
				);
				// Each held array keeps its own boundary; the terminal is the wave's last message.
				expect(dataArrays(got)).toEqual([[5], [6]]);
				expect(got.flat().filter((m) => m[0] !== "PENDING")).toEqual([
					["DATA", 5],
					["DATA", 6],
					terminal,
				]);
				expect(got.every((w) => w[0]?.[0] === "PENDING")).toBe(true);
			});

		it(`${name}: with a lock taken in the terminal's wave, P sends the terminal alone`, () => {
			const g = graph();
			const a = g.state(0, { name: "a" });
			const p = pausable(g, a, { name: "p" });
			const s = record(p.node);
			const got = during(s.arrays, () =>
				g.batch(() => {
					a.set(5);
					end(a);
					p.pause();
				}),
			);
			expect(got).toEqual([pending(terminal as Message)]);
			expect(p.node.cache).toBe(0);
		});
	}
});

describe("C-46 (R-checkpoint@3, R-pause@2): a paused pausable survives a checkpoint round trip", () => {
	it("the restored pausable holds the same locks and arrays, and its resume sends them as the original's does", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const p = pausable(g, a, { name: "p" });
		const s = record(p.node);
		p.pause("L");
		a.set(2);
		a.set(3);
		const checkpoint = roundTrip(g); // a local-only node would refuse the capture
		const r = restoreGraph(checkpoint, { registry: defaultRestoreRegistry });
		const rp = pausableOf(r, r.find("p") as Node<unknown>);
		expect(rp.locks.cache).toEqual(["L"]);
		expect(rp.locks).toBe(r.find("p/locks"));
		const rs = record(rp.node);
		const restored = during(rs.arrays, () => rp.resume("L"));
		expect(restored).toEqual(during(s.arrays, () => p.resume("L")));
		expect(restored).toEqual([pending(["DATA", 2]), pending(["DATA", 3])]);
		expect(during(rs.arrays, () => rp.resume("L"))).toEqual([]);
		expect(during(rs.arrays, () => asState<number>(r.find("a")).set(4))).toEqual(
			during(s.arrays, () => a.set(4)),
		);
	});
});

describe("R-pause@2: the module's shape", () => {
	it("one node after its input depending on [input, lock state], manual INVALIDATE, default names", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const p = pausable(g, a);
		const q = pausable(g, a);
		const ids = g.describe().map((n) => n.id);
		expect(ids).toEqual(
			expect.arrayContaining(["pausable", "pausable/locks", "pausable1", "pausable1/locks"]),
		);
		const def = g.definition(p.node);
		expect(def.deps).toEqual([a, p.locks]);
		expect(def.invalidate).toBe("manual");
		expect(def.recipe).toMatchObject({ ref: "pause.pausable" });
		expect(p.locks).toBe(g.find("pausable/locks"));
		expect(q.locks).not.toBe(p.locks);
		expect(p.locks.cache).toEqual([]);
	});

	it("several pausables share one lock state, so one resume releases them in one wave", () => {
		const g = graph();
		const a = g.state(10, { name: "a" });
		const b = g.state("b0", { name: "b" });
		const control = pauseLocks(g, { name: "d" });
		const pa = pausable(g, a, { name: "pa", locks: control });
		const pb = pausable(g, b, { name: "pb", locks: control });
		expect(pa.locks).toBe(control.locks);
		expect(pb.locks).toBe(control.locks);
		const runs: unknown[][] = [];
		const d = g.derived(
			[pa.node, pb.node],
			(x, y) => {
				runs.push([x, y]);
				return `${x}${y}`;
			},
			{ name: "dd" },
		);
		const s = record(d);
		runs.length = 0;
		const lock = pa.pause();
		a.set(20);
		b.set("b1");
		expect(runs).toEqual([]);
		expect(during(s.arrays, () => pb.resume(lock))).toEqual([pending(["DATA", "20b1"])]);
		expect(runs).toEqual([[20, "b1"]]);
	});

	it("two pauses made in one wave both hold, and a default lock never repeats", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const p = pausable(g, a, { name: "p" });
		const locks: string[] = [];
		a.subscribe((w) => {
			if (w[0]?.[0] !== "START") locks.push(p.pause(), p.pause());
		});
		record(p.node);
		a.set(2);
		expect(new Set(locks).size).toBe(2);
		expect(p.locks.cache).toEqual(locks);
		p.resume(locks[0]);
		expect(p.locks.cache).toEqual([locks[1]]);
	});

	it("an unpaused pausable forwards every array unchanged; a pause and a resume are each one PENDING settled by RESOLVED", () => {
		const g = graph();
		const a = g.state<number>(none(), { name: "a" });
		const p = pausable(g, a, { name: "p" });
		const s = record(p.node);
		expect(during(s.arrays, () => a.set(1))).toEqual([pending(["DATA", 1])]);
		expect(
			during(s.arrays, () => {
				const l = p.pause();
				p.resume(l);
			}),
		).toEqual([RESOLVED, RESOLVED]);
	});
});
