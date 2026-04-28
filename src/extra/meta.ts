/**
 * Metadata helpers for pattern-layer nodes (Tier 2.2 promotion from
 * `patterns/_internal/`).
 *
 * Each domain (orchestration, messaging, reduction, ai, cqrs, domain_template,
 * memory, lens, audit, harness) shares the same metadata convention. Promoted
 * to `extra/` so non-patterns code (and downstream consumers building their
 * own domain primitives) can use the same shape.
 *
 * @module
 */

/**
 * Build a domain metadata object for pattern-layer nodes.
 *
 * Each domain follows the same shape: `{ [domain]: true, [domain]_type: kind, ...extra }`.
 *
 * @param domain - The domain tag (e.g. `"orchestration"`, `"ai"`, `"cqrs"`).
 * @param kind - The specific type within the domain (e.g. `"gate"`, `"prompt"`).
 * @param extra - Additional metadata to merge.
 * @returns Metadata object.
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
