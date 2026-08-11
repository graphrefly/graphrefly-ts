import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

export const D726_DECISION_REF = "decision.D726" as const;
export const D726_DECISION_REVISION = "2026-08-11.v1" as const;
export const D726_GENERATION_REF =
	"d726-d725-terminal-http-live-replacement-2026-08-11-v2" as const;

export const D726_BUDGET_LIMITS = Object.freeze({
	maxRequests: 96,
	maxRetryWaits: 12,
	maxCostMicrousd: 6_000_000,
	maxElapsedMs: 7_200_000,
});

export const D726_EFFECT_CEILINGS = Object.freeze({
	providerMaxCostMicrousd: 100_000,
	providerMaxElapsedMs: 1_200_000,
	localEffectMaxElapsedMs: 120_000,
	routeDigest: empiricalStrictJsonDigest({
		model: "deepseek/deepseek-v4-flash",
		provider: "DeepInfra",
		providerSlug: "deepinfra",
		quantization: "fp4",
		endpoint: "chat-completions",
	}),
});

export const D726_D725_QUALIFICATION_COORDINATES = strictSnapshot({
	artifactSha256: "sha256:429a4e23bc837e2ad6e9e066930277058451b5e8857443ecb0610d9d67b68913",
	bundleDigest: "sha256:16c9952c9a3b3d56dbdbfd590a13579f2c2cc0a49eb746457f8c2a8a89773dfd",
	qualificationDigest: "sha256:a96910da61db0ecdb89744c7cf46f587498dcb7c170997fc8e99044aca3c35de",
	generationDigest: "sha256:f80a699acc2d87c64479b2e61307d6d98a624898482bc1712687b5615f6075cb",
});

export const D726_COORDINATES_DIGEST = empiricalStrictJsonDigest({
	decisionRef: D726_DECISION_REF,
	decisionRevision: D726_DECISION_REVISION,
	generationRef: D726_GENERATION_REF,
	budgetLimits: D726_BUDGET_LIMITS,
	effectCeilings: D726_EFFECT_CEILINGS,
	d725Qualification: D726_D725_QUALIFICATION_COORDINATES,
});
