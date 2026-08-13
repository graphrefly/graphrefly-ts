import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D767_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD767Implementation,
} from "./d767-implementation-manifest.js";

export const D768_IMPLEMENTATION_SOURCE_SHA256 = Object.freeze({
	coordinates: "sha256:b9bb1b9529ed6417721c6ef17c1ccea003aa340778243fbdc65d2498733c9974" as const,
	claim: "sha256:2222e84a886e4834c1e41bca180d2f01ee2c804f365dfdec89775ec4caee80fe" as const,
	liveBoundary: "sha256:fb354979f259ee604d083f40e15bc31a589c68ad8530f83aa595cb826d8a6d9b" as const,
	privateAdapter:
		"sha256:8151385f9c57da969298f195b987c4c8a2b02feada73b8de21e07ff8e7f3f0c6" as const,
	privateRunner: "sha256:23bcbc73b56400451e13c383caae782640016a228c8e0a23b922fe55eea50f63" as const,
});

export const D768_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	baselineManifestDigest: D767_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D768_IMPLEMENTATION_SOURCE_SHA256,
});

const sourcePaths = strictSnapshot({
	coordinates: join(import.meta.dirname, "d768-coordinates.ts"),
	claim: join(import.meta.dirname, "d768-single-use-dispatch-claim.ts"),
	liveBoundary: join(import.meta.dirname, "d768-graph-native-live.ts"),
	privateAdapter: join(
		import.meta.dirname,
		"../.private/empirical-memory-rerun-avoidance/d768-private-real-route-adapter.ts",
	),
	privateRunner: join(
		import.meta.dirname,
		"../.private/empirical-memory-rerun-avoidance/run-d768-live.ts",
	),
});

export async function measureD768Implementation(): Promise<string> {
	if ((await measureD767Implementation()) !== D767_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D768 D767 implementation baseline drifted");
	for (const [key, path] of Object.entries(sourcePaths)) {
		const actual = empiricalSha256(new Uint8Array(await readFile(path)));
		if (actual !== D768_IMPLEMENTATION_SOURCE_SHA256[key as keyof typeof sourcePaths])
			throw new TypeError(`D768 implementation source drifted: ${key}`);
	}
	return D768_IMPLEMENTATION_MANIFEST_DIGEST;
}
