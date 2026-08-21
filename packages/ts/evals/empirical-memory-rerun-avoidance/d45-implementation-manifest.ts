import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D45_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	policy: "sha256:c08e6377b1e8a6280325d6b99f43a201b1ae851b57a941cfe72992799797a9b9",
	lifecycleAuthority: "sha256:d11990a590a7b5418073941310d04b6b4f4807c75f60afdc2248062cf478f006",
	toolAuthority: "sha256:18133cabf5040c75173745bcb2844753616a5aa62dd666147a697f8745aa9151",
	adapter: "sha256:ccec5fa6fe34a3144a9e1a34f8c191e10c56221b02f89f434d5ffc0d5e51d822",
	qualification: "sha256:609cea201e10d284d3ab6e22acd7a13a69c4d284ba87ba318bd34f4592846a5d",
});

export const D45_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d45.implementation-manifest.v2",
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
		revision: "graphrefly-ts.d45.implementation-manifest.v2",
		sources: measured,
	});
}
