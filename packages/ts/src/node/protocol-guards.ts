import { isInvalidErrorPayload, type PullDemand, type Wave } from "../protocol/messages.js";

export function terminalView(t: unknown): unknown {
	return t === undefined ? false : t;
}

export function normalizePullDemand(demand: PullDemand): PullDemand {
	if (typeof demand !== "object" || demand === null || Array.isArray(demand)) {
		throw new Error("ctx.up: PULL requires { pullId, params? } demand payload (D269)");
	}
	const pullId = (demand as { pullId?: unknown }).pullId;
	if (typeof pullId !== "string" && typeof pullId !== "symbol") {
		throw new Error("ctx.up: PULL demand requires a string or symbol pullId (D269)");
	}
	const params = (demand as { params?: unknown }).params;
	return params === undefined ? { pullId } : { pullId, params };
}

export function validateDownPayloads(msgs: Wave): void {
	for (const m of msgs) {
		if (m[0] === "DATA" && m[1] === undefined) {
			throw new Error("down: DATA requires a non-SENTINEL payload (R-data-payload)");
		}
		if (m[0] === "ERROR" && isInvalidErrorPayload(m[1])) {
			throw new Error("down: ERROR requires a non-SENTINEL, non-boolean payload (R-data-payload)");
		}
	}
}
