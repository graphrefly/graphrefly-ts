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

import {
	type BatchTarget,
	currentBatch,
	currentBoundaryBatchToken,
	DeferredWrite,
	deferToBatch,
	request,
	stagedBatchWave,
} from "../batch/batch.js";
import { deferRewire, enterWave, exitWave, isWaveActive } from "../batch/boundary.js";
import type { Ctx, CtxState, DeliveryMeta, NodeFn, Sink } from "../ctx/types.js";
import { defaultDispatcher, type Handle } from "../dispatcher/index.js";
import { EnvironmentDrivers } from "../graph/environment.js";
import { isTerminal, type Message, SENTINEL, type Wave } from "../protocol/messages.js";
import {
	type DepBookkeeping,
	type LifecycleState,
	type LifetimeState,
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
	nodeMarkDirty,
	nodeMaybeRun,
	nodeReceiveFromDep,
	nodeRecordDepProjection,
	nodeSettle,
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
	nodeStatus,
	nodeSubscribeDepAt,
	nodeSubscriberCount,
} from "./node-lifecycle-runtime.js";
import {
	nodeCallSink,
	nodeCommitBatchedWave,
	nodeDeferBoundary,
	nodeDown,
	nodeMarkBatchedWave,
	nodeMarkDependents,
	nodePublish,
} from "./node-output-runtime.js";
import { nodeRewire } from "./node-rewire-runtime.js";
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
import type { NodeOptions, NodeReceived, NodeSeed, Status } from "./types.js";
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
	private readonly _lifetime: LifetimeState;
	private readonly _syncCtxState: SyncCtxState;
	private readonly _version: VersionState;
	private _seed: NodeSeed | undefined = undefined;
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
		void node._lifetime;
		void node._seed;
		void node._reachableUpstream;
		void node._assertRewireDepOwner;
		void node._subscribeDepAt;
		void node._seedRestoredDepAt;
		void node._recordDepProjection;
		void node._receiveFromDep;
		void node._markDirty;
		void node._maybeRun;
		void node._settleRewire;
		void node._tryRun;
		void node._allDepsSettled;
		void node._runWave;
		void node._buildCtx;
		void node._makeCtx;
		void node._refreshCtx;
		void node._makeState;
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
				terminal: undefined,
				lastArray: [] as T[],
			};
			if (opts.initial !== undefined) {
				value.cache = opts.initial as T;
				value.lastArray = [opts.initial as T];
				value.hasData = true;
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
					completePolicy: opts.complete ?? "auto",
					errorPolicy: opts.error ?? "auto",
					invalidatePolicy: opts.invalidate ?? "auto",
					quiet: opts.quiet ?? false,
					setup: opts.setup,
					declaredDeps: deps,
					fn: typeof handleOrFn === "function" ? handleOrFn : null,
					recipe: opts.recipe,
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
						activating: false,
						rewireRunPending: false,
					},
					privateState: { value: SENTINEL },
					lifetime: { controller: null, cleanup: undefined, setupDone: false, closing: false },
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
			this._lifetime = this._core.getLifetime(this._id);
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

	/** R-node@2: derived from what the node holds; reading it changes nothing. */
	get status(): Status {
		return nodeStatus(nodeRuntimeHost(this));
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
		this._assertNotReleased("subscribe");
		// R-request-order: subscribe and unsubscribe are requests; during a wave they wait for it.
		let stop: (() => void) | undefined;
		let cancelled = false;
		request(this._core, () => {
			if (!cancelled) stop = this._subscribeOwned({ kind: "sink", fn: sink });
		});
		return () => {
			request(this._core, () => {
				cancelled = true;
				stop?.();
			});
		};
	}

	private _subscribeOwned(
		subscriber: Subscriber,
		acquisition?: SubscriptionAcquisition,
	): () => void {
		this._assertNotReleased("subscribe");
		// Wave-owner boundary (R-rewire-deferred / D47): the activation cascade can run fns that
		// issue ctx.rewire; the OUTERMOST exit drains them. Nested subscribes (dep wiring)
		// just inc/dec the depth.
		enterWave();
		try {
			let left = false;
			const unsubscribe = () => {
				if (left) return;
				left = true;
				this._lifecycle.subscribers.delete(subscriber);
				if (this._lifecycle.subscribers.size === 0) this._deactivate();
			};
			// D161: ownership precedes dependency activation, START and the snapshot.
			acquisition?.record(unsubscribe);
			// R-subscription / R-lifetime: subscribing activates an inactive node first, so the first
			// array is START plus the snapshot as the activation left it; arrays the activation sent
			// before this subscriber joined are not delivered to it separately. An ended node's
			// function never runs again.
			if (!this._lifecycle.activated && this._value.terminal === undefined) this._activate();
			this._lifecycle.subscribers.add(subscriber);
			const terminal = this._value.terminal;
			const start: Message[] = [
				["START"],
				...this._value.lastArray.map((v) => ["DATA", v] as Message),
				...(terminal === undefined
					? []
					: [(terminal === true ? ["COMPLETE"] : ["ERROR", terminal]) as Message]),
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

			return unsubscribe;
		} finally {
			exitWave();
		}
	}

	/**
	 * External emission toward sinks (state-node push, or async late-emit). One call = one wave.
	 * PENDING and RESOLVED are the kernel's and are rejected (R-wave).
	 */
	/** Host input to a state node (R-request-order); StateNode exposes it as its four inputs. */
	protected _hostInput(msgs: Wave): void {
		this._assertNotReleased("down");
		validateNodeOutput(msgs);
		// R-terminals: a host input to an ended node is refused.
		if (this._value.terminal !== undefined)
			throw new Error("down: this node has ended (R-terminals)");
		if (currentBatch()) {
			this._down(msgs);
			return;
		}
		// R-request-order: during a wave a host input waits for it, so no function is reentered.
		request(this._core, () => {
			// Checked again: a queued input may find its node ended by an earlier request.
			if (this._value.terminal !== undefined)
				throw new Error("down: this node has ended (R-terminals)");
			this._down(msgs);
		});
	}

	/**
	 * R-request-order: write through a function of the current value. It runs when the write takes
	 * its place in request order (in a batch, at the commit); a result equal to its argument
	 * (Object.is) writes nothing.
	 */
	protected _writeFn(fn: (prev: T | undefined) => T): void {
		this._assertNotReleased("set");
		if (this._value.terminal !== undefined)
			throw new Error("set: this node has ended (R-terminals)");
		const deferred = new DeferredWrite(fn as (prev: unknown) => unknown);
		if (currentBatch()) {
			const staged = stagedBatchWave(this as unknown as BatchTarget);
			if (staged?.some((m) => isTerminal(m[0])))
				throw new Error("set: a terminal must be the last message of its array (R-wave)");
			deferToBatch(this as unknown as BatchTarget, [
				...(staged ?? []),
				["DATA", deferred] as Message,
			]);
			return;
		}
		request(this._core, () => {
			if (this._value.terminal !== undefined)
				throw new Error("set: this node has ended (R-terminals)");
			const resolved = this.__resolveBatchedWave([["DATA", deferred]]);
			if (resolved.length > 0) this._down(resolved);
		});
	}

	// ── rewire (R-rewire / D42): intra-graph runtime topology mutation ──

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
			// R-request-order: through current and declared dependencies, since a closing lifetime
			// puts the declared ones back.
			const slot = nodeRuntimeHost(n)._slot;
			for (const d of slot.deps) stack.push(d);
			for (const d of slot.declaredDeps) stack.push(d);
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
		fn?: NodeFn,
		opts: { declare?: boolean } = {},
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

	private _subscribeDepAt(
		depNode: Node<unknown>,
		seed?: { readonly received: NodeReceived | undefined; readonly onChange: () => void },
	): void {
		nodeSubscribeDepAt(nodeRuntimeHost(this), depNode, seed);
	}

	private _seedRestoredDepAt(idx: number, depNode: Node<unknown>): void {
		nodeSeedRestoredDepAt(nodeRuntimeHost(this), idx, depNode);
	}

	private _recordDepProjection(idx: number, delivery: DeliveryMeta | undefined): unknown[] {
		return nodeRecordDepProjection(nodeRuntimeHost(this), idx, delivery);
	}

	private _receiveFromDep(idx: number, msg: Message, delivery?: DeliveryMeta): void {
		nodeReceiveFromDep(nodeRuntimeHost(this), idx, msg, delivery);
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

	/** Settle now, running the function (activation's first run of a depless producer). */
	private _runWave(): void {
		nodeSettle(nodeRuntimeHost(this), true);
	}

	private _buildCtx(): Ctx {
		return nodeBuildCtx(nodeRuntimeHost(this));
	}

	private _makeCtx(snapshot?: {
		waveData: unknown[][][];
		waveLive?: boolean[][];
		terminal: unknown[];
		invalidated?: boolean[];
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

	private _publish(arrays: readonly Message[][]): void {
		nodePublish(nodeRuntimeHost(this), arrays);
	}

	private _markDependents(): void {
		nodeMarkDependents(nodeRuntimeHost(this));
	}

	/** Batch commit (R-batch-coalesce): deliver the deferred tier-3 wave now. */
	__markBatchedWave(wave: Wave): void {
		nodeMarkBatchedWave(nodeRuntimeHost(this), wave);
	}

	__resolveBatchedWave(wave: Wave): Wave {
		let current: unknown = this._value.hasData ? this._value.cache : undefined;
		const out: Message[] = [];
		for (const m of wave) {
			if (m[0] === "INVALIDATE") current = undefined;
			if (m[0] !== "DATA") {
				out.push(m);
				continue;
			}
			if (!(m[1] instanceof DeferredWrite)) {
				current = m[1];
				out.push(m);
				continue;
			}
			const next = m[1].fn(current);
			if (Object.is(next, current)) continue;
			current = next;
			out.push(["DATA", next]);
		}
		return out;
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
	deps?: readonly [],
	handleOrFn?: null,
	opts?: NodeOptions<T>,
): StateNode<T>;
export function node<T = unknown>(
	deps?: Node<unknown>[],
	handleOrFn?: Handle | NodeFn | null,
	opts?: NodeOptions<T>,
): Node<T>;
export function node<T = unknown>(
	deps: readonly Node<unknown>[] = [],
	handleOrFn: Handle | NodeFn | null = null,
	opts: NodeOptions<T> = {},
): Node<T> {
	return makeNode<T>([...deps], handleOrFn, opts);
}

/**
 * Internal: a node with no dependencies and no function is a state node, the only node with host
 * inputs (R-node, graphrefly-ts:D175).
 */
export function makeNode<T>(
	deps: Node<unknown>[],
	handleOrFn: Handle | NodeFn | null,
	opts: NodeOptions<T>,
): Node<T> {
	return deps.length === 0 && handleOrFn === null
		? new StateNode<T>(deps, null, opts)
		: new Node<T>(deps, handleOrFn, opts);
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
 * A state node (R-node): a node with no dependencies and no function. Its host inputs are
 * `set`, `invalidate`, `complete` and `error` (graphrefly-ts:D175); a plain Node has none.
 *
 * @example
 * ```ts
 * import { graph } from "@graphrefly/ts/graph";
 *
 * const count = graph().state(0);
 * count.set(1);
 * ```
 * @category graph
 */
export class StateNode<T> extends Node<T> {
	/**
	 * Host input (R-request-order): write a value; one write is one wave (in a batch, one array).
	 * Given a function, computes the value from the current one when the write runs in request
	 * order, and a function that returns its argument (Object.is) writes nothing. To write a
	 * function as a value, wrap it: `set(() => fn)`.
	 */
	set(v: T | ((prev: T | undefined) => T)): void {
		if (typeof v === "function") this._writeFn(v as (prev: T | undefined) => T);
		else this._hostInput([["DATA", v]]);
	}

	/** Host input (R-invalidation): drop the retained value; effective only while one is held. */
	invalidate(): void {
		this._hostInput([["INVALIDATE"]]);
	}

	/** Host input (R-terminals): end this state with COMPLETE. */
	complete(): void {
		this._hostInput([["COMPLETE"]]);
	}

	/** Host input (R-terminals): end this state with ERROR carrying `error`. */
	error(error: unknown): void {
		this._hostInput([["ERROR", error]]);
	}
}
