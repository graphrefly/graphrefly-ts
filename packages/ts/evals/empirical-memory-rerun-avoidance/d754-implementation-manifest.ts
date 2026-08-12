import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";

export const D754_TRACKED_SOURCE_SHA256 = Object.freeze({
	cleanGraphLedger: "sha256:a63894f692c5748130cc4f3aace34428522aa7eb08a73605ff1f68499aad5593",
	graphRuntime: "sha256:99bfc21474240234843562a65c7cbe760ebb178bccca8b621ea292e565255172",
	graphProjection: "sha256:d4847fe9c425305a58c5b7780b59f0bd94508aeff0dab5cd30055475153fc180",
	graphEval: "sha256:f50fea949840d72ff1e53fad634543e991375eb031cbe9fbb8ac57f527c5f209",
	providerCore: "sha256:ec1a644edb5989315a4a3ec5e6e621786f89b1c9e9493026a91ad7568e1f7cd5",
	providerTurn: "sha256:6fac7319b4dc57b5751bf2e823b6bd2fb88143de84046fbda2f128f48084c926",
	routeIntegration: "sha256:d7ebc60e6c94e12f120b6f77d40ca84116f43f2cab2fe288bed82f92b010b3f2",
	transportDiagnostic: "sha256:42d767c8dc7534bcdd3787455651bcdb21007a6282112cb69e799730ee9eed65",
	transportIntegration: "sha256:78d84ca3811a0c530c1380e135f598fbe9b525060e19671e3ab5bcd24006ab68",
	transportRouteAdapter: "sha256:156a3e0a034df3a9874cad0d95b91fd3564be98af80118368877730978a1a502",
	coordinates: "sha256:864b2a3ac9babd76adf6aaefe2e89650ad706df2e7b43e5e41b7dfca4195fd63",
	claim: "sha256:99506b6aee6f79938673a37f9c392649699609a25e0552540b030a47c38d2493",
	live: "sha256:1cd537ce9663fb72841a0b3e165d0d2dde549a344e109015bb5d5031dec4a423",
});

export const D754_PRIVATE_SOURCE_SHA256 = Object.freeze({
	realRouteAdapter: "sha256:13593ae7f22b0e20d36bb5b3ade38f0afb73720b24cff924d80218da1cb0a3de",
	noNetworkRunner: "sha256:5691e67201db29a2acdc37bfbb3964c3c5a83d53b9582c95a3a3dfcd0fadcfc8",
	liveRunner: "sha256:09e7dd065ea2a27e57626e13534cc01d14fb6c1d1572401f39a3fe8b95c86051",
});

export const D754_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d754.implementation-manifest.v1",
	decisionRef: "decision.D754",
	decisionRevision: "2026-08-12.v1",
	trackedSourceSha256: D754_TRACKED_SOURCE_SHA256,
	privateSourceSha256: D754_PRIVATE_SOURCE_SHA256,
});

export const D754_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D754_IMPLEMENTATION_MANIFEST,
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
			throw new TypeError(`D754 ${path} source bytes are invalid: ${key}`);
		if (empiricalSha256(new Uint8Array(bytes)) !== expectedDigest)
			throw new TypeError(`D754 ${path} source drifted: ${key}`);
	}
}

export function validateD754ImplementationBytes(inputValue: {
	readonly tracked: Readonly<Record<keyof typeof D754_TRACKED_SOURCE_SHA256, Uint8Array>>;
	readonly private: Readonly<Record<keyof typeof D754_PRIVATE_SOURCE_SHA256, Uint8Array>>;
}): string {
	const input = record(inputValue, "d754.implementation");
	exactKeys(input, ["private", "tracked"], "d754.implementation");
	validateSet(input.tracked, D754_TRACKED_SOURCE_SHA256, "tracked");
	validateSet(input.private, D754_PRIVATE_SOURCE_SHA256, "private");
	return D754_IMPLEMENTATION_MANIFEST_DIGEST;
}
