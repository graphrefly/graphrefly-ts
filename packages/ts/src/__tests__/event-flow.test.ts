import { describe, expect, it } from "vitest";
import { graph, type Node } from "../index.js";
import {
	type EventMessage,
	eventMessage,
	type MessageBusAvailablePage,
	messageBus,
} from "../messaging/index.js";
import { type EventFlowRecord, eventFlow, eventFlowProjection } from "../patterns/event-flow.js";

function collect<T>(node: Node<T>): T[] {
	const seen: T[] = [];
	node.subscribe((msg) => {
		if (msg[0] === "DATA") seen.push(msg[1] as T);
	});
	return seen;
}

describe("eventFlow pattern (D326/D329/D331)", () => {
	it("keeps EventMessage passive and validates only the vocabulary shape", () => {
		const event = eventMessage("user.created", { userId: "u1" }, { id: "evt-1" });

		expect(event).toEqual({
			id: "evt-1",
			type: "user.created",
			payload: { userId: "u1" },
		});
	});

	it("records direct EventMessage sources with projection high-water", () => {
		const g = graph();
		const source = g.state<unknown>(eventMessage("ignored", {}, { id: "initial" }), {
			name: "events",
		});
		const flow = eventFlow(g, {
			flowId: "orders",
			name: "ordersFlow",
			sources: [{ source: "direct", node: source }],
			now: () => 100,
		});
		const records = collect(flow.records);
		const highWater = collect(flow.highWater);
		records.length = 0;
		highWater.length = 0;

		source.set(eventMessage("order.created", { orderId: "o1" }, { id: "evt-2" }));

		expect(records).toEqual([
			expect.objectContaining({
				recordSeq: 2,
				flowId: "orders",
				observedAtMs: 100,
				event: expect.objectContaining({ id: "evt-2", type: "order.created" }),
				source: { source: "direct", messageId: "evt-2" },
			}),
		]);
		expect(highWater.at(-1)).toEqual({
			flowId: "orders",
			recordSeq: 2,
			auditSeq: 2,
			sources: [{ source: "direct", messageId: "evt-2", recordSeq: 2 }],
		});
	});

	it("emits DataIssue facts for malformed source facts instead of owning dead-letter policy", () => {
		const g = graph();
		const source = g.state<unknown>(eventMessage("ok", {}, { id: "initial" }));
		const flow = eventFlow(g, {
			flowId: "audit",
			sources: [{ source: "direct", node: source }],
			now: () => 10,
		});
		const issues = collect(flow.issues);
		const status = collect(flow.status);
		issues.length = 0;
		status.length = 0;

		source.set({ id: "broken" });

		expect(issues).toEqual([
			expect.objectContaining({
				kind: "issue",
				code: "malformed-event-message",
				source: "eventFlow",
			}),
		]);
		expect(status.at(-1)).toEqual(
			expect.objectContaining({
				kind: "rejected",
				flowId: "audit",
				issueCode: "malformed-event-message",
			}),
		);
	});

	it("consumes messageBus envelopes without owning subscription cursors", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["events"], now: () => 1 });
		const sub = bus.subscription<EventMessage>({
			topic: "events",
			subscriptionId: "eventFlow-reader",
		});
		const flow = eventFlow(g, {
			flowId: "busFlow",
			sources: [{ source: "messageBus", node: bus.messages }],
			now: () => 2,
		});
		const records = collect(flow.records);
		const pages = collect<MessageBusAvailablePage<EventMessage>>(sub.available);

		bus.publish("events", eventMessage("order.created", { orderId: "o1" }, { id: "evt-1" }));
		sub.available.up([["PULL", { pullId: sub.availablePullId }]]);

		expect(records).toEqual([
			expect.objectContaining({
				recordSeq: 1,
				source: {
					source: "messageBus",
					topic: "events",
					seq: 1,
					messageId: "evt-1",
				},
			}),
		]);
		expect(pages.at(-1)?.cursor.nextSeq).toBe(1);
		expect(pages.at(-1)?.messages).toHaveLength(1);
	});

	it("projects eventFlow records with projector high-water", () => {
		const g = graph();
		const source = g.state<unknown>(eventMessage("ignored", {}, { id: "initial" }));
		const flow = eventFlow(g, {
			flowId: "counts",
			sources: [{ source: "direct", node: source }],
			now: () => 1,
		});
		const projection = eventFlowProjection(g, flow, {
			projectionId: "eventCounts",
			initial: {} as Record<string, number>,
			reduce(state, record: EventFlowRecord) {
				return { ...state, [record.event.type]: (state[record.event.type] ?? 0) + 1 };
			},
			now: () => 2,
		});
		const snapshots = collect(projection.snapshot);
		const highWater = collect(projection.highWater);
		snapshots.length = 0;
		highWater.length = 0;

		source.set(eventMessage("order.created", {}, { id: "evt-1" }));
		source.set(eventMessage("order.created", {}, { id: "evt-2" }));

		expect(snapshots.at(-1)).toEqual({ ignored: 1, "order.created": 2 });
		expect(highWater.at(-1)).toEqual(
			expect.objectContaining({ flowId: "eventCounts", recordSeq: 3 }),
		);
	});

	it("keeps projector high-water for every observed source coordinate", () => {
		const g = graph();
		const orders = g.state<unknown>(eventMessage("order.initial", {}, { id: "order-0" }));
		const payments = g.state<unknown>(eventMessage("payment.initial", {}, { id: "payment-0" }));
		const flow = eventFlow(g, {
			flowId: "multi",
			sources: [
				{ source: "orders", node: orders },
				{ source: "payments", node: payments },
			],
			now: () => 1,
		});
		const projection = eventFlowProjection(g, flow, {
			projectionId: "multiProjection",
			initial: [] as string[],
			reduce(state, record: EventFlowRecord) {
				return [...state, record.event.id];
			},
			now: () => 2,
		});
		const highWater = collect(projection.highWater);
		highWater.length = 0;

		orders.set(eventMessage("order.created", {}, { id: "order-1" }));
		payments.set(eventMessage("payment.created", {}, { id: "payment-1" }));

		expect(highWater.at(-1)).toEqual({
			flowId: "multiProjection",
			recordSeq: 4,
			auditSeq: 0,
			sources: [
				{ source: "orders", messageId: "order-1", recordSeq: 3 },
				{ source: "payments", messageId: "payment-1", recordSeq: 4 },
			],
		});
	});
});
