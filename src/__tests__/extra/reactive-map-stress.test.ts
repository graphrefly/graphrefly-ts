/**
 * Stress tests for reactiveMap — Wave 4 audit scenarios.
 *
 * Covers: rapid mutations, read-triggered emission, size-getter asymmetry,
 * LRU under concurrent reads, diamond topology, TTL precision,
 * maxSize=1, subscriber-during-batch, and empty-map no-ops.
 */
import { describe, expect, it, vi } from "vitest";
import { batch } from "../../core/batch.js";
import { DATA, DIRTY } from "../../core/messages.js";
import { derived } from "../../core/sugar.js";
import { combine } from "../../extra/operators.js";
import { type MapBackend, NativeMapBackend, reactiveMap } from "../../extra/reactive-map.js";
import { collect } from "../test-helpers.js";

describe("reactiveMap stress tests", () => {
	// ── Scenario 1: Rapid set/delete cycle ──────────────────────────────
	it("S1: rapid set then delete — each mutation emits DIRTY+DATA", () => {
		const m = reactiveMap<number, number>();
		const { messages, unsub } = collect(m.entries, { flat: true });

		const N = 100;
		for (let i = 0; i < N; i++) m.set(i, i);
		for (let i = 0; i < N; i++) m.delete(i);

		unsub();

		// Each set and each delete (that finds a key) emits DIRTY+DATA.
		// Total mutations: N sets + N deletes = 2N pushSnapshot calls.
		// Each pushSnapshot produces 1 DIRTY + 1 DATA = 2 messages.
		// Plus initial push-on-subscribe DATA.
		const dirtyCount = messages.filter((m) => m[0] === DIRTY).length;
		const dataCount = messages.filter((m) => m[0] === DATA).length;

		expect(dirtyCount).toBe(N * 2); // 100 sets + 100 deletes
		expect(dataCount).toBe(N * 2 + 1); // +1 for push-on-subscribe

		// Final snapshot should be empty
		const lastData = messages.filter((m) => m[0] === DATA).at(-1)!;
		expect((lastData[1] as ReadonlyMap<number, number>).size).toBe(0);
	});

	// ── Scenario 2: Read-triggered emission inside a batch ──────────────
	it("S2: get() on expired key inside outer batch — nested batch correctness", () => {
		vi.useFakeTimers();
		const m = reactiveMap<string, number>();
		m.set("a", 1, { ttl: 1 });

		const { messages, unsub } = collect(m.entries, { flat: true });
		const beforeLen = messages.length;

		vi.advanceTimersByTime(1500);

		// get() inside an outer batch should still emit correctly
		batch(() => {
			const val = m.get("a"); // expired → triggers pushSnapshot inside
			expect(val).toBeUndefined();
			m.set("b", 2); // another mutation in same outer batch
		});

		unsub();
		vi.useRealTimers();

		// Both the expiry-triggered snapshot and the set("b") snapshot should have emitted.
		const newMessages = messages.slice(beforeLen);
		const dirtyCount = newMessages.filter((m) => m[0] === DIRTY).length;
		const dataCount = newMessages.filter((m) => m[0] === DATA).length;

		// Inside the outer batch, two pushSnapshot calls happen.
		// The nested batches accumulate; drain happens when outer batch closes.
		expect(dirtyCount).toBe(2);
		expect(dataCount).toBe(2);

		// Final state should have only "b"
		const lastData = newMessages.filter((m) => m[0] === DATA).at(-1)!;
		const snap = lastData[1] as ReadonlyMap<string, number>;
		expect(snap.has("a")).toBe(false);
		expect(snap.get("b")).toBe(2);
	});

	// ── Scenario 3: size is a pure read — D2(a), spec §5.8 compliance ───
	it("S3: size is a pure read (no side-effect emission, includes not-yet-pruned expired)", () => {
		vi.useFakeTimers();
		const m = reactiveMap<string, number>();
		m.set("a", 1, { ttl: 1 });
		m.set("b", 2); // no TTL

		const { messages, unsub } = collect(m.entries, { flat: true });
		const beforeLen = messages.length;

		vi.advanceTimersByTime(1500);

		// D2(a): .size is now a pure read — no pruning, no emission. Raw
		// store count includes the not-yet-pruned expired "a".
		const sz = m.size;
		expect(sz).toBe(2);

		// No messages emitted from the size read.
		expect(messages.length).toBe(beforeLen);

		// Explicit pruneExpired() delivers the live count + one snapshot emit.
		m.pruneExpired();
		expect(m.size).toBe(1);
		const afterPrune = messages.slice(beforeLen);
		expect(afterPrune.filter((msg) => msg[0] === DIRTY).length).toBe(1);
		expect(afterPrune.filter((msg) => msg[0] === DATA).length).toBe(1);

		// entries.cache is fresh post-prune.
		const cached = m.entries.cache as ReadonlyMap<string, number>;
		expect(cached.has("a")).toBe(false);
		expect(cached.size).toBe(1);
		expect(cached.get("b")).toBe(2);

		// Subsequent size access: nothing to prune, pure read, no emission.
		const afterReadLen = messages.length;
		expect(m.size).toBe(1);
		expect(messages.length).toBe(afterReadLen);

		unsub();
		vi.useRealTimers();
	});

	// ── Scenario 4: LRU under interleaved reads ─────────────────────────
	it("S4: interleaved get() calls reorder LRU correctly", () => {
		const m = reactiveMap<string, number>({ maxSize: 3 });
		m.set("a", 1);
		m.set("b", 2);
		m.set("c", 3);

		// Touch "a" (oldest) — moves it to end of LRU
		m.get("a");

		// Now LRU order is: b, c, a
		// Adding "d" should evict "b" (oldest untouched)
		m.set("d", 4);
		expect(m.has("a")).toBe(true);
		expect(m.has("b")).toBe(false); // evicted
		expect(m.has("c")).toBe(true);
		expect(m.has("d")).toBe(true);

		// Touch "c", then add "e" — should evict "a" (now oldest)
		m.get("c");
		// LRU order: a, d, c (after get("c") moved it to end)
		// Wait, after set("d"), order was: c, a, d
		// After get("c"): a, d, c
		m.set("e", 5);
		// Should evict "a" (first in iteration order)
		expect(m.has("a")).toBe(false); // evicted
		expect(m.has("c")).toBe(true);
		expect(m.has("d")).toBe(true);
		expect(m.has("e")).toBe(true);
	});

	// ── Scenario 5: Diamond topology — glitch-free ──────────────────────
	it("S5: diamond through two derived nodes — consistent settle", () => {
		const m = reactiveMap<string, number>();
		m.set("x", 10);

		// Two derived nodes from the same entries source
		const left = derived(
			[m.entries],
			([snap]) => {
				const s = snap as ReadonlyMap<string, number>;
				return s.get("x") ?? 0;
			},
			{ initial: 10 },
		);
		const right = derived(
			[m.entries],
			([snap]) => {
				const s = snap as ReadonlyMap<string, number>;
				return (s.get("x") ?? 0) * 2;
			},
			{ initial: 20 },
		);

		// Combine — should never see inconsistent (left, right) pair
		const combined = combine(left, right);
		const seen: [number, number][] = [];
		const unsub = combined.subscribe((msgs) => {
			for (const msg of msgs as [symbol, unknown][]) {
				if (msg[0] === DATA) {
					seen.push(msg[1] as [number, number]);
				}
			}
		});

		m.set("x", 20);
		m.set("x", 30);

		unsub();

		// Every observed pair should be consistent: right === left * 2
		for (const [l, r] of seen) {
			expect(r).toBe(l * 2);
		}
		// We should have seen the initial (push-on-subscribe) plus at least the final state
		expect(seen.length).toBeGreaterThanOrEqual(1);
		expect(seen.at(-1)).toEqual([30, 60]);
	});

	// ── Scenario 6: TTL with fake timers — lazy eviction ────────────────
	it("S6: TTL lazy eviction via get/has/pruneExpired", () => {
		vi.useFakeTimers();
		const m = reactiveMap<string, number>();
		m.set("a", 1, { ttl: 2 });
		m.set("b", 2, { ttl: 5 });

		// Before expiry — both present
		expect(m.get("a")).toBe(1);
		expect(m.has("b")).toBe(true);

		// Advance past "a" TTL but before "b"
		vi.advanceTimersByTime(3000);

		// get("a") should find it expired and trigger emission
		const { messages, unsub } = collect(m.entries, { flat: true });
		const val = m.get("a");
		expect(val).toBeUndefined();

		// An emission should have occurred (get found expired key)
		const dataAfterExpiry = messages.filter((msg) => msg[0] === DATA);
		// push-on-subscribe + expiry emission
		expect(dataAfterExpiry.length).toBeGreaterThanOrEqual(2);

		// "b" should still be alive
		expect(m.has("b")).toBe(true);

		// Advance past "b" TTL
		vi.advanceTimersByTime(3000);
		m.pruneExpired();
		expect(m.size).toBe(0);

		unsub();
		vi.useRealTimers();
	});

	// ── Scenario 7: maxSize=1 ───────────────────────────────────────────
	it("S7: maxSize=1 — second set evicts first", () => {
		const m = reactiveMap<string, number>({ maxSize: 1 });
		m.set("a", 1);
		m.set("b", 2);

		expect(m.has("a")).toBe(false);
		expect(m.get("b")).toBe(2);
		expect(m.size).toBe(1);

		// Verify snapshot consistency
		const snap = m.entries.cache as ReadonlyMap<string, number>;
		expect(snap.size).toBe(1);
		expect(snap.get("b")).toBe(2);
	});

	// ── Scenario 8: Subscriber during pushSnapshot ──────────────────────
	it("S8: new subscriber gets push-on-subscribe (cached state)", () => {
		const m = reactiveMap<string, number>();
		m.set("x", 42);

		// Subscribe AFTER mutation — should get cached snapshot via push-on-subscribe
		const { messages, unsub } = collect(m.entries, { flat: true });

		// First message should be DATA with the current snapshot (push-on-subscribe)
		const firstData = messages.find((msg) => msg[0] === DATA);
		expect(firstData).toBeDefined();
		const snap = firstData![1] as ReadonlyMap<string, number>;
		expect(snap.get("x")).toBe(42);

		unsub();
	});

	// ── Scenario 9: TTL precision at boundary ───────────────────────────
	it("S9: key expires at exactly expiresAt (>= comparison)", () => {
		vi.useFakeTimers();
		const m = reactiveMap<string, number>();
		m.set("a", 1, { ttl: 1 });

		// At exactly 1000ms — should be expired (>= comparison)
		vi.advanceTimersByTime(1000);
		expect(m.get("a")).toBeUndefined();

		vi.useRealTimers();
	});

	// ── Scenario 10: Empty map no-ops ───────────────────────────────────
	it("S10: clear on empty map and delete on missing key are no-ops", () => {
		const m = reactiveMap<string, number>();
		const { messages, unsub } = collect(m.entries, { flat: true });
		const beforeLen = messages.length;

		m.clear(); // no-op: already empty
		m.delete("nonexistent"); // no-op: key doesn't exist

		expect(messages.length).toBe(beforeLen); // no new messages

		unsub();
	});

	// ── Additional: throws on non-positive TTL ──────────────────────────
	it("throws RangeError on ttl <= 0", () => {
		const m = reactiveMap<string, number>();
		expect(() => m.set("a", 1, { ttl: 0 })).toThrow(RangeError);
		expect(() => m.set("a", 1, { ttl: -1 })).toThrow(RangeError);
	});

	// ── Additional: concurrent set doesn't double-emit ──────────────────
	it("set on existing key emits exactly one DIRTY+DATA pair", () => {
		const m = reactiveMap<string, number>();
		m.set("a", 1);

		const { messages, unsub } = collect(m.entries, { flat: true });
		const beforeLen = messages.length;

		m.set("a", 2); // overwrite

		const newMessages = messages.slice(beforeLen);
		const dirtyCount = newMessages.filter((msg) => msg[0] === DIRTY).length;
		const dataCount = newMessages.filter((msg) => msg[0] === DATA).length;

		expect(dirtyCount).toBe(1);
		expect(dataCount).toBe(1);

		const snap = newMessages.find((msg) => msg[0] === DATA)![1] as ReadonlyMap<string, number>;
		expect(snap.get("a")).toBe(2);

		unsub();
	});
});

// ── New API tests ───────────────────────────────────────────────────────

describe("reactiveMap new APIs", () => {
	describe("setMany", () => {
		it("empty iterable is a no-op, no emission", () => {
			const m = reactiveMap<string, number>();
			const { messages, unsub } = collect(m.entries, { flat: true });
			const beforeLen = messages.length;

			m.setMany([]);

			expect(messages.length).toBe(beforeLen);
			expect(m.size).toBe(0);
			unsub();
		});

		it("N entries emit exactly 1 DIRTY + 1 DATA (not 2N)", () => {
			const m = reactiveMap<string, number>();
			const { messages, unsub } = collect(m.entries, { flat: true });
			const beforeLen = messages.length;

			m.setMany([
				["a", 1],
				["b", 2],
				["c", 3],
			]);

			const newMessages = messages.slice(beforeLen);
			expect(newMessages.filter((msg) => msg[0] === DIRTY).length).toBe(1);
			expect(newMessages.filter((msg) => msg[0] === DATA).length).toBe(1);

			const snap = newMessages.find((msg) => msg[0] === DATA)![1] as ReadonlyMap<string, number>;
			expect(snap.size).toBe(3);
			expect(snap.get("a")).toBe(1);
			expect(snap.get("b")).toBe(2);
			expect(snap.get("c")).toBe(3);

			unsub();
		});

		it("applies batch TTL to all entries", () => {
			vi.useFakeTimers();
			const m = reactiveMap<string, number>();
			m.setMany(
				[
					["a", 1],
					["b", 2],
				],
				{ ttl: 2 },
			);
			expect(m.get("a")).toBe(1);
			expect(m.get("b")).toBe(2);

			vi.advanceTimersByTime(3000);
			expect(m.get("a")).toBeUndefined();
			expect(m.get("b")).toBeUndefined();

			vi.useRealTimers();
		});

		it("throws on invalid TTL", () => {
			const m = reactiveMap<string, number>();
			expect(() => m.setMany([["a", 1]], { ttl: 0 })).toThrow(RangeError);
			expect(() => m.setMany([["a", 1]], { ttl: -1 })).toThrow(RangeError);
		});

		it("accepts generator", () => {
			const m = reactiveMap<number, number>();
			function* gen(): Generator<[number, number]> {
				for (let i = 0; i < 5; i++) yield [i, i * 10];
			}
			m.setMany(gen());
			expect(m.size).toBe(5);
			expect(m.get(3)).toBe(30);
		});
	});

	describe("deleteMany", () => {
		it("empty iterable is a no-op, no emission", () => {
			const m = reactiveMap<string, number>();
			m.set("a", 1);
			const { messages, unsub } = collect(m.entries, { flat: true });
			const beforeLen = messages.length;

			m.deleteMany([]);
			expect(messages.length).toBe(beforeLen);
			unsub();
		});

		it("deletes present keys and ignores missing", () => {
			const m = reactiveMap<string, number>();
			m.setMany([
				["a", 1],
				["b", 2],
				["c", 3],
			]);

			m.deleteMany(["a", "missing", "c"]);

			expect(m.has("a")).toBe(false);
			expect(m.has("b")).toBe(true);
			expect(m.has("c")).toBe(false);
			expect(m.size).toBe(1);
		});

		it("emits once for N deletions", () => {
			const m = reactiveMap<number, number>();
			m.setMany(Array.from({ length: 50 }, (_, i) => [i, i] as [number, number]));

			const { messages, unsub } = collect(m.entries, { flat: true });
			const beforeLen = messages.length;

			m.deleteMany(Array.from({ length: 50 }, (_, i) => i));

			const newMessages = messages.slice(beforeLen);
			expect(newMessages.filter((msg) => msg[0] === DIRTY).length).toBe(1);
			expect(newMessages.filter((msg) => msg[0] === DATA).length).toBe(1);
			expect(m.size).toBe(0);
			unsub();
		});

		it("emits nothing if no keys were present", () => {
			const m = reactiveMap<string, number>();
			m.set("a", 1);

			const { messages, unsub } = collect(m.entries, { flat: true });
			const beforeLen = messages.length;

			m.deleteMany(["x", "y"]);

			expect(messages.length).toBe(beforeLen);
			expect(m.size).toBe(1);
			unsub();
		});
	});
});

// ── Native backend direct tests ────────────────────────────────────────

describe("NativeMapBackend", () => {
	it("version counter advances on every state-changing op", () => {
		const b = new NativeMapBackend<string, number>();
		expect(b.version).toBe(0);

		b.set("a", 1);
		expect(b.version).toBe(1);

		b.set("a", 2); // update (still a mutation)
		expect(b.version).toBe(2);

		expect(b.delete("a")).toBe(true);
		expect(b.version).toBe(3);

		expect(b.delete("a")).toBe(false); // missing → no version bump
		expect(b.version).toBe(3);

		b.set("a", 1);
		b.set("b", 2);
		expect(b.clear()).toBe(2);
		expect(b.version).toBe(6);

		expect(b.clear()).toBe(0); // no-op
		expect(b.version).toBe(6);
	});

	it("get/has on expired key bumps version (for wrapper emission)", () => {
		vi.useFakeTimers();
		const b = new NativeMapBackend<string, number>();
		b.set("a", 1, 1);
		const before = b.version;

		vi.advanceTimersByTime(1500);

		expect(b.get("a")).toBeUndefined();
		expect(b.version).toBeGreaterThan(before); // pruned → version advanced

		vi.useRealTimers();
	});

	it("get/has on live key does NOT bump version (LRU touch is internal)", () => {
		const b = new NativeMapBackend<string, number>();
		b.set("a", 1);
		const after = b.version;

		b.get("a");
		expect(b.version).toBe(after);

		b.has("a");
		expect(b.version).toBe(after);
	});

	it("maxSize eviction drops first-inserted key", () => {
		const b = new NativeMapBackend<string, number>({ maxSize: 2 });
		b.set("a", 1);
		b.set("b", 2);
		b.set("c", 3);

		expect(b.has("a")).toBe(false); // evicted
		expect(b.has("b")).toBe(true);
		expect(b.has("c")).toBe(true);
	});

	it("LRU touch via get changes eviction target", () => {
		const b = new NativeMapBackend<string, number>({ maxSize: 2 });
		b.set("a", 1);
		b.set("b", 2);
		b.get("a"); // touches a → now LRU is: b, a
		b.set("c", 3); // should evict b

		expect(b.has("a")).toBe(true);
		expect(b.has("b")).toBe(false);
		expect(b.has("c")).toBe(true);
	});

	it("constructor validates options", () => {
		expect(() => new NativeMapBackend<string, number>({ maxSize: 0 })).toThrow(RangeError);
		expect(() => new NativeMapBackend<string, number>({ defaultTtl: 0 })).toThrow(RangeError);
		expect(() => new NativeMapBackend<string, number>({ defaultTtl: -1 })).toThrow(RangeError);
	});

	it("defaultTtl applies when set() omits ttl", () => {
		vi.useFakeTimers();
		const b = new NativeMapBackend<string, number>({ defaultTtl: 0.1 });
		b.set("a", 1);
		vi.advanceTimersByTime(150);
		expect(b.get("a")).toBeUndefined();
		vi.useRealTimers();
	});
});

// ── Pluggable backend ──────────────────────────────────────────────────

describe("reactiveMap with user-provided backend", () => {
	it("can plug in a custom backend implementation", () => {
		class CountingMapBackend<K, V> implements MapBackend<K, V> {
			private readonly inner = new NativeMapBackend<K, V>();
			setCount = 0;
			deleteCount = 0;
			clearCount = 0;

			get version(): number {
				return this.inner.version;
			}
			get size(): number {
				return this.inner.size;
			}
			has(k: K): boolean {
				return this.inner.has(k);
			}
			get(k: K): V | undefined {
				return this.inner.get(k);
			}
			set(k: K, v: V, ttl?: number): void {
				this.setCount += 1;
				this.inner.set(k, v, ttl);
			}
			delete(k: K): boolean {
				const had = this.inner.delete(k);
				if (had) this.deleteCount += 1;
				return had;
			}
			clear(): number {
				const n = this.inner.clear();
				if (n > 0) this.clearCount += 1;
				return n;
			}
			pruneExpired(): number {
				return this.inner.pruneExpired();
			}
			toMap(): ReadonlyMap<K, V> {
				return this.inner.toMap();
			}
		}

		const backend = new CountingMapBackend<string, number>();
		const m = reactiveMap<string, number>({ backend });

		m.set("a", 1);
		m.set("b", 2);
		m.set("a", 11); // update
		m.delete("a");
		m.delete("missing");
		m.clear();

		expect(backend.setCount).toBe(3);
		expect(backend.deleteCount).toBe(1);
		expect(backend.clearCount).toBe(1);

		expect(m.size).toBe(0);
	});
});
