/**
 * Universal change envelope (Phase 14 — DS-14 locked 2026-05-05).
 *
 * Two-level discriminant: envelope-level `structure` for cross-structure
 * narrowing; payload-level `kind` for per-structure verb narrowing.
 *
 * @module
 */

import type { DescribeNodeOutput } from "../../core/meta.js";

// ── Universal envelope ──────────────────────────────────────────────────────

/**
 * Universal change envelope. Every reactive primitive's delta log emits
 * records conforming to this shape.
 *
 * - `structure` — open string namespace per structure variant.
 * - `version` — monotonic identity. `number` for V0 (counter); `string` for
 *   V1+ (cid). Mixed-type unions are user-resolved.
 * - `t_ns` — wall-clock at mutation entry (wallClockNs()).
 * - `seq` — optional cursor seq for joining with audit logs.
 * - `lifecycle` — scope discriminant for diff-restore boundary safety.
 * - `change` — structure-specific delta payload (discriminated by `kind`).
 */
export interface BaseChange<T> {
	readonly structure: string;
	readonly version: number | string;
	readonly t_ns: number;
	readonly seq?: number;
	readonly lifecycle: ChangeLifecycle;
	readonly change: T;
}

export type ChangeLifecycle = "spec" | "data" | "ownership";

// ── "data" lifecycle — per-structure payload unions ─────────────────────────

/** Map structure change payloads. */
export type MapChangePayload<K, V> =
	| { readonly kind: "set"; readonly key: K; readonly value: V }
	| {
			readonly kind: "delete";
			readonly key: K;
			readonly previous: V;
			readonly reason: "expired" | "lru-evict" | "archived" | "explicit";
	  }
	| { readonly kind: "clear"; readonly count: number };

export type MapChange<K, V> = BaseChange<MapChangePayload<K, V>>;

/** List structure change payloads. */
export type ListChangePayload<T> =
	| { readonly kind: "append"; readonly value: T }
	| { readonly kind: "appendMany"; readonly values: readonly T[] }
	| { readonly kind: "insert"; readonly index: number; readonly value: T }
	| { readonly kind: "insertMany"; readonly index: number; readonly values: readonly T[] }
	| { readonly kind: "pop"; readonly index: number; readonly value: T }
	| { readonly kind: "clear"; readonly count: number };

export type ListChange<T> = BaseChange<ListChangePayload<T>>;

/** Log (append-only) structure change payloads. */
export type LogChangePayload<T> =
	| { readonly kind: "append"; readonly value: T }
	| { readonly kind: "appendMany"; readonly values: readonly T[] }
	| { readonly kind: "clear"; readonly count: number }
	| { readonly kind: "trimHead"; readonly n: number };

export type LogChange<T> = BaseChange<LogChangePayload<T>>;

/** Index structure change payloads. */
export type IndexChangePayload<K, V> =
	| { readonly kind: "upsert"; readonly primary: K; readonly secondary: unknown; readonly value: V }
	| { readonly kind: "delete"; readonly primary: K }
	| { readonly kind: "deleteMany"; readonly primaries: readonly K[] }
	| { readonly kind: "clear"; readonly count: number };

export type IndexChange<K, V> = BaseChange<IndexChangePayload<K, V>>;

/** PubSub structure change payloads. */
export type PubSubChangePayload<T = unknown> =
	| { readonly kind: "publish"; readonly value: T }
	| { readonly kind: "ack"; readonly count: number; readonly cursor: number }
	| { readonly kind: "remove"; readonly name: string };

export type PubSubChange<T = unknown> = BaseChange<PubSubChangePayload<T>>;

/** Lens flow structure change payloads. */
export type LensFlowChangePayload =
	| { readonly kind: "tick"; readonly path: string; readonly count: number }
	| { readonly kind: "evict"; readonly path: string };

export type LensFlowChange = BaseChange<LensFlowChangePayload>;

// ── "spec" lifecycle ────────────────────────────────────────────────────────

export type SpecChangePayload =
	| {
			readonly kind: "graph.add";
			readonly nodeId: string;
			readonly tag?: string;
			/**
			 * Full node slice (Phase 14.6 — DS-14-storage Q1). Carried so WAL
			 * replay can reconstruct nodes added between full anchors without a
			 * follow-on "set value" frame. Optional for non-WAL emitters that
			 * only need topology auditing.
			 */
			readonly slice?: DescribeNodeOutput;
	  }
	| { readonly kind: "graph.mount"; readonly path: string; readonly subgraphId: string }
	| { readonly kind: "graph.remove"; readonly nodeId: string }
	| {
			/**
			 * Subgraph unmount (Phase 14.6 — distinct from `graph.remove` which
			 * targets a single node by `nodeId`).
			 */
			readonly kind: "graph.unmount";
			readonly path: string;
	  }
	| { readonly kind: "schema.upgrade"; readonly level: number };

export type SpecChange = BaseChange<SpecChangePayload>;

// ── "data" lifecycle — graph-level value changes ────────────────────────────

/**
 * Graph-level value change payloads (Phase 14.6 — DS-14-storage Q2 lock A).
 * Distinct from per-bundle change payloads (`MapChange`, `LogChange`, etc.) —
 * these target nodes addressed by their qualified graph path rather than
 * bundle-local keys.
 *
 * Emitted by `Graph.attachSnapshotStorage` when a tier flushes a `mode:"diff"`
 * record: every value drift in the graph snapshot decomposes into one
 * `node.set` frame; every V0 version bump decomposes into one
 * `node.versionBump` frame. Lifecycle scope is `"data"`.
 */
export type GraphValueChangePayload =
	| { readonly kind: "node.set"; readonly path: string; readonly value: unknown }
	| {
			/**
			 * INVALIDATE-as-frame (Phase 14.6 — DS-14-storage Q7 §8.7.6).
			 * Replays as `graph.invalidate(path)`; restores the SENTINEL slot
			 * so downstream `prevData[i] === undefined` detectors work
			 * deterministically post-replay.
			 */
			readonly kind: "node.invalidate";
			readonly path: string;
	  }
	| {
			readonly kind: "node.versionBump";
			readonly path: string;
			readonly id: string;
			readonly version: number;
	  };

export type GraphValueChange = BaseChange<GraphValueChangePayload>;

// ── "ownership" lifecycle ───────────────────────────────────────────────────

export type OwnershipChangePayload =
	| {
			readonly kind: "claim";
			readonly subgraphId: string;
			readonly actor: string;
			readonly level: "L0" | "L1" | "L2" | "L3";
	  }
	| { readonly kind: "release"; readonly subgraphId: string; readonly actor: string }
	| {
			readonly kind: "override";
			readonly subgraphId: string;
			readonly actor: string;
			readonly previousActor: string;
			readonly reason: string;
	  };

export type OwnershipChange = BaseChange<OwnershipChangePayload>;
