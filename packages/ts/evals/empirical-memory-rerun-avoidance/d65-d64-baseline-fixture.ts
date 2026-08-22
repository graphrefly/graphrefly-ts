import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import type { D65ReplicateProjectionV1 } from "./d65-replicated-campaign-authority.js";

const material = strictSnapshot({
	replicateIndex: 1,
	source: "d64-preincluded" as const,
	evidenceDigest: "sha256:e334d13e1908f2e7ddc97e247de9081ad5eee5e85b81f7ee5ff5d718ff43cf89",
	executionShapeDigest: "sha256:d87818f10f243c0c1499ebaadd2b996379349e67f745beaad71ca2def60f66e9",
	arms: [
		{
			arm: "cold",
			completed: true,
			cleanupCompleted: true,
			evaluable: true,
			taskOutcome: "failed",
		},
		{
			arm: "relevant-applied",
			completed: true,
			cleanupCompleted: true,
			evaluable: true,
			taskOutcome: "passed",
		},
		{
			arm: "proposal-only",
			completed: true,
			cleanupCompleted: true,
			evaluable: true,
			taskOutcome: "failed",
		},
		{
			arm: "admission-rejected",
			completed: true,
			cleanupCompleted: true,
			evaluable: true,
			taskOutcome: "failed",
		},
		{
			arm: "irrelevant-applied",
			completed: true,
			cleanupCompleted: true,
			evaluable: true,
			taskOutcome: "failed",
		},
		{
			arm: "wrong-scope-applied",
			completed: true,
			cleanupCompleted: true,
			evaluable: true,
			taskOutcome: "passed",
		},
	],
	providerAttempts: 39,
	confirmedCostMicrousd: 447_785,
	confirmedElapsedMs: 3_055_830,
} satisfies Omit<D65ReplicateProjectionV1, "projectionDigest">);

export const D65_D64_BASELINE_PROJECTION: D65ReplicateProjectionV1 = Object.freeze({
	...material,
	projectionDigest: empiricalStrictJsonDigest(material),
});

if (
	D65_D64_BASELINE_PROJECTION.projectionDigest !==
	"sha256:5fb1368a4a3d3970cfe5bef74af8b9b4a47f5a086b7a83ddf9445508d36db45d"
)
	throw new TypeError("D65 tracked material-free D64 projection fixture drifted");
