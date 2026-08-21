import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D51_LIVE_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	d44LiveGates: "sha256:39bf56f1a0364b9c1e1b1e7097e05f00f2eeab67761c100070033ee9bb6e1a8e",
	d46Manifest: "sha256:780fca2433aca59b5abe102d13631951d8e8f64fd14fe1089d4d8a321ef7480b",
	d51LiveGates: "sha256:a84e5f4adaf5c1f8ee0919df54fa8fbe113187424ad8d7054c2843acf7481fdc",
	d51LiveRunner: "sha256:08a940d6e1a3cd4f4ab3dc3520c052c7a68d12bd1a1b5eee4a95e865cf4a5317",
	test: "sha256:fea4901b0f1f33717b6d11479c473c41fd943925f953d88bf33859b247a032ed",
});

export const D51_LIVE_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d51.live-implementation-manifest.v1",
	sources: D51_LIVE_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD51LiveImplementation(): Promise<string> {
	const measured = Object.freeze({
		d44LiveGates: empiricalSha256(
			await readFile(join(import.meta.dirname, "d44-d45-live-gates.ts")),
		),
		d46Manifest: empiricalSha256(
			await readFile(
				join(import.meta.dirname, "d46-bounded-inspection-implementation-manifest.ts"),
			),
		),
		d51LiveGates: empiricalSha256(
			await readFile(join(import.meta.dirname, "d51-phase-composite-live-gates.ts")),
		),
		d51LiveRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d51-phase-composite-live.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d51-live-gates.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D51_LIVE_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D51 live implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d51.live-implementation-manifest.v1",
		sources: measured,
	});
}
