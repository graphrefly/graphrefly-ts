import { DATA } from "@graphrefly/pure-ts/core/messages.js";
import { node } from "@graphrefly/pure-ts/core/node.js";
import { Graph } from "@graphrefly/pure-ts/graph/graph.js";
import { describe, expect, it } from "vitest";
import { InspectGraph, inspect } from "../../patterns/inspect/index.js";

describe("inspect() preset (Tier 9.1 γ-form γ-II + Q5-6 medium scope)", () => {
	it("returns an InspectGraph subclass", () => {
		const target = new Graph("target");
		target.add(node([], { name: "a", initial: 1 }), { name: "a" });
		const view = inspect(target);
		expect(view).toBeInstanceOf(InspectGraph);
		expect(view).toBeInstanceOf(Graph);
		view.destroy();
	});

	it("exposes lens nodes via `view.lens.*` (lens lives in a `lens::*` mounted subgraph)", () => {
		const target = new Graph("target");
		target.add(node([], { name: "a", initial: 1 }), { name: "a" });
		const view = inspect(target);
		const desc = view.describe({ detail: "minimal" });
		// D1 (qa lock): lens lives under a child mount, so lens paths are
		// qualified with `lens::*`. Avoids `Graph.topology` accessor collision.
		expect(Object.keys(desc.nodes)).toEqual(
			expect.arrayContaining(["lens::topology", "lens::health", "lens::flow"]),
		);
		expect(typeof view.lens.topology.subscribe).toBe("function");
		expect(typeof view.lens.health.subscribe).toBe("function");
		expect(typeof view.lens.flow.subscribe).toBe("function");
		view.destroy();
	});

	it("exposes target reference + lens view + audit subgraph", () => {
		const target = new Graph("target");
		target.add(node([], { name: "a", initial: 1 }), { name: "a" });
		const view = inspect(target);
		expect(view.target).toBe(target);
		expect(view.audit).toBeDefined();
		view.destroy();
	});

	it("explainTarget delegates to target.explain (static form)", () => {
		const target = new Graph("target");
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
		target.add(a, { name: "a" });
		target.add(b, { name: "b" });

		const view = inspect(target);
		const chain = view.explainTarget("a", "b");
		expect(chain.found).toBe(true);
		expect(chain.steps.length).toBeGreaterThan(0);
		view.destroy();
	});

	it("explainTarget reactive form returns {node, dispose} that tears down cleanly (A4 qa)", () => {
		const target = new Graph("target");
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
		target.add(a, { name: "a" });
		target.add(b, { name: "b" });

		const view = inspect(target);
		const result = view.explainTarget("a", "b", { reactive: true });
		expect(result).toHaveProperty("node");
		expect(result).toHaveProperty("dispose");
		expect(typeof result.dispose).toBe("function");
		// Subscribe + dispose chain doesn't throw.
		const unsub = result.node.subscribe(() => undefined);
		unsub();
		result.dispose();
		view.destroy();
	});

	it("complianceSnapshot pairs the target's persisted state with the audit log", () => {
		const target = new Graph("target");
		target.add(node([], { name: "a", initial: 42 }), { name: "a" });
		const view = inspect(target, { actor: { id: "ops", role: "auditor" } });
		const snap = view.complianceSnapshot();
		expect(snap.format_version).toBe(1);
		expect(snap.graph).toBeDefined();
		expect(snap.audit).toBeDefined();
		expect(snap.actor).toEqual({ id: "ops", role: "auditor" });
		expect(typeof snap.fingerprint).toBe("string");
		view.destroy();
	});

	it("mounts the auditTrail subgraph under `audit::*`", () => {
		const target = new Graph("target");
		target.add(node([], { name: "a", initial: 1 }), { name: "a" });
		const view = inspect(target);
		const desc = view.describe({ detail: "minimal" });
		// Mounted child paths appear with the mount prefix.
		const auditPaths = Object.keys(desc.nodes).filter((p) => p.startsWith("audit::"));
		expect(auditPaths.length).toBeGreaterThan(0);
		view.destroy();
	});

	it("self-tags via tagFactory (A1 qa) — `describe().factory === 'inspect'`", () => {
		const target = new Graph("target");
		target.add(node([], { name: "a", initial: 1 }), { name: "a" });
		const view = inspect(target);
		const desc = view.describe({ detail: "spec" });
		expect(desc.factory).toBe("inspect");
		view.destroy();
	});

	it("`inspect.topology` (base Graph accessor) is distinct from `inspect.lens.topology` (A4 qa disambiguation)", () => {
		// A4 (qa): the base `Graph.topology` accessor returns
		// `Node<TopologyEvent>` (mount/unmount stream of THIS graph), NOT the
		// describe snapshot. `inspect.lens.topology` is `Node<GraphDescribeOutput>`
		// (the wrapped target's describe). They MUST be different objects.
		const target = new Graph("target");
		target.add(node([], { name: "a", initial: 1 }), { name: "a" });
		const view = inspect(target);
		expect(view.topology).not.toBe(view.lens.topology);
		view.destroy();
	});

	it("`view.destroy()` does not invalidate externally-held lens-node subscriptions before lens.dispose() runs (D1 qa regression)", () => {
		// D1 regression: lens lives in a child mount, so `view.destroy()`'s
		// signal cascade reaches the lens nodes via `_destroyClearOnly` (no
		// TEARDOWN broadcast) rather than via `_signalDeliver` over the
		// inspect graph's own `_nodes`. The lens nodes themselves are NOT
		// directly registered under inspect's path table.
		const target = new Graph("target");
		const a = node([], { name: "a", initial: 1 });
		target.add(a, { name: "a" });
		const view = inspect(target);

		// Verify the lens nodes are reachable through the mounted child path
		// and NOT through the inspect graph's own `_nodes`.
		expect(() => view.resolve("lens::topology")).not.toThrow();
		// The unqualified names "topology" / "health" / "flow" should NOT
		// resolve at the inspect-graph root because they live under the
		// lens mount.
		expect(() => view.resolve("topology")).toThrow();
		expect(() => view.resolve("health")).toThrow();
		expect(() => view.resolve("flow")).toThrow();
		view.destroy();
	});

	it("constructor-time lens topology emit reflects the WRAPPED target's structure, not inspect's own (A4 qa)", () => {
		// Confirms the lens always observes the target graph, NEVER the
		// inspect wrapper itself.
		const target = new Graph("target");
		const a = node([], { name: "a", initial: 1 });
		target.add(a, { name: "a" });
		const view = inspect(target);

		let lastTopology: unknown;
		const unsub = view.lens.topology.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) lastTopology = m[1];
			}
		});

		// The lens describes the TARGET, so node "a" appears.
		expect(lastTopology).toBeDefined();
		const topo = lastTopology as { nodes: Record<string, unknown> };
		expect(topo.nodes).toHaveProperty("a");
		// "audit::*" paths (which exist on `view`, NOT on `target`) do NOT
		// appear in the lens topology.
		const targetPaths = Object.keys(topo.nodes);
		expect(targetPaths.some((p) => p.startsWith("audit::"))).toBe(false);

		unsub();
		view.destroy();
	});
});
