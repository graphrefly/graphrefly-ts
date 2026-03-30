/**
 * GraphReFly message protocol — §1 `~/src/graphrefly/GRAPHREFLY-SPEC.md`.
 * Emissions are always `[[Type, Data?], ...]` (no single-tuple shorthand).
 */

/** Value delivery (`DATA`, value). */
export const DATA = Symbol.for("graphrefly/DATA");
/** Phase 1: value about to change */
export const DIRTY = Symbol.for("graphrefly/DIRTY");
/** Phase 2: dirty pass completed, value unchanged */
export const RESOLVED = Symbol.for("graphrefly/RESOLVED");
/** Clear cached state; do not auto-emit */
export const INVALIDATE = Symbol.for("graphrefly/INVALIDATE");
/** Suspend activity */
export const PAUSE = Symbol.for("graphrefly/PAUSE");
/** Resume after pause */
export const RESUME = Symbol.for("graphrefly/RESUME");
/** Permanent cleanup */
export const TEARDOWN = Symbol.for("graphrefly/TEARDOWN");
/** Clean termination */
export const COMPLETE = Symbol.for("graphrefly/COMPLETE");
/** Error termination */
export const ERROR = Symbol.for("graphrefly/ERROR");

/** Known protocol type symbols (open set — other symbols are valid and forward). */
export const knownMessageTypes: readonly symbol[] = [
	DATA,
	DIRTY,
	RESOLVED,
	INVALIDATE,
	PAUSE,
	RESUME,
	TEARDOWN,
	COMPLETE,
	ERROR,
];

/** One protocol tuple: `[Type, optional payload]`. */
export type Message = readonly [symbol, unknown?];

/**
 * A batch of tuples — the wire shape for `node.down()` / `node.up()`.
 */
export type Messages = readonly Message[];

/**
 * Whether `t` is one of the built-in protocol symbols in this module.
 *
 * @param t — Message type symbol (unknown types are still valid; they must forward).
 * @returns `true` for `DATA`, `DIRTY`, `RESOLVED`, etc.
 */
export function isKnownMessageType(t: symbol): boolean {
	return knownMessageTypes.includes(t);
}

/**
 * Whether this tuple is deferred by `batch()` (phase 2: `DATA` or `RESOLVED`).
 *
 * @param msg — Single message tuple.
 */
export function isPhase2Message(msg: Message): boolean {
	const t = msg[0];
	return t === DATA || t === RESOLVED;
}
