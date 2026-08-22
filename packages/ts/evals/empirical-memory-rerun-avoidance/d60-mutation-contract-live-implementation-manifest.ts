import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D60_LIVE_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	d44LiveGates: "sha256:39bf56f1a0364b9c1e1b1e7097e05f00f2eeab67761c100070033ee9bb6e1a8e",
	d55Manifest: "sha256:3d6eb2604536055bf5569cf92da5f6a3b1a5e4cd39ea92958f7054f1982d8651",
	d60LiveGates: "sha256:e91a8d5c76cc9d3487fd91ba0e7bcbc7dc16f6cbf5623a19895c56d76b2ebf59",
	d60LiveRunner: "sha256:5eca66a69ad1fc648b305440a3d94819bb09370d04972eac32466c8ccb14d74f",
	test: "sha256:f0d89aba550b67ed20e320dea273915cedf9814376452321327c44e65ad7e35a",
});

export const D60_LIVE_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d60.live-implementation-manifest.v1",
	sources: D60_LIVE_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD60LiveImplementation(): Promise<string> {
	const measured = Object.freeze({
		d44LiveGates: empiricalSha256(
			await readFile(join(import.meta.dirname, "d44-d45-live-gates.ts")),
		),
		d55Manifest: empiricalSha256(
			await readFile(join(import.meta.dirname, "d55-provider-boundary-implementation-manifest.ts")),
		),
		d60LiveGates: empiricalSha256(
			await readFile(join(import.meta.dirname, "d60-mutation-contract-live-gates.ts")),
		),
		d60LiveRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d60-mutation-contract-live.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d60-live-gates.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D60_LIVE_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D60 live implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d60.live-implementation-manifest.v1",
		sources: measured,
	});
}
