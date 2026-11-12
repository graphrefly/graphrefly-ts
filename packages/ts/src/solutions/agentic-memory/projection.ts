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
			const values: TFact[] = [];
			for (const raw of ctx.deps[0].waves.flat()) {
				values.push(select(raw as TSnapshot));
			}
			ctx.down(values.map((v) => ["DATA", v] as const));
		},
		{
			name,
			factory,
			complete: "manual",
			error: "manual",
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
			const values: TFact[] = [];
			for (const raw of ctx.deps[0].waves.flat()) {
				values.push(select(raw as AgenticMemoryProjectionSnapshot<T>));
			}
			ctx.down(values.map((v) => ["DATA", v] as const));
		},
		{
			name,
			factory,
			complete: "manual",
			error: "manual",
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
			const projectionFact = ctx.deps[0].value as AgenticMemoryProjectionSnapshot<T> | undefined;
			const retrievalFacts = ctx.deps[1].waves.flat();
			if (projectionFact === undefined || retrievalFacts.length === 0) return;
			const contexts: AgenticMemoryContext<T>[] = [];
			for (const raw of retrievalFacts) {
				contexts.push(contextFromSnapshot(projectionFact, raw as MemoryRetrievalSnapshot<T>));
			}
			ctx.down(contexts.map((v) => ["DATA", v] as const));
		},
		{
			name,
			factory: "agenticMemoryContext",
			complete: "manual",
			error: "manual",
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
			const rawRecords = ctx.deps[0].waves.flat().at(-1);
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
			complete: "manual",
			error: "manual",
		},
	);
}
