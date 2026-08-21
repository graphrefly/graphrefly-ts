import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D54_LIVE_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	d44LiveGates: "sha256:39bf56f1a0364b9c1e1b1e7097e05f00f2eeab67761c100070033ee9bb6e1a8e",
	d52Manifest: "sha256:70b58b7cbebd80bce5dfde234ded531d02f080667660bfa55c22567b7baabbb4",
	d54LiveGates: "sha256:2abd9708806ecd2fee97d79d8e028665dff4b40982c33b3c39c2b429bbab16dc",
	d54LiveRunner: "sha256:c5cb41ad436f34d1482edb45907bbfdab642ae579b35a32afff8ed2d6fd041d8",
	test: "sha256:33c144739f1a4b7ffb9cbe0a61436a2a061bdb2af16c5081622608c274804a07",
});

export const D54_LIVE_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d54.live-implementation-manifest.v1",
	sources: D54_LIVE_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD54LiveImplementation(): Promise<string> {
	const measured = Object.freeze({
		d44LiveGates: empiricalSha256(
			await readFile(join(import.meta.dirname, "d44-d45-live-gates.ts")),
		),
		d52Manifest: empiricalSha256(
			await readFile(join(import.meta.dirname, "d52-task-outcome-implementation-manifest.ts")),
		),
		d54LiveGates: empiricalSha256(
			await readFile(join(import.meta.dirname, "d54-task-outcome-live-gates.ts")),
		),
		d54LiveRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d54-task-outcome-live.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d54-live-gates.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D54_LIVE_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D54 live implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d54.live-implementation-manifest.v1",
		sources: measured,
	});
}
