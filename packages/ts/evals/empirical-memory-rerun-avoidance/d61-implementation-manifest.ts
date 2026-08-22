import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D61_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	policy: "sha256:c08e6377b1e8a6280325d6b99f43a201b1ae851b57a941cfe72992799797a9b9",
	lifecycleAuthority: "sha256:6a3448d208e2df31d05b78d92c26336f59d6414254e233e65be8c58a454ea513",
	toolAuthority: "sha256:0d6c43723fc7704732d27c1800eb022e3f4aef0369340bed017f3f8f9f05c1c2",
	providerAdapter: "sha256:7ac371036c82cba6a7f74867f4e02936b3223dbc53102e83871b003e3c909f41",
	semanticScenarios: "sha256:511f430395e27d7920b0c9bd9ea8853993f244c93563630179af1ab0bf9c8076",
	semanticBundleEntry: "sha256:158db76edd3133c1768c7dea5384c9031e7dfe2c3af9feb750e07ba2035536e8",
	liveComposition: "sha256:eefa1e9dbebd09363e3ab508443673f31153a4c17380ca42eb7ffaf463680b86",
	graphToolQualification: "sha256:17612723613e1a003cd2eae43dd34eaa9ab72db6376a161f837eba0ab361f36a",
	liveQualification: "sha256:e49e6555ae91d99f5695cd55864d65c8d8a4a441d718ab71de5edc0914c8f63b",
	providerBoundaryQualification:
		"sha256:d885e30a724f14786beb86b240aae4ddcdeec5ff19f4ae59e71e317af674404d",
	qualification: "sha256:28b4d9eda5031738b0c0d5f6e4bd96be55fce6043750ca85c04a53ae6225ec3c",
	qualificationRunner: "sha256:3b3f36184f5e452bc3bbf258d9e8a17048c659d18562ee6b7e37579d67046219",
	graphToolManifest: "sha256:cb54b7642ccfc5715703d453d5940dd1892a91bbe2fff76a399426bb4ce2683d",
	liveManifest: "sha256:094ccd4d5db72b8239de6ae9ab320e2d91374009b3d9aaedbaf205c0bcd276b0",
	providerBoundaryManifest:
		"sha256:36e7ff50d3d038c2209eb4f137372a53f819394723fa2bd9057ff1c1b2a87656",
	test: "sha256:faf3be9edf3d22b65ec57a724fb748e278ec4e0af2a291e0dc5e31b87a302408",
});

export const D61_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d61.implementation-manifest.v1",
	sources: D61_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD61Implementation(): Promise<string> {
	const measured = Object.freeze({
		policy: empiricalSha256(
			await readFile(join(import.meta.dirname, "d43-model-harness-policy.ts")),
		),
		lifecycleAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d43-graph-harness-authority.ts")),
		),
		toolAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-graph-tool-authority.ts")),
		),
		providerAdapter: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-mechanical-chat-adapter.ts")),
		),
		semanticScenarios: empiricalSha256(
			await readFile(join(import.meta.dirname, "d61-public-semantic-scenarios.ts")),
		),
		semanticBundleEntry: empiricalSha256(
			await readFile(join(import.meta.dirname, "d61-public-semantic-bundle-entry.ts")),
		),
		liveComposition: empiricalSha256(
			await readFile(join(import.meta.dirname, "d44-d45-live-composition.ts")),
		),
		graphToolQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-graph-tool-qualification.ts")),
		),
		liveQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d44-d45-live-qualification.ts")),
		),
		providerBoundaryQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d55-provider-boundary-qualification.ts")),
		),
		qualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d61-semantic-recovery-qualification.ts")),
		),
		qualificationRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d61-semantic-recovery-qualification.ts")),
		),
		graphToolManifest: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-implementation-manifest.ts")),
		),
		liveManifest: empiricalSha256(
			await readFile(join(import.meta.dirname, "d44-d45-live-implementation-manifest.ts")),
		),
		providerBoundaryManifest: empiricalSha256(
			await readFile(join(import.meta.dirname, "d55-provider-boundary-implementation-manifest.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d61-semantic-recovery.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D61_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D61 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d61.implementation-manifest.v1",
		sources: measured,
	});
}
