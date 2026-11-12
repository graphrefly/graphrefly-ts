/**
 * graphrefly-ts:D180: the wire bridge's status counters are an audit ledger the bundle owns. The
 * status node deactivates when nothing reads it, and its lifetime's close writes the counters back
 * to `${name}/statusLedger` (Rust bridge/statusLedger).
 */

import { describe, expect, it } from "vitest";
import type { WireBridgeStatus } from "../adapters/index.js";
import { wireBridge } from "../adapters/index.js";
import { graph } from "../graph/graph.js";

describe("wireBridge status ledger (D180)", () => {
	it("writes the status counters back when the status lifetime closes", () => {
		const g = graph({ name: "bridge-status-ledger" });
		const bridge = wireBridge<string, string>(g, { name: "bridge", sessionId: "s", now: () => 1 });
		expect(g.describe().find((n) => n.id === "bridge/status")?.deps).toEqual([
			"bridge/events",
			"bridge/statusLedger",
		]);
		const stop = bridge.status.subscribe(() => {});
		bridge.send("one");
		bridge.send("two");
		const live = bridge.status.cache as WireBridgeStatus;
		expect(live.attempts).toBe(2);
		stop();
		expect(bridge.status.status.lifecycle).toBe("inactive");
		const ledger = g.find("bridge/statusLedger")?.cache as WireBridgeStatus;
		expect(ledger).toMatchObject({ attempts: 2, pending: 2, nextSeq: live.nextSeq });
	});
});
