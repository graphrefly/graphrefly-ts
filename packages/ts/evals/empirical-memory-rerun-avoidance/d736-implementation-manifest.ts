import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";

export const D736_TRACKED_SOURCE_SHA256 = Object.freeze({
	routeIntegration: "sha256:ac8896d7533de32091d507011d26a41019e47ffcf32747b53631ca3f5488e517",
	coordinates: "sha256:737c18e4ae8a25dc73ed354a5075813bedf1f71685784966848aabeb2fe67e46",
	claim: "sha256:869c8ca2f07288af178c6898bf7ab8a1802ad31b4a5e851256819a99c84f5275",
	live: "sha256:f9673670c9c08b7b1d26a723f17adb03c120f1d51a362b75ce2216f13e45632a",
});

export const D736_PRIVATE_SOURCE_SHA256 = Object.freeze({
	realRouteAdapter: "sha256:758606ac174fa359a45db1ca57883097a1c3b74c091501ae7d906fd7203bd878",
	noNetworkRunner: "sha256:53850b69adb99c2344bc1e41da48ca070687fa95ec154293295414b4373101c0",
	liveRunner: "sha256:089ef19bb6579ddbfcfe59d98109e287dbd584729fefc22ecf8894da60ff14fd",
});

export const D736_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d736.implementation-manifest.v1",
	decisionRef: "decision.D736",
	decisionRevision: "2026-08-11.v1",
	trackedSourceSha256: D736_TRACKED_SOURCE_SHA256,
	privateSourceSha256: D736_PRIVATE_SOURCE_SHA256,
});

export const D736_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D736_IMPLEMENTATION_MANIFEST,
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
			throw new TypeError(`D736 ${path} source bytes are invalid: ${key}`);
		if (empiricalSha256(new Uint8Array(bytes)) !== expectedDigest)
			throw new TypeError(`D736 ${path} source drifted: ${key}`);
	}
}

export function validateD736ImplementationBytes(inputValue: {
	readonly tracked: Readonly<Record<keyof typeof D736_TRACKED_SOURCE_SHA256, Uint8Array>>;
	readonly private: Readonly<Record<keyof typeof D736_PRIVATE_SOURCE_SHA256, Uint8Array>>;
}): string {
	const input = record(inputValue, "d736.implementation");
	exactKeys(input, ["private", "tracked"], "d736.implementation");
	validateSet(input.tracked, D736_TRACKED_SOURCE_SHA256, "tracked");
	validateSet(input.private, D736_PRIVATE_SOURCE_SHA256, "private");
	return D736_IMPLEMENTATION_MANIFEST_DIGEST;
}
