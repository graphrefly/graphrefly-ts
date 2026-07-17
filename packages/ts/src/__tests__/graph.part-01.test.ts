import { describe, expect, expectTypeOf, it } from "vitest";
import { depLatest } from "../ctx/types.js";
import type {
	GraphBlueprintJson,
	GraphCheckpointJson,
	GraphTopologySnapshot,
	Message,
	StrictJsonValue,
} from "../index.js";
import {
	canonicalTopologyBytes,
	canonicalTopologyJson,
	GRAPH_BLUEPRINT_VERSION,
	graph,
	graphBlueprintDiagnostics,
	type Node,
	normalizeTopology,
	strictCanonicalJsonBytes,
	withBlueprintHash,
	withBlueprintProvenance,
} from "../index.js";

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	n.subscribe((m) => msgs.push(m));
	return msgs;
}
function _demand(snapshot: Node<unknown>, pullId: symbol): void {
	snapshot.up([["PULL", { pullId }]]);
}
const types = (msgs: Message[]) => msgs.map((m) => m[0]);
const TEST_JSON_DECODER = new TextDecoder();
const decodeTestJsonBytes = (bytes: Uint8Array) => TEST_JSON_DECODER.decode(bytes);
const testHash = (bytes: Uint8Array) => `h:${decodeTestJsonBytes(bytes)}`;

describe("Graph — 8-verb sugar (CSP-2)", () => {
	it("state + derived: value-level fn computes from dep values (D27)", () => {
		const g = graph();
		const count = g.state(0);
		const doubled = g.derived([count], (n) => n * 2);
		collect(doubled);
		expect(doubled.cache).toBe(0);
		count.set(5);
		expect(doubled.cache).toBe(10);
	});

	it("derived over multiple deps receives typed values in order", () => {
		const g = graph();
		const a = g.state(2);
		const b = g.state(3);
		const sum = g.derived([a, b], (x, y) => x + y);
		collect(sum);
		expect(sum.cache).toBe(5);
		b.set(10);
		expect(sum.cache).toBe(12);
	});

	it("effect runs on dep settle and registers a deactivation cleanup", () => {
		const g = graph();
		const s = g.state(1);
		const seen: number[] = [];
		let cleaned = 0;
		const e = g.effect([s], (n) => {
			seen.push(n);
			return () => {
				cleaned++;
			};
		});
		const unsub = e.subscribe(() => {});
		expect(seen).toEqual([1]);
		s.set(2);
		expect(seen).toEqual([1, 2]);
		unsub(); // last subscriber → deactivate → cleanup
		expect(cleaned).toBe(1);
	});

	it("D30: a value-level fn that throws emits ERROR downstream (not a crash)", () => {
		const g = graph();
		const s = g.state(1);
		const bad = g.derived([s], (n) => {
			if (n > 0) throw new Error("boom");
			return n;
		});
		const msgs = collect(bad);
		expect(types(msgs)).toContain("ERROR");
		expect(bad.status).toBe("errored");
	});

	it("R-reentrancy via graph (D37): a synchronous feedback cycle yields ERROR, not a hang", () => {
		const g = graph();
		const s = g.state(0);
		const d = g.derived([s], (n) => n + 1);
		const seen: Message[] = [];
		// effect feeds back into s → S→D→E→S cycle. The substrate rejects the re-entry
		// (throw); the graph layer's value-level boundary catches it → ERROR. No hang.
		const e = g.effect([d], (n) => {
			s.set(n as number);
		});
		expect(() => e.subscribe((m) => seen.push(m))).not.toThrow(); // caught, not escaped
		// R-reentrancy: the ERROR lands on a node ON the cycle — the value-level catch nearest
		// the throw on the synchronous unwind (impl-determined, d or e), NOT necessarily the
		// re-entered node. Assert SOME cycle node errored, not which (per the amended spec).
		expect([d.status, e.status]).toContain("errored");
	});
});

describe("Graph.describe — snapshot shape (R-describe / D39)", () => {
	it("emits a flat snapshot with ids, factory names, status, value, deps, edges", () => {
		const g = graph({ name: "demo" });
		const count = g.state(0, { name: "count" });
		const doubled = g.derived([count], (n) => n * 2, { name: "doubled" });
		collect(doubled);
		count.set(5);

		const snap = g.describe();
		expect(snap.name).toBe("demo");
		const byId = Object.fromEntries(snap.nodes.map((n) => [n.id, n]));
		expect(byId.count.factory).toBe("state");
		expect(byId.count.value).toBe(5);
		expect(byId.count.status).toBe("settled");
		expect(byId.doubled.factory).toBe("derived");
		expect(byId.doubled.value).toBe(10);
		expect(byId.doubled.deps).toEqual(["count"]);
		expect(snap.edges).toContainEqual({ from: "count", to: "doubled" });
	});

	it("absent value field = SENTINEL (never-emitted)", () => {
		const g = graph();
		const s = g.state(0, { name: "s" });
		g.derived([s], (n) => n, { name: "d" }); // not subscribed → never runs
		const snap = g.describe();
		const dNode = snap.nodes.find((n) => n.id === "d");
		expect(dNode && "value" in dNode).toBe(false); // SENTINEL → field absent
	});

	it("explain mode filters to the causal chain from→to", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.derived([a], (x) => x + 1, { name: "b" });
		const c = g.derived([b], (x) => x + 1, { name: "c" });
		const side = g.state(9, { name: "side" }); // off the a→c chain
		collect(c);
		collect(g.derived([side], (x) => x, { name: "sideD" }));

		const snap = g.describe({ explain: { from: "a", to: "c" } });
		const ids = snap.nodes.map((n) => n.id).sort();
		expect(ids).toEqual(["a", "b", "c"]);
	});

	it("mount nests a subgraph under a :: prefixed path", () => {
		const parent = graph({ name: "p" });
		parent.state(0, { name: "root" });
		const child = graph({ name: "c" });
		child.state(1, { name: "leaf" });
		parent.mount(child, { at: "sub" });

		const snap = parent.describe();
		expect(snap.subgraphs?.[0].mountId).toBe("sub");
		expect(snap.subgraphs?.[0].nodes.some((n) => n.id === "sub::leaf")).toBe(true);
	});

	it("rejects empty and duplicate sibling mount identities (D630)", () => {
		const parent = graph();
		expect(() => parent.mount(graph(), { at: "" })).toThrow(/non-empty string/);
		parent.mount(graph(), { at: "child" });
		expect(() => parent.mount(graph(), { at: "child" })).toThrow(/duplicate sibling mount id/);
	});
});

describe("Graph.topology — pure structure snapshot (D173)", () => {
	it("projects describe's live truth source without runtime status/value/version", () => {
		const g = graph({ name: "demo" });
		const count = g.state(0, { name: "count", meta: { role: { kind: "input" } } });
		const doubled = g.derived([count], (n) => n * 2, { name: "doubled" });
		collect(doubled);
		count.set(5);

		const topology: GraphTopologySnapshot = g.topology();
		expect(topology.name).toBe("demo");
		const byId = Object.fromEntries(topology.nodes.map((n) => [n.id, n]));
		expect(byId.count).toEqual({
			id: "count",
			name: "count",
			factory: "state",
			deps: [],
			meta: { role: { kind: "input" } },
		});
		((byId.count.meta as Record<string, unknown>).role as { kind: string }).kind = "changed";
		expect(g.topology().nodes.find((node) => node.id === "count")?.meta).toEqual({
			role: { kind: "input" },
		});
		expect(byId.doubled).toEqual({
			id: "doubled",
			name: "doubled",
			factory: "derived",
			deps: ["count"],
		});
		expect("status" in byId.count).toBe(false);
		expect("value" in byId.count).toBe(false);
		expect("version" in byId.count).toBe(false);
		expect(topology.edges).toContainEqual({ from: "count", to: "doubled" });
	});

	it("reflects current live deps after rewire, matching D51 describe truthfulness", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(2, { name: "b" });
		const d = g.node([a], (ctx) => ctx.down([["DATA", depLatest(ctx, 0)]]), { name: "d" });

		d.replaceDeps([b], (ctx) => ctx.down([["DATA", depLatest(ctx, 0)]]));

		const topology = g.topology();
		expect(topology.nodes.find((node) => node.id === "d")?.deps).toEqual(["b"]);
		expect(topology.edges).toContainEqual({ from: "b", to: "d" });
		expect(topology.edges).not.toContainEqual({ from: "a", to: "d" });
	});

	it("recursively projects mounted subgraphs without describe-only runtime fields", () => {
		const parent = graph({ name: "parent" });
		const child = graph({ name: "child" });
		child.state(1, { name: "leaf" });
		parent.mount(child, { at: "sub" });

		const topology = parent.topology();
		expect(topology.subgraphs?.[0]?.mountId).toBe("sub");
		const leaf = topology.subgraphs?.[0]?.nodes.find((node) => node.id === "sub::leaf");
		expect(leaf).toEqual({
			id: "sub::leaf",
			name: "leaf",
			factory: "state",
			deps: [],
		});
		expect(leaf && "status" in leaf).toBe(false);
	});

	it("rejects non-JSON-compatible metadata instead of aliasing host objects", () => {
		const g = graph();

		expect(() => g.state(0, { name: "bad", meta: { tags: new Set(["a"]) } })).toThrow(
			/graph node 'bad' meta: graph meta must be strict JSON-compatible data/,
		);
	});

	it("rejects sparse metadata arrays instead of normalizing holes", () => {
		const g = graph();
		const xs = new Array<string>(2);
		xs[1] = "x";

		expect(() => g.state(0, { name: "bad", meta: { xs } })).toThrow(/sparse array hole/);
		expect(() =>
			g.node([], () => undefined, { name: "badFn", meta: { f: () => undefined } }),
		).toThrow(/graph node 'badFn' meta: graph meta must be strict JSON-compatible data/);
	});
});

describe("Graph.blueprint — sync audit envelope (D173/D177)", () => {
	it("returns a versioned normalized topology envelope without describe runtime fields", () => {
		const parent = graph({ name: "parent" });
		const count = parent.state(0, { name: "count", meta: { role: "input" } });
		const doubled = parent.derived([count], (n) => n * 2, { name: "doubled" });
		const child = graph({ name: "child" });
		child.state(1, { name: "leaf" });
		parent.mount(child, { at: "sub" });
		collect(doubled);
		count.set(5);

		const blueprint = parent.blueprint();
		expect(blueprint.version).toBe(GRAPH_BLUEPRINT_VERSION);
		expect(blueprint.diagnostics).toBeUndefined();
		expect(blueprint.topology.nodes.map((node) => node.id)).toEqual(["count", "doubled"]);
		const countNode = blueprint.topology.nodes.find((node) => node.id === "count");
		expect(countNode).toEqual({
			id: "count",
			name: "count",
			factory: "state",
			deps: [],
			meta: { role: "input" },
		});
		expect(countNode && "status" in countNode).toBe(false);
		expect(countNode && "value" in countNode).toBe(false);
		expect(countNode && "version" in countNode).toBe(false);
		const leaf = blueprint.topology.subgraphs?.[0]?.nodes.find((node) => node.id === "sub::leaf");
		expect(blueprint.topology.subgraphs?.[0]?.mountId).toBe("sub");
		expect(leaf).toEqual({
			id: "sub::leaf",
			name: "leaf",
			factory: "state",
			deps: [],
		});
		expect(leaf && "status" in leaf).toBe(false);
		expect(leaf && "value" in leaf).toBe(false);
	});

	it("canonicalizes topology ordering independently of registration order", () => {
		const left = graph();
		const leftB = left.state(2, { name: "b" });
		const leftA = left.state(1, { name: "a" });
		left.derived([leftB, leftA], (b, a) => a + b, { name: "sum" });

		const right = graph();
		const rightA = right.state(1, { name: "a" });
		const rightB = right.state(2, { name: "b" });
		right.derived([rightB, rightA], (b, a) => a + b, { name: "sum" });

		expect(left.blueprint().topology.nodes.map((node) => node.id)).toEqual(["a", "b", "sum"]);
		expect(left.blueprint().topology.edges).toEqual([
			{ from: "a", to: "sum" },
			{ from: "b", to: "sum" },
		]);
		expect(canonicalTopologyJson(left.topology())).toBe(canonicalTopologyJson(right.topology()));
		expect(canonicalTopologyJson(left.blueprint().topology)).toBe(
			canonicalTopologyJson(right.blueprint().topology),
		);
	});

	it("exposes canonical topology bytes for cross-language hash input", () => {
		const g = graph();
		const b = g.state(2, { name: "b" });
		const a = g.state(1, { name: "a" });
		g.derived([b, a], (right, left) => left + right, { name: "sum" });

		const bytes = canonicalTopologyBytes(g.topology());

		expect(bytes).toEqual(strictCanonicalJsonBytes(g.blueprint().topology));
		expect(decodeTestJsonBytes(bytes)).toBe(canonicalTopologyJson(g.topology()));
	});

	it("adds helper-only topology hash metadata without hashing provenance", async () => {
		const g = graph();
		const count = g.state(1, { name: "count" });
		g.derived([count], (n) => n + 1, { name: "next" });

		const base = g.blueprint();
		const withFirstProvenance = withBlueprintProvenance(base, {
			source: "unit-test",
			env: { b: 2, a: 1 },
		});
		const withSecondProvenance = withBlueprintProvenance(base, { source: "other" });
		const first = await withBlueprintHash(withFirstProvenance, {
			algorithm: "test-hash",
			hash: testHash,
		});
		const second = await withBlueprintHash(withSecondProvenance, {
			algorithm: "test-hash",
			hash: testHash,
		});

		expect(withFirstProvenance.provenance).toEqual({
			env: { a: 1, b: 2 },
			source: "unit-test",
		});
		expect(first.hash).toEqual({
			kind: "topology",
			algorithm: "test-hash",
			input: "strictCanonicalTopologyBytes",
			value: `h:${canonicalTopologyJson(base.topology)}`,
		});
		expect(second.hash?.value).toBe(first.hash?.value);
		expect(Reflect.get(base, "hash")).toBeUndefined();
	});

	it("rejects malformed helper hash metadata", () => {
		const g = graph();
		g.state(1, { name: "count" });
		const base = g.blueprint();

		expect(() => withBlueprintHash(base, { algorithm: "", hash: testHash })).toThrow(
			/algorithm must be a non-empty string/,
		);
		expect(() =>
			withBlueprintHash(base, {
				algorithm: "bad",
				hash: () => null as unknown as string,
			}),
		).toThrow(/hash value must be a non-empty string/);
		expect(() =>
			withBlueprintHash(base, {
				algorithm: "bad",
				hash: () => "",
			}),
		).toThrow(/hash value must be a non-empty string/);
	});

	it("keeps graph blueprint JSON aliases on the shared strict JSON vocabulary", () => {
		expectTypeOf<GraphBlueprintJson>().toEqualTypeOf<StrictJsonValue>();
		expectTypeOf<GraphCheckpointJson>().toEqualTypeOf<StrictJsonValue>();
	});

	it("adds only caller-supplied provenance and optional graph-local diagnostics", () => {
		const g = graph();
		g.state(0, { name: "island" });

		const blueprint = g.blueprint({
			diagnostics: true,
			provenance: { source: "unit-test", nested: { b: 2, a: 1 } },
		});

		expect(blueprint.provenance).toEqual({ nested: { a: 1, b: 2 }, source: "unit-test" });
		expect(blueprint.diagnostics).toEqual({
			ok: true,
			issues: [
				{
					severity: "warning",
					code: "island-node",
					nodeId: "island",
					message: "node 'island' has no deps and no dependents",
				},
			],
		});
		expect(Reflect.get(blueprint, "hash")).toBeUndefined();
	});

	it("reports dangling deps and duplicate ids for topology helper callers", () => {
		const diagnostics = graphBlueprintDiagnostics(
			normalizeTopology({
				nodes: [
					{ id: "a", factory: "state", deps: [] },
					{ id: "a", factory: "state", deps: [] },
					{ id: "b", factory: "derived", deps: ["missing"] },
				],
				edges: [],
			}),
		);

		expect(diagnostics.ok).toBe(false);
		expect(diagnostics.issues.map((issue) => issue.code)).toEqual([
			"dangling-dep",
			"duplicate-node-id",
			"island-node",
			"island-node",
		]);
	});

	it("rejects malformed topology helper input before canonicalization", () => {
		const sparseNodes = new Array<{ id: string; factory: string; deps: string[] }>(1);
		expect(() => normalizeTopology({ nodes: sparseNodes, edges: [] })).toThrow(/sparse array hole/);

		const sparseDeps = new Array<string>(1);
		expect(() =>
			normalizeTopology({ nodes: [{ id: "bad", factory: "node", deps: sparseDeps }], edges: [] }),
		).toThrow(/sparse array hole/);
		expect(() =>
			normalizeTopology({
				nodes: [
					{ id: 1, factory: "node", deps: [] } as unknown as GraphTopologySnapshot["nodes"][0],
				],
				edges: [],
			}),
		).toThrow(/nodes\[0\]\.id must be a string/);
		expect(() =>
			normalizeTopology({
				nodes: [{ id: "bad", factory: "node", deps: [1] as unknown as string[] }],
				edges: [],
			}),
		).toThrow(/deps\[0\] must be a string/);
		expect(() =>
			normalizeTopology({
				name: 1 as unknown as string,
				nodes: [],
				edges: [],
			}),
		).toThrow(/name must be a string/);

		const cyclic: GraphTopologySnapshot = { nodes: [], edges: [] };
		cyclic.subgraphs = [cyclic];
		expect(() => normalizeTopology(cyclic)).toThrow(/circular subgraph reference/);
	});
});
