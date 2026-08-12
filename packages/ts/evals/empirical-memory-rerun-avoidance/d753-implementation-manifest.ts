import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";

export const D753_TRACKED_SOURCE_SHA256 = Object.freeze({
	cleanGraphLedger: "sha256:a63894f692c5748130cc4f3aace34428522aa7eb08a73605ff1f68499aad5593",
	graphRuntime: "sha256:99bfc21474240234843562a65c7cbe760ebb178bccca8b621ea292e565255172",
	graphProjection: "sha256:d4847fe9c425305a58c5b7780b59f0bd94508aeff0dab5cd30055475153fc180",
	graphEval: "sha256:f50fea949840d72ff1e53fad634543e991375eb031cbe9fbb8ac57f527c5f209",
	providerCore: "sha256:ec1a644edb5989315a4a3ec5e6e621786f89b1c9e9493026a91ad7568e1f7cd5",
	providerTurn: "sha256:6fac7319b4dc57b5751bf2e823b6bd2fb88143de84046fbda2f128f48084c926",
	routeIntegration: "sha256:d7ebc60e6c94e12f120b6f77d40ca84116f43f2cab2fe288bed82f92b010b3f2",
	transportDiagnostic: "sha256:42d767c8dc7534bcdd3787455651bcdb21007a6282112cb69e799730ee9eed65",
	transportIntegration: "sha256:78d84ca3811a0c530c1380e135f598fbe9b525060e19671e3ab5bcd24006ab68",
	transportRouteAdapter: "sha256:46a1589bbad3a5cc640e18860ab71e86b27ed188414d25ea9ac871c92e19f93a",
	coordinates: "sha256:5710f82350f9246682f633b08fa3af0d5ef29e241eb79870a9822339e0f05e93",
	claim: "sha256:3d0be61a5a0ca4d84c81b8a1cb9b9825e09acdc42747a762d87861c80cbfc400",
	live: "sha256:84f98af1ac73a7b3dbf3dbc3c1ec2d67c339b86931d1bb87c83fbd72bdd34f57",
});

export const D753_PRIVATE_SOURCE_SHA256 = Object.freeze({
	realRouteAdapter: "sha256:77927d70485990e6a62399ac647b76abaf920d81d81c487966b75e8fea1181f2",
	noNetworkRunner: "sha256:41290708773b18a1022c894d098b90f9415155c3d7f8c7239698c9915e9581ee",
	liveRunner: "sha256:7b4d75cebdee9d0c5f9245317d17baf31c06917de3da56a167e8fe58fc6c5a98",
});

export const D753_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d753.implementation-manifest.v1",
	decisionRef: "decision.D753",
	decisionRevision: "2026-08-12.v1",
	trackedSourceSha256: D753_TRACKED_SOURCE_SHA256,
	privateSourceSha256: D753_PRIVATE_SOURCE_SHA256,
});

export const D753_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D753_IMPLEMENTATION_MANIFEST,
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
			throw new TypeError(`D753 ${path} source bytes are invalid: ${key}`);
		if (empiricalSha256(new Uint8Array(bytes)) !== expectedDigest)
			throw new TypeError(`D753 ${path} source drifted: ${key}`);
	}
}

export function validateD753ImplementationBytes(inputValue: {
	readonly tracked: Readonly<Record<keyof typeof D753_TRACKED_SOURCE_SHA256, Uint8Array>>;
	readonly private: Readonly<Record<keyof typeof D753_PRIVATE_SOURCE_SHA256, Uint8Array>>;
}): string {
	const input = record(inputValue, "d753.implementation");
	exactKeys(input, ["private", "tracked"], "d753.implementation");
	validateSet(input.tracked, D753_TRACKED_SOURCE_SHA256, "tracked");
	validateSet(input.private, D753_PRIVATE_SOURCE_SHA256, "private");
	return D753_IMPLEMENTATION_MANIFEST_DIGEST;
}
