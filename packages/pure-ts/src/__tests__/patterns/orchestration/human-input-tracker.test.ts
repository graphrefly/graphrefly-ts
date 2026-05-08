/**
 * Phase 13.F — `humanInput<T>` + `tracker` regression tests.
 */

import { describe, expect, it } from "vitest";

import { DATA } from "../../../core/messages.js";
import { node } from "../../../core/node.js";
import {
	DEFERRED_TOPIC,
	type Message,
	messagingHub,
	PROMPTS_TOPIC,
	RESPONSES_TOPIC,
} from "../../../patterns/messaging/index.js";
import { humanInput, tracker } from "../../../patterns/orchestration/index.js";

// ---------------------------------------------------------------------------
// humanInput
// ---------------------------------------------------------------------------

describe("humanInput<T> (Phase 13.F)", () => {
	it("publishes a Message envelope to PROMPTS_TOPIC on each prompt", () => {
		const hub = messagingHub("hub");
		const promptN = node<string>([], { name: "prompt", initial: "first?" });

		const reply = humanInput<{ ok: boolean }>({ hub, prompt: promptN });
		// Subscribe to wake the pipeline.
		const replyUnsub = reply.subscribe(() => {});

		const promptsTopic = hub.topic<Message<{ prompt: string }>>(PROMPTS_TOPIC);
		const published = promptsTopic.retained();
		expect(published).toHaveLength(1);
		expect(published[0]?.payload.prompt).toBe("first?");
		expect(typeof published[0]?.id).toBe("string");
		expect(typeof published[0]?.correlationId).toBe("string");

		// New prompt → new envelope with fresh correlationId.
		promptN.emit("second?");
		const after = promptsTopic.retained();
		expect(after).toHaveLength(2);
		expect(after[1]?.payload.prompt).toBe("second?");
		expect(after[1]?.correlationId).not.toBe(after[0]?.correlationId);

		replyUnsub();
		hub.destroy();
	});

	it("emits the response payload when RESPONSES_TOPIC delivers a matching correlationId", () => {
		const hub = messagingHub("hub");
		const promptN = node<string>([], { name: "prompt", initial: "approve?" });

		const reply = humanInput<{ ok: boolean }>({ hub, prompt: promptN });
		const seen: { ok: boolean }[] = [];
		const unsub = reply.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push(m[1] as { ok: boolean });
			}
		});

		const promptsTopic = hub.topic<Message<{ prompt: string }>>(PROMPTS_TOPIC);
		const responsesTopic = hub.topic<Message<{ ok: boolean }>>(RESPONSES_TOPIC);
		const sentEnv = promptsTopic.retained()[0]!;

		// Mock human responding.
		responsesTopic.publish({
			id: "resp-1",
			correlationId: sentEnv.correlationId,
			payload: { ok: true },
		});

		expect(seen).toEqual([{ ok: true }]);

		unsub();
		hub.destroy();
	});

	it("ignores responses with non-matching correlationId", () => {
		const hub = messagingHub("hub");
		const promptN = node<string>([], { name: "prompt", initial: "x" });

		const reply = humanInput<{ ok: boolean }>({ hub, prompt: promptN });
		const seen: { ok: boolean }[] = [];
		const unsub = reply.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push(m[1] as { ok: boolean });
			}
		});

		const responsesTopic = hub.topic<Message<{ ok: boolean }>>(RESPONSES_TOPIC);

		// Unrelated response (different correlationId).
		responsesTopic.publish({
			id: "stale",
			correlationId: "completely-unrelated",
			payload: { ok: false },
		});

		expect(seen).toEqual([]);

		unsub();
		hub.destroy();
	});

	it("switchMap semantics — new prompt abandons the prior in-flight watcher", () => {
		const hub = messagingHub("hub");
		const promptN = node<string>([], { name: "prompt", initial: "first" });

		const reply = humanInput<{ tag: string }>({ hub, prompt: promptN });
		const seen: { tag: string }[] = [];
		const unsub = reply.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push(m[1] as { tag: string });
			}
		});

		const promptsTopic = hub.topic<Message<{ prompt: string }>>(PROMPTS_TOPIC);
		const responsesTopic = hub.topic<Message<{ tag: string }>>(RESPONSES_TOPIC);

		const firstEnv = promptsTopic.retained()[0]!;

		// Issue a second prompt before the first response arrives.
		promptN.emit("second");
		const secondEnv = promptsTopic.retained()[1]!;

		// A response for the FIRST prompt is now stale — should be ignored.
		responsesTopic.publish({
			id: "r1",
			correlationId: firstEnv.correlationId,
			payload: { tag: "stale" },
		});
		expect(seen).toEqual([]);

		// A response for the SECOND prompt is delivered.
		responsesTopic.publish({
			id: "r2",
			correlationId: secondEnv.correlationId,
			payload: { tag: "fresh" },
		});
		expect(seen).toEqual([{ tag: "fresh" }]);

		unsub();
		hub.destroy();
	});

	it("carries optional schema in the envelope", () => {
		const hub = messagingHub("hub");
		const promptN = node<string>([], { name: "prompt", initial: "?" });
		const schema = { type: "object" as const, required: ["ok"] };

		const reply = humanInput<{ ok: boolean }>({ hub, prompt: promptN, schema });
		const unsub = reply.subscribe(() => {});

		const promptsTopic = hub.topic<Message<{ prompt: string }>>(PROMPTS_TOPIC);
		const env = promptsTopic.retained()[0]!;
		// Schema is carried at envelope-level only (Phase 13.B contract);
		// payload stays the typed `HumanPromptPayload` without the duplicate.
		expect(env.schema).toEqual(schema);
		expect((env.payload as unknown as { schema?: unknown }).schema).toBeUndefined();

		unsub();
		hub.destroy();
	});
});

// ---------------------------------------------------------------------------
// tracker
// ---------------------------------------------------------------------------

describe("tracker (Phase 13.F)", () => {
	it("uses DEFERRED_TOPIC by default", () => {
		const hub = messagingHub("hub");
		const t = tracker<string>({ hub });
		expect(t.topic).toBe(hub.topic(DEFERRED_TOPIC));
		hub.destroy();
	});

	it("add() appends to the topic; pending reflects unconsumed items", () => {
		const hub = messagingHub("hub");
		const t = tracker<{ summary: string }>({ hub });

		t.add({ summary: "investigate" });
		t.add({ summary: "follow up" });

		const pending = t.pending.cache as readonly { summary: string }[];
		expect(pending).toHaveLength(2);
		expect(pending.map((p) => p.summary)).toEqual(["investigate", "follow up"]);
		expect(t.total.cache).toBe(2);

		hub.destroy();
	});

	it("ack(n) advances the cursor; pending excludes acked items", () => {
		const hub = messagingHub("hub");
		const t = tracker<number>({ hub });
		t.add(1);
		t.add(2);
		t.add(3);

		expect(t.pending.cache as readonly number[]).toEqual([1, 2, 3]);
		t.ack(2);
		expect(t.pending.cache as readonly number[]).toEqual([3]);

		hub.destroy();
	});

	it("pullAndAck returns items + new cursor in one call", () => {
		const hub = messagingHub("hub");
		const t = tracker<string>({ hub });
		t.add("a");
		t.add("b");
		t.add("c");

		const r = t.pullAndAck(2);
		expect(r.items).toEqual(["a", "b"]);
		expect(r.cursor).toBe(2);

		const r2 = t.pullAndAck();
		expect(r2.items).toEqual(["c"]);
		expect(r2.cursor).toBe(3);
		hub.destroy();
	});

	it("multiple trackers on the same hub topic get independent cursors", () => {
		const hub = messagingHub("hub");
		const a = tracker<number>({ hub, name: "tracker-a" });
		const b = tracker<number>({ hub, name: "tracker-b" });

		a.add(1);
		a.add(2);

		// Both see the same items (shared topic).
		expect(a.pending.cache as readonly number[]).toEqual([1, 2]);
		expect(b.pending.cache as readonly number[]).toEqual([1, 2]);

		// `a` acks its first; `b` is independent.
		a.ack(1);
		expect(a.pending.cache as readonly number[]).toEqual([2]);
		expect(b.pending.cache as readonly number[]).toEqual([1, 2]);

		hub.destroy();
	});

	it("custom topicName routes to the chosen topic", () => {
		const hub = messagingHub("hub");
		const t = tracker<string>({ hub, topicName: "custom-queue" });
		expect(t.topic).toBe(hub.topic("custom-queue"));
		t.add("x");
		expect(t.pending.cache as readonly string[]).toEqual(["x"]);
		hub.destroy();
	});

	it("from: 'now' starts cursor at the current topic length", () => {
		const hub = messagingHub("hub");
		// Pre-populate the topic before mounting the tracker.
		hub.topic<number>(DEFERRED_TOPIC).publish(99);

		const t = tracker<number>({ hub, from: "now" });
		// `now` cursor skips the pre-existing item; pending starts empty.
		expect(t.pending.cache as readonly number[]).toEqual([]);
		t.add(100);
		expect(t.pending.cache as readonly number[]).toEqual([100]);
		hub.destroy();
	});

	it("total tracks topic event count", () => {
		const hub = messagingHub("hub");
		const t = tracker<string>({ hub });
		expect(t.total.cache).toBe(0);
		t.add("a");
		t.add("b");
		expect(t.total.cache).toBe(2);
		hub.destroy();
	});
});
