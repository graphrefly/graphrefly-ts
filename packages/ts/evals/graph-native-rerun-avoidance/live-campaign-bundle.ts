import { constants } from "node:fs";
import { chmod, link, mkdir, open, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	type D65LiveCampaignEvidenceV1 as CurrentLiveCampaignEvidenceV1,
	type D65LivePartialCampaignEvidenceV1 as CurrentLivePartialCampaignEvidenceV1,
	validateD65LiveCampaignEvidence as validateCurrentLiveCampaignEvidence,
	validateD65LivePartialCampaignEvidence as validateCurrentLivePartialCampaignEvidence,
} from "./live-campaign-authority.js";
import {
	CURRENT_LIVE_GENERATION_REF,
	type CurrentLiveDispatchClaimV1,
	type CurrentLivePreclaimV1,
} from "./live-campaign-claim.js";
import type { D44D45PricingObservationV1, D44D45ZeroByokObservationV1 } from "./live-preflight.js";
import type { OpenRouterCurrentKeySpendAdmissionV1 } from "./openrouter-current-key-spend-admission.js";

export const CURRENT_LIVE_BUNDLE_SCHEMA = "graphrefly-ts.d71.live-campaign-bundle.v1" as const;

export type CurrentLiveCampaignBundleV1 = Readonly<{
	schemaVersion: typeof CURRENT_LIVE_BUNDLE_SCHEMA;
	generationRef: typeof CURRENT_LIVE_GENERATION_REF;
	disposition: "success" | "partial-failure";
	claimDigest: string;
	currentKeyAdmissionDigest: string;
	pricingObservationDigest: string;
	zeroByokObservationDigest: string;
	implementationCommit: string;
	implementationManifestDigest: string;
	qualificationArtifactDigest: string;
	qualificationDigest: string;
	providerCalls: number;
	graphEvidence: CurrentLiveCampaignEvidenceV1 | null;
	partialGraphEvidence: CurrentLivePartialCampaignEvidenceV1 | null;
	causalAttribution: "undetermined";
	efficacyClaim: "none" | "replicated-frozen-task-positive-differential";
	bundleDigest: string;
}>;

function assertBundleCoordinates(input: {
	readonly claim: CurrentLiveDispatchClaimV1;
	readonly preclaim: CurrentLivePreclaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
	readonly pricing: D44D45PricingObservationV1;
	readonly zeroByok: D44D45ZeroByokObservationV1;
	readonly implementationCommit: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
}): void {
	if (
		input.claim.implementationCommit !== input.implementationCommit ||
		input.claim.implementationManifestDigest !== input.implementationManifestDigest ||
		input.claim.qualificationArtifactDigest !== input.qualificationArtifactDigest ||
		input.claim.qualificationDigest !== input.qualificationDigest ||
		input.claim.preclaimDigest !== input.preclaim.preclaimDigest ||
		input.preclaim.pricingObservationDigest !== input.pricing.observationDigest ||
		input.preclaim.zeroByokObservationDigest !== input.zeroByok.observationDigest ||
		input.currentKeyAdmission.remainingMicrousd < 6_000_000 ||
		input.currentKeyAdmission.limitMicrousd !== 32_000_000
	)
		throw new TypeError("Current live bundle lost its exact claim/preflight coordinates");
}

export function constructCurrentLiveCampaignBundle(input: {
	readonly claim: CurrentLiveDispatchClaimV1;
	readonly preclaim: CurrentLivePreclaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
	readonly pricing: D44D45PricingObservationV1;
	readonly zeroByok: D44D45ZeroByokObservationV1;
	readonly implementationCommit: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly providerCalls: number;
	readonly measurement:
		| Readonly<{ disposition: "success"; evidence: CurrentLiveCampaignEvidenceV1 }>
		| Readonly<{
				disposition: "partial-failure";
				partialEvidence: CurrentLivePartialCampaignEvidenceV1;
		  }>;
}): CurrentLiveCampaignBundleV1 {
	assertBundleCoordinates(input);
	if (!Number.isSafeInteger(input.providerCalls) || input.providerCalls < 0)
		throw new TypeError("Current live provider-call reconciliation was invalid");
	const graphEvidence =
		input.measurement.disposition === "success"
			? validateCurrentLiveCampaignEvidence(input.measurement.evidence)
			: null;
	const partialGraphEvidence =
		input.measurement.disposition === "partial-failure"
			? validateCurrentLivePartialCampaignEvidence(input.measurement.partialEvidence)
			: null;
	const evidence = graphEvidence ?? partialGraphEvidence;
	const expectedProviderCalls =
		graphEvidence !== null
			? graphEvidence.campaignEvidence.continuationProviderAttempts
			: partialGraphEvidence!.partialCampaignEvidence.completedReplicates
					.filter((replicate) => replicate.source === "d65-continuation")
					.reduce((total, replicate) => total + replicate.providerAttempts, 0) +
				(partialGraphEvidence!.partialCampaignEvidence.partialReplicateEvidence?.budget
					.providerAttempts ?? 0);
	if (
		evidence?.binding.liveClaimDigest !== input.claim.claimDigest ||
		evidence.binding.preclaimDigest !== input.claim.preclaimDigest ||
		evidence.binding.currentKeyAdmissionDigest !== input.currentKeyAdmission.admissionDigest ||
		input.providerCalls !== expectedProviderCalls
	)
		throw new TypeError("Current live Graph evidence lost its claim or provider reconciliation");
	const efficacyClaim = graphEvidence?.efficacyClaim ?? "none";
	const material = strictSnapshot({
		schemaVersion: CURRENT_LIVE_BUNDLE_SCHEMA,
		generationRef: CURRENT_LIVE_GENERATION_REF,
		disposition: input.measurement.disposition,
		claimDigest: input.claim.claimDigest,
		currentKeyAdmissionDigest: input.currentKeyAdmission.admissionDigest,
		pricingObservationDigest: input.pricing.observationDigest,
		zeroByokObservationDigest: input.zeroByok.observationDigest,
		implementationCommit: input.implementationCommit,
		implementationManifestDigest: input.implementationManifestDigest,
		qualificationArtifactDigest: input.qualificationArtifactDigest,
		qualificationDigest: input.qualificationDigest,
		providerCalls: input.providerCalls,
		graphEvidence,
		partialGraphEvidence,
		causalAttribution: "undetermined" as const,
		efficacyClaim,
	});
	return Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
}

export function validateCurrentLiveCampaignBundle(value: unknown): CurrentLiveCampaignBundleV1 {
	const candidate = record(value, "Current live campaign bundle");
	exactKeys(
		candidate,
		[
			"schemaVersion",
			"generationRef",
			"disposition",
			"claimDigest",
			"currentKeyAdmissionDigest",
			"pricingObservationDigest",
			"zeroByokObservationDigest",
			"implementationCommit",
			"implementationManifestDigest",
			"qualificationArtifactDigest",
			"qualificationDigest",
			"providerCalls",
			"graphEvidence",
			"partialGraphEvidence",
			"causalAttribution",
			"efficacyClaim",
			"bundleDigest",
		],
		"Current live campaign bundle",
	);
	const suppliedDigest = String(candidate.bundleDigest);
	const { bundleDigest: _bundleDigest, ...material } = candidate;
	if (
		candidate.schemaVersion !== CURRENT_LIVE_BUNDLE_SCHEMA ||
		candidate.generationRef !== CURRENT_LIVE_GENERATION_REF ||
		empiricalStrictJsonDigest(material) !== suppliedDigest
	)
		throw new TypeError("Current live campaign bundle identity drifted");
	const graphEvidence =
		candidate.graphEvidence === null
			? null
			: validateCurrentLiveCampaignEvidence(candidate.graphEvidence);
	const partialGraphEvidence =
		candidate.partialGraphEvidence === null
			? null
			: validateCurrentLivePartialCampaignEvidence(candidate.partialGraphEvidence);
	if (
		(candidate.disposition === "success" &&
			(graphEvidence === null || partialGraphEvidence !== null)) ||
		(candidate.disposition === "partial-failure" &&
			(graphEvidence !== null || partialGraphEvidence === null)) ||
		(graphEvidence ?? partialGraphEvidence)?.binding.liveClaimDigest !== candidate.claimDigest ||
		(graphEvidence ?? partialGraphEvidence)?.binding.currentKeyAdmissionDigest !==
			candidate.currentKeyAdmissionDigest ||
		candidate.providerCalls !==
			(graphEvidence !== null
				? graphEvidence.campaignEvidence.continuationProviderAttempts
				: partialGraphEvidence!.partialCampaignEvidence.completedReplicates
						.filter((replicate) => replicate.source === "d65-continuation")
						.reduce((total, replicate) => total + replicate.providerAttempts, 0) +
					(partialGraphEvidence!.partialCampaignEvidence.partialReplicateEvidence?.budget
						.providerAttempts ?? 0)) ||
		candidate.efficacyClaim !== (graphEvidence?.efficacyClaim ?? "none") ||
		candidate.causalAttribution !== "undetermined"
	)
		throw new TypeError("Current live campaign bundle disposition or evidence drifted");
	return strictSnapshot(candidate) as unknown as CurrentLiveCampaignBundleV1;
}

export async function persistCurrentLiveCampaignBundle(input: {
	readonly privateRoot: string;
	readonly bundle: CurrentLiveCampaignBundleV1;
}): Promise<Readonly<{ artifactDigest: string; receiptDigest: string }>> {
	if (!isAbsolute(input.privateRoot))
		throw new TypeError("Current persistence root must be absolute");
	const privateRoot = resolve(input.privateRoot);
	if ((await realpath(privateRoot)) !== privateRoot)
		throw new TypeError("Current private root drifted");
	const validated = validateCurrentLiveCampaignBundle(input.bundle);
	const generationRoot = join(privateRoot, CURRENT_LIVE_GENERATION_REF);
	await mkdir(generationRoot, { mode: 0o700 });
	await chmod(generationRoot, 0o700);
	const target = join(generationRoot, "bundle.v1.json");
	const temp = join(privateRoot, `.current-live-bundle-${process.pid}.tmp`);
	const bytes = strictJsonCodec.encode(validated);
	const writer = await open(
		temp,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await writer.writeFile(bytes);
		await writer.sync();
	} finally {
		await writer.close();
	}
	try {
		await link(temp, target);
	} finally {
		await unlink(temp).catch(() => undefined);
	}
	const directory = await open(dirname(target), constants.O_RDONLY | constants.O_DIRECTORY);
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
	const reader = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const persisted = new Uint8Array(await reader.readFile());
		if (!sameBytes(persisted, bytes)) throw new TypeError("Current persisted bundle bytes drifted");
		validateCurrentLiveCampaignBundle(strictJsonCodec.decode(persisted));
	} finally {
		await reader.close();
	}
	const artifactDigest = empiricalSha256(bytes);
	return Object.freeze({
		artifactDigest,
		receiptDigest: empiricalStrictJsonDigest({
			artifactDigest,
			bundleDigest: validated.bundleDigest,
		}),
	});
}
