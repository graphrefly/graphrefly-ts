import { describe, expect, expectTypeOf, it } from "vitest";
import { graph } from "../graph/graph.js";
import {
	CONTEXT_TOPIC,
	DEFERRED_TOPIC,
	fromTopic,
	INJECTIONS_TOPIC,
	type JsonSchema,
	messageBus,
	PROMPTS_TOPIC,
	RESPONSES_TOPIC,
	SPAWNS_TOPIC,
	STANDARD_TOPICS,
	type StandardTopic,
	TODOS_TOPIC,
	type TopicMessage,
	toTopic,
} from "../messaging/index.js";

describe("messaging passive vocabulary (D125/D132)", () => {
	it("exports standard topic constants and a passive topic message envelope", () => {
		expect(STANDARD_TOPICS).toEqual([
			PROMPTS_TOPIC,
			RESPONSES_TOPIC,
			INJECTIONS_TOPIC,
			DEFERRED_TOPIC,
			SPAWNS_TOPIC,
			CONTEXT_TOPIC,
			TODOS_TOPIC,
		]);
		expect(Object.isFrozen(STANDARD_TOPICS)).toBe(true);
		expectTypeOf<StandardTopic>().toEqualTypeOf<
			"prompts" | "responses" | "injections" | "deferred" | "spawns" | "context" | "todos"
		>();
		expectTypeOf<TopicMessage<{ prompt: string }>["schema"]>().toEqualTypeOf<
			JsonSchema | undefined
		>();
	});
});

describe("messageBus clean-slate retained topic log (D279/D282/D284/D285/D325)", () => {
	it("exposes commands/messages/status/issues and has no dynamicHub facade", async () => {
		const messaging = await import("../messaging/index.js");
		const g = graph();
		messageBus(g, { topics: ["orders"], name: "bus", now: () => 10 });

		expect(g.describe().nodes.map((node) => [node.id, node.factory])).toEqual(
			expect.arrayContaining([
				["bus/commands", "messageBusCommands"],
				["bus/messages", "messageBusMessages"],
				["bus/status", "messageBusStatus"],
				["bus/issues", "messageBusIssues"],
			]),
		);
		expect("dynamicHub" in messaging).toBe(false);
	});

	it("uses strict unknown-topic default and surfaces DataIssue/dead-letter material", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["orders"], name: "bus", now: () => 20 });
		const issues: unknown[] = [];
		bus.issues.subscribe((msg) => issues.push(msg));

		bus.publish("missing", { id: "x" }, { commandId: "cmd-1" });

		expect(issues.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				kind: "issue",
				code: "unknown-topic",
				source: "messageBus",
			}),
		]);
		expect(bus.has("missing")).toBe(false);
	});

	it("rejects unknown command kinds as DataIssue facts instead of throwing", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["orders"], name: "bus", now: () => 25 });
		const issues: unknown[] = [];
		bus.issues.subscribe((msg) => issues.push(msg));

		expect(() =>
			bus.commands.down([
				["DATA", { kind: "bogus", topic: "orders", commandId: "bad-1" } as never],
			]),
		).not.toThrow();

		expect(issues.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ code: "malformed-command", source: "messageBus" }),
		]);
	});

	it("publishes retained messages only after ensure-topic and supports toTopic command sugar", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["orders"], name: "bus", now: () => 30 });
		const source = g.node<{ id: string }>([], null, { name: "source" });
		const sink = toTopic(g, source, bus, "orders", {
			name: "orders/out",
			keyOf: (value) => (value as { id: string }).id,
		});
		const commands: unknown[] = [];
		const messages: unknown[] = [];
		sink.commands.subscribe((msg) => commands.push(msg));
		bus.messages.subscribe((msg) => messages.push(msg));

		source.down([["DATA", { id: "o1" }]]);

		expect(commands.at(-1)).toEqual([
			"DATA",
			{ kind: "publish", topic: "orders", payload: { id: "o1" }, key: "o1" },
		]);
		expect(messages.at(-1)).toEqual([
			"DATA",
			{ topic: "orders", seq: 1, payload: { id: "o1" }, key: "o1", timestampMs: 30 },
		]);
		const snap = g.describe();
		expect(snap.edges).toContainEqual({ from: "source", to: "orders/out" });
		expect(snap.edges).toContainEqual({ from: "orders/out", to: "bus/commands" });
	});

	it("toTopic release removes the command-source edge from the bus", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["orders"], name: "bus", now: () => 35 });
		const source = g.node<{ id: string }>([], null, { name: "source" });
		const sink = toTopic(g, source, bus, "orders", { name: "orders/out" });
		const messages: unknown[] = [];
		bus.messages.subscribe((msg) => messages.push(msg));

		source.down([["DATA", { id: "o1" }]]);
		sink.release();
		source.down([["DATA", { id: "o2" }]]);

		expect(messages).toContainEqual(["DATA", expect.objectContaining({ payload: { id: "o1" } })]);
		expect(messages).not.toContainEqual([
			"DATA",
			expect.objectContaining({ payload: { id: "o2" } }),
		]);
		expect(g.describe().edges).not.toContainEqual({ from: "orders/out", to: "bus/commands" });
	});

	it("catalog/topic/deadLetter projections answer explicit PULL params", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["orders"], name: "bus", now: () => 40 });
		bus.ensureTopic("returns");
		bus.publish("orders", { id: "o1" });
		bus.publish("missing", "bad");
		const catalog = bus.catalog();
		const topic = bus.topic<{ id: string }>("orders");
		const dead = bus.deadLetter();
		const catalogMsgs: unknown[] = [];
		const topicMsgs: unknown[] = [];
		const deadMsgs: unknown[] = [];
		catalog.snapshot.subscribe((msg) => catalogMsgs.push(msg));
		topic.snapshot.subscribe((msg) => topicMsgs.push(msg));
		dead.snapshot.subscribe((msg) => deadMsgs.push(msg));

		catalog.snapshot.up([["PULL", { pullId: catalog.snapshotPullId, params: { limit: 1 } }]]);
		topic.snapshot.up([["PULL", { pullId: topic.snapshotPullId, params: { limit: 1 } }]]);
		dead.snapshot.up([
			["PULL", { pullId: dead.snapshotPullId, params: { code: "unknown-topic" } }],
		]);

		expect(catalogMsgs.at(-1)).toEqual([
			"DATA",
			{
				topics: [expect.objectContaining({ topic: "orders" })],
				nextAfterTopic: "orders",
				hasMore: true,
			},
		]);
		expect(topicMsgs.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ topic: "orders", messages: [expect.objectContaining({ seq: 1 })] }),
		]);
		expect(deadMsgs.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				entries: [expect.objectContaining({ entrySeq: 1, topic: "missing" })],
				hasMore: false,
			}),
		]);
	});

	it("subscription available PULL is read-only; ack/seek/close move the cursor", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["orders"], name: "bus", now: () => 50 });
		bus.publish("orders", { id: "o1" });
		bus.publish("orders", { id: "o2" });
		const sub = bus.subscription<{ id: string }>({
			topic: "orders",
			subscriptionId: "worker-a",
		});
		const available: unknown[] = [];
		const cursor: unknown[] = [];
		sub.available.subscribe((msg) => available.push(msg));
		sub.cursor.subscribe((msg) => cursor.push(msg));

		sub.available.up([["PULL", { pullId: sub.availablePullId, params: { limit: 1 } }]]);
		expect(available.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				cursor: expect.objectContaining({ nextSeq: 1 }),
				messages: [expect.objectContaining({ seq: 1 })],
				nextAfterSeq: 1,
			}),
		]);

		sub.available.up([["PULL", { pullId: sub.availablePullId, params: { afterSeq: 1 } }]]);
		expect(available.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				cursor: expect.objectContaining({ nextSeq: 1 }),
				messages: [expect.objectContaining({ seq: 2 })],
			}),
		]);
		sub.ack(1);
		expect(cursor.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ topic: "orders", subscriptionId: "worker-a", nextSeq: 2 }),
		]);
		sub.seek(1);
		expect(cursor.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ topic: "orders", subscriptionId: "worker-a", nextSeq: 1 }),
		]);
		sub.close();
		expect(cursor.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ topic: "orders", subscriptionId: "worker-a", closed: true }),
		]);
	});

	it("retention trimming advances headSeq and reports retention gaps", () => {
		const g = graph();
		const bus = messageBus(g, {
			topics: ["orders"],
			name: "bus",
			now: () => 60,
			retention: { maxMessages: 1 },
		});
		const sub = bus.subscription({ topic: "orders", subscriptionId: "s1" });
		const issues: unknown[] = [];
		const cursor: unknown[] = [];
		bus.issues.subscribe((msg) => issues.push(msg));
		sub.cursor.subscribe((msg) => cursor.push(msg));

		bus.publish("orders", "a");
		bus.publish("orders", "b");
		sub.available.up([["PULL", { pullId: sub.availablePullId }]]);

		expect(issues.at(-1)).toEqual(["DATA", expect.objectContaining({ code: "retention-gap" })]);
		expect(sub.available.cache?.cursor).toEqual(
			expect.objectContaining({ headSeq: 2, retentionGap: true }),
		);
		expect(cursor.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ headSeq: 2, retentionGap: true }),
		]);
		sub.ack(2);
		expect(cursor.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ nextSeq: 3, retentionGap: true }),
		]);
		sub.seek(2);
		expect(cursor.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ nextSeq: 2, retentionGap: false }),
		]);
	});
});

describe("messageBus topic projection sugar", () => {
	it("fromTopic returns the pull snapshot node for a topic projection", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["orders"], name: "bus", now: () => 70 });
		bus.publish("orders", { id: "o1" });
		const snapshot = fromTopic<{ id: string }>(bus, "orders");
		const msgs: unknown[] = [];
		snapshot.subscribe((msg) => msgs.push(msg));

		snapshot.up([["PULL", { pullId: snapshot.pullId as symbol }]]);

		expect(msgs.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ topic: "orders", messages: [expect.objectContaining({ seq: 1 })] }),
		]);
	});
});
