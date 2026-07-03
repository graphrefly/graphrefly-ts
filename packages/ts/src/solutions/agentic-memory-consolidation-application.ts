import type { Graph } from "../graph/graph.js";
import { agenticMemoryConsolidationBundle } from "./agentic-memory-consolidation.js";
import { agenticMemoryRecordAdmissionBundle } from "./agentic-memory-proposal-admission.js";
import { agenticMemoryRecordApplicationBundle } from "./agentic-memory-record-application.js";
import type {
	AgenticMemoryConsolidationApplicationBundle,
	AgenticMemoryConsolidationApplicationBundleOptions,
} from "./agentic-memory-types.js";

/**
 * D171/D572/D576/D577 composition from consolidation outcomes to record truth.
 *
 * Consolidation remains proposal-only; admission and application are explicit
 * graph-visible boundaries before any AgenticMemoryRecord snapshot changes.
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
		...(opts.applicationHistory === undefined ? {} : { history: opts.applicationHistory }),
	});
	return {
		input: {
			records: opts.records,
			requests: opts.requests,
			outcomes: opts.outcomes,
			admissionPolicy: opts.admissionPolicy,
			applicationPolicy: opts.applicationPolicy,
			...(opts.applicationHistory === undefined
				? {}
				: { applicationHistory: opts.applicationHistory }),
		},
		consolidation,
		admission,
		application,
		records: application.records,
		appliedRecords: application.appliedRecords,
		applicationDecisions: application.applicationDecisions,
		applicationStatus: application.status,
		applicationIssues: application.issues,
	};
}
