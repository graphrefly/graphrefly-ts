import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";

export const D758_TRACKED_SOURCE_SHA256 = Object.freeze({
	cleanGraphLedger: "sha256:a63894f692c5748130cc4f3aace34428522aa7eb08a73605ff1f68499aad5593",
	graphRuntime: "sha256:99bfc21474240234843562a65c7cbe760ebb178bccca8b621ea292e565255172",
	graphProjection: "sha256:d4847fe9c425305a58c5b7780b59f0bd94508aeff0dab5cd30055475153fc180",
	graphEval: "sha256:f50fea949840d72ff1e53fad634543e991375eb031cbe9fbb8ac57f527c5f209",
	providerCore: "sha256:ec1a644edb5989315a4a3ec5e6e621786f89b1c9e9493026a91ad7568e1f7cd5",
	providerTurn: "sha256:6fac7319b4dc57b5751bf2e823b6bd2fb88143de84046fbda2f128f48084c926",
	routeIntegration: "sha256:d7ebc60e6c94e12f120b6f77d40ca84116f43f2cab2fe288bed82f92b010b3f2",
	transportDiagnostic: "sha256:42d767c8dc7534bcdd3787455651bcdb21007a6282112cb69e799730ee9eed65",
	transportIntegration: "sha256:78d84ca3811a0c530c1380e135f598fbe9b525060e19671e3ab5bcd24006ab68",
	namedToolLowering: "sha256:3951f6613fdb4bb9b8493467b007ce5dce2c7e6cae6bc55d7d97f1c033bf4180",
	d757Manifest: "sha256:8c068fc36330bad66cc8b3e36c913938566618a0c162ebf055136bbba1df9691",
	d757PreLive: "sha256:baaa9ca74219f1859fe492a3304e69d063ed86e7b458e739b6bf2b3ce5d5474d",
	transportRouteAdapter: "sha256:4fa0ecd455ffb06251fdcbbd89678223a5db2df986338a87d94b37627215e810",
	coordinates: "sha256:9feb711e3703b0644a35e840605c5635866cc654891dacc014a686608b1141ec",
	claim: "sha256:aecd5958e7502341ee44572134ab58b485ccfec19bbfed384637757bf4026801",
	live: "sha256:025b69a7cd64d5b726c26e09d8f03d3604980b736cbb9f143b4ebdc4d90e66d3",
});

export const D758_PRIVATE_SOURCE_SHA256 = Object.freeze({
	realRouteAdapter: "sha256:e82e306af8785b84df3aeb0407b407a8c2b8fa6044117e6d539c91f10e60909e",
	noNetworkRunner: "sha256:fecf4dbd43c45e04b2efde7c5f5b7b9a8d4168fc42f79275b4bcc2ac6c0ae7a2",
	liveRunner: "sha256:682c923f887b5ca55acc41d4d603af54e9edbcead47c8382f8452296a87f5718",
});

export const D758_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d758.implementation-manifest.v1",
	decisionRef: "decision.D758",
	decisionRevision: "2026-08-12.v1",
	trackedSourceSha256: D758_TRACKED_SOURCE_SHA256,
	privateSourceSha256: D758_PRIVATE_SOURCE_SHA256,
});

export const D758_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D758_IMPLEMENTATION_MANIFEST,
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
			throw new TypeError(`D758 ${path} source bytes are invalid: ${key}`);
		if (empiricalSha256(new Uint8Array(bytes)) !== expectedDigest)
			throw new TypeError(`D758 ${path} source drifted: ${key}`);
	}
}

export function validateD758ImplementationBytes(inputValue: {
	readonly tracked: Readonly<Record<keyof typeof D758_TRACKED_SOURCE_SHA256, Uint8Array>>;
	readonly private: Readonly<Record<keyof typeof D758_PRIVATE_SOURCE_SHA256, Uint8Array>>;
}): string {
	const input = record(inputValue, "d758.implementation");
	exactKeys(input, ["private", "tracked"], "d758.implementation");
	validateSet(input.tracked, D758_TRACKED_SOURCE_SHA256, "tracked");
	validateSet(input.private, D758_PRIVATE_SOURCE_SHA256, "private");
	return D758_IMPLEMENTATION_MANIFEST_DIGEST;
}
