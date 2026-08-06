import type { Graph } from "../../src/graph/graph.js";
import type { Node } from "../../src/node/node.js";
import type {
	AgentRequestFact,
	AgentRequestIssued,
	AgentRequestLedgerBundle,
	EffectRun,
	EffectRunLimits,
	EffectRunResult,
	SourceRef,
} from "../../src/orchestration/agent-runtime.js";
import type {
	WorkItemEffectPlanJoinPolicy,
	WorkItemEffectPlanProjectorBundle,
	WorkItemEffectPlanProposed,
	WorkItemProjection,
} from "../../src/solutions/work-item/scheduling.js";

export type D687Arm = "current-primitives-manual" | "default-recipe";

export type D687Input = Readonly<Record<string, unknown>>;

export interface D687ArmSources {
	readonly workItems: Node<WorkItemProjection<D687Input>>;
	readonly proposals: Node<WorkItemEffectPlanProposed<D687Input>>;
	readonly admittedResults: Node<EffectRunResult>;
}

export interface D687ArmBundle {
	readonly workItemSeeds: Node<D687WorkItemSeed>;
	readonly plan: WorkItemEffectPlanProjectorBundle<D687Input>;
	readonly effectRuns: { readonly effectRuns: Node<EffectRun> };
	readonly requestFacts: Node<AgentRequestFact<D687Input>>;
	readonly requests: Node<AgentRequestIssued<D687Input>>;
	readonly requestLedger: AgentRequestLedgerBundle;
}

export interface D687WorkItemSeed {
	readonly kind: "work-item";
	readonly workItemId: string;
	readonly summary?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export type D687ArmComposer = (graph: Graph, sources: D687ArmSources) => D687ArmBundle;

export interface D687Member {
	readonly memberId: string;
	readonly effectKind: string;
	readonly required?: boolean;
	readonly dependsOnMemberIds: readonly string[];
	readonly outcome: "completed" | "failed";
	readonly input: Readonly<Record<string, unknown>>;
	readonly limits?: EffectRunLimits;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
}

export interface D687WorkItemCase {
	readonly workItemId: string;
	readonly authoringRevision: number;
	readonly executionInputRevision: number;
	readonly joinPolicy: WorkItemEffectPlanJoinPolicy;
	readonly members: readonly D687Member[];
	readonly duplicateProposal?: boolean;
}

export interface D687Scenario {
	readonly scenarioId: string;
	readonly workItems: readonly D687WorkItemCase[];
}

export interface D687Observation {
	readonly arm: D687Arm;
	readonly scenarioId: string;
	readonly workItemSeeds: readonly unknown[];
	readonly effectRequests: readonly unknown[];
	readonly effectRuns: readonly unknown[];
	readonly requestFacts: readonly unknown[];
	readonly issuedRequests: readonly unknown[];
	readonly ledgerViews: readonly unknown[];
	readonly planResults: readonly unknown[];
	readonly planIssueCodes: readonly string[];
	readonly topology: {
		readonly nodes: readonly {
			readonly id: string;
			readonly factory: string;
			readonly deps: readonly string[];
		}[];
		readonly edges: readonly { readonly from: string; readonly to: string }[];
	};
}

function member(memberId: string, opts: Partial<Omit<D687Member, "memberId">> = {}): D687Member {
	return Object.freeze({
		memberId,
		effectKind: opts.effectKind ?? `effect-${memberId}`,
		required: opts.required,
		dependsOnMemberIds: Object.freeze([...(opts.dependsOnMemberIds ?? [])]),
		outcome: opts.outcome ?? "completed",
		input: Object.freeze({ memberId, ...(opts.input ?? {}) }),
		limits: opts.limits,
		policyRefs: opts.policyRefs,
		sourceRefs: opts.sourceRefs,
	});
}

export const D687_SCENARIOS: readonly D687Scenario[] = Object.freeze([
	Object.freeze({
		scenarioId: "linear",
		workItems: Object.freeze([
			Object.freeze({
				workItemId: "d687-linear",
				authoringRevision: 1,
				executionInputRevision: 1,
				joinPolicy: "all-required",
				members: Object.freeze([
					member("first"),
					member("second", { dependsOnMemberIds: ["first"] }),
				]),
			}),
		]),
	}),
	Object.freeze({
		scenarioId: "fan-out-fan-in-diamond",
		workItems: Object.freeze([
			Object.freeze({
				workItemId: "d687-diamond",
				authoringRevision: 2,
				executionInputRevision: 3,
				joinPolicy: "all-required",
				members: Object.freeze([
					member("root"),
					member("left", { dependsOnMemberIds: ["root"] }),
					member("right", { dependsOnMemberIds: ["root"] }),
					member("join", { dependsOnMemberIds: ["left", "right"] }),
				]),
			}),
		]),
	}),
	Object.freeze({
		scenarioId: "optional-and-failed-prerequisite",
		workItems: Object.freeze([
			Object.freeze({
				workItemId: "d687-optional-failure",
				authoringRevision: 1,
				executionInputRevision: 4,
				joinPolicy: "all-required",
				members: Object.freeze([
					member("root"),
					member("optional", { required: false }),
					member("failing", {
						dependsOnMemberIds: ["root"],
						outcome: "failed",
					}),
					member("blocked-join", {
						dependsOnMemberIds: ["failing", "optional"],
					}),
				]),
			}),
		]),
	}),
	Object.freeze({
		scenarioId: "evidence-only-join",
		workItems: Object.freeze([
			Object.freeze({
				workItemId: "d687-evidence-only",
				authoringRevision: 3,
				executionInputRevision: 5,
				joinPolicy: "evidence-only",
				members: Object.freeze([
					member("collect", { outcome: "failed" }),
					member("optional-context", { required: false }),
				]),
			}),
		]),
	}),
	Object.freeze({
		scenarioId: "multi-work-item-propagation-and-duplicate",
		workItems: Object.freeze([
			Object.freeze({
				workItemId: "d687-multi-a",
				authoringRevision: 7,
				executionInputRevision: 11,
				joinPolicy: "all-required",
				duplicateProposal: true,
				members: Object.freeze([
					member("bounded-a", {
						effectKind: "compile",
						input: { commandRef: "compile-a" },
						limits: { maxSteps: 3, maxRequests: 1, maxCostUsd: 0.25 },
						policyRefs: [{ kind: "policy", id: "policy-a" }],
						sourceRefs: [{ kind: "fixture", id: "source-a" }],
					}),
				]),
			}),
			Object.freeze({
				workItemId: "d687-multi-b",
				authoringRevision: 8,
				executionInputRevision: 13,
				joinPolicy: "all-required",
				members: Object.freeze([
					member("bounded-b", {
						effectKind: "verify",
						input: { commandRef: "verify-b" },
						limits: { maxSteps: 5, maxRequests: 1, timeoutMs: 5000 },
						policyRefs: [{ kind: "policy", id: "policy-b" }],
						sourceRefs: [{ kind: "fixture", id: "source-b" }],
					}),
				]),
			}),
		]),
	}),
]);
