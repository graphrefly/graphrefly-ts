/**
 * The node primitive — the thinnest substrate object (R-node-thin / D5).
 *
 * Holds a fn handle + deps + the wave state machine; ZERO inspection cruft
 * (naming/find/describe are the graph layer, CSP-2). Canonical authority:
 * ~/src/graphrefly/spec/rules.jsonl (R-node, R-wave, R-subscription, R-lifetime, R-invocation,
 * R-terminals, R-invalidation, R-request-order).
 *
 * The kernel puts PENDING at the head of each array that carries a value or a terminal, runs a
 * fan-in (a diamond included) once per wave after every pending dependency has settled, sends one
 * RESOLVED for a pending node that sent nothing, and delivers every DATA unchanged (R-wave / D49:
 * no equals-substitution). A subscriber's first array is START then the snapshot
 * (R-subscription); activation is lazy (R-lifetime).
 */

import { currentBatch, DeferredWrite, request, stageToBatch } from "../batch/batch.js";
import type { NodeFn, Sink } from "../ctx/types.js";
import { defaultDispatcher, type Handle } from "../dispatcher/index.js";
import { EnvironmentDrivers } from "../graph/environment.js";
import { type Message, SENTINEL, type Wave } from "../protocol/messages.js";
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
	type ValueState,
	type WaveState,
} from "./core.js";
import {
	CORE,
	DEP,
	ID,
	LIFECYCLE,
	LIFETIME,
	PRIVATE_STATE,
	RELEASED,
	SEED_NOTE,
	SLOT,
	VALUE,
	WAVE,
} from "./node-keys.js";
import { nodeAssertNotReleased, nodeStatus, nodeSubscribeOwned } from "./node-lifecycle-runtime.js";
import { nodeDown, nodeResolveBatchedWave } from "./node-output-runtime.js";
import {
	constructionAcquisitions,
	failNodeAcquisition,
	type NodeAcquisition,
} from "./owned-acquisition.js";
import { validateNodeOutput } from "./protocol-guards.js";
import {
	issueNodeRegistration,
	runningGraph,
	takeConstructingDispatcher,
	takeConstructingEnvironmentDrivers,
	takeConstructingNodeCore,
	withEnvironmentDrivers,
	withNodeCore,
} from "./runtime-accessors.js";
import type { NodeOptions, Status } from "./types.js";

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
export type { NodeCheckpointState, NodeOptions, NodeSeed, Status } from "./types.js";

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
	// The node's kernel state (review §5.7), keyed by the internal symbols of ./node-keys.ts: the
	// node-*-runtime modules read and write it directly. `private`, so the published declarations
	// show the keys without their types.
	private readonly [CORE]: NodeCore;
	private readonly [ID]: NodeId;
	private readonly [SLOT]: NodeSlot<T>;
	private readonly [DEP]: DepBookkeeping;
	private readonly [VALUE]: ValueState<T>;
	private readonly [WAVE]: WaveState;
	private readonly [LIFECYCLE]: LifecycleState;
	private readonly [PRIVATE_STATE]: PrivateState;
	private readonly [LIFETIME]: LifetimeState;
	private [SEED_NOTE]: unknown = undefined;
	private [RELEASED] = false;

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
			let handle: Handle | null;
			if (handleOrFn === null) handle = null;
			else if (typeof handleOrFn === "function") handle = dispatcher.register(handleOrFn);
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
			this[CORE] = core;
			const created = this[CORE].createSlot<T>(
				{
					deps,
					handle,
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
				},
				acquisition,
			);
			// Also bind the returned slot if an internal wrapper did not forward the journal.
			acquisition.core = this[CORE];
			acquisition.slot = created.id;
			this[ID] = created.id;
			this[SLOT] = this[CORE].get<T>(this[ID]);
			this[DEP] = this[CORE].getDep(this[ID]);
			this[VALUE] = this[CORE].getValue<T>(this[ID]);
			this[WAVE] = this[CORE].getWave(this[ID]);
			this[LIFECYCLE] = this[CORE].getLifecycle(this[ID]);
			this[PRIVATE_STATE] = this[CORE].getPrivateState(this[ID]);
			this[LIFETIME] = this[CORE].getLifetime(this[ID]);
			issueNodeRegistration(this as Node<unknown>);
			acquisition.node = this as Node<unknown>;
		} catch (cause) {
			if (suppliedAcquisition !== undefined) throw cause; // D161 owner retains this journal.
			failNodeAcquisition(acquisition, cause);
		}
	}

	get cache(): T | undefined {
		return this[VALUE].cache;
	}

	/** R-node@2: derived from what the node holds; reading it changes nothing. */
	get status(): Status {
		return nodeStatus(this);
	}

	get name(): string | undefined {
		return this[SLOT].name;
	}

	/** D51: real factory name for a standalone graph-less node (a runtime *Map inner). */
	get factory(): string | undefined {
		return this[SLOT].factory;
	}

	/**
	 * The node's CURRENT/LIVE deps (R-graph-surface / R-edges-derived / D51) — readonly view of the
	 * live `_deps`, which a rewire (C-8 / C-11) mutates. The graph's describe() reads this (NOT a
	 * construction-time snapshot) so every edge corresponds to a real current subscription (D3).
	 * Inspection-only, like cache/status; never triggers computation.
	 */
	get deps(): readonly Node<unknown>[] {
		return this[SLOT].deps;
	}

	/**
	 * The fn handle (pure data: the function's index in the dispatcher's table, D7) or null for state/passthrough
	 * nodes. Inspection-only (L1.6 handle is referenceable/inspectable) — lets the graph
	 * layer key a dispatcher-backed profile recorder WITHOUT putting counters on the node
	 * (R-node-thin / D39).
	 */
	get handle(): Handle | null {
		return this[SLOT].handle;
	}

	/**
	 * R-subscription: a new sink first receives one array, START followed by the node's snapshot
	 * (the DATA values of the last array it sent that carried any DATA); after that it receives
	 * every array the node sends, each with the kernel's PENDING first (graphrefly-ts:D175).
	 */
	subscribe(sink: Sink): () => void {
		nodeAssertNotReleased(this, "subscribe");
		// R-request-order: subscribe and unsubscribe are requests; during a wave they wait for it.
		let stop: (() => void) | undefined;
		let cancelled = false;
		request(this[CORE], () => {
			if (!cancelled) stop = nodeSubscribeOwned(this, { kind: "sink", fn: sink });
		});
		return () => {
			request(this[CORE], () => {
				cancelled = true;
				stop?.();
			});
		};
	}

	/**
	 * External emission toward sinks (state-node push, or async late-emit). One call = one wave.
	 * PENDING and RESOLVED are the kernel's and are rejected (R-wave).
	 */
	/** Host input to a state node (R-request-order); StateNode exposes it as its four inputs. */
	protected _hostInput(msgs: Wave): void {
		nodeAssertNotReleased(this, "down");
		validateNodeOutput(msgs);
		// R-terminals: a host input to an ended node is refused.
		if (this[VALUE].terminal !== undefined)
			throw new Error("down: this node has ended (R-terminals)");
		if (currentBatch(this[CORE])) {
			nodeDown(this, msgs);
			return;
		}
		// R-request-order: during a wave a host input waits for it, so no function is reentered.
		request(this[CORE], () => {
			// Checked again: a queued input may find its node ended by an earlier request.
			if (this[VALUE].terminal !== undefined)
				throw new Error("down: this node has ended (R-terminals)");
			nodeDown(this, msgs);
		});
	}

	/**
	 * R-request-order: write through a function of the current value. It runs when the write takes
	 * its place in request order (in a batch, at the commit); a result equal to its argument
	 * (Object.is) writes nothing.
	 */
	protected _writeFn(fn: (prev: T | undefined) => T): void {
		nodeAssertNotReleased(this, "set");
		if (this[VALUE].terminal !== undefined)
			throw new Error("set: this node has ended (R-terminals)");
		const deferred = new DeferredWrite(fn as (prev: unknown) => unknown);
		if (currentBatch(this[CORE])) {
			stageToBatch(
				this[CORE],
				this as unknown as Node<unknown>,
				[["DATA", deferred] as Message],
				"set",
			);
			return;
		}
		request(this[CORE], () => {
			if (this[VALUE].terminal !== undefined)
				throw new Error("set: this node has ended (R-terminals)");
			const resolved = nodeResolveBatchedWave(this, [["DATA", deferred]]);
			if (resolved.length > 0) nodeDown(this, resolved);
		});
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
	return withEnvironmentDrivers(beside[SLOT].environment, () =>
		withNodeCore(beside[CORE], create, beside[SLOT].dispatcher),
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
	for (const d of deps)
		if (d[CORE] !== first[CORE])
			throw new Error("node: dependencies belong to different graphs; use a wire bridge");
	return withEnvironmentDrivers(first[SLOT].environment, () =>
		withNodeCore(first[CORE], () => new Node<T>(deps, fn, opts), first[SLOT].dispatcher),
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
