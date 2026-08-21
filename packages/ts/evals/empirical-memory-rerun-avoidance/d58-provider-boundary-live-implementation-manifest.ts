import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D58_LIVE_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	d44LiveGates: "sha256:39bf56f1a0364b9c1e1b1e7097e05f00f2eeab67761c100070033ee9bb6e1a8e",
	d55Manifest: "sha256:ca28c3df091a6d6e808017350ddc231018e074a2b083646c27e6f71207f42c6d",
	d58LiveGates: "sha256:1b88d8449bfcf860dbc7fb04fb06a331729e0c56c13c4a5be677b9f8851291aa",
	d58LiveRunner: "sha256:5896f2a90a66ea86159d0e9e520c37b4a6b38f2f98891c12f46d37eba9ce3c92",
	test: "sha256:5738d304db93b7ebe3fe13a3469d5f28801120f659dad8f76836100b8c5f5d3e",
});

export const D58_LIVE_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d58.live-implementation-manifest.v1",
	sources: D58_LIVE_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD58LiveImplementation(): Promise<string> {
	const measured = Object.freeze({
		d44LiveGates: empiricalSha256(
			await readFile(join(import.meta.dirname, "d44-d45-live-gates.ts")),
		),
		d55Manifest: empiricalSha256(
			await readFile(join(import.meta.dirname, "d55-provider-boundary-implementation-manifest.ts")),
		),
		d58LiveGates: empiricalSha256(
			await readFile(join(import.meta.dirname, "d58-provider-boundary-live-gates.ts")),
		),
		d58LiveRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d58-provider-boundary-live.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d58-live-gates.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D58_LIVE_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D58 live implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d58.live-implementation-manifest.v1",
		sources: measured,
	});
}
