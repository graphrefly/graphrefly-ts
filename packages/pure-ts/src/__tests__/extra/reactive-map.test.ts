import { describe, expect, it, vi } from "vitest";
import { DATA, DIRTY } from "../../core/messages.js";
import { reactiveMap } from "../../extra/data-structures/reactive-map.js";
import { collect } from "../test-helpers.js";

describe("extra reactiveMap (roadmap §3.2)", () => {
	it("emits DIRTY then DATA with versioned snapshot on set", () => {
		const m = reactiveMap<string, number>();
		const { batches, unsub } = collect(m.entries);
		m.set("a", 1);
		unsub();
		const flat = (batches as [symbol, unknown][][]).flat();
		// Push-on-subscribe delivers the initial cached empty Map as DATA first.
		// After that, set("a", 1) emits DIRTY then DATA with the updated map.
		// Find the DIRTY and the DATA that follows it (skipping the initial cached push).
		const iDirty = flat.findIndex((m) => m[0] === DIRTY);
		expect(iDirty).toBeGreaterThanOrEqual(0);
		// Find the DATA after DIRTY (the one from set())
		const iDataAfterDirty = flat.findIndex((m, i) => i > iDirty && m[0] === DATA);
		expect(iDataAfterDirty).toBeGreaterThan(iDirty);
		const dataMsg = flat[iDataAfterDirty] as [symbol, ReadonlyMap<string, number>];
		expect(dataMsg[1].get("a")).toBe(1);
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
		const { batches, unsub } = collect(m.entries);
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

	// ── DS14R1 — TTL/LRU prune fidelity in mutationLog ───────────────────────
	describe("DS14R1 — prune fidelity (mutationLog stays synced with entries)", () => {
		type AnyMapChange = {
			structure: string;
			lifecycle: string;
			change:
				| { kind: "set"; key: string; value: number }
				| { kind: "delete"; key: string; previous: number; reason: string }
				| { kind: "clear"; count: number };
		};

		/** Last full snapshot array emitted by a reactiveLog `entries` node. */
		function lastLog(node: Parameters<typeof collect>[0]): AnyMapChange[] {
			const { messages, unsub } = collect(node, { flat: true });
			unsub();
			let out: AnyMapChange[] = [];
			for (const m of messages) if (m[0] === DATA) out = m[1] as AnyMapChange[];
			return out;
		}
		function lastEntries(node: Parameters<typeof collect>[0]): ReadonlyMap<string, number> {
			const { messages, unsub } = collect(node, { flat: true });
			unsub();
			let out: ReadonlyMap<string, number> = new Map();
			for (const m of messages) if (m[0] === DATA) out = m[1] as ReadonlyMap<string, number>;
			return out;
		}

		it("read-time TTL expiry appends delete{reason:'expired'} synced with entries", () => {
			vi.useFakeTimers();
			const m = reactiveMap<string, number>({ defaultTtl: 0.1, mutationLog: true });
			m.set("k", 1);
			vi.advanceTimersByTime(150);
			// Pure read that discovers the expired entry → prunes it.
			expect(m.get("k")).toBeUndefined();
			const log = lastLog(m.mutationLog!.entries);
			const del = log.find((c) => c.change.kind === "delete");
			expect(del).toBeDefined();
			expect(del?.change).toMatchObject({ kind: "delete", key: "k", reason: "expired" });
			expect(del?.structure).toBe("map");
			expect(del?.lifecycle).toBe("data");
			// entries snapshot is consistent with the read (key absent).
			expect(lastEntries(m.entries).has("k")).toBe(false);
			vi.useRealTimers();
		});

		it("LRU eviction appends delete{reason:'lru-evict'}", () => {
			const m = reactiveMap<string, number>({ maxSize: 2, mutationLog: true });
			m.set("a", 1);
			m.set("b", 2);
			m.set("c", 3); // evicts "a"
			const log = lastLog(m.mutationLog!.entries);
			const evict = log.find((c) => c.change.kind === "delete" && c.change.reason === "lru-evict");
			expect(evict?.change).toMatchObject({ kind: "delete", key: "a", reason: "lru-evict" });
			expect(lastEntries(m.entries).has("a")).toBe(false);
		});

		it("replaying mutationLog reconstructs entries exactly (desync regression)", () => {
			vi.useFakeTimers();
			const m = reactiveMap<string, number>({ maxSize: 3, mutationLog: true });
			m.set("a", 1);
			m.set("b", 2, { ttl: 0.1 });
			m.set("c", 3);
			vi.advanceTimersByTime(150);
			expect(m.has("b")).toBe(false); // TTL prune on read
			m.set("d", 4);
			m.set("e", 5); // LRU pressure → evicts oldest live key
			const log = lastLog(m.mutationLog!.entries);
			const replay = new Map<string, number>();
			for (const c of log) {
				if (c.change.kind === "set") replay.set(c.change.key, c.change.value);
				else if (c.change.kind === "delete") replay.delete(c.change.key);
				else if (c.change.kind === "clear") replay.clear();
			}
			expect([...replay.entries()].sort()).toEqual([...lastEntries(m.entries).entries()].sort());
			vi.useRealTimers();
		});

		it("no mutationLog configured → prune still works, zero records, no throw", () => {
			vi.useFakeTimers();
			const m = reactiveMap<string, number>({ defaultTtl: 0.1 });
			const { batches, unsub } = collect(m.entries);
			m.set("k", 1);
			vi.advanceTimersByTime(150);
			expect(m.get("k")).toBeUndefined(); // prune path with trackPrunes off
			expect(batches.length).toBeGreaterThan(0);
			expect(m.mutationLog).toBeUndefined();
			unsub();
			vi.useRealTimers();
		});
	});
});
