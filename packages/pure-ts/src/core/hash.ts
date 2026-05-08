/**
 * Cross-environment sha256. Uses `globalThis.crypto.subtle.digest` which is
 * available in Node 18+ (via `webcrypto`) and in every browser. No `node:*`
 * imports — safe to pull into browser bundles.
 *
 * **Async by design.** `crypto.subtle.digest` returns a `Promise<ArrayBuffer>`.
 * Synchronous sha256 requires platform-specific shims (`node:crypto` on Node,
 * a pure-JS fallback on browsers). Keeping this async cuts that fork entirely;
 * callers that need a hash for key computation run inside an `async` context
 * already (every LLM `invoke` / cache write path is async).
 *
 * @module
 */

/** Return the hex sha256 of `input`. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
	const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
	const buf = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	const view = new Uint8Array(buf);
	// Pre-allocated hex lookup table — faster than `.toString(16).padStart(2, "0")`
	// on hot paths (~4× speedup in microbench). 64-char hex output.
	let out = "";
	for (let i = 0; i < view.length; i++) {
		out += HEX[view[i] as number];
	}
	return out;
}

const HEX: string[] = new Array(256);
for (let i = 0; i < 256; i++) HEX[i] = i.toString(16).padStart(2, "0");
