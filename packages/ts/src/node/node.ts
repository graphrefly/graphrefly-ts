/**
 * The node primitive — the thinnest substrate object (R-node-thin / D5).
 *
 * Holds a fn handle + deps + the wave state machine; ZERO inspection cruft
 * (naming/find/describe are the graph layer, CSP-2). Canonical authority:
 * ~/src/graphrefly/spec/rules.jsonl (R-node-*, R-two-phase, R-diamond, R-resolved-undirty,
 * R-push-subscribe, R-rom-ram, R-fn-contract, R-initial, R-ctx-up).
 *
 * Slice 1 = core wave: state node, compute node, two-phase PENDING->DATA, diamond
 * pending-counter join, substrate-synthesized undirty RESOLVED
 * (R-resolved-undirty / D49 — no equals-substitution; every occurrence is DATA),
 * push-on-subscribe, lazy activation, ROM/RAM. Lifecycle (terminal/INVALIDATE/cleanup),
 * control (async), batch, and dynamicNode land in later slices.
 */

import {
	type BatchTarget,
	currentBatch,
	DeferredWrite,
	deferToBatch,
	request,
	stagedBatchWave,
} from "../batch/batch.js";
import type { Ctx, CtxState, DeliveryMeta, NodeFn, Sink } from "../ctx/types.js";
import { defaultDispatcher, type Handle } from "../dispatcher/index.js";
import { EnvironmentDrivers } from "../graph/environment.js";
import { isTerminal, type Message, SENTINEL, type Wave } from "../protocol/messages.js";
import {
	type DepBookkeeping,
	type LifecycleState,
	type LifetimeState,
	makeDepBookkeeping,
	type NodeCore,
	type NodeId,
	type NodeSlot,
	type PrivateState,
	type Subscriber,
	type SyncCtxState,
	type ValueState,
	type WaveState,
} from "./core.js";
import {
	nodeBuildCtx,
	nodeMakeCtx,
	nodeMakeState,
	nodeRefreshCtx,
} from "./node-context-runtime.js";
import {
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
	nodeSubscribeOwned,
	nodeSubscriberCount,
	setPlainSubscribeOwned,
} from "./node-lifecycle-runtime.js";
import {
	nodeDown,
	nodeMarkDependents,
	nodePublish,
	nodeResolveBatchedWave,
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
	runningGraph,
	takeConstructingDispatcher,
	takeConstructingEnvironmentDrivers,
	takeConstructingNodeCore,
	withEnvironmentDrivers,
	withNodeCore,
} from "./runtime-accessors.js";
import type { NodeOptions, NodeReceived, NodeSeed, Status } from "./types.js";

export {
	checkpointStateOfNode,
	getNodeOwner,
	isNodeActiveForRelease,
	isNodeRuntimeQuiescentForRelease,
	isNodeRuntimeReleased,
	releaseRuntimeOfNode,
	restoreStateOfNode,
	setGraphNodeIdResolver,
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
 * import { graph } from "@graphrefly/ts/graph";
 *
 * const source = graph().state<number>(0);
 * source.subscribe((msgs) => console.log(msgs));
 * source.set(1);
 * ```
 * @remarks **Built by a graph:** every node belongs to one graph's domain (R-graph-domain@3); build
 *   it with `graph().node`, `graph().state` or `graph().derived`. There is no standalone node.
 * @category core
 */
/** R-graph-surface@1: describe lists nodes in creation order; this is each node's place in it. */
const creationOrder = new WeakMap<Node<unknown>, number>();
let nextCreation = 0;

/** @internal A node's place in creation order (R-graph-surface@1). */
export function nodeCreationIndex(node: Node<unknown>): number {
	return creationOrder.get(node) ?? Number.MAX_SAFE_INTEGER;
}

export class Node<T = unknown> {
	private readonly _core: NodeCore;
	private readonly _id: NodeId;
	private readonly _slot: NodeSlot<T>;
	private readonly _dep: DepBookkeeping;
	private readonly _value: ValueState<T>;
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
	private readonly _wave: WaveState;
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
	private readonly _lifecycle: LifecycleState;
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: used by the issued runtime host.
	private readonly _privateState: PrivateState;
	private readonly _lifetime: LifetimeState;
	private readonly _syncCtxState: SyncCtxState;
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

	static {
		// graphrefly-ts Q15: the activation loop subscribes a dependency on its own stack when the
		// dependency's subscription method is this one, and through the method otherwise.
		setPlainSubscribeOwned(Node.prototype._subscribeOwned);
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
		creationOrder.set(this as Node<unknown>, nextCreation++);
		// R-node: a node with dependencies is a computed node and has a function; a node without
		// one is a state and has no dependencies.
		if (handleOrFn === null && deps.length > 0)
			throw new TypeError("node: a node with dependencies needs a function (R-node)");
		const suppliedAcquisition = constructionAcquisitions.get(opts);
		const acquisition: NodeAcquisition = suppliedAcquisition ?? { name: "bare node" };
		constructionAcquisitions.delete(opts);
		const staged = takeConstructingNodeCore();
		const stagedDispatcher = takeConstructingDispatcher();
		const stagedEnvironment = takeConstructingEnvironmentDrivers();
		// D179: with no graph staged, a node built during a run belongs to the running graph.
		const running = staged === undefined ? runningGraph() : undefined;
		const core = staged ?? running?.core;
		const dispatcher =
			opts.dispatcher ?? stagedDispatcher ?? running?.dispatcher ?? defaultDispatcher;
		const environment = stagedEnvironment ?? running?.environment ?? EnvironmentDrivers.empty();
		try {
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
			// R-graph-domain@3: a node belongs to one graph's domain; there is no standalone node.
			if (core === undefined)
				throw new Error("node: a node is built by a graph (graph.node, graph.state, ...)");
			this._core = core;
			const created = this._core.createSlot<T>(
				{
					deps,
					handle,
					pool,
					dispatcher,
					environment,
					completePolicy: opts.complete ?? "auto",
					errorPolicy: opts.error ?? "auto",
					invalidatePolicy: opts.invalidate ?? "auto",
					quiet: opts.quiet ?? false,
					setup: opts.setup,
					declaredDeps: deps,
					fn: typeof handleOrFn === "function" ? handleOrFn : null,
					recipe: opts.recipe,
					name: opts.name,
					factory: opts.factory,
				},
				{
					dep,
					lifecycle: { subscribers: new Set<Subscriber>(), activated: false },
					value,
					wave: {
						pending: 0,
						emittedDirtyThisWave: false,
						emittedSettleThisWave: false,
						insideRunWave: false,
						runOutput: [],
						inDepMutation: false,
						activating: false,
						rewireRunPending: false,
					},
					privateState: { value: SENTINEL },
					lifetime: {
						controller: null,
						cleanup: undefined,
						setupDone: false,
						closing: false,
						closingSignal: null,
					},
					syncCtx: { value: null },
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

	get name(): string | undefined {
		return this._slot.name;
	}

	/** D51: real factory name for a standalone graph-less node (a runtime *Map inner). */
	get factory(): string | undefined {
		return this._slot.factory;
	}

	/**
	 * The node's CURRENT/LIVE deps (R-graph-surface / R-edges-derived / D51) — readonly view of the
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
		// graphrefly-ts Q15: activation runs on an explicit stack (nodeSubscribeOwned), so a chain of
		// any depth subscribes without JS recursion.
		return nodeSubscribeOwned(nodeRuntimeHost(this), subscriber, acquisition);
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
		if (currentBatch(this._core)) {
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
		if (currentBatch(this._core)) {
			const staged = stagedBatchWave(this._core, this as unknown as Node<unknown>);
			if (staged?.some((m) => isTerminal(m[0])))
				throw new Error("set: a terminal must be the last message of its array (R-wave)");
			deferToBatch(this._core, this as unknown as Node<unknown>, [
				...(staged ?? []),
				["DATA", deferred] as Message,
			]);
			return;
		}
		request(this._core, () => {
			if (this._value.terminal !== undefined)
				throw new Error("set: this node has ended (R-terminals)");
			const resolved = nodeResolveBatchedWave(nodeRuntimeHost(this), [["DATA", deferred]]);
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

	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
	private _activate(): void {
		nodeActivate(nodeRuntimeHost(this));
	}

	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
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
		has: boolean[];
	}): Ctx {
		return nodeMakeCtx(nodeRuntimeHost(this), snapshot);
	}

	private _refreshCtx(ctx: Ctx): void {
		nodeRefreshCtx(nodeRuntimeHost(this), ctx);
	}

	private _makeState(signal: AbortSignal): CtxState {
		return nodeMakeState(nodeRuntimeHost(this), signal);
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
 * Internal: build nodes in the graph of `beside` (R-graph-domain@3), for helpers that take a node
 * and open helper nodes of their own (a timer beside its source). One node per call.
 */
export function buildBeside<N extends Node<unknown>>(beside: Node<unknown>, create: () => N): N {
	const host = nodeRuntimeHost(beside);
	return withEnvironmentDrivers(host._slot.environment, () =>
		withNodeCore(host._core, create, host._slot.dispatcher),
	);
}

/**
 * Internal: a derived node built in its dependencies' graph (R-graph-domain@3), for views a
 * structure creates on first use. Every dependency must belong to the same graph.
 */
export function makeNodeBeside<T>(
	deps: Node<unknown>[],
	fn: NodeFn,
	opts: NodeOptions<T>,
): Node<T> {
	const first = deps[0];
	if (first === undefined) throw new Error("node: a derived view needs a dependency");
	const host = nodeRuntimeHost(first);
	for (const d of deps)
		if (nodeRuntimeHost(d)._core !== host._core)
			throw new Error("node: dependencies belong to different graphs; use a wire bridge");
	return withEnvironmentDrivers(host._slot.environment, () =>
		withNodeCore(host._core, () => new Node<T>(deps, fn, opts), host._slot.dispatcher),
	);
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
