/**
 * Harness wiring types (roadmap §9.0).
 *
 * Shared types for the reactive collaboration loop: intake, triage, queue,
 * gate, execute, verify, reflect. These types are intentionally domain-agnostic
 * — the harness loop is not specific to eval workflows.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

/** Sources that can produce intake items. */
export type IntakeSource = "eval" | "test" | "human" | "code-change" | "hypothesis" | "parity";

/** Severity levels for intake items. */
export type Severity = "critical" | "high" | "medium" | "low";

/** Root cause categories for triage classification. */
export type RootCause =
	| "composition"
	| "missing-fn"
	| "bad-docs"
	| "schema-gap"
	| "regression"
	| "unknown";

/** Intervention types that address root causes. */
export type Intervention =
	| "template"
	| "catalog-fn"
	| "docs"
	| "wrapper"
	| "schema-change"
	| "investigate";

/** Routing destinations after triage. */
export type QueueRoute = "auto-fix" | "needs-decision" | "investigation" | "backlog";

/**
 * An item entering the harness loop via the INTAKE stage.
 *
 * All intake sources produce this uniform shape — the intake topic
 * doesn't care where items came from.
 */
export interface IntakeItem {
	source: IntakeSource;
	summary: string;
	evidence: string;
	affectsAreas: string[];
	affectsEvalTasks?: string[];
	severity?: Severity;
	relatedTo?: string[];
}

// ---------------------------------------------------------------------------
// Triage output
// ---------------------------------------------------------------------------

/** Output of the TRIAGE stage — enriched intake item with classification. */
export interface TriagedItem extends IntakeItem {
	rootCause: RootCause;
	intervention: Intervention;
	route: QueueRoute;
	priority: number;
	triageReasoning?: string;
}

// ---------------------------------------------------------------------------
// Strategy model
// ---------------------------------------------------------------------------

/** Effectiveness record for a rootCause→intervention pair. */
export interface StrategyEntry {
	rootCause: RootCause;
	intervention: Intervention;
	attempts: number;
	successes: number;
	successRate: number;
}

/** Key format: `${rootCause}→${intervention}`. */
export type StrategyKey = `${RootCause}→${Intervention}`;

export function strategyKey(rootCause: RootCause, intervention: Intervention): StrategyKey {
	return `${rootCause}→${intervention}`;
}

// ---------------------------------------------------------------------------
// Execution & verification
// ---------------------------------------------------------------------------

/** Result of the EXECUTE stage. */
export interface ExecutionResult {
	item: TriagedItem;
	outcome: "success" | "failure" | "partial";
	detail: string;
	retryCount: number;
}

/** Whether an error is self-correctable (fast-retry) or structural (full loop). */
export type ErrorClass = "self-correctable" | "structural";

/** Classifier for fast-retry path. */
export type ErrorClassifier = (result: ExecutionResult) => ErrorClass;

/** Default error classifier: parse/config errors are self-correctable. */
export function defaultErrorClassifier(result: ExecutionResult): ErrorClass {
	const d = result.detail.toLowerCase();
	if (
		d.includes("parse") ||
		d.includes("json") ||
		d.includes("config") ||
		d.includes("validation") ||
		d.includes("syntax")
	) {
		return "self-correctable";
	}
	return "structural";
}

// ---------------------------------------------------------------------------
// Verification output
// ---------------------------------------------------------------------------

/** Result of the VERIFY stage. */
export interface VerifyResult {
	item: TriagedItem;
	execution: ExecutionResult;
	verified: boolean;
	findings: string[];
	errorClass?: ErrorClass;
}

// ---------------------------------------------------------------------------
// Priority scoring
// ---------------------------------------------------------------------------

/** Configurable signals for priority scoring. */
export interface PrioritySignals {
	/** Per-severity base weight (default: critical=100, high=70, medium=40, low=10). */
	severityWeights?: Partial<Record<Severity, number>>;
	/** Decay rate per second for attention decay (default ~1.15e-6 ≈ 7-day half-life). */
	decayRate?: number;
	/** Strategy model effectiveness boost threshold (default 0.7). */
	effectivenessThreshold?: number;
	/** Strategy model effectiveness boost amount (default 15). */
	effectivenessBoost?: number;
}

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
// Harness loop configuration
// ---------------------------------------------------------------------------

/** Per-queue configuration in the harness loop. */
export interface QueueConfig {
	/** Whether this queue is gated (requires human approval). */
	gated: boolean;
	/** Maximum pending items in the gate (default Infinity). */
	maxPending?: number;
	/** Start the gate in open (auto-approve) mode? */
	startOpen?: boolean;
}

/** Default queue configurations. */
export const DEFAULT_QUEUE_CONFIGS: Record<QueueRoute, QueueConfig> = {
	"auto-fix": { gated: false },
	"needs-decision": { gated: true },
	investigation: { gated: true },
	backlog: { gated: false, startOpen: false },
};

/** Options for {@link harnessLoop}. */
export interface HarnessLoopOptions {
	/** LLM adapter for promptNode-based stages (triage, execute, verify, reflect). */
	adapter: unknown; // LLMAdapter — kept as unknown to avoid circular dep

	/** Custom triage prompt (receives IntakeItem + strategy model as context). */
	triagePrompt?: string | ((...args: unknown[]) => string);

	/** Custom execute prompt. */
	executePrompt?: string | ((...args: unknown[]) => string);

	/** Custom verify prompt. */
	verifyPrompt?: string | ((...args: unknown[]) => string);

	/** Per-queue configuration overrides. */
	queues?: Partial<Record<QueueRoute, QueueConfig>>;

	/** Priority scoring signals. */
	priority?: PrioritySignals;

	/** Error classifier for fast-retry path. */
	errorClassifier?: ErrorClassifier;

	/** Max fast-retries per item before routing to full intake (default 2). */
	maxRetries?: number;

	/** Max re-ingestions from verify→intake before giving up (default 1). */
	maxReingestions?: number;

	/** Retained limit for topic logs (default 1000). */
	retainedLimit?: number;
}
