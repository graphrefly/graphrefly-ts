import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import { D45_IMPLEMENTATION_MANIFEST_DIGEST } from "./d45-implementation-manifest.js";

export const D44_D45_LIVE_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	policy: "sha256:c08e6377b1e8a6280325d6b99f43a201b1ae851b57a941cfe72992799797a9b9",
	lifecycleAuthority: "sha256:6a3448d208e2df31d05b78d92c26336f59d6414254e233e65be8c58a454ea513",
	toolAuthority: "sha256:21d3c01e0fe14617e331666ba7a24a874764497cb772a8cdbd2f60ad592adc09",
	adapter: "sha256:7ac371036c82cba6a7f74867f4e02936b3223dbc53102e83871b003e3c909f41",
	liveComposition: "sha256:46b61099293f9b1f3c0aca4fd8a2f963a0a57a4a863885b43ba07103c2192cb8",
	semanticScenarios: "sha256:c105af727adba7dd53ca5c33f9ddc640a17beda58342f314d5a05f817d8f92b1",
	semanticBundleEntry: "sha256:5fec8f81a967301f18e6be18ebc0dedef29ef12cf5eaa29eeae9b0a49a258d19",
	liveQualification: "sha256:907e8d04b490fd7fd7bbb13d7431de6cab7e956aeb45ce2364dad07363b88a64",
});

export const D44_D45_LIVE_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d61.live-implementation-manifest.v1",
	d45ImplementationManifestDigest: D45_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D44_D45_LIVE_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD44D45LiveImplementation(): Promise<string> {
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
		adapter: empiricalSha256(
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
		liveQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d44-d45-live-qualification.ts")),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D44_D45_LIVE_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D44/D45 live implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d61.live-implementation-manifest.v1",
		d45ImplementationManifestDigest: D45_IMPLEMENTATION_MANIFEST_DIGEST,
		sources: measured,
	});
}
