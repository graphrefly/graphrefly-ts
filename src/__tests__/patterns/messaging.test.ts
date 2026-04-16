import { describe, expect, it } from "vitest";
import {
	jobFlow,
	jobQueue,
	messagingHub,
	subscription,
	topic,
	topicBridge,
} from "../../patterns/messaging.js";

describe("patterns.messaging", () => {
	it("topic retains events and updates latest value", () => {
		const t = topic<number>("events");
		t.publish(1);
		t.publish(2);
		expect(t.get("latest")).toBe(2);
		expect(t.retained()).toEqual([1, 2]);
	});

	it("subscription tracks cursor and acknowledges consumed values", () => {
		const t = topic<number>("events");
		t.publish(10);
		t.publish(20);
		const sub = subscription("sub", t);
		expect(sub.pull()).toEqual([10, 20]);
		sub.ack(1);
		expect(sub.pull()).toEqual([20]);
		expect(sub.pull(undefined, { ack: true })).toEqual([20]);
		expect(sub.pull()).toEqual([]);
		expect(sub.edges()).toContainEqual(["topic::events", "source"]);
	});

	it("jobQueue supports enqueue, claim, ack, and nack requeue", () => {
		const q = jobQueue<number>("emails");
		const id1 = q.enqueue(1);
		const id2 = q.enqueue(2);
		expect(q.get("depth")).toBe(2);
		const claimed = q.claim(2);
		expect(claimed.map((j) => j.id)).toEqual([id1, id2]);
		expect(claimed.every((j) => j.state === "inflight")).toBe(true);
		expect(q.ack(id1)).toBe(true);
		expect(q.nack(id2, { requeue: true })).toBe(true);
		const second = q.claim(1);
		expect(second).toHaveLength(1);
		expect(second[0]?.id).toBe(id2);
	});

	it("jobQueue supports nack without requeue (drop)", () => {
		const q = jobQueue<number>("emails");
		const id = q.enqueue(1);
		const claimed = q.claim(1);
		expect(claimed).toHaveLength(1);
		expect(claimed[0]?.id).toBe(id);
		expect(q.nack(id, { requeue: false })).toBe(true);
		expect(q.claim(1)).toEqual([]);
	});

	it("jobQueue rejects duplicate job ids", () => {
		const q = jobQueue<number>("emails");
		q.enqueue(1, { id: "fixed" });
		expect(() => q.enqueue(2, { id: "fixed" })).toThrow(/duplicate job id/i);
	});

	it("jobQueue claim(0) is a no-op", () => {
		const q = jobQueue<number>("emails");
		q.enqueue(1);
		expect(q.claim(0)).toEqual([]);
		expect(q.get("depth")).toBe(1);
	});

	it("rejects invalid non-negative integer parameters", () => {
		const t = topic<number>("events");
		expect(() => subscription("sub_bad_cursor", t, { cursor: Number.NaN })).toThrow(
			/non-negative integer/i,
		);
		const sub = subscription("sub_ok", t);
		expect(() => sub.ack(Number.POSITIVE_INFINITY)).toThrow(/non-negative integer/i);
		expect(() => sub.pull(-1)).toThrow(/non-negative integer/i);
		const q = jobQueue<number>("emails");
		expect(() => q.claim(-1)).toThrow(/non-negative integer/i);
		expect(() => jobFlow<number>("flow_bad", { maxPerPump: Number.POSITIVE_INFINITY })).toThrow(
			/non-negative integer/i,
		);
		expect(() =>
			topicBridge<number>("bridge_bad", t, topic<number>("dst_bad"), { maxPerPump: -1 }),
		).toThrow(/non-negative integer/i);
	});

	it("jobQueue metadata is immutable after enqueue", () => {
		const q = jobQueue<number>("emails");
		const input = { lane: "high" };
		const id = q.enqueue(1, { metadata: input });
		input.lane = "low";
		const claimed = q.claim(1);
		expect(claimed[0]?.id).toBe(id);
		expect(claimed[0]?.metadata.lane).toBe("high");
	});

	it("topicBridge relays source events into target topic", () => {
		const source = topic<number>("src");
		const target = topic<number>("dst");
		const bridge = topicBridge("bridge", source, target);
		source.publish(3);
		source.publish(4);
		expect(target.retained()).toEqual([3, 4]);
		expect(bridge.get("bridgedCount")).toBe(2);
	});

	it("topicBridge supports map/drop behavior", () => {
		const source = topic<number>("src");
		const target = topic<number>("dst");
		topicBridge("bridge", source, target, {
			map(value) {
				if (value % 2 === 0) return undefined;
				return value * 10;
			},
		});
		source.publish(1);
		source.publish(2);
		source.publish(3);
		expect(target.retained()).toEqual([10, 30]);
	});

	it("jobFlow auto-advances jobs across stages into completed log", () => {
		const flow = jobFlow<number>("flow", { stages: ["incoming", "work", "done"] });
		flow.enqueue(10);
		flow.enqueue(20);
		expect(flow.retainedCompleted().map((j) => j.payload)).toEqual([10, 20]);
		expect(flow.get("completedCount")).toBe(2);
		expect(flow.queue("incoming").get("depth")).toBe(0);
		expect(flow.queue("work").get("depth")).toBe(0);
		expect(flow.queue("done").get("depth")).toBe(0);
	});
});

describe("patterns.messagingHub", () => {
	it("lazy-creates topics on first access", () => {
		const hub = messagingHub("hub");
		expect(hub.has("orders")).toBe(false);
		expect(hub.size).toBe(0);

		const t = hub.topic<number>("orders");
		expect(hub.has("orders")).toBe(true);
		expect(hub.size).toBe(1);

		// Second call returns same instance
		expect(hub.topic<number>("orders")).toBe(t);
	});

	it("publish lazily creates topic + delivers", () => {
		const hub = messagingHub("hub");
		hub.publish<number>("events", 42);

		expect(hub.has("events")).toBe(true);
		expect(hub.topic<number>("events").retained()).toEqual([42]);
	});

	it("applies defaultTopicOptions and per-call override", () => {
		const hub = messagingHub("hub", { defaultTopicOptions: { retainedLimit: 3 } });

		const t1 = hub.topic<number>("a");
		for (let i = 0; i < 10; i++) t1.publish(i);
		// retainedLimit=3 from defaults
		expect(t1.retained()).toEqual([7, 8, 9]);

		// Per-call override only applies on first creation
		const t2 = hub.topic<number>("b", { retainedLimit: 5 });
		for (let i = 0; i < 10; i++) t2.publish(i);
		expect(t2.retained()).toEqual([5, 6, 7, 8, 9]);
	});

	it("publishMany publishes across multiple topics", () => {
		const hub = messagingHub("hub");
		hub.publishMany([
			["orders", { id: 1 }],
			["shipments", { id: 10 }],
			["orders", { id: 2 }],
		]);

		expect(hub.size).toBe(2);
		expect(hub.topic("orders").retained()).toEqual([{ id: 1 }, { id: 2 }]);
		expect(hub.topic("shipments").retained()).toEqual([{ id: 10 }]);
	});

	it("publishMany empty is a no-op", () => {
		const hub = messagingHub("hub");
		hub.publishMany([]);
		expect(hub.size).toBe(0);
	});

	it("subscribe() creates a cursor-based SubscriptionGraph", () => {
		const hub = messagingHub("hub");
		hub.publishMany<number>([
			["events", 1],
			["events", 2],
			["events", 3],
		] as Iterable<[string, unknown]>);

		const sub = hub.subscribe<number>("consumer", "events");
		expect(sub.pull()).toEqual([1, 2, 3]);
		sub.ack(1);
		expect(sub.pull()).toEqual([2, 3]);
	});

	it("subscribe() lazily creates the topic if missing", () => {
		const hub = messagingHub("hub");
		const sub = hub.subscribe<number>("consumer", "late-topic");

		expect(hub.has("late-topic")).toBe(true);
		expect(sub.pull()).toEqual([]);

		hub.publish<number>("late-topic", 99);
		expect(sub.pull()).toEqual([99]);
	});

	it("removeTopic unmounts and returns true", () => {
		const hub = messagingHub("hub");
		hub.publish<number>("x", 1);
		expect(hub.size).toBe(1);

		const removed = hub.removeTopic("x");
		expect(removed).toBe(true);
		expect(hub.has("x")).toBe(false);
		expect(hub.size).toBe(0);

		// re-publish recreates
		hub.publish<number>("x", 99);
		expect(hub.size).toBe(1);
		expect(hub.topic<number>("x").retained()).toEqual([99]);
	});

	it("removeTopic on non-existent returns false", () => {
		const hub = messagingHub("hub");
		expect(hub.removeTopic("never")).toBe(false);
	});

	it("version counter advances on create / remove only", () => {
		const hub = messagingHub("hub");
		expect(hub.version).toBe(0);

		hub.topic("a");
		expect(hub.version).toBe(1);

		hub.topic("a"); // already exists — no advance
		expect(hub.version).toBe(1);

		hub.publish("a", 1); // publish doesn't advance
		expect(hub.version).toBe(1);

		hub.topic("b");
		expect(hub.version).toBe(2);

		hub.removeTopic("a");
		expect(hub.version).toBe(3);

		hub.removeTopic("missing"); // no-op
		expect(hub.version).toBe(3);
	});

	it("topicNames iterates over registered topics", () => {
		const hub = messagingHub("hub");
		hub.topic("x");
		hub.publish("y", 1);
		hub.topic("z");

		expect([...hub.topicNames()].sort()).toEqual(["x", "y", "z"]);

		hub.removeTopic("y");
		expect([...hub.topicNames()].sort()).toEqual(["x", "z"]);
	});

	it("mounts topics under the hub — accessible via qualified paths", () => {
		const hub = messagingHub("hub");
		hub.publish<number>("orders", 42);

		// hub.orders::events should be resolvable through the mounted subgraph
		const ordersEvents = hub.node("orders::events");
		expect(ordersEvents.cache).toEqual([42]);
	});
});
