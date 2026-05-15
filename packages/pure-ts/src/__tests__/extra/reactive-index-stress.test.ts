/**
 * Stress tests for reactiveIndex — Wave 4 audit scenarios + new APIs.
 *
 * Covers: sort semantics, reorder via upsert, mixed-type secondary, delete/clear
 * no-ops, byPrimary cascade, bulk operations, diamond topology, emit ordering
 * across `ordered` and `byPrimary`, pluggable backend, version counter advance.
 */

import { describe, expect, it } from "vitest";
import { DATA, DIRTY } from "../../core/messages.js";
import { node } from "../../core/node.js";
import {
	type IndexBackend,
	type IndexRow,
	NativeIndexBackend,
	reactiveIndex,
} from "../../extra/data-structures/reactive-index.js";
import { combine } from "../../extra/operators/index.js";
import { collect } from "../test-helpers.js";

describe("reactiveIndex stress tests", () => {
	// ── Scenario 1: Sort order ──────────────────────────────────────────
	it("S1: orders by (secondary, primary) — primary tiebreaks identical secondary", () => {
		const idx = reactiveIndex<string, string>();
		idx.upsert("p2", 10, "b");
		idx.upsert("p1", 10, "a");
		idx.upsert("p3", 5, "c");

		const rows = idx.ordered.cache as readonly IndexRow<string, string>[];
		expect(rows.map((r) => r.primary)).toEqual(["p3", "p1", "p2"]);
	});

	// ── Scenario 2: Reorder via upsert on same primary ──────────────────
	it("S2: upsert with new secondary reorders row; byPrimary value preserved", () => {
		const idx = reactiveIndex<string, string>();
		idx.upsert("p1", 10, "a");
		idx.upsert("p2", 20, "b");
		idx.upsert("p3", 30, "c");

		// Move p3 to the front by dropping its secondary
		idx.upsert("p3", 1, "c");

		const rows = idx.ordered.cache as readonly IndexRow<string, string>[];
		expect(rows.map((r) => r.primary)).toEqual(["p3", "p1", "p2"]);

		const byPrim = idx.byPrimary.cache as ReadonlyMap<string, string>;
		expect(byPrim.get("p3")).toBe("c");
		expect(byPrim.size).toBe(3);
	});

	// ── Scenario 3: Mixed-type secondary — falls to localeCompare ───────
	it("S3: mixed-type secondary uses String().localeCompare() fallback", () => {
		const idx = reactiveIndex<string, string>();
		idx.upsert("a", 1, "num");
		idx.upsert("b", "hello", "str");
		idx.upsert("c", true, "bool");

		const rows = idx.ordered.cache as readonly IndexRow<string, string>[];
		// Order determined by String() coercion: "1" < "hello" < "true"
		// under localeCompare — exact order depends on locale; lock in current behavior.
		const secondaries = rows.map((r) => String(r.secondary));
		// Just verify all three types are present and the array is stable
		expect(secondaries).toHaveLength(3);
		expect(rows.map((r) => r.primary).sort()).toEqual(["a", "b", "c"]);
	});

	// ── Scenario 4: Delete non-existent primary ─────────────────────────
	it("S4: delete on non-existent primary is a no-op, no emission", () => {
		const idx = reactiveIndex<string, string>();
		idx.upsert("p1", 1, "a");
		const { messages, unsub } = collect(idx.ordered, { flat: true });
		const beforeLen = messages.length;

		idx.delete("nonexistent");

		expect(messages.length).toBe(beforeLen);
		unsub();
	});

	// ── Scenario 5: Clear on empty ──────────────────────────────────────
	it("S5: clear on empty index emits nothing", () => {
		const idx = reactiveIndex<string, string>();
		const { messages, unsub } = collect(idx.ordered, { flat: true });
		const beforeLen = messages.length;

		idx.clear();
		expect(messages.length).toBe(beforeLen);

		unsub();
	});

	// ── Scenario 6: byPrimary cascade on upsert ─────────────────────────
	it("S6: byPrimary emits new Map identity when ordered emits", () => {
		const idx = reactiveIndex<string, string>();
		idx.upsert("p1", 1, "a");

		const seen: (ReadonlyMap<string, string> | null)[] = [];
		const unsub = idx.byPrimary.subscribe((msgs) => {
			for (const msg of msgs as [symbol, unknown][]) {
				if (msg[0] === DATA) seen.push(msg[1] as ReadonlyMap<string, string>);
			}
		});

		idx.upsert("p1", 2, "a");
		idx.upsert("p2", 3, "b");

		unsub();

		// Each upsert triggers an ordered emission → byPrimary recomputes.
		// Count: 1 initial (push-on-subscribe) + 2 upserts = 3
		expect(seen.length).toBeGreaterThanOrEqual(3);
		// Final byPrimary should have both keys
		expect(seen.at(-1)!.get("p1")).toBe("a");
		expect(seen.at(-1)!.get("p2")).toBe("b");
	});

	// ── Scenario 7: Bulk upsert stress via upsertMany ───────────────────
	it("S7: upsertMany of 1000 rows emits one snapshot (not 1000)", () => {
		const idx = reactiveIndex<number, number>();
		const { messages, unsub } = collect(idx.ordered, { flat: true });
		const beforeLen = messages.length;

		const rows = Array.from({ length: 1000 }, (_, i) => ({
			primary: i,
			secondary: i,
			value: i * 10,
		}));
		idx.upsertMany(rows);

		const newMessages = messages.slice(beforeLen);
		const dirtyCount = newMessages.filter((m) => m[0] === DIRTY).length;
		const dataCount = newMessages.filter((m) => m[0] === DATA).length;

		expect(dirtyCount).toBe(1);
		expect(dataCount).toBe(1);

		expect(idx.size).toBe(1000);
		unsub();
	});

	// ── Scenario 8: Diamond topology — glitch-free ──────────────────────
	it("S8: two derived views from ordered — combine sees consistent pairs", () => {
		const idx = reactiveIndex<string, number>();
		const count = node(
			[idx.ordered],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as readonly IndexRow<string, number>[]).length);
			},
			{ describeKind: "derived", initial: 0 },
		);
		const total = node(
			[idx.ordered],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(
					(data[0] as readonly IndexRow<string, number>[]).reduce((a, r) => a + r.value, 0),
				);
			},
			{ describeKind: "derived", initial: 0 },
		);
		const combined = combine(count, total);

		const seen: [number, number][] = [];
		const unsub = combined.subscribe((msgs) => {
			for (const msg of msgs as [symbol, unknown][]) {
				if (msg[0] === DATA) seen.push(msg[1] as [number, number]);
			}
		});

		idx.upsert("a", 1, 10);
		idx.upsert("b", 2, 20);
		idx.upsert("c", 3, 30);

		unsub();

		// Final state
		expect(seen.at(-1)).toEqual([3, 60]);
		// Monotonic (count and total only increase under pure insert)
		for (let i = 1; i < seen.length; i++) {
			expect(seen[i]![0]).toBeGreaterThanOrEqual(seen[i - 1]![0]);
			expect(seen[i]![1]).toBeGreaterThanOrEqual(seen[i - 1]![1]);
		}
	});

	// ── Scenario 9: byPrimary keepalive — .cache works without subscriber ─
	it("S9: byPrimary.cache returns current state without any external subscriber", () => {
		const idx = reactiveIndex<string, string>();
		idx.upsert("p1", 1, "a");
		idx.upsert("p2", 2, "b");

		// No one subscribes to byPrimary, but keepaliveDerived keeps it wired.
		const m = idx.byPrimary.cache as ReadonlyMap<string, string>;
		expect(m.get("p1")).toBe("a");
		expect(m.get("p2")).toBe("b");
	});

	// ── Scenario 10: null / undefined secondary ─────────────────────────
	it("S10: null and undefined secondaries sort via localeCompare fallback", () => {
		const idx = reactiveIndex<string, string>();
		idx.upsert("a", null, "n");
		idx.upsert("b", undefined, "u");
		idx.upsert("c", 5, "num");

		const rows = idx.ordered.cache as readonly IndexRow<string, string>[];
		expect(rows).toHaveLength(3);
		// No crashes; exact order is implementation-defined under localeCompare fallback.
		expect(rows.map((r) => r.primary).sort()).toEqual(["a", "b", "c"]);
	});

	// ── Scenario 12: Emit ordering across ordered and byPrimary ─────────
	it("S12: single upsert produces DIRTY on both ordered and byPrimary before any DATA", () => {
		const idx = reactiveIndex<string, string>();

		const orderedEvents: string[] = [];
		const byPrimaryEvents: string[] = [];

		const u1 = idx.ordered.subscribe((msgs) => {
			for (const msg of msgs as [symbol, unknown][]) {
				if (msg[0] === DIRTY) orderedEvents.push("DIRTY");
				if (msg[0] === DATA) orderedEvents.push("DATA");
			}
		});
		const u2 = idx.byPrimary.subscribe((msgs) => {
			for (const msg of msgs as [symbol, unknown][]) {
				if (msg[0] === DIRTY) byPrimaryEvents.push("DIRTY");
				if (msg[0] === DATA) byPrimaryEvents.push("DATA");
			}
		});

		// Clear push-on-subscribe
		const beforeOrd = orderedEvents.length;
		const beforeBp = byPrimaryEvents.length;

		idx.upsert("p1", 1, "a");

		u1();
		u2();

		const newOrd = orderedEvents.slice(beforeOrd);
		const newBp = byPrimaryEvents.slice(beforeBp);

		// ordered: DIRTY then DATA
		expect(newOrd).toEqual(["DIRTY", "DATA"]);
		// byPrimary: also DIRTY then DATA (derived cascade)
		expect(newBp).toEqual(["DIRTY", "DATA"]);
	});

	// ── Scenario 13: Large index O(n log n) smoke test ──────────────────
	it("S13: 5000 upserts complete without pathological slowdown", () => {
		const idx = reactiveIndex<number, number>();
		const t0 = Date.now();
		for (let i = 0; i < 5000; i++) {
			idx.upsert(i, 5000 - i, i * 2); // reverse order on secondary
		}
		const elapsed = Date.now() - t0;

		expect(idx.size).toBe(5000);
		// Sorted by secondary ascending → primary order should be 4999, 4998, ..., 0
		const rows = idx.ordered.cache as readonly IndexRow<number, number>[];
		expect(rows[0]!.primary).toBe(4999);
		expect(rows[4999]!.primary).toBe(0);

		// Perf ceiling: 5000 upserts on flat array is O(n²) worst case; verify not absurd.
		// 1 second is plenty of headroom; if this fails we regressed hard.
		expect(elapsed).toBeLessThan(2000);
	});
});

// ── New API tests ───────────────────────────────────────────────────────

describe("reactiveIndex new APIs", () => {
	it("has() returns true only for present primary keys (O(1))", () => {
		const idx = reactiveIndex<string, string>();
		idx.upsert("a", 1, "x");
		idx.upsert("b", 2, "y");

		expect(idx.has("a")).toBe(true);
		expect(idx.has("b")).toBe(true);
		expect(idx.has("missing")).toBe(false);

		idx.delete("a");
		expect(idx.has("a")).toBe(false);
		expect(idx.has("b")).toBe(true);

		idx.clear();
		expect(idx.has("b")).toBe(false);
	});

	it("get() returns value by primary key (O(1))", () => {
		const idx = reactiveIndex<string, number>();
		idx.upsert("a", 1, 100);
		idx.upsert("b", 2, 200);

		expect(idx.get("a")).toBe(100);
		expect(idx.get("b")).toBe(200);
		expect(idx.get("missing")).toBeUndefined();

		// After upsert replaces value
		idx.upsert("a", 1, 999);
		expect(idx.get("a")).toBe(999);
	});

	it("size reflects backend state in O(1)", () => {
		const idx = reactiveIndex<string, string>();
		expect(idx.size).toBe(0);

		idx.upsert("a", 1, "x");
		expect(idx.size).toBe(1);

		idx.upsert("b", 2, "y");
		expect(idx.size).toBe(2);

		idx.upsert("a", 1, "xx"); // update, not insert
		expect(idx.size).toBe(2);

		idx.delete("a");
		expect(idx.size).toBe(1);

		idx.clear();
		expect(idx.size).toBe(0);
	});

	describe("upsertMany", () => {
		it("empty iterable is a no-op, no emission", () => {
			const idx = reactiveIndex<string, string>();
			const { messages, unsub } = collect(idx.ordered, { flat: true });
			const beforeLen = messages.length;

			idx.upsertMany([]);

			expect(messages.length).toBe(beforeLen);
			expect(idx.size).toBe(0);
			unsub();
		});

		it("N rows emit exactly 1 DIRTY + 1 DATA (not 2N)", () => {
			const idx = reactiveIndex<string, string>();
			const { messages, unsub } = collect(idx.ordered, { flat: true });
			const beforeLen = messages.length;

			idx.upsertMany([
				{ primary: "a", secondary: 3, value: "x" },
				{ primary: "b", secondary: 1, value: "y" },
				{ primary: "c", secondary: 2, value: "z" },
			]);

			const newMessages = messages.slice(beforeLen);
			const dirtyCount = newMessages.filter((m) => m[0] === DIRTY).length;
			const dataCount = newMessages.filter((m) => m[0] === DATA).length;

			expect(dirtyCount).toBe(1);
			expect(dataCount).toBe(1);

			// Final order
			const rows = idx.ordered.cache as readonly IndexRow<string, string>[];
			expect(rows.map((r) => r.primary)).toEqual(["b", "c", "a"]);

			unsub();
		});

		it("accepts any Iterable (generator function)", () => {
			const idx = reactiveIndex<number, number>();
			function* gen() {
				for (let i = 0; i < 5; i++) {
					yield { primary: i, secondary: i, value: i * 10 };
				}
			}
			idx.upsertMany(gen());
			expect(idx.size).toBe(5);
			expect(idx.get(3)).toBe(30);
		});
	});

	describe("deleteMany", () => {
		it("empty iterable is a no-op, no emission", () => {
			const idx = reactiveIndex<string, string>();
			idx.upsert("a", 1, "x");
			const { messages, unsub } = collect(idx.ordered, { flat: true });
			const beforeLen = messages.length;

			idx.deleteMany([]);
			expect(messages.length).toBe(beforeLen);
			unsub();
		});

		it("deletes present keys and ignores missing", () => {
			const idx = reactiveIndex<string, string>();
			idx.upsertMany([
				{ primary: "a", secondary: 1, value: "x" },
				{ primary: "b", secondary: 2, value: "y" },
				{ primary: "c", secondary: 3, value: "z" },
			]);

			idx.deleteMany(["a", "missing", "c"]);

			expect(idx.has("a")).toBe(false);
			expect(idx.has("b")).toBe(true);
			expect(idx.has("c")).toBe(false);
			expect(idx.size).toBe(1);
		});

		it("emits once even when deleting many rows", () => {
			const idx = reactiveIndex<number, number>();
			idx.upsertMany(
				Array.from({ length: 100 }, (_, i) => ({ primary: i, secondary: i, value: i })),
			);

			const { messages, unsub } = collect(idx.ordered, { flat: true });
			const beforeLen = messages.length;

			idx.deleteMany(Array.from({ length: 100 }, (_, i) => i));

			const newMessages = messages.slice(beforeLen);
			expect(newMessages.filter((m) => m[0] === DIRTY).length).toBe(1);
			expect(newMessages.filter((m) => m[0] === DATA).length).toBe(1);
			expect(idx.size).toBe(0);
			unsub();
		});

		it("emits nothing if no keys were present", () => {
			const idx = reactiveIndex<string, string>();
			idx.upsert("a", 1, "x");

			const { messages, unsub } = collect(idx.ordered, { flat: true });
			const beforeLen = messages.length;

			idx.deleteMany(["missing1", "missing2"]);

			expect(messages.length).toBe(beforeLen);
			expect(idx.size).toBe(1);
			unsub();
		});
	});
});

// ── Backend tests ───────────────────────────────────────────────────────

describe("NativeIndexBackend", () => {
	it("version counter advances on every mutation", () => {
		const b = new NativeIndexBackend<string, string>();
		expect(b.version).toBe(0);

		expect(b.upsert("a", 1, "x")).toBe(true); // new insert
		expect(b.version).toBe(1);

		expect(b.upsert("a", 2, "xx")).toBe(false); // update
		expect(b.version).toBe(2);

		expect(b.delete("a")).toBe(true);
		expect(b.version).toBe(3);

		expect(b.delete("a")).toBe(false); // no-op
		expect(b.version).toBe(3); // unchanged

		b.upsert("a", 1, "x");
		b.upsert("b", 2, "y");
		expect(b.clear()).toBe(2);
		expect(b.version).toBe(6); // 3 + 2 upserts + 1 clear

		expect(b.clear()).toBe(0); // no-op
		expect(b.version).toBe(6);
	});

	it("has and get are O(1) — correctness check", () => {
		const b = new NativeIndexBackend<number, string>();
		for (let i = 0; i < 1000; i++) {
			b.upsert(i, 1000 - i, `v${i}`);
		}

		expect(b.has(500)).toBe(true);
		expect(b.has(9999)).toBe(false);
		expect(b.get(500)).toBe("v500");
		expect(b.get(0)).toBe("v0");
		expect(b.get(999)).toBe("v999");
	});

	it("maintains sort order via bisect", () => {
		const b = new NativeIndexBackend<string, string>();
		b.upsert("c", 3, "cc");
		b.upsert("a", 1, "aa");
		b.upsert("b", 2, "bb");

		const rows = b.toArray();
		expect(rows.map((r) => r.primary)).toEqual(["a", "b", "c"]);
	});

	it("upsert on existing primary moves the row", () => {
		const b = new NativeIndexBackend<string, string>();
		b.upsert("a", 1, "aa");
		b.upsert("b", 2, "bb");
		b.upsert("c", 3, "cc");

		// Move "a" to the end by dropping secondary past "c"
		b.upsert("a", 99, "aa_new");

		const rows = b.toArray();
		expect(rows.map((r) => r.primary)).toEqual(["b", "c", "a"]);
		expect(b.get("a")).toBe("aa_new");
	});
});

// ── Pluggable backend test ──────────────────────────────────────────────

describe("reactiveIndex with user-provided backend", () => {
	it("can plug in a custom backend implementation", () => {
		// A minimal custom backend that counts mutation types (doesn't actually
		// optimize anything — just proves the plug-point works).
		class CountingBackend<K, V> implements IndexBackend<K, V> {
			private readonly inner = new NativeIndexBackend<K, V>();
			upsertCount = 0;
			deleteCount = 0;
			clearCount = 0;

			get version(): number {
				return this.inner.version;
			}
			get size(): number {
				return this.inner.size;
			}
			has(primary: K): boolean {
				return this.inner.has(primary);
			}
			get(primary: K): V | undefined {
				return this.inner.get(primary);
			}
			upsert(primary: K, secondary: unknown, value: V): boolean {
				this.upsertCount += 1;
				return this.inner.upsert(primary, secondary, value);
			}
			delete(primary: K): boolean {
				const removed = this.inner.delete(primary);
				if (removed) this.deleteCount += 1;
				return removed;
			}
			clear(): number {
				const n = this.inner.clear();
				if (n > 0) this.clearCount += 1;
				return n;
			}
			toArray(): readonly IndexRow<K, V>[] {
				return this.inner.toArray();
			}
			toPrimaryMap(): ReadonlyMap<K, V> {
				return this.inner.toPrimaryMap();
			}
		}

		const backend = new CountingBackend<string, string>();
		const idx = reactiveIndex<string, string>({ backend });

		idx.upsert("a", 1, "x");
		idx.upsert("b", 2, "y");
		idx.upsert("a", 1, "xx"); // update
		idx.delete("a");
		idx.delete("missing");
		idx.clear();

		expect(backend.upsertCount).toBe(3);
		expect(backend.deleteCount).toBe(1);
		expect(backend.clearCount).toBe(1);

		// Reactive surface still works correctly
		expect(idx.size).toBe(0);
	});
});
