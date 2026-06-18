import type { Node } from "../node/node.js";
import type {
	FactId,
	KnowledgeAssertion,
	KnowledgeAssertionObject,
	KnowledgeAssertionSubject,
	MemoryAnswer,
	MemoryFragment,
	MemoryQuery,
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

export interface KnowledgeGraphEntity {
	readonly id: FactId;
	readonly type?: string;
	readonly assertionIds: readonly FactId[];
	readonly subjectAssertionIds: readonly FactId[];
	readonly objectAssertionIds: readonly FactId[];
}

export interface KnowledgeGraphRelation {
	readonly assertionId: FactId;
	readonly subject: KnowledgeAssertionSubject;
	readonly predicate: string;
	readonly object: KnowledgeAssertionObject;
	readonly confidence?: number;
	readonly sources: readonly FactId[];
	readonly provenance?: string;
}

export interface KnowledgeGraphTopic {
	readonly predicate: string;
	readonly assertionIds: readonly FactId[];
	readonly entityIds: readonly FactId[];
}

export interface KnowledgeGraphIndex {
	readonly assertionIds: readonly FactId[];
	readonly entityIds: readonly FactId[];
	readonly relationIds: readonly FactId[];
	readonly predicates: readonly string[];
}

export interface KnowledgeGraphPolicy {
	readonly allowedPredicates?: readonly string[];
	readonly requireEntityTypes?: boolean;
}

export interface KnowledgeGraphCursor {
	readonly evaluation: number;
	readonly validAssertions: number;
	readonly invalidAssertions: number;
	readonly entityCount: number;
	readonly relationCount: number;
	readonly predicateCount: number;
}

export type KnowledgeGraphStatusState = "ready" | "empty" | "partial" | "error";

export interface KnowledgeGraphStatus {
	readonly state: KnowledgeGraphStatusState;
	readonly cursor: KnowledgeGraphCursor;
}

export type KnowledgeGraphErrorCode =
	| "invalid-assertions-input"
	| "invalid-assertion"
	| "duplicate-assertion-id"
	| "invalid-policy"
	| "policy-conflict";

export interface KnowledgeGraphError {
	readonly code: KnowledgeGraphErrorCode;
	readonly message: string;
	readonly index?: number;
	readonly assertionId?: FactId;
	readonly assertion?: unknown;
	readonly validationErrors?: readonly string[];
	readonly cursor: KnowledgeGraphCursor;
}

export interface KnowledgeGraphSnapshot {
	readonly assertions: readonly KnowledgeAssertion[];
	readonly entities: readonly KnowledgeGraphEntity[];
	readonly relations: readonly KnowledgeGraphRelation[];
	readonly topics: readonly KnowledgeGraphTopic[];
	readonly index: KnowledgeGraphIndex;
	readonly status: KnowledgeGraphStatus;
	readonly errors: readonly KnowledgeGraphError[];
	readonly cursor: KnowledgeGraphCursor;
}

export interface KnowledgeGraphReducerBundle {
	readonly input: {
		readonly assertions: Node<readonly unknown[]>;
		readonly policy?: Node<KnowledgeGraphPolicy>;
	};
	readonly snapshot: Node<KnowledgeGraphSnapshot>;
	readonly assertions: Node<readonly KnowledgeAssertion[]>;
	readonly entities: Node<readonly KnowledgeGraphEntity[]>;
	readonly relations: Node<readonly KnowledgeGraphRelation[]>;
	readonly topics: Node<readonly KnowledgeGraphTopic[]>;
	readonly index: Node<KnowledgeGraphIndex>;
	readonly status: Node<KnowledgeGraphStatus>;
	readonly errors: Node<readonly KnowledgeGraphError[]>;
	readonly cursor: Node<KnowledgeGraphCursor>;
}

export interface KnowledgeGraphReducerBundleOptions {
	readonly name?: string;
	readonly assertions: Node<readonly unknown[]>;
	readonly policy?: Node<KnowledgeGraphPolicy>;
}

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
