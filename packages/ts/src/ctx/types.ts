/**
 * The fn-invocation context and per-dep record shapes.
 *
 * Canonical authority: ~/src/graphrefly/spec/rules.jsonl
 *   R-fn-contract (D8/D27), R-ctx-state (D23/D29), R-cleanup-hooks (D28), R-ctx-up.
 */

import type { Node } from "../node/node.js";
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
 * Deferred SELF-rewire (R-rewire-deferred / D47). A node fn may, DURING its run, request a
 * mutation of its OWN dep set; the request is QUEUED and applied at the committed wave boundary
 * (after the current wave settles / batch commit / final-lock RESUME) as a fresh wave, reusing
 * R-rewire surgical/Option-C semantics (D42). This is the ONLY legal self-triggered rewire — an
 * IMMEDIATE in-fn `node.addDep/removeDep/setDeps` is the D37 mid-fn feedback-cycle ERROR. An
 * added cached dep pushes `[DIRTY,DATA]` on the boundary wave (R-push-subscribe); a removed dep
 * is drained and, if it loses its last subscriber, `_deactivate`s + fires `onDeactivation`
 * (input-side teardown — the basis for higher-order operator cancellation / abortInFlight).
 */
export interface RewireNext {
	/** Defer adding a dep (paired with the re-supplied fn — positional fn-deps lock, SD-1). */
	addDep(dep: Node<unknown>, fn: NodeFn): void;
	/** Defer removing a dep (its source is torn down if it loses its last subscriber). */
	removeDep(dep: Node<unknown>, fn: NodeFn): void;
	/** Defer replacing the whole dep set (surgical: kept deps untouched, removed drained, added fresh-subscribe). */
	setDeps(deps: Node<unknown>[], fn: NodeFn): void;
}

/**
 * The single argument to a node fn: `(ctx) => void` (R-fn-contract / D8). All emission
 * is explicit via `ctx.down`; there is no return-value framing.
 */
export interface Ctx {
	/**
	 * Emit upstream toward deps — control tiers only (R-ctx-up). IMMEDIATE. `towardDep` (a dep index)
	 * routes the wave up ONE declared edge (R-up-routing directed-up); omitted = broadcast up all deps.
	 * A pull DEMAND is `up([[RESUME, pullId]])` — but for a SELF-demand (demanding a dep this fn also
	 * reads) use {@link Ctx.upNext} instead, since an immediate demand whose delivery loops back
	 * re-enters this fn mid-wave (D37 / R-reentrancy).
	 */
	up(msgs: Wave, towardDep?: number): void;
	/** Emit downstream toward sinks. */
	down(msgs: Wave): void;
	depRecords: readonly DepRecord[];
	state: CtxState;
	/** Release external resources on deactivation (R-cleanup-hooks). */
	onDeactivation(fn: () => void): void;
	/** Flush on INVALIDATE (R-cleanup-hooks). */
	onInvalidate(fn: () => void): void;
	/**
	 * Deferred SELF-rewire (R-rewire-deferred / D47) — the substrate affordance higher-order
	 * operators (switchMap/mergeMap/concatMap/exhaustMap/flatMap) use to grow/shrink their own
	 * inner-source dep set in response to their own data. Always present; see {@link RewireNext}.
	 */
	rewireNext: RewireNext;
	/**
	 * Deferred up — the boundary-deferred form of {@link Ctx.up} (R-up-routing / R-pull / D59). Routes
	 * `msgs` up from this node at the COMMITTED wave boundary (broadcast, or up the single `towardDep`
	 * edge), riding the same R-rewire-deferred (D47) drain as {@link RewireNext}. This is the
	 * SELF-DEMAND path: a consumer issues `ctx.upNext([[RESUME, pullId]])` to demand a pull dep it
	 * ALSO reads — the cone-routed RESUME reaches the pullId-holder, whose delivery loops back as a
	 * FRESH wave (not a mid-fn re-entry → no D37). The consumer accepts one-wave latency (the
	 * HTTP-request model). No node reference needed: the author writes the pullId verbatim.
	 */
	upNext(msgs: Wave, towardDep?: number): void;
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
