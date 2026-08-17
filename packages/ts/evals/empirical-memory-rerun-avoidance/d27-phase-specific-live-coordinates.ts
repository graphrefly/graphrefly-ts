import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	CURRENT_GRAPH_LIVE_ENDPOINT,
	CURRENT_GRAPH_LIVE_PRICING,
	CURRENT_GRAPH_LIVE_PRICING_SOURCE,
	CURRENT_GRAPH_LIVE_PROVIDER_NAME,
	CURRENT_GRAPH_LIVE_PROVIDER_TAG,
	CURRENT_GRAPH_LIVE_QUANTIZATION,
	CURRENT_GRAPH_LIVE_REQUEST_MODEL,
	CURRENT_GRAPH_LIVE_ROUTE,
	CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
} from "./d8-current-live-coordinates.js";
import { D17_ARMS } from "./d17-current-efficacy-authority.js";
import {
	D21_LIMITS,
	D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
} from "./d21-current-efficacy-recovery-authority.js";

export const D27_DECISION_REF = "graphrefly-ts:D29" as const;
export const D27_BASELINE_COMMIT = "2d00c3e8add339642cbf9dcabdb591c943d700d4" as const;
export const D27_D26_ARTIFACT_DIGEST =
	"sha256:8bb49cd5f725a0a5c70b3a0906a506d41473fca46f6c660e89422ea5636172e0" as const;
export const D27_D26_BUNDLE_DIGEST =
	"sha256:46283ca783c76135a8a3f74b628898c13ccea615b9bd244657716a520bf61170" as const;
export const D27_D26_QUALIFICATION_DIGEST =
	"sha256:3ff05c0be128acac7750b734e481fd09b06e2b8d9ee374150158d9c9db1056a3" as const;
export const D27_D26_GENERATION_DIGEST =
	"sha256:40813743eaa19e1f26251437ba06e3491e62546edeeebbd89dcf05668d2ec935" as const;
export const D27_D26_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:58dbe33cd14cfa26095df5505d436090488c2157e0706a562eb3f479baee5b41" as const;
export const D27_GENERATION_REF =
	"current-graph-native-phase-specific-live-2026-08-17-d29-v1" as const;
export const D27_QUALIFICATION_GENERATION_REF =
	"current-graph-native-phase-specific-live-no-network-2026-08-17-d29-v1" as const;
export const D27_DISPATCH_CLAIM_REF =
	"current-graph-native-phase-specific-live-dispatch-2026-08-17-d29-v1" as const;

export const D27_COORDINATES = strictSnapshot({
	decisionRef: D27_DECISION_REF,
	baselineCommit: D27_BASELINE_COMMIT,
	d26ArtifactDigest: D27_D26_ARTIFACT_DIGEST,
	d26BundleDigest: D27_D26_BUNDLE_DIGEST,
	d26QualificationDigest: D27_D26_QUALIFICATION_DIGEST,
	d26GenerationDigest: D27_D26_GENERATION_DIGEST,
	d26ImplementationManifestDigest: D27_D26_IMPLEMENTATION_MANIFEST_DIGEST,
	requestModel: CURRENT_GRAPH_LIVE_REQUEST_MODEL,
	selectedEndpointModel: CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
	provider: CURRENT_GRAPH_LIVE_PROVIDER_NAME,
	providerTag: CURRENT_GRAPH_LIVE_PROVIDER_TAG,
	quantization: CURRENT_GRAPH_LIVE_QUANTIZATION,
	endpoint: CURRENT_GRAPH_LIVE_ENDPOINT,
	pricingSource: CURRENT_GRAPH_LIVE_PRICING_SOURCE,
	pricing: CURRENT_GRAPH_LIVE_PRICING,
	routeDigest: CURRENT_GRAPH_LIVE_ROUTE.routeDigest,
	limits: D21_LIMITS,
	armOrder: D17_ARMS,
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

export const D27_COORDINATES_DIGEST = empiricalStrictJsonDigest(D27_COORDINATES);
