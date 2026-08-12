import { readFile } from "node:fs/promises";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D751_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD751Implementation,
} from "./d751-implementation-manifest.js";

export const D756_NAMED_TOOL_SOURCE_SHA256 =
	"sha256:3951f6613fdb4bb9b8493467b007ce5dce2c7e6cae6bc55d7d97f1c033bf4180" as const;

export const D756_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d756.implementation-manifest.v1",
	decisionRef: "decision.D756",
	baselineManifestDigest: D751_IMPLEMENTATION_MANIFEST_DIGEST,
	namedToolSourceSha256: D756_NAMED_TOOL_SOURCE_SHA256,
});

export const D756_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D756_IMPLEMENTATION_MANIFEST,
);

export async function measureD756Implementation(): Promise<string> {
	if ((await measureD751Implementation()) !== D751_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D756 Graph baseline manifest drifted");
	const bytes = await readFile(new URL("./d756-graph-named-tool-continuation.ts", import.meta.url));
	if (empiricalSha256(bytes) !== D756_NAMED_TOOL_SOURCE_SHA256)
		throw new TypeError("D756 named-tool implementation drifted");
	return D756_IMPLEMENTATION_MANIFEST_DIGEST;
}
