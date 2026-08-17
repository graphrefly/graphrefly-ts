import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	CURRENT_GRAPH_LIVE_PRICING,
	CURRENT_GRAPH_LIVE_ROUTE,
	CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
} from "./d8-current-live-coordinates.js";
import { D17_ARMS } from "./d17-current-efficacy-authority.js";
import {
	D21_LIMITS,
	D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
} from "./d21-current-efficacy-recovery-authority.js";

export const D23_DECISION_REF = "graphrefly-ts:D23" as const;
export const D23_BASELINE_COMMIT = "c772c117feb184881ad47357630ae0e1fe3c2e01" as const;
export const D23_D22_ARTIFACT_DIGEST =
	"sha256:e0a23dd452df02368fb28d388792f09a6abbd088b4f44cfce2d98b60562023be" as const;
export const D23_D22_BUNDLE_DIGEST =
	"sha256:378d38efa94cfaf3b22be77f5a4961c08b7c78c2c772ec829cfc2f6e39930af2" as const;
export const D23_D22_QUALIFICATION_DIGEST =
	"sha256:3f8eaa2e9cb333990abc4cf5e8fb71bb036f21632ff63aa46dc8e0716b579b70" as const;
export const D23_D22_GENERATION_DIGEST =
	"sha256:37cd73ecd45fd73646baa49b8a20cf2d0fd480c7cde4f5d142372283842e80ce" as const;
export const D23_D22_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:131e279b0d280c83c9bb6f194d57cf47f16e89301792d00e38000885ff1c332a" as const;

export const D23_REQUEST_MODEL = "deepseek/deepseek-v4-flash-0731" as const;
export const D23_SELECTED_ENDPOINT_MODEL = CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL;
export const D23_PROVIDER = "DeepInfra" as const;
export const D23_PROVIDER_TAG = "deepinfra/fp8" as const;
export const D23_QUANTIZATION = "fp8" as const;
export const D23_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions" as const;
export const D23_PRICING_SOURCE =
	"https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints" as const;
export const D23_GENERATION_REF = "current-graph-native-efficacy-live-2026-08-16-d23-v1" as const;
export const D23_QUALIFICATION_GENERATION_REF =
	"current-graph-native-efficacy-live-no-network-2026-08-16-d23-v3" as const;
export const D23_DISPATCH_CLAIM_REF =
	"current-graph-native-efficacy-live-dispatch-2026-08-16-d23-v1" as const;

export const D23_COORDINATES = strictSnapshot({
	decisionRef: D23_DECISION_REF,
	baselineCommit: D23_BASELINE_COMMIT,
	d22ArtifactDigest: D23_D22_ARTIFACT_DIGEST,
	d22BundleDigest: D23_D22_BUNDLE_DIGEST,
	d22QualificationDigest: D23_D22_QUALIFICATION_DIGEST,
	d22GenerationDigest: D23_D22_GENERATION_DIGEST,
	d22ImplementationManifestDigest: D23_D22_IMPLEMENTATION_MANIFEST_DIGEST,
	requestModel: D23_REQUEST_MODEL,
	selectedEndpointModel: D23_SELECTED_ENDPOINT_MODEL,
	provider: D23_PROVIDER,
	providerTag: D23_PROVIDER_TAG,
	quantization: D23_QUANTIZATION,
	endpoint: D23_ENDPOINT,
	pricingSource: D23_PRICING_SOURCE,
	pricing: CURRENT_GRAPH_LIVE_PRICING,
	routeDigest: CURRENT_GRAPH_LIVE_ROUTE.routeDigest,
	limits: D21_LIMITS,
	armOrder: D17_ARMS,
	maxActiveArms: 1,
	coldCensorsWarm: false,
	retryPolicies: ["D671", "D675", "D710"],
	ordinaryProviderDeadlineMs: 120_000,
	semanticCorrectionProviderDeadlineMs: 240_000,
	blockHardCapMicrousd: 6_000_000,
	localEvalNoResetLimitMicrousd: 32_000_000,
	fallbackAllowed: false,
	providerModelRouteSwitchAllowed: false,
	parallelOrBackgroundAllowed: false,
	automaticRerunAllowed: false,
	gateDefinitionDigest: D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
	causalAttribution: "undetermined",
});

export const D23_COORDINATES_DIGEST = empiricalStrictJsonDigest(D23_COORDINATES);
