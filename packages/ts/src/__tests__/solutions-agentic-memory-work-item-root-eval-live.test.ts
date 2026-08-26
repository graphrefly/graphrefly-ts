import { spawn } from "node:child_process";
import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/graph-native-rerun-avoidance/canonical.js";
import { createCurrentExactModelHarnessProfileInput } from "../../evals/graph-native-rerun-avoidance/current-exact-profile.js";
import {
	createRootEvalTopology,
	type EvalAdmittedEffect,
	type EvalEffectOutcome,
	type EvalProviderOutcome,
	emptyEvalProviderOutcomeReasonCounts,
	ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
	type RootEvalRunResult,
	runRootEval,
} from "../../evals/graph-native-rerun-avoidance/eval-topology.js";
import {
	awaitRootEvalCallerSettlement,
	createRootEvalLiveExecutor,
	createRootEvalLiveTransportQualificationExecutor,
	createRootEvalNoNetworkQualificationExecutor,
	parseRootEvalLiveProviderResponse,
	qualifyRootEvalWithheldVerifier,
	ROOT_EVAL_LIVE_BUGGY_REPLACEMENT,
	ROOT_EVAL_LIVE_CORRECT_REPLACEMENT,
	ROOT_EVAL_LIVE_DECISION_REF,
	ROOT_EVAL_LIVE_WRITABLE_PATH,
	RootEvalCallerSettlementDeadlineExpired,
	readRootEvalBoundedResponseBytes,
} from "../../evals/graph-native-rerun-avoidance/root-eval-live.js";
import {
	acquireRootEvalLiveClaim,
	acquireRootEvalLiveClaimForNoNetworkQualification,
	admitRootEvalLiveZeroByok,
	constructRootEvalLiveEvidence,
	evaluateRootEvalLiveAdmission,
	parseRootEvalLiveCredential,
	persistRootEvalLiveEvidence,
	persistRootEvalLivePreclaimFailure,
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
	ROOT_EVAL_LIVE_CLAIM_REF,
	ROOT_EVAL_LIVE_CLAIM_SCHEMA,
	ROOT_EVAL_LIVE_EVIDENCE_SCHEMA,
	ROOT_EVAL_LIVE_GENERATION_REF,
	ROOT_EVAL_LIVE_PRECLAIM_FAILURE_SCHEMA,
	ROOT_EVAL_LIVE_PRICING_SOURCE,
	ROOT_EVAL_LIVE_SUCCESS_VIOLATION_CODES,
	ROOT_EVAL_LIVE_ZDR_SOURCE,
	ROOT_EVAL_LIVE_ZERO_BYOK_SCHEMA,
	type RootEvalLiveClaim,
	type RootEvalLiveEvidenceInput,
	readRootEvalLiveCurrentKey,
	readRootEvalLivePricing,
	recoverRootEvalLiveClaimAuthority,
} from "../../evals/graph-native-rerun-avoidance/root-eval-live-authority.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const pricing = Object.freeze({
	inputMicrousdPerMillionTokens: 220_000 as const,
	outputMicrousdPerMillionTokens: 660_000 as const,
	cacheReadMicrousdPerMillionTokens: 7_000 as const,
});

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
	"tool-proposed": 30,
});

function admissionIds(count = 30): readonly string[] {
	const result: string[] = [];
	for (let replicate = 1; replicate <= 5; replicate += 1)
		for (const arm of arms)
			for (const attempt of [1, 2] as const) {
				const workItemId = `${ROOT_EVAL_LIVE_GENERATION_REF}/replicate-${replicate}/${arm}`;
				result.push(
					`effect-run:work-item:${workItemId}:effect-plan:1:${workItemId}/plan:provider-and-exact-tool/attempt-${attempt}/admission`,
				);
				if (result.length === count) return Object.freeze(result);
			}
	return Object.freeze(result);
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

function zeroByokArtifactBytes(nowMs: number, duplicateKey = false): Uint8Array {
	const encoded = JSON.stringify({
		schemaVersion: ROOT_EVAL_LIVE_ZERO_BYOK_SCHEMA,
		decisionRef: ROOT_EVAL_LIVE_DECISION_REF,
		workspaceName: "GraphReFly",
		workspaceSlug: "graph-re-fly",
		keyName: "Local Eval 2",
		byokCredentialCount: 0,
		providerObservation: "Fireworks Not configured",
		source: "openrouter-browser-settings",
		observedAt: new Date(nowMs).toISOString(),
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
	});
	return new TextEncoder().encode(
		duplicateKey
			? encoded.replace('"keyAssigned":true', '"keyAssigned":false,"keyAssigned":true')
			: encoded,
	);
}

function liveEvidenceInput(): RootEvalLiveEvidenceInput {
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
		implementationCoordinate: `worktree:${"a".repeat(40)}:${ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST}`,
		implementationManifestDigest: ROOT_EVAL_CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: ROOT_EVAL_CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
		qualificationDigest: ROOT_EVAL_CURRENT_QUALIFICATION_DIGEST,
		taskBindingDigest: ROOT_EVAL_CURRENT_TASK_BINDING_DIGEST,
		pricingObservationDigest: pricingObservation.observationDigest,
		zeroByokObservationDigest: zeroByok.observationDigest,
		credentialBindingDigest: empiricalStrictJsonDigest({
			bindingRef: "openrouter.local-eval-2",
			bindingRevision: "2026-08-26.d125.v1",
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
					completedWorkItems: 5,
					exactToolAdmitted: 5,
					scopedChange: arm === "relevant-applied" ? 5 : 0,
					publicSemanticPassed: arm === "relevant-applied" ? 5 : 0,
					hiddenVerifierPassed: arm === "relevant-applied" ? 5 : 0,
					cleanupCompleted: 5,
					passed: arm === "relevant-applied" ? 5 : 0,
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
					"no-change": arm === "relevant-applied" ? 0 : 5,
					"wrong-scope": 0,
					"public-semantic-failed": 0,
					"hidden-verifier-failed": 0,
					passed: arm === "relevant-applied" ? 5 : 0,
				},
			]),
		),
		completedWorkItems: 30,
	};
	const observation = {
		path: "eval/observation",
		msg: [
			"DATA",
			{
				kind: "eval-observation",
				topologyRevision: "graphrefly-ts.root-eval-topology.v8",
				solutionIdentities: [
					"work-item-execution",
					"agentic-work-item-memory-application",
					"agentic-memory-record-use",
					"agentic-memory-retrieval",
				],
				campaignRef: ROOT_EVAL_LIVE_GENERATION_REF,
				replicate: 5,
				armOrder: [
					"cold",
					"relevant-applied",
					"proposal-only",
					"admission-rejected",
					"irrelevant-applied",
					"wrong-scope-applied",
				],
				memoryProvenance,
				verificationDiagnostics,
				completedArms: 6,
				activeProviderEffects: 0,
				activeToolEffects: 0,
				activeRetryEffects: 0,
				activeBillingEffects: 0,
				activeAdmittedEffects: 0,
				admittedAttempts: 30,
				admittedRetryAttempts: 0,
				retryProposalCount: 0,
				pendingRetryProposalCount: 0,
				rejectedRetryProposalCount: 0,
				settledRetryAttemptCount: 0,
				providerCallCount: 30,
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
				providerOutcomeReasonCounts,
				stoppingReason: "campaign-complete",
				finding: "positive-differential",
			},
		] as never,
		tier: 3,
		seq: 31,
	};
	const progressObservations = Array.from({ length: 30 }, (_, completedWorkItems) => {
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
						...providerOutcomeReasonCounts,
						"tool-proposed": completedWorkItems,
					},
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
			replicateCount: 5,
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
				"relevant-applied": 5,
				"proposal-only": 0,
				"admission-rejected": 0,
				"irrelevant-applied": 0,
				"wrong-scope-applied": 0,
			},
			verificationDiagnostics,
			completedWorkItems: 30,
			admittedAttempts: 30,
			providerCallCount: 30,
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
			providerOutcomeReasonCounts,
			finding: "positive-differential",
			stoppingReason: "campaign-complete",
		},
		observations: [...progressObservations, observation],
		peakConcurrentEffects: 6,
		executedAdmissionIds: admissionIds(),
	};
	return {
		claim,
		currentKeyBefore,
		currentKeyAfter,
		pricing: pricingObservation,
		zeroByok,
		providerCalls: 30,
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
		bytes: zeroByokArtifactBytes(nowMs),
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
		pricing,
		zeroByok,
		credential,
		currentKeyBefore,
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

describe("D125 live-boundary qualification over immutable D116/D117 and D118/D120 evidence", () => {
	it("binds exact fresh D125 currentness and rejects synthetic live authority", async () => {
		expect(ROOT_EVAL_LIVE_DECISION_REF).toBe("graphrefly-ts:D125");
		expect(ROOT_EVAL_LIVE_CLAIM_SCHEMA).toBe("graphrefly-ts.root-eval-live-claim.v15");
		expect(ROOT_EVAL_LIVE_EVIDENCE_SCHEMA).toBe("graphrefly-ts.root-eval-live-evidence.v18");
		expect(ROOT_EVAL_LIVE_PRECLAIM_FAILURE_SCHEMA).toBe(
			"graphrefly-ts.root-eval-live-preclaim-failure.v15",
		);
		expect(ROOT_EVAL_LIVE_CLAIM_REF).toBe("root-eval-live-claim-2026-08-26-d125-v1");
		expect(ROOT_EVAL_LIVE_GENERATION_REF).toBe("root-eval-live-2026-08-26-d125-v1");
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-d125-synthetic-live-"));
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
		const credentialPath = join(canonicalTemporary, "openrouter.env");
		const zeroByokPath = join(canonicalTemporary, "fresh-zero-byok-d125.v12.json");
		const observedAtMs = Date.now();
		try {
			await writeFile(credentialPath, "OPENROUTER_API_KEY=sk-or-v1-a44-middle-credential-e06\n", {
				mode: 0o600,
			});
			await chmod(credentialPath, 0o600);
			await writeFile(zeroByokPath, zeroByokArtifactBytes(observedAtMs), { mode: 0o644 });
			await chmod(zeroByokPath, 0o644);
			await expect(
				qualifyRootEvalLivePrivateInputs({ credentialPath, zeroByokPath, nowMs: observedAtMs }),
			).rejects.toThrow(/private input identity/u);

			await chmod(zeroByokPath, 0o600);
			await expect(
				qualifyRootEvalLivePrivateInputs({ credentialPath, zeroByokPath, nowMs: observedAtMs }),
			).resolves.toMatchObject({
				credential: {
					bindingRef: "openrouter.local-eval-2",
					bindingRevision: "2026-08-26.d125.v1",
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

	it("requires a committed D125 live claim before live provider dispatch", async () => {
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
				name.endsWith("disposition.v15.json"),
			);
			if (dispositionName === undefined) throw new TypeError("D125 disposition missing");
			const committedBytes = await readFile(join(privateRoot, dispositionName));
			await writeFile(join(copiedRoot, dispositionName), committedBytes, { mode: 0o600 });
			const copiedRootExecutor = createRootEvalLiveTransportQualificationExecutor({
				repositoryRoot,
				materializationRoot: join(temporary, "copied-root-workspaces"),
				privateRoot: copiedRoot,
				claimCommit: claimAcquisition,
				bearerToken: claimInput.credential.bearerToken,
				pricing: claimInput.pricing,
				providerResponses: [{ status: 200, bytes: providerBytes() }],
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
				providerResponses: [{ status: 200, bytes: providerBytes() }],
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
			providerResponses: Array.from({ length: 30 }, () => ({
				status: 200,
				bytes: providerBytes(),
				stallUntilAbort: true,
			})),
		});
		try {
			const result = await runRootEval(
				createRootEvalTopology({
					profileInput: createCurrentExactModelHarnessProfileInput(),
					currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
					campaignRef: ROOT_EVAL_LIVE_GENERATION_REF,
					maxCostMicrousd: 6_000_000,
					reservationMicrousd: 200_000,
					effectTimeoutMs: 25,
				}),
				(effect) => executor.execute(effect),
			);
			expect(result.finding).toMatchObject({
				completedWorkItems: 30,
				admittedAttempts: 30,
				stoppingReason: "campaign-complete",
				providerOutcomeReasonCounts: { "transport-failed": 30 },
			});
			expect(result.peakConcurrentEffects).toBe(6);
			// The Work Item lease covers pre-dispatch materialization, so an
			// already-expired effect cannot commit a dispatch or reach transport.
			expect(executor.providerRequestSummaries()).toHaveLength(0);
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
			providerResponses: Array.from({ length: 30 }, () => ({
				status: 200,
				bytes: truncatedProviderBytes(),
			})),
		});
		try {
			const result = await runRootEval(
				createRootEvalTopology({
					profileInput: createCurrentExactModelHarnessProfileInput(),
					currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
					campaignRef: ROOT_EVAL_LIVE_GENERATION_REF,
					maxCostMicrousd: 6_000_000,
					reservationMicrousd: 200_000,
				}),
				(effect) => executor.execute(effect),
			);
			expect(result.finding).toMatchObject({
				completedWorkItems: 30,
				admittedAttempts: 30,
				stoppingReason: "campaign-complete",
				providerOutcomeReasonCounts: { "response-output-truncated": 30 },
			});
			expect(result.peakConcurrentEffects).toBe(6);
			expect(executor.providerRequestSummaries()).toHaveLength(30);
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
		expect(() =>
			admitRootEvalLiveZeroByok({
				credential,
				nowMs: 1,
				bytes: zeroByokArtifactBytes(1, true),
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
				withGraphResult(base, {}, { completedWorkItems: 29 }),
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
						passCounts: { ...base.graphResult!.finding.passCounts, "relevant-applied": 6 },
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
					admittedAttempts: 31,
				}),
			],
			["success.peak-concurrency-below-one", withGraphResult(base, { peakConcurrentEffects: 0 })],
			["success.peak-concurrency-above-six", withGraphResult(base, { peakConcurrentEffects: 7 })],
			[
				"success.admission-count-below-thirty",
				withGraphResult(base, { executedAdmissionIds: ids.slice(0, 29) }),
			],
			[
				"success.admission-identities-duplicate",
				withGraphResult(base, { executedAdmissionIds: [...ids.slice(0, 29), ids[0]!] }),
			],
			[
				"success.finding-admitted-attempts-mismatch",
				withGraphResult(base, {}, { admittedAttempts: 29 }),
			],
			[
				"success.provider-outcome-reason-count-mismatch",
				withGraphResult(
					base,
					{},
					{
						providerOutcomeReasonCounts: { ...providerOutcomeReasonCounts, "tool-proposed": 29 },
					},
				),
			],
			[
				"success.accounted-budget-above-cap",
				withGraphResult(base, {}, { accountedUpperBoundMicrousd: 6_000_001 }),
			],
			["success.provider-call-count-mismatch", { ...base, providerCalls: 29 }],
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
		bindingDrift.stageCounts["relevant-applied"].hiddenVerifierPassed = 4;
		bindingDrift.stageCounts["relevant-applied"].passed = 4;
		bindingDrift.terminalReasonCounts["relevant-applied"].passed = 4;
		bindingDrift.terminalReasonCounts["relevant-applied"]["hidden-verifier-failed"] = 1;
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
			base.graphResult!.observations.slice(1),
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
			observedBilledMicrousd: null,
			billingObservationCount: 0,
			billingStableIntervals: 0,
			reconciledBilledMicrousd: null,
			billingDisposition: "pending",
		};
		const regressed = structuredClone(baseDiagnostics);
		regressed.stageCounts.cold.completedWorkItems = 4;
		regressed.stageCounts.cold.exactToolAdmitted = 4;
		regressed.stageCounts.cold.cleanupCompleted = 4;
		regressed.terminalReasonCounts.cold["no-change"] = 4;
		regressed.completedWorkItems = 29;
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
		higherScopedProgress.terminalReasonCounts.cold["no-change"] = 4;
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
		priorReasonProgress.terminalReasonCounts.cold["no-change"] = 4;
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
				{ ...pendingValue, replicate: 2, completedArms: 1 },
				{ ...pendingValue, replicate: 1, completedArms: 6 },
			],
			[
				{ ...pendingValue, replicate: 5, completedArms: 6 },
				{ ...pendingValue, replicate: 5, completedArms: 5 },
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
					"hidden-verifier-failed": 5,
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
			withGraphResult(liveEvidenceInput(), { peakConcurrentEffects: 7 }),
		);
		expect(evidence).toMatchObject({
			disposition: "partial-failure",
			graphResult: null,
			efficacyClaim: "none",
			causalAttribution: "undetermined",
			admissionReport: {
				status: "rejected",
				violationCodes: ["success.peak-concurrency-above-six"],
				rejectedGraphSummary: { peakConcurrentEffects: 7, executedAdmissionCount: 30 },
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
			efficacyClaim: "frozen-task-positive-differential",
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

	it("requires a committed D125 claim before evidence persistence", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-no-claim-"));
		const privateRoot = await realpath(temporary);
		await chmod(privateRoot, 0o700);
		try {
			const evidence = constructRootEvalLiveEvidence(liveEvidenceInput());
			await expect(persistRootEvalLiveEvidence({ privateRoot, evidence })).rejects.toThrow(
				/committed D125 claim/u,
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

	it("rejects a synthetic D125 live claim without runtime authority provenance", async () => {
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

	it("commits one D125 qualification claim and persists identical canonical evidence idempotently", async () => {
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
				name.endsWith("disposition.v15.json"),
			);
			if (dispositionName === undefined) throw new TypeError("D125 disposition missing");
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
				efficacyClaim: "frozen-task-positive-differential" as const,
				causalAttribution: "frozen-task-memory-context-differential" as const,
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
				"evidence.v18.json",
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
				join(privateRoot, ROOT_EVAL_LIVE_GENERATION_REF, "evidence.v18.json"),
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
				efficacyClaim: "frozen-task-positive-differential",
				causalAttribution: "frozen-task-memory-context-differential",
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
				join(privateRoot, ROOT_EVAL_LIVE_GENERATION_REF, "evidence.v18.json"),
				"utf8",
			);
			expect(JSON.parse(persisted)).toEqual(evidence);
			expect(persisted).not.toMatch(/authorization|bearer|admission-0|private-marker/iu);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	it("commits one D125 no-charge preclaim disposition and blocks a later qualification claim", async () => {
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
			expect(entries[0]).toContain("disposition.v15.json");
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
			providerResponses: [
				{ status: 200, bytes: legacyToolCall },
				{ status: 200, bytes: malformedProposal },
			],
		});
		try {
			const graphResult = await runRootEval(
				createRootEvalTopology({
					profileInput: createCurrentExactModelHarnessProfileInput(),
					currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
					campaignRef: ROOT_EVAL_LIVE_GENERATION_REF,
					maxCostMicrousd: 6_000_000,
					reservationMicrousd: 200_000,
				}),
				async (effect) => {
					if (effect.kind === "eval-admitted-billing-observation")
						return await executor.execute(effect);
					if (
						effect.kind === "eval-admitted-effect" &&
						effect.replicate <= 2 &&
						effect.arm === "relevant-applied"
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
			expect(executor.providerRequestSummaries()).toHaveLength(2);
			expect(graphResult.finding.providerReportedMicrousd).toBe(530);
			expect(graphResult.finding.providerOutcomeReasonCounts).toMatchObject({
				"response-proposal-legacy-shape": 1,
				"response-proposal-invalid": 1,
				"executor-failed": 28,
			});
		} finally {
			await executor.dispose();
			await rm(temporary, { recursive: true, force: true });
		}
	}, 120_000);

	it("completes a live-shaped six-concurrent-429 cohort through six Graph-admitted retries", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-live-six-429-"));
		const materializationRoot = join(temporary, "workspaces");
		const retryable = Object.freeze({
			status: 429,
			bytes: new TextEncoder().encode("{}"),
			retryAfter: "60",
		});
		const successful = Object.freeze({ status: 200, bytes: providerBytes() });
		const executor = createRootEvalNoNetworkQualificationExecutor({
			repositoryRoot,
			materializationRoot,
			pricing,
			providerResponses: Object.freeze([
				...Array.from({ length: arms.length }, () => retryable),
				...Array.from({ length: 30 }, () => successful),
			]),
		});
		try {
			const graphResult = await runRootEval(
				createRootEvalTopology({
					profileInput: createCurrentExactModelHarnessProfileInput(),
					currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
					campaignRef: ROOT_EVAL_LIVE_GENERATION_REF,
					maxCostMicrousd: 6_000_000,
					reservationMicrousd: 200_000,
				}),
				executor.execute,
			);
			expect(executor.providerRequestSummaries()).toHaveLength(36);
			expect(graphResult.executedAdmissionIds).toHaveLength(36);
			expect(graphResult.finding).toMatchObject({
				completedWorkItems: 30,
				admittedAttempts: 36,
				providerCallCount: 36,
				stoppingReason: "campaign-complete",
				providerOutcomeReasonCounts: {
					"http-429-retryable": 6,
					"tool-proposed": 30,
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
		const executor = createRootEvalNoNetworkQualificationExecutor({
			repositoryRoot,
			materializationRoot: join(temporary, "workspaces"),
			pricing,
			providerResponses: [{ status: 200, bytes: providerBytes() }],
		});
		try {
			let verified: EvalEffectOutcome | undefined;
			const graphResult = await runRootEval(
				createRootEvalTopology({
					profileInput: createCurrentExactModelHarnessProfileInput(),
					currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
					campaignRef: ROOT_EVAL_LIVE_GENERATION_REF,
					maxCostMicrousd: 6_000_000,
					reservationMicrousd: 200_000,
				}),
				async (effect) => {
					if (
						effect.kind === "eval-admitted-effect" &&
						effect.replicate === 1 &&
						effect.arm === "relevant-applied"
					) {
						const payload = effect.request.payload as Record<string, unknown>;
						const [binding] = payload.memoryBindings as readonly Record<string, unknown>[];
						const forged = {
							...effect,
							request: {
								...effect.request,
								payload: {
									...payload,
									memoryBindings: [{ ...binding, digest: `sha256:${"0".repeat(64)}` }],
								},
							},
						} as EvalAdmittedEffect;
						const rejected = (await executor.execute(forged)) as EvalProviderOutcome;
						expect(rejected).toMatchObject({ status: "failed", costMicrousd: 0 });
						expect(executor.providerRequestSummaries()).toHaveLength(0);
						return await executor.execute(effect);
					}
					if (effect.kind === "eval-admitted-tool-effect") {
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
			const requests = executor.providerRequestSummaries();
			expect(requests).toHaveLength(1);
			const request = requests[0]!;
			expect(request).toMatchObject({
				model: "deepseek/deepseek-v4-flash-0731",
				responseFormat: {
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
				forbiddenFieldPresence: {
					parallelToolCalls: false,
					tools: false,
					toolChoice: false,
					plugins: false,
				},
			});
			expect(JSON.stringify(request)).not.toContain(ROOT_EVAL_LIVE_BUGGY_REPLACEMENT);
			expect(JSON.stringify(request)).not.toContain("Managed cloud PostgreSQL must admit");
			expect(graphResult.observations.length).toBeGreaterThan(0);
			expect(
				graphResult.observations.every((event) => event.msg[0] === "DATA" && event.tier === 3),
			).toBe(true);
			expect(graphResult.finding.providerOutcomeReasonCounts).toMatchObject({
				"tool-proposed": 1,
				"executor-failed": 29,
			});
			const admission = evaluateRootEvalLiveAdmission({
				...liveEvidenceInput(),
				graphResult,
				partialGraphObservations: graphResult.observations,
			});
			expect(admission.admissionReport.violationCodes).not.toContain("success.graph-shape-invalid");
			expect(verified?.status).toBe("completed");
			expect(verified?.evidence.diff).toBe("scoped-change");
			expect(verified?.evidence.expectedDigest).not.toBe(verified?.evidence.actualDigest);
			expect(verified?.evidence.publicSemantic).toBe("equivalent");
			expect(verified?.evidence.hiddenVerifier).toBe("pass");
			expect(executor.providerRequestSummaries()).toHaveLength(1);
		} finally {
			await executor.dispose();
			await rm(temporary, { recursive: true, force: true });
		}
	}, 420_000);

	it("qualifies the independent withheld verifier against four real workspace variants", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "graphrefly-root-eval-withheld-"));
		try {
			expect(
				await qualifyRootEvalWithheldVerifier({
					repositoryRoot,
					materializationRoot: join(temporary, "workspaces"),
				}),
			).toEqual({
				correct: { public: true, hidden: true },
				equivalent: { public: true, hidden: true },
				bug: { public: false, hidden: false },
				publicFixtureSpecialCase: { public: true, hidden: false },
			});
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	}, 420_000);

	it("binds D125 zero-BYOK and current-key admission to the same Local Eval 2 credential", async () => {
		const credential = parseRootEvalLiveCredential(
			new TextEncoder().encode("OPENROUTER_API_KEY=sk-or-v1-a44-middle-credential-e06\n"),
		);
		const nowMs = Date.now();
		const zeroByok = admitRootEvalLiveZeroByok({
			credential,
			nowMs,
			bytes: new TextEncoder().encode(
				JSON.stringify({
					schemaVersion: ROOT_EVAL_LIVE_ZERO_BYOK_SCHEMA,
					decisionRef: "graphrefly-ts:D125",
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
					observedAt: new Date(nowMs).toISOString(),
					keyVisiblePrefix: "sk-or-v1-a44",
					keyVisibleSuffix: "e06",
					allowedModels: ["deepseek/deepseek-v4-flash-0731"],
					allowedProviders: ["Fireworks"],
				}),
			),
		});
		expect(zeroByok.byokCredentialCount).toBe(0);
		expect(() =>
			admitRootEvalLiveZeroByok({
				credential,
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

	it("keeps historical D85 coordinates inspectable but rejects their reuse by D125", async () => {
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
			const graphResult: RootEvalRunResult = Object.freeze({
				finding: Object.freeze({
					kind: "eval-efficacy-finding" as const,
					campaignRef: ROOT_EVAL_LIVE_GENERATION_REF,
					replicateCount: 5,
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
						"relevant-applied": 5,
						"proposal-only": 0,
						"admission-rejected": 0,
						"irrelevant-applied": 0,
						"wrong-scope-applied": 0,
					}),
					verificationDiagnostics,
					completedWorkItems: 30,
					admittedAttempts: 30,
					providerCallCount: 30,
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
				peakConcurrentEffects: 6,
				executedAdmissionIds: admissionIds(),
			});
			const evidence = constructRootEvalLiveEvidence({
				claim,
				currentKeyBefore,
				currentKeyAfter,
				pricing: pricingObservation,
				zeroByok,
				providerCalls: 30,
				graphResult,
				partialGraphObservations: graphResult.observations,
				failure: null,
				cleanupDisposition: "complete",
			});
			expect(evidence.efficacyClaim).toBe("frozen-task-positive-differential");
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
			).rejects.toThrow(/committed D125 claim/u);
			await expect(
				Promise.all([
					persistRootEvalLiveEvidence({ privateRoot, evidence }),
					persistRootEvalLiveEvidence({ privateRoot, evidence }),
				]),
			).rejects.toThrow(/committed D125 claim/u);
			await expect(
				persistRootEvalLiveEvidence({
					privateRoot,
					evidence: { ...evidence, disposition: "partial-failure" },
				}),
			).rejects.toThrow(/evidence.*invalid|committed D125 claim/u);
			expect(await readdir(privateRoot)).toEqual([]);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	it("rejects stale preclaim coordinates before creating a D125 disposition", async () => {
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
