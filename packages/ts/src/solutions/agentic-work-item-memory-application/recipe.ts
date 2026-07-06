import type { Graph } from "../../graph/graph.js";
import {
	admitAgenticMemoryRecordProposals,
	agenticMemoryRecordAdmissionBundle,
	agenticMemoryRecordApplicationBundle,
	applyAgenticMemoryRecordAdmissions,
} from "../agentic-memory/index.js";
import {
	agenticWorkItemMemoryBridgeBundle,
	mapAgenticWorkItemMemoryBridge,
} from "../agentic-work-item-memory/index.js";
import type {
	AgenticWorkItemMemoryApplicationRecipeBundle,
	AgenticWorkItemMemoryApplicationRecipeBundleOptions,
	AgenticWorkItemMemoryApplicationRecipeInput,
	AgenticWorkItemMemoryApplicationRecipeResult,
} from "./types.js";

/**
 * Maps WorkItem bridge output through AgenticMemory-owned admission/application
 * helpers in the D587 cross-family composition namespace.
 *
 * The WorkItem-memory bridge remains mapper-only; this recipe composes its
 * proposal facts into AgenticMemory-owned admission/application helpers without
 * owning policy selection, truth mutation, storage, hydration, provider/runtime
 * calls, WorkItem mutation, or D584 same-evaluation evidence self-feedback.
 *
 * @param input - Current WorkItem bridge inputs plus AgenticMemory composition DATA.
 * @returns Bridge output plus optional AgenticMemory admission/application snapshots.
 * @category solutions
 * @example
 * ```ts
 * import { mapAgenticWorkItemMemoryApplicationRecipe } from "@graphrefly/ts/solutions/agentic-work-item-memory-application";
 * ```
 */
export function mapAgenticWorkItemMemoryApplicationRecipe<TInput = unknown, TRecord = unknown>(
	input: AgenticWorkItemMemoryApplicationRecipeInput<TInput, TRecord>,
): AgenticWorkItemMemoryApplicationRecipeResult<TRecord> {
	const bridge = mapAgenticWorkItemMemoryBridge(input);
	const admission =
		input.admissionPolicy === undefined
			? undefined
			: admitAgenticMemoryRecordProposals<TRecord>(bridge.proposals, input.admissionPolicy, {
					records: input.records,
					evaluation: input.evaluation,
				});
	const application =
		admission === undefined || input.applicationPolicy === undefined
			? undefined
			: applyAgenticMemoryRecordAdmissions<TRecord>(admission.admissions, input.applicationPolicy, {
					records: input.records,
					priorEvidence: input.applicationPriorEvidence,
					evaluation: input.evaluation,
				});

	return Object.freeze({
		kind: "agentic-work-item-memory-application-recipe-result",
		bridge,
		scoreSignals: bridge.scoreSignals,
		proposals: bridge.proposals,
		...(admission === undefined ? {} : { admission }),
		...(application === undefined ? {} : { application }),
	});
}

/**
 * Wires the WorkItem-memory bridge into optional AgenticMemory-owned admission
 * and application bundles in the D587 cross-family composition namespace.
 *
 * This is a graph-visible composition recipe. It stays outside the mapper-only
 * bridge namespace: admission/application nodes are created by AgenticMemory
 * helpers, and record snapshots come only from the AgenticMemory application
 * bundle.
 *
 * @param graph - Graph that owns the created nodes.
 * @param opts - WorkItem bridge nodes plus optional AgenticMemory admission/application nodes.
 * @returns Bridge nodes and, when configured, AgenticMemory admission/application bundles.
 * @category solutions
 * @example
 * ```ts
 * import { agenticWorkItemMemoryApplicationRecipeBundle } from "@graphrefly/ts/solutions/agentic-work-item-memory-application";
 * ```
 */
export function agenticWorkItemMemoryApplicationRecipeBundle<TInput = unknown, TRecord = unknown>(
	graph: Graph,
	opts: AgenticWorkItemMemoryApplicationRecipeBundleOptions<TInput, TRecord>,
): AgenticWorkItemMemoryApplicationRecipeBundle<TInput, TRecord> {
	const name = opts.name ?? "agenticWorkItemMemoryApplicationRecipe";
	const bridge = agenticWorkItemMemoryBridgeBundle<TInput, TRecord>(graph, {
		name: `${name}/bridge`,
		workItem: opts.workItem,
		policy: opts.policy,
		...(opts.evidence === undefined ? {} : { evidence: opts.evidence }),
		...(opts.outcomes === undefined ? {} : { outcomes: opts.outcomes }),
		...(opts.context === undefined ? {} : { context: opts.context }),
		...(opts.candidates === undefined ? {} : { candidates: opts.candidates }),
	});
	const admission =
		opts.records === undefined || opts.admissionPolicy === undefined
			? undefined
			: agenticMemoryRecordAdmissionBundle<TRecord>(graph, {
					name: `${name}/admission`,
					records: opts.records,
					proposals: bridge.proposals,
					policy: opts.admissionPolicy,
				});
	const application =
		opts.records === undefined || admission === undefined || opts.applicationPolicy === undefined
			? undefined
			: agenticMemoryRecordApplicationBundle<TRecord>(graph, {
					name: `${name}/application`,
					records: opts.records,
					admissions: admission.admissions,
					policy: opts.applicationPolicy,
					...(opts.applicationPriorEvidence === undefined
						? {}
						: { priorEvidence: opts.applicationPriorEvidence }),
				});

	return {
		input: {
			...bridge.input,
			...(opts.records === undefined ? {} : { records: opts.records }),
			...(opts.admissionPolicy === undefined ? {} : { admissionPolicy: opts.admissionPolicy }),
			...(opts.applicationPolicy === undefined
				? {}
				: { applicationPolicy: opts.applicationPolicy }),
			...(opts.applicationPriorEvidence === undefined
				? {}
				: { applicationPriorEvidence: opts.applicationPriorEvidence }),
		},
		bridge,
		projection: bridge.projection,
		scoreSignals: bridge.scoreSignals,
		proposals: bridge.proposals,
		...(admission === undefined ? {} : { admission }),
		...(application === undefined
			? {}
			: {
					application,
					records: application.records,
					appliedRecords: application.appliedRecords,
					applicationDecisions: application.applicationDecisions,
					applicationStatus: application.status,
					applicationOperationStatuses: application.operationStatuses,
					applicationIssues: application.issues,
					applicationAudit: application.audit,
					applicationCursor: application.cursor,
				}),
	};
}
