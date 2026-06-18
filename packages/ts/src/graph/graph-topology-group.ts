import type { NodeFn } from "../ctx/types.js";
import type { Node } from "../node/node.js";
import type { Graph, StateNode } from "./graph.js";
import { lifecycleRegistrars } from "./graph-lifecycle.js";
import type { DerivedFn, EffectFn, SugarOpts } from "./graph-types.js";
import type { Operator } from "./operators.js";

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

export class GraphTopologyGroup implements TopologyGroup {
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
