import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D726_BUDGET_LIMITS,
	D726_D725_QUALIFICATION_COORDINATES,
	D726_EFFECT_CEILINGS,
} from "./d726-coordinates.js";

export const D728_DECISION_REF = "decision.D728" as const;
export const D728_DECISION_REVISION = "2026-08-11.v1" as const;
export const D728_GENERATION_REF =
	"d728-d727-failure-safe-graph-native-live-2026-08-11-v1" as const;
export const D728_DISPATCH_CLAIM_REF =
	"d728-d727-failure-safe-graph-native-live-2026-08-11-v1" as const;

export const D728_BUDGET_LIMITS = D726_BUDGET_LIMITS;
export const D728_EFFECT_CEILINGS = D726_EFFECT_CEILINGS;
export const D728_D725_QUALIFICATION_COORDINATES = D726_D725_QUALIFICATION_COORDINATES;
export const D728_D727_QUALIFICATION_COORDINATES = strictSnapshot({
	generationRef: "d727-d726-executor-failure-pre-live-2026-08-11-v1",
	artifactSha256: "sha256:262601d5b35440c6ffb0c6d40a88838cd645c7371807b24dc195dd2eb18bdc68",
	bundleDigest: "sha256:d85fc07c77b237e689e17419f2ccba9f6732a2e9d57b9cedc5d39768bd174226",
	terminalReceiptDigest: "sha256:724ab1bce35a585de516b1cd9540465c3263f9fb6fc3f784db16131f213b5aa4",
});

export const D728_COORDINATES_DIGEST = empiricalStrictJsonDigest({
	decisionRef: D728_DECISION_REF,
	decisionRevision: D728_DECISION_REVISION,
	generationRef: D728_GENERATION_REF,
	dispatchClaimRef: D728_DISPATCH_CLAIM_REF,
	budgetLimits: D728_BUDGET_LIMITS,
	effectCeilings: D728_EFFECT_CEILINGS,
	d725Qualification: D728_D725_QUALIFICATION_COORDINATES,
	d727Qualification: D728_D727_QUALIFICATION_COORDINATES,
	armOrder: [
		"cold",
		"relevant-applied",
		"proposal-only",
		"admission-rejected",
		"irrelevant-applied",
		"wrong-scope-applied",
	],
	coldCensorsWarm: false,
	maxActiveArms: 1,
	retryPolicies: ["D671", "D675", "D710"],
	causalAttribution: "undetermined",
	efficacyClaim: "none",
});
