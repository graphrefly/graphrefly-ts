import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D781_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD781Implementation,
} from "./d781-implementation-manifest.js";

const SOURCES = strictSnapshot({
	coordinates: join(import.meta.dirname, "d782-coordinates.ts"),
	claim: join(import.meta.dirname, "d782-single-use-dispatch-claim.ts"),
	positiveGate: join(import.meta.dirname, "d775-live-positive-gate.ts"),
	preLiveQualification: join(import.meta.dirname, "d782-pre-live-qualification.ts"),
	liveBoundary: join(import.meta.dirname, "d782-graph-native-live.ts"),
	privateAdapter: join(
		import.meta.dirname,
		"../.private/empirical-memory-rerun-avoidance/d782-private-real-route-adapter.ts",
	),
	privateRunner: join(
		import.meta.dirname,
		"../.private/empirical-memory-rerun-avoidance/run-d782-live.ts",
	),
});

export const D782_IMPLEMENTATION_SOURCE_SHA256 = Object.freeze({
	coordinates: "sha256:3d730b6abc0360a7b73a6539da32b4c56303a0df0c4b957b1026ba91ba41233c",
	claim: "sha256:ec467c63d19dc1e65f24703c52ce8e11a3d6280c5f2f421cfbd4ba0be1d2abc1",
	positiveGate: "sha256:d6e01f250ef79922aa3f1e8002b8a63513f96f116691d29a93f7a37dbf2483cd",
	preLiveQualification: "sha256:18d57f8562ba879e817d99cd4351418ac43c1cfe177571e27696c60588600566",
	liveBoundary: "sha256:d56f26dfa15acf50dad7b77a28892ee098b7669ffd4ca992274e2b63fb7d85b6",
	privateAdapter: "sha256:37947a44630ebeb5ec49c4d484710399d45c182af5634bb7c12168c77dee4aaa",
	privateRunner: "sha256:8a70c27a76ad84d9e04d885dbab27a5a2b08f1872bb64c9f576f8777a76b8cf8",
} as const);

export const D782_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	baselineManifestDigest: D781_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D782_IMPLEMENTATION_SOURCE_SHA256,
});

export async function measureD782Implementation(): Promise<string> {
	if ((await measureD781Implementation()) !== D781_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D782 D781 repaired implementation baseline drifted");
	for (const [key, path] of Object.entries(SOURCES)) {
		const actual = empiricalSha256(new Uint8Array(await readFile(path)));
		if (actual !== D782_IMPLEMENTATION_SOURCE_SHA256[key as keyof typeof SOURCES])
			throw new TypeError(`D782 implementation source drifted: ${key}`);
	}
	return D782_IMPLEMENTATION_MANIFEST_DIGEST;
}
