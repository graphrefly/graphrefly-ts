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
	strictSnapshot,
} from "./canonical.js";
import {
	CLOSED_ACTOR_TOOL_REFS,
	type ClosedTaskProfileHostActionReceiptObserverV1,
	type ClosedTaskProfileHostActionReceiptV1,
} from "./closed-task-profile-host.js";
import {
	createD690HistoricalTransferMemory,
	D690_FAILURE_MECHANISM_REF,
	D690_SOURCE,
	D690_TARGET_TASK_REF,
} from "./d690-historical-pair-qualification.js";
import {
	assertD691HistoricalTransferUnderlyingCoordinates,
	assertFrozenD691HistoricalTransferUnderlyingCoordinates,
	D691_BUDGET,
	D691_PRIVATE_PERSISTENCE_ROOT,
	D691_QUALIFIED_D690_OFFLINE_EVIDENCE_DIGEST,
	deriveD691HistoricalTransferPattern,
	validateD691D690OfflineEvidence,
	validateD691HistoricalTransferBlockCoordinates,
} from "./d691-historical-transfer-live.js";
import {
	D693_ASSISTED_PROGRESS_GENERATION_SCHEMA,
	D693_ASSISTED_PROGRESS_POLICY,
	type D693AssistedProgressQualificationV1,
	validateD693AssistedProgressQualification,
} from "./d693-assisted-progress-qualification.js";
import {
	type EmpiricalSmokeRunObservationV3,
	type EmpiricalTrialBlockObservationV3,
	validateEmpiricalTrialBlockObservation,
} from "./empirical-smoke-evidence.js";
import {
	type EmpiricalExactPrivateNeedleProtectionExecutorV1,
	isEmpiricalExactPrivateNeedleProtectionExecutor,
} from "./exact-private-needle-protection.js";
import { createD691HistoricalReflectionCapability } from "./matched-block-memory.js";
import {
	type OpenRouterMatchedTrialBlockInputV4,
	runOpenRouterMatchedTrialBlock,
} from "./openrouter-first-task-smoke.js";
import {
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
} from "./openrouter-route-qualification.js";
import {
	assertPrivateArtifactProtection,
	assertSafePrivateRoot,
	syncDirectory,
	writePrivateFile,
} from "./private-smoke-persistence.js";

export const D694_ASSISTED_TRANSFER_OBSERVATION_VERSION =
	"graphrefly.private-solution-eval.d694-assisted-transfer-observation.v1" as const;
export const D694_ASSISTED_TRANSFER_SCORECARD_VERSION =
	"graphrefly.private-solution-eval.d694-assisted-transfer-scorecard.v1" as const;
export const D694_ASSISTED_TRANSFER_GENERATION_VERSION =
	"graphrefly.private-solution-eval.d694-assisted-transfer-generation.v1" as const;
export const D694_CLAIM_BOUNDARY =
	"single-controlled-assisted-historical-transfer-block-exploratory-no-efficacy-claim" as const;
export const D694_D693_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:ba927c04172788081344ad6035fb496eff6e5aae5124a0d82ac6994288795811" as const;
export const D694_D693_GENERATION_ARTIFACT_DIGEST =
	"sha256:9c7d84ab37385f8f83cbaf7232133e806ee34c91d2f9e46860361af9feba5530" as const;
export const D694_D693_QUALIFICATION_DIGEST =
	"sha256:132616684889ed010bbb5e991f8959c68ebd7d3f2347fa7aeb643030b8ea5321" as const;
export const D694_DRY_RUN_OBSERVATION_ARTIFACT_DIGEST =
	"sha256:74ce96c8d8cdff5e687f991fa8d2439ee8185ae8fb4ff84abad30db30271550d" as const;
export const D694_DRY_RUN_SCORECARD_ARTIFACT_DIGEST =
	"sha256:c855f244f35987ef91d7a00ec9ab0399694a346281a1c9cf5d19d8163d9b2279" as const;
export const D694_DRY_RUN_GENERATION_ARTIFACT_DIGEST =
	"sha256:489251e5139e1e3eeb96357a212bfc78967ba213435d30a988d70e76209d7ac3" as const;
export const D694_DRY_RUN_OBSERVATION_DIGEST =
	"sha256:105dcfe56131f499da2bd499a2b32868c1b196bc15042d3a1267c5f10196e606" as const;
export const D694_DRY_RUN_SCORECARD_DIGEST =
	"sha256:7f59a88e5a24ef3e8516bd9054cfb6f0009e562e8686be9d25502f095c943f4a" as const;
export const D694_PRICING_REVISION = OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION;
export const D694_BUDGET = Object.freeze({ ...D691_BUDGET });
export const D694_PRIVATE_PERSISTENCE_ROOT = D691_PRIVATE_PERSISTENCE_ROOT;
export const D694_FOCUSED_VALIDATION_COMMAND = strictSnapshot({
	commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
	executable: "/usr/bin/git",
	argv: ["diff", "--check", "--", "packages/ts/src/executors/managed-cloud-postgresql.ts"],
	maxStdoutBytes: 64 * 1024,
	maxStderrBytes: 64 * 1024,
});
export const D694_FOCUSED_VALIDATION_COMMAND_DIGEST = empiricalStrictJsonDigest(
	D694_FOCUSED_VALIDATION_COMMAND,
);

const D694_STAGE_ORDER = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);

type D694Stage = (typeof D694_STAGE_ORDER)[number];

export interface D694FocusedValidationReceiptV1 {
	readonly trialStage: D694Stage;
	readonly stepIndex: number;
	readonly actionIndex: number;
	readonly commandRef: typeof D693_ASSISTED_PROGRESS_POLICY.validationCommandRef;
	readonly validationStatus: "passed" | "failed";
	readonly exitCode: number;
	readonly stdoutByteLength: number;
	readonly stderrByteLength: number;
	readonly stdoutDigest: string;
	readonly stderrDigest: string;
	readonly resultDigest: string;
}

export interface D694AssistedTransferObservationV1 {
	readonly schemaVersion: typeof D694_ASSISTED_TRANSFER_OBSERVATION_VERSION;
	readonly claimBoundary: typeof D694_CLAIM_BOUNDARY;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly executionClass: EmpiricalTrialBlockObservationV3["executionClass"];
	readonly d690OfflineEvidenceDigest: string;
	readonly d693QualificationArtifactDigest: typeof D694_D693_QUALIFICATION_ARTIFACT_DIGEST;
	readonly d693GenerationArtifactDigest: typeof D694_D693_GENERATION_ARTIFACT_DIGEST;
	readonly d693QualificationDigest: typeof D694_D693_QUALIFICATION_DIGEST;
	readonly objectiveProgressPolicyDigest: string;
	readonly focusedValidationCommandDigest: string;
	readonly sourceTaskRef: string;
	readonly targetTaskRef: string;
	readonly failureMechanismRef: string;
	readonly transferMemoryDigest: string;
	readonly underlyingObservationDigest: string;
	readonly underlying: EmpiricalTrialBlockObservationV3;
	readonly focusedValidationReceipts: readonly D694FocusedValidationReceiptV1[];
	readonly completedRunsSatisfiedObjectiveProgress: boolean;
	readonly relevantActionTraceBoundToMemory: boolean;
	readonly positiveExploratoryAssistedTransferPattern: boolean;
	readonly observationDigest: string;
}

export interface D694AssistedTransferScorecardV1 {
	readonly schemaVersion: typeof D694_ASSISTED_TRANSFER_SCORECARD_VERSION;
	readonly claimBoundary: typeof D694_CLAIM_BOUNDARY;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly observationDigests: readonly [string];
	readonly attemptedBlocks: 1;
	readonly completedBlocks: 0 | 1;
	readonly evaluablePairs: 0 | 1;
	readonly completedRunsSatisfiedObjectiveProgress: boolean;
	readonly positiveExploratoryAssistedTransferPatterns: 0 | 1;
	readonly status:
		| "complete-positive-assisted-transfer-signal"
		| "complete-no-positive-assisted-transfer-signal"
		| "incomplete";
	readonly scorecardDigest: string;
}

const constructedObservations = new WeakSet<object>();
const constructedScorecards = new WeakSet<object>();

function d694Stage(value: unknown, path: string): D694Stage {
	return oneOf(value, D694_STAGE_ORDER, path);
}

export function validateD694D693EvidenceBytes(input: {
	readonly qualificationBytes: unknown;
	readonly generationBytes: unknown;
}): D693AssistedProgressQualificationV1 {
	if (!(input.qualificationBytes instanceof Uint8Array)) {
		throw new TypeError("D694 requires exact D693 qualification bytes");
	}
	if (!(input.generationBytes instanceof Uint8Array)) {
		throw new TypeError("D694 requires exact D693 generation bytes");
	}
	const qualificationBytes = new Uint8Array(input.qualificationBytes);
	const generationBytes = new Uint8Array(input.generationBytes);
	if (qualificationBytes.byteLength > 2_000_000 || generationBytes.byteLength > 64_000) {
		throw new TypeError("D694 D693 receipt bytes exceed their frozen bounds");
	}
	if (empiricalSha256(qualificationBytes) !== D694_D693_QUALIFICATION_ARTIFACT_DIGEST) {
		throw new TypeError("D694 rejected a non-qualified D693 artifact");
	}
	if (empiricalSha256(generationBytes) !== D694_D693_GENERATION_ARTIFACT_DIGEST) {
		throw new TypeError("D694 rejected a non-qualified D693 generation");
	}
	const decodedQualification = strictJsonCodec.decode(qualificationBytes);
	assertCanonicalBytes(decodedQualification, qualificationBytes, "d694.d693.qualificationBytes");
	const qualification = validateD693AssistedProgressQualification(decodedQualification);
	if (
		!qualification.qualified ||
		qualification.qualificationDigest !== D694_D693_QUALIFICATION_DIGEST ||
		qualification.policyDigest !== empiricalStrictJsonDigest(D693_ASSISTED_PROGRESS_POLICY)
	) {
		throw new TypeError("D694 D693 qualification coordinates drifted");
	}
	const generation = record(strictJsonCodec.decode(generationBytes), "d694.d693.generation");
	assertCanonicalBytes(generation, generationBytes, "d694.d693.generationBytes");
	exactKeys(
		generation,
		["generationDigest", "generationRef", "qualification", "schemaVersion"],
		"d694.d693.generation",
	);
	literal(
		generation.schemaVersion,
		D693_ASSISTED_PROGRESS_GENERATION_SCHEMA,
		"d694.d693.generation.schemaVersion",
	);
	const qualificationRef = record(generation.qualification, "d694.d693.generation.qualification");
	exactKeys(
		qualificationRef,
		["byteLength", "digest", "file"],
		"d694.d693.generation.qualification",
	);
	literal(
		qualificationRef.file,
		"assisted-progress-qualification.v1.json",
		"d694.d693.generation.qualification.file",
	);
	literal(
		qualificationRef.digest,
		D694_D693_QUALIFICATION_ARTIFACT_DIGEST,
		"d694.d693.generation.qualification.digest",
	);
	literal(
		qualificationRef.byteLength,
		qualificationBytes.byteLength,
		"d694.d693.generation.qualification.byteLength",
	);
	const generationDigest = digest(
		generation.generationDigest,
		"d694.d693.generation.generationDigest",
	);
	const { generationDigest: ignored, ...generationMaterial } = generation;
	if (
		ignored !== generationDigest ||
		empiricalStrictJsonDigest(generationMaterial) !== generationDigest
	) {
		throw new TypeError("D694 D693 generation is non-canonical or tampered");
	}
	return qualification;
}

function captureBlock(value: unknown): OpenRouterMatchedTrialBlockInputV4 {
	const block = record(value, "d694.block");
	const host = record(block.host, "d694.block.host");
	if (
		host.objectiveProgressPolicy !== undefined ||
		host.actionReceiptObserver !== undefined ||
		host.noProgressContinuationPolicy !== undefined ||
		host.continuationModelTurnPort !== undefined ||
		host.noProgressReceiptObserver !== undefined
	) {
		throw new TypeError("D694 owns the objective-progress policy and receipt observer");
	}
	return Object.freeze({
		...block,
		routeQualification: strictSnapshot(
			record(block.routeQualification, "d694.block.routeQualification"),
		),
		host: Object.freeze({
			...host,
			frozen: strictSnapshot(record(host.frozen, "d694.block.host.frozen")),
			qualificationReport: strictSnapshot(
				record(host.qualificationReport, "d694.block.host.qualificationReport"),
			),
			initialRequest: strictSnapshot(record(host.initialRequest, "d694.block.host.initialRequest")),
			taskProfile: strictSnapshot(record(host.taskProfile, "d694.block.host.taskProfile")),
		}),
	}) as unknown as OpenRouterMatchedTrialBlockInputV4;
}

function validateD694Block(block: OpenRouterMatchedTrialBlockInputV4): void {
	validateD691HistoricalTransferBlockCoordinates(block);
	const route = block.routeQualification;
	if (
		route.pricing.sourceUrl !== OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE ||
		route.pricing.pricingRevision !== D694_PRICING_REVISION ||
		route.budget.approvalRef !== "decision.D694" ||
		route.budget.approvalRevision !== "decision.D694.2026-08-08.v1" ||
		empiricalStrictJsonDigest(
			block.host.taskProfile.commandPolicy.commands.find(
				(command) => command.commandRef === D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			),
		) !== D694_FOCUSED_VALIDATION_COMMAND_DIGEST
	) {
		throw new TypeError("D694 route, pricing, approval or focused command coordinates drifted");
	}
}

export function validateD694FocusedValidationReceipt(
	value: unknown,
): D694FocusedValidationReceiptV1 {
	const receipt = record(value, "d694.focusedValidationReceipt");
	exactKeys(
		receipt,
		[
			"actionIndex",
			"commandRef",
			"exitCode",
			"resultDigest",
			"stderrByteLength",
			"stderrDigest",
			"stdoutByteLength",
			"stdoutDigest",
			"stepIndex",
			"trialStage",
			"validationStatus",
		],
		"d694.focusedValidationReceipt",
	);
	const validated = strictSnapshot({
		trialStage: d694Stage(receipt.trialStage, "d694.focusedValidationReceipt.trialStage"),
		stepIndex: safeInteger(receipt.stepIndex, "d694.focusedValidationReceipt.stepIndex", {
			max: D694_BUDGET.maxStepsPerRun - 1,
		}),
		actionIndex: safeInteger(receipt.actionIndex, "d694.focusedValidationReceipt.actionIndex", {
			max: D694_BUDGET.maxActionsPerRun - 1,
		}),
		commandRef: literal(
			receipt.commandRef,
			D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			"d694.focusedValidationReceipt.commandRef",
		),
		validationStatus: oneOf(
			receipt.validationStatus,
			["passed", "failed"] as const,
			"d694.focusedValidationReceipt.validationStatus",
		),
		exitCode: safeInteger(receipt.exitCode, "d694.focusedValidationReceipt.exitCode", {
			max: 255,
		}),
		stdoutByteLength: safeInteger(
			receipt.stdoutByteLength,
			"d694.focusedValidationReceipt.stdoutByteLength",
			{ max: D694_FOCUSED_VALIDATION_COMMAND.maxStdoutBytes },
		),
		stderrByteLength: safeInteger(
			receipt.stderrByteLength,
			"d694.focusedValidationReceipt.stderrByteLength",
			{ max: D694_FOCUSED_VALIDATION_COMMAND.maxStderrBytes },
		),
		stdoutDigest: digest(receipt.stdoutDigest, "d694.focusedValidationReceipt.stdoutDigest"),
		stderrDigest: digest(receipt.stderrDigest, "d694.focusedValidationReceipt.stderrDigest"),
		resultDigest: digest(receipt.resultDigest, "d694.focusedValidationReceipt.resultDigest"),
	});
	if ((validated.validationStatus === "passed") !== (validated.exitCode === 0)) {
		throw new TypeError("D694 focused validation status does not match its exit code");
	}
	const sanitizedResult = strictSnapshot({
		kind: "focused-validation-command" as const,
		commandRef: validated.commandRef,
		validationStatus: validated.validationStatus,
		exitCode: validated.exitCode,
		stdoutByteLength: validated.stdoutByteLength,
		stderrByteLength: validated.stderrByteLength,
		stdoutDigest: validated.stdoutDigest,
		stderrDigest: validated.stderrDigest,
	});
	if (empiricalStrictJsonDigest(sanitizedResult) !== validated.resultDigest) {
		throw new TypeError("D694 focused validation receipt does not bind its sanitized result");
	}
	return validated;
}

export function createD694FocusedReceiptObserver(
	receipts: D694FocusedValidationReceiptV1[],
): ClosedTaskProfileHostActionReceiptObserverV1 {
	return Object.freeze({
		observerRef: "d694-focused-validation-receipt-observer",
		observerRevision: "decision.D694.2026-08-08.v1",
		record(receipt: ClosedTaskProfileHostActionReceiptV1) {
			if (receipt.toolRef !== CLOSED_ACTOR_TOOL_REFS.runCommand) return;
			const args = record(receipt.arguments, "d694.observer.arguments");
			if (args.commandRef !== D693_ASSISTED_PROGRESS_POLICY.validationCommandRef) return;
			exactKeys(args, ["commandRef"], "d694.observer.arguments");
			const result = record(receipt.result, "d694.observer.result");
			exactKeys(
				result,
				[
					"commandRef",
					"exitCode",
					"kind",
					"stderrByteLength",
					"stderrDigest",
					"stdoutByteLength",
					"stdoutDigest",
					"validationStatus",
				],
				"d694.observer.result",
			);
			literal(result.kind, "focused-validation-command", "d694.observer.result.kind");
			if (receipts.length >= D694_STAGE_ORDER.length * D694_BUDGET.maxActionsPerRun) {
				throw new TypeError("D694 focused validation receipt bound exhausted");
			}
			receipts.push(
				validateD694FocusedValidationReceipt({
					trialStage: receipt.trialStage,
					stepIndex: receipt.stepIndex,
					actionIndex: receipt.actionIndex,
					commandRef: result.commandRef,
					validationStatus: result.validationStatus,
					exitCode: result.exitCode,
					stdoutByteLength: result.stdoutByteLength,
					stderrByteLength: result.stderrByteLength,
					stdoutDigest: result.stdoutDigest,
					stderrDigest: result.stderrDigest,
					resultDigest: receipt.resultDigest,
				}),
			);
		},
	});
}

function runForStage(
	underlying: EmpiricalTrialBlockObservationV3,
	stage: D694Stage,
): EmpiricalSmokeRunObservationV3 | null {
	if (stage === "cold") return underlying.cold;
	return underlying.warmBranches.find((branch) => branch.branchKind === stage)?.run ?? null;
}

function bindFocusedReceipts(
	underlying: EmpiricalTrialBlockObservationV3,
	input: readonly unknown[],
): readonly D694FocusedValidationReceiptV1[] {
	const values = array(input, "d694.focusedValidationReceipts");
	if (values.length > D694_STAGE_ORDER.length * D694_BUDGET.maxActionsPerRun) {
		throw new TypeError("D694 focused validation receipts exceed their bound");
	}
	const receipts = values.map(validateD694FocusedValidationReceipt);
	const identities = new Set<string>();
	let previousOrder = -1;
	for (const receipt of receipts) {
		const stageOrder = D694_STAGE_ORDER.indexOf(receipt.trialStage);
		const order = stageOrder * D694_BUDGET.maxActionsPerRun + receipt.actionIndex;
		if (order <= previousOrder)
			throw new TypeError("D694 focused receipts are not canonical ordered");
		previousOrder = order;
		const identity = `${receipt.trialStage}\u0000${receipt.actionIndex}`;
		if (identities.has(identity)) throw new TypeError("D694 focused receipt identity duplicated");
		identities.add(identity);
		const run = runForStage(underlying, receipt.trialStage);
		const action = run?.actionTrace.find(
			(entry) => entry.actionIndex === receipt.actionIndex && entry.stepIndex === receipt.stepIndex,
		);
		if (
			action?.toolRef !== CLOSED_ACTOR_TOOL_REFS.runCommand ||
			action.resultDigest !== receipt.resultDigest
		) {
			throw new TypeError("D694 focused receipt does not bind its exact action trace entry");
		}
	}
	return strictSnapshot(receipts);
}

function orderedProgressObserved(
	run: EmpiricalSmokeRunObservationV3,
	receipts: readonly D694FocusedValidationReceiptV1[],
	stage: D694Stage,
): boolean {
	const passed = receipts.filter(
		(receipt) => receipt.trialStage === stage && receipt.validationStatus === "passed",
	);
	return passed.some((receipt) => {
		let mutationObserved = false;
		let latestMutationDiffObserved = false;
		for (const action of run.actionTrace) {
			if (action.actionIndex >= receipt.actionIndex) break;
			if (action.toolRef === CLOSED_ACTOR_TOOL_REFS.replaceExact) {
				mutationObserved = true;
				latestMutationDiffObserved = false;
			} else if (mutationObserved && action.toolRef === CLOSED_ACTOR_TOOL_REFS.workspaceDiff) {
				latestMutationDiffObserved = true;
			}
		}
		return mutationObserved && latestMutationDiffObserved;
	});
}

export function deriveD694AssistedProgress(
	underlying: EmpiricalTrialBlockObservationV3,
	receiptsInput: readonly unknown[],
): {
	readonly receipts: readonly D694FocusedValidationReceiptV1[];
	readonly completedRunsSatisfiedObjectiveProgress: boolean;
	readonly relevantActionTraceBoundToMemory: boolean;
	readonly positiveExploratoryAssistedTransferPattern: boolean;
} {
	const receipts = bindFocusedReceipts(underlying, receiptsInput);
	const completedStages = D694_STAGE_ORDER.filter((stage) => {
		const verifierStatus = runForStage(underlying, stage)?.verifierStatus;
		return verifierStatus === "passed" || verifierStatus === "failed";
	});
	const completedRunsSatisfiedObjectiveProgress =
		completedStages.length > 0 &&
		completedStages.every((stage) => {
			const run = runForStage(underlying, stage);
			return run !== null && orderedProgressObserved(run, receipts, stage);
		});
	const d691 = deriveD691HistoricalTransferPattern(underlying);
	const relevant = runForStage(underlying, "relevant-applied");
	const relevantProgress =
		relevant !== null && orderedProgressObserved(relevant, receipts, "relevant-applied");
	return Object.freeze({
		receipts,
		completedRunsSatisfiedObjectiveProgress,
		relevantActionTraceBoundToMemory: d691.relevantActionTraceBoundToMemory,
		positiveExploratoryAssistedTransferPattern:
			d691.positiveExploratoryTransferPattern && relevantProgress,
	});
}

export async function runD694AssistedTransferBlock(input: {
	readonly d690OfflineEvidence: unknown;
	readonly d693QualificationBytes: Uint8Array;
	readonly d693GenerationBytes: Uint8Array;
	readonly block: OpenRouterMatchedTrialBlockInputV4;
}): Promise<{
	readonly observation: D694AssistedTransferObservationV1;
	readonly scorecard: D694AssistedTransferScorecardV1;
	readonly admissionRejection: Awaited<
		ReturnType<typeof runOpenRouterMatchedTrialBlock>
	>["admissionRejection"];
	readonly protectionExecutor: Awaited<
		ReturnType<typeof runOpenRouterMatchedTrialBlock>
	>["protectionExecutor"];
}> {
	const outer = record(input, "d694.input");
	exactKeys(
		outer,
		["block", "d690OfflineEvidence", "d693GenerationBytes", "d693QualificationBytes"],
		"d694.input",
	);
	const block = captureBlock(outer.block);
	validateD694Block(block);
	const d690 = validateD691D690OfflineEvidence(outer.d690OfflineEvidence, block.executionClass);
	const d693 = validateD694D693EvidenceBytes({
		qualificationBytes: outer.d693QualificationBytes,
		generationBytes: outer.d693GenerationBytes,
	});
	const transferMemory = createD690HistoricalTransferMemory();
	const transferMemoryDigest = empiricalStrictJsonDigest(transferMemory);
	if (transferMemoryDigest !== d690.transferMemoryDigest) {
		throw new TypeError("D694 transfer memory no longer matches D690 qualification");
	}
	const focusedReceipts: D694FocusedValidationReceiptV1[] = [];
	const result = await runOpenRouterMatchedTrialBlock({
		...block,
		host: {
			...block.host,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			actionReceiptObserver: createD694FocusedReceiptObserver(focusedReceipts),
		},
		historicalReflectionCapability: createD691HistoricalReflectionCapability({
			transferMemory,
			d690OfflineEvidenceDigest: d690.evidenceDigest,
		}),
	});
	if (result.profile !== "smoke") throw new TypeError("D694 requires the smoke evidence profile");
	assertD691HistoricalTransferUnderlyingCoordinates(result.observation, block);
	const underlying = validateEmpiricalTrialBlockObservation(result.observation);
	const derived = deriveD694AssistedProgress(underlying, focusedReceipts);
	const material = strictSnapshot({
		schemaVersion: D694_ASSISTED_TRANSFER_OBSERVATION_VERSION,
		claimBoundary: D694_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		executionClass: underlying.executionClass,
		d690OfflineEvidenceDigest: d690.evidenceDigest,
		d693QualificationArtifactDigest: D694_D693_QUALIFICATION_ARTIFACT_DIGEST,
		d693GenerationArtifactDigest: D694_D693_GENERATION_ARTIFACT_DIGEST,
		d693QualificationDigest: d693.qualificationDigest as typeof D694_D693_QUALIFICATION_DIGEST,
		objectiveProgressPolicyDigest: empiricalStrictJsonDigest(D693_ASSISTED_PROGRESS_POLICY),
		focusedValidationCommandDigest: D694_FOCUSED_VALIDATION_COMMAND_DIGEST,
		sourceTaskRef: d690.sourceTaskRef,
		targetTaskRef: d690.targetTaskRef,
		failureMechanismRef: d690.failureMechanismRef,
		transferMemoryDigest,
		underlyingObservationDigest: empiricalStrictJsonDigest(underlying),
		underlying,
		focusedValidationReceipts: derived.receipts,
		completedRunsSatisfiedObjectiveProgress: derived.completedRunsSatisfiedObjectiveProgress,
		relevantActionTraceBoundToMemory: derived.relevantActionTraceBoundToMemory,
		positiveExploratoryAssistedTransferPattern: derived.positiveExploratoryAssistedTransferPattern,
	});
	const observation = strictSnapshot({
		...material,
		observationDigest: empiricalStrictJsonDigest(material),
	});
	constructedObservations.add(observation);
	const scorecard = createD694Scorecard(observation);
	return Object.freeze({
		observation,
		scorecard,
		admissionRejection: result.admissionRejection,
		protectionExecutor: result.protectionExecutor,
	});
}

export function validateD694Observation(value: unknown): D694AssistedTransferObservationV1 {
	const candidate = record(value, "d694.observation");
	exactKeys(
		candidate,
		[
			"causalAttribution",
			"claimBoundary",
			"completedRunsSatisfiedObjectiveProgress",
			"d690OfflineEvidenceDigest",
			"d693GenerationArtifactDigest",
			"d693QualificationArtifactDigest",
			"d693QualificationDigest",
			"efficacyClaim",
			"executionClass",
			"failureMechanismRef",
			"focusedValidationCommandDigest",
			"focusedValidationReceipts",
			"objectiveProgressPolicyDigest",
			"observationDigest",
			"positiveExploratoryAssistedTransferPattern",
			"relevantActionTraceBoundToMemory",
			"schemaVersion",
			"sourceTaskRef",
			"targetTaskRef",
			"transferMemoryDigest",
			"underlying",
			"underlyingObservationDigest",
		],
		"d694.observation",
	);
	literal(candidate.schemaVersion, D694_ASSISTED_TRANSFER_OBSERVATION_VERSION, "d694.schema");
	literal(candidate.claimBoundary, D694_CLAIM_BOUNDARY, "d694.claimBoundary");
	literal(candidate.causalAttribution, "undetermined", "d694.causalAttribution");
	literal(candidate.efficacyClaim, "none", "d694.efficacyClaim");
	literal(
		candidate.d690OfflineEvidenceDigest,
		D691_QUALIFIED_D690_OFFLINE_EVIDENCE_DIGEST,
		"d694.d690OfflineEvidenceDigest",
	);
	literal(
		candidate.d693QualificationArtifactDigest,
		D694_D693_QUALIFICATION_ARTIFACT_DIGEST,
		"d694.d693QualificationArtifactDigest",
	);
	literal(
		candidate.d693GenerationArtifactDigest,
		D694_D693_GENERATION_ARTIFACT_DIGEST,
		"d694.d693GenerationArtifactDigest",
	);
	literal(
		candidate.d693QualificationDigest,
		D694_D693_QUALIFICATION_DIGEST,
		"d694.d693QualificationDigest",
	);
	literal(candidate.sourceTaskRef, D690_SOURCE.taskRef, "d694.sourceTaskRef");
	literal(candidate.targetTaskRef, D690_TARGET_TASK_REF, "d694.targetTaskRef");
	literal(candidate.failureMechanismRef, D690_FAILURE_MECHANISM_REF, "d694.failureMechanismRef");
	literal(
		candidate.objectiveProgressPolicyDigest,
		empiricalStrictJsonDigest(D693_ASSISTED_PROGRESS_POLICY),
		"d694.objectiveProgressPolicyDigest",
	);
	literal(
		candidate.focusedValidationCommandDigest,
		D694_FOCUSED_VALIDATION_COMMAND_DIGEST,
		"d694.focusedValidationCommandDigest",
	);
	literal(
		candidate.transferMemoryDigest,
		empiricalStrictJsonDigest(createD690HistoricalTransferMemory()),
		"d694.transferMemoryDigest",
	);
	const underlying = validateEmpiricalTrialBlockObservation(candidate.underlying);
	assertFrozenD691HistoricalTransferUnderlyingCoordinates(underlying);
	if (
		underlying.route.pricingSourceUrl !== OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE ||
		underlying.route.pricingRevision !== D694_PRICING_REVISION ||
		underlying.route.budgetApprovalRef !== "decision.D694" ||
		underlying.route.budgetApprovalRevision !== "decision.D694.2026-08-08.v1"
	) {
		throw new TypeError("D694 observation route/pricing approval coordinates drifted");
	}
	literal(candidate.executionClass, underlying.executionClass, "d694.executionClass");
	const underlyingDigest = digest(
		candidate.underlyingObservationDigest,
		"d694.underlyingObservationDigest",
	);
	if (underlyingDigest !== empiricalStrictJsonDigest(underlying)) {
		throw new TypeError("D694 underlying observation digest mismatch");
	}
	const derived = deriveD694AssistedProgress(
		underlying,
		array(candidate.focusedValidationReceipts, "d694.focusedValidationReceipts"),
	);
	literal(
		candidate.completedRunsSatisfiedObjectiveProgress,
		derived.completedRunsSatisfiedObjectiveProgress,
		"d694.completedRunsSatisfiedObjectiveProgress",
	);
	literal(
		candidate.relevantActionTraceBoundToMemory,
		derived.relevantActionTraceBoundToMemory,
		"d694.relevantActionTraceBoundToMemory",
	);
	literal(
		candidate.positiveExploratoryAssistedTransferPattern,
		derived.positiveExploratoryAssistedTransferPattern,
		"d694.positiveExploratoryAssistedTransferPattern",
	);
	const observationDigest = digest(candidate.observationDigest, "d694.observationDigest");
	const { observationDigest: ignored, ...material } = candidate;
	if (ignored !== observationDigest || empiricalStrictJsonDigest(material) !== observationDigest) {
		throw new TypeError("D694 observation is non-canonical or tampered");
	}
	return strictSnapshot(candidate) as unknown as D694AssistedTransferObservationV1;
}

export function createD694Scorecard(
	observationInput: D694AssistedTransferObservationV1,
): D694AssistedTransferScorecardV1 {
	const constructed =
		typeof observationInput === "object" &&
		observationInput !== null &&
		constructedObservations.has(observationInput);
	const observation = validateD694Observation(observationInput);
	const evaluable =
		observation.underlying.result.classification === "complete" &&
		observation.underlying.cold.verifierStatus === "failed" &&
		observation.underlying.warmBranches.every(
			(branch) =>
				branch.attempted &&
				(branch.run?.verifierStatus === "passed" || branch.run?.verifierStatus === "failed"),
		) &&
		observation.completedRunsSatisfiedObjectiveProgress;
	const status = !evaluable
		? ("incomplete" as const)
		: observation.positiveExploratoryAssistedTransferPattern
			? ("complete-positive-assisted-transfer-signal" as const)
			: ("complete-no-positive-assisted-transfer-signal" as const);
	const material = strictSnapshot({
		schemaVersion: D694_ASSISTED_TRANSFER_SCORECARD_VERSION,
		claimBoundary: D694_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		observationDigests: [observation.observationDigest] as const,
		attemptedBlocks: 1 as const,
		completedBlocks: (evaluable ? 1 : 0) as 0 | 1,
		evaluablePairs: (evaluable ? 1 : 0) as 0 | 1,
		completedRunsSatisfiedObjectiveProgress: observation.completedRunsSatisfiedObjectiveProgress,
		positiveExploratoryAssistedTransferPatterns:
			(observation.positiveExploratoryAssistedTransferPattern ? 1 : 0) as 0 | 1,
		status,
	});
	const scorecard = strictSnapshot({
		...material,
		scorecardDigest: empiricalStrictJsonDigest(material),
	});
	if (constructed) constructedScorecards.add(scorecard);
	return scorecard;
}

export function validateD694DryRunArtifactBytes(input: {
	readonly observationBytes: Uint8Array;
	readonly scorecardBytes: Uint8Array;
	readonly generationBytes: Uint8Array;
}): {
	readonly observationDigest: typeof D694_DRY_RUN_OBSERVATION_DIGEST;
	readonly scorecardDigest: typeof D694_DRY_RUN_SCORECARD_DIGEST;
} {
	const candidate = record(input, "d694.dryRunArtifacts");
	exactKeys(
		candidate,
		["generationBytes", "observationBytes", "scorecardBytes"],
		"d694.dryRunArtifacts",
	);
	for (const [key, expectedDigest, maxBytes] of [
		["observationBytes", D694_DRY_RUN_OBSERVATION_ARTIFACT_DIGEST, 8_000_000],
		["scorecardBytes", D694_DRY_RUN_SCORECARD_ARTIFACT_DIGEST, 64_000],
		["generationBytes", D694_DRY_RUN_GENERATION_ARTIFACT_DIGEST, 64_000],
	] as const) {
		const bytes = candidate[key];
		if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxBytes) {
			throw new TypeError(`D694 ${key} is not a bounded byte artifact`);
		}
		if (empiricalSha256(bytes) !== expectedDigest) {
			throw new TypeError(`D694 ${key} does not match the qualified no-network dry-run`);
		}
	}
	const observationBytes = new Uint8Array(candidate.observationBytes as Uint8Array);
	const observationDecoded = strictJsonCodec.decode(observationBytes);
	assertCanonicalBytes(observationDecoded, observationBytes, "d694.dryRun.observationBytes");
	const observation = validateD694Observation(observationDecoded);
	literal(observation.executionClass, "simulated-contract", "d694.dryRun.executionClass");
	literal(
		observation.observationDigest,
		D694_DRY_RUN_OBSERVATION_DIGEST,
		"d694.dryRun.observationDigest",
	);
	if (
		!observation.completedRunsSatisfiedObjectiveProgress ||
		!observation.positiveExploratoryAssistedTransferPattern
	) {
		throw new TypeError("D694 no-network dry-run did not satisfy assisted progress");
	}
	const scorecardBytes = new Uint8Array(candidate.scorecardBytes as Uint8Array);
	const scorecardDecoded = strictJsonCodec.decode(scorecardBytes);
	assertCanonicalBytes(scorecardDecoded, scorecardBytes, "d694.dryRun.scorecardBytes");
	const expectedScorecard = createD694Scorecard(observation);
	if (!Buffer.from(strictJsonCodec.encode(expectedScorecard)).equals(scorecardBytes)) {
		throw new TypeError("D694 no-network scorecard is not derived from its observation");
	}
	literal(
		expectedScorecard.scorecardDigest,
		D694_DRY_RUN_SCORECARD_DIGEST,
		"d694.dryRun.scorecardDigest",
	);
	literal(
		expectedScorecard.status,
		"complete-positive-assisted-transfer-signal",
		"d694.dryRun.status",
	);
	const generationBytes = new Uint8Array(candidate.generationBytes as Uint8Array);
	const generation = record(strictJsonCodec.decode(generationBytes), "d694.dryRun.generation");
	assertCanonicalBytes(generation, generationBytes, "d694.dryRun.generationBytes");
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
		"d694.dryRun.generation",
	);
	literal(
		generation.schemaVersion,
		D694_ASSISTED_TRANSFER_GENERATION_VERSION,
		"d694.dryRun.generation.schemaVersion",
	);
	literal(
		generation.generationRef,
		"d694-assisted-transfer-no-network-dry-run-2026-08-08-v1",
		"d694.dryRun.generation.generationRef",
	);
	literal(generation.claimBoundary, D694_CLAIM_BOUNDARY, "d694.dryRun.claimBoundary");
	literal(generation.causalAttribution, "undetermined", "d694.dryRun.causalAttribution");
	literal(generation.efficacyClaim, "none", "d694.dryRun.efficacyClaim");
	literal(
		generation.observationDigest,
		D694_DRY_RUN_OBSERVATION_DIGEST,
		"d694.dryRun.generation.observationDigest",
	);
	literal(
		generation.scorecardDigest,
		D694_DRY_RUN_SCORECARD_DIGEST,
		"d694.dryRun.generation.scorecardDigest",
	);
	return Object.freeze({
		observationDigest: D694_DRY_RUN_OBSERVATION_DIGEST,
		scorecardDigest: D694_DRY_RUN_SCORECARD_DIGEST,
	});
}

export async function persistD694PrivateGeneration(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly observation: D694AssistedTransferObservationV1;
	readonly scorecard: D694AssistedTransferScorecardV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}): Promise<{
	readonly generationRef: string;
	readonly observationDigest: string;
	readonly scorecardDigest: string;
	readonly generationDigest: string;
}> {
	const request = record(input, "d694.persistence");
	exactKeys(
		request,
		["generationRef", "observation", "privateRoot", "protectionExecutor", "scorecard"],
		"d694.persistence",
	);
	if (
		typeof request.observation !== "object" ||
		request.observation === null ||
		!constructedObservations.has(request.observation) ||
		typeof request.scorecard !== "object" ||
		request.scorecard === null ||
		!constructedScorecards.has(request.scorecard)
	) {
		throw new TypeError("D694 persistence requires same-process runner evidence");
	}
	const observation = validateD694Observation(request.observation);
	const scorecard = createD694Scorecard(observation);
	if (empiricalStrictJsonDigest(request.scorecard) !== empiricalStrictJsonDigest(scorecard)) {
		throw new TypeError("D694 persistence rejected a non-derived scorecard");
	}
	if (
		typeof request.generationRef !== "string" ||
		!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(request.generationRef)
	) {
		throw new TypeError("D694 generation ref is not a bounded private directory name");
	}
	if (typeof request.privateRoot !== "string") {
		throw new TypeError("D694 persistence root must be explicit");
	}
	if (!isEmpiricalExactPrivateNeedleProtectionExecutor(request.protectionExecutor)) {
		throw new TypeError("D694 persistence requires a constructed protection executor");
	}
	const protectionExecutor = request.protectionExecutor;
	const privateRoot = await assertSafePrivateRoot(request.privateRoot);
	if (privateRoot !== (await assertSafePrivateRoot(D694_PRIVATE_PERSISTENCE_ROOT))) {
		throw new TypeError("D694 persistence root is not the exact operator-private root");
	}
	const generation = strictSnapshot({
		schemaVersion: D694_ASSISTED_TRANSFER_GENERATION_VERSION,
		generationRef: request.generationRef,
		observationDigest: observation.observationDigest,
		scorecardDigest: scorecard.scorecardDigest,
		claimBoundary: D694_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	for (const [subject, label] of [
		[observation, "observation"],
		[scorecard, "scorecard"],
		[generation, "generation"],
	] as const) {
		assertPrivateArtifactProtection({
			subject,
			label: `D694 ${label}`,
			protectionExecutor,
		});
	}
	const staging = join(privateRoot, `.d694-staging-${randomUUID()}`);
	const finalRoot = join(privateRoot, request.generationRef);
	try {
		await lstat(finalRoot)
			.then(() => {
				throw new TypeError("D694 generation already exists");
			})
			.catch((error: unknown) => {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			});
		await mkdir(staging, { mode: 0o700 });
		await writeCanonical(join(staging, "assisted-transfer-observation.v1.json"), observation);
		await writeCanonical(join(staging, "assisted-transfer-scorecard.v1.json"), scorecard);
		await writeCanonical(join(staging, "generation.v1.json"), generation);
		await syncDirectory(staging);
		await commitD694PrivateStagingDirectory({ staging, finalRoot, privateRoot });
	} catch (error) {
		await failD694PrivateStagingGeneration(staging, error);
	}
	return Object.freeze({
		generationRef: request.generationRef,
		observationDigest: observation.observationDigest,
		scorecardDigest: scorecard.scorecardDigest,
		generationDigest: empiricalStrictJsonDigest(generation),
	});
}

export async function failD694PrivateStagingGeneration(
	staging: string,
	error: unknown,
	remove: typeof rm = rm,
): Promise<never> {
	try {
		await remove(staging, { recursive: true, force: true });
	} catch (cleanupError) {
		throw new AggregateError([error, cleanupError], "D694 atomic private staging cleanup failed");
	}
	throw error;
}

export async function commitD694PrivateStagingDirectory(
	input: {
		readonly staging: string;
		readonly finalRoot: string;
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
		await operations.rename(input.staging, input.finalRoot);
		renamed = true;
		await operations.syncDirectory(input.privateRoot);
	} catch (error) {
		const cleanupErrors: unknown[] = [];
		try {
			await operations.rm(renamed ? input.finalRoot : input.staging, {
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
				"D694 atomic private generation cleanup failed",
			);
		}
		throw error;
	}
}

async function writeCanonical(path: string, value: unknown): Promise<void> {
	const bytes = strictJsonCodec.encode(value);
	await writePrivateFile(path, bytes);
	const persisted = await readFile(path);
	if (!Buffer.from(bytes).equals(persisted)) {
		throw new TypeError("D694 canonical private write verification failed");
	}
}
