/**
 * WAL substrate (Phase 14.6 — DS-14-storage locked 2026-05-08).
 *
 * `attachSnapshotStorage` writes a stream of `WALFrame<T>` records between
 * `mode:"full"` baselines so {@link Graph.restoreSnapshot} can rebuild
 * intermediate state via lifecycle-aware replay (DS-14 Q9). Each frame
 * decomposes a single graph diff into one DS-14 `BaseChange<T>` envelope per
 * structural-or-value change, scoped by `lifecycle` (`"spec" | "data" |
 * "ownership"`) so callers can scope rewinds.
 *
 * The full session lock lives at
 * `archive/docs/SESSION-DS-14-storage-wal-replay.md` (Q1–Q9).
 *
 * **Q1 deviation — checksum function:** the locked decision specified BLAKE3
 * 32-byte. We ship SHA-256 32-byte instead so the package stays
 * zero-dependency (no BLAKE3 in WebCrypto; pulling `@noble/hashes` for the
 * single use case isn't worth the dep). BLAKE3 returns when the
 * post-1.0 DagCbor IPLD content-addressing codec lands and there's a real
 * ecosystem reason to match it byte-for-byte. M4 Rust impl matches with the
 * `sha2` crate. See {@link walFrameChecksum} for the canonical computation.
 *
 * @module
 */

import { stableJsonString } from "./core.js";
import type { BaseStorageTier } from "./tiers.js";

// ── WAL frame envelope ──────────────────────────────────────────────────────

/**
 * On-disk WAL frame (DS-14-storage Q1 lock — checksum substituted SHA-256
 * per the deviation noted in the module header).
 *
 * Two seq fields and two timestamp fields are intentional:
 *
 * - `frame_seq` ≠ `change.seq` — `change.seq` is the bundle's `mutations`
 *   cursor (DS-14 T1); `frame_seq` is the WAL tier's own cursor (this
 *   record's position in the WAL stream). Replay uses `frame_seq` for
 *   ordering; `change.seq` is only relevant for bundle-level cursor
 *   restoration.
 * - `frame_t_ns` ≠ `change.t_ns` — `change.t_ns` is the wall clock at
 *   mutation entry; `frame_t_ns` is the wall clock at WAL-write time. Under
 *   debounced tiers they differ by `debounceMs`. Forensics + drift detection
 *   want both.
 *
 * The bridge wire format (DS-14 PART 5 worker bridge) is the schema-narrowed
 * subset `{ t:"c", lifecycle, path, change }` — `WALFrame<T>` is the
 * persistence-tier superset (L3 lock).
 *
 * @category extra
 */
export interface WALFrame<T = unknown> {
	/** Bridge tag — discriminator shared with DS-14 worker-bridge wire format. */
	readonly t: "c";
	/** Lifecycle scope (DS-14 PART 4). Determines replay phase ordering. */
	readonly lifecycle: "spec" | "data" | "ownership";
	/** Target node / bundle path (per-graph qualified path). */
	readonly path: string;
	/** DS-14 universal `BaseChange<T>` envelope — structure-tagged delta. */
	readonly change: WALBaseChange<T>;
	/** WAL-tier monotonic cursor (uniquely owned by the WAL tier writer). */
	readonly frame_seq: number;
	/** Wall clock at WAL-write time (`wallClockNs()`). */
	readonly frame_t_ns: number;
	/**
	 * SHA-256 over the canonical-JSON encoding of the frame body
	 * (everything except `checksum` itself), encoded as a 64-char lowercase
	 * hex string for codec-friendliness. Equality is exact-string match
	 * across impls because the canonical JSON is byte-identical.
	 *
	 * Q1 deviation: BLAKE3 in the locked design; SHA-256 in this impl. See
	 * module header. Hex (vs raw bytes) is a TS-side encoding choice — the
	 * `jsonCodec` default would corrupt `Uint8Array` to a numeric-key dict
	 * on roundtrip; M4 Rust impl matches via `hex` crate output.
	 */
	readonly checksum: string;
}

/**
 * Minimal `BaseChange<T>` shape this module references. The full canonical
 * type lives at [extra/data-structures/change.ts](../data-structures/change.ts);
 * this re-statement avoids the cross-folder import cycle for the typed-only
 * frame envelope.
 *
 * @internal
 */
export interface WALBaseChange<T> {
	readonly structure: string;
	readonly version: number | string;
	readonly t_ns: number;
	readonly seq?: number;
	readonly lifecycle: "spec" | "data" | "ownership";
	readonly change: T;
}

// ── Key format ──────────────────────────────────────────────────────────────

/**
 * Default WAL prefix relative to a `graph.name`. Frames land at
 * `${graph.name}/${WAL_KEY_SEGMENT}/${frame_seq.padStart(20)}`.
 *
 * @category extra
 */
export const WAL_KEY_SEGMENT = "wal";

/**
 * Pad width for `frame_seq` in WAL keys. 20 digits keeps lex-ASC = numeric
 * ASC up to `frame_seq < 10^20` (safe — `frame_seq` is JS `number`, capped
 * at `Number.MAX_SAFE_INTEGER` < 10^16).
 */
export const WAL_FRAME_SEQ_PAD = 20;

/**
 * Build the canonical WAL frame key. `prefix` is the WAL-prefix portion
 * (e.g. `"my-graph/wal"` for a graph named `my-graph`). `frame_seq` is the
 * per-frame WAL cursor.
 *
 * Lex-ASC string sort = numeric ASC frame_seq sort by zero-padding.
 *
 * @category extra
 */
export function walFrameKey(prefix: string, frame_seq: number): string {
	if (!Number.isInteger(frame_seq) || frame_seq < 0) {
		throw new RangeError(`walFrameKey: frame_seq must be a non-negative integer, got ${frame_seq}`);
	}
	return `${prefix}/${frame_seq.toString().padStart(WAL_FRAME_SEQ_PAD, "0")}`;
}

/** Default WAL key prefix for a graph by `graph.name`. */
export function graphWalPrefix(graphName: string): string {
	return `${graphName}/${WAL_KEY_SEGMENT}`;
}

// ── Checksum ────────────────────────────────────────────────────────────────

/**
 * Canonical-JSON encoding of the frame body sans `checksum`. Used by the
 * checksum step at write time and by the verify step at replay. Stability
 * is critical — both impls must agree byte-for-byte.
 */
function canonicalFrameBody(frame: Omit<WALFrame, "checksum">): string {
	return stableJsonString({
		t: frame.t,
		lifecycle: frame.lifecycle,
		path: frame.path,
		change: frame.change,
		frame_seq: frame.frame_seq,
		frame_t_ns: frame.frame_t_ns,
	});
}

const HEX_TABLE: string[] = (() => {
	const out: string[] = new Array(256);
	for (let i = 0; i < 256; i++) out[i] = i.toString(16).padStart(2, "0");
	return out;
})();

function bytesToHex(bytes: Uint8Array): string {
	let hex = "";
	for (let i = 0; i < bytes.length; i++) hex += HEX_TABLE[bytes[i] as number];
	return hex;
}

/**
 * Compute the SHA-256 checksum over a frame body and return it as a
 * 64-char lowercase hex string. Async because `crypto.subtle.digest` is
 * async on every supported runtime (Node 18+, browsers, Cloudflare Workers,
 * Deno). Sync alternatives would require `node:crypto` (Node-only) or a
 * pure-JS shim.
 *
 * The frame's `checksum` field is set to the result of this call before the
 * frame is written to the WAL tier.
 *
 * @category extra
 */
export async function walFrameChecksum(frame: Omit<WALFrame, "checksum">): Promise<string> {
	const bytes = new TextEncoder().encode(canonicalFrameBody(frame));
	const buf = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	return bytesToHex(new Uint8Array(buf));
}

/**
 * Verify a frame's checksum. Returns `true` on match. Used by the replay
 * path; mismatch triggers Q3 torn-write handling.
 *
 * @category extra
 */
export async function verifyWalFrameChecksum(frame: WALFrame): Promise<boolean> {
	const expected = await walFrameChecksum(frame);
	return frame.checksum === expected;
}

// ── Errors ──────────────────────────────────────────────────────────────────

/** Discriminants surfaced by tier-level WAL operations. */
export type StorageErrorCode = "backend-no-list-support" | "codec-mismatch" | "backend-error";

/**
 * Thrown by the storage tier when a precondition fails (backend lacks
 * required capability, codec doesn't match, etc.). Distinct from
 * {@link RestoreError} which is replay-time.
 *
 * @category extra
 */
export class StorageError extends Error {
	readonly code: StorageErrorCode;
	readonly details: Readonly<Record<string, unknown>>;

	constructor(
		code: StorageErrorCode,
		message: string,
		details: Readonly<Record<string, unknown>> = {},
	) {
		super(message);
		this.name = "StorageError";
		this.code = code;
		this.details = details;
	}
}

/** Discriminants surfaced by `Graph.restoreSnapshot({ mode: "diff" })`. */
export type RestoreErrorCode =
	| "phase-failed"
	| "torn-write-mid-stream"
	| "baseline-missing"
	| "codec-mismatch"
	| "wal-tier-required";

/**
 * Thrown by `Graph.restoreSnapshot({ mode: "diff" })` when replay can't
 * complete (a phase's `batch()` rejected, a mid-stream frame's checksum
 * failed, no baseline was found, etc.). Distinct from {@link StorageError}
 * which is tier-level.
 *
 * @category extra
 */
export class RestoreError extends Error {
	readonly code: RestoreErrorCode;
	readonly details: Readonly<Record<string, unknown>>;

	constructor(
		code: RestoreErrorCode,
		message: string,
		details: Readonly<Record<string, unknown>> = {},
	) {
		super(message);
		this.name = "RestoreError";
		this.code = code;
		this.details = details;
	}
}

// ── Restore result ──────────────────────────────────────────────────────────

/**
 * Telemetry returned by `Graph.restoreSnapshot({ mode: "diff" })`. Inspection-as-
 * test-harness shape — every field is observable for tests + dry-run audit
 * per CLAUDE.md "Dry-run equivalence rule".
 *
 * @category extra
 */
export interface RestoreResult {
	/** Total frames applied (across all phases). */
	readonly replayedFrames: number;
	/** Frames that failed checksum at WAL tail and were dropped per Q3. */
	readonly skippedFrames: number;
	/** Highest `frame_seq` applied. Zero if no frames were replayed. */
	readonly finalSeq: number;
	/** Per-lifecycle phase breakdown (in cross-scope replay order). */
	readonly phases: readonly {
		readonly lifecycle: "spec" | "data" | "ownership";
		readonly frames: number;
	}[];
}

// ── Replay helpers ──────────────────────────────────────────────────────────

/**
 * Cross-scope replay order (DS-14 PART 4 lock — `spec → data → ownership`).
 * Exported so the replay implementation and parity tests share one source of
 * truth.
 */
export const REPLAY_ORDER: readonly ("spec" | "data" | "ownership")[] = Object.freeze([
	"spec",
	"data",
	"ownership",
] as const);

/**
 * Iterate WAL frames under a prefix in `frame_seq` ASC order. Wraps a tier's
 * {@link BaseStorageTier.listByPrefix} with the contract this module
 * requires (lazy iteration, ordered keys, decode-on-yield).
 *
 * Throws {@link StorageError} `backend-no-list-support` on first yield if
 * the tier doesn't expose `listByPrefix`.
 *
 * @category extra
 */
export async function* iterateWalFrames<T = unknown>(
	tier: BaseStorageTier,
	prefix: string,
): AsyncIterable<{ key: string; frame: WALFrame<T> }> {
	const listByPrefix = tier.listByPrefix;
	if (typeof listByPrefix !== "function") {
		throw new StorageError(
			"backend-no-list-support",
			`storage tier "${tier.name}" does not implement listByPrefix; WAL replay requires it`,
			{ tier: tier.name },
		);
	}
	for await (const entry of listByPrefix.call(tier, prefix) as AsyncIterable<{
		key: string;
		value: unknown;
	}>) {
		yield { key: entry.key, frame: entry.value as WALFrame<T> };
	}
}
