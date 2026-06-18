import type { DataIssue } from "@graphrefly/ts";
import type { Node } from "@graphrefly/ts/core";
import { depBatch } from "@graphrefly/ts/core";
import { graph } from "@graphrefly/ts/graph";
import {
	type AgentRequestFact,
	type AgentRequestIssued,
	type AgentRequestStatus,
	type AgentRequestStatusChanged,
	type AgentRuntimeAuditRecord,
	attachToolProviderAdapterRuntime,
	type EffectRunResult,
	type ExecutorOutcome,
	type ExecutorRoute,
	effectRunCompletionProjector,
	localBuiltinToolProviderCatalog,
	requestToolProviderAdapterRun,
	resolveToolProviderExecutionPolicies,
	type SourceRef,
	type ToolProviderAdapterBinding,
	type ToolProviderAdapterInput,
	type ToolProviderAdapterRunRequested,
	type ToolProviderAdapterRunResult,
	type ToolProviderAdapterRunStatus,
	type ToolProviderAdapterRuntimeStatus,
	toolProviderAdapterInputProjector,
	type WorkItemDomainActionAdmission,
	type WorkItemDomainActionAdmissionDecision,
	type WorkItemDomainActionAdmissionPolicy,
	type WorkItemEffectMappingPolicy,
	type WorkItemEffectRequested,
	type WorkItemEvidenceRecorded,
	type WorkItemSeed,
	workItemDomainActionAdmissionProjector,
	workItemEffectResultMapper,
	workItemEffectRunProjector,
} from "@graphrefly/ts/orchestration";
import {
	type WorkItemDomainActionApplication,
	type WorkItemDomainActionApplyPolicy,
	type WorkItemDomainActionProposal,
	type WorkItemDomainActionProposalIntake,
	workItemDomainActionApplicationProjector,
	workItemDomainActionApplyPolicy,
	workItemDomainActionProposalIntakeProjector,
} from "@graphrefly/ts/solutions/work-item/actions";
import type { WorkItemProjection } from "@graphrefly/ts/solutions/work-item/scheduling";

type Lane = "queued" | "running" | "blocked" | "complete";
type EffectStatus = "none" | "pending" | "ready" | "running" | "completed" | "failed" | "blocked";

export interface CanvasWorkItemNode {
	readonly id: string;
	readonly label: string;
	readonly summary: string;
	readonly lane: Lane;
	readonly progress: number;
	readonly effectStatus: EffectStatus;
	readonly evidenceCount: number;
	readonly issueCount: number;
	readonly actionCount: number;
	readonly x: number;
	readonly y: number;
}

export interface CanvasDependencyEdge {
	readonly from: string;
	readonly to: string;
	readonly label: string;
	readonly blocked: boolean;
}

export interface CanvasEffectPlanCard {
	readonly workItemId: string;
	readonly planId: string;
	readonly effectRunId: string;
	readonly status: EffectStatus;
	readonly requestId?: string;
	readonly runId?: string;
	readonly attempt?: number;
	readonly summary: string;
}

export interface CanvasToolRunCard {
	readonly runId: string;
	readonly workItemId?: string;
	readonly requestId?: string;
	readonly status: ToolProviderAdapterRunStatus["status"];
	readonly attempt?: number;
	readonly outcomeId?: string;
	readonly issueCount: number;
}

export interface CanvasAuditCard {
	readonly id: string;
	readonly kind: string;
	readonly subjectId?: string;
	readonly issueCode?: string;
}

export interface CanvasEvidenceCard {
	readonly evidenceId: string;
	readonly workItemId: string;
	readonly effectRunId: string;
	readonly status: EffectRunResult["status"];
	readonly summary?: string;
	readonly issueCode?: string;
}

export interface CanvasIssueCard {
	readonly code: string;
	readonly message: string;
	readonly severity?: DataIssue["severity"];
	readonly subjectId?: string;
}

export interface CanvasViewModel {
	readonly selectedWorkItemId: string;
	readonly nodes: readonly CanvasWorkItemNode[];
	readonly edges: readonly CanvasDependencyEdge[];
	readonly effectPlans: readonly CanvasEffectPlanCard[];
	readonly toolRuns: readonly CanvasToolRunCard[];
	readonly evidence: readonly CanvasEvidenceCard[];
	readonly issues: readonly CanvasIssueCard[];
	readonly audit: readonly CanvasAuditCard[];
	readonly actions: readonly {
		readonly proposalId: string;
		readonly workItemId: string;
		readonly actionKind: string;
		readonly state: string;
	}[];
	readonly counters: {
		readonly workItems: number;
		readonly dependencies: number;
		readonly readyInputs: number;
		readonly outcomes: number;
		readonly evidence: number;
		readonly issues: number;
	};
}

export interface CanvasDogfoodRuntime {
	readonly view: Node<CanvasViewModel>;
	readonly dispose: () => void;
	readonly selectWorkItem: (workItemId: string) => void;
	readonly runSelectedEffect: () => void;
	readonly proposeReviewAction: () => void;
	readonly approveLatestProposal: () => void;
}

interface WorkItemDependencyFact {
	readonly kind: "work-item-dependency";
	readonly fromWorkItemId: string;
	readonly toWorkItemId: string;
	readonly label: string;
}

interface CanvasSelectionFact {
	readonly kind: "canvas-selection";
	readonly workItemId: string;
}

const NOW = 1_000;
const PROVIDER_ID = "canvas-fake-provider";
const EFFECT_KIND = "canvas-dogfood-tool";
const DEFAULT_SELECTED = "wi-board-query";

const workItemDefinitions = [
	{
		id: "wi-csp8-spine",
		label: "CSP-8 evidence spine",
		summary: "Effect request, agent request, adapter input, run result, evidence mapping.",
		lane: "complete" as const,
		progress: 100,
		x: 120,
		y: 80,
	},
	{
		id: "wi-provider-success",
		label: "Provider-neutral success",
		summary: "Fake bounded provider result becomes ExecutorOutcome and WorkItem evidence.",
		lane: "complete" as const,
		progress: 100,
		x: 360,
		y: 110,
	},
	{
		id: "wi-policy-failure",
		label: "Policy issue path",
		summary: "Failure carries bounded DataIssue/audit, with no raw provider payload.",
		lane: "blocked" as const,
		progress: 52,
		x: 600,
		y: 90,
	},
	{
		id: "wi-human-approval",
		label: "Approval blocked run",
		summary: "Blocked tool run exposes needs and audit without mutating WorkItems.",
		lane: "blocked" as const,
		progress: 38,
		x: 520,
		y: 260,
	},
	{
		id: "wi-board-query",
		label: "Canvas board query",
		summary: "Ready adapter input waits for a visible run request from the UI.",
		lane: "running" as const,
		progress: 64,
		x: 285,
		y: 300,
	},
	{
		id: "wi-domain-action",
		label: "Domain action proposal",
		summary: "User proposal and approval are graph-visible WorkItem action facts.",
		lane: "queued" as const,
		progress: 22,
		x: 90,
		y: 260,
	},
] as const;

const dependencyFacts: readonly WorkItemDependencyFact[] = [
	dependency("wi-csp8-spine", "wi-provider-success", "feeds"),
	dependency("wi-csp8-spine", "wi-policy-failure", "shares policy"),
	dependency("wi-provider-success", "wi-board-query", "unblocks UI"),
	dependency("wi-policy-failure", "wi-human-approval", "requires review"),
	dependency("wi-board-query", "wi-domain-action", "drives action"),
	dependency("wi-human-approval", "wi-domain-action", "needs approval"),
];

export const EMPTY_CANVAS_VIEW: CanvasViewModel = Object.freeze({
	selectedWorkItemId: DEFAULT_SELECTED,
	nodes: [],
	edges: [],
	effectPlans: [],
	toolRuns: [],
	evidence: [],
	issues: [],
	audit: [],
	actions: [],
	counters: {
		workItems: 0,
		dependencies: 0,
		readyInputs: 0,
		outcomes: 0,
		evidence: 0,
		issues: 0,
	},
});

export function createCanvasDogfoodRuntime(): CanvasDogfoodRuntime {
	const g = graph({ name: "graphrefly-canvas-dogfood" });
	const workItems = g.node<WorkItemSeed>([], null, { name: "canvas/workItems" });
	const workItemProjections = g.node<WorkItemProjection>([], null, {
		name: "canvas/workItemProjections",
	});
	const dependencies = g.node<WorkItemDependencyFact>([], null, {
		name: "canvas/dependencies",
	});
	const selection = g.node<CanvasSelectionFact>([], null, { name: "canvas/selection" });
	const effectRequests = g.node<WorkItemEffectRequested>([], null, {
		name: "canvas/effectRequests",
	});
	const requestFacts = g.node<AgentRequestFact>([], null, { name: "canvas/agentRequests" });
	const routes = g.node<ExecutorRoute>([], null, { name: "canvas/executorRoutes" });
	const catalogs = g.node<ReturnType<typeof localBuiltinToolProviderCatalog>>([], null, {
		name: "canvas/toolCatalogs",
	});
	const resolutions = g.node<ReturnType<typeof resolveToolProviderExecutionPolicies>[number]>(
		[],
		null,
		{ name: "canvas/policyResolutions" },
	);
	const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
		name: "canvas/runRequests",
	});
	const mappingPolicies = g.node<WorkItemEffectMappingPolicy>([], null, {
		name: "canvas/mappingPolicies",
	});
	const domainActionInputs = g.node<WorkItemDomainActionProposalIntake>([], null, {
		name: "canvas/domainActionInputs",
	});
	const domainActionDecisions = g.node<WorkItemDomainActionAdmissionDecision>([], null, {
		name: "canvas/domainActionDecisions",
	});
	const domainActionPolicies = g.node<WorkItemDomainActionAdmissionPolicy>([], null, {
		name: "canvas/domainActionAdmissionPolicies",
	});
	const applyPolicies = g.node<WorkItemDomainActionApplyPolicy>([], null, {
		name: "canvas/domainActionApplyPolicies",
	});

	const effectRuns = workItemEffectRunProjector(g, { workItems, effectRequests });
	const adapterInputs = toolProviderAdapterInputProjector(g, {
		requestFacts,
		executorRoutes: [routes],
		toolProviderCatalogs: [catalogs],
		policyResolutions: [resolutions],
	});
	const runtime = attachToolProviderAdapterRuntime(g, {
		name: "canvasToolProviderAdapterRuntime",
		inputs: adapterInputs.inputs,
		runRequests: [runRequests],
		autoRunReadyInputs: false,
		bindings: [fakeCanvasToolBinding()],
		publicText: {
			maxMessageChars: 180,
			maxSummaryChars: 220,
			maxMetadataStringChars: 80,
		},
		retention: {
			runStatuses: { order: "fifo", maxSize: 48 },
			runIssues: { order: "fifo", maxSize: 32 },
			retentionEvidence: { order: "fifo", maxSize: 64 },
		},
		now: () => NOW,
	});
	const resultCandidates = visibleOutcomeResultCandidates(g, {
		outcomes: runtime.outcomes,
		requestStatus: runtime.status,
		issues: runtime.issues,
		audit: runtime.audit,
	});
	const completion = effectRunCompletionProjector(g, {
		effectRuns: effectRuns.effectRuns,
		requestFacts: [requestFacts],
		requestStatuses: [runtime.status],
		resultCandidates: [resultCandidates.candidates],
		now: () => NOW + 1,
	});
	const evidenceMapper = workItemEffectResultMapper(g, {
		workItems,
		effectRuns: effectRuns.effectRuns,
		effectRunResults: completion.results,
		effectRequests,
		mappingPolicies: [mappingPolicies],
		now: () => NOW + 2,
	});
	const domainActionIntake = workItemDomainActionProposalIntakeProjector(g, {
		name: "canvasDomainActionIntake",
		proposals: domainActionInputs,
		now: () => NOW + 3,
	});
	const domainActionAdmissions = workItemDomainActionAdmissionProjector(g, {
		name: "canvasDomainActionAdmissions",
		proposals: domainActionIntake.proposals,
		decisions: domainActionDecisions,
		admissionPolicies: [domainActionPolicies],
		now: () => NOW + 4,
	});
	const domainActionApplications = workItemDomainActionApplicationProjector(g, {
		name: "canvasDomainActionApplications",
		proposals: domainActionIntake.proposals,
		admissions: domainActionAdmissions.admissions,
		workItems: workItemProjections,
		applyPolicies,
	});

	const latestInputsByWorkItem = new Map<string, ToolProviderAdapterInput>();
	const latestProposalsByWorkItem = new Map<string, WorkItemDomainActionProposal>();
	const admittedProposalIds = new Set<string>();
	const activeRunNumbersByWorkItem = new Map<string, number>();

	const view = createCanvasViewModel(g, {
		workItems,
		workItemProjections,
		dependencies,
		selection,
		effectRequests,
		adapterInputs: adapterInputs.inputs,
		runStatus: runtime.runStatus,
		requestStatus: runtime.status,
		runtimeStatus: runtime.runtimeStatus,
		outcomes: runtime.outcomes,
		effectResults: completion.results,
		effectStatus: completion.status,
		evidence: evidenceMapper.evidence,
		issues: [
			adapterInputs.issues,
			runtime.issues,
			completion.issues,
			evidenceMapper.issues,
			domainActionIntake.issues,
			domainActionAdmissions.issues,
			domainActionApplications.issues,
		],
		audit: [
			effectRuns.audit,
			adapterInputs.audit,
			runtime.audit,
			completion.audit,
			evidenceMapper.audit,
			domainActionIntake.audit,
			domainActionAdmissions.audit,
			domainActionApplications.audit,
		],
		actionProposals: domainActionIntake.proposals,
		actionAdmissions: domainActionAdmissions.admissions,
		actionApplications: domainActionApplications.applications,
		actionStatus: domainActionApplications.status,
	});
	const disposers = [
		view.subscribe(() => {}),
		adapterInputs.inputs.subscribe((msg) => {
			if (msg[0] !== "DATA") return;
			const input = msg[1] as ToolProviderAdapterInput;
			const workItemId = workItemIdFromRefs([
				...(input.input?.subjectRefs ?? []),
				...(input.sourceRefs ?? []),
			]);
			if (workItemId !== undefined && input.status === "ready")
				latestInputsByWorkItem.set(workItemId, input);
		}),
		domainActionIntake.proposals.subscribe((msg) => {
			if (msg[0] !== "DATA") return;
			const proposal = msg[1] as WorkItemDomainActionProposal;
			latestProposalsByWorkItem.set(proposal.workItemId, proposal);
		}),
		domainActionAdmissions.admissions.subscribe((msg) => {
			if (msg[0] !== "DATA") return;
			const admission = msg[1] as WorkItemDomainActionAdmission;
			admittedProposalIds.add(admission.proposalId);
		}),
	];

	seedScenario({
		workItems,
		workItemProjections,
		dependencies,
		selection,
		effectRequests,
		requestFacts,
		routes,
		catalogs,
		resolutions,
		runRequests,
		mappingPolicies,
		domainActionInputs,
		domainActionDecisions,
		domainActionPolicies,
		applyPolicies,
		latestInputsByWorkItem,
	});

	function selectedWorkItemId(): string {
		return (view.cache as CanvasViewModel | undefined)?.selectedWorkItemId ?? DEFAULT_SELECTED;
	}

	return {
		view,
		selectWorkItem(workItemId) {
			selection.down([["DATA", { kind: "canvas-selection", workItemId }]]);
		},
		runSelectedEffect() {
			const workItemId = selectedWorkItemId();
			const input = latestInputsByWorkItem.get(workItemId);
			if (input === undefined) return;
			const next = (activeRunNumbersByWorkItem.get(workItemId) ?? 0) + 1;
			activeRunNumbersByWorkItem.set(workItemId, next);
			runRequests.down([
				[
					"DATA",
					requestToolProviderAdapterRun(input, {
						runId: `${workItemId}:manual-run:${next}`,
						attempt: next,
						reason: next === 1 ? "manual" : "retry",
						sourceRefs: [ref("canvas-command", `run:${workItemId}:${next}`)],
						metadata: { command: "run-selected-effect", workItemId },
						requestedAtMs: NOW + 10 + next,
					}),
				],
			]);
		},
		proposeReviewAction() {
			const workItemId = selectedWorkItemId();
			const count = (latestProposalsByWorkItem.get(workItemId) === undefined ? 0 : 1) + 1;
			domainActionInputs.down([
				[
					"DATA",
					{
						kind: "work-item-domain-action-proposal-intake",
						proposalId: `${workItemId}:review-proposal:${Date.now()}:${count}`,
						workItemId,
						actionKind: "require-review",
						reason: "Canvas user requested visible review action",
						sourceRefs: [ref("canvas-command", `propose-review:${workItemId}`)],
						metadata: { command: "propose-review", bounded: true },
					},
				],
			]);
		},
		approveLatestProposal() {
			const workItemId = selectedWorkItemId();
			const proposal = latestProposalsByWorkItem.get(workItemId);
			if (proposal === undefined || admittedProposalIds.has(proposal.proposalId)) return;
			domainActionDecisions.down([
				[
					"DATA",
					{
						kind: "work-item-domain-action-admission-decision",
						decisionId: `${proposal.proposalId}:decision`,
						admissionId: `${proposal.proposalId}:admission`,
						proposalId: proposal.proposalId,
						outcome: "admit",
						policyId: "canvas-domain-actions",
						reason: "Canvas user approved graph-visible domain action",
						sourceRefs: [
							ref("work-item-domain-action-proposal", proposal.proposalId),
							ref("canvas-command", `approve:${proposal.proposalId}`),
						],
						decidedAtMs: NOW + 20,
					},
				],
			]);
		},
		dispose() {
			for (const dispose of disposers.splice(0)) dispose();
			runtime.dispose();
		},
	};
}

function createCanvasViewModel(
	g: ReturnType<typeof graph>,
	nodes: {
		readonly workItems: Node<WorkItemSeed>;
		readonly workItemProjections: Node<WorkItemProjection>;
		readonly dependencies: Node<WorkItemDependencyFact>;
		readonly selection: Node<CanvasSelectionFact>;
		readonly effectRequests: Node<WorkItemEffectRequested>;
		readonly adapterInputs: Node<ToolProviderAdapterInput>;
		readonly runStatus: Node<ToolProviderAdapterRunStatus>;
		readonly requestStatus: Node<AgentRequestStatusChanged>;
		readonly runtimeStatus: Node<ToolProviderAdapterRuntimeStatus>;
		readonly outcomes: Node<ExecutorOutcome>;
		readonly effectResults: Node<EffectRunResult>;
		readonly effectStatus: Node<{ readonly effectRunId: string; readonly state: string }>;
		readonly evidence: Node<WorkItemEvidenceRecorded>;
		readonly issues: readonly Node<DataIssue>[];
		readonly audit: readonly Node<AgentRuntimeAuditRecord>[];
		readonly actionProposals: Node<WorkItemDomainActionProposal>;
		readonly actionAdmissions: Node<WorkItemDomainActionAdmission>;
		readonly actionApplications: Node<WorkItemDomainActionApplication>;
		readonly actionStatus: Node<{ readonly workItemId?: string; readonly state: string }>;
	},
): Node<CanvasViewModel> {
	const issueStart = 13;
	const auditStart = issueStart + nodes.issues.length;
	const deps = [
		nodes.workItems,
		nodes.workItemProjections,
		nodes.dependencies,
		nodes.selection,
		nodes.effectRequests,
		nodes.adapterInputs,
		nodes.runStatus,
		nodes.requestStatus,
		nodes.runtimeStatus,
		nodes.outcomes,
		nodes.effectResults,
		nodes.effectStatus,
		nodes.evidence,
		...nodes.issues,
		...nodes.audit,
		nodes.actionProposals,
		nodes.actionAdmissions,
		nodes.actionApplications,
		nodes.actionStatus,
	];
	const actionProposalIndex = auditStart + nodes.audit.length;
	const actionAdmissionIndex = actionProposalIndex + 1;
	const actionApplicationIndex = actionAdmissionIndex + 1;
	const actionStatusIndex = actionApplicationIndex + 1;

	return g.node<CanvasViewModel>(
		deps,
		(ctx) => {
			const state = ctx.state.get<CanvasViewState>() ?? emptyCanvasViewState();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const item = raw as WorkItemSeed;
				state.workItems.set(item.workItemId, item);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const item = raw as WorkItemProjection;
				state.projections.set(item.workItemId, item);
			}
			for (const raw of depBatch(ctx, 2) ?? []) {
				const dependencyFact = raw as WorkItemDependencyFact;
				state.dependencies.set(
					`${dependencyFact.fromWorkItemId}->${dependencyFact.toWorkItemId}`,
					dependencyFact,
				);
			}
			for (const raw of depBatch(ctx, 3) ?? []) {
				state.selectedWorkItemId = (raw as CanvasSelectionFact).workItemId;
			}
			for (const raw of depBatch(ctx, 4) ?? []) {
				const request = raw as WorkItemEffectRequested;
				state.effectRequests.set(request.workItemId, request);
				state.workItemByEffectRun.set(request.effectRunId, request.workItemId);
			}
			for (const raw of depBatch(ctx, 5) ?? []) {
				const input = raw as ToolProviderAdapterInput;
				state.adapterInputs.set(input.adapterInputId, input);
				const workItemId = workItemIdFromRefs([
					...(input.input?.subjectRefs ?? []),
					...(input.sourceRefs ?? []),
				]);
				if (workItemId !== undefined) state.adapterInputByWorkItem.set(workItemId, input);
			}
			for (const raw of depBatch(ctx, 6) ?? []) {
				const status = raw as ToolProviderAdapterRunStatus;
				state.runStatuses.set(status.runId, status);
			}
			for (const raw of depBatch(ctx, 7) ?? []) {
				const status = raw as AgentRequestStatusChanged;
				state.requestStatuses.set(status.requestId, status);
			}
			for (const raw of depBatch(ctx, 8) ?? []) {
				const status = raw as ToolProviderAdapterRuntimeStatus;
				state.runtimeStatuses.set(
					`${status.status}:${status.key ?? state.runtimeStatuses.size}`,
					status,
				);
			}
			for (const raw of depBatch(ctx, 9) ?? []) {
				const outcome = raw as ExecutorOutcome;
				state.outcomes.set(outcome.outcomeId, outcome);
			}
			for (const raw of depBatch(ctx, 10) ?? []) {
				const result = raw as EffectRunResult;
				state.effectResults.set(result.effectRunId, result);
			}
			for (const raw of depBatch(ctx, 11) ?? []) {
				const status = raw as { readonly effectRunId: string; readonly state: string };
				state.effectStatus.set(status.effectRunId, status.state);
			}
			for (const raw of depBatch(ctx, 12) ?? []) {
				const evidence = raw as WorkItemEvidenceRecorded;
				const list = state.evidenceByWorkItem.get(evidence.workItemId) ?? [];
				list.push(evidence);
				state.evidenceByWorkItem.set(evidence.workItemId, list);
				state.evidenceByEffectRun.set(evidence.effectRunId, evidence);
			}
			for (let index = 0; index < nodes.issues.length; index += 1) {
				for (const raw of depBatch(ctx, issueStart + index) ?? []) {
					const issue = raw as DataIssue;
					state.issues.set(`${issue.code}:${issue.subjectId ?? ""}:${issue.message}`, issue);
				}
			}
			for (let index = 0; index < nodes.audit.length; index += 1) {
				for (const raw of depBatch(ctx, auditStart + index) ?? []) {
					const audit = raw as AgentRuntimeAuditRecord;
					state.audit.set(audit.id, audit);
				}
			}
			for (const raw of depBatch(ctx, actionProposalIndex) ?? []) {
				const proposal = raw as WorkItemDomainActionProposal;
				state.actionProposals.set(proposal.proposalId, proposal);
			}
			for (const raw of depBatch(ctx, actionAdmissionIndex) ?? []) {
				const admission = raw as WorkItemDomainActionAdmission;
				state.actionAdmissions.set(admission.proposalId, admission);
			}
			for (const raw of depBatch(ctx, actionApplicationIndex) ?? []) {
				const application = raw as WorkItemDomainActionApplication;
				state.actionApplications.set(application.proposalId, application);
			}
			for (const raw of depBatch(ctx, actionStatusIndex) ?? []) {
				const status = raw as { readonly workItemId?: string; readonly state: string };
				if (status.workItemId !== undefined) {
					const count = state.actionStatusCounts.get(status.workItemId) ?? 0;
					state.actionStatusCounts.set(status.workItemId, count + 1);
				}
			}
			ctx.state.set(state);
			ctx.down([["DATA", freezeCanvasView(state)]]);
		},
		{ name: "canvas/view", factory: "canvasDogfoodViewModel", partial: true },
	);
}

interface CanvasViewState {
	workItems: Map<string, WorkItemSeed>;
	projections: Map<string, WorkItemProjection>;
	dependencies: Map<string, WorkItemDependencyFact>;
	selectedWorkItemId: string;
	effectRequests: Map<string, WorkItemEffectRequested>;
	workItemByEffectRun: Map<string, string>;
	adapterInputs: Map<string, ToolProviderAdapterInput>;
	adapterInputByWorkItem: Map<string, ToolProviderAdapterInput>;
	runStatuses: Map<string, ToolProviderAdapterRunStatus>;
	requestStatuses: Map<string, AgentRequestStatusChanged>;
	runtimeStatuses: Map<string, ToolProviderAdapterRuntimeStatus>;
	outcomes: Map<string, ExecutorOutcome>;
	effectResults: Map<string, EffectRunResult>;
	effectStatus: Map<string, string>;
	evidenceByWorkItem: Map<string, WorkItemEvidenceRecorded[]>;
	evidenceByEffectRun: Map<string, WorkItemEvidenceRecorded>;
	issues: Map<string, DataIssue>;
	audit: Map<string, AgentRuntimeAuditRecord>;
	actionProposals: Map<string, WorkItemDomainActionProposal>;
	actionAdmissions: Map<string, WorkItemDomainActionAdmission>;
	actionApplications: Map<string, WorkItemDomainActionApplication>;
	actionStatusCounts: Map<string, number>;
}

function emptyCanvasViewState(): CanvasViewState {
	return {
		workItems: new Map(),
		projections: new Map(),
		dependencies: new Map(),
		selectedWorkItemId: DEFAULT_SELECTED,
		effectRequests: new Map(),
		workItemByEffectRun: new Map(),
		adapterInputs: new Map(),
		adapterInputByWorkItem: new Map(),
		runStatuses: new Map(),
		requestStatuses: new Map(),
		runtimeStatuses: new Map(),
		outcomes: new Map(),
		effectResults: new Map(),
		effectStatus: new Map(),
		evidenceByWorkItem: new Map(),
		evidenceByEffectRun: new Map(),
		issues: new Map(),
		audit: new Map(),
		actionProposals: new Map(),
		actionAdmissions: new Map(),
		actionApplications: new Map(),
		actionStatusCounts: new Map(),
	};
}

function freezeCanvasView(state: CanvasViewState): CanvasViewModel {
	const issues = Array.from(state.issues.values()).map(issueCard);
	const nodes = workItemDefinitions.map((definition) => {
		const evidence = state.evidenceByWorkItem.get(definition.id) ?? [];
		const effectRequest = state.effectRequests.get(definition.id);
		const effectStatus =
			effectRequest === undefined
				? "none"
				: statusForEffectRun(state, effectRequest.effectRunId, definition.id);
		const itemIssues = issues.filter((issue) => issue.subjectId === definition.id);
		const actions = Array.from(state.actionProposals.values()).filter(
			(proposal) => proposal.workItemId === definition.id,
		);
		return {
			id: definition.id,
			label: definition.label,
			summary: state.projections.get(definition.id)?.summary ?? definition.summary,
			lane: laneFromStatus(definition.lane, effectStatus),
			progress: progressFor(definition.progress, effectStatus, evidence.length),
			effectStatus,
			evidenceCount: evidence.length,
			issueCount: itemIssues.length,
			actionCount: actions.length + (state.actionStatusCounts.get(definition.id) ?? 0),
			x: definition.x,
			y: definition.y,
		};
	});
	const edges = Array.from(state.dependencies.values()).map((edge) => {
		const toNode = nodes.find((node) => node.id === edge.toWorkItemId);
		return {
			from: edge.fromWorkItemId,
			to: edge.toWorkItemId,
			label: edge.label,
			blocked: toNode?.lane === "blocked",
		};
	});
	const effectPlans = Array.from(state.effectRequests.values()).map((request) => {
		const status = statusForEffectRun(state, request.effectRunId, request.workItemId);
		const input = state.adapterInputByWorkItem.get(request.workItemId);
		const runStatus = Array.from(state.runStatuses.values())
			.reverse()
			.find((item) => item.adapterInputId === input?.adapterInputId);
		return {
			workItemId: request.workItemId,
			planId: request.planId ?? "unplanned",
			effectRunId: request.effectRunId,
			status,
			requestId: request.requestId,
			runId: runStatus?.runId,
			attempt: runStatus?.attempt,
			summary: request.goal.summary ?? request.effectKind,
		};
	});
	const toolRuns = Array.from(state.runStatuses.values()).map((status) => {
		const input = state.adapterInputs.get(status.adapterInputId);
		const workItemId = input
			? workItemIdFromRefs([...(input.input?.subjectRefs ?? []), ...(input.sourceRefs ?? [])])
			: undefined;
		const outcome = Array.from(state.outcomes.values()).find(
			(item) => runtimeRunId(item) === status.runId,
		);
		return {
			runId: status.runId,
			workItemId,
			requestId: status.requestId,
			status: outcome?.kind ?? status.status,
			attempt: status.attempt,
			outcomeId: status.outcomeId ?? outcome?.outcomeId,
			issueCount: (status.issues?.length ?? 0) + (outcome?.issues?.length ?? 0),
		};
	});
	const actions = Array.from(state.actionProposals.values()).map((proposal) => {
		const admission = state.actionAdmissions.get(proposal.proposalId);
		const application = state.actionApplications.get(proposal.proposalId);
		return {
			proposalId: proposal.proposalId,
			workItemId: proposal.workItemId,
			actionKind: proposal.actionKind,
			state: application?.state ?? admission?.state ?? "proposed",
		};
	});
	return {
		selectedWorkItemId: state.selectedWorkItemId,
		nodes,
		edges,
		effectPlans,
		toolRuns,
		evidence: Array.from(state.evidenceByWorkItem.values()).flat().map(evidenceCard),
		issues,
		audit: Array.from(state.audit.values()).map((audit) => ({
			id: audit.id,
			kind: audit.kind,
			subjectId: audit.subjectId,
			issueCode: audit.issueCode,
		})),
		actions,
		counters: {
			workItems: nodes.length,
			dependencies: edges.length,
			readyInputs: Array.from(state.adapterInputs.values()).filter(
				(input) => input.status === "ready",
			).length,
			outcomes: state.outcomes.size,
			evidence: Array.from(state.evidenceByWorkItem.values()).flat().length,
			issues: issues.length,
		},
	};
}

function seedScenario(opts: {
	readonly workItems: Node<WorkItemSeed>;
	readonly workItemProjections: Node<WorkItemProjection>;
	readonly dependencies: Node<WorkItemDependencyFact>;
	readonly selection: Node<CanvasSelectionFact>;
	readonly effectRequests: Node<WorkItemEffectRequested>;
	readonly requestFacts: Node<AgentRequestFact>;
	readonly routes: Node<ExecutorRoute>;
	readonly catalogs: Node<ReturnType<typeof localBuiltinToolProviderCatalog>>;
	readonly resolutions: Node<ReturnType<typeof resolveToolProviderExecutionPolicies>[number]>;
	readonly runRequests: Node<ToolProviderAdapterRunRequested>;
	readonly mappingPolicies: Node<WorkItemEffectMappingPolicy>;
	readonly domainActionInputs: Node<WorkItemDomainActionProposalIntake>;
	readonly domainActionDecisions: Node<WorkItemDomainActionAdmissionDecision>;
	readonly domainActionPolicies: Node<WorkItemDomainActionAdmissionPolicy>;
	readonly applyPolicies: Node<WorkItemDomainActionApplyPolicy>;
	readonly latestInputsByWorkItem: Map<string, ToolProviderAdapterInput>;
}): void {
	opts.mappingPolicies.down([
		[
			"DATA",
			{
				kind: "work-item-effect-mapping-policy",
				policyId: "canvas-evidence-policy",
				effectKinds: [EFFECT_KIND],
				evidence: { behavior: "record" },
			},
		],
	]);
	opts.domainActionPolicies.down([
		[
			"DATA",
			{
				kind: "work-item-domain-action-admission-policy",
				policyId: "canvas-domain-actions",
				actionKinds: ["require-review"],
				allowedOutcomes: ["admit", "reject", "defer"],
			},
		],
	]);
	opts.applyPolicies.down([
		[
			"DATA",
			workItemDomainActionApplyPolicy("canvas-apply-policy", {
				actionKinds: ["require-review"],
				metadata: { scope: "demo-private" },
			}),
		],
	]);
	for (const item of workItemDefinitions) {
		opts.workItems.down([["DATA", workItemSeed(item)]]);
		opts.workItemProjections.down([["DATA", workItemProjection(item)]]);
	}
	for (const edge of dependencyFacts) opts.dependencies.down([["DATA", edge]]);
	opts.selection.down([["DATA", { kind: "canvas-selection", workItemId: DEFAULT_SELECTED }]]);

	const catalog = localBuiltinToolProviderCatalog({ providerId: PROVIDER_ID });
	opts.catalogs.down([["DATA", catalog]]);
	for (const item of workItemDefinitions.slice(1, 5)) {
		const request = agentToolRequest(item.id);
		const effectRequest = workItemEffectRequest(item.id);
		const profile = catalog.profiles[0];
		if (profile === undefined) throw new Error("expected local builtin profile");
		const route = routeFor(request, profile);
		const [resolution] = resolveToolProviderExecutionPolicies({
			request,
			routes: [route],
			catalogs: [catalog],
		});
		if (resolution === undefined) throw new Error("expected policy resolution");
		opts.effectRequests.down([["DATA", effectRequest]]);
		opts.requestFacts.down([["DATA", request]]);
		opts.routes.down([["DATA", route]]);
		opts.resolutions.down([["DATA", resolution]]);
		const input = opts.latestInputsByWorkItem.get(item.id);
		if (input !== undefined && item.id !== DEFAULT_SELECTED) {
			opts.runRequests.down([
				[
					"DATA",
					requestToolProviderAdapterRun(input, {
						runId: `${item.id}:seed-run:1`,
						attempt: 1,
						reason: "initial",
						sourceRefs: [ref("seed", item.id)],
						requestedAtMs: NOW + 5,
					}),
				],
			]);
		}
	}
	const seededProposalId = "wi-domain-action:seed-review-proposal";
	opts.domainActionInputs.down([
		[
			"DATA",
			{
				kind: "work-item-domain-action-proposal-intake",
				proposalId: seededProposalId,
				workItemId: "wi-domain-action",
				actionKind: "require-review",
				reason: "Seeded graph-visible Canvas review action",
				sourceRefs: [ref("seed", seededProposalId)],
				metadata: { bounded: true },
			},
		],
	]);
	opts.domainActionDecisions.down([
		[
			"DATA",
			{
				kind: "work-item-domain-action-admission-decision",
				decisionId: `${seededProposalId}:decision`,
				admissionId: `${seededProposalId}:admission`,
				proposalId: seededProposalId,
				outcome: "admit",
				policyId: "canvas-domain-actions",
				reason: "Seeded Canvas action admission",
				sourceRefs: [ref("work-item-domain-action-proposal", seededProposalId)],
				decidedAtMs: NOW + 8,
			},
		],
	]);
	opts.selection.down([["DATA", { kind: "canvas-selection", workItemId: DEFAULT_SELECTED }]]);
}

function visibleOutcomeResultCandidates(
	g: ReturnType<typeof graph>,
	opts: {
		readonly outcomes: Node<ExecutorOutcome>;
		readonly requestStatus: Node<AgentRequestStatusChanged>;
		readonly issues: Node<DataIssue>;
		readonly audit: Node<AgentRuntimeAuditRecord>;
	},
): { readonly candidates: Node<EffectRunResult> } {
	const candidates = g.node<EffectRunResult>(
		[opts.outcomes, opts.requestStatus, opts.issues, opts.audit],
		(ctx) => {
			const state = ctx.state.get<OutcomeCandidateState>() ?? {
				outcomes: new Map(),
				statusByRequest: new Map(),
				issuesByRequest: new Map(),
				auditByRequest: new Map(),
				auditByOutcome: new Map(),
				emitted: new Set(),
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = raw as ExecutorOutcome;
				state.outcomes.set(outcome.outcomeId, outcome);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const status = raw as AgentRequestStatusChanged;
				state.statusByRequest.set(status.requestId, status);
			}
			for (const raw of depBatch(ctx, 2) ?? []) {
				const issue = raw as DataIssue;
				if (issue.subjectId !== undefined) {
					const bucket = state.issuesByRequest.get(issue.subjectId) ?? [];
					bucket.push(issue);
					state.issuesByRequest.set(issue.subjectId, bucket);
				}
			}
			for (const raw of depBatch(ctx, 3) ?? []) {
				const audit = raw as AgentRuntimeAuditRecord;
				if (audit.subjectId !== undefined) {
					const bucket = state.auditByRequest.get(audit.subjectId) ?? [];
					bucket.push(audit.id);
					state.auditByRequest.set(audit.subjectId, bucket);
				}
				const outcomeId = audit.metadata?.outcomeId;
				if (typeof outcomeId === "string") {
					const bucket = state.auditByOutcome.get(outcomeId) ?? [];
					bucket.push(audit.id);
					state.auditByOutcome.set(outcomeId, bucket);
				}
			}
			for (const result of outcomeCandidatesFromState(state)) ctx.down([["DATA", result]]);
			ctx.state.set(state);
		},
		{
			name: "canvas/visibleOutcomeResultCandidates",
			factory: "canvasVisibleOutcomeResultCandidates",
			partial: true,
		},
	);
	return { candidates };
}

interface OutcomeCandidateState {
	outcomes: Map<string, ExecutorOutcome>;
	statusByRequest: Map<string, AgentRequestStatusChanged>;
	issuesByRequest: Map<string, DataIssue[]>;
	auditByRequest: Map<string, string[]>;
	auditByOutcome: Map<string, string[]>;
	emitted: Set<string>;
}

function outcomeCandidatesFromState(state: OutcomeCandidateState): readonly EffectRunResult[] {
	const results: EffectRunResult[] = [];
	for (const outcome of state.outcomes.values()) {
		if (state.emitted.has(outcome.outcomeId)) continue;
		const status = state.statusByRequest.get(outcome.requestId);
		const outcomeAuditRefs = state.auditByOutcome.get(outcome.outcomeId);
		if (
			status === undefined ||
			outcomeAuditRefs === undefined ||
			status.operationId !== outcome.operationId ||
			status.status !== terminalRequestStatusForOutcome(outcome)
		) {
			continue;
		}
		const base = {
			kind: "effect-run-result",
			resultId: `${status.effectRunId}:${outcome.outcomeId}:result`,
			effectRunId: status.effectRunId,
			status: effectRunStatusForOutcome(outcome),
			operationId: outcome.operationId,
			subjectRefs: outcome.evidenceRefs?.filter((item) => item.kind === "work-item"),
			sourceRefs: uniqueRefs([
				ref("executor-outcome", outcome.outcomeId),
				ref("agent-request", outcome.requestId),
				...(outcome.evidenceRefs ?? []),
				...(status.sourceRefs ?? []),
			]),
			issues: uniqueIssues([
				...(outcome.issues ?? []),
				...(status.issues ?? []),
				...(state.issuesByRequest.get(outcome.requestId) ?? []),
			]),
			auditRefs: uniqueStrings([
				...(state.auditByRequest.get(outcome.requestId) ?? []),
				...outcomeAuditRefs,
			]),
			completedAtMs: outcome.occurredAtMs,
			metadata: {
				effectKind: EFFECT_KIND,
				outcomeId: outcome.outcomeId,
				requestStatus: status.status,
			},
		} satisfies Omit<EffectRunResult, "output" | "error" | "needs" | "reason" | "timeoutMs">;
		const result =
			outcome.kind === "result"
				? ({ ...base, output: outcome.result } satisfies EffectRunResult)
				: outcome.kind === "failure"
					? ({ ...base, error: outcome.error } satisfies EffectRunResult)
					: outcome.kind === "blocked"
						? ({ ...base, needs: outcome.needs } satisfies EffectRunResult)
						: outcome.kind === "timeout"
							? ({ ...base, timeoutMs: outcome.timeoutMs } satisfies EffectRunResult)
							: ({ ...base, reason: outcome.reason } satisfies EffectRunResult);
		state.emitted.add(outcome.outcomeId);
		results.push(result);
	}
	return results;
}

function fakeCanvasToolBinding(): ToolProviderAdapterBinding {
	return {
		providerId: PROVIDER_ID,
		run(input, ctx): ToolProviderAdapterRunResult {
			if (input.requestId.includes("policy-failure")) {
				return {
					kind: "failure",
					error: issue(
						"fake-policy-denied",
						"Fake policy denied write expansion; bounded public issue only.",
						input.requestId,
					),
					retryable: false,
					metadata: { runId: ctx.runId, publicSummary: "policy-denied" },
				};
			}
			if (input.requestId.includes("human-approval")) {
				return {
					kind: "blocked",
					needs: [{ kind: "approval", message: "Human approval required before patch." }],
					metadata: { runId: ctx.runId, publicSummary: "approval-needed" },
				};
			}
			return {
				kind: "result",
				result: {
					kind: "tool-output",
					summary: input.requestId.includes("board-query")
						? "Canvas query returned bounded WorkItem/effect/evidence summary."
						: "Fake bounded provider-neutral result.",
					value: { ok: true, bounded: true, requestId: input.requestId },
					refs: [ref("artifact", `${input.requestId}:bounded-summary`)],
					metadata: { resultKind: "bounded-demo" },
				},
				usage: { latencyMs: 7 },
				metadata: { runId: ctx.runId, publicSummary: "success" },
			};
		},
	};
}

function workItemSeed(item: (typeof workItemDefinitions)[number]): WorkItemSeed {
	return {
		kind: "work-item",
		workItemId: item.id,
		workItemKind: "canvas-dogfood",
		summary: item.summary,
		lifecycleStatus: item.lane === "complete" ? "closed" : "open",
		sourceRefs: [ref("csp-8-canvas", item.id)],
		metadata: {
			label: item.label,
			progress: item.progress,
			lane: item.lane,
			x: item.x,
			y: item.y,
		},
	};
}

function workItemProjection(item: (typeof workItemDefinitions)[number]): WorkItemProjection {
	return {
		workItemId: item.id,
		summary: item.label,
		detail: item.summary,
		kind: "canvas-dogfood",
		authoringRevision: 1,
		executionInputRevision: 1,
		lastEventId: `${item.id}:created`,
		metadata: { lane: item.lane, progress: item.progress },
	};
}

function workItemEffectRequest(workItemId: string): WorkItemEffectRequested {
	return {
		kind: "work-item-effect-requested",
		requestId: `${workItemId}:effect-request`,
		workItemId,
		effectRunId: `${workItemId}:effect-run`,
		effectKind: EFFECT_KIND,
		executionInputRevision: 1,
		planId: `${workItemId}:plan`,
		planMemberId: "tool-member",
		sourceRefs: [ref("work-item", workItemId)],
		goal: {
			kind: EFFECT_KIND,
			summary: `Run fake provider-neutral tool for ${workItemId}`,
		},
		agentRunId: "canvas-agent-run",
		policyRefs: [ref("work-item-effect-mapping-policy", "canvas-evidence-policy")],
		metadata: { effectKind: EFFECT_KIND },
	};
}

function agentToolRequest(workItemId: string): AgentRequestIssued {
	return {
		kind: "issued",
		requestId: `${workItemId}:tool-request`,
		operationId: `${workItemId}:tool-operation`,
		effectRunId: `${workItemId}:effect-run`,
		agentRunId: "canvas-agent-run",
		requestKind: "executor",
		required: true,
		input: {
			inputId: `${workItemId}:tool-input`,
			inputKind: "tool-call",
			dataMode: "inline",
			value: {
				kind: "tool-call",
				toolName: "file.read",
				operation: "read",
				arguments: { path: "bounded-demo.md", workItemId },
			},
			subjectRefs: [ref("work-item", workItemId)],
			metadata: { bounded: true },
		},
		sourceRefs: [ref("work-item", workItemId), ref("effect-run", `${workItemId}:effect-run`)],
		metadata: { effectKind: EFFECT_KIND },
	};
}

function routeFor(
	request: AgentRequestIssued,
	profile: { readonly executorId: string; readonly profileId: string },
): ExecutorRoute {
	return {
		kind: "executor-route",
		routeId: `${request.requestId}:route`,
		requestId: request.requestId,
		operationId: request.operationId,
		inputId: request.input?.inputId,
		inputKind: "tool-call",
		executorId: profile.executorId,
		profileId: profile.profileId,
		reason: "seeded Canvas route",
		evidenceRefs: [ref("work-item", request.requestId.replace(":tool-request", ""))],
	};
}

function dependency(
	fromWorkItemId: string,
	toWorkItemId: string,
	label: string,
): WorkItemDependencyFact {
	return { kind: "work-item-dependency", fromWorkItemId, toWorkItemId, label };
}

function statusForEffectRun(
	state: CanvasViewState,
	effectRunId: string,
	workItemId: string,
): EffectStatus {
	const result = state.effectResults.get(effectRunId);
	if (result !== undefined) {
		if (result.status === "completed") return "completed";
		if (result.status === "failed" || result.status === "timeout" || result.status === "canceled")
			return "failed";
		if (result.status === "blocked") return "blocked";
	}
	const input = state.adapterInputByWorkItem.get(workItemId);
	if (input === undefined) return "pending";
	const latestRun = Array.from(state.runStatuses.values())
		.reverse()
		.find((status) => status.adapterInputId === input.adapterInputId);
	if (latestRun?.status === "started" || latestRun?.status === "requested") return "running";
	if (input.status === "ready") return "ready";
	return "pending";
}

function laneFromStatus(seed: Lane, status: EffectStatus): Lane {
	if (status === "completed") return "complete";
	if (status === "failed" || status === "blocked") return "blocked";
	if (status === "running" || status === "ready") return "running";
	return seed;
}

function progressFor(seed: number, status: EffectStatus, evidenceCount: number): number {
	if (status === "completed") return 100;
	if (status === "failed" || status === "blocked") return Math.max(seed, 54);
	if (status === "running") return Math.max(seed, 72);
	if (status === "ready") return Math.max(seed, 66);
	return evidenceCount > 0 ? Math.max(seed, 80) : seed;
}

function effectRunStatusForOutcome(outcome: ExecutorOutcome): EffectRunResult["status"] {
	if (outcome.kind === "result") return "completed";
	if (outcome.kind === "failure") return "failed";
	if (outcome.kind === "blocked") return "blocked";
	return outcome.kind;
}

function terminalRequestStatusForOutcome(outcome: ExecutorOutcome): AgentRequestStatus {
	if (outcome.kind === "result") return "completed";
	if (outcome.kind === "failure") return "failed";
	if (outcome.kind === "blocked") return "blocked";
	return outcome.kind;
}

function workItemIdFromRefs(refs: readonly SourceRef[]): string | undefined {
	return refs.find((item) => item.kind === "work-item")?.id;
}

function runtimeRunId(outcome: ExecutorOutcome): string | undefined {
	const runId = outcome.metadata?.runId;
	return typeof runId === "string" ? runId : undefined;
}

function evidenceCard(evidence: WorkItemEvidenceRecorded): CanvasEvidenceCard {
	return Object.freeze({
		evidenceId: evidence.evidenceId,
		workItemId: evidence.workItemId,
		effectRunId: evidence.effectRunId,
		status: evidence.status,
		summary:
			evidence.output?.summary ??
			evidence.error?.message ??
			evidence.needs?.[0]?.message ??
			evidence.reason,
		issueCode: evidence.error?.code ?? evidence.issues?.[0]?.code,
	});
}

function issueCard(issue: DataIssue): CanvasIssueCard {
	return Object.freeze({
		code: issue.code,
		message: issue.message,
		severity: issue.severity,
		subjectId: issue.subjectId,
	});
}

function ref(kind: string, id: string, metadata?: Record<string, unknown>): SourceRef {
	return metadata === undefined ? { kind, id } : { kind, id, metadata };
}

function issue(code: string, message: string, subjectId: string): DataIssue {
	return { kind: "issue", code, message, severity: "warning", subjectId };
}

function uniqueStrings(values: readonly string[]): readonly string[] | undefined {
	const unique = Array.from(new Set(values));
	return unique.length === 0 ? undefined : unique;
}

function uniqueRefs(refs: readonly SourceRef[]): readonly SourceRef[] {
	const seen = new Set<string>();
	const out: SourceRef[] = [];
	for (const item of refs) {
		const key = `${item.kind}:${item.id}:${JSON.stringify(item.metadata ?? {})}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(item);
	}
	return out;
}

function uniqueIssues(issues: readonly DataIssue[]): readonly DataIssue[] | undefined {
	const seen = new Set<string>();
	const out: DataIssue[] = [];
	for (const item of issues) {
		const key = `${item.code}:${item.subjectId ?? ""}:${item.message}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(item);
	}
	return out.length === 0 ? undefined : out;
}
