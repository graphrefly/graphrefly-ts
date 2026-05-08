/**
 * Surface layer (§9.3-core) — shared, JSON-safe operations consumed by
 * `@graphrefly/mcp-server` and `@graphrefly/cli`.
 *
 * The surface is a thin projection of existing Graph APIs (`describe`,
 * `observe`, `explain`, `snapshot`, `restore`, static `diff`), plus two
 * genuinely new operations:
 *
 * 1. {@link createGraph} — `compileSpec` wrapped with typed surface errors.
 * 2. {@link reduce} — one-shot `input → pipeline → output`.
 *
 * Snapshot persistence reuses the {@link KvStorageTier} substrate introduced
 * for `Graph.attachSnapshotStorage`, so one-shot snapshots and auto-checkpoints
 * share the {@link GraphCheckpointRecord} envelope. No new wire format.
 *
 * Errors throw as {@link SurfaceError} — wrappers map to their native
 * error channel (MCP `isError`, CLI exit code). No `Result<T, E>` wrapper.
 *
 * @module
 */

// Re-export the graphspec types the surface operates on, so MCP/CLI
// wrappers get `GraphSpec`/`GraphSpecCatalog` from one import. The
// runtime functions (`compileSpec`, `validateSpec`, `decompileSpec`,
// etc.) stay inside `patterns.graphspec` — surface callers use
// {@link createGraph}, not those directly.
export type {
	CatalogFnEntry,
	CatalogSourceEntry,
	ConfigFieldSchema,
	FnFactory,
	GraphSpec,
	GraphSpecCatalog,
	GraphSpecFeedbackEdge,
	GraphSpecNode,
	GraphSpecTemplate,
	GraphSpecTemplateRef,
	GraphSpecValidation,
	SourceFactory,
} from "../graphspec/index.js";
export type { CreateGraphOptions } from "./create.js";
export { createGraph } from "./create.js";
export type { SurfaceErrorCode, SurfaceErrorPayload } from "./errors.js";
export { asSurfaceError, SurfaceError } from "./errors.js";
export type { ReduceOptions } from "./reduce.js";
export { runReduction } from "./reduce.js";
export type {
	RestoreSnapshotOptions,
	SaveSnapshotResult,
} from "./snapshot.js";
export {
	deleteSnapshot,
	diffSnapshots,
	listSnapshots,
	restoreSnapshot,
	SNAPSHOT_WIRE_VERSION,
	saveSnapshot,
} from "./snapshot.js";
