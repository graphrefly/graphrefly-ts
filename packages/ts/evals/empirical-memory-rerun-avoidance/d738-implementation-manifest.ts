import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";

export const D738_TRACKED_SOURCE_SHA256 = Object.freeze({
	graphRuntime: "sha256:e5fc205ca00e654e968e3efbb17d496021f2fa4f6ba58c07070c2a1f7d15e2e8",
	graphProjection: "sha256:754082e5378e1a4c06d984c38b339fcd097582d507c070d70530d37f0f4250c8",
	graphEval: "sha256:9e82c5a992c9d95ead48f871b371c9875c3dcd510d2eef9d30e655a2d95590d2",
	providerCore: "sha256:ec1a644edb5989315a4a3ec5e6e621786f89b1c9e9493026a91ad7568e1f7cd5",
	routeIntegration: "sha256:56bc2d7d961b790d3e39cafde32ded3419bdc1892b7dfffb5754e07bc5b21154",
	coordinates: "sha256:71184752820301953e387146e1369d2e949abb408f3345b491edb370698efabc",
	claim: "sha256:c3dd779309022c35d6ff662ec553267675f0a171f7d89dff7b59fe5c4ba765d7",
	live: "sha256:494bf6f48f51ca0603370a9f622be8476fdafe8c7e86961f7bbdf00b301a7191",
});

export const D738_PRIVATE_SOURCE_SHA256 = Object.freeze({
	realRouteAdapter: "sha256:de277ef03e787e6ad94b6760abdc145ae968b2ec95d444d4d4226e99a6ef258e",
	noNetworkRunner: "sha256:009d0ab90ade542beba9c7d4ed280b9c3c7bf1a1c7a3a78f22976e418f434cbe",
	liveRunner: "sha256:10e87b327668cb6b31b47114a8d177a672ced0f88f7e2c896047b123f0d9b691",
});

export const D738_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d738.implementation-manifest.v1",
	decisionRef: "decision.D738",
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
