/**
 * `dynamicNode` — runtime dep tracking with diamond resolution (Phase 0.3b).
 *
 * Unlike `node()` where deps are fixed at construction, `dynamicNode`
 * discovers deps at runtime via a tracking `get()` proxy. After each
 * recompute, deps are diffed: new deps are connected, removed deps are
 * disconnected, and bitmasks are rebuilt.
 *
 * Shares subscribe / sink / lifecycle machinery with {@link NodeImpl} via
 * {@link NodeBase}. The only things that diverge from static nodes:
 * - deps are discovered inside `_runFn` via a tracking `get` proxy
 * - `_rewire` installs subscriptions lazily during `_runFn`
 * - during rewire, new dep messages are **buffered** (option C from the
 *   Apr-2026 refactor); after rewire we scan the buffer for DATA values
 *   that differ from what fn tracked, and re-run fn if any found
 *   (bounded by `MAX_RERUN`)
 */

import { normalizeActor } from "./actor.js";
import { GuardDenied } from "./guard.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	INVALIDATE,
	type Messages,
	messageTier,
	PAUSE,
	RESOLVED,
	RESUME,
	TEARDOWN,
} from "./messages.js";
import { node as createNode } from "./node.js";
import {
	NO_VALUE,
	type Node,
	NodeBase,
	type NodeOptions,
	type NodeTransportOptions,
} from "./node-base.js";

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

/** Bounded rerun cap for dynamic fn activation loop (lazy-dep stabilization). */
const MAX_RERUN = 16;

/**
 * Creates a node with runtime dep tracking. Deps are discovered each time the
 * compute function runs by tracking which nodes are passed to the `get()` proxy.
 *
 * After each recompute:
 * - New deps (not in previous set) are subscribed
 * - Removed deps (not in current set) are unsubscribed
 * - Kept deps retain their existing subscriptions
 *
 * The node participates in diamond resolution via the pre-set dirty mask
 * (shared with {@link NodeImpl}).
 *
 * **Lazy-dep composition:** when a tracked dep is itself a lazy compute node
 * whose first subscribe causes a fresh value to arrive, the rewire buffer
 * detects the discrepancy and re-runs fn once so it observes the real value.
 * Capped at {@link MAX_RERUN} iterations.
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

/** Pending buffer entry during `_rewire`. */
type PendingEntry = { index: number; msgs: Messages };

/** @internal — exported for {@link describeNode} `instanceof` check. */
export class DynamicNodeImpl<T = unknown> extends NodeBase<T> {
	private readonly _fn: DynamicNodeFn<T>;
	private readonly _autoComplete: boolean;

	// Dynamic deps tracking
	/** @internal Read by `describeNode`. */
	_deps: Node[] = [];
	private _depUnsubs: Array<() => void> = [];
	private _depIndexMap = new Map<Node, number>();
	private _depDirtyBits = new Set<number>();
	private _depSettledBits = new Set<number>();
	private _depCompleteBits = new Set<number>();

	// Execution state
	private _running = false;
	private _rewiring = false;
	private _bufferedDepMessages: PendingEntry[] = [];
	private _trackedValues: unknown[] = [];
	private _rerunCount = 0;

	constructor(fn: DynamicNodeFn<T>, opts: DynamicNodeOptions) {
		super(opts);
		this._fn = fn;
		this._autoComplete = opts.completeWhenDepsComplete ?? true;

		// Bind commonly detached protocol methods.
		this.down = this.down.bind(this);
		this.up = this.up.bind(this);
	}

	protected _createMetaNode(key: string, initialValue: unknown, opts: NodeOptions): Node {
		return createNode({
			initial: initialValue,
			name: `${opts.name ?? "dynamicNode"}:meta:${key}`,
			describeKind: "state",
			...(opts.guard != null ? { guard: opts.guard } : {}),
		});
	}

	/** Versioning not supported on DynamicNodeImpl (override base). */
	override get v(): undefined {
		return undefined;
	}

	// --- Up / unsubscribe ---

	up(messages: Messages, options?: NodeTransportOptions): void {
		if (this._deps.length === 0) return;
		if (!options?.internal && this._guard != null) {
			const actor = normalizeActor(options?.actor);
			if (!this._guard(actor, "write")) {
				throw new GuardDenied({ actor, action: "write", nodeName: this.name });
			}
			this._recordMutation(actor);
		}
		for (const dep of this._deps) {
			dep.up?.(messages, options);
		}
	}

	protected _upInternal(messages: Messages): void {
		for (const dep of this._deps) {
			dep.up?.(messages, { internal: true });
		}
	}

	unsubscribe(): void {
		this._disconnect();
	}

	// --- Activation hooks ---

	protected _onActivate(): void {
		this._runFn();
	}

	protected _doDeactivate(): void {
		this._disconnect();
	}

	private _disconnect(): void {
		for (const unsub of this._depUnsubs) unsub();
		this._depUnsubs = [];
		this._deps = [];
		this._depIndexMap.clear();
		this._depDirtyBits.clear();
		this._depSettledBits.clear();
		this._depCompleteBits.clear();

		// ROM/RAM rule (GRAPHREFLY-SPEC §2.2): compute node clears cache on
		// disconnect — dynamic nodes are always compute nodes.
		this._cached = NO_VALUE;
		this._status = "disconnected";
	}

	// --- Fn execution with rewire buffer ---

	private _runFn(): void {
		if (this._terminal && !this._resubscribable) return;
		if (this._running) return;

		this._running = true;
		this._rerunCount = 0;
		let result: T | undefined;

		try {
			for (;;) {
				// --- Phase 1: execute fn with tracking `get`. ---
				const trackedDeps: Node[] = [];
				const trackedValues: unknown[] = [];
				const trackedSet = new Set<Node>();

				const get: DynGet = <V>(dep: Node<V>): V | undefined => {
					if (!trackedSet.has(dep)) {
						trackedSet.add(dep);
						trackedDeps.push(dep);
						// Spec §2.2: `get()` never triggers computation. If the
						// dep is a disconnected lazy node, this returns
						// undefined — the rewire buffer will detect the
						// discrepancy once the lazy dep's real value arrives
						// via subscribe-time push.
						trackedValues.push(dep.get());
					}
					return dep.get() as V | undefined;
				};

				this._trackedValues = trackedValues;

				// Collect dep values for inspector hook
				const depValues: unknown[] = [];
				for (const dep of this._deps) depValues.push(dep.get());
				this._emitInspectorHook({ kind: "run", depValues });

				try {
					result = this._fn(get);
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					const wrapped = new Error(`Node "${this.name}": fn threw: ${errMsg}`, {
						cause: err,
					});
					this._downInternal([[ERROR, wrapped]]);
					return;
				}

				// --- Phase 2: rewire. ---
				this._rewiring = true;
				this._bufferedDepMessages = [];
				try {
					this._rewire(trackedDeps);
				} finally {
					this._rewiring = false;
				}

				// --- Phase 3: scan buffer for discrepancies that require re-run. ---
				let needsRerun = false;
				for (const entry of this._bufferedDepMessages) {
					for (const msg of entry.msgs) {
						if (msg[0] === DATA) {
							const trackedValue = this._trackedValues[entry.index];
							const actualValue = msg[1];
							if (!this._equals(trackedValue, actualValue)) {
								needsRerun = true;
								break;
							}
						}
					}
					if (needsRerun) break;
				}

				if (needsRerun) {
					this._rerunCount += 1;
					if (this._rerunCount > MAX_RERUN) {
						this._bufferedDepMessages = [];
						this._downInternal([
							[
								ERROR,
								new Error(
									`dynamicNode "${this.name ?? "anonymous"}": rewire did not stabilize within ${MAX_RERUN} iterations`,
								),
							],
						]);
						return;
					}
					// Discard this iteration's buffer and loop.
					this._bufferedDepMessages = [];
					continue;
				}

				// --- Phase 4: drain buffer — update masks only, no _runFn. ---
				//
				// Buffered activation-cascade messages are already reflected
				// in `_trackedValues` (fn saw the same values). We update
				// the wave masks so subsequent dep updates start from a
				// consistent state, then clear both masks so the node
				// enters post-rewire with clean wave tracking.
				const drain = this._bufferedDepMessages;
				this._bufferedDepMessages = [];
				for (const entry of drain) {
					for (const msg of entry.msgs) {
						this._updateMasksForMessage(entry.index, msg);
					}
				}
				// Clear wave masks — the activation cascade is fully
				// consumed; subsequent dep updates should start fresh.
				this._depDirtyBits.clear();
				this._depSettledBits.clear();
				break;
			}
		} finally {
			this._running = false;
		}

		this._downAutoValue(result);
	}

	private _rewire(newDeps: Node[]): void {
		const oldMap = this._depIndexMap;
		const newMap = new Map<Node, number>();
		const newUnsubs: Array<() => void> = [];

		// Subscribe to new deps (or reuse existing subscriptions).
		for (let i = 0; i < newDeps.length; i++) {
			const dep = newDeps[i];
			newMap.set(dep, i);
			const oldIdx = oldMap.get(dep);
			if (oldIdx !== undefined) {
				// Kept dep — reuse subscription.
				newUnsubs.push(this._depUnsubs[oldIdx]);
				this._depUnsubs[oldIdx] = () => {};
			} else {
				// New dep — subscribe. Its subscribe-time handshake +
				// activation cascade will land in `_handleDepMessages`,
				// which routes to the buffer while `_rewiring` is true.
				const idx = i;
				const unsub = dep.subscribe((msgs) => this._handleDepMessages(idx, msgs));
				newUnsubs.push(unsub);
			}
		}

		// Disconnect removed deps.
		for (const [dep, oldIdx] of oldMap) {
			if (!newMap.has(dep)) {
				this._depUnsubs[oldIdx]();
			}
		}

		this._deps = newDeps;
		this._depUnsubs = newUnsubs;
		this._depIndexMap = newMap;
		this._depDirtyBits.clear();
		this._depSettledBits.clear();

		// Preserve complete bits for deps that are still present (re-indexed).
		const newCompleteBits = new Set<number>();
		for (const oldIdx of this._depCompleteBits) {
			for (const [dep, idx] of oldMap) {
				if (idx === oldIdx && newMap.has(dep)) {
					newCompleteBits.add(newMap.get(dep)!);
					break;
				}
			}
		}
		this._depCompleteBits = newCompleteBits;
	}

	// --- Dep message handling ---

	private _handleDepMessages(index: number, messages: Messages): void {
		// During rewire, buffer messages for post-rewire scan.
		if (this._rewiring) {
			this._bufferedDepMessages.push({ index, msgs: messages });
			return;
		}

		for (const msg of messages) {
			this._emitInspectorHook({ kind: "dep_message", depIndex: index, message: msg });
			const t = msg[0];

			// Note: unlike NodeImpl, we do NOT clear dirty bits when onMessage
			// consumes START. NodeImpl pre-sets all dirty bits in _connectUpstream
			// and must clear them for consumed-START deps (notifier pattern).
			// DynamicNodeImpl never pre-sets dirty bits — deps are discovered
			// lazily during _runFn — so there are no bits to clear.
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

			// Tier-0 (START) from a dep is informational — see NodeImpl for rationale.
			if (messageTier(t) < 1) continue;

			if (t === DIRTY) {
				const wasEmpty = this._depDirtyBits.size === 0;
				this._depDirtyBits.add(index);
				this._depSettledBits.delete(index);
				if (wasEmpty) {
					this._downInternal([[DIRTY]]);
				}
				continue;
			}
			if (t === DATA || t === RESOLVED) {
				if (!this._depDirtyBits.has(index)) {
					// DATA-without-prior-DIRTY — propagate DIRTY for the two-phase
					// invariant (§1.3.1 compat path).
					const wasEmpty = this._depDirtyBits.size === 0;
					this._depDirtyBits.add(index);
					if (wasEmpty) {
						this._downInternal([[DIRTY]]);
					}
				}
				this._depSettledBits.add(index);
				if (this._allDirtySettled()) {
					this._depDirtyBits.clear();
					this._depSettledBits.clear();
					if (!this._running) {
						// Identity check against the values fn already saw — if
						// nothing has actually changed, skip the run. This
						// guards against deferred handshake DATA (arriving
						// after `_rewire` finishes inside an open batch)
						// from triggering a redundant re-run.
						if (this._depValuesDifferFromTracked()) {
							this._runFn();
						}
					}
				}
				continue;
			}
			if (t === COMPLETE) {
				this._depCompleteBits.add(index);
				this._depDirtyBits.delete(index);
				this._depSettledBits.delete(index);
				if (this._allDirtySettled()) {
					this._depDirtyBits.clear();
					this._depSettledBits.clear();
					if (!this._running) this._runFn();
				}
				if (
					this._autoComplete &&
					this._depCompleteBits.size >= this._deps.length &&
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

	/**
	 * Update dep masks for a message without triggering `_runFn` — used
	 * during post-rewire drain so the wave state is consistent with the
	 * buffered activation cascade without recursing.
	 */
	private _updateMasksForMessage(index: number, msg: Messages[number]): void {
		const t = msg[0];
		if (t === DIRTY) {
			this._depDirtyBits.add(index);
			this._depSettledBits.delete(index);
		} else if (t === DATA || t === RESOLVED) {
			this._depDirtyBits.add(index);
			this._depSettledBits.add(index);
		} else if (t === COMPLETE) {
			this._depCompleteBits.add(index);
			this._depDirtyBits.delete(index);
			this._depSettledBits.delete(index);
		}
	}

	private _allDirtySettled(): boolean {
		if (this._depDirtyBits.size === 0) return false;
		for (const idx of this._depDirtyBits) {
			if (!this._depSettledBits.has(idx)) return false;
		}
		return true;
	}

	/**
	 * True if any current dep value differs from what the last `_runFn`
	 * saw via `get()`. Used to suppress redundant re-runs when deferred
	 * handshake messages arrive after `_rewire` for a dep whose value
	 * already matches `_trackedValues`.
	 */
	private _depValuesDifferFromTracked(): boolean {
		for (let i = 0; i < this._deps.length; i++) {
			const current = this._deps[i].get();
			const tracked = this._trackedValues[i];
			if (!this._equals(current, tracked)) return true;
		}
		return false;
	}
}
