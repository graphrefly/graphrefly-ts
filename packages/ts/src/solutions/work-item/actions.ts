/**
 * WorkItem domain action intake, admission, and application facts (D239/D333-D343).
 *
 * This focused solution subpath keeps action mutation data-first: proposals and
 * admissions are visible facts, and application lowers only to append-only
 * WorkItem authoring facts plus status/issue/audit projections. It does not
 * mutate WorkItem projections directly, run executors, claim queues, or install
 * hidden schedulers.
 */

export type {
	WorkItemDomainActionAdmission,
	WorkItemDomainActionAdmissionDecision,
	WorkItemDomainActionAdmissionPolicy,
	WorkItemDomainActionAdmissionViews,
	WorkItemDomainActionProposal,
	WorkItemDomainActionProposalSpec,
} from "../../orchestration/work-item-runtime.js";
export { workItemDomainActionAdmissionProjector } from "../../orchestration/work-item-runtime.js";
export { workItemDomainActionApplicationProjector } from "./actions-application.js";
export {
	workItemDomainActionApplyPolicy,
	workItemDomainActionProposal,
	workItemDomainActionProposalIntake,
} from "./actions-builders.js";
export { workItemDomainActionCapabilityGuardProjector } from "./actions-capability-guard.js";
export { workItemDomainActionProposalIntakeProjector } from "./actions-intake.js";
export type {
	WorkItemDomainActionApplication,
	WorkItemDomainActionApplicationBundle,
	WorkItemDomainActionApplicationOptions,
	WorkItemDomainActionApplyPolicy,
	WorkItemDomainActionCapabilityGuardBundle,
	WorkItemDomainActionCapabilityGuardOptions,
	WorkItemDomainActionCapabilityGuardPolicy,
	WorkItemDomainActionCapabilityGuardStatus,
	WorkItemDomainActionIntakeBundle,
	WorkItemDomainActionIntakeOptions,
	WorkItemDomainActionKind,
	WorkItemDomainActionProposalInput,
	WorkItemDomainActionProposalIntake,
	WorkItemDomainActionStatus,
	WorkItemDomainActionStatusState,
	WorkItemPatchActionPayload,
	WorkItemSpawnActionPayload,
} from "./actions-types.js";
