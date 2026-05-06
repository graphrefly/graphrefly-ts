/**
 * S3 object-storage sink IO — `toS3` buffers upstream `DATA` values and
 * uploads them as NDJSON or JSON objects via the duck-typed
 * {@link S3ClientLike}.
 *
 * `S3ClientLike` is also used by `checkpointToS3` (in `./checkpoint.ts`).
 */

import { wallClockNs } from "../../core/clock.js";
import type { Node } from "../../core/node.js";
import {
	type ReactiveSinkHandle,
	reactiveSink,
	type SinkTransportError,
} from "../reactive-sink.js";
import type { ExtraOpts } from "./_internal.js";

/** Duck-typed S3 client (compatible with AWS SDK v3 `S3Client.send(PutObjectCommand(...))`). */
export type S3ClientLike = {
	putObject(params: {
		Bucket: string;
		Key: string;
		Body: string | Uint8Array;
		ContentType?: string;
	}): Promise<unknown>;
};

/** Options for {@link toS3}. */
export type ToS3Options<T> = ExtraOpts & {
	/** Output format. Default: `"ndjson"`. */
	format?: "ndjson" | "json";
	/** Generate the S3 key for each batch. Receives `(seq, wallClockNs)`. Default: ISO timestamp + sequence. */
	keyGenerator?: (seq: number, timestampNs: number) => string;
	/** Batch size before auto-flush. Default: `1000`. */
	batchSize?: number;
	/** Flush interval in ms. Default: `10000`. */
	flushIntervalMs?: number;
	/** Transform value before serialization. Default: identity. */
	transform?: (value: T) => unknown;
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * S3 object storage sink — buffers values and uploads as NDJSON or JSON objects.
 *
 * @param source - Upstream node.
 * @param client - S3-compatible client with `putObject()`.
 * @param bucket - S3 bucket name.
 * @param opts - Format, key generation, batching options.
 * @returns `BufferedSinkHandle`.
 *
 * @category extra
 */
export function toS3<T>(
	source: Node<T>,
	client: S3ClientLike,
	bucket: string,
	opts?: ToS3Options<T>,
): ReactiveSinkHandle<T> {
	const {
		format = "ndjson",
		keyGenerator = (seq: number, timestampNs: number) => {
			const ms = Math.floor(timestampNs / 1_000_000);
			const ts = new Date(ms).toISOString().replace(/[:.]/g, "-");
			return `data/${ts}-${seq}.${format === "ndjson" ? "ndjson" : "json"}`;
		},
		batchSize = 1000,
		flushIntervalMs = 10000,
		transform = (v: T) => v,
		onTransportError,
	} = opts ?? {};

	const contentType = format === "ndjson" ? "application/x-ndjson" : "application/json";
	let seq = 0;

	return reactiveSink<T>(source, {
		onTransportError,
		batchSize,
		flushIntervalMs,
		serialize: transform,
		sendBatch: async (batch) => {
			seq += 1;
			const body =
				format === "ndjson"
					? `${batch.map((v) => JSON.stringify(v)).join("\n")}\n`
					: JSON.stringify(batch);
			const key = keyGenerator(seq, wallClockNs());
			await client.putObject({ Bucket: bucket, Key: key, Body: body, ContentType: contentType });
		},
	});
}
