/**
 * graphrefly:D806 kernel corrections: (1) under auto COMPLETE the run that sees the last terminal
 * calls the function, also when that terminal is its only input (R-terminals@1, C-17); (3) a quiet
 * node forwarding an auto INVALIDATE marks its cone pending, so a diamond below settles once (C-16).
 */

import { describe, expect, it } from "vitest";

import { graph } from "../index.js";
import { collect } from "./helpers/collect.js";

describe("D806 kernel corrections", () => {
	it("auto COMPLETE: the run that sees the last terminal calls the function once (Q12, C-17)", () => {
		const g = graph();
		const b = g.state<number>(1, { name: "b" });
		const c = g.state<number>(2, { name: "c" });
		const runs: string[] = [];
		const d = g.node<number>(
			[b, c],
			(ctx) => {
				runs.push(
					`b=${ctx.deps[0].terminal?.kind ?? "none"} c=${ctx.deps[1].terminal?.kind ?? "none"}`,
				);
			},
			{ name: "d" },
		);
		const out = collect(d).msgs;
		runs.length = 0;
		b.complete(); // an earlier terminal alone does not run it, nor ends d: ALL deps, not ANY
		expect(runs).toEqual([]);
		expect(out.filter((m) => m[0] === "COMPLETE")).toHaveLength(0);
		expect(d.status.output).toBe("open");
		c.complete(); // the last terminal, the run's only input: one run, then COMPLETE
		expect(runs).toEqual(["b=none c=complete"]);
		expect(d.status.output).toBe("completed");
		expect(out.filter((m) => m[0] === "COMPLETE")).toHaveLength(1);
	});

	it("a quiet node's auto INVALIDATE marks its cone pending; a diamond below settles once (F 2.10, C-16)", () => {
		const g = graph();
		const s = g.state(1, { name: "s" });
		const q = g.node<number>(
			[s],
			(ctx) => {
				for (const v of ctx.deps[0].waves.flat()) ctx.down([["DATA", v as number]]);
			},
			{ name: "q", quiet: true },
		);
		const l = g.node<number>([q], (ctx) => ctx.down([["DATA", 1]]), {
			name: "l",
			invalidate: "manual",
		});
		const r = g.node<number>([q], (ctx) => ctx.down([["DATA", 2]]), {
			name: "r",
			invalidate: "manual",
		});
		let joinRuns = 0;
		const j = g.node<number>(
			[l, r],
			() => {
				joinRuns += 1;
			},
			{ name: "j", invalidate: "manual" },
		);
		j.subscribe(() => {});
		joinRuns = 0;
		s.invalidate();
		expect(joinRuns).toBe(1);
	});
});
