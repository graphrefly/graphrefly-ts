import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D55_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	policy: "sha256:c08e6377b1e8a6280325d6b99f43a201b1ae851b57a941cfe72992799797a9b9",
	lifecycleAuthority: "sha256:6a3448d208e2df31d05b78d92c26336f59d6414254e233e65be8c58a454ea513",
	providerAdapter: "sha256:7ac371036c82cba6a7f74867f4e02936b3223dbc53102e83871b003e3c909f41",
	liveComposition: "sha256:eefa1e9dbebd09363e3ab508443673f31153a4c17380ca42eb7ffaf463680b86",
	semanticScenarios: "sha256:511f430395e27d7920b0c9bd9ea8853993f244c93563630179af1ab0bf9c8076",
	semanticBundleEntry: "sha256:158db76edd3133c1768c7dea5384c9031e7dfe2c3af9feb750e07ba2035536e8",
	toolAuthority: "sha256:0d6c43723fc7704732d27c1800eb022e3f4aef0369340bed017f3f8f9f05c1c2",
	toolQualification: "sha256:17612723613e1a003cd2eae43dd34eaa9ab72db6376a161f837eba0ab361f36a",
	boundedAuthority: "sha256:f60ee377465afa3824d4f4d93e20c687d3e25851ad15a76c3b28262bb641d2c3",
	boundedComposition: "sha256:5086a21ec598a74a0803ad600a32fd6b74697e7f968f425e1cfa8abc3cea4893",
	qualification: "sha256:d885e30a724f14786beb86b240aae4ddcdeec5ff19f4ae59e71e317af674404d",
	qualificationRunner: "sha256:d4f67f1384c372df4ea6338ee8b3dfc8acc55edaae4044ecf7d3d247d3b17040",
	test: "sha256:be74e4c4698f88459c70d405c5b634f3b47833a56cbf1188b20bc364f2b8572c",
});

export const D55_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d61.provider-boundary-implementation-manifest.v1",
	sources: D55_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD55Implementation(): Promise<string> {
	const measured = Object.freeze({
		policy: empiricalSha256(
			await readFile(join(import.meta.dirname, "d43-model-harness-policy.ts")),
		),
		lifecycleAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d43-graph-harness-authority.ts")),
		),
		providerAdapter: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-mechanical-chat-adapter.ts")),
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
		toolAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-graph-tool-authority.ts")),
		),
		toolQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-graph-tool-qualification.ts")),
		),
		boundedAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d46-bounded-inspection-authority.ts")),
		),
		boundedComposition: empiricalSha256(
			await readFile(join(import.meta.dirname, "d46-bounded-inspection-composition.ts")),
		),
		qualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d55-provider-boundary-qualification.ts")),
		),
		qualificationRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d55-provider-boundary-qualification.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d55-provider-boundary.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D55_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D55 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d61.provider-boundary-implementation-manifest.v1",
		sources: measured,
	});
}
