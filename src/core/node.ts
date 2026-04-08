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
	PAUSE,
	propagatesToMeta,
	RESOLVED,
	RESUME,
	TEARDOWN,
} from "./messages.js";
import type { HashFn, NodeVersionInfo, VersioningLevel } from "./versioning.js";
import { advanceVersion, createVersioning, defaultHash } from "./versioning.js";

/**
 * Internal sentinel value: "no cached value has been set or emitted."
 * Used instead of `undefined` so that `undefined` can be a valid emitted value.
 */
export const NO_VALUE: unique symbol = Symbol.for("graphrefly/NO_VALUE");

/**
 * Branded symbol that marks a {@link CleanupResult} wrapper.
 * Used internally by {@link cleanupResult} — prevents duck-type collisions
 * with domain objects that happen to have a `cleanup` property.
 */
export const CLEANUP_RESULT: unique symbol = Symbol.for("graphrefly/CLEANUP_RESULT");

/** Lifecycle status of a node. */
export type NodeStatus =
	| "disconnected"
	| "dirty"
	| "settled"
	| "resolved"
	| "completed"
	| "errored";

/** Callback that receives downstream message batches. */
export type NodeSink = (messages: Messages) => void;

/**
 * Compute function passed to `node()`.
 *
 * @returns A value to emit, `undefined` to skip emission, or a cleanup
 *   function invoked before the next run or on teardown.
 */
export type NodeFn<T = unknown> = (
	deps: readonly unknown[],
	actions: NodeActions,
) => T | undefined | (() => void);

/** Imperative actions available inside a {@link NodeFn}. */
export interface NodeActions {
	/** Emit raw messages downstream. */
	down(messages: Messages): void;
	/** Emit a single value (auto-wraps in DIRTY/DATA or DIRTY/RESOLVED). */
	emit(value: unknown): void;
	/** Send messages upstream toward sources. */
	up(messages: Messages): void;
}

/**
 * Callback for intercepting messages before the default dispatch.
 *
 * Called for every message from every dep. Return `true` to consume the
 * message (skip default handling), or `false` to let default dispatch run.
 *
 * @param msg      — The message tuple `[Type, Data?]`.
 * @param depIndex — Which dep sent it (index into the deps array).
 * @param actions  — `{ down(), emit(), up() }` — same as `NodeFn` receives.
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

/** Explicit describe `type` for {@link Graph.describe} / {@link describeNode} (GRAPHREFLY-SPEC Appendix B). */
export type NodeDescribeKind = "state" | "derived" | "producer" | "operator" | "effect";

/** Options for {@link node}. */
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
	 * unsubscribe the parent disconnects upstream but meta nodes stay alive.
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
	/**
	 * Opt-in versioning level (GRAPHREFLY-SPEC §7).
	 * - `0` (V0): `id` + `version` — identity & change detection.
	 * - `1` (V1): + `cid` + `prev` — content addressing & linked history.
	 */
	versioning?: VersioningLevel;
	/** Override auto-generated versioning id. */
	versioningId?: string;
	/** Custom hash function for V1 cid computation. */
	versioningHash?: HashFn;
}

/**
 * Options for {@link Node.down} / {@link Node.up} (actor context, graph delivery mode, internal bypass).
 */
export type NodeTransportOptions = {
	actor?: Actor;
	/**
	 * When `true`, skips guard checks (reactive internals, graph lifecycle TEARDOWN, etc.).
	 * Not for untrusted call sites.
	 */
	internal?: boolean;
	/**
	 * `signal` for {@link Graph.signal} deliveries; default `write` for {@link Graph.set} and direct `down`.
	 */
	delivery?: "write" | "signal";
};

/**
 * Optional hints passed to {@link Node.subscribe} to enable per-sink
 * optimizations.
 */
export interface SubscribeHints {
	/**
	 * Subscriber has exactly one dep with `fn` — the source may skip DIRTY
	 * dispatch when this is the sole subscriber. The subscriber synthesizes
	 * dirty state locally via `onDepSettled`.
	 */
	singleDep?: boolean;
	/**
	 * Actor to check against the node's `observe` guard.
	 * When set, `subscribe()` throws {@link GuardDenied} if the actor is not
	 * permitted to observe this node. Aligned with graphrefly-py `subscribe(actor=)`.
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
	/** Whether {@link NodeTransportOptions.actor | actor} may {@link Graph.observe | observe} this node. */
	allowsObserve(actor: Actor): boolean;
	/** Whether a {@link NodeOptions.guard | guard} is installed. */
	hasGuard(): boolean;
	/** Versioning info (GRAPHREFLY-SPEC §7). `undefined` when versioning is not enabled. */
	readonly v: Readonly<NodeVersionInfo> | undefined;
}

// --- Bitmask helpers: integer for <=31 deps, Uint32Array for >31 ---

interface BitSet {
	set(index: number): void;
	clear(index: number): void;
	has(index: number): boolean;
	/**
	 * True when all bits in `other` are also set in `this`.
	 * IMPORTANT: `other` must be the same concrete type (both IntBitSet or both
	 * ArrayBitSet). Cross-type calls will crash. Within `node()`, all masks for
	 * a given node share the same `createBitSet(deps.length)` factory, so this
	 * is always satisfied.
	 */
	covers(other: BitSet): boolean;
	/** True when at least one bit is set. */
	any(): boolean;
	reset(): void;
}

function createIntBitSet(): BitSet {
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
			return (
				(bits & (other as unknown as { _bits(): number })._bits()) ===
				(other as unknown as { _bits(): number })._bits()
			);
		},
		any() {
			return bits !== 0;
		},
		reset() {
			bits = 0;
		},
		_bits() {
			return bits;
		},
	} as BitSet & { _bits(): number };
}

function createArrayBitSet(size: number): BitSet {
	const words = new Uint32Array(Math.ceil(size / 32));
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
		_words: words,
	} as unknown as BitSet;
}

function createBitSet(size: number): BitSet {
	return size <= 31 ? createIntBitSet() : createArrayBitSet(size);
}

const isNodeArray = (value: unknown): value is readonly Node[] => Array.isArray(value);

const isNodeOptions = (value: unknown): value is NodeOptions =>
	typeof value === "object" && value != null && !Array.isArray(value);

/**
 * Explicit cleanup wrapper. When a node fn returns `{ cleanup, value? }`,
 * `cleanup` is registered as the teardown/recompute cleanup and `value`
 * (if present) is emitted as data. This avoids the ambiguity where returning
 * a plain function is silently consumed as cleanup instead of emitted as data.
 *
 * Use the {@link cleanupResult} factory to create instances — it stamps the
 * branded {@link CLEANUP_RESULT} symbol so that domain objects with a `cleanup`
 * property are never misinterpreted.
 *
 * Plain function returns are still treated as cleanup for backward compatibility.
 */
export type CleanupResult<T = unknown> = {
	readonly [CLEANUP_RESULT]: true;
	cleanup: () => void;
	value?: T;
};

/**
 * Create a branded {@link CleanupResult}.
 *
 * ```ts
 * node([dep], () => cleanupResult(() => release(), computedValue))
 * ```
 */
export function cleanupResult<T>(cleanup: () => void): CleanupResult<T>;
export function cleanupResult<T>(cleanup: () => void, value: T): CleanupResult<T>;
export function cleanupResult<T>(cleanup: () => void, ...args: [] | [T]): CleanupResult<T> {
	const r: CleanupResult<T> = { [CLEANUP_RESULT]: true, cleanup };
	if (args.length > 0) r.value = args[0];
	return r;
}

const isCleanupResult = (value: unknown): value is CleanupResult =>
	typeof value === "object" && value !== null && CLEANUP_RESULT in value;

const isCleanupFn = (value: unknown): value is () => void => typeof value === "function";

const statusAfterMessage = (status: NodeStatus, msg: Message): NodeStatus => {
	const t = msg[0];
	if (t === DIRTY) return "dirty";
	if (t === DATA) return "settled";
	if (t === RESOLVED) return "resolved";
	if (t === COMPLETE) return "completed";
	if (t === ERROR) return "errored";
	if (t === INVALIDATE) return "dirty";
	if (t === TEARDOWN) return "disconnected";
	return status;
};

// --- NodeImpl: class-based for V8 hidden class optimization and prototype method sharing ---

/**
 * Class-based implementation of the {@link Node} interface.
 *
 * All internal state lives on instance fields (`_` prefix, private by convention)
 * so that introspection (e.g. {@link describeNode}) can read them directly via
 * `instanceof NodeImpl` — no side-channel registry needed.
 *
 * Follows callbag-recharge's `ProducerImpl` pattern: V8 hidden class stability,
 * prototype method sharing, selective binding for commonly detached methods.
 */
export class NodeImpl<T = unknown> implements Node<T> {
	// --- Configuration (set once, never reassigned) ---
	private readonly _optsName: string | undefined;
	private _registryName: string | undefined;
	/** @internal — read by {@link describeNode} before inference. */
	readonly _describeKind: NodeDescribeKind | undefined;
	readonly meta: Record<string, Node>;
	_deps: readonly Node[];
	_fn: NodeFn<T> | undefined;
	_opts: NodeOptions;
	_equals: (a: unknown, b: unknown) => boolean;
	_onMessage: OnMessageHandler | undefined;
	/** @internal — read by {@link describeNode} for `accessHintForGuard`. */
	readonly _guard: NodeGuard | undefined;
	private _lastMutation: { actor: Actor; timestamp_ns: number } | undefined;
	_hasDeps: boolean;
	_autoComplete: boolean;
	_isSingleDep: boolean;

	// --- Mutable state ---
	_cached: T | typeof NO_VALUE;
	_status: NodeStatus;
	_terminal = false;
	_connected = false;
	_producerStarted = false;
	_connecting = false;
	_manualEmitUsed = false;
	_sinkCount = 0;
	_singleDepSinkCount = 0;

	// --- Object/collection state ---
	_depDirtyMask: BitSet;
	_depSettledMask: BitSet;
	_depCompleteMask: BitSet;
	_allDepsCompleteMask: BitSet;
	_lastDepValues: readonly unknown[] | undefined;
	_cleanup: (() => void) | undefined;
	_sinks: NodeSink | Set<NodeSink> | null = null;
	_singleDepSinks = new WeakSet<NodeSink>();
	_upstreamUnsubs: Array<() => void> = [];
	_actions: NodeActions;
	_boundDownToSinks: (messages: Messages) => void;
	private _inspectorHook: NodeInspectorHook | undefined;
	private _versioning: NodeVersionInfo | undefined;
	private _hashFn: HashFn;

	constructor(deps: readonly Node[], fn: NodeFn<T> | undefined, opts: NodeOptions) {
		this._deps = deps;
		this._fn = fn;
		this._opts = opts;
		this._optsName = opts.name;
		this._describeKind = opts.describeKind;
		this._equals = opts.equals ?? Object.is;
		this._onMessage = opts.onMessage;
		this._guard = opts.guard;
		this._hasDeps = deps.length > 0;
		this._autoComplete = opts.completeWhenDepsComplete ?? true;
		this._isSingleDep = deps.length === 1 && fn != null;

		this._cached = "initial" in opts ? (opts.initial as T) : NO_VALUE;
		this._status = this._hasDeps ? "disconnected" : "settled";

		// Versioning (GRAPHREFLY-SPEC §7)
		this._hashFn = opts.versioningHash ?? defaultHash;
		this._versioning =
			opts.versioning != null
				? createVersioning(opts.versioning, this._cached === NO_VALUE ? undefined : this._cached, {
						id: opts.versioningId,
						hash: this._hashFn,
					})
				: undefined;

		this._depDirtyMask = createBitSet(deps.length);
		this._depSettledMask = createBitSet(deps.length);
		this._depCompleteMask = createBitSet(deps.length);
		this._allDepsCompleteMask = createBitSet(deps.length);
		for (let i = 0; i < deps.length; i++) this._allDepsCompleteMask.set(i);

		// Build companion meta nodes
		const meta: Record<string, Node> = {};
		for (const [k, v] of Object.entries(opts.meta ?? {})) {
			meta[k] = node({
				initial: v,
				name: `${opts.name ?? "node"}:meta:${k}`,
				describeKind: "state",
				...(opts.guard != null ? { guard: opts.guard } : {}),
			});
		}
		Object.freeze(meta);
		this.meta = meta;

		// Actions object: created once, references `this` methods.
		// Captures `this` via arrow-in-object so manualEmitUsed is set on the instance.
		const self = this;
		this._actions = {
			down(messages): void {
				self._manualEmitUsed = true;
				self._downInternal(messages);
			},
			emit(value): void {
				self._manualEmitUsed = true;
				self._downAutoValue(value);
			},
			up(messages): void {
				self._upInternal(messages);
			},
		};

		// Bind commonly detached protocol methods
		this.down = this.down.bind(this);
		this.up = this.up.bind(this);
		this._boundDownToSinks = this._downToSinks.bind(this);
	}

	get name(): string | undefined {
		return this._registryName ?? this._optsName;
	}

	/**
	 * When a node is registered with {@link Graph.add} without an options `name`,
	 * the graph assigns the registry local name for introspection (parity with graphrefly-py).
	 */
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

	// --- Public interface (Node<T>) ---

	get status(): NodeStatus {
		return this._status;
	}

	get lastMutation(): Readonly<{ actor: Actor; timestamp_ns: number }> | undefined {
		return this._lastMutation;
	}

	get v(): Readonly<NodeVersionInfo> | undefined {
		return this._versioning;
	}

	/**
	 * Retroactively apply versioning to a node that was created without it.
	 * No-op if versioning is already enabled.
	 *
	 * Version starts at 0 regardless of prior DATA emissions — it tracks
	 * changes from the moment versioning is enabled, not historical ones.
	 *
	 * @internal — used by {@link Graph.setVersioning}.
	 */
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
			this._lastMutation = { actor, timestamp_ns: wallClockNs() };
		}
		this._downInternal(messages);
	}

	private _downInternal(messages: Messages): void {
		if (messages.length === 0) return;
		let lifecycleMessages = messages;
		let sinkMessages = messages;
		if (this._terminal && !this._opts.resubscribable) {
			const terminalPassthrough = messages.filter((m) => m[0] === TEARDOWN || m[0] === INVALIDATE);
			if (terminalPassthrough.length === 0) return;
			lifecycleMessages = terminalPassthrough;
			sinkMessages = terminalPassthrough;
		}
		this._handleLocalLifecycle(lifecycleMessages);
		// Single-dep optimization: skip DIRTY to sinks when sole subscriber is single-dep
		// AND the batch contains a phase-2 message (DATA/RESOLVED). Standalone DIRTY
		// (without follow-up) must pass through so downstream is notified.
		if (this._canSkipDirty()) {
			// Inline check: does the batch contain DATA or RESOLVED?
			let hasPhase2 = false;
			for (let i = 0; i < sinkMessages.length; i++) {
				const t = sinkMessages[i][0];
				if (t === DATA || t === RESOLVED) {
					hasPhase2 = true;
					break;
				}
			}
			if (hasPhase2) {
				// Inline filter: remove DIRTY messages
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

	subscribe(sink: NodeSink, hints?: SubscribeHints): () => void {
		if (hints?.actor != null && this._guard != null) {
			const actor = normalizeActor(hints.actor);
			if (!this._guard(actor, "observe")) {
				throw new GuardDenied({ actor, action: "observe", nodeName: this.name });
			}
		}

		if (this._terminal && this._opts.resubscribable) {
			this._terminal = false;
			this._cached = NO_VALUE;
			this._status = this._hasDeps ? "disconnected" : "settled";
			this._opts.onResubscribe?.();
		}

		this._sinkCount += 1;
		if (hints?.singleDep) {
			this._singleDepSinkCount += 1;
			this._singleDepSinks.add(sink);
		}

		if (this._sinks == null) {
			this._sinks = sink;
		} else if (typeof this._sinks === "function") {
			this._sinks = new Set<NodeSink>([this._sinks, sink]);
		} else {
			this._sinks.add(sink);
		}

		if (this._hasDeps) {
			this._connectUpstream();
		} else if (this._fn) {
			this._startProducer();
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
				this._disconnectUpstream();
				this._stopProducer();
			}
		};
	}

	up(messages: Messages, options?: NodeTransportOptions): void {
		if (!this._hasDeps) return;
		if (!options?.internal && this._guard != null) {
			const actor = normalizeActor(options?.actor);
			if (!this._guard(actor, "write")) {
				throw new GuardDenied({ actor, action: "write", nodeName: this.name });
			}
			this._lastMutation = { actor, timestamp_ns: wallClockNs() };
		}
		for (const dep of this._deps) {
			if (options === undefined) {
				dep.up?.(messages);
			} else {
				dep.up?.(messages, options);
			}
		}
	}

	private _upInternal(messages: Messages): void {
		if (!this._hasDeps) return;
		for (const dep of this._deps) {
			dep.up?.(messages, { internal: true });
		}
	}

	unsubscribe(): void {
		if (!this._hasDeps) return;
		this._disconnectUpstream();
	}

	// --- Private methods (prototype, _ prefix) ---

	_downToSinks(messages: Messages): void {
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

	_handleLocalLifecycle(messages: Messages): void {
		for (const m of messages) {
			const t = m[0];
			if (t === DATA) {
				if (m.length < 2) {
					// GRAPHREFLY-SPEC §1.2: bare [DATA] without payload is a protocol violation.
					continue;
				}
				this._cached = m[1] as T;
				if (this._versioning != null) {
					advanceVersion(this._versioning, m[1], this._hashFn);
				}
			}
			if (t === INVALIDATE) {
				// GRAPHREFLY-SPEC §1.2: clear cached state; do not auto-emit from here.
				const cleanupFn = this._cleanup;
				this._cleanup = undefined;
				cleanupFn?.();
				this._cached = NO_VALUE;
				this._lastDepValues = undefined;
			}
			this._status = statusAfterMessage(this._status, m);
			if (t === COMPLETE || t === ERROR) {
				this._terminal = true;
			}
			if (t === TEARDOWN) {
				if (this._opts.resetOnTeardown) {
					this._cached = NO_VALUE;
				}
				// Invoke cleanup for compute nodes (deps+fn) — spec §2.4
				// requires cleanup on teardown, not just before next invocation.
				// _stopProducer handles cleanup for producer nodes separately.
				const teardownCleanup = this._cleanup;
				this._cleanup = undefined;
				teardownCleanup?.();
				try {
					this._propagateToMeta(t);
				} finally {
					this._disconnectUpstream();
					this._stopProducer();
				}
			}
			// Propagate other meta-eligible signals (centralized in messages.ts).
			if (t !== TEARDOWN && propagatesToMeta(t)) {
				this._propagateToMeta(t);
			}
		}
	}

	/** Propagate a signal to all companion meta nodes (best-effort). */
	_propagateToMeta(t: symbol): void {
		for (const metaNode of Object.values(this.meta)) {
			try {
				(metaNode as NodeImpl)._downInternal([[t]]);
			} catch {
				/* best-effort: other meta nodes still receive the signal */
			}
		}
	}

	_canSkipDirty(): boolean {
		return this._sinkCount === 1 && this._singleDepSinkCount === 1;
	}

	_downAutoValue(value: unknown): void {
		const wasDirty = this._status === "dirty";
		// §2.5: equals() only compares two real values. NO_VALUE sentinel means
		// "never emitted / cache cleared" — first emission always treated as changed.
		let unchanged: boolean;
		try {
			unchanged = this._cached !== NO_VALUE && this._equals(this._cached, value);
		} catch (eqErr) {
			const eqMsg = eqErr instanceof Error ? eqErr.message : String(eqErr);
			const wrapped = new Error(`Node "${this.name}": equals threw: ${eqMsg}`, { cause: eqErr });
			this._downInternal([[ERROR, wrapped]]);
			return;
		}
		if (unchanged) {
			this._downInternal(wasDirty ? [[RESOLVED]] : [[DIRTY], [RESOLVED]]);
			return;
		}
		// _handleLocalLifecycle (called by _downInternal) sets _cached from the DATA payload.
		this._downInternal(wasDirty ? [[DATA, value]] : [[DIRTY], [DATA, value]]);
	}

	_runFn(): void {
		if (!this._fn) return;
		if (this._terminal && !this._opts.resubscribable) return;
		if (this._connecting) return;

		try {
			const n = this._deps.length;
			const depValues = new Array(n);
			for (let i = 0; i < n; i++) depValues[i] = this._deps[i].get();
			// Identity check BEFORE cleanup: if all dep values are unchanged,
			// skip cleanup+fn entirely so effect nodes don't teardown/restart on no-op.
			const prev = this._lastDepValues;
			if (n > 0 && prev != null && prev.length === n) {
				let allSame = true;
				for (let i = 0; i < n; i++) {
					if (!Object.is(depValues[i], prev[i])) {
						allSame = false;
						break;
					}
				}
				if (allSame) {
					if (this._status === "dirty") {
						this._downInternal([[RESOLVED]]);
					}
					return;
				}
			}
			const prevCleanup = this._cleanup;
			this._cleanup = undefined;
			prevCleanup?.();
			this._manualEmitUsed = false;
			this._lastDepValues = depValues;
			this._inspectorHook?.({ kind: "run", depValues });
			const out = this._fn(depValues, this._actions);
			// Explicit cleanup wrapper: { cleanup, value? }
			if (isCleanupResult(out)) {
				this._cleanup = out.cleanup;
				if (this._manualEmitUsed) return;
				if ("value" in out) {
					this._downAutoValue(out.value);
				}
				return;
			}
			// Legacy: plain function return → cleanup (backward compat)
			if (isCleanupFn(out)) {
				this._cleanup = out;
				return;
			}
			if (this._manualEmitUsed) return;
			if (out === undefined) return;
			this._downAutoValue(out);
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			const wrapped = new Error(`Node "${this.name}": fn threw: ${errMsg}`, { cause: err });
			this._downInternal([[ERROR, wrapped]]);
		}
	}

	_onDepDirty(index: number): void {
		const wasDirty = this._depDirtyMask.has(index);
		this._depDirtyMask.set(index);
		this._depSettledMask.clear(index);
		if (!wasDirty) {
			this._downInternal([[DIRTY]]);
		}
	}

	_onDepSettled(index: number): void {
		if (!this._depDirtyMask.has(index)) {
			this._onDepDirty(index);
		}
		this._depSettledMask.set(index);
		if (this._depDirtyMask.any() && this._depSettledMask.covers(this._depDirtyMask)) {
			this._depDirtyMask.reset();
			this._depSettledMask.reset();
			this._runFn();
		}
	}

	_maybeCompleteFromDeps(): void {
		if (
			this._autoComplete &&
			this._deps.length > 0 &&
			this._depCompleteMask.covers(this._allDepsCompleteMask)
		) {
			this._downInternal([[COMPLETE]]);
		}
	}

	_handleDepMessages(index: number, messages: Messages): void {
		for (const msg of messages) {
			this._inspectorHook?.({ kind: "dep_message", depIndex: index, message: msg });
			const t = msg[0];
			// User-defined message handler gets first look (spec §2.6).
			if (this._onMessage) {
				try {
					if (this._onMessage(msg, index, this._actions)) continue;
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					const wrapped = new Error(`Node "${this.name}": onMessage threw: ${errMsg}`, {
						cause: err,
					});
					this._downInternal([[ERROR, wrapped]]);
					return;
				}
			}
			if (!this._fn) {
				// Passthrough: forward all messages except COMPLETE when multi-dep.
				// Multi-dep passthrough must wait for ALL deps to complete (§1.3.5).
				if (t === COMPLETE && this._deps.length > 1) {
					this._depCompleteMask.set(index);
					this._maybeCompleteFromDeps();
					continue;
				}
				this._downInternal([msg]);
				continue;
			}
			if (t === DIRTY) {
				this._onDepDirty(index);
				continue;
			}
			if (t === DATA || t === RESOLVED) {
				this._onDepSettled(index);
				continue;
			}
			if (t === COMPLETE) {
				this._depCompleteMask.set(index);
				// Complete implies no longer pending — clear dirty/settled bits
				// so a preceding DIRTY from this dep doesn't block settlement.
				this._depDirtyMask.clear(index);
				this._depSettledMask.clear(index);
				if (this._depDirtyMask.any() && this._depSettledMask.covers(this._depDirtyMask)) {
					this._depDirtyMask.reset();
					this._depSettledMask.reset();
					this._runFn();
				} else if (!this._depDirtyMask.any() && this._status === "dirty") {
					// D2: dep went DIRTY→COMPLETE without DATA — node was marked
					// dirty but no settlement came.  Recompute so downstream
					// gets RESOLVED (value unchanged) or DATA (value changed).
					this._depSettledMask.reset();
					this._runFn();
				}
				this._maybeCompleteFromDeps();
				continue;
			}
			if (t === ERROR) {
				this._downInternal([msg]);
				continue;
			}
			if (t === INVALIDATE || t === TEARDOWN || t === PAUSE || t === RESUME) {
				this._downInternal([msg]);
				continue;
			}
			// Forward unknown message types
			this._downInternal([msg]);
		}
	}

	_connectUpstream(): void {
		if (!this._hasDeps || this._connected) return;
		this._connected = true;
		this._depDirtyMask.reset();
		this._depSettledMask.reset();
		this._depCompleteMask.reset();
		this._status = "settled";
		const subHints: SubscribeHints | undefined = this._isSingleDep
			? { singleDep: true }
			: undefined;
		this._connecting = true;
		try {
			for (let i = 0; i < this._deps.length; i += 1) {
				const dep = this._deps[i];
				this._upstreamUnsubs.push(
					dep.subscribe((msgs) => this._handleDepMessages(i, msgs), subHints),
				);
			}
		} finally {
			this._connecting = false;
		}
		if (this._fn) {
			this._runFn();
		}
	}

	_stopProducer(): void {
		if (!this._producerStarted) return;
		this._producerStarted = false;
		const producerCleanup = this._cleanup;
		this._cleanup = undefined;
		producerCleanup?.();
	}

	_startProducer(): void {
		if (this._deps.length !== 0 || !this._fn || this._producerStarted) return;
		this._producerStarted = true;
		this._runFn();
	}

	_disconnectUpstream(): void {
		if (!this._connected) return;
		for (const unsub of this._upstreamUnsubs.splice(0)) {
			unsub();
		}
		this._connected = false;
		this._depDirtyMask.reset();
		this._depSettledMask.reset();
		this._depCompleteMask.reset();
		this._status = "disconnected";
	}
}

/**
 * Creates a reactive {@link Node} — the single GraphReFly primitive (GRAPHREFLY-SPEC §2).
 *
 * Typical shapes: `node([])` / `node([], opts)` for a manual source; `node(producerFn, opts)` for a
 * producer; `node(deps, computeFn, opts)` for derived nodes and operators.
 *
 * @param depsOrFn - Dependency nodes, a {@link NodeFn} (producer), or {@link NodeOptions} alone.
 * @param fnOrOpts - With deps: compute function or options. Omitted for producer-only form.
 * @param optsArg - Options when both `deps` and `fn` are provided.
 * @returns `Node<T>` - Configured node instance (lazy until subscribed).
 *
 * @remarks
 * **Protocol:** DIRTY / DATA / RESOLVED ordering, completion, and batch deferral follow `~/src/graphrefly/GRAPHREFLY-SPEC.md`.
 *
 * **`equals` and mutable values:** The default `Object.is` identity check is
 * correct for the common immutable-value case. If your node produces mutable
 * objects (e.g. arrays or maps mutated in place), provide a custom `equals`
 * function — otherwise `Object.is` will always return `true` for the same
 * reference and the node will emit `RESOLVED` instead of `DATA`.
 *
 * @example
 * ```ts
 * import { node, state } from "@graphrefly/graphrefly-ts";
 *
 * const a = state(1);
 * const b = node([a], ([x]) => (x as number) + 1);
 * ```
 *
 * @seeAlso [Specification](/spec)
 *
 * @category core
 */
export function node<T = unknown>(
	depsOrFn?: readonly Node[] | NodeFn<T> | NodeOptions,
	fnOrOpts?: NodeFn<T> | NodeOptions,
	optsArg?: NodeOptions,
): Node<T> {
	const deps: readonly Node[] = isNodeArray(depsOrFn) ? depsOrFn : [];
	const fn: NodeFn<T> | undefined =
		typeof depsOrFn === "function"
			? depsOrFn
			: typeof fnOrOpts === "function"
				? fnOrOpts
				: undefined;
	let opts: NodeOptions = {};
	if (isNodeArray(depsOrFn)) {
		opts = (isNodeOptions(fnOrOpts) ? fnOrOpts : optsArg) ?? {};
	} else if (isNodeOptions(depsOrFn)) {
		opts = depsOrFn;
	} else {
		opts = (isNodeOptions(fnOrOpts) ? fnOrOpts : optsArg) ?? {};
	}

	return new NodeImpl<T>(deps, fn, opts);
}
