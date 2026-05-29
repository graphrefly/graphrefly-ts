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

/**
 * Tier const table (R-tier / D34). Tiers < 3 dispatch immediately; tiers >= 3 are
 * batch-deferred. This is a compile-time const table (D18), not runtime config.
 */
const TIER: Record<MessageType, number> = {
	START: 0,
	PAUSE: 1,
	RESUME: 1,
	DIRTY: 2,
	DATA: 3,
	RESOLVED: 3,
	INVALIDATE: 4,
	COMPLETE: 5,
	ERROR: 5,
	TEARDOWN: 6,
};

export function messageTier(t: MessageType): number {
	return TIER[t];
}

/** Tier >= 3 messages are deferred inside a batch (DATA/RESOLVED/INVALIDATE/terminal/teardown). */
export function isDeferredTier(t: MessageType): boolean {
	return TIER[t] >= 3;
}

/**
 * ctx.up carries control tiers only (R-ctx-up / DR-5): DIRTY, PAUSE, RESUME,
 * INVALIDATE, TEARDOWN. DATA/RESOLVED (tier 3) and COMPLETE/ERROR (tier 5) are
 * down-only.
 */
export function isUpAllowed(t: MessageType): boolean {
	const tier = TIER[t];
	return tier !== 3 && tier !== 5;
}
