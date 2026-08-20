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
	coordinates: "sha256:4cfc060dcd54f2a912970431bd661cbda88c711fea96bf3f8615169af8dd22c6",
	preflight: "sha256:2c5ed0e91ba18f872393f408951e13db2deb732563b6c89a29f8b21d6e96fdda",
	claim: "sha256:8675527dd7b2810ab1db90e59201fa5d59c41286daadd9e3821a45a302cbff38",
	realProviderComposition:
		"sha256:c617457d098994476185af9e370449e39f18bda726351f0814793a72a7585557",
	live: "sha256:b35b4a1632a4161bbc214b3c5d099bbdee4d938b3e9be3a80cd300b4a60a2387",
	qualification: "sha256:c109ef3284ef99eadf848ef193fceabbcdad67c357aabdfcfd72386acec217df",
	qualificationRunner: "sha256:d3f52aec7ea7d3ccafcce2481ea48027667e94dfa6b54ebceeeae8f0983e8c8a",
	liveRunner: "sha256:94122844abaf1ecbde6ce500f052018d45a4f5b33c7a1fcfdc4e367c942a91a3",
	currentLivePreflight: "sha256:d0791cd7dc6a4d774d1049d39764f346b9d75d0b75082e234f20ee8289ed1c07",
	currentKeyAdmission: "sha256:d14dd8ad79843b8327cdab521db8e67a098077feb272237c9b965a6e6ae5cc6d",
} as const);

export const D38_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly-ts.d39.premature-final-live-implementation-manifest.v2",
	baselineCommit: "91f30ca7fde3d5d91b62e6e574bbdeab60636ebd",
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
