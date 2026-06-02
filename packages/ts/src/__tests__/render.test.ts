/**
 * CSP-2.8 render first-cut (D39/D40): pure functions over DescribeSnapshot.
 */

import { describe, expect, it } from "vitest";
import {
	type DescribeSnapshot,
	describeToAscii,
	describeToD2,
	describeToJson,
	describeToMermaid,
	describeToMermaidUrl,
	describeToPretty,
	graph,
	mermaidLiveUrl,
} from "../index.js";

describe("describe renderers (D39/D40)", () => {
	it("renders Mermaid from a flat + mounted describe snapshot", () => {
		const parent = graph({ name: "demo" });
		const count = parent.state(0, { name: "count" });
		const doubled = parent.derived([count], (n) => n * 2, { name: "doubled" });
		doubled.subscribe(() => {});
		count.set(5);

		const child = graph();
		const leaf = child.state("ready", { name: 'leaf "quoted"' });
		leaf.subscribe(() => {});
		parent.mount(child, { at: "child" });

		expect(describeToMermaid(parent.describe(), { direction: "TD" })).toBe(
			[
				"flowchart TD",
				'  n0["child::leaf \\"quoted\\""]',
				'  n1["count"]',
				'  n2["doubled"]',
				"  n1 --> n2",
			].join("\n"),
		);
	});

	it("renders D2 with deterministic ids and direction mapping", () => {
		const snap: DescribeSnapshot = {
			nodes: [
				{ id: "b", factory: "derived", status: "sentinel", deps: ["a"] },
				{ id: "a", factory: "state", status: "settled", deps: [], value: 1 },
			],
			edges: [{ from: "a", to: "b" }],
		};

		expect(describeToD2(snap, { direction: "RL" })).toBe(
			["direction: left", 'n0: "a"', 'n1: "b"', "n0 -> n1"].join("\n"),
		);
	});

	it("renders pretty text with SENTINEL absence", () => {
		const snap: DescribeSnapshot = {
			name: "pretty",
			nodes: [
				{ id: "source", factory: "state", status: "settled", deps: [], value: { ok: true } },
				{ id: "quiet", factory: "filter", status: "sentinel", deps: ["source"] },
			],
			edges: [{ from: "source", to: "quiet" }],
		};

		const text = describeToPretty(snap);

		expect(text).toBe(
			[
				"Graph pretty",
				"Nodes:",
				"- quiet (filter/sentinel): <SENTINEL>",
				'- source (state/settled): {"ok":true}',
				"Edges:",
				"- source -> quiet",
			].join("\n"),
		);
	});

	it("renders compact ASCII adjacency with optional values", () => {
		const snap: DescribeSnapshot = {
			name: "ascii",
			nodes: [
				{ id: "b", factory: "derived", status: "sentinel", deps: ["a"] },
				{ id: "a", factory: "state", status: "settled", deps: [], value: 1 },
				{ id: "c", factory: "effect", status: "sentinel", deps: [] },
			],
			edges: [{ from: "a", to: "b" }],
		};

		expect(describeToAscii(snap, { includeValues: true })).toBe(
			[
				"Graph ascii",
				"a [state/settled 1] -> b",
				"b [derived/sentinel <SENTINEL>] -> -",
				"c [effect/sentinel <SENTINEL>] -> -",
			].join("\n"),
		);
	});

	it("renders deterministic JSON and can omit edges", () => {
		const snap: DescribeSnapshot = {
			nodes: [
				{
					id: "z",
					factory: "node",
					status: "settled",
					deps: [],
					meta: { b: 2, a: 1 },
					value: { y: 2, x: 1 },
				},
			],
			edges: [{ from: "a", to: "z" }],
		};

		expect(describeToJson(snap, { includeEdges: false, indent: 0 })).toBe(
			'{"edges":[],"nodes":[{"deps":[],"factory":"node","id":"z","meta":{"a":1,"b":2},"status":"settled","value":{"x":1,"y":2}}]}',
		);
	});

	it("sorts labels deterministically without locale collation", () => {
		const snap: DescribeSnapshot = {
			nodes: [
				{ id: "a", factory: "state", status: "sentinel", deps: [] },
				{ id: "A", factory: "state", status: "sentinel", deps: [] },
				{ id: "á", factory: "state", status: "sentinel", deps: [] },
			],
			edges: [],
		};

		expect(describeToAscii(snap)).toBe(
			[
				"Graph (anonymous)",
				"A [state/sentinel] -> -",
				"a [state/sentinel] -> -",
				"á [state/sentinel] -> -",
			].join("\n"),
		);
	});

	it("escapes diagram labels without introducing physical control-character lines", () => {
		const snap: DescribeSnapshot = {
			nodes: [{ id: 'line\nbreak "quoted"', factory: "state", status: "sentinel", deps: [] }],
			edges: [],
		};

		expect(describeToMermaid(snap)).toBe('flowchart LR\n  n0["line\\nbreak \\"quoted\\""]');
		expect(describeToD2(snap)).toBe('direction: right\nn0: "line\\nbreak \\"quoted\\""');
	});

	it("renders cyclic and bigint values in deterministic JSON", () => {
		const circular: Record<string, unknown> = { z: 1 };
		circular.self = circular;
		const snap: DescribeSnapshot = {
			nodes: [
				{
					id: "cyclic",
					factory: "state",
					status: "settled",
					deps: [],
					value: { circular, id: 1n },
				},
			],
			edges: [],
		};

		expect(describeToJson(snap, { indent: 0 })).toBe(
			'{"edges":[],"nodes":[{"deps":[],"factory":"state","id":"cyclic","status":"settled","value":{"circular":{"self":"[Circular]","z":1},"id":"1"}}]}',
		);
	});

	it("rejects invalid diagram directions", () => {
		const snap: DescribeSnapshot = { nodes: [], edges: [] };
		expect(() => describeToMermaid(snap, { direction: "SIDEWAYS" as never })).toThrow(
			/invalid diagram direction/,
		);
	});

	it("encodes Mermaid source and describe snapshots as mermaid.live URLs", () => {
		expect(mermaidLiveUrl("flowchart LR", { theme: "dark", autoSync: false })).toBe(
			"https://mermaid.live/edit#base64:eyJjb2RlIjoiZmxvd2NoYXJ0IExSIiwibWVybWFpZCI6eyJ0aGVtZSI6ImRhcmsifSwiYXV0b1N5bmMiOmZhbHNlfQ",
		);

		const snap: DescribeSnapshot = {
			nodes: [{ id: "你好", factory: "state", status: "settled", deps: [], value: 1 }],
			edges: [],
		};
		const url = describeToMermaidUrl(snap, { direction: "TD", theme: "forest" });
		expect(url).toMatch(/^https:\/\/mermaid\.live\/edit#base64:/);
		expect(url).not.toContain("=");
	});
});
