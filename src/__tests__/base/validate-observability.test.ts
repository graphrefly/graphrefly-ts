import { node } from "@graphrefly/pure-ts/core/node.js";
import { Graph } from "@graphrefly/pure-ts/graph/graph.js";
import { describe, expect, it } from "vitest";
import { validateGraphObservability } from "../../base/validate-observability.js";

describe("validateGraphObservability (D4)", () => {
	it("passes a clean graph with registered paths and reachable pairs", () => {
		const g = new Graph("g");
		const a = node([], { name: "a", initial: 1 });
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) * 2);
			},
			{ describeKind: "derived", name: "b" },
		);
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const r = validateGraphObservability(g, {
			paths: ["a", "b"],
			pairs: [["a", "b"]],
		});
		expect(r.ok).toBe(true);
		expect(r.failures).toEqual([]);
		expect(r.checks.some((c) => c.kind === "describe" && c.ok === true)).toBe(true);
		expect(r.summary()).toContain("OK");
	});

	it("reports an observe failure on a non-existent path", () => {
		const g = new Graph("g");
		g.add(node([], { name: "a", initial: 0 }), { name: "a" });
		const r = validateGraphObservability(g, { paths: ["missing"] });
		expect(r.ok).toBe(false);
		const obs = r.failures.find((c) => c.kind === "observe");
		expect(obs?.ok).toBe(false);
		if (obs?.kind === "observe") expect(obs.path).toBe("missing");
	});

	it("reports an explain failure when requireFound is true and no path exists", () => {
		const g = new Graph("g");
		const a = node([], { name: "a", initial: 1 });
		const b = node([], { name: "b", initial: 2 });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const r = validateGraphObservability(g, { pairs: [["a", "b"]] });
		expect(r.ok).toBe(false);
		expect(r.failures[0]?.kind).toBe("explain");
	});

	it("requireFound: false keeps no-path pairs as passing", () => {
		const g = new Graph("g");
		g.add(node([], { name: "a", initial: 1 }), { name: "a" });
		g.add(node([], { name: "b", initial: 2 }), { name: "b" });
		const r = validateGraphObservability(g, {
			pairs: [["a", "b"]],
			requireFound: false,
		});
		expect(r.ok).toBe(true);
	});

	it("D1 formats: exercises each requested describe format and reports render length", () => {
		const g = new Graph("g");
		const a = node([], { name: "a", initial: 1 });
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) * 2);
			},
			{ describeKind: "derived", name: "b" },
		);
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const r = validateGraphObservability(g, {
			formats: ["mermaid", "mermaid-url", "pretty", "json"],
		});
		expect(r.ok).toBe(true);
		const fmts = r.checks.filter((c) => c.kind === "describe-format");
		expect(fmts).toHaveLength(4);
		for (const c of fmts) {
			if (c.kind === "describe-format" && c.ok) {
				expect(c.length).toBeGreaterThan(0);
			}
		}
	});
});
