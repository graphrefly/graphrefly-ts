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

import { currentBatch, deferAfterBatchForTarget, deferToBatch } from "../batch/batch.js";
import { deferRewire, enterWave, exitWave } from "../batch/boundary.js";
import {
	CTX_DEP_CACHE,
	type Ctx,
	type CtxState,
	type DeliveryMeta,
	type NodeFn,
	type Sink,
} from "../ctx/types.js";
import { type Dispatcher, defaultDispatcher, type Handle } from "../dispatcher/index.js";
import {
	errorPayload,
	isInvalidErrorPayload,
	isTerminal,
	isUpAllowed,
	type LockId,
	type Message,
	messageTier,
	SENTINEL,
	type Wave,
} from "../protocol/messages.js";
import {
	type CleanupHooks,
	type ControlState,
	type DepBookkeeping,
	type LifecycleState,
	makeDepBookkeeping,
	NodeCore,
	type NodeId,
	type NodeSlot,
	type PrivateState,
	type SyncCtxState,
	type ValueState,
	type WaveState,
} from "./core.js";

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

let constructingCore: NodeCore | undefined;
const ownerTokens = new WeakMap<Node<unknown>, unknown>();

/** @internal Run a Node/StateNode constructor against a graph-local core without widening the public constructor. */
export function withNodeCore<TNode extends Node<unknown>>(
	core: NodeCore,
	create: () => TNode,
): TNode {
	const prev = constructingCore;
	constructingCore = core;
	try {
		return create();
	} finally {
		constructingCore = prev;
	}
}

/** @internal Graph-domain ownership token for D22 intra-graph guards. */
export function getNodeOwner(n: Node<unknown>): unknown {
	return ownerTokens.get(n);
}

/** @internal Assign graph-domain ownership after graph registration. */
export function setNodeOwner(n: Node<unknown>, owner: unknown): void {
	ownerTokens.set(n, owner);
}

function terminalView(t: unknown): unknown {
	return t === undefined ? false : t;
}

function validateDownPayloads(msgs: Wave): void {
	for (const m of msgs) {
		if (m[0] === "DATA" && m[1] === undefined) {
			throw new Error("down: DATA requires a non-SENTINEL payload (R-data-payload)");
		}
		if (m[0] === "ERROR" && isInvalidErrorPayload(m[1])) {
			throw new Error("down: ERROR requires a non-SENTINEL, non-boolean payload (R-data-payload)");
		}
	}
}

/** A queued deferred self-rewire op (R-rewire-deferred / D47), drained at the wave boundary. */
type RewireOp =
	| { kind: "add"; dep: Node<unknown>; fn: NodeFn }
	| { kind: "remove"; dep: Node<unknown>; fn: NodeFn }
	| { kind: "set"; deps: Node<unknown>[]; fn: NodeFn };

/** Internal routing state for one up-going control wave. */
type UpRouteState = {
	demandFired: Map<LockId, Set<Node<unknown>>>;
};

export class Node<T = unknown> {
	private readonly _core: NodeCore;
	private readonly _id: NodeId;
	private readonly _slot: NodeSlot<T>;
	private readonly _dep: DepBookkeeping;
	private readonly _value: ValueState<T>;
	private readonly _wave: WaveState;
	private readonly _control: ControlState;
	private readonly _lifecycle: LifecycleState;
	private readonly _privateState: PrivateState;
	private readonly _hooks: CleanupHooks;
	private readonly _syncCtxState: SyncCtxState;

	private get _syncCtx(): Ctx | null {
		return this._syncCtxState.value;
	}

	private set _syncCtx(ctx: Ctx | null) {
		this._syncCtxState.value = ctx;
	}

	constructor(
		deps: Node<unknown>[],
		handleOrFn: Handle | NodeFn | null,
		opts: NodeOptions<T> = {},
	) {
		const core = constructingCore;
		constructingCore = undefined;
		const dispatcher = opts.dispatcher ?? defaultDispatcher;
		const pool = opts.pool ?? "sync";
		const pausable = opts.pausable ?? true;
		const pullLock = opts.pullId;
		const pull = opts.pullId !== undefined;
		// R-pull (D55/D59): pull-mode is keyed by an author-supplied pullId (its demand lock).
		// R-pull (D55, pin 3): pull needs RESUME as the demand signal — pausable:false (which
		// ignores PAUSE/RESUME entirely, R-pause-modes) is a contradiction. Reject at construction.
		if (pull && pausable === false)
			throw new Error(
				"node: pullId is incompatible with pausable:false — a pull node is demanded via RESUME, which pausable:false ignores (R-pull / R-pause-modes / D55,D59)",
			);

		let handle: Handle | null;
		if (handleOrFn === null) handle = null;
		else if (typeof handleOrFn === "function") handle = dispatcher.register(handleOrFn, pool);
		else handle = handleOrFn;

		const n = deps.length;
		const dep = makeDepBookkeeping(n);
		const value = {
			cache: SENTINEL as T | undefined,
			hasData: false,
			status: "sentinel" as Status,
			terminal: undefined,
			hasTorndown: false,
			replayRing: [] as T[],
		};
		if (opts.initial !== undefined) {
			value.cache = opts.initial as T;
			value.hasData = true;
			value.status = "settled";
		}
		const pauseLockset = new Set<unknown>();
		if (pull) pauseLockset.add(pullLock as LockId);
		this._core = core ?? new NodeCore();
		const created = this._core.createSlot<T>(
			{
				deps,
				handle,
				pool,
				dispatcher,
				partial: opts.partial ?? false,
				terminalAsRealInput: opts.terminalAsRealInput ?? false,
				completeWhenDepsComplete: opts.completeWhenDepsComplete ?? true,
				errorWhenDepsError: opts.errorWhenDepsError ?? true,
				resubscribable: opts.resubscribable ?? false,
				resetOnTeardown: opts.resetOnTeardown ?? false,
				pausable,
				pull,
				pullLock,
				replayN: opts.replayBuffer ?? 0,
				dynamic: opts.dynamic ?? false,
				name: opts.name,
				factory: opts.factory,
			},
			{
				dep,
				lifecycle: { subscribers: new Set<Sink>(), activated: false },
				value,
				wave: {
					pending: 0,
					hasCalledFnOnce: false,
					emittedDirtyThisWave: false,
					emittedSettleThisWave: false,
					insideRunWave: false,
					inDepMutation: false,
					rewireRunPending: false,
					batchDirtyOwed: false,
				},
				control: {
					pauseLockset,
					pausedDepWaveOccurred: false,
					pauseBuffer: [],
					demandOwed: false,
					inDeliverDemand: false,
				},
				privateState: { value: SENTINEL, persist: false },
				hooks: { onDeactivation: [], onInvalidate: [] },
				syncCtx: { value: null },
			},
		);
		this._id = created.id;
		this._slot = this._core.get<T>(this._id);
		this._dep = this._core.getDep(this._id);
		this._value = this._core.getValue<T>(this._id);
		this._wave = this._core.getWave(this._id);
		this._control = this._core.getControl(this._id);
		this._lifecycle = this._core.getLifecycle(this._id);
		this._privateState = this._core.getPrivateState(this._id);
		this._hooks = this._core.getHooks(this._id);
		this._syncCtxState = this._core.getSyncCtx(this._id);
	}

	/** R-pull (D55): true while a pull node is quiet (holds its own pullId/demand lock). */
	private _isPullQuiet(): boolean {
		return this._slot.pull && this._control.pauseLockset.has(this._slot.pullLock);
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
		return this._slot.pullLock;
	}

	get cache(): T | undefined {
		return this._value.cache;
	}

	get status(): Status {
		return this._value.status;
	}

	get name(): string | undefined {
		return this._slot.name;
	}

	/** R-describe/D51: real factory name for a standalone graph-less node (a runtime *Map inner). */
	get factory(): string | undefined {
		return this._slot.factory;
	}

	/**
	 * The node's CURRENT/LIVE deps (R-describe / R-edges-derived / D51) — readonly view of the
	 * live `_deps`, which a rewire (C-8 / C-11) mutates. The graph's describe() reads this (NOT a
	 * construction-time snapshot) so every edge corresponds to a real current subscription (D3).
	 * Inspection-only, like cache/status; never triggers computation.
	 */
	get deps(): readonly Node<unknown>[] {
		return this._slot.deps;
	}

	/**
	 * The fn handle (pure data `(poolId, handleId)`, D7) or null for state/passthrough
	 * nodes. Inspection-only (L1.6 handle is referenceable/inspectable) — lets the graph
	 * layer key a dispatcher-backed profile recorder WITHOUT putting counters on the node
	 * (R-node-thin / D39).
	 */
	get handle(): Handle | null {
		return this._slot.handle;
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
			if (this._value.terminal !== undefined) {
				if (this._slot.resubscribable) this._resetLifecycle();
				else
					throw new Error(
						"subscribe: node is non-resubscribable and has terminated; the stream is permanently over (R-terminal / R2.2.7.b)",
					);
			}

			this._lifecycle.subscribers.add(sink);
			sink(["START"]);
			if (this._slot.replayN > 0 && this._value.replayRing.length > 0) {
				// R-replay-buffer: late subscriber gets the last N DATA after START.
				for (const v of this._value.replayRing) sink(["DATA", v]);
			} else if (this._value.hasData && !this._slot.pull) {
				// R-pull (D55): a pull node NEVER push-on-subscribes its cached value — quiet by
				// default, it stays silent until demanded (START only). QA-B4: gated on `_pull` (not
				// the transient quiet-lock _isPullQuiet) so a REACTIVATED pull node — whose lockset is
				// briefly empty before _activate re-holds the demand lock — still does not leak its
				// cache (matters for a depless pull state node, whose cache survives _deactivate).
				sink(["DATA", this._value.cache]);
			} else if (this._value.status === "dirty" && !this._slot.pull) {
				sink(["DIRTY"]);
			}

			if (!this._lifecycle.activated) this._activate();

			return () => {
				if (!this._lifecycle.subscribers.delete(sink)) return;
				if (this._lifecycle.subscribers.size === 0) this._deactivate();
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
		deferRewire(this._core, () => this._applyRewireNext(op));
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
		deferRewire(this._core, () => this._up(msgs, towardDep));
	}

	/** Apply one queued self-rewire at the boundary (drain thunk). */
	private _applyRewireNext(op: RewireOp): void {
		try {
			// D62 / R-rewire-deferred: terminal seals output but does NOT cancel queued topology.
			// Public/immediate rewire of a terminal node still rejects; the exception is only for
			// self-triggered ops already issued before terminal and now draining at the boundary.
			if (op.kind === "add") {
				const next = this._slot.deps.includes(op.dep)
					? [...this._slot.deps]
					: [...this._slot.deps, op.dep];
				this._rewire(next, op.fn, { allowTerminalOwner: true });
			} else if (op.kind === "remove") {
				this._rewire(
					this._slot.deps.filter((d) => d !== op.dep),
					op.fn,
					{ allowTerminalOwner: true },
				);
			} else {
				this._rewire(this._dedupDeps(op.deps), op.fn, { allowTerminalOwner: true });
			}
		} catch (e) {
			// An invalid deferred op (cycle / self / non-resubscribable terminal dep) surfaces as
			// an ERROR on this node (D30-consistent) rather than stranding the rest of the drain
			// queue. Reachable only on misuse — higher-order operator inners are fresh, acyclic
			// leaf sources. Coerce a SENTINEL reason (a rewire fn that `throw undefined`s) to a real
			// Error so _down's R-data-payload guard does not itself throw out of the drain.
			this._down([["ERROR", errorPayload(e, "rewireNext op failed")]]);
		}
	}

	// ── rewire (R-rewire / D42): intra-graph runtime topology mutation ──

	/**
	 * Replace this node's deps atomically (surgical, Option-C). Requires an explicit
	 * `fn` (SD-1 fn-deps pairing — user fns read dep input positionally). Kept deps
	 * keep their subscription + per-dep state; only removed deps unsubscribe and only
	 * added deps fresh-subscribe (push-on-subscribe for an added cached dep). The
	 * first-run gate and cache are PRESERVED (R-rewire Q2/Q7). Intra-graph only (D22).
	 */
	setDeps(newDeps: Node<unknown>[], fn: NodeFn): void {
		this._rewire(this._dedupDeps(newDeps), fn);
	}

	/** Add one dep (special case of setDeps); returns its index. fn required (SD-1). */
	addDep(depNode: Node<unknown>, fn: NodeFn): number {
		const next = this._slot.deps.includes(depNode)
			? [...this._slot.deps]
			: [...this._slot.deps, depNode];
		const deferred = this._rewire(next, fn);
		return deferred ? next.indexOf(depNode) : this._slot.deps.indexOf(depNode);
	}

	/** Remove one dep (special case of setDeps); idempotent if absent (fn swap still applies). */
	removeDep(depNode: Node<unknown>, fn: NodeFn): void {
		this._rewire(
			this._slot.deps.filter((d) => d !== depNode),
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
			for (const d of n._slot.deps) stack.push(d);
		}
		return false;
	}

	private _assertRewireDepOwner(dep: Node<unknown>): void {
		const selfOwner = getNodeOwner(this as unknown as Node<unknown>);
		const depOwner = getNodeOwner(dep);
		if (selfOwner !== undefined && depOwner !== undefined && selfOwner !== depOwner) {
			throw new Error(
				"rewire: dep belongs to a different graph; cross-graph deps require a wire bridge (D22 / R-graph-domain)",
			);
		}
	}

	private _rewire(
		newDeps: Node<unknown>[],
		fn: NodeFn,
		opts: { allowTerminalOwner?: boolean } = {},
	): boolean {
		// ── rejects (R-rewire / D42) ──
		if (this._value.terminal !== undefined && !opts.allowTerminalOwner)
			throw new Error(
				"rewire: node is terminal (completed/errored) — cannot rewire (R-rewire / D42)",
			);
		if (this._wave.insideRunWave)
			throw new Error(
				"rewire: mid-fn topology mutation — a fn mutating its own deps mid-wave is the feedback cycle (R-rewire / D37)",
			);
		if (this._wave.inDepMutation)
			throw new Error(
				"rewire: reentrant dep mutation — another setDeps/addDep/removeDep is in flight (R-rewire)",
			);
		if (newDeps.includes(this as unknown as Node<unknown>))
			throw new Error("rewire: self-dependency rejected (R-rewire / D42)");
		const oldDeps = this._slot.deps;
		const added = newDeps.filter((d) => !oldDeps.includes(d));
		for (const d of added) {
			if (this._reachableUpstream(d, this as unknown as Node<unknown>))
				throw new Error(
					"rewire: would create a cycle — dep already transitively depends on this node (R-rewire / D42)",
				);
			if (d._value.terminal !== undefined && !d._slot.resubscribable)
				throw new Error(
					"rewire: cannot add a non-resubscribable terminal dep — would wedge (R-rewire / D42)",
				);
			this._assertRewireDepOwner(d);
		}

		if (
			deferAfterBatchForTarget(this, () => {
				this._rewire(newDeps, fn, { ...opts, allowTerminalOwner: true });
			})
		) {
			return true;
		}

		this._wave.inDepMutation = true;
		this._wave.rewireRunPending = false;
		let zeroDepUnDirty = false;
		try {
			// fn swap (SD-1): re-register against the same pool, then release the old handle
			// (B15) so the rewired-away fn closure is GC'd and its dispatcher slot is reused —
			// a rewire-heavy graph (CSP-2.7 *Map) no longer leaks a handle per swap. Register
			// first, then unregister the old: this._slot.handle never points at a freed slot, and a
			// null old handle (a passthrough/state node gaining a fn) has nothing to free.
			const oldHandle = this._slot.handle;
			this._slot.handle = this._slot.dispatcher.register(fn, this._slot.pool);
			if (oldHandle !== null) this._slot.dispatcher.unregister(oldHandle);

			const removed = oldDeps.filter((d) => !newDeps.includes(d));
			let removedDirtyContributor = false;
			for (const d of removed) {
				const oldIdx = oldDeps.indexOf(d);
				if (this._dep.dirty[oldIdx]) {
					removedDirtyContributor = true;
					this._wave.pending--;
				}
				if (this._lifecycle.activated) {
					const box = this._dep.idxBoxes[oldIdx];
					if (box) box.v = -1; // drain: any stale in-flight callback drops
					const unsub = this._dep.unsubs[oldIdx];
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
			const newTerminalInput: Array<true | unknown | undefined> = new Array(n).fill(undefined);
			const newUnsubs: Array<() => void> = new Array(n);
			const newBoxes: Array<{ v: number }> = new Array(n);
			for (let j = 0; j < n; j++) {
				const oldIdx = oldDeps.indexOf(newDeps[j]);
				if (oldIdx !== -1) {
					newBatch[j] = this._dep.batch[oldIdx];
					newPrev[j] = this._dep.prev[oldIdx];
					newHasData[j] = this._dep.hasData[oldIdx];
					newDirty[j] = this._dep.dirty[oldIdx];
					newTier[j] = this._dep.tier[oldIdx];
					newTerminal[j] = this._dep.terminal[oldIdx];
					newUnsubs[j] = this._dep.unsubs[oldIdx];
					// carry the kept dep's subscription box and point it at the new index (O(1) reroute)
					const box = this._dep.idxBoxes[oldIdx];
					if (box) box.v = j;
					newBoxes[j] = box;
				}
			}
			this._slot.deps = newDeps;
			this._dep.batch = newBatch;
			this._dep.prev = newPrev;
			this._dep.hasData = newHasData;
			this._dep.dirty = newDirty;
			this._dep.tier = newTier;
			this._dep.terminal = newTerminal;
			this._dep.terminalInput = newTerminalInput;
			this._dep.unsubs = newUnsubs;
			this._dep.idxBoxes = newBoxes;
			this._dep.waveData = newDeps.map(() => []);
			this._dep.waveTokens = new Array(newDeps.length).fill(undefined);
			this._syncCtx = null;

			// Subscribe added deps — push-on-subscribe (R-push-subscribe) delivers a cached
			// dep's DATA here, which drives _maybeRun; a SENTINEL dep delivers START only.
			if (this._lifecycle.activated) {
				for (const d of added) this._subscribeDepAt(d);
			}

			// Q6 auto-settle: removing the sole dirty contributor closes the wave. With deps
			// remaining, request the atomic settle (recompute → DATA for a value; a no-emit fn
			// gets a substrate-synthesized undirty RESOLVED per R-resolved-undirty/D49 — NOT
			// equals-absorption, which is gone). With zero deps the node is inert (degenerate
			// fn-no-deps) — just un-dirty downstream. Cache is preserved either way (Q7).
			if (removedDirtyContributor && this._wave.pending === 0 && this._value.status === "dirty") {
				if (newDeps.length > 0) this._wave.rewireRunPending = true;
				else zeroDepUnDirty = true;
			}
		} finally {
			this._wave.inDepMutation = false;
		}

		// Atomic post-mutation settle (outside the reentrancy guard so a fresh wave runs
		// normally): ONE two-phase DIRTY→DATA recompute if any added dep delivered data or a
		// sole-dirty dep was removed; else the zero-dep un-dirty via _down (pause/batch-safe).
		if (this._wave.rewireRunPending) {
			this._wave.rewireRunPending = false;
			this._settleRewire();
		} else if (zeroDepUnDirty) {
			if (this._wave.emittedDirtyThisWave) this._down([["RESOLVED"]]);
			else this._value.status = this._value.hasData ? "settled" : "sentinel";
		}
		return false;
	}

	// ── activation / deactivation (lazy; R-rom-ram) ──

	private _activate(): void {
		this._lifecycle.activated = true;
		// R-pull (D55): (re)enter QUIET before wiring deps — _deactivate cleared the lockset, so a
		// reactivation must re-hold the pullId/demand lock; doing it here (pre-subscribe) means each
		// dep's push-on-subscribe DIRTY/DATA is absorbed quietly (the wedge fix), not relayed downstream.
		if (this._slot.pull) this._control.pauseLockset.add(this._slot.pullLock as LockId);
		this._dep.unsubs = new Array(this._slot.deps.length);
		this._dep.idxBoxes = new Array(this._slot.deps.length);
		for (const dep of this._slot.deps) this._subscribeDepAt(dep);
		// Depless producer (fn, no deps): run once on activation.
		if (this._slot.deps.length === 0 && this._slot.handle !== null && !this._wave.hasCalledFnOnce) {
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
		const idx0 = this._slot.deps.indexOf(depNode);
		const box = { v: idx0 };
		const unsub = depNode.subscribe((msg, delivery) => {
			if (box.v === -1) return; // dep removed — stale callback, drop (drain)
			this._receiveFromDep(box.v, msg, delivery);
		});
		if (idx0 !== -1) {
			this._dep.unsubs[idx0] = unsub;
			this._dep.idxBoxes[idx0] = box;
		}
	}

	private _deactivate(): void {
		this._lifecycle.activated = false;
		for (const u of this._dep.unsubs) if (u) u();
		this._dep.unsubs = [];
		this._dep.idxBoxes = [];
		for (const fn of this._hooks.onDeactivation) fn();
		this._hooks.onDeactivation = [];
		this._hooks.onInvalidate = [];

		const isCompute = this._slot.handle !== null || this._slot.deps.length > 0;
		if (isCompute) {
			// RAM: compute nodes clear cache; reconnect re-runs fn fresh.
			this._value.cache = SENTINEL;
			this._value.hasData = false;
			this._value.status = "sentinel";
		}
		this._resetDepState();
		this._wave.hasCalledFnOnce = false;
		this._control.pauseLockset.clear();
		this._control.pauseBuffer = [];
		this._control.pausedDepWaveOccurred = false;
		this._control.demandOwed = false; // R-pull (D55): drop any deferred demand
		this._value.replayRing = []; // BH6: don't replay stale values to a post-reactivation subscriber
		if (!this._privateState.persist) this._privateState.value = SENTINEL;
	}

	private _resetDepState(): void {
		const n = this._slot.deps.length;
		for (let i = 0; i < n; i++) {
			this._dep.batch[i] = null;
			this._dep.waveData[i] = [];
			this._dep.waveTokens[i] = undefined;
			this._dep.prev[i] = SENTINEL;
			this._dep.hasData[i] = false;
			this._dep.dirty[i] = false;
			this._dep.tier[i] = 0;
			this._dep.terminal[i] = undefined;
			this._dep.terminalInput[i] = undefined;
		}
		this._wave.pending = 0;
		this._wave.emittedDirtyThisWave = false;
	}

	// ── upstream wave receive (two-phase + diamond) ──

	private _recordDepProjection(idx: number, delivery: DeliveryMeta | undefined): unknown[] {
		const token = delivery?.wave ?? {};
		if (this._dep.waveTokens[idx] !== token) {
			this._dep.waveData[idx].push([]);
			this._dep.waveTokens[idx] = token;
		}
		return this._dep.waveData[idx][this._dep.waveData[idx].length - 1];
	}

	private _depProjectionHasData(idx: number): boolean {
		const projection = this._dep.waveData[idx][this._dep.waveData[idx].length - 1];
		return projection?.some((v) => v !== SENTINEL) ?? false;
	}

	private _receiveFromDep(idx: number, msg: Message, delivery?: DeliveryMeta): void {
		const t = msg[0];
		if (t === "START") return;
		const isLastInDeliveredWave = delivery?.last ?? true;
		// Terminal-is-forever, except terminal intermediates still relay upstream TEARDOWN
		// downstream for lifecycle unwire (R-teardown-terminal-relay / D65).
		if (this._value.terminal !== undefined) {
			if (t === "TEARDOWN") this._down([["TEARDOWN"]]);
			return;
		}

		if (t === "INVALIDATE") {
			const projection = this._recordDepProjection(idx, delivery);
			projection.push(SENTINEL);
			if (projection.some((v) => v !== SENTINEL) && isLastInDeliveredWave) this._maybeRun();
			// The dep's value is gone — drop our cached latest view to SENTINEL so the
			// never-emitted detector reads correctly, C-3) and cascade (idempotent).
			this._dep.prev[idx] = SENTINEL;
			this._dep.hasData[idx] = false;
			this._dep.batch[idx] = null;
			// EC3: un-wedge the dirty bookkeeping if this dep had gone DIRTY first, so an
			// INVALIDATE-before-DATA doesn't strand _pending / downstream forever
			// (R-invalidate-idempotent — exists to prevent the wedged-DIRTY deadlock).
			if (this._dep.dirty[idx]) {
				this._dep.dirty[idx] = false;
				this._wave.pending--;
			}
			// D50 / R-paused-invalidate: this INVALIDATE SUPERSEDES the dep's buffered
			// paused dep-wave (_depBatch[idx] just cleared). Re-derive the paused-recompute
			// flag — if no dep still carries a buffered DATA, CANCEL the paused recompute
			// (attributed cancellation; the node has settled to SENTINEL via its own
			// INVALIDATE, so a RESUME must not recompute against a now-SENTINEL dep). A
			// surviving dep keeps it set; a later DATA re-arms it ([DATA,INVALIDATE,DATA2]).
			if (this._control.pausedDepWaveOccurred && this._dep.batch.every((b) => b === null)) {
				this._control.pausedDepWaveOccurred = false;
			}
			const hadData = this._value.hasData;
			this._invalidate(); // cascades INVALIDATE iff populated; no-op otherwise
			// If we broadcast DIRTY this wave but _invalidate produced no settle (the node
			// was never populated, so the cascade is suppressed per the rule), un-dirty
			// downstream with a RESOLVED once all deps have settled.
			if (this._wave.pending === 0 && this._wave.emittedDirtyThisWave) {
				if (!hadData) this._down([["RESOLVED"]]);
				else this._wave.emittedDirtyThisWave = false;
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
			this._dep.terminal[idx] = isError ? errPayload : true;
			this._dep.terminalInput[idx] = isError ? errPayload : true;
			// R-terminal-settles-dirty (B35): a terminal RELEASES this dep's outstanding in-wave DIRTY
			// contribution (the exactly-one-settle invariant) — exactly as DATA/RESOLVED/INVALIDATE do
			// (a dirty-then-terminal-without-DATA dep would otherwise strand _pending and wedge the node,
			// the deadlock R-invalidate-idempotent prevents for INVALIDATE).
			this._releaseDepDirty(idx);
			const ranValueBeforeTerminal = this._depProjectionHasData(idx) && isLastInDeliveredWave;
			if (ranValueBeforeTerminal) this._maybeRun();
			if (isError && this._slot.errorWhenDepsError) {
				this._down([["ERROR", errPayload]]); // auto-cascade ERROR → node itself terminal
			} else if (this._slot.terminalAsRealInput) {
				if (ranValueBeforeTerminal) {
					this._fireOwedDemandIfReady();
					return;
				}
				this._maybeRun(); // rescue/reduce/catch/*Map: the fn reads depTerminal(ctx, idx)
			} else if (this._slot.completeWhenDepsComplete && this._allDepsTerminal()) {
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
			if (!this._dep.dirty[idx]) {
				this._dep.dirty[idx] = true;
				this._wave.pending++;
				this._dep.tier[idx] = 2;
				this._markDirty();
			}
			return;
		}

		if (t === "DATA") {
			const v = msg[1];
			this._recordDepProjection(idx, delivery).push(v);
			const b = this._dep.batch[idx];
			if (b === null) this._dep.batch[idx] = [v];
			else b.push(v);
			this._dep.prev[idx] = v;
			this._dep.hasData[idx] = true;
			this._dep.tier[idx] = 3;
			if (this._dep.dirty[idx]) {
				this._dep.dirty[idx] = false;
				this._wave.pending--;
			}
			if (isLastInDeliveredWave) this._maybeRun();
			this._fireOwedDemandIfReady(); // R-pull pin 5: settle-ready now → fire a deferred demand
			return;
		}

		if (t === "RESOLVED") {
			this._recordDepProjection(idx, delivery);
			this._dep.tier[idx] = 3;
			if (this._dep.dirty[idx]) {
				this._dep.dirty[idx] = false;
				this._wave.pending--;
			}
			if (isLastInDeliveredWave) this._maybeRun();
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
		if (this._dep.dirty[idx]) {
			this._dep.dirty[idx] = false;
			this._wave.pending--;
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
		if (this._wave.pending !== 0 || !this._wave.emittedDirtyThisWave) return;
		// A real value occurred this wave (some OTHER dep delivered DATA) → recompute. _maybeRun
		// runs the fn ONLY if it's not gated (first-run gate open, not paused); it may emit DATA, a
		// fn-synthesized undirty RESOLVED, or nothing (gated / gate still holds).
		const sawData = this._dep.batch.some((b) => b !== null && b.length > 0);
		if (sawData) this._maybeRun();
		// If after that the node STILL owes a downstream settle (no DATA occurred, OR the recompute
		// was gated — e.g. the first-run gate holds because the terminated dep never delivered and
		// terminalAsRealInput is false), balance the broadcast DIRTY with one undirty RESOLVED
		// (R-resolved-undirty), keeping the cache (a terminal, unlike INVALIDATE, leaves the value).
		// Without this fallback a DIRTY-then-terminal-without-DATA dep on a pre-first-run multi-dep
		// node would strand the DIRTY → downstream wedged (the B35 class, in the gate-holds corner).
		if (this._wave.emittedDirtyThisWave) this._down([["RESOLVED"]]);
	}

	private _markDirty(): void {
		this._value.status = "dirty";
		// SPIKE (protocol-pull): while quiet, ABSORB the upstream DIRTY — do NOT relay it downstream.
		// This is the P0b wedge fix: a quiet pull node that relayed DIRTY but withheld the settle
		// (coalesced by pause) wedged every downstream's two-phase _pending. The downstream learns of
		// changes via the push STREAM port, not the silent snapshot port; on demand the pull node
		// emits a fresh wave. Internal dep dirty-accounting (the DIRTY-branch _pending++) is untouched.
		if (this._isPullQuiet()) return;
		if (!this._wave.emittedDirtyThisWave) {
			this._wave.emittedDirtyThisWave = true;
			this._emitToSubs(["DIRTY"]);
		}
	}

	private _maybeRun(): void {
		// R-rewire: an added cached dep's push-on-subscribe lands here mid-mutation. Defer
		// the fn-run to ONE atomic two-phase settle after every added dep is wired, so the
		// fn never fires on a partially-populated added-dep view (multi-add) — _settleRewire
		// drains this flag.
		if (this._wave.inDepMutation) {
			this._wave.rewireRunPending = true;
			return;
		}
		// R-pause-modes (default): while paused, skip dep-driven fn re-execution and
		// coalesce — fire once with the latest dep values on final-lock RESUME.
		if (this._slot.pausable === true && this._isPaused()) {
			this._control.pausedDepWaveOccurred = true;
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
		if (this._slot.pausable === true && this._isPaused()) {
			this._control.pausedDepWaveOccurred = true;
			return;
		}
		if (this._wave.pending > 0) return;
		if (this._slot.handle === null) {
			this._passthroughEmit();
			return;
		}
		if (!this._wave.hasCalledFnOnce && !(this._slot.partial || this._allDepsSettled())) return;
		this._markDirty(); // phase 1 (no-op if already dirty, e.g. removeDep auto-settle)
		this._runWave(); // phase 2: fn → DATA/RESOLVED
	}

	private _tryRun(): void {
		if (this._wave.pending > 0) return;
		if (this._slot.handle === null) {
			// Passthrough wire (deps, no fn): forward the latest dep DATA downstream.
			this._passthroughEmit();
			return;
		}
		if (!this._wave.hasCalledFnOnce) {
			if (this._slot.partial || this._allDepsSettled()) this._runWave();
			// else: first-run gate holds fn until every dep has settled (R-first-run-gate).
			return;
		}
		this._runWave();
	}

	private _allDepsSettled(): boolean {
		for (let i = 0; i < this._slot.deps.length; i++) {
			if (this._dep.hasData[i]) continue;
			if (this._slot.terminalAsRealInput && this._dep.terminal[i] !== undefined) continue;
			return false;
		}
		return true;
	}

	private _passthroughEmit(): void {
		// Single-dep wire: relay dep 0's latest batch value as DATA.
		const b = this._dep.batch[0];
		if (b !== null && b.length > 0) {
			this._down([["DATA", b[b.length - 1]]]);
		} else if (this._wave.emittedDirtyThisWave) {
			// R-resolved-undirty (D49): the dep settled via an undirty RESOLVED (no DATA in the
			// batch), but this wire already broadcast DIRTY downstream this wave — balance it with
			// a RESOLVED so downstream un-dirties instead of wedging. Routed through _down (NOT a
			// bare _emitToSubs) so the balance respects batch-defer (D12) + pause-buffer, matching
			// the zero-dep un-dirty path. Without this, a passthrough over a filter-reject /
			// distinctUntilChanged-dup leaves a dangling DIRTY (the wedge D49 made common).
			this._down([["RESOLVED"]]);
		}
		this._dep.batch[0] = null;
		this._wave.emittedDirtyThisWave = false;
	}

	private _runWave(): void {
		// R-reentrancy (D37): a fn that re-drives its own dep mid-wave re-enters here while
		// _insideRunWave is still set — a synchronous feedback cycle. Reject (throw); the graph
		// layer catches it and converts to [[ERROR, e]] (D30). The try/finally resets the flag
		// on every frame as the throw unwinds, leaving the graph clean for the catch. Detection
		// is node-local and free — it reuses the existing _insideRunWave flag (no new structure,
		// dispatcher stays a pure funnel).
		if (this._wave.insideRunWave)
			throw new Error(
				"synchronous feedback cycle: node fn re-entered its own wave (R-reentrancy / D37)",
			);
		this._wave.hasCalledFnOnce = true;
		// R-cleanup-hooks per-run lifecycle (D28 clarification): clear BOTH hook lists
		// before the fn runs; the fn body re-registers the current run's hooks. Only the
		// latest run's registrations are live — a re-run supersedes the prior run's hooks,
		// discarded WITHOUT firing (no fire-on-rerun; onRerun stays cut). Fixes the push-only
		// accumulation (K stale hooks fired after K runs). C-14.
		this._hooks.onInvalidate = [];
		this._hooks.onDeactivation = [];
		const ctx = this._buildCtx();
		const wasDirty = this._wave.emittedDirtyThisWave;
		this._wave.emittedSettleThisWave = false;
		this._wave.insideRunWave = true;
		try {
			this._slot.dispatcher.invoke(this._slot.handle as Handle, ctx);
		} finally {
			this._wave.insideRunWave = false;
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
			!this._wave.emittedSettleThisWave &&
			this._value.terminal === undefined &&
			!this._isAsyncPool()
		) {
			this._down([["RESOLVED"]]);
		}

		// roll wave-local state forward
		for (let i = 0; i < this._dep.batch.length; i++) {
			this._dep.batch[i] = null;
			this._dep.waveData[i] = [];
			this._dep.waveTokens[i] = undefined;
			this._dep.terminalInput[i] = undefined;
		}
		this._wave.emittedDirtyThisWave = false;
	}

	// ── ctx construction (L3-Q5: sync = node-stable reused ctx; async = per-invocation) ──

	private _buildCtx(): Ctx {
		const kind = this._slot.handle
			? this._slot.dispatcher.poolKind(this._slot.handle.poolId)
			: "sync";
		if (kind === "sync") {
			if (this._syncCtx === null) this._syncCtx = this._makeCtx();
			this._refreshCtx(this._syncCtx);
			return this._syncCtx;
		}
		// async: snapshot dep inputs so a deferred late-emit reads this wave's view.
		return this._makeCtx({
			waveData: this._dep.waveData.map((waves) => waves.map((w) => [...w])),
			terminal: this._dep.terminalInput.map(terminalView),
			latest: [...this._dep.prev],
		});
	}

	private _makeCtx(snapshot?: {
		waveData: unknown[][][];
		terminal: unknown[];
		latest: unknown[];
	}): Ctx {
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
			waveData: snapshot?.waveData ?? this._dep.waveData,
			terminal: snapshot?.terminal ?? this._dep.terminalInput.map(terminalView),
			state: this._makeState(),
			onDeactivation: (fn) => {
				this._hooks.onDeactivation.push(fn);
			},
			onInvalidate: (fn) => {
				this._hooks.onInvalidate.push(fn);
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
			[CTX_DEP_CACHE]: { latest: snapshot?.latest ?? this._dep.prev },
		};
		if (this._slot.dynamic) {
			// R-dynamic-node: read a dep's latest by index. Untracked deps still drive waves and
			// re-run the fn; under D49 (no equals-substitution) the fn re-emits its current value
			// as DATA — to suppress redundant downstream propagation, pair with distinctUntilChanged.
			ctx.track = (i: number) => ctx[CTX_DEP_CACHE]?.latest[i];
		}
		return ctx;
	}

	private _refreshCtx(ctx: Ctx): void {
		(ctx as { waveData: unknown[][][] }).waveData = this._dep.waveData;
		(ctx as { terminal: unknown[] }).terminal = this._dep.terminalInput.map(terminalView);
		ctx[CTX_DEP_CACHE] = { latest: this._dep.prev };
	}

	private _makeState(): CtxState {
		return {
			get: <S>() => this._privateState.value as S | undefined,
			set: <S>(v: S) => {
				this._privateState.value = v;
			},
			persist: (on = true) => {
				this._privateState.persist = on;
			},
		};
	}

	// ── downstream emission pipeline (the unified waist) ──

	private _down(msgs: Wave): void {
		validateDownPayloads(msgs);
		const deliveryWave = {};
		// Terminal-is-forever (R-terminal / D17 / B30): once COMPLETE/ERROR has been emitted the
		// node is final — a self-emit (state.set / ctx.down) in a LATER wave is a no-op, never
		// resurrecting the cache or re-emitting. The COMPLETE/ERROR arms below also self-guard
		// against a double terminal, but DATA/RESOLVED/INVALIDATE had no entry guard, so a
		// post-terminal set() would overwrite cache + emit DATA. R-teardown-terminal-relay / D65
		// carves out the only post-terminal exception: TEARDOWN still relays downstream for unwire
		// without reopening value output. A single wave that goes terminal mid-loop (e.g.
		// [COMPLETE, TEARDOWN]) is unaffected: _terminal is still undefined at entry.
		// Resubscribable reset clears _terminal before any re-emit.
		if (this._value.terminal !== undefined) {
			if (!msgs.some((m) => m[0] === "TEARDOWN")) return;
			this._value.hasTorndown = true;
			if (this._slot.resetOnTeardown) {
				this._value.cache = SENTINEL;
				this._value.hasData = false;
			}
			this._emitToSubs(["TEARDOWN"], { wave: deliveryWave, last: true });
			return;
		}
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
		if (
			hasTeardown &&
			!hasTerminal &&
			this._value.terminal === undefined &&
			!this._value.hasTorndown
		) {
			sorted = [["COMPLETE"], ...sorted];
		}
		// R-batch-coalesce (D12): inside a batch, emit DIRTY immediately but defer the
		// tier-3 settle slice to commit so a shared downstream recomputes once. Only
		// external emits defer (fn emits during commit run normally).
		if (!this._wave.insideRunWave && currentBatch()) {
			const tier3 = sorted.filter((m) => messageTier(m[0]) >= 3);
			if (tier3.length > 0) {
				if (!this._wave.emittedDirtyThisWave) {
					this._wave.emittedDirtyThisWave = true;
					this._value.status = "dirty";
					this._emitToSubs(["DIRTY"], { wave: deliveryWave, last: false });
				}
				this._wave.batchDirtyOwed = true; // BH1: owe a balancing RESOLVED on rollback
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
			if (buffered.length > 0) {
				// B36 / R-resolved-undirty: buffering a settle slice still means this fn wave
				// produced a settle. Without this, _runWave sees "dirty + no settle" and
				// synthesizes a RESOLVED that pierces the pause while the DATA waits in the buffer.
				this._wave.emittedSettleThisWave = true;
				this._control.pauseBuffer.push(buffered);
			}
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
		if (hasTier3 && !this._wave.insideRunWave && !this._wave.emittedDirtyThisWave) {
			this._wave.emittedDirtyThisWave = true;
			this._value.status = "dirty";
			this._emitToSubs(["DIRTY"], { wave: deliveryWave, last: false });
		}

		for (let i = 0; i < sorted.length; i++) {
			const m = sorted[i];
			const delivery = { wave: deliveryWave, last: i === sorted.length - 1 };
			// R-resolved-undirty (D49): a tier-3+ emit this wave means the fn produced a settle,
			// so no synthesized undirty RESOLVED is owed (see _runWave).
			if (messageTier(m[0]) >= 3) this._wave.emittedSettleThisWave = true;
			if (m[0] === "DIRTY") {
				if (!this._wave.emittedDirtyThisWave) {
					this._wave.emittedDirtyThisWave = true;
					this._value.status = "dirty";
					this._emitToSubs(["DIRTY"], delivery);
				}
				continue;
			}
			if (m[0] === "DATA") {
				const v = m[1] as T;
				// R-resolved-undirty (D49): every value-occurrence is emitted as DATA — the
				// substrate never substitutes DATA->RESOLVED on value-equality. Dedup is opt-in
				// at the operator layer (distinctUntilChanged), never a substrate behavior.
				this._value.cache = v;
				this._value.hasData = true;
				this._value.status = "settled";
				if (this._slot.replayN > 0) {
					this._value.replayRing.push(v);
					if (this._value.replayRing.length > this._slot.replayN) this._value.replayRing.shift();
				}
				this._emitToSubs(["DATA", v], delivery);
				continue;
			}
			if (m[0] === "RESOLVED") {
				this._value.status = this._value.hasData ? "resolved" : "sentinel";
				this._emitToSubs(["RESOLVED"], delivery);
				continue;
			}
			if (m[0] === "INVALIDATE") {
				this._invalidate(delivery);
				continue;
			}
			if (m[0] === "COMPLETE") {
				if (this._value.terminal !== undefined) continue;
				this._value.terminal = true;
				this._control.pauseBuffer = []; // BH3: terminal discards buffered settle slices
				this._value.status = "completed";
				this._emitToSubs(["COMPLETE"], delivery);
				continue;
			}
			if (m[0] === "ERROR") {
				if (this._value.terminal !== undefined) continue;
				this._value.terminal = m[1];
				this._control.pauseBuffer = []; // BH3: terminal discards buffered settle slices
				this._value.status = "errored";
				this._emitToSubs(["ERROR", m[1]], delivery);
				continue;
			}
			if (m[0] === "TEARDOWN") {
				this._value.hasTorndown = true;
				if (this._slot.resetOnTeardown) {
					this._value.cache = SENTINEL;
					this._value.hasData = false;
				}
				this._emitToSubs(["TEARDOWN"], delivery);
			}
			// PAUSE / RESUME — control slice.
		}

		if (!this._wave.insideRunWave) this._wave.emittedDirtyThisWave = false;
	}

	private _up(msgs: Wave, towardDep?: number, route?: UpRouteState): void {
		const routeState = route ?? { demandFired: new Map() };
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
				if (this._slot.pull && m[1] === this._slot.pullLock) {
					// a cone-routed RESUME of OUR pullId = a DEMAND (R-pull). Fire (or owe).
					if (!this._markDemandRouted(m[1], routeState)) this._onDemand();
				} else if (this._control.pauseLockset.has(m[1])) {
					// a pause lock held HERE → release LOCALLY (normal pause/resume, R-pause-lockset).
					this._pauseRelease(m[1]);
				} else {
					// not held here → forward UP the declared cone to find the holder.
					this._forwardUp(m, towardDep, routeState);
				}
			} else if (this._slot.deps.length === 0) {
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
				this._forwardUp(m, towardDep, routeState);
			}
		}
	}

	private _markDemandRouted(lockId: LockId, route: UpRouteState): boolean {
		let holders = route.demandFired.get(lockId);
		if (holders === undefined) {
			holders = new Set();
			route.demandFired.set(lockId, holders);
		}
		if (holders.has(this as unknown as Node<unknown>)) return true;
		holders.add(this as unknown as Node<unknown>);
		return false;
	}

	/**
	 * Forward one up-going control message toward deps (R-up-routing): up the single declared edge
	 * `towardDep` (directed — prunes other branches; only meaningful on the issuer's FIRST hop) or
	 * broadcast up ALL deps. A depless source has no deps → the message DROPS here (the terminus —
	 * e.g. a cone-routed RESUME whose pullId no node up this cone holds, R-up-at-source). Recursive
	 * forwarding carries the same per-wave route state and no `towardDep` → broadcast beyond the
	 * first hop.
	 */
	private _forwardUp(m: Message, towardDep: number | undefined, route: UpRouteState): void {
		if (this._slot.deps.length === 0) return; // depless source terminus → drop
		if (towardDep !== undefined) {
			const d = this._slot.deps[towardDep];
			if (d !== undefined) d._up([m], undefined, route);
		} else {
			for (const dep of this._slot.deps) dep._up([m], undefined, route);
		}
	}

	// ── PAUSE/RESUME lockset (R-pause-lockset) + modes (R-pause-modes) ──

	private _isPaused(): boolean {
		return this._control.pauseLockset.size > 0;
	}

	private _isAsyncPool(): boolean {
		return (
			this._slot.handle !== null &&
			this._slot.dispatcher.poolKind(this._slot.handle.poolId) === "async"
		);
	}

	private _pauseAcquire(lockId: unknown): void {
		this._control.pauseLockset.add(lockId); // Set => same-id repeat PAUSE is idempotent
	}

	private _pauseRelease(lockId: unknown): void {
		if (!this._control.pauseLockset.has(lockId)) return; // unknown id => no-op
		this._control.pauseLockset.delete(lockId);
		// R-pull (D59 / F4-F5): releasing an EXTERNAL pause lock can unblock a demand owed while the
		// node was externally paused — fire it if now able, even though the node still self-holds its
		// pullId (so the lockset is not empty). A pull node's OWN demand never routes here (it goes
		// through _onDemand); this only sees external pause/resume locks.
		if (this._slot.pull && this._control.demandOwed) this._fireOwedDemandIfReady();
		if (this._control.pauseLockset.size > 0) return; // another lock still held => stay paused
		this._onResume();
	}

	private _onResume(): void {
		// BH3: a node that terminated while paused discards its buffer and never
		// replays/recomputes (terminal-is-forever).
		if (this._value.terminal !== undefined) {
			this._control.pauseBuffer = [];
			this._control.pausedDepWaveOccurred = false;
			this._control.demandOwed = false;
			return;
		}
		// Non-pull pause/resume (R-pause-modes): drain buffered settle slices (resumeAll /
		// async-at-paused, R-async-paused), then fire a coalesced dep-wave once (default mode).
		// A PULL node never reaches here (D59): it always self-holds its pullId, so its lockset never
		// EMPTIES via _pauseRelease — a pull DEMAND fires through _onDemand, not _onResume.
		if (this._control.pauseBuffer.length > 0) {
			const buf = this._control.pauseBuffer;
			this._control.pauseBuffer = [];
			for (const wave of buf) this._down(wave);
		}
		if (this._control.pausedDepWaveOccurred) {
			this._control.pausedDepWaveOccurred = false;
			this._tryRun();
		}
	}

	/**
	 * R-pull (D59): can this pull node fire a demand NOW? — not terminal, settle-ready (_pending===0),
	 * and no OTHER (non-pullId) lock holds it paused. The gate that decides fire-now vs OWE.
	 */
	private _canFireDemand(): boolean {
		if (this._value.terminal !== undefined || this._wave.pending > 0) return false;
		const own = this._control.pauseLockset.has(this._slot.pullLock) ? 1 : 0; // discount our own pullId/quiet lock
		return this._control.pauseLockset.size <= own; // no external pause lock co-held
	}

	/**
	 * R-pull (D59): deliver ONE demand pulse — release the pullId so the demand wave RELAYS (not
	 * absorbed), fire it, then RE-QUIET (1:1). The pullId re-add + the re-entrancy flag are in a
	 * `finally` so a throwing pull fn (graph-less node, no D30 catch) cannot leave the node
	 * permanently non-quiet (the wedge-fix silently disabled) — QA-found robustness fix.
	 */
	private _deliverPullDemand(): void {
		this._control.demandOwed = false;
		this._control.inDeliverDemand = true;
		this._control.pauseLockset.delete(this._slot.pullLock as LockId);
		try {
			this._firePullDemand();
		} finally {
			this._control.pauseLockset.add(this._slot.pullLock as LockId); // re-quiet (even on a throwing fn)
			this._control.inDeliverDemand = false;
		}
	}

	/**
	 * R-pull (D59): a cone-routed RESUME of THIS node's pullId arrived (R-up-routing) = a DEMAND.
	 * Fire immediately if able; else OWE it — pin-5 (a dep DIRTY in flight, _pending>0) or F4/F5 (an
	 * external PAUSE lock co-holds the node) — and fire when the node next becomes able. A demand
	 * arriving WHILE a delivery is in flight (synchronous re-entry) is DROPPED (1:1, QA guard).
	 */
	private _onDemand(): void {
		if (this._control.inDeliverDemand) return; // re-entrant demand during an active delivery → drop (1:1)
		if (this._canFireDemand()) this._deliverPullDemand();
		else this._control.demandOwed = true;
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
		if (this._control.pauseBuffer.length > 0) {
			const buf = this._control.pauseBuffer;
			this._control.pauseBuffer = [];
			for (const wave of buf) this._down(wave);
		}
		if (this._control.pausedDepWaveOccurred) {
			// QA-B2: only deliver if the fn can actually run this wave (settle-ready + first-run gate
			// open). A gated run emits no DATA, so emitting the leading DIRTY would STRAND downstream
			// — the exact wedge this feature exists to prevent (NoWedgeWhileQuiet). When gated, stay
			// SILENT and KEEP _pausedDepWaveOccurred so a later demand (once every dep has settled)
			// delivers. Mirrors _settleRewire's pre-_markDirty gate.
			const gated =
				this._slot.handle !== null &&
				!this._wave.hasCalledFnOnce &&
				!(this._slot.partial || this._allDepsSettled());
			if (this._wave.pending > 0 || gated) return;
			this._control.pausedDepWaveOccurred = false;
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
		if (this._control.inDeliverDemand) return; // don't re-enter during an active delivery (1:1, QA guard)
		if (this._slot.pull && this._control.demandOwed && this._canFireDemand())
			this._deliverPullDemand();
	}

	/** Should an outgoing settle slice be deferred into the pause buffer? */
	private _shouldBufferOnPause(): boolean {
		// D44: pausable mode is the OUTER gate over R-async-paused buffering.
		// false: ignore PAUSE/RESUME ENTIRELY — never buffer, keep producing (R-pause-modes; resolves B20).
		if (this._slot.pausable === false) return false;
		if (!this._isPaused()) return false;
		// resumeAll: production-gating — buffer the node's own (sync/async) settle slice too.
		if (this._slot.pausable === "resumeAll") return true;
		// true (default): PAUSE gates recomputation/propagation, NOT a leaf source's own production.
		// An async COMPUTE node's (deps>0) in-flight result buffers (R-async-paused / C-2); a depless
		// async leaf source's own production delivers immediately (R-pause-modes / C-10).
		if (!this._wave.insideRunWave && this._isAsyncPool() && this._slot.deps.length > 0) return true;
		return false;
	}

	/** R-invalidate-idempotent: clear cache + flush + cascade; no-op if nothing cached. */
	private _invalidate(delivery?: DeliveryMeta): void {
		if (!this._value.hasData) return; // never-populated or already-reset → no-op
		this._value.cache = SENTINEL;
		this._value.hasData = false;
		this._value.status = "sentinel";
		this._value.replayRing = []; // BH6: invalidated values are stale — don't replay them
		for (const fn of this._hooks.onInvalidate) fn();
		this._emitToSubs(["INVALIDATE"], delivery);
	}

	// B42 (R-deps-terminal): ALL deps TERMINAL = every dep has reached COMPLETE *or* an ABSORBED
	// ERROR. Block only on a LIVE dep (_depTerminal[i] === undefined); an errored dep (terminal = the
	// error payload, which R-data-payload guarantees is !== undefined and non-boolean) COUNTS as
	// terminal-done. Was
	// `tm !== true`, which wedged a node whose errorWhenDepsError:false dep ERRORed (it never
	// auto-completed even after every other dep completed). Drives the completeWhenDepsComplete cascade.
	private _allDepsTerminal(): boolean {
		if (this._slot.deps.length === 0) return false;
		for (const tm of this._dep.terminal) if (tm === undefined) return false;
		return true;
	}

	/** R-terminal: resubscribable reset clears terminal + dep state + re-arms the gate. */
	private _resetLifecycle(): void {
		for (const u of this._dep.unsubs) if (u) u();
		this._dep.unsubs = [];
		this._dep.idxBoxes = [];
		this._lifecycle.subscribers.clear();
		this._lifecycle.activated = false;
		this._value.terminal = undefined;
		this._value.hasTorndown = false;
		this._wave.hasCalledFnOnce = false;
		this._resetDepState();
		this._control.pauseLockset.clear();
		this._control.pauseBuffer = [];
		this._control.pausedDepWaveOccurred = false;
		this._control.demandOwed = false; // R-pull (D55): drop any deferred demand
		this._value.replayRing = []; // BH6
		const isCompute = this._slot.handle !== null || this._slot.deps.length > 0;
		if (isCompute) {
			this._value.cache = SENTINEL;
			this._value.hasData = false;
			this._value.status = "sentinel";
		} else {
			this._value.status = this._value.hasData ? "settled" : "sentinel";
		}
		if (!this._privateState.persist) this._privateState.value = SENTINEL;
	}

	private _emitToSubs(msg: Message, delivery?: DeliveryMeta): void {
		// Copy guards against subscribe/unsubscribe during iteration.
		const subs = [...this._lifecycle.subscribers];
		for (const sink of subs) sink(msg, delivery);
	}

	/** Batch commit (R-batch-coalesce): deliver the deferred tier-3 wave now. */
	__commitBatchedWave(wave: Wave): void {
		this._wave.batchDirtyOwed = false; // commit delivers the real settle (BH1)
		this._down(wave); // batch is inactive at commit -> processes normally
	}

	/** Batch rollback: balance the immediate DIRTY with a RESOLVED so downstream un-dirties. */
	__rollbackBatched(): void {
		// BH1: keyed on _batchDirtyOwed (not _emittedDirtyThisWave, which a fn wave between
		// defer and rollback would have reset) so the balancing RESOLVED is never skipped.
		if (this._wave.batchDirtyOwed) {
			this._wave.batchDirtyOwed = false;
			this._wave.emittedDirtyThisWave = false;
			this._value.status = this._value.hasData ? "settled" : "sentinel";
			this._emitToSubs(["RESOLVED"]);
		}
	}

	/** B49: enqueue a committed-boundary task on this node's graph-local core. */
	__deferBoundary(fn: () => void): void {
		deferRewire(this._core, fn);
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
