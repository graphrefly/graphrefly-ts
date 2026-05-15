/**
 * Harness-domain internal helpers.
 *
 * trackingKey extracted from patterns/_internal/index.ts during cleave A2.
 * Destination decided per STOP #1 resolution: harness-domain shape,
 * used only by utils/harness/types.ts and presets/harness/harness-loop.ts.
 */

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
