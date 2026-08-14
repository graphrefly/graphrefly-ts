import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D774_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD774Implementation,
} from "./d774-implementation-manifest.js";

export const D776_IMPLEMENTATION_FILES = Object.freeze({
	providerAuthority: "d776-provider-result-route-authority.ts",
	graphCore: "d776-graph-native-eval.ts",
	qualification: "d776-pre-live-qualification.ts",
	runner: "run-d776-no-network-pre-live.ts",
} as const);

export const D776_IMPLEMENTATION_SOURCE_SHA256 = Object.freeze({
	providerAuthority: "sha256:1cd65725244a53b829d4863606e812feafec0a83fa7c7945083f92910902f5b9",
	graphCore: "sha256:29d33f49a90968d1f258593d6cc7fd5197171a96e880f1dab19fd564c5601096",
	qualification: "sha256:31e54a01e2dc1bb48f28ec5db1178789425b91ee49ef0f66709be6bfc5f154ef",
	runner: "sha256:13960e36459dad13c2c8d8b8d118a810c4c95b0b1c6afd1dfa844858e6fb4fb1",
} as const);

export const D776_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:0dabb4f2bc5ebde179a718e0b893e64fbeeab9051c13f2aceaed5861ba4f940f" as const;

export async function measureD776Implementation(): Promise<string> {
	if ((await measureD774Implementation()) !== D774_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D776 D774 implementation baseline drifted");
	const root = dirname(fileURLToPath(import.meta.url));
	const measured: Record<string, string> = {};
	for (const [key, file] of Object.entries(D776_IMPLEMENTATION_FILES))
		measured[key] = empiricalSha256(await readFile(join(root, file)));
	for (const [key, expected] of Object.entries(D776_IMPLEMENTATION_SOURCE_SHA256))
		if (measured[key] !== expected)
			throw new TypeError(`D776 implementation source drifted: ${key}`);
	const material = strictSnapshot({
		decisionRef: "decision.D776.2026-08-13.v1",
		baselineManifestDigest: D774_IMPLEMENTATION_MANIFEST_DIGEST,
		files: D776_IMPLEMENTATION_FILES,
		sourceSha256: D776_IMPLEMENTATION_SOURCE_SHA256,
		nodeVersion: "v24.18.0",
	});
	const digest = empiricalStrictJsonDigest(material);
	if (digest !== D776_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D776 implementation manifest digest drifted");
	return digest;
}
