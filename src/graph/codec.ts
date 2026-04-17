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
 *
 * Wire-protocol envelope (v1):
 *
 *   [envelope_v=1: u8][name_len: u8][name: utf8][codec_v: u16 BE][payload: rest]
 *
 * `graph.snapshot({format: "bytes", codec: name})` wraps the codec's
 * `encode` output in this envelope; `Graph.decode(bytes)` auto-dispatches
 * via the config's codec registry — no out-of-band content-type needed.
 */

import type { GraphReFlyConfig } from "../core/config.js";
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
	/** Human-readable name; used as the lookup key in the envelope and config registry. */
	readonly name: string;

	/**
	 * Codec version. Bumps on breaking wire format changes; `decode` receives
	 * this via the envelope so codecs can dispatch on historical layouts.
	 * Must fit in a `u16` (0–65535).
	 */
	readonly version: number;

	/** MIME-like content type identifier (e.g. `"application/dag-cbor+zstd"`). */
	readonly contentType: string;

	/** Encode a snapshot to binary. */
	encode(snapshot: GraphPersistSnapshot): Uint8Array;

	/**
	 * Decode binary back to a snapshot.
	 *
	 * `codecVersion` is the version that produced `buffer` (read from the
	 * envelope). Omit when the caller is sure of the version (tests, one-shot
	 * round-trips). Codecs that support multiple historical layouts dispatch
	 * on this value.
	 *
	 * For lazy codecs, this may return a proxy that decodes nodes on access
	 * (see {@link LazyGraphCodec}).
	 */
	decode(buffer: Uint8Array, codecVersion?: number): GraphPersistSnapshot;
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
	decodeLazy(buffer: Uint8Array, codecVersion?: number): GraphPersistSnapshot;
}

// ---------------------------------------------------------------------------
// Delta checkpoint types (requires V0 — Phase 6.0)
// ---------------------------------------------------------------------------

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
	name: "json",
	version: 1,
	contentType: "application/json",

	encode(snapshot: GraphPersistSnapshot): Uint8Array {
		// Deterministic: snapshot() already sorts keys.
		const json = JSON.stringify(snapshot);
		return new TextEncoder().encode(json);
	},

	decode(buffer: Uint8Array, _codecVersion?: number): GraphPersistSnapshot {
		const json = new TextDecoder().decode(buffer);
		return JSON.parse(json) as GraphPersistSnapshot;
	},
};

// ---------------------------------------------------------------------------
// DAG-CBOR codec (factory — requires @ipld/dag-cbor DI)
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
 * config.registerCodec(codec);
 * const bytes = graph.snapshot({ format: "bytes", codec: "dag-cbor" });
 * ```
 */
export function createDagCborCodec(dagCbor: {
	encode: (value: unknown) => Uint8Array;
	decode: (bytes: Uint8Array) => unknown;
}): GraphCodec {
	return {
		name: "dag-cbor",
		version: 1,
		contentType: "application/dag-cbor",
		encode: (snapshot) => dagCbor.encode(snapshot),
		decode: (buffer, _codecVersion) => dagCbor.decode(buffer) as GraphPersistSnapshot,
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
 * config.registerCodec(codec);
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
		name: "dag-cbor-zstd",
		version: 1,
		contentType: "application/dag-cbor+zstd",
		encode: (snapshot) => zstd.compressSync(dagCbor.encode(snapshot)),
		decode: (buffer, _codecVersion) =>
			dagCbor.decode(zstd.decompressSync(buffer)) as GraphPersistSnapshot,
	};
}

// ---------------------------------------------------------------------------
// Envelope (v1) — self-describing codec metadata prepended to payload bytes
// ---------------------------------------------------------------------------

/** Current envelope format version. Bump on breaking layout changes. */
export const ENVELOPE_VERSION = 1;

const ENVELOPE_MIN_LEN = 4; // env_v(1) + name_len(1) + codec_v(2) + name/payload(≥0)

/**
 * Prepend the v1 envelope to `payload` identifying `codec`. The resulting
 * bytes are self-describing — any caller with access to the registering
 * {@link GraphReFlyConfig} can {@link decodeEnvelope} without knowing the
 * codec up front.
 *
 * Layout:
 * `[envelope_v=1: u8][name_len: u8][name: utf8][codec_v: u16 BE][payload: rest]`
 *
 * @throws If `codec.name` encodes to more than 255 UTF-8 bytes or
 *   `codec.version` doesn't fit in a u16.
 */
export function encodeEnvelope(
	codec: Pick<GraphCodec, "name" | "version">,
	payload: Uint8Array,
): Uint8Array {
	const nameBytes = new TextEncoder().encode(codec.name);
	if (nameBytes.length === 0 || nameBytes.length > 255) {
		throw new Error(
			`encodeEnvelope: codec name "${codec.name}" encodes to ${nameBytes.length} bytes (must be 1–255)`,
		);
	}
	const cv = codec.version;
	if (!Number.isInteger(cv) || cv < 0 || cv > 0xffff) {
		throw new Error(
			`encodeEnvelope: codec.version ${cv} out of u16 range (expected integer 0–65535)`,
		);
	}
	// Guard against RangeError-on-alloc for very large payloads — we need
	// `Number.isSafeInteger` math on `1 + 1 + nameBytes.length + 2 +
	// payload.length` and the resulting Uint8Array must fit within the
	// platform limit (2³² − 1 bytes on 64-bit JS engines).
	const totalLen = 1 + 1 + nameBytes.length + 2 + payload.length;
	if (totalLen > 0xffffffff) {
		throw new Error(
			`encodeEnvelope: total envelope size ${totalLen} exceeds 2^32-1 bytes (payload ${payload.length} bytes)`,
		);
	}
	const out = new Uint8Array(totalLen);
	let i = 0;
	out[i++] = ENVELOPE_VERSION;
	out[i++] = nameBytes.length;
	out.set(nameBytes, i);
	i += nameBytes.length;
	out[i++] = (cv >>> 8) & 0xff;
	out[i++] = cv & 0xff;
	out.set(payload, i);
	return out;
}

/**
 * Inverse of {@link encodeEnvelope}. Reads the header, resolves the codec
 * via `config.lookupCodec(name)`, and returns the codec + its version + the
 * inner payload slice. The caller feeds `payload` to `codec.decode(payload,
 * codecVersion)` — or uses {@link Graph.decode} which does both steps.
 *
 * @throws If the envelope is truncated, the version is unsupported, or the
 *   named codec isn't registered on `config`.
 */
export function decodeEnvelope(
	bytes: Uint8Array,
	config: GraphReFlyConfig,
): { codec: GraphCodec; codecVersion: number; payload: Uint8Array } {
	if (bytes.length < ENVELOPE_MIN_LEN) {
		throw new Error(`decodeEnvelope: bytes too short (${bytes.length} < ${ENVELOPE_MIN_LEN})`);
	}
	let i = 0;
	const envVersion = bytes[i++]!;
	if (envVersion !== ENVELOPE_VERSION) {
		throw new Error(
			`decodeEnvelope: unsupported envelope version ${envVersion} (expected ${ENVELOPE_VERSION})`,
		);
	}
	const nameLen = bytes[i++]!;
	if (nameLen === 0) {
		throw new Error("decodeEnvelope: name_len must be >= 1");
	}
	if (i + nameLen + 2 > bytes.length) {
		throw new Error(
			`decodeEnvelope: envelope truncated (need ${i + nameLen + 2} bytes, have ${bytes.length})`,
		);
	}
	const name = new TextDecoder().decode(bytes.subarray(i, i + nameLen));
	i += nameLen;
	const codecVersion = ((bytes[i]! << 8) | bytes[i + 1]!) >>> 0;
	i += 2;
	const payload = bytes.subarray(i);
	const codec = config.lookupCodec<GraphCodec>(name);
	if (codec == null) {
		throw new Error(
			`decodeEnvelope: codec "${name}" not registered (envelope codec_v=${codecVersion})`,
		);
	}
	return { codec, codecVersion, payload };
}

/**
 * Register the built-in {@link JsonCodec} on a config. Called once on
 * `defaultConfig` at module load so `graph.snapshot({format: "bytes", codec:
 * "json"})` works out of the box. Test / isolated configs should call this
 * manually before the first node is created.
 */
export function registerBuiltinCodecs(config: GraphReFlyConfig): void {
	config.registerCodec(JsonCodec);
}

// ---------------------------------------------------------------------------
// WAL helpers
// ---------------------------------------------------------------------------

/**
 * Reconstruct a snapshot from a WAL (sequence of {@link GraphCheckpointRecord}s).
 *
 * - Must start with a `"full"` record carrying a baseline snapshot — that's
 *   the anchor {@link Graph.attachStorage} always emits on the first flush
 *   of any tier (and every `compactEvery`-th flush thereafter).
 * - Subsequent `"full"` entries (compaction points) **replace** the result
 *   wholesale.
 * - `"diff"` entries roll forward by applying the structural diff —
 *   added nodes (via `nodesAddedFull`), removed nodes, and changed fields
 *   are reflected into the accumulated snapshot.
 *
 * Validates monotonic `seq` progression across entries.
 */
export function replayWAL(entries: readonly WALEntry[]): GraphPersistSnapshot {
	if (entries.length === 0) {
		throw new Error("WAL is empty — need at least one full snapshot");
	}

	const first = entries[0]!;
	if (first.mode !== "full") {
		throw new Error("WAL must start with a full record carrying a baseline snapshot");
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

		if (entry.mode === "full") {
			// Replace baseline wholesale (Unit 23 D fix — Object.assign left
			// stale keys from pre-compact state visible).
			result = JSON.parse(JSON.stringify(entry.snapshot));
			prevSeq = entry.seq;
			continue;
		}

		// mode === "diff": apply structural diff to the accumulated snapshot.
		const diff = entry.diff;
		// Apply removes first so a path reused across a remove+add in a single
		// diff lands on the `nodesAddedFull` slice rather than being wiped.
		for (const path of diff.nodesRemoved) {
			delete result.nodes[path];
		}
		// Reinstate added nodes from the full-slice payload carried by
		// GraphWALDiff. Deep-clone so later mutations don't alias the WAL
		// entry's source slice.
		const addedFull = diff.nodesAddedFull;
		if (addedFull != null) {
			for (const [path, slice] of Object.entries(addedFull)) {
				result.nodes[path] = JSON.parse(JSON.stringify(slice));
			}
		}
		for (const change of diff.nodesChanged) {
			const existing = result.nodes[change.path];
			if (existing == null) continue;
			(existing as Record<string, unknown>)[change.field] = change.to;
		}

		// Edges are derived from node `_deps` at restore time (Unit 7) — no
		// separate edge-patch pass.
		prevSeq = entry.seq;
	}

	return result;
}
