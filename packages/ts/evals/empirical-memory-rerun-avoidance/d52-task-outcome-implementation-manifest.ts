import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D52_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	policy: "sha256:c08e6377b1e8a6280325d6b99f43a201b1ae851b57a941cfe72992799797a9b9",
	lifecycleAuthority: "sha256:d11990a590a7b5418073941310d04b6b4f4807c75f60afdc2248062cf478f006",
	toolAuthority: "sha256:18133cabf5040c75173745bcb2844753616a5aa62dd666147a697f8745aa9151",
	providerAdapter: "sha256:46f823f460a6b0842b19641641443cd70bd52ac9f103352a77c25ddeac62fa36",
	taskQualification: "sha256:24a143ace24edf0cf4cdd0a7f03a7e9c06173a1168a3387a04bc73cdde5e97f3",
	localExecutor: "sha256:ac7d1c6a1aaf1fe9869293a1a6c186bd3491580450df799ab745dd51f14226b2",
	boundedAuthority: "sha256:f60ee377465afa3824d4f4d93e20c687d3e25851ad15a76c3b28262bb641d2c3",
	composition: "sha256:5086a21ec598a74a0803ad600a32fd6b74697e7f968f425e1cfa8abc3cea4893",
	fullSixArmQualification:
		"sha256:373b90d54f4d5af0caf4e5325bdec06e298b772e477eaa87fb1d226ae91f49b2",
	taskOutcomeQualification:
		"sha256:a72a54a37c1a2a8401c1d858478ac9ae7ca9abe3e9c121e902e3e74fbbe34881",
	qualificationRunner: "sha256:4f281eb3bfa272b777761d19b46a1ad754899eb39dcf2467132609c6b1a017cf",
	test: "sha256:9b08812385691fab78708f2cb9d05f68a08093b39919e6d75cab105d450fa709",
});

export const D52_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d59.task-outcome-implementation-manifest.v2",
	sources: D52_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD52Implementation(): Promise<string> {
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
		taskQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-graph-tool-qualification.ts")),
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
		fullSixArmQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d46-bounded-inspection-qualification.ts")),
		),
		taskOutcomeQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d52-task-outcome-qualification.ts")),
		),
		qualificationRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d52-task-outcome-qualification.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d52-task-outcome.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D52_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D52 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d59.task-outcome-implementation-manifest.v2",
		sources: measured,
	});
}
