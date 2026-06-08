import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import {
	dynamicHub,
	fromHubTopic,
	fromTopic,
	messageBus,
	toHubTopic,
	toTopic,
} from "../messaging/index.js";

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

describe("dynamic hub application infrastructure (D135)", () => {
	it("keeps hub topology static while routing dynamic topic facts", () => {
		const g = graph();
		const hub = dynamicHub<{ id: string }>(g, {
			name: "hub",
			topics: ["orders"],
			now: () => 100,
		});
		const orders = fromHubTopic<{ id: string }>(hub, "orders", { name: "orders/in" });
		const topicMsgs: unknown[] = [];
		const statusMsgs: unknown[] = [];
		orders.subscribe((msg) => topicMsgs.push(msg));
		hub.status.subscribe((msg) => statusMsgs.push(msg));

		hub.publish("orders", { id: "o1" }, { key: "o1" });
		hub.create("returns");
		hub.publish("returns", { id: "r1" }, { key: "r1" });

		expect(topicMsgs).toContainEqual([
			"DATA",
			{ topic: "orders", seq: 1, payload: { id: "o1" }, key: "o1", timestampMs: 100 },
		]);
		expect(statusMsgs.at(-1)).toEqual([
			"DATA",
			{ open: true, topics: ["orders", "returns"], seq: 3, cursor: 3, lastEventKind: "message" },
		]);
		const snap = g.describe();
		expect(snap.nodes.map((node) => [node.id, node.factory])).toEqual(
			expect.arrayContaining([
				["hub/command", "dynamicHubCommand"],
				["hub/events", "dynamicHubEvents"],
				["hub/status", "dynamicHubStatus"],
				["hub/errors", "dynamicHubErrors"],
				["orders/in", "fromHubTopic"],
			]),
		);
		expect(snap.nodes.map((node) => node.id)).not.toContain("hub/returns");
		expect(snap.edges).toContainEqual({ from: "hub/command", to: "hub/events" });
		expect(snap.edges).toContainEqual({ from: "hub/events", to: "hub/status" });
		expect(snap.edges).toContainEqual({ from: "hub/events", to: "hub/errors" });
		expect(snap.edges).toContainEqual({ from: "hub/events", to: "orders/in" });
	});

	it("defaults unknown-topic behavior to graph-visible errors", () => {
		const g = graph();
		const hub = dynamicHub(g, { name: "hub", now: () => 200 });
		const errors: unknown[] = [];
		hub.errors.subscribe((msg) => errors.push(msg));

		hub.publish("missing", "payload");

		expect(errors.at(-1)).toEqual([
			"DATA",
			{
				topic: "missing",
				error: "dynamicHub: unknown topic 'missing'",
				command: { kind: "publish", topic: "missing", payload: "payload" },
				meta: { seq: 1, cursor: 1, timestampMs: 200 },
			},
		]);
		expect(g.describe().nodes.map((node) => node.id)).not.toContain("hub/missing");
	});

	it("can route unknown topics to an optional dead-letter node without creating topology", () => {
		const g = graph();
		const hub = dynamicHub(g, {
			name: "hub",
			unknownTopic: "dead-letter",
			now: () => 300,
		});
		const dead: unknown[] = [];
		hub.deadLetter?.subscribe((msg) => dead.push(msg));

		hub.subscribeTopic("missing", { key: "subscriber-a" });

		expect(dead.at(-1)).toEqual([
			"DATA",
			{
				topic: "missing",
				reason: "dynamicHub: unknown topic 'missing'",
				command: { kind: "subscribe", topic: "missing", key: "subscriber-a" },
				meta: { seq: 1, cursor: 1, timestampMs: 300 },
			},
		]);
		expect(g.describe().nodes.map((node) => [node.id, node.factory])).toContainEqual([
			"hub/deadLetter",
			"dynamicHubDeadLetter",
		]);
	});

	it("supports create-as-fact without runtime topic node creation", () => {
		const g = graph();
		const hub = dynamicHub<{ id: string }>(g, {
			name: "hub",
			unknownTopic: "create-as-fact",
			now: () => 400,
		});
		const events: unknown[] = [];
		const orders = fromHubTopic<{ id: string }>(hub, "orders");
		const ordersMsgs: unknown[] = [];
		hub.events.subscribe((msg) => events.push(msg));
		orders.subscribe((msg) => ordersMsgs.push(msg));

		hub.publish("orders", { id: "o1" });

		expect(events.slice(-2)).toEqual([
			[
				"DATA",
				{
					kind: "create",
					topic: "orders",
					meta: { seq: 1, cursor: 1, timestampMs: 400 },
					status: {
						open: true,
						topics: ["orders"],
						seq: 1,
						cursor: 1,
						lastEventKind: "create",
					},
				},
			],
			[
				"DATA",
				{
					kind: "message",
					topic: "orders",
					payload: { id: "o1" },
					meta: { seq: 2, cursor: 2, timestampMs: 400 },
					status: {
						open: true,
						topics: ["orders"],
						seq: 2,
						cursor: 2,
						lastEventKind: "message",
					},
				},
			],
		]);
		expect(ordersMsgs.at(-1)).toEqual([
			"DATA",
			{ topic: "orders", seq: 2, payload: { id: "o1" }, timestampMs: 400 },
		]);
		expect(g.describe().nodes.map((node) => node.id)).not.toContain("hub/orders");
	});

	it("toHubTopic publishes command facts through a visible static helper edge", () => {
		const g = graph();
		const hub = dynamicHub<{ id: string }>(g, {
			name: "hub",
			topics: ["orders"],
			now: () => 500,
		});
		const source = g.node<{ id: string }>([], null, { name: "source" });
		const projection = fromHubTopic<{ id: string }>(hub, "orders", { name: "orders/in" });
		toHubTopic(g, source, hub, "orders", {
			name: "orders/out",
			keyOf: (value) => value.id,
		});
		const commands: unknown[] = [];
		const orders: unknown[] = [];
		hub.command.subscribe((msg) => commands.push(msg));
		projection.subscribe((msg) => orders.push(msg));

		source.down([["DATA", { id: "o2" }]]);

		expect(commands.at(-1)).toEqual([
			"DATA",
			{ kind: "publish", topic: "orders", payload: { id: "o2" }, key: "o2" },
		]);
		expect(orders.at(-1)).toEqual([
			"DATA",
			{ topic: "orders", seq: 1, payload: { id: "o2" }, key: "o2", timestampMs: 500 },
		]);
		const snap = g.describe();
		expect(snap.edges).toContainEqual({ from: "source", to: "orders/out" });
		expect(snap.edges).toContainEqual({ from: "orders/out", to: "hub/command" });
		expect(snap.edges).toContainEqual({ from: "hub/command", to: "hub/events" });
	});

	it("status projects latest event snapshots for late subscribers", () => {
		const g = graph();
		const hub = dynamicHub(g, { name: "hub", topics: ["orders"], now: () => 600 });
		const events: unknown[] = [];
		hub.events.subscribe((msg) => events.push(msg));

		hub.create("returns");
		hub.delete("orders");

		const status: unknown[] = [];
		hub.status.subscribe((msg) => status.push(msg));

		expect(events.length).toBeGreaterThan(0);
		expect(status.at(-1)).toEqual([
			"DATA",
			{ open: true, topics: ["returns"], seq: 2, cursor: 2, lastEventKind: "delete" },
		]);
	});

	it("routes malformed command facts to hub errors without terminating events", () => {
		const g = graph();
		const hub = dynamicHub(g, { name: "hub", topics: ["orders"], now: () => 700 });
		const errors: unknown[] = [];
		const orders = fromHubTopic<string>(hub, "orders");
		const ordersMsgs: unknown[] = [];
		hub.errors.subscribe((msg) => errors.push(msg));
		orders.subscribe((msg) => ordersMsgs.push(msg));

		hub.command.down([["DATA", { kind: "bogus" } as never]]);
		hub.publish("orders", "ok");

		expect(errors).toContainEqual([
			"DATA",
			{
				error: "dynamicHub: command kind is not recognized",
				command: { kind: "bogus" },
				meta: { seq: 1, cursor: 1, timestampMs: 700 },
			},
		]);
		expect(ordersMsgs.at(-1)).toEqual([
			"DATA",
			{ topic: "orders", seq: 2, payload: "ok", timestampMs: 700 },
		]);
	});

	it("does not commit topic state when now throws before a create event", () => {
		const g = graph();
		let fail = true;
		const hub = dynamicHub(g, {
			name: "hub",
			now: () => {
				if (fail) throw new Error("clock down");
				return 800;
			},
		});
		const errors: unknown[] = [];
		const status: unknown[] = [];
		hub.errors.subscribe((msg) => errors.push(msg));
		hub.status.subscribe((msg) => status.push(msg));

		hub.create("orders");
		fail = false;
		hub.publish("orders", "late");

		expect(errors).toContainEqual([
			"DATA",
			expect.objectContaining({
				error: "dynamicHub: now() threw: clock down",
				command: { kind: "create", topic: "orders" },
				meta: expect.objectContaining({ seq: 1, cursor: 1 }),
			}),
		]);
		expect(status.at(-1)).toEqual([
			"DATA",
			{
				open: true,
				topics: [],
				seq: 2,
				cursor: 2,
				lastEventKind: "error",
			},
		]);
	});

	it("routes toHubTopic key extraction failures through hub errors", () => {
		const g = graph();
		const hub = dynamicHub<{ id: string }>(g, {
			name: "hub",
			topics: ["orders"],
			now: () => 900,
		});
		const source = g.node<{ id: string }>([], null, { name: "source" });
		toHubTopic(g, source, hub, "orders", {
			name: "orders/out",
			keyOf: () => {
				throw new Error("bad key");
			},
		});
		const errors: unknown[] = [];
		hub.errors.subscribe((msg) => errors.push(msg));

		source.down([["DATA", { id: "o3" }]]);

		expect(errors.at(-1)).toEqual([
			"DATA",
			{
				topic: "orders",
				error: "dynamicHub: command kind is not recognized",
				command: { kind: "invalid", topic: "orders", error: "bad key" },
				meta: { seq: 1, cursor: 1, timestampMs: 900 },
			},
		]);
	});

	it("retains hub reducer so command facts are not collapsed before external subscription", () => {
		const g = graph();
		const hub = dynamicHub(g, { name: "hub", now: () => 950 });

		hub.create("orders");
		hub.publish("orders", "first");
		hub.publish("orders", "second");

		const orders = fromHubTopic<string>(hub, "orders");
		const status: unknown[] = [];
		const messages: unknown[] = [];
		hub.status.subscribe((msg) => status.push(msg));
		orders.subscribe((msg) => messages.push(msg));
		hub.publish("orders", "third");

		expect(status.at(-1)).toEqual([
			"DATA",
			{ open: true, topics: ["orders"], seq: 4, cursor: 4, lastEventKind: "message" },
		]);
		expect(messages).toEqual([
			["START"],
			["DATA", { topic: "orders", seq: 3, payload: "second", timestampMs: 950 }],
			["DIRTY"],
			["DATA", { topic: "orders", seq: 4, payload: "third", timestampMs: 950 }],
		]);
	});

	it("persists JSON-friendly hub runtime across projection deactivation", () => {
		const g = graph();
		const hub = dynamicHub(g, { name: "hub", now: () => 960 });
		hub.create("orders");
		const firstStatus: unknown[] = [];
		const unsubscribe = hub.status.subscribe((msg) => firstStatus.push(msg));
		unsubscribe();

		hub.publish("orders", "after");
		const secondStatus: unknown[] = [];
		hub.status.subscribe((msg) => secondStatus.push(msg));

		expect(secondStatus.at(-1)).toEqual([
			"DATA",
			{ open: true, topics: ["orders"], seq: 2, cursor: 2, lastEventKind: "message" },
		]);
		expect(() => g.checkpoint()).not.toThrow();
	});

	it("rejects cyclic toHubTopic wiring without contaminating later helpers", () => {
		const g = graph();
		const hub = dynamicHub<string>(g, { name: "hub", topics: ["orders"], now: () => 970 });
		expect(() => toHubTopic(g, hub.status, hub, "orders", { name: "bad/out" })).toThrow(
			"toHubTopic: source already depends on hub command path",
		);

		const source = g.node<string>([], null, { name: "source/ok" });
		const projection = fromHubTopic<string>(hub, "orders", { name: "orders/in/ok" });
		const seen: unknown[] = [];
		projection.subscribe((msg) => seen.push(msg));
		toHubTopic(g, source, hub, "orders", { name: "orders/out/ok" });
		source.down([["DATA", "ok"]]);

		expect(seen.at(-1)).toEqual([
			"DATA",
			{ topic: "orders", seq: 1, payload: "ok", timestampMs: 970 },
		]);
		expect(g.describe().nodes.map((node) => node.id)).not.toContain("bad/out");
		expect(g.describe().edges).toContainEqual({ from: "orders/out/ok", to: "hub/command" });
	});

	it("bounds dynamic topic count and topic key length as graph-visible errors", () => {
		const g = graph();
		const hub = dynamicHub(g, {
			name: "hub",
			topics: ["orders"],
			maxTopics: 1,
			maxTopicLength: 16,
			unknownTopic: "create-as-fact",
			now: () => 980,
		});
		const errors: unknown[] = [];
		hub.errors.subscribe((msg) => errors.push(msg));

		hub.create("audit");

		expect(errors).toContainEqual([
			"DATA",
			{
				topic: "audit",
				error: "dynamicHub: topic count exceeds maxTopics",
				command: { kind: "create", topic: "audit" },
				meta: { seq: 1, cursor: 1, timestampMs: 980 },
			},
		]);

		const lengthHub = dynamicHub(g, {
			name: "lengthHub",
			maxTopicLength: 6,
			unknownTopic: "create-as-fact",
			now: () => 981,
		});
		const lengthErrors: unknown[] = [];
		lengthHub.errors.subscribe((msg) => lengthErrors.push(msg));
		lengthHub.publish("toolong", "payload");

		expect(lengthErrors).toContainEqual([
			"DATA",
			{
				topic: "toolong",
				error: "dynamicHub: topic exceeds maxTopicLength",
				command: { kind: "publish", topic: "toolong", payload: "payload" },
				meta: { seq: 1, cursor: 1, timestampMs: 981 },
			},
		]);
		expect(() => dynamicHub(g, { topics: ["orders", "audit"], maxTopics: 1 })).toThrow(
			"dynamicHub: topics exceed maxTopics",
		);
		expect(() => dynamicHub(g, { maxTopics: 0 })).toThrow(
			"dynamicHub: maxTopics must be a positive integer",
		);
	});

	it("rejects invalid static helper topics and unknown-topic policies before adding topology", () => {
		const g = graph();
		const hub = dynamicHub(g, { name: "hub" });
		const source = g.node([], null, { name: "source" });
		const before = g.describe().nodes.map((node) => node.id);

		expect(() => fromHubTopic(hub, "")).toThrow("fromHubTopic: topic must be a non-empty string");
		expect(() => toHubTopic(g, source, hub, "")).toThrow(
			"toHubTopic: topic must be a non-empty string",
		);
		expect(() => dynamicHub(g, { unknownTopic: "deadletter" as never })).toThrow(
			"dynamicHub: unknownTopic policy is not recognized",
		);
		expect(g.describe().nodes.map((node) => node.id)).toEqual(before);
	});
});
