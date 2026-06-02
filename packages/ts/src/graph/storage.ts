/**
 * Observe-sink storage attachment (D57/D74).
 *
 * Storage is a graph-layer binding helper over `Graph.observe()` read-only egress: it never adds a
 * graph node, never mutates topology, and keeps adapter-owned durability work outside the sync core.
 */

import type { Graph } from "./graph.js";
import type { ObserveEvent } from "./inspect.js";

/** Adapter-owned sink for observed graph events (D57/D74). */
export interface ObserveSink<T = ObserveEvent> {
	/** Persist or forward one mapped observe event. Thenables are serialized in observe order. */
	write(event: T): void | PromiseLike<void>;
	/** Optional adapter flush barrier. Runs after all earlier writes. */
	flush?(): void | PromiseLike<void>;
	/** Optional adapter rollback hook. Runs after all earlier writes. */
	rollback?(): void | PromiseLike<void>;
	/** Optional adapter cleanup hook. Runs once after queued work drains. */
	dispose?(): void | PromiseLike<void>;
}

/** Error routing context for attachObserveSink lifecycle hooks. */
export interface ObserveSinkErrorContext<T = ObserveEvent> {
	phase: "map" | "write" | "flush" | "rollback" | "dispose";
	event?: ObserveEvent;
	value?: T;
}

/** Queue-drain completion callback for observe-sink control calls (D75). */
export type ObserveSinkDone = () => void;

/** Options for attaching a sink to the read-only observe egress (D74). */
export interface AttachObserveSinkOptions<T = ObserveEvent> {
	/** Optional exact-id or subtree path filter; forwarded to `graph.observe(path?)`. */
	path?: string;
	/** Optional projection/filter. Return `undefined` to drop an observed event. */
	map?: (event: ObserveEvent) => T | undefined;
	/** Optional error hook for mapper, write, and lifecycle failures. */
	onError?: (error: unknown, ctx: ObserveSinkErrorContext<T>) => void;
}

/** Done-only callback control handle for an attached observe sink (D75). */
export interface ObserveSinkHandle {
	flush(done?: ObserveSinkDone): void;
	rollback(done?: ObserveSinkDone): void;
	dispose(done?: ObserveSinkDone): void;
}

type QueueItem<T> =
	| { kind: "write"; event: ObserveEvent; value: T }
	| { kind: "flush"; done?: ObserveSinkDone }
	| { kind: "rollback"; done?: ObserveSinkDone }
	| { kind: "dispose" };

/**
 * Attach adapter-owned storage to `Graph.observe()` read-only egress (D57/D74). Writes are
 * serialized in observe order; lifecycle barriers drain the queue without mutating graph topology.
 */
export function attachObserveSink<T = ObserveEvent>(
	graph: Graph,
	sink: ObserveSink<T>,
	opts: AttachObserveSinkOptions<T> = {},
): ObserveSinkHandle {
	const { map, onError, path } = opts;
	const queue: QueueItem<T>[] = [];
	const disposeDone: ObserveSinkDone[] = [];
	let draining = false;
	let disposeRequested = false;
	let disposed = false;

	function report(error: unknown, ctx: ObserveSinkErrorContext<T>): void {
		if (!onError) return;
		try {
			onError(error, ctx);
		} catch {
			// Error routing is best-effort; never let adapter logging wedge the queue.
		}
	}

	function callDone(done?: ObserveSinkDone): void {
		try {
			done?.();
		} catch {
			// Completion callbacks are advisory only; never wedge the queue on observer code.
		}
	}

	function run(item: QueueItem<T>): void | PromiseLike<void> {
		switch (item.kind) {
			case "write":
				return sink.write(item.value);
			case "flush":
				return sink.flush?.();
			case "rollback":
				return sink.rollback?.();
			case "dispose":
				return sink.dispose?.();
		}
	}

	function finish(item: QueueItem<T>): void {
		if (item.kind === "dispose") {
			disposed = true;
			for (const done of disposeDone.splice(0)) callDone(done);
		} else if (item.kind !== "write") {
			callDone(item.done);
		}
		draining = false;
		drain();
	}

	function fail(item: QueueItem<T>, error: unknown): void {
		if (item.kind === "write")
			report(error, { phase: "write", event: item.event, value: item.value });
		else report(error, { phase: item.kind });
		finish(item);
	}

	function chainThenable(item: QueueItem<T>, value: unknown): boolean {
		if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;

		let then: unknown;
		try {
			then = (value as { then?: unknown }).then;
		} catch (error) {
			fail(item, error);
			return true;
		}
		if (typeof then !== "function") return false;

		let settled = false;
		const settle = (next: () => void) => {
			if (settled) return;
			settled = true;
			next();
		};
		try {
			(then as (onFulfilled: () => void, onRejected: (error: unknown) => void) => unknown).call(
				value,
				() => settle(() => finish(item)),
				(error) => settle(() => fail(item, error)),
			);
		} catch (error) {
			settle(() => fail(item, error));
		}
		return true;
	}

	function drain(): void {
		if (draining) return;
		const item = queue.shift();
		if (!item) return;
		draining = true;
		let result: void | PromiseLike<void>;
		try {
			result = run(item);
		} catch (error) {
			fail(item, error);
			return;
		}
		if (chainThenable(item, result)) return;
		finish(item);
	}

	function enqueueBarrier(kind: "flush" | "rollback", done?: ObserveSinkDone): void {
		if (disposeRequested) {
			callDone(done);
			return;
		}
		queue.push({ kind, done });
		drain();
	}

	const stop = graph.observe(path).subscribe((event) => {
		if (disposeRequested) return;
		let value: T | undefined;
		try {
			value = map ? map(event) : (event as unknown as T);
		} catch (error) {
			report(error, { phase: "map", event });
			return;
		}
		if (value === undefined) return;
		queue.push({ kind: "write", event, value });
		drain();
	});

	return {
		flush(done?: ObserveSinkDone): void {
			enqueueBarrier("flush", done);
		},
		rollback(done?: ObserveSinkDone): void {
			enqueueBarrier("rollback", done);
		},
		dispose(done?: ObserveSinkDone): void {
			if (disposed) {
				callDone(done);
				return;
			}
			if (done) disposeDone.push(done);
			if (disposeRequested) {
				return;
			}
			disposeRequested = true;
			stop();
			queue.push({ kind: "dispose" });
			drain();
		},
	};
}
