/**
 * Node versioning — GRAPHREFLY-SPEC §7.
 *
 * Progressive, optional versioning for node identity and change tracking.
 *
 * - **V0**: `id` + `version` — identity & change detection (~16 bytes overhead)
 * - **V1**: + `cid` + `prev` — content addressing & linked history (~60 bytes overhead)
 *
 * **Lifecycle notes:**
 * - Version advances only on DATA (not RESOLVED, INVALIDATE, or TEARDOWN).
 * - `resetOnTeardown` clears the cached value but does NOT reset versioning state.
 *   After teardown, `v.cid` still reflects the last DATA value, not the cleared cache.
 *   The invariant `hash(node.get()) === v.cid` only holds in `settled`/`resolved` status.
 * - Resubscribable nodes preserve versioning across subscription lifetimes (monotonic counter).
 */

import { createHash, randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** V0: identity + monotonic version counter. */
export type V0 = {
	readonly id: string;
	version: number;
};

/** V1: V0 + content-addressed identifier + previous cid link. */
export type V1 = V0 & {
	cid: string;
	prev: string | null;
};

/** Union of all versioning info shapes. */
export type NodeVersionInfo = V0 | V1;

/** Supported versioning levels (extensible to 2, 3 later). */
export type VersioningLevel = 0 | 1;

/** Function that hashes a value to a hex string (for V1 cid). */
export type HashFn = (value: unknown) => string;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface VersioningOptions {
	/** Override auto-generated id. */
	id?: string;
	/** Custom hash function for V1 cid (default: SHA-256 truncated to 16 hex chars). */
	hash?: HashFn;
}

// ---------------------------------------------------------------------------
// Default hash
// ---------------------------------------------------------------------------

/**
 * Canonicalize a value for deterministic cross-language hashing.
 *
 * - Integer-valued floats normalize to integer strings (`1.0` → `1`).
 * - `NaN`, `Infinity`, `-Infinity` are rejected (no JSON equivalent).
 * - `undefined` normalizes to `null`.
 * - Object keys are sorted lexicographically.
 *
 * This ensures TS `JSON.stringify` and Python `json.dumps(sort_keys=True)`
 * produce identical output for the same logical value.
 */
export function canonicalizeForHash(value: unknown): unknown {
	if (value === undefined) return null;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError(`Cannot hash non-finite number: ${value}`);
		}
		// Normalize integer-valued floats: 1.0 → 1 (JS does this natively,
		// but be explicit for cross-language clarity)
		return value;
	}
	if (typeof value === "string" || typeof value === "boolean" || value === null) {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(canonicalizeForHash);
	}
	if (typeof value === "object" && value !== null) {
		const sorted: Record<string, unknown> = {};
		for (const k of Object.keys(value as Record<string, unknown>).sort()) {
			sorted[k] = canonicalizeForHash((value as Record<string, unknown>)[k]);
		}
		return sorted;
	}
	// Fallback: coerce to null (bigint, symbol, function)
	return null;
}

/**
 * Default content hash: SHA-256 of deterministic JSON, truncated to 16 hex chars (~64-bit).
 * Uses {@link canonicalizeForHash} for cross-language parity with Python `default_hash`.
 */
export function defaultHash(value: unknown): string {
	const canonical = canonicalizeForHash(value ?? null);
	const json = JSON.stringify(canonical);
	return createHash("sha256").update(json).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create initial versioning state for a node.
 *
 * @param level - 0 for V0, 1 for V1.
 * @param initialValue - The node's initial cached value (used for V1 cid).
 * @param opts - Optional overrides (id, hash).
 */
export function createVersioning(
	level: VersioningLevel,
	initialValue: unknown,
	opts?: VersioningOptions,
): NodeVersionInfo {
	const id = opts?.id ?? randomUUID();
	if (level === 0) {
		return { id, version: 0 } satisfies V0;
	}
	const hash = opts?.hash ?? defaultHash;
	const cid = hash(initialValue);
	return { id, version: 0, cid, prev: null } satisfies V1;
}

// ---------------------------------------------------------------------------
// Advance
// ---------------------------------------------------------------------------

/**
 * Advance versioning state after a DATA emission (value changed).
 *
 * Mutates `info` in place for performance (called on every DATA).
 * Only call when the cached value has actually changed (not on RESOLVED).
 *
 * @param info - The node's current versioning state.
 * @param newValue - The new cached value.
 * @param hashFn - Hash function (only used for V1).
 */
export function advanceVersion(info: NodeVersionInfo, newValue: unknown, hashFn: HashFn): void {
	info.version += 1;
	if ("cid" in info) {
		(info as V1).prev = (info as V1).cid;
		(info as V1).cid = hashFn(newValue);
	}
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Type guard: is this V1 versioning info? */
export function isV1(info: NodeVersionInfo): info is V1 {
	return "cid" in info;
}
