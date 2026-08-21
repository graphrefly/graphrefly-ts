import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D45_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	policy: "sha256:c08e6377b1e8a6280325d6b99f43a201b1ae851b57a941cfe72992799797a9b9",
	lifecycleAuthority: "sha256:d80c6ca67dddd5ba3ac20c53d50d6bd565f551b40b00d9566aadc7139b645b92",
	toolAuthority: "sha256:e666dcf803b0d09b5b5756174f6f1fa15e69c010fbe306a4d87b3c7a58989329",
	adapter: "sha256:f3734719cf21d4e398c17734af152d6001d2ef3b4bbcdc8987d8a2e678fa4711",
	qualification: "sha256:b94a7acf88b90776fc39afa53b0602cffc9b8a5d4787adb56fad194e32fee55c",
});

export const D45_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d45.implementation-manifest.v1",
	sources: D45_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD45Implementation(): Promise<string> {
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
		adapter: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-mechanical-chat-adapter.ts")),
		),
		qualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-graph-tool-qualification.ts")),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D45_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D45 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d45.implementation-manifest.v1",
		sources: measured,
	});
}
