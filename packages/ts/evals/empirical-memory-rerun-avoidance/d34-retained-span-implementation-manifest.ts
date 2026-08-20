import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

export const D34_IMPLEMENTATION_FILES = Object.freeze({
	authority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d34-retained-span-mutation-authority.ts",
	wire: "packages/ts/evals/empirical-memory-rerun-avoidance/d34-retained-span-chat-wire.ts",
	qualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d34-retained-span-qualification.ts",
	runner: "packages/ts/evals/empirical-memory-rerun-avoidance/run-d34-retained-span-no-network.ts",
	graphAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d5-graph-native-eval-authority.ts",
	providerAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d6-current-provider-authority.ts",
	rejectionAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d9-current-provider-rejection-authority.ts",
	phaseAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d25-phase-specific-tool-admission.ts",
	openRouterAdapter:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d8-current-openrouter-adapter.ts",
	privatePersistence:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d6-current-private-persistence.ts",
	canonical: "packages/ts/evals/empirical-memory-rerun-avoidance/canonical.ts",
	strictJsonCodec: "packages/ts/src/json/codec.ts",
} as const);

export const D34_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	authority: "sha256:457bcbde7cf98baa628b853b94d84651f5b46f851bc9a160d3f22d76f2ef173e",
	wire: "sha256:55894461e6c77260f8767a6bb5540042131ac859d2a4b437ab5e6d9acc97ac3d",
	qualification: "sha256:6fbf98f97dc08364fc6f16f717a9f04ed477f0f7ca9413cde96d437d0a65a1a8",
	runner: "sha256:45973f72d4095ce33ba4ad529e579903badd0e98d218921904da60bd06cb33c0",
	graphAuthority: "sha256:7983de199575f453faa644c950d001d268357dbfb1a254deb70be476b76eaca3",
	providerAuthority: "sha256:74203246d43ceee5d09359c0436f3380d94dec2d8d3f060d9216838f7a0979b0",
	rejectionAuthority: "sha256:58c5ee520be6032aee7810510dd45967a7c3042877b4a7ecc2fc74eb87884fc6",
	phaseAuthority: "sha256:daa386952ebee402fc618e1add189385b3a85de81f4fd9183dca5b12e0c86cba",
	openRouterAdapter: "sha256:3e14f5d3babafbf635141ca36c455d2261b862879121aebcf8da882d5c7e8b62",
	privatePersistence: "sha256:0563c15908914694df6d2b80aba11840ce8f91f2c63f6ed2c97c2e5f3dc8a113",
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
	strictJsonCodec: "sha256:7fadd889fa5ca55b83a812e67462a48873c50e67d4b9451e7f361e1af8a44ffa",
} as const);

export const D34_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly-ts.d34.retained-span-implementation-manifest.v1",
	baselineCommit: "0bbecf037ea6eea0c23b566511502db70117a67e",
	sources: D34_IMPLEMENTATION_SOURCE_DIGESTS,
});
export const D34_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D34_IMPLEMENTATION_MANIFEST,
);

export async function measureD34Implementation(repositoryRootValue: string): Promise<string> {
	const repositoryRoot = await realpath(resolve(repositoryRootValue));
	const measured: Record<string, string> = {};
	for (const [name, path] of Object.entries(D34_IMPLEMENTATION_FILES))
		measured[name] = empiricalSha256(new Uint8Array(await readFile(resolve(repositoryRoot, path))));
	for (const [name, expected] of Object.entries(D34_IMPLEMENTATION_SOURCE_DIGESTS))
		if (measured[name] !== expected)
			throw new TypeError(`D34 implementation source drifted: ${name}`);
	return empiricalStrictJsonDigest(
		strictSnapshot({
			revision: D34_IMPLEMENTATION_MANIFEST.revision,
			baselineCommit: D34_IMPLEMENTATION_MANIFEST.baselineCommit,
			sources: measured,
		}),
	);
}
