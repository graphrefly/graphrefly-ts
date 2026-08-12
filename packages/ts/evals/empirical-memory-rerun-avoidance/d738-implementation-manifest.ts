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
	routeIntegration: "sha256:56bc2d7d961b790d3e39cafde32ded3419bdc1892b7dfffb5754e07bc5b21154",
	injectedFixture: "sha256:a568e1065ca22a75a163bb4ba8d209bae923fd93b80ad3dd8f4be98a98ace445",
	byteTransport: "sha256:55f735c9b616102280922bc627f942b25886f1e72366a5d2c3c69e2c9ac068f4",
	coordinates: "sha256:12de96452ce14f3ae5b577dcf985e74b9c56994a08d36f246473efe91ab49568",
	claim: "sha256:d525b499adaeb5798b40f80a994ece8d7471101c33f633d208676208161836fa",
	live: "sha256:51bfdf748779c21941845cd559b5d5b69875377f212177451af6f6126df27ac6",
});

export const D738_PRIVATE_SOURCE_SHA256 = Object.freeze({
	realRouteAdapter: "sha256:a9fcea415fbddaad4bb2492048824ce8124daf2aa940c17525932ab9d1bbf19b",
	noNetworkRunner: "sha256:85e6c4060a2858c21dad69516a40f601371386809bc4e437132b8d4be35a653a",
	liveRunner: "sha256:05e1963f6c50d7c34d468d56100a33e3a4716bf8d804866d6cf844611ebfe5a5",
});

export const D738_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d745.implementation-manifest.v1",
	decisionRef: "decision.D745",
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
