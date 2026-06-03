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
	const renderSmokeOutputs = (snap: DescribeSnapshot) => ({
		mermaid: describeToMermaid(snap),
		d2: describeToD2(snap),
		pretty: describeToPretty(snap),
		ascii: describeToAscii(snap),
		json: describeToJson(snap, { indent: 0 }),
	});

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

	it("smoke-renders duplicate edges without crashing and dedupes deterministically", () => {
		const snap: DescribeSnapshot = {
			name: "duplicate edges",
			nodes: [
				{ id: "sink", factory: "derived", status: "sentinel", deps: ["source"] },
				{ id: "source", factory: "state", status: "settled", deps: [], value: 1 },
			],
			edges: [
				{ from: "source", to: "sink" },
				{ from: "source", to: "sink" },
				{ from: "source", to: "sink" },
			],
		};

		const outputs = renderSmokeOutputs(snap);

		expect(outputs).toEqual({
			mermaid: ["flowchart LR", '  n0["sink"]', '  n1["source"]', "  n1 --> n0"].join("\n"),
			d2: ["direction: right", 'n0: "sink"', 'n1: "source"', "n1 -> n0"].join("\n"),
			pretty: [
				"Graph duplicate edges",
				"Nodes:",
				"- sink (derived/sentinel): <SENTINEL>",
				"- source (state/settled): 1",
				"Edges:",
				"- source -> sink",
			].join("\n"),
			ascii: [
				"Graph duplicate edges",
				"sink [derived/sentinel] -> -",
				"source [state/settled] -> sink",
			].join("\n"),
			json: '{"edges":[{"from":"source","to":"sink"}],"name":"duplicate edges","nodes":[{"deps":["source"],"factory":"derived","id":"sink","status":"sentinel"},{"deps":[],"factory":"state","id":"source","status":"settled","value":1}]}',
		});
	});

	it("smoke-renders edges with missing endpoints without crashing", () => {
		const snap: DescribeSnapshot = {
			name: "missing endpoints",
			nodes: [
				{ id: "a", factory: "state", status: "settled", deps: [], value: "ready" },
				{ id: "b", factory: "effect", status: "sentinel", deps: ["ghost"] },
			],
			edges: [
				{ from: "ghost", to: "b" },
				{ from: "a", to: "missing" },
			],
		};

		const outputs = renderSmokeOutputs(snap);

		expect(outputs).toEqual({
			mermaid: ["flowchart LR", '  n0["a"]', '  n1["b"]'].join("\n"),
			d2: ["direction: right", 'n0: "a"', 'n1: "b"'].join("\n"),
			pretty: [
				"Graph missing endpoints",
				"Nodes:",
				'- a (state/settled): "ready"',
				"- b (effect/sentinel): <SENTINEL>",
				"Edges:",
				"- a -> missing",
				"- ghost -> b",
			].join("\n"),
			ascii: [
				"Graph missing endpoints",
				"a [state/settled] -> missing",
				"b [effect/sentinel] -> -",
			].join("\n"),
			json: '{"edges":[{"from":"a","to":"missing"},{"from":"ghost","to":"b"}],"name":"missing endpoints","nodes":[{"deps":[],"factory":"state","id":"a","status":"settled","value":"ready"},{"deps":["ghost"],"factory":"effect","id":"b","status":"sentinel"}]}',
		});
	});

	it("smoke-renders cyclic-looking back-edge snapshots without recursive traversal", () => {
		const snap: DescribeSnapshot = {
			name: "back edge",
			nodes: [
				{ id: "tail", factory: "node", status: "settled", deps: ["head"], value: 2 },
				{ id: "head", factory: "node", status: "settled", deps: ["tail"], value: 1 },
			],
			edges: [
				{ from: "tail", to: "head" },
				{ from: "head", to: "tail" },
			],
		};

		const outputs = renderSmokeOutputs(snap);

		expect(outputs).toEqual({
			mermaid: ["flowchart LR", '  n0["head"]', '  n1["tail"]', "  n0 --> n1", "  n1 --> n0"].join(
				"\n",
			),
			d2: ["direction: right", 'n0: "head"', 'n1: "tail"', "n0 -> n1", "n1 -> n0"].join("\n"),
			pretty: [
				"Graph back edge",
				"Nodes:",
				"- head (node/settled): 1",
				"- tail (node/settled): 2",
				"Edges:",
				"- head -> tail",
				"- tail -> head",
			].join("\n"),
			ascii: ["Graph back edge", "head [node/settled] -> tail", "tail [node/settled] -> head"].join(
				"\n",
			),
			json: '{"edges":[{"from":"head","to":"tail"},{"from":"tail","to":"head"}],"name":"back edge","nodes":[{"deps":["tail"],"factory":"node","id":"head","status":"settled","value":1},{"deps":["head"],"factory":"node","id":"tail","status":"settled","value":2}]}',
		});
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
