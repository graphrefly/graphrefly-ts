import type { Graph } from "../graph/graph.js";
import type { ObserveEvent } from "../graph/inspect.js";
import {
	attachObserveSink,
	type ObserveSinkDone,
	type ObserveSinkErrorContext,
	type ObserveSinkHandle,
} from "../graph/storage.js";
import type { AppendLogStorageTier } from "./append-log.js";
import { assertChangeEnvelope, type ChangeEnvelope, envelopeChange } from "./change.js";
import type { Codec } from "./codec.js";
import { jsonCodecFor } from "./codec.js";

/** Storage frame for one Graph.observe() event, preserving graph observe sequence. */
export interface ObserveEventFrame<T = ObserveEvent> extends ChangeEnvelope<T> {
	readonly structure: "observe-event";
	readonly observeSeq: number;
	readonly path: string;
	readonly stream?: string;
}

/** Options for persisting observe events into an append log. */
export interface AttachObserveEventLogOptions<T = ObserveEvent> {
	path?: string;
	stream?: string;
	map?: (event: ObserveEvent) => T | undefined;
	onError?: (error: unknown, ctx: ObserveSinkErrorContext<ObserveEventFrame<T>>) => void;
}

/** Done-callback lifecycle handle for an attached observe-event log. */
export interface ObserveEventLogHandle extends ObserveSinkHandle {
	flush(done?: ObserveSinkDone): void;
	rollback(done?: ObserveSinkDone): void;
	dispose(done?: ObserveSinkDone): void;
}

/** Create a storage frame from one observe event and mapped payload. */
export function observeEventFrame<T>(
	event: ObserveEvent,
	value: T,
	opts: { stream?: string } = {},
): ObserveEventFrame<T> {
	return {
		...envelopeChange(value, {
			lifecycle: "data",
			structure: "observe-event",
			version: 1,
			seq: event.seq,
		}),
		structure: "observe-event",
		observeSeq: event.seq,
		path: event.path,
		...(opts.stream === undefined ? {} : { stream: opts.stream }),
	};
}

/** Validate a decoded D82 observe-event storage frame. */
export function assertObserveEventFrame<T = ObserveEvent>(value: unknown): ObserveEventFrame<T> {
	const frame = assertChangeEnvelope<T>(value);
	const record = frame as unknown as Record<string, unknown>;
	if (frame.structure !== "observe-event") {
		throw new TypeError("observeEventFrameCodec: structure must be observe-event");
	}
	if (!Number.isSafeInteger(record.observeSeq) || (record.observeSeq as number) < 0) {
		throw new TypeError("observeEventFrameCodec: observeSeq must be a non-negative safe integer");
	}
	if (typeof record.path !== "string") {
		throw new TypeError("observeEventFrameCodec: path must be a string");
	}
	if (record.stream !== undefined && typeof record.stream !== "string") {
		throw new TypeError("observeEventFrameCodec: stream must be a string when present");
	}
	return frame as ObserveEventFrame<T>;
}

/** Stable JSON codec for D82 observe-event frames, not restore records. */
export function observeEventFrameCodec<T = ObserveEvent>(): Codec<ObserveEventFrame<T>> {
	const codec = jsonCodecFor<unknown>();
	return {
		encode(value) {
			return codec.encode(assertObserveEventFrame(value));
		},
		decode(bytes) {
			return assertObserveEventFrame<T>(codec.decode(bytes));
		},
	};
}

/**
 * Persist Graph.observe() events to an append log. This is a D82 binding-layer sink, not restore.
 */
export function attachObserveEventLog<T = ObserveEvent>(
	graph: Graph,
	log: AppendLogStorageTier<ObserveEventFrame<T>>,
	opts: AttachObserveEventLogOptions<T> = {},
): ObserveEventLogHandle {
	return attachObserveSink<ObserveEventFrame<T>>(
		graph,
		{ write: (frame) => log.append(frame).then(() => undefined) },
		{
			path: opts.path,
			map: (event) => {
				const value = opts.map ? opts.map(event) : (event as unknown as T);
				return value === undefined ? undefined : observeEventFrame(event, value, opts);
			},
			onError: opts.onError,
		},
	);
}
