import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D776_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD776Implementation,
} from "./d776-implementation-manifest.js";

const SOURCES = strictSnapshot({
	coordinates: join(import.meta.dirname, "d777-coordinates.ts"),
	claim: join(import.meta.dirname, "d777-single-use-dispatch-claim.ts"),
	positiveGate: join(import.meta.dirname, "d775-live-positive-gate.ts"),
	liveBoundary: join(import.meta.dirname, "d777-graph-native-live.ts"),
	privateAdapter: join(
		import.meta.dirname,
		"../.private/empirical-memory-rerun-avoidance/d777-private-real-route-adapter.ts",
	),
	privateRunner: join(
		import.meta.dirname,
		"../.private/empirical-memory-rerun-avoidance/run-d777-live.ts",
	),
});

export const D777_IMPLEMENTATION_SOURCE_SHA256 = Object.freeze({
	coordinates: "sha256:87e137e1d037e75fcadbb21747b9c716304ba2c0311080bbfb431a884a1af116",
	claim: "sha256:7243d06f2daf500909c4428d34b2e7cdb5b32da870d34c63f335fffaa782be33",
	positiveGate: "sha256:d6e01f250ef79922aa3f1e8002b8a63513f96f116691d29a93f7a37dbf2483cd",
	liveBoundary: "sha256:70d97a613a9cbda7f80fb277b119aa5d1fe7995dfabb602bff84d8295038a035",
	privateAdapter: "sha256:adb5edc5a72a2b2b7fd21a53820a076d534021cc6373e8d32e99b577f09f2b17",
	privateRunner: "sha256:8c375a9c5a2e9c3c0ea96d4ab69067baf52afcbdd6d48a020ffd9fd466aed6df",
} as const);

export const D777_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	baselineManifestDigest: D776_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D777_IMPLEMENTATION_SOURCE_SHA256,
});

export async function measureD777Implementation(): Promise<string> {
	if ((await measureD776Implementation()) !== D776_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D777 D776 implementation baseline drifted");
	for (const [key, path] of Object.entries(SOURCES)) {
		const actual = empiricalSha256(new Uint8Array(await readFile(path)));
		if (actual !== D777_IMPLEMENTATION_SOURCE_SHA256[key as keyof typeof SOURCES])
			throw new TypeError(`D777 implementation source drifted: ${key}`);
	}
	return D777_IMPLEMENTATION_MANIFEST_DIGEST;
}
