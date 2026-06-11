/**
 * Thin agentic-memory solution surface.
 *
 * D125 places vertical application kits under solutions, while D158 keeps
 * semantic-memory retrieval/ranking in horizontal patterns. This v0 bundle
 * composes those lower layers into graph-visible facts only: no agent runtime,
 * hidden scheduler, storage restore/hydration, LLM loop, or protocol behavior.
 */

import { depBatch, depLatest } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import {
	type Codec,
	type StrictJsonValue as SharedStrictJsonValue,
	strictJsonCodec,
} from "../json/codec.js";
import type { Node } from "../node/node.js";
import {
	type FactId,
	type KnowledgeAssertion,
	type KnowledgeAssertionObject,
	type KnowledgeAssertionSubject,
	type MemoryAnswer,
	type MemoryFragment,
	validateMemoryFragment,
} from "../patterns/semantic-memory.js";
import {
	type MemoryRetrievalBundle,
	type MemoryRetrievalCursor,
	type MemoryRetrievalError,
	type MemoryRetrievalIndex,
	type MemoryRetrievalQuery,
	type MemoryRetrievalSnapshot,
	type MemoryRetrievalStatus,
	memoryRetrievalBundle,
} from "../patterns/semantic-memory-graph.js";

export type AgenticMemoryStrictJsonValue = SharedStrictJsonValue;

type StrictJsonValue = SharedStrictJsonValue;

export type {
	KnowledgeAssertion,
	KnowledgeAssertionObject,
	KnowledgeAssertionSubject,
} from "../patterns/semantic-memory.js";

/** Agent-facing memory category. D164 keeps this separate from durability and artifact kind. */
export type AgenticMemoryKind = "working" | "episodic" | "semantic" | "procedural" | "profile";

/** Semantic durability/retention policy metadata. This is not a storage tier handle. */
export type AgenticMemoryPersistenceLevel =
	| "turn"
	| "session"
	| "project"
	| "longTerm"
	| "permanent"
	| "archived";

/** Whether the record is raw evidence or a derived artifact. */
export type AgenticMemoryArtifactKind = "raw" | "insight" | "profile" | "procedure";

/** Optional solution-facing scope metadata. Scope ids are ordinary DATA facts. */
export interface AgenticMemoryScope {
	readonly sessionId?: string;
	readonly projectId?: string;
	readonly userId?: string;
	readonly tenantId?: string;
}

/**
 * D164 solution envelope over a lower-layer MemoryFragment.
 *
 * The envelope carries agentic-memory metadata only. It intentionally owns no
 * storage tiers/keys/adapters, restore/hydration behavior, timers, schedulers,
 * LLM/tool/runner handles, or protocol semantics.
 */
export interface AgenticMemoryRecord<T = unknown> {
	readonly id: FactId;
	readonly kind: AgenticMemoryKind;
	readonly persistenceLevel: AgenticMemoryPersistenceLevel;
	readonly artifactKind: AgenticMemoryArtifactKind;
	readonly scope?: AgenticMemoryScope;
	readonly fragment: MemoryFragment<T>;
}

export interface AgenticMemoryRecordMetadata {
	readonly recordId: FactId;
	readonly kind: AgenticMemoryKind;
	readonly persistenceLevel: AgenticMemoryPersistenceLevel;
	readonly artifactKind: AgenticMemoryArtifactKind;
	readonly scope?: AgenticMemoryScope;
}

export interface AgenticMemoryProjectionCursor {
	readonly evaluation: number;
	readonly validRecords: number;
	readonly invalidRecords: number;
	readonly projectedFragments: number;
}

export type AgenticMemoryStatusState = "ready" | "empty" | "partial" | "error";

export interface AgenticMemoryStatus {
	readonly state: AgenticMemoryStatusState;
	readonly cursor: AgenticMemoryProjectionCursor;
}

export type AgenticMemoryErrorCode =
	| "duplicate-record-id"
	| "duplicate-fragment-id"
	| "invalid-records-input"
	| "invalid-record"
	| "invalid-record-kind"
	| "invalid-persistence-level"
	| "invalid-artifact-kind"
	| "invalid-scope"
	| "invalid-fragment";

export interface AgenticMemoryError {
	readonly code: AgenticMemoryErrorCode;
	readonly message: string;
	readonly index?: number;
	readonly recordId?: FactId;
	readonly fragmentId?: FactId;
	readonly record?: unknown;
	readonly validationErrors?: readonly string[];
	readonly cursor: AgenticMemoryProjectionCursor;
}

export interface AgenticMemoryProjectionSnapshot<T = unknown> {
	readonly records: readonly AgenticMemoryRecord<T>[];
	readonly fragments: readonly MemoryFragment<T>[];
	readonly metadataByFragmentId: Readonly<Record<FactId, AgenticMemoryRecordMetadata>>;
	readonly status: AgenticMemoryStatus;
	readonly errors: readonly AgenticMemoryError[];
	readonly cursor: AgenticMemoryProjectionCursor;
}

/** Source/provenance projection for a valid memory fragment. */
export interface AgenticMemorySourceProjection {
	readonly fragmentId: FactId;
	readonly record?: AgenticMemoryRecordMetadata;
	readonly sources: readonly FactId[];
	readonly parentFragmentId?: FactId;
	readonly provenance?: string;
}

/** A context-ready item derived from ranked memory retrieval results. */
export interface AgenticMemoryContextEntry<T = unknown> {
	readonly fragmentId: FactId;
	readonly payload: T;
	readonly confidence: number;
	readonly tags: readonly string[];
	readonly sources: readonly FactId[];
	readonly record?: AgenticMemoryRecordMetadata;
	readonly fragment: MemoryFragment<T>;
}

export type AgenticMemoryContextState = "ready" | "empty" | "partial" | "error";

/**
 * Context-ready ranked memory output for callers such as prompt builders.
 *
 * This is still only a DATA fact. It does not extract, summarize, reflect, run
 * tools, or choose an autonomous action.
 */
export interface AgenticMemoryContext<T = unknown> {
	readonly state: AgenticMemoryContextState;
	readonly query: MemoryRetrievalQuery;
	readonly entries: readonly AgenticMemoryContextEntry<T>[];
	readonly cursor: MemoryRetrievalCursor;
	readonly errors: readonly AgenticMemoryError[];
	readonly retrievalErrors: readonly MemoryRetrievalError[];
	readonly contextReady: boolean;
}

/** Explicit KG assertion draft fact; extraction/LLM work happens outside this bundle. */
export interface AgenticMemoryKgAssertionDraft {
	readonly id: FactId;
	readonly recordId: FactId;
	readonly fragmentId: FactId;
	readonly subject: KnowledgeAssertionSubject;
	readonly predicate: string;
	readonly object: KnowledgeAssertionObject;
	readonly confidence?: number;
	readonly sources?: readonly FactId[];
	readonly provenance?: string;
}

export interface AgenticMemoryKgProjectionCursor {
	readonly evaluation: number;
	readonly validRecords: number;
	readonly validDrafts: number;
	readonly invalidDrafts: number;
	readonly projectedAssertions: number;
}

export type AgenticMemoryKgProjectionStatusState = AgenticMemoryStatusState;

export interface AgenticMemoryKgProjectionStatus {
	readonly state: AgenticMemoryKgProjectionStatusState;
	readonly cursor: AgenticMemoryKgProjectionCursor;
}

export type AgenticMemoryKgProjectionErrorCode =
	| AgenticMemoryErrorCode
	| "invalid-drafts-input"
	| "invalid-draft"
	| "duplicate-assertion-id"
	| "missing-record-ref"
	| "missing-fragment-ref"
	| "fragment-record-mismatch"
	| "invalid-assertion-shape";

export interface AgenticMemoryKgProjectionError {
	readonly code: AgenticMemoryKgProjectionErrorCode;
	readonly message: string;
	readonly index?: number;
	readonly assertionId?: FactId;
	readonly recordId?: FactId;
	readonly fragmentId?: FactId;
	readonly draft?: unknown;
	readonly record?: unknown;
	readonly validationErrors?: readonly string[];
	readonly cursor: AgenticMemoryKgProjectionCursor;
}

export interface AgenticMemoryKgProjectionSnapshot {
	readonly assertions: readonly KnowledgeAssertion[];
	readonly status: AgenticMemoryKgProjectionStatus;
	readonly errors: readonly AgenticMemoryKgProjectionError[];
	readonly cursor: AgenticMemoryKgProjectionCursor;
}

export interface AgenticMemoryKgProjectionBundle {
	readonly input: {
		readonly records: Node<readonly AgenticMemoryRecord[]>;
		readonly drafts: Node<readonly AgenticMemoryKgAssertionDraft[]>;
	};
	readonly projection: Node<AgenticMemoryKgProjectionSnapshot>;
	readonly assertions: Node<readonly KnowledgeAssertion[]>;
	readonly status: Node<AgenticMemoryKgProjectionStatus>;
	readonly errors: Node<readonly AgenticMemoryKgProjectionError[]>;
	readonly cursor: Node<AgenticMemoryKgProjectionCursor>;
}

export interface AgenticMemoryKgProjectionBundleOptions {
	readonly name?: string;
	readonly records: Node<readonly AgenticMemoryRecord[]>;
	readonly drafts: Node<readonly AgenticMemoryKgAssertionDraft[]>;
}

export const AGENTIC_MEMORY_RECORD_FRAME_FORMAT = "graphrefly.agenticMemoryRecord";
export const AGENTIC_MEMORY_RECORD_FRAME_VERSION = 1;

export interface AgenticMemoryFragmentFrame<TJson extends StrictJsonValue = StrictJsonValue> {
	readonly id: FactId;
	readonly payload: TJson;
	readonly tNs: string;
	readonly validFrom?: string;
	readonly validTo?: string;
	readonly confidence: number;
	readonly tags: readonly string[];
	readonly sources: readonly FactId[];
	readonly embedding?: readonly number[];
	readonly parentFragmentId?: FactId;
	readonly provenance?: string;
}

export interface AgenticMemoryRecordFrame<TJson extends StrictJsonValue = StrictJsonValue> {
	readonly format: typeof AGENTIC_MEMORY_RECORD_FRAME_FORMAT;
	readonly version: typeof AGENTIC_MEMORY_RECORD_FRAME_VERSION;
	readonly record: {
		readonly id: FactId;
		readonly kind: AgenticMemoryKind;
		readonly persistenceLevel: AgenticMemoryPersistenceLevel;
		readonly artifactKind: AgenticMemoryArtifactKind;
		readonly scope?: AgenticMemoryScope;
		readonly fragment: AgenticMemoryFragmentFrame<TJson>;
	};
}

export type AgenticMemoryRetentionCommand =
	| {
			readonly id: FactId;
			readonly kind: "archive";
			readonly recordId: FactId;
			readonly reason?: string;
	  }
	| {
			readonly id: FactId;
			readonly kind: "restore";
			readonly recordId: FactId;
			readonly persistenceLevel?: Exclude<AgenticMemoryPersistenceLevel, "archived">;
			readonly reason?: string;
	  }
	| {
			readonly id: FactId;
			readonly kind: "setPersistenceLevel";
			readonly recordId: FactId;
			readonly persistenceLevel: AgenticMemoryPersistenceLevel;
			readonly reason?: string;
	  }
	| {
			readonly id: FactId;
			readonly kind: "requestConsolidation";
			readonly recordIds: readonly FactId[];
			readonly requestId?: FactId;
			readonly reason?: string;
	  };

export interface AgenticMemoryConsolidationRequest {
	readonly id: FactId;
	readonly commandId: FactId;
	readonly recordIds: readonly FactId[];
	readonly reason?: string;
}

export interface AgenticMemoryRetentionCursor {
	readonly evaluation: number;
	readonly validRecords: number;
	readonly validCommands: number;
	readonly invalidCommands: number;
	readonly activeRecords: number;
	readonly archivedRecords: number;
	readonly consolidationRequests: number;
}

export interface AgenticMemoryRetentionStatus {
	readonly state: AgenticMemoryStatusState;
	readonly cursor: AgenticMemoryRetentionCursor;
}

export type AgenticMemoryRetentionErrorCode =
	| AgenticMemoryErrorCode
	| "invalid-commands-input"
	| "invalid-command"
	| "duplicate-command-id"
	| "missing-record-ref";

export interface AgenticMemoryRetentionError {
	readonly code: AgenticMemoryRetentionErrorCode;
	readonly message: string;
	readonly index?: number;
	readonly commandId?: FactId;
	readonly recordId?: FactId;
	readonly recordIds?: readonly FactId[];
	readonly command?: unknown;
	readonly record?: unknown;
	readonly validationErrors?: readonly string[];
	readonly cursor: AgenticMemoryRetentionCursor;
}

export interface AgenticMemoryRetentionSnapshot<T = unknown> {
	readonly activeRecords: readonly AgenticMemoryRecord<T>[];
	readonly archivedRecords: readonly AgenticMemoryRecord<T>[];
	readonly consolidationRequests: readonly AgenticMemoryConsolidationRequest[];
	readonly status: AgenticMemoryRetentionStatus;
	readonly errors: readonly AgenticMemoryRetentionError[];
	readonly cursor: AgenticMemoryRetentionCursor;
}

export interface AgenticMemoryRetentionBundle<T = unknown> {
	readonly input: {
		readonly records: Node<readonly AgenticMemoryRecord<T>[]>;
		readonly commands: Node<readonly AgenticMemoryRetentionCommand[]>;
	};
	readonly projection: Node<AgenticMemoryRetentionSnapshot<T>>;
	readonly activeRecords: Node<readonly AgenticMemoryRecord<T>[]>;
	readonly archivedRecords: Node<readonly AgenticMemoryRecord<T>[]>;
	readonly consolidationRequests: Node<readonly AgenticMemoryConsolidationRequest[]>;
	readonly status: Node<AgenticMemoryRetentionStatus>;
	readonly errors: Node<readonly AgenticMemoryRetentionError[]>;
	readonly cursor: Node<AgenticMemoryRetentionCursor>;
}

export interface AgenticMemoryRetentionBundleOptions<T = unknown> {
	readonly name?: string;
	readonly records: Node<readonly AgenticMemoryRecord<T>[]>;
	readonly commands: Node<readonly AgenticMemoryRetentionCommand[]>;
}

export type AgenticMemoryConsolidationOutcome<T = unknown> =
	| {
			readonly id: FactId;
			readonly requestId: FactId;
			readonly kind: "proposedRecords";
			readonly records: readonly AgenticMemoryRecord<T>[];
			readonly provenance?: string;
	  }
	| {
			readonly id: FactId;
			readonly requestId: FactId;
			readonly kind: "failed";
			readonly message: string;
			readonly provenance?: string;
	  };

export interface AgenticMemoryConsolidationRecordDraft<T = unknown> {
	readonly id: FactId;
	readonly requestId: FactId;
	readonly outcomeId: FactId;
	readonly record: AgenticMemoryRecord<T>;
}

export interface AgenticMemoryConsolidationCommand {
	readonly id: FactId;
	readonly kind: "proposeRecords" | "markFailed";
	readonly requestId: FactId;
	readonly outcomeId: FactId;
	readonly draftIds?: readonly FactId[];
	readonly message?: string;
}

export interface AgenticMemoryConsolidationResult {
	readonly id: FactId;
	readonly requestId: FactId;
	readonly outcomeId: FactId;
	readonly state: "proposed" | "failed";
	readonly sourceRecordIds: readonly FactId[];
	readonly proposedRecordIds: readonly FactId[];
	readonly message?: string;
	readonly provenance?: string;
}

export interface AgenticMemoryConsolidationCursor {
	readonly evaluation: number;
	readonly validRequests: number;
	readonly validOutcomes: number;
	readonly invalidOutcomes: number;
	readonly results: number;
	readonly proposedRecordDrafts: number;
}

export interface AgenticMemoryConsolidationStatus {
	readonly state: AgenticMemoryStatusState;
	readonly cursor: AgenticMemoryConsolidationCursor;
}

export type AgenticMemoryConsolidationErrorCode =
	| AgenticMemoryRetentionErrorCode
	| "invalid-outcomes-input"
	| "invalid-outcome"
	| "duplicate-outcome-id"
	| "missing-request-ref"
	| "invalid-proposed-record";

export interface AgenticMemoryConsolidationError {
	readonly code: AgenticMemoryConsolidationErrorCode;
	readonly message: string;
	readonly index?: number;
	readonly outcomeId?: FactId;
	readonly requestId?: FactId;
	readonly recordId?: FactId;
	readonly outcome?: unknown;
	readonly validationErrors?: readonly string[];
	readonly cursor: AgenticMemoryConsolidationCursor;
}

export interface AgenticMemoryConsolidationSnapshot<T = unknown> {
	readonly results: readonly AgenticMemoryConsolidationResult[];
	readonly proposedRecordDrafts: readonly AgenticMemoryConsolidationRecordDraft<T>[];
	readonly commands: readonly AgenticMemoryConsolidationCommand[];
	readonly status: AgenticMemoryConsolidationStatus;
	readonly errors: readonly AgenticMemoryConsolidationError[];
	readonly cursor: AgenticMemoryConsolidationCursor;
}

export interface AgenticMemoryConsolidationBundle<T = unknown> {
	readonly input: {
		readonly records: Node<readonly AgenticMemoryRecord<T>[]>;
		readonly requests: Node<readonly AgenticMemoryConsolidationRequest[]>;
		readonly outcomes: Node<readonly AgenticMemoryConsolidationOutcome<T>[]>;
	};
	readonly projection: Node<AgenticMemoryConsolidationSnapshot<T>>;
	readonly results: Node<readonly AgenticMemoryConsolidationResult[]>;
	readonly proposedRecordDrafts: Node<readonly AgenticMemoryConsolidationRecordDraft<T>[]>;
	readonly commands: Node<readonly AgenticMemoryConsolidationCommand[]>;
	readonly status: Node<AgenticMemoryConsolidationStatus>;
	readonly errors: Node<readonly AgenticMemoryConsolidationError[]>;
	readonly cursor: Node<AgenticMemoryConsolidationCursor>;
}

export interface AgenticMemoryConsolidationBundleOptions<T = unknown> {
	readonly name?: string;
	readonly records: Node<readonly AgenticMemoryRecord<T>[]>;
	readonly requests: Node<readonly AgenticMemoryConsolidationRequest[]>;
	readonly outcomes: Node<readonly AgenticMemoryConsolidationOutcome<T>[]>;
}

export interface AgenticMemoryContextText {
	readonly fragmentId: FactId;
	readonly text: string;
	readonly cost?: number;
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}

export interface AgenticMemoryContextPackingPolicy {
	readonly maxEntries?: number;
	readonly maxChars?: number;
	readonly maxCost?: number;
	readonly includeMetadata?: boolean;
}

export interface AgenticMemoryPackedContextEntry {
	readonly fragmentId: FactId;
	readonly text: string;
	readonly cost: number;
	readonly chars: number;
	readonly record?: AgenticMemoryRecordMetadata;
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}

export interface AgenticMemoryPackedContext {
	readonly entries: readonly AgenticMemoryPackedContextEntry[];
	readonly text: string;
	readonly totalChars: number;
	readonly totalCost: number;
	readonly truncated: boolean;
}

export interface AgenticMemoryContextPackingCursor {
	readonly evaluation: number;
	readonly inputEntries: number;
	readonly packedEntries: number;
	readonly omittedEntries: number;
	readonly totalChars: number;
	readonly totalCost: number;
}

export interface AgenticMemoryContextPackingStatus {
	readonly state: AgenticMemoryStatusState;
	readonly cursor: AgenticMemoryContextPackingCursor;
}

export type AgenticMemoryContextPackingErrorCode =
	| "invalid-context"
	| "invalid-texts-input"
	| "invalid-text"
	| "duplicate-text-fragment-id"
	| "missing-text"
	| "invalid-policy";

export interface AgenticMemoryContextPackingError {
	readonly code: AgenticMemoryContextPackingErrorCode;
	readonly message: string;
	readonly index?: number;
	readonly fragmentId?: FactId;
	readonly value?: unknown;
	readonly validationErrors?: readonly string[];
	readonly cursor: AgenticMemoryContextPackingCursor;
}

export interface AgenticMemoryContextPackingSnapshot {
	readonly packedContext: AgenticMemoryPackedContext;
	readonly status: AgenticMemoryContextPackingStatus;
	readonly errors: readonly AgenticMemoryContextPackingError[];
	readonly cursor: AgenticMemoryContextPackingCursor;
}

export interface AgenticMemoryContextPackingBundle<T = unknown> {
	readonly input: {
		readonly context: Node<AgenticMemoryContext<T>>;
		readonly texts: Node<readonly AgenticMemoryContextText[]>;
		readonly policy: Node<AgenticMemoryContextPackingPolicy>;
	};
	readonly projection: Node<AgenticMemoryContextPackingSnapshot>;
	readonly packedContext: Node<AgenticMemoryPackedContext>;
	readonly status: Node<AgenticMemoryContextPackingStatus>;
	readonly errors: Node<readonly AgenticMemoryContextPackingError[]>;
	readonly cursor: Node<AgenticMemoryContextPackingCursor>;
}

export interface AgenticMemoryContextPackingBundleOptions<T = unknown> {
	readonly name?: string;
	readonly context: Node<AgenticMemoryContext<T>>;
	readonly texts: Node<readonly AgenticMemoryContextText[]>;
	readonly policy: Node<AgenticMemoryContextPackingPolicy>;
}

interface ValidatedPackingContext {
	readonly entries: readonly AgenticMemoryContextEntry[];
}

export interface AgenticMemoryBundle<T = unknown> {
	readonly input: {
		readonly records: Node<readonly AgenticMemoryRecord<T>[]>;
		readonly query: Node<MemoryRetrievalQuery>;
	};
	readonly projection: Node<AgenticMemoryProjectionSnapshot<T>>;
	readonly retrieval: MemoryRetrievalBundle<T>;
	readonly retrievalSnapshot: Node<MemoryRetrievalSnapshot<T>>;
	readonly records: Node<readonly AgenticMemoryRecord<T>[]>;
	readonly fragments: Node<readonly MemoryFragment<T>[]>;
	readonly sources: Node<readonly AgenticMemorySourceProjection[]>;
	readonly indexed: Node<MemoryRetrievalIndex<T>>;
	readonly ranked: Node<MemoryAnswer<T>>;
	readonly context: Node<AgenticMemoryContext<T>>;
	readonly status: Node<AgenticMemoryStatus>;
	readonly errors: Node<readonly AgenticMemoryError[]>;
	readonly retrievalStatus: Node<MemoryRetrievalStatus>;
	readonly retrievalErrors: Node<readonly MemoryRetrievalError[]>;
	readonly cursor: Node<MemoryRetrievalCursor>;
}

export interface AgenticMemoryBundleOptions<T = unknown> {
	readonly name?: string;
	/** Explicit record-envelope input. Persistence, if needed, composes D161 outside this bundle. */
	readonly records: Node<readonly AgenticMemoryRecord<T>[]>;
	/** Explicit retrieval query input. */
	readonly query: Node<MemoryRetrievalQuery>;
}

/**
 * Compose graph-visible semantic-memory retrieval into an agentic-memory v0 bundle.
 *
 * The returned nodes are ordinary graph nodes with declared deps and DATA facts.
 * Invalid record envelopes and duplicate record ids stay graph-visible through
 * solution-level status/errors DATA facts. The lower retrieval bundle remains
 * visible and receives only projected MemoryFragment values.
 */
export function agenticMemoryBundle<T = unknown>(
	graph: Graph,
	opts: AgenticMemoryBundleOptions<T>,
): AgenticMemoryBundle<T> {
	const name = opts.name ?? "agenticMemory";
	const projection = agenticMemoryRecordProjection<T>(graph, opts.records, `${name}/projection`);
	const projectedRecords = agenticMemoryProjection(
		graph,
		projection,
		`${name}/records`,
		"agenticMemoryRecords",
		(fact) => fact.records,
	);
	const projectedFragments = agenticMemoryProjection(
		graph,
		projection,
		`${name}/fragments`,
		"agenticMemoryFragments",
		(fact) => fact.fragments,
	);
	const status = agenticMemoryProjection(
		graph,
		projection,
		`${name}/status`,
		"agenticMemoryStatus",
		(fact) => fact.status,
	);
	const errors = agenticMemoryProjection(
		graph,
		projection,
		`${name}/errors`,
		"agenticMemoryErrors",
		(fact) => fact.errors,
	);
	const retrieval = memoryRetrievalBundle<T>(graph, {
		name: `${name}/retrieval`,
		fragments: projectedFragments,
		query: opts.query,
	});
	const sources = agenticMemoryProjection(
		graph,
		projection,
		`${name}/sources`,
		"agenticMemorySources",
		(fact) =>
			Object.freeze(
				fact.fragments.map((fragment) =>
					Object.freeze({
						fragmentId: fragment.id,
						...(fact.metadataByFragmentId[fragment.id] === undefined
							? {}
							: { record: fact.metadataByFragmentId[fragment.id] }),
						sources: Object.freeze([...fragment.sources]),
						...(fragment.parentFragmentId === undefined
							? {}
							: { parentFragmentId: fragment.parentFragmentId }),
						...(fragment.provenance === undefined ? {} : { provenance: fragment.provenance }),
					}),
				),
			),
	);
	const context = agenticMemoryContextProjection(
		graph,
		projection,
		retrieval.snapshot,
		`${name}/context`,
	);

	return {
		input: { records: opts.records, query: opts.query },
		projection,
		retrieval,
		retrievalSnapshot: retrieval.snapshot,
		records: projectedRecords,
		fragments: projectedFragments,
		sources,
		indexed: retrieval.indexed,
		ranked: retrieval.ranked,
		context,
		status,
		errors,
		retrievalStatus: retrieval.status,
		retrievalErrors: retrieval.errors,
		cursor: retrieval.cursor,
	};
}

/**
 * D165 solution-level KG assertion projection.
 *
 * Records and explicit assertion drafts stay visible as declared deps. This
 * bundle validates references and shape, then emits DATA facts only; it does
 * not extract assertions, call LLMs, read/write storage, or mutate topology.
 */
export function agenticMemoryKgProjectionBundle(
	graph: Graph,
	opts: AgenticMemoryKgProjectionBundleOptions,
): AgenticMemoryKgProjectionBundle {
	const name = opts.name ?? "agenticMemoryKgProjection";
	const projection = graph.node<AgenticMemoryKgProjectionSnapshot>(
		[opts.records, opts.drafts],
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			const recordProjection = validateAndProjectRecords(depLatest(ctx, 0));
			const draftProjection = validateAndProjectKgDrafts(
				depLatest(ctx, 1),
				recordProjection.records,
			);
			const cursor: AgenticMemoryKgProjectionCursor = Object.freeze({
				evaluation: state.evaluation,
				validRecords: recordProjection.records.length,
				validDrafts: draftProjection.assertions.length,
				invalidDrafts: draftProjection.invalidDrafts,
				projectedAssertions: draftProjection.assertions.length,
			});
			const errors = Object.freeze(
				[...recordProjection.errors.map(kgErrorFromRecordError), ...draftProjection.errors].map(
					(error) => freezeError({ ...error, cursor }),
				),
			);
			const status: AgenticMemoryKgProjectionStatus = Object.freeze({
				state: agenticStatusState(errors.length, draftProjection.assertions.length),
				cursor,
			});
			ctx.state.set(state);
			ctx.down([
				[
					"DATA",
					Object.freeze({
						assertions: Object.freeze(draftProjection.assertions),
						status,
						errors,
						cursor,
					}),
				],
			]);
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryKgProjection",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { records: opts.records, drafts: opts.drafts },
		projection,
		assertions: solutionProjection(
			graph,
			projection,
			`${name}/assertions`,
			"agenticMemoryKgAssertions",
			(fact) => fact.assertions,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryKgStatus",
			(fact) => fact.status,
		),
		errors: solutionProjection(
			graph,
			projection,
			`${name}/errors`,
			"agenticMemoryKgErrors",
			(fact) => fact.errors,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryKgCursor",
			(fact) => fact.cursor,
		),
	};
}

/** Build a D166 strict-JSON frame from an in-memory AgenticMemoryRecord. */
export function agenticMemoryRecordFrame<TJson extends StrictJsonValue>(
	record: AgenticMemoryRecord<TJson>,
): AgenticMemoryRecordFrame<TJson> {
	const result = validateAndSnapshotRecord<TJson>(record, 0);
	if (result.errors.length > 0 || result.record === undefined) {
		throw new TypeError(
			`agenticMemoryRecordFrame: invalid record: ${result.errors
				.flatMap((error) => error.validationErrors ?? [error.message])
				.join("; ")}`,
		);
	}
	assertAgenticMemoryRecordCodecShape(record);
	assertStrictJsonValue(result.record.fragment.payload, "record.fragment.payload");
	return Object.freeze({
		format: AGENTIC_MEMORY_RECORD_FRAME_FORMAT,
		version: AGENTIC_MEMORY_RECORD_FRAME_VERSION,
		record: Object.freeze({
			id: result.record.id,
			kind: result.record.kind,
			persistenceLevel: result.record.persistenceLevel,
			artifactKind: result.record.artifactKind,
			...(result.record.scope === undefined ? {} : { scope: result.record.scope }),
			fragment: fragmentFrame(result.record.fragment as MemoryFragment<TJson>),
		}),
	});
}

/** Assert and snapshot a decoded D166 record frame. Unknown fields fail honestly. */
export function assertAgenticMemoryRecordFrame<TJson extends StrictJsonValue = StrictJsonValue>(
	value: unknown,
): AgenticMemoryRecordFrame<TJson> {
	if (!isPlainRecord(value))
		throw new TypeError("agenticMemoryRecordFrame: frame must be an object");
	assertStrictJsonValue(value, "agenticMemoryRecordFrame");
	assertExactKeys(value, ["format", "record", "version"], "agenticMemoryRecordFrame");
	if (value.format !== AGENTIC_MEMORY_RECORD_FRAME_FORMAT) {
		throw new TypeError("agenticMemoryRecordFrame: invalid format");
	}
	if (value.version !== AGENTIC_MEMORY_RECORD_FRAME_VERSION) {
		throw new TypeError("agenticMemoryRecordFrame: invalid version");
	}
	const rawRecord = value.record;
	if (!isPlainRecord(rawRecord)) {
		throw new TypeError("agenticMemoryRecordFrame: record must be an object");
	}
	assertExactKeys(
		rawRecord,
		rawRecord.scope === undefined
			? ["artifactKind", "fragment", "id", "kind", "persistenceLevel"]
			: ["artifactKind", "fragment", "id", "kind", "persistenceLevel", "scope"],
		"agenticMemoryRecordFrame.record",
	);
	const rawFragment = rawRecord.fragment;
	if (!isPlainRecord(rawFragment)) {
		throw new TypeError("agenticMemoryRecordFrame: fragment must be an object");
	}
	assertExactKeys(
		rawFragment,
		[
			"id",
			"payload",
			"tNs",
			...(rawFragment.validFrom === undefined ? [] : ["validFrom"]),
			...(rawFragment.validTo === undefined ? [] : ["validTo"]),
			"confidence",
			"tags",
			"sources",
			...(rawFragment.embedding === undefined ? [] : ["embedding"]),
			...(rawFragment.parentFragmentId === undefined ? [] : ["parentFragmentId"]),
			...(rawFragment.provenance === undefined ? [] : ["provenance"]),
		],
		"agenticMemoryRecordFrame.record.fragment",
	);
	if (rawRecord.scope !== undefined) assertScopeFrame(rawRecord.scope);
	const frame = value as unknown as AgenticMemoryRecordFrame<TJson>;
	const decoded = recordFromFrame(frame);
	const roundtrip = agenticMemoryRecordFrame(decoded);
	return roundtrip as AgenticMemoryRecordFrame<TJson>;
}

/** Strict canonical JSON codec for D166 AgenticMemoryRecordFrame values. */
export function agenticMemoryRecordFrameCodec<
	TJson extends StrictJsonValue = StrictJsonValue,
>(): Codec<AgenticMemoryRecordFrame<TJson>> {
	return {
		encode(value: AgenticMemoryRecordFrame<TJson>): Uint8Array {
			return strictJsonCodec.encode(assertAgenticMemoryRecordFrame<TJson>(value));
		},
		decode(bytes: Uint8Array): AgenticMemoryRecordFrame<TJson> {
			return assertAgenticMemoryRecordFrame<TJson>(strictJsonCodec.decode(bytes));
		},
	};
}

/** Strict canonical JSON codec that persists records and decodes bigint fields back to bigint. */
export function agenticMemoryRecordCodec<TJson extends StrictJsonValue = StrictJsonValue>(): Codec<
	AgenticMemoryRecord<TJson>
> {
	const frameCodec = agenticMemoryRecordFrameCodec<TJson>();
	return {
		encode(value: AgenticMemoryRecord<TJson>): Uint8Array {
			return frameCodec.encode(agenticMemoryRecordFrame(value));
		},
		decode(bytes: Uint8Array): AgenticMemoryRecord<TJson> {
			return recordFromFrame(frameCodec.decode(bytes));
		},
	};
}

/**
 * D167 solution-level retention command projection.
 *
 * Archive/restore/setPersistenceLevel are derived views over current records;
 * requestConsolidation emits request facts only.
 */
export function agenticMemoryRetentionBundle<T = unknown>(
	graph: Graph,
	opts: AgenticMemoryRetentionBundleOptions<T>,
): AgenticMemoryRetentionBundle<T> {
	const name = opts.name ?? "agenticMemoryRetention";
	const projection = graph.node<AgenticMemoryRetentionSnapshot<T>>(
		[opts.records, opts.commands],
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			const recordProjection = validateAndProjectRecords<T>(depLatest(ctx, 0));
			const retention = projectRetention<T>(depLatest(ctx, 1), recordProjection.records);
			const cursor: AgenticMemoryRetentionCursor = Object.freeze({
				evaluation: state.evaluation,
				validRecords: recordProjection.records.length,
				validCommands: retention.validCommands,
				invalidCommands: retention.invalidCommands,
				activeRecords: retention.activeRecords.length,
				archivedRecords: retention.archivedRecords.length,
				consolidationRequests: retention.consolidationRequests.length,
			});
			const errors = Object.freeze(
				[...recordProjection.errors.map(retentionErrorFromRecordError), ...retention.errors].map(
					(error) => freezeError({ ...error, cursor }),
				),
			);
			const status: AgenticMemoryRetentionStatus = Object.freeze({
				state: agenticStatusState(errors.length, recordProjection.records.length),
				cursor,
			});
			ctx.state.set(state);
			ctx.down([
				[
					"DATA",
					Object.freeze({
						activeRecords: Object.freeze(retention.activeRecords),
						archivedRecords: Object.freeze(retention.archivedRecords),
						consolidationRequests: Object.freeze(retention.consolidationRequests),
						status,
						errors,
						cursor,
					}),
				],
			]);
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryRetention",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { records: opts.records, commands: opts.commands },
		projection,
		activeRecords: solutionProjection(
			graph,
			projection,
			`${name}/activeRecords`,
			"agenticMemoryRetentionActiveRecords",
			(fact) => fact.activeRecords,
		),
		archivedRecords: solutionProjection(
			graph,
			projection,
			`${name}/archivedRecords`,
			"agenticMemoryRetentionArchivedRecords",
			(fact) => fact.archivedRecords,
		),
		consolidationRequests: solutionProjection(
			graph,
			projection,
			`${name}/consolidationRequests`,
			"agenticMemoryRetentionConsolidationRequests",
			(fact) => fact.consolidationRequests,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryRetentionStatus",
			(fact) => fact.status,
		),
		errors: solutionProjection(
			graph,
			projection,
			`${name}/errors`,
			"agenticMemoryRetentionErrors",
			(fact) => fact.errors,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryRetentionCursor",
			(fact) => fact.cursor,
		),
	};
}

/**
 * D171 consolidation outcome projection.
 *
 * The bundle does not execute consolidation. External adapters may publish
 * outcome facts, and this projection turns them into visible result/proposal
 * facts for downstream record-creation policy.
 */
export function agenticMemoryConsolidationBundle<T = unknown>(
	graph: Graph,
	opts: AgenticMemoryConsolidationBundleOptions<T>,
): AgenticMemoryConsolidationBundle<T> {
	const name = opts.name ?? "agenticMemoryConsolidation";
	const projection = graph.node<AgenticMemoryConsolidationSnapshot<T>>(
		[opts.records, opts.requests, opts.outcomes],
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			const recordProjection = validateAndProjectRecords<T>(depLatest(ctx, 0));
			const requests = validateConsolidationRequests(depLatest(ctx, 1), recordProjection.records);
			const outcomes = projectConsolidationOutcomes<T>(
				depLatest(ctx, 2),
				requests.requests,
				state.evaluation,
			);
			const cursor: AgenticMemoryConsolidationCursor = Object.freeze({
				evaluation: state.evaluation,
				validRequests: requests.requests.length,
				validOutcomes: outcomes.validOutcomes,
				invalidOutcomes: outcomes.invalidOutcomes,
				results: outcomes.results.length,
				proposedRecordDrafts: outcomes.proposedRecordDrafts.length,
			});
			const errors = Object.freeze(
				[
					...recordProjection.errors.map(consolidationErrorFromRecordError),
					...requests.errors.map(consolidationErrorFromRetentionError),
					...outcomes.errors,
				].map((error) => freezeError({ ...error, cursor })),
			);
			const status: AgenticMemoryConsolidationStatus = Object.freeze({
				state: agenticStatusState(errors.length, outcomes.results.length),
				cursor,
			});
			ctx.state.set(state);
			ctx.down([
				[
					"DATA",
					Object.freeze({
						results: Object.freeze(outcomes.results),
						proposedRecordDrafts: Object.freeze(outcomes.proposedRecordDrafts),
						commands: Object.freeze(outcomes.commands),
						status,
						errors,
						cursor,
					}),
				],
			]);
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryConsolidation",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { records: opts.records, requests: opts.requests, outcomes: opts.outcomes },
		projection,
		results: solutionProjection(
			graph,
			projection,
			`${name}/results`,
			"agenticMemoryConsolidationResults",
			(fact) => fact.results,
		),
		proposedRecordDrafts: solutionProjection(
			graph,
			projection,
			`${name}/proposedRecordDrafts`,
			"agenticMemoryConsolidationRecordDrafts",
			(fact) => fact.proposedRecordDrafts,
		),
		commands: solutionProjection(
			graph,
			projection,
			`${name}/commands`,
			"agenticMemoryConsolidationCommands",
			(fact) => fact.commands,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryConsolidationStatus",
			(fact) => fact.status,
		),
		errors: solutionProjection(
			graph,
			projection,
			`${name}/errors`,
			"agenticMemoryConsolidationErrors",
			(fact) => fact.errors,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryConsolidationCursor",
			(fact) => fact.cursor,
		),
	};
}

/** D168 deterministic context-packing bundle over explicit context text facts. */
export function agenticMemoryContextPackingBundle<T = unknown>(
	graph: Graph,
	opts: AgenticMemoryContextPackingBundleOptions<T>,
): AgenticMemoryContextPackingBundle<T> {
	const name = opts.name ?? "agenticMemoryContextPacking";
	const projection = graph.node<AgenticMemoryContextPackingSnapshot>(
		[opts.context, opts.texts, opts.policy],
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			const packed = packContext(
				depLatest(ctx, 0),
				depLatest(ctx, 1),
				depLatest(ctx, 2),
				state.evaluation,
			);
			ctx.state.set(state);
			ctx.down([["DATA", packed]]);
		},
		{
			name: `${name}/projection`,
			factory: "agenticMemoryContextPacking",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { context: opts.context, texts: opts.texts, policy: opts.policy },
		projection,
		packedContext: solutionProjection(
			graph,
			projection,
			`${name}/packedContext`,
			"agenticMemoryPackedContext",
			(fact) => fact.packedContext,
		),
		status: solutionProjection(
			graph,
			projection,
			`${name}/status`,
			"agenticMemoryContextPackingStatus",
			(fact) => fact.status,
		),
		errors: solutionProjection(
			graph,
			projection,
			`${name}/errors`,
			"agenticMemoryContextPackingErrors",
			(fact) => fact.errors,
		),
		cursor: solutionProjection(
			graph,
			projection,
			`${name}/cursor`,
			"agenticMemoryContextPackingCursor",
			(fact) => fact.cursor,
		),
	};
}

function solutionProjection<TFact, TSnapshot>(
	graph: Graph,
	snapshot: Node<TSnapshot>,
	name: string,
	factory: string,
	select: (fact: TSnapshot) => TFact,
): Node<TFact> {
	return graph.node<TFact>(
		[snapshot],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				ctx.down([["DATA", select(raw as TSnapshot)]]);
			}
		},
		{
			name,
			factory,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

function agenticMemoryProjection<TFact, T>(
	graph: Graph,
	snapshot: Node<AgenticMemoryProjectionSnapshot<T>>,
	name: string,
	factory: string,
	select: (fact: AgenticMemoryProjectionSnapshot<T>) => TFact,
): Node<TFact> {
	return graph.node<TFact>(
		[snapshot],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				ctx.down([["DATA", select(raw as AgenticMemoryProjectionSnapshot<T>)]]);
			}
		},
		{
			name,
			factory,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

function agenticMemoryContextProjection<T>(
	graph: Graph,
	projection: Node<AgenticMemoryProjectionSnapshot<T>>,
	retrieval: Node<MemoryRetrievalSnapshot<T>>,
	name: string,
): Node<AgenticMemoryContext<T>> {
	return graph.node<AgenticMemoryContext<T>>(
		[projection, retrieval],
		(ctx) => {
			const projectionFact = depLatest(ctx, 0) as AgenticMemoryProjectionSnapshot<T> | undefined;
			const retrievalFacts = depBatch(ctx, 1) ?? [];
			if (projectionFact === undefined || retrievalFacts.length === 0) return;
			for (const raw of retrievalFacts) {
				ctx.down([
					["DATA", contextFromSnapshot(projectionFact, raw as MemoryRetrievalSnapshot<T>)],
				]);
			}
		},
		{
			name,
			factory: "agenticMemoryContext",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

function contextFromSnapshot<T>(
	projection: AgenticMemoryProjectionSnapshot<T>,
	retrieval: MemoryRetrievalSnapshot<T>,
): AgenticMemoryContext<T> {
	const entries = retrieval.ranked.results.map((fragment) =>
		Object.freeze({
			fragmentId: fragment.id,
			payload: fragment.payload,
			confidence: fragment.confidence,
			tags: fragment.tags,
			sources: fragment.sources,
			...(projection.metadataByFragmentId[fragment.id] === undefined
				? {}
				: { record: projection.metadataByFragmentId[fragment.id] }),
			fragment,
		}),
	);
	const hasContext = entries.length > 0;
	const state = contextState(projection.status.state, retrieval.status.state);
	return Object.freeze({
		state,
		query: retrieval.ranked.query,
		entries: Object.freeze(entries),
		cursor: retrieval.cursor,
		errors: projection.errors,
		retrievalErrors: retrieval.errors,
		contextReady: hasContext && (state === "ready" || state === "partial"),
	});
}

function agenticMemoryRecordProjection<T>(
	graph: Graph,
	records: Node<readonly AgenticMemoryRecord<T>[]>,
	name: string,
): Node<AgenticMemoryProjectionSnapshot<T>> {
	return graph.node<AgenticMemoryProjectionSnapshot<T>>(
		[records],
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			const rawRecords = (depBatch(ctx, 0) ?? []).at(-1);
			const projected = validateAndProjectRecords<T>(rawRecords);
			const cursor: AgenticMemoryProjectionCursor = Object.freeze({
				evaluation: state.evaluation,
				validRecords: projected.records.length,
				invalidRecords: projected.invalidRecordIndexes.size,
				projectedFragments: projected.fragments.length,
			});
			const status: AgenticMemoryStatus = Object.freeze({
				state: agenticStatusState(projected.errors.length, projected.records.length),
				cursor,
			});
			const errors = Object.freeze(
				projected.errors.map((error) =>
					Object.freeze({
						...error,
						...(error.validationErrors === undefined
							? {}
							: { validationErrors: Object.freeze([...error.validationErrors]) }),
						cursor,
					}),
				),
			);
			ctx.state.set(state);
			ctx.down([
				[
					"DATA",
					Object.freeze({
						records: Object.freeze(projected.records),
						fragments: Object.freeze(projected.fragments),
						metadataByFragmentId: Object.freeze(projected.metadataByFragmentId),
						status,
						errors,
						cursor,
					}),
				],
			]);
		},
		{
			name,
			factory: "agenticMemoryProjection",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

function validateAndProjectKgDrafts(
	value: unknown,
	records: readonly AgenticMemoryRecord[],
): {
	readonly assertions: KnowledgeAssertion[];
	readonly errors: Omit<AgenticMemoryKgProjectionError, "cursor">[];
	readonly invalidDrafts: number;
} {
	const assertions: KnowledgeAssertion[] = [];
	const errors: Omit<AgenticMemoryKgProjectionError, "cursor">[] = [];
	let invalidDrafts = 0;
	if (!Array.isArray(value)) {
		return {
			assertions,
			invalidDrafts: 1,
			errors: [
				{
					code: "invalid-drafts-input",
					message: "agenticMemoryKgProjectionBundle: drafts input must be an array",
					draft: value,
				},
			],
		};
	}
	const length = safeArrayLength(value);
	if (length === undefined) {
		return {
			assertions,
			invalidDrafts: 1,
			errors: [
				{
					code: "invalid-drafts-input",
					message: "agenticMemoryKgProjectionBundle: drafts input length could not be read",
					draft: value,
				},
			],
		};
	}
	const recordById = new Map(records.map((record) => [record.id, record]));
	const fragmentToRecord = new Map(records.map((record) => [record.fragment.id, record.id]));
	const seenAssertions = new Set<FactId>();
	for (let i = 0; i < length; i += 1) {
		let raw: unknown;
		try {
			raw = value[i];
			const result = validateKgDraft(raw, i);
			if (result.errors.length > 0 || result.draft === undefined) {
				invalidDrafts += 1;
				errors.push(...result.errors);
				continue;
			}
			const draft = result.draft;
			if (seenAssertions.has(draft.id)) {
				invalidDrafts += 1;
				errors.push({
					code: "duplicate-assertion-id",
					message: "agenticMemoryKgProjectionBundle: duplicate assertion id",
					index: i,
					assertionId: draft.id,
					recordId: draft.recordId,
					fragmentId: draft.fragmentId,
					draft: raw,
					validationErrors: [`duplicate assertion id '${draft.id}'`],
				});
				continue;
			}
			const record = recordById.get(draft.recordId);
			if (record === undefined) {
				invalidDrafts += 1;
				errors.push({
					code: "missing-record-ref",
					message: "agenticMemoryKgProjectionBundle: draft references a missing record",
					index: i,
					assertionId: draft.id,
					recordId: draft.recordId,
					fragmentId: draft.fragmentId,
					draft: raw,
					validationErrors: [`record '${draft.recordId}' is not projected`],
				});
				continue;
			}
			const owner = fragmentToRecord.get(draft.fragmentId);
			if (owner === undefined) {
				invalidDrafts += 1;
				errors.push({
					code: "missing-fragment-ref",
					message: "agenticMemoryKgProjectionBundle: draft references a missing fragment",
					index: i,
					assertionId: draft.id,
					recordId: draft.recordId,
					fragmentId: draft.fragmentId,
					draft: raw,
					validationErrors: [`fragment '${draft.fragmentId}' is not projected`],
				});
				continue;
			}
			if (owner !== draft.recordId || record.fragment.id !== draft.fragmentId) {
				invalidDrafts += 1;
				errors.push({
					code: "fragment-record-mismatch",
					message: "agenticMemoryKgProjectionBundle: draft record and fragment refs disagree",
					index: i,
					assertionId: draft.id,
					recordId: draft.recordId,
					fragmentId: draft.fragmentId,
					draft: raw,
					validationErrors: [
						`fragment '${draft.fragmentId}' belongs to record '${owner}', not '${draft.recordId}'`,
					],
				});
				continue;
			}
			seenAssertions.add(draft.id);
			assertions.push(
				Object.freeze({
					id: draft.id,
					recordId: draft.recordId,
					fragmentId: draft.fragmentId,
					subject: draft.subject,
					predicate: draft.predicate,
					object: draft.object,
					...(draft.confidence === undefined ? {} : { confidence: draft.confidence }),
					sources: Object.freeze(draft.sources ?? [draft.fragmentId]),
					...(draft.provenance === undefined ? {} : { provenance: draft.provenance }),
				}),
			);
		} catch (error) {
			invalidDrafts += 1;
			errors.push({
				code: "invalid-draft",
				message: `agenticMemoryKgProjectionBundle: draft access failed: ${errorMessage(error)}`,
				index: i,
				draft: raw,
				validationErrors: ["draft access failed"],
			});
		}
	}
	return { assertions, errors, invalidDrafts };
}

function validateKgDraft(
	value: unknown,
	index: number,
): {
	readonly draft?: AgenticMemoryKgAssertionDraft;
	readonly errors: Omit<AgenticMemoryKgProjectionError, "cursor">[];
} {
	const errors: Omit<AgenticMemoryKgProjectionError, "cursor">[] = [];
	if (!isPlainRecord(value)) {
		return {
			errors: [
				{
					code: "invalid-draft",
					message: "agenticMemoryKgProjectionBundle: draft must be an object",
					index,
					draft: value,
				},
			],
		};
	}
	const raw = value as Partial<AgenticMemoryKgAssertionDraft>;
	const id = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : undefined;
	const recordId =
		typeof raw.recordId === "string" && raw.recordId.length > 0 ? raw.recordId : undefined;
	const fragmentId =
		typeof raw.fragmentId === "string" && raw.fragmentId.length > 0 ? raw.fragmentId : undefined;
	const subject = validateAssertionSubject(raw.subject);
	const object = validateAssertionObject(raw.object);
	const shapeErrors: string[] = [];
	if (id === undefined) shapeErrors.push("draft.id must be a non-empty string");
	if (recordId === undefined) {
		shapeErrors.push("draft.recordId must be a non-empty string");
	}
	if (fragmentId === undefined) {
		shapeErrors.push("draft.fragmentId must be a non-empty string");
	}
	shapeErrors.push(...subject.errors);
	if (typeof raw.predicate !== "string" || raw.predicate.length === 0) {
		shapeErrors.push("draft.predicate must be a non-empty string");
	}
	shapeErrors.push(...object.errors);
	if (
		raw.confidence !== undefined &&
		(!Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1)
	) {
		shapeErrors.push("draft.confidence must be a finite number in [0, 1]");
	}
	if (raw.sources !== undefined && !isDenseArrayOf(raw.sources, isNonEmptyString)) {
		shapeErrors.push("draft.sources must be a readonly string array");
	}
	if (raw.provenance !== undefined && typeof raw.provenance !== "string") {
		shapeErrors.push("draft.provenance must be a string when present");
	}
	if (shapeErrors.length > 0) errors.push(kgShapeError(index, value, ...shapeErrors));
	if (errors.length > 0 || id === undefined || recordId === undefined || fragmentId === undefined) {
		return { errors };
	}
	return {
		draft: Object.freeze({
			id,
			recordId,
			fragmentId,
			subject: subject.subject as KnowledgeAssertionSubject,
			predicate: raw.predicate as string,
			object: object.object as KnowledgeAssertionObject,
			...(raw.confidence === undefined ? {} : { confidence: raw.confidence }),
			...(raw.sources === undefined ? {} : { sources: Object.freeze([...raw.sources]) }),
			...(raw.provenance === undefined ? {} : { provenance: raw.provenance }),
		}),
		errors,
	};
}

function validateAssertionSubject(value: unknown): {
	readonly subject?: KnowledgeAssertionSubject;
	readonly errors: readonly string[];
} {
	if (!isPlainRecord(value)) return { errors: ["subject must be an object"] };
	const id = value.id;
	const type = value.type;
	const errors: string[] = [];
	if (typeof id !== "string" || id.length === 0) errors.push("subject.id must be non-empty");
	if (type !== undefined && (typeof type !== "string" || type.length === 0)) {
		errors.push("subject.type must be a non-empty string when present");
	}
	if (errors.length > 0) return { errors };
	return {
		subject: Object.freeze({
			id: id as string,
			...(type === undefined ? {} : { type: type as string }),
		}),
		errors,
	};
}

function validateAssertionObject(value: unknown): {
	readonly object?: KnowledgeAssertionObject;
	readonly errors: readonly string[];
} {
	if (!isPlainRecord(value)) return { errors: ["object must be an object"] };
	const kind = value.kind;
	const errors: string[] = [];
	if (kind === "entity") {
		if (typeof value.id !== "string" || value.id.length === 0) {
			errors.push("object.id must be non-empty for entity objects");
		}
		if (value.type !== undefined && (typeof value.type !== "string" || value.type.length === 0)) {
			errors.push("object.type must be a non-empty string when present");
		}
		if (Object.hasOwn(value, "value")) errors.push("entity object must not include value");
		if (errors.length > 0) return { errors };
		return {
			object: Object.freeze({
				kind: "entity",
				id: value.id as string,
				...(value.type === undefined ? {} : { type: value.type as string }),
			}),
			errors,
		};
	}
	if (kind === "value") {
		if (!Object.hasOwn(value, "value")) errors.push("value object must include value");
		else {
			try {
				assertStrictJsonValue(value.value, "object.value");
			} catch (error) {
				errors.push(errorMessage(error));
			}
		}
		if (
			value.valueType !== undefined &&
			(typeof value.valueType !== "string" || value.valueType.length === 0)
		) {
			errors.push("object.valueType must be a non-empty string when present");
		}
		if (Object.hasOwn(value, "id")) errors.push("value object must not include id");
		if (errors.length > 0) return { errors };
		return {
			object: Object.freeze({
				kind: "value",
				value: value.value as StrictJsonValue,
				...(value.valueType === undefined ? {} : { valueType: value.valueType as string }),
			}),
			errors,
		};
	}
	return { errors: ["object.kind must be entity or value"] };
}

function kgShapeError(
	index: number,
	draft: unknown,
	...validationErrors: readonly string[]
): Omit<AgenticMemoryKgProjectionError, "cursor"> {
	return {
		code: "invalid-assertion-shape",
		message: "agenticMemoryKgProjectionBundle: draft assertion shape is invalid",
		index,
		draft,
		validationErrors: Object.freeze([...validationErrors]),
	};
}

function kgErrorFromRecordError(
	error: Omit<AgenticMemoryError, "cursor">,
): Omit<AgenticMemoryKgProjectionError, "cursor"> {
	return {
		...error,
		code: error.code,
	};
}

function fragmentFrame<TJson extends StrictJsonValue>(
	fragment: MemoryFragment<TJson>,
): AgenticMemoryFragmentFrame<TJson> {
	return Object.freeze({
		id: fragment.id,
		payload: fragment.payload,
		tNs: decimalBigIntString(fragment.tNs, "fragment.tNs"),
		...(fragment.validFrom === undefined
			? {}
			: { validFrom: decimalBigIntString(fragment.validFrom, "fragment.validFrom") }),
		...(fragment.validTo === undefined
			? {}
			: { validTo: decimalBigIntString(fragment.validTo, "fragment.validTo") }),
		confidence: fragment.confidence,
		tags: Object.freeze([...fragment.tags]),
		sources: Object.freeze([...fragment.sources]),
		...(fragment.embedding === undefined
			? {}
			: { embedding: Object.freeze([...fragment.embedding]) }),
		...(fragment.parentFragmentId === undefined
			? {}
			: { parentFragmentId: fragment.parentFragmentId }),
		...(fragment.provenance === undefined ? {} : { provenance: fragment.provenance }),
	});
}

function recordFromFrame<TJson extends StrictJsonValue>(
	frame: AgenticMemoryRecordFrame<TJson>,
): AgenticMemoryRecord<TJson> {
	const fragment = frame.record.fragment;
	const record: AgenticMemoryRecord<TJson> = {
		id: assertNonEmptyString(frame.record.id, "record.id"),
		kind: assertKindValue(frame.record.kind),
		persistenceLevel: assertPersistenceLevelValue(frame.record.persistenceLevel),
		artifactKind: assertArtifactKindValue(frame.record.artifactKind),
		...(frame.record.scope === undefined ? {} : { scope: assertScopeFrame(frame.record.scope) }),
		fragment: {
			id: assertNonEmptyString(fragment.id, "fragment.id"),
			payload: assertStrictJsonValue(fragment.payload, "fragment.payload") as TJson,
			tNs: parseDecimalBigInt(fragment.tNs, "fragment.tNs"),
			...(fragment.validFrom === undefined
				? {}
				: { validFrom: parseDecimalBigInt(fragment.validFrom, "fragment.validFrom") }),
			...(fragment.validTo === undefined
				? {}
				: { validTo: parseDecimalBigInt(fragment.validTo, "fragment.validTo") }),
			confidence: assertConfidence(fragment.confidence, "fragment.confidence"),
			tags: assertStringArray(fragment.tags, "fragment.tags"),
			sources: assertStringArray(fragment.sources, "fragment.sources"),
			...(fragment.embedding === undefined
				? {}
				: { embedding: assertFiniteNumberArray(fragment.embedding, "fragment.embedding") }),
			...(fragment.parentFragmentId === undefined
				? {}
				: {
						parentFragmentId: assertNonEmptyString(fragment.parentFragmentId, "parentFragmentId"),
					}),
			...(fragment.provenance === undefined
				? {}
				: { provenance: assertString(fragment.provenance, "provenance") }),
		},
	};
	const result = validateAndSnapshotRecord<TJson>(record, 0);
	if (result.errors.length > 0 || result.record === undefined) {
		throw new TypeError(
			`agenticMemoryRecordFrame: decoded record is invalid: ${result.errors
				.flatMap((error) => error.validationErrors ?? [error.message])
				.join("; ")}`,
		);
	}
	return result.record;
}

function projectRetention<T>(
	value: unknown,
	records: readonly AgenticMemoryRecord<T>[],
): {
	readonly activeRecords: AgenticMemoryRecord<T>[];
	readonly archivedRecords: AgenticMemoryRecord<T>[];
	readonly consolidationRequests: AgenticMemoryConsolidationRequest[];
	readonly errors: Omit<AgenticMemoryRetentionError, "cursor">[];
	readonly validCommands: number;
	readonly invalidCommands: number;
} {
	const byId = new Map(records.map((record) => [record.id, record]));
	const view = new Map(records.map((record) => [record.id, record]));
	const requests: AgenticMemoryConsolidationRequest[] = [];
	const errors: Omit<AgenticMemoryRetentionError, "cursor">[] = [];
	let validCommands = 0;
	let invalidCommands = 0;
	if (!Array.isArray(value)) {
		return {
			activeRecords: records.filter((record) => record.persistenceLevel !== "archived"),
			archivedRecords: records.filter((record) => record.persistenceLevel === "archived"),
			consolidationRequests: requests,
			validCommands,
			invalidCommands: 1,
			errors: [
				{
					code: "invalid-commands-input",
					message: "agenticMemoryRetentionBundle: commands input must be an array",
					command: value,
				},
			],
		};
	}
	const length = safeArrayLength(value);
	if (length === undefined) {
		return {
			activeRecords: records.filter((record) => record.persistenceLevel !== "archived"),
			archivedRecords: records.filter((record) => record.persistenceLevel === "archived"),
			consolidationRequests: requests,
			validCommands,
			invalidCommands: 1,
			errors: [
				{
					code: "invalid-commands-input",
					message: "agenticMemoryRetentionBundle: commands input length could not be read",
					command: value,
				},
			],
		};
	}
	const seenCommands = new Set<FactId>();
	for (let i = 0; i < length; i += 1) {
		let raw: unknown;
		try {
			raw = value[i];
			const result = validateRetentionCommand(raw, i);
			if (result.errors.length > 0 || result.command === undefined) {
				invalidCommands += 1;
				errors.push(...result.errors);
				continue;
			}
			const command = result.command;
			if (seenCommands.has(command.id)) {
				invalidCommands += 1;
				errors.push({
					code: "duplicate-command-id",
					message: "agenticMemoryRetentionBundle: duplicate command id",
					index: i,
					commandId: command.id,
					command: raw,
					validationErrors: [`duplicate command id '${command.id}'`],
				});
				continue;
			}
			const missing = retentionMissingRecords(command, byId);
			if (missing.length > 0) {
				invalidCommands += 1;
				errors.push({
					code: "missing-record-ref",
					message: "agenticMemoryRetentionBundle: command references missing records",
					index: i,
					commandId: command.id,
					recordId: "recordId" in command ? command.recordId : undefined,
					recordIds: Object.freeze(missing),
					command: raw,
					validationErrors: Object.freeze(missing.map((id) => `record '${id}' is not projected`)),
				});
				continue;
			}
			seenCommands.add(command.id);
			validCommands += 1;
			applyRetentionCommand(command, byId, view, requests);
		} catch (error) {
			invalidCommands += 1;
			errors.push({
				code: "invalid-command",
				message: `agenticMemoryRetentionBundle: command access failed: ${errorMessage(error)}`,
				index: i,
				command: raw,
				validationErrors: ["command access failed"],
			});
		}
	}
	const projected = records.map((record) => view.get(record.id) ?? record);
	return {
		activeRecords: projected.filter((record) => record.persistenceLevel !== "archived"),
		archivedRecords: projected.filter((record) => record.persistenceLevel === "archived"),
		consolidationRequests: requests,
		errors,
		validCommands,
		invalidCommands,
	};
}

function validateRetentionCommand(
	value: unknown,
	index: number,
): {
	readonly command?: AgenticMemoryRetentionCommand;
	readonly errors: Omit<AgenticMemoryRetentionError, "cursor">[];
} {
	if (!isPlainRecord(value)) {
		return {
			errors: [
				{
					code: "invalid-command",
					message: "agenticMemoryRetentionBundle: command must be an object",
					index,
					command: value,
				},
			],
		};
	}
	const id = typeof value.id === "string" && value.id.length > 0 ? value.id : undefined;
	const kind = value.kind;
	const errors: string[] = [];
	if (id === undefined) errors.push("command.id must be a non-empty string");
	if (
		kind !== "archive" &&
		kind !== "restore" &&
		kind !== "setPersistenceLevel" &&
		kind !== "requestConsolidation"
	) {
		errors.push("command.kind is invalid");
	}
	if (value.reason !== undefined && typeof value.reason !== "string") {
		errors.push("command.reason must be a string when present");
	}
	if (kind === "archive") {
		if (!isNonEmptyString(value.recordId)) errors.push("command.recordId must be non-empty");
	} else if (kind === "restore") {
		if (!isNonEmptyString(value.recordId)) errors.push("command.recordId must be non-empty");
		if (
			value.persistenceLevel !== undefined &&
			(!isAgenticMemoryPersistenceLevel(value.persistenceLevel) ||
				value.persistenceLevel === "archived")
		) {
			errors.push("restore.persistenceLevel must be a non-archived persistence level when present");
		}
	} else if (kind === "setPersistenceLevel") {
		if (!isNonEmptyString(value.recordId)) errors.push("command.recordId must be non-empty");
		if (!isAgenticMemoryPersistenceLevel(value.persistenceLevel)) {
			errors.push("setPersistenceLevel.persistenceLevel is invalid");
		}
	} else if (kind === "requestConsolidation") {
		if (!isDenseArrayOf(value.recordIds, isNonEmptyString) || value.recordIds.length === 0) {
			errors.push("requestConsolidation.recordIds must be a non-empty string array");
		}
		if (
			value.requestId !== undefined &&
			(typeof value.requestId !== "string" || value.requestId.length === 0)
		) {
			errors.push("requestConsolidation.requestId must be non-empty when present");
		}
	}
	if (errors.length > 0 || id === undefined) {
		return {
			errors: [
				{
					code: "invalid-command",
					message: "agenticMemoryRetentionBundle: command is invalid",
					index,
					commandId: id,
					command: value,
					validationErrors: Object.freeze(errors),
				},
			],
		};
	}
	const base = { id, reason: value.reason as string | undefined };
	if (kind === "archive") {
		return {
			command: Object.freeze({
				...base,
				kind,
				recordId: value.recordId as string,
				...(base.reason === undefined ? {} : { reason: base.reason }),
			}),
			errors: [],
		};
	}
	if (kind === "restore") {
		return {
			command: Object.freeze({
				...base,
				kind,
				recordId: value.recordId as string,
				...(value.persistenceLevel === undefined
					? {}
					: {
							persistenceLevel: value.persistenceLevel as Exclude<
								AgenticMemoryPersistenceLevel,
								"archived"
							>,
						}),
				...(base.reason === undefined ? {} : { reason: base.reason }),
			}),
			errors: [],
		};
	}
	if (kind === "setPersistenceLevel") {
		return {
			command: Object.freeze({
				...base,
				kind,
				recordId: value.recordId as string,
				persistenceLevel: value.persistenceLevel as AgenticMemoryPersistenceLevel,
				...(base.reason === undefined ? {} : { reason: base.reason }),
			}),
			errors: [],
		};
	}
	return {
		command: Object.freeze({
			...base,
			kind: "requestConsolidation",
			recordIds: Object.freeze([...(value.recordIds as readonly string[])]),
			...(value.requestId === undefined ? {} : { requestId: value.requestId as string }),
			...(base.reason === undefined ? {} : { reason: base.reason }),
		}),
		errors: [],
	};
}

function retentionMissingRecords(
	command: AgenticMemoryRetentionCommand,
	records: ReadonlyMap<FactId, AgenticMemoryRecord>,
): readonly FactId[] {
	if ("recordId" in command) return records.has(command.recordId) ? [] : [command.recordId];
	return command.recordIds.filter((recordId) => !records.has(recordId));
}

function applyRetentionCommand<T>(
	command: AgenticMemoryRetentionCommand,
	source: ReadonlyMap<FactId, AgenticMemoryRecord<T>>,
	view: Map<FactId, AgenticMemoryRecord<T>>,
	requests: AgenticMemoryConsolidationRequest[],
): void {
	if (command.kind === "requestConsolidation") {
		requests.push(
			Object.freeze({
				id: command.requestId ?? command.id,
				commandId: command.id,
				recordIds: Object.freeze([...command.recordIds]),
				...(command.reason === undefined ? {} : { reason: command.reason }),
			}),
		);
		return;
	}
	const record = view.get(command.recordId) ?? source.get(command.recordId);
	if (record === undefined) return;
	const persistenceLevel =
		command.kind === "archive"
			? "archived"
			: command.kind === "restore"
				? (command.persistenceLevel ?? nonArchivedLevel(source.get(command.recordId) ?? record))
				: command.persistenceLevel;
	view.set(command.recordId, withPersistenceLevel(record, persistenceLevel));
}

function nonArchivedLevel(
	record: AgenticMemoryRecord,
): Exclude<AgenticMemoryPersistenceLevel, "archived"> {
	return record.persistenceLevel === "archived" ? "session" : record.persistenceLevel;
}

function withPersistenceLevel<T>(
	record: AgenticMemoryRecord<T>,
	persistenceLevel: AgenticMemoryPersistenceLevel,
): AgenticMemoryRecord<T> {
	return Object.freeze({
		...record,
		persistenceLevel,
	});
}

function retentionErrorFromRecordError(
	error: Omit<AgenticMemoryError, "cursor">,
): Omit<AgenticMemoryRetentionError, "cursor"> {
	return {
		...error,
		code: error.code,
	};
}

function validateConsolidationRequests<T>(
	value: unknown,
	records: readonly AgenticMemoryRecord<T>[],
): {
	readonly requests: readonly AgenticMemoryConsolidationRequest[];
	readonly errors: readonly Omit<AgenticMemoryRetentionError, "cursor">[];
} {
	const byId = new Map(records.map((record) => [record.id, record]));
	const requests: AgenticMemoryConsolidationRequest[] = [];
	const errors: Omit<AgenticMemoryRetentionError, "cursor">[] = [];
	if (!Array.isArray(value)) {
		return {
			requests,
			errors: [
				{
					code: "invalid-commands-input",
					message: "agenticMemoryConsolidationBundle: requests input must be an array",
					command: value,
				},
			],
		};
	}
	const length = safeArrayLength(value);
	if (length === undefined) {
		return {
			requests,
			errors: [
				{
					code: "invalid-commands-input",
					message: "agenticMemoryConsolidationBundle: requests input length could not be read",
					command: value,
				},
			],
		};
	}
	const seen = new Set<FactId>();
	for (let i = 0; i < length; i += 1) {
		let raw: unknown;
		try {
			if (!Object.hasOwn(value, i)) {
				throw new TypeError("request array must be dense");
			}
			raw = value[i];
		} catch (error) {
			errors.push({
				code: "invalid-command",
				message: `agenticMemoryConsolidationBundle: request access failed: ${errorMessage(error)}`,
				index: i,
				validationErrors: Object.freeze(["request access failed"]),
			});
			continue;
		}
		if (!isPlainRecord(raw)) {
			errors.push({
				code: "invalid-command",
				message: "agenticMemoryConsolidationBundle: request must be an object",
				index: i,
				command: raw,
			});
			continue;
		}
		const id = isNonEmptyString(raw.id) ? raw.id : undefined;
		const commandId = isNonEmptyString(raw.commandId) ? raw.commandId : undefined;
		const recordIds = isDenseArrayOf(raw.recordIds, isNonEmptyString)
			? Object.freeze([...raw.recordIds])
			: undefined;
		const validationErrors: string[] = [];
		if (id === undefined) validationErrors.push("request.id must be a non-empty string");
		if (commandId === undefined) {
			validationErrors.push("request.commandId must be a non-empty string");
		}
		if (recordIds === undefined || recordIds.length === 0) {
			validationErrors.push("request.recordIds must be a non-empty string array");
		}
		if (raw.reason !== undefined && typeof raw.reason !== "string") {
			validationErrors.push("request.reason must be a string when present");
		}
		if (id !== undefined && seen.has(id)) {
			validationErrors.push(`duplicate request id '${id}'`);
		}
		const missing = (recordIds ?? []).filter((recordId) => !byId.has(recordId));
		if (missing.length > 0) {
			errors.push({
				code: "missing-record-ref",
				message: "agenticMemoryConsolidationBundle: request references missing records",
				index: i,
				commandId,
				recordIds: Object.freeze(missing),
				command: raw,
				validationErrors: Object.freeze(
					missing.map((recordId) => `record '${recordId}' is not projected`),
				),
			});
			continue;
		}
		if (
			validationErrors.length > 0 ||
			id === undefined ||
			commandId === undefined ||
			recordIds === undefined
		) {
			errors.push({
				code: "invalid-command",
				message: "agenticMemoryConsolidationBundle: request is invalid",
				index: i,
				commandId,
				recordIds,
				command: raw,
				validationErrors: Object.freeze(validationErrors),
			});
			continue;
		}
		seen.add(id);
		requests.push(
			Object.freeze({
				id,
				commandId,
				recordIds,
				...(raw.reason === undefined ? {} : { reason: raw.reason as string }),
			}),
		);
	}
	return { requests: Object.freeze(requests), errors };
}

function projectConsolidationOutcomes<T>(
	value: unknown,
	requests: readonly AgenticMemoryConsolidationRequest[],
	evaluation: number,
): {
	readonly results: readonly AgenticMemoryConsolidationResult[];
	readonly proposedRecordDrafts: readonly AgenticMemoryConsolidationRecordDraft<T>[];
	readonly commands: readonly AgenticMemoryConsolidationCommand[];
	readonly errors: readonly Omit<AgenticMemoryConsolidationError, "cursor">[];
	readonly validOutcomes: number;
	readonly invalidOutcomes: number;
} {
	const byRequest = new Map(requests.map((request) => [request.id, request]));
	const results: AgenticMemoryConsolidationResult[] = [];
	const proposedRecordDrafts: AgenticMemoryConsolidationRecordDraft<T>[] = [];
	const commands: AgenticMemoryConsolidationCommand[] = [];
	const errors: Omit<AgenticMemoryConsolidationError, "cursor">[] = [];
	let validOutcomes = 0;
	let invalidOutcomes = 0;
	if (!Array.isArray(value)) {
		return {
			results,
			proposedRecordDrafts,
			commands,
			validOutcomes,
			invalidOutcomes: 1,
			errors: [
				{
					code: "invalid-outcomes-input",
					message: "agenticMemoryConsolidationBundle: outcomes input must be an array",
					outcome: value,
				},
			],
		};
	}
	const length = safeArrayLength(value);
	if (length === undefined) {
		return {
			results,
			proposedRecordDrafts,
			commands,
			validOutcomes,
			invalidOutcomes: 1,
			errors: [
				{
					code: "invalid-outcomes-input",
					message: "agenticMemoryConsolidationBundle: outcomes input length could not be read",
					outcome: value,
				},
			],
		};
	}
	const seenOutcomes = new Set<FactId>();
	for (let i = 0; i < length; i += 1) {
		let raw: unknown;
		let outcome: {
			readonly outcome?: AgenticMemoryConsolidationOutcome<T>;
			readonly error?: Omit<AgenticMemoryConsolidationError, "cursor">;
		};
		try {
			if (!Object.hasOwn(value, i)) {
				throw new TypeError("outcome array must be dense");
			}
			raw = value[i];
			outcome = validateConsolidationOutcome<T>(raw, i);
		} catch (error) {
			invalidOutcomes += 1;
			errors.push({
				code: "invalid-outcome",
				message: `agenticMemoryConsolidationBundle: outcome access failed: ${errorMessage(error)}`,
				index: i,
				outcome: raw,
				validationErrors: Object.freeze(["outcome access failed"]),
			});
			continue;
		}
		if (outcome.error !== undefined || outcome.outcome === undefined) {
			invalidOutcomes += 1;
			if (outcome.error !== undefined) errors.push(outcome.error);
			continue;
		}
		const validOutcome = outcome.outcome;
		if (seenOutcomes.has(validOutcome.id)) {
			invalidOutcomes += 1;
			errors.push({
				code: "duplicate-outcome-id",
				message: "agenticMemoryConsolidationBundle: duplicate outcome id",
				index: i,
				outcomeId: validOutcome.id,
				requestId: validOutcome.requestId,
				outcome: raw,
				validationErrors: Object.freeze([`duplicate outcome id '${validOutcome.id}'`]),
			});
			continue;
		}
		const request = byRequest.get(validOutcome.requestId);
		if (request === undefined) {
			invalidOutcomes += 1;
			errors.push({
				code: "missing-request-ref",
				message: "agenticMemoryConsolidationBundle: outcome references missing request",
				index: i,
				outcomeId: validOutcome.id,
				requestId: validOutcome.requestId,
				outcome: raw,
				validationErrors: Object.freeze([`request '${validOutcome.requestId}' is not projected`]),
			});
			continue;
		}
		seenOutcomes.add(validOutcome.id);
		validOutcomes += 1;
		if (validOutcome.kind === "failed") {
			const resultId = `${validOutcome.requestId}:${validOutcome.id}`;
			results.push(
				Object.freeze({
					id: resultId,
					requestId: validOutcome.requestId,
					outcomeId: validOutcome.id,
					state: "failed",
					sourceRecordIds: request.recordIds,
					proposedRecordIds: Object.freeze([]),
					message: validOutcome.message,
					...(validOutcome.provenance === undefined ? {} : { provenance: validOutcome.provenance }),
				}),
			);
			commands.push(
				Object.freeze({
					id: `${resultId}:markFailed`,
					kind: "markFailed",
					requestId: validOutcome.requestId,
					outcomeId: validOutcome.id,
					message: validOutcome.message,
				}),
			);
			continue;
		}
		const draftIds = validOutcome.records.map(
			(record) => `${validOutcome.requestId}:${validOutcome.id}:${record.id}`,
		);
		for (let recordIndex = 0; recordIndex < validOutcome.records.length; recordIndex += 1) {
			proposedRecordDrafts.push(
				Object.freeze({
					id: draftIds[recordIndex] as FactId,
					requestId: validOutcome.requestId,
					outcomeId: validOutcome.id,
					record: validOutcome.records[recordIndex] as AgenticMemoryRecord<T>,
				}),
			);
		}
		const resultId = `${validOutcome.requestId}:${validOutcome.id}`;
		results.push(
			Object.freeze({
				id: resultId,
				requestId: validOutcome.requestId,
				outcomeId: validOutcome.id,
				state: "proposed",
				sourceRecordIds: request.recordIds,
				proposedRecordIds: Object.freeze(validOutcome.records.map((record) => record.id)),
				...(validOutcome.provenance === undefined ? {} : { provenance: validOutcome.provenance }),
			}),
		);
		commands.push(
			Object.freeze({
				id: `${resultId}:proposeRecords`,
				kind: "proposeRecords",
				requestId: validOutcome.requestId,
				outcomeId: validOutcome.id,
				draftIds: Object.freeze(draftIds),
			}),
		);
	}
	void evaluation;
	return {
		results: Object.freeze(results),
		proposedRecordDrafts: Object.freeze(proposedRecordDrafts),
		commands: Object.freeze(commands),
		errors,
		validOutcomes,
		invalidOutcomes,
	};
}

function validateConsolidationOutcome<T>(
	value: unknown,
	index: number,
): {
	readonly outcome?: AgenticMemoryConsolidationOutcome<T>;
	readonly error?: Omit<AgenticMemoryConsolidationError, "cursor">;
} {
	if (!isPlainRecord(value)) {
		return {
			error: {
				code: "invalid-outcome",
				message: "agenticMemoryConsolidationBundle: outcome must be an object",
				index,
				outcome: value,
			},
		};
	}
	const errors: string[] = [];
	const id = isNonEmptyString(value.id) ? value.id : undefined;
	const requestId = isNonEmptyString(value.requestId) ? value.requestId : undefined;
	if (id === undefined) errors.push("outcome.id must be a non-empty string");
	if (requestId === undefined) errors.push("outcome.requestId must be a non-empty string");
	if (value.kind !== "proposedRecords" && value.kind !== "failed") {
		errors.push("outcome.kind must be proposedRecords or failed");
	}
	if (value.provenance !== undefined && typeof value.provenance !== "string") {
		errors.push("outcome.provenance must be a string when present");
	}
	if (value.kind === "failed" && !isNonEmptyString(value.message)) {
		errors.push("failed outcome.message must be a non-empty string");
	}
	const records: AgenticMemoryRecord<T>[] = [];
	if (value.kind === "proposedRecords") {
		if (!Array.isArray(value.records)) {
			errors.push("proposedRecords.records must be a non-empty array");
		} else {
			const recordsLength = safeArrayLength(value.records);
			const seenRecordIds = new Set<FactId>();
			if (recordsLength === undefined || recordsLength === 0) {
				errors.push("proposedRecords.records must be a non-empty array");
			}
			for (let i = 0; i < (recordsLength ?? 0); i += 1) {
				let result: {
					readonly record?: AgenticMemoryRecord<T>;
					readonly errors: Omit<AgenticMemoryError, "cursor">[];
				};
				try {
					if (!Object.hasOwn(value.records, i)) {
						throw new TypeError("proposedRecords.records must be dense");
					}
					result = validateAndSnapshotRecord<T>(value.records[i], i);
				} catch (error) {
					errors.push(`records[${i}]: record access failed: ${errorMessage(error)}`);
					continue;
				}
				if (result.record === undefined || result.errors.length > 0) {
					errors.push(
						...result.errors
							.flatMap((error) => error.validationErrors ?? [error.message])
							.map((error) => `records[${i}]: ${error}`),
					);
				} else if (seenRecordIds.has(result.record.id)) {
					errors.push(`records[${i}]: duplicate proposed record id '${result.record.id}'`);
				} else {
					seenRecordIds.add(result.record.id);
					records.push(result.record);
				}
			}
		}
	}
	if (errors.length > 0 || id === undefined || requestId === undefined) {
		return {
			error: {
				code: value.kind === "proposedRecords" ? "invalid-proposed-record" : "invalid-outcome",
				message: "agenticMemoryConsolidationBundle: outcome is invalid",
				index,
				outcomeId: id,
				requestId,
				outcome: value,
				validationErrors: Object.freeze(errors),
			},
		};
	}
	if (value.kind === "failed") {
		return {
			outcome: Object.freeze({
				id,
				requestId,
				kind: "failed",
				message: value.message as string,
				...(value.provenance === undefined ? {} : { provenance: value.provenance as string }),
			}),
		};
	}
	return {
		outcome: Object.freeze({
			id,
			requestId,
			kind: "proposedRecords",
			records: Object.freeze(records),
			...(value.provenance === undefined ? {} : { provenance: value.provenance as string }),
		}),
	};
}

function consolidationErrorFromRecordError(
	error: Omit<AgenticMemoryError, "cursor">,
): Omit<AgenticMemoryConsolidationError, "cursor"> {
	return {
		...error,
		code: error.code,
	};
}

function consolidationErrorFromRetentionError(
	error: Omit<AgenticMemoryRetentionError, "cursor">,
): Omit<AgenticMemoryConsolidationError, "cursor"> {
	return {
		...error,
		code: error.code,
	};
}

function packContext(
	contextValue: unknown,
	textsValue: unknown,
	policyValue: unknown,
	evaluation: number,
): AgenticMemoryContextPackingSnapshot {
	const errors: Omit<AgenticMemoryContextPackingError, "cursor">[] = [];
	const context = validatePackingContext(contextValue, errors);
	const texts = validateContextTexts(textsValue, errors);
	const policy = validatePackingPolicy(policyValue, errors);
	const packedEntries: AgenticMemoryPackedContextEntry[] = [];
	let omittedEntries = 0;
	let totalChars = 0;
	let totalCost = 0;
	if (context !== undefined && policy !== undefined) {
		for (const entry of context.entries) {
			const textFact = texts.get(entry.fragmentId);
			if (textFact === undefined) {
				omittedEntries += 1;
				errors.push({
					code: "missing-text",
					message: "agenticMemoryContextPackingBundle: missing text projection for context entry",
					fragmentId: entry.fragmentId,
					validationErrors: [`missing text for fragment '${entry.fragmentId}'`],
				});
				continue;
			}
			const cost = textFact.cost ?? textFact.text.length;
			const nextEntries = packedEntries.length + 1;
			const separatorChars = packedEntries.length === 0 ? 0 : 2;
			const nextChars = totalChars + separatorChars + textFact.text.length;
			const nextCost = totalCost + cost;
			const exceeds =
				(policy.maxEntries !== undefined && nextEntries > policy.maxEntries) ||
				(policy.maxChars !== undefined && nextChars > policy.maxChars) ||
				(policy.maxCost !== undefined && nextCost > policy.maxCost);
			if (exceeds) {
				omittedEntries += 1;
				continue;
			}
			const packedEntry: AgenticMemoryPackedContextEntry = Object.freeze({
				fragmentId: entry.fragmentId,
				text: textFact.text,
				cost,
				chars: textFact.text.length,
				...(entry.record === undefined ? {} : { record: entry.record }),
				...(policy.includeMetadata && textFact.metadata !== undefined
					? { metadata: textFact.metadata }
					: {}),
			});
			packedEntries.push(packedEntry);
			totalChars = nextChars;
			totalCost = nextCost;
		}
	}
	const cursor: AgenticMemoryContextPackingCursor = Object.freeze({
		evaluation,
		inputEntries: context?.entries.length ?? 0,
		packedEntries: packedEntries.length,
		omittedEntries,
		totalChars,
		totalCost,
	});
	const errorFacts = Object.freeze(
		errors.map((error) =>
			freezeError({
				...error,
				cursor,
			}),
		),
	);
	const packedContext: AgenticMemoryPackedContext = Object.freeze({
		entries: Object.freeze(packedEntries),
		text: packedEntries.map((entry) => entry.text).join("\n\n"),
		totalChars,
		totalCost,
		truncated: omittedEntries > 0,
	});
	const status: AgenticMemoryContextPackingStatus = Object.freeze({
		state: agenticStatusState(errorFacts.length, packedEntries.length),
		cursor,
	});
	return Object.freeze({
		packedContext,
		status,
		errors: errorFacts,
		cursor,
	});
}

function validatePackingContext(
	value: unknown,
	errors: Omit<AgenticMemoryContextPackingError, "cursor">[],
): ValidatedPackingContext | undefined {
	if (!isPlainRecord(value)) {
		errors.push({
			code: "invalid-context",
			message: "agenticMemoryContextPackingBundle: context must be an AgenticMemoryContext fact",
			value,
		});
		return undefined;
	}
	let entriesValue: unknown;
	try {
		entriesValue = value.entries;
	} catch (error) {
		errors.push({
			code: "invalid-context",
			message: `agenticMemoryContextPackingBundle: context entries access failed: ${errorMessage(error)}`,
			value,
			validationErrors: ["context entries access failed"],
		});
		return undefined;
	}
	if (!Array.isArray(entriesValue)) {
		errors.push({
			code: "invalid-context",
			message: "agenticMemoryContextPackingBundle: context must be an AgenticMemoryContext fact",
			value,
			validationErrors: ["context.entries must be an array"],
		});
		return undefined;
	}
	const length = safeArrayLength(entriesValue);
	if (length === undefined) {
		errors.push({
			code: "invalid-context",
			message: "agenticMemoryContextPackingBundle: context entries length could not be read",
			value,
			validationErrors: ["context.entries length could not be read"],
		});
		return undefined;
	}
	const entries: AgenticMemoryContextEntry[] = [];
	for (let i = 0; i < length; i += 1) {
		let raw: unknown;
		try {
			raw = entriesValue[i];
			if (!isPlainRecord(raw) || !isNonEmptyString(raw.fragmentId)) {
				errors.push({
					code: "invalid-context",
					message: "agenticMemoryContextPackingBundle: context entry is invalid",
					index: i,
					value: raw,
					validationErrors: ["context entry fragmentId must be a non-empty string"],
				});
				continue;
			}
			const record = validateRecordMetadata(raw.record);
			if (!record.ok) {
				errors.push({
					code: "invalid-context",
					message: "agenticMemoryContextPackingBundle: context entry record metadata is invalid",
					index: i,
					fragmentId: raw.fragmentId,
					value: raw,
					validationErrors: Object.freeze(record.errors),
				});
				continue;
			}
			entries.push(
				Object.freeze({
					fragmentId: raw.fragmentId,
					...(record.metadata === undefined ? {} : { record: record.metadata }),
				}) as AgenticMemoryContextEntry,
			);
		} catch (error) {
			errors.push({
				code: "invalid-context",
				message: `agenticMemoryContextPackingBundle: context entry access failed: ${errorMessage(error)}`,
				index: i,
				value: raw,
				validationErrors: ["context entry access failed"],
			});
		}
	}
	return Object.freeze({
		entries: Object.freeze(entries),
	});
}

function validateContextTexts(
	value: unknown,
	errors: Omit<AgenticMemoryContextPackingError, "cursor">[],
): Map<FactId, AgenticMemoryContextText> {
	const out = new Map<FactId, AgenticMemoryContextText>();
	if (!Array.isArray(value)) {
		errors.push({
			code: "invalid-texts-input",
			message: "agenticMemoryContextPackingBundle: texts input must be an array",
			value,
		});
		return out;
	}
	const length = safeArrayLength(value);
	if (length === undefined) {
		errors.push({
			code: "invalid-texts-input",
			message: "agenticMemoryContextPackingBundle: texts input length could not be read",
			value,
		});
		return out;
	}
	for (let i = 0; i < length; i += 1) {
		try {
			const raw = value[i];
			const result = validateContextText(raw, i);
			if (result.error !== undefined) {
				errors.push(result.error);
				continue;
			}
			if (result.text === undefined) {
				errors.push({
					code: "invalid-text",
					message: "agenticMemoryContextPackingBundle: text fact is invalid",
					index: i,
					value: raw,
					validationErrors: ["text validation returned no fact"],
				});
				continue;
			}
			if (out.has(result.text.fragmentId)) {
				errors.push({
					code: "duplicate-text-fragment-id",
					message: "agenticMemoryContextPackingBundle: duplicate text fragment id",
					index: i,
					fragmentId: result.text.fragmentId,
					value: raw,
					validationErrors: [`duplicate text fragment id '${result.text.fragmentId}'`],
				});
				continue;
			}
			out.set(result.text.fragmentId, result.text);
		} catch (error) {
			errors.push({
				code: "invalid-text",
				message: `agenticMemoryContextPackingBundle: text access failed: ${errorMessage(error)}`,
				index: i,
				validationErrors: ["text access failed"],
			});
		}
	}
	return out;
}

function validateContextText(
	value: unknown,
	index: number,
): {
	readonly text?: AgenticMemoryContextText;
	readonly error?: Omit<AgenticMemoryContextPackingError, "cursor">;
} {
	if (!isPlainRecord(value)) {
		return {
			error: {
				code: "invalid-text",
				message: "agenticMemoryContextPackingBundle: text fact must be an object",
				index,
				value,
			},
		};
	}
	const errors: string[] = [];
	if (!isNonEmptyString(value.fragmentId)) errors.push("fragmentId must be a non-empty string");
	if (typeof value.text !== "string") errors.push("text must be a string");
	if (
		value.cost !== undefined &&
		(typeof value.cost !== "number" || !Number.isFinite(value.cost) || value.cost < 0)
	) {
		errors.push("cost must be a finite number >= 0");
	}
	if (value.metadata !== undefined) {
		try {
			if (!isPlainRecord(value.metadata)) {
				throw new TypeError("metadata must be a plain object when present");
			}
			assertStrictJsonValue(value.metadata, "metadata");
		} catch (error) {
			errors.push(errorMessage(error));
		}
	}
	if (errors.length > 0) {
		return {
			error: {
				code: "invalid-text",
				message: "agenticMemoryContextPackingBundle: text fact is invalid",
				index,
				fragmentId: typeof value.fragmentId === "string" ? value.fragmentId : undefined,
				value,
				validationErrors: Object.freeze(errors),
			},
		};
	}
	return {
		text: Object.freeze({
			fragmentId: value.fragmentId as string,
			text: value.text as string,
			...(value.cost === undefined ? {} : { cost: value.cost as number }),
			...(value.metadata === undefined
				? {}
				: { metadata: Object.freeze({ ...(value.metadata as Record<string, StrictJsonValue>) }) }),
		}),
	};
}

function validatePackingPolicy(
	value: unknown,
	errors: Omit<AgenticMemoryContextPackingError, "cursor">[],
): AgenticMemoryContextPackingPolicy | undefined {
	if (!isPlainRecord(value)) {
		errors.push({
			code: "invalid-policy",
			message: "agenticMemoryContextPackingBundle: policy must be an object",
			value,
		});
		return undefined;
	}
	const validation: string[] = [];
	let maxEntries: unknown;
	let maxChars: unknown;
	let maxCost: unknown;
	let includeMetadata: unknown;
	try {
		maxEntries = value.maxEntries;
		maxChars = value.maxChars;
		maxCost = value.maxCost;
		includeMetadata = value.includeMetadata;
	} catch (error) {
		errors.push({
			code: "invalid-policy",
			message: `agenticMemoryContextPackingBundle: policy access failed: ${errorMessage(error)}`,
			value,
			validationErrors: ["policy access failed"],
		});
		return undefined;
	}
	if (
		maxEntries !== undefined &&
		(typeof maxEntries !== "number" || !Number.isSafeInteger(maxEntries) || maxEntries < 0)
	) {
		validation.push("maxEntries must be a safe integer >= 0");
	}
	if (
		maxChars !== undefined &&
		(typeof maxChars !== "number" || !Number.isSafeInteger(maxChars) || maxChars < 0)
	) {
		validation.push("maxChars must be a safe integer >= 0");
	}
	if (
		maxCost !== undefined &&
		(typeof maxCost !== "number" || !Number.isFinite(maxCost) || maxCost < 0)
	) {
		validation.push("maxCost must be a finite number >= 0");
	}
	if (includeMetadata !== undefined && typeof includeMetadata !== "boolean") {
		validation.push("includeMetadata must be a boolean when present");
	}
	if (validation.length > 0) {
		errors.push({
			code: "invalid-policy",
			message: "agenticMemoryContextPackingBundle: policy is invalid",
			value,
			validationErrors: Object.freeze(validation),
		});
		return undefined;
	}
	return Object.freeze({
		...(maxEntries === undefined ? {} : { maxEntries: maxEntries as number }),
		...(maxChars === undefined ? {} : { maxChars: maxChars as number }),
		...(maxCost === undefined ? {} : { maxCost: maxCost as number }),
		...(includeMetadata === undefined ? {} : { includeMetadata: includeMetadata as boolean }),
	});
}

function validateAndProjectRecords<T>(value: unknown): {
	readonly records: AgenticMemoryRecord<T>[];
	readonly fragments: MemoryFragment<T>[];
	readonly metadataByFragmentId: Record<FactId, AgenticMemoryRecordMetadata>;
	readonly errors: Omit<AgenticMemoryError, "cursor">[];
	readonly invalidRecordIndexes: Set<number>;
} {
	const records: AgenticMemoryRecord<T>[] = [];
	const fragments: MemoryFragment<T>[] = [];
	const metadataByFragmentId = Object.create(null) as Record<FactId, AgenticMemoryRecordMetadata>;
	const errors: Omit<AgenticMemoryError, "cursor">[] = [];
	const invalidRecordIndexes = new Set<number>();
	const seenRecordIds = new Set<FactId>();
	const seenFragmentIds = new Set<FactId>();
	if (!Array.isArray(value)) {
		errors.push({
			code: "invalid-records-input",
			message: "agenticMemoryBundle: records input must be an array",
			record: value,
		});
		return { records, fragments, metadataByFragmentId, errors, invalidRecordIndexes };
	}
	const length = safeArrayLength(value);
	if (length === undefined) {
		errors.push({
			code: "invalid-records-input",
			message: "agenticMemoryBundle: records input length could not be read",
			record: value,
		});
		return { records, fragments, metadataByFragmentId, errors, invalidRecordIndexes };
	}
	for (let i = 0; i < length; i += 1) {
		let raw: unknown;
		try {
			raw = value[i];
		} catch (error) {
			invalidRecordIndexes.add(i);
			errors.push({
				code: "invalid-record",
				message: `agenticMemoryBundle: record access failed: ${errorMessage(error)}`,
				index: i,
				validationErrors: Object.freeze(["record access failed"]),
			});
			continue;
		}
		const result = validateAndSnapshotRecord<T>(raw, i);
		if (result.errors.length > 0) {
			invalidRecordIndexes.add(i);
			errors.push(...result.errors);
			continue;
		}
		if (result.record === undefined) continue;
		if (seenRecordIds.has(result.record.id)) {
			invalidRecordIndexes.add(i);
			errors.push({
				code: "duplicate-record-id",
				message: "agenticMemoryBundle: duplicate record id",
				index: i,
				recordId: result.record.id,
				record: raw,
				validationErrors: [`duplicate record id '${result.record.id}'`],
			});
			continue;
		}
		if (seenFragmentIds.has(result.record.fragment.id)) {
			invalidRecordIndexes.add(i);
			errors.push({
				code: "duplicate-fragment-id",
				message: "agenticMemoryBundle: duplicate fragment id",
				index: i,
				recordId: result.record.id,
				fragmentId: result.record.fragment.id,
				record: raw,
				validationErrors: [`duplicate fragment id '${result.record.fragment.id}'`],
			});
			continue;
		}
		seenRecordIds.add(result.record.id);
		seenFragmentIds.add(result.record.fragment.id);
		records.push(result.record);
		fragments.push(result.record.fragment);
		metadataByFragmentId[result.record.fragment.id] = recordMetadata(result.record);
	}
	return { records, fragments, metadataByFragmentId, errors, invalidRecordIndexes };
}

function validateAndSnapshotRecord<T>(
	value: unknown,
	index: number,
): {
	readonly record?: AgenticMemoryRecord<T>;
	readonly errors: Omit<AgenticMemoryError, "cursor">[];
} {
	try {
		return validateAndSnapshotRecordInner<T>(value, index);
	} catch (error) {
		return {
			errors: [
				{
					code: "invalid-record",
					message: `agenticMemoryBundle: record access failed: ${errorMessage(error)}`,
					index,
					record: value,
					validationErrors: Object.freeze(["record access failed"]),
				},
			],
		};
	}
}

function validateAndSnapshotRecordInner<T>(
	value: unknown,
	index: number,
): {
	readonly record?: AgenticMemoryRecord<T>;
	readonly errors: Omit<AgenticMemoryError, "cursor">[];
} {
	const errors: Omit<AgenticMemoryError, "cursor">[] = [];
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return {
			errors: [
				{
					code: "invalid-record",
					message: "agenticMemoryBundle: record must be an object",
					index,
					record: value,
				},
			],
		};
	}
	const record = value as Partial<AgenticMemoryRecord<T>> & Record<string, unknown>;
	const recordId = typeof record.id === "string" ? record.id : undefined;
	if (recordId === undefined || recordId.length === 0) {
		errors.push({
			code: "invalid-record",
			message: "agenticMemoryBundle: record.id must be a non-empty string",
			index,
			record: value,
			validationErrors: ["record.id must be a non-empty string"],
		});
	}
	if (!isAgenticMemoryKind(record.kind)) {
		errors.push({
			code: "invalid-record-kind",
			message: "agenticMemoryBundle: record.kind is invalid",
			index,
			recordId,
			record: value,
			validationErrors: ["kind must be one of working, episodic, semantic, procedural, profile"],
		});
	}
	if (!isAgenticMemoryPersistenceLevel(record.persistenceLevel)) {
		errors.push({
			code: "invalid-persistence-level",
			message: "agenticMemoryBundle: record.persistenceLevel is invalid",
			index,
			recordId,
			record: value,
			validationErrors: [
				"persistenceLevel must be one of turn, session, project, longTerm, permanent, archived",
			],
		});
	}
	if (!isAgenticMemoryArtifactKind(record.artifactKind)) {
		errors.push({
			code: "invalid-artifact-kind",
			message: "agenticMemoryBundle: record.artifactKind is invalid",
			index,
			recordId,
			record: value,
			validationErrors: ["artifactKind must be one of raw, insight, profile, procedure"],
		});
	}
	const scopeValidation = validateScope(record.scope);
	if (!scopeValidation.ok) {
		errors.push({
			code: "invalid-scope",
			message: "agenticMemoryBundle: record.scope is invalid",
			index,
			recordId,
			record: value,
			validationErrors: Object.freeze(scopeValidation.errors),
		});
	}
	const fragmentValidation = validateMemoryFragment(record.fragment);
	if (!fragmentValidation.ok) {
		errors.push({
			code: "invalid-fragment",
			message: "agenticMemoryBundle: record.fragment is invalid",
			index,
			recordId,
			fragmentId:
				typeof record.fragment === "object" &&
				record.fragment !== null &&
				typeof (record.fragment as Partial<MemoryFragment>).id === "string"
					? (record.fragment as Partial<MemoryFragment>).id
					: undefined,
			record: value,
			validationErrors: Object.freeze([...fragmentValidation.errors]),
		});
	}
	const forbiddenFields = [
		"storageTier",
		"storageKey",
		"adapter",
		"collection",
		"collections",
		"ttl",
		"ttlMs",
		"ttlNs",
		"expiresAt",
		"timer",
		"scheduler",
		"schedule",
		"retentionTimer",
		"consolidationSchedule",
		"reflectionSchedule",
		"llm",
		"llmHandle",
		"tool",
		"toolHandle",
		"runner",
		"runnerHandle",
		"restore",
		"hydrate",
		"hydration",
		"graphMutation",
		"protocol",
	] as const;
	const presentForbidden = forbiddenFields.filter((field) => Object.hasOwn(record, field));
	if (presentForbidden.length > 0) {
		errors.push({
			code: "invalid-record",
			message: "agenticMemoryBundle: record contains forbidden runtime/persistence fields",
			index,
			recordId,
			record: value,
			validationErrors: Object.freeze(
				presentForbidden.map((field) => `${field} is not part of AgenticMemoryRecord`),
			),
		});
	}
	if (errors.length > 0) return { errors };
	const scope = scopeValidation.scope;
	const fragment = snapshotFragment(record.fragment as MemoryFragment<T>);
	return {
		record: Object.freeze({
			id: recordId as FactId,
			kind: record.kind as AgenticMemoryKind,
			persistenceLevel: record.persistenceLevel as AgenticMemoryPersistenceLevel,
			artifactKind: record.artifactKind as AgenticMemoryArtifactKind,
			...(scope === undefined ? {} : { scope }),
			fragment,
		}),
		errors,
	};
}

function snapshotFragment<T>(fragment: MemoryFragment<T>): MemoryFragment<T> {
	return Object.freeze({
		id: fragment.id,
		payload: fragment.payload,
		tNs: fragment.tNs,
		...(fragment.validFrom === undefined ? {} : { validFrom: fragment.validFrom }),
		...(fragment.validTo === undefined ? {} : { validTo: fragment.validTo }),
		confidence: fragment.confidence,
		tags: Object.freeze([...fragment.tags]),
		sources: Object.freeze([...fragment.sources]),
		...(fragment.embedding === undefined
			? {}
			: { embedding: Object.freeze([...fragment.embedding]) }),
		...(fragment.parentFragmentId === undefined
			? {}
			: { parentFragmentId: fragment.parentFragmentId }),
		...(fragment.provenance === undefined ? {} : { provenance: fragment.provenance }),
	});
}

function recordMetadata(record: AgenticMemoryRecord): AgenticMemoryRecordMetadata {
	return Object.freeze({
		recordId: record.id,
		kind: record.kind,
		persistenceLevel: record.persistenceLevel,
		artifactKind: record.artifactKind,
		...(record.scope === undefined ? {} : { scope: record.scope }),
	});
}

function validateRecordMetadata(value: unknown): {
	readonly ok: boolean;
	readonly metadata?: AgenticMemoryRecordMetadata;
	readonly errors: readonly string[];
} {
	if (value === undefined) return { ok: true, errors: [] };
	if (!isPlainRecord(value)) {
		return { ok: false, errors: ["record metadata must be an object when present"] };
	}
	const errors: string[] = [];
	for (const key of Object.keys(value)) {
		if (
			key !== "recordId" &&
			key !== "kind" &&
			key !== "persistenceLevel" &&
			key !== "artifactKind" &&
			key !== "scope"
		) {
			errors.push(`record.${key} is not part of AgenticMemoryRecordMetadata`);
		}
	}
	if (!isNonEmptyString(value.recordId)) {
		errors.push("record.recordId must be a non-empty string");
	}
	if (!isAgenticMemoryKind(value.kind)) {
		errors.push("record.kind is invalid");
	}
	if (!isAgenticMemoryPersistenceLevel(value.persistenceLevel)) {
		errors.push("record.persistenceLevel is invalid");
	}
	if (!isAgenticMemoryArtifactKind(value.artifactKind)) {
		errors.push("record.artifactKind is invalid");
	}
	const scopeValidation = validateScope(value.scope);
	if (!scopeValidation.ok) {
		errors.push(...scopeValidation.errors.map((error) => `record.${error}`));
	}
	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		errors,
		metadata: Object.freeze({
			recordId: value.recordId as FactId,
			kind: value.kind as AgenticMemoryKind,
			persistenceLevel: value.persistenceLevel as AgenticMemoryPersistenceLevel,
			artifactKind: value.artifactKind as AgenticMemoryArtifactKind,
			...(scopeValidation.scope === undefined ? {} : { scope: scopeValidation.scope }),
		}),
	};
}

function contextState(
	projection: AgenticMemoryStatusState,
	retrieval: MemoryRetrievalStatus["state"],
): AgenticMemoryContextState {
	if (projection === "error" || retrieval === "error") return "error";
	if (projection === "partial" || retrieval === "partial") return "partial";
	return retrieval;
}

function agenticStatusState(errorCount: number, validRecords: number): AgenticMemoryStatusState {
	if (errorCount > 0 && validRecords === 0) return "error";
	if (errorCount > 0) return "partial";
	return validRecords > 0 ? "ready" : "empty";
}

function isAgenticMemoryKind(value: unknown): value is AgenticMemoryKind {
	return (
		value === "working" ||
		value === "episodic" ||
		value === "semantic" ||
		value === "procedural" ||
		value === "profile"
	);
}

function isAgenticMemoryPersistenceLevel(value: unknown): value is AgenticMemoryPersistenceLevel {
	return (
		value === "turn" ||
		value === "session" ||
		value === "project" ||
		value === "longTerm" ||
		value === "permanent" ||
		value === "archived"
	);
}

function isAgenticMemoryArtifactKind(value: unknown): value is AgenticMemoryArtifactKind {
	return value === "raw" || value === "insight" || value === "profile" || value === "procedure";
}

function validateScope(value: unknown): {
	readonly ok: boolean;
	readonly scope?: AgenticMemoryScope;
	readonly errors: readonly string[];
} {
	if (value === undefined) return { ok: true, errors: [] };
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { ok: false, errors: ["scope must be an object when present"] };
	}
	const scope = value as Record<string, unknown>;
	const errors: string[] = [];
	const allowed = new Set(["sessionId", "projectId", "userId", "tenantId"]);
	for (const key of Object.keys(scope)) {
		if (!allowed.has(key)) errors.push(`scope.${key} is not part of AgenticMemoryScope`);
	}
	for (const key of allowed) {
		if (scope[key] !== undefined && (typeof scope[key] !== "string" || scope[key].length === 0)) {
			errors.push(`scope.${key} must be a non-empty string when present`);
		}
	}
	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		errors,
		scope: Object.freeze({
			...(scope.sessionId === undefined ? {} : { sessionId: scope.sessionId as string }),
			...(scope.projectId === undefined ? {} : { projectId: scope.projectId as string }),
			...(scope.userId === undefined ? {} : { userId: scope.userId as string }),
			...(scope.tenantId === undefined ? {} : { tenantId: scope.tenantId as string }),
		}),
	};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ownKeys(value: Record<string, unknown>): readonly string[] {
	return Object.keys(value).sort();
}

function assertExactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
	label: string,
): void {
	const actual = ownKeys(value);
	const want = [...expected].sort();
	if (actual.length !== want.length || actual.some((key, i) => key !== want[i])) {
		throw new TypeError(`${label}: unexpected fields ${actual.join(",")}`);
	}
}

function assertAgenticMemoryRecordCodecShape(value: unknown): void {
	if (!isPlainRecord(value)) {
		throw new TypeError("agenticMemoryRecordFrame: record must be an object");
	}
	assertNoSymbolKeys(value, "agenticMemoryRecordFrame.record");
	assertExactKeys(
		value,
		value.scope === undefined
			? ["artifactKind", "fragment", "id", "kind", "persistenceLevel"]
			: ["artifactKind", "fragment", "id", "kind", "persistenceLevel", "scope"],
		"agenticMemoryRecordFrame.record",
	);
	const fragment = value.fragment;
	if (!isPlainRecord(fragment)) {
		throw new TypeError("agenticMemoryRecordFrame: fragment must be an object");
	}
	assertNoSymbolKeys(fragment, "agenticMemoryRecordFrame.record.fragment");
	assertExactKeys(
		fragment,
		[
			"id",
			"payload",
			"tNs",
			...(fragment.validFrom === undefined ? [] : ["validFrom"]),
			...(fragment.validTo === undefined ? [] : ["validTo"]),
			"confidence",
			"tags",
			"sources",
			...(fragment.embedding === undefined ? [] : ["embedding"]),
			...(fragment.parentFragmentId === undefined ? [] : ["parentFragmentId"]),
			...(fragment.provenance === undefined ? [] : ["provenance"]),
		],
		"agenticMemoryRecordFrame.record.fragment",
	);
	assertStrictJsonValue(fragment.tags, "record.fragment.tags");
	assertStrictJsonValue(fragment.sources, "record.fragment.sources");
	if (fragment.embedding !== undefined) {
		assertStrictJsonValue(fragment.embedding, "record.fragment.embedding");
	}
	if (value.scope !== undefined) assertScopeFrame(value.scope);
}

function assertNoSymbolKeys(value: object, label: string): void {
	if (Object.getOwnPropertySymbols(value).length > 0) {
		throw new TypeError(`${label}: unexpected symbol fields`);
	}
}

function decimalBigIntString(value: bigint, label: string): string {
	const out = value.toString(10);
	if (!/^-?(0|[1-9]\d*)$/.test(out)) {
		throw new TypeError(`${label} must encode as a canonical decimal bigint string`);
	}
	return out;
}

function parseDecimalBigInt(value: unknown, label: string): bigint {
	if (typeof value !== "string" || !/^(0|-?[1-9]\d*)$/.test(value)) {
		throw new TypeError(`${label} must be a canonical decimal bigint string`);
	}
	return BigInt(value);
}

function assertStrictJsonValue(value: unknown, label: string): StrictJsonValue {
	try {
		strictJsonCodec.encode(value);
		return value as StrictJsonValue;
	} catch (error) {
		throw new TypeError(`${label} must be strict JSON: ${errorMessage(error)}`);
	}
}

function assertScopeFrame(value: unknown): AgenticMemoryScope {
	if (!isPlainRecord(value)) {
		throw new TypeError("agenticMemoryRecordFrame: scope must be an object when present");
	}
	assertStrictJsonValue(value, "record.scope");
	const validation = validateScope(value);
	if (!validation.ok || validation.scope === undefined) {
		throw new TypeError(`agenticMemoryRecordFrame: invalid scope: ${validation.errors.join("; ")}`);
	}
	assertExactKeys(
		value as Record<string, unknown>,
		[
			...((value as Record<string, unknown>).sessionId === undefined ? [] : ["sessionId"]),
			...((value as Record<string, unknown>).projectId === undefined ? [] : ["projectId"]),
			...((value as Record<string, unknown>).userId === undefined ? [] : ["userId"]),
			...((value as Record<string, unknown>).tenantId === undefined ? [] : ["tenantId"]),
		],
		"agenticMemoryRecordFrame.record.scope",
	);
	return validation.scope;
}

function assertKindValue(value: unknown): AgenticMemoryKind {
	if (!isAgenticMemoryKind(value)) {
		throw new TypeError("agenticMemoryRecordFrame: invalid memory kind");
	}
	return value;
}

function assertPersistenceLevelValue(value: unknown): AgenticMemoryPersistenceLevel {
	if (!isAgenticMemoryPersistenceLevel(value)) {
		throw new TypeError("agenticMemoryRecordFrame: invalid persistence level");
	}
	return value;
}

function assertArtifactKindValue(value: unknown): AgenticMemoryArtifactKind {
	if (!isAgenticMemoryArtifactKind(value)) {
		throw new TypeError("agenticMemoryRecordFrame: invalid artifact kind");
	}
	return value;
}

function assertNonEmptyString(value: unknown, label: string): string {
	if (!isNonEmptyString(value)) throw new TypeError(`${label} must be a non-empty string`);
	return value;
}

function assertString(value: unknown, label: string): string {
	if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
	return value;
}

function assertConfidence(value: unknown, label: string): number {
	if (!Number.isFinite(value) || (value as number) < 0 || (value as number) > 1) {
		throw new TypeError(`${label} must be a finite number in [0, 1]`);
	}
	return value as number;
}

function assertStringArray(value: unknown, label: string): readonly string[] {
	if (!isDenseArrayOf(value, (item): item is string => typeof item === "string")) {
		throw new TypeError(`${label} must be a readonly string array`);
	}
	return Object.freeze([...value]);
}

function assertFiniteNumberArray(value: unknown, label: string): readonly number[] {
	if (!isDenseArrayOf(value, (item): item is number => Number.isFinite(item))) {
		throw new TypeError(`${label} must be a finite number array`);
	}
	return Object.freeze([...value]);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isDenseArrayOf<T>(value: unknown, predicate: (item: unknown) => item is T): value is T[] {
	if (!Array.isArray(value)) return false;
	for (let i = 0; i < value.length; i += 1) {
		if (!Object.hasOwn(value, i) || !predicate(value[i])) return false;
	}
	return true;
}

function freezeError<T extends { readonly validationErrors?: readonly string[] }>(error: T): T {
	return Object.freeze({
		...error,
		...(error.validationErrors === undefined
			? {}
			: { validationErrors: Object.freeze([...error.validationErrors]) }),
	}) as T;
}

function safeArrayLength(value: readonly unknown[]): number | undefined {
	try {
		return value.length;
	} catch {
		return undefined;
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
