import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D26_IMPLEMENTATION_MANIFEST_DIGEST } from "./d26-phase-specific-real-provider-implementation-manifest.js";

export const D27_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	coordinates: "sha256:24713e58da19dbc74c8761b80ee11ee63c65f8fe534d3f98410a91cab1e28708",
	preflight: "sha256:1f6c474351d7df81e5af310c73760cd4846dcab18608bd924106d04b610c90ea",
	claim: "sha256:224b213a799077471e505e638c2618c2ae8d23e8540a441616ce1bab14ac74b0",
	live: "sha256:5c2da7dd670763d3979c290a484e46357e2c634233f2a440fdc292c228070875",
	qualification: "sha256:4edebac526faca3e4b145665429e846dcbb05decb501a937390229e051912ae5",
	runner: "sha256:4c91bc5d885fc153b4d996e25e904907a4043c8b939bf505fa540d70a0b0865e",
	providerReplayRepair: "sha256:10041feb0735732a317787392623afbca7f01adf31377431d5cfd8ad5dc8cfd9",
	phaseAuthorityRepair: "sha256:e660343b2132b0adcd58518d2857d29762910390a51e2c479ea6b7ec82509296",
	providerCompositionRepair:
		"sha256:e133d11ec777099337e89d7fdaa1bac064e5942a2d9bb1e46f44692bd33b8dd3",
	noOpReplacementRepair: "sha256:54418dc61628118d327b08fe2c8d7631ef11ca1707c9bfe91489aaf3d22dcaae",
});

export const D27_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly-ts.d30.phase-specific-live-implementation-manifest.v1",
	baselineCommit: "86f3cf9ecef4a16c239f501eaa13210c70f48bc0",
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
