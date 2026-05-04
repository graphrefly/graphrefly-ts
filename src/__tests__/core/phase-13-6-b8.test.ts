/**
 * Phase 13.6.B Batch 8 — extras data-structure cleanup.
 *
 * Covers:
 * - Lock 5.A — `reactiveLog<T>` narrowing + `hasLatest` removal + `append`
 *   runtime guard (further coverage in `extra/reactive-log-stress.test.ts`).
 * - Lock 4.D — `defaultTierOpts` constant exposed from `extra/storage`.
 * - Lock 6.E — `compactEvery` is part of the defaults table (no separate
 *   tier-by-tier opt; uniform across debounced tiers).
 */

import { describe, expect, it } from "vitest";
import { reactiveLog } from "../../extra/data-structures/reactive-log.js";
import { defaultTierOpts } from "../../extra/storage/tiers.js";

describe("Phase 13.6.B B8 — Lock 5.A reactiveLog narrowing", () => {
	it("append(undefined) throws with Lock 5.A diagnostic", () => {
		const lg = reactiveLog<number>();
		expect(() => lg.append(undefined as unknown as number)).toThrow(/Lock 5\.A/);
	});

	it("appendMany rejects an undefined element with index in the message", () => {
		const lg = reactiveLog<number>();
		expect(() => lg.appendMany([1, undefined as unknown as number, 3])).toThrow(
			/values\[1\][\s\S]*Lock 5\.A/,
		);
		// Backend left untouched — none of the values landed because the
		// guard runs before mutation.
		expect(lg.entries.cache).toEqual([]);
	});

	it("hasLatest is no longer on the bundle (TS-level removal)", () => {
		const lg = reactiveLog<number>();
		// @ts-expect-error — `hasLatest` was retired in Lock 5.A.
		const _stale = lg.hasLatest;
		expect(_stale).toBeUndefined();
	});

	it("lastValue still exists with narrowed Node<T> type", () => {
		const lg = reactiveLog<number>();
		const lv = lg.lastValue;
		expect(lv.cache).toBeUndefined(); // empty log = sentinel
		lg.append(7);
		expect(lv.cache).toBe(7);
	});
});

describe("Phase 13.6.B B8 — Lock 4.D / 6.E defaultTierOpts", () => {
	it("exposes a frozen defaults constant with the locked values", () => {
		expect(defaultTierOpts.debounceMs).toBe(0);
		expect(defaultTierOpts.compactEvery).toBeUndefined();
		expect(defaultTierOpts.filter).toBeUndefined();
		expect(defaultTierOpts.keyOf).toBeUndefined();
		expect(defaultTierOpts.codec).toBeDefined();
	});

	it("constant is frozen — accidental mutation throws in strict mode", () => {
		expect(Object.isFrozen(defaultTierOpts)).toBe(true);
	});
});
