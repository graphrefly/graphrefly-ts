/**
 * Redis Streams IO — `fromRedisStream` (XREAD-BLOCK consumer source) and
 * `toRedisStream` (XADD producer sink). Caller owns the Redis client
 * lifecycle.
 */

import { wallClockNs } from "@graphrefly/pure-ts/core/clock.js";
import { ERROR } from "@graphrefly/pure-ts/core/messages.js";
import { type Node, node } from "@graphrefly/pure-ts/core/node.js";
import { type ExtraOpts, sourceOpts } from "./_internal.js";
import { type ReactiveSinkHandle, reactiveSink, type SinkTransportError } from "./_sink.js";

/** Duck-typed Redis client (compatible with ioredis, redis). */
export type RedisClientLike = {
	xadd(key: string, id: string, ...fieldsAndValues: string[]): Promise<string>;
	xread(
		...args: Array<string | number>
	): Promise<Array<[string, Array<[string, string[]]>]> | null>;
	disconnect(): void;
};

/** Structured Redis Stream entry. */
export type RedisStreamEntry<T = unknown> = {
	id: string;
	key: string;
	data: T;
	timestampNs: number;
};

/** Options for {@link fromRedisStream}. */
export type FromRedisStreamOptions = ExtraOpts & {
	/** Block timeout in ms for XREAD. Default: `5000`. */
	blockMs?: number;
	/** Start ID. Default: `"$"` (new entries only). */
	startId?: string;
	/** Parse raw Redis hash fields to structured data. Default: parses `data` field as JSON. */
	parse?: (fields: string[]) => unknown;
};

/**
 * Redis Streams consumer as a reactive source.
 *
 * Uses XREAD with BLOCK to reactively consume stream entries.
 *
 * @param client - ioredis/redis-compatible client (caller owns connection).
 * @param key - Redis stream key.
 * @param opts - Block timeout, start ID, and parsing options.
 * @returns `Node<RedisStreamEntry<T>>` — one `DATA` per stream entry.
 *
 * @remarks
 * **COMPLETE:** This source never emits `COMPLETE` under normal operation — it
 * is a long-lived stream consumer that runs until teardown or error, same as
 * Kafka consumers. If you need a bounded read, wrap with `take()` or
 * `takeUntil()`.
 *
 * **Client lifecycle:** The caller owns the Redis client connection. The adapter
 * does not call `disconnect()` on teardown — the caller is responsible for
 * closing the connection (same contract as `fromKafka`).
 *
 * @category extra
 */
export function fromRedisStream<T = unknown>(
	client: RedisClientLike,
	key: string,
	opts?: FromRedisStreamOptions,
): Node<RedisStreamEntry<T>> {
	const {
		blockMs = 5000,
		startId = "$",
		parse = (fields: string[]) => {
			// Redis returns flat [field, value, field, value, ...] arrays.
			for (let i = 0; i < fields.length; i += 2) {
				if (fields[i] === "data") {
					try {
						return JSON.parse(fields[i + 1]);
					} catch {
						return fields[i + 1];
					}
				}
			}
			// Return as object if no "data" field.
			const obj: Record<string, string> = {};
			for (let i = 0; i < fields.length; i += 2) {
				obj[fields[i]] = fields[i + 1];
			}
			return obj;
		},
		...rest
	} = opts ?? {};

	return node<RedisStreamEntry<T>>(
		[],
		(_data, a) => {
			let active = true;
			let lastId = startId;

			const poll = async () => {
				while (active) {
					try {
						const result = await client.xread("BLOCK", blockMs, "STREAMS", key, lastId);
						if (!active) return;
						if (result) {
							for (const [_streamKey, entries] of result) {
								for (const [id, fields] of entries) {
									lastId = id;
									a.emit({
										id,
										key,
										data: parse(fields) as T,
										timestampNs: wallClockNs(),
									});
								}
							}
						}
					} catch (err) {
						if (!active) return;
						a.down([[ERROR, err]]);
						return;
					}
				}
			};

			void poll();

			return () => {
				active = false;
			};
		},
		sourceOpts(rest),
	);
}

/** Options for {@link toRedisStream}. */
export type ToRedisStreamOptions<T> = ExtraOpts & {
	/** Serialize value to Redis hash fields. Default: `["data", JSON.stringify(value)]`. */
	serialize?: (value: T) => string[];
	/** Max stream length (MAXLEN ~). Default: no trimming. */
	maxLen?: number;
	/** Called on serialization or send failures. */
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * Redis Streams producer sink — forwards upstream `DATA` to a Redis stream.
 *
 * @param source - Upstream node to forward.
 * @param client - ioredis/redis-compatible client.
 * @param key - Redis stream key.
 * @param opts - Serialization options.
 * @returns Unsubscribe function.
 *
 * @category extra
 */
export function toRedisStream<T>(
	source: Node<T>,
	client: RedisClientLike,
	key: string,
	opts?: ToRedisStreamOptions<T>,
): ReactiveSinkHandle<T> {
	const {
		serialize = (v: T) => ["data", JSON.stringify(v)],
		maxLen,
		onTransportError,
	} = opts ?? {};
	return reactiveSink<T>(source, {
		onTransportError,
		send: async (value) => {
			const fields = serialize(value);
			await (maxLen !== undefined
				? client.xadd(key, "MAXLEN", "~", String(maxLen), "*", ...fields)
				: client.xadd(key, "*", ...fields));
		},
	});
}
