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
	consumeD703PreflightForD704,
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
	type AcquiredD704SingleUseDispatchClaimV1,
	consumeD704SingleUseDispatchClaim,
} from "./d704-single-use-dispatch-claim.js";
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

export const D704_OBSERVATION_SCHEMA =
	"graphrefly.private-solution-eval.d704-mutation-first-live-observation.v1" as const;
export const D704_SCORECARD_SCHEMA =
	"graphrefly.private-solution-eval.d704-mutation-first-live-scorecard.v1" as const;
export const D704_GENERATION_SCHEMA =
	"graphrefly.private-solution-eval.d704-mutation-first-live-generation.v1" as const;
export const D704_CLAIM_BOUNDARY =
	"single-controlled-d702-mutation-first-historical-transfer-live-no-efficacy-claim" as const;
export const D704_APPROVAL_REF = "decision.D704" as const;
export const D704_APPROVAL_REVISION = "decision.D704.2026-08-09.v1" as const;
export const D704_PRICING_REVISION =
	"openrouter-deepseek-v4-flash-0731-deepinfra-fp4-2026-08-09.v4" as const;
export const D704_BUDGET = Object.freeze({ ...D696_BUDGET });
export const D704_PRIVATE_PERSISTENCE_ROOT = D691_PRIVATE_PERSISTENCE_ROOT;

const STAGES = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);

export interface D704MutationFirstObservationV1 {
	readonly schemaVersion: typeof D704_OBSERVATION_SCHEMA;
	readonly claimBoundary: typeof D704_CLAIM_BOUNDARY;
	readonly decisionRef: typeof D704_APPROVAL_REF;
	readonly decisionRevision: typeof D704_APPROVAL_REVISION;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly executionClass: "live-provider";
	readonly d699ObservationDigest: typeof D703_D699_OBSERVATION_DIGEST;
	readonly d702QualificationDigest: typeof D703_D702_QUALIFICATION_DIGEST;
	readonly d703DryRunGenerationDigest: typeof D703_DRY_RUN_GENERATION_DIGEST;
	readonly dispatchClaimDigest: string;
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

export interface D704MutationFirstScorecardV1 {
	readonly schemaVersion: typeof D704_SCORECARD_SCHEMA;
	readonly claimBoundary: typeof D704_CLAIM_BOUNDARY;
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

export interface D704PreflightCapabilityV1 {
	readonly capabilityRef: "d704-exact-live-preflight";
	readonly capabilityRevision: typeof D704_APPROVAL_REVISION;
	readonly executionClass: "live-provider";
}

interface D704PreflightState {
	readonly d703Preflight: D703PreflightCapabilityV1;
	readonly d690OfflineEvidence: ReturnType<typeof validateD691D690OfflineEvidence>;
}

const constructedPreflights = new WeakMap<object, D704PreflightState>();
const constructedObservations = new WeakSet<object>();
const constructedScorecards = new WeakSet<object>();

export function createD704PreflightCapability(value: unknown): D704PreflightCapabilityV1 {
	const input = record(value, "d704.preflight");
	exactKeys(
		input,
		["d690OfflineEvidence", "d703DryRunArtifacts", "d703Preflight", "executionClass"],
		"d704.preflight",
	);
	literal(input.executionClass, "live-provider", "d704.preflight.executionClass");
	if (input.d703Preflight === null || typeof input.d703Preflight !== "object") {
		throw new TypeError("D704 requires a constructed D703 preflight");
	}
	validateD703DryRunArtifactBytes(input.d703DryRunArtifacts);
	const d690OfflineEvidence = validateD691D690OfflineEvidence(
		input.d690OfflineEvidence,
		"live-provider",
	);
	literal(
		d690OfflineEvidence.evidenceDigest,
		D691_QUALIFIED_D690_OFFLINE_EVIDENCE_DIGEST,
		"d704.d690.evidenceDigest",
	);
	const capability = Object.freeze({
		capabilityRef: "d704-exact-live-preflight" as const,
		capabilityRevision: D704_APPROVAL_REVISION,
		executionClass: "live-provider" as const,
	});
	constructedPreflights.set(capability, {
		d703Preflight: input.d703Preflight as D703PreflightCapabilityV1,
		d690OfflineEvidence,
	});
	return capability;
}

function captureBlock(value: unknown): OpenRouterMatchedTrialBlockInputV4 {
	const block = record(value, "d704.block");
	const host = record(block.host, "d704.block.host");
	for (const key of [
		"objectiveProgressPolicy",
		"actionReceiptObserver",
		"noProgressContinuationPolicy",
		"continuationModelTurnPort",
		"noProgressReceiptObserver",
		"staleResultRecoveryPolicy",
		"mutationFirstContinuationModelTurnPort",
	] as const) {
		if (Object.hasOwn(host, key)) throw new TypeError(`D704 owns host.${key}`);
	}
	return Object.freeze({
		...block,
		routeQualification: strictSnapshot(record(block.routeQualification, "d704.block.route")),
		host: Object.freeze({
			...host,
			frozen: strictSnapshot(record(host.frozen, "d704.block.host.frozen")),
			qualificationReport: strictSnapshot(
				record(host.qualificationReport, "d704.block.host.qualificationReport"),
			),
			initialRequest: strictSnapshot(record(host.initialRequest, "d704.block.host.initialRequest")),
			taskProfile: strictSnapshot(record(host.taskProfile, "d704.block.host.taskProfile")),
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
		block.routeQualification.budget.approvalRef !== D704_APPROVAL_REF ||
		block.routeQualification.budget.approvalRevision !== D704_APPROVAL_REVISION ||
		block.routeQualification.pricing.pricingRevision !== D704_PRICING_REVISION ||
		empiricalStrictJsonDigest(command) !== D694_FOCUSED_VALIDATION_COMMAND_DIGEST
	) {
		throw new TypeError("D704 block drifted from its exact live baseline");
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
		observerRef: "d704-no-progress-receipt-observer",
		observerRevision: D704_APPROVAL_REVISION,
		record(receipt: ClosedNoProgressReceiptV1) {
			if (receipts.length >= STAGES.length * 32) {
				throw new TypeError("D704 no-progress receipt bound exhausted");
			}
			receipts.push(validateD703NoProgressReceipt(receipt));
		},
	});
}

function runForStage(underlying: EmpiricalTrialBlockObservationV3, stage: (typeof STAGES)[number]) {
	if (stage === "cold") return underlying.cold;
	return underlying.warmBranches.find((branch) => branch.branchKind === stage)?.run ?? null;
}

export async function runD704MutationFirstBlock(input: {
	readonly preflight: D704PreflightCapabilityV1;
	readonly dispatchClaim: AcquiredD704SingleUseDispatchClaimV1;
	readonly block: OpenRouterMatchedTrialBlockInputV4;
}): Promise<{
	readonly observation: D704MutationFirstObservationV1;
	readonly scorecard: D704MutationFirstScorecardV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}> {
	const outer = record(input, "d704.input");
	exactKeys(outer, ["block", "dispatchClaim", "preflight"], "d704.input");
	const state = constructedPreflights.get(outer.preflight as object);
	if (state === undefined) throw new TypeError("D704 requires its same-process preflight");
	constructedPreflights.delete(outer.preflight as object);
	const dispatchClaim = consumeD704SingleUseDispatchClaim(outer.dispatchClaim);
	const d703State = consumeD703PreflightForD704(state.d703Preflight);
	if (d703State.d690OfflineEvidence.evidenceDigest !== state.d690OfflineEvidence.evidenceDigest) {
		throw new TypeError("D704 D690 preflight evidence mismatch");
	}
	const block = captureBlock(outer.block);
	validateBlock(block);
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
		throw new TypeError("D704 block drifted from exact D699 historical coordinates");
	}
	const transferMemory = createD690HistoricalTransferMemory();
	if (
		empiricalStrictJsonDigest(transferMemory) !== state.d690OfflineEvidence.transferMemoryDigest
	) {
		throw new TypeError("D704 transfer memory drifted from D690 evidence");
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
	if (result.profile !== "smoke") throw new TypeError("D704 requires smoke evidence");
	assertD691HistoricalTransferUnderlyingCoordinates(result.observation, block);
	const underlying = validateEmpiricalTrialBlockObservation(result.observation);
	const derived = deriveD694AssistedProgress(underlying, focusedReceipts);
	if (
		result.continuationInvocations === undefined ||
		result.mutationFirstInvocations === undefined
	) {
		throw new TypeError("D704 matched runner omitted treatment invocation facts");
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
		schemaVersion: D704_OBSERVATION_SCHEMA,
		claimBoundary: D704_CLAIM_BOUNDARY,
		decisionRef: D704_APPROVAL_REF,
		decisionRevision: D704_APPROVAL_REVISION,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		executionClass: "live-provider" as const,
		d699ObservationDigest: D703_D699_OBSERVATION_DIGEST,
		d702QualificationDigest: D703_D702_QUALIFICATION_DIGEST,
		d703DryRunGenerationDigest: D703_DRY_RUN_GENERATION_DIGEST,
		dispatchClaimDigest: dispatchClaim.claimDigest,
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
	validateD704Observation(observation);
	constructedObservations.add(observation);
	return Object.freeze({
		observation,
		scorecard: createD704Scorecard(observation),
		protectionExecutor: result.protectionExecutor,
	});
}

export function validateD704Observation(value: unknown): D704MutationFirstObservationV1 {
	const candidate = record(value, "d704.observation");
	const keys: readonly (keyof D704MutationFirstObservationV1)[] = [
		"causalAttribution",
		"claimBoundary",
		"completedRunsSatisfiedObjectiveProgress",
		"continuationInvocations",
		"d693PolicyDigest",
		"d695PolicyDigest",
		"d699ObservationDigest",
		"d702PolicyDigest",
		"d702QualificationDigest",
		"d703DryRunGenerationDigest",
		"decisionRef",
		"decisionRevision",
		"dispatchClaimDigest",
		"efficacyClaim",
		"executionClass",
		"fallbackUsed",
		"focusedValidationCommandDigest",
		"focusedValidationReceipts",
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
	];
	exactKeys(candidate, keys, "d704.observation");
	literal(candidate.schemaVersion, D704_OBSERVATION_SCHEMA, "d704.schema");
	literal(candidate.claimBoundary, D704_CLAIM_BOUNDARY, "d704.claimBoundary");
	literal(candidate.decisionRef, D704_APPROVAL_REF, "d704.decisionRef");
	literal(candidate.decisionRevision, D704_APPROVAL_REVISION, "d704.decisionRevision");
	literal(candidate.causalAttribution, "undetermined", "d704.causalAttribution");
	literal(candidate.efficacyClaim, "none", "d704.efficacyClaim");
	literal(candidate.executionClass, "live-provider", "d704.executionClass");
	literal(candidate.d699ObservationDigest, D703_D699_OBSERVATION_DIGEST, "d704.d699");
	literal(candidate.d702QualificationDigest, D703_D702_QUALIFICATION_DIGEST, "d704.d702");
	literal(candidate.d703DryRunGenerationDigest, D703_DRY_RUN_GENERATION_DIGEST, "d704.d703");
	digest(candidate.dispatchClaimDigest, "d704.dispatchClaimDigest");
	literal(
		candidate.d693PolicyDigest,
		empiricalStrictJsonDigest(D693_ASSISTED_PROGRESS_POLICY),
		"d704.d693Policy",
	);
	literal(
		candidate.d695PolicyDigest,
		empiricalStrictJsonDigest(D695_NO_PROGRESS_CONTINUATION_POLICY),
		"d704.d695Policy",
	);
	literal(
		candidate.d702PolicyDigest,
		empiricalStrictJsonDigest(D702_STALE_RESULT_RECOVERY_POLICY),
		"d704.d702Policy",
	);
	literal(
		candidate.focusedValidationCommandDigest,
		D694_FOCUSED_VALIDATION_COMMAND_DIGEST,
		"d704.focusedCommand",
	);
	const underlying = validateEmpiricalTrialBlockObservation(candidate.underlying);
	literal(underlying.executionClass, "live-provider", "d704.underlying.executionClass");
	literal(underlying.route.budgetApprovalRef, D704_APPROVAL_REF, "d704.route.approvalRef");
	literal(
		underlying.route.budgetApprovalRevision,
		D704_APPROVAL_REVISION,
		"d704.route.approvalRevision",
	);
	literal(underlying.route.pricingRevision, D704_PRICING_REVISION, "d704.route.pricingRevision");
	literal(
		candidate.underlyingObservationDigest,
		empiricalStrictJsonDigest(underlying),
		"d704.underlyingDigest",
	);
	const focusedValidationReceipts = array(
		candidate.focusedValidationReceipts,
		"d704.focusedReceipts",
	).map(validateD694FocusedValidationReceipt);
	const derived = deriveD694AssistedProgress(underlying, focusedValidationReceipts);
	const continuationInvocations = array(
		candidate.continuationInvocations,
		"d704.continuations",
	).map(validateD703ContinuationInvocationFact);
	const mutationFirstInvocations = array(candidate.mutationFirstInvocations, "d704.mutations").map(
		validateD703MutationFirstInvocationFact,
	);
	const noProgressReceipts = array(candidate.noProgressReceipts, "d704.receipts").map(
		validateD703NoProgressReceipt,
	);
	if (
		continuationInvocations.length > 576 ||
		mutationFirstInvocations.length > STAGES.length * 3 ||
		noProgressReceipts.length > 192
	) {
		throw new TypeError("D704 mechanism evidence bound exceeded");
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
		"d704.objectiveProgress",
	);
	literal(
		candidate.relevantActionTraceBoundToMemory,
		derived.relevantActionTraceBoundToMemory,
		"d704.memoryBinding",
	);
	literal(candidate.mutationFirstRecoveryObserved, recovery, "d704.recovery");
	literal(candidate.matchedPairEvaluable, matchedPairEvaluable(underlying), "d704.evaluable");
	literal(
		safeInteger(candidate.transportCalls, "d704.transportCalls", { min: 1, max: 576 }),
		underlying.result.requests,
		"d704.transportRequestBinding",
	);
	literal(candidate.maximumConcurrentTransportCalls, 1, "d704.maxConcurrency");
	const expectedRetryWaitCalls = STAGES.reduce(
		(total, stage) => total + (runForStage(underlying, stage)?.retryWaitTrace.length ?? 0),
		0,
	);
	literal(
		safeInteger(candidate.retryWaitCalls, "d704.retryWaitCalls", { min: 0, max: 12 }),
		expectedRetryWaitCalls,
		"d704.retryWaitBinding",
	);
	literal(candidate.fallbackUsed, false, "d704.fallbackUsed");
	literal(candidate.providerSwitchUsed, false, "d704.providerSwitchUsed");
	literal(candidate.workspaceResidueCount, 0, "d704.workspaceResidueCount");
	const material = strictSnapshot({
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
	}) as unknown as D704MutationFirstObservationV1;
	const { observationDigest, ...withoutDigest } = material;
	literal(observationDigest, empiricalStrictJsonDigest(withoutDigest), "d704.observationDigest");
	return strictSnapshot({ ...withoutDigest, observationDigest });
}

export function createD704Scorecard(
	value: D704MutationFirstObservationV1,
): D704MutationFirstScorecardV1 {
	const observation = validateD704Observation(value);
	const completed = observation.underlying.result.classification === "complete";
	const material = strictSnapshot({
		schemaVersion: D704_SCORECARD_SCHEMA,
		claimBoundary: D704_CLAIM_BOUNDARY,
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

export async function persistD704PrivateGeneration(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly observation: D704MutationFirstObservationV1;
	readonly scorecard: D704MutationFirstScorecardV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}): Promise<{
	readonly generationPath: string;
	readonly observationDigest: string;
	readonly scorecardDigest: string;
	readonly generationDigest: string;
}> {
	const request = record(input, "d704.persistence");
	exactKeys(
		request,
		["generationRef", "observation", "privateRoot", "protectionExecutor", "scorecard"],
		"d704.persistence",
	);
	if (!constructedObservations.has(request.observation as object)) {
		throw new TypeError("D704 persistence requires same-process observation");
	}
	const observation = validateD704Observation(request.observation);
	const scorecard = createD704Scorecard(observation);
	if (
		!constructedScorecards.has(request.scorecard as object) ||
		empiricalStrictJsonDigest(request.scorecard) !== empiricalStrictJsonDigest(scorecard)
	) {
		throw new TypeError("D704 persistence requires same-process derived scorecard");
	}
	if (!isEmpiricalExactPrivateNeedleProtectionExecutor(request.protectionExecutor)) {
		throw new TypeError("D704 persistence requires constructed protection");
	}
	if (
		typeof request.generationRef !== "string" ||
		!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(request.generationRef)
	) {
		throw new TypeError("D704 generation ref invalid");
	}
	const privateRoot = await assertSafePrivateRoot(D704_PRIVATE_PERSISTENCE_ROOT);
	if (request.privateRoot !== privateRoot) throw new TypeError("D704 persistence root drifted");
	const generationRef = request.generationRef;
	const generationMaterial = strictSnapshot({
		schemaVersion: D704_GENERATION_SCHEMA,
		generationRef,
		claimBoundary: D704_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		observation: {
			file: "mutation-first-live-observation.v1.json",
			digest: observation.observationDigest,
		},
		scorecard: { file: "mutation-first-live-scorecard.v1.json", digest: scorecard.scorecardDigest },
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	for (const [label, subject] of [
		["D704 observation", observation],
		["D704 scorecard", scorecard],
		["D704 generation", generation],
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
		throw new TypeError("D704 generation already exists");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const stagingPath = join(privateRoot, `.d704-staging-${randomUUID()}`);
	const files = Object.freeze([
		{ file: "mutation-first-live-observation.v1.json", bytes: strictJsonCodec.encode(observation) },
		{ file: "mutation-first-live-scorecard.v1.json", bytes: strictJsonCodec.encode(scorecard) },
		{ file: "generation.v1.json", bytes: strictJsonCodec.encode(generation) },
	]);
	try {
		await mkdir(stagingPath, { mode: 0o700 });
		for (const file of files) await writePrivateFile(join(stagingPath, file.file), file.bytes);
		await syncDirectory(stagingPath);
		for (const file of files) {
			const persisted = new Uint8Array(await readFile(join(stagingPath, file.file)));
			if (!Buffer.from(persisted).equals(file.bytes)) {
				throw new TypeError(`D704 staging readback failed for ${file.file}`);
			}
		}
		await commitD696PrivateStagingDirectory({ stagingPath, finalPath, privateRoot });
		return Object.freeze({
			generationPath: finalPath,
			observationDigest: observation.observationDigest,
			scorecardDigest: scorecard.scorecardDigest,
			generationDigest: generation.generationDigest,
		});
	} catch (error) {
		return failD696PrivateStagingGeneration(stagingPath, error);
	}
}
