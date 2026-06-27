import { depBatch } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import { effectRun } from "./agent-runtime.js";
import {
	deletePendingWorkItemEffectRequest,
	emitWorkItemEffectRunIssue,
	emptyWorkItemEffectRunState,
	freezeWorkItemEffectRequestViews,
	projectRuntimeFact,
	ref,
	workItemEffectRequestRefs,
} from "./work-item-runtime-shared.js";
import type {
	WorkItemEffectRequested,
	WorkItemEffectRequestViews,
	WorkItemEffectRunBundle,
	WorkItemEffectRunFact,
	WorkItemEffectRunState,
	WorkItemEffectRunViewsState,
	WorkItemSeed,
} from "./work-item-runtime-types.js";

export function workItemEffectRunProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly workItems: Node<WorkItemSeed>;
		readonly effectRequests: Node<WorkItemEffectRequested>;
	},
): WorkItemEffectRunBundle {
	const name = opts.name ?? "workItemEffectRuns";
	const runtime = graph.node<WorkItemEffectRunFact>(
		[opts.workItems, opts.effectRequests],
		(ctx) => {
			const state = ctx.state.get<WorkItemEffectRunState>() ?? emptyWorkItemEffectRunState();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const workItem = raw as WorkItemSeed;
				state.workItems.set(workItem.workItemId, workItem);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const request = raw as WorkItemEffectRequested;
				state.requests.set(request.requestId, request);
				const requestRefs = workItemEffectRequestRefs(request);
				state.statusSeq += 1;
				state.auditSeq += 1;
				ctx.down([
					[
						"DATA",
						{
							kind: "status",
							status: {
								kind: "work-item-status",
								statusId: `${request.workItemId}:effect-request-pending:${state.statusSeq}`,
								workItemId: request.workItemId,
								effectRunId: request.effectRunId,
								requestId: request.requestId,
								state: "effect-request-pending",
								sourceRefs: requestRefs,
								metadata: { effectKind: request.effectKind },
							},
						} satisfies WorkItemEffectRunFact,
					],
					[
						"DATA",
						{
							kind: "audit",
							audit: {
								id: `${request.workItemId}:effect-request-pending:${state.auditSeq}`,
								kind: "work-item-effect-request-pending",
								subjectId: request.workItemId,
								sourceRefs: requestRefs,
								metadata: { effectRunId: request.effectRunId, effectKind: request.effectKind },
							},
						} satisfies WorkItemEffectRunFact,
					],
				]);
				const workItem = state.workItems.get(request.workItemId);
				if (workItem === undefined) {
					emitWorkItemEffectRunIssue(
						ctx,
						state,
						`unknown-work-item:${request.requestId}`,
						"unknown-work-item-effect-request",
						`WorkItemEffectRequested '${request.requestId}' references unknown WorkItem '${request.workItemId}'`,
						request.workItemId,
						requestRefs,
					);
					continue;
				}
				const existingEffectRunId = state.effectRunsByRequest.get(request.requestId);
				if (existingEffectRunId !== undefined) {
					emitWorkItemEffectRunIssue(
						ctx,
						state,
						`duplicate-effect-request:${request.requestId}`,
						"duplicate-work-item-effect-request",
						`WorkItemEffectRequested '${request.requestId}' was already mapped to EffectRun '${existingEffectRunId}'`,
						request.workItemId,
						requestRefs,
					);
					continue;
				}
				if (state.seededEffectRunIds.has(request.effectRunId)) {
					emitWorkItemEffectRunIssue(
						ctx,
						state,
						`duplicate-effect-run:${request.effectRunId}:${request.requestId}`,
						"duplicate-work-item-effect-run",
						`EffectRun '${request.effectRunId}' was already seeded from another WorkItemEffectRequested fact`,
						request.workItemId,
						requestRefs,
					);
					continue;
				}
				state.effectRunsByRequest.set(request.requestId, request.effectRunId);
				state.seededEffectRunIds.add(request.effectRunId);
				const run = effectRun({
					effectRunId: request.effectRunId,
					agentRunId: request.agentRunId,
					subjectRefs: [ref("work-item", request.workItemId)],
					goal: request.goal,
					sourceRefs: [
						ref("work-item", request.workItemId),
						ref("work-item-effect-request", request.requestId),
						...(request.sourceRefs ?? []),
					],
					policyRefs: request.policyRefs,
					limits: request.limits,
					createdBy: request.createdBy,
					createdAtMs: request.createdAtMs,
					metadata: {
						...(request.metadata ?? {}),
						effectKind: request.effectKind,
						idempotencyKey: request.idempotencyKey,
					},
				});
				state.statusSeq += 1;
				state.auditSeq += 1;
				ctx.down([
					["DATA", { kind: "effect-run", effectRun: run } satisfies WorkItemEffectRunFact],
					[
						"DATA",
						{
							kind: "status",
							status: {
								kind: "work-item-status",
								statusId: `${request.workItemId}:effect-run-seeded:${state.statusSeq}`,
								workItemId: request.workItemId,
								effectRunId: request.effectRunId,
								requestId: request.requestId,
								state: "effect-run-seeded",
								sourceRefs: run.sourceRefs,
							},
						} satisfies WorkItemEffectRunFact,
					],
					[
						"DATA",
						{
							kind: "audit",
							audit: {
								id: `${request.workItemId}:effect-run-seeded:${state.auditSeq}`,
								kind: "work-item-effect-run-seeded",
								subjectId: request.workItemId,
								sourceRefs: run.sourceRefs,
								metadata: { effectRunId: request.effectRunId, effectKind: request.effectKind },
							},
						} satisfies WorkItemEffectRunFact,
					],
				]);
			}
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "workItemEffectRunProjector" },
	);
	return {
		effectRuns: projectRuntimeFact(
			graph,
			runtime,
			`${name}/effectRuns`,
			"workItemEffectRuns",
			(fact) => (fact.kind === "effect-run" ? fact.effectRun : undefined),
		),
		status: projectRuntimeFact(
			graph,
			runtime,
			`${name}/status`,
			"workItemEffectRunStatus",
			(fact) => (fact.kind === "status" ? fact.status : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"workItemEffectRunIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(graph, runtime, `${name}/audit`, "workItemEffectRunAudit", (fact) =>
			fact.kind === "audit" ? fact.audit : undefined,
		),
		views: graph.node<WorkItemEffectRequestViews>(
			[opts.effectRequests, runtime],
			(ctx) => {
				const state = ctx.state.get<WorkItemEffectRunViewsState>() ?? {
					pendingEffectRequests: new Map<string, WorkItemEffectRequested>(),
					settledRequestIds: new Set<string>(),
					issues: [],
					audit: [],
				};
				for (const raw of depBatch(ctx, 0) ?? []) {
					const request = raw as WorkItemEffectRequested;
					if (!state.settledRequestIds.has(request.requestId))
						state.pendingEffectRequests.set(request.requestId, request);
				}
				for (const raw of depBatch(ctx, 1) ?? []) {
					const fact = raw as WorkItemEffectRunFact;
					if (fact.kind === "effect-run") {
						for (const request of state.pendingEffectRequests.values()) {
							if (request.effectRunId === fact.effectRun.effectRunId) {
								state.pendingEffectRequests.delete(request.requestId);
								state.settledRequestIds.add(request.requestId);
								break;
							}
						}
					} else if (fact.kind === "issue") {
						deletePendingWorkItemEffectRequest(state, fact.issue.refs);
						state.issues.push(fact.issue);
					} else if (fact.kind === "audit") state.audit.push(fact.audit);
				}
				ctx.state.set(state);
				ctx.down([["DATA", freezeWorkItemEffectRequestViews(state)]]);
			},
			{ name: `${name}/views`, factory: "workItemEffectRequestViews" },
		),
	};
}
