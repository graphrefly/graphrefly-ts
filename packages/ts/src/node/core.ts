import { makeWaveDomain, type WaveDomain } from "../batch/boundary.js";
import type { Ctx, DependentSink, NodeFn, Sink } from "../ctx/types.js";
import type { Dispatcher, Handle } from "../dispatcher/index.js";
import type { EnvironmentDrivers } from "../graph/environment.js";
import type { Wave } from "../protocol/messages.js";
import { SENTINEL } from "../protocol/messages.js";
import type { Node } from "./node.js";
import type { NodeAcquisition } from "./owned-acquisition.js";

export type NodeId = number & { readonly __nodeId: unique symbol };

/**
 * One dependency's input record. Created only by `makeDepInput`, with every field set, so every
 * record has one shape. The record is also the dependency subscription's index box: its delivery
 * callback reads `idx`, which a rewire points at the dependency's new position and sets to -1 when
 * the dependency is removed (a stale in-flight callback then drops).
 */
export interface DepInput {
	/** The dependency's position in the node's current dependencies; -1 once it has been removed. */
	idx: number;
	/** The input arrays of the current run, each an array of its DATA values. */
	waveData: unknown[][];
	/** For each array in `waveData`, whether it came live, not as a snapshot. */
	waveLive: boolean[];
	prev: unknown;
	hasData: boolean;
	dirty: boolean;
	terminal: true | unknown | undefined;
	terminalInput: true | unknown | undefined;
	/** Under the manual INVALIDATE policy: an INVALIDATE arrived on this input in this run. */
	invalidated: boolean;
	/** The release of the dependency subscription while the node is active. */
	unsub: (() => void) | undefined;
}

export interface DepBookkeeping {
	/** One record per dependency, in the order of the node's current dependencies. */
	inputs: DepInput[];
}

export interface ValueState<T> {
	cache: T | undefined;
	hasData: boolean;
	terminal: true | unknown | undefined;
	/** R-subscription: the DATA values of the last array this node sent that carried any DATA. */
	lastArray: T[];
}

export interface WaveState {
	pending: number;
	emittedDirtyThisWave: boolean;
	emittedSettleThisWave: boolean;
	insideRunWave: boolean;
	/** The arrays the running function sent; published after it returns (R-wave). */
	runOutput: Wave[];
	inDepMutation: boolean;
	/** R-lifetime: dependencies are being acquired; the first run waits for all their snapshots. */
	activating: boolean;
	rewireRunPending: boolean;
}

export interface PrivateState {
	value: unknown;
}

/**
 * R-lifetime: what the current lifetime of a computed node holds. A lifetime opens at the first
 * run after activation and closes at deactivation or when the node ends.
 */
export interface LifetimeState {
	/** The lifetime's cleanup is running (status lifecycle "closing"). */
	closing: boolean;
	/** The signal of the lifetime whose cleanup is running; its ctx may still read its state. */
	closingSignal: AbortSignal | null;
	/** The lifetime's abort controller (ctx.signal); null while no lifetime is open. */
	controller: AbortController | null;
	/** The cleanup the node's setup returned for this lifetime. */
	cleanup: (() => void) | undefined;
	/** The setup has run in this lifetime. */
	setupDone: boolean;
}

/** A subscriber: an external sink gets each array, a dependent each delivery's arrays at once. */
export type Subscriber =
	| { readonly kind: "sink"; readonly fn: Sink }
	| { readonly kind: "dependent"; readonly fn: DependentSink };

export interface LifecycleState {
	/** Subscribers in subscription order: external sinks and dependent nodes. */
	subscribers: Set<Subscriber>;
	activated: boolean;
}

export interface NodeSlot<_T> {
	/** R-node: the instance's declared dependencies; a lifetime's rewire goes back to them. */
	declaredDeps: Node<unknown>[];
	/** R-node: the current instance's function and recipe, read by definition(). */
	fn: NodeFn | null;
	recipe: unknown;
	id: NodeId;
	deps: Node<unknown>[];
	handle: Handle | null;
	dispatcher: Dispatcher;
	environment: EnvironmentDrivers;
	completePolicy: "auto" | "manual";
	errorPolicy: "auto" | "manual";
	invalidatePolicy: "auto" | "manual";
	quiet: boolean;
	/** R-lifetime: runs once per lifetime, before its first run; may return the lifetime's cleanup. */
	// biome-ignore lint/suspicious/noConfusingVoidType: setup may return no cleanup.
	setup: ((ctx: Ctx) => (() => void) | void) | undefined;
	name?: string;
	factory?: string;
}

export interface NodeState<T> {
	dep: DepBookkeeping;
	lifecycle: LifecycleState;
	value: ValueState<T>;
	wave: WaveState;
	privateState: PrivateState;
	lifetime: LifetimeState;
}

export class NodeCore {
	/** R-failure@3: the owning graph's host reporter, if any. */
	report: ((failure: { readonly source: string; readonly error: unknown }) => void) | undefined;
	private nextId = 0;
	private readonly slots: Array<NodeSlot<unknown> | undefined> = [];
	private readonly values: Array<ValueState<unknown> | undefined> = [];
	private readonly waves: Array<WaveState | undefined> = [];
	private readonly lifecycles: Array<LifecycleState | undefined> = [];
	private readonly depStates: Array<DepBookkeeping | undefined> = [];
	private readonly privateStates: Array<PrivateState | undefined> = [];
	private readonly lifetimes: Array<LifetimeState | undefined> = [];
	/** R-graph-domain@3: this graph's own wave, request queue and batch. */
	readonly domain: WaveDomain = makeWaveDomain();

	createSlot<T>(
		slot: Omit<NodeSlot<T>, "id">,
		state: NodeState<T>,
		acquisition?: NodeAcquisition,
	): { id: NodeId; slot: NodeSlot<T> } {
		const id = this.nextId++ as NodeId;
		if (acquisition !== undefined) {
			acquisition.core = this;
			acquisition.slot = id;
		}
		const full = { ...slot, id };
		this.slots[id] = full as NodeSlot<unknown>;
		this.depStates[id] = state.dep;
		this.lifecycles[id] = state.lifecycle;
		this.values[id] = state.value as ValueState<unknown>;
		this.waves[id] = state.wave;
		this.privateStates[id] = state.privateState;
		this.lifetimes[id] = state.lifetime;
		return { id, slot: full };
	}

	get<T>(id: NodeId): NodeSlot<T> {
		const slot = this.slots[id];
		if (slot === undefined) throw new Error("NodeCore: unknown node slot");
		return slot as NodeSlot<T>;
	}

	getValue<T>(id: NodeId): ValueState<T> {
		const value = this.values[id];
		if (value === undefined) throw new Error("NodeCore: unknown node value state");
		return value as ValueState<T>;
	}

	getWave(id: NodeId): WaveState {
		const wave = this.waves[id];
		if (wave === undefined) throw new Error("NodeCore: unknown node wave state");
		return wave;
	}

	getLifecycle(id: NodeId): LifecycleState {
		const lifecycle = this.lifecycles[id];
		if (lifecycle === undefined) throw new Error("NodeCore: unknown node lifecycle state");
		return lifecycle;
	}

	getDep(id: NodeId): DepBookkeeping {
		const dep = this.depStates[id];
		if (dep === undefined) throw new Error("NodeCore: unknown node dep state");
		return dep;
	}

	getPrivateState(id: NodeId): PrivateState {
		const state = this.privateStates[id];
		if (state === undefined) throw new Error("NodeCore: unknown node private state");
		return state;
	}

	getLifetime(id: NodeId): LifetimeState {
		const lifetime = this.lifetimes[id];
		if (lifetime === undefined) throw new Error("NodeCore: unknown node lifetime");
		return lifetime;
	}

	/** @internal D122: release graph-owned ephemeral node runtime state from core retention. */
	releaseSlot(id: NodeId): void {
		this.slots[id] = undefined;
		this.depStates[id] = undefined;
		this.lifecycles[id] = undefined;
		this.values[id] = undefined;
		this.waves[id] = undefined;
		this.privateStates[id] = undefined;
		this.lifetimes[id] = undefined;
	}
}

export function makeDepInput(idx: number): DepInput {
	return {
		idx,
		waveData: [],
		waveLive: [],
		prev: SENTINEL,
		hasData: false,
		dirty: false,
		terminal: undefined,
		terminalInput: undefined,
		invalidated: false,
		unsub: undefined,
	};
}

export function makeDepBookkeeping(depCount: number): DepBookkeeping {
	const inputs: DepInput[] = [];
	for (let i = 0; i < depCount; i++) inputs.push(makeDepInput(i));
	return { inputs };
}
