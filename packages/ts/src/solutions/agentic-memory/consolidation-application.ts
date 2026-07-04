import type { Graph } from "../../graph/graph.js";
import { agenticMemoryConsolidationBundle } from "./consolidation.js";
import { agenticMemoryRecordAdmissionBundle } from "./proposal-admission.js";
import { agenticMemoryRecordApplicationBundle } from "./record-application.js";
import type {
	AgenticMemoryConsolidationApplicationBundle,
	AgenticMemoryConsolidationApplicationBundleOptions,
} from "./types.js";

/**
 * D171/D572/D576/D577 composition from consolidation outcomes to record truth.
 *
 * Consolidation remains proposal-only; admission and application are explicit
 * graph-visible boundaries before any AgenticMemoryRecord snapshot changes.
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns A bundle of graph-visible nodes for the recipe.
 * @category solutions
 * @example
 * ```ts
 * import { agenticMemoryConsolidationApplicationBundle } from "@graphrefly/ts/solutions";
 * ```
 */
export function agenticMemoryConsolidationApplicationBundle<T = unknown>(
	graph: Graph,
	opts: AgenticMemoryConsolidationApplicationBundleOptions<T>,
): AgenticMemoryConsolidationApplicationBundle<T> {
	const name = opts.name ?? "agenticMemoryConsolidationApplication";
	const consolidation = agenticMemoryConsolidationBundle<T>(graph, {
		name: `${name}/consolidation`,
		records: opts.records,
		requests: opts.requests,
		outcomes: opts.outcomes,
	});
	const admission = agenticMemoryRecordAdmissionBundle<T>(graph, {
		name: `${name}/admission`,
		records: opts.records,
		proposals: consolidation.recordProposals,
		policy: opts.admissionPolicy,
	});
	const application = agenticMemoryRecordApplicationBundle<T>(graph, {
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
			records: opts.records,
			requests: opts.requests,
			outcomes: opts.outcomes,
			admissionPolicy: opts.admissionPolicy,
			applicationPolicy: opts.applicationPolicy,
			...(opts.applicationPriorEvidence === undefined
				? {}
				: { applicationPriorEvidence: opts.applicationPriorEvidence }),
		},
		consolidation,
		admission,
		application,
		records: application.records,
		appliedRecords: application.appliedRecords,
		applicationDecisions: application.applicationDecisions,
		applicationStatus: application.status,
		applicationOperationStatuses: application.operationStatuses,
		applicationIssues: application.issues,
	};
}
