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
	strictSnapshot,
	string,
} from "./canonical.js";
import {
	CLOSED_ACTOR_TOOL_REFS,
	CLOSED_TASK_PROFILE_HOST_SCHEMAS,
	type ClosedContinuationModelTurnPortV1,
	type ClosedHostContinuationV1,
	type ClosedMutationFirstContinuationModelTurnPortV1,
	type ClosedMutationFirstContinuationV1,
	type ClosedNoProgressReceiptV1,
	type ClosedStaleResultRecoveryPolicyV1,
	type ClosedVerifierCapabilityV1,
	isConstructedMutationFirstContinuationForPriorRejection,
	isConstructedMutationFirstContinuationForRequest,
	runClosedTaskProfileHost,
} from "./closed-task-profile-host.js";
import {
	assertD693OfflineCommandFixture,
	D693_ASSISTED_PROGRESS_POLICY,
	type D693PreparedHostV1,
	type D693ScriptedMutationPlanV1,
} from "./d693-assisted-progress-qualification.js";
import { D695_NO_PROGRESS_CONTINUATION_POLICY } from "./d695-no-progress-continuation-qualification.js";
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

export const D702_STALE_RESULT_RECOVERY_POLICY = strictSnapshot({
	schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.staleResultRecoveryPolicy,
	policyRef: "stale-result-recovery.d702.mutation-first",
	policyRevision: "decision.D702.2026-08-09.v1",
	requiredFirstToolRef: CLOSED_ACTOR_TOOL_REFS.replaceExact,
	objectiveProgressPolicyDigest: empiricalStrictJsonDigest(D693_ASSISTED_PROGRESS_POLICY),
	noProgressContinuationPolicyDigest: empiricalStrictJsonDigest(
		D695_NO_PROGRESS_CONTINUATION_POLICY,
	),
	maxRecoveryContinuations: 1,
	maxWorkspaceStateBytes: 1_048_576,
}) satisfies ClosedStaleResultRecoveryPolicyV1;

export const D702_QUALIFICATION_SCHEMA =
	"graphrefly.private-solution-eval.d702-mutation-first-qualification.v1" as const;
export const D702_GENERATION_SCHEMA =
	"graphrefly.private-solution-eval.d702-mutation-first-generation.v1" as const;
export const D702_CLAIM_BOUNDARY =
	"offline-stale-result-mutation-first-contract-no-provider-no-efficacy-claim" as const;
export const D702_CASE_ORDER = Object.freeze([
	"historical-shaped-recovery",
	"generic-recovery-a",
	"generic-recovery-b",
	"wrong-first",
	"repeated-stale",
] as const);
export type D702CaseRef = (typeof D702_CASE_ORDER)[number];

export interface D702CaseReportV1 {
	readonly caseRef: D702CaseRef;
	readonly fixtureBindingDigest: string;
	readonly hostStatus: "completed" | "non-evaluable";
	readonly verifierVerdict: "passed" | "failed" | "unverifiable" | null;
	readonly actionToolRefs: readonly string[];
	readonly toolActionCount: number;
	readonly d695ContinuationCount: number;
	readonly mutationFirstContinuationCount: number;
	readonly mutationFirstRequestBound: boolean;
	readonly mutationFirstPriorEvidenceBound: boolean;
	readonly staleResultReceiptDigestBound: boolean;
	readonly requiredFirstToolRef: string | null;
	readonly staleReceiptCount: number;
	readonly staleReceiptRejectedBeforeExecution: boolean;
	readonly recoveryActionCount: number;
	readonly issueCodes: readonly string[];
	readonly providerCallCount: 0;
	readonly networkCallCount: 0;
	readonly chargedCostMicrousd: 0;
	readonly caseDigest: string;
}

export interface D702OfflineQualificationV1 {
	readonly schemaVersion: typeof D702_QUALIFICATION_SCHEMA;
	readonly authorityRef: "decision.D702";
	readonly authorityRevision: "decision.D702.2026-08-09.v1";
	readonly claimBoundary: typeof D702_CLAIM_BOUNDARY;
	readonly d693PolicyDigest: string;
	readonly d695PolicyDigest: string;
	readonly d702PolicyDigest: string;
	readonly caseOrder: typeof D702_CASE_ORDER;
	readonly cases: readonly D702CaseReportV1[];
	readonly twoGenericRecoveriesPassed: boolean;
	readonly staleBatchRejectedBeforeExecution: boolean;
	readonly mutationFirstBound: boolean;
	readonly wrongFirstStopped: boolean;
	readonly repeatedStaleStopped: boolean;
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

const QUALIFICATION_FILE = "mutation-first-qualification.v1.json";
const GENERATION_FILE = "generation.v1.json";
const constructedReports = new WeakSet<object>();
const constructedQualifications = new WeakSet<object>();

function validatePlan(value: D693ScriptedMutationPlanV1): D693ScriptedMutationPlanV1 {
	const plan = record(value, "d702.plan");
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
		"d702.plan",
	);
	const readPaths = array(plan.readPaths, "d702.plan.readPaths").map((entry, index) =>
		string(entry, `d702.plan.readPaths[${index}]`, 1_024),
	);
	if (
		readPaths.length < 1 ||
		readPaths.length > 32 ||
		new Set(readPaths).size !== readPaths.length
	) {
		throw new TypeError("D702 plan read paths are not bounded and unique");
	}
	const normalized = strictSnapshot({
		readPaths,
		writablePath: string(plan.writablePath, "d702.plan.writablePath", 1_024),
		initialContentDigest: digest(plan.initialContentDigest, "d702.plan.initialContentDigest"),
		initialOldText: string(plan.initialOldText, "d702.plan.initialOldText", 65_536),
		acceptedNewText: string(plan.acceptedNewText, "d702.plan.acceptedNewText", 65_536),
		rejectedNewText: string(plan.rejectedNewText, "d702.plan.rejectedNewText", 65_536),
		acceptedContentDigest: digest(plan.acceptedContentDigest, "d702.plan.acceptedContentDigest"),
		validationCommandRef: coordinate(plan.validationCommandRef, "d702.plan.validationCommandRef"),
		otherCommandRef: coordinate(plan.otherCommandRef, "d702.plan.otherCommandRef"),
	});
	if (
		!normalized.readPaths.includes(normalized.writablePath) ||
		normalized.validationCommandRef !== D693_ASSISTED_PROGRESS_POLICY.validationCommandRef
	) {
		throw new TypeError("D702 plan is not bound to D693");
	}
	return normalized;
}

function toolIntent(
	caseRef: D702CaseRef,
	step: number,
	index: number,
	toolRef: string,
	argumentsValue: StrictJsonValue,
): EmpiricalModelToolIntentV1 {
	return strictSnapshot({
		toolCallRef: `d702.${caseRef}.${step}.${index}`,
		toolRef,
		argumentsDigest: empiricalStrictJsonDigest(argumentsValue),
		arguments: argumentsValue,
	});
}

function replaceIntent(
	caseRef: D702CaseRef,
	request: EmpiricalModelTurnRequestV1,
	plan: D693ScriptedMutationPlanV1,
	index: number,
): EmpiricalModelToolIntentV1 {
	const schema = request.availableTools.find(
		(candidate) => candidate.toolRef === CLOSED_ACTOR_TOOL_REFS.replaceExact,
	);
	if (schema === undefined || schema.inputSchema.kind !== "object") {
		throw new TypeError("D702 host omitted replaceExact schema");
	}
	const hostDerivesDigest = !schema.inputSchema.properties.some(
		(property) => property.name === "baseContentDigest",
	);
	return toolIntent(caseRef, request.stepIndex, index, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
		...(hostDerivesDigest ? {} : { baseContentDigest: plan.initialContentDigest }),
		newText: plan.acceptedNewText,
		oldText: plan.initialOldText,
		path: plan.writablePath,
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

function finalBody(caseRef: D702CaseRef): ScriptedBody {
	return {
		finishReason: "structured-output",
		structuredOutput: { kind: "model-turn-output-placeholder", summary: `D702 ${caseRef}` },
	};
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
			const id = `target-run.d702.${empiricalStrictJsonDigest(plan).slice(-12)}`;
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

export async function runD702OfflineCase(input: {
	readonly caseRef: D702CaseRef;
	readonly host: D693PreparedHostV1;
	readonly plan: D693ScriptedMutationPlanV1;
	readonly signal: AbortSignal;
}): Promise<D702CaseReportV1> {
	const candidate = record(input, "d702.caseInput");
	exactKeys(candidate, ["caseRef", "host", "plan", "signal"], "d702.caseInput");
	if (!(candidate.signal instanceof AbortSignal)) throw new TypeError("D702 requires AbortSignal");
	const signal = candidate.signal;
	if (signal.aborted) throw new DOMException("D702 cancelled", "AbortError");
	if (
		typeof candidate.caseRef !== "string" ||
		!(D702_CASE_ORDER as readonly string[]).includes(candidate.caseRef)
	) {
		throw new TypeError("D702 case is not preregistered");
	}
	const caseRef = candidate.caseRef as D702CaseRef;
	const hostRecord = record(candidate.host, "d702.caseInput.host");
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
		"d702.caseInput.host",
	);
	const callerHost = hostRecord as unknown as D693PreparedHostV1;
	if (!isTrustedLocalSingleBaselineMaterialization(callerHost.materialization)) {
		throw new TypeError("D702 requires a trusted local materialization");
	}
	const host: D693PreparedHostV1 = Object.freeze({ ...callerHost });
	const plan = validatePlan(candidate.plan as D693ScriptedMutationPlanV1);
	assertD693OfflineCommandFixture(host, plan);
	const d695Continuations: ClosedHostContinuationV1[] = [];
	const mutationContinuations: ClosedMutationFirstContinuationV1[] = [];
	const receipts: ClosedNoProgressReceiptV1[] = [];
	const staleRejectedRequests: EmpiricalModelTurnRequestV1[] = [];
	const reads = (request: EmpiricalModelTurnRequestV1) =>
		plan.readPaths.map((path, index) =>
			toolIntent(caseRef, request.stepIndex, index, CLOSED_ACTOR_TOOL_REFS.readFile, { path }),
		);
	const basePort: EmpiricalModelTurnPortV1 = Object.freeze({
		async invoke(request: EmpiricalModelTurnRequestV1) {
			return completedOutcome(
				request,
				host,
				request.stepIndex === 0
					? { finishReason: "tool-intents", toolIntents: reads(request) }
					: finalBody(caseRef),
			);
		},
	});
	const continuationPort: ClosedContinuationModelTurnPortV1 = Object.freeze({
		async invoke(request: EmpiricalModelTurnRequestV1, continuation: ClosedHostContinuationV1) {
			d695Continuations.push(continuation);
			if (request.stepIndex === 2) {
				staleRejectedRequests.push(request);
				return completedOutcome(request, host, {
					finishReason: "tool-intents",
					toolIntents: [
						toolIntent(caseRef, request.stepIndex, 0, CLOSED_ACTOR_TOOL_REFS.readFile, {
							path: plan.readPaths[0]!,
						}),
						replaceIntent(caseRef, request, plan, 1),
					],
				});
			}
			return completedOutcome(request, host, finalBody(caseRef));
		},
	});
	let mutationFirstRequestBound = false;
	let mutationFirstPriorEvidenceBound = false;
	let staleResultReceiptDigestBound = false;
	const mutationFirstPort: ClosedMutationFirstContinuationModelTurnPortV1 = Object.freeze({
		async invoke(
			request: EmpiricalModelTurnRequestV1,
			continuation: ClosedMutationFirstContinuationV1,
		) {
			mutationContinuations.push(continuation);
			mutationFirstRequestBound = isConstructedMutationFirstContinuationForRequest(
				continuation,
				request,
			);
			const staleReceipt = receipts.find((receipt) => receipt.kind === "stale-result-intent-batch");
			const staleRejectedRequest = staleRejectedRequests[0];
			mutationFirstPriorEvidenceBound =
				staleReceipt !== undefined &&
				staleRejectedRequest !== undefined &&
				isConstructedMutationFirstContinuationForPriorRejection(
					continuation,
					staleRejectedRequest,
					staleReceipt,
				);
			staleResultReceiptDigestBound =
				staleReceipt !== undefined &&
				continuation.staleResultReceiptDigest === empiricalStrictJsonDigest(staleReceipt);
			const safe =
				caseRef === "historical-shaped-recovery" ||
				caseRef === "generic-recovery-a" ||
				caseRef === "generic-recovery-b";
			return completedOutcome(request, host, {
				finishReason: "tool-intents",
				toolIntents: safe
					? [
							replaceIntent(caseRef, request, plan, 0),
							toolIntent(caseRef, request.stepIndex, 1, CLOSED_ACTOR_TOOL_REFS.workspaceDiff, {}),
							toolIntent(caseRef, request.stepIndex, 2, CLOSED_ACTOR_TOOL_REFS.runCommand, {
								commandRef: plan.validationCommandRef,
							}),
						]
					: caseRef === "wrong-first"
						? [
								toolIntent(caseRef, request.stepIndex, 0, CLOSED_ACTOR_TOOL_REFS.readFile, {
									path: plan.readPaths[0]!,
								}),
								replaceIntent(caseRef, request, plan, 1),
							]
						: [
								replaceIntent(caseRef, request, plan, 0),
								toolIntent(caseRef, request.stepIndex, 1, CLOSED_ACTOR_TOOL_REFS.workspaceDiff, {}),
								replaceIntent(caseRef, request, plan, 2),
							],
			});
		},
	});
	const outcome = await runClosedTaskProfileHost({
		...host,
		modelTurnPort: basePort,
		continuationModelTurnPort: continuationPort,
		mutationFirstContinuationModelTurnPort: mutationFirstPort,
		verifier: offlineVerifier(host, plan),
		objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
		noProgressContinuationPolicy: D695_NO_PROGRESS_CONTINUATION_POLICY,
		staleResultRecoveryPolicy: D702_STALE_RESULT_RECOVERY_POLICY,
		noProgressReceiptObserver: Object.freeze({
			observerRef: "observer.d702.offline",
			observerRevision: "observer.d702.offline.v1",
			record(receipt: ClosedNoProgressReceiptV1) {
				receipts.push(receipt);
			},
		}),
		signal,
	});
	const staleReceipts = receipts.filter((receipt) => receipt.kind === "stale-result-intent-batch");
	const firstStaleStep = staleReceipts[0]?.stepIndex ?? Number.MAX_SAFE_INTEGER;
	const recoveryActionCount = outcome.actionTrace.filter(
		(entry) => entry.stepIndex > firstStaleStep,
	).length;
	const withoutDigest = strictSnapshot({
		caseRef,
		fixtureBindingDigest: empiricalStrictJsonDigest({
			frozen: host.frozen,
			initialRequest: host.initialRequest,
			taskProfile: host.taskProfile,
			materialization: host.materialization.evidence,
			plan,
		}),
		hostStatus: outcome.status,
		verifierVerdict: outcome.verifierVerdict,
		actionToolRefs: outcome.actionTrace.map((entry) => entry.toolRef),
		toolActionCount: outcome.toolActionCount,
		d695ContinuationCount: d695Continuations.length,
		mutationFirstContinuationCount: mutationContinuations.length,
		mutationFirstRequestBound,
		mutationFirstPriorEvidenceBound,
		staleResultReceiptDigestBound,
		requiredFirstToolRef: mutationContinuations[0]?.requiredFirstToolRef ?? null,
		staleReceiptCount: staleReceipts.length,
		staleReceiptRejectedBeforeExecution: staleReceipts.every(
			(receipt) => receipt.disposition === "rejected-before-tool-execution",
		),
		recoveryActionCount,
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

function validateCase(value: unknown, expected: D702CaseRef): D702CaseReportV1 {
	const candidate = record(value, `d702.case.${expected}`);
	exactKeys(
		candidate,
		[
			"actionToolRefs",
			"caseDigest",
			"caseRef",
			"chargedCostMicrousd",
			"d695ContinuationCount",
			"fixtureBindingDigest",
			"hostStatus",
			"issueCodes",
			"mutationFirstContinuationCount",
			"mutationFirstPriorEvidenceBound",
			"mutationFirstRequestBound",
			"networkCallCount",
			"providerCallCount",
			"requiredFirstToolRef",
			"recoveryActionCount",
			"staleReceiptCount",
			"staleResultReceiptDigestBound",
			"staleReceiptRejectedBeforeExecution",
			"toolActionCount",
			"verifierVerdict",
		],
		`d702.case.${expected}`,
	);
	if (candidate.caseRef !== expected) throw new TypeError("D702 case order mismatch");
	const verifierVerdict: D702CaseReportV1["verifierVerdict"] =
		candidate.verifierVerdict === null ||
		candidate.verifierVerdict === "passed" ||
		candidate.verifierVerdict === "failed" ||
		candidate.verifierVerdict === "unverifiable"
			? candidate.verifierVerdict
			: (() => {
					throw new TypeError("D702 verifier verdict invalid");
				})();
	const reconstructed = strictSnapshot({
		caseRef: expected,
		fixtureBindingDigest: digest(candidate.fixtureBindingDigest, "d702.case.fixtureBindingDigest"),
		hostStatus:
			candidate.hostStatus === "completed" ? ("completed" as const) : ("non-evaluable" as const),
		verifierVerdict,
		actionToolRefs: (() => {
			const values = array(candidate.actionToolRefs, "d702.case.actionToolRefs");
			if (values.length > 256) throw new TypeError("D702 action tool refs exceed bound");
			return values.map((entry, index) => coordinate(entry, `d702.case.actionToolRefs[${index}]`));
		})(),
		toolActionCount: safeInteger(candidate.toolActionCount, "d702.case.toolActionCount", {
			max: 256,
		}),
		d695ContinuationCount: safeInteger(
			candidate.d695ContinuationCount,
			"d702.case.d695ContinuationCount",
			{ max: 32 },
		),
		mutationFirstContinuationCount: safeInteger(
			candidate.mutationFirstContinuationCount,
			"d702.case.mutationFirstContinuationCount",
			{ max: 1 },
		),
		mutationFirstRequestBound: boolean(
			candidate.mutationFirstRequestBound,
			"d702.case.mutationFirstRequestBound",
		),
		mutationFirstPriorEvidenceBound: boolean(
			candidate.mutationFirstPriorEvidenceBound,
			"d702.case.mutationFirstPriorEvidenceBound",
		),
		staleResultReceiptDigestBound: boolean(
			candidate.staleResultReceiptDigestBound,
			"d702.case.staleResultReceiptDigestBound",
		),
		requiredFirstToolRef:
			candidate.requiredFirstToolRef === null
				? null
				: coordinate(candidate.requiredFirstToolRef, "d702.case.requiredFirstToolRef"),
		staleReceiptCount: safeInteger(candidate.staleReceiptCount, "d702.case.staleReceiptCount", {
			max: 2,
		}),
		staleReceiptRejectedBeforeExecution: boolean(
			candidate.staleReceiptRejectedBeforeExecution,
			"d702.case.staleReceiptRejectedBeforeExecution",
		),
		recoveryActionCount: safeInteger(
			candidate.recoveryActionCount,
			"d702.case.recoveryActionCount",
			{ max: 256 },
		),
		issueCodes: (() => {
			const values = array(candidate.issueCodes, "d702.case.issueCodes");
			if (values.length > 64) throw new TypeError("D702 issue codes exceed bound");
			return values.map((entry, index) => coordinate(entry, `d702.case.issueCodes[${index}]`));
		})(),
		providerCallCount: literal(candidate.providerCallCount, 0, "d702.case.providerCallCount"),
		networkCallCount: literal(candidate.networkCallCount, 0, "d702.case.networkCallCount"),
		chargedCostMicrousd: literal(candidate.chargedCostMicrousd, 0, "d702.case.cost"),
	});
	if (reconstructed.actionToolRefs.length !== reconstructed.toolActionCount) {
		throw new TypeError("D702 action trace/count mismatch");
	}
	const report = strictSnapshot({
		...reconstructed,
		caseDigest: empiricalStrictJsonDigest(reconstructed),
	});
	if (
		candidate.caseDigest !== report.caseDigest ||
		empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(report)
	) {
		throw new TypeError("D702 case is non-canonical or tampered");
	}
	return report;
}

function createQualification(
	reportsInput: readonly D702CaseReportV1[],
	requireConstructed: boolean,
): D702OfflineQualificationV1 {
	const values = array(reportsInput, "d702.qualification.reports");
	if (values.length !== D702_CASE_ORDER.length) throw new TypeError("D702 requires five cases");
	if (
		requireConstructed &&
		values.some(
			(entry) => typeof entry !== "object" || entry === null || !constructedReports.has(entry),
		)
	) {
		throw new TypeError("D702 qualification requires closed-host-produced reports");
	}
	const cases = values.map((entry, index) => validateCase(entry, D702_CASE_ORDER[index]!));
	const [historical, genericA, genericB, wrongFirst, repeated] = cases as [
		D702CaseReportV1,
		D702CaseReportV1,
		D702CaseReportV1,
		D702CaseReportV1,
		D702CaseReportV1,
	];
	const recoveryPassed = (entry: D702CaseReportV1) =>
		entry.hostStatus === "completed" &&
		entry.verifierVerdict === "passed" &&
		entry.mutationFirstContinuationCount === 1 &&
		entry.requiredFirstToolRef === CLOSED_ACTOR_TOOL_REFS.replaceExact &&
		entry.mutationFirstRequestBound &&
		entry.mutationFirstPriorEvidenceBound &&
		entry.staleResultReceiptDigestBound &&
		entry.recoveryActionCount === 3;
	const twoGenericRecoveriesPassed =
		recoveryPassed(genericA) &&
		recoveryPassed(genericB) &&
		genericA.fixtureBindingDigest !== genericB.fixtureBindingDigest &&
		genericA.fixtureBindingDigest !== historical.fixtureBindingDigest &&
		genericB.fixtureBindingDigest !== historical.fixtureBindingDigest;
	const staleBatchRejectedBeforeExecution =
		recoveryPassed(historical) &&
		cases.every((entry) => entry.staleReceiptRejectedBeforeExecution) &&
		cases.slice(0, 4).every((entry) => entry.staleReceiptCount === 1) &&
		repeated.staleReceiptCount === 2;
	const mutationFirstBound = cases.every(
		(entry) =>
			entry.mutationFirstContinuationCount === 1 &&
			entry.mutationFirstRequestBound &&
			entry.mutationFirstPriorEvidenceBound &&
			entry.staleResultReceiptDigestBound,
	);
	const wrongFirstStopped =
		wrongFirst.hostStatus === "non-evaluable" &&
		wrongFirst.verifierVerdict === null &&
		wrongFirst.recoveryActionCount === 0 &&
		wrongFirst.issueCodes.includes("stale-result-mutation-first-required");
	const repeatedStaleStopped =
		repeated.hostStatus === "non-evaluable" &&
		repeated.verifierVerdict === null &&
		repeated.recoveryActionCount === 0 &&
		repeated.issueCodes.includes("no-progress-stale-result-intent-batch");
	const qualified =
		twoGenericRecoveriesPassed &&
		staleBatchRejectedBeforeExecution &&
		mutationFirstBound &&
		wrongFirstStopped &&
		repeatedStaleStopped;
	const withoutDigest = strictSnapshot({
		schemaVersion: D702_QUALIFICATION_SCHEMA,
		authorityRef: "decision.D702" as const,
		authorityRevision: "decision.D702.2026-08-09.v1" as const,
		claimBoundary: D702_CLAIM_BOUNDARY,
		d693PolicyDigest: empiricalStrictJsonDigest(D693_ASSISTED_PROGRESS_POLICY),
		d695PolicyDigest: empiricalStrictJsonDigest(D695_NO_PROGRESS_CONTINUATION_POLICY),
		d702PolicyDigest: empiricalStrictJsonDigest(D702_STALE_RESULT_RECOVERY_POLICY),
		caseOrder: D702_CASE_ORDER,
		cases,
		twoGenericRecoveriesPassed,
		staleBatchRejectedBeforeExecution,
		mutationFirstBound,
		wrongFirstStopped,
		repeatedStaleStopped,
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

export function createD702OfflineQualification(
	reports: readonly D702CaseReportV1[],
): D702OfflineQualificationV1 {
	return createQualification(reports, true);
}

export function validateD702OfflineQualification(value: unknown): D702OfflineQualificationV1 {
	const candidate = record(value, "d702.qualification");
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
			"d693PolicyDigest",
			"d695PolicyDigest",
			"d702PolicyDigest",
			"efficacyClaim",
			"mutationFirstBound",
			"networkCallCount",
			"providerCallCount",
			"qualificationDigest",
			"qualified",
			"repeatedStaleStopped",
			"schemaVersion",
			"staleBatchRejectedBeforeExecution",
			"twoGenericRecoveriesPassed",
			"wrongFirstStopped",
		],
		"d702.qualification",
	);
	literal(candidate.schemaVersion, D702_QUALIFICATION_SCHEMA, "d702.qualification.schemaVersion");
	literal(candidate.authorityRef, "decision.D702", "d702.qualification.authorityRef");
	literal(
		candidate.authorityRevision,
		"decision.D702.2026-08-09.v1",
		"d702.qualification.authorityRevision",
	);
	literal(candidate.claimBoundary, D702_CLAIM_BOUNDARY, "d702.qualification.claimBoundary");
	literal(candidate.causalAttribution, "undetermined", "d702.qualification.causalAttribution");
	literal(candidate.efficacyClaim, "none", "d702.qualification.efficacyClaim");
	literal(candidate.providerCallCount, 0, "d702.qualification.providerCallCount");
	literal(candidate.networkCallCount, 0, "d702.qualification.networkCallCount");
	literal(candidate.chargedCostMicrousd, 0, "d702.qualification.cost");
	const order = array(candidate.caseOrder, "d702.qualification.caseOrder");
	if (
		order.length !== D702_CASE_ORDER.length ||
		order.some((entry, index) => entry !== D702_CASE_ORDER[index])
	) {
		throw new TypeError("D702 qualification order is not frozen");
	}
	const reconstructed = createQualification(
		array(candidate.cases, "d702.qualification.cases") as unknown as D702CaseReportV1[],
		false,
	);
	if (empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(reconstructed)) {
		throw new TypeError("D702 qualification is non-canonical or tampered");
	}
	return reconstructed;
}

export async function persistD702OfflineQualification(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly qualification: D702OfflineQualificationV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}): Promise<{
	readonly generationPath: string;
	readonly qualificationDigest: string;
	readonly generationDigest: string;
}> {
	const candidate = record(input, "d702.persistence");
	exactKeys(
		candidate,
		["generationRef", "privateRoot", "protectionExecutor", "qualification"],
		"d702.persistence",
	);
	if (!isEmpiricalExactPrivateNeedleProtectionExecutor(candidate.protectionExecutor)) {
		throw new TypeError("D702 persistence requires constructed private protection");
	}
	const protectionExecutor = candidate.protectionExecutor;
	const privateRoot = await assertSafePrivateRoot(
		string(candidate.privateRoot, "d702.persistence.privateRoot", 4_096),
	);
	const generationRef = coordinate(candidate.generationRef, "d702.persistence.generationRef");
	if (
		basename(generationRef) !== generationRef ||
		generationRef === "." ||
		generationRef === ".."
	) {
		throw new TypeError("D702 generation ref must be path-free");
	}
	if (
		typeof candidate.qualification !== "object" ||
		candidate.qualification === null ||
		!constructedQualifications.has(candidate.qualification)
	) {
		throw new TypeError("D702 persistence requires a same-process qualification");
	}
	const qualification = validateD702OfflineQualification(candidate.qualification);
	if (!qualification.qualified) throw new TypeError("D702 refuses unqualified persistence");
	const qualificationBytes = strictJsonCodec.encode(qualification);
	const qualificationDigest = empiricalSha256(qualificationBytes);
	const generationWithoutDigest = strictSnapshot({
		schemaVersion: D702_GENERATION_SCHEMA,
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
		label: "D702 qualification",
		protectionExecutor,
	});
	assertPrivateArtifactProtection({
		subject: generation,
		label: "D702 generation",
		protectionExecutor,
	});
	const generationBytes = strictJsonCodec.encode(generation);
	const generationDigest = empiricalSha256(generationBytes);
	const finalPath = join(privateRoot, generationRef);
	try {
		await lstat(finalPath);
		throw new TypeError("D702 generation already exists");
	} catch (error) {
		if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
	}
	const stagingPath = join(privateRoot, `.d702-staging-${randomUUID()}`);
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
		) {
			throw new TypeError("D702 persistence readback failed");
		}
		await syncDirectory(stagingPath);
		await rename(stagingPath, finalPath);
		try {
			await syncDirectory(privateRoot);
		} catch (error) {
			try {
				await rm(finalPath, { recursive: true, force: true });
				await syncDirectory(privateRoot);
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], "D702 final generation cleanup failed");
			}
			throw error;
		}
		return Object.freeze({ generationPath: finalPath, qualificationDigest, generationDigest });
	} catch (error) {
		try {
			await rm(stagingPath, { recursive: true, force: true });
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], "D702 staging cleanup failed");
		}
		throw error;
	}
}
