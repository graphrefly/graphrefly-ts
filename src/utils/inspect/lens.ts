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
 * `target.describe({ explain: { from, to }, reactive: true })`.
 *
 * The transitive topology-subscription helper {@link watchTopologyTree} is
 * re-exported here for downstream factories that need full-tree dynamic
 * coverage without taking a dep on `graph/`.
 *
 * @module
 */
import { type Node, node, wallClockNs } from "@graphrefly/pure-ts/core";
import {
	keepalive,
	type LensFlowChange,
	type LensFlowChangePayload,
	type ReactiveLogBundle,
	reactiveLog,
} from "@graphrefly/pure-ts/extra";
import {
	type Graph,
	type GraphDescribeOutput,
	type ObserveChangeset,
	type ObserveEvent,
	reachable,
} from "@graphrefly/pure-ts/graph";
import { domainMeta } from "../../base/meta/domain-meta.js";

export { watchTopologyTree } from "@graphrefly/pure-ts/graph";

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

/**
 * Options for {@link graphLens}.
 *
 * Shape mirrors `reactiveMap`/`pubsub`'s `mutationLog` option so the
 * delta-companion ergonomics are uniform across structures.
 */
export interface GraphLensOptions {
	/**
	 * Enable the {@link GraphLensView.flowMutations} delta companion log.
	 * `true` for defaults, or `{ maxSize, name }` to bound / name the
	 * underlying `reactiveLog`. Off by default — zero overhead (no buffer
	 * accumulation, no companion node) when omitted.
	 */
	mutations?: true | { maxSize?: number; name?: string };
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
	 * Delta companion to {@link flow}. Present iff {@link GraphLensOptions.mutations}
	 * was configured. Each per-path `tick` (a DATA emission incremented
	 * the counter) and each `evict` (a path dropped during topology
	 * reconciliation) appends one typed {@link LensFlowChange} record in
	 * the same batch frame as the corresponding `flow` snapshot — an
	 * O(1)-per-event peer of the snapshot, mirroring `reactiveMap`'s
	 * `mutationLog`. Lets consumers tail *what changed* without diffing
	 * successive `flow` map snapshots.
	 */
	flowMutations?: ReactiveLogBundle<LensFlowChange>;
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
 * // longer wraps it, since `graph.describe({ explain: {...}, reactive: true })`
 * // already provides everything the old `lens.why()` did.
 * const why = g.describe({
 *   explain: { from: "counter", to: "consumer" },
 *   reactive: true,
 * });
 *
 * // Tear down when done.
 * lens.dispose();
 * ```
 *
 * @category observability
 */
export function graphLens(target: Graph, opts: GraphLensOptions = {}): GraphLensView {
	const mutLogOpt = opts.mutations;
	const mutationsEnabled = mutLogOpt != null;
	// Closure buffer: the `flow` derived fills this per wave with the
	// tick/evict deltas it just applied; a sibling effect drains it into
	// `flowMutations` in the SAME wave (sanctioned side-effect-in-effect
	// pattern — mirrors the bridge.ts `topic.publish`-from-effect and
	// reactiveMap's pending-changes-flushed-in-the-snapshot-batch shape).
	// Single source of truth for the diff stays the `flow` fn.
	const pendingFlowChanges: LensFlowChangePayload[] = [];
	// Hoisted (QA-P3) so the `flow` fn's buffer push can short-circuit
	// once `dispose()` ran — a still-warm `flow` (external subscriber)
	// must not keep growing `pendingFlowChanges` with no drain alive.
	let disposed = false;

	const topologyHandle = target.describe({
		reactive: true,
		detail: "standard",
		reactiveName: "graphLens.topology",
	});
	const topology = topologyHandle.node;

	const health = node<HealthReport>(
		[topology],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(computeHealthReport(data[0] as GraphDescribeOutput));
		},
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
	const flow = node<ReadonlyMap<string, FlowEntry>>(
		[dataFlow, topology],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const changeset = data[0];
			const described = data[1];
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
					const count = (prior?.count ?? 0) + 1;
					flowMap.set(path, {
						path,
						count,
						lastUpdate_ns: c.flushedAt_ns,
					});
					if (mutationsEnabled && !disposed) {
						pendingFlowChanges.push({ kind: "tick", path, count });
					}
				}
			}

			// Reconcile against current topology — drop entries whose paths
			// no longer exist in the describe.
			if (desc != null && flowMap.size > 0) {
				const valid = new Set(Object.keys(desc.nodes));
				for (const k of [...flowMap.keys()]) {
					if (!valid.has(k)) {
						flowMap.delete(k);
						if (mutationsEnabled && !disposed) {
							pendingFlowChanges.push({ kind: "evict", path: k });
						}
					}
				}
			}

			// Snapshot — consumers receive a frozen view.
			actions.emit(new Map(flowMap) as ReadonlyMap<string, FlowEntry>);
		},
		{
			name: "graphLens.flow",
			describeKind: "derived",
			meta: domainMeta("lens", "flow"),
		},
	);
	// ── flow delta companion (Phase 14 — last DS-14-substrate thread) ────────
	// `flow` is otherwise just a snapshot map; tailing *what changed*
	// previously required diffing successive map snapshots. The companion
	// surfaces each per-path `tick` / `evict` as a typed `LensFlowChange`,
	// O(1) per event, in the same batch frame as the snapshot — mirroring
	// `reactiveMap`/`pubsub` `mutationLog`. Opt-in (zero overhead off).
	//
	// QA-P1: the drain effect is created + kept alive BEFORE
	// `keepalive(flow)` (below) so it is subscribed to `flow` before
	// `flow`'s first activation. Otherwise `keepalive(flow)`'s
	// push-on-subscribe would replay cached changeset(s) into
	// `pendingFlowChanges` before the drain exists, collapsing pre-wiring
	// deltas into the drain's first flush and breaking the "same batch
	// frame as the snapshot" contract (COMPOSITION-GUIDE §2 — wire
	// observers before emitters).
	let flowMutations: ReactiveLogBundle<LensFlowChange> | undefined;
	let stopFlowMutKeep: (() => void) | undefined;
	if (mutLogOpt != null) {
		const log = reactiveLog<LensFlowChange>(undefined, {
			name:
				mutLogOpt === true
					? "graphLens.flowMutations"
					: (mutLogOpt.name ?? "graphLens.flowMutations"),
			maxSize: mutLogOpt === true ? undefined : mutLogOpt.maxSize,
		});
		flowMutations = log;
		let mutVersion = 0;
		// Effect dependent on `flow`: it fires in the SAME wave `flow`
		// emits, so the appended records coalesce into the same outermost
		// batch flush as the snapshot (the `mutationLog` "same batch
		// frame" contract). Side-effecting append from an `effect` node is
		// the sanctioned home (cf. bridge.ts `topic.publish`-from-effect);
		// `flow`'s fn stays the single source of the diff.
		const flowMutationsDrain = node(
			[flow],
			(_batchData, _actions, _ctx) => {
				if (pendingFlowChanges.length === 0) return;
				const drained = pendingFlowChanges.splice(0);
				for (const change of drained) {
					log.append({
						structure: "lensFlow",
						version: ++mutVersion,
						t_ns: wallClockNs(),
						lifecycle: "data",
						change,
					});
				}
			},
			{
				name: "graphLens.flowMutationsDrain",
				describeKind: "effect",
				meta: domainMeta("lens", "flowMutations"),
			},
		);
		stopFlowMutKeep = keepalive(flowMutationsDrain);
	}

	// AFTER the drain is wired (QA-P1) so `flow`'s push-on-subscribe
	// reaches the drain in the same wave.
	const stopFlowKeep = keepalive(flow);

	return {
		topology,
		health,
		flow,
		...(flowMutations ? { flowMutations } : {}),
		dispose() {
			if (disposed) return;
			disposed = true;
			stopFlowMutKeep?.();
			// QA-P2: release the reactiveLog bundle's own internal
			// keepalives (view caches / lastValue / nested mutLog), not
			// just the drain effect's keepalive.
			flowMutations?.dispose();
			// QA-P3: a still-warm `flow` (external subscriber) keeps
			// running its fn post-dispose; the buffer push is gated on
			// `!disposed`, but drop any residue so it can't be replayed.
			pendingFlowChanges.length = 0;
			stopFlowKeep();
			stopHealthKeep();
			topologyHandle.dispose();
		},
	};
}
