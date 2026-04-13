/**
 * GraphReFly message protocol — §1 `~/src/graphrefly/GRAPHREFLY-SPEC.md`.
 * Emissions are always `[[Type, Data?], ...]` (no single-tuple shorthand).
 *
 * This file is protocol-pure:
 * - Message type symbols (10 built-ins).
 * - `Message` / `Messages` tuple types.
 * - `MessageTypeRegistration` interface (shape of a registry entry).
 *
 * It does NOT own the registry, tier lookups, or any cross-cutting singleton
 * state — that lives in `GraphReFlyConfig` (see `config.ts`) so custom
 * protocols can build isolated instances. Import this module when you need
 * the symbol constants or the tuple types; import `config.ts` when you need
 * tier / wire-crossing / registry lookups.
 */

/** Subscribe-time handshake. Delivered to each new sink at the top of `subscribe()`. Tier 0. */
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
/** Permanent cleanup. Tier 5 — deferred to batch phase 4. */
export const TEARDOWN = Symbol.for("graphrefly/TEARDOWN");
/** Clean termination. Tier 4 — deferred to batch phase 3. */
export const COMPLETE = Symbol.for("graphrefly/COMPLETE");
/** Error termination. Tier 4 — deferred to batch phase 3. */
export const ERROR = Symbol.for("graphrefly/ERROR");

/** One protocol tuple: `[Type, optional payload]`. */
export type Message = readonly [symbol, unknown?];

/** A batch of tuples — the wire shape for `node.down()` / `node.up()`. */
export type Messages = readonly Message[];

// ---------------------------------------------------------------------------
// Interned singletons for payload-free tuples
// ---------------------------------------------------------------------------
//
// Every emission path used to allocate fresh `[[DIRTY]]`, `[[RESOLVED]]`,
// etc. — two arrays per emit in the hot path. Since none of these tuples
// carry a payload, one frozen instance is indistinguishable from a
// fresh one. We intern them at module load and reuse forever. Only
// `[DATA, v]`, `[ERROR, e]`, `[PAUSE, lockId]`, `[RESUME, lockId]` still
// allocate per-call because they carry payloads.
//
// Downstream code MUST treat these as immutable. `Object.freeze` makes
// accidental mutation throw in strict mode. Do not `push`, splice, or
// otherwise mutate a Messages array that came from one of these.

/** Singleton `[DIRTY]` tuple — payload-free, interned. */
export const DIRTY_MSG: Message = Object.freeze([DIRTY]) as Message;
/** Singleton `[RESOLVED]` tuple — payload-free, interned. */
export const RESOLVED_MSG: Message = Object.freeze([RESOLVED]) as Message;
/** Singleton `[INVALIDATE]` tuple — payload-free, interned. */
export const INVALIDATE_MSG: Message = Object.freeze([INVALIDATE]) as Message;
/** Singleton `[START]` tuple — payload-free, interned. */
export const START_MSG: Message = Object.freeze([START]) as Message;
/** Singleton `[COMPLETE]` tuple — payload-free, interned. */
export const COMPLETE_MSG: Message = Object.freeze([COMPLETE]) as Message;
/** Singleton `[TEARDOWN]` tuple — payload-free, interned. */
export const TEARDOWN_MSG: Message = Object.freeze([TEARDOWN]) as Message;

/** Pre-wrapped `[[DIRTY]]` for `_emit([DIRTY_ONLY_BATCH])`-style callers. */
export const DIRTY_ONLY_BATCH: Messages = Object.freeze([DIRTY_MSG]) as Messages;
/** Pre-wrapped `[[RESOLVED]]`. */
export const RESOLVED_ONLY_BATCH: Messages = Object.freeze([RESOLVED_MSG]) as Messages;
/** Pre-wrapped `[[INVALIDATE]]`. */
export const INVALIDATE_ONLY_BATCH: Messages = Object.freeze([INVALIDATE_MSG]) as Messages;
/** Pre-wrapped `[[COMPLETE]]`. */
export const COMPLETE_ONLY_BATCH: Messages = Object.freeze([COMPLETE_MSG]) as Messages;
/** Pre-wrapped `[[TEARDOWN]]`. */
export const TEARDOWN_ONLY_BATCH: Messages = Object.freeze([TEARDOWN_MSG]) as Messages;

// ---------------------------------------------------------------------------
// Registry entry shape
// ---------------------------------------------------------------------------

/**
 * Per-type record stored in a {@link GraphReFlyConfig}'s registry.
 *
 * - `tier` — signal tier (0–5 built-in; custom tiers allowed but should fit
 *   the phase model used by `batch.ts`).
 * - `wireCrossing` — when `true`, forwarded across SSE/WebSocket/worker
 *   adapters. Defaults to `tier >= 3` if omitted in registration input.
 */
export interface MessageTypeRegistration {
	tier: number;
	wireCrossing: boolean;
}

/**
 * Input accepted by {@link GraphReFlyConfig.registerMessageType}. Only `tier`
 * is required; `wireCrossing` defaults to `tier >= 3`.
 */
export interface MessageTypeRegistrationInput {
	tier: number;
	wireCrossing?: boolean;
}
