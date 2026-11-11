import { describe, expect, expectTypeOf, it } from "vitest";
import { graph } from "../graph/graph.js";
import {
	CONTEXT_TOPIC,
	DEFERRED_TOPIC,
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
import { asState } from "./helpers/as-state.js";

/** The bus's host input: its command node's first declared dependency. */
function publishInput(bus: { readonly commands: { readonly deps: readonly unknown[] } }) {
	return asState(bus.commands.deps[0] as Parameters<typeof asState>[0]);
}

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
		bus.issues.subscribe((incoming) => {
			for (const msg of incoming) {
				issues.push(msg);
			}
		});

		bus.publish("missing", { id: "x" }, { commandId: "cmd-1" });

		expect(issues.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				kind: "issue",
				code: "unknown-topic",
				source: "messageBus",
			}),
		]);
		const catalog = bus.catalog();
		catalog.snapshot.subscribe(() => {}); // R-lifetime: an inactive projection does not run
		asState(catalog.snapshotRequest).set({});
		expect(catalog.snapshot.cache?.topics.map((topic) => topic.topic)).not.toContain("missing");
	});

	it("rejects unknown command kinds as DataIssue facts instead of throwing", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["orders"], name: "bus", now: () => 25 });
		const issues: unknown[] = [];
		bus.issues.subscribe((incoming) => {
			for (const msg of incoming) {
				issues.push(msg);
			}
		});

		expect(() =>
			publishInput(bus).set({ kind: "bogus", topic: "orders", commandId: "bad-1" } as never),
		).not.toThrow();

		expect(issues.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ code: "malformed-command", source: "messageBus" }),
		]);

		expect(() => publishInput(bus).set(null as never)).not.toThrow();
		expect(issues.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ code: "malformed-command", source: "messageBus" }),
		]);
	});

	it("dedupes publish commands by idempotencyKey", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["orders"], name: "bus", now: () => 27 });
		const messages: unknown[] = [];
		const status: unknown[] = [];
		bus.messages.subscribe((incoming) => {
			for (const msg of incoming) {
				messages.push(msg);
			}
		});
		bus.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});

		bus.publish("orders", { id: "o1" }, { commandId: "cmd-1", idempotencyKey: "idem-1" });
		bus.publish("orders", { id: "o2" }, { commandId: "cmd-2", idempotencyKey: "idem-1" });

		expect(messages.filter((msg) => msg[0] === "DATA")).toEqual([
			[
				"DATA",
				expect.objectContaining({
					payload: { id: "o1" },
					idempotencyKey: "idem-1",
				}),
			],
		]);
		expect(status).toContainEqual([
			"DATA",
			expect.objectContaining({ kind: "duplicate-command", commandId: "cmd-2" }),
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
		sink.commands.subscribe((incoming) => {
			for (const msg of incoming) {
				commands.push(msg);
			}
		});
		bus.messages.subscribe((incoming) => {
			for (const msg of incoming) {
				messages.push(msg);
			}
		});

		source.set({ id: "o1" });

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
		bus.messages.subscribe((incoming) => {
			for (const msg of incoming) {
				messages.push(msg);
			}
		});

		source.set({ id: "o1" });
		sink.release();
		source.set({ id: "o2" });

		expect(messages).toContainEqual(["DATA", expect.objectContaining({ payload: { id: "o1" } })]);
		expect(messages).not.toContainEqual([
			"DATA",
			expect.objectContaining({ payload: { id: "o2" } }),
		]);
		expect(g.describe().edges).not.toContainEqual({ from: "orders/out", to: "bus/commands" });
	});

	it("catalog/topic/deadLetter projections answer the params written to their request state", () => {
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
		catalog.snapshot.subscribe((incoming) => {
			for (const msg of incoming) {
				catalogMsgs.push(msg);
			}
		});
		topic.snapshot.subscribe((incoming) => {
			for (const msg of incoming) {
				topicMsgs.push(msg);
			}
		});
		dead.snapshot.subscribe((incoming) => {
			for (const msg of incoming) {
				deadMsgs.push(msg);
			}
		});

		asState(catalog.snapshotRequest).set({ limit: 1 });
		asState(topic.snapshotRequest).set({ limit: 1 });
		asState(dead.snapshotRequest).set({ code: "unknown-topic" });

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

	it("subscription available request is read-only; ack/seek/close move the cursor", () => {
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
		sub.available.subscribe((incoming) => {
			for (const msg of incoming) {
				available.push(msg);
			}
		});
		sub.cursor.subscribe((incoming) => {
			for (const msg of incoming) {
				cursor.push(msg);
			}
		});

		asState(sub.availableRequest).set({ limit: 1 });
		expect(available.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				cursor: expect.objectContaining({ nextSeq: 1 }),
				messages: [expect.objectContaining({ seq: 1 })],
				nextAfterSeq: 1,
			}),
		]);

		asState(sub.availableRequest).set({ afterSeq: 1 });
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
		bus.issues.subscribe((incoming) => {
			for (const msg of incoming) {
				issues.push(msg);
			}
		});
		sub.cursor.subscribe((incoming) => {
			for (const msg of incoming) {
				cursor.push(msg);
			}
		});

		bus.publish("orders", "a");
		bus.publish("orders", "b");
		sub.available.subscribe(() => {}); // R-lifetime: an inactive projection does not run
		asState(sub.availableRequest).set({});

		expect(issues.at(-1)).toEqual(["DATA", expect.objectContaining({ code: "retention-gap" })]);
		expect(sub.available.cache?.cursor).toEqual(
			expect.objectContaining({ headSeq: 2, retentionGap: true }),
		);
		expect(sub.available.cache?.messages).toEqual([]);
		// The cursor's last value (a later wave may settle it with the kernel's RESOLVED, R-wave).
		expect(cursor.filter((msg) => Array.isArray(msg) && msg[0] === "DATA").at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ headSeq: 2, retentionGap: true }),
		]);
		const cursorDataBeforeAck = cursor.filter((msg) => Array.isArray(msg) && msg[0] === "DATA");
		sub.ack(2);
		expect(cursor.filter((msg) => Array.isArray(msg) && msg[0] === "DATA")).toEqual(
			cursorDataBeforeAck,
		);
		expect(cursorDataBeforeAck.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ headSeq: 2, retentionGap: true }),
		]);
		sub.seek(2);
		expect(cursor.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ nextSeq: 2, retentionGap: false }),
		]);
	});

	it("rejects invalid cursor commands without creating subscriptions or skipping messages", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["orders"], name: "bus", now: () => 65 });
		const issues: unknown[] = [];
		bus.issues.subscribe((incoming) => {
			for (const msg of incoming) {
				issues.push(msg);
			}
		});
		bus.publish("orders", "a");

		publishInput(bus).set({ kind: "ack", topic: "orders", subscriptionId: "missing", seq: 1 });
		expect(issues.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ code: "unknown-subscription" }),
		]);

		const sub = bus.subscription({ topic: "orders", subscriptionId: "s1" });
		sub.ack(2);
		expect(issues.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ code: "cursor-out-of-range" }),
		]);
		sub.available.subscribe(() => {}); // R-lifetime: an inactive projection does not run
		asState(sub.availableRequest).set({});
		expect(sub.available.cache?.cursor.nextSeq).toBe(1);
		expect(sub.available.cache?.messages.map((msg) => msg.seq)).toEqual([1]);
	});

	it("closed subscriptions do not receive later retention-gap updates", () => {
		const g = graph();
		const bus = messageBus(g, {
			topics: ["orders"],
			name: "bus",
			now: () => 66,
			retention: { maxMessages: 1 },
		});
		const sub = bus.subscription({ topic: "orders", subscriptionId: "s1" });
		const issues: unknown[] = [];
		bus.issues.subscribe((incoming) => {
			for (const msg of incoming) {
				issues.push(msg);
			}
		});

		sub.close();
		bus.publish("orders", "a");
		bus.publish("orders", "b");

		expect(issues).not.toContainEqual(["DATA", expect.objectContaining({ code: "retention-gap" })]);
	});
});

describe("messageBus topic projection request (graphrefly-ts:D172)", () => {
	it("a topic projection serves one page per live write to its request state", () => {
		const g = graph();
		const bus = messageBus(g, { topics: ["orders"], name: "bus", now: () => 70 });
		bus.publish("orders", { id: "o1" });
		const topic = bus.topic<{ id: string }>("orders");
		const msgs: unknown[] = [];
		topic.snapshot.subscribe((incoming) => {
			for (const msg of incoming) {
				msgs.push(msg);
			}
		});
		expect(msgs).toEqual([["START"]]);

		asState(topic.snapshotRequest).set({});

		expect(msgs.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ topic: "orders", messages: [expect.objectContaining({ seq: 1 })] }),
		]);
	});
});
