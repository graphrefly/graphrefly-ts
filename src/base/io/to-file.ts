/**
 * File-writer sink IO — `toFile` writes upstream `DATA` to any
 * `FileWriterLike` (e.g. `fs.createWriteStream`). Buffered or write-through
 * depending on `flushIntervalMs` / `batchSize`.
 *
 * Uses a duck-typed writable so the universal `extra/io` entry stays
 * browser-safe — the caller injects the Node `fs` writer at the boundary.
 */

import type { Node } from "@graphrefly/pure-ts/core/node.js";
import type { ExtraOpts } from "./_internal.js";
import { type ReactiveSinkHandle, reactiveSink, type SinkTransportError } from "./_sink.js";

/** Duck-typed writable file handle (compatible with `fs.createWriteStream`). */
export type FileWriterLike = {
	write(data: string | Uint8Array): boolean | undefined;
	end(): void;
};

/** Options for {@link toFile}. */
export type ToFileOptions<T> = ExtraOpts & {
	/** Serialize a value to a string line. Default: `JSON.stringify(v) + "\n"`. */
	serialize?: (value: T) => string;
	/** `"append"` (default) or `"overwrite"` — controls initial file behavior hint. */
	mode?: "append" | "overwrite";
	/** Flush interval in ms. `0` = write-through (no buffering). Default: `0`. */
	flushIntervalMs?: number;
	/** Buffer size (item count) before auto-flush. Default: `Infinity` (timer only). */
	batchSize?: number;
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * File sink — writes upstream `DATA` values to a file-like writable.
 *
 * When `flushIntervalMs > 0` or `batchSize` is set, values are buffered and
 * flushed in batches. Otherwise, each value is written immediately.
 *
 * @param source - Upstream node.
 * @param writer - Writable file handle (e.g. `fs.createWriteStream(path, { flags: "a" })`).
 * @param opts - Serialization, buffering, and mode options.
 * @returns `BufferedSinkHandle` with `dispose()` and `flush()`.
 *
 * @category extra
 */
export function toFile<T>(
	source: Node<T>,
	writer: FileWriterLike,
	opts?: ToFileOptions<T>,
): ReactiveSinkHandle<T> {
	const {
		serialize = (v: T) => `${JSON.stringify(v)}\n`,
		flushIntervalMs = 0,
		batchSize = Number.POSITIVE_INFINITY,
		onTransportError,
		mode: _mode,
	} = opts ?? {};

	const buffered = flushIntervalMs > 0 || batchSize < Number.POSITIVE_INFINITY;
	// Pass `serialize` via reactiveSink's config so sync throws are classified as
	// `stage:"serialize"` rather than `stage:"send"`. Inside send/sendBatch the
	// payload is already a string (serialize output).
	const handle: ReactiveSinkHandle<T> = buffered
		? reactiveSink<T>(source, {
				onTransportError,
				batchSize,
				flushIntervalMs,
				serialize,
				sendBatch: (chunk) => {
					writer.write((chunk as unknown as string[]).join(""));
				},
			})
		: reactiveSink<T>(source, {
				onTransportError,
				serialize,
				send: (line) => {
					writer.write(line as unknown as string);
				},
			});

	const originalDispose = handle.dispose;
	handle.dispose = () => {
		originalDispose();
		try {
			writer.end();
		} catch {
			/* writer may already be closed */
		}
	};
	return handle;
}
