import type { KvStorageTier } from "./kv.js";
import { memoryKv } from "./kv.js";

export const APPEND_LOG_SEQ_PAD = 20;

/** One append-log record with its storage key and monotonic sequence. */
export interface AppendLogEntry<T> {
	readonly key: string;
	readonly seq: number;
	readonly value: T;
}

/** Cursor and page-size options for append-log reads. */
export interface AppendLogReadOptions {
	/** Return entries with seq > after. */
	after?: number;
	limit?: number;
}

/**
 * Append-only tier for durable event/change logs (D82), not graph restore replay.
 *
 * This first-cut helper serializes operations within one handle. Concurrent writers sharing the
 * same KV prefix need an external single-writer discipline or a future CAS-capable backend.
 */
export interface AppendLogStorageTier<T = unknown> {
	append(value: T): Promise<AppendLogEntry<T>>;
	read(opts?: AppendLogReadOptions): Promise<readonly AppendLogEntry<T>[]>;
	truncateAfter(seq: number): Promise<void>;
	size(): Promise<number>;
}

/** Build the deterministic storage key for an append-log sequence number. */
export function appendLogKey(prefix: string, seq: number): string {
	if (!Number.isSafeInteger(seq) || seq < 0) {
		throw new RangeError(`appendLogKey: seq must be a non-negative safe integer, got ${seq}`);
	}
	return `${prefix}/${seq.toString().padStart(APPEND_LOG_SEQ_PAD, "0")}`;
}

function seqFromKey(prefix: string, key: string): number {
	const head = `${prefix}/`;
	if (!key.startsWith(head)) throw new Error(`append log key outside prefix: ${key}`);
	const raw = key.slice(head.length);
	if (!/^\d+$/.test(raw)) {
		throw new Error(`append log key has a non-numeric sequence: ${key}`);
	}
	const seq = Number(raw);
	if (!Number.isSafeInteger(seq)) {
		throw new Error(`append log key sequence is outside the safe integer range: ${key}`);
	}
	return seq;
}

function nextSeqFromKeys(prefix: string, keys: readonly string[]): number {
	if (keys.length === 0) return 0;
	const next = Math.max(...keys.map((key) => seqFromKey(prefix, key))) + 1;
	if (!Number.isSafeInteger(next)) {
		throw new RangeError(`append log next sequence is outside the safe integer range: ${prefix}`);
	}
	return next;
}

function validateReadOptions(opts: AppendLogReadOptions): {
	after: number;
	limit: number;
} {
	const after = opts.after ?? -1;
	const limit = opts.limit ?? Number.POSITIVE_INFINITY;
	if (!Number.isSafeInteger(after) || after < -1) {
		throw new RangeError(
			`appendLogStorage.read: after must be an integer cursor >= -1, got ${after}`,
		);
	}
	if (limit !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(limit) || limit < 0)) {
		throw new RangeError(
			`appendLogStorage.read: limit must be a non-negative safe integer or Infinity, got ${limit}`,
		);
	}
	return { after, limit };
}

/** Options for a typed append log over a KV tier. */
export interface AppendLogOptions<T> {
	kv: KvStorageTier<T>;
	prefix?: string;
}

/**
 * Build an append-only log over a KV tier, serializing all operations in call order for this
 * handle. Multi-handle concurrent appends over the same prefix are outside this first slice.
 */
export function appendLogStorage<T = unknown>(opts: AppendLogOptions<T>): AppendLogStorageTier<T> {
	const { kv, prefix = "event-log" } = opts;
	let tail: Promise<unknown> = Promise.resolve();

	function initNextSeq(): Promise<number> {
		return kv.list(`${prefix}/`).then((keys) => {
			return nextSeqFromKeys(prefix, keys);
		});
	}

	function enqueue<R>(task: () => Promise<R>): Promise<R> {
		const run = tail.then(task, task);
		tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	return {
		append(value) {
			return enqueue(() =>
				initNextSeq().then((seq) => {
					const key = appendLogKey(prefix, seq);
					return kv.set(key, value).then(() => {
						return { key, seq, value };
					});
				}),
			);
		},
		read(opts = {}) {
			return enqueue(() => {
				const { after, limit } = validateReadOptions(opts);
				return kv.list(`${prefix}/`).then((listed) => {
					const keys = listed
						.map((key) => ({ key, seq: seqFromKey(prefix, key) }))
						.filter(({ seq }) => seq > after)
						.sort((a, b) => a.seq - b.seq)
						.slice(0, limit);
					return Promise.all(
						keys.map(
							({ key, seq }): Promise<AppendLogEntry<T> | undefined> =>
								kv.get(key).then((value) => {
									if (value === undefined) {
										throw new Error(`append log listed key is missing: ${key}`);
									}
									return { key, seq, value };
								}),
						),
					).then((entries) => {
						const out: AppendLogEntry<T>[] = [];
						for (const entry of entries) if (entry !== undefined) out.push(entry);
						return out;
					});
				});
			});
		},
		truncateAfter(seq) {
			return enqueue(() =>
				kv
					.list(`${prefix}/`)
					.then((keys) =>
						Promise.all(
							keys.filter((key) => seqFromKey(prefix, key) > seq).map((key) => kv.delete(key)),
						),
					)
					.then(() => kv.list(`${prefix}/`))
					.then(() => undefined),
			);
		},
		size() {
			return enqueue(() => kv.list(`${prefix}/`).then((keys) => keys.length));
		},
	};
}

/** Create an in-memory append log. */
export function memoryAppendLog<T = unknown>(prefix?: string): AppendLogStorageTier<T> {
	return appendLogStorage({ kv: memoryKv<T>(), prefix });
}
