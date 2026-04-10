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

// Re-export general-purpose utilities from extra (canonical home).
export { keepalive, reactiveCounter } from "../extra/sources.js";

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
