import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D46_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	policy: "sha256:c08e6377b1e8a6280325d6b99f43a201b1ae851b57a941cfe72992799797a9b9",
	lifecycleAuthority: "sha256:d11990a590a7b5418073941310d04b6b4f4807c75f60afdc2248062cf478f006",
	toolAuthority: "sha256:18133cabf5040c75173745bcb2844753616a5aa62dd666147a697f8745aa9151",
	taskQualification: "sha256:609cea201e10d284d3ab6e22acd7a13a69c4d284ba87ba318bd34f4592846a5d",
	providerAdapter: "sha256:56e0dc56eae88e17650d636b9b01aaca5172747d49d1ea8b943f6d76bbe03a9e",
	localExecutor: "sha256:27cf642616568f7edad2feaa66fddd13834ae302f807176387f8a9698c27986e",
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
