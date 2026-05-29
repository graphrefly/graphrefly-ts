/**
 * The node primitive — the thinnest substrate object (R-node-thin / D5).
 *
 * Holds a fn handle + deps + the wave state machine; ZERO inspection cruft
 * (naming/find/describe are the graph layer, CSP-2). Canonical authority:
 * ~/src/graphrefly/spec/rules.jsonl (R-node-*, R-two-phase, R-diamond, R-equals,
 * R-first-run-gate, R-push-subscribe, R-rom-ram, R-fn-contract, R-initial, R-ctx-up).
 *
 * Slice 1 = core wave: state node, compute node, two-phase DIRTY->DATA, diamond
 * pending-counter join, first-run gate, equals->RESOLVED, push-on-subscribe,
 * lazy activation, ROM/RAM. Lifecycle (terminal/INVALIDATE/cleanup), control
 * (PAUSE/async), batch, and dynamicNode land in later slices.
 */

import { currentBatch, deferToBatch } from "../batch/batch.js";
import type { Ctx, CtxState, DepRecord, NodeFn, Sink } from "../ctx/types.js";
import { type Dispatcher, defaultDispatcher, type Handle } from "../dispatcher/index.js";
import {
	isUpAllowed,
	type Message,
	messageTier,
	SENTINEL,
	type Wave,
} from "../protocol/messages.js";

export type Status =
	| "sentinel"
	| "pending"
	| "dirty"
	| "settled"
	| "resolved"
	| "completed"
	| "errored";

export interface NodeOptions<T = unknown> {
	/** Pre-populate cache; source pushes [DATA, initial] on subscribe (R-initial). `null` is valid. */
	initial?: T | null;
	/** Custom equality for the DATA->RESOLVED substitution (R-equals). Default Object.is. */
	equals?: (a: T, b: T) => boolean;
	/** First-run gate off when true; fn body must guard SENTINEL per dep (R-first-run-gate). */
	partial?: boolean;
	/** A dep terminal also settles the first-run gate (Reduce-class, R-first-run-gate). */
	terminalAsRealInput?: boolean;
	/** Auto-emit COMPLETE when ALL deps complete (R-deps-terminal). Default true. */
	completeWhenDepsComplete?: boolean;
	/** Auto-emit ERROR when any dep errors (R-deps-terminal). Default true. */
	errorWhenDepsError?: boolean;
	/** Allow re-activation after terminal; late subscribe resets the lifecycle (R-terminal). Default false. */
	resubscribable?: boolean;
	/** Clear cached value on TEARDOWN. Default false. */
	resetOnTeardown?: boolean;
	/** PAUSE/RESUME behavior (R-pause-modes). Default true. */
	pausable?: boolean | "resumeAll";
	/** Buffer the last N outgoing DATA for late subscribers (R-replay-buffer). */
	replayBuffer?: number;
	/** Mark this as a dynamicNode — fn gets ctx.track(i) for read-selection (R-dynamic-node / D35). */
	dynamic?: boolean;
	/** Dispatch pool for the fn (R-sync-core). Default sync. */
	pool?: "sync" | "async";
	/** Dispatcher to register/invoke against. Default = process-global (D26). */
	dispatcher?: Dispatcher;
	/** Optional debug name (graph layer owns real naming/inspection). */
	name?: string;
}

const defaultEquals = Object.is as (a: unknown, b: unknown) => boolean;

export class Node<T = unknown> {
	private _deps: Node<unknown>[];
	private _handle: Handle | null;
	private readonly _pool: "sync" | "async";
	private readonly _dispatcher: Dispatcher;
	private readonly _equals: (a: T, b: T) => boolean;
	private readonly _partial: boolean;
	private readonly _terminalAsRealInput: boolean;
	private readonly _completeWhenDepsComplete: boolean;
	private readonly _errorWhenDepsError: boolean;
	private readonly _resubscribable: boolean;
	private readonly _resetOnTeardown: boolean;
	private readonly _pausable: boolean | "resumeAll";
	private readonly _replayN: number;
	private readonly _dynamic: boolean;
	readonly name?: string;

	private _subscribers = new Set<Sink>();
	private _activated = false;
	private _depUnsubs: Array<() => void> = [];
	// R-rewire: each dep's subscription reads its index from a mutable box so a surgical
	// rewire-reorder reroutes in O(1) (no per-message indexOf scan — F-PERF for high fan-in).
	private _depIdxBoxes: Array<{ v: number }> = [];

	// per-dep wave state
	private _depBatch: Array<unknown[] | null>;
	private _depPrev: unknown[];
	private _depHasData: boolean[];
	private _depDirty: boolean[];
	private _depTier: number[];
	private _depTerminal: Array<true | unknown | undefined>;
	private _pending = 0;

	private _cache: T | undefined = SENTINEL;
	private _hasData = false;
	private _status: Status = "sentinel";
	private _hasCalledFnOnce = false;
	private _emittedDirtyThisWave = false;
	private _insideRunWave = false;
	/** R-rewire: reentrancy guard for setDeps/addDep/removeDep (one mutation in flight). */
	private _inDepMutation = false;
	/** R-rewire: a dep-add push during mutation requests ONE atomic two-phase settle after. */
	private _rewireRunPending = false;
	/** Node's own terminal: undefined = live, true = COMPLETE, else ERROR payload. */
	private _terminal: true | unknown | undefined = undefined;
	private _hasTorndown = false;

	// control plane (R-pause-lockset, R-pause-modes, R-async-paused, R-replay-buffer)
	private _pauseLockset = new Set<unknown>();
	private _pausedDepWaveOccurred = false;
	private _pauseBuffer: Wave[] = [];
	private _replayRing: T[] = [];
	// BH1: a DIRTY broadcast during a batch defer is owed a balancing RESOLVED on
	// rollback — tracked independently of _emittedDirtyThisWave (which a fn wave resets).
	private _batchDirtyOwed = false;

	// ctx.state (R-ctx-state)
	private _state: unknown = SENTINEL;
	private _statePersist = false;

	// cleanup hooks (R-cleanup-hooks)
	private _onDeactivation: Array<() => void> = [];
	private _onInvalidate: Array<() => void> = [];

	// reusable depRecords + sync ctx (L3-Q5 node-stable ctx for the sync pool)
	private _depRecords: DepRecord[];
	private _syncCtx: Ctx | null = null;

	constructor(
		deps: Node<unknown>[],
		handleOrFn: Handle | NodeFn | null,
		opts: NodeOptions<T> = {},
	) {
		this._deps = deps;
		this._dispatcher = opts.dispatcher ?? defaultDispatcher;
		this._equals = (opts.equals ?? defaultEquals) as (a: T, b: T) => boolean;
		this._partial = opts.partial ?? false;
		this._terminalAsRealInput = opts.terminalAsRealInput ?? false;
		this._completeWhenDepsComplete = opts.completeWhenDepsComplete ?? true;
		this._errorWhenDepsError = opts.errorWhenDepsError ?? true;
		this._resubscribable = opts.resubscribable ?? false;
		this._resetOnTeardown = opts.resetOnTeardown ?? false;
		this._pausable = opts.pausable ?? true;
		this._replayN = opts.replayBuffer ?? 0;
		this._dynamic = opts.dynamic ?? false;
		this._pool = opts.pool ?? "sync";
		this.name = opts.name;

		if (handleOrFn === null) this._handle = null;
		else if (typeof handleOrFn === "function")
			this._handle = this._dispatcher.register(handleOrFn, this._pool);
		else this._handle = handleOrFn;

		const n = deps.length;
		this._depBatch = new Array(n).fill(null);
		this._depPrev = new Array(n).fill(SENTINEL);
		this._depHasData = new Array(n).fill(false);
		this._depDirty = new Array(n).fill(false);
		this._depTier = new Array(n).fill(0);
		this._depTerminal = new Array(n).fill(undefined);
		this._depRecords = deps.map(() => ({
			batch: null,
			prevData: SENTINEL,
			latest: SENTINEL,
			tier: 0,
			terminal: undefined,
		}));

		// R-initial: a provided initial (incl null) pre-populates the cache.
		if (opts.initial !== undefined) {
			this._cache = opts.initial as T;
			this._hasData = true;
			this._status = "settled";
		}
	}

	get cache(): T | undefined {
		return this._cache;
	}

	get status(): Status {
		return this._status;
	}

	/**
	 * The fn handle (pure data `(poolId, handleId)`, D7) or null for state/passthrough
	 * nodes. Inspection-only (L1.6 handle is referenceable/inspectable) — lets the graph
	 * layer key a dispatcher-backed profile recorder WITHOUT putting counters on the node
	 * (R-node-thin / D39).
	 */
	get handle(): Handle | null {
		return this._handle;
	}

	/** R-push-subscribe: a new sink receives START, then cached DATA (or DIRTY if dirty). */
	subscribe(sink: Sink): () => void {
		// R-terminal: late subscribe to a terminal node either resets (resubscribable)
		// or is rejected (non-resubscribable, R2.2.7.b).
		if (this._terminal !== undefined) {
			if (this._resubscribable) this._resetLifecycle();
			else
				throw new Error(
					"subscribe: node is non-resubscribable and has terminated; the stream is permanently over (R-terminal / R2.2.7.b)",
				);
		}

		this._subscribers.add(sink);
		sink(["START"]);
		if (this._replayN > 0 && this._replayRing.length > 0) {
			// R-replay-buffer: late subscriber gets the last N DATA after START.
			for (const v of this._replayRing) sink(["DATA", v]);
		} else if (this._hasData) {
			sink(["DATA", this._cache]);
		} else if (this._status === "dirty") {
			sink(["DIRTY"]);
		}

		if (!this._activated) this._activate();

		return () => {
			if (!this._subscribers.delete(sink)) return;
			if (this._subscribers.size === 0) this._deactivate();
		};
	}

	/** External emission toward sinks (state-node push, or async late-emit). One call = one wave. */
	down(msgs: Wave): void {
		this._down(msgs);
	}

	/** Emit upstream toward deps — control tiers only (R-ctx-up). */
	up(msgs: Wave): void {
		this._up(msgs);
	}

	// ── rewire (R-rewire / D42): intra-graph runtime topology mutation ──

	/**
	 * Replace this node's deps atomically (surgical, Option-C). Requires an explicit
	 * `fn` (SD-1 fn-deps pairing — user fns read depRecords positionally). Kept deps
	 * keep their subscription + per-dep state; only removed deps unsubscribe and only
	 * added deps fresh-subscribe (push-on-subscribe for an added cached dep). The
	 * first-run gate and cache are PRESERVED (R-rewire Q2/Q7). Intra-graph only (D22).
	 */
	setDeps(newDeps: Node<unknown>[], fn: NodeFn): void {
		this._rewire(this._dedupDeps(newDeps), fn);
	}

	/** Add one dep (special case of setDeps); returns its index. fn required (SD-1). */
	addDep(depNode: Node<unknown>, fn: NodeFn): number {
		const next = this._deps.includes(depNode) ? [...this._deps] : [...this._deps, depNode];
		this._rewire(next, fn);
		return this._deps.indexOf(depNode);
	}

	/** Remove one dep (special case of setDeps); idempotent if absent (fn swap still applies). */
	removeDep(depNode: Node<unknown>, fn: NodeFn): void {
		this._rewire(
			this._deps.filter((d) => d !== depNode),
			fn,
		);
	}

	private _dedupDeps(deps: Node<unknown>[]): Node<unknown>[] {
		const seen = new Set<Node<unknown>>();
		const out: Node<unknown>[] = [];
		for (const d of deps)
			if (!seen.has(d)) {
				seen.add(d);
				out.push(d);
			}
		return out;
	}

	/** Is `target` reachable upstream from `from` (following deps)? Cycle-prevention DFS. */
	private _reachableUpstream(from: Node<unknown>, target: Node<unknown>): boolean {
		const seen = new Set<Node<unknown>>();
		const stack: Node<unknown>[] = [from];
		while (stack.length > 0) {
			const n = stack.pop();
			if (n === undefined) continue;
			if (n === target) return true;
			if (seen.has(n)) continue;
			seen.add(n);
			for (const d of n._deps) stack.push(d);
		}
		return false;
	}

	private _rewire(newDeps: Node<unknown>[], fn: NodeFn): void {
		// ── rejects (R-rewire / D42) ──
		if (this._terminal !== undefined)
			throw new Error(
				"rewire: node is terminal (completed/errored) — cannot rewire (R-rewire / D42)",
			);
		if (this._insideRunWave)
			throw new Error(
				"rewire: mid-fn topology mutation — a fn mutating its own deps mid-wave is the feedback cycle (R-rewire / D37)",
			);
		if (this._inDepMutation)
			throw new Error(
				"rewire: reentrant dep mutation — another setDeps/addDep/removeDep is in flight (R-rewire)",
			);
		if (newDeps.includes(this as unknown as Node<unknown>))
			throw new Error("rewire: self-dependency rejected (R-rewire / D42)");
		const oldDeps = this._deps;
		const added = newDeps.filter((d) => !oldDeps.includes(d));
		for (const d of added) {
			if (this._reachableUpstream(d, this as unknown as Node<unknown>))
				throw new Error(
					"rewire: would create a cycle — dep already transitively depends on this node (R-rewire / D42)",
				);
			if (d._terminal !== undefined && !d._resubscribable)
				throw new Error(
					"rewire: cannot add a non-resubscribable terminal dep — would wedge (R-rewire / D42)",
				);
		}

		this._inDepMutation = true;
		this._rewireRunPending = false;
		let zeroDepUnDirty = false;
		try {
			// fn swap (SD-1): re-register against the same pool.
			this._handle = this._dispatcher.register(fn, this._pool);

			const removed = oldDeps.filter((d) => !newDeps.includes(d));
			let removedDirtyContributor = false;
			for (const d of removed) {
				const oldIdx = oldDeps.indexOf(d);
				if (this._depDirty[oldIdx]) {
					removedDirtyContributor = true;
					this._pending--;
				}
				if (this._activated) {
					const box = this._depIdxBoxes[oldIdx];
					if (box) box.v = -1; // drain: any stale in-flight callback drops
					const unsub = this._depUnsubs[oldIdx];
					if (unsub) unsub(); // stops the removed dep's edge — no further delivery
				}
			}

			// Rebuild per-dep parallel arrays in newDeps order; kept deps carry their state
			// + subscription, added deps start fresh (R-rewire Q1/Q4).
			const n = newDeps.length;
			const newBatch: Array<unknown[] | null> = new Array(n).fill(null);
			const newPrev: unknown[] = new Array(n).fill(SENTINEL);
			const newHasData: boolean[] = new Array(n).fill(false);
			const newDirty: boolean[] = new Array(n).fill(false);
			const newTier: number[] = new Array(n).fill(0);
			const newTerminal: Array<true | unknown | undefined> = new Array(n).fill(undefined);
			const newUnsubs: Array<() => void> = new Array(n);
			const newBoxes: Array<{ v: number }> = new Array(n);
			for (let j = 0; j < n; j++) {
				const oldIdx = oldDeps.indexOf(newDeps[j]);
				if (oldIdx !== -1) {
					newBatch[j] = this._depBatch[oldIdx];
					newPrev[j] = this._depPrev[oldIdx];
					newHasData[j] = this._depHasData[oldIdx];
					newDirty[j] = this._depDirty[oldIdx];
					newTier[j] = this._depTier[oldIdx];
					newTerminal[j] = this._depTerminal[oldIdx];
					newUnsubs[j] = this._depUnsubs[oldIdx];
					// carry the kept dep's subscription box and point it at the new index (O(1) reroute)
					const box = this._depIdxBoxes[oldIdx];
					if (box) box.v = j;
					newBoxes[j] = box;
				}
			}
			this._deps = newDeps;
			this._depBatch = newBatch;
			this._depPrev = newPrev;
			this._depHasData = newHasData;
			this._depDirty = newDirty;
			this._depTier = newTier;
			this._depTerminal = newTerminal;
			this._depUnsubs = newUnsubs;
			this._depIdxBoxes = newBoxes;
			// depRecords are wave-scratch (rebuilt in _buildCtx); fresh array + drop the
			// cached sync ctx whose `depRecords` pointed at the old array.
			this._depRecords = newDeps.map(() => ({
				batch: null,
				prevData: SENTINEL,
				latest: SENTINEL,
				tier: 0,
				terminal: undefined,
			}));
			this._syncCtx = null;

			// Subscribe added deps — push-on-subscribe (R-push-subscribe) delivers a cached
			// dep's DATA here, which drives _maybeRun; a SENTINEL dep delivers START only.
			if (this._activated) {
				for (const d of added) this._subscribeDepAt(d);
			}

			// Q6 auto-settle: removing the sole dirty contributor closes the wave. With deps
			// remaining, request the atomic settle (recompute; equals absorbs a no-change run →
			// RESOLVED). With zero deps the node is inert (degenerate fn-no-deps) — just un-dirty
			// downstream. Cache is preserved either way (Q7).
			if (removedDirtyContributor && this._pending === 0 && this._status === "dirty") {
				if (newDeps.length > 0) this._rewireRunPending = true;
				else zeroDepUnDirty = true;
			}
		} finally {
			this._inDepMutation = false;
		}

		// Atomic post-mutation settle (outside the reentrancy guard so a fresh wave runs
		// normally): ONE two-phase DIRTY→DATA recompute if any added dep delivered data or a
		// sole-dirty dep was removed; else the zero-dep un-dirty via _down (pause/batch-safe).
		if (this._rewireRunPending) {
			this._rewireRunPending = false;
			this._settleRewire();
		} else if (zeroDepUnDirty) {
			if (this._emittedDirtyThisWave) this._down([["RESOLVED"]]);
			else this._status = this._hasData ? "settled" : "sentinel";
		}
	}

	// ── activation / deactivation (lazy; R-rom-ram) ──

	private _activate(): void {
		this._activated = true;
		this._depUnsubs = new Array(this._deps.length);
		this._depIdxBoxes = new Array(this._deps.length);
		for (const dep of this._deps) this._subscribeDepAt(dep);
		// Depless producer (fn, no deps): run once on activation.
		if (this._deps.length === 0 && this._handle !== null && !this._hasCalledFnOnce) {
			this._runWave();
		}
	}

	/**
	 * Subscribe to a dep. The dispatch callback reads the dep's CURRENT index from a
	 * mutable box (O(1)); a surgical rewire that reorders kept deps just updates the box
	 * (R-rewire Option-C / D42) — no re-subscribe, no per-message indexOf scan. A removed
	 * dep's box is set to -1 so any stale in-flight callback drops (drain).
	 */
	private _subscribeDepAt(depNode: Node<unknown>): void {
		const idx0 = this._deps.indexOf(depNode);
		const box = { v: idx0 };
		const unsub = depNode.subscribe((msg) => {
			if (box.v === -1) return; // dep removed — stale callback, drop (drain)
			this._receiveFromDep(box.v, msg);
		});
		if (idx0 !== -1) {
			this._depUnsubs[idx0] = unsub;
			this._depIdxBoxes[idx0] = box;
		}
	}

	private _deactivate(): void {
		this._activated = false;
		for (const u of this._depUnsubs) if (u) u();
		this._depUnsubs = [];
		this._depIdxBoxes = [];
		for (const fn of this._onDeactivation) fn();
		this._onDeactivation = [];
		this._onInvalidate = [];

		const isCompute = this._handle !== null || this._deps.length > 0;
		if (isCompute) {
			// RAM: compute nodes clear cache; reconnect re-runs fn fresh.
			this._cache = SENTINEL;
			this._hasData = false;
			this._status = "sentinel";
		}
		this._resetDepState();
		this._hasCalledFnOnce = false;
		this._pauseLockset.clear();
		this._pauseBuffer = [];
		this._pausedDepWaveOccurred = false;
		this._replayRing = []; // BH6: don't replay stale values to a post-reactivation subscriber
		if (!this._statePersist) this._state = SENTINEL;
	}

	private _resetDepState(): void {
		const n = this._deps.length;
		for (let i = 0; i < n; i++) {
			this._depBatch[i] = null;
			this._depPrev[i] = SENTINEL;
			this._depHasData[i] = false;
			this._depDirty[i] = false;
			this._depTier[i] = 0;
			this._depTerminal[i] = undefined;
		}
		this._pending = 0;
		this._emittedDirtyThisWave = false;
	}

	// ── upstream wave receive (two-phase + diamond) ──

	private _receiveFromDep(idx: number, msg: Message): void {
		const t = msg[0];
		if (t === "START") return;
		// Terminal-is-forever: a terminated node ignores further upstream messages.
		if (this._terminal !== undefined) return;

		if (t === "INVALIDATE") {
			// The dep's value is gone — drop our view of it (prevData -> SENTINEL so the
			// never-emitted detector reads correctly, C-3) and cascade (idempotent).
			this._depPrev[idx] = SENTINEL;
			this._depHasData[idx] = false;
			this._depBatch[idx] = null;
			// EC3: un-wedge the dirty bookkeeping if this dep had gone DIRTY first, so an
			// INVALIDATE-before-DATA doesn't strand _pending / downstream forever
			// (R-invalidate-idempotent — exists to prevent the wedged-DIRTY deadlock).
			if (this._depDirty[idx]) {
				this._depDirty[idx] = false;
				this._pending--;
			}
			const hadData = this._hasData;
			this._invalidate(); // cascades INVALIDATE iff populated; no-op otherwise
			// If we broadcast DIRTY this wave but _invalidate produced no settle (the node
			// was never populated, so the cascade is suppressed per the rule), un-dirty
			// downstream with a RESOLVED once all deps have settled.
			if (this._pending === 0 && this._emittedDirtyThisWave) {
				this._emittedDirtyThisWave = false;
				if (!hadData) {
					this._status = "sentinel";
					this._emitToSubs(["RESOLVED"]);
				}
			}
			return;
		}

		if (t === "COMPLETE") {
			this._depTerminal[idx] = true;
			if (this._completeWhenDepsComplete && this._allDepsComplete()) {
				this._down([["COMPLETE"]]);
			} else if (this._terminalAsRealInput) {
				this._maybeRun();
			}
			return;
		}

		if (t === "ERROR") {
			this._depTerminal[idx] = msg[1];
			if (this._errorWhenDepsError) {
				this._down([["ERROR", msg[1]]]);
			} else if (this._terminalAsRealInput) {
				this._maybeRun();
			}
			return;
		}

		if (t === "TEARDOWN") {
			this._down([["TEARDOWN"]]);
			return;
		}

		if (t === "DIRTY") {
			if (!this._depDirty[idx]) {
				this._depDirty[idx] = true;
				this._pending++;
				this._depTier[idx] = 2;
				this._markDirty();
			}
			return;
		}

		if (t === "DATA") {
			const v = msg[1];
			const b = this._depBatch[idx];
			if (b === null) this._depBatch[idx] = [v];
			else b.push(v);
			this._depPrev[idx] = v;
			this._depHasData[idx] = true;
			this._depTier[idx] = 3;
			if (this._depDirty[idx]) {
				this._depDirty[idx] = false;
				this._pending--;
			}
			this._maybeRun();
			return;
		}

		if (t === "RESOLVED") {
			this._depTier[idx] = 3;
			if (this._depDirty[idx]) {
				this._depDirty[idx] = false;
				this._pending--;
			}
			this._maybeRun();
			return;
		}
		// PAUSE / RESUME are not delivered downstream to a dep-subscriber; a node is
		// paused via its own up() (lockset), not by an upstream dep.
	}

	private _markDirty(): void {
		this._status = "dirty";
		if (!this._emittedDirtyThisWave) {
			this._emittedDirtyThisWave = true;
			this._emitToSubs(["DIRTY"]);
		}
	}

	private _maybeRun(): void {
		// R-rewire: an added cached dep's push-on-subscribe lands here mid-mutation. Defer
		// the fn-run to ONE atomic two-phase settle after every added dep is wired, so the
		// fn never fires on a partially-populated added-dep view (multi-add) — _settleRewire
		// drains this flag.
		if (this._inDepMutation) {
			this._rewireRunPending = true;
			return;
		}
		// R-pause-modes (default): while paused, skip dep-driven fn re-execution and
		// coalesce — fire once with the latest dep values on final-lock RESUME.
		if (this._pausable === true && this._isPaused()) {
			this._pausedDepWaveOccurred = true;
			return;
		}
		this._tryRun();
	}

	/**
	 * R-rewire atomic settle (after a rewire that warrants a recompute): emit a proper
	 * two-phase DIRTY→DATA wave (R-dirty-before-data — a rewire-triggered settle is a wave),
	 * once, with every added dep already wired. Mirrors _maybeRun/_tryRun's pause + gate +
	 * pending guards, then injects the phase-1 DIRTY the added dep's [START,DATA] handshake
	 * did not carry.
	 */
	private _settleRewire(): void {
		if (this._pausable === true && this._isPaused()) {
			this._pausedDepWaveOccurred = true;
			return;
		}
		if (this._pending > 0) return;
		if (this._handle === null) {
			this._passthroughEmit();
			return;
		}
		if (!this._hasCalledFnOnce && !(this._partial || this._allDepsSettled())) return;
		this._markDirty(); // phase 1 (no-op if already dirty, e.g. removeDep auto-settle)
		this._runWave(); // phase 2: fn → DATA/RESOLVED
	}

	private _tryRun(): void {
		if (this._pending > 0) return;
		if (this._handle === null) {
			// Passthrough wire (deps, no fn): forward the latest dep DATA downstream.
			this._passthroughEmit();
			return;
		}
		if (!this._hasCalledFnOnce) {
			if (this._partial || this._allDepsSettled()) this._runWave();
			// else: first-run gate holds fn until every dep has settled (R-first-run-gate).
			return;
		}
		this._runWave();
	}

	private _allDepsSettled(): boolean {
		for (let i = 0; i < this._deps.length; i++) {
			if (this._depHasData[i]) continue;
			if (this._terminalAsRealInput && this._depTerminal[i] !== undefined) continue;
			return false;
		}
		return true;
	}

	private _passthroughEmit(): void {
		// Single-dep wire: relay dep 0's latest batch value as DATA.
		const b = this._depBatch[0];
		if (b !== null && b.length > 0) {
			this._down([["DATA", b[b.length - 1]]]);
		}
		this._depBatch[0] = null;
		this._emittedDirtyThisWave = false;
	}

	private _runWave(): void {
		// R-reentrancy (D37): a fn that re-drives its own dep mid-wave re-enters here while
		// _insideRunWave is still set — a synchronous feedback cycle. Reject (throw); the graph
		// layer catches it and converts to [[ERROR, e]] (D30). The try/finally resets the flag
		// on every frame as the throw unwinds, leaving the graph clean for the catch. Detection
		// is node-local and free — it reuses the existing _insideRunWave flag (no new structure,
		// dispatcher stays a pure funnel).
		if (this._insideRunWave)
			throw new Error(
				"synchronous feedback cycle: node fn re-entered its own wave (R-reentrancy / D37)",
			);
		this._hasCalledFnOnce = true;
		const ctx = this._buildCtx();
		this._insideRunWave = true;
		try {
			this._dispatcher.invoke(this._handle as Handle, ctx);
		} finally {
			this._insideRunWave = false;
		}

		// roll wave-local state forward
		for (let i = 0; i < this._depBatch.length; i++) this._depBatch[i] = null;
		this._emittedDirtyThisWave = false;
	}

	// ── ctx construction (L3-Q5: sync = node-stable reused ctx; async = per-invocation) ──

	private _buildCtx(): Ctx {
		for (let i = 0; i < this._deps.length; i++) {
			const batch = this._depBatch[i];
			const prev = this._depPrev[i];
			const rec = this._depRecords[i];
			rec.batch = batch as readonly unknown[] | null;
			rec.prevData = prev;
			rec.latest = batch && batch.length > 0 ? batch[batch.length - 1] : prev;
			rec.tier = this._depTier[i];
			rec.terminal = this._depTerminal[i];
		}

		const kind = this._handle ? this._dispatcher.poolKind(this._handle.poolId) : "sync";
		if (kind === "sync") {
			if (this._syncCtx === null) this._syncCtx = this._makeCtx(this._depRecords);
			return this._syncCtx;
		}
		// async: snapshot depRecords so a deferred late-emit reads this wave's view.
		return this._makeCtx(this._depRecords.map((r) => ({ ...r })));
	}

	private _makeCtx(depRecords: readonly DepRecord[]): Ctx {
		const ctx: Ctx = {
			up: (msgs) => this._up(msgs),
			down: (msgs) => this._down(msgs),
			depRecords,
			state: this._makeState(),
			onDeactivation: (fn) => {
				this._onDeactivation.push(fn);
			},
			onInvalidate: (fn) => {
				this._onInvalidate.push(fn);
			},
		};
		if (this._dynamic) {
			// R-dynamic-node: read a dep's latest by index. Untracked deps still drive
			// waves; if the output is unchanged, equals absorbs them (RESOLVED).
			ctx.track = (i: number) => ctx.depRecords[i]?.latest;
		}
		return ctx;
	}

	private _makeState(): CtxState {
		return {
			get: <S>() => this._state as S | undefined,
			set: <S>(v: S) => {
				this._state = v;
			},
			persist: (on = true) => {
				this._statePersist = on;
			},
		};
	}

	// ── downstream emission pipeline (the unified waist) ──

	private _down(msgs: Wave): void {
		let sorted: Message[] = [...msgs].sort((a, b) => messageTier(a[0]) - messageTier(b[0]));
		// R-same-wave-merge: collapse repeated INVALIDATE in one wave (Q9) so the
		// cleanup hook + downstream broadcast fire at most once.
		const firstInvalidate = sorted.findIndex((m) => m[0] === "INVALIDATE");
		if (firstInvalidate !== -1) {
			sorted = sorted.filter((m, i) => m[0] !== "INVALIDATE" || i === firstInvalidate);
		}
		// R-teardown-complete: a TEARDOWN reaching a non-terminal node synthesizes a
		// COMPLETE prefix (so firstValueFrom-style bridges resolve), unless the wave
		// already carries a terminal or the node already tore down.
		const hasTeardown = sorted.some((m) => m[0] === "TEARDOWN");
		const hasTerminal = sorted.some((m) => m[0] === "COMPLETE" || m[0] === "ERROR");
		if (hasTeardown && !hasTerminal && this._terminal === undefined && !this._hasTorndown) {
			sorted = [["COMPLETE"], ...sorted];
		}
		// R-batch-coalesce (D12): inside a batch, emit DIRTY immediately but defer the
		// tier-3 settle slice to commit so a shared downstream recomputes once. Only
		// external emits defer (fn emits during commit run normally).
		if (!this._insideRunWave && currentBatch()) {
			const tier3 = sorted.filter((m) => messageTier(m[0]) >= 3);
			if (tier3.length > 0) {
				if (!this._emittedDirtyThisWave) {
					this._emittedDirtyThisWave = true;
					this._status = "dirty";
					this._emitToSubs(["DIRTY"]);
				}
				this._batchDirtyOwed = true; // BH1: owe a balancing RESOLVED on rollback
				deferToBatch(this, tier3);
				return;
			}
		}
		// R-pause-modes / R-async-paused: defer the settle slice (tier 3/4) into the
		// pause buffer while paused; tier 0-2 (DIRTY/PAUSE/RESUME), tier 5 (terminal),
		// tier 6 (TEARDOWN) bypass so end-of-stream + control always reach observers.
		if (this._shouldBufferOnPause()) {
			const buffered = sorted.filter((m) => {
				const t = messageTier(m[0]);
				return t === 3 || t === 4;
			});
			if (buffered.length > 0) this._pauseBuffer.push(buffered);
			sorted = sorted.filter((m) => {
				const t = messageTier(m[0]);
				return t !== 3 && t !== 4;
			});
			if (sorted.length === 0) return;
		}
		let dataCount = 0;
		let hasTier3 = false;
		let hasResolved = false;
		for (const m of sorted) {
			if (m[0] === "DATA") dataCount++;
			if (m[0] === "RESOLVED") hasResolved = true;
			if (messageTier(m[0]) === 3) hasTier3 = true;
		}
		// EC2 / R-equals tier-3 exclusivity: a wave's tier-3 slot is >=1 DATA XOR exactly
		// 1 RESOLVED — never mixed. Reject the protocol violation fail-fast.
		if (dataCount >= 1 && hasResolved) {
			throw new Error("down: a wave cannot mix DATA and RESOLVED (tier-3 exclusivity, R-equals)");
		}

		// Synthesize a leading DIRTY for an EXTERNAL tier-3 emit (R-dirty-before-data).
		// Inside runWave the DIRTY was already propagated (or the wave is activation-exempt).
		if (hasTier3 && !this._insideRunWave && !this._emittedDirtyThisWave) {
			this._emittedDirtyThisWave = true;
			this._status = "dirty";
			this._emitToSubs(["DIRTY"]);
		}

		for (const m of sorted) {
			if (m[0] === "DIRTY") {
				if (!this._emittedDirtyThisWave) {
					this._emittedDirtyThisWave = true;
					this._status = "dirty";
					this._emitToSubs(["DIRTY"]);
				}
				continue;
			}
			if (m[0] === "DATA") {
				if (m[1] === undefined) {
					// EC1 / R-data-payload: bare [DATA] / [DATA, SENTINEL] is rejected.
					throw new Error("down: DATA requires a non-SENTINEL payload (R-data-payload)");
				}
				const v = m[1] as T;
				// R-equals: DATA->RESOLVED substitution ONLY on a single-DATA wave.
				if (dataCount === 1 && this._hasData && this._equals(this._cache as T, v)) {
					this._status = "resolved";
					this._emitToSubs(["RESOLVED"]);
				} else {
					this._cache = v;
					this._hasData = true;
					this._status = "settled";
					if (this._replayN > 0) {
						this._replayRing.push(v);
						if (this._replayRing.length > this._replayN) this._replayRing.shift();
					}
					this._emitToSubs(["DATA", v]);
				}
				continue;
			}
			if (m[0] === "RESOLVED") {
				this._status = "resolved";
				this._emitToSubs(["RESOLVED"]);
				continue;
			}
			if (m[0] === "INVALIDATE") {
				this._invalidate();
				continue;
			}
			if (m[0] === "COMPLETE") {
				if (this._terminal !== undefined) continue;
				this._terminal = true;
				this._pauseBuffer = []; // BH3: terminal discards buffered settle slices
				this._status = "completed";
				this._emitToSubs(["COMPLETE"]);
				continue;
			}
			if (m[0] === "ERROR") {
				if (this._terminal !== undefined) continue;
				if (m[1] === undefined) {
					throw new Error("down: ERROR requires a non-SENTINEL payload (R-data-payload)");
				}
				this._terminal = m[1];
				this._pauseBuffer = []; // BH3: terminal discards buffered settle slices
				this._status = "errored";
				this._emitToSubs(["ERROR", m[1]]);
				continue;
			}
			if (m[0] === "TEARDOWN") {
				this._hasTorndown = true;
				if (this._resetOnTeardown) {
					this._cache = SENTINEL;
					this._hasData = false;
				}
				this._emitToSubs(["TEARDOWN"]);
			}
			// PAUSE / RESUME — control slice.
		}

		if (!this._insideRunWave) this._emittedDirtyThisWave = false;
	}

	private _up(msgs: Wave): void {
		for (const m of msgs) {
			if (!isUpAllowed(m[0])) {
				throw new Error(
					`ctx.up: ${m[0]} is down-only (tier ${messageTier(m[0])}); up carries control tiers only (R-ctx-up)`,
				);
			}
		}
		for (const m of msgs) {
			if (m[0] === "PAUSE") {
				this._pauseAcquire(m[1]);
			} else if (m[0] === "RESUME") {
				this._pauseRelease(m[1]);
			} else if (this._deps.length === 0) {
				// R-up-at-source (D38): a depless source is the terminus of upstream control.
				// INVALIDATE → HONOR the invalidate-request. Routed through _down (NOT a direct
				// _invalidate call, QA A-2) so the invalidate-request respects batch-defer (D12)
				// and pause-buffer exactly like a downstream-originated INVALIDATE; _down's
				// INVALIDATE branch calls _invalidate() (clear cache → SENTINEL, fire onInvalidate,
				// broadcast downstream). Outside batch/pause it is identical to a direct call.
				// DIRTY / TEARDOWN → DROP (no coherent terminus action; self-dirty would wedge
				// downstream awaiting a settle that never comes; source lifecycle is source-owned).
				if (m[0] === "INVALIDATE") this._down([["INVALIDATE"]]);
			} else {
				// dep-bearing intermediate: forward upstream toward deps, no self-action.
				for (const dep of this._deps) dep.up([m]);
			}
		}
	}

	// ── PAUSE/RESUME lockset (R-pause-lockset) + modes (R-pause-modes) ──

	private _isPaused(): boolean {
		return this._pauseLockset.size > 0;
	}

	private _isAsyncPool(): boolean {
		return this._handle !== null && this._dispatcher.poolKind(this._handle.poolId) === "async";
	}

	private _pauseAcquire(lockId: unknown): void {
		this._pauseLockset.add(lockId); // Set => same-id repeat PAUSE is idempotent
	}

	private _pauseRelease(lockId: unknown): void {
		if (!this._pauseLockset.has(lockId)) return; // unknown id => no-op
		this._pauseLockset.delete(lockId);
		if (this._pauseLockset.size > 0) return; // another lock still held => stay paused
		this._onResume();
	}

	private _onResume(): void {
		// BH3: a node that terminated while paused discards its buffer and never
		// replays/recomputes (terminal-is-forever).
		if (this._terminal !== undefined) {
			this._pauseBuffer = [];
			this._pausedDepWaveOccurred = false;
			return;
		}
		// Drain buffered settle slices (resumeAll / async-at-paused, R-async-paused).
		if (this._pauseBuffer.length > 0) {
			const buf = this._pauseBuffer;
			this._pauseBuffer = [];
			for (const wave of buf) this._down(wave);
		}
		// Default mode: a dep wave that arrived while paused fires the fn once now.
		if (this._pausedDepWaveOccurred) {
			this._pausedDepWaveOccurred = false;
			this._tryRun();
		}
	}

	/** Should an outgoing settle slice be deferred into the pause buffer? */
	private _shouldBufferOnPause(): boolean {
		if (!this._isPaused()) return false;
		if (this._pausable === "resumeAll") return true;
		// R-async-paused / DR-3: a late emit (outside runWave) from an async-pool node buffers.
		if (!this._insideRunWave && this._isAsyncPool()) return true;
		return false;
	}

	/** R-invalidate-idempotent: clear cache + flush + cascade; no-op if nothing cached. */
	private _invalidate(): void {
		if (!this._hasData) return; // never-populated or already-reset → no-op
		this._cache = SENTINEL;
		this._hasData = false;
		this._status = "sentinel";
		this._replayRing = []; // BH6: invalidated values are stale — don't replay them
		for (const fn of this._onInvalidate) fn();
		this._emitToSubs(["INVALIDATE"]);
	}

	private _allDepsComplete(): boolean {
		if (this._deps.length === 0) return false;
		for (const tm of this._depTerminal) if (tm !== true) return false;
		return true;
	}

	/** R-terminal: resubscribable reset clears terminal + dep state + re-arms the gate. */
	private _resetLifecycle(): void {
		for (const u of this._depUnsubs) if (u) u();
		this._depUnsubs = [];
		this._depIdxBoxes = [];
		this._activated = false;
		this._terminal = undefined;
		this._hasTorndown = false;
		this._hasCalledFnOnce = false;
		this._resetDepState();
		this._pauseLockset.clear();
		this._pauseBuffer = [];
		this._pausedDepWaveOccurred = false;
		this._replayRing = []; // BH6
		const isCompute = this._handle !== null || this._deps.length > 0;
		if (isCompute) {
			this._cache = SENTINEL;
			this._hasData = false;
			this._status = "sentinel";
		} else {
			this._status = this._hasData ? "settled" : "sentinel";
		}
		if (!this._statePersist) this._state = SENTINEL;
	}

	private _emitToSubs(msg: Message): void {
		// Copy guards against subscribe/unsubscribe during iteration.
		const subs = [...this._subscribers];
		for (const sink of subs) sink(msg);
	}

	/** Batch commit (R-batch-coalesce): deliver the deferred tier-3 wave now. */
	__commitBatchedWave(wave: Wave): void {
		this._batchDirtyOwed = false; // commit delivers the real settle (BH1)
		this._down(wave); // batch is inactive at commit -> processes normally
	}

	/** Batch rollback: balance the immediate DIRTY with a RESOLVED so downstream un-dirties. */
	__rollbackBatched(): void {
		// BH1: keyed on _batchDirtyOwed (not _emittedDirtyThisWave, which a fn wave between
		// defer and rollback would have reset) so the balancing RESOLVED is never skipped.
		if (this._batchDirtyOwed) {
			this._batchDirtyOwed = false;
			this._emittedDirtyThisWave = false;
			this._status = this._hasData ? "settled" : "sentinel";
			this._emitToSubs(["RESOLVED"]);
		}
	}
}

/**
 * Construct a node (R-node-iface / D5 / L1.9 deps-first).
 *   node([], null, { initial })       — state node (manual source; emit via .down)
 *   node([], fn)                        — producer (runs on activation)
 *   node([a, b], fn)                    — compute / derived
 *   node([dep])                         — passthrough wire
 */
export function node<T = unknown>(
	deps: Node<unknown>[] = [],
	handleOrFn: Handle | NodeFn | null = null,
	opts: NodeOptions<T> = {},
): Node<T> {
	return new Node<T>(deps, handleOrFn, opts);
}

/**
 * Construct a dynamicNode (R-dynamic-node / D35) — a node variant whose fn reads a
 * subset of a fixed superset of deps per invocation via `ctx.track(i)`. All declared
 * deps participate in wave tracking; an unread dep's change leaves the output unchanged,
 * so equals absorbs it (no downstream propagation). Intra-graph only (D22).
 */
export function dynamicNode<T = unknown>(
	deps: Node<unknown>[],
	fn: NodeFn,
	opts: NodeOptions<T> = {},
): Node<T> {
	return new Node<T>(deps, fn, { ...opts, dynamic: true });
}
