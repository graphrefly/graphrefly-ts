import type { Node } from "../../node/node.js";
import type { ScoreSignal } from "../../scoring/index.js";
import type {
	AgenticMemoryProposalAdmissionSnapshot,
	AgenticMemoryRecord,
	AgenticMemoryRecordAdmissionBundle,
	AgenticMemoryRecordAdmissionPolicy,
	AgenticMemoryRecordApplicationBundle,
	AgenticMemoryRecordApplicationOptions,
	AgenticMemoryRecordApplicationPolicy,
	AgenticMemoryRecordApplicationSnapshot,
	AgenticMemoryRecordProposal,
} from "../agentic-memory/index.js";
import type {
	AgenticWorkItemMemoryBridgeBundle,
	AgenticWorkItemMemoryBridgeInput,
	AgenticWorkItemMemoryBridgeResult,
} from "../agentic-work-item-memory/index.js";
import type { SolutionOccurrence } from "../occurrence.js";

type AgenticWorkItemMemoryApplicationRecipeAdmissionInput<TRecord> = {
	readonly records?: readonly AgenticMemoryRecord<TRecord>[];
	readonly admissionPolicy: AgenticMemoryRecordAdmissionPolicy;
	readonly applicationPolicy?: AgenticMemoryRecordApplicationPolicy;
	readonly applicationPriorEvidence?: AgenticMemoryRecordApplicationOptions<TRecord>["priorEvidence"];
};

type AgenticWorkItemMemoryApplicationRecipeBridgeOnlyInput<TRecord> = {
	readonly records?: readonly AgenticMemoryRecord<TRecord>[];
	readonly admissionPolicy?: undefined;
	readonly applicationPolicy?: undefined;
	readonly applicationPriorEvidence?: undefined;
};

/**
 * D587 cross-family composition input for WorkItem bridge output flowing into
 * AgenticMemory-owned admission/application helpers.
 *
 * The WorkItem-memory bridge remains mapper-only; this recipe is an explicit
 * higher-level composition surface and does not own admission policy selection,
 * record truth mutation, storage, hydration, runtime/provider calls, WorkItem
 * mutation, or D584 same-evaluation evidence self-feedback.
 */
export type AgenticWorkItemMemoryApplicationRecipeInput<
	TInput = unknown,
	TRecord = unknown,
> = AgenticWorkItemMemoryBridgeInput<TInput, TRecord> &
	(
		| AgenticWorkItemMemoryApplicationRecipeBridgeOnlyInput<TRecord>
		| AgenticWorkItemMemoryApplicationRecipeAdmissionInput<TRecord>
	);

/** D587 cross-family composition result. */
export interface AgenticWorkItemMemoryApplicationRecipeResult<TRecord = unknown> {
	readonly kind: "agentic-work-item-memory-application-recipe-result";
	readonly bridge: AgenticWorkItemMemoryBridgeResult<TRecord>;
	readonly scoreSignals: readonly ScoreSignal[];
	readonly proposals: readonly AgenticMemoryRecordProposal<TRecord>[];
	readonly admission?: AgenticMemoryProposalAdmissionSnapshot<TRecord>;
	readonly application?: AgenticMemoryRecordApplicationSnapshot<TRecord>;
}

export interface AgenticWorkItemMemoryApplicationRecipeBundle<TInput = unknown, TRecord = unknown> {
	readonly input: Node<
		SolutionOccurrence<AgenticWorkItemMemoryApplicationRecipeInput<TInput, TRecord>>
	>;
	readonly bridge: AgenticWorkItemMemoryBridgeBundle<TInput, TRecord>;
	readonly projection: AgenticWorkItemMemoryBridgeBundle<TInput, TRecord>["projection"];
	readonly scoreSignals: AgenticWorkItemMemoryBridgeBundle<TInput, TRecord>["scoreSignals"];
	readonly proposals: AgenticWorkItemMemoryBridgeBundle<TInput, TRecord>["proposals"];
	readonly admission?: AgenticMemoryRecordAdmissionBundle<TRecord>;
	readonly application?: AgenticMemoryRecordApplicationBundle<TRecord>;
	readonly records?: AgenticMemoryRecordApplicationBundle<TRecord>["records"];
	readonly appliedRecords?: AgenticMemoryRecordApplicationBundle<TRecord>["appliedRecords"];
	readonly applicationDecisions?: AgenticMemoryRecordApplicationBundle<TRecord>["applicationDecisions"];
	readonly applicationStatus?: AgenticMemoryRecordApplicationBundle<TRecord>["status"];
	readonly applicationOperationStatuses?: AgenticMemoryRecordApplicationBundle<TRecord>["operationStatuses"];
	readonly applicationIssues?: AgenticMemoryRecordApplicationBundle<TRecord>["issues"];
	readonly applicationAudit?: AgenticMemoryRecordApplicationBundle<TRecord>["audit"];
	readonly applicationCursor?: AgenticMemoryRecordApplicationBundle<TRecord>["cursor"];
}

/** D151 fixed composition depth; correlated policy/history material is occurrence DATA. */
export interface AgenticWorkItemMemoryApplicationRecipeBundleOptions<
	TInput = unknown,
	TRecord = unknown,
> {
	readonly name?: string;
	readonly through: "bridge" | "admission" | "application";
	readonly occurrences: Node<
		SolutionOccurrence<AgenticWorkItemMemoryApplicationRecipeInput<TInput, TRecord>>
	>;
	readonly maxOccurrences: number;
}
