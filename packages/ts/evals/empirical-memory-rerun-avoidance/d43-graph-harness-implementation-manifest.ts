import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D43_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	policy: "sha256:c08e6377b1e8a6280325d6b99f43a201b1ae851b57a941cfe72992799797a9b9",
	authority: "sha256:d11990a590a7b5418073941310d04b6b4f4807c75f60afdc2248062cf478f006",
	qualification: "sha256:e6e8e8ca24b899810c9dc38a11e2905b60c12fc8bbc5d058460a77fa3dbea9c0",
	adapter: "sha256:1fbf757eca0e04ce7082d2fe9366172de2d007f0beebebfbdd6e83fbbeaf1a77",
	runner: "sha256:6de991193aa160873c2238f0fbe89ceb823c067dc96444d04dfb714ff7dfc4e8",
});

export const D43_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d43.graph-harness-implementation-manifest.v1",
	sources: D43_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD43Implementation(): Promise<string> {
	const measured = Object.freeze({
		policy: empiricalSha256(
			await readFile(join(import.meta.dirname, "d43-model-harness-policy.ts")),
		),
		authority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d43-graph-harness-authority.ts")),
		),
		qualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d43-graph-harness-qualification.ts")),
		),
		adapter: empiricalSha256(
			await readFile(join(import.meta.dirname, "d43-mechanical-provider-adapter.ts")),
		),
		runner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d43-model-policy-no-network.ts")),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D43_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D43 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d43.graph-harness-implementation-manifest.v1",
		sources: measured,
	});
}
