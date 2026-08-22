import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import { D45_IMPLEMENTATION_MANIFEST_DIGEST } from "./d45-implementation-manifest.js";

export const D44_D45_LIVE_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	policy: "sha256:c08e6377b1e8a6280325d6b99f43a201b1ae851b57a941cfe72992799797a9b9",
	lifecycleAuthority: "sha256:6a3448d208e2df31d05b78d92c26336f59d6414254e233e65be8c58a454ea513",
	toolAuthority: "sha256:0d6c43723fc7704732d27c1800eb022e3f4aef0369340bed017f3f8f9f05c1c2",
	adapter: "sha256:7ac371036c82cba6a7f74867f4e02936b3223dbc53102e83871b003e3c909f41",
	liveComposition: "sha256:eefa1e9dbebd09363e3ab508443673f31153a4c17380ca42eb7ffaf463680b86",
	semanticScenarios: "sha256:511f430395e27d7920b0c9bd9ea8853993f244c93563630179af1ab0bf9c8076",
	semanticBundleEntry: "sha256:158db76edd3133c1768c7dea5384c9031e7dfe2c3af9feb750e07ba2035536e8",
	liveQualification: "sha256:e49e6555ae91d99f5695cd55864d65c8d8a4a441d718ab71de5edc0914c8f63b",
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
