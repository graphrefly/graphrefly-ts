import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

export const D731_TRACKED_SOURCE_SHA256 = Object.freeze({
	graphLedger: "sha256:0a2a3ba1ee53a99f1db3f07fb82e5232c58d9646b803b48be9920e5102b2f53b",
	graphRuntime: "sha256:2c34b3a582b1d78a3f10e8eb1103c08d266c76f7cd65b59e04a3b00a855dae21",
	graphEval: "sha256:2541f0210125e03e84395b1834f178f6001c8dd8e5ac867381e69d9f91bc89cf",
	providerTurn: "sha256:c3abe6a305dcd7f09848900b2a5993bd93dd58ab0ca6a6edc5eefa8612421c37",
	terminalHttp: "sha256:46c450b1ce057568db79fa5eb595e7c22024833ec034d899c78e9789e690e0e2",
	providerCore: "sha256:4d36b7595b9164f45d4e8b1421f179122b49bf5a7248ee3b90ae243029aa1c0b",
	liveBundle: "sha256:acd1c6187353b51ca0436fb1124f132f54c7393abbe1f4911aed57b3cc08e876",
	routeEligibility: "sha256:17df57953e82bdcc2ffcc4401e1aea4e1134e98f9159c3df203499fcf0d0a28c",
	injectedFixture: "sha256:e0b9b9e9540ab6a45b015957a4b7ce8064d94515c4bc633d31c8f5c9842462f6",
	preLive: "sha256:60fae941309e657623440410a1ec025ac2f8cbadf04cd3e9cfb240de411808f2",
});

export const D731_PRIVATE_SOURCE_SHA256 = Object.freeze({
	noNetworkRunner: "sha256:ef0605c3987796626bceddbdcda4472f19a6e9f1641d15657095b11ca556073f",
});

export const D731_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d731.implementation-manifest.v1",
	decisionRef: "decision.D731",
	decisionRevision: "2026-08-11.v1",
	trackedSourceSha256: D731_TRACKED_SOURCE_SHA256,
	privateSourceSha256: D731_PRIVATE_SOURCE_SHA256,
});

export const D731_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D731_IMPLEMENTATION_MANIFEST,
);

export interface D731ImplementationAttestationV1 {
	readonly revision: "graphrefly.b112.d731.implementation-attestation.v1";
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
			throw new TypeError(`D731 ${label} implementation source drifted: ${key}`);
	}
}

export function validateD731TrackedImplementationBytes(
	input: Readonly<Record<keyof typeof D731_TRACKED_SOURCE_SHA256, Uint8Array>>,
): string {
	validateSet(input, D731_TRACKED_SOURCE_SHA256, "tracked");
	return D731_IMPLEMENTATION_MANIFEST_DIGEST;
}

export function attestD731ImplementationBytes(input: {
	readonly tracked: Readonly<Record<keyof typeof D731_TRACKED_SOURCE_SHA256, Uint8Array>>;
	readonly private: Readonly<Record<keyof typeof D731_PRIVATE_SOURCE_SHA256, Uint8Array>>;
}): D731ImplementationAttestationV1 {
	validateSet(input.tracked, D731_TRACKED_SOURCE_SHA256, "tracked");
	validateSet(input.private, D731_PRIVATE_SOURCE_SHA256, "private");
	const capability = Object.freeze({
		revision: "graphrefly.b112.d731.implementation-attestation.v1" as const,
	});
	attestations.add(capability);
	return capability;
}

export function consumeD731ImplementationAttestation(value: unknown): string {
	if (typeof value !== "object" || value === null || !attestations.delete(value))
		throw new TypeError("D731 implementation attestation is invalid or consumed");
	return D731_IMPLEMENTATION_MANIFEST_DIGEST;
}
