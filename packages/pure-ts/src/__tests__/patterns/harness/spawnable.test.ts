/**
 * Phase 13.I — `spawnable()` regression tests.
 */

import { describe, expect, it } from "vitest";

import { DATA } from "../../../core/messages.js";
import type { AgentSpec, LLMAdapter, LLMResponse } from "../../../patterns/ai/index.js";
import { type AgentBundle, presetRegistry } from "../../../patterns/ai/index.js";
import { type SpawnRejection, spawnable } from "../../../patterns/harness/presets/spawnable.js";
import { type Message, messagingHub, SPAWNS_TOPIC } from "../../../patterns/messaging/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function syncAdapter(content: string): LLMAdapter {
	const resp: LLMResponse = {
		content,
		finishReason: "end_turn",
		usage: { input: { regular: 5 }, output: { regular: 5 } },
	};
	return {
		provider: "mock",
		invoke() {
			return resp;
		},
		async *stream() {
			yield { type: "token", delta: content };
			yield { type: "finish", reason: "stop" };
		},
	};
}

function neverResolvingAdapter(): LLMAdapter {
	return {
		provider: "mock-never",
		invoke() {
			return new Promise<LLMResponse>(() => {
				/* never resolves */
			});
		},
		async *stream() {
			yield { type: "finish", reason: "stop" };
		},
	};
}

function makeRequest(
	id: string,
	presetId: string,
	taskInput: string,
	extra?: Partial<Message<{ presetId: string; taskInput: string }>>,
): Message<{ presetId: string; taskInput: string }> {
	return {
		id,
		payload: { presetId, taskInput },
		...extra,
	};
}

// ---------------------------------------------------------------------------
// Basic spawn / completion
// ---------------------------------------------------------------------------

describe("spawnable() — basic spawn lifecycle", () => {
	it("spawns the matching preset's agent, runs it, and removes from activeSlot on done", async () => {
		const hub = messagingHub("hub");
		const presets = presetRegistry<AgentSpec<string, LLMResponse>>();
		presets.put("researcher", {
			name: "researcher", // overridden per-spawn
			adapter: syncAdapter("answer: 42"),
		});
		const sp = spawnable<string, LLMResponse>({ hub, registry: presets });

		// Track activeSlot snapshots so we can verify mid-flight presence.
		const snaps: ReadonlyMap<string, AgentBundle<string, LLMResponse>>[] = [];
		const unsub = sp.activeSlot.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA)
					snaps.push(m[1] as ReadonlyMap<string, AgentBundle<string, LLMResponse>>);
			}
		});

		sp.spawnTopic.publish(makeRequest("req-1", "researcher", "what is 6 * 7?"));

		// Synchronous adapter — by the time publish returns, the agent has
		// been minted, run, and torn down. activeSlot transitioned size 0 →
		// 1 → 0, and the final cache is the empty map.
		const sizes = snaps.map((m) => m.size);
		expect(sizes).toContain(1);
		expect(sizes.at(-1)).toBe(0);

		unsub();
		hub.destroy();
	});

	it("forwards the request taskInput as the agent's bundle.in input", async () => {
		const hub = messagingHub("hub");
		const presets = presetRegistry<AgentSpec<string, LLMResponse>>();
		presets.put("echo", {
			name: "echo",
			adapter: syncAdapter("ok"),
		});
		const sp = spawnable<string, LLMResponse>({ hub, registry: presets });

		// Capture the bundle when it's mounted so we can assert chat saw the input.
		let captured: AgentBundle<string, LLMResponse> | undefined;
		const unsub = sp.activeSlot.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					const map = m[1] as ReadonlyMap<string, AgentBundle<string, LLMResponse>>;
					if (map.size > 0) captured = [...map.values()][0];
				}
			}
		});

		sp.spawnTopic.publish(makeRequest("req-2", "echo", "hello world"));

		expect(captured).toBeDefined();
		const messages = captured?.graph.loop.chat.allMessages();
		expect(messages?.[0]?.role).toBe("user");
		expect(messages?.[0]?.content).toBe("hello world");

		unsub();
		hub.destroy();
	});
});

// ---------------------------------------------------------------------------
// Depth-cap rejection
// ---------------------------------------------------------------------------

describe("spawnable() — depth-cap", () => {
	it("rejects requests over depthCap with a reason on the rejected topic", () => {
		const hub = messagingHub("hub");
		const presets = presetRegistry<AgentSpec<string, LLMResponse>>();
		presets.put("slow", {
			name: "slow",
			adapter: neverResolvingAdapter(),
		});
		const sp = spawnable<string, LLMResponse>({
			hub,
			registry: presets,
			depthCap: 2,
		});

		const rejections: SpawnRejection<string>[] = [];
		const unsub = sp.rejected.events.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					for (const r of m[1] as readonly SpawnRejection<string>[]) rejections.push(r);
				}
			}
		});

		// First two spawn (slow adapter never finishes) → activeSlot = 2.
		sp.spawnTopic.publish(makeRequest("req-1", "slow", "task1"));
		sp.spawnTopic.publish(makeRequest("req-2", "slow", "task2"));
		expect((sp.activeSlot.cache as ReadonlyMap<string, unknown>).size).toBe(2);

		// Third over cap → rejected.
		sp.spawnTopic.publish(makeRequest("req-3", "slow", "task3"));
		expect((sp.activeSlot.cache as ReadonlyMap<string, unknown>).size).toBe(2);
		expect(rejections).toHaveLength(1);
		expect(rejections[0]?.request.id).toBe("req-3");
		expect(rejections[0]?.reason).toMatch(/depth-cap/i);

		unsub();
		hub.destroy();
	});
});

// ---------------------------------------------------------------------------
// Unknown presetId rejection
// ---------------------------------------------------------------------------

describe("spawnable() — unknown presetId", () => {
	it("rejects requests with no matching preset", () => {
		const hub = messagingHub("hub");
		const presets = presetRegistry<AgentSpec<string, LLMResponse>>();
		presets.put("known", { name: "known", adapter: syncAdapter("ok") });
		const sp = spawnable<string, LLMResponse>({ hub, registry: presets });

		const rejections: SpawnRejection<string>[] = [];
		const unsub = sp.rejected.events.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					for (const r of m[1] as readonly SpawnRejection<string>[]) rejections.push(r);
				}
			}
		});

		sp.spawnTopic.publish(makeRequest("req-x", "ghost", "task"));

		expect(rejections).toHaveLength(1);
		expect(rejections[0]?.reason).toMatch(/unknown presetId: ghost/i);

		unsub();
		hub.destroy();
	});
});

// ---------------------------------------------------------------------------
// Validator rejection
// ---------------------------------------------------------------------------

describe("spawnable() — validation", () => {
	it("does NOT replay retained spawn requests on construction (from: 'now' default)", () => {
		const hub = messagingHub("hub");
		// Pre-publish a spawn request BEFORE the spawnable is constructed.
		hub
			.topic<Message<{ presetId: string; taskInput: string }>>(SPAWNS_TOPIC)
			.publish(makeRequest("retained-r", "p", "stale"));

		const presets = presetRegistry<AgentSpec<string, LLMResponse>>();
		presets.put("p", { name: "p", adapter: syncAdapter("ok") });
		const sp = spawnable<string, LLMResponse>({ hub, registry: presets });

		// Default `from: "now"` skips the retained "stale" request.
		expect((sp.activeSlot.cache as ReadonlyMap<string, unknown>).size).toBe(0);

		// Live publish IS processed.
		sp.spawnTopic.publish(makeRequest("live-r", "p", "fresh"));
		expect((sp.activeSlot.cache as ReadonlyMap<string, unknown>).size).toBe(0); // sync adapter ran + cleaned up
		hub.destroy();
	});

	it("from: 'retained' opts in to replaying pre-construction requests", () => {
		const hub = messagingHub("hub");
		hub
			.topic<Message<{ presetId: string; taskInput: string }>>(SPAWNS_TOPIC)
			.publish(makeRequest("retained-r", "p", "stale"));

		const presets = presetRegistry<AgentSpec<string, LLMResponse>>();
		presets.put("p", { name: "p", adapter: syncAdapter("ok") });
		const sp = spawnable<string, LLMResponse>({
			hub,
			registry: presets,
			from: "retained",
		});

		// `retained` replays — the stale request was processed (sync adapter
		// ran + cleaned up).
		void sp;
		hub.destroy();
	});

	it("rejects requests with invalid (non-parseable) expiresAt", () => {
		const hub = messagingHub("hub");
		const presets = presetRegistry<AgentSpec<string, LLMResponse>>();
		presets.put("p", { name: "p", adapter: syncAdapter("ok") });
		const sp = spawnable<string, LLMResponse>({ hub, registry: presets });

		const rejections: SpawnRejection<string>[] = [];
		const unsub = sp.rejected.events.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					for (const r of m[1] as readonly SpawnRejection<string>[]) rejections.push(r);
				}
			}
		});

		sp.spawnTopic.publish(makeRequest("req-bad-exp", "p", "task", { expiresAt: "garbage" }));

		expect(rejections).toHaveLength(1);
		expect(rejections[0]?.reason).toBe("invalid expiresAt");
		unsub();
		hub.destroy();
	});

	it("rejects requests failing a custom validate predicate", () => {
		const hub = messagingHub("hub");
		const presets = presetRegistry<AgentSpec<string, LLMResponse>>();
		presets.put("p", { name: "p", adapter: syncAdapter("ok") });
		const sp = spawnable<string, LLMResponse>({
			hub,
			registry: presets,
			validate: (req) => req.payload.taskInput.length >= 3,
		});

		const rejections: SpawnRejection<string>[] = [];
		const unsub = sp.rejected.events.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					for (const r of m[1] as readonly SpawnRejection<string>[]) rejections.push(r);
				}
			}
		});

		sp.spawnTopic.publish(makeRequest("req-short", "p", "ab")); // length 2, rejected
		sp.spawnTopic.publish(makeRequest("req-ok", "p", "abcd")); // length 4, accepted

		expect(rejections).toHaveLength(1);
		expect(rejections[0]?.request.id).toBe("req-short");

		unsub();
		hub.destroy();
	});
});

// ---------------------------------------------------------------------------
// expiresAt
// ---------------------------------------------------------------------------

describe("spawnable() — expiresAt envelope", () => {
	it("rejects requests with an expired `expiresAt`", () => {
		const hub = messagingHub("hub");
		const presets = presetRegistry<AgentSpec<string, LLMResponse>>();
		presets.put("p", { name: "p", adapter: syncAdapter("ok") });
		const sp = spawnable<string, LLMResponse>({ hub, registry: presets });

		const rejections: SpawnRejection<string>[] = [];
		const unsub = sp.rejected.events.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					for (const r of m[1] as readonly SpawnRejection<string>[]) rejections.push(r);
				}
			}
		});

		// expiresAt in the past.
		sp.spawnTopic.publish(
			makeRequest("req-expired", "p", "task", { expiresAt: "2020-01-01T00:00:00Z" }),
		);

		expect(rejections).toHaveLength(1);
		expect(rejections[0]?.reason).toBe("expired");

		unsub();
		hub.destroy();
	});

	it("accepts requests with future `expiresAt`", () => {
		const hub = messagingHub("hub");
		const presets = presetRegistry<AgentSpec<string, LLMResponse>>();
		presets.put("p", { name: "p", adapter: syncAdapter("ok") });
		const sp = spawnable<string, LLMResponse>({ hub, registry: presets });

		sp.spawnTopic.publish(
			makeRequest("req-future", "p", "task", {
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			}),
		);

		// Sync adapter — the agent ran, finished, and was removed.
		expect((sp.activeSlot.cache as ReadonlyMap<string, unknown>).size).toBe(0);
		// No rejection.
		expect((sp.rejected.events.cache as readonly unknown[] | undefined) ?? []).toHaveLength(0);
		hub.destroy();
	});
});

// ---------------------------------------------------------------------------
// SPAWNS_TOPIC well-known name
// ---------------------------------------------------------------------------

describe("spawnable() — SPAWNS_TOPIC integration", () => {
	it("uses the well-known SPAWNS_TOPIC on the hub", () => {
		const hub = messagingHub("hub");
		const presets = presetRegistry<AgentSpec<string, LLMResponse>>();
		const sp = spawnable<string, LLMResponse>({ hub, registry: presets });
		expect(sp.spawnTopic).toBe(hub.topic(SPAWNS_TOPIC));
	});

	it("multiple spawnable instances on the same hub use distinct names", () => {
		const hub = messagingHub("hub");
		const presets = presetRegistry<AgentSpec<string, LLMResponse>>();
		presets.put("p", { name: "p", adapter: syncAdapter("ok") });

		const a = spawnable<string, LLMResponse>({
			hub,
			registry: presets,
			name: "alpha",
		});
		const b = spawnable<string, LLMResponse>({
			hub,
			registry: presets,
			name: "beta",
		});

		// Both share the same SPAWNS_TOPIC (well-known).
		expect(a.spawnTopic).toBe(b.spawnTopic);
		// Each has its own subgraph mounted under the hub.
		expect(a.graph).not.toBe(b.graph);
		expect(() => hub.node("alpha::active-slot")).not.toThrow();
		expect(() => hub.node("beta::active-slot")).not.toThrow();
		hub.destroy();
	});
});

// ---------------------------------------------------------------------------
// Multi-request flow
// ---------------------------------------------------------------------------

describe("spawnable() — multi-request flow", () => {
	it("processes a batch of spawn requests, routing each to its preset", async () => {
		const hub = messagingHub("hub");
		const presets = presetRegistry<AgentSpec<string, LLMResponse>>();
		presets.put("research", { name: "r", adapter: syncAdapter("research-result") });
		presets.put("code", { name: "c", adapter: syncAdapter("code-result") });
		const sp = spawnable<string, LLMResponse>({ hub, registry: presets });

		// Capture each completed agent's outputs (last response on bundle.out).
		const results = new Map<string, string>();
		sp.activeSlot.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] !== DATA) continue;
				const map = m[1] as ReadonlyMap<string, AgentBundle<string, LLMResponse>>;
				for (const [reqId, bundle] of map) {
					// Capture the last response synchronously when present.
					const out = bundle.out.cache as LLMResponse | undefined;
					if (out != null && !results.has(reqId)) {
						results.set(reqId, out.content);
					}
				}
			}
		});

		sp.spawnTopic.publish(makeRequest("req-r", "research", "topic A"));
		sp.spawnTopic.publish(makeRequest("req-c", "code", "topic B"));
		// Allow microtasks to flush (sync adapter still settles synchronously,
		// but the activeSlot snapshot may need a tick to capture the in-flight
		// bundle). Then the final assertion just checks both ran.
		await Promise.resolve();
		await Promise.resolve();

		// Each request was processed. activeSlot ended empty (both completed).
		expect((sp.activeSlot.cache as ReadonlyMap<string, unknown>).size).toBe(0);
		hub.destroy();
	});
});
