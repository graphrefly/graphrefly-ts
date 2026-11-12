import type { AppendLogPage, AppendLogReadOptions, AppendLogStorageTier } from "./append-log.js";
import { readAppendLogPage } from "./append-log.js";
import { assertChangeEnvelope, type ChangeEnvelope, envelopeChange } from "./change.js";
import type { Codec } from "./codec.js";
import { strictJsonCodecFor } from "./codec.js";

/** The part of a Graph.observe() event (R-graph-surface@1) a frame records. */
export interface ObserveEventLike {
	readonly id: string;
}

/**
 * Storage frame for one Graph.observe() event. observe events carry no sequence number; `seq` is
 * the frame's place among the frames this attachment wrote, starting at 0.
 */
export interface ObserveEventFrame<T = unknown> extends ChangeEnvelope<T> {
	readonly structure: "observe-event";
	readonly id: string;
	readonly stream?: string;
}

/** One ordered observe-event log page. It is not graph projection or restore replay. */
export type ObserveEventLogPage<T = unknown> = AppendLogPage<ObserveEventFrame<T>>;

/** Create a storage frame from one observe event, its place and its mapped payload.
 * @param event - event value used by the helper.
 * @param seq - The frame's place among the frames this attachment wrote.
 * @param value - Unknown value to check or decode.
 * @param opts - Options that configure the helper.
 * @returns A `ObserveEventFrame<T>` value.
 * @category storage
 * @example
 * ```ts
 * import { observeEventFrame } from "@graphrefly/ts/storage";
 * ```
 */
export function observeEventFrame<T>(
	event: ObserveEventLike,
	seq: number,
	value: T,
	opts: { stream?: string } = {},
): ObserveEventFrame<T> {
	return {
		...envelopeChange(value, {
			lifecycle: "data",
			structure: "observe-event",
			version: 1,
			seq,
		}),
		structure: "observe-event",
		id: event.id,
		...(opts.stream === undefined ? {} : { stream: opts.stream }),
	};
}

/** Validate a decoded D82 observe-event storage frame.
 * @param value - Unknown value to check or decode.
 * @returns The narrowed, validated value.
 * @category storage
 * @example
 * ```ts
 * import { assertObserveEventFrame } from "@graphrefly/ts/storage";
 * ```
 */
export function assertObserveEventFrame<T = unknown>(value: unknown): ObserveEventFrame<T> {
	const frame = assertChangeEnvelope<T>(value);
	const record = frame as unknown as Record<string, unknown>;
	if (frame.structure !== "observe-event") {
		throw new TypeError("observeEventFrameCodec: structure must be observe-event");
	}
	if (typeof record.id !== "string") {
		throw new TypeError("observeEventFrameCodec: id must be a string");
	}
	if (record.stream !== undefined && typeof record.stream !== "string") {
		throw new TypeError("observeEventFrameCodec: stream must be a string when present");
	}
	return frame as ObserveEventFrame<T>;
}

/** Stable JSON codec for D82 observe-event frames, not restore records.
 * @returns A `Codec<ObserveEventFrame<T>>` value.
 * @category storage
 * @example
 * ```ts
 * import { observeEventFrameCodec } from "@graphrefly/ts/storage";
 * ```
 */
export function observeEventFrameCodec<T = unknown>(): Codec<ObserveEventFrame<T>> {
	const codec = strictJsonCodecFor<unknown>();
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
 * Read one ordered observe-event log page without projecting it into graph state.
 * @param log - log value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns A `Promise<ObserveEventLogPage<T>>` value.
 * @category storage
 * @example
 * ```ts
 * import { readObserveEventLogPage } from "@graphrefly/ts/storage";
 * ```
 */
export function readObserveEventLogPage<T = unknown>(
	log: AppendLogStorageTier<ObserveEventFrame<T>>,
	opts: AppendLogReadOptions = {},
): Promise<ObserveEventLogPage<T>> {
	return readAppendLogPage(log, opts);
}
