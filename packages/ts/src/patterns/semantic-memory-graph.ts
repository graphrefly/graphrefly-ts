/**
 * Graph-visible semantic-memory retrieval patterns.
 *
 * D158 allows horizontal semantic-memory patterns when they are ordinary graph
 * nodes with declared deps and graph-visible facts. This file intentionally
 * owns no storage restore/hydration, scheduler, hidden subscription, vector DB,
 * retention loop, consolidation loop, Graph subclass, or protocol behavior.
 */

import { depBatch, depLatest } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import {
	cosineSimilarity,
	type FactId,
	filterMemoryFragments,
	type MemoryAnswer,
	type MemoryFragment,
	type MemoryQuery,
	memoryFragmentMatchesQuery,
	validateMemoryFragment,
} from "./semantic-memory.js";

/** Query shape for the first graph-visible retrieval bundle. */
export interface MemoryRetrievalQuery extends MemoryQuery {
	/** Optional dense embedding used only for deterministic in-memory ranking. */
	readonly vector?: readonly number[];
}

export interface MemoryRetrievalCursor {
	readonly evaluation: number;
	readonly validFragments: number;
	readonly invalidFragments: number;
	readonly resultCount: number;
}

export type MemoryRetrievalStatusState = "ready" | "empty" | "partial" | "error";

export interface MemoryRetrievalStatus {
	readonly state: MemoryRetrievalStatusState;
	readonly query: MemoryRetrievalQuery;
	readonly cursor: MemoryRetrievalCursor;
}

export interface MemoryRetrievalIndex<T = unknown> {
	readonly ids: readonly FactId[];
	readonly byId: Readonly<Record<FactId, MemoryFragment<T>>>;
	readonly cursor: MemoryRetrievalCursor;
}

export type MemoryRetrievalErrorCode =
	| "duplicate-fragment-id"
	| "invalid-fragments-input"
	| "invalid-fragment"
	| "invalid-query"
	| "invalid-query-vector";

export interface MemoryRetrievalError {
	readonly code: MemoryRetrievalErrorCode;
	readonly message: string;
	readonly index?: number;
	readonly fragment?: unknown;
	readonly validationErrors?: readonly string[];
	readonly cursor: MemoryRetrievalCursor;
}

export interface MemoryRetrievalSnapshot<T = unknown> {
	readonly fragments: readonly MemoryFragment<T>[];
	readonly indexed: MemoryRetrievalIndex<T>;
	readonly ranked: MemoryAnswer<T>;
	readonly status: MemoryRetrievalStatus;
	readonly errors: readonly MemoryRetrievalError[];
	readonly cursor: MemoryRetrievalCursor;
}

export type MemoryRetrievalFact<T = unknown> = MemoryRetrievalSnapshot<T>;

export interface MemoryRetrievalBundle<T = unknown> {
	readonly input: {
		readonly fragments: Node<readonly unknown[]>;
		readonly query: Node<MemoryRetrievalQuery>;
	};
	readonly snapshot: Node<MemoryRetrievalSnapshot<T>>;
	readonly fragments: Node<readonly MemoryFragment<T>[]>;
	readonly indexed: Node<MemoryRetrievalIndex<T>>;
	readonly ranked: Node<MemoryAnswer<T>>;
	readonly status: Node<MemoryRetrievalStatus>;
	readonly errors: Node<readonly MemoryRetrievalError[]>;
	readonly cursor: Node<MemoryRetrievalCursor>;
}

export interface MemoryRetrievalBundleOptions {
	readonly name?: string;
	readonly fragments: Node<readonly unknown[]>;
	readonly query: Node<MemoryRetrievalQuery>;
}

interface MemoryRetrievalRuntimeState {
	evaluation: number;
}

interface MemoryRetrievalQueryValidation {
	readonly ok: boolean;
	readonly query: MemoryRetrievalQuery;
	readonly errors: readonly Omit<MemoryRetrievalError, "cursor">[];
}

interface FragmentValidationResult<T> {
	readonly fragment?: MemoryFragment<T>;
	readonly error?: Omit<MemoryRetrievalError, "cursor">;
}

/**
 * Build a graph-visible memory retrieval bundle from explicit fragment/query deps.
 *
 * Invalid fragments and ranking status are emitted as ordinary DATA facts. The
 * bundle never owns storage restore or hidden mutation; callers that need
 * persistence compose D161 collection/storage sidecars outside this pattern.
 */
export function memoryRetrievalBundle<T = unknown>(
	graph: Graph,
	opts: MemoryRetrievalBundleOptions,
): MemoryRetrievalBundle<T> {
	const name = opts.name ?? "memoryRetrieval";
	const { fragments, query } = opts;
	const snapshot = graph.node<MemoryRetrievalSnapshot<T>>(
		[fragments, query],
		(ctx) => {
			const state =
				ctx.state.get<MemoryRetrievalRuntimeState>() ??
				({ evaluation: 0 } satisfies MemoryRetrievalRuntimeState);
			state.evaluation += 1;
			const rawFragments = depLatest(ctx, 0);
			const rawQuery = depLatest(ctx, 1);
			const queryValidation = validateMemoryRetrievalQuery(rawQuery);
			const currentQuery = queryValidation.query;
			const valid: MemoryFragment<T>[] = [];
			const seenIds = new Set<FactId>();
			const errors: Omit<MemoryRetrievalError, "cursor">[] = [...queryValidation.errors];

			if (!Array.isArray(rawFragments)) {
				errors.push({
					code: "invalid-fragments-input",
					message: "memoryRetrievalBundle: fragments input must be an array",
					fragment: rawFragments,
				});
			} else {
				const length = safeArrayLength(rawFragments);
				if (length === undefined) {
					errors.push({
						code: "invalid-fragments-input",
						message: "memoryRetrievalBundle: fragments input length could not be read",
						fragment: rawFragments,
					});
				}
				for (let i = 0; i < (length ?? 0); i += 1) {
					const result = validateAndSnapshotFragment<T>(rawFragments, i);
					if (result.error !== undefined) {
						errors.push(result.error);
						continue;
					}
					const fragment = result.fragment as MemoryFragment<T>;
					if (seenIds.has(fragment.id)) {
						errors.push({
							code: "duplicate-fragment-id",
							message: "memoryRetrievalBundle: duplicate fragment id",
							index: i,
							fragment,
							validationErrors: [`duplicate fragment id '${fragment.id}'`],
						});
						continue;
					}
					seenIds.add(fragment.id);
					valid.push(fragment);
				}
			}

			const ranked = errors.some((error) => !isRecoverableFragmentError(error))
				? []
				: rankFragments(valid, currentQuery);
			const cursor: MemoryRetrievalCursor = Object.freeze({
				evaluation: state.evaluation,
				validFragments: valid.length,
				invalidFragments: errors.filter(
					(error) => error.code === "invalid-fragment" || error.code === "duplicate-fragment-id",
				).length,
				resultCount: ranked.length,
			});
			ctx.state.set(state);
			const answer: MemoryAnswer<T> = Object.freeze({
				query: currentQuery,
				results: Object.freeze(ranked),
			});
			const status: MemoryRetrievalStatus = Object.freeze({
				state: statusState(errors, ranked.length),
				query: currentQuery,
				cursor,
			});
			const indexed: MemoryRetrievalIndex<T> = Object.freeze({
				ids: Object.freeze(valid.map((fragment) => fragment.id)),
				byId: indexById(valid),
				cursor,
			});
			const errorFacts = Object.freeze(
				errors.map((error) =>
					Object.freeze({
						...error,
						...(error.validationErrors === undefined
							? {}
							: { validationErrors: Object.freeze([...error.validationErrors]) }),
						cursor,
					}),
				),
			);

			ctx.down([
				[
					"DATA",
					Object.freeze({
						fragments: Object.freeze([...valid]),
						indexed,
						ranked: answer,
						status,
						errors: errorFacts,
						cursor,
					}),
				],
			]);
		},
		{
			name: `${name}/snapshot`,
			factory: "memoryRetrievalSnapshot",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: { fragments, query },
		snapshot,
		fragments: retrievalProjection(
			graph,
			snapshot,
			`${name}/fragments`,
			"memoryRetrievalFragments",
			(fact) => fact.fragments,
		),
		indexed: retrievalProjection(
			graph,
			snapshot,
			`${name}/indexed`,
			"memoryRetrievalIndexed",
			(fact) => fact.indexed,
		),
		ranked: retrievalProjection(
			graph,
			snapshot,
			`${name}/ranked`,
			"memoryRetrievalRanked",
			(fact) => fact.ranked,
		),
		status: retrievalProjection(
			graph,
			snapshot,
			`${name}/status`,
			"memoryRetrievalStatus",
			(fact) => fact.status,
		),
		errors: retrievalProjection(
			graph,
			snapshot,
			`${name}/errors`,
			"memoryRetrievalErrors",
			(fact) => fact.errors,
		),
		cursor: retrievalProjection(
			graph,
			snapshot,
			`${name}/cursor`,
			"memoryRetrievalCursor",
			(fact) => fact.cursor,
		),
	};
}

function retrievalProjection<TFact, T>(
	graph: Graph,
	snapshot: Node<MemoryRetrievalSnapshot<T>>,
	name: string,
	factory: string,
	select: (fact: MemoryRetrievalSnapshot<T>) => TFact | undefined,
): Node<TFact> {
	return graph.node<TFact>(
		[snapshot],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as MemoryRetrievalSnapshot<T>;
				const selected = select(fact);
				if (selected !== undefined) ctx.down([["DATA", selected]]);
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

function rankFragments<T>(
	fragments: readonly MemoryFragment<T>[],
	query: MemoryRetrievalQuery,
): readonly MemoryFragment<T>[] {
	if (query.vector === undefined) return filterMemoryFragments(fragments, query);
	const ranked = fragments.filter((fragment) => memoryFragmentMatchesQuery(fragment, query));
	ranked.sort((a, b) => {
		const vectorDelta = vectorScore(b, query) - vectorScore(a, query);
		if (vectorDelta !== 0) return vectorDelta;
		const confidenceDelta = b.confidence - a.confidence;
		if (confidenceDelta !== 0) return confidenceDelta;
		return compareBigIntDesc(a.tNs, b.tNs);
	});
	return query.limit === undefined ? ranked : ranked.slice(0, Math.max(0, query.limit));
}

function vectorScore(fragment: MemoryFragment, query: MemoryRetrievalQuery): number {
	if (query.vector === undefined || fragment.embedding === undefined) return 0;
	return cosineSimilarity(query.vector, fragment.embedding);
}

function statusState(
	errors: readonly Omit<MemoryRetrievalError, "cursor">[],
	resultCount: number,
): MemoryRetrievalStatusState {
	if (errors.some((error) => !isRecoverableFragmentError(error))) return "error";
	if (errors.length > 0) return "partial";
	return resultCount > 0 ? "ready" : "empty";
}

function isRecoverableFragmentError(error: Omit<MemoryRetrievalError, "cursor">): boolean {
	return error.code === "invalid-fragment" || error.code === "duplicate-fragment-id";
}

function indexById<T>(
	fragments: readonly MemoryFragment<T>[],
): Readonly<Record<FactId, MemoryFragment<T>>> {
	const byId = Object.create(null) as Record<FactId, MemoryFragment<T>>;
	for (const fragment of fragments) byId[fragment.id] = fragment;
	return Object.freeze(byId);
}

function isFiniteVector(value: unknown): value is readonly number[] {
	if (!Array.isArray(value)) return false;
	for (let i = 0; i < value.length; i += 1) {
		if (!Object.hasOwn(value, i) || !Number.isFinite(value[i])) return false;
	}
	return true;
}

function validateMemoryRetrievalQuery(value: unknown): MemoryRetrievalQueryValidation {
	try {
		return validateMemoryRetrievalQueryInner(value);
	} catch (error) {
		return {
			ok: false,
			query: {},
			errors: [
				{
					code: "invalid-query",
					message: `memoryRetrievalBundle: query access failed: ${errorMessage(error)}`,
					fragment: value,
				},
			],
		};
	}
}

function validateMemoryRetrievalQueryInner(value: unknown): MemoryRetrievalQueryValidation {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return invalidQuery(value, "memoryRetrievalBundle: query must be an object");
	}
	const query = value as Partial<MemoryRetrievalQuery>;
	const errors: Omit<MemoryRetrievalError, "cursor">[] = [];
	if (
		query.tags !== undefined &&
		!isDenseArrayOf(query.tags, (tag): tag is string => typeof tag === "string")
	) {
		errors.push({
			code: "invalid-query",
			message: "memoryRetrievalBundle: query.tags must be a readonly string array",
			fragment: value,
			validationErrors: ["tags must be a readonly string array"],
		});
	}
	if (query.asOf !== undefined && typeof query.asOf !== "bigint") {
		errors.push({
			code: "invalid-query",
			message: "memoryRetrievalBundle: query.asOf must be a bigint",
			fragment: value,
			validationErrors: ["asOf must be a bigint when present"],
		});
	}
	if (
		query.minConfidence !== undefined &&
		(!Number.isFinite(query.minConfidence) || query.minConfidence < 0 || query.minConfidence > 1)
	) {
		errors.push({
			code: "invalid-query",
			message: "memoryRetrievalBundle: query.minConfidence must be a finite number in [0, 1]",
			fragment: value,
			validationErrors: ["minConfidence must be a finite number in [0, 1]"],
		});
	}
	if (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 0)) {
		errors.push({
			code: "invalid-query",
			message: "memoryRetrievalBundle: query.limit must be a non-negative safe integer",
			fragment: value,
			validationErrors: ["limit must be a non-negative safe integer"],
		});
	}
	if (query.vector !== undefined && !isFiniteVector(query.vector)) {
		errors.push({
			code: "invalid-query-vector",
			message: "memoryRetrievalBundle: query.vector must be a finite number array",
			fragment: value,
			validationErrors: ["vector must be a finite number array"],
		});
	}
	if (errors.length > 0) return { ok: false, query: {}, errors };
	return { ok: true, query: snapshotQuery(query), errors };
}

function invalidQuery(value: unknown, message: string): MemoryRetrievalQueryValidation {
	return {
		ok: false,
		query: {},
		errors: [
			{
				code: "invalid-query",
				message,
				fragment: value,
			},
		],
	};
}

function snapshotQuery(query: Partial<MemoryRetrievalQuery>): MemoryRetrievalQuery {
	return Object.freeze({
		...(query.tags === undefined ? {} : { tags: Object.freeze([...query.tags]) }),
		...(query.asOf === undefined ? {} : { asOf: query.asOf }),
		...(query.minConfidence === undefined ? {} : { minConfidence: query.minConfidence }),
		...(query.limit === undefined ? {} : { limit: query.limit }),
		...(query.vector === undefined ? {} : { vector: Object.freeze([...query.vector]) }),
	});
}

function safeArrayLength(value: readonly unknown[]): number | undefined {
	try {
		return value.length;
	} catch {
		return undefined;
	}
}

function validateAndSnapshotFragment<T>(
	rawFragments: readonly unknown[],
	index: number,
): FragmentValidationResult<T> {
	let raw: unknown;
	try {
		raw = rawFragments[index];
		const validation = validateMemoryFragment(raw);
		if (!validation.ok) {
			return {
				error: {
					code: "invalid-fragment",
					message: "memoryRetrievalBundle: invalid memory fragment",
					index,
					fragment: raw,
					validationErrors: Object.freeze([...validation.errors]),
				},
			};
		}
		return { fragment: snapshotFragment(raw as MemoryFragment<T>) };
	} catch (error) {
		return {
			error: {
				code: "invalid-fragment",
				message: `memoryRetrievalBundle: fragment access failed: ${errorMessage(error)}`,
				index,
				fragment: raw,
				validationErrors: Object.freeze(["fragment access failed"]),
			},
		};
	}
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

function isDenseArrayOf<T>(value: unknown, predicate: (item: unknown) => item is T): value is T[] {
	if (!Array.isArray(value)) return false;
	for (let i = 0; i < value.length; i += 1) {
		if (!Object.hasOwn(value, i) || !predicate(value[i])) return false;
	}
	return true;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function compareBigIntDesc(a: bigint, b: bigint): number {
	if (a === b) return 0;
	return a > b ? -1 : 1;
}
