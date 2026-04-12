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
	Bundle,
	BundleFactory,
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
	DATA,
	DIRTY,
	ERROR,
	INVALIDATE,
	type Message,
	type Messages,
	PAUSE,
	RESOLVED,
	RESUME,
	START,
	TEARDOWN,
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
 * teardown — any non-cleanup return value is ignored.
 */
export type NodeFn = (
	data: readonly unknown[],
	actions: NodeActions,
	ctx: FnCtx,
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
	 * Raw downstream passthrough — `messages` are delivered as-is through
	 * the emit pipeline. NO framing. Caller is responsible for tier
	 * ordering and two-phase DIRTY prefixing; use `emit` for framed
	 * value delivery.
	 */
	down(messages: Messages, options?: NodeTransportOptions): void;
	/**
	 * Framed value delivery. Runs `equals` (cache vs `value`) to decide
	 * DATA vs RESOLVED, frames the outgoing message through the singleton
	 * `bundle` (tier sort + DIRTY auto-prefix), then delivers. Diamond-
	 * safe by construction — prefer this over raw `down` for state-node
	 * writes from external code.
	 */
	emit(value: T, options?: NodeTransportOptions): void;
	/**
	 * Raw upstream passthrough — forwards `messages` to every dep without
	 * modifying any local state.
	 */
	up?(messages: Messages, options?: NodeTransportOptions): void;
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
// Default handlers
// ---------------------------------------------------------------------------

/**
 * Default {@link BundleFactory}. Accumulates messages, sorts them by tier on
 * `resolve()`, and auto-injects a `[[DIRTY]]` tier-1 message when any tier-3
 * payload is present and the node is not already in `"dirty"` status. The
 * DIRTY is inserted after any tier-0 (START) entries so the result stays
 * monotonically sorted by tier — `downWithBatch` walks it without
 * re-sorting.
 */
const defaultBundle: BundleFactory = (node: NodeCtx, initial: Messages): Bundle => {
	const msgs: Message[] = [...initial];
	const impl = node as NodeImpl;
	const tierOf = (t: symbol) => impl._config.messageTier(t);
	const bundle: Bundle = {
		append(...more: Message[]): Bundle {
			msgs.push(...more);
			return bundle;
		},
		resolve(direction?: "down" | "up"): Messages {
			// Stable tier sort (both directions).
			const indexed = msgs.map((m, i) => ({ m, i, tier: tierOf(m[0]) }));
			indexed.sort((a, b) => a.tier - b.tier || a.i - b.i);
			const sorted = indexed.map((x) => x.m);
			// Up direction: tier-sorted only. DIRTY auto-prefix is a
			// downstream two-phase concept; upstream signals are pass-through.
			if (direction === "up") return sorted;
			// Down direction (default): auto-inject DIRTY iff tier-3 present,
			// no DIRTY already present, and node is not already dirty.
			// Insert AFTER any tier-0 messages to preserve monotone tier order.
			const hasTier3 = sorted.some((m) => tierOf(m[0]) === 3);
			const hasDirty = sorted.some((m) => m[0] === DIRTY);
			if (hasTier3 && !hasDirty && impl._status !== "dirty") {
				let insertAt = 0;
				while (insertAt < sorted.length && tierOf(sorted[insertAt][0]) === 0) {
					insertAt += 1;
				}
				return [...sorted.slice(0, insertAt), [DIRTY] as Message, ...sorted.slice(insertAt)];
			}
			return sorted;
		},
	};
	return bundle;
};

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
): "consume" | void => {
	if (ctx.direction === "down-in") {
		(node as NodeImpl)._onDepMessage(ctx.depIndex, msg);
	}
	// up-in is currently unused; default is to do nothing.
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
): (() => void) | void => {
	const impl = node as NodeImpl;
	if (impl._status === "completed" || impl._status === "errored") return;
	const cached = impl._cached;
	const initial: Messages = cached === NO_VALUE ? [[START]] : [[START], [DATA, cached]];
	const tierOf = (t: symbol) => impl._config.messageTier(t);
	downWithBatch(sink, initial, tierOf);
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
	bundle: defaultBundle,
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

	// --- Options (frozen at construction) ---
	readonly _fn: NodeFn | undefined;
	readonly _equals: (a: T, b: T) => boolean;
	readonly _resubscribable: boolean;
	readonly _resetOnTeardown: boolean;
	readonly _autoComplete: boolean;
	readonly _autoError: boolean;
	readonly _pausable: boolean | "resumeAll";
	readonly _guard: NodeGuard | undefined;
	readonly _hashFn: HashFn;
	_versioning: NodeVersionInfo | undefined;

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
		void this._config.bundle;

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
		this._hashFn = opts.versioningHash ?? defaultHash;
		this._versioning =
			opts.versioning != null
				? createVersioning(opts.versioning, this._cached === NO_VALUE ? undefined : this._cached, {
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

		// Actions: built once, closure over `this`.
		const self = this;
		this._actions = {
			emit(value: unknown): void {
				self._actionEmit(value);
			},
			down(messages: Messages): void {
				// Raw pipeline entry: no bundle auto-framing. Caller is
				// responsible for tier ordering and two-phase DIRTY prefix.
				self._emit(messages);
			},
			up(messages: Messages): void {
				for (const d of self._deps) {
					d.node.up?.(messages, { internal: true });
				}
			},
			bundle(initial: Message | Messages): Bundle {
				// Runtime discrimination: a single Message has a symbol at
				// index 0, whereas a Messages array holds Message tuples.
				const msgs: Messages =
					typeof (initial as Message)[0] === "symbol"
						? [initial as Message]
						: (initial as Messages);
				return self._config.bundle(self as unknown as NodeCtx, msgs);
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

	down(messages: Messages, options?: NodeTransportOptions): void {
		if (messages.length === 0) return;
		this._checkGuard(options);
		this._emit(messages);
	}

	emit(value: T, options?: NodeTransportOptions): void {
		this._checkGuard(options);
		this._actionEmit(value);
	}

	up(messages: Messages, options?: NodeTransportOptions): void {
		if (this._deps.length === 0) return;
		if (messages.length === 0) return;
		this._checkGuard(options);
		const forwardOpts: NodeTransportOptions = options ?? { internal: true };
		for (const d of this._deps) {
			d.node.up?.(messages, forwardOpts);
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
		// Pre-set every dep as dirty BEFORE subscribing — even if the first
		// dep settles synchronously during subscribe, the wave-complete check
		// sees later deps still marked dirty and holds fn until they settle.
		for (const d of this._deps) d.dirty = true;
		for (let i = 0; i < this._deps.length; i++) {
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
	 * @returns The index of the new dep in `_deps`.
	 */
	_addDep(depNode: Node): number {
		const depIdx = this._deps.length;
		const record = createDepRecord(depNode);
		record.dirty = true;
		this._deps.push(record);
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
		this._hasCalledFnOnce = false;
		this._paused = false;
		this._pendingWave = false;
		this._store = {};

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
			this._markDepDirty(depIndex);
			return;
		}
		if (t === INVALIDATE) {
			dep.latestData = NO_VALUE;
			this._markDepDirty(depIndex);
			this._emit([[INVALIDATE]]);
			return;
		}

		// Tier 2
		if (t === PAUSE) {
			if (this._pausable !== false) this._paused = true;
			this._emit([[PAUSE]]);
			return;
		}
		if (t === RESUME) {
			if (this._paused) {
				this._paused = false;
				this._emit([[RESUME]]);
				if (this._pendingWave) {
					this._pendingWave = false;
					this._maybeRunFnOnSettlement();
				}
			} else {
				this._emit([[RESUME]]);
			}
			return;
		}

		// Tier 5
		if (t === TEARDOWN) {
			this._emit([[TEARDOWN]]);
			return;
		}

		// Tier 3 / 4 — DepRecord updates then settlement / propagation.
		if (t === DATA) {
			dep.latestData = msg[1];
			dep.dirty = false;
			dep.dataThisWave = true;
			this._waveHasNewData = true;
		} else if (t === RESOLVED) {
			dep.dirty = false;
		} else if (t === COMPLETE) {
			dep.terminal = true;
			dep.dirty = false;
			this._hasNewTerminal = true;
		} else if (t === ERROR) {
			dep.terminal = msg[1];
			dep.dirty = false;
			this._hasNewTerminal = true;
		} else {
			// Unknown type: forward as-is (spec §1.3.6 forward-compat).
			this._emit([msg]);
			return;
		}

		if (!this._fn) {
			// Passthrough: forward DATA/RESOLVED 1:1. Frame explicitly via
			// the singleton bundle for tier ordering + DIRTY auto-prefix —
			// `_emit` is raw and won't do it on our behalf.
			if (t === DATA || t === RESOLVED) {
				const framed = this._config.bundle(this as unknown as NodeCtx, [msg]).resolve();
				this._emit(framed);
			}
			if (t === COMPLETE || t === ERROR) {
				this._maybeAutoTerminalAfterWave();
			}
			return;
		}

		this._maybeRunFnOnSettlement();
	}

	private _markDepDirty(depIndex: number): void {
		const dep = this._deps[depIndex];
		if (dep.dirty) return;
		dep.dirty = true;
		// First dep to dirty this wave → propagate DIRTY to our own sinks.
		if (this._status !== "dirty") {
			this._emit([[DIRTY]]);
		}
	}

	private _maybeRunFnOnSettlement(): void {
		if (this._isTerminal && !this._resubscribable) return;
		const allSettled = this._deps.every((d) => !d.dirty);
		if (!allSettled) return;
		const gateOpen = this._deps.every((d) => d.latestData !== NO_VALUE || d.terminal !== undefined);
		if (!gateOpen) return;
		if (this._paused) {
			this._pendingWave = true;
			return;
		}
		// Pre-fn skip: when no dep sent DATA this wave (all RESOLVED), skip
		// fn and emit RESOLVED directly. Transitive-skip optimization — leaf
		// fn is not re-run when a mid-chain node produces the same value.
		if (!this._waveHasNewData && !this._hasNewTerminal && this._hasCalledFnOnce) {
			this._clearWaveFlags();
			this._emit([[RESOLVED]]);
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
			this._emit([[COMPLETE]]);
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
				this._maybeRunFnOnSettlement();
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

	// --- Emit pipeline ---

	/**
	 * @internal Raw emission pipeline: terminal filter → `_updateState` →
	 * `downWithBatch`. Does NOT run bundle — callers are responsible for
	 * tier ordering and any DIRTY auto-prefix. Internal callers that emit
	 * tier-3 payloads must explicitly frame via `this._config.bundle(...)`
	 * (see passthrough branch in `_onDepMessage` and `_actionEmit`).
	 *
	 * The raw shape keeps `node.down` / `actions.down` / `node.up` /
	 * `actions.up` absolutely free — the developer controls exactly what
	 * goes on the wire. `node.emit` / `actions.emit` are the framing-sugar
	 * entry points that call bundle + `_emit` for diamond-safe value
	 * delivery.
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

		this._updateState(deliverable);

		const tierOf = (t: symbol) => this._config.messageTier(t);
		downWithBatch(this._deliverToSinks, deliverable, tierOf);
	}

	/**
	 * @internal Update own cache / status / versioning / meta propagation
	 * from an outgoing batch, before it is delivered to sinks.
	 */
	private _updateState(messages: Messages): void {
		for (const m of messages) {
			const t = m[0];
			if (t === DATA) {
				if (m.length >= 2) {
					this._cached = m[1] as T;
					if (this._versioning != null) {
						advanceVersion(this._versioning, m[1], this._hashFn);
					}
				}
				this._status = "settled";
			} else if (t === DIRTY) {
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
				// Propagate to meta companions before deactivation.
				for (const metaNode of Object.values(this.meta)) {
					try {
						(metaNode as NodeImpl)._emit([[TEARDOWN]]);
					} catch {
						/* best-effort */
					}
				}
				this._deactivate(/* skipStatusUpdate */ true);
				// TEARDOWN is a hard reset — unconditionally "sentinel",
				// even if the node was previously completed/errored.
				this._status = "sentinel";
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

	// --- emit sugar (framing path) ---

	/**
	 * @internal Shared implementation for `actions.emit(v)` and public
	 * `node.emit(v)`. Runs `equals` to decide DATA vs RESOLVED, frames
	 * through the singleton `bundle` (tier sort + DIRTY auto-prefix), then
	 * delivers via the raw `_emit` pipeline. This is the only path in the
	 * core that calls bundle — raw `down` / `up` stay framing-free.
	 */
	private _actionEmit(value: unknown): void {
		let unchanged: boolean;
		try {
			unchanged = this._cached !== NO_VALUE && this._equals(this._cached as T, value as T);
		} catch (err) {
			this._emit([[ERROR, this._wrapFnError("equals threw", err)]]);
			return;
		}
		const payload: Message = unchanged ? [RESOLVED] : [DATA, value];
		const framed = this._config.bundle(this as unknown as NodeCtx, [payload]).resolve();
		this._emit(framed);
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
