import { describe, expect, it } from "vitest";
import { DATA, DIRTY } from "../../core/messages.js";
import { pubsub } from "../../extra/pubsub.js";
import { reactiveIndex } from "../../extra/reactive-index.js";
import { reactiveList } from "../../extra/reactive-list.js";
import { logSlice, reactiveLog } from "../../extra/reactive-log.js";
import { collect } from "../test-helpers.js";

describe("extra reactiveLog / logSlice (roadmap §3.2)", () => {
	it("append and clear emit versioned snapshots", () => {
		const lg = reactiveLog<number>();
		const { batches, unsub } = collect(lg.entries);
		lg.append(1);
		unsub();
		const flat = (batches as [symbol, unknown][][]).flat();
		expect(flat.some((m) => m[0] === DIRTY)).toBe(true);
		// Push-on-subscribe delivers the initial cached empty array first;
		// find the DATA that contains the appended value.
		const dataMessages = flat.filter((m) => m[0] === DATA) as [symbol, readonly number[]][];
		const appended = dataMessages.find((m) => (m[1] as readonly number[]).length > 0);
		expect(appended).toBeDefined();
		expect([...appended![1]]).toEqual([1]);
	});

	it("tail returns last n entries", () => {
		const lg = reactiveLog<string>();
		lg.append("a");
		lg.append("b");
		const tail = lg.tail(1);
		expect(tail.cache).toEqual(["b"]);
	});

	it("logSlice matches tuple slice semantics", () => {
		const lg = reactiveLog([0, 1, 2, 3]);
		const sl = logSlice(lg, 1, 3);
		expect(sl.cache).toEqual([1, 2]);
	});
});

describe("extra reactiveIndex (roadmap §3.2)", () => {
	it("orders by secondary then primary and supports delete", () => {
		const idx = reactiveIndex<string, string>();
		idx.upsert("p1", 10, "a");
		idx.upsert("p2", 5, "b");
		expect(idx.byPrimary.cache).toEqual(
			new Map([
				["p1", "a"],
				["p2", "b"],
			]),
		);
		const ordered = idx.ordered.cache as readonly { primary: string }[];
		expect(ordered.map((r) => r.primary)).toEqual(["p2", "p1"]);
		idx.delete("p2");
		const m = idx.byPrimary.cache as Map<string, string>;
		expect([...m.keys()]).toEqual(["p1"]);
	});
});

describe("extra reactiveList (roadmap §3.2)", () => {
	it("append, insert, pop, clear", () => {
		const lst = reactiveList<number>();
		lst.append(1);
		lst.insert(0, 0);
		expect(lst.items.cache).toEqual([0, 1]);
		expect(lst.pop()).toBe(1);
		expect(lst.items.cache).toEqual([0]);
	});
});

describe("extra pubsub (roadmap §3.2)", () => {
	it("creates topics lazily and delivers publishes", () => {
		const hub = pubsub();
		const t = hub.topic("x");
		const seen: unknown[] = [];
		const unsub = t.subscribe((msgs) => {
			for (const m of msgs as [symbol, unknown][]) {
				if (m[0] === DATA) seen.push(m[1]);
			}
		});
		hub.publish("x", 42);
		unsub();
		// Push-on-subscribe delivers the initial cached undefined, then the published 42
		expect(seen).toEqual([undefined, 42]);
	});
});
