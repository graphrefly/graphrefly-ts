import { nodeOwnerForGraphUse, runtimeReleaseFailuresOfNode } from "../node/runtime-accessors.js";
import type { OwnedConstruction } from "./construction-scope.js";

/**
 * The Graph layer (CSP-2): convenience + inspection entry (D5 / R-graph-surface).
 *
 * g.* sugar desugars to dispatcher.register + Node and auto-registers into the graph
 * inspection index (D27: sugar→ctx-fn conversion lives strictly here; the substrate node
 * only ever sees `(ctx)=>void`). The Graph owns naming, describe, mount, and the D30
 * value-level throw→ERROR boundary. The bare node()/dispatcher stay inspection-free
 * (R-node-thin).
 *
 * Canonical authority: ~/src/graphrefly — D3/D5/D27/D30/D36/D37/D39, R-graph-surface,
 * R-invocation, R-edges-derived, R-meta-presentation.
 */

import type { Ctx, NodeFn } from "../ctx/types.js";
import {
	idle,
	Kernel,
	batch as kernelBatch,
	kOf,
	observeFailures,
	replacedInputs,
} from "../node/kernel.js";
import { assertLocalName } from "../node/naming.js";
import {
	checkpointStateOfNode,
	getNodeOwner,
	hostOfKernel,
	hostWithDeps,
	isNodeActiveForRelease,
	isNodeRuntimeQuiescentForRelease,
	isNodeRuntimeReleased,
	makeNode,
	Node,
	type NodeOptions,
	nodeCreationIndex,
	nodeDefinition,
	nodeReplace,
	type OperatorHost,
	releaseRuntimeOfNode,
	StateNode,
	setGraphNodeIdResolver,
	setNodeOwner,
	setNodeTopologyDepsChangedObserver,
	subscriberCountOfNode,
} from "../node/node.js";
import {
	constructionAcquisitions,
	failNodeAcquisition,
	type NodeAcquisition,
} from "../node/owned-acquisition.js";
import type { NodeDefinition, NodeSeed, ReplaceOptions } from "../node/types.js";
import { errorPayload, SENTINEL } from "../protocol/messages.js";
import { normalizeTopologyMeta } from "./blueprint.js";
import {
	CHECKPOINT_REFUSAL,
	checkpointBackendStateOfNode,
	checkpointJsonOf,
	checkpointTerminal,
	GRAPH_CHECKPOINT_FORMAT,
	type GraphCheckpoint,
	type GraphCheckpointJson,
	type GraphCheckpointLifetime,
	type GraphCheckpointNode,
	type GraphCheckpointRecipe,
	type GraphCheckpointSugar,
	notRestorable,
	toCheckpointJson,
} from "./checkpoint.js";
import type { DescribedNode, RenderEdge, RenderSnapshot } from "./describe.js";
import { EnvironmentDrivers } from "./environment.js";
import { type GraphLifecycleRegistrar, graphRegistrations } from "./graph-lifecycle.js";
import {
	assertCheckpointQuiescentStatus,
	cloneTopologyEvent,
	isNonAuthoritativeCollectionHelperMeta,
	prefixTopologyPath,
	topologyPathMatches,
} from "./graph-support.js";
import type { DerivedFn, EffectFn, GraphOptions, SugarOpts } from "./graph-types.js";
import {
	type NodeProfile,
	type ObserveEvent,
	observeTopology,
	type Profile,
	type TopologyEvent,
	type TopologyStream,
} from "./inspect.js";
import { initNodeWithCore, type Operator } from "./operators.js";
import { realNodeFn, receivedInNote, restoredFirstRun } from "./restore-first-run.js";

export type {
	TopologyGroup,
	TopologyGroupOptions,
	TopologyGroupReleaseOptions,
} from "./graph-topology-group.js";
export type {
	DerivedFn,
	EffectFn,
	GraphOptions,
	HostFailure,
	HostReporter,
	SugarOpts,
	SugarRecipe,
} from "./graph-types.js";

interface Entry {
	node: Node<unknown>;
	id: string;
	name?: string;
	factory: string;
	deps: readonly Node<unknown>[];
	meta?: Record<string, unknown>;
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

function nodeOwner(n: Node<unknown>): Graph | undefined {
	return getNodeOwner(n) as Graph | undefined;
}

export function assertGraphLocalNode(owner: Graph, n: Node<unknown>, label: string): void {
	const existing = nodeOwnerForGraphUse(n, label);
	if (existing !== undefined && existing !== owner) {
		throw new Error(
			`${label} belongs to a different graph; cross-graph deps require a wire bridge`,
		);
	}
}

const graphsByCore = new WeakMap<Kernel, Graph>();
/** A profiling wrapper's function as it was given, for definition() (graphrefly-ts:D193 (2)). */
const profiledFns = new WeakMap<NodeFn, NodeFn>();
/** A helper node built outside the graph index gets a synthetic id when described. */
const helperIds = new WeakMap<Node<unknown>, string>();

/**
 * Own a single graph-local topology, lifecycle, inspection index, and dispatcher boundary.
 *
 * @example
 * ```ts
 * import { graph } from "@graphrefly/ts/graph";
 *
 * const g = graph({ name: "counter" });
 * const count = g.state(0, { name: "count" });
 * const doubled = g.derived([count], (value) => value * 2, { name: "doubled" });
 * ```
 * @remarks **Graph-local:** Cross-graph dependencies require a wire bridge; direct deps stay inside
 *   one graph ownership domain.
 * @category graph
 */
export class Graph {
	/** graphrefly-ts:D193 (2): per-node invocation counts while profiling is on. */
	private readonly _profile: WeakMap<Node<unknown>, NodeInvocationStat> | undefined;
	private readonly _core = new Kernel();
	private readonly _entries = new Map<Node<unknown>, Entry>();
	private readonly _byId = new Map<string, Node<unknown>>();
	private readonly _retiredIds = new Set<string>();
	private readonly _mounts: MountedGraph[] = [];
	private _seq = 0;
	private _clock = 0; // graph-local monotonic clock for topology event seq (D145)
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: internal registrar lifecycle counter.
	private _topologyObserverSeq = 0;
	private readonly _topologyObservers = new Map<number, TopologyObserver>();
	private _topologyDelivering = false;
	private readonly _topologyQueue: TopologyEvent[] = [];
	// Synthetic ids use their helper's existing runtime slot, preserving identity across rewires.
	private _synthSeq = 0;
	private readonly _helperIdsInUse = new Set<string>();

	constructor(opts: GraphOptions = {}) {
		this._core.environment = opts.environment ?? EnvironmentDrivers.empty();
		this._profile = opts.profile ? new WeakMap() : undefined;
		this._core.report = opts.report;
		this._core.requireRecipe = opts.requireRecipe === true;
		this._core.resolveId = (id) => {
			const n = this._byId.get(id);
			return n === undefined ? undefined : kOf(n);
		};
		this._core.idOf = (n) => this._idForTopologyNode(n.node);
		this._core.registeredIdOf = (n) => this._entries.get(n.node)?.id;
		graphsByCore.set(this._core, this);
		graphRegistrations.set(this, new GraphRegistration(this, opts.name));
	}

	// ── registration / inspection index ──

	/** D167: retain acquisition ownership until Graph publication, including operator factories. */
	private _createRegistered<T, N extends Node<T> = Node<T>>(
		factory: string,
		deps: readonly Node<unknown>[],
		opts: SugarOpts<T>,
		create: (nodeOpts: NodeOptions<T>, acquired: NodeAcquisition) => N,
		id?: string,
		supplied?: NodeAcquisition,
	): N {
		this._assertDepsLocal(deps, `dep of '${opts.name ?? factory}'`);
		const name = id ?? opts.name;
		if (name !== undefined) this._assertAvailableId(name);
		// R-checkpoint: a node a restore builds gets its seed at construction (graphrefly-ts:D194).
		const restoring = name === undefined ? undefined : restoreSeeds.get(this)?.get(name);
		const plainOpts =
			name === undefined ? this._nodeOpts(opts) : { ...this._nodeOpts(opts), id: name };
		const nodeOpts = restoring === undefined ? plainOpts : { ...plainOpts, seed: restoring.seed };
		const acquired = supplied ?? { name: name ?? factory };
		constructionAcquisitions.set(nodeOpts, acquired);
		try {
			const n = create(nodeOpts, acquired);
			this._addWithId(n, factory, deps, opts, name ?? `${factory}#${this._seq++}`, acquired);
			if (restoring !== undefined) {
				restoreSeeds.get(this)?.delete(name as string);
				// Its first run compares what it had received (R-checkpoint), before any profiling.
				const record = kOf(n);
				if (restoring.firstRun && record.fn !== null) record.fn = restoredFirstRun(record.fn);
			}
			this._profileFn(n);
			return n;
		} catch (cause) {
			if (supplied !== undefined || acquired.registered) throw cause;
			failNodeAcquisition(acquired, cause);
		} finally {
			constructionAcquisitions.delete(nodeOpts);
		}
	}
	private _assertAvailableId(id: string): void {
		assertLocalName(id);
		if (this._byId.has(id))
			throw new Error(`graph: duplicate node id '${id}' (checkpoint/describe ids must be unique)`);
		if (id.startsWith("~") && this._helperIdsInUse.has(id))
			throw new Error(`graph: duplicate node id '${id}' (claimed by a live helper)`);
		if (this._retiredIds.has(id))
			throw new Error(`graph: node id '${id}' was released and cannot be reused (D152/D153)`);
	}

	private _addWithId<T>(
		n: Node<T>,
		factory: string,
		deps: readonly Node<unknown>[],
		opts: SugarOpts<T>,
		id: string,
		acquired?: NodeAcquisition,
	): Node<T> {
		assertGraphLocalNode(this, n as Node<unknown>, `graph node '${opts.name ?? factory}'`);
		for (const dep of deps) assertGraphLocalNode(this, dep, `dep of '${opts.name ?? factory}'`);
		this._assertAvailableId(id);
		const meta =
			opts.meta === undefined
				? undefined
				: (normalizeTopologyMeta(opts.meta, `graph node '${id}' meta`) as Record<string, unknown>);
		const entry: Entry = {
			node: n as Node<unknown>,
			id,
			name: opts.name,
			factory,
			deps,
			meta,
		};
		this._assertDepsLocal(deps, `dep of '${id}'`);
		this._assertAvailableId(id);
		this._entries.set(n as Node<unknown>, entry);
		setNodeOwner(n as Node<unknown>, this);
		this._byId.set(id, n as Node<unknown>);
		if (acquired !== undefined) acquired.registered = true;
		setNodeTopologyDepsChangedObserver(n as Node<unknown>, emitRegisteredDepsChanged);
		const seqMatch = /#(\d+)$/.exec(id);
		if (seqMatch) this._seq = Math.max(this._seq, Number(seqMatch[1]) + 1);
		this._emitTopologyNodeRegistered(n as Node<unknown>);
		return n;
	}

	private _assertDepsLocal(deps: readonly Node<unknown>[], label: string): void {
		for (const dep of deps) assertGraphLocalNode(this, dep, label);
	}
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
	private _assertRegisteredNode(node: Node<unknown>, label: string): void {
		assertGraphLocalNode(this, node, label);
		if (!this._entries.has(node)) {
			throw new Error(`${label} is not a registered graph node (D152)`);
		}
	}

	private _nodeOpts<T>(opts: SugarOpts<T>): NodeOptions<T> {
		assertLocalName(opts.name);
		if (opts.meta !== undefined) {
			normalizeTopologyMeta(opts.meta, `graph node '${opts.name ?? opts.factory ?? "node"}' meta`);
		}
		// strip graph-only fields; inject the bound dispatcher
		const { name: _n, meta: _m, ...rest } = opts;
		return rest;
	}

	/** The function a replace gives `node`, counted when profiling is on. */
	private _profiled(node: Node<unknown>, fn: NodeFn): NodeFn {
		const stats = this._profile;
		if (stats === undefined) return fn;
		const wrapped: NodeFn = (ctx) => {
			const t0 = performance.now();
			try {
				fn(ctx);
			} finally {
				const dur = (performance.now() - t0) * 1e6;
				const stat = stats.get(node) ?? { invokes: 0, totalDurationNs: 0, lastDurationNs: 0 };
				stat.invokes++;
				stat.lastDurationNs = dur;
				stat.totalDurationNs += dur;
				stats.set(node, stat);
			}
		};
		profiledFns.set(wrapped, fn);
		return wrapped;
	}

	/** graphrefly-ts:D193 (2): with profiling on, count and time each run of a node's function. */
	private _profileFn(n: Node<unknown>): void {
		const record = kOf(n);
		if (this._profile !== undefined && record.fn !== null) record.fn = this._profiled(n, record.fn);
	}

	/** Look up a registered node by its id. */
	find(id: string): Node<unknown> | undefined {
		const local = this._byId.get(id);
		if (local !== undefined) return local;
		const separator = id.indexOf("::");
		if (separator < 0)
			return id.startsWith("~")
				? this._describedNodes().find((n) => this._idForTopologyNode(n) === id)
				: undefined;
		const mountPath = id.slice(0, separator);
		const childPath = id.slice(separator + 2);
		return this._mounts.find((mount) => mount.at === mountPath)?.graph.find(childPath);
	}
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
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
		let internalSubscriberCounts: Map<Node<unknown>, number> | undefined;
		for (const { node, entry } of entries) {
			if (!isNodeRuntimeQuiescentForRelease(node)) {
				throw new Error(
					`graph: cannot release node group; '${entry.id}' is not runtime-quiescent (D124)`,
				);
			}
			// D124: count once in this read-only release attempt; retain ordered guard errors.
			if (internalSubscriberCounts === undefined && entries.length > 1) {
				internalSubscriberCounts = new Map();
				for (const { node: dependent } of entries) {
					if (!isNodeActiveForRelease(dependent)) continue;
					for (const dep of dependent.deps) {
						if (dep !== dependent && releaseSet.has(dep)) {
							internalSubscriberCounts.set(dep, (internalSubscriberCounts.get(dep) ?? 0) + 1);
						}
					}
				}
			}
			const internalSubscribers = internalSubscriberCounts?.get(node) ?? 0;
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
		let releaseFailed = false;
		for (const { node } of entries) {
			try {
				releaseRuntimeOfNode(node);
			} catch (error) {
				if (!releaseFailed) releaseError = error;
				releaseFailed = true;
			}
		}
		if (!releaseFailed) {
			const constructions = graphRegistrations.get(this)!.existingConstructions;
			for (const [name, owner] of constructions ?? []) {
				if (
					owner.nodes.every(
						(node) => isNodeRuntimeReleased(node) && !runtimeReleaseFailuresOfNode(node),
					)
				)
					constructions!.delete(name);
			}
		}
		for (const event of releasedEvents) this._emitTopologyNodeReleased(event);
		if (releaseFailed) throw releaseError;
	}

	// ── 8 verbs (core: node/state/batch + sugar: producer/derived/effect/mount) ──

	/** ctx-level power surface: a raw `(ctx)=>void` fn (or a passthrough/state when null). */
	node<T = unknown>(deps?: readonly [], fn?: null, opts?: SugarOpts<T>): StateNode<T>;
	node<T = unknown>(
		deps?: readonly Node<unknown>[],
		fn?: NodeFn | null,
		opts?: SugarOpts<T>,
	): Node<T>;
	node<T = unknown>(
		deps: readonly Node<unknown>[] = [],
		fn: NodeFn | null = null,
		opts: SugarOpts<T> = {},
	): Node<T> {
		this._assertDepsLocal(deps, `dep of '${opts.name ?? "node"}'`);
		return this._createRegistered(opts.factory ?? "node", deps, opts, (nodeOpts) =>
			makeNode<T>(this._core, deps, fn, nodeOpts),
		);
	}

	/** A manual source with `.set(v)` (L4-Q1). */
	state<T>(initial: T, opts: SugarOpts<T> = {}): StateNode<T> {
		return this._createRegistered<T, StateNode<T>>(
			"state",
			[],
			{ ...opts, initial },
			(nodeOpts) => new StateNode<T>(this._core, [], null, nodeOpts),
		);
	}

	/**
	 * ctx-level depless source; its fn runs on activation (R-lifetime). With `opts.recipe` it is
	 * restorable: the registry entry under the recipe's ref gives this `fn` again, with no setup.
	 */
	producer<T = unknown>(fn: NodeFn, opts: SugarOpts<T> = {}): Node<T> {
		return this._createRegistered(
			"producer",
			[],
			sugarRecipeOpts(opts, "producer", opts.setup),
			(nodeOpts) => new Node<T>(this._core, [], fn, nodeOpts),
		);
	}

	/**
	 * value-level pure transform: deps → value (D27 wrapped; D30 throw→ERROR). With
	 * `opts.recipe` it is restorable: the registry entry under the recipe's ref gives the
	 * value-level `fn` again, with no setup, and restore builds the node with this same gate.
	 */
	derived<const D extends readonly Node<unknown>[], T>(
		deps: D,
		fn: DerivedFn<D, T>,
		opts: SugarOpts<T> = {},
	): Node<T> {
		this._assertDepsLocal(deps, `dep of '${opts.name ?? "derived"}'`);
		const ctxFn = derivedNodeFn(fn as (...values: unknown[]) => unknown);
		return this._createRegistered(
			"derived",
			deps,
			sugarRecipeOpts(opts, "derived", opts.setup),
			(nodeOpts) => new Node<T>(this._core, [...deps], ctxFn, nodeOpts),
		);
	}

	/**
	 * value-level sink: deps → effect; the latest run's returned fn runs when the lifetime closes
	 * (R-lifetime). With `opts.recipe` it is restorable like `derived`.
	 */
	effect<const D extends readonly Node<unknown>[]>(
		deps: D,
		fn: EffectFn<D>,
		opts: SugarOpts<void> = {},
	): Node<void> {
		this._assertDepsLocal(deps, `dep of '${opts.name ?? "effect"}'`);
		const parts = effectNodeParts(fn as (...values: unknown[]) => unknown, opts.setup);
		return this._createRegistered(
			"effect",
			deps,
			sugarRecipeOpts({ ...opts, setup: parts.setup }, "effect", opts.setup),
			(nodeOpts) => new Node<void>(this._core, [...deps], parts.fn, nodeOpts),
		);
	}

	/**
	 * R-request-order / R-node: give a computed node a new instance under the same id, subscribers
	 * and policies, with these dependencies and function and, in `opts`, its setup and recipe (or
	 * none). The node keeps its subscribers, which receive START and the new snapshot. A request:
	 * during a wave it waits for the wave to end. Refused for a state node, a duplicate dependency,
	 * and a dependency that is the node itself or depends on it.
	 */
	replace<T>(
		target: Node<T> | string,
		deps: readonly Node<unknown>[],
		fn: NodeFn,
		opts: ReplaceOptions = {},
	): void {
		const node = this._resolveTarget(target, "replace");
		this._assertDepsLocal(deps, `dep of replaced '${node.name ?? "node"}'`);
		nodeReplace(node, [...deps], this._profiled(node, fn), opts);
	}

	/** R-node: a node's current definition (declared dependencies, function, setup, recipe). */
	definition(target: Node<unknown> | string): NodeDefinition {
		const definition = nodeDefinition(this._resolveTarget(target, "definition"));
		// R-node@4: the function as it was given, not the profiling wrapper (graphrefly-ts:D193 (2)).
		const given = definition.fn === null ? null : (profiledFns.get(definition.fn) ?? definition.fn);
		// R-checkpoint@1: a restored node's function is the one it was built with.
		return { ...definition, fn: realNodeFn(given) };
	}

	private _resolveTarget<T>(target: Node<T> | string, op: string): Node<T> {
		const node = typeof target === "string" ? (this.find(target) as Node<T> | undefined) : target;
		if (node === undefined || !this._entries.has(node as Node<unknown>))
			throw new Error(
				`${op}: no node '${String(typeof target === "string" ? target : target.name)}' in this graph`,
			);
		return node;
	}

	/**
	 * Run a batch of this graph (R-request-order): the body runs at once and delivers nothing; its
	 * writes to this graph's nodes commit as one wave when it returns, and a throw from it discards
	 * them. A write to another graph's node inside the body is that
	 * graph's own request, not part of this commit (R-graph-domain@3).
	 */
	batch<T>(fn: () => T): T {
		return kernelBatch(this._core, fn);
	}

	// ── operator funnel (D43): instantiate any free-standing Operator (node sugar, D6/L1.5) ──
	// g.initNode is the single graph-bound entry for the whole operator/source catalog (D40):
	// it delegates to the FREE initNode (graph/operators.ts — the D30 throw→ERROR boundary +
	// dispatcher binding live there) and records the operator's REAL factory name in the
	// inspection index (_add) so describe shows it (D6/inspect) while the node stays thin
	// (R-node-thin). Operators are free-standing factory definitions (graph/operators.ts,
	// graph/sources.ts) usable bare via the free initNode(); this funnel is the inspectable
	// path.

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
			op.recipe !== undefined && !("recipe" in opts) ? { ...opts, recipe: op.recipe } : opts;
		for (const dep of deps as readonly Node<unknown>[])
			assertGraphLocalNode(this, dep, `dep of '${entryOpts.name ?? op.factory}'`);
		// Node<T> is invariant (T appears in NodeOptions.initial); widen the typed deps to the
		// erased Node surface the free initNode / _add accept.
		const erased = deps as readonly Node<unknown>[];
		return this._createRegistered(op.factory, erased, entryOpts, (nodeOpts, acquired) =>
			initNodeWithCore(this._core, op, erased, nodeOpts, acquired),
		);
	}

	/**
	 * R-graph-surface@2: hold a node active as a subscriber that ignores what it receives, and
	 * return the release. Each retain is its own subscription; a release during a wave is a
	 * request, so the subscription is gone by the wave's end (R-request-order).
	 */
	retain(target: Node<unknown> | string): () => void {
		const node = typeof target === "string" ? this._describedNode(target, "retain") : target;
		assertGraphLocalNode(this, node, "retained node");
		// R-checkpoint: a restore returns a graph with no subscribers, so a module's hold taken
		// while its nodes are rebuilt is not taken (graphrefly-ts:D194 (1)).
		if (restoreSeeds.has(this)) return () => {};
		return node.subscribe(() => {});
	}

	/**
	 * R-graph-surface@2: the topology as data, every node in creation order as exactly
	 * `{ id, kind, deps, quiet }`. deps are the current dependencies, a ctx.rewire's included;
	 * `definition(id)` gives the declared ones. A helper node that is not registered under a name
	 * appears under a synthetic `~factory#n` id when a described node depends on it. Values,
	 * status are read from find(id); richer metadata belongs to the blueprint/render modules.
	 * describe activates nothing and runs nothing.
	 */
	describe(): DescribedNode[] {
		return this._describedNodes().map((n) => ({
			id: this._idForTopologyNode(n),
			kind: n instanceof StateNode ? "state" : "node",
			deps: this._topologyDeps(n.deps),
			quiet: nodeDefinition(n).quiet,
		}));
	}

	/** The registered nodes and the helper nodes they depend on, in creation order. */
	private _describedNodes(): Node<unknown>[] {
		const nodes: Node<unknown>[] = [];
		const seen = new Set<Node<unknown>>();
		const pending: Node<unknown>[] = [...this._entries.keys()];
		while (pending.length > 0) {
			const n = pending.pop() as Node<unknown>;
			if (seen.has(n)) continue;
			seen.add(n);
			nodes.push(n);
			for (const dep of n.deps) if (!seen.has(dep)) pending.push(dep);
		}
		return nodes.sort((x, y) => nodeCreationIndex(x) - nodeCreationIndex(y));
	}

	/** A node by an id find() knows or a synthetic id describe() gives. */
	private _describedNode(id: string, op: string): Node<unknown> {
		const node = this.find(id);
		if (node === undefined) throw new Error(`${op}: no node '${id}' in this graph`);
		return node;
	}

	/**
	 * R-graph-surface@2: subscribe `sink` to each node in `ids` as an ordinary subscriber, so a
	 * cold node activates and stays active, and hand it each array a node delivers as
	 * `{ id, msgs }`, in delivery order: the START array first, PENDING prefixes and the kernel's
	 * RESOLVED included. Observing a whole graph is observing every id describe() gives. The
	 * returned stop takes effect at once: nothing more is handed on, also within a wave.
	 */
	observe(ids: readonly string[], sink: (event: ObserveEvent) => void): () => void {
		const targets = ids.map((id) => [id, this._describedNode(id, "observe")] as const);
		let stopped = false;
		const unsubs = targets.map(([id, n]) =>
			n.subscribe((msgs) => {
				if (!stopped) sink({ id, msgs });
			}),
		);
		return () => {
			if (stopped) return;
			stopped = true;
			for (const unsub of unsubs) unsub();
		};
	}

	private _idForTopologyNode(n: Node<unknown>): string {
		const e = this._entries.get(n);
		if (e) return e.id;
		let sid = helperIds.get(n);
		if (sid === undefined) {
			do {
				sid = `~${n.factory ?? "?"}#${this._synthSeq++}`;
			} while (this._byId.has(sid) || this._retiredIds.has(sid));
			helperIds.set(n, sid);
			this._helperIdsInUse.add(sid);
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
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
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

	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: used by the internal registrar.
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

	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: used by the internal registrar.
	private _ensureMountedTopologyForwarders(): void {
		if (this._topologyObservers.size === 0) return;
		for (const mount of this._mounts) {
			if (mount.topologyUnsub !== undefined) continue;
			const mountPath = mount.at;
			mount.topologyUnsub = observeTopology(mount.graph).subscribe((event) => {
				this._emitMountedTopologyEvent(mountPath, event);
			});
		}
	}

	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: internal registrar lifecycle hook.
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
	 * Capture a checkpoint (R-checkpoint, graphrefly:D802): strict JSON, no storage I/O. It is
	 * taken only at a wave boundary; inside a wave or an open batch body it is refused.
	 */
	checkpoint(): GraphCheckpoint {
		if (!idle(this._core))
			throw new Error(
				"checkpoint: a checkpoint is taken only at a wave boundary, not inside a wave or a batch body (R-checkpoint)",
			);
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
			const sid = this._idForTopologyNode(n);
			discovered.set(n, sid);
			return `${_prefix}${sid}`;
		};
		const nodes: GraphCheckpointNode[] = [];
		for (const entry of this._entries.values()) {
			nodes.push(
				this._checkpointNode(entry.node, `${_prefix}${entry.id}`, localId, {
					name: entry.name,
					factory: entry.factory,
					meta: entry.meta,
				}),
			);
		}
		const visited = new Set<Node<unknown>>();
		const queue: Node<unknown>[] = [...discovered.keys()];
		for (let i = 0; i < queue.length; i += 1) {
			const inner = queue[i];
			if (visited.has(inner)) continue;
			visited.add(inner);
			const sid = discovered.get(inner);
			if (sid === undefined) continue;
			const slot = slotOf(inner);
			for (const dep of [...slot.declaredDeps, ...slot.deps]) {
				if (!this._entries.has(dep) && !visited.has(dep)) queue.push(dep);
			}
			// A live dependency found from topology was built outside the graph: it carries no
			// recipe, so it is local-only.
			nodes.push(
				this._checkpointNode(inner, `${_prefix}${sid}`, localId, {
					factory: inner.factory ?? "?",
					unregistered: true,
				}),
			);
			for (const dep of [...slot.declaredDeps, ...slot.deps])
				if (discovered.has(dep) && !visited.has(dep)) queue.push(dep);
		}
		const checkpoint: GraphCheckpoint = { format: GRAPH_CHECKPOINT_FORMAT, nodes };
		const name = graphRegistrations.get(this)!.name;
		if (name !== undefined) checkpoint.name = name;
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
		localId: (n: Node<unknown>) => string,
		opts: {
			name?: string;
			factory: string;
			meta?: Record<string, unknown>;
			unregistered?: boolean;
		},
	): GraphCheckpointNode {
		const state = checkpointStateOfNode(node);
		assertCheckpointQuiescentStatus(node.status, id, "checkpoint");
		const slot = slotOf(node);
		const isState = slot.fn === null && slot.declaredDeps.length === 0;
		const helper = isNonAuthoritativeCollectionHelperMeta(opts.meta);
		// R-checkpoint@1: a value the capture cannot save as JSON refuses the node here, by cause.
		checkpointJsonOf(id, "its id is not JSON", id);
		if (opts.name !== undefined) checkpointJsonOf(id, "its name is not JSON", opts.name);
		const out: GraphCheckpointNode = {
			id,
			factory: opts.factory,
			kind: isState ? "state" : "computed",
			deps: slot.declaredDeps.map(localId),
			values: helper
				? []
				: (checkpointJsonOf(id, CHECKPOINT_REFUSAL.values, state.values) as GraphCheckpointJson[]),
			terminal: checkpointTerminal(state.terminal, id),
		};
		if (opts.name !== undefined) out.name = opts.name;
		// A state needs no recipe; one that carries one (a collection's input) keeps it.
		const recipe = opts.unregistered ? undefined : checkpointRecipe(slot.recipe, id);
		if (recipe !== undefined && recipe !== MISSING_REFERENCE) out.recipe = recipe;
		if (!isState) {
			out.policies = {
				complete: slot.completePolicy,
				error: slot.errorPolicy,
				invalidate: slot.invalidatePolicy,
				quiet: slot.quiet,
			};
			const lifetime = helper ? undefined : this._checkpointLifetime(node, id, localId);
			out.lifetime = lifetime ?? null;
		}
		const backendState = checkpointBackendStateOfNode(node, id);
		if (backendState !== undefined) out.backendState = backendState;
		if (opts.meta !== undefined)
			out.meta = checkpointJsonOf(id, CHECKPOINT_REFUSAL.meta, opts.meta) as {
				[key: string]: GraphCheckpointJson;
			};
		// R-checkpoint@2: a computed node that cannot be rebuilt is refused at capture, after what is
		// not JSON: no recipe is local-only, a recipe without a reference is a missing recipe.
		if (!isState && recipe === undefined) throw notRestorable(id, CHECKPOINT_REFUSAL.localOnly);
		if (recipe === MISSING_REFERENCE) throw notRestorable(id, CHECKPOINT_REFUSAL.missingRecipe);
		return out;
	}

	/**
	 * R-checkpoint: a computed node with a lifetime saves its private state, what it received from
	 * each dependency, and the lifetime's dependencies when a ctx.rewire changed them; a restored
	 * node not activated since keeps its seed. A node without a lifetime saves none.
	 */
	private _checkpointLifetime(
		node: Node<unknown>,
		id: string,
		localId: (n: Node<unknown>) => string,
	): GraphCheckpointLifetime | undefined {
		const slot = slotOf(node);
		const state = checkpointStateOfNode(node);
		if (state.terminal !== undefined) return undefined;
		// Restored and not run since: what it had received is its seed's note (R-checkpoint@1).
		// R-checkpoint@3: a dependency replaced while the node stayed active, of which its function
		// has not been told, is saved as such.
		const replaced = replacedInputs(kOf(node));
		const received =
			receivedInNote(state.seedNote) ??
			(state.activated
				? slot.deps.map((dep, i) => {
						const d = checkpointStateOfNode(dep);
						return {
							values: d.values,
							terminal: d.terminal,
							...(replaced[i] === true ? { replaced: true as const } : {}),
						};
					})
				: undefined);
		if (received === undefined) return undefined;
		// What it received is part of what it retains; a received ERROR payload is an ERROR payload.
		const out: GraphCheckpointLifetime = {
			received: received.map((r) => ({
				values: checkpointJsonOf(
					id,
					CHECKPOINT_REFUSAL.receivedValues,
					r.values,
				) as GraphCheckpointJson[],
				terminal: checkpointTerminal(r.terminal, id),
				...(r.replaced === true ? { replaced: true as const } : {}),
			})),
		};
		if (state.privateState !== SENTINEL)
			out.state = checkpointJsonOf(id, CHECKPOINT_REFUSAL.privateState, state.privateState);
		const deps = slot.deps;
		const declared = slot.declaredDeps;
		if (slot.seedDeps !== null) out.deps = [...slot.seedDeps];
		else if (deps.length !== declared.length || deps.some((d, i) => d !== declared[i]))
			out.deps = deps.map(localId);
		return out;
	}
}

/** A registered node's invocation counts while profiling is on (graphrefly-ts:D193 (2)). */
interface NodeInvocationStat {
	invokes: number;
	totalDurationNs: number;
	lastDurationNs: number;
}

/** What a checkpoint reads of a node's kernel record. */
function slotOf(node: Node<unknown>) {
	const n = kOf(node);
	return {
		fn: n.fn,
		declaredDeps: n.declaredDeps.map((d) => d.node),
		deps: n.deps.map((d) => d.node),
		/** The ids a seed gives a first lifetime that has not started (R-checkpoint: kept). */
		seedDeps: n.seedDeps,
		recipe: n.recipe,
		completePolicy: n.policy.complete,
		errorPolicy: n.policy.error,
		invalidatePolicy: n.invalidate,
		quiet: n.quiet,
	};
}

/** A recipe given without a reference (R-checkpoint@2: refused as a missing recipe). */
const MISSING_REFERENCE = Symbol("missing recipe reference");

/**
 * R-node: a recipe the checkpoint can save is a factory reference, a non-empty string, with a JSON
 * configuration. A recipe with no reference gives MISSING_REFERENCE, which the capture refuses
 * after the node's JSON checks.
 */
function checkpointRecipe(
	recipe: unknown,
	id: string,
): GraphCheckpointRecipe | typeof MISSING_REFERENCE | undefined {
	if (recipe === undefined || recipe === null) return undefined;
	const r = recipe as { ref?: unknown; config?: unknown; sugar?: unknown };
	if (typeof recipe === "object" && r.config !== undefined)
		checkpointJsonOf(id, CHECKPOINT_REFUSAL.recipeConfig, r.config);
	if (typeof recipe !== "object" || typeof r.ref !== "string" || r.ref === "")
		return MISSING_REFERENCE;
	const out: GraphCheckpointRecipe = { ref: r.ref };
	if (r.config !== undefined)
		out.config = checkpointJsonOf(id, CHECKPOINT_REFUSAL.recipeConfig, r.config);
	if (isCheckpointSugar(r.sugar)) out.sugar = r.sugar;
	return out;
}

const SUGARS: readonly GraphCheckpointSugar[] = ["derived", "effect", "producer"];

/** @internal Whether a recipe's `sugar` names a sugar restore rebuilds (graphrefly-ts:D178). */
export function isCheckpointSugar(value: unknown): value is GraphCheckpointSugar {
	return SUGARS.includes(value as GraphCheckpointSugar);
}

/** R-checkpoint: a sugar node's instance carries its recipe tagged with the sugar it was built with. */
function sugarRecipeOpts<T>(
	opts: SugarOpts<T>,
	sugar: GraphCheckpointSugar,
	userSetup: unknown,
): SugarOpts<T> {
	const recipe = opts.recipe;
	if (recipe === undefined) return opts;
	// A restored sugar node is rebuilt from its value callback alone, so a setup would be lost.
	if (userSetup !== undefined)
		throw new TypeError(
			`${sugar}: a node with a recipe takes no setup; the restored node could not rebuild it`,
		);
	return { ...opts, recipe: { ...(recipe as object), sugar } };
}

/**
 * graphrefly-ts:D184 (the user's Q1): the value-level gate of derived and effect. The function
 * runs once every dependency has a value, and then only for a run in which a dependency sent
 * DATA; a run whose input is only a terminal (or nothing new, as a restored node's first run
 * over unchanged dependencies) sends nothing. Gives the values, or undefined to skip the run.
 */
function sugarGate(ctx: Ctx): unknown[] | undefined {
	const deps = ctx.deps;
	const values = new Array<unknown>(deps.length);
	let fresh = false;
	for (let i = 0; i < deps.length; i++) {
		const dep = deps[i];
		const value = dep.value;
		if (value === undefined) return undefined;
		values[i] = value;
		if (!fresh && dep.waves.some((wave) => wave.length > 0)) fresh = true;
	}
	return fresh ? values : undefined;
}

/** @internal derived's sugar over a value-level callback (D27 wrapped; D30 throw→ERROR). */
export function derivedNodeFn(fn: (...values: unknown[]) => unknown): NodeFn {
	return (ctx: Ctx) => {
		const args = sugarGate(ctx);
		if (args === undefined) return;
		try {
			const result = fn(...args);
			if (result !== undefined) ctx.down([["DATA", result]]);
		} catch (e) {
			ctx.down([["ERROR", errorPayload(e, "derived threw without a valid error payload")]]); // D30: value-level throw → graph-layer ERROR
		}
	};
}

/**
 * @internal effect's sugar over a value-level callback: its node function and the setup that
 * runs the latest run's cleanup when the lifetime closes (R-lifetime).
 */
export function effectNodeParts(
	fn: (...values: unknown[]) => unknown,
	userSetup?: SugarOpts<void>["setup"],
): { fn: NodeFn; setup: (ctx: Ctx) => () => void } {
	// R-lifetime: the latest run's returned cleanup belongs to the run's lifetime, and the
	// lifetime's cleanup (installed by setup) runs it once when the lifetime closes. A run that
	// returns nothing clears it; a rerun replaces it without running it. It is kept by lifetime
	// signal, not in private state, which a checkpoint saves as JSON (R-checkpoint@1).
	const cleanups = new WeakMap<AbortSignal, () => void>();
	const ctxFn: NodeFn = (ctx: Ctx) => {
		const args = sugarGate(ctx);
		if (args === undefined) return;
		try {
			const cleanup = fn(...args);
			if (typeof cleanup === "function") cleanups.set(ctx.signal, cleanup as () => void);
			else cleanups.delete(ctx.signal);
		} catch (e) {
			ctx.down([["ERROR", errorPayload(e, "effect threw without a valid error payload")]]);
		}
	};
	const setup = (ctx: Ctx): (() => void) => {
		const userCleanup = userSetup?.(ctx);
		const signal = ctx.signal;
		return () => {
			const cleanup = cleanups.get(signal);
			cleanups.delete(signal);
			cleanup?.();
			if (typeof userCleanup === "function") userCleanup();
		};
	};
	return { fn: ctxFn, setup };
}

/**
 * @internal R-checkpoint: rebuild a sugar node's function from the value-level callback a
 * registry entry gives, with the same sugar and gate as `g.derived`, `g.effect`, `g.producer`.
 */
export function sugarNodeParts(
	sugar: GraphCheckpointSugar,
	callback: (...args: never[]) => unknown,
): { fn: NodeFn; setup?: (ctx: Ctx) => () => void } {
	const fn = callback as (...values: unknown[]) => unknown;
	if (sugar === "derived") return { fn: derivedNodeFn(fn) };
	if (sugar === "effect") return effectNodeParts(fn);
	return { fn: fn as NodeFn };
}

/**
 * Construct a graph with graph-local topology, lifecycle, and inspection ownership.
 *
 * @param opts - Optional graph name, dispatcher, environment drivers, and
 *   profiling switch.
 * @returns A `Graph` instance whose sugar methods create graph-registered nodes.
 * @example
 * ```ts
 * import { graph } from "@graphrefly/ts/graph";
 *
 * const g = graph({ name: "counter" });
 * const count = g.state(0, { name: "count" });
 * const doubled = g.derived([count], (value) => value * 2);
 * ```
 * @category graph
 */
export function graph(opts: GraphOptions = {}): Graph {
	return new Graph(opts);
}

/** @internal A graph's environment drivers (D130/D131), for the adapters built on it. */
export function environmentOfGraph(g: Graph): EnvironmentDrivers {
	return (g as unknown as { _core: Kernel })._core.environment;
}

/**
 * @internal The operator host of a graph (graphrefly-ts:D193 (3), (5)): its environment drivers and
 * a way to build nodes in it, for adapters, restores and helpers that build on a graph.
 */
export function hostOfGraph(g: Graph, deps: readonly Node<unknown>[] = []): OperatorHost {
	const host = hostOfKernel((g as unknown as { _core: Kernel })._core);
	return deps.length === 0 ? host : hostWithDeps(host, deps);
}

// R-invocation@3: registered nodes and graph-bound helpers share describe's identity resolver.
setGraphNodeIdResolver((owner, node) => {
	const graph =
		owner instanceof Graph ? owner : owner instanceof Kernel ? graphsByCore.get(owner) : undefined;
	return graph === undefined
		? undefined
		: (graph as unknown as { _idForTopologyNode(n: Node<unknown>): string })._idForTopologyNode(
				node,
			);
});

/** @internal D122 graph-owned ephemeral node-group release. */
export function releaseGraphNodes(
	graph: Graph,
	nodes: readonly Node<unknown>[],
	opts: { reason?: string } = {},
): void {
	const registrar = graphRegistrations.get(graph);
	if (registrar === undefined) throw new Error("graph: unknown lifecycle registrar");
	registrar.releaseNodes(nodes, opts);
}

/** A seed a restore gives a node at construction, and whether its first run compares. */
interface RestoreSeed {
	readonly seed: NodeSeed;
	readonly firstRun: boolean;
}

/** The seeds of a graph being restored, by node id, until each node is built. */
const restoreSeeds = new WeakMap<Graph, Map<string, RestoreSeed>>();

/**
 * @internal R-checkpoint: build `graph`'s restored nodes in `build`, each given its seed at
 * construction; a module's hold is not taken meanwhile. Returns the ids whose seed no node took.
 */
export function buildWithRestoreSeeds(
	graph: Graph,
	seeds: ReadonlyMap<string, RestoreSeed>,
	build: () => void,
): string[] {
	const pending = new Map(seeds);
	restoreSeeds.set(graph, pending);
	try {
		build();
	} finally {
		restoreSeeds.delete(graph);
	}
	return [...pending.keys()];
}

/** @internal D94 descriptor path: register a restored state node without widening Graph. */
export function restoreStateNodeInGraph<T = unknown>(
	graph: Graph,
	id: string,
	opts: SugarOpts<T> = {},
): StateNode<T> {
	const registrar = graphRegistrations.get(graph);
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
	const registrar = graphRegistrations.get(graph);
	if (registrar === undefined) throw new Error("restoreGraph: unknown graph restore registrar");
	return registrar.node(id, factory, deps, fn, opts);
}

/** D167: shared operations on an exact issued Graph host, with no copied graph indexes. */
interface GraphRuntimeHost {
	_core: Kernel;
	_byId: Map<string, Node<unknown>>;
	_retiredIds: Set<string>;
	_assertRegisteredNode(node: Node<unknown>, label: string): void;
	_releaseNodes(nodes: readonly Node<unknown>[], opts?: { reason?: string }): void;
	_entries: Map<Node<unknown>, Entry>;
	_mounts: MountedGraph[];
	_profile: WeakMap<Node<unknown>, NodeInvocationStat> | undefined;
	_topologyObserverSeq: number;
	_topologyObservers: Map<number, TopologyObserver>;
	_ensureMountedTopologyForwarders(): void;
	_emitTopologyMountChanged(at: string): void;
	_releaseMountedTopologyForwarders(): void;
	_emitTopologyDepsChanged(
		node: Node<unknown>,
		prev: readonly Node<unknown>[],
		deps: readonly Node<unknown>[],
	): void;
	_createRegistered<T, N extends Node<T> = Node<T>>(
		factory: string,
		deps: readonly Node<unknown>[],
		opts: SugarOpts<T>,
		create: (opts: NodeOptions<T>, acquired: NodeAcquisition) => N,
		id?: string,
		acquired?: NodeAcquisition,
	): N;
}
class GraphRegistration implements GraphLifecycleRegistrar {
	readonly host: GraphRuntimeHost;
	private owners?: Map<string, OwnedConstruction>;
	private readonly moduleNames = new Set<string>();
	constructor(
		readonly graph: Graph,
		readonly name?: string,
	) {
		this.host = graph as unknown as GraphRuntimeHost;
	}
	/** Embed a child graph addressable under `at`; mount is this package's own (R-graph-surface). */
	mount(child: Graph, opts: { at: string }): void {
		if (typeof opts.at !== "string" || opts.at.length === 0) {
			throw new TypeError("topology.mount: at must be a non-empty string");
		}
		assertLocalName(opts.at);
		if (this.host._mounts.some((mounted) => mounted.at === opts.at)) {
			throw new Error(`topology.mount: duplicate sibling mount id '${opts.at}'`);
		}
		const mount = { at: opts.at, graph: child };
		this.host._mounts.push(mount);
		if (this.host._topologyObservers.size > 0) this.host._ensureMountedTopologyForwarders();
		this.host._emitTopologyMountChanged(opts.at);
	}

	allocateModuleName(prefix: string): string {
		assertLocalName(prefix);
		let index = 0;
		let candidate = prefix;
		const occupied = (name: string) =>
			this.moduleNames.has(name) ||
			[...this.host._byId.keys(), ...this.host._retiredIds].some(
				(id) => id === name || id.startsWith(`${name}/`),
			);
		while (occupied(candidate)) candidate = `${prefix}${++index}`;
		this.moduleNames.add(candidate);
		return candidate;
	}

	get existingConstructions() {
		return this.owners;
	}
	get constructions() {
		if (this.owners === undefined) this.owners = new Map<string, OwnedConstruction>();
		return this.owners;
	}
	assertRegisteredNode(node: Node<unknown>, label: string): void {
		this.host._assertRegisteredNode(node, label);
	}
	atWaveBoundary(): boolean {
		return idle(this.host._core);
	}
	observeFailures<R>(observer: (source: string, error: unknown) => void, run: () => R): R {
		return observeFailures(this.host._core, observer, run);
	}
	readIncoming(nodes: ReadonlySet<Node<unknown>>): Pick<RenderSnapshot, "edges"> {
		const edges: RenderEdge[] = [];
		for (const entry of this.graph.describe()) {
			const node = this.graph.find(entry.id);
			if (node !== undefined && nodes.has(node))
				for (const from of entry.deps) edges.push({ from, to: entry.id });
		}
		return { edges };
	}
	metadata(
		node: Node<unknown>,
	): { name?: string; factory: string; meta?: Record<string, unknown> } | undefined {
		return this.host._entries.get(node);
	}
	mounts(): readonly { at: string; graph: Graph }[] {
		return this.host._mounts;
	}
	operatorHost(deps: readonly Node<unknown>[]): OperatorHost {
		return hostWithDeps(hostOfKernel(this.host._core), deps);
	}
	profile(): Profile {
		const nodes: Record<string, NodeProfile> = {};
		let totalInvokes = 0;
		for (const { node, id } of this.host._entries.values()) {
			const stat = this.host._profile?.get(node);
			const invokes = stat?.invokes ?? 0;
			nodes[id] = {
				invokes,
				totalDurationNs: stat?.totalDurationNs ?? 0,
				lastDurationNs: stat?.lastDurationNs ?? 0,
				status: node.status,
			};
			totalInvokes += invokes;
		}
		return { totalInvokes, nodes };
	}
	observeTopology(path?: string): TopologyStream {
		return {
			subscribe: (sink) => {
				const id = this.host._topologyObserverSeq++;
				this.host._topologyObservers.set(id, { path, sink });
				this.host._ensureMountedTopologyForwarders();
				return () => {
					this.host._topologyObservers.delete(id);
					if (this.host._topologyObservers.size === 0)
						this.host._releaseMountedTopologyForwarders();
				};
			},
		};
	}

	releaseNodes(nodes: readonly Node<unknown>[], opts?: { reason?: string }): void {
		this.host._releaseNodes(nodes, opts);
	}
	assertAvailableName(name: string): void {
		if (this.host._byId.has(name) || this.host._retiredIds.has(name))
			throw new Error(`construction: live or retired node name ${name}`);
	}
	createOwned<T>(
		deps: readonly Node<unknown>[],
		fn: NodeFn | null,
		opts: SugarOpts<T>,
		acquired: NodeAcquisition,
	): Node<T> {
		for (const dep of deps) this.host._assertRegisteredNode(dep, "construction node dependency");
		return this.host._createRegistered(
			opts.factory ?? "node",
			deps,
			opts,
			(nodeOpts) => makeNode<T>(this.host._core, deps, fn, nodeOpts),
			acquired.name,
			acquired,
		);
	}
	stateNode<T>(id: string, opts: SugarOpts<T> = {}): StateNode<T> {
		return this.host._createRegistered<T, StateNode<T>>(
			"state",
			[],
			opts,
			(nodeOpts) => new StateNode<T>(this.host._core, [], null, nodeOpts),
			id,
		);
	}
	node<T>(
		id: string,
		factory: string,
		deps: readonly Node<unknown>[],
		fn: NodeFn | null,
		opts: SugarOpts<T> = {},
	): Node<T> {
		return this.host._createRegistered(
			factory,
			deps,
			opts,
			(nodeOpts) => makeNode<T>(this.host._core, deps, fn, nodeOpts),
			id,
		);
	}
}
function emitRegisteredDepsChanged(
	node: Node<unknown>,
	prev: readonly Node<unknown>[],
	deps: readonly Node<unknown>[],
): void {
	const graph = nodeOwner(node);
	if (graph !== undefined)
		(graph as unknown as GraphRuntimeHost)._emitTopologyDepsChanged(node, prev, deps);
}

export { StateNode };
