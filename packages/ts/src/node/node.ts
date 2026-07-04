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

import { enterWave, exitWave } from "../batch/boundary.js";
import type { Ctx, CtxState, DeliveryMeta, NodeFn, Sink } from "../ctx/types.js";
import { defaultDispatcher, type Handle } from "../dispatcher/index.js";
import { EnvironmentDrivers } from "../graph/environment.js";
import {
	type LockId,
	type Message,
	type PullDemand,
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
	type VersionState,
	type WaveState,
} from "./core.js";
import {
	nodeBuildCtx,
	nodeMakeCtx,
	nodeMakeState,
	nodeRefreshCtx,
} from "./node-context-runtime.js";
import {
	nodeAllDepsSettled,
	nodeDepProjectionHasData,
	nodeMarkDirty,
	nodeMaybeRun,
	nodePassthroughEmit,
	nodeReceiveFromDep,
	nodeRecordDepProjection,
	nodeReleaseDepDirty,
	nodeRunWave,
	nodeSettleAfterAbsorbedTerminal,
	nodeSettleRewire,
	nodeTryRun,
} from "./node-input-runtime.js";
import {
	nodeActivate,
	nodeDeactivate,
	nodeIsRuntimeQuiescentForRelease,
	nodeReleaseRuntime,
	nodeResetDepState,
	nodeSeedRestoredDepAt,
	nodeSubscribeDepAt,
	nodeSubscriberCount,
} from "./node-lifecycle-runtime.js";
import {
	nodeAllDepsTerminal,
	nodeCanFireDemand,
	nodeCommitBatchedWave,
	nodeDeferBoundary,
	nodeDeliverPullDemand,
	nodeDown,
	nodeEmitToSubs,
	nodeFireOwedDemandIfReady,
	nodeFirePullDemand,
	nodeForwardUp,
	nodeHasBoundaryPauseLock,
	nodeInvalidate,
	nodeIsAsyncPool,
	nodeIsPaused,
	nodeMarkDemandRouted,
	nodeOnDemand,
	nodeOnResume,
	nodePauseAcquire,
	nodePauseRelease,
	nodeResetLifecycle,
	nodeRollbackBatched,
	nodeShouldBufferOnPause,
	nodeUp,
} from "./node-output-runtime.js";
import {
	nodeApplyRewireNext,
	nodeRequestRewireNext,
	nodeRequestUpNext,
	nodeRewire,
} from "./node-rewire-runtime.js";
import { nodeRuntimeHost } from "./node-runtime-host.js";
import {
	activationReaders,
	checkpointReaders,
	getNodeOwner,
	restoreWriters,
	runtimeQuiescenceReaders,
	runtimeReleasers,
	subscriberCountReaders,
	takeConstructingEnvironmentDrivers,
	takeConstructingNodeCore,
} from "./runtime-accessors.js";
import type { NodeOptions, RewireOp, Status, UpRouteState } from "./types.js";
import {
	cloneNodeVersion,
	createNodeVersion,
	type NodeVersion,
	resolveNodeVersioningPolicy,
	restoredV1Cid,
} from "./versioning.js";

export {
	checkpointStateOfNode,
	getNodeOwner,
	isNodeActiveForRelease,
	isNodeRuntimeQuiescentForRelease,
	isNodeRuntimeReleased,
	releaseRuntimeOfNode,
	restoreStateOfNode,
	setNodeOwner,
	setNodeTopologyDepsChangedObserver,
	subscriberCountOfNode,
	withEnvironmentDrivers,
	withNodeCore,
} from "./runtime-accessors.js";
export type { NodeCheckpointState, NodeOptions, NodeRestoreState, Status } from "./types.js";

/**
 * Reactive substrate node that owns dependencies, wave handling, lifecycle, and subscribers.
 *
 * @example
 * ```ts
 * import { node } from "@graphrefly/ts/core";
 *
 * const source = node<number>([], null);
 * source.subscribe((value) => console.log(value));
 * source.down([["DATA", 1]]);
 * ```
 * @remarks **Substrate primitive:** `Node` is graph-agnostic; use `graph().node`,
 *   `graph().state`, or `graph().derived` when you want inspection and lifecycle ownership.
 * @category core
 */
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
	private readonly _version: VersionState;
	private _restoredActivationPending = false;
	private _released = false;

	private get _syncCtx(): Ctx | null {
		return this._syncCtxState.value;
	}

	private set _syncCtx(ctx: Ctx | null) {
		this._syncCtxState.value = ctx;
	}

	private static _retainIndirectRuntimeMethods(node: Node<unknown>): void {
		void node._dep;
		void node._hooks;
		void node._restoredActivationPending;
		void node._requestRewireNext;
		void node._requestUpNext;
		void node._applyRewireNext;
		void node._reachableUpstream;
		void node._assertRewireDepOwner;
		void node._subscribeDepAt;
		void node._seedRestoredDepAt;
		void node._recordDepProjection;
		void node._depProjectionHasData;
		void node._receiveFromDep;
		void node._releaseDepDirty;
		void node._settleAfterAbsorbedTerminal;
		void node._markDirty;
		void node._maybeRun;
		void node._settleRewire;
		void node._tryRun;
		void node._allDepsSettled;
		void node._passthroughEmit;
		void node._runWave;
		void node._buildCtx;
		void node._makeCtx;
		void node._refreshCtx;
		void node._makeState;
		void node._markDemandRouted;
		void node._forwardUp;
		void node._isPullQuiet;
		void node._isPaused;
		void node._hasBoundaryPauseLock;
		void node._isAsyncPool;
		void node._pauseAcquire;
		void node._pauseRelease;
		void node._onResume;
		void node._canFireDemand;
		void node._deliverPullDemand;
		void node._onDemand;
		void node._firePullDemand;
		void node._fireOwedDemandIfReady;
		void node._shouldBufferOnPause;
		void node._invalidate;
		void node._allDepsTerminal;
		void node._emitToSubs;
	}

	constructor(
		deps: Node<unknown>[],
		handleOrFn: Handle | NodeFn | null,
		opts: NodeOptions<T> = {},
	) {
		const core = takeConstructingNodeCore();
		const dispatcher = opts.dispatcher ?? defaultDispatcher;
		const environment = takeConstructingEnvironmentDrivers() ?? EnvironmentDrivers.empty();
		const pool = opts.pool ?? "sync";
		const pausable = opts.pausable ?? true;
		const pullLock = opts.pullId;
		const pull = opts.pullId !== undefined;
		// R-pull (D269): pull-mode is keyed by an author-supplied pullId (its quiet latch).
		// R-pull (D55, pin 3): pull still uses the pausable delivery-content axis; pausable:false
		// ignores PAUSE/RESUME buffering and contradicts quiet pull delivery. Reject at construction.
		if (pull && pausable === false)
			throw new Error(
				"node: pullId is incompatible with pausable:false — a pull node uses the pausable delivery-content axis (R-pull / R-pause-modes / D55,D269)",
			);

		let handle: Handle | null;
		if (handleOrFn === null) handle = null;
		else if (typeof handleOrFn === "function") handle = dispatcher.register(handleOrFn, pool);
		else handle = handleOrFn;

		const n = deps.length;
		const dep = makeDepBookkeeping(n);
		const versioning = resolveNodeVersioningPolicy(opts.versioning);
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
		this._core = core ?? new NodeCore();
		const created = this._core.createSlot<T>(
			{
				deps,
				handle,
				pool,
				dispatcher,
				environment,
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
					demandOwed: undefined,
					activePull: undefined,
					pullDirtyOwed: false,
					inDeliverDemand: false,
				},
				privateState: { value: SENTINEL, persist: false },
				hooks: { onDeactivation: [], onInvalidate: [] },
				syncCtx: { value: null },
				version: {
					policy: versioning,
					value: createNodeVersion(
						versioning,
						opts.initial !== undefined ? opts.initial : undefined,
					),
				},
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
		this._version = this._core.getVersion(this._id);
		checkpointReaders.set(this as Node<unknown>, () => ({
			cache: this._value.cache,
			hasData: this._value.hasData,
			terminal: this._value.terminal,
			activated: this._lifecycle.activated,
			hasCalledFnOnce: this._wave.hasCalledFnOnce,
			ctxState: {
				value: this._privateState.value,
				persist: this._privateState.persist,
			},
			version: cloneNodeVersion(this._version.value),
			handle: this._slot.handle,
		}));
		restoreWriters.set(this as Node<unknown>, (state) => {
			this._assertNotReleased("restoreGraph");
			this._value.cache = state.cache as T;
			this._value.hasData = state.hasData;
			this._value.status = state.status;
			this._value.terminal = state.terminal;
			this._value.hasTorndown = false;
			this._value.replayRing = [];
			this._wave.hasCalledFnOnce = state.hasCalledFnOnce;
			this._wave.emittedDirtyThisWave = false;
			this._wave.emittedSettleThisWave = false;
			this._wave.pending = 0;
			this._wave.insideRunWave = false;
			this._wave.inDepMutation = false;
			this._wave.rewireRunPending = false;
			this._wave.batchDirtyOwed = false;
			this._control.pauseBuffer = [];
			this._control.pausedDepWaveOccurred = false;
			this._control.demandOwed = undefined;
			this._control.activePull = undefined;
			this._control.pullDirtyOwed = false;
			this._control.inDeliverDemand = false;
			this._control.pauseLockset.clear();
			this._privateState.value = state.ctxState.value;
			this._privateState.persist = state.ctxState.persist;
			if (state.version === false) {
				this._version.policy = { enabled: false };
				this._version.value = undefined;
			} else if (state.version.level === 0) {
				this._version.policy = { enabled: true, level: 0 };
				this._version.value = cloneNodeVersion(state.version);
			} else {
				if (!this._version.policy.enabled || this._version.policy.level !== 1) {
					throw new Error(
						`restoreGraph: checkpoint node version level ${state.version.level} requires matching node versioning policy`,
					);
				}
				// D109: V1 restore must match the selected hash lane. After DATA then
				// INVALIDATE/resetOnTeardown, cache is absent while cid remains the last DATA cid;
				// without the DATA value, restore cannot verify the lane, so fail honestly.
				if (!state.hasData && state.version.counter > 0) {
					throw new Error(
						"restoreGraph: checkpoint node version cid cannot be verified without current DATA under V1 versioning (D109)",
					);
				}
				const expectedCid = restoredV1Cid(this._version.policy, state.hasData, state.cache);
				if (expectedCid !== state.version.cid) {
					throw new Error(
						"restoreGraph: checkpoint node version cid does not match the selected node versioning hash policy (D109)",
					);
				}
				this._version.value = cloneNodeVersion(state.version);
			}
			this._syncCtx = null;
			this._resetDepState();
			// A fresh restored graph has no subscribers before return. Keep activation closed so the
			// first real subscriber wires deps normally; D94's preserved lifecycle bit is the first-run
			// gate (`hasCalledFnOnce`), not a hidden subscription graph.
			this._lifecycle.activated = false;
			this._lifecycle.subscribers.clear();
			this._restoredActivationPending = true;
		});
		runtimeReleasers.set(this as Node<unknown>, () => this._releaseRuntime());
		runtimeQuiescenceReaders.set(this as Node<unknown>, () => this._isRuntimeQuiescentForRelease());
		subscriberCountReaders.set(this as Node<unknown>, () => this._subscriberCount());
		activationReaders.set(this as Node<unknown>, () => this._lifecycle.activated);
		Node._retainIndirectRuntimeMethods(this as Node<unknown>);
	}

	/** R-pull (D55/D272): true while a pull node is not serving a PULL demand pulse. */
	private _isPullQuiet(): boolean {
		return this._slot.pull && this._control.activePull === undefined;
	}

	/**
	 * R-pull (D269/D272): this pull node's pullId (pure data, like {@link cache}/{@link handle} —
	 * never triggers computation). A consumer demands one delivery by cone-routing PULL of it (no
	 * node reference): `ctx.up([["PULL", { pullId }]])` (immediate; loops back → D37 for a self-read
	 * dep) or `ctx.upNext([["PULL", { pullId }]])` (boundary-deferred self-demand). Undefined for a
	 * non-pull node. The author writes the pullId verbatim; routing matches by identity.
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

	get version(): NodeVersion | undefined {
		return cloneNodeVersion(this._version.value);
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
		this._assertNotReleased("subscribe");
		// Wave-owner boundary (R-rewire-deferred / D47): the activation cascade can run fns that
		// issue ctx.rewireNext; the OUTERMOST exit drains them. Nested subscribes (dep wiring)
		// just inc/dec the depth.
		enterWave();
		try {
			// R-terminal: late subscribe to a terminal node either resets (resubscribable)
			// or is rejected (non-resubscribable, R2.2.7.b).
			if (this._value.terminal !== undefined) {
				if (this._slot.resubscribable) {
					this._restoredActivationPending = false;
					this._resetLifecycle();
				} else
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
				// default, it stays silent until demanded (START only). QA-B4: gated on `_pull`, not
				// activePull, so a REACTIVATED pull node still does not leak its cache.
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
		this._assertNotReleased("down");
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
		this._assertNotReleased("up");
		// Wave-owner boundary (D47). Internal dep-forwarding calls dep.up() nest under this.
		enterWave();
		try {
			this._up(msgs, towardDep);
		} finally {
			exitWave();
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
	replaceDeps(newDeps: Node<unknown>[], fn: NodeFn): void {
		this._assertNotReleased("replaceDeps");
		this._rewire(this._dedupDeps(newDeps), fn);
	}

	/** Subscribe to one dep (special case of replaceDeps); returns its index. fn required (SD-1). */
	subscribeDep(depNode: Node<unknown>, fn: NodeFn): number {
		this._assertNotReleased("subscribeDep");
		const next = this._slot.deps.includes(depNode)
			? [...this._slot.deps]
			: [...this._slot.deps, depNode];
		const deferred = this._rewire(next, fn);
		return deferred ? next.indexOf(depNode) : this._slot.deps.indexOf(depNode);
	}

	/** Unsubscribe from one dep (special case of replaceDeps); idempotent if absent (fn swap still applies). */
	unsubscribeDep(depNode: Node<unknown>, fn: NodeFn): void {
		this._assertNotReleased("unsubscribeDep");
		this._rewire(
			this._slot.deps.filter((d) => d !== depNode),
			fn,
		);
	}

	private _requestRewireNext(op: RewireOp): void {
		nodeRequestRewireNext(nodeRuntimeHost(this), op);
	}

	private _requestUpNext(msgs: Wave, towardDep?: number): void {
		nodeRequestUpNext(nodeRuntimeHost(this), msgs, towardDep);
	}

	private _applyRewireNext(op: RewireOp): void {
		nodeApplyRewireNext(nodeRuntimeHost(this), op);
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

	private _reachableUpstream(from: Node<unknown>, target: Node<unknown>): boolean {
		const seen = new Set<Node<unknown>>();
		const stack: Node<unknown>[] = [from];
		while (stack.length > 0) {
			const n = stack.pop();
			if (n === undefined) continue;
			if (n === target) return true;
			if (seen.has(n)) continue;
			seen.add(n);
			for (const d of nodeRuntimeHost(n)._slot.deps) stack.push(d);
		}
		return false;
	}

	private _assertRewireDepOwner(dep: Node<unknown>): void {
		const selfOwner = getNodeOwner(this as unknown as Node<unknown>);
		const depOwner = getNodeOwner(dep);
		if (selfOwner !== undefined && depOwner !== undefined && selfOwner !== depOwner)
			throw new Error(
				"rewire: dep belongs to a different graph; cross-graph deps require a wire bridge (D22 / R-graph-domain)",
			);
	}

	private _rewire(
		newDeps: Node<unknown>[],
		fn: NodeFn,
		opts: { allowTerminalOwner?: boolean } = {},
	): boolean {
		return nodeRewire(nodeRuntimeHost(this), newDeps, fn, opts);
	}

	// ── activation / deactivation (lazy; R-rom-ram) ──

	private _activate(): void {
		nodeActivate(nodeRuntimeHost(this));
	}

	private _deactivate(): void {
		nodeDeactivate(nodeRuntimeHost(this));
	}

	private _assertNotReleased(op: string): void {
		if (this._released)
			throw new Error(`${op}: node has been released from its graph lifecycle (D122)`);
	}

	private _subscriberCount(): number {
		return nodeSubscriberCount(nodeRuntimeHost(this));
	}

	private _isRuntimeQuiescentForRelease(): boolean {
		return nodeIsRuntimeQuiescentForRelease(nodeRuntimeHost(this));
	}

	private _releaseRuntime(): void {
		nodeReleaseRuntime(nodeRuntimeHost(this));
	}

	private _resetDepState(): void {
		nodeResetDepState(nodeRuntimeHost(this));
	}

	private _subscribeDepAt(depNode: Node<unknown>, opts: { seedRestored?: boolean } = {}): void {
		nodeSubscribeDepAt(nodeRuntimeHost(this), depNode, opts);
	}

	private _seedRestoredDepAt(idx: number, depNode: Node<unknown>): void {
		nodeSeedRestoredDepAt(nodeRuntimeHost(this), idx, depNode);
	}

	private _recordDepProjection(idx: number, delivery: DeliveryMeta | undefined): unknown[] {
		return nodeRecordDepProjection(nodeRuntimeHost(this), idx, delivery);
	}

	private _depProjectionHasData(idx: number): boolean {
		return nodeDepProjectionHasData(nodeRuntimeHost(this), idx);
	}

	private _receiveFromDep(idx: number, msg: Message, delivery?: DeliveryMeta): void {
		nodeReceiveFromDep(nodeRuntimeHost(this), idx, msg, delivery);
	}

	private _releaseDepDirty(idx: number): void {
		nodeReleaseDepDirty(nodeRuntimeHost(this), idx);
	}

	private _settleAfterAbsorbedTerminal(): void {
		nodeSettleAfterAbsorbedTerminal(nodeRuntimeHost(this));
	}

	private _markDirty(): void {
		nodeMarkDirty(nodeRuntimeHost(this));
	}

	private _maybeRun(): void {
		nodeMaybeRun(nodeRuntimeHost(this));
	}

	private _settleRewire(): void {
		nodeSettleRewire(nodeRuntimeHost(this));
	}

	private _tryRun(): void {
		nodeTryRun(nodeRuntimeHost(this));
	}

	private _allDepsSettled(): boolean {
		return nodeAllDepsSettled(nodeRuntimeHost(this));
	}

	private _passthroughEmit(): void {
		nodePassthroughEmit(nodeRuntimeHost(this));
	}

	private _runWave(): void {
		nodeRunWave(nodeRuntimeHost(this));
	}

	private _buildCtx(): Ctx {
		return nodeBuildCtx(nodeRuntimeHost(this));
	}

	private _makeCtx(snapshot?: {
		waveData: unknown[][][];
		waveLive?: boolean[][];
		terminal: unknown[];
		latest: unknown[];
	}): Ctx {
		return nodeMakeCtx(nodeRuntimeHost(this), snapshot);
	}

	private _refreshCtx(ctx: Ctx): void {
		nodeRefreshCtx(nodeRuntimeHost(this), ctx);
	}

	private _makeState(): CtxState {
		return nodeMakeState(nodeRuntimeHost(this));
	}

	// ── downstream emission pipeline (the unified waist) ──

	private _down(msgs: Wave): void {
		nodeDown(nodeRuntimeHost(this), msgs);
	}

	private _up(msgs: Wave, towardDep?: number, route?: UpRouteState): void {
		nodeUp(nodeRuntimeHost(this), msgs, towardDep, route);
	}

	private _markDemandRouted(lockId: LockId, route: UpRouteState): boolean {
		return nodeMarkDemandRouted(nodeRuntimeHost(this), lockId, route);
	}

	private _forwardUp(m: Message, towardDep: number | undefined, route: UpRouteState): void {
		nodeForwardUp(nodeRuntimeHost(this), m, towardDep, route);
	}

	private _isPaused(): boolean {
		return nodeIsPaused(nodeRuntimeHost(this));
	}

	private _hasBoundaryPauseLock(): boolean {
		return nodeHasBoundaryPauseLock(nodeRuntimeHost(this));
	}

	private _isAsyncPool(): boolean {
		return nodeIsAsyncPool(nodeRuntimeHost(this));
	}

	private _pauseAcquire(lockId: unknown): void {
		nodePauseAcquire(nodeRuntimeHost(this), lockId);
	}

	private _pauseRelease(lockId: unknown): void {
		nodePauseRelease(nodeRuntimeHost(this), lockId);
	}

	private _onResume(): void {
		nodeOnResume(nodeRuntimeHost(this));
	}

	private _canFireDemand(): boolean {
		return nodeCanFireDemand(nodeRuntimeHost(this));
	}

	private _deliverPullDemand(demand: PullDemand): void {
		nodeDeliverPullDemand(nodeRuntimeHost(this), demand);
	}

	private _onDemand(demand: PullDemand): void {
		nodeOnDemand(nodeRuntimeHost(this), demand);
	}

	private _firePullDemand(): void {
		nodeFirePullDemand(nodeRuntimeHost(this));
	}

	private _fireOwedDemandIfReady(): void {
		nodeFireOwedDemandIfReady(nodeRuntimeHost(this));
	}

	private _shouldBufferOnPause(): boolean {
		return nodeShouldBufferOnPause(nodeRuntimeHost(this));
	}

	private _invalidate(delivery?: DeliveryMeta): void {
		nodeInvalidate(nodeRuntimeHost(this), delivery);
	}

	private _allDepsTerminal(): boolean {
		return nodeAllDepsTerminal(nodeRuntimeHost(this));
	}

	private _emitToSubs(msg: Message, delivery?: DeliveryMeta): void {
		nodeEmitToSubs(nodeRuntimeHost(this), msg, delivery);
	}

	/** R-terminal: resubscribable reset clears terminal + dep state + re-arms the gate. */
	private _resetLifecycle(): void {
		nodeResetLifecycle(nodeRuntimeHost(this));
	}

	/** Batch commit (R-batch-coalesce): deliver the deferred tier-3 wave now. */
	__commitBatchedWave(wave: Wave): void {
		nodeCommitBatchedWave(nodeRuntimeHost(this), wave);
	}

	/** Batch rollback: balance the immediate DIRTY with a RESOLVED so downstream un-dirties. */
	__rollbackBatched(): void {
		nodeRollbackBatched(nodeRuntimeHost(this));
	}

	/** B49: enqueue a committed-boundary task on this node's graph-local core. */
	__deferBoundary(fn: () => void, batchToken?: object): void {
		nodeDeferBoundary(nodeRuntimeHost(this), fn, batchToken);
	}
}

/**
 * Construct a node (R-node-iface / D5 / L1.9 deps-first).
 *   node([], null, { initial })       — state node (manual source; emit via .down)
 *   node([], fn)                        — producer (runs on activation)
 *   node([a, b], fn)                    — compute / derived
 *   node([dep])                         — passthrough wire
 *
 * @param deps - Upstream nodes this node reads positionally from `ctx`.
 * @param handleOrFn - Dispatcher handle, node function, or `null` for a manual source/state node.
 * @param opts - Node runtime options such as `initial`, `name`, pool, dispatcher, and restore data.
 * @returns A graph-agnostic `Node`.
 * @example
 * ```ts
 * import { depLatest, node } from "@graphrefly/ts/core";
 *
 * const source = node<number>([], null, { initial: 1 });
 * const doubled = node<number>([source], (ctx) => {
 *   ctx.down([["DATA", Number(depLatest(ctx, 0)) * 2]]);
 * });
 * ```
 * @category core
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
 * @param deps - Declared dependency node or nodes.
 * @param fn - Synchronous function invoked by the helper.
 * @param opts - Options that configure the helper.
 * @returns A `Node<T>` value.
 * @category core
 * @example
 * ```ts
 * import { dynamicNode } from "@graphrefly/ts/core";
 * ```
 */
export function dynamicNode<T = unknown>(
	deps: Node<unknown>[],
	fn: NodeFn,
	opts: NodeOptions<T> = {},
): Node<T> {
	return new Node<T>(deps, fn, { ...opts, dynamic: true });
}
