import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { releaseGraphNodes } from "../graph/graph.js";
import type { Message, TopologyEvent, Wave } from "../index.js";
import {
	Dispatcher,
	defaultRestoreRegistry,
	GRAPH_CHECKPOINT_FORMAT,
	graph,
	Node,
	reactiveIndex,
	reactiveList,
	reactiveLog,
	reactiveMap,
	restoreGraph,
	strictJsonCodec,
} from "../index.js";
import { buildBeside } from "../node/node.js";
import { asState } from "./helpers/as-state.js";
import { rewireOwnedNode } from "./helpers/owned-rewire.js";

function collect(n: { subscribe(s: (msgs: Wave) => void): () => void }) {
	const msgs: Message[] = [];
	n.subscribe((incoming) => {
		for (const m of incoming) {
			msgs.push(m);
		}
	});
	return msgs;
}
function demand(request: Node<true>): void {
	asState(request).set(true);
}
const _types = (msgs: Message[]) => msgs.map((m) => m[0]);
const TEST_JSON_DECODER = new TextDecoder();
const decodeTestJsonBytes = (bytes: Uint8Array) => TEST_JSON_DECODER.decode(bytes);
const _testHash = (bytes: Uint8Array) => `h:${decodeTestJsonBytes(bytes)}`;

describe("Graph.observeTopology — read-only topology egress (D145)", () => {
	it("emits node-registered events from the existing graph registry", () => {
		const g = graph();
		const events: TopologyEvent[] = [];
		const unsub = g.observeTopology().subscribe((event) => events.push(event));

		const source = g.state(1, { name: "source" });
		g.derived([source], (n) => n! + 1, { name: "derived" });

		unsub();
		expect(events).toEqual([
			{ kind: "node-registered", path: "source", deps: [], factory: "state", seq: 0 },
			{
				kind: "node-registered",
				path: "derived",
				deps: ["source"],
				factory: "derived",
				seq: 1,
			},
		]);
	});

	it("emits deps-changed events that match describe-visible live edges", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(2, { name: "b" });
		const d = g.node([a], (ctx) => ctx.down([["DATA", ctx.deps[0].value]]), { name: "d" });
		const events: TopologyEvent[] = [];
		const unsub = g.observeTopology("d").subscribe((event) => events.push(event));

		rewireOwnedNode(d, [b], (ctx) => ctx.down([["DATA", ctx.deps[0].value]]));

		unsub();
		expect(events).toEqual([
			{ kind: "deps-changed", path: "d", prevDeps: ["a"], deps: ["b"], seq: 0 },
		]);
		const snap = g.inspect();
		expect(snap.nodes.find((node) => node.id === "d")?.deps).toEqual(["b"]);
		expect(snap.edges).toContainEqual({ from: "b", to: "d" });
		expect(snap.edges).not.toContainEqual({ from: "a", to: "d" });
	});

	it("emits mount-changed events from the parent graph without creating protocol data", () => {
		const parent = graph();
		const child = graph();
		const events: TopologyEvent[] = [];
		const unsub = parent.observeTopology("sub").subscribe((event) => events.push(event));

		parent.mount(child, { at: "sub" });

		unsub();
		expect(events).toEqual([
			{ kind: "mount-changed", path: "sub", deps: [], factory: "mount", seq: 0 },
		]);
		expect(parent.inspect().subgraphs?.[0].name).toBeUndefined();
		expect(parent.inspect().subgraphs?.[0].nodes).toEqual([]);
	});

	it("forwards mounted child topology events through mount-aware parent paths", () => {
		const parent = graph();
		const child = graph();
		parent.mount(child, { at: "sub" });
		const events: TopologyEvent[] = [];
		const unsub = parent.observeTopology("sub").subscribe((event) => events.push(event));

		const a = child.state(1, { name: "a" });
		const b = child.state(2, { name: "b" });
		const d = child.node([a], (ctx) => ctx.down([["DATA", ctx.deps[0].value]]), {
			name: "d",
		});
		rewireOwnedNode(d, [b], (ctx) => ctx.down([["DATA", ctx.deps[0].value]]));

		unsub();
		expect(events).toEqual([
			{ kind: "node-registered", path: "sub::a", deps: [], factory: "state", seq: 0 },
			{ kind: "node-registered", path: "sub::b", deps: [], factory: "state", seq: 1 },
			{
				kind: "node-registered",
				path: "sub::d",
				deps: ["sub::a"],
				factory: "node",
				seq: 2,
			},
			{
				kind: "deps-changed",
				path: "sub::d",
				prevDeps: ["sub::a"],
				deps: ["sub::b"],
				seq: 3,
			},
		]);
		const snap = parent.inspect();
		expect(snap.subgraphs?.[0].nodes.find((node) => node.id === "sub::d")?.deps).toEqual([
			"sub::b",
		]);
	});

	it("stops forwarding mounted child topology events after parent unsubscribe", () => {
		const parent = graph();
		const child = graph();
		parent.mount(child, { at: "sub" });
		const events: TopologyEvent[] = [];
		const unsub = parent.observeTopology().subscribe((event) => events.push(event));
		unsub();

		child.state(1, { name: "leaf" });

		expect(events).toEqual([]);
	});

	it("does not activate nodes or publish protocol DATA through topology observation", () => {
		const g = graph();
		let runs = 0;
		const cold = g.producer(
			(ctx) => {
				runs += 1;
				ctx.down([["DATA", "ran"]]);
			},
			{ name: "cold" },
		);
		const topologyEvents: string[] = [];
		const protocolEvents: string[] = [];
		const topologyUnsub = g.observeTopology().subscribe((event) => topologyEvents.push(event.kind));

		topologyUnsub();
		expect(runs).toBe(0);
		expect(cold.cache).toBeUndefined();
		expect(topologyEvents).toEqual([]);

		const observeUnsub = g.observe(["cold"], (event) =>
			protocolEvents.push(...event.msgs.map((m) => m[0])),
		);
		observeUnsub();
		expect(runs).toBe(1);
		expect(protocolEvents).toContain("DATA");
		expect(topologyEvents).toEqual([]);
	});

	it("stops producing topology events after unsubscribe", () => {
		const g = graph();
		const events: string[] = [];
		const unsub = g.observeTopology().subscribe((event) => events.push(event.path));
		unsub();

		g.state(1, { name: "later" });

		expect(events).toEqual([]);
	});

	it("delivers nested topology events FIFO and isolates observer failures", () => {
		const g = graph();
		const first: string[] = [];
		const second: string[] = [];
		const late: string[] = [];
		let added = false;
		g.observeTopology().subscribe((event) => {
			first.push(`${event.path}:${event.seq}`);
			try {
				(event as { path: string }).path = "mutated";
			} catch {
				// Event snapshots are immutable read-only egress.
			}
			try {
				(event.deps as unknown as string[]).push("mutated");
			} catch {
				// Event snapshots are immutable read-only egress.
			}
			if (!added) {
				added = true;
				g.observeTopology().subscribe((lateEvent) =>
					late.push(`${lateEvent.path}:${lateEvent.seq}`),
				);
				g.state(2, { name: "nested" });
			}
		});
		g.observeTopology().subscribe((event) => {
			second.push(`${event.path}:${event.seq}`);
			throw new Error("observer failure must not veto topology mutation");
		});

		expect(() => g.state(1, { name: "root" })).not.toThrow();
		expect(g.find("root")).toBeDefined();
		expect(g.find("nested")).toBeDefined();
		expect(first).toEqual(["root:0", "nested:1"]);
		expect(second).toEqual(["root:0", "nested:1"]);
		expect(late).toEqual(["nested:1"]);
	});

	it("does not call a topology observer unsubscribed earlier in the same delivery", () => {
		const g = graph();
		const second: string[] = [];
		let unsubscribeSecond = () => {};
		g.observeTopology().subscribe(() => unsubscribeSecond());
		unsubscribeSecond = g.observeTopology().subscribe((event) => second.push(event.path));

		g.state(1, { name: "root" });

		expect(second).toEqual([]);
	});

	it("emits node-released only after quiescent atomic graph release commits", () => {
		const g = graph();
		const source = g.state(1, { name: "source" });
		const group = g.topologyGroup({ name: "view" });
		const derived = group.derived([source], (n) => n! + 1, { name: "derived" });
		const events: TopologyEvent[] = [];
		const unsub = g.observeTopology("derived").subscribe((event) => events.push(event));

		group.release();

		unsub();
		expect(events).toEqual([
			{
				kind: "node-released",
				path: "derived",
				deps: ["source"],
				factory: "derived",
				seq: 0,
			},
		]);
		expect(g.find("derived")).toBeUndefined();
		expect(g.inspect().nodes.map((node) => node.id)).not.toContain("derived");
		expect(g.checkpoint().nodes.map((node) => node.id)).not.toContain("derived");
		expect(() => derived.subscribe(() => {})).toThrow(/released from its graph lifecycle/);
	});

	it("does not emit node-released or hide topology when release is not quiescent", () => {
		const g = graph();
		const source = g.state(1, { name: "source" });
		const group = g.topologyGroup({ name: "view" });
		const derived = group.derived([source], (n) => n! + 1, { name: "derived" });
		g.derived([derived], (n) => n! + 1, { name: "consumer" });
		const events: TopologyEvent[] = [];
		const unsub = g.observeTopology().subscribe((event) => events.push(event));

		expect(() => group.release()).toThrow(/consumer.*still depends.*derived/);

		unsub();
		expect(events).toEqual([]);
		expect(g.find("derived")).toBe(derived);
		expect(g.inspect().nodes.map((node) => node.id)).toContain("derived");
		expect(g.checkpoint().nodes.map((node) => node.id)).toContain("derived");
	});

	it("emits node-released for committed releases even when cleanup later throws", () => {
		const g = graph();
		const panic = g.state(1, { name: "panic" });
		const later = g.state(2, { name: "later" });
		const panicInternals = panic as unknown as {
			_lifecycle: { activated: boolean };
			_lifetime: { cleanup: (() => void) | undefined };
		};
		const laterInternals = later as unknown as {
			_lifecycle: { activated: boolean };
			_lifetime: { cleanup: (() => void) | undefined };
		};
		let laterCleanupRan = false;
		panicInternals._lifecycle.activated = true;
		panicInternals._lifetime.cleanup = () => {
			throw new Error("cleanup boom");
		};
		laterInternals._lifecycle.activated = true;
		laterInternals._lifetime.cleanup = () => {
			laterCleanupRan = true;
		};
		const events: TopologyEvent[] = [];
		const unsub = g.observeTopology().subscribe((event) => events.push(event));

		expect(() => releaseGraphNodes(g, [panic, later])).toThrow(/cleanup boom/);

		unsub();
		expect(events.map((event) => event.kind)).toEqual(["node-released", "node-released"]);
		expect(events.map((event) => event.path)).toEqual(["panic", "later"]);
		expect(events.map((event) => event.factory)).toEqual(["state", "state"]);
		expect(events.map((event) => event.deps)).toEqual([[], []]);
		expect(events.map((event) => event.seq)).toEqual([0, 1]);
		expect(laterCleanupRan).toBe(true);
		expect(g.find("panic")).toBeUndefined();
		expect(g.find("later")).toBeUndefined();
		expect(g.inspect().nodes.map((node) => node.id)).not.toContain("panic");
		expect(g.inspect().nodes.map((node) => node.id)).not.toContain("later");
		expect(() => panic.subscribe(() => {})).toThrow(/released from its graph lifecycle/);
	});
});

describe("Graph.topologyGroup — graph-owned dynamic topology release (D152/D153)", () => {
	it("creates registered child nodes and releases them atomically from inspection surfaces", () => {
		const g = graph({ dispatcher: new Dispatcher(), profile: true });
		const source = g.state(1, { name: "source" });
		const events: TopologyEvent[] = [];
		const unsub = g.observeTopology().subscribe((event) => events.push(event));
		const group = g.topologyGroup({ name: "view" });

		const delta = group.derived([source], (n) => n! + 1, { name: "view.delta" });
		const snapshot = group.derived([delta], (n) => n! * 2, { name: "view.snapshot" });

		expect(g.find("view.delta")).toBe(delta);
		expect(g.find("view.snapshot")).toBe(snapshot);
		expect(g.inspect().nodes.map((node) => node.id)).toEqual(
			expect.arrayContaining(["source", "view.delta", "view.snapshot"]),
		);
		expect(Object.keys(g.profile().nodes)).toEqual(
			expect.arrayContaining(["source", "view.delta", "view.snapshot"]),
		);
		expect(g.checkpoint().nodes.map((node) => node.id)).toEqual(
			expect.arrayContaining(["source", "view.delta", "view.snapshot"]),
		);

		group.release();
		group.release();
		unsub();

		expect(group.released).toBe(true);
		expect(events).toEqual([
			{
				kind: "node-registered",
				path: "view.delta",
				deps: ["source"],
				factory: "derived",
				seq: 0,
			},
			{
				kind: "node-registered",
				path: "view.snapshot",
				deps: ["view.delta"],
				factory: "derived",
				seq: 1,
			},
			{
				kind: "node-released",
				path: "view.delta",
				deps: ["source"],
				factory: "derived",
				seq: 2,
			},
			{
				kind: "node-released",
				path: "view.snapshot",
				deps: ["view.delta"],
				factory: "derived",
				seq: 3,
			},
		]);
		expect(g.find("view.delta")).toBeUndefined();
		expect(g.find("view.snapshot")).toBeUndefined();
		expect(g.inspect().nodes.map((node) => node.id)).not.toContain("view.delta");
		expect(Object.keys(g.profile().nodes)).not.toContain("view.delta");
		expect(g.checkpoint().nodes.map((node) => node.id)).not.toContain("view.delta");
		expect(() => g.state(0, { name: "view.delta" })).toThrow(/released/);
		expect(() => group.node([], null, { name: "late" })).toThrow(/released/);
		expect(g.find("late")).toBeUndefined();
	});

	it("add only accepts ordinary graph-registered nodes from the owning graph", () => {
		const g = graph();
		const group = g.topologyGroup({ name: "view" });
		const registered = g.state(1, { name: "registered" });
		expect(group.add(registered)).toBe(registered);
		expect(group.add(registered)).toBe(registered);

		const other = graph().state(1, { name: "other" });
		expect(() => group.add(other)).toThrow(/different graph/);

		// An unregistered node of the same graph (R-graph-domain@3: no node is standalone).
		const bare = buildBeside(registered, () => new Node([], null));
		expect(() => group.add(bare)).toThrow(/not a registered graph node/);
	});

	it("rejects release while an external live subscriber points into the group and can retry", () => {
		const g = graph();
		const group = g.topologyGroup({ name: "view" });
		const child = group.state(1, { name: "view.child" });
		const unsub = child.subscribe(() => {});

		expect(() => group.release()).toThrow(/live subscribers/);
		expect(group.released).toBe(false);
		expect(g.find("view.child")).toBe(child);

		unsub();
		group.release();
		expect(group.released).toBe(true);
		expect(g.find("view.child")).toBeUndefined();
	});
});

describe("Graph.checkpoint — data shape (R-checkpoint / D802, TS layout D178)", () => {
	it("returns a strict-JSON checkpoint with topology, values, lifetimes and mounts", () => {
		const parent = graph({ name: "parent" });
		const count = parent.state(0, { name: "count" });
		const doubled = parent.derived([count], (n) => n! * 2, { name: "doubled" });
		collect(doubled);
		count.set(5);
		const child = graph({ name: "child" });
		child.state(null, { name: "nil" });
		parent.mount(child, { at: "child" });

		const checkpoint = parent.checkpoint();
		expect(checkpoint.format).toBe(GRAPH_CHECKPOINT_FORMAT);
		expect(() => strictJsonCodec.encode(checkpoint)).not.toThrow();
		const byId = Object.fromEntries(checkpoint.nodes.map((n) => [n.id, n]));
		expect(byId.count).toMatchObject({ kind: "state", factory: "state", values: [5] });
		expect(byId.count.recipe).toBeUndefined();
		expect(byId.doubled).toMatchObject({ kind: "computed", values: [10], deps: ["count"] });
		// No recipe: local-only.
		expect(byId.doubled.recipe).toBeUndefined();
		expect(byId.doubled.lifetime).toEqual({
			received: [{ values: [5], terminal: { kind: "none" } }],
		});
		expect(checkpoint.mounts?.[0].at).toBe("child");
		expect(checkpoint.mounts?.[0].checkpoint.nodes[0]).toMatchObject({ id: "nil", values: [null] });
	});

	it("saves a lifetime that ran without sending a value", () => {
		const g = graph();
		const quiet = g.producer(() => {}, { name: "quiet" });
		collect(quiet);

		const node = g.checkpoint().nodes.find((n) => n.id === "quiet");
		expect(node?.values).toEqual([]);
		expect(node?.lifetime).toEqual({ received: [] });
	});

	it("keeps no value apart from null and an empty array; an inactive computed node holds nothing", () => {
		const g = graph();
		const src = g.state(0, { name: "src" });
		g.derived([src], (n) => n, { name: "cold" });
		g.state(null, { name: "nil" });
		g.state([], { name: "empty" });

		const byId = Object.fromEntries(g.checkpoint().nodes.map((n) => [n.id, n]));
		expect(byId.cold.values).toEqual([]);
		expect(byId.cold.lifetime).toBeUndefined();
		expect(byId.nil.values).toEqual([null]);
		expect(byId.empty.values).toEqual([[]]);
	});

	it("saves an active node's private state", () => {
		const g = graph();
		const src = g.state(1, { name: "src" });
		const memo = g.node(
			[src],
			(ctx) => {
				ctx.state.set({ latest: ctx.deps[0].value, runs: 1 });
				ctx.down([["DATA", "ok"]]);
			},
			{ name: "memo" },
		);
		collect(memo);

		const node = g.checkpoint().nodes.find((n) => n.id === "memo");
		expect(node?.lifetime?.state).toEqual({ latest: 1, runs: 1 });
	});

	it("discriminates COMPLETE and ERROR terminal state when represented", () => {
		const g = graph();
		const done = g.state(1, { name: "done" });
		const failed = g.state(2, { name: "failed" });
		done.complete();
		failed.error("boom");

		const byId = Object.fromEntries(g.checkpoint().nodes.map((n) => [n.id, n]));
		expect(byId.done.terminal).toEqual({ kind: "COMPLETE" });
		expect(byId.failed.terminal).toEqual({ kind: "ERROR", error: "boom" });
	});

	it("fails honestly for non-strict-JSON values, private state and terminal payloads", () => {
		const badCache = graph();
		badCache.state(1n, { name: "big" });
		expect(() => badCache.checkpoint()).toThrow(
			"not restorable: big: its retained values are not JSON",
		);

		const badString = graph();
		badString.state("\ud800", { name: "surrogate" });
		expect(() => badString.checkpoint()).toThrow(
			"not restorable: surrogate: its retained values are not JSON",
		);

		const badName = graph();
		badName.state(1, { name: "\ud800" });
		expect(() => badName.checkpoint()).toThrow(/^not restorable: .*: its id is not JSON$/);

		const badCtxState = graph();
		const src = badCtxState.state(1, { name: "src" });
		const memo = badCtxState.node(
			[src],
			(ctx) => {
				ctx.state.set(Symbol("nope"));
				ctx.down([["DATA", "ok"]]);
			},
			{ name: "memo" },
		);
		collect(memo);
		expect(() => badCtxState.checkpoint()).toThrow(
			"not restorable: memo: its private state is not JSON",
		);

		const badTerminal = graph();
		const failed = badTerminal.state(1, { name: "failed" });
		failed.error(new Error("not-json"));
		expect(() => badTerminal.checkpoint()).toThrow(
			"not restorable: failed: its ERROR payload is not JSON",
		);
	});

	it("rejects duplicate ids and cyclic mounts instead of producing ambiguous checkpoints", () => {
		const duplicate = graph();
		duplicate.state(1, { name: "same" });
		expect(() => duplicate.state(2, { name: "same" })).toThrow(/duplicate node id/);

		const cyclic = graph();
		cyclic.mount(cyclic, { at: "self" });
		expect(() => cyclic.checkpoint()).toThrow(/cyclic graph mount/);
	});

	it("refuses a capture inside a wave, as one leg of a diamond runs (R-checkpoint)", () => {
		const g = graph();
		const source = g.state(1, { name: "source" });
		// A pending mark never outlives its wave (R-wave), so a node is "dirty" only mid-wave: here
		// one leg of a diamond checkpoints while the other leg and the fan-in are still pending.
		let midWave: unknown;
		const left = g.node<number>(
			[source],
			(ctx) => {
				const v = ctx.deps[0].value as number;
				if (v === 2 && midWave === undefined) {
					try {
						g.checkpoint();
						midWave = "no error";
					} catch (e) {
						midWave = e;
					}
				}
				ctx.down([["DATA", v]]);
			},
			{ name: "left" },
		);
		const right = g.node<number>(
			[source],
			(ctx) => ctx.down([["DATA", ctx.deps[0].value as number]]),
			{
				name: "right",
			},
		);
		const join = g.node<number>(
			[left, right],
			(ctx) => ctx.down([["DATA", (ctx.deps[0].value as number) + (ctx.deps[1].value as number)]]),
			{ name: "join" },
		);
		join.subscribe(() => {});
		source.set(2);
		expect(String(midWave)).toMatch(/wave boundary/);
	});

	it("keeps graph checkpoint strict JSON validation independent from storage codecs (D96)", () => {
		const source = readFileSync(new URL("../graph/checkpoint.ts", import.meta.url), "utf8");
		expect(source).not.toContain("../storage/codec.js");
	});

	it("saves a collection's backend in backendState, not in private state (TS extension)", () => {
		const g = graph();
		const list = reactiveList<number>(g, [1], { name: "list" });
		list.append(2);
		const index = reactiveIndex<string, number>(g, { name: "idx" });
		index.upsert("b", 2, 20);
		index.upsert("a", 1, 10);
		const log = reactiveLog<string>(g, ["a"], { name: "log", maxSize: 3 });
		log.append("b");

		const byId = Object.fromEntries(g.checkpoint().nodes.map((n) => [n.id, n]));
		expect(byId["list.delta"].recipe).toEqual({ ref: "reactiveList.delta" });
		expect(byId["list.delta"].backendState).toEqual([1, 2]);
		expect(byId["list.delta"].lifetime).toBeUndefined();
		expect(byId["list.snapshot"].recipe).toEqual({ ref: "reactiveList.snapshot" });
		expect(byId["list.snapshot"].backendState).toBeUndefined();

		expect(byId["idx.delta"].backendState).toEqual([
			{ primary: "a", secondary: 1, value: 10 },
			{ primary: "b", secondary: 2, value: 20 },
		]);
		expect(byId["log.delta"].recipe).toEqual({ ref: "reactiveLog.delta", config: { maxSize: 3 } });
		expect(byId["log.delta"].backendState).toEqual(["a", "b"]);
	});

	it("does not save a collection's helper values or lifetimes; its backend is the authority", () => {
		const g = graph();
		const list = reactiveList<number>(g, [1], { name: "list" });
		const mapCollection = reactiveMap<string, number>(g, { name: "map" });
		mapCollection.set("k", 42);
		collect(list.snapshot);
		collect(mapCollection.snapshot);
		demand(list.request);
		demand(mapCollection.request);

		const checkpoint = g.checkpoint();
		expect(() => strictJsonCodec.encode(checkpoint)).not.toThrow();
		const byId = Object.fromEntries(checkpoint.nodes.map((n) => [n.id, n]));
		expect(byId["list.delta"].backendState).toEqual([1]);
		expect(byId["list.snapshot"].values).toEqual([]);
		expect(byId["list.snapshot"].lifetime).toBeUndefined();
		expect(byId["map.intent"].backendState).toEqual([["k", 42]]);
		expect(byId["map.snapshotPrep"].values).toEqual([]);
		expect(byId["map.snapshot"].values).toEqual([]);
	});

	it("fails honestly when a collection backendState is not strict JSON", () => {
		const g = graph();
		reactiveList(g, [1n], { name: "big" });

		expect(() => g.checkpoint()).toThrow(
			"not restorable: big.delta: its retained values are not JSON",
		);
	});

	it("fails honestly when a reactiveIndex primary key cannot restore through D160", () => {
		const g = graph();
		const index = reactiveIndex<{ id: string }, number>(g, { name: "idx" });
		index.upsert({ id: "a" }, 1, 10);

		expect(() => g.checkpoint()).toThrow(/backendState\[0\]\.primary.*JSON primitive/);
	});

	it("gives deferred collection policy variants no recipe, so they are local-only", () => {
		const g = graph();
		reactiveList<number>(g, [], { name: "capped", maxSize: 2 });
		reactiveIndex<string, number>(g, {
			name: "limited",
			capacity: { order: "primary", maxSize: 2 },
		});

		const byId = Object.fromEntries(g.checkpoint().nodes.map((n) => [n.id, n]));
		expect(byId["capped.snapshot"].recipe).toBeUndefined();
		expect(byId["limited.snapshot"].recipe).toBeUndefined();
		expect(() => restoreGraph(g.checkpoint(), { registry: defaultRestoreRegistry })).toThrow(
			/local-only/,
		);
	});
});

describe("Graph release-local subscriber accounting — D122/D124", () => {
	it("counts real active fan-out/fan-in subscriptions and preserves the rejected group", () => {
		const g = graph({ dispatcher: new Dispatcher(), profile: true });
		const group = g.topologyGroup({ name: "diamond" });
		const a = group.state(2, { name: "a" });
		const b = group.state(3, { name: "b" });
		const left = group.derived([a, b], (x, y) => x! + y!, { name: "left" });
		const right = group.derived([a, b], (x, y) => x! * y!, { name: "right" });
		const join = group.derived([left, right], (x, y) => x! + y!, { name: "join" });
		const messages: Message[] = [];
		const disconnect = join.subscribe((incoming) => {
			for (const m of incoming) {
				messages.push(m);
			}
		});
		expect(messages).toContainEqual(["DATA", 11]);
		const before = g.inspect();
		const events: TopologyEvent[] = [];
		const stopEvents = g.observeTopology().subscribe((e) => events.push(e));

		// a,b,left,right have internal subscribers: only the final sink prevents release.
		expect(() => group.release()).toThrow(/'join' still has live subscribers/);
		expect(g.inspect()).toEqual(before);
		expect(group.released).toBe(false);
		expect(events).toEqual([]);
		// Live topology changes after rejection must be read again on the next attempt.
		rewireOwnedNode(join, [a], (ctx) => ctx.down([["DATA", ctx.deps[0].value]]));
		expect(join.deps).toEqual([a]);
		expect(() => group.release()).toThrow(/'join' still has live subscribers/);
		disconnect();
		events.length = 0;
		group.release();
		group.release();
		expect(events.map((e) => e.kind)).toEqual(Array(5).fill("node-released"));
		expect(g.inspect().nodes).toEqual([]);
		expect(Object.keys(g.profile().nodes)).toEqual([]);
		expect(g.checkpoint().nodes).toEqual([]);
		for (const name of ["a", "b", "left", "right", "join"]) {
			expect(g.find(name)).toBeUndefined();
			expect(() => g.state(0, { name })).toThrow(/released/);
		}
		stopEvents();
	});

	it("keeps competing subscriber/quiescence errors in requested entry order", () => {
		const g = graph();
		const first = g.state(1, { name: "first" });
		const later = g.node([], null, { name: "later" });
		const disconnect = first.subscribe(() => {});
		const before = g.inspect();
		expect(() => releaseGraphNodes(g, [first, first, later])).toThrow(
			/'first' still has live subscribers/,
		);
		expect(g.inspect()).toEqual(before);
		disconnect();
	});

	it("keeps external dependency rejection before internal subscriber errors", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.node([], null, { name: "b" });
		g.derived([b], (x) => x, { name: "outside" });
		const disconnect = a.subscribe(() => {});
		const before = g.inspect();
		expect(() => releaseGraphNodes(g, [a, b])).toThrow(/'outside' still depends on 'b'/);
		expect(g.inspect()).toEqual(before);
		disconnect();
	});
});
