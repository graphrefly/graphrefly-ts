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

import type { GraphCheckpointRecord, GraphPersistSnapshot } from "./graph.js";

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
 * **Deprecated** (Unit 23 A, batch 9) — `DeltaCheckpoint` was a wire-efficient
 * per-node-version delta format designed before `autoCheckpoint` landed. The
 * active `GraphCheckpointRecord` type in `graph.ts` uses `GraphDiffResult`
 * (structural, audit-friendly) which is what `replayWAL` and callers actually
 * consume. No code produces `DeltaCheckpoint` today.
 *
 * Kept as a type alias to `GraphCheckpointRecord & {mode: "diff-only"}` so
 * legacy references still resolve — new code should use `GraphCheckpointRecord`
 * directly. Likely to be deleted entirely when the wire-protocol work lands.
 */
export type DeltaCheckpoint = Extract<GraphCheckpointRecord, { mode: "diff-only" }>;

/**
 * WAL entry. Unified with {@link GraphCheckpointRecord} — every record
 * already carries `mode` / `seq` / `timestamp_ns` / `format_version`, so the
 * WAL is just an ordered list of records. `replayWAL` walks this list.
 */
export type WALEntry = GraphCheckpointRecord;

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
 * Reconstruct a snapshot from a WAL (sequence of {@link GraphCheckpointRecord}s).
 *
 * - Must start with a `"full"` (or `"diff"`) record carrying a baseline
 *   snapshot.
 * - Subsequent `"full"` entries (compaction points) **replace** the result
 *   wholesale.
 * - `"diff"` entries carry a baseline snapshot; used as-is (equivalent to
 *   `"full"` for replay purposes — the diff is audit-side-channel data).
 * - `"diff-only"` entries roll forward by applying the structural diff —
 *   nodes added/removed/changed are reflected into the accumulated snapshot.
 *
 * Validates monotonic `seq` progression across entries.
 */
export function replayWAL(entries: readonly WALEntry[]): GraphPersistSnapshot {
	if (entries.length === 0) {
		throw new Error("WAL is empty — need at least one full snapshot");
	}

	const first = entries[0]!;
	if (first.mode === "diff-only") {
		throw new Error("WAL must start with a full or diff record (with baseline snapshot)");
	}

	let result: GraphPersistSnapshot = JSON.parse(JSON.stringify(first.snapshot));
	let prevSeq: number = first.seq;

	for (let i = 1; i < entries.length; i++) {
		const entry = entries[i]!;
		if (entry.seq <= prevSeq) {
			throw new Error(
				`WAL chain broken at index ${i}: seq=${entry.seq} must exceed prev seq=${prevSeq}`,
			);
		}

		if (entry.mode === "full" || entry.mode === "diff") {
			// Replace baseline wholesale (Unit 23 D fix — Object.assign left
			// stale keys from pre-compact state visible).
			result = JSON.parse(JSON.stringify(entry.snapshot));
			prevSeq = entry.seq;
			continue;
		}

		// mode === "diff-only": apply structural diff to the accumulated snapshot.
		const diff = entry.diff;
		for (const path of diff.nodesRemoved) {
			delete result.nodes[path];
		}
		for (const change of diff.nodesChanged) {
			const existing = result.nodes[change.path];
			if (existing == null) continue;
			(existing as Record<string, unknown>)[change.field] = change.to;
		}
		// `nodesAdded` cannot be reconstructed from a diff alone (no value/meta
		// payload in GraphDiffResult). If callers need full round-trip with
		// diff-only entries, they must ship full snapshots at `compactEvery`.

		// Edges are derived from node `_deps` at restore time (Unit 7) — no
		// separate edge-patch pass.
		prevSeq = entry.seq;
	}

	return result;
}
