import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D57_LIVE_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	d44LiveGates: "sha256:39bf56f1a0364b9c1e1b1e7097e05f00f2eeab67761c100070033ee9bb6e1a8e",
	d55Manifest: "sha256:167589ab7197ca9285d0c2e7a57e94580c8137fb2c37e315bf8f1f582a73c13e",
	d57LiveGates: "sha256:2755672f829eca694368e50e01137824dcc4e0090e4f67f862bf1aabc240dfc2",
	d57LiveRunner: "sha256:e1d69a3c3dbbf558b8cc2f6abef1c1ac3d4f9d8c888d5604a0432cce5b47a5dc",
	test: "sha256:a11882105cc26fb610ed96584e2657ea5230cf00ccf184fe7edcb07b48a787c8",
});

export const D57_LIVE_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d57.live-implementation-manifest.v1",
	sources: D57_LIVE_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD57LiveImplementation(): Promise<string> {
	const measured = Object.freeze({
		d44LiveGates: empiricalSha256(
			await readFile(join(import.meta.dirname, "d44-d45-live-gates.ts")),
		),
		d55Manifest: empiricalSha256(
			await readFile(join(import.meta.dirname, "d55-provider-boundary-implementation-manifest.ts")),
		),
		d57LiveGates: empiricalSha256(
			await readFile(join(import.meta.dirname, "d57-provider-boundary-live-gates.ts")),
		),
		d57LiveRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d57-provider-boundary-live.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d57-live-gates.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D57_LIVE_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D57 live implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d57.live-implementation-manifest.v1",
		sources: measured,
	});
}
