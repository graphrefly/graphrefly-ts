import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import {
	chmod,
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/graph-native-rerun-avoidance/canonical.js";
import { createCurrentExactModelHarnessProfileInput } from "../../evals/graph-native-rerun-avoidance/current-exact-profile.js";
import {
	assertRootEvalObservationRuntimeShape,
	assertRootEvalObservationSequence,
	createRootEvalTopology,
	type EvalAdmittedEffect,
	type EvalEffectOutcome,
	type EvalProviderOutcome,
	emptyEvalProviderOutcomeReasonCounts,
	ROOT_EVAL_CALLER_SAFETY_LEASE_MS,
	ROOT_EVAL_GRAPH_DRAIN_RESERVE_MS,
	ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS,
	ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
	type RootEvalRunResult,
	runRootEval,
} from "../../evals/graph-native-rerun-avoidance/eval-topology.js";
import {
	checkRootEvalGeneratedArtifactSnapshot,
	ROOT_EVAL_ARTIFACT_DIRECTORY,
} from "../../evals/graph-native-rerun-avoidance/generate-root-eval-artifacts.js";
import {
	advanceRootEvalD145CharterLedger,
	ROOT_EVAL_D145_EMPTY_CHARTER_LEDGER,
	readRootEvalD145CharterLedger,
	writeRootEvalD145CharterLedger,
} from "../../evals/graph-native-rerun-avoidance/root-eval-charter-ledger.js";
import {
	awaitRootEvalCallerSettlement,
	createRootEvalLiveExecutor,
	createRootEvalLiveTransportQualificationExecutor,
	createRootEvalNoNetworkQualificationExecutor,
	parseRootEvalLiveProviderResponse,
	qualifyRootEvalTransferTaskFamily,
	ROOT_EVAL_BILLING_SETTLEMENT_LEASE_MS,
	ROOT_EVAL_CALLER_SETTLEMENT_DEADLINE_MS,
	ROOT_EVAL_LIVE_BUGGY_REPLACEMENT,
	ROOT_EVAL_LIVE_CORRECT_REPLACEMENT,
	ROOT_EVAL_LIVE_DECISION_REF,
	ROOT_EVAL_LIVE_WRITABLE_PATH,
	ROOT_EVAL_MAX_BILLING_OBSERVATIONS,
	ROOT_EVAL_MAX_POST_CUTOFF_CAUSAL_TAIL_MS,
	ROOT_EVAL_PROVIDER_SETTLEMENT_LEASE_MS,
	ROOT_EVAL_RETRY_SETTLEMENT_LEASE_MS,
	ROOT_EVAL_TOOL_SETTLEMENT_LEASE_MS,
	RootEvalCallerSettlementDeadlineExpired,
	readRootEvalBoundedResponseBytes,
} from "../../evals/graph-native-rerun-avoidance/root-eval-live.js";
import {
	acquireRootEvalLiveClaim,
	acquireRootEvalLiveClaimForNoNetworkQualification,
	admitRootEvalLivePrecredentialGateReceipt,
	admitRootEvalLiveZeroByok,
	buildRootEvalLiveZeroByokArtifactBytes,
	constructRootEvalLiveEvidence,
	evaluateRootEvalLiveAdmission,
	parseRootEvalLiveCredential,
	persistRootEvalLiveEvidence,
	persistRootEvalLivePreclaimFailure,
	persistRootEvalLivePrecredentialGateReceipt,
	qualifyRootEvalLivePrivateInputPreflight,
	qualifyRootEvalLivePrivateInputs,
	ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
	ROOT_EVAL_CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
	ROOT_EVAL_CURRENT_QUALIFICATION_DIGEST,
	ROOT_EVAL_CURRENT_TASK_BINDING_DIGEST,
	ROOT_EVAL_HISTORICAL_D85_IMPLEMENTATION_MANIFEST_DIGEST,
	ROOT_EVAL_HISTORICAL_D85_QUALIFICATION_ARTIFACT_DIGEST,
	ROOT_EVAL_HISTORICAL_D85_QUALIFICATION_DIGEST,
	ROOT_EVAL_HISTORICAL_D85_TASK_BINDING_DIGEST,
	ROOT_EVAL_LIVE_AUTHORITY_VIOLATION_CODES,
	ROOT_EVAL_LIVE_BUDGET_PARTITION,
	ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE,
	ROOT_EVAL_LIVE_CLAIM_REF,
	ROOT_EVAL_LIVE_CLAIM_SCHEMA,
	ROOT_EVAL_LIVE_EVIDENCE_SCHEMA,
	ROOT_EVAL_LIVE_GENERATION_REF,
	ROOT_EVAL_LIVE_HELD_OUT_SEAL_DIGEST,
	ROOT_EVAL_LIVE_PRECLAIM_FAILURE_SCHEMA,
	ROOT_EVAL_LIVE_PRECREDENTIAL_GATE_RECEIPT_SCHEMA,
	ROOT_EVAL_LIVE_PRICING_SOURCE,
	ROOT_EVAL_LIVE_REPLICATE_COUNT,
	ROOT_EVAL_LIVE_SUCCESS_VIOLATION_CODES,
	ROOT_EVAL_LIVE_TASK_SET_REF,
	ROOT_EVAL_LIVE_ZDR_SOURCE,
	ROOT_EVAL_LIVE_ZERO_BYOK_SCHEMA,
	type RootEvalLiveClaim,
	type RootEvalLiveEvidenceInput,
	readRootEvalLiveCurrentKey,
	readRootEvalLivePricing,
	recoverRootEvalLiveClaimAuthority,
} from "../../evals/graph-native-rerun-avoidance/root-eval-live-authority.js";
import {
	createRootEvalTaskManifest,
	ROOT_EVAL_CONFIRMATORY_TASK_SET_REF,
	ROOT_EVAL_DEVELOPMENT_TASK_SET_REFS,
	ROOT_EVAL_DEVELOPMENT_TASKS,
	ROOT_EVAL_IRRELEVANT_SOURCE_REPLICATES,
	readRootEvalTaskManifest,
	rootEvalTask,
	rootEvalTaskBindings,
} from "../../evals/graph-native-rerun-avoidance/root-eval-task.js";

const ROOT_EVAL_DEVELOPMENT_TASK = ROOT_EVAL_DEVELOPMENT_TASKS[0]!;

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const pricing = Object.freeze({
	inputMicrousdPerMillionTokens: 220_000 as const,
	outputMicrousdPerMillionTokens: 660_000 as const,
	cacheReadMicrousdPerMillionTokens: 7_000 as const,
});
const boundedCurrentness = Object.freeze({
	implementationCommit: "a".repeat(40),
	repositoryStateDigest: empiricalStrictJsonDigest("d138-repository-state"),
	artifactSetDigest: empiricalStrictJsonDigest("d138-artifact-set"),
});
const testPartitionLedgerDigest = empiricalStrictJsonDigest({ kind: "d145-test-ledger" });
const testTaskManifestDigest = empiricalStrictJsonDigest({ kind: "d145-test-task-manifest" });

const arms = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);

const memoryProvenance = Object.freeze({
	cold: "none",
	"relevant-applied": "relevant-applied",
	"proposal-only": "proposal-only",
	"admission-rejected": "admission-rejected",
	"irrelevant-applied": "irrelevant-applied",
	"wrong-scope-applied": "wrong-scope-applied",
} as const);

const providerOutcomeReasonCounts = Object.freeze({
	...emptyEvalProviderOutcomeReasonCounts(),
	"tool-proposed": ROOT_EVAL_LIVE_REPLICATE_COUNT * arms.length,
});

function admissionIds(count = ROOT_EVAL_LIVE_REPLICATE_COUNT * arms.length): readonly string[] {
	const result: string[] = [];
	for (let replicate = 1; replicate <= ROOT_EVAL_LIVE_REPLICATE_COUNT; replicate += 1)
		for (const arm of arms) {
			const workItemId = `${ROOT_EVAL_LIVE_GENERATION_REF}/replicate-${replicate}/${arm}`;
			result.push(
				`effect-run:work-item:${workItemId}:effect-plan:1:${workItemId}/plan:provider-and-exact-tool/attempt-1/admission`,
			);
			if (result.length === count) return Object.freeze(result);
		}
	return Object.freeze(result);
}

function sourceAdmissionId(replicate: number, attempt: 1 | 2 = 1): string {
	const workItemId = `${ROOT_EVAL_LIVE_TASK_SET_REF}/instance-${replicate}/source-work-item`;
	return `effect-run:work-item:${workItemId}:effect-plan:1:${workItemId}/plan:source-provider-and-exact-tool/attempt-${attempt}/admission`;
}

function providerBytes(): Uint8Array {
	return new TextEncoder().encode(
		JSON.stringify({
			id: "generation:test",
			model: "deepseek/deepseek-v4-flash-20260731",
			provider: "Fireworks",
			choices: [
				{
					index: 0,
					finish_reason: "stop",
					native_finish_reason: "stop",
					logprobs: null,
					message: {
						role: "assistant",
						content: JSON.stringify({
							path: ROOT_EVAL_LIVE_WRITABLE_PATH,
							oldText: ROOT_EVAL_LIVE_BUGGY_REPLACEMENT,
							newText: ROOT_EVAL_LIVE_CORRECT_REPLACEMENT,
						}),
					},
				},
			],
			usage: {
				prompt_tokens: 1_000,
				completion_tokens: 100,
				total_tokens: 1_100,
				cost: 0.0002647,
				prompt_tokens_details: { cached_tokens: 100 },
			},
		}),
	);
}

function providerBytesForTask(task: (typeof ROOT_EVAL_DEVELOPMENT_TASKS)[number]): Uint8Array {
	const decoded = JSON.parse(new TextDecoder().decode(providerBytes())) as {
		choices: Array<{ message: { content: string } }>;
	};
	decoded.choices[0]!.message.content = JSON.stringify({
		path: task.writablePath,
		oldText: task.fixtureBuggyText,
		newText: task.fixtureCorrectText,
	});
	return new TextEncoder().encode(JSON.stringify(decoded));
}

function providerBytesForSourceTask(
	task: (typeof ROOT_EVAL_DEVELOPMENT_TASKS)[number],
): Uint8Array {
	const decoded = JSON.parse(new TextDecoder().decode(providerBytes())) as {
		choices: Array<{ message: { content: string } }>;
	};
	decoded.choices[0]!.message.content = JSON.stringify({
		path: task.sourceWritablePath,
		oldText: task.sourceFixtureBuggyText,
		newText: task.sourceFixtureCorrectText,
	});
	return new TextEncoder().encode(JSON.stringify(decoded));
}

function providerBytesForEffect(
	effect: Pick<EvalAdmittedEffect, "replicate" | "workItemRole">,
): Uint8Array {
	const task = ROOT_EVAL_DEVELOPMENT_TASKS[effect.replicate - 1]!;
	return effect.workItemRole === "source"
		? providerBytesForSourceTask(task)
		: providerBytesForTask(task);
}

function truncatedProviderBytes(): Uint8Array {
	const decoded = JSON.parse(new TextDecoder().decode(providerBytes())) as {
		choices: Array<Record<string, unknown>>;
	};
	decoded.choices[0] = Object.freeze({
		...decoded.choices[0],
		finish_reason: "length",
		native_finish_reason: "length",
	});
	return new TextEncoder().encode(JSON.stringify(decoded));
}

function precredentialGateReceiptBytes(completedAtMs: number): Uint8Array {
	const material = {
		schemaVersion: ROOT_EVAL_LIVE_PRECREDENTIAL_GATE_RECEIPT_SCHEMA,
		decisionRef: ROOT_EVAL_LIVE_DECISION_REF,
		generationRef: ROOT_EVAL_LIVE_GENERATION_REF,
		implementationManifestDigest: ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: ROOT_EVAL_CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
		qualificationDigest: ROOT_EVAL_CURRENT_QUALIFICATION_DIGEST,
		implementationCommit: boundedCurrentness.implementationCommit,
		repositoryStateDigest: boundedCurrentness.repositoryStateDigest,
		artifactSetDigest: boundedCurrentness.artifactSetDigest,
		completedAtMs,
	};
	return new TextEncoder().encode(
		JSON.stringify({ ...material, receiptDigest: empiricalStrictJsonDigest(material) }),
	);
}

function precredentialGateReceipt(completedAtMs: number) {
	return admitRootEvalLivePrecredentialGateReceipt({
		bytes: precredentialGateReceiptBytes(completedAtMs),
		nowMs: completedAtMs,
	});
}

function zeroByokArtifactBytes(
	nowMs: number,
	precredentialGateReceiptDigest: string,
	duplicateKey = false,
): Uint8Array {
	const encoded = new TextDecoder().decode(
		buildRootEvalLiveZeroByokArtifactBytes({
			workspaceName: "GraphReFly",
			workspaceSlug: "graph-re-fly",
			keyName: "Local Eval 2",
			byokCredentialCount: 0,
			providerObservation: "Fireworks Not configured",
			source: "openrouter-browser-settings",
			observedAtMs: nowMs,
			precredentialGateReceiptDigest,
			keyVisiblePrefix: "sk-or-v1-a44",
			keyVisibleSuffix: "e06",
			guardrailId: "2c97d3e1-b4cc-4246-95d7-33eb27fb65ab",
			guardrailName: "B112 DeepSeek V4 Flash",
			guardrailDescription:
				"Dedicated Local Eval 2 guardrail for the B112 DeepSeek V4 Flash 0731 Fireworks-only structured-proposal route.",
			keyAssigned: true,
			restrictionMode: "only-allow",
			paidEndpointTrainingAllowed: false,
			providerEligible: true,
			requestDataCollection: "deny",
			requestZdrRequired: true,
			allowedModels: ["deepseek/deepseek-v4-flash-0731"],
			allowedProviders: ["Fireworks"],
		}),
	);
	return new TextEncoder().encode(
		duplicateKey
			? encoded.replace('"keyAssigned":true', '"keyAssigned":false,"keyAssigned":true')
			: encoded,
	);
}

function liveEvidenceInput(
	replicateCount = ROOT_EVAL_LIVE_REPLICATE_COUNT,
): RootEvalLiveEvidenceInput {
	const workItemCount = replicateCount * arms.length;
	const fixtureProviderOutcomeReasonCounts = Object.freeze({
		...emptyEvalProviderOutcomeReasonCounts(),
		"tool-proposed": workItemCount,
	});
	const pricingMaterial = {
		sourceUrl: ROOT_EVAL_LIVE_PRICING_SOURCE,
		modelRef: "deepseek/deepseek-v4-flash-0731" as const,
		endpointModelRef: "deepseek/deepseek-v4-flash-20260731" as const,
		providerName: "Fireworks" as const,
		providerRef: "fireworks" as const,
		quantization: "unknown" as const,
		inputMicrousdPerMillionTokens: 220_000 as const,
		outputMicrousdPerMillionTokens: 660_000 as const,
		cacheReadMicrousdPerMillionTokens: 7_000 as const,
		zeroDataRetention: true as const,
		promptTraining: false as const,
		zdrSourceUrl: ROOT_EVAL_LIVE_ZDR_SOURCE,
		zdrResponseDigest: empiricalStrictJsonDigest("zdr"),
		observedAtMs: 1,
		officialResponseDigest: empiricalStrictJsonDigest("pricing"),
	};
	const pricingObservation = {
		...pricingMaterial,
		observationDigest: empiricalStrictJsonDigest(pricingMaterial),
	};
	const zeroMaterial = {
		workspaceSlug: "graph-re-fly" as const,
		keyName: "Local Eval 2" as const,
		byokCredentialCount: 0 as const,
		providerObservation: "Fireworks Not configured" as const,
		observedAtMs: 1,
		precredentialGateCompletedAtMs: 0,
		precredentialGateReceiptDigest: empiricalStrictJsonDigest("precredential-gates"),
		sourceArtifactDigest: empiricalStrictJsonDigest("zero-source"),
	};
	const zeroByok = {
		...zeroMaterial,
		observationDigest: empiricalStrictJsonDigest(zeroMaterial),
	};
	const currentKeyBeforeMaterial = {
		limitMicrousd: 32_000_000 as const,
		remainingMicrousd: 7_000_000,
		usageMicrousd: 25_000_000,
		limitReset: "none" as const,
		isManagementKey: false as const,
	};
	const currentKeyBefore = {
		...currentKeyBeforeMaterial,
		admissionDigest: empiricalStrictJsonDigest(currentKeyBeforeMaterial),
	};
	const currentKeyAfterMaterial = {
		...currentKeyBeforeMaterial,
		remainingMicrousd: 6_999_900,
		usageMicrousd: 25_000_100,
	};
	const currentKeyAfter = {
		...currentKeyAfterMaterial,
		admissionDigest: empiricalStrictJsonDigest(currentKeyAfterMaterial),
	};
	const claimMaterial = {
		schemaVersion: ROOT_EVAL_LIVE_CLAIM_SCHEMA,
		executionMode: "live" as const,
		claimRef: ROOT_EVAL_LIVE_CLAIM_REF,
		decisionRef: ROOT_EVAL_LIVE_DECISION_REF,
		generationRef: ROOT_EVAL_LIVE_GENERATION_REF,
		campaignPurpose: ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE,
		taskSetRef: ROOT_EVAL_LIVE_TASK_SET_REF,
		taskManifestDigest: testTaskManifestDigest,
		replicateCount: ROOT_EVAL_LIVE_REPLICATE_COUNT,
		heldOutSealDigest: ROOT_EVAL_LIVE_HELD_OUT_SEAL_DIGEST,
		budgetPartition: ROOT_EVAL_LIVE_BUDGET_PARTITION,
		partitionHardCapMicrousd: 6_000_000 as const,
		partitionSpentBeforeMicrousd: 0,
		partitionLedgerDigest: testPartitionLedgerDigest,
		developmentQualificationStreakBefore: 0,
		implementationCoordinate: `worktree:${"a".repeat(40)}:${ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST}`,
		implementationManifestDigest: ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: ROOT_EVAL_CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
		qualificationDigest: ROOT_EVAL_CURRENT_QUALIFICATION_DIGEST,
		taskBindingDigest: ROOT_EVAL_CURRENT_TASK_BINDING_DIGEST,
		pricingObservationDigest: pricingObservation.observationDigest,
		zeroByokObservationDigest: zeroByok.observationDigest,
		credentialBindingDigest: empiricalStrictJsonDigest({
			bindingRef: "openrouter.local-eval-2",
			bindingRevision: "2026-08-26.d145.v1",
		}),
		credentialFingerprintDigest: empiricalStrictJsonDigest("test-credential-fingerprint"),
		currentKeyBeforeDigest: currentKeyBefore.admissionDigest,
		recoveryEnvelope: {
			pricing: pricingObservation,
			zeroByok,
			currentKeyBefore,
		},
		campaignHardCapMicrousd: 6_000_000 as const,
		localEvalNoResetLimitMicrousd: 32_000_000 as const,
	};
	const claim = { ...claimMaterial, claimDigest: empiricalStrictJsonDigest(claimMaterial) };
	const verificationDiagnostics = {
		kind: "eval-verification-diagnostics" as const,
		armOrder: arms,
		stageCounts: Object.fromEntries(
			arms.map((arm) => [
				arm,
				{
					completedWorkItems: replicateCount,
					exactToolAdmitted: replicateCount,
					scopedChange: arm === "relevant-applied" ? replicateCount : 0,
					publicSemanticPassed: arm === "relevant-applied" ? replicateCount : 0,
					hiddenVerifierPassed: arm === "relevant-applied" ? replicateCount : 0,
					cleanupCompleted: replicateCount,
					passed: arm === "relevant-applied" ? replicateCount : 0,
				},
			]),
		),
		terminalReasonCounts: Object.fromEntries(
			arms.map((arm) => [
				arm,
				{
					"cleanup-incomplete": 0,
					"provider-failed": 0,
					"exact-tool-failed": 0,
					"no-change": arm === "relevant-applied" ? 0 : replicateCount,
					"wrong-scope": 0,
					"public-semantic-failed": 0,
					"hidden-verifier-failed": 0,
					passed: arm === "relevant-applied" ? replicateCount : 0,
				},
			]),
		),
		completedWorkItems: workItemCount,
	};
	const observation = {
		path: "eval/observation",
		msg: [
			"DATA",
			{
				kind: "eval-observation",
				topologyRevision: "graphrefly-ts.root-eval-topology.v13",
				solutionIdentities: [
					"work-item-execution",
					"agentic-work-item-memory-application",
					"agentic-memory-record-use",
					"agentic-memory-retrieval",
				],
				campaignRef: ROOT_EVAL_LIVE_GENERATION_REF,
				campaignPurpose: ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE,
				taskSetRef: ROOT_EVAL_LIVE_TASK_SET_REF,
				generationRef: ROOT_EVAL_LIVE_GENERATION_REF,
				replicate: replicateCount,
				replicateCount,
				heldOutSealDigest: ROOT_EVAL_LIVE_HELD_OUT_SEAL_DIGEST,
				budgetPartition: ROOT_EVAL_LIVE_BUDGET_PARTITION,
				partitionHardCapMicrousd: 6_000_000,
				partitionSpentBeforeMicrousd: 0,
				partitionLedgerDigest: claimMaterial.partitionLedgerDigest,
				developmentQualification: {
					kind: "eval-development-qualification-state",
					campaignPurpose: ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE,
					generationRef: ROOT_EVAL_LIVE_GENERATION_REF,
					status: "qualified",
					generationQualified: true,
					consecutiveQualifyingGenerations: 1,
					requiredConsecutiveGenerations: 2,
					heldOutEligible: false,
				},
				armOrder: [
					"cold",
					"relevant-applied",
					"proposal-only",
					"admission-rejected",
					"irrelevant-applied",
					"wrong-scope-applied",
				],
				memoryProvenance,
				evaluableReplicates: replicateCount,
				excludedTechnicalReplicates: [],
				sourceTechnicalExcludedReplicates: [],
				matchedRelevantOverColdWins: replicateCount,
				verificationDiagnostics,
				completedArms: 6,
				activeProviderEffects: 0,
				activeToolEffects: 0,
				activeRetryEffects: 0,
				activeBillingEffects: 0,
				activeAdmittedEffects: 0,
				providerCapacity: {
					kind: "eval-provider-capacity-state",
					mode: "initial-parallel",
					initialMaxConcurrentEffects: 2,
					maxConcurrentEffects: 2,
					activeEffects: 0,
					proposalCount: workItemCount,
					pendingProposalCount: 0,
					pendingFirstAttemptProposalCount: 0,
					pendingRetryProposalCount: 0,
					retryProposalCount: 0,
					admittedProposalCount: workItemCount,
					admittedRetryProposalCount: 0,
					settledProposalCount: workItemCount,
					settledRetryProposalCount: 0,
					rejectedProposalCount: 0,
					rejectedRetryProposalCount: 0,
					cooldownOutstandingReadinessCount: 0,
					rateLimitFeedbackCount: 0,
				},
				elapsedBudget: {
					kind: "eval-elapsed-budget-state",
					scheduleId: `${ROOT_EVAL_LIVE_GENERATION_REF}/elapsed-admission-budget`,
					limitMs: ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS,
					drainReserveMs: ROOT_EVAL_GRAPH_DRAIN_RESERVE_MS,
					callerSafetyLeaseMs: ROOT_EVAL_CALLER_SAFETY_LEASE_MS,
					state: "armed",
					nowMs: 0,
					stoppingReason: "none",
				},
				admittedAttempts: workItemCount,
				admittedRetryAttempts: 0,
				retryProposalCount: 0,
				pendingRetryProposalCount: 0,
				rejectedRetryProposalCount: 0,
				settledRetryAttemptCount: 0,
				providerCallCount: workItemCount,
				activeReservedMicrousd: 0,
				providerReportedMicrousd: 100,
				pricingRoundingAllowanceMicrousd: 1,
				providerReportedLowerBoundMicrousd: 99,
				unreportedSettledUpperBoundMicrousd: 0,
				accountedUpperBoundMicrousd: 100,
				observedBilledMicrousd: 100,
				billingObservationCount: 4,
				billingStableIntervals: 3,
				reconciledBilledMicrousd: 100,
				billingDisposition: "reconciled",
				providerOutcomeReasonCounts: fixtureProviderOutcomeReasonCounts,
				stoppingReason: "campaign-complete",
				finding: "positive-differential",
			},
		] as never,
		tier: 3,
		seq: workItemCount + 1,
	};
	const progressObservations = Array.from({ length: workItemCount }, (_, completedWorkItems) => {
		const completedByArm = Object.fromEntries(
			arms.map((arm, armIndex) => [
				arm,
				Math.floor(completedWorkItems / arms.length) +
					(armIndex < completedWorkItems % arms.length ? 1 : 0),
			]),
		) as Record<(typeof arms)[number], number>;
		const progressDiagnostics = {
			kind: "eval-verification-diagnostics" as const,
			armOrder: arms,
			stageCounts: Object.fromEntries(
				arms.map((arm) => {
					const completed = completedByArm[arm];
					const passed = arm === "relevant-applied" ? completed : 0;
					return [
						arm,
						{
							completedWorkItems: completed,
							exactToolAdmitted: completed,
							scopedChange: passed,
							publicSemanticPassed: passed,
							hiddenVerifierPassed: passed,
							cleanupCompleted: completed,
							passed,
						},
					];
				}),
			),
			terminalReasonCounts: Object.fromEntries(
				arms.map((arm) => {
					const completed = completedByArm[arm];
					return [
						arm,
						{
							"cleanup-incomplete": 0,
							"provider-failed": 0,
							"exact-tool-failed": 0,
							"no-change": arm === "relevant-applied" ? 0 : completed,
							"wrong-scope": 0,
							"public-semantic-failed": 0,
							"hidden-verifier-failed": 0,
							passed: arm === "relevant-applied" ? completed : 0,
						},
					];
				}),
			),
			completedWorkItems,
		};
		const providerReportedMicrousd = completedWorkItems * 3;
		const replicate = Math.floor(Math.max(0, completedWorkItems - 1) / arms.length) + 1;
		const completedArms =
			completedWorkItems === 0 ? 0 : ((completedWorkItems - 1) % arms.length) + 1;
		return {
			...observation,
			seq: completedWorkItems + 1,
			msg: [
				"DATA",
				{
					...(observation.msg[1] as Readonly<Record<string, unknown>>),
					replicate,
					completedArms,
					verificationDiagnostics: progressDiagnostics,
					activeProviderEffects: 0,
					activeToolEffects: 0,
					activeRetryEffects: 0,
					activeBillingEffects: 0,
					activeAdmittedEffects: 0,
					providerCapacity: {
						kind: "eval-provider-capacity-state",
						mode: "initial-parallel",
						initialMaxConcurrentEffects: 2,
						maxConcurrentEffects: 2,
						activeEffects: 0,
						proposalCount: completedWorkItems,
						pendingProposalCount: 0,
						pendingFirstAttemptProposalCount: 0,
						pendingRetryProposalCount: 0,
						retryProposalCount: 0,
						admittedProposalCount: completedWorkItems,
						admittedRetryProposalCount: 0,
						settledProposalCount: completedWorkItems,
						settledRetryProposalCount: 0,
						rejectedProposalCount: 0,
						rejectedRetryProposalCount: 0,
						cooldownOutstandingReadinessCount: 0,
						rateLimitFeedbackCount: 0,
					},
					admittedAttempts: completedWorkItems,
					providerCallCount: completedWorkItems,
					providerReportedMicrousd,
					pricingRoundingAllowanceMicrousd: providerReportedMicrousd === 0 ? 0 : 1,
					providerReportedLowerBoundMicrousd: Math.max(0, providerReportedMicrousd - 1),
					accountedUpperBoundMicrousd: providerReportedMicrousd,
					observedBilledMicrousd: null,
					billingObservationCount: 0,
					billingStableIntervals: 0,
					reconciledBilledMicrousd: null,
					billingDisposition: "pending",
					providerOutcomeReasonCounts: {
						...fixtureProviderOutcomeReasonCounts,
						"tool-proposed": completedWorkItems,
					},
					developmentQualification: {
						kind: "eval-development-qualification-state",
						campaignPurpose: ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE,
						generationRef: ROOT_EVAL_LIVE_GENERATION_REF,
						status: "pending",
						generationQualified: null,
						consecutiveQualifyingGenerations: 0,
						requiredConsecutiveGenerations: 2,
						heldOutEligible: false,
					},
					evaluableReplicates: null,
					excludedTechnicalReplicates: [],
					sourceTechnicalExcludedReplicates: [],
					matchedRelevantOverColdWins: null,
					stoppingReason: "none",
					finding: "pending",
				},
			] as never,
		};
	});
	const graphResult: RootEvalRunResult = {
		finding: {
			kind: "eval-efficacy-finding",
			campaignRef: ROOT_EVAL_LIVE_GENERATION_REF,
			replicateCount,
			armOrder: [
				"cold",
				"relevant-applied",
				"proposal-only",
				"admission-rejected",
				"irrelevant-applied",
				"wrong-scope-applied",
			],
			passCounts: {
				cold: 0,
				"relevant-applied": replicateCount,
				"proposal-only": 0,
				"admission-rejected": 0,
				"irrelevant-applied": 0,
				"wrong-scope-applied": 0,
			},
			evaluableReplicates: replicateCount,
			excludedTechnicalReplicates: [],
			sourceTechnicalExcludedReplicates: [],
			matchedRelevantOverColdWins: replicateCount,
			verificationDiagnostics,
			completedWorkItems: workItemCount,
			admittedAttempts: workItemCount,
			providerCallCount: workItemCount,
			activeReservedMicrousd: 0,
			providerReportedMicrousd: 100,
			pricingRoundingAllowanceMicrousd: 1,
			providerReportedLowerBoundMicrousd: 99,
			unreportedSettledUpperBoundMicrousd: 0,
			accountedUpperBoundMicrousd: 100,
			observedBilledMicrousd: 100,
			billingObservationCount: 4,
			billingStableIntervals: 3,
			reconciledBilledMicrousd: 100,
			billingDisposition: "reconciled",
			providerOutcomeReasonCounts: fixtureProviderOutcomeReasonCounts,
			finding: "positive-differential",
			stoppingReason: "campaign-complete",
		},
		observations: [...progressObservations, observation],
		peakConcurrentEffects: 2,
		executedAdmissionIds: admissionIds(workItemCount),
	};
	const observationValues = graphResult.observations.map((event) => event.msg[1] as never);
	for (const [index, value] of observationValues.entries())
		assertRootEvalObservationRuntimeShape(value, `fixture observation[${index}]`);
	assertRootEvalObservationSequence(observationValues, "fixture observation");
	return {
		claim,
		currentKeyBefore,
		currentKeyAfter,
		pricing: pricingObservation,
		zeroByok,
		providerCalls: workItemCount,
		graphResult,
		partialGraphObservations: graphResult.observations,
		failure: null,
		cleanupDisposition: "complete",
	};
}

async function currentClaimInput(privateRoot: string) {
	const nowMs = Date.now();
	const credential = parseRootEvalLiveCredential(
		new TextEncoder().encode("OPENROUTER_API_KEY=sk-or-v1-a44-middle-credential-e06\n"),
	);
	const pricing = await readRootEvalLivePricing({
		nowMs,
		fetchImpl: (async (url: string | URL | Request) => {
			const target = String(url);
			const body =
				target === ROOT_EVAL_LIVE_PRICING_SOURCE
					? {
							data: {
								id: "deepseek/deepseek-v4-flash-0731",
								endpoints: [
									{
										provider_name: "Fireworks",
										tag: "fireworks",
										quantization: "unknown",
										model_id: "deepseek/deepseek-v4-flash-0731",
										name: "Fireworks | deepseek/deepseek-v4-flash-20260731",
										supported_parameters: [
											"max_tokens",
											"reasoning",
											"response_format",
											"structured_outputs",
										],
										pricing: {
											prompt: "0.00000022",
											completion: "0.00000066",
											input_cache_read: "0.000000007",
										},
									},
								],
							},
						}
					: {
							data: [
								{
									provider_name: "Fireworks",
									tag: "fireworks",
									model_id: "deepseek/deepseek-v4-flash-0731",
									name: "Fireworks | deepseek/deepseek-v4-flash-20260731",
								},
							],
						};
			const response = new Response(JSON.stringify(body), { status: 200 });
			Object.defineProperty(response, "url", { value: target });
			return response;
		}) as typeof fetch,
	});
	const zeroByok = admitRootEvalLiveZeroByok({
		credential,
		nowMs,
		precredentialGateReceipt: precredentialGateReceipt(nowMs - 1),
		bytes: zeroByokArtifactBytes(nowMs, precredentialGateReceipt(nowMs - 1).receiptDigest),
	});
	const currentKeyBefore = await readRootEvalLiveCurrentKey({
		credential,
		fetchImpl: (async () =>
			new Response(
				JSON.stringify({
					data: {
						limit: 32,
						limit_remaining: 7,
						usage: 25,
						limit_reset: null,
						is_management_key: false,
					},
				}),
				{ status: 200 },
			)) as typeof fetch,
	});
	return {
		privateRoot,
		implementationCoordinate: `worktree:${"a".repeat(40)}:${ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST}`,
		implementationManifestDigest: ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: ROOT_EVAL_CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
		qualificationDigest: ROOT_EVAL_CURRENT_QUALIFICATION_DIGEST,
		taskBindingDigest: ROOT_EVAL_CURRENT_TASK_BINDING_DIGEST,
		taskManifestDigest: testTaskManifestDigest,
		pricing,
		zeroByok,
		credential,
		currentKeyBefore,
		partitionSpentBeforeMicrousd: 0,
		partitionLedgerDigest: testPartitionLedgerDigest,
		developmentQualificationStreakBefore: 0,
		nowMs,
	};
}

function refreshedCurrentKeys(input: RootEvalLiveEvidenceInput): RootEvalLiveEvidenceInput {
	const refresh = <T extends { readonly admissionDigest: string }>(value: T | null): T | null => {
		if (value === null) return null;
		const { admissionDigest: _digest, ...material } = value;
		return { ...material, admissionDigest: empiricalStrictJsonDigest(material) } as T;
	};
	const refreshed = {
		...input,
		currentKeyBefore: refresh(input.currentKeyBefore),
		currentKeyAfter: refresh(input.currentKeyAfter),
	};
	return withRehashedClaim(refreshed, {
		currentKeyBeforeDigest: refreshed.currentKeyBefore?.admissionDigest ?? null,
	});
}

function withRehashedCurrentKey(
	input: RootEvalLiveEvidenceInput,
	which: "before" | "after",
	patch: Readonly<Record<string, unknown>>,
): RootEvalLiveEvidenceInput {
	const key = which === "before" ? "currentKeyBefore" : "currentKeyAfter";
	const current = input[key];
	if (current === null) throw new TypeError("test current key missing");
	const { admissionDigest: _digest, ...material } = current;
	const mutated = { ...material, ...patch };
	return {
		...input,
		[key]: { ...mutated, admissionDigest: empiricalStrictJsonDigest(mutated) },
	} as RootEvalLiveEvidenceInput;
}

function withRehashedClaim(
	input: RootEvalLiveEvidenceInput,
	patch: Readonly<Record<string, unknown>>,
): RootEvalLiveEvidenceInput {
	const { claimDigest: _digest, ...current } = input.claim;
	const material = { ...current, ...patch };
	return {
		...input,
		claim: { ...material, claimDigest: empiricalStrictJsonDigest(material) } as never,
	};
}

function withRehashedPricing(
	input: RootEvalLiveEvidenceInput,
	patch: Readonly<Record<string, unknown>>,
): RootEvalLiveEvidenceInput {
	const { observationDigest: _digest, ...current } = input.pricing;
	const material = { ...current, ...patch };
	const pricingObservation = {
		...material,
		observationDigest: empiricalStrictJsonDigest(material),
	} as never;
	return withRehashedClaim(
		{ ...input, pricing: pricingObservation },
		{ pricingObservationDigest: pricingObservation.observationDigest },
	);
}

function withRehashedZeroByok(
	input: RootEvalLiveEvidenceInput,
	patch: Readonly<Record<string, unknown>>,
): RootEvalLiveEvidenceInput {
	const { observationDigest: _digest, ...current } = input.zeroByok;
	const material = { ...current, ...patch };
	const zeroByok = { ...material, observationDigest: empiricalStrictJsonDigest(material) } as never;
	return withRehashedClaim(
		{ ...input, zeroByok },
		{ zeroByokObservationDigest: zeroByok.observationDigest },
	);
}

function withGraphResult(
	input: RootEvalLiveEvidenceInput,
	graphPatch: Partial<RootEvalRunResult> = {},
	findingPatch: Partial<RootEvalRunResult["finding"]> = {},
): RootEvalLiveEvidenceInput {
	if (input.graphResult === null) throw new TypeError("test graph result missing");
	const graphResult = {
		...input.graphResult,
		...graphPatch,
		finding: { ...input.graphResult.finding, ...findingPatch },
	};
	return { ...input, graphResult, partialGraphObservations: graphResult.observations };
}

function withTerminalObservation(
	input: RootEvalLiveEvidenceInput,
	patch: Readonly<Record<string, unknown>>,
): RootEvalLiveEvidenceInput {
	if (input.graphResult === null) throw new TypeError("test graph result missing");
	const event = input.graphResult.observations.at(-1);
	if (event === undefined || event.msg[0] !== "DATA")
		throw new TypeError("test terminal observation missing");
	const observation = event.msg[1] as unknown as Readonly<Record<string, unknown>>;
	const pendingBillingPatch =
		patch.finding === "pending"
			? {
					evaluableReplicates: null,
					excludedTechnicalReplicates: [],
					sourceTechnicalExcludedReplicates: [],
					matchedRelevantOverColdWins: null,
					observedBilledMicrousd: null,
					billingObservationCount: 0,
					billingStableIntervals: 0,
					reconciledBilledMicrousd: null,
					billingDisposition: "pending",
				}
			: {};
	return withGraphResult(input, {
		observations: [
			...input.graphResult.observations.slice(0, -1),
			{ ...event, msg: ["DATA", { ...observation, ...pendingBillingPatch, ...patch }] as never },
		],
	});
}

function withRejectedBillingTerminal(input: RootEvalLiveEvidenceInput): RootEvalLiveEvidenceInput {
	const billingPatch = {
		providerReportedMicrousd: 85_284,
		pricingRoundingAllowanceMicrousd: 22,
		providerReportedLowerBoundMicrousd: 85_262,
		unreportedSettledUpperBoundMicrousd: 0,
		accountedUpperBoundMicrousd: 85_284,
		observedBilledMicrousd: 85_261,
		billingObservationCount: 4,
		billingStableIntervals: 3,
		reconciledBilledMicrousd: 0,
		billingDisposition: "rejected" as const,
		stoppingReason: "campaign-complete" as const,
	};
	const findingInput = withGraphResult(input, {}, billingPatch);
	return withTerminalObservation(findingInput, billingPatch);
}

describe("D145 live-boundary qualification over immutable D116/D117 and D118/D120 evidence", () => {
	it("atomically conserves both D145 spend partitions and the two-generation development gate", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-d145-charter-ledger-"));
		const path = join(await realpath(temporary), "charter.json");
		try {
			const empty = await readRootEvalD145CharterLedger(path);
			expect(empty).toEqual(ROOT_EVAL_D145_EMPTY_CHARTER_LEDGER);
			const qualified = (count: 1 | 2) => ({
				kind: "eval-development-qualification-state" as const,
				campaignPurpose: "development" as const,
				generationRef: `development-${count}`,
				status: "qualified" as const,
				generationQualified: true as const,
				consecutiveQualifyingGenerations: count,
				requiredConsecutiveGenerations: 2 as const,
				heldOutEligible: count === 2,
			});
			const first = advanceRootEvalD145CharterLedger({
				ledger: empty,
				generationRef: "development-1",
				campaignPurpose: "development",
				taskSetRef: "root-eval-d145-transfer-development-1-v1",
				taskManifestDigest: empiricalStrictJsonDigest("development-1-manifest"),
				budgetPartition: "development-usd-6",
				providerReportedMicrousd: 101,
				unreportedSettledUpperBoundMicrousd: 0,
				accountedUpperBoundMicrousd: 101,
				developmentQualification: qualified(1),
				evidenceDigest: empiricalStrictJsonDigest("development-1-evidence"),
			});
			await writeRootEvalD145CharterLedger(path, first);
			expect((await stat(path)).mode & 0o777).toBe(0o600);
			expect(await readRootEvalD145CharterLedger(path)).toEqual(first);
			expect(() =>
				advanceRootEvalD145CharterLedger({
					ledger: first,
					generationRef: "confirmatory-too-early",
					campaignPurpose: "confirmatory",
					taskSetRef: "root-eval-d145-transfer-confirmatory-v1",
					taskManifestDigest: ROOT_EVAL_LIVE_HELD_OUT_SEAL_DIGEST,
					budgetPartition: "confirmatory-usd-6",
					providerReportedMicrousd: 1,
					unreportedSettledUpperBoundMicrousd: 0,
					accountedUpperBoundMicrousd: 1,
					developmentQualification: null,
					evidenceDigest: empiricalStrictJsonDigest("too-early"),
				}),
			).toThrow(/not authorized/u);
			const second = advanceRootEvalD145CharterLedger({
				ledger: first,
				generationRef: "development-2",
				campaignPurpose: "development",
				taskSetRef: "root-eval-d145-transfer-development-2-v1",
				taskManifestDigest: empiricalStrictJsonDigest("development-2-manifest"),
				budgetPartition: "development-usd-6",
				providerReportedMicrousd: 202,
				unreportedSettledUpperBoundMicrousd: 0,
				accountedUpperBoundMicrousd: 202,
				developmentQualification: qualified(2),
				evidenceDigest: empiricalStrictJsonDigest("development-2-evidence"),
			});
			const confirmatory = advanceRootEvalD145CharterLedger({
				ledger: second,
				generationRef: "confirmatory-1",
				campaignPurpose: "confirmatory",
				taskSetRef: "root-eval-d145-transfer-confirmatory-v1",
				taskManifestDigest: ROOT_EVAL_LIVE_HELD_OUT_SEAL_DIGEST,
				budgetPartition: "confirmatory-usd-6",
				providerReportedMicrousd: 303,
				unreportedSettledUpperBoundMicrousd: 0,
				accountedUpperBoundMicrousd: 303,
				developmentQualification: {
					kind: "eval-development-qualification-state",
					campaignPurpose: "confirmatory",
					generationRef: "confirmatory-1",
					status: "not-applicable",
					generationQualified: null,
					consecutiveQualifyingGenerations: 2,
					requiredConsecutiveGenerations: 2,
					heldOutEligible: true,
				},
				evidenceDigest: empiricalStrictJsonDigest("confirmatory-evidence"),
			});
			expect(confirmatory).toMatchObject({
				developmentSpentMicrousd: 303,
				confirmatorySpentMicrousd: 303,
				developmentQualificationStreak: 2,
				heldOutConsumed: true,
			});
			expect(() =>
				advanceRootEvalD145CharterLedger({
					ledger: confirmatory,
					generationRef: "confirmatory-2",
					campaignPurpose: "confirmatory",
					taskSetRef: "root-eval-d145-transfer-confirmatory-v1",
					taskManifestDigest: ROOT_EVAL_LIVE_HELD_OUT_SEAL_DIGEST,
					budgetPartition: "confirmatory-usd-6",
					providerReportedMicrousd: 1,
					unreportedSettledUpperBoundMicrousd: 0,
					accountedUpperBoundMicrousd: 1,
					developmentQualification: null,
					evidenceDigest: empiricalStrictJsonDigest("confirmatory-2"),
				}),
			).toThrow(/not authorized/u);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	it("binds exact fresh D145 currentness and rejects synthetic live authority", async () => {
		expect(ROOT_EVAL_LIVE_DECISION_REF).toBe("graphrefly-ts:D145");
		expect(ROOT_EVAL_LIVE_CLAIM_SCHEMA).toBe("graphrefly-ts.root-eval-live-claim.v20");
		expect(ROOT_EVAL_LIVE_EVIDENCE_SCHEMA).toBe("graphrefly-ts.root-eval-live-evidence.v23");
		expect(ROOT_EVAL_LIVE_PRECLAIM_FAILURE_SCHEMA).toBe(
			"graphrefly-ts.root-eval-live-preclaim-failure.v20",
		);
		expect(ROOT_EVAL_LIVE_CLAIM_REF).toBe("root-eval-development-claim-2026-08-27-d145-v1");
		expect(ROOT_EVAL_LIVE_GENERATION_REF).toBe("root-eval-development-2026-08-27-d145-v1");
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-d140-synthetic-live-"));
		const privateRoot = await realpath(temporary);
		await chmod(privateRoot, 0o700);
		try {
			await expect(acquireRootEvalLiveClaim(await currentClaimInput(privateRoot))).rejects.toThrow(
				/authority-provenance/u,
			);
			expect(await readdir(privateRoot)).toEqual([]);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});
	it("uses the exact shared private-input identity gate before preclaim", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-d116-private-inputs-"));
		const canonicalTemporary = await realpath(temporary);
		const inputRoot = join(canonicalTemporary, "inputs");
		const privateRoot = join(canonicalTemporary, "private");
		const credentialPath = join(inputRoot, "openrouter.env");
		const zeroByokPath = join(inputRoot, "fresh-zero-byok-d140.v15.json");
		const observedAtMs = Date.now();
		try {
			await mkdir(inputRoot, { mode: 0o700 });
			await mkdir(privateRoot, { mode: 0o700 });
			const precredentialReceipt = await persistRootEvalLivePrecredentialGateReceipt({
				privateRoot,
				currentness: boundedCurrentness,
				completedAtMs: observedAtMs - 1,
			});
			await writeFile(credentialPath, "OPENROUTER_API_KEY=sk-or-v1-a44-middle-credential-e06\n", {
				mode: 0o600,
			});
			await chmod(credentialPath, 0o600);
			await writeFile(
				zeroByokPath,
				zeroByokArtifactBytes(observedAtMs, precredentialReceipt.receiptDigest),
				{ mode: 0o644 },
			);
			await chmod(zeroByokPath, 0o644);
			await expect(
				qualifyRootEvalLivePrivateInputPreflight({
					credentialPath,
					zeroByokPath,
					precredentialPrivateRoot: privateRoot,
					currentness: boundedCurrentness,
					nowMs: observedAtMs,
				}),
			).rejects.toThrow(/private input identity/u);

			await chmod(zeroByokPath, 0o600);
			await expect(
				qualifyRootEvalLivePrivateInputs({
					credentialPath,
					zeroByokPath,
					precredentialPrivateRoot: privateRoot,
					currentness: boundedCurrentness,
					nowMs: observedAtMs,
				}),
			).resolves.toMatchObject({
				credential: {
					bindingRef: "openrouter.local-eval-2",
					bindingRevision: "2026-08-26.d145.v1",
				},
				zeroByok: {
					workspaceSlug: "graph-re-fly",
					keyName: "Local Eval 2",
					byokCredentialCount: 0,
					observationDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
				},
			});
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	});
	it("qualifies D140 private inputs without consuming its live generation", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-d140-preflight-"));
		const canonicalTemporary = await realpath(temporary);
		const inputRoot = join(canonicalTemporary, "inputs");
		const privateRoot = join(canonicalTemporary, "private");
		const credentialPath = join(inputRoot, "openrouter.env");
		const zeroByokPath = join(inputRoot, "fresh-zero-byok-d140.v15.json");
		const observedAtMs = Date.now();
		try {
			await mkdir(inputRoot, { mode: 0o700 });
			await mkdir(privateRoot, { mode: 0o700 });
			const receipt = await persistRootEvalLivePrecredentialGateReceipt({
				privateRoot,
				currentness: boundedCurrentness,
				completedAtMs: observedAtMs - 1,
			});
			await writeFile(credentialPath, "OPENROUTER_API_KEY=sk-or-v1-a44-middle-credential-e06\n", {
				mode: 0o600,
			});
			await writeFile(zeroByokPath, zeroByokArtifactBytes(observedAtMs, receipt.receiptDigest), {
				mode: 0o600,
			});
			await expect(
				qualifyRootEvalLivePrivateInputPreflight({
					credentialPath,
					zeroByokPath,
					precredentialPrivateRoot: privateRoot,
					currentness: boundedCurrentness,
					nowMs: observedAtMs,
				}),
			).resolves.toMatchObject({
				disposition: "qualified-private-inputs",
				generationRef: ROOT_EVAL_LIVE_GENERATION_REF,
				precredentialGateReceiptDigest: receipt.receiptDigest,
			});
			expect(await readdir(privateRoot)).toEqual([
				`.${ROOT_EVAL_LIVE_GENERATION_REF}.precredential-gates.v5.json`,
			]);

			const staleSchema = new TextDecoder()
				.decode(zeroByokArtifactBytes(observedAtMs, receipt.receiptDigest))
				.replace(ROOT_EVAL_LIVE_ZERO_BYOK_SCHEMA, "graphrefly-ts.d134.zero-byok-observation.v13");
			await writeFile(zeroByokPath, staleSchema, { mode: 0o600 });
			await expect(
				qualifyRootEvalLivePrivateInputPreflight({
					credentialPath,
					zeroByokPath,
					precredentialPrivateRoot: privateRoot,
					currentness: boundedCurrentness,
					nowMs: observedAtMs,
				}),
			).rejects.toThrow(/same-credential admission/u);
			expect(await readdir(privateRoot)).toEqual([
				`.${ROOT_EVAL_LIVE_GENERATION_REF}.precredential-gates.v5.json`,
			]);

			const unknownField = new TextDecoder()
				.decode(zeroByokArtifactBytes(observedAtMs, receipt.receiptDigest))
				.replace(/\}$/u, ',"unexpectedField":true}');
			await writeFile(zeroByokPath, unknownField, { mode: 0o600 });
			await expect(
				qualifyRootEvalLivePrivateInputPreflight({
					credentialPath,
					zeroByokPath,
					precredentialPrivateRoot: privateRoot,
					currentness: boundedCurrentness,
					nowMs: observedAtMs,
				}),
			).rejects.toThrow(/unexpected keys/u);
			expect(await readdir(privateRoot)).toEqual([
				`.${ROOT_EVAL_LIVE_GENERATION_REF}.precredential-gates.v5.json`,
			]);
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	});
	it("rejects a stale gate receipt before attempting to read credentials", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-d138-stale-receipt-"));
		const privateRoot = await realpath(temporary);
		const nowMs = Date.now();
		try {
			await persistRootEvalLivePrecredentialGateReceipt({
				privateRoot,
				currentness: boundedCurrentness,
				completedAtMs: nowMs - 3_600_001,
			});
			await expect(
				qualifyRootEvalLivePrivateInputs({
					credentialPath: join(privateRoot, "missing-credential.env"),
					zeroByokPath: join(privateRoot, "missing-zero-byok.json"),
					precredentialPrivateRoot: privateRoot,
					currentness: boundedCurrentness,
					nowMs,
				}),
			).rejects.toThrow(/receipt was not fresh/u);
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	});
	it("binds commit, worktree and generated-artifact currentness before credential access", async () => {
		for (const currentnessPatch of [
			{ implementationCommit: "b".repeat(40) },
			{ repositoryStateDigest: empiricalStrictJsonDigest("mutated-repository-state") },
			{ artifactSetDigest: empiricalStrictJsonDigest("mutated-artifact-set") },
		] as const) {
			const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-d138-currentness-"));
			const privateRoot = await realpath(temporary);
			try {
				await persistRootEvalLivePrecredentialGateReceipt({
					privateRoot,
					currentness: boundedCurrentness,
				});
				await expect(
					qualifyRootEvalLivePrivateInputs({
						credentialPath: join(privateRoot, "missing-credential.env"),
						zeroByokPath: join(privateRoot, "missing-zero-byok.json"),
						precredentialPrivateRoot: privateRoot,
						currentness: { ...boundedCurrentness, ...currentnessPatch },
					}),
				).rejects.toThrow(/receipt currentness drifted/u);
			} finally {
				await rm(temporary, { force: true, recursive: true });
			}
		}
	});
	it("detects a generated-artifact byte mutation without executing the root Eval", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-d138-artifacts-"));
		const artifactDirectory = join(temporary, "artifacts");
		try {
			await cp(ROOT_EVAL_ARTIFACT_DIRECTORY, artifactDirectory, { recursive: true });
			await writeFile(join(artifactDirectory, "root-eval-run-summary.json"), "{}\n");
			await expect(checkRootEvalGeneratedArtifactSnapshot({ artifactDirectory })).rejects.toThrow(
				/snapshot drift/u,
			);
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	});
	it("rejects unexpected private generation state before attempting to read credentials", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-d138-private-state-"));
		const privateRoot = await realpath(temporary);
		try {
			await persistRootEvalLivePrecredentialGateReceipt({
				privateRoot,
				currentness: boundedCurrentness,
			});
			await writeFile(join(privateRoot, "unexpected-artifact.json"), "{}\n", { mode: 0o600 });
			await expect(
				qualifyRootEvalLivePrivateInputs({
					credentialPath: join(privateRoot, "missing-credential.env"),
					zeroByokPath: join(privateRoot, "missing-zero-byok.json"),
					precredentialPrivateRoot: privateRoot,
					currentness: boundedCurrentness,
				}),
			).rejects.toThrow(/consumed generation state/u);
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	});
	it("opens only the exact D140 production authority and fresh private namespace", () => {
		const liveEntry = readFileSync(
			resolve(
				repositoryRoot,
				"packages/ts/evals/graph-native-rerun-avoidance/run-live-campaign.ts",
			),
			"utf8",
		);
		expect(liveEntry).toContain('"open-by-graphrefly-ts:D145" as const');
		expect(liveEntry).toMatch(
			/join\(operatorRoot, `current-\$\{ROOT_EVAL_LIVE_GENERATION_REF\}`\)/u,
		);
		expect(liveEntry).not.toContain('join(operatorRoot, "current-live-d136")');
	});
	it("keeps an unsettled caller await alive and releases the lease after settlement", async () => {
		const moduleUrl = pathToFileURL(
			resolve(repositoryRoot, "packages/ts/evals/graph-native-rerun-avoidance/root-eval-live.ts"),
		).href;
		const source = `
			const { awaitRootEvalCallerSettlement } = await import(${JSON.stringify(moduleUrl)});
			const value = await awaitRootEvalCallerSettlement(() => new Promise((resolve) => {
				const timer = setTimeout(() => resolve("settled"), 25);
				timer.unref();
			}));
			process.stdout.write(value);
		`;
		const startedAt = Date.now();
		const result = await new Promise<
			Readonly<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }>
		>((resolveResult, reject) => {
			const child = spawn(
				process.execPath,
				["--import", "tsx", "--input-type=module", "--eval", source],
				{ cwd: repositoryRoot, shell: false, stdio: ["ignore", "pipe", "pipe"] },
			);
			let stdout = "";
			let stderr = "";
			child.stdout.setEncoding("utf8");
			child.stderr.setEncoding("utf8");
			child.stdout.on("data", (chunk: string) => {
				stdout += chunk;
			});
			child.stderr.on("data", (chunk: string) => {
				stderr += chunk;
			});
			child.once("error", reject);
			child.once("close", (code) => resolveResult({ code, stdout, stderr }));
		});
		expect(result.code).toBe(0);
		expect(result.stdout).toBe("settled");
		expect(result.stderr).not.toMatch(/Error|unsettled top-level await/u);
		expect(Date.now() - startedAt).toBeLessThan(5_000);
	});

	it("keeps the composed admitted causal tail below the Graph drain reserve", () => {
		expect(ROOT_EVAL_MAX_POST_CUTOFF_CAUSAL_TAIL_MS).toBe(
			ROOT_EVAL_PROVIDER_SETTLEMENT_LEASE_MS +
				ROOT_EVAL_TOOL_SETTLEMENT_LEASE_MS +
				ROOT_EVAL_RETRY_SETTLEMENT_LEASE_MS +
				ROOT_EVAL_BILLING_SETTLEMENT_LEASE_MS * ROOT_EVAL_MAX_BILLING_OBSERVATIONS,
		);
		expect(ROOT_EVAL_MAX_POST_CUTOFF_CAUSAL_TAIL_MS).toBeLessThan(ROOT_EVAL_GRAPH_DRAIN_RESERVE_MS);
		expect(ROOT_EVAL_CALLER_SETTLEMENT_DEADLINE_MS).toBe(6_300_000);
	});

	it("enforces retry and cleanup-finalizer settlement against non-cooperative adapters", async () => {
		const executor = createRootEvalLiveExecutor({
			repositoryRoot,
			materializationRoot: join(repositoryRoot, ".never-created-root-eval-lease-test"),
			privateRoot: repositoryRoot,
			claimCommit: {} as never,
			bearerToken: "sk-or-v1-no-network-lease-fixture",
			pricing,
			wait: async () => await new Promise<never>(() => undefined),
			removeWorkspace: async () => await new Promise<never>(() => undefined),
		});
		vi.useFakeTimers();
		try {
			const retry = executor.execute({
				kind: "eval-admitted-retry-delay",
				executionId: "retry-lease-fixture",
				delayMs: 120_000,
			} as never);
			const retryResult = expect(retry).rejects.toMatchObject({
				name: "RootEvalSettlementLeaseExpired",
				effectClass: "retry-delay",
			});
			await vi.advanceTimersByTimeAsync(ROOT_EVAL_RETRY_SETTLEMENT_LEASE_MS);
			await retryResult;
			const disposal = executor.dispose();
			await vi.advanceTimersByTimeAsync(ROOT_EVAL_TOOL_SETTLEMENT_LEASE_MS);
			await expect(disposal).resolves.toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it("bounds caller settlement with a closed technical code and no Graph mutation", async () => {
		await expect(
			awaitRootEvalCallerSettlement(() => new Promise<never>(() => undefined), { deadlineMs: 5 }),
		).rejects.toMatchObject({
			name: "RootEvalCallerSettlementDeadlineExpired",
			code: "caller-settlement-deadline-expired",
			deadlineMs: 5,
		});
	});

	it("cancels the root Graph runner and admitted executor work at the caller deadline", async () => {
		const cancellation = new AbortController();
		let active = 0;
		let settled = 0;
		const running = runRootEval(
			createRootEvalTopology({
				profileInput: createCurrentExactModelHarnessProfileInput(),
				currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
			}),
			async () => {
				active += 1;
				try {
					await new Promise<never>((_resolve, reject) => {
						const onAbort = () => reject(cancellation.signal.reason);
						cancellation.signal.addEventListener("abort", onAbort, { once: true });
						if (cancellation.signal.aborted) onAbort();
					});
				} finally {
					active -= 1;
					settled += 1;
				}
			},
			{ signal: cancellation.signal },
		);
		await expect(
			awaitRootEvalCallerSettlement(() => running, {
				deadlineMs: 5,
				onDeadline: (error) => cancellation.abort(error),
			}),
		).rejects.toMatchObject({ code: "caller-settlement-deadline-expired" });
		await expect(running).rejects.toMatchObject({ code: "caller-settlement-deadline-expired" });
		expect(active).toBe(0);
		expect(settled).toBeGreaterThan(0);
	});

	it("requires a committed D140 live claim before live provider dispatch", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-d94-wire-"));
		const privateRoot = await realpath(temporary);
		let admitted: EvalAdmittedEffect | undefined;
		try {
			await expect(
				runRootEval(
					createRootEvalTopology({
						profileInput: createCurrentExactModelHarnessProfileInput(),
						currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
						campaignRef: ROOT_EVAL_LIVE_GENERATION_REF,
						taskSetRef: ROOT_EVAL_DEVELOPMENT_TASK.taskSetRef,
						maxCostMicrousd: 6_000_000,
						reservationMicrousd: 200_000,
					}),
					async (effect) => {
						if (effect.kind === "eval-admitted-effect") admitted = effect;
						throw new Error("captured first admitted effect");
					},
				),
			).rejects.toThrow(/captured first admitted effect/u);
			if (admitted === undefined) throw new TypeError("D116 admitted effect was not captured");
			const claimInput = await currentClaimInput(privateRoot);
			const claimAcquisition = await acquireRootEvalLiveClaimForNoNetworkQualification(claimInput);
			const copiedRootPath = join(temporary, "copied-private-root");
			await mkdir(copiedRootPath, { mode: 0o700 });
			const copiedRoot = await realpath(copiedRootPath);
			const dispositionName = (await readdir(privateRoot)).find((name) =>
				name.endsWith("disposition.v20.json"),
			);
			if (dispositionName === undefined) throw new TypeError("D140 disposition missing");
			const committedBytes = await readFile(join(privateRoot, dispositionName));
			await writeFile(join(copiedRoot, dispositionName), committedBytes, { mode: 0o600 });
			const copiedRootExecutor = createRootEvalLiveTransportQualificationExecutor({
				repositoryRoot,
				materializationRoot: join(temporary, "copied-root-workspaces"),
				privateRoot: copiedRoot,
				claimCommit: claimAcquisition,
				bearerToken: claimInput.credential.bearerToken,
				pricing: claimInput.pricing,
				providerResponses: [{ status: 200, bytes: providerBytesForEffect(admitted) }],
			});
			try {
				await expect(copiedRootExecutor.execute(admitted)).resolves.toMatchObject({
					status: "failed",
					reason: "executor-failed",
					dispatchAttempted: false,
				});
				expect(copiedRootExecutor.providerRequestSummaries()).toEqual([]);
			} finally {
				await copiedRootExecutor.dispose();
			}
			const forgedCapabilityExecutor = createRootEvalLiveTransportQualificationExecutor({
				repositoryRoot,
				materializationRoot: join(temporary, "forged-capability-workspaces"),
				privateRoot,
				claimCommit: {
					claim: claimAcquisition.claim,
					postCommitFailureDigest: null,
				} as never,
				bearerToken: claimInput.credential.bearerToken,
				pricing: claimInput.pricing,
				providerResponses: [{ status: 200, bytes: providerBytes() }],
			});
			try {
				await expect(forgedCapabilityExecutor.execute(admitted)).resolves.toMatchObject({
					status: "failed",
					reason: "executor-failed",
					dispatchAttempted: false,
				});
				expect(forgedCapabilityExecutor.providerRequestSummaries()).toEqual([]);
			} finally {
				await forgedCapabilityExecutor.dispose();
			}
			const liveExecutor = createRootEvalLiveExecutor({
				repositoryRoot,
				materializationRoot: join(temporary, "strict-live-workspaces"),
				privateRoot,
				claimCommit: claimAcquisition,
				bearerToken: claimInput.credential.bearerToken,
				pricing: claimInput.pricing,
			});
			try {
				await expect(liveExecutor.execute(admitted)).resolves.toMatchObject({
					status: "failed",
					dispatchAttempted: false,
					reason: "executor-failed",
				});
			} finally {
				await liveExecutor.dispose();
			}
			const wrongCredentialExecutor = createRootEvalLiveTransportQualificationExecutor({
				repositoryRoot,
				materializationRoot: join(temporary, "wrong-credential-workspaces"),
				privateRoot,
				claimCommit: claimAcquisition,
				bearerToken: "sk-or-v1-a44-different-credential-e06",
				pricing: claimInput.pricing,
				providerResponses: [{ status: 200, bytes: providerBytes() }],
			});
			try {
				await expect(wrongCredentialExecutor.execute(admitted)).resolves.toMatchObject({
					status: "failed",
					reason: "executor-failed",
					costMicrousd: 0,
					costEvidence: "provider-reported" as const,
				});
				expect(wrongCredentialExecutor.providerRequestSummaries()).toEqual([]);
			} finally {
				await wrongCredentialExecutor.dispose();
			}
			const executor = createRootEvalLiveTransportQualificationExecutor({
				repositoryRoot,
				materializationRoot: join(temporary, "workspaces"),
				privateRoot,
				claimCommit: claimAcquisition,
				bearerToken: claimInput.credential.bearerToken,
				pricing: claimInput.pricing,
				providerResponses: [{ status: 200, bytes: providerBytesForEffect(admitted) }],
			});
			try {
				const outcome = (await executor.execute(admitted)) as EvalProviderOutcome;
				expect(outcome).toMatchObject({
					status: "tool-proposed",
					reason: "tool-proposed",
					costMicrousd: 265,
				});
				const requestBody = executor.providerRequestSummaries()[0];
				expect(Object.isFrozen(requestBody)).toBe(true);
				expect(Object.isFrozen(requestBody?.provider)).toBe(true);
				expect(Object.isFrozen(requestBody?.response_format)).toBe(true);
				expect(requestBody).toMatchObject({
					model: "deepseek/deepseek-v4-flash-0731",
					max_tokens: 16_384,
					provider: {
						order: ["fireworks"],
						only: ["fireworks"],
						allow_fallbacks: false,
						require_parameters: true,
						data_collection: "deny",
						zdr: true,
					},
					response_format: {
						type: "json_schema",
						json_schema: { name: "exact_replacement_proposal", strict: true },
					},
					reasoning: { effort: "medium" },
				});
				expect(requestBody?.reasoning).not.toHaveProperty("max_tokens");
				expect(requestBody).not.toHaveProperty("tools");
				expect(requestBody).not.toHaveProperty("tool_choice");
				expect(requestBody).not.toHaveProperty("parallel_tool_calls");
				await executor.dispose();
				const replayExecutor = createRootEvalLiveTransportQualificationExecutor({
					repositoryRoot,
					materializationRoot: join(temporary, "replay-workspaces"),
					privateRoot,
					claimCommit: claimAcquisition,
					bearerToken: claimInput.credential.bearerToken,
					pricing: claimInput.pricing,
					providerResponses: [{ status: 200, bytes: providerBytes() }],
				});
				try {
					await expect(replayExecutor.execute(admitted)).resolves.toMatchObject({
						status: "failed",
						reason: "executor-failed",
						costMicrousd: 0,
					});
					expect(replayExecutor.providerRequestSummaries()).toEqual([]);
				} finally {
					await replayExecutor.dispose();
				}
			} finally {
				await executor.dispose();
			}
			const { claimDigest: _currentDigest, ...currentClaimMaterial } = JSON.parse(
				committedBytes.toString("utf8"),
			) as RootEvalLiveClaim;
			const staleD121Material = {
				...currentClaimMaterial,
				schemaVersion: "graphrefly-ts.root-eval-live-claim.v14",
				claimRef: "root-eval-live-claim-2026-08-25-d121-v1",
				decisionRef: "graphrefly-ts:D121",
				generationRef: "root-eval-live-2026-08-25-d121-v1",
				implementationManifestDigest:
					"sha256:2bf1f7b4fa15262f09fdadc491af567d455d4dea81e28478db7223fb22556e0e",
				qualificationArtifactDigest:
					"sha256:90fdba7d97a6cd4e353cefe6f762ea114d92b2f1b6cdc23e4451f44656cefcfa",
				qualificationDigest:
					"sha256:b6d49961927d36d18153d32c673414bf9488edaa3fe8f96d9294f2e9efacc3a4",
				credentialBindingDigest: empiricalStrictJsonDigest({
					bindingRef: "openrouter.local-eval-2",
					bindingRevision: "2026-08-25.d121.v1",
				}),
			};
			await writeFile(
				join(privateRoot, dispositionName),
				JSON.stringify({
					...staleD121Material,
					claimDigest: empiricalStrictJsonDigest(staleD121Material),
				}),
				{ mode: 0o600 },
			);
			const staleD121Executor = createRootEvalLiveTransportQualificationExecutor({
				repositoryRoot,
				materializationRoot: join(temporary, "stale-d121-workspaces"),
				privateRoot,
				claimCommit: claimAcquisition,
				bearerToken: claimInput.credential.bearerToken,
				pricing: claimInput.pricing,
				providerResponses: [{ status: 200, bytes: providerBytes() }],
			});
			try {
				await expect(staleD121Executor.execute(admitted)).resolves.toMatchObject({
					status: "failed",
					reason: "executor-failed",
					dispatchAttempted: false,
				});
				expect(staleD121Executor.providerRequestSummaries()).toEqual([]);
			} finally {
				await staleD121Executor.dispose();
			}
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	}, 120_000);

	it("keeps consumed dispatch accounting when stage cleanup fails after receipt link", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-d140-dispatch-cleanup-"));
		const privateRoot = await realpath(temporary);
		let admitted: EvalAdmittedEffect | undefined;
		try {
			await expect(
				runRootEval(
					createRootEvalTopology({
						profileInput: createCurrentExactModelHarnessProfileInput(),
						currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
						campaignRef: ROOT_EVAL_LIVE_GENERATION_REF,
						taskSetRef: ROOT_EVAL_DEVELOPMENT_TASK.taskSetRef,
						maxCostMicrousd: 6_000_000,
						reservationMicrousd: 200_000,
					}),
					async (effect) => {
						if (effect.kind === "eval-admitted-effect") admitted = effect;
						throw new Error("captured dispatch-cleanup effect");
					},
				),
			).rejects.toThrow(/captured dispatch-cleanup effect/u);
			if (admitted === undefined)
				throw new TypeError("D140 dispatch-cleanup effect was not captured");
			const claimInput = await currentClaimInput(privateRoot);
			const claimAcquisition = await acquireRootEvalLiveClaimForNoNetworkQualification(claimInput);
			let providerCalls = 0;
			const executor = createRootEvalLiveTransportQualificationExecutor({
				repositoryRoot,
				materializationRoot: join(temporary, "workspaces"),
				privateRoot,
				claimCommit: claimAcquisition,
				bearerToken: claimInput.credential.bearerToken,
				pricing: claimInput.pricing,
				providerResponses: [{ status: 200, bytes: providerBytes() }],
				onProviderCall: () => {
					providerCalls += 1;
				},
				removeDispatchStage: async () => {
					throw new Error("injected dispatch stage cleanup failure");
				},
			});
			try {
				await expect(executor.execute(admitted)).resolves.toMatchObject({
					status: "failed",
					reason: "executor-failed",
					dispatchAttempted: true,
					costMicrousd: 200_000,
					costEvidence: "reservation-upper-bound",
				});
				expect(providerCalls).toBe(1);
				expect(
					(await readdir(join(privateRoot, ".d145-provider-dispatches"))).some((name) =>
						name.endsWith(".json"),
					),
				).toBe(true);
			} finally {
				await executor.dispose();
			}
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	}, 15_000);

	it("settles a stalled transport through the Graph-admitted Work Item timeout", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-effect-lease-"));
		const privateRoot = await realpath(temporary);
		const claimInput = await currentClaimInput(privateRoot);
		const claimAcquisition = await acquireRootEvalLiveClaimForNoNetworkQualification(claimInput);
		const executor = createRootEvalLiveTransportQualificationExecutor({
			repositoryRoot,
			materializationRoot: join(temporary, "workspaces"),
			privateRoot,
			claimCommit: claimAcquisition,
			bearerToken: claimInput.credential.bearerToken,
			pricing: claimInput.pricing,
			providerResponses: [],
			providerResponseForRequest(request) {
				const encoded = JSON.stringify(request);
				const targetTask = ROOT_EVAL_DEVELOPMENT_TASKS.find((task) =>
					encoded.includes(JSON.stringify(task.taskStatement).slice(1, -1)),
				);
				if (targetTask !== undefined)
					return { status: 200, bytes: providerBytes(), stallUntilAbort: true };
				const sourceTask = ROOT_EVAL_DEVELOPMENT_TASKS.find((task) =>
					encoded.includes(JSON.stringify(task.sourceTaskStatement).slice(1, -1)),
				);
				return sourceTask === undefined
					? { status: 200, bytes: providerBytes(), stallUntilAbort: true }
					: { status: 200, bytes: providerBytesForSourceTask(sourceTask) };
			},
		});
		try {
			const result = await runRootEval(
				createRootEvalTopology({
					profileInput: createCurrentExactModelHarnessProfileInput(),
					currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
					maxCostMicrousd: 6_000_000,
					reservationMicrousd: 200_000,
					effectTimeoutMs: 500,
					sourceEffectTimeoutMs: 300_000,
				}),
				(effect) => executor.execute(effect),
			);
			expect(result.finding).toMatchObject({
				completedWorkItems: 30,
				admittedAttempts: 35,
				stoppingReason: "campaign-complete",
				providerOutcomeReasonCounts: { "transport-failed": 30, "tool-proposed": 5 },
			});
			expect(result.peakConcurrentEffects).toBe(2);
			// The Work Item lease covers pre-dispatch materialization, so an
			// already-expired effect cannot commit a dispatch or reach transport.
			expect(executor.providerRequestSummaries()).toHaveLength(5);
			expect(await readdir(join(temporary, "workspaces"))).toEqual([]);
		} finally {
			await executor.dispose();
			await rm(temporary, { recursive: true, force: true });
		}
	}, 120_000);

	it("aborts active transport leases and removes every workspace on caller cancellation", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-caller-cancel-"));
		const privateRoot = await realpath(temporary);
		const materializationRoot = join(temporary, "workspaces");
		const claimInput = await currentClaimInput(privateRoot);
		const claimAcquisition = await acquireRootEvalLiveClaimForNoNetworkQualification(claimInput);
		const executor = createRootEvalLiveTransportQualificationExecutor({
			repositoryRoot,
			materializationRoot,
			privateRoot,
			claimCommit: claimAcquisition,
			bearerToken: claimInput.credential.bearerToken,
			pricing: claimInput.pricing,
			providerResponses: Array.from({ length: 6 }, () => ({
				status: 200,
				bytes: providerBytes(),
				stallUntilAbort: true,
			})),
		});
		const cancellation = new AbortController();
		try {
			const running = runRootEval(
				createRootEvalTopology({
					profileInput: createCurrentExactModelHarnessProfileInput(),
					currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
					taskSetRef: ROOT_EVAL_DEVELOPMENT_TASK.taskSetRef,
					effectTimeoutMs: 300_000,
				}),
				executor.execute,
				{ signal: cancellation.signal },
			);
			const settledRun = running.then(
				() => null,
				(error: unknown) => error,
			);
			while (executor.providerRequestSummaries().length < 1)
				await new Promise<void>((resolve) => setTimeout(resolve, 5));
			const reason = new RootEvalCallerSettlementDeadlineExpired(5);
			cancellation.abort(reason);
			await executor.dispose(reason);
			expect(await settledRun).toBe(reason);
			await expect(readdir(materializationRoot)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await executor.dispose();
			await rm(temporary, { recursive: true, force: true });
		}
	}, 120_000);

	it("settles thirty output-truncated Fireworks responses through the root Graph", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-truncated-response-"));
		const privateRoot = await realpath(temporary);
		const claimInput = await currentClaimInput(privateRoot);
		const claimAcquisition = await acquireRootEvalLiveClaimForNoNetworkQualification(claimInput);
		const executor = createRootEvalLiveTransportQualificationExecutor({
			repositoryRoot,
			materializationRoot: join(temporary, "workspaces"),
			privateRoot,
			claimCommit: claimAcquisition,
			bearerToken: claimInput.credential.bearerToken,
			pricing: claimInput.pricing,
			providerResponses: [],
			providerResponseForRequest(request) {
				const encoded = JSON.stringify(request);
				const targetTask = ROOT_EVAL_DEVELOPMENT_TASKS.find((task) =>
					encoded.includes(JSON.stringify(task.taskStatement).slice(1, -1)),
				);
				if (targetTask !== undefined) return { status: 200, bytes: truncatedProviderBytes() };
				const sourceTask = ROOT_EVAL_DEVELOPMENT_TASKS.find((task) =>
					encoded.includes(JSON.stringify(task.sourceTaskStatement).slice(1, -1)),
				);
				return sourceTask === undefined
					? { status: 200, bytes: truncatedProviderBytes() }
					: { status: 200, bytes: providerBytesForSourceTask(sourceTask) };
			},
		});
		try {
			const result = await runRootEval(
				createRootEvalTopology({
					profileInput: createCurrentExactModelHarnessProfileInput(),
					currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
					taskSetRef: ROOT_EVAL_DEVELOPMENT_TASK.taskSetRef,
					maxCostMicrousd: 6_000_000,
					reservationMicrousd: 200_000,
				}),
				(effect) => executor.execute(effect),
			);
			expect(result.finding).toMatchObject({
				completedWorkItems: 30,
				admittedAttempts: 35,
				stoppingReason: "campaign-complete",
				providerOutcomeReasonCounts: {
					"response-output-truncated": 30,
					"tool-proposed": 5,
				},
			});
			expect(result.peakConcurrentEffects).toBe(2);
			expect(executor.providerRequestSummaries()).toHaveLength(35);
			expect(await readdir(join(temporary, "workspaces"))).toEqual([]);
		} finally {
			await executor.dispose();
			await rm(temporary, { recursive: true, force: true });
		}
	}, 120_000);

	it("classifies a post-header body abort as the Graph-admitted transport timeout", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-body-lease-"));
		const privateRoot = await realpath(temporary);
		const claimInput = await currentClaimInput(privateRoot);
		const claimAcquisition = await acquireRootEvalLiveClaimForNoNetworkQualification(claimInput);
		let admitted: EvalAdmittedEffect | undefined;
		await expect(
			runRootEval(
				createRootEvalTopology({
					profileInput: createCurrentExactModelHarnessProfileInput(),
					currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
					campaignRef: ROOT_EVAL_LIVE_GENERATION_REF,
					taskSetRef: ROOT_EVAL_DEVELOPMENT_TASK.taskSetRef,
					maxCostMicrousd: 6_000_000,
					reservationMicrousd: 200_000,
					effectTimeoutMs: 5_000,
				}),
				async (effect) => {
					if (admitted === undefined && effect.kind === "eval-admitted-effect") admitted = effect;
					throw new Error("captured body-stall admission");
				},
			),
		).rejects.toThrow(/captured body-stall admission/u);
		if (admitted === undefined) throw new Error("missing admitted provider effect fixture");
		const materializationRoot = join(temporary, "body-workspaces");
		const executor = createRootEvalLiveTransportQualificationExecutor({
			repositoryRoot,
			materializationRoot,
			privateRoot,
			claimCommit: claimAcquisition,
			bearerToken: claimInput.credential.bearerToken,
			pricing: claimInput.pricing,
			providerResponses: [{ status: 200, bytes: providerBytes(), stallBodyUntilAbort: true }],
		});
		try {
			await expect(executor.execute(admitted)).resolves.toMatchObject({
				status: "failed",
				reason: "transport-failed",
				costMicrousd: 200_000,
				cleanupCompleted: true,
			});
			expect(executor.providerRequestSummaries()).toHaveLength(1);
			expect(await readdir(materializationRoot)).toEqual([]);
		} finally {
			await executor.dispose();
			await rm(temporary, { recursive: true, force: true });
		}
	}, 120_000);

	it("qualifies fresh Fireworks pricing and the exact route through the ZDR registry", async () => {
		const pricingEnvelope = {
			data: {
				id: "deepseek/deepseek-v4-flash-0731",
				endpoints: [
					{
						provider_name: "Fireworks",
						tag: "fireworks",
						quantization: "unknown",
						model_id: "deepseek/deepseek-v4-flash-0731",
						name: "Fireworks | deepseek/deepseek-v4-flash-20260731",
						supported_parameters: [
							"max_tokens",
							"reasoning",
							"response_format",
							"structured_outputs",
						],
						pricing: {
							prompt: "0.00000022",
							completion: "0.00000066",
							input_cache_read: "0.000000007",
						},
					},
				],
			},
		};
		const zdrEndpoint = {
			provider_name: "Fireworks",
			tag: "fireworks",
			model_id: "deepseek/deepseek-v4-flash-0731",
			name: "Fireworks | deepseek/deepseek-v4-flash-20260731",
		};
		const fetchWithZdr = async (url: string | URL | Request): Promise<Response> => {
			const target = String(url);
			const response = new Response(
				JSON.stringify(
					target === ROOT_EVAL_LIVE_PRICING_SOURCE ? pricingEnvelope : { data: [zdrEndpoint] },
				),
				{ status: 200 },
			);
			Object.defineProperty(response, "url", { value: target });
			return response;
		};
		await expect(
			readRootEvalLivePricing({ fetchImpl: fetchWithZdr as typeof fetch, nowMs: 123 }),
		).resolves.toMatchObject({
			providerName: "Fireworks",
			providerRef: "fireworks",
			zeroDataRetention: true,
			promptTraining: false,
			zdrSourceUrl: ROOT_EVAL_LIVE_ZDR_SOURCE,
		});
		const fetchWithoutZdr = async (url: string | URL | Request): Promise<Response> => {
			const target = String(url);
			const response = new Response(
				JSON.stringify(target === ROOT_EVAL_LIVE_PRICING_SOURCE ? pricingEnvelope : { data: [] }),
				{ status: 200 },
			);
			Object.defineProperty(response, "url", { value: target });
			return response;
		};
		await expect(
			readRootEvalLivePricing({ fetchImpl: fetchWithoutZdr as typeof fetch, nowMs: 123 }),
		).rejects.toThrow(/not uniquely ZDR-qualified/u);
	});

	it("bounds external response bodies while streaming", async () => {
		let declaredOversizeCancelled = false;
		const declaredOversize = new Response(
			new ReadableStream<Uint8Array>({
				cancel() {
					declaredOversizeCancelled = true;
				},
			}),
			{ headers: { "content-length": "1025" } },
		);
		await expect(
			readRootEvalBoundedResponseBytes(declaredOversize, 1024, "test response"),
		).rejects.toThrow(/content-length bound/u);
		expect(declaredOversizeCancelled).toBe(true);
		const response = new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array(700));
					controller.enqueue(new Uint8Array(700));
					controller.close();
				},
			}),
		);
		await expect(readRootEvalBoundedResponseBytes(response, 1024, "test response")).rejects.toThrow(
			/streaming byte bound/u,
		);
	});

	it("rejects duplicate keys in every external JSON authority", async () => {
		const exactEndpoint = {
			provider_name: "Fireworks",
			tag: "fireworks",
			quantization: "unknown",
			model_id: "deepseek/deepseek-v4-flash-0731",
			name: "Fireworks | deepseek/deepseek-v4-flash-20260731",
			supported_parameters: ["max_tokens", "reasoning", "response_format", "structured_outputs"],
			pricing: {
				prompt: "0.00000022",
				completion: "0.00000066",
				input_cache_read: "0.000000007",
			},
		};
		const exactPricing = JSON.stringify({
			data: { id: "deepseek/deepseek-v4-flash-0731", endpoints: [exactEndpoint] },
		});
		const exactZdr = JSON.stringify({ data: [exactEndpoint] });
		const responseAt = (target: string, body: string): Response => {
			const response = new Response(body, { status: 200 });
			Object.defineProperty(response, "url", { value: target });
			return response;
		};
		await expect(
			readRootEvalLivePricing({
				nowMs: 1,
				fetchImpl: (async (url: string | URL | Request) => {
					const target = String(url);
					return responseAt(
						target,
						exactPricing.replace(
							'"id":"deepseek/deepseek-v4-flash-0731"',
							'"id":"other","id":"deepseek/deepseek-v4-flash-0731"',
						),
					);
				}) as typeof fetch,
			}),
		).rejects.toThrow(/unique-key UTF-8 JSON/u);
		await expect(
			readRootEvalLivePricing({
				nowMs: 1,
				fetchImpl: (async (url: string | URL | Request) => {
					const target = String(url);
					return responseAt(
						target,
						target === ROOT_EVAL_LIVE_PRICING_SOURCE
							? exactPricing
							: exactZdr.replace('"data":', '"data":[],"data":'),
					);
				}) as typeof fetch,
			}),
		).rejects.toThrow(/unique-key UTF-8 JSON/u);
		const credential = parseRootEvalLiveCredential(
			new TextEncoder().encode("OPENROUTER_API_KEY=sk-or-v1-a44-middle-credential-e06\n"),
		);
		const receipt = precredentialGateReceipt(0);
		expect(() =>
			admitRootEvalLiveZeroByok({
				credential,
				precredentialGateReceipt: receipt,
				nowMs: 1,
				bytes: zeroByokArtifactBytes(1, receipt.receiptDigest, true),
			}),
		).toThrow(/unique-key UTF-8 JSON/u);
		await expect(
			readRootEvalLiveCurrentKey({
				credential,
				fetchImpl: (async () =>
					new Response(
						'{"data":{"limit":32,"limit_remaining":7,"usage":24,"usage":25,"limit_reset":null,"is_management_key":false}}',
						{ status: 200 },
					)) as typeof fetch,
			}),
		).rejects.toThrow(/unique-key UTF-8 JSON/u);
	});

	it("parses exactly one bounded structured proposal and accounts conservatively", () => {
		const parsed = parseRootEvalLiveProviderResponse({
			status: 200,
			bytes: providerBytes(),
			retryAfter: null,
			pricing,
			reservationMicrousd: 200_000,
		});
		expect(parsed.disposition).toBe("tool");
		expect(parsed.reason).toBe("tool-proposed");
		expect(parsed.costMicrousd).toBe(265);
		expect(parsed.pricingRoundingAllowanceMicrousd).toBe(1);
		expect(parsed.tool).toEqual({
			path: ROOT_EVAL_LIVE_WRITABLE_PATH,
			oldText: ROOT_EVAL_LIVE_BUGGY_REPLACEMENT,
			newText: ROOT_EVAL_LIVE_CORRECT_REPLACEMENT,
		});
		expect(
			parseRootEvalLiveProviderResponse({
				status: 429,
				bytes: new TextEncoder().encode("{}"),
				retryAfter: "61",
				pricing,
				reservationMicrousd: 200_000,
			}),
		).toMatchObject({ disposition: "retryable", retryAfterMs: 61_000, costMicrousd: 200_000 });
		expect(
			parseRootEvalLiveProviderResponse({
				status: 429,
				bytes: providerBytes(),
				retryAfter: "61",
				pricing,
				reservationMicrousd: 100,
			}),
		).toMatchObject({
			disposition: "retryable",
			costEvidence: "provider-reported",
			costMicrousd: 265,
		});
		expect(
			parseRootEvalLiveProviderResponse({
				status: 429,
				bytes: new TextEncoder().encode('{"usage":{"cost":0.000265}}'),
				retryAfter: "61",
				pricing,
				reservationMicrousd: 100,
			}),
		).toMatchObject({
			disposition: "retryable",
			costEvidence: "provider-reported",
			costMicrousd: 265,
		});
		const incompleteUsage = JSON.parse(new TextDecoder().decode(providerBytes())) as Record<
			string,
			unknown
		>;
		incompleteUsage.usage = { cost: 0.000265 };
		try {
			parseRootEvalLiveProviderResponse({
				status: 200,
				bytes: new TextEncoder().encode(JSON.stringify(incompleteUsage)),
				retryAfter: null,
				pricing,
				reservationMicrousd: 100,
			});
			throw new TypeError("incomplete usage unexpectedly passed");
		} catch (error) {
			expect(error).toMatchObject({
				reason: "response-usage-invalid",
				costMicrousd: 265,
				costEvidence: "provider-reported",
			});
		}
		for (const [retryAfter, expectedMs] of [
			[null, 60_000],
			["malformed", 60_000],
			["1", 60_000],
			["121", 120_000],
			["Wed, 21 Oct 2015 07:28:00 GMT", 60_000],
		] as const)
			expect(
				parseRootEvalLiveProviderResponse({
					status: 429,
					bytes: new TextEncoder().encode("{}"),
					retryAfter,
					pricing,
					reservationMicrousd: 200_000,
				}),
				retryAfter ?? "missing Retry-After",
			).toMatchObject({ disposition: "retryable", retryAfterMs: expectedMs });
		expect(
			parseRootEvalLiveProviderResponse({
				status: 503,
				bytes: new TextEncoder().encode("{}"),
				retryAfter: "5",
				pricing,
				reservationMicrousd: 200_000,
			}),
		).toMatchObject({ disposition: "failed", retryAfterMs: 0, costMicrousd: 200_000 });
		const documentedUsage = JSON.parse(new TextDecoder().decode(providerBytes())) as Record<
			string,
			unknown
		>;
		const usage = { ...(documentedUsage.usage as Record<string, unknown>) };
		delete usage.prompt_tokens_details;
		usage.cost = 0.000286;
		const withoutCacheDetails = parseRootEvalLiveProviderResponse({
			status: 200,
			bytes: new TextEncoder().encode(JSON.stringify({ ...documentedUsage, usage })),
			retryAfter: null,
			pricing,
			reservationMicrousd: 200_000,
		});
		expect(withoutCacheDetails).toMatchObject({
			disposition: "tool",
			reason: "tool-proposed",
			costMicrousd: 286,
			pricingRoundingAllowanceMicrousd: 0,
		});
		const oneMicrousd = JSON.parse(new TextDecoder().decode(providerBytes())) as Record<
			string,
			unknown
		>;
		oneMicrousd.usage = {
			prompt_tokens: 2,
			completion_tokens: 1,
			total_tokens: 3,
			cost: 0.000000887,
			prompt_tokens_details: { cached_tokens: 1 },
		};
		expect(
			parseRootEvalLiveProviderResponse({
				status: 200,
				bytes: new TextEncoder().encode(JSON.stringify(oneMicrousd)),
				retryAfter: null,
				pricing,
				reservationMicrousd: 200_000,
			}),
		).toMatchObject({
			costMicrousd: 1,
			pricingRoundingAllowanceMicrousd: 1,
		});
	});

	it("classifies malformed provider responses with closed material-free reasons", () => {
		const providerText = new TextDecoder().decode(providerBytes());
		const base = JSON.parse(providerText) as Record<string, unknown>;
		const reasonFor = (value: unknown | Uint8Array): string => {
			const bytes =
				value instanceof Uint8Array ? value : new TextEncoder().encode(JSON.stringify(value));
			try {
				parseRootEvalLiveProviderResponse({
					status: 200,
					bytes,
					retryAfter: null,
					pricing,
					reservationMicrousd: 200_000,
				});
				return "not-rejected";
			} catch (error) {
				return String((error as { readonly reason?: unknown }).reason);
			}
		};
		const cases = [
			["response-bounds-invalid", new Uint8Array(2 * 1_048_576 + 1)],
			["response-json-invalid", new TextEncoder().encode("{")],
			[
				"response-json-invalid",
				new TextEncoder().encode(
					providerText.replace(
						'"provider":"Fireworks"',
						'"provider":"Other","provider":"Fireworks"',
					),
				),
			],
			[
				"response-json-invalid",
				new TextEncoder().encode(providerText.replace('"usage":{', '"usage":null,"usage":{')),
			],
			[
				"response-json-invalid",
				new TextEncoder().encode(providerText.replace('"choices":[', '"choices":[],"choices":[')),
			],
			["response-route-invalid", { ...base, provider: "Other" }],
			[
				"response-usage-invalid",
				{ ...base, usage: { ...(base.usage as Record<string, unknown>), total_tokens: 0 } },
			],
			[
				"response-usage-invalid",
				{
					...base,
					usage: Object.fromEntries(
						Object.entries(base.usage as Record<string, unknown>).filter(([key]) => key !== "cost"),
					),
				},
			],
			[
				"response-usage-invalid",
				{
					...base,
					usage: { ...(base.usage as Record<string, unknown>), cost: 0.000001 },
				},
			],
			[
				"response-usage-invalid",
				{
					...base,
					usage: {
						prompt_tokens: Number.MAX_SAFE_INTEGER,
						completion_tokens: 0,
						total_tokens: Number.MAX_SAFE_INTEGER,
					},
				},
			],
			["response-choice-invalid", { ...base, choices: [] }],
			[
				"response-output-truncated",
				{
					...base,
					choices: [
						{
							...(base.choices as readonly Record<string, unknown>[])[0],
							finish_reason: "length",
						},
					],
				},
			],
			[
				"response-proposal-invalid",
				{
					...base,
					choices: [
						{
							...(base.choices as readonly Record<string, unknown>[])[0],
							native_finish_reason: "content_filter",
						},
					],
				},
			],
			["response-proposal-missing", { ...base, choices: [{ message: { role: "assistant" } }] }],
			[
				"response-proposal-legacy-shape",
				{
					...base,
					choices: [
						{
							message: {
								content: "{}",
								tool_calls: [],
							},
						},
					],
				},
			],
			[
				"response-proposal-legacy-shape",
				{
					...base,
					choices: [
						{
							index: 0,
							finish_reason: "stop",
							native_finish_reason: "stop",
							message: {
								role: "assistant",
								content: JSON.stringify({
									path: ROOT_EVAL_LIVE_WRITABLE_PATH,
									oldText: "x",
									newText: "y",
								}),
								function_call: { name: "replace_exact", arguments: "{}" },
							},
						},
					],
				},
			],
			[
				"not-rejected",
				{
					...base,
					choices: [
						{
							index: 0,
							finish_reason: "stop",
							native_finish_reason: null,
							message: {
								role: "assistant",
								content: JSON.stringify({
									path: ROOT_EVAL_LIVE_WRITABLE_PATH,
									oldText: "x",
									newText: "y",
								}),
								tool_calls: null,
								function_call: null,
								refusal: null,
							},
						},
					],
				},
			],
			[
				"response-proposal-invalid",
				{
					...base,
					choices: [{ message: { content: "{" } }],
				},
			],
			[
				"response-proposal-invalid",
				{
					...base,
					choices: [
						{
							index: 0,
							finish_reason: "stop",
							native_finish_reason: "stop",
							message: {
								role: "assistant",
								content: `{"path":"${ROOT_EVAL_LIVE_WRITABLE_PATH}","path":"wrong","oldText":"x","newText":"y"}`,
							},
						},
					],
				},
			],
			[
				"response-proposal-invalid",
				{
					...base,
					choices: [
						{ message: { content: JSON.stringify({ path: ROOT_EVAL_LIVE_WRITABLE_PATH }) } },
					],
				},
			],
			[
				"response-proposal-invalid",
				{
					...base,
					choices: [
						{
							message: {
								content: JSON.stringify({
									path: ROOT_EVAL_LIVE_WRITABLE_PATH,
									oldText: "x",
									newText: "y",
									extra: true,
								}),
							},
						},
					],
				},
			],
			[
				"response-proposal-arguments-invalid",
				{
					...base,
					choices: [
						{
							message: {
								content: JSON.stringify({ path: "wrong", oldText: "x", newText: "y" }),
							},
						},
					],
				},
			],
			[
				"response-proposal-arguments-invalid",
				{
					...base,
					choices: [
						{
							index: 0,
							finish_reason: "stop",
							native_finish_reason: "stop",
							message: {
								role: "assistant",
								content: JSON.stringify({
									path: ROOT_EVAL_LIVE_WRITABLE_PATH,
									oldText: "\ud800",
									newText: "y",
								}),
							},
						},
					],
				},
			],
		] as const;
		for (const [expected, input] of cases) expect(reasonFor(input), expected).toBe(expected);

		const legacyToolCalls = {
			...base,
			choices: [
				{
					message: {
						content: null,
						tool_calls: [{ function: { name: "replace_exact", arguments: "{}" } }],
					},
				},
			],
		};
		try {
			parseRootEvalLiveProviderResponse({
				status: 200,
				bytes: new TextEncoder().encode(JSON.stringify(legacyToolCalls)),
				retryAfter: null,
				pricing,
				reservationMicrousd: 200_000,
			});
			throw new Error("legacy tool calls were not rejected");
		} catch (error) {
			expect(error).toMatchObject({
				reason: "response-proposal-legacy-shape",
				costMicrousd: 265,
			});
		}
	});

	it("retains every success invariant as a stable material-free rejection code", () => {
		const base = liveEvidenceInput();
		const workItemCount = ROOT_EVAL_LIVE_REPLICATE_COUNT * arms.length;
		expect(evaluateRootEvalLiveAdmission(base).admissionReport).toEqual({
			status: "admitted",
			violationCodes: [],
			rejectedGraphSummary: null,
		});
		const ids = base.graphResult?.executedAdmissionIds ?? [];
		const cases: ReadonlyArray<
			readonly [(typeof ROOT_EVAL_LIVE_SUCCESS_VIOLATION_CODES)[number], RootEvalLiveEvidenceInput]
		> = [
			["success.graph-shape-invalid", withGraphResult(base, { peakConcurrentEffects: -1 })],
			["success.current-key-before-missing", { ...base, currentKeyBefore: null }],
			["success.failure-present", { ...base, failure: new Error("private-marker") }],
			["success.cleanup-incomplete", { ...base, cleanupDisposition: "failed" }],
			["success.campaign-ref-mismatch", withGraphResult(base, {}, { campaignRef: "wrong" })],
			["success.replicate-count-mismatch", withGraphResult(base, {}, { replicateCount: 4 })],
			[
				"success.completed-work-items-mismatch",
				withGraphResult(base, {}, { completedWorkItems: workItemCount - 1 }),
			],
			[
				"success.finding-mismatch",
				withGraphResult(base, {}, { finding: "no-positive-differential" }),
			],
			[
				"success.pass-counts-invalid",
				withGraphResult(
					base,
					{},
					{
						passCounts: {
							...base.graphResult!.finding.passCounts,
							"relevant-applied": ROOT_EVAL_LIVE_REPLICATE_COUNT + 1,
						},
					},
				),
			],
			["success.observations-empty", withGraphResult(base, { observations: [] })],
			[
				"success.terminal-observation-missing",
				withTerminalObservation(base, { finding: "pending" }),
			],
			[
				"success.terminal-finding-mismatch",
				withTerminalObservation(base, { finding: "no-positive-differential" }),
			],
			[
				"success.terminal-stopping-reason-mismatch",
				withTerminalObservation(base, { stoppingReason: "budget-exhausted" }),
			],
			[
				"success.terminal-observation-order-invalid",
				withGraphResult(base, {
					observations: [
						...base.graphResult!.observations,
						withTerminalObservation(base, { finding: "pending" }).graphResult!.observations.at(-1)!,
					],
				}),
			],
			[
				"success.terminal-observation-state-mismatch",
				withTerminalObservation(base, {
					activeProviderEffects: 1,
					activeAdmittedEffects: 1,
					admittedAttempts: workItemCount + 1,
					providerCapacity: {
						kind: "eval-provider-capacity-state",
						mode: "initial-parallel",
						initialMaxConcurrentEffects: 2,
						maxConcurrentEffects: 2,
						activeEffects: 1,
						proposalCount: workItemCount + 1,
						pendingProposalCount: 0,
						pendingFirstAttemptProposalCount: 0,
						pendingRetryProposalCount: 0,
						retryProposalCount: 0,
						admittedProposalCount: workItemCount + 1,
						admittedRetryProposalCount: 0,
						settledProposalCount: workItemCount,
						settledRetryProposalCount: 0,
						rejectedProposalCount: 0,
						rejectedRetryProposalCount: 0,
						cooldownOutstandingReadinessCount: 0,
						rateLimitFeedbackCount: 0,
					},
				}),
			],
			["success.peak-concurrency-below-one", withGraphResult(base, { peakConcurrentEffects: 0 })],
			[
				"success.peak-provider-concurrency-above-two",
				withGraphResult(base, { peakConcurrentEffects: 3 }),
			],
			[
				"success.admission-count-below-thirty",
				withGraphResult(base, { executedAdmissionIds: ids.slice(0, -1) }),
			],
			[
				"success.admission-identities-duplicate",
				withGraphResult(base, { executedAdmissionIds: [...ids.slice(0, -1), ids[0]!] }),
			],
			[
				"success.finding-admitted-attempts-mismatch",
				withGraphResult(base, {}, { admittedAttempts: workItemCount - 1 }),
			],
			[
				"success.provider-outcome-reason-count-mismatch",
				withGraphResult(
					base,
					{},
					{
						providerOutcomeReasonCounts: {
							...providerOutcomeReasonCounts,
							"tool-proposed": workItemCount - 1,
						},
					},
				),
			],
			[
				"success.accounted-budget-above-cap",
				withGraphResult(base, {}, { accountedUpperBoundMicrousd: 6_000_001 }),
			],
			["success.provider-call-count-mismatch", { ...base, providerCalls: workItemCount - 1 }],
		];
		expect(cases.map(([code]) => code)).toEqual(ROOT_EVAL_LIVE_SUCCESS_VIOLATION_CODES);
		for (const [code, input] of cases) {
			const evaluation = evaluateRootEvalLiveAdmission(input);
			const report = evaluation.admissionReport;
			expect(report.status, code).toBe("rejected");
			expect(report.violationCodes, code).toContain(code);
			const indexes = report.violationCodes.map((item) =>
				ROOT_EVAL_LIVE_SUCCESS_VIOLATION_CODES.indexOf(item),
			);
			expect(indexes, code).toEqual([...indexes].sort((left, right) => left - right));
			expect(JSON.stringify(report), code).not.toMatch(
				/private-marker|authorization|bearer|admission-0/iu,
			);
			const callerDispositionOnly = [
				"success.current-key-before-missing",
				"success.failure-present",
				"success.cleanup-incomplete",
				"success.provider-call-count-mismatch",
			].includes(code);
			expect(evaluation.projectedGraph !== null, code).toBe(callerDispositionOnly);
		}
	});

	it("admits only the closed source-and-target Work Item admission identity space", () => {
		const base = liveEvidenceInput();
		const targetIds = base.graphResult?.executedAdmissionIds ?? [];
		const withSource = withGraphResult(base, {
			executedAdmissionIds: [sourceAdmissionId(1), ...targetIds.slice(1)],
		});
		expect(evaluateRootEvalLiveAdmission(withSource).admissionReport).toEqual({
			status: "admitted",
			violationCodes: [],
			rejectedGraphSummary: null,
		});

		for (const invalidId of [
			sourceAdmissionId(1).replace("/attempt-1/", "/attempt-3/"),
			sourceAdmissionId(1).replace(ROOT_EVAL_LIVE_TASK_SET_REF, "unbound-task-set"),
		]) {
			const invalid = withGraphResult(base, {
				executedAdmissionIds: [invalidId, ...targetIds.slice(1)],
			});
			expect(evaluateRootEvalLiveAdmission(invalid).admissionReport).toEqual({
				status: "rejected",
				violationCodes: ["success.graph-shape-invalid"],
				rejectedGraphSummary: null,
			});
		}
	});

	it("fails closed on verification-diagnostics shape, conservation, binding, and progress drift", () => {
		const base = liveEvidenceInput();
		const baseDiagnostics = base.graphResult!.finding.verificationDiagnostics;
		const missingStage = structuredClone(baseDiagnostics) as Record<string, unknown>;
		delete (missingStage.stageCounts as Record<string, Record<string, unknown>>).cold
			.cleanupCompleted;
		expect(
			evaluateRootEvalLiveAdmission(
				withGraphResult(base, {}, { verificationDiagnostics: missingStage as never }),
			).admissionReport,
		).toMatchObject({ status: "rejected", violationCodes: ["success.graph-shape-invalid"] });

		const reasonDrift = structuredClone(baseDiagnostics);
		reasonDrift.terminalReasonCounts.cold["no-change"] = 4;
		const reasonDriftInput = withTerminalObservation(
			withGraphResult(base, {}, { verificationDiagnostics: reasonDrift }),
			{ verificationDiagnostics: reasonDrift },
		);
		expect(evaluateRootEvalLiveAdmission(reasonDriftInput).admissionReport).toMatchObject({
			status: "rejected",
			violationCodes: ["success.graph-shape-invalid"],
		});

		const unreachableReason = structuredClone(baseDiagnostics);
		unreachableReason.stageCounts.cold.exactToolAdmitted = 0;
		unreachableReason.stageCounts.cold.scopedChange = 0;
		unreachableReason.stageCounts.cold.publicSemanticPassed = 0;
		unreachableReason.stageCounts.cold.hiddenVerifierPassed = 0;
		unreachableReason.terminalReasonCounts.cold["no-change"] = 0;
		unreachableReason.terminalReasonCounts.cold["hidden-verifier-failed"] = 5;
		const unreachableReasonInput = withTerminalObservation(
			withGraphResult(base, {}, { verificationDiagnostics: unreachableReason }),
			{ verificationDiagnostics: unreachableReason },
		);
		expect(evaluateRootEvalLiveAdmission(unreachableReasonInput).admissionReport).toMatchObject({
			status: "rejected",
			violationCodes: ["success.graph-shape-invalid"],
		});

		const impossibleCleanupObscuring = structuredClone(baseDiagnostics);
		impossibleCleanupObscuring.stageCounts.cold.exactToolAdmitted = 4;
		impossibleCleanupObscuring.stageCounts.cold.scopedChange = 1;
		impossibleCleanupObscuring.stageCounts.cold.publicSemanticPassed = 0;
		impossibleCleanupObscuring.stageCounts.cold.hiddenVerifierPassed = 0;
		impossibleCleanupObscuring.stageCounts.cold.cleanupCompleted = 4;
		impossibleCleanupObscuring.terminalReasonCounts.cold["cleanup-incomplete"] = 1;
		impossibleCleanupObscuring.terminalReasonCounts.cold["exact-tool-failed"] = 4;
		impossibleCleanupObscuring.terminalReasonCounts.cold["no-change"] = 0;
		const impossibleCleanupInput = withTerminalObservation(
			withGraphResult(base, {}, { verificationDiagnostics: impossibleCleanupObscuring }),
			{ verificationDiagnostics: impossibleCleanupObscuring },
		);
		expect(evaluateRootEvalLiveAdmission(impossibleCleanupInput).admissionReport).toMatchObject({
			status: "rejected",
			violationCodes: ["success.graph-shape-invalid"],
		});

		const bindingDrift = structuredClone(baseDiagnostics);
		bindingDrift.stageCounts["relevant-applied"].hiddenVerifierPassed = 0;
		bindingDrift.stageCounts["relevant-applied"].passed = 0;
		bindingDrift.terminalReasonCounts["relevant-applied"].passed = 0;
		bindingDrift.terminalReasonCounts["relevant-applied"]["hidden-verifier-failed"] =
			ROOT_EVAL_LIVE_REPLICATE_COUNT;
		const bindingDriftInput = withTerminalObservation(
			withGraphResult(base, {}, { verificationDiagnostics: bindingDrift }),
			{ verificationDiagnostics: bindingDrift },
		);
		expect(evaluateRootEvalLiveAdmission(bindingDriftInput).admissionReport).toMatchObject({
			status: "rejected",
			violationCodes: ["success.pass-counts-invalid", "success.terminal-observation-order-invalid"],
		});

		const terminal = base.graphResult!.observations.at(-1)!;
		for (const invalidSequence of [
			[terminal],
			base.graphResult!.observations.slice(2),
			[
				base.graphResult!.observations[0]!,
				base.graphResult!.observations[2]!,
				...base.graphResult!.observations.slice(3),
			],
		])
			expect(
				evaluateRootEvalLiveAdmission(withGraphResult(base, { observations: invalidSequence }))
					.admissionReport,
			).toMatchObject({
				status: "rejected",
				violationCodes: expect.arrayContaining(["success.terminal-observation-order-invalid"]),
			});

		const terminalValue = terminal.msg[1] as unknown as Record<string, unknown>;
		const pendingValue = {
			...terminalValue,
			finding: "pending",
			evaluableReplicates: null,
			excludedTechnicalReplicates: [],
			sourceTechnicalExcludedReplicates: [],
			matchedRelevantOverColdWins: null,
			observedBilledMicrousd: null,
			billingObservationCount: 0,
			billingStableIntervals: 0,
			reconciledBilledMicrousd: null,
			billingDisposition: "pending",
		};
		const regressed = structuredClone(baseDiagnostics);
		regressed.stageCounts.cold.completedWorkItems = 0;
		regressed.stageCounts.cold.exactToolAdmitted = 0;
		regressed.stageCounts.cold.cleanupCompleted = 0;
		regressed.terminalReasonCounts.cold["no-change"] = 0;
		regressed.completedWorkItems =
			baseDiagnostics.completedWorkItems - ROOT_EVAL_LIVE_REPLICATE_COUNT;
		const progressDrift = withGraphResult(base, {
			observations: [
				{ ...terminal, seq: 1, msg: ["DATA", pendingValue] as never },
				{
					...terminal,
					seq: 2,
					msg: ["DATA", { ...pendingValue, verificationDiagnostics: regressed }] as never,
				},
				{ ...terminal, seq: 3 },
			],
		});
		expect(evaluateRootEvalLiveAdmission(progressDrift).admissionReport).toMatchObject({
			status: "rejected",
			violationCodes: ["success.terminal-observation-order-invalid"],
		});

		const higherScopedProgress = structuredClone(baseDiagnostics);
		higherScopedProgress.stageCounts.cold.scopedChange = 1;
		higherScopedProgress.terminalReasonCounts.cold["no-change"] =
			ROOT_EVAL_LIVE_REPLICATE_COUNT - 1;
		higherScopedProgress.terminalReasonCounts.cold["public-semantic-failed"] = 1;
		const equalCompletionStageRegression = withGraphResult(base, {
			observations: [
				{
					...terminal,
					seq: 1,
					msg: [
						"DATA",
						{
							...pendingValue,
							verificationDiagnostics: higherScopedProgress,
						},
					] as never,
				},
				{ ...terminal, seq: 2 },
			],
		});
		expect(
			evaluateRootEvalLiveAdmission(equalCompletionStageRegression).admissionReport,
		).toMatchObject({
			status: "rejected",
			violationCodes: ["success.terminal-observation-order-invalid"],
		});

		const priorReasonProgress = structuredClone(baseDiagnostics);
		priorReasonProgress.terminalReasonCounts.cold["no-change"] = ROOT_EVAL_LIVE_REPLICATE_COUNT - 1;
		priorReasonProgress.terminalReasonCounts.cold["exact-tool-failed"] = 1;
		const equalCompletionReasonRegression = withGraphResult(base, {
			observations: [
				{
					...terminal,
					seq: 1,
					msg: [
						"DATA",
						{
							...pendingValue,
							verificationDiagnostics: priorReasonProgress,
						},
					] as never,
				},
				{ ...terminal, seq: 2 },
			],
		});
		expect(
			evaluateRootEvalLiveAdmission(equalCompletionReasonRegression).admissionReport,
		).toMatchObject({
			status: "rejected",
			violationCodes: ["success.terminal-observation-order-invalid"],
		});

		const duplicateProgress = withGraphResult(base, {
			observations: [
				{ ...terminal, seq: 1, msg: ["DATA", pendingValue] as never },
				{ ...terminal, seq: 2, msg: ["DATA", pendingValue] as never },
				{ ...terminal, seq: 3 },
			],
		});
		expect(evaluateRootEvalLiveAdmission(duplicateProgress).admissionReport).toMatchObject({
			status: "rejected",
			violationCodes: ["success.terminal-observation-order-invalid"],
		});

		for (const regressedCampaign of [
			[
				{ ...pendingValue, replicate: 1, completedArms: 6 },
				{ ...pendingValue, replicate: 1, completedArms: 5 },
			],
		] as const) {
			const drift = withGraphResult(base, {
				observations: [
					{ ...terminal, seq: 1, msg: ["DATA", regressedCampaign[0]] as never },
					{ ...terminal, seq: 2, msg: ["DATA", regressedCampaign[1]] as never },
					{ ...terminal, seq: 3 },
				],
			});
			expect(evaluateRootEvalLiveAdmission(drift).admissionReport).toMatchObject({
				status: "rejected",
				violationCodes: ["success.terminal-observation-order-invalid"],
			});
		}

		for (const impossibleIntermediate of [
			{ ...pendingValue, accountedUpperBoundMicrousd: 101 },
			{
				...pendingValue,
				providerOutcomeReasonCounts: { ...providerOutcomeReasonCounts, "tool-proposed": 31 },
			},
		]) {
			const drift = withGraphResult(base, {
				observations: [
					{ ...terminal, seq: 1, msg: ["DATA", impossibleIntermediate] as never },
					{ ...terminal, seq: 2 },
				],
			});
			expect(evaluateRootEvalLiveAdmission(drift).admissionReport).toMatchObject({
				status: "rejected",
				violationCodes: ["success.graph-shape-invalid"],
			});
		}
	});

	it("admits semantic evidence when the key-ledger audit is rejected or post-campaign delta is missing", () => {
		const rejectedAudit = withRejectedBillingTerminal(liveEvidenceInput());
		for (const candidate of [rejectedAudit, { ...rejectedAudit, currentKeyAfter: null }]) {
			const evaluation = evaluateRootEvalLiveAdmission(candidate);
			expect(evaluation.admissionReport).toEqual({
				status: "admitted",
				violationCodes: [],
				rejectedGraphSummary: null,
			});
			expect(evaluation.projectedGraph?.finding).toMatchObject({
				finding: "positive-differential",
				stoppingReason: "campaign-complete",
				billingDisposition: "rejected",
			});
		}

		const allZero = {
			cold: 0,
			"relevant-applied": 0,
			"proposal-only": 0,
			"admission-rejected": 0,
			"irrelevant-applied": 0,
			"wrong-scope-applied": 0,
		};
		const base = liveEvidenceInput();
		const baseDiagnostics = base.graphResult!.finding.verificationDiagnostics;
		const negativeDiagnostics = {
			...baseDiagnostics,
			stageCounts: {
				...baseDiagnostics.stageCounts,
				"relevant-applied": {
					...baseDiagnostics.stageCounts["relevant-applied"],
					hiddenVerifierPassed: 0,
					passed: 0,
				},
			},
			terminalReasonCounts: {
				...baseDiagnostics.terminalReasonCounts,
				"relevant-applied": {
					...baseDiagnostics.terminalReasonCounts["relevant-applied"],
					"hidden-verifier-failed": ROOT_EVAL_LIVE_REPLICATE_COUNT,
					passed: 0,
				},
			},
		};
		const negativeObservations = base.graphResult!.observations.map((event, index, events) => {
			const value = event.msg[1] as unknown as Record<string, unknown>;
			const diagnostics = structuredClone(value.verificationDiagnostics) as typeof baseDiagnostics;
			const relevantCompleted = diagnostics.stageCounts["relevant-applied"].completedWorkItems;
			diagnostics.stageCounts["relevant-applied"].hiddenVerifierPassed = 0;
			diagnostics.stageCounts["relevant-applied"].passed = 0;
			diagnostics.terminalReasonCounts["relevant-applied"]["hidden-verifier-failed"] =
				relevantCompleted;
			diagnostics.terminalReasonCounts["relevant-applied"].passed = 0;
			return {
				...event,
				msg: [
					"DATA",
					{
						...value,
						verificationDiagnostics: diagnostics,
						finding: index === events.length - 1 ? "no-positive-differential" : "pending",
						developmentQualification: value.developmentQualification,
					},
				] as never,
			};
		});
		const negative = withRejectedBillingTerminal(
			withGraphResult(
				base,
				{ observations: negativeObservations },
				{
					passCounts: allZero,
					verificationDiagnostics: negativeDiagnostics,
					finding: "no-positive-differential",
				},
			),
		);
		const evidence = constructRootEvalLiveEvidence(negative);
		expect(evidence).toMatchObject({
			disposition: "success",
			efficacyClaim: "none",
			causalAttribution: "undetermined",
			admissionReport: { status: "admitted", violationCodes: [] },
			graphResult: {
				finding: {
					finding: "no-positive-differential",
					billingDisposition: "rejected",
				},
			},
		});
	});

	it("fails closed with stable authority-envelope violation codes", () => {
		const base = liveEvidenceInput();
		const authorityCases: ReadonlyArray<
			readonly [
				(typeof ROOT_EVAL_LIVE_AUTHORITY_VIOLATION_CODES)[number],
				RootEvalLiveEvidenceInput,
			]
		> = [
			[
				"authority.claim-shape-invalid",
				{ ...base, claim: { ...base.claim, extra: "forbidden" } as never },
			],
			["authority.claim-digest-invalid", { ...base, claim: { ...base.claim, claimDigest: "bad" } }],
			[
				"authority.pricing-shape-invalid",
				{ ...base, pricing: { ...base.pricing, extra: "forbidden" } as never },
			],
			[
				"authority.pricing-digest-invalid",
				{ ...base, pricing: { ...base.pricing, observationDigest: "bad" } },
			],
			[
				"authority.pricing-semantics-mismatch",
				withRehashedPricing(base, { providerName: "forged-provider" }),
			],
			[
				"authority.zero-byok-shape-invalid",
				{ ...base, zeroByok: { ...base.zeroByok, extra: "forbidden" } as never },
			],
			[
				"authority.zero-byok-digest-invalid",
				{ ...base, zeroByok: { ...base.zeroByok, observationDigest: "bad" } },
			],
			[
				"authority.zero-byok-semantics-mismatch",
				withRehashedZeroByok(base, { byokCredentialCount: 1 }),
			],
			[
				"authority.current-key-before-shape-invalid",
				{ ...base, currentKeyBefore: { ...base.currentKeyBefore!, extra: "forbidden" } as never },
			],
			[
				"authority.current-key-before-digest-invalid",
				{ ...base, currentKeyBefore: { ...base.currentKeyBefore!, admissionDigest: "bad" } },
			],
			[
				"authority.current-key-before-semantics-mismatch",
				withRehashedCurrentKey(base, "before", { usageMicrousd: -1 }),
			],
			[
				"authority.current-key-after-shape-invalid",
				{ ...base, currentKeyAfter: { ...base.currentKeyAfter!, extra: "forbidden" } as never },
			],
			[
				"authority.current-key-after-digest-invalid",
				{ ...base, currentKeyAfter: { ...base.currentKeyAfter!, admissionDigest: "bad" } },
			],
			[
				"authority.current-key-after-semantics-mismatch",
				withRehashedCurrentKey(base, "after", { usageMicrousd: 25_000_100.5 }),
			],
			[
				"authority.claim-pricing-binding-mismatch",
				{ ...base, claim: { ...base.claim, pricingObservationDigest: "wrong" } },
			],
			[
				"authority.claim-zero-byok-binding-mismatch",
				{ ...base, claim: { ...base.claim, zeroByokObservationDigest: "wrong" } },
			],
			[
				"authority.claim-schema-mismatch",
				{ ...base, claim: { ...base.claim, schemaVersion: "wrong" } as never },
			],
			[
				"authority.claim-execution-mode-invalid",
				{ ...base, claim: { ...base.claim, executionMode: "network-wrapper" } as never },
			],
			[
				"authority.claim-ref-mismatch",
				{ ...base, claim: { ...base.claim, claimRef: "wrong" } as never },
			],
			[
				"authority.claim-decision-mismatch",
				{ ...base, claim: { ...base.claim, decisionRef: "wrong" } as never },
			],
			[
				"authority.claim-generation-mismatch",
				{ ...base, claim: { ...base.claim, generationRef: "wrong" } as never },
			],
			[
				"authority.claim-task-binding-mismatch",
				{ ...base, claim: { ...base.claim, taskBindingDigest: "wrong" } },
			],
			[
				"authority.claim-task-manifest-mismatch",
				{ ...base, claim: { ...base.claim, taskManifestDigest: "wrong" } },
			],
			[
				"authority.claim-campaign-cap-mismatch",
				{ ...base, claim: { ...base.claim, campaignHardCapMicrousd: 1 } as never },
			],
			[
				"authority.claim-key-limit-mismatch",
				{ ...base, claim: { ...base.claim, localEvalNoResetLimitMicrousd: 1 } as never },
			],
			[
				"authority.claim-implementation-coordinate-invalid",
				{ ...base, claim: { ...base.claim, implementationCoordinate: "wrong" } },
			],
			[
				"authority.claim-implementation-coordinate-binding-mismatch",
				withRehashedClaim(base, {
					implementationCoordinate: `worktree:${"a".repeat(40)}:${empiricalStrictJsonDigest("other-manifest")}`,
				}),
			],
			[
				"authority.claim-implementation-manifest-mismatch",
				withRehashedClaim(base, {
					implementationManifestDigest: empiricalStrictJsonDigest("other-manifest"),
				}),
			],
			[
				"authority.claim-qualification-artifact-mismatch",
				withRehashedClaim(base, {
					qualificationArtifactDigest: empiricalStrictJsonDigest("other-artifact"),
				}),
			],
			[
				"authority.claim-qualification-mismatch",
				withRehashedClaim(base, {
					qualificationDigest: empiricalStrictJsonDigest("other-qualification"),
				}),
			],
			[
				"authority.claim-credential-binding-mismatch",
				withRehashedClaim(base, {
					credentialBindingDigest: empiricalStrictJsonDigest("other-credential"),
				}),
			],
			[
				"authority.claim-current-key-before-binding-mismatch",
				withRehashedClaim(base, {
					currentKeyBeforeDigest: empiricalStrictJsonDigest("other-current-key"),
				}),
			],
			[
				"authority.claim-recovery-envelope-mismatch",
				withRehashedClaim(base, {
					recoveryEnvelope: {
						...base.claim.recoveryEnvelope,
						pricing: { ...base.claim.recoveryEnvelope.pricing, observedAtMs: 2 },
					},
				}),
			],
			[
				"authority.current-key-limit-mismatch",
				{ ...base, currentKeyBefore: { ...base.currentKeyBefore!, limitMicrousd: 1 } as never },
			],
			[
				"authority.current-key-remaining-below-cap",
				{ ...base, currentKeyBefore: { ...base.currentKeyBefore!, remainingMicrousd: 1 } },
			],
			[
				"authority.current-key-reconciliation-nonmonotonic",
				refreshedCurrentKeys({
					...base,
					currentKeyAfter: {
						...base.currentKeyAfter!,
						usageMicrousd: base.currentKeyBefore!.usageMicrousd - 1,
					},
				}),
			],
			["authority.provider-call-count-invalid", { ...base, providerCalls: -1 }],
			[
				"authority.result-and-failure-missing",
				{ ...base, graphResult: null, partialGraphObservations: [], failure: null },
			],
		];
		expect(authorityCases.map(([code]) => code)).toEqual(ROOT_EVAL_LIVE_AUTHORITY_VIOLATION_CODES);
		for (const [code, input] of authorityCases) {
			try {
				evaluateRootEvalLiveAdmission(input);
				throw new TypeError(`authority mutation ${code} was admitted`);
			} catch (error) {
				expect(error).toMatchObject({ violationCodes: expect.arrayContaining([code]) });
				expect(String(error), code).not.toMatch(/private-marker|authorization|bearer/iu);
			}
		}
	});

	it("persists a rejected candidate as current partial evidence with no raw admission identities", () => {
		const evidence = constructRootEvalLiveEvidence(
			withGraphResult(liveEvidenceInput(), { peakConcurrentEffects: 3 }),
		);
		expect(evidence).toMatchObject({
			disposition: "partial-failure",
			graphResult: null,
			efficacyClaim: "none",
			causalAttribution: "undetermined",
			admissionReport: {
				status: "rejected",
				violationCodes: ["success.peak-provider-concurrency-above-two"],
				rejectedGraphSummary: { peakConcurrentEffects: 3, executedAdmissionCount: 30 },
			},
		});
		expect(JSON.stringify(evidence)).not.toMatch(
			/admission-0|private-marker|authorization|bearer/iu,
		);
		const callerPartial = constructRootEvalLiveEvidence({
			...liveEvidenceInput(),
			currentKeyAfter: null,
			providerCalls: 29,
			failure: new Error("post-Graph caller failure"),
			cleanupDisposition: "failed",
		});
		expect(callerPartial).toMatchObject({
			disposition: "partial-failure",
			graphResult: expect.objectContaining({
				finding: expect.objectContaining({ finding: "positive-differential" }),
			}),
			efficacyClaim: "none",
			causalAttribution: "undetermined",
			admissionReport: {
				status: "rejected",
				violationCodes: [
					"success.failure-present",
					"success.cleanup-incomplete",
					"success.provider-call-count-mismatch",
				],
			},
		});
		const deadlinePartial = constructRootEvalLiveEvidence({
			...liveEvidenceInput(),
			graphResult: null,
			currentKeyAfter: null,
			providerCalls: 1,
			failure: new RootEvalCallerSettlementDeadlineExpired(5),
			cleanupDisposition: "complete",
		});
		expect(deadlinePartial).toMatchObject({
			disposition: "partial-failure",
			technicalFailureCode: "caller-settlement-deadline-expired",
			latestGraphObservation: expect.objectContaining({ path: "eval/observation" }),
		});
		const base = liveEvidenceInput();
		const spendMismatch = constructRootEvalLiveEvidence(
			refreshedCurrentKeys({
				...base,
				currentKeyAfter: {
					...base.currentKeyAfter!,
					remainingMicrousd: base.currentKeyBefore!.remainingMicrousd - 200,
					usageMicrousd: base.currentKeyBefore!.usageMicrousd + 200,
				},
			}),
		);
		expect(spendMismatch).toMatchObject({
			disposition: "success",
			graphResult: expect.objectContaining({
				finding: expect.objectContaining({ billingDisposition: "reconciled" }),
			}),
			efficacyClaim: "none",
			admissionReport: {
				status: "admitted",
				violationCodes: [],
				rejectedGraphSummary: null,
			},
		});
		const event = liveEvidenceInput().graphResult!.observations.at(-1)!;
		const forged = constructRootEvalLiveEvidence(
			withGraphResult(liveEvidenceInput(), {
				observations: [
					{
						...event,
						msg: [
							"DATA",
							{ ...(event.msg[1] as object), privateMarker: "do-not-persist" },
						] as never,
					},
				],
			}),
		);
		expect(forged.admissionReport).toEqual({
			status: "rejected",
			violationCodes: ["success.graph-shape-invalid"],
			rejectedGraphSummary: null,
		});
		expect(forged.partialGraphObservations).toEqual([]);
		expect(JSON.stringify(forged)).not.toContain("do-not-persist");
	});

	it("requires a committed D145 claim before evidence persistence", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-no-claim-"));
		const privateRoot = await realpath(temporary);
		await chmod(privateRoot, 0o700);
		try {
			const evidence = constructRootEvalLiveEvidence(liveEvidenceInput());
			await expect(persistRootEvalLiveEvidence({ privateRoot, evidence })).rejects.toThrow(
				/committed D145 claim/u,
			);
			expect(await readdir(privateRoot)).toEqual([]);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	it("requires fresh runtime-issued admissions with the full campaign balance before claim", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-d94-capability-"));
		const privateRoot = await realpath(temporary);
		await chmod(privateRoot, 0o700);
		try {
			const input = await currentClaimInput(privateRoot);
			await expect(
				acquireRootEvalLiveClaimForNoNetworkQualification({
					...input,
					pricing: { ...input.pricing },
				} as never),
			).rejects.toThrow(/pricing-admission/u);
			await expect(
				acquireRootEvalLiveClaimForNoNetworkQualification({
					...input,
					zeroByok: { ...input.zeroByok },
				} as never),
			).rejects.toThrow(/zero-byok-admission/u);
			await expect(
				acquireRootEvalLiveClaimForNoNetworkQualification({
					...input,
					currentKeyBefore: { ...input.currentKeyBefore },
				} as never),
			).rejects.toThrow(/current-key-admission/u);
			await expect(
				acquireRootEvalLiveClaimForNoNetworkQualification({
					...input,
					nowMs: input.nowMs + 3_600_001,
				}),
			).rejects.toThrow(/freshness/u);
			const staleCurrentKey = await readRootEvalLiveCurrentKey({
				credential: input.credential,
				nowMs: input.nowMs - 60_001,
				fetchImpl: (async () =>
					new Response(
						JSON.stringify({
							data: {
								limit: 32,
								limit_remaining: 7,
								usage: 25,
								limit_reset: null,
								is_management_key: false,
							},
						}),
						{ status: 200 },
					)) as typeof fetch,
			});
			await expect(
				acquireRootEvalLiveClaimForNoNetworkQualification({
					...input,
					currentKeyBefore: staleCurrentKey,
				}),
			).rejects.toThrow(/freshness/u);
			const insufficientKey = await readRootEvalLiveCurrentKey({
				credential: input.credential,
				minimumRemainingMicrousd: 0,
				fetchImpl: (async () =>
					new Response(
						JSON.stringify({
							data: {
								limit: 32,
								limit_remaining: 5.999999,
								usage: 26.000001,
								limit_reset: null,
								is_management_key: false,
							},
						}),
						{ status: 200 },
					)) as typeof fetch,
			});
			await expect(
				acquireRootEvalLiveClaimForNoNetworkQualification({
					...input,
					currentKeyBefore: insufficientKey,
				}),
			).rejects.toThrow(/current-key-admission/u);
			const otherCredential = parseRootEvalLiveCredential(
				new TextEncoder().encode("OPENROUTER_API_KEY=sk-or-v1-a44-other-middle-credential-e06\n"),
			);
			await expect(
				acquireRootEvalLiveClaim({
					...input,
					credential: otherCredential,
					nowMs: undefined,
				}),
			).rejects.toThrow(/authority-provenance|same-credential-provenance/u);
			expect(await readdir(privateRoot)).toEqual([]);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	it("rejects a synthetic D140 live claim without runtime authority provenance", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-d94-stale-d92-"));
		const privateRoot = await realpath(temporary);
		await chmod(privateRoot, 0o700);
		try {
			const input = await currentClaimInput(privateRoot);
			await expect(
				acquireRootEvalLiveClaim({
					...input,
					credential: {
						...input.credential,
						bindingRevision: "2026-08-24.d92.v1",
					} as never,
				}),
			).rejects.toThrow(/authority-provenance|credential-binding/u);
			expect(await readdir(privateRoot)).toEqual([]);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	it("commits one D140 qualification claim and persists identical canonical evidence idempotently", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-d94-claim-"));
		const privateRoot = await realpath(temporary);
		await chmod(privateRoot, 0o700);
		try {
			const claimInput = await currentClaimInput(privateRoot);
			const claimAcquisition = await acquireRootEvalLiveClaimForNoNetworkQualification(claimInput);
			expect(claimAcquisition.postCommitFailureDigest).toBeNull();
			const recovered = recoverRootEvalLiveClaimAuthority(claimAcquisition.claim);
			expect(recovered).toEqual({
				pricing: { ...claimInput.pricing },
				zeroByok: { ...claimInput.zeroByok },
				currentKeyBefore: { ...claimInput.currentKeyBefore },
			});
			expect(Object.isFrozen(recovered)).toBe(true);
			expect(Object.isFrozen(recovered.pricing)).toBe(true);
			const dispositionName = (await readdir(privateRoot)).find((name) =>
				name.endsWith("disposition.v20.json"),
			);
			if (dispositionName === undefined) throw new TypeError("D140 disposition missing");
			const dispositionText = await readFile(join(privateRoot, dispositionName), "utf8");
			expect(dispositionText).not.toContain(claimInput.credential.bearerToken);
			await expect(
				acquireRootEvalLiveClaimForNoNetworkQualification(claimInput),
			).rejects.toMatchObject({ code: "EEXIST" });
			const base = liveEvidenceInput();
			const currentKeyAfterMaterial = {
				...claimInput.currentKeyBefore,
				remainingMicrousd: claimInput.currentKeyBefore.remainingMicrousd - 100,
				usageMicrousd: claimInput.currentKeyBefore.usageMicrousd + 100,
			};
			delete (currentKeyAfterMaterial as { admissionDigest?: string }).admissionDigest;
			const currentKeyAfter = {
				...currentKeyAfterMaterial,
				admissionDigest: empiricalStrictJsonDigest(currentKeyAfterMaterial),
			};
			const evidence = constructRootEvalLiveEvidence({
				...base,
				claim: claimAcquisition.claim,
				pricing: claimInput.pricing,
				zeroByok: claimInput.zeroByok,
				currentKeyBefore: claimInput.currentKeyBefore,
				currentKeyAfter,
			});
			const { evidenceDigest: _d118Digest, ...d118Material } = evidence;
			const d116Material = {
				...d118Material,
				generationRef: "root-eval-live-2026-08-24-d116-v1" as never,
			};
			await expect(
				persistRootEvalLiveEvidence({
					privateRoot,
					evidence: {
						...d116Material,
						evidenceDigest: empiricalStrictJsonDigest(d116Material),
					},
				}),
			).rejects.toThrow(/generation/u);
			const rejected = constructRootEvalLiveEvidence({
				...base,
				claim: claimAcquisition.claim,
				pricing: claimInput.pricing,
				zeroByok: claimInput.zeroByok,
				currentKeyBefore: claimInput.currentKeyBefore,
				currentKeyAfter,
				failure: new Error("caller partial after positive Graph result"),
				cleanupDisposition: "failed",
			});
			const { evidenceDigest: _rejectedDigest, ...rejectedMaterial } = rejected;
			const forgedRejectedMaterial = {
				...rejectedMaterial,
				efficacyClaim: "transfer-task-family-positive-differential" as const,
				causalAttribution: "verified-prior-work-item-memory-transfer" as const,
			};
			await expect(
				persistRootEvalLiveEvidence({
					privateRoot,
					evidence: {
						...forgedRejectedMaterial,
						evidenceDigest: empiricalStrictJsonDigest(forgedRejectedMaterial),
					},
				}),
			).rejects.toThrow(/partial Graph conclusion relationship invalid/u);
			const first = await persistRootEvalLiveEvidence({ privateRoot, evidence });
			const second = await persistRootEvalLiveEvidence({ privateRoot, evidence });
			expect(second).toEqual(first);
			expect(first.postCommitFailureDigest).toBeNull();
			expect(await readdir(join(privateRoot, ROOT_EVAL_LIVE_GENERATION_REF))).toEqual([
				"evidence.v23.json",
			]);
			await expect(
				persistRootEvalLiveEvidence({
					privateRoot,
					evidence: { ...evidence, disposition: "partial-failure" },
				}),
			).rejects.toThrow(/evidence.*invalid|digest/u);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	it("persists success when an earlier independent observer has a prefix and different envelope sequences", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-observer-prefix-"));
		const privateRoot = await realpath(temporary);
		await chmod(privateRoot, 0o700);
		try {
			const claimInput = await currentClaimInput(privateRoot);
			const claimAcquisition = await acquireRootEvalLiveClaimForNoNetworkQualification(claimInput);
			const base = liveEvidenceInput();
			const first = base.graphResult!.observations[0]!;
			const diagnostic = [
				{ ...first, seq: 0 },
				...base.graphResult!.observations.map((event) => ({ ...event, seq: event.seq + 10_000 })),
			];
			const evidence = constructRootEvalLiveEvidence({
				...base,
				claim: claimAcquisition.claim,
				pricing: claimInput.pricing,
				zeroByok: claimInput.zeroByok,
				currentKeyBefore: claimInput.currentKeyBefore,
				partialGraphObservations: diagnostic,
			});

			await expect(persistRootEvalLiveEvidence({ privateRoot, evidence })).resolves.toMatchObject({
				postCommitFailureDigest: null,
			});
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	it("persists the caller deadline code and latest bounded Graph observation", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-deadline-evidence-"));
		const privateRoot = await realpath(temporary);
		await chmod(privateRoot, 0o700);
		try {
			const claimInput = await currentClaimInput(privateRoot);
			const claimAcquisition = await acquireRootEvalLiveClaimForNoNetworkQualification(claimInput);
			const base = liveEvidenceInput();
			const evidence = constructRootEvalLiveEvidence({
				...base,
				claim: claimAcquisition.claim,
				pricing: claimInput.pricing,
				zeroByok: claimInput.zeroByok,
				currentKeyBefore: claimInput.currentKeyBefore,
				currentKeyAfter: null,
				graphResult: null,
				providerCalls: 1,
				failure: new RootEvalCallerSettlementDeadlineExpired(5),
				cleanupDisposition: "complete",
			});
			const persisted = await persistRootEvalLiveEvidence({ privateRoot, evidence });
			expect(persisted.postCommitFailureDigest).toBeNull();
			const bytes = await readFile(
				join(privateRoot, ROOT_EVAL_LIVE_GENERATION_REF, "evidence.v23.json"),
				"utf8",
			);
			const durable = JSON.parse(bytes) as Record<string, unknown>;
			expect(durable).toMatchObject({
				technicalFailureCode: "caller-settlement-deadline-expired",
				latestGraphObservation: expect.objectContaining({ path: "eval/observation" }),
			});
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	it("atomically persists D113 semantic success with a rejected billing audit", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-d105-rejected-"));
		const privateRoot = await realpath(temporary);
		await chmod(privateRoot, 0o700);
		try {
			const claimInput = await currentClaimInput(privateRoot);
			const claimAcquisition = await acquireRootEvalLiveClaimForNoNetworkQualification(claimInput);
			const currentKeyAfterMaterial = {
				...claimInput.currentKeyBefore,
				remainingMicrousd: claimInput.currentKeyBefore.remainingMicrousd - 85_261,
				usageMicrousd: claimInput.currentKeyBefore.usageMicrousd + 85_261,
			};
			delete (currentKeyAfterMaterial as { admissionDigest?: string }).admissionDigest;
			const currentKeyAfter = {
				...currentKeyAfterMaterial,
				admissionDigest: empiricalStrictJsonDigest(currentKeyAfterMaterial),
			};
			const candidate = withRejectedBillingTerminal({
				...liveEvidenceInput(),
				claim: claimAcquisition.claim,
				pricing: claimInput.pricing,
				zeroByok: claimInput.zeroByok,
				currentKeyBefore: claimInput.currentKeyBefore,
				currentKeyAfter,
			});
			const evidence = constructRootEvalLiveEvidence(candidate);
			expect(evidence).toMatchObject({
				disposition: "success",
				efficacyClaim: "none",
				causalAttribution: "undetermined",
				admissionReport: {
					status: "admitted",
					violationCodes: [],
					rejectedGraphSummary: null,
				},
				graphResult: {
					finding: {
						stoppingReason: "campaign-complete",
						finding: "positive-differential",
						providerReportedMicrousd: 85_284,
						pricingRoundingAllowanceMicrousd: 22,
						providerReportedLowerBoundMicrousd: 85_262,
						observedBilledMicrousd: 85_261,
						billingDisposition: "rejected",
					},
				},
			});
			const receipt = await persistRootEvalLiveEvidence({ privateRoot, evidence });
			expect(receipt.postCommitFailureDigest).toBeNull();
			const persisted = await readFile(
				join(privateRoot, ROOT_EVAL_LIVE_GENERATION_REF, "evidence.v23.json"),
				"utf8",
			);
			expect(JSON.parse(persisted)).toEqual(evidence);
			expect(persisted).not.toMatch(/authorization|bearer|admission-0|private-marker/iu);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	it("commits one D140 no-charge preclaim disposition and blocks a later qualification claim", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-d94-preclaim-"));
		const privateRoot = await realpath(temporary);
		await chmod(privateRoot, 0o700);
		const input = {
			privateRoot,
			implementationManifestDigest: ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest: ROOT_EVAL_CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
			qualificationDigest: ROOT_EVAL_CURRENT_QUALIFICATION_DIGEST,
			taskBindingDigest: ROOT_EVAL_CURRENT_TASK_BINDING_DIGEST,
			failure: new Error("preclaim gate failed without provider dispatch"),
		};
		try {
			await expect(persistRootEvalLivePreclaimFailure(input)).resolves.toMatchObject({
				receiptDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
				postCommitFailureDigest: null,
			});
			await expect(persistRootEvalLivePreclaimFailure(input)).rejects.toMatchObject({
				code: "EEXIST",
			});
			await expect(
				acquireRootEvalLiveClaimForNoNetworkQualification(await currentClaimInput(privateRoot)),
			).rejects.toMatchObject({ code: "EEXIST" });
			const entries = await readdir(privateRoot);
			expect(entries).toHaveLength(1);
			expect(entries[0]).toContain("disposition.v20.json");
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	it("reconciles rejected post-usage response shapes at their independently validated cost", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-live-proposal-shape-"));
		const base = JSON.parse(new TextDecoder().decode(providerBytes())) as Record<string, unknown>;
		const legacyToolCall = new TextEncoder().encode(
			JSON.stringify({
				...base,
				choices: [
					{
						message: {
							content: null,
							tool_calls: [{ function: { name: "replace_exact", arguments: "{}" } }],
						},
					},
				],
			}),
		);
		const malformedProposal = new TextEncoder().encode(
			JSON.stringify({
				...base,
				choices: [{ message: { content: "{" } }],
			}),
		);
		const executor = createRootEvalNoNetworkQualificationExecutor({
			repositoryRoot,
			materializationRoot: join(temporary, "workspaces"),
			pricing,
			providerResponses: [],
			providerResponseForEffect(effect) {
				if (effect.workItemRole === "source")
					return {
						status: 200,
						bytes: providerBytesForSourceTask(ROOT_EVAL_DEVELOPMENT_TASKS[effect.replicate - 1]!),
					};
				return { status: 200, bytes: effect.replicate === 1 ? legacyToolCall : malformedProposal };
			},
		});
		try {
			const graphResult = await runRootEval(
				createRootEvalTopology({
					profileInput: createCurrentExactModelHarnessProfileInput(),
					currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
					campaignRef: ROOT_EVAL_LIVE_GENERATION_REF,
					taskSetRef: ROOT_EVAL_DEVELOPMENT_TASK.taskSetRef,
					maxCostMicrousd: 6_000_000,
					reservationMicrousd: 200_000,
				}),
				async (effect) => {
					if (effect.kind === "eval-admitted-billing-observation")
						return await executor.execute(effect);
					if (effect.kind === "eval-admitted-tool-effect" && effect.workItemRole === "source")
						return await executor.execute(effect);
					if (
						effect.kind === "eval-admitted-effect" &&
						(effect.workItemRole === "source" ||
							(effect.replicate <= 2 && effect.arm === "relevant-applied"))
					)
						return await executor.execute(effect);
					if (effect.kind !== "eval-admitted-effect")
						throw new Error("unexpected non-provider effect after proposal rejection");
					const resultDigest = empiricalStrictJsonDigest({
						kind: "injected-control-provider-failure",
						executionId: effect.executionId,
					});
					return Object.freeze({
						kind: "eval-provider-outcome" as const,
						admission: effect,
						admissionId: effect.admissionId,
						executionId: effect.executionId,
						operationId: effect.operationId,
						effectRunId: effect.effectRunId,
						workItemId: effect.workItemId,
						workItemRole: effect.workItemRole,
						replicate: effect.replicate,
						arm: effect.arm,
						attempt: effect.attempt,
						status: "failed" as const,
						reason: "executor-failed" as const,
						dispatchAttempted: false,
						costMicrousd: 0,
						costEvidence: "provider-reported" as const,
						pricingRoundingAllowanceMicrousd: 0,
						elapsedMs: 0,
						resultDigest,
						retryAfterMs: 0,
						cleanupCompleted: true,
						toolProposal: null,
					} satisfies EvalProviderOutcome);
				},
			);
			expect(executor.providerRequestSummaries()).toHaveLength(7);
			expect(graphResult.finding.providerReportedMicrousd).toBe(1_855);
			expect(graphResult.finding.providerOutcomeReasonCounts).toMatchObject({
				"tool-proposed": 5,
				"response-proposal-legacy-shape": 1,
				"response-proposal-invalid": 1,
				"executor-failed": 28,
			});
		} finally {
			await executor.dispose();
			await rm(temporary, { recursive: true, force: true });
		}
	}, 120_000);

	it("completes a live-shaped six-arm 429 lifecycle through six Graph-admitted retries", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-live-six-429-"));
		const materializationRoot = join(temporary, "workspaces");
		const retryable = Object.freeze({
			status: 429,
			bytes: new TextEncoder().encode("{}"),
			retryAfter: "0",
		});
		const successful = (task: (typeof ROOT_EVAL_DEVELOPMENT_TASKS)[number]) =>
			Object.freeze({ status: 200, bytes: providerBytesForTask(task) });
		const executor = createRootEvalNoNetworkQualificationExecutor({
			repositoryRoot,
			materializationRoot,
			pricing,
			providerResponses: [],
			providerResponseForEffect(effect) {
				const task = ROOT_EVAL_DEVELOPMENT_TASKS[effect.replicate - 1]!;
				if (effect.workItemRole === "source")
					return { status: 200, bytes: providerBytesForSourceTask(task) };
				return effect.replicate === 1 && effect.attempt === 1 ? retryable : successful(task);
			},
		});
		try {
			const graphResult = await runRootEval(
				createRootEvalTopology({
					profileInput: createCurrentExactModelHarnessProfileInput(),
					currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
					campaignRef: ROOT_EVAL_LIVE_GENERATION_REF,
					taskSetRef: ROOT_EVAL_DEVELOPMENT_TASK.taskSetRef,
					maxCostMicrousd: 6_000_000,
					reservationMicrousd: 200_000,
				}),
				async (effect) => {
					if (effect.kind !== "eval-admitted-retry-delay") return await executor.execute(effect);
					return Object.freeze({
						kind: "eval-retry-delay-outcome" as const,
						admission: effect,
						executionId: effect.executionId,
						elapsedMs: effect.delayMs,
						status: "completed" as const,
						resultDigest: empiricalStrictJsonDigest({
							kind: "no-network-immediate-retry-delay",
							executionId: effect.executionId,
						}),
					});
				},
			);
			expect(executor.providerRequestSummaries()).toHaveLength(41);
			expect(graphResult.executedAdmissionIds).toHaveLength(41);
			expect(graphResult.finding).toMatchObject({
				completedWorkItems: 30,
				admittedAttempts: 41,
				providerCallCount: 41,
				stoppingReason: "campaign-complete",
				providerOutcomeReasonCounts: {
					"http-429-retryable": 6,
					"tool-proposed": 35,
				},
			});
			const terminal = [...graphResult.observations]
				.reverse()
				.flatMap((event) =>
					event.msg[0] === "DATA" ? [event.msg[1] as Record<string, unknown>] : [],
				)
				.find((value) => value.finding !== "pending");
			expect(terminal).toMatchObject({
				retryProposalCount: 6,
				pendingRetryProposalCount: 0,
				admittedRetryAttempts: 6,
				rejectedRetryProposalCount: 0,
				settledRetryAttemptCount: 6,
			});
			expect(await readdir(materializationRoot)).toEqual([]);
		} finally {
			await executor.dispose();
			await rm(temporary, { recursive: true, force: true });
		}
	}, 120_000);

	it("executes one admitted effect against a frozen isolated workspace and behavioral verifiers", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-live-"));
		const privateRoot = await realpath(temporary);
		const claimInput = await currentClaimInput(privateRoot);
		const claimCommit = await acquireRootEvalLiveClaimForNoNetworkQualification(claimInput);
		const sourceExecutor = createRootEvalNoNetworkQualificationExecutor({
			repositoryRoot,
			materializationRoot: join(temporary, "workspaces"),
			pricing: claimInput.pricing,
			providerResponses: [],
			providerResponseForEffect(effect) {
				const task = ROOT_EVAL_DEVELOPMENT_TASKS[effect.replicate - 1]!;
				return { status: 200, bytes: providerBytesForSourceTask(task) };
			},
		});
		const executor = createRootEvalLiveTransportQualificationExecutor({
			repositoryRoot,
			materializationRoot: join(temporary, "workspaces"),
			privateRoot,
			claimCommit,
			bearerToken: claimInput.credential.bearerToken,
			pricing: claimInput.pricing,
			diagnosticMode: "development-private",
			providerResponses: [{ status: 200, bytes: providerBytes() }],
		});
		try {
			let verified: EvalEffectOutcome | undefined;
			const graphResult = await runRootEval(
				createRootEvalTopology({
					profileInput: createCurrentExactModelHarnessProfileInput(),
					currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
					campaignRef: ROOT_EVAL_LIVE_GENERATION_REF,
					campaignPurpose: "qualification",
					taskSetRef: ROOT_EVAL_DEVELOPMENT_TASK.taskSetRef,
					generationRef: ROOT_EVAL_LIVE_GENERATION_REF,
					heldOutSealDigest: ROOT_EVAL_LIVE_HELD_OUT_SEAL_DIGEST,
					budgetPartition: "no-network",
					partitionHardCapMicrousd: 6_000_000,
					partitionLedgerDigest: testPartitionLedgerDigest,
					developmentQualificationStreakBefore: 0,
					maxCostMicrousd: 6_000_000,
					reservationMicrousd: 200_000,
				}),
				async (effect) => {
					if (
						(effect.kind === "eval-admitted-effect" ||
							effect.kind === "eval-admitted-tool-effect") &&
						effect.workItemRole === "source"
					)
						return await sourceExecutor.execute(effect);
					if (
						effect.kind === "eval-admitted-effect" &&
						effect.replicate === 1 &&
						effect.arm === "relevant-applied"
					)
						return await executor.execute(effect);
					if (
						effect.kind === "eval-admitted-tool-effect" &&
						effect.workItemRole === "target" &&
						effect.replicate === 1 &&
						effect.arm === "relevant-applied"
					) {
						verified = (await executor.execute(effect)) as EvalEffectOutcome;
						return verified;
					}
					if (effect.kind === "eval-admitted-retry-delay")
						throw new Error("unexpected retry delay in exact-tool integration test");
					if (effect.kind === "eval-admitted-billing-observation")
						return await executor.execute(effect);
					const digest = empiricalStrictJsonDigest({
						kind: "injected-control-provider-failure",
						executionId: effect.executionId,
					});
					return Object.freeze({
						kind: "eval-provider-outcome" as const,
						admission: effect,
						admissionId: effect.admissionId,
						executionId: effect.executionId,
						operationId: effect.operationId,
						effectRunId: effect.effectRunId,
						workItemId: effect.workItemId,
						workItemRole: effect.workItemRole,
						replicate: effect.replicate,
						arm: effect.arm,
						attempt: effect.attempt,
						status: "failed" as const,
						reason: "executor-failed" as const,
						dispatchAttempted: false,
						costMicrousd: 0,
						costEvidence: "provider-reported" as const,
						pricingRoundingAllowanceMicrousd: 0,
						elapsedMs: 0,
						resultDigest: digest,
						retryAfterMs: 0,
						cleanupCompleted: true,
						toolProposal: null,
					} satisfies EvalProviderOutcome);
				},
			);
			expect(
				Object.entries(graphResult.finding.providerOutcomeReasonCounts).filter(
					([, count]) => count > 0,
				),
			).toEqual([
				["tool-proposed", 6],
				["executor-failed", 29],
			]);
			const requests = executor.providerRequestSummaries();
			expect(requests).toHaveLength(1);
			const request = requests[0]!;
			expect(request).toMatchObject({
				model: "deepseek/deepseek-v4-flash-0731",
				response_format: {
					type: "json_schema",
					json_schema: {
						name: "exact_replacement_proposal",
						strict: true,
						schema: {
							additionalProperties: false,
							required: ["path", "oldText", "newText"],
						},
					},
				},
				provider: {
					order: ["fireworks"],
					only: ["fireworks"],
					allow_fallbacks: false,
					require_parameters: true,
					data_collection: "deny",
					zdr: true,
				},
			});
			for (const forbidden of ["parallel_tool_calls", "tools", "tool_choice", "plugins"])
				expect(Object.hasOwn(request, forbidden)).toBe(false);
			expect(JSON.stringify(request)).not.toContain(ROOT_EVAL_LIVE_BUGGY_REPLACEMENT);
			expect(JSON.stringify(request)).not.toContain("Managed cloud PostgreSQL must admit");
			expect(graphResult.observations.length).toBeGreaterThan(0);
			expect(
				graphResult.observations.every((event) => event.msg[0] === "DATA" && event.tier === 3),
			).toBe(true);
			expect(graphResult.finding.providerOutcomeReasonCounts).toMatchObject({
				"tool-proposed": 6,
				"executor-failed": 29,
			});
			expect(verified?.status).toBe("completed");
			expect(verified?.evidence.diff).toBe("scoped-change");
			expect(verified?.evidence.expectedDigest).not.toBe(verified?.evidence.actualDigest);
			expect(verified?.evidence.publicSemantic).toBe("equivalent");
			expect(verified?.evidence.hiddenVerifier).toBe("pass");
			expect(executor.providerRequestSummaries()).toHaveLength(1);
			const diagnosticRoot = join(privateRoot, ".d145-development-diagnostics");
			const diagnosticNames = await readdir(diagnosticRoot);
			expect(diagnosticNames).toHaveLength(3);
			for (const name of diagnosticNames)
				expect((await stat(join(diagnosticRoot, name))).mode & 0o777).toBe(0o600);
			const diagnostics = await Promise.all(
				diagnosticNames.map((name) => readFile(join(diagnosticRoot, name), "utf8")),
			);
			expect(diagnostics.join("\n")).toContain("responseBase64");
			expect(diagnostics.join("\n")).toContain("public-verifier");
			expect(diagnostics.join("\n")).toContain("hidden-verifier");
			expect(JSON.stringify(graphResult.observations)).not.toContain("responseBase64");
		} finally {
			await sourceExecutor.dispose();
			await executor.dispose();
			await rm(temporary, { recursive: true, force: true });
		}
	}, 420_000);

	it("qualifies all five transfer tasks with ambiguous public and discriminating private verifiers", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-transfer-family-"));
		try {
			expect(
				await qualifyRootEvalTransferTaskFamily({
					repositoryRoot,
					materializationRoot: join(temporary, "workspaces"),
				}),
			).toEqual(
				ROOT_EVAL_DEVELOPMENT_TASKS.map((task) => ({
					replicate: task.replicate,
					publicAllowsAmbiguousBug: true,
					hiddenRejectsAmbiguousBug: true,
					exactScopedChange: true,
					correctPassesPublicAndHidden: true,
				})),
			);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	}, 420_000);

	it("seals three disjoint mode-0600 task manifests and fails closed without confirmatory authority", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-task-manifests-"));
		const previous = process.env.GRAPHREFLY_ROOT_EVAL_TASK_MANIFEST_DIRECTORY;
		process.env.GRAPHREFLY_ROOT_EVAL_TASK_MANIFEST_DIRECTORY = temporary;
		const development1 = createRootEvalTaskManifest({
			slot: "development-1",
			variantOrder: [0, 1, 2, 3, 4],
			coordinateSuffix: "development-one-seed",
		});
		const development2 = createRootEvalTaskManifest({
			slot: "development-2",
			variantOrder: [4, 3, 2, 1, 0],
			coordinateSuffix: "development-two-seed",
		});
		const confirmatory = createRootEvalTaskManifest({
			slot: "confirmatory",
			variantOrder: [2, 0, 4, 1, 3],
			coordinateSuffix: "confirmatory-sealed-seed",
		});
		try {
			expect(
				new Set([
					development1.manifestDigest,
					development2.manifestDigest,
					confirmatory.manifestDigest,
				]).size,
			).toBe(3);
			expect(development1.taskSetRef).toBe(ROOT_EVAL_DEVELOPMENT_TASK_SET_REFS["development-1"]);
			expect(development2.taskSetRef).toBe(ROOT_EVAL_DEVELOPMENT_TASK_SET_REFS["development-2"]);
			expect(confirmatory.taskSetRef).toBe(ROOT_EVAL_CONFIRMATORY_TASK_SET_REF);
			await writeFile(join(temporary, "development-1.json"), JSON.stringify(development1), {
				mode: 0o600,
			});
			expect(readRootEvalTaskManifest("development-1")).toEqual(development1);
			expect(rootEvalTask("development-transfer", 5, "development-1").instanceRef).toBe(
				development1.tasks[4]!.instanceRef,
			);
			expect(() => rootEvalTask("confirmatory-transfer", 1, "confirmatory")).toThrow();
			await chmod(join(temporary, "development-1.json"), 0o644);
			expect(() => readRootEvalTaskManifest("development-1")).toThrow(/mode-0600/u);
			await chmod(join(temporary, "development-1.json"), 0o600);
			const tasksWithoutSourceInsightDigest = development1.tasks.map((task, index) => {
				if (index !== 0) return task;
				const { sourceInsightDigest: _sourceInsightDigest, ...legacyTask } = task;
				return legacyTask;
			});
			const legacyShapedManifest = {
				...development1,
				tasks: tasksWithoutSourceInsightDigest,
				manifestDigest: empiricalStrictJsonDigest({
					schemaVersion: development1.schemaVersion,
					slot: development1.slot,
					taskSetRef: development1.taskSetRef,
					tasks: tasksWithoutSourceInsightDigest,
				}),
			};
			await writeFile(join(temporary, "development-1.json"), JSON.stringify(legacyShapedManifest));
			expect(() => readRootEvalTaskManifest("development-1")).toThrow(/failed closed/u);
			await writeFile(
				join(temporary, "development-1.json"),
				JSON.stringify({ ...development1, taskSetRef: "tampered-task-set" }),
			);
			expect(() => readRootEvalTaskManifest("development-1")).toThrow(/failed closed/u);
			await writeFile(join(temporary, "confirmatory.json"), JSON.stringify(development1), {
				mode: 0o600,
			});
			expect(() => readRootEvalTaskManifest("confirmatory")).toThrow(/failed closed/u);
		} finally {
			if (previous === undefined) delete process.env.GRAPHREFLY_ROOT_EVAL_TASK_MANIFEST_DIRECTORY;
			else process.env.GRAPHREFLY_ROOT_EVAL_TASK_MANIFEST_DIRECTORY = previous;
			await rm(temporary, { recursive: true, force: true });
		}
	});

	it("binds every irrelevant memory provenance to a source Work Item with the opposite hidden invariant", () => {
		const acceptedField = (source: string): Readonly<{ field: string; normalized: boolean }> => {
			const match =
				/const acceptedCoordinate = envelope\.([A-Za-z][A-Za-z0-9]*)(\.toLowerCase\(\))?;/u.exec(
					source,
				);
			if (match?.[1] === undefined) throw new TypeError("task fixture accepted field missing");
			return Object.freeze({ field: match[1], normalized: match[2] !== undefined });
		};
		const authorityClass = (
			source: string,
			contract: string,
		): "source" | "boundary" | "normalized-source" => {
			const fields = [...contract.matchAll(/readonly ([A-Za-z][A-Za-z0-9]*): string;/gu)].map(
				(match) => match[1]!,
			);
			if (fields.length !== 2) throw new TypeError("task contract authority fields missing");
			const accepted = acceptedField(source);
			if (accepted.field === fields[0]) return accepted.normalized ? "normalized-source" : "source";
			return "boundary";
		};
		const bindings = rootEvalTaskBindings(ROOT_EVAL_DEVELOPMENT_TASKS);
		expect(bindings).toHaveLength(5);
		expect(new Set(bindings.map((binding) => binding.irrelevantTaskInstanceRef)).size).toBe(5);
		for (const [index, binding] of bindings.entries()) {
			const target = ROOT_EVAL_DEVELOPMENT_TASKS[index]!;
			const irrelevantIndex = ROOT_EVAL_IRRELEVANT_SOURCE_REPLICATES[index]! - 1;
			const irrelevant = ROOT_EVAL_DEVELOPMENT_TASKS[irrelevantIndex]!;
			expect(binding.irrelevantTaskInstanceRef).toBe(irrelevant.instanceRef);
			expect(binding.irrelevantSourceInsightDigest).toBe(irrelevant.sourceInsightDigest);
			const targetClass = authorityClass(
				target.fixtureCorrectText,
				target.readonlyFixtureFiles[0]!.text,
			);
			const irrelevantCorrectClass = authorityClass(
				irrelevant.sourceFixtureCorrectText,
				irrelevant.sourceReadonlyFixtureFiles[0]!.text,
			);
			const irrelevantBuggyClass = authorityClass(
				irrelevant.sourceFixtureBuggyText,
				irrelevant.sourceReadonlyFixtureFiles[0]!.text,
			);
			expect(targetClass).not.toBe(irrelevantCorrectClass);
			expect(irrelevantCorrectClass).not.toBe(irrelevantBuggyClass);
		}
	});

	it("binds D140 zero-BYOK and current-key admission to the same Local Eval 2 credential", async () => {
		const credential = parseRootEvalLiveCredential(
			new TextEncoder().encode("OPENROUTER_API_KEY=sk-or-v1-a44-middle-credential-e06\n"),
		);
		const nowMs = Date.now();
		const gateReceipt = precredentialGateReceipt(nowMs - 1);
		const browserArtifactBytes = zeroByokArtifactBytes(nowMs, gateReceipt.receiptDigest);
		expect(JSON.parse(new TextDecoder().decode(browserArtifactBytes))).toMatchObject({
			schemaVersion: ROOT_EVAL_LIVE_ZERO_BYOK_SCHEMA,
			decisionRef: ROOT_EVAL_LIVE_DECISION_REF,
		});
		const zeroByok = admitRootEvalLiveZeroByok({
			credential,
			precredentialGateReceipt: gateReceipt,
			nowMs,
			bytes: browserArtifactBytes,
		});
		expect(zeroByok.byokCredentialCount).toBe(0);
		expect(() =>
			admitRootEvalLiveZeroByok({
				credential,
				precredentialGateReceipt: gateReceipt,
				nowMs,
				bytes: zeroByokArtifactBytes(nowMs - 2, gateReceipt.receiptDigest),
			}),
		).toThrow(/same-credential admission/u);
		expect(() =>
			admitRootEvalLiveZeroByok({
				credential,
				precredentialGateReceipt: gateReceipt,
				nowMs,
				bytes: new TextEncoder().encode(
					JSON.stringify({
						schemaVersion: ROOT_EVAL_LIVE_ZERO_BYOK_SCHEMA,
						decisionRef: "graphrefly-ts:D94",
						workspaceName: "GraphReFly",
						workspaceSlug: "graph-re-fly",
						keyName: "Local Eval 2",
						byokCredentialCount: 0,
						providerObservation: "Fireworks Not configured",
						source: "openrouter-browser-settings",
						guardrailId: "2c97d3e1-b4cc-4246-95d7-33eb27fb65ab",
						guardrailName: "B112 DeepSeek V4 Flash",
						guardrailDescription:
							"Dedicated Local Eval 2 guardrail for the B112 DeepSeek V4 Flash 0731 Fireworks-only structured-proposal route.",
						keyAssigned: true,
						restrictionMode: "only-allow",
						paidEndpointTrainingAllowed: false,
						providerEligible: true,
						requestDataCollection: "deny",
						requestZdrRequired: true,
						precredentialGateReceiptDigest: gateReceipt.receiptDigest,
						observedAt: new Date(nowMs).toISOString(),
						keyVisiblePrefix: "",
						keyVisibleSuffix: "",
						allowedModels: ["deepseek/deepseek-v4-flash-0731"],
						allowedProviders: ["Fireworks"],
					}),
				),
			}),
		).toThrow(/same-credential/u);
		let reads = 0;
		const fetchImpl = async (): Promise<Response> => {
			reads += 1;
			return new Response(
				JSON.stringify({
					data: {
						limit: 32,
						limit_remaining: 6.25,
						usage: 25.75,
						limit_reset: null,
						is_management_key: false,
					},
				}),
				{ status: 200 },
			);
		};
		const admittedKey = await readRootEvalLiveCurrentKey({ credential, fetchImpl });
		expect(admittedKey).toMatchObject({
			limitMicrousd: 32_000_000,
			remainingMicrousd: 6_250_000,
			usageMicrousd: 25_750_000,
			limitReset: "none",
			isManagementKey: false,
		});
		expect(reads).toBe(1);
	});

	it("keeps historical D85 coordinates inspectable but rejects their reuse by D140", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-claim-"));
		const privateRoot = await realpath(temporary);
		await chmod(privateRoot, 0o700);
		const credential = Object.freeze({
			bearerToken: "test-openrouter-token-not-secret",
			bindingRef: "openrouter.local-eval-2" as const,
			bindingRevision: "2026-08-24.d94.v1" as const,
		});
		const pricingMaterial = Object.freeze({
			sourceUrl:
				"https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints" as const,
			modelRef: "deepseek/deepseek-v4-flash-0731" as const,
			endpointModelRef: "deepseek/deepseek-v4-flash-20260731" as const,
			providerName: "Fireworks" as const,
			providerRef: "fireworks" as const,
			quantization: "unknown" as const,
			inputMicrousdPerMillionTokens: 220_000 as const,
			outputMicrousdPerMillionTokens: 660_000 as const,
			cacheReadMicrousdPerMillionTokens: 7_000 as const,
			zeroDataRetention: true as const,
			promptTraining: false as const,
			zdrSourceUrl: ROOT_EVAL_LIVE_ZDR_SOURCE,
			zdrResponseDigest: empiricalStrictJsonDigest("zdr"),
			observedAtMs: 1,
			officialResponseDigest: empiricalStrictJsonDigest("pricing"),
		});
		const pricingObservation = Object.freeze({
			...pricingMaterial,
			observationDigest: empiricalStrictJsonDigest(pricingMaterial),
		});
		const zeroMaterial = Object.freeze({
			workspaceSlug: "graph-re-fly" as const,
			keyName: "Local Eval 2" as const,
			byokCredentialCount: 0 as const,
			providerObservation: "Fireworks Not configured" as const,
			observedAtMs: 1,
			precredentialGateCompletedAtMs: 0,
			precredentialGateReceiptDigest: empiricalStrictJsonDigest("precredential-gates"),
			sourceArtifactDigest: empiricalStrictJsonDigest("zero-source"),
		});
		const zeroByok = Object.freeze({
			...zeroMaterial,
			observationDigest: empiricalStrictJsonDigest(zeroMaterial),
		});
		try {
			const claimInput = {
				privateRoot,
				implementationCoordinate: `worktree:${"a".repeat(40)}:${ROOT_EVAL_HISTORICAL_D85_IMPLEMENTATION_MANIFEST_DIGEST}`,
				implementationManifestDigest: ROOT_EVAL_HISTORICAL_D85_IMPLEMENTATION_MANIFEST_DIGEST,
				qualificationArtifactDigest: ROOT_EVAL_HISTORICAL_D85_QUALIFICATION_ARTIFACT_DIGEST,
				qualificationDigest: ROOT_EVAL_HISTORICAL_D85_QUALIFICATION_DIGEST,
				taskBindingDigest: ROOT_EVAL_HISTORICAL_D85_TASK_BINDING_DIGEST,
				taskManifestDigest: testTaskManifestDigest,
				pricing: pricingObservation,
				zeroByok,
				credential,
			};
			await expect(acquireRootEvalLiveClaim(claimInput)).rejects.toThrow(/current closure/u);
			const originalClaim = liveEvidenceInput().claim!;
			await expect(
				persistRootEvalLivePreclaimFailure({
					privateRoot,
					implementationManifestDigest: claimInput.implementationManifestDigest,
					qualificationArtifactDigest: claimInput.qualificationArtifactDigest,
					qualificationDigest: claimInput.qualificationDigest,
					taskBindingDigest: claimInput.taskBindingDigest,
					failure: new Error("must not coexist with claim"),
				}),
			).rejects.toThrow(/current closure/u);
			const currentKeyBeforeMaterial = Object.freeze({
				limitMicrousd: 32_000_000 as const,
				remainingMicrousd: 6_500_000,
				usageMicrousd: 25_500_000,
				limitReset: "none" as const,
				isManagementKey: false as const,
			});
			const currentKeyBefore = Object.freeze({
				...currentKeyBeforeMaterial,
				admissionDigest: empiricalStrictJsonDigest(currentKeyBeforeMaterial),
			});
			const currentKeyAfterMaterial = Object.freeze({
				...currentKeyBeforeMaterial,
				remainingMicrousd: 6_499_900,
				usageMicrousd: 25_500_100,
			});
			const currentKeyAfter = Object.freeze({
				...currentKeyAfterMaterial,
				admissionDigest: empiricalStrictJsonDigest(currentKeyAfterMaterial),
			});
			const { claimDigest: _historicalClaimDigest, ...originalClaimMaterial } = originalClaim;
			const claimMaterial = {
				...originalClaimMaterial,
				currentKeyBeforeDigest: currentKeyBefore.admissionDigest,
				recoveryEnvelope: {
					pricing: pricingObservation,
					zeroByok,
					currentKeyBefore,
				},
			};
			const claim = {
				...claimMaterial,
				claimDigest: empiricalStrictJsonDigest(claimMaterial),
			};
			const verificationDiagnostics =
				liveEvidenceInput().graphResult!.finding.verificationDiagnostics;
			const currentWorkItemCount = ROOT_EVAL_LIVE_REPLICATE_COUNT * arms.length;
			const graphResult: RootEvalRunResult = Object.freeze({
				finding: Object.freeze({
					kind: "eval-efficacy-finding" as const,
					campaignRef: ROOT_EVAL_LIVE_GENERATION_REF,
					replicateCount: ROOT_EVAL_LIVE_REPLICATE_COUNT,
					armOrder: Object.freeze([
						"cold",
						"relevant-applied",
						"proposal-only",
						"admission-rejected",
						"irrelevant-applied",
						"wrong-scope-applied",
					] as const),
					passCounts: Object.freeze({
						cold: 0,
						"relevant-applied": ROOT_EVAL_LIVE_REPLICATE_COUNT,
						"proposal-only": 0,
						"admission-rejected": 0,
						"irrelevant-applied": 0,
						"wrong-scope-applied": 0,
					}),
					evaluableReplicates: ROOT_EVAL_LIVE_REPLICATE_COUNT,
					excludedTechnicalReplicates: Object.freeze([]),
					sourceTechnicalExcludedReplicates: Object.freeze([]),
					matchedRelevantOverColdWins: ROOT_EVAL_LIVE_REPLICATE_COUNT,
					verificationDiagnostics,
					completedWorkItems: currentWorkItemCount,
					admittedAttempts: currentWorkItemCount,
					providerCallCount: currentWorkItemCount,
					activeReservedMicrousd: 0,
					providerReportedMicrousd: 100,
					pricingRoundingAllowanceMicrousd: 1,
					providerReportedLowerBoundMicrousd: 99,
					unreportedSettledUpperBoundMicrousd: 0,
					accountedUpperBoundMicrousd: 100,
					observedBilledMicrousd: 100,
					billingObservationCount: 4,
					billingStableIntervals: 3,
					reconciledBilledMicrousd: 100,
					billingDisposition: "reconciled" as const,
					providerOutcomeReasonCounts,
					finding: "positive-differential" as const,
					stoppingReason: "campaign-complete" as const,
				}),
				observations: liveEvidenceInput().graphResult!.observations,
				peakConcurrentEffects: 2,
				executedAdmissionIds: admissionIds(),
			});
			const evidence = constructRootEvalLiveEvidence({
				claim,
				currentKeyBefore,
				currentKeyAfter,
				pricing: pricingObservation,
				zeroByok,
				providerCalls: currentWorkItemCount,
				graphResult,
				partialGraphObservations: graphResult.observations,
				failure: null,
				cleanupDisposition: "complete",
			});
			expect(evidence.efficacyClaim).toBe("none");
			const { evidenceDigest: _digest, ...forgedMaterial } = evidence;
			const forgedDiagnosticMaterial = {
				...forgedMaterial,
				graphResult: {
					...evidence.graphResult!,
					finding: {
						...evidence.graphResult!.finding,
						passCounts: {
							...evidence.graphResult!.finding.passCounts,
							"relevant-applied": 0,
						},
						finding: "no-positive-differential" as const,
					},
					observations: evidence.graphResult!.observations.map((event, index, events) => ({
						...event,
						msg: [
							"DATA" as const,
							{
								...(event.msg[1] as Record<string, unknown>),
								finding:
									index === events.length - 1
										? ("no-positive-differential" as const)
										: ("pending" as const),
							},
						] as const,
					})),
				},
				efficacyClaim: "none" as const,
				causalAttribution: "undetermined" as const,
			};
			await expect(
				persistRootEvalLiveEvidence({
					privateRoot,
					evidence: {
						...forgedDiagnosticMaterial,
						evidenceDigest: empiricalStrictJsonDigest(forgedDiagnosticMaterial),
					},
				}),
			).rejects.toThrow(/pass counts drifted/u);
			const forgedMaterialWithDisposition = {
				...forgedMaterial,
				disposition: "partial-failure" as const,
			};
			const forgedEvidence = {
				...forgedMaterialWithDisposition,
				evidenceDigest: empiricalStrictJsonDigest(forgedMaterialWithDisposition),
			};
			await expect(
				persistRootEvalLiveEvidence({ privateRoot, evidence: forgedEvidence }),
			).rejects.toThrow(/partial evidence relationship invalid/u);
			const { evidenceDigest: _partialDigest, ...partialMaterial } = evidence;
			const partialDriftMaterial = {
				...partialMaterial,
				partialGraphObservations: evidence.partialGraphObservations.slice(0, -1),
			};
			await expect(
				persistRootEvalLiveEvidence({
					privateRoot,
					evidence: {
						...partialDriftMaterial,
						evidenceDigest: empiricalStrictJsonDigest(partialDriftMaterial),
					},
				}),
			).rejects.toThrow(/latest observation drifted|partial observations drifted/u);
			const { evidenceDigest: _claimDigestEvidence, ...unboundMaterial } = evidence;
			const unboundClaimMaterial = {
				...unboundMaterial,
				claimDigest: empiricalStrictJsonDigest("uncommitted-claim"),
			};
			await expect(
				persistRootEvalLiveEvidence({
					privateRoot,
					evidence: {
						...unboundClaimMaterial,
						evidenceDigest: empiricalStrictJsonDigest(unboundClaimMaterial),
					},
				}),
			).rejects.toThrow(/committed D145 claim/u);
			await expect(
				Promise.all([
					persistRootEvalLiveEvidence({ privateRoot, evidence }),
					persistRootEvalLiveEvidence({ privateRoot, evidence }),
				]),
			).rejects.toThrow(/committed D145 claim/u);
			await expect(
				persistRootEvalLiveEvidence({
					privateRoot,
					evidence: { ...evidence, disposition: "partial-failure" },
				}),
			).rejects.toThrow(/evidence.*invalid|committed D145 claim/u);
			expect(await readdir(privateRoot)).toEqual([]);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	it("rejects stale preclaim coordinates before creating a D140 disposition", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-preclaim-"));
		const privateRoot = await realpath(temporary);
		await chmod(privateRoot, 0o700);
		const input = {
			privateRoot,
			implementationManifestDigest: `sha256:${"1".repeat(64)}`,
			qualificationArtifactDigest: `sha256:${"2".repeat(64)}`,
			qualificationDigest: `sha256:${"3".repeat(64)}`,
			taskBindingDigest: ROOT_EVAL_HISTORICAL_D85_TASK_BINDING_DIGEST,
			failure: new Error("precredential frozen task gate failed"),
		};
		try {
			await expect(persistRootEvalLivePreclaimFailure(input)).rejects.toThrow(/current closure/u);
			const pricingMaterial = Object.freeze({
				sourceUrl:
					"https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints" as const,
				modelRef: "deepseek/deepseek-v4-flash-0731" as const,
				endpointModelRef: "deepseek/deepseek-v4-flash-20260731" as const,
				providerName: "Fireworks" as const,
				providerRef: "fireworks" as const,
				quantization: "unknown" as const,
				inputMicrousdPerMillionTokens: 220_000 as const,
				outputMicrousdPerMillionTokens: 660_000 as const,
				cacheReadMicrousdPerMillionTokens: 7_000 as const,
				zeroDataRetention: true as const,
				promptTraining: false as const,
				zdrSourceUrl: ROOT_EVAL_LIVE_ZDR_SOURCE,
				zdrResponseDigest: empiricalStrictJsonDigest("zdr"),
				observedAtMs: 1,
				officialResponseDigest: empiricalStrictJsonDigest("pricing"),
			});
			const zeroMaterial = Object.freeze({
				workspaceSlug: "graph-re-fly" as const,
				keyName: "Local Eval 2" as const,
				byokCredentialCount: 0 as const,
				providerObservation: "Fireworks Not configured" as const,
				observedAtMs: 1,
				precredentialGateCompletedAtMs: 0,
				precredentialGateReceiptDigest: empiricalStrictJsonDigest("precredential-gates"),
				sourceArtifactDigest: empiricalStrictJsonDigest("zero-source"),
			});
			await expect(
				acquireRootEvalLiveClaim({
					privateRoot,
					implementationCoordinate: `worktree:${"a".repeat(40)}:${input.implementationManifestDigest}`,
					implementationManifestDigest: input.implementationManifestDigest,
					qualificationArtifactDigest: input.qualificationArtifactDigest,
					qualificationDigest: input.qualificationDigest,
					taskBindingDigest: input.taskBindingDigest,
					taskManifestDigest: testTaskManifestDigest,
					pricing: Object.freeze({
						...pricingMaterial,
						observationDigest: empiricalStrictJsonDigest(pricingMaterial),
					}),
					zeroByok: Object.freeze({
						...zeroMaterial,
						observationDigest: empiricalStrictJsonDigest(zeroMaterial),
					}),
					credential: Object.freeze({
						bearerToken: "test-openrouter-token-not-secret",
						bindingRef: "openrouter.local-eval-2" as const,
						bindingRevision: "2026-08-24.d94.v1" as const,
					}),
				}),
			).rejects.toThrow(/current closure/u);
			expect(await readdir(privateRoot)).toEqual([]);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	it("rejects a suffix-only current implementation coordinate before claim commit", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-coordinate-shape-"));
		const privateRoot = await realpath(temporary);
		await chmod(privateRoot, 0o700);
		try {
			const input = await currentClaimInput(privateRoot);
			await expect(
				acquireRootEvalLiveClaimForNoNetworkQualification({
					...input,
					implementationCoordinate: `anything:${ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST}`,
				}),
			).rejects.toThrow(/implementation-coordinate/u);
			expect(await readdir(privateRoot)).toEqual([]);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});
});
