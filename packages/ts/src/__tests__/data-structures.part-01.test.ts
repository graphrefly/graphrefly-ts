/**
 * CSP-2.8 reactive data structures (D54/D60) — reactiveList/Map/Index/Log + the shared core.
 *
 * Covers the two-port shape (D60): the always-on DELTA stream (O(1)/mutation) + the lazy pull
 * SNAPSHOT node (materialized only on a cone-routed PULL demand, R-pull/D269/C-16), the D54
 * `Node<T>` widening (declared-dep input fold), each structure's specialization (Map lazy-TTL +
 * LRU + delete-reason; Index Z reverse-lookup; Log incremental view/scan + SENTINEL reject +
 * declared-dep merge), and real factory names (D6).
 *
 * Authority: ~/src/graphrefly/decisions/decisions.jsonl D54/D60, spec/rules.jsonl R-pull/R-rom-ram.
 */

import { describe, expect, it, vi } from "vitest";
import { reactiveList } from "../graph/data-structures/reactive-list.js";
import { reactiveMap } from "../graph/data-structures/reactive-map.js";
import { graph } from "../graph/graph.js";
import { selectRetentionVictims } from "../graph/policies/collection.js";
import { Dispatcher, type Message } from "../index.js";
import type { Node } from "../node/node.js";

const types = (m: Message[]) => m.map((x) => x[0]);
const data = <T>(m: Message[]): T[] =>
	m.filter((x) => x[0] === "DATA").map((x) => (x as readonly ["DATA", T])[1]);

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((m) => msgs.push(m));
	return { msgs, unsub };
}

class _CountingDispatcher extends Dispatcher {
	register(...args: Parameters<Dispatcher["register"]>): ReturnType<Dispatcher["register"]> {
		this.registerCount += 1;
		return super.register(...args);
	}
	registerCount = 0;
}

/** Demand the snapshot directly (the substrate cone-routed PULL of its pullId, R-pull/D269). */
function demand(snapshot: Node<unknown>, pullId: symbol): void {
	snapshot.up([["PULL", { pullId }]]);
}

describe("collectionCore two-port shape (D60) via reactiveList", () => {
	it("DELTA stream emits one change per mutation (O(1)/mutation)", () => {
		const list = reactiveList<number>();
		const { msgs } = collect(list.delta);
		list.append(1);
		list.append(2);
		list.appendMany([3, 4]);
		list.pop();
		list.clear();
		expect(data(msgs)).toEqual([
			{ kind: "append", value: 1 },
			{ kind: "append", value: 2 },
			{ kind: "appendMany", values: [3, 4] },
			{ kind: "pop", index: 3, value: 4 }, // [1,2,3,4] pop(-1) → resolved index 3, value 4

			{ kind: "clear", count: 3 },
		]);
	});

	it("bulk list deltas carry defensive copies", () => {
		const list = reactiveList<number>();
		const { msgs } = collect(list.delta);
		const appended = [1, 2];
		const inserted = [3, 4];
		list.appendMany(appended);
		list.insertMany(0, inserted);
		appended[0] = 99;
		inserted[0] = 88;
		expect(data(msgs)).toEqual([
			{ kind: "appendMany", values: [1, 2] },
			{ kind: "insertMany", index: 0, values: [3, 4] },
		]);
	});

	it("empty list bulk ops are no-op deltas where the array bulk API exists", () => {
		const list = reactiveList<number>([1]);
		const { msgs } = collect(list.delta);
		msgs.length = 0;
		list.appendMany([]);
		list.insertMany(1, []);
		expect(msgs).toEqual([]);
		expect(list.toArray()).toEqual([1]);
	});

	it("SNAPSHOT pull node is quiet (START only, no push-on-subscribe), absorbs delta DIRTY", () => {
		const list = reactiveList<number>([10]);
		const { msgs } = collect(list.snapshot);
		expect(types(msgs)).toEqual(["START"]);
		list.append(20);
		expect(types(msgs)).toEqual(["START"]); // delta DIRTY absorbed, no wedge (R-pull)
	});

	it("a demand delivers the CURRENT snapshot once, then re-quiets (1:1, lazy O(n))", () => {
		const list = reactiveList<number>();
		const { msgs } = collect(list.snapshot);
		list.append(1);
		list.append(2);
		demand(list.snapshot as Node<unknown>, list.pullId);
		expect(types(msgs)).toEqual(["START", "DIRTY", "DATA"]);
		expect(data(msgs)).toEqual([[1, 2]]);
	});

	it("demand-on-no-change emits no duplicate DATA (collection coalesce)", () => {
		const list = reactiveList<number>();
		const { msgs } = collect(list.snapshot);
		list.append(1);
		demand(list.snapshot as Node<unknown>, list.pullId);
		const afterFirst = msgs.length;
		demand(list.snapshot as Node<unknown>, list.pullId);
		expect(types(msgs).slice(afterFirst)).toEqual([]);
		expect(data(msgs)).toEqual([[1]]);
	});

	it("a second demand after a new mutation delivers the fresh snapshot", () => {
		const list = reactiveList<number>();
		const { msgs } = collect(list.snapshot);
		list.append(1);
		demand(list.snapshot as Node<unknown>, list.pullId);
		list.append(2);
		demand(list.snapshot as Node<unknown>, list.pullId);
		expect(data(msgs)).toEqual([[1], [1, 2]]);
	});

	it("synchronous quick-reads are the non-reactive peek (at/size/toArray)", () => {
		const list = reactiveList<string>(["a", "b"]);
		list.append("c");
		expect(list.size).toBe(3);
		expect(list.at(0)).toBe("a");
		expect(list.at(-1)).toBe("c");
		expect(list.at(99)).toBeUndefined();
		expect(list.toArray()).toEqual(["a", "b", "c"]);
	});

	it("insert/pop edge cases throw RangeError out of range", () => {
		const list = reactiveList<number>([1, 2]);
		expect(() => list.insert(5, 9)).toThrow(RangeError);
		expect(() => reactiveList<number>().pop()).toThrow(RangeError);
	});

	it("D72 maxSize head-trims on overflow and emits trimHead deltas", () => {
		const list = reactiveList<number>([], { maxSize: 2 });
		const { msgs } = collect(list.delta);
		list.append(1);
		list.append(2);
		list.append(3);
		expect(data(msgs)).toEqual([
			{ kind: "append", value: 1 },
			{ kind: "append", value: 2 },
			{ kind: "append", value: 3 },
			{ kind: "trimHead", n: 1 },
		]);
		expect(list.toArray()).toEqual([2, 3]);
	});

	it("D72 Node-valued list maxSize is a declared policy dep and trims on policy change", () => {
		const g = graph();
		const max = g.state(3, { name: "max" });
		const list = reactiveList<number>([], { graph: g, name: "list", maxSize: max });
		const { msgs } = collect(list.delta);
		list.appendMany([1, 2, 3]);
		max.set(1);
		expect(data(msgs)).toEqual([
			{ kind: "appendMany", values: [1, 2, 3] },
			{ kind: "trimHead", n: 2 },
		]);
		expect(list.toArray()).toEqual([3]);
		expect(g.describe().edges).toContainEqual({ from: "max", to: "list.capacityPolicy" });
		expect(g.describe().nodes.find((n) => n.id === "list.capacityPolicy")?.factory).toBe(
			"reactiveList.capacityPolicy",
		);
	});

	it("D72 Node-valued list maxSize requires graph binding", () => {
		const g = graph();
		const max = g.state(1);
		expect(() => reactiveList<number>([], { maxSize: max })).toThrow(/requires options.graph/);
	});

	it("D72 Node policy + appendFrom share one graph-visible apply path", () => {
		const g = graph();
		const max = g.state(2, { name: "max" });
		const src = g.state(0, { name: "src" });
		const list = reactiveList<number>([], { graph: g, name: "list", maxSize: max });
		const { msgs } = collect(list.delta);
		list.appendFrom(src);
		src.set(1);
		src.set(2);
		max.set(1);
		expect(data(msgs)).toEqual([
			{ kind: "append", value: 0 },
			{ kind: "append", value: 1 },
			{ kind: "append", value: 2 },
			{ kind: "trimHead", n: 1 },
			{ kind: "trimHead", n: 1 },
		]);
		expect(g.describe().edges).toContainEqual({ from: "max", to: "list.capacityPolicy" });
		expect(g.describe().edges).toContainEqual({ from: "list.bind#0", to: "list.capacityPolicy" });
	});
});

describe("D54 Node<T> widening — in-graph producer drives the structure (declared-dep fold)", () => {
	it("appendFrom folds a source's values into the list (no imperative glue)", () => {
		const g = graph();
		const src = g.state<number>(0, { name: "src" });
		const list = reactiveList<number>([], { graph: g, name: "list" });
		const { msgs } = collect(list.delta);
		list.appendFrom(src as unknown as Node<number>);
		src.set(1);
		src.set(2);
		expect(data(msgs)).toEqual([
			{ kind: "append", value: 0 }, // state node pushes its initial on subscribe (R-initial)
			{ kind: "append", value: 1 },
			{ kind: "append", value: 2 },
		]);
		expect(list.toArray()).toEqual([0, 1, 2]);
		expect(g.describe().edges).toContainEqual({ from: "src", to: "list.bind#0" });
		expect(g.describe().nodes.find((n) => n.id === "list.bind#0")?.factory).toBe(
			"reactiveList.bindSource",
		);
	});
});

describe("reactiveMap (D60 #3) — lazy TTL + LRU + delete-reason", () => {
	it("set/delete emit deltas with the right reason; snapshot reflects state", () => {
		const m = reactiveMap<string, number>();
		const { msgs } = collect(m.delta);
		m.set("a", 1);
		m.set("b", 2);
		m.delete("a");
		expect(data(msgs)).toEqual([
			{ kind: "set", key: "a", value: 1 },
			{ kind: "set", key: "b", value: 2 },
			{ kind: "delete", key: "a", previous: 1, reason: "explicit" },
		]);
		expect([...m.toMap()]).toEqual([["b", 2]]);
	});

	it("empty setMany/deleteMany are no-op deltas", () => {
		const m = reactiveMap<string, number>();
		const { msgs } = collect(m.delta);
		msgs.length = 0;
		m.setMany([]);
		m.deleteMany([]);
		expect(msgs).toEqual([]);
		expect([...m.toMap()]).toEqual([]);
	});

	it("setMany/deleteMany accept generator inputs and ignore missing deletes", () => {
		function* entries(): Generator<readonly [string, number]> {
			yield ["a", 1];
			yield ["b", 2];
		}
		function* keys(): Generator<string> {
			yield "missing";
			yield "a";
			yield "also-missing";
		}

		const m = reactiveMap<string, number>();
		const { msgs } = collect(m.delta);
		m.setMany(entries());
		m.deleteMany(keys());

		expect(data(msgs)).toEqual([
			{ kind: "set", key: "a", value: 1 },
			{ kind: "set", key: "b", value: 2 },
			{ kind: "delete", key: "a", previous: 1, reason: "explicit" },
		]);
		expect([...m.toMap()]).toEqual([["b", 2]]);
	});

	it("setMany applies per-call TTL to every generated entry", () => {
		let t = 0;
		function* entries(): Generator<readonly [string, number]> {
			yield ["a", 1];
			yield ["b", 2];
		}

		const m = reactiveMap<string, number>({ now: () => t });
		const { msgs } = collect(m.delta);
		m.setMany(entries(), { ttl: 10 });

		t = 9;
		expect(m.get("a")).toBe(1);
		expect(m.get("b")).toBe(2);

		t = 10;
		expect(m.get("a")).toBeUndefined();
		expect(m.get("b")).toBeUndefined();
		expect(data(msgs)).toEqual([
			{ kind: "set", key: "a", value: 1 },
			{ kind: "set", key: "b", value: 2 },
			{ kind: "delete", key: "a", previous: 1, reason: "expired" },
			{ kind: "delete", key: "b", previous: 2, reason: "expired" },
		]);
	});

	it("lazy TTL: a read that materializes expiry emits delete(reason:'expired') (D61)", () => {
		let t = 1000;
		const m = reactiveMap<string, number>({ defaultTtl: 100, now: () => t });
		const { msgs } = collect(m.delta);
		m.set("x", 1);
		expect(m.get("x")).toBe(1);
		t = 1200;
		expect(m.get("x")).toBeUndefined(); // read prunes and emits the normal expired delete delta
		expect(data(msgs)).toEqual([
			{ kind: "set", key: "x", value: 1 },
			{ kind: "delete", key: "x", previous: 1, reason: "expired" },
		]);
		expect(m.toMap().size).toBe(0);
	});

	it("lazy TTL: pruneExpired/toMap emit expired deletes for materialized expiry (D61)", () => {
		let t = 0;
		const m = reactiveMap<string, number>({ defaultTtl: 5, now: () => t });
		const { msgs } = collect(m.delta);
		m.set("a", 1);
		m.set("b", 2);
		t = 10;
		m.pruneExpired();
		expect(data(msgs)).toEqual([
			{ kind: "set", key: "a", value: 1 },
			{ kind: "set", key: "b", value: 2 },
			{ kind: "delete", key: "a", previous: 1, reason: "expired" },
			{ kind: "delete", key: "b", previous: 2, reason: "expired" },
		]);

		m.set("c", 3);
		t = 20;
		expect([...m.toMap()]).toEqual([]);
		expect(data(msgs).at(-1)).toEqual({
			kind: "delete",
			key: "c",
			previous: 3,
			reason: "expired",
		});
	});

	it("LRU maxSize evicts the oldest with reason:'lru-evict'", () => {
		const m = reactiveMap<string, number>({ maxSize: 2 });
		const { msgs } = collect(m.delta);
		m.set("a", 1);
		m.set("b", 2);
		m.set("c", 3); // evicts "a"
		expect(data(msgs)).toEqual([
			{ kind: "set", key: "a", value: 1 },
			{ kind: "set", key: "b", value: 2 },
			{ kind: "set", key: "c", value: 3 },
			{ kind: "delete", key: "a", previous: 1, reason: "lru-evict" },
		]);
		expect([...m.toMap()].map(([k]) => k)).toEqual(["b", "c"]);
	});

	it("D68 static TTL/LRU shorthands install graph-visible policy/apply nodes", () => {
		const g = graph();
		const m = reactiveMap<string, number>({ graph: g, name: "map", maxSize: 2, defaultTtl: 5 });
		m.set("a", 1);
		const snap = g.describe();
		expect(snap.nodes.find((n) => n.id === "map.apply")?.factory).toBe("reactiveMap.apply");
		expect(snap.nodes.find((n) => n.id === "map.delta")?.factory).toBe("reactiveMap.delta");
		expect(snap.nodes.find((n) => n.id === "map.intent")?.factory).toBe("reactiveMap.intent");
		expect(snap.nodes.find((n) => n.id === "map.lruPolicy")?.factory).toBe("reactiveMap.lruPolicy");
		expect(snap.nodes.find((n) => n.id === "map.ttlPolicy")?.factory).toBe("reactiveMap.ttlPolicy");
		expect(snap.edges).toContainEqual({ from: "map.intent", to: "map.apply" });
		expect(snap.edges).toContainEqual({ from: "map.lruPolicy", to: "map.apply" });
		expect(snap.edges).toContainEqual({ from: "map.ttlPolicy", to: "map.apply" });
	});

	it("D68 Node-valued maxSize is a declared policy dep and can evict on policy change", () => {
		const g = graph();
		const max = g.state(2, { name: "max" });
		const m = reactiveMap<string, number>({ graph: g, name: "map", maxSize: max });
		const { msgs } = collect(m.delta);
		m.set("a", 1);
		m.set("b", 2);
		m.set("c", 3);
		max.set(1); // lowering the policy is itself a policy-driven backend mutation (D68)
		expect(data(msgs)).toEqual([
			{ kind: "set", key: "a", value: 1 },
			{ kind: "set", key: "b", value: 2 },
			{ kind: "set", key: "c", value: 3 },
			{ kind: "delete", key: "a", previous: 1, reason: "lru-evict" },
			{ kind: "delete", key: "b", previous: 2, reason: "lru-evict" },
		]);
		expect([...m.toMap()]).toEqual([["c", 3]]);
		expect(g.describe().edges).toContainEqual({ from: "max", to: "map.apply" });
	});

	it("D68 Node-valued defaultTtl is a declared policy dep for subsequent sets", () => {
		let t = 0;
		const g = graph();
		const ttl = g.state(5, { name: "ttl" });
		const m = reactiveMap<string, number>({
			graph: g,
			name: "map",
			defaultTtl: ttl,
			now: () => t,
		});
		m.set("a", 1);
		t = 6;
		expect(m.get("a")).toBeUndefined();
		ttl.set(20);
		m.set("b", 2);
		t = 16;
		expect(m.get("b")).toBe(2);
		t = 27;
		expect(m.get("b")).toBeUndefined();
		expect(g.describe().edges).toContainEqual({ from: "ttl", to: "map.apply" });
	});

	it("D68 Node-valued policy opts require graph binding", () => {
		const g = graph();
		const max = g.state(1);
		expect(() => reactiveMap<string, number>({ maxSize: max })).toThrow(/requires options.graph/);
		expect(() => reactiveMap<string, number>({ defaultTtl: max })).toThrow(
			/requires options.graph/,
		);
	});

	it("D72 retention archives lowest scores with reason:'archived'", () => {
		const m = reactiveMap<string, number>({
			retention: { maxSize: 2, score: ({ value }) => value },
		});
		const { msgs } = collect(m.delta);
		m.set("a", 10);
		m.set("b", 1);
		m.set("c", 5);
		expect(data(msgs)).toEqual([
			{ kind: "set", key: "a", value: 10 },
			{ kind: "set", key: "b", value: 1 },
			{ kind: "set", key: "c", value: 5 },
			{ kind: "delete", key: "b", previous: 1, reason: "archived" },
		]);
		expect([...m.toMap()]).toEqual([
			["a", 10],
			["c", 5],
		]);
	});

	it("D72 static retention maxSize installs a graph-visible policy/apply edge", () => {
		const g = graph();
		const m = reactiveMap<string, number>({
			graph: g,
			name: "map",
			retention: { maxSize: 2, score: ({ value }) => value },
		});
		m.set("a", 1);
		const snap = g.describe();
		expect(snap.nodes.find((n) => n.id === "map.retentionPolicy")?.factory).toBe(
			"reactiveMap.retentionPolicy",
		);
		expect(snap.edges).toContainEqual({ from: "map.retentionPolicy", to: "map.apply" });
	});

	it("D72 Node-valued retention.maxSize is a declared policy dep and archives on policy change", () => {
		const g = graph();
		const keep = g.state(3, { name: "keep" });
		const m = reactiveMap<string, number>({
			graph: g,
			name: "map",
			retention: { maxSize: keep, score: ({ value }) => value },
		});
		const { msgs } = collect(m.delta);
		m.set("a", 1);
		m.set("b", 2);
		m.set("c", 3);
		keep.set(1);
		expect(data(msgs)).toEqual([
			{ kind: "set", key: "a", value: 1 },
			{ kind: "set", key: "b", value: 2 },
			{ kind: "set", key: "c", value: 3 },
			{ kind: "delete", key: "a", previous: 1, reason: "archived" },
			{ kind: "delete", key: "b", previous: 2, reason: "archived" },
		]);
		expect([...m.toMap()]).toEqual([["c", 3]]);
		expect(g.describe().edges).toContainEqual({ from: "keep", to: "map.apply" });
	});

	it("D72 Node-valued retention.maxSize requires graph binding", () => {
		const g = graph();
		const keep = g.state(1);
		expect(() =>
			reactiveMap<string, number>({
				retention: { maxSize: keep, score: ({ value }) => value },
			}),
		).toThrow(/requires options.graph/);
	});

	it("D68 graph-bound Node policy/input opts reject foreign graph nodes", () => {
		const g1 = graph();
		const g2 = graph();
		const foreignMax = g1.state(1, { name: "max" });
		expect(() =>
			reactiveMap<string, number>({ graph: g2, name: "map", maxSize: foreignMax }),
		).toThrow(/different graph/);

		const foreignSrc = g1.state<readonly [string, number]>(["x", 1], { name: "src" });
		const m = reactiveMap<string, number>({ graph: g2, name: "map2" });
		expect(() => m.setFrom(foreignSrc as Node<readonly [string, number]>)).toThrow(
			/different graph/,
		);
	});

	it("D68 active TTL uses one internal timer path to prune without a read", () => {
		vi.useFakeTimers();
		try {
			const m = reactiveMap<string, number>({ defaultTtl: 10 });
			const { msgs } = collect(m.delta);
			m.set("a", 1);
			vi.advanceTimersByTime(9);
			expect(data(msgs)).toEqual([{ kind: "set", key: "a", value: 1 }]);
			vi.advanceTimersByTime(1);
			expect(data(msgs)).toEqual([
				{ kind: "set", key: "a", value: 1 },
				{ kind: "delete", key: "a", previous: 1, reason: "expired" },
			]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("pull snapshot delivers a ReadonlyMap on demand", () => {
		const m = reactiveMap<string, number>();
		const { msgs } = collect(m.snapshot);
		m.set("a", 1);
		m.set("b", 2);
		demand(m.snapshot as Node<unknown>, m.pullId);
		const snap = data<ReadonlyMap<string, number>>(msgs)[0];
		expect([...snap]).toEqual([
			["a", 1],
			["b", 2],
		]);
	});

	it("pull snapshot demand prunes expired entries and emits expired deletes through public delta", () => {
		let t = 0;
		const m = reactiveMap<string, number>({ defaultTtl: 5, now: () => t });
		const deltas = collect(m.delta);
		const snaps = collect(m.snapshot);
		m.set("live", 1, { ttl: 20 });
		m.set("old", 2);
		t = 10;
		demand(m.snapshot as Node<unknown>, m.pullId);
		expect([...data<ReadonlyMap<string, number>>(snaps.msgs).at(-1)!]).toEqual([["live", 1]]);
		expect(data(deltas.msgs).at(-1)).toEqual({
			kind: "delete",
			key: "old",
			previous: 2,
			reason: "expired",
		});
	});

	it("pull snapshot demand with no expired entries does not emit delta DATA", () => {
		let t = 0;
		const m = reactiveMap<string, number>({ defaultTtl: 50, now: () => t });
		const deltas = collect(m.delta);
		const snaps = collect(m.snapshot);
		m.set("a", 1);
		const before = data(deltas.msgs).length;
		t = 10;
		demand(m.snapshot as Node<unknown>, m.pullId);
		expect([...data<ReadonlyMap<string, number>>(snaps.msgs).at(-1)!]).toEqual([["a", 1]]);
		expect(data(deltas.msgs)).toHaveLength(before);
	});

	it("select(predicate) is a D121 light view with forwarded delta + pulled snapshot", () => {
		const m = reactiveMap<string, number>();
		const isEven = (value: number) => value % 2 === 0;
		const view = m.select(isEven);
		const deltaMsgs = collect(view.delta);
		const snapshotMsgs = collect(view.snapshot);

		m.set("a", 1);
		m.set("b", 2);
		m.set("c", 4);

		expect(data(deltaMsgs.msgs).at(-1)).toEqual({ kind: "set", key: "c", value: 4 });
		demand(view.snapshot as Node<unknown>, view.pullId);
		expect([...data<ReadonlyMap<string, number>>(snapshotMsgs.msgs).at(-1)!]).toEqual([
			["b", 2],
			["c", 4],
		]);
		expect(m.select(isEven)).toBe(view);
		expect(() => m.select(null as never)).toThrow(TypeError);
		view.dispose();
		expect(m.select(isEven)).not.toBe(view);
		expect(() => view.delta.subscribe(() => {})).toThrow(/released from its graph lifecycle/);
		expect(() => demand(view.snapshot as Node<unknown>, view.pullId)).toThrow(
			/released from its graph lifecycle/,
		);
	});

	it("select snapshot predicate failures surface as ERROR waves", () => {
		const m = reactiveMap<string, number>();
		m.set("a", 1);
		const view = m.select(() => {
			throw new Error("select boom");
		});
		const snapshotMsgs = collect(view.snapshot);

		demand(view.snapshot as Node<unknown>, view.pullId);

		const errors = snapshotMsgs.msgs.filter((msg) => msg[0] === "ERROR");
		expect(errors).toHaveLength(1);
		expect((errors[0]?.[1] as Error).message).toBe("select boom");
		expect(data(snapshotMsgs.msgs)).toEqual([]);
	});

	it("select light views register through the graph funnel when options.graph is present", () => {
		const g = graph();
		const m = reactiveMap<string, number>({ graph: g, name: "map" });
		const view = m.select((value) => value > 1);

		const snap = g.describe();
		expect(snap.nodes.find((n) => n.id === "map.delta")?.factory).toBe("reactiveMap.delta");
		expect(snap.nodes.find((n) => n.id === "map.select#0.delta")?.factory).toBe(
			"reactiveMap.select.delta",
		);
		expect(snap.nodes.find((n) => n.id === "map.select#0.snapshot")?.factory).toBe(
			"reactiveMap.select.snapshot",
		);
		expect(snap.edges).toContainEqual({ from: "map.delta", to: "map.select#0.delta" });
		expect(snap.edges).toContainEqual({
			from: "map.select#0.delta",
			to: "map.select#0.snapshot",
		});
		view.dispose();
		const after = g.describe();
		expect(after.edges).not.toContainEqual({
			from: "map.delta",
			to: "map.select#0.delta",
		});
		expect(after.nodes.map((n) => n.id)).not.toContain("map.select#0.delta");
		expect(after.nodes.map((n) => n.id)).not.toContain("map.select#0.snapshot");
	});

	it("select viewCache evicts only memo refs, not live D121 view nodes", () => {
		const g = graph();
		const m = reactiveMap<string, number>({ graph: g, name: "map", viewCache: { maxEntries: 1 } });
		const gt0 = (value: number) => value > 0;
		const gt1 = (value: number) => value > 1;

		const first = m.select(gt0);
		const second = m.select(gt1);

		expect(m.select(gt1)).toBe(second);
		expect(m.select(gt0)).not.toBe(first);
		expect(g.find("map.select#0.delta")).toBe(first.delta);
		expect(g.find("map.select#1.delta")).toBe(second.delta);
		first.dispose();
		expect(g.find("map.select#0.delta")).toBeUndefined();
		m.dispose();
		expect(
			g
				.describe()
				.nodes.map((n) => n.id)
				.filter((id) => id.includes(".select#")),
		).toEqual([]);
	});

	it("rejects invalid select viewCache policies", () => {
		expect(() => reactiveMap<string, number>({ viewCache: { maxEntries: -1 } })).toThrow(
			/viewCache\.maxEntries/,
		);
	});

	it("undefined is a valid map value: has/delete use presence, not value !== undefined", () => {
		const m = reactiveMap<string, number | undefined>();
		const { msgs } = collect(m.delta);
		m.set("u", undefined);
		expect(m.has("u")).toBe(true);
		expect(m.get("u")).toBeUndefined();
		expect([...m.toMap()]).toEqual([["u", undefined]]);
		m.delete("u");
		expect(data(msgs)).toEqual([
			{ kind: "set", key: "u", value: undefined },
			{ kind: "delete", key: "u", previous: undefined, reason: "explicit" },
		]);
	});

	it("setFrom routes malformed input errors to the folder ERROR boundary", () => {
		const g = graph();
		const src = g.node<readonly [string, number]>([], null, { name: "src" });
		const m = reactiveMap<string, number>({ graph: g, name: "map" });
		m.setFrom(src as Node<readonly [string, number]>);

		expect(() => src.down([["DATA", 1 as unknown as readonly [string, number]]])).not.toThrow();
		expect(m.size).toBe(0);
		expect(g.describe().edges).toContainEqual({ from: "src", to: "map.bind#0" });
		expect(g.describe().edges).toContainEqual({ from: "map.bind#0", to: "map.apply" });
		expect(g.describe().nodes.find((n) => n.id === "map.bind#0")?.factory).toBe(
			"reactiveMap.bindSource",
		);
	});
});

describe("internal collection policy helpers (D70)", () => {
	it("selectRetentionVictims is selection-only and stable by lowest score", () => {
		const scored = [
			{ entry: "keep-high", score: 10 },
			{ entry: "drop-low-a", score: 1 },
			{ entry: "drop-low-b", score: 1 },
			{ entry: "keep-mid", score: 5 },
		];
		expect(selectRetentionVictims(scored, { maxSize: 2 })).toEqual(["drop-low-a", "drop-low-b"]);
		expect(scored.map((x) => x.entry)).toEqual([
			"keep-high",
			"drop-low-a",
			"drop-low-b",
			"keep-mid",
		]);
	});
});
