/**
 * GraphReFly message protocol — §1 `~/src/graphrefly/GRAPHREFLY-SPEC.md`.
 * Emissions are always `[[Type, Data?], ...]` (no single-tuple shorthand).
 *
 * ## Canonical message ordering (within a composite batch)
 *
 * When multiple message types appear in a single `down()` call, the canonical
 * delivery order is determined by **signal tier**:
 *
 * | Tier | Signals                | Role              | Batch behavior                      |
 * |------|------------------------|-------------------|-------------------------------------|
 * |  0   | DIRTY, INVALIDATE      | Notification      | Immediate (never deferred)          |
 * |  1   | PAUSE, RESUME          | Flow control      | Immediate (never deferred)          |
 * |  2   | DATA, RESOLVED         | Value settlement  | Deferred inside `batch()`           |
 * |  3   | COMPLETE, ERROR        | Terminal lifecycle | Deferred to after phase-2           |
 * |  4   | TEARDOWN               | Destruction       | Immediate (usually sent alone)      |
 *
 * **Rule:** Within `downWithBatch`, messages are partitioned by tier and delivered
 * in tier order. This ensures phase-2 values (DATA/RESOLVED) reach sinks before
 * terminal signals (COMPLETE/ERROR) mark the node as done, preventing the
 * "COMPLETE-before-DATA" class of bugs. Sources that emit in canonical order
 * naturally partition correctly with zero overhead.
 *
 * Unknown message types (forward-compat) are tier 0 (immediate).
 *
 * ## Meta node bypass rules (centralized — GRAPHREFLY-SPEC §2.3)
 *
 * - **INVALIDATE** via `graph.signal()` — no-op on meta nodes (cached values preserved).
 * - **COMPLETE / ERROR** — not propagated from parent to meta (meta outlives terminal
 *   state for post-mortem writes like setting `meta.error` after ERROR).
 * - **TEARDOWN** — propagated from parent to meta, releasing meta resources.
 */

/** Value delivery (`DATA`, value). Tier 2 — deferred inside `batch()`. */
export const DATA = Symbol.for("graphrefly/DATA");
/** Phase 1: value about to change. Tier 0 — immediate. */
export const DIRTY = Symbol.for("graphrefly/DIRTY");
/** Phase 2: dirty pass completed, value unchanged. Tier 2 — deferred inside `batch()`. */
export const RESOLVED = Symbol.for("graphrefly/RESOLVED");
/** Clear cached state; do not auto-emit. Tier 0 — immediate. */
export const INVALIDATE = Symbol.for("graphrefly/INVALIDATE");
/** Suspend activity. Tier 1 — immediate. */
export const PAUSE = Symbol.for("graphrefly/PAUSE");
/** Resume after pause. Tier 1 — immediate. */
export const RESUME = Symbol.for("graphrefly/RESUME");
/** Permanent cleanup. Tier 4 — immediate (usually sent alone). */
export const TEARDOWN = Symbol.for("graphrefly/TEARDOWN");
/** Clean termination. Tier 3 — delivered after phase-2 in the same batch. */
export const COMPLETE = Symbol.for("graphrefly/COMPLETE");
/** Error termination. Tier 3 — delivered after phase-2 in the same batch. */
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
 *
 * @example
 * ```ts
 * import { DATA, DIRTY, isKnownMessageType } from "@graphrefly/graphrefly-ts";
 *
 * isKnownMessageType(DATA);             // true
 * isKnownMessageType(Symbol("custom")); // false
 * ```
 */
export function isKnownMessageType(t: symbol): boolean {
	return knownMessageTypes.includes(t);
}

/**
 * Returns the signal tier for a message type (see module-level ordering table).
 *
 * - 0: notification (DIRTY, INVALIDATE) — immediate
 * - 1: flow control (PAUSE, RESUME) — immediate
 * - 2: value (DATA, RESOLVED) — deferred inside `batch()`
 * - 3: terminal (COMPLETE, ERROR) — delivered after phase-2
 * - 4: destruction (TEARDOWN) — immediate, usually alone
 * - 0 for unknown types (forward-compat: immediate)
 *
 * @param t — Message type symbol.
 * @returns Tier number (0–4).
 *
 * @example
 * ```ts
 * import { DATA, DIRTY, COMPLETE, TEARDOWN, messageTier } from "@graphrefly/graphrefly-ts";
 *
 * messageTier(DIRTY);    // 0
 * messageTier(DATA);     // 2
 * messageTier(COMPLETE); // 3
 * messageTier(TEARDOWN); // 4
 * ```
 */
export function messageTier(t: symbol): number {
	if (t === DIRTY || t === INVALIDATE) return 0;
	if (t === PAUSE || t === RESUME) return 1;
	if (t === DATA || t === RESOLVED) return 2;
	if (t === COMPLETE || t === ERROR) return 3;
	if (t === TEARDOWN) return 4;
	return 0; // unknown → immediate
}

/**
 * Returns whether this tuple is deferred by `batch()` (phase 2: `DATA` or `RESOLVED`).
 *
 * @param msg — Single message tuple.
 * @returns `true` if `msg` is `DATA` or `RESOLVED`.
 *
 * @example
 * ```ts
 * import { DATA, RESOLVED, DIRTY, isPhase2Message } from "@graphrefly/graphrefly-ts";
 *
 * isPhase2Message([DATA, 42]);   // true
 * isPhase2Message([RESOLVED]);   // true
 * isPhase2Message([DIRTY]);      // false
 * ```
 */
export function isPhase2Message(msg: Message): boolean {
	const t = msg[0];
	return t === DATA || t === RESOLVED;
}

/**
 * Returns whether this message type is terminal (COMPLETE or ERROR).
 * Terminal messages are delivered after phase-2 in the same batch to prevent
 * the node from becoming terminal before value messages reach sinks.
 *
 * @param t — Message type symbol.
 * @returns `true` for `COMPLETE` or `ERROR`.
 *
 * @example
 * ```ts
 * import { COMPLETE, ERROR, DATA, isTerminalMessage } from "@graphrefly/graphrefly-ts";
 *
 * isTerminalMessage(COMPLETE); // true
 * isTerminalMessage(ERROR);    // true
 * isTerminalMessage(DATA);     // false
 * ```
 */
export function isTerminalMessage(t: symbol): boolean {
	return t === COMPLETE || t === ERROR;
}

/**
 * Whether `t` should be propagated from a parent node to its companion meta nodes.
 * Only TEARDOWN propagates; COMPLETE/ERROR/INVALIDATE do not (meta outlives parent
 * terminal state for post-mortem writes).
 *
 * @param t — Message type symbol.
 * @returns `true` if the signal should reach meta nodes.
 *
 * @example
 * ```ts
 * import { TEARDOWN, COMPLETE, ERROR, propagatesToMeta } from "@graphrefly/graphrefly-ts";
 *
 * propagatesToMeta(TEARDOWN); // true
 * propagatesToMeta(COMPLETE); // false
 * propagatesToMeta(ERROR);    // false
 * ```
 */
export function propagatesToMeta(t: symbol): boolean {
	return t === TEARDOWN;
}
