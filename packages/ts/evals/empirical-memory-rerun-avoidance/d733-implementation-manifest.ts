import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";

export const D733_TRACKED_SOURCE_SHA256 = Object.freeze({
	routeProfile: "sha256:9c134ae620765ec87f5a6da05c0222bb71389f49c6d436e76b80d11cac10e0fd",
	coordinates: "sha256:5b48febd1f81a7e8d70254b05c5b55032f5ff2b9f209932376202cdcfd4b8bfd",
	providerTurn: "sha256:3ad8d04cfbd91f2641d8d9811ec6efb722569906ee632408787802efa0453029",
	preLive: "sha256:7e99bae0a13c2397444ecade80d0c4b9214d8ebe2f2ace10341e049112083865",
});

export const D733_PRIVATE_SOURCE_SHA256 = Object.freeze({
	noNetworkRunner: "sha256:5fe6f3ba789217ec9b08dd71e03181b9b2b9c95f12e43e2727e5891ddb8fefe9",
});

export const D733_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d733.implementation-manifest.v1",
	decisionRef: "decision.D733",
	decisionRevision: "2026-08-11.v1",
	trackedSourceSha256: D733_TRACKED_SOURCE_SHA256,
	privateSourceSha256: D733_PRIVATE_SOURCE_SHA256,
});

export const D733_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D733_IMPLEMENTATION_MANIFEST,
);

export interface D733ImplementationAttestationV1 {
	readonly revision: "graphrefly.b112.d733.implementation-attestation.v1";
}

const attestations = new WeakSet<object>();

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
			throw new TypeError(`D733 ${path} source bytes are invalid: ${key}`);
		if (empiricalSha256(new Uint8Array(bytes)) !== expectedDigest)
			throw new TypeError(`D733 ${path} source drifted: ${key}`);
	}
}

export function attestD733ImplementationBytes(inputValue: {
	readonly tracked: Readonly<Record<keyof typeof D733_TRACKED_SOURCE_SHA256, Uint8Array>>;
	readonly private: Readonly<Record<keyof typeof D733_PRIVATE_SOURCE_SHA256, Uint8Array>>;
}): D733ImplementationAttestationV1 {
	const input = record(inputValue, "implementation");
	exactKeys(input, ["private", "tracked"], "implementation");
	validateSet(input.tracked, D733_TRACKED_SOURCE_SHA256, "tracked");
	validateSet(input.private, D733_PRIVATE_SOURCE_SHA256, "private");
	const capability = Object.freeze({
		revision: "graphrefly.b112.d733.implementation-attestation.v1" as const,
	});
	attestations.add(capability);
	return capability;
}

export function validateD733TrackedImplementationBytes(
	input: Readonly<Record<keyof typeof D733_TRACKED_SOURCE_SHA256, Uint8Array>>,
): string {
	validateSet(input, D733_TRACKED_SOURCE_SHA256, "tracked");
	return D733_IMPLEMENTATION_MANIFEST_DIGEST;
}

export function consumeD733ImplementationAttestation(value: unknown): string {
	if (typeof value !== "object" || value === null || !attestations.delete(value))
		throw new TypeError("D733 implementation attestation is invalid or consumed");
	return D733_IMPLEMENTATION_MANIFEST_DIGEST;
}
