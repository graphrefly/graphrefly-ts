/**
 * Shared internal utilities for the patterns layer.
 *
 * These are private helpers used across multiple pattern modules. They are NOT
 * part of the public API — import from `./patterns/index.js` for public exports.
 *
 * General-purpose reactive utilities (`keepalive`, `reactiveCounter`) live in
 * `extra/sources.ts` and are re-exported here for convenience.
 *
 * @internal
 * @module
 */

import { downWithBatch } from "../../core/batch.js";
import { DATA, DIRTY } from "../../core/messages.js";
import type { Node } from "../../core/node.js";
import { defaultConfig } from "../../core/node.js";

// Re-export general-purpose utilities from extra (canonical home).
export { keepalive, reactiveCounter } from "../../extra/sources.js";

// ---------------------------------------------------------------------------
// emitToMeta
// ---------------------------------------------------------------------------

/**
 * Forward a single `[DATA, value]` to a meta companion node via tier-3
 * deferral, tolerating absent companions. Used by patterns that publish
 * per-wave statistics alongside their main output (cache-hit-rate,
 * segment-count, layout-time-ns, etc.) — subscribers see the parent's
 * DATA first because phase-2 completes before phase-3 during drain.
 *
 * // Expands to: `if (meta) downWithBatch(meta, [[Type, value]])` with null-guard.
 *
 * @internal
 */
export function emitToMeta<T>(metaNode: Node<T> | undefined, value: T): void {
	if (metaNode == null) return;
	downWithBatch((msgs) => metaNode.down(msgs), [[DATA, value]], defaultConfig.tierOf);
}

// ---------------------------------------------------------------------------
// tryIncrementBounded
// ---------------------------------------------------------------------------

/**
 * Bounded increment for a self-owned counter state node.
 *
 * Reads `counter.cache`, bumps by 1 if under `cap`, writes back. Returns
 * `false` when the cap is reached. Documented P3 exception: the counter is
 * not a declared dep of the caller — it's a private budget read+written from
 * a single call site. This helper keeps the `.cache` access in one named
 * place.
 *
 * **Safety today:**
 *   1. Single-threaded JS runner never invokes the caller concurrently.
 *   2. `counter.down` writes the cache synchronously before returning, so
 *      synchronous re-entry through a downstream publish reads the
 *      freshly-incremented value — no double-count.
 *
 * **Future risk:** under a free-threaded runner (PY no-GIL or hypothetical
 * concurrent TS runner), two concurrent firings could still race. Revisit
 * when that surfaces.
 *
 * @internal
 */
export function tryIncrementBounded(counter: Node<number>, cap: number): boolean {
	const cur = (counter.cache as number | undefined) ?? 0;
	if (cur >= cap) return false;
	counter.down([[DIRTY], [DATA, cur + 1]]);
	return true;
}

// ---------------------------------------------------------------------------
// domainMeta
// ---------------------------------------------------------------------------

/**
 * Build a domain metadata object for pattern-layer nodes.
 *
 * Each domain (orchestration, messaging, reduction, ai, cqrs, domain_template)
 * follows the same shape: `{ [domain]: true, [domain]_type: kind, ...extra }`.
 *
 * @param domain - The domain tag (e.g. `"orchestration"`, `"ai"`, `"cqrs"`).
 * @param kind - The specific type within the domain (e.g. `"gate"`, `"prompt"`).
 * @param extra - Additional metadata to merge.
 * @returns Metadata object.
 *
 * @internal
 */
export function domainMeta(
	domain: string,
	kind: string,
	extra?: Record<string, unknown>,
): Record<string, unknown> {
	return {
		[domain]: true,
		[`${domain}_type`]: kind,
		...(extra ?? {}),
	};
}

// ---------------------------------------------------------------------------
// trackingKey
// ---------------------------------------------------------------------------

/**
 * Stable tracking key for an item with retry/reingestion decoration.
 *
 * Uses `relatedTo[0]` if present (carries the original key forward through
 * retries and reingestions). Falls back to `summary` for first-time items.
 *
 * This avoids deriving keys from mutated summary strings — retries decorate
 * the summary with `[RETRY N/M]` and failure context, so regex-stripping
 * would be fragile and any new decoration pattern would risk infinite loops
 * by generating novel keys.
 *
 * @internal
 */
export function trackingKey(item: { summary: string; relatedTo?: string[] }): string {
	return item.relatedTo?.[0] ?? item.summary;
}
