/**
 * Stress tests for pubsub — Wave 4 audit + new APIs.
 *
 * Covers: lazy creation, publish-creates, multi-subscriber, push-on-subscribe,
 * TEARDOWN propagation, republish-after-remove, has/size/topicNames,
 * publishMany semantics, pluggable backend, version counter.
 */

import { DATA, TEARDOWN } from "@graphrefly/pure-ts/core";
import { describe, expect, it } from "vitest";
import {
	NativePubSubBackend,
	type PubSubBackend,
	pubsub,
} from "../../../base/composition/pubsub.js";
import { collect } from "../test-helpers.js";

describe("pubsub stress tests", () => {
	// ── Scenario 1: Lazy topic creation ─────────────────────────────────
	it("S1: topic(name) creates on first call; second call returns same node", () => {
		const hub = pubsub();
		const t1 = hub.topic("x");
		const t2 = hub.topic("x");
		expect(t1).toBe(t2);
	});

	// ── Scenario 2: publish(name) auto-creates + delivers ───────────────
	it("S2: publish to non-existent topic creates it + delivers", () => {
		const hub = pubsub();
		hub.publish("y", 42);

		expect(hub.has("y")).toBe(true);
		const { messages, unsub } = collect(hub.topic("y"), { flat: true });
		const firstData = messages.find((m) => m[0] === DATA);
		expect(firstData![1]).toBe(42);
		unsub();
	});

	// ── Scenario 3: Multiple subscribers receive the same DATA ──────────
	it("S3: multiple subscribers all receive published DATA", () => {
		const hub = pubsub();
		const t = hub.topic("broadcast");

		const seen1: unknown[] = [];
		const seen2: unknown[] = [];
		const u1 = t.subscribe((msgs) => {
			for (const m of msgs as [symbol, unknown][]) {
				if (m[0] === DATA) seen1.push(m[1]);
			}
		});
		const u2 = t.subscribe((msgs) => {
			for (const m of msgs as [symbol, unknown][]) {
				if (m[0] === DATA) seen2.push(m[1]);
			}
		});

		hub.publish("broadcast", "hello");
		hub.publish("broadcast", "world");

		u1();
		u2();

		// Sentinel topic: no push-on-subscribe before first publish. Both subs
		// joined before any publish, so they see only subsequent DATA.
		expect(seen1).toEqual(["hello", "world"]);
		expect(seen2).toEqual(["hello", "world"]);
	});

	// ── Scenario 4: Push-on-subscribe delivers cached last value ────────
	it("S4: subscriber joining after publish receives cached last value", () => {
		const hub = pubsub();
		hub.publish("status", "ready");
		hub.publish("status", "running");

		// New subscriber joins after 2 publishes; gets only the latest
		const { messages, unsub } = collect(hub.topic("status"), { flat: true });
		const firstData = messages.find((m) => m[0] === DATA);
		expect(firstData![1]).toBe("running");
		unsub();
	});

	// ── Scenario 5: removeTopic sends TEARDOWN ──────────────────────────
	it("S5: removeTopic propagates TEARDOWN to subscribers", () => {
		const hub = pubsub();
		hub.publish("bye", 1);

		const seen: symbol[] = [];
		const unsub = hub.topic("bye").subscribe((msgs) => {
			for (const m of msgs as [symbol, unknown][]) seen.push(m[0]);
		});

		const removed = hub.removeTopic("bye");
		expect(removed).toBe(true);

		unsub();

		// Expect TEARDOWN received by subscriber
		expect(seen).toContain(TEARDOWN);
		// And topic is gone from the hub
		expect(hub.has("bye")).toBe(false);
	});

	// ── Scenario 6: Republish after remove silently recreates ───────────
	it("S6: publish to a removed topic silently recreates (fresh node)", () => {
		const hub = pubsub();
		hub.publish("recycle", "first");
		const oldNode = hub.topic("recycle");

		hub.removeTopic("recycle");
		expect(hub.has("recycle")).toBe(false);

		hub.publish("recycle", "second");
		expect(hub.has("recycle")).toBe(true);

		const newNode = hub.topic("recycle");
		// Fresh instance — old subscribers do NOT reconnect
		expect(newNode).not.toBe(oldNode);

		// New subscriber gets "second"
		const { messages, unsub } = collect(newNode, { flat: true });
		const firstData = messages.find((m) => m[0] === DATA);
		expect(firstData![1]).toBe("second");
		unsub();
	});

	// ── Scenario 7: has(name) does not create ───────────────────────────
	it("S7: has(name) does not create the topic", () => {
		const hub = pubsub();
		expect(hub.has("never-created")).toBe(false);
		expect(hub.size).toBe(0);

		hub.has("check-1");
		hub.has("check-2");
		expect(hub.size).toBe(0); // still empty
	});

	// ── Scenario 8: size counts topics ──────────────────────────────────
	it("S8: size reflects topic count after creates / removes", () => {
		const hub = pubsub();
		expect(hub.size).toBe(0);

		hub.topic("a");
		hub.publish("b", 1);
		hub.topic("c");
		expect(hub.size).toBe(3);

		hub.removeTopic("b");
		expect(hub.size).toBe(2);

		hub.removeTopic("missing"); // no-op
		expect(hub.size).toBe(2);
	});

	// ── Scenario 9: topicNames() enumeration ────────────────────────────
	it("S9: topicNames() iterates over registered topics", () => {
		const hub = pubsub();
		hub.publish("x", 1);
		hub.publish("y", 2);
		hub.topic("z");

		const names = [...hub.topicNames()];
		expect(names.sort()).toEqual(["x", "y", "z"]);

		hub.removeTopic("y");
		const after = [...hub.topicNames()];
		expect(after.sort()).toEqual(["x", "z"]);
	});

	// ── Scenario 10: publishMany delivers to multiple topics in one batch ─
	it("S10: publishMany delivers DATA to each topic", () => {
		const hub = pubsub();

		const seenX: unknown[] = [];
		const seenY: unknown[] = [];
		const ux = hub.topic("x").subscribe((msgs) => {
			for (const m of msgs as [symbol, unknown][]) if (m[0] === DATA) seenX.push(m[1]);
		});
		const uy = hub.topic("y").subscribe((msgs) => {
			for (const m of msgs as [symbol, unknown][]) if (m[0] === DATA) seenY.push(m[1]);
		});

		hub.publishMany([
			["x", 1],
			["y", 2],
			["x", 10],
		]);

		ux();
		uy();

		// Sentinel topics: no push-on-subscribe before first publish. Subs
		// attached before publishMany, so they see only the published values.
		expect(seenX).toEqual([1, 10]);
		expect(seenY).toEqual([2]);
	});

	// ── Scenario 11: publishMany empty is no-op ─────────────────────────
	it("S11: publishMany([]) emits nothing", () => {
		const hub = pubsub();
		const { messages, unsub } = collect(hub.topic("x"), { flat: true });
		const beforeLen = messages.length;

		hub.publishMany([]);

		expect(messages.length).toBe(beforeLen);
		unsub();
	});

	// ── Scenario 12: publishMany auto-creates topics on the fly ─────────
	it("S12: publishMany creates topics that don't exist", () => {
		const hub = pubsub();
		hub.publishMany([
			["new1", "a"],
			["new2", "b"],
		]);

		expect(hub.has("new1")).toBe(true);
		expect(hub.has("new2")).toBe(true);
		expect(hub.size).toBe(2);
	});

	// ── Scenario 13: Publish undefined is valid ─────────────────────────
	it("S13: publish(name, undefined) is valid", () => {
		const hub = pubsub();
		hub.publish("u", undefined);

		const { unsub } = collect(hub.topic("u"), { flat: true });
		// Topic is a sentinel node; publishing undefined may coalesce to RESOLVED
		// via default equality. Either way, subscriber sees state and topic exists.
		expect(hub.has("u")).toBe(true);
		unsub();
	});

	// ── Scenario 14: removeTopic on non-existent returns false ──────────
	it("S14: removeTopic(missing) returns false, no-op", () => {
		const hub = pubsub();
		expect(hub.removeTopic("never")).toBe(false);
		expect(hub.size).toBe(0);
	});

	// ── Scenario 15: removeTopic inside batch — TEARDOWN deferred appropriately ─
	it("S15: TEARDOWN from removeTopic (tier 5) delivers after phase-2 in same batch scope", () => {
		const hub = pubsub();
		hub.publish("x", "initial");

		const received: symbol[] = [];
		const unsub = hub.topic("x").subscribe((msgs) => {
			for (const m of msgs as [symbol, unknown][]) received.push(m[0]);
		});

		// clear state from push-on-subscribe
		received.length = 0;

		// removeTopic is called outside any batch; TEARDOWN delivers immediately.
		hub.removeTopic("x");
		expect(received).toContain(TEARDOWN);

		unsub();
	});
});

// ── Native backend direct tests ────────────────────────────────────────

describe("NativePubSubBackend", () => {
	it("version counter advances on create / remove only", () => {
		const b = new NativePubSubBackend();
		expect(b.version).toBe(0);

		expect(b.createTopic("a")).toBe(true);
		expect(b.version).toBe(1);

		expect(b.createTopic("a")).toBe(false); // already exists
		expect(b.version).toBe(1);

		expect(b.createTopic("b")).toBe(true);
		expect(b.version).toBe(2);

		expect(b.removeTopic("a")).toBe(true);
		expect(b.version).toBe(3);

		expect(b.removeTopic("a")).toBe(false); // no longer exists
		expect(b.version).toBe(3);
	});

	it("hasTopic / topicCount / topicNames reflect state", () => {
		const b = new NativePubSubBackend();
		b.createTopic("x");
		b.createTopic("y");

		expect(b.hasTopic("x")).toBe(true);
		expect(b.hasTopic("missing")).toBe(false);
		expect(b.topicCount).toBe(2);
		expect([...b.topicNames()].sort()).toEqual(["x", "y"]);
	});
});

// ── Pluggable backend ──────────────────────────────────────────────────

describe("pubsub with user-provided backend", () => {
	it("can plug in a custom backend implementation", () => {
		class AuditBackend implements PubSubBackend {
			private readonly inner = new NativePubSubBackend();
			createLog: string[] = [];
			removeLog: string[] = [];

			get version(): number {
				return this.inner.version;
			}
			get topicCount(): number {
				return this.inner.topicCount;
			}
			hasTopic(name: string): boolean {
				return this.inner.hasTopic(name);
			}
			topicNames(): IterableIterator<string> {
				return this.inner.topicNames();
			}
			createTopic(name: string): boolean {
				const created = this.inner.createTopic(name);
				if (created) this.createLog.push(name);
				return created;
			}
			removeTopic(name: string): boolean {
				const removed = this.inner.removeTopic(name);
				if (removed) this.removeLog.push(name);
				return removed;
			}
		}

		const backend = new AuditBackend();
		const hub = pubsub({ backend });

		hub.publish("a", 1);
		hub.publish("b", 2);
		hub.publish("a", 11); // re-publish, no topic create
		hub.removeTopic("a");
		hub.removeTopic("missing");

		expect(backend.createLog).toEqual(["a", "b"]);
		expect(backend.removeLog).toEqual(["a"]);
	});
});

describe("pubsub DS14R2 — mutationLog", () => {
	type AnyPubSubChange = {
		structure: string;
		lifecycle: string;
		change:
			| { kind: "publish"; value: unknown }
			| { kind: "remove"; name: string }
			| { kind: "ack"; count: number; cursor: number };
	};
	function lastLog(node: Parameters<typeof collect>[0]): AnyPubSubChange[] {
		const { messages, unsub } = collect(node, { flat: true });
		unsub();
		let out: AnyPubSubChange[] = [];
		for (const m of messages) if (m[0] === DATA) out = m[1] as AnyPubSubChange[];
		return out;
	}

	it("absent by default; present when configured", () => {
		expect(pubsub().mutationLog).toBeUndefined();
		expect(pubsub({ mutationLog: true }).mutationLog).toBeDefined();
	});

	it("publish / publishMany / removeTopic append typed records", () => {
		const hub = pubsub({ mutationLog: true });
		hub.publish("a", 1);
		hub.publishMany([
			["a", 2],
			["b", 3],
		]);
		hub.removeTopic("a");
		const log = lastLog(hub.mutationLog!.entries);
		expect(log.map((c) => c.change.kind)).toEqual(["publish", "publish", "publish", "remove"]);
		expect(log.every((c) => c.structure === "pubsub" && c.lifecycle === "data")).toBe(true);
		const rem = log.find((c) => c.change.kind === "remove");
		expect(rem?.change).toMatchObject({ kind: "remove", name: "a" });
	});

	it("same-wave: a topic subscriber and a mutationLog subscriber see consistent state", () => {
		const hub = pubsub({ mutationLog: true });
		const topicSeen: unknown[] = [];
		const unsubT = hub.topic("t").subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) topicSeen.push(m[1]);
		});
		hub.publish("t", 42);
		const log = lastLog(hub.mutationLog!.entries);
		expect(topicSeen).toContain(42);
		expect(log.at(-1)?.change).toMatchObject({ kind: "publish", value: 42 });
		unsubT();
	});
});
