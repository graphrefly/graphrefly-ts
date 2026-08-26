import { describe, expect, it } from "vitest";
import { createCurrentExactModelHarnessProfileInput } from "../../evals/graph-native-rerun-avoidance/current-exact-profile.js";
import {
	createRootEvalTopology,
	ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
} from "../../evals/graph-native-rerun-avoidance/eval-topology.js";
import { deterministicProfileResolver } from "../../evals/graph-native-rerun-avoidance/model-harness-profile.js";
import {
	MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT,
	MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT_DIGEST,
} from "../../evals/graph-native-rerun-avoidance/model-harness-profile-qualification.js";

describe("current exact model-harness profile inside the root Eval Graph (D72/D74/D76/D87)", () => {
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
				providerRef: "fireworks",
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
			providerRef: "fireworks",
			proposalEncoding: "strict-json-schema",
			responseContractRevision: "bounded-structured-proposal.v3",
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
