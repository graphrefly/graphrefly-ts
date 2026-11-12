/**
 * D797 kernel migration, phase 2 (graphrefly-ts:D797-KERNEL-MIGRATION-TS): waves and arrays.
 *
 * TS harness for the root scenarios C-12, C-16, C-23, C-28, C-41, the wave clauses of C-4 and the
 * value and quiet-node clauses of C-44 in ~/src/graphrefly/spec/conformance.jsonl, against R-wave@2, R-subscription@3,
 * R-invocation@2 and R-failure@3. Clauses that need the request queue (phase 5) or the terminal
 * and INVALIDATE policies (phase 3) are tested in those phases.
 */

import { describe, expect, it } from "vitest";
import type { Ctx } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import type { Message, Wave } from "../protocol/messages.js";
import { arraySink, collect, types } from "./helpers/collect.js";
import { relayFirst } from "./helpers/relay.js";

const cloneWaves = (ctx: Ctx) => ctx.deps.map((d) => d.waves.map((wave) => [...wave]));

describe("C-12: occurrences stay DATA; RESOLVED only settles a node that sent nothing", () => {
	it("(a) equal values are distinct occurrences", () => {
		const g = graph();
		const source = g.node<number>([], null);
		const s = arraySink();
		source.subscribe(s.sink);
		source.set(1);
		source.set(1);
		source.set(1);
		source.complete();
		expect(s.log).toEqual([
			[["START"]],
			[["PENDING"], ["DATA", 1]],
			[["PENDING"], ["DATA", 1]],
			[["PENDING"], ["DATA", 1]],
			[["PENDING"], ["COMPLETE"]],
		]);
		expect(source.cache).toBe(1);
	});

	it("(b) a silent pending node settles with exactly one kernel RESOLVED per wave", () => {
		const g = graph();
		const source = g.node<number>([], null, { initial: 0 });
		const silent = g.node<number>([source], () => {});
		const below = g.node<number>([silent], (ctx) => ctx.down([["DATA", 1]]));
		const s = arraySink();
		silent.subscribe(s.sink);
		below.subscribe(() => {});
		s.log.length = 0;
		for (const v of [1, 2, 3]) source.set(v);
		expect(s.log).toEqual([
			[["PENDING"], ["RESOLVED"]],
			[["PENDING"], ["RESOLVED"]],
			[["PENDING"], ["RESOLVED"]],
		]);
		expect(below.status.cache).not.toBe("stale");
	});
});

describe("C-16: a quiet node absorbs its input waves without leaving dependents pending", () => {
	it("marks nothing below it pending; what it sends later is its own wave; START has its last array", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 0 });
		let kept: Ctx | undefined;
		const q = g.node<number>(
			[a],
			(ctx) => {
				kept = ctx;
				const held = ctx.state.get<number[]>() ?? [];
				ctx.state.set([...held, ...(ctx.deps[0].waves.flat() as number[])]);
			},
			{ quiet: true },
		);
		let eRuns = 0;
		const e = g.node<number>([q], (ctx) => {
			eRuns++;
			ctx.down([["DATA", ctx.deps[0].waves.flat().length]]);
		});
		const s = arraySink();
		q.subscribe(s.sink);
		e.subscribe(() => {});
		s.log.length = 0;
		eRuns = 0;

		for (const v of [1, 2, 3]) a.set(v);
		expect(s.log).toEqual([]); // not even PENDING
		expect(eRuns).toBe(0);
		expect(e.status.cache).not.toBe("stale");

		const held = (kept as Ctx).state.get<number[]>() as number[];
		(kept as Ctx).down(held.map((v) => ["DATA", v] as Message));
		expect(s.log).toEqual([[["PENDING"], ...held.map((v) => ["DATA", v])]]);
		expect(eRuns).toBe(1);

		const late = arraySink();
		q.subscribe(late.sink);
		expect(late.log).toEqual([[["START"], ...held.map((v) => ["DATA", v])]]);
	});
});

describe("R-subscription: subscribing activates first; the first array is START plus the snapshot", () => {
	it("a source's activation array reaches its first sink in the START array", () => {
		const g = graph();
		const source = g.node<number>([], (ctx) =>
			ctx.down([["DATA", 1], ["DATA", 1], ["DATA", 1], ["COMPLETE"]]),
		);
		const s = arraySink();
		source.subscribe(s.sink);
		expect(s.log).toEqual([[["START"], ["DATA", 1], ["DATA", 1], ["DATA", 1], ["COMPLETE"]]]);
	});

	it("arrays an activation sent before the sink joined are not delivered separately", () => {
		const g = graph();
		const source = g.node<number>([], (ctx) => {
			ctx.down([["DATA", 1]]);
			ctx.down([["DATA", 2]]);
		});
		const s = arraySink();
		source.subscribe(s.sink);
		expect(s.log).toEqual([[["START"], ["DATA", 2]]]);
	});

	it("BH6: INVALIDATE clears the retained value (no stale push-on-subscribe)", () => {
		// The node's retained value is the only thing a late subscriber is sent; there is no
		// separate replay buffer.
		const g = graph();
		const s = g.node<number>([], null);
		collect(s);
		s.set(1);
		s.set(2);
		expect(collect(s).msgs).toEqual([["START"], ["DATA", 2]]); // retained before INVALIDATE
		s.invalidate();
		expect(s.cache).toBeUndefined();
		const { msgs } = collect(s); // late subscriber
		expect(types(msgs)).toEqual(["START"]); // no stale DATA sent
	});
});

describe("R-wave: a node whose only input settled with RESOLVED settles with RESOLVED too", () => {
	it("WEDGE: a relay over a RESOLVED-only dependency balances its PENDING (D49)", () => {
		// Regression for the D49-widened wedge: a relay that was marked pending and then gets only
		// a RESOLVED from its dependency (no DATA in the wave) must settle with RESOLVED, not leave
		// a dangling PENDING. Under D49 a dependency sends a bare RESOLVED on every filter reject,
		// distinctUntilChanged duplicate or silent function, so this fires constantly.
		const g = graph();
		const src = g.node<number>([], null, { initial: 0 });
		// dep sends nothing for an odd value, so the kernel settles it with RESOLVED.
		const dep = g.node<number>([src], (ctx: Ctx) => {
			const v = ctx.deps[0].value as number;
			if (v % 2 === 0) ctx.down([["DATA", v]]);
		});
		const pass = g.node<number>([dep], relayFirst); // a node that relays its dependency
		const { msgs } = collect(pass);
		msgs.length = 0;
		src.set(1); // dep settles with no value: PENDING then RESOLVED to the relay
		expect(types(msgs)).toEqual(["PENDING", "RESOLVED"]); // balanced, not a dangling ["PENDING"]
		expect(pass.status.cache).not.toBe("stale"); // un-wedged
	});
});

describe("C-23: each ctx.deps entry (waves, terminal, latest value) is the function's only input", () => {
	it("gives each dependency its arrays, terminal and latest value", () => {
		const g = graph();
		const captures: { waves: unknown[][][]; terminal: unknown[]; latest: unknown[] }[] = [];
		const trigger = g.node<number>([], null, { initial: 0 });
		// a sends nothing for an odd trigger, so the kernel settles it with RESOLVED; a planned run
		// sends the plan's output instead.
		let plan: ((ctx: Ctx) => void) | undefined;
		const a = g.node<unknown>([trigger], (ctx) => {
			const v = ctx.deps[0].value as number;
			if (plan !== undefined) {
				const run = plan;
				plan = undefined;
				run(ctx);
			} else if (v % 2 === 0) ctx.down([["DATA", v]]);
		});
		const sendFromA = (next: number, run: (ctx: Ctx) => void) => {
			plan = run;
			trigger.set(next);
		};
		const b = g.node<unknown>([], null);
		const n = g.node<unknown>(
			[a, b],
			(ctx) => {
				captures.push({
					waves: cloneWaves(ctx),
					terminal: ctx.deps.map((d) => d.terminal),
					latest: [ctx.deps[0].value, ctx.deps[1].value],
				});
			},
			{ complete: "manual", error: "manual" },
		);
		n.subscribe(() => {});

		// (a) write B only: A's entry has no arrays
		b.set("b");
		expect(captures.at(-1)?.waves).toEqual([[], [["b"]]]);
		// (b) A sends RESOLVED alone: one empty array
		trigger.set(1);
		expect(captures.at(-1)?.waves).toEqual([[[]], []]);
		// (c) split at the last INVALIDATE: N sees [3]
		sendFromA(2, (ctx) => ctx.down([["DATA", 1], ["DATA", 2], ["INVALIDATE"], ["DATA", 3]]));
		expect(captures.at(-1)?.waves).toEqual([[[3]], []]);
		expect(captures.at(-1)?.latest).toEqual([3, "b"]);
		// (c') a host batch on a state is split the same way: N sees only what followed the INVALIDATE
		g.batch(() => {
			b.set(1);
			b.set(2);
			b.invalidate();
			b.set("b");
		});
		expect(captures.at(-1)?.waves).toEqual([[], [["b"]]]);
		// (d) null and [] are ordinary payloads
		sendFromA(3, (ctx) => ctx.down([["DATA", null]]));
		expect(captures.at(-1)?.waves).toEqual([[[null]], []]);
		sendFromA(4, (ctx) => ctx.down([["DATA", []]]));
		expect(captures.at(-1)?.waves).toEqual([[[[]]], []]);
		// (e) terminals are never among the arrays
		const e = new Error("e");
		g.batch(() => {
			sendFromA(5, (ctx) => ctx.down([["COMPLETE"]]));
			b.error(e);
		});
		expect(captures.at(-1)?.terminal).toEqual([{ kind: "complete" }, { kind: "error", error: e }]);
		expect(captures.at(-1)?.waves.flat(2)).toEqual([]);
		// (f) DATA SENTINEL is rejected
		const c = g.node<unknown>([], null);
		expect(() => c.set(undefined)).toThrow(/SENTINEL/);
	});
});

describe("C-28: intact output arrays, kernel-only PENDING prefixes and written order", () => {
	function diamond() {
		const g = graph();
		const t = g.state(0, { name: "t" });
		let send: (ctx: Ctx) => void = () => {};
		const a = g.node<number>([t], (ctx) => send(ctx), { name: "a" });
		// graphrefly-ts:D184: a kernel node runs on activation even before its input has a value.
		const relay = (ctx: Ctx) => {
			const v = ctx.deps[0].value as number | undefined;
			if (v !== undefined) ctx.down([["DATA", v]]);
		};
		const b = g.node<number>([a], relay, { name: "b" });
		const c = g.node<number>([a], relay, { name: "c" });
		const seen: [unknown, unknown][] = [];
		const d = g.node<number>(
			[b, c],
			(ctx) => {
				seen.push([ctx.deps[0].value, ctx.deps[1].value]);
				ctx.down([["DATA", 0]]);
			},
			{ name: "d" },
		);
		const s1 = arraySink();
		const s2 = arraySink();
		a.subscribe(s1.sink);
		a.subscribe(s2.sink);
		d.subscribe(() => {});
		const setSend = (fn: (ctx: Ctx) => void) => {
			send = fn;
		};
		return { g, t, s1, s2, seen, setSend };
	}

	it("one ctx.down is one array with one PENDING prefix; the fan-in runs once", () => {
		const f = diamond();
		f.s1.log.length = 0;
		f.s2.log.length = 0;
		f.seen.length = 0;
		f.setSend((ctx) =>
			ctx.down([
				["DATA", 23],
				["DATA", 23],
				["DATA", 30],
			]),
		);
		f.t.set(1);
		for (const s of [f.s1, f.s2])
			expect(s.log).toEqual([[["PENDING"], ["DATA", 23], ["DATA", 23], ["DATA", 30]]]);
		expect(f.seen).toEqual([[30, 30]]);
	});

	it("separate calls stay separate arrays, each with its own PENDING", () => {
		const f = diamond();
		f.s1.log.length = 0;
		f.setSend((ctx) => {
			ctx.down([["DATA", 1]]);
			ctx.down([["DATA", 2]]);
		});
		f.t.set(1);
		expect(f.s1.log).toEqual([
			[["PENDING"], ["DATA", 1]],
			[["PENDING"], ["DATA", 2]],
		]);
	});

	it("an array is published as [PENDING, INVALIDATE] then the values after it", () => {
		const f = diamond();
		f.setSend((ctx) => ctx.down([["DATA", 5]]));
		f.t.set(1);
		f.s1.log.length = 0;
		f.setSend((ctx) => ctx.down([["DATA", 1], ["INVALIDATE"], ["DATA", 2], ["DATA", 3]]));
		f.t.set(2);
		expect(f.s1.log).toEqual([
			[["PENDING"], ["INVALIDATE"]],
			[["PENDING"], ["DATA", 2], ["DATA", 3]],
		]);
	});

	it("a host batch delivers one accumulated array per node at commit; rejections leave staging", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 0 });
		const log = arraySink();
		s.subscribe(log.sink);
		log.log.length = 0;
		g.batch(() => {
			s.set(1);
			// The host writes only values and terminals; it has no way to send RESOLVED (R-wave@2).
			s.complete();
			expect(() => s.set(2)).toThrow(/last/);
			expect(log.log).toEqual([]);
		});
		expect(log.log).toEqual([[["PENDING"], ["DATA", 1], ["COMPLETE"]]]);
	});

	it("a sink failure goes to the host reporter and rolls nothing back", () => {
		const reported: unknown[] = [];
		const g = graph({ report: (failure) => reported.push(failure.error) });
		const a = g.state(0);
		const other = arraySink();
		a.subscribe((msgs) => {
			if (msgs.some((m) => m[0] === "DATA" && m[1] === 1)) throw new Error("sink");
		});
		a.subscribe(other.sink);
		expect(() => a.set(1)).not.toThrow();
		expect(a.cache).toBe(1);
		expect(other.log.at(-1)).toEqual([["PENDING"], ["DATA", 1]]);
		expect(reported.map((e) => (e as Error).message)).toEqual(["sink"]);
	});
});

describe("C-41: the snapshot is the node's last array that carried DATA", () => {
	it("keeps the last DATA array, not a RESOLVED array; an INVALIDATE leaves START alone", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 0 });
		const plan: Record<number, Wave | null> = {
			1: [["DATA", 1]],
			2: [
				["DATA", 2],
				["DATA", 3],
			],
			3: null, // sends nothing: the kernel's RESOLVED
			4: [["INVALIDATE"]],
		};
		const n = g.node<number>([a], (ctx) => {
			const out = plan[ctx.deps[0].value as number];
			if (out) ctx.down(out);
		});
		n.subscribe(() => {});
		for (const v of [1, 2, 3]) a.set(v);
		const late = arraySink();
		n.subscribe(late.sink);
		expect(late.log).toEqual([[["START"], ["DATA", 2], ["DATA", 3]]]);

		const firstRun: unknown[][][] = [];
		const dependent = g.node<number>([n], (ctx) => {
			if (firstRun.length === 0) firstRun.push(...cloneWaves(ctx));
		});
		dependent.subscribe(() => {});
		expect(firstRun).toEqual([[[2, 3]]]);

		a.set(4);
		const afterInvalidate = arraySink();
		n.subscribe(afterInvalidate.sink);
		expect(afterInvalidate.log).toEqual([[["START"]]]);
	});

	it("a batch is one array, so a state's snapshot carries both values; deactivation keeps a state's", () => {
		const g = graph();
		const q = g.state(0, { name: "q" });
		const n = g.node<number>([q], (ctx) => ctx.down([["DATA", ctx.deps[0].value as number]]), {
			name: "n",
		});
		const stop = n.subscribe(() => {});
		g.batch(() => {
			q.set(1);
			q.set(2);
		});
		const late = arraySink();
		const stopLate = q.subscribe(late.sink);
		expect(late.log).toEqual([[["START"], ["DATA", 1], ["DATA", 2]]]);
		stopLate();
		stop();
		// A computed node drops its values when it deactivates; a state keeps them.
		expect(n.cache).toBeUndefined();
		expect(q.cache).toBe(2);
	});
});

describe("C-4: a sync leg and an async leg: the async result is a later wave, nothing waits across it (R-wave, R-invocation)", () => {
	it("settles the async leg with the kernel's RESOLVED in A's wave; its result is a later wave", () => {
		const g = graph();
		let dRuns = 0;
		let cctx: Ctx | undefined;
		const a = g.node<number>([], null, { initial: 1 });
		const b = g.node<number>([a], (ctx) =>
			ctx.down([["DATA", (ctx.deps[0].value as number) + 10]]),
		); // sync leg
		const c = g.node<number>([a], (ctx) => {
			cctx = ctx; // async leg: the result comes later through this ctx
		});
		const cs = arraySink();
		c.subscribe(cs.sink);
		// Waiting for both legs is sugar (a gate), not kernel behaviour; derived holds it
		// (graphrefly-ts:D184), so its function first runs once c has a value.
		const d = g.derived([b, c], (bv, cv) => {
			dRuns++;
			return (bv as number) + (cv as number);
		});
		const ds = arraySink();
		d.subscribe(ds.sink);
		expect(dRuns).toBe(0);
		(cctx as Ctx).down([["DATA", 21]]);
		expect(dRuns).toBe(1);
		expect(d.cache).toBe(32); // 11 + 21

		ds.log.length = 0;
		cs.log.length = 0;
		a.set(2);
		// In A's wave c sent nothing, so the kernel settled it; d ran once on b's new value and
		// c's old one, and no PENDING stays open while c's work runs.
		expect(cs.log).toEqual([[["PENDING"], ["RESOLVED"]]]);
		expect(dRuns).toBe(2);
		expect(d.cache).toBe(33); // 12 + 21
		expect(ds.log).toEqual([[["PENDING"], ["DATA", 33]]]);
		expect(d.status.cache).not.toBe("stale");

		// c's result is a new wave from c, in which d runs once more.
		ds.log.length = 0;
		(cctx as Ctx).down([["DATA", 30]]);
		expect(dRuns).toBe(3);
		expect(d.cache).toBe(42); // 12 + 30
		expect(ds.log).toEqual([[["PENDING"], ["DATA", 42]]]);
	});
});

describe("C-44 (value and quiet-node clauses): the kernel adds only the settling RESOLVED", () => {
	it("settles a silent node, never holds a wave for a quiet node, and forwards INVALIDATE at once", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 0 });
		const f = g.node<number>([a], (ctx) => {
			const v = ctx.deps[0].value as number;
			if (v % 2 === 0) ctx.down([["DATA", v]]);
		});
		let kept: Ctx | undefined;
		const q = g.node<number>(
			[a],
			(ctx) => {
				kept = ctx;
				const v = ctx.deps[0].value as number;
				if (v === 2) ctx.down([["DATA", 20]]);
			},
			{ quiet: true },
		);
		const dSaw: [unknown, unknown][] = [];
		const d = g.node<number>(
			[a, q],
			(ctx) => {
				dSaw.push([ctx.deps[0].value, ctx.deps[1].value]);
				ctx.down([["DATA", 0]]);
			},
			{},
		);
		const fs = arraySink();
		const qs = arraySink();
		const ds = arraySink();
		f.subscribe(fs.sink);
		q.subscribe(qs.sink);
		d.subscribe(ds.sink);
		for (const s of [fs, qs, ds]) s.log.length = 0;
		dSaw.length = 0;

		a.set(3);
		expect(fs.log).toEqual([[["PENDING"], ["RESOLVED"]]]);
		expect(dSaw).toEqual([[3, undefined]]);

		dSaw.length = 0;
		qs.log.length = 0;
		a.set(2);
		// d ran in a's wave without waiting for q, then again in q's own later wave.
		expect(dSaw).toEqual([
			[2, undefined],
			[2, 20],
		]);
		expect(qs.log).toEqual([[["PENDING"], ["DATA", 20]]]);

		dSaw.length = 0;
		(kept as Ctx).down([["DATA", 21]]);
		expect(dSaw).toEqual([[2, 21]]);

		qs.log.length = 0;
		a.set(5);
		expect(qs.log).toEqual([]); // q sent nothing, and no RESOLVED is added for it

		qs.log.length = 0;
		ds.log.length = 0;
		a.invalidate();
		expect(qs.log).toEqual([[["PENDING"], ["INVALIDATE"]]]);
		expect(ds.log).toEqual([[["PENDING"], ["INVALIDATE"]]]);
	});
});

describe("an empty ctx.down sends nothing (R-wave, as in Rust and Python)", () => {
	/** A node that sends `[["DATA", v * 10]]` per value and an empty array in the same run. */
	function build() {
		const g = graph();
		const a = g.state(1, { name: "a" });
		let held: Ctx | undefined;
		const n = g.node<number>(
			[a],
			(ctx) => {
				held = ctx;
				ctx.down([]);
				ctx.down([["DATA", (ctx.deps[0].value as number) * 10]]);
				ctx.down([]);
			},
			{ name: "n" },
		);
		const s = arraySink();
		n.subscribe(s.sink);
		return { g, a, n, s, held: () => held as Ctx };
	}

	it("during a run: only the non-empty array goes out", () => {
		const { a, s } = build();
		a.set(2);
		expect(s.log).toEqual([
			[["START"], ["DATA", 10]],
			[["PENDING"], ["DATA", 20]],
		]);
	});

	it("after the run, with no wave active: nothing is delivered and the node is unchanged", () => {
		const { n, s, held } = build();
		const before = s.log.length;
		held().down([]);
		expect(s.log.length).toBe(before);
		expect(n.cache).toBe(10);
		expect(n.status.output).not.toBe("completed");
	});

	it("after the run, during another wave: nothing is queued behind it", () => {
		const { g, a, s, held } = build();
		const b = g.state(0, { name: "b" });
		const seen: number[] = [];
		b.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === "DATA") seen.push(m[1] as number);
			// Inside b's delivery wave: the empty array would be a request waiting for it.
			if (msgs.some((m) => m[0] === "DATA" && m[1] === 1)) held().down([]);
		});
		const before = s.log.length;
		b.set(1);
		a.set(3);
		expect(seen).toEqual([0, 1]);
		expect(s.log.slice(before)).toEqual([[["PENDING"], ["DATA", 30]]]);
	});

	it("inside a batch body: the commit carries only the batch's writes", () => {
		const { g, a, s, held } = build();
		const before = s.log.length;
		g.batch(() => {
			held().down([]);
			a.set(4);
			held().down([]);
		});
		expect(s.log.slice(before)).toEqual([[["PENDING"], ["DATA", 40]]]);
	});
});

describe("a ctx kept past its run reads the node's current inputs (D185, graphrefly-ts:D187)", () => {
	it("ctx.deps on a kept ctx shows the latest input, not the first run's copy", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		let kept: Ctx | undefined;
		const n = g.node<number>(
			[a],
			(ctx) => {
				kept ??= ctx;
				ctx.down([["DATA", ctx.deps[0].value as number]]);
			},
			{ name: "n" },
		);
		n.subscribe(() => undefined);
		const first = kept as Ctx;
		expect(first.deps[0].value).toBe(1);
		a.set(2);
		expect(first.deps[0].value).toBe(2);
		expect(n.cache).toBe(2);
	});
});
