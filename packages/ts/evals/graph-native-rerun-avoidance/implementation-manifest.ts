import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const CURRENT_QUALIFICATION_DIGEST =
	"sha256:385da52bcf498d55d306559d8d100aeb860328a0cc4bddcda92725d1a59bd898" as const;
export const CURRENT_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:b06946d5fa8c6ac9c9dbcb9febbe1bad3c89785901c61b3cebed346dac3cad72" as const;

// Updated only after the current closure and its no-network qualification are both frozen.
export const CURRENT_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:b72f7c4c0e473d40378337259c70713ab90a0a7af567f8db4f0620ac266c3e8b" as const;

export async function measureCurrentImplementation(): Promise<string> {
	const names = (await readdir(import.meta.dirname))
		.filter((name) => name.endsWith(".ts") && name !== "implementation-manifest.ts")
		.sort();
	if (names.some((name) => /^d\d+/u.test(name)))
		throw new TypeError(
			"current eval closure retained a historical D-numbered implementation file",
		);
	const sources: Record<string, string> = {};
	for (const name of names)
		sources[name] = empiricalSha256(await readFile(join(import.meta.dirname, name)));
	sources["current.test.ts"] = empiricalSha256(
		await readFile(
			join(
				import.meta.dirname,
				"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.current.test.ts",
			),
		),
	);
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d70.current-implementation-manifest.v1",
		qualificationArtifactDigest: CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
		qualificationDigest: CURRENT_QUALIFICATION_DIGEST,
		sources,
	});
}
