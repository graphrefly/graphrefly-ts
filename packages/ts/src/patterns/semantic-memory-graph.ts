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
import type { FactId, MemoryAnswer, MemoryFragment } from "./semantic-memory.js";
import type {
	KnowledgeGraphCursor,
	KnowledgeGraphReducerBundle,
	KnowledgeGraphReducerBundleOptions,
	KnowledgeGraphSnapshot,
	KnowledgeGraphStatus,
	MemoryRetrievalBundle,
	MemoryRetrievalBundleOptions,
	MemoryRetrievalCursor,
	MemoryRetrievalError,
	MemoryRetrievalIndex,
	MemoryRetrievalSnapshot,
	MemoryRetrievalStatus,
} from "./semantic-memory-graph-types.js";
import {
	indexById,
	isRecoverableFragmentError,
	rankFragments,
	reduceKnowledgeAssertions,
	safeArrayLength,
	statusState,
	validateAndSnapshotFragment,
	validateKnowledgeGraphPolicy,
	validateMemoryRetrievalQuery,
} from "./semantic-memory-graph-utils.js";

export type {
	KnowledgeGraphCursor,
	KnowledgeGraphEntity,
	KnowledgeGraphError,
	KnowledgeGraphErrorCode,
	KnowledgeGraphIndex,
	KnowledgeGraphPolicy,
	KnowledgeGraphReducerBundle,
	KnowledgeGraphReducerBundleOptions,
	KnowledgeGraphRelation,
	KnowledgeGraphSnapshot,
	KnowledgeGraphStatus,
	KnowledgeGraphStatusState,
	KnowledgeGraphTopic,
	MemoryRetrievalBundle,
	MemoryRetrievalBundleOptions,
	MemoryRetrievalCursor,
	MemoryRetrievalError,
	MemoryRetrievalErrorCode,
	MemoryRetrievalFact,
	MemoryRetrievalIndex,
	MemoryRetrievalQuery,
	MemoryRetrievalSnapshot,
	MemoryRetrievalStatus,
	MemoryRetrievalStatusState,
} from "./semantic-memory-graph-types.js";

interface MemoryRetrievalRuntimeState {
	evaluation: number;
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

/**
 * D170 lower semantic-memory KG materializer.
 *
 * Assertion, entity, relation, and topic ids remain DATA keys. The bundle has
 * static describe-visible topology and owns no storage, LLM extraction,
 * scheduler, agent runtime, or dynamic graph node lifecycle.
 */
export function knowledgeGraphReducerBundle(
	graph: Graph,
	opts: KnowledgeGraphReducerBundleOptions,
): KnowledgeGraphReducerBundle {
	const name = opts.name ?? "knowledgeGraph";
	const deps = opts.policy === undefined ? [opts.assertions] : [opts.assertions, opts.policy];
	const snapshot = graph.node<KnowledgeGraphSnapshot>(
		deps,
		(ctx) => {
			const state =
				ctx.state.get<{ evaluation: number }>() ??
				({ evaluation: 0 } satisfies { evaluation: number });
			state.evaluation += 1;
			const policy = validateKnowledgeGraphPolicy(
				opts.policy === undefined ? undefined : depLatest(ctx, 1),
			);
			const reduced = reduceKnowledgeAssertions(depLatest(ctx, 0), policy.policy);
			const pendingErrors = [...policy.errors, ...reduced.errors];
			const cursor: KnowledgeGraphCursor = Object.freeze({
				evaluation: state.evaluation,
				validAssertions: reduced.assertions.length,
				invalidAssertions: reduced.invalidAssertions,
				entityCount: reduced.entities.length,
				relationCount: reduced.relations.length,
				predicateCount: reduced.topics.length,
			});
			const errors = Object.freeze(
				pendingErrors.map((error) =>
					Object.freeze({
						...error,
						...(error.validationErrors === undefined
							? {}
							: { validationErrors: Object.freeze([...error.validationErrors]) }),
						cursor,
					}),
				),
			);
			const status: KnowledgeGraphStatus = Object.freeze({
				state:
					reduced.assertions.length === 0 && errors.length === 0
						? "empty"
						: errors.length === 0
							? "ready"
							: reduced.assertions.length > 0
								? "partial"
								: "error",
				cursor,
			});
			ctx.state.set(state);
			ctx.down([
				[
					"DATA",
					Object.freeze({
						assertions: Object.freeze(reduced.assertions),
						entities: Object.freeze(reduced.entities),
						relations: Object.freeze(reduced.relations),
						topics: Object.freeze(reduced.topics),
						index: reduced.index,
						status,
						errors,
						cursor,
					}),
				],
			]);
		},
		{
			name: `${name}/snapshot`,
			factory: "knowledgeGraphReducerSnapshot",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input: {
			assertions: opts.assertions,
			...(opts.policy === undefined ? {} : { policy: opts.policy }),
		},
		snapshot,
		assertions: kgProjection(
			graph,
			snapshot,
			`${name}/assertions`,
			"knowledgeGraphAssertions",
			(fact) => fact.assertions,
		),
		entities: kgProjection(
			graph,
			snapshot,
			`${name}/entities`,
			"knowledgeGraphEntities",
			(fact) => fact.entities,
		),
		relations: kgProjection(
			graph,
			snapshot,
			`${name}/relations`,
			"knowledgeGraphRelations",
			(fact) => fact.relations,
		),
		topics: kgProjection(
			graph,
			snapshot,
			`${name}/topics`,
			"knowledgeGraphTopics",
			(fact) => fact.topics,
		),
		index: kgProjection(
			graph,
			snapshot,
			`${name}/index`,
			"knowledgeGraphIndex",
			(fact) => fact.index,
		),
		status: kgProjection(
			graph,
			snapshot,
			`${name}/status`,
			"knowledgeGraphStatus",
			(fact) => fact.status,
		),
		errors: kgProjection(
			graph,
			snapshot,
			`${name}/errors`,
			"knowledgeGraphErrors",
			(fact) => fact.errors,
		),
		cursor: kgProjection(
			graph,
			snapshot,
			`${name}/cursor`,
			"knowledgeGraphCursor",
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

function kgProjection<TFact>(
	graph: Graph,
	snapshot: Node<KnowledgeGraphSnapshot>,
	name: string,
	factory: string,
	select: (fact: KnowledgeGraphSnapshot) => TFact,
): Node<TFact> {
	return graph.node<TFact>(
		[snapshot],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				ctx.down([["DATA", select(raw as KnowledgeGraphSnapshot)]]);
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
