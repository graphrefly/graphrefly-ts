/**
 * Passive semantic-memory vocabulary and deterministic helpers.
 *
 * D158 splits semantic memory into horizontal patterns and vertical solutions.
 * This module intentionally owns no graph nodes, storage restore, timers,
 * subscriptions, vector indexes, knowledge graphs, or agentic runtime.
 */

import type { StrictJsonValue } from "../json/codec.js";

/** Stable identity for a semantic-memory fact. */
export type FactId = string;

/** Shard partition key used by passive sharding helpers. */
export type ShardKey = string | number;

/**
 * A single semantic-memory fact. Pattern convention only: this is not a
 * protocol message, storage record owner, restore contract, or graph runtime.
 */
export interface MemoryFragment<T = unknown> {
	readonly id: FactId;
	readonly payload: T;
	/** Transaction time, typically monotonic nanoseconds. */
	readonly tNs: bigint;
	/** Valid-time start. Undefined means unbounded past. */
	readonly validFrom?: bigint;
	/** Valid-time end. Undefined means currently valid. */
	readonly validTo?: bigint;
	/** Confidence score in the closed interval [0, 1]. */
	readonly confidence: number;
	readonly tags: readonly string[];
	/** Fact ids this fragment derives from or depends on. */
	readonly sources: readonly FactId[];
	readonly embedding?: readonly number[];
	readonly parentFragmentId?: FactId;
	readonly provenance?: string;
}

/** Columnar passive store vocabulary for callers that keep memory facts outside GraphReFly. */
export interface FactStore<T = unknown> {
	readonly byId: ReadonlyMap<FactId, MemoryFragment<T>>;
}

/** Read-only projection passed to scoring policies; it exposes no mutation surface. */
export interface StoreReadHandle<T = unknown> {
	get(id: FactId): MemoryFragment<T> | undefined;
	has(id: FactId): boolean;
	readonly size: number;
	values(): IterableIterator<MemoryFragment<T>>;
}

export type ScoringPolicy<T = unknown> = (
	fragment: MemoryFragment<T>,
	store: StoreReadHandle<T>,
) => number;
export type DecayPolicy = (confidence: number, ageNs: bigint) => number;
export type AdmissionFilter<T = unknown> = (fragment: MemoryFragment<T>) => boolean;

/** Outcome signal for policy learning. This is an application fact, not a protocol event. */
export interface OutcomeSignal {
	readonly factId: FactId;
	readonly reward: number;
}

/** Passive structured query over semantic-memory facts. */
export interface MemoryQuery {
	readonly tags?: readonly string[];
	readonly asOf?: bigint;
	readonly minConfidence?: number;
	readonly limit?: number;
}

export interface MemoryAnswer<T = unknown> {
	readonly query: MemoryQuery;
	readonly results: readonly MemoryFragment<T>[];
}

export type KnowledgeAssertionStrictJsonValue = StrictJsonValue;

/** Passive KG endpoint vocabulary. Entity ids are DATA keys, not graph node ids. */
export interface KnowledgeAssertionSubject {
	readonly id: FactId;
	readonly type?: string;
}

/** Passive KG object/value vocabulary. */
export type KnowledgeAssertionObject =
	| {
			readonly kind: "entity";
			readonly id: FactId;
			readonly type?: string;
	  }
	| {
			readonly kind: "value";
			readonly value: KnowledgeAssertionStrictJsonValue;
			readonly valueType?: string;
	  };

/** Passive KG assertion fact consumed by lower semantic-memory graph patterns. */
export interface KnowledgeAssertion {
	readonly id: FactId;
	readonly recordId?: FactId;
	readonly fragmentId?: FactId;
	readonly subject: KnowledgeAssertionSubject;
	readonly predicate: string;
	readonly object: KnowledgeAssertionObject;
	readonly confidence?: number;
	readonly sources?: readonly FactId[];
	readonly provenance?: string;
}

/** Entry vocabulary for ranked collection-like memory views. */
export interface CollectionEntry<T = unknown> {
	readonly id: string;
	readonly value: T;
	readonly createdAtNs: bigint;
	readonly lastAccessNs: bigint;
	readonly baseScore: number;
}

export type RankedCollectionEntry<T = unknown> = CollectionEntry<T> & {
	readonly score: number;
};

export type CollectionScoreFn<T = unknown> = (value: T) => number;

/** Query shape shared by passive retrieval/ranking helpers. */
export interface RetrievalQuery {
	readonly text?: string;
	readonly vector?: readonly number[];
	readonly entityIds?: readonly string[];
	readonly context?: readonly string[];
}

export interface VectorSearchResult<TMeta = unknown> {
	readonly id: string;
	readonly score: number;
	readonly meta?: TMeta;
}

export interface RetrievalEntry<TMem = unknown> {
	readonly key: string;
	readonly value: TMem;
	readonly score: number;
	readonly sources: ReadonlyArray<"vector" | "graph" | "store">;
	readonly context?: readonly string[];
}

export interface RetrievalTrace<TMem = unknown> {
	readonly vectorCandidates: ReadonlyArray<VectorSearchResult<TMem>>;
	readonly graphExpanded: ReadonlyArray<string>;
	readonly ranked: ReadonlyArray<RetrievalEntry<TMem>>;
	readonly packed: ReadonlyArray<RetrievalEntry<TMem>>;
}

/** Generic per-dimension thresholds. Any configured dimension below threshold is rejected. */
export type AdmissionThresholds<Dims extends string> = Partial<Record<Dims, number>>;

export interface AdmissionScoredOptions<Dims extends string, TRaw = unknown> {
	readonly scoreFn: (raw: TRaw) => Readonly<Record<Dims, number>>;
	readonly thresholds?: AdmissionThresholds<Dims>;
}

export interface AdmissionScores {
	readonly persistence: number;
	readonly structure: number;
	readonly personalValue: number;
}

export interface AdmissionScore3DOptions {
	readonly scoreFn: (raw: unknown) => AdmissionScores;
	readonly persistenceThreshold?: number;
	readonly personalValueThreshold?: number;
	readonly requireStructured?: boolean;
}

export interface ShardByTenantOptions {
	readonly tenants?: readonly string[];
	readonly shardCount?: number;
}

export interface ShardByTenantConfig<T = unknown> {
	readonly shardBy: (fragment: MemoryFragment<T>) => ShardKey;
	readonly shardCount: number;
}

export interface MemoryFragmentValidation {
	readonly ok: boolean;
	readonly errors: readonly string[];
}

/** Cosine similarity over zero-padded vectors. Non-finite results normalize to 0. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
	const n = Math.max(a.length, b.length);
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < n; i += 1) {
		const av = a[i] ?? 0;
		const bv = b[i] ?? 0;
		dot += av * bv;
		na += av * av;
		nb += bv * bv;
	}
	if (na === 0 || nb === 0) return 0;
	const score = dot / Math.sqrt(na * nb);
	return Number.isFinite(score) ? score : 0;
}

/**
 * Returns true when a fragment is valid at `asOf`.
 *
 * Omitted `asOf` has no clock to compare against, so it admits only fragments
 * that are live and not valid-time delayed.
 */
export function memoryFragmentValidAt(fragment: MemoryFragment, asOf?: bigint): boolean {
	if (asOf === undefined) return fragment.validTo === undefined && fragment.validFrom === undefined;
	if (fragment.validFrom !== undefined && fragment.validFrom > asOf) return false;
	if (fragment.validTo !== undefined && fragment.validTo <= asOf) return false;
	return true;
}

/** Pure structured-query predicate over a single fragment. */
export function memoryFragmentMatchesQuery(
	fragment: MemoryFragment,
	query: MemoryQuery = {},
): boolean {
	if (!memoryFragmentValidAt(fragment, query.asOf)) return false;
	if (query.minConfidence !== undefined && fragment.confidence < query.minConfidence) return false;
	if (
		query.tags &&
		query.tags.length > 0 &&
		!query.tags.some((tag) => fragment.tags.includes(tag))
	) {
		return false;
	}
	return true;
}

/** Filter and rank fragments by confidence desc, then transaction time desc. */
export function filterMemoryFragments<T>(
	fragments: Iterable<MemoryFragment<T>>,
	query: MemoryQuery = {},
): readonly MemoryFragment<T>[] {
	const results = [...fragments].filter((fragment) => memoryFragmentMatchesQuery(fragment, query));
	results.sort((a, b) => b.confidence - a.confidence || compareBigIntDesc(a.tNs, b.tNs));
	return query.limit === undefined ? results : results.slice(0, Math.max(0, query.limit));
}

/** Validate the passive MemoryFragment shape without throwing. */
export function validateMemoryFragment(value: unknown): MemoryFragmentValidation {
	const errors: string[] = [];
	if (typeof value !== "object" || value === null) {
		return { ok: false, errors: ["fragment must be an object"] };
	}
	const fragment = value as Partial<MemoryFragment>;
	if (typeof fragment.id !== "string" || fragment.id.length === 0) {
		errors.push("id must be a non-empty string");
	}
	if (!Object.hasOwn(fragment, "payload")) {
		errors.push("payload must be present");
	}
	if (typeof fragment.tNs !== "bigint") {
		errors.push("tNs must be a bigint");
	}
	const confidence = fragment.confidence;
	if (
		!Number.isFinite(confidence) ||
		confidence === undefined ||
		confidence < 0 ||
		confidence > 1
	) {
		errors.push("confidence must be a finite number in [0, 1]");
	}
	if (!isDenseArrayOf(fragment.tags, (tag): tag is string => typeof tag === "string")) {
		errors.push("tags must be a readonly string array");
	}
	if (!isDenseArrayOf(fragment.sources, (source): source is string => typeof source === "string")) {
		errors.push("sources must be a readonly string array");
	}
	if (fragment.validFrom !== undefined && typeof fragment.validFrom !== "bigint") {
		errors.push("validFrom must be a bigint when present");
	}
	if (fragment.validTo !== undefined && typeof fragment.validTo !== "bigint") {
		errors.push("validTo must be a bigint when present");
	}
	if (
		typeof fragment.validFrom === "bigint" &&
		typeof fragment.validTo === "bigint" &&
		fragment.validFrom >= fragment.validTo
	) {
		errors.push("validFrom must be earlier than validTo");
	}
	if (
		fragment.embedding !== undefined &&
		!isDenseArrayOf(fragment.embedding, (component): component is number =>
			Number.isFinite(component),
		)
	) {
		errors.push("embedding must be a finite number array when present");
	}
	if (fragment.parentFragmentId !== undefined && typeof fragment.parentFragmentId !== "string") {
		errors.push("parentFragmentId must be a string when present");
	}
	if (fragment.provenance !== undefined && typeof fragment.provenance !== "string") {
		errors.push("provenance must be a string when present");
	}
	return { ok: errors.length === 0, errors };
}

export function isMemoryFragment(value: unknown): value is MemoryFragment {
	return validateMemoryFragment(value).ok;
}

/**
 * Generic N-dimension admission filter. Missing or non-finite thresholded scores reject.
 */
export function admissionScored<Dims extends string, TRaw = unknown>(
	opts: AdmissionScoredOptions<Dims, TRaw>,
): (raw: TRaw) => boolean {
	const thresholds = opts.thresholds ?? ({} as AdmissionThresholds<Dims>);
	return (raw: TRaw): boolean => {
		const scores = opts.scoreFn(raw);
		for (const dim of Object.keys(thresholds) as Dims[]) {
			const min = thresholds[dim];
			if (min === undefined) continue;
			const score = scores[dim];
			const safe = Number.isFinite(score) ? (score as number) : Number.NEGATIVE_INFINITY;
			if (safe < min) return false;
		}
		return true;
	};
}

/** Three-axis admission sugar for persistence / structure / personal-value scoring. */
export function admissionFilter3D(opts: AdmissionScore3DOptions): (raw: unknown) => boolean {
	return (raw: unknown): boolean => {
		const scores = opts.scoreFn(raw);
		if (!scoreAtLeast(scores.persistence, opts.persistenceThreshold ?? 0.3)) return false;
		if (!scoreAtLeast(scores.personalValue, opts.personalValueThreshold ?? 0.3)) return false;
		if (!opts.requireStructured) return true;
		return scoreAtLeast(scores.structure, Number.MIN_VALUE);
	};
}

/** Build a passive `{ shardBy, shardCount }` pair for tenant-isolated sharding. */
export function shardByTenant<T>(
	tenantOf: (fragment: MemoryFragment<T>) => string,
	opts: ShardByTenantOptions = {},
): ShardByTenantConfig<T> {
	if (opts.tenants && opts.tenants.length > 0) {
		const tenants = [...new Set(opts.tenants)];
		const index = new Map(tenants.map((tenant, i) => [tenant, i] as const));
		const overflow = tenants.length;
		return {
			shardBy: (fragment) => index.get(tenantOf(fragment)) ?? overflow,
			shardCount: tenants.length + 1,
		};
	}
	const configuredShardCount = opts.shardCount ?? 4;
	const shardCount = Number.isSafeInteger(configuredShardCount)
		? Math.max(1, configuredShardCount)
		: 4;
	return { shardBy: (fragment) => tenantOf(fragment), shardCount };
}

function compareBigIntDesc(a: bigint, b: bigint): number {
	if (a === b) return 0;
	return a > b ? -1 : 1;
}

function isDenseArrayOf<T>(value: unknown, predicate: (item: unknown) => item is T): value is T[] {
	if (!Array.isArray(value)) return false;
	for (let i = 0; i < value.length; i += 1) {
		if (!Object.hasOwn(value, i) || !predicate(value[i])) return false;
	}
	return true;
}

function scoreAtLeast(score: number, min: number): boolean {
	return Number.isFinite(score) && score >= min;
}
