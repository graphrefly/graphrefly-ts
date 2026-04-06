/**
 * Domain templates (roadmap §8.2).
 *
 * Opinionated Graph factories for common "info → action" domains.
 * Each template wires up §8.1 reduction primitives (stratify, funnel, feedback,
 * budgetGate, scorer) with domain-specific stages. Users fork/extend by
 * accessing named nodes and swapping stages.
 *
 * **Source injection (option B):** templates accept a `source` node, not a
 * hardcoded adapter. Pass `fromOTel(...)`, `fromGitHook(...)`, or a test
 * `state()` — the topology is the same.
 *
 * @module
 */

import { DATA } from "../core/messages.js";
import type { Node } from "../core/node.js";
import { derived, effect, state } from "../core/sugar.js";
import { Graph, type GraphOptions } from "../graph/graph.js";
import { feedback, type StratifyRule, scorer, stratify } from "./reduction.js";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function keepalive(n: Node<unknown>): () => void {
	return n.subscribe(() => {});
}

function baseMeta(kind: string, extra?: Record<string, unknown>): Record<string, unknown> {
	return { domain_template: true, template_type: kind, ...(extra ?? {}) };
}

// ---------------------------------------------------------------------------
// 1. observabilityGraph
// ---------------------------------------------------------------------------

/** Stratification branch config for observability signals. */
export type ObservabilityBranch = {
	name: string;
	classify: (value: unknown) => boolean;
};

/** Options for {@link observabilityGraph}. */
export type ObservabilityGraphOptions = GraphOptions & {
	/** Ingested signal source (e.g. fromOTel(...) or test state). */
	source: Node<unknown>;

	/**
	 * Classification rules for signal stratification.
	 * Default: errors / traces / metrics branches.
	 */
	branches?: ObservabilityBranch[];

	/**
	 * Correlation function: receives stratified branch values and produces
	 * correlated insights. Default: identity pass-through.
	 */
	correlate?: (values: unknown[]) => unknown;

	/**
	 * SLO verification function: returns a verification result for a
	 * correlated insight. Default: always passes.
	 */
	sloCheck?: (value: unknown) => unknown;

	/**
	 * Scorer weights for alert prioritization. One per branch.
	 * Default: equal weights [1, 1, 1].
	 */
	weights?: number[];

	/** Max feedback iterations for false-positive learning. Default: 5. */
	maxFeedbackIterations?: number;
};

/**
 * OTel ingest → stratified reduction → correlation → SLO verification →
 * alert prioritization → output.
 *
 * Well-known node names:
 * - `"source"` — injected signal source
 * - `"stratify::branch/<name>"` — per-branch classification
 * - `"correlate"` — cross-branch correlation
 * - `"slo_value"`, `"slo_verified"` — SLO verification pair
 * - `"alerts"` — scored, prioritized output
 * - `"output"` — final output (alias for alerts)
 *
 * @category patterns
 */
export function observabilityGraph(name: string, opts: ObservabilityGraphOptions): Graph {
	const g = new Graph(name, opts);

	// --- Source ---
	g.add("source", opts.source);

	// --- Stratify ---
	const defaultBranches: ObservabilityBranch[] = [
		{ name: "errors", classify: (v) => isTagged(v, "error") },
		{ name: "traces", classify: (v) => isTagged(v, "trace") },
		{ name: "metrics", classify: (v) => isTagged(v, "metric") },
	];
	const branches = opts.branches ?? defaultBranches;
	const rules: StratifyRule<unknown>[] = branches.map((b) => ({
		name: b.name,
		classify: b.classify,
	}));
	const strat = stratify("stratify", opts.source, rules);
	g.mount("stratify", strat);

	// --- Correlate ---
	// Collect latest value from each branch, produce correlated output.
	const branchNodes = branches.map((b) => {
		try {
			return g.resolve(`stratify::branch/${b.name}`);
		} catch {
			return state<unknown>(null);
		}
	});
	const correlateFn = opts.correlate ?? ((vals: unknown[]) => vals);
	const correlateNode = derived<unknown>(branchNodes as Node[], (vals) => correlateFn(vals as unknown[]), {
		meta: baseMeta("observability", { stage: "correlate" }),
	});
	g.add("correlate", correlateNode);
	for (const b of branches) {
		try {
			g.connect(`stratify::branch/${b.name}`, "correlate");
		} catch {
			/* branch may not exist */
		}
	}

	// --- SLO verification ---
	const sloCheckFn = opts.sloCheck ?? (() => ({ pass: true }));
	const sloValue = derived<unknown>([correlateNode], (vals) => vals[0], {
		meta: baseMeta("observability", { stage: "slo_value" }),
	});
	const sloVerified = derived<unknown>([sloValue], (vals) => sloCheckFn(vals[0]), {
		meta: baseMeta("observability", { stage: "slo_verified" }),
	});
	g.add("slo_value", sloValue);
	g.add("slo_verified", sloVerified);
	g.connect("correlate", "slo_value");
	g.connect("slo_value", "slo_verified");

	// --- Alert scorer ---
	const weightValues = opts.weights ?? branches.map(() => 1);
	const signalNodes = branchNodes.map((bn) =>
		derived<number>([bn], (vals) => (vals[0] != null ? 1 : 0)),
	);
	const weightNodes = weightValues.map((w) => state<number>(w));
	for (let i = 0; i < signalNodes.length; i++) {
		g.add(`__signal_${i}`, signalNodes[i] as Node<unknown>);
		g.add(`__weight_${i}`, weightNodes[i] as Node<unknown>);
	}
	const alerts = scorer(
		signalNodes as ReadonlyArray<Node<number>>,
		weightNodes as ReadonlyArray<Node<number>>,
	);
	g.add("alerts", alerts as Node<unknown>);

	// --- Output alias ---
	const output = derived<unknown>(
		[alerts as Node, sloVerified],
		(vals) => ({
			scored: vals[0],
			slo: vals[1],
		}),
		{
			meta: baseMeta("observability", { stage: "output" }),
		},
	);
	g.add("output", output);
	g.connect("alerts", "output");
	g.connect("slo_verified", "output");

	// --- Feedback (false-positive learning) ---
	// SLO failures feed back to re-check with updated context.
	const fbReentry = state<unknown>(null, {
		meta: baseMeta("observability", { stage: "feedback_reentry" }),
	});
	g.add("feedback_reentry", fbReentry);
	const fbCondition = derived<unknown>(
		[sloVerified],
		(vals) => {
			const result = vals[0] as Record<string, unknown> | null;
			if (result && result.pass === false) return result;
			return null;
		},
		{
			meta: baseMeta("observability", { stage: "feedback_condition" }),
		},
	);
	g.add("feedback_condition", fbCondition as Node<unknown>);
	g.connect("slo_verified", "feedback_condition");
	feedback(g, "feedback_condition", "feedback_reentry", {
		maxIterations: opts.maxFeedbackIterations ?? 5,
	});

	return g;
}

// ---------------------------------------------------------------------------
// 2. issueTrackerGraph
// ---------------------------------------------------------------------------

/** A structured issue extracted from raw findings. */
export type ExtractedIssue = {
	id: string;
	title: string;
	severity: number;
	source: string;
	raw: unknown;
};

/** Options for {@link issueTrackerGraph}. */
export type IssueTrackerGraphOptions = GraphOptions & {
	/** Findings source (e.g. fromGitHook(...), fromFSWatch(...)). */
	source: Node<unknown>;

	/**
	 * Extract structured issues from raw findings.
	 * Default: wraps raw value as a single issue.
	 */
	extract?: (raw: unknown) => ExtractedIssue;

	/**
	 * Verify an extracted issue (assertion check).
	 * Default: always valid.
	 */
	verify?: (issue: ExtractedIssue) => unknown;

	/**
	 * Detect regression by comparing against known patterns.
	 * Receives (current issue, known patterns).
	 * Default: no regression detected.
	 */
	detectRegression?: (issue: ExtractedIssue, known: unknown) => unknown;

	/** Max feedback iterations for re-scanning. Default: 3. */
	maxFeedbackIterations?: number;
};

/**
 * Findings ingest → extraction → verification → regression detection →
 * distillation → prioritized queue.
 *
 * Well-known node names:
 * - `"source"` — injected findings source
 * - `"extract"` — structured issue extraction
 * - `"verify"` — issue verification
 * - `"known_patterns"` — accumulated known issue patterns (state)
 * - `"regression"` — regression detection
 * - `"priority"` — severity-based prioritization
 * - `"output"` — final prioritized output
 *
 * @category patterns
 */
export function issueTrackerGraph(name: string, opts: IssueTrackerGraphOptions): Graph {
	const g = new Graph(name, opts);

	// --- Source ---
	g.add("source", opts.source);

	// --- Extract ---
	let _issueCounter = 0;
	const defaultExtract = (raw: unknown): ExtractedIssue => ({
		id: `issue-${++_issueCounter}`,
		title: String(raw),
		severity: 1,
		source: "unknown",
		raw,
	});
	const extractFn = opts.extract ?? defaultExtract;
	const extractNode = derived<ExtractedIssue>([opts.source], (vals) => extractFn(vals[0]), {
		meta: baseMeta("issue_tracker", { stage: "extract" }),
	});
	g.add("extract", extractNode as Node<unknown>);
	g.connect("source", "extract");

	// --- Verify ---
	const verifyFn = opts.verify ?? (() => ({ valid: true }));
	const verifyNode = derived<unknown>(
		[extractNode as Node],
		(vals) => {
			const issue = vals[0] as ExtractedIssue;
			return { issue, verification: verifyFn(issue) };
		},
		{
			meta: baseMeta("issue_tracker", { stage: "verify" }),
		},
	);
	g.add("verify", verifyNode);
	g.connect("extract", "verify");

	// --- Known patterns (memory / distillation state) ---
	const knownPatterns = state<unknown[]>([], {
		meta: baseMeta("issue_tracker", { stage: "known_patterns" }),
	});
	g.add("known_patterns", knownPatterns as Node<unknown>);

	// --- Regression detection ---
	const detectFn = opts.detectRegression ?? (() => ({ regression: false }));
	const regressionNode = derived<unknown>(
		[extractNode as Node, knownPatterns as Node],
		(vals) => {
			const issue = vals[0] as ExtractedIssue;
			const known = vals[1];
			return { issue, regression: detectFn(issue, known) };
		},
		{ meta: baseMeta("issue_tracker", { stage: "regression" }) },
	);
	g.add("regression", regressionNode);
	g.connect("extract", "regression");
	g.connect("known_patterns", "regression");

	// --- Priority scoring ---
	const severitySignal = derived<number>([extractNode as Node], (vals) => {
		const issue = vals[0] as ExtractedIssue;
		return issue?.severity ?? 0;
	});
	const regressionSignal = derived<number>([regressionNode], (vals) => {
		const r = vals[0] as Record<string, unknown> | null;
		return r && r.regression ? 2 : 0;
	});
	g.add("__severity_signal", severitySignal as Node<unknown>);
	g.add("__regression_signal", regressionSignal as Node<unknown>);

	const severityWeight = state<number>(1);
	const regressionWeight = state<number>(1.5);
	g.add("__severity_weight", severityWeight as Node<unknown>);
	g.add("__regression_weight", regressionWeight as Node<unknown>);

	const priority = scorer([severitySignal, regressionSignal], [severityWeight, regressionWeight]);
	g.add("priority", priority as Node<unknown>);

	// --- Output ---
	const output = derived<unknown>(
		[verifyNode, regressionNode, priority as Node],
		(vals) => ({
			verified: vals[0],
			regression: vals[1],
			priority: vals[2],
		}),
		{ meta: baseMeta("issue_tracker", { stage: "output" }) },
	);
	g.add("output", output);
	g.connect("verify", "output");
	g.connect("regression", "output");
	g.connect("priority", "output");

	// --- Feedback (re-scan on verification failure) ---
	const fbReentry = state<unknown>(null, {
		meta: baseMeta("issue_tracker", { stage: "feedback_reentry" }),
	});
	g.add("feedback_reentry", fbReentry);
	const fbCondition = derived<unknown>(
		[verifyNode],
		(vals) => {
			const result = vals[0] as Record<string, unknown> | null;
			if (result) {
				const v = result.verification as Record<string, unknown> | null;
				if (v && v.valid === false) return result;
			}
			return null;
		},
		{
			meta: baseMeta("issue_tracker", { stage: "feedback_condition" }),
		},
	);
	g.add("feedback_condition", fbCondition as Node<unknown>);
	g.connect("verify", "feedback_condition");
	feedback(g, "feedback_condition", "feedback_reentry", {
		maxIterations: opts.maxFeedbackIterations ?? 3,
	});

	return g;
}

// ---------------------------------------------------------------------------
// 3. contentModerationGraph
// ---------------------------------------------------------------------------

/** Classification result from LLM moderation. */
export type ModerationResult = {
	label: "safe" | "review" | "block";
	confidence: number;
	reason?: string;
	original: unknown;
};

/** Options for {@link contentModerationGraph}. */
export type ContentModerationGraphOptions = GraphOptions & {
	/** Content source (text/multimedia ingest). */
	source: Node<unknown>;

	/**
	 * Classification function: returns a ModerationResult.
	 * Default: labels everything "review" with confidence 0.5.
	 */
	classify?: (content: unknown) => ModerationResult;

	/** System prompt for LLM classification. */
	systemPrompt?: string;

	/** Scorer weights: [safe, review, block]. Default: [0.1, 1, 2]. */
	weights?: [number, number, number];

	/** Max feedback iterations for policy refinement. Default: 5. */
	maxFeedbackIterations?: number;
};

/**
 * Content ingest → LLM/rule classification → stratified routing (safe/review/block) →
 * human review queue → scorer → feedback (false positives → policy refinement) → output.
 *
 * Well-known node names:
 * - `"source"` — content ingest
 * - `"classify"` — LLM or rule-based classification
 * - `"stratify::branch/safe"`, `"stratify::branch/review"`, `"stratify::branch/block"` — routed branches
 * - `"review_queue"` — state node for human review items
 * - `"priority"` — scored priority output
 * - `"policy"` — writable state for policy refinement
 * - `"output"` — final moderation output
 *
 * @category patterns
 */
export function contentModerationGraph(name: string, opts: ContentModerationGraphOptions): Graph {
	const g = new Graph(name, opts);

	// --- Source ---
	g.add("source", opts.source);

	// --- Classify ---
	const defaultClassify = (content: unknown): ModerationResult => ({
		label: "review",
		confidence: 0.5,
		original: content,
	});
	const classifyFn = opts.classify ?? defaultClassify;
	const classifyNode = derived<ModerationResult>([opts.source], (vals) => classifyFn(vals[0]), {
		meta: baseMeta("content_moderation", { stage: "classify" }),
	});
	g.add("classify", classifyNode as Node<unknown>);
	g.connect("source", "classify");

	// --- Stratify (safe / review / block) ---
	const strat = stratify<ModerationResult>("stratify", classifyNode, [
		{ name: "safe", classify: (v) => v.label === "safe" },
		{ name: "review", classify: (v) => v.label === "review" },
		{ name: "block", classify: (v) => v.label === "block" },
	]);
	g.mount("stratify", strat);

	// --- Review queue (human-writable state) ---
	const reviewQueue = state<ModerationResult[]>([], {
		meta: baseMeta("content_moderation", {
			stage: "review_queue",
			access: "both",
			description: "Items awaiting human review",
		}),
	});
	g.add("review_queue", reviewQueue as Node<unknown>);

	// Bridge review branch → review queue accumulator
	let reviewBranch: Node<unknown>;
	try {
		reviewBranch = g.resolve("stratify::branch/review");
	} catch {
		reviewBranch = state<unknown>(null);
		g.add("__review_fallback", reviewBranch);
	}
	const reviewAccumulator = effect([reviewBranch], (vals) => {
		const item = vals[0] as ModerationResult | null;
		if (item) {
			const current = reviewQueue.get() as ModerationResult[];
			reviewQueue.down([[DATA, [...current, item]]]);
		}
	});
	g.add("__review_accumulator", reviewAccumulator as Node<unknown>);
	keepalive(reviewAccumulator as Node<unknown>);

	// --- Policy state (human/LLM writable) ---
	const policy = state<Record<string, unknown>>(
		{},
		{
			meta: baseMeta("content_moderation", {
				stage: "policy",
				access: "both",
				description: "Moderation policy rules — updated via feedback",
			}),
		},
	);
	g.add("policy", policy as Node<unknown>);

	// --- Priority scorer ---
	const weights = opts.weights ?? [0.1, 1, 2];
	const confidenceSignal = derived<number>([classifyNode as Node], (vals) => {
		const r = vals[0] as ModerationResult | null;
		return r?.confidence ?? 0;
	});
	const severitySignal = derived<number>([classifyNode as Node], (vals) => {
		const r = vals[0] as ModerationResult | null;
		if (!r) return 0;
		return r.label === "block" ? weights[2] : r.label === "review" ? weights[1] : weights[0];
	});
	g.add("__confidence_signal", confidenceSignal as Node<unknown>);
	g.add("__severity_signal", severitySignal as Node<unknown>);

	const wConfidence = state<number>(1);
	const wSeverity = state<number>(1);
	g.add("__w_confidence", wConfidence as Node<unknown>);
	g.add("__w_severity", wSeverity as Node<unknown>);

	const priority = scorer([confidenceSignal, severitySignal], [wConfidence, wSeverity]);
	g.add("priority", priority as Node<unknown>);

	// --- Output ---
	const output = derived<unknown>(
		[classifyNode as Node, priority as Node],
		(vals) => ({
			classification: vals[0],
			priority: vals[1],
		}),
		{ meta: baseMeta("content_moderation", { stage: "output" }) },
	);
	g.add("output", output);
	g.connect("classify", "output");
	g.connect("priority", "output");

	// --- Feedback (false positive → policy refinement) ---
	// Feedback condition: human marks a review item as false positive.
	// When review_queue changes and policy exists, signal for update.
	const fbCondition = derived<unknown>(
		[reviewQueue as Node, policy as Node],
		(vals) => {
			const queue = vals[0] as ModerationResult[] | null;
			if (queue && queue.length > 0) {
				const latest = queue[queue.length - 1];
				// Items explicitly marked as false positive feed back
				if (latest && (latest as unknown as Record<string, unknown>).falsePositive) {
					return latest;
				}
			}
			return null;
		},
		{
			meta: baseMeta("content_moderation", { stage: "feedback_condition" }),
		},
	);
	g.add("feedback_condition", fbCondition as Node<unknown>);
	feedback(g, "feedback_condition", "policy", {
		maxIterations: opts.maxFeedbackIterations ?? 5,
	});

	return g;
}

// ---------------------------------------------------------------------------
// 4. dataQualityGraph
// ---------------------------------------------------------------------------

/** Schema validation result. */
export type ValidationResult = {
	valid: boolean;
	errors: string[];
	record: unknown;
};

/** Anomaly detection result. */
export type AnomalyResult = {
	anomaly: boolean;
	score: number;
	detail?: string;
	record: unknown;
};

/** Options for {@link dataQualityGraph}. */
export type DataQualityGraphOptions = GraphOptions & {
	/** Data source (e.g. fromPrisma(...), fromKysely(...)). */
	source: Node<unknown>;

	/**
	 * Schema validation function.
	 * Default: always valid.
	 */
	validate?: (record: unknown) => ValidationResult;

	/**
	 * Anomaly detection function.
	 * Default: no anomaly.
	 */
	detectAnomaly?: (record: unknown) => AnomalyResult;

	/**
	 * Drift detection: compares current record against baseline.
	 * Default: no drift.
	 */
	detectDrift?: (record: unknown, baseline: unknown) => unknown;

	/**
	 * Remediation suggestion function.
	 * Default: no suggestion.
	 */
	suggest?: (result: { validation: ValidationResult; anomaly: AnomalyResult }) => unknown;

	/** Max feedback iterations for rule refinement. Default: 3. */
	maxFeedbackIterations?: number;
};

/**
 * Data ingest → schema validation → anomaly detection → drift alerting →
 * auto-remediation suggestions → output.
 *
 * Well-known node names:
 * - `"source"` — data ingest
 * - `"validate"` — schema validation
 * - `"anomaly"` — anomaly detection
 * - `"baseline"` — rolling baseline state
 * - `"drift"` — drift detection
 * - `"remediate"` — auto-remediation suggestions
 * - `"output"` — combined quality report
 *
 * @category patterns
 */
export function dataQualityGraph(name: string, opts: DataQualityGraphOptions): Graph {
	const g = new Graph(name, opts);

	// --- Source ---
	g.add("source", opts.source);

	// --- Schema validation ---
	const validateFn =
		opts.validate ??
		((record: unknown): ValidationResult => ({
			valid: true,
			errors: [],
			record,
		}));
	const validateNode = derived<ValidationResult | undefined>(
		[opts.source],
		(vals) => (vals[0] != null ? validateFn(vals[0]) : undefined),
		{ meta: baseMeta("data_quality", { stage: "validate" }) },
	);
	g.add("validate", validateNode as Node<unknown>);
	g.connect("source", "validate");

	// --- Anomaly detection ---
	const detectAnomalyFn =
		opts.detectAnomaly ??
		((record: unknown): AnomalyResult => ({
			anomaly: false,
			score: 0,
			record,
		}));
	const anomalyNode = derived<AnomalyResult | undefined>(
		[opts.source],
		(vals) => (vals[0] != null ? detectAnomalyFn(vals[0]) : undefined),
		{ meta: baseMeta("data_quality", { stage: "anomaly" }) },
	);
	g.add("anomaly", anomalyNode as Node<unknown>);
	g.connect("source", "anomaly");

	// --- Baseline (rolling state) ---
	const baseline = state<unknown>(null, {
		meta: baseMeta("data_quality", {
			stage: "baseline",
			description: "Rolling baseline for drift detection",
		}),
	});
	g.add("baseline", baseline);

	// Update baseline on valid records
	const baselineUpdater = effect([validateNode as Node], (vals) => {
		const result = vals[0] as ValidationResult;
		if (result?.valid) {
			baseline.down([[DATA, result.record]]);
		}
	});
	g.add("__baseline_updater", baselineUpdater as Node<unknown>);
	g.connect("validate", "__baseline_updater");
	keepalive(baselineUpdater as Node<unknown>);

	// --- Drift detection ---
	const detectDriftFn = opts.detectDrift ?? (() => ({ drift: false }));
	const driftNode = derived<unknown>(
		[opts.source, baseline],
		(vals) => detectDriftFn(vals[0], vals[1]),
		{ meta: baseMeta("data_quality", { stage: "drift" }) },
	);
	g.add("drift", driftNode);
	g.connect("source", "drift");
	g.connect("baseline", "drift");

	// --- Remediation suggestions ---
	const suggestFn = opts.suggest ?? (() => null);
	const remediateNode = derived<unknown>(
		[validateNode as Node, anomalyNode as Node],
		(vals) =>
			suggestFn({
				validation: vals[0] as ValidationResult,
				anomaly: vals[1] as AnomalyResult,
			}),
		{ meta: baseMeta("data_quality", { stage: "remediate" }) },
	);
	g.add("remediate", remediateNode);
	g.connect("validate", "remediate");
	g.connect("anomaly", "remediate");

	// --- Output ---
	const output = derived<unknown>(
		[validateNode as Node, anomalyNode as Node, driftNode, remediateNode],
		(vals) => ({
			validation: vals[0],
			anomaly: vals[1],
			drift: vals[2],
			remediation: vals[3],
		}),
		{ meta: baseMeta("data_quality", { stage: "output" }) },
	);
	g.add("output", output);
	g.connect("validate", "output");
	g.connect("anomaly", "output");
	g.connect("drift", "output");
	g.connect("remediate", "output");

	// --- Feedback (anomaly → validation rule refinement) ---
	const validationRules = state<unknown[]>([], {
		meta: baseMeta("data_quality", { stage: "validation_rules" }),
	});
	g.add("validation_rules", validationRules as Node<unknown>);

	const fbCondition = derived<unknown>(
		[anomalyNode as Node],
		(vals) => {
			const a = vals[0] as AnomalyResult | null;
			if (a && a.anomaly) return a;
			return null;
		},
		{
			meta: baseMeta("data_quality", { stage: "feedback_condition" }),
		},
	);
	g.add("feedback_condition", fbCondition as Node<unknown>);
	g.connect("anomaly", "feedback_condition");
	feedback(g, "feedback_condition", "validation_rules", {
		maxIterations: opts.maxFeedbackIterations ?? 3,
	});

	return g;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a value has a `type` or `kind` tag matching the given label. */
function isTagged(value: unknown, tag: string): boolean {
	if (value == null || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return v.type === tag || v.kind === tag;
}
