import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import {
	D66_IMPLEMENTATION_MANIFEST_DIGEST,
	D66_QUALIFICATION_ARTIFACT_DIGEST,
	D66_QUALIFICATION_DIGEST,
	measureD66Implementation,
} from "./d66-implementation-manifest.js";

export const D67_LIVE_EXECUTION_SOURCE_HASHES = Object.freeze({
	d66Manifest: "sha256:b20e8daaf46ab39f4342bae82a3d3a0714fc972a3425f373308ccb063bee89c9",
	liveComposition: "sha256:eefa1e9dbebd09363e3ab508443673f31153a4c17380ca42eb7ffaf463680b86",
	liveGates: "sha256:8da41303d112200193eb754c4ee70d5227758bf872c2e6b3aaeea8eec4197480",
	semanticScenarios: "sha256:511f430395e27d7920b0c9bd9ea8853993f244c93563630179af1ab0bf9c8076",
	toolQualification: "sha256:17612723613e1a003cd2eae43dd34eaa9ab72db6376a161f837eba0ab361f36a",
	baselineFixture: "sha256:f8a64817e2f06f8ec61c88ae501840fc2b885b0827d43939ff70a61d236dfb8f",
	campaignAuthority: "sha256:b8a2661034ab483d4379ee68c1caac52b3f337d905004afbe2c02ba6e33e3cc2",
	replicateMeasurement: "sha256:1e23a8304ad4a218e6b56f58eecf2fa2876daf60eedf69fb4e27fe0c5b70c514",
	injectedExecutor: "sha256:7741b8dd4932d999baa37b4f257ee42ecf3248561ef94f191e2ae13ea85e4ffe",
	coreQualification: "sha256:66c78668b1652ccc294e7b2ad6ad9ca471987e0d94835f6f3c8aef6dcd33c873",
	liveAuthorityCore: "sha256:e85dea7b11ff1dc63e76057a9877adfb5571414db27748538959056a80b18346",
	claim: "sha256:44c786142781aeca28bc2741a4430bd72e2f862afc2155b319fba2e485263344",
	authorityAdapter: "sha256:3cea3591c4dbfa13cdf3b9bdd201f898ff68d5397627a537379589e7635b2ef4",
	bundle: "sha256:cf6c67cc0c22d220864070c450b759983cc68a988156efe20c3125aed6147846",
	liveQualification: "sha256:c05e337d9f16511e50b9f3e4106672db85ac961dada6dad71582b34039937ac4",
	currentKeyAdmission: "sha256:d14dd8ad79843b8327cdab521db8e67a098077feb272237c9b965a6e6ae5cc6d",
	liveRunner: "sha256:0a4ae2755b33ed292bcdc56cf4b345040e7eba5c096b78c463a9707a0262ea5f",
	liveTest: "sha256:a08a343e59212c4cc94be2fa4d6caaa53b59047a388882d9ef3ff7619a166546",
});

export const D67_LIVE_EXECUTION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d67.live-execution-manifest.v1",
	d66ImplementationManifestDigest: D66_IMPLEMENTATION_MANIFEST_DIGEST,
	qualificationArtifactDigest: D66_QUALIFICATION_ARTIFACT_DIGEST,
	qualificationDigest: D66_QUALIFICATION_DIGEST,
	sources: D67_LIVE_EXECUTION_SOURCE_HASHES,
});

export async function measureD67LiveExecution(): Promise<string> {
	if ((await measureD66Implementation()) !== D66_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D67 inherited D66 implementation closure drifted");
	const source = async (file: string) =>
		empiricalSha256(await readFile(join(import.meta.dirname, file)));
	const measured = Object.freeze({
		d66Manifest: await source("d66-implementation-manifest.ts"),
		liveComposition: await source("d44-d45-live-composition.ts"),
		liveGates: await source("d44-d45-live-gates.ts"),
		semanticScenarios: await source("d61-public-semantic-scenarios.ts"),
		toolQualification: await source("d45-graph-tool-qualification.ts"),
		baselineFixture: await source("d65-d64-baseline-fixture.ts"),
		campaignAuthority: await source("d65-replicated-campaign-authority.ts"),
		replicateMeasurement: await source("d65-replicate-measurement.ts"),
		injectedExecutor: await source("d65-injected-replicate-executor.ts"),
		coreQualification: await source("d65-replicated-campaign-qualification.ts"),
		liveAuthorityCore: await source("d65-live-campaign-authority.ts"),
		claim: await source("d67-live-campaign-claim.ts"),
		authorityAdapter: await source("d67-live-campaign-authority.ts"),
		bundle: await source("d67-live-campaign-bundle.ts"),
		liveQualification: await source("d67-live-campaign-qualification.ts"),
		currentKeyAdmission: await source("openrouter-current-key-spend-admission.ts"),
		liveRunner: await source("run-d67-live-campaign.ts"),
		liveTest: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d67-live-campaign.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D67_LIVE_EXECUTION_SOURCE_HASHES))
		throw new TypeError("D67 live execution source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d67.live-execution-manifest.v1",
		d66ImplementationManifestDigest: D66_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: D66_QUALIFICATION_ARTIFACT_DIGEST,
		qualificationDigest: D66_QUALIFICATION_DIGEST,
		sources: measured,
	});
}
