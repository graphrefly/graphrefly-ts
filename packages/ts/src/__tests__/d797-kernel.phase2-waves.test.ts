/**
 * D797 kernel migration, phase 2 (graphrefly-ts:D797-KERNEL-MIGRATION-TS): waves and arrays.
 *
 * TS harness for the root scenarios C-12, C-16, C-23, C-28, C-41 and the value and quiet-node
 * clauses of C-44 in ~/src/graphrefly/spec/conformance.jsonl, against R-wave@2, R-subscription@3,
 * R-invocation@2 and R-failure@3. Clauses that need the request queue (phase 5) or the terminal
 * and INVALIDATE policies (phase 3) are tested in those phases.
 */

import { describe, expect, it } from "vitest";
import { batch } from "../batch/batch.js";
import { type Ctx, depBatch, depLatest } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import { node } from "../node/node.js";
import type { Message, Wave } from "../protocol/messages.js";

/** A sink that records every array it receives, as the kernel delivers it. */
function arrays(): { log: Wave[]; sink: (msgs: Wave) => void } {
	const log: Wave[] = [];
	return { log, sink: (msgs) => log.push(msgs) };
}

const cloneWaves = (ctx: Ctx) => ctx.waveData.map((waves) => waves.map((wave) => [...wave]));

describe("C-12: occurrences stay DATA; RESOLVED only settles a node that sent nothing", () => {
	it("(a) equal values are distinct occurrences", () => {
		const source = node<number>([], null);
		const s = arrays();
		source.subscribe(s.sink);
		source.down([["DATA", 1]]);
		source.down([["DATA", 1]]);
		source.down([["DATA", 1]]);
		source.down([["COMPLETE"]]);
		expect(s.log).toEqual([
			[["START"]],
			[["PENDING"], ["DATA", 1]],
			[["PENDING"], ["DATA", 1]],
			[["PENDING"], ["DATA", 1]],
			[["PENDING"], ["COMPLETE"]],
		]);
	});

	it("(b) a silent pending node settles with exactly one kernel RESOLVED per wave", () => {
		const source = node<number>([], null, { initial: 0 });
		const silent = node<number>([source], () => {});
		const below = node<number>([silent], (ctx) => ctx.down([["DATA", 1]]));
		const s = arrays();
		silent.subscribe(s.sink);
		below.subscribe(() => {});
		s.log.length = 0;
		for (const v of [1, 2, 3]) source.down([["DATA", v]]);
		expect(s.log).toEqual([
			[["PENDING"], ["RESOLVED"]],
			[["PENDING"], ["RESOLVED"]],
			[["PENDING"], ["RESOLVED"]],
		]);
		expect(below.status).not.toBe("dirty");
	});
});

describe("C-16: a quiet node absorbs its input waves without leaving dependents pending", () => {
	it("marks nothing below it pending; what it sends later is its own wave; START has its last array", () => {
		const a = node<number>([], null, { initial: 0 });
		let kept: Ctx | undefined;
		const q = node<number>(
			[a],
			(ctx) => {
				kept = ctx;
				const held = ctx.state.get<number[]>() ?? [];
				ctx.state.set([...held, ...((depBatch(ctx, 0) ?? []) as number[])]);
			},
			{ quiet: true },
		);
		let eRuns = 0;
		const e = node<number>([q], (ctx) => {
			eRuns++;
			ctx.down([["DATA", (depBatch(ctx, 0) ?? []).length]]);
		});
		const s = arrays();
		q.subscribe(s.sink);
		e.subscribe(() => {});
		s.log.length = 0;
		eRuns = 0;

		for (const v of [1, 2, 3]) a.down([["DATA", v]]);
		expect(s.log).toEqual([]); // not even PENDING
		expect(eRuns).toBe(0);
		expect(e.status).not.toBe("dirty");

		const held = (kept as Ctx).state.get<number[]>() as number[];
		(kept as Ctx).down(held.map((v) => ["DATA", v] as Message));
		expect(s.log).toEqual([[["PENDING"], ...held.map((v) => ["DATA", v])]]);
		expect(eRuns).toBe(1);

		const late = arrays();
		q.subscribe(late.sink);
		expect(late.log).toEqual([[["START"], ...held.map((v) => ["DATA", v])]]);
	});
});

describe("C-23: ctx.waveData, ctx.terminal and the latest value are the function's only input", () => {
	it("gives each dependency its arrays, terminal and latest value", () => {
		const captures: { waves: unknown[][][]; terminal: unknown[]; latest: unknown[] }[] = [];
		const trigger = node<number>([], null, { initial: 0 });
		// a sends nothing for an odd trigger, so the kernel settles it with RESOLVED.
		const a = node<unknown>([trigger], (ctx) => {
			const v = depLatest(ctx, 0) as number;
			if (v % 2 === 0) ctx.down([["DATA", v]]);
		});
		const b = node<unknown>([], null);
		const n = node<unknown>(
			[a, b],
			(ctx) => {
				captures.push({
					waves: cloneWaves(ctx),
					terminal: [...ctx.terminal],
					latest: [depLatest(ctx, 0), depLatest(ctx, 1)],
				});
			},
			{ partial: true, terminal: { complete: "manual", error: "manual" } },
		);
		n.subscribe(() => {});

		// (a) write B only: A's entry has no arrays
		b.down([["DATA", "b"]]);
		expect(captures.at(-1)?.waves).toEqual([[], [["b"]]]);
		// (b) A sends RESOLVED alone: one empty array
		trigger.down([["DATA", 1]]);
		expect(captures.at(-1)?.waves).toEqual([[[]], []]);
		// (c) split at the last INVALIDATE: N sees [3]
		a.down([["DATA", 1], ["DATA", 2], ["INVALIDATE"], ["DATA", 3]]);
		expect(captures.at(-1)?.waves).toEqual([[[3]], []]);
		expect(captures.at(-1)?.latest).toEqual([3, "b"]);
		// (d) null and [] are ordinary payloads
		a.down([["DATA", null]]);
		expect(captures.at(-1)?.waves).toEqual([[[null]], []]);
		a.down([["DATA", []]]);
		expect(captures.at(-1)?.waves).toEqual([[[[]]], []]);
		// (e) terminals are never among the arrays
		const e = new Error("e");
		batch(() => {
			a.down([["COMPLETE"]]);
			b.down([["ERROR", e]]);
		});
		expect(captures.at(-1)?.terminal).toEqual([true, e]);
		expect(captures.at(-1)?.waves.flat(2)).toEqual([]);
		// (f) DATA SENTINEL is rejected
		const c = node<unknown>([], null);
		expect(() => c.down([["DATA", undefined]])).toThrow(/SENTINEL/);
	});
});

describe("C-28: intact output arrays, kernel-only PENDING prefixes and written order", () => {
	function diamond() {
		const g = graph();
		const t = g.state(0, { name: "t" });
		let send: (ctx: Ctx) => void = () => {};
		const a = g.node<number>([t], (ctx) => send(ctx), { name: "a" });
		const b = g.node<number>([a], (ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]), {
			name: "b",
		});
		const c = g.node<number>([a], (ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]), {
			name: "c",
		});
		const seen: [unknown, unknown][] = [];
		const d = g.node<number>(
			[b, c],
			(ctx) => {
				seen.push([depLatest(ctx, 0), depLatest(ctx, 1)]);
				ctx.down([["DATA", 0]]);
			},
			{ name: "d" },
		);
		const s1 = arrays();
		const s2 = arrays();
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
		const s = node<number>([], null, { initial: 0 });
		const log = arrays();
		s.subscribe(log.sink);
		log.log.length = 0;
		batch(() => {
			s.down([["DATA", 1]]);
			expect(() => s.down([["RESOLVED"]])).toThrow(/kernel/);
			s.down([["COMPLETE"]]);
			expect(() => s.down([["DATA", 2]])).toThrow(/last/);
			expect(log.log).toEqual([]);
		});
		expect(log.log).toEqual([[["PENDING"], ["DATA", 1], ["COMPLETE"]]]);
	});

	it("a sink failure goes to the host reporter and rolls nothing back", () => {
		const reported: unknown[] = [];
		const g = graph({ report: (failure) => reported.push(failure.error) });
		const a = g.state(0);
		const other = arrays();
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
		const a = node<number>([], null, { initial: 0 });
		const plan: Record<number, Wave | null> = {
			1: [["DATA", 1]],
			2: [
				["DATA", 2],
				["DATA", 3],
			],
			3: null, // sends nothing: the kernel's RESOLVED
			4: [["INVALIDATE"]],
		};
		const n = node<number>([a], (ctx) => {
			const out = plan[depLatest(ctx, 0) as number];
			if (out) ctx.down(out);
		});
		n.subscribe(() => {});
		for (const v of [1, 2, 3]) a.down([["DATA", v]]);
		const late = arrays();
		n.subscribe(late.sink);
		expect(late.log).toEqual([[["START"], ["DATA", 2], ["DATA", 3]]]);

		const firstRun: unknown[][][] = [];
		const dependent = node<number>([n], (ctx) => {
			if (firstRun.length === 0) firstRun.push(...cloneWaves(ctx));
		});
		dependent.subscribe(() => {});
		expect(firstRun).toEqual([[[2, 3]]]);

		a.down([["DATA", 4]]);
		const afterInvalidate = arrays();
		n.subscribe(afterInvalidate.sink);
		expect(afterInvalidate.log).toEqual([[["START"]]]);
	});

	it("a batch is one array, so a state's snapshot carries both values; deactivation keeps a state's", () => {
		const g = graph();
		const q = g.state(0, { name: "q" });
		const n = g.node<number>([q], (ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]), {
			name: "n",
		});
		const stop = n.subscribe(() => {});
		batch(() => {
			q.set(1);
			q.set(2);
		});
		const late = arrays();
		const stopLate = q.subscribe(late.sink);
		expect(late.log).toEqual([[["START"], ["DATA", 1], ["DATA", 2]]]);
		stopLate();
		stop();
		// A computed node drops its values when it deactivates; a state keeps them.
		expect(n.cache).toBeUndefined();
		expect(q.cache).toBe(2);
	});
});

describe("C-44 (value and quiet-node clauses): the kernel adds only the settling RESOLVED", () => {
	it("settles a silent node, never holds a wave for a quiet node, and forwards INVALIDATE at once", () => {
		const a = node<number>([], null, { initial: 0 });
		const f = node<number>([a], (ctx) => {
			const v = depLatest(ctx, 0) as number;
			if (v % 2 === 0) ctx.down([["DATA", v]]);
		});
		let kept: Ctx | undefined;
		const q = node<number>(
			[a],
			(ctx) => {
				kept = ctx;
				const v = depLatest(ctx, 0) as number;
				if (v === 2) ctx.down([["DATA", 20]]);
			},
			{ quiet: true },
		);
		const dSaw: [unknown, unknown][] = [];
		const d = node<number>(
			[a, q],
			(ctx) => {
				dSaw.push([depLatest(ctx, 0), depLatest(ctx, 1)]);
				ctx.down([["DATA", 0]]);
			},
			{ partial: true },
		);
		const fs = arrays();
		const qs = arrays();
		const ds = arrays();
		f.subscribe(fs.sink);
		q.subscribe(qs.sink);
		d.subscribe(ds.sink);
		for (const s of [fs, qs, ds]) s.log.length = 0;
		dSaw.length = 0;

		a.down([["DATA", 3]]);
		expect(fs.log).toEqual([[["PENDING"], ["RESOLVED"]]]);
		expect(dSaw).toEqual([[3, undefined]]);

		dSaw.length = 0;
		qs.log.length = 0;
		a.down([["DATA", 2]]);
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
		a.down([["DATA", 5]]);
		expect(qs.log).toEqual([]); // q sent nothing, and no RESOLVED is added for it

		qs.log.length = 0;
		ds.log.length = 0;
		a.down([["INVALIDATE"]]);
		expect(qs.log).toEqual([[["PENDING"], ["INVALIDATE"]]]);
		expect(ds.log).toEqual([[["PENDING"], ["INVALIDATE"]]]);
	});
});
