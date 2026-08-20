import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D27_D31_IMPLEMENTATION_MANIFEST_DIGEST } from "./d27-phase-specific-live-coordinates.js";

export const D27_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	coordinates: "sha256:440c231717de64f060d0ef657cb9c392766c1ce979c514f4433fe7fe63f816d4",
	preflight: "sha256:64a43c7083c4ca5c983b8ae1fa4416ef1d5364781aed2a52aeeffa2b9d4438c4",
	claim: "sha256:7ba894f2777c9c4a42c1d49eb603f0a5102167ba15d77c531c633e5144fdf1ef",
	live: "sha256:5a34bffe0975dac6581ed57d328059e2840e8d1597b06bb6babdff252dcbc0ec",
	qualification: "sha256:41ff0ee107986fc0112d2dfaec9d6c2bc54336f71fce6ccd6d33d322ce9d9fc0",
	runner: "sha256:b2eaa5de87a0076cd2e25f4115d6b00d404ae338bc31bdfe36e591a0f11643e0",
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
	revision: "graphrefly-ts.d32.phase-specific-live-implementation-manifest.v1",
	baselineCommit: "0cd03df9db631da8afcf1b05e4e14133607d6bac",
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
