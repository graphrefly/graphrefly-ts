/**
 * Wave-protocol message types and the tier const table.
 *
 * Canonical authority: ~/src/graphrefly/spec/rules.jsonl
 *   R-messages, R-wave, R-sentinel (the D797 kernel set, graphrefly:D798/D799).
 */

/**
 * The CLOSED set of 7 message types (R-messages). No open set, no user-defined custom types;
 * any other type is rejected. Messages travel only downstream: there is no upward message.
 * PENDING and RESOLVED are sent only by the kernel (R-wave).
 */
export type Message =
	| readonly ["START"]
	| readonly ["PENDING"]
	| readonly ["DATA", unknown]
	| readonly ["RESOLVED"]
	| readonly ["INVALIDATE"]
	| readonly ["COMPLETE"]
	| readonly ["ERROR", unknown];

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
export const TIER_NOTIFICATION = 2;
export const TIER_VALUE = 3;
export const TIER_SETTLE = 4;
export const TIER_TERMINAL = 5;

/**
 * Message-class table (R-messages: START; PENDING; value; INVALIDATE; terminal). Value and
 * above are batch-deferred. A null-prototype object, so a non-message string such as
 * `"constructor"` has no class and is rejected as unknown.
 */
const TIER: Readonly<Record<string, number | undefined>> = Object.freeze(
	Object.assign(Object.create(null) as Record<string, number | undefined>, {
		START: TIER_START,
		PENDING: TIER_NOTIFICATION,
		DATA: TIER_VALUE,
		RESOLVED: TIER_VALUE,
		INVALIDATE: TIER_SETTLE,
		COMPLETE: TIER_TERMINAL,
		ERROR: TIER_TERMINAL,
	}),
);

/**
 * Look up the tier number for a message type.
 *
 * @param t - One of the closed-set protocol message tags.
 * @returns The tier assigned by the compile-time tier table, or `undefined` at runtime for a
 *   string outside the closed set.
 * @example
 * ```ts
 * messageTier("DATA"); // 3
 * ```
 * @category core
 */
export function messageTier(t: MessageType): number {
	return TIER[t] as number;
}

/** Value and above are deferred inside a batch (DATA/RESOLVED/INVALIDATE/terminal).
 * @param t - t value used by the helper.
 * @returns `true` when the value matches the expected shape.
 * @category core
 * @example
 * ```ts
 * import { isDeferredTier } from "@graphrefly/ts/core";
 * ```
 */
export function isDeferredTier(t: MessageType): boolean {
	return (TIER[t] ?? -1) >= TIER_VALUE;
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
