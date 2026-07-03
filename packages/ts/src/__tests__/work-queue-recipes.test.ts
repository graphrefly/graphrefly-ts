import { describe, expect, it } from "vitest";
import {
	type ExecutorQueuedDispatchPayload,
	executorWorkQueueRecipe,
} from "../executors/work-queue.js";
import { graph } from "../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../identity.js";
import type { AgentRequestIssued, ExecutorOutcome } from "../orchestration/agent-runtime.js";
import type {
	WorkItemEffectRequested,
	WorkItemEvidenceRecorded,
} from "../orchestration/work-item-runtime.js";
import {
	type WorkItemAuthoringInput,
	type WorkItemEffectPlanProposed,
	type WorkItemEffectPlanResult,
	workItemAuthoringProjector,
	workItemCreatedFromDraft,
	workItemEffectPlanProjector,
} from "../solutions/work-item/scheduling.js";
import {
	type WorkItemQueuedWorkPayload,
	workItemWorkQueueRecipe,
} from "../solutions/work-item/work-queue.js";
import type { WorkQueueCommand, WorkQueueRecord } from "../work-queue/index.js";

describe("workQueue recipes (D327/D328/D331)", () => {
	it("lowers WorkItem effect facts to queue submit command facts", () => {
		const g = graph();
		const requests = g.node<WorkItemEffectRequested>([], null, { name: "workItemRequests" });
		const records = g.node<WorkQueueRecord<WorkItemQueuedWorkPayload>>([], null, {
			name: "queueRecords",
		});
		const recipe = workItemWorkQueueRecipe(g, {
			effectRequests: requests,
			records,
			policy: {
				payload: () =>
					({
						workItemId: "wrong",
						effectRunId: "wrong",
						requestId: "wrong",
						effectKind: "wrong",
						sourceEventId: "event-1",
					}) as Partial<WorkItemQueuedWorkPayload>,
			},
		});
		const submits = collectData<WorkQueueCommand<WorkItemQueuedWorkPayload>>(recipe.submitCommands);

		requests.down([
			[
				"DATA",
				{
					kind: "work-item-effect-requested",
					requestId: "req-1",
					workItemId: "wi-1",
					effectRunId: "run-1",
					effectKind: "verify",
					idempotencyKey: "idem-1",
					sourceRefs: [{ kind: "work-item", id: "wi-1" }],
				} satisfies WorkItemEffectRequested,
			],
		]);

		expect(submits.at(-1)).toEqual(
			expect.objectContaining({
				kind: "submit",
				commandId: compoundTupleKey("work-item-work-queue-submit", ["req-1"]),
				workId: compoundTupleKey("work-item-work", ["wi-1", "run-1"]),
				idempotencyKey: "idem-1",
				sourceRefs: [canonicalTupleKey(["work-item", "wi-1"])],
				payload: expect.objectContaining({
					kind: "work-item-queued-work",
					workItemId: "wi-1",
					effectRunId: "run-1",
					requestId: "req-1",
					effectKind: "verify",
					sourceEventId: "event-1",
				}),
			}),
		);
		expect(g.describe().nodes).toContainEqual(
			expect.objectContaining({
				id: "workItemWorkQueue/submitCommands",
				factory: "workItemWorkQueueSubmitCommands",
			}),
		);
	});

	it("maps terminal WorkItem queue records to evidence without mutating WorkItems", () => {
		const g = graph();
		const requests = g.node<WorkItemEffectRequested>([], null, { name: "workItemRequests" });
		const records = g.node<WorkQueueRecord<WorkItemQueuedWorkPayload>>([], null, {
			name: "queueRecords",
		});
		const recipe = workItemWorkQueueRecipe(g, { effectRequests: requests, records });
		const evidence = collectData(recipe.evidence);
		const issues = collectData(recipe.issues);

		records.down([
			[
				"DATA",
				{
					kind: "work-admitted",
					recordSeq: 1,
					queueId: "q",
					workId: "work-1",
					commandId: "admit-1",
					recordedAtMs: 100,
					payload: workItemPayload(),
					messageBus: { topic: "work", seq: 1, subscriptionId: "sub" },
				} satisfies WorkQueueRecord<WorkItemQueuedWorkPayload>,
			],
			[
				"DATA",
				{
					kind: "work-completed",
					recordSeq: 2,
					queueId: "q",
					workId: "work-1",
					leaseId: "lease-1",
					attempt: 1,
					workerId: "worker-1",
					result: { ok: true },
					recordedAtMs: 120,
				} satisfies WorkQueueRecord<WorkItemQueuedWorkPayload>,
			],
			[
				"DATA",
				{
					kind: "work-dead-lettered",
					recordSeq: 3,
					queueId: "q",
					workId: "work-1",
					reason: "retry-exhausted",
					recordedAtMs: 140,
				} satisfies WorkQueueRecord<WorkItemQueuedWorkPayload>,
			],
		]);

		expect(evidence).toEqual([
			expect.objectContaining({
				kind: "work-item-evidence-recorded",
				workItemId: "wi-1",
				effectRunId: "run-1",
				status: "completed",
				output: expect.objectContaining({ kind: "work-queue-completion" }),
				metadata: expect.objectContaining({
					executionInputRevision: 3,
					verificationStepIds: ["step-1"],
					acceptanceCriterionIds: ["ac-1"],
					queueRecordKind: "work-completed",
				}),
			}),
			expect.objectContaining({
				kind: "work-item-evidence-recorded",
				workItemId: "wi-1",
				effectRunId: "run-1",
				status: "failed",
				reason: "retry-exhausted",
			}),
		]);
		expect(issues).toEqual([]);
	});

	it("roundtrips WorkItemEffectPlan coordinates through the WorkItem workQueue recipe", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput>([], null, { name: "workItemFacts" });
		const proposals = g.node<WorkItemEffectPlanProposed>([], null, { name: "effectPlans" });
		const queueEvidence = g.node<WorkItemEvidenceRecorded>([], null, { name: "queueEvidence" });
		const records = g.node<WorkQueueRecord<WorkItemQueuedWorkPayload>>([], null, {
			name: "queueRecords",
		});
		const authoring = workItemAuthoringProjector(g, { facts });
		const plan = workItemEffectPlanProjector(g, {
			workItems: authoring.workItems,
			proposals,
			evidence: queueEvidence,
			policy: { allowedEffectKinds: ["verification"] },
		});
		const recipe = workItemWorkQueueRecipe(g, {
			effectRequests: plan.effectRequests,
			records,
		});
		const submits = collectData<WorkQueueCommand<WorkItemQueuedWorkPayload>>(recipe.submitCommands);
		const evidence = collectData<WorkItemEvidenceRecorded>(recipe.evidence);
		const results = collectData<WorkItemEffectPlanResult>(plan.results);
		recipe.evidence.subscribe((msg) => {
			if (msg[0] === "DATA")
				queueEvidence.down([msg as readonly ["DATA", WorkItemEvidenceRecorded]]);
		});

		facts.down([
			[
				"DATA",
				workItemCreatedFromDraft("wi-1", {
					summary: "Queue a plan member",
					detail: "Exercise the WorkItem three-layer roundtrip.",
				}),
			],
		]);
		proposals.down([
			[
				"DATA",
				{
					kind: "work-item-effect-plan-proposed",
					planId: "effect-plan-queue",
					workItemId: "wi-1",
					executionInputRevision: 1,
					members: [
						{
							memberId: "A",
							effectKind: "verification",
							goal: { kind: "verification", summary: "Run queued verification" },
						},
					],
				} satisfies WorkItemEffectPlanProposed,
			],
		]);
		const submit = submits.at(-1);
		if (submit === undefined) throw new Error("expected submit command");

		expect(submit.payload).toMatchObject({
			workItemId: "wi-1",
			requestId: "work-item:wi-1:effect-plan:1:effect-plan-queue:A",
			effectRunId: "effect-run:work-item:wi-1:effect-plan:1:effect-plan-queue:A",
			executionInputRevision: 1,
			planId: "effect-plan-queue",
			planMemberId: "A",
		});

		records.down([
			[
				"DATA",
				{
					kind: "work-admitted",
					recordSeq: 1,
					queueId: "q",
					workId: submit.workId ?? "queued-plan-member",
					commandId: submit.commandId,
					recordedAtMs: 100,
					payload: submit.payload,
					messageBus: { topic: "work", seq: 1, subscriptionId: "sub" },
				} satisfies WorkQueueRecord<WorkItemQueuedWorkPayload>,
			],
			[
				"DATA",
				{
					kind: "work-completed",
					recordSeq: 2,
					queueId: "q",
					workId: submit.workId ?? "queued-plan-member",
					leaseId: "lease-1",
					attempt: 1,
					workerId: "worker-1",
					result: { ok: true },
					recordedAtMs: 120,
				} satisfies WorkQueueRecord<WorkItemQueuedWorkPayload>,
			],
		]);

		expect(evidence.at(-1)).toMatchObject({
			workItemId: "wi-1",
			requestId: submit.payload.requestId,
			effectRunId: submit.payload.effectRunId,
			executionInputRevision: 1,
			planId: "effect-plan-queue",
			planMemberId: "A",
			status: "completed",
		});
		expect(results.at(-1)).toMatchObject({
			status: "succeeded",
			memberResults: [
				expect.objectContaining({
					planMemberId: "A",
					requestId: submit.payload.requestId,
					effectRunId: submit.payload.effectRunId,
					evidenceId: compoundTupleKey("work-queue-evidence", ["2"]),
				}),
			],
		});
	});

	it("maps executor queue claims to dispatch-attempt facts and outcomes to queue commands", () => {
		const g = graph();
		const records = g.node<WorkQueueRecord<ExecutorPayload>>([], null, { name: "queueRecords" });
		const outcomes = g.node<ExecutorOutcome>([], null, { name: "executorOutcomes" });
		const recipe = executorWorkQueueRecipe(g, { records, outcomes, workerId: "worker-1" });
		const attempts = collectData(recipe.attempts);
		const commands = collectData(recipe.commands);

		records.down([
			[
				"DATA",
				{
					kind: "work-admitted",
					recordSeq: 1,
					queueId: "q",
					workId: "work-1",
					commandId: "admit-1",
					recordedAtMs: 100,
					payload: executorPayload(),
					messageBus: { topic: "exec", seq: 1, subscriptionId: "sub" },
				} satisfies WorkQueueRecord<ExecutorPayload>,
			],
			[
				"DATA",
				{
					kind: "work-claimed",
					recordSeq: 2,
					queueId: "q",
					workId: "work-1",
					leaseId: "lease-1",
					attempt: 1,
					workerId: "worker-1",
					claimedAtMs: 110,
					leaseExpiresAtMs: 210,
					recordedAtMs: 110,
				} satisfies WorkQueueRecord<ExecutorPayload>,
			],
		]);
		outcomes.down([
			[
				"DATA",
				{
					kind: "result",
					outcomeId: "out-1",
					requestId: "req-1",
					operationId: "op-1",
					routeId: "route-1",
					executorId: "exec-1",
					profileId: "profile-1",
					attempt: 1,
					result: { kind: "tool-result", value: { ok: true } },
				} satisfies ExecutorOutcome,
			],
		]);

		expect(attempts.at(-1)).toEqual(
			expect.objectContaining({
				kind: "executor-queued-dispatch-attempt",
				workId: "work-1",
				leaseId: "lease-1",
				queueAttempt: 1,
				requestId: "req-1",
				operationId: "op-1",
			}),
		);
		expect(commands.at(-1)).toEqual(
			expect.objectContaining({
				kind: "complete",
				workId: "work-1",
				leaseId: "lease-1",
				attempt: 1,
				workerId: "worker-1",
				result: { kind: "tool-result", value: { ok: true } },
			}),
		);
	});

	it("keeps executor failures as queue lifecycle commands, not ExecutorOutcome truth", () => {
		const g = graph();
		const records = g.node<WorkQueueRecord<ExecutorPayload>>([], null, { name: "queueRecords" });
		const outcomes = g.node<ExecutorOutcome>([], null, { name: "executorOutcomes" });
		const recipe = executorWorkQueueRecipe(g, { records, outcomes });
		const commands = collectData(recipe.commands);

		records.down([
			[
				"DATA",
				{
					kind: "work-admitted",
					recordSeq: 1,
					queueId: "q",
					workId: "work-1",
					commandId: "admit-1",
					recordedAtMs: 100,
					payload: executorPayload(),
					messageBus: { topic: "exec", seq: 1, subscriptionId: "sub" },
				} satisfies WorkQueueRecord<ExecutorPayload>,
			],
			[
				"DATA",
				{
					kind: "work-claimed",
					recordSeq: 2,
					queueId: "q",
					workId: "work-1",
					leaseId: "lease-1",
					attempt: 1,
					workerId: "worker-1",
					claimedAtMs: 110,
					leaseExpiresAtMs: 210,
					recordedAtMs: 110,
				} satisfies WorkQueueRecord<ExecutorPayload>,
			],
		]);
		outcomes.down([
			[
				"DATA",
				{
					kind: "failure",
					outcomeId: "out-fail",
					requestId: "req-1",
					operationId: "op-1",
					routeId: "route-1",
					executorId: "exec-1",
					profileId: "profile-1",
					attempt: 1,
					error: { kind: "issue", code: "provider-error", message: "provider failed" },
					retryable: true,
				} satisfies ExecutorOutcome,
			],
		]);

		expect(commands.at(-1)).toEqual(
			expect.objectContaining({
				kind: "fail",
				workId: "work-1",
				leaseId: "lease-1",
				retryable: true,
			}),
		);
	});

	it("buffers executor outcomes that replay before the queue claim", () => {
		const g = graph();
		const records = g.node<WorkQueueRecord<ExecutorPayload>>([], null, { name: "queueRecords" });
		const outcomes = g.node<ExecutorOutcome>([], null, { name: "executorOutcomes" });
		const recipe = executorWorkQueueRecipe(g, { records, outcomes });
		const commands = collectData(recipe.commands);
		const issues = collectData(recipe.issues);

		outcomes.down([
			[
				"DATA",
				{
					kind: "result",
					outcomeId: "out-before-claim",
					requestId: "req-1",
					operationId: "op-1",
					routeId: "route-1",
					executorId: "exec-1",
					profileId: "profile-1",
					attempt: 1,
					result: { kind: "tool-result", value: { ok: true } },
				} satisfies ExecutorOutcome,
			],
		]);
		expect(commands).toEqual([]);
		expect(issues).toEqual([]);

		records.down([
			[
				"DATA",
				{
					kind: "work-admitted",
					recordSeq: 1,
					queueId: "q",
					workId: "work-1",
					commandId: "admit-1",
					recordedAtMs: 100,
					payload: executorPayload(),
					messageBus: { topic: "exec", seq: 1, subscriptionId: "sub" },
				} satisfies WorkQueueRecord<ExecutorPayload>,
			],
			[
				"DATA",
				{
					kind: "work-claimed",
					recordSeq: 2,
					queueId: "q",
					workId: "work-1",
					leaseId: "lease-1",
					attempt: 1,
					workerId: "worker-1",
					claimedAtMs: 110,
					leaseExpiresAtMs: 210,
					recordedAtMs: 110,
				} satisfies WorkQueueRecord<ExecutorPayload>,
			],
		]);

		expect(commands.at(-1)).toEqual(
			expect.objectContaining({
				kind: "complete",
				workId: "work-1",
				leaseId: "lease-1",
			}),
		);
		expect(issues).toEqual([]);
	});

	it("rejects duplicate executor terminal outcomes for one queue claim", () => {
		const g = graph();
		const records = g.node<WorkQueueRecord<ExecutorPayload>>([], null, { name: "queueRecords" });
		const outcomes = g.node<ExecutorOutcome>([], null, { name: "executorOutcomes" });
		const recipe = executorWorkQueueRecipe(g, { records, outcomes });
		const commands = collectData(recipe.commands);
		const issues = collectData(recipe.issues);

		records.down([
			[
				"DATA",
				{
					kind: "work-admitted",
					recordSeq: 1,
					queueId: "q",
					workId: "work-1",
					commandId: "admit-1",
					recordedAtMs: 100,
					payload: executorPayload(),
					messageBus: { topic: "exec", seq: 1, subscriptionId: "sub" },
				} satisfies WorkQueueRecord<ExecutorPayload>,
			],
			[
				"DATA",
				{
					kind: "work-claimed",
					recordSeq: 2,
					queueId: "q",
					workId: "work-1",
					leaseId: "lease-1",
					attempt: 1,
					workerId: "worker-1",
					claimedAtMs: 110,
					leaseExpiresAtMs: 210,
					recordedAtMs: 110,
				} satisfies WorkQueueRecord<ExecutorPayload>,
			],
		]);
		outcomes.down([
			[
				"DATA",
				{
					kind: "result",
					outcomeId: "out-result",
					requestId: "req-1",
					operationId: "op-1",
					routeId: "route-1",
					executorId: "exec-1",
					profileId: "profile-1",
					attempt: 1,
					result: { kind: "ok" },
				} satisfies ExecutorOutcome,
			],
			[
				"DATA",
				{
					kind: "failure",
					outcomeId: "out-late-fail",
					requestId: "req-1",
					operationId: "op-1",
					routeId: "route-1",
					executorId: "exec-1",
					profileId: "profile-1",
					attempt: 1,
					error: { kind: "issue", code: "late", message: "late failure" },
				} satisfies ExecutorOutcome,
			],
		]);

		expect(commands).toHaveLength(1);
		expect(commands[0]).toEqual(expect.objectContaining({ kind: "complete" }));
		expect(issues.at(-1)).toEqual(
			expect.objectContaining({
				code: "executor-duplicate-terminal-outcome-for-queue-claim",
			}),
		);
	});

	it("lowers issued executor requests to optional queue submit command facts", () => {
		const g = graph();
		const requests = g.node<AgentRequestIssued>([], null, { name: "requests" });
		const records = g.node<WorkQueueRecord<ExecutorPayload>>([], null, { name: "queueRecords" });
		const outcomes = g.node<ExecutorOutcome>([], null, { name: "outcomes" });
		const recipe = executorWorkQueueRecipe(g, {
			requests,
			records,
			outcomes,
			policy: {
				payload: () =>
					({
						requestId: "wrong",
						operationId: "wrong",
						routeId: "route-override",
					}) as Partial<ExecutorPayload>,
			},
		});
		if (recipe.submitCommands === undefined) throw new Error("missing submitCommands");
		const submits = collectData(recipe.submitCommands);

		requests.down([
			[
				"DATA",
				{
					kind: "issued",
					requestId: "req-1",
					operationId: "op-1",
					effectRunId: "run-1",
					requestKind: "executor",
					required: true,
					input: { inputId: "input-1", inputKind: "tool-call", value: { tool: "search" } },
					sourceRefs: [{ kind: "agent-request", id: "req-1" }],
				} satisfies AgentRequestIssued,
			],
		]);

		expect(submits.at(-1)).toEqual(
			expect.objectContaining({
				kind: "submit",
				commandId: "req-1:executor-work-queue-submit",
				workId: "executor:req-1",
				payload: expect.objectContaining({
					kind: "executor-queued-dispatch",
					requestId: "req-1",
					operationId: "op-1",
					inputId: "input-1",
					routeId: "route-override",
				}),
			}),
		);
	});
});

type ExecutorPayload = ExecutorQueuedDispatchPayload;

function collectData<T>(node: {
	subscribe(sink: (msg: readonly [string, unknown?]) => void): unknown;
}): T[] {
	const out: T[] = [];
	node.subscribe((msg) => {
		if (msg[0] === "DATA") out.push(msg[1] as T);
	});
	return out;
}

function workItemPayload(): WorkItemQueuedWorkPayload {
	return {
		kind: "work-item-queued-work",
		workItemId: "wi-1",
		effectRunId: "run-1",
		requestId: "req-1",
		effectKind: "verify",
		sourceRefs: [{ kind: "work-item", id: "wi-1" }],
		metadata: {
			executionInputRevision: 3,
			verificationStepIds: ["step-1"],
			acceptanceCriterionIds: ["ac-1"],
		},
	};
}

function executorPayload(): ExecutorPayload {
	return {
		kind: "executor-queued-dispatch",
		requestId: "req-1",
		operationId: "op-1",
		routeId: "route-1",
		executorId: "exec-1",
		profileId: "profile-1",
		effectRunId: "run-1",
		sourceRefs: [{ kind: "agent-request", id: "req-1" }],
	};
}
