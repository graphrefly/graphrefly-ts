import { isInvalidErrorPayload, messageTier, type Wave } from "../protocol/messages.js";

export function terminalView(t: unknown): unknown {
	return t === undefined ? false : t;
}

export function validateDownPayloads(msgs: Wave): void {
	for (const m of msgs) {
		if (messageTier(m[0]) === undefined) {
			throw new Error(
				`down: ${String(m[0])} is not in the closed message-type set (R-msg-closed-set)`,
			);
		}
		if (m[0] === "DATA" && m[1] === undefined) {
			throw new Error("down: DATA requires a non-SENTINEL payload (R-data-payload)");
		}
		if (m[0] === "ERROR" && isInvalidErrorPayload(m[1])) {
			throw new Error("down: ERROR requires a non-SENTINEL, non-boolean payload (R-data-payload)");
		}
	}
}

/**
 * R-wave / R-subscription@3 / R-failure@3: START, PENDING and RESOLVED are the kernel's alone. A
 * node's own output (ctx.down, or a host emission through node.down) carrying any of them is
 * rejected before anything is applied; uncaught inside a function, the throw becomes that node's
 * ERROR. Unknown types, malformed DATA and ERROR are rejected by {@link validateDownPayloads}.
 */
export function validateNodeOutput(msgs: Wave): void {
	validateDownPayloads(msgs);
	for (const m of msgs) {
		if (m[0] === "START" || m[0] === "PENDING" || m[0] === "RESOLVED") {
			throw new Error(
				`down: ${m[0]} is sent only by the kernel; node output cannot carry it (R-wave)`,
			);
		}
	}
}

/**
 * @internal R-failure: a failure raised while delivering a running function's own output (a sink
 * or a dependent's failure) is not that function's throw. ctx.down marks it so the running node's
 * invocation passes it on to its caller unchanged instead of becoming the node's ERROR.
 */
export class DeliveryFailure {
	constructor(readonly cause: unknown) {}
}
