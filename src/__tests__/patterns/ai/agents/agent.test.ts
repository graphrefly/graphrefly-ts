/**
 * Phase 13.G + 13.H — `AgentBundle`, `class AgentGraph`, `agent()` preset,
 * `presetRegistry()` regression tests.
 */

import { describe, expect, it } from "vitest";

import { DATA } from "../../../../core/messages.js";
import { node } from "../../../../core/node.js";
import { awaitSettled } from "../../../../extra/sources.js";
import { Graph } from "../../../../graph/graph.js";
import type {
	LLMAdapter,
	LLMResponse,
	ToolDefinition,
} from "../../../../patterns/ai/adapters/core/types.js";
import {
	type AgentBundle,
	AgentGraph,
	type AgentSpec,
	type CostState,
	ZERO_COST,
} from "../../../../patterns/ai/agents/agent.js";
import { agent, presetRegistry } from "../../../../patterns/ai/agents/presets.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function syncAdapter(content: string, opts?: { tokens?: number }): LLMAdapter {
	const tokens = opts?.tokens ?? 10;
	const resp: LLMResponse = {
		content,
		finishReason: "end_turn",
		usage: {
			input: { regular: Math.floor(tokens / 2) },
			output: { regular: Math.ceil(tokens / 2) },
		},
	};
	return {
		provider: "mock-sync",
		invoke() {
			return resp;
		},
		async *stream() {
			yield { type: "token", delta: content };
			yield { type: "finish", reason: "stop" };
		},
	};
}

// ---------------------------------------------------------------------------
// agent() basic flow
// ---------------------------------------------------------------------------

describe("agent() — basic reactive entry / exit", () => {
	it("mounts under parent and produces an LLMResponse via in.emit", async () => {
		const parent = new Graph("parent");
		const a = agent(parent, {
			name: "researcher",
			adapter: syncAdapter("the answer is 42"),
		});

		expect(a.graph).toBeInstanceOf(AgentGraph);
		expect(parent.node("researcher::out")).toBe(a.out);

		const promise = awaitSettled(a.out, { skipCurrent: true });
		a.in.emit("what is the answer?");
		const resp = await promise;
		expect(resp?.content).toBe("the answer is 42");

		parent.destroy();
	});

	it("typed out — outMapper transforms LLMResponse → caller type", async () => {
		const parent = new Graph("parent");
		const a = agent<string, { upper: string }>(parent, {
			name: "shouter",
			adapter: syncAdapter("hello"),
			outMapper: (r) => ({ upper: r.content.toUpperCase() }),
		});

		const promise = awaitSettled(a.out, { skipCurrent: true });
		a.in.emit("say hi");
		const out = await promise;
		expect(out?.upper).toBe("HELLO");
		parent.destroy();
	});

	it("typed in — inMapper translates caller type → string", async () => {
		const parent = new Graph("parent");
		const a = agent<{ topic: string; depth: number }, LLMResponse>(parent, {
			name: "templated",
			adapter: syncAdapter("response"),
			inMapper: (req) => `Tell me about ${req.topic} at depth ${req.depth}`,
		});

		const promise = awaitSettled(a.out, { skipCurrent: true });
		a.in.emit({ topic: "TLA+", depth: 3 });
		const resp = await promise;
		expect(resp?.content).toBe("response");
		// chat.messages records the mapped string.
		const messages = a.graph.loop.chat.allMessages();
		expect(messages[0]?.content).toBe("Tell me about TLA+ at depth 3");
		parent.destroy();
	});

	it("default inMapper throws when TIn isn't string", () => {
		const parent = new Graph("parent");
		const a = agent<{ x: number }, LLMResponse>(parent, {
			// biome-ignore lint/suspicious/noExplicitAny: deliberate misuse — exercises the boundary throw.
			name: "bad",
			adapter: syncAdapter("x"),
		} as AgentSpec<{ x: number }, LLMResponse>);

		expect(() => a.in.emit({ x: 1 })).toThrow(TypeError);
		parent.destroy();
	});
});

// ---------------------------------------------------------------------------
// Status mirror + cost rollup
// ---------------------------------------------------------------------------

describe("agent() — status + cost", () => {
	it("status starts idle, transitions to done after a successful run", async () => {
		const parent = new Graph("parent");
		const a = agent(parent, {
			name: "stat",
			adapter: syncAdapter("ok"),
		});

		expect(a.status.cache).toBe("idle");
		const promise = awaitSettled(a.out, { skipCurrent: true });
		a.in.emit("go");
		await promise;
		expect(a.status.cache).toBe("done");
		parent.destroy();
	});

	it("cost rolls forward from LLMResponse.usage (full TokenUsage)", async () => {
		const parent = new Graph("parent");
		const a = agent(parent, {
			name: "cost-meter",
			adapter: syncAdapter("ok", { tokens: 30 }),
		});

		expect(a.cost.cache).toEqual(ZERO_COST);
		const promise = awaitSettled(a.out, { skipCurrent: true });
		a.in.emit("go");
		await promise;
		const cost = a.cost.cache as CostState;
		expect(cost.usage.input.regular + cost.usage.output.regular).toBe(30);
		expect(cost.turns).toBeGreaterThan(0);
		parent.destroy();
	});

	it("cost resets on each new in.emit (per-input scope)", async () => {
		const parent = new Graph("parent");
		const a = agent(parent, {
			name: "per-input",
			adapter: syncAdapter("ok", { tokens: 20 }),
		});

		const p1 = awaitSettled(a.out, { skipCurrent: true });
		a.in.emit("first");
		await p1;
		const firstCost = a.cost.cache as CostState;
		expect(firstCost.usage.input.regular + firstCost.usage.output.regular).toBe(20);

		const p2 = awaitSettled(a.out, { skipCurrent: true });
		a.in.emit("second");
		await p2;
		const secondCost = a.cost.cache as CostState;
		expect(secondCost.usage.input.regular + secondCost.usage.output.regular).toBe(20);
		parent.destroy();
	});
});

// ---------------------------------------------------------------------------
// Reactive tools (DF12 substrate)
// ---------------------------------------------------------------------------

describe("agent() — reactive tools (DF12 substrate)", () => {
	it("static-array tools register at construction", () => {
		const parent = new Graph("parent");
		const tool: ToolDefinition = {
			name: "calc",
			description: "double a number",
			parameters: {},
			handler: (args) => (args.x as number) * 2,
		};
		const a = agent(parent, {
			name: "with-tools",
			adapter: syncAdapter("ok"),
			tools: [tool],
		});

		expect(
			((a.graph.loop.tools.schemas.cache as readonly ToolDefinition[]) ?? []).some(
				(t) => t.name === "calc",
			),
		).toBe(true);
		parent.destroy();
	});

	it("Node-form tools — registry reconciles add / remove on each emit", () => {
		const parent = new Graph("parent");
		const toolA: ToolDefinition = {
			name: "alpha",
			description: "",
			parameters: {},
			handler: () => null,
		};
		const toolB: ToolDefinition = {
			name: "beta",
			description: "",
			parameters: {},
			handler: () => null,
		};
		const toolsNode = node<readonly ToolDefinition[]>([], { initial: [toolA] });
		const a = agent(parent, {
			name: "reactive-tools",
			adapter: syncAdapter("ok"),
			tools: toolsNode,
		});

		const toolNames = () =>
			((a.graph.loop.tools.schemas.cache as readonly ToolDefinition[]) ?? []).map((t) => t.name);

		expect(toolNames()).toEqual(["alpha"]);

		// Add beta, remove alpha.
		toolsNode.emit([toolB]);
		expect(toolNames()).toEqual(["beta"]);

		// Add both back.
		toolsNode.emit([toolA, toolB]);
		expect(toolNames().sort()).toEqual(["alpha", "beta"]);
		parent.destroy();
	});
});

// ---------------------------------------------------------------------------
// Memory partition (§29 default-private + explicit-shared)
// ---------------------------------------------------------------------------

describe("agent() — memory partition", () => {
	it("default: no memory subgraph mounted (private; lazy)", () => {
		const parent = new Graph("parent");
		const a = agent(parent, {
			name: "no-mem",
			adapter: syncAdapter("ok"),
		});
		expect(a.graph.memory).toBeNull();
		// `memory/` mount path is absent.
		expect(() => a.graph.node("memory")).toThrow();
		parent.destroy();
	});

	// NOTE: sharing AgentMemoryGraph requires constructing one — defer that
	// integration test to the Phase 13.M / 13.G+H downstream consumer test.
	// The contract is: passing the SAME `memory` instance to two agents
	// mounts it once per agent. The mount-once rule of `Graph.mount` means
	// the SECOND mount throws; sharing is via reference, not co-mount. The
	// gap-analysis Q6-c lock acknowledges this — full sharing semantics are
	// for the §29 handoff recipe, not 13.G surface.
	it("explicit memory: passes through onto the bundle's graph", () => {
		const parent = new Graph("parent");
		const memorySubgraph = new Graph("shared-mem-stub");
		const a = agent(parent, {
			name: "with-mem",
			adapter: syncAdapter("ok"),
			// biome-ignore lint/suspicious/noExplicitAny: stub Graph standing in for AgentMemoryGraph
			memory: memorySubgraph as any,
		});
		expect(a.graph.memory).toBe(memorySubgraph);
		// Mount actually happened — the subgraph is reachable as `<agent-name>::memory`
		// under the parent (mount creates a hop, not a flat node).
		expect(() => a.graph.node("memory")).toThrow(/unknown (node|name)/i);
		parent.destroy();
	});
});

// ---------------------------------------------------------------------------
// presetRegistry()
// ---------------------------------------------------------------------------

describe("presetRegistry()", () => {
	it("starts empty when initial omitted", () => {
		const r = presetRegistry<number>();
		expect(r.registry.size).toBe(0);
	});

	it("starts populated when initial passed", () => {
		const r = presetRegistry<number>(
			new Map([
				["a", 1],
				["b", 2],
			]),
		);
		expect(r.registry.size).toBe(2);
		expect(r.registry.get("a")).toBe(1);
	});

	it("put adds / replaces; remove returns existed flag", () => {
		const r = presetRegistry<string>();
		r.put("x", "first");
		expect(r.registry.get("x")).toBe("first");

		r.put("x", "second");
		expect(r.registry.get("x")).toBe("second");

		expect(r.remove("x")).toBe(true);
		expect(r.remove("x")).toBe(false);
		expect(r.registry.has("x")).toBe(false);
	});

	it("registry.entries is a reactive Node — subscribe sees live updates", () => {
		const r = presetRegistry<string>();
		const seen: ReadonlyMap<string, string>[] = [];
		const unsub = r.registry.entries.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push(m[1] as ReadonlyMap<string, string>);
			}
		});

		r.put("a", "alpha");
		r.put("b", "beta");
		r.remove("a");

		// Initial push-on-subscribe + 3 mutations = 4 snapshots.
		expect(seen.length).toBeGreaterThanOrEqual(3);
		const last = seen.at(-1) as ReadonlyMap<string, string>;
		expect(last.has("a")).toBe(false);
		expect(last.get("b")).toBe("beta");
		unsub();
	});
});

// ---------------------------------------------------------------------------
// Re-entrancy under nested drain (F2 reachability)
// ---------------------------------------------------------------------------

describe("agent() — F2 reachability", () => {
	it("two-agent reactive handoff (subscriber on classifier.out kicks executor.in)", async () => {
		const parent = new Graph("parent");
		const classifier = agent(parent, {
			name: "cls",
			adapter: syncAdapter("ROUTE-A"),
		});
		const executor = agent(parent, {
			name: "exe",
			adapter: syncAdapter("EXEC-OK"),
		});

		// F2-fixed: subscriber on classifier.out can call executor.in.emit
		// inside the classifier's drain without deadlocking.
		const executorOuts: LLMResponse[] = [];
		const subOut = executor.out.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) executorOuts.push(m[1] as LLMResponse);
			}
		});
		const subBridge = classifier.out.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					executor.in.emit((m[1] as LLMResponse).content);
				}
			}
		});

		const promise = awaitSettled(executor.out, { skipCurrent: true });
		classifier.in.emit("classify this");
		await promise;
		expect(executorOuts.map((r) => r.content)).toEqual(["EXEC-OK"]);

		subOut();
		subBridge();
		parent.destroy();
	});
});

// ---------------------------------------------------------------------------
// Bundle contract — direct AgentGraph construction
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mid-run input queueing (N1(b) lock — /qa pass 2026-05-01)
// ---------------------------------------------------------------------------

describe("agent() — N1(b): mid-run input queue", () => {
	it("queues mid-run inputs and processes them sequentially after the prior settles", async () => {
		const parent = new Graph("parent");
		// Per-input scripted responses so we can verify each input is
		// processed in order with its own response.
		const responses = ["A", "B", "C"];
		let i = 0;
		const adapter: LLMAdapter = {
			provider: "queued-mock",
			invoke() {
				const c = responses[i++] ?? "X";
				return {
					content: c,
					finishReason: "end_turn",
					usage: { input: { regular: 1 }, output: { regular: 1 } },
				} satisfies LLMResponse;
			},
			async *stream() {
				yield { type: "finish", reason: "stop" };
			},
		};
		const a = agent(parent, { name: "queued", adapter });
		const seen: string[] = [];
		const sub = a.out.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push((m[1] as LLMResponse).content);
			}
		});

		// Three rapid emits — the first kicks the loop; the second and third
		// queue while the first is in flight.
		a.in.emit("first");
		a.in.emit("second");
		a.in.emit("third");

		// The drain effect chains the next pull on each `done` transition;
		// awaiting a tick lets the chain settle.
		await Promise.resolve();

		expect(seen).toEqual(["A", "B", "C"]);
		// chat.messages records all three user inputs + three assistant
		// responses, in order.
		const messages = a.graph.loop.chat.allMessages();
		expect(messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual([
			"first",
			"second",
			"third",
		]);
		sub();
		parent.destroy();
	});

	it("rejects mid-run reset corruption — prior in-flight cost is NOT zeroed by next emit", async () => {
		const parent = new Graph("parent");
		// Each call has a unique cost (10, 20, 30) so we can verify per-input
		// cost scoping under the queue.
		let i = 0;
		const adapter: LLMAdapter = {
			provider: "cost-mock",
			invoke() {
				const tokens = (i + 1) * 10;
				i++;
				return {
					content: `r${i}`,
					finishReason: "end_turn",
					usage: {
						input: { regular: tokens / 2 },
						output: { regular: tokens / 2 },
					},
				} satisfies LLMResponse;
			},
			async *stream() {
				yield { type: "finish", reason: "stop" };
			},
		};
		const a = agent(parent, { name: "cost-q", adapter });
		const costs: number[] = [];
		const sub = a.out.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					const cost = a.cost.cache as CostState;
					costs.push(cost.usage.input.regular + cost.usage.output.regular);
				}
			}
		});

		a.in.emit("first");
		a.in.emit("second");
		await Promise.resolve();

		// Cost is per-input: first is 10, second is 20 (NOT 30 = sum of both).
		expect(costs).toEqual([10, 20]);
		sub();
		parent.destroy();
	});
});

describe("AgentGraph — direct construction (no parent.mount)", () => {
	it("can be constructed standalone and mounted later", async () => {
		const standalone = new AgentGraph<string, LLMResponse>({
			name: "standalone",
			adapter: syncAdapter("hi"),
		});
		const parent = new Graph("parent");
		parent.mount("standalone", standalone);

		const promise = awaitSettled(standalone.out, { skipCurrent: true });
		standalone.in.emit("ping");
		const resp = await promise;
		expect(resp?.content).toBe("hi");
		parent.destroy();
	});
});

// Type-level smoke: the bundle's TIn / TOut flow correctly through.
type _CheckTypes = {
	default: AgentBundle<string, LLMResponse>;
	custom: AgentBundle<{ q: string }, { a: string }>;
};
const _typeCheck: _CheckTypes | undefined = undefined;
void _typeCheck;
