/**
 * Memory patterns (roadmap §4.3).
 *
 * Domain-layer helpers composed from GraphRefly primitives. `vectorIndex` uses
 * an exact-search backend by default; an HNSW adapter can be injected as an
 * optional dependency.
 */

import { monotonicNs } from "../../core/clock.js";
import type { Node } from "../../core/node.js";
import { derived, state } from "../../core/sugar.js";
import { Graph } from "../../graph/graph.js";

export type CollectionPolicy = "fifo" | "lru";
export type VectorBackend = "flat" | "hnsw";

export type LightCollectionEntry<T> = {
	readonly id: string;
	readonly value: T;
	readonly createdAtNs: number;
	readonly lastAccessNs: number;
};

export type LightCollectionOptions = {
	name?: string;
	maxSize?: number;
	policy?: CollectionPolicy;
};

export type LightCollectionBundle<T> = {
	readonly entries: Node<ReadonlyMap<string, LightCollectionEntry<T>>>;
	upsert: (id: string, value: T) => void;
	remove: (id: string) => void;
	clear: () => void;
	get: (id: string) => T | undefined;
	has: (id: string) => boolean;
};

export type CollectionEntry<T> = LightCollectionEntry<T> & {
	readonly baseScore: number;
};

export type RankedCollectionEntry<T> = CollectionEntry<T> & {
	readonly score: number;
};

export type CollectionOptions<T> = {
	maxSize?: number;
	policy?: CollectionPolicy;
	/**
	 * Produces a base score at insert/update time.
	 */
	score?: (value: T) => number;
	/**
	 * Exponential decay rate per second. 0 disables decay.
	 */
	decayRate?: number;
	/**
	 * Minimum score floor after decay.
	 */
	minScore?: number;
};

export type CollectionGraph<T> = Graph & {
	upsert: (id: string, value: T, opts?: { score?: number }) => void;
	remove: (id: string) => void;
	clear: () => void;
	getItem: (id: string) => CollectionEntry<T> | undefined;
};

export type VectorRecord<TMeta> = {
	readonly id: string;
	readonly vector: readonly number[];
	readonly meta?: TMeta;
};

export type VectorSearchResult<TMeta> = {
	readonly id: string;
	readonly score: number;
	readonly meta?: TMeta;
};

export type HnswAdapter<TMeta> = {
	upsert: (id: string, vector: readonly number[], meta?: TMeta) => void;
	remove: (id: string) => void;
	clear: () => void;
	search: (query: readonly number[], k: number) => ReadonlyArray<VectorSearchResult<TMeta>>;
};

export type VectorIndexOptions<TMeta> = {
	backend?: VectorBackend;
	dimension?: number;
	/**
	 * Optional dependency seam for HNSW.
	 */
	hnswFactory?: () => HnswAdapter<TMeta>;
};

export type VectorIndexBundle<TMeta> = {
	readonly backend: VectorBackend;
	readonly entries: Node<ReadonlyMap<string, VectorRecord<TMeta>>>;
	upsert: (id: string, vector: readonly number[], meta?: TMeta) => void;
	remove: (id: string) => void;
	clear: () => void;
	search: (query: readonly number[], k?: number) => ReadonlyArray<VectorSearchResult<TMeta>>;
};

export type KnowledgeEdge<TRelation extends string = string> = {
	readonly from: string;
	readonly to: string;
	readonly relation: TRelation;
	readonly weight: number;
};

export type KnowledgeGraphGraph<TEntity, TRelation extends string = string> = Graph & {
	upsertEntity: (id: string, value: TEntity) => void;
	removeEntity: (id: string) => void;
	link: (from: string, to: string, relation: TRelation, weight?: number) => void;
	unlink: (from: string, to: string, relation?: TRelation) => void;
	related: (id: string, relation?: TRelation) => ReadonlyArray<KnowledgeEdge<TRelation>>;
};

export function decay(
	baseScore: number,
	ageSeconds: number,
	ratePerSecond: number,
	minScore = 0,
): number {
	if (!Number.isFinite(baseScore)) return minScore;
	if (!Number.isFinite(ageSeconds) || ageSeconds <= 0) return Math.max(minScore, baseScore);
	if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) return Math.max(minScore, baseScore);
	const decayed = baseScore * Math.exp(-ratePerSecond * ageSeconds);
	return Math.max(minScore, decayed);
}

function assertMaxSize(maxSize: number | undefined): void {
	if (maxSize !== undefined && maxSize < 1) {
		throw new RangeError("maxSize must be >= 1");
	}
}

function copyMap<K, V>(m: ReadonlyMap<K, V>): Map<K, V> {
	return new Map(m);
}

function readMap<K, V>(node: Node<ReadonlyMap<K, V>>): ReadonlyMap<K, V> {
	return node.cache ?? new Map<K, V>();
}

function readArray<T>(node: Node<ReadonlyArray<T>>): ReadonlyArray<T> {
	return node.cache ?? [];
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
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
	return dot / Math.sqrt(na * nb);
}

export function lightCollection<T>(opts: LightCollectionOptions = {}): LightCollectionBundle<T> {
	const maxSize = opts.maxSize;
	const policy = opts.policy ?? "fifo";
	assertMaxSize(maxSize);

	const entries = state<ReadonlyMap<string, LightCollectionEntry<T>>>(new Map(), {
		name: opts.name,
		describeKind: "state",
	});

	function evictIfNeeded(next: Map<string, LightCollectionEntry<T>>): void {
		if (maxSize === undefined) return;
		while (next.size > maxSize) {
			let victim: LightCollectionEntry<T> | undefined;
			for (const entry of next.values()) {
				if (!victim) {
					victim = entry;
					continue;
				}
				const lhs = policy === "lru" ? entry.lastAccessNs : entry.createdAtNs;
				const rhs = policy === "lru" ? victim.lastAccessNs : victim.createdAtNs;
				if (lhs < rhs) victim = entry;
			}
			if (!victim) break;
			next.delete(victim.id);
		}
	}

	function commit(next: Map<string, LightCollectionEntry<T>>): void {
		entries.emit(next);
	}

	return {
		entries,
		upsert(id, value) {
			const now = monotonicNs();
			const current = readMap(entries);
			const prev = current.get(id);
			const next = copyMap(current);
			next.set(id, {
				id,
				value,
				createdAtNs: prev?.createdAtNs ?? now,
				lastAccessNs: now,
			});
			evictIfNeeded(next);
			commit(next);
		},
		remove(id) {
			const next = copyMap(readMap(entries));
			if (!next.delete(id)) return;
			commit(next);
		},
		clear() {
			if (readMap(entries).size === 0) return;
			commit(new Map());
		},
		get(id) {
			const current = readMap(entries);
			const found = current.get(id);
			if (!found) return undefined;
			if (policy === "lru") {
				const now = monotonicNs();
				const next = copyMap(current);
				next.set(id, { ...found, lastAccessNs: now });
				commit(next);
			}
			return found.value;
		},
		has(id) {
			return readMap(entries).has(id);
		},
	};
}

export function collection<T>(name: string, opts: CollectionOptions<T> = {}): CollectionGraph<T> {
	const maxSize = opts.maxSize;
	const policy = opts.policy ?? "lru";
	const decayRate = opts.decayRate ?? 0;
	const minScore = opts.minScore ?? 0;
	const scoreFn = opts.score ?? (() => 1);
	assertMaxSize(maxSize);

	const graph = new Graph(name);
	const items = state<ReadonlyMap<string, CollectionEntry<T>>>(new Map(), {
		name: "items",
		describeKind: "state",
	});
	const ranked = derived(
		[items],
		([snapshot]) => {
			const typed = (snapshot ?? new Map()) as ReadonlyMap<string, CollectionEntry<T>>;
			const now = monotonicNs();
			const out = [...typed.values()].map((entry) => {
				const ageSeconds = (now - entry.lastAccessNs) / 1_000_000_000;
				return {
					...entry,
					score: decay(entry.baseScore, ageSeconds, decayRate, minScore),
				};
			});
			out.sort((a, b) => b.score - a.score || b.lastAccessNs - a.lastAccessNs);
			return out;
		},
		{ name: "ranked", describeKind: "derived" },
	);
	const size = derived(
		[items],
		([snapshot]) => ((snapshot ?? new Map()) as ReadonlyMap<string, CollectionEntry<T>>).size,
		{
			name: "size",
			describeKind: "derived",
			initial: 0,
		},
	);
	void ranked.subscribe(() => undefined);
	void size.subscribe(() => undefined);

	graph.add(items, { name: "items" });
	graph.add(ranked, { name: "ranked" });
	graph.add(size, { name: "size" });

	function effective(entry: CollectionEntry<T>, now: number): number {
		const ageSeconds = (now - entry.lastAccessNs) / 1_000_000_000;
		return decay(entry.baseScore, ageSeconds, decayRate, minScore);
	}

	function evictIfNeeded(next: Map<string, CollectionEntry<T>>): void {
		if (maxSize === undefined) return;
		while (next.size > maxSize) {
			const now = monotonicNs();
			let victim: CollectionEntry<T> | undefined;
			let victimScore = Number.POSITIVE_INFINITY;
			for (const entry of next.values()) {
				const score = effective(entry, now);
				if (score < victimScore) {
					victim = entry;
					victimScore = score;
					continue;
				}
				if (score === victimScore && victim) {
					const lhs = policy === "lru" ? entry.lastAccessNs : entry.createdAtNs;
					const rhs = policy === "lru" ? victim.lastAccessNs : victim.createdAtNs;
					if (lhs < rhs) victim = entry;
				}
			}
			if (!victim) break;
			next.delete(victim.id);
		}
	}

	function commit(next: Map<string, CollectionEntry<T>>): void {
		items.emit(next);
	}

	const out = Object.assign(graph, {
		upsert(id: string, value: T, upsertOpts?: { score?: number }) {
			const now = monotonicNs();
			const current = readMap(items);
			const prev = current.get(id);
			const baseScore = upsertOpts?.score ?? scoreFn(value);
			const next = copyMap(current);
			next.set(id, {
				id,
				value,
				baseScore,
				createdAtNs: prev?.createdAtNs ?? now,
				lastAccessNs: now,
			});
			evictIfNeeded(next);
			commit(next);
		},
		remove(id: string) {
			const next = copyMap(readMap(items));
			if (!next.delete(id)) return;
			commit(next);
		},
		clear() {
			if (readMap(items).size === 0) return;
			commit(new Map());
		},
		getItem(id: string): CollectionEntry<T> | undefined {
			const current = readMap(items);
			const found = current.get(id);
			if (!found) return undefined;
			if (policy === "lru") {
				const next = copyMap(current);
				next.set(id, { ...found, lastAccessNs: monotonicNs() });
				commit(next);
			}
			return found;
		},
	}) as CollectionGraph<T>;
	return out;
}

export function vectorIndex<TMeta>(opts: VectorIndexOptions<TMeta> = {}): VectorIndexBundle<TMeta> {
	const backend = opts.backend ?? "flat";
	const dimension = opts.dimension;
	let hnsw: HnswAdapter<TMeta> | undefined;
	if (backend === "hnsw") {
		hnsw = opts.hnswFactory?.();
		if (!hnsw) {
			throw new Error(
				'vectorIndex backend "hnsw" requires an optional dependency adapter; install your HNSW package and provide `hnswFactory`.',
			);
		}
	}

	const entries = state<ReadonlyMap<string, VectorRecord<TMeta>>>(new Map(), {
		describeKind: "state",
		name: "vector-index",
	});

	function assertDimension(vector: readonly number[]): void {
		if (dimension !== undefined && vector.length !== dimension) {
			throw new RangeError(
				`vector dimension mismatch: expected ${dimension}, got ${vector.length}`,
			);
		}
	}

	function commit(next: Map<string, VectorRecord<TMeta>>): void {
		entries.emit(next);
	}

	return {
		backend,
		entries,
		upsert(id, vector, meta) {
			assertDimension(vector);
			const next = copyMap(readMap(entries));
			next.set(id, { id, vector: [...vector], meta });
			if (backend === "hnsw") hnsw!.upsert(id, vector, meta);
			commit(next);
		},
		remove(id) {
			const next = copyMap(readMap(entries));
			if (!next.delete(id)) return;
			if (backend === "hnsw") hnsw!.remove(id);
			commit(next);
		},
		clear() {
			if (readMap(entries).size === 0) return;
			if (backend === "hnsw") hnsw!.clear();
			commit(new Map());
		},
		search(query, k = 5) {
			assertDimension(query);
			if (k <= 0) return [];
			if (backend === "hnsw") return hnsw!.search(query, k);
			const ranked = [...readMap(entries).values()]
				.map((row) => ({
					id: row.id,
					score: cosineSimilarity(query, row.vector),
					meta: row.meta,
				}))
				.sort((a, b) => b.score - a.score)
				.slice(0, k);
			return ranked;
		},
	};
}

export function knowledgeGraph<TEntity, TRelation extends string = string>(
	name: string,
): KnowledgeGraphGraph<TEntity, TRelation> {
	const graph = new Graph(name);
	const entities = state<ReadonlyMap<string, TEntity>>(new Map(), {
		name: "entities",
		describeKind: "state",
	});
	const edges = state<ReadonlyArray<KnowledgeEdge<TRelation>>>([], {
		name: "edges",
		describeKind: "state",
	});
	const adjacency = derived(
		[edges],
		([rows]) => {
			const typed = (rows ?? []) as ReadonlyArray<KnowledgeEdge<TRelation>>;
			const out = new Map<string, ReadonlyArray<KnowledgeEdge<TRelation>>>();
			for (const edge of typed) {
				const prev = out.get(edge.from) ?? [];
				out.set(edge.from, Object.freeze([...prev, edge]));
			}
			return out;
		},
		{ name: "adjacency", describeKind: "derived", initial: new Map() },
	);
	void adjacency.subscribe(() => undefined);

	graph.add(entities, { name: "entities" });
	graph.add(edges, { name: "edges" });
	graph.add(adjacency, { name: "adjacency" });

	function commitEntities(next: Map<string, TEntity>): void {
		entities.emit(next);
	}

	function commitEdges(next: ReadonlyArray<KnowledgeEdge<TRelation>>): void {
		edges.emit(next);
	}

	const out = Object.assign(graph, {
		upsertEntity(id: string, value: TEntity) {
			const next = copyMap(readMap(entities));
			next.set(id, value);
			commitEntities(next);
		},
		removeEntity(id: string) {
			const nextEntities = copyMap(readMap(entities));
			const existed = nextEntities.delete(id);
			const currentEdges = readArray(edges);
			const nextEdges = currentEdges.filter((edge) => edge.from !== id && edge.to !== id);
			if (!existed && nextEdges.length === currentEdges.length) return;
			commitEntities(nextEntities);
			commitEdges(nextEdges);
		},
		link(from: string, to: string, relation: TRelation, weight = 1) {
			const key = `${from}\u0000${to}\u0000${relation}`;
			const currentEdges = readArray(edges);
			const existing = new Set(
				currentEdges.map((edge) => `${edge.from}\u0000${edge.to}\u0000${edge.relation}`),
			);
			const next = [...currentEdges];
			if (existing.has(key)) {
				for (let i = 0; i < next.length; i += 1) {
					const edge = next[i]!;
					if (edge.from === from && edge.to === to && edge.relation === relation) {
						next[i] = { ...edge, weight };
						break;
					}
				}
			} else {
				next.push({ from, to, relation, weight });
			}
			commitEdges(next);
		},
		unlink(from: string, to: string, relation?: TRelation) {
			const currentEdges = readArray(edges);
			const next = currentEdges.filter((edge) =>
				relation === undefined
					? !(edge.from === from && edge.to === to)
					: !(edge.from === from && edge.to === to && edge.relation === relation),
			);
			if (next.length === currentEdges.length) return;
			commitEdges(next);
		},
		related(id: string, relation?: TRelation): ReadonlyArray<KnowledgeEdge<TRelation>> {
			return readArray(edges).filter(
				(edge) =>
					(edge.from === id || edge.to === id) &&
					(relation === undefined || edge.relation === relation),
			);
		},
	}) as KnowledgeGraphGraph<TEntity, TRelation>;
	return out;
}
