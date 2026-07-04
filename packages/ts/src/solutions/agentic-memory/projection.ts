import { depBatch, depLatest } from "../../ctx/types.js";
import type { Graph } from "../../graph/graph.js";
import type { Node } from "../../node/node.js";
import type { MemoryRetrievalSnapshot } from "../../patterns/semantic-memory-graph.js";
import { agenticStatusState, contextState, validateAndProjectRecords } from "./shared.js";
import type {
	AgenticMemoryContext,
	AgenticMemoryProjectionCursor,
	AgenticMemoryProjectionSnapshot,
	AgenticMemoryRecord,
	AgenticMemoryStatus,
} from "./types.js";

export function solutionProjection<TFact, TSnapshot>(
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

export function agenticMemoryProjection<TFact, T>(
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

export function agenticMemoryContextProjection<T>(
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

export function contextFromSnapshot<T>(
	projection: AgenticMemoryProjectionSnapshot<T>,
	retrieval: MemoryRetrievalSnapshot<T>,
): AgenticMemoryContext<T> {
	const entries = retrieval.ranked.results.map((fragment, index) => {
		const record = projection.metadataByFragmentId[fragment.id];
		return Object.freeze({
			fragmentId: fragment.id,
			payload: fragment.payload,
			confidence: fragment.confidence,
			tags: fragment.tags,
			sources: fragment.sources,
			...(record === undefined ? {} : { record }),
			attribution: Object.freeze({
				fragmentId: fragment.id,
				...(record === undefined ? {} : { recordId: record.recordId }),
				rank: index + 1,
			}),
			fragment,
		});
	});
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

export function agenticMemoryRecordProjection<T>(
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
