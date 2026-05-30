/**
 * The fn-invocation context and per-dep record shapes.
 *
 * Canonical authority: ~/src/graphrefly/spec/rules.jsonl
 *   R-fn-contract (D8/D27), R-ctx-state (D23/D29), R-cleanup-hooks (D28), R-ctx-up.
 */

import type { Message, Wave } from "../protocol/messages.js";

/** A downstream sink callback (the only way to connect to a node's output). */
export type Sink = (msg: Message) => void;

/**
 * Per-dependency record visible to a node's fn (R-fn-contract). One per declared dep.
 */
export interface DepRecord<T = unknown> {
	/** DATA values this dep delivered in the current wave; `null` = dep not involved, `[]` = RESOLVED-only. */
	batch: readonly T[] | null;
	/** Last DATA value from any wave (incl prior); SENTINEL (`undefined`) = never emitted DATA. */
	prevData: T | undefined;
	/** Convenience: latest DATA = last of `batch` if present, else `prevData`. */
	latest: T | undefined;
	/** Tier of this dep's most recent message in the current wave (0 if none). */
	tier: number;
	/** Terminal state: `undefined` = live, `true` = COMPLETE, otherwise the ERROR payload. */
	terminal: true | unknown | undefined;
}

/**
 * Per-node private cross-wave state (R-ctx-state / D23,D29). Default fresh-lifecycle
 * wipe; `persist(true)` keeps it across lifecycle transitions.
 */
export interface CtxState {
	get<S = unknown>(): S | undefined;
	set<S = unknown>(v: S): void;
	persist(on?: boolean): void;
}

/**
 * The single argument to a node fn: `(ctx) => void` (R-fn-contract / D8). All emission
 * is explicit via `ctx.down`; there is no return-value framing.
 */
export interface Ctx {
	/** Emit upstream toward deps — control tiers only (R-ctx-up). */
	up(msgs: Wave): void;
	/** Emit downstream toward sinks. */
	down(msgs: Wave): void;
	depRecords: readonly DepRecord[];
	state: CtxState;
	/** Release external resources on deactivation (R-cleanup-hooks). */
	onDeactivation(fn: () => void): void;
	/** Flush on INVALIDATE (R-cleanup-hooks). */
	onInvalidate(fn: () => void): void;
	/**
	 * Read a dep's latest value by index (dynamicNode only, R-dynamic-node / D35).
	 * Present only on dynamicNode fns; all declared deps still participate in wave
	 * tracking. Under D49/R-resolved-undirty an unread dep's change still fires the fn,
	 * which re-emits its (unchanged) output as a DATA occurrence — there is NO equals-
	 * absorption; pair with distinctUntilChanged to suppress unchanged re-emits (opt-in).
	 */
	track?(depIndex: number): unknown;
}

/** A node fn (R-fn-contract). Registered in a dispatcher pool, indexed by Handle. */
export type NodeFn = (ctx: Ctx) => void;
