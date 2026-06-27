/**
 * CSP-2.8 composition helpers (D56).
 *
 * These are graph-layer, per-language helpers (D6/D24), not protocol primitives. The first cut is
 * intentionally static: branch nodes are declared at construction time, with real dep edges
 * `[source, rules]` that `describe()` can show. Dynamic rule add/remove is deferred by D56.
 */

import {
	type Ctx,
	depBatch,
	depLatest,
	depTerminal,
	isTerminalComplete,
	isTerminalError,
	terminalErrorValue,
} from "../ctx/types.js";
import type { Node, NodeOptions } from "../node/node.js";
import type { DescribeEdge, DescribeNode, DescribeSnapshot } from "./describe.js";
import type { Graph, StateNode, SugarOpts } from "./graph.js";
import { initNode, type Operator } from "./operators.js";

/** One unary operator step accepted by {@link pipe}. */
export type PipeOperator<TIn, TOut> = Operator<TIn, TOut>;

export type DescribeEvent =
	| { readonly type: "node-added"; readonly id: string; readonly node: DescribeNode }
	| { readonly type: "node-removed"; readonly id: string }
	| {
			readonly type: "node-meta-changed";
			readonly id: string;
			readonly prevMeta: Record<string, unknown>;
			readonly nextMeta: Record<string, unknown>;
	  }
	| { readonly type: "edge-added"; readonly from: string; readonly to: string }
	| { readonly type: "edge-removed"; readonly from: string; readonly to: string }
	| { readonly type: "subgraph-mounted"; readonly path: string }
	| { readonly type: "subgraph-unmounted"; readonly path: string };

export interface DescribeChangeset {
	readonly events: readonly DescribeEvent[];
}

function metaEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (!metaEqual(a[i], b[i])) return false;
		return true;
	}
	const ak = Object.keys(a as Record<string, unknown>).sort();
	const bk = Object.keys(b as Record<string, unknown>).sort();
	if (ak.length !== bk.length) return false;
	for (let i = 0; i < ak.length; i++) {
		if (ak[i] !== bk[i]) return false;
		if (!metaEqual((a as Record<string, unknown>)[ak[i]], (b as Record<string, unknown>)[bk[i]]))
			return false;
	}
	return true;
}

function edgeKey(e: DescribeEdge): string {
	return `${e.from}\0${e.to}`;
}

function cloneNode(n: DescribeNode): DescribeNode {
	return {
		...n,
		deps: [...n.deps],
		...(n.meta ? { meta: { ...n.meta } } : {}),
	};
}

function flattenSnapshot(snap: DescribeSnapshot): {
	nodes: Map<string, DescribeNode>;
	edges: Map<string, DescribeEdge>;
	subgraphs: Set<string>;
} {
	const nodes = new Map<string, DescribeNode>();
	const edges = new Map<string, DescribeEdge>();
	const subgraphs = new Set<string>();
	const visit = (s: DescribeSnapshot, indexPath = ""): void => {
		for (const n of s.nodes) nodes.set(n.id, n);
		for (const e of s.edges) edges.set(edgeKey(e), e);
		s.subgraphs?.forEach((child, i) => {
			const prefixed = child.nodes.find((n) => n.id.includes("::"))?.id;
			const key =
				prefixed?.slice(0, prefixed.lastIndexOf("::")) ??
				(child.name ? `${indexPath}${child.name}` : `${indexPath}${i}`);
			subgraphs.add(key);
			visit(child, `${key}/`);
		});
	};
	visit(snap);
	return { nodes, edges, subgraphs };
}

/**
 * Pure topology delta from one D39 `describe()` snapshot to another. No node refs, no clocks, no
 * old-core deps (D56). Values/status changes are not topology events; use `observe()` for data.
 */
export function topologyDiff(prev: DescribeSnapshot, next: DescribeSnapshot): DescribeChangeset {
	const p = flattenSnapshot(prev);
	const n = flattenSnapshot(next);
	const events: DescribeEvent[] = [];

	for (const path of [...n.subgraphs].filter((x) => !p.subgraphs.has(x)).sort())
		events.push({ type: "subgraph-mounted", path });

	for (const id of [...n.nodes.keys()].filter((x) => !p.nodes.has(x)).sort()) {
		events.push({ type: "node-added", id, node: cloneNode(n.nodes.get(id) as DescribeNode) });
	}

	for (const id of [...n.nodes.keys()].filter((x) => p.nodes.has(x)).sort()) {
		const prevMeta = p.nodes.get(id)?.meta ?? {};
		const nextMeta = n.nodes.get(id)?.meta ?? {};
		if (!metaEqual(prevMeta, nextMeta)) {
			events.push({
				type: "node-meta-changed",
				id,
				prevMeta: { ...prevMeta },
				nextMeta: { ...nextMeta },
			});
		}
	}

	for (const [k, e] of [...n.edges.entries()].sort()) {
		if (!p.edges.has(k)) events.push({ type: "edge-added", from: e.from, to: e.to });
	}
	for (const [k, e] of [...p.edges.entries()].sort()) {
		if (!n.edges.has(k)) events.push({ type: "edge-removed", from: e.from, to: e.to });
	}

	for (const id of [...p.nodes.keys()].filter((x) => !n.nodes.has(x)).sort())
		events.push({ type: "node-removed", id });

	for (const path of [...p.subgraphs].filter((x) => !n.subgraphs.has(x)).sort())
		events.push({ type: "subgraph-unmounted", path });

	return { events };
}

/**
 * Compose unary operator factories into a graph-registered chain.
 *
 * Each step is instantiated through `g.initNode`, so `describe()` still shows the real
 * per-operator factory names and declared edges (D6/D39/D45). This is graph-layer sugar, not a
 * new verb or protocol primitive.
 */
export function pipe<S>(g: Graph, source: Node<S>): Node<S>;
export function pipe<S, A>(g: Graph, source: Node<S>, op1: PipeOperator<S, A>): Node<A>;
export function pipe<S, A, B>(
	g: Graph,
	source: Node<S>,
	op1: PipeOperator<S, A>,
	op2: PipeOperator<A, B>,
): Node<B>;
export function pipe<S, A, B, C>(
	g: Graph,
	source: Node<S>,
	op1: PipeOperator<S, A>,
	op2: PipeOperator<A, B>,
	op3: PipeOperator<B, C>,
): Node<C>;
export function pipe<S, A, B, C, D>(
	g: Graph,
	source: Node<S>,
	op1: PipeOperator<S, A>,
	op2: PipeOperator<A, B>,
	op3: PipeOperator<B, C>,
	op4: PipeOperator<C, D>,
): Node<D>;
export function pipe<S, A, B, C, D, E>(
	g: Graph,
	source: Node<S>,
	op1: PipeOperator<S, A>,
	op2: PipeOperator<A, B>,
	op3: PipeOperator<B, C>,
	op4: PipeOperator<C, D>,
	op5: PipeOperator<D, E>,
): Node<E>;
export function pipe<S, A, B, C, D, E, F>(
	g: Graph,
	source: Node<S>,
	op1: PipeOperator<S, A>,
	op2: PipeOperator<A, B>,
	op3: PipeOperator<B, C>,
	op4: PipeOperator<C, D>,
	op5: PipeOperator<D, E>,
	op6: PipeOperator<E, F>,
): Node<F>;
export function pipe<S>(
	g: Graph,
	source: Node<S>,
	...ops: readonly PipeOperator<unknown, unknown>[]
): Node<unknown>;
export function pipe(
	g: Graph,
	source: Node<unknown>,
	...ops: readonly PipeOperator<unknown, unknown>[]
): Node<unknown> {
	let current = source;
	for (const op of ops) current = g.initNode(op, [current]);
	return current;
}

export interface StratifyRule<R> {
	readonly name: string;
	readonly rule: R;
	readonly meta?: Record<string, unknown>;
}

export interface StratifyBranchOptions<T> extends Omit<NodeOptions<T>, "dispatcher"> {}

/** D56 branch node body: declared deps `[source, rules]`, no internal subscribe island. */
export function stratifyBranch<T, R>(
	source: Node<T>,
	rules: Node<R>,
	classifier: (rules: R, value: T) => boolean,
	opts: StratifyBranchOptions<T> = {},
): Node<T> {
	const op = stratifyBranchOperator<T, R>(classifier);
	return initNode(op, [source as Node<unknown>, rules as Node<unknown>], opts);
}

function stratifyBranchOperator<T, R>(
	classifier: (rules: R, value: T) => boolean,
): Operator<unknown, T> {
	return {
		factory: "stratifyBranch",
		opts: {
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			terminalAsRealInput: true,
		},
		body: (ctx: Ctx) => {
			const sourceBatch = depBatch(ctx, 0);
			const sourceTerminal = depTerminal(ctx, 0);
			const rules = depLatest(ctx, 1) as R | undefined;
			if (rules !== undefined && sourceBatch !== null) {
				for (const value of sourceBatch as readonly T[]) {
					if (classifier(rules, value)) ctx.down([["DATA", value]]);
				}
			}
			if (isTerminalComplete(sourceTerminal)) {
				ctx.down([["COMPLETE"]]);
			} else if (isTerminalError(sourceTerminal)) {
				ctx.down([["ERROR", terminalErrorValue(sourceTerminal)]]);
			}
		},
	};
}

export interface StratifyOptions<R = unknown> {
	/** Branch id prefix. Default `branch`, yielding ids like `branch/even`. */
	prefix?: string;
	/** Optional graph sugar opts for the rules state node. */
	rules?: SugarOpts<readonly StratifyRule<R>[]>;
	/** Optional graph sugar opts for each branch node, keyed by rule name. */
	branches?: Record<string, SugarOpts<unknown>>;
}

export interface Stratified<T, R> {
	readonly rules: StateNode<readonly StratifyRule<R>[]>;
	readonly branches: Record<string, Node<T>>;
}

/**
 * Build static stratification branches in `g` (D56 first cut). Rules are a state node so future
 * classifier data changes affect future source items, but branch count is fixed at construction.
 */
export function stratify<T, R>(
	g: Graph,
	source: Node<T>,
	rules: readonly StratifyRule<R>[],
	classifier: (rule: R, value: T) => boolean,
	opts: StratifyOptions<R> = {},
): Stratified<T, R> {
	const prefix = opts.prefix ?? "branch";
	const seen = new Set<string>();
	for (const { name } of rules) {
		if (seen.has(name)) throw new Error(`stratify: duplicate rule name '${name}'`);
		seen.add(name);
	}
	const { meta: rulesMeta, ...rulesOpts } = opts.rules ?? {};
	const rulesNode = g.state<readonly StratifyRule<R>[]>([...rules], {
		...rulesOpts,
		name: rulesOpts.name ?? `${prefix}/rules`,
		meta: { ...(rulesMeta ?? {}), kind: "stratify_rules" },
	});
	const branches: Record<string, Node<T>> = {};
	for (const rule of rules) {
		const op = stratifyBranchOperator<T, readonly StratifyRule<R>[]>((all, value) => {
			const current = all.find((r) => r.name === rule.name);
			return current === undefined ? false : classifier(current.rule, value);
		});
		const { meta: branchMeta, ...branchOpts } = opts.branches?.[rule.name] ?? {};
		branches[rule.name] = g.initNode(op, [source as Node<unknown>, rulesNode as Node<unknown>], {
			...branchOpts,
			name: branchOpts.name ?? `${prefix}/${rule.name}`,
			meta: { ...(rule.meta ?? {}), ...(branchMeta ?? {}), branch: rule.name },
		}) as Node<T>;
	}
	return { rules: rulesNode, branches };
}
