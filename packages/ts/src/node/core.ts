import type { Ctx, Sink } from "../ctx/types.js";
import type { Dispatcher, Handle } from "../dispatcher/index.js";
import { type LockId, SENTINEL, type Wave } from "../protocol/messages.js";
import type { Node, Status } from "./node.js";

export type NodeId = number & { readonly __nodeId: unique symbol };

export interface DepBookkeeping {
	batch: Array<unknown[] | null>;
	waveData: unknown[][][];
	waveTokens: Array<object | undefined>;
	prev: unknown[];
	hasData: boolean[];
	dirty: boolean[];
	tier: number[];
	terminal: Array<true | unknown | undefined>;
	terminalInput: Array<true | unknown | undefined>;
	unsubs: Array<() => void>;
	idxBoxes: Array<{ v: number }>;
}

export interface ValueState<T> {
	cache: T | undefined;
	hasData: boolean;
	status: Status;
	terminal: true | unknown | undefined;
	hasTorndown: boolean;
	replayRing: T[];
}

export interface WaveState {
	pending: number;
	hasCalledFnOnce: boolean;
	emittedDirtyThisWave: boolean;
	emittedSettleThisWave: boolean;
	insideRunWave: boolean;
	inDepMutation: boolean;
	rewireRunPending: boolean;
	batchDirtyOwed: boolean;
}

export interface ControlState {
	pauseLockset: Set<unknown>;
	pausedDepWaveOccurred: boolean;
	pauseBuffer: Wave[];
	demandOwed: boolean;
	inDeliverDemand: boolean;
}

export interface PrivateState {
	value: unknown;
	persist: boolean;
}

export interface CleanupHooks {
	onDeactivation: Array<() => void>;
	onInvalidate: Array<() => void>;
}

export interface SyncCtxState {
	value: Ctx | null;
}

export interface LifecycleState {
	subscribers: Set<Sink>;
	activated: boolean;
}

export type BoundaryTask = () => void;

export interface BoundaryState {
	queue: BoundaryTask[];
	head: number;
}

export interface NodeSlot<_T> {
	id: NodeId;
	deps: Node<unknown>[];
	handle: Handle | null;
	pool: "sync" | "async";
	dispatcher: Dispatcher;
	partial: boolean;
	terminalAsRealInput: boolean;
	completeWhenDepsComplete: boolean;
	errorWhenDepsError: boolean;
	resubscribable: boolean;
	resetOnTeardown: boolean;
	pausable: boolean | "resumeAll";
	pull: boolean;
	pullLock: LockId | undefined;
	replayN: number;
	dynamic: boolean;
	name?: string;
	factory?: string;
}

export interface NodeState<T> {
	dep: DepBookkeeping;
	lifecycle: LifecycleState;
	value: ValueState<T>;
	wave: WaveState;
	control: ControlState;
	privateState: PrivateState;
	hooks: CleanupHooks;
	syncCtx: SyncCtxState;
}

export class NodeCore {
	private nextId = 0;
	private readonly slots = new Map<NodeId, NodeSlot<unknown>>();
	private readonly values = new Map<NodeId, ValueState<unknown>>();
	private readonly waves = new Map<NodeId, WaveState>();
	private readonly controls = new Map<NodeId, ControlState>();
	private readonly lifecycles = new Map<NodeId, LifecycleState>();
	private readonly depStates = new Map<NodeId, DepBookkeeping>();
	private readonly privateStates = new Map<NodeId, PrivateState>();
	private readonly hooks = new Map<NodeId, CleanupHooks>();
	private readonly syncCtxs = new Map<NodeId, SyncCtxState>();
	private readonly boundary: BoundaryState = { queue: [], head: 0 };

	createSlot<T>(
		slot: Omit<NodeSlot<T>, "id">,
		state: NodeState<T>,
	): { id: NodeId; slot: NodeSlot<T> } {
		const id = this.nextId++ as NodeId;
		const full = { ...slot, id };
		this.slots.set(id, full as NodeSlot<unknown>);
		this.depStates.set(id, state.dep);
		this.lifecycles.set(id, state.lifecycle);
		this.values.set(id, state.value as ValueState<unknown>);
		this.waves.set(id, state.wave);
		this.controls.set(id, state.control);
		this.privateStates.set(id, state.privateState);
		this.hooks.set(id, state.hooks);
		this.syncCtxs.set(id, state.syncCtx);
		return { id, slot: full };
	}

	get<T>(id: NodeId): NodeSlot<T> {
		const slot = this.slots.get(id);
		if (slot === undefined) throw new Error("NodeCore: unknown node slot");
		return slot as NodeSlot<T>;
	}

	getValue<T>(id: NodeId): ValueState<T> {
		const value = this.values.get(id);
		if (value === undefined) throw new Error("NodeCore: unknown node value state");
		return value as ValueState<T>;
	}

	getWave(id: NodeId): WaveState {
		const wave = this.waves.get(id);
		if (wave === undefined) throw new Error("NodeCore: unknown node wave state");
		return wave;
	}

	getControl(id: NodeId): ControlState {
		const control = this.controls.get(id);
		if (control === undefined) throw new Error("NodeCore: unknown node control state");
		return control;
	}

	getLifecycle(id: NodeId): LifecycleState {
		const lifecycle = this.lifecycles.get(id);
		if (lifecycle === undefined) throw new Error("NodeCore: unknown node lifecycle state");
		return lifecycle;
	}

	getDep(id: NodeId): DepBookkeeping {
		const dep = this.depStates.get(id);
		if (dep === undefined) throw new Error("NodeCore: unknown node dep state");
		return dep;
	}

	getPrivateState(id: NodeId): PrivateState {
		const state = this.privateStates.get(id);
		if (state === undefined) throw new Error("NodeCore: unknown node private state");
		return state;
	}

	getHooks(id: NodeId): CleanupHooks {
		const hooks = this.hooks.get(id);
		if (hooks === undefined) throw new Error("NodeCore: unknown node cleanup hooks");
		return hooks;
	}

	getSyncCtx(id: NodeId): SyncCtxState {
		const state = this.syncCtxs.get(id);
		if (state === undefined) throw new Error("NodeCore: unknown node ctx state");
		return state;
	}

	/** @internal B49: graph-local deferred-boundary queue (rewireNext/upNext/batch-after-commit). */
	enqueueBoundaryTask(task: BoundaryTask): void {
		this.boundary.queue.push(task);
	}

	/** @internal */
	hasBoundaryTasks(): boolean {
		return this.boundary.head < this.boundary.queue.length;
	}

	/** @internal */
	shiftBoundaryTask(): BoundaryTask | undefined {
		if (!this.hasBoundaryTasks()) {
			this.boundary.queue = [];
			this.boundary.head = 0;
			return undefined;
		}
		const task = this.boundary.queue[this.boundary.head++];
		if (!this.hasBoundaryTasks()) {
			this.boundary.queue = [];
			this.boundary.head = 0;
		}
		return task;
	}
}

export function makeDepBookkeeping(depCount: number): DepBookkeeping {
	return {
		batch: new Array(depCount).fill(null),
		waveData: Array.from({ length: depCount }, () => []),
		waveTokens: new Array(depCount).fill(undefined),
		prev: new Array(depCount).fill(SENTINEL),
		hasData: new Array(depCount).fill(false),
		dirty: new Array(depCount).fill(false),
		tier: new Array(depCount).fill(0),
		terminal: new Array(depCount).fill(undefined),
		terminalInput: new Array(depCount).fill(undefined),
		unsubs: [],
		idxBoxes: [],
	};
}
