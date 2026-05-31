/**
 * The node primitive — the thinnest substrate object (R-node-thin / D5).
 *
 * Holds a fn handle + deps + the wave state machine; ZERO inspection cruft
 * (naming/find/describe are the graph layer, CSP-2). Canonical authority:
 * ~/src/graphrefly/spec/rules.jsonl (R-node-*, R-two-phase, R-diamond, R-resolved-undirty,
 * R-first-run-gate, R-push-subscribe, R-rom-ram, R-fn-contract, R-initial, R-ctx-up).
 *
 * Slice 1 = core wave: state node, compute node, two-phase DIRTY->DATA, diamond
 * pending-counter join, first-run gate, substrate-synthesized undirty RESOLVED
 * (R-resolved-undirty / D49 — no equals-substitution; every occurrence is DATA),
 * push-on-subscribe, lazy activation, ROM/RAM. Lifecycle (terminal/INVALIDATE/cleanup),
 * control (PAUSE/async), batch, and dynamicNode land in later slices.
 */

import { currentBatch, deferToBatch } from "../batch/batch.js";
import { deferRewire, enterWave, exitWave } from "../batch/boundary.js";
import type { Ctx, CtxState, DepRecord, NodeFn, Sink } from "../ctx/types.js";
import { type Dispatcher, defaultDispatcher, type Handle } from "../dispatcher/index.js";
import {
	isTerminal,
	isUpAllowed,
	type LockId,
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
	/**
	 * Pull-mode node (R-pull / D55,D59): a quiet-until-demanded source, identified by this
	 * author-supplied `pullId` (a unique LockId — a `Symbol` recommended; NOT the node name, NOT a
	 * bare string which collides with a same-string pause lock). The node self-holds the pullId as
	 * its demand lock. QUIET by default: it ABSORBS an upstream DIRTY WITHOUT relaying it downstream
	 * (the wedge fix) and does NOT push-on-subscribe its cached value (START only). A DEMAND = a
	 * cone-routed `RESUME` of this pullId (R-up-routing — NO new message type): a downstream consumer
	 * issues `ctx.up([[RESUME, pullId]])` (broadcast up the declared cone) or `ctx.up(msgs, towardDep)`
	 * (directed) WITHOUT holding this node's reference; the RESUME travels up to the pullId-holder,
	 * which fires EXACTLY ONE delivery (DIRTY-before-DATA) then RE-QUIETS (1:1). Delivery content =
	 * the orthogonal `pausable` mode: `true` → coalesced LATEST (one DATA); `'resumeAll'` → buffered
	 * BACKLOG. `pullId` + `pausable:false` is REJECTED at construction. A SELF-triggered demand (a
	 * consumer demanding a dep it ALSO reads) must defer via {@link Ctx.upNext} (R-rewire-deferred /
	 * D37). Author the pullId as a shared module const used at both this node and the demander's fn.
	 */
	pullId?: LockId;
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
	/**
	 * Real operator/source factory name for a STANDALONE graph-less node (D43-reserved; D51).
	 * The graph index (`_entries`) carries the factory for g.*-registered nodes, so this is only
	 * read for a node NOT in any graph index — a runtime *Map inner (bare `fromAny`/`initNode`
	 * node) auto-discovered by `describe` (R-describe / R-edges-derived / D51). Off the canonical
	 * wave path (R-node-thin intact — a pure annotation, never touched by the wave machinery).
	 */
	factory?: string;
}

/** A queued deferred self-rewire op (R-rewire-deferred / D47), drained at the wave boundary. */
type RewireOp =
	| { kind: "add"; dep: Node<unknown>; fn: NodeFn }
	| { kind: "remove"; dep: Node<unknown>; fn: NodeFn }
	| { kind: "set"; deps: Node<unknown>[]; fn: NodeFn };

export class Node<T = unknown> {
	private _deps: Node<unknown>[];
	private _handle: Handle | null;
	private readonly _pool: "sync" | "async";
	private readonly _dispatcher: Dispatcher;
	private readonly _partial: boolean;
	private readonly _terminalAsRealInput: boolean;
	private readonly _completeWhenDepsComplete: boolean;
	private readonly _errorWhenDepsError: boolean;
	private readonly _resubscribable: boolean;
	private readonly _resetOnTeardown: boolean;
	private readonly _pausable: boolean | "resumeAll";
	/** R-pull (D55/D59): pull-mode flag (= `opts.pullId !== undefined`). */
	private readonly _pull: boolean;
	/**
	 * R-pull (D55/D59): this pull node's pullId = its demand lock (the author-supplied `opts.pullId`,
	 * a unique LockId/Symbol, NOT the node name / a bare string — matched by IDENTITY so a cone-routed
	 * RESUME targets exactly this node, R-up-routing). Undefined for a non-pull node. Quiet ⟺ held.
	 */
	private readonly _pullLock: LockId | undefined;
	/**
	 * R-pull (D55/D59): a DEMAND arrived but could not fire immediately — the node owes ONE delivery
	 * and fires it the moment it becomes able (1:1). Set when, at demand time, a dep DIRTY is still in
	 * flight (_pending>0, pin 5) OR an external PAUSE lock co-holds the node (F4/F5). Drained by
	 * `_fireOwedDemandIfReady` from the dep-settle arms (DATA/RESOLVED/INVALIDATE/terminal) and from
	 * `_pauseRelease` (external resume). Boolean (not a counter) → coalesces to one latest delivery.
	 */
	private _demandOwed = false;
	/**
	 * R-pull (D59, QA): true WHILE a demand is being delivered (`_deliverPullDemand` momentarily
	 * releases the pullId). Guards `_onDemand`/`_fireOwedDemandIfReady` against a synchronous
	 * re-entrant demand (a downstream sink RESUMEing back during the delivery's own down-cascade) —
	 * re-entry is dropped, preserving the exactly-one-delivery (1:1) invariant by CONSTRUCTION rather
	 * than relying on the buffer-already-drained / _insideRunWave-D37 timing.
	 */
	private _inDeliverDemand = false;
	private readonly _replayN: number;
	private readonly _dynamic: boolean;
	readonly name?: string;
	/** R-describe/D51: real factory name for a standalone graph-less node (a runtime *Map inner). */
	readonly factory?: string;

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
	// R-resolved-undirty (D49): set when the fn emits any tier-3+ settle this wave; if it
	// stays false after a DIRTY'd fn run, the substrate synthesizes one undirty RESOLVED.
	private _emittedSettleThisWave = false;
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
		this._partial = opts.partial ?? false;
		this._terminalAsRealInput = opts.terminalAsRealInput ?? false;
		this._completeWhenDepsComplete = opts.completeWhenDepsComplete ?? true;
		this._errorWhenDepsError = opts.errorWhenDepsError ?? true;
		this._resubscribable = opts.resubscribable ?? false;
		this._resetOnTeardown = opts.resetOnTeardown ?? false;
		this._pausable = opts.pausable ?? true;
		// R-pull (D55/D59): pull-mode is keyed by an author-supplied pullId (its demand lock).
		this._pullLock = opts.pullId;
		this._pull = opts.pullId !== undefined;
		// R-pull (D55, pin 3): pull needs RESUME as the demand signal — pausable:false (which
		// ignores PAUSE/RESUME entirely, R-pause-modes) is a contradiction. Reject at construction.
		if (this._pull && this._pausable === false)
			throw new Error(
				"node: pullId is incompatible with pausable:false — a pull node is demanded via RESUME, which pausable:false ignores (R-pull / R-pause-modes / D55,D59)",
			);
		this._replayN = opts.replayBuffer ?? 0;
		this._dynamic = opts.dynamic ?? false;
		this._pool = opts.pool ?? "sync";
		this.name = opts.name;
		this.factory = opts.factory;

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

		// R-pull (D55): a pull node starts QUIET — self-hold its pullId (its demand lock).
		if (this._pull) this._pauseLockset.add(this._pullLock as LockId);
	}

	/** R-pull (D55): true while a pull node is quiet (holds its own pullId/demand lock). */
	private _isPullQuiet(): boolean {
		return this._pull && this._pauseLockset.has(this._pullLock);
	}

	/**
	 * R-pull (D55/D59): this pull node's pullId (pure data, like {@link cache}/{@link handle} — never
	 * triggers computation). A consumer demands one delivery by cone-routing a RESUME of it (no node
	 * reference): `ctx.up([["RESUME", pullId]])` (immediate; loops back → D37 for a self-read dep) or
	 * `ctx.upNext([["RESUME", pullId]])` (boundary-deferred self-demand, R-up-routing/R-rewire-deferred).
	 * Undefined for a non-pull node. The author writes the pullId verbatim, so this getter is mainly
	 * for inspection/describe; routing matches by the pullId value carried in the RESUME, by identity.
	 */
	get pullId(): LockId | undefined {
		return this._pullLock;
	}

	get cache(): T | undefined {
		return this._cache;
	}

	get status(): Status {
		return this._status;
	}

	/**
	 * The node's CURRENT/LIVE deps (R-describe / R-edges-derived / D51) — readonly view of the
	 * live `_deps`, which a rewire (C-8 / C-11) mutates. The graph's describe() reads this (NOT a
	 * construction-time snapshot) so every edge corresponds to a real current subscription (D3).
	 * Inspection-only, like cache/status; never triggers computation.
	 */
	get deps(): readonly Node<unknown>[] {
		return this._deps;
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
		// Wave-owner boundary (R-rewire-deferred / D47): the activation cascade can run fns that
		// issue ctx.rewireNext; the OUTERMOST exit drains them. Nested subscribes (dep wiring)
		// just inc/dec the depth.
		enterWave();
		try {
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
			} else if (this._hasData && !this._pull) {
				// R-pull (D55): a pull node NEVER push-on-subscribes its cached value — quiet by
				// default, it stays silent until demanded (START only). QA-B4: gated on `_pull` (not
				// the transient quiet-lock _isPullQuiet) so a REACTIVATED pull node — whose lockset is
				// briefly empty before _activate re-holds the demand lock — still does not leak its
				// cache (matters for a depless pull state node, whose cache survives _deactivate).
				sink(["DATA", this._cache]);
			} else if (this._status === "dirty" && !this._pull) {
				sink(["DIRTY"]);
			}

			if (!this._activated) this._activate();

			return () => {
				if (!this._subscribers.delete(sink)) return;
				if (this._subscribers.size === 0) this._deactivate();
			};
		} finally {
			exitWave();
		}
	}

	/** External emission toward sinks (state-node push, or async late-emit). One call = one wave. */
	down(msgs: Wave): void {
		// Wave-owner boundary (D47): a state.set / external push that drives a fn issuing
		// ctx.rewireNext drains at this outermost exit.
		enterWave();
		try {
			this._down(msgs);
		} finally {
			exitWave();
		}
	}

	/**
	 * Emit upstream toward deps — control tiers only (R-ctx-up). `towardDep` (a dep index) routes up
	 * ONE declared edge (R-up-routing directed-up); omitted = broadcast up all deps.
	 */
	up(msgs: Wave, towardDep?: number): void {
		// Wave-owner boundary (D47). Internal dep-forwarding calls dep.up() nest under this.
		enterWave();
		try {
			this._up(msgs, towardDep);
		} finally {
			exitWave();
		}
	}

	// ── deferred self-rewire (R-rewire-deferred / D47): ctx.rewireNext drain support ──

	/**
	 * Enqueue a deferred self-rewire op (issued from this node's fn via `ctx.rewireNext`).
	 * Applied at the committed wave boundary (boundary.ts drain), never in place — the in-fn
	 * immediate path (`addDep`/`setDeps`/`removeDep`) still throws mid-run (D37/R-reentrancy).
	 */
	private _requestRewireNext(op: RewireOp): void {
		deferRewire(() => this._applyRewireNext(op));
	}

	/**
	 * Enqueue a deferred up-going control wave (R-up-routing / R-pull / D59): at the committed wave
	 * boundary, route `msgs` up from THIS node (broadcast, or up the single `towardDep` edge). The
	 * deferred form of `ctx.up` — the SELF-demand path: a consumer issues `ctx.upNext([[RESUME,
	 * pullId]])` to demand a dep it ALSO reads; the demand applies at the boundary (not mid-fn), so
	 * the pull node's delivery loops back as a FRESH wave rather than re-entering the consumer (D37 /
	 * R-reentrancy). Rides the same R-rewire-deferred (D47) drain as ctx.rewireNext.
	 */
	private _requestUpNext(msgs: Wave, towardDep?: number): void {
		deferRewire(() => this._up(msgs, towardDep));
	}

	/** Apply one queued self-rewire at the boundary (drain thunk). */
	private _applyRewireNext(op: RewireOp): void {
		// Terminal discards the pending queue (R-rewire-deferred): a node that went terminal
		// during the wave drops its queued self-rewires.
		if (this._terminal !== undefined) return;
		try {
			if (op.kind === "add") this.addDep(op.dep, op.fn);
			else if (op.kind === "remove") this.removeDep(op.dep, op.fn);
			else this.setDeps(op.deps, op.fn);
		} catch (e) {
			// An invalid deferred op (cycle / self / non-resubscribable terminal dep) surfaces as
			// an ERROR on this node (D30-consistent) rather than stranding the rest of the drain
			// queue. Reachable only on misuse — higher-order operator inners are fresh, acyclic
			// leaf sources. Coerce a SENTINEL reason (a rewire fn that `throw undefined`s) to a real
			// Error so _down's R-data-payload guard does not itself throw out of the drain.
			this._down([["ERROR", e === undefined ? new Error("rewireNext op failed") : e]]);
		}
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
			// fn swap (SD-1): re-register against the same pool, then release the old handle
			// (B15) so the rewired-away fn closure is GC'd and its dispatcher slot is reused —
			// a rewire-heavy graph (CSP-2.7 *Map) no longer leaks a handle per swap. Register
			// first, then unregister the old: this._handle never points at a freed slot, and a
			// null old handle (a passthrough/state node gaining a fn) has nothing to free.
			const oldHandle = this._handle;
			this._handle = this._dispatcher.register(fn, this._pool);
			if (oldHandle !== null) this._dispatcher.unregister(oldHandle);

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
			// remaining, request the atomic settle (recompute → DATA for a value; a no-emit fn
			// gets a substrate-synthesized undirty RESOLVED per R-resolved-undirty/D49 — NOT
			// equals-absorption, which is gone). With zero deps the node is inert (degenerate
			// fn-no-deps) — just un-dirty downstream. Cache is preserved either way (Q7).
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
		// R-pull (D55): (re)enter QUIET before wiring deps — _deactivate cleared the lockset, so a
		// reactivation must re-hold the pullId/demand lock; doing it here (pre-subscribe) means each
		// dep's push-on-subscribe DIRTY/DATA is absorbed quietly (the wedge fix), not relayed downstream.
		if (this._pull) this._pauseLockset.add(this._pullLock as LockId);
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
		this._demandOwed = false; // R-pull (D55): drop any deferred demand
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
			// D50 / R-paused-invalidate: this INVALIDATE SUPERSEDES the dep's buffered
			// paused dep-wave (_depBatch[idx] just cleared). Re-derive the paused-recompute
			// flag — if no dep still carries a buffered DATA, CANCEL the paused recompute
			// (attributed cancellation; the node has settled to SENTINEL via its own
			// INVALIDATE, so a RESUME must not recompute against a now-SENTINEL dep). A
			// surviving dep keeps it set; a later DATA re-arms it ([DATA,INVALIDATE,DATA2]).
			if (this._pausedDepWaveOccurred && this._depBatch.every((b) => b === null)) {
				this._pausedDepWaveOccurred = false;
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
			this._fireOwedDemandIfReady(); // R-pull (D59/B1/F6): an INVALIDATE settle can drain _pending → fire a deferred demand
			return;
		}

		if (isTerminal(t)) {
			// Tier 5 (R-tier / D34): COMPLETE | ERROR — ONE branch routed by the CENTRAL tier table,
			// not a per-variant string check (feedback_use_tier_for_signal_routing). The shared terminal
			// bookkeeping (record the terminal + release the in-wave DIRTY) runs for ANY tier-5 message;
			// only the COMPLETE-vs-ERROR cascade differs, so discriminate by the type within the tier.
			const isError = t === "ERROR";
			const errPayload = isError ? (msg as readonly ["ERROR", unknown])[1] : undefined;
			// Record this dep's terminal: the ERROR payload, or `true` for COMPLETE.
			this._depTerminal[idx] = isError ? errPayload : true;
			// R-terminal-settles-dirty (B35): a terminal RELEASES this dep's outstanding in-wave DIRTY
			// contribution (the exactly-one-settle invariant) — exactly as DATA/RESOLVED/INVALIDATE do
			// (a dirty-then-terminal-without-DATA dep would otherwise strand _pending and wedge the node,
			// the deadlock R-invalidate-idempotent prevents for INVALIDATE).
			this._releaseDepDirty(idx);
			if (isError && this._errorWhenDepsError) {
				this._down([["ERROR", errPayload]]); // auto-cascade ERROR → node itself terminal
			} else if (this._terminalAsRealInput) {
				this._maybeRun(); // rescue/reduce/catch/*Map: the fn reads ctx.depRecords[idx].terminal
			} else if (this._completeWhenDepsComplete && this._allDepsTerminal()) {
				// R-deps-terminal auto-COMPLETE + B42: COMPLETE once ALL deps are TERMINAL (each COMPLETE
				// or an absorbed ERROR) — so an absorbed-error dep terminating LAST still fires the
				// cascade. terminalAsRealInput is checked FIRST so a rescue recovers via _maybeRun rather
				// than being preempted (no operator sets both completeWhenDepsComplete:true + tari:true).
				this._down([["COMPLETE"]]);
			} else {
				// absorbed terminal, NOT an input + not auto-completing: the dep's signalled change did
				// not materialise (no DATA) → un-dirty downstream, keep cache (R-resolved-undirty balance).
				this._settleAfterAbsorbedTerminal();
			}
			this._fireOwedDemandIfReady(); // R-pull (D59/B1/F6): a dep terminal can drain _pending → fire a deferred demand (no-op if this node went terminal)
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
			this._fireOwedDemandIfReady(); // R-pull pin 5: settle-ready now → fire a deferred demand
			return;
		}

		if (t === "RESOLVED") {
			this._depTier[idx] = 3;
			if (this._depDirty[idx]) {
				this._depDirty[idx] = false;
				this._pending--;
			}
			this._maybeRun();
			this._fireOwedDemandIfReady(); // R-pull pin 5: settle-ready now → fire a deferred demand
			return;
		}
		// PAUSE / RESUME are not delivered downstream to a dep-subscriber; a node is
		// paused via its own up() (lockset), not by an upstream dep.
	}

	/**
	 * R-terminal-settles-dirty (B35): release a dep's outstanding in-wave DIRTY contribution.
	 * A settle-class event for that dep (DATA/RESOLVED inline above, INVALIDATE, and now
	 * COMPLETE/ERROR) clears its dirty flag + decrements _pending. No-op if the dep already
	 * settled this wave (DATA/RESOLVED ran first) — so the normal DATA-then-COMPLETE flow is
	 * unaffected. This makes the exactly-one-settle invariant a single, shared step.
	 */
	private _releaseDepDirty(idx: number): void {
		if (this._depDirty[idx]) {
			this._depDirty[idx] = false;
			this._pending--;
		}
	}

	/**
	 * R-terminal-settles-dirty (B35): settle a node whose dirtied dep was released by an ABSORBED
	 * terminal that is NOT a real input (a plain derived/effect — the common default-node case when
	 * one of several deps completes while others stay live). Runs only when the release drained
	 * _pending while the node still owes a downstream settle (it broadcast DIRTY this wave):
	 *   - if some OTHER dep delivered real DATA this wave (a value occurred) → recompute (→ DATA);
	 *   - else the terminal's signalled change did not materialise (no value) → one undirty RESOLVED
	 *     (R-resolved-undirty), keeping the cache (a terminal, unlike INVALIDATE, leaves the value).
	 * A terminalAsRealInput node instead recomputes unconditionally (its fn reads the terminal).
	 */
	private _settleAfterAbsorbedTerminal(): void {
		if (this._pending !== 0 || !this._emittedDirtyThisWave) return;
		// A real value occurred this wave (some OTHER dep delivered DATA) → recompute. _maybeRun
		// runs the fn ONLY if it's not gated (first-run gate open, not paused); it may emit DATA, a
		// fn-synthesized undirty RESOLVED, or nothing (gated / gate still holds).
		const sawData = this._depBatch.some((b) => b !== null && b.length > 0);
		if (sawData) this._maybeRun();
		// If after that the node STILL owes a downstream settle (no DATA occurred, OR the recompute
		// was gated — e.g. the first-run gate holds because the terminated dep never delivered and
		// terminalAsRealInput is false), balance the broadcast DIRTY with one undirty RESOLVED
		// (R-resolved-undirty), keeping the cache (a terminal, unlike INVALIDATE, leaves the value).
		// Without this fallback a DIRTY-then-terminal-without-DATA dep on a pre-first-run multi-dep
		// node would strand the DIRTY → downstream wedged (the B35 class, in the gate-holds corner).
		// Bare emit mirrors the INVALIDATE receive-arm; terminal×pause/batch coalescing = backlog B39.
		if (this._emittedDirtyThisWave) {
			this._emittedDirtyThisWave = false;
			this._status = this._hasData ? "resolved" : "sentinel";
			this._emitToSubs(["RESOLVED"]);
		}
	}

	private _markDirty(): void {
		this._status = "dirty";
		// SPIKE (protocol-pull): while quiet, ABSORB the upstream DIRTY — do NOT relay it downstream.
		// This is the P0b wedge fix: a quiet pull node that relayed DIRTY but withheld the settle
		// (coalesced by pause) wedged every downstream's two-phase _pending. The downstream learns of
		// changes via the push STREAM port, not the silent snapshot port; on demand the pull node
		// emits a fresh wave. Internal dep dirty-accounting (the DIRTY-branch _pending++) is untouched.
		if (this._isPullQuiet()) return;
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
		} else if (this._emittedDirtyThisWave) {
			// R-resolved-undirty (D49): the dep settled via an undirty RESOLVED (no DATA in the
			// batch), but this wire already broadcast DIRTY downstream this wave — balance it with
			// a RESOLVED so downstream un-dirties instead of wedging. Routed through _down (NOT a
			// bare _emitToSubs) so the balance respects batch-defer (D12) + pause-buffer, matching
			// the zero-dep un-dirty path. Without this, a passthrough over a filter-reject /
			// distinctUntilChanged-dup leaves a dangling DIRTY (the wedge D49 made common).
			this._down([["RESOLVED"]]);
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
		// R-cleanup-hooks per-run lifecycle (D28 clarification): clear BOTH hook lists
		// before the fn runs; the fn body re-registers the current run's hooks. Only the
		// latest run's registrations are live — a re-run supersedes the prior run's hooks,
		// discarded WITHOUT firing (no fire-on-rerun; onRerun stays cut). Fixes the push-only
		// accumulation (K stale hooks fired after K runs). C-14.
		this._onInvalidate = [];
		this._onDeactivation = [];
		const ctx = this._buildCtx();
		const wasDirty = this._emittedDirtyThisWave;
		this._emittedSettleThisWave = false;
		this._insideRunWave = true;
		try {
			this._dispatcher.invoke(this._handle as Handle, ctx);
		} finally {
			this._insideRunWave = false;
		}

		// R-resolved-undirty (D49): a SYNC fn DIRTY'd in phase 1 that produced NO tier-3 value
		// this wave (filter-reject / distinctUntilChanged-dup / any no-emit fn) gets a substrate-
		// SYNTHESIZED undirty RESOLVED to clear the downstream dirty — operator bodies stay
		// protocol-clean (R-primary-api-clean). Status reflects cache freshness: a carried value
		// -> resolved, never-valued -> sentinel. EXEMPT: terminal/INVALIDATE waves (they set
		// _emittedSettleThisWave and balance their own dirty), and ASYNC-pool nodes — an async fn
		// that returns without emitting has DEFERRED its result (it emits later via the stashed
		// ctx), NOT rejected; synthesizing here would prematurely settle a still-pending diamond
		// leg (R-async-paused / C-4). The eventual async ctx.down carries its own DIRTY balance.
		if (
			wasDirty &&
			!this._emittedSettleThisWave &&
			this._terminal === undefined &&
			!this._isAsyncPool()
		) {
			this._status = this._hasData ? "resolved" : "sentinel";
			this._emitToSubs(["RESOLVED"]);
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
			// Wave-owner boundary (D47): a SYNC fn's emit nests under the public entry that drove
			// it (cheap inc/dec, no early drain); an ASYNC-pool fn re-enters here from its stashed
			// ctx at depth 0, so this is the boundary that drains any rewireNext it issued.
			up: (msgs, towardDep) => {
				enterWave();
				try {
					this._up(msgs, towardDep);
				} finally {
					exitWave();
				}
			},
			down: (msgs) => {
				enterWave();
				try {
					this._down(msgs);
				} finally {
					exitWave();
				}
			},
			depRecords,
			state: this._makeState(),
			onDeactivation: (fn) => {
				this._onDeactivation.push(fn);
			},
			onInvalidate: (fn) => {
				this._onInvalidate.push(fn);
			},
			// R-rewire-deferred (D47): defer a self-dep-set mutation to the committed boundary.
			rewireNext: {
				addDep: (dep, fn) => this._requestRewireNext({ kind: "add", dep, fn }),
				removeDep: (dep, fn) => this._requestRewireNext({ kind: "remove", dep, fn }),
				setDeps: (deps, fn) => this._requestRewireNext({ kind: "set", deps, fn }),
			},
			// R-up-routing / R-pull (D59): deferred up — route a control wave (e.g. a RESUME pull
			// DEMAND) up the declared cone at the committed boundary. The SELF-demand path: an
			// immediate ctx.up whose delivery loops back re-enters this fn (D37 / R-reentrancy).
			upNext: (msgs, towardDep) => this._requestUpNext(msgs, towardDep),
		};
		if (this._dynamic) {
			// R-dynamic-node: read a dep's latest by index. Untracked deps still drive waves and
			// re-run the fn; under D49 (no equals-substitution) the fn re-emits its current value
			// as DATA — to suppress redundant downstream propagation, pair with distinctUntilChanged.
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
		// Terminal-is-forever (R-terminal / D17 / B30): once COMPLETE/ERROR has been emitted the
		// node is final — a self-emit (state.set / ctx.down) in a LATER wave is a no-op, never
		// resurrecting the cache or re-emitting. The COMPLETE/ERROR arms below also self-guard
		// against a double terminal, but DATA/RESOLVED/INVALIDATE had no entry guard, so a
		// post-terminal set() would overwrite cache + emit DATA. The upstream path
		// (_receiveFromDep) already drops on terminal the same way — including a TEARDOWN that
		// follows the node's own COMPLETE: whether a terminal intermediate should still relay
		// TEARDOWN for downstream unwire is an OPEN spec gap on draft R-teardown-complete (a
		// /spec-amend call, not a guard tweak; today both the TS and Rust arms drop it). This
		// closes the self-emit gap and matches the Rust arm's Core::down blanket guard. A single
		// wave that goes terminal mid-loop (e.g. [COMPLETE, TEARDOWN]) is unaffected: _terminal
		// is still undefined at entry. Resubscribable reset clears _terminal before any re-emit.
		if (this._terminal !== undefined) return;
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
		// EC2 / R-resolved-undirty tier-3 exclusivity: a wave's tier-3 slot is >=1 DATA
		// (occurrence) XOR exactly 1 RESOLVED (undirty) — never mixed. Reject fail-fast.
		if (dataCount >= 1 && hasResolved) {
			throw new Error(
				"down: a wave cannot mix DATA and RESOLVED (tier-3 exclusivity, R-resolved-undirty)",
			);
		}

		// Synthesize a leading DIRTY for an EXTERNAL tier-3 emit (R-dirty-before-data).
		// Inside runWave the DIRTY was already propagated (or the wave is activation-exempt).
		if (hasTier3 && !this._insideRunWave && !this._emittedDirtyThisWave) {
			this._emittedDirtyThisWave = true;
			this._status = "dirty";
			this._emitToSubs(["DIRTY"]);
		}

		for (const m of sorted) {
			// R-resolved-undirty (D49): a tier-3+ emit this wave means the fn produced a settle,
			// so no synthesized undirty RESOLVED is owed (see _runWave).
			if (messageTier(m[0]) >= 3) this._emittedSettleThisWave = true;
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
				// R-resolved-undirty (D49): every value-occurrence is emitted as DATA — the
				// substrate never substitutes DATA->RESOLVED on value-equality. Dedup is opt-in
				// at the operator layer (distinctUntilChanged), never a substrate behavior.
				this._cache = v;
				this._hasData = true;
				this._status = "settled";
				if (this._replayN > 0) {
					this._replayRing.push(v);
					if (this._replayRing.length > this._replayN) this._replayRing.shift();
				}
				this._emitToSubs(["DATA", v]);
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

	private _up(msgs: Wave, towardDep?: number): void {
		for (const m of msgs) {
			if (!isUpAllowed(m[0])) {
				throw new Error(
					`ctx.up: ${m[0]} is down-only (tier ${messageTier(m[0])}); up carries control tiers only (R-ctx-up)`,
				);
			}
		}
		for (const m of msgs) {
			if (m[0] === "PAUSE") {
				// PAUSE is NODE-TARGETED (R-up-routing): it ACQUIRES a lock, so there is no
				// pre-existing holder to route to — a controller targets the node directly.
				this._pauseAcquire(m[1]);
			} else if (m[0] === "RESUME") {
				// R-up-routing (D59): RELEASE-IF-HELD-ELSE-FORWARD-UP.
				if (this._pull && m[1] === this._pullLock) {
					// a cone-routed RESUME of OUR pullId = a DEMAND (R-pull). Fire (or owe).
					this._onDemand();
				} else if (this._pauseLockset.has(m[1])) {
					// a pause lock held HERE → release LOCALLY (normal pause/resume, R-pause-lockset).
					this._pauseRelease(m[1]);
				} else {
					// not held here → forward UP the declared cone to find the holder.
					this._forwardUp(m, towardDep);
				}
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
				// dep-bearing intermediate: forward DIRTY/INVALIDATE/TEARDOWN up toward deps.
				this._forwardUp(m, towardDep);
			}
		}
	}

	/**
	 * Forward one up-going control message toward deps (R-up-routing): up the single declared edge
	 * `towardDep` (directed — prunes other branches; only meaningful on the issuer's FIRST hop) or
	 * broadcast up ALL deps. A depless source has no deps → the message DROPS here (the terminus —
	 * e.g. a cone-routed RESUME whose pullId no node up this cone holds, R-up-at-source). Recursive
	 * forwarding via the public `dep.up([m])` carries no `towardDep` → broadcast beyond the first hop.
	 */
	private _forwardUp(m: Message, towardDep?: number): void {
		if (this._deps.length === 0) return; // depless source terminus → drop
		if (towardDep !== undefined) {
			const d = this._deps[towardDep];
			if (d !== undefined) d.up([m]);
		} else {
			for (const dep of this._deps) dep.up([m]);
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
		// R-pull (D59 / F4-F5): releasing an EXTERNAL pause lock can unblock a demand owed while the
		// node was externally paused — fire it if now able, even though the node still self-holds its
		// pullId (so the lockset is not empty). A pull node's OWN demand never routes here (it goes
		// through _onDemand); this only sees external pause/resume locks.
		if (this._pull && this._demandOwed) this._fireOwedDemandIfReady();
		if (this._pauseLockset.size > 0) return; // another lock still held => stay paused
		this._onResume();
	}

	private _onResume(): void {
		// BH3: a node that terminated while paused discards its buffer and never
		// replays/recomputes (terminal-is-forever).
		if (this._terminal !== undefined) {
			this._pauseBuffer = [];
			this._pausedDepWaveOccurred = false;
			this._demandOwed = false;
			return;
		}
		// Non-pull pause/resume (R-pause-modes): drain buffered settle slices (resumeAll /
		// async-at-paused, R-async-paused), then fire a coalesced dep-wave once (default mode).
		// A PULL node never reaches here (D59): it always self-holds its pullId, so its lockset never
		// EMPTIES via _pauseRelease — a pull DEMAND fires through _onDemand, not _onResume.
		if (this._pauseBuffer.length > 0) {
			const buf = this._pauseBuffer;
			this._pauseBuffer = [];
			for (const wave of buf) this._down(wave);
		}
		if (this._pausedDepWaveOccurred) {
			this._pausedDepWaveOccurred = false;
			this._tryRun();
		}
	}

	/**
	 * R-pull (D59): can this pull node fire a demand NOW? — not terminal, settle-ready (_pending===0),
	 * and no OTHER (non-pullId) lock holds it paused. The gate that decides fire-now vs OWE.
	 */
	private _canFireDemand(): boolean {
		if (this._terminal !== undefined || this._pending > 0) return false;
		const own = this._pauseLockset.has(this._pullLock) ? 1 : 0; // discount our own pullId/quiet lock
		return this._pauseLockset.size <= own; // no external pause lock co-held
	}

	/**
	 * R-pull (D59): deliver ONE demand pulse — release the pullId so the demand wave RELAYS (not
	 * absorbed), fire it, then RE-QUIET (1:1). The pullId re-add + the re-entrancy flag are in a
	 * `finally` so a throwing pull fn (graph-less node, no D30 catch) cannot leave the node
	 * permanently non-quiet (the wedge-fix silently disabled) — QA-found robustness fix.
	 */
	private _deliverPullDemand(): void {
		this._demandOwed = false;
		this._inDeliverDemand = true;
		this._pauseLockset.delete(this._pullLock as LockId);
		try {
			this._firePullDemand();
		} finally {
			this._pauseLockset.add(this._pullLock as LockId); // re-quiet (even on a throwing fn)
			this._inDeliverDemand = false;
		}
	}

	/**
	 * R-pull (D59): a cone-routed RESUME of THIS node's pullId arrived (R-up-routing) = a DEMAND.
	 * Fire immediately if able; else OWE it — pin-5 (a dep DIRTY in flight, _pending>0) or F4/F5 (an
	 * external PAUSE lock co-holds the node) — and fire when the node next becomes able. A demand
	 * arriving WHILE a delivery is in flight (synchronous re-entry) is DROPPED (1:1, QA guard).
	 */
	private _onDemand(): void {
		if (this._inDeliverDemand) return; // re-entrant demand during an active delivery → drop (1:1)
		if (this._canFireDemand()) this._deliverPullDemand();
		else this._demandOwed = true;
	}

	/**
	 * R-pull (D55): service ONE demand. Delivery content = the orthogonal pausable mode:
	 *   - 'resumeAll' → drain the buffered BACKLOG (each `_down` re-synthesizes a leading DIRTY, so
	 *     the per-entry replay is DIRTY-before-DATA — R-pause-modes per-entry arrival order);
	 *   - true → deliver the coalesced LATEST as ONE DIRTY-before-DATA wave (pin 2: the quiet absorb
	 *     suppressed the dep's original DIRTY, so the demand wave restores it before the value).
	 * Neither branch fires when nothing changed since the last demand → the demand is SILENT.
	 * Called by `_deliverPullDemand` only when settle-ready; the caller has released the pullId, so
	 * `_markDirty` relays the leading DIRTY (not absorbed).
	 */
	private _firePullDemand(): void {
		if (this._pauseBuffer.length > 0) {
			const buf = this._pauseBuffer;
			this._pauseBuffer = [];
			for (const wave of buf) this._down(wave);
		}
		if (this._pausedDepWaveOccurred) {
			// QA-B2: only deliver if the fn can actually run this wave (settle-ready + first-run gate
			// open). A gated run emits no DATA, so emitting the leading DIRTY would STRAND downstream
			// — the exact wedge this feature exists to prevent (NoWedgeWhileQuiet). When gated, stay
			// SILENT and KEEP _pausedDepWaveOccurred so a later demand (once every dep has settled)
			// delivers. Mirrors _settleRewire's pre-_markDirty gate.
			const gated =
				this._handle !== null &&
				!this._hasCalledFnOnce &&
				!(this._partial || this._allDepsSettled());
			if (this._pending > 0 || gated) return;
			this._pausedDepWaveOccurred = false;
			this._markDirty(); // pin 2: leading DIRTY (lock released → relays)
			this._tryRun(); // fn → DATA, balancing the DIRTY
		}
	}

	/**
	 * R-pull (D55/D59): fire a demand that was OWED (deferred at demand time) once the node becomes
	 * able — called from the dep-settle arms (DATA/RESOLVED/INVALIDATE/terminal drain _pending, pin-5
	 * + B1/F6) and from `_pauseRelease` (an external PAUSE lock releases, F4/F5).
	 */
	private _fireOwedDemandIfReady(): void {
		if (this._inDeliverDemand) return; // don't re-enter during an active delivery (1:1, QA guard)
		if (this._pull && this._demandOwed && this._canFireDemand()) this._deliverPullDemand();
	}

	/** Should an outgoing settle slice be deferred into the pause buffer? */
	private _shouldBufferOnPause(): boolean {
		// D44: pausable mode is the OUTER gate over R-async-paused buffering.
		// false: ignore PAUSE/RESUME ENTIRELY — never buffer, keep producing (R-pause-modes; resolves B20).
		if (this._pausable === false) return false;
		if (!this._isPaused()) return false;
		// resumeAll: production-gating — buffer the node's own (sync/async) settle slice too.
		if (this._pausable === "resumeAll") return true;
		// true (default): PAUSE gates recomputation/propagation, NOT a leaf source's own production.
		// An async COMPUTE node's (deps>0) in-flight result buffers (R-async-paused / C-2); a depless
		// async leaf source's own production delivers immediately (R-pause-modes / C-10).
		if (!this._insideRunWave && this._isAsyncPool() && this._deps.length > 0) return true;
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

	// B42 (R-deps-terminal): ALL deps TERMINAL = every dep has reached COMPLETE *or* an ABSORBED
	// ERROR. Block only on a LIVE dep (_depTerminal[i] === undefined); an errored dep (terminal = the
	// error payload, which R-data-payload guarantees is !== undefined) COUNTS as terminal-done. Was
	// `tm !== true`, which wedged a node whose errorWhenDepsError:false dep ERRORed (it never
	// auto-completed even after every other dep completed). Drives the completeWhenDepsComplete cascade.
	private _allDepsTerminal(): boolean {
		if (this._deps.length === 0) return false;
		for (const tm of this._depTerminal) if (tm === undefined) return false;
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
		this._demandOwed = false; // R-pull (D55): drop any deferred demand
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
 * deps participate in wave tracking; an unread dep's change re-runs the fn, which re-emits
 * its current value as DATA (D49 removed equals-absorption — dedup is opt-in via
 * distinctUntilChanged). Intra-graph only (D22).
 */
export function dynamicNode<T = unknown>(
	deps: Node<unknown>[],
	fn: NodeFn,
	opts: NodeOptions<T> = {},
): Node<T> {
	return new Node<T>(deps, fn, { ...opts, dynamic: true });
}
