import { emitWithBatch } from "./batch.js";
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
	TEARDOWN,
} from "./messages.js";

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

/** Options for {@link node}. */
export interface NodeOptions {
	name?: string;
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
	/** Clear cached value on TEARDOWN. */
	resetOnTeardown?: boolean;
	/**
	 * When `true` (default), auto-emit `[[COMPLETE]]` when all deps complete
	 * (spec §1.3.5). Set `false` for derived/operator nodes that should not
	 * auto-complete.
	 */
	completeWhenDepsComplete?: boolean;
}

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
}

/** A reactive node in the GraphReFly protocol. */
export interface Node<T = unknown> {
	readonly name?: string;
	readonly status: NodeStatus;
	readonly meta: Record<string, Node>;
	/** Returns the current cached value. */
	get(): T | undefined;
	/** Push messages downstream. */
	down(messages: Messages): void;
	/**
	 * Registers a sink to receive downstream messages.
	 *
	 * @param sink - Callback receiving message batches.
	 * @param hints - Optional optimization hints (e.g. `{ singleDep: true }`).
	 * @returns An unsubscribe function (idempotent).
	 */
	subscribe(sink: NodeSink, hints?: SubscribeHints): () => void;
	/** Send messages upstream (present on nodes with deps). */
	up?: (messages: Messages) => void;
	/** Disconnect from upstream deps (present on nodes with deps). */
	unsubscribe?: () => void;
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
	readonly name: string | undefined;
	readonly meta: Record<string, Node>;
	_deps: readonly Node[];
	_fn: NodeFn<T> | undefined;
	_opts: NodeOptions;
	_equals: (a: unknown, b: unknown) => boolean;
	_hasDeps: boolean;
	_autoComplete: boolean;
	_isSingleDep: boolean;

	// --- Mutable state ---
	_cached: T | undefined;
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
	_boundEmitToSinks: (messages: Messages) => void;

	constructor(deps: readonly Node[], fn: NodeFn<T> | undefined, opts: NodeOptions) {
		this._deps = deps;
		this._fn = fn;
		this._opts = opts;
		this.name = opts.name;
		this._equals = opts.equals ?? Object.is;
		this._hasDeps = deps.length > 0;
		this._autoComplete = opts.completeWhenDepsComplete ?? true;
		this._isSingleDep = deps.length === 1 && fn != null;

		this._cached = opts.initial as T | undefined;
		this._status = this._hasDeps ? "disconnected" : "settled";

		this._depDirtyMask = createBitSet(deps.length);
		this._depSettledMask = createBitSet(deps.length);
		this._depCompleteMask = createBitSet(deps.length);
		this._allDepsCompleteMask = createBitSet(deps.length);
		for (let i = 0; i < deps.length; i++) this._allDepsCompleteMask.set(i);

		// Build companion meta nodes
		const meta: Record<string, Node> = {};
		for (const [k, v] of Object.entries(opts.meta ?? {})) {
			meta[k] = node({ initial: v, name: `${opts.name ?? "node"}:meta:${k}` });
		}
		Object.freeze(meta);
		this.meta = meta;

		// Actions object: created once, references `this` methods.
		// Captures `this` via arrow-in-object so manualEmitUsed is set on the instance.
		const self = this;
		this._actions = {
			down(messages): void {
				self._manualEmitUsed = true;
				self.down(messages);
			},
			emit(value): void {
				self._manualEmitUsed = true;
				self._emitAutoValue(value);
			},
			up(messages): void {
				self.up(messages);
			},
		};

		// Bind commonly detached protocol methods
		this.down = this.down.bind(this);
		this.up = this.up.bind(this);
		this._boundEmitToSinks = this._emitToSinks.bind(this);
	}

	// --- Public interface (Node<T>) ---

	get status(): NodeStatus {
		return this._status;
	}

	get(): T | undefined {
		return this._cached;
	}

	down(messages: Messages): void {
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
		if (this._canSkipDirty() && sinkMessages.some((m) => m[0] === DATA || m[0] === RESOLVED)) {
			const filtered = sinkMessages.filter((m) => m[0] !== DIRTY);
			if (filtered.length > 0) {
				emitWithBatch(this._boundEmitToSinks, filtered);
			}
		} else {
			emitWithBatch(this._boundEmitToSinks, sinkMessages);
		}
	}

	subscribe(sink: NodeSink, hints?: SubscribeHints): () => void {
		if (this._terminal && this._opts.resubscribable) {
			this._terminal = false;
			this._status = this._hasDeps ? "disconnected" : "settled";
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

	up(messages: Messages): void {
		if (!this._hasDeps) return;
		for (const dep of this._deps) {
			dep.up?.(messages);
		}
	}

	unsubscribe(): void {
		if (!this._hasDeps) return;
		this._disconnectUpstream();
	}

	// --- Private methods (prototype, _ prefix) ---

	_emitToSinks(messages: Messages): void {
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
				this._cached = m[1] as T;
			}
			if (t === INVALIDATE) {
				// GRAPHREFLY-SPEC §1.2: clear cached state; do not auto-emit from here.
				this._cleanup?.();
				this._cleanup = undefined;
				this._cached = undefined;
				this._lastDepValues = undefined;
			}
			this._status = statusAfterMessage(this._status, m);
			if (t === COMPLETE || t === ERROR) {
				this._terminal = true;
			}
			if (t === TEARDOWN) {
				if (this._opts.resetOnTeardown) {
					this._cached = undefined;
				}
				// Propagate TEARDOWN to companion meta nodes so their
				// subscribers are notified and resources released (§5.1).
				// COMPLETE/ERROR are intentionally NOT propagated — meta
				// stores outlive the parent's terminal state to allow
				// post-mortem writes (e.g. setting meta.error after ERROR).
				try {
					for (const metaNode of Object.values(this.meta)) {
						try {
							metaNode.down([[TEARDOWN]]);
						} catch {
							/* best-effort: other meta nodes still receive TEARDOWN */
						}
					}
				} finally {
					this._disconnectUpstream();
					this._stopProducer();
				}
			}
		}
	}

	_canSkipDirty(): boolean {
		return this._sinkCount === 1 && this._singleDepSinkCount === 1;
	}

	_emitAutoValue(value: unknown): void {
		const wasDirty = this._status === "dirty";
		const unchanged = this._equals(this._cached, value);
		if (unchanged) {
			this.down(wasDirty ? [[RESOLVED]] : [[DIRTY], [RESOLVED]]);
			return;
		}
		this._cached = value as T;
		this.down(wasDirty ? [[DATA, value]] : [[DIRTY], [DATA, value]]);
	}

	_runFn(): void {
		if (!this._fn) return;
		if (this._terminal && !this._opts.resubscribable) return;
		if (this._connecting) return;

		try {
			const depValues = this._deps.map((dep) => dep.get());
			// Identity check BEFORE cleanup: if all dep values are unchanged,
			// skip cleanup+fn entirely so effect nodes don't teardown/restart on no-op.
			if (
				depValues.length > 0 &&
				this._lastDepValues != null &&
				this._lastDepValues.length === depValues.length &&
				depValues.every((v, i) => Object.is(v, this._lastDepValues?.[i]))
			) {
				if (this._status === "dirty") {
					this.down([[RESOLVED]]);
				}
				return;
			}
			this._cleanup?.();
			this._cleanup = undefined;
			this._manualEmitUsed = false;
			this._lastDepValues = depValues;
			const out = this._fn(depValues, this._actions);
			if (isCleanupFn(out)) {
				this._cleanup = out;
				return;
			}
			if (this._manualEmitUsed) return;
			if (out === undefined) return;
			this._emitAutoValue(out);
		} catch (err) {
			this.down([[ERROR, err]]);
		}
	}

	_onDepDirty(index: number): void {
		const wasDirty = this._depDirtyMask.has(index);
		this._depDirtyMask.set(index);
		this._depSettledMask.clear(index);
		if (!wasDirty) {
			this.down([[DIRTY]]);
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
			this.down([[COMPLETE]]);
		}
	}

	_handleDepMessages(index: number, messages: Messages): void {
		for (const msg of messages) {
			const t = msg[0];
			if (!this._fn) {
				// Passthrough: forward all messages except COMPLETE when multi-dep.
				// Multi-dep passthrough must wait for ALL deps to complete (§1.3.5).
				if (t === COMPLETE && this._deps.length > 1) {
					this._depCompleteMask.set(index);
					this._maybeCompleteFromDeps();
					continue;
				}
				this.down([msg]);
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
				this.down([msg]);
				continue;
			}
			if (t === INVALIDATE || t === TEARDOWN || t === PAUSE || t === RESUME) {
				this.down([msg]);
				continue;
			}
			// Forward unknown message types
			this.down([msg]);
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
		this._cleanup?.();
		this._cleanup = undefined;
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
