import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D40_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD40Implementation,
} from "./d40-phase-specific-inference-live-implementation-manifest.js";

export const D41_BASELINE_COMMIT = "70534385fd0928e980f43bb22ad1defa77d3d8fd" as const;

export const D41_IMPLEMENTATION_FILES = Object.freeze({
	authority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d41-phase-specific-inference-authority.ts",
	realProviderComposition:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d41-phase-specific-real-provider-composition.ts",
	qualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d41-phase-specific-inference-qualification.ts",
	qualificationRunner:
		"packages/ts/evals/empirical-memory-rerun-avoidance/run-d41-phase-specific-inference-no-network.ts",
} as const);

export const D41_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	authority: "sha256:c5199be5c45bdcadb3fa7bc49d7b8225b50bc4e7b760888132d4f08fb8205ee2",
	realProviderComposition:
		"sha256:446d036efa572276c9f720a4fa5cf67897109d7a57f1a92c7ad7a12de9e176b6",
	qualification: "sha256:54224e8af6fae03ea1f714d1103d132ac25de7693e9bf79e745031b345283591",
	qualificationRunner: "sha256:a750556866b82aac36d71e8dfec44b9f9d5ee58c9bd7f678f667d414afed5680",
} as const);

export const D41_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly-ts.d41.phase-specific-inference-implementation-manifest.v1",
	baselineCommit: D41_BASELINE_COMMIT,
	d40ImplementationManifestDigest: D40_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D41_IMPLEMENTATION_SOURCE_DIGESTS,
});

export const D41_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D41_IMPLEMENTATION_MANIFEST,
);

export async function measureD41Implementation(repositoryRootValue: string): Promise<string> {
	const repositoryRoot = await realpath(resolve(repositoryRootValue));
	if ((await measureD40Implementation(repositoryRoot)) !== D40_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D41 D40 implementation baseline drifted");
	const measured: Record<string, string> = {};
	for (const [name, path] of Object.entries(D41_IMPLEMENTATION_FILES))
		measured[name] = empiricalSha256(new Uint8Array(await readFile(resolve(repositoryRoot, path))));
	for (const [name, expected] of Object.entries(D41_IMPLEMENTATION_SOURCE_DIGESTS))
		if (measured[name] !== expected)
			throw new TypeError(`D41 implementation source drifted: ${name}`);
	return empiricalStrictJsonDigest(
		strictSnapshot({
			revision: D41_IMPLEMENTATION_MANIFEST.revision,
			baselineCommit: D41_IMPLEMENTATION_MANIFEST.baselineCommit,
			d40ImplementationManifestDigest: D40_IMPLEMENTATION_MANIFEST_DIGEST,
			sources: measured,
		}),
	);
}
