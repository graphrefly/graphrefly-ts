/**
 * The fn-invocation context and per-dep input shapes.
 *
 * Canonical authority: ~/src/graphrefly/spec/rules.jsonl
 *   R-invocation@4 (ctx: deps, private state, down, rewire, signal, seed), R-lifetime@2 (setup,
 *   cleanup, signal), R-messages@1 (output goes only downstream; there is no ctx.up). The ctx
 *   carries nothing else (graphrefly-ts:D193).
 */

import type { Node } from "../node/node.js";
import type { Wave } from "../protocol/messages.js";

/**
 * A downstream sink (graphrefly-ts:D175): called once per array the node sends, with the whole
 * array; the first array is START followed by the node's snapshot (R-subscription). Arrays that
 * carry DATA, RESOLVED, INVALIDATE, COMPLETE or ERROR begin with the kernel's PENDING (R-wave).
 */
export type Sink = (msgs: Wave) => void;

/** A dependency's terminal in this invocation (R-invocation@4): COMPLETE, or ERROR with its payload. */
export type DepTerminal =
	| { readonly kind: "complete" }
	| { readonly kind: "error"; readonly error: unknown };

/**
 * One dependency during its supplying setup/function invocation (R-invocation@4).
 * Accessing any field after that invocation returns throws; captured plain values remain usable.
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
	/**
	 * R-invocation@4: whether the dependency was replaced by a new instance since the function's
	 * last run (R-subscription@5); true in that one run only.
	 */
	readonly replaced: boolean;
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
 * The single argument to a node fn: `(ctx) => void` (R-invocation). All output is explicit via
 * `ctx.down`; there is no return-value framing.
 */
export interface Ctx {
	/**
	 * Emit downstream toward sinks: the function's only output (R-invocation). Nothing travels up
	 * the graph (R-messages). START, PENDING and RESOLVED are the kernel's and are rejected here
	 * (R-wave). An empty array sends nothing and starts no wave.
	 */
	down(msgs: Wave): void;
	/** The dependencies, one view each, in dependency order (R-invocation@4). */
	deps: readonly CtxDep[];
	/** Private state for the current lifetime (R-invocation, R-lifetime). */
	state: CtxState;
	/**
	 * R-invocation@4 / R-subscription@5: on the first run of an instance built with a seed, the
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
	/**
	 * R-request-order: change this node's own dependencies for its current lifetime. A request:
	 * it runs after the wave, and is dropped if the lifetime has closed. The instance keeps its
	 * values, private state and function; kept dependencies keep their records, removed ones are
	 * released silently, and added ones are acquired, their snapshots given to the function as one
	 * input wave. When the lifetime closes the dependencies go back to the declared ones.
	 */
	rewire(deps: readonly Node<unknown>[]): void;
}

/**
 * @internal This ctx with `deps` in place of its dependency views: the same node, lifetime and
 * note (R-checkpoint: a restored node's first run sees only its changed dependencies).
 */
export function ctxWithDeps(ctx: Ctx, deps: readonly CtxDep[]): Ctx {
	const guarded = deps.map(
		(dep): CtxDep => ({
			get id() {
				void ctx.deps;
				return dep.id;
			},
			get waves() {
				void ctx.deps;
				return dep.waves;
			},
			get terminal() {
				void ctx.deps;
				return dep.terminal;
			},
			get value() {
				void ctx.deps;
				return dep.value;
			},
			get has() {
				void ctx.deps;
				return dep.has;
			},
			get invalidated() {
				void ctx.deps;
				return dep.invalidated;
			},
			get replaced() {
				void ctx.deps;
				return dep.replaced;
			},
		}),
	);
	return {
		get deps() {
			void ctx.deps;
			return guarded;
		},
		get state() {
			return ctx.state;
		},
		get seed() {
			return ctx.seed;
		},
		get signal() {
			return ctx.signal;
		},
		down: (msgs) => ctx.down(msgs),
		rewire: (list) => ctx.rewire(list),
	};
}

/** A node fn (R-invocation). */
export type NodeFn = (ctx: Ctx) => void;

/** The first run's ctx of each lifetime of a request node, marked by its setup. */
const firstRuns = new WeakMap<AbortSignal, Ctx>();

/**
 * @internal A request node's setup: R-lifetime runs a setup once per lifetime, just before the
 * first run, with that run's ctx, which this marks as the run that sees the snapshots.
 */
export function markRequestFirstRun(ctx: Ctx): void {
	firstRuns.set(ctx.signal, ctx);
}

/**
 * @internal The values a request input `depIndex` received in this run, or null when none came.
 * A lifetime's first run sees its dependencies' snapshots (R-lifetime), so what a request state
 * held when the node activated is not a request: the node is built with
 * `setup: markRequestFirstRun`, and the run its setup marked returns null. A restored node whose
 * first run does not reach its function leaves no later run marked.
 */
export function requestWrites(ctx: Ctx, depIndex: number): readonly unknown[] | null {
	if (firstRuns.get(ctx.signal) === ctx) return null;
	const waves = ctx.deps[depIndex]?.waves ?? [];
	return waves.length === 0 ? null : waves.flat();
}
