/**
 * The node primitive — the thinnest substrate object (R-node-thin / D5).
 *
 * Holds a fn handle + deps + the wave state machine; ZERO inspection cruft
 * (naming/find/describe are the graph layer, CSP-2). Canonical authority:
 * ~/src/graphrefly/spec/rules.jsonl (R-node-*, R-two-phase, R-diamond, R-resolved-undirty,
 * R-first-run-gate, R-push-subscribe, R-rom-ram, R-fn-contract, R-initial, R-ctx-up).
 *
 * Slice 1 = core wave: state node, compute node, two-phase PENDING->DATA, diamond
 * pending-counter join, first-run gate, substrate-synthesized undirty RESOLVED
 * (R-resolved-undirty / D49 — no equals-substitution; every occurrence is DATA),
 * push-on-subscribe, lazy activation, ROM/RAM. Lifecycle (terminal/INVALIDATE/cleanup),
 * control (async), batch, and dynamicNode land in later slices.
 */

import { currentBoundaryBatchToken } from "../batch/batch.js";
import { deferRewire, enterWave, exitWave, isWaveActive } from "../batch/boundary.js";
import type { Ctx, CtxState, DeliveryMeta, NodeFn, Sink } from "../ctx/types.js";
import { defaultDispatcher, type Handle } from "../dispatcher/index.js";
import { EnvironmentDrivers } from "../graph/environment.js";
import { type Message, SENTINEL, type Wave } from "../protocol/messages.js";
import {
	type CleanupHooks,
	type DepBookkeeping,
	type LifecycleState,
	makeDepBookkeeping,
	NodeCore,
	type NodeId,
	type NodeSlot,
	type PrivateState,
	type Subscriber,
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
	nodeCallSink,
	nodeCommitBatchedWave,
	nodeDeferBoundary,
	nodeDown,
	nodeInvalidate,
	nodeMarkBatchedWave,
	nodeMarkDependents,
	nodePublish,
	nodeResetLifecycle,
} from "./node-output-runtime.js";
import { nodeApplyRewireNext, nodeRequestRewireNext, nodeRewire } from "./node-rewire-runtime.js";
import { nodeRuntimeHost } from "./node-runtime-host.js";
import {
	constructionAcquisitions,
	failNodeAcquisition,
	type NodeAcquisition,
	type SubscriptionAcquisition,
} from "./owned-acquisition.js";
import { validateNodeOutput } from "./protocol-guards.js";
import {
	getNodeOwner,
	issueNodeRegistration,
	takeConstructingEnvironmentDrivers,
	takeConstructingNodeCore,
} from "./runtime-accessors.js";
import type { NodeOptions, RewireOp, Status } from "./types.js";
import {
	cloneNodeVersion,
	createNodeVersion,
	type NodeVersion,
	resolveNodeVersioningPolicy,
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
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
	private readonly _wave: WaveState;
	private readonly _lifecycle: LifecycleState;
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: used by the issued runtime host.
	private readonly _privateState: PrivateState;
	private readonly _hooks: CleanupHooks;
	private readonly _syncCtxState: SyncCtxState;
	private readonly _version: VersionState;
	private _restoredActivationPending = false;
	private _released = false;
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
	private get _syncCtx(): Ctx | null {
		return this._syncCtxState.value;
	}
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
	private set _syncCtx(ctx: Ctx | null) {
		this._syncCtxState.value = ctx;
	}

	private static _retainIndirectRuntimeMethods(node: Node<unknown>): void {
		void node._dep;
		void node._hooks;
		void node._restoredActivationPending;
		void node._requestRewireNext;
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
		void node._invalidate;
		void node._allDepsTerminal;
		void node._markDependents;
		void node._publish;
	}

	constructor(
		deps: Node<unknown>[],
		handleOrFn: Handle | NodeFn | null,
		opts: NodeOptions<T> = {},
	) {
		const suppliedAcquisition = constructionAcquisitions.get(opts);
		const acquisition: NodeAcquisition = suppliedAcquisition ?? { name: "bare node" };
		constructionAcquisitions.delete(opts);
		const core = takeConstructingNodeCore();
		const dispatcher = opts.dispatcher ?? defaultDispatcher;
		const environment = takeConstructingEnvironmentDrivers() ?? EnvironmentDrivers.empty();
		try {
			const versioning = resolveNodeVersioningPolicy(opts.versioning);
			const pool = opts.pool ?? "sync";

			let handle: Handle | null;
			if (handleOrFn === null) handle = null;
			else if (typeof handleOrFn === "function") handle = dispatcher.register(handleOrFn, pool);
			else handle = handleOrFn;
			if (handle !== null && typeof handleOrFn === "function") {
				acquisition.dispatcher = dispatcher;
				acquisition.handle = handle;
			}

			const n = deps.length;
			const dep = makeDepBookkeeping(n);
			const value = {
				cache: SENTINEL as T | undefined,
				hasData: false,
				status: "sentinel" as Status,
				terminal: undefined,
				lastArray: [] as T[],
			};
			if (opts.initial !== undefined) {
				value.cache = opts.initial as T;
				value.lastArray = [opts.initial as T];
				value.hasData = true;
				value.status = "settled";
			}
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
					quiet: opts.quiet ?? false,
					dynamic: opts.dynamic ?? false,
					name: opts.name,
					factory: opts.factory,
				},
				{
					dep,
					lifecycle: { subscribers: new Set<Subscriber>(), activated: false },
					value,
					wave: {
						pending: 0,
						hasCalledFnOnce: false,
						emittedDirtyThisWave: false,
						emittedSettleThisWave: false,
						insideRunWave: false,
						runOutput: [],
						inDepMutation: false,
						rewireRunPending: false,
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
				acquisition,
			);
			// Also bind the returned slot if an internal wrapper did not forward the journal.
			acquisition.core = this._core;
			acquisition.slot = created.id;
			this._id = created.id;
			this._slot = this._core.get<T>(this._id);
			this._dep = this._core.getDep(this._id);
			this._value = this._core.getValue<T>(this._id);
			this._wave = this._core.getWave(this._id);
			this._lifecycle = this._core.getLifecycle(this._id);
			this._privateState = this._core.getPrivateState(this._id);
			this._hooks = this._core.getHooks(this._id);
			this._syncCtxState = this._core.getSyncCtx(this._id);
			this._version = this._core.getVersion(this._id);
			Node._retainIndirectRuntimeMethods(this as Node<unknown>);
			issueNodeRegistration(this as Node<unknown>);
			acquisition.node = this as Node<unknown>;
		} catch (cause) {
			if (suppliedAcquisition !== undefined) throw cause; // D161 owner retains this journal.
			failNodeAcquisition(acquisition, cause);
		}
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

	/**
	 * R-subscription: a new sink first receives one array, START followed by the node's snapshot
	 * (the DATA values of the last array it sent that carried any DATA); after that it receives
	 * every array the node sends, each with the kernel's PENDING first (graphrefly-ts:D175).
	 */
	subscribe(sink: Sink): () => void {
		return this._subscribeOwned({ kind: "sink", fn: sink });
	}

	private _subscribeOwned(
		subscriber: Subscriber,
		acquisition?: SubscriptionAcquisition,
	): () => void {
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

			const unsubscribe = () => {
				if (!this._lifecycle.subscribers.delete(subscriber)) return;
				if (this._lifecycle.subscribers.size === 0) this._deactivate();
			};
			// D161: ownership precedes START, the snapshot and dependency activation.
			acquisition?.record(unsubscribe);
			this._lifecycle.subscribers.add(subscriber);
			const start: Message[] = [
				["START"],
				...this._value.lastArray.map((v) => ["DATA", v] as Message),
			];
			if (subscriber.kind === "sink") {
				nodeCallSink(nodeRuntimeHost(this), subscriber, start);
			} else {
				// A new dependent receives the snapshot as one input array, not a live wave.
				const wave = {};
				for (let i = 0; i < start.length; i++)
					subscriber.fn(start[i] as Message, {
						wave,
						last: i === start.length - 1,
						snapshot: true,
					});
			}
			// R-subscription / R-lifetime: subscribing activates an inactive node; the activation's
			// run is a wave of its own after the START array (see the phase 2 report: the reference
			// activates before START, which open question Q-START-ORDER is about).
			if (!this._lifecycle.activated) this._activate();

			return unsubscribe;
		} finally {
			exitWave();
		}
	}

	/**
	 * External emission toward sinks (state-node push, or async late-emit). One call = one wave.
	 * PENDING and RESOLVED are the kernel's and are rejected (R-wave).
	 */
	down(msgs: Wave): void {
		this._assertNotReleased("down");
		validateNodeOutput(msgs);
		// Wave-owner boundary (D47): a state.set / external push that drives a fn issuing
		// ctx.rewireNext drains at this outermost exit.
		enterWave();
		try {
			this._down(msgs);
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
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
	private _subscriberCount(): number {
		return nodeSubscriberCount(nodeRuntimeHost(this));
	}
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
	private _isRuntimeQuiescentForRelease(): boolean {
		return nodeIsRuntimeQuiescentForRelease(nodeRuntimeHost(this));
	}
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
	private _releaseRuntime(): void {
		nodeReleaseRuntime(nodeRuntimeHost(this));
	}
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
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

	private _invalidate(): void {
		nodeInvalidate(nodeRuntimeHost(this));
	}

	private _allDepsTerminal(): boolean {
		return nodeAllDepsTerminal(nodeRuntimeHost(this));
	}

	private _publish(arrays: readonly Message[][]): void {
		nodePublish(nodeRuntimeHost(this), arrays);
	}

	private _markDependents(): void {
		nodeMarkDependents(nodeRuntimeHost(this));
	}

	/** R-terminal: resubscribable reset clears terminal + dep state + re-arms the gate. */
	private _resetLifecycle(): void {
		nodeResetLifecycle(nodeRuntimeHost(this));
	}

	/** Batch commit (R-batch-coalesce): deliver the deferred tier-3 wave now. */
	__markBatchedWave(wave: Wave): void {
		nodeMarkBatchedWave(nodeRuntimeHost(this), wave);
	}

	__commitBatchedWave(wave: Wave): void {
		nodeCommitBatchedWave(nodeRuntimeHost(this), wave);
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

/**
 * @internal A write a function makes to another node is a request that runs after the current
 * wave (R-request-order; graphrefly-ts:D172 request states). Until the general request queue
 * lands, this queues one `down` on the target's boundary queue; outside a wave it runs at once.
 */
export function requestDownAfterWave(target: Node<unknown>, msgs: Wave): void {
	if (!isWaveActive()) {
		target.down(msgs);
		return;
	}
	const host = nodeRuntimeHost(target);
	const array: Wave = [...msgs];
	deferRewire(
		host._core,
		() => {
			if (!host._released) target.down(array);
		},
		{ batchToken: currentBoundaryBatchToken() },
	);
}
