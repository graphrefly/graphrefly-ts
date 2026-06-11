/**
 * The Graph layer (CSP-2): convenience + inspection entry (D5 / R-graph-role).
 *
 * g.* sugar desugars to dispatcher.register + Node and auto-registers into the graph
 * inspection index (D27: sugar→ctx-fn conversion lives strictly here; the substrate node
 * only ever sees `(ctx)=>void`). The Graph owns naming, describe, mount, and the D30
 * value-level throw→ERROR boundary. The bare node()/dispatcher stay inspection-free
 * (R-node-thin).
 *
 * Canonical authority: ~/src/graphrefly — D3/D5/D27/D30/D36/D37/D39, R-graph-role,
 * R-describe, R-fn-contract, R-edges-derived, R-meta-presentation.
 */

import { type BatchCtx, batch as batchRun } from "../batch/batch.js";
import { type Ctx, depCount, depLatest, type NodeFn } from "../ctx/types.js";
import { type Dispatcher, defaultDispatcher } from "../dispatcher/index.js";
import { NodeCore } from "../node/core.js";
import {
	checkpointStateOfNode,
	getNodeOwner,
	isNodeActiveForRelease,
	isNodeRuntimeQuiescentForRelease,
	isNodeRuntimeReleased,
	Node,
	type NodeOptions,
	releaseRuntimeOfNode,
	setNodeOwner,
	setNodeTopologyDepsChangedObserver,
	subscriberCountOfNode,
	withEnvironmentDrivers,
	withNodeCore,
} from "../node/node.js";
import type { NodeVersioningPolicy } from "../node/versioning.js";
import { errorPayload, messageTier, SENTINEL } from "../protocol/messages.js";
import {
	GRAPH_BLUEPRINT_VERSION,
	type GraphBlueprint,
	type GraphBlueprintOptions,
	graphBlueprintDiagnostics,
	normalizeTopology,
	normalizeTopologyMeta,
} from "./blueprint.js";
import {
	checkpointBackendStateOfNode,
	checkpointTerminal,
	checkpointValue,
	GRAPH_CHECKPOINT_VERSION,
	type GraphCheckpoint,
	type GraphCheckpointFactory,
	type GraphCheckpointJson,
	type GraphCheckpointNode,
	toCheckpointJson,
} from "./checkpoint.js";
import {
	type DescribeEdge,
	type DescribeNode,
	type DescribeOpts,
	type DescribeSnapshot,
	type GraphTopologySnapshot,
	topologyFromDescribe,
} from "./describe.js";
import { EnvironmentDrivers } from "./environment.js";
import type {
	NodeProfile,
	ObserveStream,
	Profile,
	TopologyEvent,
	TopologyStream,
} from "./inspect.js";
import { initNodeWithCore, type Operator } from "./operators.js";

/** Map a tuple of Nodes to the tuple of their value types (typed value-level fn args). */
type DepValues<D extends readonly Node<unknown>[]> = {
	[K in keyof D]: D[K] extends Node<infer V> ? V : never;
};

/** Value-level derived fn: receives dep values, returns the next value (undefined = no emit). */
export type DerivedFn<D extends readonly Node<unknown>[], T> = (
	...values: DepValues<D>
) => T | undefined;

/** Value-level effect fn: receives dep values, optionally returns a deactivation cleanup. */
export type EffectFn<D extends readonly Node<unknown>[]> = (
	...values: DepValues<D>
	// biome-ignore lint/suspicious/noConfusingVoidType: effect returns void OR a cleanup fn — the void arm keeps `(v) => { sideEffect(v) }` ergonomic (React EffectCallback idiom); dropping it would force an explicit `return undefined`.
) => void | (() => void);

/** Sugar options — node options minus graph-owned dispatcher plus naming/meta. */
export interface SugarOpts<T = unknown> extends Omit<NodeOptions<T>, "dispatcher"> {
	name?: string;
	meta?: Record<string, unknown>;
	/**
	 * D95: explicit restorable factory metadata. Static JSON-compatible config may live here;
	 * reactive options must remain graph deps. Without this, function-backed nodes are local-only.
	 */
	restore?: { ref: string; config?: unknown; configVersion?: unknown };
}

export interface GraphOptions {
	name?: string;
	/** Bind to a dispatcher (default = process-global, D26). */
	dispatcher?: Dispatcher;
	/** D109 default node runtime versioning policy for graph-owned nodes. Default is nodev0. */
	versioning?: NodeVersioningPolicy;
	/** Graph-owned environment drivers for source/adapter boundaries (D130/D131). */
	environment?: EnvironmentDrivers;
	/**
	 * Turn on the dispatcher profile recorder (D39 / F-PERF default off). NOTE: this
	 * switches recording on for the WHOLE bound dispatcher (the default is process-global,
	 * D26) — every graph sharing it then pays the recorder cost. For isolated profiling
	 * use a dedicated dispatcher: `graph({ dispatcher: new Dispatcher(), profile: true })`.
	 */
	profile?: boolean;
}

interface Entry {
	node: Node<unknown>;
	id: string;
	name?: string;
	factory: string;
	deps: readonly Node<unknown>[];
	meta?: Record<string, unknown>;
	restore?: { ref: string; config?: unknown; configVersion?: unknown };
}

interface TopologyObserver {
	path?: string;
	sink(event: TopologyEvent): void;
}

interface MountedGraph {
	at: string;
	graph: Graph;
	topologyUnsub?: () => void;
}

interface GraphRestoreRegistrar {
	stateNode<T>(id: string, opts?: SugarOpts<T>): StateNode<T>;
	node<T>(
		id: string,
		factory: string,
		deps: readonly Node<unknown>[],
		fn: NodeFn | null,
		opts?: SugarOpts<T>,
	): Node<T>;
}

const restoreRegistrars = new WeakMap<Graph, GraphRestoreRegistrar>();

interface GraphLifecycleRegistrar {
	assertRegisteredNode(node: Node<unknown>, label: string): void;
	releaseNodes(nodes: readonly Node<unknown>[], opts?: { reason?: string }): void;
}

const lifecycleRegistrars = new WeakMap<Graph, GraphLifecycleRegistrar>();

function nodeOwner(n: Node<unknown>): Graph | undefined {
	return getNodeOwner(n) as Graph | undefined;
}

export function assertGraphLocalNode(owner: Graph, n: Node<unknown>, label: string): void {
	if (isNodeRuntimeReleased(n)) {
		throw new Error(`${label} has been released from its graph lifecycle (D122)`);
	}
	const existing = nodeOwner(n);
	if (existing !== undefined && existing !== owner) {
		throw new Error(
			`${label} belongs to a different graph; cross-graph deps require a wire bridge`,
		);
	}
}

/**
 * A state node (L4-Q1): a manual source whose `.set(v)` is `node.down([[DATA, v]])` sugar.
 * Extends the substrate Node so it is usable as a dep AND carries the graph-layer `.set`.
 */
export class StateNode<T> extends Node<T> {
	set(v: T): void {
		this.down([["DATA", v]]);
	}
}

export interface TopologyGroupOptions {
	/** Optional inspection/release reason label for this graph-owned topology group. */
	name?: string;
}

export interface TopologyGroupReleaseOptions {
	/** Optional diagnostic reason. No protocol/control messages are synthesized. */
	reason?: string;
}

/**
 * Graph-owned D152 release group: a label over ordinary graph-registered nodes.
 * The graph registry remains the source of truth; helper-local membership is only
 * a memo for atomic quiescent release.
 */
export interface TopologyGroup {
	readonly name?: string;
	readonly released: boolean;
	add<T extends Node<unknown>>(node: T): T;
	node<T = unknown>(
		deps?: readonly Node<unknown>[],
		fn?: NodeFn | null,
		opts?: SugarOpts<T>,
	): Node<T>;
	state<T>(initial: T, opts?: SugarOpts<T>): StateNode<T>;
	producer<T = unknown>(fn: NodeFn, opts?: SugarOpts<T>): Node<T>;
	derived<const D extends readonly Node<unknown>[], T>(
		deps: D,
		fn: DerivedFn<D, T>,
		opts?: SugarOpts<T>,
	): Node<T>;
	effect<const D extends readonly Node<unknown>[]>(
		deps: D,
		fn: EffectFn<D>,
		opts?: SugarOpts<void>,
	): Node<void>;
	initNode<TIn, TOut>(
		op: Operator<TIn, TOut>,
		deps: readonly Node<TIn>[],
		opts?: SugarOpts<TOut>,
	): Node<TOut>;
	release(opts?: TopologyGroupReleaseOptions): void;
}

class GraphTopologyGroup implements TopologyGroup {
	readonly name?: string;
	private readonly _graph: Graph;
	private readonly _members: Node<unknown>[] = [];
	private _released = false;

	constructor(graph: Graph, opts: TopologyGroupOptions = {}) {
		this._graph = graph;
		this.name = opts.name;
	}

	get released(): boolean {
		return this._released;
	}

	add<T extends Node<unknown>>(node: T): T {
		this._assertLive();
		const lifecycle = lifecycleRegistrars.get(this._graph);
		if (lifecycle === undefined) throw new Error("topologyGroup: graph lifecycle unavailable");
		lifecycle.assertRegisteredNode(node, `topology group '${this.name ?? "group"}' member`);
		if (!this._members.includes(node)) this._members.push(node);
		return node;
	}

	node<T = unknown>(
		deps: readonly Node<unknown>[] = [],
		fn: NodeFn | null = null,
		opts: SugarOpts<T> = {},
	): Node<T> {
		this._assertLive();
		return this.add(this._graph.node(deps, fn, opts));
	}

	state<T>(initial: T, opts: SugarOpts<T> = {}): StateNode<T> {
		this._assertLive();
		return this.add(this._graph.state(initial, opts));
	}

	producer<T = unknown>(fn: NodeFn, opts: SugarOpts<T> = {}): Node<T> {
		this._assertLive();
		return this.add(this._graph.producer(fn, opts));
	}

	derived<const D extends readonly Node<unknown>[], T>(
		deps: D,
		fn: DerivedFn<D, T>,
		opts: SugarOpts<T> = {},
	): Node<T> {
		this._assertLive();
		return this.add(this._graph.derived(deps, fn, opts));
	}

	effect<const D extends readonly Node<unknown>[]>(
		deps: D,
		fn: EffectFn<D>,
		opts: SugarOpts<void> = {},
	): Node<void> {
		this._assertLive();
		return this.add(this._graph.effect(deps, fn, opts));
	}

	initNode<TIn, TOut>(
		op: Operator<TIn, TOut>,
		deps: readonly Node<TIn>[],
		opts: SugarOpts<TOut> = {},
	): Node<TOut> {
		this._assertLive();
		return this.add(this._graph.initNode(op, deps, opts));
	}

	release(opts: TopologyGroupReleaseOptions = {}): void {
		if (this._released) return;
		const lifecycle = lifecycleRegistrars.get(this._graph);
		if (lifecycle === undefined) throw new Error("topologyGroup: graph lifecycle unavailable");
		lifecycle.releaseNodes([...this._members], {
			reason: opts.reason ?? this.name,
		});
		this._members.length = 0;
		this._released = true;
	}

	private _assertLive(): void {
		if (this._released) {
			throw new Error(`topology group '${this.name ?? "group"}' has been released (D152)`);
		}
	}
}

export class Graph {
	readonly name?: string;
	private readonly _dispatcher: Dispatcher;
	private readonly _versioning: NodeVersioningPolicy | undefined;
	private readonly _environment: EnvironmentDrivers;
	private readonly _core = new NodeCore();
	private readonly _entries = new Map<Node<unknown>, Entry>();
	private readonly _byId = new Map<string, Node<unknown>>();
	private readonly _retiredIds = new Set<string>();
	private readonly _mounts: MountedGraph[] = [];
	private _seq = 0;
	private _clock = 0; // graph-local monotonic clock for observe seq (D26)
	private _topologyObserverSeq = 0;
	private readonly _topologyObservers = new Map<number, TopologyObserver>();
	private _topologyDelivering = false;
	private readonly _topologyQueue: TopologyEvent[] = [];
	// D51: stable synthetic ids for unregistered live deps (runtime *Map inners) auto-discovered by
	// describe(). WeakMap-cached so successive describes agree + the inner's id is freed when it is.
	// A dedicated counter (NOT _seq) so a describe() call never perturbs registered-node id numbering.
	private _synthSeq = 0;
	private readonly _synthIds = new WeakMap<Node<unknown>, string>();

	constructor(opts: GraphOptions = {}) {
		this.name = opts.name;
		this._dispatcher = opts.dispatcher ?? defaultDispatcher;
		this._versioning = opts.versioning;
		this._environment = opts.environment ?? EnvironmentDrivers.empty();
		if (opts.profile) this._dispatcher.setRecording(true);
		restoreRegistrars.set(this, {
			stateNode: <T = unknown>(id: string, stateOpts: SugarOpts<T> = {}) => {
				const n = this._construct(() => new StateNode<T>([], null, this._nodeOpts(stateOpts)));
				this._addWithId(n, "state", [], stateOpts, id);
				return n;
			},
			node: <T = unknown>(
				id: string,
				factory: string,
				deps: readonly Node<unknown>[],
				fn: NodeFn | null,
				nodeOpts: SugarOpts<T> = {},
			) => {
				this._assertDepsLocal(deps, `dep of restored '${id}'`);
				const n = this._construct(() => new Node<T>([...deps], fn, this._nodeOpts(nodeOpts)));
				this._addWithId(n, factory, deps, nodeOpts, id);
				return n;
			},
		});
		lifecycleRegistrars.set(this, {
			assertRegisteredNode: (node, label) => this._assertRegisteredNode(node, label),
			releaseNodes: (nodes, releaseOpts) => this._releaseNodes(nodes, releaseOpts),
		});
	}

	// ── registration / inspection index ──

	private _add<T>(
		n: Node<T>,
		factory: string,
		deps: readonly Node<unknown>[],
		opts: SugarOpts<T>,
	): Node<T> {
		const id = opts.name ?? `${factory}#${this._seq++}`;
		return this._addWithId(n, factory, deps, opts, id);
	}

	private _addWithId<T>(
		n: Node<T>,
		factory: string,
		deps: readonly Node<unknown>[],
		opts: SugarOpts<T>,
		id: string,
	): Node<T> {
		assertGraphLocalNode(this, n as Node<unknown>, `graph node '${opts.name ?? factory}'`);
		for (const dep of deps) assertGraphLocalNode(this, dep, `dep of '${opts.name ?? factory}'`);
		if (this._byId.has(id)) {
			throw new Error(`graph: duplicate node id '${id}' (checkpoint/describe ids must be unique)`);
		}
		if (this._retiredIds.has(id)) {
			throw new Error(`graph: node id '${id}' was released and cannot be reused (D152/D153)`);
		}
		const meta =
			opts.meta === undefined
				? undefined
				: (normalizeTopologyMeta(opts.meta, `graph node '${id}' meta`) as Record<string, unknown>);
		this._entries.set(n as Node<unknown>, {
			node: n as Node<unknown>,
			id,
			name: opts.name,
			factory,
			deps,
			meta,
			restore: opts.restore,
		});
		setNodeOwner(n as Node<unknown>, this);
		this._byId.set(id, n as Node<unknown>);
		setNodeTopologyDepsChangedObserver(n as Node<unknown>, (_node, prevDeps, nextDeps) => {
			this._emitTopologyDepsChanged(n as Node<unknown>, prevDeps, nextDeps);
		});
		const seqMatch = /#(\d+)$/.exec(id);
		if (seqMatch) this._seq = Math.max(this._seq, Number(seqMatch[1]) + 1);
		this._emitTopologyNodeRegistered(n as Node<unknown>);
		return n;
	}

	private _assertDepsLocal(deps: readonly Node<unknown>[], label: string): void {
		for (const dep of deps) assertGraphLocalNode(this, dep, label);
	}

	private _assertRegisteredNode(node: Node<unknown>, label: string): void {
		assertGraphLocalNode(this, node, label);
		if (!this._entries.has(node)) {
			throw new Error(`${label} is not a registered graph node (D152)`);
		}
	}

	private _nodeOpts<T>(opts: SugarOpts<T>): NodeOptions<T> {
		if (opts.meta !== undefined) {
			normalizeTopologyMeta(opts.meta, `graph node '${opts.name ?? opts.factory ?? "node"}' meta`);
		}
		// strip graph-only fields; inject the bound dispatcher
		const { name: _n, meta: _m, restore: _r, ...rest } = opts;
		return {
			...rest,
			versioning: rest.versioning ?? this._versioning,
			dispatcher: this._dispatcher,
		};
	}

	private _construct<TNode extends Node<unknown>>(create: () => TNode): TNode {
		return withEnvironmentDrivers(this._environment, () => withNodeCore(this._core, create));
	}

	/** Look up a registered node by its id. */
	find(id: string): Node<unknown> | undefined {
		return this._byId.get(id);
	}

	private _releaseNodes(nodes: readonly Node<unknown>[], _opts: { reason?: string } = {}): void {
		const seen = new Set<Node<unknown>>();
		const entries: Array<{ node: Node<unknown>; entry: Entry }> = [];
		for (const node of nodes) {
			if (seen.has(node)) continue;
			seen.add(node);
			const entry = this._entries.get(node);
			if (entry === undefined) continue;
			entries.push({ node, entry });
		}
		const releaseSet = new Set(entries.map(({ node }) => node));
		const releaseIds = new Map(entries.map(({ node, entry }) => [node, entry.id] as const));
		for (const entry of this._entries.values()) {
			if (releaseSet.has(entry.node)) continue;
			for (const dep of entry.node.deps) {
				if (!releaseSet.has(dep)) continue;
				const depId = releaseIds.get(dep) ?? dep.name ?? dep.factory ?? "released node";
				throw new Error(
					`graph: cannot release node group; '${entry.id}' still depends on '${depId}' (D122)`,
				);
			}
		}
		for (const { node, entry } of entries) {
			if (!isNodeRuntimeQuiescentForRelease(node)) {
				throw new Error(
					`graph: cannot release node group; '${entry.id}' is not runtime-quiescent (D124)`,
				);
			}
			let internalSubscribers = 0;
			for (const { node: dependent } of entries) {
				if (dependent === node || !isNodeActiveForRelease(dependent)) continue;
				for (const dep of dependent.deps) {
					if (dep === node) internalSubscribers += 1;
				}
			}
			if (subscriberCountOfNode(node) > internalSubscribers) {
				throw new Error(
					`graph: cannot release node group; '${entry.id}' still has live subscribers (D124)`,
				);
			}
		}
		const releasedEvents =
			this._topologyObservers.size === 0
				? []
				: entries.map(({ node, entry }) => ({
						path: entry.id,
						factory: entry.factory,
						deps: this._topologyDeps(node.deps),
					}));
		for (const { node, entry } of entries) {
			this._entries.delete(node);
			this._byId.delete(entry.id);
			this._retiredIds.add(entry.id);
		}
		let releaseError: unknown;
		for (const { node } of entries) {
			try {
				releaseRuntimeOfNode(node);
			} catch (error) {
				if (releaseError === undefined) releaseError = error;
			}
		}
		for (const event of releasedEvents) this._emitTopologyNodeReleased(event);
		if (releaseError !== undefined) throw releaseError;
	}

	// ── 8 verbs (core: node/state/batch + sugar: producer/derived/effect/mount) ──

	/** ctx-level power surface: a raw `(ctx)=>void` fn (or a passthrough/state when null). */
	node<T = unknown>(
		deps: readonly Node<unknown>[] = [],
		fn: NodeFn | null = null,
		opts: SugarOpts<T> = {},
	): Node<T> {
		this._assertDepsLocal(deps, `dep of '${opts.name ?? "node"}'`);
		const n = this._construct(() => new Node<T>(deps as Node<unknown>[], fn, this._nodeOpts(opts)));
		return this._add(n, opts.factory ?? "node", deps, opts);
	}

	/** A manual source with `.set(v)` (L4-Q1). */
	state<T>(initial: T, opts: SugarOpts<T> = {}): StateNode<T> {
		const n = this._construct(
			() => new StateNode<T>([], null, { ...this._nodeOpts(opts), initial }),
		);
		this._add(n, "state", [], opts);
		return n;
	}

	/** ctx-level depless source; its fn runs on activation (R-rom-ram). */
	producer<T = unknown>(fn: NodeFn, opts: SugarOpts<T> = {}): Node<T> {
		const n = this._construct(() => new Node<T>([], fn, this._nodeOpts(opts)));
		return this._add(n, "producer", [], opts);
	}

	/** value-level pure transform: deps → value (D27 wrapped; D30 throw→ERROR). */
	derived<const D extends readonly Node<unknown>[], T>(
		deps: D,
		fn: DerivedFn<D, T>,
		opts: SugarOpts<T> = {},
	): Node<T> {
		this._assertDepsLocal(deps, `dep of '${opts.name ?? "derived"}'`);
		const ctxFn: NodeFn = (ctx: Ctx) => {
			try {
				const args = Array.from({ length: depCount(ctx) }, (_, i) =>
					depLatest(ctx, i),
				) as DepValues<D>;
				const result = fn(...args);
				if (result !== undefined) ctx.down([["DATA", result]]);
			} catch (e) {
				ctx.down([["ERROR", errorPayload(e, "derived threw without a valid error payload")]]); // D30: value-level throw → graph-layer ERROR
			}
		};
		const n = this._construct(() => new Node<T>([...deps], ctxFn, this._nodeOpts(opts)));
		return this._add(n, "derived", deps, opts);
	}

	/** value-level sink: deps → effect; return value (a fn) becomes onDeactivation (D28). */
	effect<const D extends readonly Node<unknown>[]>(
		deps: D,
		fn: EffectFn<D>,
		opts: SugarOpts<void> = {},
	): Node<void> {
		this._assertDepsLocal(deps, `dep of '${opts.name ?? "effect"}'`);
		// effect cleanup = deactivation-only (D28 / Flag 3): the LATEST returned cleanup
		// fires ONCE when the effect deactivates (not between re-runs — onRerun was cut).
		// R-cleanup-hooks per-run lifecycle (D28 clarification / C-14): the substrate clears
		// the hook list before EACH fn run, so the effect re-registers its returned cleanup
		// every run — only the latest run's registration is live (or none, if the latest run
		// returned void). No st.registered/ctx.state bookkeeping; re-registering every run is
		// safe (the per-run clear prevents accumulation).
		const ctxFn: NodeFn = (ctx: Ctx) => {
			try {
				const args = Array.from({ length: depCount(ctx) }, (_, i) =>
					depLatest(ctx, i),
				) as DepValues<D>;
				const cleanup = fn(...args);
				if (typeof cleanup === "function") ctx.onDeactivation(cleanup);
			} catch (e) {
				ctx.down([["ERROR", errorPayload(e, "effect threw without a valid error payload")]]);
			}
		};
		const n = this._construct(() => new Node<void>([...deps], ctxFn, this._nodeOpts(opts)));
		return this._add(n, "effect", deps, opts);
	}

	/** Declarative batch (D12): one wave, success→commit / throw→rollback. */
	batch<T>(fn: (bctx: BatchCtx) => T): T {
		return batchRun(fn);
	}

	/** Embed a child graph addressable under `at` (R-mount; mount has no deps). */
	mount(child: Graph, opts: { at: string }): void {
		const mount = { at: opts.at, graph: child };
		this._mounts.push(mount);
		if (this._topologyObservers.size > 0) this._ensureMountedTopologyForwarders();
		this._emitTopologyMountChanged(opts.at);
	}

	// ── operator funnel (D43): instantiate any free-standing Operator (node sugar, D6/L1.5) ──
	// g.initNode is the single graph-bound entry for the whole operator/source catalog (D40):
	// it delegates to the FREE initNode (graph/operators.ts — the D30 throw→ERROR boundary +
	// dispatcher binding live there) and records the operator's REAL factory name in the
	// inspection index (_add) so describe shows it (D6/R-describe) while the node stays thin
	// (R-node-thin). Operators are free-standing factory definitions (graph/operators.ts,
	// graph/sources.ts) usable bare via the free initNode(); this funnel is the inspectable
	// path. Replaces the per-operator methods.

	/**
	 * Instantiate an operator (or source) factory as a registered graph node. `deps` are
	 * type-checked against the operator's input element type; the output type flows from the
	 * operator. A source is a depless operator — pass `[]`. Caller `opts` (name/meta/behavioral
	 * overrides) win over the operator's baked-in `opts`.
	 */
	initNode<TIn, TOut>(
		op: Operator<TIn, TOut>,
		deps: readonly Node<TIn>[],
		opts: SugarOpts<TOut> = {},
	): Node<TOut> {
		const entryOpts =
			op.restore !== undefined && !("restore" in opts) ? { ...opts, restore: op.restore } : opts;
		for (const dep of deps as readonly Node<unknown>[])
			assertGraphLocalNode(this, dep, `dep of '${entryOpts.name ?? op.factory}'`);
		// Node<T> is invariant (T appears in NodeOptions.initial); widen the typed deps to the
		// erased Node surface the free initNode / _add accept (same cast the old methods used).
		const erased = deps as readonly Node<unknown>[];
		const n = withEnvironmentDrivers(this._environment, () =>
			initNodeWithCore(this._core, op, erased, this._nodeOpts(entryOpts)),
		);
		return this._add(n, op.factory, erased, entryOpts);
	}

	/**
	 * Graph-owned activation root for internal helper nodes. This is the sanctioned keepalive shape:
	 * a graph, not a helper closure, owns the subscription and returns the release handle.
	 */
	retain<T>(node: Node<T>, opts: { reason?: string } = {}): () => void {
		assertGraphLocalNode(this, node as Node<unknown>, opts.reason ?? "retained node");
		return node.subscribe(() => {});
	}

	/**
	 * D152 graph-owned topology/release group. Members are ordinary registered graph nodes;
	 * release is quiescent-only and removes ids atomically without synthesizing protocol messages.
	 */
	topologyGroup(opts: TopologyGroupOptions = {}): TopologyGroup {
		return new GraphTopologyGroup(this, opts);
	}

	// ── inspection: describe / observe / profile (D39) ──

	/** Live point-in-time structure snapshot (R-describe / D39 / D51). `_prefix` carries the mount path. */
	describe(opts: DescribeOpts = {}, _prefix = ""): DescribeSnapshot {
		// D51: edges derive from each node's CURRENT/LIVE deps (entry.node.deps, NOT the
		// construction-time entry.deps), so a rewire (C-8 immediate / C-11 *Map deferred) is
		// reflected and every edge is a real current subscription (D3). A live dep absent from this
		// graph's index (a runtime *Map inner / bare fromAny node) is AUTO-DISCOVERED as a snapshot
		// node with a synthesized stable id (B2). B38 extends this to transitive live-reachability:
		// discovered unregistered nodes are recursively expanded through their own live deps.
		const discovered = new Map<Node<unknown>, string>(); // unregistered live dep → synth local id
		const localId = (n: Node<unknown>): string => {
			const e = this._entries.get(n);
			if (e) return `${_prefix}${e.id}`;
			// unregistered: a stable synthetic id, cached so successive describes + both call sites
			// agree; the `~` prefix can't collide with a registered name or `factory#seq`.
			let sid = this._synthIds.get(n);
			if (sid === undefined) {
				// the `~` prefix avoids the registered `name`/`factory#seq` space; guard the
				// pathological case of a user node literally named `~factory#n` (bump until free).
				do {
					sid = `~${n.factory ?? "?"}#${this._synthSeq++}`;
				} while (this._byId.has(sid));
				this._synthIds.set(n, sid);
			}
			discovered.set(n, sid);
			return `${_prefix}${sid}`;
		};
		const nodes: DescribeNode[] = [];
		const edges: DescribeEdge[] = [];
		// pass 1: registered nodes, reading LIVE deps (localId records any unregistered inner).
		for (const entry of this._entries.values()) {
			const id = `${_prefix}${entry.id}`;
			const liveIds = entry.node.deps.map(localId);
			const dnode: DescribeNode = {
				id,
				factory: entry.factory,
				status: entry.node.status,
				deps: liveIds,
			};
			if (entry.name !== undefined) dnode.name = entry.name;
			if (entry.node.cache !== undefined) dnode.value = entry.node.cache; // absent = SENTINEL
			if (entry.node.version !== undefined) dnode.version = entry.node.version;
			if (entry.meta !== undefined) dnode.meta = entry.meta;
			nodes.push(dnode);
			for (const from of liveIds) edges.push({ from, to: id });
		}
		// pass 2: recursively emit auto-discovered unregistered nodes (D51+B38). localId() may add
		// further unregistered deps to `discovered` while this loop runs; a visited set keeps each
		// discovered node emitted once (stable ids via _synthIds).
		const visited = new Set<Node<unknown>>();
		const queue: Node<unknown>[] = [...discovered.keys()];
		for (let i = 0; i < queue.length; i += 1) {
			const inner = queue[i];
			if (visited.has(inner)) continue;
			visited.add(inner);
			const sid = discovered.get(inner);
			if (sid === undefined) continue;
			const liveIds = inner.deps.map(localId);
			for (const dep of inner.deps) {
				if (!this._entries.has(dep) && !visited.has(dep)) queue.push(dep);
			}
			const dnode: DescribeNode = {
				id: `${_prefix}${sid}`,
				factory: inner.factory ?? "?",
				status: inner.status,
				deps: liveIds,
			};
			if (inner.cache !== undefined) dnode.value = inner.cache;
			if (inner.version !== undefined) dnode.version = inner.version;
			nodes.push(dnode);
			for (const from of liveIds) edges.push({ from, to: dnode.id });
		}
		const snap: DescribeSnapshot = { nodes, edges };
		if (this.name !== undefined) snap.name = this.name;
		if (this._mounts.length > 0) {
			snap.subgraphs = this._mounts.map((m) => m.graph.describe({}, `${_prefix}${m.at}::`));
		}
		return opts.explain ? explainSubset(snap, opts.explain) : snap;
	}

	/**
	 * D173 pure-structure topology snapshot over the same live truth source as describe().
	 * Runtime status/value/version remain on describe(); blueprint metadata is a later envelope.
	 */
	topology(): GraphTopologySnapshot {
		return topologyFromDescribe(this.describe());
	}

	/**
	 * D177 synchronous audit/collaboration envelope over the pure topology snapshot.
	 * Hashing and environment provenance enrichment stay in pure helpers outside Graph core.
	 */
	blueprint(opts: GraphBlueprintOptions = {}): GraphBlueprint {
		const topology = normalizeTopology(this.topology());
		const out: GraphBlueprint = {
			version: GRAPH_BLUEPRINT_VERSION,
			topology,
		};
		if (opts.diagnostics) {
			(out as { diagnostics?: ReturnType<typeof graphBlueprintDiagnostics> }).diagnostics =
				graphBlueprintDiagnostics(topology);
		}
		if (opts.provenance !== undefined) {
			(out as { provenance?: GraphBlueprint["provenance"] }).provenance = normalizeTopologyMeta(
				opts.provenance,
				"graph blueprint provenance",
				"provenance",
			);
		}
		return out;
	}

	private _observeTargets(path?: string): Array<[string, Node<unknown>]> {
		const all: Array<[string, Node<unknown>]> = [...this._entries.values()].map((e) => [
			e.id,
			e.node,
		]);
		if (path === undefined) return all; // whole graph
		const exact = this._byId.get(path);
		if (exact) return [[path, exact]]; // single node
		return all.filter(([id]) => id.startsWith(`${path}::`)); // subtree (mount-aware :: boundary, QA A-1)
	}

	/**
	 * observe(path?) = read-only enveloped EGRESS (R-observe / D39). NOT a graph node — it
	 * taps the target node(s) via subscribe and forwards each Message as an ObserveEvent.
	 * No path = whole graph; an exact id = a single node; otherwise a `::`-prefix subtree.
	 */
	// NOTE (R-observe/D19): observe is a real, lazily-ACTIVATING subscriber — observing a
	// cold node runs its fn (and activates upstream); whole-graph observe() activates the
	// graph. "Read-only" means it never emits/mutates node state, NOT that it avoids
	// activation. Use it knowing inspection of a cold graph wakes it.
	observe(path?: string): ObserveStream {
		const targets = this._observeTargets(path);
		return {
			subscribe: (sink) => {
				const unsubs = targets.map(([id, n]) =>
					n.subscribe((msg) => {
						sink({ path: id, msg, tier: messageTier(msg[0]), seq: this._clock++ });
					}),
				);
				return () => {
					for (const u of unsubs) u();
				};
			},
		};
	}

	/**
	 * D145 observeTopology(path?) = read-only graph lifecycle egress over the existing
	 * graph registry. It is not a graph node, does not subscribe to nodes, and emits no DATA.
	 */
	observeTopology(path?: string): TopologyStream {
		return {
			subscribe: (sink) => {
				const id = this._topologyObserverSeq++;
				this._topologyObservers.set(id, { path, sink });
				this._ensureMountedTopologyForwarders();
				return () => {
					this._topologyObservers.delete(id);
					if (this._topologyObservers.size === 0) this._releaseMountedTopologyForwarders();
				};
			},
		};
	}

	private _idForTopologyNode(n: Node<unknown>): string {
		const e = this._entries.get(n);
		if (e) return e.id;
		let sid = this._synthIds.get(n);
		if (sid === undefined) {
			do {
				sid = `~${n.factory ?? "?"}#${this._synthSeq++}`;
			} while (this._byId.has(sid));
			this._synthIds.set(n, sid);
		}
		return sid;
	}

	private _topologyDeps(deps: readonly Node<unknown>[]): string[] {
		return deps.map((dep) => this._idForTopologyNode(dep));
	}

	private _emitTopologyNodeRegistered(node: Node<unknown>): void {
		if (this._topologyObservers.size === 0) return;
		const entry = this._entries.get(node);
		if (entry === undefined) return;
		this._emitTopologyEvent({
			kind: "node-registered",
			path: entry.id,
			factory: entry.factory,
			deps: this._topologyDeps(node.deps),
			seq: this._clock++,
		});
	}

	private _emitTopologyDepsChanged(
		node: Node<unknown>,
		prevDeps: readonly Node<unknown>[],
		nextDeps: readonly Node<unknown>[],
	): void {
		if (this._topologyObservers.size === 0) return;
		const entry = this._entries.get(node);
		if (entry === undefined) return;
		this._emitTopologyEvent({
			kind: "deps-changed",
			path: entry.id,
			prevDeps: this._topologyDeps(prevDeps),
			deps: this._topologyDeps(nextDeps),
			seq: this._clock++,
		});
	}

	private _emitTopologyNodeReleased(event: {
		path: string;
		factory: string;
		deps: readonly string[];
	}): void {
		if (this._topologyObservers.size === 0) return;
		this._emitTopologyEvent({
			kind: "node-released",
			path: event.path,
			factory: event.factory,
			deps: [...event.deps],
			seq: this._clock++,
		});
	}

	private _emitTopologyMountChanged(path: string): void {
		if (this._topologyObservers.size === 0) return;
		this._emitTopologyEvent({
			kind: "mount-changed",
			path,
			factory: "mount",
			deps: [],
			seq: this._clock++,
		});
	}

	private _ensureMountedTopologyForwarders(): void {
		if (this._topologyObservers.size === 0) return;
		for (const mount of this._mounts) {
			if (mount.topologyUnsub !== undefined) continue;
			const mountPath = mount.at;
			mount.topologyUnsub = mount.graph.observeTopology().subscribe((event) => {
				this._emitMountedTopologyEvent(mountPath, event);
			});
		}
	}

	private _releaseMountedTopologyForwarders(): void {
		for (const mount of this._mounts) {
			mount.topologyUnsub?.();
			mount.topologyUnsub = undefined;
		}
	}

	private _emitMountedTopologyEvent(mountPath: string, event: TopologyEvent): void {
		if (this._topologyObservers.size === 0) return;
		this._emitTopologyEvent({
			kind: event.kind,
			path: prefixTopologyPath(mountPath, event.path),
			deps: event.deps.map((dep) => prefixTopologyPath(mountPath, dep)),
			...(event.prevDeps !== undefined
				? { prevDeps: event.prevDeps.map((dep) => prefixTopologyPath(mountPath, dep)) }
				: {}),
			...(event.factory !== undefined ? { factory: event.factory } : {}),
			seq: this._clock++,
		});
	}

	private _emitTopologyEvent(event: TopologyEvent): void {
		if (this._topologyDelivering) {
			this._topologyQueue.push(event);
			return;
		}
		this._topologyDelivering = true;
		try {
			let current: TopologyEvent | undefined = event;
			while (current !== undefined) {
				const observers = [...this._topologyObservers.entries()];
				for (const [id, observer] of observers) {
					if (this._topologyObservers.get(id) !== observer) continue;
					if (observer.path !== undefined && !topologyPathMatches(current.path, observer.path))
						continue;
					try {
						observer.sink(cloneTopologyEvent(current));
					} catch {
						// D145 egress is read-only inspection; observer failure must not veto a
						// graph registry/rewire mutation that already committed.
					}
				}
				current = this._topologyQueue.shift();
			}
		} finally {
			this._topologyDelivering = false;
		}
	}

	/**
	 * profile() = accumulated-counter snapshot (R-profile / D39). invokes + duration are
	 * dispatcher-backed (the invoke funnel, F-DISPATCH-ALL) — counters never live on the
	 * thin node (R-node-thin). Requires `graph({ profile: true })` (opt-in, F-PERF).
	 */
	profile(): Profile {
		const nodes: Record<string, NodeProfile> = {};
		let totalInvokes = 0;
		for (const e of this._entries.values()) {
			const h = e.node.handle;
			const stat = h ? this._dispatcher.statFor(h) : undefined;
			const invokes = stat?.invokes ?? 0;
			nodes[e.id] = {
				invokes,
				totalDurationNs: stat?.totalDurationNs ?? 0,
				lastDurationNs: stat?.lastDurationNs ?? 0,
				status: e.node.status,
			};
			// graph-scoped (QA D-2): sum THIS graph's nodes, NOT the dispatcher-global
			// counter (which would leak invokes from other graphs sharing the dispatcher).
			totalInvokes += invokes;
		}
		return { totalInvokes, nodes };
	}

	/** Versioned graph lifecycle checkpoint (R-snapshot / D83 / D90). Pure capture, no storage I/O. */
	checkpoint(): GraphCheckpoint {
		return this._checkpoint("", new WeakSet());
	}

	private _checkpoint(_prefix: string, stack: WeakSet<Graph>): GraphCheckpoint {
		if (stack.has(this)) {
			throw new Error("checkpoint: cyclic graph mount detected");
		}
		stack.add(this);
		const discovered = new Map<Node<unknown>, string>();
		const localId = (n: Node<unknown>): string => {
			const e = this._entries.get(n);
			if (e) return `${_prefix}${e.id}`;
			let sid = this._synthIds.get(n);
			if (sid === undefined) {
				do {
					sid = `~${n.factory ?? "?"}#${this._synthSeq++}`;
				} while (this._byId.has(sid));
				this._synthIds.set(n, sid);
			}
			discovered.set(n, sid);
			return `${_prefix}${sid}`;
		};
		const nodes: GraphCheckpointNode[] = [];
		const edges: DescribeEdge[] = [];
		for (const entry of this._entries.values()) {
			const id = `${_prefix}${entry.id}`;
			const liveIds = entry.node.deps.map(localId);
			nodes.push(
				this._checkpointNode(entry.node, id, {
					name: entry.name,
					factory: checkpointFactory(entry.factory, entry.node, false, entry.restore, entry.meta),
					deps: liveIds,
					meta: entry.meta,
				}),
			);
			for (const from of liveIds) edges.push({ from, to: id });
		}
		const visited = new Set<Node<unknown>>();
		const queue: Node<unknown>[] = [...discovered.keys()];
		for (let i = 0; i < queue.length; i += 1) {
			const inner = queue[i];
			if (visited.has(inner)) continue;
			visited.add(inner);
			const sid = discovered.get(inner);
			if (sid === undefined) continue;
			const liveIds = inner.deps.map(localId);
			for (const dep of inner.deps) {
				if (!this._entries.has(dep) && !visited.has(dep)) queue.push(dep);
			}
			const id = `${_prefix}${sid}`;
			nodes.push(
				this._checkpointNode(inner, id, {
					factory: checkpointFactory(inner.factory ?? "?", inner, true),
					deps: liveIds,
				}),
			);
			for (const from of liveIds) edges.push({ from, to: id });
		}
		const checkpoint: GraphCheckpoint = {
			version: GRAPH_CHECKPOINT_VERSION,
			nodes,
			edges,
		};
		if (this.name !== undefined) checkpoint.name = this.name;
		if (this._mounts.length > 0) {
			checkpoint.mounts = this._mounts.map((m) => ({
				at: m.at,
				checkpoint: m.graph._checkpoint("", stack),
			}));
		}
		stack.delete(this);
		return toCheckpointJson(checkpoint, "checkpoint") as unknown as GraphCheckpoint;
	}

	private _checkpointNode(
		node: Node<unknown>,
		id: string,
		opts: {
			name?: string;
			factory: GraphCheckpointFactory;
			deps: string[];
			meta?: Record<string, unknown>;
		},
	): GraphCheckpointNode {
		const state = checkpointStateOfNode(node);
		assertCheckpointQuiescentStatus(node.status, id, "checkpoint");
		const nonAuthoritativeCollectionHelper = isNonAuthoritativeCollectionHelperMeta(opts.meta);
		const out: GraphCheckpointNode = {
			id,
			factory: opts.factory,
			status: node.status,
			deps: opts.deps,
			value: nonAuthoritativeCollectionHelper
				? { kind: "SENTINEL" }
				: checkpointValue(state.cache, state.hasData, `${id}.value`),
			terminal: checkpointTerminal(state.terminal, `${id}.terminal`),
			lifecycle: { activated: state.activated, hasCalledFnOnce: state.hasCalledFnOnce },
			ctxState: {
				persist: state.ctxState.persist,
				value: nonAuthoritativeCollectionHelper
					? { kind: "SENTINEL" }
					: checkpointValue(
							state.ctxState.value,
							state.ctxState.value !== SENTINEL,
							`${id}.ctxState`,
						),
			},
		};
		if (opts.name !== undefined) out.name = opts.name;
		const backendState = checkpointBackendStateOfNode(node, `${id}.backendState`);
		if (backendState !== undefined) out.backendState = backendState;
		if (state.version !== undefined) out.version = state.version;
		if (opts.meta !== undefined)
			out.meta = toCheckpointJson(opts.meta, `${id}.meta`) as {
				[key: string]: GraphCheckpointJson;
			};
		return out;
	}
}

function isNonAuthoritativeCollectionHelperMeta(
	meta: Record<string, unknown> | undefined,
): boolean {
	return (
		meta?.kind === "collection_delta" ||
		meta?.kind === "collection_intent" ||
		meta?.kind === "collection_policy_apply" ||
		meta?.kind === "collection_snapshot" ||
		meta?.kind === "collection_snapshot_prep"
	);
}

function assertCheckpointQuiescentStatus(status: string, id: string, op: string): void {
	if (status === "pending" || status === "dirty") {
		throw new Error(
			`${op}: node '${id}' has non-quiescent status '${status}' that cannot be checkpoint-restored yet`,
		);
	}
}

function topologyPathMatches(eventPath: string, path: string): boolean {
	return eventPath === path || eventPath.startsWith(`${path}::`);
}

function prefixTopologyPath(prefix: string, path: string): string {
	return `${prefix}::${path}`;
}

function cloneTopologyEvent(event: TopologyEvent): TopologyEvent {
	const deps = Object.freeze([...event.deps]);
	const prevDeps = event.prevDeps === undefined ? undefined : Object.freeze([...event.prevDeps]);
	return Object.freeze({
		kind: event.kind,
		path: event.path,
		deps,
		...(prevDeps !== undefined ? { prevDeps } : {}),
		...(event.factory !== undefined ? { factory: event.factory } : {}),
		seq: event.seq,
	});
}

function checkpointFactory(
	name: string,
	node: Node<unknown>,
	unregistered: boolean,
	restore?: { ref: string; config?: unknown; configVersion?: unknown },
	meta?: Record<string, unknown>,
): GraphCheckpointFactory {
	const state = checkpointStateOfNode(node);
	if (unregistered) {
		return {
			kind: "local-only",
			name,
			reason: "node is an unregistered live dependency auto-discovered from topology",
		};
	}
	if (
		restore === undefined &&
		typeof meta?.kind === "string" &&
		meta.kind.startsWith("collection_")
	) {
		return {
			kind: "local-only",
			name,
			reason: "collection helper node has no backend checkpoint restore metadata",
		};
	}
	if (restore !== undefined) {
		const out: GraphCheckpointFactory = {
			kind: "registry-ref",
			ref: toCheckpointJson(restore.ref, `${name}.factory.ref`) as string,
		};
		if (restore.config !== undefined)
			out.config = toCheckpointJson(restore.config, `${name}.factory.config`);
		if (restore.configVersion !== undefined)
			out.configVersion = toCheckpointJson(restore.configVersion, `${name}.factory.configVersion`);
		return out;
	}
	if (state.handle !== null) {
		return {
			kind: "local-only",
			name,
			reason: "node uses a function body; first-cut checkpoints do not serialize local functions",
		};
	}
	return { kind: "registry-ref", ref: name };
}

/** Filter a snapshot to the causal chain from→to (forward-reachable(from) ∩ back-reachable(to)). */
function explainSubset(
	snap: DescribeSnapshot,
	chain: { from: string; to: string },
): DescribeSnapshot {
	const fwd = new Map<string, string[]>();
	const rev = new Map<string, string[]>();
	const push = (map: Map<string, string[]>, k: string, v: string): void => {
		const a = map.get(k);
		if (a) a.push(v);
		else map.set(k, [v]);
	};
	for (const e of snap.edges) {
		push(fwd, e.from, e.to);
		push(rev, e.to, e.from);
	}
	const reach = (start: string, adj: Map<string, string[]>): Set<string> => {
		const seen = new Set<string>([start]);
		const stack = [start];
		while (stack.length > 0) {
			const cur = stack.pop() as string;
			for (const nxt of adj.get(cur) ?? []) {
				if (!seen.has(nxt)) {
					seen.add(nxt);
					stack.push(nxt);
				}
			}
		}
		return seen;
	};
	const onPath = new Set([...reach(chain.from, fwd)].filter((id) => reach(chain.to, rev).has(id)));
	return {
		...(snap.name !== undefined ? { name: snap.name } : {}),
		nodes: snap.nodes.filter((n) => onPath.has(n.id)),
		edges: snap.edges.filter((e) => onPath.has(e.from) && onPath.has(e.to)),
	};
}

/** Construct a Graph (default global dispatcher; L4-Q4). */
export function graph(opts: GraphOptions = {}): Graph {
	return new Graph(opts);
}

/** @internal D122 graph-owned ephemeral node-group release. */
export function releaseGraphNodes(
	graph: Graph,
	nodes: readonly Node<unknown>[],
	opts: { reason?: string } = {},
): void {
	const registrar = lifecycleRegistrars.get(graph);
	if (registrar === undefined) throw new Error("graph: unknown lifecycle registrar");
	registrar.releaseNodes(nodes, opts);
}

/** @internal D94 descriptor path: register a restored state node without widening Graph. */
export function restoreStateNodeInGraph<T = unknown>(
	graph: Graph,
	id: string,
	opts: SugarOpts<T> = {},
): StateNode<T> {
	const registrar = restoreRegistrars.get(graph);
	if (registrar === undefined) throw new Error("restoreGraph: unknown graph restore registrar");
	return registrar.stateNode(id, opts);
}

/** @internal D94 descriptor path: register a restored ctx-level node without widening Graph. */
export function restoreNodeInGraph<T = unknown>(
	graph: Graph,
	id: string,
	factory: string,
	deps: readonly Node<unknown>[],
	fn: NodeFn | null,
	opts: SugarOpts<T> = {},
): Node<T> {
	const registrar = restoreRegistrars.get(graph);
	if (registrar === undefined) throw new Error("restoreGraph: unknown graph restore registrar");
	return registrar.node(id, factory, deps, fn, opts);
}
