import { describe, expect, it } from "vitest";
import type { DataIssue } from "../data/index.js";
import { graph } from "../graph/graph.js";
import { canonicalTupleKey, parseCanonicalTupleKey } from "../identity.js";
import type { EffectRunResult } from "../orchestration/agent-runtime.js";
import type { WorkItemEvidenceRecorded } from "../orchestration/work-item-runtime.js";
import type { MemoryRetrievalQuery } from "../patterns/semantic-memory-graph.js";
import type { Message } from "../protocol/messages.js";
import {
	type AgenticMemoryContextPackingPolicy,
	type AgenticMemoryContextText,
	type AgenticMemoryPackedContext,
	type AgenticMemoryRecord,
	type AgenticMemoryRecordAdmissionPolicy,
	type AgenticMemoryRecordApplicationPolicy,
	type AgenticMemoryRecordCandidateMaterial,
	agenticMemoryBundle,
	agenticMemoryContextPackingBundle,
} from "../solutions/agentic-memory/index.js";
import type { AgenticWorkItemMemoryMappingPolicy } from "../solutions/agentic-work-item-memory/index.js";
import { mapAgenticWorkItemMemoryApplicationRecipe } from "../solutions/agentic-work-item-memory-application/index.js";
import type { WorkItemProjection } from "../solutions/work-item/index.js";

type EvalRoute = "unsafe-direct-edit" | "memory-guided-verify-first";

interface PlannerDecision {
	readonly route: EvalRoute;
	readonly passed: boolean;
	readonly trace: readonly string[];
}

const data = <T>(messages: Message[]): T[] =>
	messages.filter((m) => m[0] === "DATA").map((m) => (m as readonly ["DATA", T])[1]);

function collect(node: { subscribe(sink: (messages: Message) => void): () => void }) {
	const messages: Message[] = [];
	const unsubscribe = node.subscribe((message) => messages.push(message));
	return { messages, unsubscribe };
}

const id = (...parts: readonly string[]) => canonicalTupleKey(["b105", ...parts]);

const workItem = (): WorkItemProjection => ({
	workItemId: "wi-b105-rerun",
	authoringRevision: 1,
	executionInputRevision: 1,
	lastEventId: "event-b105-1",
	summary: "Avoid repeating the unsafe WorkItem route after verification failure",
	sourceRefs: [{ kind: "issue", id: "issue-b105" }],
});

const admissionPolicy = (): AgenticMemoryRecordAdmissionPolicy => ({
	kind: "agentic-memory-record-admission-policy",
	policyId: id("admission-policy"),
	defaultState: "admitted",
});

const applicationPolicy = (): AgenticMemoryRecordApplicationPolicy => ({
	kind: "agentic-memory-record-application-policy",
	policyId: id("application-policy"),
});

const mappingPolicy = (): AgenticWorkItemMemoryMappingPolicy<string> => ({
	kind: "agentic-work-item-memory-mapping-policy",
	policyId: id("bridge-policy"),
	recordRules: [
		{
			ruleId: id("record-rule", "reflect-cold-failure"),
			candidateMaterialFrom: {
				input: "evidence",
				refId: id("work-item-evidence", "cold-failure"),
				path: ["metadata", "reflectedCandidateMaterial"],
			},
			reason: "cold VERIFY/REFLECT failure emitted procedural rerun avoidance material",
			evidenceRefs: [{ kind: "work-item-evidence", id: id("work-item-evidence", "cold-failure") }],
		},
	],
	scoreRules: [],
});

function deterministicPlanner(
	item: WorkItemProjection,
	packedContext?: AgenticMemoryPackedContext,
): PlannerDecision {
	const memoryRecordIds = (packedContext?.entries ?? [])
		.map((entry) => entry.record?.recordId)
		.filter((recordId): recordId is string => recordId !== undefined);
	const hasAvoidanceMemory =
		memoryRecordIds.length > 0 &&
		(packedContext?.text.includes("avoid unsafe-direct-edit") ?? false);
	const route: EvalRoute = hasAvoidanceMemory ? "memory-guided-verify-first" : "unsafe-direct-edit";
	return {
		route,
		passed: route === "memory-guided-verify-first",
		trace: [
			`workItem:${item.workItemId}`,
			`route:${route}`,
			hasAvoidanceMemory ? `memory:${memoryRecordIds.join(",")}` : "memory:none",
		],
	};
}

function coldFailureOutcome(decision: PlannerDecision): EffectRunResult {
	const issue: DataIssue = {
		kind: "issue",
		code: "b105.verify.failed-route",
		message: "VERIFY failed because the cold run chose unsafe-direct-edit",
		severity: "error",
		metadata: { route: decision.route },
	};
	return {
		kind: "effect-run-result",
		resultId: id("effect-run-result", "cold"),
		effectRunId: id("effect-run", "cold"),
		status: "failed",
		error: issue,
		sourceRefs: [{ kind: "deterministic-planner", id: id("planner", "cold") }],
		issues: [issue],
		metadata: { route: decision.route, trace: [...decision.trace] },
	};
}

function failureEvidence(outcome: EffectRunResult): WorkItemEvidenceRecorded {
	if (outcome.status !== "failed") {
		throw new Error("B105 cold fixture expects a failed outcome");
	}
	return {
		kind: "work-item-evidence-recorded",
		evidenceId: id("work-item-evidence", "cold-failure"),
		workItemId: "wi-b105-rerun",
		effectRunId: outcome.effectRunId,
		effectRunResultId: outcome.resultId,
		executionInputRevision: 1,
		status: "failed",
		sourceRefs: [
			{ kind: "effect-run", id: outcome.effectRunId },
			{ kind: "effect-run-result", id: outcome.resultId },
		],
		error: outcome.error,
		reason: "VERIFY/REFLECT recorded the cold route as a reusable avoidance memory",
		metadata: outcome.metadata,
	};
}

function withReflectedMaterial(
	evidence: WorkItemEvidenceRecorded,
	material: AgenticMemoryRecordCandidateMaterial<string>,
): WorkItemEvidenceRecorded {
	return {
		...evidence,
		metadata: {
			...evidence.metadata,
			reflectedCandidateMaterial: material,
		},
	};
}

function proceduralAvoidanceRecord(
	item: WorkItemProjection,
	evidence: WorkItemEvidenceRecorded,
	outcome: EffectRunResult,
): AgenticMemoryRecord<string> {
	return {
		id: id("procedural-record", item.workItemId),
		kind: "procedural",
		persistenceLevel: "project",
		artifactKind: "procedure",
		fragment: {
			id: id("procedural-fragment", item.workItemId),
			payload:
				"For wi-b105-rerun, avoid unsafe-direct-edit after VERIFY failure; use memory-guided-verify-first.",
			tNs: 105n,
			confidence: 1,
			tags: ["work-item-rerun-avoidance", item.workItemId],
			sources: [evidence.evidenceId, outcome.resultId],
			provenance: "B105 deterministic VERIFY/REFLECT fixture",
		},
		scope: { projectId: "project-b105" },
	};
}

function candidateMaterial(
	record: AgenticMemoryRecord<string>,
	evidence: WorkItemEvidenceRecorded,
	outcome: EffectRunResult,
): AgenticMemoryRecordCandidateMaterial<string> {
	return {
		kind: "agentic-memory-record-candidate-material",
		operation: "create",
		operationVersion: 1,
		record,
		sourceRefs: [
			{ kind: "work-item-evidence", id: evidence.evidenceId },
			{ kind: "effect-run-result", id: outcome.resultId },
		],
		evidenceRefs: [{ kind: "work-item-evidence", id: evidence.evidenceId }],
		metadata: { fixture: "B105" },
	};
}

function packAppliedMemory(
	recordsToPack: readonly AgenticMemoryRecord<string>[],
): AgenticMemoryPackedContext | undefined {
	const g = graph();
	const records = g.state<readonly AgenticMemoryRecord<string>[]>([], {
		name: "b105/appliedMemoryRecords",
	});
	const query = g.state<MemoryRetrievalQuery>(
		{ tags: ["work-item-rerun-avoidance"], limit: 1 },
		{ name: "b105/memoryQuery" },
	);
	const memory = agenticMemoryBundle<string>(g, {
		name: "b105/memory",
		records,
		query,
	});
	const texts = g.state<readonly AgenticMemoryContextText[]>([], {
		name: "b105/contextTexts",
	});
	const policy = g.state<AgenticMemoryContextPackingPolicy>(
		{ maxEntries: 1, includeMetadata: true },
		{ name: "b105/packingPolicy" },
	);
	const packed = agenticMemoryContextPackingBundle(g, {
		name: "b105/contextPacking",
		context: memory.context,
		texts,
		policy,
	});
	const observed = collect(packed.packedContext);
	try {
		records.set(recordsToPack);
		texts.set(
			recordsToPack.map((record) => ({
				fragmentId: record.fragment.id,
				text: record.fragment.payload,
				metadata: { recordId: record.id },
			})),
		);
		return data<AgenticMemoryPackedContext>(observed.messages).at(-1);
	} finally {
		observed.unsubscribe();
	}
}

describe("B105 deterministic memory rerun avoidance eval fixture", () => {
	it("proves the same WorkItem rerun avoids a prior failure through applied AgenticMemory", () => {
		const item = workItem();
		const coldDecision = deterministicPlanner(item);
		const coldOutcome = coldFailureOutcome(coldDecision);
		const coldEvidence = failureEvidence(coldOutcome);
		const learnedRecord = proceduralAvoidanceRecord(item, coldEvidence, coldOutcome);
		const reflectedEvidence = withReflectedMaterial(
			coldEvidence,
			candidateMaterial(learnedRecord, coldEvidence, coldOutcome),
		);

		const memoryApplication = mapAgenticWorkItemMemoryApplicationRecipe({
			workItem: item,
			policy: mappingPolicy(),
			evidence: [reflectedEvidence],
			outcomes: [coldOutcome],
			records: [],
			admissionPolicy: admissionPolicy(),
			applicationPolicy: applicationPolicy(),
			evaluation: 105,
		});
		const packedContext = packAppliedMemory(memoryApplication.application?.records ?? []);
		const warmDecision = deterministicPlanner(item, packedContext);

		const cold_run_failed = !coldDecision.passed && coldOutcome.status === "failed";
		const memory_record_applied =
			memoryApplication.application?.applicationDecisions.some(
				(decision) => decision.state === "applied" && decision.record?.id === learnedRecord.id,
			) ?? false;
		const warm_run_passed = warmDecision.passed;
		const warm_decision_trace_includes_memory = warmDecision.trace.some((entry) =>
			entry.includes(learnedRecord.id),
		);
		const proposal = memoryApplication.bridge.proposals[0];
		const idempotencyKeyParts =
			proposal?.idempotencyKey === undefined
				? undefined
				: parseCanonicalTupleKey(proposal.idempotencyKey);

		expect(coldDecision.route).toBe("unsafe-direct-edit");
		expect(coldDecision.trace).toContain("memory:none");
		expect(memoryApplication.bridge.proposals).toHaveLength(1);
		expect(memoryApplication.bridge.cursor).toMatchObject({
			recordRules: 1,
			explicitCandidates: 0,
			proposals: 1,
			issues: 0,
		});
		expect(proposal?.sourceRefs?.map((ref) => `${ref.kind}:${ref.id}`)).toEqual(
			expect.arrayContaining([
				`work-item-evidence:${reflectedEvidence.evidenceId}`,
				`effect-run-result:${coldOutcome.resultId}`,
			]),
		);
		expect(idempotencyKeyParts?.slice(0, 3)).toEqual([
			"agentic-work-item-memory",
			mappingPolicy().policyId,
			item.workItemId,
		]);
		expect(memoryApplication.admission?.admitted).toHaveLength(1);
		expect(memoryApplication.application?.appliedRecords.map((record) => record.id)).toEqual([
			learnedRecord.id,
		]);
		expect(packedContext?.entries[0]?.record?.recordId).toBe(learnedRecord.id);
		expect(warmDecision.route).toBe("memory-guided-verify-first");
		expect({
			cold_run_failed,
			memory_record_applied,
			warm_run_passed,
			warm_decision_trace_includes_memory,
			passed:
				cold_run_failed &&
				memory_record_applied &&
				warm_run_passed &&
				warm_decision_trace_includes_memory,
		}).toEqual({
			cold_run_failed: true,
			memory_record_applied: true,
			warm_run_passed: true,
			warm_decision_trace_includes_memory: true,
			passed: true,
		});
	});
});
