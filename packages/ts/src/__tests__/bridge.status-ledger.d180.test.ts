/**
 * graphrefly-ts:D180: the wire bridge's status counters are an audit ledger the bundle owns. The
 * status node deactivates when nothing reads it; its lifetime's close writes the counters back to
 * `${name}/statusLedger` with the index of the last event they counted, and a new lifetime skips
 * events at or below it, the retained events node's snapshot replay included (Rust
 * bridge/statusLedger).
 */

import { describe, expect, it } from "vitest";
import type { WireBridgeStatus } from "../adapters/index.js";
import { wireBridge } from "../adapters/index.js";
import { graph } from "../graph/graph.js";

describe("wireBridge status ledger (D180)", () => {
	it("keeps the counts across a reactivation and counts a later event once", () => {
		const g = graph({ name: "bridge-status-ledger" });
		const bridge = wireBridge<string, string>(g, { name: "bridge", sessionId: "s", now: () => 1 });
		expect(g.describe().find((n) => n.id === "bridge/status")?.deps).toEqual([
			"bridge/events",
			"bridge/statusLedger",
		]);
		const indexes: number[] = [];
		bridge.events.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === "DATA") indexes.push((m[1] as { index: number }).index);
		});
		const stop = bridge.status.subscribe(() => {});
		bridge.send("one");
		bridge.send("two");
		const counted = bridge.status.cache as WireBridgeStatus;
		expect(counted.attempts).toBe(2);
		expect(indexes).toEqual([1, 2]);

		stop();
		expect(bridge.status.status.lifecycle).toBe("inactive");
		expect(g.find("bridge/statusLedger")?.cache).toMatchObject({
			status: { attempts: 2, pending: 2 },
			highWater: 2,
		});

		// Reactivating replays the events node's last event as a snapshot; it is not counted again.
		const restart = bridge.status.subscribe(() => {});
		expect(bridge.status.cache).toEqual(counted);

		bridge.send("three");
		expect(bridge.status.cache).toMatchObject({ attempts: 3, pending: 3 });
		expect(indexes).toEqual([1, 2, 3]);
		restart();
	});
});
