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

/**
 * The closed set of message types (R-messages). A null-prototype set lookup, so a non-message
 * string such as `"constructor"` is rejected as unknown.
 */
const MESSAGE_TYPES: ReadonlySet<string> = new Set([
	"START",
	"PENDING",
	"DATA",
	"RESOLVED",
	"INVALIDATE",
	"COMPLETE",
	"ERROR",
]);

/** @internal Whether `t` is one of the seven message types (R-messages). */
export function isMessageType(t: unknown): t is MessageType {
	return typeof t === "string" && MESSAGE_TYPES.has(t);
}

/**
 * A terminal message: COMPLETE or ERROR (R-terminals).
 * @param t - t value used by the helper.
 * @returns `true` when the value matches the expected shape.
 * @category core
 * @example
 * ```ts
 * import { isTerminal } from "@graphrefly/ts/core";
 * ```
 */
export function isTerminal(t: MessageType): boolean {
	return t === "COMPLETE" || t === "ERROR";
}
