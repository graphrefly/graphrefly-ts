/**
 * Postgres insert sink IO — `toPostgres` inserts each upstream `DATA` value
 * via the duck-typed {@link PostgresClientLike} `query()` surface.
 */

import type { Node } from "@graphrefly/pure-ts/core/node.js";
import type { ExtraOpts } from "./_internal.js";
import { type ReactiveSinkHandle, reactiveSink, type SinkTransportError } from "./_sink.js";

/** Duck-typed Postgres client (compatible with `pg.Client` / `pg.Pool`). */
export type PostgresClientLike = {
	query(sql: string, params?: unknown[]): Promise<unknown>;
};

/** Options for {@link toPostgres}. */
export type ToPostgresOptions<T> = ExtraOpts & {
	/** Build the SQL + params for an insert. Default: JSON insert into `table`. */
	toSQL?: (value: T, table: string) => { sql: string; params: unknown[] };
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * PostgreSQL sink — inserts each upstream `DATA` value as a row.
 *
 * @param source - Upstream node.
 * @param client - Postgres client with `query()`.
 * @param table - Target table name.
 * @param opts - SQL builder and error options.
 * @returns Unsubscribe function.
 *
 * @category extra
 */
export function toPostgres<T>(
	source: Node<T>,
	client: PostgresClientLike,
	table: string,
	opts?: ToPostgresOptions<T>,
): ReactiveSinkHandle<T> {
	const {
		toSQL = (v: T, t: string) => ({
			sql: `INSERT INTO "${t.replace(/"/g, '""')}" (data) VALUES ($1)`,
			params: [JSON.stringify(v)],
		}),
		onTransportError,
	} = opts ?? {};
	return reactiveSink<T>(source, {
		onTransportError,
		serialize: (value) => toSQL(value, table),
		send: async (q) => {
			const query = q as unknown as { sql: string; params: unknown[] };
			await client.query(query.sql, query.params);
		},
	});
}
