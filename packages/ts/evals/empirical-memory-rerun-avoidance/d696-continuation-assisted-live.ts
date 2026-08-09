import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
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
import {
	createD690HistoricalTransferMemory,
	D690_FAILURE_MECHANISM_REF,
	D690_SOURCE,
	D690_TARGET_TASK_REF,
} from "./d690-historical-pair-qualification.js";
import {
	assertD691HistoricalTransferUnderlyingCoordinates,
	D691_BUDGET,
	D691_PRIVATE_PERSISTENCE_ROOT,
	D691_QUALIFIED_D690_OFFLINE_EVIDENCE_DIGEST,
	validateD691D690OfflineEvidence,
	validateD691HistoricalTransferBlockCoordinates,
} from "./d691-historical-transfer-live.js";
import { D693_ASSISTED_PROGRESS_POLICY } from "./d693-assisted-progress-qualification.js";
import {
	createD694FocusedReceiptObserver,
	createD694Scorecard,
	D694_ASSISTED_TRANSFER_GENERATION_VERSION,
	D694_BUDGET,
	D694_CLAIM_BOUNDARY,
	D694_D693_GENERATION_ARTIFACT_DIGEST,
	D694_D693_QUALIFICATION_ARTIFACT_DIGEST,
	D694_D693_QUALIFICATION_DIGEST,
	D694_FOCUSED_VALIDATION_COMMAND_DIGEST,
	D694_PRICING_REVISION,
	type D694FocusedValidationReceiptV1,
	deriveD694AssistedProgress,
	validateD694D693EvidenceBytes,
	validateD694Observation,
} from "./d694-assisted-progress-live.js";
import {
	D695_NO_PROGRESS_CONTINUATION_POLICY,
	D695_SCRIPTED_MECHANISM_REVISION,
} from "./d695-no-progress-continuation-qualification.js";
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
	type OpenRouterMatchedTrialBlockInputV4,
	runOpenRouterMatchedTrialBlock,
} from "./openrouter-first-task-smoke.js";
import { OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE } from "./openrouter-route-qualification.js";
import {
	assertPrivateArtifactProtection,
	assertSafePrivateRoot,
	syncDirectory,
	writePrivateFile,
} from "./private-smoke-persistence.js";

export const D696_CONTINUATION_ASSISTED_OBSERVATION_VERSION =
	"graphrefly.private-solution-eval.d696-continuation-assisted-observation.v1" as const;
export const D696_CONTINUATION_ASSISTED_SCORECARD_VERSION =
	"graphrefly.private-solution-eval.d696-continuation-assisted-scorecard.v1" as const;
export const D696_CONTINUATION_ASSISTED_GENERATION_VERSION =
	"graphrefly.private-solution-eval.d696-continuation-assisted-generation.v1" as const;
export const D696_CLAIM_BOUNDARY =
	"single-controlled-continuation-assisted-historical-transfer-block-exploratory-no-efficacy-claim" as const;
export const D696_BUDGET = Object.freeze({ ...D694_BUDGET });
export const D696_PRIVATE_PERSISTENCE_ROOT = D691_PRIVATE_PERSISTENCE_ROOT;
export const D696_D695_POLICY_DIGEST =
	"sha256:8796fcc6dfb0cad8fe319bc7321f7ef1f0484751053d79a06d27088d75b04a77" as const;
export const D696_D695_IMPLEMENTATION_COMMIT = "69a20d0d" as const;
/** Set only after a later authority decision records the user's final numeric live approval. */
export const D696_LIVE_SPEND_APPROVAL_REF: string | null = "decision.D699";
/** D699 is the single-use accounting-fixed replacement approval; D696 v1 remains pre-live only. */
export const D696_LIVE_SPEND_APPROVAL_REVISION: string | null = "decision.D699.2026-08-08.v1";
export const D696_D694_LIVE_OBSERVATION_ARTIFACT_DIGEST =
	"sha256:5bb86a20447b72ede94ef65e1420ac6ea0e34981cff11933d5c2d60b2116de11" as const;
export const D696_D694_LIVE_SCORECARD_ARTIFACT_DIGEST =
	"sha256:5ba906d4862a60c7341b24226c58c4c3187132b3030d4a5e0d64739c60de4e4a" as const;
export const D696_D694_LIVE_GENERATION_ARTIFACT_DIGEST =
	"sha256:13bd9d791df568fe0a6356f0f1d31e2c58de559190858e2bbf0cae08b2499b1a" as const;
export const D696_DRY_RUN_OBSERVATION_ARTIFACT_DIGEST =
	"sha256:0ca932a8fdeee642ead1910e638e1414c0227933914cd3aea1dacd1f4e347e95" as const;
export const D696_DRY_RUN_SCORECARD_ARTIFACT_DIGEST =
	"sha256:312585ed7c109aa39fbacf4f8e672c93c2f8ede691e1a0660c5cfb9a95f59875" as const;
export const D696_DRY_RUN_GENERATION_ARTIFACT_DIGEST =
	"sha256:ff73e4cd78e7cacc8a8ada067615e1459fef2b0b7f79a43a1b3ddd406c34d08c" as const;
export const D696_DRY_RUN_OBSERVATION_DIGEST =
	"sha256:1a1adc46bcab90f14ad46c99af2e832379873e684d802d9447aee61dc6f004c9" as const;
export const D696_DRY_RUN_SCORECARD_DIGEST =
	"sha256:50c6bc7f468fc77ed1dc8b8645526deb31643a934350ca28e99d911dd6b557ed" as const;
export const D696_DRY_RUN_GENERATION_DIGEST =
	"sha256:b2d6f849a8f9b2a5feec5dbf18f781ca93f903783745074ef8ed13b7c77c6d3c" as const;

const STAGE_ORDER = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);
type Stage = (typeof STAGE_ORDER)[number];

export type D696NoProgressReceiptV1 = ClosedNoProgressReceiptV1;

export interface D696ContinuationAssistedObservationV1 {
	readonly schemaVersion: typeof D696_CONTINUATION_ASSISTED_OBSERVATION_VERSION;
	readonly claimBoundary: typeof D696_CLAIM_BOUNDARY;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly executionClass: EmpiricalTrialBlockObservationV3["executionClass"];
	readonly d690OfflineEvidenceDigest: string;
	readonly d693QualificationArtifactDigest: typeof D694_D693_QUALIFICATION_ARTIFACT_DIGEST;
	readonly d693GenerationArtifactDigest: typeof D694_D693_GENERATION_ARTIFACT_DIGEST;
	readonly d693QualificationDigest: typeof D694_D693_QUALIFICATION_DIGEST;
	readonly d695PolicyDigest: typeof D696_D695_POLICY_DIGEST;
	readonly d695ImplementationCommit: typeof D696_D695_IMPLEMENTATION_COMMIT;
	readonly d695ScriptedMechanismRevision: typeof D695_SCRIPTED_MECHANISM_REVISION;
	readonly d694HistoricalObservationArtifactDigest: typeof D696_D694_LIVE_OBSERVATION_ARTIFACT_DIGEST;
	readonly d694HistoricalScorecardArtifactDigest: typeof D696_D694_LIVE_SCORECARD_ARTIFACT_DIGEST;
	readonly d694HistoricalGenerationArtifactDigest: typeof D696_D694_LIVE_GENERATION_ARTIFACT_DIGEST;
	readonly objectiveProgressPolicyDigest: string;
	readonly focusedValidationCommandDigest: string;
	readonly sourceTaskRef: string;
	readonly targetTaskRef: string;
	readonly failureMechanismRef: string;
	readonly transferMemoryDigest: string;
	readonly underlyingObservationDigest: string;
	readonly underlying: EmpiricalTrialBlockObservationV3;
	readonly focusedValidationReceipts: readonly D694FocusedValidationReceiptV1[];
	readonly continuationInvocations: readonly OpenRouterContinuationInvocationFactV1[];
	readonly noProgressReceipts: readonly D696NoProgressReceiptV1[];
	readonly completedRunsSatisfiedObjectiveProgress: boolean;
	readonly relevantActionTraceBoundToMemory: boolean;
	readonly positiveExploratoryContinuationAssistedPattern: boolean;
	readonly observationDigest: string;
}

export interface D696ContinuationAssistedScorecardV1 {
	readonly schemaVersion: typeof D696_CONTINUATION_ASSISTED_SCORECARD_VERSION;
	readonly claimBoundary: typeof D696_CLAIM_BOUNDARY;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly observationDigests: readonly [string];
	readonly attemptedBlocks: 1;
	readonly completedBlocks: 0 | 1;
	readonly evaluablePairs: 0 | 1;
	readonly continuationInvocationCount: number;
	readonly noProgressRejectionCount: number;
	readonly completedRunsSatisfiedObjectiveProgress: boolean;
	readonly positiveExploratoryContinuationAssistedPatterns: 0 | 1;
	readonly status:
		| "complete-positive-continuation-assisted-signal"
		| "complete-no-positive-continuation-assisted-signal"
		| "incomplete";
	readonly scorecardDigest: string;
}

export interface D696PreflightCapabilityV1 {
	readonly capabilityRef: "d696-exact-offline-preflight";
	readonly capabilityRevision: "decision.D697.2026-08-08.v1";
	readonly executionClass: EmpiricalTrialBlockObservationV3["executionClass"];
}

interface D696PreflightState {
	readonly d690OfflineEvidence: ReturnType<typeof validateD691D690OfflineEvidence>;
	readonly d693QualificationBytes: Uint8Array;
	readonly d693GenerationBytes: Uint8Array;
	readonly historicalUnderlying: EmpiricalTrialBlockObservationV3;
	readonly executionClass: EmpiricalTrialBlockObservationV3["executionClass"];
}

const constructedObservations = new WeakSet<object>();
const constructedScorecards = new WeakSet<object>();
const constructedPreflights = new WeakMap<object, D696PreflightState>();

function captureBlock(value: unknown): OpenRouterMatchedTrialBlockInputV4 {
	const block = record(value, "d696.block");
	const host = record(block.host, "d696.block.host");
	for (const key of [
		"objectiveProgressPolicy",
		"actionReceiptObserver",
		"noProgressContinuationPolicy",
		"continuationModelTurnPort",
		"noProgressReceiptObserver",
	] as const) {
		if (Object.hasOwn(host, key)) throw new TypeError(`D696 owns host.${key}`);
	}
	return Object.freeze({
		...block,
		routeQualification: strictSnapshot(record(block.routeQualification, "d696.block.route")),
		host: Object.freeze({
			...host,
			frozen: strictSnapshot(record(host.frozen, "d696.block.host.frozen")),
			qualificationReport: strictSnapshot(
				record(host.qualificationReport, "d696.block.host.qualificationReport"),
			),
			initialRequest: strictSnapshot(record(host.initialRequest, "d696.block.host.initialRequest")),
			taskProfile: strictSnapshot(record(host.taskProfile, "d696.block.host.taskProfile")),
		}),
	}) as unknown as OpenRouterMatchedTrialBlockInputV4;
}

function validateBlock(block: OpenRouterMatchedTrialBlockInputV4): void {
	validateD691HistoricalTransferBlockCoordinates(block);
	const route = block.routeQualification;
	const expectedApproval =
		block.executionClass === "live-provider"
			? D696_LIVE_SPEND_APPROVAL_REF === null || D696_LIVE_SPEND_APPROVAL_REVISION === null
				? null
				: Object.freeze({
						ref: D696_LIVE_SPEND_APPROVAL_REF,
						revision: D696_LIVE_SPEND_APPROVAL_REVISION,
					})
			: Object.freeze({ ref: "decision.D696", revision: "decision.D696.2026-08-08.v1" });
	if (
		expectedApproval === null ||
		route.pricing.sourceUrl !== OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE ||
		route.pricing.pricingRevision !== D694_PRICING_REVISION ||
		route.budget.approvalRef !== expectedApproval.ref ||
		route.budget.approvalRevision !== expectedApproval.revision ||
		empiricalStrictJsonDigest(
			block.host.taskProfile.commandPolicy.commands.find(
				(command) => command.commandRef === D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			),
		) !== D694_FOCUSED_VALIDATION_COMMAND_DIGEST ||
		empiricalStrictJsonDigest(D695_NO_PROGRESS_CONTINUATION_POLICY) !== D696_D695_POLICY_DIGEST
	) {
		throw new TypeError("D696 route, pricing, approval, command or continuation policy drifted");
	}
}

function stage(value: unknown, path: string): Stage {
	return oneOf(value, STAGE_ORDER, path);
}

function validateContinuationInvocation(value: unknown): OpenRouterContinuationInvocationFactV1 {
	const fact = record(value, "d696.continuationInvocation");
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
		"d696.continuationInvocation",
	);
	return strictSnapshot({
		trialStage: stage(fact.trialStage, "d696.continuationInvocation.trialStage"),
		stepIndex: safeInteger(fact.stepIndex, "d696.continuationInvocation.stepIndex", {
			max: D696_BUDGET.maxStepsPerRun - 1,
		}),
		attemptOrdinal: safeInteger(fact.attemptOrdinal, "d696.continuationInvocation.attemptOrdinal", {
			min: 1,
			max: 3,
		}),
		requestDigest: digest(fact.requestDigest, "d696.continuationInvocation.requestDigest"),
		continuationDigest: digest(
			fact.continuationDigest,
			"d696.continuationInvocation.continuationDigest",
		),
		requiredDisposition: oneOf(
			fact.requiredDisposition,
			["tool-intents", "final-allowed"] as const,
			"d696.continuationInvocation.requiredDisposition",
		),
		providerRequestCount: safeInteger(
			fact.providerRequestCount,
			"d696.continuationInvocation.providerRequestCount",
			{ max: 1 },
		),
	});
}

function validateNoProgressReceipt(value: unknown): D696NoProgressReceiptV1 {
	const receipt = record(value, "d696.noProgressReceipt");
	const kind = oneOf(
		receipt.kind,
		[
			"duplicate-inspection-batch",
			"duplicate-inspection-intent",
			"stale-result-intent-batch",
		] as const,
		"d696.noProgressReceipt.kind",
	);
	const digestKey =
		kind === "stale-result-intent-batch" ? "intentBatchDigest" : "inspectionBatchDigest";
	exactKeys(
		receipt,
		["disposition", digestKey, "kind", "stepIndex", "trialStage", "workspaceStateDigest"],
		"d696.noProgressReceipt",
	);
	const common = {
		kind,
		trialStage: stage(receipt.trialStage, "d696.noProgressReceipt.trialStage"),
		stepIndex: safeInteger(receipt.stepIndex, "d696.noProgressReceipt.stepIndex", {
			max: D696_BUDGET.maxStepsPerRun - 1,
		}),
		workspaceStateDigest: digest(
			receipt.workspaceStateDigest,
			"d696.noProgressReceipt.workspaceStateDigest",
		),
		disposition: literal(
			receipt.disposition,
			"rejected-before-tool-execution",
			"d696.noProgressReceipt.disposition",
		),
	};
	return kind === "stale-result-intent-batch"
		? strictSnapshot({
				...common,
				kind,
				intentBatchDigest: digest(
					receipt.intentBatchDigest,
					"d696.noProgressReceipt.intentBatchDigest",
				),
			})
		: strictSnapshot({
				...common,
				kind,
				inspectionBatchDigest: digest(
					receipt.inspectionBatchDigest,
					"d696.noProgressReceipt.inspectionBatchDigest",
				),
			});
}

function noProgressObserver(
	receipts: D696NoProgressReceiptV1[],
): ClosedNoProgressReceiptObserverV1 {
	return Object.freeze({
		observerRef: "d696-no-progress-receipt-observer",
		observerRevision: "decision.D696.2026-08-08.v1",
		record(receipt: ClosedNoProgressReceiptV1) {
			if (receipts.length >= STAGE_ORDER.length * D696_BUDGET.maxStepsPerRun) {
				throw new TypeError("D696 no-progress receipt bound exhausted");
			}
			receipts.push(validateNoProgressReceipt(receipt));
		},
	});
}

function d696RunForStage(underlying: EmpiricalTrialBlockObservationV3, trialStage: Stage) {
	if (trialStage === "cold") return underlying.cold;
	const branch = underlying.warmBranches.find((candidate) => candidate.branchKind === trialStage);
	if (branch?.attempted !== true || branch.run === null) {
		throw new TypeError(`D696 evidence referenced unattempted stage ${trialStage}`);
	}
	return branch.run;
}

export function assertExactD696NoProgressReceiptCoverage(
	runs: readonly {
		readonly trialStage: Stage;
		readonly steps: number;
		readonly issueCodes: readonly string[];
	}[],
	receipts: readonly D696NoProgressReceiptV1[],
): void {
	const issueToReceiptKind = Object.freeze({
		"repeated-inspection-turn-no-progress": "duplicate-inspection-batch",
		"duplicate-inspection-intent-in-turn": "duplicate-inspection-intent",
		"no-progress-stale-result-intent-batch": "stale-result-intent-batch",
	} as const);
	const runByStage = new Map(runs.map((run) => [run.trialStage, run] as const));
	const expectedReceiptKeys = new Set<string>();
	for (const run of runs) {
		const receiptIssues = Object.keys(issueToReceiptKind).filter((issue) =>
			run.issueCodes.includes(issue),
		) as (keyof typeof issueToReceiptKind)[];
		if (receiptIssues.length > 1) {
			throw new TypeError("D696 run contains multiple terminal no-progress receipt issues");
		}
		const issue = receiptIssues[0];
		if (issue !== undefined) {
			expectedReceiptKeys.add(`${run.trialStage}\u0000${issueToReceiptKind[issue]}`);
		}
	}
	const observedReceiptKeys = new Set<string>();
	for (const receipt of receipts) {
		const run = runByStage.get(receipt.trialStage);
		const expectedIssue =
			receipt.kind === "duplicate-inspection-batch"
				? "repeated-inspection-turn-no-progress"
				: receipt.kind === "duplicate-inspection-intent"
					? "duplicate-inspection-intent-in-turn"
					: "no-progress-stale-result-intent-batch";
		if (
			run === undefined ||
			receipt.stepIndex !== run.steps - 1 ||
			!run.issueCodes.includes(expectedIssue)
		) {
			throw new TypeError("D696 no-progress receipt is not bound to an observed logical step");
		}
		const receiptKey = `${receipt.trialStage}\u0000${receipt.kind}`;
		if (observedReceiptKeys.has(receiptKey)) {
			throw new TypeError("D696 no-progress receipt identity duplicated");
		}
		observedReceiptKeys.add(receiptKey);
	}
	if (
		expectedReceiptKeys.size !== observedReceiptKeys.size ||
		[...expectedReceiptKeys].some((receiptKey) => !observedReceiptKeys.has(receiptKey))
	) {
		throw new TypeError("D696 no-progress receipts do not bind every terminal rejection");
	}
}

function validateD696MechanismFacts(
	underlying: EmpiricalTrialBlockObservationV3,
	continuationInvocations: readonly OpenRouterContinuationInvocationFactV1[],
	noProgressReceipts: readonly D696NoProgressReceiptV1[],
): void {
	let providerRequests = 0;
	const observedContinuationAttemptKeys = new Set<string>();
	for (const invocation of continuationInvocations) {
		const run = d696RunForStage(underlying, invocation.trialStage);
		const attemptKey = `${invocation.trialStage}\u0000${invocation.stepIndex}\u0000${invocation.attemptOrdinal}`;
		if (observedContinuationAttemptKeys.has(attemptKey)) {
			throw new TypeError("D696 continuation fact duplicated an observed attempt");
		}
		observedContinuationAttemptKeys.add(attemptKey);
		const attempt = run.attemptTrace.find(
			(candidate) =>
				candidate.stepIndex === invocation.stepIndex &&
				candidate.attemptOrdinal === invocation.attemptOrdinal,
		);
		if (
			attempt?.requestDigest !== invocation.requestDigest ||
			attempt.requests !== invocation.providerRequestCount
		) {
			throw new TypeError("D696 continuation fact is not bound to its exact observed attempt");
		}
		providerRequests += invocation.providerRequestCount;
	}
	const totalRequests =
		underlying.cold.requests +
		underlying.warmBranches.reduce(
			(sum, branch) => sum + (branch.attempted && branch.run !== null ? branch.run.requests : 0),
			0,
		);
	if (providerRequests > totalRequests) {
		throw new TypeError("D696 continuation provider-request facts exceed observed requests");
	}
	const expectedContinuationAttemptKeys = new Set<string>();
	for (const trialStage of STAGE_ORDER) {
		const run =
			trialStage === "cold"
				? underlying.cold
				: underlying.warmBranches.find((branch) => branch.branchKind === trialStage)?.run;
		if (run === null || run === undefined) continue;
		const rejectionStep = run.attemptTrace.find((attempt) =>
			attempt.issueCodes.includes("structured-output-objective-progress-required"),
		)?.stepIndex;
		if (rejectionStep === undefined) continue;
		for (const attempt of run.attemptTrace) {
			if (attempt.stepIndex <= rejectionStep) continue;
			expectedContinuationAttemptKeys.add(
				`${trialStage}\u0000${attempt.stepIndex}\u0000${attempt.attemptOrdinal}`,
			);
		}
	}
	if (
		expectedContinuationAttemptKeys.size !== observedContinuationAttemptKeys.size ||
		[...expectedContinuationAttemptKeys].some(
			(attemptKey) => !observedContinuationAttemptKeys.has(attemptKey),
		)
	) {
		throw new TypeError("D696 continuation facts do not bind every exact continuation attempt");
	}
	assertExactD696NoProgressReceiptCoverage(
		STAGE_ORDER.flatMap((trialStage) => {
			const run =
				trialStage === "cold"
					? underlying.cold
					: underlying.warmBranches.find((branch) => branch.branchKind === trialStage)?.run;
			return run === null || run === undefined
				? []
				: [{ trialStage, steps: run.steps, issueCodes: run.issueCodes }];
		}),
		noProgressReceipts,
	);
}

function hasObservedContinuationRecovery(
	invocations: readonly OpenRouterContinuationInvocationFactV1[],
	trialStage: Stage,
): boolean {
	const stageInvocations = invocations.filter(
		(invocation) => invocation.trialStage === trialStage && invocation.providerRequestCount === 1,
	);
	return (
		stageInvocations.some((invocation) => invocation.requiredDisposition === "tool-intents") &&
		stageInvocations.some((invocation) => invocation.requiredDisposition === "final-allowed")
	);
}

function positiveD696Pattern(
	basePositive: boolean,
	invocations: readonly OpenRouterContinuationInvocationFactV1[],
): boolean {
	return (
		basePositive &&
		hasObservedContinuationRecovery(invocations, "cold") &&
		hasObservedContinuationRecovery(invocations, "relevant-applied")
	);
}

function isD696Evaluable(observation: D696ContinuationAssistedObservationV1): boolean {
	return (
		observation.underlying.result.classification === "complete" &&
		observation.underlying.cold.verifierStatus === "failed" &&
		observation.underlying.warmBranches.every(
			(branch) =>
				branch.attempted &&
				(branch.run?.verifierStatus === "passed" || branch.run?.verifierStatus === "failed"),
		) &&
		observation.completedRunsSatisfiedObjectiveProgress
	);
}

function captureArtifactByteSet(
	value: unknown,
	path: string,
): {
	readonly observationBytes: Uint8Array;
	readonly scorecardBytes: Uint8Array;
	readonly generationBytes: Uint8Array;
} {
	const input = record(value, path);
	exactKeys(input, ["generationBytes", "observationBytes", "scorecardBytes"], path);
	const copy = (key: "observationBytes" | "scorecardBytes" | "generationBytes") => {
		const bytes = input[key];
		if (!(bytes instanceof Uint8Array)) throw new TypeError(`${path}.${key} must be bytes`);
		return new Uint8Array(bytes);
	};
	return Object.freeze({
		observationBytes: copy("observationBytes"),
		scorecardBytes: copy("scorecardBytes"),
		generationBytes: copy("generationBytes"),
	});
}

export function validateD696D694HistoricalArtifacts(value: {
	readonly observationBytes: Uint8Array;
	readonly scorecardBytes: Uint8Array;
	readonly generationBytes: Uint8Array;
}): {
	readonly observationDigest: string;
	readonly scorecardDigest: string;
	readonly underlying: EmpiricalTrialBlockObservationV3;
} {
	const input = captureArtifactByteSet(value, "d696.d694.artifacts");
	for (const [label, bytes, expected, max] of [
		["observation", input.observationBytes, D696_D694_LIVE_OBSERVATION_ARTIFACT_DIGEST, 8_000_000],
		["scorecard", input.scorecardBytes, D696_D694_LIVE_SCORECARD_ARTIFACT_DIGEST, 64_000],
		["generation", input.generationBytes, D696_D694_LIVE_GENERATION_ARTIFACT_DIGEST, 64_000],
	] as const) {
		if (
			!(bytes instanceof Uint8Array) ||
			bytes.byteLength > max ||
			empiricalSha256(bytes) !== expected
		) {
			throw new TypeError(`D696 rejected the historical D694 ${label} artifact`);
		}
	}
	const observationDecoded = strictJsonCodec.decode(new Uint8Array(input.observationBytes));
	assertCanonicalBytes(observationDecoded, input.observationBytes, "d696.d694.observationBytes");
	const observation = validateD694Observation(observationDecoded);
	const scorecardDecoded = strictJsonCodec.decode(new Uint8Array(input.scorecardBytes));
	assertCanonicalBytes(scorecardDecoded, input.scorecardBytes, "d696.d694.scorecardBytes");
	const expectedScorecard = createD694Scorecard(observation);
	if (
		empiricalStrictJsonDigest(scorecardDecoded) !== empiricalStrictJsonDigest(expectedScorecard)
	) {
		throw new TypeError("D696 rejected a D694 scorecard not derived from its observation");
	}
	const generation = record(strictJsonCodec.decode(input.generationBytes), "d696.d694.generation");
	assertCanonicalBytes(generation, input.generationBytes, "d696.d694.generationBytes");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"claimBoundary",
			"efficacyClaim",
			"generationRef",
			"observationDigest",
			"schemaVersion",
			"scorecardDigest",
		],
		"d696.d694.generation",
	);
	literal(
		generation.schemaVersion,
		D694_ASSISTED_TRANSFER_GENERATION_VERSION,
		"d696.d694.generation.schema",
	);
	literal(
		generation.generationRef,
		"d694-assisted-transfer-live-2026-08-08-v1",
		"d696.d694.generation.generationRef",
	);
	literal(generation.claimBoundary, D694_CLAIM_BOUNDARY, "d696.d694.generation.claimBoundary");
	literal(generation.causalAttribution, "undetermined", "d696.d694.generation.causalAttribution");
	literal(generation.efficacyClaim, "none", "d696.d694.generation.efficacyClaim");
	literal(
		generation.observationDigest,
		observation.observationDigest,
		"d696.d694.generation.observationDigest",
	);
	literal(
		generation.scorecardDigest,
		expectedScorecard.scorecardDigest,
		"d696.d694.generation.scorecardDigest",
	);
	return Object.freeze({
		observationDigest: observation.observationDigest,
		scorecardDigest: expectedScorecard.scorecardDigest,
		underlying: observation.underlying,
	});
}

export function createD696PreflightCapability(value: unknown): D696PreflightCapabilityV1 {
	const input = record(value, "d696.preflightInput");
	exactKeys(
		input,
		[
			"d690OfflineEvidence",
			"d693GenerationBytes",
			"d693QualificationBytes",
			"d694HistoricalArtifacts",
			"d696DryRunArtifacts",
			"executionClass",
		],
		"d696.preflightInput",
	);
	const executionClass = oneOf(
		input.executionClass,
		["simulated-contract", "live-provider"] as const,
		"d696.preflightInput.executionClass",
	);
	const d690OfflineEvidence = validateD691D690OfflineEvidence(
		input.d690OfflineEvidence,
		executionClass,
	);
	if (
		!(input.d693QualificationBytes instanceof Uint8Array) ||
		!(input.d693GenerationBytes instanceof Uint8Array)
	) {
		throw new TypeError("D696 preflight D693 artifacts must be bytes");
	}
	const d693QualificationBytes = new Uint8Array(input.d693QualificationBytes);
	const d693GenerationBytes = new Uint8Array(input.d693GenerationBytes);
	validateD694D693EvidenceBytes({
		qualificationBytes: d693QualificationBytes,
		generationBytes: d693GenerationBytes,
	});
	const historical = validateD696D694HistoricalArtifacts(
		input.d694HistoricalArtifacts as Parameters<typeof validateD696D694HistoricalArtifacts>[0],
	);
	if (executionClass === "live-provider") {
		if (input.d696DryRunArtifacts === null) {
			throw new TypeError("D696 live preflight requires the exact integrated dry-run artifacts");
		}
		validateD696DryRunArtifactBytes(
			input.d696DryRunArtifacts as Parameters<typeof validateD696DryRunArtifactBytes>[0],
		);
	} else if (input.d696DryRunArtifacts !== null) {
		throw new TypeError(
			"D696 simulated preflight must not self-attest its future dry-run artifacts",
		);
	}
	if (empiricalStrictJsonDigest(D695_NO_PROGRESS_CONTINUATION_POLICY) !== D696_D695_POLICY_DIGEST) {
		throw new TypeError("D696 current D695 policy no longer matches the qualified digest");
	}
	const capability = Object.freeze({
		capabilityRef: "d696-exact-offline-preflight" as const,
		capabilityRevision: "decision.D697.2026-08-08.v1" as const,
		executionClass,
	});
	constructedPreflights.set(capability, {
		d690OfflineEvidence,
		d693QualificationBytes,
		d693GenerationBytes,
		historicalUnderlying: historical.underlying,
		executionClass,
	});
	return capability;
}

export async function runD696ContinuationAssistedBlock(input: {
	readonly preflight: D696PreflightCapabilityV1;
	readonly block: OpenRouterMatchedTrialBlockInputV4;
}): Promise<{
	readonly observation: D696ContinuationAssistedObservationV1;
	readonly scorecard: D696ContinuationAssistedScorecardV1;
	readonly admissionRejection: Awaited<
		ReturnType<typeof runOpenRouterMatchedTrialBlock>
	>["admissionRejection"];
	readonly protectionExecutor: Awaited<
		ReturnType<typeof runOpenRouterMatchedTrialBlock>
	>["protectionExecutor"];
}> {
	const outer = record(input, "d696.input");
	exactKeys(outer, ["block", "preflight"], "d696.input");
	const block = captureBlock(outer.block);
	validateBlock(block);
	const preflight = constructedPreflights.get(outer.preflight as object);
	if (preflight === undefined || preflight.executionClass !== block.executionClass) {
		throw new TypeError("D696 requires its exact same-process offline preflight capability");
	}
	constructedPreflights.delete(outer.preflight as object);
	const historical = preflight.historicalUnderlying;
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
		throw new TypeError("D696 block drifted from the exact historical D694 measurement object");
	}
	const d690 = preflight.d690OfflineEvidence;
	const d693 = validateD694D693EvidenceBytes({
		qualificationBytes: preflight.d693QualificationBytes,
		generationBytes: preflight.d693GenerationBytes,
	});
	const transferMemory = createD690HistoricalTransferMemory();
	const transferMemoryDigest = empiricalStrictJsonDigest(transferMemory);
	if (transferMemoryDigest !== d690.transferMemoryDigest) {
		throw new TypeError("D696 transfer memory no longer matches D690 qualification");
	}
	const focusedReceipts: D694FocusedValidationReceiptV1[] = [];
	const noProgressReceipts: D696NoProgressReceiptV1[] = [];
	const observer = noProgressObserver(noProgressReceipts);
	const result = await runOpenRouterMatchedTrialBlock({
		...block,
		host: {
			...block.host,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: D695_NO_PROGRESS_CONTINUATION_POLICY,
			actionReceiptObserver: createD694FocusedReceiptObserver(focusedReceipts),
			noProgressReceiptObserver: observer,
		},
		historicalReflectionCapability: createD691HistoricalReflectionCapability({
			transferMemory,
			d690OfflineEvidenceDigest: d690.evidenceDigest,
		}),
	});
	if (result.profile !== "smoke") throw new TypeError("D696 requires the smoke evidence profile");
	assertD691HistoricalTransferUnderlyingCoordinates(result.observation, block);
	const underlying = validateEmpiricalTrialBlockObservation(result.observation);
	const derived = deriveD694AssistedProgress(underlying, focusedReceipts);
	if (result.continuationInvocations === undefined) {
		throw new TypeError("D696 matched runner omitted continuation invocation evidence");
	}
	const continuationInvocations = strictSnapshot(
		result.continuationInvocations.map(validateContinuationInvocation),
	);
	const boundedNoProgressReceipts = strictSnapshot(
		noProgressReceipts.map(validateNoProgressReceipt),
	);
	const material = strictSnapshot({
		schemaVersion: D696_CONTINUATION_ASSISTED_OBSERVATION_VERSION,
		claimBoundary: D696_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		executionClass: underlying.executionClass,
		d690OfflineEvidenceDigest: d690.evidenceDigest,
		d693QualificationArtifactDigest: D694_D693_QUALIFICATION_ARTIFACT_DIGEST,
		d693GenerationArtifactDigest: D694_D693_GENERATION_ARTIFACT_DIGEST,
		d693QualificationDigest: d693.qualificationDigest as typeof D694_D693_QUALIFICATION_DIGEST,
		d695PolicyDigest: D696_D695_POLICY_DIGEST,
		d695ImplementationCommit: D696_D695_IMPLEMENTATION_COMMIT,
		d695ScriptedMechanismRevision: D695_SCRIPTED_MECHANISM_REVISION,
		d694HistoricalObservationArtifactDigest: D696_D694_LIVE_OBSERVATION_ARTIFACT_DIGEST,
		d694HistoricalScorecardArtifactDigest: D696_D694_LIVE_SCORECARD_ARTIFACT_DIGEST,
		d694HistoricalGenerationArtifactDigest: D696_D694_LIVE_GENERATION_ARTIFACT_DIGEST,
		objectiveProgressPolicyDigest: empiricalStrictJsonDigest(D693_ASSISTED_PROGRESS_POLICY),
		focusedValidationCommandDigest: D694_FOCUSED_VALIDATION_COMMAND_DIGEST,
		sourceTaskRef: d690.sourceTaskRef,
		targetTaskRef: d690.targetTaskRef,
		failureMechanismRef: d690.failureMechanismRef,
		transferMemoryDigest,
		underlyingObservationDigest: empiricalStrictJsonDigest(underlying),
		underlying,
		focusedValidationReceipts: derived.receipts,
		continuationInvocations,
		noProgressReceipts: boundedNoProgressReceipts,
		completedRunsSatisfiedObjectiveProgress: derived.completedRunsSatisfiedObjectiveProgress,
		relevantActionTraceBoundToMemory: derived.relevantActionTraceBoundToMemory,
		positiveExploratoryContinuationAssistedPattern: positiveD696Pattern(
			derived.positiveExploratoryAssistedTransferPattern,
			continuationInvocations,
		),
	});
	const observation = strictSnapshot({
		...material,
		observationDigest: empiricalStrictJsonDigest(material),
	});
	constructedObservations.add(observation);
	return Object.freeze({
		observation,
		scorecard: createD696Scorecard(observation),
		admissionRejection: result.admissionRejection,
		protectionExecutor: result.protectionExecutor,
	});
}

export function validateD696Observation(value: unknown): D696ContinuationAssistedObservationV1 {
	const candidate = record(value, "d696.observation");
	const expectedKeys: readonly (keyof D696ContinuationAssistedObservationV1)[] = [
		"causalAttribution",
		"claimBoundary",
		"completedRunsSatisfiedObjectiveProgress",
		"continuationInvocations",
		"d690OfflineEvidenceDigest",
		"d693GenerationArtifactDigest",
		"d693QualificationArtifactDigest",
		"d693QualificationDigest",
		"d694HistoricalGenerationArtifactDigest",
		"d694HistoricalObservationArtifactDigest",
		"d694HistoricalScorecardArtifactDigest",
		"d695ImplementationCommit",
		"d695PolicyDigest",
		"d695ScriptedMechanismRevision",
		"efficacyClaim",
		"executionClass",
		"failureMechanismRef",
		"focusedValidationCommandDigest",
		"focusedValidationReceipts",
		"noProgressReceipts",
		"objectiveProgressPolicyDigest",
		"observationDigest",
		"positiveExploratoryContinuationAssistedPattern",
		"relevantActionTraceBoundToMemory",
		"schemaVersion",
		"sourceTaskRef",
		"targetTaskRef",
		"transferMemoryDigest",
		"underlying",
		"underlyingObservationDigest",
	];
	exactKeys(candidate, expectedKeys, "d696.observation");
	literal(candidate.schemaVersion, D696_CONTINUATION_ASSISTED_OBSERVATION_VERSION, "d696.schema");
	literal(candidate.claimBoundary, D696_CLAIM_BOUNDARY, "d696.claimBoundary");
	literal(candidate.causalAttribution, "undetermined", "d696.causalAttribution");
	literal(candidate.efficacyClaim, "none", "d696.efficacyClaim");
	literal(candidate.d695PolicyDigest, D696_D695_POLICY_DIGEST, "d696.d695PolicyDigest");
	literal(candidate.d695ImplementationCommit, D696_D695_IMPLEMENTATION_COMMIT, "d696.d695Commit");
	literal(
		candidate.d695ScriptedMechanismRevision,
		D695_SCRIPTED_MECHANISM_REVISION,
		"d696.d695Mechanism",
	);
	for (const [actual, expected, path] of [
		[
			candidate.d693QualificationArtifactDigest,
			D694_D693_QUALIFICATION_ARTIFACT_DIGEST,
			"d696.d693QualificationArtifactDigest",
		],
		[
			candidate.d693GenerationArtifactDigest,
			D694_D693_GENERATION_ARTIFACT_DIGEST,
			"d696.d693GenerationArtifactDigest",
		],
		[
			candidate.d693QualificationDigest,
			D694_D693_QUALIFICATION_DIGEST,
			"d696.d693QualificationDigest",
		],
		[
			candidate.d694HistoricalObservationArtifactDigest,
			D696_D694_LIVE_OBSERVATION_ARTIFACT_DIGEST,
			"d696.d694ObservationArtifact",
		],
		[
			candidate.d694HistoricalScorecardArtifactDigest,
			D696_D694_LIVE_SCORECARD_ARTIFACT_DIGEST,
			"d696.d694ScorecardArtifact",
		],
		[
			candidate.d694HistoricalGenerationArtifactDigest,
			D696_D694_LIVE_GENERATION_ARTIFACT_DIGEST,
			"d696.d694GenerationArtifact",
		],
	] as const)
		literal(actual, expected, path);
	literal(candidate.sourceTaskRef, D690_SOURCE.taskRef, "d696.sourceTaskRef");
	literal(candidate.targetTaskRef, D690_TARGET_TASK_REF, "d696.targetTaskRef");
	literal(candidate.failureMechanismRef, D690_FAILURE_MECHANISM_REF, "d696.failureMechanismRef");
	literal(
		candidate.objectiveProgressPolicyDigest,
		empiricalStrictJsonDigest(D693_ASSISTED_PROGRESS_POLICY),
		"d696.objectivePolicyDigest",
	);
	literal(
		candidate.focusedValidationCommandDigest,
		D694_FOCUSED_VALIDATION_COMMAND_DIGEST,
		"d696.focusedCommandDigest",
	);
	literal(
		candidate.d690OfflineEvidenceDigest,
		D691_QUALIFIED_D690_OFFLINE_EVIDENCE_DIGEST,
		"d696.d690OfflineEvidenceDigest",
	);
	literal(
		candidate.transferMemoryDigest,
		empiricalStrictJsonDigest(createD690HistoricalTransferMemory()),
		"d696.transferMemoryDigest",
	);
	const underlying = validateEmpiricalTrialBlockObservation(candidate.underlying);
	literal(candidate.executionClass, underlying.executionClass, "d696.executionClass");
	literal(
		candidate.underlyingObservationDigest,
		empiricalStrictJsonDigest(underlying),
		"d696.underlyingObservationDigest",
	);
	const focusedValidationReceipts = array(
		candidate.focusedValidationReceipts,
		"d696.focusedValidationReceipts",
	).map((entry) => entry as unknown as D694FocusedValidationReceiptV1);
	const derived = deriveD694AssistedProgress(underlying, focusedValidationReceipts);
	const continuationInvocations = array(
		candidate.continuationInvocations,
		"d696.continuationInvocations",
	).map(validateContinuationInvocation);
	if (continuationInvocations.length > D696_BUDGET.maxHttpAttempts) {
		throw new TypeError("D696 continuation invocation bound exceeded");
	}
	const noProgressReceipts = array(candidate.noProgressReceipts, "d696.noProgressReceipts").map(
		validateNoProgressReceipt,
	);
	if (noProgressReceipts.length > STAGE_ORDER.length * D696_BUDGET.maxStepsPerRun) {
		throw new TypeError("D696 no-progress receipt bound exceeded");
	}
	validateD696MechanismFacts(underlying, continuationInvocations, noProgressReceipts);
	const material = strictSnapshot({
		...candidate,
		underlying,
		focusedValidationReceipts: derived.receipts,
		continuationInvocations,
		noProgressReceipts,
		completedRunsSatisfiedObjectiveProgress: derived.completedRunsSatisfiedObjectiveProgress,
		relevantActionTraceBoundToMemory: derived.relevantActionTraceBoundToMemory,
		positiveExploratoryContinuationAssistedPattern: positiveD696Pattern(
			derived.positiveExploratoryAssistedTransferPattern,
			continuationInvocations,
		),
	}) as unknown as D696ContinuationAssistedObservationV1;
	const { observationDigest, ...withoutDigest } = material;
	literal(observationDigest, empiricalStrictJsonDigest(withoutDigest), "d696.observationDigest");
	return strictSnapshot({ ...withoutDigest, observationDigest });
}

export function createD696Scorecard(
	value: D696ContinuationAssistedObservationV1,
): D696ContinuationAssistedScorecardV1 {
	const observation = validateD696Observation(value);
	const evaluable = isD696Evaluable(observation);
	const positive = evaluable && observation.positiveExploratoryContinuationAssistedPattern;
	const material = strictSnapshot({
		schemaVersion: D696_CONTINUATION_ASSISTED_SCORECARD_VERSION,
		claimBoundary: D696_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		observationDigests: [observation.observationDigest] as const,
		attemptedBlocks: 1 as const,
		completedBlocks: evaluable ? (1 as const) : (0 as const),
		evaluablePairs: evaluable ? (1 as const) : (0 as const),
		continuationInvocationCount: observation.continuationInvocations.length,
		noProgressRejectionCount: observation.noProgressReceipts.length,
		completedRunsSatisfiedObjectiveProgress: observation.completedRunsSatisfiedObjectiveProgress,
		positiveExploratoryContinuationAssistedPatterns: positive ? (1 as const) : (0 as const),
		status: evaluable
			? positive
				? ("complete-positive-continuation-assisted-signal" as const)
				: ("complete-no-positive-continuation-assisted-signal" as const)
			: ("incomplete" as const),
	});
	const scorecard = strictSnapshot({
		...material,
		scorecardDigest: empiricalStrictJsonDigest(material),
	});
	constructedScorecards.add(scorecard);
	return scorecard;
}

export function validateD696Scorecard(
	value: unknown,
	observationInput: D696ContinuationAssistedObservationV1,
): D696ContinuationAssistedScorecardV1 {
	const candidate = record(value, "d696.scorecard");
	exactKeys(
		candidate,
		[
			"attemptedBlocks",
			"causalAttribution",
			"claimBoundary",
			"completedBlocks",
			"completedRunsSatisfiedObjectiveProgress",
			"continuationInvocationCount",
			"efficacyClaim",
			"evaluablePairs",
			"noProgressRejectionCount",
			"observationDigests",
			"positiveExploratoryContinuationAssistedPatterns",
			"schemaVersion",
			"scorecardDigest",
			"status",
		],
		"d696.scorecard",
	);
	const expected = createD696Scorecard(validateD696Observation(observationInput));
	if (empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(expected)) {
		throw new TypeError("D696 scorecard is not exactly derived from its observation");
	}
	return expected;
}

export function validateD696DryRunArtifactBytes(value: {
	readonly observationBytes: Uint8Array;
	readonly scorecardBytes: Uint8Array;
	readonly generationBytes: Uint8Array;
}): {
	readonly observationDigest: typeof D696_DRY_RUN_OBSERVATION_DIGEST;
	readonly scorecardDigest: typeof D696_DRY_RUN_SCORECARD_DIGEST;
	readonly generationDigest: typeof D696_DRY_RUN_GENERATION_DIGEST;
} {
	const input = captureArtifactByteSet(value, "d696.dryRun.artifacts");
	for (const [label, bytes, expected, maxBytes] of [
		["observation", input.observationBytes, D696_DRY_RUN_OBSERVATION_ARTIFACT_DIGEST, 256_000],
		["scorecard", input.scorecardBytes, D696_DRY_RUN_SCORECARD_ARTIFACT_DIGEST, 64_000],
		["generation", input.generationBytes, D696_DRY_RUN_GENERATION_ARTIFACT_DIGEST, 64_000],
	] as const) {
		if (
			!(bytes instanceof Uint8Array) ||
			bytes.byteLength === 0 ||
			bytes.byteLength > maxBytes ||
			empiricalSha256(bytes) !== expected
		) {
			throw new TypeError(`D696 rejected its frozen ${label} dry-run artifact`);
		}
	}
	const observationDecoded = strictJsonCodec.decode(new Uint8Array(input.observationBytes));
	assertCanonicalBytes(observationDecoded, input.observationBytes, "d696.dryRun.observationBytes");
	const observation = validateD696Observation(observationDecoded);
	literal(observation.executionClass, "simulated-contract", "d696.dryRun.executionClass");
	literal(observation.underlying.empiricalLiveEvidence, false, "d696.dryRun.empiricalLiveEvidence");
	literal(observation.underlying.result.costMicrousd, 0, "d696.dryRun.costMicrousd");
	literal(
		observation.observationDigest,
		D696_DRY_RUN_OBSERVATION_DIGEST,
		"d696.dryRun.observationDigest",
	);
	const scorecardDecoded = strictJsonCodec.decode(new Uint8Array(input.scorecardBytes));
	assertCanonicalBytes(scorecardDecoded, input.scorecardBytes, "d696.dryRun.scorecardBytes");
	const scorecard = validateD696Scorecard(scorecardDecoded, observation);
	literal(scorecard.scorecardDigest, D696_DRY_RUN_SCORECARD_DIGEST, "d696.dryRun.scorecardDigest");
	const generationDecoded = strictJsonCodec.decode(new Uint8Array(input.generationBytes));
	assertCanonicalBytes(generationDecoded, input.generationBytes, "d696.dryRun.generationBytes");
	const generation = record(generationDecoded, "d696.dryRun.generation");
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
		"d696.dryRun.generation",
	);
	literal(
		generation.schemaVersion,
		D696_CONTINUATION_ASSISTED_GENERATION_VERSION,
		"d696.dryRun.generation.schemaVersion",
	);
	literal(
		generation.generationRef,
		"d696-continuation-assisted-no-network-dry-run-2026-08-08-v1",
		"d696.dryRun.generation.generationRef",
	);
	literal(generation.claimBoundary, D696_CLAIM_BOUNDARY, "d696.dryRun.generation.claimBoundary");
	literal(generation.causalAttribution, "undetermined", "d696.dryRun.generation.causalAttribution");
	literal(generation.efficacyClaim, "none", "d696.dryRun.generation.efficacyClaim");
	for (const [label, value, file, expectedDigest] of [
		[
			"observation",
			generation.observation,
			"continuation-assisted-observation.v1.json",
			D696_DRY_RUN_OBSERVATION_DIGEST,
		],
		[
			"scorecard",
			generation.scorecard,
			"continuation-assisted-scorecard.v1.json",
			D696_DRY_RUN_SCORECARD_DIGEST,
		],
	] as const) {
		const ref = record(value, `d696.dryRun.generation.${label}`);
		exactKeys(ref, ["digest", "file"], `d696.dryRun.generation.${label}`);
		literal(ref.file, file, `d696.dryRun.generation.${label}.file`);
		literal(ref.digest, expectedDigest, `d696.dryRun.generation.${label}.digest`);
	}
	const generationDigest = digest(
		generation.generationDigest,
		"d696.dryRun.generation.generationDigest",
	);
	const { generationDigest: ignored, ...generationMaterial } = generation;
	if (
		ignored !== generationDigest ||
		generationDigest !== D696_DRY_RUN_GENERATION_DIGEST ||
		empiricalStrictJsonDigest(generationMaterial) !== generationDigest
	) {
		throw new TypeError("D696 rejected a tampered dry-run generation");
	}
	return Object.freeze({
		observationDigest: D696_DRY_RUN_OBSERVATION_DIGEST,
		scorecardDigest: D696_DRY_RUN_SCORECARD_DIGEST,
		generationDigest: D696_DRY_RUN_GENERATION_DIGEST,
	});
}

export async function persistD696PrivateGeneration(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly observation: D696ContinuationAssistedObservationV1;
	readonly scorecard: D696ContinuationAssistedScorecardV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}): Promise<{
	readonly generationPath: string;
	readonly observationDigest: string;
	readonly scorecardDigest: string;
	readonly generationDigest: string;
}> {
	const request = record(input, "d696.persistence");
	exactKeys(
		request,
		["generationRef", "observation", "privateRoot", "protectionExecutor", "scorecard"],
		"d696.persistence",
	);
	if (!constructedObservations.has(request.observation as object)) {
		throw new TypeError("D696 persistence requires a same-process observation");
	}
	const observation = validateD696Observation(request.observation);
	const scorecard = createD696Scorecard(observation);
	if (
		!constructedScorecards.has(request.scorecard as object) ||
		empiricalStrictJsonDigest(request.scorecard) !== empiricalStrictJsonDigest(scorecard)
	) {
		throw new TypeError("D696 persistence requires its derived same-process scorecard");
	}
	if (!isEmpiricalExactPrivateNeedleProtectionExecutor(request.protectionExecutor)) {
		throw new TypeError("D696 persistence requires constructed private protection");
	}
	if (
		typeof request.generationRef !== "string" ||
		!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(request.generationRef)
	) {
		throw new TypeError("D696 generation ref is not a bounded private directory name");
	}
	const privateRoot = await assertSafePrivateRoot(D696_PRIVATE_PERSISTENCE_ROOT);
	if (request.privateRoot !== privateRoot)
		throw new TypeError("D696 persistence root is not frozen");
	const generationRef = request.generationRef;
	const generationMaterial = strictSnapshot({
		schemaVersion: D696_CONTINUATION_ASSISTED_GENERATION_VERSION,
		generationRef,
		claimBoundary: D696_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		observation: {
			file: "continuation-assisted-observation.v1.json",
			digest: observation.observationDigest,
		},
		scorecard: {
			file: "continuation-assisted-scorecard.v1.json",
			digest: scorecard.scorecardDigest,
		},
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	for (const [label, value] of [
		["D696 observation", observation],
		["D696 scorecard", scorecard],
		["D696 generation", generation],
	] as const) {
		assertPrivateArtifactProtection({
			label,
			subject: value,
			protectionExecutor:
				request.protectionExecutor as EmpiricalExactPrivateNeedleProtectionExecutorV1,
		});
	}
	const finalPath = join(privateRoot, generationRef);
	try {
		await lstat(finalPath);
		throw new TypeError("D696 generation already exists");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const stagingPath = join(privateRoot, `.d696-staging-${randomUUID()}`);
	const files = Object.freeze([
		Object.freeze({
			file: "continuation-assisted-observation.v1.json",
			bytes: strictJsonCodec.encode(observation),
		}),
		Object.freeze({
			file: "continuation-assisted-scorecard.v1.json",
			bytes: strictJsonCodec.encode(scorecard),
		}),
		Object.freeze({ file: "generation.v1.json", bytes: strictJsonCodec.encode(generation) }),
	]);
	try {
		await mkdir(stagingPath, { mode: 0o700 });
		for (const file of files) await writePrivateFile(join(stagingPath, file.file), file.bytes);
		await syncDirectory(stagingPath);
		for (const file of files) {
			const bytes = new Uint8Array(await readFile(join(stagingPath, file.file)));
			if (!sameBytes(bytes, file.bytes)) throw new TypeError("D696 persistence readback failed");
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

export async function failD696PrivateStagingGeneration(
	stagingPath: string,
	error: unknown,
	remove: typeof rm = rm,
): Promise<never> {
	try {
		await remove(stagingPath, { recursive: true, force: true });
	} catch (cleanupError) {
		throw new AggregateError([error, cleanupError], "D696 atomic private staging cleanup failed");
	}
	throw error;
}

export async function commitD696PrivateStagingDirectory(
	input: {
		readonly stagingPath: string;
		readonly finalPath: string;
		readonly privateRoot: string;
	},
	operations: {
		readonly rename: typeof rename;
		readonly rm: typeof rm;
		readonly syncDirectory: typeof syncDirectory;
	} = { rename, rm, syncDirectory },
): Promise<void> {
	let renamed = false;
	try {
		await operations.rename(input.stagingPath, input.finalPath);
		renamed = true;
		await operations.syncDirectory(input.privateRoot);
	} catch (error) {
		const cleanupErrors: unknown[] = [];
		try {
			await operations.rm(renamed ? input.finalPath : input.stagingPath, {
				recursive: true,
				force: true,
			});
		} catch (cleanupError) {
			cleanupErrors.push(cleanupError);
		}
		if (renamed) {
			try {
				await operations.syncDirectory(input.privateRoot);
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
		}
		if (cleanupErrors.length > 0) {
			throw new AggregateError(
				[error, ...cleanupErrors],
				"D696 atomic private generation cleanup failed",
			);
		}
		throw error;
	}
}

if (
	D696_BUDGET.maxSpendMicrousd !== 6_000_000 ||
	D696_BUDGET.maxSpendMicrousd !== D691_BUDGET.maxSpendMicrousd
) {
	throw new TypeError("D696 budget no longer isolates the D695 treatment delta");
}
