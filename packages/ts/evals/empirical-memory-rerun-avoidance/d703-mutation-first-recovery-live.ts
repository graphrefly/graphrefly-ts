import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	assertCanonicalBytes,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	oneOf,
	record,
	safeInteger,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import type {
	ClosedNoProgressReceiptObserverV1,
	ClosedNoProgressReceiptV1,
} from "./closed-task-profile-host.js";
import { createD690HistoricalTransferMemory } from "./d690-historical-pair-qualification.js";
import {
	assertD691HistoricalTransferUnderlyingCoordinates,
	D691_PRIVATE_PERSISTENCE_ROOT,
	D691_QUALIFIED_D690_OFFLINE_EVIDENCE_DIGEST,
	validateD691D690OfflineEvidence,
	validateD691HistoricalTransferBlockCoordinates,
} from "./d691-historical-transfer-live.js";
import { D693_ASSISTED_PROGRESS_POLICY } from "./d693-assisted-progress-qualification.js";
import {
	createD694FocusedReceiptObserver,
	D694_FOCUSED_VALIDATION_COMMAND_DIGEST,
	D694_PRICING_REVISION,
	type D694FocusedValidationReceiptV1,
	deriveD694AssistedProgress,
	validateD694D693EvidenceBytes,
	validateD694FocusedValidationReceipt,
} from "./d694-assisted-progress-live.js";
import { D695_NO_PROGRESS_CONTINUATION_POLICY } from "./d695-no-progress-continuation-qualification.js";
import {
	commitD696PrivateStagingDirectory,
	type D696ContinuationAssistedObservationV1,
	failD696PrivateStagingGeneration,
	validateD696Observation,
	validateD696Scorecard,
} from "./d696-continuation-assisted-live.js";
import {
	D702_GENERATION_SCHEMA,
	D702_STALE_RESULT_RECOVERY_POLICY,
	type D702OfflineQualificationV1,
	validateD702OfflineQualification,
} from "./d702-mutation-first-recovery-qualification.js";
import {
	type EmpiricalTrialBlockObservationV3,
	validateEmpiricalTrialBlockObservation,
} from "./empirical-smoke-evidence.js";
import {
	type EmpiricalExactPrivateNeedleProtectionExecutorV1,
	isEmpiricalExactPrivateNeedleProtectionExecutor,
} from "./exact-private-needle-protection.js";
import { createD691HistoricalReflectionCapability } from "./matched-block-memory.js";
import {
	type OpenRouterContinuationInvocationFactV1,
	type OpenRouterFirstTaskRetryWaitCapabilityV1,
	type OpenRouterMatchedTrialBlockInputV4,
	type OpenRouterMutationFirstInvocationFactV1,
	runOpenRouterMatchedTrialBlock,
} from "./openrouter-first-task-smoke.js";
import type { OpenRouterResponsesByteTransportV1 } from "./openrouter-responses-model-turn.js";
import {
	assertPrivateArtifactProtection,
	assertSafePrivateRoot,
	syncDirectory,
	writePrivateFile,
} from "./private-smoke-persistence.js";

export const D703_OBSERVATION_SCHEMA =
	"graphrefly.private-solution-eval.d703-mutation-first-observation.v1" as const;
export const D703_SCORECARD_SCHEMA =
	"graphrefly.private-solution-eval.d703-mutation-first-scorecard.v1" as const;
export const D703_GENERATION_SCHEMA =
	"graphrefly.private-solution-eval.d703-mutation-first-generation.v1" as const;
export const D703_OPERATIONAL_QUALIFICATION_SCHEMA =
	"graphrefly.private-solution-eval.d703-pre-live-operational-qualification.v1" as const;
export const D703_CLAIM_BOUNDARY =
	"single-controlled-d702-mutation-first-historical-transfer-pre-live-no-efficacy-claim" as const;
export const D703_PRIVATE_PERSISTENCE_ROOT = D691_PRIVATE_PERSISTENCE_ROOT;
export const D703_D699_OBSERVATION_ARTIFACT_DIGEST =
	"sha256:38bf6c835ed2771e01d32b4f31a1513e09edc3071a0032edd0448fc61fc5c498" as const;
export const D703_D699_SCORECARD_ARTIFACT_DIGEST =
	"sha256:0de5248540e192c01e6ccc12ea3779fc7203bfcc20ab6f1571554ed8514b3d99" as const;
export const D703_D699_GENERATION_ARTIFACT_DIGEST =
	"sha256:9c7aa9faaebcc3513879aadd424cf058ff0ce30337a48621247115749e2f7e2e" as const;
export const D703_D699_OBSERVATION_DIGEST =
	"sha256:3dbbc78302e0781488644197ab4fe0268c6c3d63f58f443a1305b1922f038c3e" as const;
export const D703_D699_SCORECARD_DIGEST =
	"sha256:8c33106261de265eece68414bfada8740f9f436302cc0163db72844f387cb046" as const;
export const D703_D699_GENERATION_DIGEST =
	"sha256:faddcf9e6a56f2ff7671d29a670524b89f2938afb431bf691b79b1aba377d0ce" as const;
export const D703_D699_DISPATCH_CLAIM_ARTIFACT_DIGEST =
	"sha256:85221df573e855d7e7ab06a8951e805e0093611f91d8970004f4b42d9f778d56" as const;
export const D703_D699_DISPATCH_CLAIM_DIGEST =
	"sha256:41c51a2796b9f5173ae86e6bfcc2276a721d280f3a4961e1720d03d8160fc433" as const;
export const D703_D702_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:720fe637a69b423d38c2bd30f4bb7cdb6fa3e8d2fa4c7656150f1322bbedcfdd" as const;
export const D703_D702_GENERATION_ARTIFACT_DIGEST =
	"sha256:89b1f83bab262206e516a90445cf86db52390e9ea436b73d31f3e37b0603d5b5" as const;
export const D703_D702_QUALIFICATION_DIGEST =
	"sha256:9505f9b7662105d30fd409b4548f3b694cd1b2a1288270741ce1ccaeac9da3fe" as const;
export const D703_D702_GENERATION_DIGEST =
	"sha256:fe38c1611a367a87155c85a94e44a5c8da8889bbddd0c171967c24ac1bca8a7e" as const;
export const D703_D702_IMPLEMENTATION_COMMIT = "c04744492805960507aa5dba76743236c99be37a" as const;
export const D703_D702_QUALIFICATION_SOURCE_DIGEST =
	"sha256:b414a40af3220643e8c70074b521597e61c0a65449817a921be51795349ee2d5" as const;
export const D703_D702_HOST_SOURCE_DIGEST =
	"sha256:4d1e670ea4e5845371a2a3ff54855ae4a3a3fe8ed374d7b5491e92134c42946f" as const;
export const D703_D702_BINDING_SOURCE_DIGEST =
	"sha256:77fe2438983d34acaaa3abb68dc364fc40c3c753288335f33011b0b1805c2d6f" as const;
export const D703_D702_RUNNER_SOURCE_DIGEST =
	"sha256:466159efe4e6f84b328cc9103c1c11ca5a8292143d9da12c8534a90db4543f07" as const;
export const D703_NODE_RUNTIME_VERSION = "v24.18.0" as const;
export const D703_DRY_RUN_OBSERVATION_ARTIFACT_DIGEST =
	"sha256:a5e0cf3e20e60dd0fb3d03dd8facb63bc757576090398578ce7b4afe4783aa22" as const;
export const D703_DRY_RUN_SCORECARD_ARTIFACT_DIGEST =
	"sha256:b812462c0b24af00eabeca27e77f9a05c49b1741897d074271d35d5e342046ca" as const;
export const D703_DRY_RUN_GENERATION_ARTIFACT_DIGEST =
	"sha256:c5b4644a664b3f675f9bdb2a9af9fdf8066ebd450decc04907ddb013a5eb08fa" as const;
export const D703_DRY_RUN_OBSERVATION_DIGEST =
	"sha256:463c1e83f5468952a3a3ddcfd9e130af4ddd26a91aa3fce6450fe927d982e9ed" as const;
export const D703_DRY_RUN_SCORECARD_DIGEST =
	"sha256:ae01949357209eccf3eb4d0d456b674c3c148511102c2f0138a332293f58d499" as const;
export const D703_DRY_RUN_GENERATION_DIGEST =
	"sha256:4f2e4709953f57e59dbc220e45dfe0e120f22db855b7ada6906616ad2a3d23dd" as const;

const STAGES = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);
type Stage = (typeof STAGES)[number];

export interface D703MutationFirstObservationV1 {
	readonly schemaVersion: typeof D703_OBSERVATION_SCHEMA;
	readonly claimBoundary: typeof D703_CLAIM_BOUNDARY;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly executionClass: "simulated-contract";
	readonly d699ObservationArtifactDigest: typeof D703_D699_OBSERVATION_ARTIFACT_DIGEST;
	readonly d699ScorecardArtifactDigest: typeof D703_D699_SCORECARD_ARTIFACT_DIGEST;
	readonly d699GenerationArtifactDigest: typeof D703_D699_GENERATION_ARTIFACT_DIGEST;
	readonly d699ObservationDigest: typeof D703_D699_OBSERVATION_DIGEST;
	readonly d699DispatchClaimArtifactDigest: typeof D703_D699_DISPATCH_CLAIM_ARTIFACT_DIGEST;
	readonly d699DispatchClaimDigest: typeof D703_D699_DISPATCH_CLAIM_DIGEST;
	readonly d702QualificationArtifactDigest: typeof D703_D702_QUALIFICATION_ARTIFACT_DIGEST;
	readonly d702GenerationArtifactDigest: typeof D703_D702_GENERATION_ARTIFACT_DIGEST;
	readonly d702QualificationDigest: typeof D703_D702_QUALIFICATION_DIGEST;
	readonly d702ImplementationCommit: typeof D703_D702_IMPLEMENTATION_COMMIT;
	readonly d702QualificationSourceDigest: typeof D703_D702_QUALIFICATION_SOURCE_DIGEST;
	readonly d702HostSourceDigest: typeof D703_D702_HOST_SOURCE_DIGEST;
	readonly d702BindingSourceDigest: typeof D703_D702_BINDING_SOURCE_DIGEST;
	readonly d702RunnerSourceDigest: typeof D703_D702_RUNNER_SOURCE_DIGEST;
	readonly nodeRuntimeVersion: typeof D703_NODE_RUNTIME_VERSION;
	readonly d693PolicyDigest: string;
	readonly d695PolicyDigest: string;
	readonly d702PolicyDigest: string;
	readonly focusedValidationCommandDigest: string;
	readonly underlyingObservationDigest: string;
	readonly underlying: EmpiricalTrialBlockObservationV3;
	readonly focusedValidationReceipts: readonly D694FocusedValidationReceiptV1[];
	readonly continuationInvocations: readonly OpenRouterContinuationInvocationFactV1[];
	readonly mutationFirstInvocations: readonly OpenRouterMutationFirstInvocationFactV1[];
	readonly noProgressReceipts: readonly ClosedNoProgressReceiptV1[];
	readonly completedRunsSatisfiedObjectiveProgress: boolean;
	readonly relevantActionTraceBoundToMemory: boolean;
	readonly mutationFirstRecoveryObserved: boolean;
	readonly matchedPairEvaluable: boolean;
	readonly observationDigest: string;
}

export interface D703MutationFirstScorecardV1 {
	readonly schemaVersion: typeof D703_SCORECARD_SCHEMA;
	readonly claimBoundary: typeof D703_CLAIM_BOUNDARY;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly observationDigests: readonly [string];
	readonly attemptedBlocks: 1;
	readonly completedBlocks: 0 | 1;
	readonly evaluablePairs: 0 | 1;
	readonly continuationInvocationCount: number;
	readonly mutationFirstInvocationCount: number;
	readonly noProgressRejectionCount: number;
	readonly mutationFirstRecoveryObserved: boolean;
	readonly status:
		| "mechanical-recovery-no-matched-pair"
		| "complete-matched-pair-no-efficacy-claim"
		| "incomplete";
	readonly scorecardDigest: string;
}

export interface D703PreflightCapabilityV1 {
	readonly capabilityRef: "d703-exact-pre-live-preflight";
	readonly capabilityRevision: "decision.D703.2026-08-09.v1";
	readonly executionClass: "simulated-contract";
}

export interface D703PreLiveOperationalQualificationV1 {
	readonly schemaVersion: typeof D703_OPERATIONAL_QUALIFICATION_SCHEMA;
	readonly observationDigest: string;
	readonly isolationProfile: "macos-sandbox-deny-network.v1";
	readonly networkProbeDisposition: "blocked-by-os-policy-eperm";
	readonly transportKind: "injected-byte-transport";
	readonly transportCalls: number;
	readonly maximumConcurrentTransportCalls: 1;
	readonly retryWaitCalls: number;
	readonly fallbackUsed: false;
	readonly providerSwitchUsed: false;
	readonly initialWorkspaceCleanupPassed: true;
	readonly workspaceResidueCount: 0;
	readonly qualificationDigest: string;
}

interface D703PreflightState {
	readonly d690OfflineEvidence: ReturnType<typeof validateD691D690OfflineEvidence>;
	readonly d693QualificationBytes: Uint8Array;
	readonly d693GenerationBytes: Uint8Array;
	readonly historicalObservation: D696ContinuationAssistedObservationV1;
	readonly d702Qualification: D702OfflineQualificationV1;
}

export interface D703ConsumedPreflightForD704V1 {
	readonly d690OfflineEvidence: ReturnType<typeof validateD691D690OfflineEvidence>;
	readonly historicalObservation: D696ContinuationAssistedObservationV1;
	readonly d702Qualification: D702OfflineQualificationV1;
}

const constructedPreflights = new WeakMap<object, D703PreflightState>();
const constructedObservations = new WeakSet<object>();
const constructedScorecards = new WeakSet<object>();
const constructedOperationalQualifications = new WeakSet<object>();
const execFileAsync = promisify(execFile);

function copyBytes(value: unknown, path: string, max: number): Uint8Array {
	if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > max) {
		throw new TypeError(`${path} must be bounded non-empty bytes`);
	}
	return new Uint8Array(value);
}

function captureArtifactBytes(
	value: unknown,
	path: string,
	keys: readonly string[],
): Readonly<Record<string, Uint8Array>> {
	const candidate = record(value, path);
	exactKeys(candidate, keys, path);
	return Object.freeze(
		Object.fromEntries(
			keys.map((key) => [key, copyBytes(candidate[key], `${path}.${key}`, 8_000_000)]),
		),
	);
}

function validateD699Artifacts(value: unknown): D696ContinuationAssistedObservationV1 {
	const bytes = captureArtifactBytes(value, "d703.d699Artifacts", [
		"observationBytes",
		"scorecardBytes",
		"generationBytes",
	]);
	for (const [key, expected] of [
		["observationBytes", D703_D699_OBSERVATION_ARTIFACT_DIGEST],
		["scorecardBytes", D703_D699_SCORECARD_ARTIFACT_DIGEST],
		["generationBytes", D703_D699_GENERATION_ARTIFACT_DIGEST],
	] as const) {
		if (empiricalSha256(bytes[key]!) !== expected) throw new TypeError(`D703 rejected ${key}`);
	}
	const observationDecoded = strictJsonCodec.decode(bytes.observationBytes!);
	assertCanonicalBytes(observationDecoded, bytes.observationBytes!, "d703.d699.observation");
	const observation = validateD696Observation(observationDecoded);
	literal(
		observation.observationDigest,
		D703_D699_OBSERVATION_DIGEST,
		"d703.d699.observationDigest",
	);
	const scorecardDecoded = strictJsonCodec.decode(bytes.scorecardBytes!);
	assertCanonicalBytes(scorecardDecoded, bytes.scorecardBytes!, "d703.d699.scorecard");
	const scorecard = validateD696Scorecard(scorecardDecoded, observation);
	literal(scorecard.scorecardDigest, D703_D699_SCORECARD_DIGEST, "d703.d699.scorecardDigest");
	const generationDecoded = strictJsonCodec.decode(bytes.generationBytes!);
	assertCanonicalBytes(generationDecoded, bytes.generationBytes!, "d703.d699.generation");
	const generation = record(generationDecoded, "d703.d699.generation");
	exactKeys(
		generation,
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
		"d703.d699.generation",
	);
	literal(
		generation.generationRef,
		"d696-continuation-assisted-live-2026-08-08-d699-v2",
		"d703.d699.generationRef",
	);
	literal(generation.generationDigest, D703_D699_GENERATION_DIGEST, "d703.d699.generationDigest");
	const { generationDigest, ...generationMaterial } = generation;
	if (empiricalStrictJsonDigest(generationMaterial) !== generationDigest) {
		throw new TypeError("D703 rejected non-canonical D699 generation");
	}
	for (const [key, expected] of [
		["observation", D703_D699_OBSERVATION_DIGEST],
		["scorecard", D703_D699_SCORECARD_DIGEST],
	] as const) {
		const ref = record(generation[key], `d703.d699.generation.${key}`);
		literal(ref.digest, expected, `d703.d699.generation.${key}.digest`);
	}
	return observation;
}

function validateD702Artifacts(value: unknown): D702OfflineQualificationV1 {
	const bytes = captureArtifactBytes(value, "d703.d702Artifacts", [
		"qualificationBytes",
		"generationBytes",
	]);
	if (
		empiricalSha256(bytes.qualificationBytes!) !== D703_D702_QUALIFICATION_ARTIFACT_DIGEST ||
		empiricalSha256(bytes.generationBytes!) !== D703_D702_GENERATION_ARTIFACT_DIGEST
	) {
		throw new TypeError("D703 rejected frozen D702 artifacts");
	}
	const qualificationDecoded = strictJsonCodec.decode(bytes.qualificationBytes!);
	assertCanonicalBytes(qualificationDecoded, bytes.qualificationBytes!, "d703.d702.qualification");
	const qualification = validateD702OfflineQualification(qualificationDecoded);
	literal(qualification.qualified, true, "d703.d702.qualified");
	literal(
		qualification.qualificationDigest,
		D703_D702_QUALIFICATION_DIGEST,
		"d703.d702.qualificationDigest",
	);
	const generationDecoded = strictJsonCodec.decode(bytes.generationBytes!);
	assertCanonicalBytes(generationDecoded, bytes.generationBytes!, "d703.d702.generation");
	const generation = record(generationDecoded, "d703.d702.generation");
	exactKeys(
		generation,
		["generationDigest", "generationRef", "qualification", "schemaVersion"],
		"d703.d702.generation",
	);
	literal(generation.schemaVersion, D702_GENERATION_SCHEMA, "d703.d702.generation.schema");
	literal(
		generation.generationRef,
		"d702-mutation-first-offline-qualified-2026-08-09-v1",
		"d703.d702.generation.ref",
	);
	literal(generation.generationDigest, D703_D702_GENERATION_DIGEST, "d703.d702.generation.digest");
	const qualificationRef = record(generation.qualification, "d703.d702.generation.qualification");
	literal(
		qualificationRef.digest,
		D703_D702_QUALIFICATION_ARTIFACT_DIGEST,
		"d703.d702.generation.qualification.digest",
	);
	const { generationDigest, ...generationMaterial } = generation;
	if (empiricalStrictJsonDigest(generationMaterial) !== generationDigest) {
		throw new TypeError("D703 rejected non-canonical D702 generation");
	}
	return qualification;
}

function validateD699DispatchClaim(value: unknown): void {
	const bytes = copyBytes(value, "d703.d699DispatchClaimBytes", 16_000);
	if (empiricalSha256(bytes) !== D703_D699_DISPATCH_CLAIM_ARTIFACT_DIGEST) {
		throw new TypeError("D703 rejected frozen D699 dispatch claim");
	}
	const decoded = strictJsonCodec.decode(bytes);
	assertCanonicalBytes(decoded, bytes, "d703.d699DispatchClaim");
	const claim = record(decoded, "d703.d699DispatchClaim");
	exactKeys(
		claim,
		[
			"blockCount",
			"claimDigest",
			"claimRef",
			"decisionRef",
			"decisionRevision",
			"disposition",
			"generationRef",
			"maxSpendMicrousd",
			"schemaVersion",
		],
		"d703.d699DispatchClaim",
	);
	literal(
		claim.schemaVersion,
		"graphrefly.private-solution-eval.d699-single-use-dispatch-claim.v1",
		"d703.d699DispatchClaim.schemaVersion",
	);
	literal(
		claim.claimRef,
		"d699-d696-accounting-fixed-replacement-2026-08-08-v1",
		"d703.d699DispatchClaim.claimRef",
	);
	literal(claim.decisionRef, "decision.D699", "d703.d699DispatchClaim.decisionRef");
	literal(
		claim.decisionRevision,
		"decision.D699.2026-08-08.v1",
		"d703.d699DispatchClaim.decisionRevision",
	);
	literal(
		claim.disposition,
		"consumed-before-credential-or-network",
		"d703.d699DispatchClaim.disposition",
	);
	literal(
		claim.generationRef,
		"d696-continuation-assisted-live-2026-08-08-d699-v2",
		"d703.d699DispatchClaim.generationRef",
	);
	literal(claim.blockCount, 1, "d703.d699DispatchClaim.blockCount");
	literal(claim.maxSpendMicrousd, 6_000_000, "d703.d699DispatchClaim.maxSpendMicrousd");
	literal(claim.claimDigest, D703_D699_DISPATCH_CLAIM_DIGEST, "d703.d699DispatchClaim.claimDigest");
	const { claimDigest, ...material } = claim;
	if (empiricalStrictJsonDigest(material) !== claimDigest) {
		throw new TypeError("D703 rejected non-canonical D699 dispatch claim");
	}
}

async function validateCurrentD702Implementation(): Promise<void> {
	const measurements: Record<string, string> = {
		nodeRuntimeVersion: process.version,
	};
	for (const [file] of [
		["d702-mutation-first-recovery-qualification.ts", D703_D702_QUALIFICATION_SOURCE_DIGEST],
		["closed-task-profile-host.ts", D703_D702_HOST_SOURCE_DIGEST],
		["openrouter-responses-model-turn.ts", D703_D702_BINDING_SOURCE_DIGEST],
		["openrouter-first-task-smoke.ts", D703_D702_RUNNER_SOURCE_DIGEST],
	] as const) {
		const bytes = new Uint8Array(await readFile(new URL(file, import.meta.url)));
		measurements[file] = empiricalSha256(bytes);
	}
	validateD703ImplementationMeasurements(measurements);
}

export function validateD703ImplementationMeasurements(value: unknown): void {
	const measurements = record(value, "d703.implementationMeasurements");
	exactKeys(
		measurements,
		[
			"closed-task-profile-host.ts",
			"d702-mutation-first-recovery-qualification.ts",
			"nodeRuntimeVersion",
			"openrouter-first-task-smoke.ts",
			"openrouter-responses-model-turn.ts",
		],
		"d703.implementationMeasurements",
	);
	literal(measurements.nodeRuntimeVersion, D703_NODE_RUNTIME_VERSION, "d703.runtime.nodeVersion");
	for (const [file, expected] of [
		["d702-mutation-first-recovery-qualification.ts", D703_D702_QUALIFICATION_SOURCE_DIGEST],
		["closed-task-profile-host.ts", D703_D702_HOST_SOURCE_DIGEST],
		["openrouter-responses-model-turn.ts", D703_D702_BINDING_SOURCE_DIGEST],
		["openrouter-first-task-smoke.ts", D703_D702_RUNNER_SOURCE_DIGEST],
	] as const) {
		literal(measurements[file], expected, `d703.runtime.source.${file}`);
	}
}

export async function createD703PreflightCapability(
	value: unknown,
): Promise<D703PreflightCapabilityV1> {
	const input = record(value, "d703.preflight");
	exactKeys(
		input,
		[
			"d690OfflineEvidence",
			"d693GenerationBytes",
			"d693QualificationBytes",
			"d699Artifacts",
			"d699DispatchClaimBytes",
			"d702Artifacts",
			"executionClass",
		],
		"d703.preflight",
	);
	literal(input.executionClass, "simulated-contract", "d703.preflight.executionClass");
	const d690OfflineEvidence = validateD691D690OfflineEvidence(
		input.d690OfflineEvidence,
		"simulated-contract",
	);
	literal(
		d690OfflineEvidence.evidenceDigest,
		D691_QUALIFIED_D690_OFFLINE_EVIDENCE_DIGEST,
		"d703.d690.evidenceDigest",
	);
	const d693QualificationBytes = copyBytes(
		input.d693QualificationBytes,
		"d703.d693QualificationBytes",
		256_000,
	);
	const d693GenerationBytes = copyBytes(
		input.d693GenerationBytes,
		"d703.d693GenerationBytes",
		64_000,
	);
	validateD694D693EvidenceBytes({
		qualificationBytes: d693QualificationBytes,
		generationBytes: d693GenerationBytes,
	});
	const historicalObservation = validateD699Artifacts(input.d699Artifacts);
	validateD699DispatchClaim(input.d699DispatchClaimBytes);
	const d702Qualification = validateD702Artifacts(input.d702Artifacts);
	await validateCurrentD702Implementation();
	if (
		empiricalStrictJsonDigest(D702_STALE_RESULT_RECOVERY_POLICY) !==
			d702Qualification.d702PolicyDigest ||
		empiricalStrictJsonDigest(D693_ASSISTED_PROGRESS_POLICY) !==
			d702Qualification.d693PolicyDigest ||
		empiricalStrictJsonDigest(D695_NO_PROGRESS_CONTINUATION_POLICY) !==
			d702Qualification.d695PolicyDigest
	) {
		throw new TypeError("D703 current policies drifted from durable D702 qualification");
	}
	const capability = Object.freeze({
		capabilityRef: "d703-exact-pre-live-preflight" as const,
		capabilityRevision: "decision.D703.2026-08-09.v1" as const,
		executionClass: "simulated-contract" as const,
	});
	constructedPreflights.set(capability, {
		d690OfflineEvidence,
		d693QualificationBytes,
		d693GenerationBytes,
		historicalObservation,
		d702Qualification,
	});
	return capability;
}

export function consumeD703PreflightForD704(value: unknown): D703ConsumedPreflightForD704V1 {
	if (value === null || typeof value !== "object") {
		throw new TypeError("D704 requires a constructed D703 preflight");
	}
	const state = constructedPreflights.get(value);
	if (state === undefined) throw new TypeError("D704 requires a fresh D703 preflight");
	constructedPreflights.delete(value);
	return Object.freeze({
		d690OfflineEvidence: state.d690OfflineEvidence,
		historicalObservation: state.historicalObservation,
		d702Qualification: state.d702Qualification,
	});
}

function captureBlock(value: unknown): OpenRouterMatchedTrialBlockInputV4 {
	const block = record(value, "d703.block");
	const host = record(block.host, "d703.block.host");
	for (const key of [
		"objectiveProgressPolicy",
		"actionReceiptObserver",
		"noProgressContinuationPolicy",
		"continuationModelTurnPort",
		"noProgressReceiptObserver",
		"staleResultRecoveryPolicy",
		"mutationFirstContinuationModelTurnPort",
	] as const) {
		if (Object.hasOwn(host, key)) throw new TypeError(`D703 owns host.${key}`);
	}
	return Object.freeze({
		...block,
		routeQualification: strictSnapshot(record(block.routeQualification, "d703.block.route")),
		host: Object.freeze({
			...host,
			frozen: strictSnapshot(record(host.frozen, "d703.block.host.frozen")),
			qualificationReport: strictSnapshot(
				record(host.qualificationReport, "d703.block.host.qualificationReport"),
			),
			initialRequest: strictSnapshot(record(host.initialRequest, "d703.block.host.initialRequest")),
			taskProfile: strictSnapshot(record(host.taskProfile, "d703.block.host.taskProfile")),
		}),
	}) as unknown as OpenRouterMatchedTrialBlockInputV4;
}

function validateBlock(block: OpenRouterMatchedTrialBlockInputV4): void {
	validateD691HistoricalTransferBlockCoordinates(block);
	if (
		block.executionClass !== "simulated-contract" ||
		block.routeQualification.dispatchMode !== "simulated" ||
		block.routeQualification.budget.approvalRef !== "decision.D703" ||
		block.routeQualification.budget.approvalRevision !== "decision.D703.2026-08-09.v1" ||
		block.routeQualification.pricing.pricingRevision !== D694_PRICING_REVISION ||
		empiricalStrictJsonDigest(
			block.host.taskProfile.commandPolicy.commands.find(
				(command) => command.commandRef === D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			),
		) !== D694_FOCUSED_VALIDATION_COMMAND_DIGEST
	) {
		throw new TypeError("D703 block drifted from its frozen simulated baseline");
	}
}

function noProgressObserver(
	receipts: ClosedNoProgressReceiptV1[],
): ClosedNoProgressReceiptObserverV1 {
	return Object.freeze({
		observerRef: "d703-no-progress-receipt-observer",
		observerRevision: "decision.D703.2026-08-09.v1",
		record(receipt: ClosedNoProgressReceiptV1) {
			if (receipts.length >= STAGES.length * 32)
				throw new TypeError("D703 receipt bound exhausted");
			receipts.push(validateD703NoProgressReceipt(receipt));
		},
	});
}

function runForStage(underlying: EmpiricalTrialBlockObservationV3, stage: Stage) {
	if (stage === "cold") return underlying.cold;
	return underlying.warmBranches.find((branch) => branch.branchKind === stage)?.run ?? null;
}

function stage(value: unknown, path: string): Stage {
	return oneOf(value, STAGES, path);
}

export function validateD703ContinuationInvocationFact(
	value: unknown,
): OpenRouterContinuationInvocationFactV1 {
	const fact = record(value, "d703.continuationInvocation");
	exactKeys(
		fact,
		[
			"attemptOrdinal",
			"continuationDigest",
			"providerRequestCount",
			"requestDigest",
			"requiredDisposition",
			"stepIndex",
			"trialStage",
		],
		"d703.continuationInvocation",
	);
	return strictSnapshot({
		trialStage: stage(fact.trialStage, "d703.continuationInvocation.trialStage"),
		stepIndex: safeInteger(fact.stepIndex, "d703.continuationInvocation.stepIndex", {
			max: 31,
		}),
		attemptOrdinal: safeInteger(fact.attemptOrdinal, "d703.continuationInvocation.attemptOrdinal", {
			min: 1,
			max: 3,
		}),
		requestDigest: digest(fact.requestDigest, "d703.continuationInvocation.requestDigest"),
		continuationDigest: digest(
			fact.continuationDigest,
			"d703.continuationInvocation.continuationDigest",
		),
		requiredDisposition: oneOf(
			fact.requiredDisposition,
			["tool-intents", "final-allowed"] as const,
			"d703.continuationInvocation.requiredDisposition",
		),
		providerRequestCount: safeInteger(
			fact.providerRequestCount,
			"d703.continuationInvocation.providerRequestCount",
			{ max: 1 },
		),
	});
}

export function validateD703MutationFirstInvocationFact(
	value: unknown,
): OpenRouterMutationFirstInvocationFactV1 {
	const fact = record(value, "d703.mutationFirstInvocation");
	exactKeys(
		fact,
		[
			"attemptOrdinal",
			"continuationDigest",
			"providerRequestCount",
			"requestDigest",
			"requiredFirstToolRef",
			"staleResultReceiptDigest",
			"stepIndex",
			"trialStage",
		],
		"d703.mutationFirstInvocation",
	);
	return strictSnapshot({
		trialStage: stage(fact.trialStage, "d703.mutationFirstInvocation.trialStage"),
		stepIndex: safeInteger(fact.stepIndex, "d703.mutationFirstInvocation.stepIndex", {
			max: 31,
		}),
		attemptOrdinal: safeInteger(
			fact.attemptOrdinal,
			"d703.mutationFirstInvocation.attemptOrdinal",
			{ min: 1, max: 3 },
		),
		requestDigest: digest(fact.requestDigest, "d703.mutationFirstInvocation.requestDigest"),
		continuationDigest: digest(
			fact.continuationDigest,
			"d703.mutationFirstInvocation.continuationDigest",
		),
		staleResultReceiptDigest: digest(
			fact.staleResultReceiptDigest,
			"d703.mutationFirstInvocation.staleResultReceiptDigest",
		),
		requiredFirstToolRef: literal(
			fact.requiredFirstToolRef,
			D702_STALE_RESULT_RECOVERY_POLICY.requiredFirstToolRef,
			"d703.mutationFirstInvocation.requiredFirstToolRef",
		),
		providerRequestCount: safeInteger(
			fact.providerRequestCount,
			"d703.mutationFirstInvocation.providerRequestCount",
			{ max: 1 },
		),
	});
}

export function validateD703NoProgressReceipt(value: unknown): ClosedNoProgressReceiptV1 {
	const receipt = record(value, "d703.noProgressReceipt");
	const kind = oneOf(
		receipt.kind,
		[
			"duplicate-inspection-batch",
			"duplicate-inspection-intent",
			"stale-result-intent-batch",
		] as const,
		"d703.noProgressReceipt.kind",
	);
	const evidenceKey =
		kind === "stale-result-intent-batch" ? "intentBatchDigest" : "inspectionBatchDigest";
	exactKeys(
		receipt,
		["disposition", evidenceKey, "kind", "stepIndex", "trialStage", "workspaceStateDigest"],
		"d703.noProgressReceipt",
	);
	const common = {
		trialStage: stage(receipt.trialStage, "d703.noProgressReceipt.trialStage"),
		stepIndex: safeInteger(receipt.stepIndex, "d703.noProgressReceipt.stepIndex", { max: 31 }),
		workspaceStateDigest: digest(
			receipt.workspaceStateDigest,
			"d703.noProgressReceipt.workspaceStateDigest",
		),
		disposition: literal(
			receipt.disposition,
			"rejected-before-tool-execution",
			"d703.noProgressReceipt.disposition",
		),
	};
	return kind === "stale-result-intent-batch"
		? strictSnapshot({
				...common,
				kind,
				intentBatchDigest: digest(
					receipt.intentBatchDigest,
					"d703.noProgressReceipt.intentBatchDigest",
				),
			})
		: strictSnapshot({
				...common,
				kind,
				inspectionBatchDigest: digest(
					receipt.inspectionBatchDigest,
					"d703.noProgressReceipt.inspectionBatchDigest",
				),
			});
}

function matchedPairEvaluable(underlying: EmpiricalTrialBlockObservationV3): boolean {
	return (
		underlying.result.classification === "complete" &&
		underlying.cold.verifierStatus === "failed" &&
		underlying.warmBranches.every(
			(branch) =>
				branch.attempted &&
				(branch.run?.verifierStatus === "passed" || branch.run?.verifierStatus === "failed"),
		)
	);
}

export function deriveD703MutationFirstRecoveryLifecycle(
	underlying: EmpiricalTrialBlockObservationV3,
	focusedReceipts: readonly D694FocusedValidationReceiptV1[],
	continuations: readonly OpenRouterContinuationInvocationFactV1[],
	mutations: readonly OpenRouterMutationFirstInvocationFactV1[],
	receipts: readonly ClosedNoProgressReceiptV1[],
): boolean {
	const continuationByAttempt = new Map<string, OpenRouterContinuationInvocationFactV1>();
	const mutationByAttempt = new Map<string, OpenRouterMutationFirstInvocationFactV1>();
	const receiptKeys = new Set<string>();
	for (const receipt of receipts) {
		const key = `${receipt.trialStage}\u0000${receipt.stepIndex}\u0000${receipt.kind}`;
		if (receiptKeys.has(key)) throw new TypeError("D703 no-progress receipt duplicated");
		receiptKeys.add(key);
		const run = runForStage(underlying, receipt.trialStage as Stage);
		if (run === null || run.actionTrace.some((action) => action.stepIndex === receipt.stepIndex)) {
			throw new TypeError("D703 rejected batch was not zero-side-effect");
		}
	}
	for (const [kind, facts, target] of [
		["continuation", continuations, continuationByAttempt],
		["mutation", mutations, mutationByAttempt],
	] as const) {
		for (const fact of facts) {
			const key = `${fact.trialStage}\u0000${fact.stepIndex}\u0000${fact.attemptOrdinal}`;
			if (continuationByAttempt.has(key) || mutationByAttempt.has(key)) {
				throw new TypeError("D703 invocation fact duplicated an attempt");
			}
			target.set(key, fact as never);
			const run = runForStage(underlying, fact.trialStage as Stage);
			const attempt = run?.attemptTrace.find(
				(entry) =>
					entry.stepIndex === fact.stepIndex && entry.attemptOrdinal === fact.attemptOrdinal,
			);
			if (
				attempt?.requestDigest !== fact.requestDigest ||
				attempt.requests !== fact.providerRequestCount
			) {
				throw new TypeError(`D703 ${kind} fact is not bound to its attempt`);
			}
		}
	}

	for (const trialStage of STAGES) {
		const run = runForStage(underlying, trialStage);
		if (run === null) continue;
		const stageContinuationFacts = continuations.filter((fact) => fact.trialStage === trialStage);
		const continuationIdentityByStep = new Map<number, OpenRouterContinuationInvocationFactV1>();
		for (const fact of stageContinuationFacts) {
			const first = continuationIdentityByStep.get(fact.stepIndex);
			if (first === undefined) {
				continuationIdentityByStep.set(fact.stepIndex, fact);
			} else if (
				fact.requestDigest !== first.requestDigest ||
				fact.continuationDigest !== first.continuationDigest ||
				fact.requiredDisposition !== first.requiredDisposition
			) {
				throw new TypeError("D703 continuation retry substituted its logical request");
			}
		}
		const stageReceipts = receipts.filter((receipt) => receipt.trialStage === trialStage);
		const staleReceipts = stageReceipts.filter(
			(receipt) => receipt.kind === "stale-result-intent-batch",
		);
		if (staleReceipts.length > 2) {
			throw new TypeError(
				"D703 run exceeded one recovery plus one terminal repeated stale receipt",
			);
		}
		const mutationSteps = new Set<number>();
		for (const receipt of staleReceipts) {
			const stepIndex = receipt.stepIndex + 1;
			const attempts = run.attemptTrace.filter((attempt) => attempt.stepIndex === stepIndex);
			if (attempts.length === 0) continue;
			mutationSteps.add(stepIndex);
			const receiptDigest = empiricalStrictJsonDigest(receipt);
			const ordered = [...attempts].sort(
				(left, right) => left.attemptOrdinal - right.attemptOrdinal,
			);
			let firstFact: OpenRouterMutationFirstInvocationFactV1 | undefined;
			for (const [index, attempt] of ordered.entries()) {
				if (attempt.attemptOrdinal !== index + 1) {
					throw new TypeError("D703 mutation-first retry ordinals are not contiguous");
				}
				const fact = mutationByAttempt.get(
					`${trialStage}\u0000${stepIndex}\u0000${attempt.attemptOrdinal}`,
				);
				if (
					fact === undefined ||
					fact.staleResultReceiptDigest !== receiptDigest ||
					fact.requiredFirstToolRef !== D702_STALE_RESULT_RECOVERY_POLICY.requiredFirstToolRef
				) {
					throw new TypeError(
						"D703 mutation-first attempt is not exactly bound to its stale receipt",
					);
				}
				if (firstFact === undefined) {
					firstFact = fact;
				} else if (
					fact.requestDigest !== firstFact.requestDigest ||
					fact.continuationDigest !== firstFact.continuationDigest ||
					fact.staleResultReceiptDigest !== firstFact.staleResultReceiptDigest ||
					fact.requiredFirstToolRef !== firstFact.requiredFirstToolRef
				) {
					throw new TypeError("D703 mutation-first retry substituted its logical request");
				}
			}
		}
		if (mutationSteps.size > D702_STALE_RESULT_RECOVERY_POLICY.maxRecoveryContinuations) {
			throw new TypeError("D703 run exceeded one recovered stale-result continuation");
		}
		const firstObjectiveRejection = run.attemptTrace.find((attempt) =>
			attempt.issueCodes.includes("structured-output-objective-progress-required"),
		);
		for (const attempt of run.attemptTrace) {
			const key = `${trialStage}\u0000${attempt.stepIndex}\u0000${attempt.attemptOrdinal}`;
			const expectsMutation = mutationSteps.has(attempt.stepIndex);
			const expectsContinuation =
				firstObjectiveRejection !== undefined &&
				attempt.stepIndex > firstObjectiveRejection.stepIndex &&
				!expectsMutation;
			if (mutationByAttempt.has(key) !== expectsMutation) {
				throw new TypeError("D703 mutation-first facts are not an exact attempt set");
			}
			if (continuationByAttempt.has(key) !== expectsContinuation) {
				throw new TypeError("D703 continuation facts are not an exact attempt set");
			}
		}
		const terminalIssueToKind = Object.freeze({
			"repeated-inspection-turn-no-progress": "duplicate-inspection-batch",
			"duplicate-inspection-intent-in-turn": "duplicate-inspection-intent",
			"no-progress-stale-result-intent-batch": "stale-result-intent-batch",
		} as const);
		const terminalIssues = Object.keys(terminalIssueToKind).filter((issue) =>
			run.issueCodes.includes(issue),
		) as (keyof typeof terminalIssueToKind)[];
		if (terminalIssues.length > 1)
			throw new TypeError("D703 run has multiple terminal no-progress issues");
		for (const issue of terminalIssues) {
			if (
				!stageReceipts.some(
					(receipt) =>
						receipt.kind === terminalIssueToKind[issue] && receipt.stepIndex === run.steps - 1,
				)
			) {
				throw new TypeError("D703 terminal no-progress issue omitted its receipt");
			}
		}
		for (const receipt of stageReceipts) {
			const isTerminal = terminalIssues.some(
				(issue) =>
					receipt.kind === terminalIssueToKind[issue] && receipt.stepIndex === run.steps - 1,
			);
			const isRecoveredStale =
				receipt.kind === "stale-result-intent-batch" &&
				run.attemptTrace.some((attempt) => attempt.stepIndex === receipt.stepIndex + 1);
			if (!isTerminal && !isRecoveredStale) {
				throw new TypeError(
					"D703 no-progress receipt is not bound to terminal or recovery evidence",
				);
			}
		}
	}

	const coldReceipt = receipts.find(
		(receipt) => receipt.trialStage === "cold" && receipt.kind === "stale-result-intent-batch",
	);
	if (coldReceipt === undefined) return false;
	const recoveryStep = coldReceipt.stepIndex + 1;
	const coldMutations = mutations.filter(
		(fact) => fact.trialStage === "cold" && fact.stepIndex === recoveryStep,
	);
	if (
		coldMutations.length === 0 ||
		!coldMutations.some((fact) => fact.providerRequestCount === 1)
	) {
		return false;
	}
	const recoveryActions = underlying.cold.actionTrace.filter(
		(action) => action.stepIndex === recoveryStep,
	);
	const firstRecoveryAction = recoveryActions[0];
	if (
		firstRecoveryAction?.toolRef !== D702_STALE_RESULT_RECOVERY_POLICY.requiredFirstToolRef ||
		firstRecoveryAction.requestDigest !== coldMutations[0]?.requestDigest
	) {
		return false;
	}
	const diffAction = underlying.cold.actionTrace.find(
		(action) =>
			action.actionIndex > firstRecoveryAction.actionIndex && action.toolRef.endsWith(".diff.v1"),
	);
	const focusedReceipt =
		diffAction === undefined
			? undefined
			: focusedReceipts.find(
					(receipt) =>
						receipt.trialStage === "cold" &&
						receipt.validationStatus === "passed" &&
						receipt.actionIndex > diffAction.actionIndex,
				);
	return (
		underlying.cold.classification === "complete" &&
		underlying.cold.verifierStatus === "passed" &&
		diffAction !== undefined &&
		focusedReceipt !== undefined
	);
}

export async function runD703MutationFirstBlock(input: {
	readonly preflight: D703PreflightCapabilityV1;
	readonly block: OpenRouterMatchedTrialBlockInputV4;
}): Promise<{
	readonly observation: D703MutationFirstObservationV1;
	readonly scorecard: D703MutationFirstScorecardV1;
	readonly operationalQualification: D703PreLiveOperationalQualificationV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}> {
	const outer = record(input, "d703.input");
	exactKeys(outer, ["block", "preflight"], "d703.input");
	const block = captureBlock(outer.block);
	validateBlock(block);
	const state = constructedPreflights.get(outer.preflight as object);
	if (state === undefined) throw new TypeError("D703 requires its same-process preflight");
	constructedPreflights.delete(outer.preflight as object);
	const historical = state.historicalObservation.underlying;
	if (
		historical.campaignRef !== block.host.frozen.manifest.campaignRef ||
		historical.manifestDigest !== block.host.frozen.manifestDigest ||
		historical.taskRef !== block.host.initialRequest.taskRef ||
		historical.taskDigest !== block.host.initialRequest.taskDigest ||
		historical.trialBlockRef !== block.host.initialRequest.trialBlockRef ||
		historical.trialBlockDigest !== block.host.initialRequest.trialBlockDigest ||
		historical.route.configurationRef !== block.routeQualification.configurationRef ||
		historical.route.configurationDigest !== block.routeQualification.configurationDigest
	) {
		throw new TypeError(
			`D703 block drifted from exact D699 historical coordinates ${JSON.stringify({
				campaign: historical.campaignRef === block.host.frozen.manifest.campaignRef,
				manifest: historical.manifestDigest === block.host.frozen.manifestDigest,
				currentManifestDigest: block.host.frozen.manifestDigest,
				taskRef: historical.taskRef === block.host.initialRequest.taskRef,
				taskDigest: historical.taskDigest === block.host.initialRequest.taskDigest,
				currentTaskDigest: block.host.initialRequest.taskDigest,
				trialBlockRef: historical.trialBlockRef === block.host.initialRequest.trialBlockRef,
				trialBlockDigest:
					historical.trialBlockDigest === block.host.initialRequest.trialBlockDigest,
				configurationRef:
					historical.route.configurationRef === block.routeQualification.configurationRef,
				configurationDigest:
					historical.route.configurationDigest === block.routeQualification.configurationDigest,
			})}`,
		);
	}
	validateD694D693EvidenceBytes({
		qualificationBytes: state.d693QualificationBytes,
		generationBytes: state.d693GenerationBytes,
	});
	const transferMemory = createD690HistoricalTransferMemory();
	if (
		empiricalStrictJsonDigest(transferMemory) !== state.d690OfflineEvidence.transferMemoryDigest
	) {
		throw new TypeError("D703 transfer memory drifted from D690 evidence");
	}
	const focusedReceipts: D694FocusedValidationReceiptV1[] = [];
	const noProgressReceipts: ClosedNoProgressReceiptV1[] = [];
	const trackedWorkspaceRoots = [block.host.materialization.workspace.rootPathForHostRunner()];
	let transportCalls = 0;
	let activeTransportCalls = 0;
	let maximumConcurrentTransportCalls = 0;
	let retryWaitCalls = 0;
	const measuredTransport: OpenRouterResponsesByteTransportV1 = Object.freeze({
		async request(request: Parameters<OpenRouterResponsesByteTransportV1["request"]>[0]) {
			transportCalls += 1;
			activeTransportCalls += 1;
			maximumConcurrentTransportCalls = Math.max(
				maximumConcurrentTransportCalls,
				activeTransportCalls,
			);
			try {
				return await block.transport.request(request);
			} finally {
				activeTransportCalls -= 1;
			}
		},
	});
	const measuredRetryWait: OpenRouterFirstTaskRetryWaitCapabilityV1 = Object.freeze({
		async wait(request: Parameters<OpenRouterFirstTaskRetryWaitCapabilityV1["wait"]>[0]) {
			retryWaitCalls += 1;
			await block.retryWait.wait(request);
		},
	});
	const measuredPrepareWarmHost =
		block.prepareWarmHost === undefined
			? undefined
			: async (request: Parameters<NonNullable<typeof block.prepareWarmHost>>[0]) => {
					const materialization = await block.prepareWarmHost!(request);
					trackedWorkspaceRoots.push(materialization.workspace.rootPathForHostRunner());
					return materialization;
				};
	const result = await runOpenRouterMatchedTrialBlock({
		...block,
		transport: measuredTransport,
		retryWait: measuredRetryWait,
		...(measuredPrepareWarmHost === undefined ? {} : { prepareWarmHost: measuredPrepareWarmHost }),
		host: {
			...block.host,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: D695_NO_PROGRESS_CONTINUATION_POLICY,
			staleResultRecoveryPolicy: D702_STALE_RESULT_RECOVERY_POLICY,
			actionReceiptObserver: createD694FocusedReceiptObserver(focusedReceipts),
			noProgressReceiptObserver: noProgressObserver(noProgressReceipts),
		},
		historicalReflectionCapability: createD691HistoricalReflectionCapability({
			transferMemory,
			d690OfflineEvidenceDigest: state.d690OfflineEvidence.evidenceDigest,
		}),
	});
	if (result.profile !== "smoke") throw new TypeError("D703 requires smoke evidence");
	assertD691HistoricalTransferUnderlyingCoordinates(result.observation, block);
	const underlying = validateEmpiricalTrialBlockObservation(result.observation);
	const derived = deriveD694AssistedProgress(underlying, focusedReceipts);
	if (
		result.continuationInvocations === undefined ||
		result.mutationFirstInvocations === undefined
	) {
		throw new TypeError("D703 matched runner omitted treatment invocation facts");
	}
	const continuationInvocations = strictSnapshot(result.continuationInvocations);
	const mutationFirstInvocations = strictSnapshot(result.mutationFirstInvocations);
	const boundedReceipts = strictSnapshot(noProgressReceipts);
	const mutationFirstRecoveryObserved = deriveD703MutationFirstRecoveryLifecycle(
		underlying,
		derived.receipts,
		continuationInvocations,
		mutationFirstInvocations,
		boundedReceipts,
	);
	const material = strictSnapshot({
		schemaVersion: D703_OBSERVATION_SCHEMA,
		claimBoundary: D703_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		executionClass: "simulated-contract" as const,
		d699ObservationArtifactDigest: D703_D699_OBSERVATION_ARTIFACT_DIGEST,
		d699ScorecardArtifactDigest: D703_D699_SCORECARD_ARTIFACT_DIGEST,
		d699GenerationArtifactDigest: D703_D699_GENERATION_ARTIFACT_DIGEST,
		d699ObservationDigest: D703_D699_OBSERVATION_DIGEST,
		d699DispatchClaimArtifactDigest: D703_D699_DISPATCH_CLAIM_ARTIFACT_DIGEST,
		d699DispatchClaimDigest: D703_D699_DISPATCH_CLAIM_DIGEST,
		d702QualificationArtifactDigest: D703_D702_QUALIFICATION_ARTIFACT_DIGEST,
		d702GenerationArtifactDigest: D703_D702_GENERATION_ARTIFACT_DIGEST,
		d702QualificationDigest: D703_D702_QUALIFICATION_DIGEST,
		d702ImplementationCommit: D703_D702_IMPLEMENTATION_COMMIT,
		d702QualificationSourceDigest: D703_D702_QUALIFICATION_SOURCE_DIGEST,
		d702HostSourceDigest: D703_D702_HOST_SOURCE_DIGEST,
		d702BindingSourceDigest: D703_D702_BINDING_SOURCE_DIGEST,
		d702RunnerSourceDigest: D703_D702_RUNNER_SOURCE_DIGEST,
		nodeRuntimeVersion: D703_NODE_RUNTIME_VERSION,
		d693PolicyDigest: empiricalStrictJsonDigest(D693_ASSISTED_PROGRESS_POLICY),
		d695PolicyDigest: empiricalStrictJsonDigest(D695_NO_PROGRESS_CONTINUATION_POLICY),
		d702PolicyDigest: empiricalStrictJsonDigest(D702_STALE_RESULT_RECOVERY_POLICY),
		focusedValidationCommandDigest: D694_FOCUSED_VALIDATION_COMMAND_DIGEST,
		underlyingObservationDigest: empiricalStrictJsonDigest(underlying),
		underlying,
		focusedValidationReceipts: derived.receipts,
		continuationInvocations,
		mutationFirstInvocations,
		noProgressReceipts: boundedReceipts,
		completedRunsSatisfiedObjectiveProgress: derived.completedRunsSatisfiedObjectiveProgress,
		relevantActionTraceBoundToMemory: derived.relevantActionTraceBoundToMemory,
		mutationFirstRecoveryObserved,
		matchedPairEvaluable: matchedPairEvaluable(underlying),
	});
	const observation = strictSnapshot({
		...material,
		observationDigest: empiricalStrictJsonDigest(material),
	});
	constructedObservations.add(observation);
	const operationalQualification = await buildD703PreLiveOperationalQualification({
		observation,
		transportCalls,
		maximumConcurrentTransportCalls,
		retryWaitCalls,
		trackedWorkspaceRoots,
	});
	return Object.freeze({
		observation,
		scorecard: createD703Scorecard(observation),
		operationalQualification,
		protectionExecutor: result.protectionExecutor,
	});
}

export function validateD703Observation(value: unknown): D703MutationFirstObservationV1 {
	const candidate = record(value, "d703.observation");
	const expectedKeys: readonly (keyof D703MutationFirstObservationV1)[] = [
		"causalAttribution",
		"claimBoundary",
		"completedRunsSatisfiedObjectiveProgress",
		"continuationInvocations",
		"d693PolicyDigest",
		"d695PolicyDigest",
		"d699GenerationArtifactDigest",
		"d699DispatchClaimArtifactDigest",
		"d699DispatchClaimDigest",
		"d699ObservationArtifactDigest",
		"d699ObservationDigest",
		"d699ScorecardArtifactDigest",
		"d702GenerationArtifactDigest",
		"d702BindingSourceDigest",
		"d702HostSourceDigest",
		"d702ImplementationCommit",
		"d702PolicyDigest",
		"d702QualificationArtifactDigest",
		"d702QualificationDigest",
		"d702QualificationSourceDigest",
		"d702RunnerSourceDigest",
		"efficacyClaim",
		"executionClass",
		"focusedValidationCommandDigest",
		"focusedValidationReceipts",
		"matchedPairEvaluable",
		"mutationFirstInvocations",
		"mutationFirstRecoveryObserved",
		"nodeRuntimeVersion",
		"noProgressReceipts",
		"observationDigest",
		"relevantActionTraceBoundToMemory",
		"schemaVersion",
		"underlying",
		"underlyingObservationDigest",
	];
	exactKeys(candidate, expectedKeys, "d703.observation");
	literal(candidate.schemaVersion, D703_OBSERVATION_SCHEMA, "d703.schema");
	literal(candidate.claimBoundary, D703_CLAIM_BOUNDARY, "d703.claimBoundary");
	literal(candidate.causalAttribution, "undetermined", "d703.causalAttribution");
	literal(candidate.efficacyClaim, "none", "d703.efficacyClaim");
	literal(candidate.executionClass, "simulated-contract", "d703.executionClass");
	for (const [actual, expected, path] of [
		[
			candidate.d699ObservationArtifactDigest,
			D703_D699_OBSERVATION_ARTIFACT_DIGEST,
			"d699ObservationArtifact",
		],
		[
			candidate.d699ScorecardArtifactDigest,
			D703_D699_SCORECARD_ARTIFACT_DIGEST,
			"d699ScorecardArtifact",
		],
		[
			candidate.d699GenerationArtifactDigest,
			D703_D699_GENERATION_ARTIFACT_DIGEST,
			"d699GenerationArtifact",
		],
		[candidate.d699ObservationDigest, D703_D699_OBSERVATION_DIGEST, "d699ObservationDigest"],
		[
			candidate.d699DispatchClaimArtifactDigest,
			D703_D699_DISPATCH_CLAIM_ARTIFACT_DIGEST,
			"d699DispatchClaimArtifactDigest",
		],
		[candidate.d699DispatchClaimDigest, D703_D699_DISPATCH_CLAIM_DIGEST, "d699DispatchClaimDigest"],
		[
			candidate.d702QualificationArtifactDigest,
			D703_D702_QUALIFICATION_ARTIFACT_DIGEST,
			"d702QualificationArtifact",
		],
		[
			candidate.d702GenerationArtifactDigest,
			D703_D702_GENERATION_ARTIFACT_DIGEST,
			"d702GenerationArtifact",
		],
		[candidate.d702QualificationDigest, D703_D702_QUALIFICATION_DIGEST, "d702QualificationDigest"],
		[
			candidate.d702ImplementationCommit,
			D703_D702_IMPLEMENTATION_COMMIT,
			"d702ImplementationCommit",
		],
		[
			candidate.d702QualificationSourceDigest,
			D703_D702_QUALIFICATION_SOURCE_DIGEST,
			"d702QualificationSourceDigest",
		],
		[candidate.d702HostSourceDigest, D703_D702_HOST_SOURCE_DIGEST, "d702HostSourceDigest"],
		[candidate.d702BindingSourceDigest, D703_D702_BINDING_SOURCE_DIGEST, "d702BindingSourceDigest"],
		[candidate.d702RunnerSourceDigest, D703_D702_RUNNER_SOURCE_DIGEST, "d702RunnerSourceDigest"],
		[candidate.nodeRuntimeVersion, D703_NODE_RUNTIME_VERSION, "nodeRuntimeVersion"],
		[
			candidate.d693PolicyDigest,
			empiricalStrictJsonDigest(D693_ASSISTED_PROGRESS_POLICY),
			"d693PolicyDigest",
		],
		[
			candidate.d695PolicyDigest,
			empiricalStrictJsonDigest(D695_NO_PROGRESS_CONTINUATION_POLICY),
			"d695PolicyDigest",
		],
		[
			candidate.d702PolicyDigest,
			empiricalStrictJsonDigest(D702_STALE_RESULT_RECOVERY_POLICY),
			"d702PolicyDigest",
		],
		[
			candidate.focusedValidationCommandDigest,
			D694_FOCUSED_VALIDATION_COMMAND_DIGEST,
			"focusedCommandDigest",
		],
	] as const)
		literal(actual, expected, `d703.${path}`);
	const underlying = validateEmpiricalTrialBlockObservation(candidate.underlying);
	literal(
		candidate.underlyingObservationDigest,
		empiricalStrictJsonDigest(underlying),
		"d703.underlyingDigest",
	);
	const focusedValidationReceipts = array(
		candidate.focusedValidationReceipts,
		"d703.focusedReceipts",
	).map(validateD694FocusedValidationReceipt);
	const derived = deriveD694AssistedProgress(underlying, focusedValidationReceipts);
	const continuationInvocations = array(
		candidate.continuationInvocations,
		"d703.continuations",
	).map(validateD703ContinuationInvocationFact);
	const mutationFirstInvocations = array(candidate.mutationFirstInvocations, "d703.mutations").map(
		validateD703MutationFirstInvocationFact,
	);
	const noProgressReceipts = array(candidate.noProgressReceipts, "d703.receipts").map(
		validateD703NoProgressReceipt,
	);
	if (
		continuationInvocations.length > 576 ||
		mutationFirstInvocations.length > STAGES.length * 3 ||
		noProgressReceipts.length > 192
	) {
		throw new TypeError("D703 mechanism evidence bound exceeded");
	}
	const recovery = deriveD703MutationFirstRecoveryLifecycle(
		underlying,
		derived.receipts,
		continuationInvocations,
		mutationFirstInvocations,
		noProgressReceipts,
	);
	const withoutDigest = strictSnapshot({
		...candidate,
		underlying,
		focusedValidationReceipts: derived.receipts,
		continuationInvocations: strictSnapshot(continuationInvocations),
		mutationFirstInvocations: strictSnapshot(mutationFirstInvocations),
		noProgressReceipts: strictSnapshot(noProgressReceipts),
		completedRunsSatisfiedObjectiveProgress: derived.completedRunsSatisfiedObjectiveProgress,
		relevantActionTraceBoundToMemory: derived.relevantActionTraceBoundToMemory,
		mutationFirstRecoveryObserved: recovery,
		matchedPairEvaluable: matchedPairEvaluable(underlying),
	}) as unknown as D703MutationFirstObservationV1;
	const { observationDigest, ...material } = withoutDigest;
	literal(observationDigest, empiricalStrictJsonDigest(material), "d703.observationDigest");
	return strictSnapshot({ ...material, observationDigest });
}

export function createD703Scorecard(
	value: D703MutationFirstObservationV1,
): D703MutationFirstScorecardV1 {
	const observation = validateD703Observation(value);
	const completed = observation.underlying.result.classification === "complete";
	const material = strictSnapshot({
		schemaVersion: D703_SCORECARD_SCHEMA,
		claimBoundary: D703_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		observationDigests: [observation.observationDigest] as const,
		attemptedBlocks: 1 as const,
		completedBlocks: completed ? (1 as const) : (0 as const),
		evaluablePairs: observation.matchedPairEvaluable ? (1 as const) : (0 as const),
		continuationInvocationCount: observation.continuationInvocations.length,
		mutationFirstInvocationCount: observation.mutationFirstInvocations.length,
		noProgressRejectionCount: observation.noProgressReceipts.length,
		mutationFirstRecoveryObserved: observation.mutationFirstRecoveryObserved,
		status: observation.matchedPairEvaluable
			? ("complete-matched-pair-no-efficacy-claim" as const)
			: observation.mutationFirstRecoveryObserved
				? ("mechanical-recovery-no-matched-pair" as const)
				: ("incomplete" as const),
	});
	const scorecard = strictSnapshot({
		...material,
		scorecardDigest: empiricalStrictJsonDigest(material),
	});
	constructedScorecards.add(scorecard);
	return scorecard;
}

export function validateD703Scorecard(
	value: unknown,
	observation: D703MutationFirstObservationV1,
): D703MutationFirstScorecardV1 {
	const candidate = record(value, "d703.scorecard");
	const expected = createD703Scorecard(observation);
	if (empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(expected)) {
		throw new TypeError("D703 scorecard is not exactly derived from its observation");
	}
	return expected;
}

export function validateD703DryRunArtifactBytes(value: unknown): {
	readonly observationDigest: typeof D703_DRY_RUN_OBSERVATION_DIGEST;
	readonly scorecardDigest: typeof D703_DRY_RUN_SCORECARD_DIGEST;
	readonly generationDigest: typeof D703_DRY_RUN_GENERATION_DIGEST;
} {
	const bytes = captureArtifactBytes(value, "d703.dryRunArtifacts", [
		"observationBytes",
		"scorecardBytes",
		"generationBytes",
	]);
	for (const [key, expected] of [
		["observationBytes", D703_DRY_RUN_OBSERVATION_ARTIFACT_DIGEST],
		["scorecardBytes", D703_DRY_RUN_SCORECARD_ARTIFACT_DIGEST],
		["generationBytes", D703_DRY_RUN_GENERATION_ARTIFACT_DIGEST],
	] as const) {
		if (empiricalSha256(bytes[key]!) !== expected) {
			throw new TypeError(`D703 rejected frozen dry-run ${key}`);
		}
	}
	const observationDecoded = strictJsonCodec.decode(bytes.observationBytes!);
	assertCanonicalBytes(observationDecoded, bytes.observationBytes!, "d703.dryRun.observation");
	const observation = validateD703Observation(observationDecoded);
	literal(
		observation.observationDigest,
		D703_DRY_RUN_OBSERVATION_DIGEST,
		"d703.dryRun.observationDigest",
	);
	literal(observation.mutationFirstRecoveryObserved, true, "d703.dryRun.recoveryObserved");
	literal(observation.matchedPairEvaluable, false, "d703.dryRun.matchedPairEvaluable");
	literal(observation.underlying.result.costMicrousd, 0, "d703.dryRun.cost");
	const scorecardDecoded = strictJsonCodec.decode(bytes.scorecardBytes!);
	assertCanonicalBytes(scorecardDecoded, bytes.scorecardBytes!, "d703.dryRun.scorecard");
	const scorecard = validateD703Scorecard(scorecardDecoded, observation);
	literal(scorecard.scorecardDigest, D703_DRY_RUN_SCORECARD_DIGEST, "d703.dryRun.scorecardDigest");
	literal(scorecard.status, "mechanical-recovery-no-matched-pair", "d703.dryRun.status");
	const generationDecoded = strictJsonCodec.decode(bytes.generationBytes!);
	assertCanonicalBytes(generationDecoded, bytes.generationBytes!, "d703.dryRun.generation");
	const generation = record(generationDecoded, "d703.dryRun.generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"claimBoundary",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"observation",
			"preLiveOperationalQualification",
			"schemaVersion",
			"scorecard",
		],
		"d703.dryRun.generation",
	);
	literal(generation.schemaVersion, D703_GENERATION_SCHEMA, "d703.dryRun.generation.schema");
	literal(
		generation.generationRef,
		"d703-mutation-first-no-network-dry-run-2026-08-09-v3",
		"d703.dryRun.generation.ref",
	);
	literal(generation.claimBoundary, D703_CLAIM_BOUNDARY, "d703.dryRun.generation.claim");
	literal(generation.causalAttribution, "undetermined", "d703.dryRun.generation.attribution");
	literal(generation.efficacyClaim, "none", "d703.dryRun.generation.efficacy");
	for (const [key, file, expected] of [
		["observation", "mutation-first-observation.v1.json", D703_DRY_RUN_OBSERVATION_DIGEST],
		["scorecard", "mutation-first-scorecard.v1.json", D703_DRY_RUN_SCORECARD_DIGEST],
	] as const) {
		const ref = record(generation[key], `d703.dryRun.generation.${key}`);
		exactKeys(ref, ["digest", "file"], `d703.dryRun.generation.${key}`);
		literal(ref.file, file, `d703.dryRun.generation.${key}.file`);
		literal(ref.digest, expected, `d703.dryRun.generation.${key}.digest`);
	}
	validateD703PreLiveOperationalQualification(
		generation.preLiveOperationalQualification,
		observation,
	);
	literal(
		generation.generationDigest,
		D703_DRY_RUN_GENERATION_DIGEST,
		"d703.dryRun.generation.digest",
	);
	const { generationDigest, ...generationMaterial } = generation;
	if (empiricalStrictJsonDigest(generationMaterial) !== generationDigest) {
		throw new TypeError("D703 rejected tampered dry-run generation");
	}
	return Object.freeze({
		observationDigest: D703_DRY_RUN_OBSERVATION_DIGEST,
		scorecardDigest: D703_DRY_RUN_SCORECARD_DIGEST,
		generationDigest: D703_DRY_RUN_GENERATION_DIGEST,
	});
}

export async function assertD703TrackedWorkspaceRootsClean(
	workspaceRoots: readonly string[],
): Promise<void> {
	if (
		!Array.isArray(workspaceRoots) ||
		workspaceRoots.length === 0 ||
		workspaceRoots.length > STAGES.length
	) {
		throw new TypeError("D703 tracked workspace roots must cover one bounded trial block");
	}
	const seen = new Set<string>();
	for (const [index, workspaceRoot] of workspaceRoots.entries()) {
		if (
			typeof workspaceRoot !== "string" ||
			workspaceRoot.length === 0 ||
			workspaceRoot.length > 4_096 ||
			seen.has(workspaceRoot)
		) {
			throw new TypeError(`D703 tracked workspace root ${index} is invalid or duplicated`);
		}
		seen.add(workspaceRoot);
		try {
			await lstat(workspaceRoot);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		throw new TypeError(`D703 tracked workspace root ${index} was not cleaned`);
	}
}

async function buildD703PreLiveOperationalQualification(input: {
	readonly observation: D703MutationFirstObservationV1;
	readonly transportCalls: number;
	readonly maximumConcurrentTransportCalls: number;
	readonly retryWaitCalls: number;
	readonly trackedWorkspaceRoots: readonly string[];
}): Promise<D703PreLiveOperationalQualificationV1> {
	if (!constructedObservations.has(input.observation as object)) {
		throw new TypeError("D703 operational qualification requires its same-process observation");
	}
	const observation = validateD703Observation(input.observation);
	const transportCalls = safeInteger(input.transportCalls, "d703.operational.transportCalls", {
		min: 1,
		max: 576,
	});
	literal(
		transportCalls,
		observation.underlying.result.requests,
		"d703.operational.requestBinding",
	);
	literal(
		input.maximumConcurrentTransportCalls,
		1,
		"d703.operational.maximumConcurrentTransportCalls",
	);
	const expectedRetryWaitCalls = STAGES.reduce(
		(total, stage) =>
			total + (runForStage(observation.underlying, stage)?.retryWaitTrace.length ?? 0),
		0,
	);
	const retryWaitCalls = safeInteger(input.retryWaitCalls, "d703.operational.retryWaitCalls", {
		min: 0,
		max: STAGES.length * 2,
	});
	literal(retryWaitCalls, expectedRetryWaitCalls, "d703.operational.retryWaitBinding");
	await assertD703TrackedWorkspaceRootsClean(input.trackedWorkspaceRoots);
	const networkProbe = await execFileAsync(
		process.execPath,
		[
			"-e",
			"const net=require('node:net');const s=net.connect({host:'127.0.0.1',port:9});s.on('error',e=>{process.stdout.write(String(e.code));process.exit(e.code==='EPERM'?0:2)});setTimeout(()=>process.exit(3),1000)",
		],
		{ encoding: "utf8", timeout: 5_000 },
	);
	if (networkProbe.stdout !== "EPERM") {
		throw new TypeError("D703 no-network sandbox probe was not blocked by OS policy");
	}
	const material = strictSnapshot({
		schemaVersion: D703_OPERATIONAL_QUALIFICATION_SCHEMA,
		observationDigest: observation.observationDigest,
		isolationProfile: "macos-sandbox-deny-network.v1" as const,
		networkProbeDisposition: "blocked-by-os-policy-eperm" as const,
		transportKind: "injected-byte-transport" as const,
		transportCalls,
		maximumConcurrentTransportCalls: 1 as const,
		retryWaitCalls,
		fallbackUsed: false as const,
		providerSwitchUsed: false as const,
		initialWorkspaceCleanupPassed: true as const,
		workspaceResidueCount: 0 as const,
	});
	const qualification = strictSnapshot({
		...material,
		qualificationDigest: empiricalStrictJsonDigest(material),
	});
	constructedOperationalQualifications.add(qualification);
	return qualification;
}

function validateD703PreLiveOperationalQualification(
	value: unknown,
	observation: D703MutationFirstObservationV1,
): D703PreLiveOperationalQualificationV1 {
	const candidate = record(value, "d703.operationalQualification.persisted");
	exactKeys(
		candidate,
		[
			"fallbackUsed",
			"initialWorkspaceCleanupPassed",
			"isolationProfile",
			"maximumConcurrentTransportCalls",
			"networkProbeDisposition",
			"observationDigest",
			"providerSwitchUsed",
			"qualificationDigest",
			"retryWaitCalls",
			"schemaVersion",
			"transportCalls",
			"transportKind",
			"workspaceResidueCount",
		],
		"d703.operationalQualification.persisted",
	);
	literal(
		candidate.schemaVersion,
		D703_OPERATIONAL_QUALIFICATION_SCHEMA,
		"d703.operational.schema",
	);
	literal(
		candidate.observationDigest,
		observation.observationDigest,
		"d703.operational.observationDigest",
	);
	const material = strictSnapshot({
		schemaVersion: D703_OPERATIONAL_QUALIFICATION_SCHEMA,
		observationDigest: observation.observationDigest,
		isolationProfile: literal(
			candidate.isolationProfile,
			"macos-sandbox-deny-network.v1",
			"d703.operational.isolationProfile",
		),
		networkProbeDisposition: literal(
			candidate.networkProbeDisposition,
			"blocked-by-os-policy-eperm",
			"d703.operational.networkProbeDisposition",
		),
		transportKind: literal(
			candidate.transportKind,
			"injected-byte-transport",
			"d703.operational.transportKind",
		),
		transportCalls: safeInteger(candidate.transportCalls, "d703.operational.transportCalls", {
			min: 1,
			max: 576,
		}),
		maximumConcurrentTransportCalls: literal(
			candidate.maximumConcurrentTransportCalls,
			1,
			"d703.operational.maximumConcurrentTransportCalls",
		),
		retryWaitCalls: safeInteger(candidate.retryWaitCalls, "d703.operational.retryWaitCalls", {
			min: 0,
			max: STAGES.length * 2,
		}),
		fallbackUsed: literal(candidate.fallbackUsed, false, "d703.operational.fallbackUsed"),
		providerSwitchUsed: literal(
			candidate.providerSwitchUsed,
			false,
			"d703.operational.providerSwitchUsed",
		),
		initialWorkspaceCleanupPassed: literal(
			candidate.initialWorkspaceCleanupPassed,
			true,
			"d703.operational.initialWorkspaceCleanupPassed",
		),
		workspaceResidueCount: literal(
			candidate.workspaceResidueCount,
			0,
			"d703.operational.workspaceResidueCount",
		),
	});
	literal(
		material.transportCalls,
		observation.underlying.result.requests,
		"d703.operational.requestBinding",
	);
	const expectedRetryWaitCalls = STAGES.reduce(
		(total, stage) =>
			total + (runForStage(observation.underlying, stage)?.retryWaitTrace.length ?? 0),
		0,
	);
	literal(material.retryWaitCalls, expectedRetryWaitCalls, "d703.operational.retryWaitBinding");
	const qualificationDigest = literal(
		candidate.qualificationDigest,
		empiricalStrictJsonDigest(material),
		"d703.operational.digest",
	);
	return strictSnapshot({ ...material, qualificationDigest });
}

export async function persistD703PrivateGeneration(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly observation: D703MutationFirstObservationV1;
	readonly scorecard: D703MutationFirstScorecardV1;
	readonly operationalQualification: D703PreLiveOperationalQualificationV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}): Promise<{
	readonly generationPath: string;
	readonly observationDigest: string;
	readonly scorecardDigest: string;
	readonly generationDigest: string;
}> {
	const request = record(input, "d703.persistence");
	exactKeys(
		request,
		[
			"generationRef",
			"observation",
			"operationalQualification",
			"privateRoot",
			"protectionExecutor",
			"scorecard",
		],
		"d703.persistence",
	);
	if (!constructedObservations.has(request.observation as object))
		throw new TypeError("D703 persistence requires same-process observation");
	const observation = validateD703Observation(request.observation);
	const scorecard = createD703Scorecard(observation);
	if (!constructedOperationalQualifications.has(request.operationalQualification as object)) {
		throw new TypeError("D703 persistence requires same-process operational qualification");
	}
	const operationalQualification = validateD703PreLiveOperationalQualification(
		request.operationalQualification,
		observation,
	);
	if (
		!constructedScorecards.has(request.scorecard as object) ||
		empiricalStrictJsonDigest(request.scorecard) !== empiricalStrictJsonDigest(scorecard)
	) {
		throw new TypeError("D703 persistence requires same-process derived scorecard");
	}
	if (!isEmpiricalExactPrivateNeedleProtectionExecutor(request.protectionExecutor))
		throw new TypeError("D703 persistence requires constructed protection");
	if (
		typeof request.generationRef !== "string" ||
		!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(request.generationRef)
	)
		throw new TypeError("D703 generation ref invalid");
	const privateRoot = await assertSafePrivateRoot(D703_PRIVATE_PERSISTENCE_ROOT);
	if (request.privateRoot !== privateRoot) throw new TypeError("D703 persistence root drifted");
	const generationRef = request.generationRef;
	const generationMaterial = strictSnapshot({
		schemaVersion: D703_GENERATION_SCHEMA,
		generationRef,
		claimBoundary: D703_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		observation: {
			file: "mutation-first-observation.v1.json",
			digest: observation.observationDigest,
		},
		scorecard: { file: "mutation-first-scorecard.v1.json", digest: scorecard.scorecardDigest },
		preLiveOperationalQualification: operationalQualification,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	for (const [label, subject] of [
		["D703 observation", observation],
		["D703 scorecard", scorecard],
		["D703 generation", generation],
	] as const) {
		assertPrivateArtifactProtection({
			label,
			subject,
			protectionExecutor:
				request.protectionExecutor as EmpiricalExactPrivateNeedleProtectionExecutorV1,
		});
	}
	const finalPath = join(privateRoot, generationRef);
	try {
		await lstat(finalPath);
		throw new TypeError("D703 generation already exists");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const stagingPath = join(privateRoot, `.d703-staging-${randomUUID()}`);
	const files = Object.freeze([
		{ file: "mutation-first-observation.v1.json", bytes: strictJsonCodec.encode(observation) },
		{ file: "mutation-first-scorecard.v1.json", bytes: strictJsonCodec.encode(scorecard) },
		{ file: "generation.v1.json", bytes: strictJsonCodec.encode(generation) },
	]);
	try {
		await mkdir(stagingPath, { mode: 0o700 });
		for (const file of files) await writePrivateFile(join(stagingPath, file.file), file.bytes);
		await syncDirectory(stagingPath);
		for (const file of files) {
			const persisted = new Uint8Array(await readFile(join(stagingPath, file.file)));
			if (!sameBytes(persisted, file.bytes))
				throw new TypeError("D703 persistence readback failed");
		}
		await commitD696PrivateStagingDirectory({ stagingPath, finalPath, privateRoot });
	} catch (error) {
		await failD696PrivateStagingGeneration(stagingPath, error);
	}
	return Object.freeze({
		generationPath: finalPath,
		observationDigest: observation.observationDigest,
		scorecardDigest: scorecard.scorecardDigest,
		generationDigest: generation.generationDigest,
	});
}
