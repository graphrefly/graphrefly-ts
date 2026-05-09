/**
 * WAL substrate (Phase 14.6 — DS-14-storage). `WALFrame<T>` envelope,
 * checksum helpers, replay errors, and `RestoreResult` telemetry.
 *
 * Public-facing source of truth is `./storage/wal.ts`. This shim follows
 * the same `storage-core.ts` / `storage-tiers.ts` pattern so consumers can
 * import via either the universal extra barrel or the dedicated subpath.
 *
 * @module
 */

export * from "./storage/wal.js";
