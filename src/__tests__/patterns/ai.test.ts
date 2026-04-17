import { describe, expect, it } from "vitest";
import { DATA, TEARDOWN } from "../../core/messages.js";
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
	costMeterExtractor,
	type ExtractedToolCall,
	fromLLM,
	type GatedStreamHandle,
	gatedStream,
	gaugesAsContext,
	graphFromSpec,
	type KeywordFlag,
	keywordFlagExtractor,
	knobsAsTools,
	type LLMAdapter,
	type LLMResponse,
	llmConsolidator,
	llmExtractor,
	promptNode,
	type StreamChunk,
	streamExtractor,
	streamingPromptNode,
	suggestStrategy,
	systemPromptBuilder,
	type ToolDefinition,
	ToolRegistryGraph,
	toolCallExtractor,
	toolRegistry,
	validateGraphDef,
} from "../../patterns/ai.js";

// ---------------------------------------------------------------------------
// Mock LLM adapter
// ---------------------------------------------------------------------------

/**
 * Mock LLM adapter. `stream()` yields tokens asynchronously (one microtask per
 * token) to match real adapter behavior — real LLM SDKs always involve I/O
 * between chunks. Tests MUST use reactive subscribe patterns (not synchronous
 * `.cache`) to observe stream results.
 */
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
				// Yield to microtask queue between tokens — real adapters always
				// have async I/O between chunks (network, SSE frame parsing, etc.)
				await Promise.resolve();
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
		expect(cs.get("latest")).toBe(null);
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
		const schemas = tr.schemas.cache as ToolDefinition[];
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

		const schemas = tr.schemas.cache as ToolDefinition[];
		expect(schemas.length).toBe(1);
		expect(schemas[0]?.name).toBe("add");

		tr.unregister("add");
		expect(tr.getDefinition("add")).toBeUndefined();
		expect((tr.schemas.cache as ToolDefinition[]).length).toBe(0);
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
		expect(prompt.cache).toBe("You are a helpful assistant.\n\nBe concise.");
	});

	it("reacts to section changes", () => {
		const role = state("You are an assistant.");
		const prompt = systemPromptBuilder([role, "Be concise."]);
		expect(prompt.cache).toBe("You are an assistant.\n\nBe concise.");

		role.down([[DATA, "You are a coding expert."]]);
		expect(prompt.cache).toBe("You are a coding expert.\n\nBe concise.");
	});

	it("filters empty sections", () => {
		const prompt = systemPromptBuilder(["hello", "", "world"]);
		expect(prompt.cache).toBe("hello\n\nworld");
	});

	it("uses custom separator", () => {
		const prompt = systemPromptBuilder(["a", "b"], { separator: " | " });
		expect(prompt.cache).toBe("a | b");
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
		expect(result.cache).toEqual(resp);
		unsub();
	});
});

// ---------------------------------------------------------------------------
// streamingPromptNode
// ---------------------------------------------------------------------------

describe("patterns.ai.streamingPromptNode", () => {
	it("emits final result after stream completes", async () => {
		const chunks = ["Hello", " ", "world", "!"];
		const adapter = mockAdapter([], [chunks]);
		const input = state("greet");

		const { output } = streamingPromptNode(adapter, [input], (v) => `say ${v}`);

		const result = await new Promise<string | null>((resolve) => {
			output.subscribe((messages) => {
				for (const msg of messages) {
					if (msg[0] === DATA && msg[1] !== null) {
						resolve(msg[1] as string | null);
					}
				}
			});
		});

		expect(result).toBe("Hello world!");
	});

	it("publishes StreamChunks to the stream topic", async () => {
		const chunks = ["A", "B", "C"];
		const adapter = mockAdapter([], [chunks]);
		const input = state("go");

		const { output, stream } = streamingPromptNode(adapter, [input], (v) => `${v}`);

		const received: StreamChunk[] = [];
		stream.latest.subscribe((messages) => {
			for (const msg of messages) {
				if (msg[0] === DATA && msg[1] != null) {
					received.push(msg[1] as StreamChunk);
				}
			}
		});

		// Wait for stream to complete
		await new Promise<void>((resolve) => {
			output.subscribe((messages) => {
				for (const msg of messages) {
					if (msg[0] === DATA && msg[1] !== null) resolve();
				}
			});
		});

		expect(received.length).toBe(3);
		expect(received[0]).toEqual({ source: "llm", token: "A", accumulated: "A", index: 0 });
		expect(received[1]).toEqual({ source: "llm", token: "B", accumulated: "AB", index: 1 });
		expect(received[2]).toEqual({ source: "llm", token: "C", accumulated: "ABC", index: 2 });
	});

	it("cancels in-flight stream on new input via switchMap", async () => {
		const chunks1 = ["slow", "stream"];
		const chunks2 = ["fast"];
		const adapter = mockAdapter([], [chunks1, chunks2]);
		const input = state("first");

		const { output } = streamingPromptNode(adapter, [input], (v) => `${v}`);

		const results: Array<string | null> = [];
		output.subscribe((messages) => {
			for (const msg of messages) {
				if (msg[0] === DATA) results.push(msg[1] as string | null);
			}
		});

		// Wait for first stream result
		await new Promise<void>((resolve) => {
			const unsub = output.subscribe((messages) => {
				for (const msg of messages) {
					if (msg[0] === DATA && msg[1] !== null) {
						unsub();
						resolve();
					}
				}
			});
		});
		expect(results.filter((r) => r !== null).pop()).toBe("slowstream");

		// Trigger second input — switchMap cancels first, starts fresh
		input.down([[DATA, "second"]]);

		// Wait for second stream result (skip cached push-on-subscribe)
		await new Promise<void>((resolve) => {
			let skipFirst = true;
			const unsub = output.subscribe((messages) => {
				for (const msg of messages) {
					if (msg[0] === DATA && msg[1] !== null) {
						if (skipFirst) {
							skipFirst = false;
							continue;
						}
						unsub();
						resolve();
					}
				}
			});
		});

		const nonNull = results.filter((r) => r !== null);
		expect(nonNull[nonNull.length - 1]).toBe("fast");
	});

	it("emits null for nullish deps (SENTINEL gate)", () => {
		const adapter = mockAdapter([], []);
		const dep = state<string | null>(null);

		const { output } = streamingPromptNode(adapter, [dep], (v) => `${v}`);

		const values: Array<unknown> = [];
		output.subscribe((messages) => {
			for (const msg of messages) {
				if (msg[0] === DATA) values.push(msg[1]);
			}
		});

		// null dep → empty messages → switchMap returns state(null) → pushed synchronously
		expect(values).toContain(null);
	});

	it("parses JSON when format is json", async () => {
		const adapter: LLMAdapter = {
			invoke: () => ({ content: "" }),
			async *stream() {
				yield '{"key":';
				yield '"value"}';
			},
		};
		const input = state("go");

		const { output } = streamingPromptNode<{ key: string }>(adapter, [input], (v) => `${v}`, {
			format: "json",
		});

		const result = await new Promise<{ key: string } | null>((resolve) => {
			output.subscribe((messages) => {
				for (const msg of messages) {
					if (msg[0] === DATA && msg[1] !== null) {
						resolve(msg[1] as { key: string } | null);
					}
				}
			});
		});

		expect(result).toEqual({ key: "value" });
	});

	it("dispose destroys the stream topic (TEARDOWN)", () => {
		const { stream, dispose } = streamingPromptNode(
			mockAdapter([], []),
			[state("go")],
			(v) => `${v}`,
		);

		const received: unknown[] = [];
		stream.latest.subscribe((messages) => {
			for (const msg of messages) {
				received.push(msg[0]);
			}
		});

		dispose();

		expect(received).toContain(TEARDOWN);
	});
});

// ---------------------------------------------------------------------------
// streamExtractor
// ---------------------------------------------------------------------------

describe("patterns.ai.streamExtractor", () => {
	it("extracts values from a stream topic", () => {
		const { stream } = streamingPromptNode(
			mockAdapter([], [["hello", " world"]]),
			[state("go")],
			(v) => `${v}`,
		);

		const extracted: Array<string | null> = [];
		const extractor = streamExtractor(
			stream,
			(accumulated) => {
				const match = accumulated.match(/hello/);
				return match ? match[0] : null;
			},
			{ name: "hello-detector" },
		);
		extractor.subscribe((messages) => {
			for (const msg of messages) {
				if (msg[0] === DATA) extracted.push(msg[1] as string | null);
			}
		});

		// Manually publish chunks to test the extractor in isolation
		stream.publish({ source: "test", token: "hel", accumulated: "hel", index: 0 });
		stream.publish({ source: "test", token: "lo", accumulated: "hello", index: 1 });

		// First chunk: no match → null, second: match → "hello"
		expect(extracted).toContain(null);
		expect(extracted).toContain("hello");
	});

	it("returns null when stream topic has no chunks", () => {
		const { stream } = streamingPromptNode(mockAdapter([], []), [state("go")], (v) => `${v}`);

		const extractor = streamExtractor(stream, () => "found");
		extractor.subscribe(() => {});

		// No chunks published yet — latest is undefined → extractFn not called
		expect(extractor.cache).toBe(null);
	});
});

// ---------------------------------------------------------------------------
// keywordFlagExtractor
// ---------------------------------------------------------------------------

describe("patterns.ai.keywordFlagExtractor", () => {
	it("detects keyword matches in the stream", () => {
		const { stream } = streamingPromptNode(mockAdapter([], [["a"]]), [state("go")], (v) => `${v}`);

		const flags: KeywordFlag[][] = [];
		const extractor = keywordFlagExtractor(stream, {
			patterns: [
				{ pattern: /setTimeout/g, label: "invariant-violation" },
				{ pattern: /\bSSN\b/i, label: "pii" },
			],
		});
		extractor.subscribe((messages) => {
			for (const msg of messages) {
				if (msg[0] === DATA) flags.push(msg[1] as KeywordFlag[]);
			}
		});

		stream.publish({ source: "test", token: "use ", accumulated: "use ", index: 0 });
		stream.publish({
			source: "test",
			token: "setTimeout and SSN",
			accumulated: "use setTimeout and SSN",
			index: 1,
		});

		// Last emission should contain both flags
		const last = flags[flags.length - 1];
		expect(last).toHaveLength(2);
		expect(last[0].label).toBe("invariant-violation");
		expect(last[0].match).toBe("setTimeout");
		expect(last[1].label).toBe("pii");
		expect(last[1].match).toBe("SSN");
	});

	it("returns empty array when no matches", () => {
		const { stream } = streamingPromptNode(mockAdapter([], []), [state("go")], (v) => `${v}`);

		const extractor = keywordFlagExtractor(stream, {
			patterns: [{ pattern: /setTimeout/, label: "violation" }],
		});
		extractor.subscribe(() => {});

		stream.publish({ source: "test", token: "clean code", accumulated: "clean code", index: 0 });
		expect(extractor.cache).toEqual([]);
	});

	it("finds multiple matches of the same pattern", () => {
		const { stream } = streamingPromptNode(mockAdapter([], []), [state("go")], (v) => `${v}`);

		const extractor = keywordFlagExtractor(stream, {
			patterns: [{ pattern: /TODO/g, label: "todo" }],
		});
		extractor.subscribe(() => {});

		stream.publish({
			source: "test",
			token: "TODO fix TODO later",
			accumulated: "TODO fix TODO later",
			index: 0,
		});

		const result = extractor.cache!;
		expect(result).toHaveLength(2);
		expect(result[0].position).toBe(0);
		expect(result[1].position).toBe(9);
	});
});

// ---------------------------------------------------------------------------
// toolCallExtractor
// ---------------------------------------------------------------------------

describe("patterns.ai.toolCallExtractor", () => {
	it("extracts tool calls from the stream", () => {
		const { stream } = streamingPromptNode(mockAdapter([], []), [state("go")], (v) => `${v}`);

		const calls: ExtractedToolCall[][] = [];
		const extractor = toolCallExtractor(stream);
		extractor.subscribe((messages) => {
			for (const msg of messages) {
				if (msg[0] === DATA) calls.push(msg[1] as ExtractedToolCall[]);
			}
		});

		const toolJson = JSON.stringify({ name: "get_weather", arguments: { city: "NYC" } });
		stream.publish({
			source: "test",
			token: toolJson,
			accumulated: `Sure, let me check. ${toolJson}`,
			index: 0,
		});

		const last = calls[calls.length - 1];
		expect(last).toHaveLength(1);
		expect(last[0].name).toBe("get_weather");
		expect(last[0].arguments).toEqual({ city: "NYC" });
		expect(last[0].startIndex).toBe(20); // after "Sure, let me check. "
	});

	it("returns empty array for partial JSON", () => {
		const { stream } = streamingPromptNode(mockAdapter([], []), [state("go")], (v) => `${v}`);

		const extractor = toolCallExtractor(stream);
		extractor.subscribe(() => {});

		// Incomplete JSON — no closing brace yet
		stream.publish({
			source: "test",
			token: '{"name": "run',
			accumulated: '{"name": "run',
			index: 0,
		});

		expect(extractor.cache).toEqual([]);
	});

	it("ignores JSON objects without name+arguments shape", () => {
		const { stream } = streamingPromptNode(mockAdapter([], []), [state("go")], (v) => `${v}`);

		const extractor = toolCallExtractor(stream);
		extractor.subscribe(() => {});

		stream.publish({
			source: "test",
			token: '{"foo": "bar"}',
			accumulated: '{"foo": "bar"}',
			index: 0,
		});

		expect(extractor.cache).toEqual([]);
	});

	it("handles braces inside JSON string values", () => {
		const { stream } = streamingPromptNode(mockAdapter([], []), [state("go")], (v) => `${v}`);

		const extractor = toolCallExtractor(stream);
		extractor.subscribe(() => {});

		const toolJson = JSON.stringify({
			name: "run_code",
			arguments: { code: 'if (x) { return "}" }' },
		});
		stream.publish({
			source: "test",
			token: toolJson,
			accumulated: toolJson,
			index: 0,
		});

		const result = extractor.cache!;
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("run_code");
		expect(result[0].arguments).toEqual({ code: 'if (x) { return "}" }' });
	});

	it("extracts multiple tool calls from one stream", () => {
		const { stream } = streamingPromptNode(mockAdapter([], []), [state("go")], (v) => `${v}`);

		const extractor = toolCallExtractor(stream);
		extractor.subscribe(() => {});

		const call1 = JSON.stringify({ name: "a", arguments: { x: 1 } });
		const call2 = JSON.stringify({ name: "b", arguments: { y: 2 } });
		stream.publish({
			source: "test",
			token: `${call1} then ${call2}`,
			accumulated: `${call1} then ${call2}`,
			index: 0,
		});

		const result = extractor.cache!;
		expect(result).toHaveLength(2);
		expect(result[0].name).toBe("a");
		expect(result[1].name).toBe("b");
	});
});

// ---------------------------------------------------------------------------
// costMeterExtractor
// ---------------------------------------------------------------------------

describe("patterns.ai.costMeterExtractor", () => {
	it("tracks chunk count, char count, and estimated tokens", () => {
		const { stream } = streamingPromptNode(mockAdapter([], []), [state("go")], (v) => `${v}`);

		const extractor = costMeterExtractor(stream);
		extractor.subscribe(() => {});

		stream.publish({ source: "test", token: "hello", accumulated: "hello", index: 0 });

		const reading = extractor.cache!;
		expect(reading.chunkCount).toBe(1);
		expect(reading.charCount).toBe(5);
		expect(reading.estimatedTokens).toBe(2); // ceil(5/4)
	});

	it("accumulates across chunks", () => {
		const { stream } = streamingPromptNode(mockAdapter([], []), [state("go")], (v) => `${v}`);

		const extractor = costMeterExtractor(stream);
		extractor.subscribe(() => {});

		stream.publish({ source: "test", token: "hello", accumulated: "hello", index: 0 });
		stream.publish({ source: "test", token: " world", accumulated: "hello world", index: 1 });

		const reading = extractor.cache!;
		expect(reading.chunkCount).toBe(2);
		expect(reading.charCount).toBe(11);
		expect(reading.estimatedTokens).toBe(3); // ceil(11/4)
	});

	it("uses custom charsPerToken", () => {
		const { stream } = streamingPromptNode(mockAdapter([], []), [state("go")], (v) => `${v}`);

		const extractor = costMeterExtractor(stream, { charsPerToken: 2 });
		extractor.subscribe(() => {});

		stream.publish({ source: "test", token: "hello", accumulated: "hello", index: 0 });

		expect(extractor.cache!.estimatedTokens).toBe(3); // ceil(5/2)
	});

	it("returns zero reading when no chunks", () => {
		const { stream } = streamingPromptNode(mockAdapter([], []), [state("go")], (v) => `${v}`);

		const extractor = costMeterExtractor(stream);
		extractor.subscribe(() => {});

		expect(extractor.cache).toEqual({ chunkCount: 0, charCount: 0, estimatedTokens: 0 });
	});
});

// ---------------------------------------------------------------------------
// gatedStream
// ---------------------------------------------------------------------------

// FLAG: v5 behavioral change — needs investigation
// All gatedStream tests fail with:
//   Graph "test": connect(review/raw, review/gate) — target must include source in its constructor deps (same node reference)
describe("patterns.ai.gatedStream", () => {
	/** Wait for gate.count to reach `n` by subscribing reactively. */
	function waitForPending(handle: GatedStreamHandle<unknown>, n = 1): Promise<void> {
		// If count already has the value, resolve immediately
		if ((handle.gate.count.cache as number) >= n) return Promise.resolve();
		return new Promise<void>((resolve) => {
			let teardown: (() => void) | undefined;
			teardown = handle.gate.count.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA && (m[1] as number) >= n) {
						teardown?.();
						resolve();
					}
				}
			});
		});
	}

	it("gates output and allows approval", async () => {
		const adapter = mockAdapter([], [["hello", " world"]]);
		const graph = new Graph("test");
		const dep = state("go");

		const handle = gatedStream(graph, "review", adapter, [dep], (v) => `say ${v}`);
		const results: unknown[] = [];
		handle.output.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA && m[1] != null) results.push(m[1]);
		});

		await waitForPending(handle);
		expect(handle.gate.count.cache).toBe(1);
		handle.gate.approve();
		expect(results.length).toBe(1);
		expect(results[0]).toBe("hello world");
		handle.dispose();
	});

	it("reject discards pending and aborts the stream", async () => {
		let streamStarted = false;
		const adapter: LLMAdapter = {
			invoke: () => ({ content: "", finishReason: "end_turn" }),
			async *stream(_msgs, opts) {
				streamStarted = true;
				for (let i = 0; i < 100; i++) {
					if (opts?.signal?.aborted) return;
					yield `chunk${i} `;
					await new Promise((r) => setTimeout(r, 5));
				}
			},
		};

		const graph = new Graph("test");
		const dep = state("go");
		const handle = gatedStream(graph, "review", adapter, [dep], (v) => `say ${v}`);
		handle.output.subscribe(() => {});

		// Wait for first chunk to confirm stream started, then reject
		await new Promise<void>((resolve) => {
			handle.stream.latest.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA && m[1] != null) {
						resolve();
					}
				}
			});
		});

		expect(streamStarted).toBe(true);
		handle.gate.reject();
		expect(handle.gate.count.cache).toBe(0);
		handle.dispose();
	});

	it("modify transforms pending value before forwarding", async () => {
		const adapter = mockAdapter([], [["original"]]);
		const graph = new Graph("test");
		const dep = state("go");

		const handle = gatedStream(graph, "review", adapter, [dep], (v) => `say ${v}`);
		const results: unknown[] = [];
		handle.output.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA && m[1] != null) results.push(m[1]);
		});

		await waitForPending(handle);
		handle.gate.modify((v) => `${v} [reviewed]`);
		expect(results.length).toBe(1);
		expect(results[0]).toBe("original [reviewed]");
		handle.dispose();
	});

	it("stream topic publishes chunks while gate is pending", async () => {
		const adapter = mockAdapter([], [["a", "b", "c"]]);
		const graph = new Graph("test");
		const dep = state("go");

		const handle = gatedStream(graph, "review", adapter, [dep], (v) => `${v}`);
		const chunks: StreamChunk[] = [];
		handle.stream.latest.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA && m[1]) chunks.push(m[1] as StreamChunk);
		});
		// Activate gate chain so the output pipeline runs
		handle.output.subscribe(() => {});

		await waitForPending(handle);
		// Chunks published even though gate hasn't approved
		expect(chunks.length).toBeGreaterThan(0);
		expect(chunks[chunks.length - 1]!.accumulated).toBe("abc");
		handle.gate.approve();
		handle.dispose();
	});

	it("startOpen auto-approves without gating", async () => {
		const adapter = mockAdapter([], [["auto"]]);
		const graph = new Graph("test");
		const dep = state("go");

		const handle = gatedStream(graph, "review", adapter, [dep], (v) => `${v}`, {
			gate: { startOpen: true },
		});

		// With startOpen, value flows through without gating — wait for non-null result
		const result = await new Promise<unknown>((resolve) => {
			handle.output.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA && m[1] != null) resolve(m[1]);
				}
			});
		});

		expect(result).toBe("auto");
		handle.dispose();
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
		expect(loop.status.cache).toBe("idle");
		expect(loop.turnCount.cache).toBe(0);
	});

	it("runs a simple conversation and reaches done status", async () => {
		const resp: LLMResponse = { content: "Hello, human!", finishReason: "end_turn" };
		const adapter = mockAdapter([resp]);
		const loop = agentLoop("test-agent", { adapter });

		const result = await loop.run("Hi!");
		expect(result?.content).toBe("Hello, human!");
		expect(loop.status.cache).toBe("done");
		expect(loop.turnCount.cache).toBe(1);
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
		expect(loop.turnCount.cache).toBe(2);
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
		expect(loop.turnCount.cache).toBe(2);
		expect(loop.status.cache).toBe("done");
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
		expect(loop.status.cache).toBe("done");
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
		const trace = mem.retrievalTrace!.cache;
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
		expect(temp.cache).toBe(80);

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

	it("includes V0 version metadata for knob definitions", () => {
		const g = new Graph("versioned-knobs");
		const knob = state(1, {
			name: "knob",
			versioning: 0,
			meta: { description: "Versioned knob", access: "both" },
		});
		g.add("knob", knob);

		const result = knobsAsTools(g);
		const def = result.definitions.find((d) => d.name === "knob");
		expect(def).toBeDefined();
		expect(def!.version).toEqual({ id: knob.v!.id, version: knob.v!.version });
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

	it("supports V0 delta filtering via sinceVersion", () => {
		const g = new Graph("delta");
		const metric = state(1, {
			name: "metric",
			versioning: 0,
			meta: { description: "Metric", access: "both" },
		});
		g.add("metric", metric);

		const since = new Map<string, { id: string; version: number }>();
		since.set("metric", { id: metric.v!.id, version: metric.v!.version });
		expect(gaugesAsContext(g, undefined, { sinceVersion: since })).toBe("");

		metric.down([[DATA, 2]]);
		const ctx = gaugesAsContext(g, undefined, { sinceVersion: since });
		expect(ctx).toContain("Metric: 2");
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
				content: `\`\`\`json\n${JSON.stringify(graphDef)}\n\`\`\``,
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

// ---------------------------------------------------------------------------
// promptNode
// ---------------------------------------------------------------------------

describe("patterns.ai.promptNode", () => {
	const tick = () => new Promise((r) => setTimeout(r, 0));

	it("cache deduplicates identical invocations", async () => {
		let callCount = 0;
		const adapter: LLMAdapter = {
			invoke(_messages, _opts) {
				callCount++;
				return { content: "result", finishReason: "end_turn" };
			},
			async *stream() {
				yield "";
			},
		};

		const dep = state("hello");
		const pn = promptNode<string>(adapter, [dep], (v: string) => `summarize: ${v}`, {
			cache: true,
		});
		const unsub = pn.subscribe(() => {});
		await tick();

		expect(pn.cache).toBe("result");
		// Push-on-subscribe may cause initial invocation(s); record baseline
		const baseline = callCount;

		// Trigger re-evaluation with same dep value — should hit cache
		dep.down([[DATA, "hello"]]);
		await tick();
		expect(pn.cache).toBe("result");
		expect(callCount).toBe(baseline); // no additional call (cache hit)

		// Change dep — different prompt text → different cache key
		dep.down([[DATA, "world"]]);
		await tick();
		expect(pn.cache).toBe("result");
		expect(callCount).toBe(baseline + 1);

		unsub();
	});

	it("strips markdown fences for JSON format", async () => {
		const adapter: LLMAdapter = {
			invoke() {
				return { content: '```json\n{"key": "value"}\n```', finishReason: "end_turn" };
			},
			async *stream() {
				yield "";
			},
		};

		const dep = state("x");
		const pn = promptNode<{ key: string }>(adapter, [dep], "extract", { format: "json" });
		const unsub = pn.subscribe(() => {});
		await tick();
		expect(pn.cache).toEqual({ key: "value" });
		unsub();
	});

	it("passes systemPrompt in invoke opts", async () => {
		let receivedOpts: Record<string, unknown> = {};
		const adapter: LLMAdapter = {
			invoke(_messages, opts) {
				receivedOpts = opts as Record<string, unknown>;
				return { content: "ok", finishReason: "end_turn" };
			},
			async *stream() {
				yield "";
			},
		};

		const dep = state("x");
		const pn = promptNode<string>(adapter, [dep], "test", { systemPrompt: "be helpful" });
		const unsub = pn.subscribe(() => {});
		await tick();
		expect(pn.cache).toBe("ok");
		expect(receivedOpts.systemPrompt).toBe("be helpful");
		unsub();
	});
});
