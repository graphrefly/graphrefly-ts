import { empiricalSha256, empiricalStrictJsonDigest, exactKeys, record } from "./canonical.js";

export const D725_IMPLEMENTATION_SOURCE_SHA256 = Object.freeze({
	terminalHttpRealProvider:
		"sha256:0ebb190e0e2ab24a61a33ae49ccbb923ff6a717c0bbc78b76b479e3f416d44bd",
	preLivePersistence: "sha256:c3074ec051af1c55742a397fc9f53acc912428de9e0e8e5e1d4bd622806af792",
	injectedNoNetworkQualification:
		"sha256:619d7210c6ce596d9f8e33aee66631d67e78f23373dc174ec30af30a2281dd07",
	terminalHttpEvidence: "sha256:7b044628bd815b60f07600c948c70a243a088787ec90c18db5ea4327b340b0f2",
	underlyingOpenRouterTurn:
		"sha256:50910e76d3e1ba19c2186ac40b910e4d0ad8b85151cfe67deab11eb77249bd6e",
	underlyingRealProviderAdapter:
		"sha256:2e71a6c8bc1e607f2b9e787c8ff8acefa6487346813946faaa8a37645841984a",
});

export const D725_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly.b112.d725.implementation-manifest.v1",
	sources: D725_IMPLEMENTATION_SOURCE_SHA256,
});

export function validateD725ImplementationSourceBytes(inputValue: {
	readonly terminalHttpRealProvider: Uint8Array;
	readonly preLivePersistence: Uint8Array;
	readonly injectedNoNetworkQualification: Uint8Array;
	readonly terminalHttpEvidence: Uint8Array;
	readonly underlyingOpenRouterTurn: Uint8Array;
	readonly underlyingRealProviderAdapter: Uint8Array;
}): typeof D725_IMPLEMENTATION_MANIFEST_DIGEST {
	const input = record(inputValue, "d725.implementationSources");
	exactKeys(
		input,
		[
			"injectedNoNetworkQualification",
			"preLivePersistence",
			"terminalHttpEvidence",
			"terminalHttpRealProvider",
			"underlyingOpenRouterTurn",
			"underlyingRealProviderAdapter",
		],
		"d725.implementationSources",
	);
	for (const key of Object.keys(D725_IMPLEMENTATION_SOURCE_SHA256) as Array<
		keyof typeof D725_IMPLEMENTATION_SOURCE_SHA256
	>) {
		const bytes = input[key];
		if (!(bytes instanceof Uint8Array))
			throw new TypeError(`D725 ${key} source bytes must be Uint8Array`);
		if (bytes.byteLength < 1 || bytes.byteLength > 1_048_576)
			throw new TypeError(`D725 ${key} source bytes are outside the bound`);
		if (empiricalSha256(new Uint8Array(bytes)) !== D725_IMPLEMENTATION_SOURCE_SHA256[key])
			throw new TypeError(`D725 ${key} implementation source drifted`);
	}
	return D725_IMPLEMENTATION_MANIFEST_DIGEST;
}
