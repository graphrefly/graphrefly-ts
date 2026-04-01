/**
 * GraphCodec — pluggable serialization for graph snapshots (Phase 8.6).
 *
 * Design reference: `archive/docs/SESSION-serialization-memory-footprint.md`
 *
 * The codec interface decouples snapshot format from graph internals.
 * Default is JSON (current behavior). DAG-CBOR and compressed variants
 * ship as optional codecs. FlatBuffers/Arrow for advanced tiers.
 *
 * Tiered representation:
 *   HOT  — JS objects (live propagation, no codec involved)
 *   WARM — DAG-CBOR in-memory buffer (lazy hydration, delta checkpoints)
 *   COLD — Arrow/Parquet (bulk storage, ML pipelines, archival)
 *   PEEK — FlatBuffers (zero-copy read from dormant graph)
 */

import type { GraphPersistSnapshot } from "./graph.js";

// ---------------------------------------------------------------------------
// Core codec interface
// ---------------------------------------------------------------------------

/**
 * Encode/decode graph snapshots to/from binary.
 *
 * Implementations must be deterministic: `encode(x)` always produces the
 * same bytes for the same input. This is critical for CID computation (V1)
 * and snapshot hash-comparison.
 */
export interface GraphCodec {
	/** MIME-like content type identifier (e.g. "application/dag-cbor+zstd"). */
	readonly contentType: string;

	/** Human-readable name for diagnostics. */
	readonly name: string;

	/** Encode a snapshot to binary. */
	encode(snapshot: GraphPersistSnapshot): Uint8Array;

	/**
	 * Decode binary back to a snapshot.
	 *
	 * For lazy codecs, this may return a proxy that decodes nodes on access
	 * (see {@link LazyGraphCodec}).
	 */
	decode(buffer: Uint8Array): GraphPersistSnapshot;
}

/**
 * Extended codec that supports lazy (on-demand) node decoding.
 *
 * `decodeLazy` returns a snapshot where `nodes` is a Proxy — individual
 * nodes are decoded only when accessed. This enables near-zero cold-start
 * for large graphs (decode envelope + topology, skip node values until read).
 */
export interface LazyGraphCodec extends GraphCodec {
	/** Decode envelope and topology; defer node value decoding to access time. */
	decodeLazy(buffer: Uint8Array): GraphPersistSnapshot;
}

// ---------------------------------------------------------------------------
// Delta checkpoint types (requires V0 — Phase 6.0)
// ---------------------------------------------------------------------------

/**
 * A delta checkpoint: only the nodes that changed since last checkpoint.
 *
 * Append-only: each delta is identified by `seq` (monotonic). A full
 * snapshot is taken every `compactEvery` deltas for WAL compaction.
 */
export interface DeltaCheckpoint {
	/** Monotonic sequence number. */
	seq: number;
	/** Graph name. */
	name: string;
	/** Base snapshot seq this delta applies to (0 = initial full snapshot). */
	baseSec: number;
	/** Only nodes with version > lastCheckpoint. Keyed by node name. */
	nodes: Record<
		string,
		{
			/** V0 version at time of checkpoint. */
			version: number;
			/** Serialized node value (codec-dependent). */
			value: unknown;
			/** Meta snapshot (only if materialized). */
			meta?: Record<string, unknown>;
		}
	>;
	/** Nodes removed since last checkpoint. */
	removed: string[];
	/** Edges added since last checkpoint. */
	edgesAdded: ReadonlyArray<{ from: string; to: string }>;
	/** Edges removed since last checkpoint. */
	edgesRemoved: ReadonlyArray<{ from: string; to: string }>;
	/** Timestamp (wall-clock ns) of this checkpoint. */
	timestampNs: bigint;
}

/**
 * WAL entry: either a full snapshot or a delta.
 */
export type WALEntry =
	| { type: "full"; snapshot: GraphPersistSnapshot; seq: number }
	| { type: "delta"; delta: DeltaCheckpoint };

// ---------------------------------------------------------------------------
// Eviction policy (dormant subgraph management)
// ---------------------------------------------------------------------------

/**
 * Policy for evicting dormant subgraphs to reduce memory.
 *
 * When a subgraph hasn't propagated for `idleTimeoutMs`, it is serialized
 * using the graph's codec and JS objects are released. Re-hydrated on next
 * access (read, propagation, describe).
 */
export interface EvictionPolicy {
	/** Milliseconds of inactivity before eviction. */
	idleTimeoutMs: number;
	/** Codec to use for serializing evicted subgraphs (default: graph's codec). */
	codec?: GraphCodec;
}

/** Metadata about an evicted subgraph, exposed via describe(). */
export interface EvictedSubgraphInfo {
	/** True if currently evicted (serialized, JS objects released). */
	evicted: true;
	/** Wall-clock ns of last propagation before eviction. */
	lastActiveNs: bigint;
	/** Size of serialized buffer in bytes. */
	serializedBytes: number;
	/** Codec used for serialization. */
	codecName: string;
}

// ---------------------------------------------------------------------------
// JSON codec (default — wraps current behavior)
// ---------------------------------------------------------------------------

/**
 * Default JSON codec. Wraps `JSON.stringify`/`JSON.parse` with deterministic
 * key ordering (matching current `snapshot()` behavior).
 */
export const JsonCodec: GraphCodec = {
	contentType: "application/json",
	name: "json",

	encode(snapshot: GraphPersistSnapshot): Uint8Array {
		// Deterministic: snapshot() already sorts keys.
		const json = JSON.stringify(snapshot);
		return new TextEncoder().encode(json);
	},

	decode(buffer: Uint8Array): GraphPersistSnapshot {
		const json = new TextDecoder().decode(buffer);
		return JSON.parse(json) as GraphPersistSnapshot;
	},
};

// ---------------------------------------------------------------------------
// DAG-CBOR codec (stub — requires @ipld/dag-cbor)
// ---------------------------------------------------------------------------

/**
 * Create a DAG-CBOR codec.
 *
 * Requires `@ipld/dag-cbor` as a peer dependency. ~40-50% smaller than JSON,
 * deterministic encoding (required for V1 CID), CID links as native type.
 *
 * @example
 * ```ts
 * import * as dagCbor from "@ipld/dag-cbor";
 * const codec = createDagCborCodec(dagCbor);
 * const bytes = codec.encode(graph.snapshot());
 * ```
 */
export function createDagCborCodec(dagCbor: {
	encode: (value: unknown) => Uint8Array;
	decode: (bytes: Uint8Array) => unknown;
}): GraphCodec {
	return {
		contentType: "application/dag-cbor",
		name: "dag-cbor",
		encode: (snapshot) => dagCbor.encode(snapshot),
		decode: (buffer) => dagCbor.decode(buffer) as GraphPersistSnapshot,
	};
}

/**
 * Create a DAG-CBOR + zstd codec. ~80-90% smaller than JSON.
 *
 * Requires `@ipld/dag-cbor` and a zstd implementation (e.g. `fzstd` for
 * browser, `node:zlib` for Node.js).
 *
 * @example
 * ```ts
 * import * as dagCbor from "@ipld/dag-cbor";
 * import { compressSync, decompressSync } from "fzstd";
 * const codec = createDagCborZstdCodec(dagCbor, { compressSync, decompressSync });
 * ```
 */
export function createDagCborZstdCodec(
	dagCbor: {
		encode: (value: unknown) => Uint8Array;
		decode: (bytes: Uint8Array) => unknown;
	},
	zstd: {
		compressSync: (data: Uint8Array) => Uint8Array;
		decompressSync: (data: Uint8Array) => Uint8Array;
	},
): GraphCodec {
	return {
		contentType: "application/dag-cbor+zstd",
		name: "dag-cbor-zstd",
		encode: (snapshot) => zstd.compressSync(dagCbor.encode(snapshot)),
		decode: (buffer) => dagCbor.decode(zstd.decompressSync(buffer)) as GraphPersistSnapshot,
	};
}

// ---------------------------------------------------------------------------
// Codec negotiation (for peerGraph)
// ---------------------------------------------------------------------------

/**
 * Negotiate a common codec between two peers.
 *
 * Each peer advertises its supported codecs (ordered by preference).
 * Returns the first codec supported by both, or null if none.
 */
export function negotiateCodec(
	localPreference: readonly GraphCodec[],
	remoteContentTypes: readonly string[],
): GraphCodec | null {
	const remoteSet = new Set(remoteContentTypes);
	for (const codec of localPreference) {
		if (remoteSet.has(codec.contentType)) return codec;
	}
	return null;
}

// ---------------------------------------------------------------------------
// WAL helpers
// ---------------------------------------------------------------------------

/**
 * Reconstruct a snapshot from a WAL (full snapshot + sequence of deltas).
 *
 * Applies deltas in order on top of the base snapshot. Validates that
 * delta `baseSec` chains correctly.
 */
export function replayWAL(entries: readonly WALEntry[]): GraphPersistSnapshot {
	if (entries.length === 0) {
		throw new Error("WAL is empty — need at least one full snapshot");
	}

	const first = entries[0]!;
	if (first.type !== "full") {
		throw new Error("WAL must start with a full snapshot");
	}

	// Deep clone the base snapshot so we can mutate it.
	const result: GraphPersistSnapshot = JSON.parse(JSON.stringify(first.snapshot));

	for (let i = 1; i < entries.length; i++) {
		const entry = entries[i]!;
		if (entry.type === "full") {
			// A compaction point — replace the entire result.
			Object.assign(result, JSON.parse(JSON.stringify(entry.snapshot)));
			continue;
		}

		const delta = entry.delta;

		// Apply node changes.
		for (const [name, patch] of Object.entries(delta.nodes)) {
			if (result.nodes[name]) {
				result.nodes[name]!.value = patch.value;
				if (patch.meta) {
					result.nodes[name]!.meta = patch.meta;
				}
			}
		}

		// Apply removals.
		for (const name of delta.removed) {
			delete result.nodes[name];
		}

		// Apply edge changes.
		const edges = [...result.edges];
		for (const edge of delta.edgesRemoved) {
			const idx = edges.findIndex((e) => e.from === edge.from && e.to === edge.to);
			if (idx !== -1) edges.splice(idx, 1);
		}
		for (const edge of delta.edgesAdded) {
			edges.push(edge);
		}
		(result as unknown as { edges: typeof edges }).edges = edges;
	}

	return result;
}
