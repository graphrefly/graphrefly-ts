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

	const equals = opts.equals ?? Object.is;
	const hasDeps = deps.length > 0;
	const autoComplete = opts.completeWhenDepsComplete ?? true;

	let cached = opts.initial as T | undefined;
	let status: NodeStatus = hasDeps ? "disconnected" : "settled";
	let terminal = false;
	let connected = false;
	const depDirtyMask = createBitSet(deps.length);
	const depSettledMask = createBitSet(deps.length);
	const depCompleteMask = createBitSet(deps.length);
	let lastDepValues: readonly unknown[] | undefined;
	let cleanup: (() => void) | undefined;
	let producerStarted = false;
	let connecting = false;
	let sinks: NodeSink | Set<NodeSink> | null = null;
	let singleDepSinkCount = 0;
	let sinkCount = 0;

	const upstreamUnsubs: Array<() => void> = [];

	const meta: Record<string, Node> = {};
	for (const [k, v] of Object.entries(opts.meta ?? {})) {
		meta[k] = node({ initial: v, name: `${opts.name ?? "node"}:meta:${k}` });
	}
	Object.freeze(meta);

	const emitToSinks = (messages: Messages): void => {
		if (sinks == null) return;
		if (typeof sinks === "function") {
			sinks(messages);
			return;
		}
		// Snapshot: a sink callback may unsubscribe itself or others mid-iteration.
		// Iterating the live Set would skip not-yet-visited sinks that were removed.
		const snapshot = [...sinks];
		for (const sink of snapshot) {
			sink(messages);
		}
	};

	const handleLocalLifecycle = (messages: Messages): void => {
		for (const m of messages) {
			const t = m[0];
			if (t === DATA) {
				cached = m[1] as T;
			}
			status = statusAfterMessage(status, m);
			if (t === COMPLETE || t === ERROR) {
				terminal = true;
			}
			if (t === TEARDOWN) {
				if (opts.resetOnTeardown) {
					cached = undefined;
				}
				// Propagate TEARDOWN to companion meta nodes so their
				// subscribers are notified and resources released (§5.1).
				// COMPLETE/ERROR are intentionally NOT propagated — meta
				// stores outlive the parent's terminal state to allow
				// post-mortem writes (e.g. setting meta.error after ERROR).
				try {
					for (const metaNode of Object.values(meta)) {
						try {
							metaNode.down([[TEARDOWN]]);
						} catch {
							/* best-effort: other meta nodes still receive TEARDOWN */
						}
					}
				} finally {
					disconnectUpstream();
					stopProducer();
				}
			}
		}
	};

	const canSkipDirty = (): boolean => sinkCount === 1 && singleDepSinkCount === 1;

	const down = (messages: Messages): void => {
		if (messages.length === 0) return;
		let lifecycleMessages = messages;
		let sinkMessages = messages;
		if (terminal && !opts.resubscribable) {
			const teardownOnly = messages.filter((m) => m[0] === TEARDOWN);
			if (teardownOnly.length === 0) return;
			lifecycleMessages = teardownOnly;
			sinkMessages = teardownOnly;
		}
		handleLocalLifecycle(lifecycleMessages);
		// Single-dep optimization: skip DIRTY to sinks when sole subscriber is single-dep
		// AND the batch contains a phase-2 message (DATA/RESOLVED). Standalone DIRTY
		// (without follow-up) must pass through so downstream is notified.
		if (canSkipDirty() && sinkMessages.some((m) => m[0] === DATA || m[0] === RESOLVED)) {
			const filtered = sinkMessages.filter((m) => m[0] !== DIRTY);
			if (filtered.length > 0) {
				emitWithBatch(emitToSinks, filtered);
			}
		} else {
			emitWithBatch(emitToSinks, sinkMessages);
		}
	};

	const emitAutoValue = (value: unknown): void => {
		const wasDirty = status === "dirty";
		const unchanged = equals(cached, value);
		if (unchanged) {
			down(wasDirty ? [[RESOLVED]] : [[DIRTY], [RESOLVED]]);
			return;
		}
		cached = value as T;
		down(wasDirty ? [[DATA, value]] : [[DIRTY], [DATA, value]]);
	};

	let manualEmitUsed = false;

	const actions: NodeActions = {
		down(messages): void {
			manualEmitUsed = true;
			down(messages);
		},
		emit(value): void {
			manualEmitUsed = true;
			emitAutoValue(value);
		},
		up(messages): void {
			if (!hasDeps) return;
			for (const dep of deps) {
				dep.up?.(messages);
			}
		},
	};

	const runFn = (): void => {
		if (!fn) return;
		if (terminal && !opts.resubscribable) return;
		if (connecting) return;

		cleanup?.();
		cleanup = undefined;
		manualEmitUsed = false;

		try {
			const depValues = deps.map((dep) => dep.get());
			if (
				depValues.length > 0 &&
				lastDepValues != null &&
				lastDepValues.length === depValues.length &&
				depValues.every((v, i) => Object.is(v, lastDepValues?.[i]))
			) {
				if (status === "dirty") {
					down([[RESOLVED]]);
				}
				return;
			}
			lastDepValues = depValues;
			const out = fn(depValues, actions);
			if (isCleanupFn(out)) {
				cleanup = out;
				return;
			}
			if (manualEmitUsed) return;
			if (out === undefined) return;
			emitAutoValue(out);
		} catch (err) {
			down([[ERROR, err]]);
		}
	};

	const onDepDirty = (index: number): void => {
		const wasDirty = depDirtyMask.has(index);
		depDirtyMask.set(index);
		depSettledMask.clear(index);
		if (!wasDirty) {
			down([[DIRTY]]);
		}
	};

	const onDepSettled = (index: number): void => {
		if (!depDirtyMask.has(index)) {
			onDepDirty(index);
		}
		depSettledMask.set(index);
		if (depDirtyMask.any() && depSettledMask.covers(depDirtyMask)) {
			depDirtyMask.reset();
			depSettledMask.reset();
			runFn();
		}
	};

	const forwardUnknown = (msg: Message): void => {
		down([msg]);
	};

	const allDepsCompleteMask = createBitSet(deps.length);
	for (let i = 0; i < deps.length; i++) allDepsCompleteMask.set(i);

	const maybeCompleteFromDeps = (): void => {
		if (autoComplete && deps.length > 0 && depCompleteMask.covers(allDepsCompleteMask)) {
			down([[COMPLETE]]);
		}
	};

	const handleDepMessages = (index: number, messages: Messages): void => {
		for (const msg of messages) {
			const t = msg[0];
			if (!fn) {
				// Passthrough: forward all messages except COMPLETE when multi-dep.
				// Multi-dep passthrough must wait for ALL deps to complete (§1.3.5).
				if (t === COMPLETE && deps.length > 1) {
					depCompleteMask.set(index);
					maybeCompleteFromDeps();
					continue;
				}
				down([msg]);
				continue;
			}
			if (t === DIRTY) {
				onDepDirty(index);
				continue;
			}
			if (t === DATA || t === RESOLVED) {
				onDepSettled(index);
				continue;
			}
			if (t === COMPLETE) {
				depCompleteMask.set(index);
				// Complete implies no longer pending — clear dirty/settled bits
				// so a preceding DIRTY from this dep doesn't block settlement.
				depDirtyMask.clear(index);
				depSettledMask.clear(index);
				if (depDirtyMask.any() && depSettledMask.covers(depDirtyMask)) {
					depDirtyMask.reset();
					depSettledMask.reset();
					runFn();
				} else if (!depDirtyMask.any() && status === "dirty") {
					// D2: dep went DIRTY→COMPLETE without DATA — node was marked
					// dirty but no settlement came.  Recompute so downstream
					// gets RESOLVED (value unchanged) or DATA (value changed).
					depSettledMask.reset();
					runFn();
				}
				maybeCompleteFromDeps();
				continue;
			}
			if (t === ERROR) {
				down([msg]);
				continue;
			}
			if (t === INVALIDATE || t === TEARDOWN || t === PAUSE || t === RESUME) {
				down([msg]);
				continue;
			}
			forwardUnknown(msg);
		}
	};

	const isSingleDep = deps.length === 1 && fn != null;

	function connectUpstream(): void {
		if (!hasDeps || connected) return;
		connected = true;
		depDirtyMask.reset();
		depSettledMask.reset();
		depCompleteMask.reset();
		status = "settled";
		const subHints: SubscribeHints | undefined = isSingleDep ? { singleDep: true } : undefined;
		connecting = true;
		try {
			for (let i = 0; i < deps.length; i += 1) {
				const dep = deps[i];
				upstreamUnsubs.push(dep.subscribe((msgs) => handleDepMessages(i, msgs), subHints));
			}
		} finally {
			connecting = false;
		}
		if (fn) {
			runFn();
		}
	}

	function stopProducer(): void {
		if (!producerStarted) return;
		producerStarted = false;
		cleanup?.();
		cleanup = undefined;
	}

	function startProducer(): void {
		if (deps.length !== 0 || !fn || producerStarted) return;
		producerStarted = true;
		runFn();
	}

	function disconnectUpstream(): void {
		if (!connected) return;
		for (const unsub of upstreamUnsubs.splice(0)) {
			unsub();
		}
		connected = false;
		depDirtyMask.reset();
		depSettledMask.reset();
		depCompleteMask.reset();
		status = "disconnected";
	}

	const singleDepSinks = new WeakSet<NodeSink>();

	const subscribe = (sink: NodeSink, hints?: SubscribeHints): (() => void) => {
		if (terminal && opts.resubscribable) {
			terminal = false;
			status = hasDeps ? "disconnected" : "settled";
		}

		sinkCount += 1;
		if (hints?.singleDep) {
			singleDepSinkCount += 1;
			singleDepSinks.add(sink);
		}

		if (sinks == null) {
			sinks = sink;
		} else if (typeof sinks === "function") {
			sinks = new Set<NodeSink>([sinks, sink]);
		} else {
			sinks.add(sink);
		}

		if (hasDeps) {
			connectUpstream();
		} else if (fn) {
			startProducer();
		}

		let removed = false;
		return () => {
			if (removed) return;
			removed = true;
			sinkCount -= 1;
			if (singleDepSinks.has(sink)) {
				singleDepSinkCount -= 1;
				singleDepSinks.delete(sink);
			}
			if (sinks == null) return;
			if (typeof sinks === "function") {
				if (sinks === sink) sinks = null;
			} else {
				sinks.delete(sink);
				if (sinks.size === 1) {
					const [only] = sinks;
					sinks = only;
				} else if (sinks.size === 0) {
					sinks = null;
				}
			}
			if (sinks == null) {
				disconnectUpstream();
				stopProducer();
			}
		};
	};

	const base: Node = {
		name: opts.name,
		get(): T | undefined {
			return cached;
		},
		get status(): NodeStatus {
			return status;
		},
		down,
		subscribe,
		meta,
	};

	if (hasDeps) {
		base.up = (messages: Messages): void => {
			for (const dep of deps) {
				dep.up?.(messages);
			}
		};
		base.unsubscribe = (): void => {
			disconnectUpstream();
		};
	}

	return base as Node<T>;
}
