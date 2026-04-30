/**
 * Stress tests for reactiveLog — Wave 4 audit scenarios + new APIs.
 *
 * Covers: unbounded append, ring-buffer trim under maxSize, appendMany atomicity,
 * seed oversize, trimHead edges, tail memoization, slice semantics, diamond,
 * size/at getters, pluggable backend, version counter advance.
 */

import { describe, expect, it } from "vitest";
import { COMPLETE, DATA, DIRTY, ERROR, RESOLVED } from "../../core/messages.js";
import { node } from "../../core/node.js";

import { combine } from "../../extra/operators.js";
import {
	type LogBackend,
	mergeReactiveLogs,
	NativeLogBackend,
	reactiveLog,
} from "../../extra/reactive-log.js";
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
		const last2 = lg.view({ kind: "tail", n: 2 });
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
		const t1 = lg.view({ kind: "tail", n: 5 });
		const t2 = lg.view({ kind: "tail", n: 5 });
		const t3 = lg.view({ kind: "tail", n: 10 }); // different n

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
		const s = lg.view({ kind: "slice", start: 2, stop: 5 });
		expect(s.cache).toEqual([2, 3, 4]);

		// Omitting stop
		const to_end = lg.view({ kind: "slice", start: 7 });
		expect(to_end.cache).toEqual([7, 8, 9]);

		// Negative start throws
		expect(() => lg.view({ kind: "slice", start: -1, stop: 3 })).toThrow(RangeError);
	});

	// ── Scenario 9: slice across trimHead — indices shift ──────────────
	it("S9: slice [2, 5) behaves positionally after trimHead shifts indices", () => {
		const lg = reactiveLog<number>([10, 20, 30, 40, 50, 60, 70, 80]);
		const window = lg.view({ kind: "slice", start: 2, stop: 5 });
		expect(window.cache).toEqual([30, 40, 50]);

		// Trim first 3 → remaining is [40, 50, 60, 70, 80]
		lg.trimHead(3);
		// slice(2, 5) now refers to indices 2..4 of the NEW list: [60, 70, 80]
		expect(window.cache).toEqual([60, 70, 80]);
	});

	// ── Scenario 10: Diamond — tail + slice both derived ───────────────
	it("S10: tail and slice diamond from entries — both settle consistently", () => {
		const lg = reactiveLog<number>();
		const t = lg.view({ kind: "tail", n: 2 });
		const s = lg.view({ kind: "slice", start: 0, stop: 3 });
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
		const t0 = lg.view({ kind: "tail", n: 0 });
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
			const s1 = lg.view({ kind: "slice", start: 2, stop: 5 });
			const s2 = lg.view({ kind: "slice", start: 2, stop: 5 });
			const s3 = lg.view({ kind: "slice", start: 2 }); // different — no stop
			const s4 = lg.view({ kind: "slice", start: 2, stop: 5 });

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

// ── Audit 1 — lifecycle composition ────────────────────────────────────

describe("reactiveLog Audit 1 helpers — lifecycle composition", () => {
	it("withLatest() lazy-activates lastValue and hasLatest companions", () => {
		const lg = reactiveLog<number>();
		// Empty log → SENTINEL alignment: lastValue caches `undefined`,
		// hasLatest caches `false`.
		const lv = lg.lastValue;
		const has = lg.hasLatest;
		expect(lv.cache).toBeUndefined();
		expect(has.cache).toBe(false);

		// Returning entries from withLatest() is the documented chaining shape.
		const entries = lg.withLatest();
		expect(entries).toBe(lg.entries);

		lg.append(7);
		expect(lv.cache).toBe(7);
		expect(has.cache).toBe(true);

		lg.append(11);
		expect(lv.cache).toBe(11);
	});

	it("lastValue never emits DATA(undefined) — clear() routes through RESOLVED", () => {
		const lg = reactiveLog<number>();
		// Seed values BEFORE subscribing so the initial subscribe captures the
		// last-value DATA, then clear() is the specific transition under test.
		lg.append(1);
		lg.append(2);

		const { messages, unsub } = collect(lg.lastValue, { flat: true });
		// Initial subscribe captures DATA(2) (the cached lastValue).
		const beforeClearLen = messages.length;
		expect(messages.some((m) => m[0] === DATA && m[1] === 2)).toBe(true);

		lg.clear();
		// The clear() wave specifically must route through RESOLVED — no
		// DATA(undefined) anywhere in the post-clear segment.
		const afterClear = messages.slice(beforeClearLen);
		expect(afterClear.some((m) => m[0] === RESOLVED)).toBe(true);
		expect(afterClear.some((m) => m[0] === DATA && m[1] === undefined)).toBe(false);

		// Re-append produces DATA(3) cleanly after the empty interval.
		lg.append(3);
		expect(messages.some((m) => m[0] === DATA && m[1] === 3)).toBe(true);
		// Whole-stream invariant — no DATA(undefined) ever (spec §1.2).
		expect(messages.some((m) => m[0] === DATA && m[1] === undefined)).toBe(false);
		unsub();
	});

	it("hasLatest disambiguates `T | undefined` payloads from empty-log SENTINEL", () => {
		const lg = reactiveLog<number | undefined>();
		expect(lg.hasLatest.cache).toBe(false);

		// Appending an actual `undefined` value flips hasLatest even though
		// lastValue.cache stays `undefined` — same caveat as TopicGraph.
		lg.append(undefined);
		expect(lg.lastValue.cache).toBeUndefined();
		expect(lg.hasLatest.cache).toBe(true);
	});

	it("attach(upstream) drains DATA into the log and disposer detaches", () => {
		const lg = reactiveLog<number>();
		const src = node<number>([], { initial: 0 });
		const detach = lg.attach(src);

		// On subscribe, push-on-subscribe replays `node([], { initial: 0 })`'s cached `0` —
		// the attach handler treats that DATA the same as any post-subscribe
		// emission, so the initial cached value lands in the log.
		expect(lg.entries.cache).toEqual([0]);
		src.emit(1);
		src.emit(2);
		expect(lg.entries.cache).toEqual([0, 1, 2]);

		detach();
		src.emit(3);
		// After detach: subsequent emissions are NOT forwarded.
		expect(lg.entries.cache).toEqual([0, 1, 2]);
	});

	it("disposeAllViews releases tail/slice/fromCursor view caches", () => {
		const lg = reactiveLog<number>([1, 2, 3, 4, 5]);
		const cursor = node<number>([], { initial: 0 });

		const t = lg.view({ kind: "tail", n: 2 });
		const s = lg.view({ kind: "slice", start: 1 });
		const c = lg.view({ kind: "fromCursor", cursor });

		// Pre-dispose: same calls return the memoized nodes.
		expect(lg.view({ kind: "tail", n: 2 })).toBe(t);
		expect(lg.view({ kind: "slice", start: 1 })).toBe(s);
		expect(lg.view({ kind: "fromCursor", cursor })).toBe(c);

		lg.disposeAllViews();

		// Post-dispose: view caches are cleared, so identical specs return
		// fresh nodes (not the previously memoized ones).
		expect(lg.view({ kind: "tail", n: 2 })).not.toBe(t);
		expect(lg.view({ kind: "slice", start: 1 })).not.toBe(s);
		expect(lg.view({ kind: "fromCursor", cursor })).not.toBe(c);
	});

	it("view + attach + withLatest co-activate without dropping initial state", () => {
		const lg = reactiveLog<number>([10, 20, 30]);
		const tail = lg.view({ kind: "tail", n: 2 });
		const lastValue = lg.lastValue;
		const upstream = node<number>([], { initial: 40 });
		const detach = lg.attach(upstream);

		expect(lg.entries.cache).toEqual([10, 20, 30, 40]);
		expect(tail.cache).toEqual([30, 40]);
		expect(lastValue.cache).toBe(40);

		upstream.emit(50);
		expect(tail.cache).toEqual([40, 50]);
		expect(lastValue.cache).toBe(50);

		detach();
	});
});

// ── LogBackend snapshot/restore ────────────────────────────────────────

describe("LogBackend.snapshot / restore (Audit 1)", () => {
	it("NativeLogBackend.snapshot() round-trips through restore()", () => {
		const a = new NativeLogBackend<number>([1, 2, 3]);
		const snap = a.snapshot();

		const b = new NativeLogBackend<number>();
		expect(b.size).toBe(0);
		b.restore(snap);
		expect(b.toArray()).toEqual([1, 2, 3]);
		expect(b.size).toBe(3);
	});

	it("snapshot() returns the same shape as toArray()", () => {
		const a = new NativeLogBackend<number>([1, 2, 3]);
		expect(a.snapshot()).toEqual(a.toArray());
	});

	it("restore() resets backend state; subsequent append flushes the merged shape via entries", () => {
		// Direct backend access via the user-provided backend escape hatch.
		const backend = new NativeLogBackend<number>();
		const lg = reactiveLog<number>(undefined, { backend });

		// Subscribe to the SAME log we'll restore into; capture only emissions
		// that flow after restore + append.
		const { messages, unsub } = collect(lg.entries, { flat: true });
		const beforeRestoreLen = messages.length;

		backend.restore([1, 2, 3]);
		// `restore` mutates the backend directly; the entries node only flushes
		// on the next mutation that runs through `wrapMutation`. Append one
		// element to trigger the snapshot push.
		lg.append(4);

		expect(lg.entries.cache).toEqual([1, 2, 3, 4]);
		const afterRestore = messages.slice(beforeRestoreLen);
		// The post-restore append produced a DATA wave carrying the merged
		// snapshot through `entries`.
		const lastData = afterRestore.filter((m) => m[0] === DATA).at(-1);
		expect(lastData?.[1]).toEqual([1, 2, 3, 4]);

		unsub();
	});
});

// ── mergeReactiveLogs lifecycle ────────────────────────────────────────

describe("mergeReactiveLogs (Audit 1)", () => {
	it("flatlines initial snapshots from each input log", () => {
		const a = reactiveLog<string>(["a1", "a2"]);
		const b = reactiveLog<string>(["b1"]);
		const merged = mergeReactiveLogs([a.entries, b.entries]);
		expect(merged.node.cache).toEqual(["a1", "a2", "b1"]);
		merged.dispose();
	});

	it("memoized by reference identity on the logs array", () => {
		const a = reactiveLog<number>([1]);
		const b = reactiveLog<number>([2]);
		const arr = [a.entries, b.entries] as const;
		const m1 = mergeReactiveLogs(arr);
		const m2 = mergeReactiveLogs(arr);
		expect(m1).toBe(m2);
		m1.dispose();
	});

	it("appends from any input log fan into the merged stream", () => {
		const a = reactiveLog<number>();
		const b = reactiveLog<number>();
		const merged = mergeReactiveLogs([a.entries, b.entries]);
		expect(merged.node.cache).toEqual([]);

		a.append(1);
		expect(merged.node.cache).toEqual([1]);
		b.append(2);
		expect(merged.node.cache).toEqual([1, 2]);
		a.append(3);
		expect(merged.node.cache).toEqual([1, 3, 2]);

		merged.dispose();
	});

	it("dispose() releases subscriptions; further input changes are ignored", () => {
		const a = reactiveLog<number>();
		const b = reactiveLog<number>();
		const merged = mergeReactiveLogs([a.entries, b.entries]);

		a.append(1);
		expect(merged.node.cache).toEqual([1]);

		merged.dispose();

		// After dispose, further input changes don't flow into the merge.
		a.append(2);
		b.append(3);
		expect(merged.node.cache).toEqual([1]);
	});

	it("ERROR on an input log propagates through the merge", () => {
		const a = reactiveLog<number>();
		const b = reactiveLog<number>();
		const merged = mergeReactiveLogs([a.entries, b.entries]);
		const flat = collect(merged.node, { flat: true });

		// Drive a known DATA through `a` first so we can verify normal flow
		// happens BEFORE the ERROR — otherwise the test passes vacuously when
		// the merge wiring never connected.
		a.append(1);
		expect(flat.messages.some((m) => m[0] === DATA && Array.isArray(m[1]))).toBe(true);
		const preErrorCount = flat.messages.length;

		// `Node.down` is public API (core/node.ts §3.5). Driving ERROR through
		// the underlying entries node simulates an upstream failure;
		// reactiveLog's append-side surface has no ERROR channel by design.
		a.entries.down([[ERROR, new Error("boom")]]);

		const afterError = flat.messages.slice(preErrorCount);
		expect(afterError.some((m) => m[0] === ERROR)).toBe(true);
		flat.unsub();
		merged.dispose();
	});

	it("COMPLETE on one input drops it from active set; subsequent DATA from completed input is ignored", () => {
		const a = reactiveLog<number>([1, 2]);
		const b = reactiveLog<number>([10]);
		const merged = mergeReactiveLogs([a.entries, b.entries]);

		expect(merged.node.cache).toEqual([1, 2, 10]);

		// Mark `a` complete via the entries node's protocol channel
		// (`Node.down` is public). Per the impl, this releases `a`'s
		// subscription so even a stray DATA from `a` wouldn't reach the merge.
		a.entries.down([[COMPLETE]]);

		// Append to `a` post-COMPLETE — this is misbehaving (well-behaved
		// nodes don't emit after COMPLETE), but the merge is robust: the
		// subscription is gone so the value never reaches `merged.node`.
		a.append(99);
		expect(merged.node.cache).toEqual([1, 2, 10]);

		// Append to `b` still flows through the merge with exact placement —
		// `a`'s last bucket is cleared to [], so output = [] ++ [10, 11].
		b.append(11);
		expect(merged.node.cache).toEqual([10, 11]);

		merged.dispose();
	});
});
