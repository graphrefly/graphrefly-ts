import type { Ctx, Sink } from "../ctx/types.js";
import type { Dispatcher, Handle } from "../dispatcher/index.js";
import type { EnvironmentDrivers } from "../graph/environment.js";
import { type LockId, type PullDemand, SENTINEL, type Wave } from "../protocol/messages.js";
import type { Node, Status } from "./node.js";
import type { NodeVersion, ResolvedNodeVersioningPolicy } from "./versioning.js";

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

export interface VersionState {
	policy: ResolvedNodeVersioningPolicy;
	value: NodeVersion | undefined;
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
	demandOwed: PullDemand | undefined;
	activePull: PullDemand | undefined;
	pullDirtyOwed: boolean;
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

export interface BoundaryTask {
	apply: () => void;
	batchToken?: object;
	isReady?: () => boolean;
}

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
	environment: EnvironmentDrivers;
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
	version: VersionState;
	wave: WaveState;
	control: ControlState;
	privateState: PrivateState;
	hooks: CleanupHooks;
	syncCtx: SyncCtxState;
}

export class NodeCore {
	private nextId = 0;
	private readonly slots: Array<NodeSlot<unknown> | undefined> = [];
	private readonly values: Array<ValueState<unknown> | undefined> = [];
	private readonly waves: Array<WaveState | undefined> = [];
	private readonly controls: Array<ControlState | undefined> = [];
	private readonly lifecycles: Array<LifecycleState | undefined> = [];
	private readonly depStates: Array<DepBookkeeping | undefined> = [];
	private readonly privateStates: Array<PrivateState | undefined> = [];
	private readonly hooks: Array<CleanupHooks | undefined> = [];
	private readonly syncCtxs: Array<SyncCtxState | undefined> = [];
	private readonly versionStates: Array<VersionState | undefined> = [];
	private readonly boundary: BoundaryState = { queue: [], head: 0 };

	createSlot<T>(
		slot: Omit<NodeSlot<T>, "id">,
		state: NodeState<T>,
	): { id: NodeId; slot: NodeSlot<T> } {
		const id = this.nextId++ as NodeId;
		const full = { ...slot, id };
		this.slots[id] = full as NodeSlot<unknown>;
		this.depStates[id] = state.dep;
		this.lifecycles[id] = state.lifecycle;
		this.values[id] = state.value as ValueState<unknown>;
		this.waves[id] = state.wave;
		this.controls[id] = state.control;
		this.privateStates[id] = state.privateState;
		this.hooks[id] = state.hooks;
		this.syncCtxs[id] = state.syncCtx;
		this.versionStates[id] = state.version;
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

	getControl(id: NodeId): ControlState {
		const control = this.controls[id];
		if (control === undefined) throw new Error("NodeCore: unknown node control state");
		return control;
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

	getHooks(id: NodeId): CleanupHooks {
		const hooks = this.hooks[id];
		if (hooks === undefined) throw new Error("NodeCore: unknown node cleanup hooks");
		return hooks;
	}

	getSyncCtx(id: NodeId): SyncCtxState {
		const state = this.syncCtxs[id];
		if (state === undefined) throw new Error("NodeCore: unknown node ctx state");
		return state;
	}

	getVersion(id: NodeId): VersionState {
		const state = this.versionStates[id];
		if (state === undefined) throw new Error("NodeCore: unknown node version state");
		return state;
	}

	/** @internal D122: release graph-owned ephemeral node runtime state from core retention. */
	releaseSlot(id: NodeId): void {
		this.slots[id] = undefined;
		this.depStates[id] = undefined;
		this.lifecycles[id] = undefined;
		this.values[id] = undefined;
		this.waves[id] = undefined;
		this.controls[id] = undefined;
		this.privateStates[id] = undefined;
		this.hooks[id] = undefined;
		this.syncCtxs[id] = undefined;
		this.versionStates[id] = undefined;
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
	boundaryTaskCount(): number {
		return this.boundary.queue.length - this.boundary.head;
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

	/** @internal Put a not-yet-ready task back at this core's FIFO head. */
	unshiftBoundaryTask(task: BoundaryTask): void {
		const remaining = this.boundary.queue.slice(this.boundary.head);
		this.boundary.queue = [task, ...remaining];
		this.boundary.head = 0;
	}

	/** @internal D110: discard all pending tasks caused by an uncommitted batch. */
	dropBoundaryTasksForBatch(batchToken: object): void {
		const remaining = this.boundary.queue
			.slice(this.boundary.head)
			.filter((task) => task.batchToken !== batchToken);
		this.boundary.queue = remaining;
		this.boundary.head = 0;
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
