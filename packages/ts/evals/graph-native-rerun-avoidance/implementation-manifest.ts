import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const CURRENT_QUALIFICATION_DIGEST =
	"sha256:e10578d548f6e4fa7d21975882bd372dd964f68ccd4cd89d83261a135cd8fc9f" as const;
export const CURRENT_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:a984c0cf404d3343a6c72131aa4262fd431256c98a205b71eed626a07ed3df4f" as const;

// Updated only after the current closure and its no-network qualification are both frozen.
export const CURRENT_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:a47402cbeb7b50b10914f167196b1f6cae42f1654e51c8eb3383404f3c384d13" as const;

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
		revision: "graphrefly-ts.d68.current-implementation-manifest.v1",
		qualificationArtifactDigest: CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
		qualificationDigest: CURRENT_QUALIFICATION_DIGEST,
		sources,
	});
}
