import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D26_IMPLEMENTATION_MANIFEST_DIGEST } from "./d26-phase-specific-real-provider-implementation-manifest.js";

export const D27_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	coordinates: "sha256:319ab1d95a167a7eff60dd9cdf2efbff64f5c04d664686da1fded3c7d5ec2d82",
	preflight: "sha256:2de94382895bed61b53cd838a459f76b805882997f436858b43242b792d518be",
	claim: "sha256:27d791fbbcca9fc9bfd8f7de48b31ea35bce8b934d946db9b627a9143703edb0",
	live: "sha256:9fb03d84b48d4aabf245552674b5110bd5bc3061a31bff49979c93abe8bb7706",
	qualification: "sha256:777d721091d20833a30f2c3d77a950c3a1afea09d7fda6f68f618dbbfd367deb",
	runner: "sha256:bf1da5dc352708a2bd211f89725617d4973a8c00c10e68fc7424ad32c93ece23",
	phaseAuthorityRepair: "sha256:e660343b2132b0adcd58518d2857d29762910390a51e2c479ea6b7ec82509296",
	providerCompositionRepair:
		"sha256:e133d11ec777099337e89d7fdaa1bac064e5942a2d9bb1e46f44692bd33b8dd3",
	noOpReplacementRepair: "sha256:54418dc61628118d327b08fe2c8d7631ef11ca1707c9bfe91489aaf3d22dcaae",
});

export const D27_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly-ts.d29.phase-specific-live-implementation-manifest.v1",
	baselineCommit: "2d00c3e8add339642cbf9dcabdb591c943d700d4",
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
