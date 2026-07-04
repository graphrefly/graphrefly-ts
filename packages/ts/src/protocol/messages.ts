/**
 * Wave-protocol message types and the tier const table.
 *
 * Canonical authority: ~/src/graphrefly/spec/rules.jsonl
 *   R-msg-format, R-msg-closed-set, R-tier (D34), R-data-payload, R-sentinel.
 */

/** Opaque pause-lock / pull identifier (R-pause-lockset, R-pull). */
export type LockId = string | symbol;

/** Explicit pull demand payload (D269/D272). Params are holder-visible context, never DATA-up. */
export interface PullDemand {
	readonly pullId: LockId;
	readonly params?: unknown;
}

/**
 * The CLOSED set of 11 message types (R-msg-closed-set / D9 + D269 + START handshake).
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
	| readonly ["RESUME", LockId]
	| readonly ["PULL", PullDemand];

/** One array of messages delivered in one call = one Wave (R-wave-boundary). */
export type Wave = readonly Message[];

/** The message-type tag (the first tuple element). */
export type MessageType = Message[0];

/**
 * SENTINEL = absence-of-DATA (R-sentinel / D16). TS representation is `undefined`.
 * Never a valid DATA payload; `null` IS a valid DATA value (domain-level absence).
 */
export const SENTINEL = undefined;

/** R-data-payload: ERROR payloads must not collide with terminal metadata shorthand.
 * @param v - v value used by the helper.
 * @returns `true` when the value matches the expected shape.
 * @category core
 * @example
 * ```ts
 * import { isInvalidErrorPayload } from "@graphrefly/ts/core";
 * ```
 */
export function isInvalidErrorPayload(v: unknown): boolean {
	return v === SENTINEL || typeof v === "boolean";
}

/** R-data-payload / D78: host-language failures that collide with ctx.terminal shorthand become diagnostics.
 * @param reason - reason value used by the helper.
 * @param fallback - fallback value used by the helper.
 * @returns The error payload result.
 * @category core
 * @example
 * ```ts
 * import { errorPayload } from "@graphrefly/ts/core";
 * ```
 */
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
	PULL: TIER_CONTROL,
	DIRTY: TIER_NOTIFICATION,
	DATA: TIER_VALUE,
	RESOLVED: TIER_VALUE,
	INVALIDATE: TIER_SETTLE,
	COMPLETE: TIER_TERMINAL,
	ERROR: TIER_TERMINAL,
	TEARDOWN: TIER_TEARDOWN,
};

/**
 * Look up the tier number for a message type.
 *
 * @param t - One of the closed-set protocol message tags.
 * @returns The tier assigned by the compile-time tier table.
 * @example
 * ```ts
 * messageTier("DATA"); // 3
 * ```
 * @category core
 */
export function messageTier(t: MessageType): number {
	return TIER[t];
}

/** Value and above are deferred inside a batch (DATA/RESOLVED/INVALIDATE/terminal/teardown).
 * @param t - t value used by the helper.
 * @returns `true` when the value matches the expected shape.
 * @category core
 * @example
 * ```ts
 * import { isDeferredTier } from "@graphrefly/ts/core";
 * ```
 */
export function isDeferredTier(t: MessageType): boolean {
	return TIER[t] >= TIER_VALUE;
}

/** Value-tier messages (DATA/RESOLVED) occupy the tier-3 slot.
 * @param t - t value used by the helper.
 * @returns `true` when the value matches the expected shape.
 * @category core
 * @example
 * ```ts
 * import { isValueTier } from "@graphrefly/ts/core";
 * ```
 */
export function isValueTier(t: MessageType): boolean {
	return TIER[t] === TIER_VALUE;
}

/** The pause buffer holds the settle slice only: value-tier DATA/RESOLVED plus INVALIDATE.
 * @param t - t value used by the helper.
 * @returns `true` when the value matches the expected shape.
 * @category core
 * @example
 * ```ts
 * import { isPauseBufferedTier } from "@graphrefly/ts/core";
 * ```
 */
export function isPauseBufferedTier(t: MessageType): boolean {
	const tier = TIER[t];
	return tier === TIER_VALUE || tier === TIER_SETTLE;
}

/**
 * A TERMINAL message = tier 5 (COMPLETE | ERROR), R-tier / D34. Detected via the CENTRAL tier
 * table, NOT a per-variant `=== "COMPLETE" || === "ERROR"` check — so terminal routing stays
 * driven by the one const table (feedback_use_tier_for_signal_routing); discriminate COMPLETE vs
 * ERROR within the tier by the message type only where the handling actually differs.
 * @param t - t value used by the helper.
 * @returns `true` when the value matches the expected shape.
 * @category core
 * @example
 * ```ts
 * import { isTerminal } from "@graphrefly/ts/core";
 * ```
 */
export function isTerminal(t: MessageType): boolean {
	return TIER[t] === TIER_TERMINAL;
}

/**
 * ctx.up carries control/demand tiers only (R-ctx-up / D269): DIRTY, PAUSE, RESUME, PULL,
 * INVALIDATE, TEARDOWN. DATA/RESOLVED (tier 3) and COMPLETE/ERROR (tier 5) are
 * down-only.
 * @param t - t value used by the helper.
 * @returns `true` when the value matches the expected shape.
 * @category core
 * @example
 * ```ts
 * import { isUpAllowed } from "@graphrefly/ts/core";
 * ```
 */
export function isUpAllowed(t: MessageType): boolean {
	const tier = TIER[t];
	return tier !== TIER_VALUE && tier !== TIER_TERMINAL;
}
