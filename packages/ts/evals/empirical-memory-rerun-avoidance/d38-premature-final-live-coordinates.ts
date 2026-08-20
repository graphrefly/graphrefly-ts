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

export const D38_DECISION_REF = "graphrefly-ts:D38" as const;
export const D38_LIVE_APPROVAL_REVISION = "graphrefly-ts:D38.2026-08-20.v2" as const;
export const D38_BASELINE_COMMIT = "4e3b57b95db3ee52acf77b7d32527f0b74c08f53" as const;
export const D38_D37_ARTIFACT_DIGEST =
	"sha256:7c2a4329ffd738d768c803ae319320b6cb10d33211b2306db62f5945ffaa333a" as const;
export const D38_D37_BUNDLE_DIGEST =
	"sha256:95ff09d920e5bb95418bc12944c838092d3c3fe504d62d90f8238efa46a6b54e" as const;
export const D38_D37_QUALIFICATION_DIGEST =
	"sha256:74126c1c21b937f7d506fc28886521e0c98caa208fe7bf86ab1fff65b6cea0cb" as const;
export const D38_D37_GENERATION_DIGEST =
	"sha256:f06ea9070841ffc47da729265676a4f8ddf6f3af0e01675658b567a18a8424e5" as const;
export const D38_D37_EVIDENCE_DIGEST =
	"sha256:7478c3ed6a0faab982b49bbbf2f1165dc9fb674743ac1c0321cf621d0edb30cb" as const;
export const D38_D37_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:6b317d45be7d80435d68ad000f333049b3c802418c8db8d7e20c211533c77b23" as const;
export const D38_GENERATION_REF =
	"current-graph-native-premature-final-live-2026-08-20-d38-v2" as const;
export const D38_QUALIFICATION_GENERATION_REF =
	"current-graph-native-premature-final-live-no-network-2026-08-20-d38-v5" as const;
export const D38_DISPATCH_CLAIM_REF =
	"current-graph-native-premature-final-live-dispatch-2026-08-20-d38-v2" as const;

/** D13's exact provider-effect deadline, isolated from historical/current D8 coordinates. */
export const D38_REPAIRED_LIVE_LIMITS = Object.freeze({
	...CURRENT_GRAPH_LIVE_LIMITS,
	providerMaxElapsedMs: 120_000,
}) satisfies CurrentGraphProviderBudgetLimitsV1;

export const D38_COORDINATES = strictSnapshot({
	decisionRef: D38_DECISION_REF,
	liveApprovalRevision: D38_LIVE_APPROVAL_REVISION,
	baselineCommit: D38_BASELINE_COMMIT,
	d37ArtifactDigest: D38_D37_ARTIFACT_DIGEST,
	d37BundleDigest: D38_D37_BUNDLE_DIGEST,
	d37QualificationDigest: D38_D37_QUALIFICATION_DIGEST,
	d37GenerationDigest: D38_D37_GENERATION_DIGEST,
	d37EvidenceDigest: D38_D37_EVIDENCE_DIGEST,
	d37ImplementationManifestDigest: D38_D37_IMPLEMENTATION_MANIFEST_DIGEST,
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
	limits: D38_REPAIRED_LIVE_LIMITS,
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

export const D38_COORDINATES_DIGEST = empiricalStrictJsonDigest(D38_COORDINATES);
