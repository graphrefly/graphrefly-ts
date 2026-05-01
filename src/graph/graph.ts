import { type Actor, DEFAULT_ACTOR } from "../core/actor.js";
import { batch, isBatching, registerBatchFlushHook } from "../core/batch.js";
import { monotonicNs, wallClockNs } from "../core/clock.js";
import type { GraphReFlyConfig } from "../core/config.js";
import { GuardDenied } from "../core/guard.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	INVALIDATE,
	type Messages,
	PAUSE,
	RESOLVED,
	RESOLVED_ONLY_BATCH,
	RESUME,
	TEARDOWN,
} from "../core/messages.js";
import {
	type DescribeDetail,
	type DescribeField,
	type DescribeNodeOutput,
	describeNode,
	resolveDescribeFields,
} from "../core/meta.js";
import {
	defaultConfig,
	type FnCtx,
	type Node,
	type NodeFn,
	type NodeFnCleanup,
	NodeImpl,
	type NodeOptions,
	type NodeSink,
	type NodeTransportOptions,
	node,
} from "../core/node.js";
import type { VersioningLevel } from "../core/versioning.js";
import { type DescribeChangeset, topologyDiff } from "../extra/composition/topology-diff.js";
import { keepalive } from "../extra/sources.js";
import type { StorageHandle } from "../extra/storage-core.js";
import type { SnapshotStorageTier } from "../extra/storage-tiers.js";
import { ResettableTimer } from "../extra/timer.js";
import { RingBuffer } from "../extra/utils/ring-buffer.js";
import type {
	GraphChange,
	GraphChangeBatchEnd,
	GraphChangeBatchStart,
	GraphChangeComplete,
	GraphChangeData,
	GraphChangeDirty,
	GraphChangeError,
	GraphChangeMount,
	GraphChangeNodeAdded,
	GraphChangeNodeRemoved,
	GraphChangeResolved,
	GraphChangeTeardown,
	GraphChangeUnmount,
} from "./changeset.js";
import { decodeEnvelope, encodeEnvelope, type GraphCodec } from "./codec.js";
import { type CausalChain, type CausalStep, explainPath } from "./explain.js";
import { type GraphProfileOptions, type GraphProfileResult, graphProfile } from "./profile.js";
import { watchTopologyTree } from "./topology-tree.js";

/** The separator used for qualified paths in {@link Graph.resolve} et al. */
const PATH_SEP = "::";

/**
 * Reserved segment for meta companion paths: `nodeName::__meta__::metaKey` (GRAPHREFLY-SPEC §3.6).
 * Forbidden as a local node or mount name.
 */
export const GRAPH_META_SEGMENT = "__meta__";

/**
 * Options for {@link Graph}. Named fields documented below; the open index
 * signature is preserved so callers can stash extension data on the graph
 * without losing type discipline on the reserved names.
 *
 * - `config` — bind this graph to a specific {@link GraphReFlyConfig} for
 *   tier/metaPassthrough/inspector lookups. Defaults to the singleton
 *   `defaultConfig` exported from `core/node.ts`.
 * - `versioning` — convenience for `graph.setVersioning(level)` at
 *   construction time. Monotonic bulk-apply; see {@link Graph.setVersioning}.
 * - `factories` — reserved for future per-graph factory registration;
 *   currently factories flow through `Graph.fromSnapshot(data, {factories})`.
 */
export interface GraphOptions {
	config?: GraphReFlyConfig;
	versioning?: VersioningLevel;
	factories?: Record<string, GraphNodeFactory>;
	/**
	 * Capacity of the reasoning-trace ring buffer. Default: `1000`. Set lower
	 * to reduce memory; higher for audit-heavy workloads. Set at construction
	 * time — not mutable afterward (ring buffers can't resize cleanly).
	 */
	traceCapacity?: number;
	/**
	 * Tier 1.5.3 Phase 2.5 (Session A.1 lock + Phase 2.5 design DG1=B, 2026-04-27).
	 * Top-level factory identifier for Graph-returning factories (`agentMemory`,
	 * `harnessLoop`, `pipelineGraph`, etc.). When set, `describe()` surfaces
	 * `factory` + `factoryArgs` at the top of `GraphDescribeOutput` so consumers
	 * can identify provenance, and `compileSpec` can delegate reconstruction to
	 * `catalog.graphFactories[factory]` with `factoryArgs`. Prefer the
	 * post-construction `Graph.prototype.tagFactory(name, args?)` mutator inside
	 * the factory body over passing here directly.
	 */
	factory?: string;
	/**
	 * JSON-serializable subset of the construction args. For non-JSON fields
	 * (LLMAdapter, callbacks, embedders), prefer the {@link placeholderArgs}
	 * helper which substitutes descriptive `"<Node>"` / `"<function>"` strings
	 * (DG2 = ii). Catalog `graphFactories` recipients receive this back during
	 * `compileSpec` to recreate the graph with the user-supplied runtime ctx.
	 */
	factoryArgs?: unknown;
	[key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Graph-level restricted fn types (narrow waist — SESSION-graph-narrow-waist.md)
// ---------------------------------------------------------------------------

/**
 * Context for {@link Graph.derived} fns. Matches raw {@link FnCtx} shape
 * (prevData / terminalDeps / store) plus the node's own previous emit.
 *
 * - `prevData[i]` — last DATA from dep `i` (end of prior wave).
 *   `undefined` means dep `i` has never produced DATA (sentinel).
 * - `terminalDeps[i]` — `undefined` (live), `true` (COMPLETE), or the
 *   ERROR payload. See {@link FnCtx}.
 * - `store` — mutable bag persisting across fn runs within one
 *   activation cycle.
 * - `cache` — the node's own previous emit. `undefined` when no
 *   prior emit (sentinel or first run), `null` when the prior emit
 *   was `null`, otherwise `T`.
 */
export interface FnCtxDerived<T = unknown> extends FnCtx {
	readonly cache: T | null | undefined;
}

/**
 * Restricted fn for {@link Graph.derived}. Receives the raw per-dep
 * batch shape (matching {@link NodeFn}) and returns an array of values
 * to emit this wave:
 * - `[v]` — single emit (common case).
 * - `[]` — no emit (settled unchanged → RESOLVED).
 * - `[v1, v2, ...]` — multi-emit in one wave.
 *
 * `data[i]` shape:
 * - `undefined` — dep `i` was not involved this wave (no DIRTY).
 * - `[]` — dep `i` was involved but settled as RESOLVED. Read
 *   `ctx.prevData[i]` for its last known value.
 * - `[v1, v2, ...]` — dep `i` sent one or more DATA values.
 *
 * Common scalar read (collapse multi-emit to "latest of dep i"):
 *   `data[i] != null && data[i].length > 0 ? data[i].at(-1) : ctx.prevData[i]`
 * Do NOT use `data[i]?.at(-1) ?? ctx.prevData[i]` — `null` is a valid DATA
 * payload and `??` would incorrectly fall through to `prevData` on it.
 *
 * `undefined` is excluded from the return type — SENTINEL stays
 * protocol-only.
 */
export type GraphDerivedFn<T> = (
	data: readonly (readonly unknown[] | undefined)[],
	ctx: FnCtxDerived<T>,
) => readonly (T | null)[];

/**
 * Upstream-only actions for {@link Graph.effect} fns. No `emit` /
 * `down` — effects that need downstream emission use
 * {@link Graph.producer} or drop to raw `node() + graph.add()`.
 */
export interface NodeUpActions {
	/** Pause upstream deps. `lockId` is required per spec §2.6. */
	pause(lockId: unknown): void;
	/** Resume upstream deps. Must match a prior `pause` lockId. */
	resume(lockId: unknown): void;
}

/**
 * Context for {@link Graph.effect} fns. Matches raw {@link FnCtx} shape:
 *
 * - `prevData[i]` — last DATA from dep `i` (end of prior wave).
 * - `terminalDeps[i]` — `undefined` (live), `true` (COMPLETE), or the
 *   ERROR payload. Effects can branch on dep terminals (e.g. log on
 *   COMPLETE, escalate on ERROR) without needing access to `actions`.
 * - `store` — mutable bag persisting across fn runs within one
 *   activation cycle. Use for cross-run accumulators (counters, last-
 *   seen timestamps) without closure `let` vars.
 */
export type FnCtxEffect = FnCtx;

/**
 * Restricted fn for {@link Graph.effect}. Pure sink — no downstream
 * dispatch possible. Receives raw per-dep batch shape (matching
 * {@link NodeFn}) so authors can observe multi-emit waves, RESOLVED
 * (involved but no new DATA), and not-involved deps.
 *
 * `data[i]` shape: see {@link GraphDerivedFn}.
 *
 * Return a cleanup function or granular hooks.
 */
export type GraphEffectFn = (
	data: readonly (readonly unknown[] | undefined)[],
	up: NodeUpActions,
	ctx: FnCtxEffect,
	// biome-ignore lint/suspicious/noConfusingVoidType: cleanup return.
) => NodeFnCleanup | void;

/**
 * Restricted context for {@link Graph.producer} setup fns.
 *
 * - `store` — mutable bag persisting across activation cycles.
 */
export interface FnCtxProducer {
	readonly store: Record<string, unknown>;
}

/**
 * Setup fn for {@link Graph.producer}. Receives a `push` channel
 * with the same array-emission shape as {@link GraphDerivedFn}:
 * - `push([v])` — single DATA.
 * - `push([v1, v2])` — multi-DATA in one wave.
 *
 * Return a cleanup function or granular hooks for teardown.
 */
export type GraphProducerSetupFn<T> = (
	push: (values: readonly (T | null)[]) => void,
	ctx: FnCtxProducer,
	// biome-ignore lint/suspicious/noConfusingVoidType: cleanup return.
) => NodeFnCleanup | void;

/**
 * Input-side {@link NodeOptions} fields exposed by Graph methods. Excludes
 * `name` (handled via the explicit `name` arg) and `describeKind` (set
 * internally per Graph method to `"state"` / `"derived"` / `"effect"` /
 * `"producer"`). All other fields — `equals`, `initial`, `meta`, `guard`,
 * `partial`, `pausable`, `versioning*`, `completeWhenDepsComplete`,
 * `errorWhenDepsError`, `resubscribable`, `resetOnTeardown`, `config` — flow
 * through the underlying `node()` call unchanged.
 *
 * The narrow-waist promise (Phase 11) is symmetry on the input side: any
 * option valid on raw `node()` is valid on `graph.derived/effect/state/producer`,
 * so guarded compute / authz / lifecycle options never force authors to drop
 * back to raw `node() + graph.add()`. Restriction is purely on the OUTPUT
 * side (return shape, ctx) — see {@link GraphDerivedFn} / {@link GraphEffectFn}.
 */
type SharedNodeOpts<T> = Omit<NodeOptions<T>, "name" | "describeKind">;

/**
 * Options for {@link Graph.state}.
 *
 * Inherits all input-side {@link NodeOptions} (see {@link SharedNodeOpts})
 * except `initial` (which is the explicit second positional arg of
 * {@link Graph.state}) plus graph-specific extras (`signal`, `annotation`).
 */
export interface GraphStateOptions<T> extends Omit<SharedNodeOpts<T>, "initial"> {
	signal?: AbortSignal;
	annotation?: string;
}

/**
 * Options for {@link Graph.derived}.
 *
 * Inherits all input-side {@link NodeOptions} (`equals`, `initial`, `meta`,
 * `guard`, `partial`, `pausable`, `versioning*`, …) plus graph-specific
 * extras:
 *
 * - `keepAlive: true` — installs an internal subscription so the node
 *   stays activated and `.cache` stays current for **external consumers**
 *   (UI render, debug snapshot, audit log). The subscription self-prunes
 *   on the node's terminal and is drained by {@link Graph.destroy}.
 *
 *   **Do not read `node.cache` from inside another reactive fn** (spec
 *   §5.12) — declare the node as a real dep instead.
 * - `signal` — when aborted, removes this node from the graph.
 * - `annotation` — forwarded to {@link Graph.add}.
 *
 * **F-15 (2026-04-30):** `equals: undefined` is filtered at the spread (the
 * impl uses `equals != null` to gate the node-options pass-through), so
 * passing `undefined` is functionally identical to omitting the field — the
 * underlying `node()` falls back to its default `Object.is` dedup.
 */
export interface GraphDerivedOptions<T> extends SharedNodeOpts<T> {
	keepAlive?: boolean;
	signal?: AbortSignal;
	annotation?: string;
}

/**
 * Options for {@link Graph.effect}.
 *
 * Inherits all input-side {@link NodeOptions} (`meta`, `guard`, `partial`,
 * `pausable`, `versioning*`, …) plus graph-specific extras (`signal`,
 * `annotation`). Output side stays restricted via {@link GraphEffectFn} —
 * `up.pause` / `up.resume` only, no `emit` / `down`.
 */
export interface GraphEffectOptions extends SharedNodeOpts<unknown> {
	signal?: AbortSignal;
	annotation?: string;
}

/**
 * Options for {@link Graph.producer}.
 *
 * Inherits all input-side {@link NodeOptions} (no deps, so dep-gating
 * fields like `partial` / `completeWhenDepsComplete` / `errorWhenDepsError`
 * are inert but type-valid) plus graph-specific extras (`signal`,
 * `annotation`).
 */
export interface GraphProducerOptions<T> extends SharedNodeOpts<T> {
	signal?: AbortSignal;
	annotation?: string;
}

/** Filter for {@link Graph.describe} — object-style partial match or predicate. */
export type DescribeFilter =
	| Partial<Pick<DescribeNodeOutput, "type" | "status">>
	| {
			type?: DescribeNodeOutput["type"];
			status?: DescribeNodeOutput["status"];
			/** Keep nodes whose `deps` includes this qualified path. */
			depsIncludes?: string;
			/** Snake-case alias for `depsIncludes` (Python parity). */
			deps_includes?: string;
			/** Keep nodes whose `meta` contains this key. */
			metaHas?: string;
			/** Snake-case alias for `metaHas` (Python parity). */
			meta_has?: string;
	  }
	| ((node: DescribeNodeOutput) => boolean)
	| ((nodePath: string, node: DescribeNodeOutput) => boolean);

/** Options for {@link Graph.signal} and {@link Graph.set} (actor context, internal lifecycle). */
export type GraphActorOptions = {
	actor?: Actor;
	/**
	 * When `true`, skips node guards (graph lifecycle TEARDOWN, unmount teardown, etc.).
	 */
	internal?: boolean;
};

/** Options for {@link Graph.describe} (Phase 3.3b progressive disclosure). */
export type GraphDescribeOptions = {
	/**
	 * Scope `describe()` to what `actor` is allowed to observe. Accepts a
	 * static {@link Actor} (resolved at call time) or a `Node<Actor>` — when a
	 * Node is passed and `reactive: true` is set, the reactive describe handle
	 * subscribes to the actor node and re-derives whenever the actor changes,
	 * so harnesses that bind a reactive actor (e.g. per-turn `currentActor`
	 * state) get a single live describe Node instead of re-calling
	 * `describe({ actor })` per turn.
	 *
	 * **Cache-undefined semantics:** when a `Node<Actor>` is supplied whose
	 * `cache` is `undefined` (e.g. a `producer` that has not yet emitted),
	 * describe is treated identically to `actor: undefined` — i.e. **no
	 * scoping** (full visibility). This matches every other Node-cache read in
	 * the codebase, but means a not-yet-active actor node degrades to "describe
	 * everything." Activate the actor node (subscribe + emit, or seed via
	 * `state(initial)`) before calling `describe` if you rely on guard
	 * scoping. In `reactive: true` mode the describe re-derives once the
	 * actor node populates.
	 *
	 * **Terminal-type handling:** if the supplied `Node<Actor>` emits
	 * `COMPLETE`, `ERROR`, or `TEARDOWN`, the reactive describe releases the
	 * actor subscription and re-derives one last time against the final
	 * `actor.cache` value. Subsequent describe outputs reflect that frozen
	 * cache until `handle.dispose()` runs.
	 */
	actor?: Actor | Node<Actor>;
	/**
	 * Node filter. Filters operate on whatever fields the chosen `detail` level
	 * provides. For `metaHas` and `status` filters, use `detail: "standard"` or
	 * higher — at `"minimal"` those fields are absent and the filter silently
	 * excludes all nodes.
	 */
	filter?: DescribeFilter;
	/**
	 * Detail level (Phase 3.3b). Default: `"minimal"`.
	 * - `"minimal"` — type + deps only
	 * - `"standard"` — type, status, value, deps, meta, versioning (`v`)
	 * - `"full"` — standard + guard, lastMutation
	 */
	detail?: DescribeDetail;
	/**
	 * Explicit field selection (GraphQL-style). Overrides `detail` when provided.
	 * Dotted paths like `"meta.label"` select specific meta keys.
	 */
	fields?: DescribeField[];
	/**
	 * Reactive describe (D2):
	 * - `true` — return `{ node, dispose }` where `node` emits a fresh
	 *   `GraphDescribeOutput` every time the graph state settles. Same
	 *   coalescing as {@link Graph.explain} with `{ reactive: true }`.
	 * - `"diff"` — return `{ node, dispose }` where `node` emits a
	 *   {@link DescribeChangeset} per topology change. Empty changesets are
	 *   suppressed; the initial cache is a synthetic full-add diff so a fresh
	 *   subscriber sees the current topology as adds via push-on-subscribe.
	 *   (Tier 1.5.1 — Session A.1 lock).
	 */
	reactive?: boolean | "diff";
	/**
	 * Reactive-only: name for the backing derived node (default `"describe"`).
	 *
	 * In `{ explain: {...}, reactive: true }` mode the equivalent slot is
	 * `name` (default `"explain"`); `reactiveName` is honored as a fallback
	 * for callers migrating from `describe({reactive})` muscle memory. If
	 * both `name` and `reactiveName` are set in explain-mode, `name` wins.
	 */
	reactiveName?: string;
};

/** Handle returned by {@link Graph.describe} with `{ reactive: true }`. */
export interface ReactiveDescribeHandle<T> {
	readonly node: Node<T>;
	dispose(): void;
}

/**
 * Explain-mode argument for {@link Graph.describe}. Passing
 * `{ explain: {...} }` reshapes the call into a causal-chain query (returns
 * {@link CausalChain} or `{ node: Node<CausalChain>; dispose }` when paired
 * with `reactive: true`).
 *
 * Tier 3.5 reactive-arg carve-out (F.9): `from`, `to`, `maxDepth`, and
 * `findCycle` accept `Node<...>` in addition to their plain types. When mixed,
 * static args pass through unchanged; reactive args drive recompute via the
 * same coalescer as the rest of `describe({ reactive: true })`.
 */
export interface GraphDescribeExplainInput {
	/** Upstream node path (the cause). `string | Node<string>`. */
	from: string | Node<string>;
	/** Downstream node path (the effect). `string | Node<string>`. */
	to: string | Node<string>;
	/** Maximum hop depth for the dep-walk (`number | Node<number>`). */
	maxDepth?: number | Node<number>;
	/**
	 * When `true` and `from === to`, returns the shortest cycle through other
	 * nodes (useful for diagnosing feedback loops, COMPOSITION-GUIDE §7).
	 */
	findCycle?: boolean | Node<boolean>;
}

/**
 * Reachable-mode argument for {@link Graph.describe}. Passing
 * `{ reachable: {...} }` reshapes the call into a reachability query — returns
 * `string[]` (paths sorted lexicographically) or {@link ReachableResult} when
 * `withDetail: true`.
 */
export interface GraphDescribeReachableInput {
	/** Start path (qualified node path). */
	from: string;
	/** Traversal direction. Ignored when `both: true`. */
	direction: ReachableDirection;
	/** Maximum hop depth from `from` (0 returns `[]`). */
	maxDepth?: number;
	/** Traverse both directions in one pass (union of upstream + downstream). */
	both?: boolean;
	/** Return the {@link ReachableResult} shape (paths + depths + truncation). */
	withDetail?: boolean;
}

/** JSON snapshot from {@link Graph.describe} (GRAPHREFLY-SPEC §3.6, Appendix B). */
export type GraphDescribeOutput = {
	name: string;
	nodes: Record<string, DescribeNodeOutput>;
	edges: ReadonlyArray<{ from: string; to: string }>;
	subgraphs: string[];
	/**
	 * Top-level factory identifier (Tier 1.5.3 Phase 2.5 — DG1=B). Present when
	 * the graph was constructed by a Graph-returning factory that called
	 * `Graph.prototype.tagFactory(name, args?)` (or set `GraphOptions.factory`).
	 * Used by `compileSpec` for catalog-based reconstruction via
	 * `catalog.graphFactories[factory]`.
	 */
	factory?: string;
	/** JSON-serializable construction args paired with `factory`. */
	factoryArgs?: unknown;
	/**
	 * Re-read the live graph with higher detail (Phase 3.3b).
	 * Returns a new `GraphDescribeOutput`; the original remains a snapshot.
	 * Present on live describe results; absent on deserialized snapshots.
	 */
	expand?: (detailOrFields: DescribeDetail | DescribeField[]) => GraphDescribeOutput;
};

/**
 * Persisted graph snapshot: {@link GraphDescribeOutput} plus optional format version
 * ({@link Graph.snapshot}, {@link Graph.restore}, {@link Graph.fromSnapshot}, {@link Graph.toObject},
 * {@link Graph.toJSONString} — §3.8).
 */
export type GraphPersistSnapshot = GraphDescribeOutput & {
	version?: number;
};

export type GraphFactoryContext = {
	path: string;
	type: DescribeNodeOutput["type"];
	value: unknown;
	meta: Record<string, unknown>;
	deps: readonly string[];
	resolvedDeps: readonly Node[];
};

export type GraphNodeFactory = (name: string, context: GraphFactoryContext) => Node;

/**
 * Checkpoint record shape passed to `SnapshotStorageTier.save`. Written by
 * {@link Graph.attachSnapshotStorage} per-tier according to each tier's
 * `compactEvery` cadence.
 *
 * `mode: "full"` → full snapshot. Baseline anchor emitted on the first save
 *   and every `compactEvery`-th save thereafter. Sufficient to recover state
 *   on its own without WAL replay.
 * `mode: "diff"` → delta payload only, relative to this tier's most recent
 *   `"full"` baseline. Between compacts. Wire-efficient; requires WAL replay
 *   over the preceding `"full"` record to reconstruct state.
 *
 * Every record includes `seq` (per-tier monotonic counter), `timestamp_ns`
 * (wall-clock at flush time), and `format_version` (envelope version for
 * cross-version WAL replay).
 */
export type GraphCheckpointRecord = {
	name: string;
	seq: number;
	timestamp_ns: number;
	format_version: number;
} & ({ mode: "full"; snapshot: GraphPersistSnapshot } | { mode: "diff"; diff: GraphWALDiff });

/** Options for {@link Graph.attachSnapshotStorage}. */
export type GraphAttachStorageOptions = {
	/**
	 * Before the first save, attempt to restore from the first tier whose
	 * `load(graph.name)` hits. Runs asynchronously in the background for
	 * async tiers; errors surface via `onError`. Default `false`.
	 */
	autoRestore?: boolean;
	/**
	 * Limit the subscription surface (scoped observe). By default
	 * `attachSnapshotStorage` observes every node in the graph tree; on large graphs
	 * that's thousands of subscriptions just for tier-gating. Pass a path
	 * list (or a single glob) to observe only those nodes.
	 */
	paths?: readonly string[] | string;
	/** Pre-save path-level filter — skip records triggered by paths that fail this predicate. */
	filter?: (name: string, described: DescribeNodeOutput) => boolean;
	/** Surfaced on tier save errors and autoRestore failures. */
	onError?: (error: unknown, tier: SnapshotStorageTier<GraphCheckpointRecord>) => void;
};

/**
 * Event emitted by {@link Graph.topology} on every structural change to the
 * graph's own registry. Does NOT include value mutations (use `observe()` for
 * those) or transitively nested subgraph events (subscribe to each mounted
 * child's `topology` for that).
 *
 * - `"added"` — `name` is the local key registered via {@link Graph.add}
 *   (`nodeKind: "node"`) or {@link Graph.mount} (`nodeKind: "mount"`).
 * - `"removed"` — emitted AFTER {@link Graph.remove} completes teardown.
 *   `audit` is the full {@link GraphRemoveAudit} returned to the caller.
 */
export type TopologyEvent =
	| { kind: "added"; name: string; nodeKind: "node" | "mount" }
	| {
			kind: "removed";
			name: string;
			nodeKind: "node" | "mount";
			audit: GraphRemoveAudit;
	  };

/**
 * Direction options for diagram exports. Mirrors `DiagramDirection` from
 * `@graphrefly/graphrefly/extra/render` (the renderers consume their own
 * structurally-identical type) — re-exported here so callers building
 * options for `Graph` ergonomics don't need a separate import.
 */
export type GraphDiagramDirection = "TD" | "LR" | "BT" | "RL";

/**
 * Snapshot format version (§3.8). Exported so the surface layer's
 * `saveSnapshot` writes the same `format_version` as
 * `Graph.attachSnapshotStorage` — one source of truth prevents silent wire
 * drift between auto-checkpoint and one-shot persistence paths.
 */
export const SNAPSHOT_VERSION = 1;

/**
 * Drain a disposer set iteratively — pop, remove, run. Disposers registered
 * mid-drain are picked up by the next iteration. Capped to guard against a
 * disposer that re-registers itself in an infinite loop. Exceptions are
 * surfaced via `console.error` rather than silently swallowed so leaks in
 * cleanup code remain visible.
 */
function drainDisposers(set: Set<() => void>, graphName: string): void {
	const cap = Math.max(16, set.size * 4);
	let iterations = 0;
	while (set.size > 0) {
		if (iterations++ >= cap) {
			console.error(
				`[Graph "${graphName}".destroy] disposer drain exceeded cap (${cap}); ${set.size} disposer(s) discarded`,
			);
			set.clear();
			return;
		}
		const it = set.values().next();
		if (it.done) return;
		const dispose = it.value;
		set.delete(dispose);
		try {
			dispose();
		} catch (err) {
			console.error(`[Graph "${graphName}".destroy] disposer threw:`, err);
		}
	}
}

/**
 * Duck-type a `Node<unknown>` from the `Actor | Node<Actor>` union so
 * {@link Graph.describe} can accept either form. Mirrors the local helpers in
 * `src/extra/resilience.ts:886` and `src/extra/sources.ts:509`, but also tests
 * for `down` so a user-defined `Actor` that happens to carry `cache` and a
 * function called `subscribe` cannot pass the test ({@link Actor} is
 * `{ type, id } & Record<string, unknown>` — open shape, so `subscribe` and
 * `cache` alone are not load-bearing).
 */
function isActorNode(x: Actor | Node<Actor> | undefined): x is Node<Actor> {
	return (
		x != null &&
		typeof x === "object" &&
		"cache" in x &&
		typeof (x as Node<Actor>).subscribe === "function" &&
		typeof (x as Node<Actor>).down === "function"
	);
}

/**
 * Resolve an `actor?: Actor | Node<Actor>` describe option to a plain
 * `Actor | undefined`. When a Node is supplied its current `cache` is read;
 * static actors pass through. The `_describeReactive` path subscribes to the
 * node separately so describe re-derives on actor change.
 */
function resolveActorOption(actor: Actor | Node<Actor> | undefined): Actor | undefined {
	if (actor == null) return undefined;
	if (isActorNode(actor)) return actor.cache as Actor | undefined;
	return actor;
}

/**
 * Tier 3.5 (F.9 reactive primitive carve-out): generic Node-shape duck check
 * for `Graph.explain` reactive args (`from`/`to: string | Node<string>`,
 * `maxDepth: number | Node<number>`, `findCycle: boolean | Node<boolean>`).
 * Mirrors `isActorNode` — tests for `subscribe` AND `cache` AND `down` so a
 * primitive value cannot accidentally pass as a Node.
 */
function isExplainArgNode<T>(x: T | Node<T> | undefined): x is Node<T> {
	return (
		x != null &&
		typeof x === "object" &&
		"cache" in x &&
		typeof (x as Node<T>).subscribe === "function" &&
		typeof (x as Node<T>).down === "function"
	);
}

function resolveExplainPath(p: string | Node<string>): string {
	if (isExplainArgNode<string>(p)) return (p.cache as string | undefined) ?? "";
	return p;
}

function resolveExplainNumber(n: number | Node<number>): number {
	if (isExplainArgNode<number>(n)) return (n.cache as number | undefined) ?? 0;
	return n;
}

function resolveExplainBoolean(b: boolean | Node<boolean>): boolean {
	if (isExplainArgNode<boolean>(b)) return (b.cache as boolean | undefined) ?? false;
	return b;
}

/**
 * Cheap graph-level V0 version fingerprint: concatenate `v.id@v.version` for
 * every node that carries V0 info. Used by {@link Graph.attachSnapshotStorage} to
 * short-circuit per-tier flushes when nothing versioned has changed since
 * the tier's last save. Non-versioned graphs produce an empty string so the
 * shortcut is a no-op for them (every scheduled flush writes).
 */
function computeVersionFingerprint(nodes: Record<string, DescribeNodeOutput>): string {
	const parts: string[] = [];
	for (const path of Object.keys(nodes).sort()) {
		const v = nodes[path]!.v;
		if (v != null) parts.push(`${path}\t${v.id}\t${v.version}`);
	}
	return parts.join("\n");
}

/**
 * Validate the snapshot envelope: version, required keys, types. Aligned with
 * Python `_parse_snapshot_envelope`. Throws on invalid data.
 */
function parseSnapshotEnvelope(data: GraphPersistSnapshot): void {
	if (data.version !== SNAPSHOT_VERSION) {
		throw new Error(
			`unsupported snapshot version ${String(data.version)} (expected ${SNAPSHOT_VERSION})`,
		);
	}
	for (const key of ["name", "nodes", "edges", "subgraphs"] as const) {
		if (!(key in data)) {
			throw new Error(`snapshot missing required key "${key}"`);
		}
	}
	if (typeof data.name !== "string") {
		throw new TypeError(`snapshot 'name' must be a string`);
	}
	if (typeof data.nodes !== "object" || data.nodes === null || Array.isArray(data.nodes)) {
		throw new TypeError(`snapshot 'nodes' must be an object`);
	}
	if (!Array.isArray(data.edges)) {
		throw new TypeError(`snapshot 'edges' must be an array`);
	}
	if (!Array.isArray(data.subgraphs)) {
		throw new TypeError(`snapshot 'subgraphs' must be an array`);
	}
}

/**
 * Structural deep equality — handles cycles, BigInt, Map, Set, Date, RegExp,
 * TypedArray, and nested objects/arrays. Used by `Graph.diff` to compare
 * node values without the cycle/BigInt/Map/Set footguns of `JSON.stringify`.
 *
 * Semantics: `Object.is` on primitives (so `NaN === NaN`, `-0 !== 0`), same
 * constructor required for object types, key-order-insensitive for plain
 * objects, order-sensitive for arrays + TypedArrays, unordered for Set,
 * key-equality for Map.
 */
function deepEqual(a: unknown, b: unknown): boolean {
	const seen = new WeakMap<object, WeakSet<object>>();
	const walk = (x: unknown, y: unknown): boolean => {
		if (Object.is(x, y)) return true;
		if (x == null || y == null || typeof x !== "object" || typeof y !== "object") return false;
		// Cycle handling: assume equal on re-encounter (cycles match iff they
		// correspond structurally — standard "optimistic" deep-equal rule).
		let seenRhs = seen.get(x as object);
		if (seenRhs == null) {
			seenRhs = new WeakSet();
			seen.set(x as object, seenRhs);
		}
		if (seenRhs.has(y as object)) return true;
		seenRhs.add(y as object);

		const ctorA = (x as object).constructor;
		const ctorB = (y as object).constructor;
		if (ctorA !== ctorB) return false;

		if (x instanceof Date) return (x as Date).getTime() === (y as Date).getTime();
		if (x instanceof RegExp)
			return (
				(x as RegExp).source === (y as RegExp).source && (x as RegExp).flags === (y as RegExp).flags
			);
		if (Array.isArray(x)) {
			const arrB = y as unknown[];
			if ((x as unknown[]).length !== arrB.length) return false;
			for (let i = 0; i < (x as unknown[]).length; i++) {
				if (!walk((x as unknown[])[i], arrB[i])) return false;
			}
			return true;
		}
		if (x instanceof Map) {
			const mB = y as Map<unknown, unknown>;
			if ((x as Map<unknown, unknown>).size !== mB.size) return false;
			for (const [k, v] of x as Map<unknown, unknown>) {
				if (!mB.has(k) || !walk(v, mB.get(k))) return false;
			}
			return true;
		}
		if (x instanceof Set) {
			const sB = y as Set<unknown>;
			if ((x as Set<unknown>).size !== sB.size) return false;
			// O(n²) fallback — Sets have no ordering, and walking each pair
			// is the only way to support structural equality on non-primitive
			// members. Acceptable: diff scale is describe-output-sized.
			for (const v of x as Set<unknown>) {
				let found = false;
				for (const w of sB) {
					if (walk(v, w)) {
						found = true;
						break;
					}
				}
				if (!found) return false;
			}
			return true;
		}
		if (ArrayBuffer.isView(x)) {
			const taA = x as unknown as { length: number; [i: number]: number };
			const taB = y as unknown as { length: number; [i: number]: number };
			if (taA.length !== taB.length) return false;
			for (let i = 0; i < taA.length; i++) if (taA[i] !== taB[i]) return false;
			return true;
		}
		// Plain object: same key-set, same values (key order irrelevant).
		const keysA = Object.keys(x as Record<string, unknown>);
		const keysB = Object.keys(y as Record<string, unknown>);
		if (keysA.length !== keysB.length) return false;
		const setB = new Set(keysB);
		for (const k of keysA) {
			if (!setB.has(k)) return false;
			if (!walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k])) return false;
		}
		return true;
	};
	return walk(a, b);
}

// ---------------------------------------------------------------------------
//  describe()-format renderers — moved to `src/extra/render/` per Tier 2.1 A2.
//
//  The ex-`describe({ format: ... })` dispatch is gone. Use the pure
//  renderers (`graphSpecToMermaid`, `graphSpecToD2`, `graphSpecToAscii`,
//  `graphSpecToPretty`, `graphSpecToJson`, `graphSpecToMermaidUrl`) from
//  `@graphrefly/graphrefly/extra/render` directly on a describe snapshot,
//  or wrap with `derived` for live formatted output.
// ---------------------------------------------------------------------------

function escapeRegexLiteral(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(pattern: string): RegExp {
	let re = "^";
	for (let i = 0; i < pattern.length; i += 1) {
		const ch = pattern[i]!;
		if (ch === "*") {
			re += ".*";
			continue;
		}
		if (ch === "?") {
			re += ".";
			continue;
		}
		if (ch === "[") {
			const end = pattern.indexOf("]", i + 1);
			if (end <= i + 1) {
				re += "\\[";
				continue;
			}
			let cls = pattern.slice(i + 1, end);
			if (cls.startsWith("!")) cls = `^${cls.slice(1)}`;
			cls = cls.replace(/\\/g, "\\\\");
			re += `[${cls}]`;
			i = end;
			continue;
		}
		re += escapeRegexLiteral(ch);
	}
	re += "$";
	return new RegExp(re);
}

const OBSERVE_ANSI_THEME: Required<ObserveTheme> = {
	data: "\u001b[32m",
	dirty: "\u001b[33m",
	resolved: "\u001b[36m",
	invalidate: "\u001b[93m",
	pause: "\u001b[90m",
	resume: "\u001b[96m",
	complete: "\u001b[34m",
	error: "\u001b[31m",
	teardown: "\u001b[91m",
	derived: "\u001b[35m",
	path: "\u001b[90m",
	reset: "\u001b[0m",
};

const OBSERVE_NO_COLOR_THEME: Required<ObserveTheme> = {
	data: "",
	dirty: "",
	resolved: "",
	invalidate: "",
	pause: "",
	resume: "",
	complete: "",
	error: "",
	teardown: "",
	derived: "",
	path: "",
	reset: "",
};

function describeData(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" || typeof value === "boolean" || value == null)
		return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return "[unserializable]";
	}
}

function resolveObserveTheme(theme: ObserveOptions["theme"]): Required<ObserveTheme> {
	if (theme === "none") return OBSERVE_NO_COLOR_THEME;
	if (theme === "ansi" || theme == null) return OBSERVE_ANSI_THEME;
	return {
		data: theme.data ?? "",
		dirty: theme.dirty ?? "",
		resolved: theme.resolved ?? "",
		invalidate: theme.invalidate ?? "",
		pause: theme.pause ?? "",
		resume: theme.resume ?? "",
		complete: theme.complete ?? "",
		error: theme.error ?? "",
		teardown: theme.teardown ?? "",
		derived: theme.derived ?? "",
		path: theme.path ?? "",
		reset: theme.reset ?? "",
	};
}

/** Resolve observe `detail` level into effective boolean flags. */
function resolveObserveDetail(opts?: ObserveOptions): ObserveOptions {
	if (opts == null) return {};
	const detail = opts.detail;
	if (detail === "full") {
		return {
			...opts,
			structured: opts.structured ?? true,
			timeline: opts.timeline ?? true,
			causal: opts.causal ?? true,
			derived: opts.derived ?? true,
		};
	}
	if (detail === "minimal") {
		return { ...opts, structured: opts.structured ?? true };
	}
	// `stage-log` format is pipeline-oriented — needs elapsed-time stamps on
	// every event, so auto-enable `timeline` unless the caller opts out.
	if (opts.format === "stage-log") {
		return { ...opts, structured: opts.structured ?? true, timeline: opts.timeline ?? true };
	}
	return opts;
}

/**
 * Option shapes that trigger structured-mode dispatch in {@link Graph.observe}.
 * Presence of any of these fields (truthy) → returns {@link ObserveResult};
 * otherwise `observe()` returns the raw-stream variants.
 */
export type StructuredTriggers = {
	structured?: true;
	timeline?: true;
	causal?: true;
	derived?: true;
	format?: "pretty" | "json" | "stage-log";
	detail?: "minimal" | "full";
};

/** {@link Graph.observe} on a single node or meta path — sink receives plain message batches. */
export type GraphObserveOne = {
	subscribe(sink: NodeSink): () => void;
	/** Send messages upstream toward the observed node's sources (e.g. PAUSE/RESUME). */
	up(messages: Messages): void;
};

/**
 * {@link Graph.observe} on the whole graph — sink receives each batch with the qualified source path.
 * Subscription order follows code-point sort on paths (mounts-first walk, then sorted locals/meta).
 */
export type GraphObserveAll = {
	subscribe(sink: (nodePath: string, messages: Messages) => void): () => void;
	/** Send messages upstream toward a specific observed node's sources (e.g. PAUSE/RESUME). */
	up(path: string, messages: Messages): void;
};

/**
 * Detail level for `observe()` progressive disclosure (Phase 3.3b).
 * - `"minimal"` — DATA events only, no timestamps, no causal info.
 * - `"standard"` — all message types (DATA, DIRTY, RESOLVED, INVALIDATE,
 *   PAUSE, RESUME, COMPLETE, ERROR, TEARDOWN).
 * - `"full"` — standard + timeline + causal + derived.
 */
export type ObserveDetail = "minimal" | "standard" | "full";

/**
 * Tier name for {@link ObserveEvent} filtering. Aligns with spec §1.2 message
 * tier semantics — each `ObserveTier` corresponds to one or more protocol
 * message types. Used by {@link ObserveOptions.tiers} to scope observation to
 * a subset of event categories (e.g. `tiers: ["error", "complete", "teardown"]`
 * for failure-only health monitoring).
 */
export type ObserveTier = ObserveEvent["type"];

/**
 * Coalesced batch of {@link ObserveEvent}s emitted as one DATA wave per
 * outermost batch flush by `Graph.observe({ reactive: true })`.
 *
 * Disjoint from `DescribeChangeset` (the topology-layer envelope). Each event
 * carries its own `path` so consumers route per-path without unwrapping the
 * envelope first. `flushedAt_ns` is monotonic via `core/clock.ts`.
 */
export type ObserveChangeset = {
	events: ReadonlyArray<ObserveEvent>;
	flushedAt_ns: number;
};

/** Options for structured observation modes on {@link Graph.observe}. */
export type ObserveOptions = {
	actor?: Actor;
	/** Return an {@link ObserveResult} accumulator instead of a raw stream. */
	structured?: boolean;
	/** Include causal trace info (which dep triggered each recomputation). */
	causal?: boolean;
	/** Include timestamps and batch context on each event. */
	timeline?: boolean;
	/** Include per-evaluation dep snapshots for compute/derived nodes. */
	derived?: boolean;
	/**
	 * Detail level (Phase 3.3b). Individual flags (`causal`, `timeline`, `derived`)
	 * override. `"full"` implies all three plus structured.
	 * `"minimal"` filters to DATA-only events.
	 */
	detail?: ObserveDetail;
	/**
	 * Filter observed events to these tiers only. When omitted, all event types
	 * are delivered. Applies to both the structured callback and the reactive
	 * variants (`observe({ reactive: true })`).
	 *
	 * Example: `tiers: ["error", "complete", "teardown"]` for failure-only
	 * health monitoring; `tiers: ["data"]` for value-flow tracking.
	 */
	tiers?: readonly ObserveTier[];
	/**
	 * Return a `Node<ObserveChangeset>` that emits one DATA wave per outermost
	 * batch flush, with all observed events for that flush coalesced into a
	 * single changeset. Auto-enables structured mode (the reactive variant
	 * delivers {@link ObserveEvent}s, not raw messages).
	 *
	 * Coalescing matches `describe({ reactive: true })`'s `registerBatchFlushHook`
	 * mechanism — N events in one batch → one changeset DATA wave at flush.
	 */
	reactive?: boolean;
	/** Optional name for the reactive changeset node when `reactive: true`. */
	reactiveName?: string;
	/**
	 * Tier 1.5.D2 — return a `Node<GraphChange>` that emits one DATA per
	 * discrete graph change event (data flow, topology, batch boundaries).
	 *
	 * Disjoint from `reactive: true` (which returns coalesced
	 * `ObserveChangeset`s of `ObserveEvent`s) — `changeset: true` emits a
	 * different stream shape. The two modes are not combinable in one call;
	 * setting both throws.
	 *
	 * Each event is a {@link GraphChange} carrying a common envelope
	 * (`version`, `timestamp_ns`, `scope`) plus variant-specific payload.
	 * Variants:
	 * - **Core data flow:** `data` (with `fromPath` + `fromDepIndex` edge
	 *   attribution), `dirty`, `resolved`, `error`, `complete`, `teardown`.
	 * - **Topology:** `node-added`, `node-removed`, `mount`, `unmount`.
	 * - **Batch boundaries:** `batch-start`, `batch-end`. A `batch-start`
	 *   precedes the first event inside a batch; `batch-end` follows the
	 *   last event when the batch flushes.
	 *
	 * The envelope shape is forward-compatible with post-1.0 store-level
	 * `StoreOp` variants (§8.7 Delta checkpoints & WAL) — adding more
	 * variants is a non-breaking append.
	 *
	 * Designed as the input layer for `topologyView` (Tier 1.5.D3): combine
	 * `node-added` / `node-removed` for layout invalidation with `data` events
	 * for per-frame edge highlighting.
	 */
	changeset?: boolean;
	/** Optional name for the changeset node when `changeset: true`. */
	changesetName?: string;

	// ——— Format / logging (merged from spy) ———

	/**
	 * When set, auto-enables structured mode and attaches a logger.
	 * - `"pretty"` — colored one-line output per event.
	 * - `"json"` — one JSON object per event.
	 * - `"stage-log"` — pipeline-stage-labeled output for multi-node
	 *   observers. Auto-enables `timeline: true` so each line carries an
	 *   elapsed-seconds offset from the subscription. Provide a
	 *   {@link stageLabels} map to label each observed path; paths without a
	 *   mapping fall back to the path string.
	 */
	format?: "pretty" | "json" | "stage-log";
	/** Sink for rendered lines (`console.log` by default). Only used when `format` is set. */
	logger?: (line: string, event: ObserveEvent) => void;
	/** Keep only these event types in formatted output. Only used when `format` is set. */
	includeTypes?: ObserveEvent["type"][];
	/** Exclude these event types from formatted output. Only used when `format` is set. */
	excludeTypes?: ObserveEvent["type"][];
	/** Built-in color preset (`ansi` default) or explicit color tokens. Only used when `format` is set. */
	theme?: ObserveThemeName | ObserveTheme;
	/**
	 * Stage labels for `format: "stage-log"`. Keys are observe paths; values
	 * are short stage names (e.g. `{ "intake::latest": "INTAKE" }`). Paths
	 * without a mapping render under the path string itself. Ignored for
	 * other formats.
	 */
	stageLabels?: Record<string, string>;
	/**
	 * Cap the `events` buffer. When set, the result uses a {@link RingBuffer}
	 * under the hood: oldest events are dropped on overflow. Unbounded when
	 * omitted (default).
	 */
	maxEvents?: number;
};

/** Accumulated observation result (structured mode). */
export type ObserveResult<T = unknown> = AsyncIterable<ObserveEvent> & {
	/** Latest DATA value by observed path. */
	readonly values: Record<string, T>;
	/** Number of DIRTY messages received. */
	readonly dirtyCount: number;
	/** Number of RESOLVED messages received. */
	readonly resolvedCount: number;
	/** Number of INVALIDATE messages received (tier 1 cache-clear). */
	readonly invalidateCount: number;
	/** Number of PAUSE messages received (tier 2 backpressure). */
	readonly pauseCount: number;
	/** Number of RESUME messages received (tier 2 backpressure). */
	readonly resumeCount: number;
	/** Number of TEARDOWN messages received (tier 5 permanent cleanup). */
	readonly teardownCount: number;
	/**
	 * All events in order — ring-buffered when `options.maxEvents` is set,
	 * unbounded otherwise. Always materialized as an `ObserveEvent[]`
	 * snapshot on read.
	 */
	readonly events: ObserveEvent[];
	/** True if any observed node sent COMPLETE without prior ERROR on that node. */
	readonly anyCompletedCleanly: boolean;
	/** True if any observed node sent ERROR. */
	readonly anyErrored: boolean;
	/** True if at least one COMPLETE received and no ERROR from any observed node. */
	readonly completedWithoutErrors: boolean;
	/**
	 * Attach a live listener that fires for each event as it arrives.
	 * Returns an unsubscribe fn. Independent of the `events` buffer.
	 */
	onEvent(listener: (event: ObserveEvent) => void): () => void;
	/** Stop observing. */
	dispose(): void;
	/**
	 * Resubscribe with higher detail (Phase 3.3b).
	 * Disposes current observation, returns new `ObserveResult` with merged options.
	 */
	expand(
		extra: Partial<Pick<ObserveOptions, "causal" | "timeline" | "derived">> | ObserveDetail,
	): ObserveResult<T>;
};

/** Fields common to every {@link ObserveEvent} variant. */
export interface ObserveEventBase {
	path?: string;
	/** Optional `timeline` context — wall-clock when `options.timeline === true`. */
	timestamp_ns?: number;
	in_batch?: boolean;
	/** Monotonically increasing counter per subscribe-callback invocation. All events in one delivery share the same id. */
	batch_id?: number;
	/**
	 * Attribution for `data`/`error` events (B9 — actor threading). When
	 * the originating `node.down(...)` call supplied an `actor` via
	 * `NodeTransportOptions`, it's forwarded here as read from
	 * `Node.lastMutation`. Internal / unattributed writes stamp the
	 * library's `DEFAULT_ACTOR` (`{type: "system", id: ""}`) rather than
	 * being silently dropped, so downstream policy/audit consumers can
	 * evaluate policies against a well-formed actor in every case.
	 *
	 * Not populated for tier-1/tier-2 protocol events (`dirty`, `resolved`,
	 * `pause`, `resume`, `invalidate`, `teardown`) — those don't carry
	 * caller attribution.
	 */
	actor?: Actor;
}

/** Optional `causal` context present on `data`/`resolved`/`derived` events. */
export interface ObserveCausalContext {
	trigger_dep_index?: number;
	trigger_dep_name?: string;
	/**
	 * V0 version of the triggering dep at observation time (§6.0b).
	 * This is the dep's post-emission version (after its own `advanceVersion`),
	 * not the pre-emission version that caused this node's recomputation.
	 */
	trigger_version?: { id: string; version: number };
	/**
	 * One scalar per dep: the last value that arrived in the current wave,
	 * or the pre-wave cached value for deps that didn't fire. Convenient
	 * for single-value-wave tooling (the common case).
	 */
	dep_values?: unknown[];
	/**
	 * Full per-dep batches for the wave that fired the fn — `dep_batches[i]`
	 * is the array of values dep `i` delivered this wave (`undefined` for
	 * deps that didn't fire). Use this to distinguish a single-value wave
	 * from a multi-value wave; `dep_values` compresses each batch to its
	 * last element and hides that difference.
	 */
	dep_batches?: ReadonlyArray<ReadonlyArray<unknown> | undefined>;
}

/** A single event in the structured observation log (discriminated on `type`). */
export type ObserveEvent =
	| (ObserveEventBase & ObserveCausalContext & { type: "data"; data: unknown })
	| (ObserveEventBase & { type: "dirty" })
	| (ObserveEventBase & ObserveCausalContext & { type: "resolved" })
	| (ObserveEventBase & { type: "invalidate" })
	| (ObserveEventBase & { type: "pause"; lockId: unknown })
	| (ObserveEventBase & { type: "resume"; lockId: unknown })
	| (ObserveEventBase & { type: "complete" })
	| (ObserveEventBase & { type: "error"; data: unknown })
	| (ObserveEventBase & { type: "teardown" })
	| (ObserveEventBase & ObserveCausalContext & { type: "derived"; dep_values: unknown[] });

/** Built-in color preset names for observe `format` rendering. */
export type ObserveThemeName = "none" | "ansi";

/** ANSI/style overrides for observe `format` event rendering. */
export type ObserveTheme = Partial<Record<ObserveEvent["type"] | "path" | "reset", string>>;

/**
 * Reject characters that would collide with internal serialization or path
 * grammar. Control chars (0x00–0x1F, 0x7F) break `describe()` key stability,
 * diagram rendering, and any tab-delimited log/trace format. Keep the test
 * tight so the error message points at the first offending code point.
 */
function assertNoControlChars(name: string, graphName: string, label: string): void {
	for (let i = 0; i < name.length; i++) {
		const c = name.charCodeAt(i);
		if (c < 0x20 || c === 0x7f) {
			throw new Error(
				`Graph "${graphName}": ${label} "${name}" must not contain control character (U+${c.toString(16).padStart(4, "0").toUpperCase()} at index ${i})`,
			);
		}
	}
}

/**
 * Validate a registerable local name (`add`, `mount`, `remove` inputs):
 * non-empty, no `::` separator, not the reserved `__meta__` segment, and no
 * control characters.
 */
function assertRegisterableName(name: string, graphName: string, label: string): void {
	if (name === "") {
		throw new Error(`Graph "${graphName}": ${label} name must be non-empty`);
	}
	if (name.includes(PATH_SEP)) {
		throw new Error(
			`Graph "${graphName}": ${label} "${name}" must not contain '${PATH_SEP}' (path separator)`,
		);
	}
	if (name === GRAPH_META_SEGMENT) {
		throw new Error(
			`Graph "${graphName}": ${label} name "${GRAPH_META_SEGMENT}" is reserved for meta companion paths`,
		);
	}
	assertNoControlChars(name, graphName, label);
}

function splitPath(path: string, graphName: string): string[] {
	if (path === "") {
		throw new Error(`Graph "${graphName}": resolve path must be non-empty`);
	}
	const segments = path.split(PATH_SEP);
	for (const s of segments) {
		if (s === "") {
			throw new Error(`Graph "${graphName}": resolve path has empty segment`);
		}
	}
	return segments;
}

/**
 * Strip messages that are not marked `metaPassthrough` on the given config
 * (spec §2.3 Companion lifecycle). Built-ins: `INVALIDATE`, `COMPLETE`,
 * `ERROR`, `TEARDOWN` are registered `metaPassthrough: false` in
 * `registerBuiltins`. Custom types default to `true` (meta receives them).
 *
 * To target a meta node directly without the filter, call `meta.down(...)`.
 *
 * Returns empty array when nothing remains.
 */
function filterMetaMessages(messages: Messages, config: GraphReFlyConfig): Messages {
	// Fast path: if every message is metaPassthrough, reuse the input array.
	let anyFiltered = false;
	for (const m of messages) {
		if (!config.isMetaPassthrough(m[0])) {
			anyFiltered = true;
			break;
		}
	}
	if (!anyFiltered) return messages;
	const kept = messages.filter((m) => config.isMetaPassthrough(m[0]));
	return kept as unknown as Messages;
}

/**
 * TEARDOWN every node in a mounted graph tree (depth-first into mounts).
 * Errors from individual node teardowns are swallowed — a single bad handler
 * must not abort cleanup of the rest of the subtree.
 */
function teardownMountedGraph(root: Graph): void {
	for (const child of root._mounts.values()) {
		teardownMountedGraph(child);
	}
	for (const n of root._nodes.values()) {
		try {
			n.down([[TEARDOWN]] satisfies Messages, { internal: true });
		} catch {
			/* resilience: keep tearing down siblings */
		}
	}
}

/**
 * Named container for nodes and explicit edges (GRAPHREFLY-SPEC §3.1–§3.7).
 *
 * Qualified paths use `::` as the segment separator (for example `parent::child::node`).
 *
 * Edges are pure wires: `connect` only validates wiring — the target must already list the source in
 * its dependency array; no transforms run on the edge.
 *
 * @example
 * ```ts
 * import { Graph, state } from "@graphrefly/graphrefly-ts";
 *
 * const g = new Graph("app");
 * g.add(state(0, { name: "counter" }));
 * ```
 *
 * @category graph
 */
export class Graph {
	readonly name: string;
	readonly opts: Readonly<GraphOptions>;
	/** Protocol config bound to this graph (defaults to `defaultConfig`). */
	readonly config: GraphReFlyConfig;
	/** @internal — exposed for {@link teardownMountedGraph} and cross-graph helpers. */
	readonly _nodes = new Map<string, Node>();
	/**
	 * @internal Reverse lookup for duplicate-instance detection in
	 * {@link Graph.add} — O(1) replacement for an O(n) scan of `_nodes`.
	 * Weak so nodes can be GC'd after `remove()` even if a caller keeps the
	 * map alive via some unusual pattern.
	 */
	private readonly _nodeToName = new WeakMap<Node, string>();
	/** @internal — exposed for {@link teardownMountedGraph}. */
	readonly _mounts = new Map<string, Graph>();
	/**
	 * @internal Parent graph if this instance is mounted. `undefined` when
	 * this is the root or when the graph has been unmounted. Used for
	 * reparenting rejection + O(depth) ancestor walks.
	 */
	_parent: Graph | undefined = undefined;
	private readonly _storageDisposers = new Set<() => void>();
	private readonly _disposers = new Set<() => void>();
	/** @internal Set in {@link destroy} / `_destroyClearOnly`; surfaced via {@link destroyed}. */
	private _destroyed = false;
	/**
	 * @internal Lazy `TopologyEvent` producer. Created on first `.topology`
	 * access. Zero cost until something subscribes — producer fn only runs when
	 * the first sink attaches, registering one handler into
	 * {@link Graph._topologyEmitters}.
	 */
	private _topology: Node<TopologyEvent> | undefined;
	/**
	 * @internal Active emit handlers for the topology producer. Each entry is
	 * the closure registered by the producer fn on activation; cleared on
	 * deactivation. `_emitTopology` broadcasts through every entry (there is at
	 * most one per activation cycle of the producer).
	 */
	private readonly _topologyEmitters = new Set<(event: TopologyEvent) => void>();

	/**
	 * @param name - Non-empty graph id (must not contain `::` and must not
	 *   equal the reserved meta segment `__meta__`).
	 * @param opts - See {@link GraphOptions}. Stored frozen on the instance.
	 */
	/** Tier 1.5.3 Phase 2.5 — top-level factory tag for Graph-returning factories. */
	private _factory?: string;
	private _factoryArgs?: unknown;

	constructor(name: string, opts?: GraphOptions) {
		if (name === "") {
			throw new Error("Graph name must be non-empty");
		}
		if (name.includes(PATH_SEP)) {
			throw new Error(`Graph name must not contain '${PATH_SEP}' (got "${name}")`);
		}
		if (name === GRAPH_META_SEGMENT) {
			throw new Error(`Graph name "${GRAPH_META_SEGMENT}" is reserved for meta companion paths`);
		}
		this.name = name;
		this.opts = Object.freeze({ ...(opts ?? {}) });
		this.config = opts?.config ?? defaultConfig;
		this._traceRing = new RingBuffer<TraceEntry>(opts?.traceCapacity ?? 1000);
		if (opts?.versioning != null) {
			// No nodes yet, but keep the API consistent — apply at construction
			// so opts.versioning is honored as a startup default via this helper.
			this.setVersioning(opts.versioning);
		}
		if (typeof opts?.factory === "string") {
			this._factory = opts.factory;
			if (opts.factoryArgs !== undefined) this._factoryArgs = opts.factoryArgs;
		}
	}

	/**
	 * Tag this graph with its constructing factory's identifier and args.
	 * Used by Graph-returning factories (`agentMemory`, `harnessLoop`,
	 * `pipelineGraph`, etc.) so `describe()` exposes provenance and
	 * `compileSpec` can delegate reconstruction to
	 * `catalog.graphFactories[factory]`. Tier 1.5.3 Phase 2.5 (DG1=B).
	 *
	 * `factoryArgs` should be JSON-serializable. For non-JSON fields
	 * (LLMAdapter, callbacks, etc.), use {@link placeholderArgs} to
	 * substitute descriptive strings (DG2=ii).
	 *
	 * Returns `this` for fluent chaining inside factory bodies.
	 */
	tagFactory(factory: string, factoryArgs?: unknown): this {
		this._factory = factory;
		// QA F8: always assign — second call without args clears stale args
		// (otherwise `tagFactory("a", {x:1})` then `tagFactory("b")` keeps {x:1}
		// paired with "b", which is mismatched provenance).
		this._factoryArgs = factoryArgs;
		return this;
	}

	/**
	 * Walk ancestors up through `_parent`. Returns the chain starting at this
	 * instance, ending at the root (a graph with no parent). O(depth).
	 *
	 * @param includeSelf - Include `this` in the chain (default `true`).
	 */
	ancestors(includeSelf = true): Graph[] {
		const out: Graph[] = [];
		let p: Graph | undefined = includeSelf ? this : this._parent;
		while (p != null) {
			out.push(p);
			p = p._parent;
		}
		return out;
	}

	// ——————————————————————————————————————————————————————————————
	//  Topology companion (structural-change event stream)
	// ——————————————————————————————————————————————————————————————

	/**
	 * Reactive stream of structural changes to this graph's own registry
	 * (add / mount / remove). Value mutations live on `observe()`; this
	 * companion only fires when the topology shape changes.
	 *
	 * Lazy: the underlying node is created on first access and activates when
	 * something subscribes. No emission replay — late subscribers do not
	 * receive historical events and should snapshot via {@link Graph.describe}
	 * before listening for incremental changes. Events that fire while the
	 * producer has zero subscribers are dropped (no retention).
	 *
	 * Own-graph only: a parent's `topology` does NOT emit for structural
	 * changes inside a mounted child. Transitive consumers subscribe to each
	 * child's topology separately (recurse through `topology`'s own "added"
	 * events with `nodeKind: "mount"` to discover new children).
	 *
	 * See {@link TopologyEvent} for payload shape.
	 *
	 * @category observability
	 */
	get topology(): Node<TopologyEvent> {
		if (this._topology == null) {
			this._topology = node<TopologyEvent>(
				(_data, actions) => {
					const handler = (event: TopologyEvent): void => {
						actions.emit(event);
					};
					this._topologyEmitters.add(handler);
					return () => {
						this._topologyEmitters.delete(handler);
					};
				},
				{ name: `${this.name}_topology`, describeKind: "producer" },
			);
		}
		return this._topology;
	}

	/**
	 * @internal Fire a {@link TopologyEvent} to every active subscriber of
	 * `this.topology`. No-op when the topology node has never been accessed or
	 * currently has no sinks — zero cost for graphs nobody observes.
	 */
	private _emitTopology(event: TopologyEvent): void {
		if (this._topology == null || this._topologyEmitters.size === 0) return;
		for (const h of this._topologyEmitters) h(event);
	}

	// ——————————————————————————————————————————————————————————————
	//  Node registry
	// ——————————————————————————————————————————————————————————————

	/**
	 * Registers a node under a local name. Fails if the name is already used,
	 * reserved by a mount, the same node instance is already registered, or
	 * the node is torn down.
	 *
	 * Returns the registered node so callers can chain:
	 * `const counter = g.add(state(0, { name: "counter" }))`.
	 *
	 * **Signature:** `add(node, { name?, annotation? })`. Name lives in opts;
	 * falls back to `node.name` from the node's own options. Throws if neither
	 * is a non-empty string.
	 *
	 * The optional `opts.annotation` installs an initial
	 * `graph.trace(name, annotation)` entry — same effect as calling
	 * `graph.trace` right after, but reads naturally next to the registration.
	 *
	 * @param node - Node instance to own.
	 * @param opts - `{ name?, annotation? }`.
	 */
	/**
	 * O(1) reverse lookup — returns the name the given Node was registered
	 * under via {@link Graph.add}, or `undefined` if it isn't registered here.
	 *
	 * Audit 2 (2026-04-24): replaces the orchestration's `findRegisteredNodePath`
	 * O(nodes²) describe-scan with direct `WeakMap<Node, string>` lookup.
	 */
	nameOf(node: Node): string | undefined {
		return this._nodeToName.get(node);
	}

	add<T extends Node>(node: T, opts?: { name?: string; annotation?: string }): T {
		const fallback = (node as unknown as { name?: string }).name;
		const resolved = opts?.name ?? fallback;
		if (resolved == null || resolved === "") {
			throw new Error(
				`Graph "${this.name}": graph.add requires a non-empty name — pass via opts.name or set it on the node (e.g. state(0, { name: "x" }))`,
			);
		}
		const name = resolved;
		const annotation = opts?.annotation;
		assertRegisterableName(name, this.name, "add");
		if (this._mounts.has(name)) {
			throw new Error(`Graph "${this.name}": name "${name}" is already a mount point`);
		}
		if (this._nodes.has(name)) {
			throw new Error(`Graph "${this.name}": node "${name}" already exists`);
		}
		const existingName = this._nodeToName.get(node);
		if (existingName !== undefined) {
			throw new Error(
				`Graph "${this.name}": node instance already registered as "${existingName}"`,
			);
		}
		this._nodes.set(name, node);
		this._nodeToName.set(node, name);
		// Edges are derived on demand from node `_deps` (see `edges()`) — no
		// stored registry to keep in sync. See Unit 7 of the graph review.
		this._emitTopology({ kind: "added", name, nodeKind: "node" });
		// Install the initial annotation, if supplied. The `_annotations` map
		// always gets the entry so annotations aren't silently lost when the
		// inspector is disabled at construction time (reads via `trace(path)`
		// stay cheap either way). Only the chronological ring-buffer push is
		// gated on `inspectorEnabled`, since that buffer is the "debug log"
		// half of the feature.
		if (annotation != null) {
			this._annotations.set(name, annotation);
			if (this.config.inspectorEnabled) {
				this._traceRing.push({
					path: name,
					annotation,
					timestamp_ns: monotonicNs(),
				});
			}
		}
		return node;
	}

	/**
	 * Bulk-apply a minimum versioning level to every currently-registered node
	 * in this graph (roadmap §6.0). `_applyVersioning` is monotonic — nodes
	 * already at a higher level are untouched. The method refuses to run
	 * mid-wave; invoke at setup time before any external subscribers attach.
	 *
	 * **Not** a default-for-future-adds mechanism — that's what
	 * `config.defaultVersioning` is for. Nodes added after this call do NOT
	 * automatically inherit `level`; register new nodes with their own
	 * `opts.versioning` or set `config.defaultVersioning` before construction.
	 *
	 * **Scope:** local only. Does not propagate to mounted subgraphs.
	 *
	 * @param level - `0` for V0, `1` for V1, or `undefined` to no-op.
	 */
	setVersioning(level: VersioningLevel | undefined): void {
		if (level == null) return;
		for (const node of this._nodes.values()) {
			if (node instanceof NodeImpl) {
				node._applyVersioning(level);
			}
		}
	}

	/**
	 * Unregisters a node or unmounts a subgraph and sends `[[TEARDOWN]]` to the
	 * removed node or recursively through the mounted subtree (§3.2).
	 *
	 * @param name - Local mount or node name.
	 * @returns Audit record of what was removed: `{kind, nodes, mounts}`.
	 *   `kind: "node"` → `nodes: [name]`, `mounts: []`. `kind: "mount"` →
	 *   `nodes` lists every primary node torn down across the subtree (sorted
	 *   qualified paths relative to the unmounted subgraph) and `mounts` lists
	 *   the mounted subgraphs in depth-first order including `name` itself.
	 */
	remove(name: string): GraphRemoveAudit {
		assertRegisterableName(name, this.name, "remove");

		// Case 1: unmount a subgraph
		const child = this._mounts.get(name);
		if (child) {
			const audit: GraphRemoveAudit = { kind: "mount", nodes: [], mounts: [] };
			const targets: [string, Node][] = [];
			child._collectObserveTargets("", targets);
			for (const [p, n] of targets) {
				// Only primary nodes (not meta companions) — meta cascades via
				// the primary's TEARDOWN.
				if (!p.includes(`${PATH_SEP}${GRAPH_META_SEGMENT}${PATH_SEP}`)) {
					audit.nodes.push(p);
				}
				void n;
			}
			audit.nodes.sort();
			audit.mounts.push(name);
			audit.mounts.push(...child._collectSubgraphs(`${name}${PATH_SEP}`));
			this._mounts.delete(name);
			child._parent = undefined;
			teardownMountedGraph(child);
			this._emitTopology({ kind: "removed", name, nodeKind: "mount", audit });
			return audit;
		}

		// Case 2: remove a local node
		const node = this._nodes.get(name);
		if (!node) {
			throw new Error(`Graph "${this.name}": unknown node or mount "${name}"`);
		}
		this._nodes.delete(name);
		this._nodeToName.delete(node);
		node.down([[TEARDOWN]] satisfies Messages, { internal: true });
		const audit: GraphRemoveAudit = { kind: "node", nodes: [name], mounts: [] };
		this._emitTopology({ kind: "removed", name, nodeKind: "node", audit });
		return audit;
	}

	/**
	 * Iterable over locally-registered `[localName, Node]` pairs (sorted).
	 * Does not recurse into mounts.
	 */
	[Symbol.iterator](): IterableIterator<[string, Node]> {
		const sorted = [...this._nodes.keys()].sort();
		const nodes = this._nodes;
		let i = 0;
		return {
			[Symbol.iterator]() {
				return this;
			},
			next(): IteratorResult<[string, Node]> {
				if (i >= sorted.length) return { value: undefined, done: true };
				const name = sorted[i++];
				return { value: [name, nodes.get(name)!], done: false };
			},
		};
	}

	/**
	 * Returns a node by local name or `::` qualified path.
	 * Local names are looked up directly; paths with `::` delegate to {@link resolve}.
	 *
	 * @param name - Local name or qualified path.
	 */
	node(name: string): Node {
		if (name === "") {
			throw new Error(`Graph "${this.name}": node name must be non-empty`);
		}
		if (name.includes(PATH_SEP)) {
			return this.resolve(name);
		}
		const n = this._nodes.get(name);
		if (!n) {
			throw new Error(`Graph "${this.name}": unknown node "${name}"`);
		}
		return n;
	}

	/**
	 * Shorthand for `graph.node(name).down([[DATA, value]], { actor })` — accepts `::` qualified paths (§3.2).
	 *
	 * @param name - Local name or qualified path.
	 * @param value - Next `DATA` payload.
	 * @param options - Optional `actor` and `internal` guard bypass.
	 */
	set(name: string, value: unknown, options?: GraphActorOptions): void {
		const internal = options?.internal === true;
		this.node(name).down([[DATA, value]] satisfies Messages, {
			actor: options?.actor,
			internal,
			delivery: "write",
		});
	}

	/**
	 * Emit a single `[[INVALIDATE]]` (tier 1) on a node. Thin wrapper over
	 * `node.down([[INVALIDATE]], …)` matching the {@link Graph.set} ergonomics.
	 */
	invalidate(name: string, options?: GraphActorOptions): void {
		const internal = options?.internal === true;
		this.node(name).down([[INVALIDATE]] satisfies Messages, {
			actor: options?.actor,
			internal,
			delivery: "write",
		});
	}

	/**
	 * Emit a single `[[ERROR, err]]` (tier 4) on a node.
	 */
	error(name: string, err: unknown, options?: GraphActorOptions): void {
		const internal = options?.internal === true;
		this.node(name).down([[ERROR, err]] satisfies Messages, {
			actor: options?.actor,
			internal,
			delivery: "write",
		});
	}

	/**
	 * Emit a single `[[COMPLETE]]` (tier 4) on a node, declaring the stream
	 * cleanly finished. Distinct from {@link Graph.remove} (which emits
	 * TEARDOWN and unregisters the node).
	 */
	complete(name: string, options?: GraphActorOptions): void {
		const internal = options?.internal === true;
		this.node(name).down([[COMPLETE]] satisfies Messages, {
			actor: options?.actor,
			internal,
			delivery: "write",
		});
	}

	// ——————————————————————————————————————————————————————————————
	//  Composition (narrow-waist API for pattern authors — spec §5.12)
	// ——————————————————————————————————————————————————————————————

	/**
	 * Internal: register a self-pruning keepalive subscription. The sink
	 * watches for terminal messages (`COMPLETE`/`ERROR`/`TEARDOWN`) on `n`
	 * and removes the disposer from `_disposers` when one arrives, so
	 * repeated `graph.remove(name)` cycles do not accumulate stale
	 * disposers (qa B3).
	 */
	private _registerSelfPruningKeepalive(n: Node<unknown>): void {
		let unsub: (() => void) | undefined;
		let removeFromDisposers: (() => void) | undefined;
		const cleanup = (): void => {
			unsub?.();
			unsub = undefined;
			removeFromDisposers?.();
			removeFromDisposers = undefined;
		};
		unsub = n.subscribe((msgs) => {
			for (const m of msgs) {
				const t = m[0];
				if (t === TEARDOWN || t === COMPLETE || t === ERROR) {
					cleanup();
					return;
				}
			}
		});
		removeFromDisposers = this.addDisposer(cleanup);
	}

	/**
	 * Internal: wire an `AbortSignal` so its abort triggers
	 * `graph.remove(name)`. Already-aborted signals trigger removal
	 * synchronously. The abort listener is itself registered as a graph
	 * disposer so it gets cleaned up if `destroy()` runs first (qa B4).
	 */
	private _wireSignalToRemove(name: string, signal: AbortSignal | undefined): void {
		if (signal == null) return;
		const onAbort = (): void => {
			try {
				this.remove(name);
			} catch {
				// Already removed or graph destroyed — no-op.
			}
		};
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
		this.addDisposer(() => signal.removeEventListener("abort", onAbort));
	}

	/**
	 * Reactive derivation over a mix of `::`-qualified paths and direct
	 * Node refs. Resolves each entry in `deps`, builds a node with
	 * restricted {@link GraphDerivedFn}, registers it on this graph, and
	 * returns the registered Node.
	 *
	 * **Deps shape.** Each entry is either a `string` (resolved at
	 * construction time via {@link Graph.resolve}) or a `Node` (used as
	 * the dep directly without registering on this graph). Mixed arrays
	 * are supported — typical pattern is `[localPath, externalNodeRef]`
	 * for nodes that live on a separate graph or are intentionally
	 * unmounted (e.g. `reactiveLog().entries`). Node-ref deps appear in
	 * `describe().edges` only when the dep's owning Node is itself
	 * mounted somewhere reachable; otherwise they show up as unresolved
	 * upstream edges (matching raw `node([nodeRef], …)` semantics).
	 *
	 * **Array-return semantics.** fn returns `readonly (T | null)[]`:
	 * - `[v]` — single emit (common case).
	 * - `[]` — no change, settle as RESOLVED.
	 * - `[v1, v2, ...]` — multi-emit in one wave.
	 *
	 * **First-run gate.** fn does not fire until every dep has delivered
	 * at least one real DATA (spec §2.7, `partial: false`). A SENTINEL
	 * dep holds activation; `null` is valid DATA and releases the gate.
	 * **Empty `deps` is a vacuous gate** — fn fires once synchronously
	 * on first activation. For async sources prefer {@link Graph.producer}.
	 *
	 * **`ctx.cache`** — the node's own previous emit (`undefined` when
	 * no prior emit, `null` when the prior emit was `null`, otherwise `T`).
	 *
	 * **`keepAlive: true`** — installs an internal subscription so the
	 * node stays activated and `.cache` stays current for external
	 * consumers. Self-prunes on terminal; drained by {@link Graph.destroy}.
	 *
	 * **`signal`** — when aborted, removes this node from the graph.
	 *
	 * @param name - Local registration name (must be unique on this graph).
	 * @param deps - Mix of `::`-qualified path strings (resolved at
	 *   construction time) and direct `Node` refs (used as-is). Strings
	 *   resolve once at construction and the resolved refs persist; see
	 *   `optimizations.md` C4 for the rewire gap on post-construction
	 *   mount removal.
	 * @param fn - Restricted compute — see {@link GraphDerivedFn}.
	 * @param opts - {@link GraphDerivedOptions}.
	 * @returns The registered `Node<T>`.
	 */
	derived<T>(
		name: string,
		deps: readonly (string | Node<unknown>)[],
		fn: GraphDerivedFn<T>,
		opts?: GraphDerivedOptions<T>,
	): Node<T> {
		const resolvedDeps = deps.map((d) => (typeof d === "string" ? this.resolve(d) : d));
		const { keepAlive, annotation, signal, ...nodeOpts } = opts ?? {};

		// Wrap restricted GraphDerivedFn → raw NodeFn.
		// Pass batchData and full ctx straight through; restriction is
		// only on the OUTPUT side (return array, no actions).
		// Closure captures `nodeRef` so the wrapper can read `.cache` for
		// the ctx.cache field (same pattern as autoTrackNode).
		let nodeRef: Node<T> | undefined;
		const wrapped: NodeFn = (batchData, actions, ctx) => {
			const derivedCtx: FnCtxDerived<T> = {
				prevData: ctx.prevData,
				terminalDeps: ctx.terminalDeps,
				store: ctx.store,
				cache: nodeRef?.cache,
			};
			const result = fn(batchData, derivedCtx);
			if (result.length === 0) {
				// Empty array → no change → settle as RESOLVED.
				actions.down(RESOLVED_ONLY_BATCH);
			} else {
				for (const v of result) {
					actions.emit(v);
				}
			}
			return undefined;
		};

		const n = node<T>(resolvedDeps, wrapped, {
			...nodeOpts,
			name,
			describeKind: "derived",
		});
		nodeRef = n;
		this.add(n, { name, ...(annotation != null ? { annotation } : {}) });
		if (keepAlive === true) {
			this._registerSelfPruningKeepalive(n);
		}
		this._wireSignalToRemove(name, signal);
		return n;
	}

	/**
	 * Managed side effect over a mix of `::`-qualified paths and direct
	 * Node refs. Resolves each entry in `deps`, builds a node with
	 * restricted {@link GraphEffectFn}, registers it on this graph, and
	 * returns the registered Node.
	 *
	 * **Deps shape.** Each entry is either a `string` (resolved at
	 * construction time via {@link Graph.resolve}) or a `Node` (used as
	 * the dep directly without registering on this graph). See
	 * {@link Graph.derived} for full mixed-deps semantics.
	 *
	 * **Pure sink.** fn has no `emit`/`down` — effects that need
	 * downstream emission use {@link Graph.producer} or drop to raw
	 * `node() + graph.add()`. fn receives `up.pause(lockId)` /
	 * `up.resume(lockId)` for upstream backpressure only.
	 *
	 * **Cleanup.** Return a cleanup function or granular hooks
	 * (`{ beforeRun?, deactivate?, invalidate? }`) — see
	 * {@link NodeFnCleanup}. Graph teardown triggers `deactivate`.
	 *
	 * **`signal`** — when aborted, removes this node from the graph.
	 *
	 * @param name - Local registration name (must be unique on this graph).
	 * @param deps - Mix of `::`-qualified path strings (resolved at
	 *   construction time) and direct `Node` refs (used as-is).
	 * @param fn - Restricted side-effect — see {@link GraphEffectFn}.
	 * @param opts - {@link GraphEffectOptions}.
	 * @returns The registered `Node<unknown>`.
	 */
	effect(
		name: string,
		deps: readonly (string | Node<unknown>)[],
		fn: GraphEffectFn,
		opts?: GraphEffectOptions,
	): Node<unknown> {
		const resolvedDeps = deps.map((d) => (typeof d === "string" ? this.resolve(d) : d));
		const { annotation, signal, ...nodeOpts } = opts ?? {};

		// Wrap restricted GraphEffectFn → raw NodeFn.
		// Pass batchData and full ctx straight through; restriction is
		// only on the OUTPUT side (up.pause/resume only, no emit/down).
		const wrapped: NodeFn = (batchData, actions, ctx) => {
			const up: NodeUpActions = {
				pause: (lockId) => actions.up([PAUSE, lockId]),
				resume: (lockId) => actions.up([RESUME, lockId]),
			};
			return fn(batchData, up, ctx) ?? undefined;
		};

		const n = node(resolvedDeps, wrapped, {
			...nodeOpts,
			name,
			describeKind: "effect",
		});
		this.add(n, { name, ...(annotation != null ? { annotation } : {}) });
		this._wireSignalToRemove(name, signal);
		return n;
	}

	/**
	 * Creates a named state node — a dep-free node with an initial value.
	 * State nodes are the primary entry points for external data into the
	 * graph. Emit new values via `node.emit(v)` or protocol-level
	 * `down([[DATA, v]])`.
	 *
	 * **`signal`** — when aborted, removes this node from the graph.
	 *
	 * @param name - Local registration name (must be unique on this graph).
	 * @param initial - Initial value. `null` is valid; `undefined` is
	 *   sentinel and means "no initial value".
	 * @param opts - {@link GraphStateOptions}.
	 * @returns The registered `Node<T>`.
	 */
	state<T>(name: string, initial?: T | null, opts?: GraphStateOptions<T>): Node<T> {
		const { annotation, signal, ...nodeOpts } = opts ?? {};
		const n = node<T>([], {
			...nodeOpts,
			name,
			describeKind: "state",
			...(initial !== undefined ? { initial } : {}),
		});
		this.add(n, { name, ...(annotation != null ? { annotation } : {}) });
		this._wireSignalToRemove(name, signal);
		return n;
	}

	/**
	 * Creates a named producer node — a dep-free source with a setup
	 * function that receives a `push` channel for emitting values.
	 *
	 * The setup fn runs once when the first subscriber connects.
	 * `push` follows the same array-emission shape as
	 * {@link GraphDerivedFn}: `push([v])` for single DATA,
	 * `push([v1, v2])` for multi-DATA.
	 *
	 * Return a cleanup function or granular hooks for teardown.
	 *
	 * **`signal`** — when aborted, removes this node from the graph
	 * (fires the producer's `deactivate` cleanup).
	 *
	 * @param name - Local registration name (must be unique on this graph).
	 * @param setupFn - {@link GraphProducerSetupFn}.
	 * @param opts - {@link GraphProducerOptions}.
	 * @returns The registered `Node<T>`.
	 */
	producer<T>(
		name: string,
		setupFn: GraphProducerSetupFn<T>,
		opts?: GraphProducerOptions<T>,
	): Node<T> {
		const { annotation, signal, ...nodeOpts } = opts ?? {};

		// Wrap GraphProducerSetupFn → raw NodeFn.
		// The push channel is built from actions.emit in the NodeFn body.
		const wrapped: NodeFn = (_data, actions, ctx) => {
			const push = (values: readonly (T | null)[]): void => {
				for (const v of values) {
					actions.emit(v);
				}
			};
			const producerCtx: FnCtxProducer = { store: ctx.store };
			return setupFn(push, producerCtx) ?? undefined;
		};

		const n = node<T>(wrapped, {
			...nodeOpts,
			name,
			describeKind: "producer",
		});
		this.add(n, { name, ...(annotation != null ? { annotation } : {}) });
		this._wireSignalToRemove(name, signal);
		return n;
	}

	/**
	 * Atomic multi-mutation. Same semantics as core {@link batch}: DATA and
	 * RESOLVED emissions inside `fn` defer, DIRTY propagates immediately, and
	 * downstream consumers see one coalesced wave (spec §1.3 invariant 7).
	 * Exposed on `Graph` for discoverability and import hygiene — pattern
	 * authors can reach for `graph.batch(...)` without importing `batch` from
	 * the core entry. Shares one global frame with the core import; nesting
	 * either way is supported.
	 *
	 * **Caveat:** if `fn` throws, deferred DATA is discarded but DIRTY
	 * messages already propagated synchronously, leaving downstream nodes
	 * in `dirty` status with stale `.cache`. Catch and emit compensating
	 * INVALIDATE/RESET if you need to recover.
	 */
	batch(fn: () => void): void {
		batch(fn);
	}

	// ——————————————————————————————————————————————————————————————
	//  Edges (derived on-demand from node `_deps`)
	// ——————————————————————————————————————————————————————————————

	/**
	 * Returns the full edge list for this graph tree, derived on demand from
	 * each registered node's `_deps` (no stored registry). Local-only
	 * (non-recursive) by default to match the historical `edges()` surface;
	 * pass `{recursive: true}` to include mounted subgraphs with qualified
	 * paths relative to this graph.
	 *
	 * Use {@link Graph.describe} for full-tree snapshots with edges already
	 * qualified and paired with node metadata.
	 */
	edges(opts?: { recursive?: boolean }): ReadonlyArray<[string, string]> {
		const recursive = opts?.recursive === true;
		const nodeToLocal = new Map<Node, string>();
		if (!recursive) {
			for (const [localName, n] of this._nodes) nodeToLocal.set(n, localName);
			const result: [string, string][] = [];
			for (const [localName, n] of this._nodes) {
				if (!(n instanceof NodeImpl)) continue;
				for (const dep of n._deps) {
					const from = nodeToLocal.get(dep.node);
					if (from != null) result.push([from, localName]);
				}
			}
			result.sort((a, b) =>
				a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
			);
			return result;
		}
		const targets: [string, Node][] = [];
		this._collectObserveTargets("", targets);
		const nodeToPath = new Map<Node, string>();
		for (const [p, n] of targets) nodeToPath.set(n, p);
		const result: [string, string][] = [];
		for (const [path, n] of targets) {
			if (!(n instanceof NodeImpl)) continue;
			for (const dep of n._deps) {
				const from = nodeToPath.get(dep.node);
				if (from != null) result.push([from, path]);
			}
		}
		result.sort((a, b) =>
			a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
		);
		return result;
	}

	// ——————————————————————————————————————————————————————————————
	//  Composition
	// ——————————————————————————————————————————————————————————————

	/**
	 * Embed a child graph at a local mount name (§3.4). Child nodes are reachable via
	 * {@link Graph.resolve} using `::` delimited paths (§3.5). Lifecycle
	 * {@link Graph.signal} visits mounted subgraphs recursively.
	 *
	 * Rejects: same name as existing node or mount, self-mount, mount cycles,
	 * and the same child graph instance mounted twice on one parent.
	 *
	 * @param name - Local mount point.
	 * @param child - Nested `Graph` instance.
	 * @returns The mounted `child`, for chaining.
	 */
	mount<G extends Graph>(name: string, child: G): G;
	mount(name: string): Graph;
	mount(name: string, builder: (sub: Graph) => void): Graph;
	mount<G extends Graph>(name: string, childOrBuilder?: G | ((sub: Graph) => void)): Graph {
		// Builder-form overloads (Audit A.1): create a fresh plain Graph and
		// run an optional builder on it BEFORE mount, so `describe()` shows a
		// populated subgraph at the moment of mount.
		if (childOrBuilder === undefined) {
			const fresh = new Graph(name);
			return this.mount(name, fresh);
		}
		if (typeof childOrBuilder === "function") {
			const fresh = new Graph(name);
			(childOrBuilder as (sub: Graph) => void)(fresh);
			return this.mount(name, fresh);
		}
		const child = childOrBuilder as G;
		assertRegisterableName(name, this.name, "mount");
		if (this._nodes.has(name)) {
			throw new Error(
				`Graph "${this.name}": cannot mount at "${name}" — node with that name exists`,
			);
		}
		if (this._mounts.has(name)) {
			throw new Error(`Graph "${this.name}": mount "${name}" already exists`);
		}
		if ((child as Graph) === this) {
			throw new Error(`Graph "${this.name}": cannot mount a graph into itself`);
		}
		// Reject reparenting (Unit 6 B): same child instance may only be
		// mounted once across the entire tree. Cheap O(1) check via the
		// back-pointer (replaces both the "mounted twice on this parent"
		// loop AND the O(G) cycle DFS).
		if (child._parent != null) {
			throw new Error(
				`Graph "${this.name}": this child graph is already mounted on "${child._parent.name}"`,
			);
		}
		// Cycle rejection — walk UP from `this` to detect if we are already in
		// `child`'s descendant tree. O(depth), independent of tree size.
		for (let p: Graph | undefined = this; p != null; p = p._parent) {
			if (p === (child as Graph)) {
				throw new Error(`Graph "${this.name}": mount("${name}", …) would create a mount cycle`);
			}
		}
		this._mounts.set(name, child);
		child._parent = this;
		this._emitTopology({ kind: "added", name, nodeKind: "mount" });
		return child;
	}

	/**
	 * Look up a node by qualified path (§3.5). Segments are separated by `::`.
	 *
	 * If the first segment equals this graph's {@link Graph.name}, it is stripped
	 * (so `root.resolve("app::a")` works when `root.name === "app"`). The strip
	 * is applied **recursively** when descending into mounted children, so
	 * `child.resolve("child::x")` also works when `child.name === "child"`.
	 *
	 * @param path - Qualified `::` path or local name.
	 * @returns The resolved `Node`.
	 */
	resolve(path: string): Node {
		const segments = splitPath(path, this.name);
		return this._resolveFromSegments(segments);
	}

	/**
	 * Non-throwing {@link Graph.resolve}. Returns `undefined` instead of
	 * throwing when the path does not resolve to a node.
	 */
	tryResolve(path: string): Node | undefined {
		try {
			return this.resolve(path);
		} catch {
			return undefined;
		}
	}

	private _resolveFromSegments(segments: readonly string[]): Node {
		// Recursive self-name strip: if the first segment equals this graph's
		// own name, peel it off. Applied at every recursion level so nested
		// resolution of `child::x` inside `child` works uniformly.
		let seg = segments;
		if (seg[0] === this.name) {
			seg = seg.slice(1);
			if (seg.length === 0) {
				throw new Error(`Graph "${this.name}": resolve path ends at graph name only`);
			}
		}
		const head = seg[0] as string;
		const rest = seg.slice(1);

		if (rest.length === 0) {
			const n = this._nodes.get(head);
			if (n) return n;
			if (this._mounts.has(head)) {
				throw new Error(
					`Graph "${this.name}": path ends at subgraph "${head}" — not a node (GRAPHREFLY-SPEC §3.5)`,
				);
			}
			throw new Error(`Graph "${this.name}": unknown name "${head}"`);
		}

		const localN = this._nodes.get(head);
		if (localN && rest.length > 0 && rest[0] === GRAPH_META_SEGMENT) {
			return this._resolveMetaChainFromNode(localN, rest, seg.join(PATH_SEP));
		}

		const child = this._mounts.get(head);
		if (!child) {
			if (this._nodes.has(head)) {
				throw new Error(
					`Graph "${this.name}": "${head}" is a node; trailing path "${rest.join(PATH_SEP)}" is invalid`,
				);
			}
			throw new Error(`Graph "${this.name}": unknown mount or node "${head}"`);
		}

		return child.resolve(rest.join(PATH_SEP));
	}

	/**
	 * Resolve `::__meta__::key` segments from a registered primary node (possibly chained).
	 */
	private _resolveMetaChainFromNode(n: Node, parts: readonly string[], fullPath: string): Node {
		let current = n;
		let i = 0;
		const p = [...parts];
		while (i < p.length) {
			if (p[i] !== GRAPH_META_SEGMENT) {
				throw new Error(
					`Graph "${this.name}": expected ${GRAPH_META_SEGMENT} segment in meta path "${fullPath}"`,
				);
			}
			if (i + 1 >= p.length) {
				throw new Error(
					`Graph "${this.name}": meta path requires a key after ${GRAPH_META_SEGMENT} in "${fullPath}"`,
				);
			}
			const key = p[i + 1] as string;
			const next = current.meta[key];
			if (!next) {
				throw new Error(`Graph "${this.name}": unknown meta "${key}" in path "${fullPath}"`);
			}
			current = next;
			i += 2;
		}
		return current;
	}

	/**
	 * Deliver a message batch to every registered node in this graph and, recursively,
	 * in mounted child graphs (§3.7). Recurses into mounts first, then delivers to
	 * local nodes (sorted by name). Each {@link Node} receives at most one delivery
	 * per call (deduped by reference).
	 *
	 * **Primary-vs-meta filter asymmetry (intentional):** primary nodes receive the
	 * unfiltered `messages` batch — that's the canonical data-plane flow. Companion
	 * `meta` nodes receive a filtered subset keyed by the per-type `metaPassthrough`
	 * flag on {@link GraphReFlyConfig}. Built-in defaults: PAUSE / RESUME / DATA /
	 * RESOLVED pass through to meta; INVALIDATE / COMPLETE / ERROR / TEARDOWN do
	 * not.
	 *
	 * **Where lifecycle terminals reach meta:**
	 * - **TEARDOWN** — primary's `_emit` cascades to meta children directly (see
	 *   `core/node.ts` "Meta TEARDOWN fan-out" block) so meta is torn down with
	 *   its primary regardless of the signal-level filter.
	 * - **COMPLETE / ERROR / INVALIDATE** — scoped to primaries on the broadcast
	 *   path. Meta companions are an attribution side-channel, not a lifecycle
	 *   participant; address meta directly via `meta.down(...)` if you need to
	 *   forward these. Audit confirmed 2026-04-17: no current meta consumer
	 *   relies on broadcast COMPLETE/ERROR/INVALIDATE delivery.
	 *
	 * @param messages - Batch to deliver to every registered node (and mounts, recursively).
	 * @param options - Optional `actor` / `internal` for transport.
	 */
	signal(messages: Messages, options?: GraphActorOptions): void {
		// Reject tier ≥ 3 (DATA / RESOLVED / COMPLETE / ERROR / TEARDOWN when
		// called externally — destroy() routes through signal with
		// `{internal: true}` which bypasses this check). Broadcasting per-flow
		// values to every node in the tree is almost always a mistake.
		if (options?.internal !== true) {
			for (const m of messages) {
				const tier = this.config.messageTier(m[0]);
				// Tier 3 (DATA / RESOLVED) is per-flow state — broadcasting it
				// to every node overwrites unrelated caches. Tier 4/5 stays
				// allowed: ERROR/COMPLETE/TEARDOWN have legitimate broadcast
				// use (graceful shutdown, error cascade).
				if (tier === 3) {
					throw new Error(
						`Graph "${this.name}": Graph.signal() rejects tier-3 messages (DATA / RESOLVED). ` +
							`Broadcast is for control-plane tiers (START / DIRTY / INVALIDATE / PAUSE / RESUME / COMPLETE / ERROR / TEARDOWN). ` +
							`For per-node value writes, use Graph.set or graph.node(name).down(...).`,
					);
				}
			}
		}
		const errors: unknown[] = [];
		this._signalDeliver(messages, options ?? {}, new Set(), errors);
		// Surface the first collected error so callers see failures without
		// aborting the rest of the broadcast. Guard denials are re-thrown
		// immediately in _signalDeliver (deliberate access-control rejections).
		if (errors.length > 0) throw errors[0];
	}

	private _signalDeliver(
		messages: Messages,
		opts: GraphActorOptions,
		vis: Set<Node>,
		errors: unknown[],
	): void {
		for (const sub of this._mounts.values()) {
			sub._signalDeliver(messages, opts, vis, errors);
		}
		const internal = opts.internal === true;
		const downOpts: NodeTransportOptions = internal
			? { internal: true }
			: { actor: opts.actor, delivery: "signal" };
		const metaMessages = filterMetaMessages(messages, this.config);
		for (const localName of [...this._nodes.keys()].sort()) {
			const n = this._nodes.get(localName)!;
			if (vis.has(n)) continue;
			vis.add(n);
			try {
				n.down(messages, downOpts);
			} catch (err) {
				// Guard denials bubble — they're deliberate rejections, not
				// resilience failures. Other errors collect so one bad handler
				// doesn't abort the rest of the broadcast.
				if (err instanceof GuardDenied) throw err;
				errors.push(err);
			}
			if (metaMessages.length === 0) continue;
			this._signalMetaSubtree(n, metaMessages, vis, downOpts, errors);
		}
	}

	private _signalMetaSubtree(
		root: Node,
		messages: Messages,
		vis: Set<Node>,
		downOpts: NodeTransportOptions,
		errors: unknown[],
	): void {
		for (const mk of Object.keys(root.meta).sort()) {
			const mnode = root.meta[mk];
			if (vis.has(mnode)) continue;
			vis.add(mnode);
			try {
				mnode.down(messages, downOpts);
			} catch (err) {
				if (err instanceof GuardDenied) throw err;
				errors.push(err);
			}
			this._signalMetaSubtree(mnode, messages, vis, downOpts, errors);
		}
	}

	/**
	 * Static structure snapshot: qualified node keys, edges, mount names (GRAPHREFLY-SPEC §3.6, Appendix B).
	 *
	 * Returns the {@link GraphDescribeOutput} object directly (or a
	 * `ReactiveDescribeHandle` when `{ reactive: true | "diff" }` is set).
	 *
	 * For formatted output (Mermaid / D2 / ASCII / pretty / JSON text), pass
	 * the snapshot to one of the pure renderers in
	 * `@graphrefly/graphrefly/extra/render`:
	 *
	 * ```ts
	 * import { graphSpecToMermaid, graphSpecToAscii } from "@graphrefly/graphrefly/extra/render";
	 *
	 * const mermaid = graphSpecToMermaid(graph.describe());
	 * const ascii = graphSpecToAscii(graph.describe(), { direction: "TD" });
	 * ```
	 *
	 * For live formatted output, compose with `derived`:
	 *
	 * ```ts
	 * import { derived } from "@graphrefly/graphrefly";
	 * import { graphSpecToMermaid } from "@graphrefly/graphrefly/extra/render";
	 *
	 * const live = derived(
	 *   [graph.describe({ reactive: true }).node],
	 *   ([g]) => graphSpecToMermaid(g),
	 * );
	 * ```
	 *
	 * For the spec projection (type + deps + meta, strip runtime status/value),
	 * pass `detail: "spec"`.
	 *
	 * @param options - Optional `actor` for guard-scoped visibility, `filter`
	 *   for selective output, `detail` / `fields` for projection, `reactive`
	 *   for the live handle.
	 *
	 * @example
	 * ```ts
	 * graph.describe()                                         // full snapshot object
	 * graph.describe({ filter: { status: "errored" } })        // filtered object
	 * graph.describe({ detail: "spec" })                       // GraphSpec projection
	 * graph.describe({ reactive: true })                       // live snapshot Node
	 * ```
	 */
	describe(
		options: GraphDescribeOptions & { reactive: "diff" },
	): ReactiveDescribeHandle<DescribeChangeset>;
	describe(
		options: GraphDescribeOptions & { reactive: true },
	): ReactiveDescribeHandle<GraphDescribeOutput>;
	describe(options?: GraphDescribeOptions): GraphDescribeOutput;
	/**
	 * Explain mode — causal-chain walkback from `from` to `to`. Wraps
	 * {@link explainPath}; previously a top-level `Graph.explain` method,
	 * folded into describe so all topology queries route through one entry
	 * point. Accepts the same Tier 3.5 reactive-arg carve-out (F.9) as the
	 * pre-fold method: `from`/`to`/`maxDepth`/`findCycle` may be Node-typed.
	 *
	 * Mutually exclusive with `detail`/`fields`/`filter`/`actor` and with
	 * `reachable` — the runtime throws `TypeError` on any conflict.
	 */
	describe(options: { explain: GraphDescribeExplainInput; reactive?: false }): CausalChain;
	describe(options: {
		explain: GraphDescribeExplainInput;
		reactive: true;
		reactiveName?: string;
		name?: string;
	}): { node: Node<CausalChain>; dispose: () => void };
	/**
	 * Reachable mode — sorted path list (or rich {@link ReachableResult}
	 * when `withDetail: true`) for the dep-walk rooted at `from`. Wraps the
	 * standalone {@link reachable} fn over `this.describe()`. Static-only
	 * (no reactive form); for live reachability compose
	 * `derived([describe({reactive: true}).node], (g) => reachable(g, ...))`.
	 *
	 * Mutually exclusive with `detail`/`fields`/`filter`/`actor` and with
	 * `explain` — the runtime throws `TypeError` on any conflict.
	 */
	describe(options: {
		reachable: GraphDescribeReachableInput & { withDetail: true };
	}): ReachableResult;
	describe(options: { reachable: GraphDescribeReachableInput & { withDetail?: false } }): string[];
	describe(
		options?:
			| GraphDescribeOptions
			| {
					explain: GraphDescribeExplainInput;
					reactive?: boolean;
					reactiveName?: string;
					name?: string;
			  }
			| { reachable: GraphDescribeReachableInput },
	):
		| GraphDescribeOutput
		| ReactiveDescribeHandle<unknown>
		| CausalChain
		| { node: Node<CausalChain>; dispose: () => void }
		| string[]
		| ReachableResult {
		// Explain / reachable mode dispatch (folded from former top-level
		// Graph.explain / Graph.reachable methods). Mutually exclusive with
		// the topology options below — A6 detail/fields exclusivity precedent.
		if (options != null && typeof options === "object") {
			const hasExplain = "explain" in options && (options as { explain?: unknown }).explain != null;
			const hasReachable =
				"reachable" in options && (options as { reachable?: unknown }).reachable != null;
			if (hasExplain || hasReachable) {
				if (hasExplain && hasReachable) {
					throw new TypeError(
						"Graph.describe(): pass either `explain` or `reachable`, not both. " +
							"They are mutually exclusive query modes.",
					);
				}
				const opts = options as Record<string, unknown>;
				for (const conflicting of ["detail", "fields", "filter", "actor"]) {
					if (opts[conflicting] !== undefined) {
						throw new TypeError(
							`Graph.describe(): \`${hasExplain ? "explain" : "reachable"}\` mode does ` +
								`not accept \`${conflicting}\` — those options shape the topology ` +
								"snapshot, not the query result. Pass them on a separate `describe()` call.",
						);
					}
				}
				if (hasExplain) {
					const ex = (options as { explain: GraphDescribeExplainInput }).explain;
					const reactive = (options as { reactive?: boolean }).reactive === true;
					if ((options as { reactive?: boolean | "diff" }).reactive === "diff") {
						throw new TypeError(
							'Graph.describe(): `explain` mode does not support `reactive: "diff"`. ' +
								"Use `reactive: true` for a live causal chain or omit `reactive` for a snapshot.",
						);
					}
					if (reactive) {
						const explainOpts: {
							maxDepth?: number | Node<number>;
							findCycle?: boolean | Node<boolean>;
							name?: string;
						} = {};
						if (ex.maxDepth !== undefined) explainOpts.maxDepth = ex.maxDepth;
						if (ex.findCycle !== undefined) explainOpts.findCycle = ex.findCycle;
						const nameOpt =
							(options as { name?: string; reactiveName?: string }).name ??
							(options as { reactiveName?: string }).reactiveName;
						if (nameOpt !== undefined) explainOpts.name = nameOpt;
						return this._explainReactive(ex.from, ex.to, explainOpts);
					}
					return this._explainStatic(resolveExplainPath(ex.from), resolveExplainPath(ex.to), {
						...(ex.maxDepth !== undefined ? { maxDepth: resolveExplainNumber(ex.maxDepth) } : {}),
						...(ex.findCycle !== undefined
							? { findCycle: resolveExplainBoolean(ex.findCycle) }
							: {}),
					});
				}
				// Reachable mode. Static-only — `reactive: true` and
				// `reactive: "diff"` are rejected; explicit `reactive: false`
				// and `reactive: undefined` are accepted as no-ops so callers
				// using spread-style defaults (`{ ...defaults, reachable: ... }`
				// where defaults may carry `reactive: false`) don't trip a
				// TypeError on the implicit-default value (qa BH1/EC8 — match
				// the explain-mode asymmetry where `reactive: false` is also
				// a no-op).
				const reachableReactive = (options as { reactive?: unknown }).reactive;
				if (reachableReactive === true || reachableReactive === "diff") {
					throw new TypeError(
						"Graph.describe(): `reachable` mode is static-only. For live reachability, " +
							"compose `derived([describe({ reactive: true }).node], (g) => reachable(g, ...))`.",
					);
				}
				const r = (options as { reachable: GraphDescribeReachableInput }).reachable;
				if (r.withDetail === true) {
					return reachable(this.describe(), r.from, r.direction, {
						...r,
						withDetail: true,
					});
				}
				return reachable(this.describe(), r.from, r.direction, r);
			}
		}
		const topologyOptions = options as GraphDescribeOptions | undefined;
		if (topologyOptions?.reactive === "diff") return this._describeReactiveDiff(topologyOptions);
		if (topologyOptions?.reactive === true) return this._describeReactive(topologyOptions);
		const actor = resolveActorOption(topologyOptions?.actor);
		const filter = topologyOptions?.filter;
		// `detail` and `fields` are mutually exclusive. Mixing them was
		// permissive at one point but produced ambiguous spec-mode semantics
		// (e.g. `{detail: "spec", fields: [...]}` had `isSpec: true` but
		// non-spec field projection — see review session findings A6).
		if (topologyOptions?.detail != null && topologyOptions?.fields != null) {
			throw new TypeError(
				"Graph.describe(): pass either `detail` or `fields`, not both. " +
					"`detail: 'spec'` is the canonical spec projection; " +
					"use `fields` only when you need a custom subset.",
			);
		}
		const includeFields = resolveDescribeFields(topologyOptions?.detail, topologyOptions?.fields);
		// `detail: "spec"` is the canonical spec-projection mode (Tier 1.5.3
		// Phase 1 — replaces the old `format: "spec"` alias). Strips
		// annotations from the output so the result round-trips through
		// GraphSpec via `decompileSpec`. Phase 3 also gates `value` to
		// state nodes only — passed to `describeNode` as the third arg.
		const isSpec = topologyOptions?.detail === "spec";
		const effectiveFields = includeFields;

		const targets: [string, Node][] = [];
		this._collectObserveTargets("", targets);
		const nodeToPath = new Map<Node, string>();
		for (const [p, n] of targets) {
			nodeToPath.set(n, p);
		}

		// Transitive-deps expansion. Factories like `promptNode` create
		// unnamed derived helpers (the `::messages` node, switchMap internals)
		// and only expose their terminal output via `graph.add`. Those helpers
		// still show up as real `_deps` pointers on their downstream consumer,
		// so without this walk `describe()` emits dangling path strings that
		// don't resolve to any entry in `.nodes` — breaking `explainPath` and
		// any other snapshot walker. Per COMPOSITION-GUIDE §24 ("edges are
		// derived, not declared — if describe shows an edge, there is a real
		// protocol subscription"), every dep surfaced as an edge must also be
		// described. This BFS walks upstream through `_deps` from every
		// registered member, assigns each orphan a stable path (from its
		// `meta.name` if unique, else `${name}#N`, else a synthetic
		// `__internal__/...` key), and feeds them to the existing describe
		// loop below.
		const additionalTargets: [string, Node][] = [];
		{
			const queue: Node[] = targets.map(([, n]) => n);
			const usedPaths = new Set(nodeToPath.values());
			let synthetic = 0;
			while (queue.length > 0) {
				const current = queue.shift() as Node;
				if (!(current instanceof NodeImpl)) continue;
				for (const dep of current._deps) {
					const dn = dep.node;
					if (nodeToPath.has(dn)) continue;
					// Assign a path. Prefer meta.name so the string matches the
					// dangling pointer that the consumer's `deps` already
					// showed — callers who previously saw `"brief::messages"`
					// in `deps[]` now find a matching entry under that key.
					const metaName = (dn as { name?: string }).name ?? "";
					let path = metaName;
					if (!path || usedPaths.has(path)) {
						if (metaName) {
							let n = 2;
							while (usedPaths.has(`${metaName}#${n}`)) n++;
							path = `${metaName}#${n}`;
						} else {
							path = `__internal__/${synthetic++}`;
							while (usedPaths.has(path)) path = `__internal__/${synthetic++}`;
						}
					}
					nodeToPath.set(dn, path);
					usedPaths.add(path);
					additionalTargets.push([path, dn]);
					queue.push(dn);
				}
			}
		}
		const allTargets: [string, Node][] = [...targets, ...additionalTargets];

		const nodes: Record<string, DescribeNodeOutput> = {};
		for (const [p, n] of allTargets) {
			if (actor != null && !n.allowsObserve(actor)) continue;
			const raw = describeNode(n, effectiveFields, isSpec);
			const deps =
				n instanceof NodeImpl
					? n._deps.map((d) => nodeToPath.get(d.node) ?? d.node.name ?? "")
					: [];
			const { name: _name, ...rest } = raw;
			const entry: DescribeNodeOutput = { ...rest, deps };
			// Attach annotation from `trace(path, annotation)` or from
			// `graph.add(node, { name: path, annotation })` when one exists. Skipped
			// for the `"spec"` format (input-schema use case — annotations
			// don't round-trip through GraphSpec).
			if (!isSpec) {
				const annotation = this._annotations.get(p);
				if (annotation != null) entry.annotation = annotation;
			}
			if (filter != null) {
				if (typeof filter === "function") {
					const fn = filter as
						| ((nodePath: string, node: DescribeNodeOutput) => boolean)
						| ((node: DescribeNodeOutput) => boolean);
					const pass =
						fn.length >= 2
							? (fn as (nodePath: string, node: DescribeNodeOutput) => boolean)(p, entry)
							: (fn as (node: DescribeNodeOutput) => boolean)(entry);
					if (!pass) continue;
				} else {
					let match = true;
					for (const [fk, fv] of Object.entries(filter)) {
						const normalizedKey =
							fk === "deps_includes" ? "depsIncludes" : fk === "meta_has" ? "metaHas" : fk;
						if (normalizedKey === "depsIncludes") {
							if (!entry.deps.includes(String(fv))) {
								match = false;
								break;
							}
							continue;
						}
						if (normalizedKey === "metaHas") {
							if (!Object.hasOwn(entry.meta ?? {}, String(fv))) {
								match = false;
								break;
							}
							continue;
						}
						if ((entry as Record<string, unknown>)[normalizedKey] !== fv) {
							match = false;
							break;
						}
					}
					if (!match) continue;
				}
			}
			nodes[p] = entry;
		}
		const nodeKeys = new Set(Object.keys(nodes));
		// Edges derived from node `_deps` over the expanded `nodeToPath` (so
		// transitive-deps entries — e.g. `brief::messages` — have edges to
		// their own upstream + from their downstream consumer, not just the
		// registered-member-only subset `this.edges({recursive: true})` would
		// give). Sorted to match the old contract.
		const edgeList: [string, string][] = [];
		for (const [path, n] of allTargets) {
			if (!(n instanceof NodeImpl)) continue;
			for (const dep of n._deps) {
				const from = nodeToPath.get(dep.node);
				if (from != null) edgeList.push([from, path]);
			}
		}
		edgeList.sort((a, b) =>
			a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
		);
		let edges: { from: string; to: string }[] = edgeList.map(([from, to]) => ({ from, to }));
		if (actor != null || filter != null) {
			edges = edges.filter((e) => nodeKeys.has(e.from) && nodeKeys.has(e.to));
		}
		const allSubgraphs = this._collectSubgraphs("");
		const subgraphs =
			actor != null || filter != null
				? allSubgraphs.filter((sg) => {
						const prefix = `${sg}${PATH_SEP}`;
						return [...nodeKeys].some((k) => k === sg || k.startsWith(prefix));
					})
				: allSubgraphs;

		// Capture graph ref and base options for expand()
		const graph = this;
		const baseOpts = topologyOptions;

		const struct: GraphDescribeOutput = {
			name: this.name,
			nodes,
			edges,
			subgraphs,
			...(this._factory !== undefined ? { factory: this._factory } : {}),
			...(this._factoryArgs !== undefined ? { factoryArgs: this._factoryArgs } : {}),
			expand(detailOrFields: DescribeDetail | DescribeField[]): GraphDescribeOutput {
				const merged: GraphDescribeOptions = { ...baseOpts };
				if (Array.isArray(detailOrFields)) {
					merged.fields = detailOrFields;
					merged.detail = undefined;
				} else {
					merged.detail = detailOrFields;
					merged.fields = undefined;
				}
				return graph.describe(merged);
			},
		};

		// Tier 2.1 A2: `format` option dropped — use the pure renderers in
		// `@graphrefly/graphrefly/extra/render` (`graphSpecToMermaid`,
		// `graphSpecToAscii`, `graphSpecToD2`, `graphSpecToPretty`,
		// `graphSpecToJson`, `graphSpecToMermaidUrl`) on the returned
		// snapshot, or compose
		// `derived([describe({reactive:true}).node], graphSpecToMermaid)` for
		// live formatted output.
		return struct;
	}

	private _collectSubgraphs(prefix: string): string[] {
		const out: string[] = [];
		for (const m of [...this._mounts.keys()].sort()) {
			const q = prefix === "" ? m : `${prefix}${m}`;
			out.push(q);
			out.push(...this._mounts.get(m)!._collectSubgraphs(`${q}${PATH_SEP}`));
		}
		return out;
	}

	/**
	 * Snapshot-based resource profile: per-node stats, orphan effect detection,
	 * memory hotspots. Zero runtime overhead — walks nodes on demand.
	 *
	 * @param opts - Optional `topN` for hotspot limit (default 10).
	 * @returns Aggregate profile with per-node details, hotspots, and orphan effects.
	 */
	resourceProfile(opts?: GraphProfileOptions): GraphProfileResult {
		return graphProfile(this, opts);
	}

	private _explainStatic(
		from: string,
		to: string,
		opts?: { maxDepth?: number; findCycle?: boolean },
	): CausalChain {
		// `detail: "full"` includes `value`, `status`, `lastMutation`, `v`, etc.
		// — everything `explainPath` enriches each step with.
		const described = this.describe({ detail: "full" });
		const annotations = new Map<string, string>(this._annotations);
		const lastMutations = new Map<string, Readonly<{ actor: Actor; timestamp_ns: number }>>();
		for (const [path, n] of Object.entries(described.nodes)) {
			if (n.lastMutation != null) lastMutations.set(path, n.lastMutation);
		}
		return explainPath(described, from, to, {
			...(opts?.maxDepth != null ? { maxDepth: opts.maxDepth } : {}),
			...(opts?.findCycle === true ? { findCycle: true as const } : {}),
			annotations,
			lastMutations,
		});
	}

	private _describeReactive(
		options: GraphDescribeOptions,
	): ReactiveDescribeHandle<GraphDescribeOutput> {
		// Strip the `reactive` flag so the inner recompute returns the
		// snapshot object, not another reactive handle.
		const innerOpts: GraphDescribeOptions = { ...options, reactive: false };
		const name = options.reactiveName ?? "describe";
		let v = 0;
		const version = node<number>([], { initial: v, name: `${name}_version` });
		const handle = this.observe({ timeline: true, structured: true });
		let pendingBump = false;
		let disposed = false;
		const bump = (): void => {
			if (pendingBump || disposed) return;
			pendingBump = true;
			// Same coalescer as _explainReactive (D5) — N events per batch → 1
			// recompute at head of next drain. Outside a batch the hook fires
			// immediately, preserving sync-wave behavior.
			registerBatchFlushHook(() => {
				pendingBump = false;
				if (disposed) return;
				v += 1;
				version.emit(v);
			});
		};
		const off = handle.onEvent((event) => {
			const t = event.type;
			if (t !== "data" && t !== "error" && t !== "complete" && t !== "teardown") return;
			bump();
		});

		// Describe must reflect the FULL subtree (`_collectSubgraphs` walks
		// mounted children), so the reactive variant subscribes to each
		// mounted graph's `topology` too — `topology` is own-graph only
		// per its JSDoc, so a parent's emitter never fires for structural
		// changes inside a child. Walk at subscribe time, then listen for
		// `added` events with `nodeKind: "mount"` to discover subgraphs that
		// land after subscription and subscribe transitively.
		const topoUnsubs: Array<() => void> = [];
		const subscribedGraphs = new WeakSet<Graph>();
		const subscribeToTopology = (g: Graph): void => {
			if (subscribedGraphs.has(g) || disposed) return;
			subscribedGraphs.add(g);
			const unsub = g.topology.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] !== DATA) continue;
					const event = m[1] as TopologyEvent;
					bump();
					// A newly-mounted child's own topology events won't surface
					// here — subscribe to it too. `added` is the only variant
					// that exposes a mount; `removed` drops the mount entirely
					// and disposes its internals.
					if (event.kind === "added" && event.nodeKind === "mount") {
						const child = g._mounts.get(event.name);
						if (child != null) subscribeToTopology(child);
					}
				}
			});
			topoUnsubs.push(unsub);
			// Seed with already-mounted children — topology does not replay
			// historical events to late subscribers (per §3.6).
			for (const childName of g._mounts.keys()) {
				const child = g._mounts.get(childName);
				if (child != null) subscribeToTopology(child);
			}
		};
		subscribeToTopology(this);

		// Reactive-actor binding (B.1 / Unit 6). When `options.actor` is a
		// `Node<Actor>`, subscribe to it and route DATA emits through the same
		// `bump()` coalescer as topology / observe events — so a coordinated
		// actor change + structural change still produces exactly one
		// recompute. The inner static `describe(innerOpts)` resolves the
		// actor's current cache on each recompute (via `resolveActorOption`),
		// so no per-recompute opts mutation is needed.
		//
		// On terminal types (`COMPLETE`/`ERROR`/`TEARDOWN`), release the
		// actor subscription and trigger one final `bump()` so describe
		// snapshots the last-known actor cache. Subsequent describe outputs
		// reflect that frozen cache until `handle.dispose()` runs.
		let actorUnsub: (() => void) | undefined;
		const actorOpt = options.actor;
		if (isActorNode(actorOpt)) {
			actorUnsub = actorOpt.subscribe((msgs) => {
				let sawData = false;
				let terminated = false;
				for (const m of msgs) {
					const t = m[0];
					if (t === DATA) sawData = true;
					else if (t === COMPLETE || t === ERROR || t === TEARDOWN) terminated = true;
				}
				if (sawData) bump();
				if (terminated) {
					actorUnsub?.();
					actorUnsub = undefined;
					bump();
				}
			});
		}

		let reactiveDescNode: Node<GraphDescribeOutput>;
		try {
			reactiveDescNode = node<GraphDescribeOutput>(
				[version],
				(_data, actions) => {
					actions.emit(this.describe(innerOpts) as GraphDescribeOutput);
				},
				{
					name,
					describeKind: "derived",
					meta: { domain: "audit", kind: "describe" } as const,
					// Reference-only equals is fine — describe() rebuilds a fresh
					// object every call. Users who want structural dedup can wrap
					// with their own derived + structural `equals`.
					equals: (a: GraphDescribeOutput, b: GraphDescribeOutput) => a === b,
				},
			);
		} catch (err) {
			off();
			actorUnsub?.();
			for (const u of topoUnsubs) u();
			handle.dispose();
			throw err;
		}
		const stopKeepalive = keepalive(reactiveDescNode);

		return {
			node: reactiveDescNode,
			dispose() {
				disposed = true;
				off();
				actorUnsub?.();
				for (const u of topoUnsubs) u();
				topoUnsubs.length = 0;
				handle.dispose();
				stopKeepalive();
			},
		};
	}

	/**
	 * Reactive topology-diff variant of `describe()`. Wraps `_describeReactive`'s
	 * snapshot stream and emits a `DescribeChangeset` per change, suppressing
	 * empty changesets. The initial cache is a synthetic full-add diff so a
	 * fresh subscriber sees the current topology as a single `node-added` /
	 * `edge-added` / `subgraph-mounted` payload via push-on-subscribe.
	 */
	private _describeReactiveDiff(
		options: GraphDescribeOptions,
	): ReactiveDescribeHandle<DescribeChangeset> {
		const innerOpts: GraphDescribeOptions = {
			...options,
			reactive: false,
		};
		const name = options.reactiveName ?? "describe-diff";

		// Synthetic empty snapshot — used as the "from" for the initial diff so
		// fresh subscribers see the current topology as adds via push-on-subscribe.
		const empty: GraphDescribeOutput = {
			name: this.name,
			nodes: {},
			edges: [],
			subgraphs: [],
		};
		let prev = this.describe(innerOpts) as GraphDescribeOutput;
		const initialDiff = topologyDiff(empty, prev);

		const diffNode = node<DescribeChangeset>([], {
			initial: initialDiff,
			name,
			meta: { domain: "audit", kind: "describe-diff" } as const,
			// Reference equals — every changeset is a fresh object; downstream
			// consumers wanting structural dedup wrap with their own equals.
			equals: (a: DescribeChangeset, b: DescribeChangeset) => a === b,
		});

		// Reuse `_describeReactive` for the bump-on-topology-change machinery
		// (topology subscription, observe-driven recompute, actor binding,
		// batch-flush coalescing). Strip `reactiveName` so the snapshot node
		// gets a default name; we own `name` for the diff node.
		const snapshotHandle = this._describeReactive({
			...options,
			reactiveName: undefined,
		});

		let disposed = false;
		const unsub = snapshotHandle.node.subscribe((msgs) => {
			if (disposed) return;
			for (const m of msgs) {
				if (m[0] !== DATA) continue;
				const next = m[1] as GraphDescribeOutput;
				const changeset = topologyDiff(prev, next);
				prev = next;
				// Suppress empty changesets — consumers should not see no-op DATA.
				if (changeset.events.length === 0) continue;
				diffNode.emit(changeset);
			}
		});

		const stopKeepalive = keepalive(diffNode);

		return {
			node: diffNode,
			dispose() {
				disposed = true;
				unsub();
				snapshotHandle.dispose();
				// QA F10: settle `diffNode` with TEARDOWN so downstream
				// subscribers receive a terminal — was previously stuck waiting
				// indefinitely after dispose() since cleanup only released
				// internal subs.
				diffNode.down([[TEARDOWN, "describe-diff disposed"]]);
				stopKeepalive();
			},
		};
	}

	private _explainReactive(
		from: string | Node<string>,
		to: string | Node<string>,
		opts?: {
			maxDepth?: number | Node<number>;
			findCycle?: boolean | Node<boolean>;
			name?: string;
		},
	): { node: Node<CausalChain>; dispose: () => void } {
		// Closure-held version counter (COMPOSITION-GUIDE §28 / spec §3.6
		// sanctioned pattern). Every settled observe event bumps `v`, which
		// drives the derived to recompute.
		//
		// Debouncing (D5): without coalescing, each of N graph events inside an
		// outer batch produces N version bumps — the derived's equals dedupes the
		// steady state, but the recompute work amplifies with graph traffic.
		// `registerBatchFlushHook` defers the single bump to the head of the
		// outermost drain, so N events in one batch collapse to exactly one
		// recompute. Outside a batch the hook fires immediately (see
		// `registerBatchFlushHook` contract) — no change to sync-wave behavior.
		let v = 0;
		const version = node<number>([], { initial: v, name: "explain_version" });
		const handle = this.observe({ timeline: true, structured: true });
		let pendingBump = false;
		let disposed = false;
		const bump = (): void => {
			if (pendingBump || disposed) return;
			pendingBump = true;
			registerBatchFlushHook(() => {
				pendingBump = false;
				if (disposed) return;
				v += 1;
				version.emit(v);
			});
		};
		const off = handle.onEvent((event) => {
			const t = event.type;
			if (t !== "data" && t !== "error" && t !== "complete" && t !== "teardown") return;
			bump();
		});

		// Tier 3.5 (F.9 reactive primitive carve-out): collect reactive args so
		// the derived can gate its first emit until they all settle, AND so an
		// emission bumps the version counter through the same coalescer. Static
		// args pass through with no subscription. Mirrors the `Node<Actor>`
		// subscription wired in `_describeReactive`.
		//
		// Subscriptions are wired AFTER `derived(...) + keepalive(node)` below
		// (memory feedback_subscribe_before_kick) — wiring before would mean a
		// push-on-subscribe DATA bumps version while no one is subscribed to it
		// yet, and although state's cache holds the value, the explicit ordering
		// matches the established actor precedent (`_describeReactive`).
		const reactiveArgs: Array<Node<unknown>> = [];
		if (from != null && isExplainArgNode<string>(from)) reactiveArgs.push(from as Node<unknown>);
		if (to != null && isExplainArgNode<string>(to)) reactiveArgs.push(to as Node<unknown>);
		if (opts?.maxDepth != null && isExplainArgNode<number>(opts.maxDepth))
			reactiveArgs.push(opts.maxDepth as Node<unknown>);
		if (opts?.findCycle != null && isExplainArgNode<boolean>(opts.findCycle))
			reactiveArgs.push(opts.findCycle as Node<unknown>);

		// Gate first emit until every reactive arg has settled. Without this,
		// an unsettled `Node<string>` for `from` would resolve to `""` (via
		// `resolveExplainPath` cache fallback) and `_explainStatic` would emit
		// a noise `{found:false, reason:"no source"}` chain BEFORE the first
		// real arg DATA. The regression matches the deleted `reactiveExplainPath`
		// behavior more closely (it never observed an unsettled arg).
		const allReactiveArgsSettled = (): boolean => {
			for (const arg of reactiveArgs) {
				if (arg.cache === undefined) return false;
			}
			return true;
		};
		// Sentinel chain returned while waiting for reactive args — equals()
		// dedupes repeated settled states once arg DATA arrives. The
		// `"pending"` reason was added to CausalChain's reason union for
		// this case (qa D5).
		const buildPendingChain = (): CausalChain => {
			const f = resolveExplainPath(from);
			const t = resolveExplainPath(to);
			return {
				from: f,
				to: t,
				found: false,
				reason: "pending",
				steps: [],
				text: "(awaiting reactive args)",
				toJSON: () => ({ from: f, to: t, found: false, reason: "pending", steps: [] }),
			};
		};

		// Try to construct the reactive derived; if it throws (invalid options
		// etc.), release the observe handle + onEvent listener so we don't
		// leak resources. Nominal path: push the try-catch out-of-band.
		//
		// Resolve reactive args INSIDE the fn so each recompute reads the
		// latest cache. Static args close over directly.
		let explainNode: Node<CausalChain>;
		try {
			explainNode = node<CausalChain>(
				[version],
				(_data, actions) => {
					if (!allReactiveArgsSettled()) {
						actions.emit(buildPendingChain());
					} else {
						const currentFrom = resolveExplainPath(from);
						const currentTo = resolveExplainPath(to);
						const currentOpts = {
							...(opts?.maxDepth !== undefined
								? { maxDepth: resolveExplainNumber(opts.maxDepth) }
								: {}),
							...(opts?.findCycle !== undefined
								? { findCycle: resolveExplainBoolean(opts.findCycle) }
								: {}),
						};
						actions.emit(this._explainStatic(currentFrom, currentTo, currentOpts));
					}
				},
				{
					name: opts?.name ?? "explain",
					describeKind: "derived",
					meta: {
						domain: "audit",
						kind: "explain_path",
						from: resolveExplainPath(from),
						to: resolveExplainPath(to),
					} as const,
					equals: (a: CausalChain, b: CausalChain) =>
						a.found === b.found &&
						a.reason === b.reason &&
						a.steps.length === b.steps.length &&
						causalStepsEqual(a.steps, b.steps),
				},
			);
		} catch (err) {
			off();
			handle.dispose();
			throw err;
		}
		const stopKeepalive = keepalive(explainNode);

		// Now wire reactive-arg subscriptions (after derived + keepalive). Each
		// subscription holder is captured so the terminal handler can self-clear
		// (matches `_describeReactive`'s actor-handler precedent: drop the unsub
		// once the arg is terminal because `arg.cache` is frozen at the last
		// settled value and subsequent recomputes still see it).
		const argUnsubs: Array<(() => void) | undefined> = [];
		const subscribeReactiveArg = (arg: Node<unknown>): (() => void) => {
			let unsub: (() => void) | undefined;
			unsub = arg.subscribe((msgs) => {
				let sawData = false;
				let terminated = false;
				for (const m of msgs) {
					const t = m[0];
					if (t === DATA) sawData = true;
					else if (t === COMPLETE || t === ERROR || t === TEARDOWN) terminated = true;
				}
				// Single bump per wave — covers DATA, terminal, or both.
				if (sawData || terminated) bump();
				if (terminated && unsub) {
					unsub();
					unsub = undefined;
				}
			});
			return () => {
				if (unsub) {
					unsub();
					unsub = undefined;
				}
			};
		};
		for (const arg of reactiveArgs) argUnsubs.push(subscribeReactiveArg(arg));

		return {
			node: explainNode,
			dispose() {
				disposed = true;
				off();
				for (const u of argUnsubs) u?.();
				argUnsubs.length = 0;
				handle.dispose();
				stopKeepalive();
			},
		};
	}

	/**
	 * @internal Collect all qualified paths in this graph tree matching a
	 * glob pattern. Used by scoped autoCheckpoint subscription.
	 */
	private _pathsMatching(glob: string): string[] {
		const re = globToRegex(glob);
		const targets: [string, Node][] = [];
		this._collectObserveTargets("", targets);
		return targets.map(([p]) => p).filter((p) => re.test(p));
	}

	private _collectObserveTargets(prefix: string, out: [string, Node][]): void {
		for (const m of [...this._mounts.keys()].sort()) {
			const p2 = prefix === "" ? m : `${prefix}${PATH_SEP}${m}`;
			this._mounts.get(m)!._collectObserveTargets(p2, out);
		}
		for (const loc of [...this._nodes.keys()].sort()) {
			const n = this._nodes.get(loc)!;
			const p = prefix === "" ? loc : `${prefix}${PATH_SEP}${loc}`;
			out.push([p, n]);
			this._appendMetaObserveTargets(p, n, out);
		}
	}

	private _appendMetaObserveTargets(basePath: string, n: Node, out: [string, Node][]): void {
		for (const mk of Object.keys(n.meta).sort()) {
			const m = n.meta[mk];
			const mp = `${basePath}${PATH_SEP}${GRAPH_META_SEGMENT}${PATH_SEP}${mk}`;
			out.push([mp, m]);
			this._appendMetaObserveTargets(mp, m, out);
		}
	}

	/**
	 * Live message stream from one node (or meta path), or from the whole graph (§3.6).
	 *
	 * Two modes dispatched on first argument:
	 * - `observe(path, options?)` — one node. Returns {@link GraphObserveOne}
	 *   (raw stream), or {@link ObserveResult} when `options` requests structured
	 *   accumulation (`structured`, `timeline`, `causal`, `derived`, `format`,
	 *   `detail: "minimal"|"full"`).
	 * - `observe(options?)` — all nodes. Returns {@link GraphObserveAll} (raw),
	 *   or {@link ObserveResult} under the same structured trigger conditions.
	 *
	 * Structured mode subscribes in sorted path order (code-point). Inspector
	 * extras (`causal`/`derived`) require `graph.config.inspectorEnabled`;
	 * when disabled, those fields silently drop and the rest still works.
	 *
	 * `ObserveResult` is also an `AsyncIterable<ObserveEvent>` — use
	 * `for await (const ev of result)` for pull-based consumption.
	 *
	 * **Reactive variants:**
	 * - `observe({ reactive: true })` — returns `Node<ObserveChangeset>`,
	 *   coalescing all observed events for one outermost batch flush into a
	 *   single `ObserveChangeset` DATA wave.
	 * - `observe({ changeset: true })` — returns `Node<GraphChange>`, emitting
	 *   one DATA per discrete change (data flow + topology + batch boundaries)
	 *   with edge attribution (`fromPath` + `fromDepIndex`) on each `data`
	 *   event. Designed as the input layer for `topologyView` (D2 — Three-
	 *   layer view, see `docs/optimizations.md`). Mutually exclusive with
	 *   `reactive: true`.
	 */
	observe(path: string, options: ObserveOptions & { changeset: true }): Node<GraphChange>;
	observe(options: ObserveOptions & { changeset: true }): Node<GraphChange>;
	observe(path: string, options: ObserveOptions & { reactive: true }): Node<ObserveChangeset>;
	observe(options: ObserveOptions & { reactive: true }): Node<ObserveChangeset>;
	observe(path: string, options?: ObserveOptions & StructuredTriggers): ObserveResult;
	observe(path: string, options?: ObserveOptions): GraphObserveOne;
	observe(options: ObserveOptions & StructuredTriggers): ObserveResult;
	observe(options?: ObserveOptions): GraphObserveAll;
	observe(
		pathOrOpts?: string | ObserveOptions,
		options?: ObserveOptions,
	):
		| GraphObserveOne
		| GraphObserveAll
		| ObserveResult
		| Node<ObserveChangeset>
		| Node<GraphChange> {
		const isPath = typeof pathOrOpts === "string";
		const rawOpts = isPath ? options : (pathOrOpts as ObserveOptions | undefined);
		const resolved = resolveObserveDetail(rawOpts);
		// Changeset variant — discrete `GraphChange` events with edge
		// attribution + topology + batch boundaries. Disjoint from
		// `reactive: true` (different stream shape).
		if (resolved.changeset === true) {
			if (resolved.reactive === true) {
				throw new TypeError(
					"Graph.observe(): `changeset: true` and `reactive: true` are mutually exclusive — pick one stream shape.",
				);
			}
			return this._observeChangeset(isPath ? (pathOrOpts as string) : undefined, resolved);
		}
		// Reactive variant — coalesces all observed events for a batch into one
		// `ObserveChangeset` DATA per batch flush. Auto-uses the structured
		// observer for {@link ObserveEvent} access; tier filter (if set) applies.
		if (resolved.reactive === true) {
			return this._observeReactive(isPath ? (pathOrOpts as string) : undefined, resolved);
		}
		const wantsStructured =
			resolved.structured === true ||
			resolved.timeline === true ||
			resolved.causal === true ||
			resolved.derived === true ||
			resolved.detail === "minimal" ||
			resolved.detail === "full" ||
			resolved.format != null;
		const actor = resolved.actor;

		if (isPath) {
			const path = pathOrOpts as string;
			const target = this.resolve(path);
			if (actor != null && !target.allowsObserve(actor)) {
				throw new GuardDenied({ actor, action: "observe", nodeName: path });
			}
			if (wantsStructured) return this._buildStructuredObserver([[path, target]], resolved, "one");
			return {
				subscribe(sink: NodeSink) {
					return target.subscribe(sink);
				},
				up(messages: Messages) {
					try {
						target.up?.(messages);
					} catch (err) {
						if (err instanceof GuardDenied) return;
						throw err;
					}
				},
			};
		}

		const collected: [string, Node][] = [];
		this._collectObserveTargets("", collected);
		collected.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
		const picked =
			actor == null ? collected : collected.filter(([, nd]) => nd.allowsObserve(actor));
		if (wantsStructured) return this._buildStructuredObserver(picked, resolved, "all");
		return {
			subscribe: (sink: (nodePath: string, messages: Messages) => void) => {
				const unsubs = picked.map(([p, nd]) =>
					nd.subscribe((msgs) => {
						sink(p, msgs);
					}),
				);
				return () => {
					for (const u of unsubs) u();
				};
			},
			up: (upPath: string, messages: Messages) => {
				try {
					const nd = this.resolve(upPath);
					nd.up?.(messages);
				} catch (err) {
					if (err instanceof GuardDenied) return;
					throw err;
				}
			},
		};
	}

	/**
	 * Reactive observe variant — wraps the structured observer and emits one
	 * `ObserveChangeset` DATA per outermost batch flush, with all observed
	 * events for that flush coalesced into a single envelope. Tier filter
	 * (`options.tiers`) drops out-of-scope events before accumulation.
	 *
	 * Cleanup is producer-bound: the structured observer is torn down when the
	 * last consumer of the returned node unsubscribes.
	 */
	private _observeReactive(
		path: string | undefined,
		options: ObserveOptions,
	): Node<ObserveChangeset> {
		const tiers = options.tiers;
		const tierSet = tiers != null ? new Set(tiers) : null;
		const name = options.reactiveName ?? "observe";

		return node<ObserveChangeset>(
			(_data, actions) => {
				const events: ObserveEvent[] = [];
				let pendingFlush = false;
				let disposed = false;

				const flush = (): void => {
					if (events.length === 0 || disposed) return;
					const changeset: ObserveChangeset = {
						events: events.slice(),
						flushedAt_ns: monotonicNs(),
					};
					events.length = 0;
					actions.emit(changeset);
				};

				// Strip `reactive` so we get a structured ObserveResult, not
				// recursion into ourselves. Force `timeline: true` so events
				// carry timestamps for downstream tooling, and `structured: true`
				// so we get an `ObserveResult` with `onEvent`.
				// QA F12: tier filter is applied at the inner `recordEvent`
				// funnel — keep `tiers` in `obsOpts` and DROP the redundant
				// outer-listener filter (was double-filtering).
				const obsOpts: ObserveOptions = {
					...options,
					reactive: false,
					structured: true,
					timeline: true,
				};
				// `obsOpts.structured: true` forces the structured-observer path,
				// which returns `ObserveResult`. The signature dispatch can't
				// narrow on runtime values, so cast through `unknown`.
				const handle =
					path != null
						? (this.observe(path, obsOpts) as unknown as ObserveResult)
						: (this.observe(obsOpts) as unknown as ObserveResult);

				const onEventListener = (event: ObserveEvent): void => {
					if (disposed) return;
					events.push(event);
					if (pendingFlush) return;
					pendingFlush = true;
					registerBatchFlushHook(() => {
						pendingFlush = false;
						flush();
					});
				};

				// QA F2: replay any events the inner structured observer already
				// captured before our listener attached (push-on-subscribe DATA
				// from cached state nodes lands in `handle.events` synchronously
				// during the `this.observe` call above). Drain through the same
				// listener so the first changeset includes them.
				for (const ev of handle.events) onEventListener(ev);
				const off = handle.onEvent(onEventListener);
				// Tier filter is unused at this layer (handled by inner
				// `recordEvent`), but retain the closure-scoped `tierSet` so
				// future per-listener filtering is one move away.
				void tierSet;

				return () => {
					disposed = true;
					off();
					handle.dispose();
				};
			},
			{
				name,
				describeKind: "producer",
				meta: { domain: "audit", kind: "observe-reactive" } as const,
			},
		);
	}

	/**
	 * Tier 1.5.D2 — discrete `GraphChange` stream.
	 *
	 * Returns a `Node<GraphChange>` that emits one DATA per change event.
	 * Variants:
	 * - **Core data flow** — `data` (with `fromPath`/`fromDepIndex`),
	 *   `dirty`, `resolved`, `error`, `complete`, `teardown`. Sourced from
	 *   per-node subscriptions over the picked observe targets.
	 * - **Topology** — `node-added`, `node-removed`, `mount`, `unmount`.
	 *   Sourced from `watchTopologyTree` — covers transitive nested mounts.
	 * - **Batch boundaries** — `batch-start` / `batch-end` wrap each
	 *   delivery wave (the per-`(msgs)` sink callback). Inside an explicit
	 *   `batch(() => …)`, the runtime delivers each upstream node's
	 *   coalesced multi-message batch as one wave; each such wave gets one
	 *   batch-start / batch-end pair on this stream. Outside a batch (sync
	 *   single-emit path), no boundary events fire.
	 *
	 * `version` is a per-stream monotonic counter (sourced via the V0 version
	 * convention from `core/versioning.ts`). `timestamp_ns` is from
	 * `core/clock.ts` `monotonicNs()`. `scope` is the qualified path the change
	 * applies to; for batch boundaries, `scope = ""` (graph-level).
	 *
	 * Cleanup is producer-bound: every per-node subscription + the topology
	 * watcher tear down when the last consumer of the returned node
	 * unsubscribes.
	 */
	private _observeChangeset(path: string | undefined, options: ObserveOptions): Node<GraphChange> {
		const name = options.changesetName ?? "observe-changeset";
		const tierSet = options.tiers != null ? new Set(options.tiers) : null;
		// Subscribe directly to picked targets (no inner structured observer)
		// so the per-target sink callback boundary defines a delivery wave —
		// each wave gets exactly one batch-start / batch-end pair. Topology
		// events flow through `watchTopologyTree`, which surfaces the same
		// per-emission boundary via the topology producer's own sink.
		return node<GraphChange>(
			(_data, actions) => {
				let disposed = false;
				let version = 0;
				const stamp = (
					scope: string,
				): { version: number; timestamp_ns: number; scope: string } => ({
					version: version++,
					timestamp_ns: monotonicNs(),
					scope,
				});

				type Envelope = { version: number; timestamp_ns: number; scope: string };

				const emitNow = (build: (env: Envelope) => GraphChange, scope: string): void => {
					if (disposed) return;
					actions.emit(build(stamp(scope)));
				};

				const inTier = (type: GraphChange["type"]): boolean =>
					tierSet == null || tierSet.has(type as ObserveEvent["type"]);

				/**
				 * Wrap a sink-loop body in a batch-start/batch-end pair when the
				 * current call site is batching (`isBatching()` true), otherwise
				 * deliver synchronously without boundary events. The body runs
				 * once and emits zero or more events via `emitOne`.
				 */
				const wrapWave = (body: (emitOne: typeof emitNow) => void): void => {
					if (disposed) return;
					if (!isBatching()) {
						body(emitNow);
						return;
					}
					let opened = false;
					const open = (): void => {
						if (opened) return;
						opened = true;
						emitNow((env) => ({ type: "batch-start", ...env }) satisfies GraphChangeBatchStart, "");
					};
					const wrappedEmit = (build: (env: Envelope) => GraphChange, scope: string): void => {
						if (disposed) return;
						open();
						emitNow(build, scope);
					};
					body(wrappedEmit);
					if (opened) {
						emitNow((env) => ({ type: "batch-end", ...env }) satisfies GraphChangeBatchEnd, "");
					}
				};

				// ---- Build the observe-target reverse index for `fromPath`
				// resolution. Walk the same tree the structured observer walks
				// (sorted, with nested mount prefixes). The map is rebuilt only
				// at activation time — for fully dynamic upstream attribution
				// we fall back to `node.name` when the upstream isn't a known
				// observe target (e.g. an internal sub-node from a factory).
				const targets: [string, Node][] = [];
				this._collectObserveTargets("", targets);
				const nodeToPath = new WeakMap<Node, string>();
				for (const [p, nd] of targets) nodeToPath.set(nd, p);

				const actor = options.actor;
				const picked =
					actor == null ? targets : targets.filter(([, nd]) => nd.allowsObserve(actor));
				const filteredByPath: [string, Node][] =
					path != null ? picked.filter(([p]) => p === path) : picked;

				// Inspector hooks (causal trace) — mirror the structured
				// observer's `attachInspector` to capture `trigger_dep_index`
				// per data emission.
				const inspectorOn = this.config.inspectorEnabled;
				const lastTriggerDepIndex = new Map<Node, number>();
				const inspectorDetaches: Array<() => void> = [];
				if (inspectorOn) {
					for (const [, target] of filteredByPath) {
						if (!(target instanceof NodeImpl)) continue;
						const detach = target._setInspectorHook((ev) => {
							if (ev.kind === "dep_message") {
								lastTriggerDepIndex.set(target, ev.depIndex);
							}
						});
						inspectorDetaches.push(detach);
					}
				}

				const unsubs: Array<() => void> = [];
				for (const [targetPath, target] of filteredByPath) {
					unsubs.push(
						target.subscribe((msgs) => {
							if (disposed) return;
							wrapWave((emitOne) => {
								for (const m of msgs) {
									const t = m[0];
									if (t === DATA) {
										if (!inTier("data")) continue;
										const triggerIdx =
											target instanceof NodeImpl ? lastTriggerDepIndex.get(target) : undefined;
										let fromPath = targetPath;
										let fromDepIndex = -1;
										if (
											target instanceof NodeImpl &&
											triggerIdx != null &&
											triggerIdx >= 0 &&
											triggerIdx < target._deps.length
										) {
											const upstream = target._deps[triggerIdx]?.node;
											fromDepIndex = triggerIdx;
											if (upstream != null) {
												fromPath = nodeToPath.get(upstream) ?? upstream.name ?? targetPath;
											}
										}
										const attribution =
											target instanceof NodeImpl
												? (target.lastMutation?.actor ?? DEFAULT_ACTOR)
												: DEFAULT_ACTOR;
										const value = m[1];
										emitOne(
											(env): GraphChangeData => ({
												type: "data",
												value,
												fromPath,
												fromDepIndex,
												actor: attribution,
												...env,
											}),
											targetPath,
										);
									} else if (t === DIRTY) {
										if (!inTier("dirty")) continue;
										emitOne((env): GraphChangeDirty => ({ type: "dirty", ...env }), targetPath);
									} else if (t === RESOLVED) {
										if (!inTier("resolved")) continue;
										emitOne(
											(env): GraphChangeResolved => ({ type: "resolved", ...env }),
											targetPath,
										);
									} else if (t === ERROR) {
										if (!inTier("error")) continue;
										const attribution =
											target instanceof NodeImpl
												? (target.lastMutation?.actor ?? DEFAULT_ACTOR)
												: DEFAULT_ACTOR;
										const errVal = m[1];
										emitOne(
											(env): GraphChangeError => ({
												type: "error",
												error: errVal,
												actor: attribution,
												...env,
											}),
											targetPath,
										);
									} else if (t === COMPLETE) {
										if (!inTier("complete")) continue;
										emitOne(
											(env): GraphChangeComplete => ({ type: "complete", ...env }),
											targetPath,
										);
									} else if (t === TEARDOWN) {
										if (!inTier("teardown")) continue;
										emitOne(
											(env): GraphChangeTeardown => ({ type: "teardown", ...env }),
											targetPath,
										);
									}
									// PAUSE / RESUME / INVALIDATE: reserved future
									// variants — current implementation skips them.
								}
							});
						}),
					);
				}

				// ---- Topology events via watchTopologyTree ----
				// Transitive: covers the root graph + every mounted child
				// (including children mounted/unmounted dynamically). Names
				// arrive as `event.name`; `prefix` is the qualified prefix
				// from the root, so `prefix + name` is the full scope path.
				const offTopology = watchTopologyTree(this, (event, _emitter, prefix) => {
					if (disposed) return;
					const qualified = `${prefix}${event.name}`;
					wrapWave((emitOne) => {
						if (event.kind === "added") {
							if (event.nodeKind === "node") {
								emitOne((env): GraphChangeNodeAdded => ({ type: "node-added", ...env }), qualified);
							} else {
								emitOne((env): GraphChangeMount => ({ type: "mount", ...env }), qualified);
							}
						} else {
							if (event.nodeKind === "node") {
								emitOne(
									(env): GraphChangeNodeRemoved => ({ type: "node-removed", ...env }),
									qualified,
								);
							} else {
								emitOne((env): GraphChangeUnmount => ({ type: "unmount", ...env }), qualified);
							}
						}
					});
				});

				return () => {
					disposed = true;
					for (const u of unsubs) u();
					for (const d of inspectorDetaches) d();
					offTopology();
				};
			},
			{
				name,
				describeKind: "producer",
				meta: { domain: "audit", kind: "observe-changeset" } as const,
			},
		);
	}

	/** Dispatch helper — builds a unified observer + its expand closure. */
	private _buildStructuredObserver<T>(
		targets: ReadonlyArray<[string, Node]>,
		options: ObserveOptions,
		mode: "one" | "all",
	): ObserveResult<T> {
		const firstPath = mode === "one" ? targets[0]?.[0] : undefined;
		const expand = (merged: ObserveOptions): ObserveResult<T> => {
			if (mode === "one" && firstPath != null) {
				const target = this.resolve(firstPath);
				return this._buildStructuredObserver([[firstPath, target]], merged, "one");
			}
			const collected: [string, Node][] = [];
			this._collectObserveTargets("", collected);
			collected.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
			const actor = merged.actor;
			const picked =
				actor == null ? collected : collected.filter(([, nd]) => nd.allowsObserve(actor));
			return this._buildStructuredObserver(picked, merged, "all");
		};
		return this._createObserveResult<T>(targets, options, expand);
	}

	/**
	 * Unified observer builder — replaces the four ex-creators
	 * (`_createObserveResult` / `...ForAll` / `_createFallback…`). Accepts a
	 * list of `[path, node]` targets (single-element for one-node observe,
	 * N-element for all-nodes). Inspector hooks attach per-target when
	 * `causal`/`derived` requested AND `config.inspectorEnabled`; otherwise
	 * those fields gracefully drop.
	 *
	 * Events flow through a `recordEvent()` helper so the format logger,
	 * ring-buffer, and async-iterable hooks all share one push path.
	 */
	private _createObserveResult<T>(
		targets: ReadonlyArray<[string, Node]>,
		options: ObserveOptions,
		expand: (merged: ObserveOptions) => ObserveResult<T>,
	): ObserveResult<T> {
		const timeline = options.timeline === true;
		const causal = options.causal === true;
		const derived = options.derived === true;
		const minimal = options.detail === "minimal";
		const inspectorOn = this.config.inspectorEnabled;
		const wantInspector = (causal || derived) && inspectorOn;

		// Event buffer: unbounded array, or RingBuffer when maxEvents capped.
		const maxEvents = options.maxEvents;
		const ring =
			maxEvents != null && maxEvents > 0 ? new RingBuffer<ObserveEvent>(maxEvents) : null;
		const events: ObserveEvent[] = [];

		// Listener set — format logger, async iterable, and user `onEvent` hooks.
		const listeners = new Set<(event: ObserveEvent) => void>();

		// Tier filter (Tier 1.5.2 — Session A.4 lock). When set, events whose
		// `type` is not in the set are dropped before they hit the events buffer
		// or any listener — applies uniformly to the structured callback,
		// `events` array, async iterable, and format logger.
		const tierSet = options.tiers != null ? new Set(options.tiers) : null;

		const values: Record<string, T> = {};
		const nodeErrored = new Set<string>();
		let dirtyCount = 0;
		let resolvedCount = 0;
		let invalidateCount = 0;
		let pauseCount = 0;
		let resumeCount = 0;
		let teardownCount = 0;
		let anyCompletedCleanly = false;
		let anyErrored = false;
		let batchSeq = 0;

		// Per-target causal context (keyed by target index).
		const lastTriggerDepIndex = new Map<Node, number>();
		const lastRunDepValues = new Map<Node, readonly unknown[]>();
		const lastRunDepBatches = new Map<Node, ReadonlyArray<ReadonlyArray<unknown> | undefined>>();

		const recordEvent = (event: ObserveEvent): void => {
			if (tierSet != null && !tierSet.has(event.type)) return;
			if (ring) ring.push(event);
			else events.push(event);
			for (const listener of listeners) listener(event);
		};

		// QA F3: tier filter applies to counters too — `dirtyCount`, `resolvedCount`,
		// `anyErrored`, etc. would otherwise reflect full-stream traffic regardless
		// of `tiers: [...]`. With this helper, counters and event buffer stay
		// coherent.
		const inTier = (name: ObserveEvent["type"]): boolean => tierSet == null || tierSet.has(name);

		const baseMeta = (): Partial<ObserveEventBase> =>
			timeline ? { timestamp_ns: monotonicNs(), in_batch: isBatching(), batch_id: batchSeq } : {};

		const attachInspector = (target: Node, path: string): (() => void) | undefined => {
			if (!wantInspector || !(target instanceof NodeImpl)) return undefined;
			return target._setInspectorHook((ev) => {
				if (ev.kind === "dep_message") {
					lastTriggerDepIndex.set(target, ev.depIndex);
				} else if (ev.kind === "run") {
					const effective = ev.batchData.map((b, i) =>
						b != null && b.length > 0 ? b.at(-1) : ev.prevData[i],
					);
					lastRunDepValues.set(target, effective);
					// Snapshot the full per-dep batches so multi-value waves stay
					// visible to observers. `ev.batchData` references run-local
					// arrays, so clone the outer array (inner arrays are
					// effectively immutable from the observer's POV).
					const batches: ReadonlyArray<ReadonlyArray<unknown> | undefined> = ev.batchData.map(
						(b) => (b != null ? [...b] : undefined),
					);
					lastRunDepBatches.set(target, batches);
					if (derived) {
						recordEvent({
							type: "derived",
							path,
							dep_values: effective,
							dep_batches: batches,
							...baseMeta(),
						} as ObserveEvent);
					}
				}
			});
		};

		const buildCausal = (target: Node): ObserveCausalContext => {
			const idx = lastTriggerDepIndex.get(target);
			const depValues = lastRunDepValues.get(target);
			if (!causal || depValues == null) return {};
			const triggerDep =
				idx != null && idx >= 0 && target instanceof NodeImpl ? target._deps[idx] : undefined;
			const triggerNode = triggerDep?.node;
			const tv = triggerNode?.v;
			const depBatches = lastRunDepBatches.get(target);
			return {
				trigger_dep_index: idx,
				trigger_dep_name: triggerNode?.name,
				...(tv != null ? { trigger_version: { id: tv.id, version: tv.version } } : {}),
				dep_values: [...depValues],
				...(depBatches != null ? { dep_batches: depBatches } : {}),
			};
		};

		const inspectorDetaches: Array<() => void> = [];
		const unsubs: Array<() => void> = [];
		for (const [path, target] of targets) {
			const detach = attachInspector(target, path);
			if (detach) inspectorDetaches.push(detach);
			unsubs.push(
				target.subscribe((msgs) => {
					batchSeq++;
					for (const m of msgs) {
						const t = m[0];
						const base = baseMeta();
						if (t === DATA) {
							// `values` is updated regardless of tier filter — it
							// reflects the latest cache snapshot, which is a
							// data-flow observation independent of event scoping.
							values[path] = m[1] as T;
							// B9: thread attribution onto the event so audit
							// consumers can evaluate policy against every
							// write. Unattributed writes stamp DEFAULT_ACTOR.
							const attr =
								target instanceof NodeImpl
									? (target.lastMutation?.actor ?? DEFAULT_ACTOR)
									: DEFAULT_ACTOR;
							recordEvent({
								type: "data",
								path,
								data: m[1],
								actor: attr,
								...base,
								...buildCausal(target),
							} as ObserveEvent);
						} else if (minimal) {
							// QA F3: tier-filter counters too.
							if (t === DIRTY) {
								if (inTier("dirty")) dirtyCount++;
							} else if (t === RESOLVED) {
								if (inTier("resolved")) resolvedCount++;
							} else if (t === INVALIDATE) {
								if (inTier("invalidate")) invalidateCount++;
							} else if (t === PAUSE) {
								if (inTier("pause")) pauseCount++;
							} else if (t === RESUME) {
								if (inTier("resume")) resumeCount++;
							} else if (t === TEARDOWN) {
								if (inTier("teardown")) teardownCount++;
							} else if (t === COMPLETE && !nodeErrored.has(path)) {
								if (inTier("complete")) anyCompletedCleanly = true;
							} else if (t === ERROR) {
								if (inTier("error")) {
									anyErrored = true;
									nodeErrored.add(path);
								}
							}
						} else if (t === DIRTY) {
							if (inTier("dirty")) dirtyCount++;
							recordEvent({ type: "dirty", path, ...base } as ObserveEvent);
						} else if (t === RESOLVED) {
							if (inTier("resolved")) resolvedCount++;
							recordEvent({
								type: "resolved",
								path,
								...base,
								...buildCausal(target),
							} as ObserveEvent);
						} else if (t === INVALIDATE) {
							if (inTier("invalidate")) invalidateCount++;
							recordEvent({ type: "invalidate", path, ...base } as ObserveEvent);
						} else if (t === PAUSE) {
							if (inTier("pause")) pauseCount++;
							recordEvent({ type: "pause", path, lockId: m[1], ...base } as ObserveEvent);
						} else if (t === RESUME) {
							if (inTier("resume")) resumeCount++;
							recordEvent({ type: "resume", path, lockId: m[1], ...base } as ObserveEvent);
						} else if (t === COMPLETE) {
							if (inTier("complete") && !nodeErrored.has(path)) anyCompletedCleanly = true;
							recordEvent({ type: "complete", path, ...base } as ObserveEvent);
						} else if (t === ERROR) {
							if (inTier("error")) {
								anyErrored = true;
								nodeErrored.add(path);
							}
							const attr =
								target instanceof NodeImpl
									? (target.lastMutation?.actor ?? DEFAULT_ACTOR)
									: DEFAULT_ACTOR;
							recordEvent({
								type: "error",
								path,
								data: m[1],
								actor: attr,
								...base,
							} as ObserveEvent);
						} else if (t === TEARDOWN) {
							if (inTier("teardown")) teardownCount++;
							recordEvent({ type: "teardown", path, ...base } as ObserveEvent);
						}
					}
				}),
			);
		}

		let disposed = false;
		const dispose = (): void => {
			if (disposed) return;
			disposed = true;
			for (const u of unsubs) u();
			for (const d of inspectorDetaches) d();
			for (const resolve of asyncResolvers) resolve({ value: undefined, done: true });
			asyncResolvers.length = 0;
		};

		// AsyncIterator plumbing: queue events until a pull arrives, or wake
		// a pending pull when a new event lands.
		const asyncQueue: ObserveEvent[] = [];
		const asyncResolvers: Array<(r: IteratorResult<ObserveEvent>) => void> = [];
		listeners.add((ev) => {
			const resolve = asyncResolvers.shift();
			if (resolve) resolve({ value: ev, done: false });
			else asyncQueue.push(ev);
		});

		const result: ObserveResult<T> = {
			get values() {
				return values;
			},
			get dirtyCount() {
				return dirtyCount;
			},
			get resolvedCount() {
				return resolvedCount;
			},
			get invalidateCount() {
				return invalidateCount;
			},
			get pauseCount() {
				return pauseCount;
			},
			get resumeCount() {
				return resumeCount;
			},
			get teardownCount() {
				return teardownCount;
			},
			get events() {
				return ring ? ring.toArray() : [...events];
			},
			get anyCompletedCleanly() {
				return anyCompletedCleanly;
			},
			get anyErrored() {
				return anyErrored;
			},
			get completedWithoutErrors() {
				return anyCompletedCleanly && !anyErrored;
			},
			onEvent(listener) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			dispose,
			expand(extra) {
				dispose();
				const merged: ObserveOptions = { ...options };
				if (typeof extra === "string") {
					merged.detail = extra;
				} else {
					Object.assign(merged, extra);
				}
				return expand(resolveObserveDetail(merged));
			},
			[Symbol.asyncIterator](): AsyncIterator<ObserveEvent> {
				return {
					next(): Promise<IteratorResult<ObserveEvent>> {
						if (asyncQueue.length > 0) {
							return Promise.resolve({ value: asyncQueue.shift()!, done: false });
						}
						if (disposed) return Promise.resolve({ value: undefined, done: true });
						return new Promise((resolve) => asyncResolvers.push(resolve));
					},
					return(): Promise<IteratorResult<ObserveEvent>> {
						dispose();
						return Promise.resolve({ value: undefined, done: true });
					},
				};
			},
		};

		// Format logger: subscribes to event stream, renders via theme/format.
		if (options.format != null) this._attachFormatLogger(result, options);

		return result;
	}

	/**
	 * Attach format-rendering logger to an ObserveResult by subscribing to its
	 * event stream (no monkey-patching). Renders each event per `format` and
	 * `theme`, filtered by `includeTypes` / `excludeTypes`.
	 */
	private _attachFormatLogger(result: ObserveResult, options: ObserveOptions): void {
		const format = options.format;
		if (format == null) return;
		const logger = options.logger ?? ((line: string) => console.log(line));
		// Compile include/exclude predicates once.
		const include = options.includeTypes ? new Set(options.includeTypes) : null;
		const exclude = options.excludeTypes ? new Set(options.excludeTypes) : null;
		const shouldLog =
			include == null && exclude == null
				? () => true
				: (type: ObserveEvent["type"]): boolean =>
						(include == null || include.has(type)) && (exclude == null || !exclude.has(type));
		const theme = resolveObserveTheme(options.theme);
		// stage-log: anchor elapsed timestamps to subscription time. Each event
		// renders `[Xs] STAGE ← preview` / `✗ err` / `■ complete`. No color,
		// since this is a pipeline-diagnostic format — predictable + greppable.
		const stageStartNs = format === "stage-log" ? monotonicNs() : 0;
		const stageLabelFor = (path: string | undefined): string => {
			if (path == null) return "";
			return options.stageLabels?.[path] ?? path;
		};
		const truncate = (s: string, max: number): string =>
			s.length > max ? `${s.slice(0, max - 1)}…` : s;
		const stagePreview = (event: ObserveEvent): string => {
			if (event.type === "data" || event.type === "error") {
				return truncate(describeData((event as { data: unknown }).data), 120);
			}
			return "";
		};

		const renderEvent = (event: ObserveEvent): string => {
			if (format === "stage-log") {
				const elapsedS = (monotonicNs() - stageStartNs) / 1e9;
				const stage = stageLabelFor(event.path).padEnd(9);
				if (event.type === "data") {
					const body = stagePreview(event);
					return `[${elapsedS.toFixed(3)}s] ${stage} ←${body ? ` ${body}` : ""}`;
				}
				if (event.type === "error") {
					const body = stagePreview(event);
					return `[${elapsedS.toFixed(3)}s] ${stage} ✗${body ? ` ${body}` : ""}`;
				}
				if (event.type === "complete") {
					return `[${elapsedS.toFixed(3)}s] ${stage} ■ complete`;
				}
				return `[${elapsedS.toFixed(3)}s] ${stage} ${event.type}`;
			}
			if (format === "json") {
				try {
					return JSON.stringify(event);
				} catch {
					return JSON.stringify({
						type: event.type,
						path: event.path,
						data: "[unserializable]",
					});
				}
			}
			const color = theme[event.type] ?? "";
			const pathPart = event.path ? `${theme.path}${event.path}${theme.reset} ` : "";
			const isDataBearing = event.type === "data" || event.type === "error";
			const isLockBearing = event.type === "pause" || event.type === "resume";
			const dataPart = isDataBearing
				? ` ${describeData((event as { data: unknown }).data)}`
				: isLockBearing
					? ` ${describeData((event as { lockId: unknown }).lockId)}`
					: "";
			const causal =
				event.type === "data" || event.type === "resolved" || event.type === "derived"
					? (event as ObserveCausalContext)
					: undefined;
			const triggerPart =
				causal?.trigger_dep_name != null
					? ` <- ${causal.trigger_dep_name}`
					: causal?.trigger_dep_index != null
						? ` <- #${causal.trigger_dep_index}`
						: "";
			const batchPart = event.in_batch ? " [batch]" : "";
			return `${pathPart}${color}${event.type.toUpperCase()}${theme.reset}${dataPart}${triggerPart}${batchPart}`;
		};

		result.onEvent((event) => {
			if (shouldLog(event.type)) logger(renderEvent(event), event);
		});
	}

	// Tier 2.1 A2: ex-`describe({ format })` renderers
	// (`graphSpecToMermaid`, `graphSpecToD2`, `graphSpecToAscii`,
	// `graphSpecToPretty`, `graphSpecToJson`, `graphSpecToMermaidUrl`) live
	// in `@graphrefly/graphrefly/extra/render` — pure functions over a
	// `GraphDescribeOutput` snapshot (no Graph instance dependency).

	// ——————————————————————————————————————————————————————————————
	//  Lifecycle & persistence (§3.7–§3.8)
	// ——————————————————————————————————————————————————————————————

	/**
	 * Register a cleanup function to be called on {@link Graph.destroy}.
	 *
	 * Factories use this to attach teardown logic for internal nodes, keepalive
	 * subscriptions, or other resources that are not registered on the graph and
	 * would otherwise leak on repeated create/destroy cycles.
	 *
	 * Returns a removal function — call it to unregister the disposer early.
	 */
	addDisposer(fn: () => void): () => void {
		this._disposers.add(fn);
		return () => {
			this._disposers.delete(fn);
		};
	}

	/**
	 * Drains disposers (registered via {@link addDisposer}), then sends `[[TEARDOWN]]` to all
	 * nodes and clears registries on this graph and every mounted subgraph (§3.7).
	 * The instance is left empty and may be reused with {@link Graph.add}.
	 */
	destroy(): void {
		// Drain disposers (keepalive unsubs etc.) BEFORE TEARDOWN so that
		// internal effect nodes are disconnected before the cascade fires.
		// Drain iteratively so disposers registered mid-drain also run; cap
		// iterations to guard against a disposer that re-registers itself.
		drainDisposers(this._disposers, this.name);
		// TEARDOWN is tier 5 — below `attachSnapshotStorage`'s `tier < 5` gate, so no
		// final checkpoint fires; storage disposers unsubscribe after TEARDOWN
		// has propagated through the subscription pipeline.
		this.signal([[TEARDOWN]] satisfies Messages, { internal: true });
		drainDisposers(this._storageDisposers, this.name);
		for (const child of [...this._mounts.values()]) {
			child._parent = undefined;
			child._destroyClearOnly();
		}
		this._mounts.clear();
		this._nodes.clear();
		this._parent = undefined;
		this._destroyed = true;
	}

	/**
	 * `true` once {@link destroy} has run on this graph. Useful for reactive
	 * consumers that hold a Graph reference and want to fail fast / skip
	 * work if the graph went away mid-flight (e.g. a `switchMap` over a
	 * destroyable graph reference). Set after the destroy cascade completes;
	 * stays `true` even if the instance is later reused via {@link add}.
	 */
	get destroyed(): boolean {
		return this._destroyed;
	}

	/**
	 * Clear structure after parent already signaled TEARDOWN through this subtree.
	 *
	 * Drains both `_disposers` and `_storageDisposers` to mirror the full
	 * {@link destroy} path — child mounts that registered disposers via
	 * {@link addDisposer} (audit trails, log dispose hooks, off-event
	 * callbacks, attached storage) would otherwise leak when destruction
	 * reaches the subtree via the parent's TEARDOWN cascade rather than a
	 * direct `destroy()` call (EH-2). Disposers run BEFORE structure clear
	 * so cleanups can still resolve node paths if needed.
	 */
	private _destroyClearOnly(): void {
		drainDisposers(this._disposers, this.name);
		drainDisposers(this._storageDisposers, this.name);
		for (const child of [...this._mounts.values()]) {
			child._parent = undefined;
			child._destroyClearOnly();
		}
		this._mounts.clear();
		this._nodes.clear();
		this._parent = undefined;
		this._destroyed = true;
	}

	/**
	 * Serializes structure and current values to JSON-shaped data (§3.8). Same
	 * information as {@link Graph.describe} plus a `version` field for format
	 * evolution.
	 *
	 * The overload path supports three outputs:
	 * - no arg → `GraphPersistSnapshot` (plain JS object).
	 * - `{format: "json-string"}` → deterministic JSON `string`
	 *   (key-sorted; safe for hashing or file write).
	 * - `{format: "bytes", codec: name}` → `Uint8Array` wrapped in the v1
	 *   envelope from {@link encodeEnvelope}. The codec must be registered
	 *   on this graph's {@link GraphReFlyConfig} via `config.registerCodec`.
	 *   Paired with {@link Graph.decode} for auto-dispatch on the read side.
	 */
	snapshot(): GraphPersistSnapshot;
	snapshot(opts: { format: "json-string" }): string;
	snapshot(opts: { format: "bytes"; codec: string }): Uint8Array;
	snapshot(opts?: {
		format?: "json-string" | "bytes";
		codec?: string;
	}): GraphPersistSnapshot | string | Uint8Array {
		const { expand: _, ...d } = this.describe({ detail: "full" });
		// Explicit key sorting for deterministic output — don't rely on
		// describe() iteration order (audit batch-3, §3.8).
		// Strip non-restorable fields (runtime attribution) so snapshot → restore → snapshot
		// is idempotent. Use describe({ detail: "full" }) for audit snapshots instead.
		const sortedNodes: Record<string, DescribeNodeOutput> = {};
		for (const key of Object.keys(d.nodes).sort()) {
			const { lastMutation: _lm, guard: _g, ...node } = d.nodes[key]!;
			sortedNodes[key] = node;
		}
		const sortedSubgraphs = [...d.subgraphs].sort();
		const snap: GraphPersistSnapshot = {
			...d,
			version: 1,
			nodes: sortedNodes,
			subgraphs: sortedSubgraphs,
		};
		if (opts?.format == null) return snap;
		if (opts.format === "json-string") return JSON.stringify(snap);
		if (opts.format === "bytes") {
			if (opts.codec == null) {
				throw new Error("snapshot({format: 'bytes'}) requires a `codec` name");
			}
			const codec = this.config.lookupCodec<GraphCodec>(opts.codec);
			if (codec == null) {
				throw new Error(
					`snapshot: codec "${opts.codec}" is not registered on this graph's config. ` +
						`Call config.registerCodec(...) before creating nodes.`,
				);
			}
			return encodeEnvelope(codec, codec.encode(snap));
		}
		throw new Error(`snapshot: unknown format "${String(opts.format)}"`);
	}

	/**
	 * Auto-dispatch a byte buffer produced by {@link Graph.snapshot} with
	 * `{format: "bytes", codec: name}`. Reads the v1 envelope, resolves the
	 * named codec on `config` (defaults to `defaultConfig`), and returns the
	 * decoded snapshot. Combine with {@link Graph.fromSnapshot} to rehydrate
	 * a full graph topology from bytes.
	 *
	 * @throws If the envelope is malformed or the named codec isn't
	 *   registered on the target config.
	 */
	static decode(bytes: Uint8Array, opts?: { config?: GraphReFlyConfig }): GraphPersistSnapshot {
		const cfg = opts?.config ?? defaultConfig;
		const { codec, codecVersion, payload } = decodeEnvelope(bytes, cfg);
		return codec.decode(payload, codecVersion);
	}

	/**
	 * Apply persisted values onto an existing graph whose topology matches the snapshot
	 * (§3.8). Only {@link DescribeNodeOutput.type} `state` entries with a `value` field
	 * are written by default; `derived` / `operator` / `effect` are always skipped so
	 * deps drive recomputation. `producer` entries are skipped unless `includeProducers`
	 * is set (producers recompute on activation, so restoring is usually a no-op
	 * overwritten on the next wave — opt in for audit / forensic round-trip use cases).
	 * Unknown paths are ignored.
	 *
	 * @param data - Snapshot envelope with matching `name` and node slices.
	 * @throws If `data.name` does not equal {@link Graph.name}.
	 */
	restore(
		data: GraphPersistSnapshot,
		options?: {
			only?: string | readonly string[];
			/**
			 * Fires per failing write. Default behavior (omitted) is silent —
			 * missing paths and guard denials are swallowed to match the
			 * historical semantics. Provide a callback to surface failures
			 * without aborting the remaining restores.
			 */
			onError?: (path: string, err: unknown) => void;
			/**
			 * Restore `producer` node values alongside `state`. Default `false`:
			 * producers are reactive sources whose value recomputes on
			 * activation, so restoring from a snapshot is usually a no-op
			 * overwritten on the next wave. Audit / forensic round-trip use
			 * cases that need the stored value to survive restoration can
			 * opt in. Does not change `derived` / `effect` handling — those
			 * are always skipped.
			 */
			includeProducers?: boolean;
		},
	): void {
		parseSnapshotEnvelope(data);
		if (data.name !== this.name) {
			throw new Error(
				`Graph "${this.name}": restore snapshot name "${data.name}" does not match this graph`,
			);
		}
		const onlyPatterns =
			options?.only == null
				? null
				: (Array.isArray(options.only) ? options.only : [options.only]).map((p) => globToRegex(p));
		const includeProducers = options?.includeProducers === true;
		for (const path of Object.keys(data.nodes).sort()) {
			if (onlyPatterns !== null && !onlyPatterns.some((re) => re.test(path))) continue;
			const slice = data.nodes[path];
			if (slice === undefined) continue;
			if (!("value" in slice) || slice.value === undefined) {
				// Value absent (valid slice with no snapshotted value) or
				// value === undefined (malformed — undefined is the global
				// SENTINEL per spec §2.5, not valid DATA). Surface the
				// malformed case so torn snapshots don't round-trip silently.
				if ("value" in slice && slice.value === undefined) {
					options?.onError?.(
						path,
						new Error(
							`restore: slice.value is undefined for "${path}" (undefined is the global SENTINEL; not valid DATA)`,
						),
					);
				}
				continue;
			}
			if (slice.type === "derived" || slice.type === "effect") {
				continue;
			}
			if (slice.type === "producer" && !includeProducers) {
				// Reactive producers recompute on activation — restoring would
				// be overwritten on the first wave. Opt in via
				// `{includeProducers: true}` for audit use cases.
				continue;
			}
			// V0 shortcut: if the snapshot slice and the live node both carry
			// matching versioning info (`v.id` + `v.version`), skip the
			// `set()` — the state is already what the snapshot represents.
			// Avoids redundant DATA waves on idempotent restores.
			if (slice.v != null) {
				const live = this.tryResolve(path);
				const lv = live?.v;
				if (lv != null && lv.id === slice.v.id && lv.version === slice.v.version) {
					continue;
				}
			}
			try {
				this.set(path, slice.value);
			} catch (err) {
				options?.onError?.(path, err);
			}
		}
	}

	/**
	 * Creates a graph named from the snapshot, optionally runs `build` to register nodes
	 * and mounts, then {@link Graph.restore} values (§3.8).
	 *
	 * @param data - Snapshot envelope (`version` checked).
	 * @param opts - Either a legacy `build(g)` callback, or an options object:
	 *   - `build?` — topology constructor; skips auto-hydration when present.
	 *   - `factories?` — map from glob pattern to {@link GraphNodeFactory},
	 *     used by auto-hydration to reconstruct non-state nodes. Per-call (no
	 *     process-global registry). First matching pattern wins.
	 * @returns Hydrated `Graph` instance.
	 */
	static fromSnapshot(
		data: GraphPersistSnapshot,
		opts?:
			| ((g: Graph) => void)
			| { build?: (g: Graph) => void; factories?: Record<string, GraphNodeFactory> },
	): Graph {
		parseSnapshotEnvelope(data);
		const build = typeof opts === "function" ? opts : opts?.build;
		const factoryMap = typeof opts === "function" ? undefined : opts?.factories;
		const g = new Graph(data.name);
		if (build) {
			build(g);
			g.restore(data);
			return g;
		}
		// Auto-create mount hierarchy from subgraphs.
		for (const mount of [...data.subgraphs].sort((a, b) => {
			const da = a.split(PATH_SEP).length;
			const db = b.split(PATH_SEP).length;
			if (da !== db) return da - db;
			if (a < b) return -1;
			if (a > b) return 1;
			return 0;
		})) {
			const parts = mount.split(PATH_SEP);
			let target: Graph = g;
			for (const seg of parts) {
				if (!target._mounts.has(seg)) {
					target.mount(seg, new Graph(seg));
				}
				target = target._mounts.get(seg)!;
			}
		}

		// Compile factory glob patterns once. First match in insertion order wins.
		const factories = factoryMap
			? Object.entries(factoryMap).map(([pattern, factory]) => ({
					re: globToRegex(pattern),
					factory,
				}))
			: [];
		const factoryForPath = (path: string): GraphNodeFactory | undefined => {
			for (const entry of factories) {
				if (entry.re.test(path)) return entry.factory;
			}
			return undefined;
		};

		// Resolve the owning graph + local name for a qualified snapshot path.
		const ownerForPath = (path: string): [Graph, string] => {
			const segments = path.split(PATH_SEP);
			const local = segments.pop();
			if (local == null || local.length === 0) {
				throw new Error(`invalid snapshot path "${path}"`);
			}
			let owner: Graph = g;
			for (const seg of segments) {
				const next = owner._mounts.get(seg);
				if (!next) throw new Error(`unknown mount "${seg}" in path "${path}"`);
				owner = next;
			}
			return [owner, local];
		};

		const primaryEntries = Object.entries(data.nodes)
			.filter(([path]) => !path.includes(`${PATH_SEP}${GRAPH_META_SEGMENT}${PATH_SEP}`))
			.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
		const pending = new Map(primaryEntries);
		const created = new Map<string, Node>();

		let progressed = true;
		while (pending.size > 0 && progressed) {
			progressed = false;
			for (const [path, slice] of [...pending.entries()]) {
				const deps = slice?.deps ?? [];
				if (!deps.every((dep) => created.has(dep))) continue;
				const [owner, localName] = ownerForPath(path);
				const meta: Record<string, unknown> = { ...(slice?.meta ?? {}) };
				const factory = factoryForPath(path);
				let n: Node;
				if (slice?.type === "state") {
					n = node([], { initial: slice.value, meta });
				} else {
					if (factory == null) continue;
					n = factory(localName, {
						path,
						type: slice.type,
						value: slice.value,
						meta,
						deps,
						resolvedDeps: deps.map((dep) => created.get(dep)!),
					});
				}
				owner.add(n, { name: localName });
				created.set(path, n);
				pending.delete(path);
				progressed = true;
			}
		}
		if (pending.size > 0) {
			const unresolved = [...pending.keys()].sort().join(", ");
			throw new Error(
				`Graph.fromSnapshot could not reconstruct nodes without build callback: ${unresolved}. ` +
					`Pass matching factories via fromSnapshot(data, { factories: { pattern: factoryFn } }).`,
			);
		}
		// Edges are derived from node `_deps` reconstructed during node
		// creation above — no explicit edge replay needed (Unit 7).
		g.restore(data);
		return g;
	}

	/**
	 * ECMAScript `JSON.stringify` hook — returns the same object as
	 * {@link Graph.snapshot}. Makes `JSON.stringify(graph)` "just work"
	 * without double-encoding.
	 */
	toJSON(): GraphPersistSnapshot {
		return this.snapshot();
	}

	/**
	 * Unified persistence surface (§3.8). Cascades snapshot records through
	 * one or more {@link SnapshotStorageTier}s, each with its own `debounceMs` /
	 * `compactEvery` cadence and independent diff baseline.
	 *
	 * Subscription gates on {@link messageTier} ≥ 3 (DATA/RESOLVED/terminal),
	 * never on tier-0/1/2 control waves (START/DIRTY/INVALIDATE/PAUSE/RESUME)
	 * or tier-5 TEARDOWN (graceful shutdown is the caller's responsibility).
	 *
	 * Per-tier cadence lets the hot tier stay sync while cold tiers absorb
	 * async writes without blocking the hot path. Each tier holds its own
	 * `{lastSnapshot, lastVersionFingerprint}` so cold-tier diff baselines
	 * aren't polluted by hot-tier flushes. Tiers with `debounceMs === 0`
	 * share a single snapshot computation per observe event; debounced tiers
	 * compute their own snapshot when their timer fires.
	 */
	attachSnapshotStorage(
		tiers: readonly SnapshotStorageTier<GraphCheckpointRecord>[],
		options: GraphAttachStorageOptions = {},
	): StorageHandle {
		type TierState = {
			tier: SnapshotStorageTier<GraphCheckpointRecord>;
			debounceMs: number;
			compactEvery: number;
			timer: ResettableTimer | undefined;
			seq: number;
			lastSnapshot: GraphPersistSnapshot | undefined;
			lastFingerprint: string;
			disposed: boolean;
			// Chain of pending async saves for this tier. Each flush awaits the
			// previous one so baseline advances only after persistence confirms;
			// on rejection the chain resets (next flush starts from the last
			// successfully-persisted baseline). Sync tiers never populate this.
			savePending: Promise<void> | undefined;
		};
		const states: TierState[] = tiers.map((tier) => ({
			tier,
			debounceMs: Math.max(0, tier.debounceMs ?? 0),
			compactEvery: Math.max(1, tier.compactEvery ?? 10),
			timer: undefined,
			seq: 0,
			lastSnapshot: undefined,
			lastFingerprint: "",
			disposed: false,
			savePending: undefined,
		}));

		if (options.autoRestore === true) {
			// Fire-and-forget cascade restore; errors surface via onError with
			// the specific tier that failed.
			void this._cascadeRestore(tiers, options.onError);
		}

		const runFlush = (s: TierState, snapshot: GraphPersistSnapshot): void => {
			if (s.disposed) return;
			const fingerprint = computeVersionFingerprint(snapshot.nodes);
			if (s.lastSnapshot != null && fingerprint !== "" && fingerprint === s.lastFingerprint) {
				return;
			}
			const nextSeq = s.seq + 1;
			// Persisted records carry wall-clock attribution (CLAUDE.md time-util
			// rule). Internal event-order timestamps use monotonicNs — this is the
			// output-to-durable-store boundary, so wall clock is correct and
			// cross-source comparable with surface.saveSnapshot records.
			const timestamp_ns = wallClockNs();
			const isFirst = s.lastSnapshot == null;
			const shouldCompact = isFirst || nextSeq % s.compactEvery === 0;
			const record: GraphCheckpointRecord = shouldCompact
				? {
						name: this.name,
						mode: "full",
						snapshot,
						seq: nextSeq,
						timestamp_ns,
						format_version: SNAPSHOT_VERSION,
					}
				: {
						name: this.name,
						mode: "diff",
						diff: diffForWAL(s.lastSnapshot!, snapshot),
						seq: nextSeq,
						timestamp_ns,
						format_version: SNAPSHOT_VERSION,
					};
			if (s.tier.filter && !s.tier.filter(record)) {
				// Filter rejected — don't advance seq or baseline.
				return;
			}
			let result: void | Promise<void>;
			try {
				result = s.tier.save(record);
			} catch (error) {
				// Synchronous throw — baseline untouched; surface and bail.
				options.onError?.(error, s.tier);
				return;
			}
			if (result && typeof (result as Promise<void>).then === "function") {
				// Async tier: defer baseline + seq advance until the promise
				// settles. Chain saves per-tier so they land in order without
				// overlapping baselines. On rejection, baseline is left intact
				// so the next flush diffs against the last successfully
				// persisted snapshot.
				const prev = s.savePending ?? Promise.resolve();
				const chained = prev.then(
					() => result as Promise<void>,
					// Previous rejection already surfaced; don't block this save.
					() => result as Promise<void>,
				);
				const final = chained.then(
					() => {
						if (s.disposed) return;
						s.seq = nextSeq;
						s.lastSnapshot = snapshot;
						s.lastFingerprint = fingerprint;
					},
					(err) => {
						options.onError?.(err, s.tier);
					},
				);
				s.savePending = final.finally(() => {
					if (s.savePending === final) s.savePending = undefined;
				});
			} else {
				s.seq = nextSeq;
				s.lastSnapshot = snapshot;
				s.lastFingerprint = fingerprint;
			}
		};

		const flushTier = (s: TierState, snapshot: GraphPersistSnapshot): void => {
			try {
				runFlush(s, snapshot);
			} catch (error) {
				options.onError?.(error, s.tier);
			}
		};

		const onEvent = (path: string, messages: Messages): void => {
			const triggeredByTier = messages.some((m) => {
				const tier = this.config.messageTier(m[0]);
				return tier >= 3 && tier < 5;
			});
			if (!triggeredByTier) return;
			if (options.filter) {
				const nd = this.tryResolve(path);
				if (nd == null) return;
				const described = describeNode(nd, resolveDescribeFields("standard"));
				if (!options.filter(path, described)) return;
			}
			// Shared snapshot for all sync (debounceMs=0) tiers firing on this event.
			let sharedSnapshot: GraphPersistSnapshot | undefined;
			const getSnapshot = (): GraphPersistSnapshot => {
				if (sharedSnapshot == null) sharedSnapshot = this.snapshot();
				return sharedSnapshot;
			};
			for (const s of states) {
				if (s.disposed) continue;
				if (s.debounceMs === 0) {
					flushTier(s, getSnapshot());
				} else {
					if (s.timer == null) s.timer = new ResettableTimer();
					s.timer.start(s.debounceMs, () => {
						if (s.disposed) return;
						flushTier(s, this.snapshot());
					});
				}
			}
		};

		let off: () => void;
		if (options.paths != null) {
			const paths =
				typeof options.paths === "string"
					? this._pathsMatching(options.paths)
					: (options.paths as readonly string[]);
			const unsubs = paths.map((p) => {
				const nd = this.tryResolve(p);
				if (nd == null) return () => {};
				return nd.subscribe((msgs) => onEvent(p, msgs));
			});
			off = () => {
				for (const u of unsubs) u();
			};
		} else {
			off = this.observe().subscribe((path, messages) => onEvent(path, messages));
		}

		const dispose = () => {
			off();
			for (const s of states) {
				s.disposed = true;
				s.timer?.cancel();
			}
			this._storageDisposers.delete(dispose);
		};
		this._storageDisposers.add(dispose);
		return { dispose };
	}

	/**
	 * Try tiers in order (hottest first); apply the first record that hits
	 * via {@link Graph.restore}. Returns `true` if any tier produced a
	 * restorable snapshot, `false` if all missed.
	 *
	 * Resilience: a tier that returns data which cannot be restored (load
	 * throws, shape unrecognized, or `restore()` itself throws) does not abort
	 * the cascade — the error is routed through `onError` (if supplied) and
	 * the next colder tier is tried. This mirrors how a multi-tier cache
	 * falls through on a corrupt hot entry.
	 *
	 * Note: `restore()` mutates state incrementally. If a restore throws
	 * partway through, the graph may hold a mixed state (some slices from
	 * the bad tier, some pre-existing). A subsequent successful tier's
	 * `restore()` overwrites the overlapping slices.
	 *
	 * Internal helper shared by {@link Graph.attachSnapshotStorage}'s `autoRestore`
	 * option and the static {@link Graph.fromStorage} factory.
	 */
	private async _cascadeRestore(
		tiers: readonly SnapshotStorageTier<GraphCheckpointRecord>[],
		onError?: (err: unknown, tier: SnapshotStorageTier<GraphCheckpointRecord>) => void,
	): Promise<boolean> {
		for (const tier of tiers) {
			let raw: unknown;
			try {
				raw = await tier.load?.();
			} catch (err) {
				onError?.(err, tier);
				continue;
			}
			if (raw == null) continue;
			if (typeof raw !== "object" || Array.isArray(raw)) continue;
			const record = raw as Record<string, unknown>;
			try {
				// Accept both a `GraphCheckpointRecord` envelope
				// (`mode === "full"`) and a bare `GraphPersistSnapshot` (the
				// shape written by `saveGraphCheckpoint`). Bare snapshots
				// carry `version: 1`.
				if (record.mode === "full" && record.snapshot != null) {
					this.restore(record.snapshot as GraphPersistSnapshot);
					return true;
				}
				if (record.version === SNAPSHOT_VERSION && record.nodes != null) {
					this.restore(record as GraphPersistSnapshot);
					return true;
				}
			} catch (err) {
				onError?.(err, tier);
				// Fall through to the next tier.
			}
		}
		return false;
	}

	/**
	 * Construct a fresh {@link Graph} pre-hydrated from the first tier that
	 * hits. Delegates topology reconstruction to {@link Graph.fromSnapshot}
	 * on `"full"` records and direct {@link Graph.restore} on bare snapshots.
	 *
	 * Always asynchronous — awaits `tier.load()` for async tier support even
	 * when all tiers are sync. Callers that know they only pass sync tiers
	 * can safely `await` immediately.
	 *
	 * @throws If no tier holds a restorable record matching `name` *and* no
	 *   `factories` override is provided for dynamic nodes.
	 */
	static async fromStorage(
		name: string,
		tiers: readonly SnapshotStorageTier<GraphCheckpointRecord>[],
		opts?: GraphOptions & {
			factories?: Record<string, GraphNodeFactory>;
			/**
			 * Called when a tier throws during `load()` or when
			 * {@link Graph.fromSnapshot} rejects a tier's record. The cascade
			 * falls through to the next colder tier regardless.
			 */
			onError?: (err: unknown, tier: SnapshotStorageTier<GraphCheckpointRecord>) => void;
		},
	): Promise<Graph> {
		for (const tier of tiers) {
			let raw: unknown;
			try {
				raw = await tier.load?.();
			} catch (err) {
				opts?.onError?.(err, tier);
				continue;
			}
			if (raw == null) continue;
			if (typeof raw !== "object" || Array.isArray(raw)) continue;
			const record = raw as Record<string, unknown>;
			const snapshot: GraphPersistSnapshot | undefined =
				record.mode === "full" && record.snapshot != null
					? (record.snapshot as GraphPersistSnapshot)
					: record.version === SNAPSHOT_VERSION && record.nodes != null
						? (record as GraphPersistSnapshot)
						: undefined;
			if (snapshot == null) continue;
			try {
				return Graph.fromSnapshot(snapshot, opts);
			} catch (err) {
				opts?.onError?.(err, tier);
				// Fall through to colder tier.
			}
		}
		throw new Error(
			`Graph.fromStorage: no tier held a restorable record for "${name}" across ${tiers.length} tier(s)`,
		);
	}

	// ——————————————————————————————————————————————————————————————
	//  Inspector (roadmap 3.3) — reasoning trace, overhead gating
	// ——————————————————————————————————————————————————————————————

	// Inspector gating lives on `this.config.inspectorEnabled` (see
	// `core/config.ts`). Default: `true` outside `NODE_ENV === "production"`.

	private _annotations = new Map<string, string>();
	private readonly _traceRing: RingBuffer<TraceEntry>;

	/**
	 * Unified reasoning trace: write annotations or read the ring buffer.
	 *
	 * - `graph.trace("path", "annotation")` — attaches a reasoning annotation
	 *   to a node, capturing *why* an AI agent set a value. Overwrites the
	 *   current annotation (if any) and appends to the chronological ring.
	 *   Unknown paths are silently dropped (matching `observe` resilience).
	 *   No-op when `config.inspectorEnabled` is `false`.
	 * - `graph.trace("path")` — returns the current annotation for `path`,
	 *   or `undefined` if none. Precedence: most recent `trace(path, ...)`
	 *   wins; if no trace call, whatever `graph.add(node, { name: "path", annotation })`
	 *   installed; otherwise `undefined`.
	 * - `graph.trace()` — returns a chronological log of all write entries.
	 *   Returns `[]` when `config.inspectorEnabled` is `false`.
	 */
	trace(path: string, annotation: string, opts?: { actor?: Actor }): void;
	trace(path: string): string | undefined;
	trace(): readonly TraceEntry[];
	trace(
		path?: string,
		annotation?: string,
		opts?: { actor?: Actor },
	): string | undefined | readonly TraceEntry[] {
		// Write: (path, annotation[, opts])
		// Write: (path, annotation[, opts])
		if (path != null && annotation != null) {
			// Silent-drop unknown paths — matches `observe` resilience. Callers
			// with robust path-hygiene needs can pre-check via `tryResolve`.
			if (this.tryResolve(path) == null) return;
			// The `_annotations` map is always kept current so reads don't
			// lose annotations installed before the inspector flag flipped.
			// Only the chronological ring-buffer push is gated on inspector.
			this._annotations.set(path, annotation);
			if (this.config.inspectorEnabled) {
				const entry: TraceEntry = {
					path,
					annotation,
					timestamp_ns: monotonicNs(),
					...(opts?.actor != null ? { actor: opts.actor } : {}),
				};
				this._traceRing.push(entry);
			}
			return;
		}
		// Read single: (path). Symmetric with read-all — short-circuit when
		// inspector is disabled so callers treat both overloads identically.
		if (path != null) {
			if (!this.config.inspectorEnabled) return undefined;
			return this._annotations.get(path);
		}
		// Read all: ()
		if (!this.config.inspectorEnabled) return [];
		return this._traceRing.toArray();
	}

	/**
	 * Latest annotation attached to `path` — via {@link Graph.trace} or via
	 * {@link Graph.add}'s `{annotation}` option. Returns `undefined` if none.
	 * `describe()` surfaces this via the `annotation` field on each node entry
	 * (when present). Equivalent to `graph.trace(path)`.
	 */
	annotation(path: string): string | undefined {
		return this._annotations.get(path);
	}

	/**
	 * Clear all reasoning-trace state (both the per-path annotations map and
	 * the ring buffer). Useful for long-running processes that want periodic
	 * resets, or tests that need a clean slate.
	 */
	clearTrace(): void {
		this._annotations.clear();
		this._traceRing.clear();
	}

	/**
	 * Remove trace entries matching `predicate`. Returns the number of
	 * entries removed. Does not touch the per-path annotations map — call
	 * {@link Graph.clearTrace} for a full reset.
	 */
	pruneTrace(predicate: (entry: TraceEntry) => boolean): number {
		const kept = this._traceRing.toArray().filter((e) => !predicate(e));
		const removed = this._traceRing.size - kept.length;
		this._traceRing.clear();
		for (const e of kept) this._traceRing.push(e);
		return removed;
	}

	/**
	 * Computes structural + value diff between two {@link Graph.describe} snapshots.
	 *
	 * @param a - Earlier describe output.
	 * @param b - Later describe output.
	 * @returns Added/removed nodes, changed fields, and edge deltas.
	 */
	static diff(a: GraphDescribeOutput, b: GraphDescribeOutput): GraphDiffResult {
		const aKeys = new Set(Object.keys(a.nodes));
		const bKeys = new Set(Object.keys(b.nodes));

		const nodesAdded = [...bKeys].filter((k) => !aKeys.has(k)).sort();
		const nodesRemoved = [...aKeys].filter((k) => !bKeys.has(k)).sort();
		const nodesChanged: GraphDiffChange[] = [];
		const versionChanges: GraphVersionChange[] = [];

		for (const key of aKeys) {
			if (!bKeys.has(key)) continue;
			const na = a.nodes[key];
			const nb = b.nodes[key];
			const av = na.v;
			const bv = nb.v;
			// Surface version bumps (even if value is identical, the bump itself
			// is meaningful for audit / wire-efficient sync).
			if (av != null && bv != null && av.id === bv.id && av.version !== bv.version) {
				versionChanges.push({
					path: key,
					id: av.id,
					from: av.version,
					to: bv.version,
				});
			}
			const versionMatches =
				av != null && bv != null && av.id === bv.id && av.version === bv.version;
			// V0 fast path: when versions match, skip value / meta compare —
			// upstream is guaranteed unchanged by protocol. Only type/status
			// (cheap string compare) + sentinel flip are possible.
			for (const field of ["type", "status", "sentinel"] as const) {
				const va = (na as Record<string, unknown>)[field];
				const vb = (nb as Record<string, unknown>)[field];
				if (va !== vb) {
					nodesChanged.push({ path: key, field, from: va, to: vb });
				}
			}
			if (versionMatches) continue;
			// Full slow-path: deep-equal on value + meta.
			for (const field of ["value", "meta"] as const) {
				const va = (na as Record<string, unknown>)[field];
				const vb = (nb as Record<string, unknown>)[field];
				if (!deepEqual(va, vb)) {
					nodesChanged.push({ path: key, field, from: va, to: vb });
				}
			}
		}

		const edgeKey = (e: { from: string; to: string }) => `${e.from}\t${e.to}`;
		const aEdges = new Set(a.edges.map(edgeKey));
		const bEdges = new Set(b.edges.map(edgeKey));

		const edgesAdded = b.edges.filter((e) => !aEdges.has(edgeKey(e)));
		const edgesRemoved = a.edges.filter((e) => !bEdges.has(edgeKey(e)));
		const aSubgraphs = new Set(a.subgraphs);
		const bSubgraphs = new Set(b.subgraphs);
		const subgraphsAdded = [...bSubgraphs].filter((s) => !aSubgraphs.has(s)).sort();
		const subgraphsRemoved = [...aSubgraphs].filter((s) => !bSubgraphs.has(s)).sort();

		return {
			nodesAdded,
			nodesRemoved,
			nodesChanged,
			versionChanges,
			edgesAdded,
			edgesRemoved,
			subgraphsAdded,
			subgraphsRemoved,
		};
	}
}

/** Entry in the reasoning trace ring buffer (roadmap 3.3). */
export type TraceEntry = {
	path: string;
	annotation: string;
	timestamp_ns: number;
	/**
	 * Actor that produced the annotation (optional). Enables multi-agent
	 * attribution: distinguish "LLM set this rootCause" from "human approved
	 * this intervention" in the trace log.
	 */
	actor?: Actor;
};

/** Result of {@link Graph.diff}. */
export type GraphDiffResult = {
	nodesAdded: string[];
	nodesRemoved: string[];
	nodesChanged: GraphDiffChange[];
	/**
	 * V0 version bumps (same `v.id`, different `v.version`). Surfaced even
	 * when values are identical — the bump itself is audit-meaningful.
	 */
	versionChanges: GraphVersionChange[];
	edgesAdded: Array<{ from: string; to: string }>;
	edgesRemoved: Array<{ from: string; to: string }>;
	subgraphsAdded: string[];
	subgraphsRemoved: string[];
};

/**
 * WAL-oriented diff — extends {@link GraphDiffResult} with the full node
 * slice for each added path so {@link replayWAL} can reconstruct nodes added
 * between full anchors (topology mutations inside a `compactEvery` window).
 *
 * `Graph.diff()` returns the audit shape (no payload); `attachSnapshotStorage` writes
 * this WAL shape. The two shapes stay structurally compatible — `GraphWALDiff`
 * is a superset.
 */
export type GraphWALDiff = GraphDiffResult & {
	/**
	 * Full node slices for every path in `nodesAdded`, keyed by path. Applied
	 * verbatim to `snapshot.nodes[path]` during replay.
	 */
	nodesAddedFull: Record<string, DescribeNodeOutput>;
};

/**
 * Build a WAL-ready diff between two snapshots: the structural diff from
 * {@link Graph.diff} plus the full node slice for each added path (pulled
 * from `b.nodes`). Callers that only need the audit shape should use
 * `Graph.diff` directly.
 */
export function diffForWAL(a: GraphDescribeOutput, b: GraphDescribeOutput): GraphWALDiff {
	const base = Graph.diff(a, b);
	const nodesAddedFull: Record<string, DescribeNodeOutput> = {};
	for (const path of base.nodesAdded) {
		const slice = b.nodes[path];
		if (slice != null) nodesAddedFull[path] = slice;
	}
	return { ...base, nodesAddedFull };
}

/** A single field change within a diff. */
export type GraphDiffChange = {
	path: string;
	field: string;
	from: unknown;
	to: unknown;
};

/** A single V0 version bump within a diff. */
export type GraphVersionChange = {
	path: string;
	id: string;
	from: number;
	to: number;
};

/** Audit record returned by {@link Graph.remove}. */
export type GraphRemoveAudit = {
	/** Whether the removed entry was a local node or a mount. */
	kind: "node" | "mount";
	/**
	 * Primary nodes torn down by this `remove()`. For `kind: "node"` contains
	 * just the removed name; for `kind: "mount"` lists every primary node in
	 * the unmounted subtree (qualified paths relative to the mount point,
	 * sorted).
	 */
	nodes: string[];
	/**
	 * Mounted subgraphs that were unmounted. For `kind: "node"` this is empty;
	 * for `kind: "mount"` starts with the top-level mount name and lists its
	 * descendants in depth-first order.
	 */
	mounts: string[];
};

/** Direction for {@link reachable} graph traversal. */
export type ReachableDirection = "upstream" | "downstream";

/** Options for {@link reachable}. */
export type ReachableOptions = {
	/** Maximum hop depth from `from` (0 returns `[]`). Omit for unbounded traversal. */
	maxDepth?: number;
	/**
	 * Traverse both directions in one pass (union of upstream + downstream).
	 * Ignores the `direction` arg when set.
	 */
	both?: boolean;
	/**
	 * Return the richer {@link ReachableResult} shape (paths + per-path
	 * hop depth + truncation flag) instead of the flat sorted string array.
	 */
	withDetail?: boolean;
};

/** Rich reachable result (opt-in via `{withDetail: true}`). */
export type ReachableResult = {
	/** Reachable paths, sorted lexicographically. */
	paths: string[];
	/** Hop depth from `from` to each reachable path. */
	depths: Map<string, number>;
	/** True when traversal hit `maxDepth` and some neighbors were not explored. */
	truncated: boolean;
};

/**
 * Reachability query over a {@link Graph.describe} snapshot.
 *
 * Traversal follows `deps` (upstream) and reverse-`deps` (downstream). Edges
 * are derived from deps post Unit 7, so `edges[]` in the snapshot is
 * redundant with deps — it's walked defensively in case a caller supplied a
 * pre-Unit-7 snapshot.
 *
 * @param described - `graph.describe()` output to traverse.
 * @param from - Start path (qualified node path).
 * @param direction - Traversal direction (ignored when `opts.both` is `true`).
 * @param options - Optional `maxDepth`, `both`, `withDetail`.
 * @returns Sorted paths (flat) — or {@link ReachableResult} when `withDetail: true`.
 */
export function reachable(
	described: GraphDescribeOutput,
	from: string,
	direction: ReachableDirection,
	options?: ReachableOptions & { withDetail: true },
): ReachableResult;
export function reachable(
	described: GraphDescribeOutput,
	from: string,
	direction: ReachableDirection,
	options?: ReachableOptions,
): string[];
export function reachable(
	described: GraphDescribeOutput,
	from: string,
	direction: ReachableDirection,
	options: ReachableOptions = {},
): string[] | ReachableResult {
	const empty: ReachableResult = { paths: [], depths: new Map(), truncated: false };
	if (!from) return options.withDetail ? empty : [];
	if (!options.both && direction !== "upstream" && direction !== "downstream") {
		throw new Error(`reachable: direction must be "upstream" or "downstream"`);
	}
	const maxDepth = options.maxDepth;
	if (maxDepth != null && (!Number.isInteger(maxDepth) || maxDepth < 0)) {
		throw new Error(`reachable: maxDepth must be an integer >= 0`);
	}
	if (maxDepth === 0) return options.withDetail ? empty : [];

	const depsByPath = new Map<string, readonly string[]>();
	const reverseDeps = new Map<string, Set<string>>();
	const incomingEdges = new Map<string, Set<string>>();
	const outgoingEdges = new Map<string, Set<string>>();
	const universe = new Set<string>();

	for (const [path, node] of Object.entries(described.nodes)) {
		if (!path) continue;
		universe.add(path);
		const deps = node.deps ?? [];
		depsByPath.set(path, deps);
		for (const dep of deps) {
			if (!dep) continue;
			universe.add(dep);
			if (!reverseDeps.has(dep)) reverseDeps.set(dep, new Set());
			reverseDeps.get(dep)!.add(path);
		}
	}
	// Edges are normally derived from deps post Unit 7, but synthetic snapshots
	// (e.g. test fixtures) may declare edges independently — walk both for
	// compatibility. Minimal null/string checks for malformed JSON.
	for (const edge of described.edges) {
		if (edge == null || typeof edge !== "object") continue;
		const from = typeof edge.from === "string" ? edge.from : "";
		const to = typeof edge.to === "string" ? edge.to : "";
		if (!from || !to) continue;
		universe.add(from);
		universe.add(to);
		if (!outgoingEdges.has(from)) outgoingEdges.set(from, new Set());
		outgoingEdges.get(from)!.add(to);
		if (!incomingEdges.has(to)) incomingEdges.set(to, new Set());
		incomingEdges.get(to)!.add(from);
	}

	if (!universe.has(from)) return options.withDetail ? empty : [];

	const doBoth = options.both === true;
	const visit = (path: string): readonly string[] => {
		if (doBoth) {
			const up = depsByPath.get(path) ?? [];
			const upEdges = incomingEdges.get(path);
			const down = reverseDeps.get(path);
			const downEdges = outgoingEdges.get(path);
			const acc: string[] = [...up];
			if (upEdges) acc.push(...upEdges);
			if (down) acc.push(...down);
			if (downEdges) acc.push(...downEdges);
			return acc;
		}
		if (direction === "upstream") {
			const up = depsByPath.get(path) ?? [];
			const upEdges = incomingEdges.get(path);
			if (!upEdges) return up;
			return [...up, ...upEdges];
		}
		const down = reverseDeps.get(path);
		const downEdges = outgoingEdges.get(path);
		const acc: string[] = down ? [...down] : [];
		if (downEdges) acc.push(...downEdges);
		return acc;
	};

	// Head-index BFS — avoids O(n²) from `Array.prototype.shift`.
	const visited = new Set<string>([from]);
	const depths = new Map<string, number>();
	const queue: Array<{ path: string; depth: number }> = [{ path: from, depth: 0 }];
	let head = 0;
	let truncated = false;
	while (head < queue.length) {
		const next = queue[head++]!;
		if (maxDepth != null && next.depth >= maxDepth) {
			// Flag truncation only if this node actually has unexplored neighbors.
			if (visit(next.path).length > 0) truncated = true;
			continue;
		}
		for (const nb of visit(next.path)) {
			if (!nb || visited.has(nb)) continue;
			visited.add(nb);
			depths.set(nb, next.depth + 1);
			queue.push({ path: nb, depth: next.depth + 1 });
		}
	}

	const paths = [...depths.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	if (options.withDetail) return { paths, depths, truncated };
	return paths;
}

/**
 * Structural equals for a causal-chain step sequence, used by
 * {@link Graph.explain} in reactive mode to suppress RESOLVED re-emits when
 * the chain is unchanged between observe events.
 */
function causalStepsEqual(a: readonly CausalStep[], b: readonly CausalStep[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const x = a[i]!;
		const y = b[i]!;
		if (x.path !== y.path) return false;
		if (x.type !== y.type) return false;
		if (x.status !== y.status) return false;
		if (x.hop !== y.hop) return false;
		if (x.dep_index !== y.dep_index) return false;
		if (x.annotation !== y.annotation) return false;
		// Value identity — derived snapshots reuse same refs unless changed.
		if (x.value !== y.value) return false;
		// `lastMutation` is replaced on every write, so identity compare is sufficient.
		if (x.lastMutation !== y.lastMutation) return false;
		const xv = x.v;
		const yv = y.v;
		if (xv !== yv) {
			if (xv == null || yv == null) return false;
			if (xv.id !== yv.id || xv.version !== yv.version) return false;
		}
	}
	return true;
}
