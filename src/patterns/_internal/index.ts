/**
 * Domain-specific shared helpers for the patterns layer.
 *
 * These are private helpers used across multiple pattern modules but with
 * pattern-layer semantics (not promotable to extra/). Cross-domain primitives
 * have moved to extra/ per Tier 2.2:
 *  - `domainMeta` → `extra/meta.ts`
 *  - `keepalive` / `reactiveCounter` → `extra/sources.ts`
 *  - `tryIncrementBounded` / mutation framework → `extra/mutation/`
 *
 * @internal
 * @module
 */

import { downWithBatch } from "../../core/batch.js";
import { DATA } from "../../core/messages.js";
import type { Node } from "../../core/node.js";
import { defaultConfig } from "../../core/node.js";

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
 * **Caller contract — uniqueness (qa D1, 2026-04-29).** Two distinct intake
 * items sharing the same `summary` (and neither carrying `relatedTo`)
 * produce the SAME tracking key. The harness's `routeJobIds` map is keyed
 * by this value: a duplicate-key publish overwrites the prior mapping, and
 * a later `ackJob` for the original publish acks the wrong audit job.
 * Single-threaded JS makes the typical structural-failure path safe (the
 * ack runs before reingest publishes), but multi-publisher concurrency or
 * batched intake of two items with identical summaries can race.
 *
 * **Caller responsibility:** ensure `summary` uniqueness OR carry an
 * explicit stable id via `relatedTo[0]` for items that may collide. For
 * retry/reingestion paths the `relatedTo` array MUST start with the
 * original tracking key — `[originalKey, ...]` — so the carried-forward
 * identity matches the audit log entry created at first publish.
 *
 * @internal
 */
export function trackingKey(item: { summary: string; relatedTo?: string[] }): string {
	return item.relatedTo?.[0] ?? item.summary;
}
