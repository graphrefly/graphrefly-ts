import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";

export const D738_TRACKED_SOURCE_SHA256 = Object.freeze({
	graphRuntime: "sha256:9d8133ec8585a057b3ee1ce5b09cc4592095abbc388e36d5e4ee09bb92b8be44",
	graphProjection: "sha256:01a66d7c50db14d1f6b7fbf72d06a8ece54a5c2bf1c629fdc4f20e530f143391",
	graphEval: "sha256:9e82c5a992c9d95ead48f871b371c9875c3dcd510d2eef9d30e655a2d95590d2",
	providerCore: "sha256:ec1a644edb5989315a4a3ec5e6e621786f89b1c9e9493026a91ad7568e1f7cd5",
	routeIntegration: "sha256:56bc2d7d961b790d3e39cafde32ded3419bdc1892b7dfffb5754e07bc5b21154",
	byteTransport: "sha256:55f735c9b616102280922bc627f942b25886f1e72366a5d2c3c69e2c9ac068f4",
	coordinates: "sha256:a7b0702996d1a8db5f02498b2eb9884dbfe955882971a14fd8afc5baad162c5f",
	claim: "sha256:3d420225f18e05a0725b91e4e54d2d4d4869340f74ffb5db0762e455203821d9",
	live: "sha256:8dac1158774ed392deadf3f463aa7161a8dea8f105d5e87c5c7f4003d3e624d5",
});

export const D738_PRIVATE_SOURCE_SHA256 = Object.freeze({
	realRouteAdapter: "sha256:a9fcea415fbddaad4bb2492048824ce8124daf2aa940c17525932ab9d1bbf19b",
	noNetworkRunner: "sha256:296a05c87f729a26dfe51bb584619dc20fca0fa1c30d458c778bb6f65b708fba",
	liveRunner: "sha256:0ef837dfb06e4e9da5f04ae6ce3b9064824f36cdb81204723cd27243e217ddb0",
});

export const D738_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d743.implementation-manifest.v1",
	decisionRef: "decision.D743",
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
