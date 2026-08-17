import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D26_IMPLEMENTATION_MANIFEST_DIGEST } from "./d26-phase-specific-real-provider-implementation-manifest.js";

export const D27_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	coordinates: "sha256:8973dd7860ea3b8c9db7a4719c3c7a2ae8aaa585d425ceba28237cd32bc62b44",
	preflight: "sha256:bd00f0c705128b9c3ac9b95e7ed63ee203cabebf9651d7031682208f83fccaf4",
	claim: "sha256:abaf5f4e15b750a0e038e979fceb05b2490473f5377fb46a2757368eedd1dfff",
	live: "sha256:db2c38759d4509e5c6b83ae4905c9b0aafd3132ec15b2baef748ad8e930b7389",
	qualification: "sha256:ae48562005d117f9c0146e96c272a6cb89b5d9e3820e43f980f802c93ca34517",
	runner: "sha256:070f64237b8ffc5453fadb33bb04f8786eec9871e455e229d80d7bd7e85ad68a",
});

export const D27_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly-ts.d27.phase-specific-live-implementation-manifest.v1",
	baselineCommit: "6756aed6c2f6a8ad6fec0c82c97cffefae88dcf7",
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
