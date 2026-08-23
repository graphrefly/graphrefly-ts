import { empiricalStrictJsonDigest } from "./canonical.js";
import { CURRENT_IMPLEMENTATION_MANIFEST_DIGEST } from "./implementation-manifest.js";

export const MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT = Object.freeze({
	schemaVersion: "graphrefly-ts.model-harness-profile-no-network-qa.v2" as const,
	decisionRef: "graphrefly-ts:D72" as const,
	clarificationRef: "graphrefly-ts:D74" as const,
	artifactRef: "model-harness-profile.deepseek-v4-flash-0731.deepinfra-fp8.no-network.v1",
	implementationManifestDigest: CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
	targetRef: "model-target.deepseek-v4-flash-0731",
	modelRef: "deepseek/deepseek-v4-flash-0731",
	modelRevision: "0731",
	providerRef: "deepinfra/fp8",
	caseResults: Object.freeze({
		exact: "eligible" as const,
		missing: "no-exact-qualified-profile" as const,
		ambiguous: "ambiguous-exact-qualified-profile" as const,
		conflictingCurrentEligibility: "ambiguous-exact-qualified-profile" as const,
		stale: "qualification-stale" as const,
		digestMismatch: "tuple-digest-mismatch" as const,
		denied: "current-eligibility-denied" as const,
	}),
	resolverDeterministic: true as const,
	graphEligibilityAdmissionOnly: true as const,
	callerIssuedEligibilityRejected: true as const,
	callerRebasedManifestRejected: true as const,
	fullQualifiedTuplePolicyLocked: true as const,
	providerBindingMechanicsLoadBearing: true as const,
	d64ToD72ExecutionShapeTransitionQualified: true as const,
	d64ToD72ExecutionShapeTransitionTamperRejected: true as const,
	credentialAccessed: false as const,
	providerNetworkAccessed: false as const,
	liveEvaluationExecuted: false as const,
});

export const MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT_DIGEST = empiricalStrictJsonDigest(
	MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT,
);
