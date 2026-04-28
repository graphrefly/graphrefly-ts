/**
 * Reactive graph observability preset (Tier 5.3 reshape — Session A.4 lock).
 *
 * `graphLens(target)` is a thin compositor (~30 LOC of glue) over two
 * already-shipped reactive primitives:
 *
 * - `target.describe({ reactive: true })` — live topology snapshot.
 * - `target.observe({ reactive: true, tiers: ["data"] })` — coalesced data
 *   changesets per outermost batch flush.
 *
 * It returns three Nodes plus a dispose function:
 *
 * - `topology: Node<GraphDescribeOutput>` — the live describe snapshot,
 *   re-emitting on every settle of the target tree (structural change,
 *   error/complete/teardown transition).
 * - `health: Node<HealthReport>` — `{ok, problems[]}` aggregated from the
 *   live describe; `ok=false` when any node enters `"errored"` status,
 *   with `upstreamCause` walked backward through deps.
 * - `flow: Node<ReadonlyMap<string, FlowEntry>>` — per-path DATA counters
 *   accumulating as `target.observe({reactive: true, tiers: ["data"]})`
 *   delivers changesets. The map is reconciled against `topology` on each
 *   topology change so removed nodes drop their entries.
 *
 * Pre-Tier-5.3 shipped a `LensGraph` class with `stats` / `health` / `flow`
 * (as a `ReactiveMapBundle`) / `why(from, to)` / `flowEntryNode(...)`. The
 * surface collapsed because every concern was already a one-liner over
 * `describe({reactive:true})` + `observe({reactive:true, tiers})` once those
 * landed in Tier 1.5.1 / 1.5.2 — the class added no protocol-level concept,
 * just glue. Callers who need topology stats compose a derived over
 * `topology` directly; callers who need a causal chain call
 * `target.explain(from, to, { reactive: true })`.
 *
 * The transitive topology-subscription helper {@link watchTopologyTree} is
 * re-exported here for downstream factories that need full-tree dynamic
 * coverage without taking a dep on `graph/`.
 *
 * @module
 */
import type { Node } from "../../core/node.js";
import { derived } from "../../core/sugar.js";
import { domainMeta } from "../../extra/meta.js";
import { keepalive } from "../../extra/sources.js";
import {
	type Graph,
	type GraphDescribeOutput,
	type ObserveChangeset,
	type ObserveEvent,
	reachable,
} from "../../graph/index.js";

export { watchTopologyTree } from "../../graph/index.js";

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

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

/** Per-path flow entry stored in the {@link GraphLensView.flow} map. */
export interface FlowEntry {
	path: string;
	/** Cumulative DATA emissions observed since the lens activated. */
	count: number;
	/** Monotonic ns at the most recent DATA emission for this path, or `null` if none yet. */
	lastUpdate_ns: number | null;
}

/** Output of {@link graphLens}. */
export interface GraphLensView {
	/** Live describe snapshot. Re-emits on structural change AND status transitions. */
	topology: Node<GraphDescribeOutput>;
	/** Live `{ok, problems[]}`. Aggregated from `topology`; equality-deduped. */
	health: Node<HealthReport>;
	/** Per-path DATA counter map. Re-emits per outermost batch flush. */
	flow: Node<ReadonlyMap<string, FlowEntry>>;
	/**
	 * Tear down the underlying `describe({reactive:true})` subscription.
	 * The `flow` node activates lazily; subscribing-then-unsubscribing reclaims
	 * its observe stream automatically. Call `dispose()` once when finished.
	 */
	dispose(): void;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing / composition)
// ---------------------------------------------------------------------------

/** Build a `HealthReport` from a fresh `GraphDescribeOutput`. */
export function computeHealthReport(described: GraphDescribeOutput): HealthReport {
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

/** Structural equality for {@link HealthReport} — used as the `health` derived's `equals`. */
export function healthReportEqual(a: HealthReport, b: HealthReport): boolean {
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

// ---------------------------------------------------------------------------
// graphLens preset
// ---------------------------------------------------------------------------

/**
 * Reactive observability preset over a target {@link Graph}.
 *
 * @param target - The graph to observe.
 *
 * @example
 * ```ts
 * const g = new Graph("app");
 * g.add(state(0, { name: "counter" }), { name: "counter" });
 *
 * const lens = graphLens(g);
 * lens.topology.subscribe((msgs) => console.log("topology:", msgs));
 * lens.health.subscribe((msgs) => console.log("health:", msgs));
 * lens.flow.subscribe((msgs) => {
 *   for (const [type, payload] of msgs) {
 *     if (type === DATA) console.log("flow map size:", (payload as ReadonlyMap<string, FlowEntry>).size);
 *   }
 * });
 *
 * // Causal chains: use the underlying primitive directly — `graphLens` no
 * // longer wraps it, since `graph.explain({ reactive: true })` already
 * // provides everything the old `lens.why()` did.
 * const why = g.explain("counter", "consumer", { reactive: true });
 *
 * // Tear down when done.
 * lens.dispose();
 * ```
 *
 * @category observability
 */
export function graphLens(target: Graph): GraphLensView {
	const topologyHandle = target.describe({
		reactive: true,
		detail: "standard",
		reactiveName: "graphLens.topology",
	});
	const topology = topologyHandle.node;

	const health = derived<HealthReport>(
		[topology],
		([described]) => computeHealthReport(described as GraphDescribeOutput),
		{
			name: "graphLens.health",
			describeKind: "derived",
			equals: healthReportEqual,
			meta: domainMeta("lens", "health"),
		},
	);
	// `topology` is already kept alive by `_describeReactive`'s internal
	// keepalive; `health` needs its own so the derived stays warm even if
	// the consumer subscribes lazily.
	const stopHealthKeep = keepalive(health);

	// `flow` accumulates per-path counters across emissions. Closure-mirror
	// (COMPOSITION-GUIDE §28) holds the canonical map; the derived returns a
	// fresh ReadonlyMap projection per emit so consumers never observe an
	// in-place mutation. Topology drives reconciliation: paths that disappear
	// from the describe drop their counter entry.
	//
	// `lastAppliedFlush_ns` guards against double-applying the same changeset
	// when topology re-emits without a new dataFlow event (e.g. a node remove
	// re-fires `topology` while `dataFlow.cache` still holds the previous
	// changeset by reference). Using the monotonic `flushedAt_ns` cursor (qa
	// G2A — EC4 fix) is more robust than ref-comparison: an empty changeset
	// re-emitted with a fresh object identity but the same `flushedAt_ns`
	// won't trigger a stale-events replay, and a genuinely-new changeset
	// always advances the cursor.
	const flowMap = new Map<string, FlowEntry>();
	let lastAppliedFlush_ns = -1;
	const dataFlow = target.observe({ reactive: true, tiers: ["data"] });
	const flow = derived<ReadonlyMap<string, FlowEntry>>(
		[dataFlow, topology],
		([changeset, described]) => {
			const c = changeset as ObserveChangeset | undefined;
			const desc = described as GraphDescribeOutput | undefined;

			// Apply NEW changeset events first so a freshly-emitted node-remove
			// observed below cleanly drops the entry. (If we reconciled first
			// then applied, an event referencing a path the topology had already
			// dropped would re-create the entry only to be wiped on the next
			// topology re-emit — order events-then-topology to avoid that.)
			//
			// Skip when `events.length === 0`: an empty changeset has no work
			// to do. The cursor advances anyway so a future identical-content
			// changeset (different ref, same flushedAt_ns) is also skipped.
			if (c != null && c.flushedAt_ns > lastAppliedFlush_ns) {
				lastAppliedFlush_ns = c.flushedAt_ns;
				for (const event of c.events as readonly ObserveEvent[]) {
					if (event.type !== "data") continue;
					const path = event.path;
					if (path == null || path === "") continue;
					const prior = flowMap.get(path);
					flowMap.set(path, {
						path,
						count: (prior?.count ?? 0) + 1,
						lastUpdate_ns: c.flushedAt_ns,
					});
				}
			}

			// Reconcile against current topology — drop entries whose paths
			// no longer exist in the describe.
			if (desc != null && flowMap.size > 0) {
				const valid = new Set(Object.keys(desc.nodes));
				for (const k of [...flowMap.keys()]) {
					if (!valid.has(k)) flowMap.delete(k);
				}
			}

			// Snapshot — consumers receive a frozen view.
			return new Map(flowMap) as ReadonlyMap<string, FlowEntry>;
		},
		{
			name: "graphLens.flow",
			describeKind: "derived",
			meta: domainMeta("lens", "flow"),
		},
	);
	const stopFlowKeep = keepalive(flow);

	let disposed = false;
	return {
		topology,
		health,
		flow,
		dispose() {
			if (disposed) return;
			disposed = true;
			stopFlowKeep();
			stopHealthKeep();
			topologyHandle.dispose();
		},
	};
}
