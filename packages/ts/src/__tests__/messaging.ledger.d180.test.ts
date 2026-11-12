/**
 * graphrefly-ts:D180: the message bus's ledger (dedupe ids, sequences, cursors) is a state the
 * bundle owns and the runtime declares, so the relation is a drawable edge and a checkpoint holds
 * it as strict JSON. The runtime is retained for the graph's life, so within it the bus state is
 * the working copy and the ledger keeps its seed value until the lifetime closes.
 */

import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import { messageBus } from "../messaging/index.js";

describe("messageBus ledger (D180)", () => {
	it("declares the ledger as a runtime dependency and keeps deduplicating", () => {
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

		expect(g.describe().find((n) => n.id === "bus/runtime")?.deps).toEqual([
			"bus/commands",
			"bus/ledger",
		]);

		bus.publish("orders", { id: 1 }, { commandId: "cmd-1", idempotencyKey: "order-1" });
		bus.publish("orders", { id: 1 }, { commandId: "cmd-1" });
		bus.publish("orders", { id: 1 }, { commandId: "cmd-2", idempotencyKey: "order-1" });
		expect(published).toEqual([1]);
		expect(statuses.filter((k) => k === "duplicate-command")).toHaveLength(2);

		const ledger = g.checkpoint().nodes.find((n) => n.id === "bus/ledger");
		expect(ledger?.kind).toBe("state");
		// Mid-lifetime the ledger still holds its seed: the bus state is the working copy.
		expect(ledger?.values).toEqual([
			{
				topics: [],
				subscriptions: [],
				seenCommandIds: [],
				seenIdempotencyKeys: [],
				deadLetterSeq: 0,
			},
		]);
	});
});
