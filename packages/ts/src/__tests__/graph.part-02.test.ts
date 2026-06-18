import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { depLatest } from "../ctx/types.js";
import { releaseGraphNodes } from "../graph/graph.js";
import type { Message, TopologyEvent } from "../index.js";
import {
	Dispatcher,
	defaultRestoreRegistry,
	GRAPH_CHECKPOINT_VERSION,
	graph,
	Node,
	reactiveIndex,
	reactiveList,
	reactiveLog,
	reactiveMap,
	restoreGraph,
	strictJsonCodec,
} from "../index.js";

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	n.subscribe((m) => msgs.push(m));
	return msgs;
}
function demand(snapshot: Node<unknown>, pullId: symbol): void {
	snapshot.up([["PULL", { pullId }]]);
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
		g.derived([source], (n) => n + 1, { name: "derived" });

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
		const d = g.node([a], (ctx) => ctx.down([["DATA", depLatest(ctx, 0)]]), { name: "d" });
		const events: TopologyEvent[] = [];
		const unsub = g.observeTopology("d").subscribe((event) => events.push(event));

		d.replaceDeps([b], (ctx) => ctx.down([["DATA", depLatest(ctx, 0)]]));

		unsub();
		expect(events).toEqual([
			{ kind: "deps-changed", path: "d", prevDeps: ["a"], deps: ["b"], seq: 0 },
		]);
		const snap = g.describe();
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
		expect(parent.describe().subgraphs?.[0].name).toBeUndefined();
		expect(parent.describe().subgraphs?.[0].nodes).toEqual([]);
	});

	it("forwards mounted child topology events through mount-aware parent paths", () => {
		const parent = graph();
		const child = graph();
		parent.mount(child, { at: "sub" });
		const events: TopologyEvent[] = [];
		const unsub = parent.observeTopology("sub").subscribe((event) => events.push(event));

		const a = child.state(1, { name: "a" });
		const b = child.state(2, { name: "b" });
		const d = child.node([a], (ctx) => ctx.down([["DATA", depLatest(ctx, 0)]]), {
			name: "d",
		});
		d.replaceDeps([b], (ctx) => ctx.down([["DATA", depLatest(ctx, 0)]]));

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
		const snap = parent.describe();
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

		const observeUnsub = g.observe("cold").subscribe((event) => protocolEvents.push(event.msg[0]));
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
		const derived = group.derived([source], (n) => n + 1, { name: "derived" });
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
		expect(g.describe().nodes.map((node) => node.id)).not.toContain("derived");
		expect(g.checkpoint().nodes.map((node) => node.id)).not.toContain("derived");
		expect(() => derived.subscribe(() => {})).toThrow(/released from its graph lifecycle/);
	});

	it("does not emit node-released or hide topology when release is not quiescent", () => {
		const g = graph();
		const source = g.state(1, { name: "source" });
		const group = g.topologyGroup({ name: "view" });
		const derived = group.derived([source], (n) => n + 1, { name: "derived" });
		g.derived([derived], (n) => n + 1, { name: "consumer" });
		const events: TopologyEvent[] = [];
		const unsub = g.observeTopology().subscribe((event) => events.push(event));

		expect(() => group.release()).toThrow(/consumer.*still depends.*derived/);

		unsub();
		expect(events).toEqual([]);
		expect(g.find("derived")).toBe(derived);
		expect(g.describe().nodes.map((node) => node.id)).toContain("derived");
		expect(g.checkpoint().nodes.map((node) => node.id)).toContain("derived");
	});

	it("emits node-released for committed releases even when cleanup later throws", () => {
		const g = graph();
		const panic = g.state(1, { name: "panic" });
		const later = g.state(2, { name: "later" });
		const panicInternals = panic as unknown as {
			_lifecycle: { activated: boolean };
			_hooks: { onDeactivation: Array<() => void> };
		};
		const laterInternals = later as unknown as {
			_lifecycle: { activated: boolean };
			_hooks: { onDeactivation: Array<() => void> };
		};
		let laterCleanupRan = false;
		panicInternals._lifecycle.activated = true;
		panicInternals._hooks.onDeactivation.push(() => {
			throw new Error("cleanup boom");
		});
		laterInternals._lifecycle.activated = true;
		laterInternals._hooks.onDeactivation.push(() => {
			laterCleanupRan = true;
		});
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
		expect(g.describe().nodes.map((node) => node.id)).not.toContain("panic");
		expect(g.describe().nodes.map((node) => node.id)).not.toContain("later");
		expect(() => panic.subscribe(() => {})).toThrow(/released from its graph lifecycle/);
	});

	it("rejects release while a node's own status is dirty", () => {
		const g = graph();
		const group = g.topologyGroup({ name: "view" });
		const dirty = group.node([], null, { name: "dirty" });
		const events: TopologyEvent[] = [];
		const unsub = g.observeTopology().subscribe((event) => events.push(event));

		dirty.down([["DIRTY"]]);

		expect(dirty.status).toBe("dirty");
		expect(() => group.release()).toThrow(/not runtime-quiescent/);
		unsub();
		expect(events).toEqual([]);
		expect(g.find("dirty")).toBe(dirty);
		expect(g.describe().nodes.map((node) => node.id)).toContain("dirty");
	});
});

describe("Graph.topologyGroup — graph-owned dynamic topology release (D152/D153)", () => {
	it("creates registered child nodes and releases them atomically from inspection surfaces", () => {
		const g = graph({ dispatcher: new Dispatcher(), profile: true });
		const source = g.state(1, { name: "source" });
		const events: TopologyEvent[] = [];
		const unsub = g.observeTopology().subscribe((event) => events.push(event));
		const group = g.topologyGroup({ name: "view" });

		const delta = group.derived([source], (n) => n + 1, { name: "view.delta" });
		const snapshot = group.derived([delta], (n) => n * 2, { name: "view.snapshot" });

		expect(g.find("view.delta")).toBe(delta);
		expect(g.find("view.snapshot")).toBe(snapshot);
		expect(g.describe().nodes.map((node) => node.id)).toEqual(
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
		expect(g.describe().nodes.map((node) => node.id)).not.toContain("view.delta");
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

		const bare = new Node([], null);
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

describe("Graph.checkpoint — public data shape (R-snapshot / D83 / D90)", () => {
	it("returns a versioned strict-JSON-compatible checkpoint with live topology and mounts", () => {
		const parent = graph({ name: "parent" });
		const count = parent.state(0, { name: "count" });
		const doubled = parent.derived([count], (n) => n * 2, { name: "doubled" });
		collect(doubled);
		count.set(5);
		const child = graph({ name: "child" });
		child.state(null, { name: "nil" });
		parent.mount(child, { at: "child" });

		const checkpoint = parent.checkpoint();
		expect(checkpoint.version).toBe(GRAPH_CHECKPOINT_VERSION);
		expect(() => strictJsonCodec.encode(checkpoint)).not.toThrow();
		const byId = Object.fromEntries(checkpoint.nodes.map((n) => [n.id, n]));
		expect(byId.count.factory).toEqual({ kind: "registry-ref", ref: "state" });
		expect(byId.count.value).toEqual({ kind: "DATA", data: 5 });
		expect(byId.doubled.factory.kind).toBe("local-only");
		expect(byId.doubled.value).toEqual({ kind: "DATA", data: 10 });
		expect(byId.doubled.deps).toEqual(["count"]);
		expect(byId.doubled.lifecycle.hasCalledFnOnce).toBe(true);
		expect(checkpoint.edges).toContainEqual({ from: "count", to: "doubled" });
		expect(checkpoint.mounts?.[0].at).toBe("child");
		expect(checkpoint.mounts?.[0].checkpoint.nodes[0]).toMatchObject({
			id: "nil",
			value: { kind: "DATA", data: null },
		});
	});

	it("captures ran-but-SENTINEL lifecycle state explicitly", () => {
		const g = graph();
		const quiet = g.producer(() => {}, { name: "quiet" });
		collect(quiet);

		const node = g.checkpoint().nodes.find((n) => n.id === "quiet");
		expect(node?.value).toEqual({ kind: "SENTINEL" });
		expect(node?.lifecycle).toEqual({ activated: true, hasCalledFnOnce: true });
	});

	it("uses explicit SENTINEL/DATA discriminants for absence, null, and empty arrays", () => {
		const g = graph();
		const src = g.state(0, { name: "src" });
		g.derived([src], (n) => n, { name: "cold" });
		g.state(null, { name: "nil" });
		g.state([], { name: "empty" });

		const byId = Object.fromEntries(g.checkpoint().nodes.map((n) => [n.id, n]));
		expect(byId.cold.value).toEqual({ kind: "SENTINEL" });
		expect(byId.nil.value).toEqual({ kind: "DATA", data: null });
		expect(byId.empty.value).toEqual({ kind: "DATA", data: [] });
	});

	it("captures node-private ctx.state even when the state is non-persist", () => {
		const g = graph();
		const src = g.state(1, { name: "src" });
		const memo = g.node(
			[src],
			(ctx) => {
				ctx.state.set({ latest: depLatest(ctx, 0), runs: 1 });
				ctx.down([["DATA", "ok"]]);
			},
			{ name: "memo" },
		);
		collect(memo);

		const node = g.checkpoint().nodes.find((n) => n.id === "memo");
		expect(node?.ctxState).toEqual({
			persist: false,
			value: { kind: "DATA", data: { latest: 1, runs: 1 } },
		});
	});

	it("discriminates COMPLETE and ERROR terminal state when represented", () => {
		const g = graph();
		const done = g.state(1, { name: "done" });
		const failed = g.state(2, { name: "failed" });
		done.down([["COMPLETE"]]);
		failed.down([["ERROR", "boom"]]);

		const byId = Object.fromEntries(g.checkpoint().nodes.map((n) => [n.id, n]));
		expect(byId.done.terminal).toEqual({ kind: "COMPLETE" });
		expect(byId.failed.terminal).toEqual({ kind: "ERROR", error: "boom" });
	});

	it("fails honestly for non-strict-JSON cache, ctx.state, and terminal payloads", () => {
		const badCache = graph();
		badCache.state(1n, { name: "big" });
		expect(() => badCache.checkpoint()).toThrow(/strict JSON compatible/);

		const badString = graph();
		badString.state("\ud800", { name: "surrogate" });
		expect(() => badString.checkpoint()).toThrow(/strict JSON compatible/);

		const badName = graph();
		badName.state(1, { name: "\ud800" });
		expect(() => badName.checkpoint()).toThrow(/strict JSON compatible/);

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
		expect(() => badCtxState.checkpoint()).toThrow(/strict JSON compatible/);

		const badTerminal = graph();
		const failed = badTerminal.state(1, { name: "failed" });
		failed.down([["ERROR", new Error("not-json")]]);
		expect(() => badTerminal.checkpoint()).toThrow(/strict JSON compatible/);
	});

	it("rejects duplicate ids and cyclic mounts instead of producing ambiguous checkpoints", () => {
		const duplicate = graph();
		duplicate.state(1, { name: "same" });
		expect(() => duplicate.state(2, { name: "same" })).toThrow(/duplicate node id/);

		const cyclic = graph();
		cyclic.mount(cyclic, { at: "self" });
		expect(() => cyclic.checkpoint()).toThrow(/cyclic graph mount/);
	});

	it("rejects non-quiescent checkpoint statuses that cannot be restored yet", () => {
		const g = graph();
		const source = g.state(1, { name: "source" });
		source.down([["DIRTY"]]);

		expect(() => g.checkpoint()).toThrow(/non-quiescent status 'dirty'/);
	});

	it("keeps graph checkpoint strict JSON validation independent from storage codecs (D96)", () => {
		const source = readFileSync(new URL("../graph/checkpoint.ts", import.meta.url), "utf8");
		expect(source).not.toContain("../storage/codec.js");
	});

	it("captures D160 collection backendState without mirroring it into ctx.state", () => {
		const g = graph();
		const list = reactiveList<number>([1], { graph: g, name: "list" });
		list.append(2);
		const index = reactiveIndex<string, number>({ graph: g, name: "idx" });
		index.upsert("b", 2, 20);
		index.upsert("a", 1, 10);
		const log = reactiveLog<string>(["a"], { graph: g, name: "log", maxSize: 3 });
		log.append("b");

		const byId = Object.fromEntries(g.checkpoint().nodes.map((n) => [n.id, n]));
		expect(byId["list.delta"].factory).toEqual({
			kind: "registry-ref",
			ref: "reactiveList.delta",
		});
		expect(byId["list.delta"].backendState).toEqual([1, 2]);
		expect(byId["list.delta"].ctxState.value).toEqual({ kind: "SENTINEL" });
		expect(byId["list.snapshot"].factory).toEqual({
			kind: "registry-ref",
			ref: "reactiveList.snapshot",
		});
		expect(byId["list.snapshot"].backendState).toBeUndefined();

		expect(byId["idx.delta"].backendState).toEqual([
			{ primary: "a", secondary: 1, value: 10 },
			{ primary: "b", secondary: 2, value: 20 },
		]);
		expect(byId["log.delta"].factory).toEqual({
			kind: "registry-ref",
			ref: "reactiveLog.delta",
			config: { maxSize: 3 },
		});
		expect(byId["log.delta"].backendState).toEqual(["a", "b"]);
	});

	it("treats D160 collection snapshot caches as non-authoritative checkpoint state", () => {
		const g = graph();
		const list = reactiveList<number>([1], { graph: g, name: "list" });
		const mapCollection = reactiveMap<string, number>({ graph: g, name: "map" });
		mapCollection.set("k", 42);
		collect(list.snapshot);
		collect(mapCollection.snapshot);
		demand(list.snapshot as Node<unknown>, list.pullId);
		demand(mapCollection.snapshot as Node<unknown>, mapCollection.pullId);

		const checkpoint = g.checkpoint();
		expect(() => strictJsonCodec.encode(checkpoint)).not.toThrow();
		const byId = Object.fromEntries(checkpoint.nodes.map((n) => [n.id, n]));
		expect(byId["list.delta"].backendState).toEqual([1]);
		expect(byId["list.snapshot"].value).toEqual({ kind: "SENTINEL" });
		expect(byId["map.intent"].backendState).toEqual([["k", 42]]);
		expect(byId["map.snapshotPrep"].value).toEqual({ kind: "SENTINEL" });
		expect(byId["map.snapshot"].value).toEqual({ kind: "SENTINEL" });
	});

	it("fails honestly when a collection backendState is not strict JSON", () => {
		const g = graph();
		reactiveList([1n], { graph: g, name: "big" });

		expect(() => g.checkpoint()).toThrow(/big\.delta\.backendState.*strict JSON compatible/);
	});

	it("fails honestly when a reactiveIndex primary key cannot restore through D160", () => {
		const g = graph();
		const index = reactiveIndex<{ id: string }, number>({ graph: g, name: "idx" });
		index.upsert({ id: "a" }, 1, 10);

		expect(() => g.checkpoint()).toThrow(/backendState\[0\]\.primary.*JSON primitive/);
	});

	it("marks deferred collection policy variants local-only instead of advertising restore", () => {
		const g = graph();
		reactiveList<number>([], { graph: g, name: "capped", maxSize: 2 });
		reactiveIndex<string, number>({
			graph: g,
			name: "limited",
			capacity: { order: "primary", maxSize: 2 },
		});

		const byId = Object.fromEntries(g.checkpoint().nodes.map((n) => [n.id, n]));
		expect(byId["capped.delta"].factory).toMatchObject({
			kind: "local-only",
			reason: expect.stringMatching(/no backend checkpoint restore metadata/),
		});
		expect(byId["limited.delta"].factory).toMatchObject({
			kind: "local-only",
			reason: expect.stringMatching(/no backend checkpoint restore metadata/),
		});
		expect(() => restoreGraph(g.checkpoint(), { registry: defaultRestoreRegistry })).toThrow(
			/local-only/,
		);
	});
});
