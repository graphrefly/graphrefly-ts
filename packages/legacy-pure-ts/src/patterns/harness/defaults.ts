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
	PresetId,
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

/**
 * Canonical 3-axis composite-key factory: `${presetId}|${rootCause}→${intervention}`.
 *
 * **Phase 13.I axis extension (DS-13.I, 2026-05-01).** Pre-multi-agent
 * callers without a preset registry pass {@link DEFAULT_PRESET_ID}
 * (`"default"`) for the first arg. Pre-1.0 breaking signature change;
 * persisted strategy-model snapshots from before this date are NOT portable.
 */
export function strategyKey(
	presetId: PresetId,
	rootCause: RootCause,
	intervention: Intervention,
): StrategyKey {
	return `${presetId}|${rootCause}→${intervention}`;
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

// ---------------------------------------------------------------------------
// Default stage prompts
// ---------------------------------------------------------------------------

/** Default TRIAGE prompt — LLM classifies intake items into root-cause + intervention + route + priority. */
export const DEFAULT_TRIAGE_PROMPT = `You are a triage classifier for a reactive collaboration harness.

Given an intake item, classify it and output JSON:
{
  "rootCause": "composition" | "missing-fn" | "bad-docs" | "schema-gap" | "regression" | "unknown",
  "intervention": "template" | "catalog-fn" | "docs" | "wrapper" | "schema-change" | "investigate",
  "route": "auto-fix" | "needs-decision" | "investigation" | "backlog",
  "priority": <number 0-100>,
  "triageReasoning": "<one sentence>"
}

Strategy model (past effectiveness):
{{strategy}}

Intake item:
{{item}}`;

/** Default EXECUTE prompt — LLM produces a fix given a triaged issue. */
export const DEFAULT_EXECUTE_PROMPT = `You are an implementation agent.

Given a triaged issue with root cause and intervention type, produce a fix.

Issue:
{{item}}

Output JSON:
{
  "outcome": "success" | "failure" | "partial",
  "detail": "<description of what was done or what failed>"
}`;

/** Default VERIFY prompt — LLM reviews an execution result against the original issue. */
export const DEFAULT_VERIFY_PROMPT = `You are a QA reviewer.

Given an execution result, verify whether the fix is correct.

Execution:
{{execution}}

Original issue:
{{item}}

Output JSON:
{
  "verified": true/false,
  "findings": ["<finding1>", ...],
  "errorClass": "self-correctable" | "structural"  // only if verified=false
}`;

// ---------------------------------------------------------------------------
// Prompt resolver helper
// ---------------------------------------------------------------------------

/**
 * Collapse the `string | ((input: In) => string) | undefined` prompt-template
 * pattern into a single `(input: In) => string`. A function `raw` is used as-is
 * (the caller opted into full control). Otherwise `raw ?? fallbackTemplate`
 * is fed through `substitute`, which does the placeholder replacement.
 *
 * Used by the three harness stages (TRIAGE / EXECUTE / VERIFY), which each
 * accept a `string | function` config but use different placeholder schemes
 * (`{{item}}`, `{{execution}}`, `{{strategy}}`). The helper absorbs only the
 * branch logic; the per-stage placeholder substitution lives at the call site.
 */
export function resolvePromptFn<In>(
	raw: string | ((input: In) => string) | undefined,
	fallbackTemplate: string,
	substitute: (template: string, input: In) => string,
): (input: In) => string {
	if (typeof raw === "function") return raw;
	const template = raw ?? fallbackTemplate;
	return (input) => substitute(template, input);
}
