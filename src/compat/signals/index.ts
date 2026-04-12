import { batch } from "../../core/batch.js";
import { COMPLETE, DATA, DIRTY, ERROR, type Messages } from "../../core/messages.js";
import type { Node } from "../../core/node.js";
import { type TrackFn, dynamicNode, state } from "../../core/sugar.js";

/**
 * Options for creating signals.
 *
 * @category compat
 */
export interface SignalOptions {
	/** Optional identifier for the underlying node. */
	name?: string;
	/** Custom equality function for change detection. */
	equals?: (a: any, b: any) => boolean;
}

/**
 * Common interface for all reactive signals.
 *
 * @category compat
 */
export interface AnySignal<T> {
	/** Returns the current value of the signal. */
	get(): T;
	/** @internal The underlying GraphReFly node. */
	_node: Node<T>;
}

/**
 * Global stack of active tracking contexts.
 * Since computation evaluation is fully synchronous, we push the tracking `get`
 * function before execution and pop it after. This prevents memory leaks without
 * needing WeakRefs, as the stack is always empty when idle.
 */
const trackingStack: TrackFn[] = [];

/**
 * Helper to pull a disconnected node, forcing a synchronous resolution
 * cycle so that `get()` returns a fresh value even if the signal is unmounted.
 */
function pull<T>(n: Node<T>): T {
	let val: T | undefined | null = n.cache;
	const unsub = n.subscribe((msgs: Messages) => {
		for (const [t, v] of msgs) {
			if (t === DATA) val = v as T;
		}
	});
	unsub();
	return val as T;
}

/**
 * TC39 `Signal.State` — a writable signal backed by a GraphReFly `state` node.
 * Automatically registers itself as a dependency if read inside a `Computed`.
 *
 * @example
 * ```ts
 * const count = new Signal.State(0);
 * count.get(); // 0
 * count.set(1);
 * count.get(); // 1
 * ```
 */
class SignalState<T> implements AnySignal<T> {
	/** @internal */
	_node: Node<T>;
	private readonly _equals: (a: T, b: T) => boolean;

	constructor(initial: T, opts?: SignalOptions) {
		this._equals = (opts?.equals ?? Object.is) as (a: T, b: T) => boolean;
		this._node = state<T>(initial, {
			...opts,
			resubscribable: true,
			resetOnTeardown: true,
		});
	}

	get(): T {
		// If we are evaluating inside a computed node, track this read!
		const tracker = trackingStack[trackingStack.length - 1];
		if (tracker) {
			if (this._node.status === "sentinel") {
				pull(this._node);
			}
			return tracker(this._node) as T;
		}

		if (this._node.status === "sentinel") {
			return pull(this._node);
		}
		return this._node.cache as T;
	}

	set(value: T): void {
		if (this._equals(this.get(), value)) return;
		batch(() => {
			this._node.down([[DIRTY], [DATA, value]]);
		});
	}
}

/**
 * TC39 `Signal.Computed` — a read-only signal backed by `dynamicNode`.
 * Automatically tracks dependencies when `get()` is called on other signals
 * during its computation.
 *
 * @example
 * ```ts
 * const count = new Signal.State(0);
 * const doubled = new Signal.Computed(() => count.get() * 2);
 * ```
 */
class SignalComputed<T> implements AnySignal<T> {
	/** @internal */
	_node: Node<T>;

	constructor(computation: () => T, opts?: SignalOptions) {
		this._node = dynamicNode<T>(
			[],
			(track) => {
				trackingStack.push(track);
				try {
					return computation();
				} finally {
					trackingStack.pop();
				}
			},
			{
				...opts,
				describeKind: "derived",
				resubscribable: true,
				resetOnTeardown: true,
			},
		);
	}

	get(): T {
		// Computed nodes can themselves be dependencies of other Computed nodes.
		const tracker = trackingStack[trackingStack.length - 1];
		if (tracker) {
			if (this._node.status === "sentinel") {
				pull(this._node);
			}
			return tracker(this._node) as T;
		}

		if (this._node.status === "sentinel") {
			return pull(this._node);
		}
		return this._node.cache as T;
	}
}

/**
 * TC39 Signals-compatible namespace. Wraps GraphReFly primitives.
 * Provides auto-tracking conforming to the TS39 signals proposal.
 *
 * @category compat
 */
export const Signal = {
	State: SignalState,
	Computed: SignalComputed,

	/**
	 * Subscribes to changes on a signal.
	 * Returns an unsubscribe callback.
	 *
	 * @example
	 * ```ts
	 * const count = new Signal.State(0);
	 * const unsub = Signal.sub(count, v => console.log(v));
	 * ```
	 */
	sub: <T>(
		signal: AnySignal<T>,
		callback:
			| ((value: T) => void)
			| {
					data?: (value: T) => void;
					error?: (err: unknown) => void;
					complete?: () => void;
			  },
	): (() => void) => {
		const handlers =
			typeof callback === "function"
				? { data: callback as (value: T) => void, error: undefined, complete: undefined }
				: callback;
		// Skip the initial push-on-subscribe DATA — Signal.sub fires on changes only.
		let initial = true;
		return signal._node.subscribe((msgs) => {
			for (const [t, v] of msgs) {
				if (t === DATA) {
					if (initial) {
						initial = false;
						continue;
					}
					handlers.data?.(v as T);
				}
				if (t === ERROR) handlers.error?.(v);
				if (t === COMPLETE) handlers.complete?.();
			}
		});
	},
} as const;

export type { SignalComputed, SignalState };
