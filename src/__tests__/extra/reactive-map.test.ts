import { describe, expect, it, vi } from "vitest";
import { DATA, DIRTY } from "../../core/messages.js";
import { reactiveMap } from "../../extra/reactive-map.js";

function collect(node: { subscribe: (fn: (m: unknown) => void) => () => void }) {
	const batches: unknown[] = [];
	const unsub = node.subscribe((msgs) => {
		batches.push(msgs);
	});
	return { batches, unsub };
}

describe("extra reactiveMap (roadmap §3.2)", () => {
	it("emits DIRTY then DATA with versioned snapshot on set", () => {
		const m = reactiveMap<string, number>();
		const { batches, unsub } = collect(m.node);
		m.set("a", 1);
		unsub();
		const flat = (batches as [symbol, unknown][][]).flat();
		const iDirty = flat.findIndex((m) => m[0] === DIRTY);
		const iData = flat.findIndex((m) => m[0] === DATA);
		expect(iDirty).toBeGreaterThanOrEqual(0);
		expect(iData).toBeGreaterThan(iDirty);
		const dataMsg = flat[iData] as [
			symbol,
			{ version: number; value: { map: ReadonlyMap<string, number> } },
		];
		expect(dataMsg[1].version).toBe(1);
		expect(dataMsg[1].value.map.get("a")).toBe(1);
	});

	it("get refreshes LRU order and returns value", () => {
		const m = reactiveMap<string, number>({ maxSize: 2 });
		m.set("a", 1);
		m.set("b", 2);
		m.get("a");
		m.set("c", 3);
		expect(m.has("a")).toBe(true);
		expect(m.has("b")).toBe(false);
		expect(m.get("c")).toBe(3);
	});

	it("evicts oldest entries when maxSize exceeded", () => {
		const m = reactiveMap<string, number>({ maxSize: 2 });
		m.set("x", 1);
		m.set("y", 2);
		m.set("z", 3);
		expect(m.size).toBe(2);
		expect(m.has("x")).toBe(false);
		expect(m.get("y")).toBe(2);
		expect(m.get("z")).toBe(3);
	});

	it("expires keys by ttl on read and pruneExpired", () => {
		vi.useFakeTimers();
		const m = reactiveMap<string, number>();
		m.set("a", 1, { ttl: 1 });
		expect(m.get("a")).toBe(1);
		vi.advanceTimersByTime(1000);
		expect(m.get("a")).toBeUndefined();
		m.set("b", 2, { ttl: 5 });
		vi.advanceTimersByTime(2000);
		m.pruneExpired();
		expect(m.has("b")).toBe(true);
		vi.useRealTimers();
	});

	it("uses defaultTtl when set omits ttl", () => {
		vi.useFakeTimers();
		const m = reactiveMap<string, number>({ defaultTtl: 0.1 });
		m.set("k", 1);
		vi.advanceTimersByTime(150);
		expect(m.get("k")).toBeUndefined();
		vi.useRealTimers();
	});

	it("delete and clear emit updates", () => {
		const m = reactiveMap<string, number>();
		const { batches, unsub } = collect(m.node);
		m.set("a", 1);
		const afterSet = batches.length;
		m.delete("a");
		expect(batches.length).toBeGreaterThan(afterSet);
		m.set("b", 2);
		const afterB = batches.length;
		m.clear();
		expect(batches.length).toBeGreaterThan(afterB);
		unsub();
		expect(m.size).toBe(0);
	});
});
