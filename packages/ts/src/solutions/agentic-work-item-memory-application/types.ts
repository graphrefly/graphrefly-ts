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
	AgenticWorkItemMemoryBridgeBundleOptions,
	AgenticWorkItemMemoryBridgeInput,
	AgenticWorkItemMemoryBridgeResult,
} from "../agentic-work-item-memory/index.js";

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
	readonly input: AgenticWorkItemMemoryBridgeBundle<TInput, TRecord>["input"] & {
		readonly records?: Node<readonly AgenticMemoryRecord<TRecord>[]>;
		readonly admissionPolicy?: Node<AgenticMemoryRecordAdmissionPolicy>;
		readonly applicationPolicy?: Node<AgenticMemoryRecordApplicationPolicy>;
		readonly applicationPriorEvidence?: AgenticMemoryRecordApplicationBundle<TRecord>["input"]["priorEvidence"];
	};
	readonly bridge: AgenticWorkItemMemoryBridgeBundle<TInput, TRecord>;
	readonly projection: AgenticWorkItemMemoryBridgeBundle<TInput, TRecord>["projection"];
	readonly scoreSignals: Node<readonly ScoreSignal[]>;
	readonly proposals: Node<readonly AgenticMemoryRecordProposal<TRecord>[]>;
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

type AgenticWorkItemMemoryApplicationRecipeBundleBridgeOnlyOptions<TRecord> = {
	readonly records?: Node<readonly AgenticMemoryRecord<TRecord>[]>;
	readonly admissionPolicy?: undefined;
	readonly applicationPolicy?: undefined;
	readonly applicationPriorEvidence?: undefined;
};

type AgenticWorkItemMemoryApplicationRecipeBundleAdmissionOptions<TRecord> = {
	readonly records: Node<readonly AgenticMemoryRecord<TRecord>[]>;
	readonly admissionPolicy: Node<AgenticMemoryRecordAdmissionPolicy>;
	readonly applicationPolicy?: Node<AgenticMemoryRecordApplicationPolicy>;
	readonly applicationPriorEvidence?: AgenticMemoryRecordApplicationBundle<TRecord>["input"]["priorEvidence"];
};

/**
 * Graph bundle options for the D587 cross-family application recipe.
 *
 * `applicationPolicy` and `applicationPriorEvidence` are only valid when
 * `admissionPolicy` is present. Prior evidence must be supplied from an
 * external boundary or later evaluation input, never from this same recipe's
 * current application decisions.
 */
export type AgenticWorkItemMemoryApplicationRecipeBundleOptions<
	TInput = unknown,
	TRecord = unknown,
> = AgenticWorkItemMemoryBridgeBundleOptions<TInput, TRecord> &
	(
		| AgenticWorkItemMemoryApplicationRecipeBundleBridgeOnlyOptions<TRecord>
		| AgenticWorkItemMemoryApplicationRecipeBundleAdmissionOptions<TRecord>
	);
