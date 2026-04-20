#!/usr/bin/env node
/**
 * `graphrefly-mcp` binary. Reads config from env and starts stdio transport.
 *
 * Env vars:
 * - `GRAPHREFLY_STORAGE_DIR` — optional. When set, snapshots persist to
 *   this directory via `fileStorage`. Default: in-memory (session-scoped).
 *
 * Server operators who need a custom catalog should import
 * `startStdioServer` from `@graphrefly/mcp-server` and write their own
 * entry instead of using this binary.
 */

import { startStdioServer } from "./stdio.js";

const storageDir = process.env.GRAPHREFLY_STORAGE_DIR;
startStdioServer(storageDir != null ? { storageDir } : {}).catch((err) => {
	console.error("@graphrefly/mcp-server fatal error:", err);
	process.exit(1);
});
