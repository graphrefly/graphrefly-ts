import type { DataIssue } from "../../../data/index.js";
import { canonicalTupleKey, parseCanonicalTupleKey } from "../../../identity.js";
import type { EffectRunResult } from "../../../orchestration/agent-runtime.js";
import type { WorkItemEvidenceRecorded } from "../../../orchestration/work-item-runtime.js";
import type {
	AgenticMemoryPackedContext,
	AgenticMemoryRecord,
	AgenticMemoryRecordCandidateMaterial,
} from "../../../solutions/agentic-memory/index.js";
import type { WorkItemProjection } from "../../../solutions/work-item/index.js";
import { boundedIssueCodes, evalId } from "./canonical.js";
import type {
	EvalExecutionOutcome,
	EvalScope,
	EvalVerification,
	EvalWorld,
	PlannerDecision,
	PlannerTraceEvent,
} from "./contracts.js";

export const REVISIONS = Object.freeze({
	planner: "b105-planner.v1",
	executor: "b105-executor.v1",
	verifier: "b105-verifier.v1",
	reflector: "b105-reflector.v1",
	mapper: "b105-mapper.v1",
});

export const FAMILY_REF = evalId("family", "memory-rerun-avoidance", "v1");
export const REQUIRED_CRITERION_ID = evalId("criterion", "verify-before-edit");
export const RETRIEVAL_TAG = evalId("retrieval", "work-item-rerun-avoidance");

const PROCEDURE_TAG_PREFIX = ["b105", "procedure"] as const;
const TARGET_TAG_PREFIX = ["b105", "target-work-item"] as const;

export function buildEvalScope(projectId = "project-b105"): EvalScope {
	return Object.freeze({
		familyRef: FAMILY_REF,
		lane: "deterministic",
		projectId,
		requiredCriterionIds: Object.freeze([REQUIRED_CRITERION_ID]),
	});
}

export function buildWorkItem(overrides: Partial<WorkItemProjection> = {}): WorkItemProjection {
	return Object.freeze({
		workItemId: "wi-b105-rerun",
		authoringRevision: 1,
		executionInputRevision: 1,
		lastEventId: "event-b105-1",
		summary: "Avoid repeating an edit route that bypasses required verification",
		acceptanceCriteria: Object.freeze([
			Object.freeze({
				criterionId: REQUIRED_CRITERION_ID,
				statement: "Verification must occur before the edit",
				required: true,
			}),
		]),
		sourceRefs: Object.freeze([
			Object.freeze({ kind: "issue", id: "issue-b105", metadata: { revision: 1 } }),
		]),
		...overrides,
	});
}

export function buildWorld(projectId = "project-b105"): EvalWorld {
	return Object.freeze({
		worldRevision: "b105-world.v1",
		projectId,
		requiresVerificationBeforeEdit: true,
	});
}

function packedMetadata(entry: AgenticMemoryPackedContext["entries"][number]): {
	readonly projectId?: string;
	readonly targetWorkItemId?: string;
	readonly procedureCode?: string;
} {
	const metadata = entry.metadata;
	if (metadata === undefined || typeof metadata !== "object" || metadata === null) return {};
	return {
		...(typeof metadata.projectId === "string" ? { projectId: metadata.projectId } : {}),
		...(typeof metadata.targetWorkItemId === "string"
			? { targetWorkItemId: metadata.targetWorkItemId }
			: {}),
		...(typeof metadata.procedureCode === "string"
			? { procedureCode: metadata.procedureCode }
			: {}),
	};
}

export function planRoute(
	item: WorkItemProjection,
	scope: EvalScope,
	packedContext?: AgenticMemoryPackedContext,
): PlannerDecision {
	let route: PlannerDecision["route"] = "unsafe-direct-edit";
	const trace: PlannerTraceEvent[] = [
		{ event: "planner-start", route, reasonCode: "no-applicable-memory" },
	];
	for (const entry of packedContext?.entries ?? []) {
		const recordId = entry.record?.recordId;
		if (recordId === undefined) continue;
		const recordRef = Object.freeze({ kind: "agentic-memory-record", id: recordId });
		trace.push({ event: "memory-considered", recordRef, reasonCode: "packed-context-entry" });
		const metadata = packedMetadata(entry);
		if (metadata.projectId !== scope.projectId) {
			trace.push({ event: "memory-rejected", recordRef, reasonCode: "scope-mismatch" });
			continue;
		}
		if (metadata.targetWorkItemId !== item.workItemId) {
			trace.push({ event: "memory-rejected", recordRef, reasonCode: "work-item-mismatch" });
			continue;
		}
		if (metadata.procedureCode !== "verify-before-edit") {
			trace.push({ event: "memory-rejected", recordRef, reasonCode: "irrelevant-procedure" });
			continue;
		}
		route = "memory-guided-verify-first";
		trace.push({ event: "memory-used", recordRef, reasonCode: "applicable-rerun-avoidance" });
		break;
	}
	trace.push({
		event: "route-selected",
		route,
		reasonCode: route === "unsafe-direct-edit" ? "no-applicable-memory" : "memory-applied",
	});
	return Object.freeze({ route, trace: Object.freeze(trace) });
}

export function executeRoute(
	item: WorkItemProjection,
	world: EvalWorld,
	decision: PlannerDecision,
	runRef: string,
	run: "cold" | "warm",
): EvalExecutionOutcome {
	const verificationPerformedBeforeEdit = decision.route === "memory-guided-verify-first";
	const satisfiedWorldConstraint =
		!world.requiresVerificationBeforeEdit || verificationPerformedBeforeEdit;
	return Object.freeze({
		resultId: evalId("effect-run-result", runRef, run),
		effectRunId: evalId("effect-run", runRef, run),
		runRef,
		runStage: run,
		workItemId: item.workItemId,
		executionInputRevision: item.executionInputRevision,
		projectId: world.projectId,
		route: decision.route,
		status: satisfiedWorldConstraint ? "completed" : "failed",
		facts: Object.freeze({ verificationPerformedBeforeEdit, editPerformed: true }),
		issueCodes: Object.freeze(
			satisfiedWorldConstraint ? [] : ["b105.verify.verification-required-before-edit"],
		),
	});
}

export function verifyOutcome(
	item: WorkItemProjection,
	outcome: EvalExecutionOutcome,
): EvalVerification {
	const workItemMatches = outcome.workItemId === item.workItemId;
	const criteria = (item.acceptanceCriteria ?? []).map((criterion) => {
		const satisfied =
			workItemMatches &&
			criterion.criterionId === REQUIRED_CRITERION_ID &&
			outcome.facts.verificationPerformedBeforeEdit;
		return Object.freeze({
			criterionId: criterion.criterionId,
			required: criterion.required !== false,
			satisfied,
			evidenceRefs: Object.freeze([
				Object.freeze({ kind: "effect-run-result", id: outcome.resultId }),
			]),
		});
	});
	const required = criteria.filter((criterion) => criterion.required);
	const executionCompleted = outcome.status === "completed";
	const satisfied =
		executionCompleted && required.length > 0 && required.every((criterion) => criterion.satisfied);
	const issueCodes = [
		...(workItemMatches ? [] : ["b105.verify.work-item-mismatch"]),
		...(executionCompleted ? [] : ["b105.verify.execution-failed"]),
		...(satisfied ? [] : ["b105.verify.acceptance-criterion-unsatisfied"]),
	];
	return Object.freeze({
		verificationId: evalId("verification", outcome.runRef, outcome.runStage),
		workItemId: item.workItemId,
		satisfied,
		criteria: Object.freeze(criteria),
		issueCodes: Object.freeze(issueCodes),
	});
}

export function toEffectRunResult(outcome: EvalExecutionOutcome): EffectRunResult {
	const sourceRefs = Object.freeze([
		Object.freeze({ kind: "deterministic-executor", id: evalId("executor", REVISIONS.executor) }),
	]);
	if (outcome.status === "completed") {
		return Object.freeze({
			kind: "effect-run-result",
			resultId: outcome.resultId,
			effectRunId: outcome.effectRunId,
			status: "completed",
			output: Object.freeze({ kind: "b105-execution-observation", value: outcome.facts }),
			sourceRefs,
			metadata: { route: outcome.route },
		});
	}
	const issue: DataIssue = Object.freeze({
		kind: "issue",
		code: outcome.issueCodes[0] ?? "b105.verify.failed",
		message: "Deterministic execution violated the required verify-before-edit criterion",
		severity: "error",
		metadata: { route: outcome.route },
	});
	return Object.freeze({
		kind: "effect-run-result",
		resultId: outcome.resultId,
		effectRunId: outcome.effectRunId,
		status: "failed",
		error: issue,
		issues: Object.freeze([issue]),
		sourceRefs,
		metadata: { route: outcome.route, facts: outcome.facts },
	});
}

export interface ReflectionResult {
	readonly evidence: WorkItemEvidenceRecorded;
	readonly candidateMaterials: Readonly<{
		relevant: AgenticMemoryRecordCandidateMaterial<string>;
		irrelevant: AgenticMemoryRecordCandidateMaterial<string>;
		wrongScope: AgenticMemoryRecordCandidateMaterial<string>;
	}>;
}

function procedureTag(procedureCode: string): string {
	return canonicalTupleKey([...PROCEDURE_TAG_PREFIX, procedureCode]);
}

function targetTag(workItemId: string): string {
	return canonicalTupleKey([...TARGET_TAG_PREFIX, workItemId]);
}

function reflectedRecord(
	verification: EvalVerification,
	outcome: EvalExecutionOutcome,
	variant: "relevant" | "irrelevant" | "wrong-scope",
): AgenticMemoryRecord<string> {
	const relevant = variant !== "irrelevant";
	const projectId =
		variant === "wrong-scope"
			? evalId("project", outcome.projectId, "wrong-scope")
			: outcome.projectId;
	const procedureCode = relevant ? "verify-before-edit" : "format-after-edit";
	return Object.freeze({
		id: evalId("procedural-record", outcome.workItemId, variant),
		kind: "procedural",
		persistenceLevel: "project",
		artifactKind: "procedure",
		scope: Object.freeze({ projectId }),
		fragment: Object.freeze({
			id: evalId("procedural-fragment", outcome.workItemId, variant),
			payload: relevant
				? "Verify the WorkItem before editing when rerunning after this acceptance failure."
				: "Format the final summary after editing.",
			tNs: 105n,
			confidence: 1,
			tags: Object.freeze([
				RETRIEVAL_TAG,
				procedureTag(procedureCode),
				targetTag(outcome.workItemId),
			]),
			sources: Object.freeze([verification.verificationId, outcome.resultId]),
			provenance: "B105 deterministic independent-verifier reflection",
		}),
	});
}

function candidateMaterial(
	record: AgenticMemoryRecord<string>,
	verification: EvalVerification,
	outcome: EvalExecutionOutcome,
): AgenticMemoryRecordCandidateMaterial<string> {
	return Object.freeze({
		kind: "agentic-memory-record-candidate-material",
		operation: "create",
		operationVersion: 1,
		record,
		sourceRefs: Object.freeze([
			Object.freeze({ kind: "b105-verification", id: verification.verificationId }),
			Object.freeze({ kind: "effect-run-result", id: outcome.resultId }),
		]),
		evidenceRefs: Object.freeze([
			Object.freeze({ kind: "b105-verification", id: verification.verificationId }),
		]),
		metadata: Object.freeze({ reflectorRevision: REVISIONS.reflector }),
	});
}

export function reflectFailure(
	verification: EvalVerification,
	outcome: EvalExecutionOutcome,
): ReflectionResult {
	if (verification.satisfied || outcome.status !== "failed") {
		throw new Error("B105 reflector requires independent failure evidence");
	}
	if (verification.workItemId !== outcome.workItemId) {
		throw new Error("B105 reflector rejects cross-WorkItem verification/outcome evidence");
	}
	const outcomeReferenced = verification.criteria.some((criterion) =>
		criterion.evidenceRefs.some(
			(ref) => ref.kind === "effect-run-result" && ref.id === outcome.resultId,
		),
	);
	if (!outcomeReferenced) {
		throw new Error("B105 reflector requires verifier evidence for the exact outcome");
	}
	const relevant = candidateMaterial(
		reflectedRecord(verification, outcome, "relevant"),
		verification,
		outcome,
	);
	const irrelevant = candidateMaterial(
		reflectedRecord(verification, outcome, "irrelevant"),
		verification,
		outcome,
	);
	const wrongScope = candidateMaterial(
		reflectedRecord(verification, outcome, "wrong-scope"),
		verification,
		outcome,
	);
	const candidateMaterials = Object.freeze({ relevant, irrelevant, wrongScope });
	const effectResult = toEffectRunResult(outcome);
	const evidence: WorkItemEvidenceRecorded = Object.freeze({
		kind: "work-item-evidence-recorded",
		evidenceId: evalId("work-item-evidence", outcome.runRef, "cold-failure"),
		workItemId: outcome.workItemId,
		effectRunId: outcome.effectRunId,
		effectRunResultId: outcome.resultId,
		executionInputRevision: outcome.executionInputRevision,
		status: "failed",
		sourceRefs: Object.freeze([
			Object.freeze({ kind: "effect-run-result", id: outcome.resultId }),
			Object.freeze({ kind: "b105-verification", id: verification.verificationId }),
		]),
		error: effectResult.status === "failed" ? effectResult.error : undefined,
		issues: effectResult.status === "failed" ? effectResult.issues : undefined,
		reason: "Independent verifier failure reflected into candidate material",
		metadata: Object.freeze({ reflectedCandidateMaterials: candidateMaterials }),
	});
	return Object.freeze({ evidence, candidateMaterials });
}

function tagValue(
	record: AgenticMemoryRecord<string>,
	prefix: readonly string[],
): string | undefined {
	for (const tag of record.fragment.tags) {
		const parts = parseCanonicalTupleKey(tag);
		if (
			parts !== undefined &&
			parts.length === prefix.length + 1 &&
			prefix.every((part, index) => parts[index] === part)
		) {
			return parts.at(-1);
		}
	}
	return undefined;
}

export function packedTextMetadata(record: AgenticMemoryRecord<string>) {
	return Object.freeze({
		recordId: record.id,
		projectId: record.scope?.projectId ?? "",
		targetWorkItemId: tagValue(record, TARGET_TAG_PREFIX) ?? "",
		procedureCode: tagValue(record, PROCEDURE_TAG_PREFIX) ?? "",
	});
}

export function verificationIssueCodes(
	verification: EvalVerification,
	outcome: EvalExecutionOutcome,
): readonly string[] {
	return boundedIssueCodes([...verification.issueCodes, ...outcome.issueCodes]);
}
