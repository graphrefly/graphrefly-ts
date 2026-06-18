import type { Ctx, CtxState, DeliveryMeta, NodeFn } from "../ctx/types.js";
import type { LockId, Message, PullDemand, Wave } from "../protocol/messages.js";
import type {
	CleanupHooks,
	ControlState,
	DepBookkeeping,
	LifecycleState,
	NodeCore,
	NodeId,
	NodeSlot,
	PrivateState,
	SyncCtxState,
	ValueState,
	VersionState,
	WaveState,
} from "./core.js";
import type { Node } from "./node.js";
import type { RewireOp, UpRouteState } from "./types.js";

export interface NodeRuntimeHost<T = unknown> {
	_core: NodeCore;
	_id: NodeId;
	_slot: NodeSlot<T>;
	_dep: DepBookkeeping;
	_value: ValueState<T>;
	_wave: WaveState;
	_control: ControlState;
	_lifecycle: LifecycleState;
	_privateState: PrivateState;
	_hooks: CleanupHooks;
	_syncCtxState: SyncCtxState;
	_version: VersionState;
	_syncCtx: Ctx | null;
	_restoredActivationPending: boolean;
	_released: boolean;
	_assertNotReleased(op: string): void;
	_isPullQuiet(): boolean;
	_requestRewireNext(op: RewireOp): void;
	_requestUpNext(msgs: Wave, towardDep?: number): void;
	_applyRewireNext(op: RewireOp): void;
	_dedupDeps(deps: Node<unknown>[]): Node<unknown>[];
	_reachableUpstream(from: Node<unknown>, target: Node<unknown>): boolean;
	_assertRewireDepOwner(dep: Node<unknown>): void;
	_rewire(newDeps: Node<unknown>[], fn: NodeFn, opts?: { allowTerminalOwner?: boolean }): boolean;
	_activate(): void;
	_subscribeDepAt(depNode: Node<unknown>, opts?: { seedRestored?: boolean }): void;
	_seedRestoredDepAt(idx: number, depNode: Node<unknown>): void;
	_deactivate(): void;
	_subscriberCount(): number;
	_isRuntimeQuiescentForRelease(): boolean;
	_releaseRuntime(): void;
	_resetDepState(): void;
	_recordDepProjection(idx: number, delivery: DeliveryMeta | undefined): unknown[];
	_depProjectionHasData(idx: number): boolean;
	_receiveFromDep(idx: number, msg: Message, delivery?: DeliveryMeta): void;
	_releaseDepDirty(idx: number): void;
	_settleAfterAbsorbedTerminal(): void;
	_markDirty(): void;
	_maybeRun(): void;
	_settleRewire(): void;
	_tryRun(): void;
	_allDepsSettled(): boolean;
	_passthroughEmit(): void;
	_runWave(): void;
	_buildCtx(): Ctx;
	_makeCtx(snapshot?: { waveData: unknown[][][]; terminal: unknown[]; latest: unknown[] }): Ctx;
	_refreshCtx(ctx: Ctx): void;
	_makeState(): CtxState;
	_down(msgs: Wave): void;
	_up(msgs: Wave, towardDep?: number, route?: UpRouteState): void;
	_markDemandRouted(lockId: LockId, route: UpRouteState): boolean;
	_forwardUp(m: Message, towardDep: number | undefined, route: UpRouteState): void;
	_isPaused(): boolean;
	_hasBoundaryPauseLock(): boolean;
	_isAsyncPool(): boolean;
	_pauseAcquire(lockId: unknown): void;
	_pauseRelease(lockId: unknown): void;
	_onResume(): void;
	_canFireDemand(): boolean;
	_deliverPullDemand(demand: PullDemand): void;
	_onDemand(demand: PullDemand): void;
	_firePullDemand(): void;
	_fireOwedDemandIfReady(): void;
	_shouldBufferOnPause(): boolean;
	_invalidate(delivery?: DeliveryMeta): void;
	_allDepsTerminal(): boolean;
	_resetLifecycle(): void;
	_emitToSubs(msg: Message, delivery?: DeliveryMeta): void;
	__commitBatchedWave(wave: Wave): void;
	__rollbackBatched(): void;
	__deferBoundary(fn: () => void, batchToken?: object): void;
}

export function nodeRuntimeHost<T>(node: Node<T>): NodeRuntimeHost<T> {
	return node as unknown as NodeRuntimeHost<T>;
}
