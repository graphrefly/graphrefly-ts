/**
 * CSP-2.8 composition helpers (D56).
 *
 * These are graph-layer, per-language helpers (D6/D24), not protocol primitives. The first cut is
 * intentionally static: branch nodes are declared at construction time, with real dep edges
 * `[source, rules]` that `describe()` can show. Dynamic rule add/remove is deferred by D56.
 */

import type { Ctx } from "../ctx/types.js";
import type { Node, NodeOptions } from "../node/node.js";
import type { Message } from "../protocol/messages.js";
import type { RenderNode } from "./describe.js";
import type { Graph, StateNode, SugarOpts } from "./graph.js";
import { initNodeBeside, type Operator } from "./operators.js";

/** One unary operator step accepted by {@link pipe}. */
export type PipeOperator<TIn, TOut> = Operator<TIn, TOut>;

export type RenderEvent =
	| { readonly type: "node-added"; readonly id: string; readonly node: RenderNode }
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

export interface RenderChangeset {
	readonly events: readonly RenderEvent[];
}

/**
 * Compose unary operator factories into a graph-registered chain.
 *
 * Each step is instantiated through `g.initNode`, so `describe()` still shows the real
 * per-operator factory names and declared edges (D6/D39/D45). This is graph-layer sugar, not a
 * new verb or protocol primitive.
 *
 * @param g - Graph that owns the registered operator nodes.
 * @param source - Upstream node to start from.
 * @param ops - Unary operator factories to apply in order.
 * @returns The node produced by the last operator in the chain.
 * @example
 * ```ts
 * const doubled = pipe(g, source, map((value: number) => value * 2));
 * ```
 * @category graph
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
/**
 * Compose unary operator factories into a graph-registered chain.
 *
 * @param g - Graph that owns the registered operator nodes.
 * @param source - Upstream node to start from.
 * @param ops - Unary operator factories to apply in order.
 * @returns The node produced by the last operator in the chain.
 * @example
 * ```ts
 * const doubled = pipe(g, source, map((value: number) => value * 2));
 * ```
 * @category graph
 */
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

/** D56 branch node body: declared deps `[source, rules]`, no internal subscribe island.
 * @param source - Source node that provides graph-visible input.
 * @param rules - rules value used by the helper.
 * @param classifier - classifier value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns A `Node<T>` value.
 * @category composition
 * @example
 * ```ts
 * import { stratifyBranch } from "@graphrefly/ts/composition";
 * ```
 */
export function stratifyBranch<T, R>(
	source: Node<T>,
	rules: Node<R>,
	classifier: (rules: R, value: T) => boolean,
	opts: StratifyBranchOptions<T> = {},
): Node<T> {
	const op = stratifyBranchOperator<T, R>(classifier);
	return initNodeBeside(op, [source as Node<unknown>, rules as Node<unknown>], opts);
}

function stratifyBranchOperator<T, R>(
	classifier: (rules: R, value: T) => boolean,
): Operator<unknown, T> {
	return {
		factory: "stratifyBranch",
		inputs: 2,
		opts: {
			complete: "manual",
			error: "manual",
		},
		body: (ctx: Ctx) => {
			const sourceTerminal = ctx.deps[0].terminal;
			const rules = ctx.deps[1].value as R | undefined;
			const out: Message[] = [];
			if (rules !== undefined) {
				for (const value of ctx.deps[0].waves.flat() as T[]) {
					if (classifier(rules, value)) out.push(["DATA", value]);
				}
			}
			if (sourceTerminal?.kind === "complete") {
				out.push(["COMPLETE"]);
			} else if (sourceTerminal?.kind === "error") {
				out.push(["ERROR", sourceTerminal.error]);
			}
			ctx.down(out);
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
 * @param g - Graph that owns the created nodes or projector.
 * @param source - Source node that provides graph-visible input.
 * @param rules - rules value used by the helper.
 * @param classifier - classifier value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns A `Stratified<T, R>` value.
 * @category composition
 * @example
 * ```ts
 * import { stratify } from "@graphrefly/ts/composition";
 * ```
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
