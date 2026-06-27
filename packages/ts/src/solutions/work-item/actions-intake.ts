import { type Ctx, depBatch } from "../../ctx/types.js";
import type { Graph } from "../../graph/graph.js";
import type { WorkItemDomainActionProposal } from "../../orchestration/work-item-runtime.js";
import { workItemDomainActionProposal } from "./actions-builders.js";
import { auditRecord, dataIssue, isRecord, project, sourceRefs } from "./actions-shared.js";
import type {
	IntakeFact,
	IntakeState,
	WorkItemDomainActionIntakeBundle,
	WorkItemDomainActionIntakeOptions,
	WorkItemDomainActionKind,
	WorkItemDomainActionStatus,
} from "./actions-types.js";

export function workItemDomainActionProposalIntakeProjector(
	graph: Graph,
	opts: WorkItemDomainActionIntakeOptions,
): WorkItemDomainActionIntakeBundle {
	const name = opts.name ?? "workItemDomainActionIntake";
	const now = opts.now ?? Date.now;
	const runtime = graph.node<IntakeFact>(
		[opts.proposals],
		(ctx) => {
			const state = ctx.state.get<IntakeState>() ?? {
				proposals: new Set(),
				statusSeq: 0,
				auditSeq: 0,
			};
			for (const raw of depBatch(ctx, 0) ?? []) reduceProposalIntake(ctx, state, raw, now());
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "workItemDomainActionProposalIntakeProjector",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		proposals: project(
			graph,
			runtime,
			`${name}/proposals`,
			"workItemDomainActionProposals",
			(fact) => (fact.kind === "proposal" ? fact.value : undefined),
		),
		status: project(graph, runtime, `${name}/status`, "workItemDomainActionStatus", (fact) =>
			fact.kind === "status" ? fact.value : undefined,
		),
		issues: project(graph, runtime, `${name}/issues`, "workItemDomainActionIssues", (fact) =>
			fact.kind === "issue" ? fact.value : undefined,
		),
		audit: project(graph, runtime, `${name}/audit`, "workItemDomainActionAudit", (fact) =>
			fact.kind === "audit" ? fact.value : undefined,
		),
	};
}

function reduceProposalIntake(
	ctx: Ctx,
	state: IntakeState,
	input: unknown,
	proposedAtMs: number,
): void {
	const proposal = normalizeProposal(input, proposedAtMs);
	if (typeof proposal === "string") {
		const issue = dataIssue("malformed-domain-action-proposal", proposal);
		emitIntake(ctx, "issue", issue);
		emitIntakeStatus(ctx, state, {
			state: "rejected",
			code: issue.code,
			message: issue.message,
		});
		return;
	}
	if (state.proposals.has(proposal.proposalId)) {
		emitIntakeStatus(ctx, state, {
			state: "duplicate",
			code: "duplicate-suppressed",
			workItemId: proposal.workItemId,
			proposalId: proposal.proposalId,
			actionKind: proposal.actionKind,
			message: `Duplicate WorkItem domain action proposal '${proposal.proposalId}' suppressed`,
		});
		return;
	}
	state.proposals.add(proposal.proposalId);
	emitIntake(ctx, "proposal", proposal);
	emitIntakeStatus(ctx, state, {
		state: "proposed",
		workItemId: proposal.workItemId,
		proposalId: proposal.proposalId,
		actionKind: proposal.actionKind,
		sourceRefs: proposal.sourceRefs,
	});
}

function normalizeProposal(
	input: unknown,
	proposedAtMs: number,
): WorkItemDomainActionProposal | string {
	if (!isRecord(input)) return "WorkItemDomainActionProposal intake must be an object";
	if (
		input.kind !== "work-item-domain-action-proposal" &&
		input.kind !== "work-item-domain-action-proposal-intake"
	)
		return "WorkItemDomainActionProposal intake has unsupported kind";
	if (typeof input.proposalId !== "string" || input.proposalId.trim() === "")
		return "WorkItemDomainActionProposal.proposalId is required";
	if (typeof input.workItemId !== "string" || input.workItemId.trim() === "")
		return "WorkItemDomainActionProposal.workItemId is required";
	if (typeof input.actionKind !== "string" || input.actionKind.trim() === "")
		return "WorkItemDomainActionProposal.actionKind is required";
	if (input.kind === "work-item-domain-action-proposal") {
		if (typeof input.effectRunId !== "string")
			return "WorkItemDomainActionProposal.effectRunId is required";
		if (typeof input.effectRunResultId !== "string")
			return "WorkItemDomainActionProposal.effectRunResultId is required";
		if (typeof input.evidenceId !== "string")
			return "WorkItemDomainActionProposal.evidenceId is required";
		if (typeof input.policyId !== "string")
			return "WorkItemDomainActionProposal.policyId is required";
		return input as unknown as WorkItemDomainActionProposal;
	}
	return workItemDomainActionProposal(
		input.proposalId,
		input.workItemId,
		input.actionKind as WorkItemDomainActionKind,
		{
			payload: input.payload,
			reason: typeof input.reason === "string" ? input.reason : undefined,
			policyId: typeof input.policyId === "string" ? input.policyId : undefined,
			effectRunId: typeof input.effectRunId === "string" ? input.effectRunId : undefined,
			effectRunResultId:
				typeof input.effectRunResultId === "string" ? input.effectRunResultId : undefined,
			evidenceId: typeof input.evidenceId === "string" ? input.evidenceId : undefined,
			proposedAtMs: typeof input.proposedAtMs === "number" ? input.proposedAtMs : proposedAtMs,
			sourceRefs: sourceRefs(input.sourceRefs),
			metadata: isRecord(input.metadata) ? input.metadata : undefined,
		},
	);
}

function emitIntakeStatus(
	ctx: Ctx,
	state: IntakeState,
	status: Omit<WorkItemDomainActionStatus, "kind" | "statusId">,
): void {
	state.statusSeq += 1;
	const statusFact = {
		kind: "work-item-domain-action-status",
		statusId: `work-item-domain-action-intake-status:${state.statusSeq}`,
		...status,
	} satisfies WorkItemDomainActionStatus;
	emitIntake(ctx, "status", statusFact);
	emitIntakeAudit(ctx, state, "work-item-domain-action-intake-status", statusFact);
}

function emitIntakeAudit(
	ctx: Ctx,
	state: IntakeState,
	kind: string,
	status: WorkItemDomainActionStatus,
): void {
	state.auditSeq += 1;
	emitIntake(ctx, "audit", auditRecord(kind, state.auditSeq, status));
}

function emitIntake<K extends IntakeFact["kind"]>(
	ctx: Ctx,
	kind: K,
	value: Extract<IntakeFact, { kind: K }>["value"],
): void {
	ctx.down([["DATA", { kind, value } as IntakeFact]]);
}
