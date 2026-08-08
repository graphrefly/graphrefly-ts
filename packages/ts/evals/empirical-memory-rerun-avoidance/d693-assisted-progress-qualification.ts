import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	boolean,
	coordinate,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
	string,
} from "./canonical.js";
import { assertPortableRepositoryPath } from "./canonical-repository-tree.js";
import {
	CLOSED_ACTOR_TOOL_REFS,
	CLOSED_TASK_PROFILE_HOST_SCHEMAS,
	type ClosedObjectiveProgressPolicyV1,
	type ClosedTaskProfileHostRunInputV1,
	type ClosedTaskProfileHostRunOutcomeV3,
	type ClosedVerifierCapabilityV1,
	runClosedTaskProfileHost,
} from "./closed-task-profile-host.js";
import type { EmpiricalTaskQualificationReportV1 } from "./contracts.js";
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

export const D693_ASSISTED_PROGRESS_POLICY = strictSnapshot({
	schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.objectiveProgressPolicy,
	policyRef: "objective-progress.d693.historical-transfer",
	policyRevision: "decision.D693.2026-08-08.v1",
	validationCommandRef: "actor.d693.focused-validation",
}) satisfies ClosedObjectiveProgressPolicyV1;

export const D693_ASSISTED_PROGRESS_QUALIFICATION_SCHEMA =
	"graphrefly.private-solution-eval.d693-assisted-progress-qualification.v1";
export const D693_ASSISTED_PROGRESS_GENERATION_SCHEMA =
	"graphrefly.private-solution-eval.d693-assisted-progress-generation.v1";
export const D693_CLAIM_BOUNDARY =
	"offline-assisted-progress-contract-no-provider-no-efficacy-claim";

export const D693_CASE_ORDER = Object.freeze([
	"current-inspection-final",
	"assisted-inspection-final",
	"assisted-valid-progress",
	"assisted-nonzero-validation",
	"assisted-stale-validation",
	"assisted-wrong-command",
] as const);

export type D693CaseRef = (typeof D693_CASE_ORDER)[number];

export interface D693ScriptedMutationPlanV1 {
	readonly readPaths: readonly string[];
	readonly writablePath: string;
	readonly initialContentDigest: string;
	readonly initialOldText: string;
	readonly acceptedNewText: string;
	readonly rejectedNewText: string;
	readonly acceptedContentDigest: string;
	readonly validationCommandRef: string;
	readonly otherCommandRef: string;
}

export type D693PreparedHostV1 = Pick<
	ClosedTaskProfileHostRunInputV1,
	| "frozen"
	| "qualificationReport"
	| "initialRequest"
	| "taskProfile"
	| "materialization"
	| "protectionExecutor"
>;

export interface D693CaseReportV1 {
	readonly caseRef: D693CaseRef;
	readonly policyApplied: boolean;
	readonly hostStatus: ClosedTaskProfileHostRunOutcomeV3["status"];
	readonly verifierInvocationCount: number;
	readonly verifierVerdict: ClosedTaskProfileHostRunOutcomeV3["verifierVerdict"];
	readonly logicalStepCount: number;
	readonly toolActionCount: number;
	readonly actionToolRefs: readonly string[];
	readonly actionIntentSetDigest: string;
	readonly actionResultSetDigest: string;
	readonly experimentBindingDigest: string;
	readonly objectiveProgressRejectionCount: number;
	readonly validationReceiptStatus: "passed" | "failed" | "not-observed";
	readonly validationReceiptSanitized: boolean;
	readonly issueCodes: readonly string[];
	readonly simulatedRequestEvidenceOnly: true;
	readonly providerCallCount: 0;
	readonly networkCallCount: 0;
	readonly caseDigest: string;
}

export interface D693AssistedProgressQualificationV1 {
	readonly schemaVersion: typeof D693_ASSISTED_PROGRESS_QUALIFICATION_SCHEMA;
	readonly authorityRef: "decision.D693";
	readonly authorityRevision: "decision.D693.2026-08-08.v1";
	readonly claimBoundary: typeof D693_CLAIM_BOUNDARY;
	readonly policyDigest: string;
	readonly caseOrder: typeof D693_CASE_ORDER;
	readonly cases: readonly D693CaseReportV1[];
	readonly sameInspectionIntentSet: boolean;
	readonly sameInspectionResultSet: boolean;
	readonly inspectionFinalRejectedBeforeVerifier: boolean;
	readonly validProgressAcceptedByVerifier: boolean;
	readonly nonzeroValidationReturnedSanitized: boolean;
	readonly staleValidationRejected: boolean;
	readonly wrongCommandRejected: boolean;
	readonly boundedLoopStopped: boolean;
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

const QUALIFICATION_FILE = "assisted-progress-qualification.v1.json";
const GENERATION_FILE = "generation.v1.json";
const MAX_SCRIPT_TEXT_CODE_UNITS = 65_536;
const constructedCaseReports = new WeakSet<object>();
const constructedQualifications = new WeakSet<object>();

export function createD693ObjectiveProgressPolicy(input: {
	readonly validationCommandRef: string;
}): ClosedObjectiveProgressPolicyV1 {
	const validationCommandRef = coordinate(
		input.validationCommandRef,
		"d693.policy.validationCommandRef",
	);
	if (validationCommandRef !== D693_ASSISTED_PROGRESS_POLICY.validationCommandRef) {
		throw new TypeError("D693 requires its exact actor-visible focused-validation command ref");
	}
	return D693_ASSISTED_PROGRESS_POLICY;
}

function assertD693OfflineCommandFixture(
	host: D693PreparedHostV1,
	plan: D693ScriptedMutationPlanV1,
): void {
	const taskProfile = strictSnapshot(host.taskProfile);
	const commands = taskProfile.commandPolicy.commands;
	if (commands.length !== 2) {
		throw new TypeError("D693 offline qualification requires its exact two local commands");
	}
	const validation = commands.find((command) => command.commandRef === plan.validationCommandRef);
	const other = commands.find((command) => command.commandRef === plan.otherCommandRef);
	if (
		validation === undefined ||
		validation.executable !== "/usr/bin/grep" ||
		empiricalStrictJsonDigest(validation.argv) !==
			empiricalStrictJsonDigest(["-q", plan.acceptedNewText, plan.writablePath]) ||
		other === undefined ||
		other.executable !== "/usr/bin/git" ||
		empiricalStrictJsonDigest(other.argv) !==
			empiricalStrictJsonDigest(["status", "--porcelain=v1"])
	) {
		throw new TypeError("D693 offline qualification command fixture is not local and frozen");
	}
}

function d693ExperimentBindingDigest(
	host: D693PreparedHostV1,
	plan: D693ScriptedMutationPlanV1,
): string {
	return empiricalStrictJsonDigest(
		strictSnapshot({
			frozenDigest: empiricalStrictJsonDigest(host.frozen),
			qualificationReportDigest: empiricalStrictJsonDigest(host.qualificationReport),
			initialRequestDigest: empiricalStrictJsonDigest(host.initialRequest),
			taskProfileDigest: empiricalStrictJsonDigest(host.taskProfile),
			materializationEvidenceDigest: empiricalStrictJsonDigest(host.materialization.evidence),
			planDigest: empiricalStrictJsonDigest(plan),
			policyDigest: empiricalStrictJsonDigest(D693_ASSISTED_PROGRESS_POLICY),
			verifierKind: "d693-local-content-digest-verifier.v1",
		}),
	);
}

function createD693OfflineVerifier(
	host: D693PreparedHostV1,
	plan: D693ScriptedMutationPlanV1,
): ClosedVerifierCapabilityV1 {
	const profile = strictSnapshot(host.taskProfile.verifierProfile);
	const verifierProfileDigest = empiricalStrictJsonDigest(profile);
	return Object.freeze({
		verifierProfileRef: profile.verifierProfileRef,
		verifierProfileRevision: profile.verifierProfileRevision,
		verifierProfileDigest,
		async verify(input: Parameters<ClosedVerifierCapabilityV1["verify"]>[0]) {
			if (input.signal.aborted) {
				throw new DOMException("D693 offline verifier cancelled", "AbortError");
			}
			const workspaceRoot = input.workspace.rootPathForHostRunner();
			const content = new Uint8Array(await readFile(join(workspaceRoot, plan.writablePath)));
			const passed = empiricalSha256(content) === plan.acceptedContentDigest;
			const id = "target-run.d693";
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

export async function runD693AssistedProgressCase(input: {
	readonly caseRef: D693CaseRef;
	readonly host: D693PreparedHostV1;
	readonly plan: D693ScriptedMutationPlanV1;
	readonly signal: AbortSignal;
}): Promise<D693CaseReportV1> {
	const candidate = record(input, "d693.caseInput");
	exactKeys(candidate, ["caseRef", "host", "plan", "signal"], "d693.caseInput");
	const caseRef = d693CaseRef(candidate.caseRef);
	const plan = validatePlan(candidate.plan as D693ScriptedMutationPlanV1);
	if (!(candidate.signal instanceof AbortSignal)) {
		throw new TypeError("D693 qualification requires a real AbortSignal");
	}
	const signal = candidate.signal;
	if (signal.aborted) throw new DOMException("D693 qualification cancelled", "AbortError");
	const hostRecord = record(candidate.host, "d693.caseInput.host");
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
		"d693.caseInput.host",
	);
	const host = hostRecord as unknown as D693PreparedHostV1;
	let validationReceiptStatus: D693CaseReportV1["validationReceiptStatus"] = "not-observed";
	let validationReceiptSanitized = false;
	assertD693OfflineCommandFixture(host, plan);
	const experimentBindingDigest = d693ExperimentBindingDigest(host, plan);
	const verifier = createD693OfflineVerifier(host, plan);
	const port: EmpiricalModelTurnPortV1 = Object.freeze({
		async invoke(request: EmpiricalModelTurnRequestV1, signal: AbortSignal) {
			if (signal.aborted) throw new DOMException("D693 scripted turn cancelled", "AbortError");
			for (const result of request.priorToolResults) {
				if (result.toolRef !== CLOSED_ACTOR_TOOL_REFS.runCommand) continue;
				const value = record(result.result, "d693.validationReceipt");
				if (
					value.kind === "focused-validation-command" &&
					(value.validationStatus === "passed" || value.validationStatus === "failed")
				) {
					validationReceiptStatus = value.validationStatus;
					validationReceiptSanitized =
						!Object.hasOwn(value, "stdout") &&
						!Object.hasOwn(value, "stderr") &&
						typeof value.stdoutDigest === "string" &&
						typeof value.stderrDigest === "string";
				}
			}
			return completedOutcome(
				request,
				host.frozen,
				host.qualificationReport,
				host.protectionExecutor,
				scriptedBody(caseRef, request, plan),
			);
		},
	});
	const policyApplied = caseRef !== "current-inspection-final";
	const outcome = await runClosedTaskProfileHost({
		...host,
		verifier,
		modelTurnPort: port,
		...(policyApplied ? { objectiveProgressPolicy: createD693ObjectiveProgressPolicy(plan) } : {}),
		signal,
	});
	const verifierInvocationCount = outcome.verifierVerdict === null ? 0 : 1;
	const actionIntentSetDigest = empiricalStrictJsonDigest(
		[...new Set(outcome.actionTrace.map((entry) => entry.intentDigest))].sort(),
	);
	const actionResultSetDigest = empiricalStrictJsonDigest(
		[...new Set(outcome.actionTrace.map((entry) => entry.resultDigest))].sort(),
	);
	const objectiveProgressRejectionCount = outcome.turnEvidence.filter((turn) =>
		turn.issueCodes.includes("structured-output-objective-progress-required"),
	).length;
	const reportWithoutDigest = strictSnapshot({
		caseRef,
		policyApplied,
		hostStatus: outcome.status,
		verifierInvocationCount,
		verifierVerdict: outcome.verifierVerdict,
		logicalStepCount: outcome.logicalStepCount,
		toolActionCount: outcome.toolActionCount,
		actionToolRefs: outcome.actionTrace.map((entry) => entry.toolRef),
		actionIntentSetDigest,
		actionResultSetDigest,
		experimentBindingDigest,
		objectiveProgressRejectionCount,
		validationReceiptStatus,
		validationReceiptSanitized,
		issueCodes: outcome.issueCodes,
		simulatedRequestEvidenceOnly: true as const,
		providerCallCount: 0 as const,
		networkCallCount: 0 as const,
	});
	const report = strictSnapshot({
		...reportWithoutDigest,
		caseDigest: empiricalStrictJsonDigest(reportWithoutDigest),
	});
	constructedCaseReports.add(report);
	return report;
}

export function createD693AssistedProgressQualification(
	casesInput: readonly D693CaseReportV1[],
): D693AssistedProgressQualificationV1 {
	return createQualification(casesInput, true);
}

function createQualification(
	casesInput: readonly D693CaseReportV1[],
	requireConstructedReports: boolean,
): D693AssistedProgressQualificationV1 {
	const caseValues = array(casesInput, "d693.qualification.casesInput");
	if (
		Object.getPrototypeOf(caseValues) !== Array.prototype ||
		caseValues.length !== D693_CASE_ORDER.length
	) {
		throw new TypeError("D693 qualification requires its exact six cases");
	}
	if (
		requireConstructedReports &&
		caseValues.some(
			(entry) => typeof entry !== "object" || entry === null || !constructedCaseReports.has(entry),
		)
	) {
		throw new TypeError("D693 qualification requires reports produced by the closed host runner");
	}
	const cases = caseValues.map((entry, index) =>
		validateCase(entry as D693CaseReportV1, D693_CASE_ORDER[index] as D693CaseRef),
	);
	const current = cases[0] as D693CaseReportV1;
	const inspection = cases[1] as D693CaseReportV1;
	const valid = cases[2] as D693CaseReportV1;
	const nonzero = cases[3] as D693CaseReportV1;
	const stale = cases[4] as D693CaseReportV1;
	const wrong = cases[5] as D693CaseReportV1;
	const oneExperiment = cases.every(
		(entry) => entry.experimentBindingDigest === current.experimentBindingDigest,
	);
	const sameInspectionIntentSet =
		current.actionIntentSetDigest === inspection.actionIntentSetDigest &&
		current.actionToolRefs.length > 0 &&
		current.actionToolRefs.every((toolRef) => toolRef === CLOSED_ACTOR_TOOL_REFS.readFile) &&
		current.actionToolRefs.join("\u0000") === inspection.actionToolRefs.join("\u0000");
	const sameInspectionResultSet =
		current.actionResultSetDigest === inspection.actionResultSetDigest;
	const inspectionFinalRejectedBeforeVerifier =
		current.hostStatus === "completed" &&
		current.verifierInvocationCount === 1 &&
		inspection.hostStatus === "non-evaluable" &&
		inspection.verifierInvocationCount === 0 &&
		inspection.objectiveProgressRejectionCount > 0;
	const validProgressAcceptedByVerifier =
		valid.hostStatus === "completed" &&
		valid.verifierInvocationCount === 1 &&
		valid.verifierVerdict === "passed" &&
		valid.validationReceiptStatus === "passed" &&
		valid.validationReceiptSanitized &&
		hasActionSuffix(valid, [
			CLOSED_ACTOR_TOOL_REFS.replaceExact,
			CLOSED_ACTOR_TOOL_REFS.workspaceDiff,
			CLOSED_ACTOR_TOOL_REFS.runCommand,
		]);
	const nonzeroValidationReturnedSanitized =
		nonzero.hostStatus === "non-evaluable" &&
		nonzero.verifierInvocationCount === 0 &&
		nonzero.validationReceiptStatus === "failed" &&
		nonzero.validationReceiptSanitized &&
		nonzero.objectiveProgressRejectionCount > 0 &&
		hasActionSuffix(nonzero, [
			CLOSED_ACTOR_TOOL_REFS.replaceExact,
			CLOSED_ACTOR_TOOL_REFS.workspaceDiff,
			CLOSED_ACTOR_TOOL_REFS.runCommand,
		]);
	const staleValidationRejected =
		stale.hostStatus === "non-evaluable" &&
		stale.verifierInvocationCount === 0 &&
		stale.validationReceiptStatus === "passed" &&
		stale.objectiveProgressRejectionCount > 0 &&
		hasActionSuffix(stale, [
			CLOSED_ACTOR_TOOL_REFS.replaceExact,
			CLOSED_ACTOR_TOOL_REFS.workspaceDiff,
			CLOSED_ACTOR_TOOL_REFS.runCommand,
			CLOSED_ACTOR_TOOL_REFS.replaceExact,
		]);
	const wrongCommandRejected =
		wrong.hostStatus === "non-evaluable" &&
		wrong.verifierInvocationCount === 0 &&
		wrong.validationReceiptStatus === "not-observed" &&
		wrong.objectiveProgressRejectionCount > 0 &&
		hasActionSuffix(wrong, [
			CLOSED_ACTOR_TOOL_REFS.replaceExact,
			CLOSED_ACTOR_TOOL_REFS.workspaceDiff,
			CLOSED_ACTOR_TOOL_REFS.runCommand,
		]);
	const boundedLoopStopped = [inspection, nonzero, stale, wrong].every(
		(entry) =>
			entry.logicalStepCount > 0 && entry.issueCodes.includes("agent-step-budget-exhausted"),
	);
	const qualified =
		oneExperiment &&
		sameInspectionIntentSet &&
		sameInspectionResultSet &&
		inspectionFinalRejectedBeforeVerifier &&
		validProgressAcceptedByVerifier &&
		nonzeroValidationReturnedSanitized &&
		staleValidationRejected &&
		wrongCommandRejected &&
		boundedLoopStopped;
	const withoutDigest = strictSnapshot({
		schemaVersion:
			D693_ASSISTED_PROGRESS_QUALIFICATION_SCHEMA as typeof D693_ASSISTED_PROGRESS_QUALIFICATION_SCHEMA,
		authorityRef: "decision.D693" as const,
		authorityRevision: "decision.D693.2026-08-08.v1" as const,
		claimBoundary: D693_CLAIM_BOUNDARY as typeof D693_CLAIM_BOUNDARY,
		policyDigest: empiricalStrictJsonDigest(D693_ASSISTED_PROGRESS_POLICY),
		caseOrder: D693_CASE_ORDER,
		cases,
		sameInspectionIntentSet,
		sameInspectionResultSet,
		inspectionFinalRejectedBeforeVerifier,
		validProgressAcceptedByVerifier,
		nonzeroValidationReturnedSanitized,
		staleValidationRejected,
		wrongCommandRejected,
		boundedLoopStopped,
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
	if (requireConstructedReports) constructedQualifications.add(qualification);
	return qualification;
}

export function validateD693AssistedProgressQualification(
	value: unknown,
): D693AssistedProgressQualificationV1 {
	const candidate = record(value, "d693.qualification");
	exactKeys(
		candidate,
		[
			"authorityRef",
			"authorityRevision",
			"boundedLoopStopped",
			"caseOrder",
			"cases",
			"causalAttribution",
			"chargedCostMicrousd",
			"claimBoundary",
			"efficacyClaim",
			"inspectionFinalRejectedBeforeVerifier",
			"networkCallCount",
			"nonzeroValidationReturnedSanitized",
			"policyDigest",
			"providerCallCount",
			"qualificationDigest",
			"qualified",
			"sameInspectionIntentSet",
			"sameInspectionResultSet",
			"schemaVersion",
			"staleValidationRejected",
			"validProgressAcceptedByVerifier",
			"wrongCommandRejected",
		],
		"d693.qualification",
	);
	literal(
		candidate.schemaVersion,
		D693_ASSISTED_PROGRESS_QUALIFICATION_SCHEMA,
		"d693.qualification.schemaVersion",
	);
	literal(candidate.authorityRef, "decision.D693", "d693.qualification.authorityRef");
	literal(
		candidate.authorityRevision,
		"decision.D693.2026-08-08.v1",
		"d693.qualification.authorityRevision",
	);
	literal(candidate.claimBoundary, D693_CLAIM_BOUNDARY, "d693.qualification.claimBoundary");
	digest(candidate.policyDigest, "d693.qualification.policyDigest");
	const caseOrder = array(candidate.caseOrder, "d693.qualification.caseOrder");
	if (
		caseOrder.length !== D693_CASE_ORDER.length ||
		caseOrder.some((entry, index) => entry !== D693_CASE_ORDER[index])
	) {
		throw new TypeError("D693 qualification case order is not frozen");
	}
	for (const field of [
		"sameInspectionIntentSet",
		"sameInspectionResultSet",
		"inspectionFinalRejectedBeforeVerifier",
		"validProgressAcceptedByVerifier",
		"nonzeroValidationReturnedSanitized",
		"staleValidationRejected",
		"wrongCommandRejected",
		"boundedLoopStopped",
		"qualified",
	] as const) {
		boolean(candidate[field], `d693.qualification.${field}`);
	}
	literal(candidate.providerCallCount, 0, "d693.qualification.providerCallCount");
	literal(candidate.networkCallCount, 0, "d693.qualification.networkCallCount");
	literal(candidate.chargedCostMicrousd, 0, "d693.qualification.chargedCostMicrousd");
	literal(candidate.causalAttribution, "undetermined", "d693.qualification.causalAttribution");
	literal(candidate.efficacyClaim, "none", "d693.qualification.efficacyClaim");
	digest(candidate.qualificationDigest, "d693.qualification.qualificationDigest");
	const casesValue = array(candidate.cases, "d693.qualification.cases");
	if (casesValue.length !== D693_CASE_ORDER.length) {
		throw new TypeError("D693 qualification cases are not exact");
	}
	const reconstructed = createQualification(casesValue as unknown as D693CaseReportV1[], false);
	if (empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(reconstructed)) {
		throw new TypeError("D693 qualification is non-canonical or tampered");
	}
	return reconstructed;
}

export async function persistD693AssistedProgressQualification(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly qualification: D693AssistedProgressQualificationV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}): Promise<{
	readonly generationPath: string;
	readonly qualificationDigest: string;
	readonly generationDigest: string;
}> {
	const candidate = record(input, "d693.persistence");
	exactKeys(
		candidate,
		["generationRef", "privateRoot", "protectionExecutor", "qualification"],
		"d693.persistence",
	);
	const protectionExecutor = candidate.protectionExecutor;
	if (!isEmpiricalExactPrivateNeedleProtectionExecutor(protectionExecutor)) {
		throw new TypeError("D693 persistence requires the constructed private protection capability");
	}
	const privateRoot = await assertSafePrivateRoot(
		string(candidate.privateRoot, "d693.persistence.privateRoot", 4_096),
	);
	const generationRef = coordinate(candidate.generationRef, "d693.persistence.generationRef");
	if (
		basename(generationRef) !== generationRef ||
		generationRef === "." ||
		generationRef === ".."
	) {
		throw new TypeError("D693 generation ref must be path-free");
	}
	const qualificationValue = candidate.qualification;
	if (
		typeof qualificationValue !== "object" ||
		qualificationValue === null ||
		!constructedQualifications.has(qualificationValue)
	) {
		throw new TypeError("D693 persistence requires a qualification produced in this host process");
	}
	const qualification = validateD693AssistedProgressQualification(qualificationValue);
	if (!qualification.qualified) throw new TypeError("D693 refuses to persist an unqualified run");
	const qualificationBytes = strictJsonCodec.encode(qualification);
	const qualificationDigest = empiricalSha256(qualificationBytes);
	const generationWithoutDigest = strictSnapshot({
		schemaVersion: D693_ASSISTED_PROGRESS_GENERATION_SCHEMA,
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
		label: "D693 qualification",
		protectionExecutor,
	});
	assertPrivateArtifactProtection({
		subject: generation,
		label: "D693 generation",
		protectionExecutor,
	});
	const generationBytes = strictJsonCodec.encode(generation);
	const generationDigest = empiricalSha256(generationBytes);
	const finalPath = join(privateRoot, generationRef);
	try {
		await lstat(finalPath);
		throw new TypeError("D693 generation already exists");
	} catch (error) {
		if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
	}
	const stagingPath = join(privateRoot, `.d693-staging-${randomUUID()}`);
	await mkdir(stagingPath, { mode: 0o700 });
	let committed = false;
	try {
		await chmod(stagingPath, 0o700);
		const qualificationPath = join(stagingPath, QUALIFICATION_FILE);
		const generationPath = join(stagingPath, GENERATION_FILE);
		await writePrivateFile(qualificationPath, qualificationBytes);
		await writePrivateFile(generationPath, generationBytes);
		if (
			empiricalSha256(new Uint8Array(await readFile(qualificationPath))) !== qualificationDigest ||
			empiricalSha256(new Uint8Array(await readFile(generationPath))) !== generationDigest
		) {
			throw new TypeError("D693 persisted bytes failed readback verification");
		}
		await syncDirectory(stagingPath);
		await rename(stagingPath, finalPath);
		committed = true;
		await syncDirectory(privateRoot);
		return Object.freeze({ generationPath: finalPath, qualificationDigest, generationDigest });
	} finally {
		if (!committed) await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
	}
}

function d693CaseRef(value: unknown): D693CaseRef {
	if (typeof value !== "string" || !(D693_CASE_ORDER as readonly string[]).includes(value)) {
		throw new TypeError("D693 case ref is not preregistered");
	}
	return value as D693CaseRef;
}

function hasActionSuffix(report: D693CaseReportV1, expectedSuffix: readonly string[]): boolean {
	if (report.actionToolRefs.length < expectedSuffix.length) return false;
	const offset = report.actionToolRefs.length - expectedSuffix.length;
	return (
		report.actionToolRefs
			.slice(0, offset)
			.every((toolRef) =>
				(
					[CLOSED_ACTOR_TOOL_REFS.readFile, CLOSED_ACTOR_TOOL_REFS.searchLiteral] as string[]
				).includes(toolRef),
			) &&
		expectedSuffix.every((toolRef, index) => report.actionToolRefs[offset + index] === toolRef)
	);
}

function validatePlan(value: D693ScriptedMutationPlanV1): D693ScriptedMutationPlanV1 {
	const plan = record(value, "d693.plan");
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
		"d693.plan",
	);
	const readPathValues = array(plan.readPaths, "d693.plan.readPaths");
	if (
		Object.getPrototypeOf(readPathValues) !== Array.prototype ||
		readPathValues.length < 1 ||
		readPathValues.length > 32
	) {
		throw new TypeError("D693 plan read paths must be bounded");
	}
	const readPaths = readPathValues.map((path, index) =>
		assertPortableRepositoryPath(path, `d693.plan.readPaths[${index}]`),
	);
	if (new Set(readPaths).size !== readPaths.length)
		throw new TypeError("D693 read paths duplicate");
	const writablePath = assertPortableRepositoryPath(plan.writablePath, "d693.plan.writablePath");
	if (!readPaths.includes(writablePath)) throw new TypeError("D693 writable path must be readable");
	const text = (entry: unknown, path: string): string => {
		if (
			typeof entry !== "string" ||
			entry.length < 1 ||
			entry.length > MAX_SCRIPT_TEXT_CODE_UNITS
		) {
			throw new TypeError(`${path} must be a bounded non-empty string`);
		}
		return entry;
	};
	const validationCommandRef = coordinate(
		plan.validationCommandRef,
		"d693.plan.validationCommandRef",
	);
	const otherCommandRef = coordinate(plan.otherCommandRef, "d693.plan.otherCommandRef");
	if (
		validationCommandRef !== D693_ASSISTED_PROGRESS_POLICY.validationCommandRef ||
		otherCommandRef === validationCommandRef
	) {
		throw new TypeError("D693 plan command refs are not distinct and frozen");
	}
	const digest = (entry: unknown, path: string): string => {
		if (typeof entry !== "string" || !/^sha256:[0-9a-f]{64}$/.test(entry)) {
			throw new TypeError(`${path} must be sha256`);
		}
		return entry;
	};
	return strictSnapshot({
		readPaths,
		writablePath,
		initialContentDigest: digest(plan.initialContentDigest, "d693.plan.initialContentDigest"),
		initialOldText: text(plan.initialOldText, "d693.plan.initialOldText"),
		acceptedNewText: text(plan.acceptedNewText, "d693.plan.acceptedNewText"),
		rejectedNewText: text(plan.rejectedNewText, "d693.plan.rejectedNewText"),
		acceptedContentDigest: digest(plan.acceptedContentDigest, "d693.plan.acceptedContentDigest"),
		validationCommandRef,
		otherCommandRef,
	});
}

function scriptedBody(
	caseRef: D693CaseRef,
	request: EmpiricalModelTurnRequestV1,
	plan: D693ScriptedMutationPlanV1,
): ScriptedBody {
	const step = request.stepIndex;
	if (step === 0) {
		return {
			finishReason: "tool-intents",
			toolIntents: plan.readPaths.map((path, index) =>
				intent(step, index, CLOSED_ACTOR_TOOL_REFS.readFile, { path }),
			),
		};
	}
	if (caseRef === "current-inspection-final" || caseRef === "assisted-inspection-final") {
		return finalBody(caseRef);
	}
	if (step === 1) {
		return {
			finishReason: "tool-intents",
			toolIntents: [
				replaceIntent(request, step, 0, plan, {
					baseContentDigest: plan.initialContentDigest,
					oldText: plan.initialOldText,
					newText:
						caseRef === "assisted-nonzero-validation" ? plan.rejectedNewText : plan.acceptedNewText,
				}),
			],
		};
	}
	if (step === 2) {
		return {
			finishReason: "tool-intents",
			toolIntents: [intent(step, 0, CLOSED_ACTOR_TOOL_REFS.workspaceDiff, {})],
		};
	}
	if (step === 3) {
		return {
			finishReason: "tool-intents",
			toolIntents: [
				intent(step, 0, CLOSED_ACTOR_TOOL_REFS.runCommand, {
					commandRef:
						caseRef === "assisted-wrong-command" ? plan.otherCommandRef : plan.validationCommandRef,
				}),
			],
		};
	}
	if (caseRef === "assisted-stale-validation" && step === 4) {
		return {
			finishReason: "tool-intents",
			toolIntents: [
				replaceIntent(request, step, 0, plan, {
					baseContentDigest: plan.acceptedContentDigest,
					oldText: plan.acceptedNewText,
					newText: plan.rejectedNewText,
				}),
			],
		};
	}
	return finalBody(caseRef);
}

function replaceIntent(
	request: EmpiricalModelTurnRequestV1,
	step: number,
	index: number,
	plan: D693ScriptedMutationPlanV1,
	text: {
		readonly baseContentDigest: string;
		readonly oldText: string;
		readonly newText: string;
	},
): EmpiricalModelToolIntentV1 {
	const replaceSchema = request.availableTools.find(
		(tool) => tool.toolRef === CLOSED_ACTOR_TOOL_REFS.replaceExact,
	);
	if (replaceSchema === undefined || replaceSchema.inputSchema.kind !== "object") {
		throw new TypeError("D693 host omitted replaceExact schema");
	}
	const hostDerivesDigest = !replaceSchema.inputSchema.properties.some(
		(property) => property.name === "baseContentDigest",
	);
	return intent(step, index, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
		...(hostDerivesDigest ? {} : { baseContentDigest: text.baseContentDigest }),
		newText: text.newText,
		oldText: text.oldText,
		path: plan.writablePath,
	});
}

function intent(
	step: number,
	index: number,
	toolRef: string,
	argumentsValue: EmpiricalModelToolIntentV1["arguments"],
): EmpiricalModelToolIntentV1 {
	return strictSnapshot({
		toolCallRef: `d693-tool-call.${step}.${index}`,
		toolRef,
		argumentsDigest: empiricalStrictJsonDigest(argumentsValue),
		arguments: argumentsValue,
	});
}

function finalBody(caseRef: D693CaseRef): ScriptedBody {
	return {
		finishReason: "structured-output",
		structuredOutput: {
			kind: "model-turn-output-placeholder",
			summary: `D693 scripted ${caseRef}`,
		},
	};
}

function completedOutcome(
	request: EmpiricalModelTurnRequestV1,
	frozen: ClosedTaskProfileHostRunInputV1["frozen"],
	report: EmpiricalTaskQualificationReportV1,
	protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1,
	body: ScriptedBody,
): EmpiricalModelTurnOutcomeV1 {
	const structuredOutput = body.finishReason === "structured-output" ? body.structuredOutput : null;
	const toolIntents = body.finishReason === "tool-intents" ? body.toolIntents : [];
	const evidenceRefs = strictSnapshot([]);
	const issueCodes = strictSnapshot([]);
	const egressMaterial = strictSnapshot({
		evidenceRefs,
		issueCodes,
		structuredOutput,
		toolIntents: toolIntents.map((entry) => ({
			toolCallRef: entry.toolCallRef,
			toolRef: entry.toolRef,
			argumentsDigest: entry.argumentsDigest,
			arguments: entry.arguments,
		})),
	});
	const protectionReceipt = executeEmpiricalProtection(protectionExecutor, {
		policyRef: request.protectionPolicyRef,
		policyRevision: request.protectionPolicyRevision,
		stage: "model-egress",
		subject: egressMaterial,
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
		frozen,
		report,
	);
}

function validateCase(value: D693CaseReportV1, expected: D693CaseRef): D693CaseReportV1 {
	const candidate = record(value, `d693.case.${expected}`);
	exactKeys(
		candidate,
		[
			"actionIntentSetDigest",
			"actionResultSetDigest",
			"actionToolRefs",
			"caseDigest",
			"caseRef",
			"experimentBindingDigest",
			"hostStatus",
			"issueCodes",
			"logicalStepCount",
			"networkCallCount",
			"objectiveProgressRejectionCount",
			"policyApplied",
			"providerCallCount",
			"simulatedRequestEvidenceOnly",
			"toolActionCount",
			"validationReceiptSanitized",
			"validationReceiptStatus",
			"verifierInvocationCount",
			"verifierVerdict",
		],
		`d693.case.${expected}`,
	);
	literal(candidate.caseRef, expected, `d693.case.${expected}.caseRef`);
	literal(
		candidate.policyApplied,
		expected !== "current-inspection-final",
		`d693.case.${expected}.policyApplied`,
	);
	oneOf(candidate.hostStatus, ["completed", "non-evaluable"], `d693.case.${expected}.hostStatus`);
	const verifierInvocationCount = safeInteger(
		candidate.verifierInvocationCount,
		`d693.case.${expected}.verifierInvocationCount`,
		{ min: 0, max: 1 },
	);
	if (
		candidate.verifierVerdict !== null &&
		!(["passed", "failed", "unverifiable"] as const).includes(
			candidate.verifierVerdict as "passed" | "failed" | "unverifiable",
		)
	) {
		throw new TypeError(`D693 case ${expected} verifier verdict is invalid`);
	}
	if ((verifierInvocationCount === 0) !== (candidate.verifierVerdict === null)) {
		throw new TypeError(`D693 case ${expected} verifier receipt count is inconsistent`);
	}
	const logicalStepCount = safeInteger(
		candidate.logicalStepCount,
		`d693.case.${expected}.logicalStepCount`,
		{
			min: 0,
			max: 128,
		},
	);
	const toolActionCount = safeInteger(
		candidate.toolActionCount,
		`d693.case.${expected}.toolActionCount`,
		{
			min: 0,
			max: 256,
		},
	);
	const actionToolRefValues = array(
		candidate.actionToolRefs,
		`d693.case.${expected}.actionToolRefs`,
	);
	if (actionToolRefValues.length !== toolActionCount || actionToolRefValues.length > 256) {
		throw new TypeError(`D693 case ${expected} action count is inconsistent`);
	}
	const actionToolRefs = actionToolRefValues.map((toolRef, index) => {
		const actual = string(toolRef, `d693.case.${expected}.actionToolRefs[${index}]`, 256);
		if (!(Object.values(CLOSED_ACTOR_TOOL_REFS) as readonly string[]).includes(actual)) {
			throw new TypeError(`D693 case ${expected} has an unknown action tool ref`);
		}
		return actual;
	});
	digest(candidate.actionIntentSetDigest, `d693.case.${expected}.actionIntentSetDigest`);
	digest(candidate.actionResultSetDigest, `d693.case.${expected}.actionResultSetDigest`);
	digest(candidate.experimentBindingDigest, `d693.case.${expected}.experimentBindingDigest`);
	const objectiveProgressRejectionCount = safeInteger(
		candidate.objectiveProgressRejectionCount,
		`d693.case.${expected}.objectiveProgressRejectionCount`,
		{ min: 0, max: 128 },
	);
	if (objectiveProgressRejectionCount > logicalStepCount) {
		throw new TypeError(`D693 case ${expected} has too many progress rejections`);
	}
	oneOf(
		candidate.validationReceiptStatus,
		["passed", "failed", "not-observed"],
		`d693.case.${expected}.validationReceiptStatus`,
	);
	boolean(candidate.validationReceiptSanitized, `d693.case.${expected}.validationReceiptSanitized`);
	const issueCodeValues = array(candidate.issueCodes, `d693.case.${expected}.issueCodes`);
	if (issueCodeValues.length > 128)
		throw new TypeError(`D693 case ${expected} has too many issues`);
	const issueCodes = issueCodeValues.map((issueCode, index) =>
		coordinate(issueCode, `d693.case.${expected}.issueCodes[${index}]`),
	);
	if (new Set(issueCodes).size !== issueCodes.length) {
		throw new TypeError(`D693 case ${expected} issue codes duplicate`);
	}
	literal(
		candidate.simulatedRequestEvidenceOnly,
		true,
		`d693.case.${expected}.simulatedRequestEvidenceOnly`,
	);
	literal(candidate.providerCallCount, 0, `d693.case.${expected}.providerCallCount`);
	literal(candidate.networkCallCount, 0, `d693.case.${expected}.networkCallCount`);
	const caseDigest = digest(candidate.caseDigest, `d693.case.${expected}.caseDigest`);
	const normalizedWithoutDigest = strictSnapshot({
		caseRef: expected,
		policyApplied: candidate.policyApplied as boolean,
		hostStatus: candidate.hostStatus as "completed" | "non-evaluable",
		verifierInvocationCount,
		verifierVerdict: candidate.verifierVerdict as D693CaseReportV1["verifierVerdict"],
		logicalStepCount,
		toolActionCount,
		actionToolRefs,
		actionIntentSetDigest: candidate.actionIntentSetDigest as string,
		actionResultSetDigest: candidate.actionResultSetDigest as string,
		experimentBindingDigest: candidate.experimentBindingDigest as string,
		objectiveProgressRejectionCount,
		validationReceiptStatus:
			candidate.validationReceiptStatus as D693CaseReportV1["validationReceiptStatus"],
		validationReceiptSanitized: candidate.validationReceiptSanitized as boolean,
		issueCodes,
		simulatedRequestEvidenceOnly: true as const,
		providerCallCount: 0 as const,
		networkCallCount: 0 as const,
	});
	if (empiricalStrictJsonDigest(normalizedWithoutDigest) !== caseDigest) {
		throw new TypeError("D693 case digest does not bind its canonical report");
	}
	return strictSnapshot({ ...normalizedWithoutDigest, caseDigest });
}
