// FLAG: v5 behavioral change — needs investigation
// All tests in this file fail with:
//   Graph "...": connect(source, target) — target must include source in its constructor deps (same node reference)
// The underlying pattern factories (stratify, feedback, etc.) use Graph.connect() which now
// enforces that the target node already has the source in its deps array.

import { DATA } from "@graphrefly/pure-ts/core/messages.js";
import { node } from "@graphrefly/pure-ts/core/node.js";
import { describe, expect, it } from "vitest";

import {
	type AnomalyResult,
	contentModerationGraph,
	dataQualityGraph,
	type ExtractedIssue,
	issueTrackerGraph,
	type ModerationResult,
	observabilityGraph,
	type ValidationResult,
} from "../../patterns/domain-templates/index.js";

// ---------------------------------------------------------------------------
// observabilityGraph
// ---------------------------------------------------------------------------

describe("observabilityGraph", () => {
	it("creates a graph with well-known nodes", () => {
		const source = node<unknown>([], { initial: null });
		const g = observabilityGraph("obs", { source });
		const desc = g.describe();

		expect(desc.name).toBe("obs");
		expect(desc.nodes).toHaveProperty("source");
		expect(desc.nodes).toHaveProperty("correlate");
		expect(desc.nodes).toHaveProperty("slo_value");
		expect(desc.nodes).toHaveProperty("slo_verified");
		expect(desc.nodes).toHaveProperty("alerts");
		expect(desc.nodes).toHaveProperty("output");
	});

	it("stratifies signals into branches by default", () => {
		const source = node<unknown>([], { initial: null });
		const g = observabilityGraph("obs", { source });
		const desc = g.describe();

		expect(desc.nodes).toHaveProperty("stratify::branch/errors");
		expect(desc.nodes).toHaveProperty("stratify::branch/traces");
		expect(desc.nodes).toHaveProperty("stratify::branch/metrics");
	});

	it("accepts custom branches", () => {
		const source = node<unknown>([], { initial: null });
		const g = observabilityGraph("obs", {
			source,
			branches: [{ name: "logs", classify: (v) => (v as Record<string, unknown>)?.type === "log" }],
		});
		const desc = g.describe();
		expect(desc.nodes).toHaveProperty("stratify::branch/logs");
	});

	it("correlate node receives branch values", () => {
		const source = node<unknown>([], { initial: null });
		let correlatedValues: unknown[] | null = null;
		const g = observabilityGraph("obs", {
			source,
			correlate: (vals) => {
				correlatedValues = vals as unknown[];
				return { correlated: true };
			},
		});

		// Activate output chain
		const output = g.node("output");
		output.subscribe(() => {});

		// Emit a signal
		source.down([[DATA, { type: "error", msg: "fail" }]]);
		expect(correlatedValues).not.toBeNull();
	});

	it("SLO check defaults to pass", () => {
		const source = node<unknown>([], { initial: null });
		const g = observabilityGraph("obs", { source });

		const slo = g.node("slo_verified");
		slo.subscribe(() => {});
		const output = g.node("output");
		output.subscribe(() => {});

		source.down([[DATA, { type: "error", msg: "test" }]]);
		const result = slo.cache as Record<string, unknown>;
		expect(result).toEqual({ pass: true });
	});

	it("feedback wires up for SLO failures", () => {
		const source = node<unknown>([], { initial: null });
		const g = observabilityGraph("obs", {
			source,
			sloCheck: () => ({ pass: false, reason: "latency" }),
			maxFeedbackIterations: 2,
		});
		const desc = g.describe();

		expect(desc.nodes).toHaveProperty("feedback_reentry");
		expect(desc.nodes).toHaveProperty("feedback_condition");
	});

	it("graph is destroyable", () => {
		const source = node<unknown>([], { initial: null });
		const g = observabilityGraph("obs", { source });
		expect(() => g.destroy()).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// issueTrackerGraph
// ---------------------------------------------------------------------------

describe("issueTrackerGraph", () => {
	it("creates a graph with well-known nodes", () => {
		const source = node<unknown>([], { initial: null });
		const g = issueTrackerGraph("issues", { source });
		const desc = g.describe();

		expect(desc.name).toBe("issues");
		expect(desc.nodes).toHaveProperty("source");
		expect(desc.nodes).toHaveProperty("extract");
		expect(desc.nodes).toHaveProperty("verify");
		expect(desc.nodes).toHaveProperty("known_patterns");
		expect(desc.nodes).toHaveProperty("regression");
		expect(desc.nodes).toHaveProperty("priority");
		expect(desc.nodes).toHaveProperty("output");
	});

	it("extracts structured issues from raw findings", () => {
		const source = node<unknown>([], { initial: null });
		const g = issueTrackerGraph("issues", {
			source,
			extract: (raw) => ({
				id: "issue-1",
				title: String(raw),
				severity: 3,
				source: "test",
				raw,
			}),
		});

		const extract = g.node("extract");
		extract.subscribe(() => {});
		const output = g.node("output");
		output.subscribe(() => {});

		source.down([[DATA, "found a bug"]]);
		const issue = extract.cache as ExtractedIssue;
		expect(issue.id).toBe("issue-1");
		expect(issue.severity).toBe(3);
	});

	it("verify defaults to valid", () => {
		const source = node<unknown>([], { initial: null });
		const g = issueTrackerGraph("issues", { source });

		const verify = g.node("verify");
		verify.subscribe(() => {});
		const output = g.node("output");
		output.subscribe(() => {});

		source.down([[DATA, "test finding"]]);
		const result = verify.cache as Record<string, unknown>;
		expect(result.verification).toEqual({ valid: true });
	});

	it("regression detection works with custom fn", () => {
		const source = node<unknown>([], { initial: null });
		const g = issueTrackerGraph("issues", {
			source,
			detectRegression: (issue, _known) => ({
				regression: issue.severity > 2,
			}),
		});

		const regression = g.node("regression");
		regression.subscribe(() => {});
		const output = g.node("output");
		output.subscribe(() => {});

		source.down([[DATA, "critical bug"]]);
		const result = regression.cache as Record<string, unknown>;
		expect(result).toHaveProperty("regression");
	});

	it("priority scorer combines severity and regression signals", () => {
		const source = node<unknown>([], { initial: null });
		const g = issueTrackerGraph("issues", {
			source,
			extract: (raw) => ({
				id: "1",
				title: String(raw),
				severity: 5,
				source: "test",
				raw,
			}),
			detectRegression: () => ({ regression: true }),
		});

		const priority = g.node("priority");
		priority.subscribe(() => {});
		const output = g.node("output");
		output.subscribe(() => {});

		source.down([[DATA, "regression bug"]]);
		const scored = priority.cache as { score: number };
		// severity=5 * weight=1 + regression=2 * weight=1.5 = 8
		expect(scored.score).toBe(8);
	});
});

// ---------------------------------------------------------------------------
// contentModerationGraph
// ---------------------------------------------------------------------------

describe("contentModerationGraph", () => {
	it("creates a graph with well-known nodes", () => {
		const source = node<unknown>([], { initial: null });
		const g = contentModerationGraph("moderation", { source });
		const desc = g.describe();

		expect(desc.name).toBe("moderation");
		expect(desc.nodes).toHaveProperty("source");
		expect(desc.nodes).toHaveProperty("classify");
		expect(desc.nodes).toHaveProperty("review_queue");
		expect(desc.nodes).toHaveProperty("policy");
		expect(desc.nodes).toHaveProperty("priority");
		expect(desc.nodes).toHaveProperty("output");
	});

	it("stratifies into safe/review/block branches", () => {
		const source = node<unknown>([], { initial: null });
		const g = contentModerationGraph("moderation", { source });
		const desc = g.describe();

		expect(desc.nodes).toHaveProperty("stratify::branch/safe");
		expect(desc.nodes).toHaveProperty("stratify::branch/review");
		expect(desc.nodes).toHaveProperty("stratify::branch/block");
	});

	it("classify defaults to review", () => {
		const source = node<unknown>([], { initial: null });
		const g = contentModerationGraph("moderation", { source });

		const classify = g.node("classify");
		classify.subscribe(() => {});
		const output = g.node("output");
		output.subscribe(() => {});

		source.down([[DATA, "some content"]]);
		const result = classify.cache as ModerationResult;
		expect(result.label).toBe("review");
		expect(result.confidence).toBe(0.5);
	});

	it("custom classify routes correctly", () => {
		const source = node<unknown>([], { initial: null });
		const g = contentModerationGraph("moderation", {
			source,
			classify: (content) => ({
				label: String(content).includes("bad") ? "block" : "safe",
				confidence: 0.9,
				original: content,
			}),
		});

		const classify = g.node("classify");
		classify.subscribe(() => {});
		const output = g.node("output");
		output.subscribe(() => {});

		source.down([[DATA, "bad content"]]);
		const result = classify.cache as ModerationResult;
		expect(result.label).toBe("block");
	});

	it("policy is writable state", () => {
		const source = node<unknown>([], { initial: null });
		const g = contentModerationGraph("moderation", { source });

		const policy = g.node("policy");
		policy.down([[DATA, { blockProfanity: true }]]);
		expect(policy.cache).toEqual({ blockProfanity: true });
	});
});

// ---------------------------------------------------------------------------
// dataQualityGraph
// ---------------------------------------------------------------------------

describe("dataQualityGraph", () => {
	it("creates a graph with well-known nodes", () => {
		const source = node<unknown>([], { initial: null });
		const g = dataQualityGraph("dq", { source });
		const desc = g.describe();

		expect(desc.name).toBe("dq");
		expect(desc.nodes).toHaveProperty("source");
		expect(desc.nodes).toHaveProperty("validate");
		expect(desc.nodes).toHaveProperty("anomaly");
		expect(desc.nodes).toHaveProperty("baseline");
		expect(desc.nodes).toHaveProperty("drift");
		expect(desc.nodes).toHaveProperty("remediate");
		expect(desc.nodes).toHaveProperty("output");
	});

	it("validate defaults to valid", () => {
		const source = node<unknown>([], { initial: null });
		const g = dataQualityGraph("dq", { source });

		const validate = g.node("validate");
		validate.subscribe(() => {});
		const output = g.node("output");
		output.subscribe(() => {});

		source.down([[DATA, { id: 1, name: "test" }]]);
		const result = validate.cache as ValidationResult;
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it("custom validation catches invalid records", () => {
		const source = node<unknown>([], { initial: null });
		const g = dataQualityGraph("dq", {
			source,
			validate: (record) => {
				const r = record as Record<string, unknown>;
				const errors: string[] = [];
				if (!r.name) errors.push("missing name");
				return { valid: errors.length === 0, errors, record };
			},
		});

		// Activate the full chain so derived nodes compute
		const output = g.node("output");
		output.subscribe(() => {});
		const validate = g.node("validate");
		validate.subscribe(() => {});

		source.down([[DATA, { id: 1 }]]);
		const result = validate.cache as ValidationResult;
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("missing name");
	});

	it("anomaly detection works", () => {
		const source = node<unknown>([], { initial: null });
		const g = dataQualityGraph("dq", {
			source,
			detectAnomaly: (record) => {
				const r = record as Record<string, number>;
				return {
					anomaly: r.value > 100,
					score: r.value > 100 ? 0.9 : 0,
					record,
				};
			},
		});

		// Activate the full chain
		const output = g.node("output");
		output.subscribe(() => {});
		const anomaly = g.node("anomaly");
		anomaly.subscribe(() => {});

		source.down([[DATA, { value: 999 }]]);
		const result = anomaly.cache as AnomalyResult;
		expect(result.anomaly).toBe(true);
		expect(result.score).toBe(0.9);
	});

	it("baseline updates on valid records", () => {
		const source = node<unknown>([], { initial: null });
		const g = dataQualityGraph("dq", { source });

		// Activate the full chain including baseline updater effect
		const output = g.node("output");
		output.subscribe(() => {});
		const baselineUpdater = g.node("__baseline_updater");
		baselineUpdater.subscribe(() => {});

		const baseline = g.node("baseline");

		source.down([[DATA, { id: 1, name: "valid" }]]);
		expect(baseline.cache).toEqual({ id: 1, name: "valid" });
	});

	it("output combines all quality checks", () => {
		const source = node<unknown>([], { initial: null });
		const g = dataQualityGraph("dq", { source });

		const output = g.node("output");
		output.subscribe(() => {});

		source.down([[DATA, { id: 1, name: "test" }]]);
		const result = output.cache as Record<string, unknown>;
		expect(result).toHaveProperty("validation");
		expect(result).toHaveProperty("anomaly");
		expect(result).toHaveProperty("drift");
		expect(result).toHaveProperty("remediation");
	});

	it("feedback wires anomalies to validation rules", () => {
		const source = node<unknown>([], { initial: null });
		const g = dataQualityGraph("dq", {
			source,
			detectAnomaly: (record) => ({
				anomaly: true,
				score: 1,
				record,
			}),
		});
		const desc = g.describe();

		expect(desc.nodes).toHaveProperty("validation_rules");
		expect(desc.nodes).toHaveProperty("feedback_condition");
	});

	it("graph is destroyable", () => {
		const source = node<unknown>([], { initial: null });
		const g = dataQualityGraph("dq", { source });
		expect(() => g.destroy()).not.toThrow();
	});
});
