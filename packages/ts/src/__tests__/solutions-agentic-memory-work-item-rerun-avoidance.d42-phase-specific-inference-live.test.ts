import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { record } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	CURRENT_GRAPH_LIVE_READABLE_FILES,
	CURRENT_GRAPH_LIVE_ROUTE,
	CURRENT_GRAPH_LIVE_WRITABLE_FILE,
} from "../../evals/empirical-memory-rerun-avoidance/d8-current-live-coordinates.js";
import {
	CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
	CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
} from "../../evals/empirical-memory-rerun-avoidance/d8-current-openrouter-adapter.js";
import { D21_TASK_PROFILE } from "../../evals/empirical-memory-rerun-avoidance/d21-current-efficacy-recovery-authority.js";
import { D38_REPAIRED_LIVE_LIMITS } from "../../evals/empirical-memory-rerun-avoidance/d38-premature-final-live-coordinates.js";
import {
	admitD41EffectResult,
	createD41InferenceAuthority,
	D41_INSPECTION_MAX_OUTPUT_TOKENS,
	D41_MUTATION_MAX_OUTPUT_TOKENS,
	snapshotD41InferenceEvidence,
	takeD41AdmittedEffect,
	validateD41InferenceEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/d41-phase-specific-inference-authority.js";
import { createD41PhaseSpecificRealProviderExecutor } from "../../evals/empirical-memory-rerun-avoidance/d41-phase-specific-real-provider-composition.js";
import { createD42InjectedBaselineForTest } from "../../evals/empirical-memory-rerun-avoidance/d42-phase-specific-inference-live.js";
import {
	D42_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD42Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d42-phase-specific-inference-live-implementation-manifest.js";
import {
	runD42InjectedNoNetworkQualification,
	validateD42QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d42-phase-specific-inference-live-qualification.js";

function response(toolName: string, args: Readonly<Record<string, unknown>>) {
	return new Response(
		JSON.stringify({
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: `injected-${toolName}`,
								type: "function",
								function: { name: toolName, arguments: JSON.stringify(args) },
							},
						],
					},
				},
			],
			usage: {
				prompt_tokens: 100,
				completion_tokens: 20,
				prompt_tokens_details: { cached_tokens: 0 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function batchReadResponse() {
	return new Response(
		JSON.stringify({
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: CURRENT_GRAPH_LIVE_READABLE_FILES.map((path, index) => ({
							id: `injected-read-${index}`,
							type: "function",
							function: { name: "read_file", arguments: JSON.stringify({ path }) },
						})),
					},
				},
			],
			usage: {
				prompt_tokens: 100,
				completion_tokens: 20,
				prompt_tokens_details: { cached_tokens: 0 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

describe("graphrefly-ts:D42 phase-specific inference authority", () => {
	it("freezes the exact D41 baseline and D42 live implementation", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		expect(await measureD42Implementation(repositoryRoot)).toBe(D42_IMPLEMENTATION_MANIFEST_DIGEST);
	});

	it("lowers inspection and mutation ceilings from Graph admission and canonically accepts zero retained facts", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d42-phase-specific-"));
		const authority = createD41InferenceAuthority({
			limits: D38_REPAIRED_LIVE_LIMITS,
			routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
			taskProfile: D21_TASK_PROFILE,
		});
		const ceilings: number[] = [];
		const mutationBodies: Uint8Array[] = [];
		let retryInjected = false;
		const executor = createD41PhaseSpecificRealProviderExecutor({
			repositoryRoot,
			materializationRoot: join(root, "workspaces"),
			credential: {
				bearerToken: "injected",
				credentialBindingRef: "openrouter.local-eval-2",
				credentialBindingRevision: "2026-08-14.v1",
			},
			fetchImpl: async (_url, init) => {
				const bytes = Buffer.from(init?.body as Uint8Array);
				const body = record(JSON.parse(bytes.toString("utf8")), "D42 injected body");
				const maxTokens = body.max_tokens;
				if (typeof maxTokens !== "number") throw new TypeError("D42 max_tokens is missing");
				ceilings.push(maxTokens);
				const messages = Array.isArray(body.messages) ? body.messages : [];
				const hasReadResult = messages.some((value) => {
					const message = record(value, "D42 injected message");
					return (
						message.role === "tool" &&
						typeof message.content === "string" &&
						message.content.includes("managed-cloud-postgresql")
					);
				});
				const choice = body.tool_choice;
				const toolName =
					choice === "required"
						? hasReadResult
							? "replace_exact"
							: "read_file"
						: record(record(choice, "D42 tool choice").function, "D42 tool function").name;
				if (toolName === "read_file") {
					expect(maxTokens).toBe(D41_INSPECTION_MAX_OUTPUT_TOKENS);
					return batchReadResponse();
				}
				if (toolName !== "replace_exact") throw new TypeError("D42 injected tool drifted");
				expect(maxTokens).toBe(D41_MUTATION_MAX_OUTPUT_TOKENS);
				mutationBodies.push(new Uint8Array(bytes));
				if (!retryInjected) {
					retryInjected = true;
					return new Response(JSON.stringify({ error: { message: "bounded injected 429" } }), {
						status: 429,
						headers: { "content-type": "application/json", "retry-after": "0" },
					});
				}
				return response("replace_exact", {
					path: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
					oldText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
					newText: CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
				});
			},
			now: (() => {
				let value = 0;
				return () => ++value;
			})(),
			sleep: async () => undefined,
		});
		try {
			for (let guard = 0; guard < D38_REPAIRED_LIVE_LIMITS.maxEffectFacts; guard += 1) {
				const admitted = takeD41AdmittedEffect(authority);
				if (admitted === null) break;
				const execution = await executor.execute(admitted);
				admitD41EffectResult(
					authority,
					execution.admitted,
					execution.result,
					execution.wireReceipt,
				);
			}
			const evidence = validateD41InferenceEvidence(snapshotD41InferenceEvidence(authority));
			expect(evidence.retainedSpanEvidence.facts).toEqual([]);
			expect(
				evidence.retainedSpanEvidence.phaseEvidence.workflowEvidence.providerEvidence
					.workflowEvidence.runStatus,
			).toBe("complete");
			expect(evidence.facts.length).toBeGreaterThanOrEqual(12);
			expect(evidence.facts.filter((fact) => fact.phase === "inspection")).toHaveLength(6);
			expect(
				evidence.facts.every(
					(fact) => fact.maxOutputTokens === (fact.phase === "inspection" ? 65_536 : 8_192),
				),
			).toBe(true);
			expect(ceilings).toContain(65_536);
			expect(ceilings).toContain(8_192);
			expect(mutationBodies.length).toBeGreaterThan(6);
			expect(Buffer.from(mutationBodies[0]!).equals(Buffer.from(mutationBodies[1]!))).toBe(true);
		} finally {
			await executor.dispose();
			await rm(root, { recursive: true, force: true });
		}
	}, 120_000);

	it("derives the six-arm qualification from canonical Graph facts and rejects projection substitution", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d42-qualification-test-"));
		try {
			const bundle = await runD42InjectedNoNetworkQualification({
				baseline: createD42InjectedBaselineForTest(),
				baselineBasis: "injected-test",
				repositoryRoot,
				materializationRoot: join(root, "workspaces"),
			});
			const validated = validateD42QualificationBundle(bundle);
			expect(validated.qualification.exactSixArmsCompleted).toBe(true);
			expect(validated.qualification.zeroRetainedSpanFacts).toBe(true);
			expect(validated.qualification.inspectionFactCount).toBe(6);
			expect(validated.qualification.retryWaitCount).toBe(1);
			expect(validated.qualification.providerNetworkCalls).toBe(0);
			expect(() =>
				validateD42QualificationBundle({
					...bundle,
					qualification: {
						...bundle.qualification,
						mutationFactCount: bundle.qualification.mutationFactCount + 1,
					},
				}),
			).toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 180_000);
});
