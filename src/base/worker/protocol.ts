/**
 * Wire protocol for worker bridge communication.
 *
 * Graph-local signals ({@link isLocalOnly}) stay local to each side's
 * reactive graph. DATA values cross via coalescing; RESOLVED/COMPLETE/TEARDOWN
 * as signals; ERROR as serialized payloads.
 *
 * Lifecycle signals serialize as string names since Symbols can't survive
 * structured clone. Unknown {@link Symbol.for} symbols are round-tripped
 * via their registered key.
 */

import {
	COMPLETE,
	ERROR,
	INVALIDATE,
	PAUSE,
	RESUME,
	TEARDOWN,
} from "@graphrefly/pure-ts/core";

// ---------------------------------------------------------------------------
// Wire message types
// ---------------------------------------------------------------------------

/** Value update — one node changed. */
export interface ValueMessage {
	t: "v";
	/** Node name. */
	s: string;
	/** Serialized value. */
	d: unknown;
}

/** Lifecycle signal — serialized symbol name. */
export interface SignalMessage {
	t: "s";
	/** Node name, or `"*"` for bridge-wide. */
	s: string;
	/** Signal name string (e.g. "TEARDOWN"). */
	sig: string;
	/** Optional payload for custom symbols (spec §1.3.6 forward unchanged). */
	d?: unknown;
}

/** Ready — worker declares its exported nodes with initial values. */
export interface ReadyMessage {
	t: "r";
	stores: Record<string, unknown>;
}

/** Init — main sends initial values of its exposed nodes. */
export interface InitMessage {
	t: "i";
	stores: Record<string, unknown>;
}

/** Batch value update — multiple nodes changed in one reactive cycle. */
export interface BatchMessage {
	t: "b";
	u: Record<string, unknown>;
	/** V0 versions per node for delta sync — peer skips if version <= lastSeen (§6.0b). */
	v?: Record<string, number>;
}

/** Error payload — serialized since Error objects don't survive structured clone. */
export interface ErrorMessage {
	t: "e";
	/** Node name. */
	s: string;
	/** Serialized error. */
	err: { message: string; name: string; stack?: string };
}

export type BridgeMessage =
	| ValueMessage
	| SignalMessage
	| ReadyMessage
	| InitMessage
	| BatchMessage
	| ErrorMessage;

// ---------------------------------------------------------------------------
// Signal serialization — Symbol <-> string for structured clone
// ---------------------------------------------------------------------------

const signalToNameMap = new Map<symbol, string>([
	[INVALIDATE, "INVALIDATE"],
	[PAUSE, "PAUSE"],
	[RESUME, "RESUME"],
	[TEARDOWN, "TEARDOWN"],
	[COMPLETE, "COMPLETE"],
	[ERROR, "ERROR"],
]);

const nameToSignalMap = new Map<string, symbol>([
	["INVALIDATE", INVALIDATE],
	["PAUSE", PAUSE],
	["RESUME", RESUME],
	["TEARDOWN", TEARDOWN],
	["COMPLETE", COMPLETE],
	["ERROR", ERROR],
]);

/**
 * Serialize a message type symbol to a string for structured clone transfer.
 *
 * Known GraphReFly symbols map to their canonical names. Unknown symbols
 * registered via {@link Symbol.for} use their registered key. Unregistered
 * symbols return `"UNKNOWN"`.
 */
export function signalToName(s: symbol): string {
	const known = signalToNameMap.get(s);
	if (known) return known;
	const key = Symbol.keyFor(s);
	return key ?? "UNKNOWN";
}

/**
 * Deserialize a string back to a message type symbol.
 *
 * Known GraphReFly names map to their canonical symbols. Other non-empty
 * strings are reconstructed via {@link Symbol.for} (round-trip safe for
 * custom message types). Returns `undefined` for `"UNKNOWN"`.
 */
export function nameToSignal(name: string): symbol | undefined {
	const known = nameToSignalMap.get(name);
	if (known) return known;
	if (name && name !== "UNKNOWN") return Symbol.for(name);
	return undefined;
}

/** Serialize an error for structured clone transfer. */
export function serializeError(err: unknown): { message: string; name: string; stack?: string } {
	if (err instanceof Error) {
		return { message: err.message, name: err.name, stack: err.stack };
	}
	return { message: String(err), name: "Error" };
}

/** Deserialize an error payload back to an Error object. */
export function deserializeError(payload: {
	message: string;
	name: string;
	stack?: string;
}): Error {
	const err = new Error(payload.message);
	err.name = payload.name;
	if (payload.stack) err.stack = payload.stack;
	return err;
}
