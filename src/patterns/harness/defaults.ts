/**
 * Harness runtime defaults (roadmap §9.0).
 *
 * Split out from `types.ts` in Wave B Unit 15 G so the type file holds
 * only type declarations and plug-in contracts. Runtime constants and
 * helpers live here; the harness barrel (`index.ts`) re-exports both so
 * external consumers see a single surface.
 *
 * @module
 */

import type {
	ErrorClass,
	ErrorClassifier,
	ExecutionResult,
	Intervention,
	QueueConfig,
	QueueRoute,
	RootCause,
	Severity,
	StrategyKey,
} from "./types.js";

// ---------------------------------------------------------------------------
// Route / queue
// ---------------------------------------------------------------------------

/** Ordered queue route names for iteration. */
export const QUEUE_NAMES: readonly QueueRoute[] = [
	"auto-fix",
	"needs-decision",
	"investigation",
	"backlog",
];

/** Default queue configurations. */
export const DEFAULT_QUEUE_CONFIGS: Record<QueueRoute, QueueConfig> = {
	"auto-fix": { gated: false },
	"needs-decision": { gated: true },
	investigation: { gated: true },
	// `startOpen` intentionally omitted — backlog is not gated, so the flag
	// would be meaningless. Dropped in Unit 15 G trim pass.
	backlog: { gated: false },
};

// ---------------------------------------------------------------------------
// Priority scoring
// ---------------------------------------------------------------------------

/** Default severity weights. */
export const DEFAULT_SEVERITY_WEIGHTS: Record<Severity, number> = {
	critical: 100,
	high: 70,
	medium: 40,
	low: 10,
};

/** Default decay rate: ~7-day half-life. */
export const DEFAULT_DECAY_RATE = Math.LN2 / (7 * 24 * 3600);

// ---------------------------------------------------------------------------
// Strategy model
// ---------------------------------------------------------------------------

/** Canonical `${RootCause}→${Intervention}` join char; used by the `StrategyKey` template literal. */
export function strategyKey(rootCause: RootCause, intervention: Intervention): StrategyKey {
	return `${rootCause}→${intervention}`;
}

// ---------------------------------------------------------------------------
// Error classifier
// ---------------------------------------------------------------------------

/**
 * Regex-word-boundary match over a closed keyword set. Callers needing
 * domain-specific failure modes should supply a custom
 * {@link ErrorClassifier}; this default exists so zero-config harness runs
 * still distinguish parse-class failures (fast-retry) from everything
 * else (full loop via reingestion).
 */
const SELF_CORRECTABLE_RE = /\b(parse|json|config|validation|syntax)\b/i;

/** Default error classifier: parse/config errors are self-correctable. */
export const defaultErrorClassifier: ErrorClassifier = (result: ExecutionResult): ErrorClass =>
	SELF_CORRECTABLE_RE.test(result.detail) ? "self-correctable" : "structural";
