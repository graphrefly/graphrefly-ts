/**
 * ClickHouse live materialized view IO — `fromClickHouseWatch` polls a query
 * via `fromTimer + switchMap` (reactive timer, switch semantics cancel
 * in-flight queries) and emits one `DATA` per result row per scrape.
 */

import { COMPLETE, ERROR } from "@graphrefly/pure-ts/core";
import { type Node, node } from "@graphrefly/pure-ts/core";
import { type AsyncSourceOpts, fromTimer, switchMap } from "@graphrefly/pure-ts/extra";
import { NS_PER_MS, NS_PER_SEC } from "../../utils/resilience/backoff.js";

/** Structured ClickHouse query result row. */
export type ClickHouseRow = Record<string, unknown>;

/** Duck-typed ClickHouse client. */
export type ClickHouseClientLike = {
	query(opts: { query: string; format?: string }): Promise<{
		json<T = unknown>(): Promise<T[]>;
	}>;
};

/** Options for {@link fromClickHouseWatch}. */
export type FromClickHouseWatchOptions = AsyncSourceOpts & {
	/** Polling interval in nanoseconds. Default: `5 * NS_PER_SEC` (5s). */
	intervalNs?: number;
	/** JSON format to request. Default: `"JSONEachRow"`. */
	format?: string;
	/**
	 * Maximum consecutive query errors before terminating the source. Prevents
	 * error storms when the database is unavailable. Default: `5`. Set to
	 * `Infinity` to keep retrying indefinitely.
	 */
	maxConsecutiveErrors?: number;
};

/**
 * ClickHouse live materialized view as a reactive source.
 *
 * Polls a ClickHouse query on a reactive timer interval and emits new/changed rows.
 * Uses a timer-driven approach (not busy-wait polling).
 *
 * @param client - ClickHouse client instance (caller owns connection).
 * @param query - SQL query to execute on each interval.
 * @param opts - Polling interval and format options.
 * @returns `Node<ClickHouseRow>` — one `DATA` per result row per scrape.
 *
 * @example
 * ```ts
 * import { createClient } from "@clickhouse/client";
 * import { fromClickHouseWatch } from "@graphrefly/graphrefly-ts";
 *
 * const client = createClient({ url: "http://localhost:8123" });
 * const rows$ = fromClickHouseWatch(client, "SELECT * FROM errors_mv ORDER BY timestamp DESC LIMIT 100");
 * ```
 *
 * @category extra
 */
export function fromClickHouseWatch(
	client: ClickHouseClientLike,
	query: string,
	opts?: FromClickHouseWatchOptions,
): Node<ClickHouseRow> {
	const {
		intervalNs = 5 * NS_PER_SEC,
		format = "JSONEachRow",
		signal: externalSignal,
		maxConsecutiveErrors = 1,
	} = opts ?? {};
	const intervalMs = Math.ceil(intervalNs / NS_PER_MS);
	// Circuit breaker shared across switchMap inners.
	let consecutiveErrors = 0;

	// `fromTimer | switchMap(producer(one-query))` — timer ticks drive a single
	// query each; switchMap cancels any in-flight inner when the next tick
	// arrives. First tick at t=0, then every intervalMs.
	return switchMap(fromTimer(0, { period: intervalMs, signal: externalSignal }), () =>
		node<ClickHouseRow>([], (_data, a) => {
			let active = true;
			const run = async () => {
				try {
					const result = await client.query({ query, format });
					if (!active) return;
					const rows = await result.json<ClickHouseRow>();
					if (!active) return;
					for (const row of rows) a.emit(row);
					consecutiveErrors = 0;
					a.down([[COMPLETE]]);
				} catch (err) {
					if (!active) return;
					consecutiveErrors += 1;
					if (consecutiveErrors >= maxConsecutiveErrors) {
						a.down([[ERROR, err]]);
					}
					// else: swallow transient error; next tick retries.
				}
			};
			void run();
			return () => {
				active = false;
			};
		}),
	);
}
