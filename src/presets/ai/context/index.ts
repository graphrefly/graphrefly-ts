/**
 * DS-14.6.A U-A — tagged context substrate (Phase 14.5).
 *
 * Per-view tagged context (SESSION-DS-14.6-A L3–L6 + SESSION-DS-14.6-A-9Q
 * implementation walk). Pool stores immutable tier-0 originals on an
 * **append-only `reactiveLog`** (D-A4 — structural tier-0 immutability, free
 * `LogChange` mutations, side-steps the DS14R1 TTL/LRU prune-fidelity bug).
 * Each consumer holds a `ContextView` that materialises its own filtered +
 * compressed slice (`Node<readonly RenderedEntry[]>`). Routing is mechanical
 * tag comparison (zero LLM); only `llm-summary` rules cross to an injected
 * `llmCompress` (D-A3). Compression cache is one shared `(id, tier)` map in
 * the pool bundle, bounded LRU (D-A5). Schema is pure data, presentation
 * layer (D-A1) — no `@graphrefly/pure-ts` consumer.
 *
 * @module
 */

import { type Node, node, wallClockNs } from "@graphrefly/pure-ts/core";
import { type ReactiveLogBundle, reactiveLog } from "@graphrefly/pure-ts/extra";
import { Graph } from "@graphrefly/pure-ts/graph";
import { aiMeta } from "../../../utils/ai/_internal.js";

// ── Schema (pure data — D-A1) ────────────────────────────────────────────────

export type Tag = string;

/** Compression tier. 0 = original; higher = more compressed. */
export type Tier = 0 | 1 | 2 | 3;

export interface ContextEntry<T> {
	/** Stable id — cache key component `(id, tier)`. Auto-assigned if omitted. */
	readonly id: string;
	readonly payload: T;
	readonly tags: readonly Tag[];
	/** 0..1. Budget/GC ordering. */
	readonly importance: number;
	readonly compressible: boolean;
	readonly topic: string;
	/** Wall-clock at add (ns) — used by `poolGC({ olderThanNs })`. */
	readonly t_ns: number;
}

export interface RuleMatch {
	readonly topic?: string | RegExp;
	readonly tagsAny?: readonly Tag[];
	readonly importanceMin?: number;
	readonly importanceMax?: number;
	readonly compressible?: boolean;
}

export type CompressionRule =
	| { readonly match: RuleMatch; readonly action: "evict" }
	| { readonly match: RuleMatch; readonly action: "truncate"; readonly maxChars: number }
	| { readonly match: RuleMatch; readonly action: "reference" }
	| { readonly match: RuleMatch; readonly action: "llm-summary"; readonly toTier: Tier };

export interface RenderedEntry<T> {
	readonly id: string;
	readonly topic: string;
	readonly tags: readonly Tag[];
	readonly tier: Tier;
	/** Original payload at tier 0; compressed `string` otherwise. */
	readonly payload: T | string;
	readonly compressed: boolean;
}

export interface ContextView<T> {
	readonly filter: (e: ContextEntry<T>) => boolean;
	/** 0..1. A rule fires when `pressure > 0` and the entry matches. */
	readonly pressure: Node<number>;
	readonly budgetTokens: number;
	readonly rules: readonly CompressionRule[];
	/** Default `s => Math.ceil(s.length / 4)`. */
	readonly tokenizer?: (s: string) => number;
}

export interface PoolGCPolicy {
	/** Drop entries with `t_ns < (now - olderThanNs)`. */
	readonly olderThanNs?: number;
	/** Drop entries with `importance < importanceBelow`. */
	readonly importanceBelow?: number;
	/**
	 * **Scope**, not a match-to-evict rule: when set, GC only considers
	 * entries whose `topic === this`; entries of other topics always survive.
	 * `olderThanNs` / `importanceBelow` are ANDed *within* this scope.
	 */
	readonly topic?: string;
	/** Keep at most this many most-recent entries. */
	readonly max?: number;
}

/** `(entry, toTier) => compressedText`. Injected; required iff a view uses `llm-summary`. */
export type LlmCompress<T> = (entry: ContextEntry<T>, toTier: Tier) => string;

export interface TaggedContextPoolOptions<T> {
	readonly topic: string;
	/** Forwarded to the backing append-only `reactiveLog` (poolGC ceiling). */
	readonly maxEntries?: number;
	/** Required iff any rendered view uses an `llm-summary` rule (D-A3). */
	readonly llmCompress?: LlmCompress<T>;
	/** Shared `(id, tier)` compression cache cap (D-A5). Default 512. */
	readonly cacheMax?: number;
	readonly name?: string;
}

export interface TaggedContextPoolBundle<T> {
	/**
	 * Append an entry (immutable tier-0). Returns its id (auto-assigned
	 * `ctx-N` per-pool if omitted).
	 *
	 * **Caller-supplied ids must be unique within the pool.** The log is
	 * append-only and does NOT dedupe; the compression cache is keyed by
	 * `(id, tier)`, so appending two different entries with the same explicit
	 * `id` makes the second render the first's cached summary (QA P11).
	 */
	add(entry: Omit<ContextEntry<T>, "id" | "t_ns"> & { id?: string }): string;
	/** All live tier-0 entries. */
	readonly entries: Node<readonly ContextEntry<T>[]>;
	/** Entries carrying `tag`. */
	byTag(tag: Tag): Node<readonly ContextEntry<T>[]>;
	/** Pool-global retention (L6 — distinct from per-view filtering). Returns removed count. */
	poolGC(policy: PoolGCPolicy): number;
	readonly graph: Graph;
	/** Internal — shared compression cache (one per pool, D-A5). */
	readonly _cache: CompressionCache;
	readonly _opts: TaggedContextPoolOptions<T>;
	dispose(): void;
}

// ── Shared bounded (id,tier) compression cache (D-A5) ────────────────────────

/**
 * Bounded LRU cache keyed by `(id, tier)`. Uses a nested `Map<id, Map<tier,
 * value>>` (NOT a `${id}::${tier}` string key) so a caller-supplied `id`
 * containing the separator cannot collide (QA P5). LRU is tracked at the
 * (id,tier) leaf via a flat insertion-order key list.
 */
export class CompressionCache {
	private readonly _m = new Map<string, Map<Tier, string>>();
	/** Insertion-order list of `id` keys for LRU eviction at the id granularity. */
	private readonly _order: string[] = [];
	constructor(private readonly _max: number) {}
	get(id: string, tier: Tier): string | undefined {
		const inner = this._m.get(id);
		const v = inner?.get(tier);
		if (v !== undefined) {
			const i = this._order.indexOf(id);
			if (i >= 0) this._order.splice(i, 1);
			this._order.push(id);
		}
		return v;
	}
	set(id: string, tier: Tier, value: string): void {
		let inner = this._m.get(id);
		if (inner === undefined) {
			inner = new Map<Tier, string>();
			this._m.set(id, inner);
		}
		inner.set(tier, value);
		const i = this._order.indexOf(id);
		if (i >= 0) this._order.splice(i, 1);
		this._order.push(id);
		while (this._m.size > this._max) {
			const evict = this._order.shift();
			if (evict === undefined) break;
			this._m.delete(evict);
		}
	}
}

// ── Pool ─────────────────────────────────────────────────────────────────────

/** Process-wide sequence for collision-safe default mount names (QA P6). */
let _poolSeq = 0;

/**
 * Append-only tagged context pool (D-A4). The pool is a `reactiveLog` of
 * immutable tier-0 entries plus a derived `entries` node; `byTag` derives a
 * filtered view; `poolGC` is the explicit pool-global retention (L6).
 */
export function taggedContextPool<T>(
	parent: Graph,
	opts: TaggedContextPoolOptions<T>,
): TaggedContextPoolBundle<T> {
	// QA P6: collision-safe default mount name — two pools with the same
	// `topic` under one parent must not collide on `parent.mount`. Explicit
	// `opts.name` is respected verbatim (caller owns uniqueness then).
	const mountName = opts.name ?? `ctxpool-${opts.topic}-${++_poolSeq}`;
	const graph = new Graph(mountName);
	parent.mount(mountName, graph);

	const log: ReactiveLogBundle<ContextEntry<T>> = reactiveLog<ContextEntry<T>>(undefined, {
		name: `${mountName}.log`,
		maxSize: opts.maxEntries,
	});
	const cache = new CompressionCache(opts.cacheMax ?? 512);
	// QA P5: per-pool id counter (was module-global → test-pollution +
	// cross-pool cache-key cross-talk).
	let autoId = 0;

	const entries: Node<readonly ContextEntry<T>[]> = log.entries;

	function add(e: Omit<ContextEntry<T>, "id" | "t_ns"> & { id?: string }): string {
		const id = e.id ?? `ctx-${++autoId}`;
		log.append({
			id,
			payload: e.payload,
			tags: e.tags,
			importance: e.importance,
			compressible: e.compressible,
			topic: e.topic,
			t_ns: wallClockNs(), // QA P2 — clock.ts invariant (was Date.now()*1e6)
		});
		return id;
	}

	function byTag(tag: Tag): Node<readonly ContextEntry<T>[]> {
		return node<readonly ContextEntry<T>[]>(
			[entries as Node],
			(data, actions, ctx) => {
				const cur = (data[0] != null && data[0].length > 0 ? data[0].at(-1) : ctx.prevData[0]) as
					| readonly ContextEntry<T>[]
					| undefined;
				actions.emit((cur ?? []).filter((x) => x.tags.includes(tag)));
			},
			{ describeKind: "derived", meta: aiMeta("contextPool.byTag", { tag }) },
		);
	}

	function poolGC(policy: PoolGCPolicy): number {
		const all = log.entries.cache ?? [];
		const nowNs = wallClockNs();
		let survivors = all.filter((e) => {
			// QA P1: `topic` is a SCOPE, not a match-to-evict rule — entries
			// outside the topic are never GC'd by this call; eviction criteria
			// (olderThanNs / importanceBelow) are ANDed within the scope.
			if (policy.topic != null && e.topic !== policy.topic) return true;
			if (policy.olderThanNs != null && nowNs - e.t_ns >= policy.olderThanNs) return false;
			if (policy.importanceBelow != null && e.importance < policy.importanceBelow) return false;
			return true;
		});
		if (policy.max != null && survivors.length > policy.max) {
			survivors = survivors.slice(survivors.length - policy.max);
		}
		const removed = all.length - survivors.length;
		if (removed > 0) {
			log.clear();
			log.appendMany(survivors);
		}
		return removed;
	}

	return {
		add,
		entries,
		byTag,
		poolGC,
		graph,
		_cache: cache,
		_opts: opts,
		dispose(): void {
			log.dispose();
		},
	};
}

// ── tierCompress + renderContextView ─────────────────────────────────────────

const DEFAULT_TOKENIZER = (s: string): number => Math.ceil(s.length / 4);

function matches(e: ContextEntry<unknown>, m: RuleMatch): boolean {
	if (m.topic != null) {
		if (typeof m.topic === "string" ? e.topic !== m.topic : !m.topic.test(e.topic)) return false;
	}
	if (m.tagsAny != null && !m.tagsAny.some((t) => e.tags.includes(t))) return false;
	if (m.importanceMin != null && e.importance < m.importanceMin) return false;
	if (m.importanceMax != null && e.importance > m.importanceMax) return false;
	if (m.compressible != null && e.compressible !== m.compressible) return false;
	return true;
}

/**
 * Apply the first matching rule to one entry under `pressure`. Non-LLM
 * strategies (truncate / evict / reference) are pure data; `llm-summary`
 * calls the injected `llmCompress`, caching by `(id, toTier)` (D-A5).
 * Returns `undefined` for evicted / pressure-filtered entries.
 */
export function tierCompress<T>(
	e: ContextEntry<T>,
	rules: readonly CompressionRule[],
	pressure: number,
	cache: CompressionCache,
	llmCompress?: LlmCompress<T>,
): RenderedEntry<T> | undefined {
	const base: RenderedEntry<T> = {
		id: e.id,
		topic: e.topic,
		tags: e.tags,
		tier: 0,
		payload: e.payload,
		compressed: false,
	};
	if (pressure <= 0) return base;
	for (const rule of rules) {
		if (!matches(e, rule.match)) continue;
		switch (rule.action) {
			case "evict":
				return undefined;
			case "reference":
				return { ...base, tier: 1, payload: `[ref:${e.id}]`, compressed: true };
			case "truncate": {
				const s = typeof e.payload === "string" ? e.payload : JSON.stringify(e.payload);
				return {
					...base,
					tier: 1,
					payload: s.length > rule.maxChars ? s.slice(0, rule.maxChars) : s,
					compressed: s.length > rule.maxChars,
				};
			}
			case "llm-summary": {
				if (!llmCompress) {
					// Defence-in-depth — construction guard should have thrown.
					throw new Error("tierCompress: 'llm-summary' rule requires `llmCompress`");
				}
				const cached = cache.get(e.id, rule.toTier);
				const text = cached ?? llmCompress(e, rule.toTier);
				if (cached === undefined) cache.set(e.id, rule.toTier, text);
				return { ...base, tier: rule.toTier, payload: text, compressed: true };
			}
		}
	}
	return base;
}

/**
 * Per-consumer reactive rendering (D-A2). Materialises a
 * `Node<readonly RenderedEntry[]>` over the pool: filter → per-entry rule
 * application under `pressure` → token-budget trim (lowest-importance first).
 *
 * Recomputes the slice per `(entries | pressure)` wave (O(n) — behaviourally
 * identical to the incremental closure-mirror; incremental is a perf
 * follow-up, not a correctness gap).
 *
 * @throws if any rule is `llm-summary` and the pool has no `llmCompress`
 *   (D-A3 construction guard).
 */
export function renderContextView<T>(
	pool: TaggedContextPoolBundle<T>,
	view: ContextView<T>,
): Node<readonly RenderedEntry<T>[]> {
	const usesLlm = view.rules.some((r) => r.action === "llm-summary");
	if (usesLlm && !pool._opts.llmCompress) {
		throw new Error(
			"renderContextView: view has an 'llm-summary' rule but the pool was created without `llmCompress` (DS-14.6.A D-A3).",
		);
	}
	const tokenize = view.tokenizer ?? DEFAULT_TOKENIZER;
	const llmCompress = pool._opts.llmCompress;

	return node<readonly RenderedEntry<T>[]>(
		[pool.entries as Node, view.pressure as Node],
		(data, actions, ctx) => {
			const entries = (data[0] != null && data[0].length > 0 ? data[0].at(-1) : ctx.prevData[0]) as
				| readonly ContextEntry<T>[]
				| undefined;
			const pressure = (data[1] != null && data[1].length > 0 ? data[1].at(-1) : ctx.prevData[1]) as
				| number
				| undefined;
			if (entries === undefined) {
				actions.emit([]);
				return;
			}
			const p = pressure ?? 0;
			const rendered: RenderedEntry<T>[] = [];
			for (const e of entries) {
				if (!view.filter(e)) continue;
				const r = tierCompress(e, view.rules, p, pool._cache, llmCompress);
				if (r !== undefined) rendered.push(r);
			}
			// Token-budget trim: drop lowest-importance entries until under budget.
			const cost = (r: RenderedEntry<T>): number =>
				tokenize(typeof r.payload === "string" ? r.payload : JSON.stringify(r.payload));
			let total = 0;
			for (const r of rendered) total += cost(r);
			if (total > view.budgetTokens) {
				const byImp = entries.reduce<Map<string, number>>(
					(acc, e) => acc.set(e.id, e.importance),
					new Map(),
				);
				rendered.sort((a, b) => (byImp.get(a.id) ?? 0) - (byImp.get(b.id) ?? 0));
				while (total > view.budgetTokens && rendered.length > 0) {
					total -= cost(rendered.shift() as RenderedEntry<T>);
				}
			}
			actions.emit(rendered);
		},
		{ describeKind: "derived", meta: aiMeta("contextView", { topic: pool._opts.topic }) },
	);
}
