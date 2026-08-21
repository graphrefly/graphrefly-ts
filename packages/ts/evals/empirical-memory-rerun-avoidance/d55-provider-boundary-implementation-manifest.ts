import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D55_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	policy: "sha256:c08e6377b1e8a6280325d6b99f43a201b1ae851b57a941cfe72992799797a9b9",
	lifecycleAuthority: "sha256:d11990a590a7b5418073941310d04b6b4f4807c75f60afdc2248062cf478f006",
	providerAdapter: "sha256:3e707898a3ff77f0f33324764eb3c9493df56730a8d42d98050748ebbae79902",
	liveComposition: "sha256:ac7d1c6a1aaf1fe9869293a1a6c186bd3491580450df799ab745dd51f14226b2",
	toolAuthority: "sha256:18133cabf5040c75173745bcb2844753616a5aa62dd666147a697f8745aa9151",
	toolQualification: "sha256:609cea201e10d284d3ab6e22acd7a13a69c4d284ba87ba318bd34f4592846a5d",
	boundedAuthority: "sha256:f60ee377465afa3824d4f4d93e20c687d3e25851ad15a76c3b28262bb641d2c3",
	boundedComposition: "sha256:5086a21ec598a74a0803ad600a32fd6b74697e7f968f425e1cfa8abc3cea4893",
	qualification: "sha256:55819919e6c9feb1dea65c7e325056f3b2fb1a1d7ab38908ccc3b1008f8c9bb2",
	qualificationRunner: "sha256:8951671117769601fb37f1c0c84f7bcdbb3bf23c413e0247ba03b2ac4fd80c88",
	test: "sha256:69bb9dbd29fa8755026ab63a04bb257ce347ee925ac7d5e5b84e2280c23fe7d8",
});

export const D55_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d55.implementation-manifest.v1",
	sources: D55_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD55Implementation(): Promise<string> {
	const measured = Object.freeze({
		policy: empiricalSha256(
			await readFile(join(import.meta.dirname, "d43-model-harness-policy.ts")),
		),
		lifecycleAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d43-graph-harness-authority.ts")),
		),
		providerAdapter: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-mechanical-chat-adapter.ts")),
		),
		liveComposition: empiricalSha256(
			await readFile(join(import.meta.dirname, "d44-d45-live-composition.ts")),
		),
		toolAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-graph-tool-authority.ts")),
		),
		toolQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-graph-tool-qualification.ts")),
		),
		boundedAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d46-bounded-inspection-authority.ts")),
		),
		boundedComposition: empiricalSha256(
			await readFile(join(import.meta.dirname, "d46-bounded-inspection-composition.ts")),
		),
		qualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d55-provider-boundary-qualification.ts")),
		),
		qualificationRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d55-provider-boundary-qualification.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d55-provider-boundary.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D55_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D55 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d55.implementation-manifest.v1",
		sources: measured,
	});
}
