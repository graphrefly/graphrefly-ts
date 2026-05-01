/**
 * Phase 13.M — Worked multi-agent example (design lock-test).
 *
 * Per `docs/implementation-plan.md` §13.M and
 * `archive/docs/SESSION-multi-agent-gap-analysis.md` §13 #9, this file demonstrates
 * a two-agent handoff topology using **only shipped primitives** —
 * `messagingHub`, `topic`, `topicBridge`, `agentLoop`, `valve`, `Graph.derived`,
 * `Graph.effect`, `Graph.state`, and `awaitSettled`.
 *
 * The point is NOT to ship a polished multi-agent API — that lands in
 * Phase 13.B–13.I. The point is to **lock the topology** under shipped primitives
 * BEFORE those new primitives are designed, so the friction surfaced here drives
 * the design of `Message<T>` (13.B), `selector` / `materialize` (13.C),
 * `valve` `abortInFlight` (13.E), `humanInput` / `tracker` (13.F),
 * `class AgentGraph` / `AgentBundle` / `agent()` (13.G–13.H), and
 * `spawnable()` (13.I).
 *
 * **Friction filed in `docs/optimizations.md` ("Phase 13 design-session inputs"):**
 * - `executor.run(...)` is imperatively invoked from a reactive subscribe
 *   handler. There is no reactive `bundle.in: NodeInput<TIn>` today — the
 *   `agentLoop` is kicked by Promise-bridge `run()`. This motivates 13.G's
 *   typed `AgentBundle.in`.
 * - Cost extraction reaches into `lastResponse.usage` shape directly. This
 *   motivates 13.G's `bundle.cost: Node<CostState>`.
 * - The spawn-topic + depth-valve recipe is hand-rolled. This motivates 13.I
 *   `spawnable()` wrapping `MessagingHubGraph` + presetRegistry + materialize +
 *   depth-cap valve + termination contract.
 * - `SpawnRequest` is an inline tuple (`{ presetId; payload; depth }`) with no
 *   `id` / `correlationId` / `expiresAt`. This motivates 13.B's standard
 *   `Message<T>` envelope.
 *
 * **Cross-graph `explain` (G6 / 13.K preview):** the final test asserts that
 * `parent.describe({ explain: { from, to } })` walks across the
 * `parent.mount("classifier", classifier)` boundary into the classifier's
 * internal `lastResponse` node. If this fails, file 13.K as a hard gap before
 * 13.G/H land — the static-face / dynamic-interior pitch depends on it.
 */

import { describe, expect, it } from "vitest";

import { batch, DATA } from "../../../../core/index.js";
import { valve } from "../../../../extra/operators.js";
import { Graph } from "../../../../graph/graph.js";
import { agentLoop, type LLMAdapter, type LLMResponse } from "../../../../patterns/ai/index.js";
import { messagingHub, topic } from "../../../../patterns/messaging/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Hand-rolled `Message<T>` shape (Phase 13.B preview). Inlined here as a local
 * type so the test runs on shipped surface only — when 13.B lands, this type
 * disappears and the spawn topic types as `TopicGraph<Message<SpawnPayload>>`.
 */
interface SpawnRequest {
	readonly id: string;
	readonly presetId: string;
	readonly payload: string;
	readonly depth: number;
	readonly correlationId?: string;
}

/** Sum input + output regular tokens out of an `LLMResponse`. */
function tokensOf(resp: LLMResponse | undefined): number {
	if (resp === undefined) return 0;
	const inTok = resp.usage?.input?.regular ?? 0;
	const outTok = resp.usage?.output?.regular ?? 0;
	return inTok + outTok;
}

/**
 * Build a synchronous `LLMAdapter` that returns a single scripted response
 * with a configurable usage payload. The `usage` field is populated so the
 * cost-bubble assertion has non-zero numbers.
 */
function adapterWithCost(content: string, tokens: number): LLMAdapter {
	const resp: LLMResponse = {
		content,
		finishReason: "end_turn",
		usage: {
			input: { regular: Math.floor(tokens / 2) },
			output: { regular: Math.ceil(tokens / 2) },
		},
	};
	return {
		provider: "mock-with-cost",
		invoke() {
			return resp;
		},
		async *stream() {
			yield { type: "token", delta: content };
			yield {
				type: "usage",
				usage: { input: { regular: tokens / 2 }, output: { regular: tokens / 2 } },
			};
			yield { type: "finish", reason: "stop" };
		},
	};
}

// ---------------------------------------------------------------------------
// 1. Handoff: classifier → executor via topicBridge
// ---------------------------------------------------------------------------

describe("multi-agent example (Phase 13.M lock-test)", () => {
	it("classifier → executor handoff via topicBridge", async () => {
		const parent = new Graph("parent");

		// Hub with two topics: intake (user request) + handoff (classifier → executor).
		const hub = messagingHub("hub");
		parent.mount("hub", hub);
		const intakeTopic = hub.topic<string>("intake");
		const handoffTopic = hub.topic<string>("handoff");

		// Two real `agentLoop` instances. classifier maps "issue text" → "route
		// label"; executor consumes the route label and produces a fix line.
		const classifier = agentLoop("classifier", {
			adapter: adapterWithCost("fix-bug-X", 20),
			systemPrompt: "Classifier: emit a short route label.",
		});
		const executor = agentLoop("executor", {
			adapter: adapterWithCost("fixed bug X", 40),
			systemPrompt: "Executor: act on the routed task.",
		});
		parent.mount("classifier", classifier);
		parent.mount("executor", executor);

		// --- Bridge 1: classifier.lastResponse → handoffTopic.publish.
		// FRICTION (filed in optimizations.md "Phase 13 design-session inputs" F4):
		// `topicBridge` connects two `TopicGraph<T>`s, but
		// `classifier.lastResponse` is a `Node<LLMResponse>` (post-F9-fix
		// SENTINEL form — no `null` placeholder). Without 13.G's `bundle.out:
		// Node<TOut>` typed as either a topic surface or a reactive emitter
		// `topicBridge` accepts as a Node source, we hand-roll a `subscribe`
		// that publishes the unwrapped content into the topic. Post-F9-fix
		// the bridge no longer needs an `if (resp == null) continue` guard —
		// the SENTINEL state guarantees no spurious push-on-subscribe DATA.
		const handoffPublishes: string[] = [];
		const subPublish = classifier.lastResponse.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] !== DATA) continue;
				const resp = m[1] as LLMResponse;
				handoffTopic.publish(resp.content);
				handoffPublishes.push(resp.content);
			}
		});

		// --- Bridge 2: handoffTopic.latest → executor.run(...) reactive kick.
		// agentLoop has no reactive `in: NodeInput<TIn>` (Phase 13.G will add
		// it as `bundle.in`); until then the kick is imperative via
		// `executor.run()`. F2 fix (2026-05-01) makes this safe under nested
		// drains — the previous version deadlocked because `latestMessages`
		// closure mirror lagged the actual `chat.messages.cache` when
		// promptInput fired inside another agent's drain. promptInput now
		// reads `chat.messages.cache` directly (sole-owner-reactive-reader
		// per Phase 12 D1 lock); see `optimizations.md` F2.
		const executorPromises: Promise<LLMResponse | null>[] = [];
		const handoffSub = handoffTopic.latest.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] !== DATA) continue;
				const item = m[1] as string;
				executorPromises.push(executor.run(item));
			}
		});

		try {
			// Kick the classifier with the user request.
			intakeTopic.publish("Please classify and act on issue: missing fn");
			const classified = await classifier.run("Please classify and act on issue: missing fn");
			expect(classified?.content).toBe("fix-bug-X");

			// The handoff fired reactively during classifier's drain, kicked
			// the executor inside the same drain (post-F2-fix), and the
			// executor's run Promise is now pending. Await it.
			expect(executorPromises.length).toBe(1);
			expect(handoffPublishes).toEqual(["fix-bug-X"]);
			expect(handoffTopic.retained()).toContain("fix-bug-X");
			const executed = await executorPromises[0]!;
			expect(executed?.content).toBe("fixed bug X");
		} finally {
			handoffSub();
			subPublish();
			parent.destroy();
		}
	});

	// -------------------------------------------------------------------------
	// 2. Cost-bubble: parent.derived aggregates costs across both agents
	// -------------------------------------------------------------------------

	it("cost bubbles to a parent.derived aggregator", async () => {
		const parent = new Graph("parent-cost");

		const classifier = agentLoop("classifier", {
			adapter: adapterWithCost("ok", 30),
			systemPrompt: "Classifier",
		});
		const executor = agentLoop("executor", {
			adapter: adapterWithCost("done", 50),
			systemPrompt: "Executor",
		});
		parent.mount("classifier", classifier);
		parent.mount("executor", executor);

		// FRICTION: extracting cost from `lastResponse.usage` couples the
		// aggregator to LLMResponse shape. Phase 13.G's `bundle.cost:
		// Node<CostState>` removes this — parent reads `bundle.cost` directly.
		const totalCost = parent.derived<number>(
			"totalCost",
			[classifier.lastResponse, executor.lastResponse],
			(batchData, ctx) => {
				const cBatch = batchData[0];
				const eBatch = batchData[1];
				// Post-F9-fix: lastResponse stays SENTINEL (`undefined`) until
				// the first real response. `tokensOf` handles `undefined` as
				// 0 tokens.
				const cResp =
					cBatch != null && cBatch.length > 0
						? (cBatch.at(-1) as LLMResponse)
						: (ctx.prevData[0] as LLMResponse | undefined);
				const eResp =
					eBatch != null && eBatch.length > 0
						? (eBatch.at(-1) as LLMResponse)
						: (ctx.prevData[1] as LLMResponse | undefined);
				return [tokensOf(cResp) + tokensOf(eResp)];
			},
			{ keepAlive: true },
		);

		await classifier.run("classify something");
		await executor.run("execute something");

		expect(totalCost.cache).toBe(80);
		parent.destroy();
	});

	// -------------------------------------------------------------------------
	// 3. Depth valve: spawn topic gated by depth counter cuts forced recursion
	// -------------------------------------------------------------------------

	it("depth-valve cuts spawn requests past the cap", () => {
		const parent = new Graph("parent-depth");

		const spawnTopic = topic<SpawnRequest>("spawns");
		parent.mount("spawns", spawnTopic);

		// Depth counter — the substrate for the depth-cap recipe (G5 reframe in
		// gap-analysis §11). In `spawnable()` (Phase 13.I) this is a `derived`
		// over the active-slot map's size; here we hand-emit it.
		const depth = parent.state<number>("depth", 0);
		const depthCap = 2;
		const depthOpen = parent.derived<boolean>(
			"depthOpen",
			[depth],
			(batchData, ctx) => {
				const b = batchData[0];
				const n = (b != null && b.length > 0 ? b.at(-1) : ctx.prevData[0]) as number;
				return [n < depthCap];
			},
			{ keepAlive: true },
		);

		// `valve(spawnTopic.latest, depthOpen)` — gate at value level. RESOLVED
		// when closed; forwards latest when open. We tap into the gated stream
		// to record what made it through.
		const gatedSpawns = valve(spawnTopic.latest, depthOpen);
		parent.add(gatedSpawns as import("../../../../core/node.js").Node<unknown>, {
			name: "gatedSpawns",
		});

		const gatedSeen: SpawnRequest[] = [];
		const sub = gatedSpawns.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) gatedSeen.push(m[1] as SpawnRequest);
		});

		try {
			// First two spawns at depth 0 / 1 — gate is open.
			depth.emit(0);
			spawnTopic.publish({ id: "s1", presetId: "child", payload: "task-1", depth: 0 });
			depth.emit(1);
			spawnTopic.publish({ id: "s2", presetId: "child", payload: "task-2", depth: 1 });
			// Third spawn at depth 2 — gate closes (2 < 2 is false), valve drops.
			depth.emit(2);
			spawnTopic.publish({ id: "s3", presetId: "child", payload: "task-3", depth: 2 });

			expect(gatedSeen.map((s) => s.id)).toEqual(["s1", "s2"]);
		} finally {
			sub();
			parent.destroy();
		}
	});

	// -------------------------------------------------------------------------
	// 4. Cross-graph explain (G6 / 13.K preview)
	// -------------------------------------------------------------------------

	it("parent.describe({ explain }) walks across the mount boundary", async () => {
		const parent = new Graph("parent-explain");

		const classifier = agentLoop("classifier", {
			adapter: adapterWithCost("label", 10),
			systemPrompt: "Classifier",
		});
		parent.mount("classifier", classifier);

		// Parent derived that depends on a child node — the simplest cross-graph
		// edge. If this `explain` walk loses the mount segment, file 13.K.
		// Post-F9-fix: lastResponse SENTINEL `undefined` until first response.
		parent.derived<string>(
			"costLabel",
			[classifier.lastResponse],
			(batchData, ctx) => {
				const b = batchData[0];
				const resp = (b != null && b.length > 0 ? b.at(-1) : ctx.prevData[0]) as
					| LLMResponse
					| undefined;
				if (resp === undefined) return [];
				return [`${resp.content}:${tokensOf(resp)}`];
			},
			{ keepAlive: true },
		);

		await classifier.run("classify");

		const chain = parent.describe({
			explain: { from: "classifier::lastResponse", to: "costLabel" },
		});
		expect(chain.found).toBe(true);
		// Steps walk parent.costLabel ← classifier::lastResponse — every step
		// must be a named, non-anonymous path so future debuggers can drill in.
		for (const step of chain.steps) {
			expect(step.path).not.toContain("<anonymous>");
			expect(step.path).not.toBe("");
		}

		parent.destroy();
	});

	// -------------------------------------------------------------------------
	// 5. SENTINEL guard (F9 fix landed) — `classifier.lastResponse` stays
	//    SENTINEL (no DATA emitted) until the first real response. Bridge
	//    subscribers see no spurious push-on-subscribe `null` and do NOT
	//    need a `if (resp == null) continue` guard. Pins the §1a "stay
	//    SENTINEL" invariant per `feedback_use_prevdata_for_sentinel`.
	// -------------------------------------------------------------------------

	it("lastResponse stays SENTINEL until first real response", () => {
		const parent = new Graph("parent-sentinel");

		const classifier = agentLoop("classifier", {
			adapter: adapterWithCost("label", 10),
			systemPrompt: "Classifier",
		});
		parent.mount("classifier", classifier);

		const dataPayloads: unknown[] = [];
		const sub = classifier.lastResponse.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) dataPayloads.push(m[1]);
			}
		});

		try {
			// Post-F9-fix: `lastResponse` has no `initial` — push-on-subscribe
			// delivers START + the cached value, but the cached value is
			// SENTINEL (`undefined`), so START is delivered with no DATA tuple.
			// Bridge subscribers can subscribe-then-no-op without a `null`
			// guard. Cache is `undefined` until the loop produces a response.
			expect(dataPayloads).toEqual([]);
			expect(classifier.lastResponse.cache).toBeUndefined();
		} finally {
			sub();
			parent.destroy();
		}
	});

	// -------------------------------------------------------------------------
	// 5a. Bridge regression — wiring agent A's lastResponse into agent B's
	//     in.emit must NOT kick agent B before A produces a real response.
	//     Pre-F9-fix, the eager `null` from A would flow through the bridge
	//     and trigger B's chat.append; post-fix the bridge stays quiet.
	// -------------------------------------------------------------------------

	it("bridge subscriber does not kick agent B before agent A emits", () => {
		const parent = new Graph("parent-bridge");

		// Agent A: synchronous adapter that emits one response.
		const agentA = agentLoop("agentA", {
			adapter: adapterWithCost("from-A", 10),
			systemPrompt: "A",
		});
		// Agent B: also a real agentLoop so we can observe its chat-history.
		const agentB = agentLoop("agentB", {
			adapter: adapterWithCost("from-B", 10),
			systemPrompt: "B",
		});
		parent.mount("agentA", agentA);
		parent.mount("agentB", agentB);

		// Bridge: A's lastResponse → B's chat.append (and we'd kick B's run).
		// The body has NO `if (resp == null)` guard — relies on the SENTINEL
		// invariant: no DATA arrives until A produces a real response.
		const bWasKicked: string[] = [];
		const subBridge = agentA.lastResponse.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] !== DATA) continue;
				const resp = m[1] as LLMResponse;
				bWasKicked.push(resp.content);
				agentB.chat.append("user", resp.content);
			}
		});

		try {
			// A has not been kicked yet. Bridge must not have fired.
			expect(bWasKicked).toEqual([]);
			expect(agentB.chat.allMessages()).toEqual([]);
		} finally {
			subBridge();
			parent.destroy();
		}
	});

	// -------------------------------------------------------------------------
	// 6. SpawnRequest envelope (Phase 13.B preview) — confirm hand-rolled shape
	//    is compatible with `topic<T>` round-tripping. When 13.B's `Message<T>`
	//    lands, this test rewires to the standard envelope without changing the
	//    topology.
	// -------------------------------------------------------------------------

	it("spawn topic round-trips a Message-shaped envelope", () => {
		const parent = new Graph("parent-envelope");
		const spawnTopic = topic<SpawnRequest>("spawns");
		parent.mount("spawns", spawnTopic);

		const seen: SpawnRequest[] = [];
		const sub = spawnTopic.events.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					for (const v of m[1] as readonly SpawnRequest[]) seen.push(v);
				}
			}
		});

		try {
			batch(() => {
				spawnTopic.publish({
					id: "req-1",
					presetId: "researcher",
					payload: "Find prior incidents",
					depth: 0,
					correlationId: "user-session-42",
				});
			});

			expect(seen).toHaveLength(1);
			expect(seen[0]?.correlationId).toBe("user-session-42");
		} finally {
			sub();
			parent.destroy();
		}
	});
});
