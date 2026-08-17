import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D26_IMPLEMENTATION_MANIFEST_DIGEST } from "./d26-phase-specific-real-provider-implementation-manifest.js";

export const D27_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	coordinates: "sha256:5f45d6ee0def7f4456b1e668d74b37a29d04ed90fe602138ad10997b05aa50b5",
	preflight: "sha256:ab84aa8bb321815ffba63bc314222aa5b502d54999f6894b1eb8d9dfd2f5f265",
	claim: "sha256:5eac613602ad71390d2d0f0678bcac16afe9863f58787da7476c2bc8dedfa022",
	live: "sha256:7cc977c696ffe7a7389984137b3d30ffc12b7a100eb14644aaca01ac8bae4695",
	qualification: "sha256:74fb31e0ef997547a9d48ab5bed9dae2820ee120835300a5c6666c14de658ccc",
	runner: "sha256:421ee60b67f7116fe8f2a65894c1951290844b74194149cd5a7b267db2653b0d",
	phaseAuthorityRepair: "sha256:e660343b2132b0adcd58518d2857d29762910390a51e2c479ea6b7ec82509296",
	providerCompositionRepair:
		"sha256:7736dfcb862e2e5c8b2e968e9b1cb60e924cc6c063d985d0577c6108a6ab4b77",
});

export const D27_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly-ts.d28.phase-specific-live-implementation-manifest.v1",
	baselineCommit: "775e734df3d040426cf648e482f5703504d4d3b4",
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
	phaseAuthorityRepair:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d25-phase-specific-tool-admission.ts",
	providerCompositionRepair:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d26-phase-specific-real-provider-composition.ts",
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
