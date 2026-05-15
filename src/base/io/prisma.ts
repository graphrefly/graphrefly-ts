/**
 * Prisma adapter (5.2b) — `fromPrisma` runs `model.findMany(args)` and emits
 * one `DATA` containing the full mapped row array, then `COMPLETE`.
 */

import { COMPLETE, ERROR } from "@graphrefly/pure-ts/core/messages.js";
import { type Node, type NodeOptions, node } from "@graphrefly/pure-ts/core/node.js";
import type { ExtraOpts } from "./_internal.js";

/**
 * Duck-typed Prisma model delegate.
 *
 * Compatible with any Prisma model's `findMany` method (e.g. `prisma.user`).
 * The consumer passes the model delegate directly — no dependency on `@prisma/client`.
 */
export type PrismaModelLike<T = unknown> = {
	findMany(args?: unknown): Promise<T[]>;
};

/** Options for {@link fromPrisma}. */
export type FromPrismaOptions<T, U = T> = ExtraOpts & {
	/** Prisma `findMany` args (where, orderBy, select, include, take, skip, etc.). */
	args?: unknown;
	/** Map each row to the desired shape. Default: identity cast. */
	mapRow?: (row: T) => U;
};

/**
 * One-shot Prisma query as a reactive source.
 *
 * Calls `model.findMany(args)`, emits one `DATA` per result row, then `COMPLETE`.
 * Compose with `switchMap` + `fromTimer` for periodic re-query.
 *
 * @param model - Prisma model delegate (e.g. `prisma.user`).
 * @param opts - `findMany` args, row mapper, and node options.
 * @returns `Node<U>` — one `DATA` per row, then `COMPLETE`.
 *
 * @example
 * ```ts
 * import { PrismaClient } from "@prisma/client";
 * import { fromPrisma } from "@graphrefly/graphrefly-ts";
 *
 * const prisma = new PrismaClient();
 * const activeUsers = fromPrisma(prisma.user, {
 *   args: { where: { active: true } },
 * });
 * ```
 *
 * @category extra
 */
export function fromPrisma<T = unknown, U = T>(
	model: PrismaModelLike<T>,
	opts?: FromPrismaOptions<T, U>,
): Node<U[]> {
	const { args, mapRow = (r: T) => r as unknown as U, ...rest } = opts ?? {};

	return node<U[]>(
		[],
		(_data, a) => {
			let active = true;

			void model
				.findMany(args)
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
