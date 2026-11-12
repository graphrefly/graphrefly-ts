/**
 * D797 kernel migration, phase 3 (graphrefly-ts:D797-KERNEL-MIGRATION-TS): terminal and
 * INVALIDATE policies, and the lifetime of an ended node.
 *
 * TS harness for the root scenarios C-3, C-15, C-17, C-34, C-36, C-40 (all but its replace
 * clause, phase 5) and the terminal and manual-INVALIDATE clauses of C-44 in
 * ~/src/graphrefly/spec/conformance.jsonl, against R-terminals@1, R-invalidation@1, R-lifetime@2,
 * R-subscription@3 and R-wave@2. C-34's "Z's subscription runs after the fanout" needs the request
 * queue and is tested in phase 5; here Z's subscription runs at once and still receives the ended
 * node's snapshot.
 */

import { describe, expect, it } from "vitest";
import type { Ctx } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import type { Wave } from "../protocol/messages.js";

/** A sink that records every array it receives, as the kernel delivers it. */
function arrays(): { log: Wave[]; sink: (msgs: Wave) => void } {
	const log: Wave[] = [];
	return { log, sink: (msgs) => log.push(msgs) };
}

const forward = (ctx: Ctx) => {
	for (const v of ctx.deps[0].waves.flat()) ctx.down([["DATA", v]]);
};

const cloneWaves = (ctx: Ctx) => ctx.deps.map((d) => d.waves.map((wave) => [...wave]));

describe("C-3: INVALIDATE through a diamond: one INVALIDATE out, private state kept", () => {
	function diamond(invalidate: "auto" | "manual") {
		const g = graph();
		const s = g.node<number>([], null);
		const b = g.node<number>([s], forward);
		const c = g.node<number>([s], forward);
		const runs: { invalidated: boolean[]; waves: unknown[][][] }[] = [];
		const d = g.node<number>(
			[b, c],
			(ctx) => {
				runs.push({ invalidated: ctx.deps.map((d) => d.invalidated), waves: cloneWaves(ctx) });
				if (ctx.deps.some((d) => d.invalidated)) {
					ctx.down([["INVALIDATE"]]);
					return;
				}
				// graphrefly-ts:D184: the activation run brings no input; count only runs that do.
				if (!ctx.deps.some((d) => d.waves.length > 0)) return;
				const count = (ctx.state.get<number>() ?? 0) + 1;
				ctx.state.set(count);
				ctx.down([["DATA", count]]);
			},
			{ invalidate },
		);
		const sink = arrays();
		d.subscribe(sink.sink);
		return { g, s, d, runs, sink };
	}

	it("auto: the function does not run for it; the value goes, the count stays", () => {
		const f = diamond("auto");
		f.s.set(1);
		expect(f.d.cache).toBe(1);
		f.runs.length = 0;
		f.sink.log.length = 0;
		f.s.invalidate();
		expect(f.sink.log).toEqual([[["PENDING"], ["INVALIDATE"]]]);
		expect(f.runs).toEqual([]);
		expect(f.d.cache).toBeUndefined();
		// An INVALIDATE at a node with no value is dropped and starts no wave.
		f.s.invalidate();
		expect(f.sink.log).toHaveLength(1);
		f.s.set(2);
		expect(f.d.cache).toBe(2); // the private count continued
		expect(f.runs).toHaveLength(1);
	});

	it("manual: the function runs once with both inputs invalidated and sends the INVALIDATE", () => {
		const f = diamond("manual");
		f.s.set(1);
		f.runs.length = 0;
		f.sink.log.length = 0;
		f.s.invalidate();
		expect(f.runs).toEqual([{ invalidated: [true, true], waves: [[], []] }]);
		expect(f.sink.log).toEqual([[["PENDING"], ["INVALIDATE"]]]);
		f.s.set(5);
		expect(f.runs.at(-1)?.invalidated).toEqual([false, false]);
		expect(f.d.cache).toBe(2);
	});
});

describe("C-15: a dependency's terminal settles its pending mark", () => {
	function topology() {
		const g = graph();
		const a = g.node<number>([], null);
		const a2 = g.node<number>([], null);
		const b = g.node<number>([a], forward, {});
		const c = g.node<number>([a2], forward, {});
		const runs: { terminal: unknown[]; waves: unknown[][][] }[] = [];
		const d = g.node<number>(
			[b, c],
			(ctx) => {
				runs.push({ terminal: ctx.deps.map((d) => d.terminal), waves: cloneWaves(ctx) });
			},
			{ complete: "manual", error: "manual" },
		);
		const sink = arrays();
		d.subscribe(sink.sink);
		runs.length = 0;
		return { g, a, a2, b, c, d, runs, sink };
	}

	it("(a) B's COMPLETE without a value and C's value: D runs once on both", () => {
		const f = topology();
		f.g.batch(() => {
			f.a.complete();
			f.a2.set(7);
		});
		expect(f.b.status.output).toBe("completed");
		expect(f.runs).toEqual([{ terminal: [{ kind: "complete" }, undefined], waves: [[], [[7]]] }]);
	});

	it("(b) B's terminal alone: D runs once and settles with the kernel's RESOLVED", () => {
		const f = topology();
		f.sink.log.length = 0;
		f.a.complete();
		expect(f.runs).toEqual([{ terminal: [{ kind: "complete" }, undefined], waves: [[], []] }]);
		expect(f.sink.log).toEqual([[["PENDING"], ["RESOLVED"]]]);
		expect(f.d.status.cache).not.toBe("stale");
	});

	it("(c) B's ERROR and C's value: D runs once with both", () => {
		const f = topology();
		const e = new Error("e");
		f.g.batch(() => {
			f.a.error(e);
			f.a2.set(3);
		});
		expect(f.b.status.output).toBe("errored");
		expect(f.runs).toEqual([
			{ terminal: [{ kind: "error", error: e }, undefined], waves: [[], [[3]]] },
		]);
		expect(f.d.status.output).not.toBe("errored");
	});
});

describe("C-17: an ended dependency counts toward auto COMPLETE, in any order", () => {
	function topology() {
		const g = graph();
		const b = g.node<number>([], null);
		const c = g.node<number>([], null);
		const runs: { terminal: unknown[]; waves: unknown[][][] }[] = [];
		const d = g.node<number>(
			[b, c],
			(ctx) => {
				runs.push({ terminal: ctx.deps.map((d) => d.terminal), waves: cloneWaves(ctx) });
			},
			{ error: "manual" },
		);
		let ctrlRuns = 0;
		const dctrl = g.node<number>(
			[b, c],
			() => {
				ctrlRuns++;
			},
			{},
		);
		const ds = arrays();
		const cs = arrays();
		d.subscribe(ds.sink);
		dctrl.subscribe(cs.sink);
		runs.length = 0;
		ctrlRuns = 0;
		return { g, b, c, d, dctrl, runs, ds, cs, ctrlRuns: () => ctrlRuns };
	}
	const completes = (log: Wave[]) => log.filter((a) => a.some((m) => m[0] === "COMPLETE")).length;

	it("(a) C's ERROR first, then B's value and COMPLETE", () => {
		const f = topology();
		const e = new Error("e");
		f.c.error(e);
		expect(f.runs).toEqual([
			{ terminal: [undefined, { kind: "error", error: e }], waves: [[], []] },
		]);
		expect(f.d.status.output).not.toBe("errored");
		expect(f.dctrl.status.output).toBe("errored");
		expect(f.ctrlRuns()).toBe(0);
		f.g.batch(() => {
			f.b.set(1);
			f.b.complete();
		});
		// The function sees the wave's terminal whatever the policy; under auto it does not end D.
		expect(f.runs.at(-1)).toEqual({
			terminal: [{ kind: "complete" }, undefined],
			waves: [[[1]], []],
		});
		expect(f.d.status.output).toBe("completed");
		expect(completes(f.ds.log)).toBe(1);
	});

	it("(b) B's value and COMPLETE first, then C's ERROR", () => {
		const f = topology();
		const e = new Error("e");
		f.g.batch(() => {
			f.b.set(1);
			f.b.complete();
		});
		expect(f.d.status.output).not.toBe("completed");
		f.c.error(e);
		expect(f.runs.at(-1)).toEqual({
			terminal: [undefined, { kind: "error", error: e }],
			waves: [[], []],
		});
		expect(f.d.status.output).toBe("completed");
		expect(completes(f.ds.log)).toBe(1);
		expect(f.dctrl.status.output).toBe("errored");
	});
});

describe("C-34: terminal fanout, the ended node's lifetime closing, and acquiring an ended node", () => {
	it("delivers the whole array, then closes the lifetime and keeps the value and terminal", () => {
		const reports: unknown[] = [];
		const g = graph({ report: (failure) => reports.push(failure.error) });
		const t = g.state<number>(undefined as unknown as number, { name: "t" });
		let runs = 0;
		let cleanups = 0;
		const s = g.node<number>(
			[t],
			(ctx) => {
				runs++;
				if (ctx.deps[0].value === 1) ctx.down([["DATA", 1], ["COMPLETE"]]);
			},
			{
				name: "s",
				// The lifetime's cleanup; the function also runs on activation (graphrefly-ts:D184).
				setup: () => () => {
					cleanups++;
				},
			},
		);
		const x: Wave[] = [];
		const y: Wave[] = [];
		const z: Wave[] = [];
		const boom = new Error("x's sink");
		let subscribed = false;
		s.subscribe((msgs) => {
			x.push(msgs);
			if (!subscribed && msgs.some((m) => m[0] === "COMPLETE")) {
				subscribed = true;
				s.subscribe((m) => z.push(m));
				throw boom;
			}
		});
		s.subscribe((msgs) => y.push(msgs));
		x.length = 0;
		y.length = 0;
		runs = 0;
		t.set(1);
		expect(x).toEqual([[["PENDING"], ["DATA", 1], ["COMPLETE"]]]);
		expect(y).toEqual([[["PENDING"], ["DATA", 1], ["COMPLETE"]]]);
		expect(z).toEqual([[["START"], ["DATA", 1], ["COMPLETE"]]]);
		expect(reports).toEqual([boom]);
		expect(s.status.output).toBe("completed");
		expect(s.cache).toBe(1);
		expect(cleanups).toBe(1);
		// The lifetime released T, which has no other dependent.
		expect((t as unknown as { _subscriberCount(): number })._subscriberCount()).toBe(0);
		expect(runs).toBe(1);
		// S never runs again.
		expect(() => t.set(2)).not.toThrow();
		expect(runs).toBe(1);
	});
});

describe("C-36: input arrays and terminal admission in one invocation", () => {
	it("manual COMPLETE: one invocation sees the values and the COMPLETE; d stays open", () => {
		const g = graph();
		const a = g.node<number>([], null);
		const seen: { waves: unknown[][][]; terminal: unknown[] }[] = [];
		const d = g.node<number>(
			[a],
			(ctx) => {
				seen.push({ waves: cloneWaves(ctx), terminal: ctx.deps.map((d) => d.terminal) });
			},
			{ complete: "manual" },
		);
		d.subscribe(() => {});
		seen.length = 0;
		g.batch(() => {
			a.set(20);
			a.complete();
		});
		expect(seen).toEqual([{ waves: [[[20]]], terminal: [{ kind: "complete" }] }]);
		expect(d.status.output).not.toBe("completed");
	});

	it("auto COMPLETE: the run's output, then COMPLETE, with no balancing RESOLVED", () => {
		const g = graph();
		const a = g.node<number>([], null);
		const d = g.node<number>([a], (ctx) => ctx.down([["DATA", (ctx.deps[0].value as number) * 2]]));
		const sink = arrays();
		d.subscribe(sink.sink);
		sink.log.length = 0;
		g.batch(() => {
			a.set(5);
			a.complete();
		});
		expect(sink.log).toEqual([
			[["PENDING"], ["DATA", 10]],
			[["PENDING"], ["COMPLETE"]],
		]);
	});

	it("[DATA 7, INVALIDATE] is published as [PENDING, INVALIDATE]; d does not run", () => {
		const g = graph();
		const a = g.node<number>([], null);
		let runs = 0;
		const d = g.node<number>([a], (ctx) => {
			runs++;
			const v = ctx.deps[0].value as number | undefined;
			if (v !== undefined) ctx.down([["DATA", v]]);
		});
		const as = arrays();
		const ds = arrays();
		a.subscribe(as.sink);
		d.subscribe(ds.sink);
		a.set(1);
		as.log.length = 0;
		ds.log.length = 0;
		runs = 0;
		g.batch(() => {
			a.set(7);
			a.invalidate();
		});
		expect(as.log).toEqual([[["PENDING"], ["INVALIDATE"]]]);
		expect(ds.log).toEqual([[["PENDING"], ["INVALIDATE"]]]);
		expect(runs).toBe(0);
		expect(a.cache).toBeUndefined();
		expect(d.cache).toBeUndefined();
	});
});

describe("C-40: an ended node can be subscribed and depended on", () => {
	it("gives its snapshot with its terminal; the policies apply to it at a first run", () => {
		const g = graph();
		const s = g.node<number>([], null);
		s.set(1);
		s.complete();
		const e = new Error("e");
		const t = g.node<number>([], null);
		t.error(e);

		const sink = arrays();
		s.subscribe(sink.sink);
		expect(sink.log).toEqual([[["START"], ["DATA", 1], ["COMPLETE"]]]);

		let dRuns = 0;
		const d = g.node<number>([s], (ctx) => {
			dRuns++;
			ctx.down([["DATA", ctx.deps[0].value as number]]);
		});
		const ds = arrays();
		d.subscribe(ds.sink);
		expect(dRuns).toBe(1);
		expect(d.status.output).toBe("completed");
		expect(ds.log).toEqual([[["START"], ["DATA", 1], ["COMPLETE"]]]);

		let eRuns = 0;
		const en = g.node<number>([t], () => {
			eRuns++;
		});
		en.subscribe(() => {});
		expect(eRuns).toBe(0);
		expect(en.status.output).toBe("errored");

		const mSeen: unknown[][] = [];
		const m = g.node<number>(
			[t],
			(ctx) => {
				mSeen.push(ctx.deps.map((d) => d.terminal));
			},
			{ complete: "manual", error: "manual" },
		);
		m.subscribe(() => {});
		expect(mSeen).toEqual([[{ kind: "error", error: e }]]);
		expect(m.status.output).not.toBe("errored");

		expect(() => s.set(2)).toThrow(/ended/);
		expect(s.cache).toBe(1);
	});
});

describe("C-44: a wave of terminals or INVALIDATEs holds a fan-in", () => {
	it("manual COMPLETE: D waits for both legs' COMPLETE and runs once on both", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 0 });
		const b = g.node<number>([s], forward);
		const c = g.node<number>([s], forward);
		const bs = arrays();
		const runs: unknown[][] = [];
		const d = g.node<number>(
			[b, c],
			(ctx) => {
				runs.push(ctx.deps.map((d) => d.terminal));
			},
			{ complete: "manual" },
		);
		b.subscribe(bs.sink);
		d.subscribe(() => {});
		runs.length = 0;
		bs.log.length = 0;
		s.complete();
		expect(bs.log).toEqual([[["PENDING"], ["COMPLETE"]]]);
		expect(runs).toEqual([[{ kind: "complete" }, { kind: "complete" }]]);
	});

	it("manual INVALIDATE: D waits for both legs and runs once, seeing both invalidated", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 0 });
		const b = g.node<number>([s], forward);
		const c = g.node<number>([s], forward);
		const runs: boolean[][] = [];
		const d = g.node<number>(
			[b, c],
			(ctx) => {
				runs.push(ctx.deps.map((d) => d.invalidated));
			},
			{ invalidate: "manual" },
		);
		d.subscribe(() => {});
		runs.length = 0;
		s.invalidate();
		expect(runs).toEqual([[true, true]]);
	});

	it("an INVALIDATE reaches a quiet node's sink and the fan-in's at once, in the source's wave", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		const q = g.node<number>([a], forward, { quiet: true });
		const d = g.node<number>(
			[a, q],
			(ctx) => ctx.down([["DATA", ctx.deps[0].value as number]]),
			{},
		);
		const qs = arrays();
		const ds = arrays();
		q.subscribe(qs.sink);
		d.subscribe(ds.sink);
		a.set(2);
		qs.log.length = 0;
		ds.log.length = 0;
		a.invalidate();
		expect(qs.log).toEqual([[["PENDING"], ["INVALIDATE"]]]);
		expect(ds.log).toEqual([[["PENDING"], ["INVALIDATE"]]]);
	});
});
