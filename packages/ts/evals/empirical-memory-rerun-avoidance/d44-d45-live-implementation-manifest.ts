import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import { D45_IMPLEMENTATION_MANIFEST_DIGEST } from "./d45-implementation-manifest.js";

export const D44_D45_LIVE_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	policy: "sha256:c08e6377b1e8a6280325d6b99f43a201b1ae851b57a941cfe72992799797a9b9",
	lifecycleAuthority: "sha256:d80c6ca67dddd5ba3ac20c53d50d6bd565f551b40b00d9566aadc7139b645b92",
	toolAuthority: "sha256:e666dcf803b0d09b5b5756174f6f1fa15e69c010fbe306a4d87b3c7a58989329",
	adapter: "sha256:f3734719cf21d4e398c17734af152d6001d2ef3b4bbcdc8987d8a2e678fa4711",
	liveComposition: "sha256:aeed02c1590cd0608a97dc5eb3ad153e74ad717a1772027067743066a9f405c2",
	liveQualification: "sha256:95430278f8024316b5fd78ddeae0eb482866b4ec03fdf403a0e9965bcc334e07",
	liveGates: "sha256:39bf56f1a0364b9c1e1b1e7097e05f00f2eeab67761c100070033ee9bb6e1a8e",
	liveRunner: "sha256:90e1f9f58e085fc500def69fe425f4bf1df65e54083a14c894041a73e1dc22d8",
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
		liveGates: empiricalSha256(await readFile(join(import.meta.dirname, "d44-d45-live-gates.ts"))),
		liveRunner: empiricalSha256(await readFile(join(import.meta.dirname, "run-d44-d45-live.ts"))),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D44_D45_LIVE_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D44/D45 live implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d44.d45-live-implementation-manifest.v1",
		d45ImplementationManifestDigest: D45_IMPLEMENTATION_MANIFEST_DIGEST,
		sources: measured,
	});
}
