import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D61_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	policy: "sha256:c08e6377b1e8a6280325d6b99f43a201b1ae851b57a941cfe72992799797a9b9",
	lifecycleAuthority: "sha256:6a3448d208e2df31d05b78d92c26336f59d6414254e233e65be8c58a454ea513",
	toolAuthority: "sha256:21d3c01e0fe14617e331666ba7a24a874764497cb772a8cdbd2f60ad592adc09",
	providerAdapter: "sha256:7ac371036c82cba6a7f74867f4e02936b3223dbc53102e83871b003e3c909f41",
	semanticScenarios: "sha256:c105af727adba7dd53ca5c33f9ddc640a17beda58342f314d5a05f817d8f92b1",
	semanticBundleEntry: "sha256:5fec8f81a967301f18e6be18ebc0dedef29ef12cf5eaa29eeae9b0a49a258d19",
	liveComposition: "sha256:46b61099293f9b1f3c0aca4fd8a2f963a0a57a4a863885b43ba07103c2192cb8",
	graphToolQualification: "sha256:0e3eecf86eaac42f52fe31efe4ca08bff37e94a027f47c7067b1219391b7af64",
	liveQualification: "sha256:907e8d04b490fd7fd7bbb13d7431de6cab7e956aeb45ce2364dad07363b88a64",
	providerBoundaryQualification:
		"sha256:5e7c0d459e870206cdcb691291f5974b6e1226ec3fb676512d75271a302ba2b5",
	qualification: "sha256:28b4d9eda5031738b0c0d5f6e4bd96be55fce6043750ca85c04a53ae6225ec3c",
	qualificationRunner: "sha256:3b3f36184f5e452bc3bbf258d9e8a17048c659d18562ee6b7e37579d67046219",
	graphToolManifest: "sha256:c852fdee3a9f5c48371e75c8a29f34f6c69633eeb29cf93a5acdc4756b6f5684",
	liveManifest: "sha256:0257a2a0cdc4bcedbd5b189dda361848551a341aac700453bb9858bf2a895077",
	providerBoundaryManifest:
		"sha256:8de312545124fc6792dea96f5d4ea6930bdcc9d2242cd1f48e9b86b7bda41b2d",
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
