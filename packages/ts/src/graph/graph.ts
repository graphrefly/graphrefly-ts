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
import type { Ctx, NodeFn } from "../ctx/types.js";
import { type Dispatcher, defaultDispatcher } from "../dispatcher/index.js";
import { Node, type NodeOptions } from "../node/node.js";
import { messageTier } from "../protocol/messages.js";
import type { DescribeEdge, DescribeNode, DescribeOpts, DescribeSnapshot } from "./describe.js";
import type { NodeProfile, ObserveStream, Profile } from "./inspect.js";

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
	private readonly _entries = new Map<Node<unknown>, Entry>();
	private readonly _byId = new Map<string, Node<unknown>>();
	private readonly _mounts: Array<{ at: string; graph: Graph }> = [];
	private _seq = 0;
	private _clock = 0; // graph-local monotonic clock for observe seq (D26)

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
		const id = opts.name ?? `${factory}#${this._seq++}`;
		this._entries.set(n as Node<unknown>, {
			node: n as Node<unknown>,
			id,
			name: opts.name,
			factory,
			deps,
			meta: opts.meta,
		});
		this._byId.set(id, n as Node<unknown>);
		return n;
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
		const n = new Node<T>(deps as Node<unknown>[], fn, this._nodeOpts(opts));
		return this._add(n, "node", deps, opts);
	}

	/** A manual source with `.set(v)` (L4-Q1). */
	state<T>(initial: T, opts: SugarOpts<T> = {}): StateNode<T> {
		const n = new StateNode<T>([], null, { ...this._nodeOpts(opts), initial });
		this._add(n, "state", [], opts);
		return n;
	}

	/** ctx-level depless source; its fn runs on activation (R-rom-ram). */
	producer<T = unknown>(fn: NodeFn, opts: SugarOpts<T> = {}): Node<T> {
		const n = new Node<T>([], fn, this._nodeOpts(opts));
		return this._add(n, "producer", [], opts);
	}

	/** value-level pure transform: deps → value (D27 wrapped; D30 throw→ERROR). */
	derived<const D extends readonly Node<unknown>[], T>(
		deps: D,
		fn: DerivedFn<D, T>,
		opts: SugarOpts<T> = {},
	): Node<T> {
		const ctxFn: NodeFn = (ctx: Ctx) => {
			try {
				const args = ctx.depRecords.map((r) => r.latest) as DepValues<D>;
				const result = fn(...args);
				if (result !== undefined) ctx.down([["DATA", result]]);
			} catch (e) {
				ctx.down([["ERROR", e]]); // D30: value-level throw → graph-layer ERROR
			}
		};
		const n = new Node<T>([...deps], ctxFn, this._nodeOpts(opts));
		return this._add(n, "derived", deps, opts);
	}

	/** value-level sink: deps → effect; return value (a fn) becomes onDeactivation (D28). */
	effect<const D extends readonly Node<unknown>[]>(
		deps: D,
		fn: EffectFn<D>,
		opts: SugarOpts<void> = {},
	): Node<void> {
		// effect cleanup = deactivation-only (D28 / Flag 3): the LATEST returned cleanup
		// fires ONCE when the effect deactivates (not between re-runs — onRerun was cut).
		// State lives in ctx.state (per-node, wiped on fresh-lifecycle) so the deactivation
		// hook is registered exactly once per activation and re-registers after a re-activation.
		interface EffectState {
			registered: boolean;
			cleanup?: () => void;
		}
		const ctxFn: NodeFn = (ctx: Ctx) => {
			try {
				const args = ctx.depRecords.map((r) => r.latest) as DepValues<D>;
				const cleanup = fn(...args);
				const st: EffectState = ctx.state.get<EffectState>() ?? { registered: false };
				st.cleanup = typeof cleanup === "function" ? cleanup : undefined;
				if (!st.registered) {
					st.registered = true;
					ctx.onDeactivation(() => st.cleanup?.());
				}
				ctx.state.set(st);
			} catch (e) {
				ctx.down([["ERROR", e]]);
			}
		};
		const n = new Node<void>([...deps], ctxFn, this._nodeOpts(opts));
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

	// ── operators (node sugar, D6/L1.5; describe shows the real factory name) ──
	// Core set per L4-Q7 (main package); time-based + higher-order operators are a
	// separate subpackage. Each is value-level over the node primitive; the shared _op
	// wrapper carries the D30 throw→ERROR boundary.

	private _op<T>(
		deps: readonly Node<unknown>[],
		factory: string,
		body: (ctx: Ctx) => void,
		opts: SugarOpts<T>,
	): Node<T> {
		const ctxFn: NodeFn = (ctx: Ctx) => {
			try {
				body(ctx);
			} catch (e) {
				ctx.down([["ERROR", e]]);
			}
		};
		const n = new Node<T>([...deps], ctxFn, this._nodeOpts(opts));
		return this._add(n, factory, deps, opts);
	}

	/** map: emit fn(value). */
	map<S, T>(src: Node<S>, fn: (v: S) => T, opts: SugarOpts<T> = {}): Node<T> {
		return this._op<T>(
			[src as Node<unknown>],
			"map",
			(ctx) => {
				ctx.down([["DATA", fn(ctx.depRecords[0].latest as S)]]);
			},
			opts,
		);
	}

	/** filter: emit value only when pred(value) (else skip the wave). */
	filter<S>(src: Node<S>, pred: (v: S) => boolean, opts: SugarOpts<S> = {}): Node<S> {
		return this._op<S>(
			[src as Node<unknown>],
			"filter",
			(ctx) => {
				const v = ctx.depRecords[0].latest as S;
				if (pred(v)) ctx.down([["DATA", v]]);
			},
			opts,
		);
	}

	/** scan: stateful accumulator over the upstream (acc seeded once, kept in ctx.state). */
	scan<S, T>(
		src: Node<S>,
		reducer: (acc: T, v: S) => T,
		seed: T,
		opts: SugarOpts<T> = {},
	): Node<T> {
		return this._op<T>(
			[src as Node<unknown>],
			"scan",
			(ctx) => {
				const acc = ctx.state.get<T>() ?? seed;
				const next = reducer(acc, ctx.depRecords[0].latest as S);
				ctx.state.set(next);
				ctx.down([["DATA", next]]);
			},
			opts,
		);
	}

	/** take: emit the first n values, then COMPLETE (terminal-is-forever). */
	take<S>(src: Node<S>, n: number, opts: SugarOpts<S> = {}): Node<S> {
		return this._op<S>(
			[src as Node<unknown>],
			"take",
			(ctx) => {
				if (n <= 0) {
					ctx.down([["COMPLETE"]]);
					return;
				}
				const count = ctx.state.get<number>() ?? 0;
				if (count >= n) return; // already satisfied
				const v = ctx.depRecords[0].latest as S;
				const next = count + 1;
				ctx.state.set(next);
				ctx.down(next >= n ? [["DATA", v], ["COMPLETE"]] : [["DATA", v]]);
			},
			opts,
		);
	}

	/** distinctUntilChanged: emit only when the value differs from the previous emit. */
	distinctUntilChanged<S>(
		src: Node<S>,
		eq: (a: S, b: S) => boolean = Object.is,
		opts: SugarOpts<S> = {},
	): Node<S> {
		return this._op<S>(
			[src as Node<unknown>],
			"distinctUntilChanged",
			(ctx) => {
				const v = ctx.depRecords[0].latest as S;
				const prev = ctx.state.get<{ v: S }>();
				if (prev && eq(prev.v, v)) return;
				ctx.state.set({ v });
				ctx.down([["DATA", v]]);
			},
			opts,
		);
	}

	/** merge: interleave several sources — emit each DATA from whichever dep fired (partial). */
	merge<T>(srcs: readonly Node<T>[], opts: SugarOpts<T> = {}): Node<T> {
		return this._op<T>(
			srcs as readonly Node<unknown>[],
			"merge",
			(ctx) => {
				for (const r of ctx.depRecords) {
					if (r.batch && r.batch.length > 0) {
						for (const v of r.batch) ctx.down([["DATA", v]]);
					}
				}
			},
			{ ...opts, partial: true },
		);
	}

	// ── inspection: describe (Slice B); observe/profile land in Slice D ──

	/** Static structure snapshot (R-describe / D39). `_prefix` carries the mount path. */
	describe(opts: DescribeOpts = {}, _prefix = ""): DescribeSnapshot {
		const localId = (n: Node<unknown>): string => {
			const e = this._entries.get(n);
			return e ? `${_prefix}${e.id}` : `${_prefix}?`;
		};
		const nodes: DescribeNode[] = [];
		const edges: DescribeEdge[] = [];
		for (const entry of this._entries.values()) {
			const id = `${_prefix}${entry.id}`;
			const dnode: DescribeNode = {
				id,
				factory: entry.factory,
				status: entry.node.status,
				deps: entry.deps.map(localId),
			};
			if (entry.name !== undefined) dnode.name = entry.name;
			if (entry.node.cache !== undefined) dnode.value = entry.node.cache; // absent = SENTINEL
			if (entry.meta !== undefined) dnode.meta = entry.meta;
			nodes.push(dnode);
			for (const d of entry.deps) edges.push({ from: localId(d), to: id });
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
