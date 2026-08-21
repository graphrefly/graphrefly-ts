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
	D41_INSPECTION_MAX_OUTPUT_TOKENS,
	D41_MUTATION_MAX_OUTPUT_TOKENS,
} from "./d41-phase-specific-inference-authority.js";

export const D42_DECISION_REF = "graphrefly-ts:D42" as const;
export const D42_LIVE_APPROVAL_REVISION = "graphrefly-ts:D42.2026-08-20.v1" as const;
export const D42_BASELINE_COMMIT = "169dc73360757629ddc11d193642f21e190fbd32" as const;
export const D42_D41_ARTIFACT_DIGEST =
	"sha256:0bef40ac75c7012a0b21c6ee137843d2a86e060ef9f1a44af3c467207cffb5be" as const;
export const D42_D41_BUNDLE_DIGEST =
	"sha256:84b3989b0b09dcf67b341a130351ed538b3c2eb2a1848ad80b03aaab23247fe7" as const;
export const D42_D41_MAIN_EVIDENCE_DIGEST =
	"sha256:5b010ea582f13f1a6803d2608f2c64d35d169ac074acd6ead8a4c22af0799050" as const;
export const D42_D41_GENERATION_DIGEST =
	"sha256:252d41e48c60af677dccb3651e061cc0b474a97433059a1548248ee0786272e7" as const;
export const D42_D41_QUALIFICATION_DIGEST =
	"sha256:d4f97f4ea0f8951f697200f7d5008e8a688265499aa092157460d2f8cc801585" as const;
export const D42_D41_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:e536b79fe5b07d04bbecfe4a6bed69e9f2db9d8809357d2920be7bbed982bd1e" as const;
export const D42_GENERATION_REF =
	"current-graph-native-phase-specific-inference-live-2026-08-20-d42-v1" as const;
export const D42_QUALIFICATION_GENERATION_REF =
	"current-graph-native-phase-specific-inference-live-no-network-2026-08-20-d42-v1" as const;
export const D42_DISPATCH_CLAIM_REF =
	"current-graph-native-phase-specific-inference-live-dispatch-2026-08-20-d42-v1" as const;

/** D13's exact provider-effect deadline, isolated from historical/current D8 coordinates. */
export const D42_REPAIRED_LIVE_LIMITS = Object.freeze({
	...CURRENT_GRAPH_LIVE_LIMITS,
	providerMaxElapsedMs: 120_000,
}) satisfies CurrentGraphProviderBudgetLimitsV1;

export const D42_COORDINATES = strictSnapshot({
	decisionRef: D42_DECISION_REF,
	liveApprovalRevision: D42_LIVE_APPROVAL_REVISION,
	baselineCommit: D42_BASELINE_COMMIT,
	d41ArtifactDigest: D42_D41_ARTIFACT_DIGEST,
	d41BundleDigest: D42_D41_BUNDLE_DIGEST,
	d41MainEvidenceDigest: D42_D41_MAIN_EVIDENCE_DIGEST,
	d41GenerationDigest: D42_D41_GENERATION_DIGEST,
	d41QualificationDigest: D42_D41_QUALIFICATION_DIGEST,
	d41ImplementationManifestDigest: D42_D41_IMPLEMENTATION_MANIFEST_DIGEST,
	inspectionMaxOutputTokens: D41_INSPECTION_MAX_OUTPUT_TOKENS,
	mutationMaxOutputTokens: D41_MUTATION_MAX_OUTPUT_TOKENS,
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
	limits: D42_REPAIRED_LIVE_LIMITS,
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

export const D42_COORDINATES_DIGEST = empiricalStrictJsonDigest(D42_COORDINATES);
