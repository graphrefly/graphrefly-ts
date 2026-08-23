import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/graph-native-rerun-avoidance/canonical.js";
import {
	createCurrentProfilePolicyAuthority,
	readCurrentProfilePolicyResolution,
} from "../../evals/graph-native-rerun-avoidance/current-profile-policy-authority.js";
import { D65_D64_BASELINE_PROJECTION } from "../../evals/graph-native-rerun-avoidance/frozen-baseline-fixture.js";
import { createGraphHarnessAuthority } from "../../evals/graph-native-rerun-avoidance/graph-harness-authority.js";
import {
	admitD45EffectResult,
	createD45GraphToolAuthority,
	D68_RESPONSE_REJECTION_CODES,
	takeD45AdmittedEffect,
} from "../../evals/graph-native-rerun-avoidance/graph-tool-authority.js";
import {
	createD45QualificationCampaign,
	createExactModelHarnessProfileInput,
	D45_READABLE_PATHS,
	D45_TASK_MATERIAL,
	D45_WRITABLE_PATH,
} from "../../evals/graph-native-rerun-avoidance/graph-tool-qualification.js";
import { createD65InjectedReplicateExecutor } from "../../evals/graph-native-rerun-avoidance/injected-replicate-executor.js";
import {
	lowerD45ProviderEffect,
	parseD45ChatProviderResponse,
} from "../../evals/graph-native-rerun-avoidance/mechanical-chat-adapter.js";
import {
	CURRENT_PROFILE_ELIGIBILITY_SCHEMA,
	createHarnessEnhancementProfile,
	createInjectedNoNetworkProfileQualification,
	createProviderBinding,
	deterministicProfileResolver,
	PROFILE_DECISION_REF,
	validateCurrentProfileEligibility,
} from "../../evals/graph-native-rerun-avoidance/model-harness-profile.js";
import {
	MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT,
	MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT_DIGEST,
} from "../../evals/graph-native-rerun-avoidance/model-harness-profile-qualification.js";
import { runD65ReplicateMeasurement } from "../../evals/graph-native-rerun-avoidance/replicate-measurement.js";
import {
	admitD65ReplicateResult,
	createD65GraphCampaignAuthority,
	createD65ReplicateCampaign,
	D65_D64_ARTIFACT_DIGEST,
	D65_D64_BUNDLE_DIGEST,
	startD65ReplicateExecution,
	takeD65AdmittedReplicate,
} from "../../evals/graph-native-rerun-avoidance/replicated-campaign-authority.js";

const pricing = Object.freeze({
	inputMicrousdPerMillionTokens: 80_000,
	outputMicrousdPerMillionTokens: 180_000,
	cacheReadMicrousdPerMillionTokens: 16_000,
});
const wireDigest = empiricalStrictJsonDigest("current-response-wire");

function response(status: number, value: string | Uint8Array) {
	return parseD45ChatProviderResponse({
		responseContractRevision: "bounded-chat-response.v1",
		status,
		bytes: typeof value === "string" ? new TextEncoder().encode(value) : value,
		elapsedMs: 7,
		wireDigest,
		pricing,
	});
}

describe("current Graph-native rerun-avoidance eval", () => {
	it("classifies every bounded 2xx response defect without forging executor failure", () => {
		expect(() =>
			parseD45ChatProviderResponse({
				responseContractRevision: "wrong-response-contract",
				status: 200,
				bytes: new TextEncoder().encode("{}"),
				elapsedMs: 1,
				wireDigest,
				pricing,
			}),
		).toThrow(/response contract revision/u);
		const cases = [
			response(200, new Uint8Array(2 * 1024 * 1024 + 1)),
			response(99, "{}"),
			response(200, new Uint8Array([0xff])),
			response(200, "{"),
			response(200, "[]"),
			response(200, '{"choices":[]}'),
			response(200, '{"usage":{"prompt_tokens":-1,"completion_tokens":1},"choices":[]}'),
			response(
				200,
				'{"usage":{"prompt_tokens":1,"completion_tokens":1,"prompt_tokens_details":{"cached_tokens":2}},"choices":[]}',
			),
			response(200, '{"usage":{"prompt_tokens":1,"completion_tokens":1},"choices":[]}'),
		];
		expect(cases.map((item) => item.outcome)).toEqual(
			D68_RESPONSE_REJECTION_CODES.map(() => "schema-rejected"),
		);
		expect(cases.map((item) => item.responseRejectionCode)).toEqual(D68_RESPONSE_REJECTION_CODES);
		expect(cases.every((item) => item.proposal === null)).toBe(true);
	});

	it("admits response-schema evidence and releases a bounded Graph correction", () => {
		const campaign = createD65GraphCampaignAuthority({
			baselineArtifactDigest: D65_D64_ARTIFACT_DIGEST,
			baselineBundleDigest: D65_D64_BUNDLE_DIGEST,
			baselineProjection: D65_D64_BASELINE_PROJECTION,
			campaignMode: { executionClass: "qualification", liveClaimDigest: null },
		});
		const replicate = takeD65AdmittedReplicate(campaign);
		if (replicate === null) throw new TypeError("current test omitted replicate admission");
		const replicateCampaign = createD65ReplicateCampaign(replicate);
		const authority = createD45GraphToolAuthority({
			profileInput: createExactModelHarnessProfileInput(),
			assignmentRef: replicate.assignmentRef,
			readablePaths: D45_READABLE_PATHS,
			writablePath: D45_WRITABLE_PATH,
			taskMaterial: D45_TASK_MATERIAL,
			routeProfile: { reasoningEffort: "high", requireParameters: true },
			campaign: replicateCampaign,
		});
		const materialization = takeD45AdmittedEffect(authority);
		if (materialization?.sourceD43EffectKind !== "materialization")
			throw new TypeError("current test omitted materialization");
		const workspaceStateDigest = empiricalStrictJsonDigest("current-workspace");
		admitD45EffectResult(authority, materialization, {
			effectKind: "local-effect",
			outcome: "success",
			elapsedMs: 1,
			evidenceDigest: empiricalStrictJsonDigest("current-materialization"),
			workspaceStateDigest,
			criteria: null,
		});
		const inspection = takeD45AdmittedEffect(authority);
		if (inspection?.effectKind !== "provider-proposal" || inspection.phase !== "inspection")
			throw new TypeError("current test omitted inspection");
		const wire = lowerD45ProviderEffect(authority, inspection);
		admitD45EffectResult(
			authority,
			inspection,
			parseD45ChatProviderResponse({
				responseContractRevision: inspection.responseContractRevision,
				status: 200,
				bytes: new TextEncoder().encode('{"choices":[]}'),
				elapsedMs: 4,
				wireDigest: wire.wireDigest,
				pricing,
			}),
		);
		const correction = takeD45AdmittedEffect(authority);
		expect(correction?.effectKind).toBe("provider-proposal");
		expect(correction?.phase).toBe("inspection");
		const correctionWire = lowerD45ProviderEffect(authority, correction!);
		expect(correctionWire.body).toContain("Graph rejected the previous phase response");
	});

	it("emits monotonic material-free Graph progress through all six arms", async () => {
		const campaign = createD65GraphCampaignAuthority({
			baselineArtifactDigest: D65_D64_ARTIFACT_DIGEST,
			baselineBundleDigest: D65_D64_BUNDLE_DIGEST,
			baselineProjection: D65_D64_BASELINE_PROJECTION,
			campaignMode: { executionClass: "qualification", liveClaimDigest: null },
		});
		const admitted = takeD65AdmittedReplicate(campaign);
		if (admitted === null) throw new TypeError("current test omitted replicate admission");
		const execution = startD65ReplicateExecution(campaign, admitted);
		const injected = createD65InjectedReplicateExecutor();
		const progress: Array<{
			factSequence: number;
			completedArmCount: number;
			serialized: string;
		}> = [];
		const measurement = await runD65ReplicateMeasurement({
			executor: injected.executor,
			injectedNoNetwork: true,
			replicateExecution: execution,
			onProgress(value) {
				progress.push({
					factSequence: value.factSequence,
					completedArmCount: value.completedArmCount,
					serialized: JSON.stringify(value),
				});
			},
		});
		expect(measurement.disposition).toBe("success");
		if (measurement.disposition !== "success")
			throw new TypeError("current no-network replicate unexpectedly failed");
		admitD65ReplicateResult(
			campaign,
			execution,
			measurement.evidence,
			measurement.retryWaitElapsedMs,
		);
		expect(takeD65AdmittedReplicate(campaign)?.replicateIndex).toBe(3);
		expect(progress.length).toBeGreaterThan(12);
		expect(
			progress.every(
				(item, index) => index === 0 || item.factSequence >= progress[index - 1]!.factSequence,
			),
		).toBe(true);
		expect(progress.at(-1)?.completedArmCount).toBe(6);
		expect(
			progress.every(
				(item) => !/(oldText|newText|content|body|header|stack|error)/u.test(item.serialized),
			),
		).toBe(true);
	});

	it("resolves only one current exact-qualified profile and fails closed otherwise", () => {
		const exactCatalog = createExactModelHarnessProfileInput();
		const currentPolicy = readCurrentProfilePolicyResolution(
			createCurrentProfilePolicyAuthority(exactCatalog),
		);
		const exactInput = currentPolicy.resolverInput;
		const exact = currentPolicy.resolution;
		expect(exact.status).toBe(MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT.caseResults.exact);
		if (exact.status !== "eligible") throw new TypeError("exact profile was not eligible");
		expect(exact.providerRef).toBe("deepinfra/fp8");
		expect(exact.targetRef).toBe("model-target.deepseek-v4-flash-0731");
		expect(deterministicProfileResolver.resolve(exactInput)).toEqual(exact);
		expect(exactInput.currentEligibility).toHaveLength(1);
		expect(exactInput.currentEligibility[0]).toMatchObject({
			status: "eligible",
			reasonCode: "graph-policy-exact-profile-current",
		});
		expect(MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT).toMatchObject({
			clarificationRef: "graphrefly-ts:D74",
			graphEligibilityAdmissionOnly: true,
			callerIssuedEligibilityRejected: true,
			callerRebasedManifestRejected: true,
			fullQualifiedTuplePolicyLocked: true,
			providerBindingMechanicsLoadBearing: true,
			d64ToD72ExecutionShapeTransitionQualified: true,
			d64ToD72ExecutionShapeTransitionTamperRejected: true,
		});
		expect(exactInput.qualifications[0]).toMatchObject({
			qualificationMode: "injected-no-network",
			credentialAccessed: false,
			providerNetworkAccessed: false,
			liveEvaluationExecuted: false,
		});
		expect(exactInput.bindings[0]).not.toHaveProperty("providerDeadlineMs");
		expect(exactInput.bindings[0]).not.toHaveProperty("allowFallback");
		expect(exactInput.bindings[0]).toMatchObject({
			providerModelRef: "deepseek/deepseek-v4-flash-0731",
			responseContractRevision: "bounded-chat-response.v1",
		});
		expect(exactInput.qualifications[0]?.qualificationArtifactDigest).toBe(
			MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT_DIGEST,
		);
		const { profileDigest: _profileDigest, ...profileMaterial } = exactInput.profiles[0]!;
		const modifiedProfile = createHarnessEnhancementProfile({
			...profileMaterial,
			enhancementRecipes: exactInput.profiles[0]!.enhancementRecipes.slice(0, 1),
		});
		const modifiedProfileQualification = createInjectedNoNetworkProfileQualification({
			definition: {
				target: exactInput.targets[0]!,
				profile: modifiedProfile,
				binding: exactInput.bindings[0]!,
			},
			implementationManifestDigest: exactInput.currentImplementationManifestDigest,
			qualificationArtifactDigest: MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT_DIGEST,
		});
		expect(
			readCurrentProfilePolicyResolution(
				createCurrentProfilePolicyAuthority({
					...exactCatalog,
					profiles: [modifiedProfile],
					qualifications: [modifiedProfileQualification],
				}),
			).resolution,
		).toMatchObject({ status: "ineligible", failureCode: "no-exact-qualified-profile" });
		const { bindingDigest: _bindingDigest, ...bindingMaterial } = exactInput.bindings[0]!;
		const modifiedBinding = createProviderBinding({
			...bindingMaterial,
			namedToolChoiceEncoding: "tool-name",
		});
		const modifiedBindingQualification = createInjectedNoNetworkProfileQualification({
			definition: {
				target: exactInput.targets[0]!,
				profile: exactInput.profiles[0]!,
				binding: modifiedBinding,
			},
			implementationManifestDigest: exactInput.currentImplementationManifestDigest,
			qualificationArtifactDigest: MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT_DIGEST,
		});
		expect(
			readCurrentProfilePolicyResolution(
				createCurrentProfilePolicyAuthority({
					...exactCatalog,
					bindings: [modifiedBinding],
					qualifications: [modifiedBindingQualification],
				}),
			).resolution,
		).toMatchObject({ status: "ineligible", failureCode: "no-exact-qualified-profile" });
		const callerRebasedManifestDigest = empiricalStrictJsonDigest("caller-rebased-manifest");
		const callerRebasedQualification = createInjectedNoNetworkProfileQualification({
			definition: {
				target: exactInput.targets[0]!,
				profile: exactInput.profiles[0]!,
				binding: exactInput.bindings[0]!,
			},
			implementationManifestDigest: callerRebasedManifestDigest,
			qualificationArtifactDigest: MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT_DIGEST,
		});
		expect(
			readCurrentProfilePolicyResolution(
				createCurrentProfilePolicyAuthority({
					...exactCatalog,
					currentImplementationManifestDigest: callerRebasedManifestDigest,
					qualifications: [callerRebasedQualification],
				}),
			).resolution,
		).toMatchObject({ status: "ineligible", failureCode: "no-exact-qualified-profile" });

		const failureCode = (input: Parameters<typeof deterministicProfileResolver.resolve>[0]) => {
			const resolution = deterministicProfileResolver.resolve(input);
			if (resolution.status !== "ineligible")
				throw new TypeError("profile resolver unexpectedly admitted a negative case");
			return resolution.failureCode;
		};
		expect(failureCode({ ...exactInput, currentEligibility: [] })).toBe(
			MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT.caseResults.missing,
		);
		expect(failureCode({ ...exactInput, targets: [] })).toBe(
			MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT.caseResults.missing,
		);
		expect(
			failureCode({ ...exactInput, targets: [exactInput.targets[0]!, exactInput.targets[0]!] }),
		).toBe(MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT.caseResults.ambiguous);
		expect(
			failureCode({
				...exactInput,
				currentImplementationManifestDigest: empiricalStrictJsonDigest("stale-implementation"),
			}),
		).toBe(MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT.caseResults.stale);

		const qualification = exactInput.qualifications[0]!;
		const { qualificationDigest: _qualificationDigest, ...qualificationMaterial } = qualification;
		const mismatchedQualificationMaterial = {
			...qualificationMaterial,
			bindingDigest: empiricalStrictJsonDigest("mismatched-provider-binding"),
		};
		const mismatchedQualification = Object.freeze({
			...mismatchedQualificationMaterial,
			qualificationDigest: empiricalStrictJsonDigest(mismatchedQualificationMaterial),
		});
		expect(failureCode({ ...exactInput, qualifications: [mismatchedQualification] })).toBe(
			MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT.caseResults.digestMismatch,
		);

		const eligible = exactInput.currentEligibility[0]!;
		const { eligibilityDigest: _eligibilityDigest, ...eligibilityMaterial } = eligible;
		const deniedMaterial = {
			...eligibilityMaterial,
			schemaVersion: CURRENT_PROFILE_ELIGIBILITY_SCHEMA,
			decisionRef: PROFILE_DECISION_REF,
			eligibilityRef: "current-profile-eligibility.deepseek-v4-flash-0731.deepinfra-fp8.denied",
			status: "denied" as const,
			reasonCode: "owner-policy-denied",
		};
		const deniedEligibility = validateCurrentProfileEligibility({
			...deniedMaterial,
			eligibilityDigest: empiricalStrictJsonDigest(deniedMaterial),
		});
		const deniedInput = {
			...exactInput,
			currentEligibility: [deniedEligibility],
		};
		expect(() =>
			createGraphHarnessAuthority({
				profileInput: {
					...exactCatalog,
					currentEligibility: [deniedEligibility],
				} as never,
				campaign: createD45QualificationCampaign(),
				assignmentRef: "assignment.caller-issued-eligibility-must-not-admit",
			}),
		).toThrow(/unexpected keys/u);
		expect(
			failureCode({
				...exactInput,
				currentEligibility: [exactInput.currentEligibility[0]!, deniedEligibility],
			}),
		).toBe(MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT.caseResults.conflictingCurrentEligibility);
		expect(failureCode(deniedInput)).toBe(
			MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT.caseResults.denied,
		);
	});
});
