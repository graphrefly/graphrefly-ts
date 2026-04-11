/**
 * `NodeImpl` — the canonical node primitive for static (compile-time known)
 * dependency graphs. Covers state, producer, derived, effect, operator, and
 * passthrough shapes from a single class.
 *
 * Lifecycle machinery (subscribe + START handshake + `_downInternal` pipeline)
 * lives in {@link NodeBase}. This file only adds:
 * - Dep-wave tracking via pre-set dirty masks (first run and subsequent waves
 *   share the same code path — see `_connectUpstream` + `_handleDepMessages`)
 * - `_runFn` with identity-skip optimization on `_lastDepValues`
 * - Producer start/stop tied to sink count
 * - ROM/RAM cache semantics: compute nodes clear `_cached` on disconnect,
 *   state sources preserve it (see `_onDeactivate`).
 *
 * See GRAPHREFLY-SPEC §§2.1–2.8 and COMPOSITION-GUIDE §§1, 9.
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
	START,
	TEARDOWN,
} from "./messages.js";
import {
	type BitSet,
	createBitSet,
	isCleanupFn,
	isCleanupResult,
	NO_VALUE,
	type Node,
	type NodeActions,
	NodeBase,
	type NodeOptions,
	type NodeTransportOptions,
	type SubscribeHints,
} from "./node-base.js";

// Re-exports so downstream files keep importing from "./node.js".
export {
	CLEANUP_RESULT,
	type CleanupResult,
	cleanupResult,
	NO_VALUE,
	type Node,
	type NodeActions,
	type NodeDescribeKind,
	type NodeInspectorHook,
	type NodeInspectorHookEvent,
	type NodeOptions,
	type NodeSink,
	type NodeStatus,
	type NodeTransportOptions,
	type OnMessageHandler,
	type SubscribeHints,
} from "./node-base.js";

/**
 * Compute function passed to `node(deps, fn, opts?)`.
 *
 * @returns A value to emit, `undefined` to skip emission, or a cleanup
 *   function invoked before the next run or on teardown.
 */
export type NodeFn<T = unknown> = (
	deps: readonly unknown[],
	actions: NodeActions,
) => T | undefined | (() => void);

// ---------------------------------------------------------------------------
// NodeImpl
// ---------------------------------------------------------------------------

/**
 * Class-based implementation of the {@link Node} interface for static deps.
 *
 * All internal state is exposed as package-visible fields so introspection
 * (e.g. `describeNode`) can read them via `instanceof NodeImpl`.
 */
export class NodeImpl<T = unknown> extends NodeBase<T> {
	// --- Dep configuration (set once) ---
	_deps: readonly Node[];
	_fn: NodeFn<T> | undefined;
	_opts: NodeOptions;
	_hasDeps: boolean;
	_isSingleDep: boolean;
	_autoComplete: boolean;

	// --- Wave tracking masks ---
	private _depDirtyMask: BitSet;
	private _depSettledMask: BitSet;
	private _depCompleteMask: BitSet;
	private _allDepsCompleteMask: BitSet;

	// --- Identity-skip optimization ---
	private _lastDepValues: readonly unknown[] | undefined;
	private _cleanup: (() => void) | undefined;

	// --- Upstream bookkeeping ---
	private _upstreamUnsubs: Array<() => void> = [];

	// --- Fn behavior flag ---
	/** @internal Read by `describeNode` to infer `"operator"` label. */
	_manualEmitUsed = false;

	constructor(deps: readonly Node[], fn: NodeFn<T> | undefined, opts: NodeOptions) {
		super(opts);
		this._deps = deps;
		this._fn = fn;
		this._opts = opts;
		this._hasDeps = deps.length > 0;
		this._isSingleDep = deps.length === 1 && fn != null;
		this._autoComplete = opts.completeWhenDepsComplete ?? true;

		// State-with-initial-value starts `settled`; everything else starts
		// `disconnected` and flips to `pending` at first subscribe if fn
		// hasn't produced a value yet.
		if (!this._hasDeps && fn == null && this._cached !== NO_VALUE) {
			this._status = "settled";
		}

		this._depDirtyMask = createBitSet(deps.length);
		this._depSettledMask = createBitSet(deps.length);
		this._depCompleteMask = createBitSet(deps.length);
		this._allDepsCompleteMask = createBitSet(deps.length);
		for (let i = 0; i < deps.length; i++) this._allDepsCompleteMask.set(i);

		// Bind commonly detached protocol methods.
		this.down = this.down.bind(this);
		this.up = this.up.bind(this);
	}

	// --- Meta node factory (called from base constructor) ---

	protected _createMetaNode(key: string, initialValue: unknown, opts: NodeOptions): Node {
		return node({
			initial: initialValue,
			name: `${opts.name ?? "node"}:meta:${key}`,
			describeKind: "state",
			...(opts.guard != null ? { guard: opts.guard } : {}),
		});
	}

	// --- Manual emit tracker (set by actions.down / actions.emit) ---

	protected override _onManualEmit(): void {
		this._manualEmitUsed = true;
	}

	// --- Up / unsubscribe ---

	up(messages: Messages, options?: NodeTransportOptions): void {
		if (!this._hasDeps) return;
		if (!options?.internal && this._guard != null) {
			const actor = normalizeActor(options?.actor);
			if (!this._guard(actor, "write")) {
				throw new GuardDenied({ actor, action: "write", nodeName: this.name });
			}
			this._recordMutation(actor);
		}
		for (const dep of this._deps) {
			if (options === undefined) {
				dep.up?.(messages);
			} else {
				dep.up?.(messages, options);
			}
		}
	}

	protected _upInternal(messages: Messages): void {
		if (!this._hasDeps) return;
		for (const dep of this._deps) {
			dep.up?.(messages, { internal: true });
		}
	}

	unsubscribe(): void {
		if (!this._hasDeps) return;
		this._disconnectUpstream();
	}

	// --- Activation (first-subscriber / last-subscriber hooks) ---

	protected _onActivate(): void {
		if (this._hasDeps) {
			this._connectUpstream();
			return;
		}
		if (this._fn) {
			this._runFn();
			return;
		}
		// Pure state node: no-op. Cached value (if any) is already delivered
		// through the subscribe-time START handshake.
	}

	protected _doDeactivate(): void {
		// Release upstream subscriptions (for compute nodes with deps).
		this._disconnectUpstream();
		// Flush pending cleanup fn (producers + derived both use `_cleanup`).
		const cleanup = this._cleanup;
		this._cleanup = undefined;
		cleanup?.();

		// ROM/RAM rule (GRAPHREFLY-SPEC §2.2): compute nodes (anything with
		// `fn`) clear their cache on disconnect because their value is a
		// function of live subscriptions. State nodes (no fn) preserve
		// `_cached` — runtime writes survive across disconnect.
		if (this._fn != null) {
			this._cached = NO_VALUE;
			this._lastDepValues = undefined;
		}

		// Status: only transition to "disconnected" for compute nodes.
		// Pure state nodes remain in whatever status they were (usually
		// "settled" if they hold a value).
		if (this._hasDeps || this._fn != null) {
			this._status = "disconnected";
		}
	}

	// --- INVALIDATE / TEARDOWN hooks (clear fn state) ---

	protected override _onInvalidate(): void {
		const cleanup = this._cleanup;
		this._cleanup = undefined;
		cleanup?.();
		this._lastDepValues = undefined;
	}

	protected override _onTeardown(): void {
		const cleanup = this._cleanup;
		this._cleanup = undefined;
		cleanup?.();
	}

	// --- Upstream connect / disconnect ---

	private _connectUpstream(): void {
		if (!this._hasDeps) return;
		if (this._upstreamUnsubs.length > 0) return; // already connected

		// Pre-set dirty mask to all-ones — wave completes when every dep
		// has settled at least once (spec §2.7, first-run gating).
		this._depDirtyMask.setAll();
		this._depSettledMask.reset();
		this._depCompleteMask.reset();
		// Stay in "disconnected" until fn runs and updates status via
		// `_handleLocalLifecycle`. `subscribe()` will flip to "pending"
		// if fn did not run before returning.

		const depValuesBefore = this._lastDepValues;
		const subHints: SubscribeHints | undefined = this._isSingleDep
			? { singleDep: true }
			: undefined;
		for (let i = 0; i < this._deps.length; i += 1) {
			const dep = this._deps[i];
			this._upstreamUnsubs.push(
				dep.subscribe((msgs) => this._handleDepMessages(i, msgs), subHints),
			);
		}
		// Fallback for `onMessage`-driven operators: if the subscribe loop
		// did not drive a wave completion (e.g. `switchMap`, `sample` —
		// operators whose `onMessage` consumes every dep message without
		// letting the mask-based wave progress), still run fn once so the
		// operator can initialize side-effect state (inner subscriptions,
		// cleanup fns, etc.). The fn-is-identity-check guards against
		// double runs when the normal wave path already fired.
		if (this._fn && this._onMessage && !this._terminal && this._lastDepValues === depValuesBefore) {
			this._runFn();
		}
	}

	private _disconnectUpstream(): void {
		if (this._upstreamUnsubs.length === 0) return;
		for (const unsub of this._upstreamUnsubs.splice(0)) {
			unsub();
		}
		this._depDirtyMask.reset();
		this._depSettledMask.reset();
		this._depCompleteMask.reset();
	}

	// --- Wave handling ---

	private _handleDepMessages(index: number, messages: Messages): void {
		for (const msg of messages) {
			this._emitInspectorHook({ kind: "dep_message", depIndex: index, message: msg });
			const t = msg[0];
			// User-defined message handler gets first look (spec §2.6).
			if (this._onMessage) {
				try {
					const consumed = this._onMessage(msg, index, this._actions);
					if (consumed) {
						// Clear the dep's pre-set dirty bit when onMessage
						// consumes a protocol-significant message:
						// - START: dep is fully user-managed (takeUntil notifier)
						// - DATA/RESOLVED: dep delivered real data via onMessage
						//   instead of the normal wave path
						// This ensures the first-run gate tracks dep readiness
						// correctly even when onMessage bypasses wave tracking.
						if (t === START || t === DATA || t === RESOLVED) {
							this._depDirtyMask.clear(index);
							if (this._depDirtyMask.any() && this._depSettledMask.covers(this._depDirtyMask)) {
								this._depDirtyMask.reset();
								this._depSettledMask.reset();
								this._runFn();
							}
						}
						continue;
					}
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					const wrapped = new Error(`Node "${this.name}": onMessage threw: ${errMsg}`, {
						cause: err,
					});
					this._downInternal([[ERROR, wrapped]]);
					return;
				}
			}

			// Tier-0 (START) from a dep is informational — it's the dep's
			// subscribe handshake. It carries no wave-state implication: the
			// paired DATA (if present) is handled by the DATA branch.
			if (messageTier(t) < 1) continue;

			if (!this._fn) {
				// Passthrough: forward everything except COMPLETE when multi-dep
				// (multi-dep passthrough waits for all deps to complete, §1.3.5).
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
				this._depDirtyMask.clear(index);
				this._depSettledMask.clear(index);
				if (this._depDirtyMask.any() && this._depSettledMask.covers(this._depDirtyMask)) {
					this._depDirtyMask.reset();
					this._depSettledMask.reset();
					this._runFn();
				} else if (!this._depDirtyMask.any() && this._status === "dirty") {
					// D2: dep went DIRTY→COMPLETE without DATA — the node is
					// stuck in "dirty" with no pending wave to resolve it.
					// Recompute so downstream sees RESOLVED (unchanged) or
					// DATA (changed).
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
			// Forward unknown message types.
			this._downInternal([msg]);
		}
	}

	private _onDepDirty(index: number): void {
		// Track wave transition: propagate DIRTY to our downstream ONLY on
		// the first dirty of a wave. During the initial wave, the dirty mask
		// is pre-set to all-ones by `_connectUpstream` so this branch never
		// fires — our own `_downAutoValue` emits `[[DIRTY],[DATA,v]]` to
		// downstream when fn completes.
		const wasDirty = this._depDirtyMask.has(index);
		this._depDirtyMask.set(index);
		this._depSettledMask.clear(index);
		if (!wasDirty) {
			this._downInternal([[DIRTY]]);
		}
	}

	private _onDepSettled(index: number): void {
		// Ensure dep is marked dirty. If the dep settled without a prior
		// DIRTY (spec §1.3.1 compat path for raw external sources), route
		// through `_onDepDirty` so that our own downstream sees DIRTY
		// before the resulting DATA/RESOLVED — preserving the two-phase
		// invariant from our node's perspective.
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

	private _maybeCompleteFromDeps(): void {
		if (
			this._autoComplete &&
			this._deps.length > 0 &&
			this._depCompleteMask.covers(this._allDepsCompleteMask)
		) {
			this._downInternal([[COMPLETE]]);
		}
	}

	// --- Fn execution ---

	private _runFn(): void {
		if (!this._fn) return;
		if (this._terminal && !this._resubscribable) return;

		try {
			const n = this._deps.length;
			const depValues = new Array(n);
			for (let i = 0; i < n; i++) depValues[i] = this._deps[i].get();

			// Identity skip BEFORE cleanup: if all dep values are unchanged,
			// skip cleanup+fn so effect nodes don't teardown/restart on no-op.
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
			this._emitInspectorHook({ kind: "run", depValues });

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
			// Legacy: plain function return → cleanup.
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
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const isNodeArray = (value: unknown): value is readonly Node[] => Array.isArray(value);

const isNodeOptions = (value: unknown): value is NodeOptions =>
	typeof value === "object" && value != null && !Array.isArray(value);

/**
 * Creates a reactive {@link Node} — the single GraphReFly primitive (§2).
 *
 * Typical shapes: `node([])` / `node([], opts)` for a manual source;
 * `node(producerFn, opts)` for a producer; `node(deps, computeFn, opts)` for
 * derived nodes and operators.
 *
 * @param depsOrFn - Dependency nodes, a {@link NodeFn} (producer), or {@link NodeOptions} alone.
 * @param fnOrOpts - With deps: compute function or options. Omitted for producer-only form.
 * @param optsArg - Options when both `deps` and `fn` are provided.
 * @returns `Node<T>` — lazy until subscribed.
 *
 * @remarks
 * **Protocol:** START handshake, DIRTY / DATA / RESOLVED ordering, completion,
 * and batch deferral follow `~/src/graphrefly/GRAPHREFLY-SPEC.md`.
 *
 * **`equals` and mutable values:** The default `Object.is` identity check is
 * correct for the common immutable-value case. If your node produces mutable
 * objects, provide a custom `equals` — otherwise `Object.is` always returns
 * `true` for the same reference and the node emits `RESOLVED` instead of `DATA`.
 *
 * **ROM/RAM (§2.2):** State nodes (no fn) preserve their cache across
 * disconnect — runtime writes survive. Compute nodes (derived, producer)
 * clear their cache on disconnect; reconnect re-runs fn.
 *
 * @example
 * ```ts
 * import { node, state } from "@graphrefly/graphrefly-ts";
 *
 * const a = state(1);
 * const b = node([a], ([x]) => (x as number) + 1);
 * ```
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
