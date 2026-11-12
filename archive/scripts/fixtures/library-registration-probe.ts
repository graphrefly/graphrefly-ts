/** D167 finite loaded-runtime mutation probe. Assertions concern observable ownership, not registry layout. */
import assert from "node:assert/strict";
import { batch } from "../../packages/ts/src/batch/batch.js";
import { Dispatcher, type Handle } from "../../packages/ts/src/dispatcher/index.js";
import {
	checkpointBackendStateOfNode,
	registerBackendStateContributor,
} from "../../packages/ts/src/graph/checkpoint.js";
import {
	Graph,
	releaseGraphNodes,
	restoreStateNodeInGraph,
} from "../../packages/ts/src/graph/graph.js";
import { type MessageBusCommand, messageBus } from "../../packages/ts/src/messaging/index.js";
import { attachMessageBusCommandSource } from "../../packages/ts/src/messaging/internal.js";
import { NodeCore } from "../../packages/ts/src/node/core.js";
import { Node } from "../../packages/ts/src/node/node.js";
import { nodeRuntimeHost } from "../../packages/ts/src/node/node-runtime-host.js";
import {
	checkpointStateOfNode,
	isNodeRuntimeReleased,
	releaseRuntimeOfNode,
} from "../../packages/ts/src/node/runtime-accessors.js";

class CountingDispatcher extends Dispatcher {
	readonly live = new Set<Handle>();
	override register(...args: Parameters<Dispatcher["register"]>) {
		const h = super.register(...args);
		this.live.add(h);
		return h;
	}
	override unregister(h: Handle) {
		super.unregister(h);
		this.live.delete(h);
	}
}
const idle = () => {};
export function probe() {
	const passed: string[] = [];
	function check(name: string, fn: () => void) {
		fn();
		passed.push(name);
	}
	check("exact-node-identity", () => {
		const n = new Node([], null, { initial: 5 });
		assert.throws(() => checkpointStateOfNode(Object.create(n)), /unknown node state/);
		assert.equal(checkpointStateOfNode(n).cache, 5);
		releaseRuntimeOfNode(n);
	});
	check("release-timing-and-backend", () => {
		const n = new Node([], null);
		let backendCalls = 0;
		let atHook: unknown;
		registerBackendStateContributor(n, () => {
			backendCalls++;
			return 1;
		});
		nodeRuntimeHost(n)._hooks.onDeactivation.push(() => {
			atHook = [isNodeRuntimeReleased(n), checkpointStateOfNode(n).hasData];
		});
		assert.doesNotThrow(() => releaseRuntimeOfNode(n));
		assert.deepEqual(atHook, [true, false]);
		assert.equal(checkpointBackendStateOfNode(n, "backend"), undefined);
		assert.equal(backendCalls, 0);
		assert.throws(() => checkpointStateOfNode(n), /unknown/);
	});
	check("graph-use-rejects-release-start", () => {
		const g = new Graph();
		const n = g.state(7, { name: "input" });
		let hookRan = false;
		nodeRuntimeHost(n)._hooks.onDeactivation.push(() => {
			hookRan = true;
			assert.equal(checkpointStateOfNode(n).cache, 7);
			assert.throws(() => g.node([n], null, { name: "invalid" }), /has been released/);
			assert.equal(g.find("invalid"), undefined);
		});
		releaseGraphNodes(g, [n]);
		assert.equal(hookRan, true);
	});
	check("graph-use-rejects-foreign-owner", () => {
		const g = new Graph();
		const other = new Graph();
		const n = other.state(1);
		assert.throws(() => g.node([n], null, { name: "invalid" }), /different graph/);
		assert.equal(g.find("invalid"), undefined);
		releaseGraphNodes(other, [n]);
	});
	check("cold-handle-cleanup", () => {
		const d = new CountingDispatcher();
		assert.throws(
			() =>
				new Node([], idle, {
					dispatcher: d,
					get initial() {
						throw new Error("cold");
					},
				}),
			/cold/,
		);
		assert.equal(d.live.size, 0);
		const borrowed = d.register(idle, "sync");
		assert.throws(
			() =>
				new Node([], borrowed, {
					dispatcher: d,
					get initial() {
						throw new Error("cold");
					},
				}),
			/cold/,
		);
		assert.deepEqual([...d.live], [borrowed]);
		d.unregister(borrowed);
	});
	check("partial-slot-cleanup", () => {
		const create = NodeCore.prototype.createSlot;
		let core!: NodeCore;
		let acquiredId = -1;
		NodeCore.prototype.createSlot = function (slot, state, acquisition) {
			core = this;
			const badState = {
				...state,
				get wave() {
					acquiredId = acquisition?.slot ?? -1;
					throw new Error("partial");
				},
			};
			return create.call(this, slot, badState, acquisition) as never;
		};
		try {
			assert.throws(() => new Node([], idle), /partial/);
		} finally {
			NodeCore.prototype.createSlot = create;
		}
		assert.notEqual(acquiredId, -1);
		assert.throws(() => core.get(acquiredId as never), /unknown node slot/);
	});
	check("graph-publication-reentry", () => {
		const d = new CountingDispatcher();
		const graph = new Graph({ dispatcher: d });
		let winner: Node<unknown> | undefined;
		let reads = 0;
		assert.throws(
			() =>
				graph.node([], idle, {
					name: "same",
					get restore() {
						reads++;
						if (reads === 2) winner = graph.state(1, { name: "same" });
						return undefined;
					},
				}),
			/duplicate/,
		);
		assert.equal(d.live.size, 0);
		assert.equal(graph.find("same"), winner);
		assert.equal(graph.describe().nodes.length, 1);
		assert.throws(() => restoreStateNodeInGraph(Object.create(graph), "fake"), /unknown graph/);
		releaseGraphNodes(graph, [winner!]);
	});
	for (const rollback of [false, true])
		check(`deferred-adds-${rollback}`, () => {
			const g = new Graph();
			const bus = messageBus(g);
			const a = g.node<MessageBusCommand>();
			const b = g.node<MessageBusCommand>();
			batch((ctx) => {
				bus.commands.down([["DATA", { kind: "declareTopic", topic: "x" }]]);
				attachMessageBusCommandSource(g, bus, a);
				attachMessageBusCommandSource(g, bus, b);
				assert.deepEqual(bus.commands.deps, []);
				if (rollback) ctx.rollback();
			});
			assert.deepEqual(bus.commands.deps, rollback ? [] : [a, b]);
		});
	check("rollback-removal-and-duplicate", () => {
		const g = new Graph();
		const bus = messageBus(g);
		const a = g.node<MessageBusCommand>();
		const remove = attachMessageBusCommandSource(g, bus, a);
		const duplicate = attachMessageBusCommandSource(g, bus, a);
		duplicate();
		assert.deepEqual(bus.commands.deps, [a]);
		batch((ctx) => {
			bus.commands.down([["DATA", { kind: "declareTopic", topic: "x" }]]);
			remove();
			ctx.rollback();
		});
		assert.deepEqual(bus.commands.deps, [a]);
		remove();
		assert.deepEqual(bus.commands.deps, []);
		bus.commands.down([["COMPLETE"]]);
		remove();
		duplicate();
	});
	return passed;
}
