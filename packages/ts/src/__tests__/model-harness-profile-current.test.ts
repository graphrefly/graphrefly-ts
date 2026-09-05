import { describe, expect, it } from "vitest";
import { createCurrentExactModelHarnessProfileInput } from "../../evals/graph-native-rerun-avoidance/current-exact-profile.js";
import {
	createRootEvalTopology,
	ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
} from "../../evals/graph-native-rerun-avoidance/eval-topology.js";
import {
	createDeepSeekV4Flash0731FireworksStructuredProfileDefinition,
	createDeepSeekV4Flash0731TogetherStructuredProfileDefinition,
	createInjectedNoNetworkProfileQualification,
	createProviderBinding,
	deterministicProfileResolver,
	exactQualifiedProfileCatalogInput,
} from "../../evals/graph-native-rerun-avoidance/model-harness-profile.js";
import {
	MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT,
	MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT_DIGEST,
} from "../../evals/graph-native-rerun-avoidance/model-harness-profile-qualification.js";

describe("current exact model-harness profile inside the root Eval Graph (D72/D74/D76/D87)", () => {
	it("makes Together the single current route without fallback", () => {
		const current = createCurrentExactModelHarnessProfileInput();
		const definition = createDeepSeekV4Flash0731TogetherStructuredProfileDefinition();
		const qualification = createInjectedNoNetworkProfileQualification({
			definition,
			implementationManifestDigest: current.currentImplementationManifestDigest,
			qualificationArtifactDigest: MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT_DIGEST,
		});
		const candidate = exactQualifiedProfileCatalogInput(
			{ ...definition, qualification },
			current.currentImplementationManifestDigest,
		);
		expect(candidate.targets).toEqual(current.targets);
		expect(candidate.profiles).toEqual(current.profiles);
		expect(current.bindings[0]!.providerRef).toBe("together");
		expect(qualification.qualificationRef).toContain("together-structured");
		expect(qualification).toMatchObject({
			qualificationMode: "injected-no-network",
			credentialAccessed: false,
			providerNetworkAccessed: false,
			liveEvaluationExecuted: false,
		});
		const topology = createRootEvalTopology({
			profileInput: candidate,
			currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
		});
		expect(
			topology.graph.describe().nodes.find((node) => node.id === "eval/profile/graph-admission")
				?.value,
		).toMatchObject({ resolution: { status: "eligible", providerRef: "together" } });
		const fireworks = createDeepSeekV4Flash0731FireworksStructuredProfileDefinition();
		const { bindingDigest: _digest, ...binding } = definition.binding;
		for (const profileInput of [
			{ ...candidate, bindings: [fireworks.binding] },
			{
				...candidate,
				bindings: [createProviderBinding({ ...binding, providerRef: "deepinfra/fp8" })],
			},
			{ ...candidate, currentEligibility: [{}] } as never,
		])
			expect(() =>
				createRootEvalTopology({
					profileInput,
					currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
				}),
			).toThrow();
	});

	it("admits only the exact no-network-qualified tuple and rejects caller authority", () => {
		const catalog = createCurrentExactModelHarnessProfileInput();
		const topology = createRootEvalTopology({
			profileInput: catalog,
			currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
		});
		const admission = topology.graph
			.describe()
			.nodes.find((node) => node.id === "eval/profile/graph-admission")?.value;

		expect(admission).toMatchObject({
			kind: "root-eval-profile-admission",
			eligibility: {
				status: "eligible",
				reasonCode: "root-graph-exact-profile-current",
			},
			resolution: {
				status: "eligible",
				providerRef: "together",
				targetRef: "model-target.deepseek-v4-flash-0731",
			},
		});
		expect(catalog.qualifications[0]).toMatchObject({
			qualificationMode: "injected-no-network",
			qualificationArtifactDigest: MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT_DIGEST,
			credentialAccessed: false,
			providerNetworkAccessed: false,
			liveEvaluationExecuted: false,
		});
		expect(MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT).toMatchObject({
			graphEligibilityAdmissionOnly: true,
			callerIssuedEligibilityRejected: true,
			callerRebasedManifestRejected: true,
			providerBindingMechanicsLoadBearing: true,
			strictStructuredProposalEncodingQualified: true,
			legacyToolCallEncodingRejected: true,
		});
		expect(catalog.bindings[0]).toMatchObject({
			providerRef: "together",
			proposalEncoding: "strict-json-schema",
			responseContractRevision: "occurrence-bound-candidate-selection.v4",
		});
		for (const profileInput of [
			{ ...catalog, currentEligibility: [{}] } as never,
			{ ...catalog, currentImplementationManifestDigest: "sha256:caller-rebased" },
		])
			expect(() =>
				createRootEvalTopology({
					profileInput,
					currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
				}),
			).toThrow();
	});

	it("keeps deterministic resolution fail-closed when the Graph eligibility is absent", () => {
		const catalog = createCurrentExactModelHarnessProfileInput();
		const resolution = deterministicProfileResolver.resolve({
			...catalog,
			currentEligibility: [],
		});
		expect(resolution).toMatchObject({
			status: "ineligible",
			failureCode: MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT.caseResults.missing,
		});
	});
});
