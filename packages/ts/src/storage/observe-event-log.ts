import type { AppendLogPage, AppendLogReadOptions, AppendLogStorageTier } from "./append-log.js";
import { readAppendLogPage } from "./append-log.js";
import { assertChangeEnvelope, type ChangeEnvelope, envelopeChange } from "./change.js";
import type { Codec } from "./codec.js";
import { strictJsonCodecFor } from "./codec.js";

export interface ObserveEventLike {
	readonly seq: number;
	readonly path: string;
}

/** Storage frame for one Graph.observe() event, preserving graph observe sequence. */
export interface ObserveEventFrame<T = unknown> extends ChangeEnvelope<T> {
	readonly structure: "observe-event";
	readonly observeSeq: number;
	readonly path: string;
	readonly stream?: string;
}

/** One ordered observe-event log page. It is not graph projection or restore replay. */
export type ObserveEventLogPage<T = unknown> = AppendLogPage<ObserveEventFrame<T>>;

/** Create a storage frame from one observe event and mapped payload.
 * @param event - event value used by the helper.
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
