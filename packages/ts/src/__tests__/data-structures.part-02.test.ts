import { renderSnapshot } from "../graph/render.js";
/**
 * CSP-2.8 reactive data structures (D54/D60) — reactiveList/Map/Index/Log + the shared core.
 *
 * Covers the two-port shape (D60): the always-on DELTA stream (O(1)/mutation) + the lazy pull
 * SNAPSHOT node (materialized only on a live write to its REQUEST state, graphrefly-ts:D172), the D54
 * `Node<T>` widening (declared-dep input fold), each structure's specialization (Map lazy-TTL +
 * LRU + delete-reason; Index Z reverse-lookup; Log incremental view/scan + SENTINEL reject +
 * declared-dep merge), and real factory names (D6).
 *
 * Authority: ~/src/graphrefly/decisions/decisions.jsonl D54/D60, spec/rules.jsonl R-pull/R-lifetime.
 */

import { describe, expect, it } from "vitest";
import { Dispatcher } from "../dispatcher/index.js";
import { combine } from "../graph/combinators.js";
import { reactiveIndex } from "../graph/data-structures/reactive-index.js";
import { reactiveList } from "../graph/data-structures/reactive-list.js";
import { mergeReactiveLogs, reactiveLog, scanLog } from "../graph/data-structures/reactive-log.js";
import { graph } from "../graph/graph.js";
import type { Message } from "../index.js";
import type { Node } from "../node/node.js";
import { asState } from "./helpers/as-state.js";
import { collect } from "./helpers/collect.js";
import { relayFirst } from "./helpers/relay.js";

const _types = (m: Message[]) => m.map((x) => x[0]);
const data = <T>(m: Message[]): T[] =>
	m.filter((x) => x[0] === "DATA").map((x) => (x as readonly ["DATA", T])[1]);

class CountingDispatcher extends Dispatcher {
	register(...args: Parameters<Dispatcher["register"]>): ReturnType<Dispatcher["register"]> {
		this.registerCount += 1;
		return super.register(...args);
	}
	registerCount = 0;
}

/** Request one snapshot: a live write to the collection's request state (graphrefly-ts:D172). */
function demand(request: Node<true>): void {
	asState(request).set(true);
}

describe("reactiveIndex (D60 #4) — ordered snapshot + Z reverse-lookup", () => {
	it("rows are ordered by (secondary, primary); sync has/get are point reads", () => {
		const g = graph();
		const idx = reactiveIndex<string, string>(g);
		idx.upsert("id2", 5, "b");
		idx.upsert("id1", 10, "a");
		idx.upsert("id3", 5, "c");
		const { msgs } = collect(idx.snapshot);
		demand(idx.request);
		const rows = data<readonly { primary: string }[]>(msgs)[0];
		expect(rows.map((r) => r.primary)).toEqual(["id2", "id3", "id1"]); // (5,id2),(5,id3),(10,id1)
		expect(idx.has("id1")).toBe(true);
		expect(idx.get("id1")).toBe("a");
		expect(idx.get("nope")).toBeUndefined();
		expect(idx.size).toBe(3);
	});

	it("upsert returns insert-vs-update; rangeByPrimary scans the primary axis (Z sync read)", () => {
		const g = graph();
		const idx = reactiveIndex<string, number>(g);
		expect(idx.upsert("b", 1, 2)).toBe(true);
		expect(idx.upsert("b", 1, 3)).toBe(false);
		idx.upsert("a", 1, 1);
		idx.upsert("c", 1, 3);
		expect(idx.rangeByPrimary("a", "c")).toEqual([1, 3]); // a,b in [a,c)
	});

	it("range(start,end) is a D121 light view with forwarded delta + pulled snapshot", () => {
		const g = graph();
		const idx = reactiveIndex<string, number>(g);
		const view = idx.range("a", "c");
		const { msgs: deltaMsgs, stop: unsubDelta } = collect(view.delta);
		const { msgs: snapshotMsgs, stop: unsubSnapshot } = collect(view.snapshot);

		idx.upsert("b", 1, 2);
		idx.upsert("d", 1, 4);
		idx.upsert("a", 1, 1);

		expect(data(deltaMsgs).at(-1)).toEqual({
			kind: "upsert",
			primary: "a",
			secondary: 1,
			value: 1,
		});
		demand(view.request);
		expect(data(snapshotMsgs).at(-1)).toEqual([1, 2]);
		expect(idx.range("a", "c")).toBe(view);
		const numeric = reactiveIndex<number, number>(g);
		expect(numeric.range(0, 1)).toBe(numeric.range(-0, 1));
		// A graph releases a view's node group only when it is quiescent (D124).
		unsubDelta();
		unsubSnapshot();
		view.dispose();
		expect(idx.range("a", "c")).not.toBe(view);
	});

	it("range light views register through the graph funnel", () => {
		const g = graph();
		const idx = reactiveIndex<string, number>(g, { name: "idx" });
		idx.range("a", "z");

		const snap = renderSnapshot(g);
		expect(snap.nodes.find((n) => n.id === "idx/delta")?.factory).toBe("reactiveIndex.delta");
		expect(snap.nodes.find((n) => n.id === "idx/range0/delta")?.factory).toBe(
			"reactiveIndex.range.delta",
		);
		expect(snap.nodes.find((n) => n.id === "idx/range0/snapshot")?.factory).toBe(
			"reactiveIndex.range.snapshot",
		);
		expect(snap.edges).toContainEqual({ from: "idx/delta", to: "idx/range0/delta" });
		expect(snap.edges).toContainEqual({
			from: "idx/range0/delta",
			to: "idx/range0/snapshot",
		});
		idx.range("a", "z").dispose();
		const after = renderSnapshot(g);
		expect(after.edges).not.toContainEqual({ from: "idx/delta", to: "idx/range0/delta" });
		expect(after.nodes.map((n) => n.id)).not.toContain("idx/range0/delta");
		expect(after.nodes.map((n) => n.id)).not.toContain("idx/range0/snapshot");
	});

	it("range viewCache evicts only memo refs, not live D121 view nodes", () => {
		const g = graph();
		const idx = reactiveIndex<string, number>(g, {
			name: "idx",
			viewCache: { maxEntries: 1 },
		});

		const first = idx.range("a", "c");
		const second = idx.range("c", "z");

		expect(idx.range("c", "z")).toBe(second);
		expect(idx.range("a", "c")).not.toBe(first);
		expect(g.find("idx/range0/delta")).toBe(first.delta);
		expect(g.find("idx/range1/delta")).toBe(second.delta);
		first.dispose();
		expect(g.find("idx/range0/delta")).toBeUndefined();
		idx.dispose();
		expect(
			renderSnapshot(g)
				.nodes.map((n) => n.id)
				.filter((id) => id.includes(".range#")),
		).toEqual([]);
	});

	it("empty upsertMany/deleteMany are no-op deltas", () => {
		const g = graph();
		const idx = reactiveIndex<string, number>(g);
		const { msgs } = collect(idx.delta);
		msgs.length = 0;
		idx.upsertMany([]);
		idx.deleteMany([]);
		expect(msgs).toEqual([]);
		expect(idx.toArray()).toEqual([]);
	});

	it("upsertMany/deleteMany accept generator inputs and ignore missing deletes", () => {
		const g = graph();
		function* rows(): Generator<{ primary: string; secondary: number; value: number }> {
			yield { primary: "b", secondary: 2, value: 20 };
			yield { primary: "a", secondary: 1, value: 10 };
		}
		function* primaries(): Generator<string> {
			yield "missing";
			yield "b";
			yield "also-missing";
		}

		const idx = reactiveIndex<string, number>(g);
		const { msgs } = collect(idx.delta);
		idx.upsertMany(rows());
		idx.deleteMany(primaries());

		expect(data(msgs)).toEqual([
			{ kind: "upsert", primary: "b", secondary: 2, value: 20 },
			{ kind: "upsert", primary: "a", secondary: 1, value: 10 },
			{ kind: "deleteMany", primaries: ["b"] },
		]);
		expect(idx.toArray().map((r) => r.primary)).toEqual(["a"]);
	});

	it("updating comparator-equal primary objects removes the exact existing row", () => {
		const g = graph();
		const idx = reactiveIndex<object, string>(g);
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
		const g = graph();
		const idx = reactiveIndex<string, number>(g);
		const { msgs } = collect(idx.byPrimary);
		idx.upsert("a", 1, 10);
		idx.upsert("b", 2, 20);
		const last = data<ReadonlyMap<string, number>>(msgs).at(-1);
		expect([...(last ?? new Map())]).toEqual([
			["a", 10],
			["b", 20],
		]);
	});

	it("D73 secondary capacity evicts by (secondary,primary) order (primary tie-break)", () => {
		const g = graph();
		const idx = reactiveIndex<string, number>(g, {
			capacity: { maxSize: 2, order: "secondary" },
		});
		const { msgs } = collect(idx.delta);
		idx.upsert("id2", 5, 2);
		idx.upsert("id3", 5, 3);
		idx.upsert("id1", 5, 1); // same secondary: smallest primary ("id1") evicts first
		expect(data(msgs)).toEqual([
			{ kind: "upsert", primary: "id2", secondary: 5, value: 2 },
			{ kind: "upsert", primary: "id3", secondary: 5, value: 3 },
			{ kind: "upsert", primary: "id1", secondary: 5, value: 1 },
			{ kind: "delete", primary: "id1" },
		]);
		expect(idx.toArray().map((r) => r.primary)).toEqual(["id2", "id3"]);
	});

	it("D73 primary capacity evicts by primary key order, independent from secondary order", () => {
		const g = graph();
		const idx = reactiveIndex<string, number>(g, {
			capacity: { maxSize: 2, order: "primary" },
		});
		const { msgs } = collect(idx.delta);
		idx.upsert("a", 100, 1);
		idx.upsert("c", 0, 3);
		idx.upsert("b", 999, 2); // overflow -> evict smallest primary ("a")
		expect(data(msgs)).toEqual([
			{ kind: "upsert", primary: "a", secondary: 100, value: 1 },
			{ kind: "upsert", primary: "c", secondary: 0, value: 3 },
			{ kind: "upsert", primary: "b", secondary: 999, value: 2 },
			{ kind: "delete", primary: "a" },
		]);
		expect(idx.toArray().map((r) => r.primary)).toEqual(["c", "b"]); // snapshot order still by secondary
	});

	it("D73 lru capacity touches on upsert/get/has, but NOT rangeByPrimary", () => {
		const g = graph();
		const idx = reactiveIndex<string, number>(g, {
			capacity: { maxSize: 2, order: "lru" },
		});
		const { msgs } = collect(idx.delta);
		idx.upsert("a", 1, 1);
		idx.upsert("b", 2, 2);
		expect(idx.get("a")).toBe(1); // touch a, so b becomes LRU
		idx.upsert("c", 3, 3); // evict b
		expect(idx.has("a")).toBe(true); // touch a again, so c becomes LRU
		expect(idx.rangeByPrimary("a", "z")).toEqual([1, 3]); // must not affect LRU
		idx.upsert("d", 4, 4); // evict c if rangeByPrimary is non-touching
		expect(data(msgs)).toEqual([
			{ kind: "upsert", primary: "a", secondary: 1, value: 1 },
			{ kind: "upsert", primary: "b", secondary: 2, value: 2 },
			{ kind: "upsert", primary: "c", secondary: 3, value: 3 },
			{ kind: "delete", primary: "b" },
			{ kind: "upsert", primary: "d", secondary: 4, value: 4 },
			{ kind: "delete", primary: "c" },
		]);
		expect(idx.has("b")).toBe(false);
		expect(idx.has("c")).toBe(false);
		expect(idx.has("a")).toBe(true);
		expect(idx.has("d")).toBe(true);
	});

	it("D73 lru capacity treats an existing-key upsert as a touch", () => {
		const g = graph();
		const idx = reactiveIndex<string, number>(g, {
			capacity: { maxSize: 2, order: "lru" },
		});
		const { msgs } = collect(idx.delta);
		idx.upsert("a", 1, 1);
		idx.upsert("b", 2, 2);
		expect(idx.upsert("a", 1, 10)).toBe(false); // update should refresh "a"
		idx.upsert("c", 3, 3);
		expect(data(msgs)).toEqual([
			{ kind: "upsert", primary: "a", secondary: 1, value: 1 },
			{ kind: "upsert", primary: "b", secondary: 2, value: 2 },
			{ kind: "upsert", primary: "a", secondary: 1, value: 10 },
			{ kind: "upsert", primary: "c", secondary: 3, value: 3 },
			{ kind: "delete", primary: "b" },
		]);
		expect(idx.toArray().map((r) => [r.primary, r.value])).toEqual([
			["a", 10],
			["c", 3],
		]);
	});

	it("D73 static capacity maxSize installs a graph-visible policy/apply edge", () => {
		const g = graph();
		const idx = reactiveIndex<string, number>(g, {
			name: "idx",
			capacity: { maxSize: 2, order: "secondary" },
		});
		idx.upsert("a", 1, 1);
		const snap = renderSnapshot(g);
		expect(snap.nodes.find((n) => n.id === "idx/maxSizePolicy")?.factory).toBe(
			"reactiveIndex.maxSizePolicy",
		);
		expect(snap.nodes.find((n) => n.id === "idx/capacityPolicy")?.factory).toBe(
			"reactiveIndex.capacityPolicy",
		);
		expect(snap.edges).toContainEqual({ from: "idx/maxSizePolicy", to: "idx/capacityPolicy" });
	});

	it("D73 Node-valued capacity maxSize is describe-visible and downsizing emits per-row delete", () => {
		const g = graph();
		const max = g.state(3, { name: "max" });
		const idx = reactiveIndex<string, number>(g, {
			name: "idx",
			capacity: { maxSize: max, order: "primary" },
		});
		const { msgs } = collect(idx.delta);
		idx.upsert("a", 1, 1);
		idx.upsert("b", 2, 2);
		idx.upsert("c", 3, 3);
		max.set(1);
		expect(data(msgs)).toEqual([
			{ kind: "upsert", primary: "a", secondary: 1, value: 1 },
			{ kind: "upsert", primary: "b", secondary: 2, value: 2 },
			{ kind: "upsert", primary: "c", secondary: 3, value: 3 },
			{ kind: "delete", primary: "a" },
			{ kind: "delete", primary: "b" },
		]);
		expect(idx.toArray().map((r) => r.primary)).toEqual(["c"]);
		expect(renderSnapshot(g).edges).toContainEqual({ from: "max", to: "idx/capacityPolicy" });
		expect(renderSnapshot(g).nodes.find((n) => n.id === "idx/capacityPolicy")?.factory).toBe(
			"reactiveIndex.capacityPolicy",
		);
	});

	it("D73 per-row capacity deletes each send a wave after the capacity run (R-request-order)", () => {
		const g = graph();
		const max = g.state(3, { name: "max" });
		const idx = reactiveIndex<string, number>(g, {
			name: "idx",
			capacity: { maxSize: max, order: "primary" },
		});
		const { msgs } = collect(idx.byPrimary);
		idx.upsert("a", 1, 1);
		idx.upsert("b", 2, 2);
		idx.upsert("c", 3, 3);
		max.set(1);
		expect(data<ReadonlyMap<string, number>>(msgs).map((m) => [...m.keys()])).toEqual([
			[],
			["a"],
			["a", "b"],
			["a", "b", "c"],
			["c"],
			["c"],
		]);
	});

	it("D73 Node-valued capacity maxSize rejects foreign-graph deps", () => {
		const g1 = graph();
		const foreign = g1.state(2, { name: "foreignMax" });
		const g2 = graph();
		expect(() =>
			reactiveIndex<string, number>(g2, {
				name: "idx",
				capacity: { maxSize: foreign, order: "secondary" },
			}),
		).toThrow(/different graph/);
	});

	it("D73 Node policy + upsertFrom share one graph-visible apply path", () => {
		const g = graph();
		const max = g.state(2, { name: "max" });
		const src = g.state({ primary: "seed", secondary: 0, value: 0 }, { name: "src" });
		const idx = reactiveIndex<string, number>(g, {
			name: "idx",
			capacity: { maxSize: max, order: "primary" },
		});
		const { msgs } = collect(idx.delta);
		idx.upsertFrom(src);
		src.set({ primary: "a", secondary: 1, value: 1 });
		src.set({ primary: "b", secondary: 2, value: 2 });
		max.set(1);
		expect(data(msgs)).toEqual([
			{ kind: "upsert", primary: "seed", secondary: 0, value: 0 },
			{ kind: "upsert", primary: "a", secondary: 1, value: 1 },
			{ kind: "upsert", primary: "b", secondary: 2, value: 2 },
			{ kind: "delete", primary: "a" },
			{ kind: "delete", primary: "b" },
		]);
		expect(renderSnapshot(g).edges).toContainEqual({ from: "max", to: "idx/capacityPolicy" });
		expect(renderSnapshot(g).edges).toContainEqual({
			from: "idx/bind0",
			to: "idx/capacityPolicy",
		});
	});
});

describe("reactiveLog (D60 #5) — incremental view/scan + SENTINEL reject + declared-dep merge", () => {
	it("append emits deltas; snapshot delivers the full array on demand", () => {
		const g = graph();
		const log = reactiveLog<string>(g);
		const { msgs } = collect(log.snapshot);
		log.append("a");
		log.append("b");
		demand(log.request);
		expect(data(msgs)).toEqual([["a", "b"]]);
	});

	it("tail(n) is an incremental derived on the delta backbone", () => {
		const g = graph();
		const log = reactiveLog<number>(g);
		const { msgs } = collect(log.tail(2));
		log.append(1);
		log.append(2);
		log.append(3);
		expect(data(msgs).at(-1)).toEqual([2, 3]);
	});

	it("slice(start, stop?) is an incremental positional view on the delta backbone", () => {
		const g = graph();
		const log = reactiveLog<number>(g, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		const window = log.slice(2, 5);
		const toEnd = log.slice(7);
		const { msgs: windowMsgs } = collect(window);
		const { msgs: toEndMsgs } = collect(toEnd);

		// R-lifetime: activation runs each view once, so it starts with its current window.
		expect(data(windowMsgs)).toEqual([[2, 3, 4]]);
		expect(data(toEndMsgs)).toEqual([[7, 8, 9]]);

		log.append(10);
		expect(data(windowMsgs).at(-1)).toEqual([2, 3, 4]);
		expect(data(toEndMsgs).at(-1)).toEqual([7, 8, 9, 10]);
	});

	it("page(offset,limit) is a D121 light view with forwarded delta + pulled snapshot", () => {
		const g = graph();
		const log = reactiveLog<number>(g, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		const page = log.page(2, 3);
		const { msgs: deltaMsgs, stop: unsubDelta } = collect(page.delta);
		const { msgs: snapshotMsgs, stop: unsubSnapshot } = collect(page.snapshot);

		log.append(10);

		expect(data(deltaMsgs).at(-1)).toEqual({ kind: "append", value: 10 });
		demand(page.request);
		expect(data(snapshotMsgs).at(-1)).toEqual([2, 3, 4]);
		expect(log.page(2, 3)).toBe(page);
		// A graph releases a view's node group only when it is quiescent (D124).
		unsubDelta();
		unsubSnapshot();
		page.dispose();
		expect(log.page(2, 3)).not.toBe(page);
		expect(() => log.page(-1, 3)).toThrow(RangeError);
		expect(() => log.page(0, -1)).toThrow(RangeError);
	});

	it("page light views register through the graph funnel", () => {
		const g = graph();
		const log = reactiveLog<number>(g, [], { name: "log" });
		const page = log.page(0, 2);

		const snap = renderSnapshot(g);
		expect(snap.nodes.find((n) => n.id === "log/delta")?.factory).toBe("reactiveLog.delta");
		expect(snap.nodes.find((n) => n.id === "log/page0/delta")?.factory).toBe(
			"reactiveLog.page.delta",
		);
		expect(snap.nodes.find((n) => n.id === "log/page0/snapshot")?.factory).toBe(
			"reactiveLog.page.snapshot",
		);
		expect(snap.edges).toContainEqual({ from: "log/delta", to: "log/page0/delta" });
		expect(snap.edges).toContainEqual({
			from: "log/page0/delta",
			to: "log/page0/snapshot",
		});
		page.dispose();
		const after = renderSnapshot(g);
		expect(after.edges).not.toContainEqual({ from: "log/delta", to: "log/page0/delta" });
		expect(after.nodes.map((n) => n.id)).not.toContain("log/page0/delta");
		expect(after.nodes.map((n) => n.id)).not.toContain("log/page0/snapshot");
		expect(g.find("log/page0/delta")).toBeUndefined();
		expect(g.checkpoint().nodes.map((n) => n.id)).not.toContain("log/page0/delta");
		expect(() => g.node([], null, { name: "log/page0/delta" })).toThrow(
			/released and cannot be reused/,
		);
		expect(() => page.delta.subscribe(() => {})).toThrow(/released from its graph lifecycle/);
	});

	it("page viewCache evicts only memo refs, not live D121 view nodes", () => {
		const g = graph();
		const log = reactiveLog<number>(g, [0, 1, 2, 3], {
			name: "log",
			viewCache: { maxEntries: 1 },
		});

		const first = log.page(0, 1);
		const second = log.page(1, 1);

		expect(log.page(1, 1)).toBe(second);
		expect(log.page(0, 1)).not.toBe(first);
		expect(g.find("log/page0/delta")).toBe(first.delta);
		expect(g.find("log/page1/delta")).toBe(second.delta);
		first.dispose();
		expect(g.find("log/page0/delta")).toBeUndefined();
		log.dispose();
		expect(
			renderSnapshot(g)
				.nodes.map((n) => n.id)
				.filter((id) => id.includes(".page#")),
		).toEqual([]);
	});

	it("graph-bound view dispose rejects registered downstream deps outside the release group", () => {
		const g = graph();
		const log = reactiveLog<number>(g, [], { name: "log" });
		const page = log.page(0, 2);
		const downstream = g.node([page.snapshot as Node<unknown>], relayFirst, { name: "consumer" });

		expect(() => page.dispose()).toThrow(/consumer.*still depends.*log\/page0\/snapshot/);
		expect(renderSnapshot(g).nodes.map((n) => n.id)).toContain("log/page0/snapshot");

		g.replace(downstream, [], () => {});
		page.dispose();
		const after = renderSnapshot(g);
		expect(after.nodes.map((n) => n.id)).not.toContain("log/page0/delta");
		expect(after.nodes.map((n) => n.id)).not.toContain("log/page0/snapshot");
		expect(after.nodes.map((n) => n.id).some((id) => id.startsWith("~reactiveLog.page"))).toBe(
			false,
		);
	});

	it("slice(start, stop) is memoized by range and validates non-negative integer bounds", () => {
		const g = graph();
		const log = reactiveLog<number>(g);
		const a = log.slice(1, 3);
		const b = log.slice(1, 3);
		const c = log.slice(1);
		expect(a).toBe(b);
		expect(a).not.toBe(c);
		expect(() => log.slice(-1, 3)).toThrow(RangeError);
		expect(() => log.slice(0, -1)).toThrow(RangeError);
		expect(() => log.slice(1.5, 3)).toThrow(RangeError);
	});

	it("slice(start, stop) remains positional after trimHead shifts the backend", () => {
		const g = graph();
		const log = reactiveLog<number>(g, [10, 20, 30, 40, 50, 60, 70, 80]);
		const window = log.slice(2, 5);
		const { msgs } = collect(window);
		expect(data(msgs)).toEqual([[30, 40, 50]]);

		log.trimHead(3);

		expect(data(msgs).at(-1)).toEqual([60, 70, 80]);
	});

	it("tail and slice do not replay stale construction snapshots when subscribed cold", () => {
		const g = graph();
		const log = reactiveLog<number>(g, [1, 2, 3]);
		const tail = log.tail(2);
		const slice = log.slice(1);

		log.append(4);

		const { msgs: tailMsgs } = collect(tail);
		const { msgs: sliceMsgs } = collect(slice);

		expect(data(tailMsgs)).toEqual([[3, 4]]);
		expect(data(sliceMsgs)).toEqual([[2, 3, 4]]);
	});

	it("tail and slice views settle consistently from the same delta diamond", () => {
		const g = graph();
		const log = reactiveLog<number>(g);
		const tail = log.tail(2);
		const slice = log.slice(0, 3);
		const joined = g.initNode(combine<readonly [readonly number[], readonly number[]]>(), [
			tail,
			slice,
		]);
		const { msgs } = collect(joined);

		log.appendMany([10, 20, 30, 40, 50]);

		expect(data(msgs).at(-1)).toEqual([
			[40, 50],
			[10, 20, 30],
		]);
	});

	it("tail/slice/scan views use the graph's dispatcher (built beside the collection, D179)", () => {
		const dispatcher = new CountingDispatcher();
		const g = graph({ dispatcher });
		const log = reactiveLog<number>(g, []);
		const before = dispatcher.registerCount;

		log.tail(2);
		log.slice(1, 3);
		log.scan(0, (acc, value) => acc + value);

		expect(dispatcher.registerCount - before).toBe(3);
	});

	it("scan folds incrementally; resets on clear", () => {
		const g = graph();
		const log = reactiveLog<number>(g);
		const sum = log.scan(0, (acc, v) => acc + v);
		const { msgs } = collect(sum);
		log.append(1);
		log.append(2);
		log.append(3);
		expect(data(msgs).at(-1)).toBe(6);
		log.clear();
		expect(data(msgs).at(-1)).toBe(0);
	});

	it("scanLog is the standalone composition helper for log.scan", () => {
		const g = graph();
		const log = reactiveLog<number>(g);
		const product = scanLog(log, 1, (acc, v) => acc * v);
		const { msgs } = collect(product);

		log.appendMany([2, 3, 4]);
		log.clear();

		// The activation run folds the empty log to the seed; then 2*3*4, then the cleared log.
		expect(data(msgs)).toEqual([1, 24, 1]);
		expect((product as Node<unknown> & { factory?: string }).factory).toBe("reactiveLog.scan");
	});

	it("scan refolds when maxSize overwrites the head without increasing length", () => {
		const g = graph();
		const log = reactiveLog<number>(g, [], { maxSize: 2 });
		const sum = log.scan(0, (acc, v) => acc + v);
		const { msgs } = collect(sum);
		log.append(1);
		log.append(2);
		log.append(3);
		expect(log.toArray()).toEqual([2, 3]);
		expect(data(msgs).at(-1)).toBe(5);
	});

	it("append(undefined) throws — undefined is the substrate SENTINEL (R-messages)", () => {
		const g = graph();
		const log = reactiveLog<number | undefined>(g);
		expect(() => log.append(undefined)).toThrow(TypeError);
		expect(() => log.appendMany([1, undefined as unknown as number])).toThrow(TypeError);
	});

	it("maxSize ring-buffer head-trims on overflow", () => {
		const g = graph();
		const log = reactiveLog<number>(g, [], { maxSize: 2 });
		log.append(1);
		log.append(2);
		log.append(3); // evicts 1
		expect(log.toArray()).toEqual([2, 3]);
	});

	it("bulk log deltas carry defensive copies", () => {
		const g = graph();
		const log = reactiveLog<number>(g);
		const { msgs } = collect(log.delta);
		const values = [1, 2];
		log.appendMany(values);
		values[0] = 99;
		expect(data(msgs)).toEqual([{ kind: "appendMany", values: [1, 2] }]);
	});

	it("empty log appendMany is a no-op delta where the array bulk API exists", () => {
		const g = graph();
		const log = reactiveLog<number>(g, [1]);
		const { msgs } = collect(log.delta);
		msgs.length = 0;
		log.appendMany([]);
		expect(msgs).toEqual([]);
		expect(log.toArray()).toEqual([1]);
	});

	it("trimHead removes the oldest n", () => {
		const g = graph();
		const log = reactiveLog<number>(g, [1, 2, 3, 4]);
		const { msgs } = collect(log.delta);
		log.trimHead(2);
		expect(data(msgs)).toEqual([{ kind: "trimHead", n: 2 }]);
		expect(log.toArray()).toEqual([3, 4]);
	});

	it("mergeReactiveLogs is a DECLARED-DEP merge of N delta streams (no island, D45)", () => {
		const g = graph();
		const a = reactiveLog<string>(g);
		const b = reactiveLog<string>(g);
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
		const g = graph();
		const list = reactiveList<number>(g);
		expect((list.delta as Node<unknown> & { factory?: string }).factory).toBe("reactiveList.delta");
		expect((list.snapshot as Node<unknown> & { factory?: string }).factory).toBe(
			"reactiveList.snapshot",
		);
	});
});
