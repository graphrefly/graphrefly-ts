/**
 * `NodeImpl` — the single GraphReFly node primitive.
 *
 * Consolidates the old `NodeBase` + `NodeImpl` + `DynamicNodeImpl` hierarchy
 * (§8.1) into one class. Per-dep state lives in a `DepRecord[]` (§8.2)
 * instead of 4 BitSets + `_lastDepValues` + `_upstreamUnsubs`.
 *
 * This file also owns the default singleton handlers (`defaultBundle`,
 * `defaultOnMessage`, `defaultOnSubscribe`), the `defaultConfig` instance,
 * and the public `configure(...)` entry point. They live here because their
 * bodies touch `NodeImpl` internals; `config.ts` stays NodeImpl-agnostic.
 *
 * See GRAPHREFLY-SPEC §2 and COMPOSITION-GUIDE §1/§9 for the behavior
 * contract. See SESSION-foundation-redesign.md §§1–10 for design history.
 */

import type { Actor } from "./actor.js";
import { normalizeActor } from "./actor.js";
import { downWithBatch } from "./batch.js";
import { wallClockNs } from "./clock.js";
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
 * Module-local "no cached value" sentinel. Kept internal — do NOT re-export
 * in `index.ts`. External callers use `node.status === "sentinel"` to detect
 * absence of cache.
 */
const NO_VALUE: unique symbol = Symbol.for("graphrefly/NO_VALUE");
type NoValue = typeof NO_VALUE;

/**
 * Maximum `_pendingRerun` depth before we give up and emit ERROR. Bounds
 * autoTrackNode / `_addDep` discovery loops — a well-formed discovery
 * converges in O(n) total rounds for n deps, so 100 is ample.
 */
const MAX_RERUN_DEPTH = 100;

/**
 * Internal "cached or sentinel" type for `_cached` and per-dep `latestData`.
 * The sentinel slot is only visible inside the core layer.
 */
type Cached<T> = T | NoValue;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Lifecycle status of a node (GRAPHREFLY-SPEC §2.2). */
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
 *   the per-dep `latestData` snapshot that will be passed to fn.
 */
export type NodeInspectorHookEvent =
	| { kind: "dep_message"; depIndex: number; message: Message }
	| { kind: "run"; depValues: readonly unknown[] };

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
 * - `() => void` — fires before the next fn run AND on deactivation (default).
 * - `{ deactivation: () => void }` — fires only on deactivation (persistent
 *   resources that should survive across fn re-runs).
 */
export type NodeFnCleanup = (() => void) | { deactivation: () => void };

/**
 * Fn-time context exposing per-wave metadata and a per-node persistent
 * scratch pad.
 *
 * - `dataFrom[i]` — did dep `i` emit DATA this wave (vs RESOLVED)?
 * - `terminalDeps[i]` — runtime shape:
 *   - `undefined` → dep `i` is still live.
 *   - `true` → dep `i` sent COMPLETE.
 *   - anything else → dep `i` sent ERROR, value is the error payload.
 *   Type is `readonly unknown[]` because `true | unknown` collapses to
 *   `unknown` anyway; the three states are documented contract, not type.
 * - `store` — mutable bag that persists across fn runs within one activation
 *   cycle. Wiped on deactivation and on resubscribable terminal reset.
 */
export interface FnCtx {
	readonly dataFrom: readonly boolean[];
	readonly terminalDeps: readonly unknown[];
	readonly store: Record<string, unknown>;
}

/**
 * Compute function passed to `node(deps, fn, opts?)`.
 *
 * fn receives DATA-only inputs (`data[i]` holds dep `i`'s latest DATA
 * payload), never raw Message tuples. Emission is explicit via
 * `actions.emit(v)` (sugar: equals + bundle + down) or `actions.down(msgs)`
 * (raw). Return a cleanup function (or `{ deactivation }`) to register
 * teardown — any non-cleanup return value is ignored. The `| void` leg in
 * the return type lets arrow-block bodies (the common sugar/operator case)
 * satisfy `NodeFn` without an explicit `return undefined`.
 */
export type NodeFn = (
	data: readonly unknown[],
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
	 * Pre-populate the cache at construction. Key presence (`"initial" in opts`)
	 * is what matters — `undefined` and `null` are valid initial values.
	 */
	initial?: T | undefined | null;
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
	 * Tier-2 PAUSE/RESUME handling.
	 * - `true` (default): wave completion suppressed while paused; fn fires
	 *   once on RESUME if gate is satisfied.
	 * - `false`: node ignores PAUSE (sources like timers that must keep running).
	 * - `"resumeAll"`: on RESUME, replay every buffered DATA (future).
	 */
	pausable?: boolean | "resumeAll";
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
	 * `"sentinel"` state (no value ever). `undefined` and `null` are valid
	 * cached values — use `node.status` to distinguish "absent" from
	 * "present but undefined/null".
	 */
	readonly cache: T | undefined | null;
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
	 * {@link down}. Upstream messages are tier <3 + tier 5 only
	 * (DIRTY, INVALIDATE, PAUSE, RESUME, TEARDOWN); tier-3/4 payloads
	 * throw — DATA/RESOLVED/COMPLETE/ERROR are downstream-only in this
	 * protocol. No equals substitution, no cache advance, no DIRTY
	 * auto-prefix — the up direction just forwards to every dep.
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
 * Edge case: an ERROR carrying an `undefined` payload is indistinguishable
 * from "live". Pass meaningful error values (Error objects, domain tags).
 */
export interface DepRecord {
	readonly node: Node;
	unsub: (() => void) | null;
	latestData: Cached<unknown>;
	/** True while awaiting DATA/RESOLVED for the current wave. */
	dirty: boolean;
	/** True if this dep contributed DATA (not RESOLVED) during the current wave. */
	dataThisWave: boolean;
	/** Terminal-state slot — see JSDoc on {@link DepRecord}. */
	terminal: unknown;
}

function createDepRecord(n: Node): DepRecord {
	return {
		node: n,
		unsub: null,
		latestData: NO_VALUE,
		dirty: false,
		dataThisWave: false,
		terminal: undefined,
	};
}

function resetDepRecord(d: DepRecord): void {
	d.latestData = NO_VALUE;
	d.dirty = false;
	d.dataThisWave = false;
	d.terminal = undefined;
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
	const initial: Message[] =
		cached === NO_VALUE ? [START_MSG] : [START_MSG, [DATA, cached] as Message];
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
	_cached: Cached<T>;
	_status: NodeStatus;
	_cleanup: NodeFnCleanup | undefined;
	_store: Record<string, unknown> = {};
	_waveHasNewData = false;
	_hasNewTerminal = false;
	_hasCalledFnOnce = false;
	_paused = false;
	_pendingWave = false;
	_isExecutingFn = false;
	_pendingRerun = false;
	_rerunDepth = 0;

	// --- Settlement counters (A3) ---
	/**
	 * Count of deps currently in `dirty === true`. Maintained by
	 * `_onDepDirtied` / `_onDepSettled` / `_addDep` / `_deactivate` /
	 * `resetDepRecordState`. `_maybeRunFnOnSettlement` treats `0` as
	 * "wave settled" — O(1) replacement for the old `every(!d.dirty)` scan.
	 */
	_dirtyDepCount = 0;
	/**
	 * Count of deps that have NOT yet delivered their first DATA and have
	 * not terminated. `0` means the first-run gate is open — every dep has
	 * contributed. Maintained in lockstep with `DepRecord.latestData` /
	 * `DepRecord.terminal` through the same centralized helpers.
	 */
	_sentinelDepCount = 0;

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
	 * Buffered DATA messages held while paused. Only populated when
	 * `_pausable === "resumeAll"` (bufferAll mode). On final lock release
	 * the buffer is replayed through the node's outgoing pipeline in the
	 * order received. Non-bufferAll pause mode drops DATA on the floor
	 * (upstream is expected to honor PAUSE by suppressing production).
	 */
	_pauseBuffer: Message[] | null = null;

	// --- Options (frozen at construction) ---
	readonly _fn: NodeFn | undefined;
	readonly _equals: (a: T, b: T) => boolean;
	readonly _resubscribable: boolean;
	readonly _resetOnTeardown: boolean;
	readonly _autoComplete: boolean;
	readonly _autoError: boolean;
	readonly _pausable: boolean | "resumeAll";
	readonly _guard: NodeGuard | undefined;
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
	 * @internal Optional per-node inspector hook for `Graph.observe(path,
	 * { causal, derived })`. Fires in `_onDepMessage` and `_execFn`.
	 * Attached via `_setInspectorHook` and removed by the returned disposer.
	 */
	_inspectorHook: NodeInspectorHook | undefined;

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
		this._guard = opts.guard;
		this._fn = fn;

		this._cached = "initial" in opts ? (opts.initial as T) : NO_VALUE;
		// State-with-initial starts "settled"; everything else starts "sentinel".
		this._status =
			deps.length === 0 && fn == null && this._cached !== NO_VALUE ? "settled" : "sentinel";

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
				? createVersioning(versioningLevel, this._cached === NO_VALUE ? undefined : this._cached, {
						id: opts.versioningId,
						hash: this._hashFn,
					})
				: undefined;

		// Per-dep records (replaces 4 BitSets + _lastDepValues + _upstreamUnsubs).
		this._deps = deps.map(createDepRecord);

		// Meta companions (simple state children; inherit config + guard).
		const meta: Record<string, Node> = {};
		for (const [k, v] of Object.entries(opts.meta ?? {})) {
			const metaOpts: NodeOptions<unknown> = {
				initial: v,
				name: `${opts.name ?? "node"}:meta:${k}`,
				describeKind: "state",
				config: this._config,
			};
			if (opts.guard != null) metaOpts.guard = opts.guard;
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
		return this._cached === NO_VALUE ? undefined : (this._cached as T);
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
		const initialValue = this._cached === NO_VALUE ? undefined : this._cached;
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
	 * causal traces. Only one hook is active at a time — attaching a new
	 * one replaces the previous; the disposer restores the previous hook.
	 */
	_setInspectorHook(hook?: NodeInspectorHook): () => void {
		const prev = this._inspectorHook;
		this._inspectorHook = hook;
		return () => {
			if (this._inspectorHook === hook) {
				this._inspectorHook = prev;
			}
		};
	}

	allowsObserve(actor: Actor): boolean {
		if (this._guard == null) return true;
		return this._guard(normalizeActor(actor), "observe");
	}

	// --- Guard helper ---

	private _checkGuard(options?: NodeTransportOptions): void {
		if (options?.internal || this._guard == null) return;
		const actor = normalizeActor(options?.actor);
		const action: GuardAction = options?.delivery === "signal" ? "signal" : "write";
		if (!this._guard(actor, action)) {
			throw new GuardDenied({ actor, action, nodeName: this.name });
		}
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
	 * tier 0–2 and tier 5 (START, DIRTY, INVALIDATE, PAUSE, RESUME,
	 * TEARDOWN). Tier 3 (DATA/RESOLVED) and tier 4 (COMPLETE/ERROR) are
	 * downstream-only. Emitting tier-3/4 via `up` would bypass equals
	 * substitution and cache advance entirely and is a protocol bug.
	 */
	private _validateUpTiers(messages: Messages): void {
		const tierOf = this._config.tierOf;
		for (const m of messages) {
			const tier = tierOf(m[0]);
			if (tier === 3 || tier === 4) {
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
			this._cached = NO_VALUE;
			this._status = "sentinel";
			this._store = {};
			this._hasCalledFnOnce = false;
			this._waveHasNewData = false;
			this._hasNewTerminal = false;
			this._paused = false;
			this._pendingWave = false;
			this._pendingRerun = false;
			this._isExecutingFn = false;
			this._rerunDepth = 0;
			this._dirtyDepCount = 0;
			this._sentinelDepCount = 0;
			// C0: clear pause state so a new subscriber after terminal-reset
			// starts from a clean pause lockset — otherwise a lockId from
			// the previous lifecycle would leave the node stuck paused and
			// swallow every emit.
			this._pauseLocks = null;
			this._pauseBuffer = null;
			for (const d of this._deps) resetDepRecord(d);
		}

		this._sinkCount += 1;

		// Subscribe ceremony via singleton.
		const subCleanup = this._config.onSubscribe(
			this as unknown as NodeCtx,
			sink,
			{ sinkCount: this._sinkCount, afterTerminalReset },
			this._actions,
		);

		// Register sink AFTER START delivery (spec §2.2).
		if (this._sinks == null) {
			this._sinks = sink;
		} else if (typeof this._sinks === "function") {
			this._sinks = new Set<NodeSink>([this._sinks, sink]);
		} else {
			this._sinks.add(sink);
		}

		// First-subscriber activation.
		const isTerminalNow = this._isTerminal;
		if (this._sinkCount === 1 && !isTerminalNow) {
			this._activate();
		}

		// Reflect "activated but no value yet" as pending.
		if (this._status === "sentinel" && this._cached === NO_VALUE) {
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
		// Pre-set every dep as dirty + sentinel BEFORE subscribing — even if
		// the first dep settles synchronously during subscribe, the
		// wave-complete check sees later deps still counted as dirty and
		// holds fn until they settle. Counters are bulk-initialized here
		// so per-dep transitions below (via the centralized helpers)
		// decrement correctly.
		for (const d of this._deps) d.dirty = true;
		this._dirtyDepCount = this._deps.length;
		this._sentinelDepCount = this._deps.length;
		// Capture the initial length BEFORE subscribing. `_addDep` can fire
		// synchronously during a dep's subscribe callback (e.g., via
		// `autoTrackNode` discovery in `_execFn`) and push new DepRecords.
		// Iterating `this._deps.length` live would mean this loop also
		// subscribes the new dep that `_addDep` already subscribed — a
		// double-subscribe bug. Snapshot the length instead; `_addDep`
		// owns the subscribe + counter bump for any dep it adds.
		const initialLen = this._deps.length;
		for (let i = 0; i < initialLen; i++) {
			const depIdx = i;
			const dep = this._deps[i];
			dep.unsub = dep.node.subscribe((msgs) => {
				for (const m of msgs) {
					this._config.onMessage(
						this as unknown as NodeCtx,
						m,
						{ direction: "down-in", depIndex: depIdx },
						this._actions,
					);
				}
			});
		}
	}

	/**
	 * @internal Append a dep post-construction. Used by `autoTrackNode`
	 * (runtime dep discovery) and `Graph.connect()` (post-construction
	 * wiring). Subscribes immediately — if DATA arrives synchronously
	 * during subscribe and fn is currently executing, the re-run is
	 * deferred via `_pendingRerun` flag (see `_execFn` guard).
	 *
	 * **Dedup:** idempotent on duplicate `depNode` — if `depNode` is
	 * already in `_deps`, returns the existing index without mutating
	 * state. Callers can safely invoke `_addDep` without their own
	 * "already added" check. `autoTrackNode` still keeps a `depIndexMap`
	 * as a fast-path lookup for known deps (returning cached `data[idx]`
	 * without calling `_addDep` at all); this internal dedup is the
	 * backstop for any caller that doesn't track its own dep set.
	 *
	 * @returns The index of the new dep in `_deps`, or the existing index
	 *   if the dep was already present.
	 */
	_addDep(depNode: Node): number {
		// Dedup: idempotent on repeated adds of the same dep. Matches
		// reference equality — the DepRecord is keyed by `node` identity,
		// so a caller with a fresh `depNode` that observes as equal but
		// is a distinct object is treated as a new dep.
		for (let i = 0; i < this._deps.length; i++) {
			if (this._deps[i].node === depNode) return i;
		}
		const depIdx = this._deps.length;
		const record = createDepRecord(depNode);
		record.dirty = true;
		this._deps.push(record);
		// New dep starts dirty + sentinel — bump both A3 counters to match
		// the pre-set flags. Skipping the helper here because the record
		// isn't in the array yet when the helper would early-return on
		// `dep.dirty === true`.
		this._dirtyDepCount++;
		this._sentinelDepCount++;
		// Topology change → downstream sees a new wave. Skip when already
		// dirty (we're inside an in-flight wave and have already emitted).
		// `_depDirtied` can't do this for us because `record.dirty` was
		// pre-set above, which short-circuits its DIRTY-emit path.
		if (this._status !== "dirty") this._emit(DIRTY_ONLY_BATCH);
		record.unsub = depNode.subscribe((msgs) => {
			for (const m of msgs) {
				this._config.onMessage(
					this as unknown as NodeCtx,
					m,
					{ direction: "down-in", depIndex: depIdx },
					this._actions,
				);
			}
		});
		return depIdx;
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
		// Fn cleanup — both () => void and { deactivation } forms fire here.
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
		} else if (
			cleanup != null &&
			typeof (cleanup as { deactivation?: unknown }).deactivation === "function"
		) {
			try {
				(cleanup as { deactivation: () => void }).deactivation();
			} catch (err) {
				this._emit([[ERROR, this._wrapFnError("cleanup.deactivation threw", err)]]);
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

		// Clear wave + store state.
		this._waveHasNewData = false;
		this._hasNewTerminal = false;
		this._hasCalledFnOnce = false;
		this._paused = false;
		this._pendingWave = false;
		this._pendingRerun = false;
		this._rerunDepth = 0;
		this._store = {};
		// A3 counters reset with DepRecord bulk-reset.
		this._dirtyDepCount = 0;
		this._sentinelDepCount = 0;
		// C0 pause state: TEARDOWN is a hard reset. Buffered tier-3/4
		// messages from a paused `resumeAll` node are DISCARDED rather than
		// drained, matching "teardown wipes in-flight state" semantics.
		// Clearing both structures also prevents a memory leak on
		// non-resubscribable teardown, and guarantees a resubscribable
		// re-activation starts from `_paused === false` with no stale
		// lockset carried over from the previous lifecycle.
		this._pauseLocks = null;
		this._pauseBuffer = null;

		// ROM/RAM: compute nodes clear cache; pure state nodes preserve it.
		if (this._fn != null) {
			this._cached = NO_VALUE;
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

		// Fire inspector hook before default dispatch.
		this._inspectorHook?.({ kind: "dep_message", depIndex, message: msg });

		// Tier 0 (START) — informational, no state change.
		if (t === START) return;

		// Tier 1
		if (t === DIRTY) {
			this._depDirtied(dep);
			return;
		}
		if (t === INVALIDATE) {
			this._depInvalidated(dep);
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

		// Tier 5
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

		this._maybeRunFnOnSettlement();
	}

	// --- Centralized dep-state transitions (A3 settlement counters) ---
	//
	// Every mutation to `DepRecord.dirty` / `DepRecord.latestData` /
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
		const wasSentinel = dep.latestData === NO_VALUE && dep.terminal === undefined;
		dep.latestData = value;
		dep.dataThisWave = true;
		if (wasSentinel) this._sentinelDepCount--;
		this._waveHasNewData = true;
	}

	/**
	 * Called when a dep emits RESOLVED (wave settled, value unchanged).
	 * Clears dirty; does NOT touch `latestData` / `terminal` / sentinel
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
		const wasSentinel = dep.latestData === NO_VALUE && dep.terminal === undefined;
		dep.terminal = terminal;
		if (wasSentinel) this._sentinelDepCount--;
		this._hasNewTerminal = true;
	}

	/**
	 * Called when a dep emits INVALIDATE: clears cache, marks dirty, and
	 * restores sentinel state. The dep is now back in the "never delivered
	 * a real value" state, so the first-run gate re-closes.
	 */
	private _depInvalidated(dep: DepRecord): void {
		const wasNotSentinel = dep.latestData !== NO_VALUE || dep.terminal !== undefined;
		dep.latestData = NO_VALUE;
		dep.terminal = undefined;
		dep.dataThisWave = false;
		if (wasNotSentinel) this._sentinelDepCount++;
		if (!dep.dirty) {
			dep.dirty = true;
			this._dirtyDepCount++;
		}
	}

	private _maybeRunFnOnSettlement(): void {
		if (this._isTerminal && !this._resubscribable) return;
		// O(1) gate checks via the A3 counters. `_dirtyDepCount === 0` means
		// every dep has delivered its settlement for this wave;
		// `_sentinelDepCount === 0` means every dep has contributed at least
		// one DATA or terminal since activation (first-run gate is open).
		if (this._dirtyDepCount > 0) return;
		if (this._sentinelDepCount > 0) return;
		if (this._paused) {
			this._pendingWave = true;
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
	 * @internal Runs the node fn once. Default cleanup (function form) fires
	 * before the new run; `{ deactivation }` cleanup survives.
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

		// Pre-run cleanup — only the function-form cleanup fires here.
		const prevCleanup = this._cleanup;
		if (typeof prevCleanup === "function") {
			this._cleanup = undefined;
			try {
				prevCleanup();
			} catch (err) {
				this._emit([[ERROR, this._wrapFnError("cleanup threw", err)]]);
				return;
			}
		}
		// { deactivation } cleanup is preserved across runs.

		// Snapshot dep state for FnCtx. Done BEFORE clearing wave flags so
		// the snapshot reflects "this wave" rather than "next wave".
		const dataFrom = this._deps.map((d) => d.dataThisWave);
		const terminalDeps = this._deps.map((d) => d.terminal);
		const latestData = this._deps.map((d) =>
			d.latestData === NO_VALUE ? undefined : d.latestData,
		);
		const ctx: FnCtx = { dataFrom, terminalDeps, store: this._store };

		this._hasCalledFnOnce = true;
		this._clearWaveFlags();

		// Fire inspector hook before fn runs — for Graph.observe causal
		// traces. depValues is the snapshot about to be passed to fn.
		this._inspectorHook?.({ kind: "run", depValues: latestData });

		this._isExecutingFn = true;
		try {
			const result = this._fn(latestData, this._actions, ctx);
			if (typeof result === "function") {
				this._cleanup = result;
			} else if (
				result != null &&
				typeof result === "object" &&
				typeof (result as { deactivation?: unknown }).deactivation === "function"
			) {
				this._cleanup = result as { deactivation: () => void };
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
				if (this._rerunDepth > MAX_RERUN_DEPTH) {
					this._rerunDepth = 0;
					this._emit([
						[
							ERROR,
							new Error(
								`Node "${this.name}": _pendingRerun depth exceeded ${MAX_RERUN_DEPTH} — likely a reactive cycle`,
							),
						],
					]);
				} else {
					this._maybeRunFnOnSettlement();
				}
			} else {
				// Chain converged — reset the depth counter for the next wave.
				this._rerunDepth = 0;
			}
			// Clear flags after rerun so any dataThisWave set by fn's
			// _addDep subscribe handshakes doesn't leak into the next
			// wave's snapshot. The inner _execFn (if any) already did
			// its own pre-snapshot clear; this is for the case where
			// fn added deps but no rerun fired.
			this._clearWaveFlags();
		}
	}

	private _clearWaveFlags(): void {
		this._waveHasNewData = false;
		this._hasNewTerminal = false;
		for (const d of this._deps) d.dataThisWave = false;
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
	 * This is the single source of truth for the spec §1.3.1 framing
	 * invariant. `defaultBundle.resolve()` used to duplicate this logic
	 * and `_updateState` used to synthesize its own prefix on equals
	 * substitution — both are now gone. Every outgoing path hits
	 * `_frameBatch` exactly once via `_emit`.
	 */
	private _frameBatch(messages: Messages): Messages {
		const tierOf = this._config.tierOf;
		// Fast path: single message.
		if (messages.length === 1) {
			const t = tierOf(messages[0][0]);
			if (t === 3 && this._status !== "dirty") {
				return [DIRTY_MSG, messages[0]];
			}
			return messages;
		}
		// Check monotonicity and tier-3 presence in a single pass.
		let monotone = true;
		let hasTier3 = false;
		let hasDirty = false;
		let prevTier = -1;
		for (const m of messages) {
			const tier = tierOf(m[0]);
			if (tier < prevTier) monotone = false;
			if (tier === 3) hasTier3 = true;
			if (m[0] === DIRTY) hasDirty = true;
			prevTier = tier;
		}
		let sorted: Messages = messages;
		if (!monotone) {
			// Stable sort via index-keyed decoration.
			const indexed = messages.map((m, i) => ({ m, i, tier: tierOf(m[0]) }));
			indexed.sort((a, b) => a.tier - b.tier || a.i - b.i);
			sorted = indexed.map((x) => x.m);
		}
		if (hasTier3 && !hasDirty && this._status !== "dirty") {
			// Insert DIRTY after any tier-0 START entries to preserve
			// monotonicity.
			let insertAt = 0;
			while (insertAt < sorted.length && tierOf(sorted[insertAt][0]) === 0) insertAt++;
			if (insertAt === 0) return [DIRTY_MSG, ...sorted];
			return [...sorted.slice(0, insertAt), DIRTY_MSG, ...sorted.slice(insertAt)];
		}
		return sorted;
	}

	// --- Emit pipeline ---

	/**
	 * @internal The unified dispatch waist — one call = one wave.
	 *
	 * Pipeline stages, in order:
	 *
	 *   1. Early-return on empty batch.
	 *   2. Terminal filter — post-COMPLETE/ERROR only TEARDOWN/INVALIDATE
	 *      still propagate so graph teardown and cache-clear still work.
	 *   3. Tier sort (stable) — the batch can be in any order when it
	 *      arrives; the walker downstream (`downWithBatch`) assumes
	 *      ascending tier monotone, and so does `_updateState`'s tier-3
	 *      slice walk. This is the single source of truth for ordering.
	 *   4. Synthetic DIRTY prefix — if a tier-3 payload is present, no
	 *      DIRTY is already in the batch, and the node isn't already in
	 *      `"dirty"` status, prepend `[DIRTY]` after any tier-0 START
	 *      entries. Guarantees spec §1.3.1 (DIRTY precedes DATA within
	 *      the same batch) uniformly across every entry point.
	 *   5. PAUSE/RESUME lock bookkeeping (C0) — update `_pauseLocks`,
	 *      derive `_paused`, filter unknown-lockId RESUME, replay
	 *      bufferAll buffer on final lock release.
	 *   6. Meta TEARDOWN fan-out — notify meta children before
	 *      `_updateState`'s TEARDOWN branch calls `_deactivate`. Hoisted
	 *      out of the walk to keep `_updateState` re-entrance-free.
	 *   7. `_updateState` — walk the batch in tier order, advancing
	 *      `_cached` / `_status` / `_versioning` and running equals
	 *      substitution on tier-3 DATA (§3.5.1). Returns
	 *      `{finalMessages, equalsError?}`.
	 *   8. `downWithBatch` dispatch (or bufferAll capture if paused with
	 *      `pausable: "resumeAll"`).
	 *   9. Recursive ERROR emission if equals threw mid-walk.
	 *
	 * Public `node.down` / `node.emit` / `actions.down` / `actions.emit`
	 * all converge here. `actions.bundle` no longer exists — the bundle
	 * sort + auto-prefix logic that used to live in the config's
	 * `BundleFactory` was folded into stages 3 and 4 so every emission
	 * path shares one invariant. The singleton `config.bundle` is retained
	 * as an advanced escape hatch for callers that want manual control;
	 * nothing in core calls it.
	 */
	_emit(messages: Messages): void {
		if (messages.length === 0) return;

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
					if (this._pauseLocks == null) this._pauseLocks = new Set();
					this._pauseLocks.add(lockId);
					this._paused = true;
					if (this._pausable === "resumeAll" && this._pauseBuffer == null) {
						this._pauseBuffer = [];
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
							// Replay bufferAll buffer through the outgoing
							// pipeline BEFORE forwarding RESUME — subscribers
							// observe the deferred DATAs as part of the
							// pre-RESUME wake-up.
							//
							// D2 (2026-04-13) semantic note: the recursive
							// `_emit(drain)` goes through the full pipeline
							// including `_updateState`'s equals substitution.
							// A buffered `[DATA, v]` whose value matches the
							// *pre-pause* cache will collapse to RESOLVED on
							// replay — producer "pulses" that write the same
							// value while paused are absorbed. This matches
							// diamond-safety intent: `.cache` stays coherent
							// with "the last DATA actually delivered to
							// sinks". Producers that need pulse semantics
							// (every write observable regardless of value)
							// should set `equals: () => false` on the node.
							if (this._pauseBuffer != null && this._pauseBuffer.length > 0) {
								const drain = this._pauseBuffer;
								this._pauseBuffer = [];
								this._emit(drain);
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
		// stays re-entrance-free: previously the walk called `_emit` on each
		// meta child mid-iteration, which meant a meta node's own dispatch
		// re-entered the parent's outgoing pipeline while `this._cached` /
		// `this._status` were mid-commit. Hoisting the fan-out keeps
		// `_updateState` a pure state-transition walk and preserves the spec
		// ordering "meta propagates before deactivation" — `_updateState`'s
		// TEARDOWN branch still runs `_deactivate` AFTER the meta children
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

		if (finalMessages.length > 0) {
			// BufferAll: while paused with `pausable: "resumeAll"`, buffer
			// tier-3/4 payloads in order. Tier 0–2 and tier 5 continue to
			// dispatch synchronously — START/DIRTY/RESUME/PAUSE/TEARDOWN
			// must stay live so subscribers, downstream pausers, and graph
			// teardown all observe them. Cache/status advance has already
			// happened via `_updateState`, so the replay later just pushes
			// the deferred messages back through `downWithBatch`.
			if (this._paused && this._pausable === "resumeAll" && this._pauseBuffer != null) {
				const tierOf = this._config.tierOf;
				const immediate: Message[] = [];
				for (const m of finalMessages) {
					const tier = tierOf(m[0]);
					if (tier < 3 || tier === 5) {
						immediate.push(m);
					} else {
						this._pauseBuffer.push(m);
					}
				}
				if (immediate.length > 0) {
					downWithBatch(this._deliverToSinks, immediate, tierOf);
				}
			} else {
				downWithBatch(this._deliverToSinks, finalMessages, this._config.tierOf);
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
		let rewritten: Message[] | undefined;
		let equalsError: Error | undefined;
		let abortedAt = -1;

		for (let i = 0; i < messages.length; i++) {
			const m = messages[i];
			const t = m[0];
			if (t === DATA) {
				if (m.length >= 2) {
					let unchanged = false;
					if (this._cached !== NO_VALUE) {
						try {
							unchanged = this._equals(this._cached as T, m[1] as T);
						} catch (err) {
							// Abort walk on equals throw: deliver successfully-walked
							// prefix, then caller emits ERROR. Excludes the throwing
							// message from the prefix.
							equalsError = this._wrapFnError("equals threw", err);
							abortedAt = i;
							break;
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
						advanceVersion(this._versioning, m[1], this._hashFn);
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
				} else if (t === ERROR) {
					this._status = "errored";
				} else if (t === INVALIDATE) {
					this._cached = NO_VALUE;
					this._status = "dirty";
					// Function-form cleanup fires on invalidate (treats as "re-run").
					const c = this._cleanup;
					if (typeof c === "function") {
						this._cleanup = undefined;
						try {
							c();
						} catch {
							/* best-effort */
						}
					}
				} else if (t === TEARDOWN) {
					if (this._resetOnTeardown) this._cached = NO_VALUE;
					// Meta TEARDOWN fan-out was already performed by `_emit`
					// before this walk. Deactivate now that meta children
					// have been notified.
					this._deactivate(/* skipStatusUpdate */ true);
					// TEARDOWN is a hard reset — unconditionally "sentinel",
					// even if the node was previously completed/errored.
					this._status = "sentinel";
				}
			}
		}

		const base: Messages =
			abortedAt >= 0
				? ((rewritten ?? (messages.slice(0, abortedAt) as Messages)) as Messages)
				: (rewritten ?? messages);
		return equalsError != null ? { finalMessages: base, equalsError } : { finalMessages: base };
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
