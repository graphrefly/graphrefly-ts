import type { Ctx, CtxState } from "../ctx/types.js";
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
	_syncCtx: Ctx | null;
	/** R-subscription@3: the seed's note, until the seeded instance's first run takes it. */
	_seedNote: unknown;
	_released: boolean;
	_assertNotReleased(op: string): void;
	_dedupDeps(deps: Node<unknown>[]): Node<unknown>[];
	_reachableUpstream(from: Node<unknown>, target: Node<unknown>): boolean;
	_assertRewireDepOwner(dep: Node<unknown>): void;
	_rewire(newDeps: Node<unknown>[]): boolean;
	_activate(): void;
	_subscribeOwned(subscriber: Subscriber, acquisition?: SubscriptionAcquisition): () => void;
	_subscribeDepAt(depNode: Node<unknown>): void;
	_deactivate(): void;
	_subscriberCount(): number;
	_isRuntimeQuiescentForRelease(): boolean;
	_releaseRuntime(): void;
	_resetDepState(): void;
	_receiveFromDep(idx: number, arrays: readonly Wave[], snapshot: boolean): void;
	_markDirty(): void;
	_maybeRun(): void;
	_settleRewire(): void;
	_tryRun(): void;
	_runWave(): void;
	_buildCtx(): Ctx;
	_makeCtx(): Ctx;
	_refreshCtx(ctx: Ctx): void;
	_makeState(signal: AbortSignal): CtxState;
	_down(msgs: Wave): void;
	_markDependents(): void;
	_publish(arrays: readonly Message[][]): void;
}

export function nodeRuntimeHost<T>(node: Node<T>): NodeRuntimeHost<T> {
	return node as unknown as NodeRuntimeHost<T>;
}
