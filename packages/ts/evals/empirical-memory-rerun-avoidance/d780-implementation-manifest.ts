import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D779_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD779Implementation,
} from "./d779-implementation-manifest.js";

const SOURCES = strictSnapshot({
	coordinates: join(import.meta.dirname, "d780-coordinates.ts"),
	claim: join(import.meta.dirname, "d780-single-use-dispatch-claim.ts"),
	positiveGate: join(import.meta.dirname, "d775-live-positive-gate.ts"),
	liveBoundary: join(import.meta.dirname, "d780-graph-native-live.ts"),
	privateAdapter: join(
		import.meta.dirname,
		"../.private/empirical-memory-rerun-avoidance/d780-private-real-route-adapter.ts",
	),
	privateRunner: join(
		import.meta.dirname,
		"../.private/empirical-memory-rerun-avoidance/run-d780-live.ts",
	),
});

export const D780_IMPLEMENTATION_SOURCE_SHA256 = Object.freeze({
	coordinates: "sha256:3428689a615cc4c09ffdd426a09620df3a979084f805802c38f34e3c466089aa",
	claim: "sha256:99719f5da9b8e704b10d110bcbce4eb69236e31ed43b67a5bd6e485cdb89a440",
	positiveGate: "sha256:d6e01f250ef79922aa3f1e8002b8a63513f96f116691d29a93f7a37dbf2483cd",
	liveBoundary: "sha256:640210a9a6507a0d44d8051651e6721b744fd72a003b65db77a5da626b22064e",
	privateAdapter: "sha256:35021a6b6efca477c315dd0cc5ea4d9b34d3554144c91a9c28f0dc72eafae10f",
	privateRunner: "sha256:d2f12448090ebe69f2088b6b6795caf4d76afacf8fab7ca7e96149ed7af75d27",
} as const);

export const D780_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	baselineManifestDigest: D779_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D780_IMPLEMENTATION_SOURCE_SHA256,
});

export async function measureD780Implementation(): Promise<string> {
	if ((await measureD779Implementation()) !== D779_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D780 D779 implementation baseline drifted");
	for (const [key, path] of Object.entries(SOURCES)) {
		const actual = empiricalSha256(new Uint8Array(await readFile(path)));
		if (actual !== D780_IMPLEMENTATION_SOURCE_SHA256[key as keyof typeof SOURCES])
			throw new TypeError(`D780 implementation source drifted: ${key}`);
	}
	return D780_IMPLEMENTATION_MANIFEST_DIGEST;
}
