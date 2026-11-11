/**
 * graphrefly:D806 (2) and REVIEW-D797-migration-codex F4 (C-35): the cycle check of replace and
 * ctx.rewire runs again when the queued request runs; refused, the request changes nothing and its
 * failure goes to the host reporter, never to a node's ERROR.
 */

import { describe, expect, it } from "vitest";
import type { Ctx } from "../ctx/types.js";
import { graph } from "../index.js";

describe("queued topology requests re-check for cycles (D806, C-35)", () => {
	it("two rewires from one callback that would close a cycle: the second is refused and reported", () => {
		const reports: { source: string; error: unknown }[] = [];
		const g = graph({ report: (f) => reports.push(f) });
		const s = g.state(1, { name: "s" });
		const ctxs = new Map<string, Ctx>();
		const a = g.node<number>([s], (ctx) => void ctxs.set("a", ctx), { name: "a" });
		const b = g.node<number>([s], (ctx) => void ctxs.set("b", ctx), { name: "b" });
		a.subscribe(() => {});
		b.subscribe(() => {});
		s.subscribe((msgs) => {
			if (!msgs.some((m) => m[0] === "DATA" && m[1] === 2)) return;
			// Each is acyclic when asked for; together they would close a cycle.
			ctxs.get("a")?.rewire([s, b]);
			ctxs.get("b")?.rewire([s, a]);
		});
		s.set(2);
		expect(a.deps).toEqual([s, b]);
		expect(b.deps).toEqual([s]); // the refused request changed nothing
		expect(reports).toHaveLength(1);
		expect(String(reports[0]?.error)).toMatch(/depends on it/);
		expect(a.status.output).not.toBe("errored");
		expect(b.status.output).not.toBe("errored");
	});

	it("two replaces in one batch that would close a cycle: the second is refused and reported", () => {
		const reports: { source: string; error: unknown }[] = [];
		const g = graph({ report: (f) => reports.push(f) });
		const s = g.state(1, { name: "s" });
		const m = g.node<number>([s], () => {}, { name: "m" });
		const n = g.node<number>([s], () => {}, { name: "n" });
		m.subscribe(() => {});
		n.subscribe(() => {});
		g.batch(() => {
			g.replace(m, [n], () => {});
			g.replace(n, [m], () => {});
		});
		expect(m.deps).toEqual([n]);
		expect(n.deps).toEqual([s]);
		expect(reports).toHaveLength(1);
		expect(String(reports[0]?.error)).toMatch(/depends on it/);
		expect(n.status.output).not.toBe("errored");
	});
});
