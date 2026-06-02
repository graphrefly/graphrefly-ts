import type { Ctx, DepRecord, Sink } from "../ctx/types.js";
import type { Dispatcher, Handle } from "../dispatcher/index.js";
import { type LockId, SENTINEL, type Wave } from "../protocol/messages.js";
import type { Node, Status } from "./node.js";

export type NodeId = number & { readonly __nodeId: unique symbol };

export interface DepBookkeeping {
	batch: Array<unknown[] | null>;
	prev: unknown[];
	hasData: boolean[];
	dirty: boolean[];
	tier: number[];
	terminal: Array<true | unknown | undefined>;
	unsubs: Array<() => void>;
	idxBoxes: Array<{ v: number }>;
	records: DepRecord[];
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

export interface NodeSlot<T> {
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
	subscribers: Set<Sink>;
	activated: boolean;
	dep: DepBookkeeping;
	value: ValueState<T>;
	wave: WaveState;
	control: ControlState;
	privateState: PrivateState;
	hooks: CleanupHooks;
	syncCtx: Ctx | null;
}

export class NodeCore {
	private nextId = 0;
	private readonly slots = new Map<NodeId, NodeSlot<unknown>>();

	createSlot<T>(slot: Omit<NodeSlot<T>, "id">): { id: NodeId; slot: NodeSlot<T> } {
		const id = this.nextId++ as NodeId;
		const full = { ...slot, id };
		this.slots.set(id, full as NodeSlot<unknown>);
		return { id, slot: full };
	}

	get<T>(id: NodeId): NodeSlot<T> {
		const slot = this.slots.get(id);
		if (slot === undefined) throw new Error("NodeCore: unknown node slot");
		return slot as NodeSlot<T>;
	}
}

export function makeDepBookkeeping(depCount: number): DepBookkeeping {
	return {
		batch: new Array(depCount).fill(null),
		prev: new Array(depCount).fill(SENTINEL),
		hasData: new Array(depCount).fill(false),
		dirty: new Array(depCount).fill(false),
		tier: new Array(depCount).fill(0),
		terminal: new Array(depCount).fill(undefined),
		unsubs: [],
		idxBoxes: [],
		records: Array.from({ length: depCount }, () => ({
			batch: null,
			prevData: SENTINEL,
			latest: SENTINEL,
			tier: 0,
			terminal: undefined,
		})),
	};
}
