import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";

export const D734_TRACKED_SOURCE_SHA256 = Object.freeze({
	providerIntegration: "sha256:d7ebc60e6c94e12f120b6f77d40ca84116f43f2cab2fe288bed82f92b010b3f2",
	injectedFixture: "sha256:83734cce5bd07459e60b7aaf2f2ae7e2691b32d6f5f290f0265c233bb0d1bf5a",
	preLive: "sha256:cab126bc10d3061889674491ffb4c77b2a1cc5fc52adeaff38e5fcb9386dd843",
});

export const D734_PRIVATE_SOURCE_SHA256 = Object.freeze({
	noNetworkRunner: "sha256:e736e4920469e01477f0becbf4ff3e7efda550c85d7fed501a22b37b7349f0e9",
});

export const D734_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d734.implementation-manifest.v1",
	decisionRef: "decision.D734",
	decisionRevision: "2026-08-11.v1",
	trackedSourceSha256: D734_TRACKED_SOURCE_SHA256,
	privateSourceSha256: D734_PRIVATE_SOURCE_SHA256,
});

export const D734_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D734_IMPLEMENTATION_MANIFEST,
);

export interface D734ImplementationAttestationV1 {
	readonly revision: "graphrefly.b112.d734.implementation-attestation.v1";
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
			throw new TypeError(`D734 ${path} source bytes are invalid: ${key}`);
		if (empiricalSha256(new Uint8Array(bytes)) !== expectedDigest)
			throw new TypeError(`D734 ${path} source drifted: ${key}`);
	}
}

export function attestD734ImplementationBytes(inputValue: {
	readonly tracked: Readonly<Record<keyof typeof D734_TRACKED_SOURCE_SHA256, Uint8Array>>;
	readonly private: Readonly<Record<keyof typeof D734_PRIVATE_SOURCE_SHA256, Uint8Array>>;
}): D734ImplementationAttestationV1 {
	const input = record(inputValue, "d734.implementation");
	exactKeys(input, ["private", "tracked"], "d734.implementation");
	validateSet(input.tracked, D734_TRACKED_SOURCE_SHA256, "tracked");
	validateSet(input.private, D734_PRIVATE_SOURCE_SHA256, "private");
	const capability = Object.freeze({
		revision: "graphrefly.b112.d734.implementation-attestation.v1" as const,
	});
	attestations.add(capability);
	return capability;
}

export function validateD734TrackedImplementationBytes(
	input: Readonly<Record<keyof typeof D734_TRACKED_SOURCE_SHA256, Uint8Array>>,
): string {
	validateSet(input, D734_TRACKED_SOURCE_SHA256, "tracked");
	return D734_IMPLEMENTATION_MANIFEST_DIGEST;
}

export function consumeD734ImplementationAttestation(value: unknown): string {
	if (typeof value !== "object" || value === null || !attestations.delete(value))
		throw new TypeError("D734 implementation attestation is invalid or consumed");
	return D734_IMPLEMENTATION_MANIFEST_DIGEST;
}
