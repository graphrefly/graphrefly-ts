import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_COORDINATES_DIGEST } from "./d729-coordinates.js";

export const D729_TRACKED_SOURCE_SHA256 = Object.freeze({
	ledger: "sha256:0a2a3ba1ee53a99f1db3f07fb82e5232c58d9646b803b48be9920e5102b2f53b",
	effectRuntime: "sha256:a4eba03a7cd1ad6f87ed974d8a992dce329548d3bf3acfabb55787671bd2e59c",
	graphEval: "sha256:2541f0210125e03e84395b1834f178f6001c8dd8e5ac867381e69d9f91bc89cf",
	completionProjection: "sha256:50f5b76222916f92dc105fb076e4ef7f7975bd0ebeb16473df58167543f4b33b",
	terminalHttp: "sha256:46c450b1ce057568db79fa5eb595e7c22024833ec034d899c78e9789e690e0e2",
	providerBoundary: "sha256:4d36b7595b9164f45d4e8b1421f179122b49bf5a7248ee3b90ae243029aa1c0b",
	executorFailureBoundary:
		"sha256:f624f14beb36999f7cc2bea1f2753111b774cdff572cc4fd142c9fe42ee62e75",
	coordinates: "sha256:871a9e061f7aa794a376c5526ef888824376877edfeff30d7fe2a9e05c4a23c5",
	claim: "sha256:75c27b82f085cbae02a4f4f1fedeb70a9ef0b4beaa7af231be3dbfb8148d32de",
	live: "sha256:acd1c6187353b51ca0436fb1124f132f54c7393abbe1f4911aed57b3cc08e876",
	atomicPersistence: "sha256:2c77036b1a02cdd1f4ccc10a2a781dee8b7298caa2ad51762153816442e77ce5",
	routeQualification: "sha256:077851bc7b4fbf80318fa6e1a2f8ded07bd385cf86303f9bfc4f97cce5409306",
	pricingSchedule: "sha256:75cc10f43da99c2beadfa7c1e90b44bd2fbfdedf47e3688d4b126cf235efaca8",
	freshPricingObservation:
		"sha256:0fd79ce41631910747efcf240beb0b437bfee183ba3e892dfc9aac2324f9b301",
});

export const D729_PRIVATE_SOURCE_SHA256 = Object.freeze({
	adapter: "sha256:e1f6be829931b7471f5d757837910d3b6640d1efef2d5f9ced9ff409e15de8a9",
	noNetworkRunner: "sha256:bb7b276574791f46d730c833c7b234880f0a9cb26762afb9481124b8a12e2cd9",
	liveGuard: "sha256:bf977ecffd827bbff142d623383c31d7e5c068e289d4761d206fd9238e873811",
});

export const D729_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d729.implementation-manifest.v1",
	coordinatesDigest: D729_COORDINATES_DIGEST,
	trackedSourceSha256: D729_TRACKED_SOURCE_SHA256,
	privateSourceSha256: D729_PRIVATE_SOURCE_SHA256,
});

export const D729_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D729_IMPLEMENTATION_MANIFEST,
);

export interface D729PrivateImplementationAttestationV1 {
	readonly revision: "graphrefly.b112.d729.private-implementation-attestation.v1";
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
			throw new TypeError(`D729 ${label} source drifted: ${key}`);
	}
}

export function validateD729TrackedImplementationBytes(
	input: Readonly<Record<keyof typeof D729_TRACKED_SOURCE_SHA256, Uint8Array>>,
): string {
	validateSet(input, D729_TRACKED_SOURCE_SHA256, "tracked");
	return D729_IMPLEMENTATION_MANIFEST_DIGEST;
}

export function validateD729PrivateImplementationBytes(
	input: Readonly<Record<keyof typeof D729_PRIVATE_SOURCE_SHA256, Uint8Array>>,
): string {
	validateSet(input, D729_PRIVATE_SOURCE_SHA256, "private");
	return D729_IMPLEMENTATION_MANIFEST_DIGEST;
}

export function attestD729PrivateImplementationBytes(
	input: Readonly<Record<keyof typeof D729_PRIVATE_SOURCE_SHA256, Uint8Array>>,
): D729PrivateImplementationAttestationV1 {
	validateD729PrivateImplementationBytes(input);
	const capability = Object.freeze({
		revision: "graphrefly.b112.d729.private-implementation-attestation.v1" as const,
	});
	attestations.add(capability);
	return capability;
}

export function consumeD729PrivateImplementationAttestation(value: unknown): string {
	if (typeof value !== "object" || value === null || !attestations.delete(value))
		throw new TypeError("D729 private implementation attestation is invalid or consumed");
	return D729_IMPLEMENTATION_MANIFEST_DIGEST;
}
