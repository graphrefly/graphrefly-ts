import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D728_COORDINATES_DIGEST } from "./d728-coordinates.js";

export const D728_TRACKED_SOURCE_SHA256 = Object.freeze({
	ledger: "sha256:0a2a3ba1ee53a99f1db3f07fb82e5232c58d9646b803b48be9920e5102b2f53b",
	effectRuntime: "sha256:2c34b3a582b1d78a3f10e8eb1103c08d266c76f7cd65b59e04a3b00a855dae21",
	graphEval: "sha256:2541f0210125e03e84395b1834f178f6001c8dd8e5ac867381e69d9f91bc89cf",
	completionProjection: "sha256:50f5b76222916f92dc105fb076e4ef7f7975bd0ebeb16473df58167543f4b33b",
	terminalHttp: "sha256:7b044628bd815b60f07600c948c70a243a088787ec90c18db5ea4327b340b0f2",
	providerBoundary: "sha256:da3f99dfc03e0d06f4d37c6af1fdfa41f4fd451df497d7d4c3f57e64fd5a8f50",
	executorFailureBoundary:
		"sha256:f624f14beb36999f7cc2bea1f2753111b774cdff572cc4fd142c9fe42ee62e75",
	coordinates: "sha256:4ed272957ec77d1e1d1f7c7db8f0b2a08b5b205d9e12bbf669bcc05be74a8119",
	claim: "sha256:912fcd27baeeedb876d5dcb7d19e9242898d5b9c71759d36739b0aecc51421ae",
	live: "sha256:21707022e667c57370a894e1bb0a3d06fe3cc1faf721e34404b6fb7f95cff7dc",
	atomicPersistence: "sha256:b5339507bd9884d0783aa174e4c3dcf469706f9da503a3d4d170bc354d967548",
});

export const D728_PRIVATE_SOURCE_SHA256 = Object.freeze({
	adapter: "sha256:7dd98aef1b02a5ccbd60ae598daba9abec1bef711502e51022422d29a86cfb8d",
	runner: "sha256:18d1be5e5f7b1c233500341dac4424ef0aeb454b4c59cecab1447274ba5da290",
});

export const D728_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d728.implementation-manifest.v1",
	coordinatesDigest: D728_COORDINATES_DIGEST,
	trackedSourceSha256: D728_TRACKED_SOURCE_SHA256,
	privateSourceSha256: D728_PRIVATE_SOURCE_SHA256,
});

export const D728_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D728_IMPLEMENTATION_MANIFEST,
);

export interface D728PrivateImplementationAttestationV1 {
	readonly revision: "graphrefly.b112.d728.private-implementation-attestation.v1";
}

const attestations = new WeakSet<object>();

function validateSet(
	actual: Readonly<Record<string, Uint8Array>>,
	expected: Readonly<Record<string, string>>,
	label: string,
): void {
	for (const key of Object.keys(expected)) {
		const bytes = actual[key];
		if (bytes === undefined || empiricalSha256(bytes) !== expected[key])
			throw new TypeError(`D728 ${label} source drifted: ${key}`);
	}
}

export function validateD728TrackedImplementationBytes(
	input: Readonly<Record<keyof typeof D728_TRACKED_SOURCE_SHA256, Uint8Array>>,
): string {
	validateSet(input, D728_TRACKED_SOURCE_SHA256, "tracked");
	return D728_IMPLEMENTATION_MANIFEST_DIGEST;
}

export function validateD728PrivateImplementationBytes(
	input: Readonly<Record<keyof typeof D728_PRIVATE_SOURCE_SHA256, Uint8Array>>,
): string {
	validateSet(input, D728_PRIVATE_SOURCE_SHA256, "private");
	return D728_IMPLEMENTATION_MANIFEST_DIGEST;
}

export function attestD728PrivateImplementationBytes(
	input: Readonly<Record<keyof typeof D728_PRIVATE_SOURCE_SHA256, Uint8Array>>,
): D728PrivateImplementationAttestationV1 {
	validateD728PrivateImplementationBytes(input);
	const capability = Object.freeze({
		revision: "graphrefly.b112.d728.private-implementation-attestation.v1" as const,
	});
	attestations.add(capability);
	return capability;
}

export function consumeD728PrivateImplementationAttestation(value: unknown): string {
	if (typeof value !== "object" || value === null || !attestations.delete(value))
		throw new TypeError("D728 private implementation attestation is invalid or consumed");
	return D728_IMPLEMENTATION_MANIFEST_DIGEST;
}
