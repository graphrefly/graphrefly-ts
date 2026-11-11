import type { Ctx, CtxState, DeliveryMeta, NodeFn } from "../ctx/types.js";
import type { Message, Wave } from "../protocol/messages.js";
import type {
	DepBookkeeping,
	LifecycleState,
	LifetimeState,
	NodeCore,
	NodeId,
	NodeSlot,
	PrivateState,
	Subscriber,
	SyncCtxState,
	ValueState,
	VersionState,
	WaveState,
} from "./core.js";
import type { Node } from "./node.js";
import type { SubscriptionAcquisition } from "./owned-acquisition.js";

export interface NodeRuntimeHost<T = unknown> {
	_core: NodeCore;
	_id: NodeId;
	_slot: NodeSlot<T>;
	_dep: DepBookkeeping;
	_value: ValueState<T>;
	_wave: WaveState;
	_lifecycle: LifecycleState;
	_privateState: PrivateState;
	_lifetime: LifetimeState;
	_syncCtxState: SyncCtxState;
	_version: VersionState;
	_syncCtx: Ctx | null;
	_seed: import("./types.js").NodeSeed | undefined;
	_released: boolean;
	_assertNotReleased(op: string): void;
	_dedupDeps(deps: Node<unknown>[]): Node<unknown>[];
	_reachableUpstream(from: Node<unknown>, target: Node<unknown>): boolean;
	_assertRewireDepOwner(dep: Node<unknown>): void;
	_rewire(newDeps: Node<unknown>[], fn?: NodeFn, opts?: { declare?: boolean }): boolean;
	_activate(): void;
	_subscribeOwned(subscriber: Subscriber, acquisition?: SubscriptionAcquisition): () => void;
	_subscribeDepAt(
		depNode: Node<unknown>,
		seed?: {
			readonly received: import("./types.js").NodeReceived | undefined;
			readonly onChange: () => void;
		},
	): void;
	_seedRestoredDepAt(idx: number, depNode: Node<unknown>): void;
	_deactivate(): void;
	_subscriberCount(): number;
	_isRuntimeQuiescentForRelease(): boolean;
	_releaseRuntime(): void;
	_resetDepState(): void;
	_recordDepProjection(idx: number, delivery: DeliveryMeta | undefined): unknown[];
	_receiveFromDep(idx: number, msg: Message, delivery?: DeliveryMeta): void;
	_markDirty(): void;
	_maybeRun(): void;
	_settleRewire(): void;
	_tryRun(): void;
	_allDepsSettled(): boolean;
	_runWave(): void;
	_buildCtx(): Ctx;
	_makeCtx(snapshot?: {
		waveData: unknown[][][];
		waveLive?: boolean[][];
		terminal: unknown[];
		invalidated?: boolean[];
		latest: unknown[];
	}): Ctx;
	_refreshCtx(ctx: Ctx): void;
	_makeState(): CtxState;
	_down(msgs: Wave): void;
	_markDependents(): void;
	_publish(arrays: readonly Message[][]): void;
	__commitBatchedWave(wave: Wave): void;
	__resolveBatchedWave(wave: Wave): Wave;
	__markBatchedWave(wave: Wave): void;
	__deferBoundary(fn: () => void, batchToken?: object): void;
}

export function nodeRuntimeHost<T>(node: Node<T>): NodeRuntimeHost<T> {
	return node as unknown as NodeRuntimeHost<T>;
}
