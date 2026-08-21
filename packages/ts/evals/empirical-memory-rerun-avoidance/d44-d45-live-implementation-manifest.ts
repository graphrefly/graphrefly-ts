import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import { D45_IMPLEMENTATION_MANIFEST_DIGEST } from "./d45-implementation-manifest.js";

export const D44_D45_LIVE_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	policy: "sha256:c08e6377b1e8a6280325d6b99f43a201b1ae851b57a941cfe72992799797a9b9",
	lifecycleAuthority: "sha256:fe36cb8ebc0e01f1fd6288586245aaa2c6f71bf5cf7d51211641921c69e1c874",
	toolAuthority: "sha256:dc3c69fbe2bdb343a952a5d95efbe9947e444fdc56c289de1b77e925c54df87b",
	adapter: "sha256:50e3b0bfb6d7e510303ea0ecac9ae4633859034b552d29bee382eb81690e7ed1",
	liveComposition: "sha256:5e093fa1a06aac1f02be4a4dd8d59b15e295ece8974262be3e135a68c3f1f0c7",
	liveQualification: "sha256:ba6cf1b4c9f14848e5908d1a86e8d114cb571118eeeac9963e27aa7d49a445c3",
});

export const D44_D45_LIVE_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d44.d45-live-implementation-manifest.v1",
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
		liveQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d44-d45-live-qualification.ts")),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D44_D45_LIVE_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D44/D45 live implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d44.d45-live-implementation-manifest.v1",
		d45ImplementationManifestDigest: D45_IMPLEMENTATION_MANIFEST_DIGEST,
		sources: measured,
	});
}
