import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D27_D31_IMPLEMENTATION_MANIFEST_DIGEST } from "./d27-phase-specific-live-coordinates.js";

export const D27_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	coordinates: "sha256:7c3e38e749e2621c4b72c9f06eb4111b05342daa04eae86053c575dfb9b6fc80",
	preflight: "sha256:f4cd61c8a7f0f08236687958d66b5149d7a497295eb2437595d9b216f73f734f",
	claim: "sha256:a6d3fea46e0e95fba3805473b0bd639b2324b83d392eb52d7fbf7160ad8954e3",
	live: "sha256:08304c431943e9ecd245ae58d7527da8527831706156f41994e39be84a9cdc41",
	qualification: "sha256:e7f610d0355762b413c5a559bfed5cda4296e6d7bf291de60b703406e174ef77",
	runner: "sha256:8a62b761472af5ebf754adb49bc0296543b9ae2391373e838a0e64fac1b0a0dd",
	qualificationRunner: "sha256:c75df3b8f5236f3d16905cf63e58c78204052628dad4821fedf77260fc2a2927",
	privatePersistence: "sha256:0563c15908914694df6d2b80aba11840ce8f91f2c63f6ed2c97c2e5f3dc8a113",
	graphRecoveryAuthority: "sha256:2dc2a7d677d6b56cc4100932b639b0ec4732ef50986af39e4c0370590754f97c",
	providerReplayRepair: "sha256:728c83f174bc1e2c825e9c7cd1ed7b0b2d128dc97e1076d417f3186a7afc19ab",
	phaseAuthorityRepair: "sha256:c7fa7c581f6194c2f0ffa243b8dab41152394b36061df9926321975dfb1e64a8",
	providerCompositionRepair:
		"sha256:e133d11ec777099337e89d7fdaa1bac064e5942a2d9bb1e46f44692bd33b8dd3",
	noOpReplacementRepair: "sha256:e583ef63afca3d7dc07c1a7da6a598c75b7e6b142aa981292bb11cae5f000fbe",
});

export const D27_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly-ts.d33.phase-specific-live-implementation-manifest.v1",
	baselineCommit: "75bb74d5b4d44ac45cf8a373d948d44bff802a3e",
	d31ImplementationManifestDigest: D27_D31_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D27_IMPLEMENTATION_SOURCE_DIGESTS,
});
export const D27_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D27_IMPLEMENTATION_MANIFEST,
);

const PATHS = Object.freeze({
	coordinates:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d27-phase-specific-live-coordinates.ts",
	preflight:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d27-phase-specific-live-preflight.ts",
	claim: "packages/ts/evals/empirical-memory-rerun-avoidance/d27-phase-specific-live-claim.ts",
	live: "packages/ts/evals/empirical-memory-rerun-avoidance/d27-phase-specific-live.ts",
	qualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d27-phase-specific-live-qualification.ts",
	runner: "packages/ts/evals/empirical-memory-rerun-avoidance/run-d27-phase-specific-live.ts",
	qualificationRunner:
		"packages/ts/evals/empirical-memory-rerun-avoidance/run-d27-phase-specific-live-no-network.ts",
	privatePersistence:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d6-current-private-persistence.ts",
	graphRecoveryAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d5-graph-native-eval-authority.ts",
	providerReplayRepair:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d6-current-provider-authority.ts",
	phaseAuthorityRepair:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d25-phase-specific-tool-admission.ts",
	providerCompositionRepair:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d26-phase-specific-real-provider-composition.ts",
	noOpReplacementRepair:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d8-current-openrouter-adapter.ts",
});

export async function measureD27Implementation(repositoryRootValue: string): Promise<string> {
	const repositoryRoot = await realpath(resolve(repositoryRootValue));
	const measured: Record<string, string> = {};
	for (const [name, path] of Object.entries(PATHS))
		measured[name] = empiricalSha256(new Uint8Array(await readFile(resolve(repositoryRoot, path))));
	for (const [name, expected] of Object.entries(D27_IMPLEMENTATION_SOURCE_DIGESTS))
		if (measured[name] !== expected)
			throw new TypeError(`D27 implementation source drifted: ${name}`);
	return empiricalStrictJsonDigest({
		revision: D27_IMPLEMENTATION_MANIFEST.revision,
		baselineCommit: D27_IMPLEMENTATION_MANIFEST.baselineCommit,
		d31ImplementationManifestDigest: D27_D31_IMPLEMENTATION_MANIFEST_DIGEST,
		sources: measured,
	});
}
