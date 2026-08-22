import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import {
	D61_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD61Implementation,
} from "./d61-implementation-manifest.js";

export const D62_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:e9366652a639a636507111bab10b37d8e251282a623b762a234a97d4b668e06f" as const;
export const D62_QUALIFICATION_DIGEST =
	"sha256:67980a6da2e34154597b2e4146eabcf71e5d43392cf1b4d14126fc08ceea8bb7" as const;

export const D62_LIVE_EXECUTION_SOURCE_HASHES = Object.freeze({
	liveGates: "sha256:675a2290df820ae5a432d500ca0b31193e77467c514b14ec95fc286dae011436",
	liveRunner: "sha256:98ca7a9ff2f8be8a7c3078428164c63af43659d4caff1816da0cbcf6affc174a",
	d61ImplementationManifest:
		"sha256:6f844a4e5a7407b6aa326abc69cc156678475774626d5447e7f6b0a992430085",
});

export const D62_LIVE_EXECUTION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d62.live-execution-manifest.v1",
	d61ImplementationManifestDigest: D61_IMPLEMENTATION_MANIFEST_DIGEST,
	qualificationArtifactDigest: D62_QUALIFICATION_ARTIFACT_DIGEST,
	qualificationDigest: D62_QUALIFICATION_DIGEST,
	sources: D62_LIVE_EXECUTION_SOURCE_HASHES,
});

export async function measureD62LiveExecution(): Promise<string> {
	if ((await measureD61Implementation()) !== D61_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D62 qualified D61 implementation closure drifted");
	const measured = Object.freeze({
		liveGates: empiricalSha256(await readFile(join(import.meta.dirname, "d44-d45-live-gates.ts"))),
		liveRunner: empiricalSha256(await readFile(join(import.meta.dirname, "run-d44-d45-live.ts"))),
		d61ImplementationManifest: empiricalSha256(
			await readFile(join(import.meta.dirname, "d61-implementation-manifest.ts")),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D62_LIVE_EXECUTION_SOURCE_HASHES))
		throw new TypeError("D62 live execution source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d62.live-execution-manifest.v1",
		d61ImplementationManifestDigest: D61_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: D62_QUALIFICATION_ARTIFACT_DIGEST,
		qualificationDigest: D62_QUALIFICATION_DIGEST,
		sources: measured,
	});
}
