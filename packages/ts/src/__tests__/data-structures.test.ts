/**
 * CSP-2.8 reactive data structures (D54/D60) — reactiveList/Map/Index/Log + the shared core.
 *
 * Covers the two-port shape (D60): the always-on DELTA stream (O(1)/mutation) + the lazy pull
 * SNAPSHOT node (materialized only on a cone-routed RESUME demand, R-pull/D59/C-16), the D54
 * `Node<T>` widening (declared-dep input fold), each structure's specialization (Map lazy-TTL +
 * LRU + delete-reason; Index Z reverse-lookup; Log incremental view/scan + SENTINEL reject +
 * declared-dep merge), and real factory names (D6).
 *
 * Authority: ~/src/graphrefly/decisions/decisions.jsonl D54/D60, spec/rules.jsonl R-pull/R-rom-ram.
 */

import { describe, expect, it } from "vitest";
import { reactiveIndex } from "../graph/data-structures/reactive-index.js";
import { reactiveList } from "../graph/data-structures/reactive-list.js";
import { mergeReactiveLogs, reactiveLog } from "../graph/data-structures/reactive-log.js";
import { reactiveMap } from "../graph/data-structures/reactive-map.js";
import { graph } from "../graph/graph.js";
import type { Message } from "../index.js";
import type { Node } from "../node/node.js";

const types = (m: Message[]) => m.map((x) => x[0]);
const data = <T>(m: Message[]): T[] =>
	m.filter((x) => x[0] === "DATA").map((x) => (x as readonly ["DATA", T])[1]);

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((m) => msgs.push(m));
	return { msgs, unsub };
}

/** Demand the snapshot directly (the substrate cone-routed RESUME of its pullId, R-pull/D59). */
function demand(snapshot: Node<unknown>, pullId: symbol): void {
	snapshot.up([["RESUME", pullId]]);
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

	it("demand-on-no-change is SILENT (coalesce, C-16)", () => {
		const list = reactiveList<number>();
		const { msgs } = collect(list.snapshot);
		list.append(1);
		demand(list.snapshot as Node<unknown>, list.pullId);
		const afterFirst = msgs.length;
		demand(list.snapshot as Node<unknown>, list.pullId);
		expect(msgs.length).toBe(afterFirst);
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
});

describe("D54 Node<T> widening — in-graph producer drives the structure (declared-dep fold)", () => {
	it("appendFrom folds a source's values into the list (no imperative glue)", () => {
		const g = graph();
		const src = g.state<number>(0, { name: "src" });
		const list = reactiveList<number>();
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

	it("lazy TTL: expired entries are filtered from the snapshot; a read prunes WITHOUT a delta", () => {
		let t = 1000;
		const m = reactiveMap<string, number>({ defaultTtl: 100, now: () => t });
		const { msgs } = collect(m.delta);
		m.set("x", 1);
		expect(m.get("x")).toBe(1);
		t = 1200;
		expect(m.get("x")).toBeUndefined(); // read prunes (memory) ...
		expect(data(msgs)).toEqual([{ kind: "set", key: "x", value: 1 }]); // ... but NO delta
		expect(m.toMap().size).toBe(0);
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
});

describe("reactiveIndex (D60 #4) — ordered snapshot + Z reverse-lookup", () => {
	it("rows are ordered by (secondary, primary); sync has/get are point reads", () => {
		const idx = reactiveIndex<string, string>();
		idx.upsert("id2", 5, "b");
		idx.upsert("id1", 10, "a");
		idx.upsert("id3", 5, "c");
		const { msgs } = collect(idx.snapshot);
		demand(idx.snapshot as Node<unknown>, idx.pullId);
		const rows = data<readonly { primary: string }[]>(msgs)[0];
		expect(rows.map((r) => r.primary)).toEqual(["id2", "id3", "id1"]); // (5,id2),(5,id3),(10,id1)
		expect(idx.has("id1")).toBe(true);
		expect(idx.get("id1")).toBe("a");
		expect(idx.get("nope")).toBeUndefined();
		expect(idx.size).toBe(3);
	});

	it("upsert returns insert-vs-update; rangeByPrimary scans the primary axis (Z sync read)", () => {
		const idx = reactiveIndex<string, number>();
		expect(idx.upsert("b", 1, 2)).toBe(true);
		expect(idx.upsert("b", 1, 3)).toBe(false);
		idx.upsert("a", 1, 1);
		idx.upsert("c", 1, 3);
		expect(idx.rangeByPrimary("a", "c")).toEqual([1, 3]); // a,b in [a,c)
	});

	it("updating comparator-equal primary objects removes the exact existing row", () => {
		const idx = reactiveIndex<object, string>();
		const a = { id: 1 };
		const b = { id: 2 };
		idx.upsert(a, 1, "a");
		idx.upsert(b, 1, "b");
		expect(idx.upsert(b, 1, "bb")).toBe(false);
		expect(idx.get(a)).toBe("a");
		expect(idx.get(b)).toBe("bb");
		expect(idx.toArray()).toHaveLength(2);
	});

	it("byPrimary is an OPTIONAL reactive derived (pushed primary→value map)", () => {
		const idx = reactiveIndex<string, number>();
		const { msgs } = collect(idx.byPrimary);
		idx.upsert("a", 1, 10);
		idx.upsert("b", 2, 20);
		const last = data<ReadonlyMap<string, number>>(msgs).at(-1);
		expect([...(last ?? new Map())]).toEqual([
			["a", 10],
			["b", 20],
		]);
	});
});

describe("reactiveLog (D60 #5) — incremental view/scan + SENTINEL reject + declared-dep merge", () => {
	it("append emits deltas; snapshot delivers the full array on demand", () => {
		const log = reactiveLog<string>();
		const { msgs } = collect(log.snapshot);
		log.append("a");
		log.append("b");
		demand(log.snapshot as Node<unknown>, log.pullId);
		expect(data(msgs)).toEqual([["a", "b"]]);
	});

	it("tail(n) is an incremental derived on the delta backbone", () => {
		const log = reactiveLog<number>();
		const { msgs } = collect(log.tail(2));
		log.append(1);
		log.append(2);
		log.append(3);
		expect(data(msgs).at(-1)).toEqual([2, 3]);
	});

	it("scan folds incrementally; resets on clear", () => {
		const log = reactiveLog<number>();
		const sum = log.scan(0, (acc, v) => acc + v);
		const { msgs } = collect(sum);
		log.append(1);
		log.append(2);
		log.append(3);
		expect(data(msgs).at(-1)).toBe(6);
		log.clear();
		expect(data(msgs).at(-1)).toBe(0);
	});

	it("scan refolds when maxSize overwrites the head without increasing length", () => {
		const log = reactiveLog<number>([], { maxSize: 2 });
		const sum = log.scan(0, (acc, v) => acc + v);
		const { msgs } = collect(sum);
		log.append(1);
		log.append(2);
		log.append(3);
		expect(log.toArray()).toEqual([2, 3]);
		expect(data(msgs).at(-1)).toBe(5);
	});

	it("append(undefined) throws — undefined is the substrate SENTINEL (R-data-payload)", () => {
		const log = reactiveLog<number | undefined>();
		expect(() => log.append(undefined)).toThrow(TypeError);
		expect(() => log.appendMany([1, undefined as unknown as number])).toThrow(TypeError);
	});

	it("maxSize ring-buffer head-trims on overflow", () => {
		const log = reactiveLog<number>([], { maxSize: 2 });
		log.append(1);
		log.append(2);
		log.append(3); // evicts 1
		expect(log.toArray()).toEqual([2, 3]);
	});

	it("bulk log deltas carry defensive copies", () => {
		const log = reactiveLog<number>();
		const { msgs } = collect(log.delta);
		const values = [1, 2];
		log.appendMany(values);
		values[0] = 99;
		expect(data(msgs)).toEqual([{ kind: "appendMany", values: [1, 2] }]);
	});

	it("trimHead removes the oldest n", () => {
		const log = reactiveLog<number>([1, 2, 3, 4]);
		const { msgs } = collect(log.delta);
		log.trimHead(2);
		expect(data(msgs)).toEqual([{ kind: "trimHead", n: 2 }]);
		expect(log.toArray()).toEqual([3, 4]);
	});

	it("mergeReactiveLogs is a DECLARED-DEP merge of N delta streams (no island, D45)", () => {
		const a = reactiveLog<string>();
		const b = reactiveLog<string>();
		const merged = mergeReactiveLogs([a, b]);
		const { msgs } = collect(merged);
		a.append("a1");
		b.append("b1");
		a.append("a2");
		expect(data(msgs)).toEqual([
			{ kind: "append", value: "a1" },
			{ kind: "append", value: "b1" },
			{ kind: "append", value: "a2" },
		]);
	});
});

describe("real factory names (D6/D60)", () => {
	it("the snapshot/delta nodes carry reactiveList.* factory names", () => {
		const list = reactiveList<number>();
		expect((list.delta as Node<unknown> & { factory?: string }).factory).toBe("reactiveList.delta");
		expect((list.snapshot as Node<unknown> & { factory?: string }).factory).toBe(
			"reactiveList.snapshot",
		);
	});
});
