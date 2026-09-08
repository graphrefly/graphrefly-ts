import { prepareConstruction, startConstruction } from "../graph/construction-scope.js";
import type { Graph } from "../graph/graph.js";
import {
	type CausalBinding,
	causalBinding,
	type FullCausalCapability,
} from "./causal-occurrence/capabilities.js";
import {
	buildCausalNodes,
	causalColdNodeNames,
	prepareCausalOptions,
} from "./causal-occurrence/construction.js";
import type {
	CausalOccurrenceBundle,
	CausalOccurrenceBundleOptions,
} from "./causal-occurrence/contracts.js";

export {
	assertCausalOccurrenceTopology,
	causalOccurrenceRequiredEdges,
} from "./causal-occurrence/construction.js";

export type {
	CausalBranchTerminal,
	CausalCurrentness,
	CausalEffectAdmission,
	CausalEffectConservation,
	CausalEffectOutcome,
	CausalEffectOutcomeState,
	CausalEffectProposal,
	CausalEvidence,
	CausalEvidenceCoverage,
	CausalEvidenceCoverageState,
	CausalOccurrence,
	CausalOccurrenceAdmission,
	CausalOccurrenceBundle,
	CausalOccurrenceBundleOptions,
	CausalOccurrenceRef,
	CausalQuiescence,
	CausalSourceRef,
	CausalTerminalFanIn,
	CausalWatermark,
} from "./causal-occurrence/contracts.js";
export {
	CAUSAL_OCCURRENCE_SCHEMA_REVISION,
	causalOccurrenceDigest,
} from "./causal-occurrence/identity.js";

export function causalOccurrenceBundle<T>(
	graph: Graph,
	opts: CausalOccurrenceBundleOptions<T>,
): CausalOccurrenceBundle<T> {
	return buildCausalComposition(
		graph,
		opts,
		causalBinding({
			contract: "contract-v2",
			implementationRevision: "construction-v1",
			scope: "full",
			epoch: 1,
		}),
	).ports;
}

/** Package-private one-shot graph-bound setup; construction material has no topology or subscriptions. */
export function causalComposition(graph: Graph) {
	return Object.freeze({
		composeFull<T>(
			facts: CausalOccurrenceBundleOptions<T>,
			binding: CausalBinding,
		): FullCausalCapability<T> {
			return buildCausalComposition(graph, facts, causalBinding(binding)).full;
		},
	});
}

function buildCausalComposition<T>(
	ownerGraph: Graph,
	opts: CausalOccurrenceBundleOptions<T>,
	binding: CausalBinding,
): { ports: CausalOccurrenceBundle<T>; full: FullCausalCapability<T> } {
	const preparedOptions = prepareCausalOptions(opts);
	opts = preparedOptions.options;
	const graph = prepareConstruction(ownerGraph, {
		name: opts.name,
		epoch: binding.epoch,
		names: [...causalColdNodeNames(opts.name), `${opts.name}/startup`],
		inputs: [
			opts.occurrences,
			opts.admissions,
			opts.branchTerminals,
			opts.effectProposals,
			opts.effectAdmissions,
			opts.effectOutcomes,
			opts.evidence,
			opts.watermarks,
		],
	});
	let prepared: import("../graph/construction-scope.js").OwnedConstruction;
	let built: ReturnType<typeof buildCausalNodes<T>>;
	try {
		const startup = graph.startupSource();
		built = buildCausalNodes(ownerGraph, graph, startup, preparedOptions, binding);
		prepared = graph.seal(startup, built.roots);
		graph.transferToGraph(prepared);
	} catch (error) {
		graph.abort(error);
	}
	startConstruction(ownerGraph, prepared);
	return built;
}
