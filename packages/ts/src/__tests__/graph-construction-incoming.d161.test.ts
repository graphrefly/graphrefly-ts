import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareConstruction } from "../graph/construction-scope.js";
import { Graph, releaseGraphNodes } from "../graph/graph.js";
import type { TopologyEvent } from "../graph/inspect.js";
import { observeTopology } from "../graph/inspect.js";
import { renderSnapshot } from "../graph/render.js";
import { mountGraph } from "../graph/topology.js";
import type { NodeCore } from "../node/core.js";
import { Node, withNodeCore } from "../node/node.js";
import { releaseRuntimeOfNode } from "../node/runtime-accessors.js";
import { relayFirst } from "./helpers/relay.js";

const graphs: Graph[] = [];
const bare: Node<unknown>[] = [];
const stops: Array<() => void> = [];

function graph() {
	const g = new Graph();
	graphs.push(g);
	return g;
}
/** An unregistered node of `g`'s domain (R-graph-domain@3: every node belongs to a graph). */
function hidden(g: Graph, deps: Node<unknown>[] = []) {
	const core = (g as unknown as { _core: NodeCore })._core;
	const n = withNodeCore(
		core,
		() => new Node(deps, deps.length === 0 ? null : relayFirst, { factory: "hidden" }),
	);
	bare.push(n);
	return n;
}
function fixture(g = graph()) {
	const a = g.state(2, { name: "a" });
	const b = g.state(3, { name: "b" });
	const scope = prepareConstruction(g, {
		name: "view",
		epoch: 1,
		inputs: [a, b],
		names: ["view/root", "view/future"],
	});
	const root = scope.node([a, b], relayFirst, { name: "view/root" });
	return { g, a, b, scope, root };
}
afterEach(() => {
	vi.restoreAllMocks();
	for (const stop of stops.splice(0)) stop();
	for (const g of graphs.splice(0)) {
		const nodes = g.describe().flatMap(({ id }) => {
			const n = g.find(id);
			return n ? [n] : [];
		});
		releaseGraphNodes(g, nodes);
	}
	for (const n of bare.splice(0)) releaseRuntimeOfNode(n);
});

describe("D161 B1 incoming inspection", () => {
	it("captures only actual acquired targets, reading current deps before the manifest is complete", () => {
		const f = fixture();
		f.g.node([f.a], relayFirst, { name: "view/decoy" });
		f.g.replace(f.root, [f.b], relayFirst);
		expect(f.scope.readIncoming().edges).toEqual([{ from: "b", to: "view/root" }]);
		expect(f.g.find("view/future")).toBeUndefined();
		expect(f.root.status.cache).toBe("empty");
	});

	it("avoids unrelated value snapshot reads without activating nodes", () => {
		const f = fixture();
		const fn = vi.fn();
		const bg = f.g.node([f.a], fn, { name: "background" });
		const cache = vi.spyOn(bg, "cache", "get");
		const status = vi.spyOn(bg, "status", "get");
		expect(f.scope.readIncoming().edges).toHaveLength(2);
		expect(cache).not.toHaveBeenCalled();
		expect(status).not.toHaveBeenCalled();
		expect(fn).not.toHaveBeenCalled();
	});

	it.each([
		false,
		true,
	])("preserves unrelated transitive/cyclic ID discovery with mount=%s", (mount) => {
		function run(local: boolean) {
			const f = fixture();
			const inspected = mount ? graph() : f.g;
			const w = hidden(inspected);
			const u = hidden(inspected, [w]);
			const v = hidden(inspected, [u]);
			// Public rewire rejects cycles. Stress only the inspection walk with a cold getter fixture.
			vi.spyOn(u, "deps", "get").mockReturnValue([w, v]);
			inspected.node([u, v, u], relayFirst, { name: "background" });
			inspected.node([], null, { name: "~hidden#0" });
			if (mount) mountGraph(f.g, inspected, { at: "child" });
			renderSnapshot(f.g);
			if (local) f.scope.readIncoming();
			const events: TopologyEvent[] = [];
			stops.push(observeTopology(inspected).subscribe((e) => events.push(e)));
			inspected.node([hidden(inspected)], relayFirst, { name: "later" });
			return { events, snapshot: renderSnapshot(f.g), checkpoint: f.g.checkpoint() };
		}
		expect(run(true)).toEqual(run(false));
	});

	it("retains a target's unregistered live dependency rather than substituting its old registered dep", () => {
		const f = fixture();
		f.g.replace(f.root, [hidden(f.g)], relayFirst);
		expect(f.scope.readIncoming().edges).toEqual([{ from: "~hidden#0", to: "view/root" }]);
		expect(renderSnapshot(f.g).nodes.find((n) => n.id === "view/root")?.deps).toEqual([
			"~hidden#0",
		]);
	});

	it("rejects a released acquired member instead of returning an empty successful snapshot", () => {
		const f = fixture();
		releaseGraphNodes(f.g, [f.root]);
		expect(() => f.scope.readIncoming()).toThrow(/released from its graph lifecycle/);
	});
});
