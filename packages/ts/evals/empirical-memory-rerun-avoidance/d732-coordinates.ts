import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import { D731_IMPLEMENTATION_MANIFEST_DIGEST } from "./d731-implementation-manifest.js";

export const D732_DECISION_REF = "decision.D732" as const;
export const D732_DECISION_REVISION = "2026-08-11.v1" as const;
export const D732_GENERATION_REF = "d732-d731-route-repair-live-2026-08-11-v1" as const;
export const D732_DISPATCH_CLAIM_REF = "d732-d731-route-repair-live-2026-08-11-v1" as const;
export const D732_QUALIFIED_D731_COMMIT = "1f0e60b6" as const;
export const D732_QUALIFIED_NODE_VERSION = "v24.18.0" as const;
export const D732_LIVE_RUNNER_SHA256 =
	"sha256:98e5e17fdbc9c6949ed935fc39f44745a8b440437f2a1adaf8189d5c6283d375" as const;

export const D732_D731_QUALIFICATION_COORDINATES = strictSnapshot({
	generationRef: "d731-route-repair-pre-live-2026-08-11-v1",
	artifactSha256: "sha256:57113665fc54a429c012c970a8d137e9b243d522ba46527de1d31796752d8b23",
	bundleDigest: "sha256:7b2c133dde539cef39aad0fe76301e8d813f15ca2f78ed53ca7e4996abdd56b2",
	qualificationDigest: "sha256:be8813c5c5d1a3932c4b5a7f522de6856a4bfc7edcf6fd24ac73b9d30ccd9aac",
	generationDigest: "sha256:3426faaf1547a25e04805c447380b04353a343879abf4a6cbb3cfa376522f25b",
	routeEligibilityDigest: "sha256:f506054c7cd93314f901be5d4497dc7ab5b4b664aacb13297a345b1edfc5e3c8",
	implementationManifestDigest: D731_IMPLEMENTATION_MANIFEST_DIGEST,
});

export const D732_BUDGET_LIMITS = D729_BUDGET_LIMITS;
export const D732_EFFECT_CEILINGS = D729_EFFECT_CEILINGS;

export const D732_COORDINATES = strictSnapshot({
	decisionRef: D732_DECISION_REF,
	decisionRevision: D732_DECISION_REVISION,
	generationRef: D732_GENERATION_REF,
	dispatchClaimRef: D732_DISPATCH_CLAIM_REF,
	qualifiedD731Commit: D732_QUALIFIED_D731_COMMIT,
	qualifiedNodeVersion: D732_QUALIFIED_NODE_VERSION,
	d731Qualification: D732_D731_QUALIFICATION_COORDINATES,
	budgetLimits: D732_BUDGET_LIMITS,
	effectCeilings: D732_EFFECT_CEILINGS,
	blockHardCapMicrousd: 6_000_000,
	localEvalNoResetLimitMicrousd: 32_000_000,
	blockCount: 1,
	armOrder: [
		"cold",
		"relevant-applied",
		"proposal-only",
		"admission-rejected",
		"irrelevant-applied",
		"wrong-scope-applied",
	],
	maxActiveArms: 1,
	coldCensorsWarm: false,
	retryPolicies: ["D671", "D675", "D710"],
	fallbackAllowed: false,
	providerModelRouteSwitchAllowed: false,
	parallelOrBackgroundCallsAllowed: false,
	automaticRerunAllowed: false,
	causalAttribution: "undetermined",
	efficacyClaim: "none",
});

export const D732_COORDINATES_DIGEST = empiricalStrictJsonDigest(D732_COORDINATES);

export function validateD732LiveRunnerBytes(bytes: Uint8Array): string {
	if (empiricalSha256(bytes) !== D732_LIVE_RUNNER_SHA256)
		throw new TypeError("D732 live operator source drifted");
	return D732_COORDINATES_DIGEST;
}
