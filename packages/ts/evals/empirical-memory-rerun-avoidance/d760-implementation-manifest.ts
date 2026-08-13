import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";

export const D760_TRACKED_SOURCE_SHA256 = Object.freeze({
	cleanGraphLedger: "sha256:a63894f692c5748130cc4f3aace34428522aa7eb08a73605ff1f68499aad5593",
	graphRuntime: "sha256:bc826a13d70351e245b04e8845bdf22f60cc86426a8bfe37e799c94c01693460",
	graphProjection: "sha256:e0406b642e164469c7bb88858e1b391aa4aa65c6142e4d1689a7895f50b3c901",
	graphEval: "sha256:f50fea949840d72ff1e53fad634543e991375eb031cbe9fbb8ac57f527c5f209",
	providerCore: "sha256:ec1a644edb5989315a4a3ec5e6e621786f89b1c9e9493026a91ad7568e1f7cd5",
	providerTurn: "sha256:6fac7319b4dc57b5751bf2e823b6bd2fb88143de84046fbda2f128f48084c926",
	routeIntegration: "sha256:d7ebc60e6c94e12f120b6f77d40ca84116f43f2cab2fe288bed82f92b010b3f2",
	transportDiagnostic: "sha256:42d767c8dc7534bcdd3787455651bcdb21007a6282112cb69e799730ee9eed65",
	transportIntegration: "sha256:78d84ca3811a0c530c1380e135f598fbe9b525060e19671e3ab5bcd24006ab68",
	namedToolLowering: "sha256:95dce829d31319a4de03f81f60057f7668de4111b9f0300e9fd1728af1aee95f",
	d759Manifest: "sha256:36bf8904cb19bec0b5e8322f1bb3c4c3cb406b95dd04798cdb7f50761f3f3bea",
	d759Qualification: "sha256:88fd4310a262e1373bb609195a8a4589f5125004ae6a0be3c083b30fa9a98bc1",
	transportRouteAdapter: "sha256:761bff949f0a7207316d5eca25a6a04a7db1c78a72067e906b2f2bc1fefd837c",
	coordinates: "sha256:4be1c718b1bb727f9f93b3582441ee8cd5ea616a0018511694fc4c5771896971",
	claim: "sha256:e2dd46388104b4314ab50f9e5f140d4535dc5e810ea84a6396d29b4056dc1358",
	live: "sha256:394085828bd8feb6e604fc6cce8df8f933af4723aff0c86b2fc2bb4144e786e1",
});

export const D760_PRIVATE_SOURCE_SHA256 = Object.freeze({
	realRouteAdapter: "sha256:7cbfdd76f25c7b0f4406ee08d808c9d5feb52cf91dd5f05fcd26e138aec90262",
	liveRunner: "sha256:777e82c404eff000064c5db91e87bba15d637f7ee87312effc46450d4b6f9299",
});

export const D760_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d760.implementation-manifest.v1",
	decisionRef: "decision.D760",
	decisionRevision: "2026-08-12.v1",
	trackedSourceSha256: D760_TRACKED_SOURCE_SHA256,
	privateSourceSha256: D760_PRIVATE_SOURCE_SHA256,
});

export const D760_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D760_IMPLEMENTATION_MANIFEST,
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
			throw new TypeError(`D760 ${path} source bytes are invalid: ${key}`);
		if (empiricalSha256(new Uint8Array(bytes)) !== expectedDigest)
			throw new TypeError(`D760 ${path} source drifted: ${key}`);
	}
}

export function validateD760ImplementationBytes(inputValue: {
	readonly tracked: Readonly<Record<keyof typeof D760_TRACKED_SOURCE_SHA256, Uint8Array>>;
	readonly private: Readonly<Record<keyof typeof D760_PRIVATE_SOURCE_SHA256, Uint8Array>>;
}): string {
	const input = record(inputValue, "d760.implementation");
	exactKeys(input, ["private", "tracked"], "d760.implementation");
	validateSet(input.tracked, D760_TRACKED_SOURCE_SHA256, "tracked");
	validateSet(input.private, D760_PRIVATE_SOURCE_SHA256, "private");
	return D760_IMPLEMENTATION_MANIFEST_DIGEST;
}
