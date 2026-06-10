import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { depLatest } from "../ctx/types.js";
import { releaseGraphNodes } from "../graph/graph.js";
import type {
	Ctx,
	GraphRestoreDescriptor,
	Message,
	RestoreGraphOptions,
	TopologyEvent,
} from "../index.js";
import {
	Dispatcher,
	defaultRestoreRegistry,
	define,
	GRAPH_CHECKPOINT_VERSION,
	graph,
	map,
	Node,
	reactiveIndex,
	reactiveList,
	reactiveLog,
	reactiveMap,
	restoreGraph,
	restoreRegistry,
	strictJsonCodec,
	take,
	timer,
} from "../index.js";

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	n.subscribe((m) => msgs.push(m));
	return msgs;
}
function demand(snapshot: Node<unknown>, pullId: symbol): void {
	snapshot.up([["RESUME", pullId]]);
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
		expect(snap.subgraphs?.[0].nodes.some((n) => n.id === "sub::leaf")).toBe(true);
	});
});

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

	it("fails honestly for non-strict-JSON cache, meta, ctx.state, and terminal payloads", () => {
		const badCache = graph();
		badCache.state(1n, { name: "big" });
		expect(() => badCache.checkpoint()).toThrow(/strict JSON compatible/);

		const badMeta = graph();
		badMeta.state(1, { name: "meta", meta: { f: () => undefined } });
		expect(() => badMeta.checkpoint()).toThrow(/strict JSON compatible/);

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

describe("restoreGraph — fresh graph restore (R-restore / D94 / D95)", () => {
	it("restores named state DATA and pushes it on subscribe after restore", () => {
		const g = graph({ name: "source" });
		const count = g.state(0, { name: "count", meta: { role: "counter" } });
		count.set(7);

		const restored = restoreGraph(g.checkpoint(), { registry: defaultRestoreRegistry });
		const node = restored.find("count");
		expect(node?.cache).toBe(7);
		expect(restored.describe().nodes.find((n) => n.id === "count")).toMatchObject({
			id: "count",
			name: "count",
			factory: "state",
			value: 7,
			meta: { role: "counter" },
		});

		const msgs = collect(node as { subscribe(s: (m: Message) => void): () => void });
		expect(msgs).toEqual([["START"], ["DATA", 7]]);
	});

	it("preserves SENTINEL absence separately from DATA null and empty array", () => {
		const checkpoint = graph().checkpoint();
		checkpoint.nodes = [
			{
				id: "cold",
				name: "cold",
				factory: { kind: "registry-ref", ref: "state" },
				status: "sentinel",
				deps: [],
				value: { kind: "SENTINEL" },
				terminal: { kind: "none" },
				lifecycle: { activated: false, hasCalledFnOnce: false },
				ctxState: { persist: false, value: { kind: "SENTINEL" } },
			},
			{
				id: "nil",
				name: "nil",
				factory: { kind: "registry-ref", ref: "state" },
				status: "settled",
				deps: [],
				value: { kind: "DATA", data: null },
				terminal: { kind: "none" },
				lifecycle: { activated: false, hasCalledFnOnce: false },
				ctxState: { persist: false, value: { kind: "SENTINEL" } },
			},
			{
				id: "empty",
				name: "empty",
				factory: { kind: "registry-ref", ref: "state" },
				status: "settled",
				deps: [],
				value: { kind: "DATA", data: [] },
				terminal: { kind: "none" },
				lifecycle: { activated: false, hasCalledFnOnce: false },
				ctxState: { persist: false, value: { kind: "SENTINEL" } },
			},
		];
		checkpoint.edges = [];

		const restored = restoreGraph(checkpoint, { registry: defaultRestoreRegistry });
		expect(restored.find("cold")?.cache).toBeUndefined();
		expect(
			collect(restored.find("cold") as { subscribe(s: (m: Message) => void): () => void }),
		).toEqual([["START"]]);
		expect(restored.find("nil")?.cache).toBeNull();
		expect(restored.find("empty")?.cache).toEqual([]);
	});

	it("constructs deps in topological order and restores non-persist ctx.state before the first subscriber", () => {
		const original = graph();
		const src = original.state(1, { name: "src" });
		const memo = original.node(
			[src],
			(ctx) => {
				const previous = (ctx.state.get<{ runs: number }>() ?? { runs: 0 }).runs;
				const runs = previous + 1;
				ctx.state.set({ runs });
				ctx.down([["DATA", { runs }]]);
			},
			{
				name: "memo",
				restore: { ref: "memo", config: { mode: "runs" }, configVersion: "1" },
			},
		);
		collect(memo);
		const checkpoint = original.checkpoint();
		const memoNode = checkpoint.nodes.find((n) => n.id === "memo");
		expect(memoNode?.factory).toEqual({
			kind: "registry-ref",
			ref: "memo",
			config: { mode: "runs" },
			configVersion: "1",
		});
		checkpoint.nodes.reverse();

		const memoDescriptor: GraphRestoreDescriptor = {
			ref: "memo",
			validateConfig(config, configVersion) {
				expect(config).toEqual({ mode: "runs" });
				expect(configVersion).toBe("1");
				return config;
			},
			create(ctx) {
				return ctx.registerNode(
					"memo",
					ctx.deps,
					(runCtx) => {
						const previous = (runCtx.state.get<{ runs: number }>() ?? { runs: 0 }).runs;
						const runs = previous + 1;
						runCtx.state.set({ runs });
						runCtx.down([["DATA", { runs }]]);
					},
					{ name: ctx.name },
				);
			},
		};

		const restored = restoreGraph(checkpoint, {
			registry: { ...defaultRestoreRegistry, memo: memoDescriptor },
		});
		const restoredMemo = restored.find("memo");
		expect(restoredMemo?.cache).toEqual({ runs: 1 });
		const msgs = collect(restoredMemo as { subscribe(s: (m: Message) => void): () => void });
		expect(msgs.filter((m) => m[0] === "DATA").map((m) => m[1])).toEqual([{ runs: 1 }]);
		expect(restoredMemo?.cache).toEqual({ runs: 1 });
		(restored.find("src") as { set(v: number): void }).set(2);
		expect(restoredMemo?.cache).toEqual({ runs: 2 });
	});

	it("restores a named function map using D101 define checkpoints", () => {
		const original = graph();
		const src = original.state(1, { name: "src" });
		const inc = define<number, number>("inc", (n) => n + 1);
		const mapped = original.initNode(map(inc), [src], { name: "mapped" });
		collect(mapped);

		const checkpoint = original.checkpoint();
		expect(checkpoint.nodes.find((n) => n.id === "mapped")?.factory).toEqual({
			kind: "registry-ref",
			ref: "map",
			config: { fn: "inc" },
		});

		const reloadedInc = define<number, number>("inc", (n) => n + 10);
		const registry = restoreRegistry([reloadedInc], defaultRestoreRegistry);
		const restored = restoreGraph(checkpoint, { registry });
		expect(restored.find("mapped")?.cache).toBe(2);

		collect(restored.find("mapped") as { subscribe(s: (m: Message) => void): () => void });
		(restored.find("src") as { set(v: number): void }).set(2);
		expect(restored.find("mapped")?.cache).toBe(12);
	});

	it("seeds a restored terminal dep without reopening or throwing from that dep", () => {
		const original = graph();
		const src = original.state(1, { name: "src" });
		const memo = original.node([src], (ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]), {
			name: "memo",
			restore: { ref: "memo" },
			completeWhenDepsComplete: false,
		});
		collect(memo);
		src.down([["COMPLETE"]]);
		expect(memo.cache).toBe(1);

		const memoDescriptor: GraphRestoreDescriptor = {
			ref: "memo",
			create(ctx) {
				return ctx.registerNode(
					"memo",
					ctx.deps,
					(runCtx) => runCtx.down([["DATA", depLatest(runCtx, 0) as number]]),
					{
						name: ctx.name,
						completeWhenDepsComplete: false,
					},
				);
			},
		};

		const restored = restoreGraph(original.checkpoint(), {
			registry: { ...defaultRestoreRegistry, memo: memoDescriptor },
		});
		const msgs = collect(
			restored.find("memo") as { subscribe(s: (m: Message) => void): () => void },
		);

		expect(types(msgs)).toEqual(["START", "DATA"]);
		expect(restored.find("memo")?.cache).toBe(1);
	});

	it("does not seed restored pull dep cache as if it crossed the edge", () => {
		const pullId = Symbol("restore-pull");
		const original = graph();
		original.state(5, { name: "pull", pullId, restore: { ref: "pullState" } });
		original.node([], null, { name: "trigger", restore: { ref: "cold" } });
		original.node(
			[original.find("pull") as never, original.find("trigger") as never],
			(ctx) => {
				ctx.down([["DATA", (depLatest(ctx, 0) as number) + (depLatest(ctx, 1) as number)]]);
			},
			{ name: "joined", restore: { ref: "join" } },
		);

		const pullDescriptor: GraphRestoreDescriptor = {
			ref: "pullState",
			create(ctx) {
				return ctx.registerState({ name: ctx.name, pullId });
			},
		};
		const coldDescriptor: GraphRestoreDescriptor = {
			ref: "cold",
			create(ctx) {
				return ctx.registerNode("cold", [], null, { name: ctx.name });
			},
		};
		const joinDescriptor: GraphRestoreDescriptor = {
			ref: "join",
			create(ctx) {
				return ctx.registerNode("join", ctx.deps, (runCtx) => {
					runCtx.down([
						["DATA", (depLatest(runCtx, 0) as number) + (depLatest(runCtx, 1) as number)],
					]);
				});
			},
		};

		const restored = restoreGraph(original.checkpoint(), {
			registry: {
				...defaultRestoreRegistry,
				pullState: pullDescriptor,
				cold: coldDescriptor,
				join: joinDescriptor,
			},
		});
		const joined = restored.find("joined");
		const msgs = collect(joined as { subscribe(s: (m: Message) => void): () => void });
		expect(types(msgs)).toEqual(["START"]);

		(restored.find("trigger") as { down(msgs: Message[]): void }).down([["DATA", 7]]);
		expect(joined?.cache).toBeUndefined();
	});

	it("lets a restored SENTINEL dep's first activation emit a real post-commit wave", () => {
		const original = graph();
		original.node([], (ctx) => ctx.down([["DATA", 1]]), {
			name: "src",
			restore: { ref: "coldSource" },
		});
		original.node(
			[original.find("src") as never],
			(ctx) => ctx.down([["DATA", (depLatest(ctx, 0) as number) + 1]]),
			{ name: "mapped", restore: { ref: "mapped" } },
		);

		const coldSource: GraphRestoreDescriptor = {
			ref: "coldSource",
			create(ctx) {
				return ctx.registerNode("coldSource", [], (runCtx) => runCtx.down([["DATA", 1]]), {
					name: ctx.name,
				});
			},
		};
		const mappedDescriptor: GraphRestoreDescriptor = {
			ref: "mapped",
			create(ctx) {
				return ctx.registerNode("mapped", ctx.deps, (runCtx) => {
					runCtx.down([["DATA", (depLatest(runCtx, 0) as number) + 1]]);
				});
			},
		};

		const restored = restoreGraph(original.checkpoint(), {
			registry: { ...defaultRestoreRegistry, coldSource, mapped: mappedDescriptor },
		});
		const msgs = collect(
			restored.find("mapped") as { subscribe(s: (m: Message) => void): () => void },
		);

		expect(types(msgs)).toEqual(["START", "DATA"]);
		expect(restored.find("mapped")?.cache).toBe(2);
	});

	it("treats deps added by post-restore pre-activation rewire as fresh deps", () => {
		const original = graph();
		const src = original.state(1, { name: "src" });
		const inc = define<number, number>("restore-rewire.inc", (n) => n + 1);
		const mapped = original.initNode(map(inc), [src], { name: "mapped" });
		collect(mapped);
		expect(mapped.cache).toBe(2);

		const restored = restoreGraph(original.checkpoint(), {
			registry: restoreRegistry([inc], defaultRestoreRegistry),
		});
		const src2 = restored.state(10, { name: "src2" });
		const restoredMapped = restored.find("mapped") as {
			replaceDeps(deps: unknown[], fn: (ctx: Ctx) => void): void;
			subscribe(s: (m: Message) => void): () => void;
		};
		restoredMapped.replaceDeps([src2], (ctx) => {
			ctx.down([["DATA", 11]]);
		});
		const msgs = collect(restoredMapped);

		expect(types(msgs)).toEqual(["START", "DATA", "DATA"]);
		expect(msgs.filter((m) => m[0] === "DATA").map((m) => m[1])).toEqual([2, 11]);
		expect(restored.find("mapped")?.cache).toBe(11);
	});

	it("rejects duplicate definition refs in restore registry (D101)", () => {
		const first = define<number, number>("same", (n) => n + 1);
		const duplicate = define<number, number>("same", (n) => n + 2);
		expect(() => restoreRegistry([first, duplicate], defaultRestoreRegistry)).toThrow(
			/duplicate ref 'same'/,
		);
	});

	it("fails honestly when a restored map config references a missing function definition (D101)", () => {
		const base = graph();
		base.state(1, { name: "src" });
		const checkpoint = base.checkpoint();
		checkpoint.nodes.push({
			id: "mapped",
			name: "mapped",
			factory: { kind: "registry-ref", ref: "map", config: { fn: "missing.inc" } },
			status: "sentinel",
			deps: ["src"],
			value: { kind: "SENTINEL" },
			terminal: { kind: "none" },
			lifecycle: { activated: false, hasCalledFnOnce: false },
			ctxState: { persist: false, value: { kind: "SENTINEL" } },
		});
		checkpoint.edges.push({ from: "src", to: "mapped" });

		expect(() => restoreGraph(checkpoint, { registry: defaultRestoreRegistry })).toThrow(
			/missing function definition for 'missing\.inc'/,
		);
	});

	it("keeps inline closure map local-only while static built-in operators stamp config", () => {
		const g = graph();
		const src = g.state(1, { name: "src" });
		const inline = g.initNode(
			map((n: number) => n + 1),
			[src],
			{ name: "inline" },
		);
		const limited = g.initNode(take<number>(2), [src], { name: "limited" });
		const optOut = g.initNode(take<number>(1), [src], {
			name: "optOut",
			restore: undefined,
		});
		g.initNode(timer(5), [], { name: "once" });
		g.initNode(timer(6, {}), [], { name: "onceDefaultOpts" });
		collect(inline);
		collect(limited);
		collect(optOut);

		const checkpoint = g.checkpoint();
		expect(checkpoint.nodes.find((n) => n.id === "inline")?.factory.kind).toBe("local-only");
		expect(checkpoint.nodes.find((n) => n.id === "optOut")?.factory.kind).toBe("local-only");
		expect(checkpoint.nodes.find((n) => n.id === "limited")?.factory).toEqual({
			kind: "registry-ref",
			ref: "take",
			config: { n: 2 },
		});
		expect(checkpoint.nodes.find((n) => n.id === "once")?.factory).toEqual({
			kind: "registry-ref",
			ref: "timer",
			config: { ms: 5 },
		});
		expect(checkpoint.nodes.find((n) => n.id === "onceDefaultOpts")?.factory).toEqual({
			kind: "registry-ref",
			ref: "timer",
			config: { ms: 6 },
		});
		expect(() => restoreGraph(checkpoint, { registry: defaultRestoreRegistry })).toThrow(
			/local-only/,
		);

		const restorable = graph();
		const rsrc = restorable.state(1, { name: "src" });
		const rtake = restorable.initNode(take<number>(1), [rsrc], { name: "limited" });
		collect(rtake);
		const restored = restoreGraph(restorable.checkpoint(), { registry: defaultRestoreRegistry });
		expect(restored.find("limited")?.cache).toBe(1);
	});

	it("restores built-in take and timer from checkpoint descriptors", () => {
		const restorable = graph();
		const src = restorable.state(1, { name: "src" });
		const limited = restorable.initNode(take<number>(2), [src], { name: "limited" });
		collect(limited);
		restorable.initNode(timer(7), [], { name: "once" });
		restorable.initNode(timer(8, {}), [], { name: "onceDefaultOpts" });
		const checkpoint = restorable.checkpoint();

		expect(checkpoint.nodes.find((n) => n.id === "limited")?.factory).toEqual({
			kind: "registry-ref",
			ref: "take",
			config: { n: 2 },
		});
		expect(checkpoint.nodes.find((n) => n.id === "once")?.factory).toEqual({
			kind: "registry-ref",
			ref: "timer",
			config: { ms: 7 },
		});
		expect(checkpoint.nodes.find((n) => n.id === "onceDefaultOpts")?.factory).toEqual({
			kind: "registry-ref",
			ref: "timer",
			config: { ms: 8 },
		});

		const restored = restoreGraph(checkpoint, { registry: defaultRestoreRegistry });
		const restoredLimited = restored.find("limited");
		const restoredSrc = restored.find("src") as { set(v: number): void };
		const msgs = collect(restoredLimited as { subscribe(s: (m: Message) => void): () => void });
		const restoredOnce = restored.find("once");

		expect(msgs.length >= 1).toBe(true);
		expect(restoredOnce).toBeDefined();
		expect(restoredLimited?.cache).toBe(1);
		restoredSrc.set(2);
		expect(restoredLimited?.cache).toBe(2);
	});

	it("uses restoreGraph dispatcher option for the fresh restored graph (D100)", () => {
		const original = graph();
		const src = original.state(1, { name: "src" });
		const inc = define<number, number>("inc.dispatcher", (n) => n + 1);
		collect(original.initNode(map(inc), [src], { name: "mapped" }));
		const dispatcher = new Dispatcher();
		dispatcher.setRecording(true);

		const restored = restoreGraph(original.checkpoint(), {
			registry: restoreRegistry([inc], defaultRestoreRegistry),
			dispatcher,
		});
		collect(restored.find("mapped") as { subscribe(s: (m: Message) => void): () => void });
		(restored.find("src") as { set(v: number): void }).set(2);
		expect(restored.find("mapped")?.cache).toBe(3);
		expect(dispatcher.totalInvokes).toBeGreaterThan(0);
	});

	it("restores terminal COMPLETE and ERROR state without reopening terminal nodes", () => {
		const g = graph();
		const done = g.state(1, { name: "done" });
		const failed = g.state(2, { name: "failed" });
		done.down([["COMPLETE"]]);
		failed.down([["ERROR", "boom"]]);

		const restored = restoreGraph(g.checkpoint(), { registry: defaultRestoreRegistry });
		expect(restored.find("done")?.status).toBe("completed");
		expect(restored.find("failed")?.status).toBe("errored");
		expect(() => restored.find("done")?.subscribe(() => {})).toThrow(/non-resubscribable/);
		expect(() => restored.find("failed")?.subscribe(() => {})).toThrow(/non-resubscribable/);
	});

	it("checkpoints and restores D109 node runtime versions", () => {
		const hash = testHash;
		const g = graph({ versioning: { level: 1, hash } });
		const src = g.state(1, { name: "src" });
		const v0 = g.state(1, { name: "v0", versioning: 0 });
		const disabled = g.state(1, { name: "disabled", versioning: false });
		src.set(2);
		v0.set(2);
		expect(disabled.version).toBeUndefined();

		const checkpoint = g.checkpoint();
		expect(checkpoint.nodes.find((n) => n.id === "src")?.version).toEqual({
			level: 1,
			counter: 1,
			cid: "h:2",
			prev: "h:1",
		});
		expect(checkpoint.nodes.find((n) => n.id === "v0")?.version).toEqual({
			level: 0,
			counter: 1,
		});
		expect(checkpoint.nodes.find((n) => n.id === "disabled")?.version).toBeUndefined();

		expect(() => restoreGraph(checkpoint, { registry: defaultRestoreRegistry })).toThrow(
			/matching node versioning policy/,
		);
		const restored = restoreGraph(checkpoint, {
			registry: defaultRestoreRegistry,
			versioning: { level: 1, hash },
		});
		expect(restored.find("src")?.version).toEqual({
			level: 1,
			counter: 1,
			cid: "h:2",
			prev: "h:1",
		});
		expect(restored.find("v0")?.version).toEqual({ level: 0, counter: 1 });
		expect(restored.find("disabled")?.version).toBeUndefined();

		(restored.find("src") as { set(v: number): void }).set(3);
		expect(restored.find("src")?.version).toEqual({
			level: 1,
			counter: 2,
			cid: "h:3",
			prev: "h:2",
		});
		(restored.find("v0") as { set(v: number): void }).set(3);
		expect(restored.find("v0")?.version).toEqual({ level: 0, counter: 2 });
		(restored.find("disabled") as { set(v: number): void }).set(3);
		expect(restored.find("disabled")?.version).toBeUndefined();
	});

	it("rejects non-portable V1 DATA before hash, cache, or version mutation (D88/D112)", () => {
		const calls: string[] = [];
		const hash = (bytes: Uint8Array) => {
			const text = decodeTestJsonBytes(bytes);
			calls.push(text);
			return `h:${text}`;
		};
		const g = graph({ versioning: { level: 1, hash } });
		const src = g.state(1, { name: "src" });
		const before = src.version;

		expect(calls).toEqual(["1"]);
		expect(() => src.set(Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe range/);
		expect(src.cache).toBe(1);
		expect(src.version).toEqual(before);
		expect(calls).toEqual(["1"]);
	});

	it("restores V0 checkpoints without requiring a V1 hash lane (D109)", () => {
		const g = graph();
		const src = g.state(1, { name: "src" });
		src.set(2);

		const restored = restoreGraph(g.checkpoint(), { registry: defaultRestoreRegistry });
		expect(restored.find("src")?.version).toEqual({ level: 0, counter: 1 });

		(restored.find("src") as { set(v: number): void }).set(3);
		expect(restored.find("src")?.version).toEqual({ level: 0, counter: 2 });
	});

	it("fails honestly when V1 restore uses the wrong hash lane (D109)", () => {
		const hash = testHash;
		const g = graph({ versioning: { level: 1, hash } });
		g.state({ n: 1 }, { name: "src" });
		const checkpoint = g.checkpoint();

		expect(() =>
			restoreGraph(checkpoint, {
				registry: defaultRestoreRegistry,
				versioning: { level: 1, hash: (bytes) => `other:${decodeTestJsonBytes(bytes)}` },
			}),
		).toThrow(/hash policy/);
	});

	it("distinguishes V1 checkpoint absence from DATA null during restore (D109 / R-restore)", () => {
		const hash = testHash;
		const absentGraph = graph({ versioning: { level: 1, hash } });
		absentGraph.node([], () => {}, { name: "cold" });
		const absentCheckpoint = absentGraph.checkpoint();
		const cold = absentCheckpoint.nodes.find((n) => n.id === "cold");
		if (cold === undefined) throw new Error("missing test node");
		cold.factory = { kind: "registry-ref", ref: "state" };
		cold.value = { kind: "DATA", data: null };

		expect(() =>
			restoreGraph(absentCheckpoint, {
				registry: defaultRestoreRegistry,
				versioning: { level: 1, hash },
			}),
		).toThrow(/hash policy/);

		const nullGraph = graph({ versioning: { level: 1, hash } });
		nullGraph.state(null, { name: "nil" });
		const nullCheckpoint = nullGraph.checkpoint();
		const nil = nullCheckpoint.nodes.find((n) => n.id === "nil");
		if (nil === undefined) throw new Error("missing test node");
		nil.value = { kind: "SENTINEL" };

		expect(() =>
			restoreGraph(nullCheckpoint, {
				registry: defaultRestoreRegistry,
				versioning: { level: 1, hash },
			}),
		).toThrow(/hash policy/);
	});

	it("rejects absent post-DATA V1 checkpoints because the hash lane is unverifiable (D109)", () => {
		const hash = testHash;
		const g = graph({ versioning: { level: 1, hash } });
		const src = g.state(1, { name: "src" });
		src.set(2);
		src.down([["INVALIDATE"]]);
		const checkpoint = g.checkpoint();
		const srcCheckpoint = checkpoint.nodes.find((n) => n.id === "src");
		expect(srcCheckpoint?.value).toEqual({ kind: "SENTINEL" });
		expect(srcCheckpoint?.version).toEqual({
			level: 1,
			counter: 1,
			cid: "h:2",
			prev: "h:1",
		});

		expect(() =>
			restoreGraph(checkpoint, {
				registry: defaultRestoreRegistry,
				versioning: { level: 1, hash },
			}),
		).toThrow(/cannot be verified/);
	});

	it("rejects impossible V1 counter/prev checkpoint metadata (D109)", () => {
		const hash = testHash;
		const g = graph({ versioning: { level: 1, hash } });
		g.state(1, { name: "src" });
		const checkpoint = g.checkpoint();
		const src = checkpoint.nodes.find((n) => n.id === "src");
		if (src === undefined) throw new Error("missing test node");

		src.version = { level: 1, counter: 0, cid: "h:1", prev: "h:0" };
		expect(() =>
			restoreGraph(checkpoint, {
				registry: defaultRestoreRegistry,
				versioning: { level: 1, hash },
			}),
		).toThrow(/prev must be null/);

		src.version = { level: 1, counter: 1, cid: "h:1", prev: null };
		expect(() =>
			restoreGraph(checkpoint, {
				registry: defaultRestoreRegistry,
				versioning: { level: 1, hash },
			}),
		).toThrow(/prev must be a string/);

		src.version = { level: 2, counter: 0 } as unknown as typeof src.version;
		expect(() =>
			restoreGraph(checkpoint, {
				registry: defaultRestoreRegistry,
				versioning: { level: 1, hash },
			}),
		).toThrow(/level must be 0 or 1/);
	});

	it("restores mounted fresh graphs from child-local checkpoints without double-prefixing", () => {
		const parent = graph({ name: "parent" });
		parent.state(1, { name: "root" });
		const child = graph({ name: "child" });
		child.state(2, { name: "leaf" });
		parent.mount(child, { at: "child" });

		const checkpoint = parent.checkpoint();
		expect(checkpoint.mounts?.[0].checkpoint.nodes.map((n) => n.id)).toEqual(["leaf"]);
		const restored = restoreGraph(checkpoint, { registry: defaultRestoreRegistry });
		expect(restored.describe().subgraphs?.[0].nodes.map((n) => n.id)).toEqual(["child::leaf"]);
		expect(restored.describe().subgraphs?.[0].nodes[0]?.value).toBe(2);
	});

	it("rejects missing refs, local-only factories, unknown restore options, duplicate ids, missing deps, and edge mismatches", () => {
		expectTypeOf<RestoreGraphOptions>().not.toHaveProperty("graph");
		const localOnly = graph();
		const src = localOnly.state(1, { name: "src" });
		localOnly.derived([src], (n) => n, { name: "derived" });
		expect(() =>
			restoreGraph(localOnly.checkpoint(), { registry: defaultRestoreRegistry }),
		).toThrow(/local-only/);

		const missingRef = graph();
		missingRef.state(1, { name: "src" });
		expect(() => restoreGraph(missingRef.checkpoint(), { registry: {} })).toThrow(
			/missing registry/,
		);
		expect(() =>
			restoreGraph(missingRef.checkpoint(), {
				dispatcher: new Dispatcher(),
			} as RestoreGraphOptions),
		).toThrow(/registry is required/);

		const target = graph();
		target.state(0, { name: "untouched" });
		expect(() =>
			restoreGraph(missingRef.checkpoint(), {
				registry: defaultRestoreRegistry,
				graph: target,
			} as unknown as RestoreGraphOptions),
		).toThrow(/unknown option 'graph'/);
		expect(target.find("untouched")?.cache).toBe(0);

		const duplicate = missingRef.checkpoint();
		duplicate.nodes.push({ ...duplicate.nodes[0] });
		expect(() => restoreGraph(duplicate, { registry: defaultRestoreRegistry })).toThrow(
			/duplicate node id/,
		);

		const missingDep = missingRef.checkpoint();
		missingDep.nodes[0].deps = ["nope"];
		expect(() => restoreGraph(missingDep, { registry: defaultRestoreRegistry })).toThrow(
			/missing dep/,
		);

		const edgeMismatch = missingRef.checkpoint();
		edgeMismatch.edges = [{ from: "src", to: "src" }];
		expect(() => restoreGraph(edgeMismatch, { registry: defaultRestoreRegistry })).toThrow(
			/not present in target deps/,
		);

		const duplicateEdgeGraph = graph();
		const duplicateEdgeSource = duplicateEdgeGraph.state(1, { name: "src" });
		duplicateEdgeGraph.initNode(take<number>(1), [duplicateEdgeSource], { name: "limited" });
		const duplicateEdge = duplicateEdgeGraph.checkpoint();
		duplicateEdge.edges.push({ ...duplicateEdge.edges[0] });
		expect(() => restoreGraph(duplicateEdge, { registry: defaultRestoreRegistry })).toThrow(
			/duplicate edge/,
		);

		const nonQuiescent = missingRef.checkpoint();
		nonQuiescent.nodes[0].status = "pending";
		expect(() => restoreGraph(nonQuiescent, { registry: defaultRestoreRegistry })).toThrow(
			/non-quiescent status 'pending'/,
		);

		const terminalMismatch = missingRef.checkpoint();
		terminalMismatch.nodes[0].status = "completed";
		terminalMismatch.nodes[0].terminal = { kind: "none" };
		expect(() => restoreGraph(terminalMismatch, { registry: defaultRestoreRegistry })).toThrow(
			/terminal status requires terminal state/,
		);

		const badMountPrefix = graph();
		const child = graph();
		child.state(1, { name: "leaf" });
		badMountPrefix.mount(child, { at: "child" });
		const badMountCheckpoint = badMountPrefix.checkpoint();
		if (badMountCheckpoint.mounts)
			badMountCheckpoint.mounts[0].checkpoint.nodes[0].id = "child::leaf";
		expect(() => restoreGraph(badMountCheckpoint, { registry: defaultRestoreRegistry })).toThrow(
			/child-local node id/,
		);

		const emptyMountPath = badMountPrefix.checkpoint();
		if (emptyMountPath.mounts) emptyMountPath.mounts[0].at = "";
		expect(() => restoreGraph(emptyMountPath, { registry: defaultRestoreRegistry })).toThrow(
			/mount path must not be empty/,
		);
	});

	it("rejects descriptor output whose registered deps do not match the checkpoint", () => {
		const original = graph();
		const src = original.state(1, { name: "src" });
		const memo = original.node([src], (ctx) => ctx.down([["DATA", depLatest(ctx, 0)]]), {
			name: "memo",
			restore: { ref: "memo" },
		});
		collect(memo);

		const badDescriptor: GraphRestoreDescriptor = {
			ref: "memo",
			create(ctx) {
				return ctx.registerNode("memo", [], (runCtx) => {
					runCtx.down([["DATA", "bad"]]);
				});
			},
		};

		expect(() =>
			restoreGraph(original.checkpoint(), {
				registry: { ...defaultRestoreRegistry, memo: badDescriptor },
			}),
		).toThrow(/deps that do not match/);
	});

	it("restores D160 collection backendState while preserving checkpointed runtime", () => {
		const original = graph();
		const list = reactiveList<number>([1], { graph: original, name: "list" });
		list.append(2);
		const index = reactiveIndex<string, number>({ graph: original, name: "idx" });
		index.upsert("a", 1, 10);
		const log = reactiveLog<string>(["a"], { graph: original, name: "log" });
		log.append("b");
		const mapCollection = reactiveMap<string, number>({ graph: original, name: "map" });
		mapCollection.set("k", 42);

		const checkpoint = original.checkpoint();

		const restored = restoreGraph(checkpoint, { registry: defaultRestoreRegistry });
		const byId = Object.fromEntries(restored.checkpoint().nodes.map((n) => [n.id, n]));

		expect(byId["list.delta"].backendState).toEqual([1, 2]);
		expect(byId["list.delta"].value).toEqual({ kind: "SENTINEL" });
		expect(byId["list.snapshot"].value).toEqual({ kind: "SENTINEL" });
		expect(byId["idx.delta"].backendState).toEqual([{ primary: "a", secondary: 1, value: 10 }]);
		expect(byId["idx.delta"].value).toEqual({ kind: "SENTINEL" });
		expect(byId["idx.snapshot"].value).toEqual({ kind: "SENTINEL" });
		expect(byId["log.delta"].backendState).toEqual(["a", "b"]);
		expect(byId["log.delta"].value).toEqual({ kind: "SENTINEL" });
		expect(byId["log.snapshot"].value).toEqual({ kind: "SENTINEL" });
		expect(byId["map.intent"].backendState).toEqual([["k", 42]]);
		expect(byId["map.intent"].value).toEqual({ kind: "SENTINEL" });
		expect(byId["map.delta"].value).toEqual({ kind: "SENTINEL" });
		expect(byId["map.delta"].deps).toEqual(["map.apply", "map.snapshotPrep"]);
		expect(byId["map.snapshot"].deps).toEqual(["map.snapshotPrep"]);
		expect(byId["list.delta"].ctxState.value).toEqual({ kind: "SENTINEL" });
		expect(types(collect(restored.find("list.delta") as Node<unknown>))).toEqual(["START"]);
	});

	it("ignores D160 collection snapshot cache when backendState is authoritative", () => {
		const original = graph();
		const list = reactiveList<number>([1], { graph: original, name: "list" });
		list.append(2);
		const checkpoint = original.checkpoint();
		const listSnapshot = checkpoint.nodes.find((n) => n.id === "list.snapshot");
		if (!listSnapshot) throw new Error("missing list snapshot");
		listSnapshot.value = { kind: "DATA", data: ["not-authority"] };

		const restored = restoreGraph(checkpoint, { registry: defaultRestoreRegistry });
		const byId = Object.fromEntries(restored.checkpoint().nodes.map((n) => [n.id, n]));
		expect(byId["list.delta"].backendState).toEqual([1, 2]);
		expect(byId["list.snapshot"].value).toEqual({ kind: "SENTINEL" });
	});

	it("rejects malformed D160 collection backendState instead of normalizing it", () => {
		const original = graph();
		const index = reactiveIndex<string, number>({ graph: original, name: "idx" });
		index.upsert("a", 1, 10);
		reactiveLog<string>(["a", "b"], { graph: original, name: "log", maxSize: 2 });
		const checkpoint = original.checkpoint();
		const idxDelta = checkpoint.nodes.find((n) => n.id === "idx.delta");
		const logDelta = checkpoint.nodes.find((n) => n.id === "log.delta");
		if (!idxDelta || !logDelta) throw new Error("missing collection nodes");

		idxDelta.backendState = [
			{ primary: "a", secondary: 1, value: 10 },
			{ primary: "a", secondary: 2, value: 20 },
		];
		expect(() => restoreGraph(checkpoint, { registry: defaultRestoreRegistry })).toThrow(
			/duplicates an earlier index row/,
		);

		idxDelta.backendState = [{ primary: "a", secondary: 1, value: 10 }];
		logDelta.backendState = ["a", "b", "c"];
		expect(() => restoreGraph(checkpoint, { registry: defaultRestoreRegistry })).toThrow(
			/backendState exceeds config\.maxSize/,
		);
	});

	it("rejects malformed D160 reactiveMap backendState instead of normalizing it", () => {
		const g = graph();
		reactiveMap<string, number>({ graph: g, name: "map" });
		const checkpoint = g.checkpoint();
		const mapIntent = checkpoint.nodes.find((n) => n.id === "map.intent");
		if (!mapIntent) throw new Error("missing map intent");

		mapIntent.backendState = [["a", 1, "extra"]];
		expect(() => restoreGraph(checkpoint, { registry: defaultRestoreRegistry })).toThrow(
			/must be a \[key, value\] map entry/,
		);

		mapIntent.backendState = [
			["a", 1],
			["a", 2],
		];
		expect(() => restoreGraph(checkpoint, { registry: defaultRestoreRegistry })).toThrow(
			/duplicates an earlier map key/,
		);
	});

	it("fails honestly when D160 reactiveMap checkpoint would lose per-entry TTL", () => {
		const g = graph();
		const mapCollection = reactiveMap<string, number>({ graph: g, name: "map" });
		mapCollection.set("ttl", 1, { ttl: 1000 });

		expect(() => g.checkpoint()).toThrow(/cannot preserve per-entry TTL/);
	});

	it("fails honestly when D160 reactiveMap checkpoint has duplicate strict-JSON keys", () => {
		const g = graph();
		const mapCollection = reactiveMap<{ id: number }, string>({ graph: g, name: "map" });
		mapCollection.set({ id: 1 }, "first");
		mapCollection.set({ id: 1 }, "second");

		expect(() => g.checkpoint()).toThrow(/duplicate strict-JSON keys/);
	});
});
