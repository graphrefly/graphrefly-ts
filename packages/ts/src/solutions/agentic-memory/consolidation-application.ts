import type { Graph } from "../../graph/graph.js";
import { solutionOccurrenceJoin, solutionOccurrenceProjection } from "../occurrence.js";
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
 * @remarks D151: each input DATA is one complete identity/revision/digest/source-refs
 * occurrence. Policy and prior records travel in its value, never independent latest-value
 * dependencies. Outputs preserve that identity; replay conflicts and retention overflow fail closed.
 * The fixed recipe topology is retained for its graph lifetime; input snapshots are bounded by
 * maxOccurrences, not a claim that one protocol wave is one business occurrence.
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
	const input = solutionOccurrenceProjection(graph, opts.occurrences, {
		name: `${name}/input`,
		factory: "agenticMemoryConsolidationApplicationInput",
		maxOccurrences: opts.maxOccurrences,
		project: (value) => value,
	});
	const consolidation = agenticMemoryConsolidationBundle<T>(graph, {
		name: `${name}/consolidation`,
		occurrences: input,
		maxOccurrences: opts.maxOccurrences,
	});
	const admission = agenticMemoryRecordAdmissionBundle<T>(graph, {
		name: `${name}/admission`,
		maxOccurrences: opts.maxOccurrences,
		occurrences: solutionOccurrenceJoin(graph, input, consolidation.recordProposals, {
			name: `${name}/admission-input`,
			factory: "agenticMemoryConsolidationAdmissionInput",
			maxOccurrences: opts.maxOccurrences,
			project: (frame, proposals) =>
				Object.freeze({ records: frame.records, proposals, policy: frame.admissionPolicy }),
		}),
	});
	const application = agenticMemoryRecordApplicationBundle<T>(graph, {
		name: `${name}/application`,
		maxOccurrences: opts.maxOccurrences,
		occurrences: solutionOccurrenceJoin(graph, input, admission.admissions, {
			name: `${name}/application-input`,
			factory: "agenticMemoryConsolidationRecordApplicationInput",
			maxOccurrences: opts.maxOccurrences,
			project: (frame, admissions) =>
				Object.freeze({
					records: frame.records,
					admissions,
					policy: frame.applicationPolicy,
					...(frame.applicationPriorEvidence === undefined
						? {}
						: { priorEvidence: frame.applicationPriorEvidence }),
				}),
		}),
	});
	return {
		input,
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
