/**
 * Graph-bound observe storage adapters.
 *
 * Passive storage lives under ../storage. This subpath owns bridges that need
 * Graph.observe() and therefore sit above both graph and passive storage (D125).
 */

import type { Graph } from "../graph/graph.js";
import type { ObserveEvent } from "../graph/inspect.js";
import { cloneStrictJsonValue } from "../json/codec.js";
import type { AppendLogStorageTier } from "../storage/append-log.js";
import {
	type ObserveEventFrame,
	type ObserveEventLogPage,
	observeEventFrame,
} from "../storage/observe-event-log.js";

/** Adapter-owned sink for observed graph events (D57/D74/D125). */
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

/** Options for attaching a sink to the read-only observe egress (D74/D125). */
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

/** Options for persisting Graph.observe() events into an append log. */
export interface AttachObserveEventLogOptions<T = ObserveEvent> {
	/** Required exact node id or subtree path. Whole-graph persistence is never implicit (D641). */
	path: string;
	stream?: string;
	/** Required bounded projection/filter into durable strict DATA (D641). */
	map: (event: ObserveEvent) => T | undefined;
	onError?: (error: unknown, ctx: ObserveSinkErrorContext<ObserveEventFrame<T>>) => void;
}

/** Done-callback lifecycle handle for an attached observe-event log. */
export interface ObserveEventLogHandle extends ObserveSinkHandle {
	flush(done?: ObserveSinkDone): void;
	rollback(done?: ObserveSinkDone): void;
	dispose(done?: ObserveSinkDone): void;
}

export type { ObserveEventFrame, ObserveEventLogPage };

/**
 * Attach adapter-owned storage to `Graph.observe()` read-only egress (D57/D74/D125). Writes are
 * serialized in observe order; lifecycle barriers drain the queue without mutating graph topology.
 * @param graph - Graph that owns the created nodes or projector.
 * @param sink - sink value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns A `ObserveSinkHandle` value.
 * @category adapters
 * @example
 * ```ts
 * import { attachObserveSink } from "@graphrefly/ts/adapters/observe-storage";
 * ```
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

/**
 * Persist Graph.observe() events to an append log. This is a graph-bound
 * adapter over passive storage frames, not graph restore or projection.
 * @param graph - Graph that owns the created nodes or projector.
 * @param log - log value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns A `ObserveEventLogHandle` value.
 * @category adapters
 * @example
 * ```ts
 * import { attachObserveEventLog } from "@graphrefly/ts/adapters/observe-storage";
 * ```
 */
export function attachObserveEventLog<T = ObserveEvent>(
	graph: Graph,
	log: AppendLogStorageTier<ObserveEventFrame<T>>,
	opts: AttachObserveEventLogOptions<T>,
): ObserveEventLogHandle {
	if (typeof opts.path !== "string" || opts.path.length === 0) {
		throw new TypeError("attachObserveEventLog: path must be a non-empty exact id or subtree path");
	}
	if (typeof opts.map !== "function") {
		throw new TypeError("attachObserveEventLog: map must be an explicit DATA projection/filter");
	}
	return attachObserveSink<ObserveEventFrame<T>>(
		graph,
		{ write: (frame) => log.append(frame).then(() => undefined) },
		{
			path: opts.path,
			map: (event) => {
				const value = opts.map(event);
				if (value === undefined) return undefined;
				const canonical = cloneStrictJsonValue(
					value,
					"attachObserveEventLog.mappedValue",
				) as unknown as T;
				return cloneStrictJsonValue(
					observeEventFrame(event, canonical, opts),
					"attachObserveEventLog.frame",
				) as unknown as ObserveEventFrame<T>;
			},
			onError: opts.onError,
		},
	);
}
