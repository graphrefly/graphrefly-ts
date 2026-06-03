import type { KvStorageTier } from "./kv.js";
import { memoryKv, requireKvPutIfAbsent } from "./kv.js";

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

/** D85 multi-writer append log; requires a passive conditional-create KV capability. */
export type MultiWriterAppendLogStorageTier<T = unknown> = AppendLogStorageTier<T>;

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

function readAppendLogEntries<T>(
	kv: KvStorageTier<T>,
	prefix: string,
	opts: AppendLogReadOptions,
): Promise<readonly AppendLogEntry<T>[]> {
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
}

function deleteAppendLogEntriesAfter<T>(
	kv: KvStorageTier<T>,
	prefix: string,
	seq: number,
): Promise<void> {
	return kv
		.list(`${prefix}/`)
		.then((keys) =>
			Promise.all(keys.filter((key) => seqFromKey(prefix, key) > seq).map((key) => kv.delete(key))),
		)
		.then(() => kv.list(`${prefix}/`))
		.then(() => undefined);
}

/** Options for a typed append log over a KV tier. */
export interface AppendLogOptions<T> {
	kv: KvStorageTier<T>;
	prefix?: string;
}

/** Options for D85 multi-writer append logs over conditional-create capable KV. */
export interface MultiWriterAppendLogOptions<T> extends AppendLogOptions<T> {
	/** Bound retry work before refreshing the listed tail after another writer wins slots. */
	maxAttempts?: number;
}

/**
 * Build a single-writer append-only log over a KV tier, serializing all operations in call order
 * for this handle. D85 multi-handle concurrent appends require multiWriterAppendLogStorage.
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
			return enqueue(() => readAppendLogEntries(kv, prefix, opts));
		},
		truncateAfter(seq) {
			return enqueue(() => deleteAppendLogEntriesAfter(kv, prefix, seq));
		},
		size() {
			return enqueue(() => kv.list(`${prefix}/`).then((keys) => keys.length));
		},
	};
}

/**
 * Build a D85 multi-writer append log over a conditional-create capable KV tier.
 *
 * Sequence allocation is passive storage work: each writer proposes a padded key and retries the
 * next key when another writer already created that slot. This does not provide general CAS,
 * locks, leases, transactions, unsafe truncation, WAL replay, or graph restore semantics.
 */
export function multiWriterAppendLogStorage<T = unknown>(
	opts: MultiWriterAppendLogOptions<T>,
): MultiWriterAppendLogStorageTier<T> {
	const { kv, prefix = "event-log", maxAttempts = 1024 } = opts;
	const capableKv = requireKvPutIfAbsent(kv, "multiWriterAppendLogStorage");
	let tail: Promise<unknown> = Promise.resolve();

	if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
		throw new RangeError(
			`multiWriterAppendLogStorage: maxAttempts must be a positive safe integer, got ${maxAttempts}`,
		);
	}

	function initNextSeq(): Promise<number> {
		return kv.list(`${prefix}/`).then((keys) => nextSeqFromKeys(prefix, keys));
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
				initNextSeq().then((startSeq) => {
					let seq = startSeq;
					let attempt = 0;
					const tryNext = (): Promise<AppendLogEntry<T>> => {
						if (attempt >= maxAttempts) {
							return initNextSeq().then((refreshedSeq) => {
								seq = Math.max(seq, refreshedSeq);
								attempt = 0;
								return tryNext();
							});
						}
						attempt += 1;
						const key = appendLogKey(prefix, seq);
						return capableKv.putIfAbsent(key, value).then((created) => {
							if (created) return { key, seq, value };
							seq += 1;
							if (!Number.isSafeInteger(seq)) {
								throw new RangeError(
									`append log next sequence is outside the safe integer range: ${prefix}`,
								);
							}
							return tryNext();
						});
					};
					return tryNext();
				}),
			);
		},
		read(opts = {}) {
			return enqueue(() => readAppendLogEntries(kv, prefix, opts));
		},
		truncateAfter(seq) {
			return enqueue(() => {
				if (!Number.isSafeInteger(seq) || seq < -1) {
					throw new RangeError(
						`multiWriterAppendLogStorage.truncateAfter: seq must be an integer cursor >= -1, got ${seq}`,
					);
				}
				throw new Error(
					"multiWriterAppendLogStorage.truncateAfter: unsupported without a stronger compaction capability",
				);
			});
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

/** Create an in-memory D85 multi-writer append log. */
export function memoryMultiWriterAppendLog<T = unknown>(
	prefix?: string,
): MultiWriterAppendLogStorageTier<T> {
	return multiWriterAppendLogStorage({ kv: memoryKv<T>(), prefix });
}
