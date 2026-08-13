import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D771_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD771Implementation,
} from "./d771-implementation-manifest.js";

const SOURCES = strictSnapshot({
	coordinates: join(import.meta.dirname, "d773-coordinates.ts"),
	claim: join(import.meta.dirname, "d773-single-use-dispatch-claim.ts"),
	routeAuthority: join(import.meta.dirname, "d773-live-route-authority.ts"),
	positiveGate: join(import.meta.dirname, "d773-live-positive-gate.ts"),
	liveBoundary: join(import.meta.dirname, "d773-graph-native-live.ts"),
	privateAdapter: join(
		import.meta.dirname,
		"../.private/empirical-memory-rerun-avoidance/d773-private-real-route-adapter.ts",
	),
	privateRunner: join(
		import.meta.dirname,
		"../.private/empirical-memory-rerun-avoidance/run-d773-live.ts",
	),
});

export const D773_IMPLEMENTATION_SOURCE_SHA256 = Object.freeze({
	coordinates: "sha256:1182fc8ef8a2abdf99a610868f97a7c560559cef2424edfa99b837acaab563c8" as const,
	claim: "sha256:6de82d89d5be644a97dec307fd5f3b52822fcb4dac25ab8434754ff9b4277f75" as const,
	routeAuthority:
		"sha256:610503c97824ec89b80371be30bfb58a7c709a523236c3201558e14cfcd9247c" as const,
	positiveGate: "sha256:3da5471f2a10085c877c78ae69ec88e4669b8458132e2a2c48f806bcd2755c83" as const,
	liveBoundary: "sha256:bff0d12a91fc865250f3427e1121d446e995681659bc03c509549f198835f0f4" as const,
	privateAdapter:
		"sha256:72bd582b100995a794ca66a67b7b17e564aa4189e07d1b03aa07962ab636af67" as const,
	privateRunner: "sha256:dbbdea673cd4bf7a8aec3cf84f41ca473cf6304e81cd2e56d6e333629f4e5eb6" as const,
});

export const D773_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	baselineManifestDigest: D771_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D773_IMPLEMENTATION_SOURCE_SHA256,
});

export async function measureD773Implementation(): Promise<string> {
	if ((await measureD771Implementation()) !== D771_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D773 D771 implementation baseline drifted");
	for (const [key, path] of Object.entries(SOURCES)) {
		const actual = empiricalSha256(new Uint8Array(await readFile(path)));
		if (actual !== D773_IMPLEMENTATION_SOURCE_SHA256[key as keyof typeof SOURCES])
			throw new TypeError(`D773 implementation source drifted: ${key}`);
	}
	return D773_IMPLEMENTATION_MANIFEST_DIGEST;
}
