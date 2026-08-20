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
	coordinates: "sha256:32dfcd2e76d1301a0ca8d3727d699814f51657c6b8aac08df6e2fe2d489a4477",
	preflight: "sha256:2a282d04a4ff6cb4bce31409ed2be634a411a63c3d23e7cba30a838e649bb423",
	claim: "sha256:ed6fd785c3a9667d414b26369baabc1dc98bdae0818c1d19ed3489ba4b217181",
	realProviderComposition:
		"sha256:d05a0d6d6d20fb0729e23932f100a79228ffae17ce05ff7c8adcc10bd7a4fc89",
	live: "sha256:e3fd8312a3578979d62130c888006a2c98544a59b97c2957953775caf850d099",
	qualification: "sha256:66493b90aec75bb3d487f72969c1ea8928d34c07cef7be791d5bfe851cca77f2",
	qualificationRunner: "sha256:0c5225a669cfc9ed94c6da4d45e614c48d51e75c23bcc14ca9369f3dc9f2b363",
	liveRunner: "sha256:45fa2f8be921a4b1456d956743074446afce0b141b9d2fe1ec082cc4d0af3d20",
	currentLivePreflight: "sha256:d0791cd7dc6a4d774d1049d39764f346b9d75d0b75082e234f20ee8289ed1c07",
	currentKeyAdmission: "sha256:d14dd8ad79843b8327cdab521db8e67a098077feb272237c9b965a6e6ae5cc6d",
} as const);

export const D38_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly-ts.d38.premature-final-live-implementation-manifest.v2",
	baselineCommit: "4e3b57b95db3ee52acf77b7d32527f0b74c08f53",
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
