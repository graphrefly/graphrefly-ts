/**
 * Drizzle adapter (5.2b) — `fromDrizzle` runs `query.execute()` and emits one
 * `DATA` containing the full mapped row array, then `COMPLETE`.
 */

import { COMPLETE, ERROR } from "@graphrefly/pure-ts/core";
import { type Node, type NodeOptions, node } from "@graphrefly/pure-ts/core";
import type { ExtraOpts } from "./_internal.js";

/**
 * Duck-typed Drizzle query builder result.
 *
 * Drizzle query builders (e.g. `db.select().from(users)`) expose `.execute()`
 * which returns `Promise<T[]>`. This interface captures that contract without
 * depending on `drizzle-orm`.
 */
export type DrizzleQueryLike<T = unknown> = {
	execute(): Promise<T[]>;
};

/** Options for {@link fromDrizzle}. */
export type FromDrizzleOptions<T, U = T> = ExtraOpts & {
	/** Map each row to the desired shape. Default: identity cast. */
	mapRow?: (row: T) => U;
};

/**
 * One-shot Drizzle query as a reactive source.
 *
 * Calls `query.execute()`, emits one `DATA` per result row, then `COMPLETE`.
 * Compose with `switchMap` + `fromTimer` for periodic re-query.
 *
 * @param query - Drizzle query builder (e.g. `db.select().from(users).where(...)`).
 * @param opts - Row mapper and node options.
 * @returns `Node<U>` — one `DATA` per row, then `COMPLETE`.
 *
 * @example
 * ```ts
 * import { drizzle } from "drizzle-orm/node-postgres";
 * import { fromDrizzle } from "@graphrefly/graphrefly-ts";
 *
 * const db = drizzle(pool);
 * const rows$ = fromDrizzle(db.select().from(users).where(eq(users.active, true)));
 * ```
 *
 * @category extra
 */
export function fromDrizzle<T = unknown, U = T>(
	query: DrizzleQueryLike<T>,
	opts?: FromDrizzleOptions<T, U>,
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
