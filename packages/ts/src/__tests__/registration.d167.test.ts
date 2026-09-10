import { afterEach, describe, expect, it, vi } from "vitest";
import { batch } from "../batch/batch.js";
import { depLatest, type NodeFn } from "../ctx/types.js";
import { Dispatcher, type Handle } from "../dispatcher/index.js";
import {
	checkpointBackendStateOfNode,
	registerBackendStateContributor,
} from "../graph/checkpoint.js";
import {
	assertGraphLocalNode,
	Graph,
	releaseGraphNodes,
	restoreNodeInGraph,
	restoreStateNodeInGraph,
} from "../graph/graph.js";
import { graphRegistrations } from "../graph/graph-lifecycle.js";
import { map } from "../graph/operators.js";
import { type MessageBusCommand, messageBus, toTopic } from "../messaging/index.js";
import { attachMessageBusCommandSource } from "../messaging/internal.js";
import { NodeCore } from "../node/core.js";
import { Node } from "../node/node.js";
import { nodeRuntimeHost } from "../node/node-runtime-host.js";
import { ColdNodeAcquisitionError } from "../node/owned-acquisition.js";
import {
	checkpointStateOfNode,
	getNodeOwner,
	isNodeActiveForRelease,
	isNodeRuntimeQuiescentForRelease,
	isNodeRuntimeReleased,
	releaseRuntimeOfNode,
	restoreStateOfNode,
	runtimeReleaseFailuresOfNode,
	subscriberCountOfNode,
} from "../node/runtime-accessors.js";

afterEach(() => vi.restoreAllMocks());
class CountingDispatcher extends Dispatcher {
	readonly live = new Set<Handle>();
	override register(...args: Parameters<Dispatcher["register"]>): Handle {
		const handle = super.register(...args);
		this.live.add(handle);
		return handle;
	}
	override unregister(handle: Handle): void {
		super.unregister(handle);
		this.live.delete(handle);
	}
}
const idle: NodeFn = () => {};
function busFixture() {
	const graph = new Graph();
	const bus = messageBus(graph, { name: "bus", topics: ["t"] });
	const a = graph.node<MessageBusCommand>([], null, { name: "a" });
	const b = graph.node<MessageBusCommand>([], null, { name: "b" });
	return { graph, bus, a, b };
}
function pending(bus: ReturnType<typeof messageBus>) {
	bus.commands.down([["DATA", { kind: "declareTopic", topic: "t" }]]);
}

describe("D167 issued runtime identity and lifecycle", () => {
	it("preserves graph-use results for owned, foreign, bare and unissued identities", () => {
		const g = new Graph();
		const other = new Graph();
		const owned = g.state(2);
		const foreign = other.state(3);
		const bare = new Node([], null);
		expect(() => assertGraphLocalNode(g, owned, "dep")).not.toThrow();
		expect(() => assertGraphLocalNode(g, bare, "dep")).not.toThrow();
		expect(() => assertGraphLocalNode(g, foreign, "dep")).toThrow(
			"dep belongs to a different graph; cross-graph deps require a wire bridge",
		);
		for (const fake of [{}, { ...owned }, Object.create(owned)] as Node<unknown>[]) {
			expect(() => assertGraphLocalNode(g, fake, "dep")).not.toThrow();
			expect(() => checkpointStateOfNode(fake)).toThrow("unknown node state");
		}
		releaseRuntimeOfNode(bare);
		releaseGraphNodes(g, [owned]);
		releaseGraphNodes(other, [foreign]);
	});
	it("rejects graph use from release hooks while runtime access is still open", () => {
		const g = new Graph();
		const input = g.state(2, { name: "input" });
		let hookRan = false;
		nodeRuntimeHost(input)._hooks.onDeactivation.push(() => {
			hookRan = true;
			expect(checkpointStateOfNode(input).cache).toBe(2);
			expect(() => g.node([input], null, { name: "invalid" })).toThrow("has been released");
			expect(g.find("invalid")).toBeUndefined();
		});
		releaseGraphNodes(g, [input]);
		expect(hookRan).toBe(true);
		expect(() => assertGraphLocalNode(g, input, "dep")).toThrow("has been released");
	});
	it("keeps live bare access and rejects copies/prototype descendants without touching the original", () => {
		const n = new Node([], null, { initial: 3 });
		for (const fake of [{}, { ...n }, Object.create(n)] as Node<unknown>[]) {
			expect(() => checkpointStateOfNode(fake)).toThrow("unknown node state");
			expect(() => restoreStateOfNode(fake, {} as never)).toThrow("unknown node state");
			expect(isNodeRuntimeReleased(fake)).toBe(false);
			expect(isNodeRuntimeQuiescentForRelease(fake)).toBe(false);
			expect(subscriberCountOfNode(fake)).toBe(0);
			expect(isNodeActiveForRelease(fake)).toBe(false);
			releaseRuntimeOfNode(fake);
		}
		expect(checkpointStateOfNode(n).cache).toBe(3);
		releaseRuntimeOfNode(n);
		expect(isNodeRuntimeReleased(n)).toBe(true);
		expect(() => checkpointStateOfNode(n)).toThrow("unknown node state");
		expect(() => restoreStateOfNode(n, {} as never)).toThrow("unknown node state");
		expect(isNodeRuntimeQuiescentForRelease(n)).toBe(false);
		releaseRuntimeOfNode(n);
	});
	it("marks release start before hooks, closes access later, and drops contributor", () => {
		const n = new Node([], null);
		const observations: unknown[] = [];
		registerBackendStateContributor(n, () => {
			observations.push("backend");
			return 4;
		});
		nodeRuntimeHost(n)._hooks.onDeactivation.push(() => {
			observations.push(isNodeRuntimeReleased(n), checkpointStateOfNode(n).hasData);
			releaseRuntimeOfNode(n); // reentrant release is inert
		});
		releaseRuntimeOfNode(n);
		expect(checkpointBackendStateOfNode(n, "backend")).toBeUndefined();
		expect(observations).toEqual([true, false]);
		expect(() => registerBackendStateContributor(n, idle)).toThrow("unknown node");
	});
	it("retains failure locators while closing all access without retry", () => {
		const dispatcher = new CountingDispatcher();
		const n = new Node([], idle, { dispatcher });
		const handle = n.handle;
		const boom = new Error("unregister failed");
		const unregister = vi.spyOn(dispatcher, "unregister").mockImplementation(() => {
			throw boom;
		});
		expect(() => releaseRuntimeOfNode(n)).toThrow(boom);
		expect(runtimeReleaseFailuresOfNode(n)?.[0]).toMatchObject({
			resource: "handle",
			handle,
			dispatcher,
			cause: boom,
		});
		expect(isNodeRuntimeReleased(n)).toBe(true);
		expect(() => assertGraphLocalNode(new Graph(), n, "failed dep")).toThrow("has been released");
		expect(() => checkpointStateOfNode(n)).toThrow("unknown");
		releaseRuntimeOfNode(n);
		expect(unregister).toHaveBeenCalledTimes(1);
		unregister.mockRestore();
		dispatcher.unregister(handle!);
	});
	it("keeps Graph records exact and construction maps lazy", () => {
		const graph = new Graph();
		const n = graph.state(1);
		expect(graphRegistrations.get(graph)?.existingConstructions).toBeUndefined();
		for (const fake of [{ ...graph }, Object.create(graph)] as Graph[]) {
			expect(() => restoreStateNodeInGraph(fake, "x")).toThrow("unknown graph");
			expect(() => releaseGraphNodes(fake, [n])).toThrow("unknown lifecycle");
		}
		releaseGraphNodes(graph, [n]);
		expect(graphRegistrations.get(graph)?.existingConstructions).toBeUndefined();
		expect(getNodeOwner(n)).toBeUndefined();
	});
});

describe("D167 known cold acquisitions", () => {
	it.each([
		"node",
		"state",
		"producer",
		"derived",
		"effect",
		"initNode",
		"restore",
		"restoreState",
	])("prechecks duplicate %s without acquiring a function", (factory) => {
		const dispatcher = new CountingDispatcher();
		const g = new Graph({ dispatcher });
		const existing = g.node([], idle, { name: "same" });
		const before = [...dispatcher.live];
		const opts = { name: "same" };
		const create: Record<string, () => unknown> = {
			node: () => g.node([], idle, opts),
			state: () => g.state(2, opts),
			producer: () => g.producer(idle, opts),
			derived: () => g.derived([existing], () => 2, opts),
			effect: () => g.effect([existing], idle, opts),
			initNode: () =>
				g.initNode(
					map((v: unknown) => v),
					[existing],
					opts,
				),
			restore: () => restoreNodeInGraph(g, "same", "node", [], idle),
			restoreState: () => restoreStateNodeInGraph(g, "same"),
		};
		expect(create[factory]).toThrow("duplicate node id");
		expect([...dispatcher.live]).toEqual(before);
		expect(g.find("same")).toBe(existing);
		releaseGraphNodes(g, [existing]);
	});
	it("cleans an acquired function when a later option getter throws", () => {
		const dispatcher = new CountingDispatcher();
		const cause = new Error("options");
		expect(
			() =>
				new Node([], idle, {
					dispatcher,
					get initial() {
						throw cause;
					},
				}),
		).toThrow(cause);
		expect(dispatcher.live.size).toBe(0);
	});
	it("does not unregister a borrowed handle after a failed bare construction", () => {
		const dispatcher = new CountingDispatcher();
		const handle = dispatcher.register(idle, "sync");
		expect(
			() =>
				new Node([], handle, {
					dispatcher,
					get initial() {
						throw new Error("options");
					},
				}),
		).toThrow("options");
		expect([...dispatcher.live]).toEqual([handle]);
		dispatcher.unregister(handle);
	});
	it("records a partial core slot before state material can throw", () => {
		const dispatcher = new CountingDispatcher();
		const original = NodeCore.prototype.createSlot;
		let core: NodeCore | undefined;
		let id: Parameters<NodeCore["get"]>[0] | undefined;
		vi.spyOn(NodeCore.prototype, "createSlot").mockImplementation(function (slot, state, acquired) {
			core = this;
			const bad = {
				...state,
				get wave() {
					id = acquired!.slot;
					throw new Error("partial slot");
				},
			};
			return original.call(this, slot, bad, acquired) as never;
		});
		expect(() => new Node([], idle, { dispatcher })).toThrow("partial slot");
		expect(dispatcher.live.size).toBe(0);
		expect(id).toBeDefined();
		expect(() => core!.get(id!)).toThrow("unknown node slot");
		expect(() => core!.getDep(id!)).toThrow("unknown node dep");
	});
	it("keeps original error plus residual locators when cold cleanup fails", () => {
		const dispatcher = new CountingDispatcher();
		const cause = new Error("construct");
		const cleanup = new Error("cleanup");
		const unregister = vi.spyOn(dispatcher, "unregister").mockImplementation(() => {
			throw cleanup;
		});
		let caught: unknown;
		try {
			new Node([], idle, {
				dispatcher,
				get initial() {
					throw cause;
				},
			});
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ColdNodeAcquisitionError);
		expect(caught).toMatchObject({
			cause,
			cleanupErrors: [{ cause: cleanup, resource: "handle", dispatcher }],
		});
		unregister.mockRestore();
		for (const handle of dispatcher.live) dispatcher.unregister(handle);
	});
	it("revalidates publication after reentrant register and preserves the winning node", () => {
		const dispatcher = new CountingDispatcher();
		const g = new Graph({ dispatcher });
		let winner: Node<unknown> | undefined;
		const original = dispatcher.register.bind(dispatcher);
		vi.spyOn(dispatcher, "register").mockImplementationOnce((...args) => {
			winner = g.node([], idle, { name: "same" });
			return original(...args);
		});
		expect(() => g.node([], idle, { name: "same" })).toThrow("duplicate node id");
		expect(g.find("same")).toBe(winner);
		expect(dispatcher.live.size).toBe(1);
		expect(g.describe().nodes).toHaveLength(1);
		releaseGraphNodes(g, [winner!]);
	});
	it("snapshots user entry properties before final publication validation", () => {
		const dispatcher = new CountingDispatcher();
		const g = new Graph({ dispatcher });
		let reads = 0;
		let winner: Node<unknown> | undefined;
		expect(() =>
			g.node([], idle, {
				name: "same",
				get restore() {
					reads++;
					if (reads === 2) winner = g.state(7, { name: "same" });
					return undefined;
				},
			}),
		).toThrow("duplicate node id");
		expect(g.find("same")).toBe(winner);
		expect(g.describe().nodes).toHaveLength(1);
		expect(dispatcher.live.size).toBe(0);
		releaseGraphNodes(g, [winner!]);
	});
	it("revalidates the ID after caller dependency iteration at publication", () => {
		const d = new CountingDispatcher();
		const g = new Graph({ dispatcher: d });
		const input = g.state(1);
		let entryRead = false;
		let reads = 0;
		let winner: Node<unknown> | undefined;
		const deps = [input];
		deps[Symbol.iterator] = function* () {
			if (entryRead && winner === undefined) winner = g.state(9, { name: "same" });
			yield input;
		};
		expect(() =>
			g.node(deps, idle, {
				name: "same",
				get restore() {
					if (++reads === 2) entryRead = true;
					return undefined;
				},
			}),
		).toThrow("duplicate");
		expect(g.find("same")).toBe(winner);
		expect(g.describe().nodes).toHaveLength(2);
		expect(d.live.size).toBe(0);
		releaseGraphNodes(g, [input, winner!]);
	});
});

describe("D167 exact command binding and existing D110 batch fate", () => {
	it("rejects a foreign source without poisoning later valid attachment", () => {
		const f = busFixture();
		const foreign = new Graph().node<MessageBusCommand>();
		expect(() => attachMessageBusCommandSource(f.graph, f.bus, foreign)).toThrow();
		expect(f.bus.commands.deps).toEqual([]);
		const dispose = attachMessageBusCommandSource(f.graph, f.bus, f.a);
		expect(f.bus.commands.deps).toEqual([f.a]);
		dispose();
		dispose();
		expect(f.bus.commands.deps).toEqual([]);
	});
	it.each([false, true])("two deferred adds use actual deps; rollback=%s", (rollback) => {
		const f = busFixture();
		batch((ctx) => {
			pending(f.bus);
			attachMessageBusCommandSource(f.graph, f.bus, f.a);
			attachMessageBusCommandSource(f.graph, f.bus, f.b);
			expect(f.bus.commands.deps).toEqual([]);
			if (rollback) ctx.rollback();
		});
		expect(f.bus.commands.deps).toEqual(rollback ? [] : [f.a, f.b]);
		if (!rollback) {
			const seen: unknown[] = [];
			const unsubscribe = f.bus.commands.subscribe((m) => {
				if (m[0] === "DATA") seen.push(m[1]);
			});
			const command: MessageBusCommand = { kind: "declareTopic", topic: "later" };
			f.b.down([["DATA", command]]);
			expect(seen).toContainEqual(command);
			unsubscribe();
		}
	});
	it("queued add followed by remove runs both FIFO operations", () => {
		const f = busFixture();
		const activations: string[] = [];
		const a = f.graph.producer(
			(ctx) => {
				activations.push("add");
				ctx.onDeactivation(() => {
					activations.push("remove");
				});
			},
			{ name: "active" },
		);
		batch(() => {
			pending(f.bus);
			const remove = attachMessageBusCommandSource(f.graph, f.bus, a);
			remove();
		});
		expect(f.bus.commands.deps).toEqual([]);
		expect(activations).toEqual(["add", "remove"]);
	});
	it("rolled-back removal remains removable through the same disposer", () => {
		const f = busFixture();
		const remove = attachMessageBusCommandSource(f.graph, f.bus, f.a);
		batch((ctx) => {
			pending(f.bus);
			remove();
			ctx.rollback();
		});
		expect(f.bus.commands.deps).toEqual([f.a]);
		remove();
		expect(f.bus.commands.deps).toEqual([]);
	});
	it.each([
		false,
		true,
	])("duplicate exact add has no independently owned lease; deferred=%s", (deferred) => {
		const f = busFixture();
		let first!: () => void;
		let duplicate!: () => void;
		const add = () => {
			first = attachMessageBusCommandSource(f.graph, f.bus, f.a);
			duplicate = attachMessageBusCommandSource(f.graph, f.bus, f.a);
		};
		if (deferred)
			batch(() => {
				pending(f.bus);
				add();
			});
		else add();
		duplicate();
		expect(f.bus.commands.deps).toEqual([f.a]);
		first();
		expect(f.bus.commands.deps).toEqual([]);
	});
	it("retains committed deps when new dependency activation throws", () => {
		const f = busFixture();
		const source = f.graph.node<MessageBusCommand>([], null);
		const subscribe = vi.spyOn(source, "subscribe");
		// The actual owned subscription seam throws after structural commit.
		const original = nodeRuntimeHost(source)._subscribeOwned;
		vi.spyOn(nodeRuntimeHost(source), "_subscribeOwned").mockImplementation(function (...args) {
			original.apply(this, args);
			throw new Error("activation");
		});
		expect(() => attachMessageBusCommandSource(f.graph, f.bus, source)).toThrow("activation");
		expect(f.bus.commands.deps).toEqual([source]);
		expect(subscribe).not.toHaveBeenCalled();
	});
	it("public toTopic release survives a rolled-back remove", () => {
		const f = busFixture();
		const source = f.graph.state(1);
		const binding = toTopic(f.graph, source, f.bus, "t", { name: "public" });
		batch((ctx) => {
			pending(f.bus);
			binding.release();
			ctx.rollback();
		});
		expect(f.bus.commands.deps).toContain(binding.commands);
		binding.release();
		expect(f.bus.commands.deps).not.toContain(binding.commands);
	});
	it("completed and duplicate disposers stay inert after commands terminate", () => {
		const f = busFixture();
		const first = attachMessageBusCommandSource(f.graph, f.bus, f.a);
		const duplicate = attachMessageBusCommandSource(f.graph, f.bus, f.a);
		first();
		f.bus.commands.down([["COMPLETE"]]);
		expect(first).not.toThrow();
		expect(duplicate).not.toThrow();
	});
	it("ordinary data flow still uses dispatcher/dependencies after composition", () => {
		const g = new Graph();
		const a = g.state(2);
		const b = g.node([a], (ctx) => ctx.down([["DATA", depLatest(ctx, 0)]]));
		const stop = b.subscribe(() => {});
		a.set(9);
		expect(b.cache).toBe(9);
		stop();
		releaseGraphNodes(g, [b, a]);
	});
});
