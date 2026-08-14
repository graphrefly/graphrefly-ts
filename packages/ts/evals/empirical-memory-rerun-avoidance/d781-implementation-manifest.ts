import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D780_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD780Implementation,
} from "./d780-implementation-manifest.js";

const SOURCES = strictSnapshot({
	coordinates: join(import.meta.dirname, "d781-coordinates.ts"),
	claim: join(import.meta.dirname, "d781-single-use-dispatch-claim.ts"),
	positiveGate: join(import.meta.dirname, "d775-live-positive-gate.ts"),
	preLiveQualification: join(import.meta.dirname, "d781-pre-live-qualification.ts"),
	liveBoundary: join(import.meta.dirname, "d781-graph-native-live.ts"),
	privateAdapter: join(
		import.meta.dirname,
		"../.private/empirical-memory-rerun-avoidance/d781-private-real-route-adapter.ts",
	),
	privateRunner: join(
		import.meta.dirname,
		"../.private/empirical-memory-rerun-avoidance/run-d781-live.ts",
	),
});

export const D781_IMPLEMENTATION_SOURCE_SHA256 = Object.freeze({
	coordinates: "sha256:bf95f3bcef42230671a624e50b6b8452ae872e8626d3b2bdebf7f4e20e5e5259",
	claim: "sha256:1969f332abda781482e8ca6f166c36baa82e0dd0674e208fa7f014c92974913c",
	positiveGate: "sha256:d6e01f250ef79922aa3f1e8002b8a63513f96f116691d29a93f7a37dbf2483cd",
	preLiveQualification: "sha256:a343a5a5baabd2aaa030958119ec2dd31d1a048bde9b1ff43dd874caa6d8b9f2",
	liveBoundary: "sha256:7606075d91018e4682ff4d090aabdd5b95e897ab74ea00bbb4169b7983c9cc0c",
	privateAdapter: "sha256:b64ea24f6979bf24daabac0868607b052e02b7e4082a8a408eafbcf59afcbe34",
	privateRunner: "sha256:baf31f18d140fffa3726cc012ff6936975039451769c96daf4360d5707ae1c70",
} as const);

export const D781_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	baselineManifestDigest: D780_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D781_IMPLEMENTATION_SOURCE_SHA256,
});

export async function measureD781Implementation(): Promise<string> {
	if ((await measureD780Implementation()) !== D780_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D781 D780 implementation baseline drifted");
	for (const [key, path] of Object.entries(SOURCES)) {
		const actual = empiricalSha256(new Uint8Array(await readFile(path)));
		if (actual !== D781_IMPLEMENTATION_SOURCE_SHA256[key as keyof typeof SOURCES])
			throw new TypeError(`D781 implementation source drifted: ${key}`);
	}
	return D781_IMPLEMENTATION_MANIFEST_DIGEST;
}
