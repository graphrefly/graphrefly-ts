import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";

export const D738_TRACKED_SOURCE_SHA256 = Object.freeze({
	cleanGraphLedger: "sha256:a63894f692c5748130cc4f3aace34428522aa7eb08a73605ff1f68499aad5593",
	graphRuntime: "sha256:25be41e2e8b39afa4898ae32572a80a4f6165d4482816a97d070ec61bf1dfeac",
	graphProjection: "sha256:d44837e4cefbd57a76d6c00e8d61582857d0adce56425bee2b2b73140ba93aa0",
	graphEval: "sha256:9e82c5a992c9d95ead48f871b371c9875c3dcd510d2eef9d30e655a2d95590d2",
	providerCore: "sha256:ec1a644edb5989315a4a3ec5e6e621786f89b1c9e9493026a91ad7568e1f7cd5",
	providerTurn: "sha256:6fac7319b4dc57b5751bf2e823b6bd2fb88143de84046fbda2f128f48084c926",
	routeIntegration: "sha256:d7ebc60e6c94e12f120b6f77d40ca84116f43f2cab2fe288bed82f92b010b3f2",
	injectedFixture: "sha256:beb05d593a02626edbea7d6f5fe48c3a535dd1ee1493450f4df0f7a10ecf2f40",
	byteTransport: "sha256:55f735c9b616102280922bc627f942b25886f1e72366a5d2c3c69e2c9ac068f4",
	coordinates: "sha256:e233de787ae9cd222cdca4a66b4070ea5b0f965363c3c67a73f11c95def45b32",
	claim: "sha256:25728d885de675d8499cb9ec645de4b4e9ae3ef0e2bd00b5e727b8d2eb0d3bba",
	live: "sha256:e6f5e2895d95bf13c60d0246f42f872a428506f985db17bc658125c86ea6f821",
});

export const D738_PRIVATE_SOURCE_SHA256 = Object.freeze({
	realRouteAdapter: "sha256:a9fcea415fbddaad4bb2492048824ce8124daf2aa940c17525932ab9d1bbf19b",
	noNetworkRunner: "sha256:11c25135b50db62e9d6ac956aea0b40d786fa7f6cb68c067d715510c3ef6b14f",
	liveRunner: "sha256:7ad7e193f34f0b1ffcbeb0f920b5859ce9fe0ee35863390a0cd00cbe762285b0",
});

export const D738_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d746.implementation-manifest.v1",
	decisionRef: "decision.D746",
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
