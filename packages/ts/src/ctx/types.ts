/**
 * The fn-invocation context and per-dep input shapes.
 *
 * Canonical authority: ~/src/graphrefly/spec/rules.jsonl
 *   R-fn-contract (D8/D27), R-ctx-state (D23/D29), R-cleanup-hooks (D28), R-ctx-up.
 */

import type { Dispatcher } from "../dispatcher/index.js";
import type { EnvironmentDrivers } from "../graph/environment.js";
import type { Node } from "../node/node.js";
import { type Message, SENTINEL, type Wave } from "../protocol/messages.js";

/**
 * A downstream sink (graphrefly-ts:D175): called once per array the node sends, with the whole
 * array; the first array is START followed by the node's snapshot (R-subscription). Arrays that
 * carry DATA, RESOLVED, INVALIDATE, COMPLETE or ERROR begin with the kernel's PENDING (R-wave).
 */
export type Sink = (msgs: Wave) => void;

/**
 * @internal A dependent node's connection to one dependency: it receives each message with the
 * array it belongs to (`wave` is one token per array, `last` marks its end); `snapshot` marks the
 * snapshot a new dependent receives, which is not a live wave. A bare PENDING with no delivery is
 * the kernel's pending mark, sent ahead of the values through the whole cone (R-wave).
 */
export type DependentSink = (msg: Message, delivery?: DeliveryMeta) => void;

/** Internal delivery metadata used to preserve the upstream `ctx.down(msgs)` wave boundary. */
export interface DeliveryMeta {
	readonly wave: object;
	readonly last: boolean;
	readonly snapshot?: boolean;
}

/**
 * Internal current-value reader. It is deliberately a symbol-backed implementation detail:
 * raw ctx exposes `waveData` + `terminal`; helpers below derive from that plus this dep cache.
 */
export const CTX_DEP_CACHE: unique symbol = Symbol.for("graphrefly.ctx.depCache");

export interface CtxDepCache {
	readonly latest: readonly unknown[];
}

export interface CtxDepWaveOrigin {
	readonly live: readonly (readonly boolean[])[];
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
}

/** Per-dep wave projections: dep -> waves -> values/SENTINEL markers. */
export type WaveData = readonly (readonly (readonly unknown[])[])[];

/** Terminal metadata parallel to `waveData`: false = none, true = COMPLETE, otherwise ERROR payload. */
export type TerminalData = readonly unknown[];

/**
 * Check whether a terminal slot carries COMPLETE.
 *
 * @param t - Terminal slot value from {@link Ctx.terminal}.
 * @returns `true` when the slot is the COMPLETE shorthand `true`.
 * @example
 * ```ts
 * isTerminalComplete(true); // true
 * ```
 * @category core
 */
export function isTerminalComplete(t: unknown): t is true {
	return t === true;
}

/**
 * Check whether a terminal slot carries ERROR payload data.
 *
 * @param t - Terminal slot value from {@link Ctx.terminal}.
 * @returns `true` when the slot is neither none nor COMPLETE.
 * @example
 * ```ts
 * isTerminalError(new Error("boom")); // true
 * ```
 * @category core
 */
export function isTerminalError(t: unknown): boolean {
	return !isTerminalNone(t) && !isTerminalComplete(t);
}

/**
 * Read the terminal payload when the slot is an ERROR value.
 *
 * @param t - Terminal slot value from {@link Ctx.terminal}.
 * @returns The payload when `t` is an ERROR slot, otherwise `undefined`.
 * @example
 * ```ts
 * terminalErrorValue(new Error("boom"));
 * ```
 * @category core
 */
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
 * (after the current wave settles / batch commit) as a fresh wave, reusing
 * R-rewire surgical/Option-C semantics (D42). This is the ONLY legal self-triggered rewire — an
 * IMMEDIATE in-fn `node.subscribeDep/unsubscribeDep/replaceDeps` is the D37 mid-fn feedback-cycle ERROR. An
 * added cached dep pushes `[PENDING,DATA]` on the boundary wave (R-push-subscribe); a removed dep
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
	 * Emit downstream toward sinks: the function's only output (R-invocation). Nothing travels up
	 * the graph (R-messages). PENDING and RESOLVED are the kernel's and are rejected here (R-wave).
	 */
	down(msgs: Wave): void;
	/**
	 * The single raw dep-value input surface (R-ctx-wave-data / D77): dep -> upstream waves ->
	 * per-wave DATA payloads and INVALIDATE/SENTINEL markers. `waveData[i] = []` means dep i
	 * delivered no wave to this invocation; `waveData[i] = [[]]` means RESOLVED-only.
	 */
	waveData: WaveData;
	/** Terminal metadata for the same invocation; terminal values never enter `waveData`. */
	terminal: TerminalData;
	/**
	 * R-invalidation: under the manual INVALIDATE policy, `invalidated[i]` is true when an
	 * INVALIDATE reached dependency i in this wave; the function decides what to clear and whether
	 * to send INVALIDATE itself. Always false under the auto policy, where the function does not
	 * run for an INVALIDATE.
	 */
	invalidated: readonly boolean[];
	/** Private state for the current lifetime (R-invocation, R-lifetime). */
	state: CtxState;
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
	 * Deferred SELF-rewire (R-rewire-deferred / D47) — the substrate affordance higher-order
	 * operators (switchMap/mergeMap/concatMap/exhaustMap/flatMap) use to grow/shrink their own
	 * inner-source dep set in response to their own data. Always present; see {@link RewireNext}.
	 */
	rewireNext: RewireNext;
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

/** Number of declared dep slots visible in this invocation.
 * @param ctx - Node execution context supplied by the dispatcher.
 * @returns A `number` value.
 * @category core
 * @example
 * ```ts
 * import { depCount } from "@graphrefly/ts/core";
 * ```
 */
export function depCount(ctx: Ctx): number {
	return ctx.waveData.length;
}

/**
 * Check whether a terminal slot carries no terminal state.
 *
 * @param t - Terminal slot value from {@link Ctx.terminal}.
 * @returns `true` when the slot is `false` or `undefined`.
 * @example
 * ```ts
 * isTerminalNone(false); // true
 * ```
 * @category core
 */
export function isTerminalNone(t: unknown): boolean {
	return t === false || t === undefined;
}

/** DATA/SENTINEL projection batches delivered by one dep in this invocation.
 * @param ctx - Node execution context supplied by the dispatcher.
 * @param depIndex - dep index value used by the helper.
 * @returns A `readonly (readonly unknown[])[]` value.
 * @category core
 * @example
 * ```ts
 * import { depWaves } from "@graphrefly/ts/core";
 * ```
 */
export function depWaves(ctx: Ctx, depIndex: number): readonly (readonly unknown[])[] {
	return ctx.waveData[depIndex] ?? [];
}

/** Flattened DATA projection for event-counting operator bodies; null = no wave.
 * @param ctx - Node execution context supplied by the dispatcher.
 * @param depIndex - dep index value used by the helper.
 * @returns A `readonly unknown[] | null` value.
 * @category core
 * @example
 * ```ts
 * import { depBatch } from "@graphrefly/ts/core";
 * ```
 */
export function depBatch(ctx: Ctx, depIndex: number): readonly unknown[] | null {
	const waves = depWaves(ctx, depIndex);
	if (waves.length === 0) return null;
	const flattened = waves.flat().filter((v) => v !== SENTINEL);
	return flattened.length === 0 ? [] : flattened;
}

/** Internal adapter helper: dep waves produced by live graph-event deliveries only. */
export function depLiveWaves(ctx: Ctx, depIndex: number): readonly (readonly unknown[])[] {
	const waves = depWaves(ctx, depIndex);
	const live = ctxDepWaveOrigins.get(ctx)?.live[depIndex] ?? [];
	return waves.filter((_, index) => live[index]);
}

/** Internal adapter helper: flattened DATA values from live-delivered dep waves only. */
export function depLiveBatch(ctx: Ctx, depIndex: number): readonly unknown[] | null {
	const waves = depLiveWaves(ctx, depIndex);
	if (waves.length === 0) return null;
	const flattened = waves.flat().filter((v) => v !== SENTINEL);
	return flattened.length === 0 ? [] : flattened;
}

/**
 * Read the most recent DATA value from one upstream dependency during a node run.
 *
 * `depIndex` is positional: `0` reads the first dependency in `node([first, ...])`, `1` reads the
 * second dependency, and so on. If that dependency has not produced DATA in the current graph
 * lifecycle, the value is `undefined`.
 *
 * @param ctx - Node execution context supplied by the dispatcher.
 * @param depIndex - Zero-based dependency position in the node's dependency list.
 * @returns The latest DATA value for that dependency, or `undefined` when no DATA is available yet.
 * @category core
 * @example
 * ```ts
 * import { depLatest, node } from "@graphrefly/ts/core";
 *
 * const count = node<number>([], null, { initial: 1 });
 * const doubled = node<number>([count], (ctx) => {
 *   const latest = depLatest(ctx, 0);
 *   if (latest === undefined) return;
 *   ctx.down([["DATA", Number(latest) * 2]]);
 * });
 * ```
 */
export function depLatest(ctx: Ctx, depIndex: number): unknown {
	return ctx[CTX_DEP_CACHE]?.latest[depIndex];
}

/** Terminal metadata for one dep: false = none, true = COMPLETE, otherwise ERROR payload.
 * @param ctx - Node execution context supplied by the dispatcher.
 * @param depIndex - dep index value used by the helper.
 * @returns The dep terminal result.
 * @category core
 * @example
 * ```ts
 * import { depTerminal } from "@graphrefly/ts/core";
 * ```
 */
export function depTerminal(ctx: Ctx, depIndex: number): unknown {
	const t = ctx.terminal[depIndex];
	return t === undefined ? false : t;
}
