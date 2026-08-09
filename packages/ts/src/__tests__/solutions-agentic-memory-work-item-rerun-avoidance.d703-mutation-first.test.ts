import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { D693_ASSISTED_PROGRESS_POLICY } from "../../evals/empirical-memory-rerun-avoidance/d693-assisted-progress-qualification.js";
import { D695_NO_PROGRESS_CONTINUATION_POLICY } from "../../evals/empirical-memory-rerun-avoidance/d695-no-progress-continuation-qualification.js";
import { commitD696PrivateStagingDirectory } from "../../evals/empirical-memory-rerun-avoidance/d696-continuation-assisted-live.js";
import { D702_STALE_RESULT_RECOVERY_POLICY } from "../../evals/empirical-memory-rerun-avoidance/d702-mutation-first-recovery-qualification.js";
import {
	assertD703TrackedWorkspaceRootsClean,
	createD703PreflightCapability,
	D703_CLAIM_BOUNDARY,
	D703_D699_DISPATCH_CLAIM_ARTIFACT_DIGEST,
	D703_D699_GENERATION_ARTIFACT_DIGEST,
	D703_D699_OBSERVATION_ARTIFACT_DIGEST,
	D703_D699_SCORECARD_ARTIFACT_DIGEST,
	D703_D702_BINDING_SOURCE_DIGEST,
	D703_D702_GENERATION_ARTIFACT_DIGEST,
	D703_D702_HOST_SOURCE_DIGEST,
	D703_D702_QUALIFICATION_ARTIFACT_DIGEST,
	D703_D702_QUALIFICATION_SOURCE_DIGEST,
	D703_D702_RUNNER_SOURCE_DIGEST,
	D703_NODE_RUNTIME_VERSION,
	deriveD703MutationFirstRecoveryLifecycle,
	validateD703ContinuationInvocationFact,
	validateD703DryRunArtifactBytes,
	validateD703ImplementationMeasurements,
	validateD703MutationFirstInvocationFact,
	validateD703NoProgressReceipt,
} from "../../evals/empirical-memory-rerun-avoidance/d703-mutation-first-recovery-live.js";
import type { EmpiricalTrialBlockObservationV3 } from "../../evals/empirical-memory-rerun-avoidance/empirical-smoke-evidence.js";

describe("D703 mutation-first pre-live measurement", () => {
	it("freezes D702 as the sole policy delta without efficacy attribution", () => {
		expect(D703_CLAIM_BOUNDARY).toContain("no-efficacy-claim");
		expect(D702_STALE_RESULT_RECOVERY_POLICY).toMatchObject({
			policyRef: "stale-result-recovery.d702.mutation-first",
			policyRevision: "decision.D702.2026-08-09.v1",
			maxRecoveryContinuations: 1,
		});
		expect(D702_STALE_RESULT_RECOVERY_POLICY.objectiveProgressPolicyDigest).toBe(
			empiricalStrictJsonDigest(D693_ASSISTED_PROGRESS_POLICY),
		);
		expect(D702_STALE_RESULT_RECOVERY_POLICY.noProgressContinuationPolicyDigest).toBe(
			empiricalStrictJsonDigest(D695_NO_PROGRESS_CONTINUATION_POLICY),
		);
	});

	it("freezes exact D699 and durable D702 artifact hashes", () => {
		for (const value of [
			D703_D699_OBSERVATION_ARTIFACT_DIGEST,
			D703_D699_SCORECARD_ARTIFACT_DIGEST,
			D703_D699_GENERATION_ARTIFACT_DIGEST,
			D703_D699_DISPATCH_CLAIM_ARTIFACT_DIGEST,
			D703_D702_QUALIFICATION_ARTIFACT_DIGEST,
			D703_D702_GENERATION_ARTIFACT_DIGEST,
		]) {
			expect(value).toMatch(/^sha256:[0-9a-f]{64}$/);
		}
	});

	it("rejects measured source or runtime substitution", () => {
		const exact = {
			"d702-mutation-first-recovery-qualification.ts": D703_D702_QUALIFICATION_SOURCE_DIGEST,
			"closed-task-profile-host.ts": D703_D702_HOST_SOURCE_DIGEST,
			"openrouter-responses-model-turn.ts": D703_D702_BINDING_SOURCE_DIGEST,
			"openrouter-first-task-smoke.ts": D703_D702_RUNNER_SOURCE_DIGEST,
			nodeRuntimeVersion: D703_NODE_RUNTIME_VERSION,
		};
		expect(() => validateD703ImplementationMeasurements(exact)).not.toThrow();
		expect(() =>
			validateD703ImplementationMeasurements({ ...exact, nodeRuntimeVersion: "v26.4.0" }),
		).toThrow(/nodeVersion/);
		expect(() =>
			validateD703ImplementationMeasurements({
				...exact,
				"openrouter-first-task-smoke.ts": `sha256:${"0".repeat(64)}`,
			}),
		).toThrow(/openrouter-first-task-smoke/);
	});

	it("strictly bounds every nested mechanism fact", () => {
		const common = {
			trialStage: "cold",
			stepIndex: 3,
			attemptOrdinal: 1,
			requestDigest: `sha256:${"1".repeat(64)}`,
			continuationDigest: `sha256:${"2".repeat(64)}`,
			providerRequestCount: 1,
		};
		expect(() =>
			validateD703ContinuationInvocationFact({
				...common,
				requiredDisposition: "tool-intents",
				extra: "must-not-persist",
			}),
		).toThrow(/keys/);
		expect(() =>
			validateD703MutationFirstInvocationFact({
				...common,
				attemptOrdinal: 4,
				staleResultReceiptDigest: `sha256:${"3".repeat(64)}`,
				requiredFirstToolRef: D702_STALE_RESULT_RECOVERY_POLICY.requiredFirstToolRef,
			}),
		).toThrow(/safe integer/);
		expect(() =>
			validateD703NoProgressReceipt({
				kind: "stale-result-intent-batch",
				trialStage: "cold",
				stepIndex: 2,
				workspaceStateDigest: `sha256:${"4".repeat(64)}`,
				intentBatchDigest: "raw-private-material",
				disposition: "rejected-before-tool-execution",
			}),
		).toThrow(/sha256/);
	});

	it("derives recovery only from the exact stale receipt to mutation and validation lifecycle", () => {
		const receipt = validateD703NoProgressReceipt({
			kind: "stale-result-intent-batch",
			trialStage: "cold",
			stepIndex: 2,
			workspaceStateDigest: `sha256:${"4".repeat(64)}`,
			intentBatchDigest: `sha256:${"5".repeat(64)}`,
			disposition: "rejected-before-tool-execution",
		});
		const requestDigest = `sha256:${"6".repeat(64)}`;
		const mutation = validateD703MutationFirstInvocationFact({
			trialStage: "cold",
			stepIndex: 3,
			attemptOrdinal: 1,
			requestDigest,
			continuationDigest: `sha256:${"7".repeat(64)}`,
			staleResultReceiptDigest: empiricalStrictJsonDigest(receipt),
			requiredFirstToolRef: D702_STALE_RESULT_RECOVERY_POLICY.requiredFirstToolRef,
			providerRequestCount: 1,
		});
		const mutationRetry = validateD703MutationFirstInvocationFact({
			...mutation,
			attemptOrdinal: 2,
		});
		const continuation = validateD703ContinuationInvocationFact({
			trialStage: "cold",
			stepIndex: 2,
			attemptOrdinal: 1,
			requestDigest: `sha256:${"8".repeat(64)}`,
			continuationDigest: `sha256:${"9".repeat(64)}`,
			requiredDisposition: "tool-intents",
			providerRequestCount: 1,
		});
		const underlying = {
			cold: {
				classification: "complete",
				verifierStatus: "passed",
				steps: 6,
				issueCodes: [],
				attemptTrace: [
					{
						stepIndex: 1,
						attemptOrdinal: 1,
						requestDigest: `sha256:${"a".repeat(64)}`,
						requests: 1,
						issueCodes: ["structured-output-objective-progress-required"],
					},
					{
						stepIndex: 2,
						attemptOrdinal: 1,
						requestDigest: continuation.requestDigest,
						requests: 1,
						issueCodes: [],
					},
					{
						stepIndex: 3,
						attemptOrdinal: 1,
						requestDigest,
						requests: 1,
						issueCodes: ["openrouter-http-status:429"],
					},
					{ stepIndex: 3, attemptOrdinal: 2, requestDigest, requests: 1, issueCodes: [] },
				],
				actionTrace: [
					{
						stepIndex: 3,
						actionIndex: 0,
						requestDigest,
						toolRef: D702_STALE_RESULT_RECOVERY_POLICY.requiredFirstToolRef,
					},
					{
						stepIndex: 4,
						actionIndex: 1,
						requestDigest: `sha256:${"b".repeat(64)}`,
						toolRef: "graphrefly.private-solution-eval.workspace.diff.v1",
					},
				],
			},
			warmBranches: [],
		} as unknown as EmpiricalTrialBlockObservationV3;
		const focused = [
			{
				trialStage: "cold" as const,
				stepIndex: 5,
				actionIndex: 2,
				commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
				validationStatus: "passed" as const,
				exitCode: 0,
				stdoutByteLength: 0,
				stderrByteLength: 0,
				stdoutDigest: `sha256:${"c".repeat(64)}`,
				stderrDigest: `sha256:${"d".repeat(64)}`,
				resultDigest: `sha256:${"e".repeat(64)}`,
			},
		];
		expect(
			deriveD703MutationFirstRecoveryLifecycle(
				underlying,
				focused,
				[continuation],
				[mutation, mutationRetry],
				[receipt],
			),
		).toBe(true);
		expect(() =>
			deriveD703MutationFirstRecoveryLifecycle(
				underlying,
				focused,
				[continuation],
				[
					mutation,
					{
						...mutationRetry,
						continuationDigest: `sha256:${"0".repeat(64)}`,
					},
				],
				[receipt],
			),
		).toThrow(/substituted/);
		const continuationRetry = validateD703ContinuationInvocationFact({
			...continuation,
			attemptOrdinal: 2,
		});
		const retriedContinuationUnderlying = structuredClone(
			underlying,
		) as EmpiricalTrialBlockObservationV3;
		(
			retriedContinuationUnderlying.cold.attemptTrace as unknown as Record<string, unknown>[]
		).splice(2, 0, {
			stepIndex: 2,
			attemptOrdinal: 2,
			requestDigest: continuation.requestDigest,
			requests: 1,
			issueCodes: [],
		});
		expect(
			deriveD703MutationFirstRecoveryLifecycle(
				retriedContinuationUnderlying,
				focused,
				[continuation, continuationRetry],
				[mutation, mutationRetry],
				[receipt],
			),
		).toBe(true);
		expect(() =>
			deriveD703MutationFirstRecoveryLifecycle(
				retriedContinuationUnderlying,
				focused,
				[
					continuation,
					{
						...continuationRetry,
						continuationDigest: `sha256:${"0".repeat(64)}`,
					},
				],
				[mutation, mutationRetry],
				[receipt],
			),
		).toThrow(/continuation retry substituted/);
		const substituted = structuredClone(underlying) as EmpiricalTrialBlockObservationV3;
		(substituted.cold.actionTrace as unknown as { requestDigest: string }[])[0]!.requestDigest =
			`sha256:${"f".repeat(64)}`;
		expect(
			deriveD703MutationFirstRecoveryLifecycle(
				substituted,
				focused,
				[continuation],
				[mutation, mutationRetry],
				[receipt],
			),
		).toBe(false);
		const repeatedReceipt = validateD703NoProgressReceipt({
			kind: "stale-result-intent-batch",
			trialStage: "cold",
			stepIndex: 3,
			workspaceStateDigest: `sha256:${"4".repeat(64)}`,
			intentBatchDigest: `sha256:${"0".repeat(64)}`,
			disposition: "rejected-before-tool-execution",
		});
		const repeated = structuredClone(underlying) as EmpiricalTrialBlockObservationV3;
		Object.assign(repeated.cold, {
			classification: "non-evaluable",
			verifierStatus: "not-run",
			steps: 4,
			issueCodes: ["no-progress-stale-result-intent-batch"],
			actionTrace: [],
		});
		expect(
			deriveD703MutationFirstRecoveryLifecycle(
				repeated,
				[],
				[continuation],
				[mutation, mutationRetry],
				[receipt, repeatedReceipt],
			),
		).toBe(false);
		const secondRecoveredReceipt = validateD703NoProgressReceipt({
			kind: "stale-result-intent-batch",
			trialStage: "cold",
			stepIndex: 5,
			workspaceStateDigest: `sha256:${"4".repeat(64)}`,
			intentBatchDigest: `sha256:${"1".repeat(64)}`,
			disposition: "rejected-before-tool-execution",
		});
		const doubleRecovered = structuredClone(underlying) as EmpiricalTrialBlockObservationV3;
		Object.assign(doubleRecovered.cold, { steps: 8 });
		(doubleRecovered.cold.attemptTrace as unknown as Record<string, unknown>[]).push({
			stepIndex: 6,
			attemptOrdinal: 1,
			requestDigest: `sha256:${"2".repeat(64)}`,
			requests: 1,
			issueCodes: [],
		});
		(doubleRecovered.cold.actionTrace as unknown as Record<string, unknown>[]).push({
			stepIndex: 6,
			actionIndex: 2,
			requestDigest: `sha256:${"2".repeat(64)}`,
			toolRef: D702_STALE_RESULT_RECOVERY_POLICY.requiredFirstToolRef,
		});
		const secondMutation = validateD703MutationFirstInvocationFact({
			trialStage: "cold",
			stepIndex: 6,
			attemptOrdinal: 1,
			requestDigest: `sha256:${"2".repeat(64)}`,
			continuationDigest: `sha256:${"3".repeat(64)}`,
			staleResultReceiptDigest: empiricalStrictJsonDigest(secondRecoveredReceipt),
			requiredFirstToolRef: D702_STALE_RESULT_RECOVERY_POLICY.requiredFirstToolRef,
			providerRequestCount: 1,
		});
		expect(() =>
			deriveD703MutationFirstRecoveryLifecycle(
				doubleRecovered,
				focused,
				[continuation],
				[mutation, mutationRetry, secondMutation],
				[receipt, secondRecoveredReceipt],
			),
		).toThrow(/exceeded one recovered/);
	});

	it("requires every tracked materialization root to be cleaned", async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), "graphrefly-d703-cleanup-test-"));
		try {
			await expect(assertD703TrackedWorkspaceRootsClean([workspaceRoot])).rejects.toThrow(
				/not cleaned/,
			);
		} finally {
			await rm(workspaceRoot, { recursive: true, force: true });
		}
		await expect(assertD703TrackedWorkspaceRootsClean([workspaceRoot])).resolves.toBeUndefined();
	});

	it("inherits fail-closed atomic rename cleanup for D703 persistence", async () => {
		const calls: string[] = [];
		await expect(
			commitD696PrivateStagingDirectory(
				{ stagingPath: "/private/staging", finalPath: "/private/final", privateRoot: "/private" },
				{
					async rename() {
						calls.push("rename");
					},
					async rm(path) {
						calls.push(`rm:${path}`);
					},
					async syncDirectory() {
						calls.push("sync");
						if (calls.filter((entry) => entry === "sync").length === 1) {
							throw new Error("injected-parent-fsync-failure");
						}
					},
				},
			),
		).rejects.toThrow(/injected-parent-fsync-failure/);
		expect(calls).toEqual(["rename", "sync", "rm:/private/final", "sync"]);
	});

	it("fails before any execution when exact offline artifacts are absent", async () => {
		expect(() =>
			validateD703DryRunArtifactBytes({
				observationBytes: new Uint8Array([1]),
				scorecardBytes: new Uint8Array([1]),
				generationBytes: new Uint8Array([1]),
			}),
		).toThrow(/dry-run/);
		await expect(
			createD703PreflightCapability({
				d690OfflineEvidence: {},
				d693QualificationBytes: new Uint8Array([1]),
				d693GenerationBytes: new Uint8Array([1]),
				d699Artifacts: {
					observationBytes: new Uint8Array([1]),
					scorecardBytes: new Uint8Array([1]),
					generationBytes: new Uint8Array([1]),
				},
				d702Artifacts: {
					qualificationBytes: new Uint8Array([1]),
					generationBytes: new Uint8Array([1]),
				},
				executionClass: "simulated-contract",
			}),
		).rejects.toThrow();
	});

	it("rejects live execution class at the pre-live boundary", async () => {
		await expect(
			createD703PreflightCapability({
				d690OfflineEvidence: {},
				d693QualificationBytes: new Uint8Array([1]),
				d693GenerationBytes: new Uint8Array([1]),
				d699Artifacts: {},
				d702Artifacts: {},
				executionClass: "live-provider",
			}),
		).rejects.toThrow(/executionClass/);
	});
});
