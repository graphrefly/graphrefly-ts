/**
 * Kysely adapter (5.2b) — `fromKysely` runs `query.execute()` and emits one
 * `DATA` containing the full mapped row array, then `COMPLETE`.
 */

import { COMPLETE, ERROR, type Node, type NodeOptions, node } from "@graphrefly/pure-ts/core";
import type { ExtraOpts } from "./_internal.js";

/**
 * Duck-typed Kysely query builder result.
 *
 * Kysely query builders expose `.execute()` which returns `Promise<T[]>`.
 * This interface captures that contract without depending on `kysely`.
 */
export type KyselyQueryLike<T = unknown> = {
	execute(): Promise<T[]>;
};

/** Options for {@link fromKysely}. */
export type FromKyselyOptions<T, U = T> = ExtraOpts & {
	/** Map each row to the desired shape. Default: identity cast. */
	mapRow?: (row: T) => U;
};

/**
 * One-shot Kysely query as a reactive source.
 *
 * Calls `query.execute()`, emits one `DATA` per result row, then `COMPLETE`.
 * Compose with `switchMap` + `fromTimer` for periodic re-query.
 *
 * @param query - Kysely query builder (e.g. `db.selectFrom("users").selectAll()`).
 * @param opts - Row mapper and node options.
 * @returns `Node<U>` — one `DATA` per row, then `COMPLETE`.
 *
 * @example
 * ```ts
 * import { Kysely, PostgresDialect } from "kysely";
 * import { fromKysely } from "@graphrefly/graphrefly-ts";
 *
 * const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
 * const rows$ = fromKysely(db.selectFrom("users").selectAll().where("active", "=", true));
 * ```
 *
 * @category extra
 */
export function fromKysely<T = unknown, U = T>(
	query: KyselyQueryLike<T>,
	opts?: FromKyselyOptions<T, U>,
): Node<U[]> {
	const { mapRow = (r: T) => r as unknown as U, ...rest } = opts ?? {};

	return node<U[]>(
		[],
		(_data, a) => {
			let active = true;

			void query
				.execute()
				.then((rows) => {
					if (!active) return;
					a.emit(rows.map(mapRow));
					a.down([[COMPLETE]]);
				})
				.catch((err) => {
					if (!active) return;
					try {
						a.down([[ERROR, err instanceof Error ? err : new Error(String(err))]]);
					} catch {
						/* node already torn down — swallow */
					}
				});

			return () => {
				active = false;
			};
		},
		{ ...rest, describeKind: "producer", completeWhenDepsComplete: false } as NodeOptions<U[]>,
	);
}
