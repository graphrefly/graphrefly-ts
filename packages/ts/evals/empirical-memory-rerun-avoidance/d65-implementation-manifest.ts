import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import {
	D64_LIVE_EXECUTION_MANIFEST_DIGEST,
	measureD64LiveExecution,
} from "./d64-live-execution-manifest.js";

export const D65_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	d64Manifest: "sha256:0c11e09b9253d0bf95ff39ecf7edee42103c08b9b00920e082328c91e0338113",
	d64BaselineFixture: "sha256:f8a64817e2f06f8ec61c88ae501840fc2b885b0827d43939ff70a61d236dfb8f",
	campaignAuthority: "sha256:b8a2661034ab483d4379ee68c1caac52b3f337d905004afbe2c02ba6e33e3cc2",
	replicateMeasurement: "sha256:1e23a8304ad4a218e6b56f58eecf2fa2876daf60eedf69fb4e27fe0c5b70c514",
	injectedReplicateExecutor:
		"sha256:7741b8dd4932d999baa37b4f257ee42ecf3248561ef94f191e2ae13ea85e4ffe",
	qualification: "sha256:66c78668b1652ccc294e7b2ad6ad9ca471987e0d94835f6f3c8aef6dcd33c873",
	qualificationRunner: "sha256:7bba566a24b383a28eaec982ce836eeab8481e01ac0f9d01e5a7d2e59e187fd0",
	test: "sha256:45e94f62f80b653e909c10ae7eeab3ed98d6b000bc9dcc08b9ae01a6f9a34cec",
});

export const D65_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d65.implementation-manifest.v1",
	d64LiveExecutionManifestDigest: D64_LIVE_EXECUTION_MANIFEST_DIGEST,
	sources: D65_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD65Implementation(): Promise<string> {
	if ((await measureD64LiveExecution()) !== D64_LIVE_EXECUTION_MANIFEST_DIGEST)
		throw new TypeError("D65 inherited D64 implementation closure drifted");
	const measured = Object.freeze({
		d64Manifest: empiricalSha256(
			await readFile(join(import.meta.dirname, "d64-live-execution-manifest.ts")),
		),
		d64BaselineFixture: empiricalSha256(
			await readFile(join(import.meta.dirname, "d65-d64-baseline-fixture.ts")),
		),
		campaignAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d65-replicated-campaign-authority.ts")),
		),
		replicateMeasurement: empiricalSha256(
			await readFile(join(import.meta.dirname, "d65-replicate-measurement.ts")),
		),
		injectedReplicateExecutor: empiricalSha256(
			await readFile(join(import.meta.dirname, "d65-injected-replicate-executor.ts")),
		),
		qualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d65-replicated-campaign-qualification.ts")),
		),
		qualificationRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d65-replicated-campaign-no-network.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d65-replicated-campaign.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D65_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D65 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d65.implementation-manifest.v1",
		d64LiveExecutionManifestDigest: D64_LIVE_EXECUTION_MANIFEST_DIGEST,
		sources: measured,
	});
}
