/**
 * Per-process session state for the MCP server.
 *
 * Holds the `graphId → Graph` map plus the default snapshot tier. One
 * session lives for the lifetime of an MCP process (stdio transport);
 * tests may create isolated sessions on demand.
 *
 * The registry is a process-local convenience, not a durable store —
 * clients that need graphs to survive restarts should persist via
 * `graphrefly_snapshot_save` and re-create on reconnect.
 *
 * @module
 */

import { fileStorage, type Graph, memoryStorage, type StorageTier } from "@graphrefly/graphrefly";

/** Session handle returned by {@link createSession}. Consumed by tool handlers. */
export interface Session {
	readonly graphs: Map<string, Graph>;
	readonly tier: StorageTier;
	dispose(): void;
}

/** Options for {@link createSession}. */
export interface SessionOptions {
	/**
	 * Snapshot storage backend. When omitted, uses an in-memory tier (session-
	 * scoped — snapshots vanish when the process exits). Pass the result of
	 * `fileStorage(dir)` or a custom {@link StorageTier} for persistence.
	 */
	tier?: StorageTier;
	/**
	 * When set and no `tier` is provided, create a {@link fileStorage} backed
	 * by this directory. Typically wired from `--storage-dir` or
	 * `GRAPHREFLY_STORAGE_DIR`.
	 */
	storageDir?: string;
}

export function createSession(opts?: SessionOptions): Session {
	const tier =
		opts?.tier ?? (opts?.storageDir != null ? fileStorage(opts.storageDir) : memoryStorage());
	const graphs = new Map<string, Graph>();
	return {
		graphs,
		tier,
		dispose() {
			for (const g of graphs.values()) {
				try {
					g.destroy();
				} catch {
					/* best-effort teardown */
				}
			}
			graphs.clear();
		},
	};
}
