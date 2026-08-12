import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";

export const D738_TRACKED_SOURCE_SHA256 = Object.freeze({
	cleanGraphLedger: "sha256:a63894f692c5748130cc4f3aace34428522aa7eb08a73605ff1f68499aad5593",
	graphRuntime: "sha256:56e59694b4a98cd8403eb1b314169cab0e0b97dcf40b231db982ae252912be90",
	graphProjection: "sha256:93a80ac6caf854139b6243d34d4f763addfad79ce9970a288b1320ee2f3696c2",
	graphEval: "sha256:f50fea949840d72ff1e53fad634543e991375eb031cbe9fbb8ac57f527c5f209",
	providerCore: "sha256:ec1a644edb5989315a4a3ec5e6e621786f89b1c9e9493026a91ad7568e1f7cd5",
	providerTurn: "sha256:6fac7319b4dc57b5751bf2e823b6bd2fb88143de84046fbda2f128f48084c926",
	routeIntegration: "sha256:d7ebc60e6c94e12f120b6f77d40ca84116f43f2cab2fe288bed82f92b010b3f2",
	injectedFixture: "sha256:91363e3faacf914eeba15a3ecf7e59ecc14d9fa6eba8570d195ca945584da763",
	byteTransport: "sha256:55f735c9b616102280922bc627f942b25886f1e72366a5d2c3c69e2c9ac068f4",
	coordinates: "sha256:3e4ac1e2ddac91f625313154bce169a3f31ef4cf2841961e6b341849ccb0905c",
	claim: "sha256:c4923c77c20a29e548e8689e0f3b58ab54ea752d1a75afb9ba2caddc8bb2b031",
	live: "sha256:51d0d28a1cdc73b4f67bd9e37be7fc18bf0550132c462303041d0054cb059151",
});

export const D738_PRIVATE_SOURCE_SHA256 = Object.freeze({
	realRouteAdapter: "sha256:a9fcea415fbddaad4bb2492048824ce8124daf2aa940c17525932ab9d1bbf19b",
	noNetworkRunner: "sha256:e95c82cce2764b926e24ff508cf81a373a967dc4481972e7a445643e95bf3a49",
	liveRunner: "sha256:7e192955697ee40f74dc51629a356b96ecf3452519fe25828170de521b4011fd",
});

export const D738_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d749.implementation-manifest.v1",
	decisionRef: "decision.D749",
	decisionRevision: "2026-08-12.v1",
	trackedSourceSha256: D738_TRACKED_SOURCE_SHA256,
	privateSourceSha256: D738_PRIVATE_SOURCE_SHA256,
});

export const D738_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D738_IMPLEMENTATION_MANIFEST,
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
			throw new TypeError(`D738 ${path} source bytes are invalid: ${key}`);
		if (empiricalSha256(new Uint8Array(bytes)) !== expectedDigest)
			throw new TypeError(`D738 ${path} source drifted: ${key}`);
	}
}

export function validateD738ImplementationBytes(inputValue: {
	readonly tracked: Readonly<Record<keyof typeof D738_TRACKED_SOURCE_SHA256, Uint8Array>>;
	readonly private: Readonly<Record<keyof typeof D738_PRIVATE_SOURCE_SHA256, Uint8Array>>;
}): string {
	const input = record(inputValue, "d738.implementation");
	exactKeys(input, ["private", "tracked"], "d738.implementation");
	validateSet(input.tracked, D738_TRACKED_SOURCE_SHA256, "tracked");
	validateSet(input.private, D738_PRIVATE_SOURCE_SHA256, "private");
	return D738_IMPLEMENTATION_MANIFEST_DIGEST;
}
