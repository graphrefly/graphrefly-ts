import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D47_LIVE_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	d44LiveGates: "sha256:39bf56f1a0364b9c1e1b1e7097e05f00f2eeab67761c100070033ee9bb6e1a8e",
	d46Manifest: "sha256:1ec5bf072abed50461c90624eea4bb5c4fd7307f27d3210a5a681bba00818df4",
	d47LiveGates: "sha256:9be8193d6f9a823c17156ee637d2894204fd5f001d9645f47fe3b41ea883775f",
	d47LiveRunner: "sha256:50b71af80115835de02839846de288b23057045c925c7302ec846710edb3a158",
	test: "sha256:1f0e859c58829f5934c7fbf1873b3b4e06c2af6b910b4d0e00881efe99beba4f",
});

export const D47_LIVE_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d47.live-implementation-manifest.v1",
	sources: D47_LIVE_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD47LiveImplementation(): Promise<string> {
	const measured = Object.freeze({
		d44LiveGates: empiricalSha256(
			await readFile(join(import.meta.dirname, "d44-d45-live-gates.ts")),
		),
		d46Manifest: empiricalSha256(
			await readFile(
				join(import.meta.dirname, "d46-bounded-inspection-implementation-manifest.ts"),
			),
		),
		d47LiveGates: empiricalSha256(
			await readFile(join(import.meta.dirname, "d47-bounded-inspection-live-gates.ts")),
		),
		d47LiveRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d47-bounded-inspection-live.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d47-live-gates.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D47_LIVE_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D47 live implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d47.live-implementation-manifest.v1",
		sources: measured,
	});
}
