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
import { getNodeOwner, Node, type NodeOptions, setNodeOwner, withNodeCore } from "../node/node.js";
import { errorPayload, messageTier } from "../protocol/messages.js";
import type { DescribeEdge, DescribeNode, DescribeOpts, DescribeSnapshot } from "./describe.js";
import type { NodeProfile, ObserveStream, Profile } from "./inspect.js";
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

/** Sugar options — node options minus dispatcher (graph owns it) plus naming/meta. */
export interface SugarOpts<T = unknown> extends Omit<NodeOptions<T>, "dispatcher"> {
	name?: string;
	meta?: Record<string, unknown>;
}

export interface GraphOptions {
	name?: string;
	/** Bind to a dispatcher (default = process-global, D26). */
	dispatcher?: Dispatcher;
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
}

function nodeOwner(n: Node<unknown>): Graph | undefined {
	return getNodeOwner(n) as Graph | undefined;
}

export function assertGraphLocalNode(owner: Graph, n: Node<unknown>, label: string): void {
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

export class Graph {
	readonly name?: string;
	private readonly _dispatcher: Dispatcher;
	private readonly _core = new NodeCore();
	private readonly _entries = new Map<Node<unknown>, Entry>();
	private readonly _byId = new Map<string, Node<unknown>>();
	private readonly _mounts: Array<{ at: string; graph: Graph }> = [];
	private _seq = 0;
	private _clock = 0; // graph-local monotonic clock for observe seq (D26)
	// D51: stable synthetic ids for unregistered live deps (runtime *Map inners) auto-discovered by
	// describe(). WeakMap-cached so successive describes agree + the inner's id is freed when it is.
	// A dedicated counter (NOT _seq) so a describe() call never perturbs registered-node id numbering.
	private _synthSeq = 0;
	private readonly _synthIds = new WeakMap<Node<unknown>, string>();

	constructor(opts: GraphOptions = {}) {
		this.name = opts.name;
		this._dispatcher = opts.dispatcher ?? defaultDispatcher;
		if (opts.profile) this._dispatcher.setRecording(true);
	}

	// ── registration / inspection index ──

	private _add<T>(
		n: Node<T>,
		factory: string,
		deps: readonly Node<unknown>[],
		opts: SugarOpts<T>,
	): Node<T> {
		assertGraphLocalNode(this, n as Node<unknown>, `graph node '${opts.name ?? factory}'`);
		for (const dep of deps) assertGraphLocalNode(this, dep, `dep of '${opts.name ?? factory}'`);
		const id = opts.name ?? `${factory}#${this._seq++}`;
		this._entries.set(n as Node<unknown>, {
			node: n as Node<unknown>,
			id,
			name: opts.name,
			factory,
			deps,
			meta: opts.meta,
		});
		setNodeOwner(n as Node<unknown>, this);
		this._byId.set(id, n as Node<unknown>);
		return n;
	}

	private _assertDepsLocal(deps: readonly Node<unknown>[], label: string): void {
		for (const dep of deps) assertGraphLocalNode(this, dep, label);
	}

	private _nodeOpts<T>(opts: SugarOpts<T>): NodeOptions<T> {
		// strip graph-only fields; inject the bound dispatcher
		const { name: _n, meta: _m, ...rest } = opts;
		return { ...rest, dispatcher: this._dispatcher };
	}

	/** Look up a registered node by its id. */
	find(id: string): Node<unknown> | undefined {
		return this._byId.get(id);
	}

	// ── 8 verbs (core: node/state/batch + sugar: producer/derived/effect/mount) ──

	/** ctx-level power surface: a raw `(ctx)=>void` fn (or a passthrough/state when null). */
	node<T = unknown>(
		deps: readonly Node<unknown>[] = [],
		fn: NodeFn | null = null,
		opts: SugarOpts<T> = {},
	): Node<T> {
		this._assertDepsLocal(deps, `dep of '${opts.name ?? "node"}'`);
		const n = withNodeCore(
			this._core,
			() => new Node<T>(deps as Node<unknown>[], fn, this._nodeOpts(opts)),
		);
		return this._add(n, "node", deps, opts);
	}

	/** A manual source with `.set(v)` (L4-Q1). */
	state<T>(initial: T, opts: SugarOpts<T> = {}): StateNode<T> {
		const n = withNodeCore(
			this._core,
			() => new StateNode<T>([], null, { ...this._nodeOpts(opts), initial }),
		);
		this._add(n, "state", [], opts);
		return n;
	}

	/** ctx-level depless source; its fn runs on activation (R-rom-ram). */
	producer<T = unknown>(fn: NodeFn, opts: SugarOpts<T> = {}): Node<T> {
		const n = withNodeCore(this._core, () => new Node<T>([], fn, this._nodeOpts(opts)));
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
		const n = withNodeCore(this._core, () => new Node<T>([...deps], ctxFn, this._nodeOpts(opts)));
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
		const n = withNodeCore(
			this._core,
			() => new Node<void>([...deps], ctxFn, this._nodeOpts(opts)),
		);
		return this._add(n, "effect", deps, opts);
	}

	/** Declarative batch (D12): one wave, success→commit / throw→rollback. */
	batch<T>(fn: (bctx: BatchCtx) => T): T {
		return batchRun(fn);
	}

	/** Embed a child graph addressable under `at` (R-mount; mount has no deps). */
	mount(child: Graph, opts: { at: string }): void {
		this._mounts.push({ at: opts.at, graph: child });
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
		for (const dep of deps as readonly Node<unknown>[])
			assertGraphLocalNode(this, dep, `dep of '${opts.name ?? op.factory}'`);
		// Node<T> is invariant (T appears in NodeOptions.initial); widen the typed deps to the
		// erased Node surface the free initNode / _add accept (same cast the old methods used).
		const erased = deps as readonly Node<unknown>[];
		const n = initNodeWithCore(this._core, op, erased, this._nodeOpts(opts));
		return this._add(n, op.factory, erased, opts);
	}

	/**
	 * Graph-owned activation root for internal helper nodes. This is the sanctioned keepalive shape:
	 * a graph, not a helper closure, owns the subscription and returns the release handle.
	 */
	retain<T>(node: Node<T>, opts: { reason?: string } = {}): () => void {
		assertGraphLocalNode(this, node as Node<unknown>, opts.reason ?? "retained node");
		return node.subscribe(() => {});
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
