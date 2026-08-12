import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";

export const D737_TRACKED_SOURCE_SHA256 = Object.freeze({
	graphRuntime: "sha256:1d2c0ecdf2805bf69852aee81da910c27dcffde10b13981c30064d23f0f43cd0",
	graphProjection: "sha256:5bda61694c2242b40c91d7fadea4861b0a76ab17b3b4333ce0515b501b3e0281",
	graphEval: "sha256:9e82c5a992c9d95ead48f871b371c9875c3dcd510d2eef9d30e655a2d95590d2",
	providerCore: "sha256:ec1a644edb5989315a4a3ec5e6e621786f89b1c9e9493026a91ad7568e1f7cd5",
	routeIntegration: "sha256:56bc2d7d961b790d3e39cafde32ded3419bdc1892b7dfffb5754e07bc5b21154",
	coordinates: "sha256:e2e1fb2605a07eea42767abe983f0a2c1c752075588edf071348b80da3df8678",
	claim: "sha256:eee1619ff26496ebfdd59e93c28821fecad08db78dfcc137b712628b85140cc2",
	live: "sha256:068d3fb2855f0a4f3194a9bc2d69eca2fbbe363bbeb945ecedab244a5f43c16b",
});

export const D737_PRIVATE_SOURCE_SHA256 = Object.freeze({
	realRouteAdapter: "sha256:1c2620366c8a87cd3f32f718c389af6264450c1447a3c8708b0ddcd914c99462",
	noNetworkRunner: "sha256:b4d48a76464be1a2158e45882927492019a1762c72f25db78ea6b8d1eba59f41",
	liveRunner: "sha256:2d3405912d3774c6cd3405ad3ceb5f2ba42fc76d175bc44594c1d478a51cb59e",
});

export const D737_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d737.implementation-manifest.v1",
	decisionRef: "decision.D737",
	decisionRevision: "2026-08-11.v1",
	trackedSourceSha256: D737_TRACKED_SOURCE_SHA256,
	privateSourceSha256: D737_PRIVATE_SOURCE_SHA256,
});

export const D737_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D737_IMPLEMENTATION_MANIFEST,
);

function validateSet(
	value: unknown,
	expected: Readonly<Record<string, string>>,
	path: string,
): void {
	const candidate = record(value, path);
	exactKeys(candidate, Object.keys(expected), path);
	for (const [key, expectedDigest] of Object.entries(expected)) {
		const bytes = candidate[key];
		if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 2_097_152)
			throw new TypeError(`D737 ${path} source bytes are invalid: ${key}`);
		if (empiricalSha256(new Uint8Array(bytes)) !== expectedDigest)
			throw new TypeError(`D737 ${path} source drifted: ${key}`);
	}
}

export function validateD737ImplementationBytes(inputValue: {
	readonly tracked: Readonly<Record<keyof typeof D737_TRACKED_SOURCE_SHA256, Uint8Array>>;
	readonly private: Readonly<Record<keyof typeof D737_PRIVATE_SOURCE_SHA256, Uint8Array>>;
}): string {
	const input = record(inputValue, "d737.implementation");
	exactKeys(input, ["private", "tracked"], "d737.implementation");
	validateSet(input.tracked, D737_TRACKED_SOURCE_SHA256, "tracked");
	validateSet(input.private, D737_PRIVATE_SOURCE_SHA256, "private");
	return D737_IMPLEMENTATION_MANIFEST_DIGEST;
}
