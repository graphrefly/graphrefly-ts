/**
 * Stress tests for reactiveList — Wave 4 audit scenarios.
 *
 * Covers: rapid append, appendMany semantics, boundary inserts, pop negative
 * indexing, empty-list throws, batched appends (coalescing contract),
 * diamond topology, initial-array isolation, and snapshot-before-return ordering.
 */

import { describe, expect, it } from "vitest";
import { batch } from "../../core/batch.js";
import { DATA, DIRTY } from "../../core/messages.js";
import { node } from "../../core/node.js";
import {
	type ListBackend,
	NativeListBackend,
	reactiveList,
} from "../../extra/data-structures/reactive-list.js";
import { combine } from "../../extra/operators/index.js";
import { collect } from "../test-helpers.js";

describe("reactiveList stress tests", () => {
	// ── Scenario 1: Rapid append ────────────────────────────────────────
	it("S1: 1000 appends — each emits DIRTY+DATA, final snapshot has all values", () => {
		const lst = reactiveList<number>();
		const { messages, unsub } = collect(lst.items, { flat: true });

		const N = 1000;
		for (let i = 0; i < N; i++) lst.append(i);

		unsub();

		const dirtyCount = messages.filter((m) => m[0] === DIRTY).length;
		const dataCount = messages.filter((m) => m[0] === DATA).length;

		expect(dirtyCount).toBe(N);
		expect(dataCount).toBe(N + 1); // +1 for push-on-subscribe

		const lastData = messages.filter((m) => m[0] === DATA).at(-1)!;
		const snap = lastData[1] as readonly number[];
		expect(snap.length).toBe(N);
		expect(snap[0]).toBe(0);
		expect(snap[N - 1]).toBe(N - 1);
	});

	// ── Scenario 2: Insert at boundaries ────────────────────────────────
	it("S2: insert(0, x) prepends, insert(length, x) appends, both emit", () => {
		const lst = reactiveList<number>([1, 2, 3]);
		const { messages, unsub } = collect(lst.items, { flat: true });
		const beforeLen = messages.length;

		lst.insert(0, 0);
		expect(lst.items.cache).toEqual([0, 1, 2, 3]);

		lst.insert(4, 4); // at length
		expect(lst.items.cache).toEqual([0, 1, 2, 3, 4]);

		const newMessages = messages.slice(beforeLen);
		expect(newMessages.filter((m) => m[0] === DIRTY).length).toBe(2);
		expect(newMessages.filter((m) => m[0] === DATA).length).toBe(2);

		unsub();
	});

	// ── Scenario 3: Insert out-of-range throws, no emission ─────────────
	it("S3: insert with invalid index throws RangeError, no emission", () => {
		const lst = reactiveList<number>([1, 2, 3]);
		const { messages, unsub } = collect(lst.items, { flat: true });
		const beforeLen = messages.length;

		expect(() => lst.insert(-1, 99)).toThrow(RangeError);
		expect(() => lst.insert(4, 99)).toThrow(RangeError); // length+1 is out of range

		// Buf unchanged
		expect(lst.items.cache).toEqual([1, 2, 3]);
		// No new messages
		expect(messages.length).toBe(beforeLen);

		unsub();
	});

	// ── Scenario 4: Pop negative index semantics ────────────────────────
	it("S4: pop(-1) returns last, pop(-length) returns first, pop(-length-1) throws", () => {
		const lst = reactiveList<string>(["a", "b", "c"]);

		expect(lst.pop(-1)).toBe("c");
		expect(lst.items.cache).toEqual(["a", "b"]);

		expect(lst.pop(-2)).toBe("a"); // -2 on length 2 → index 0
		expect(lst.items.cache).toEqual(["b"]);

		expect(() => lst.pop(-2)).toThrow(RangeError); // -2 on length 1 → out of range
	});

	// ── Scenario 5: Pop from empty throws ───────────────────────────────
	it("S5: pop on empty list throws, no emission", () => {
		const lst = reactiveList<number>();
		const { messages, unsub } = collect(lst.items, { flat: true });
		const beforeLen = messages.length;

		expect(() => lst.pop()).toThrow(RangeError);
		expect(messages.length).toBe(beforeLen);

		unsub();
	});

	// ── Scenario 6: Clear on empty list is a no-op ──────────────────────
	it("S6: clear on empty list emits no messages", () => {
		const lst = reactiveList<number>();
		const { messages, unsub } = collect(lst.items, { flat: true });
		const beforeLen = messages.length;

		lst.clear();
		expect(messages.length).toBe(beforeLen);

		unsub();
	});

	// ── Scenario 7: Batched appends — nested batch delivery contract ────
	it("S7: N appends inside outer batch — N DIRTY callbacks then N DATA callbacks", () => {
		const lst = reactiveList<number>();
		const callbackInvocations: unknown[][] = [];
		const unsub = lst.items.subscribe((msgs) => {
			callbackInvocations.push(msgs as unknown[]);
		});
		const beforeLen = callbackInvocations.length;

		const N = 5;
		batch(() => {
			for (let i = 0; i < N; i++) lst.append(i);
		});

		unsub();

		const newInvocations = callbackInvocations.slice(beforeLen);
		// Updated contract (Bug 2 fix, per-node emit coalescing inside batch):
		// N consecutive emits to the same node inside one explicit `batch()`
		// scope coalesce into ONE multi-message delivery — N DIRTYs in one
		// tier-1 sink call, then N DATAs in one tier-3 sink call. Total: 2
		// callbacks regardless of N. This is the source-side correctness fix
		// that also resolves the K+1 fan-in over-fire at diamond nodes.
		expect(newInvocations.length).toBe(2);

		// First callback: tier-1 batch with N DIRTY messages.
		const dirtyCall = newInvocations[0] as [symbol, unknown][];
		expect(dirtyCall.length).toBe(N);
		for (const msg of dirtyCall) expect(msg[0]).toBe(DIRTY);

		// Second callback: tier-3 batch with N DATA messages.
		const dataCall = newInvocations[1] as [symbol, unknown][];
		expect(dataCall.length).toBe(N);
		for (const msg of dataCall) expect(msg[0]).toBe(DATA);

		// Final DATA payload has all N values.
		const lastSnap = dataCall.at(-1)?.[1] as readonly number[];
		expect(lastSnap).toEqual([0, 1, 2, 3, 4]);
	});

	// ── Scenario 7b: appendMany collapses the N-callback problem ────────
	it("S7b: appendMany(N values) yields 1 DIRTY + 1 DATA callback (vs 2N for N appends)", () => {
		const lst = reactiveList<number>();
		const invocations: unknown[][] = [];
		const unsub = lst.items.subscribe((msgs) => {
			invocations.push(msgs as unknown[]);
		});
		const beforeLen = invocations.length;

		lst.appendMany([0, 1, 2, 3, 4]);

		unsub();

		const newInvocations = invocations.slice(beforeLen);
		// 1 DIRTY callback + 1 DATA callback = 2 total
		expect(newInvocations.length).toBe(2);
		expect((newInvocations[0] as [symbol, unknown][])[0]![0]).toBe(DIRTY);
		expect((newInvocations[1] as [symbol, unknown][])[0]![0]).toBe(DATA);
	});

	// ── Scenario 8: Diamond through combine — glitch-free ───────────────
	it("S8: diamond topology via combine — observed pairs are consistent", () => {
		const lst = reactiveList<number>();

		const length = node(
			[lst.items],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as readonly number[]).length);
			},
			{ describeKind: "derived", initial: 0 },
		);
		const sum = node(
			[lst.items],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as readonly number[]).reduce((a, b) => a + b, 0));
			},
			{ describeKind: "derived", initial: 0 },
		);

		const combined = combine(length, sum);
		const seen: [number, number][] = [];
		const unsub = combined.subscribe((msgs) => {
			for (const msg of msgs as [symbol, unknown][]) {
				if (msg[0] === DATA) seen.push(msg[1] as [number, number]);
			}
		});

		lst.append(10);
		lst.append(20);
		lst.append(30);

		unsub();

		// Final pair should be (3, 60)
		expect(seen.at(-1)).toEqual([3, 60]);
		// All observed pairs should be self-consistent
		// (length N means we've appended N items; sum == whatever was appended)
		// We can't strictly check sum == f(length) without tracking history,
		// but we can verify monotonicity: length and sum only increase.
		for (let i = 1; i < seen.length; i++) {
			expect(seen[i]![0]).toBeGreaterThanOrEqual(seen[i - 1]![0]);
			expect(seen[i]![1]).toBeGreaterThanOrEqual(seen[i - 1]![1]);
		}
	});

	// ── Scenario 9: Large list snapshot cost (perf smoke) ───────────────
	it("S9: append 1000 items — final snapshot reflects all, no data loss", () => {
		const lst = reactiveList<number>();
		for (let i = 0; i < 1000; i++) lst.append(i);

		const snap = lst.items.cache as readonly number[];
		expect(snap.length).toBe(1000);
		// Spot checks
		expect(snap[0]).toBe(0);
		expect(snap[500]).toBe(500);
		expect(snap[999]).toBe(999);
	});

	// ── Scenario 10: Subscriber after mutation gets cached snapshot ─────
	it("S10: subscribe after mutation — push-on-subscribe delivers latest snapshot", () => {
		const lst = reactiveList<string>();
		lst.append("a");
		lst.append("b");

		const { messages, unsub } = collect(lst.items, { flat: true });

		const firstData = messages.find((m) => m[0] === DATA);
		expect(firstData).toBeDefined();
		const snap = firstData![1] as readonly string[];
		expect(snap).toEqual(["a", "b"]);

		unsub();
	});

	// ── Scenario 11: Initial array isolation ────────────────────────────
	it("S11: external mutation of initial array does not affect list", () => {
		const seed = [1, 2, 3];
		const lst = reactiveList<number>(seed);

		// Mutate the seed after construction
		seed.push(999);
		seed[0] = -1;

		// Internal buf should be unaffected
		expect(lst.items.cache).toEqual([1, 2, 3]);

		// And list mutations shouldn't touch the seed either
		lst.append(4);
		expect(seed).toEqual([-1, 2, 3, 999]);
	});

	// ── Scenario 12: Pop emits snapshot before returning value ──────────
	it("S12: pop returns value after snapshot is queued", () => {
		const lst = reactiveList<number>([10, 20, 30]);
		let snapshotAtReturnTime: readonly number[] | undefined;

		const unsub = lst.items.subscribe((msgs) => {
			for (const msg of msgs as [symbol, unknown][]) {
				if (msg[0] === DATA) snapshotAtReturnTime = msg[1] as readonly number[];
			}
		});

		const popped = lst.pop(); // returns 30
		expect(popped).toBe(30);

		// By this point (after pop returns and outside any outer batch),
		// the snapshot reflecting the post-pop state should have been delivered.
		expect(snapshotAtReturnTime).toEqual([10, 20]);

		unsub();
	});

	// ── appendMany tests ─────────────────────────────────────────────────
	describe("appendMany", () => {
		it("empty values array is a no-op", () => {
			const lst = reactiveList<number>();
			const { messages, unsub } = collect(lst.items, { flat: true });
			const beforeLen = messages.length;

			lst.appendMany([]);

			expect(messages.length).toBe(beforeLen);
			expect(lst.items.cache).toEqual([]);

			unsub();
		});

		it("N values emits exactly 1 DIRTY + 1 DATA with all values appended", () => {
			const lst = reactiveList<number>([0]);
			const { messages, unsub } = collect(lst.items, { flat: true });
			const beforeLen = messages.length;

			lst.appendMany([1, 2, 3, 4, 5]);

			const newMessages = messages.slice(beforeLen);
			const dirtyCount = newMessages.filter((m) => m[0] === DIRTY).length;
			const dataCount = newMessages.filter((m) => m[0] === DATA).length;

			expect(dirtyCount).toBe(1);
			expect(dataCount).toBe(1);

			const snap = newMessages.find((m) => m[0] === DATA)![1] as readonly number[];
			expect(snap).toEqual([0, 1, 2, 3, 4, 5]);

			unsub();
		});

		it("appendMany preserves input order", () => {
			const lst = reactiveList<string>();
			lst.appendMany(["c", "a", "b"]);
			expect(lst.items.cache).toEqual(["c", "a", "b"]);
			lst.appendMany(["d"]);
			expect(lst.items.cache).toEqual(["c", "a", "b", "d"]);
		});

		it("appendMany emits one snapshot vs N appends emitting N snapshots", () => {
			const lstOne = reactiveList<number>();
			const one = collect(lstOne.items, { flat: true });
			const beforeOne = one.messages.length;
			lstOne.appendMany([1, 2, 3, 4, 5]);
			const oneDirty = one.messages.slice(beforeOne).filter((m) => m[0] === DIRTY).length;
			one.unsub();

			const lstMany = reactiveList<number>();
			const many = collect(lstMany.items, { flat: true });
			const beforeMany = many.messages.length;
			for (const v of [1, 2, 3, 4, 5]) lstMany.append(v);
			const manyDirty = many.messages.slice(beforeMany).filter((m) => m[0] === DIRTY).length;
			many.unsub();

			expect(oneDirty).toBe(1);
			expect(manyDirty).toBe(5);
		});

		it("appendMany does not retain reference to input array", () => {
			const lst = reactiveList<number>();
			const input = [1, 2, 3];
			lst.appendMany(input);

			// Mutating the input after should not affect the list
			input.push(999);
			input[0] = -1;

			expect(lst.items.cache).toEqual([1, 2, 3]);
		});
	});
});

// ── New API tests ──────────────────────────────────────────────────────

describe("reactiveList new APIs", () => {
	it("size getter returns O(1) count", () => {
		const lst = reactiveList<number>();
		expect(lst.size).toBe(0);

		lst.append(1);
		expect(lst.size).toBe(1);

		lst.appendMany([2, 3, 4]);
		expect(lst.size).toBe(4);

		lst.pop();
		expect(lst.size).toBe(3);

		lst.clear();
		expect(lst.size).toBe(0);
	});

	describe("at(index)", () => {
		it("positive index returns value", () => {
			const lst = reactiveList<string>(["a", "b", "c"]);
			expect(lst.at(0)).toBe("a");
			expect(lst.at(1)).toBe("b");
			expect(lst.at(2)).toBe("c");
		});

		it("negative index (Python-style) returns from end", () => {
			const lst = reactiveList<string>(["a", "b", "c"]);
			expect(lst.at(-1)).toBe("c");
			expect(lst.at(-2)).toBe("b");
			expect(lst.at(-3)).toBe("a");
		});

		it("out-of-range returns undefined", () => {
			const lst = reactiveList<string>(["a", "b", "c"]);
			expect(lst.at(3)).toBeUndefined();
			expect(lst.at(99)).toBeUndefined();
			expect(lst.at(-4)).toBeUndefined();
			expect(lst.at(-99)).toBeUndefined();
		});

		it("on empty list always returns undefined", () => {
			const lst = reactiveList<number>();
			expect(lst.at(0)).toBeUndefined();
			expect(lst.at(-1)).toBeUndefined();
		});
	});

	describe("insertMany", () => {
		it("empty values array is a no-op, no emission", () => {
			const lst = reactiveList<number>([1, 2, 3]);
			const { messages, unsub } = collect(lst.items, { flat: true });
			const beforeLen = messages.length;

			lst.insertMany(1, []);

			expect(messages.length).toBe(beforeLen);
			expect(lst.items.cache).toEqual([1, 2, 3]);
			unsub();
		});

		it("N values at index emits exactly 1 DIRTY + 1 DATA", () => {
			const lst = reactiveList<number>([1, 2, 3]);
			const { messages, unsub } = collect(lst.items, { flat: true });
			const beforeLen = messages.length;

			lst.insertMany(1, [10, 20, 30]);

			const newMessages = messages.slice(beforeLen);
			expect(newMessages.filter((m) => m[0] === DIRTY).length).toBe(1);
			expect(newMessages.filter((m) => m[0] === DATA).length).toBe(1);

			expect(lst.items.cache).toEqual([1, 10, 20, 30, 2, 3]);
			unsub();
		});

		it("insertMany at 0 (prepend all)", () => {
			const lst = reactiveList<number>([4, 5]);
			lst.insertMany(0, [1, 2, 3]);
			expect(lst.items.cache).toEqual([1, 2, 3, 4, 5]);
		});

		it("insertMany at size (appendMany equivalent)", () => {
			const lst = reactiveList<number>([1, 2]);
			lst.insertMany(2, [3, 4]);
			expect(lst.items.cache).toEqual([1, 2, 3, 4]);
		});

		it("insertMany throws on out-of-range index", () => {
			const lst = reactiveList<number>([1, 2, 3]);
			expect(() => lst.insertMany(-1, [99])).toThrow(RangeError);
			expect(() => lst.insertMany(4, [99])).toThrow(RangeError);
		});
	});
});

// ── Native backend direct tests ────────────────────────────────────────

describe("NativeListBackend", () => {
	it("version counter advances on every state-changing op", () => {
		const b = new NativeListBackend<number>();
		expect(b.version).toBe(0);

		b.append(1);
		expect(b.version).toBe(1);

		b.appendMany([2, 3]);
		expect(b.version).toBe(2);

		b.appendMany([]); // no-op
		expect(b.version).toBe(2);

		b.insert(0, 0);
		expect(b.version).toBe(3);

		b.insertMany(1, [100, 200]);
		expect(b.version).toBe(4);

		b.insertMany(1, []); // no-op
		expect(b.version).toBe(4);

		b.pop(0);
		expect(b.version).toBe(5);

		expect(b.clear()).toBe(5);
		expect(b.version).toBe(6);

		expect(b.clear()).toBe(0); // no-op
		expect(b.version).toBe(6);
	});

	it("at supports negative indexing", () => {
		const b = new NativeListBackend<number>([10, 20, 30]);
		expect(b.at(0)).toBe(10);
		expect(b.at(-1)).toBe(30);
		expect(b.at(-3)).toBe(10);
		expect(b.at(3)).toBeUndefined();
		expect(b.at(-4)).toBeUndefined();
	});

	it("initial array is copied (not retained)", () => {
		const seed = [1, 2, 3];
		const b = new NativeListBackend<number>(seed);

		seed.push(999);
		seed[0] = -1;

		expect(b.toArray()).toEqual([1, 2, 3]);
	});
});

// ── Pluggable backend ──────────────────────────────────────────────────

describe("reactiveList with user-provided backend", () => {
	it("can plug in a custom backend implementation", () => {
		class CountingListBackend<T> implements ListBackend<T> {
			private readonly inner = new NativeListBackend<T>();
			appendCount = 0;
			insertCount = 0;
			popCount = 0;

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
				if (values.length > 0) this.appendCount += values.length;
				this.inner.appendMany(values);
			}
			insert(i: number, v: T): void {
				this.insertCount += 1;
				this.inner.insert(i, v);
			}
			insertMany(i: number, values: readonly T[]): void {
				if (values.length > 0) this.insertCount += values.length;
				this.inner.insertMany(i, values);
			}
			pop(i: number): T {
				this.popCount += 1;
				return this.inner.pop(i);
			}
			clear(): number {
				return this.inner.clear();
			}
			toArray(): readonly T[] {
				return this.inner.toArray();
			}
		}

		const backend = new CountingListBackend<number>();
		const lst = reactiveList<number>(undefined, { backend });

		lst.append(1);
		lst.appendMany([2, 3]);
		lst.insert(0, 0);
		lst.insertMany(4, [10, 20]);
		lst.pop();

		expect(backend.appendCount).toBe(3); // 1 + 2
		expect(backend.insertCount).toBe(3); // 1 + 2
		expect(backend.popCount).toBe(1);
		expect(lst.items.cache).toEqual([0, 1, 2, 3, 10]);
	});

	it("when backend is provided, initial is ignored", () => {
		const backend = new NativeListBackend<number>([100, 200]);
		const lst = reactiveList<number>([1, 2, 3], { backend });

		// Initial [1,2,3] ignored; backend's seeded [100, 200] wins.
		expect(lst.items.cache).toEqual([100, 200]);
	});
});
