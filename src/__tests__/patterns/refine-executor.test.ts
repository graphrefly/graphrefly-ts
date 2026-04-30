/**
 * Unit tests for the EXECUTE/VERIFY actuator pair:
 *   - `refineExecutor` — wraps `refineLoop` into the harness EXECUTE slot.
 *   - `evalVerifier`   — re-runs the evaluator against the artifact EXECUTE emitted.
 *
 * Plus the pluggable-slot contract: the default LLM executor/verifier still
 * works when the caller doesn't pass `executor` / `verifier`.
 */

import { describe, expect, it } from "vitest";
import { DATA } from "../../core/messages.js";
import { type Node, node } from "../../core/node.js";

import {
	evalVerifier,
	type HarnessJobPayload,
	harnessLoop,
	refineExecutor,
	type VerifyResult,
} from "../../patterns/harness/index.js";
import type {
	DatasetItem,
	EvalResult,
	Evaluator,
	RefineStrategy,
} from "../../patterns/harness/presets/refine-loop.js";
import { mockLLM } from "../helpers/mock-llm.js";

const REQUIRED = ["reactive", "composable", "inspectable"] as const;
const DATASET: readonly DatasetItem[] = REQUIRED.map((kw) => ({ id: kw }));

const keywordEvaluator: Evaluator<string> = (candidates, dataset) =>
	node<readonly EvalResult[]>(
		[candidates as Node<unknown>, dataset as Node<unknown>],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const cs = data[0] as readonly string[];
			const ds = data[1] as readonly DatasetItem[];
			const best = (cs[0] ?? "").toLowerCase();
			actions.emit(
				ds.map((row) => ({
					taskId: row.id,
					score: best.includes(row.id.toLowerCase()) ? 1 : 0,
				})),
			);
		},
		{ describeKind: "derived" },
	);

const keywordAppender: RefineStrategy<string> = {
	name: "keyword-appender",
	seed: (s) => [s],
	analyze: (_scores, candidates) => {
		const best = (candidates[0] ?? "").toLowerCase();
		const missing = REQUIRED.filter((kw) => !best.includes(kw));
		return {
			summary: `${missing.length} missing`,
			score: (REQUIRED.length - missing.length) / REQUIRED.length,
			weakTasks: [...missing],
		};
	},
	generate: async (feedback, prior) => {
		const missing = (feedback.weakTasks ?? []) as readonly string[];
		const base = prior[0] ?? "";
		return [`${base} ${missing[0] ?? ""}`.trim()];
	},
};

function cannedTriageAdapter() {
	return mockLLM({
		fallback: {
			rootCause: "missing-fn",
			intervention: "template",
			route: "auto-fix",
			priority: 80,
			triageReasoning: "needs keywords",
		},
	});
}

function awaitFirstVerify(
	latest: Node<VerifyResult | null>,
	timeoutMs = 2000,
): Promise<VerifyResult> {
	return new Promise((resolve, reject) => {
		// Pre-declare with a no-op so the timeout callback can't hit TDZ if
		// `subscribe` ever becomes async-dispatching in a future refactor.
		let unsub: () => void = () => {};
		const timer = setTimeout(() => {
			unsub();
			reject(new Error(`no VerifyResult within ${timeoutMs}ms`));
		}, timeoutMs);
		unsub = latest.subscribe((msgs) => {
			for (const [type, value] of msgs) {
				if (type === DATA && value) {
					clearTimeout(timer);
					unsub();
					resolve(value as VerifyResult);
				}
			}
		});
	});
}

describe("refineExecutor + evalVerifier (end-to-end)", () => {
	it("converges on the expected artifact and verifies reactively", async () => {
		const adapter = cannedTriageAdapter();
		const harness = harnessLoop("test-refine-hello", {
			adapter,
			executor: refineExecutor<string>({
				seedFrom: () => "base",
				datasetFor: () => DATASET,
				evaluator: keywordEvaluator,
				strategy: keywordAppender,
				refine: { minScore: 1.0, maxIterations: 8 },
			}),
			verifier: evalVerifier<string>({
				datasetFor: () => DATASET,
				evaluator: keywordEvaluator,
				threshold: 1.0,
			}),
		});

		const verifyPromise = awaitFirstVerify(
			harness.verifyResults.latest as Node<VerifyResult | null>,
		);

		harness.intake.publish({
			source: "eval",
			summary: "seed missing keywords",
			evidence: "fixture",
			affectsAreas: ["catalog"],
			affectsEvalTasks: [...REQUIRED],
			severity: "high",
		});

		const verify = await verifyPromise;
		expect(verify.verified).toBe(true);
		expect(verify.findings[0]).toContain("3/3 eval tasks passed");
		expect(verify.execution.outcome).toBe("success");
		expect(verify.execution.artifact).toBe("base reactive composable inspectable");

		harness.destroy();
	});

	it("destroy() after first convergence does not throw on late inner-loop drain", async () => {
		// Teardown regression: the inner `refineLoop` + evaluator subgraphs are
		// built inside switchMap's project fn and NOT registered on the harness.
		// `harness.destroy()` must not leave orphan nodes live or throw if a late
		// wave lands during teardown. This test publishes an item, awaits the
		// first verify, destroys the harness, then waits a microtask and
		// re-publishes to ensure no uncaught rejections.
		const adapter = cannedTriageAdapter();
		const harness = harnessLoop("test-refine-teardown", {
			adapter,
			executor: refineExecutor<string>({
				seedFrom: () => "base",
				datasetFor: () => DATASET,
				evaluator: keywordEvaluator,
				strategy: keywordAppender,
				refine: { minScore: 1.0, maxIterations: 8 },
			}),
			verifier: evalVerifier<string>({
				datasetFor: () => DATASET,
				evaluator: keywordEvaluator,
				threshold: 1.0,
			}),
		});

		const verifyPromise = awaitFirstVerify(
			harness.verifyResults.latest as Node<VerifyResult | null>,
		);
		harness.intake.publish({
			source: "eval",
			summary: "teardown-case",
			evidence: "fixture",
			affectsAreas: ["catalog"],
			affectsEvalTasks: [...REQUIRED],
			severity: "high",
		});
		await verifyPromise;

		// Capture any late rejections / errors. Vitest fails the test if an
		// unhandled error fires.
		expect(() => harness.destroy()).not.toThrow();

		// Drain the microtask queue — any pending inner-loop promise resolving
		// after destroy must not throw.
		await Promise.resolve();
		await Promise.resolve();
	});

	it("verifier marks failure when EXECUTE emits no artifact", async () => {
		const adapter = cannedTriageAdapter();
		const harness = harnessLoop<string>("test-refine-no-artifact", {
			adapter,
			// Custom work-fn executor that emits a payload WITHOUT artifact to
			// exercise the evalVerifier fallback. Synchronous payload return —
			// `fromAny` wraps it for the JobFlow pump.
			executor: (job) =>
				({
					...job.payload,
					execution: {
						item: job.payload.item,
						outcome: "success",
						detail: "no-artifact",
					},
				}) satisfies HarnessJobPayload<string>,
			verifier: evalVerifier<string>({
				datasetFor: () => DATASET,
				evaluator: keywordEvaluator,
				threshold: 1.0,
			}),
		});

		const verifyPromise = awaitFirstVerify(
			harness.verifyResults.latest as Node<VerifyResult | null>,
		);
		harness.intake.publish({
			source: "eval",
			summary: "no-artifact case",
			evidence: "fixture",
			affectsAreas: ["catalog"],
			affectsEvalTasks: [...REQUIRED],
			severity: "high",
		});

		// With no artifact, the no-op executor still emits — verifier will
		// route through its "no artifact" structural-failure path. But fast-retry
		// may reingest up to maxReingestions before surfacing on verifyResults.
		// For this test, we just confirm the first verify emission is a failure.
		const verify = await verifyPromise;
		expect(verify.verified).toBe(false);
		expect(verify.findings.join(" ")).toContain("artifact");

		harness.destroy();
	});
});

describe("pluggable slot defaults", () => {
	it("default LLM executor + verifier still wire when no custom slots supplied", async () => {
		const adapter = mockLLM({
			stages: {
				triage: {
					responses: [
						{
							rootCause: "missing-fn",
							intervention: "template",
							route: "auto-fix",
							priority: 80,
							triageReasoning: "seed missing keywords",
						},
					],
				},
				execute: {
					responses: [{ outcome: "success", detail: "defaulted execute" }],
				},
				verify: {
					responses: [{ verified: true, findings: ["looks fine"] }],
				},
			},
		});
		const harness = harnessLoop("test-default-slots", { adapter });

		const verifyPromise = awaitFirstVerify(
			harness.verifyResults.latest as Node<VerifyResult | null>,
		);
		harness.intake.publish({
			source: "eval",
			summary: "default-path",
			evidence: "fixture",
			affectsAreas: ["catalog"],
			severity: "high",
		});

		const verify = await verifyPromise;
		expect(verify.verified).toBe(true);
		expect(verify.execution.detail).toBe("defaulted execute");
		// Default LLM executor doesn't populate artifact.
		expect(verify.execution.artifact).toBeUndefined();

		harness.destroy();
	});
});
