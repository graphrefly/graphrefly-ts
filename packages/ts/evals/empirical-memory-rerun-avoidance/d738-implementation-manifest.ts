import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";

export const D738_TRACKED_SOURCE_SHA256 = Object.freeze({
	graphRuntime: "sha256:a4eba03a7cd1ad6f87ed974d8a992dce329548d3bf3acfabb55787671bd2e59c",
	graphProjection: "sha256:1c5e0b92a623cc59f6bfcc64b2c0af00dd9f72f334ad53e89dc80e602b55b8af",
	graphEval: "sha256:9e82c5a992c9d95ead48f871b371c9875c3dcd510d2eef9d30e655a2d95590d2",
	providerCore: "sha256:ec1a644edb5989315a4a3ec5e6e621786f89b1c9e9493026a91ad7568e1f7cd5",
	routeIntegration: "sha256:56bc2d7d961b790d3e39cafde32ded3419bdc1892b7dfffb5754e07bc5b21154",
	coordinates: "sha256:3cbadae7abd08a3959b7ad4b8a524fd76665557c94e8281153dc9db06b57d6f8",
	claim: "sha256:7d8702ee1758c682d50dc09545740d25225060d8e31d15fc08afca8d396decf0",
	live: "sha256:cf88bf63ccdd9ff60b9a050281404d9ac9b38a33607effb16381d54da75d0849",
});

export const D738_PRIVATE_SOURCE_SHA256 = Object.freeze({
	realRouteAdapter: "sha256:de277ef03e787e6ad94b6760abdc145ae968b2ec95d444d4d4226e99a6ef258e",
	noNetworkRunner: "sha256:cccc0fe4f032c1c8139d100b67838200658648da5790dd8534fdb8dfcb175dee",
	liveRunner: "sha256:07fdee2dca6483d94e9af8e4c1bc4c7d6bc6ae6ba3febdb05d2bf65389804121",
});

export const D738_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d739.implementation-manifest.v1",
	decisionRef: "decision.D739",
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
