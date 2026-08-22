import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D66_QUALIFICATION_DIGEST =
	"sha256:a1b50bc67d9562cfe5c0e9489acd994067fbaadd6b47bf7d18ccbd012355a3c3" as const;
export const D66_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:a1b50bc67d9562cfe5c0e9489acd994067fbaadd6b47bf7d18ccbd012355a3c3" as const;

export const D66_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	lifecycleAuthority: "sha256:78bdc7cacdeeb1c3d7a47493a2da9a53db1ad01976b15960d9b87d07461d05c4",
	toolAuthority: "sha256:49bc45c4c875c317b4b7f8d70ff9c0fe4ff1a6a8293c1835e0026f9d7372e81b",
	providerAdapter: "sha256:08544e7945bc184e397a0e9b8e719ffeef80390704874c78eaf69cd429305376",
	qualification: "sha256:76379c026f4fbf2e88d659c9c7433a197006d5b39f0916e4702951adb951c497",
	qualificationRunner: "sha256:2136480fe1e897848731467b79ccb32625ce9627fa38e3e9c07599af7b4669eb",
	test: "sha256:43c58a2f107309a1e904bd69cc033663c462db256a870ca758c1a1614279dea1",
});

export const D66_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d66.implementation-manifest.v1",
	qualificationDigest: D66_QUALIFICATION_DIGEST,
	qualificationArtifactDigest: D66_QUALIFICATION_ARTIFACT_DIGEST,
	sources: D66_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD66Implementation(): Promise<string> {
	const measured = Object.freeze({
		lifecycleAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d43-graph-harness-authority.ts")),
		),
		toolAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-graph-tool-authority.ts")),
		),
		providerAdapter: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-mechanical-chat-adapter.ts")),
		),
		qualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d66-retry-identity-qualification.ts")),
		),
		qualificationRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d66-retry-identity-qualification.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d66-retry-identity.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D66_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D66 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d66.implementation-manifest.v1",
		qualificationDigest: D66_QUALIFICATION_DIGEST,
		qualificationArtifactDigest: D66_QUALIFICATION_ARTIFACT_DIGEST,
		sources: measured,
	});
}
