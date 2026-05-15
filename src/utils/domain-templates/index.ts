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

import { batch } from "@graphrefly/pure-ts/core";
import { type Node, node } from "@graphrefly/pure-ts/core";
import { reactiveLog, type StratifyRule, stratify } from "@graphrefly/pure-ts/extra";
import { Graph, type GraphOptions } from "@graphrefly/pure-ts/graph";
import { feedback, scorer } from "../reduction/index.js";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

import { keepalive } from "@graphrefly/pure-ts/extra";
import { domainMeta } from "../../base/meta/domain-meta.js";

function baseMeta(kind: string, extra?: Record<string, unknown>): Record<string, unknown> {
	return domainMeta("domain_template", kind, extra);
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
	g.add(opts.source, { name: "source" });

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
	// Wrap each branch in a derived with `initial: null` so every branch has
	// a seed value at subscribe time — this lets the correlate wave reach its
	// first-run gate even when the classifier only routes to one branch.
	const branchNodes = branches.map((b) => {
		try {
			const raw = g.resolve(`stratify::branch/${b.name}`);
			return node(
				[raw as Node],
				(batchData, actions, ctx) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					actions.emit(data[0]);
				},
				{ initial: null, describeKind: "derived" },
			);
		} catch {
			return node<unknown>([], { initial: null });
		}
	});
	const correlateFn = opts.correlate ?? ((vals: unknown[]) => vals);
	const correlateNode = node<unknown>(
		branchNodes as Node[],
		(batchData, actions, ctx) => {
			const vals = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(correlateFn(vals as unknown[]));
		},
		{
			describeKind: "derived",
			meta: baseMeta("observability", { stage: "correlate" }),
		},
	);
	g.add(correlateNode, { name: "correlate" });

	// --- SLO verification ---
	const sloCheckFn = opts.sloCheck ?? (() => ({ pass: true }));
	const sloValue = node<unknown>(
		[correlateNode],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(data[0]);
		},
		{
			describeKind: "derived",
			meta: baseMeta("observability", { stage: "slo_value" }),
		},
	);
	const sloVerified = node<unknown>(
		[sloValue],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(sloCheckFn(data[0]));
		},
		{
			describeKind: "derived",
			meta: baseMeta("observability", { stage: "slo_verified" }),
		},
	);
	g.add(sloValue, { name: "slo_value" });
	g.add(sloVerified, { name: "slo_verified" });

	// --- Alert scorer ---
	const weightValues = opts.weights ?? branches.map(() => 1);
	const signalNodes = branchNodes.map((bn) =>
		node<number>(
			[bn],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(data[0] != null ? 1 : 0);
			},
			{ describeKind: "derived" },
		),
	);
	const weightNodes = weightValues.map((w) => node<number>([], { initial: w }));
	for (let i = 0; i < signalNodes.length; i++) {
		g.add(signalNodes[i] as Node<unknown>, { name: `__signal_${i}` });
		g.add(weightNodes[i] as Node<unknown>, { name: `__weight_${i}` });
	}
	const alerts = scorer(
		signalNodes as ReadonlyArray<Node<number>>,
		weightNodes as ReadonlyArray<Node<number>>,
	);
	g.add(alerts as Node<unknown>, { name: "alerts" });

	// --- Output alias ---
	const output = node<unknown>(
		[alerts as Node, sloVerified],
		(batchData, actions, ctx) => {
			const vals = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit({
				scored: vals[0],
				slo: vals[1],
			});
		},
		{
			describeKind: "derived",
			meta: baseMeta("observability", { stage: "output" }),
		},
	);
	g.add(output, { name: "output" });

	// --- Feedback (false-positive learning) ---
	// SLO failures feed back to re-check with updated context.
	const fbReentry = node<unknown>([], {
		initial: null,
		meta: baseMeta("observability", { stage: "feedback_reentry" }),
	});
	g.add(fbReentry, { name: "feedback_reentry" });
	const fbCondition = node<unknown>(
		[sloVerified],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const result = data[0] as Record<string, unknown> | null;
			actions.emit(result && result.pass === false ? result : null);
		},
		{
			describeKind: "derived",
			meta: baseMeta("observability", { stage: "feedback_condition" }),
		},
	);
	g.add(fbCondition as Node<unknown>, { name: "feedback_condition" });
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
	g.add(opts.source, { name: "source" });

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
	const extractNode = node<ExtractedIssue>(
		[opts.source],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(extractFn(data[0]));
		},
		{
			describeKind: "derived",
			meta: baseMeta("issue_tracker", { stage: "extract" }),
		},
	);
	g.add(extractNode as Node<unknown>, { name: "extract" });

	// --- Verify ---
	const verifyFn = opts.verify ?? (() => ({ valid: true }));
	const verifyNode = node<unknown>(
		[extractNode as Node],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const issue = data[0] as ExtractedIssue;
			actions.emit({ issue, verification: verifyFn(issue) });
		},
		{
			describeKind: "derived",
			meta: baseMeta("issue_tracker", { stage: "verify" }),
		},
	);
	g.add(verifyNode, { name: "verify" });

	// --- Known patterns (memory / distillation state) ---
	const knownPatterns = node<unknown[]>([], {
		initial: [],
		meta: baseMeta("issue_tracker", { stage: "known_patterns" }),
	});
	g.add(knownPatterns as Node<unknown>, { name: "known_patterns" });

	// --- Regression detection ---
	const detectFn = opts.detectRegression ?? (() => ({ regression: false }));
	const regressionNode = node<unknown>(
		[extractNode as Node, knownPatterns as Node],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const issue = data[0] as ExtractedIssue;
			const known = data[1];
			actions.emit({ issue, regression: detectFn(issue, known) });
		},
		{ describeKind: "derived", meta: baseMeta("issue_tracker", { stage: "regression" }) },
	);
	g.add(regressionNode, { name: "regression" });

	// --- Priority scoring ---
	const severitySignal = node<number>(
		[extractNode as Node],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const issue = data[0] as ExtractedIssue;
			actions.emit(issue?.severity ?? 0);
		},
		{ describeKind: "derived" },
	);
	const regressionSignal = node<number>(
		[regressionNode],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const r = data[0] as Record<string, unknown> | null;
			actions.emit(r?.regression ? 2 : 0);
		},
		{ describeKind: "derived" },
	);
	g.add(severitySignal as Node<unknown>, { name: "__severity_signal" });
	g.add(regressionSignal as Node<unknown>, { name: "__regression_signal" });

	const severityWeight = node<number>([], { initial: 1 });
	const regressionWeight = node<number>([], { initial: 1.5 });
	g.add(severityWeight as Node<unknown>, { name: "__severity_weight" });
	g.add(regressionWeight as Node<unknown>, { name: "__regression_weight" });

	const priority = scorer([severitySignal, regressionSignal], [severityWeight, regressionWeight]);
	g.add(priority as Node<unknown>, { name: "priority" });

	// --- Output ---
	const output = node<unknown>(
		[verifyNode, regressionNode, priority as Node],
		(batchData, actions, ctx) => {
			const vals = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit({
				verified: vals[0],
				regression: vals[1],
				priority: vals[2],
			});
		},
		{ describeKind: "derived", meta: baseMeta("issue_tracker", { stage: "output" }) },
	);
	g.add(output, { name: "output" });

	// --- Feedback (re-scan on verification failure) ---
	const fbReentry = node<unknown>([], {
		initial: null,
		meta: baseMeta("issue_tracker", { stage: "feedback_reentry" }),
	});
	g.add(fbReentry, { name: "feedback_reentry" });
	const fbCondition = node<unknown>(
		[verifyNode],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const result = data[0] as Record<string, unknown> | null;
			if (result) {
				const v = result.verification as Record<string, unknown> | null;
				if (v && v.valid === false) {
					actions.emit(result);
					return;
				}
			}
			actions.emit(null);
		},
		{
			describeKind: "derived",
			meta: baseMeta("issue_tracker", { stage: "feedback_condition" }),
		},
	);
	g.add(fbCondition as Node<unknown>, { name: "feedback_condition" });
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

	/** Max review queue size. When set, oldest entries are trimmed on overflow. */
	maxQueueSize?: number;
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
	g.add(opts.source, { name: "source" });

	// --- Classify ---
	const defaultClassify = (content: unknown): ModerationResult => ({
		label: "review",
		confidence: 0.5,
		original: content,
	});
	const classifyFn = opts.classify ?? defaultClassify;
	const classifyNode = node<ModerationResult>(
		[opts.source],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(classifyFn(data[0]));
		},
		{
			describeKind: "derived",
			meta: baseMeta("content_moderation", { stage: "classify" }),
		},
	);
	g.add(classifyNode as Node<unknown>, { name: "classify" });

	// --- Stratify (safe / review / block) ---
	const strat = stratify<ModerationResult>("stratify", classifyNode, [
		{ name: "safe", classify: (v) => v.label === "safe" },
		{ name: "review", classify: (v) => v.label === "review" },
		{ name: "block", classify: (v) => v.label === "block" },
	]);
	g.mount("stratify", strat);

	// --- Review queue (reactiveLog — O(1) append, bounded) ---
	const reviewLog = reactiveLog<ModerationResult>([], {
		name: "review_queue",
		maxSize: opts.maxQueueSize,
	});
	g.add(reviewLog.entries as Node<unknown>, { name: "review_queue" });

	// Bridge review branch → review queue accumulator
	let reviewBranch: Node<unknown>;
	try {
		reviewBranch = g.resolve("stratify::branch/review");
	} catch {
		reviewBranch = node<unknown>([], { initial: null });
		g.add(reviewBranch, { name: "__review_fallback" });
	}
	const reviewAccumulator = node(
		[reviewBranch],
		(batchData, _actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const item = data[0] as ModerationResult | null;
			if (item) {
				reviewLog.append(item);
			}
		},
		{ describeKind: "effect" },
	);
	g.add(reviewAccumulator as Node<unknown>, { name: "__review_accumulator" });
	g.addDisposer(keepalive(reviewAccumulator as Node<unknown>));
	try {
	} catch {
		// fallback branch — no stratify edge to register
	}

	// --- Policy state (human/LLM writable) ---
	const policy = node<Record<string, unknown>>([], {
		initial: {},
		meta: baseMeta("content_moderation", {
			stage: "policy",
			access: "both",
			description: "Moderation policy rules — updated via feedback",
		}),
	});
	g.add(policy as Node<unknown>, { name: "policy" });

	// --- Priority scorer ---
	const weights = opts.weights ?? [0.1, 1, 2];
	const confidenceSignal = node<number>(
		[classifyNode as Node],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const r = data[0] as ModerationResult | null;
			actions.emit(r?.confidence ?? 0);
		},
		{ describeKind: "derived" },
	);
	const severitySignal = node<number>(
		[classifyNode as Node],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const r = data[0] as ModerationResult | null;
			if (!r) {
				actions.emit(0);
				return;
			}
			actions.emit(
				r.label === "block" ? weights[2] : r.label === "review" ? weights[1] : weights[0],
			);
		},
		{ describeKind: "derived" },
	);
	g.add(confidenceSignal as Node<unknown>, { name: "__confidence_signal" });
	g.add(severitySignal as Node<unknown>, { name: "__severity_signal" });

	const wConfidence = node<number>([], { initial: 1 });
	const wSeverity = node<number>([], { initial: 1 });
	g.add(wConfidence as Node<unknown>, { name: "__w_confidence" });
	g.add(wSeverity as Node<unknown>, { name: "__w_severity" });

	const priority = scorer([confidenceSignal, severitySignal], [wConfidence, wSeverity]);
	g.add(priority as Node<unknown>, { name: "priority" });

	// --- Output ---
	const output = node<unknown>(
		[classifyNode as Node, priority as Node],
		(batchData, actions, ctx) => {
			const vals = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit({
				classification: vals[0],
				priority: vals[1],
			});
		},
		{ describeKind: "derived", meta: baseMeta("content_moderation", { stage: "output" }) },
	);
	g.add(output, { name: "output" });

	// --- Feedback (false positive → policy refinement) ---
	// Feedback condition: human marks a review item as false positive.
	// When review_queue changes and policy exists, signal for update.
	const fbCondition = node<unknown>(
		[reviewLog.entries as Node, policy as Node],
		(batchData, actions, ctx) => {
			const vals = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const entries = vals[0] as readonly ModerationResult[] | null;
			if (entries && entries.length > 0) {
				const latest = entries[entries.length - 1];
				// Items explicitly marked as false positive feed back
				if (latest && (latest as unknown as Record<string, unknown>).falsePositive) {
					actions.emit(latest);
					return;
				}
			}
			actions.emit(null);
		},
		{
			describeKind: "derived",
			meta: baseMeta("content_moderation", { stage: "feedback_condition" }),
		},
	);
	g.add(fbCondition as Node<unknown>, { name: "feedback_condition" });
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
	g.add(opts.source, { name: "source" });

	// --- Schema validation ---
	const validateFn =
		opts.validate ??
		((record: unknown): ValidationResult => ({
			valid: true,
			errors: [],
			record,
		}));
	const validateNode = node<ValidationResult | undefined>(
		[opts.source],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(data[0] != null ? validateFn(data[0]) : undefined);
		},
		{ describeKind: "derived", meta: baseMeta("data_quality", { stage: "validate" }) },
	);
	g.add(validateNode as Node<unknown>, { name: "validate" });

	// --- Anomaly detection ---
	const detectAnomalyFn =
		opts.detectAnomaly ??
		((record: unknown): AnomalyResult => ({
			anomaly: false,
			score: 0,
			record,
		}));
	const anomalyNode = node<AnomalyResult | undefined>(
		[opts.source],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(data[0] != null ? detectAnomalyFn(data[0]) : undefined);
		},
		{ describeKind: "derived", meta: baseMeta("data_quality", { stage: "anomaly" }) },
	);
	g.add(anomalyNode as Node<unknown>, { name: "anomaly" });

	// --- Baseline (rolling state) ---
	const baseline = node<unknown>([], {
		initial: null,
		meta: baseMeta("data_quality", {
			stage: "baseline",
			description: "Rolling baseline for drift detection",
		}),
	});
	g.add(baseline, { name: "baseline" });

	// Update baseline on valid records
	const baselineUpdater = node(
		[validateNode as Node],
		(batchData, _actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const result = data[0] as ValidationResult;
			if (result?.valid) {
				batch(() => {
					baseline.emit(result.record);
				});
			}
		},
		{ describeKind: "effect" },
	);
	g.add(baselineUpdater as Node<unknown>, { name: "__baseline_updater" });
	keepalive(baselineUpdater as Node<unknown>);

	// --- Drift detection ---
	const detectDriftFn = opts.detectDrift ?? (() => ({ drift: false }));
	const driftNode = node<unknown>(
		[opts.source, baseline],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(detectDriftFn(data[0], data[1]));
		},
		{ describeKind: "derived", meta: baseMeta("data_quality", { stage: "drift" }) },
	);
	g.add(driftNode, { name: "drift" });

	// --- Remediation suggestions ---
	const suggestFn = opts.suggest ?? (() => null);
	const remediateNode = node<unknown>(
		[validateNode as Node, anomalyNode as Node],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(
				suggestFn({
					validation: data[0] as ValidationResult,
					anomaly: data[1] as AnomalyResult,
				}),
			);
		},
		{ describeKind: "derived", meta: baseMeta("data_quality", { stage: "remediate" }) },
	);
	g.add(remediateNode, { name: "remediate" });

	// --- Output ---
	const output = node<unknown>(
		[validateNode as Node, anomalyNode as Node, driftNode, remediateNode],
		(batchData, actions, ctx) => {
			const vals = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit({
				validation: vals[0],
				anomaly: vals[1],
				drift: vals[2],
				remediation: vals[3],
			});
		},
		{ describeKind: "derived", meta: baseMeta("data_quality", { stage: "output" }) },
	);
	g.add(output, { name: "output" });

	// --- Feedback (anomaly → validation rule refinement) ---
	const validationRules = node<unknown[]>([], {
		initial: [],
		meta: baseMeta("data_quality", { stage: "validation_rules" }),
	});
	g.add(validationRules as Node<unknown>, { name: "validation_rules" });

	const fbCondition = node<unknown>(
		[anomalyNode as Node],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const a = data[0] as AnomalyResult | null;
			actions.emit(a?.anomaly ? a : null);
		},
		{
			describeKind: "derived",
			meta: baseMeta("data_quality", { stage: "feedback_condition" }),
		},
	);
	g.add(fbCondition as Node<unknown>, { name: "feedback_condition" });
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
