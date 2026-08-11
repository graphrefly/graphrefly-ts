import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D726_COORDINATES_DIGEST } from "./d726-coordinates.js";

export const D726_QUALIFIED_HEAD = "tracked-source-manifest+private-sha256" as const;
export const D726_TRACKED_SOURCE_SHA256 = Object.freeze({
	ledger: "sha256:0a2a3ba1ee53a99f1db3f07fb82e5232c58d9646b803b48be9920e5102b2f53b",
	effectRuntime: "sha256:24a19323fd28114ce10b6b4e5d8c5a5bb357b68467c3c2b1baba8bccb0b34ff5",
	graphEval: "sha256:c1c624d9b8c517ed4e32cadb1a356685a704cd8c2fe0133444e75d2fef61b7da",
	completionProjection: "sha256:d241ffd6473c88f02c2f2109c65298931b971ca2b1d3e5132ddc1ac814ecdca9",
	coordinates: "sha256:349d6b178907819a8f933e7e610917a70d0b72a5af80fddcb706306645b7cda9",
	claim: "sha256:d6ece6a0854c5330b4f26a2f20662a6c1a024ef4499b5843f56c5de7c9f650c3",
	live: "sha256:b90323b8d5d5ecec62dc546cc894c93f48a01d5d8bffe279b15a2d842a564837",
});
export const D726_PRIVATE_SOURCE_SHA256 = Object.freeze({
	adapter: "sha256:b46a82ad8902ff1e1e9ff460d75e61c68adf3423e03ee9d58879ee8dfd2c31fb",
	runner: "sha256:7d81cde94da9797e932034dc29a27fa13bf21b4de10053011ef7e90b2f76e137",
});

export const D726_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d726.implementation-manifest.v1",
	qualifiedHead: D726_QUALIFIED_HEAD,
	coordinatesDigest: D726_COORDINATES_DIGEST,
	trackedSourceSha256: D726_TRACKED_SOURCE_SHA256,
	privateSourceSha256: D726_PRIVATE_SOURCE_SHA256,
});

export const D726_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D726_IMPLEMENTATION_MANIFEST,
);

export interface D726PrivateImplementationAttestationV1 {
	readonly revision: "graphrefly.b112.d726.private-implementation-attestation.v1";
}

const constructedPrivateAttestations = new WeakSet<object>();

export function validateD726PrivateImplementationBytes(input: {
	readonly adapter: Uint8Array;
	readonly runner: Uint8Array;
}): string {
	if (
		empiricalSha256(input.adapter) !== D726_PRIVATE_SOURCE_SHA256.adapter ||
		empiricalSha256(input.runner) !== D726_PRIVATE_SOURCE_SHA256.runner
	)
		throw new TypeError("D726 private implementation source drifted");
	return D726_IMPLEMENTATION_MANIFEST_DIGEST;
}

export function attestD726PrivateImplementationBytes(input: {
	readonly adapter: Uint8Array;
	readonly runner: Uint8Array;
}): D726PrivateImplementationAttestationV1 {
	validateD726PrivateImplementationBytes(input);
	const capability = Object.freeze({
		revision: "graphrefly.b112.d726.private-implementation-attestation.v1" as const,
	});
	constructedPrivateAttestations.add(capability);
	return capability;
}

export function consumeD726PrivateImplementationAttestation(
	value: D726PrivateImplementationAttestationV1,
): string {
	if (typeof value !== "object" || value === null || !constructedPrivateAttestations.delete(value))
		throw new TypeError("D726 private implementation attestation is invalid or consumed");
	return D726_IMPLEMENTATION_MANIFEST_DIGEST;
}

export function validateD726TrackedImplementationBytes(input: {
	readonly ledger: Uint8Array;
	readonly effectRuntime: Uint8Array;
	readonly graphEval: Uint8Array;
	readonly completionProjection: Uint8Array;
	readonly coordinates: Uint8Array;
	readonly claim: Uint8Array;
	readonly live: Uint8Array;
}): string {
	for (const key of Object.keys(
		D726_TRACKED_SOURCE_SHA256,
	) as (keyof typeof D726_TRACKED_SOURCE_SHA256)[])
		if (empiricalSha256(input[key]) !== D726_TRACKED_SOURCE_SHA256[key])
			throw new TypeError(`D726 tracked implementation source drifted: ${key}`);
	return D726_IMPLEMENTATION_MANIFEST_DIGEST;
}
