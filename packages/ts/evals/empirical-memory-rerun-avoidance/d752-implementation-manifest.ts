import { readFile } from "node:fs/promises";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D751_IMPLEMENTATION_MANIFEST_DIGEST } from "./d751-implementation-manifest.js";

export const D752_IMPLEMENTATION_SOURCE_SHA256 = Object.freeze({
	integration: "sha256:78d84ca3811a0c530c1380e135f598fbe9b525060e19671e3ab5bcd24006ab68",
	privateRunner: "sha256:b34955cf3953e4dd8399358f3382bc71ead69bea248eccf3b3079cf6ce053aab",
	d751Authority: "sha256:42d767c8dc7534bcdd3787455651bcdb21007a6282112cb69e799730ee9eed65",
	d751Manifest: "sha256:60acc0a837677955e3926d5e1a57d8aa2d2fdf87d412ae0527f7b26e6bd17c71",
	d734RouteIntegration: "sha256:d7ebc60e6c94e12f120b6f77d40ca84116f43f2cab2fe288bed82f92b010b3f2",
	d729ProviderCore: "sha256:ec1a644edb5989315a4a3ec5e6e621786f89b1c9e9493026a91ad7568e1f7cd5",
	transportBoundary: "sha256:f6401a006bf1862770a4dead205ffc2ce9fdacddb05a60367f87c5ad717448b7",
});

export const D752_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d752.implementation-manifest.v1",
	d751ImplementationManifestDigest: D751_IMPLEMENTATION_MANIFEST_DIGEST,
	sourceSha256: D752_IMPLEMENTATION_SOURCE_SHA256,
});

export const D752_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D752_IMPLEMENTATION_MANIFEST,
);

export function validateD752ImplementationBytes(
	input: Readonly<Record<keyof typeof D752_IMPLEMENTATION_SOURCE_SHA256, Uint8Array>>,
): string {
	for (const key of Object.keys(
		D752_IMPLEMENTATION_SOURCE_SHA256,
	) as (keyof typeof D752_IMPLEMENTATION_SOURCE_SHA256)[]) {
		const bytes = input[key];
		if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 4 * 1_048_576)
			throw new TypeError(`D752 implementation bytes are invalid: ${key}`);
		if (empiricalSha256(bytes) !== D752_IMPLEMENTATION_SOURCE_SHA256[key])
			throw new TypeError(`D752 implementation source drifted: ${key}`);
	}
	return D752_IMPLEMENTATION_MANIFEST_DIGEST;
}

export async function measureD752Implementation(): Promise<string> {
	const names = {
		integration: "d752-provider-transport-diagnostic-integration.ts",
		privateRunner: "run-d752-no-network-pre-live.ts",
		d751Authority: "d751-sanitized-transport-diagnostic.ts",
		d751Manifest: "d751-implementation-manifest.ts",
		d734RouteIntegration: "d734-route-profile-provider-integration.ts",
		d729ProviderCore: "d729-provider-block-core.ts",
		transportBoundary: "openrouter-transport-failure.ts",
	} as const;
	const entries = await Promise.all(
		(Object.entries(names) as [keyof typeof names, string][]).map(
			async ([key, name]) =>
				[key, new Uint8Array(await readFile(new URL(`./${name}`, import.meta.url)))] as const,
		),
	);
	return validateD752ImplementationBytes(
		Object.fromEntries(entries) as Record<keyof typeof names, Uint8Array>,
	);
}
