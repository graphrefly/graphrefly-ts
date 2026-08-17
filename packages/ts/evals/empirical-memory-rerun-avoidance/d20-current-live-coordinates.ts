import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D17_ARMS,
	D17_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
} from "./d17-current-efficacy-authority.js";
import { D18_LIMITS, D18_ROUTE } from "./d18-current-provider-composition-authority.js";

export const D20_DECISION_REF = "graphrefly-ts:D20" as const;
export const D20_BASELINE_COMMIT = "c2a7350347cd1e6ca9c2f472a00b2ffdeabc29ba" as const;
export const D20_D19_ARTIFACT_DIGEST =
	"sha256:44d3ae30c1b20b6800378fd467a77a8b5c7b2a85e2bf73752bf95789e8563e35" as const;
export const D20_D19_BUNDLE_DIGEST =
	"sha256:c71f7a8c4ec81ed989fac2b7e75db11ce5394823ecc17bed60b412a5dd18bfb1" as const;
export const D20_D19_QUALIFICATION_DIGEST =
	"sha256:fb5628a25c7800da2a3b309f19f74263c31116a28e74510e244c2dc967eb8d55" as const;
export const D20_D19_GENERATION_DIGEST =
	"sha256:5c923865fdf5a9cc405cd1eae52bdda6cb20b1f8fb9c82ff268ce9f58894c303" as const;
export const D20_D19_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:ec1363d8a6b81a8dfad9d79ce79e9c71d0743a9655cc3409a922110c47f1a317" as const;

export const D20_REQUEST_MODEL = D18_ROUTE.model;
export const D20_SELECTED_ENDPOINT_MODEL = D18_ROUTE.selectedModel;
export const D20_PROVIDER = D18_ROUTE.provider;
export const D20_PROVIDER_TAG = D18_ROUTE.providerTag;
export const D20_QUANTIZATION = "fp8" as const;
export const D20_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions" as const;
export const D20_PRICING_SOURCE =
	"https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints" as const;
export const D20_PRICING_REVISION = D18_ROUTE.pricing.revision;
export const D20_GENERATION_REF = "current-graph-native-efficacy-live-2026-08-16-d20-v1" as const;
export const D20_QUALIFICATION_GENERATION_REF =
	"current-graph-native-efficacy-live-no-network-2026-08-16-d20-v1" as const;
export const D20_DISPATCH_CLAIM_REF =
	"current-graph-native-efficacy-live-dispatch-2026-08-16-d20-v1" as const;

export const D20_COORDINATES = strictSnapshot({
	decisionRef: D20_DECISION_REF,
	baselineCommit: D20_BASELINE_COMMIT,
	d19ArtifactDigest: D20_D19_ARTIFACT_DIGEST,
	d19BundleDigest: D20_D19_BUNDLE_DIGEST,
	d19QualificationDigest: D20_D19_QUALIFICATION_DIGEST,
	d19GenerationDigest: D20_D19_GENERATION_DIGEST,
	d19ImplementationManifestDigest: D20_D19_IMPLEMENTATION_MANIFEST_DIGEST,
	requestModel: D20_REQUEST_MODEL,
	selectedEndpointModel: D20_SELECTED_ENDPOINT_MODEL,
	provider: D20_PROVIDER,
	providerTag: D20_PROVIDER_TAG,
	quantization: D20_QUANTIZATION,
	endpoint: D20_ENDPOINT,
	pricingSource: D20_PRICING_SOURCE,
	pricingRevision: D20_PRICING_REVISION,
	pricing: D18_ROUTE.pricing,
	limits: D18_LIMITS,
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
	gateDefinitionDigest: D17_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
	causalAttribution: "undetermined",
});

export const D20_COORDINATES_DIGEST = empiricalStrictJsonDigest(D20_COORDINATES);
