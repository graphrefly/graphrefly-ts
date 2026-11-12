/**
 * The fn-invocation context and per-dep input shapes.
 *
 * Canonical authority: ~/src/graphrefly/spec/rules.jsonl
 *   R-invocation (ctx, deps, private state, down, rewire, signal), R-lifetime (setup, cleanup,
 *   signal), R-messages (output goes only downstream; there is no ctx.up).
 */

import type { Dispatcher } from "../dispatcher/index.js";
import type { EnvironmentDrivers } from "../graph/environment.js";
import type { Node } from "../node/node.js";
import { SENTINEL, type Wave } from "../protocol/messages.js";

/**
 * A downstream sink (graphrefly-ts:D175): called once per array the node sends, with the whole
 * array; the first array is START followed by the node's snapshot (R-subscription). Arrays that
 * carry DATA, RESOLVED, INVALIDATE, COMPLETE or ERROR begin with the kernel's PENDING (R-wave).
 */
export type Sink = (msgs: Wave) => void;

/**
 * @internal A dependent node's connection to one dependency: one call per delivery, with every
 * array the dependency publishes for the wave, in order; each array is an input array of its own
 * and the delivery ends with the call. `snapshot` marks the START array a new dependent receives,
 * which is not a live wave. A single array holding a bare PENDING is the kernel's pending mark,
 * sent ahead of the values through the whole cone (R-wave).
 */
export type DependentSink = (arrays: readonly Wave[], snapshot: boolean) => void;

export interface CtxDepWaveOrigin {
	/** For each array dependency `depIndex` delivered in the run, whether it came live. */
	readonly live: (depIndex: number) => readonly boolean[] | undefined;
}

const ctxDepWaveOrigins = new WeakMap<Ctx, CtxDepWaveOrigin>();

/** @internal Attach per-dep wave-origin state without exposing it on the public Ctx shape. */
export function setCtxDepWaveOrigin(ctx: Ctx, origin: CtxDepWaveOrigin): void {
	ctxDepWaveOrigins.set(ctx, origin);
}

/** Internal node-construction binding for graph-local helper-created deps. */
export const CTX_NODE_BINDING: unique symbol = Symbol("graphrefly.ctx.nodeBinding");

export interface CtxNodeBinding {
	readonly dispatcher: Dispatcher;
	create<T>(factory: () => Node<T>): Node<T>;
	/** Internal: a rewire by difference, computed when the request runs. */
	rewireDiff(add: readonly Node<unknown>[], remove: readonly Node<unknown>[]): void;
	/** Internal: a rewire by difference applied now, from inside a request; failures throw. */
	rewireDiffNow(add: readonly Node<unknown>[], remove: readonly Node<unknown>[]): void;
}

/** @internal Operators grow and shrink their inner set by difference (R-request-order order). */
export function ctxRewireDiff(
	ctx: Ctx,
	add: readonly Node<unknown>[],
	remove: readonly Node<unknown>[] = [],
): void {
	ctx[CTX_NODE_BINDING]?.rewireDiff(add, remove);
}

/** A dependency's terminal in this invocation (R-invocation@2): COMPLETE, or ERROR with its payload. */
export type DepTerminal =
	| { readonly kind: "complete" }
	| { readonly kind: "error"; readonly error: unknown };

/**
 * One dependency as the function sees it in this invocation (R-invocation@2, the user's Q3).
 */
export interface CtxDep {
	/** The dependency's id in its graph. */
	readonly id: string;
	/**
	 * The arrays it delivered to this invocation, each as its DATA payloads in order, keeping array
	 * boundaries; a RESOLVED array is empty, and `[]` means it delivered nothing.
	 */
	readonly waves: readonly (readonly unknown[])[];
	/** Its terminal in this invocation, if any. */
	readonly terminal: DepTerminal | undefined;
	/** The latest value received from it; `undefined` when it has none (see `has`). */
	readonly value: unknown;
	/** Whether a value has been received from it. */
	readonly has: boolean;
	/**
	 * Under the manual INVALIDATE policy, whether an INVALIDATE arrived on it in this invocation;
	 * always false under the auto policy, where the function does not run for an INVALIDATE.
	 */
	readonly invalidated: boolean;
}

/**
 * A node's private state for the current lifetime (R-invocation): it survives reruns and
 * INVALIDATE, and is dropped when the lifetime closes (R-lifetime).
 */
export interface CtxState {
	get<S = unknown>(): S | undefined;
	set<S = unknown>(v: S): void;
}

/**
 * The single argument to a node fn: `(ctx) => void` (R-invocation / D8). All emission
 * is explicit via `ctx.down`; there is no return-value framing.
 */
export interface Ctx {
	/**
	 * Emit downstream toward sinks: the function's only output (R-invocation). Nothing travels up
	 * the graph (R-messages). PENDING and RESOLVED are the kernel's and are rejected here (R-wave).
	 * An empty array sends nothing and starts no wave.
	 */
	down(msgs: Wave): void;
	/**
	 * The user's Q4: send `values` as DATA, in order, as exactly one array, the same as
	 * `ctx.down(values.map((v) => ["DATA", v]))`; with no values it sends nothing. Each call is its
	 * own array: consecutive calls are never merged. It is sugar for a few values the code fixes:
	 * the values are spread as arguments, and an engine refuses a call with too many (on Node 24,
	 * past about 120,000). When the count follows the input, build the array and use `ctx.down`.
	 */
	emit(...values: readonly unknown[]): void;
	/** The dependencies, one view each, in dependency order (R-invocation@2). */
	deps: readonly CtxDep[];
	/** Private state for the current lifetime (R-invocation, R-lifetime). */
	state: CtxState;
	/**
	 * R-invocation@2 / R-subscription@3: on the first run of an instance built with a seed, the
	 * seed's opaque note; `undefined` on every other run.
	 */
	readonly seed: unknown;
	/**
	 * R-lifetime: the current lifetime's abort signal, aborted when the lifetime closes
	 * (deactivation or end), not by INVALIDATE or a rerun. A function registers no cleanup; what
	 * must last for the lifetime is opened by the node's `setup`, and work started from a run can
	 * stop on this signal.
	 */
	signal: AbortSignal;
	/** Graph-owned environment drivers for source/adapter boundaries (D130/D131). */
	environment(): EnvironmentDrivers;
	/**
	 * R-request-order: change this node's own dependencies for its current lifetime. A request:
	 * it runs after the wave, and is dropped if the lifetime has closed. The instance keeps its
	 * values, private state and function; kept dependencies keep their records, removed ones are
	 * released silently, and added ones are acquired, their snapshots given to the function as one
	 * input wave. When the lifetime closes the dependencies go back to the declared ones.
	 */
	rewire(deps: readonly Node<unknown>[]): void;
	[CTX_NODE_BINDING]?: CtxNodeBinding;
}

/**
 * @internal This ctx with `deps` in place of its dependency views: the same node, lifetime and
 * note (R-checkpoint@1: a restored node's first run sees only its changed dependencies).
 */
export function ctxWithDeps(ctx: Ctx, deps: readonly CtxDep[]): Ctx {
	const out: Ctx = { ...ctx, deps };
	const origin = ctxDepWaveOrigins.get(ctx);
	if (origin !== undefined) ctxDepWaveOrigins.set(out, origin);
	return out;
}

/** A node fn (R-invocation). Registered in the dispatcher's function table, indexed by Handle. */
export type NodeFn = (ctx: Ctx) => void;

/** Internal adapter helper: the waves dependency `depIndex` delivered live, not as a snapshot. */
export function depLiveWaves(ctx: Ctx, depIndex: number): readonly (readonly unknown[])[] {
	const waves = ctx.deps[depIndex]?.waves ?? [];
	const live = ctxDepWaveOrigins.get(ctx)?.live(depIndex) ?? [];
	return waves.filter((_, index) => live[index]);
}

/** Internal adapter helper: the values dependency `depIndex` delivered live; null when none came. */
export function depLiveBatch(ctx: Ctx, depIndex: number): readonly unknown[] | null {
	const waves = depLiveWaves(ctx, depIndex);
	return waves.length === 0 ? null : waves.flat();
}
