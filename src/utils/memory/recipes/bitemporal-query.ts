/**
 * Recipe — **"as of t" historical view** (MEME L3 obsolescence reasoning).
 *
 * `reactiveFactStore`'s built-in `query`/`answer` face answers a structured
 * `MemoryQuery` (which already supports `asOf`), but a common need is a
 * *standing, reactive* historical projection that re-derives whenever either
 * the store changes **or** the as-of instant moves (e.g. a scrubber in a debug
 * UI). This recipe is that projection over face ④ + a reactive `asOf` input:
 * `derived([asOf, mem.factStore])` → only fragments valid at `asOf`
 * (bi-temporal `[validFrom, validTo)` test), giving Graphiti/Zep-style
 * "what did we believe at time T" without committing anything to the spec.
 *
 * ```ts
 * const asOf = node<bigint>([], { initial: undefined });
 * const view = bitemporalQuery(mem, asOf, { tags: ["policy"] });
 * asOf.emit(lastTuesdayNs);  // view re-derives to the policy facts valid then
 * ```
 *
 * Pass `asOf` SENTINEL (no emit yet) → the view is the **currently-valid** set
 * (live facts, `validTo` unset), so it's useful before any scrub too.
 *
 * @module
 */

import { type Node, node } from "@graphrefly/pure-ts/core";
import type { FactStore, MemoryFragment, ReactiveFactStoreGraph } from "../fact-store.js";
import { lastOf, validAt } from "./_shared.js";

export interface BitemporalQueryOptions {
	/** Restrict to fragments carrying any of these tags (OR). */
	readonly tags?: readonly string[];
	/** Minimum confidence (inclusive). */
	readonly minConfidence?: number;
	/** Node name. Default `bitemporal_query`. */
	readonly name?: string;
}

/**
 * Build a standing bi-temporal historical view over a {@link reactiveFactStore}.
 * Emits the fragments valid at the latest `asOf` (sorted confidence desc, then
 * `t_ns` desc — same order as the built-in `answer`).
 *
 * @category memory
 */
export function bitemporalQuery<T>(
	mem: ReactiveFactStoreGraph<T>,
	asOf: Node<bigint>,
	opts: BitemporalQueryOptions = {},
): Node<readonly MemoryFragment<T>[]> {
	// Wrap the caller's `asOf` to a non-SENTINEL `bigint | null` (initial
	// `null` = "no scrub yet ⇒ currently-valid"). Without this, an `asOf` that
	// hasn't emitted is SENTINEL and the first-run gate (COMPOSITION-GUIDE-GRAPH
	// §10 cascading SENTINEL) would silence the whole view until the first
	// scrub. `null` is DATA, so the gate opens immediately; a later `asOf.emit`
	// still re-triggers the view (it remains a reactive dep).
	const asOfOrNull = node<bigint | null>(
		[asOf],
		(b, a, c) => a.emit(lastOf<bigint>(b[0], c.prevData[0]) ?? null),
		{ name: `${opts.name ?? "bitemporal_query"}_asof`, describeKind: "derived", initial: null },
	);

	return node<readonly MemoryFragment<T>[]>(
		[asOfOrNull, mem.factStore],
		(batchData, actions, ctx) => {
			const raw = lastOf<bigint | null>(batchData[0], ctx.prevData[0]);
			const at = raw ?? undefined; // null/SENTINEL ⇒ currently-valid
			const fs = lastOf<FactStore<T>>(batchData[1], ctx.prevData[1]);
			if (fs == null) {
				actions.emit([]);
				return;
			}
			const results = [...fs.byId.values()].filter((f) => {
				if (!validAt(f, at)) return false;
				if (opts.tags && opts.tags.length > 0 && !opts.tags.some((t) => f.tags.includes(t))) {
					return false;
				}
				if (opts.minConfidence !== undefined && f.confidence < opts.minConfidence) return false;
				return true;
			});
			results.sort((a, b) => b.confidence - a.confidence || Number(b.t_ns - a.t_ns));
			actions.emit(results);
		},
		{
			name: opts.name ?? "bitemporal_query",
			describeKind: "derived",
			initial: [] as readonly MemoryFragment<T>[],
		},
	);
}
