/**
 * graphrefly-ts:D180: the work queue's sequences and dedupe ids are a ledger state the bundle owns
 * and the runtime declares as its last dependency; the runtime still dedupes within its lifetime.
 */

import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import { messageBus } from "../messaging/index.js";
import type { Message } from "../protocol/messages.js";
import { workQueue } from "../work-queue/index.js";

describe("work-queue ledger (D180)", () => {
	it("declares the ledger as the runtime's last dependency and still dedupes commands", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["work"], name: "bus", now: () => 0 });
		const queue = workQueue<{ id: string }>(g, {
			queueId: "q",
			bus,
			topic: "work",
			subscriptionId: "q-admit",
			now: () => 0,
		});
		const runtime = g.describe().find((n) => n.id === "workQueue/q/runtime");
		expect(runtime?.deps.at(-1)).toBe("workQueue/q/ledger");
		expect(g.describe().find((n) => n.id === "workQueue/q/ledger")?.kind).toBe("state");

		const records: Message[] = [];
		const issues: Message[] = [];
		queue.records.subscribe((incoming) => {
			for (const msg of incoming) records.push(msg);
		});
		queue.issues.subscribe((incoming) => {
			for (const msg of incoming) issues.push(msg);
		});
		queue.submit({ id: "a" });
		queue.submit({ id: "b" });
		queue.claim({ workerId: "w1", commandId: "claim-1" });
		queue.claim({ workerId: "w2", commandId: "claim-1" });
		queue.claim({ workerId: "w3", commandId: "claim-3", idempotencyKey: "idem" });
		queue.claim({ workerId: "w4", commandId: "claim-4", idempotencyKey: "idem" });

		const claimed = records.filter(
			(msg) => msg[0] === "DATA" && (msg[1] as { kind?: string }).kind === "work-claimed",
		);
		expect(claimed.map((msg) => (msg[1] as { workerId: string }).workerId)).toEqual(["w1", "w3"]);
		const duplicates = issues.filter(
			(msg) => msg[0] === "DATA" && (msg[1] as { code?: string }).code === "duplicate-command",
		);
		expect(duplicates).toHaveLength(2);
	});
});
