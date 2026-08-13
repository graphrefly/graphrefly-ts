import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D774_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD774Implementation,
} from "./d774-implementation-manifest.js";

const SOURCES = strictSnapshot({
	coordinates: join(import.meta.dirname, "d775-coordinates.ts"),
	claim: join(import.meta.dirname, "d775-single-use-dispatch-claim.ts"),
	positiveGate: join(import.meta.dirname, "d775-live-positive-gate.ts"),
	liveBoundary: join(import.meta.dirname, "d775-graph-native-live.ts"),
	privateAdapter: join(
		import.meta.dirname,
		"../.private/empirical-memory-rerun-avoidance/d775-private-real-route-adapter.ts",
	),
	privateRunner: join(
		import.meta.dirname,
		"../.private/empirical-memory-rerun-avoidance/run-d775-live.ts",
	),
});

export const D775_IMPLEMENTATION_SOURCE_SHA256 = Object.freeze({
	coordinates: "sha256:847442e81cfd95d1dd58807c5fcace8e31df257c2630210a6664accc1072a372",
	claim: "sha256:af9a63bf76aea2a5a4b6178d847ba5c80fe966fa5b8a20a93a46daee45089513",
	positiveGate: "sha256:d6e01f250ef79922aa3f1e8002b8a63513f96f116691d29a93f7a37dbf2483cd",
	liveBoundary: "sha256:782b46c6dda4e6349b93bd3f5c2de5c646fa7016d168835703c1b0bc4b3ca9e6",
	privateAdapter: "sha256:a50fe23dcdb35579402a4c1b7fa18491d99adef881a423a2a17f8de5c6e325ea",
	privateRunner: "sha256:033008331eb595da255f35cd641d0a35d6d1edbbf946319f543a0282d9fbdcb3",
} as const);

export const D775_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	baselineManifestDigest: D774_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D775_IMPLEMENTATION_SOURCE_SHA256,
});

export async function measureD775Implementation(): Promise<string> {
	if ((await measureD774Implementation()) !== D774_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D775 D774 implementation baseline drifted");
	for (const [key, path] of Object.entries(SOURCES)) {
		const actual = empiricalSha256(new Uint8Array(await readFile(path)));
		if (actual !== D775_IMPLEMENTATION_SOURCE_SHA256[key as keyof typeof SOURCES])
			throw new TypeError(`D775 implementation source drifted: ${key}`);
	}
	return D775_IMPLEMENTATION_MANIFEST_DIGEST;
}
