/**
 * Reactive graph observability (roadmap §9.0b — mid-level harness blocks).
 *
 * {@link graphLens} rides on any {@link Graph}, exposing four reactive
 * observability surfaces:
 *
 * - {@link LensGraph.stats} — `Node<TopologyStats>` recomputed on
 *   structural change (transitive across mounted subgraphs). Named `stats`
 *   rather than `topology` to avoid collision with the inherited
 *   {@link Graph.topology} event stream on `LensGraph`.
 * - {@link LensGraph.health} — `Node<HealthReport>` flipping `ok=false`
 *   when any node enters `"errored"` status, with `upstreamCause` walked
 *   backward through deps.
 * - {@link LensGraph.flow} — `ReactiveMapBundle<string, FlowEntry>` (not a
 *   plain snapshot node) tracking per-path DATA counts + `lastUpdate_ns`.
 *   O(1) `get`/`has`/`size` queries; `.entries` node emits lazily only when
 *   subscribed. Built on the shipped `reactiveMap` primitive.
 * - {@link LensGraph.why} — returns a live `Node<CausalChain>` from `from`
 *   to `to`, reusing {@link reactiveExplainPath}.
 *
 * Everything is pure-reactive — no polling, no opinionated thresholds.
 * Callers who want periodic staleness checks or bottleneck classification
 * compose them explicitly with `fromTimer` + a derived node.
 *
 * The transitive topology-subscription helper lives in {@link watchTopologyTree}
 * (re-exported here for convenience; canonical source is `graph/topology-tree.ts`).
 *
 * @module
 */
import { monotonicNs } from "../../core/clock.js";
import type { Node } from "../../core/node.js";
import { derived, state } from "../../core/sugar.js";
import { type ReactiveMapBundle, reactiveMap } from "../../extra/reactive-map.js";
import {
	type CausalChain,
	Graph,
	type GraphDescribeOutput,
	type GraphOptions,
	reachable,
	watchTopologyTree,
} from "../../graph/index.js";
import { domainMeta, keepalive } from "../_internal.js";
import { reactiveExplainPath } from "../audit/index.js";

export { watchTopologyTree } from "../../graph/index.js";

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** Aggregate topology stats emitted by {@link LensGraph.stats}. */
export interface TopologyStats {
	/** Total primary nodes across this graph and all transitively mounted subgraphs. */
	nodeCount: number;
	/** Total directed edges (derived from deps; no duplicates). */
	edgeCount: number;
	/** Count of mounted subgraphs (transitive). */
	subgraphCount: number;
	/** Qualified paths with no upstream deps (source nodes). Sorted. */
	sources: readonly string[];
	/** Qualified paths with no downstream consumers in-graph (sink nodes). Sorted. */
	sinks: readonly string[];
	/** Longest path from any source to any sink (in edges). `0` for empty graphs. */
	depth: number;
	/** `true` if the dep DAG contains a cycle (feedback edge). */
	hasCycles: boolean;
}

/** A single health problem entry. */
export interface HealthProblem {
	path: string;
	/** V1 only reports `"errored"`. Future versions may add `"completed"`, `"disconnected"`. */
	status: "errored";
	/** First errored upstream ancestor along the dep chain, when one exists and is distinct from `path`. */
	upstreamCause?: string;
}

/** Aggregate health snapshot. `ok=true` iff `problems.length === 0`. */
export interface HealthReport {
	ok: boolean;
	problems: readonly HealthProblem[];
}

/** One per-path flow entry stored in {@link LensGraph.flow}. */
export interface FlowEntry {
	path: string;
	/** Cumulative DATA emissions observed since the lens activated. */
	count: number;
	/** `monotonicNs()` at the most recent DATA emission, or `null` if none yet. */
	lastUpdate_ns: number | null;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for {@link graphLens}. */
export interface GraphLensOptions {
	name?: string;
	graph?: GraphOptions;
	/**
	 * Limit which node paths `flow` tracks. When omitted, every path in
	 * `target.describe()` is observed. Recommended for graphs with hundreds
	 * of nodes since each tracked path adds one observe-event dispatch per
	 * DATA emission.
	 */
	pathFilter?: (path: string) => boolean;
	/**
	 * LRU cap on the {@link LensGraph.flow} map. When set, the flow tracker
	 * evicts least-recently-used paths (by insertion / set order) once the
	 * entry count exceeds this bound. Omit for unbounded (not recommended
	 * for long-running graphs with churning paths). Passed through to the
	 * underlying {@link reactiveMap}'s `maxSize`.
	 */
	maxFlowPaths?: number;
}

// ---------------------------------------------------------------------------
// Stat computation
// ---------------------------------------------------------------------------

function lensMeta(kind: string): Record<string, unknown> {
	return domainMeta("lens", kind);
}

function computeTopologyStats(described: GraphDescribeOutput): TopologyStats {
	const paths = Object.keys(described.nodes);
	const depsByPath = new Map<string, readonly string[]>();
	const dependents = new Map<string, Set<string>>();
	for (const path of paths) {
		const deps = described.nodes[path]?.deps ?? [];
		depsByPath.set(path, deps);
		for (const dep of deps) {
			if (!dependents.has(dep)) dependents.set(dep, new Set());
			dependents.get(dep)!.add(path);
		}
	}
	const sources: string[] = [];
	const sinks: string[] = [];
	for (const path of paths) {
		if ((depsByPath.get(path) ?? []).length === 0) sources.push(path);
		if (!dependents.has(path)) sinks.push(path);
	}
	sources.sort();
	sinks.sort();

	const edgeCount = described.edges.length;

	// Cycle detection + longest path (DFS with recursion stack). Longest path
	// is measured in edges; undefined deps are ignored. Running on the DAG
	// subset: if a cycle is detected we still return `depth` for the acyclic
	// portion (0 if the whole graph cycles).
	const WHITE = 0;
	const GRAY = 1;
	const BLACK = 2;
	const color = new Map<string, number>();
	for (const p of paths) color.set(p, WHITE);
	let hasCycles = false;
	const longestFrom = new Map<string, number>();

	const dfs = (path: string): number => {
		const c = color.get(path) ?? WHITE;
		if (c === GRAY) {
			hasCycles = true;
			return 0;
		}
		if (c === BLACK) return longestFrom.get(path) ?? 0;
		color.set(path, GRAY);
		let best = 0;
		const kids = dependents.get(path);
		if (kids != null) {
			for (const k of kids) {
				const childLongest = dfs(k);
				if (childLongest + 1 > best) best = childLongest + 1;
			}
		}
		color.set(path, BLACK);
		longestFrom.set(path, best);
		return best;
	};

	let depth = 0;
	for (const src of sources) {
		const d = dfs(src);
		if (d > depth) depth = d;
	}
	// Visit remaining nodes so cycle-only subgraphs still flip hasCycles.
	for (const p of paths) {
		if (color.get(p) === WHITE) dfs(p);
	}

	return {
		nodeCount: paths.length,
		edgeCount,
		subgraphCount: described.subgraphs.length,
		sources,
		sinks,
		depth,
		hasCycles,
	};
}

function computeHealthReport(described: GraphDescribeOutput): HealthReport {
	const problems: HealthProblem[] = [];
	for (const [path, desc] of Object.entries(described.nodes)) {
		if (desc.status !== "errored") continue;
		const entry: HealthProblem = { path, status: "errored" };
		// Walk upstream to find the first errored ancestor (if any) distinct from `path`.
		// Explicit empty options disambiguates the overload (otherwise both match
		// and TS picks the `withDetail:true` signature first).
		const upstream = reachable(described, path, "upstream", {});
		for (const p of upstream) {
			if (p === path) continue;
			if (described.nodes[p]?.status === "errored") {
				entry.upstreamCause = p;
				break;
			}
		}
		problems.push(entry);
	}
	problems.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	return { ok: problems.length === 0, problems };
}

function topologyStatsEqual(a: TopologyStats, b: TopologyStats): boolean {
	return (
		a.nodeCount === b.nodeCount &&
		a.edgeCount === b.edgeCount &&
		a.subgraphCount === b.subgraphCount &&
		a.depth === b.depth &&
		a.hasCycles === b.hasCycles &&
		stringArrayEqual(a.sources, b.sources) &&
		stringArrayEqual(a.sinks, b.sinks)
	);
}

function healthReportEqual(a: HealthReport, b: HealthReport): boolean {
	if (a.ok !== b.ok) return false;
	if (a.problems.length !== b.problems.length) return false;
	for (let i = 0; i < a.problems.length; i++) {
		const x = a.problems[i]!;
		const y = b.problems[i]!;
		if (x.path !== y.path) return false;
		if (x.status !== y.status) return false;
		if (x.upstreamCause !== y.upstreamCause) return false;
	}
	return true;
}

function stringArrayEqual(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
// LensGraph
// ---------------------------------------------------------------------------

/**
 * Reactive observability surface for a target {@link Graph}.
 * See {@link graphLens}.
 *
 * @category observability
 */
export class LensGraph extends Graph {
	/**
	 * Aggregate structural stats — `nodeCount`, `edgeCount`, `sources`,
	 * `sinks`, `depth`, `hasCycles`, `subgraphCount`. Recomputes on every
	 * structural change via {@link watchTopologyTree} (transitive).
	 *
	 * Named `stats` (not `topology`) because `Graph.topology` already names
	 * the raw `TopologyEvent` stream on every graph including `LensGraph`;
	 * giving the lens its own `topology` accessor with an incompatible
	 * `Node<TopologyStats>` type would break Liskov substitutability.
	 */
	readonly stats: Node<TopologyStats>;
	readonly health: Node<HealthReport>;
	/**
	 * Per-path flow tracker — a live {@link ReactiveMapBundle} keyed by
	 * qualified path. Use `.get(path)` / `.has(path)` / `.size` for O(1)
	 * sync queries; subscribe to `.entries` for a reactive snapshot of the
	 * whole map. Lazy — the snapshot is materialized only while `.entries`
	 * has subscribers.
	 *
	 * Shape intentionally differs from `stats` / `health` (which are plain
	 * `Node<Report>`) because `flow` is a keyed collection, not a single
	 * aggregate value. The map shape exposes cheaper queries than any
	 * snapshot-based design.
	 */
	readonly flow: ReactiveMapBundle<string, FlowEntry>;
	private readonly _target: Graph;

	constructor(target: Graph, opts: GraphLensOptions = {}) {
		super(opts.name ?? `${target.name}_lens`, opts.graph);
		this._target = target;

		// ——————————————————————————————————————————————————————————————
		// Shared tick counters (closure-held — COMPOSITION-GUIDE §28 pattern).
		// `.cache` reads on state() can be undefined before the derived
		// subscribes; using closure counters keeps the derived fn pure.
		// ——————————————————————————————————————————————————————————————
		let statsVersion = 0;
		let healthVersion = 0;
		const statsTick = state(0, { name: "stats_tick" });
		const healthTick = state(0, { name: "health_tick" });
		this.add(statsTick, { name: "stats_tick" });
		this.add(healthTick, { name: "health_tick" });

		// ——————————————————————————————————————————————————————————————
		// flow — reactiveMap<qualifiedPath, FlowEntry>
		// ——————————————————————————————————————————————————————————————
		const mapOpts: { name: string; maxSize?: number } = { name: "flow" };
		if (opts.maxFlowPaths != null) mapOpts.maxSize = opts.maxFlowPaths;
		this.flow = reactiveMap<string, FlowEntry>(mapOpts);
		this.add(this.flow.entries, { name: "flow" });

		const pathFilter = opts.pathFilter;

		// ——————————————————————————————————————————————————————————————
		// Single consolidated topology watcher (stats + health + flow cleanup)
		// ——————————————————————————————————————————————————————————————
		const offTopology = watchTopologyTree(target, (event, _emitter, prefix) => {
			// Any structural change bumps stats & health.
			statsVersion += 1;
			statsTick.emit(statsVersion);
			healthVersion += 1;
			healthTick.emit(healthVersion);

			// Flow cleanup for removed paths — use the prefix to compute the
			// qualified key that matches `flow`'s entries.
			if (event.kind === "removed") {
				if (event.nodeKind === "node") {
					const qp = `${prefix}${event.name}`;
					this.flow.delete(qp);
				} else {
					// Mount removal: audit.nodes are paths RELATIVE to the unmounted
					// subgraph. Qualify with the mount's prefix to match flow keys.
					const mountPrefix = `${prefix}${event.name}::`;
					const keysToDelete: string[] = [];
					for (const relativePath of event.audit.nodes) {
						const qualified =
							relativePath === "" ? `${prefix}${event.name}` : `${mountPrefix}${relativePath}`;
						keysToDelete.push(qualified);
					}
					// deleteMany collapses N deletions into one snapshot emit.
					if (keysToDelete.length > 0) this.flow.deleteMany(keysToDelete);
				}
			}
		});
		this.addDisposer(offTopology);

		// ——————————————————————————————————————————————————————————————
		// Single consolidated observe subscription (health + flow DATA counter)
		// ——————————————————————————————————————————————————————————————
		const observeHandle = target.observe({ timeline: true, structured: true });
		const offObserve = observeHandle.onEvent((event) => {
			const t = event.type;
			// Health: recompute on status transitions and ERROR resolution.
			if (t === "error" || t === "complete" || t === "data" || t === "teardown") {
				healthVersion += 1;
				healthTick.emit(healthVersion);
			}
			// Flow: per-path DATA counter. Writes into reactiveMap; the map's
			// version counter + lazy `.entries` emission takes care of downstream
			// propagation (O(P) snapshot only when `.entries` is subscribed).
			if (t === "data") {
				const path = event.path ?? "";
				if (!path) return;
				if (pathFilter != null && !pathFilter(path)) return;
				const existing = this.flow.get(path);
				const count = existing != null ? existing.count + 1 : 1;
				this.flow.set(path, { path, count, lastUpdate_ns: monotonicNs() });
			}
		});
		this.addDisposer(() => {
			offObserve();
			observeHandle.dispose();
		});

		// ——————————————————————————————————————————————————————————————
		// stats — derived from the tick
		// ——————————————————————————————————————————————————————————————
		this.stats = derived<TopologyStats>(
			[statsTick],
			() => computeTopologyStats(target.describe({ detail: "minimal" })),
			{
				name: "stats",
				describeKind: "derived",
				equals: topologyStatsEqual,
				meta: lensMeta("stats"),
			},
		);
		this.add(this.stats, { name: "stats" });
		this.addDisposer(keepalive(this.stats));

		// ——————————————————————————————————————————————————————————————
		// health — derived from the tick
		// ——————————————————————————————————————————————————————————————
		this.health = derived<HealthReport>(
			[healthTick],
			() => computeHealthReport(target.describe({ detail: "standard" })),
			{
				name: "health",
				describeKind: "derived",
				equals: healthReportEqual,
				meta: lensMeta("health"),
			},
		);
		this.add(this.health, { name: "health" });
		this.addDisposer(keepalive(this.health));
	}

	/**
	 * Live causal chain from `from` to `to`. Recomputes whenever the target
	 * mutates. Disposed automatically when the lens is destroyed.
	 *
	 * **Lifetime note:** every call to `why()` registers a lens-owned disposer
	 * that runs on `lens.destroy()`. The returned `dispose` function releases
	 * the internal subscription but does NOT remove the lens-owned disposer —
	 * so heavy calling (e.g. per render frame) accumulates no-op disposers
	 * until lens teardown. Cache the returned handle for long-lived queries.
	 *
	 * @param from - Qualified path of the upstream endpoint.
	 * @param to - Qualified path of the downstream endpoint.
	 * @param opts - See {@link reactiveExplainPath}.
	 */
	why(
		from: string,
		to: string,
		opts?: { maxDepth?: number; name?: string; findCycle?: boolean },
	): { node: Node<CausalChain>; dispose: () => void } {
		const handle = reactiveExplainPath(this._target, from, to, opts);
		this.addDisposer(handle.dispose);
		return handle;
	}

	/** Reference to the lensed graph. */
	get target(): Graph {
		return this._target;
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a reactive observability lens over a {@link Graph}. Returns a
 * {@link LensGraph} with three reactive surfaces (`stats`, `health`, `flow`)
 * plus the `why(from, to)` method.
 *
 * The returned graph is detached. Mount it via `target.mount("lens", lens)`
 * if you want it to appear in the target's `describe()`, or keep it standalone.
 *
 * @param target - The graph to observe.
 * @param opts - See {@link GraphLensOptions}.
 *
 * @example
 * ```ts
 * const g = new Graph("app");
 * g.add(state(0, { name: "counter" }));
 * const lens = graphLens(g);
 * lens.stats.subscribe((msgs) => console.log(msgs[0]?.[1])); // TopologyStats
 * // Flow queries — O(1) without subscribing to snapshots:
 * lens.flow.get("counter");        // FlowEntry | undefined
 * lens.flow.size;                  // number
 * lens.flow.entries.subscribe(...); // reactive snapshot, lazy-materialized
 * ```
 *
 * @category observability
 */
export function graphLens(target: Graph, opts?: GraphLensOptions): LensGraph {
	return new LensGraph(target, opts);
}
