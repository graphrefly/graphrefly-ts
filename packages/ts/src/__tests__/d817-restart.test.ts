/**
 * D817 kernel report, phase 2 (graphrefly-ts:D817-KERNEL-REPORT-TS, graphrefly-ts:D194 (3), (4)):
 * the restart module.
 *
 * TS harness for the root scenarios C-43, C-46 (its restart clauses) and C-60 (2), (3) in
 * ~/src/graphrefly/spec/conformance.jsonl, against R-restart@2 (graphrefly:D830) with
 * R-request-order@7, R-lifetime@2, R-terminals@2 and R-checkpoint@3. The cases follow the scenario
 * first and reference/modules/restart.test.mjs and the restart clauses of
 * reference/modules/checkpoint.test.mjs second; those are candidate evidence only. Time is a manual
 * timers object the tests fire by hand: the owner reads no time itself.
 */
import { describe, expect, it } from "vitest";
import type { NodeFn } from "../ctx/types.js";
import { restartable, restartableOf, restartRecipes } from "../graph/restart.js";
import {
	defaultRestoreRegistry,
	type Graph,
	type GraphRestoreRegistry,
	graph,
	type Message,
	type Node,
	restoreGraph,
	type StateNode,
} from "../index.js";
import type { Wave } from "../protocol/messages.js";

const pending = (...msgs: Message[]): Wave => [["PENDING"], ...msgs];
const asState = <T>(n: Node<unknown> | undefined) => n as unknown as StateNode<T>;
const roundTrip = (g: Graph) => JSON.parse(JSON.stringify(g.checkpoint()));

/** A sink that keeps every array it receives. */
function record(n: Node<unknown>) {
	const arrays: Wave[] = [];
	const stop = n.subscribe((w) => arrays.push(w));
	return { arrays, stop };
}
function during(arrays: readonly Wave[], body: () => void): Wave[] {
	const start = arrays.length;
	body();
	return arrays.slice(start);
}
const values = (arrays: readonly Wave[]) =>
	arrays.flatMap((w) => w.filter((m) => m[0] === "DATA").map((m) => m[1]));
const terminals = (arrays: readonly Wave[]) =>
	arrays.flatMap((w) => w.filter((m) => m[0] === "COMPLETE" || m[0] === "ERROR"));
const starts = (arrays: readonly Wave[]) => arrays.filter((w) => w[0]?.[0] === "START").length;

/** A clock the test moves: the pending timers fire in due order when it advances past them. */
function manualClock() {
	let now = 0;
	let next = 0;
	const due = new Map<number, { at: number; fn: () => void }>();
	const delays: number[] = [];
	return {
		timers: {
			set(fn: () => void, ms: number): unknown {
				next += 1;
				delays.push(ms);
				due.set(next, { at: now + ms, fn });
				return next;
			},
			clear(handle: unknown): void {
				due.delete(handle as number);
			},
		},
		/** The delay of every timer set so far, in order. */
		delays,
		armed: () => due.size,
		advance(ms: number) {
			const end = now + ms;
			for (;;) {
				let first: [number, { at: number; fn: () => void }] | undefined;
				for (const entry of due)
					if (entry[1].at <= end && (first === undefined || entry[1].at < first[1].at))
						first = entry;
				if (first === undefined) break;
				due.delete(first[0]);
				now = first[1].at;
				first[1].fn();
			}
			now = end;
		},
	};
}
type Clock = ReturnType<typeof manualClock>;

interface Counter {
	/** Inner lifetimes begun without private state: fresh attempts and fresh activations. */
	starts: number;
	opens: number;
	closes: number;
}

/** u forwards a's values; its setup counts its lifetimes. */
const forward: NodeFn = (ctx) => {
	for (const v of ctx.deps[0].waves.flat()) ctx.down([["DATA", v]]);
};
const uSetup = (c: Counter) => () => {
	c.opens++;
	return () => {
		c.closes++;
	};
};
/**
 * The inner forwards numbers. Any other value is a command, acted on only after the lifetime's
 * first run, so a fresh attempt does not act again on the command in its input's snapshot: "end"
 * completes, any other string fails with itself as the ERROR. Its private state marks a lifetime
 * that has begun, so a restored inner, whose private state came back, is not counted as a start.
 */
const innerFn =
	(c: Counter): NodeFn =>
	(ctx) => {
		const fresh = ctx.state.get() === undefined;
		if (fresh) {
			ctx.state.set(true);
			c.starts++;
		}
		for (const v of ctx.deps[0].waves.flat()) {
			if (typeof v === "number") ctx.down([["DATA", v]]);
			else if (fresh) continue;
			else if (v === "end") {
				ctx.down([["COMPLETE"]]);
				return;
			} else {
				ctx.down([["ERROR", v]]);
				return;
			}
		}
	};

interface RetryOpts {
	readonly maxAttempts: number;
	readonly initialMs?: number;
	readonly factor?: number;
	readonly maxMs?: number;
}

/**
 * C-43's topology: state a, u over a whose setup opens a resource, and the owner r with its inner
 * r/inner over u; rounds 2 and two attempts per round with a delay of 100 unless given. Every
 * computed node carries a recipe, so each graph can be captured.
 */
function c43(opts: { rounds?: number; retry?: RetryOpts } = {}) {
	const counter: Counter = { starts: 0, opens: 0, closes: 0 };
	const clock = manualClock();
	const g = graph();
	const a = g.state<unknown>(1, { name: "a" });
	const u = g.node([a], forward, { name: "u", setup: uSetup(counter), recipe: { ref: "c43.u" } });
	const r = restartable(g, {
		deps: [u],
		fn: innerFn(counter),
		recipe: { ref: "c43.inner" },
		rounds: opts.rounds ?? 2,
		retry: opts.retry ?? { maxAttempts: 2, initialMs: 100 },
		timers: clock.timers,
		name: "r",
	});
	return { g, a, u, r, counter, clock };
}
/** A restore of a C-43 graph, its owner on its own clock and its inner counting into its own counter. */
function restoreC43(checkpoint: ReturnType<Graph["checkpoint"]>) {
	const counter: Counter = { starts: 0, opens: 0, closes: 0 };
	const clock = manualClock();
	const registry: GraphRestoreRegistry = {
		...defaultRestoreRegistry,
		...restartRecipes(clock.timers),
		"c43.u": { ref: "c43.u", build: () => ({ fn: forward, setup: uSetup(counter) }) },
		"c43.inner": { ref: "c43.inner", build: () => ({ fn: innerFn(counter) }) },
	};
	const g = restoreGraph(checkpoint, { registry });
	const owner = g.find("r") as Node<unknown>;
	return {
		g,
		a: asState<unknown>(g.find("a")),
		r: restartableOf(g, owner),
		inner: g.find("r/inner") as Node<unknown>,
		counter,
		clock,
	};
}

describe("C-43 (R-restart@2): one face downstream across rounds and retries", () => {
	it("s gets both rounds' values and one COMPLETE; u opens once and closes when r ends; t sees START at each attempt", () => {
		const f = c43();
		const before = JSON.stringify(f.g.describe());
		const s = record(f.r.node);
		const t = record(f.r.inner);
		f.a.set(2);
		f.a.set("end"); // round 1 completes
		expect(terminals(s.arrays)).toEqual([]);
		expect(f.r.node.status.output).toBe("open");
		expect(JSON.stringify(f.g.describe())).toBe(before);
		expect(starts(t.arrays)).toBe(2);
		expect(f.counter).toMatchObject({ starts: 2, opens: 1, closes: 0 });
		f.a.set(3);
		f.a.set("end"); // round 2 completes: no round is left
		expect(values(s.arrays)).toEqual([1, 2, 3]);
		expect(terminals(s.arrays)).toEqual([["COMPLETE"]]);
		expect(s.arrays.at(-1)?.at(-1)).toEqual(["COMPLETE"]);
		expect(f.r.node.status.output).toBe("completed");
		expect(f.counter).toMatchObject({ opens: 1, closes: 1 });
		expect(JSON.stringify(f.g.describe())).toBe(before);
	});

	it("fail, complete, fail twice: the first ERROR is retried after the delay, the count starts again in round 2, whose second ERROR ends r", () => {
		const f = c43();
		const s = record(f.r.node);
		f.a.set("bad1");
		expect(f.clock.delays).toEqual([100]);
		f.clock.advance(99);
		expect(f.counter.starts).toBe(1);
		f.clock.advance(1);
		expect(f.counter.starts).toBe(2);
		f.a.set(2);
		f.a.set("end"); // round 2
		expect(f.counter.starts).toBe(3);
		f.a.set("bad2"); // the first failure of round 2 is retried
		expect(f.r.node.status.output).toBe("open");
		expect(f.clock.delays).toEqual([100, 100]);
		f.clock.advance(100);
		expect(f.counter.starts).toBe(4);
		f.a.set("bad3");
		expect(terminals(s.arrays)).toEqual([["ERROR", "bad3"]]);
		expect(values(s.arrays)).toEqual([1, 2]);
		expect(f.clock.armed()).toBe(0);
	});

	it("the owner faces downstream at r, holds u ahead of the inner, and declares its restart state", () => {
		const f = c43();
		expect(f.g.describe().map((n) => n.id)).toEqual(
			expect.arrayContaining(["r", "r/inner", "r/restart"]),
		);
		expect(f.r.inner).toBe(f.g.find("r/inner"));
		expect(f.r.restartState).toBe(f.g.find("r/restart"));
		expect(f.g.definition(f.r.inner).deps).toEqual([f.u]);
		const deps = f.g.definition(f.r.node).deps;
		expect(deps.indexOf(f.u)).toBeGreaterThanOrEqual(0);
		expect(deps.indexOf(f.u)).toBeLessThan(deps.indexOf(f.r.inner));
		expect(deps).toContain(f.r.restartState);
	});

	it("each request is served once: on a live inner, across a resubscription, and while r is inactive", () => {
		const f = c43();
		let s = record(f.r.node);
		expect(f.counter.starts).toBe(1);
		f.r.restart();
		expect(f.counter.starts).toBe(2);
		expect(f.counter).toMatchObject({ opens: 1, closes: 0 }); // a stays held through u
		expect(f.a.status.lifecycle).toBe("active");
		s.stop();
		s = record(f.r.node);
		expect(f.counter.starts).toBe(3); // one fresh inner; the old request was served
		s.stop();
		f.r.restart(); // r is inactive
		expect(f.r.restartState.cache).toBe(2);
		s = record(f.r.node);
		expect(f.counter.starts).toBe(4); // the next activation's fresh inner, and no more
		f.r.restart();
		expect(f.counter.starts).toBe(5);
		expect(f.r.node.status.output).toBe("open");
	});

	it("a retry pending when a request starts another attempt is dropped", () => {
		const f = c43();
		const s = record(f.r.node);
		f.a.set("bad1");
		expect(f.clock.armed()).toBe(1);
		f.r.restart();
		expect(f.counter.starts).toBe(2);
		f.a.set(2);
		f.clock.advance(100);
		expect(f.counter.starts).toBe(2);
		expect(values(s.arrays)).toEqual([1, 2]);
		expect(f.r.node.status.output).toBe("open");
	});

	it("a retry pending when r's lifetime closes is dropped and its timer cleared; the next activation starts a fresh inner", () => {
		const f = c43();
		let s = record(f.r.node);
		f.a.set("bad1");
		expect(f.clock.armed()).toBe(1);
		s.stop();
		expect(f.clock.armed()).toBe(0);
		f.a.set(2);
		s = record(f.r.node);
		expect(f.counter.starts).toBe(2);
		expect(f.r.inner.status.output).toBe("open");
		expect(values(s.arrays)).toEqual([2]);
		f.clock.advance(100);
		expect(f.counter.starts).toBe(2);
	});

	it("a completing while a retry waits: no inner is started over it, and r ends with the inner's ERROR", () => {
		const f = c43();
		const s = record(f.r.node);
		f.a.set("bad1");
		f.a.complete();
		f.clock.advance(100);
		expect(f.counter.starts).toBe(1);
		expect(terminals(s.arrays)).toEqual([["ERROR", "bad1"]]);
	});

	it("a completing while the inner is live: r ends with the inner's COMPLETE, rounds left or not", () => {
		const f = c43();
		const s = record(f.r.node);
		f.a.complete();
		expect(terminals(s.arrays)).toEqual([["COMPLETE"]]);
		expect(f.counter.starts).toBe(1);
	});

	it("a restart state written as a restore brings it back counts as served at activation; the next request writes 2", () => {
		const f = c43();
		f.r.restartState.set(1);
		record(f.r.node);
		expect(f.counter.starts).toBe(1);
		f.r.restart();
		expect(f.r.restartState.cache).toBe(2);
		expect(f.counter.starts).toBe(2);
	});
});

/** A C-43 graph captured while its retry waits: one failure counted, the inner ended. */
function waitingCheckpoint(retry: RetryOpts = { maxAttempts: 3, initialMs: 100, factor: 3 }) {
	const f = c43({ retry });
	const s = record(f.r.node);
	f.a.set("bad1");
	expect(f.r.inner.status.output).toBe("errored");
	expect(f.clock.armed()).toBe(1);
	const checkpoint = roundTrip(f.g);
	return { f, s, checkpoint };
}

describe("C-43 (R-restart@2, R-checkpoint@3): an owner brought back as a restore does", () => {
	it("restored while a retry waited, it starts no inner at activation, waits the delay in full, counts no further failure, then starts one", () => {
		const { f, s, checkpoint } = waitingCheckpoint();
		s.stop(); // drops the original's timer
		expect(f.clock.armed()).toBe(0);
		const r = restoreC43(checkpoint);
		r.a.set(5);
		const rs = record(r.r.node);
		expect(r.r.node.cache).toBe(1);
		expect(r.inner.status.output).toBe("errored");
		expect(r.counter.starts).toBe(0);
		expect(r.clock.delays).toEqual([100]); // the delay of the one failure counted
		r.clock.advance(99);
		expect(r.counter.starts).toBe(0);
		r.clock.advance(1);
		expect(r.counter.starts).toBe(1);
		expect(r.r.node.cache).toBe(5);
		// A second failure is the second counted: its delay follows two failures (100 * 3) ...
		r.a.set("bad2");
		expect(r.r.node.status.output).toBe("open");
		expect(r.clock.delays).toEqual([100, 300]);
		r.clock.advance(300);
		expect(r.counter.starts).toBe(2);
		// ... and the third exhausts three attempts.
		r.a.set("bad3");
		expect(terminals(rs.arrays)).toEqual([["ERROR", "bad3"]]);
	});

	it("restored while a retry waited, with a completed meanwhile: no attempt, and r ends with the inner's ERROR when the delay has passed", () => {
		const { s, checkpoint } = waitingCheckpoint();
		s.stop();
		const r = restoreC43(checkpoint);
		r.a.complete();
		const rs = record(r.r.node);
		expect(r.r.node.status.output).toBe("open");
		r.clock.advance(100);
		expect(r.counter.starts).toBe(0);
		expect(terminals(rs.arrays)).toEqual([["ERROR", "bad1"]]);
	});

	it("restored with a live inner and no retry recorded, an inner that fails at that first activation counts once and waits, as the original", () => {
		for (const maxAttempts of [2, 3]) {
			const f = c43({ retry: { maxAttempts, initialMs: 100 } });
			const s = record(f.r.node);
			const r = restoreC43(roundTrip(f.g));
			r.a.set("bad1");
			const rs = record(r.r.node);
			f.a.set("bad1");
			const facts = (owner: Node<unknown>, inner: Node<unknown>, clock: Clock) => ({
				value: owner.cache,
				owner: owner.status.output,
				inner: inner.status.output,
				delays: [...clock.delays],
				armed: clock.armed(),
			});
			const expected = { value: 1, owner: "open", inner: "errored", delays: [100], armed: 1 };
			expect(facts(r.r.node, r.inner, r.clock)).toEqual(expected);
			expect(facts(f.r.node, f.r.inner, f.clock)).toEqual(expected);
			expect(r.counter.starts).toBe(0);
			r.a.set(5);
			f.a.set(5);
			r.clock.advance(99);
			f.clock.advance(99);
			expect(r.inner.status.output).toBe("errored");
			expect(during(rs.arrays, () => r.clock.advance(1))).toEqual(
				during(s.arrays, () => f.clock.advance(1)),
			);
			expect(r.r.node.cache).toBe(5);
			expect(r.inner.status.output).toBe("open");
			expect(r.counter.starts).toBe(1);
		}
	});
});

/** C-46's owner after an outside request: round 2 reached, a request served, then a = 3. */
function requestedOwner() {
	const f = c43();
	const s = record(f.r.node);
	f.a.set("end"); // round 2
	f.a.set(2);
	f.r.restart();
	f.a.set(3);
	expect(f.r.restartState.cache).toBe(1);
	return { f, s, checkpoint: roundTrip(f.g) };
}

describe("C-46 (R-checkpoint@3, R-restart@2): restart owners survive a checkpoint round trip", () => {
	it("an owner after an outside request keeps its round and request number, and both graphs send the same arrays", () => {
		const { f, s, checkpoint } = requestedOwner();
		const r = restoreC43(checkpoint);
		const rs = record(r.r.node);
		expect(rs.arrays).toEqual([[["START"], ["DATA", 3]]]);
		expect(r.counter.starts).toBe(0);
		expect(during(rs.arrays, () => r.r.restart())).toEqual(during(s.arrays, () => f.r.restart()));
		expect(r.r.restartState.cache).toBe(2);
		expect(f.r.restartState.cache).toBe(2);
		expect(during(rs.arrays, () => r.a.set(4))).toEqual(during(s.arrays, () => f.a.set(4)));
		// Round 2 came back: the next completion ends both owners.
		expect(during(rs.arrays, () => r.a.set("end"))).toEqual(during(s.arrays, () => f.a.set("end")));
		expect(terminals(rs.arrays)).toEqual([["COMPLETE"]]);
		expect(r.r.node.status.output).toBe("completed");
	});

	it("a restart requested at the restored owner before its first subscription starts no attempt", () => {
		const { checkpoint } = requestedOwner();
		const r = restoreC43(checkpoint);
		r.r.restart(); // the owner is inactive
		expect(r.r.restartState.cache).toBe(2);
		const rs = record(r.r.node);
		expect(rs.arrays).toEqual([[["START"], ["DATA", 3]]]);
		expect(r.counter.starts).toBe(0);
		expect(during(rs.arrays, () => r.a.set(4))).toEqual([pending(["DATA", 4])]);
		expect(r.counter.starts).toBe(0);
		r.r.restart();
		expect(r.r.restartState.cache).toBe(3);
		expect(r.counter.starts).toBe(1);
	});

	it("an owner waiting for a retry starts that delay again in full at its activation, and both graphs send the same arrays", () => {
		const { f, s, checkpoint } = waitingCheckpoint({ maxAttempts: 3, initialMs: 100 });
		const r = restoreC43(checkpoint);
		r.clock.advance(50); // nothing is armed before the activation
		r.a.set(5);
		f.a.set(5);
		const rs = record(r.r.node);
		expect(r.clock.armed()).toBe(1);
		expect(during(rs.arrays, () => r.clock.advance(99))).toEqual([]);
		expect(during(s.arrays, () => f.clock.advance(99))).toEqual([]);
		const restored = during(rs.arrays, () => r.clock.advance(1));
		expect(restored).toEqual(during(s.arrays, () => f.clock.advance(1)));
		expect(restored).toEqual([pending(["DATA", 5])]);
		expect(r.counter.starts).toBe(1);
		// The same failure count: the next failure is the second of three attempts, and is retried.
		r.a.set("bad2");
		f.a.set("bad2");
		expect(r.r.node.status.output).toBe("open");
		expect(r.clock.delays).toEqual([100, 100]);
		expect(during(rs.arrays, () => r.clock.advance(100))).toEqual(
			during(s.arrays, () => f.clock.advance(100)),
		);
		expect(r.counter.starts).toBe(2);
	});
});

/** C-60's (2) and (3) topology: a state u and the owner O whose inner depends on u directly. */
function c60(opts: { rounds?: number; retry?: RetryOpts } = {}) {
	const counter: Counter = { starts: 0, opens: 0, closes: 0 };
	const clock = manualClock();
	const g = graph();
	const u = g.state<unknown>(1, { name: "u" });
	const o = restartable(g, {
		deps: [u],
		fn: innerFn(counter),
		rounds: opts.rounds,
		retry: opts.retry ?? { maxAttempts: 3, initialMs: 100 },
		timers: clock.timers,
		name: "o",
	});
	const s = record(o.node);
	return { g, u, o, s, counter, clock };
}

describe("C-60 (2) (R-restart@2): an owner that can make no attempt ends with its inner's terminal", () => {
	it("u ended in the wave of the failure: O ends at once with the inner's ERROR and starts no timer", () => {
		const f = c60();
		f.g.batch(() => {
			f.u.set("bad1");
			f.u.complete();
		});
		expect(terminals(f.s.arrays)).toEqual([["ERROR", "bad1"]]);
		expect(f.clock.delays).toEqual([]);
	});

	for (const [name, end] of [
		["COMPLETE", (u: StateNode<unknown>) => u.complete()],
		["its own ERROR", (u: StateNode<unknown>) => u.error("upstream")],
	] as const)
		it(`u ended with ${name} while the retry waits: O ends when the delay has passed, with the inner's ERROR, and makes no attempt`, () => {
			const f = c60();
			f.u.set("bad1");
			expect(f.clock.armed()).toBe(1);
			end(f.u);
			expect(f.o.node.status.output).toBe("open");
			expect(terminals(f.s.arrays)).toEqual([]);
			f.clock.advance(99);
			expect(f.o.node.status.output).toBe("open");
			f.clock.advance(1);
			expect(terminals(f.s.arrays)).toEqual([["ERROR", "bad1"]]);
			expect(f.counter.starts).toBe(1);
		});

	it("with rounds left, an inner that completes as u completes ends O with the inner's COMPLETE", () => {
		const f = c60({ rounds: 3 });
		f.u.complete();
		expect(terminals(f.s.arrays)).toEqual([["COMPLETE"]]);
		expect(f.counter.starts).toBe(1);
	});
});

describe("C-60 (3) (R-restart@2): an INVALIDATE of the restart state is no request", () => {
	it("the INVALIDATE starts no attempt and retracts nothing; each request after it starts one", () => {
		const f = c60();
		f.o.restart();
		expect(f.counter.starts).toBe(2);
		f.u.set(7);
		expect(during(f.s.arrays, () => f.o.restartState.invalidate())).toEqual([
			pending(["RESOLVED"]),
		]);
		expect(f.counter.starts).toBe(2);
		expect(f.o.node.cache).toBe(7);
		f.o.restart();
		expect(f.counter.starts).toBe(3);
		f.o.restart();
		expect(f.counter.starts).toBe(4);
	});

	it("an INVALIDATE while O is inactive changes nothing: the next activation starts its one fresh inner, and a request after it one attempt", () => {
		const f = c60();
		f.o.restart();
		expect(f.counter.starts).toBe(2);
		f.s.stop();
		f.o.restartState.invalidate();
		record(f.o.node);
		expect(f.counter.starts).toBe(3);
		f.o.restart();
		expect(f.counter.starts).toBe(4);
	});

	for (const served of [1, 2])
		it(`after ${served} served, an INVALIDATE and a request in one batch: the request starts one attempt`, () => {
			const f = c60();
			for (let i = 0; i < served; i++) f.o.restart();
			expect(f.counter.starts).toBe(served + 1);
			f.g.batch(() => {
				f.o.restartState.invalidate();
				f.o.restart();
			});
			expect(f.counter.starts).toBe(served + 2);
			f.o.restart();
			expect(f.counter.starts).toBe(served + 3);
		});
});

describe("R-restart@2: the policy and the inner's definition", () => {
	it("by default one round and no retry: an inner that throws ends the owner with that ERROR", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const r = restartable(g, {
			deps: [a],
			fn: () => {
				throw new Error("inner boom");
			},
			name: "r",
		});
		const s = record(r.node);
		expect(terminals(s.arrays)).toEqual([["ERROR", "inner boom"]]);
	});

	it("the delay after failed attempt n is min(initialMs * factor^(n-1), maxMs), and the last attempt's ERROR is final", () => {
		const f = c43({ retry: { maxAttempts: 4, initialMs: 100, factor: 3, maxMs: 500 } });
		const s = record(f.r.node);
		for (const [bad, delay] of [
			["bad1", 100],
			["bad2", 300],
			["bad3", 500],
		] as const) {
			f.a.set(bad);
			expect(f.clock.delays.at(-1)).toBe(delay);
			f.clock.advance(delay);
		}
		f.a.set("bad4");
		expect(terminals(s.arrays)).toEqual([["ERROR", "bad4"]]);
		expect(f.clock.delays).toEqual([100, 300, 500]);
	});

	it("restart() is a set of the restart state with a function, and nothing else", () => {
		const f = c43();
		f.r.restart();
		f.r.restart();
		expect(f.r.restartState.cache).toBe(2);
		expect(f.counter.starts).toBe(0); // the owner is inactive: nothing ran
	});

	it("a new attempt is a new instance of the inner's own definition: its setup runs again, its dependencies stay its own", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(100, { name: "b" });
		const deps: Node<unknown>[] = [a];
		let setups = 0;
		const r = restartable(g, {
			deps,
			fn: forward,
			setup: () => void setups++,
			rounds: 3,
			name: "r",
		});
		record(r.node);
		expect(setups).toBe(1);
		deps.push(b);
		r.restart();
		expect(setups).toBe(2);
		expect(g.definition(r.inner).deps).toEqual([a]);
		expect(b.status.lifecycle).toBe("inactive");
	});
});
