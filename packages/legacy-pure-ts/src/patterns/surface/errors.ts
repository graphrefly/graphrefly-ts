/**
 * Typed errors for the surface layer (§9.3-core).
 *
 * The surface layer is consumed by `@graphrefly/mcp-server` and
 * `@graphrefly/cli`. Both have native error channels (MCP's `isError` flag,
 * CLI's exit codes), so surface functions throw a {@link SurfaceError}
 * carrying a structured code + details payload that wrappers can map to
 * their native shape. No `Result` envelope — keep the callsite idiom
 * `try/catch` and let each wrapper surface the error its own way.
 *
 * @module
 */

/** Structured error codes emitted by the surface layer. JSON-safe. */
export type SurfaceErrorCode =
	| "invalid-spec"
	| "graph-not-found"
	| "graph-exists"
	| "snapshot-not-found"
	| "node-not-found"
	| "reduce-timeout"
	| "catalog-error"
	| "restore-failed"
	| "snapshot-failed"
	| "tier-no-list"
	| "compose-not-configured"
	| "compose-failed"
	| "internal-error";

/** JSON-safe shape surfaces should echo back through the wrapper. */
export interface SurfaceErrorPayload {
	code: SurfaceErrorCode;
	message: string;
	/** Optional structured detail; must be JSON-safe. */
	details?: Readonly<Record<string, unknown>>;
}

/**
 * Thrown by surface layer functions on failure. `code` is the stable
 * machine-readable identifier; `details` carries structured context
 * (e.g. `validateSpec` errors, missing path name). Both fields round-trip
 * through `toJSON()` for wrappers that serialize errors over the wire.
 */
export class SurfaceError extends Error {
	readonly code: SurfaceErrorCode;
	readonly details?: Readonly<Record<string, unknown>>;

	constructor(
		code: SurfaceErrorCode,
		message: string,
		details?: Readonly<Record<string, unknown>>,
	) {
		super(message);
		this.name = "SurfaceError";
		this.code = code;
		if (details !== undefined) this.details = details;
	}

	/**
	 * JSON-safe payload for wire serialization. Defensively validates
	 * `details` — if it can't be round-tripped through `JSON.stringify`
	 * (cyclic refs, `BigInt`, `Error` instance not pre-toJSON'd), the
	 * payload falls back to `{code, message}` only rather than crashing
	 * the MCP/CLI wrapper when it serializes this error onto the wire.
	 */
	toJSON(): SurfaceErrorPayload {
		const out: SurfaceErrorPayload = { code: this.code, message: this.message };
		if (this.details !== undefined) {
			const safe = safeDetails(this.details);
			if (safe !== undefined) out.details = safe;
		}
		return out;
	}
}

function safeDetails(
	details: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
	try {
		// Round-trip through JSON to strip non-serializable values (functions,
		// undefined) and reject cyclic structures with a thrown TypeError. The
		// round-trip result is the canonical wire shape.
		return JSON.parse(JSON.stringify(details)) as Readonly<Record<string, unknown>>;
	} catch {
		return undefined;
	}
}

/** Wrap any thrown value as a SurfaceError. Idempotent on existing SurfaceError. */
export function asSurfaceError(
	err: unknown,
	fallbackCode: SurfaceErrorCode = "internal-error",
): SurfaceError {
	if (err instanceof SurfaceError) return err;
	const message = err instanceof Error ? err.message : String(err);
	return new SurfaceError(fallbackCode, message);
}
