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

// Runtime-agnostic — no `node:crypto` import. `randomUUID` comes from Web
// Crypto (`globalThis.crypto.randomUUID()`), available in Node 14.17+,
// browsers, Deno, Bun, and Cloudflare Workers. The default content hash is a
// vendored sync SHA-256 (see `sha256Hex` below) so versioning stays callable
// from any runtime — `crypto.subtle.digest` is async and can't back a
// synchronous `defaultHash`.

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
		if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
			throw new TypeError(
				`Cannot hash integer outside safe range (|n| > 2^53-1): ${value}. ` +
					"Cross-language cid parity is not guaranteed for unsafe integers.",
			);
		}
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

// SHA-256 round constants (FIPS 180-4).
const SHA256_K = /* @__PURE__ */ new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const UTF8_ENCODER = /* @__PURE__ */ new TextEncoder();

/**
 * Sync SHA-256 of a UTF-8 string, returned as a lowercase hex digest. Matches
 * Node `crypto.createHash("sha256").update(msg).digest("hex")` byte-for-byte.
 *
 * Runtime-agnostic (no `node:crypto`, no `crypto.subtle`). Small enough to
 * inline rather than pulling a dependency; called only from `defaultHash`,
 * which runs once per DATA on versioned nodes, so per-call allocation is
 * acceptable. Callers that need a faster path override via
 * `NodeOptions.versioningHash`.
 */
function sha256Hex(msg: string): string {
	const bytes = UTF8_ENCODER.encode(msg);
	const msgLen = bytes.length;
	const bitLen = msgLen * 8;
	// Pad to multiple of 64: 0x80 byte + zeros + 8-byte big-endian bit length.
	const totalLen = (msgLen + 9 + 63) & ~63;
	const padded = new Uint8Array(totalLen);
	padded.set(bytes);
	padded[msgLen] = 0x80;
	const dv = new DataView(padded.buffer);
	// Bit length as big-endian 64-bit int. JS numbers are 53-bit safe, so we
	// split into two 32-bit halves; messages up to 2^53 bits are supported.
	dv.setUint32(totalLen - 4, bitLen >>> 0, false);
	dv.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000) >>> 0, false);

	// Initial hash values (first 32 bits of fractional parts of sqrt of first 8 primes).
	let h0 = 0x6a09e667;
	let h1 = 0xbb67ae85;
	let h2 = 0x3c6ef372;
	let h3 = 0xa54ff53a;
	let h4 = 0x510e527f;
	let h5 = 0x9b05688c;
	let h6 = 0x1f83d9ab;
	let h7 = 0x5be0cd19;

	const W = new Uint32Array(64);
	const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

	for (let off = 0; off < totalLen; off += 64) {
		for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4, false);
		for (let i = 16; i < 64; i++) {
			const w15 = W[i - 15];
			const w2 = W[i - 2];
			const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
			const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
			W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
		}

		let a = h0;
		let b = h1;
		let c = h2;
		let d = h3;
		let e = h4;
		let f = h5;
		let g = h6;
		let h = h7;

		for (let i = 0; i < 64; i++) {
			const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const ch = (e & f) ^ (~e & g);
			const t1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
			const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
			const mj = (a & b) ^ (a & c) ^ (b & c);
			const t2 = (S0 + mj) >>> 0;
			h = g;
			g = f;
			f = e;
			e = (d + t1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (t1 + t2) >>> 0;
		}

		h0 = (h0 + a) >>> 0;
		h1 = (h1 + b) >>> 0;
		h2 = (h2 + c) >>> 0;
		h3 = (h3 + d) >>> 0;
		h4 = (h4 + e) >>> 0;
		h5 = (h5 + f) >>> 0;
		h6 = (h6 + g) >>> 0;
		h7 = (h7 + h) >>> 0;
	}

	const toHex = (x: number): string => x.toString(16).padStart(8, "0");
	return (
		toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7)
	);
}

/**
 * Default content hash: SHA-256 of deterministic JSON, truncated to 16 hex
 * chars (~64-bit). Uses {@link canonicalizeForHash} for cross-language parity
 * with Python `default_hash`.
 */
export function defaultHash(value: unknown): string {
	const canonical = canonicalizeForHash(value ?? null);
	const json = JSON.stringify(canonical);
	return sha256Hex(json).slice(0, 16);
}

/**
 * Cross-runtime UUID generator. Uses Web Crypto (`globalThis.crypto.randomUUID`)
 * when available. Falls back to a tiny `Math.random`-seeded RFC 4122 v4
 * generator for environments that omit `crypto.randomUUID` — identity only,
 * not cryptographic.
 */
function randomUuid(): string {
	const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
	if (c?.randomUUID) return c.randomUUID();
	// Fallback (extremely rare — only hits on very old runtimes that expose no
	// Web Crypto at all). Not cryptographically strong.
	const r = () =>
		Math.floor(Math.random() * 0x100000000)
			.toString(16)
			.padStart(8, "0");
	const hex = r() + r() + r() + r();
	return (
		`${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
		`${((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
	);
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
	const id = opts?.id ?? randomUuid();
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
