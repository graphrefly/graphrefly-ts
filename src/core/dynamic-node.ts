/**
 * `dynamicNode` — runtime dep tracking with diamond resolution (Phase 0.3b).
 *
 * Unlike `node()` where deps are fixed at construction, `dynamicNode` discovers
 * deps at runtime via a tracking `get()` proxy. After each recompute, deps are
 * diffed: new deps are connected, removed deps are disconnected, and bitmasks
 * are rebuilt. Kept deps retain their subscriptions (no teardown/reconnect churn).
 *
 * This ports callbag-recharge's `dynamicDerived` pattern to GraphReFly's protocol.
 */
import type { Actor } from "./actor.js";
import { normalizeActor } from "./actor.js";
import { emitWithBatch } from "./batch.js";
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
import {
	node as createNode,
	type Node,
	type NodeActions,
	type NodeDescribeKind,
	type NodeInspectorHook,
	type NodeOptions,
	type NodeSink,
	type NodeStatus,
	type NodeTransportOptions,
	type OnMessageHandler,
	type SubscribeHints,
} from "./node.js";

/**
 * The tracking `get` function passed to `dynamicNode`'s compute function.
 * Each call to `get(dep)` reads the dep's current value and records it as a dependency.
 */
export type DynGet = <V>(dep: Node<V>) => V | undefined;

/**
 * Compute function for `dynamicNode`. Receives a tracking `get` proxy.
 * Deps are discovered by which nodes are passed to `get()` during execution.
 */
export type DynamicNodeFn<T> = (get: DynGet) => T;

/** Options for `dynamicNode`. */
export type DynamicNodeOptions = Pick<
	NodeOptions,
	| "name"
	| "equals"
	| "meta"
	| "resubscribable"
	| "resetOnTeardown"
	| "guard"
	| "onMessage"
	| "onResubscribe"
	| "completeWhenDepsComplete"
	| "describeKind"
>;

/**
 * Creates a node with runtime dep tracking. Deps are discovered each time the
 * compute function runs by tracking which nodes are passed to the `get()` proxy.
 *
 * After each recompute:
 * - New deps (not in previous set) are subscribed
 * - Removed deps (not in current set) are unsubscribed
 * - Kept deps retain their existing subscriptions
 * - Bitmasks are rebuilt to match the new dep set
 *
 * The node participates fully in diamond resolution via the standard two-phase
 * DIRTY/RESOLVED protocol across all dynamically-tracked deps.
 *
 * @param fn - Compute function receiving a tracking `get` proxy.
 * @param opts - Optional configuration.
 * @returns `Node<T>` with dynamic dep tracking.
 *
 * @example
 * ```ts
 * import { dynamicNode, state } from "@graphrefly/graphrefly-ts";
 *
 * const cond = state(true);
 * const a = state(1);
 * const b = state(2);
 *
 * // Deps change based on cond's value
 * const d = dynamicNode((get) => {
 *   const useA = get(cond);
 *   return useA ? get(a) : get(b);
 * });
 * ```
 *
 * @category core
 */
export function dynamicNode<T = unknown>(fn: DynamicNodeFn<T>, opts?: DynamicNodeOptions): Node<T> {
	return new DynamicNodeImpl<T>(fn, opts ?? {});
}

/** @internal — exported for {@link describeNode} `instanceof` check. */
export class DynamicNodeImpl<T = unknown> implements Node<T> {
	private readonly _optsName: string | undefined;
	private _registryName: string | undefined;
	readonly _describeKind: NodeDescribeKind | undefined;
	readonly meta: Record<string, Node>;
	private readonly _fn: DynamicNodeFn<T>;
	private readonly _equals: (a: unknown, b: unknown) => boolean;
	private readonly _resubscribable: boolean;
	private readonly _resetOnTeardown: boolean;
	private readonly _autoComplete: boolean;
	private readonly _onMessage: OnMessageHandler | undefined;
	private readonly _onResubscribe: (() => void) | undefined;
	/** @internal — read by {@link describeNode} for `accessHintForGuard`. */
	readonly _guard: NodeGuard | undefined;
	private _lastMutation: { actor: Actor; timestamp_ns: number } | undefined;
	private _inspectorHook: NodeInspectorHook | undefined;

	// Sink tracking
	private _sinkCount = 0;
	private _singleDepSinkCount = 0;
	private _singleDepSinks = new WeakSet<NodeSink>();

	// Actions object (for onMessage handler)
	private readonly _actions: NodeActions;
	private readonly _boundEmitToSinks: (messages: Messages) => void;

	// Mutable state
	private _cached: T | undefined;
	private _status: NodeStatus = "disconnected";
	private _terminal = false;
	private _connected = false;
	private _rewiring = false; // re-entrancy guard

	// Dynamic deps tracking
	private _deps: Node[] = [];
	private _depUnsubs: Array<() => void> = [];
	private _depIndexMap = new Map<Node, number>(); // node → index in _deps
	private _dirtyBits = new Set<number>();
	private _settledBits = new Set<number>();
	private _completeBits = new Set<number>();

	// Sinks
	private _sinks: NodeSink | Set<NodeSink> | null = null;

	constructor(fn: DynamicNodeFn<T>, opts: DynamicNodeOptions) {
		this._fn = fn;
		this._optsName = opts.name;
		this._describeKind = opts.describeKind;
		this._equals = opts.equals ?? Object.is;
		this._resubscribable = opts.resubscribable ?? false;
		this._resetOnTeardown = opts.resetOnTeardown ?? false;
		this._autoComplete = opts.completeWhenDepsComplete ?? true;
		this._onMessage = opts.onMessage;
		this._onResubscribe = opts.onResubscribe;
		this._guard = opts.guard;
		this._inspectorHook = undefined;

		// Build companion meta nodes (same pattern as NodeImpl)
		const meta: Record<string, Node> = {};
		for (const [k, v] of Object.entries(opts.meta ?? {})) {
			meta[k] = createNode({
				initial: v,
				name: `${opts.name ?? "dynamicNode"}:meta:${k}`,
				describeKind: "state",
				...(opts.guard != null ? { guard: opts.guard } : {}),
			});
		}
		Object.freeze(meta);
		this.meta = meta;

		// Actions object: created once, references `this` methods.
		const self = this;
		this._actions = {
			down(messages): void {
				self._downInternal(messages);
			},
			emit(value): void {
				self._emitAutoValue(value);
			},
			up(messages): void {
				for (const dep of self._deps) {
					dep.up?.(messages, { internal: true });
				}
			},
		};

		// Bind commonly detached protocol methods
		this._boundEmitToSinks = this._emitToSinks.bind(this);
	}

	get name(): string | undefined {
		return this._registryName ?? this._optsName;
	}

	/** @internal */
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

	get status(): NodeStatus {
		return this._status;
	}

	get lastMutation(): Readonly<{ actor: Actor; timestamp_ns: number }> | undefined {
		return this._lastMutation;
	}

	hasGuard(): boolean {
		return this._guard != null;
	}

	allowsObserve(actor: Actor): boolean {
		if (this._guard == null) return true;
		return this._guard(normalizeActor(actor), "observe");
	}

	get(): T | undefined {
		return this._cached;
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
		let sinkMessages = messages;
		if (this._terminal && !this._resubscribable) {
			const pass = messages.filter((m) => m[0] === TEARDOWN || m[0] === INVALIDATE);
			if (pass.length === 0) return;
			sinkMessages = pass as Messages;
		}
		this._handleLocalLifecycle(sinkMessages);
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
					emitWithBatch(this._boundEmitToSinks, filtered);
				}
				return;
			}
		}
		emitWithBatch(this._boundEmitToSinks, sinkMessages);
	}

	private _canSkipDirty(): boolean {
		return this._sinkCount === 1 && this._singleDepSinkCount === 1;
	}

	subscribe(sink: NodeSink, hints?: SubscribeHints): () => void {
		if (hints?.actor != null && this._guard != null) {
			const actor = normalizeActor(hints.actor);
			if (!this._guard(actor, "observe")) {
				throw new GuardDenied({ actor, action: "observe", nodeName: this.name });
			}
		}

		if (this._terminal && this._resubscribable) {
			this._terminal = false;
			this._status = "disconnected";
			this._onResubscribe?.();
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

		if (!this._connected) {
			this._connect();
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
				this._disconnect();
			}
		};
	}

	up(messages: Messages, options?: NodeTransportOptions): void {
		if (this._deps.length === 0) return;
		if (!options?.internal && this._guard != null) {
			const actor = normalizeActor(options?.actor);
			if (!this._guard(actor, "write")) {
				throw new GuardDenied({ actor, action: "write", nodeName: this.name });
			}
			this._lastMutation = { actor, timestamp_ns: wallClockNs() };
		}
		for (const dep of this._deps) {
			dep.up?.(messages, options);
		}
	}

	unsubscribe(): void {
		this._disconnect();
	}

	// --- Private methods ---

	private _emitToSinks(messages: Messages): void {
		if (this._sinks == null) return;
		if (typeof this._sinks === "function") {
			this._sinks(messages);
			return;
		}
		const snapshot = [...this._sinks];
		for (const sink of snapshot) {
			sink(messages);
		}
	}

	private _handleLocalLifecycle(messages: Messages): void {
		for (const m of messages) {
			const t = m[0];
			if (t === DATA) this._cached = m[1] as T;
			if (t === INVALIDATE) {
				this._cached = undefined;
			}
			if (t === DATA || t === RESOLVED) {
				this._status = "settled";
			} else if (t === DIRTY) {
				this._status = "dirty";
			} else if (t === COMPLETE) {
				this._status = "completed";
				this._terminal = true;
			} else if (t === ERROR) {
				this._status = "errored";
				this._terminal = true;
			}
			if (t === TEARDOWN) {
				if (this._resetOnTeardown) this._cached = undefined;
				try {
					this._propagateToMeta(t);
				} finally {
					this._disconnect();
				}
			}
			// Propagate other meta-eligible signals (centralized in messages.ts).
			if (t !== TEARDOWN && propagatesToMeta(t)) {
				this._propagateToMeta(t);
			}
		}
	}

	/** Propagate a signal to all companion meta nodes (best-effort). */
	private _propagateToMeta(t: symbol): void {
		for (const metaNode of Object.values(this.meta)) {
			try {
				metaNode.down([[t]], { internal: true });
			} catch {
				/* best-effort: other meta nodes still receive the signal */
			}
		}
	}

	private _emitAutoValue(value: unknown): void {
		const wasDirty = this._status === "dirty";
		const unchanged = this._equals(this._cached, value);
		if (unchanged) {
			this._downInternal(wasDirty ? [[RESOLVED]] : [[DIRTY], [RESOLVED]]);
			return;
		}
		this._cached = value as T;
		this._downInternal(wasDirty ? [[DATA, value]] : [[DIRTY], [DATA, value]]);
	}

	private _connect(): void {
		if (this._connected) return;
		this._connected = true;
		this._status = "settled";
		this._dirtyBits.clear();
		this._settledBits.clear();
		this._completeBits.clear();
		this._runFn();
	}

	private _disconnect(): void {
		if (!this._connected) return;
		for (const unsub of this._depUnsubs) unsub();
		this._depUnsubs = [];
		this._deps = [];
		this._depIndexMap.clear();
		this._dirtyBits.clear();
		this._settledBits.clear();
		this._completeBits.clear();
		this._connected = false;
		this._status = "disconnected";
	}

	private _runFn(): void {
		if (this._terminal && !this._resubscribable) return;
		if (this._rewiring) return;

		// Track deps during fn execution
		const trackedDeps: Node[] = [];
		const trackedSet = new Set<Node>();

		const get: DynGet = <V>(dep: Node<V>): V | undefined => {
			if (!trackedSet.has(dep)) {
				trackedSet.add(dep);
				trackedDeps.push(dep);
			}
			return dep.get();
		};

		try {
			// Collect dep values for inspector hook
			const depValues: unknown[] = [];
			for (const dep of this._deps) {
				depValues.push(dep.get());
			}
			this._inspectorHook?.({ kind: "run", depValues });

			const result = this._fn(get);
			this._rewire(trackedDeps);
			if (result === undefined) return;
			this._emitAutoValue(result);
		} catch (err) {
			this._downInternal([[ERROR, err]]);
		}
	}

	private _rewire(newDeps: Node[]): void {
		this._rewiring = true;
		try {
			const oldMap = this._depIndexMap;
			const newMap = new Map<Node, number>();
			const newUnsubs: Array<() => void> = [];

			// Reuse or create subscriptions
			for (let i = 0; i < newDeps.length; i++) {
				const dep = newDeps[i];
				newMap.set(dep, i);
				const oldIdx = oldMap.get(dep);
				if (oldIdx !== undefined) {
					// Kept dep — reuse subscription but update index
					newUnsubs.push(this._depUnsubs[oldIdx]);
					// Mark old unsub as consumed
					this._depUnsubs[oldIdx] = () => {};
				} else {
					// New dep — subscribe
					const idx = i;
					const unsub = dep.subscribe((msgs) => this._handleDepMessages(idx, msgs));
					newUnsubs.push(unsub);
				}
			}

			// Disconnect removed deps
			for (const [dep, oldIdx] of oldMap) {
				if (!newMap.has(dep)) {
					this._depUnsubs[oldIdx]();
				}
			}

			this._deps = newDeps;
			this._depUnsubs = newUnsubs;
			this._depIndexMap = newMap;
			this._dirtyBits.clear();
			this._settledBits.clear();
			// Preserve complete bits for deps that are still present
			const newCompleteBits = new Set<number>();
			for (const oldIdx of this._completeBits) {
				const dep = [...oldMap.entries()].find(([, idx]) => idx === oldIdx)?.[0];
				if (dep && newMap.has(dep)) {
					newCompleteBits.add(newMap.get(dep)!);
				}
			}
			this._completeBits = newCompleteBits;
		} finally {
			this._rewiring = false;
		}
	}

	private _handleDepMessages(index: number, messages: Messages): void {
		if (this._rewiring) return; // suppress signals during rewire

		for (const msg of messages) {
			this._inspectorHook?.({ kind: "dep_message", depIndex: index, message: msg });
			const t = msg[0];
			// User-defined message handler gets first look (spec §2.6).
			if (this._onMessage) {
				try {
					if (this._onMessage(msg, index, this._actions)) continue;
				} catch (err) {
					this._downInternal([[ERROR, err]]);
					return;
				}
			}
			if (t === DIRTY) {
				this._dirtyBits.add(index);
				this._settledBits.delete(index);
				if (this._dirtyBits.size === 1) {
					// First dirty — propagate
					emitWithBatch(this._boundEmitToSinks, [[DIRTY]]);
				}
				continue;
			}
			if (t === DATA || t === RESOLVED) {
				if (!this._dirtyBits.has(index)) {
					this._dirtyBits.add(index);
					emitWithBatch(this._boundEmitToSinks, [[DIRTY]]);
				}
				this._settledBits.add(index);
				if (this._allDirtySettled()) {
					this._dirtyBits.clear();
					this._settledBits.clear();
					this._runFn();
				}
				continue;
			}
			if (t === COMPLETE) {
				this._completeBits.add(index);
				this._dirtyBits.delete(index);
				this._settledBits.delete(index);
				if (this._allDirtySettled()) {
					this._dirtyBits.clear();
					this._settledBits.clear();
					this._runFn();
				}
				if (
					this._autoComplete &&
					this._completeBits.size >= this._deps.length &&
					this._deps.length > 0
				) {
					this._downInternal([[COMPLETE]]);
				}
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
			this._downInternal([msg]);
		}
	}

	private _allDirtySettled(): boolean {
		if (this._dirtyBits.size === 0) return false;
		for (const idx of this._dirtyBits) {
			if (!this._settledBits.has(idx)) return false;
		}
		return true;
	}
}
