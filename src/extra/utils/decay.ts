/**
 * Pure exponential-decay utility (Tier 2.2 promotion from `patterns/memory/`).
 *
 * Used by `collection`, `agentMemory`, harness `strategy.ts`, and any
 * downstream consumer that needs decay-with-floor scoring. Promoted to
 * `extra/utils/` because the math has zero domain semantics and is reusable
 * by non-memory primitives (e.g. routing weight decay, retry-attempt aging).
 *
 * @module
 */

/**
 * Default exponential-decay rate corresponding to a 7-day half-life.
 *
 * `Math.LN2 / (7 × 86_400)` ≈ `1.146e-6`. Imported by memory tiers + any
 * consumer that wants the same default cadence as `agentMemory`'s active
 * tier. Tier 4.4 (Wave AM Unit 1) — promoted from
 * `patterns/ai/memory/tiers.ts` so non-memory consumers can share the
 * canonical default without reaching across domains.
 */
export const DEFAULT_DECAY_RATE = Math.LN2 / (7 * 86_400);

/**
 * Exponential decay with floor: `score = max(minScore, baseScore * exp(-ratePerSecond * ageSeconds))`.
 *
 * Tolerant fallbacks (deliberate for use inside reactive derived fns):
 * - non-finite `baseScore` → `minScore`
 * - non-positive `ageSeconds` (incl. clock skew) → `max(minScore, baseScore)` (no decay)
 * - non-positive `ratePerSecond` → `max(minScore, baseScore)` (no decay; rate=0 disables)
 *
 * Underflow boundary: `Math.exp(-745) === 0`. For very long ages × rates the
 * result clamps to `minScore`; if you need slow decay over years, choose a
 * smaller `ratePerSecond` rather than relying on graceful underflow.
 *
 * Half-life conversion: `ratePerSecond = Math.LN2 / halfLifeSeconds`.
 */
export function decay(
	baseScore: number,
	ageSeconds: number,
	ratePerSecond: number,
	minScore = 0,
): number {
	if (!Number.isFinite(baseScore)) return minScore;
	if (!Number.isFinite(ageSeconds) || ageSeconds <= 0) return Math.max(minScore, baseScore);
	if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) return Math.max(minScore, baseScore);
	const decayed = baseScore * Math.exp(-ratePerSecond * ageSeconds);
	return Math.max(minScore, decayed);
}
