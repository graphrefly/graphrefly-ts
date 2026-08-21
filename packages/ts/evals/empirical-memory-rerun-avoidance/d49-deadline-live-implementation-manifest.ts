import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D49_LIVE_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	d44LiveGates: "sha256:39bf56f1a0364b9c1e1b1e7097e05f00f2eeab67761c100070033ee9bb6e1a8e",
	d46Manifest: "sha256:488816db89804c5d8505ae8a3a8010ecf81faff3c51140fd6292ad3b4a7042b4",
	d49LiveGates: "sha256:0e1a7b7621e5056a38aaced0a015e7a476fbe32d2a9fde9e87602e6626783cef",
	d49LiveRunner: "sha256:46981187f38621d61930bf8fd5980090507ec878c925f1237afbd299c6cfa042",
	test: "sha256:8dcd1a42e4b507866ae62eba2b8156c821bb0160d37e87eacd3bdf2139c9e37c",
});

export const D49_LIVE_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d49.live-implementation-manifest.v1",
	sources: D49_LIVE_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD49LiveImplementation(): Promise<string> {
	const measured = Object.freeze({
		d44LiveGates: empiricalSha256(
			await readFile(join(import.meta.dirname, "d44-d45-live-gates.ts")),
		),
		d46Manifest: empiricalSha256(
			await readFile(
				join(import.meta.dirname, "d46-bounded-inspection-implementation-manifest.ts"),
			),
		),
		d49LiveGates: empiricalSha256(
			await readFile(join(import.meta.dirname, "d49-deadline-live-gates.ts")),
		),
		d49LiveRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d49-deadline-live.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d49-live-gates.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D49_LIVE_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D49 live implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d49.live-implementation-manifest.v1",
		sources: measured,
	});
}
