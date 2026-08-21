import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D46_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	policy: "sha256:c08e6377b1e8a6280325d6b99f43a201b1ae851b57a941cfe72992799797a9b9",
	lifecycleAuthority: "sha256:d80c6ca67dddd5ba3ac20c53d50d6bd565f551b40b00d9566aadc7139b645b92",
	toolAuthority: "sha256:e666dcf803b0d09b5b5756174f6f1fa15e69c010fbe306a4d87b3c7a58989329",
	taskQualification: "sha256:b94a7acf88b90776fc39afa53b0602cffc9b8a5d4787adb56fad194e32fee55c",
	providerAdapter: "sha256:f3734719cf21d4e398c17734af152d6001d2ef3b4bbcdc8987d8a2e678fa4711",
	localExecutor: "sha256:aeed02c1590cd0608a97dc5eb3ad153e74ad717a1772027067743066a9f405c2",
	boundedAuthority: "sha256:f60ee377465afa3824d4f4d93e20c687d3e25851ad15a76c3b28262bb641d2c3",
	composition: "sha256:5086a21ec598a74a0803ad600a32fd6b74697e7f968f425e1cfa8abc3cea4893",
	qualification: "sha256:373b90d54f4d5af0caf4e5325bdec06e298b772e477eaa87fb1d226ae91f49b2",
	qualificationRunner: "sha256:ce453ba4de2528c2ff3f9a0f80f5065b8a12f73366de1e7234cc00670078352b",
	test: "sha256:010059566713a5bd77825e4833799a964a3cfb789a394c8e5da51e32d894d55f",
});

export const D46_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d46.implementation-manifest.v2",
	sources: D46_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD46Implementation(): Promise<string> {
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
		taskQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-graph-tool-qualification.ts")),
		),
		providerAdapter: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-mechanical-chat-adapter.ts")),
		),
		localExecutor: empiricalSha256(
			await readFile(join(import.meta.dirname, "d44-d45-live-composition.ts")),
		),
		boundedAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d46-bounded-inspection-authority.ts")),
		),
		composition: empiricalSha256(
			await readFile(join(import.meta.dirname, "d46-bounded-inspection-composition.ts")),
		),
		qualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d46-bounded-inspection-qualification.ts")),
		),
		qualificationRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "d46-bounded-inspection-qualification-runner.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d46-bounded-inspection.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D46_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D46 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d46.implementation-manifest.v2",
		sources: measured,
	});
}
