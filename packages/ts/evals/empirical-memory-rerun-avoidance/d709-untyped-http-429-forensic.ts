import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	assertCanonicalBytes,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	strictSnapshot,
} from "./canonical.js";
import {
	commitD696PrivateStagingDirectory,
	failD696PrivateStagingGeneration,
} from "./d696-continuation-assisted-live.js";
import {
	createD708Scorecard,
	D708_GENERATION_SCHEMA,
	D708_PRIVATE_PERSISTENCE_ROOT,
	D708_SCORECARD_SCHEMA,
	type D708MutationFirstObservationV1,
	validateD708Observation,
} from "./d708-fresh-pricing-live.js";
import { D708_LIVE_ATTEMPT_RECEIPT_SCHEMA } from "./d708-live-attempt-receipt.js";
import { D708_LIVE_GENERATION_REF } from "./d708-single-use-dispatch-claim.js";
import {
	assertSafePrivateRoot,
	syncDirectory,
	writePrivateFile,
} from "./private-smoke-persistence.js";

export const D709_FORENSIC_SCHEMA =
	"graphrefly.private-solution-eval.untyped-http-429-before-treatment-forensic.v1" as const;
export const D709_SCORECARD_SCHEMA =
	"graphrefly.private-solution-eval.untyped-http-429-before-treatment-forensic-scorecard.v1" as const;
export const D709_GENERATION_SCHEMA =
	"graphrefly.private-solution-eval.untyped-http-429-before-treatment-forensic-generation.v1" as const;
export const D709_AUTHORITY_REF = "decision.D709" as const;
export const D709_AUTHORITY_REVISION = "decision.D709.2026-08-09.v1" as const;
export const D709_CLAIM_BOUNDARY =
	"exact-d708-untyped-http-429-before-d695-d702-no-efficacy-claim" as const;
export const D709_PRIVATE_GENERATION_REF =
	"d709-d708-untyped-http-429-before-treatment-forensic-2026-08-09-v1" as const;
export const D709_PRIVATE_PERSISTENCE_ROOT = D708_PRIVATE_PERSISTENCE_ROOT;

export const D709_D708_OBSERVATION_ARTIFACT_DIGEST =
	"sha256:b8129d5788a95184b88f0bdcfe41b051531d468bee152c49a8d0df049c72c02e" as const;
export const D709_D708_SCORECARD_ARTIFACT_DIGEST =
	"sha256:e938987a3fa7164439b9f4c74c3272bdaaece209fc3e973919263f61bed00f5c" as const;
export const D709_D708_GENERATION_ARTIFACT_DIGEST =
	"sha256:b61cff44bf3d939149eb8b3195749ec9268e19a07eb275fd414f0ec53998772f" as const;
export const D709_D708_TERMINAL_RECEIPT_ARTIFACT_DIGEST =
	"sha256:71a7b047b1cee9fe551b53436f0ff81e0ef075d3804e73a9b6cce923216d881b" as const;
export const D709_D708_OBSERVATION_DIGEST =
	"sha256:69487005324bd6bbac61aa9f501ab0015a884a14d5594b38695dada400fd8307" as const;
export const D709_D708_SCORECARD_DIGEST =
	"sha256:c2f651a73e94614ad4f79733c543626e8a191330b68b36068dec6cd1d6d41ee3" as const;
export const D709_D708_GENERATION_DIGEST =
	"sha256:0394ce81bf200cd79de874a9a8235767074193e68bdf06c6f280fdc37b5bab06" as const;
export const D709_D708_TERMINAL_RECEIPT_DIGEST =
	"sha256:f50811317f7c4642cdd0b16ade0563118c48117786fbdce9f7c065d85aeb555d" as const;
export const D709_QUALIFIED_FORENSIC_DIGEST =
	"sha256:59d541f33db5e35161c9a2897d44d81b8120dd1f10f82726afdade7ac1414b3a" as const;
export const D709_QUALIFIED_SCORECARD_DIGEST =
	"sha256:343e0ec1e3a0727cd6ac724222d658f5a4ef6dee56c1938357a3522f225388c1" as const;
export const D709_QUALIFIED_GENERATION_DIGEST =
	"sha256:35c66ae46fd4a29fd8c5b6ba9e663017643186678d3d1986beb1e4fb03564af7" as const;
export const D709_QUALIFIED_FORENSIC_ARTIFACT_DIGEST =
	"sha256:62256582f547a8215e57de52a7f6ff99637dd405a3d3a4892f781003a2211caf" as const;
export const D709_QUALIFIED_SCORECARD_ARTIFACT_DIGEST =
	"sha256:14829a894e2f33a78213fc264488fbe91ffbad72633894e871defe440407f49c" as const;
export const D709_QUALIFIED_GENERATION_ARTIFACT_DIGEST =
	"sha256:4c81bb81ef7f37425ace4b52ccdfe6fad7234756c498fa9d25106e0ae8f9ee7a" as const;

export interface D709D708ArtifactBytesV1 {
	readonly observationBytes: Uint8Array;
	readonly scorecardBytes: Uint8Array;
	readonly generationBytes: Uint8Array;
	readonly terminalReceiptBytes: Uint8Array;
}

export interface D709QualifiedArtifactBytesV1 {
	readonly forensicBytes: Uint8Array;
	readonly scorecardBytes: Uint8Array;
	readonly generationBytes: Uint8Array;
}

interface D709ValidatedD708ArtifactsV1 {
	readonly observation: D708MutationFirstObservationV1;
	readonly artifactDigests: {
		readonly observation: typeof D709_D708_OBSERVATION_ARTIFACT_DIGEST;
		readonly scorecard: typeof D709_D708_SCORECARD_ARTIFACT_DIGEST;
		readonly generation: typeof D709_D708_GENERATION_ARTIFACT_DIGEST;
		readonly terminalReceipt: typeof D709_D708_TERMINAL_RECEIPT_ARTIFACT_DIGEST;
	};
}

export interface D709UntypedHttp429ForensicV1 {
	readonly schemaVersion: typeof D709_FORENSIC_SCHEMA;
	readonly authorityRef: typeof D709_AUTHORITY_REF;
	readonly authorityRevision: typeof D709_AUTHORITY_REVISION;
	readonly claimBoundary: typeof D709_CLAIM_BOUNDARY;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly sourceArtifacts: {
		readonly observationArtifactDigest: typeof D709_D708_OBSERVATION_ARTIFACT_DIGEST;
		readonly observationDigest: typeof D709_D708_OBSERVATION_DIGEST;
		readonly scorecardArtifactDigest: typeof D709_D708_SCORECARD_ARTIFACT_DIGEST;
		readonly scorecardDigest: typeof D709_D708_SCORECARD_DIGEST;
		readonly generationArtifactDigest: typeof D709_D708_GENERATION_ARTIFACT_DIGEST;
		readonly generationDigest: typeof D709_D708_GENERATION_DIGEST;
		readonly terminalReceiptArtifactDigest: typeof D709_D708_TERMINAL_RECEIPT_ARTIFACT_DIGEST;
		readonly terminalReceiptDigest: typeof D709_D708_TERMINAL_RECEIPT_DIGEST;
	};
	readonly terminalClassification: "untyped-http-429-before-treatment";
	readonly firstTurnReadFileActions: 4;
	readonly ordinaryContinuationRequestOrdinal: 2;
	readonly requestCount: 2;
	readonly attemptCount: 2;
	readonly httpStatus: 429;
	readonly quotaRateLimitIssuePresent: true;
	readonly recognizedRateLimitTypePresent: false;
	readonly recognizedRateLimitCodePresent: false;
	readonly parsedRetryAfterPresent: false;
	readonly historicalRetryAfterPresence: "not-observable-in-d708-v1";
	readonly d671RetryAdmission: false;
	readonly retryWaitCalls: 0;
	readonly d695ContinuationExposure: false;
	readonly d702MutationFirstExposure: false;
	readonly mutationActions: 0;
	readonly diffActions: 0;
	readonly focusedValidationReceipts: 0;
	readonly hiddenVerifierRuns: 0;
	readonly warmArmsAttempted: 0;
	readonly warmArmsUnattempted: 5;
	readonly costBasis: "conservative-reservation";
	readonly recordedCostMicrousd: 34_753;
	readonly confirmedProviderBilling: false;
	readonly forensicDigest: string;
}

export interface D709UntypedHttp429ForensicScorecardV1 {
	readonly schemaVersion: typeof D709_SCORECARD_SCHEMA;
	readonly claimBoundary: typeof D709_CLAIM_BOUNDARY;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly forensicDigests: readonly [string];
	readonly attemptedBlocks: 1;
	readonly evaluablePairs: 0;
	readonly treatmentExposures: 0;
	readonly retryAdmissions: 0;
	readonly status: "complete-pre-treatment-untyped-429-forensic";
	readonly scorecardDigest: string;
}

function capturedBytes(value: unknown): D709D708ArtifactBytesV1 {
	const candidate = record(value, "d709.sourceArtifacts");
	exactKeys(
		candidate,
		["generationBytes", "observationBytes", "scorecardBytes", "terminalReceiptBytes"],
		"d709.sourceArtifacts",
	);
	const copy = (key: keyof D709D708ArtifactBytesV1, max: number): Uint8Array => {
		const raw = candidate[key];
		if (!(raw instanceof Uint8Array) || Object.getPrototypeOf(raw) !== Uint8Array.prototype) {
			throw new TypeError(`d709.sourceArtifacts.${key}: expected plain bytes`);
		}
		const bytes = new Uint8Array(raw);
		if (bytes.byteLength === 0 || bytes.byteLength > max) {
			throw new TypeError(`d709.sourceArtifacts.${key}: byte bound exceeded`);
		}
		return bytes;
	};
	return Object.freeze({
		observationBytes: copy("observationBytes", 1_048_576),
		scorecardBytes: copy("scorecardBytes", 16_384),
		generationBytes: copy("generationBytes", 16_384),
		terminalReceiptBytes: copy("terminalReceiptBytes", 16_384),
	});
}

function validateD708Scorecard(value: unknown, observation: D708MutationFirstObservationV1): void {
	const candidate = record(value, "d709.d708.scorecard");
	literal(candidate.schemaVersion, D708_SCORECARD_SCHEMA, "d709.d708.scorecard.schema");
	const expected = createD708Scorecard(observation);
	if (empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(expected)) {
		throw new TypeError("D709 D708 scorecard is not the exact observation projection");
	}
	literal(candidate.scorecardDigest, D709_D708_SCORECARD_DIGEST, "d709.d708.scorecard.digest");
}

function validateD708Generation(value: unknown): void {
	const candidate = record(value, "d709.d708.generation");
	exactKeys(
		candidate,
		[
			"causalAttribution",
			"claimBoundary",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"observation",
			"schemaVersion",
			"scorecard",
		],
		"d709.d708.generation",
	);
	literal(candidate.schemaVersion, D708_GENERATION_SCHEMA, "d709.d708.generation.schema");
	literal(candidate.generationRef, D708_LIVE_GENERATION_REF, "d709.d708.generation.ref");
	literal(candidate.causalAttribution, "undetermined", "d709.d708.generation.attribution");
	literal(candidate.efficacyClaim, "none", "d709.d708.generation.efficacy");
	for (const [key, file, expectedDigest] of [
		["observation", "fresh-pricing-live-observation.v1.json", D709_D708_OBSERVATION_DIGEST],
		["scorecard", "fresh-pricing-live-scorecard.v1.json", D709_D708_SCORECARD_DIGEST],
	] as const) {
		const ref = record(candidate[key], `d709.d708.generation.${key}`);
		exactKeys(ref, ["digest", "file"], `d709.d708.generation.${key}`);
		literal(ref.file, file, `d709.d708.generation.${key}.file`);
		literal(ref.digest, expectedDigest, `d709.d708.generation.${key}.digest`);
	}
	const generationDigest = digest(candidate.generationDigest, "d709.d708.generation.digest");
	const { generationDigest: _ignored, ...material } = candidate;
	literal(generationDigest, empiricalStrictJsonDigest(material), "d709.d708.generation.binding");
	literal(generationDigest, D709_D708_GENERATION_DIGEST, "d709.d708.generation.frozen");
}

function validateD708TerminalReceipt(
	value: unknown,
	observation: D708MutationFirstObservationV1,
): void {
	const candidate = record(value, "d709.d708.terminalReceipt");
	exactKeys(
		candidate,
		[
			"causalAttribution",
			"claimDigest",
			"currentKeyAdmissionDigest",
			"currentKeyNetworkCalls",
			"currentKeyRemainingMicrousd",
			"currentKeyUsageMicrousd",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"failureClass",
			"officialPricingNetworkCalls",
			"providerTransportCalls",
			"providerUsageEvidence",
			"receiptDigest",
			"schemaVersion",
			"terminalPhase",
			"terminalStatus",
		],
		"d709.d708.terminalReceipt",
	);
	literal(candidate.schemaVersion, D708_LIVE_ATTEMPT_RECEIPT_SCHEMA, "d709.receipt.schema");
	literal(candidate.decisionRef, "decision.D708", "d709.receipt.decisionRef");
	literal(candidate.decisionRevision, "decision.D708.2026-08-09.v1", "d709.receipt.revision");
	literal(candidate.terminalStatus, "success", "d709.receipt.status");
	literal(candidate.terminalPhase, "generation-persistence", "d709.receipt.phase");
	literal(candidate.failureClass, "none", "d709.receipt.failureClass");
	literal(candidate.officialPricingNetworkCalls, 1, "d709.receipt.pricingCalls");
	literal(candidate.currentKeyNetworkCalls, 1, "d709.receipt.currentKeyCalls");
	literal(candidate.providerUsageEvidence, "complete-generation", "d709.receipt.usageEvidence");
	literal(candidate.causalAttribution, "undetermined", "d709.receipt.attribution");
	literal(candidate.efficacyClaim, "none", "d709.receipt.efficacy");
	literal(candidate.claimDigest, observation.dispatchClaimDigest, "d709.receipt.claim");
	literal(
		candidate.currentKeyAdmissionDigest,
		observation.currentKeyAdmissionDigest,
		"d709.receipt.currentKeyDigest",
	);
	literal(
		candidate.currentKeyRemainingMicrousd,
		observation.currentKeyRemainingMicrousd,
		"d709.receipt.currentKeyRemaining",
	);
	literal(
		candidate.currentKeyUsageMicrousd,
		observation.currentKeyUsageMicrousd,
		"d709.receipt.currentKeyUsage",
	);
	literal(
		candidate.providerTransportCalls,
		observation.transportCalls,
		"d709.receipt.transportCalls",
	);
	const receiptDigest = digest(candidate.receiptDigest, "d709.receipt.digest");
	const { receiptDigest: _ignored, ...material } = candidate;
	literal(receiptDigest, empiricalStrictJsonDigest(material), "d709.receipt.binding");
	literal(receiptDigest, D709_D708_TERMINAL_RECEIPT_DIGEST, "d709.receipt.frozen");
}

export function validateD709D708ArtifactBytes(value: unknown): D709ValidatedD708ArtifactsV1 {
	const bytes = capturedBytes(value);
	for (const [key, expected] of [
		["observationBytes", D709_D708_OBSERVATION_ARTIFACT_DIGEST],
		["scorecardBytes", D709_D708_SCORECARD_ARTIFACT_DIGEST],
		["generationBytes", D709_D708_GENERATION_ARTIFACT_DIGEST],
		["terminalReceiptBytes", D709_D708_TERMINAL_RECEIPT_ARTIFACT_DIGEST],
	] as const) {
		literal(empiricalSha256(bytes[key]), expected, `d709.sourceArtifacts.${key}.digest`);
	}
	const observationDecoded = strictJsonCodec.decode(bytes.observationBytes);
	assertCanonicalBytes(observationDecoded, bytes.observationBytes, "d709.d708.observation");
	const observation = validateD708Observation(observationDecoded);
	literal(
		observation.observationDigest,
		D709_D708_OBSERVATION_DIGEST,
		"d709.d708.observation.digest",
	);
	const scorecardDecoded = strictJsonCodec.decode(bytes.scorecardBytes);
	assertCanonicalBytes(scorecardDecoded, bytes.scorecardBytes, "d709.d708.scorecard");
	validateD708Scorecard(scorecardDecoded, observation);
	const generationDecoded = strictJsonCodec.decode(bytes.generationBytes);
	assertCanonicalBytes(generationDecoded, bytes.generationBytes, "d709.d708.generation");
	validateD708Generation(generationDecoded);
	const receiptDecoded = strictJsonCodec.decode(bytes.terminalReceiptBytes);
	assertCanonicalBytes(receiptDecoded, bytes.terminalReceiptBytes, "d709.d708.terminalReceipt");
	validateD708TerminalReceipt(receiptDecoded, observation);
	return Object.freeze({
		observation,
		artifactDigests: Object.freeze({
			observation: D709_D708_OBSERVATION_ARTIFACT_DIGEST,
			scorecard: D709_D708_SCORECARD_ARTIFACT_DIGEST,
			generation: D709_D708_GENERATION_ARTIFACT_DIGEST,
			terminalReceipt: D709_D708_TERMINAL_RECEIPT_ARTIFACT_DIGEST,
		}),
	});
}

function countTool(observation: D708MutationFirstObservationV1, suffix: string): number {
	return observation.underlying.cold.actionTrace.filter((action) => action.toolRef.endsWith(suffix))
		.length;
}

export function createD709UntypedHttp429Forensic(
	value: D709D708ArtifactBytesV1,
): D709UntypedHttp429ForensicV1 {
	const source = validateD709D708ArtifactBytes(value);
	const observation = source.observation;
	const cold = observation.underlying.cold;
	if (
		cold.classification !== "non-evaluable" ||
		cold.requests !== 2 ||
		cold.attempts !== 2 ||
		cold.steps !== 2 ||
		cold.actionTrace.length !== 4 ||
		cold.actionTrace.some(
			(action, index) =>
				action.stepIndex !== 0 ||
				action.actionIndex !== index ||
				!action.toolRef.endsWith(".read-file.v1"),
		) ||
		cold.attemptTrace.length !== 2 ||
		cold.attemptTrace[0]?.status !== "completed" ||
		cold.attemptTrace[1]?.status !== "non-evaluable" ||
		cold.attemptTrace[1]?.stepIndex !== 1 ||
		cold.attemptTrace[1]?.attemptOrdinal !== 1 ||
		!cold.attemptTrace[1]?.issueCodes.includes("openrouter-http-status:429") ||
		!cold.attemptTrace[1]?.issueCodes.includes("openrouter-quota-rate-limit") ||
		cold.attemptTrace[1]?.issueCodes.some(
			(issue) =>
				issue === "openrouter-error-type:rate_limit_exceeded" ||
				issue === "openrouter-error-code:rate_limit_exceeded" ||
				issue.startsWith("openrouter-retry-after-ms:"),
		) ||
		cold.retryWaitTrace.length !== 0 ||
		observation.retryWaitCalls !== 0 ||
		observation.continuationInvocations.length !== 0 ||
		observation.mutationFirstInvocations.length !== 0 ||
		observation.noProgressReceipts.length !== 0 ||
		observation.focusedValidationReceipts.length !== 0 ||
		observation.underlying.warmBranches.some((branch) => branch.attempted) ||
		observation.underlying.result.warmRunsAttempted !== 0 ||
		cold.verifierStatus !== "not-run" ||
		cold.costBasis !== "conservative-reservation" ||
		cold.costMicrousd !== 34_753
	) {
		throw new TypeError("D709 source no longer matches the exact pre-treatment untyped-429 trace");
	}
	if (
		countTool(observation, ".replace-exact.v1") !== 0 ||
		countTool(observation, ".workspace-diff.v1") !== 0 ||
		countTool(observation, ".run-command.v1") !== 0
	) {
		throw new TypeError("D709 source unexpectedly contains objective-progress actions");
	}
	const material = strictSnapshot({
		schemaVersion: D709_FORENSIC_SCHEMA,
		authorityRef: D709_AUTHORITY_REF,
		authorityRevision: D709_AUTHORITY_REVISION,
		claimBoundary: D709_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		sourceArtifacts: {
			observationArtifactDigest: source.artifactDigests.observation,
			observationDigest: D709_D708_OBSERVATION_DIGEST,
			scorecardArtifactDigest: source.artifactDigests.scorecard,
			scorecardDigest: D709_D708_SCORECARD_DIGEST,
			generationArtifactDigest: source.artifactDigests.generation,
			generationDigest: D709_D708_GENERATION_DIGEST,
			terminalReceiptArtifactDigest: source.artifactDigests.terminalReceipt,
			terminalReceiptDigest: D709_D708_TERMINAL_RECEIPT_DIGEST,
		},
		terminalClassification: "untyped-http-429-before-treatment" as const,
		firstTurnReadFileActions: 4 as const,
		ordinaryContinuationRequestOrdinal: 2 as const,
		requestCount: 2 as const,
		attemptCount: 2 as const,
		httpStatus: 429 as const,
		quotaRateLimitIssuePresent: true as const,
		recognizedRateLimitTypePresent: false as const,
		recognizedRateLimitCodePresent: false as const,
		parsedRetryAfterPresent: false as const,
		historicalRetryAfterPresence: "not-observable-in-d708-v1" as const,
		d671RetryAdmission: false as const,
		retryWaitCalls: 0 as const,
		d695ContinuationExposure: false as const,
		d702MutationFirstExposure: false as const,
		mutationActions: 0 as const,
		diffActions: 0 as const,
		focusedValidationReceipts: 0 as const,
		hiddenVerifierRuns: 0 as const,
		warmArmsAttempted: 0 as const,
		warmArmsUnattempted: 5 as const,
		costBasis: "conservative-reservation" as const,
		recordedCostMicrousd: 34_753 as const,
		confirmedProviderBilling: false as const,
	});
	const forensicDigest = empiricalStrictJsonDigest(material);
	literal(forensicDigest, D709_QUALIFIED_FORENSIC_DIGEST, "d709.forensic.qualifiedDigest");
	return strictSnapshot({ ...material, forensicDigest });
}

export function validateD709UntypedHttp429Forensic(
	value: unknown,
	sourceBytes: D709D708ArtifactBytesV1,
): D709UntypedHttp429ForensicV1 {
	const candidate = record(value, "d709.forensic");
	const expected = createD709UntypedHttp429Forensic(sourceBytes);
	if (empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(expected)) {
		throw new TypeError("D709 forensic is not the exact canonical D708 projection");
	}
	return expected;
}

export function createD709UntypedHttp429ForensicScorecard(
	forensic: D709UntypedHttp429ForensicV1,
	sourceBytes: D709D708ArtifactBytesV1,
): D709UntypedHttp429ForensicScorecardV1 {
	const validatedForensic = validateD709UntypedHttp429Forensic(forensic, sourceBytes);
	const material = strictSnapshot({
		schemaVersion: D709_SCORECARD_SCHEMA,
		claimBoundary: D709_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		forensicDigests: [validatedForensic.forensicDigest] as const,
		attemptedBlocks: 1 as const,
		evaluablePairs: 0 as const,
		treatmentExposures: 0 as const,
		retryAdmissions: 0 as const,
		status: "complete-pre-treatment-untyped-429-forensic" as const,
	});
	const scorecardDigest = empiricalStrictJsonDigest(material);
	literal(scorecardDigest, D709_QUALIFIED_SCORECARD_DIGEST, "d709.scorecard.qualifiedDigest");
	return strictSnapshot({ ...material, scorecardDigest });
}

export function validateD709UntypedHttp429ForensicScorecard(
	value: unknown,
	forensic: D709UntypedHttp429ForensicV1,
	sourceBytes: D709D708ArtifactBytesV1,
): D709UntypedHttp429ForensicScorecardV1 {
	const candidate = record(value, "d709.scorecard");
	const expected = createD709UntypedHttp429ForensicScorecard(forensic, sourceBytes);
	if (empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(expected)) {
		throw new TypeError("D709 scorecard is not the exact forensic projection");
	}
	return expected;
}

export async function persistD709PrivateGeneration(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly sourceArtifacts: D709D708ArtifactBytesV1;
}): Promise<{
	readonly generationPath: string;
	readonly forensicDigest: string;
	readonly scorecardDigest: string;
	readonly generationDigest: string;
}> {
	const request = record(input, "d709.persistence");
	exactKeys(request, ["generationRef", "privateRoot", "sourceArtifacts"], "d709.persistence");
	const generationRef = literal(
		request.generationRef,
		D709_PRIVATE_GENERATION_REF,
		"d709.persistence.generationRef",
	);
	const privateRoot = await assertSafePrivateRoot(D709_PRIVATE_PERSISTENCE_ROOT);
	if (request.privateRoot !== privateRoot) throw new TypeError("D709 persistence root drifted");
	const forensic = createD709UntypedHttp429Forensic(
		request.sourceArtifacts as D709D708ArtifactBytesV1,
	);
	const scorecard = createD709UntypedHttp429ForensicScorecard(
		forensic,
		request.sourceArtifacts as D709D708ArtifactBytesV1,
	);
	const generationMaterial = strictSnapshot({
		schemaVersion: D709_GENERATION_SCHEMA,
		generationRef,
		claimBoundary: D709_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		forensic: {
			file: "untyped-http-429-before-treatment-forensic.v1.json",
			digest: forensic.forensicDigest,
		},
		scorecard: {
			file: "untyped-http-429-before-treatment-forensic-scorecard.v1.json",
			digest: scorecard.scorecardDigest,
		},
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	literal(
		generation.generationDigest,
		D709_QUALIFIED_GENERATION_DIGEST,
		"d709.generation.qualifiedDigest",
	);
	const finalPath = join(privateRoot, generationRef);
	try {
		await lstat(finalPath);
		throw new TypeError("D709 generation already exists");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const stagingPath = join(privateRoot, `.d709-staging-${randomUUID()}`);
	const files = Object.freeze([
		{
			file: "untyped-http-429-before-treatment-forensic.v1.json",
			bytes: strictJsonCodec.encode(forensic),
		},
		{
			file: "untyped-http-429-before-treatment-forensic-scorecard.v1.json",
			bytes: strictJsonCodec.encode(scorecard),
		},
		{ file: "generation.v1.json", bytes: strictJsonCodec.encode(generation) },
	]);
	try {
		await mkdir(stagingPath, { mode: 0o700 });
		for (const file of files) await writePrivateFile(join(stagingPath, file.file), file.bytes);
		await syncDirectory(stagingPath);
		for (const file of files) {
			const persisted = new Uint8Array(await readFile(join(stagingPath, file.file)));
			if (!Buffer.from(persisted).equals(file.bytes)) {
				throw new TypeError(`D709 staging readback failed for ${file.file}`);
			}
		}
		await commitD696PrivateStagingDirectory({ stagingPath, finalPath, privateRoot });
		return Object.freeze({
			generationPath: finalPath,
			forensicDigest: forensic.forensicDigest,
			scorecardDigest: scorecard.scorecardDigest,
			generationDigest: generation.generationDigest,
		});
	} catch (error) {
		return failD696PrivateStagingGeneration(stagingPath, error);
	}
}

export function validateD709ForensicArtifact(value: unknown): D709UntypedHttp429ForensicV1 {
	const candidate = record(value, "d709.persistedForensic");
	literal(candidate.schemaVersion, D709_FORENSIC_SCHEMA, "d709.persistedForensic.schema");
	literal(candidate.authorityRef, D709_AUTHORITY_REF, "d709.persistedForensic.authority");
	literal(candidate.authorityRevision, D709_AUTHORITY_REVISION, "d709.persistedForensic.revision");
	literal(candidate.claimBoundary, D709_CLAIM_BOUNDARY, "d709.persistedForensic.claim");
	literal(candidate.causalAttribution, "undetermined", "d709.persistedForensic.attribution");
	literal(candidate.efficacyClaim, "none", "d709.persistedForensic.efficacy");
	const forensicDigest = digest(candidate.forensicDigest, "d709.persistedForensic.digest");
	const { forensicDigest: _ignored, ...material } = candidate;
	literal(forensicDigest, empiricalStrictJsonDigest(material), "d709.persistedForensic.binding");
	literal(forensicDigest, D709_QUALIFIED_FORENSIC_DIGEST, "d709.persistedForensic.qualified");
	return strictSnapshot(candidate) as unknown as D709UntypedHttp429ForensicV1;
}

export function validateD709GenerationArtifact(value: unknown): string {
	const candidate = record(value, "d709.persistedGeneration");
	exactKeys(
		candidate,
		[
			"causalAttribution",
			"claimBoundary",
			"efficacyClaim",
			"forensic",
			"generationDigest",
			"generationRef",
			"schemaVersion",
			"scorecard",
		],
		"d709.persistedGeneration",
	);
	literal(candidate.schemaVersion, D709_GENERATION_SCHEMA, "d709.persistedGeneration.schema");
	literal(candidate.generationRef, D709_PRIVATE_GENERATION_REF, "d709.persistedGeneration.ref");
	literal(candidate.claimBoundary, D709_CLAIM_BOUNDARY, "d709.persistedGeneration.claim");
	literal(candidate.causalAttribution, "undetermined", "d709.persistedGeneration.attribution");
	literal(candidate.efficacyClaim, "none", "d709.persistedGeneration.efficacy");
	for (const [key, file, expectedDigest] of [
		[
			"forensic",
			"untyped-http-429-before-treatment-forensic.v1.json",
			D709_QUALIFIED_FORENSIC_DIGEST,
		],
		[
			"scorecard",
			"untyped-http-429-before-treatment-forensic-scorecard.v1.json",
			D709_QUALIFIED_SCORECARD_DIGEST,
		],
	] as const) {
		const ref = record(candidate[key], `d709.persistedGeneration.${key}`);
		exactKeys(ref, ["digest", "file"], `d709.persistedGeneration.${key}`);
		literal(ref.file, file, `d709.persistedGeneration.${key}.file`);
		literal(
			digest(ref.digest, `d709.persistedGeneration.${key}.digest`),
			expectedDigest,
			`d709.persistedGeneration.${key}.qualifiedDigest`,
		);
	}
	const generationDigest = digest(candidate.generationDigest, "d709.persistedGeneration.digest");
	const { generationDigest: _ignored, ...material } = candidate;
	literal(
		generationDigest,
		empiricalStrictJsonDigest(material),
		"d709.persistedGeneration.binding",
	);
	literal(generationDigest, D709_QUALIFIED_GENERATION_DIGEST, "d709.persistedGeneration.qualified");
	return generationDigest;
}

export function validateD709QualifiedArtifactBytes(input: {
	readonly sourceArtifacts: D709D708ArtifactBytesV1;
	readonly qualifiedArtifacts: D709QualifiedArtifactBytesV1;
}): Readonly<{
	readonly forensicDigest: typeof D709_QUALIFIED_FORENSIC_DIGEST;
	readonly scorecardDigest: typeof D709_QUALIFIED_SCORECARD_DIGEST;
	readonly generationDigest: typeof D709_QUALIFIED_GENERATION_DIGEST;
}> {
	const candidate = record(input, "d709.qualifiedArtifactsInput");
	exactKeys(candidate, ["qualifiedArtifacts", "sourceArtifacts"], "d709.qualifiedArtifactsInput");
	const artifacts = record(candidate.qualifiedArtifacts, "d709.qualifiedArtifacts");
	exactKeys(
		artifacts,
		["forensicBytes", "generationBytes", "scorecardBytes"],
		"d709.qualifiedArtifacts",
	);
	const copy = (key: keyof D709QualifiedArtifactBytesV1): Uint8Array => {
		const raw = artifacts[key];
		if (!(raw instanceof Uint8Array) || Object.getPrototypeOf(raw) !== Uint8Array.prototype) {
			throw new TypeError(`d709.qualifiedArtifacts.${key}: expected plain bytes`);
		}
		const bytes = new Uint8Array(raw);
		if (bytes.byteLength === 0 || bytes.byteLength > 32_768) {
			throw new TypeError(`d709.qualifiedArtifacts.${key}: byte bound exceeded`);
		}
		return bytes;
	};
	const bytes = Object.freeze({
		forensicBytes: copy("forensicBytes"),
		scorecardBytes: copy("scorecardBytes"),
		generationBytes: copy("generationBytes"),
	});
	for (const [key, expected] of [
		["forensicBytes", D709_QUALIFIED_FORENSIC_ARTIFACT_DIGEST],
		["scorecardBytes", D709_QUALIFIED_SCORECARD_ARTIFACT_DIGEST],
		["generationBytes", D709_QUALIFIED_GENERATION_ARTIFACT_DIGEST],
	] as const) {
		literal(empiricalSha256(bytes[key]), expected, `d709.qualifiedArtifacts.${key}.digest`);
	}
	const forensicDecoded = strictJsonCodec.decode(bytes.forensicBytes);
	assertCanonicalBytes(forensicDecoded, bytes.forensicBytes, "d709.qualifiedArtifacts.forensic");
	const forensic = validateD709UntypedHttp429Forensic(
		forensicDecoded,
		candidate.sourceArtifacts as D709D708ArtifactBytesV1,
	);
	const scorecardDecoded = strictJsonCodec.decode(bytes.scorecardBytes);
	assertCanonicalBytes(scorecardDecoded, bytes.scorecardBytes, "d709.qualifiedArtifacts.scorecard");
	const scorecard = validateD709UntypedHttp429ForensicScorecard(
		scorecardDecoded,
		forensic,
		candidate.sourceArtifacts as D709D708ArtifactBytesV1,
	);
	const generationDecoded = strictJsonCodec.decode(bytes.generationBytes);
	assertCanonicalBytes(
		generationDecoded,
		bytes.generationBytes,
		"d709.qualifiedArtifacts.generation",
	);
	const generationDigest = validateD709GenerationArtifact(generationDecoded);
	return Object.freeze({
		forensicDigest: forensic.forensicDigest as typeof D709_QUALIFIED_FORENSIC_DIGEST,
		scorecardDigest: scorecard.scorecardDigest as typeof D709_QUALIFIED_SCORECARD_DIGEST,
		generationDigest: generationDigest as typeof D709_QUALIFIED_GENERATION_DIGEST,
	});
}
