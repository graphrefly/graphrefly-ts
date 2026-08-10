import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	safeInteger,
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
	type D694FocusedValidationReceiptV1,
	deriveD694AssistedProgress,
	validateD694FocusedValidationReceipt,
} from "./d694-assisted-progress-live.js";
import { D695_NO_PROGRESS_CONTINUATION_POLICY } from "./d695-no-progress-continuation-qualification.js";
import {
	commitD696PrivateStagingDirectory,
	D696_BUDGET,
	failD696PrivateStagingGeneration,
} from "./d696-continuation-assisted-live.js";
import { D702_STALE_RESULT_RECOVERY_POLICY } from "./d702-mutation-first-recovery-qualification.js";
import {
	assertD703TrackedWorkspaceRootsClean,
	consumeD703PreflightForD705,
	D703_D699_OBSERVATION_DIGEST,
	D703_D702_QUALIFICATION_DIGEST,
	D703_DRY_RUN_GENERATION_DIGEST,
	type D703PreflightCapabilityV1,
	deriveD703MutationFirstRecoveryLifecycle,
	validateD703ContinuationInvocationFact,
	validateD703DryRunArtifactBytes,
	validateD703MutationFirstInvocationFact,
	validateD703NoProgressReceipt,
} from "./d703-mutation-first-recovery-live.js";
import {
	consumeD704ConsumedDispatchHistoryCapability,
	D704_CONSUMED_DISPATCH_CLAIM_ARTIFACT_DIGEST,
	D704_CONSUMED_DISPATCH_CLAIM_DIGEST,
	type D704ConsumedDispatchHistoryCapabilityV1,
} from "./d704-single-use-dispatch-claim.js";
import {
	consumeD705ConsumedDispatchHistoryCapability,
	D705_CONSUMED_DISPATCH_CLAIM_ARTIFACT_DIGEST,
	D705_CONSUMED_DISPATCH_CLAIM_DIGEST,
	type D705ConsumedDispatchHistoryCapabilityV1,
} from "./d705-single-use-dispatch-claim.js";
import {
	D707_PRELIVE_GENERATION_DIGEST,
	validateD707PreLiveArtifactBytes,
} from "./d707-fresh-pricing-preflight.js";
import {
	consumeD708OfficialPricingRead,
	D708_OFFICIAL_PRICING_MAX_PRECLAIM_AGE_MS,
	type D708OfficialPricingReadV1,
	validateD708OfficialPricingRead,
} from "./d708-official-pricing-live.js";
import {
	type AcquiredD708SingleUseDispatchClaimV1,
	consumeD708SingleUseDispatchClaim,
	D708_LIVE_GENERATION_REF,
} from "./d708-single-use-dispatch-claim.js";
import {
	consumeD708FreshZeroByokQualification,
	type D708ZeroByokAttestationV1,
	validateD708ZeroByokAttestation,
} from "./d708-zero-byok-qualification.js";
import {
	type EmpiricalTrialBlockObservationV3,
	validateEmpiricalTrialBlockObservation,
} from "./empirical-smoke-evidence.js";
import {
	type EmpiricalExactPrivateNeedleProtectionExecutorV1,
	isEmpiricalExactPrivateNeedleProtectionExecutor,
} from "./exact-private-needle-protection.js";
import { createD691HistoricalReflectionCapability } from "./matched-block-memory.js";
import type { OpenRouterCurrentKeySpendAdmissionV1 } from "./openrouter-current-key-spend-admission.js";
import {
	type OpenRouterContinuationInvocationFactV1,
	type OpenRouterFirstTaskRetryWaitCapabilityV1,
	type OpenRouterMatchedTrialBlockInputV4,
	type OpenRouterMutationFirstInvocationFactV1,
	runOpenRouterMatchedTrialBlock,
} from "./openrouter-first-task-smoke.js";
import type { OpenRouterResponsesByteTransportV1 } from "./openrouter-responses-model-turn.js";
import {
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
	type OpenRouterRouteQualificationV1,
} from "./openrouter-route-qualification.js";
import {
	assertPrivateArtifactProtection,
	assertSafePrivateRoot,
	syncDirectory,
	writePrivateFile,
} from "./private-smoke-persistence.js";

export const D708_OBSERVATION_SCHEMA =
	"graphrefly.private-solution-eval.d708-mutation-first-live-observation.v1" as const;
export const D708_SCORECARD_SCHEMA =
	"graphrefly.private-solution-eval.d708-mutation-first-live-scorecard.v1" as const;
export const D708_GENERATION_SCHEMA =
	"graphrefly.private-solution-eval.d708-mutation-first-live-generation.v1" as const;
export const D708_CLAIM_BOUNDARY =
	"single-d707-fresh-pricing-separated-d702-mutation-first-live-no-efficacy-claim" as const;
export const D708_APPROVAL_REF = "decision.D708" as const;
export const D708_APPROVAL_REVISION = "decision.D708.2026-08-09.v1" as const;
export const D708_PRICING_REVISION = OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION;
export const D708_BUDGET = Object.freeze({ ...D696_BUDGET });
export const D708_PRIVATE_PERSISTENCE_ROOT = D691_PRIVATE_PERSISTENCE_ROOT;

const STAGES = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);

export interface D708MutationFirstObservationV1 {
	readonly schemaVersion: typeof D708_OBSERVATION_SCHEMA;
	readonly claimBoundary: typeof D708_CLAIM_BOUNDARY;
	readonly decisionRef: typeof D708_APPROVAL_REF;
	readonly decisionRevision: typeof D708_APPROVAL_REVISION;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly executionClass: "live-provider";
	readonly d699ObservationDigest: typeof D703_D699_OBSERVATION_DIGEST;
	readonly d702QualificationDigest: typeof D703_D702_QUALIFICATION_DIGEST;
	readonly d703DryRunGenerationDigest: typeof D703_DRY_RUN_GENERATION_DIGEST;
	readonly d707PreLiveGenerationDigest: typeof D707_PRELIVE_GENERATION_DIGEST;
	readonly freshPricingRead: D708OfficialPricingReadV1;
	readonly sharedCapacityQualificationDigest: string;
	readonly freshZeroByokAttestation: D708ZeroByokAttestationV1;
	readonly zeroByokAttestationDigest: string;
	readonly zeroByokProviderCount: number;
	readonly d704DispatchClaimArtifactDigest: typeof D704_CONSUMED_DISPATCH_CLAIM_ARTIFACT_DIGEST;
	readonly d704DispatchClaimDigest: typeof D704_CONSUMED_DISPATCH_CLAIM_DIGEST;
	readonly d705DispatchClaimArtifactDigest: typeof D705_CONSUMED_DISPATCH_CLAIM_ARTIFACT_DIGEST;
	readonly d705DispatchClaimDigest: typeof D705_CONSUMED_DISPATCH_CLAIM_DIGEST;
	readonly d705LiveGenerationAbsent: true;
	readonly dispatchClaimDigest: string;
	readonly currentKeyAdmissionDigest: string;
	readonly currentKeyLimitMicrousd: 32_000_000;
	readonly currentKeyRemainingMicrousd: number;
	readonly currentKeyUsageMicrousd: number;
	readonly currentKeyLimitReset: "none";
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
	readonly transportCalls: number;
	readonly maximumConcurrentTransportCalls: 1;
	readonly retryWaitCalls: number;
	readonly fallbackUsed: false;
	readonly providerSwitchUsed: false;
	readonly workspaceResidueCount: 0;
	readonly observationDigest: string;
}

export interface D708MutationFirstScorecardV1 {
	readonly schemaVersion: typeof D708_SCORECARD_SCHEMA;
	readonly claimBoundary: typeof D708_CLAIM_BOUNDARY;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly observationDigests: readonly [string];
	readonly attemptedBlocks: 1;
	readonly completedBlocks: 0 | 1;
	readonly evaluablePairs: 0 | 1;
	readonly mutationFirstRecoveryObserved: boolean;
	readonly status:
		| "mechanical-recovery-no-matched-pair"
		| "complete-matched-pair-no-efficacy-claim"
		| "incomplete";
	readonly scorecardDigest: string;
}

export interface D708PreflightCapabilityV1 {
	readonly capabilityRef: "d708-exact-live-preflight";
	readonly capabilityRevision: typeof D708_APPROVAL_REVISION;
	readonly executionClass: "live-provider";
}

export interface D708DispatchClaimAuthorizationV1 {
	readonly capabilityRef: "d708-fresh-preflight-dispatch-authorization";
	readonly capabilityRevision: typeof D708_APPROVAL_REVISION;
}

interface D708PreflightState {
	readonly d703Preflight: D703PreflightCapabilityV1;
	readonly d690OfflineEvidence: ReturnType<typeof validateD691D690OfflineEvidence>;
	readonly d704History: D704ConsumedDispatchHistoryCapabilityV1;
	readonly d705History: D705ConsumedDispatchHistoryCapabilityV1;
	readonly pricingRead: D708OfficialPricingReadV1;
	readonly pricingCompletedMonotonicMs: number;
	readonly zeroByokAttestation: D708ZeroByokAttestationV1;
	readonly zeroByokAttestationDigest: string;
	readonly zeroByokProviderCount: number;
	readonly sharedCapacityQualification: OpenRouterRouteQualificationV1["sharedCapacityQualification"];
}

const constructedPreflights = new WeakMap<object, D708PreflightState>();
const claimAuthorizedPreflights = new WeakSet<object>();
const dispatchClaimAuthorizations = new WeakMap<
	object,
	{ readonly preflight: D708PreflightCapabilityV1; readonly expiresAtMonotonicMs: number }
>();
const constructedObservations = new WeakSet<object>();
const constructedScorecards = new WeakSet<object>();
const observationsInPersistence = new WeakSet<object>();
const scorecardsInPersistence = new WeakSet<object>();

export function createD708PreflightCapability(value: unknown): D708PreflightCapabilityV1 {
	const input = record(value, "d708.preflight");
	exactKeys(
		input,
		[
			"d690OfflineEvidence",
			"d703DryRunArtifacts",
			"d703Preflight",
			"d704ConsumedDispatchHistory",
			"d705ConsumedDispatchHistory",
			"d707PreLiveArtifacts",
			"executionClass",
			"freshZeroByokQualification",
			"freshPricingRead",
		],
		"d708.preflight",
	);
	literal(input.executionClass, "live-provider", "d708.preflight.executionClass");
	if (input.d703Preflight === null || typeof input.d703Preflight !== "object") {
		throw new TypeError("D708 requires a constructed D703 preflight");
	}
	validateD703DryRunArtifactBytes(input.d703DryRunArtifacts);
	const d707 = validateD707PreLiveArtifactBytes(input.d707PreLiveArtifacts);
	literal(d707.generationDigest, D707_PRELIVE_GENERATION_DIGEST, "d708.d707.generation");
	const pricing = consumeD708OfficialPricingRead(input.freshPricingRead);
	literal(
		pricing.match.frozenScheduleRevision,
		D708_PRICING_REVISION,
		"d708.freshPricing.schedule",
	);
	const zeroByok = consumeD708FreshZeroByokQualification(input.freshZeroByokQualification);
	const sharedCapacityQualification = strictSnapshot(
		zeroByok.sharedCapacityQualification,
	) as unknown as OpenRouterRouteQualificationV1["sharedCapacityQualification"];
	literal(
		sharedCapacityQualification.schemaVersion,
		"graphrefly.private-solution-eval.openrouter-shared-capacity-qualification.v1",
		"d708.sharedCapacityQualification.schema",
	);
	literal(
		sharedCapacityQualification.capacityMode,
		"openrouter-shared-only",
		"d708.sharedCapacityQualification.capacityMode",
	);
	literal(
		sharedCapacityQualification.qualified,
		true,
		"d708.sharedCapacityQualification.qualified",
	);
	literal(
		sharedCapacityQualification.byokCredentialCount,
		0,
		"d708.sharedCapacityQualification.byokCredentialCount",
	);
	const d690OfflineEvidence = validateD691D690OfflineEvidence(
		input.d690OfflineEvidence,
		"live-provider",
	);
	const d704History = consumeD704ConsumedDispatchHistoryCapability(
		input.d704ConsumedDispatchHistory,
	);
	const d705History = consumeD705ConsumedDispatchHistoryCapability(
		input.d705ConsumedDispatchHistory,
	);
	literal(
		d690OfflineEvidence.evidenceDigest,
		D691_QUALIFIED_D690_OFFLINE_EVIDENCE_DIGEST,
		"d708.d690.evidenceDigest",
	);
	const capability = Object.freeze({
		capabilityRef: "d708-exact-live-preflight" as const,
		capabilityRevision: D708_APPROVAL_REVISION,
		executionClass: "live-provider" as const,
	});
	constructedPreflights.set(capability, {
		d703Preflight: input.d703Preflight as D703PreflightCapabilityV1,
		d690OfflineEvidence,
		d704History,
		d705History,
		pricingRead: pricing.read,
		pricingCompletedMonotonicMs: pricing.completedMonotonicMs,
		zeroByokAttestation: zeroByok.attestation,
		zeroByokAttestationDigest: zeroByok.attestation.attestationDigest,
		zeroByokProviderCount: zeroByok.attestation.byokProviderCount,
		sharedCapacityQualification,
	});
	return capability;
}

export function authorizeD708PreflightForDispatchClaim(
	value: D708PreflightCapabilityV1,
	monotonicNowMs: number,
): D708DispatchClaimAuthorizationV1 {
	const state = constructedPreflights.get(value as object);
	if (state === undefined) throw new TypeError("D708 dispatch requires its same-process preflight");
	if (!Number.isFinite(monotonicNowMs) || monotonicNowMs < state.pricingCompletedMonotonicMs) {
		throw new TypeError("D708 pricing freshness clock is invalid");
	}
	if (
		monotonicNowMs - state.pricingCompletedMonotonicMs >
		D708_OFFICIAL_PRICING_MAX_PRECLAIM_AGE_MS
	) {
		throw new TypeError("D708 official pricing observation expired before dispatch claim");
	}
	const authorization = Object.freeze({
		capabilityRef: "d708-fresh-preflight-dispatch-authorization" as const,
		capabilityRevision: D708_APPROVAL_REVISION,
	});
	dispatchClaimAuthorizations.set(authorization, {
		preflight: value,
		expiresAtMonotonicMs:
			state.pricingCompletedMonotonicMs + D708_OFFICIAL_PRICING_MAX_PRECLAIM_AGE_MS,
	});
	return authorization;
}

export function consumeD708DispatchClaimAuthorization(
	value: unknown,
	monotonicNowMs: number,
): D708PreflightCapabilityV1 {
	if (value === null || typeof value !== "object") {
		throw new TypeError("D708 claim requires its fresh preflight authorization");
	}
	const state = dispatchClaimAuthorizations.get(value);
	if (state === undefined || !dispatchClaimAuthorizations.delete(value)) {
		throw new TypeError("D708 claim authorization is not same-process and single-use");
	}
	if (
		!Number.isFinite(monotonicNowMs) ||
		monotonicNowMs < 0 ||
		monotonicNowMs > state.expiresAtMonotonicMs
	) {
		throw new TypeError("D708 official pricing observation expired at dispatch claim");
	}
	claimAuthorizedPreflights.add(state.preflight as object);
	return state.preflight;
}

function captureBlock(value: unknown): OpenRouterMatchedTrialBlockInputV4 {
	const block = record(value, "d708.block");
	const host = record(block.host, "d708.block.host");
	for (const key of [
		"objectiveProgressPolicy",
		"actionReceiptObserver",
		"noProgressContinuationPolicy",
		"continuationModelTurnPort",
		"noProgressReceiptObserver",
		"staleResultRecoveryPolicy",
		"mutationFirstContinuationModelTurnPort",
	] as const) {
		if (Object.hasOwn(host, key)) throw new TypeError(`D708 owns host.${key}`);
	}
	return Object.freeze({
		...block,
		routeQualification: strictSnapshot(record(block.routeQualification, "d708.block.route")),
		host: Object.freeze({
			...host,
			frozen: strictSnapshot(record(host.frozen, "d708.block.host.frozen")),
			qualificationReport: strictSnapshot(
				record(host.qualificationReport, "d708.block.host.qualificationReport"),
			),
			initialRequest: strictSnapshot(record(host.initialRequest, "d708.block.host.initialRequest")),
			taskProfile: strictSnapshot(record(host.taskProfile, "d708.block.host.taskProfile")),
		}),
	}) as unknown as OpenRouterMatchedTrialBlockInputV4;
}

function validateBlock(block: OpenRouterMatchedTrialBlockInputV4): void {
	validateD691HistoricalTransferBlockCoordinates(block);
	const command = block.host.taskProfile.commandPolicy.commands.find(
		(candidate) => candidate.commandRef === D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
	);
	if (
		block.executionClass !== "live-provider" ||
		block.routeQualification.dispatchMode !== "live-approved" ||
		block.routeQualification.budget.approvalRef !== D708_APPROVAL_REF ||
		block.routeQualification.budget.approvalRevision !== D708_APPROVAL_REVISION ||
		block.routeQualification.pricing.pricingRevision !== D708_PRICING_REVISION ||
		empiricalStrictJsonDigest(command) !== D694_FOCUSED_VALIDATION_COMMAND_DIGEST
	) {
		throw new TypeError("D708 block drifted from its exact live baseline");
	}
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

function noProgressObserver(
	receipts: ClosedNoProgressReceiptV1[],
): ClosedNoProgressReceiptObserverV1 {
	return Object.freeze({
		observerRef: "d708-no-progress-receipt-observer",
		observerRevision: D708_APPROVAL_REVISION,
		record(receipt: ClosedNoProgressReceiptV1) {
			if (receipts.length >= STAGES.length * 32) {
				throw new TypeError("D708 no-progress receipt bound exhausted");
			}
			receipts.push(validateD703NoProgressReceipt(receipt));
		},
	});
}

function runForStage(underlying: EmpiricalTrialBlockObservationV3, stage: (typeof STAGES)[number]) {
	if (stage === "cold") return underlying.cold;
	return underlying.warmBranches.find((branch) => branch.branchKind === stage)?.run ?? null;
}

function validateCurrentKeyAdmission(value: unknown): OpenRouterCurrentKeySpendAdmissionV1 {
	const candidate = record(value, "d708.currentKeyAdmission");
	exactKeys(
		candidate,
		[
			"admissionDigest",
			"isManagementKey",
			"limitMicrousd",
			"limitReset",
			"remainingMicrousd",
			"schemaVersion",
			"usageMicrousd",
		],
		"d708.currentKeyAdmission",
	);
	literal(
		candidate.schemaVersion,
		"graphrefly.private-solution-eval.openrouter-current-key-spend-admission.v1",
		"d708.currentKeyAdmission.schema",
	);
	literal(candidate.limitMicrousd, 32_000_000, "d708.currentKeyAdmission.limit");
	const remainingMicrousd = safeInteger(
		candidate.remainingMicrousd,
		"d708.currentKeyAdmission.remaining",
		{ min: D708_BUDGET.maxSpendMicrousd, max: 32_000_000 },
	);
	const usageMicrousd = safeInteger(candidate.usageMicrousd, "d708.currentKeyAdmission.usage", {
		min: 0,
		max: 32_000_000,
	});
	literal(candidate.limitReset, "none", "d708.currentKeyAdmission.limitReset");
	literal(candidate.isManagementKey, false, "d708.currentKeyAdmission.management");
	const admitted = strictSnapshot({
		schemaVersion:
			"graphrefly.private-solution-eval.openrouter-current-key-spend-admission.v1" as const,
		limitMicrousd: 32_000_000 as const,
		remainingMicrousd,
		usageMicrousd,
		limitReset: "none" as const,
		isManagementKey: false as const,
	});
	literal(
		digest(candidate.admissionDigest, "d708.currentKeyAdmission.digest"),
		empiricalStrictJsonDigest(admitted),
		"d708.currentKeyAdmission.digest",
	);
	return strictSnapshot(candidate) as unknown as OpenRouterCurrentKeySpendAdmissionV1;
}

export async function runD708MutationFirstBlock(input: {
	readonly preflight: D708PreflightCapabilityV1;
	readonly dispatchClaim: AcquiredD708SingleUseDispatchClaimV1;
	readonly block: OpenRouterMatchedTrialBlockInputV4;
}): Promise<{
	readonly observation: D708MutationFirstObservationV1;
	readonly scorecard: D708MutationFirstScorecardV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}> {
	const outer = record(input, "d708.input");
	exactKeys(outer, ["block", "dispatchClaim", "preflight"], "d708.input");
	const state = constructedPreflights.get(outer.preflight as object);
	if (state === undefined) throw new TypeError("D708 requires its same-process preflight");
	if (!claimAuthorizedPreflights.delete(outer.preflight as object)) {
		throw new TypeError("D708 preflight was not freshly authorized for its dispatch claim");
	}
	constructedPreflights.delete(outer.preflight as object);
	const dispatchClaim = consumeD708SingleUseDispatchClaim(outer.dispatchClaim);
	const currentKeyAdmission = validateCurrentKeyAdmission(
		dispatchClaim.currentKeyExecutionAdmission.admission,
	);
	const d703State = consumeD703PreflightForD705(state.d703Preflight);
	if (d703State.d690OfflineEvidence.evidenceDigest !== state.d690OfflineEvidence.evidenceDigest) {
		throw new TypeError("D708 D690 preflight evidence mismatch");
	}
	const block = captureBlock(outer.block);
	validateBlock(block);
	if (
		dispatchClaim.currentKeyExecutionAdmission.credentialBindingRef !==
			block.routeQualification.keySpendLimit.credentialBindingRef ||
		dispatchClaim.currentKeyExecutionAdmission.credentialBindingRevision !==
			block.routeQualification.keySpendLimit.credentialBindingRevision
	) {
		throw new TypeError("D708 current-key admission drifted from the execution credential");
	}
	if (
		empiricalStrictJsonDigest(block.routeQualification.sharedCapacityQualification) !==
		empiricalStrictJsonDigest(state.sharedCapacityQualification)
	) {
		throw new TypeError("D708 block drifted from its pre-claim zero-BYOK qualification");
	}
	if (
		block.routeQualification.keySpendLimit.limitMicrousd !== currentKeyAdmission.limitMicrousd ||
		block.routeQualification.keySpendLimit.remainingMicrousd !==
			currentKeyAdmission.remainingMicrousd ||
		block.routeQualification.keySpendLimit.limitReset !== currentKeyAdmission.limitReset
	) {
		throw new TypeError("D708 route drifted from its post-claim current-key admission");
	}
	const historical = d703State.historicalObservation.underlying;
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
		throw new TypeError("D708 block drifted from exact D699 historical coordinates");
	}
	const transferMemory = createD690HistoricalTransferMemory();
	if (
		empiricalStrictJsonDigest(transferMemory) !== state.d690OfflineEvidence.transferMemoryDigest
	) {
		throw new TypeError("D708 transfer memory drifted from D690 evidence");
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
			if (activeTransportCalls !== 0) {
				throw new TypeError("D708 forbids parallel provider transport before dispatch");
			}
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
	if (result.profile !== "smoke") throw new TypeError("D708 requires smoke evidence");
	assertD691HistoricalTransferUnderlyingCoordinates(result.observation, block);
	const underlying = validateEmpiricalTrialBlockObservation(result.observation);
	const derived = deriveD694AssistedProgress(underlying, focusedReceipts);
	if (
		result.continuationInvocations === undefined ||
		result.mutationFirstInvocations === undefined
	) {
		throw new TypeError("D708 matched runner omitted treatment invocation facts");
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
	await assertD703TrackedWorkspaceRootsClean(trackedWorkspaceRoots);
	const material = strictSnapshot({
		schemaVersion: D708_OBSERVATION_SCHEMA,
		claimBoundary: D708_CLAIM_BOUNDARY,
		decisionRef: D708_APPROVAL_REF,
		decisionRevision: D708_APPROVAL_REVISION,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		executionClass: "live-provider" as const,
		d699ObservationDigest: D703_D699_OBSERVATION_DIGEST,
		d702QualificationDigest: D703_D702_QUALIFICATION_DIGEST,
		d703DryRunGenerationDigest: D703_DRY_RUN_GENERATION_DIGEST,
		d707PreLiveGenerationDigest: D707_PRELIVE_GENERATION_DIGEST,
		freshPricingRead: state.pricingRead,
		freshZeroByokAttestation: state.zeroByokAttestation,
		sharedCapacityQualificationDigest: empiricalStrictJsonDigest(state.sharedCapacityQualification),
		zeroByokAttestationDigest: state.zeroByokAttestationDigest,
		zeroByokProviderCount: state.zeroByokProviderCount,
		d704DispatchClaimArtifactDigest: state.d704History.claimArtifactDigest,
		d704DispatchClaimDigest: state.d704History.claimDigest,
		d705DispatchClaimArtifactDigest: state.d705History.claimArtifactDigest,
		d705DispatchClaimDigest: state.d705History.claimDigest,
		d705LiveGenerationAbsent: state.d705History.liveGenerationAbsent,
		dispatchClaimDigest: dispatchClaim.claimDigest,
		currentKeyAdmissionDigest: currentKeyAdmission.admissionDigest,
		currentKeyLimitMicrousd: currentKeyAdmission.limitMicrousd as 32_000_000,
		currentKeyRemainingMicrousd: currentKeyAdmission.remainingMicrousd,
		currentKeyUsageMicrousd: currentKeyAdmission.usageMicrousd,
		currentKeyLimitReset: currentKeyAdmission.limitReset,
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
		transportCalls,
		maximumConcurrentTransportCalls: maximumConcurrentTransportCalls as 1,
		retryWaitCalls,
		fallbackUsed: false as const,
		providerSwitchUsed: false as const,
		workspaceResidueCount: 0 as const,
	});
	const observation = strictSnapshot({
		...material,
		observationDigest: empiricalStrictJsonDigest(material),
	});
	validateD708Observation(observation);
	constructedObservations.add(observation);
	return Object.freeze({
		observation,
		scorecard: createD708Scorecard(observation),
		protectionExecutor: result.protectionExecutor,
	});
}

export function validateD708Observation(value: unknown): D708MutationFirstObservationV1 {
	const candidate = record(value, "d708.observation");
	const keys: readonly (keyof D708MutationFirstObservationV1)[] = [
		"causalAttribution",
		"claimBoundary",
		"completedRunsSatisfiedObjectiveProgress",
		"continuationInvocations",
		"currentKeyAdmissionDigest",
		"currentKeyLimitMicrousd",
		"currentKeyLimitReset",
		"currentKeyRemainingMicrousd",
		"currentKeyUsageMicrousd",
		"d693PolicyDigest",
		"d695PolicyDigest",
		"d699ObservationDigest",
		"d702PolicyDigest",
		"d702QualificationDigest",
		"d703DryRunGenerationDigest",
		"d707PreLiveGenerationDigest",
		"d704DispatchClaimArtifactDigest",
		"d704DispatchClaimDigest",
		"d705DispatchClaimArtifactDigest",
		"d705DispatchClaimDigest",
		"d705LiveGenerationAbsent",
		"decisionRef",
		"decisionRevision",
		"dispatchClaimDigest",
		"efficacyClaim",
		"executionClass",
		"fallbackUsed",
		"focusedValidationCommandDigest",
		"focusedValidationReceipts",
		"freshPricingRead",
		"freshZeroByokAttestation",
		"sharedCapacityQualificationDigest",
		"matchedPairEvaluable",
		"maximumConcurrentTransportCalls",
		"mutationFirstInvocations",
		"mutationFirstRecoveryObserved",
		"noProgressReceipts",
		"observationDigest",
		"providerSwitchUsed",
		"relevantActionTraceBoundToMemory",
		"retryWaitCalls",
		"schemaVersion",
		"transportCalls",
		"underlying",
		"underlyingObservationDigest",
		"workspaceResidueCount",
		"zeroByokAttestationDigest",
		"zeroByokProviderCount",
	];
	exactKeys(candidate, keys, "d708.observation");
	literal(candidate.schemaVersion, D708_OBSERVATION_SCHEMA, "d708.schema");
	literal(candidate.claimBoundary, D708_CLAIM_BOUNDARY, "d708.claimBoundary");
	literal(candidate.decisionRef, D708_APPROVAL_REF, "d708.decisionRef");
	literal(candidate.decisionRevision, D708_APPROVAL_REVISION, "d708.decisionRevision");
	literal(candidate.causalAttribution, "undetermined", "d708.causalAttribution");
	literal(candidate.efficacyClaim, "none", "d708.efficacyClaim");
	literal(candidate.executionClass, "live-provider", "d708.executionClass");
	literal(candidate.d699ObservationDigest, D703_D699_OBSERVATION_DIGEST, "d708.d699");
	literal(candidate.d702QualificationDigest, D703_D702_QUALIFICATION_DIGEST, "d708.d702");
	literal(candidate.d703DryRunGenerationDigest, D703_DRY_RUN_GENERATION_DIGEST, "d708.d703");
	literal(candidate.d707PreLiveGenerationDigest, D707_PRELIVE_GENERATION_DIGEST, "d708.d707");
	const freshPricingRead = validateD708OfficialPricingRead(candidate.freshPricingRead);
	const freshZeroByokAttestation = validateD708ZeroByokAttestation(
		candidate.freshZeroByokAttestation,
	);
	const expectedSharedCapacityQualification = strictSnapshot({
		schemaVersion:
			"graphrefly.private-solution-eval.openrouter-shared-capacity-qualification.v1" as const,
		qualificationRef: "openrouter-local-eval-2-zero-byok",
		qualificationRevision: freshZeroByokAttestation.qualificationRevision,
		credentialBindingRef: freshZeroByokAttestation.credentialBindingRef,
		credentialBindingRevision: freshZeroByokAttestation.credentialBindingRevision,
		workspaceRef: freshZeroByokAttestation.workspaceRef,
		workspaceRevision: freshZeroByokAttestation.workspaceRevision,
		capacityMode: "openrouter-shared-only" as const,
		qualified: true as const,
		byokCredentialCount: 0 as const,
	});
	literal(
		digest(candidate.sharedCapacityQualificationDigest, "d708.sharedCapacityQualificationDigest"),
		empiricalStrictJsonDigest(expectedSharedCapacityQualification),
		"d708.sharedCapacityQualificationDigest",
	);
	literal(
		digest(candidate.zeroByokAttestationDigest, "d708.zeroByokAttestationDigest"),
		freshZeroByokAttestation.attestationDigest,
		"d708.zeroByokAttestationDigest",
	);
	literal(
		safeInteger(candidate.zeroByokProviderCount, "d708.zeroByokProviderCount", {
			min: 1,
			max: 256,
		}),
		freshZeroByokAttestation.byokProviderCount,
		"d708.zeroByokProviderCount",
	);
	literal(
		candidate.d704DispatchClaimArtifactDigest,
		D704_CONSUMED_DISPATCH_CLAIM_ARTIFACT_DIGEST,
		"d708.d704ClaimArtifact",
	);
	literal(candidate.d704DispatchClaimDigest, D704_CONSUMED_DISPATCH_CLAIM_DIGEST, "d708.d704Claim");
	literal(
		candidate.d705DispatchClaimArtifactDigest,
		D705_CONSUMED_DISPATCH_CLAIM_ARTIFACT_DIGEST,
		"d708.d705ClaimArtifact",
	);
	literal(candidate.d705DispatchClaimDigest, D705_CONSUMED_DISPATCH_CLAIM_DIGEST, "d708.d705Claim");
	literal(candidate.d705LiveGenerationAbsent, true, "d708.d705GenerationAbsent");
	digest(candidate.dispatchClaimDigest, "d708.dispatchClaimDigest");
	const currentKeyMaterial = strictSnapshot({
		schemaVersion:
			"graphrefly.private-solution-eval.openrouter-current-key-spend-admission.v1" as const,
		limitMicrousd: literal(candidate.currentKeyLimitMicrousd, 32_000_000, "d708.currentKey.limit"),
		remainingMicrousd: safeInteger(
			candidate.currentKeyRemainingMicrousd,
			"d708.currentKey.remaining",
			{
				min: D708_BUDGET.maxSpendMicrousd,
				max: 32_000_000,
			},
		),
		usageMicrousd: safeInteger(candidate.currentKeyUsageMicrousd, "d708.currentKey.usage", {
			min: 0,
			max: 32_000_000,
		}),
		limitReset: literal(candidate.currentKeyLimitReset, "none", "d708.currentKey.reset"),
		isManagementKey: false as const,
	});
	literal(
		digest(candidate.currentKeyAdmissionDigest, "d708.currentKey.digest"),
		empiricalStrictJsonDigest(currentKeyMaterial),
		"d708.currentKey.digest",
	);
	literal(
		candidate.d693PolicyDigest,
		empiricalStrictJsonDigest(D693_ASSISTED_PROGRESS_POLICY),
		"d708.d693Policy",
	);
	literal(
		candidate.d695PolicyDigest,
		empiricalStrictJsonDigest(D695_NO_PROGRESS_CONTINUATION_POLICY),
		"d708.d695Policy",
	);
	literal(
		candidate.d702PolicyDigest,
		empiricalStrictJsonDigest(D702_STALE_RESULT_RECOVERY_POLICY),
		"d708.d702Policy",
	);
	literal(
		candidate.focusedValidationCommandDigest,
		D694_FOCUSED_VALIDATION_COMMAND_DIGEST,
		"d708.focusedCommand",
	);
	const underlying = validateEmpiricalTrialBlockObservation(candidate.underlying);
	literal(underlying.executionClass, "live-provider", "d708.underlying.executionClass");
	literal(underlying.route.budgetApprovalRef, D708_APPROVAL_REF, "d708.route.approvalRef");
	literal(
		underlying.route.budgetApprovalRevision,
		D708_APPROVAL_REVISION,
		"d708.route.approvalRevision",
	);
	literal(underlying.route.pricingRevision, D708_PRICING_REVISION, "d708.route.pricingRevision");
	literal(
		candidate.underlyingObservationDigest,
		empiricalStrictJsonDigest(underlying),
		"d708.underlyingDigest",
	);
	const focusedValidationReceipts = array(
		candidate.focusedValidationReceipts,
		"d708.focusedReceipts",
	).map(validateD694FocusedValidationReceipt);
	const derived = deriveD694AssistedProgress(underlying, focusedValidationReceipts);
	const continuationInvocations = array(
		candidate.continuationInvocations,
		"d708.continuations",
	).map(validateD703ContinuationInvocationFact);
	const mutationFirstInvocations = array(candidate.mutationFirstInvocations, "d708.mutations").map(
		validateD703MutationFirstInvocationFact,
	);
	const noProgressReceipts = array(candidate.noProgressReceipts, "d708.receipts").map(
		validateD703NoProgressReceipt,
	);
	if (
		continuationInvocations.length > 576 ||
		mutationFirstInvocations.length > STAGES.length * 3 ||
		noProgressReceipts.length > 192
	) {
		throw new TypeError("D708 mechanism evidence bound exceeded");
	}
	const recovery = deriveD703MutationFirstRecoveryLifecycle(
		underlying,
		derived.receipts,
		continuationInvocations,
		mutationFirstInvocations,
		noProgressReceipts,
	);
	literal(
		candidate.completedRunsSatisfiedObjectiveProgress,
		derived.completedRunsSatisfiedObjectiveProgress,
		"d708.objectiveProgress",
	);
	literal(
		candidate.relevantActionTraceBoundToMemory,
		derived.relevantActionTraceBoundToMemory,
		"d708.memoryBinding",
	);
	literal(candidate.mutationFirstRecoveryObserved, recovery, "d708.recovery");
	literal(candidate.matchedPairEvaluable, matchedPairEvaluable(underlying), "d708.evaluable");
	literal(
		safeInteger(candidate.transportCalls, "d708.transportCalls", { min: 1, max: 576 }),
		underlying.result.requests,
		"d708.transportRequestBinding",
	);
	literal(candidate.maximumConcurrentTransportCalls, 1, "d708.maxConcurrency");
	const expectedRetryWaitCalls = STAGES.reduce(
		(total, stage) => total + (runForStage(underlying, stage)?.retryWaitTrace.length ?? 0),
		0,
	);
	literal(
		safeInteger(candidate.retryWaitCalls, "d708.retryWaitCalls", { min: 0, max: 12 }),
		expectedRetryWaitCalls,
		"d708.retryWaitBinding",
	);
	literal(candidate.fallbackUsed, false, "d708.fallbackUsed");
	literal(candidate.providerSwitchUsed, false, "d708.providerSwitchUsed");
	literal(candidate.workspaceResidueCount, 0, "d708.workspaceResidueCount");
	const material = strictSnapshot({
		...candidate,
		underlying,
		focusedValidationReceipts: derived.receipts,
		continuationInvocations: strictSnapshot(continuationInvocations),
		mutationFirstInvocations: strictSnapshot(mutationFirstInvocations),
		noProgressReceipts: strictSnapshot(noProgressReceipts),
		freshPricingRead,
		freshZeroByokAttestation,
		completedRunsSatisfiedObjectiveProgress: derived.completedRunsSatisfiedObjectiveProgress,
		relevantActionTraceBoundToMemory: derived.relevantActionTraceBoundToMemory,
		mutationFirstRecoveryObserved: recovery,
		matchedPairEvaluable: matchedPairEvaluable(underlying),
	}) as unknown as D708MutationFirstObservationV1;
	const { observationDigest, ...withoutDigest } = material;
	literal(observationDigest, empiricalStrictJsonDigest(withoutDigest), "d708.observationDigest");
	return strictSnapshot({ ...withoutDigest, observationDigest });
}

export function createD708Scorecard(
	value: D708MutationFirstObservationV1,
): D708MutationFirstScorecardV1 {
	const observation = validateD708Observation(value);
	const completed = observation.underlying.result.classification === "complete";
	const material = strictSnapshot({
		schemaVersion: D708_SCORECARD_SCHEMA,
		claimBoundary: D708_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		observationDigests: [observation.observationDigest] as const,
		attemptedBlocks: 1 as const,
		completedBlocks: completed ? (1 as const) : (0 as const),
		evaluablePairs: observation.matchedPairEvaluable ? (1 as const) : (0 as const),
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

export async function persistD708PrivateGeneration(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly observation: D708MutationFirstObservationV1;
	readonly scorecard: D708MutationFirstScorecardV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}): Promise<{
	readonly generationPath: string;
	readonly observationDigest: string;
	readonly scorecardDigest: string;
	readonly generationDigest: string;
}> {
	const request = record(input, "d708.persistence");
	exactKeys(
		request,
		["generationRef", "observation", "privateRoot", "protectionExecutor", "scorecard"],
		"d708.persistence",
	);
	if (
		!constructedObservations.has(request.observation as object) ||
		observationsInPersistence.has(request.observation as object)
	) {
		throw new TypeError("D708 persistence requires same-process observation");
	}
	observationsInPersistence.add(request.observation as object);
	const observation = validateD708Observation(request.observation);
	const scorecard = createD708Scorecard(observation);
	constructedScorecards.delete(scorecard as object);
	if (
		!constructedScorecards.has(request.scorecard as object) ||
		scorecardsInPersistence.has(request.scorecard as object) ||
		empiricalStrictJsonDigest(request.scorecard) !== empiricalStrictJsonDigest(scorecard)
	) {
		observationsInPersistence.delete(request.observation as object);
		throw new TypeError("D708 persistence requires same-process derived scorecard");
	}
	scorecardsInPersistence.add(request.scorecard as object);
	try {
		if (!isEmpiricalExactPrivateNeedleProtectionExecutor(request.protectionExecutor)) {
			throw new TypeError("D708 persistence requires constructed protection");
		}
		const generationRef = literal(
			request.generationRef,
			D708_LIVE_GENERATION_REF,
			"d708.generationRef",
		);
		const privateRoot = await assertSafePrivateRoot(D708_PRIVATE_PERSISTENCE_ROOT);
		if (request.privateRoot !== privateRoot) throw new TypeError("D708 persistence root drifted");
		const generationMaterial = strictSnapshot({
			schemaVersion: D708_GENERATION_SCHEMA,
			generationRef,
			claimBoundary: D708_CLAIM_BOUNDARY,
			causalAttribution: "undetermined" as const,
			efficacyClaim: "none" as const,
			observation: {
				file: "fresh-pricing-live-observation.v1.json",
				digest: observation.observationDigest,
			},
			scorecard: {
				file: "fresh-pricing-live-scorecard.v1.json",
				digest: scorecard.scorecardDigest,
			},
		});
		const generation = strictSnapshot({
			...generationMaterial,
			generationDigest: empiricalStrictJsonDigest(generationMaterial),
		});
		for (const [label, subject] of [
			["D708 observation", observation],
			["D708 scorecard", scorecard],
			["D708 generation", generation],
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
			throw new TypeError("D708 generation already exists");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const stagingPath = join(privateRoot, `.d708-staging-${randomUUID()}`);
		const files = Object.freeze([
			{
				file: "fresh-pricing-live-observation.v1.json",
				bytes: strictJsonCodec.encode(observation),
			},
			{ file: "fresh-pricing-live-scorecard.v1.json", bytes: strictJsonCodec.encode(scorecard) },
			{ file: "generation.v1.json", bytes: strictJsonCodec.encode(generation) },
		]);
		try {
			await mkdir(stagingPath, { mode: 0o700 });
			for (const file of files) await writePrivateFile(join(stagingPath, file.file), file.bytes);
			await syncDirectory(stagingPath);
			for (const file of files) {
				const persisted = new Uint8Array(await readFile(join(stagingPath, file.file)));
				if (!Buffer.from(persisted).equals(file.bytes)) {
					throw new TypeError(`D708 staging readback failed for ${file.file}`);
				}
			}
			await commitD696PrivateStagingDirectory({ stagingPath, finalPath, privateRoot });
			observationsInPersistence.delete(request.observation as object);
			scorecardsInPersistence.delete(request.scorecard as object);
			constructedObservations.delete(request.observation as object);
			constructedScorecards.delete(request.scorecard as object);
			return Object.freeze({
				generationPath: finalPath,
				observationDigest: observation.observationDigest,
				scorecardDigest: scorecard.scorecardDigest,
				generationDigest: generation.generationDigest,
			});
		} catch (error) {
			observationsInPersistence.delete(request.observation as object);
			scorecardsInPersistence.delete(request.scorecard as object);
			return failD696PrivateStagingGeneration(stagingPath, error);
		}
	} catch (error) {
		observationsInPersistence.delete(request.observation as object);
		scorecardsInPersistence.delete(request.scorecard as object);
		throw error;
	}
}
