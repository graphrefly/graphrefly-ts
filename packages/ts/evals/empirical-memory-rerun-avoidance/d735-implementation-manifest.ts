import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";

export const D735_TRACKED_SOURCE_SHA256 = Object.freeze({
	providerPreflight: "sha256:594a13a340aac44420beda86542868a082ae6d9f67f63d2b6c128b1b3c836383",
	preLive: "sha256:1c738df96c0791d2e3cb483bcc0afbf6430a4975844b773f7ab2cfa891747802",
});

export const D735_PRIVATE_SOURCE_SHA256 = Object.freeze({
	noNetworkRunner: "sha256:85aa5c64ed2def0ee6f368dbf4b89108ca6771e0a24bcafbb2ddbb5b5993ceab",
});

export const D735_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d735.implementation-manifest.v1",
	decisionRef: "decision.D735",
	decisionRevision: "2026-08-11.v1",
	trackedSourceSha256: D735_TRACKED_SOURCE_SHA256,
	privateSourceSha256: D735_PRIVATE_SOURCE_SHA256,
});

export const D735_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D735_IMPLEMENTATION_MANIFEST,
);

export interface D735ImplementationAttestationV1 {
	readonly revision: "graphrefly.b112.d735.implementation-attestation.v1";
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
			throw new TypeError(`D735 ${path} source bytes are invalid: ${key}`);
		if (empiricalSha256(new Uint8Array(bytes)) !== expectedDigest)
			throw new TypeError(`D735 ${path} source drifted: ${key}`);
	}
}

export function attestD735ImplementationBytes(inputValue: {
	readonly tracked: Readonly<Record<keyof typeof D735_TRACKED_SOURCE_SHA256, Uint8Array>>;
	readonly private: Readonly<Record<keyof typeof D735_PRIVATE_SOURCE_SHA256, Uint8Array>>;
}): D735ImplementationAttestationV1 {
	const input = record(inputValue, "d735.implementation");
	exactKeys(input, ["private", "tracked"], "d735.implementation");
	validateSet(input.tracked, D735_TRACKED_SOURCE_SHA256, "tracked");
	validateSet(input.private, D735_PRIVATE_SOURCE_SHA256, "private");
	const capability = Object.freeze({
		revision: "graphrefly.b112.d735.implementation-attestation.v1" as const,
	});
	attestations.add(capability);
	return capability;
}

export function consumeD735ImplementationAttestation(value: unknown): string {
	if (typeof value !== "object" || value === null || !attestations.delete(value))
		throw new TypeError("D735 implementation attestation is invalid or consumed");
	return D735_IMPLEMENTATION_MANIFEST_DIGEST;
}

export function validateD735TrackedImplementationBytes(
	value: Readonly<Record<keyof typeof D735_TRACKED_SOURCE_SHA256, Uint8Array>>,
): string {
	validateSet(value, D735_TRACKED_SOURCE_SHA256, "tracked");
	return D735_IMPLEMENTATION_MANIFEST_DIGEST;
}
