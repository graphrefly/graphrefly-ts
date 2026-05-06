/**
 * Graph checkpoint sinks — `checkpointToS3` and `checkpointToRedis` wire a
 * graph's `attachSnapshotStorage` with an S3- or Redis-backed
 * {@link SnapshotStorageTier}.
 */

import { wallClockNs } from "../../core/clock.js";
import type { GraphCheckpointRecord } from "../../graph/graph.js";
import type { SnapshotStorageTier } from "../storage/tiers.js";
import type { AttachStorageGraphLike } from "./_internal.js";
import type { S3ClientLike } from "./to-s3.js";

/** Options for {@link checkpointToS3}. */
export type CheckpointToS3Options = {
	/** S3 key prefix. Default: `"checkpoints/"`. */
	prefix?: string;
	/** Debounce ms on the S3 tier. Default: `500`. */
	debounceMs?: number;
	/** Full snapshot compaction interval. Default: `10`. */
	compactEvery?: number;
	onError?: (error: unknown) => void;
};

/**
 * Wires `graph.attachSnapshotStorage()` with an S3-backed tier.
 *
 * @param graph - Graph instance to checkpoint.
 * @param client - S3-compatible client with `putObject()`.
 * @param bucket - S3 bucket name.
 * @param opts - Key prefix, debounce, and compaction options.
 * @returns Dispose handle.
 *
 * @category extra
 */
export function checkpointToS3(
	graph: AttachStorageGraphLike,
	client: S3ClientLike,
	bucket: string,
	opts?: CheckpointToS3Options,
): { dispose(): void } {
	const { prefix = "checkpoints/", debounceMs = 500, compactEvery = 10, onError } = opts ?? {};
	const tier: SnapshotStorageTier<GraphCheckpointRecord> = {
		name: `s3:${bucket}`,
		debounceMs,
		compactEvery,
		save(record) {
			const ms = Math.floor(wallClockNs() / 1_000_000);
			const s3Key = `${prefix}${graph.name}/checkpoint-${ms}.json`;
			let body: string;
			try {
				body = JSON.stringify(record);
			} catch (err) {
				onError?.(err);
				return;
			}
			void client
				.putObject({
					Bucket: bucket,
					Key: s3Key,
					Body: body,
					ContentType: "application/json",
				})
				.catch((err) => onError?.(err));
		},
		// S3 tier is write-only here — one object per checkpoint timestamp,
		// no canonical "latest" key for load.
	};
	return graph.attachSnapshotStorage([tier], { onError: (err: unknown) => onError?.(err) });
}

/** Duck-typed Redis client for checkpoint storage. */
export type RedisCheckpointClientLike = {
	set(key: string, value: string): Promise<unknown>;
	get(key: string): Promise<string | null>;
};

/** Options for {@link checkpointToRedis}. */
export type CheckpointToRedisOptions = {
	/** Key prefix. Default: `"graphrefly:checkpoint:"`. */
	prefix?: string;
	/** Debounce ms on the Redis tier. Default: `500`. */
	debounceMs?: number;
	/** Full snapshot compaction interval. Default: `10`. */
	compactEvery?: number;
	onError?: (error: unknown) => void;
};

/**
 * Wires `graph.attachSnapshotStorage()` with a Redis-backed tier.
 *
 * @param graph - Graph instance to checkpoint.
 * @param client - Redis client with `set()`/`get()`.
 * @param opts - Key prefix, debounce, and compaction options.
 * @returns Dispose handle.
 *
 * @category extra
 */
export function checkpointToRedis(
	graph: AttachStorageGraphLike,
	client: RedisCheckpointClientLike,
	opts?: CheckpointToRedisOptions,
): { dispose(): void } {
	const {
		prefix = "graphrefly:checkpoint:",
		debounceMs = 500,
		compactEvery = 10,
		onError,
	} = opts ?? {};
	const redisKey = `${prefix}${graph.name}`;
	const tier: SnapshotStorageTier<GraphCheckpointRecord> = {
		name: `redis:${redisKey}`,
		debounceMs,
		compactEvery,
		save(record) {
			let body: string;
			try {
				body = JSON.stringify(record);
			} catch (err) {
				onError?.(err);
				return;
			}
			void client.set(redisKey, body).catch((err) => onError?.(err));
		},
		async load() {
			const raw = await client.get(redisKey);
			if (raw == null) return undefined;
			try {
				return JSON.parse(raw) as GraphCheckpointRecord;
			} catch {
				return undefined;
			}
		},
	};
	return graph.attachSnapshotStorage([tier], { onError: (err: unknown) => onError?.(err) });
}
