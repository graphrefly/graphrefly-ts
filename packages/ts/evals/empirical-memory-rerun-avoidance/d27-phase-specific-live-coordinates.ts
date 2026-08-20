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

export const D27_DECISION_REF = "graphrefly-ts:D33" as const;
export const D27_BASELINE_COMMIT = "75bb74d5b4d44ac45cf8a373d948d44bff802a3e" as const;
export const D27_LIVE_APPROVAL_REVISION = "graphrefly-ts:D33.2026-08-20.v1" as const;
export const D27_D32_ARTIFACT_DIGEST =
	"sha256:6bf6852b3946aecb2e30792a24b3f9411f0673204ab71cc1cd25545d48ecf66b" as const;
export const D27_D32_BUNDLE_DIGEST =
	"sha256:3c6caad66ad35c501378b9a8606f1bbd604527b575e047391c95e4b2d51aad1c" as const;
export const D27_D32_QUALIFICATION_DIGEST =
	"sha256:fc473825984216dc52f984fd8beb5295ffd757dc263199ae5f1211009a697f93" as const;
export const D27_D32_GENERATION_DIGEST =
	"sha256:1945cd659bce4da7c6864cfa56fe8ed52f89937f991b2c315deeee4321d7341a" as const;
export const D27_D32_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:5a678e88fa868d21b6c8a959189ce1bc189e81b7554dbcf4d12a83d4b1e6f3f4" as const;
export const D27_D31_ARTIFACT_DIGEST =
	"sha256:017ce5894619fa08c853ea54f26d1f8216fbb55891db73da6f9b69b9b3c5841d" as const;
export const D27_D31_BUNDLE_DIGEST =
	"sha256:6ae7584d2babf6012cc06944d15aa3cfc84deba13aef40c250f22b109c1f7cb3" as const;
export const D27_D31_GRAPH_EVIDENCE_DIGEST =
	"sha256:b134a0d0d93962792b0917b1ad7c7f67d0f875940caa0e9ee665aafcd769b627" as const;
export const D27_D31_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:f1215f5968678f7f521b7161bb6519a71067a4ad5bde09ab0083291d0f5d1a20" as const;
export const D27_D31_QUALIFICATION_DIGEST =
	"sha256:cb382d96e71f5b6fb0ff207255a63affa4b4be6061736ec270ca617d45be3697" as const;
export const D27_D31_GENERATION_DIGEST =
	"sha256:50c995034c9560eeefccaf78c599e48a5e9595ab0fd0523c73b2399fb6e18b10" as const;
export const D27_D31_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:260d9777ed7d5bc580d4cc79841cd5443bc8cb396d8019f09ac41278b4d6c847" as const;
export const D27_GENERATION_REF =
	"current-graph-native-phase-specific-live-2026-08-20-d33-v1" as const;
export const D27_QUALIFICATION_GENERATION_REF =
	"current-graph-native-phase-specific-live-no-network-2026-08-20-d33-v2" as const;
export const D27_DISPATCH_CLAIM_REF =
	"current-graph-native-phase-specific-live-dispatch-2026-08-20-d33-v1" as const;

export const D27_LIMITS = Object.freeze({
	...D21_LIMITS,
	providerMaxElapsedMs: 120_000,
});

export const D27_COORDINATES = strictSnapshot({
	decisionRef: D27_DECISION_REF,
	liveApprovalRevision: D27_LIVE_APPROVAL_REVISION,
	baselineCommit: D27_BASELINE_COMMIT,
	d32ArtifactDigest: D27_D32_ARTIFACT_DIGEST,
	d32BundleDigest: D27_D32_BUNDLE_DIGEST,
	d32QualificationDigest: D27_D32_QUALIFICATION_DIGEST,
	d32GenerationDigest: D27_D32_GENERATION_DIGEST,
	d32ImplementationManifestDigest: D27_D32_IMPLEMENTATION_MANIFEST_DIGEST,
	d31ArtifactDigest: D27_D31_ARTIFACT_DIGEST,
	d31BundleDigest: D27_D31_BUNDLE_DIGEST,
	d31GraphEvidenceDigest: D27_D31_GRAPH_EVIDENCE_DIGEST,
	d31QualificationArtifactDigest: D27_D31_QUALIFICATION_ARTIFACT_DIGEST,
	d31QualificationDigest: D27_D31_QUALIFICATION_DIGEST,
	d31GenerationDigest: D27_D31_GENERATION_DIGEST,
	d31ImplementationManifestDigest: D27_D31_IMPLEMENTATION_MANIFEST_DIGEST,
	requestModel: CURRENT_GRAPH_LIVE_REQUEST_MODEL,
	selectedEndpointModel: CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
	provider: CURRENT_GRAPH_LIVE_PROVIDER_NAME,
	providerTag: CURRENT_GRAPH_LIVE_PROVIDER_TAG,
	quantization: CURRENT_GRAPH_LIVE_QUANTIZATION,
	endpoint: CURRENT_GRAPH_LIVE_ENDPOINT,
	pricingSource: CURRENT_GRAPH_LIVE_PRICING_SOURCE,
	pricing: CURRENT_GRAPH_LIVE_PRICING,
	routeDigest: CURRENT_GRAPH_LIVE_ROUTE.routeDigest,
	limits: D27_LIMITS,
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
