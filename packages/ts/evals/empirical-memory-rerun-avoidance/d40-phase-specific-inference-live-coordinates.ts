import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { CURRENT_GRAPH_ARMS } from "./d5-graph-native-eval-authority.js";
import type { CurrentGraphProviderBudgetLimitsV1 } from "./d6-current-provider-authority.js";
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
import {
	D40_INSPECTION_MAX_OUTPUT_TOKENS,
	D40_MUTATION_MAX_OUTPUT_TOKENS,
} from "./d40-phase-specific-inference-authority.js";

export const D40_DECISION_REF = "graphrefly-ts:D40" as const;
export const D40_LIVE_APPROVAL_REVISION = "graphrefly-ts:D40.2026-08-20.v1" as const;
export const D40_BASELINE_COMMIT = "c395b4abd0723c47d3cee99e8291ec0e82b7d3a9" as const;
export const D40_D39_ARTIFACT_DIGEST =
	"sha256:8ea8eea6da5dddeef51bd98309720d51477056ab908a87351c55fab7749523f3" as const;
export const D40_D39_BUNDLE_DIGEST =
	"sha256:5411d03406d94ec98c4deeff310c1ca8b983c0b891e3d746e8918d07a7c5763b" as const;
export const D40_D39_PARTIAL_GRAPH_DIGEST =
	"sha256:548a7139c430ec3e56e4ff063e5463fe4666106aa0c8e2e236952f82930937ff" as const;
export const D40_D39_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:cfcc2cc9993effc60f5784e9afeb5529efca216a3a4db8bab8cf7ae1e338ecbf" as const;
export const D40_D39_QUALIFICATION_DIGEST =
	"sha256:d0963fdb025845c530b6005a0e64eccd79313c8e7ee13f09464842814b6bc1ec" as const;
export const D40_D39_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:b1b274b69688f5381228e49dc46a9ca874617e0ddcfe600228fae6882684350c" as const;
export const D40_GENERATION_REF =
	"current-graph-native-phase-specific-inference-live-2026-08-20-d40-v1" as const;
export const D40_QUALIFICATION_GENERATION_REF =
	"current-graph-native-phase-specific-inference-live-no-network-2026-08-20-d40-v1" as const;
export const D40_DISPATCH_CLAIM_REF =
	"current-graph-native-phase-specific-inference-live-dispatch-2026-08-20-d40-v1" as const;

/** D13's exact provider-effect deadline, isolated from historical/current D8 coordinates. */
export const D40_REPAIRED_LIVE_LIMITS = Object.freeze({
	...CURRENT_GRAPH_LIVE_LIMITS,
	providerMaxElapsedMs: 120_000,
}) satisfies CurrentGraphProviderBudgetLimitsV1;

export const D40_COORDINATES = strictSnapshot({
	decisionRef: D40_DECISION_REF,
	liveApprovalRevision: D40_LIVE_APPROVAL_REVISION,
	baselineCommit: D40_BASELINE_COMMIT,
	d39ArtifactDigest: D40_D39_ARTIFACT_DIGEST,
	d39BundleDigest: D40_D39_BUNDLE_DIGEST,
	d39PartialGraphDigest: D40_D39_PARTIAL_GRAPH_DIGEST,
	d39QualificationArtifactDigest: D40_D39_QUALIFICATION_ARTIFACT_DIGEST,
	d39QualificationDigest: D40_D39_QUALIFICATION_DIGEST,
	d39ImplementationManifestDigest: D40_D39_IMPLEMENTATION_MANIFEST_DIGEST,
	inspectionMaxOutputTokens: D40_INSPECTION_MAX_OUTPUT_TOKENS,
	mutationMaxOutputTokens: D40_MUTATION_MAX_OUTPUT_TOKENS,
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
	limits: D40_REPAIRED_LIVE_LIMITS,
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

export const D40_COORDINATES_DIGEST = empiricalStrictJsonDigest(D40_COORDINATES);
