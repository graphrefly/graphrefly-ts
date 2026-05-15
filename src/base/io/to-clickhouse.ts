/**
 * ClickHouse insert sink IO — `toClickHouse` accumulates upstream `DATA`
 * values and inserts them in batches via the duck-typed
 * {@link ClickHouseInsertClientLike}.
 */

import type { Node } from "@graphrefly/pure-ts/core/node.js";
import {
	type ReactiveSinkHandle,
	reactiveSink,
	type SinkTransportError,
} from "../reactive-sink.js";
import type { ExtraOpts } from "./_internal.js";

/** Duck-typed ClickHouse client for batch inserts. */
export type ClickHouseInsertClientLike = {
	insert(params: { table: string; values: unknown[]; format?: string }): Promise<void>;
};

/** Options for {@link toClickHouse}. */
export type ToClickHouseOptions<T> = ExtraOpts & {
	/** Batch size before auto-flush. Default: `1000`. */
	batchSize?: number;
	/** Flush interval in ms. Default: `5000`. */
	flushIntervalMs?: number;
	/** Insert format. Default: `"JSONEachRow"`. */
	format?: string;
	/** Transform value before insert. Default: identity. */
	transform?: (value: T) => unknown;
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * ClickHouse buffered batch insert sink.
 *
 * Accumulates upstream `DATA` values and inserts in batches.
 *
 * @param source - Upstream node.
 * @param client - ClickHouse client with `insert()`.
 * @param table - Target table name.
 * @param opts - Batch size, flush interval, and transform options.
 * @returns `BufferedSinkHandle`.
 *
 * @category extra
 */
export function toClickHouse<T>(
	source: Node<T>,
	client: ClickHouseInsertClientLike,
	table: string,
	opts?: ToClickHouseOptions<T>,
): ReactiveSinkHandle<T> {
	const {
		batchSize = 1000,
		flushIntervalMs = 5000,
		format = "JSONEachRow",
		transform = (v: T) => v,
		onTransportError,
	} = opts ?? {};
	return reactiveSink<T>(source, {
		onTransportError,
		batchSize,
		flushIntervalMs,
		serialize: transform,
		sendBatch: async (batch) => {
			await client.insert({ table, values: batch, format });
		},
	});
}
