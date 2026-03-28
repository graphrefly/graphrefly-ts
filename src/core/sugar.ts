import { type Node, type NodeFn, type NodeOptions, node } from "./node.js";

/**
 * Manual source: no deps, no compute fn. Emit via {@link Node.down}.
 * Spec: `state(initial, opts?)` ≡ `node([], { initial, ...opts })` (same as `node([], null, { … })` in §2.7).
 */
export function state<T>(initial: T, opts?: Omit<NodeOptions, "initial">): Node<T> {
	return node<T>([], { ...opts, initial });
}

/**
 * Auto source: no deps; `fn` runs on subscribe and uses `actions.emit` / `actions.down`.
 */
export function producer<T = unknown>(fn: NodeFn<T>, opts?: NodeOptions): Node<T> {
	return node<T>(fn, { describeKind: "producer", ...opts });
}

/**
 * Reactive compute: deps + fn that returns a value (or uses explicit `down()` / `emit()`).
 * Thin alias over {@link node}; same primitive as “operator” style in the spec.
 */
export function derived<T = unknown>(
	deps: readonly Node[],
	fn: NodeFn<T>,
	opts?: NodeOptions,
): Node<T> {
	return node<T>(deps, fn, { describeKind: "derived", ...opts });
}

/**
 * Side-effect node: `fn` returns nothing; no auto-emit from return value.
 */
export function effect(deps: readonly Node[], fn: NodeFn<unknown>): Node<unknown> {
	return node(deps, fn, { describeKind: "effect" });
}

/** Unary transform used by {@link pipe} (typically returns a new node wrapping `n`). */
export type PipeOperator = (n: Node) => Node;

/**
 * Linear composition: returns the last node in the chain. Does not register a Graph.
 */
export function pipe(source: Node, ...ops: PipeOperator[]): Node {
	let current = source;
	for (const op of ops) {
		current = op(current);
	}
	return current;
}
