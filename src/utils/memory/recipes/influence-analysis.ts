/**
 * Recipe — **write-time influence analysis** (MEME write-time `reachable`).
 *
 * The store's `dependents_index` is a one-hop reverse-dependency map; "if I
 * obsolete fact X, what *transitively* gets invalidated?" is its closure. This
 * recipe exposes that closure as a reactive projection over face ④
 * (`mem.dependentsIndex`), so a writer can see blast-radius **before**
 * committing an obsolescence — the same reachability the cascade loop walks,
 * surfaced for inspection.
 *
 * ```ts
 * const inf = influenceAnalysis(mem);
 * inf.influenceOf("home").subscribe(ids => console.log("obsoleting home hits", ids));
 * inf.ranked.subscribe(rows => rows.slice(0,5)); // most-influential facts
 * ```
 *
 * Pure observer — never writes back, so it cannot perturb cascade
 * convergence. **Single-apply per store** (it adds an `${name}_ranked` node);
 * apply twice on the same `mem` only with a distinct `opts.name`.
 *
 * **Cost.** `ranked` runs a BFS closure per index key on every
 * `dependents_index` emit — O(keys · (V+E)), NOT O(maxRanked); `maxRanked`
 * caps only the emitted slice, not the computation. Acceptable because
 * `dependents_index` is metadata (≪ the fact store, per DS-14.7 Q9-open-1);
 * for a pathologically dense index prefer `influenceOf(id)` (single-root BFS)
 * over subscribing `ranked`. In a cyclic reverse-dep graph
 * (LLM-extracted `A→B→A`) `closureOf` still terminates (`seen` set) but every
 * SCC member reports the same closure size — a *reachability* count, not the
 * cascade's actual obsolete-only propagation reach (which `processedRoots`
 * bounds further).
 *
 * @module
 */

import { type Node, node } from "@graphrefly/pure-ts/core";
import { keepalive } from "@graphrefly/pure-ts/extra";
import type { DependentsIndex, FactId, ReactiveFactStoreGraph } from "../fact-store.js";
import { lastOf } from "./_shared.js";

export interface InfluenceRow {
	readonly factId: FactId;
	/** Size of the transitive dependent closure (blast radius if obsoleted). */
	readonly influence: number;
}

export interface InfluenceAnalysisOptions {
	/** Cap on rows emitted by `ranked` (top-N by influence). Default `64`. */
	readonly maxRanked?: number;
	/** Node name prefix. Default `influence`. */
	readonly name?: string;
}

export interface InfluenceAnalysis {
	/** Reactive transitive dependent closure of `rootId` (excludes the root). */
	influenceOf(rootId: FactId): Node<readonly FactId[]>;
	/** Facts ranked by transitive-closure size (desc), capped at `maxRanked`. */
	readonly ranked: Node<readonly InfluenceRow[]>;
}

/** BFS the reverse-dep index from `root`; returns reachable ids (root excluded). */
function closureOf(index: DependentsIndex, root: FactId): FactId[] {
	const seen = new Set<FactId>();
	const queue: FactId[] = [root];
	while (queue.length > 0) {
		const cur = queue.shift()!;
		for (const dep of index.get(cur) ?? []) {
			if (seen.has(dep) || dep === root) continue;
			seen.add(dep);
			queue.push(dep);
		}
	}
	return [...seen];
}

/**
 * Attach influence/blast-radius analysis to a {@link reactiveFactStore}.
 *
 * @category memory
 */
export function influenceAnalysis<T>(
	mem: ReactiveFactStoreGraph<T>,
	opts: InfluenceAnalysisOptions = {},
): InfluenceAnalysis {
	const prefix = opts.name ?? "influence";
	const maxRanked = Math.max(1, opts.maxRanked ?? 64);

	const ranked = node<readonly InfluenceRow[]>(
		[mem.dependentsIndex],
		(batchData, actions, ctx) => {
			const index = lastOf<DependentsIndex>(batchData[0], ctx.prevData[0]);
			if (index == null) {
				actions.emit([]);
				return;
			}
			const rows: InfluenceRow[] = [];
			for (const key of index.keys()) {
				rows.push({ factId: key, influence: closureOf(index, key).length });
			}
			rows.sort((a, b) => b.influence - a.influence);
			actions.emit(rows.slice(0, maxRanked));
		},
		{
			name: `${prefix}_ranked`,
			describeKind: "derived",
			initial: [] as readonly InfluenceRow[],
		},
	);
	mem.add(ranked, { name: `${prefix}_ranked` });
	mem.addDisposer(keepalive(ranked));

	// Memoize per-rootId: a recipe node is added to `mem` under a unique name,
	// and `Graph.add` throws on a duplicate name — so `influenceOf("a")` called
	// twice (two call sites, or a re-derive) MUST return the same node, not
	// re-add. Also bounds growth (one node per distinct queried root, not per
	// call) for the store's lifetime.
	const builtFor = new Map<FactId, Node<readonly FactId[]>>();
	function influenceOf(rootId: FactId): Node<readonly FactId[]> {
		const existing = builtFor.get(rootId);
		if (existing) return existing;
		const n = node<readonly FactId[]>(
			[mem.dependentsIndex],
			(batchData, actions, ctx) => {
				const index = lastOf<DependentsIndex>(batchData[0], ctx.prevData[0]);
				actions.emit(index == null ? [] : closureOf(index, rootId));
			},
			{
				name: `${prefix}_of_${rootId}`,
				describeKind: "derived",
				initial: [] as readonly FactId[],
			},
		);
		mem.add(n, { name: `${prefix}_of_${rootId}` });
		mem.addDisposer(keepalive(n));
		builtFor.set(rootId, n);
		return n;
	}

	return { influenceOf, ranked };
}
