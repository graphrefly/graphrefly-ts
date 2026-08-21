import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D41_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD41Implementation,
} from "./d41-phase-specific-inference-implementation-manifest.js";
import { D42_BASELINE_COMMIT } from "./d42-phase-specific-inference-live-coordinates.js";

export const D42_IMPLEMENTATION_FILES = Object.freeze({
	coordinates:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d42-phase-specific-inference-live-coordinates.ts",
	preflight:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d42-phase-specific-inference-live-preflight.ts",
	claim:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d42-phase-specific-inference-live-claim.ts",
	live: "packages/ts/evals/empirical-memory-rerun-avoidance/d42-phase-specific-inference-live.ts",
	qualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d42-phase-specific-inference-live-qualification.ts",
	qualificationRunner:
		"packages/ts/evals/empirical-memory-rerun-avoidance/run-d42-phase-specific-inference-live-no-network.ts",
	liveRunner:
		"packages/ts/evals/empirical-memory-rerun-avoidance/run-d42-phase-specific-inference-live.ts",
} as const);

export const D42_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	coordinates: "sha256:f8bf2bfe1812d71dd5427813a6b6c482e8da50c5e36714691d2903b13d40e6aa",
	preflight: "sha256:7d5b1e2d41b286afa22347b9f5da46d39a18c2e0873d148913052711e2bcdc0d",
	claim: "sha256:006dbb0ad398ace19c3979a2796e58d09900da1b3fb057fe61527e36f2d8b1d2",
	live: "sha256:50e612e6ea1ec02d2c993e0ffdf084b4fc72b25c679765598db1a9df283aec77",
	qualification: "sha256:3173599513552d417e8a7e196fd3240f46797a369b1b8f1e2ea89ccf62871b01",
	qualificationRunner: "sha256:71daf3b1c6b3ee7189446df271127d01c10c210da80b3ff477c9853e79feb0cc",
	liveRunner: "sha256:fc3f9f034f35ec96ad796e6f489b21d8d0c4f6b9c43f7a82b5aaf480387c6a90",
} as const);

export const D42_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly-ts.d42.phase-specific-inference-live-implementation-manifest.v1",
	baselineCommit: D42_BASELINE_COMMIT,
	d41ImplementationManifestDigest: D41_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D42_IMPLEMENTATION_SOURCE_DIGESTS,
});

export const D42_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D42_IMPLEMENTATION_MANIFEST,
);

export async function measureD42Implementation(repositoryRootValue: string): Promise<string> {
	const repositoryRoot = await realpath(resolve(repositoryRootValue));
	if ((await measureD41Implementation(repositoryRoot)) !== D41_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D42 D41 implementation baseline drifted");
	const measured: Record<string, string> = {};
	for (const [name, path] of Object.entries(D42_IMPLEMENTATION_FILES))
		measured[name] = empiricalSha256(new Uint8Array(await readFile(resolve(repositoryRoot, path))));
	for (const [name, expected] of Object.entries(D42_IMPLEMENTATION_SOURCE_DIGESTS))
		if (measured[name] !== expected)
			throw new TypeError(`D42 implementation source drifted: ${name}`);
	return empiricalStrictJsonDigest(
		strictSnapshot({
			revision: D42_IMPLEMENTATION_MANIFEST.revision,
			baselineCommit: D42_IMPLEMENTATION_MANIFEST.baselineCommit,
			d41ImplementationManifestDigest: D41_IMPLEMENTATION_MANIFEST_DIGEST,
			sources: measured,
		}),
	);
}
