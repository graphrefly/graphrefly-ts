import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D45_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	policy: "sha256:c08e6377b1e8a6280325d6b99f43a201b1ae851b57a941cfe72992799797a9b9",
	lifecycleAuthority: "sha256:fe36cb8ebc0e01f1fd6288586245aaa2c6f71bf5cf7d51211641921c69e1c874",
	toolAuthority: "sha256:dc3c69fbe2bdb343a952a5d95efbe9947e444fdc56c289de1b77e925c54df87b",
	adapter: "sha256:50e3b0bfb6d7e510303ea0ecac9ae4633859034b552d29bee382eb81690e7ed1",
	qualification: "sha256:44531bce74c3a777cd775a37e69ff9877078ef3792266846a630ed5898cd5d9a",
});

export const D45_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d45.implementation-manifest.v1",
	sources: D45_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD45Implementation(): Promise<string> {
	const measured = Object.freeze({
		policy: empiricalSha256(
			await readFile(join(import.meta.dirname, "d43-model-harness-policy.ts")),
		),
		lifecycleAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d43-graph-harness-authority.ts")),
		),
		toolAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-graph-tool-authority.ts")),
		),
		adapter: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-mechanical-chat-adapter.ts")),
		),
		qualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-graph-tool-qualification.ts")),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D45_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D45 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d45.implementation-manifest.v1",
		sources: measured,
	});
}
