import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import {
	D65_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD65Implementation,
} from "./d65-implementation-manifest.js";

export const D65_QUALIFICATION_BUNDLE_DIGEST =
	"sha256:185e7ee13c731eb43edb669913ff4de9203c08d8519b1d929ff012e880ece157" as const;
export const D65_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:10b69822a456d01a68e86dd6805b8e0d093df6671475a1ab12f08af301a0a38d" as const;
export const D65_QUALIFICATION_DIGEST =
	"sha256:de21926b7b228761131d08e6af31559c98772a9c20e445471f472da9aefb1411" as const;
export const D65_QUALIFICATION_CAMPAIGN_EVIDENCE_DIGEST =
	"sha256:f248c4169cafbb97c8d93e67f0398f9a993bcb34d91bacf6a2f5f08a20600237" as const;

export const D65_LIVE_EXECUTION_SOURCE_HASHES = Object.freeze({
	claim: "sha256:8f23ea149fc4b1400aa80e4fdeaa92806295d95cae59c736a479b80fed830b38",
	liveAuthority: "sha256:2e0cce33bbfc6058058cbc3ad83ea5c9441ef9f7b6912aea28d3ac84a6def994",
	liveBundle: "sha256:ea672160b618d7116793add79ae638347ebfacf4ed9aa0571f99354a3e95cb79",
	liveQualification: "sha256:71b57dc3de4d2ec97d9eef4cca197592be2b071789f346fbd0a3782186caae89",
	liveRunner: "sha256:2ae4c1cd6daefcacd012e8f89dbd215d8a60fc546b00720f9aac0550b4930eaf",
	liveTest: "sha256:709a55a00f71d105f9124fb2dc3122637e1239931fa40ebbd6e918f67928fdf9",
});

export const D65_LIVE_EXECUTION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d65.live-execution-manifest.v1",
	d65ImplementationManifestDigest: D65_IMPLEMENTATION_MANIFEST_DIGEST,
	qualificationBundleDigest: D65_QUALIFICATION_BUNDLE_DIGEST,
	qualificationArtifactDigest: D65_QUALIFICATION_ARTIFACT_DIGEST,
	qualificationDigest: D65_QUALIFICATION_DIGEST,
	qualificationCampaignEvidenceDigest: D65_QUALIFICATION_CAMPAIGN_EVIDENCE_DIGEST,
	sources: D65_LIVE_EXECUTION_SOURCE_HASHES,
});

export async function measureD65LiveExecution(): Promise<string> {
	if ((await measureD65Implementation()) !== D65_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D65 qualified implementation closure drifted");
	const measured = Object.freeze({
		claim: empiricalSha256(await readFile(join(import.meta.dirname, "d65-live-campaign-claim.ts"))),
		liveAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d65-live-campaign-authority.ts")),
		),
		liveBundle: empiricalSha256(
			await readFile(join(import.meta.dirname, "d65-live-campaign-bundle.ts")),
		),
		liveQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d65-live-campaign-qualification.ts")),
		),
		liveRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d65-live-campaign.ts")),
		),
		liveTest: empiricalSha256(
			await readFile(
				join(
					import.meta.dirname,
					"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d65-live-campaign.test.ts",
				),
			),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(D65_LIVE_EXECUTION_SOURCE_HASHES))
		throw new TypeError("D65 live execution source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d65.live-execution-manifest.v1",
		d65ImplementationManifestDigest: D65_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationBundleDigest: D65_QUALIFICATION_BUNDLE_DIGEST,
		qualificationArtifactDigest: D65_QUALIFICATION_ARTIFACT_DIGEST,
		qualificationDigest: D65_QUALIFICATION_DIGEST,
		qualificationCampaignEvidenceDigest: D65_QUALIFICATION_CAMPAIGN_EVIDENCE_DIGEST,
		sources: measured,
	});
}
