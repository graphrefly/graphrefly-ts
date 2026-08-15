import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { CURRENT_GRAPH_ARMS } from "./current-graph-native-eval-authority.js";
import {
	CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
	createCurrentGraphProviderRouteProfile,
	createCurrentGraphProviderTaskProfile,
} from "./current-graph-native-provider-authority.js";

export const CURRENT_GRAPH_LIVE_DECISION_REF = "graphrefly-ts:D4" as const;
export const CURRENT_GRAPH_LIVE_DECISION_REVISION = "2026-08-14.v1" as const;
export const CURRENT_GRAPH_LIVE_BASELINE_COMMIT =
	"0817b3eff89f7a64222e3d6011550ce25a53db59" as const;
export const CURRENT_GRAPH_LIVE_D3_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:05c521c5392000e444e0bcbadd4d1e8dfe8fc918338285a77044e8f66f6f2171" as const;
export const CURRENT_GRAPH_LIVE_D3_QUALIFICATION_BUNDLE_DIGEST =
	"sha256:f99085bf42d82d5b5a06938387b94163968196f41bbb1fdf17749419582cc6d3" as const;
export const CURRENT_GRAPH_LIVE_D3_QUALIFICATION_DIGEST =
	"sha256:55928c373f78fd4f2362d134070cf08489e6c886eb73caaca2728428bf13ca34" as const;
export const CURRENT_GRAPH_LIVE_D3_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:3f3260c8d1cbe606fa6bae7b6f2ac59d3bbc32d61635c2498b34e2fc3e0d9efb" as const;
export const CURRENT_GRAPH_LIVE_GENERATION_REF =
	"current-graph-native-live-2026-08-14-d4-v1" as const;
export const CURRENT_GRAPH_LIVE_DISPATCH_CLAIM_REF =
	"current-graph-native-live-dispatch-2026-08-14-d4-v1" as const;

export const CURRENT_GRAPH_LIVE_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions" as const;
export const CURRENT_GRAPH_LIVE_PRICING_SOURCE =
	"https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints" as const;
export const CURRENT_GRAPH_LIVE_REQUEST_MODEL = "deepseek/deepseek-v4-flash-0731" as const;
export const CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL =
	"deepseek/deepseek-v4-flash-20260731" as const;
export const CURRENT_GRAPH_LIVE_PROVIDER_NAME = "DeepInfra" as const;
export const CURRENT_GRAPH_LIVE_PROVIDER_TAG = "deepinfra/fp4" as const;
export const CURRENT_GRAPH_LIVE_QUANTIZATION = "fp4" as const;
export const CURRENT_GRAPH_LIVE_REASONING_EFFORT = "high" as const;

export const CURRENT_GRAPH_LIVE_PRICING = Object.freeze({
	revision: "openrouter-deepseek-v4-flash-0731-deepinfra-fp4-2026-08-14.v1",
	inputUsdPerToken: "0.00000008",
	outputUsdPerToken: "0.00000018",
	cacheReadUsdPerToken: "0.000000016",
	inputMicrousdPerMillionTokens: 80_000,
	outputMicrousdPerMillionTokens: 180_000,
	cacheReadMicrousdPerMillionTokens: 16_000,
});

export const CURRENT_GRAPH_LIVE_ROUTE = createCurrentGraphProviderRouteProfile({
	profileRef: "current-provider.deepseek-v4-flash-0731.deepinfra-fp4-chat.live.v1",
	// D2 names the qualified architecture, while D4 separately binds this repaired live execution.
	executionClass: "provider-capable-pre-live",
	endpointKind: "chat-completions",
	providerRef: CURRENT_GRAPH_LIVE_PROVIDER_NAME,
	modelRef: CURRENT_GRAPH_LIVE_REQUEST_MODEL,
	pricingRevision: CURRENT_GRAPH_LIVE_PRICING.revision,
	maxOutputTokens: 65_536,
});

export const CURRENT_GRAPH_LIVE_READABLE_FILES = Object.freeze([
	"packages/ts/src/executors/managed-cloud-postgresql.ts",
	"packages/ts/src/executors/managed-untrusted-js-compute.ts",
	"packages/ts/src/identity.ts",
	"packages/ts/src/orchestration/agent-runtime-tool-provider-run-admission.ts",
] as const);
export const CURRENT_GRAPH_LIVE_WRITABLE_FILE =
	"packages/ts/src/executors/managed-cloud-postgresql.ts" as const;
export const CURRENT_GRAPH_LIVE_TASK_STATEMENT =
	"Managed cloud PostgreSQL must admit only producer-owned canonical run-admission proposal provenance before a worker claim. Inspect the producer contract and canonical identity helpers, then make the smallest consumer change that accepts the valid canonical proposal and rejects malformed or locally reconstructed proposal provenance." as const;
export const CURRENT_GRAPH_LIVE_ACCEPTANCE_CRITERIA = Object.freeze([
	"A fresh producer-owned canonical run-admission proposal is admitted before worker claim.",
	"Malformed and non-canonical proposal provenance is rejected before store mutation.",
	"Locally reconstructed proposal provenance that disagrees with the producer ref is rejected.",
	"Authorization, fencing, lease, credential and claim invariants remain intact.",
	"Only packages/ts/src/executors/managed-cloud-postgresql.ts changes.",
] as const);

export const CURRENT_GRAPH_LIVE_TASK = createCurrentGraphProviderTaskProfile({
	taskRef: "current.managed-cloud-postgresql-canonical-admission-proposal-ref.live.v1",
	systemInstruction:
		"You are editing a bounded TypeScript workspace. Use only the provided tools. Inspect before mutation, make the smallest exact replacement, inspect the diff, and run focused validation. Never invent file contents or claim completion before Graph-authorized validation.",
	taskStatement: `${CURRENT_GRAPH_LIVE_TASK_STATEMENT}\n\nAcceptance criteria:\n${CURRENT_GRAPH_LIVE_ACCEPTANCE_CRITERIA.map((criterion, index) => `${index + 1}. ${criterion}`).join("\n")}\n\nReadable files: ${CURRENT_GRAPH_LIVE_READABLE_FILES.join(", ")}\nWritable file: ${CURRENT_GRAPH_LIVE_WRITABLE_FILE}`,
	armContexts: CURRENT_GRAPH_ARMS.map((arm) => `Frozen evaluation arm: ${arm}`),
	allowedWorkspacePath: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
});

export const CURRENT_GRAPH_LIVE_LIMITS = Object.freeze({
	...CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
	maxCostMicrousd: 6_000_000,
	maxElapsedMs: 7_200_000,
	providerMaxCostMicrousd: 100_000,
	providerMaxElapsedMs: 60_000,
	retryWaitMaxElapsedMs: 60_000,
	localEffectMaxElapsedMs: 120_000,
});

export const CURRENT_GRAPH_LIVE_COORDINATES = strictSnapshot({
	decisionRef: CURRENT_GRAPH_LIVE_DECISION_REF,
	decisionRevision: CURRENT_GRAPH_LIVE_DECISION_REVISION,
	baselineCommit: CURRENT_GRAPH_LIVE_BASELINE_COMMIT,
	d3QualificationArtifactDigest: CURRENT_GRAPH_LIVE_D3_QUALIFICATION_ARTIFACT_DIGEST,
	d3QualificationBundleDigest: CURRENT_GRAPH_LIVE_D3_QUALIFICATION_BUNDLE_DIGEST,
	d3QualificationDigest: CURRENT_GRAPH_LIVE_D3_QUALIFICATION_DIGEST,
	d3ImplementationManifestDigest: CURRENT_GRAPH_LIVE_D3_IMPLEMENTATION_MANIFEST_DIGEST,
	generationRef: CURRENT_GRAPH_LIVE_GENERATION_REF,
	dispatchClaimRef: CURRENT_GRAPH_LIVE_DISPATCH_CLAIM_REF,
	routeDigest: CURRENT_GRAPH_LIVE_ROUTE.routeDigest,
	taskProfileDigest: CURRENT_GRAPH_LIVE_TASK.taskProfileDigest,
	requestModel: CURRENT_GRAPH_LIVE_REQUEST_MODEL,
	selectedEndpointModel: CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
	providerName: CURRENT_GRAPH_LIVE_PROVIDER_NAME,
	providerTag: CURRENT_GRAPH_LIVE_PROVIDER_TAG,
	quantization: CURRENT_GRAPH_LIVE_QUANTIZATION,
	endpoint: CURRENT_GRAPH_LIVE_ENDPOINT,
	reasoningEffort: CURRENT_GRAPH_LIVE_REASONING_EFFORT,
	pricing: CURRENT_GRAPH_LIVE_PRICING,
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
	causalAttribution: "undetermined",
	efficacyClaim: "none",
});

export const CURRENT_GRAPH_LIVE_COORDINATES_DIGEST = empiricalStrictJsonDigest(
	CURRENT_GRAPH_LIVE_COORDINATES,
);
