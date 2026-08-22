import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const CURRENT_QUALIFICATION_DIGEST =
	"sha256:e54428e6e5867ce20acdbd5347136155c40a4ef69b2011e1cb2a4bb4de8d2e5a" as const;
export const CURRENT_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:ddd4411ba58605f01c3a58e7ec3bb1d15c38e2f768f81c3feb73eaf79e2a0174" as const;

// Updated only after the current closure and its no-network qualification are both frozen.
export const CURRENT_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:0ab803d42dac1addbcf205f40bdb02b1b605f51e8027bdcce97be7cc277e016b" as const;

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
		revision: "graphrefly-ts.d69.current-implementation-manifest.v1",
		qualificationArtifactDigest: CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
		qualificationDigest: CURRENT_QUALIFICATION_DIGEST,
		sources,
	});
}
