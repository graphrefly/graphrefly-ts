/**
 * Surface: snapshot save/restore/diff/list over {@link KvStorageTier} (§9.3-core).
 *
 * One-shot snapshot management for stateless callers (MCP tools, CLI
 * commands) layered on the existing multi-tier auto-checkpoint substrate.
 * A saved snapshot is a `mode: "full"` {@link GraphCheckpointRecord} with
 * `seq: 0` — byte-identical to the baseline anchor
 * {@link Graph.attachSnapshotStorage} writes on its first flush. An
 * auto-checkpointed graph can therefore be restored through this surface,
 * and a surface-saved snapshot can be picked up by `attachSnapshotStorage({
 * autoRestore: true })`.
 *
 * The wire envelope stays at {@link SNAPSHOT_WIRE_VERSION}; no new format.
 *
 * @module
 */

import { wallClockNs } from "@graphrefly/pure-ts/core";
import type { KvStorageTier } from "@graphrefly/pure-ts/extra";
import type {
	GraphCheckpointRecord,
	GraphDiffResult,
	GraphNodeFactory,
	GraphPersistSnapshot,
} from "@graphrefly/pure-ts/graph";
import { Graph, SNAPSHOT_VERSION } from "@graphrefly/pure-ts/graph";
import { SurfaceError } from "./errors.js";

/**
 * Current envelope version. Re-exported from `graph.ts` so the one-shot
 * surface path and `Graph.attachSnapshotStorage` write byte-identical
 * `format_version` fields — no silent wire drift.
 */
export const SNAPSHOT_WIRE_VERSION = SNAPSHOT_VERSION;

/** Shape returned by {@link saveSnapshot}. */
export interface SaveSnapshotResult {
	snapshotId: string;
	timestamp_ns: number;
}

/** Options for {@link restoreSnapshot}. */
export interface RestoreSnapshotOptions {
	/** Passthrough to `Graph.fromSnapshot`. First matching pattern wins. */
	factories?: Record<string, GraphNodeFactory>;
}

/**
 * Key prefix applied to every surface-written snapshot record. Isolates
 * surface-saved snapshots from other keys on the same tier (notably
 * `attachSnapshotStorage` baseline/WAL keys written under `graph.name`).
 */
export const SNAPSHOT_KEY_PREFIX = "snapshot:";

/**
 * Reject caller-supplied ids that start with {@link SNAPSHOT_KEY_PREFIX}.
 *
 * Surface ids are keyed in the caller's external namespace; the `"snapshot:"`
 * prefix is an implementation detail of tier layout. Allowing `"snapshot:foo"`
 * through would produce surprising round-trips — `deleteSnapshot("foo")` and
 * `deleteSnapshot("snapshot:foo")` would both target the same tier key, while
 * `listSnapshots()` decodes to `"foo"` — so we enforce disjointness at the API
 * boundary (pre-1.0, no back-compat).
 */
function assertExternalId(snapshotId: string): void {
	if (snapshotId.startsWith(SNAPSHOT_KEY_PREFIX)) {
		throw new SurfaceError(
			"snapshot-failed",
			`snapshot id must not start with "${SNAPSHOT_KEY_PREFIX}" (reserved); got "${snapshotId}"`,
			{ snapshotId },
		);
	}
}

function encodeKey(snapshotId: string): string {
	return `${SNAPSHOT_KEY_PREFIX}${snapshotId}`;
}

function decodeKey(key: string): string | undefined {
	return key.startsWith(SNAPSHOT_KEY_PREFIX) ? key.slice(SNAPSHOT_KEY_PREFIX.length) : undefined;
}

function unwrapCheckpoint(raw: unknown, snapshotId: string): GraphPersistSnapshot {
	if (raw == null || typeof raw !== "object") {
		throw new SurfaceError("snapshot-not-found", `snapshot "${snapshotId}" not found in tier`, {
			snapshotId,
		});
	}
	// Accept both wrapped (GraphCheckpointRecord) and bare
	// (GraphPersistSnapshot) payloads — attachSnapshotStorage writes wrapped, a user
	// may also hand us a bare one via dictKv for tests.
	const record = raw as Record<string, unknown>;
	if ("mode" in record) {
		if (record.mode === "full" && "snapshot" in record) {
			return record.snapshot as GraphPersistSnapshot;
		}
		if (record.mode === "diff") {
			throw new SurfaceError(
				"restore-failed",
				`snapshot "${snapshotId}" is a diff record (legacy/non-paired tier write); under the Phase 14.6 paired-tier shape snapshot tiers hold only baselines. For WAL replay use Graph.restoreSnapshot({ mode: "diff", source: { tier, walTier } }).`,
				{ snapshotId, mode: "diff" },
			);
		}
		throw new SurfaceError(
			"restore-failed",
			`snapshot "${snapshotId}" has unknown mode "${String(record.mode)}"`,
			{ snapshotId, mode: String(record.mode) },
		);
	}
	if ("nodes" in record && "edges" in record && "subgraphs" in record && "name" in record) {
		return record as unknown as GraphPersistSnapshot;
	}
	throw new SurfaceError(
		"restore-failed",
		`snapshot "${snapshotId}" payload is not a GraphCheckpointRecord or GraphPersistSnapshot`,
		{ snapshotId },
	);
}

/**
 * Write a graph's current state as a one-shot `mode: "full"` record.
 *
 * Uses the same {@link GraphCheckpointRecord} envelope as
 * {@link Graph.attachSnapshotStorage} so the two persistence paths interoperate.
 *
 * @throws {SurfaceError} `snapshot-failed` when the tier's `save` throws.
 */
export async function saveSnapshot(
	graph: Graph,
	snapshotId: string,
	tier: KvStorageTier,
): Promise<SaveSnapshotResult> {
	assertExternalId(snapshotId);
	let snapshot: GraphPersistSnapshot;
	try {
		snapshot = graph.snapshot();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new SurfaceError(
			"snapshot-failed",
			`snapshot "${snapshotId}" serialization failed: ${message}`,
			{ snapshotId },
		);
	}
	const record: GraphCheckpointRecord = {
		name: graph.name,
		mode: "full",
		seq: 0,
		timestamp_ns: wallClockNs(),
		format_version: SNAPSHOT_WIRE_VERSION,
		snapshot,
	};
	try {
		await tier.save(encodeKey(snapshotId), record);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new SurfaceError("snapshot-failed", `snapshot "${snapshotId}" save failed: ${message}`, {
			snapshotId,
		});
	}
	return { snapshotId, timestamp_ns: record.timestamp_ns };
}

/**
 * Load a snapshot from a tier and materialize it as a new {@link Graph}.
 *
 * Uses {@link Graph.fromSnapshot} to reconstruct topology; pass
 * `factories` when the graph includes non-state nodes that the default
 * hydrator can't rebuild on its own.
 *
 * **Requires a `mode: "full"` record.** Surface-written snapshots from
 * {@link saveSnapshot} always qualify. Records written by
 * {@link Graph.attachSnapshotStorage} with `compactEvery > 1` may be
 * `mode: "diff"` between compacts — those throw `restore-failed` until
 * the tier's next compact flush (or until Phase 8.7 WAL replay lands).
 * If you need interop during development, either call
 * {@link saveSnapshot} explicitly (always full) or configure
 * `attachSnapshotStorage({compactEvery: 1})`.
 *
 * @throws {SurfaceError} `snapshot-not-found` on miss; `restore-failed`
 *   when the payload shape doesn't match, when the record is
 *   `mode: "diff"`, or when `Graph.fromSnapshot` rejects.
 */
export async function restoreSnapshot(
	snapshotId: string,
	tier: KvStorageTier,
	opts?: RestoreSnapshotOptions,
): Promise<Graph> {
	assertExternalId(snapshotId);
	// Try namespaced key first (surface-written records), fall back to raw key
	// so callers restoring snapshots that predate the namespacing change (or
	// bare `GraphPersistSnapshot` payloads written by user test fixtures)
	// still resolve. Once all writers are on encodeKey, the fallback can go.
	const key = encodeKey(snapshotId);
	let raw = await tier.load(key);
	if (raw === undefined) {
		raw = await tier.load(snapshotId);
	}
	const snapshot = unwrapCheckpoint(raw, snapshotId);
	try {
		return Graph.fromSnapshot(
			snapshot,
			opts?.factories ? { factories: opts.factories } : undefined,
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new SurfaceError(
			"restore-failed",
			`snapshot "${snapshotId}" restore failed: ${message}`,
			{
				snapshotId,
			},
		);
	}
}

/**
 * Load two snapshots and compute a {@link GraphDiffResult} via static
 * {@link Graph.diff}. Returns the audit shape (structural + value diff,
 * no payload); use {@link diffForWAL} directly for WAL-oriented diffs.
 *
 * @throws {SurfaceError} `snapshot-not-found` on either miss.
 */
export async function diffSnapshots(
	snapshotIdA: string,
	snapshotIdB: string,
	tier: KvStorageTier,
): Promise<GraphDiffResult> {
	assertExternalId(snapshotIdA);
	assertExternalId(snapshotIdB);
	const loadWithFallback = async (id: string): Promise<unknown> => {
		const key = encodeKey(id);
		let raw = await tier.load(key);
		if (raw === undefined) raw = await tier.load(id);
		return raw;
	};
	const [rawA, rawB] = await Promise.all([
		loadWithFallback(snapshotIdA),
		loadWithFallback(snapshotIdB),
	]);
	const snapshotA = unwrapCheckpoint(rawA, snapshotIdA);
	const snapshotB = unwrapCheckpoint(rawB, snapshotIdB);
	return Graph.diff(snapshotA, snapshotB);
}

/**
 * Enumerate snapshot ids on a tier.
 *
 * Only keys written by {@link saveSnapshot} are returned. Surface-written
 * records are stored under the `"snapshot:"` key prefix and decoded back to
 * the caller-visible id before being returned — other keys on the same tier
 * (notably `attachSnapshotStorage` baseline/WAL keys written under `graph.name`) are
 * filtered out automatically. This lets a single tier back both the surface
 * and `attachSnapshotStorage` without leaking graph names through `listSnapshots`.
 *
 * @param tier — the storage tier to enumerate.
 * @param opts.includeUnprefixed — when `true`, also return keys that are
 *   NOT under the namespacing prefix. Off by default; set this when reading
 *   pre-namespacing snapshot sets.
 *
 *   **Caveat:** when a tier is shared with {@link Graph.attachSnapshotStorage}, its
 *   auto-checkpoint baseline + WAL keys (written under `graph.name`) are
 *   unprefixed. Calling with `includeUnprefixed: true` returns those keys
 *   alongside surface snapshots — and subsequent `restoreSnapshot` /
 *   `deleteSnapshot` will operate on them via the fallback-lookup path,
 *   potentially overwriting or deleting live auto-checkpoint state. Use
 *   `includeUnprefixed` only against tiers you know are NOT shared with
 *   `attachSnapshotStorage`, or follow up with a predicate filter to separate
 *   ids you own from ones owned by other subsystems.
 *
 * @throws {SurfaceError} `tier-no-list` when the tier does not implement
 *   the optional `list()` method. Check `typeof tier.list === "function"`
 *   before calling if you want to branch on capability.
 */
export async function listSnapshots(
	tier: KvStorageTier,
	opts?: { includeUnprefixed?: boolean },
): Promise<readonly string[]> {
	if (typeof tier.list !== "function") {
		throw new SurfaceError(
			"tier-no-list",
			"KvStorageTier does not implement list(); wrap the tier with an enumerator or use a different backend",
		);
	}
	const keys = await tier.list();
	const result: string[] = [];
	const includeUnprefixed = opts?.includeUnprefixed === true;
	for (const k of keys) {
		const decoded = decodeKey(k);
		if (decoded !== undefined) result.push(decoded);
		else if (includeUnprefixed) result.push(k);
	}
	return result;
}

/**
 * Delete a snapshot from a tier.
 *
 * Silent on miss (clear semantics). `tier.clear` is optional — throws
 * `snapshot-failed` when the tier is append-only.
 *
 * @throws {SurfaceError} `snapshot-failed` when `clear` is unsupported
 *   or throws.
 */
export async function deleteSnapshot(snapshotId: string, tier: KvStorageTier): Promise<void> {
	assertExternalId(snapshotId);
	if (typeof tier.delete !== "function") {
		throw new SurfaceError(
			"snapshot-failed",
			`KvStorageTier is append-only (no delete()); cannot delete "${snapshotId}"`,
			{ snapshotId },
		);
	}
	try {
		await tier.delete(encodeKey(snapshotId));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new SurfaceError(
			"snapshot-failed",
			`snapshot "${snapshotId}" delete failed: ${message}`,
			{
				snapshotId,
			},
		);
	}
}
