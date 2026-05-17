/**
 * Shared internals for the {@link reactiveFactStore} recipe library
 * (DS-14.7 follow-up #1). Not part of the public surface — recipes re-export
 * only their own factory.
 *
 * @module
 */

import type { MemoryFragment } from "../fact-store.js";

/**
 * Last-value-of-wave helper, mirroring the `lastOf` in `fact-store.ts`: prefer
 * the most recent value emitted on dep slot `i` this wave, else fall back to
 * the dep's prior cached value (`ctx.prevData[i]`). Returns `undefined` at
 * SENTINEL (dep has never emitted DATA).
 */
export function lastOf<X>(batch: readonly unknown[] | undefined, prev: unknown): X | undefined {
	return batch != null && batch.length > 0 ? (batch.at(-1) as X) : (prev as X | undefined);
}

/**
 * Bi-temporal validity test — re-implemented locally so recipes stay
 * self-contained (the `fact-store.ts` `currentlyValid` is private; widening its
 * export for two recipe consumers would creep the substrate surface). Semantics
 * are identical: with no `asOf`, "currently valid" === not obsolete
 * (`validTo` unset); with `asOf`, the instant must fall in `[validFrom, validTo)`.
 */
export function validAt<T>(f: MemoryFragment<T>, asOf?: bigint): boolean {
	if (asOf === undefined) return f.validTo === undefined;
	if (f.validFrom !== undefined && asOf < f.validFrom) return false;
	if (f.validTo !== undefined && asOf >= f.validTo) return false;
	return true;
}
