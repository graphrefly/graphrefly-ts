/**
 * F20 (D203 native-ship / D205) reactive structures parity —
 * `ReactiveIndex.rangeByPrimary`.
 *
 * Locked semantics (D205): values whose **primary key** sorts within
 * `[start, end)` (inclusive start, exclusive end), ascending by primary,
 * independent of the secondary sort axis. `start >= end` → `[]`.
 *
 * Coverage split (D205, important): the **rust arm of this scenario
 * exercises the napi `i64` numeric mirror in `BenchReactiveIndex`, NOT
 * the core `ReactiveIndex::range_by_primary`** — opaque `HandleId` order
 * is meaningless, so the binding deliberately ranges a user-meaningful
 * `i64` mirror. The core `K: Ord` method is covered faithfully and
 * separately by the `index_range_by_primary_d205` cargo test. This
 * two-arm scenario therefore pins pure-ts ⇔ napi-mirror equivalence; it
 * does NOT cross-verify the core Rust method (by design — the mirror and
 * core are independently tested).
 *
 * @module
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("F20 ReactiveIndex.rangeByPrimary parity — $name", (impl) => {
	const hasStructures = () => impl.structures != null;

	test.runIf(hasStructures())(
		"[start,end) ascending by primary, secondary-independent",
		async () => {
			const s = impl.structures!;
			const index = s.reactiveIndex<number, number>();
			// Insert out of primary order; the secondary string is a
			// deliberately different axis to prove range is by primary.
			await index.upsert(30, "z", 300);
			await index.upsert(10, "a", 100);
			await index.upsert(20, "m", 200);
			await index.upsert(40, "b", 400);

			expect(index.rangeByPrimary(10, 40)).toEqual([100, 200, 300]);
			expect(index.rangeByPrimary(20, 30)).toEqual([200]);
			expect(index.rangeByPrimary(0, 1000)).toEqual([100, 200, 300, 400]);
		},
	);

	test.runIf(hasStructures())("empty + degenerate ranges", async () => {
		const s = impl.structures!;
		const index = s.reactiveIndex<number, number>();
		await index.upsert(5, "a", 50);
		await index.upsert(15, "b", 150);
		expect(index.rangeByPrimary(20, 20)).toEqual([]); // start == end
		expect(index.rangeByPrimary(15, 5)).toEqual([]); // start > end
		expect(index.rangeByPrimary(6, 14)).toEqual([]); // gap, no matches
		expect(index.rangeByPrimary(5, 15)).toEqual([50]); // exclusive upper
	});

	test.runIf(hasStructures())("delete + clear update the range view", async () => {
		const s = impl.structures!;
		const index = s.reactiveIndex<number, number>();
		await index.upsert(1, "a", 11);
		await index.upsert(2, "b", 22);
		await index.upsert(3, "c", 33);
		await index.delete(2);
		expect(index.rangeByPrimary(0, 10)).toEqual([11, 33]);
		await index.clear();
		expect(index.rangeByPrimary(0, 10)).toEqual([]);
	});
});
