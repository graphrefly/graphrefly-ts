/**
 * D797 review regressions (REVIEW-D797-migration-fable 2.2-2.4, -codex F1, F2, F3, F7): output
 * after a function returned is a request of its graph (R-wave@2, R-request-order@2), output and
 * private state through a closed lifetime's ctx are dropped (R-lifetime@2), and a quiet node's run
 * output is one later wave (R-wave@2).
 */

import { describe, expect, it } from "vitest";
import type { Ctx } from "../ctx/types.js";
import { depBatch } from "../ctx/types.js";
import { graph, type Message } from "../index.js";

const values = (msgs: readonly Message[]) => msgs.filter((m) => m[0] === "DATA").map((m) => m[1]);

describe("late output and closed lifetimes (D797 review)", () => {
	it("a ctx.down after the function returned waits for the wave being delivered (F1 / 2.2)", () => {
		const g = graph();
		const t = g.state(0, { name: "t" });
		let kept: Ctx | undefined;
		const src = g.node<string>(
			[],
			(ctx) => {
				kept = ctx;
			},
			{ name: "src" },
		);
		const log: string[] = [];
		src.subscribe((msgs) => {
			for (const v of values(msgs)) log.push(`src:${String(v)}`);
		});
		t.subscribe((msgs) => {
			for (const v of values(msgs)) {
				log.push(`t first:${String(v)}`);
				if (v === 1) kept?.down([["DATA", "late"]]);
			}
		});
		t.subscribe((msgs) => {
			for (const v of values(msgs)) log.push(`t second:${String(v)}`);
		});
		log.length = 0;
		t.set(1);
		expect(log).toEqual(["t first:1", "t second:1", "src:late"]);
	});

	it("a closed lifetime's ctx neither reads nor writes the next lifetime's private state (F2 / 2.3)", () => {
		const g = graph();
		const s = g.state(1, { name: "s" });
		const ctxs: Ctx[] = [];
		const n = g.node<number>(
			[s],
			(ctx) => {
				ctxs.push(ctx);
				if (ctx.state.get() === undefined) ctx.state.set("fresh");
			},
			{ name: "n" },
		);
		const stop = n.subscribe(() => {});
		const old = ctxs.at(-1)!;
		stop();
		n.subscribe(() => {});
		const current = ctxs.at(-1)!;
		expect(old.signal.aborted).toBe(true);
		expect(old.state.get()).toBeUndefined();
		old.state.set("stale");
		expect(current.state.get()).toBe("fresh");
		old.down([["DATA", 99]]);
		expect(n.cache).not.toBe(99);
	});

	it("a quiet node's queued output is dropped when its lifetime closes before it runs (2.3)", () => {
		const g = graph();
		const up = g.state(0, { name: "up" });
		const q = g.node<number>(
			[up],
			(ctx) => {
				for (const v of depBatch(ctx, 0) ?? []) ctx.down([["DATA", (v as number) * 10]]);
			},
			{ name: "q", quiet: true },
		);
		let stopQ: (() => void) | undefined;
		// The first subscriber of up asks for q's last sink to leave; q runs in the same wave, so its
		// output is queued after that request.
		up.subscribe((msgs) => {
			if (values(msgs).includes(5)) stopQ?.();
		});
		const seen: unknown[] = [];
		stopQ = q.subscribe((msgs) => seen.push(...values(msgs)));
		seen.length = 0;
		up.set(5);
		expect(seen).toEqual([]);
		expect(q.status.lifecycle).not.toBe("active");
		expect(q.cache).not.toBe(50);
	});

	it("a quiet node's queued output does not cross a replace into the new instance (F3)", () => {
		const reports: unknown[] = [];
		const g = graph({ report: (f) => reports.push(f) });
		const up = g.state(0, { name: "up" });
		const q = g.node<number>(
			[up],
			(ctx) => {
				for (const v of depBatch(ctx, 0) ?? []) if (v === 1) ctx.down([["DATA", 100]]);
			},
			{ name: "q", quiet: true },
		);
		// up's first subscriber asks for the replace; q runs in the same wave and queues DATA 100
		// after it, so the queued output belongs to an instance that is gone when it runs.
		up.subscribe((msgs) => {
			if (values(msgs).includes(1))
				g.replace(q, [up], (ctx) => {
					if (depBatch(ctx, 0) !== null) ctx.down([["DATA", 999]]);
				});
		});
		const seen: unknown[] = [];
		q.subscribe((msgs) => seen.push(...values(msgs)));
		seen.length = 0;
		up.set(1);
		expect(seen).not.toContain(100);
		expect(reports).toEqual([]);
	});

	it("a quiet run's arrays go out as one later wave, kept apart (F7 / 2.4)", () => {
		const g = graph();
		const up = g.state(0, { name: "up" });
		const q = g.node<string>(
			[up],
			(ctx) => {
				if (depBatch(ctx, 0) === null) return;
				ctx.down([["DATA", "a"]]);
				ctx.down([["DATA", "b"]]);
			},
			{ name: "q", quiet: true },
		);
		const runs: unknown[][][] = [];
		const d = g.node<number>(
			[q],
			(ctx) => {
				runs.push(ctx.waveData[0]!.map((w) => [...w]));
			},
			{ name: "d", partial: true },
		);
		d.subscribe(() => {});
		const arrays: unknown[][] = [];
		q.subscribe((msgs) => {
			if (msgs[0]?.[0] !== "START") arrays.push(values(msgs));
		});
		runs.length = 0;
		up.set(1);
		expect(runs).toEqual([[["a"], ["b"]]]); // one run of d, two arrays
		expect(arrays).toEqual([["a"], ["b"]]);
	});

	it("an invalid array from a quiet node throws from ctx.down (2.4)", () => {
		const g = graph();
		const up = g.state(0, { name: "up" });
		const thrown: unknown[] = [];
		const q = g.node<number>(
			[up],
			(ctx) => {
				if (depBatch(ctx, 0) === null) return;
				try {
					ctx.down([["COMPLETE"], ["DATA", 1]]);
				} catch (e) {
					thrown.push(e);
				}
			},
			{ name: "q", quiet: true },
		);
		q.subscribe(() => {});
		up.set(1);
		expect(thrown.length).toBeGreaterThan(0); // every run that tried it got the throw
		for (const e of thrown) expect(String(e)).toMatch(/terminal must be the last/);
		expect(q.status.output).not.toBe("completed");
	});
});
