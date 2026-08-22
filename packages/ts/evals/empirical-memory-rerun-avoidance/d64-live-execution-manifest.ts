import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import {
	D63_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD63Implementation,
} from "./d63-implementation-manifest.js";

export const D64_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:5bfb6164077d521058e0356d309c8ecf363a870bd22aa90f5ae63a68e156673c" as const;
export const D64_QUALIFICATION_DIGEST =
	"sha256:1ee7dd45de7ab5da06d5f1906816f7f663a5e39d243884bcb949bf91bd1b61ae" as const;

export const D64_LIVE_EXECUTION_SOURCE_HASHES = Object.freeze({
	liveGates: "sha256:8da41303d112200193eb754c4ee70d5227758bf872c2e6b3aaeea8eec4197480",
	liveRunner: "sha256:ccf93fc0184427a8b9fb95e0c0b8cb2c6f357ed6e7ee6e161119151b183e26fd",
	d63ImplementationManifest:
		"sha256:cff0483432ae1faa6007ff38e051ad8e0be7583bcd9c061ad3206f85df265787",
	test: "sha256:01927dbc92802276a30b91deb073bfbc4d3757ea775ad3972a4d32eb7a08313f",
});

export const D64_LIVE_EXECUTION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d64.live-execution-manifest.v1",
	d63ImplementationManifestDigest: D63_IMPLEMENTATION_MANIFEST_DIGEST,
	qualificationArtifactDigest: D64_QUALIFICATION_ARTIFACT_DIGEST,
	qualificationDigest: D64_QUALIFICATION_DIGEST,
	sources: D64_LIVE_EXECUTION_SOURCE_HASHES,
});

export async function measureD64LiveExecution(): Promise<string> {
	if ((await measureD63Implementation()) !== D63_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D64 qualified D63 implementation closure drifted");
	const measured = Object.freeze({
		liveGates: empiricalSha256(await readFile(join(import.meta.dirname, "d44-d45-live-gates.ts"))),
		liveRunner: empiricalSha256(await readFile(join(import.meta.dirname, "run-d44-d45-live.ts"))),
		d63ImplementationManifest: empiricalSha256(
			await readFile(join(import.meta.dirname, "d63-implementation-manifest.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d64-live-execution.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D64_LIVE_EXECUTION_SOURCE_HASHES))
		throw new TypeError("D64 live execution source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d64.live-execution-manifest.v1",
		d63ImplementationManifestDigest: D63_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: D64_QUALIFICATION_ARTIFACT_DIGEST,
		qualificationDigest: D64_QUALIFICATION_DIGEST,
		sources: measured,
	});
}
