import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D46_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	policy: "sha256:c08e6377b1e8a6280325d6b99f43a201b1ae851b57a941cfe72992799797a9b9",
	lifecycleAuthority: "sha256:fe36cb8ebc0e01f1fd6288586245aaa2c6f71bf5cf7d51211641921c69e1c874",
	toolAuthority: "sha256:dc3c69fbe2bdb343a952a5d95efbe9947e444fdc56c289de1b77e925c54df87b",
	taskQualification: "sha256:7efc95aaf892f5cb8371fad5ec2217d25785a7828d0f74c1193ceb364d1f04e2",
	providerAdapter: "sha256:50e3b0bfb6d7e510303ea0ecac9ae4633859034b552d29bee382eb81690e7ed1",
	localExecutor: "sha256:7e01f5de17e97bc9e33269c3737d2c6f156df4a40edd4660b34eb518cd727ae5",
	boundedAuthority: "sha256:f60ee377465afa3824d4f4d93e20c687d3e25851ad15a76c3b28262bb641d2c3",
	composition: "sha256:5086a21ec598a74a0803ad600a32fd6b74697e7f968f425e1cfa8abc3cea4893",
	qualification: "sha256:d6e9136af87a19edd6f3e108d57ecf2c789c582736ff9b1e7b50685574de86b0",
	qualificationRunner: "sha256:ce453ba4de2528c2ff3f9a0f80f5065b8a12f73366de1e7234cc00670078352b",
	test: "sha256:f675ecb3bfa238cc5de6cef964977690fb2884fd701e87d390e24188de5200bc",
});

export const D46_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d46.implementation-manifest.v2",
	sources: D46_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD46Implementation(): Promise<string> {
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
		taskQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-graph-tool-qualification.ts")),
		),
		providerAdapter: empiricalSha256(
			await readFile(join(import.meta.dirname, "d45-mechanical-chat-adapter.ts")),
		),
		localExecutor: empiricalSha256(
			await readFile(join(import.meta.dirname, "d44-d45-live-composition.ts")),
		),
		boundedAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d46-bounded-inspection-authority.ts")),
		),
		composition: empiricalSha256(
			await readFile(join(import.meta.dirname, "d46-bounded-inspection-composition.ts")),
		),
		qualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d46-bounded-inspection-qualification.ts")),
		),
		qualificationRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "d46-bounded-inspection-qualification-runner.ts")),
		),
		test: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d46-bounded-inspection.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D46_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D46 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d46.implementation-manifest.v2",
		sources: measured,
	});
}
