import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D59_LIVE_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	d44LiveGates: "sha256:39bf56f1a0364b9c1e1b1e7097e05f00f2eeab67761c100070033ee9bb6e1a8e",
	d55Manifest: "sha256:1227ca2b8bc121a89b3f5c14a1d3acb11b9d5655d44d57a362d2e559810be146",
	d59LiveGates: "sha256:d9eb0b95620e60f3bc7c8460f8e169f15eac5bfc906600ec8fa573918536f1d0",
	d59LiveRunner: "sha256:17e6a21180d1568511ec9648690a4645407edcaa6ccce7419488f7f3bf72213d",
	test: "sha256:d68cde9ee6ef49f3f852e47485621d1053c79d44edd47844c225fbb5903229c6",
});

export const D59_LIVE_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d59.live-implementation-manifest.v1",
	sources: D59_LIVE_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD59LiveImplementation(): Promise<string> {
	const measured = Object.freeze({
		d44LiveGates: empiricalSha256(
			await readFile(join(import.meta.dirname, "d44-d45-live-gates.ts")),
		),
		d55Manifest: empiricalSha256(
			await readFile(join(import.meta.dirname, "d55-provider-boundary-implementation-manifest.ts")),
		),
		d59LiveGates: empiricalSha256(
			await readFile(join(import.meta.dirname, "d59-semantic-correction-live-gates.ts")),
		),
		d59LiveRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d59-semantic-correction-live.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d59-live-gates.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D59_LIVE_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D59 live implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d59.live-implementation-manifest.v1",
		sources: measured,
	});
}
