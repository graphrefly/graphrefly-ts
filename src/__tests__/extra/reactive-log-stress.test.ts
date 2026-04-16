/**
 * Stress tests for reactiveLog — Wave 4 audit scenarios + new APIs.
 *
 * Covers: unbounded append, ring-buffer trim under maxSize, appendMany atomicity,
 * seed oversize, trimHead edges, tail memoization, slice semantics, diamond,
 * size/at getters, pluggable backend, version counter advance.
 */
import { describe, expect, it } from "vitest";
import { DATA, DIRTY } from "../../core/messages.js";
import { combine } from "../../extra/operators.js";
import { type LogBackend, NativeLogBackend, reactiveLog } from "../../extra/reactive-log.js";
import { collect } from "../test-helpers.js";

describe("reactiveLog stress tests", () => {
	// ── Scenario 1: Append stress, unbounded ───────────────────────────
	it("S1: 1000 appends (unbounded) — all preserved in order", () => {
		const lg = reactiveLog<number>();
		const { messages, unsub } = collect(lg.entries, { flat: true });

		for (let i = 0; i < 1000; i++) lg.append(i);
		unsub();

		expect(messages.filter((m) => m[0] === DIRTY).length).toBe(1000);
		expect(messages.filter((m) => m[0] === DATA).length).toBe(1001); // +1 push-on-subscribe

		const last = messages.filter((m) => m[0] === DATA).at(-1)!;
		const snap = last[1] as readonly number[];
		expect(snap.length).toBe(1000);
		expect(snap[0]).toBe(0);
		expect(snap[999]).toBe(999);
	});

	// ── Scenario 2: Append stress with maxSize=10 — sliding window ─────
	it("S2: 1000 appends with maxSize=10 — sliding window, each append emits", () => {
		const lg = reactiveLog<number>([], { maxSize: 10 });
		const { messages, unsub } = collect(lg.entries, { flat: true });

		for (let i = 0; i < 1000; i++) lg.append(i);
		unsub();

		expect(messages.filter((m) => m[0] === DIRTY).length).toBe(1000);
		expect(messages.filter((m) => m[0] === DATA).length).toBe(1001);

		// Final snapshot is last 10 values
		const last = messages.filter((m) => m[0] === DATA).at(-1)!;
		const snap = last[1] as readonly number[];
		expect(snap.length).toBe(10);
		expect(snap[0]).toBe(990);
		expect(snap[9]).toBe(999);

		// Size is bounded
		expect(lg.size).toBe(10);
	});

	// ── Scenario 3: appendMany atomicity with maxSize trim ─────────────
	it("S3: appendMany of 100 values with maxSize=10 — single snapshot, final tail", () => {
		const lg = reactiveLog<number>([], { maxSize: 10 });
		const { messages, unsub } = collect(lg.entries, { flat: true });
		const beforeLen = messages.length;

		const input = Array.from({ length: 100 }, (_, i) => i);
		lg.appendMany(input);

		const newMessages = messages.slice(beforeLen);
		expect(newMessages.filter((m) => m[0] === DIRTY).length).toBe(1);
		expect(newMessages.filter((m) => m[0] === DATA).length).toBe(1);

		const snap = newMessages.find((m) => m[0] === DATA)![1] as readonly number[];
		expect(snap).toEqual([90, 91, 92, 93, 94, 95, 96, 97, 98, 99]);

		unsub();
	});

	// ── Scenario 4: Seed larger than maxSize — pre-trimmed ─────────────
	it("S4: seed larger than maxSize — initial value is pre-trimmed tail", () => {
		const seed = Array.from({ length: 20 }, (_, i) => i + 1); // [1..20]
		const lg = reactiveLog<number>(seed, { maxSize: 5 });

		// Initial state exposed via entries.cache
		expect(lg.size).toBe(5);
		expect(lg.entries.cache).toEqual([16, 17, 18, 19, 20]);
	});

	// ── Scenario 5: trimHead edge cases ────────────────────────────────
	it("S5: trimHead n=0 no-op, n=length clears, n>length clamped, n<0 throws", () => {
		const lg = reactiveLog<number>([1, 2, 3, 4, 5]);
		const { messages, unsub } = collect(lg.entries, { flat: true });
		const beforeLen = messages.length;

		// n=0: no-op
		lg.trimHead(0);
		expect(messages.length).toBe(beforeLen);
		expect(lg.size).toBe(5);

		// n=2: removes [1, 2]
		lg.trimHead(2);
		expect(lg.entries.cache).toEqual([3, 4, 5]);
		expect(lg.size).toBe(3);

		// n>length: clamped to clear
		lg.trimHead(100);
		expect(lg.size).toBe(0);

		// n<0: throws
		expect(() => lg.trimHead(-1)).toThrow(RangeError);

		unsub();
	});

	// ── Scenario 6: tail(n) correctness over time ──────────────────────
	it("S6: tail(n) always reflects the last n entries", () => {
		const lg = reactiveLog<number>([1, 2, 3]);
		const last2 = lg.tail(2);
		expect(last2.cache).toEqual([2, 3]);

		lg.append(4);
		expect(last2.cache).toEqual([3, 4]);

		lg.append(5);
		expect(last2.cache).toEqual([4, 5]);

		// Trim cascade
		lg.trimHead(4); // only [5] left
		expect(last2.cache).toEqual([5]);

		lg.clear();
		expect(last2.cache).toEqual([]);
	});

	// ── Scenario 7: tail(n) memoization — repeat calls return same node ─
	it("S7: tail(n) memoized — repeat calls with same n return same node", () => {
		const lg = reactiveLog<number>();
		const t1 = lg.tail(5);
		const t2 = lg.tail(5);
		const t3 = lg.tail(10); // different n

		expect(t1).toBe(t2); // identical node
		expect(t1).not.toBe(t3); // different n → different node

		// Behavior still correct
		lg.appendMany([1, 2, 3, 4, 5, 6, 7]);
		expect(t1.cache).toEqual([3, 4, 5, 6, 7]);
		expect(t3.cache).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});

	// ── Scenario 8: slice correctness ──────────────────────────────────
	it("S8: slice(start, stop) semantics match Array.prototype.slice", () => {
		const lg = reactiveLog<number>([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		const s = lg.slice(2, 5);
		expect(s.cache).toEqual([2, 3, 4]);

		// Omitting stop
		const to_end = lg.slice(7);
		expect(to_end.cache).toEqual([7, 8, 9]);

		// Negative start throws
		expect(() => lg.slice(-1, 3)).toThrow(RangeError);
	});

	// ── Scenario 9: slice across trimHead — indices shift ──────────────
	it("S9: slice [2, 5) behaves positionally after trimHead shifts indices", () => {
		const lg = reactiveLog<number>([10, 20, 30, 40, 50, 60, 70, 80]);
		const window = lg.slice(2, 5);
		expect(window.cache).toEqual([30, 40, 50]);

		// Trim first 3 → remaining is [40, 50, 60, 70, 80]
		lg.trimHead(3);
		// slice(2, 5) now refers to indices 2..4 of the NEW list: [60, 70, 80]
		expect(window.cache).toEqual([60, 70, 80]);
	});

	// ── Scenario 10: Diamond — tail + slice both derived ───────────────
	it("S10: tail and slice diamond from entries — both settle consistently", () => {
		const lg = reactiveLog<number>();
		const t = lg.tail(2);
		const s = lg.slice(0, 3);
		const combined = combine(t, s);

		const seen: [readonly number[], readonly number[]][] = [];
		const unsub = combined.subscribe((msgs) => {
			for (const msg of msgs as [symbol, unknown][]) {
				if (msg[0] === DATA) {
					seen.push(msg[1] as [readonly number[], readonly number[]]);
				}
			}
		});

		lg.appendMany([10, 20, 30, 40, 50]);
		unsub();

		// Final pair
		expect(seen.at(-1)).toEqual([
			[40, 50],
			[10, 20, 30],
		]);
	});

	// ── Scenario 11: clear after trimHead-to-empty is a no-op ──────────
	it("S11: trimHead(length) then clear() — second is no-op", () => {
		const lg = reactiveLog<number>([1, 2, 3]);
		const { messages, unsub } = collect(lg.entries, { flat: true });
		const beforeLen = messages.length;

		lg.trimHead(3); // clears
		const afterTrimLen = messages.length;
		expect(afterTrimLen).toBeGreaterThan(beforeLen);

		lg.clear(); // no-op now
		expect(messages.length).toBe(afterTrimLen);

		unsub();
	});

	// ── Scenario 12: maxSize=1 edge ────────────────────────────────────
	it("S12: maxSize=1 — continuous appends keep replacing", () => {
		const lg = reactiveLog<number>([], { maxSize: 1 });
		lg.append(1);
		expect(lg.entries.cache).toEqual([1]);
		lg.append(2);
		expect(lg.entries.cache).toEqual([2]);
		lg.append(3);
		expect(lg.entries.cache).toEqual([3]);
		expect(lg.size).toBe(1);
	});

	// ── Scenario 13: appendMany oversize input is pre-trimmed ──────────
	it("S13: appendMany skips values that would be immediately evicted", () => {
		// We can verify this indirectly: final state is last maxSize values,
		// and the snapshot is emitted exactly once.
		const lg = reactiveLog<number>([], { maxSize: 5 });
		const { messages, unsub } = collect(lg.entries, { flat: true });
		const beforeLen = messages.length;

		lg.appendMany(Array.from({ length: 1000 }, (_, i) => i));

		const newMessages = messages.slice(beforeLen);
		expect(newMessages.filter((m) => m[0] === DIRTY).length).toBe(1);
		expect(newMessages.filter((m) => m[0] === DATA).length).toBe(1);

		expect(lg.entries.cache).toEqual([995, 996, 997, 998, 999]);
		unsub();
	});

	// ── Scenario 14: Subscriber after mutations ────────────────────────
	it("S14: subscribe after mutations — push-on-subscribe delivers current state", () => {
		const lg = reactiveLog<string>();
		lg.append("a");
		lg.append("b");
		lg.append("c");

		const { messages, unsub } = collect(lg.entries, { flat: true });
		const firstData = messages.find((m) => m[0] === DATA);
		expect(firstData).toBeDefined();
		expect(firstData![1]).toEqual(["a", "b", "c"]);
		unsub();
	});

	// ── Scenario 15: tail(0) — always empty ────────────────────────────
	it("S15: tail(0) returns empty node; recomputes but always empty", () => {
		const lg = reactiveLog<number>();
		const t0 = lg.tail(0);
		expect(t0.cache).toEqual([]);

		lg.append(1);
		lg.append(2);
		expect(t0.cache).toEqual([]);
	});

	// ── Scenario 16: maxSize validation ────────────────────────────────
	it("S16: maxSize < 1 throws at construction", () => {
		expect(() => reactiveLog<number>([], { maxSize: 0 })).toThrow(RangeError);
		expect(() => reactiveLog<number>([], { maxSize: -1 })).toThrow(RangeError);
	});
});

// ── New bundle APIs ────────────────────────────────────────────────────

describe("reactiveLog new APIs", () => {
	it("size reflects backend state in O(1)", () => {
		const lg = reactiveLog<number>();
		expect(lg.size).toBe(0);

		lg.append(1);
		expect(lg.size).toBe(1);

		lg.appendMany([2, 3, 4]);
		expect(lg.size).toBe(4);

		lg.trimHead(2);
		expect(lg.size).toBe(2);

		lg.clear();
		expect(lg.size).toBe(0);
	});

	it("at(index) returns value at index, undefined on out-of-range", () => {
		const lg = reactiveLog<string>(["a", "b", "c"]);

		expect(lg.at(0)).toBe("a");
		expect(lg.at(1)).toBe("b");
		expect(lg.at(2)).toBe("c");
		expect(lg.at(3)).toBeUndefined();
		// P5: Python-style negative indexing supported (parity with reactiveList).
		expect(lg.at(-1)).toBe("c");
		expect(lg.at(-2)).toBe("b");
		expect(lg.at(-3)).toBe("a");
		expect(lg.at(-4)).toBeUndefined();
		expect(lg.at(99)).toBeUndefined();
	});

	it("at() under ring buffer — O(1) access at all positions", () => {
		const lg = reactiveLog<number>([], { maxSize: 5 });
		for (let i = 0; i < 100; i++) lg.append(i);

		// Last 5 values: 95..99
		expect(lg.at(0)).toBe(95);
		expect(lg.at(1)).toBe(96);
		expect(lg.at(4)).toBe(99);
		expect(lg.at(5)).toBeUndefined();
	});

	describe("slice memoization", () => {
		it("repeat calls with same (start, stop) return same node", () => {
			const lg = reactiveLog<number>();
			const s1 = lg.slice(2, 5);
			const s2 = lg.slice(2, 5);
			const s3 = lg.slice(2); // different — no stop
			const s4 = lg.slice(2, 5);

			expect(s1).toBe(s2);
			expect(s1).toBe(s4);
			expect(s1).not.toBe(s3);
		});
	});
});

// ── Native backend direct tests ────────────────────────────────────────

describe("NativeLogBackend", () => {
	it("version counter advances on every mutation", () => {
		const b = new NativeLogBackend<number>();
		expect(b.version).toBe(0);

		b.append(1);
		expect(b.version).toBe(1);

		b.append(2);
		expect(b.version).toBe(2);

		b.appendMany([3, 4]);
		expect(b.version).toBe(3); // one bump for the whole batch

		b.appendMany([]); // no-op
		expect(b.version).toBe(3);

		expect(b.trimHead(1)).toBe(1);
		expect(b.version).toBe(4);

		expect(b.trimHead(0)).toBe(0); // no-op
		expect(b.version).toBe(4);

		expect(b.clear()).toBe(3);
		expect(b.version).toBe(5);

		expect(b.clear()).toBe(0); // no-op
		expect(b.version).toBe(5);
	});

	it("ring buffer mode (maxSize=5) correctness", () => {
		const b = new NativeLogBackend<number>(undefined, 5);
		for (let i = 0; i < 100; i++) b.append(i);

		expect(b.size).toBe(5);
		expect(b.toArray()).toEqual([95, 96, 97, 98, 99]);
		expect(b.at(0)).toBe(95);
		expect(b.at(4)).toBe(99);
	});

	it("ring buffer — trimHead advances head index correctly", () => {
		const b = new NativeLogBackend<number>(undefined, 5);
		for (let i = 0; i < 7; i++) b.append(i); // [2, 3, 4, 5, 6] — head past start

		b.trimHead(2);
		expect(b.toArray()).toEqual([4, 5, 6]);
		expect(b.size).toBe(3);

		b.append(7);
		b.append(8);
		expect(b.toArray()).toEqual([4, 5, 6, 7, 8]);
	});

	it("slice (ring buffer mode) produces correct contiguous array", () => {
		const b = new NativeLogBackend<number>(undefined, 10);
		for (let i = 0; i < 50; i++) b.append(i); // last 10 = [40..49]

		expect(b.slice(0, 5)).toEqual([40, 41, 42, 43, 44]);
		expect(b.slice(5)).toEqual([45, 46, 47, 48, 49]);
		expect(b.slice(3, 7)).toEqual([43, 44, 45, 46]);

		// Out-of-range stop clamps
		expect(b.slice(0, 9999)).toEqual([40, 41, 42, 43, 44, 45, 46, 47, 48, 49]);

		// start >= size → empty
		expect(b.slice(99, 999)).toEqual([]);
	});

	it("tail (ring buffer) handles n > size", () => {
		const b = new NativeLogBackend<number>(undefined, 10);
		b.append(1);
		b.append(2);
		expect(b.tail(5)).toEqual([1, 2]); // clamped
		expect(b.tail(0)).toEqual([]);
	});
});

// ── Pluggable backend ──────────────────────────────────────────────────

describe("reactiveLog with user-provided backend", () => {
	it("can plug in a custom backend implementation", () => {
		class CountingLogBackend<T> implements LogBackend<T> {
			private readonly inner = new NativeLogBackend<T>();
			appendCount = 0;
			appendManyCount = 0;

			get version(): number {
				return this.inner.version;
			}
			get size(): number {
				return this.inner.size;
			}
			at(i: number): T | undefined {
				return this.inner.at(i);
			}
			append(v: T): void {
				this.appendCount += 1;
				this.inner.append(v);
			}
			appendMany(values: readonly T[]): void {
				if (values.length > 0) this.appendManyCount += 1;
				this.inner.appendMany(values);
			}
			clear(): number {
				return this.inner.clear();
			}
			trimHead(n: number): number {
				return this.inner.trimHead(n);
			}
			slice(start: number, stop?: number): readonly T[] {
				return this.inner.slice(start, stop);
			}
			tail(n: number): readonly T[] {
				return this.inner.tail(n);
			}
			toArray(): readonly T[] {
				return this.inner.toArray();
			}
		}

		const backend = new CountingLogBackend<number>();
		const lg = reactiveLog<number>(undefined, { backend });

		lg.append(1);
		lg.append(2);
		lg.appendMany([3, 4, 5]);

		expect(backend.appendCount).toBe(2);
		expect(backend.appendManyCount).toBe(1);
		expect(lg.size).toBe(5);
		expect(lg.entries.cache).toEqual([1, 2, 3, 4, 5]);
	});
});
