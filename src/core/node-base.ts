/**
 * `NodeBase` — abstract class implementing the {@link Node} protocol with
 * lifecycle machinery shared between {@link NodeImpl} (static deps) and
 * {@link DynamicNodeImpl} (runtime-tracked deps).
 *
 * **Responsibilities (shared):**
 * - Identity (name, describeKind, meta, guard, versioning)
 * - Cache + status lifecycle (`_cached`, `_status`, `_terminal`)
 * - Sink storage (null / single / Set fast paths)
 * - `subscribe()` with START handshake + first-subscriber activation
 * - `_downInternal` → `_downToSinks` delivery pipeline (via `downWithBatch`)
 * - `_downAutoValue` (value → protocol framing with equals)
 * - `_handleLocalLifecycle` (cached/status/terminal updates + meta propagation)
 *
 * **Subclass hooks (abstract):**
 * - `_onActivate()` — called when sinkCount transitions 0 → 1
 * - `_onDeactivate()` — called when sinkCount transitions 1 → 0
 * - `up()` / `unsubscribe()` / `_upInternal()` — dep-iteration specifics
 * - `_createMetaNode()` — meta companion factory (avoids circular imports)
 *
 * See GRAPHREFLY-SPEC §2 and COMPOSITION-GUIDE §1 for protocol contracts.
 */

import type { Actor } from "./actor.js";
import { normalizeActor } from "./actor.js";
import { downWithBatch } from "./batch.js";
import { wallClockNs } from "./clock.js";
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
	propagatesToMeta,
	RESOLVED,
	START,
	TEARDOWN,
} from "./messages.js";
import type { HashFn, NodeVersionInfo, VersioningLevel } from "./versioning.js";
import { advanceVersion, createVersioning, defaultHash } from "./versioning.js";

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

/**
 * Internal sentinel value: "no cached value has been set or emitted."
 * Used instead of `undefined` so that `undefined` can be a valid emitted value.
 */
export const NO_VALUE: unique symbol = Symbol.for("graphrefly/NO_VALUE");

/**
 * Branded symbol that marks a {@link CleanupResult} wrapper — prevents
 * duck-type collisions with domain objects that happen to have a `cleanup`
 * property.
 */
export const CLEANUP_RESULT: unique symbol = Symbol.for("graphrefly/CLEANUP_RESULT");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Lifecycle status of a node (GRAPHREFLY-SPEC §2.2). */
export type NodeStatus =
	| "disconnected"
	| "pending"
	| "dirty"
	| "settled"
	| "resolved"
	| "completed"
	| "errored";

/** Callback that receives downstream message batches. */
export type NodeSink = (messages: Messages) => void;

/** Imperative actions available inside a node's compute function. */
export interface NodeActions {
	/** Emit raw messages downstream. */
	down(messages: Messages): void;
	/** Emit a single value (auto-wraps in DIRTY/DATA or DIRTY/RESOLVED). */
	emit(value: unknown): void;
	/** Send messages upstream toward sources. */
	up(messages: Messages): void;
}

/**
 * Callback for intercepting messages before the default dispatch (§2.6).
 *
 * Called for every message from every dep. Return `true` to consume
 * (skip default handling), or `false` to let default dispatch run.
 */
export type OnMessageHandler = (msg: Message, depIndex: number, actions: NodeActions) => boolean;

/**
 * Internal inspector hook (opt-in): emits dependency message and run events
 * for graph-level observability features (`observe(..., { causal|derived })`).
 */
export type NodeInspectorHookEvent =
	| { kind: "dep_message"; depIndex: number; message: Message }
	| { kind: "run"; depValues: readonly unknown[] };

export type NodeInspectorHook = (event: NodeInspectorHookEvent) => void;

/** Explicit describe `type` for {@link Graph.describe} (GRAPHREFLY-SPEC Appendix B). */
export type NodeDescribeKind = "state" | "derived" | "producer" | "operator" | "effect";

/** Options accepted by every node constructor. */
export interface NodeOptions {
	name?: string;
	/**
	 * Overrides inferred `type` in describe output. Sugar constructors set this;
	 * omit to infer from deps / fn / manual emit usage.
	 */
	describeKind?: NodeDescribeKind;
	/** Equality check for RESOLVED detection. Defaults to `Object.is`. */
	equals?: (a: unknown, b: unknown) => boolean;
	initial?: unknown;
	/**
	 * Each key becomes an independently subscribable companion node.
	 * Meta nodes outlive the parent's subscription lifecycle: when all sinks
	 * unsubscribe the parent deactivates but meta nodes stay alive.
	 * Send `[[TEARDOWN]]` to the parent to release meta node resources.
	 */
	meta?: Record<string, unknown>;
	/** Allow fresh subscriptions after COMPLETE/ERROR. */
	resubscribable?: boolean;
	/**
	 * Invoked when a new {@link Node.subscribe} clears a terminal state on a
	 * resubscribable node — reset operator-local counters/accumulators here.
	 */
	onResubscribe?: () => void;
	/** Clear cached value on TEARDOWN. */
	resetOnTeardown?: boolean;
	/**
	 * When `true` (default), auto-emit `[[COMPLETE]]` when all deps complete
	 * (spec §1.3.5). Set `false` for derived/operator nodes that should not
	 * auto-complete.
	 */
	completeWhenDepsComplete?: boolean;
	/**
	 * Intercept messages before the default dispatch (spec §2.6).
	 *
	 * Return `true` to consume the message (skip default handling),
	 * or `false` to let the default dispatch run.
	 */
	onMessage?: OnMessageHandler;
	/**
	 * ABAC: `(actor, action) => boolean`. `write` applies to both {@link Node.down} and {@link Node.up}.
	 * Companion {@link NodeOptions.meta | meta} nodes inherit this guard from the primary.
	 */
	guard?: NodeGuard;
	/** Opt-in versioning level (GRAPHREFLY-SPEC §7). */
	versioning?: VersioningLevel;
	/** Override auto-generated versioning id. */
	versioningId?: string;
	/** Custom hash function for V1 cid computation. */
	versioningHash?: HashFn;
}

/** Actor/delivery context for {@link Node.down} and {@link Node.up}. */
export type NodeTransportOptions = {
	actor?: Actor;
	/**
	 * When `true`, skips guard checks (reactive internals, graph lifecycle TEARDOWN, etc.).
	 * Not for untrusted call sites.
	 */
	internal?: boolean;
	/**
	 * `signal` for {@link Graph.signal} deliveries; default `write` for {@link Graph.set}
	 * and direct `down`.
	 */
	delivery?: "write" | "signal";
};

/** Optional hints passed to {@link Node.subscribe}. */
export interface SubscribeHints {
	/**
	 * Subscriber has exactly one dep with `fn` — the source may skip DIRTY
	 * dispatch when this is the sole subscriber. The subscriber synthesizes
	 * dirty state locally.
	 */
	singleDep?: boolean;
	/**
	 * Actor to check against the node's `observe` guard. When set,
	 * `subscribe()` throws {@link GuardDenied} if the actor is not permitted
	 * to observe this node.
	 */
	actor?: Actor;
}

/** A reactive node in the GraphReFly protocol. */
export interface Node<T = unknown> {
	readonly name?: string;
	readonly status: NodeStatus;
	readonly meta: Record<string, Node>;
	/** Returns the current cached value. */
	get(): T | undefined;
	/** Push messages downstream. */
	down(messages: Messages, options?: NodeTransportOptions): void;
	/**
	 * Registers a sink to receive downstream messages.
	 *
	 * @param sink - Callback receiving message batches.
	 * @param hints - Optional optimization hints (e.g. `{ singleDep: true }`).
	 * @returns An unsubscribe function (idempotent).
	 */
	subscribe(sink: NodeSink, hints?: SubscribeHints): () => void;
	/** Send messages upstream (present on nodes with deps). */
	up?: (messages: Messages, options?: NodeTransportOptions) => void;
	/** Disconnect from upstream deps (present on nodes with deps). */
	unsubscribe?: () => void;
	/** Last successful guarded `down` / `up` (not set for `internal` deliveries). */
	readonly lastMutation?: Readonly<{ actor: Actor; timestamp_ns: number }>;
	/** Whether `actor` may {@link Graph.observe} this node. */
	allowsObserve(actor: Actor): boolean;
	/** Whether a {@link NodeOptions.guard | guard} is installed. */
	hasGuard(): boolean;
	/** Versioning info (GRAPHREFLY-SPEC §7). `undefined` when versioning is not enabled. */
	readonly v: Readonly<NodeVersionInfo> | undefined;
}

// ---------------------------------------------------------------------------
// Cleanup result wrapper
// ---------------------------------------------------------------------------

/**
 * Explicit cleanup wrapper. When a node fn returns `{ cleanup, value? }`,
 * `cleanup` is registered as the teardown/recompute cleanup and `value`
 * (if present) is emitted as data. This avoids the ambiguity where returning
 * a plain function is silently consumed as cleanup instead of emitted as data.
 */
export type CleanupResult<T = unknown> = {
	readonly [CLEANUP_RESULT]: true;
	cleanup: () => void;
	value?: T;
};

/** Create a branded {@link CleanupResult}. */
export function cleanupResult<T>(cleanup: () => void): CleanupResult<T>;
export function cleanupResult<T>(cleanup: () => void, value: T): CleanupResult<T>;
export function cleanupResult<T>(cleanup: () => void, ...args: [] | [T]): CleanupResult<T> {
	const r: CleanupResult<T> = { [CLEANUP_RESULT]: true, cleanup };
	if (args.length > 0) r.value = args[0];
	return r;
}

export const isCleanupResult = (value: unknown): value is CleanupResult =>
	typeof value === "object" && value !== null && CLEANUP_RESULT in value;

export const isCleanupFn = (value: unknown): value is () => void => typeof value === "function";

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

/**
 * Returns the post-message status for `status` after processing `msg`.
 * START is informational and does not transition status.
 */
export function statusAfterMessage(status: NodeStatus, msg: Message): NodeStatus {
	const t = msg[0];
	if (t === DIRTY) return "dirty";
	if (t === DATA) return "settled";
	if (t === RESOLVED) return "resolved";
	if (t === COMPLETE) return "completed";
	if (t === ERROR) return "errored";
	if (t === INVALIDATE) return "dirty";
	if (t === TEARDOWN) return "disconnected";
	return status;
}

// ---------------------------------------------------------------------------
// BitSet — dep mask helper (int fast path for ≤31 deps, array for more)
// ---------------------------------------------------------------------------

/**
 * Dep settlement tracker. IMPORTANT: `covers()` requires both operands to be
 * the same concrete type (both IntBitSet or both ArrayBitSet). Within a node,
 * all masks share the same `createBitSet(deps.length)` factory, so this is
 * always satisfied.
 */
export interface BitSet {
	set(index: number): void;
	clear(index: number): void;
	has(index: number): boolean;
	/** True when all bits in `other` are also set in `this`. */
	covers(other: BitSet): boolean;
	/** True when at least one bit is set. */
	any(): boolean;
	reset(): void;
	/** Set all bits in [0, size) — used for the pre-set-dirty wave trick. */
	setAll(): void;
}

function createIntBitSet(size: number): BitSet {
	const fullMask = size >= 32 ? -1 : ~(-1 << size);
	let bits = 0;
	return {
		set(i: number) {
			bits |= 1 << i;
		},
		clear(i: number) {
			bits &= ~(1 << i);
		},
		has(i: number) {
			return (bits & (1 << i)) !== 0;
		},
		covers(other: BitSet) {
			const otherBits = (other as unknown as { _bits(): number })._bits();
			return (bits & otherBits) === otherBits;
		},
		any() {
			return bits !== 0;
		},
		reset() {
			bits = 0;
		},
		setAll() {
			bits = fullMask;
		},
		_bits() {
			return bits;
		},
	} as BitSet & { _bits(): number };
}

function createArrayBitSet(size: number): BitSet {
	const words = new Uint32Array(Math.ceil(size / 32));
	const lastBits = size % 32;
	const lastWordMask = lastBits === 0 ? 0xffffffff : ((1 << lastBits) - 1) >>> 0;
	return {
		set(i: number) {
			words[i >>> 5] |= 1 << (i & 31);
		},
		clear(i: number) {
			words[i >>> 5] &= ~(1 << (i & 31));
		},
		has(i: number) {
			return (words[i >>> 5] & (1 << (i & 31))) !== 0;
		},
		covers(other: BitSet) {
			const ow = (other as unknown as { _words: Uint32Array })._words;
			for (let w = 0; w < words.length; w++) {
				if ((words[w] & ow[w]) >>> 0 !== ow[w]) return false;
			}
			return true;
		},
		any() {
			for (let w = 0; w < words.length; w++) {
				if (words[w] !== 0) return true;
			}
			return false;
		},
		reset() {
			words.fill(0);
		},
		setAll() {
			for (let w = 0; w < words.length - 1; w++) words[w] = 0xffffffff;
			if (words.length > 0) words[words.length - 1] = lastWordMask;
		},
		_words: words,
	} as unknown as BitSet;
}

/** Create a BitSet sized for `size` bits (≤31 uses fast int path). */
export function createBitSet(size: number): BitSet {
	return size <= 31 ? createIntBitSet(size) : createArrayBitSet(size);
}

// ---------------------------------------------------------------------------
// NodeBase
// ---------------------------------------------------------------------------

/**
 * Abstract base class for every node in the graph. Both {@link NodeImpl}
 * (static deps) and {@link DynamicNodeImpl} (runtime-tracked deps) extend
 * this to share subscribe/sink/lifecycle machinery.
 *
 * Invariants (see GRAPHREFLY-SPEC §2.2):
 * - `_sinkCount` always reflects the size of `_sinks`.
 * - `_cached === NO_VALUE` iff the node has never produced a value (SENTINEL).
 * - `_terminal` is set exactly once (per subscription cycle for resubscribable).
 * - `_onActivate` runs exactly once per activation cycle; `_onDeactivate`
 *   runs exactly once per deactivation (both driven by `subscribe()`).
 *
 * ROM/RAM rule (GRAPHREFLY-SPEC §2.2): state nodes (no fn) preserve `_cached`
 * across disconnect — intrinsic, non-volatile. Compute nodes (derived,
 * producer, dynamic) clear `_cached` on disconnect in their subclass
 * `_onDeactivate` — their value is a function of live subscriptions.
 */
export abstract class NodeBase<T = unknown> implements Node<T> {
	// --- Identity (set once) ---
	protected readonly _optsName: string | undefined;
	private _registryName: string | undefined;
	/** @internal Read by `describeNode` before inference. */
	readonly _describeKind: NodeDescribeKind | undefined;
	readonly meta: Record<string, Node>;

	// --- Options ---
	protected readonly _equals: (a: unknown, b: unknown) => boolean;
	protected readonly _resubscribable: boolean;
	protected readonly _resetOnTeardown: boolean;
	protected readonly _onResubscribe: (() => void) | undefined;
	protected readonly _onMessage: OnMessageHandler | undefined;
	/** @internal Read by `describeNode` for `accessHintForGuard`. */
	readonly _guard: NodeGuard | undefined;
	/** @internal Subclasses update this through {@link _recordMutation}. */
	protected _lastMutation: { actor: Actor; timestamp_ns: number } | undefined;

	// --- Versioning ---
	protected _hashFn: HashFn;
	private _versioning: NodeVersionInfo | undefined;

	// --- Lifecycle state ---
	/** @internal Read by `describeNode` and `graph.ts`. */
	_cached: T | typeof NO_VALUE;
	/** @internal Read externally via `get status()`. */
	_status: NodeStatus;
	protected _terminal = false;

	// --- Sink storage ---
	/** @internal Read by `graph/profile.ts` for subscriber counts. */
	_sinkCount = 0;
	protected _singleDepSinkCount = 0;
	protected _singleDepSinks = new WeakSet<NodeSink>();
	protected _sinks: NodeSink | Set<NodeSink> | null = null;

	// --- Actions + bound helpers ---
	protected readonly _actions: NodeActions;
	protected readonly _boundDownToSinks: (messages: Messages) => void;

	// --- Inspector hook (Graph observability) ---
	private _inspectorHook: NodeInspectorHook | undefined;

	constructor(opts: NodeOptions) {
		this._optsName = opts.name;
		this._describeKind = opts.describeKind;
		this._equals = opts.equals ?? Object.is;
		this._resubscribable = opts.resubscribable ?? false;
		this._resetOnTeardown = opts.resetOnTeardown ?? false;
		this._onResubscribe = opts.onResubscribe;
		this._onMessage = opts.onMessage;
		this._guard = opts.guard;

		// Cache pre-populated from `initial`, or SENTINEL.
		this._cached = "initial" in opts ? (opts.initial as T) : NO_VALUE;
		// Initial status: state with value starts settled, otherwise disconnected.
		this._status = "disconnected";

		// Versioning (GRAPHREFLY-SPEC §7)
		this._hashFn = opts.versioningHash ?? defaultHash;
		this._versioning =
			opts.versioning != null
				? createVersioning(opts.versioning, this._cached === NO_VALUE ? undefined : this._cached, {
						id: opts.versioningId,
						hash: this._hashFn,
					})
				: undefined;

		// Build companion meta nodes — dispatched to subclass to avoid
		// circular imports (node-base → node → node-base).
		const meta: Record<string, Node> = {};
		for (const [k, v] of Object.entries(opts.meta ?? {})) {
			meta[k] = this._createMetaNode(k, v, opts);
		}
		Object.freeze(meta);
		this.meta = meta;

		// Actions captured once — references `this` via an arrow/closure so
		// subclass hooks (e.g. `_onManualEmit`) fire on the right instance.
		const self = this;
		this._actions = {
			down(messages): void {
				self._onManualEmit();
				self._downInternal(messages);
			},
			emit(value): void {
				self._onManualEmit();
				self._downAutoValue(value);
			},
			up(messages): void {
				self._upInternal(messages);
			},
		};

		this._boundDownToSinks = this._downToSinks.bind(this);
	}

	/**
	 * Subclass hook invoked by `actions.down` / `actions.emit`. Default no-op;
	 * {@link NodeImpl} overrides to set `_manualEmitUsed`.
	 */
	protected _onManualEmit(): void {
		/* no-op */
	}

	/**
	 * Create a companion meta node. Called from the base constructor; must
	 * not touch subclass fields that haven't been initialized yet (safe to
	 * read from `opts`).
	 */
	protected abstract _createMetaNode(key: string, initialValue: unknown, opts: NodeOptions): Node;

	// --- Identity getters ---

	get name(): string | undefined {
		return this._registryName ?? this._optsName;
	}

	/** @internal Assigned by `Graph.add` when registered without an options `name`. */
	_assignRegistryName(localName: string): void {
		if (this._optsName !== undefined || this._registryName !== undefined) return;
		this._registryName = localName;
	}

	/**
	 * @internal Attach/remove inspector hook for graph-level observability.
	 * Returns a disposer that restores the previous hook.
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

	/** @internal Used by subclasses to surface inspector events. */
	protected _emitInspectorHook(event: NodeInspectorHookEvent): void {
		this._inspectorHook?.(event);
	}

	get status(): NodeStatus {
		return this._status;
	}

	get lastMutation(): Readonly<{ actor: Actor; timestamp_ns: number }> | undefined {
		return this._lastMutation;
	}

	get v(): Readonly<NodeVersionInfo> | undefined {
		return this._versioning;
	}

	/** @internal Used by `Graph.setVersioning` to retroactively apply versioning. */
	_applyVersioning(level: VersioningLevel, opts?: { id?: string; hash?: HashFn }): void {
		if (this._versioning != null) return;
		this._hashFn = opts?.hash ?? this._hashFn;
		this._versioning = createVersioning(
			level,
			this._cached === NO_VALUE ? undefined : this._cached,
			{
				id: opts?.id,
				hash: this._hashFn,
			},
		);
	}

	hasGuard(): boolean {
		return this._guard != null;
	}

	allowsObserve(actor: Actor): boolean {
		if (this._guard == null) return true;
		return this._guard(normalizeActor(actor), "observe");
	}

	// --- Public transport ---

	get(): T | undefined {
		return this._cached === NO_VALUE ? undefined : this._cached;
	}

	down(messages: Messages, options?: NodeTransportOptions): void {
		if (messages.length === 0) return;
		if (!options?.internal && this._guard != null) {
			const actor = normalizeActor(options?.actor);
			const delivery = options?.delivery ?? "write";
			const action: GuardAction = delivery === "signal" ? "signal" : "write";
			if (!this._guard(actor, action)) {
				throw new GuardDenied({ actor, action, nodeName: this.name });
			}
			this._recordMutation(actor);
		}
		this._downInternal(messages);
	}

	/** @internal Record a successful guarded mutation (called by `down` and subclass `up`). */
	protected _recordMutation(actor: Actor): void {
		this._lastMutation = { actor, timestamp_ns: wallClockNs() };
	}

	/** Abstract — subclasses forward messages to dependencies (or no-op for sources). */
	abstract up(messages: Messages, options?: NodeTransportOptions): void;

	/** Abstract — subclasses release upstream subscriptions (or no-op for sources). */
	abstract unsubscribe(): void;

	/** Internal upstream-send used by `actions.up`. */
	protected abstract _upInternal(messages: Messages): void;

	/** Called when `_sinkCount` transitions 0 → 1. */
	protected abstract _onActivate(): void;

	/** Called when `_sinkCount` transitions 1 → 0. */
	protected abstract _onDeactivate(): void;

	// --- Subscribe (uniform across node shapes) ---

	subscribe(sink: NodeSink, hints?: SubscribeHints): () => void {
		if (hints?.actor != null && this._guard != null) {
			const actor = normalizeActor(hints.actor);
			if (!this._guard(actor, "observe")) {
				throw new GuardDenied({ actor, action: "observe", nodeName: this.name });
			}
		}

		// Resubscribable terminal reset — clear terminal + cache, fire hook.
		if (this._terminal && this._resubscribable) {
			this._terminal = false;
			this._cached = NO_VALUE;
			this._status = "disconnected";
			this._onResubscribe?.();
		}

		this._sinkCount += 1;
		if (hints?.singleDep) {
			this._singleDepSinkCount += 1;
			this._singleDepSinks.add(sink);
		}

		// §2.2 START handshake — delivered BEFORE registering sink in
		// `_sinks` so that re-entrant `_downToSinks` calls during
		// activation cannot reach the new sink before it receives START
		// (spec §1.3.8: START precedes any other message on a subscription).
		//
		// Wire shape:
		//   SENTINEL cache → [[START]]
		//   cached value   → [[START], [DATA, cached]]
		//
		// DIRTY is intentionally NOT part of the handshake: nothing is
		// transitioning here, we're simply delivering the current state.
		// Downstream derived nodes mark both dirty+settled on DATA-without-
		// prior-DIRTY (spec §1.3.1 compat path), so wave tracking still
		// works without polluting observers with a spurious DIRTY.
		// §2.2 handshake: START (+ cached DATA if available). Terminal nodes
		// skip entirely — absence of START tells the subscriber the stream is
		// over (spec §2.2: "absence of START means the subscription was never
		// established or the node is terminal"). This is intentional: terminal
		// nodes release resources; replaying COMPLETE/ERROR to late subscribers
		// would require retaining the terminal cause indefinitely.
		if (!this._terminal) {
			const startMessages: Messages =
				this._cached === NO_VALUE ? [[START]] : [[START], [DATA, this._cached]];
			downWithBatch(sink, startMessages);
		}

		// Register sink in the singleton / set storage — AFTER START so
		// re-entrant `_downToSinks` during `_onActivate` can reach it.
		if (this._sinks == null) {
			this._sinks = sink;
		} else if (typeof this._sinks === "function") {
			this._sinks = new Set<NodeSink>([this._sinks, sink]);
		} else {
			this._sinks.add(sink);
		}

		// First subscriber triggers activation. May cause fn to run and emit
		// via `_downInternal` → `_downToSinks` to the new sink.
		if (this._sinkCount === 1 && !this._terminal) {
			this._onActivate();
		}

		// If activation did not produce a value (compute node blocked on
		// SENTINEL deps, or a source with no initial), surface "pending".
		if (!this._terminal && this._status === "disconnected" && this._cached === NO_VALUE) {
			this._status = "pending";
		}

		let removed = false;
		return () => {
			if (removed) return;
			removed = true;
			this._sinkCount -= 1;
			if (this._singleDepSinks.has(sink)) {
				this._singleDepSinkCount -= 1;
				this._singleDepSinks.delete(sink);
			}
			if (this._sinks == null) return;
			if (typeof this._sinks === "function") {
				if (this._sinks === sink) this._sinks = null;
			} else {
				this._sinks.delete(sink);
				if (this._sinks.size === 1) {
					const [only] = this._sinks;
					this._sinks = only;
				} else if (this._sinks.size === 0) {
					this._sinks = null;
				}
			}
			if (this._sinks == null) {
				this._onDeactivate();
			}
		};
	}

	// --- Down pipeline ---

	/**
	 * Core outgoing dispatch. Applies terminal filter + local lifecycle
	 * update, then hands messages to `downWithBatch` for tier-aware delivery.
	 */
	protected _downInternal(messages: Messages): void {
		if (messages.length === 0) return;
		let sinkMessages = messages;
		if (this._terminal && !this._resubscribable) {
			// After terminal, only TEARDOWN / INVALIDATE still propagate
			// (so graph teardown and cache-clear still work).
			const pass = messages.filter((m) => m[0] === TEARDOWN || m[0] === INVALIDATE);
			if (pass.length === 0) return;
			sinkMessages = pass as Messages;
		}
		this._handleLocalLifecycle(sinkMessages);
		// Single-dep DIRTY-skip optimization: when this node's only sink is
		// single-dep AND the batch contains a phase-2 message (DATA/RESOLVED),
		// strip DIRTY from the outgoing batch. The downstream learns of the
		// value via the phase-2 message directly.
		if (this._canSkipDirty()) {
			let hasPhase2 = false;
			for (let i = 0; i < sinkMessages.length; i++) {
				const t = sinkMessages[i][0];
				if (t === DATA || t === RESOLVED) {
					hasPhase2 = true;
					break;
				}
			}
			if (hasPhase2) {
				const filtered: Message[] = [];
				for (let i = 0; i < sinkMessages.length; i++) {
					if (sinkMessages[i][0] !== DIRTY) filtered.push(sinkMessages[i]);
				}
				if (filtered.length > 0) {
					downWithBatch(this._boundDownToSinks, filtered);
				}
				return;
			}
		}
		downWithBatch(this._boundDownToSinks, sinkMessages);
	}

	protected _canSkipDirty(): boolean {
		return this._sinkCount === 1 && this._singleDepSinkCount === 1;
	}

	protected _downToSinks(messages: Messages): void {
		if (this._sinks == null) return;
		if (typeof this._sinks === "function") {
			this._sinks(messages);
			return;
		}
		// Snapshot: a sink callback may unsubscribe itself or others mid-iteration.
		// Iterating the live Set would skip not-yet-visited sinks that were removed.
		const snapshot = [...this._sinks];
		for (const sink of snapshot) {
			sink(messages);
		}
	}

	/**
	 * Update `_cached`, `_status`, `_terminal` from message batch before
	 * delivery. Subclass hooks `_onInvalidate` / `_onTeardown` let
	 * {@link NodeImpl} clear `_lastDepValues` and invoke cleanup fns.
	 */
	protected _handleLocalLifecycle(messages: Messages): void {
		for (const m of messages) {
			const t = m[0];
			if (t === DATA) {
				if (m.length < 2) {
					// §1.2: bare [DATA] without payload is a protocol violation.
					continue;
				}
				this._cached = m[1] as T;
				if (this._versioning != null) {
					advanceVersion(this._versioning, m[1], this._hashFn);
				}
			}
			if (t === INVALIDATE) {
				this._onInvalidate();
				this._cached = NO_VALUE;
			}
			this._status = statusAfterMessage(this._status, m);
			if (t === COMPLETE || t === ERROR) {
				this._terminal = true;
			}
			if (t === TEARDOWN) {
				if (this._resetOnTeardown) {
					this._cached = NO_VALUE;
				}
				this._onTeardown();
				try {
					this._propagateToMeta(t);
				} finally {
					// Deactivate on teardown — releases upstream subs and
					// stops producers. Subclasses handle their own cleanup
					// inside `_onDeactivate`.
					this._onDeactivate();
				}
			}
			if (t !== TEARDOWN && propagatesToMeta(t)) {
				this._propagateToMeta(t);
			}
		}
	}

	/**
	 * Subclass hook: invoked when INVALIDATE arrives (before `_cached` is
	 * cleared). {@link NodeImpl} uses this to run the fn cleanup fn and
	 * drop `_lastDepValues` so the next wave re-runs fn.
	 */
	protected _onInvalidate(): void {
		/* no-op default */
	}

	/**
	 * Subclass hook: invoked when TEARDOWN arrives, before `_onDeactivate`.
	 * {@link NodeImpl} uses this to run any pending cleanup fn.
	 */
	protected _onTeardown(): void {
		/* no-op default */
	}

	/** Forward a signal to all companion meta nodes (best-effort). */
	protected _propagateToMeta(t: symbol): void {
		for (const metaNode of Object.values(this.meta)) {
			try {
				// Direct access through NodeBase — meta nodes are always NodeBase instances.
				(metaNode as NodeBase)._downInternal([[t]]);
			} catch {
				/* best-effort — other meta nodes still receive the signal */
			}
		}
	}

	/**
	 * Frame a computed value into the right protocol messages and dispatch
	 * via `_downInternal`. Used by `_runFn` and `actions.emit`.
	 */
	protected _downAutoValue(value: unknown): void {
		const wasDirty = this._status === "dirty";
		let unchanged: boolean;
		try {
			unchanged = this._cached !== NO_VALUE && this._equals(this._cached, value);
		} catch (eqErr) {
			const eqMsg = eqErr instanceof Error ? eqErr.message : String(eqErr);
			const wrapped = new Error(`Node "${this.name}": equals threw: ${eqMsg}`, {
				cause: eqErr,
			});
			this._downInternal([[ERROR, wrapped]]);
			return;
		}
		if (unchanged) {
			this._downInternal(wasDirty ? [[RESOLVED]] : [[DIRTY], [RESOLVED]]);
			return;
		}
		this._downInternal(wasDirty ? [[DATA, value]] : [[DIRTY], [DATA, value]]);
	}
}
