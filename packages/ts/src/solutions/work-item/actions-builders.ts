import type { WorkItemDomainActionProposal } from "../../orchestration/work-item-runtime.js";
import type {
	WorkItemDomainActionApplyPolicy,
	WorkItemDomainActionKind,
	WorkItemDomainActionProposalIntake,
} from "./actions-types.js";

export function workItemDomainActionProposal(
	proposalId: string,
	workItemId: string,
	actionKind: WorkItemDomainActionKind,
	opts: Omit<
		Partial<WorkItemDomainActionProposal>,
		"kind" | "proposalId" | "workItemId" | "actionKind"
	> = {},
): WorkItemDomainActionProposal {
	return {
		kind: "work-item-domain-action-proposal",
		proposalId,
		workItemId,
		actionKind,
		effectRunId: opts.effectRunId ?? `domain-action:${proposalId}:effect-run`,
		effectRunResultId: opts.effectRunResultId ?? `domain-action:${proposalId}:effect-run-result`,
		evidenceId: opts.evidenceId ?? `domain-action:${proposalId}:evidence`,
		policyId: opts.policyId ?? "domain-action-proposal",
		payload: opts.payload,
		reason: opts.reason,
		sourceRefs: opts.sourceRefs,
		proposedAtMs: opts.proposedAtMs,
		metadata: opts.metadata,
	};
}

export function workItemDomainActionProposalIntake<TPayload = unknown>(
	proposalId: string,
	workItemId: string,
	actionKind: WorkItemDomainActionKind,
	opts: Omit<
		Partial<WorkItemDomainActionProposalIntake<TPayload>>,
		"kind" | "proposalId" | "workItemId" | "actionKind"
	> = {},
): WorkItemDomainActionProposalIntake<TPayload> {
	return {
		kind: "work-item-domain-action-proposal-intake",
		proposalId,
		workItemId,
		actionKind,
		payload: opts.payload,
		reason: opts.reason,
		policyId: opts.policyId,
		effectRunId: opts.effectRunId,
		effectRunResultId: opts.effectRunResultId,
		evidenceId: opts.evidenceId,
		proposedAtMs: opts.proposedAtMs,
		sourceRefs: opts.sourceRefs,
		metadata: opts.metadata,
	};
}

export function workItemDomainActionApplyPolicy(
	policyId: string,
	opts: Omit<Partial<WorkItemDomainActionApplyPolicy>, "kind" | "policyId"> = {},
): WorkItemDomainActionApplyPolicy {
	return {
		kind: "work-item-domain-action-apply-policy",
		policyId,
		actionKinds: opts.actionKinds,
		patch: opts.patch,
		spawn: opts.spawn,
		metadata: opts.metadata,
	};
}
