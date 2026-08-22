import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D45_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	policy: "sha256:c08e6377b1e8a6280325d6b99f43a201b1ae851b57a941cfe72992799797a9b9",
	lifecycleAuthority: "sha256:6a3448d208e2df31d05b78d92c26336f59d6414254e233e65be8c58a454ea513",
	toolAuthority: "sha256:21d3c01e0fe14617e331666ba7a24a874764497cb772a8cdbd2f60ad592adc09",
	adapter: "sha256:7ac371036c82cba6a7f74867f4e02936b3223dbc53102e83871b003e3c909f41",
	qualification: "sha256:0e3eecf86eaac42f52fe31efe4ca08bff37e94a027f47c7067b1219391b7af64",
	semanticScenarios: "sha256:c105af727adba7dd53ca5c33f9ddc640a17beda58342f314d5a05f817d8f92b1",
	semanticBundleEntry: "sha256:5fec8f81a967301f18e6be18ebc0dedef29ef12cf5eaa29eeae9b0a49a258d19",
});

export const D45_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d61.implementation-manifest.v1",
	sources: D45_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD45Implementation(): Promise<string> {
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
		qualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-graph-tool-qualification.ts")),
		),
		semanticScenarios: empiricalSha256(
			await readFile(join(import.meta.dirname, "d61-public-semantic-scenarios.ts")),
		),
		semanticBundleEntry: empiricalSha256(
			await readFile(join(import.meta.dirname, "d61-public-semantic-bundle-entry.ts")),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D45_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D45 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d61.implementation-manifest.v1",
		sources: measured,
	});
}
