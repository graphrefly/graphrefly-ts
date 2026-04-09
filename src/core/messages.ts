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
 * |  0   | START                  | Subscribe handshake | Immediate (never deferred)        |
 * |  1   | DIRTY, INVALIDATE      | Notification      | Immediate (never deferred)          |
 * |  2   | PAUSE, RESUME          | Flow control      | Immediate (never deferred)          |
 * |  3   | DATA, RESOLVED         | Value settlement  | Deferred inside `batch()`           |
 * |  4   | COMPLETE, ERROR        | Terminal lifecycle | Deferred to after phase-2          |
 * |  5   | TEARDOWN               | Destruction       | Immediate (usually sent alone)      |
 *
 * **Rule:** Within `downWithBatch`, messages are partitioned by tier and delivered
 * in tier order. This ensures phase-2 values (DATA/RESOLVED) reach sinks before
 * terminal signals (COMPLETE/ERROR) mark the node as done, preventing the
 * "COMPLETE-before-DATA" class of bugs. Sources that emit in canonical order
 * naturally partition correctly with zero overhead.
 *
 * Unknown message types (forward-compat) are tier 1 (immediate).
 *
 * ## Meta node bypass rules (centralized — GRAPHREFLY-SPEC §2.3)
 *
 * - **INVALIDATE** via `graph.signal()` — no-op on meta nodes (cached values preserved).
 * - **COMPLETE / ERROR** — not propagated from parent to meta (meta outlives terminal
 *   state for post-mortem writes like setting `meta.error` after ERROR).
 * - **TEARDOWN** — propagated from parent to meta, releasing meta resources.
 */

/**
 * Subscribe-time handshake (`START`). Delivered to each new sink at the top of
 * `subscribe()` — `[[START]]` for a SENTINEL (no cached value) node or
 * `[[START], [DATA, cached]]` for a node with a cached value.
 *
 * Semantics: "upstream connected and ready to flow." A new sink receiving
 * `[[START]]` alone knows the upstream is alive but has no current value; a
 * sink receiving `[[START], [DATA, v]]` knows the upstream is ready
 * with value `v`. Absence of `START` before any other message means the
 * subscription was either never established or the node is terminal.
 *
 * Tier 0 — immediate, delivered before any DIRTY/DATA in the same batch.
 * Not forwarded through nodes — each node emits its own `START` to its own
 * new sinks.
 */
export const START = Symbol.for("graphrefly/START");
/** Value delivery (`DATA`, value). Tier 3 — deferred inside `batch()`. */
export const DATA = Symbol.for("graphrefly/DATA");
/** Phase 1: value about to change. Tier 1 — immediate. */
export const DIRTY = Symbol.for("graphrefly/DIRTY");
/** Phase 2: dirty pass completed, value unchanged. Tier 3 — deferred inside `batch()`. */
export const RESOLVED = Symbol.for("graphrefly/RESOLVED");
/** Clear cached state; do not auto-emit. Tier 1 — immediate. */
export const INVALIDATE = Symbol.for("graphrefly/INVALIDATE");
/** Suspend activity. Tier 2 — immediate. */
export const PAUSE = Symbol.for("graphrefly/PAUSE");
/** Resume after pause. Tier 2 — immediate. */
export const RESUME = Symbol.for("graphrefly/RESUME");
/** Permanent cleanup. Tier 5 — immediate (usually sent alone). */
export const TEARDOWN = Symbol.for("graphrefly/TEARDOWN");
/** Clean termination. Tier 4 — delivered after phase-2 in the same batch. */
export const COMPLETE = Symbol.for("graphrefly/COMPLETE");
/** Error termination. Tier 4 — delivered after phase-2 in the same batch. */
export const ERROR = Symbol.for("graphrefly/ERROR");

/** Known protocol type symbols (open set — other symbols are valid and forward). */
export const knownMessageTypes: readonly symbol[] = [
	START,
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

/** O(1) lookup for {@link isKnownMessageType} and {@link isLocalOnly}. */
const knownMessageSet: ReadonlySet<symbol> = new Set(knownMessageTypes);

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
	return knownMessageSet.has(t);
}

/**
 * Returns the signal tier for a message type (see module-level ordering table).
 *
 * - 0: subscribe handshake (START) — immediate, first in canonical order
 * - 1: notification (DIRTY, INVALIDATE) — immediate
 * - 2: flow control (PAUSE, RESUME) — immediate
 * - 3: value (DATA, RESOLVED) — deferred inside `batch()`
 * - 4: terminal (COMPLETE, ERROR) — delivered after phase-3
 * - 5: destruction (TEARDOWN) — immediate, usually alone
 * - 1 for unknown types (forward-compat: immediate)
 *
 * @param t — Message type symbol.
 * @returns Tier number (0–5).
 *
 * @example
 * ```ts
 * import { DATA, DIRTY, COMPLETE, TEARDOWN, messageTier, START } from "@graphrefly/graphrefly-ts";
 *
 * messageTier(START);    // 0
 * messageTier(DIRTY);    // 1
 * messageTier(DATA);     // 3
 * messageTier(COMPLETE); // 4
 * messageTier(TEARDOWN); // 5
 * ```
 */
export function messageTier(t: symbol): number {
	if (t === START) return 0;
	if (t === DIRTY || t === INVALIDATE) return 1;
	if (t === PAUSE || t === RESUME) return 2;
	if (t === DATA || t === RESOLVED) return 3;
	if (t === COMPLETE || t === ERROR) return 4;
	if (t === TEARDOWN) return 5;
	return 1; // unknown → immediate (after START)
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
 * Whether `t` is a graph-local signal that should NOT cross a wire/transport
 * boundary (SSE, WebSocket, worker bridge, persistence sinks).
 *
 * Local-only signals (tier 0–2): START, DIRTY, INVALIDATE, PAUSE, RESUME.
 * These are internal to the reactive graph — subscribe handshakes,
 * notification phases, and flow control have no semantics for remote consumers.
 *
 * Wire-crossing signals (tier 3+): DATA, RESOLVED, COMPLETE, ERROR, TEARDOWN.
 * Unknown message types (spec §1.3.6 forward-compat) also cross the wire.
 *
 * Individual adapters may further opt-in to local signals for observability
 * (e.g. SSE `includeDirty`, `includeResolved` options). Storage/persistence
 * adapters that need INVALIDATE for remote cache-clear should explicitly
 * forward it despite `isLocalOnly(INVALIDATE) === true`. The default is to
 * skip all local-only signals at the boundary.
 *
 * @param t — Message type symbol.
 * @returns `true` if the message should be kept local (not sent over wire).
 *
 * @example
 * ```ts
 * import { START, DIRTY, DATA, COMPLETE, isLocalOnly } from "@graphrefly/graphrefly-ts";
 *
 * isLocalOnly(START);    // true  — subscribe handshake
 * isLocalOnly(DIRTY);    // true  — notification phase
 * isLocalOnly(RESOLVED); // false — value settlement crosses wire
 * isLocalOnly(DATA);     // false — value crosses wire
 * isLocalOnly(COMPLETE); // false — terminal crosses wire
 * ```
 *
 * @category core
 */
export function isLocalOnly(t: symbol): boolean {
	// Unknown types always cross the wire (spec §1.3.6 forward-compat).
	// messageTier returns 1 for unknowns, but unknowns are NOT local-only.
	if (!knownMessageSet.has(t)) return false;
	return messageTier(t) < 3;
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
