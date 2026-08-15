import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { CURRENT_GRAPH_ARMS } from "./d5-graph-native-eval-authority.js";
import {
	CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
	createCurrentGraphProviderRouteProfile,
	createCurrentGraphProviderTaskProfile,
} from "./d6-current-provider-authority.js";

export const CURRENT_GRAPH_LIVE_DECISION_REF = "graphrefly-ts:D6" as const;
export const CURRENT_GRAPH_LIVE_DECISION_REVISION = "2026-08-14.v1" as const;
export const CURRENT_GRAPH_LIVE_BASELINE_COMMIT =
	"892e68db6882e7b1b119c9cbccc329b1e962db93" as const;
export const CURRENT_GRAPH_LIVE_D5_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:a6463d782d610ab68460486c92971f48463ce4bc9af580baa4d8239fa083747c" as const;
export const CURRENT_GRAPH_LIVE_D5_QUALIFICATION_BUNDLE_DIGEST =
	"sha256:d1bfca3ccb5be998f282daca4005518dc2ad1b5995b742968b3d23ac32ae0ca6" as const;
export const CURRENT_GRAPH_LIVE_D5_QUALIFICATION_DIGEST =
	"sha256:aea04d1ed987b9912ea12b3c145b2c7cfaa888e86c62ee0b76ff27147be1979b" as const;
export const CURRENT_GRAPH_LIVE_D5_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:10d7f8202c1317bbb752b644b8b1564b9ab0cc2ab437df7a164b5105921c492f" as const;
export const CURRENT_GRAPH_LIVE_GENERATION_REF =
	"current-graph-native-live-2026-08-14-d6-v1" as const;
export const CURRENT_GRAPH_LIVE_DISPATCH_CLAIM_REF =
	"current-graph-native-live-dispatch-2026-08-14-d6-v1" as const;

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
	// D6 owns the provider-capable architecture and this pre-live execution closure.
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
	d5QualificationArtifactDigest: CURRENT_GRAPH_LIVE_D5_QUALIFICATION_ARTIFACT_DIGEST,
	d5QualificationBundleDigest: CURRENT_GRAPH_LIVE_D5_QUALIFICATION_BUNDLE_DIGEST,
	d5QualificationDigest: CURRENT_GRAPH_LIVE_D5_QUALIFICATION_DIGEST,
	d5ImplementationManifestDigest: CURRENT_GRAPH_LIVE_D5_IMPLEMENTATION_MANIFEST_DIGEST,
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
