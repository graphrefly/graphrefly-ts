import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeFn } from "../ctx/types.js";
import {
	assertGraphLocalNode,
	Graph,
	releaseGraphNodes,
	restoreNodeInGraph,
	restoreStateNodeInGraph,
} from "../graph/graph.js";
import { graphRegistrations } from "../graph/graph-lifecycle.js";
import { observeTopology } from "../graph/inspect.js";
import { map } from "../graph/operators.js";
import { renderSnapshot } from "../graph/render.js";
import { type MessageBusCommand, messageBus, toTopic } from "../messaging/index.js";
import { attachMessageBusCommandSource } from "../messaging/internal.js";
import { kernelOfNode, type Node, type StateNode } from "../node/node.js";
import { ColdNodeAcquisitionError } from "../node/owned-acquisition.js";
import * as runtimeAccessors from "../node/runtime-accessors.js";
import {
	checkpointStateOfNode,
	getNodeOwner,
	isNodeActiveForRelease,
	isNodeRuntimeQuiescentForRelease,
	isNodeRuntimeReleased,
	releaseRuntimeOfNode,
	restoreStateOfNode,
	subscriberCountOfNode,
} from "../node/runtime-accessors.js";
import { relayFirst } from "./helpers/relay.js";

afterEach(() => vi.restoreAllMocks());
const idle: NodeFn = () => {};
function busFixture() {
	const graph = new Graph();
	const bus = messageBus(graph, { name: "bus", topics: ["t"] });
	const a = graph.node<MessageBusCommand>([], null, { name: "a" });
	const b = graph.node<MessageBusCommand>([], null, { name: "b" });
	// The bus's own publish input is its first declared dependency; attached sources follow it.
	const publish = graph.find("bus/publish") as StateNode<MessageBusCommand>;
	return { graph, bus, a, b, publish };
}
function pending(bus: ReturnType<typeof messageBus>) {
	(bus.commands.deps[0] as StateNode<MessageBusCommand>).set({ kind: "ensure-topic", topic: "t" });
}

describe("D167 issued runtime identity and lifecycle", () => {
	it("rejects graph use from release hooks while runtime access is still open", () => {
		const g = new Graph();
		const input = g.state(2, { name: "input" });
		let hookRan = false;
		// A topology observer of the release runs before the graph's release returns.
		const stop = observeTopology(g, "input").subscribe((event) => {
			if (event.kind !== "node-released") return;
			hookRan = true;
			expect(checkpointStateOfNode(input).cache).toBe(2);
			expect(() => g.node([input], relayFirst, { name: "invalid" })).toThrow("has been released");
			expect(g.find("invalid")).toBeUndefined();
		});
		releaseGraphNodes(g, [input]);
		stop();
		expect(hookRan).toBe(true);
		expect(() => assertGraphLocalNode(g, input, "dep")).toThrow("has been released");
	});
	it("keeps live bare access and rejects copies/prototype descendants without touching the original", () => {
		const n = new Graph().node([], null, { initial: 3 });
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
	])("prechecks duplicate %s without acquiring a node", (factory) => {
		const g = new Graph();
		const existing = g.node([], idle, { name: "same" });
		const opts = { name: "same" };
		const create: Record<string, () => unknown> = {
			node: () => g.node([], idle, opts),
			state: () => g.state(2, opts),
			producer: () => g.producer(idle, opts),
			derived: () => g.derived([existing], () => 2, opts),
			effect: () => g.effect([existing], () => {}, opts),
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
		expect(g.find("same")).toBe(existing);
		releaseGraphNodes(g, [existing]);
	});
	it("keeps original error plus residual locators when cold cleanup fails", () => {
		const g = new Graph();
		const cleanup = new Error("cleanup");
		let winner: Node<unknown> | undefined;
		// A winner takes the name while the node is built, so its publication fails after
		// construction; the release of the unpublished node then throws.
		const issue = runtimeAccessors.issueNodeRegistration;
		vi.spyOn(runtimeAccessors, "issueNodeRegistration").mockImplementationOnce((node) => {
			winner = g.state(7, { name: "same" });
			issue(node);
		});
		vi.spyOn(runtimeAccessors, "releaseRuntimeOfNode").mockImplementation(() => {
			throw cleanup;
		});
		let caught: unknown;
		try {
			g.node([], idle, { name: "same" });
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ColdNodeAcquisitionError);
		expect(caught).toMatchObject({
			cause: expect.objectContaining({ message: expect.stringMatching(/duplicate node id/) }),
			cleanupErrors: [{ cause: cleanup, resource: "runtime", core: kernelOfNode(winner!) }],
		});
		vi.restoreAllMocks();
		releaseGraphNodes(g, [winner!]);
	});
	it("revalidates publication after reentrant construction and preserves the winning node", () => {
		const g = new Graph();
		let winner: Node<unknown> | undefined;
		const original = runtimeAccessors.issueNodeRegistration;
		vi.spyOn(runtimeAccessors, "issueNodeRegistration").mockImplementationOnce((node) => {
			winner = g.node([], idle, { name: "same" });
			original(node);
		});
		expect(() => g.node([], idle, { name: "same" })).toThrow("duplicate node id");
		expect(g.find("same")).toBe(winner);
		expect(renderSnapshot(g).nodes).toHaveLength(1);
		releaseGraphNodes(g, [winner!]);
	});
	it("snapshots user entry properties before final publication validation", () => {
		const g = new Graph();
		let reads = 0;
		let winner: Node<unknown> | undefined;
		expect(() =>
			g.node([], idle, {
				name: "same",
				// The entry's meta is read a third time at publication, after the node is built.
				get meta() {
					reads++;
					if (reads === 3) winner = g.state(7, { name: "same" });
					return undefined;
				},
			}),
		).toThrow("duplicate node id");
		expect(g.find("same")).toBe(winner);
		expect(renderSnapshot(g).nodes).toHaveLength(1);
		releaseGraphNodes(g, [winner!]);
	});
	it("revalidates the ID after caller dependency iteration at publication", () => {
		const g = new Graph();
		const input = g.state(1);
		let entryRead = false;
		let reads = 0;
		let winner: Node<unknown> | undefined;
		const deps = [input];
		deps[Symbol.iterator] = function* (): Generator<StateNode<number>, undefined> {
			if (entryRead && winner === undefined) winner = g.state(9, { name: "same" });
			yield input;
		};
		expect(() =>
			g.node(deps, idle, {
				name: "same",
				get meta() {
					if (++reads === 3) entryRead = true;
					return undefined;
				},
			}),
		).toThrow("duplicate");
		expect(g.find("same")).toBe(winner);
		expect(renderSnapshot(g).nodes).toHaveLength(2);
		releaseGraphNodes(g, [input, winner!]);
	});
});

describe("D167 exact command binding and existing D110 batch fate", () => {
	it("rejects a foreign source without poisoning later valid attachment", () => {
		const f = busFixture();
		const foreign = new Graph().node<MessageBusCommand>();
		expect(() => attachMessageBusCommandSource(f.graph, f.bus, foreign)).toThrow();
		expect(f.bus.commands.deps).toEqual([f.publish]);
		const dispose = attachMessageBusCommandSource(f.graph, f.bus, f.a);
		expect(f.bus.commands.deps).toEqual([f.publish, f.a]);
		dispose();
		dispose();
		expect(f.bus.commands.deps).toEqual([f.publish]);
	});
	it.each([false, true])("two deferred adds use actual deps; rollback=%s", (rollback) => {
		const f = busFixture();
		const abort = new Error("abort");
		const body = () => {
			pending(f.bus);
			attachMessageBusCommandSource(f.graph, f.bus, f.a);
			attachMessageBusCommandSource(f.graph, f.bus, f.b);
			expect(f.bus.commands.deps).toEqual([f.publish]);
			if (rollback) throw abort;
		};
		if (rollback) expect(() => f.graph.batch(body)).toThrow(abort);
		else f.graph.batch(body);
		expect(f.bus.commands.deps).toEqual(rollback ? [f.publish] : [f.publish, f.a, f.b]);
		if (!rollback) {
			const seen: unknown[] = [];
			const unsubscribe = f.bus.commands.subscribe((incoming) => {
				for (const m of incoming) {
					if (m[0] === "DATA") seen.push(m[1]);
				}
			});
			const command: MessageBusCommand = { kind: "ensure-topic", topic: "later" };
			f.b.set(command);
			expect(seen).toContainEqual(command);
			unsubscribe();
		}
	});
	it("queued add followed by remove runs both FIFO operations", () => {
		const f = busFixture();
		const activations: string[] = [];
		const a = f.graph.producer<MessageBusCommand>(
			(ctx) => {
				activations.push("add");
				ctx.signal.addEventListener(
					"abort",
					() => {
						activations.push("remove");
					},
					{ once: true },
				);
			},
			{ name: "active" },
		);
		f.graph.batch(() => {
			pending(f.bus);
			const remove = attachMessageBusCommandSource(f.graph, f.bus, a);
			remove();
		});
		expect(f.bus.commands.deps).toEqual([f.publish]);
		expect(activations).toEqual(["add", "remove"]);
	});
	it("rolled-back removal remains removable through the same disposer", () => {
		const f = busFixture();
		const remove = attachMessageBusCommandSource(f.graph, f.bus, f.a);
		const abort = new Error("abort");
		expect(() =>
			f.graph.batch(() => {
				pending(f.bus);
				remove();
				throw abort;
			}),
		).toThrow(abort);
		expect(f.bus.commands.deps).toEqual([f.publish, f.a]);
		remove();
		expect(f.bus.commands.deps).toEqual([f.publish]);
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
			f.graph.batch(() => {
				pending(f.bus);
				add();
			});
		else add();
		duplicate();
		expect(f.bus.commands.deps).toEqual([f.publish, f.a]);
		first();
		expect(f.bus.commands.deps).toEqual([f.publish]);
	});
	it("refuses a released source before changing the bus's dependencies", () => {
		const f = busFixture();
		const source = f.graph.node<MessageBusCommand>([], null);
		const subscribe = vi.spyOn(source, "subscribe");
		// A node released from its graph cannot be attached: the refusal comes before any change,
		// so the bus keeps the dependencies it had (graphrefly-ts:D193 (6): the graph layer checks
		// release; the kernel never sees the released node).
		releaseGraphNodes(f.graph, [source]);
		expect(() => attachMessageBusCommandSource(f.graph, f.bus, source)).toThrow(/released/);
		expect(f.bus.commands.deps).toEqual([f.publish]);
		expect(subscribe).not.toHaveBeenCalled();
	});
	it("public toTopic release survives a rolled-back remove", () => {
		const f = busFixture();
		const source = f.graph.state(1);
		const binding = toTopic(f.graph, source, f.bus, "t", { name: "public" });
		const abort = new Error("abort");
		expect(() =>
			f.graph.batch(() => {
				pending(f.bus);
				binding.release();
				throw abort;
			}),
		).toThrow(abort);
		expect(f.bus.commands.deps).toContain(binding.commands);
		binding.release();
		expect(f.bus.commands.deps).not.toContain(binding.commands);
	});
	it("completed and duplicate disposers stay inert after commands terminate", () => {
		const f = busFixture();
		const first = attachMessageBusCommandSource(f.graph, f.bus, f.a);
		const duplicate = attachMessageBusCommandSource(f.graph, f.bus, f.a);
		first();
		f.publish.complete();
		expect(first).not.toThrow();
		expect(duplicate).not.toThrow();
	});
	it("ordinary data flow still uses dependencies after composition", () => {
		const g = new Graph();
		const a = g.state(2);
		const b = g.node([a], (ctx) => ctx.down([["DATA", ctx.deps[0].value]]));
		const stop = b.subscribe(() => {});
		a.set(9);
		expect(b.cache).toBe(9);
		stop();
		releaseGraphNodes(g, [b, a]);
	});
});
