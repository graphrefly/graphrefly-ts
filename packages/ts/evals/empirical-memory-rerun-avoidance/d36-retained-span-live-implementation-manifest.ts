import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D35_IMPLEMENTATION_MANIFEST_DIGEST } from "./d35-retained-span-implementation-manifest.js";

export const D36_IMPLEMENTATION_FILES = Object.freeze({
	coordinates:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d36-retained-span-live-coordinates.ts",
	preflight:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d36-retained-span-live-preflight.ts",
	claim: "packages/ts/evals/empirical-memory-rerun-avoidance/d36-retained-span-live-claim.ts",
	live: "packages/ts/evals/empirical-memory-rerun-avoidance/d36-retained-span-live.ts",
	qualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d36-retained-span-live-qualification.ts",
	qualificationRunner:
		"packages/ts/evals/empirical-memory-rerun-avoidance/run-d36-retained-span-live-no-network.ts",
	liveRunner: "packages/ts/evals/empirical-memory-rerun-avoidance/run-d36-retained-span-live.ts",
	d35Manifest:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d35-retained-span-implementation-manifest.ts",
	d35Composition:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d35-retained-span-real-provider-composition.ts",
	d35Qualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d35-retained-span-real-provider-qualification.ts",
	retainedAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d34-retained-span-mutation-authority.ts",
	openRouterAdapter:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d8-current-openrouter-adapter.ts",
	d20Preflight: "packages/ts/evals/empirical-memory-rerun-avoidance/d20-current-live-preflight.ts",
	currentKey:
		"packages/ts/evals/empirical-memory-rerun-avoidance/openrouter-current-key-spend-admission.ts",
	gateAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d21-current-efficacy-recovery-authority.ts",
	privatePersistence:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d6-current-private-persistence.ts",
} as const);

export const D36_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	coordinates: "sha256:832267bfa10f9a1b57ea0acfc47a7e3044309200e23dd7b5eb07930631802933",
	preflight: "sha256:d1a984aafd4300d647fcdbc42f7a54ba239a452c114fe20818367e92ddf7179d",
	claim: "sha256:28d3015772e58f06b8ff186ba22a34893583885efd539ab5ddc200f25e3db181",
	live: "sha256:a0008cff1c250073af86ae92decb17354ab27031cdbe30a680443b50fceda3fc",
	qualification: "sha256:217bf28ba68be6da147a4a395755764b7eae42ad6c9ed417f7f268c2daf4d09a",
	qualificationRunner: "sha256:6727b34c6af7d438d51f4d8ac1a91a6d255a86b6ac547ef181bbdaaaf96995e5",
	liveRunner: "sha256:18eea5ded0de7f6af24af255bd0dc66a86f4fc467f28c41fe1dd22d429871a1f",
	d35Manifest: "sha256:3c793d0d31373e92c0f4b23d23b1cfc5d7209830f1cf13be65802741398b8e32",
	d35Composition: "sha256:e065fc22fdcb0ab0f833b142fa69935bc6717eece8077f29dd4fc9249315294d",
	d35Qualification: "sha256:ad387fd15c3d2ff6c15fe59dfcd7442aafe344f75e79ff85ce883b3188173917",
	retainedAuthority: "sha256:fbefb5fc1298e4e919d91c102116e25653ee39d76a5245053abdf5650a9fb87c",
	openRouterAdapter: "sha256:e1d825b9a1b4128f18d25f4604d48696f97d26b21fcd31bfaea0a6077226d377",
	d20Preflight: "sha256:d0791cd7dc6a4d774d1049d39764f346b9d75d0b75082e234f20ee8289ed1c07",
	currentKey: "sha256:d14dd8ad79843b8327cdab521db8e67a098077feb272237c9b965a6e6ae5cc6d",
	gateAuthority: "sha256:60c3462b86c592365166b5919e25d75fbf4659352710c4aea12e2f03d6db4542",
	privatePersistence: "sha256:0563c15908914694df6d2b80aba11840ce8f91f2c63f6ed2c97c2e5f3dc8a113",
} as const);

export const D36_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly-ts.d36.retained-span-live-implementation-manifest.v1",
	baselineCommit: "e988b032de8bbcedd0bed88e079c1305a4813f37",
	d35ImplementationManifestDigest: D35_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D36_IMPLEMENTATION_SOURCE_DIGESTS,
});
export const D36_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D36_IMPLEMENTATION_MANIFEST,
);

export async function measureD36Implementation(repositoryRootValue: string): Promise<string> {
	const repositoryRoot = await realpath(resolve(repositoryRootValue));
	const measured: Record<string, string> = {};
	for (const [name, path] of Object.entries(D36_IMPLEMENTATION_FILES))
		measured[name] = empiricalSha256(new Uint8Array(await readFile(resolve(repositoryRoot, path))));
	for (const [name, expected] of Object.entries(D36_IMPLEMENTATION_SOURCE_DIGESTS))
		if (measured[name] !== expected)
			throw new TypeError(`D36 implementation source drifted: ${name}`);
	return empiricalStrictJsonDigest(
		strictSnapshot({
			revision: D36_IMPLEMENTATION_MANIFEST.revision,
			baselineCommit: D36_IMPLEMENTATION_MANIFEST.baselineCommit,
			d35ImplementationManifestDigest: D35_IMPLEMENTATION_MANIFEST_DIGEST,
			sources: measured,
		}),
	);
}
