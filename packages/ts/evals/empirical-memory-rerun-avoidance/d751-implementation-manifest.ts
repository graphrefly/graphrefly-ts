import { readFile } from "node:fs/promises";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D738_IMPLEMENTATION_MANIFEST_DIGEST,
	D738_TRACKED_SOURCE_SHA256,
} from "./d738-implementation-manifest.js";

export const D751_IMPLEMENTATION_SOURCE_SHA256 = Object.freeze({
	graphAuthority: "sha256:42d767c8dc7534bcdd3787455651bcdb21007a6282112cb69e799730ee9eed65",
	privateRunner: "sha256:dad98917420d94ba15fba31520e31d7f23e3ef9c6ce8d55a8435bccdedcd81b1",
	providerCore: "sha256:ec1a644edb5989315a4a3ec5e6e621786f89b1c9e9493026a91ad7568e1f7cd5",
	transportBoundary: "sha256:f6401a006bf1862770a4dead205ffc2ce9fdacddb05a60367f87c5ad717448b7",
});

export const D751_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d751.implementation-manifest.v1",
	d750GraphBaselineManifestDigest: D738_IMPLEMENTATION_MANIFEST_DIGEST,
	sourceSha256: D751_IMPLEMENTATION_SOURCE_SHA256,
});

export const D751_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D751_IMPLEMENTATION_MANIFEST,
);

export async function measureD751Implementation(): Promise<string> {
	const [graphAuthority, privateRunner, providerCore, transportBoundary, ...graphBaselineBytes] =
		await Promise.all([
			readFile(new URL("./d751-sanitized-transport-diagnostic.ts", import.meta.url)),
			readFile(new URL("./run-d751-no-network-pre-live.ts", import.meta.url)),
			readFile(new URL("./d729-provider-block-core.ts", import.meta.url)),
			readFile(new URL("./openrouter-transport-failure.ts", import.meta.url)),
			...[
				"d719-clean-graph-ledger.ts",
				"d722-graph-native-effect-runtime.ts",
				"d722-graph-completion-memory-insight.ts",
				"d722-graph-native-eval.ts",
				"d729-provider-block-core.ts",
				"d723-openrouter-graph-turn.ts",
				"d734-route-profile-provider-integration.ts",
				"d734-injected-route-profile-fixture.ts",
				"openrouter-responses-byte-transport.ts",
				"d738-coordinates.ts",
				"d738-single-use-dispatch-claim.ts",
				"d738-graph-native-live.ts",
			].map((file) => readFile(new URL(`./${file}`, import.meta.url))),
		]);
	const measured = {
		graphAuthority: empiricalSha256(graphAuthority),
		privateRunner: empiricalSha256(privateRunner),
		providerCore: empiricalSha256(providerCore),
		transportBoundary: empiricalSha256(transportBoundary),
	};
	for (const key of Object.keys(measured) as (keyof typeof measured)[])
		if (measured[key] !== D751_IMPLEMENTATION_SOURCE_SHA256[key])
			throw new TypeError(`D751 implementation source drifted: ${key}`);
	const baselineKeys = Object.keys(
		D738_TRACKED_SOURCE_SHA256,
	) as (keyof typeof D738_TRACKED_SOURCE_SHA256)[];
	for (const [index, key] of baselineKeys.entries())
		if (empiricalSha256(graphBaselineBytes[index]!) !== D738_TRACKED_SOURCE_SHA256[key])
			throw new TypeError(`D751 Graph baseline source drifted: ${key}`);
	return D751_IMPLEMENTATION_MANIFEST_DIGEST;
}
