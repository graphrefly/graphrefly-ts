import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import {
	D61_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD61Implementation,
} from "./d61-implementation-manifest.js";

export const D63_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	d61Manifest: "sha256:b71fcb4b446c13a85495fe3ee16c6410ce0de10fed567ea3658a26a550bc08e6",
	toolAuthority: "sha256:0d6c43723fc7704732d27c1800eb022e3f4aef0369340bed017f3f8f9f05c1c2",
	liveComposition: "sha256:eefa1e9dbebd09363e3ab508443673f31153a4c17380ca42eb7ffaf463680b86",
	semanticScenarios: "sha256:511f430395e27d7920b0c9bd9ea8853993f244c93563630179af1ab0bf9c8076",
	semanticBundleEntry: "sha256:158db76edd3133c1768c7dea5384c9031e7dfe2c3af9feb750e07ba2035536e8",
	graphToolQualification: "sha256:17612723613e1a003cd2eae43dd34eaa9ab72db6376a161f837eba0ab361f36a",
	providerBoundaryQualification:
		"sha256:d885e30a724f14786beb86b240aae4ddcdeec5ff19f4ae59e71e317af674404d",
	qualification: "sha256:093b3686f0e04f1052d345481164a04c9e914619e734309c5dfc2911576d1d9b",
	qualificationRunner: "sha256:82a3bb4b05592f23a37c29d22d8392c9c46ed2afb7d8d2f9c90a24233a186dc0",
	test: "sha256:3c54ff23ce684e8c069fa7d99098936ca595475a145a5cca0c3213c9252373b4",
});

export const D63_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d63.implementation-manifest.v1",
	d61ImplementationManifestDigest: D61_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D63_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD63Implementation(): Promise<string> {
	if ((await measureD61Implementation()) !== D61_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D63 inherited D61 implementation closure drifted");
	const measured = Object.freeze({
		d61Manifest: empiricalSha256(
			await readFile(join(import.meta.dirname, "d61-implementation-manifest.ts")),
		),
		toolAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-graph-tool-authority.ts")),
		),
		liveComposition: empiricalSha256(
			await readFile(join(import.meta.dirname, "d44-d45-live-composition.ts")),
		),
		semanticScenarios: empiricalSha256(
			await readFile(join(import.meta.dirname, "d61-public-semantic-scenarios.ts")),
		),
		semanticBundleEntry: empiricalSha256(
			await readFile(join(import.meta.dirname, "d61-public-semantic-bundle-entry.ts")),
		),
		graphToolQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-graph-tool-qualification.ts")),
		),
		providerBoundaryQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d55-provider-boundary-qualification.ts")),
		),
		qualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d63-withheld-semantic-qualification.ts")),
		),
		qualificationRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d63-withheld-semantic-qualification.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d63-withheld-semantic.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D63_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D63 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d63.implementation-manifest.v1",
		d61ImplementationManifestDigest: D61_IMPLEMENTATION_MANIFEST_DIGEST,
		sources: measured,
	});
}
