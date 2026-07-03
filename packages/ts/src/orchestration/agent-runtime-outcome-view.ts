import { depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../identity.js";
import type { Node } from "../node/node.js";
import {
	dataIssue,
	projectRuntimeFact,
	ref,
	sanitizeProviderGraphVisibleRecord,
	uniqueSourceRefs,
} from "./agent-runtime-common.js";
import { outcomeIssues } from "./agent-runtime-executor-outcome.js";
import type { AgentRuntimeAuditRecord } from "./agent-runtime-types-agent.js";
import type { ExecutorOutcome, SourceRef } from "./agent-runtime-types-core.js";
import type {
	ExecutorOutcomeView,
	ExecutorOutcomeViewBundle,
	ExecutorOutcomeViewPolicy,
} from "./agent-runtime-types-tool.js";

export function executorOutcomeViewProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly outcomes: Node<ExecutorOutcome>;
		readonly policy?: ExecutorOutcomeViewPolicy;
	},
): ExecutorOutcomeViewBundle {
	const name = opts.name ?? "executorOutcomeViews";
	const policy = {
		audience: opts.policy?.audience ?? "agent-observation",
		maxSummaryChars: opts.policy?.maxSummaryChars ?? 512,
		includeIssues: opts.policy?.includeIssues ?? true,
		includeUsage: opts.policy?.includeUsage ?? false,
		includeMetadata: opts.policy?.includeMetadata ?? false,
	} satisfies Required<ExecutorOutcomeViewPolicy>;
	const runtime = graph.node<ExecutorOutcomeViewFact>(
		[opts.outcomes],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = raw as ExecutorOutcome;
				const projection = executorOutcomeViewProjectionFromOutcome(outcome, policy);
				ctx.down([
					["DATA", { kind: "view", view: projection.view } satisfies ExecutorOutcomeViewFact],
					[
						"DATA",
						{
							kind: "audit",
							audit: {
								id: compoundTupleKey("executor-outcome-view-audit", [
									outcome.outcomeId,
									policy.audience,
								]),
								kind: "executor-outcome-view-projected",
								subjectId: outcome.requestId,
								sourceRefs: [ref("executor-outcome", outcome.outcomeId)],
								metadata: { audience: policy.audience, status: outcome.kind },
							},
						} satisfies ExecutorOutcomeViewFact,
					],
				]);
				for (const issue of projection.issues) {
					ctx.down([["DATA", { kind: "issue", issue } satisfies ExecutorOutcomeViewFact]]);
				}
			}
		},
		{ name: `${name}/runtime`, factory: "executorOutcomeViewProjector" },
	);
	return {
		views: projectRuntimeFact(graph, runtime, `${name}/views`, "executorOutcomeViews", (fact) =>
			fact.kind === "view" ? fact.view : undefined,
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"executorOutcomeViewIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(
			graph,
			runtime,
			`${name}/audit`,
			"executorOutcomeViewAudit",
			(fact) => (fact.kind === "audit" ? fact.audit : undefined),
		),
	};
}

export type ExecutorOutcomeViewFact =
	| { readonly kind: "view"; readonly view: ExecutorOutcomeView }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

export interface ExecutorOutcomeViewProjection {
	readonly view: ExecutorOutcomeView;
	readonly issues: readonly DataIssue[];
}

export interface ExecutorOutcomeSummaryProjection {
	readonly summary: string;
	readonly truncated: boolean;
	readonly originalChars: number;
	readonly limitChars: number;
}

export function executorOutcomeViewProjectionFromOutcome(
	outcome: ExecutorOutcome,
	policy: Required<ExecutorOutcomeViewPolicy>,
): ExecutorOutcomeViewProjection {
	const sourceRefs = uniqueSourceRefs([
		ref("executor-outcome", outcome.outcomeId),
		...(outcome.evidenceRefs ?? []),
	]);
	const summary = projectOutcomeSummary(outcome, policy.maxSummaryChars);
	const issues = Object.freeze([
		...outcomeIssues(outcome),
		...(summary.truncated ? [outcomeSummaryTruncationIssue(outcome, summary, policy)] : []),
	]);
	const metadata = policy.includeMetadata
		? sanitizeProviderGraphVisibleRecord(outcome.metadata)
		: undefined;
	const view = Object.freeze({
		kind: "executor-outcome-view",
		viewId: canonicalTupleKey([outcome.outcomeId, policy.audience]),
		audience: policy.audience,
		outcomeId: outcome.outcomeId,
		requestId: outcome.requestId,
		operationId: outcome.operationId,
		routeId: outcome.routeId,
		executorId: outcome.executorId,
		profileId: outcome.profileId,
		status: outcome.kind,
		summary: summary.summary,
		summaryTruncated: summary.truncated,
		summaryChars: summary.originalChars,
		summaryLimitChars: summary.limitChars,
		errorKind: outcomeErrorKind(outcome),
		retryable: outcomeRetryable(outcome),
		nextActions: outcomeNextActions(outcome),
		sourceRefs,
		materialRefs: outcomeMaterialRefs(outcome),
		issues: policy.includeIssues && issues.length > 0 ? issues : undefined,
		usage: policy.includeUsage ? outcome.usage : undefined,
		...(metadata === undefined ? {} : { metadata }),
	} satisfies ExecutorOutcomeView);
	return Object.freeze({ view, issues });
}

export function projectOutcomeSummary(
	outcome: ExecutorOutcome,
	maxChars: number,
): ExecutorOutcomeSummaryProjection {
	const summary = outcomeSummary(outcome);
	const limitChars = Math.max(0, maxChars);
	if (summary.length <= limitChars) {
		return Object.freeze({
			summary,
			truncated: false,
			originalChars: summary.length,
			limitChars,
		});
	}
	const bounded =
		limitChars <= 1
			? summary.slice(0, limitChars)
			: limitChars <= 3
				? summary.slice(0, limitChars)
				: `${summary.slice(0, limitChars - 3)}...`;
	return Object.freeze({
		summary: bounded,
		truncated: true,
		originalChars: summary.length,
		limitChars,
	});
}

export function outcomeSummaryTruncationIssue(
	outcome: ExecutorOutcome,
	summary: ExecutorOutcomeSummaryProjection,
	policy: Required<ExecutorOutcomeViewPolicy>,
): DataIssue {
	return dataIssue(
		"executor-outcome-view-summary-truncated",
		"ExecutorOutcome view summary was truncated; inspect material refs or the source outcome for full detail",
		{
			subjectId: outcome.requestId,
			refs: [ref("executor-outcome", outcome.outcomeId)],
			severity: "warning",
			details: {
				audience: policy.audience,
				outcomeId: outcome.outcomeId,
				originalChars: summary.originalChars,
				limitChars: summary.limitChars,
			},
		},
	);
}

export function outcomeSummary(outcome: ExecutorOutcome): string {
	if (outcome.kind === "result") {
		if (outcome.result.summary !== undefined && outcome.result.summary.length > 0)
			return outcome.result.summary;
		return `Executor result '${outcome.result.kind}' is available via source refs`;
	}
	if (outcome.kind === "failure") return outcome.error.message;
	if (outcome.kind === "blocked") {
		const needKinds = outcome.needs.map((need) => need.kind).join(", ");
		return needKinds.length > 0 ? `Executor blocked: ${needKinds}` : "Executor blocked";
	}
	if (outcome.kind === "timeout") {
		return outcome.timeoutMs === undefined
			? "Executor timed out"
			: `Executor timed out after ${outcome.timeoutMs}ms`;
	}
	return outcome.reason ?? "Executor canceled";
}

export function outcomeErrorKind(outcome: ExecutorOutcome): string | undefined {
	if (outcome.kind === "failure") return outcome.error.code;
	if (outcome.kind === "timeout") return "timeout";
	if (outcome.kind === "blocked") return outcome.needs[0]?.kind ?? "blocked";
	if (outcome.kind === "canceled") return "canceled";
	return undefined;
}

export function outcomeRetryable(outcome: ExecutorOutcome): boolean | undefined {
	if (outcome.kind === "failure" || outcome.kind === "timeout") return outcome.retryable;
	return undefined;
}

export function outcomeNextActions(outcome: ExecutorOutcome): readonly string[] | undefined {
	if (outcome.kind === "blocked") return Object.freeze(outcome.needs.map((need) => need.kind));
	if ((outcome.kind === "failure" || outcome.kind === "timeout") && outcome.retryable === true) {
		return Object.freeze(["retry-or-route"]);
	}
	return undefined;
}

export function outcomeMaterialRefs(outcome: ExecutorOutcome): readonly SourceRef[] | undefined {
	const refs =
		outcome.kind === "result"
			? [...(outcome.result.refs ?? [])]
			: outcome.kind === "blocked"
				? outcome.needs.flatMap((need) => [...(need.refs ?? [])])
				: [];
	return refs.length === 0 ? undefined : uniqueSourceRefs(refs);
}
