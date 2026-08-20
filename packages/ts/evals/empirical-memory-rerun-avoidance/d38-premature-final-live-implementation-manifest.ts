import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D37_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD37Implementation,
} from "./d37-premature-final-implementation-manifest.js";

export const D38_IMPLEMENTATION_FILES = Object.freeze({
	coordinates:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d38-premature-final-live-coordinates.ts",
	preflight:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d38-premature-final-live-preflight.ts",
	claim: "packages/ts/evals/empirical-memory-rerun-avoidance/d38-premature-final-live-claim.ts",
	realProviderComposition:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d38-premature-final-real-provider-composition.ts",
	live: "packages/ts/evals/empirical-memory-rerun-avoidance/d38-premature-final-live.ts",
	qualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d38-premature-final-live-qualification.ts",
	qualificationRunner:
		"packages/ts/evals/empirical-memory-rerun-avoidance/run-d38-premature-final-live-no-network.ts",
	liveRunner: "packages/ts/evals/empirical-memory-rerun-avoidance/run-d38-premature-final-live.ts",
	currentLivePreflight:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d20-current-live-preflight.ts",
	currentKeyAdmission:
		"packages/ts/evals/empirical-memory-rerun-avoidance/openrouter-current-key-spend-admission.ts",
} as const);

export const D38_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	coordinates: "sha256:3002f8dc0ac342270fdccd22aeaf2007897061f0ee0e61693efd7b8d99ac3d99",
	preflight: "sha256:2a282d04a4ff6cb4bce31409ed2be634a411a63c3d23e7cba30a838e649bb423",
	claim: "sha256:ed6fd785c3a9667d414b26369baabc1dc98bdae0818c1d19ed3489ba4b217181",
	realProviderComposition:
		"sha256:b4f80b00781b22a6b1c338277ca48d2d57f99f1a6d7675c4fbb432a4730dbee1",
	live: "sha256:c3fea732480b76f94316b007bd5608f4bcbd48081d77ac0d090d60941e965f69",
	qualification: "sha256:24cf20ef3d2d89ddf7d0251ed6d8b32140fafca95258722c0980f0a51430ffe4",
	qualificationRunner: "sha256:0c5225a669cfc9ed94c6da4d45e614c48d51e75c23bcc14ca9369f3dc9f2b363",
	liveRunner: "sha256:45fa2f8be921a4b1456d956743074446afce0b141b9d2fe1ec082cc4d0af3d20",
	currentLivePreflight: "sha256:d0791cd7dc6a4d774d1049d39764f346b9d75d0b75082e234f20ee8289ed1c07",
	currentKeyAdmission: "sha256:d14dd8ad79843b8327cdab521db8e67a098077feb272237c9b965a6e6ae5cc6d",
} as const);

export const D38_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly-ts.d38.premature-final-live-implementation-manifest.v5",
	baselineCommit: "205a0fb332b5c5bd1d8631c88031f8b361492249",
	d37ImplementationManifestDigest: D37_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D38_IMPLEMENTATION_SOURCE_DIGESTS,
});
export const D38_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D38_IMPLEMENTATION_MANIFEST,
);

export async function measureD38Implementation(repositoryRootValue: string): Promise<string> {
	const repositoryRoot = await realpath(resolve(repositoryRootValue));
	if ((await measureD37Implementation(repositoryRoot)) !== D37_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D38 D37 implementation baseline drifted");
	const measured: Record<string, string> = {};
	for (const [name, path] of Object.entries(D38_IMPLEMENTATION_FILES))
		measured[name] = empiricalSha256(new Uint8Array(await readFile(resolve(repositoryRoot, path))));
	for (const [name, expected] of Object.entries(D38_IMPLEMENTATION_SOURCE_DIGESTS))
		if (measured[name] !== expected)
			throw new TypeError(`D38 implementation source drifted: ${name}`);
	return empiricalStrictJsonDigest(
		strictSnapshot({
			revision: D38_IMPLEMENTATION_MANIFEST.revision,
			baselineCommit: D38_IMPLEMENTATION_MANIFEST.baselineCommit,
			d37ImplementationManifestDigest: D37_IMPLEMENTATION_MANIFEST_DIGEST,
			sources: measured,
		}),
	);
}
