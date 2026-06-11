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
import type { Node } from "../node/node.js";
import {
	type FactId,
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
