import { type Node, type NodeFn, type NodeOptions, node } from "./node.js";

/**
 * Creates a manual source with no upstream deps. Emit values with {@link Node.down}.
 *
 * Spec: `state(initial, opts?)` is `node([], { initial, ...opts })` (GRAPHREFLY-SPEC §2.7).
 *
 * @param initial - Initial cached value. Because `initial` is provided, `equals` is
 *   called on the first {@link Node.down | down()} emission — if the value matches
 *   `initial`, the node emits `RESOLVED` instead of `DATA` (spec §2.5).
 * @param opts - Optional {@link NodeOptions} (excluding `initial`).
 * @returns `Node<T>` - Stateful node you drive imperatively.
 *
 * @example
 * ```ts
 * import { DATA, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = state(0);
 * n.down([[DATA, 1]]);
 * ```
 *
 * @category core
 */
export function state<T>(initial: T, opts?: Omit<NodeOptions, "initial">): Node<T> {
	return node<T>([], { ...opts, initial });
}

/**
 * Creates a producer node with no deps; `fn` runs when the first subscriber connects.
 *
 * @param fn - Receives deps (empty) and {@link NodeActions}; use `emit` / `down` to push.
 * @param opts - Optional {@link NodeOptions}.
 * @returns `Node<T>` - Producer node.
 *
 * @example
 * ```ts
 * import { producer } from "@graphrefly/graphrefly-ts";
 *
 * const tick = producer((_d, a) => {
 *   a.emit(1);
 * });
 * ```
 *
 * @category core
 */
export function producer<T = unknown>(fn: NodeFn<T>, opts?: NodeOptions): Node<T> {
	return node<T>(fn, { describeKind: "producer", ...opts });
}

/**
 * Creates a derived node from dependencies and a compute function (same primitive as operators).
 *
 * @param deps - Upstream nodes.
 * @param fn - Compute function; return value is emitted, or use `actions` explicitly.
 * @param opts - Optional {@link NodeOptions}.
 * @returns `Node<T>` - Derived node.
 *
 * @example
 * ```ts
 * import { derived, state } from "@graphrefly/graphrefly-ts";
 *
 * const a = state(1);
 * const b = derived([a], ([x]) => (x as number) * 2);
 * ```
 *
 * @category core
 */
export function derived<T = unknown>(
	deps: readonly Node[],
	fn: NodeFn<T>,
	opts?: NodeOptions,
): Node<T> {
	return node<T>(deps, fn, { describeKind: "derived", ...opts });
}

/**
 * Runs a side-effect when deps settle; return value is not auto-emitted.
 *
 * @param deps - Nodes to watch.
 * @param fn - Side-effect body.
 * @returns `Node<unknown>` - Effect node.
 *
 * @example
 * ```ts
 * import { effect, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = state(1);
 * effect([n], ([v]) => {
 *   console.log(v);
 * });
 * ```
 *
 * @category core
 */
export function effect(
	deps: readonly Node[],
	fn: NodeFn<unknown>,
	opts?: NodeOptions,
): Node<unknown> {
	return node(deps, fn, { describeKind: "effect", ...opts });
}

/** Unary transform used by {@link pipe} (typically returns a new node wrapping `n`). */
export type PipeOperator = (n: Node) => Node;

/**
 * Composes unary operators left-to-right; returns the final node. Does not register a {@link Graph}.
 *
 * @param source - Starting node.
 * @param ops - Each operator maps `Node` to `Node` (curried operators from `extra` use a factory pattern — wrap or use direct calls).
 * @returns `Node` - Result of the last operator.
 *
 * @example
 * ```ts
 * import { filter, map, pipe, state } from "@graphrefly/graphrefly-ts";
 *
 * const src = state(1);
 * const out = pipe(
 *   src,
 *   (n) => map(n, (x) => x + 1),
 *   (n) => filter(n, (x) => x > 0),
 * );
 * ```
 *
 * @category core
 */
export function pipe(source: Node, ...ops: PipeOperator[]): Node {
	let current = source;
	for (const op of ops) {
		current = op(current);
	}
	return current;
}
