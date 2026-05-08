/**
 * `NodeImpl` — the single GraphReFly node primitive.
 *
 * Per-dep state lives in a `DepRecord[]` — one entry per declared dep —
 * consolidating subscription cleanup, latest-data tracking, dirty/settled
 * flags, and terminal state into a single structure per dep.
 *
 * This file also owns the default singleton handlers (`defaultOnMessage`,
 * `defaultOnSubscribe`), the `defaultConfig` instance, and the public
 * `configure(...)` entry point. They live here because their bodies touch
 * `NodeImpl` internals; `config.ts` stays NodeImpl-agnostic.
 *
 * See GRAPHREFLY-SPEC §2 and COMPOSITION-GUIDE §1/§9 for the behavior
 * contract. See SESSION-foundation-redesign.md §§1–10 for design history.
 */

import { registerBuiltinCodecs } from "../graph/codec.js";
import type { Actor } from "./actor.js";
import { normalizeActor } from "./actor.js";
import {
	_setMaxBatchDrainIterationsGetter,
	downWithBatch,
	isExplicitlyBatching,
	registerBatchFlushHook,
} from "./batch.js";
import { monotonicNs, wallClockNs } from "./clock.js";
import type {
	MessageContext,
	NodeActions,
	NodeCtx,
	OnMessageHandler,
	OnSubscribeHandler,
	SubscribeContext,
} from "./config.js";
import { GraphReFlyConfig, registerBuiltins } from "./config.js";
import type { GuardAction, NodeGuard } from "./guard.js";
import { GuardDenied } from "./guard.js";
import {
	COMPLETE,
	COMPLETE_MSG,
	COMPLETE_ONLY_BATCH,
	DATA,
	DIRTY,
	DIRTY_MSG,
	DIRTY_ONLY_BATCH,
	ERROR,
	INVALIDATE,
	INVALIDATE_ONLY_BATCH,
	type Message,
	type Messages,
	PAUSE,
	RESOLVED,
	RESOLVED_MSG,
	RESOLVED_ONLY_BATCH,
	RESUME,
	START,
	START_MSG,
	TEARDOWN,
	TEARDOWN_ONLY_BATCH,
} from "./messages.js";
import {
	advanceVersion,
	createVersioning,
	defaultHash,
	type HashFn,
	type NodeVersionInfo,
	type VersioningLevel,
} from "./versioning.js";

// ---------------------------------------------------------------------------
// Internal sentinel + type helpers
// ---------------------------------------------------------------------------

/**
 * Placeholder unsubscribe used to mark a dep subscription as "pending" during
 * the synchronous window between `dep.unsub = noopUnsub` and the return of
 * `dep.node.subscribe(...)`. Ensures the liveness check `dep.unsub === null`
 * in the subscription callback correctly passes for synchronous push-on-
 * subscribe deliveries, while still blocking stale drainPhase2 closures that
 * fire after deactivation has set `dep.unsub = null`.
 */
const noopUnsub: () => void = () => {};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a node.
 *
 * @see GRAPHREFLY-SPEC.md §2.2
 */
export type NodeStatus =
	| "sentinel"
	| "pending"
	| "dirty"
	| "settled"
	| "resolved"
	| "completed"
	| "errored";

/** Callback that receives downstream message batches. */
export type NodeSink = (messages: Messages) => void;

/**
 * Observability hook events fired by a per-node inspector. Used by
 * `Graph.observe(path, { causal, derived })` to build causal traces.
 *
 * - `"dep_message"` — fires in `_onDepMessage` before default dispatch,
 *   one event per message received from a dep. Includes `depIndex` and
 *   the raw `Message` tuple.
 * - `"run"` — fires in `_execFn` just before the user fn runs. Includes
 *   the per-dep `prevData` snapshot that will be passed to fn.
 */
export type NodeInspectorHookEvent =
	| { kind: "dep_message"; depIndex: number; message: Message }
	| {
			kind: "run";
			batchData: readonly (readonly unknown[] | undefined)[];
			prevData: readonly unknown[];
	  };

/** Callback attached to a node for per-message/per-run inspection. */
export type NodeInspectorHook = (event: NodeInspectorHookEvent) => void;

/** Describe `type` for `Graph.describe` (GRAPHREFLY-SPEC Appendix B). */
export type NodeDescribeKind = "state" | "derived" | "producer" | "effect";

/** Actor/delivery context for {@link Node.down} and {@link Node.up}. */
export type NodeTransportOptions = {
	actor?: Actor;
	/** When `true`, skips guard checks. */
	internal?: boolean;
	/** `signal` for `Graph.signal` deliveries; default `write`. */
	delivery?: "write" | "signal";
};

/**
 * Cleanup return shape from a node {@link NodeFn}.
 *
 * Lock 4.A (Phase 13.6.A) renamed the named-hook fields:
 *
 * - `onRerun` fires before the next fn invocation (i.e. between waves once
 *   fn has settled and is about to recompute).
 * - `onDeactivation` fires on deactivation (last-sink unsubscribe or
 *   TEARDOWN).
 * - `onInvalidate` fires on INVALIDATE (spec v0.4 graph-wide flush signal).
 *
 * Each hook is independent and fires exactly once on its named transition;
 * missing hooks are no-ops. Returning `{}` (or no cleanup) is valid — the
 * common case. Returning all three slots covers every lifecycle event.
 *
 * **Transitional shim:** the legacy `() => void` shorthand (single fn that
 * fired on rerun + deactivation + invalidate) is still accepted at runtime,
 * mapped to `{ onDeactivation: fn, onRerun: fn, onInvalidate: fn }` for
 * back-compat during the 13.6.B sweep. The shorthand will be removed in a
 * follow-up batch (tracked in `docs/optimizations.md`); new code should use
 * the named-hook object form.
 *
 * Closure access: hooks are declared inside `NodeFn`, so they see the same
 * closure as the fn body (per-run locals, `ctx.store`, dep refs).
 */
export type NodeFnCleanup =
	| (() => void)
	| {
			onRerun?: () => void;
			onDeactivation?: () => void;
			onInvalidate?: () => void;
			/**
			 * Phase 13.6.B QA D1 (Lock 6.D follow-up): fires from
			 * `_resetForFreshLifecycle` — the post-terminal-resubscribable
			 * reset path that runs WITHOUT `_deactivate`. Two callers:
			 *   1. `subscribe()` after a terminal-resubscribable node was
			 *      kept alive by another sink (multi-sub-stayed case);
			 *   2. INVALIDATE on a terminal-resubscribable node.
			 *
			 * Pre-Lock-6.D the framework auto-wiped `ctx.store` on this
			 * path. Post-flip the store preserves; operators with
			 * one-shot store flags (`frozenContext.emitted`,
			 * `take.completed`, etc.) need an explicit hook to clear
			 * those flags when the node enters a fresh lifecycle without
			 * deactivation.
			 *
			 * Distinct from `onDeactivation` because the cleanup contract
			 * is different: `onDeactivation` may dispose timers /
			 * subscriptions / external resources that must NOT be
			 * disposed on a mid-life lifecycle reset. Use this slot ONLY
			 * for store-state resets that need to fire on every "fresh
			 * lifecycle" transition.
			 */
			onResubscribableReset?: () => void;
	  };

/**
 * Fn-time context exposing per-wave metadata and a per-node persistent
 * scratch pad.
 *
 * - `prevData[i]` — last DATA value from dep `i` as of the END of the
 *   previous wave (i.e. the value that was stable before this wave started).
 *   Use as the fallback when `data[i]` is `undefined` (not involved) or
 *   `[]` (RESOLVED, no new values this wave).
 *   `undefined` means dep `i` has never produced DATA (sentinel state).
 *   `null` is a valid DATA value. `undefined` is not a valid DATA value —
 *   the protocol reserves it as the "never sent" sentinel.
 *   - `ctx.prevData[i] === undefined` → dep has never produced DATA
 *   - `ctx.prevData[i] !== undefined` → last DATA value (may be `null`)
 * - `terminalDeps[i]` — runtime shape:
 *   - `undefined` → dep `i` is still live.
 *   - `true` → dep `i` sent COMPLETE.
 *   - anything else → dep `i` sent ERROR, value is the error payload.
 *   Type is `readonly unknown[]` because `true | unknown` collapses to
 *   `unknown` anyway; the three states are documented contract, not type.
 * - `store` — mutable bag that persists across fn runs. Lock 6.D (Phase
 *   13.6.B) flipped the default: store now PRESERVES across deactivation
 *   and across terminal-resubscribable lifecycle reset. Operators that
 *   want the old wipe-on-deactivation behavior must clear keys explicitly
 *   in `onDeactivation`. See COMPOSITION-GUIDE-GRAPH §20.
 */
export interface FnCtx {
	readonly prevData: readonly unknown[];
	readonly terminalDeps: readonly unknown[];
	readonly store: Record<string, unknown>;
}

/**
 * Compute function passed to `node(deps, fn, opts?)`.
 *
 * `data[i]` holds the batch of DATA values received from dep `i` during the
 * current wave. Shape contract:
 * - `undefined` — dep `i` was not involved in this wave (no DIRTY received).
 * - `[]` — dep `i` was involved (dirtied), but settled as RESOLVED (value
 *   unchanged). Use `ctx.prevData[i]` to read its last known value from the
 *   previous wave.
 * - `[v1, v2, ...]` — dep `i` sent one or more DATA values. `at(-1)` gives
 *   the latest; iterate for multi-emission processing.
 *
 * Emission is explicit via `actions.emit(v)` (sugar: equals + framing) or
 * `actions.down(msgs)` (raw). Return a cleanup shape to register teardown:
 * `{ onRerun?, onDeactivation?, onInvalidate? }` (each hook fires on its
 * named transition only — Lock 4.A, named-hooks only post-13.6.A). See
 * {@link NodeFnCleanup}. Any non-cleanup return value is ignored. The
 * `| void` leg lets arrow-block bodies satisfy `NodeFn` without an explicit
 * `return undefined`.
 *
 * Sugar constructors (`derived`, `effect`, `dynamicNode`) unwrap `data[i]`
 * to a single scalar (`at(-1)` with `ctx.prevData[i]` fallback) so their
 * user-facing fn signatures stay unchanged. Use raw `node()` when you need
 * the full batch array.
 */
export type NodeFn = (
	data: readonly (readonly unknown[] | undefined)[],
	actions: NodeActions,
	ctx: FnCtx,
	// biome-ignore lint/suspicious/noConfusingVoidType: see JSDoc above.
) => NodeFnCleanup | void;

/** Options accepted by every node constructor. */
export interface NodeOptions<T = unknown> {
	name?: string;
	describeKind?: NodeDescribeKind;
	equals?: (a: T, b: T) => boolean;
	/**
	 * Pre-populate the cache at construction. `null` is a valid initial value.
	 * `undefined` is treated as absent (not a valid DATA payload).
	 */
	initial?: T | null;
	meta?: Record<string, unknown>;
	resubscribable?: boolean;
	resetOnTeardown?: boolean;
	/** Auto-emit `[[COMPLETE]]` when all deps complete. Default `true`. */
	completeWhenDepsComplete?: boolean;
	/**
	 * Auto-propagate `[[ERROR]]` when any dep errors. Default `true`.
	 * Set `false` only for rescue/catchError operators that handle errors
	 * explicitly via `ctx.terminalDeps`.
	 */
	errorWhenDepsError?: boolean;
	/**
	 * First-run gate (§2.7). When `false` (default — matches the universal
	 * contract "fn does not fire until every declared dep has delivered"), fn
	 * is held until every declared dep has delivered at least one DATA or
	 * terminal. Sugar constructors (`derived`, `effect`) inherit the default
	 * so multi-parent activation produces one combined initial wave
	 * `[[START], [DIRTY], [DATA, fn(init...)]]` instead of the sequential
	 * `[[START], [DIRTY], [RESOLVED], [DIRTY], [DATA]]` shape produced by
	 * per-dep push-on-subscribe firings.
	 *
	 * When `true`, fn fires as soon as `_dirtyDepCount === 0` regardless of
	 * whether any dep is still sentinel. Operators like `withLatestFrom`,
	 * `valve`, and worker-bridge aggregators that deliberately fire on
	 * partial deps pass `partial: true` explicitly. Zero-dep producer-pattern
	 * factories (`stratify`, `budgetGate`, etc.) are unaffected either way —
	 * an empty `_deps` array has nothing for the gate to hold on.
	 *
	 * Gate scope: applies only until fn has fired once (`_hasCalledFnOnce`).
	 * Subsequent waves, INVALIDATE, and `_addDep` do not re-gate. Terminal
	 * reset (resubscribable node reconnect) resets `_hasCalledFnOnce` and
	 * re-arms the gate.
	 */
	partial?: boolean;
	/**
	 * Tier-2 PAUSE/RESUME handling.
	 * - `true` (default): wave completion suppressed while paused; fn fires
	 *   once on RESUME if gate is satisfied.
	 * - `false`: node ignores PAUSE (sources like timers that must keep running).
	 * - `"resumeAll"`: on RESUME, replay every buffered DATA (future).
	 */
	pausable?: boolean | "resumeAll";
	/**
	 * Spec §2.5 / Lock 6.G — circular buffer of last-N **outgoing** DATA
	 * values. When set to a positive integer `N`, the node retains the last
	 * `N` values it actually delivered to sinks. New (late) subscribers
	 * receive the buffer as `[[START], [DATA, v0], [DATA, v1], …, [DATA, vK-1]]`
	 * after the START handshake — see `defaultOnSubscribe`. Replaces the
	 * old `replay()` operator + `wrapSubscribeHook` monkey-patching pattern.
	 *
	 * Semantic notes:
	 * - **Outgoing-DATA-only (post-equals).** RESOLVED entries
	 *   (equals-substitution collapses) are NOT buffered. Pause-buffered
	 *   DATA is NOT pushed until the RESUME drain actually dispatches it
	 *   to sinks — the buffer reflects what subscribers observed, not
	 *   internal cache advances mid-pause. **On RESUME drain, each
	 *   buffered wave re-runs through `_updateState` and re-applies
	 *   equals-substitution against the walking cache; values that
	 *   collapse to RESOLVED on replay also collapse out of the replay
	 *   buffer, so a sequence of identical-value mid-pause emits
	 *   contributes 0 entries.** This is the locked "post-equals
	 *   outgoing" semantic (QA D6, Phase 13.6.B QA pass).
	 * - **INVALIDATE preserves history.** INVALIDATE clears `_cached` and
	 *   sets status to `"sentinel"` but does NOT touch the replay buffer:
	 *   a late subscriber arriving post-INVALIDATE still receives the
	 *   prior emission history. The buffer represents "values this node
	 *   actually emitted", which an INVALIDATE doesn't retroactively erase.
	 * - **Lifecycle reset clears.** TEARDOWN (`_deactivate`) and
	 *   terminal-resubscribable lifecycle reset (`_resetForFreshLifecycle`)
	 *   both null the buffer — matches the TLA+ model's
	 *   `replaySnapshot' = <<>>` clear in `Resubscribe` (formal model
	 *   batch 6 G).
	 * - **Late-subscribe priority.** When the buffer has entries,
	 *   `defaultOnSubscribe` delivers them INSTEAD of the cache-DATA push
	 *   (the buffer's most-recent entry equals `_cached` at quiescence).
	 *   When the buffer is empty (e.g. node has `initial:` but never
	 *   emitted, or post-resubscribable-reset), the legacy cache-DATA
	 *   push still fires.
	 *
	 * `0` / absent / non-positive values disable the buffer entirely.
	 */
	replayBuffer?: number;
	guard?: NodeGuard;
	versioning?: VersioningLevel;
	versioningId?: string;
	versioningHash?: HashFn;
	/**
	 * Override the config instance this node binds to. Defaults to
	 * {@link defaultConfig}. Useful for test isolation and custom protocol
	 * stacks. The first node that reads any hook on the config freezes it.
	 */
	config?: GraphReFlyConfig;
}

/** A reactive node in the GraphReFly protocol. */
export interface Node<T = unknown> {
	readonly name?: string;
	readonly status: NodeStatus;
	/**
	 * Current cached value. Returns `undefined` when the node is in
	 * `"sentinel"` state (no DATA ever emitted). v5 reserves `undefined`
	 * globally as the sentinel value — the valid DATA type is `T | null`.
	 * Therefore `node.cache === undefined` is a valid "never emitted" guard.
	 * `node.status` distinguishes the richer states (`"sentinel"`,
	 * `"settled"`, `"errored"`, etc.) when you need more than has-value.
	 */
	readonly cache: T | null | undefined;
	readonly meta: Record<string, Node>;
	readonly lastMutation: Readonly<{ actor: Actor; timestamp_ns: number }> | undefined;
	readonly v: Readonly<NodeVersionInfo> | undefined;
	/**
	 * Send one or more messages downstream. Accepts either a single
	 * {@link Message} tuple (e.g. `node.down([DATA, 42])`) or a
	 * {@link Messages} array of tuples (e.g.
	 * `node.down([[DIRTY], [DATA, 42]])`). One call = one wave: the
	 * emit pipeline tier-sorts the input, auto-prefixes `[DIRTY]` when
	 * any tier-3 payload is present and the node is not already dirty,
	 * runs equals substitution against the live cache (§3.5.1), then
	 * dispatches to sinks with phase deferral.
	 */
	down(messageOrMessages: Message | Messages, options?: NodeTransportOptions): void;
	/**
	 * Sugar for `down([[DATA, value]])`. One wave with a single DATA
	 * payload — the pipeline adds the synthetic DIRTY prefix and runs
	 * equals substitution against the live cache.
	 */
	emit(value: T | undefined | null, options?: NodeTransportOptions): void;
	/**
	 * Send one or more messages upstream. Accepts the same shapes as
	 * {@link down}. Upstream is restricted to control-plane tiers
	 * (DIRTY, PAUSE, RESUME, INVALIDATE, TEARDOWN); tier-3 (DATA/RESOLVED)
	 * and tier-5 (COMPLETE/ERROR) payloads throw — value/terminal traffic
	 * is downstream-only in this protocol. No equals substitution, no
	 * cache advance, no DIRTY auto-prefix — the up direction just
	 * forwards to every dep.
	 */
	up?(messageOrMessages: Message | Messages, options?: NodeTransportOptions): void;
	subscribe(sink: NodeSink, actor?: Actor): () => void;
	allowsObserve(actor: Actor): boolean;
	hasGuard(): boolean;
}

// ---------------------------------------------------------------------------
// DepRecord — per-dep state (§8.2)
// ---------------------------------------------------------------------------

/**
 * Per-dep runtime state. One entry per upstream node.
 *
 * `terminal` is the single terminal-state slot, shaped to match
 * {@link FnCtx.terminalDeps}:
 * - `undefined` — dep is still live.
 * - `true` — dep sent COMPLETE.
 * - anything else — dep sent ERROR with that payload.
 *
 * `[ERROR, undefined]` is rejected at the dispatch boundary (`_emit`) per
 * spec §1.2 — `undefined` would collide with the "live" encoding here.
 * Always pass meaningful error values (Error objects, domain tags).
 */
export interface DepRecord {
	readonly node: Node;
	unsub: (() => void) | null;
	/**
	 * Last DATA value from this dep as of the end of the previous completed
	 * wave. `undefined` until dep has produced at least one DATA (sentinel).
	 * Committed by `_execFn` after snapshotting `ctx.prevData` and before
	 * `_clearWaveFlags`. `undefined` is reserved as the "never sent" sentinel —
	 * `undefined` is not a valid DATA payload.
	 */
	prevData: unknown;
	/** True while awaiting DATA/RESOLVED for the current wave. */
	dirty: boolean;
	/**
	 * True if this dep was dirtied in the current wave (set in `_depDirtied`,
	 * cleared in `_clearWaveFlags`). Distinguishes "RESOLVED" (`involvedThisWave
	 * && dataBatch.length === 0`) from "not involved" (`!involvedThisWave`) in
	 * the `data[i]` batch snapshot passed to fn.
	 */
	involvedThisWave: boolean;
	/**
	 * DATA values accumulated from this dep during the current wave.
	 * Populated by `_depSettledAsData`, cleared by `_clearWaveFlags`.
	 * Snapshotted (copied) by `_execFn` before `_clearWaveFlags` runs so
	 * that fn always sees the full wave batch.
	 */
	dataBatch: unknown[];
	/** Terminal-state slot — see JSDoc on {@link DepRecord}. */
	terminal: unknown;
}

function createDepRecord(n: Node): DepRecord {
	return {
		node: n,
		unsub: null,
		prevData: undefined,
		dirty: false,
		involvedThisWave: false,
		dataBatch: [],
		terminal: undefined,
	};
}

function resetDepRecord(d: DepRecord): void {
	d.prevData = undefined;
	d.dirty = false;
	d.involvedThisWave = false;
	d.dataBatch.length = 0;
	d.terminal = undefined;
}

/**
 * @internal Returns `true` if `target` is reachable from `from` via upstream
 * dep traversal (i.e. `from` already transitively depends on `target`).
 *
 * Used by `_setDeps` cycle prevention: adding edge `from → target` (which
 * happens when `from` becomes a dep of `target`) closes a cycle iff
 * `target` is already reachable upstream from `from`.
 *
 * O(V + E) over the visited subgraph. Bounded by the universe of nodes
 * reachable upstream from `from`, NOT the global node count.
 */
function _reachableUpstream(from: Node, target: Node): boolean {
	if (from === target) return true;
	const visited = new Set<Node>();
	const stack: Node[] = [from];
	while (stack.length > 0) {
		const n = stack.pop() as Node;
		if (visited.has(n)) continue;
		visited.add(n);
		const deps = (n as NodeImpl)._deps;
		if (deps == null) continue;
		for (const d of deps) {
			if (d.node === target) return true;
			if (!visited.has(d.node)) stack.push(d.node);
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// Normalization helper
// ---------------------------------------------------------------------------

/**
 * Accept either a single `Message` tuple or a `Messages` array and return
 * a `Messages` array. The discriminator is the type of the first element:
 * a `Message` has a symbol at index 0, while a `Messages` array has a
 * nested array at index 0. This lets `node.down(...)` and `actions.down(...)`
 * take either shape without a wrapper allocation on the common single-msg
 * path.
 */
function normalizeMessages(input: Message | Messages): Messages {
	if (input.length === 0) return input as Messages;
	return typeof (input as Message)[0] === "symbol" ? [input as Message] : (input as Messages);
}

// ---------------------------------------------------------------------------
// Default handlers
// ---------------------------------------------------------------------------

/**
 * Default {@link OnMessageHandler}. For `"down-in"` messages (from a dep),
 * routes to `NodeImpl._onDepMessage`. For `"up-in"` messages (from a sink),
 * the up-path is wired directly via `Node.up()` and never passes through
 * onMessage — this hook is reserved for future P5 symmetry.
 */
const defaultOnMessage: OnMessageHandler = (
	node: NodeCtx,
	msg: Message,
	ctx: MessageContext,
	_actions: NodeActions,
): "consume" | undefined => {
	if (ctx.direction === "down-in") {
		(node as NodeImpl)._onDepMessage(ctx.depIndex, msg);
	}
	// up-in is currently unused; default is to do nothing.
	return undefined;
};

/**
 * Default {@link OnSubscribeHandler}. Delivers the subscribe handshake —
 * `[[START]]` for a sentinel cache, or `[[START], [DATA, cached]]` when a
 * value exists. Terminal nodes skip entirely so absence of START tells the
 * sink the stream is over (spec §2.2). Delivered through `downWithBatch` so
 * `subscribe()` inside `batch()` still defers the paired DATA correctly.
 *
 * Lock 6.G (spec §2.5): when `replayBuffer: N` is set and the buffer has
 * entries, the buffer is delivered INSTEAD of the cache-DATA push (the
 * buffer's most-recent entry equals `_cached` at quiescence — appending
 * cache afterward would duplicate). When the buffer is empty (e.g. node
 * has `initial:` but never emitted, or post-resubscribable-reset), the
 * legacy cache-DATA push still fires. INVALIDATE clears `_cached` but
 * NOT `_replayBuffer` — a late subscriber arriving post-INVALIDATE
 * receives the prior emission history.
 */
const defaultOnSubscribe: OnSubscribeHandler = (
	node: NodeCtx,
	sink: NodeSink,
	_ctx: SubscribeContext,
	_actions: NodeActions,
): (() => void) | undefined => {
	const impl = node as NodeImpl;
	if (impl._status === "completed" || impl._status === "errored") return;
	const cached = impl._cached;
	const replayBuf = impl._replayBuffer;
	const initial: Message[] = [START_MSG];
	if (replayBuf != null && replayBuf.length > 0) {
		// Replay buffer authoritative — its last entry mirrors `_cached`
		// at quiescence, so we do NOT also push the cache-DATA frame.
		// Post-INVALIDATE the buffer persists while `_cached` is cleared;
		// a late subscriber still receives the prior history per spec
		// §2.5 ("last N outgoing DATA values").
		for (const v of replayBuf) initial.push([DATA, v] as Message);
	} else if (cached !== undefined) {
		// Buffer disabled or empty — legacy push-on-subscribe.
		initial.push([DATA, cached] as Message);
	}
	// When the node is mid-wave (`"dirty"`), append a DIRTY so the late
	// joiner participates in the in-flight wave. Without this, the next
	// DATA/RESOLVED the sink receives lacks the preceding DIRTY required
	// by spec §1.3.1 — the emit-side DIRTY auto-prefix is suppressed when
	// `_status` is already `"dirty"`.
	if (impl._status === "dirty") initial.push(DIRTY_MSG);
	downWithBatch(sink, initial, impl._config.tierOf);
};

// ---------------------------------------------------------------------------
// defaultConfig + configure
// ---------------------------------------------------------------------------

/**
 * Default {@link GraphReFlyConfig} instance. Every `NodeImpl` constructed
 * without an explicit `opts.config` binds to this instance and freezes it
 * on first hook access.
 */
export const defaultConfig = new GraphReFlyConfig({
	onMessage: defaultOnMessage,
	onSubscribe: defaultOnSubscribe,
});
registerBuiltins(defaultConfig);
registerBuiltinCodecs(defaultConfig);
// Lock 2.F′ (Phase 13.6.A): wire `batch.ts`'s drain-cap getter to
// `defaultConfig.maxBatchDrainIterations`. Batch deferral is process-global,
// so the cap is necessarily tied to `defaultConfig` regardless of any
// per-node `opts.config` isolation.
_setMaxBatchDrainIterationsGetter(() => defaultConfig.maxBatchDrainIterations);

/**
 * Apply configuration to {@link defaultConfig}. Must be called before the
 * first node is created — otherwise throws. Custom message types, hook
 * overrides, etc. go through here at app startup.
 *
 * ```ts
 * configure((cfg) => {
 *   cfg.registerMessageType(MY_TYPE, { tier: 3 });
 *   cfg.onMessage = (node, msg, ctx, actions) => { ... };
 * });
 * ```
 */
export function configure(fn: (cfg: GraphReFlyConfig) => void): void {
	if (defaultConfig._isFrozen()) {
		throw new Error(
			"configure() called after a node was created — the default " +
				"GraphReFlyConfig is frozen. Call configure(...) at application " +
				"startup, before any node factories run.",
		);
	}
	fn(defaultConfig);
}

// Re-export the class for advanced callers that want an isolated instance.
export { GraphReFlyConfig };

// ---------------------------------------------------------------------------
// NodeImpl
// ---------------------------------------------------------------------------

/**
 * Single-class node implementation. Covers state, producer, derived, effect,
 * and passthrough shapes. See `sugar.ts` for ergonomic factories and
 * `dynamicNode()` (sugar-level wrapper around plain `NodeImpl`).
 */
export class NodeImpl<T = unknown> implements Node<T> {
	// --- Identity ---
	readonly _optsName: string | undefined;
	readonly _describeKind: NodeDescribeKind | undefined;
	readonly meta: Record<string, Node>;
	/**
	 * Cached `Object.keys(meta).length > 0` check. `meta` is frozen at
	 * construction so this boolean never flips. Used by `_emit` to skip
	 * the meta TEARDOWN fan-out block allocation on the common "no meta"
	 * hot path.
	 */
	readonly _hasMeta: boolean;

	// --- Config ---
	readonly _config: GraphReFlyConfig;

	// --- Topology ---
	/** Mutable for autoTrackNode / Graph.connect() post-construction dep addition. */
	_deps: DepRecord[];
	_sinks: NodeSink | Set<NodeSink> | null = null;
	_sinkCount = 0;

	// --- State ---
	_cached: T | undefined;
	_status: NodeStatus;
	_cleanup: NodeFnCleanup | undefined;
	_store: Record<string, unknown> = {};
	_waveHasNewData = false;
	_hasNewTerminal = false;
	/**
	 * Set in `_depInvalidated` whenever a dep delivers INVALIDATE during a
	 * wave. Used by `_maybeRunFnOnSettlement` to suppress both the pre-fn
	 * skip RESOLVED emit AND the fn re-run when a wave consists only of
	 * dep INVALIDATE arrivals: the cascade in `_onDepMessage`'s INVALIDATE
	 * branch (`_emit(INVALIDATE_ONLY_BATCH)`) has already settled the wave,
	 * and re-firing here would either deliver a redundant RESOLVED that
	 * contradicts the just-cleared cache, or run fn with cleared
	 * `prevData[i]` (e.g. `undefined * 2 = NaN`). DS-13.5.A invariant.
	 *
	 * Cleared in `_clearWaveFlags` alongside `_waveHasNewData` /
	 * `_hasNewTerminal`.
	 */
	_waveHasInvalidate = false;
	_hasCalledFnOnce = false;
	_paused = false;
	_pendingWave = false;
	_isExecutingFn = false;
	_pendingRerun = false;
	_rerunDepth = 0;
	/**
	 * @internal Phase 13.8 reentrancy guard for `_setDeps` / `_addDep` /
	 * `_removeDep`. Set on entry, cleared in `finally`. A reentrant
	 * substrate call (typically synchronous re-entry from a push-on-
	 * subscribe DATA → downstream subscriber → re-call) is rejected with
	 * a clear error; the TLA+ spec assumes single-step atomicity, this
	 * flag enforces that contract at the substrate boundary.
	 *
	 * Distinct from `_isExecutingFn` (which guards mid-fn rewires) — this
	 * guards mid-rewire reentry.
	 */
	_inDepMutation = false;

	// --- Settlement counter (A3) ---
	/**
	 * Count of deps currently in `dirty === true`. `_maybeRunFnOnSettlement`
	 * treats `0` as "wave settled" — O(1) check for full dep settlement.
	 */
	_dirtyDepCount = 0;

	// --- DS-13.5.A Q16 idempotency guard ---
	/**
	 * Set to `true` the first time a TEARDOWN message is fully processed by
	 * `_updateState`. Used by `_frameBatch` to suppress the synthetic
	 * `[COMPLETE]` auto-prefix on subsequent TEARDOWN deliveries (which would
	 * otherwise re-deliver `[COMPLETE], [TEARDOWN]` pairs to sinks every time
	 * a redundant TEARDOWN arrives via `Graph.destroy` broadcast + dep cascade).
	 */
	private _teardownDone = false;

	// --- Per-batch emit accumulator (Bug 2: K+1 fan-in fix) ---
	/**
	 * Inside an explicit `batch(() => ...)` scope, every `_emit` accumulates
	 * its already-framed messages here instead of dispatching synchronously.
	 * At batch end, `_flushBatchPending` runs (registered via
	 * `registerBatchFlushHook`) and delivers the whole accumulated batch as
	 * one `downWithBatch` call — collapsing what would otherwise be K
	 * separate sink invocations into one. This is the fix for the diamond
	 * fan-in K+1 over-fire.
	 *
	 * `null` outside batch (or after flush). Only ever appended to within
	 * a single explicit batch lifetime; reset to `null` on flush. State
	 * updates (cache, version, status) still happen per-emit via
	 * `_updateState` — only the downstream delivery is coalesced.
	 */
	_batchPendingMessages: Message[] | null = null;

	// --- PAUSE/RESUME lock tracking (C0) ---
	/**
	 * Set of active pause locks held against this node. Every `[PAUSE, lockId]`
	 * adds its `lockId` to the set; every `[RESUME, lockId]` removes it.
	 * `_paused` is a derived quantity: `_pauseLocks.size > 0`. Multi-pauser
	 * correctness — one controller releasing its lock does NOT resume the
	 * node while another controller still holds its lock.
	 */
	_pauseLocks: Set<unknown> | null = null;
	/**
	 * Buffered settle slices (tier-3 DATA/RESOLVED + tier-4 INVALIDATE)
	 * held while paused. Only populated when `_pausable === "resumeAll"`
	 * (bufferAll mode). Each entry is one **wave** — the tier-3+4 subset
	 * of an entire `_emit` call's `finalMessages`, preserving wave shape
	 * (single-DATA, multi-DATA, or single-RESOLVED). On final lock release
	 * the buffer is replayed through `_emit` once per wave so the original
	 * Lock 1.D wave-content invariants (multi-DATA waves emit verbatim with
	 * no equals substitution; single-DATA waves equals-substitute against
	 * the cache shaped by all prior buffered waves) hold across the pause
	 * boundary. Non-bufferAll pause mode drops DATA on the floor (upstream
	 * is expected to honor PAUSE by suppressing production).
	 *
	 * Source: Lock 2.C + 2.C′ + 2.C′-pre (Phase 13.6.A locks).
	 */
	_pauseBuffer: Messages[] | null = null;
	/**
	 * Monotonic-ns timestamp of the first PAUSE that started the current
	 * pause cycle. Cleared on final RESUME. Used to populate
	 * `lockHeldDurationMs` in `pauseBufferMax` overflow ERRORs (Lock 6.A).
	 */
	_pauseStartNs: number | undefined;
	/**
	 * Cumulative count of waves dropped due to `pauseBufferMax` overflow
	 * during the current pause cycle. Cleared on final RESUME. Reported in
	 * the overflow ERROR diagnostic; useful for users tuning the cap.
	 */
	_pauseDroppedCount = 0;
	/**
	 * Whether an overflow ERROR has already been emitted for the current
	 * pause cycle. Gates the ERROR to once per pause cycle so a producer
	 * pushing thousands of waves over the cap doesn't spam errors. Cleared
	 * on final RESUME. Source: Lock 6.A.
	 */
	_pauseOverflowed = false;
	/**
	 * Whether `_updateState` has already logged an `equals`-throw under
	 * `equalsThrowPolicy: "log-and-continue"`. Gates the `console.error`
	 * to once per node lifetime so a buggy `equals` doesn't spam logs at
	 * production rates. Source: Lock 2.A (Phase 13.6.A).
	 */
	_equalsErrorLogged = false;

	// --- Lock 6.G: replayBuffer (spec §2.5) ---
	/**
	 * Circular buffer of last-N **outgoing** DATA values for late-subscriber
	 * catch-up. `null` when the option is unset or disabled (capacity 0).
	 * Allocated lazily on first push so nodes that never emit DATA pay no
	 * allocation cost. See `NodeOptions.replayBuffer` for full semantics.
	 *
	 * Cleared by `_deactivate` (TEARDOWN, last-unsub) and
	 * `_resetForFreshLifecycle` (terminal-resubscribable reset). NOT cleared
	 * by INVALIDATE on a non-terminal node — a late subscriber arriving
	 * post-INVALIDATE still receives the prior emission history.
	 */
	_replayBuffer: T[] | null = null;
	/**
	 * Cap for `_replayBuffer`. Frozen at construction from
	 * `opts.replayBuffer ?? 0`. `0` means the feature is disabled — push
	 * site short-circuits and `defaultOnSubscribe` falls back to the
	 * legacy cache-DATA handshake.
	 */
	readonly _replayBufferCapacity: number;

	// --- Options (frozen at construction) ---
	/**
	 * The user-supplied transform fn. Mutable post-construction ONLY via
	 * `_setDeps` / `_addDep` / `_removeDep` `opts.fn` (Phase 13.8). Callers
	 * MUST NOT assign directly — the substrate ensures the next `_execFn`
	 * reads the new value at the right wave boundary, fires old cleanup's
	 * `onRerun`, and updates `_cleanup` from the new fn's return.
	 *
	 * @internal Direct mutation outside `_setDeps`/`_addDep`/`_removeDep`
	 *   would skip the cleanup wrap-up and is a bug.
	 */
	_fn: NodeFn | undefined;
	readonly _equals: (a: T, b: T) => boolean;
	readonly _resubscribable: boolean;
	readonly _resetOnTeardown: boolean;
	readonly _autoComplete: boolean;
	readonly _autoError: boolean;
	readonly _pausable: boolean | "resumeAll";
	/**
	 * @internal First-run-gate override. `false` (default) holds fn until every
	 * dep has delivered DATA or a terminal — spec §2.7 first-run gate. `true`
	 * disables the gate; fn fires as soon as `_dirtyDepCount === 0`, regardless
	 * of dep sentinel state. Operators that need partial firing
	 * (`withLatestFrom`, `valve`, worker-bridge aggregators) pass
	 * `partial: true` explicitly at construction.
	 */
	readonly _partial: boolean;
	readonly _guard: NodeGuard | undefined;
	/**
	 * @internal Additional guards stacked at runtime via {@link NodeImpl._pushGuard}
	 * (e.g. by `policyGate({ mode: "enforce" })`, roadmap §9.2). Effective
	 * write/signal/observe checks AND the original `_guard` with every entry here.
	 */
	_extraGuards: Set<NodeGuard> | undefined;
	_hashFn: HashFn;
	_versioning: NodeVersionInfo | undefined;
	/**
	 * Explicit versioning level, tracked separately from `_versioning` so
	 * monotonicity checks and future v2/v3 extensions don't rely on the
	 * fragile `"cid" in _versioning` shape discriminator. `undefined` means
	 * the node has no versioning attached; `0` / `1` / future levels name
	 * the tier. Mutated in lockstep with `_versioning` by the constructor
	 * and by `_applyVersioning`.
	 */
	_versioningLevel: VersioningLevel | undefined;

	// --- ABAC ---
	_lastMutation: { actor: Actor; timestamp_ns: number } | undefined;

	/**
	 * @internal Per-node inspector hooks for `Graph.observe(path,
	 * { causal, derived })`. Fires in `_onDepMessage` and `_execFn`.
	 * Attached via `_setInspectorHook` (returns a disposer). Multiple
	 * observers can attach simultaneously — all registered hooks fire for
	 * every event.
	 */
	_inspectorHooks: Set<NodeInspectorHook> | undefined;

	// --- Actions (built once in the constructor) ---
	readonly _actions: NodeActions;

	constructor(deps: readonly Node[], fn: NodeFn | undefined, opts: NodeOptions<T>) {
		// Bind to config FIRST so meta nodes inherit it. Touching a hook
		// getter below freezes the config on first node creation.
		this._config = opts.config ?? defaultConfig;
		void this._config.onMessage;

		this._optsName = opts.name;
		this._describeKind = opts.describeKind;
		this._equals = (opts.equals ?? (Object.is as (a: T, b: T) => boolean)) as (
			a: T,
			b: T,
		) => boolean;
		this._resubscribable = opts.resubscribable ?? false;
		this._resetOnTeardown = opts.resetOnTeardown ?? false;
		this._autoComplete = opts.completeWhenDepsComplete ?? true;
		this._autoError = opts.errorWhenDepsError ?? true;
		this._pausable = opts.pausable ?? true;
		// Lock 6.G (spec §2.5): clamp to a non-negative integer. Negative /
		// fractional / NaN / Infinity all collapse to `0` (disabled). The
		// push site short-circuits on capacity 0, so the field doubles as
		// the on/off switch.
		const replayCapRaw = opts.replayBuffer;
		this._replayBufferCapacity =
			typeof replayCapRaw === "number" && Number.isFinite(replayCapRaw) && replayCapRaw > 0
				? Math.floor(replayCapRaw)
				: 0;
		this._guard = opts.guard;
		this._fn = fn;
		// Spec §2.7 first-run gate. Default `false` = gate ON — matches the
		// universal "fn does not fire until every declared dep has delivered"
		// contract. Operators that deliberately fire on partial deps
		// (`withLatestFrom`, `valve`, worker-bridge aggregators) opt out with
		// `partial: true`. Zero-dep producer-pattern factories (`stratify`,
		// `budgetGate`, `distill`, `verifiable`) are unaffected — the gate has
		// no deps to hold on an empty `_deps` array.
		this._partial = opts.partial ?? false;

		// `undefined` is the sentinel ("no cached value") so `initial: undefined`
		// is treated as absent. `null` is a valid DATA value and sets the cache.
		this._cached = opts.initial !== undefined ? (opts.initial as T) : undefined;
		// State-with-initial starts "settled"; everything else starts "sentinel".
		this._status =
			deps.length === 0 && fn == null && this._cached !== undefined ? "settled" : "sentinel";

		// Versioning
		// Hash resolution: per-node `opts.versioningHash` wins; then the
		// bound config's `defaultHashFn`; then the vendored sync SHA-256.
		// Hot-path workloads that want a faster hash (xxHash, FNV-1a) can
		// set it once at app init via `configure(cfg => { cfg.defaultHashFn = ... })`.
		this._hashFn = opts.versioningHash ?? this._config.defaultHashFn ?? defaultHash;
		// Versioning level resolution: per-node `opts.versioning` wins; if
		// absent, fall back to the bound config's `defaultVersioning`. `null`
		// stays unversioned. Explicit levels (0, 1, …) attach the versioning
		// info at construction so the next DATA emit advances it.
		const versioningLevel: VersioningLevel | undefined =
			opts.versioning ?? this._config.defaultVersioning;
		this._versioningLevel = versioningLevel;
		this._versioning =
			versioningLevel != null
				? createVersioning(versioningLevel, this._cached === undefined ? undefined : this._cached, {
						id: opts.versioningId,
						hash: this._hashFn,
					})
				: undefined;

		// Per-dep records: one DepRecord per declared dep.
		this._deps = deps.map(createDepRecord);

		// Meta companions (simple state children; inherit config + guard +
		// `resubscribable` from parent). EC7 (Tier 4.2, 2026-04-29): meta
		// companions inherit `resubscribable` so a resubscribable producer's
		// meta children also accept post-terminal-reset re-emissions.
		// Without this, a `resubscribable: true` parent's `withStatus.status`
		// / `withBreaker.breakerState` / `rateLimiter.droppedCount` companion
		// stays terminated after the parent's first terminal — defeating the
		// "next subscription cycle resets" semantic the parent advertises.
		const meta: Record<string, Node> = {};
		for (const [k, v] of Object.entries(opts.meta ?? {})) {
			const metaOpts: NodeOptions<unknown> = {
				initial: v,
				name: `${opts.name ?? "node"}:meta:${k}`,
				describeKind: "state",
				config: this._config,
			};
			if (opts.guard != null) metaOpts.guard = opts.guard;
			if (opts.resubscribable === true) metaOpts.resubscribable = true;
			meta[k] = new NodeImpl<unknown>([], undefined, metaOpts);
		}
		Object.freeze(meta);
		this.meta = meta;
		this._hasMeta = Object.keys(meta).length > 0;

		// Actions: built once, closure over `this`. Every call goes through
		// `_emit` which owns the full dispatch invariant — tier sort,
		// synthetic DIRTY prefix, equals substitution, and phase dispatch.
		// One call = one wave. Multiple calls produce multiple waves.
		// No accumulation, no user-facing bundle builder.
		const self = this;
		this._actions = {
			emit(value: unknown): void {
				self._emit([[DATA, value] as Message]);
			},
			down(messageOrMessages: Message | Messages): void {
				self._emit(normalizeMessages(messageOrMessages));
			},
			up(messageOrMessages: Message | Messages): void {
				self._emitUp(normalizeMessages(messageOrMessages));
			},
		};

		// Bind commonly detached protocol methods.
		this.down = this.down.bind(this);
		this.up = this.up.bind(this);
	}

	// --- Derived state ---

	private get _isTerminal(): boolean {
		return this._status === "completed" || this._status === "errored";
	}

	// --- Public getters ---

	get name(): string | undefined {
		return this._optsName;
	}

	get status(): NodeStatus {
		return this._status;
	}

	get cache(): T | undefined | null {
		return this._cached === undefined ? undefined : (this._cached as T);
	}

	get lastMutation(): Readonly<{ actor: Actor; timestamp_ns: number }> | undefined {
		return this._lastMutation;
	}

	get v(): Readonly<NodeVersionInfo> | undefined {
		return this._versioning;
	}

	hasGuard(): boolean {
		return this._guard != null;
	}

	/**
	 * @internal Retroactively attach (or upgrade) versioning state on this
	 * node. Intended for `Graph.setVersioning(level)` bulk application and
	 * for rare cases where a specific node needs to be bumped to a higher
	 * level (e.g., `v0 → v1`) after construction.
	 *
	 * **Safety:** the mutation is rejected mid-wave. Specifically,
	 * throws if the node is currently executing its fn (`_isExecutingFn`).
	 * Callers at quiescent points — before the first sink subscribes, or
	 * after all sinks unsubscribe, or between external `down()` / `emit()`
	 * invocations — are safe. The re-entrance window that motivated §10.6.4
	 * removal was the "transition `_versioning` from `undefined` to a fresh
	 * object mid-`_updateState`" case; that path is now guarded.
	 *
	 * **Monotonicity:** levels can only go up. Downgrade (e.g., `v1 → v0`)
	 * is a no-op — once a node carries higher-level metadata, dropping it
	 * mid-graph would tear the linked-history invariant for v1 and above.
	 *
	 * **Linked-history boundary (D1, 2026-04-13):** upgrading v0 → v1
	 * produces a **fresh history root**. The new v1 state has `cid =
	 * hash(currentCachedValue)` and `prev = null`, not a synthetic `prev`
	 * anchored to any previous v0 value. The v0 monotonic `version` counter
	 * is preserved across the upgrade, but the linked-cid chain (spec §7)
	 * starts fresh at the upgrade point. Downstream audit tools that walk
	 * `v.cid.prev` backwards through time will see a `null` boundary at
	 * the upgrade — **this is intentional**: v0 had no cid to link to, and
	 * fabricating one would lie about the hash. Callers that require an
	 * unbroken cid chain from birth must attach versioning at construction
	 * via `opts.versioning` or `config.defaultVersioning`, not retroactively.
	 *
	 * @param level - New minimum versioning level.
	 * @param opts - Optional id / hash overrides; applied only if the
	 *   node currently has no versioning state.
	 */
	_applyVersioning(level: VersioningLevel, opts?: { id?: string; hash?: HashFn }): void {
		if (this._isExecutingFn) {
			throw new Error(
				`Node "${this.name}": _applyVersioning cannot run mid-fn — ` +
					"call it outside of `_execFn` (typically at graph setup time " +
					"before the first subscribe).",
			);
		}
		const currentLevel = this._versioningLevel;
		if (currentLevel != null && level <= currentLevel) {
			// Downgrade or no-op. Monotonic: higher levels only.
			return;
		}
		const hash = opts?.hash ?? this._hashFn;
		if (hash !== this._hashFn) this._hashFn = hash;
		const initialValue = this._cached === undefined ? undefined : this._cached;
		// Preserve the existing id + version counter across upgrades so
		// downstream consumers watching `v.id` don't see an identity jump.
		const current = this._versioning;
		const preservedId = current?.id ?? opts?.id;
		const preservedVersion = current?.version ?? 0;
		const fresh = createVersioning(level, initialValue, {
			id: preservedId,
			hash,
		});
		fresh.version = preservedVersion;
		this._versioning = fresh;
		this._versioningLevel = level;
	}

	/**
	 * @internal Attach an inspector hook. Returns a disposer that removes
	 * the hook. Used by `Graph.observe(path, { causal, derived })` to build
	 * causal traces. Multiple hooks may be attached concurrently — all fire
	 * for every event in registration order. Passing `undefined` is a no-op
	 * and returns a no-op disposer.
	 */
	_setInspectorHook(hook?: NodeInspectorHook): () => void {
		if (hook == null) return () => {};
		if (this._inspectorHooks == null) this._inspectorHooks = new Set();
		this._inspectorHooks.add(hook);
		return () => {
			this._inspectorHooks?.delete(hook);
			if (this._inspectorHooks?.size === 0) this._inspectorHooks = undefined;
		};
	}

	/**
	 * @internal Push an additional guard onto this node. Effective enforcement
	 * is the AND of `_guard` and every guard pushed via this hook — any one
	 * rejecting throws {@link GuardDenied}. Returns a disposer that removes
	 * the pushed guard. Multiple guards may be stacked simultaneously.
	 *
	 * Used by `policyGate({ mode: "enforce" })` (roadmap §9.2) to overlay
	 * runtime constraint enforcement onto an existing graph without rebuilding
	 * its nodes. Pre-1.0 internal API; not part of the public surface.
	 *
	 * **Identity semantics:** guards are tracked in a `Set`, so pushing the
	 * same `NodeGuard` reference twice is a single registration. Wrap each
	 * push in a unique closure if independent stacking is needed.
	 *
	 * **Iteration order:** insertion-ordered (`Set` semantics). Determinism
	 * follows from single-threaded JS execution; nested re-entry from inside
	 * a guard body (push/pop while iterating) is undefined-but-survivable.
	 */
	_pushGuard(guard: NodeGuard): () => void {
		if (this._extraGuards == null) this._extraGuards = new Set();
		this._extraGuards.add(guard);
		return () => {
			this._extraGuards?.delete(guard);
			if (this._extraGuards?.size === 0) this._extraGuards = undefined;
		};
	}

	allowsObserve(actor: Actor): boolean {
		if (this._guard == null && this._extraGuards == null) return true;
		const a = normalizeActor(actor);
		if (this._guard != null && !this._guard(a, "observe")) return false;
		if (this._extraGuards != null) {
			for (const eg of this._extraGuards) {
				if (!eg(a, "observe")) return false;
			}
		}
		return true;
	}

	// --- Guard helper ---

	private _checkGuard(options?: NodeTransportOptions): void {
		if (options?.internal) return;
		const hasGuard = this._guard != null || this._extraGuards != null;
		const hasActor = options?.actor != null;
		// Skip work entirely when there's nothing to check or attribute.
		if (!hasGuard && !hasActor) return;
		const actor = normalizeActor(options?.actor);
		const action: GuardAction = options?.delivery === "signal" ? "signal" : "write";
		if (this._guard != null && !this._guard(actor, action)) {
			throw new GuardDenied({ actor, action, nodeName: this.name });
		}
		if (this._extraGuards != null) {
			for (const eg of this._extraGuards) {
				if (!eg(actor, action)) {
					throw new GuardDenied({ actor, action, nodeName: this.name });
				}
			}
		}
		// Populate `_lastMutation` whenever guards ran OR an explicit actor was
		// passed — `auditTrail` (roadmap §9.2) relies on this for attribution
		// on graphs without ABAC. Internal writes (no actor, no guard) skip
		// attribution to avoid recording derived recompute storms.
		this._lastMutation = { actor, timestamp_ns: wallClockNs() };
	}

	// --- Public transport ---

	down(messageOrMessages: Message | Messages, options?: NodeTransportOptions): void {
		const messages = normalizeMessages(messageOrMessages);
		if (messages.length === 0) return;
		this._checkGuard(options);
		this._emit(messages);
	}

	emit(value: T | undefined | null, options?: NodeTransportOptions): void {
		this._checkGuard(options);
		this._emit([[DATA, value] as Message]);
	}

	/**
	 * Upstream forward (spec §1.4). Carries control-plane tiers only —
	 * DIRTY (tier 1), PAUSE / RESUME (tier 2), INVALIDATE (tier 4),
	 * TEARDOWN (tier 6) — and rejects tier-3 (DATA / RESOLVED) and tier-5
	 * (COMPLETE / ERROR) per `_validateUpTiers` — downstream-only by
	 * protocol.
	 *
	 * **Upstream-origin PAUSE applies at the PARENT's lockset via the parent's
	 * own `up()`, not at this source's `_pauseLocks` when `_deps.length === 0`.**
	 * At a leaf source, `up()` is a no-op: a subscription that calls
	 * `sink.up([[PAUSE, lockId]])` expecting the source itself to pause is
	 * NOT honored today. TLA+ `DeliverUp` encodes the target contract (source
	 * applies its own lock); the runtime falls short. No in-tree caller relies
	 * on upstream-origin PAUSE at a leaf, so this is documented as intentional
	 * for now (option (c) in docs/optimizations.md "Up-direction PAUSE
	 * semantics"). A future option (a) would tighten the runtime here; any
	 * new consumer needing leaf-source upstream PAUSE is the trigger.
	 *
	 * **LockId uniqueness is the caller's responsibility.** Locks are stored
	 * in a `Set<unknown>`; `Pause(n, 10)` and an upstream `UpPause(child, 10)`
	 * that reaches `n` insert the SAME element — one `Resume(n, 10)` clears
	 * both origins. Distinct pauser identities must use distinct lockIds.
	 * Surfaced by the rigor-infra TLC audit (docs/optimizations.md "LockId
	 * collision across up() and down() origin").
	 */
	up(messageOrMessages: Message | Messages, options?: NodeTransportOptions): void {
		if (this._deps.length === 0) return;
		const messages = normalizeMessages(messageOrMessages);
		if (messages.length === 0) return;
		this._checkGuard(options);
		const forwardOpts: NodeTransportOptions = options ?? { internal: true };
		// Validate tier constraint before fanning out (B1.4 option a).
		this._validateUpTiers(messages);
		for (const d of this._deps) {
			d.node.up?.(messages, forwardOpts);
		}
	}

	/**
	 * @internal Internal up-path used by `actions.up(...)` from inside fn.
	 * Same tier validation as public `up`, but bypasses the guard check
	 * since the fn context is already inside an authorized operation.
	 */
	private _emitUp(messages: Messages): void {
		if (this._deps.length === 0) return;
		if (messages.length === 0) return;
		this._validateUpTiers(messages);
		for (const d of this._deps) {
			d.node.up?.(messages, { internal: true });
		}
	}

	/**
	 * @internal Enforce spec §1.2 — up-direction messages are restricted to
	 * the control-plane tiers (START, DIRTY, PAUSE, RESUME, INVALIDATE,
	 * TEARDOWN). Tier 3 (DATA/RESOLVED) and tier 5 (COMPLETE/ERROR) are
	 * downstream-only. Emitting them via `up` would bypass equals
	 * substitution and cache advance entirely and is a protocol bug.
	 *
	 * Post-DS-13.5.A: INVALIDATE is tier 4 and IS allowed upstream — it is
	 * a settle-class control signal whose role for `_dirtyDepCount` mirrors
	 * RESOLVED. Only tier 3 (value settle) and tier 5 (terminal lifecycle)
	 * are rejected.
	 */
	private _validateUpTiers(messages: Messages): void {
		const tierOf = this._config.tierOf;
		for (const m of messages) {
			const tier = tierOf(m[0]);
			if (tier === 3 || tier === 5) {
				throw new Error(
					`Node "${this.name}": tier-${tier} messages cannot flow up — ` +
						"DATA/RESOLVED/COMPLETE/ERROR are downstream-only. Use " +
						"`down(...)` for value delivery; `up(...)` is for control " +
						"signals (DIRTY, INVALIDATE, PAUSE, RESUME, TEARDOWN).",
				);
			}
		}
	}

	subscribe(sink: NodeSink, actor?: Actor): () => void {
		if (actor != null && this._guard != null) {
			const a = normalizeActor(actor);
			if (!this._guard(a, "observe")) {
				throw new GuardDenied({ actor: a, action: "observe", nodeName: this.name });
			}
		}

		// Resubscribable terminal reset.
		const wasTerminal = this._isTerminal;
		const afterTerminalReset = wasTerminal && this._resubscribable;
		if (afterTerminalReset) {
			this._resetForFreshLifecycle();
		}

		this._sinkCount += 1;

		// Subscribe ceremony via singleton.
		// Rollback on throw: undo the sinkCount bump — sink is not yet registered,
		// no _activate() has run, nothing else to clean up.
		let subCleanup: (() => void) | undefined;
		try {
			subCleanup = this._config.onSubscribe(
				this as unknown as NodeCtx,
				sink,
				{ sinkCount: this._sinkCount, afterTerminalReset },
				this._actions,
			);
		} catch (err) {
			this._sinkCount -= 1;
			throw err;
		}

		// Register sink AFTER START delivery (spec §2.2).
		if (this._sinks == null) {
			this._sinks = sink;
		} else if (typeof this._sinks === "function") {
			this._sinks = new Set<NodeSink>([this._sinks, sink]);
		} else {
			this._sinks.add(sink);
		}

		// First-subscriber activation.
		// Rollback on throw: undo sink registration, sinkCount bump, and subCleanup.
		// _activate() rolls back its own partial dep subscriptions before re-throwing.
		const isTerminalNow = this._isTerminal;
		if (this._sinkCount === 1 && !isTerminalNow) {
			// DS-13.5.A Q16 defensive reset: clear `_teardownDone` whenever a
			// node comes alive on first-subscriber activation. `_deactivate`
			// already clears it on last-sink-detach, but a non-resubscribable
			// node that was re-added to a different graph (or any path that
			// reaches `_sinkCount === 0` without `_deactivate` running) would
			// otherwise carry a stale `_teardownDone=true` into the new
			// lifecycle, permanently wedging fn re-runs at the
			// `_maybeRunFnOnSettlement` early-return guard.
			this._teardownDone = false;
			try {
				this._activate();
			} catch (err) {
				this._sinkCount -= 1;
				this._removeSink(sink);
				// Restore status: onSubscribe emitted START which set _status to
				// "pending". With zero sinks the node is back to its pre-subscribe
				// state; reset so node.status reflects no active subscription.
				if (this._sinkCount === 0) this._status = "sentinel";
				if (typeof subCleanup === "function") {
					try {
						subCleanup();
					} catch {
						/* best-effort: subCleanup errors are secondary */
					}
				}
				throw err;
			}
		}

		// Reflect "activated but no value yet" as pending.
		if (this._status === "sentinel" && this._cached === undefined) {
			this._status = "pending";
		}

		let removed = false;
		return (): void => {
			if (removed) return;
			removed = true;
			this._sinkCount -= 1;
			this._removeSink(sink);
			if (typeof subCleanup === "function") subCleanup();
			if (this._sinks == null) this._deactivate();
		};
	}

	private _removeSink(sink: NodeSink): void {
		if (this._sinks === sink) {
			this._sinks = null;
		} else if (this._sinks != null && typeof this._sinks !== "function") {
			this._sinks.delete(sink);
			if (this._sinks.size === 1) {
				const [only] = this._sinks;
				this._sinks = only;
			} else if (this._sinks.size === 0) {
				this._sinks = null;
			}
		}
	}

	/**
	 * @internal Clear all per-lifecycle state so a subsequent activation (or
	 * existing subscriber's next wave) sees a fresh node — same shape as the
	 * `subscribe()` `afterTerminalReset` path, but does NOT disconnect deps.
	 *
	 * Two callers:
	 * 1. `subscribe()` when `wasTerminal && _resubscribable` — first new
	 *    subscriber after a terminal-resubscribable reaches a clean state.
	 * 2. `_updateState`'s INVALIDATE branch when `_isTerminal && _resubscribable`
	 *    — INVALIDATE on a terminal-resubscribable is a lifecycle boundary
	 *    (DS-13.5.A pass-3, N1 fix). Without this, a multi-subscriber
	 *    resubscribable node that goes terminal, then has one sink unsub
	 *    (skipping `_deactivate`), then receives INVALIDATE, would carry
	 *    stale `_hasCalledFnOnce` / `_dirtyDepCount` / DepRecord state into
	 *    the next wave — fn would compute against ghost `prevData`.
	 *
	 * The reset does NOT touch `_sinks`, `_deps[i].unsub`, or `_cleanup` —
	 * those are owned by `_activate`/`_deactivate`. Existing subscribers
	 * stay attached; existing dep subscriptions stay live; pending cleanup
	 * (e.g. an `invalidate?` hook on object-form cleanup) fires through the
	 * caller's normal path after this returns.
	 *
	 * Phase 13.6.B QA D1 — fires `onResubscribableReset` (named-hook only)
	 * on the active cleanup BEFORE clearing internal state. This is the
	 * lifecycle hook for one-shot store-flag operators (`frozenContext`,
	 * `take`, `last` etc.) that need to clear their flag whenever the
	 * node enters a fresh lifecycle, even when `_deactivate` did not run
	 * (multi-sub-stayed case). The hook fires AT MOST once per reset —
	 * it's nulled out after firing so a follow-up `_deactivate` on the
	 * same lifecycle instance doesn't re-fire it.
	 */
	private _resetForFreshLifecycle(): void {
		// QA D1: fire `onResubscribableReset` BEFORE clearing internal
		// state so the user hook sees a coherent pre-reset world (e.g.,
		// `_cached` still populated for any "I am being torn down with
		// value V" introspection). Function-shorthand cleanup form is
		// NOT fired here — that shape conflates rerun / deactivation /
		// invalidate and would overfire on a lifecycle reset boundary.
		// Only the named-hook `onResubscribableReset` slot fires.
		const c = this._cleanup;
		if (c != null && typeof c !== "function") {
			const hook = c.onResubscribableReset;
			if (typeof hook === "function") {
				c.onResubscribableReset = undefined;
				try {
					hook();
				} catch {
					/* best-effort — instrumentation must not break the data plane */
				}
			}
		}
		this._cached = undefined;
		this._status = "sentinel";
		// Lock 6.D (Phase 13.6.B): `ctx.store` PRESERVES across lifecycle
		// boundaries by default. Operators that depend on per-lifecycle
		// reset (`take(n)` restart-from-zero, `scan` restart-from-seed,
		// per-stream parser buffers) clear via `onDeactivation` (last-
		// sink-detach / TEARDOWN) AND/OR `onResubscribableReset`
		// (multi-sub-stayed terminal-resubscribable boundary, fired
		// from this method above). See G.20 in COMPOSITION-GUIDE-GRAPH.
		this._hasCalledFnOnce = false;
		this._waveHasNewData = false;
		this._hasNewTerminal = false;
		this._waveHasInvalidate = false;
		this._teardownDone = false;
		this._paused = false;
		this._pendingWave = false;
		this._pendingRerun = false;
		this._isExecutingFn = false;
		this._rerunDepth = 0;
		this._dirtyDepCount = 0;
		// C0: clear pause state so a new subscriber after terminal-reset
		// starts from a clean pause lockset — otherwise a lockId from
		// the previous lifecycle would leave the node stuck paused and
		// swallow every emit.
		this._pauseLocks = null;
		this._pauseBuffer = null;
		// Lock 6.A: clear pause-cycle bookkeeping so a resubscribable node
		// coming back from terminal-overflow doesn't carry stale
		// `_pauseOverflowed = true` (which would swallow the next cycle's
		// overflow ERROR) or stale `_pauseStartNs` (which would yield a
		// nonsense `lockHeldDurationMs`).
		this._pauseStartNs = undefined;
		this._pauseDroppedCount = 0;
		this._pauseOverflowed = false;
		// Lock 6.G (spec §2.5): terminal-resubscribable lifecycle reset
		// drops replay history. The next subscription cycle starts fresh —
		// matches the TLA+ model's `replaySnapshot' = <<>>` clear in
		// `Resubscribe` (formal model batch 6 G).
		this._replayBuffer = null;
		for (const d of this._deps) resetDepRecord(d);
		// Defensive invariant: the first-run gate (§2.7) assumes
		// `_hasCalledFnOnce === false` above AND every DepRecord in
		// sentinel shape below were reset together. A future refactor
		// that reorders these two resets (or skips `resetDepRecord` for
		// any dep) would let the gate see a dep as "settled" from the
		// prior lifecycle and release on first partial settlement with
		// stale data. This assert catches the coupling in tests before
		// users hit it in production.
		if (this._partial === false) {
			for (const d of this._deps) {
				if (
					d.prevData !== undefined ||
					d.dataBatch.length !== 0 ||
					d.terminal !== undefined ||
					d.dirty
				) {
					throw new Error(
						`resubscribable-reset invariant: DepRecord not fully reset for node ${
							this._optsName ?? "(anonymous)"
						}`,
					);
				}
			}
		}
	}

	// --- Lifecycle ---

	/**
	 * @internal First-sink activation. For a producer (no deps + fn),
	 * invokes fn once. For a compute node (has deps), subscribes to every
	 * dep with the pre-set-dirty trick so the first-run gate waits for
	 * every dep to settle at least once.
	 */
	_activate(): void {
		if (this._deps.length === 0) {
			if (this._fn) this._execFn();
			return;
		}
		// Pre-set every dep as sentinel BEFORE subscribing. If the first dep
		// delivers DATA synchronously during its subscribe callback, the
		// sentinel gate holds fn until all deps have contributed at least one
		// value. _dirtyDepCount starts at 0 — actual DIRTY messages from deps
		// drive it; pre-dirtying all deps would cause any dep that only delivers
		// [[START]] (no DATA) to appear permanently "mid-wave", which blocks
		// terminal propagation from other deps incorrectly.
		this._dirtyDepCount = 0;
		// Capture the initial length BEFORE subscribing. `_addDep` can fire
		// synchronously during a dep's subscribe callback (e.g., via
		// `autoTrackNode` discovery in `_execFn`) and push new DepRecords.
		// Iterating `this._deps.length` live would mean this loop also
		// subscribes the new dep that `_addDep` already subscribed — a
		// double-subscribe bug. Snapshot the length instead; `_addDep`
		// owns the subscribe + counter bump for any dep it adds.
		const initialLen = this._deps.length;
		// subscribedCount tracks how many deps were successfully subscribed.
		// On failure, only those deps need to be rolled back.
		let subscribedCount = 0;
		try {
			for (let i = 0; i < initialLen; i++) {
				const dep = this._deps[i];
				// Phase 13.8 QA G2-H: re-check Q1 terminal-non-resubscribable
				// at activation time. `_setDeps` and `_addDepInternal` validate
				// upfront, but on an inactive node the actual `subscribe()` is
				// deferred to here — the dep may have transitioned to non-
				// resubscribable terminal in the interim. `defaultOnSubscribe`
				// would silently no-op, leaving the edge wedged. Re-check now.
				const depImpl = dep.node as NodeImpl;
				if (
					(depImpl._status === "completed" || depImpl._status === "errored") &&
					!depImpl._resubscribable
				) {
					throw new Error(
						`_activate: dep "${depImpl.name}" entered non-resubscribable terminal state (${depImpl._status}) between dep declaration and first activation; the subscribe handshake would silently no-op and wedge node "${this.name}". Use a resubscribable dep, a fresh node, or remove the edge before activation.`,
					);
				}
				// Pre-set to noopUnsub so the liveness check inside the callback
				// passes during synchronous push-on-subscribe (dep.unsub is non-null),
				// while still blocking stale drainPhase2 closures that fire after
				// _deactivate sets dep.unsub = null.
				dep.unsub = noopUnsub;
				dep.unsub = dep.node.subscribe((msgs) => {
					// Liveness check: dep.unsub === null means this subscription was
					// cancelled by _deactivate. Drop deliveries from stale drainPhase2
					// closures that outlived the subscription.
					if (dep.unsub === null) return;
					// Phase 13.8: dispatch via current index of this DepRecord in
					// `_deps`, not a closure-captured index. Surgical `_setDeps`
					// may shift kept deps' positions; binding via record reference
					// keeps stale closures impossible. `indexOf` is O(N) but N is
					// typically small; promote to a Map cache if profiling demands.
					const depIdx = this._deps.indexOf(dep);
					if (depIdx === -1) return; // record evicted by `_setDeps`
					// Track whether any tier-3+ settlement-class message arrived
					// (DATA/RESOLVED at tier 3, INVALIDATE at tier 4,
					// COMPLETE/ERROR at tier 5). Fire
					// `_maybeRunFnOnSettlement` once at the end of the iteration
					// loop when at least one settlement was seen — one invocation
					// per dep batch, not per message, so `fn` sees the full wave
					// (Bug 1 fix, 2026-04-17). Guarded by `config.tierOf(m[0])
					// >= 3` per spec §5.11 — never hardcode message-type checks.
					const tierOf = this._config.tierOf;
					let sawSettlement = false;
					for (const m of msgs) {
						if (tierOf(m[0]) >= 3) sawSettlement = true;
						this._config.onMessage(
							this as unknown as NodeCtx,
							m,
							{ direction: "down-in", depIndex: depIdx },
							this._actions,
						);
					}
					if (sawSettlement) this._maybeRunFnOnSettlement();
				});
				subscribedCount++;
			}
		} catch (err) {
			// Dep at index `subscribedCount` failed — its dep.unsub is still noopUnsub.
			// Mark it null so the liveness check treats any queued closures as stale.
			this._deps[subscribedCount].unsub = null;
			// Unsubscribe all deps that DID subscribe successfully (0..subscribedCount-1).
			for (let j = 0; j < subscribedCount; j++) {
				const d = this._deps[j];
				if (d.unsub != null) {
					const u = d.unsub;
					d.unsub = null;
					try {
						u();
					} catch {
						/* best-effort: dep unsub errors are secondary */
					}
					resetDepRecord(d);
				}
			}
			this._dirtyDepCount = 0;
			throw err;
		}
	}

	/**
	 * @internal **Substrate-level dep append** (no validation guards).
	 * Used by `autoTrackNode` (runtime dep discovery) and `Graph.connect()`
	 * (post-construction wiring) — both of which need cycle/self-dep/mid-fn
	 * checks intentionally bypassed (autoTrackNode runs from inside
	 * `_execFn`, where the public `_addDep` would reject).
	 *
	 * **External callers** (Phase 13.8 `Graph._addDep`, harness/AI rewrite
	 * code) should use {@link _addDep} which layers validation on top of
	 * this primitive.
	 *
	 * **Dedup:** idempotent on duplicate `depNode`.
	 *
	 * **Q1 terminal-non-resubscribable rejection** stays here (correctness
	 * fix for a pre-existing wedge bug, applies regardless of caller).
	 *
	 * **Subscribe ordering (Phase 13.8 QA D):** the synthetic `[DIRTY]`
	 * downstream emit happens AFTER the dep subscribe succeeds, so a
	 * subscribe-throw never leaves an orphan DIRTY downstream (spec
	 * §5.11 R1.3.1.a — DIRTY without a follow-up DATA/RESOLVED is invalid).
	 */
	_addDepInternal(depNode: Node, opts?: { fn?: NodeFn }): number {
		// Dedup: idempotent on repeated adds of the same dep. Matches
		// reference equality — the DepRecord is keyed by `node` identity,
		// so a caller with a fresh `depNode` that observes as equal but
		// is a distinct object is treated as a new dep.
		for (let i = 0; i < this._deps.length; i++) {
			if (this._deps[i].node === depNode) {
				// Idempotent on dep, but still apply fn swap if requested.
				if (opts?.fn !== undefined) this._fn = opts.fn;
				return i;
			}
		}
		// Phase 13.8 Q1: reject non-resubscribable terminal deps.
		// `defaultOnSubscribe` silently no-ops on terminal non-resubscribable
		// nodes — adding one would wedge N (no DATA, no terminal, no
		// auto-cascade). Resubscribable terminals are accepted because
		// `subscribe()` triggers `_resetForFreshLifecycle` on them.
		const depImpl = depNode as NodeImpl;
		if (
			(depImpl._status === "completed" || depImpl._status === "errored") &&
			!depImpl._resubscribable
		) {
			throw new Error(
				`_addDep: cannot add non-resubscribable terminal dep "${depImpl.name}" (status=${depImpl._status}). The subscribe handshake is silent for terminal non-resubscribable nodes, which would leave the new edge wedged.`,
			);
		}
		const depIdx = this._deps.length;
		const record = createDepRecord(depNode);
		this._deps.push(record);

		// Phase 13.8: optional fn replacement. Land before any subscribe so
		// the next `_execFn` (possibly triggered by push-on-subscribe below)
		// uses the new fn.
		if (opts?.fn !== undefined) this._fn = opts.fn;

		// If the node is inactive (no subscribers yet), defer subscribe to
		// _activate(). Subscribing here would create a duplicate subscription
		// because _activate() unconditionally subscribes to all _deps entries.
		// _activate() resets _dirtyDepCount to 0 before subscribing, so pre-
		// dirtying is wasted work and causes counter underflow on the first DATA.
		if (this._sinks == null) return depIdx;

		record.dirty = true;
		// New dep starts dirty — bump the A3 counter to match the pre-set flag.
		// Skipping the helper here because the record isn't in the array yet when
		// the helper would early-return on `dep.dirty === true`.
		this._dirtyDepCount++;
		// Topology change → downstream sees a new wave. Skip when already
		// dirty (we're inside an in-flight wave and have already emitted).
		// `_depDirtied` can't do this for us because `record.dirty` was
		// pre-set above, which short-circuits its DIRTY-emit path.
		const dirtyEmitted = this._status !== "dirty";
		if (dirtyEmitted) this._emit(DIRTY_ONLY_BATCH);
		record.unsub = noopUnsub;
		try {
			record.unsub = depNode.subscribe((msgs) => {
				if (record.unsub === null) return;
				// Phase 13.8: dispatch via current index of this DepRecord
				// (see `_activate` callback for full rationale).
				const idx = this._deps.indexOf(record);
				if (idx === -1) return;
				// Tier-3+ classification via central `tierOf` per spec §5.11
				// (Bug 1 fix — see _activate for details).
				const tierOf = this._config.tierOf;
				let sawSettlement = false;
				for (const m of msgs) {
					if (tierOf(m[0]) >= 3) sawSettlement = true;
					this._config.onMessage(
						this as unknown as NodeCtx,
						m,
						{ direction: "down-in", depIndex: idx },
						this._actions,
					);
				}
				if (sawSettlement) this._maybeRunFnOnSettlement();
			});
		} catch (err) {
			// Phase 13.8 QA D: rollback AND close the orphan DIRTY downstream.
			// Previously the comment claimed `_execFn`'s catch would emit
			// ERROR — but that only holds when called from autoTrackNode
			// inside `_execFn`. For external callers (`Graph._addDep`), the
			// DIRTY would orphan downstream. Emit ERROR explicitly so the
			// wave closes deterministically.
			record.unsub = null;
			this._deps.pop();
			this._dirtyDepCount--;
			if (dirtyEmitted) {
				this._emit([[ERROR, err]]);
			}
			throw err;
		}
		return depIdx;
	}

	/**
	 * @internal **EXPERIMENTAL — Phase 13.8.** Append a dep post-construction
	 * with full validation guards. Wraps {@link _addDepInternal}.
	 *
	 * **Rejects** (symmetric with `_setDeps`/`_removeDep`):
	 * - Self-dep (`depNode === this`).
	 * - Cycle introduction (`depNode` already transitively depends on `this`).
	 * - Mid-fn (`_isExecutingFn === true`).
	 * - Terminal `this` (`_status` ∈ `{completed, errored}`).
	 * - Reentrant call (another `_setDeps`/`_addDep`/`_removeDep` is in
	 *   flight on `this`).
	 *
	 * `autoTrackNode` and other internal autoTrack/connect-time callers must
	 * use {@link _addDepInternal} directly — they intentionally run from
	 * inside `_execFn` and rely on the substrate-level discovery semantics.
	 *
	 * **Required `fn` parameter (Phase 13.8 lock).** Appending a dep grows
	 * `data.length` by 1; the caller must declare the fn that consumes
	 * the new shape — even if it's the same as the prior fn. Old cleanup's
	 * `onRerun` fires on the next `_execFn` invocation, NOT at swap time.
	 * If no further `_execFn` runs (e.g., immediate deactivation),
	 * `onRerun` is silently dropped — `onDeactivation` still fires.
	 *
	 * @returns The index of the new dep in `_deps`, or the existing index
	 *   if the dep was already present.
	 */
	_addDep(depNode: Node, fn: NodeFn, _opts?: Record<string, never>): number {
		if (this._status === "completed" || this._status === "errored") {
			throw new Error(
				`_addDep: cannot add dep on node "${this.name}" in terminal state "${this._status}"`,
			);
		}
		if (this._isExecutingFn) {
			throw new Error(
				`_addDep: cannot add dep on node "${this.name}" while its fn is executing (mid-fn topology mutation). Use _addDepInternal for autoTrackNode-style discovery from inside fn.`,
			);
		}
		if (this._inDepMutation) {
			throw new Error(
				`_addDep: reentrant dep mutation rejected on node "${this.name}". Another _setDeps/_addDep/_removeDep is in flight (likely a synchronous re-entry from a subscribe handshake or topology subscriber).`,
			);
		}
		if (depNode === (this as unknown as Node)) {
			throw new Error(
				`_addDep: self-dependency rejected for node "${this.name}" — passing this node as its own dep is not supported`,
			);
		}
		// Cycle reject — DFS through transitive `_deps[*].node` looking for
		// `this`. If reachable, adding the edge `depNode → this` would close
		// a cycle. Skip when dep is already present (dedup will catch it
		// inside `_addDepInternal` anyway, and the existing edge can't
		// introduce a new cycle).
		if (
			!this._deps.some((r) => r.node === depNode) &&
			_reachableUpstream(depNode, this as unknown as Node)
		) {
			throw new Error(
				`_addDep: would create cycle — dep "${(depNode as NodeImpl).name}" already transitively depends on "${this.name}"`,
			);
		}
		this._inDepMutation = true;
		try {
			return this._addDepInternal(depNode, { fn });
		} finally {
			this._inDepMutation = false;
		}
	}

	/**
	 * @internal **EXPERIMENTAL — Phase 13.8.**
	 *
	 * Remove a dep. Symmetric counterpart to `_addDep`. Idempotent — if
	 * `depNode` is not currently in `_deps`, this is a no-op (still
	 * applies the fn swap). Removing the last dep is allowed; N becomes
	 * a degenerate fn-with-no-deps shape (cache preserved per Q7; no
	 * further fires until a fresh wave arrives).
	 *
	 * **Required `fn` parameter (Phase 13.8 lock).** Removing a dep
	 * shrinks `data.length`; the caller must declare the fn that consumes
	 * the new shape. Even when the dep is absent (idempotent path), the
	 * fn swap still applies — the API enforces fn-deps pairing at every
	 * call site.
	 *
	 * **Auto-settle.** If the removed dep was the sole DIRTY contributor
	 * and the node was waiting on it, the wave settles via the standard
	 * settlement path (Q6). DepRecord state for surviving deps is
	 * preserved (DepRecord-ref dispatch handles position shifts).
	 *
	 * **Rejects:**
	 * - Mid-fn (`_isExecutingFn === true`).
	 * - Terminal `this` (`_status` ∈ `{completed, errored}`).
	 *
	 * @param depNode — the dep Node to remove.
	 * @param fn — transform fn for the post-remove shape; replaces `this._fn`.
	 * @param _opts — reserved for future expansion.
	 */
	_removeDep(depNode: Node, fn: NodeFn, _opts?: Record<string, never>): void {
		if (this._status === "completed" || this._status === "errored") {
			throw new Error(
				`_removeDep: cannot remove dep on node "${this.name}" in terminal state "${this._status}"`,
			);
		}
		if (this._isExecutingFn) {
			throw new Error(
				`_removeDep: cannot remove dep on node "${this.name}" while its fn is executing (mid-fn topology mutation)`,
			);
		}
		if (this._inDepMutation) {
			throw new Error(
				`_removeDep: reentrant dep mutation rejected on node "${this.name}". Another _setDeps/_addDep/_removeDep is in flight.`,
			);
		}
		this._inDepMutation = true;
		try {
			const idx = this._deps.findIndex((r) => r.node === depNode);
			if (idx === -1) {
				// Not present — idempotent on the dep, but fn swap still lands
				// (Phase 13.8 lock: fn-deps pairing is required at every call).
				this._fn = fn;
				return;
			}
			const rec = this._deps[idx];
			if (rec.unsub != null) {
				const u = rec.unsub;
				rec.unsub = null;
				try {
					u();
				} catch {
					/* best-effort: dep unsub errors are secondary */
				}
			}
			const removedDirtyContributor = rec.dirty;
			if (rec.dirty) this._dirtyDepCount--;
			this._deps.splice(idx, 1);
			this._fn = fn;
			// Q6 auto-settle: if the only dirty contributor was the removed
			// dep and the wave is now empty, fire fn settlement so downstream
			// sees a coherent close-of-wave.
			if (
				removedDirtyContributor &&
				this._dirtyDepCount === 0 &&
				this._status === "dirty" &&
				this._sinks != null
			) {
				this._maybeRunFnOnSettlement();
			}
		} finally {
			this._inDepMutation = false;
		}
	}

	/**
	 * @internal **EXPERIMENTAL — Phase 13.8 exploratory impl.**
	 *
	 * Replace this node's upstream deps atomically. Used by
	 * `Graph._rewire(name, newDeps)` to support AI self-pruning of harness
	 * topology (per `project_rewire_gap` memory).
	 *
	 * **Variant: surgical (kept deps untouched).** A dep that appears in
	 * BOTH the old and new dep sets is left completely alone — its
	 * subscription stays attached, its DepRecord (`prevData`, `dirty`,
	 * `dataBatch`, `terminal`) is unchanged, the dep does not see N
	 * unsub-then-resub. Only **removed** deps are unsubscribed (and their
	 * DepRecord discarded), and only **added** deps get a fresh DepRecord
	 * + subscription.
	 *
	 * **Reorder + interior-remove are allowed.** Subscription callbacks
	 * bind to the DepRecord reference (Phase 13.8 Option C); they look
	 * up the current index dynamically via `_deps.indexOf(record)` at
	 * dispatch time. So kept deps may shift position freely without
	 * needing to re-subscribe. The user's `newDeps` order determines
	 * `_deps` order verbatim.
	 *
	 * **Preserves** (per Q2/Q3/Q7 of rewire-design-notes.md + the surgical
	 * lock):
	 * - `_cached` (compute-node cache survives rewire — Q7)
	 * - `_hasCalledFnOnce` (first-run gate not re-armed — Q2)
	 * - `_pauseLocks` / `_pauseBuffer` (Q3 — N's outgoing pause state)
	 * - `_replayBuffer` (N's outgoing replay history)
	 * - `_store` / `_cleanup` (per-node scratch + cleanup hooks)
	 * - **Kept deps' DepRecords** — `prevData`, `dirty`, `dataBatch`,
	 *   `terminal` all carry through verbatim.
	 *
	 * **Discards** — only state owned by removed deps' DepRecords.
	 *
	 * **Rejects** (per `rewire-design-notes.md` post-design resolutions):
	 * - Self-rewire (`this` ∈ `newDeps`).
	 * - Cycle introduction (DFS through transitive `_deps`).
	 * - Mid-fn rewire (`_isExecutingFn === true`).
	 * - Terminal `this` (`_status` ∈ `{completed, errored}`).
	 * - **Phase 13.8 design pass:** any `newDeps` entry that is currently
	 *   in non-resubscribable terminal state. (`defaultOnSubscribe`
	 *   silently no-ops on terminal non-resubscribable nodes — adding
	 *   one would wedge N. Resubscribable terminals ARE allowed because
	 *   `subscribe()` triggers `_resetForFreshLifecycle` on them.)
	 *
	 * **Required `fn` parameter (Phase 13.8 lock).** Every dep mutation
	 * MUST pair with an explicit fn — even if it's the same as the old
	 * one. Rationale: user fns read `data[i]` / `prevData[i]` positionally;
	 * dep-shape changes (count or order) silently misroute reads unless
	 * the caller acknowledges the fn-deps pairing at every call site.
	 * Forcing fn at the API boundary makes the audit step mandatory.
	 *
	 * The next `_execFn` invocation fires the old cleanup's `onRerun` hook
	 * (clean wrap-up) and runs the new fn. `_store`, `_hasCalledFnOnce`,
	 * cache, replay buffer, and pause locks are all preserved.
	 *
	 * Callers that want to keep the prior fn must hold a reference to it
	 * (define fns as named consts rather than inline lambdas, or read
	 * `(node as NodeImpl)._fn` for ad-hoc retrieval).
	 *
	 * @param newDeps — full new dep set (deduplicated by reference identity).
	 * @param fn — transform fn for the rewired node; replaces `this._fn`
	 *   atomically with the dep mutation. Pass the existing fn ref to
	 *   preserve behavior when only the dep set changes.
	 * @param _opts — reserved for future expansion.
	 */
	_setDeps(newDeps: readonly Node[], fn: NodeFn, _opts?: Record<string, never>): void {
		// --- Validation: this-side ---
		if (this._status === "completed" || this._status === "errored") {
			throw new Error(
				`_setDeps: cannot rewire node "${this.name}" in terminal state "${this._status}"`,
			);
		}
		if (this._isExecutingFn) {
			throw new Error(
				`_setDeps: cannot rewire node "${this.name}" while its fn is executing (mid-fn topology mutation)`,
			);
		}
		if (this._inDepMutation) {
			throw new Error(
				`_setDeps: reentrant dep mutation rejected on node "${this.name}". Another _setDeps/_addDep/_removeDep is in flight (likely a synchronous re-entry from a subscribe handshake or topology subscriber).`,
			);
		}

		// Dedupe by reference identity (mirrors `_addDep`).
		const seen = new Set<Node>();
		const dedupedNewDeps: Node[] = [];
		for (const d of newDeps) {
			if (seen.has(d)) continue;
			seen.add(d);
			dedupedNewDeps.push(d);
		}
		if (seen.has(this as unknown as Node)) {
			throw new Error(
				`_setDeps: self-dependency rejected for node "${this.name}" — pass a deps array that does not include this node`,
			);
		}

		// --- Cycle reject ---
		for (const d of dedupedNewDeps) {
			if (_reachableUpstream(d, this as unknown as Node)) {
				throw new Error(
					`_setDeps: would create cycle — dep "${(d as NodeImpl).name}" already transitively depends on "${this.name}"`,
				);
			}
		}

		// --- Diff: compute removed, added, kept ---
		// Map each old dep node to its DepRecord for O(1) lookup. Kept deps
		// can shift position freely because subscription callbacks bind to
		// the DepRecord reference, not the index (Phase 13.8 Option C).
		const oldRecordByNode = new Map<Node, DepRecord>();
		for (const rec of this._deps) {
			oldRecordByNode.set(rec.node, rec);
		}

		// --- Validation: terminal-non-resubscribable on added deps ---
		// Resubscribable terminals are accepted: subscribe() triggers
		// `_resetForFreshLifecycle` on them, putting them in a clean
		// sentinel state for the new edge.
		for (const d of dedupedNewDeps) {
			if (oldRecordByNode.has(d)) continue; // kept, no new subscription
			const impl = d as NodeImpl;
			if ((impl._status === "completed" || impl._status === "errored") && !impl._resubscribable) {
				throw new Error(
					`_setDeps: cannot add non-resubscribable terminal dep "${impl.name}" (status=${impl._status}). The subscribe handshake is silent for terminal non-resubscribable nodes, which would leave the new edge wedged. Either remove the dep from the rewire, mark the dep as resubscribable, or add a fresh node.`,
				);
			}
		}

		this._inDepMutation = true;
		try {
			// --- Phase 1: disconnect removed deps ---
			// Walk old `_deps`; whatever is no longer present in newDeps gets
			// unsubscribed and its DepRecord state cleaned up. Track whether
			// we removed a dirty contributor — if so we may need to settle.
			const newDepsSet = seen; // already populated above
			let removedDirtyContributor = false;
			for (const oldRec of this._deps) {
				if (newDepsSet.has(oldRec.node)) continue; // kept
				// removed
				if (oldRec.unsub != null) {
					const u = oldRec.unsub;
					oldRec.unsub = null;
					try {
						u();
					} catch {
						/* best-effort: dep unsub errors are secondary on rewire */
					}
				}
				if (oldRec.dirty) {
					removedDirtyContributor = true;
					this._dirtyDepCount--;
				}
				// DepRecord garbage-collected when we replace `_deps` below.
			}

			// --- Phase 2: build new _deps array ---
			// Reuse existing DepRecords for kept deps (preserving prevData,
			// dirty, dataBatch, terminal). Create fresh DepRecords for added.
			// Kept deps may end up at a different index than before — that's
			// fine because subscription callbacks bind to record references.
			const newRecords: DepRecord[] = new Array(dedupedNewDeps.length);
			const addedIndices: number[] = [];
			for (let i = 0; i < dedupedNewDeps.length; i++) {
				const d = dedupedNewDeps[i];
				const existing = oldRecordByNode.get(d);
				if (existing !== undefined) {
					newRecords[i] = existing;
				} else {
					newRecords[i] = createDepRecord(d);
					addedIndices.push(i);
				}
			}
			this._deps = newRecords;

			// --- Phase 2.5: required fn replacement (Phase 13.8 lock) ---
			// Land the new fn BEFORE any auto-settle / re-fire path so the next
			// `_execFn` call uses it. Old cleanup stays attached; the existing
			// rerun-cleanup path in `_execFn` will fire its `onRerun` hook
			// before invoking the new fn (clean wrap-up of old fn's last run).
			// `fn` is required at the API boundary — same fn is fine, but the
			// caller must always declare what fn the new dep set pairs with.
			this._fn = fn;

			// --- Phase 3: subscribe added deps ---
			// Inactive node (`_sinks == null`): defer. `_activate()` will
			// subscribe every `_deps` entry from scratch on first sink.
			if (this._sinks == null) {
				// Honor the auto-settle Q6 case here too, even though we
				// haven't subscribed: if the only dirty contributors got
				// removed and the node was waiting for them, the wave is
				// already settled in spirit.
				if (
					removedDirtyContributor &&
					addedIndices.length === 0 &&
					this._dirtyDepCount === 0 &&
					this._status === "dirty"
				) {
					this._maybeRunFnOnSettlement();
				}
				return;
			}

			// Pre-dirty added deps so the wave gate accounts for them. Mirror
			// `_addDepInternal`'s pre-dirty + counter bump.
			const hadAdded = addedIndices.length > 0;
			let dirtyEmitted = false;
			if (hadAdded) {
				for (const i of addedIndices) {
					const rec = this._deps[i];
					rec.dirty = true;
					this._dirtyDepCount++;
				}
				// Topology change introducing new in-flight deps → emit DIRTY
				// downstream once if not already in a wave. Mirrors `_addDepInternal`.
				if (this._status !== "dirty") {
					this._emit(DIRTY_ONLY_BATCH);
					dirtyEmitted = true;
				}
			}

			// Subscribe each added dep. Closure binds to the DepRecord; index
			// looked up dynamically via `_deps.indexOf(record)` so future
			// `_setDeps` calls that shift this dep's position remain correct.
			// Kept deps' subscriptions remain in place untouched.
			let subscribedCount = 0;
			try {
				for (const i of addedIndices) {
					const rec = this._deps[i];
					rec.unsub = noopUnsub;
					rec.unsub = rec.node.subscribe((msgs) => {
						if (rec.unsub === null) return;
						const idx = this._deps.indexOf(rec);
						if (idx === -1) return;
						const tierOf = this._config.tierOf;
						let sawSettlement = false;
						for (const m of msgs) {
							if (tierOf(m[0]) >= 3) sawSettlement = true;
							this._config.onMessage(
								this as unknown as NodeCtx,
								m,
								{ direction: "down-in", depIndex: idx },
								this._actions,
							);
						}
						if (sawSettlement) this._maybeRunFnOnSettlement();
					});
					subscribedCount++;
				}
			} catch (err) {
				// Phase 13.8 QA D: rollback the partially-subscribed state
				// AND emit a settlement downstream to close the orphan DIRTY
				// (R1.3.1.a — DIRTY without follow-up DATA/RESOLVED is a spec
				// violation). Strategy:
				//   1. Null `unsub` on every not-yet-successfully-subscribed
				//      record so any drainPhase2 closures dropped.
				//   2. Splice failed records out of `_deps` so `indexOf`
				//      returns -1 in any in-flight callback AND so the next
				//      `_setDeps` call doesn't see them as "kept-and-live".
				//   3. Decrement `_dirtyDepCount` for the dropped records.
				//   4. If we already emitted DIRTY downstream, emit ERROR
				//      downstream so the wave closes deterministically.
				const failedIndices: number[] = [];
				for (let k = subscribedCount; k < addedIndices.length; k++) {
					failedIndices.push(addedIndices[k]);
				}
				for (const idx of failedIndices) {
					const failedRec = this._deps[idx];
					if (failedRec == null) continue;
					failedRec.unsub = null;
					if (failedRec.dirty) {
						failedRec.dirty = false;
						this._dirtyDepCount--;
					}
				}
				if (failedIndices.length > 0) {
					const failedSet = new Set(failedIndices);
					this._deps = this._deps.filter((_, idx) => !failedSet.has(idx));
				}
				if (dirtyEmitted) {
					// Close the orphan DIRTY downstream with an ERROR carrying
					// the cause. Emit BEFORE rethrow so subscribers see a
					// well-formed wave: DIRTY → ERROR.
					this._emit([[ERROR, err]]);
				}
				throw err;
			}

			// Q6 auto-settle: if the only dirty contributors were removed
			// and no added deps replaced them, and the wave is empty but
			// the node is still marked dirty — let the settlement path
			// decide whether to fire fn (e.g. with stale prevData).
			if (
				removedDirtyContributor &&
				!hadAdded &&
				this._dirtyDepCount === 0 &&
				this._status === "dirty"
			) {
				this._maybeRunFnOnSettlement();
			}
		} finally {
			this._inDepMutation = false;
		}
	}

	/**
	 * @internal Unsubscribes from deps, fires fn cleanup (both shapes),
	 * clears wave/store state, and (for compute nodes) drops `_cached` per
	 * the ROM/RAM rule. Idempotent: second call is a no-op.
	 *
	 * @param skipStatusUpdate — When `true`, the caller takes responsibility
	 *   for setting `_status` after deactivation (e.g. TEARDOWN always sets
	 *   `"sentinel"` unconditionally). When `false` (default), deactivation
	 *   applies the ROM rule: compute nodes → `"sentinel"`, state nodes
	 *   preserve their current status.
	 */
	_deactivate(skipStatusUpdate = false): void {
		// Fn cleanup — fires the `onDeactivation` hook (Lock 4.A).
		// Function-form shorthand still fires here too (transitional, see
		// `NodeFnCleanup` doc; tracked for removal in `docs/optimizations.md`).
		// Note on cleanup-throw ERRORs: when deactivation runs as part of
		// last-sink-unsubscribe, `_sinks` is already `null` by the time this
		// method is reached, so any ERROR emitted here lands on
		// `_deliverToSinks`'s null-guard and is dropped by design. Cleanup
		// errors during teardown are best-effort — callers that need to
		// observe them should install a host-level error channel via
		// `configure()`.
		const cleanup = this._cleanup;
		this._cleanup = undefined;
		if (typeof cleanup === "function") {
			try {
				cleanup();
			} catch (err) {
				this._emit([[ERROR, this._wrapFnError("cleanup threw", err)]]);
			}
		} else if (cleanup != null) {
			const hook = cleanup.onDeactivation;
			if (typeof hook === "function") {
				try {
					hook();
				} catch (err) {
					this._emit([[ERROR, this._wrapFnError("cleanup.onDeactivation threw", err)]]);
				}
			}
		}

		// Disconnect from deps.
		for (const d of this._deps) {
			if (d.unsub != null) {
				const u = d.unsub;
				d.unsub = null;
				try {
					u();
				} catch {
					/* best-effort teardown of upstream subscription */
				}
			}
			resetDepRecord(d);
		}

		// Clear wave state.
		this._waveHasNewData = false;
		this._hasNewTerminal = false;
		this._waveHasInvalidate = false;
		this._hasCalledFnOnce = false;
		this._paused = false;
		this._pendingWave = false;
		this._pendingRerun = false;
		this._rerunDepth = 0;
		// Lock 6.D (Phase 13.6.B): `ctx.store` is NO LONGER wiped on
		// deactivation. Preserve-across-deactivation is the new default
		// (G.20 flip). Operators requiring auto-wipe (`take(n)`, `scan`,
		// `pairwise`, parser-state operators, etc.) must explicitly clear
		// in `onDeactivation`. The cleanup-hook firing path above (in
		// `_deactivate`) gives them the hook; the store is left
		// untouched here so user-installed `onDeactivation` runs first
		// and decides what (if anything) to wipe.
		// A3 counter reset with DepRecord bulk-reset.
		this._dirtyDepCount = 0;
		// DS-13.5.A Q16 idempotency: clear `_teardownDone` so a resubscribable
		// node that received TEARDOWN can re-arm Q16 on the next lifecycle.
		// Without this, the `_maybeRunFnOnSettlement` early-return at the
		// `_teardownDone` guard would permanently wedge fn after the first
		// TEARDOWN — breaking compat layers (`compat/jotai`, `compat/nanostores`,
		// `compat/signals`) that rely on `resubscribable: true`.
		this._teardownDone = false;
		// C0 pause state: TEARDOWN is a hard reset. Buffered tier-3/4
		// messages from a paused `resumeAll` node are DISCARDED rather than
		// drained, matching "teardown wipes in-flight state" semantics.
		// Clearing both structures also prevents a memory leak on
		// non-resubscribable teardown, and guarantees a resubscribable
		// re-activation starts from `_paused === false` with no stale
		// lockset carried over from the previous lifecycle.
		this._pauseLocks = null;
		this._pauseBuffer = null;
		// Lock 6.A: clear pause-cycle bookkeeping symmetric with the
		// resubscribable-reset path so a resubscribable node coming back
		// from terminal-overflow starts its next pause cycle clean.
		this._pauseStartNs = undefined;
		this._pauseDroppedCount = 0;
		this._pauseOverflowed = false;
		// Lock 6.G (spec §2.5): TEARDOWN / last-sink-detach is a hard
		// reset — drop the replay history so a resubscribable node
		// coming back into a fresh lifecycle doesn't ship pre-teardown
		// values to its new subscribers. Mirrors `_pauseBuffer` clear
		// above and the formal-model `replaySnapshot' = <<>>` clear in
		// `Resubscribe` (TLA+ batch 6 G).
		this._replayBuffer = null;

		// ROM/RAM: compute nodes clear cache; pure state nodes preserve it.
		if (this._fn != null) {
			this._cached = undefined;
		}

		if (!skipStatusUpdate) {
			// Compute nodes → "sentinel" (cache cleared, no value).
			// - Non-terminal: always reset.
			// - Terminal + resubscribable: reset (resubscribable means
			//   "can be re-activated after terminal" — the terminal state
			//   doesn't persist across subscription cycles).
			// - Terminal + non-resubscribable: preserve (stream is over).
			// State nodes preserve status (ROM rule, value is intrinsic).
			if (this._fn != null || this._deps.length > 0) {
				if (!this._isTerminal || this._resubscribable) {
					this._status = "sentinel";
				}
			}
		}
	}

	// --- Dep message dispatch (§3.5 singleton default) ---

	/**
	 * @internal Default per-tier dispatch for incoming dep messages. Called
	 * by `defaultOnMessage`. Updates the DepRecord, triggers wave
	 * completion, and forwards passthrough traffic.
	 */
	_onDepMessage(depIndex: number, msg: Message): void {
		const dep = this._deps[depIndex];
		const t = msg[0];

		// Fire inspector hooks before default dispatch. Common case: no hooks
		// (undefined slot). Multiple observers can attach simultaneously.
		if (this._inspectorHooks != null) {
			const ev: NodeInspectorHookEvent = { kind: "dep_message", depIndex, message: msg };
			for (const hook of this._inspectorHooks) hook(ev);
		}

		// Tier 0 (START) — informational, no state change.
		if (t === START) return;

		// Tier 1
		if (t === DIRTY) {
			this._depDirtied(dep);
			return;
		}
		if (t === INVALIDATE) {
			this._depInvalidated(dep);
			// **INVARIANT (DS-13.5.A diamond fan-in):** `_depInvalidated`
			// runs UNCONDITIONALLY before this `_cached === undefined`
			// idempotency guard. Second-arrival counter-correctness depends
			// on `_depInvalidated`'s own `if (dep.dirty)` pre-check
			// (line ~1670) — first arrival flips dep.dirty to false so the
			// second arrival's decrement is gated out. Any future refactor
			// that relaxes that pre-check (e.g. unconditional dirty toggle)
			// will silently underflow `_dirtyDepCount` on diamond second
			// arrivals. Keep the dep.dirty pre-check load-bearing.
			//
			// Diamond fan-in guard (TLA+ batch 5 B parity, 2026-04-23): when a
			// second INVALIDATE arrives at a node whose cache was already reset
			// by an earlier arrival this wave (e.g. topology `A → {B, C} → D`
			// where D receives INVALIDATE from both parents), skip the self
			// self-processing — there's no cached value to clean up and
			// downstream children were already notified by the first arrival.
			// Without this guard, an object-form cleanup with an `invalidate`
			// hook (e.g. `patterns/ai/prompts/frozen-context.ts`) would fire
			// twice, and the redundant re-broadcast would cascade through the
			// subgraph. Matches the TLA+ `CleanupWitnessNotSentinel` invariant's
			// guard in `DeliverInvalidate`.
			//
			// Caveat (batch 7 QA, Option B for BH-2/ECH-2): `_cached === undefined`
			// overloads TWO semantics — "cache was reset this wave" (the diamond
			// case above) AND "cache was never populated" (mid-chain derived
			// that received DIRTY but not DATA yet, or a node with no `initial`).
			// In the second case, a FIRST-time INVALIDATE arrival is also
			// skipped: no cleanup hook fires (correct — nothing to clean up)
			// and no downstream forward happens. This means an observer via
			// `graph.observe()` on a never-populated mid-chain derived will
			// NOT see INVALIDATE propagate through that node. Semantically
			// this is "INVALIDATE at undefined ≈ no-op" — the observable
			// state at downstream is unchanged regardless. Accepted as a
			// design simplification rather than introducing a per-wave
			// `_invalidatedThisWave` flag whose clear-point would add
			// tracking burden; matches the TLA+ model's analogous
			// `cache = DefaultInitial` guard.
			if (this._cached === undefined) return;
			this._emit(INVALIDATE_ONLY_BATCH);
			return;
		}

		// Tier 2 — PAUSE / RESUME flow downstream (spec §1.2). Lock bookkeeping
		// happens inside `_emit` so both `_onDepMessage` (PAUSE received from
		// a dep) and external `node.down([[PAUSE, lockId]])` (source
		// directly issuing PAUSE) hit the same path. Here we just forward —
		// `_emit` will consume the lock, update `_paused`, and broadcast.
		if (t === PAUSE || t === RESUME) {
			this._emit([msg]);
			return;
		}

		// Tier 6
		if (t === TEARDOWN) {
			this._emit(TEARDOWN_ONLY_BATCH);
			return;
		}

		// Tier 3 / 4 — centralized transitions keep the settlement counters
		// (`_dirtyDepCount`, `_sentinelDepCount`) in sync with the flags on
		// every DepRecord. A3 optimization: the two counters let
		// `_maybeRunFnOnSettlement` check wave completion in O(1) instead
		// of two `every(...)` scans.
		if (t === DATA) {
			this._depSettledAsData(dep, msg[1]);
		} else if (t === RESOLVED) {
			this._depSettledAsResolved(dep);
		} else if (t === COMPLETE) {
			this._depSettledAsTerminal(dep, true);
		} else if (t === ERROR) {
			this._depSettledAsTerminal(dep, msg[1]);
		} else {
			// Unknown type: forward as-is (spec §1.3.6 forward-compat).
			this._emit([msg]);
			return;
		}

		if (!this._fn) {
			// Passthrough: forward DATA/RESOLVED 1:1 through the unified
			// emit pipeline. `_emit` owns tier sort + synthetic DIRTY
			// prefix + equals substitution uniformly — no manual framing.
			if (t === DATA || t === RESOLVED) {
				this._emit([msg]);
			}
			if (t === COMPLETE || t === ERROR) {
				this._maybeAutoTerminalAfterWave();
			}
			return;
		}

		// NOTE: `_maybeRunFnOnSettlement()` is intentionally NOT called here.
		// It fires at the end of the dep-subscribe callback's message-iteration
		// loop in `_activate`/`_addDep`, guarded by `config.tierOf(m[0]) >= 3`
		// — one invocation per dep batch so `fn` sees the full wave (Bug 1).
	}

	// --- Centralized dep-state transitions (A3 settlement counters) ---
	//
	// Every mutation to `DepRecord.dirty` / `DepRecord.prevData` /
	// `DepRecord.terminal` must go through one of these helpers so the
	// `_dirtyDepCount` and `_sentinelDepCount` counters stay in sync with
	// the per-record flags. `_maybeRunFnOnSettlement` reads the counters
	// and never re-scans the `_deps` array.

	/**
	 * Called when a dep transitions `dirty: false → true` (either from an
	 * incoming DIRTY, or pre-set during `_activate` / `_addDep` /
	 * `_depInvalidated`). No-op if the dep is already dirty. Fires the
	 * downstream DIRTY emit if we're the first to dirty this wave.
	 */
	private _depDirtied(dep: DepRecord): void {
		if (dep.dirty) return;
		dep.dirty = true;
		dep.involvedThisWave = true;
		this._dirtyDepCount++;
		// First dep to dirty this wave → propagate DIRTY to our own sinks.
		if (this._status !== "dirty") {
			this._emit(DIRTY_ONLY_BATCH);
		}
	}

	/**
	 * Called when a dep delivers new DATA: clears dirty, stores the payload,
	 * marks wave-has-data, and — if this is the dep's first DATA — clears
	 * its sentinel slot so the first-run gate can open.
	 */
	private _depSettledAsData(dep: DepRecord, value: unknown): void {
		if (dep.dirty) {
			dep.dirty = false;
			this._dirtyDepCount--;
		}
		dep.involvedThisWave = true;
		dep.dataBatch.push(value);
		this._waveHasNewData = true;
	}

	/**
	 * Called when a dep emits RESOLVED (wave settled, value unchanged).
	 * Clears dirty; does NOT touch `prevData` / `terminal` / sentinel
	 * count — sentinel only exits on first DATA or terminal, not RESOLVED.
	 */
	private _depSettledAsResolved(dep: DepRecord): void {
		if (dep.dirty) {
			dep.dirty = false;
			this._dirtyDepCount--;
		}
	}

	/**
	 * Called when a dep delivers COMPLETE (`terminal = true`) or ERROR
	 * (`terminal = errorPayload`). Clears dirty, stores the terminal, and
	 * — if the dep had never contributed a DATA yet — leaves sentinel
	 * since the gate treats "terminated without data" as gate-open too.
	 */
	private _depSettledAsTerminal(dep: DepRecord, terminal: unknown): void {
		if (dep.dirty) {
			dep.dirty = false;
			this._dirtyDepCount--;
		}
		dep.terminal = terminal;
		dep.involvedThisWave = true;
		this._hasNewTerminal = true;
	}

	/**
	 * Called when a dep emits INVALIDATE.
	 *
	 * **DS-13.5.A invariant:** INVALIDATE settles a wave for this dep — same
	 * `_dirtyDepCount` accounting role as RESOLVED. A single `[[INVALIDATE]]`
	 * arrival on a previously-dirty dep clears the dirty flag and decrements
	 * the counter; a single arrival on a clean dep is a no-op for the
	 * counter (the dep was never participating in the wave). Either way, the
	 * dep's per-wave state — `prevData`, `terminal`, `dataBatch` — clears so
	 * the next fn run sees the dep in SENTINEL state.
	 *
	 * `involvedThisWave` is left `false`: INVALIDATE is not a "fn-must-run"
	 * trigger by itself. The `invalidateWhenDepsInvalidate` cascade default
	 * (Q12, deferred) will track involvement separately when implemented.
	 */
	private _depInvalidated(dep: DepRecord): void {
		dep.prevData = undefined;
		dep.terminal = undefined;
		dep.dataBatch.length = 0;
		if (dep.dirty) {
			dep.dirty = false;
			this._dirtyDepCount--;
		}
		dep.involvedThisWave = false;
		// DS-13.5.A: mark the wave as having seen an INVALIDATE so
		// `_maybeRunFnOnSettlement` doesn't re-fire RESOLVED or fn after
		// the cascade (`_emit(INVALIDATE_ONLY_BATCH)` already settled the
		// downstream wave via INVALIDATE).
		this._waveHasInvalidate = true;
	}

	private _maybeRunFnOnSettlement(): void {
		if (this._isTerminal && !this._resubscribable) return;
		// DS-13.5.A Q16 idempotency: a node that has fully torn down (TEARDOWN
		// processed once, deps disconnected, cleanup fired) must not re-run
		// fn even when subsequent dep cascades carry settlement-class
		// messages. Without this guard, the synthetic [[COMPLETE], [TEARDOWN]]
		// pair Q16 emits on the FIRST teardown delivery floats `_hasNewTerminal`
		// for downstream consumers; their `_maybeRunFnOnSettlement` then
		// falls through to `_execFn`, which re-establishes `_cleanup`,
		// causing a second cleanup invocation on the next TEARDOWN delivery.
		if (this._teardownDone) return;
		// O(1) gate: `_dirtyDepCount === 0` means every dep has delivered its
		// settlement for this wave (DATA, RESOLVED, or terminal).
		if (this._dirtyDepCount > 0) return;
		// Spec §2.7 first-run gate. Applied only until fn has fired once
		// (`_hasCalledFnOnce`), so `_addDep` post-activation, subsequent
		// waves, and INVALIDATE do not re-gate. Terminal reset on a
		// resubscribable node clears `_hasCalledFnOnce` and re-arms.
		// Scan is O(N) on declared-dep count, fires at most once per
		// activation cycle — cheaper than maintaining a dedicated counter
		// in lockstep across `_depSettledAsData` / `_depSettledAsTerminal`
		// / `_depInvalidated` / `_addDep` / reset paths. `_maybeAutoTerminalAfterWave`
		// is still called so ERROR propagates even while fn is gated.
		if (!this._partial && !this._hasCalledFnOnce) {
			for (let i = 0; i < this._deps.length; i++) {
				const d = this._deps[i];
				const isSentinel =
					d.dataBatch.length === 0 && d.prevData === undefined && d.terminal === undefined;
				if (isSentinel) {
					this._maybeAutoTerminalAfterWave();
					return;
				}
			}
		}
		if (this._paused) {
			this._pendingWave = true;
			return;
		}
		// DS-13.5.A: a pure-INVALIDATE wave (no DATA, no terminal, but at
		// least one dep emitted INVALIDATE) is already settled via the
		// cascade in `_onDepMessage`'s INVALIDATE branch
		// (`_emit(INVALIDATE_ONLY_BATCH)` cleared `_cached`, set
		// `_status = "sentinel"`, and forwarded INVALIDATE to sinks).
		// Re-firing pre-fn skip RESOLVED here would deliver a
		// "value-unchanged" claim that contradicts the just-cleared cache,
		// and re-running fn would compute on cleared `prevData` slots
		// (e.g. `undefined * 2 = NaN`). Settle silently.
		if (
			this._waveHasInvalidate &&
			!this._waveHasNewData &&
			!this._hasNewTerminal &&
			this._hasCalledFnOnce
		) {
			this._clearWaveFlags();
			this._maybeAutoTerminalAfterWave();
			return;
		}
		// Pre-fn skip: when no dep sent DATA this wave (all RESOLVED), skip
		// fn and emit RESOLVED directly. Transitive-skip optimization — leaf
		// fn is not re-run when a mid-chain node produces the same value.
		if (!this._waveHasNewData && !this._hasNewTerminal && this._hasCalledFnOnce) {
			this._clearWaveFlags();
			this._emit(RESOLVED_ONLY_BATCH);
			this._maybeAutoTerminalAfterWave();
			return;
		}
		if (this._fn) this._execFn();
		this._maybeAutoTerminalAfterWave();
	}

	private _maybeAutoTerminalAfterWave(): void {
		if (this._deps.length === 0) return;
		if (this._isTerminal) return;
		// ERROR always propagates (unless rescue operator opts out via
		// errorWhenDepsError: false). Checked independently of _autoComplete
		// so operators with completeWhenDepsComplete: false still get
		// automatic error forwarding.
		const erroredDep = this._deps.find((d) => d.terminal !== undefined && d.terminal !== true);
		if (erroredDep != null) {
			if (this._autoError) {
				this._emit([[ERROR, erroredDep.terminal]]);
			}
			return;
		}
		// COMPLETE only when autoComplete is true and ALL deps are terminal.
		if (this._autoComplete && this._deps.every((d) => d.terminal !== undefined)) {
			this._emit(COMPLETE_ONLY_BATCH);
		}
	}

	// --- Fn execution ---

	/**
	 * @internal Runs the node fn once.
	 *
	 * Cleanup firing:
	 * - Function-form cleanup — fires here (pre-run) AND on deactivation AND
	 *   on INVALIDATE. Cleared before the new fn runs.
	 * - Object-form cleanup — only `beforeRun` fires here; `deactivate` and
	 *   `invalidate` hooks survive across re-runs. The cleanup reference
	 *   itself is preserved so `deactivate`/`invalidate` still fire later.
	 */
	private _execFn(): void {
		if (!this._fn) return;
		if (this._isTerminal && !this._resubscribable) return;
		// Re-entrance guard: if fn is currently executing (e.g. _addDep
		// triggered a synchronous DATA delivery → _maybeRunFnOnSettlement
		// → _execFn), defer the re-run until the current fn returns.
		if (this._isExecutingFn) {
			this._pendingRerun = true;
			return;
		}

		// Pre-run cleanup — fires the `onRerun` hook (Lock 4.A). The cleanup
		// object itself is preserved so `onDeactivation`/`onInvalidate`
		// survive re-runs; the `onRerun` slot is nulled out before
		// invocation so a throw doesn't leave the hook armed for the next
		// run (violating the "fires exactly once on its named transition"
		// contract).
		// Function-form shorthand still fires here too (transitional, see
		// `NodeFnCleanup` doc; tracked for removal in `docs/optimizations.md`).
		const prevCleanup = this._cleanup;
		if (typeof prevCleanup === "function") {
			this._cleanup = undefined;
			try {
				prevCleanup();
			} catch (err) {
				this._emit([[ERROR, this._wrapFnError("cleanup threw", err)]]);
				return;
			}
		} else if (prevCleanup != null) {
			const hook = prevCleanup.onRerun;
			if (typeof hook === "function") {
				prevCleanup.onRerun = undefined;
				try {
					hook();
				} catch (err) {
					this._emit([[ERROR, this._wrapFnError("cleanup.onRerun threw", err)]]);
					return;
				}
			}
		}

		// Snapshot dep state BEFORE clearing wave flags so the snapshot
		// reflects "this wave" rather than "next wave".
		// dataBatch is copied here because _clearWaveFlags truncates the live
		// array in-place (length = 0) — the fn must see the full wave batch.
		const batchData: (readonly unknown[] | undefined)[] = this._deps.map((d) =>
			!d.involvedThisWave ? undefined : d.dataBatch.length > 0 ? [...d.dataBatch] : [],
		);
		// Snapshot prevData BEFORE committing this wave's values — fn sees the
		// stable values from the end of the previous wave, not the current wave.
		// undefined = "never sent DATA". null is a valid DATA value.
		const prevData: unknown[] = this._deps.map((d) => d.prevData);
		// Commit: advance each dep's prevData to this wave's last DATA so the
		// NEXT wave's fn snapshot sees the current wave as "previous".
		// Use the already-copied batchData rather than dep.dataBatch to avoid
		// any ordering dependency with _clearWaveFlags.
		for (let i = 0; i < this._deps.length; i++) {
			const batch = batchData[i];
			if (batch != null && batch.length > 0) {
				this._deps[i].prevData = batch[batch.length - 1] as unknown;
			}
		}
		const terminalDeps = this._deps.map((d) => d.terminal);
		const ctx: FnCtx = { prevData, terminalDeps, store: this._store };

		this._hasCalledFnOnce = true;
		this._clearWaveFlags();

		// Fire inspector hooks before fn runs — for Graph.observe causal traces.
		if (this._inspectorHooks != null) {
			const ev: NodeInspectorHookEvent = { kind: "run", batchData, prevData };
			for (const hook of this._inspectorHooks) hook(ev);
		}

		this._isExecutingFn = true;
		try {
			const result = this._fn(batchData, this._actions, ctx);
			// Lock 4.A (Phase 13.6.A): named-hook object form is the canonical
			// shape. Function shorthand still accepted as a transitional shim
			// (see `NodeFnCleanup` doc + `docs/optimizations.md`).
			if (typeof result === "function") {
				this._cleanup = result;
			} else if (result != null && typeof result === "object") {
				const o = result as {
					onRerun?: unknown;
					onDeactivation?: unknown;
					onInvalidate?: unknown;
					onResubscribableReset?: unknown;
				};
				if (
					typeof o.onRerun === "function" ||
					typeof o.onDeactivation === "function" ||
					typeof o.onInvalidate === "function" ||
					typeof o.onResubscribableReset === "function"
				) {
					this._cleanup = result as NodeFnCleanup;
				}
			}
		} catch (err) {
			this._emit([[ERROR, this._wrapFnError("fn threw", err)]]);
		} finally {
			this._isExecutingFn = false;
			// Run any pending rerun BEFORE clearing wave flags so the
			// rerun's settlement check sees "this wave had new data" and
			// skips the pre-fn-skip optimization. Without this ordering,
			// autoTrackNode discovery's second pass gets swallowed by
			// the pre-fn-skip path.
			if (this._pendingRerun) {
				this._pendingRerun = false;
				this._rerunDepth += 1;
				// Lock 2.F′ (Phase 13.6.A): cap is read from
				// `cfg.maxFnRerunDepth` so users can tune it at app startup
				// (`configure((cfg) => cfg.maxFnRerunDepth = N)`) or per
				// isolated config instance. Default 100.
				const maxDepth = this._config.maxFnRerunDepth;
				if (this._rerunDepth > maxDepth) {
					const lastDiscoveredDeps =
						this._deps.length > 0
							? this._deps.map((d) => (d.node as Node).name ?? "<unnamed>")
							: undefined;
					this._rerunDepth = 0;
					const detail: Record<string, unknown> = {
						nodeId: this.name,
						currentDepth: maxDepth + 1,
						configuredLimit: maxDepth,
					};
					if (lastDiscoveredDeps != null) detail.lastDiscoveredDeps = lastDiscoveredDeps;
					const err = new Error(
						`Node "${this.name}": _pendingRerun depth exceeded cfg.maxFnRerunDepth (${maxDepth}) — likely a reactive cycle`,
					);
					(err as Error & { detail?: unknown }).detail = detail;
					this._emit([[ERROR, err]]);
				} else {
					this._maybeRunFnOnSettlement();
				}
			} else {
				// Chain converged — reset the depth counter for the next wave.
				this._rerunDepth = 0;
			}
			// Clear flags after rerun so any involvedThisWave/dataBatch set by
			// fn's _addDep subscribe handshakes doesn't leak into the next
			// wave's snapshot. The inner _execFn (if any) already did
			// its own pre-snapshot clear; this is for the case where
			// fn added deps but no rerun fired.
			this._clearWaveFlags();
		}
	}

	private _clearWaveFlags(): void {
		this._waveHasNewData = false;
		this._hasNewTerminal = false;
		this._waveHasInvalidate = false;
		for (const d of this._deps) {
			d.involvedThisWave = false;
			d.dataBatch.length = 0;
		}
	}

	private _wrapFnError(label: string, err: unknown): Error {
		const msg = err instanceof Error ? err.message : String(err);
		return new Error(`Node "${this.name}": ${label}: ${msg}`, { cause: err });
	}

	// --- Framing (tier sort + synthetic DIRTY prefix) ---

	/**
	 * @internal Stable tier sort + synthetic DIRTY prefix for an outgoing
	 * batch. Fast path: already-monotone single-tier batches (the common
	 * case from interned singletons like `DIRTY_ONLY_BATCH`) return the
	 * input unchanged. General path: decorate-sort-undecorate into a new
	 * array, then prepend `[DIRTY]` after any tier-0 START entries when
	 * a tier-3 payload is present and the node isn't already dirty.
	 *
	 * Single source of truth for the spec §1.3.1 framing invariant. Every
	 * outgoing path hits `_frameBatch` exactly once via `_emit`.
	 */
	private _frameBatch(messages: Messages): Messages {
		const tierOf = this._config.tierOf;
		// Fast path: single message.
		if (messages.length === 1) {
			const t0 = messages[0][0];
			const t = tierOf(t0);
			if (t === 3 && this._status !== "dirty") {
				return [DIRTY_MSG, messages[0]];
			}
			// DS-13.5.A Q15 extension of Rule 1.5: tier-4 INVALIDATE also
			// gets the synthetic DIRTY auto-prefix when the node isn't
			// already dirty. This guarantees consumers see DIRTY → INVALIDATE
			// in order, so dep-side `_depDirtied` increments `_dirtyDepCount`
			// before `_depInvalidated` decrements it — preserving wave-
			// settlement accounting for any node that mixes INVALIDATE with
			// other settle-class signals on sibling deps.
			if (t === 4 && this._status !== "dirty") {
				return [DIRTY_MSG, messages[0]];
			}
			// DS-13.5.A Q16: TEARDOWN auto-precedes with [COMPLETE] when the
			// node hasn't yet emitted a terminal lifecycle signal. Idempotent
			// via `_teardownDone` so redundant TEARDOWN deliveries (e.g.
			// `Graph.destroy` broadcast + dep cascade) don't re-emit
			// `[[COMPLETE], [TEARDOWN]]` pairs to sinks. State nodes that
			// never delivered DATA (status="sentinel") still get the synthetic
			// COMPLETE so bridge subscribers (firstWhere/firstValueFrom)
			// reject cleanly instead of hanging on a TEARDOWN-only wave.
			if (t0 === TEARDOWN && !this._teardownDone && !this._isTerminal) {
				return [COMPLETE_MSG, messages[0]];
			}
			return messages;
		}
		// Check monotonicity, settle-slice presence (tier 3 or tier 4),
		// terminal-lifecycle presence, TEARDOWN presence, and INVALIDATE
		// count in a single pass — used for DIRTY auto-prefix (§1.3.1
		// + Q15 extension), Q16 COMPLETE auto-prefix, and DS-13.5.A §2.4a
		// same-wave merge rules.
		let monotone = true;
		let hasSettleSlice = false;
		let hasDirty = false;
		let hasTerminalLifecycle = false;
		let hasTeardown = false;
		let invalidateCount = 0;
		let prevTier = -1;
		for (const m of messages) {
			const t = m[0];
			const tier = tierOf(t);
			if (tier < prevTier) monotone = false;
			if (tier === 3 || tier === 4) hasSettleSlice = true;
			if (t === DIRTY) hasDirty = true;
			else if (t === COMPLETE || t === ERROR) hasTerminalLifecycle = true;
			else if (t === TEARDOWN) hasTeardown = true;
			if (t === INVALIDATE) invalidateCount++;
			prevTier = tier;
		}
		let sorted: Messages = messages;
		if (!monotone) {
			// Stable sort via index-keyed decoration.
			const indexed = messages.map((m, i) => ({ m, i, tier: tierOf(m[0]) }));
			indexed.sort((a, b) => a.tier - b.tier || a.i - b.i);
			sorted = indexed.map((x) => x.m);
		}
		// DS-13.5.A §2.4a merge rules — INVALIDATE wins by natural tier-sort.
		// With INVALIDATE at tier 4 (after tier-3 DATA/RESOLVED), the sorted
		// wave walks DIRTY → DATA(v) → INVALIDATE. `_updateState` advances
		// `_cached` to v on DATA, then INVALIDATE clears it back to
		// `undefined`. Final cache state matches user intent: a wave that
		// carries an INVALIDATE leaves the cache cleared, regardless of
		// whether DATA/RESOLVED also rode the same wave. Subscribers observe
		// the full sequence (`[DIRTY, DATA(v), INVALIDATE]` etc.) so they
		// can distinguish "we got a value briefly then it was invalidated"
		// from "no DATA arrived this wave."
		//
		// Q9 — INVALIDATE + INVALIDATE collapse to one. Idempotent: multiple
		// INVALIDATEs in the same wave express the same intent; collapsing
		// keeps the wire compact and prevents duplicate cleanup-hook firing.
		if (invalidateCount > 1) {
			let firstInvalidateKept = false;
			const merged: Message[] = [];
			for (const m of sorted) {
				if (m[0] === INVALIDATE) {
					if (firstInvalidateKept) continue;
					firstInvalidateKept = true;
				}
				merged.push(m);
			}
			sorted = merged as unknown as Messages;
		}
		// DIRTY auto-prefix (§1.3.1 + DS-13.5.A Q15 extension to tier-4).
		// Triggers when the wave carries any settle-class payload (tier-3
		// DATA/RESOLVED OR tier-4 INVALIDATE) and the node isn't already
		// in `dirty` status.
		if (hasSettleSlice && !hasDirty && this._status !== "dirty") {
			// Insert DIRTY after any tier-0 START entries to preserve
			// monotonicity.
			let insertAt = 0;
			while (insertAt < sorted.length && tierOf(sorted[insertAt][0]) === 0) insertAt++;
			sorted =
				insertAt === 0
					? [DIRTY_MSG, ...sorted]
					: [...sorted.slice(0, insertAt), DIRTY_MSG, ...sorted.slice(insertAt)];
		}
		// DS-13.5.A Q16: TEARDOWN auto-precedes with [COMPLETE] when the node
		// hasn't yet emitted a terminal lifecycle signal AND no terminal
		// signal is already present in this wave. Idempotent via
		// `_teardownDone` so redundant TEARDOWN deliveries don't re-fire.
		// Sentinel-status state nodes still get the prefix — bridge
		// subscribers need the COMPLETE to settle on streams that never
		// delivered DATA.
		if (hasTeardown && !hasTerminalLifecycle && !this._teardownDone && !this._isTerminal) {
			let teardownIdx = 0;
			while (teardownIdx < sorted.length && sorted[teardownIdx][0] !== TEARDOWN) teardownIdx++;
			sorted =
				teardownIdx === 0
					? [COMPLETE_MSG, ...sorted]
					: [...sorted.slice(0, teardownIdx), COMPLETE_MSG, ...sorted.slice(teardownIdx)];
		}
		return sorted;
	}

	// --- Emit pipeline ---

	/**
	 * @internal The unified dispatch waist — one call = one wave.
	 * See `GRAPHREFLY-SPEC.md` §1.3.1 for protocol context — the stages
	 * below are the implementation order.
	 *
	 * Pipeline stages, in order:
	 *
	 *   1. Terminal filter — post-COMPLETE/ERROR only TEARDOWN/INVALIDATE
	 *      still propagate so graph teardown and cache-clear still work.
	 *   2. Tier sort (stable) — the batch can be in any order when it
	 *      arrives; the walker downstream (`downWithBatch`) assumes
	 *      ascending tier monotone, and so does `_updateState`'s tier-3
	 *      slice walk. This is the single source of truth for ordering.
	 *   3. Synthetic DIRTY prefix — if a tier-3 payload is present, no
	 *      DIRTY is already in the batch, and the node isn't already in
	 *      `"dirty"` status, prepend `[DIRTY]` after any tier-0 START
	 *      entries. Guarantees spec §1.3.1 (DIRTY precedes DATA within
	 *      the same batch) uniformly across every entry point.
	 *   4. PAUSE/RESUME lock bookkeeping (C0) — update `_pauseLocks`,
	 *      derive `_paused`, filter unknown-lockId RESUME, replay
	 *      bufferAll buffer on final lock release.
	 *   5. Meta TEARDOWN fan-out — notify meta children before
	 *      `_updateState`'s TEARDOWN branch calls `_deactivate`. Hoisted
	 *      out of the walk to keep `_updateState` re-entrance-free.
	 *   6. `_updateState` — walk the batch in tier order, advancing
	 *      `_cached` / `_status` / `_versioning` and running equals
	 *      substitution on tier-3 DATA (§3.5.1). Returns
	 *      `{finalMessages, equalsError?}`.
	 *   7. `downWithBatch` dispatch (or bufferAll capture if paused with
	 *      `pausable: "resumeAll"`).
	 *   8. Recursive ERROR emission if equals threw mid-walk.
	 */
	_emit(messages: Messages): void {
		if (messages.length === 0) return;

		// Spec §1.2 — `[ERROR, payload]` requires a non-`undefined` payload.
		// `undefined` is reserved as the protocol-internal "never sent" sentinel
		// and would collide with `DepRecord.terminal === undefined` ("dep is
		// live"), making the ERROR indistinguishable from no termination at
		// downstream sinks and breaking the `_maybeAutoTerminalAfterWave`
		// ERROR-propagation check (`d.terminal !== undefined`). Reject at the
		// dispatch boundary with a developer-facing error — pass real error
		// values (`new Error(reason)` / domain-tag strings).
		for (let i = 0; i < messages.length; i++) {
			const m = messages[i];
			if (m[0] === ERROR && m[1] === undefined) {
				throw new TypeError(
					`[ERROR, payload] requires a non-undefined payload (spec §1.2). Pass an Error object or domain tag instead — e.g. node.down([[ERROR, new Error("reason")]])`,
				);
			}
		}

		// Terminal filter: after COMPLETE/ERROR (non-resubscribable), only
		// TEARDOWN / INVALIDATE still propagate so graph teardown and cache-
		// clear still work.
		let deliverable = messages;
		const terminal = this._isTerminal;
		if (terminal && !this._resubscribable) {
			const pass = messages.filter((m) => m[0] === TEARDOWN || m[0] === INVALIDATE);
			if (pass.length === 0) return;
			deliverable = pass;
		}

		// Tier sort + synthetic DIRTY prefix (stages 3 + 4 of the emit
		// pipeline). `_frameBatch` is a no-op for pre-sorted single-msg
		// batches (the common case from the tuple-interning A2 call sites);
		// otherwise it produces a stable tier-sorted copy with `[DIRTY]`
		// auto-prepended after any tier-0 messages when a tier-3 payload
		// is present and the node isn't already dirty.
		deliverable = this._frameBatch(deliverable);

		// C0 — PAUSE/RESUME lock tracking. Every tier-2 tuple MUST carry a
		// `lockId` payload. Each PAUSE / RESUME updates `_pauseLocks` and
		// derives `_paused` from set size — multi-pauser correctness
		// guarantees a node only resumes when every lock it holds is
		// released. All tier-2 messages are forwarded unconditionally so
		// downstream nodes on the propagation path keep their own lock
		// sets consistent (subscribers that joined the graph before any
		// PAUSE see the full lock history). `pausable: false` sources
		// forward PAUSE/RESUME but do not track locks — appropriate for
		// reactive timers that must keep ticking. Unknown-lockId RESUME
		// is swallowed to keep `dispose()` idempotent.
		let filtered: Message[] | null = null;
		for (let i = 0; i < deliverable.length; i++) {
			const m = deliverable[i];
			const t = m[0];
			if (t !== PAUSE && t !== RESUME) {
				if (filtered != null) filtered.push(m);
				continue;
			}
			if (m.length < 2) {
				throw new Error(
					`Node "${this.name}": [[${t === PAUSE ? "PAUSE" : "RESUME"}]] must ` +
						"carry a lockId payload — bare PAUSE/RESUME is a protocol " +
						"violation (C0 rule). Use `[[PAUSE, lockId]]` / " +
						"`[[RESUME, lockId]]`.",
				);
			}
			let forward = true;
			if (this._pausable !== false) {
				const lockId = m[1];
				if (t === PAUSE) {
					const wasPaused = this._paused;
					if (this._pauseLocks == null) this._pauseLocks = new Set();
					this._pauseLocks.add(lockId);
					this._paused = true;
					if (this._pausable === "resumeAll" && this._pauseBuffer == null) {
						this._pauseBuffer = [];
					}
					// Lock 6.A: track pause-cycle start for `lockHeldDurationMs`
					// in overflow diagnostics. First lock starts the cycle;
					// subsequent locks while already paused don't reset.
					if (!wasPaused) {
						this._pauseStartNs = monotonicNs();
						this._pauseDroppedCount = 0;
						this._pauseOverflowed = false;
					}
				} else {
					// RESUME
					if (this._pauseLocks == null || !this._pauseLocks.has(lockId)) {
						// Unknown lockId — swallow to keep dispose idempotent.
						forward = false;
					} else {
						this._pauseLocks.delete(lockId);
						if (this._pauseLocks.size === 0) {
							this._paused = false;
							// Lock 2.C / 2.C′ (Phase 13.6.A): replay buffered
							// waves through `_emit` BEFORE forwarding RESUME so
							// subscribers observe the deferred settle slices
							// as part of the pre-RESUME wake-up.
							//
							// One `_emit(wave)` per buffered wave preserves
							// Lock 1.D wave-content invariants across the
							// pause boundary: multi-DATA waves stay
							// multi-DATA (no equals substitution; spec §1.3.3
							// + Lock 1.D); single-DATA waves see equals
							// against the cache shaped by all prior buffered
							// waves having "happened" in the conceptual
							// timeline; single-RESOLVED and single-INVALIDATE
							// waves replay verbatim. The pre-13.6.A flat
							// `Message[]` buffer + per-message replay would
							// collapse multi-DATA waves into per-DATA single-
							// DATA waves, wrongly applying equals substitution
							// (Lock 2.C′ refactor target).
							//
							// D2 (2026-04-13) semantic note: each `_emit(...)`
							// goes through `_updateState` including equals
							// substitution. A buffered single-DATA wave whose
							// value matches `_cached` (set during the
							// original wave's mid-pause processing) collapses
							// to RESOLVED on replay — producer "pulses" that
							// write the same value while paused are absorbed.
							// Producers that need pulse semantics (every
							// write observable regardless of value) should
							// set `equals: () => false` on the node.
							if (this._pauseBuffer != null && this._pauseBuffer.length > 0) {
								const drain = this._pauseBuffer;
								this._pauseBuffer = [];
								for (const wave of drain) {
									this._emit(wave);
								}
							}
							// Lock 6.A: clear the pause-cycle bookkeeping so
							// the next pause cycle starts with a fresh
							// dropped-count + overflow flag.
							//
							// Re-pause guard: if a downstream subscriber's
							// reaction to one of the replayed waves issued an
							// `up.pause(lockId2)` mid-drain — re-entering the
							// node into a NEW pause cycle whose
							// `_pauseStartNs` was just initialised by the
							// `wasPaused === false` check above — clearing
							// here would clobber the fresh cycle's
							// bookkeeping. Only clear when the node has
							// genuinely exited the paused state.
							if (!this._paused) {
								this._pauseStartNs = undefined;
								this._pauseDroppedCount = 0;
								this._pauseOverflowed = false;
							}
							// Kick the held wave forward if one was pending.
							if (this._pendingWave) {
								this._pendingWave = false;
								this._maybeRunFnOnSettlement();
							}
						}
					}
				}
			}
			if (!forward) {
				if (filtered == null) filtered = deliverable.slice(0, i) as Message[];
			} else if (filtered != null) {
				filtered.push(m);
			}
		}
		if (filtered != null) {
			if (filtered.length === 0) return;
			deliverable = filtered;
		}

		// Meta TEARDOWN fan-out happens BEFORE `_updateState` so the walk
		// stays re-entrance-free: a meta node's own dispatch must not
		// re-enter the parent's outgoing pipeline while `this._cached` /
		// `this._status` are mid-commit. This preserves the spec ordering
		// "meta propagates before deactivation" — `_updateState`'s TEARDOWN
		// branch still runs `_deactivate` AFTER the meta children
		// have already been notified here.
		if (this._hasMeta && deliverable.some((m) => m[0] === TEARDOWN)) {
			for (const k of Object.keys(this.meta)) {
				try {
					(this.meta[k] as NodeImpl)._emit(TEARDOWN_ONLY_BATCH);
				} catch {
					/* best-effort */
				}
			}
		}

		// State update + equals substitution (§3.5.1 invariant). Returns the
		// possibly-rewritten batch and an optional equals-throw error. When
		// equals throws mid-walk we still deliver the successfully-walked
		// prefix to sinks before emitting ERROR, preserving cache/wire
		// coherence (user P2 option (i)).
		const { finalMessages, equalsError } = this._updateState(deliverable);

		// Global inspector fan-out (Redux-DevTools-style tracer). Fires once
		// per outgoing batch, gated by `inspectorEnabled` so production paths
		// pay one boolean check. Hook errors are swallowed — instrumentation
		// must not break the data plane.
		if (finalMessages.length > 0 && this._config.inspectorEnabled) {
			const inspector = this._config.globalInspector;
			if (inspector != null) {
				try {
					inspector({ kind: "emit", node: this, messages: finalMessages });
				} catch {
					/* best-effort */
				}
			}
		}

		if (finalMessages.length > 0) {
			// BufferAll: while paused with `pausable: "resumeAll"`, buffer
			// the settle slice — tier-3 (DATA/RESOLVED) and tier-4 (INVALIDATE,
			// per DS-13.5.A Q7) — as one **wave entry** per `_emit` call,
			// preserving wave shape for replay (Lock 2.C + 2.C′ + 2.C′-pre).
			// Everything else — tier 0–2 (START/DIRTY/PAUSE/RESUME), tier 5
			// (COMPLETE/ERROR), and tier 6 (TEARDOWN) — dispatches
			// synchronously so subscribers, downstream pausers, and graph
			// teardown observe them regardless of flow control. Tier-5
			// stream-lifecycle signals must reach subscribers even when a
			// controller holds a lock and never issues RESUME — the
			// alternative strands observers without an end-of-stream signal
			// (leaked-controller + source-terminates = subscriber waits
			// indefinitely). Cache/status advance has already happened via
			// `_updateState`, so the replay later just re-walks the deferred
			// wave through `_emit` (which calls `_updateState` again,
			// idempotently advancing cache to the same value). Spec §2.6
			// bufferAll.
			if (this._paused && this._pausable === "resumeAll" && this._pauseBuffer != null) {
				const tierOf = this._config.tierOf;
				const settleSlice: Message[] = [];
				const immediate: Message[] = [];
				for (const m of finalMessages) {
					const tier = tierOf(m[0]);
					if (tier === 3 || tier === 4) {
						settleSlice.push(m);
					} else {
						immediate.push(m);
					}
				}
				if (settleSlice.length > 0) {
					this._pauseBuffer.push(settleSlice as Messages);
					// Lock 6.A: enforce the configured cap. Drop oldest
					// waves while over-cap; emit one ERROR per pause cycle
					// (gated on `_pauseOverflowed`) carrying cumulative
					// drop count so a producer pushing thousands of waves
					// over the cap doesn't spam ERROR.
					const max = this._config.pauseBufferMax;
					if (this._pauseBuffer.length > max) {
						const dropped = this._pauseBuffer.length - max;
						this._pauseBuffer.splice(0, dropped);
						this._pauseDroppedCount += dropped;
						if (!this._pauseOverflowed) {
							this._pauseOverflowed = true;
							const lockHeldDurationMs =
								this._pauseStartNs != null
									? Math.trunc((monotonicNs() - this._pauseStartNs) / 1_000_000)
									: 0;
							// Build the overflow error directly (no
							// `_wrapFnError` wrapping — that would double the
							// `Node "X":` prefix that the inner message
							// already carries).
							const overflowError = new Error(
								`Node "${this.name ?? "<unnamed>"}": pause-replay buffer ` +
									`exceeded pauseBufferMax (${max} waves) — dropping oldest ` +
									"buffered wave(s). Bump `cfg.pauseBufferMax` if a higher " +
									"sustained backlog is expected, or release pause locks " +
									"sooner.",
							);
							(overflowError as Error & { detail?: unknown }).detail = {
								nodeId: this.name,
								droppedCount: this._pauseDroppedCount,
								configuredMax: max,
								lockHeldDurationMs,
							};
							// Lock 6.A semantic: "The error propagates
							// downstream per default error semantics (rule
							// 1.4)." Rule 1.4 makes ERROR a terminal
							// lifecycle signal — the source transitions to
							// `"errored"` and stops accepting further DATA.
							// Route through a recursive `_emit` so the ERROR
							// goes through `_updateState` (which sets
							// `_status = "errored"`) and the standard
							// terminal-message dispatch path. The recursive
							// call dispatches synchronously even while paused
							// (tier-5 bypasses the buffer below).
							//
							// Buffered waves still pending in `_pauseBuffer`
							// remain there; they will NOT replay because
							// post-terminal `_emit` is a no-op for non-
							// terminal-class messages. This is a design
							// trade-off: heavy-hand termination on overflow
							// guarantees no silent shedding past the first
							// drop. Bump `cfg.pauseBufferMax` if your
							// producer's sustained pause backlog exceeds the
							// default 10_000.
							this._emit([[ERROR, overflowError]]);
						}
					}
				}
				if (immediate.length > 0) {
					this._dispatchOrAccumulate(immediate);
				}
			} else {
				// Lock 6.G (spec §2.5): push outgoing DATA into the replay
				// buffer at the dispatch point — NOT inside `_updateState`.
				// Reasoning: the spec mandates "last N **outgoing** DATA",
				// i.e. values subscribers actually observed. Pushing inside
				// `_updateState` would (a) count cache-advances mid-pause
				// (which never reach sinks) and (b) re-push during RESUME
				// drain when buffered waves are replayed through `_emit`
				// and re-walk the cache. Both would corrupt the
				// "values-seen" semantic. Pause-buffered tier-3 traffic
				// reaches this branch only after RESUME drain dispatches
				// it, at which point it gets pushed correctly.
				this._pushReplayBuffer(finalMessages);
				this._dispatchOrAccumulate(finalMessages);
			}
		}

		if (equalsError != null) {
			this._emit([[ERROR, equalsError]]);
		}
	}

	/**
	 * @internal Walk an outgoing (already-framed) batch, updating own
	 * cache / status / versioning and running equals substitution on
	 * every tier-3 DATA (§3.5.1). Framing — tier sort and synthetic
	 * DIRTY prefix — has already happened upstream in `_frameBatch`.
	 * This walk trusts the input is in monotone tier order and that the
	 * spec §1.3.1 DIRTY/RESOLVED precedence invariant is already
	 * satisfied by the frame.
	 *
	 * Equals substitution: every DATA payload is compared against the
	 * live `_cached`; when equal, the tuple is rewritten to `[RESOLVED]`
	 * in a per-call copy and cache is not re-advanced. `.cache` remains
	 * coherent with "the last DATA payload this node actually sent
	 * downstream".
	 *
	 * Returns `{ finalMessages, equalsError? }`:
	 * - `finalMessages` — the array to deliver to sinks (may be
	 *   `messages` unchanged, a rewritten copy with DATA→RESOLVED
	 *   substitutions, or a truncated prefix when equals throws mid-walk).
	 * - `equalsError` — present only when the configured `equals` function
	 *   threw on some DATA message. `_emit` delivers the prefix first,
	 *   then emits a fresh ERROR batch via a recursive `_emit` call so
	 *   subscribers observe `[...walked_prefix, ERROR]` in order.
	 */
	private _updateState(messages: Messages): {
		finalMessages: Messages;
		equalsError?: Error;
	} {
		const tierOf = this._config.tierOf;
		let rewritten: Message[] | undefined;
		let equalsError: Error | undefined;
		let abortedAt = -1;
		// Count tier-3 messages (DATA + RESOLVED) in the batch. Equals
		// substitution is only worthwhile for a single tier-3 message —
		// an unchanged value can be rewritten to RESOLVED, enabling the
		// downstream pre-fn skip. With multiple tier-3 messages the
		// downstream fn must run regardless, so equals on each is wasted.
		let dataCount = 0;
		for (const m of messages) {
			if (tierOf(m[0]) === 3) dataCount++;
		}
		const checkEquals = dataCount <= 1;
		// Version advances once per batch wave, not per DATA in the batch.
		// _cached only retains the last DATA value, so intermediate version
		// entries would reference values that can never be retrieved from cache.
		// Pre-scan for the last DATA index so we know when to fire advanceVersion.
		let lastDataIdx = -1;
		if (this._versioning != null && dataCount > 1) {
			for (let i = messages.length - 1; i >= 0; i--) {
				if (messages[i][0] === DATA) {
					lastDataIdx = i;
					break;
				}
			}
		}

		for (let i = 0; i < messages.length; i++) {
			const m = messages[i];
			const t = m[0];
			if (t === DATA) {
				if (m.length >= 2) {
					let unchanged = false;
					if (checkEquals && this._cached !== undefined) {
						try {
							unchanged = this._equals(this._cached as T, m[1] as T);
						} catch (err) {
							// Lock 2.A (Phase 13.6.A): branch on
							// `cfg.equalsThrowPolicy`.
							//
							// `"rethrow"` (dev default) — abort the walk,
							// deliver the successfully-walked prefix, then
							// `_emit` emits a fresh ERROR batch annotated with
							// node id + wave context. The buggy `equals`
							// surfaces immediately to the developer.
							//
							// `"log-and-continue"` (prod default) — log once
							// per node lifetime, treat as `unchanged === false`
							// (emit DATA verbatim; the wire stays alive). One
							// bad equals doesn't kill the wave or cascade an
							// ERROR through every downstream consumer.
							if (this._config.equalsThrowPolicy === "log-and-continue") {
								if (!this._equalsErrorLogged) {
									this._equalsErrorLogged = true;
									console.error(
										`Node "${this.name ?? "<unnamed>"}": equals threw — falling back to verbatim emit. ` +
											"Subsequent equals throws on this node will be silently ignored. " +
											'Set `cfg.equalsThrowPolicy = "rethrow"` to surface them.',
										err,
									);
								}
								// unchanged stays false → fall through to the
								// DATA emission path below, which advances cache
								// and emits the value verbatim.
							} else {
								equalsError = this._wrapFnError("equals threw", err);
								abortedAt = i;
								break;
							}
						}
					}
					if (unchanged) {
						if (rewritten == null) rewritten = messages.slice(0, i) as Message[];
						rewritten.push(RESOLVED_MSG);
						this._status = "resolved";
						continue;
					}
					this._cached = m[1] as T;
					if (this._versioning != null) {
						// dataCount <= 1: lastDataIdx is -1; advance unconditionally
						// (single DATA, correct as before).
						// dataCount > 1: only advance on the last DATA in the batch.
						if (lastDataIdx < 0 || i === lastDataIdx) {
							advanceVersion(this._versioning, m[1], this._hashFn);
						}
					}
				}
				this._status = "settled";
				if (rewritten != null) rewritten.push(m);
			} else {
				if (rewritten != null) rewritten.push(m);
				if (t === DIRTY) {
					this._status = "dirty";
				} else if (t === RESOLVED) {
					this._status = "resolved";
				} else if (t === COMPLETE) {
					this._status = "completed";
					// Rigor-infra ghost-state hook (TLC #25 mirror): classify
					// the terminal transition. `hasDeps === true && _autoComplete
					// === true` ≈ TLA+ "dep-cascade-complete"; otherwise
					// "self-source-terminate". Zero production cost when unset.
					{
						const rec = this._config.rigorRecorder;
						if (rec != null) {
							try {
								rec.onTerminalTransition(
									this,
									"completed",
									this._autoComplete,
									this._autoError,
									this._deps.length > 0,
								);
							} catch {
								/* best-effort */
							}
						}
					}
				} else if (t === ERROR) {
					this._status = "errored";
					// Rigor-infra ghost-state hook (TLC #25 mirror): same shape
					// as the COMPLETE branch above, classifying ERROR.
					{
						const rec = this._config.rigorRecorder;
						if (rec != null) {
							try {
								rec.onTerminalTransition(
									this,
									"errored",
									this._autoComplete,
									this._autoError,
									this._deps.length > 0,
								);
							} catch {
								/* best-effort */
							}
						}
					}
				} else if (t === INVALIDATE) {
					// Rigor-infra ghost-state hook (TLC #19 / #24 / #26 mirrors):
					// record the non-vacuous INVALIDATE site — the pre-reset
					// `_cached` is the cleanup-witness value. Covers both the
					// dep-cascade path (`_onDepMessage` INVALIDATE handler,
					// which delegates here via `_emit(INVALIDATE_ONLY_BATCH)`)
					// and the direct-origination path (`.down([[INVALIDATE]])`
					// on a source or mid-chain node). Guarded on `_cached !==
					// undefined` so vacuous invalidates (diamond fan-in second
					// arrival, already-reset node) don't fire. Zero production
					// cost when `rigorRecorder` is unset.
					if (this._cached !== undefined) {
						const rec = this._config.rigorRecorder;
						if (rec != null) {
							try {
								rec.onNonVacuousInvalidate(this, this._cached);
							} catch {
								/* best-effort — instrumentation must not break data plane */
							}
						}
					}
					// DS-13.5.A pass-3 (N1 fix): INVALIDATE on a
					// terminal-resubscribable node is a lifecycle boundary —
					// run the full lifecycle reset so any subscribers that
					// kept the node alive past terminal (multi-sub case where
					// `_deactivate` did NOT run) don't carry stale
					// `_hasCalledFnOnce` / `_dirtyDepCount` / DepRecord state
					// into the next wave. Without this, fn computes against
					// ghost `prevData` after INVALIDATE clears caches.
					// `_resetForFreshLifecycle` clears `_cached` + sets status
					// to `"sentinel"` itself, so this is the single
					// state-mutation entry on the resubscribable path.
					if (this._isTerminal && this._resubscribable) {
						this._resetForFreshLifecycle();
					} else {
						this._cached = undefined;
						// DS-13.5.A: INVALIDATE is settle-class (decrements
						// `_dirtyDepCount` on consumers like RESOLVED). It
						// does NOT leave the emitting node in `"dirty"`
						// status — `"dirty"` means "value about to change"
						// but INVALIDATE has just cleared the cache outright
						// with no new value pending. Transition to
						// `"sentinel"` ("no value, nothing pending").
						// Critically, `defaultOnSubscribe`'s
						// push-on-subscribe sees `"sentinel"` + `_cached ===
						// undefined` and pushes only `[START]` to new
						// subscribers, rather than `[START, DIRTY]` for
						// `"dirty"` status — that DIRTY-inheritance was the
						// regression source for agentLoop's abort path (a
						// freshly-attached `_terminalResult` had its
						// `lastResponseState` dep slot permanently dirty,
						// never settled, fn never re-ran).
						this._status = "sentinel";
					}
					// Cleanup firing on INVALIDATE — fires the `onInvalidate`
					// hook (Lock 4.A). The cleanup object itself is preserved
					// so `onDeactivation` still fires later if the node
					// deactivates; the `onInvalidate` slot is nulled before
					// invocation so:
					//   (a) a throw inside the hook doesn't leave it armed for
					//       a second fire (consistent with `onRerun`'s
					//       null-out-on-fire pattern in `_execFn`);
					//   (b) when an INVALIDATE wave is buffered through
					//       `pausable: "resumeAll"` and replayed on RESUME
					//       (Lock 2.C′-pre), the replay walk's INVALIDATE does
					//       NOT re-fire the hook a second time;
					//   (c) two INVALIDATE waves arriving without a fn rerun
					//       between them (rare cross-wave case) only fire the
					//       hook once — semantically correct since the second
					//       INVALIDATE arrives at an already-`"sentinel"` node
					//       with `_cached === undefined`.
					// Function-form shorthand still fires here too
					// (transitional, see `NodeFnCleanup` doc; tracked for
					// removal in `docs/optimizations.md`).
					const c = this._cleanup;
					if (typeof c === "function") {
						this._cleanup = undefined;
						try {
							c();
						} catch {
							/* best-effort */
						}
					} else if (c != null) {
						const hook = c.onInvalidate;
						if (typeof hook === "function") {
							c.onInvalidate = undefined;
							try {
								hook();
							} catch {
								/* best-effort */
							}
						}
					}
				} else if (t === TEARDOWN) {
					if (this._resetOnTeardown) this._cached = undefined;
					// Meta TEARDOWN fan-out was already performed by `_emit`
					// before this walk. Deactivate now that meta children
					// have been notified.
					this._deactivate(/* skipStatusUpdate */ true);
					// TEARDOWN is a hard reset — unconditionally "sentinel",
					// even if the node was previously completed/errored.
					this._status = "sentinel";
					// DS-13.5.A Q16 idempotency: subsequent TEARDOWN deliveries
					// must not re-fire the synthetic [COMPLETE] auto-prefix.
					this._teardownDone = true;
				}
			}
		}

		const base: Messages =
			abortedAt >= 0
				? ((rewritten ?? (messages.slice(0, abortedAt) as Messages)) as Messages)
				: (rewritten ?? messages);
		return equalsError != null ? { finalMessages: base, equalsError } : { finalMessages: base };
	}

	/**
	 * @internal Lock 6.G (spec §2.5) — append outgoing DATA payloads from
	 * `finalMessages` into `_replayBuffer`, dropping oldest on overflow.
	 * No-op when `_replayBufferCapacity === 0`. RESOLVED entries are NOT
	 * pushed (only DATA), per spec.
	 *
	 * Allocates the buffer lazily on first push so unused-buffer nodes
	 * (the common case) pay no per-instance allocation cost.
	 */
	private _pushReplayBuffer(finalMessages: Messages): void {
		if (this._replayBufferCapacity === 0) return;
		for (const m of finalMessages) {
			if (m[0] !== DATA || m.length < 2) continue;
			if (this._replayBuffer == null) this._replayBuffer = [];
			this._replayBuffer.push(m[1] as T);
			// Drop-oldest on overflow. `shift()` is O(N) but N is the
			// configured capacity (typical 1–50); for larger N a true ring
			// buffer with head/tail pointers would beat this — flag in
			// optimizations.md if a workload demands it.
			if (this._replayBuffer.length > this._replayBufferCapacity) {
				this._replayBuffer.shift();
			}
		}
	}

	private _deliverToSinks = (messages: Messages): void => {
		if (this._sinks == null) return;
		if (typeof this._sinks === "function") {
			this._sinks(messages);
			return;
		}
		// Snapshot: a sink callback may unsubscribe itself or others
		// mid-iteration. Iterating the live Set would skip not-yet-visited
		// sinks that were removed.
		const snapshot = [...this._sinks];
		for (const sink of snapshot) sink(messages);
	};

	/**
	 * @internal Dispatch entry point that respects the per-batch emit
	 * accumulator (Bug 2). Inside an explicit `batch()` scope, append to
	 * `_batchPendingMessages` and register a flush hook on first append.
	 * Outside batch — or during a drain (where `flushInProgress` is true
	 * but `batchDepth` is 0) — dispatch synchronously through `downWithBatch`.
	 *
	 * Per-emit state updates (`_frameBatch`, `_updateState`) have already
	 * happened by the time we reach here; only the **downstream delivery**
	 * is coalesced. Cache, version, and status are visible mid-batch on
	 * the emitting node itself.
	 */
	private _dispatchOrAccumulate(messages: Messages): void {
		if (isExplicitlyBatching()) {
			if (this._batchPendingMessages === null) {
				this._batchPendingMessages = [];
				registerBatchFlushHook(() => this._flushBatchPending());
			}
			for (const m of messages) this._batchPendingMessages.push(m);
			return;
		}
		downWithBatch(this._deliverToSinks, messages, this._config.tierOf);
	}

	/**
	 * @internal Flushes the accumulated batch through `downWithBatch` and
	 * clears the pending state. Idempotent — safe to call when pending is
	 * already null or empty (e.g. on a `batch()` throw, where the hook
	 * fires for cleanup but the drainPhase queues are wiped after).
	 *
	 * Critical: the accumulated batch is interleaved per-emit framings like
	 * `[DIRTY, DATA(1), DIRTY, DATA(2)]` — non-monotone tier order. We must
	 * re-frame to sort by tier before handing to `downWithBatch`, which
	 * assumes pre-sorted input. `_frameBatch` also handles the synthetic
	 * DIRTY prepend rule (no-op here — `hasDirty` is true since each
	 * accumulated emit already carries its own DIRTY prefix).
	 */
	private _flushBatchPending(): void {
		const pending = this._batchPendingMessages;
		if (pending === null) return;
		this._batchPendingMessages = null;
		if (pending.length === 0) return;
		const framed = this._frameBatch(pending);
		downWithBatch(this._deliverToSinks, framed, this._config.tierOf);
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const isNodeArray = (value: unknown): value is readonly Node[] => Array.isArray(value);
const isNodeOptionsObject = (value: unknown): value is NodeOptions<unknown> =>
	typeof value === "object" && value != null && !Array.isArray(value);

/**
 * Creates a reactive {@link Node} — the single GraphReFly primitive (§2).
 *
 * Typical shapes:
 * - `node([])` / `node({ initial: v })` — a manual source (state node).
 * - `node(producerFn, opts)` — a producer that runs on first-subscribe.
 * - `node(deps, computeFn, opts)` — a derived / effect node.
 *
 * For value-returning computations, prefer the sugar factories in `sugar.ts`
 * (`state`, `derived`, `effect`, `producer`, `dynamicNode`), which wrap user
 * fns with `actions.emit(userFn(data))`. Calling `node()` directly gives you
 * the raw `NodeFn` contract: explicit emission via `actions`, cleanup return.
 */
export function node<T = unknown>(
	depsOrFn?: readonly Node[] | NodeFn | NodeOptions<T>,
	fnOrOpts?: NodeFn | NodeOptions<T>,
	optsArg?: NodeOptions<T>,
): Node<T> {
	const deps: readonly Node[] = isNodeArray(depsOrFn) ? depsOrFn : [];
	const fn: NodeFn | undefined =
		typeof depsOrFn === "function"
			? depsOrFn
			: typeof fnOrOpts === "function"
				? fnOrOpts
				: undefined;
	let opts: NodeOptions<T> = {};
	if (isNodeArray(depsOrFn)) {
		opts = ((isNodeOptionsObject(fnOrOpts) ? fnOrOpts : optsArg) ?? {}) as NodeOptions<T>;
	} else if (isNodeOptionsObject(depsOrFn)) {
		opts = depsOrFn as NodeOptions<T>;
	} else {
		opts = ((isNodeOptionsObject(fnOrOpts) ? fnOrOpts : optsArg) ?? {}) as NodeOptions<T>;
	}
	return new NodeImpl<T>(deps, fn, opts);
}
