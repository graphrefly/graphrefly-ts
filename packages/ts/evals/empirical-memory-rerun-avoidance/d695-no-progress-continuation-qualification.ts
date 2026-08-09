import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	boolean,
	coordinate,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	safeInteger,
	sameBytes,
	strictSnapshot,
	string,
} from "./canonical.js";
import {
	CLOSED_ACTOR_TOOL_REFS,
	CLOSED_TASK_PROFILE_HOST_SCHEMAS,
	type ClosedContinuationModelTurnPortV1,
	type ClosedHostContinuationV1,
	type ClosedNoProgressContinuationPolicyV1,
	type ClosedNoProgressReceiptV1,
	type ClosedVerifierCapabilityV1,
	isConstructedClosedHostContinuationForRequest,
	runClosedTaskProfileHost,
} from "./closed-task-profile-host.js";
import {
	assertD693OfflineCommandFixture,
	D693_ASSISTED_PROGRESS_POLICY,
	type D693PreparedHostV1,
	type D693ScriptedMutationPlanV1,
} from "./d693-assisted-progress-qualification.js";
import {
	type EmpiricalExactPrivateNeedleProtectionExecutorV1,
	isEmpiricalExactPrivateNeedleProtectionExecutor,
} from "./exact-private-needle-protection.js";
import {
	EMPIRICAL_MODEL_EXECUTION_SCHEMAS,
	type EmpiricalModelToolIntentV1,
	type EmpiricalModelTurnOutcomeV1,
	type EmpiricalModelTurnPortV1,
	type EmpiricalModelTurnRequestV1,
	executeEmpiricalProtection,
	validateEmpiricalModelTurnOutcome,
} from "./model-execution.js";
import {
	assertPrivateArtifactProtection,
	assertSafePrivateRoot,
	syncDirectory,
	writePrivateFile,
} from "./private-smoke-persistence.js";
import { isTrustedLocalSingleBaselineMaterialization } from "./single-baseline-repository-node.js";

export const D695_NO_PROGRESS_CONTINUATION_POLICY = strictSnapshot({
	schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.noProgressContinuationPolicy,
	policyRef: "no-progress.d695.historical-transfer",
	policyRevision: "decision.D695.2026-08-08.v1",
	maxRetainedToolResults: 16,
	maxRetainedBytes: 131_072,
	maxRejectedTerminals: 2,
	maxSemanticDuplicateRejections: 1,
	maxInspectionBatchesPerState: 16,
}) satisfies ClosedNoProgressContinuationPolicyV1;

export const D695_OFFLINE_QUALIFICATION_SCHEMA =
	"graphrefly.private-solution-eval.d695-no-progress-continuation-qualification.v1" as const;
export const D695_OFFLINE_GENERATION_SCHEMA =
	"graphrefly.private-solution-eval.d695-no-progress-continuation-generation.v1" as const;
export const D695_CLAIM_BOUNDARY =
	"offline-provider-neutral-continuation-contract-no-provider-no-efficacy-claim" as const;
export const D695_SCRIPTED_MECHANISM_REVISION = "d695-scripted-full-host.v2" as const;
export const D695_CASE_ORDER = Object.freeze([
	"feedback-recovery",
	"repeated-inspection",
	"duplicate-multiple-intent",
	"mutation-state-reset",
] as const);
export type D695CaseRef = (typeof D695_CASE_ORDER)[number];

export interface D695CaseReportV1 {
	readonly caseRef: D695CaseRef;
	readonly experimentBindingDigest: string;
	readonly hostStatus: "completed" | "non-evaluable";
	readonly verifierVerdict: "passed" | "failed" | "unverifiable" | null;
	readonly logicalStepCount: number;
	readonly toolActionCount: number;
	readonly actionToolRefs: readonly string[];
	readonly continuationCount: number;
	readonly prematureContinuationObserved: boolean;
	readonly retainedResultsApplicable: boolean;
	readonly rejectionPriorToolResultCount: number;
	readonly rejectionPriorToolResultsByteLength: number;
	readonly rejectionPriorToolResultsDigest: string;
	readonly capsuleRetainedToolResultCount: number;
	readonly capsuleRetainedToolResultsDigest: string;
	readonly retainedResultsBound: boolean;
	readonly finalAllowedObserved: boolean;
	readonly duplicateReceiptCount: number;
	readonly duplicateRejectedBeforeExecution: boolean;
	readonly issueCodes: readonly string[];
	readonly providerCallCount: 0;
	readonly networkCallCount: 0;
	readonly chargedCostMicrousd: 0;
	readonly caseDigest: string;
}

export interface D695OfflineQualificationV1 {
	readonly schemaVersion: typeof D695_OFFLINE_QUALIFICATION_SCHEMA;
	readonly authorityRef: "decision.D695";
	readonly authorityRevision: "decision.D695.2026-08-08.v1";
	readonly claimBoundary: typeof D695_CLAIM_BOUNDARY;
	readonly policyDigest: string;
	readonly caseOrder: typeof D695_CASE_ORDER;
	readonly cases: readonly D695CaseReportV1[];
	readonly feedbackRecoveryPassed: boolean;
	readonly retainedResultsBound: boolean;
	readonly repeatedInspectionStoppedBeforeExecution: boolean;
	readonly multipleIntentStoppedBeforeExecution: boolean;
	readonly mutationStateResetPassed: boolean;
	readonly providerCallCount: 0;
	readonly networkCallCount: 0;
	readonly chargedCostMicrousd: 0;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly qualified: boolean;
	readonly qualificationDigest: string;
}

type ScriptedBody =
	| {
			readonly finishReason: "tool-intents";
			readonly toolIntents: readonly EmpiricalModelToolIntentV1[];
	  }
	| {
			readonly finishReason: "structured-output";
			readonly structuredOutput: {
				readonly kind: "model-turn-output-placeholder";
				readonly summary: string;
			};
	  };

const QUALIFICATION_FILE = "no-progress-continuation-qualification.v1.json";
const GENERATION_FILE = "generation.v1.json";
const constructedReports = new WeakSet<object>();
const constructedQualifications = new WeakSet<object>();

function validatePlan(value: D693ScriptedMutationPlanV1): D693ScriptedMutationPlanV1 {
	const plan = record(value, "d695.plan");
	exactKeys(
		plan,
		[
			"acceptedContentDigest",
			"acceptedNewText",
			"initialContentDigest",
			"initialOldText",
			"otherCommandRef",
			"readPaths",
			"rejectedNewText",
			"validationCommandRef",
			"writablePath",
		],
		"d695.plan",
	);
	const readPaths = array(plan.readPaths, "d695.plan.readPaths").map((entry, index) =>
		string(entry, `d695.plan.readPaths[${index}]`, 1_024),
	);
	if (
		readPaths.length < 1 ||
		readPaths.length > 32 ||
		new Set(readPaths).size !== readPaths.length
	) {
		throw new TypeError("D695 plan read paths are not bounded and unique");
	}
	const normalized = strictSnapshot({
		readPaths,
		writablePath: string(plan.writablePath, "d695.plan.writablePath", 1_024),
		initialContentDigest: digest(plan.initialContentDigest, "d695.plan.initialContentDigest"),
		initialOldText: string(plan.initialOldText, "d695.plan.initialOldText", 65_536),
		acceptedNewText: string(plan.acceptedNewText, "d695.plan.acceptedNewText", 65_536),
		rejectedNewText: string(plan.rejectedNewText, "d695.plan.rejectedNewText", 65_536),
		acceptedContentDigest: digest(plan.acceptedContentDigest, "d695.plan.acceptedContentDigest"),
		validationCommandRef: coordinate(plan.validationCommandRef, "d695.plan.validationCommandRef"),
		otherCommandRef: coordinate(plan.otherCommandRef, "d695.plan.otherCommandRef"),
	});
	if (
		!normalized.readPaths.includes(normalized.writablePath) ||
		normalized.validationCommandRef !== D693_ASSISTED_PROGRESS_POLICY.validationCommandRef
	) {
		throw new TypeError("D695 plan is not bound to the D693 actor-visible objective");
	}
	return normalized;
}

function toolIntent(
	caseRef: D695CaseRef,
	step: number,
	index: number,
	toolRef: string,
	argumentsValue: StrictJsonValue,
): EmpiricalModelToolIntentV1 {
	return strictSnapshot({
		toolCallRef: `d695.${caseRef}.${step}.${index}`,
		toolRef,
		argumentsDigest: empiricalStrictJsonDigest(argumentsValue),
		arguments: argumentsValue,
	});
}

function completedOutcome(
	request: EmpiricalModelTurnRequestV1,
	host: D693PreparedHostV1,
	body: ScriptedBody,
): EmpiricalModelTurnOutcomeV1 {
	const structuredOutput = body.finishReason === "structured-output" ? body.structuredOutput : null;
	const toolIntents = body.finishReason === "tool-intents" ? body.toolIntents : [];
	const evidenceRefs = strictSnapshot([]);
	const issueCodes = strictSnapshot([]);
	const protectionReceipt = executeEmpiricalProtection(host.protectionExecutor, {
		policyRef: request.protectionPolicyRef,
		policyRevision: request.protectionPolicyRevision,
		stage: "model-egress",
		subject: strictSnapshot({
			evidenceRefs,
			issueCodes,
			structuredOutput,
			toolIntents: toolIntents.map((entry) => ({
				toolCallRef: entry.toolCallRef,
				toolRef: entry.toolRef,
				argumentsDigest: entry.argumentsDigest,
				arguments: entry.arguments,
			})),
		}),
	}).receipt;
	return validateEmpiricalModelTurnOutcome(
		{
			schemaVersion: EMPIRICAL_MODEL_EXECUTION_SCHEMAS.outcome,
			requestRef: request.requestRef,
			requestDigest: empiricalStrictJsonDigest(request),
			configurationRef: request.configurationRef,
			configurationDigest: request.configurationDigest,
			role: request.role,
			status: "completed",
			finishReason: body.finishReason,
			outputSchemaDigest: request.outputSchema.schemaDigest,
			structuredOutput,
			structuredOutputDigest:
				structuredOutput === null ? null : empiricalStrictJsonDigest(structuredOutput),
			toolIntents,
			usage: {
				source: request.usageSource,
				inputTokens: 1,
				outputTokens: 1,
				totalTokens: 2,
				providerCostMicrousd: null,
				requests: 1,
				hostInputBytes: 64,
				hostOutputBytes: 4_096,
			},
			latencyMs: 0,
			issueCodes,
			evidenceRefs,
			protectionReceipt,
		},
		request,
		host.frozen,
		host.qualificationReport,
	);
}

function finalBody(caseRef: D695CaseRef): ScriptedBody {
	return {
		finishReason: "structured-output",
		structuredOutput: { kind: "model-turn-output-placeholder", summary: `D695 ${caseRef}` },
	};
}

function replaceIntent(
	caseRef: D695CaseRef,
	request: EmpiricalModelTurnRequestV1,
	step: number,
	plan: D693ScriptedMutationPlanV1,
): EmpiricalModelToolIntentV1 {
	const schema = request.availableTools.find(
		(candidate) => candidate.toolRef === CLOSED_ACTOR_TOOL_REFS.replaceExact,
	);
	if (schema === undefined || schema.inputSchema.kind !== "object") {
		throw new TypeError("D695 host omitted replaceExact schema");
	}
	const hostDerivesDigest = !schema.inputSchema.properties.some(
		(property) => property.name === "baseContentDigest",
	);
	return toolIntent(caseRef, step, 0, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
		...(hostDerivesDigest ? {} : { baseContentDigest: plan.initialContentDigest }),
		newText: plan.acceptedNewText,
		oldText: plan.initialOldText,
		path: plan.writablePath,
	});
}

function scriptedBody(
	caseRef: D695CaseRef,
	request: EmpiricalModelTurnRequestV1,
	plan: D693ScriptedMutationPlanV1,
): ScriptedBody {
	const step = request.stepIndex;
	const reads = () =>
		plan.readPaths.map((path, index) =>
			toolIntent(caseRef, step, index, CLOSED_ACTOR_TOOL_REFS.readFile, { path }),
		);
	if (caseRef === "duplicate-multiple-intent" && step === 0) {
		return {
			finishReason: "tool-intents",
			toolIntents: [
				toolIntent(caseRef, step, 0, CLOSED_ACTOR_TOOL_REFS.readFile, {
					path: plan.readPaths[0]!,
				}),
				toolIntent(caseRef, step, 1, CLOSED_ACTOR_TOOL_REFS.readFile, {
					path: plan.readPaths[0]!,
				}),
			],
		};
	}
	if (step === 0) return { finishReason: "tool-intents", toolIntents: reads() };
	if (step === 1 && caseRef !== "mutation-state-reset") return finalBody(caseRef);
	if (caseRef === "repeated-inspection") {
		return { finishReason: "tool-intents", toolIntents: reads() };
	}
	const mutationStep = caseRef === "mutation-state-reset" ? 1 : 2;
	if (step === mutationStep) {
		return {
			finishReason: "tool-intents",
			toolIntents: [replaceIntent(caseRef, request, step, plan)],
		};
	}
	if (caseRef === "mutation-state-reset" && step === 2) {
		return { finishReason: "tool-intents", toolIntents: reads() };
	}
	const diffStep = mutationStep + (caseRef === "mutation-state-reset" ? 2 : 1);
	if (step === diffStep) {
		return {
			finishReason: "tool-intents",
			toolIntents: [toolIntent(caseRef, step, 0, CLOSED_ACTOR_TOOL_REFS.workspaceDiff, {})],
		};
	}
	if (step === diffStep + 1) {
		return {
			finishReason: "tool-intents",
			toolIntents: [
				toolIntent(caseRef, step, 0, CLOSED_ACTOR_TOOL_REFS.runCommand, {
					commandRef: plan.validationCommandRef,
				}),
			],
		};
	}
	return finalBody(caseRef);
}

function offlineVerifier(
	host: D693PreparedHostV1,
	plan: D693ScriptedMutationPlanV1,
): ClosedVerifierCapabilityV1 {
	const profile = strictSnapshot(host.taskProfile.verifierProfile);
	return Object.freeze({
		verifierProfileRef: profile.verifierProfileRef,
		verifierProfileRevision: profile.verifierProfileRevision,
		verifierProfileDigest: empiricalStrictJsonDigest(profile),
		async verify(input: Parameters<ClosedVerifierCapabilityV1["verify"]>[0]) {
			const bytes = new Uint8Array(
				await readFile(join(input.workspace.rootPathForHostRunner(), plan.writablePath)),
			);
			const passed = empiricalSha256(bytes) === plan.acceptedContentDigest;
			const id = "target-run.d695";
			return strictSnapshot({
				schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.verifierResult,
				verdict: passed ? ("passed" as const) : ("failed" as const),
				evidenceRefs: [
					{
						kind: "target-verification" as const,
						id,
						digest: empiricalStrictJsonDigest({
							id,
							workspaceStateDigest: input.profileCoordinates.workspaceStateDigest,
						}),
						taskRef: input.profileCoordinates.taskRef,
						taskDigest: input.profileCoordinates.taskDigest,
						verifierProfileRef: input.profileCoordinates.verifierProfileRef,
						verifierProfileDigest: input.profileCoordinates.verifierProfileDigest,
						fixtureSuiteDigest: input.profileCoordinates.fixtureSuiteDigest,
						workspaceStateDigest: input.profileCoordinates.workspaceStateDigest,
						harnessRevision: input.profileCoordinates.harnessRevision,
					},
				],
				issueCodes: passed ? [] : ["target-artifact-mismatch"],
			});
		},
	});
}

export async function runD695OfflineCase(input: {
	readonly caseRef: D695CaseRef;
	readonly host: D693PreparedHostV1;
	readonly plan: D693ScriptedMutationPlanV1;
	readonly signal: AbortSignal;
}): Promise<D695CaseReportV1> {
	const candidate = record(input, "d695.caseInput");
	exactKeys(candidate, ["caseRef", "host", "plan", "signal"], "d695.caseInput");
	if (!(candidate.signal instanceof AbortSignal)) throw new TypeError("D695 requires AbortSignal");
	const signal = candidate.signal;
	if (signal.aborted) throw new DOMException("D695 cancelled", "AbortError");
	if (
		typeof candidate.caseRef !== "string" ||
		!(D695_CASE_ORDER as readonly string[]).includes(candidate.caseRef)
	) {
		throw new TypeError("D695 case is not preregistered");
	}
	const caseRef = candidate.caseRef as D695CaseRef;
	const hostRecord = record(candidate.host, "d695.caseInput.host");
	exactKeys(
		hostRecord,
		[
			"frozen",
			"initialRequest",
			"materialization",
			"protectionExecutor",
			"qualificationReport",
			"taskProfile",
		],
		"d695.caseInput.host",
	);
	const callerHost = hostRecord as unknown as D693PreparedHostV1;
	if (!isTrustedLocalSingleBaselineMaterialization(callerHost.materialization)) {
		throw new TypeError("D695 requires a trusted local single-baseline materialization");
	}
	const host: D693PreparedHostV1 = Object.freeze({ ...callerHost });
	const plan = validatePlan(candidate.plan as D693ScriptedMutationPlanV1);
	assertD693OfflineCommandFixture(host, plan);
	const capsules: ClosedHostContinuationV1[] = [];
	let rejectionPriorToolResultsBytes: Uint8Array | null = null;
	let rejectionPriorToolResultCount = 0;
	let capsulePriorToolResultsBytes: Uint8Array | null = null;
	let capsuleRequestBindingPassed = false;
	const duplicateReceipts: ClosedNoProgressReceiptV1[] = [];
	const basePort: EmpiricalModelTurnPortV1 = Object.freeze({
		async invoke(request: EmpiricalModelTurnRequestV1, turnSignal: AbortSignal) {
			if (turnSignal.aborted) throw new DOMException("D695 cancelled", "AbortError");
			const body = scriptedBody(caseRef, request, plan);
			if (
				body.finishReason === "structured-output" &&
				request.stepIndex === 1 &&
				(caseRef === "feedback-recovery" || caseRef === "repeated-inspection")
			) {
				rejectionPriorToolResultsBytes = strictJsonCodec.encode(request.priorToolResults);
				rejectionPriorToolResultCount = request.priorToolResults.length;
			}
			return completedOutcome(request, host, body);
		},
	});
	const continuationPort: ClosedContinuationModelTurnPortV1 = Object.freeze({
		async invoke(
			request: EmpiricalModelTurnRequestV1,
			continuation: ClosedHostContinuationV1,
			turnSignal: AbortSignal,
		) {
			if (turnSignal.aborted) throw new DOMException("D695 cancelled", "AbortError");
			if (capsules.length === 0) {
				capsulePriorToolResultsBytes = strictJsonCodec.encode(request.priorToolResults);
				capsuleRequestBindingPassed =
					isConstructedClosedHostContinuationForRequest(continuation, request) &&
					rejectionPriorToolResultsBytes !== null &&
					sameBytes(rejectionPriorToolResultsBytes, capsulePriorToolResultsBytes);
			}
			capsules.push(continuation);
			return completedOutcome(request, host, scriptedBody(caseRef, request, plan));
		},
	});
	const outcome = await runClosedTaskProfileHost({
		...host,
		modelTurnPort: basePort,
		continuationModelTurnPort: continuationPort,
		verifier: offlineVerifier(host, plan),
		objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
		noProgressContinuationPolicy: D695_NO_PROGRESS_CONTINUATION_POLICY,
		noProgressReceiptObserver: Object.freeze({
			observerRef: "observer.d695.offline",
			observerRevision: "observer.d695.offline.v1",
			record(receipt: ClosedNoProgressReceiptV1) {
				duplicateReceipts.push(receipt);
			},
		}),
		signal,
	});
	const experimentBindingDigest = empiricalStrictJsonDigest({
		frozenDigest: empiricalStrictJsonDigest(host.frozen),
		qualificationDigest: empiricalStrictJsonDigest(host.qualificationReport),
		initialRequestDigest: empiricalStrictJsonDigest(host.initialRequest),
		taskProfileDigest: empiricalStrictJsonDigest(host.taskProfile),
		materializationEvidenceDigest: empiricalStrictJsonDigest(host.materialization.evidence),
		planDigest: empiricalStrictJsonDigest(plan),
		scriptedMechanismRevision: D695_SCRIPTED_MECHANISM_REVISION,
		objectivePolicyDigest: empiricalStrictJsonDigest(D693_ASSISTED_PROGRESS_POLICY),
		continuationPolicyDigest: empiricalStrictJsonDigest(D695_NO_PROGRESS_CONTINUATION_POLICY),
	});
	const rejectionBytes = rejectionPriorToolResultsBytes as Uint8Array | null;
	const capsuleBytes = capsulePriorToolResultsBytes as Uint8Array | null;
	const withoutDigest = strictSnapshot({
		caseRef,
		experimentBindingDigest,
		hostStatus: outcome.status,
		verifierVerdict: outcome.verifierVerdict,
		logicalStepCount: outcome.logicalStepCount,
		toolActionCount: outcome.toolActionCount,
		actionToolRefs: outcome.actionTrace.map((entry) => entry.toolRef),
		continuationCount: capsules.length,
		prematureContinuationObserved: capsules.some(
			(entry) => entry.reason === "premature-structured-output",
		),
		retainedResultsApplicable: rejectionBytes !== null,
		rejectionPriorToolResultCount,
		rejectionPriorToolResultsByteLength: rejectionBytes?.byteLength ?? 0,
		rejectionPriorToolResultsDigest: empiricalSha256(rejectionBytes ?? strictJsonCodec.encode([])),
		capsuleRetainedToolResultCount: capsules[0]?.retainedToolResultCount ?? 0,
		capsuleRetainedToolResultsDigest:
			capsules[0]?.retainedToolResultsDigest ?? empiricalStrictJsonDigest([]),
		retainedResultsBound:
			rejectionBytes === null
				? capsules.length === 0
				: capsuleRequestBindingPassed &&
					(capsuleBytes?.byteLength ?? Number.POSITIVE_INFINITY) <=
						D695_NO_PROGRESS_CONTINUATION_POLICY.maxRetainedBytes &&
					(capsules[0]?.retainedToolResultCount ?? Number.POSITIVE_INFINITY) > 0 &&
					(capsules[0]?.retainedToolResultCount ?? Number.POSITIVE_INFINITY) <=
						D695_NO_PROGRESS_CONTINUATION_POLICY.maxRetainedToolResults &&
					(capsules[0]?.retainedToolResultsDigest ?? "") ===
						empiricalSha256(capsuleBytes ?? new Uint8Array()),
		finalAllowedObserved: capsules.some((entry) => entry.requiredDisposition === "final-allowed"),
		duplicateReceiptCount: duplicateReceipts.length,
		duplicateRejectedBeforeExecution: duplicateReceipts.every(
			(entry) => entry.disposition === "rejected-before-tool-execution",
		),
		issueCodes: outcome.issueCodes,
		providerCallCount: 0 as const,
		networkCallCount: 0 as const,
		chargedCostMicrousd: 0 as const,
	});
	const report = strictSnapshot({
		...withoutDigest,
		caseDigest: empiricalStrictJsonDigest(withoutDigest),
	});
	constructedReports.add(report);
	return report;
}

function validateCase(value: unknown, expected: D695CaseRef): D695CaseReportV1 {
	const candidate = record(value, `d695.case.${expected}`);
	exactKeys(
		candidate,
		[
			"actionToolRefs",
			"capsuleRetainedToolResultCount",
			"capsuleRetainedToolResultsDigest",
			"caseDigest",
			"caseRef",
			"chargedCostMicrousd",
			"continuationCount",
			"duplicateReceiptCount",
			"duplicateRejectedBeforeExecution",
			"experimentBindingDigest",
			"finalAllowedObserved",
			"hostStatus",
			"issueCodes",
			"logicalStepCount",
			"networkCallCount",
			"prematureContinuationObserved",
			"providerCallCount",
			"rejectionPriorToolResultCount",
			"rejectionPriorToolResultsByteLength",
			"rejectionPriorToolResultsDigest",
			"retainedResultsApplicable",
			"retainedResultsBound",
			"toolActionCount",
			"verifierVerdict",
		],
		`d695.case.${expected}`,
	);
	if (candidate.caseRef !== expected) throw new TypeError("D695 case order mismatch");
	const verifierVerdict: D695CaseReportV1["verifierVerdict"] =
		candidate.verifierVerdict === null ||
		candidate.verifierVerdict === "passed" ||
		candidate.verifierVerdict === "failed" ||
		candidate.verifierVerdict === "unverifiable"
			? candidate.verifierVerdict
			: (() => {
					throw new TypeError("D695 verifier verdict invalid");
				})();
	const reconstructed = strictSnapshot({
		caseRef: expected,
		experimentBindingDigest: digest(
			candidate.experimentBindingDigest,
			"d695.case.experimentBindingDigest",
		),
		hostStatus:
			candidate.hostStatus === "completed" ? ("completed" as const) : ("non-evaluable" as const),
		verifierVerdict,
		logicalStepCount: safeInteger(candidate.logicalStepCount, "d695.case.logicalStepCount", {
			max: 256,
		}),
		toolActionCount: safeInteger(candidate.toolActionCount, "d695.case.toolActionCount", {
			max: 256,
		}),
		actionToolRefs: array(candidate.actionToolRefs, "d695.case.actionToolRefs").map((entry) =>
			coordinate(entry, "d695.case.actionToolRef"),
		),
		continuationCount: safeInteger(candidate.continuationCount, "d695.case.continuationCount", {
			max: 256,
		}),
		prematureContinuationObserved: boolean(
			candidate.prematureContinuationObserved,
			"d695.case.prematureContinuationObserved",
		),
		retainedResultsApplicable: boolean(
			candidate.retainedResultsApplicable,
			"d695.case.retainedResultsApplicable",
		),
		rejectionPriorToolResultCount: safeInteger(
			candidate.rejectionPriorToolResultCount,
			"d695.case.rejectionPriorToolResultCount",
			{ max: D695_NO_PROGRESS_CONTINUATION_POLICY.maxRetainedToolResults },
		),
		rejectionPriorToolResultsByteLength: safeInteger(
			candidate.rejectionPriorToolResultsByteLength,
			"d695.case.rejectionPriorToolResultsByteLength",
			{ max: D695_NO_PROGRESS_CONTINUATION_POLICY.maxRetainedBytes },
		),
		rejectionPriorToolResultsDigest: digest(
			candidate.rejectionPriorToolResultsDigest,
			"d695.case.rejectionPriorToolResultsDigest",
		),
		capsuleRetainedToolResultCount: safeInteger(
			candidate.capsuleRetainedToolResultCount,
			"d695.case.capsuleRetainedToolResultCount",
			{ max: D695_NO_PROGRESS_CONTINUATION_POLICY.maxRetainedToolResults },
		),
		capsuleRetainedToolResultsDigest: digest(
			candidate.capsuleRetainedToolResultsDigest,
			"d695.case.capsuleRetainedToolResultsDigest",
		),
		retainedResultsBound: boolean(candidate.retainedResultsBound, "d695.case.retainedResultsBound"),
		finalAllowedObserved: boolean(candidate.finalAllowedObserved, "d695.case.finalAllowedObserved"),
		duplicateReceiptCount: safeInteger(
			candidate.duplicateReceiptCount,
			"d695.case.duplicateReceiptCount",
			{ max: 8 },
		),
		duplicateRejectedBeforeExecution: boolean(
			candidate.duplicateRejectedBeforeExecution,
			"d695.case.duplicateRejectedBeforeExecution",
		),
		issueCodes: array(candidate.issueCodes, "d695.case.issueCodes").map((entry) =>
			coordinate(entry, "d695.case.issueCode"),
		),
		providerCallCount: literal(candidate.providerCallCount, 0, "d695.case.providerCallCount"),
		networkCallCount: literal(candidate.networkCallCount, 0, "d695.case.networkCallCount"),
		chargedCostMicrousd: literal(candidate.chargedCostMicrousd, 0, "d695.case.chargedCostMicrousd"),
	});
	const emptyResultsDigest = empiricalStrictJsonDigest([]);
	const derivedRetainedResultsBound = reconstructed.retainedResultsApplicable
		? reconstructed.rejectionPriorToolResultCount > 0 &&
			reconstructed.rejectionPriorToolResultsByteLength > 0 &&
			reconstructed.rejectionPriorToolResultCount ===
				reconstructed.capsuleRetainedToolResultCount &&
			reconstructed.rejectionPriorToolResultsDigest ===
				reconstructed.capsuleRetainedToolResultsDigest
		: reconstructed.rejectionPriorToolResultCount === 0 &&
			reconstructed.rejectionPriorToolResultsByteLength === 0 &&
			reconstructed.rejectionPriorToolResultsDigest === emptyResultsDigest &&
			reconstructed.capsuleRetainedToolResultCount === 0 &&
			reconstructed.capsuleRetainedToolResultsDigest === emptyResultsDigest;
	if (reconstructed.retainedResultsBound !== derivedRetainedResultsBound) {
		throw new TypeError("D695 retained-result binding is inconsistent");
	}
	const report = strictSnapshot({
		...reconstructed,
		caseDigest: empiricalStrictJsonDigest(reconstructed),
	});
	if (
		candidate.caseDigest !== report.caseDigest ||
		empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(report)
	) {
		throw new TypeError("D695 case is non-canonical or tampered");
	}
	return report;
}

export function createD695OfflineQualification(
	reportsInput: readonly D695CaseReportV1[],
): D695OfflineQualificationV1 {
	return createQualification(reportsInput, true);
}

function createQualification(
	reportsInput: readonly D695CaseReportV1[],
	requireConstructed: boolean,
): D695OfflineQualificationV1 {
	const values = array(reportsInput, "d695.qualification.reports");
	if (values.length !== D695_CASE_ORDER.length) throw new TypeError("D695 requires four cases");
	if (
		requireConstructed &&
		values.some(
			(entry) => typeof entry !== "object" || entry === null || !constructedReports.has(entry),
		)
	) {
		throw new TypeError("D695 qualification requires closed-host-produced reports");
	}
	const cases = values.map((entry, index) => validateCase(entry, D695_CASE_ORDER[index]!));
	const [recovery, repeated, multiple, reset] = cases as [
		D695CaseReportV1,
		D695CaseReportV1,
		D695CaseReportV1,
		D695CaseReportV1,
	];
	const oneExperiment = cases.every(
		(entry) => entry.experimentBindingDigest === recovery.experimentBindingDigest,
	);
	const feedbackRecoveryPassed =
		recovery.hostStatus === "completed" &&
		recovery.verifierVerdict === "passed" &&
		recovery.prematureContinuationObserved &&
		recovery.finalAllowedObserved;
	const retainedResultsBound =
		cases.every((entry) => entry.retainedResultsBound) &&
		recovery.retainedResultsApplicable &&
		repeated.retainedResultsApplicable &&
		!multiple.retainedResultsApplicable &&
		!reset.retainedResultsApplicable;
	const repeatedInspectionStoppedBeforeExecution =
		repeated.issueCodes.includes("repeated-inspection-turn-no-progress") &&
		repeated.toolActionCount ===
			recovery.actionToolRefs.filter((ref) => ref === CLOSED_ACTOR_TOOL_REFS.readFile).length &&
		repeated.duplicateReceiptCount === 1 &&
		repeated.duplicateRejectedBeforeExecution;
	const multipleIntentStoppedBeforeExecution =
		multiple.issueCodes.includes("duplicate-inspection-intent-in-turn") &&
		multiple.toolActionCount === 0 &&
		multiple.duplicateReceiptCount === 1 &&
		multiple.duplicateRejectedBeforeExecution;
	const mutationStateResetPassed =
		reset.hostStatus === "completed" &&
		reset.verifierVerdict === "passed" &&
		reset.actionToolRefs.filter((ref) => ref === CLOSED_ACTOR_TOOL_REFS.readFile).length >= 2;
	const qualified =
		oneExperiment &&
		feedbackRecoveryPassed &&
		retainedResultsBound &&
		repeatedInspectionStoppedBeforeExecution &&
		multipleIntentStoppedBeforeExecution &&
		mutationStateResetPassed;
	const withoutDigest = strictSnapshot({
		schemaVersion: D695_OFFLINE_QUALIFICATION_SCHEMA,
		authorityRef: "decision.D695" as const,
		authorityRevision: "decision.D695.2026-08-08.v1" as const,
		claimBoundary: D695_CLAIM_BOUNDARY,
		policyDigest: empiricalStrictJsonDigest(D695_NO_PROGRESS_CONTINUATION_POLICY),
		caseOrder: D695_CASE_ORDER,
		cases,
		feedbackRecoveryPassed,
		retainedResultsBound,
		repeatedInspectionStoppedBeforeExecution,
		multipleIntentStoppedBeforeExecution,
		mutationStateResetPassed,
		providerCallCount: 0 as const,
		networkCallCount: 0 as const,
		chargedCostMicrousd: 0 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		qualified,
	});
	const qualification = strictSnapshot({
		...withoutDigest,
		qualificationDigest: empiricalStrictJsonDigest(withoutDigest),
	});
	if (requireConstructed) constructedQualifications.add(qualification);
	return qualification;
}

export function validateD695OfflineQualification(value: unknown): D695OfflineQualificationV1 {
	const candidate = record(value, "d695.qualification");
	exactKeys(
		candidate,
		[
			"authorityRef",
			"authorityRevision",
			"caseOrder",
			"cases",
			"causalAttribution",
			"chargedCostMicrousd",
			"claimBoundary",
			"efficacyClaim",
			"feedbackRecoveryPassed",
			"multipleIntentStoppedBeforeExecution",
			"mutationStateResetPassed",
			"networkCallCount",
			"policyDigest",
			"providerCallCount",
			"qualificationDigest",
			"qualified",
			"repeatedInspectionStoppedBeforeExecution",
			"retainedResultsBound",
			"schemaVersion",
		],
		"d695.qualification",
	);
	literal(
		candidate.schemaVersion,
		D695_OFFLINE_QUALIFICATION_SCHEMA,
		"d695.qualification.schemaVersion",
	);
	literal(candidate.authorityRef, "decision.D695", "d695.qualification.authorityRef");
	literal(
		candidate.authorityRevision,
		"decision.D695.2026-08-08.v1",
		"d695.qualification.authorityRevision",
	);
	literal(candidate.claimBoundary, D695_CLAIM_BOUNDARY, "d695.qualification.claimBoundary");
	literal(candidate.causalAttribution, "undetermined", "d695.qualification.causalAttribution");
	literal(candidate.efficacyClaim, "none", "d695.qualification.efficacyClaim");
	literal(candidate.providerCallCount, 0, "d695.qualification.providerCallCount");
	literal(candidate.networkCallCount, 0, "d695.qualification.networkCallCount");
	literal(candidate.chargedCostMicrousd, 0, "d695.qualification.chargedCostMicrousd");
	const order = array(candidate.caseOrder, "d695.qualification.caseOrder");
	if (
		order.length !== D695_CASE_ORDER.length ||
		order.some((entry, index) => entry !== D695_CASE_ORDER[index])
	) {
		throw new TypeError("D695 qualification order is not frozen");
	}
	const reconstructed = createQualification(
		array(candidate.cases, "d695.qualification.cases") as unknown as D695CaseReportV1[],
		false,
	);
	if (empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(reconstructed)) {
		throw new TypeError("D695 qualification is non-canonical or tampered");
	}
	return reconstructed;
}

export interface D695AtomicCommitOperationsV1 {
	rename(stagingPath: string, finalPath: string): Promise<void>;
	remove(path: string): Promise<void>;
	syncParent(path: string): Promise<void>;
}

const D695_ATOMIC_COMMIT_OPERATIONS: D695AtomicCommitOperationsV1 = Object.freeze({
	rename,
	remove(path: string) {
		return rm(path, { recursive: true, force: true });
	},
	syncParent: syncDirectory,
});

export async function commitD695PrivateGenerationAtomically(
	stagingPath: string,
	finalPath: string,
	privateRoot: string,
	operations: D695AtomicCommitOperationsV1 = D695_ATOMIC_COMMIT_OPERATIONS,
): Promise<void> {
	await operations.rename(stagingPath, finalPath);
	try {
		await operations.syncParent(privateRoot);
	} catch (error) {
		try {
			await operations.remove(finalPath);
			await operations.syncParent(privateRoot);
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], "D695 final generation cleanup failed");
		}
		throw error;
	}
}

export async function persistD695OfflineQualification(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly qualification: D695OfflineQualificationV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}): Promise<{
	readonly generationPath: string;
	readonly qualificationDigest: string;
	readonly generationDigest: string;
}> {
	const candidate = record(input, "d695.persistence");
	exactKeys(
		candidate,
		["generationRef", "privateRoot", "protectionExecutor", "qualification"],
		"d695.persistence",
	);
	if (!isEmpiricalExactPrivateNeedleProtectionExecutor(candidate.protectionExecutor)) {
		throw new TypeError("D695 persistence requires constructed private protection");
	}
	const protectionExecutor = candidate.protectionExecutor;
	const privateRoot = await assertSafePrivateRoot(
		string(candidate.privateRoot, "d695.persistence.privateRoot", 4_096),
	);
	const generationRef = coordinate(candidate.generationRef, "d695.persistence.generationRef");
	if (
		basename(generationRef) !== generationRef ||
		generationRef === "." ||
		generationRef === ".."
	) {
		throw new TypeError("D695 generation ref must be path-free");
	}
	if (
		typeof candidate.qualification !== "object" ||
		candidate.qualification === null ||
		!constructedQualifications.has(candidate.qualification)
	) {
		throw new TypeError("D695 persistence requires a same-process qualification");
	}
	const qualification = validateD695OfflineQualification(candidate.qualification);
	if (!qualification.qualified) throw new TypeError("D695 refuses unqualified persistence");
	const qualificationBytes = strictJsonCodec.encode(qualification);
	const qualificationDigest = empiricalSha256(qualificationBytes);
	const generationWithoutDigest = strictSnapshot({
		schemaVersion: D695_OFFLINE_GENERATION_SCHEMA,
		generationRef,
		qualification: {
			file: QUALIFICATION_FILE,
			digest: qualificationDigest,
			byteLength: qualificationBytes.byteLength,
		},
	});
	const generation = strictSnapshot({
		...generationWithoutDigest,
		generationDigest: empiricalStrictJsonDigest(generationWithoutDigest),
	});
	assertPrivateArtifactProtection({
		subject: qualification,
		label: "D695 qualification",
		protectionExecutor,
	});
	assertPrivateArtifactProtection({
		subject: generation,
		label: "D695 generation",
		protectionExecutor,
	});
	const generationBytes = strictJsonCodec.encode(generation);
	const generationDigest = empiricalSha256(generationBytes);
	const finalPath = join(privateRoot, generationRef);
	try {
		await lstat(finalPath);
		throw new TypeError("D695 generation already exists");
	} catch (error) {
		if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
	}
	const stagingPath = join(privateRoot, `.d695-staging-${randomUUID()}`);
	await mkdir(stagingPath, { mode: 0o700 });
	try {
		await chmod(stagingPath, 0o700);
		await writePrivateFile(join(stagingPath, QUALIFICATION_FILE), qualificationBytes);
		await writePrivateFile(join(stagingPath, GENERATION_FILE), generationBytes);
		if (
			empiricalSha256(new Uint8Array(await readFile(join(stagingPath, QUALIFICATION_FILE)))) !==
				qualificationDigest ||
			empiricalSha256(new Uint8Array(await readFile(join(stagingPath, GENERATION_FILE)))) !==
				generationDigest
		)
			throw new TypeError("D695 persistence readback failed");
		await syncDirectory(stagingPath);
		await commitD695PrivateGenerationAtomically(stagingPath, finalPath, privateRoot);
		return Object.freeze({ generationPath: finalPath, qualificationDigest, generationDigest });
	} catch (error) {
		try {
			await lstat(finalPath);
		} catch (finalError) {
			if (
				!(finalError instanceof Error) ||
				!("code" in finalError) ||
				finalError.code !== "ENOENT"
			) {
				throw new AggregateError([error, finalError], "D695 final-path inspection failed");
			}
			try {
				await rm(stagingPath, { recursive: true, force: true });
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], "D695 staging cleanup failed");
			}
		}
		throw error;
	}
}
