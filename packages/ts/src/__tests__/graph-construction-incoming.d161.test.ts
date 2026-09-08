import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareConstruction } from "../graph/construction-scope.js";
import { Graph, releaseGraphNodes } from "../graph/graph.js";
import type { TopologyEvent } from "../graph/inspect.js";
import { Node } from "../node/node.js";
import { releaseRuntimeOfNode } from "../node/runtime-accessors.js";

const graphs: Graph[] = [];
const bare: Node<unknown>[] = [];
const stops: Array<() => void> = [];
const nativeDescribe = Graph.prototype.describe;
function graph() {
	const g = new Graph();
	graphs.push(g);
	return g;
}
function hidden(deps: Node<unknown>[] = []) {
	const n = new Node(deps, null, { factory: "hidden" });
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
	const root = scope.node([a, b], null, { name: "view/root" });
	return { g, a, b, scope, root };
}
afterEach(() => {
	vi.restoreAllMocks();
	for (const stop of stops.splice(0)) stop();
	for (const g of graphs.splice(0)) {
		const nodes = nativeDescribe.call(g).nodes.flatMap(({ id }) => {
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
		f.g.node([f.a], null, { name: "view/decoy" });
		f.root.replaceDeps([f.b], null);
		expect(f.scope.readIncoming().edges).toEqual([{ from: "b", to: "view/root" }]);
		expect(f.g.find("view/future")).toBeUndefined();
		expect(f.root.status).toBe("sentinel");
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
			const w = hidden();
			const u = hidden([w]);
			const v = hidden([u]);
			// Public rewire rejects cycles. Stress only the inspection walk with a cold getter fixture.
			vi.spyOn(u, "deps", "get").mockReturnValue([w, v]);
			inspected.node([u, v, u], null, { name: "background" });
			inspected.node([], null, { name: "~hidden#0" });
			if (mount) f.g.mount(inspected, { at: "child" });
			if (local) f.scope.readIncoming();
			else f.g.describe();
			const events: TopologyEvent[] = [];
			stops.push(inspected.observeTopology().subscribe((e) => events.push(e)));
			inspected.node([hidden()], null, { name: "later" });
			return { events, snapshot: f.g.describe(), checkpoint: f.g.checkpoint() };
		}
		expect(run(true)).toEqual(run(false));
	});

	it("retains a target's unregistered live dependency rather than substituting its old registered dep", () => {
		const f = fixture();
		f.root.replaceDeps([hidden()], null);
		expect(f.scope.readIncoming().edges).toEqual([{ from: "~hidden#0", to: "view/root" }]);
		expect(f.g.describe().nodes.find((n) => n.id === "view/root")?.deps).toEqual(["~hidden#0"]);
	});

	it("captures parent edges before the mounted child's overridden read changes them", () => {
		const f = fixture();
		const child = graph();
		f.g.mount(child, { at: "child" });
		const read = vi.spyOn(child, "describe").mockImplementation((opts, prefix) => {
			f.root.replaceDeps([f.b], null);
			return nativeDescribe.call(child, opts, prefix);
		});
		expect(f.scope.readIncoming().edges).toEqual([
			{ from: "a", to: "view/root" },
			{ from: "b", to: "view/root" },
		]);
		expect(read).toHaveBeenCalledExactlyOnceWith({}, "child::");
		expect(f.root.deps).toEqual([f.b]);
	});

	it("propagates mounted read failures", () => {
		const f = fixture();
		const child = graph();
		f.g.mount(child, { at: "child" });
		const failure = new Error("child inspection");
		vi.spyOn(child, "describe").mockImplementation(() => {
			throw failure;
		});
		expect(() => f.scope.readIncoming()).toThrow(failure);
	});

	it.each([
		"instance",
		"prototype",
	] as const)("preserves %s override results without filtering", (kind) => {
		const f = fixture();
		const snapshot = { nodes: [], edges: [{ from: "extra", to: "outside" }] };
		const read = vi
			.spyOn(kind === "instance" ? f.g : Graph.prototype, "describe")
			.mockReturnValue(snapshot);
		expect(f.scope.readIncoming()).toBe(snapshot);
		expect(read).toHaveBeenCalledExactlyOnceWith();
	});

	it("preserves subclass overrides and exceptions", () => {
		let calls = 0;
		class CustomGraph extends Graph {
			override describe(): never {
				calls += 1;
				throw new Error("custom read");
			}
		}
		const g = new CustomGraph();
		graphs.push(g);
		const f = fixture(g);
		expect(() => f.scope.readIncoming()).toThrow("custom read");
		expect(calls).toBe(1);
	});

	it("reads a getter override once and keeps its graph receiver", () => {
		const f = fixture();
		let reads = 0;
		const snapshot = { nodes: [], edges: [] };
		Object.defineProperty(f.g, "describe", {
			configurable: true,
			get() {
				reads += 1;
				if (reads > 1) throw new Error("describe was read twice");
				const describe = function (this: Graph) {
					expect(this).toBe(f.g);
					return snapshot;
				};
				Object.defineProperty(describe, "call", {
					get() {
						throw new Error("extra call property read");
					},
				});
				return describe;
			},
		});
		expect(f.scope.readIncoming()).toBe(snapshot);
		expect(reads).toBe(1);
	});

	it("rejects a released acquired member instead of returning an empty successful snapshot", () => {
		const f = fixture();
		releaseGraphNodes(f.g, [f.root]);
		expect(() => f.scope.readIncoming()).toThrow(/released from its graph lifecycle/);
	});
});
