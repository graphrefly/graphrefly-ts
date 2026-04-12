/**
 * Sugar constructors over the raw `node()` primitive.
 *
 * Each factory wraps a user-friendly function into the canonical
 * `NodeFn = (data, actions, ctx) => cleanup | void` shape, then calls
 * `node(...)`. This is the only place `actions.emit(...)` is invoked
 * on behalf of the user — if you need finer control (multi-emission,
 * raw `actions.down` / `actions.up`, cleanup return), use the raw
 * `node()` factory from `./node.js` directly.
 *
 * See SESSION-foundation-redesign.md §8.5 + §10.6 for the rewrite.
 */

import type { NodeActions } from "./config.js";
import {
	type FnCtx,
	type Node,
	node,
	type NodeFn,
	type NodeFnCleanup,
	type NodeOptions,
} from "./node.js";

// ---------------------------------------------------------------------------
// state — manual source with an optional initial value
// ---------------------------------------------------------------------------

/**
 * Creates a manual source node. Drive it with `state.emit(v)` (framed,
 * diamond-safe) or `state.down([[DATA, v]])` (raw compat path).
 *
 * @param initial - Starting cached value. Pass `undefined` or `null`
 *   explicitly to cache that value; omit to leave the node in `"sentinel"`.
 * @param opts - Optional {@link NodeOptions} (excluding `initial`).
 */
export function state<T>(
	initial: T,
	opts?: Omit<NodeOptions<T>, "initial">,
): Node<T> {
	return node<T>([], { ...opts, initial });
}

// ---------------------------------------------------------------------------
// producer — no-deps source with a compute body
// ---------------------------------------------------------------------------

/**
 * User-level producer compute: runs once on first-subscriber activation.
 * Receives `actions` for imperative emission and `ctx` for FnCtx (typically
 * only `store` is useful on a producer — no deps means `dataFrom` and
 * `terminalDeps` are empty).
 */
export type ProducerFn = (
	actions: NodeActions,
	ctx: FnCtx,
) => NodeFnCleanup | void;

/**
 * Creates a producer node with no deps; `fn` runs once when the first
 * subscriber connects. Return a cleanup function (`() => void`) or
 * `{ deactivation: () => void }` to register teardown.
 *
 * @example
 * ```ts
 * const ticker = producer((actions) => {
 *   const id = setInterval(() => actions.emit(Date.now()), 1000);
 *   return () => clearInterval(id);
 * });
 * ```
 */
export function producer<T = unknown>(
	fn: ProducerFn,
	opts?: NodeOptions<T>,
): Node<T> {
	const wrapped: NodeFn = (_data, actions, ctx) => fn(actions, ctx);
	return node<T>(wrapped, { describeKind: "producer", ...opts });
}

// ---------------------------------------------------------------------------
// derived — dep-driven pure compute
// ---------------------------------------------------------------------------

/**
 * User-level derived compute: receives the latest DATA from each dep and
 * returns the new value. The sugar wraps it with `actions.emit(fn(...))`
 * so the return value flows through the framed emit pipeline.
 *
 * For derived nodes that need to inspect `ctx.dataFrom` / `ctx.terminalDeps`
 * / `ctx.store`, accept the optional second parameter.
 */
export type DerivedFn<T> = (data: readonly unknown[], ctx: FnCtx) => T | undefined | null;

/**
 * Creates a derived node from dependencies and a compute function.
 *
 * @example
 * ```ts
 * const a = state(1);
 * const b = derived([a], ([x]) => (x as number) * 2);
 * ```
 */
export function derived<T = unknown>(
	deps: readonly Node[],
	fn: DerivedFn<T>,
	opts?: NodeOptions<T>,
): Node<T> {
	const wrapped: NodeFn = (data, actions, ctx) => {
		actions.emit(fn(data, ctx));
	};
	return node<T>(deps, wrapped, { describeKind: "derived", ...opts });
}

// ---------------------------------------------------------------------------
// effect — dep-driven side effect, no auto-emit
// ---------------------------------------------------------------------------

/**
 * User-level effect compute: fires when deps settle. Return value is NOT
 * auto-emitted — use `actions.emit(v)` / `actions.down(msgs)` explicitly if
 * the effect also wants to produce downstream messages. Return a cleanup
 * function or `{ deactivation }` to register teardown.
 */
export type EffectFn = (
	data: readonly unknown[],
	actions: NodeActions,
	ctx: FnCtx,
) => NodeFnCleanup | void;

/**
 * Runs a side-effect when deps settle. Return value is not auto-emitted.
 *
 * @example
 * ```ts
 * effect([source], ([v]) => {
 *   console.log(v);
 * });
 * ```
 */
export function effect(
	deps: readonly Node[],
	fn: EffectFn,
	opts?: NodeOptions<unknown>,
): Node<unknown> {
	return node(deps, fn, { describeKind: "effect", ...opts });
}

// ---------------------------------------------------------------------------
// dynamicNode — track-proxy wrapper over `derived`
// ---------------------------------------------------------------------------

/**
 * Proxy handed to a {@link DynamicFn}. `track(dep)` returns the dep's
 * latest DATA payload, as delivered through the protocol. Reading from
 * `track` does NOT bypass the message protocol — it reads the internal
 * `DepRecord.latestData` that `_onDepMessage` already populated. If a
 * dep has not yet sent DATA, `track` returns `undefined`.
 */
export type TrackFn = (dep: Node) => unknown;

/** User-level dynamicNode compute. */
export type DynamicFn<T> = (track: TrackFn, ctx: FnCtx) => T | undefined | null;

/**
 * Sugar over `derived(...)` that exposes dep values via a `track(dep)`
 * proxy instead of positional `data[i]`. All declared `allDeps` participate
 * in wave tracking, so the first fn run waits for every dep to settle.
 * Unused deps that update just re-run fn; `equals` absorbs unchanged
 * outputs as RESOLVED.
 *
 * P3-compliant: `track(dep)` reads from the framework-managed
 * `DepRecord.latestData` populated by the protocol, never from
 * `dep.cache`.
 *
 * @example
 * ```ts
 * const a = state(1);
 * const b = state(10);
 * const sum = dynamicNode([a, b], (track) => (track(a) as number) + (track(b) as number));
 * ```
 */
export function dynamicNode<T = unknown>(
	allDeps: readonly Node[],
	fn: DynamicFn<T>,
	opts?: NodeOptions<T>,
): Node<T> {
	const depIndex = new Map<Node, number>();
	allDeps.forEach((d, i) => { depIndex.set(d, i); });
	return derived<T>(
		allDeps,
		(data, ctx) => {
			const track: TrackFn = (dep) => {
				const i = depIndex.get(dep);
				if (i == null) {
					throw new Error(
						`dynamicNode: untracked dep "${dep.name ?? "<unnamed>"}"`,
					);
				}
				return data[i];
			};
			return fn(track, ctx);
		},
		opts,
	);
}

// ---------------------------------------------------------------------------
// pipe — left-to-right operator composition
// ---------------------------------------------------------------------------

/** Unary operator used by {@link pipe}. */
export type PipeOperator = (n: Node) => Node;

/**
 * Composes unary operators left-to-right; returns the final node.
 *
 * @example
 * ```ts
 * const out = pipe(
 *   source,
 *   (n) => map(n, (x) => x + 1),
 *   (n) => filter(n, (x) => x > 0),
 * );
 * ```
 */
export function pipe(source: Node, ...ops: PipeOperator[]): Node {
	let current = source;
	for (const op of ops) current = op(current);
	return current;
}
