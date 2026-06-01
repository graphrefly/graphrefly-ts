/**
 * CSP-2.8 composition helpers (D56): topologyDiff + static stratify/stratifyBranch.
 *
 * D56 authority: composition is per-language graph-layer sugar; topology only through declared deps
 * (no internal subscribe island), and dynamic branch add/remove is deferred.
 */

import { describe, expect, it } from "vitest";
import type { Message, Node } from "../index.js";
import { type DescribeSnapshot, graph, stratify, stratifyBranch, topologyDiff } from "../index.js";

const data = <T>(msgs: Message[]): T[] =>
	msgs.filter((x) => x[0] === "DATA").map((x) => (x as readonly ["DATA", T])[1]);

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((m) => msgs.push(m));
	return { msgs, unsub };
}

describe("topologyDiff (D56)", () => {
	it("diffs D39 describe snapshots without old-core deps", () => {
		const prev: DescribeSnapshot = {
			nodes: [
				{ id: "a", factory: "state", status: "settled", deps: [], meta: { role: "old" } },
				{ id: "b", factory: "map", status: "sentinel", deps: ["a"] },
			],
			edges: [{ from: "a", to: "b" }],
		};
		const next: DescribeSnapshot = {
			nodes: [
				{ id: "a", factory: "state", status: "settled", deps: [], meta: { role: "new" } },
				{ id: "c", factory: "filter", status: "sentinel", deps: ["a"] },
			],
			edges: [{ from: "a", to: "c" }],
		};

		expect(topologyDiff(prev, next).events).toEqual([
			{ type: "node-added", id: "c", node: next.nodes[1] },
			{ type: "node-meta-changed", id: "a", prevMeta: { role: "old" }, nextMeta: { role: "new" } },
			{ type: "edge-added", from: "a", to: "c" },
			{ type: "edge-removed", from: "a", to: "b" },
			{ type: "node-removed", id: "b" },
		]);
	});

	it("detects mounted subgraph paths from prefixed child node ids", () => {
		const prev: DescribeSnapshot = { nodes: [], edges: [] };
		const next: DescribeSnapshot = {
			nodes: [],
			edges: [],
			subgraphs: [
				{ nodes: [{ id: "child::x", factory: "state", status: "settled", deps: [] }], edges: [] },
			],
		};
		expect(topologyDiff(prev, next).events[0]).toEqual({
			type: "subgraph-mounted",
			path: "child",
		});
	});

	it("detects nested mounted subgraph paths without collapsing to the parent", () => {
		const prev: DescribeSnapshot = { nodes: [], edges: [] };
		const next: DescribeSnapshot = {
			nodes: [],
			edges: [],
			subgraphs: [
				{
					nodes: [{ id: "parent::child::x", factory: "state", status: "settled", deps: [] }],
					edges: [],
				},
			],
		};
		expect(topologyDiff(prev, next).events[0]).toEqual({
			type: "subgraph-mounted",
			path: "parent::child",
		});
	});
});

describe("stratifyBranch (D56)", () => {
	it("routes source values through declared deps [source, rules]", () => {
		const g = graph();
		const source = g.state(0, { name: "source" });
		const rules = g.state({ mod: 0 }, { name: "rules" });
		const branch = stratifyBranch(
			source as Node<number>,
			rules,
			(rule: { mod: number }, value: number) => value % 2 === rule.mod,
		);
		const { msgs } = collect(branch);

		source.set(1);
		source.set(2);
		rules.set({ mod: 1 });
		source.set(3);

		expect(data(msgs)).toEqual([0, 2, 3]);
		expect(branch.deps).toEqual([source, rules]);
	});

	it("forwards same-wave DATA before source terminal", () => {
		const g = graph();
		const source = g.node<number>([], null, { name: "source" });
		const rules = g.state({ pass: true }, { name: "rules" });
		const branch = stratifyBranch(
			source as Node<number>,
			rules,
			(rule: { pass: boolean }, _value: number) => rule.pass,
		);
		const { msgs } = collect(branch);

		source.down([["DATA", 7], ["COMPLETE"]]);

		expect(data(msgs)).toEqual([7]);
		expect(msgs.at(-1)?.[0]).toBe("COMPLETE");
	});
});

describe("stratify (D56)", () => {
	it("builds static branch nodes registered in describe with real factory names", () => {
		const g = graph();
		const source = g.state(1, { name: "source" });
		const routed = stratify(
			g,
			source,
			[
				{ name: "even", rule: { mod: 0 } },
				{ name: "odd", rule: { mod: 1 } },
			],
			(rule, value: number) => value % 2 === rule.mod,
		);
		const even = collect(routed.branches.even as Node<number>);
		const odd = collect(routed.branches.odd as Node<number>);

		source.set(2);
		source.set(3);
		routed.rules.set([
			{ name: "even", rule: { mod: 1 } },
			{ name: "odd", rule: { mod: 0 } },
		]);
		source.set(5);

		expect(data(even.msgs)).toEqual([2, 5]);
		expect(data(odd.msgs)).toEqual([1, 3]);

		const snap = g.describe();
		const evenNode = snap.nodes.find((n) => n.id === "branch/even");
		expect(evenNode?.factory).toBe("stratifyBranch");
		expect(evenNode?.deps).toEqual(["source", "branch/rules"]);
		expect(snap.edges).toContainEqual({ from: "source", to: "branch/even" });
		expect(snap.edges).toContainEqual({ from: "branch/rules", to: "branch/even" });
	});

	it("rejects duplicate rule names before registering colliding branch ids", () => {
		const g = graph();
		const source = g.state(1, { name: "source" });
		expect(() =>
			stratify(
				g,
				source,
				[
					{ name: "same", rule: { mod: 0 } },
					{ name: "same", rule: { mod: 1 } },
				],
				(rule, value: number) => value % 2 === rule.mod,
			),
		).toThrow(/duplicate rule name/);
	});

	it("preserves reserved stratify metadata while merging caller meta", () => {
		const g = graph();
		const source = g.state(1, { name: "source" });
		stratify(
			g,
			source,
			[{ name: "even", rule: { mod: 0 }, meta: { ruleMeta: true } }],
			(rule, value: number) => value % 2 === rule.mod,
			{
				rules: { meta: { owner: "qa" } },
				branches: { even: { meta: { owner: "branch" } } },
			},
		);

		const snap = g.describe();
		expect(snap.nodes.find((n) => n.id === "branch/rules")?.meta).toEqual({
			kind: "stratify_rules",
			owner: "qa",
		});
		expect(snap.nodes.find((n) => n.id === "branch/even")?.meta).toEqual({
			branch: "even",
			ruleMeta: true,
			owner: "branch",
		});
	});
});
