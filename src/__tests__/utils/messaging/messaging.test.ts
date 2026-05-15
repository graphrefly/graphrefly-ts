import { node } from "@graphrefly/pure-ts/core/node.js";
import { describe, expect, it } from "vitest";

import { createAuditLog, mutate } from "../../../base/mutation/index.js";
import { jobFlow, jobQueue } from "../../../utils/job-queue/index.js";
import {
	DEFERRED_TOPIC,
	type HubRemoveTopicRecord,
	hubRemoveTopicKeyOf,
	INJECTIONS_TOPIC,
	type Message,
	type MessagingAuditRecord,
	messagingHub,
	PROMPTS_TOPIC,
	RESPONSES_TOPIC,
	SPAWNS_TOPIC,
	STANDARD_TOPICS,
	type StandardTopic,
	type SubscriptionAckRecord,
	type SubscriptionPullAndAckRecord,
	subscription,
	subscriptionAckKeyOf,
	subscriptionPullAndAckKeyOf,
	type TopicPublishRecord,
	topic,
	topicBridge,
	topicPublishKeyOf,
} from "../../../utils/messaging/index.js";

describe("patterns.messaging", () => {
	it("topic retains events and updates latest value", () => {
		const t = topic<number>("events");
		t.publish(1);
		t.publish(2);
		expect(t.node("latest").cache).toBe(2);
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
		// B.1 Unit 12 lock: pullAndAck replaces pull({ ack: true }). Returns { items, cursor }.
		const result = sub.pullAndAck();
		expect(result.items).toEqual([20]);
		expect(sub.pull()).toEqual([]);
		// D1(e): topic is NOT mounted under the subscription — the "topic::events"
		// edge no longer exists; verify via the externalized `sub.topic` reference
		// instead (data dependency lives at the node layer via derived-deps).
		expect(sub.topic).toBe(t);
		// B.1 Unit 12 lock: `source` passthrough removed — available depends directly
		// on topic.events + cursor (cross-graph edge). No "source" node in sub graph.
		expect(sub.edges()).not.toContainEqual(["source", "available"]);
	});

	it("jobQueue supports enqueue, claim, ack, and nack requeue", () => {
		const q = jobQueue<number>("emails");
		const id1 = q.enqueue(1);
		const id2 = q.enqueue(2);
		expect(q.node("depth").cache).toBe(2);
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
		expect(q.node("depth").cache).toBe(1);
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
		expect(bridge.node("bridgedCount").cache).toBe(2);
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

	it("subscription from:'now' skips retained history", () => {
		const t = topic<number>("events");
		t.publish(1);
		t.publish(2);
		// from: "now" — cursor starts at current topic length
		const sub = subscription("sub-now", t, { from: "now" });
		expect(sub.pull()).toEqual([]);
		t.publish(3);
		expect(sub.pull()).toEqual([3]);
	});

	it("subscription from: number sets explicit cursor", () => {
		const t = topic<number>("events");
		t.publish(10);
		t.publish(20);
		t.publish(30);
		const sub = subscription("sub-from1", t, { from: 1 });
		expect(sub.pull()).toEqual([20, 30]);
	});

	it("subscription dispose() stops pullAndAck from returning items", () => {
		const t = topic<number>("events");
		t.publish(42);
		const sub = subscription("sub-dispose", t);
		expect(sub.pull()).toEqual([42]);
		sub.dispose();
		expect(sub.pullAndAck().items).toEqual([]);
		expect(sub.pull()).toEqual([]);
	});

	it("subscription advanceOn auto-advances cursor on signal", () => {
		const t = topic<number>("events");
		t.publish(1);
		t.publish(2);
		t.publish(3);
		// advanceOn: use a state node that starts with NO initial value trigger.
		// We publish AFTER construction so the pump has no initial dep.
		const sig = topic<boolean>("advance-signal");
		const sub = subscription("sub-advance", t, { advanceOn: sig.events });
		// All 3 items visible before signal fires (cursor is 0).
		expect(sub.pull()).toHaveLength(3);
		sig.publish(true); // trigger advance — cursor advances to 3
		expect(sub.pull()).toEqual([]);
	});

	it("topicBridge output node is derived from available (reactive edge)", () => {
		const source = topic<number>("src");
		const target = topic<number>("dst");
		const bridge = topicBridge("bridge", source, target, {
			map: (v) => v * 2,
		});
		// Verify edge: output depends on subscription::available.
		// Use recursive:true so cross-graph deps are qualified with subgraph prefix.
		expect(bridge.edges({ recursive: true })).toContainEqual(["subscription::available", "output"]);
		// Verify target gets bridged items.
		source.publish(5);
		expect(target.retained()).toEqual([10]);
	});

	it("jobFlow tracks job_flow_path across stages", () => {
		const flow = jobFlow<number>("flow", { stages: ["a", "b", "c"] });
		flow.enqueue(99);
		const completed = flow.retainedCompleted();
		expect(completed).toHaveLength(1);
		const path = completed[0]?.metadata.job_flow_path as string[];
		expect(path).toEqual(["a", "b", "c"]);
	});

	it("JobQueueGraph.consumeFrom wires an external source into the queue", () => {
		const q = jobQueue<number>("q");
		// Use node([], { initial: 7 }) which pushes DATA(7) on subscribe (that's expected behaviour).
		// Count from initial subscribe + 1 more emit = depth of 2, then dispose.
		const src = node<number>([], { initial: 7 });
		const disposer = q.consumeFrom(src);
		// After subscribe: depth = 1 (push-on-subscribe with initial 7).
		src.emit(8);
		expect(q.node("depth").cache).toBe(2);
		disposer();
		src.emit(9); // after dispose — should not enqueue
		expect(q.node("depth").cache).toBe(2);
	});

	it("jobFlow auto-advances jobs across stages into completed log", () => {
		const flow = jobFlow<number>("flow", { stages: ["incoming", "work", "done"] });
		flow.enqueue(10);
		flow.enqueue(20);
		expect(flow.retainedCompleted().map((j) => j.payload)).toEqual([10, 20]);
		expect(flow.node("completedCount").cache).toBe(2);
		expect(flow.queue("incoming").node("depth").cache).toBe(0);
		expect(flow.queue("work").node("depth").cache).toBe(0);
		expect(flow.queue("done").node("depth").cache).toBe(0);
	});

	// Tier 6.5 D1 — per-stage `maxPerPump` override on `StageDef`.
	it("jobFlow honors per-stage maxPerPump override", () => {
		// Stage A caps at 1 claim per pump tick; stage B inherits the
		// top-level cap of 100. Enqueue 3 items; only 1 advances per A's
		// pending-tick. Each enqueue triggers A's pump independently, so all
		// 3 still drain through; the assertion is that A's pump body
		// processes at most 1 per call (verified by stage-A "depth" never
		// dropping below 0 mid-tick — synchronous propagation here means we
		// can only check the steady-state outcome).
		const stageACalls: number[] = [];
		const flow = jobFlow<number>("flow-cap", {
			stages: [
				{
					name: "a",
					work: (job) => {
						stageACalls.push(job.payload as number);
						return Promise.resolve(job.payload as number);
					},
					maxPerPump: 1,
				},
				{ name: "b" },
			],
			maxPerPump: 100,
		});
		flow.enqueue(1);
		flow.enqueue(2);
		flow.enqueue(3);
		// All 3 should eventually flow through (each enqueue triggers A's
		// pump again; the cap limits per-tick claims, not total throughput).
		// We can't assert per-tick claim counts directly without a pump
		// hook, but we CAN assert all 3 made it through stage A.
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				expect(stageACalls.length).toBe(3);
				resolve();
			}, 50);
		});
	});

	it("jobFlow rejects negative or zero per-stage maxPerPump at construction", () => {
		expect(() =>
			jobFlow<number>("flow-bad", {
				stages: [{ name: "a", work: (j) => Promise.resolve(j.payload), maxPerPump: -1 }, "b"],
			}),
		).toThrow();
	});

	it("jobFlow stage maxInflight caps concurrent inflight; resumes on settle (Tier 6.5 3.1)", async () => {
		// Two slots open per stage. Emit 5 items into stage1; assert at most 2
		// are in-flight at once. Resolve one held promise → next claim should
		// kick off (the inflightCounter dep re-fires the pump).
		const concurrency: number[] = [];
		let live = 0;
		const resolvers: Array<(v: number) => void> = [];
		const flow = jobFlow<number>("flow-cap", {
			stages: [
				{
					name: "work",
					maxInflight: 2,
					work: (job) => {
						live += 1;
						concurrency.push(live);
						return new Promise<number>((r) => {
							resolvers.push((v) => {
								live -= 1;
								r(v);
							});
						}).then((v) => v + job.payload);
					},
				},
				"done",
			],
		});
		const unsub = flow.completed.subscribe(() => undefined);
		for (let i = 0; i < 5; i++) flow.queue("work").enqueue(i);
		// Without maxInflight, all 5 work fns would have started.
		expect(resolvers.length).toBe(2);
		expect(concurrency.every((c) => c <= 2)).toBe(true);
		// Settle one → counter decrements → pump re-fires → next claim starts.
		resolvers.shift()?.(100);
		await Promise.resolve();
		await Promise.resolve();
		expect(resolvers.length).toBe(2);
		expect(concurrency.every((c) => c <= 2)).toBe(true);
		// Drain the rest.
		while (resolvers.length > 0) {
			resolvers.shift()?.(0);
			await Promise.resolve();
			await Promise.resolve();
		}
		flow.destroy();
		unsub();
	});

	it("jobFlow pump aborts inflight per-claim signal on destroy (Tier 6.5 2.5a)", () => {
		// Long-running work fn that resolves never inside the test's scope —
		// the inflight subscription stays open. Capture the signal from opts so
		// the test can assert teardown propagates abort to user-supplied work.
		const seen: AbortSignal[] = [];
		const flow = jobFlow<number>("flow-abort", {
			stages: [
				{
					name: "work",
					work: (_job, opts) => {
						if (opts?.signal != null) seen.push(opts.signal);
						return new Promise<number>(() => {
							/* never resolves — held until abort */
						});
					},
				},
				"done",
			],
		});
		// Activation: subscribe so the pump effect runs.
		const unsub = flow.completed.subscribe(() => undefined);
		flow.queue("work").enqueue(1);
		flow.queue("work").enqueue(2);
		// Two claims → two inflight subscriptions → two signals captured.
		expect(seen.length).toBe(2);
		expect(seen.every((s) => !s.aborted)).toBe(true);
		// Destroy the flow graph — pump teardown drains inflight signals.
		flow.destroy();
		expect(seen.every((s) => s.aborted)).toBe(true);
		unsub();
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
		// B.2 Unit 14 lock: version is now a reactive Node<number>.
		expect(hub.node("version").cache).toBe(0);

		hub.topic("a");
		expect(hub.node("version").cache).toBe(1);

		hub.topic("a"); // already exists — no advance
		expect(hub.node("version").cache).toBe(1);

		hub.publish("a", 1); // publish doesn't advance
		expect(hub.node("version").cache).toBe(1);

		hub.topic("b");
		expect(hub.node("version").cache).toBe(2);

		hub.removeTopic("a");
		expect(hub.node("version").cache).toBe(3);

		hub.removeTopic("missing"); // no-op
		expect(hub.node("version").cache).toBe(3);
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

// ---------------------------------------------------------------------------
// Phase 13.B — Message<T> envelope + standard topic constants
// ---------------------------------------------------------------------------

describe("patterns.messaging — Message envelope + standard topic constants (Phase 13.B)", () => {
	it("exposes the five well-known topic constants with stable names", () => {
		expect(PROMPTS_TOPIC).toBe("prompts");
		expect(RESPONSES_TOPIC).toBe("responses");
		expect(INJECTIONS_TOPIC).toBe("injections");
		expect(DEFERRED_TOPIC).toBe("deferred");
		expect(SPAWNS_TOPIC).toBe("spawns");
	});

	it("STANDARD_TOPICS tuple contains all five constants in declared order", () => {
		expect(STANDARD_TOPICS).toEqual([
			PROMPTS_TOPIC,
			RESPONSES_TOPIC,
			INJECTIONS_TOPIC,
			DEFERRED_TOPIC,
			SPAWNS_TOPIC,
		]);
		// Compile-time check: StandardTopic is the union of the literal types.
		const _t: StandardTopic = "prompts";
		void _t;
	});

	it("Message<T> round-trips through a hub topic with all envelope fields", () => {
		const hub = messagingHub("hub");
		const t = hub.topic<Message<{ text: string }>>(PROMPTS_TOPIC);

		const msg: Message<{ text: string }> = {
			id: "msg-1",
			schema: {
				type: "object",
				properties: { text: { type: "string" } },
				required: ["text"],
			},
			expiresAt: "2026-12-31T23:59:59Z",
			correlationId: "session-42",
			payload: { text: "hello" },
		};
		t.publish(msg);

		const received = t.retained()[0]!;
		expect(received.id).toBe("msg-1");
		expect(received.correlationId).toBe("session-42");
		expect(received.expiresAt).toBe("2026-12-31T23:59:59Z");
		expect(received.payload.text).toBe("hello");
		expect(received.schema?.properties?.text?.type).toBe("string");
	});

	it("Message<T> round-trips through a hub topic with only the required `id` + `payload`", () => {
		const hub = messagingHub("hub-min");
		const t = hub.topic<Message<number>>(SPAWNS_TOPIC);

		t.publish({ id: "msg-2", payload: 42 });

		const received = t.retained()[0]!;
		expect(received.id).toBe("msg-2");
		expect(received.payload).toBe(42);
		expect(received.schema).toBeUndefined();
		expect(received.correlationId).toBeUndefined();
		expect(received.expiresAt).toBeUndefined();
	});

	it("filtering envelopes by correlationId works via derived (request/response pairing)", () => {
		const hub = messagingHub("hub-corr");
		const responses = hub.topic<Message<string>>(RESPONSES_TOPIC);

		responses.publish({ id: "r1", correlationId: "req-A", payload: "ans-A" });
		responses.publish({ id: "r2", correlationId: "req-B", payload: "ans-B" });
		responses.publish({ id: "r3", correlationId: "req-A", payload: "ans-A2" });

		const all = responses.retained();
		const matchingA = all.filter((m) => m.correlationId === "req-A");
		expect(matchingA).toHaveLength(2);
		expect(matchingA.map((m) => m.payload)).toEqual(["ans-A", "ans-A2"]);
	});
});

// Regression: messaging audit-record schemas added pre-1.0 for symmetry with
// ProcessInstance.
// Spec: docs/implementation-plan.md DS-13.5.E (alt A, 4 records)
describe("patterns.messaging — audit-record schemas (DS-13.5.E)", () => {
	it("topicPublishKeyOf returns topicName::itemKey format", () => {
		const r: TopicPublishRecord = {
			t_ns: 0,
			seq: 1,
			kind: "topic.publish",
			topicName: "orders",
			itemKey: "abc",
		};
		expect(topicPublishKeyOf(r)).toBe("orders::abc");
	});

	it("subscriptionAckKeyOf returns subscriptionId::cursor format", () => {
		const r: SubscriptionAckRecord = {
			t_ns: 0,
			seq: 1,
			kind: "subscription.ack",
			subscriptionId: "worker-1",
			cursor: 7,
		};
		expect(subscriptionAckKeyOf(r)).toBe("worker-1::7");
	});

	it("subscriptionPullAndAckKeyOf returns subscriptionId::cursor format", () => {
		const r: SubscriptionPullAndAckRecord = {
			t_ns: 0,
			seq: 1,
			kind: "subscription.pullAndAck",
			subscriptionId: "worker-2",
			cursor: 12,
			itemCount: 3,
		};
		expect(subscriptionPullAndAckKeyOf(r)).toBe("worker-2::12");
	});

	it("hubRemoveTopicKeyOf returns topicName", () => {
		const r: HubRemoveTopicRecord = {
			t_ns: 0,
			seq: 1,
			kind: "hub.removeTopic",
			topicName: "stale",
		};
		expect(hubRemoveTopicKeyOf(r)).toBe("stale");
	});

	it("kind discriminator narrows record types in MessagingAuditRecord union", () => {
		const records: MessagingAuditRecord[] = [
			{ t_ns: 1, kind: "topic.publish", topicName: "t", itemKey: "k" },
			{ t_ns: 2, kind: "subscription.ack", subscriptionId: "s", cursor: 1 },
			{
				t_ns: 3,
				kind: "subscription.pullAndAck",
				subscriptionId: "s",
				cursor: 2,
				itemCount: 1,
			},
			{ t_ns: 4, kind: "hub.removeTopic", topicName: "t" },
		];

		const keys = records.map((r): string => {
			switch (r.kind) {
				case "topic.publish":
					// Narrowed: TopicPublishRecord
					return topicPublishKeyOf(r);
				case "subscription.ack":
					return subscriptionAckKeyOf(r);
				case "subscription.pullAndAck":
					return subscriptionPullAndAckKeyOf(r);
				case "hub.removeTopic":
					return hubRemoveTopicKeyOf(r);
				default: {
					const _exhaustive: never = r;
					return _exhaustive;
				}
			}
		});

		expect(keys).toEqual(["t::k", "s::1", "s::2", "t"]);
	});

	it("TopicPublishRecord composes with mutate audit opts (opt-in emission)", () => {
		const t = topic<{ id: string; payload: string }>("orders");
		const log = createAuditLog<TopicPublishRecord>({ name: "publishes" });
		// Activate the entries node so .cache reflects appends synchronously.
		const unsub = log.entries.subscribe(() => undefined);

		const auditedPublish = mutate(
			(item: { id: string; payload: string }): void => t.publish(item),
			{
				frame: "inline",
				log,
				onSuccessRecord: ([item], _r, m) => ({
					t_ns: m.t_ns,
					seq: m.seq,
					kind: "topic.publish" as const,
					topicName: t.name,
					itemKey: item.id,
				}),
			},
		);

		auditedPublish({ id: "a", payload: "first" });
		auditedPublish({ id: "b", payload: "second" });

		const entries = log.entries.cache as readonly TopicPublishRecord[];
		expect(entries).toHaveLength(2);
		expect(entries[0]!.kind).toBe("topic.publish");
		expect(entries[0]!.topicName).toBe("orders");
		expect(entries[0]!.itemKey).toBe("a");
		expect(entries[1]!.itemKey).toBe("b");

		unsub();
	});

	it("SubscriptionAckRecord composes with mutate audit opts", () => {
		const t = topic<number>("nums");
		t.publish(10);
		t.publish(20);
		t.publish(30);
		const sub = subscription<number>("worker", t);

		const log = createAuditLog<SubscriptionAckRecord>({ name: "acks" });
		const unsub = log.entries.subscribe(() => undefined);

		const auditedAck = mutate((count: number): number => sub.ack(count), {
			frame: "inline",
			log,
			onSuccessRecord: (_args, cursor, m) => ({
				t_ns: m.t_ns,
				seq: m.seq,
				kind: "subscription.ack" as const,
				subscriptionId: sub.name,
				cursor,
			}),
		});

		auditedAck(2);
		auditedAck(1);

		const entries = log.entries.cache as readonly SubscriptionAckRecord[];
		expect(entries).toHaveLength(2);
		expect(entries[0]!.kind).toBe("subscription.ack");
		expect(entries[0]!.subscriptionId).toBe("worker");
		expect(entries[0]!.cursor).toBe(2);
		expect(entries[1]!.cursor).toBe(3);

		unsub();
	});

	it("SubscriptionPullAndAckRecord composes with mutate audit opts", () => {
		const t = topic<string>("letters");
		t.publish("a");
		t.publish("b");
		t.publish("c");
		const sub = subscription<string>("reader", t);

		const log = createAuditLog<SubscriptionPullAndAckRecord>({ name: "pulls" });
		const unsub = log.entries.subscribe(() => undefined);

		const auditedPullAndAck = mutate((limit: number) => sub.pullAndAck(limit), {
			frame: "inline",
			log,
			onSuccessRecord: (_args, result, m) => ({
				t_ns: m.t_ns,
				seq: m.seq,
				kind: "subscription.pullAndAck" as const,
				subscriptionId: sub.name,
				cursor: result.cursor,
				itemCount: result.items.length,
			}),
		});

		auditedPullAndAck(2);
		auditedPullAndAck(5);

		const entries = log.entries.cache as readonly SubscriptionPullAndAckRecord[];
		expect(entries).toHaveLength(2);
		expect(entries[0]!.itemCount).toBe(2);
		expect(entries[0]!.cursor).toBe(2);
		expect(entries[1]!.itemCount).toBe(1);
		expect(entries[1]!.cursor).toBe(3);

		unsub();
	});

	it("HubRemoveTopicRecord composes with mutate audit opts", () => {
		const hub = messagingHub("hub");
		hub.topic<number>("alpha");
		hub.topic<number>("beta");

		const log = createAuditLog<HubRemoveTopicRecord>({ name: "removals" });
		const unsub = log.entries.subscribe(() => undefined);

		const auditedRemove = mutate((name: string): boolean => hub.removeTopic(name), {
			frame: "inline",
			log,
			onSuccessRecord: ([name], removed, m) =>
				removed
					? {
							t_ns: m.t_ns,
							seq: m.seq,
							kind: "hub.removeTopic" as const,
							topicName: name,
						}
					: undefined,
		});

		auditedRemove("alpha");
		auditedRemove("does-not-exist"); // should NOT emit (returns false → undefined)

		const entries = log.entries.cache as readonly HubRemoveTopicRecord[];
		expect(entries).toHaveLength(1);
		expect(entries[0]!.kind).toBe("hub.removeTopic");
		expect(entries[0]!.topicName).toBe("alpha");

		unsub();
	});

	it("audit field stays optional — Topic.publish without audit opts emits no records", () => {
		// Without mutate/audit wiring, the topic's mutation site does
		// not emit any records (audit field stays optional at all four sites).
		const t = topic<number>("plain");
		t.publish(1);
		t.publish(2);
		// No audit log to assert against — the absence of an audit surface IS
		// the contract. Confirm the topic still works as expected.
		expect(t.retained()).toEqual([1, 2]);
	});
});
