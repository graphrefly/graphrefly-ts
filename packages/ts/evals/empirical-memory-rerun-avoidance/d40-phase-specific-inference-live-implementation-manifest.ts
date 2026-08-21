import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D38_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD38Implementation,
} from "./d38-premature-final-live-implementation-manifest.js";
import { D40_BASELINE_COMMIT } from "./d40-phase-specific-inference-live-coordinates.js";

export const D40_IMPLEMENTATION_FILES = Object.freeze({
	authority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d40-phase-specific-inference-authority.ts",
	coordinates:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d40-phase-specific-inference-live-coordinates.ts",
	preflight:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d40-phase-specific-inference-live-preflight.ts",
	claim:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d40-phase-specific-inference-live-claim.ts",
	realProviderComposition:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d40-phase-specific-real-provider-composition.ts",
	live: "packages/ts/evals/empirical-memory-rerun-avoidance/d40-phase-specific-inference-live.ts",
	qualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d40-phase-specific-inference-live-qualification.ts",
	qualificationRunner:
		"packages/ts/evals/empirical-memory-rerun-avoidance/run-d40-phase-specific-inference-live-no-network.ts",
	liveRunner:
		"packages/ts/evals/empirical-memory-rerun-avoidance/run-d40-phase-specific-inference-live.ts",
} as const);

export const D40_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	authority: "sha256:2513786d545ecc8bc57af6f0becbae4071ed39bdd9d3c1dab2096e01800cbc43",
	coordinates: "sha256:5289fd7e95c0c902109ae91b602c10d97ccb4b9687de7a4f5f592b9bc86abb27",
	preflight: "sha256:1c54cbc04186b84e1ec9e358a885665021f53331c6ffa7622ac58478dbf6f3e9",
	claim: "sha256:7669775ca3cadf059240314b067c9f4cb1bf9df6016881219106824d6fb02c0d",
	realProviderComposition:
		"sha256:5a09387353329b1019acc47cfc5896c426f1c1184af540a2281bb9bbd59a1793",
	live: "sha256:387ab0d1c4894a6451e4e27ff91fdf60a6febd8b3b73b46d0a43cdcd47e0e8ba",
	qualification: "sha256:4abb2a8741fff529e990bc5a58afd11d5ab52c23414fd0075b0c5a4ef9f2505b",
	qualificationRunner: "sha256:0619f133307a47792e3c4622db9d77c32f5cc800adb6531cd7c8f32312df73e8",
	liveRunner: "sha256:da5cc51fe9fad23d80f4175d9e1b455275b40fb980891f58010989d164c0505b",
} as const);

export const D40_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly-ts.d40.phase-specific-inference-live-implementation-manifest.v1",
	baselineCommit: D40_BASELINE_COMMIT,
	d38ImplementationManifestDigest: D38_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D40_IMPLEMENTATION_SOURCE_DIGESTS,
});

export const D40_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D40_IMPLEMENTATION_MANIFEST,
);

export async function measureD40Implementation(repositoryRootValue: string): Promise<string> {
	const repositoryRoot = await realpath(resolve(repositoryRootValue));
	if ((await measureD38Implementation(repositoryRoot)) !== D38_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D40 D38 implementation baseline drifted");
	const measured: Record<string, string> = {};
	for (const [name, path] of Object.entries(D40_IMPLEMENTATION_FILES))
		measured[name] = empiricalSha256(new Uint8Array(await readFile(resolve(repositoryRoot, path))));
	for (const [name, expected] of Object.entries(D40_IMPLEMENTATION_SOURCE_DIGESTS))
		if (measured[name] !== expected)
			throw new TypeError(`D40 implementation source drifted: ${name}`);
	return empiricalStrictJsonDigest(
		strictSnapshot({
			revision: D40_IMPLEMENTATION_MANIFEST.revision,
			baselineCommit: D40_IMPLEMENTATION_MANIFEST.baselineCommit,
			d38ImplementationManifestDigest: D38_IMPLEMENTATION_MANIFEST_DIGEST,
			sources: measured,
		}),
	);
}
