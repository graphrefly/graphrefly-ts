import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import { admitAgenticMemoryRecordProposals } from "./agentic-memory/proposal-admission.js";
import { applyAgenticMemoryRecordAdmissions } from "./agentic-memory/record-application.js";
import type {
	AgenticMemoryProposalAdmissionPolicy,
	AgenticMemoryProposalAdmissionSnapshot,
	AgenticMemoryRecord,
	AgenticMemoryRecordAdmission,
	AgenticMemoryRecordApplicationOptions,
	AgenticMemoryRecordApplicationPolicy,
	AgenticMemoryRecordApplicationSnapshot,
	AgenticMemoryRecordProposal,
} from "./agentic-memory/types.js";
import { mapAgenticWorkItemMemoryBridge } from "./agentic-work-item-memory/bridge.js";
import type {
	AgenticWorkItemMemoryBridgeInput,
	AgenticWorkItemMemoryBridgeResult,
} from "./agentic-work-item-memory/types.js";
import { type SolutionOccurrence, solutionOccurrenceProjection } from "./occurrence.js";

export interface AgenticMemoryRecordAdmissionOccurrenceInput<T = unknown> {
	readonly records: readonly AgenticMemoryRecord<T>[];
	readonly proposals: readonly AgenticMemoryRecordProposal<T>[];
	readonly policy: AgenticMemoryProposalAdmissionPolicy;
	readonly evaluation?: number;
}

export interface AgenticMemoryRecordApplicationOccurrenceInput<T = unknown> {
	readonly records: readonly AgenticMemoryRecord<T>[];
	readonly admissions: readonly AgenticMemoryRecordAdmission<T>[];
	readonly policy: AgenticMemoryRecordApplicationPolicy;
	readonly priorEvidence?: AgenticMemoryRecordApplicationOptions<T>["priorEvidence"];
	readonly evaluation?: number;
}

/** Package-private D151 exact-occurrence Work Item → Memory bridge lifecycle. */
export function agenticWorkItemMemoryBridgeOccurrenceNode<
	TInput = unknown,
	TRecord = unknown,
	TOccurrenceInput extends AgenticWorkItemMemoryBridgeInput<
		TInput,
		TRecord
	> = AgenticWorkItemMemoryBridgeInput<TInput, TRecord>,
>(
	graph: Graph,
	input: Node<SolutionOccurrence<TOccurrenceInput>>,
	opts: Readonly<{ readonly name: string; readonly maxOccurrences: number }>,
): Node<
	SolutionOccurrence<
		Readonly<{
			readonly input: TOccurrenceInput;
			readonly result: AgenticWorkItemMemoryBridgeResult<TRecord>;
		}>
	>
> {
	return solutionOccurrenceProjection(graph, input, {
		name: `${opts.name}/projection`,
		factory: "agenticWorkItemMemoryBridgeOccurrence",
		maxOccurrences: opts.maxOccurrences,
		project: (value) =>
			Object.freeze({
				input: value,
				result: mapAgenticWorkItemMemoryBridge<TInput, TRecord>(value),
			}),
	});
}

/** Package-private D151 exact-occurrence Agentic Memory admission lifecycle. */
export function agenticMemoryRecordAdmissionOccurrenceNode<T = unknown>(
	graph: Graph,
	input: Node<SolutionOccurrence<AgenticMemoryRecordAdmissionOccurrenceInput<T>>>,
	opts: Readonly<{ readonly name: string; readonly maxOccurrences: number }>,
): Node<
	SolutionOccurrence<
		Readonly<{
			readonly input: AgenticMemoryRecordAdmissionOccurrenceInput<T>;
			readonly snapshot: AgenticMemoryProposalAdmissionSnapshot<T>;
		}>
	>
> {
	return solutionOccurrenceProjection(graph, input, {
		name: `${opts.name}/projection`,
		factory: "agenticMemoryRecordAdmissionOccurrence",
		maxOccurrences: opts.maxOccurrences,
		project: (value) =>
			Object.freeze({
				input: value,
				snapshot: admitAgenticMemoryRecordProposals<T>(value.proposals, value.policy, {
					records: value.records,
					evaluation: value.evaluation,
				}),
			}),
	});
}

/** Package-private D151 exact-occurrence Agentic Memory application lifecycle. */
export function agenticMemoryRecordApplicationOccurrenceNode<T = unknown>(
	graph: Graph,
	input: Node<SolutionOccurrence<AgenticMemoryRecordApplicationOccurrenceInput<T>>>,
	opts: Readonly<{ readonly name: string; readonly maxOccurrences: number }>,
): Node<
	SolutionOccurrence<
		Readonly<{
			readonly input: AgenticMemoryRecordApplicationOccurrenceInput<T>;
			readonly snapshot: AgenticMemoryRecordApplicationSnapshot<T>;
		}>
	>
> {
	return solutionOccurrenceProjection(graph, input, {
		name: `${opts.name}/projection`,
		factory: "agenticMemoryRecordApplicationOccurrence",
		maxOccurrences: opts.maxOccurrences,
		project: (value) =>
			Object.freeze({
				input: value,
				snapshot: applyAgenticMemoryRecordAdmissions<T>(value.admissions, value.policy, {
					records: value.records,
					priorEvidence: value.priorEvidence,
					evaluation: value.evaluation,
				}),
			}),
	});
}
