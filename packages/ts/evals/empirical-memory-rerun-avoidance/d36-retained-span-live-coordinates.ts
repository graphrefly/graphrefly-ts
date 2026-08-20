import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { CURRENT_GRAPH_ARMS } from "./d5-graph-native-eval-authority.js";
import {
	CURRENT_GRAPH_LIVE_ENDPOINT,
	CURRENT_GRAPH_LIVE_LIMITS,
	CURRENT_GRAPH_LIVE_PRICING,
	CURRENT_GRAPH_LIVE_PRICING_SOURCE,
	CURRENT_GRAPH_LIVE_PROVIDER_NAME,
	CURRENT_GRAPH_LIVE_PROVIDER_TAG,
	CURRENT_GRAPH_LIVE_QUANTIZATION,
	CURRENT_GRAPH_LIVE_REASONING_EFFORT,
	CURRENT_GRAPH_LIVE_REQUEST_MODEL,
	CURRENT_GRAPH_LIVE_ROUTE,
	CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
} from "./d8-current-live-coordinates.js";
import { D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST } from "./d21-current-efficacy-recovery-authority.js";

export const D36_DECISION_REF = "graphrefly-ts:D36" as const;
export const D36_LIVE_APPROVAL_REVISION = "graphrefly-ts:D36.2026-08-20.v1" as const;
export const D36_BASELINE_COMMIT = "e988b032de8bbcedd0bed88e079c1305a4813f37" as const;
export const D36_D35_ARTIFACT_DIGEST =
	"sha256:8582c8148f7bdefab5d39a5a23990fb6d2d4bb3ebb3b47ba4f294e2aa3ab07a6" as const;
export const D36_D35_BUNDLE_DIGEST =
	"sha256:bcec8fd996106a40c173eb67dff2e296b932644719d63c424ec15b68fe0a2afb" as const;
export const D36_D35_QUALIFICATION_DIGEST =
	"sha256:93ff339b6577dbdf84a62d7b872ed652b047bb1686b72a664f7dcb54cbcab7c8" as const;
export const D36_D35_GENERATION_DIGEST =
	"sha256:5064749391dc044f8e312298aeb70b71d8b1f7c88cb8f964d911405b8618375c" as const;
export const D36_D35_EVIDENCE_DIGEST =
	"sha256:503ed74353f7de95ffc7c18c274e2c9e3e9327cfda9260e4aee0176ec0af6933" as const;
export const D36_D35_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:e881619fedb65b81b8fd27dfac3a947de466b641eed332cd8801b86e55747eb3" as const;
export const D36_GENERATION_REF =
	"current-graph-native-retained-span-live-2026-08-20-d36-v1" as const;
export const D36_QUALIFICATION_GENERATION_REF =
	"current-graph-native-retained-span-live-no-network-2026-08-20-d36-v1" as const;
export const D36_DISPATCH_CLAIM_REF =
	"current-graph-native-retained-span-live-dispatch-2026-08-20-d36-v1" as const;

export const D36_COORDINATES = strictSnapshot({
	decisionRef: D36_DECISION_REF,
	liveApprovalRevision: D36_LIVE_APPROVAL_REVISION,
	baselineCommit: D36_BASELINE_COMMIT,
	d35ArtifactDigest: D36_D35_ARTIFACT_DIGEST,
	d35BundleDigest: D36_D35_BUNDLE_DIGEST,
	d35QualificationDigest: D36_D35_QUALIFICATION_DIGEST,
	d35GenerationDigest: D36_D35_GENERATION_DIGEST,
	d35EvidenceDigest: D36_D35_EVIDENCE_DIGEST,
	d35ImplementationManifestDigest: D36_D35_IMPLEMENTATION_MANIFEST_DIGEST,
	requestModel: CURRENT_GRAPH_LIVE_REQUEST_MODEL,
	selectedEndpointModel: CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
	provider: CURRENT_GRAPH_LIVE_PROVIDER_NAME,
	providerTag: CURRENT_GRAPH_LIVE_PROVIDER_TAG,
	quantization: CURRENT_GRAPH_LIVE_QUANTIZATION,
	endpoint: CURRENT_GRAPH_LIVE_ENDPOINT,
	reasoningEffort: CURRENT_GRAPH_LIVE_REASONING_EFFORT,
	pricingSource: CURRENT_GRAPH_LIVE_PRICING_SOURCE,
	pricing: CURRENT_GRAPH_LIVE_PRICING,
	routeDigest: CURRENT_GRAPH_LIVE_ROUTE.routeDigest,
	limits: CURRENT_GRAPH_LIVE_LIMITS,
	armOrder: CURRENT_GRAPH_ARMS,
	maxActiveArms: 1,
	coldCensorsWarm: false,
	retryPolicies: ["D671", "D675", "D710"],
	blockHardCapMicrousd: 6_000_000,
	localEvalNoResetLimitMicrousd: 32_000_000,
	fallbackAllowed: false,
	providerModelRouteSwitchAllowed: false,
	parallelOrBackgroundAllowed: false,
	automaticRerunAllowed: false,
	gateDefinitionDigest: D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
	causalAttribution: "undetermined",
});

export const D36_COORDINATES_DIGEST = empiricalStrictJsonDigest(D36_COORDINATES);
