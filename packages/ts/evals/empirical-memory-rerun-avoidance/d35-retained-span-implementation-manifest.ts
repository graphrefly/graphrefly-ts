import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

export const D35_IMPLEMENTATION_FILES = Object.freeze({
	composition:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d35-retained-span-real-provider-composition.ts",
	qualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d35-retained-span-real-provider-qualification.ts",
	runner:
		"packages/ts/evals/empirical-memory-rerun-avoidance/run-d35-retained-span-real-provider-no-network.ts",
	retainedAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d34-retained-span-mutation-authority.ts",
	retainedWire: "packages/ts/evals/empirical-memory-rerun-avoidance/d34-retained-span-chat-wire.ts",
	baselineQualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d34-retained-span-qualification.ts",
	baselineManifest:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d34-retained-span-implementation-manifest.ts",
	phaseAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d25-phase-specific-tool-admission.ts",
	rejectionAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d9-current-provider-rejection-authority.ts",
	providerAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d6-current-provider-authority.ts",
	graphAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d5-graph-native-eval-authority.ts",
	liveCoordinates:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d8-current-live-coordinates.ts",
	openRouterAdapter:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d8-current-openrouter-adapter.ts",
	privatePersistence:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d6-current-private-persistence.ts",
	canonical: "packages/ts/evals/empirical-memory-rerun-avoidance/canonical.ts",
	strictJsonCodec: "packages/ts/src/json/codec.ts",
} as const);

export const D35_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	composition: "sha256:a17e66f564113530cc93a496b9b2f0d294d0240df37879727a1a65b5ae79ff7a",
	qualification: "sha256:ad387fd15c3d2ff6c15fe59dfcd7442aafe344f75e79ff85ce883b3188173917",
	runner: "sha256:0488c5a9d298b51435286c99a4218dc15bd807ed97551523cb424da7d59f8a31",
	retainedAuthority: "sha256:fbefb5fc1298e4e919d91c102116e25653ee39d76a5245053abdf5650a9fb87c",
	retainedWire: "sha256:55894461e6c77260f8767a6bb5540042131ac859d2a4b437ab5e6d9acc97ac3d",
	baselineQualification: "sha256:6fbf98f97dc08364fc6f16f717a9f04ed477f0f7ca9413cde96d437d0a65a1a8",
	baselineManifest: "sha256:d789c55ac283a502d2ce1a1b69d01c8e66d1535f5a99092dfe2a222adef3f32a",
	phaseAuthority: "sha256:daa386952ebee402fc618e1add189385b3a85de81f4fd9183dca5b12e0c86cba",
	rejectionAuthority: "sha256:58c5ee520be6032aee7810510dd45967a7c3042877b4a7ecc2fc74eb87884fc6",
	providerAuthority: "sha256:74203246d43ceee5d09359c0436f3380d94dec2d8d3f060d9216838f7a0979b0",
	graphAuthority: "sha256:7983de199575f453faa644c950d001d268357dbfb1a254deb70be476b76eaca3",
	liveCoordinates: "sha256:7a91a1654241f2427a72d536070d22bcc6572a87e86c28c8d231fb690cc41745",
	openRouterAdapter: "sha256:2eeedfd36edc4cf31b84ab735aad1cc1ce5a0373bbfb8432b2f661b25e91ec37",
	privatePersistence: "sha256:0563c15908914694df6d2b80aba11840ce8f91f2c63f6ed2c97c2e5f3dc8a113",
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
	strictJsonCodec: "sha256:7fadd889fa5ca55b83a812e67462a48873c50e67d4b9451e7f361e1af8a44ffa",
} as const);

export const D35_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly-ts.d35.retained-span-real-provider-implementation-manifest.v1",
	baselineCommit: "63e7e7ddafd8c734d5712c44ddee047e5a10b499",
	sources: D35_IMPLEMENTATION_SOURCE_DIGESTS,
});
export const D35_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D35_IMPLEMENTATION_MANIFEST,
);

export async function measureD35Implementation(repositoryRootValue: string): Promise<string> {
	const repositoryRoot = await realpath(resolve(repositoryRootValue));
	const measured: Record<string, string> = {};
	for (const [name, path] of Object.entries(D35_IMPLEMENTATION_FILES))
		measured[name] = empiricalSha256(new Uint8Array(await readFile(resolve(repositoryRoot, path))));
	for (const [name, expected] of Object.entries(D35_IMPLEMENTATION_SOURCE_DIGESTS))
		if (measured[name] !== expected)
			throw new TypeError(`D35 implementation source drifted: ${name}`);
	return empiricalStrictJsonDigest(
		strictSnapshot({
			revision: D35_IMPLEMENTATION_MANIFEST.revision,
			baselineCommit: D35_IMPLEMENTATION_MANIFEST.baselineCommit,
			sources: measured,
		}),
	);
}
