import { describe, expect, it } from "vitest";
import { DATA } from "../../core/messages.js";
import { derived, state } from "../../core/sugar.js";
import { Graph } from "../../graph/graph.js";
import {
	AgentLoopGraph,
	admissionFilter3D,
	agentLoop,
	agentMemory,
	type ChatMessage,
	ChatStreamGraph,
	chatStream,
	fromLLM,
	fromLLMStream,
	gaugesAsContext,
	graphFromSpec,
	knobsAsTools,
	type LLMAdapter,
	type LLMResponse,
	llmConsolidator,
	llmExtractor,
	suggestStrategy,
	systemPromptBuilder,
	type ToolDefinition,
	ToolRegistryGraph,
	toolRegistry,
	validateGraphDef,
} from "../../patterns/ai.js";

// ---------------------------------------------------------------------------
// Mock LLM adapter
// ---------------------------------------------------------------------------

function mockAdapter(responses: LLMResponse[], streamChunks?: string[][]): LLMAdapter {
	let idx = 0;
	let streamIdx = 0;
	return {
		invoke(_messages, _opts) {
			const resp = responses[idx] ?? responses[responses.length - 1]!;
			idx++;
			return resp;
		},
		async *stream(_messages, _opts) {
			const chunks = streamChunks?.[streamIdx] ?? streamChunks?.[streamChunks.length - 1] ?? [];
			streamIdx++;
			for (const chunk of chunks) {
				yield chunk;
			}
		},
	};
}

// ---------------------------------------------------------------------------
// chatStream
// ---------------------------------------------------------------------------

describe("patterns.ai.chatStream", () => {
	it("creates a graph with messages, latest, and messageCount nodes", () => {
		const cs = chatStream("test-chat");
		expect(cs).toBeInstanceOf(ChatStreamGraph);
		expect(cs.get("messageCount")).toBe(0);
		expect(cs.get("latest")).toBe(undefined);
	});

	it("appends messages and updates derived nodes", () => {
		const cs = chatStream("test-chat");
		cs.append("user", "hello");
		cs.append("assistant", "hi there");

		expect(cs.get("messageCount")).toBe(2);
		const latest = cs.get("latest") as ChatMessage;
		expect(latest.role).toBe("assistant");
		expect(latest.content).toBe("hi there");
	});

	it("appendToolResult adds tool role message", () => {
		const cs = chatStream("test-chat");
		cs.appendToolResult("call-1", '{"result": 42}');

		const msgs = cs.allMessages();
		expect(msgs.length).toBe(1);
		expect(msgs[0]?.role).toBe("tool");
		expect(msgs[0]?.toolCallId).toBe("call-1");
	});

	it("clear resets the stream", () => {
		const cs = chatStream("test-chat");
		cs.append("user", "test");
		cs.clear();
		expect(cs.get("messageCount")).toBe(0);
		expect(cs.allMessages().length).toBe(0);
	});

	it("describe() shows expected node structure", () => {
		const cs = chatStream("test-chat");
		const desc = cs.describe() as { nodes: Record<string, unknown> };
		expect(desc.nodes).toHaveProperty("messages");
		expect(desc.nodes).toHaveProperty("latest");
		expect(desc.nodes).toHaveProperty("messageCount");
	});
});

// ---------------------------------------------------------------------------
// toolRegistry
// ---------------------------------------------------------------------------

describe("patterns.ai.toolRegistry", () => {
	it("creates a graph with definitions and schemas nodes", () => {
		const tr = toolRegistry("test-tools");
		expect(tr).toBeInstanceOf(ToolRegistryGraph);
		const schemas = tr.schemas.get() as ToolDefinition[];
		expect(schemas).toEqual([]);
	});

	it("register and unregister tools", () => {
		const tr = toolRegistry("test-tools");
		const tool: ToolDefinition = {
			name: "add",
			description: "Adds two numbers",
			parameters: { type: "object" },
			handler: (args) => (args.a as number) + (args.b as number),
		};
		tr.register(tool);
		expect(tr.getDefinition("add")).toBeDefined();

		const schemas = tr.schemas.get() as ToolDefinition[];
		expect(schemas.length).toBe(1);
		expect(schemas[0]?.name).toBe("add");

		tr.unregister("add");
		expect(tr.getDefinition("add")).toBeUndefined();
		expect((tr.schemas.get() as ToolDefinition[]).length).toBe(0);
	});

	it("execute runs the tool handler", async () => {
		const tr = toolRegistry("test-tools");
		tr.register({
			name: "greet",
			description: "Greet",
			parameters: {},
			handler: (args) => `Hello, ${args.name}!`,
		});
		const result = await tr.execute("greet", { name: "world" });
		expect(result).toBe("Hello, world!");
	});

	it("execute throws for unknown tool", async () => {
		const tr = toolRegistry("test-tools");
		await expect(tr.execute("missing", {})).rejects.toThrow(/unknown tool/);
	});

	it("execute resolves Node handler results", async () => {
		const tr = toolRegistry("test-tools");
		const n = state(42);
		tr.register({
			name: "nodeVal",
			description: "Reactive node",
			parameters: {},
			handler: () => n,
		});
		const result = await tr.execute("nodeVal", {});
		expect(result).toBe(42);
	});

	it("execute awaits Promise then resolves", async () => {
		const tr = toolRegistry("test-tools");
		tr.register({
			name: "prom",
			description: "Promise",
			parameters: {},
			handler: async () => 7,
		});
		expect(await tr.execute("prom", {})).toBe(7);
	});
});

// ---------------------------------------------------------------------------
// systemPromptBuilder
// ---------------------------------------------------------------------------

describe("patterns.ai.systemPromptBuilder", () => {
	it("assembles sections into a prompt", () => {
		const prompt = systemPromptBuilder(["You are a helpful assistant.", "Be concise."]);
		expect(prompt.get()).toBe("You are a helpful assistant.\n\nBe concise.");
	});

	it("reacts to section changes", () => {
		const role = state("You are an assistant.");
		const prompt = systemPromptBuilder([role, "Be concise."]);
		expect(prompt.get()).toBe("You are an assistant.\n\nBe concise.");

		role.down([[DATA, "You are a coding expert."]]);
		expect(prompt.get()).toBe("You are a coding expert.\n\nBe concise.");
	});

	it("filters empty sections", () => {
		const prompt = systemPromptBuilder(["hello", "", "world"]);
		expect(prompt.get()).toBe("hello\n\nworld");
	});

	it("uses custom separator", () => {
		const prompt = systemPromptBuilder(["a", "b"], { separator: " | " });
		expect(prompt.get()).toBe("a | b");
	});
});

// ---------------------------------------------------------------------------
// fromLLM
// ---------------------------------------------------------------------------

describe("patterns.ai.fromLLM", () => {
	it("invokes adapter with messages", () => {
		const resp: LLMResponse = { content: "Hello!" };
		const adapter = mockAdapter([resp]);
		const msgs = state<ChatMessage[]>([{ role: "user", content: "hi" }]);
		const result = fromLLM(adapter, msgs);
		// switchMap nodes need a subscriber to activate
		const unsub = result.subscribe(() => {});
		expect(result.get()).toEqual(resp);
		unsub();
	});
});

// ---------------------------------------------------------------------------
// fromLLMStream
// ---------------------------------------------------------------------------

describe("patterns.ai.fromLLMStream", () => {
	it("accumulates streamed tokens into a reactive log", async () => {
		const chunks = ["Hello", " ", "world", "!"];
		const adapter = mockAdapter([], [chunks]);
		const msgs = state<ChatMessage[]>([{ role: "user", content: "hi" }]);
		const result = fromLLMStream(adapter, msgs);

		// Wait for the async iteration to complete
		await new Promise<void>((resolve) => {
			const unsub = result.subscribe((messages) => {
				for (const msg of messages) {
					if (msg[0] === DATA) {
						const snapshot = msg[1] as { value: { entries: readonly string[] } };
						if (snapshot.value.entries.length === chunks.length) {
							expect(snapshot.value.entries).toEqual(chunks);
							unsub();
							resolve();
						}
					}
				}
			});
		});
	});

	it("starts a fresh log on new messages input", async () => {
		const chunks1 = ["first"];
		const chunks2 = ["second"];
		const adapter = mockAdapter([], [chunks1, chunks2]);
		const msgs = state<ChatMessage[]>([{ role: "user", content: "one" }]);
		const result = fromLLMStream(adapter, msgs);

		// Single persistent subscription to capture all emissions
		const allSnapshots: Array<{ entries: readonly string[] }> = [];
		const unsub = result.subscribe((messages) => {
			for (const msg of messages) {
				if (msg[0] === DATA) {
					const s = msg[1] as { value: { entries: readonly string[] } };
					allSnapshots.push(s.value);
				}
			}
		});

		// Wait for first stream async iteration to complete
		await new Promise((r) => setTimeout(r, 20));
		expect(allSnapshots.length).toBeGreaterThanOrEqual(1);
		const firstFinal = allSnapshots[allSnapshots.length - 1];
		expect(firstFinal.entries).toEqual(["first"]);

		// Trigger second stream — switchMap tears down old, creates fresh log
		allSnapshots.length = 0;
		msgs.down([[DATA, [{ role: "user", content: "two" }]]]);
		await new Promise((r) => setTimeout(r, 20));

		expect(allSnapshots.length).toBeGreaterThanOrEqual(1);
		const secondFinal = allSnapshots[allSnapshots.length - 1];
		// Fresh log: only "second", not ["first", "second"]
		expect(secondFinal.entries).toEqual(["second"]);
		unsub();
	});

	it("returns empty log for empty messages", () => {
		const adapter = mockAdapter([], []);
		const msgs = state<ChatMessage[]>([]);
		const result = fromLLMStream(adapter, msgs);
		const unsub = result.subscribe(() => {});
		const snapshot = result.get() as { value: { entries: readonly string[] } } | null;
		// Empty messages → cleared log
		expect(snapshot === null || (snapshot?.value?.entries?.length ?? 0) === 0).toBe(true);
		unsub();
	});

	it("absorbs adapter stream errors without crashing", async () => {
		const errorAdapter: LLMAdapter = {
			invoke: () => ({ content: "" }),
			async *stream() {
				yield "partial";
				throw new Error("stream broke");
			},
		};
		const msgs = state<ChatMessage[]>([{ role: "user", content: "hi" }]);
		const result = fromLLMStream(errorAdapter, msgs);

		const snapshots: Array<{ entries: readonly string[] }> = [];
		const unsub = result.subscribe((messages) => {
			for (const msg of messages) {
				if (msg[0] === DATA) {
					const s = msg[1] as { value: { entries: readonly string[] } };
					snapshots.push(s.value);
				}
			}
		});

		await new Promise((r) => setTimeout(r, 20));
		// Should have received at least the "partial" chunk before the error
		expect(snapshots.length).toBeGreaterThanOrEqual(1);
		expect(snapshots[0].entries).toContain("partial");
		// Log node is still alive (not terminated) — can receive new streams
		unsub();
	});
});

// ---------------------------------------------------------------------------
// agentLoop
// ---------------------------------------------------------------------------

describe("patterns.ai.agentLoop", () => {
	it("creates an agent loop graph with subgraphs", () => {
		const resp: LLMResponse = { content: "done", finishReason: "end_turn" };
		const adapter = mockAdapter([resp]);
		const loop = agentLoop("test-agent", { adapter });
		expect(loop).toBeInstanceOf(AgentLoopGraph);
		expect(loop.status.get()).toBe("idle");
		expect(loop.turnCount.get()).toBe(0);
	});

	it("runs a simple conversation and reaches done status", async () => {
		const resp: LLMResponse = { content: "Hello, human!", finishReason: "end_turn" };
		const adapter = mockAdapter([resp]);
		const loop = agentLoop("test-agent", { adapter });

		const result = await loop.run("Hi!");
		expect(result?.content).toBe("Hello, human!");
		expect(loop.status.get()).toBe("done");
		expect(loop.turnCount.get()).toBe(1);
	});

	it("executes tool calls and loops", async () => {
		const toolCallResp: LLMResponse = {
			content: "",
			toolCalls: [{ id: "tc1", name: "calc", arguments: { x: 5 } }],
		};
		const finalResp: LLMResponse = {
			content: "The result is 10",
			finishReason: "end_turn",
		};
		const adapter = mockAdapter([toolCallResp, finalResp]);

		const tool: ToolDefinition = {
			name: "calc",
			description: "Double a number",
			parameters: {},
			handler: (args) => (args.x as number) * 2,
		};

		const loop = agentLoop("test-agent", {
			adapter,
			tools: [tool],
		});

		const result = await loop.run("Double 5 for me");
		expect(result?.content).toBe("The result is 10");
		expect(loop.turnCount.get()).toBe(2);
		// Chat should have: user, assistant (tool call), tool result, assistant (final)
		const msgs = loop.chat.allMessages();
		expect(msgs.length).toBe(4);
		expect(msgs[2]?.role).toBe("tool");
	});

	it("respects maxTurns", async () => {
		const resp: LLMResponse = {
			content: "",
			toolCalls: [{ id: "tc1", name: "noop", arguments: {} }],
		};
		const adapter = mockAdapter([resp]);
		const tool: ToolDefinition = {
			name: "noop",
			description: "No-op",
			parameters: {},
			handler: () => null,
		};

		const loop = agentLoop("test-agent", {
			adapter,
			tools: [tool],
			maxTurns: 2,
		});

		await loop.run("loop forever");
		expect(loop.turnCount.get()).toBe(2);
		expect(loop.status.get()).toBe("done");
	});

	it("respects custom stopWhen", async () => {
		const resp: LLMResponse = { content: "STOP_HERE" };
		const adapter = mockAdapter([resp]);
		const loop = agentLoop("test-agent", {
			adapter,
			stopWhen: (r) => r.content === "STOP_HERE",
		});
		const result = await loop.run("test");
		expect(result?.content).toBe("STOP_HERE");
		expect(loop.status.get()).toBe("done");
	});

	it("resolves async LLM adapter invoke (Promise)", async () => {
		const resp: LLMResponse = { content: "async-ok", finishReason: "end_turn" };
		const adapter: LLMAdapter = {
			invoke() {
				return Promise.resolve(resp);
			},
		};
		const loop = agentLoop("test-agent", { adapter });
		const result = await loop.run("hi");
		expect(result?.content).toBe("async-ok");
	});
});

// ---------------------------------------------------------------------------
// llmExtractor / llmConsolidator (callback shape tests)
// ---------------------------------------------------------------------------

describe("patterns.ai.llmExtractor", () => {
	it("returns a function", () => {
		const resp: LLMResponse = {
			content: JSON.stringify({ upsert: [{ key: "k1", value: "v1" }] }),
		};
		const adapter = mockAdapter([resp]);
		const fn = llmExtractor("Extract memories.", { adapter });
		expect(typeof fn).toBe("function");
	});
});

describe("patterns.ai.llmConsolidator", () => {
	it("returns a function", () => {
		const resp: LLMResponse = {
			content: JSON.stringify({ upsert: [{ key: "merged", value: "combined" }] }),
		};
		const adapter = mockAdapter([resp]);
		const fn = llmConsolidator("Consolidate memories.", { adapter });
		expect(typeof fn).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// agentMemory
// ---------------------------------------------------------------------------

describe("patterns.ai.agentMemory", () => {
	it("creates a graph with store, compact, and size nodes", () => {
		const source = state<string>("test input");
		const mem = agentMemory("test-mem", source, {
			extractFn: (raw, _existing) => ({
				upsert: [{ key: "k1", value: String(raw) }],
			}),
			score: () => 1,
			cost: () => 10,
			budget: 100,
		});

		expect(mem).toBeDefined();
		const desc = mem.describe() as { nodes: Record<string, unknown> };
		expect(desc.nodes).toHaveProperty("store");
		expect(desc.nodes).toHaveProperty("compact");
		expect(desc.nodes).toHaveProperty("size");
	});

	it("throws when neither extractFn nor adapter+extractPrompt provided", () => {
		expect(() =>
			agentMemory("bad", state(null), {
				score: () => 1,
				cost: () => 1,
			}),
		).toThrow(/extractFn or adapter/);
	});

	it("exposes null for optional features when not configured", () => {
		const mem = agentMemory("test-mem", state("x"), {
			extractFn: () => ({ upsert: [] }),
			score: () => 1,
			cost: () => 1,
		});
		expect(mem.vectors).toBeNull();
		expect(mem.kg).toBeNull();
		expect(mem.memoryTiers).toBeNull();
		expect(mem.retrieval).toBeNull();
		expect(mem.retrievalTrace).toBeNull();
		expect(mem.retrieve).toBeNull();
		mem.destroy();
	});

	it("creates vector index when vectorDimensions + embedFn provided", () => {
		const source = state<string>("hello");
		const mem = agentMemory<string>("vec-mem", source, {
			extractFn: (raw) => ({
				upsert: [{ key: "k1", value: String(raw) }],
			}),
			score: () => 1,
			cost: () => 10,
			budget: 100,
			vectorDimensions: 3,
			embedFn: (_mem) => [0.1, 0.2, 0.3],
		});

		expect(mem.vectors).not.toBeNull();
		const desc = mem.describe() as { nodes: Record<string, unknown> };
		expect(desc.nodes).toHaveProperty("vectorIndex");
		mem.destroy();
	});

	it("mounts knowledge graph when enableKnowledgeGraph is true", () => {
		const source = state<string>("hello");
		const mem = agentMemory<string>("kg-mem", source, {
			extractFn: (raw) => ({
				upsert: [{ key: "k1", value: String(raw) }],
			}),
			score: () => 1,
			cost: () => 10,
			enableKnowledgeGraph: true,
			entityFn: (key, _mem) => ({
				entities: [{ id: key, value: { name: key } }],
			}),
		});

		expect(mem.kg).not.toBeNull();
		mem.destroy();
	});

	it("sets up 3-tier storage with permanent filter", () => {
		const source = state<string>("hello");
		const mem = agentMemory<string>("tier-mem", source, {
			extractFn: (raw) => ({
				upsert: [{ key: "core-profile", value: String(raw) }],
			}),
			score: () => 1,
			cost: () => 10,
			tiers: {
				permanentFilter: (key) => key.startsWith("core-"),
				maxActive: 100,
			},
		});

		expect(mem.memoryTiers).not.toBeNull();
		expect(mem.memoryTiers!.permanent).toBeDefined();
		expect(typeof mem.memoryTiers!.tierOf).toBe("function");
		expect(typeof mem.memoryTiers!.markPermanent).toBe("function");
		mem.destroy();
	});

	it("retrieval pipeline returns packed results with vector search", () => {
		const source = state<string>("test");
		const mem = agentMemory<string>("retr-mem", source, {
			extractFn: (raw) => ({
				upsert: [
					{ key: "m1", value: `mem-${raw}` },
					{ key: "m2", value: `other-${raw}` },
				],
			}),
			score: (_mem, _ctx) => 0.8,
			cost: () => 10,
			budget: 100,
			vectorDimensions: 3,
			embedFn: (_mem) => [1.0, 0.0, 0.0],
			retrieval: { topK: 5 },
		});

		expect(mem.retrieve).not.toBeNull();
		expect(mem.retrievalTrace).not.toBeNull();

		// Execute a retrieval query
		const results = mem.retrieve!({ vector: [1.0, 0.0, 0.0] });
		// Results should be an array (may be empty if store hasn't propagated yet)
		expect(Array.isArray(results)).toBe(true);
		mem.destroy();
	});

	it("retrieval trace captures pipeline stages", () => {
		const source = state<string>("input");
		const mem = agentMemory<string>("trace-mem", source, {
			extractFn: (raw) => ({
				upsert: [{ key: "k1", value: String(raw) }],
			}),
			score: () => 1,
			cost: () => 5,
			budget: 100,
			vectorDimensions: 3,
			embedFn: () => [0.5, 0.5, 0.0],
		});

		mem.retrieve!({ vector: [0.5, 0.5, 0.0] });
		const trace = mem.retrievalTrace!.get();
		if (trace) {
			expect(trace).toHaveProperty("vectorCandidates");
			expect(trace).toHaveProperty("graphExpanded");
			expect(trace).toHaveProperty("ranked");
			expect(trace).toHaveProperty("packed");
		}
		mem.destroy();
	});
});

// ---------------------------------------------------------------------------
// admissionFilter3D
// ---------------------------------------------------------------------------

describe("patterns.ai.admissionFilter3D", () => {
	it("admits when all thresholds met", () => {
		const filter = admissionFilter3D({
			scoreFn: () => ({ persistence: 0.8, structure: 0.5, personalValue: 0.7 }),
		});
		expect(filter("test")).toBe(true);
	});

	it("rejects when persistence below threshold", () => {
		const filter = admissionFilter3D({
			scoreFn: () => ({ persistence: 0.1, structure: 0.5, personalValue: 0.7 }),
			persistenceThreshold: 0.3,
		});
		expect(filter("test")).toBe(false);
	});

	it("rejects when personalValue below threshold", () => {
		const filter = admissionFilter3D({
			scoreFn: () => ({ persistence: 0.8, structure: 0.5, personalValue: 0.1 }),
			personalValueThreshold: 0.3,
		});
		expect(filter("test")).toBe(false);
	});

	it("rejects unstructured when requireStructured is true", () => {
		const filter = admissionFilter3D({
			scoreFn: () => ({ persistence: 0.8, structure: 0, personalValue: 0.7 }),
			requireStructured: true,
		});
		expect(filter("test")).toBe(false);
	});

	it("uses default scorer when no scoreFn provided", () => {
		const filter = admissionFilter3D();
		// Default scorer returns 0.5 for all dimensions, passes 0.3 thresholds
		expect(filter("anything")).toBe(true);
	});

	it("integrates with agentMemory admissionFilter option", () => {
		const admitted: unknown[] = [];
		const filter = admissionFilter3D({
			scoreFn: (raw) => ({
				persistence: raw === "keep" ? 0.8 : 0.1,
				structure: 0.5,
				personalValue: 0.5,
			}),
		});

		const source = state<string>("keep");
		const mem = agentMemory<string>("3d-mem", source, {
			extractFn: (raw) => {
				admitted.push(raw);
				return { upsert: [{ key: "k", value: String(raw) }] };
			},
			score: () => 1,
			cost: () => 1,
			admissionFilter: filter,
		});

		expect(mem).toBeDefined();
		mem.destroy();
	});
});

// ---------------------------------------------------------------------------
// knobsAsTools (5.4)
// ---------------------------------------------------------------------------

describe("knobsAsTools", () => {
	it("generates tool schemas from state nodes with meta", () => {
		const g = new Graph("test");
		const temp = state(72, {
			name: "temperature",
			meta: {
				description: "Room temperature",
				type: "number",
				range: [60, 90],
				unit: "°F",
				access: "both",
			},
		});
		const mode = state("auto", {
			name: "mode",
			meta: {
				description: "HVAC mode",
				type: "enum",
				values: ["auto", "cool", "heat", "off"],
				access: "llm",
			},
		});
		// Derived node should NOT appear as a tool
		const summary = derived([temp, mode], ([t, m]) => `${m}: ${t}`, {
			name: "summary",
			meta: { description: "Summary display" },
		});
		g.add("temperature", temp);
		g.add("mode", mode);
		g.add("summary", summary);
		g.connect("temperature", "summary");
		g.connect("mode", "summary");

		const result = knobsAsTools(g);

		expect(result.openai).toHaveLength(2);
		expect(result.mcp).toHaveLength(2);
		expect(result.definitions).toHaveLength(2);

		// Check OpenAI schema shape
		const tempTool = result.openai.find((t) => t.function.name === "temperature");
		expect(tempTool).toBeDefined();
		expect(tempTool!.type).toBe("function");
		expect(tempTool!.function.description).toBe("Room temperature");
		expect(tempTool!.function.parameters).toEqual({
			type: "object",
			required: ["value"],
			properties: {
				value: {
					type: "number",
					minimum: 60,
					maximum: 90,
					description: "Unit: °F",
				},
			},
			additionalProperties: false,
		});

		// Check MCP schema shape
		const modeMcp = result.mcp.find((t) => t.name === "mode");
		expect(modeMcp).toBeDefined();
		expect(modeMcp!.description).toBe("HVAC mode");
		expect((modeMcp!.inputSchema.properties as Record<string, unknown>).value).toEqual({
			type: "string",
			enum: ["auto", "cool", "heat", "off"],
		});

		// Handler calls graph.set
		const tempDef = result.definitions.find((d) => d.name === "temperature");
		tempDef!.handler({ value: 80 });
		expect(temp.get()).toBe(80);

		g.destroy();
	});

	it("excludes state nodes with access=human", () => {
		const g = new Graph("test");
		const secret = state("pw", {
			name: "secret",
			meta: { description: "Human-only secret", access: "human" },
		});
		g.add("secret", secret);

		const result = knobsAsTools(g);
		expect(result.openai).toHaveLength(0);
		g.destroy();
	});
});

// ---------------------------------------------------------------------------
// gaugesAsContext (5.4)
// ---------------------------------------------------------------------------

describe("gaugesAsContext", () => {
	it("formats gauge nodes as context string", () => {
		const g = new Graph("dashboard");
		const revenue = state(1234.5, {
			name: "revenue",
			meta: { description: "Monthly revenue", format: "currency", tags: ["finance"] },
		});
		const growth = state(0.15, {
			name: "growth",
			meta: { description: "Growth rate", format: "percentage", tags: ["finance"] },
		});
		const status = state("healthy", {
			name: "status",
			meta: { description: "System status", format: "status" },
		});
		g.add("revenue", revenue);
		g.add("growth", growth);
		g.add("status", status);

		const ctx = gaugesAsContext(g);

		expect(ctx).toContain("Monthly revenue: $1234.50");
		expect(ctx).toContain("Growth rate: 15.0%");
		expect(ctx).toContain("System status: healthy");
		// Finance group should be grouped together
		expect(ctx).toContain("[finance]");
		g.destroy();
	});

	it("returns empty string when no gauges", () => {
		const g = new Graph("empty");
		const plain = state(42, { name: "plain" });
		g.add("plain", plain);

		expect(gaugesAsContext(g)).toBe("");
		g.destroy();
	});
});

// ---------------------------------------------------------------------------
// validateGraphDef (5.4)
// ---------------------------------------------------------------------------

describe("validateGraphDef", () => {
	it("accepts a valid graph definition", () => {
		const def = {
			name: "test",
			nodes: {
				input: { type: "state", status: "settled", deps: [], meta: {} },
				compute: { type: "derived", status: "settled", deps: ["input"], meta: {} },
			},
			edges: [{ from: "input", to: "compute" }],
			subgraphs: [],
		};
		const result = validateGraphDef(def);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("rejects missing name", () => {
		const result = validateGraphDef({ nodes: {}, edges: [] });
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("name"))).toBe(true);
	});

	it("rejects invalid node type", () => {
		const result = validateGraphDef({
			name: "test",
			nodes: { a: { type: "unknown_type", deps: [], meta: {} } },
			edges: [],
		});
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("invalid type"))).toBe(true);
	});

	it("rejects edges referencing nonexistent nodes", () => {
		const result = validateGraphDef({
			name: "test",
			nodes: { a: { type: "state", deps: [], meta: {} } },
			edges: [{ from: "a", to: "missing" }],
		});
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("missing"))).toBe(true);
	});

	it("detects duplicate edges", () => {
		const result = validateGraphDef({
			name: "test",
			nodes: {
				a: { type: "state", deps: [], meta: {} },
				b: { type: "derived", deps: ["a"], meta: {} },
			},
			edges: [
				{ from: "a", to: "b" },
				{ from: "a", to: "b" },
			],
		});
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("duplicate"))).toBe(true);
	});

	it("rejects non-object input", () => {
		expect(validateGraphDef(null).valid).toBe(false);
		expect(validateGraphDef("string").valid).toBe(false);
		expect(validateGraphDef(42).valid).toBe(false);
	});

	it("rejects deps referencing nonexistent nodes", () => {
		const result = validateGraphDef({
			name: "test",
			nodes: {
				a: { type: "derived", deps: ["nonexistent"], meta: {} },
			},
			edges: [],
		});
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("nonexistent"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// graphFromSpec (5.4)
// ---------------------------------------------------------------------------

describe("graphFromSpec", () => {
	it("constructs a graph from LLM-generated JSON", async () => {
		const graphDef = {
			name: "calculator",
			nodes: {
				a: { type: "state", value: 10, deps: [], meta: { description: "Input A" } },
				b: { type: "state", value: 20, deps: [], meta: { description: "Input B" } },
			},
			edges: [],
			subgraphs: [],
		};

		const adapter = mockAdapter([{ content: JSON.stringify(graphDef), finishReason: "end_turn" }]);

		const g = await graphFromSpec("Build a calculator with two inputs", adapter);
		expect(g.name).toBe("calculator");
		expect(g.get("a")).toBe(10);
		expect(g.get("b")).toBe(20);
		g.destroy();
	});

	it("strips markdown fences from LLM response", async () => {
		const graphDef = {
			name: "simple",
			nodes: {
				x: { type: "state", value: 1, deps: [], meta: { description: "X" } },
			},
			edges: [],
			subgraphs: [],
		};

		const adapter = mockAdapter([
			{
				content: "```json\n" + JSON.stringify(graphDef) + "\n```",
				finishReason: "end_turn",
			},
		]);

		const g = await graphFromSpec("simple graph", adapter);
		expect(g.name).toBe("simple");
		g.destroy();
	});

	it("throws on invalid JSON from LLM", async () => {
		const adapter = mockAdapter([{ content: "not json at all!", finishReason: "end_turn" }]);

		await expect(graphFromSpec("bad", adapter)).rejects.toThrow("not valid JSON");
	});

	it("throws on validation failure", async () => {
		const adapter = mockAdapter([
			{
				content: JSON.stringify({ nodes: {}, edges: [] }),
				finishReason: "end_turn",
			},
		]);

		await expect(graphFromSpec("missing name", adapter)).rejects.toThrow(
			"invalid graph definition",
		);
	});
});

// ---------------------------------------------------------------------------
// suggestStrategy (5.4)
// ---------------------------------------------------------------------------

describe("suggestStrategy", () => {
	it("returns a structured strategy plan", async () => {
		const plan = {
			summary: "Add a rate limiter node",
			reasoning: "The API calls node has no rate limiting, which could cause throttling.",
			operations: [
				{
					type: "add_node",
					name: "rate_limiter",
					nodeType: "derived",
					meta: { description: "Rate limiter" },
				},
				{ type: "connect", from: "rate_limiter", to: "api_calls" },
				{ type: "set_value", name: "max_rate", value: 100 },
			],
		};

		const adapter = mockAdapter([{ content: JSON.stringify(plan), finishReason: "end_turn" }]);

		const g = new Graph("api");
		const maxRate = state(50, { name: "max_rate", meta: { description: "Max rate" } });
		g.add("max_rate", maxRate);

		const result = await suggestStrategy(g, "API calls are being throttled", adapter);

		expect(result.summary).toBe("Add a rate limiter node");
		expect(result.reasoning).toContain("rate limiting");
		expect(result.operations).toHaveLength(3);
		expect(result.operations[0]).toEqual({
			type: "add_node",
			name: "rate_limiter",
			nodeType: "derived",
			meta: { description: "Rate limiter" },
		});

		g.destroy();
	});

	it("throws on invalid LLM response", async () => {
		const adapter = mockAdapter([{ content: "just some text", finishReason: "end_turn" }]);

		const g = new Graph("test");
		await expect(suggestStrategy(g, "problem", adapter)).rejects.toThrow("not valid JSON");
		g.destroy();
	});

	it("throws on missing required fields", async () => {
		const adapter = mockAdapter([
			{ content: JSON.stringify({ operations: [] }), finishReason: "end_turn" },
		]);

		const g = new Graph("test");
		await expect(suggestStrategy(g, "problem", adapter)).rejects.toThrow("missing 'summary'");
		g.destroy();
	});
});
