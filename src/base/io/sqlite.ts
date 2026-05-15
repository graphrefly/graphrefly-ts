/**
 * SQLite IO (roadmap §5.2b) — `fromSqlite` (one-shot synchronous query),
 * `fromSqliteCursor` (row-by-row streaming via `iterate()`), and `toSqlite`
 * (insert sink with optional transactional batching).
 *
 * Synchronous boundaries: SQLite drivers are typically synchronous
 * (`better-sqlite3`, `node:sqlite`), so errors propagate immediately rather
 * than via promise rejection. The duck-typed `SqliteDbLike.query` matches the
 * project-wide `query(sql, params)` convention used by Postgres/ClickHouse.
 */

import { batch } from "@graphrefly/pure-ts/core/batch.js";
import { COMPLETE, DATA, ERROR, TEARDOWN } from "@graphrefly/pure-ts/core/messages.js";
import { defaultConfig, type Node, type NodeOptions, node } from "@graphrefly/pure-ts/core/node.js";
import type { ExtraOpts } from "./_internal.js";
import {
	type ReactiveSinkHandle,
	reactiveSink,
	type SinkFailure,
	type SinkTransportError,
} from "./_sink.js";

/**
 * Duck-typed synchronous SQLite database.
 *
 * Compatible with `better-sqlite3` (`.prepare().all()` / `.prepare().run()`)
 * and Node.js `node:sqlite` `DatabaseSync`. The user wraps their driver behind
 * this uniform contract — method name `query` matches the project-wide
 * convention (`PostgresClientLike.query`, `ClickHouseClientLike.query`).
 */
export type SqliteDbLike = {
	query(sql: string, params?: unknown[]): unknown[];
};

/** Options for {@link fromSqlite}. */
export type FromSqliteOptions<T> = ExtraOpts & {
	/** Map a raw row object to the desired type. Default: identity cast. */
	mapRow?: (row: unknown) => T;
	/** Bind parameters for the query. */
	params?: unknown[];
};

/**
 * One-shot SQLite query as a reactive source.
 *
 * Executes `query` synchronously via `db.query()`, emits **one `DATA` containing
 * the full result array**, then `COMPLETE`. Downstream flattens with
 * `mergeAll` / a custom operator if per-row semantics are required — the
 * array shape is the simpler default and matches how every SQL driver returns
 * results natively. Use {@link fromSqliteCursor} for streaming row-by-row.
 *
 * @param db - SQLite database (caller owns connection).
 * @param query - SQL string to execute.
 * @param opts - Row mapper, params, and node options.
 * @returns `Node<T[]>` — one `DATA` with the full row array, then `COMPLETE`.
 *
 * @example
 * ```ts
 * import Database from "better-sqlite3";
 * import { fromSqlite } from "@graphrefly/graphrefly-ts";
 *
 * const raw = new Database("app.db");
 * const db = { query: (sql, params) => raw.prepare(sql).all(...(params ?? [])) };
 * const rows$ = fromSqlite(db, "SELECT * FROM users WHERE active = ?", { params: [1] });
 * ```
 *
 * @category extra
 */
export function fromSqlite<T = unknown>(
	db: SqliteDbLike,
	query: string,
	opts?: FromSqliteOptions<T>,
): Node<T[]> {
	const { mapRow = (r: unknown) => r as T, params, ...rest } = opts ?? {};

	return node<T[]>(
		[],
		(_data, a) => {
			try {
				const rows = db.query(query, params);
				const mapped = rows.map(mapRow);
				a.emit(mapped);
				a.down([[COMPLETE]]);
			} catch (err) {
				a.down([[ERROR, err instanceof Error ? err : new Error(String(err))]]);
			}
			return undefined;
		},
		{ describeKind: "producer", completeWhenDepsComplete: false, ...rest } as NodeOptions<T[]>,
	);
}

/**
 * Duck-typed iterable-capable SQLite database — `iterate(sql, params)` returns
 * a synchronous iterator over rows, avoiding the "all-rows-in-memory" cost of
 * `db.query`. Compatible with `better-sqlite3`'s `.prepare().iterate()`.
 *
 * @category extra
 */
export type SqliteIterableDbLike = {
	iterate(sql: string, params?: unknown[]): Iterable<unknown>;
};

/**
 * Cursor-streaming SQLite query — emits one `DATA` per row from a synchronous
 * row iterator, then `COMPLETE`. Use when result sets are too large to
 * materialize fully into an array.
 *
 * @category extra
 */
export function fromSqliteCursor<T = unknown>(
	db: SqliteIterableDbLike,
	query: string,
	opts?: FromSqliteOptions<T>,
): Node<T> {
	const { mapRow = (r: unknown) => r as T, params, ...rest } = opts ?? {};
	return node<T>(
		[],
		(_data, a) => {
			try {
				const it = db.iterate(query, params);
				batch(() => {
					for (const row of it) a.emit(mapRow(row));
					a.down([[COMPLETE]]);
				});
			} catch (err) {
				a.down([[ERROR, err instanceof Error ? err : new Error(String(err))]]);
			}
			return undefined;
		},
		{ describeKind: "producer", completeWhenDepsComplete: false, ...rest } as NodeOptions<T>,
	);
}

/** Options for {@link toSqlite}. */
export type ToSqliteOptions<T> = ExtraOpts & {
	/** Build SQL + params for an insert. Default: JSON insert into `(data)` column. */
	toSQL?: (value: T, table: string) => { sql: string; params: unknown[] };
	onTransportError?: (err: SinkTransportError) => void;
	/**
	 * When `true`, buffer DATA values and execute all inserts inside a single
	 * `BEGIN`/`COMMIT` transaction when the batch drains.  This avoids per-row
	 * fsync overhead and dramatically reduces event-loop blocking for
	 * high-throughput sources.  The first insert error stops the batch and
	 * triggers a `ROLLBACK`; the error is reported via `onTransportError`.
	 */
	batchInsert?: boolean;
	/** Auto-flush when buffer reaches this size. Default: `1000`. Only applies when `batchInsert` is `true`. */
	maxBatchSize?: number;
	/** Periodic flush interval in ms. `0` = no timer (flush on terminal messages only). Default: `0`. Only applies when `batchInsert` is `true`. */
	flushIntervalMs?: number;
};

/**
 * SQLite sink — inserts each upstream `DATA` value as a row.
 *
 * Follows the same pattern as {@link toPostgres} / {@link toMongo}. Since SQLite
 * is synchronous, errors propagate immediately (no `void promise.catch`).
 *
 * @param source - Upstream node.
 * @param db - SQLite database (caller owns connection).
 * @param table - Target table name.
 * @param opts - SQL builder and error options.
 * @returns Unsubscribe function.
 *
 * @example
 * ```ts
 * import Database from "better-sqlite3";
 * import { toSqlite, state } from "@graphrefly/graphrefly-ts";
 *
 * const raw = new Database("app.db");
 * const db = { query: (sql, params) => (raw.prepare(sql).run(...(params ?? [])), []) };
 * const source = state({ name: "Alice", score: 42 });
 * const unsub = toSqlite(source, db, "events");
 * ```
 *
 * @category extra
 */
export function toSqlite<T>(
	source: Node<T>,
	db: SqliteDbLike,
	table: string,
	opts?: ToSqliteOptions<T>,
): ReactiveSinkHandle<T> {
	if (table.includes("\0") || table.length === 0) {
		throw new Error(`toSqlite: invalid table name: ${JSON.stringify(table)}`);
	}
	const {
		toSQL = (v: T, t: string) => ({
			sql: `INSERT INTO "${t.replace(/"/g, '""')}" (data) VALUES (?)`,
			params: [JSON.stringify(v)],
		}),
		onTransportError,
		batchInsert = false,
		maxBatchSize = 1000,
		flushIntervalMs = 0,
	} = opts ?? {};

	const serialize = (value: T) => toSQL(value, table);
	type Query = { sql: string; params: unknown[] };

	if (!batchInsert) {
		return reactiveSink<T>(source, {
			onTransportError,
			serialize,
			send: (q) => {
				const query = q as Query;
				db.query(query.sql, query.params);
			},
		});
	}

	// Batched mode — transactional: BEGIN → inserts → COMMIT (or ROLLBACK on
	// first insert error). Must preserve pending queries when BEGIN itself
	// fails (e.g. "database is locked") so a subsequent `flush()` can retry
	// with the same data intact. The generic `reactiveSink` clears its buffer
	// before invoking `sendBatch`, so we keep a bespoke transactional loop on
	// top of the reactiveSink skeleton: custom `flush()` + local pending
	// queue with re-queue semantics on BEGIN failure.
	const errorsNode = node<SinkTransportError | null>([], { initial: null });
	const sentNode = node<T | undefined>([], {
		initial: undefined,
		equals: () => false,
	}) as unknown as Node<T>;
	const failedNode = node<SinkFailure<T> | null>([], { initial: null });
	const inFlightNode = node<number>([], { initial: 0 });
	const bufferedNode = node<number>([], { initial: 0 });

	const reportError = (err: SinkTransportError) => {
		try {
			onTransportError?.(err);
		} catch {
			/* user hook must not escape */
		}
		try {
			errorsNode.down([[DATA, err]]);
		} catch {
			/* drain re-entrance */
		}
	};

	type PendingEntry = { value: T; query: Query };
	let pending: PendingEntry[] = [];
	let flushing = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;

	const updateBuffered = () => bufferedNode.down([[DATA, pending.length]]);

	// Guarded emit helpers — drop post-TEARDOWN writes silently (spec §1.3.4
	// terminal filter already blocks them downstream; this skips the
	// allocation). Prevents "emit after TEARDOWN" observable in subscribers
	// that race with in-flight flushes.
	const safeEmitSent = (v: T) => {
		if (disposed) return;
		sentNode.down([[DATA, v]]);
	};
	const safeEmitFailed = (f: SinkFailure<T>) => {
		if (disposed) return;
		failedNode.down([[DATA, f]]);
	};
	const safeSetInFlight = (n: number) => {
		if (disposed) return;
		inFlightNode.down([[DATA, n]]);
	};
	const safeReportError = (err: SinkTransportError) => {
		if (disposed) return;
		reportError(err);
	};

	const flushTransaction = () => {
		if (pending.length === 0 || flushing) return;
		flushing = true;
		safeSetInFlight(1);
		try {
			db.query("BEGIN", []);
		} catch (err) {
			// BEGIN failed — keep `pending` intact so a later flush can retry.
			flushing = false;
			safeSetInFlight(0);
			safeReportError({
				stage: "send",
				error: err instanceof Error ? err : new Error(String(err)),
				value: undefined,
			});
			return;
		}
		const chunk = pending;
		pending = [];
		updateBuffered();

		let firstError: Error | undefined;
		let committedCount = 0;
		for (const entry of chunk) {
			try {
				db.query(entry.query.sql, entry.query.params);
				committedCount += 1;
			} catch (err) {
				firstError = err instanceof Error ? err : new Error(String(err));
				break;
			}
		}

		if (firstError) {
			try {
				db.query("ROLLBACK", []);
			} catch {
				/* ROLLBACK failure — firstError already captured */
			}
			safeReportError({ stage: "send", error: firstError, value: undefined });
			for (const entry of chunk) {
				safeEmitFailed({ value: entry.value, error: firstError, attempts: 1 });
			}
		} else {
			try {
				db.query("COMMIT", []);
				for (const entry of chunk) safeEmitSent(entry.value);
			} catch (err) {
				const error = err instanceof Error ? err : new Error(String(err));
				safeReportError({ stage: "send", error, value: undefined });
				for (let i = 0; i < committedCount; i++) {
					safeEmitFailed({ value: chunk[i].value, error, attempts: 1 });
				}
			}
		}
		flushing = false;
		safeSetInFlight(0);
	};

	const scheduleFlush = () => {
		if (flushIntervalMs > 0 && timer === undefined && !disposed) {
			timer = setTimeout(() => {
				/* I/O flush timer — not reactive scheduling (§5.10) */
				timer = undefined;
				flushTransaction();
			}, flushIntervalMs);
		}
	};

	const unsub = source.subscribe((msgs) => {
		for (const msg of msgs) {
			const t = msg[0];
			if (t === DATA) {
				const value = msg[1] as T;
				let query: Query;
				try {
					query = serialize(value);
				} catch (err) {
					const error = err instanceof Error ? err : new Error(String(err));
					reportError({ stage: "serialize", error, value });
					failedNode.down([[DATA, { value, error, attempts: 0 } satisfies SinkFailure<T>]]);
					continue;
				}
				pending.push({ value, query });
				updateBuffered();
				if (pending.length >= maxBatchSize) flushTransaction();
				else scheduleFlush();
			} else if (defaultConfig.messageTier(t) >= 3) {
				flushTransaction();
			}
		}
	});

	const dispose = () => {
		if (disposed) return;
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
		flushTransaction();
		disposed = true;
		unsub();
		for (const n of [errorsNode, sentNode, failedNode, inFlightNode, bufferedNode]) {
			try {
				(n as Node<unknown>).down([[TEARDOWN]]);
			} catch {
				/* drain re-entrance */
			}
		}
	};

	return {
		dispose,
		sent: sentNode,
		failed: failedNode,
		inFlight: inFlightNode,
		errors: errorsNode,
		buffered: bufferedNode,
		flush: async () => {
			if (!disposed) flushTransaction();
		},
	};
}
