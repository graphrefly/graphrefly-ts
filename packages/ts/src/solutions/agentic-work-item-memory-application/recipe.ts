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
import { solutionOccurrenceJoin, solutionOccurrenceProjection } from "../occurrence.js";
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
 * @remarks D151: each input DATA is one complete identity/revision/digest/source-refs
 * occurrence. Policy and prior records travel in its value, never independent latest-value
 * dependencies. Outputs preserve that identity; replay conflicts and retention overflow fail closed.
 * The fixed recipe topology is retained for its graph lifetime; input snapshots are bounded by
 * maxOccurrences, not a claim that one protocol wave is one business occurrence.
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
	if (
		!(opts.through === "bridge" || opts.through === "admission" || opts.through === "application")
	)
		throw new TypeError("memory recipe requires an explicit lifecycle boundary");
	const name = opts.name ?? "agenticWorkItemMemoryApplicationRecipe";
	const input = solutionOccurrenceProjection(graph, opts.occurrences, {
		name: `${name}/input`,
		factory: "agenticWorkItemMemoryApplicationInput",
		maxOccurrences: opts.maxOccurrences,
		project: (value) => value,
	});
	const bridge = agenticWorkItemMemoryBridgeBundle<TInput, TRecord>(graph, {
		name: `${name}/bridge`,
		occurrences: input,
		maxOccurrences: opts.maxOccurrences,
	});
	const admission =
		opts.through === "bridge"
			? undefined
			: agenticMemoryRecordAdmissionBundle<TRecord>(graph, {
					name: `${name}/admission`,
					maxOccurrences: opts.maxOccurrences,
					occurrences: solutionOccurrenceJoin(graph, input, bridge.proposals, {
						name: `${name}/admission-input`,
						factory: "agenticWorkItemMemoryAdmissionInput",
						maxOccurrences: opts.maxOccurrences,
						project: (frame, proposals) => {
							if (frame.records === undefined || frame.admissionPolicy === undefined)
								throw new Error("memory recipe occurrence lacks admission inputs");
							return Object.freeze({
								records: frame.records,
								proposals,
								policy: frame.admissionPolicy,
							});
						},
					}),
				});
	const application =
		opts.through !== "application" || admission === undefined
			? undefined
			: agenticMemoryRecordApplicationBundle<TRecord>(graph, {
					name: `${name}/application`,
					maxOccurrences: opts.maxOccurrences,
					occurrences: solutionOccurrenceJoin(graph, input, admission.admissions, {
						name: `${name}/application-input`,
						factory: "agenticWorkItemMemoryApplicationInput",
						maxOccurrences: opts.maxOccurrences,
						project: (frame, admissions) => {
							if (frame.records === undefined || frame.applicationPolicy === undefined)
								throw new Error("memory recipe occurrence lacks application inputs");
							return Object.freeze({
								records: frame.records,
								admissions,
								policy: frame.applicationPolicy,
								...(frame.applicationPriorEvidence === undefined
									? {}
									: { priorEvidence: frame.applicationPriorEvidence }),
							});
						},
					}),
				});
	return {
		input,
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
