/**
 * Live changeset stream for `Graph.observe({ changeset: true })`.
 *
 * D2 — Three-layer view (`docs/optimizations.md` line "D — Three-layer view").
 *
 * The changeset stream emits one discrete {@link GraphChange} event per
 * underlying graph change. Variants cover three categories:
 *
 * 1. **Core data flow** — `data` (with edge attribution via `fromPath` +
 *    `fromDepIndex`), `dirty`, `resolved`, `error`, `complete`, `teardown`.
 * 2. **Topology** — `node-added`, `node-removed`, `mount`, `unmount`.
 * 3. **Batch boundaries** — `batch-start`, `batch-end` (groups changes into
 *    one frame for animation / per-batch reconciliation).
 *
 * Future-extensible variants are reserved in the discriminated union but not
 * implemented yet: `pause`, `resume`, `invalidate`, `trace`, `resubscribe`,
 * `snapshot`. Adding them later is a non-breaking append.
 *
 * The {@link GraphChangeEnvelope} fields (`version`, `timestamp_ns`, `scope`)
 * are common to every variant. Designed to be share-shape with future
 * post-1.0 store-level `StoreOp` variants on the same stream
 * (§8.7 Delta checkpoints & WAL).
 *
 * @module
 */

import type { Actor } from "../core/actor.js";

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/**
 * Common fields for every {@link GraphChange} variant.
 *
 * - `version` — monotonic counter (sourced via `core/versioning.ts`'s V0
 *   counter convention; per-stream stamp). Strictly increasing across all
 *   events from the same observe handle, regardless of variant.
 * - `timestamp_ns` — monotonic nanosecond timestamp from `core/clock.ts`
 *   `monotonicNs()`. Use for ordering / animation timing only.
 * - `scope` — the `::`-delimited path that scopes this change. For node-level
 *   variants this is the node's qualified path; for graph-level topology
 *   events (`node-added` / `node-removed` / `mount` / `unmount`) this is the
 *   newly-affected segment qualified relative to the observed root. Batch
 *   boundary events use `scope: ""` (graph-level).
 */
export interface GraphChangeEnvelope {
	readonly version: number;
	readonly timestamp_ns: number;
	readonly scope: string;
}

// ---------------------------------------------------------------------------
// Variants — core data flow
// ---------------------------------------------------------------------------

/**
 * A `DATA` flowed into the scoped node. `fromPath` + `fromDepIndex` attribute
 * the edge that delivered this DATA: `fromPath` is the qualified path of the
 * upstream dep that triggered the recomputation; `fromDepIndex` is its
 * positional index in the scoped node's declared deps.
 *
 * For source nodes (no upstream deps — e.g. `state`/`producer`) the
 * `fromPath` is the scoped node itself and `fromDepIndex` is `-1`.
 *
 * `actor` mirrors `Graph.observe()`'s `data` event attribution: present when
 * the originating `node.down(...)` supplied an actor, else `DEFAULT_ACTOR`.
 */
export interface GraphChangeData extends GraphChangeEnvelope {
	readonly type: "data";
	readonly value: unknown;
	readonly fromPath: string;
	readonly fromDepIndex: number;
	readonly actor?: Actor;
}

export interface GraphChangeDirty extends GraphChangeEnvelope {
	readonly type: "dirty";
}

export interface GraphChangeResolved extends GraphChangeEnvelope {
	readonly type: "resolved";
}

export interface GraphChangeError extends GraphChangeEnvelope {
	readonly type: "error";
	readonly error: unknown;
	readonly actor?: Actor;
}

export interface GraphChangeComplete extends GraphChangeEnvelope {
	readonly type: "complete";
}

export interface GraphChangeTeardown extends GraphChangeEnvelope {
	readonly type: "teardown";
}

// ---------------------------------------------------------------------------
// Variants — topology
// ---------------------------------------------------------------------------

export interface GraphChangeNodeAdded extends GraphChangeEnvelope {
	readonly type: "node-added";
	/** `"state" | "derived" | "producer" | "effect"` per `NodeDescribeKind`. */
	readonly nodeKind?: string;
}

export interface GraphChangeNodeRemoved extends GraphChangeEnvelope {
	readonly type: "node-removed";
}

export interface GraphChangeMount extends GraphChangeEnvelope {
	readonly type: "mount";
}

export interface GraphChangeUnmount extends GraphChangeEnvelope {
	readonly type: "unmount";
}

// ---------------------------------------------------------------------------
// Variants — batch boundaries
// ---------------------------------------------------------------------------

export interface GraphChangeBatchStart extends GraphChangeEnvelope {
	readonly type: "batch-start";
}

export interface GraphChangeBatchEnd extends GraphChangeEnvelope {
	readonly type: "batch-end";
}

// ---------------------------------------------------------------------------
// Variants — future-extensible (RESERVED, do NOT emit)
// ---------------------------------------------------------------------------

/**
 * Future variants reserved in the discriminated union so consumers can
 * exhaustively switch without compile errors when these land later. Adding a
 * runtime emission for any of these is a non-breaking append. Do NOT emit
 * these from the current observe pipeline.
 */
export interface GraphChangePause extends GraphChangeEnvelope {
	readonly type: "pause";
	readonly lockId: unknown;
}

export interface GraphChangeResume extends GraphChangeEnvelope {
	readonly type: "resume";
	readonly lockId: unknown;
}

export interface GraphChangeInvalidate extends GraphChangeEnvelope {
	readonly type: "invalidate";
}

export interface GraphChangeTrace extends GraphChangeEnvelope {
	readonly type: "trace";
	readonly annotation: string;
	readonly actor?: Actor;
}

export interface GraphChangeResubscribe extends GraphChangeEnvelope {
	readonly type: "resubscribe";
}

export interface GraphChangeSnapshot extends GraphChangeEnvelope {
	readonly type: "snapshot";
	readonly cid?: string;
}

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

/**
 * Discriminated union of every changeset event variant. The runtime currently
 * emits the core data flow, topology, and batch boundary variants; the
 * remaining variants are reserved for forward-compatibility (post-1.0
 * store-level ops, pause/resume, etc.).
 */
export type GraphChange =
	| GraphChangeData
	| GraphChangeDirty
	| GraphChangeResolved
	| GraphChangeError
	| GraphChangeComplete
	| GraphChangeTeardown
	| GraphChangeNodeAdded
	| GraphChangeNodeRemoved
	| GraphChangeMount
	| GraphChangeUnmount
	| GraphChangeBatchStart
	| GraphChangeBatchEnd
	// Reserved (not emitted by current implementation):
	| GraphChangePause
	| GraphChangeResume
	| GraphChangeInvalidate
	| GraphChangeTrace
	| GraphChangeResubscribe
	| GraphChangeSnapshot;

/** Tier name extracted from the `type` discriminator. */
export type GraphChangeType = GraphChange["type"];
