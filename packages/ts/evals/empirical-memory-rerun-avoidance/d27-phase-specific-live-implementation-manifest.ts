import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D26_IMPLEMENTATION_MANIFEST_DIGEST } from "./d26-phase-specific-real-provider-implementation-manifest.js";

export const D27_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	coordinates: "sha256:912f342c9210670096297b96baf1bb27eb0b63a45ee24f1609022f37f3f8be72",
	preflight: "sha256:cffec8bd6aa49a38e8958200c4a318c6e7a0c69f7481b98dfdcd2e5a41ca08a7",
	claim: "sha256:a77dfa9a0d73cf403a66cb5582908da317ca7a80fbd5cb2993326925f695a728",
	live: "sha256:c1b1d26b01a8d88d010b2ddf825c90cb386bf43a93e99a9c30d837e8dc529cfc",
	qualification: "sha256:9414ac565ffa8e035487bf854d6f152050b7f691aad9ec92b8b9fed06b84e137",
	runner: "sha256:177a3dff2bb8bd463d4717add24866048d9d44454a50aa6c7ed70486940b15e7",
	providerReplayRepair: "sha256:8928f66b990088e7eeaab20e15916ef9d2a2ca1c97145301a7dbf4ade5804541",
	phaseAuthorityRepair: "sha256:e660343b2132b0adcd58518d2857d29762910390a51e2c479ea6b7ec82509296",
	providerCompositionRepair:
		"sha256:e133d11ec777099337e89d7fdaa1bac064e5942a2d9bb1e46f44692bd33b8dd3",
	noOpReplacementRepair: "sha256:dc9acb881021576d19c07b0fc33bbe997a976e27e58f755adc48e34fc7a61e85",
});

export const D27_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly-ts.d31.phase-specific-live-implementation-manifest.v1",
	baselineCommit: "71ba77d5773c5fe3a57fbe1d8bc25af6640f1f52",
	d26ImplementationManifestDigest: D26_IMPLEMENTATION_MANIFEST_DIGEST,
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
		d26ImplementationManifestDigest: D26_IMPLEMENTATION_MANIFEST_DIGEST,
		sources: measured,
	});
}
