import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import { fromTopic, messageBus, toTopic } from "../messaging/index.js";

describe("message bus application infrastructure (D132)", () => {
	it("uses finite declared topics with sentinel-before-publish topic nodes", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["orders"], name: "bus", now: () => 10 });
		const orders = fromTopic<{ id: string }, "orders">(bus, "orders");
		const msgs: unknown[] = [];
		orders.subscribe((msg) => msgs.push(msg));

		expect(msgs).toEqual([["START"]]);
		const envelope = bus.publish("orders", { id: "o1" }, { key: "o1" });

		expect(envelope).toEqual({
			topic: "orders",
			seq: 1,
			payload: { id: "o1" },
			key: "o1",
			timestampMs: 10,
		});
		expect(msgs.at(-1)).toEqual(["DATA", envelope]);
		expect(bus.has("missing")).toBe(false);
	});

	it("publishes source DATA through a declared toTopic adapter node", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["orders"], name: "bus", now: () => 20 });
		const source = g.node<{ id: string }>([], null, { name: "source" });
		const topic = fromTopic<{ id: string }, "orders">(bus, "orders");
		const sink = toTopic(g, source, bus, "orders", {
			name: "orders/out",
			keyOf: (value) => (value as { id: string }).id,
		});
		const topicMsgs: unknown[] = [];
		const eventMsgs: unknown[] = [];
		topic.subscribe((msg) => topicMsgs.push(msg));
		sink.events.subscribe((msg) => eventMsgs.push(msg));

		source.down([["DATA", { id: "o2" }]]);

		expect(topicMsgs.at(-1)).toEqual([
			"DATA",
			{ topic: "orders", seq: 1, payload: { id: "o2" }, key: "o2", timestampMs: 20 },
		]);
		expect(eventMsgs.at(-1)).toEqual([
			"DATA",
			{ kind: "publish", topic: "orders", seq: 1, payload: { id: "o2" } },
		]);
		const snap = g.describe();
		expect(snap.nodes.map((node) => [node.id, node.factory])).toContainEqual([
			"bus/orders",
			"messageTopic",
		]);
		expect(snap.edges).toContainEqual({ from: "source", to: "orders/out" });
		expect(snap.edges).toContainEqual({ from: "orders/out", to: "bus/orders" });
		expect(snap.edges).toContainEqual({ from: "orders/out", to: "orders/out/events" });
	});
});
