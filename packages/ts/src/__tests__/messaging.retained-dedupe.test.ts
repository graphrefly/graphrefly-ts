/**
 * The message bus is retained for the graph's life and keeps its dedupe ids and sequences in its
 * working state (graphrefly-ts:D180: a retained runtime declares no ledger state); within that
 * life a repeated command id or idempotency key is still rejected.
 */

import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import { messageBus } from "../messaging/index.js";

describe("messageBus dedupe while retained (D180)", () => {
	it("rejects a repeated command id and idempotency key", () => {
		const g = graph({ name: "bus-ledger" });
		const bus = messageBus(g, { topics: ["orders"], name: "bus", now: () => 1 });
		const statuses: string[] = [];
		const published: number[] = [];
		bus.status.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === "DATA") statuses.push((m[1] as { kind: string }).kind);
		});
		bus.messages.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === "DATA") published.push((m[1] as { seq: number }).seq);
		});

		bus.publish("orders", { id: 1 }, { commandId: "cmd-1", idempotencyKey: "order-1" });
		bus.publish("orders", { id: 1 }, { commandId: "cmd-1" });
		bus.publish("orders", { id: 1 }, { commandId: "cmd-2", idempotencyKey: "order-1" });
		expect(published).toEqual([1]);
		expect(statuses.filter((k) => k === "duplicate-command")).toHaveLength(2);
	});
});
