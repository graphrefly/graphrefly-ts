/**
 * The fn-invocation context and per-dep input shapes.
 *
 * Canonical authority: ~/src/graphrefly/spec/rules.jsonl
 *   R-fn-contract (D8/D27), R-ctx-state (D23/D29), R-cleanup-hooks (D28), R-ctx-up.
 */

import type { Dispatcher } from "../dispatcher/index.js";
import type { EnvironmentDrivers } from "../graph/environment.js";
import type { Node } from "../node/node.js";
import { type Message, type PullDemand, SENTINEL, type Wave } from "../protocol/messages.js";

/** A downstream sink callback (the only way to connect to a node's output). */
export type Sink = (msg: Message, delivery?: DeliveryMeta) => void;

/** Internal delivery metadata used to preserve the upstream `ctx.down(msgs)` wave boundary. */
export interface DeliveryMeta {
	readonly wave: object;
	readonly last: boolean;
}

/**
 * Internal current-value reader. It is deliberately a symbol-backed implementation detail:
 * raw ctx exposes `waveData` + `terminal`; helpers below derive from that plus this dep cache.
 */
export const CTX_DEP_CACHE: unique symbol = Symbol("graphrefly.ctx.depCache");

export interface CtxDepCache {
	readonly latest: readonly unknown[];
}

/** Internal node-construction binding for graph-local helper-created deps. */
export const CTX_NODE_BINDING: unique symbol = Symbol("graphrefly.ctx.nodeBinding");

export interface CtxNodeBinding {
	readonly dispatcher: Dispatcher;
	create<T>(factory: () => Node<T>): Node<T>;
}

/** Per-dep wave projections: dep -> waves -> values/SENTINEL markers. */
export type WaveData = readonly (readonly (readonly unknown[])[])[];

/** Terminal metadata parallel to `waveData`: false = none, true = COMPLETE, otherwise ERROR payload. */
export type TerminalData = readonly unknown[];

export function isTerminalNone(t: unknown): boolean {
	return t === false || t === undefined;
}

export function isTerminalComplete(t: unknown): t is true {
	return t === true;
}

export function isTerminalError(t: unknown): boolean {
	return !isTerminalNone(t) && !isTerminalComplete(t);
}

export function terminalErrorValue(t: unknown): unknown {
	return isTerminalError(t) ? t : undefined;
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
 * IMMEDIATE in-fn `node.subscribeDep/unsubscribeDep/replaceDeps` is the D37 mid-fn feedback-cycle ERROR. An
 * added cached dep pushes `[DIRTY,DATA]` on the boundary wave (R-push-subscribe); a removed dep
 * is drained and, if it loses its last subscriber, `_deactivate`s + fires `onDeactivation`
 * (input-side teardown — the basis for higher-order operator cancellation / abortInFlight).
 */
export interface RewireNext {
	/** Defer subscribing to a dep (paired with the re-supplied fn — positional fn-deps lock, SD-1). */
	subscribeDep(dep: Node<unknown>, fn: NodeFn): void;
	/** Defer unsubscribing from a dep (its source is torn down if it loses its last subscriber). */
	unsubscribeDep(dep: Node<unknown>, fn: NodeFn): void;
	/** Defer replacing the whole dep set (surgical: kept deps untouched, removed drained, added fresh-subscribe). */
	replaceDeps(deps: Node<unknown>[], fn: NodeFn): void;
}

/**
 * The single argument to a node fn: `(ctx) => void` (R-fn-contract / D8). All emission
 * is explicit via `ctx.down`; there is no return-value framing.
 */
export interface Ctx {
	/**
	 * Emit upstream toward deps — control tiers only (R-ctx-up). IMMEDIATE. `towardDep` (a dep index)
	 * routes the wave up ONE declared edge (R-up-routing directed-up); omitted = broadcast up all deps.
	 * A pull DEMAND is `up([[PULL, { pullId, params }]])` — but for a SELF-demand (demanding a dep
	 * this fn also reads) use {@link Ctx.upNext} instead, since an immediate demand whose delivery loops back
	 * re-enters this fn mid-wave (D37 / R-reentrancy).
	 */
	up(msgs: Wave, towardDep?: number): void;
	/** Emit downstream toward sinks. */
	down(msgs: Wave): void;
	/**
	 * The single raw dep-value input surface (R-ctx-wave-data / D77): dep -> upstream waves ->
	 * per-wave DATA payloads and INVALIDATE/SENTINEL markers. `waveData[i] = []` means dep i
	 * delivered no wave to this invocation; `waveData[i] = [[]]` means RESOLVED-only.
	 */
	waveData: WaveData;
	/** Terminal metadata for the same invocation; terminal values never enter `waveData`. */
	terminal: TerminalData;
	state: CtxState;
	/** Release external resources on deactivation (R-cleanup-hooks). */
	onDeactivation(fn: () => void): void;
	/** Flush on INVALIDATE (R-cleanup-hooks). */
	onInvalidate(fn: () => void): void;
	/** Graph-owned environment drivers for source/adapter boundaries (D130/D131). */
	environment(): EnvironmentDrivers;
	/** Holder-visible context for a PULL-caused invocation (D272); absent for ordinary waves. */
	readonly pull?: PullDemand;
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
	 * SELF-DEMAND path: a consumer issues `ctx.upNext([[PULL, { pullId, params }]])` to demand a pull
	 * dep it ALSO reads — the cone-routed PULL reaches the pullId-holder, whose delivery loops back as a
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
	[CTX_DEP_CACHE]?: CtxDepCache;
	[CTX_NODE_BINDING]?: CtxNodeBinding;
}

/** A node fn (R-fn-contract). Registered in a dispatcher pool, indexed by Handle. */
export type NodeFn = (ctx: Ctx) => void;

/** Number of declared dep slots visible in this invocation. */
export function depCount(ctx: Ctx): number {
	return ctx.waveData.length;
}

/** DATA/SENTINEL projection batches delivered by one dep in this invocation. */
export function depWaves(ctx: Ctx, depIndex: number): readonly (readonly unknown[])[] {
	return ctx.waveData[depIndex] ?? [];
}

/** Flattened DATA projection for old event-counting operator bodies; null = no wave. */
export function depBatch(ctx: Ctx, depIndex: number): readonly unknown[] | null {
	const waves = depWaves(ctx, depIndex);
	if (waves.length === 0) return null;
	const flattened = waves.flat().filter((v) => v !== SENTINEL);
	return flattened.length === 0 ? [] : flattened;
}

/** Latest cached DATA for a dep, derived from implementation-owned dep cache. */
export function depLatest(ctx: Ctx, depIndex: number): unknown {
	return ctx[CTX_DEP_CACHE]?.latest[depIndex];
}

/** Terminal metadata for one dep: false = none, true = COMPLETE, otherwise ERROR payload. */
export function depTerminal(ctx: Ctx, depIndex: number): unknown {
	const t = ctx.terminal[depIndex];
	return t === undefined ? false : t;
}
