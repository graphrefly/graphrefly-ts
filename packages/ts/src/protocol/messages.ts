/**
 * Wave-protocol message types and the tier const table.
 *
 * Canonical authority: ~/src/graphrefly/spec/rules.jsonl
 *   R-msg-format, R-msg-closed-set, R-tier (D34), R-data-payload, R-sentinel.
 */

/** Opaque pause-lock identifier (R-pause-lockset). */
export type LockId = string | symbol;

/**
 * The CLOSED set of 10 message types (R-msg-closed-set / D9 + START handshake).
 * No open set, no user-defined custom types. Adding a type is a spec change.
 */
export type Message =
	| readonly ["START"]
	| readonly ["DIRTY"]
	| readonly ["DATA", unknown]
	| readonly ["RESOLVED"]
	| readonly ["INVALIDATE"]
	| readonly ["COMPLETE"]
	| readonly ["ERROR", unknown]
	| readonly ["TEARDOWN"]
	| readonly ["PAUSE", LockId]
	| readonly ["RESUME", LockId];

/** One array of messages delivered in one call = one Wave (R-wave-boundary). */
export type Wave = readonly Message[];

/** The message-type tag (the first tuple element). */
export type MessageType = Message[0];

/**
 * SENTINEL = absence-of-DATA (R-sentinel / D16). TS representation is `undefined`.
 * Never a valid DATA payload; `null` IS a valid DATA value (domain-level absence).
 */
export const SENTINEL = undefined;

/** R-data-payload: ERROR payloads must not collide with terminal metadata shorthand. */
export function isInvalidErrorPayload(v: unknown): boolean {
	return v === SENTINEL || typeof v === "boolean";
}

/** R-data-payload / D78: host-language failures that collide with ctx.terminal shorthand become diagnostics. */
export function errorPayload(reason: unknown, fallback = "error without a valid payload"): unknown {
	return isInvalidErrorPayload(reason) ? new Error(fallback) : reason;
}

export const TIER_START = 0;
export const TIER_CONTROL = 1;
export const TIER_NOTIFICATION = 2;
export const TIER_VALUE = 3;
export const TIER_SETTLE = 4;
export const TIER_TERMINAL = 5;
export const TIER_TEARDOWN = 6;

/**
 * Tier const table (R-tier / D34). Tiers below value dispatch immediately; value
 * and above are batch-deferred. This is a compile-time const table (D18), not runtime config.
 */
const TIER: Record<MessageType, number> = {
	START: TIER_START,
	PAUSE: TIER_CONTROL,
	RESUME: TIER_CONTROL,
	DIRTY: TIER_NOTIFICATION,
	DATA: TIER_VALUE,
	RESOLVED: TIER_VALUE,
	INVALIDATE: TIER_SETTLE,
	COMPLETE: TIER_TERMINAL,
	ERROR: TIER_TERMINAL,
	TEARDOWN: TIER_TEARDOWN,
};

export function messageTier(t: MessageType): number {
	return TIER[t];
}

/** Value and above are deferred inside a batch (DATA/RESOLVED/INVALIDATE/terminal/teardown). */
export function isDeferredTier(t: MessageType): boolean {
	return TIER[t] >= TIER_VALUE;
}

/** Value-tier messages (DATA/RESOLVED) occupy the tier-3 slot. */
export function isValueTier(t: MessageType): boolean {
	return TIER[t] === TIER_VALUE;
}

/** The pause buffer holds the settle slice only: value-tier DATA/RESOLVED plus INVALIDATE. */
export function isPauseBufferedTier(t: MessageType): boolean {
	const tier = TIER[t];
	return tier === TIER_VALUE || tier === TIER_SETTLE;
}

/**
 * A TERMINAL message = tier 5 (COMPLETE | ERROR), R-tier / D34. Detected via the CENTRAL tier
 * table, NOT a per-variant `=== "COMPLETE" || === "ERROR"` check — so terminal routing stays
 * driven by the one const table (feedback_use_tier_for_signal_routing); discriminate COMPLETE vs
 * ERROR within the tier by the message type only where the handling actually differs.
 */
export function isTerminal(t: MessageType): boolean {
	return TIER[t] === TIER_TERMINAL;
}

/**
 * ctx.up carries control tiers only (R-ctx-up / DR-5): DIRTY, PAUSE, RESUME,
 * INVALIDATE, TEARDOWN. DATA/RESOLVED (tier 3) and COMPLETE/ERROR (tier 5) are
 * down-only.
 */
export function isUpAllowed(t: MessageType): boolean {
	const tier = TIER[t];
	return tier !== TIER_VALUE && tier !== TIER_TERMINAL;
}
