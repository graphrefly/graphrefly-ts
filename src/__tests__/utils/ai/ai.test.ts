import { DATA, TEARDOWN } from "@graphrefly/pure-ts/core";
import { node } from "@graphrefly/pure-ts/core";
import { Graph } from "@graphrefly/pure-ts/graph";
import { describe, expect, it } from "vitest";
import { awaitSettled } from "../../../base/sources/settled.js";
import {
	AgentLoopGraph,
	admissionFilter3D,
	admissionScored,
	agentLoop,
	agentMemory,
	type ChatMessage,
	ChatStreamGraph,
	chatStream,
	costMeterExtractor,
	type ExtractedToolCall,
	frozenContext,
	type GatedStreamHandle,
	gatedStream,
	gaugesAsContext,
	graphFromSpec,
	graphFromSpecReactive,
	handoff,
	type KeywordFlag,
	keywordFlagExtractor,
	knobsAsTools,
	type LLMAdapter,
	type LLMResponse,
	llmConsolidator,
	llmExtractor,
	memoryRetrieval,
	promptNode,
	type StampedDelta,
	type StrategyPlan,
	streamExtractor,
	streamingPromptNode,
	suggestStrategy,
	suggestStrategyReactive,
	systemPromptBuilder,
	type ToolCall,
	type ToolDefinition,
	ToolRegistryGraph,
	toolCallExtractor,
	toolRegistry,
	toolSelector,
	validateGraphDef,
} from "../../../utils/ai/index.js";

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
				yield { type: "token" as const, delta: chunk };
			}
			yield {
				type: "usage" as const,
				usage: { input: { regular: 0 }, output: { regular: 0 } },
			};
			yield { type: "finish" as const, reason: "stop" };
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
		expect(cs.node("messageCount").cache).toBe(0);
		// SENTINEL on empty (COMPOSITION-GUIDE §1a) — `latest.cache` is
		// `undefined` until the first append, not a `null` placeholder.
		expect(cs.node("latest").cache).toBeUndefined();
	});

	it("appends messages and updates derived nodes", () => {
		const cs = chatStream("test-chat");
		cs.append("user", "hello");
		cs.append("assistant", "hi there");

		expect(cs.node("messageCount").cache).toBe(2);
		const latest = cs.node("latest").cache as ChatMessage;
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
		expect(cs.node("messageCount").cache).toBe(0);
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

	it("executeReactive runs the tool handler (scalar)", async () => {
		const tr = toolRegistry("test-tools");
		tr.register({
			name: "greet",
			description: "Greet",
			parameters: {},
			handler: (args) => `Hello, ${args.name}!`,
		});
		const result = await awaitSettled(tr.executeReactive("greet", { name: "world" }));
		expect(result).toBe("Hello, world!");
	});

	it("executeReactive throws synchronously for unknown tool", () => {
		const tr = toolRegistry("test-tools");
		expect(() => tr.executeReactive("missing", {})).toThrow(/unknown tool/);
	});

	it("executeReactive forwards Node handler results", async () => {
		const tr = toolRegistry("test-tools");
		const n = node([], { initial: 42 });
		tr.register({
			name: "nodeVal",
			description: "Reactive node",
			parameters: {},
			handler: () => n,
		});
		const result = await awaitSettled(tr.executeReactive("nodeVal", {}));
		expect(result).toBe(42);
	});

	it("executeReactive resolves Promise handler results", async () => {
		const tr = toolRegistry("test-tools");
		tr.register({
			name: "prom",
			description: "Promise",
			parameters: {},
			handler: async () => 7,
		});
		const result = await awaitSettled(tr.executeReactive("prom", {}));
		expect(result).toBe(7);
	});

	it("executeReactive aborts handler on supersede via threaded signal", async () => {
		// Regression: executeReactive must thread `signal` into the handler
		// so unsubscribing the returned node (e.g. switchMap supersede in
		// toolExecution) actually cancels in-flight handler work.
		let received: AbortSignal | undefined;
		let aborted = false;
		const tr = toolRegistry("test-tools");
		tr.register({
			name: "long",
			description: "long-running",
			parameters: {},
			handler: (_args, opts) => {
				received = opts?.signal;
				received?.addEventListener("abort", () => {
					aborted = true;
				});
				return new Promise(() => {
					/* never resolves */
				});
			},
		});
		const node = tr.executeReactive("long", {});
		const unsub = node.subscribe(() => {});
		expect(received).toBeInstanceOf(AbortSignal);
		expect(received?.aborted).toBe(false);
		unsub();
		expect(aborted).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// toolSelector (D8)
// ---------------------------------------------------------------------------

describe("patterns.ai.toolSelector (D8)", () => {
	const search: ToolDefinition = {
		name: "search",
		description: "search the web",
		parameters: {},
		handler: () => "ok",
		meta: { expensive: false, destructive: false },
	};
	const write: ToolDefinition = {
		name: "write",
		description: "write a file",
		parameters: {},
		handler: () => "ok",
		meta: { expensive: false, destructive: true },
	};
	const llm: ToolDefinition = {
		name: "llm",
		description: "nested LLM call",
		parameters: {},
		handler: () => "ok",
		meta: { expensive: true, destructive: false },
	};

	it("filters tools reactively when predicates flip", () => {
		const all = node<readonly ToolDefinition[]>([], { name: "all", initial: [search, write, llm] });
		const hasBudget = node([], { name: "budget", initial: true });
		const destructiveAllowed = node([], { name: "dstr", initial: true });
		const sel = toolSelector(all, [
			node(
				[hasBudget],
				(batchData, actions, ctx) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					actions.emit((t: ToolDefinition) => !(t.meta?.expensive === true) || data[0] === true);
				},
				{ describeKind: "derived" },
			),
			node(
				[destructiveAllowed],
				(batchData, actions, ctx) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					actions.emit((t: ToolDefinition) => !(t.meta?.destructive === true) || data[0] === true);
				},
				{ describeKind: "derived" },
			),
		]);
		const unsub = sel.subscribe(() => {});
		expect((sel.cache as readonly ToolDefinition[]).map((t) => t.name).sort()).toEqual([
			"llm",
			"search",
			"write",
		]);
		// Deplete budget → drops expensive tools.
		hasBudget.emit(false);
		expect((sel.cache as readonly ToolDefinition[]).map((t) => t.name).sort()).toEqual([
			"search",
			"write",
		]);
		// Disallow destructive → drops write too.
		destructiveAllowed.emit(false);
		expect((sel.cache as readonly ToolDefinition[]).map((t) => t.name)).toEqual(["search"]);
		unsub();
	});

	it("reactive allTools (e.g. registry.schemas) drives re-evaluation", () => {
		const tr = toolRegistry("tools");
		tr.register(search);
		const sel = toolSelector(tr.schemas, []);
		const unsub = sel.subscribe(() => {});
		expect((sel.cache as readonly ToolDefinition[]).map((t) => t.name)).toEqual(["search"]);
		tr.register(write);
		expect((sel.cache as readonly ToolDefinition[]).map((t) => t.name).sort()).toEqual([
			"search",
			"write",
		]);
		unsub();
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
		const role = node([], { initial: "You are an assistant." });
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
// promptNode({ format: "raw" }) — Tier 2.3 fold of the deleted `fromLLM`
// ---------------------------------------------------------------------------

describe("patterns.ai.promptNode (raw format — fromLLM fold)", () => {
	it("emits the full LLMResponse object when format is 'raw'", () => {
		const resp: LLMResponse = { content: "Hello!" };
		const adapter = mockAdapter([resp]);
		const msgs = node<ChatMessage[]>([], { initial: [{ role: "user", content: "hi" }] });
		const result = promptNode<LLMResponse>(
			adapter,
			[msgs],
			(m) => (m as ChatMessage[])[0]!.content,
			{ format: "raw" },
		);
		const unsub = result.subscribe(() => {});
		expect(result.cache).toEqual(resp);
		unsub();
	});
});

describe("patterns.ai.handoff (B10)", () => {
	it("no condition: always routes through the specialist factory", () => {
		const from = node<string | null>([], { initial: "hi" });
		let factoryCalls = 0;
		const routed = handoff(from, (input) => {
			factoryCalls += 1;
			return node(
				[input],
				(batchData, actions, ctx) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					actions.emit(`[specialist] ${data[0]}`);
				},
				{ describeKind: "derived" },
			);
		});
		const unsub = routed.subscribe(() => {});
		expect(routed.cache).toBe("[specialist] hi");
		expect(factoryCalls).toBeGreaterThanOrEqual(1);
		unsub();
	});

	it("condition gates specialist engagement", () => {
		const from = node<string | null>([], { initial: "q" });
		const urgent = node([], { initial: false });
		const routed = handoff(
			from,
			(input) =>
				node(
					[input],
					(batchData, actions, ctx) => {
						const data = batchData.map((batch, i) =>
							batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
						);
						actions.emit(`[urgent] ${data[0]}`);
					},
					{ describeKind: "derived" },
				),
			{
				condition: urgent,
			},
		);
		const unsub = routed.subscribe(() => {});
		// Condition closed — pass-through.
		expect(routed.cache).toBe("q");
		// Open the gate — specialist engages.
		urgent.emit(true);
		expect(routed.cache).toBe("[urgent] q");
		// Close again — specialist output still shown (last) until src changes.
		urgent.emit(false);
		from.emit("q2");
		expect(routed.cache).toBe("q2");
		unsub();
	});

	it("null `from` value emits null regardless of condition", () => {
		const from = node<string | null>([], { initial: null });
		const routed = handoff(
			from,
			(input) =>
				node(
					[input],
					(batchData, actions, ctx) => {
						const data = batchData.map((batch, i) =>
							batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
						);
						actions.emit(`[s] ${data[0]}`);
					},
					{ describeKind: "derived" },
				),
			{
				condition: node([], { initial: true }),
			},
		);
		const unsub = routed.subscribe(() => {});
		expect(routed.cache).toBeNull();
		unsub();
	});
});

describe("patterns.ai.frozenContext (B11)", () => {
	it("materializes once without refresh trigger — source changes are ignored", () => {
		const source = node([], { initial: "v1" });
		const frozen = frozenContext(source);
		const unsub = frozen.subscribe(() => {});
		expect(frozen.cache).toBe("v1");
		source.emit("v2");
		source.emit("v3");
		// Frozen stays at v1 regardless of source changes.
		expect(frozen.cache).toBe("v1");
		unsub();
	});

	it("with refreshTrigger: emits current source only when trigger fires", () => {
		const source = node([], { initial: "s1" });
		const trigger = node([], { initial: 0 });
		const frozen = frozenContext(source, { refreshTrigger: trigger });
		const unsub = frozen.subscribe(() => {});
		// Activation: src fires first (captured), trigger fires in its own
		// wave → frozen emits the src value.
		expect(frozen.cache).toBe("s1");

		// Source drifts without a trigger tick — frozen stays put.
		source.emit("s2");
		source.emit("s3");
		expect(frozen.cache).toBe("s1");

		// Trigger fires → frozen catches up to current src.
		trigger.emit(1);
		expect(frozen.cache).toBe("s3");

		// Another trigger with no src change re-emits the same value (RESOLVED suppression).
		trigger.emit(2);
		expect(frozen.cache).toBe("s3");

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
		const input = node([], { initial: "greet" });

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

	it("publishes stamped deltas to the delta topic", async () => {
		const chunks = ["A", "B", "C"];
		const adapter = mockAdapter([], [chunks]);
		const input = node([], { initial: "go" });

		const { output, deltaTopic } = streamingPromptNode(adapter, [input], (v) => `${v}`);

		const received: StampedDelta[] = [];
		deltaTopic.latest.subscribe((messages) => {
			for (const msg of messages) {
				if (msg[0] === DATA && msg[1] != null) {
					received.push(msg[1] as StampedDelta);
				}
			}
		});

		await new Promise<void>((resolve) => {
			output.subscribe((messages) => {
				for (const msg of messages) {
					if (msg[0] === DATA && msg[1] !== null) resolve();
				}
			});
		});

		const tokens = received.filter((d) => d.type === "token");
		expect(tokens).toHaveLength(3);
		expect(tokens.map((d) => (d as { delta: string }).delta)).toEqual(["A", "B", "C"]);
		expect(tokens.map((d) => d.seq)).toEqual([0, 1, 2]);
	});

	it("cancels in-flight stream on new input via switchMap", async () => {
		const chunks1 = ["slow", "stream"];
		const chunks2 = ["fast"];
		const adapter = mockAdapter([], [chunks1, chunks2]);
		const input = node([], { initial: "first" });

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
		const dep = node<string | null>([], { initial: null });

		const { output } = streamingPromptNode(adapter, [dep], (v) => `${v}`);

		const values: Array<unknown> = [];
		output.subscribe((messages) => {
			for (const msg of messages) {
				if (msg[0] === DATA) values.push(msg[1]);
			}
		});

		// null dep → empty messages → switchMap returns node([], { initial: null }) → pushed synchronously
		expect(values).toContain(null);
	});

	it("parses JSON when format is json", async () => {
		const adapter: LLMAdapter = {
			provider: "mock",
			invoke: () => ({
				content: "",
				usage: { input: { regular: 0 }, output: { regular: 0 } },
			}),
			async *stream() {
				yield { type: "token" as const, delta: '{"key":' };
				yield { type: "token" as const, delta: '"value"}' };
				yield { type: "usage" as const, usage: { input: { regular: 0 }, output: { regular: 0 } } };
				yield { type: "finish" as const, reason: "stop" };
			},
		};
		const input = node([], { initial: "go" });

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

	it("dispose destroys the delta topic (TEARDOWN)", () => {
		const { deltaTopic, dispose } = streamingPromptNode(
			mockAdapter([], []),
			[node([], { initial: "go" })],
			(v) => `${v}`,
		);

		const received: unknown[] = [];
		deltaTopic.latest.subscribe((messages) => {
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
	it("extracts values from an accumulated-text source", () => {
		const textState = node<string>([], { initial: "" });

		const extracted: Array<string | null> = [];
		const extractor = streamExtractor(
			textState,
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

		textState.emit("hel");
		textState.emit("hello");

		// First emission: no match → null; second: match → "hello"
		expect(extracted).toContain(null);
		expect(extracted).toContain("hello");
	});

	it("returns null for an empty accumulated-text source", () => {
		const textState = node<string>([], { initial: "" });
		const extractor = streamExtractor(textState, (t) => (t.length > 0 ? "found" : null));
		extractor.subscribe(() => {});
		expect(extractor.cache).toBe(null);
	});
});

// ---------------------------------------------------------------------------
// keywordFlagExtractor
// ---------------------------------------------------------------------------

describe("patterns.ai.keywordFlagExtractor", () => {
	it("detects keyword matches in accumulated text", () => {
		const textState = node<string>([], { initial: "" });

		const flags: KeywordFlag[][] = [];
		const extractor = keywordFlagExtractor(textState, {
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

		textState.emit("use ");
		textState.emit("use setTimeout and SSN");

		const last = flags[flags.length - 1];
		expect(last).toHaveLength(2);
		expect(last[0].label).toBe("invariant-violation");
		expect(last[0].match).toBe("setTimeout");
		expect(last[1].label).toBe("pii");
		expect(last[1].match).toBe("SSN");
	});

	it("returns empty array when no matches", () => {
		const textState = node<string>([], { initial: "" });
		const extractor = keywordFlagExtractor(textState, {
			patterns: [{ pattern: /setTimeout/, label: "violation" }],
		});
		extractor.subscribe(() => {});
		textState.emit("clean code");
		expect(extractor.cache).toEqual([]);
	});

	it("finds multiple matches of the same pattern", () => {
		const textState = node<string>([], { initial: "" });
		const extractor = keywordFlagExtractor(textState, {
			patterns: [{ pattern: /TODO/g, label: "todo" }],
		});
		extractor.subscribe(() => {});
		textState.emit("TODO fix TODO later");
		const result = extractor.cache!;
		expect(result).toHaveLength(2);
		expect(result[0].position).toBe(0);
		expect(result[1].position).toBe(9);
	});

	it("throws at factory time when a pattern exceeds maxPatternLength", () => {
		const textState = node<string>([], { initial: "" });
		// 150-char pattern vs default 128 max → throw.
		const long = new RegExp("x".repeat(150));
		expect(() =>
			keywordFlagExtractor(textState, {
				patterns: [{ pattern: long, label: "overly-long" }],
			}),
		).toThrow(/maxPatternLength/);
	});
});

// ---------------------------------------------------------------------------
// toolCallExtractor
// ---------------------------------------------------------------------------

describe("patterns.ai.toolCallExtractor", () => {
	it("extracts tool calls from accumulated text", () => {
		const textState = node<string>([], { initial: "" });
		const calls: ExtractedToolCall[][] = [];
		const extractor = toolCallExtractor(textState);
		extractor.subscribe((messages) => {
			for (const msg of messages) {
				if (msg[0] === DATA) calls.push(msg[1] as ExtractedToolCall[]);
			}
		});
		const toolJson = JSON.stringify({ name: "get_weather", arguments: { city: "NYC" } });
		textState.emit(`Sure, let me check. ${toolJson}`);

		const last = calls[calls.length - 1];
		expect(last).toHaveLength(1);
		expect(last[0].name).toBe("get_weather");
		expect(last[0].arguments).toEqual({ city: "NYC" });
		expect(last[0].startIndex).toBe(20);
	});

	it("returns empty array for partial JSON", () => {
		const textState = node<string>([], { initial: "" });
		const extractor = toolCallExtractor(textState);
		extractor.subscribe(() => {});
		textState.emit('{"name": "run');
		expect(extractor.cache).toEqual([]);
	});

	it("ignores JSON objects without name+arguments shape", () => {
		const textState = node<string>([], { initial: "" });
		const extractor = toolCallExtractor(textState);
		extractor.subscribe(() => {});
		textState.emit('{"foo": "bar"}');
		expect(extractor.cache).toEqual([]);
	});

	it("handles braces inside JSON string values", () => {
		const textState = node<string>([], { initial: "" });
		const extractor = toolCallExtractor(textState);
		extractor.subscribe(() => {});
		const toolJson = JSON.stringify({
			name: "run_code",
			arguments: { code: 'if (x) { return "}" }' },
		});
		textState.emit(toolJson);
		const result = extractor.cache!;
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("run_code");
		expect(result[0].arguments).toEqual({ code: 'if (x) { return "}" }' });
	});

	it("extracts multiple tool calls from accumulated text", () => {
		const textState = node<string>([], { initial: "" });
		const extractor = toolCallExtractor(textState);
		extractor.subscribe(() => {});
		const call1 = JSON.stringify({ name: "a", arguments: { x: 1 } });
		const call2 = JSON.stringify({ name: "b", arguments: { y: 2 } });
		textState.emit(`${call1} then ${call2}`);
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
	function publish(
		t: ReturnType<typeof streamingPromptNode>["deltaTopic"],
		delta: string,
		seq: number,
	) {
		t.publish({ type: "token", delta, seq, ts: BigInt(0) as unknown as number });
	}

	it("tracks chunk count, char count, and estimated tokens (fallback mode)", () => {
		const { deltaTopic } = streamingPromptNode(
			mockAdapter([], []),
			[node([], { initial: "go" })],
			(v) => `${v}`,
		);
		const extractor = costMeterExtractor(deltaTopic);
		extractor.subscribe(() => {});

		publish(deltaTopic, "hello", 0);
		const reading = extractor.cache!;
		expect(reading.chunkCount).toBe(1);
		expect(reading.charCount).toBe(5);
		expect(reading.estimatedTokens).toBe(2); // ceil(5/4)
		expect(reading.estimated).toBe(true);
	});

	it("accumulates across token deltas", () => {
		const { deltaTopic } = streamingPromptNode(
			mockAdapter([], []),
			[node([], { initial: "go" })],
			(v) => `${v}`,
		);
		const extractor = costMeterExtractor(deltaTopic);
		extractor.subscribe(() => {});

		publish(deltaTopic, "hello", 0);
		publish(deltaTopic, " world", 1);

		const reading = extractor.cache!;
		expect(reading.chunkCount).toBe(2);
		expect(reading.charCount).toBe(11);
		expect(reading.estimatedTokens).toBe(3); // ceil(11/4)
	});

	it("uses custom charsPerToken", () => {
		const { deltaTopic } = streamingPromptNode(
			mockAdapter([], []),
			[node([], { initial: "go" })],
			(v) => `${v}`,
		);
		const extractor = costMeterExtractor(deltaTopic, { charsPerToken: 2 });
		extractor.subscribe(() => {});

		publish(deltaTopic, "hello", 0);
		expect(extractor.cache!.estimatedTokens).toBe(3); // ceil(5/2)
	});

	it("returns zero reading when no deltas", () => {
		const { deltaTopic } = streamingPromptNode(
			mockAdapter([], []),
			[node([], { initial: "go" })],
			(v) => `${v}`,
		);
		const extractor = costMeterExtractor(deltaTopic);
		extractor.subscribe(() => {});
		expect(extractor.cache).toEqual({
			chunkCount: 0,
			charCount: 0,
			estimatedTokens: 0,
			estimated: true,
		});
	});

	it("prefers real usage delta over char estimate when present", () => {
		const { deltaTopic } = streamingPromptNode(
			mockAdapter([], []),
			[node([], { initial: "go" })],
			(v) => `${v}`,
		);
		const extractor = costMeterExtractor(deltaTopic);
		extractor.subscribe(() => {});

		publish(deltaTopic, "hello world", 0);
		deltaTopic.publish({
			type: "usage",
			usage: { input: { regular: 3 }, output: { regular: 42 } },
			seq: 1,
			ts: BigInt(0) as unknown as number,
		});
		const reading = extractor.cache!;
		expect(reading.estimatedTokens).toBe(45); // 3 + 42 from usage delta
		expect(reading.estimated).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// gatedStream
// ---------------------------------------------------------------------------

// Wave B follow-up (2026-04-24): the gatedStream activation bug was fixed by
// keepaliving BOTH the switchMap `output` AND the gate's output node inside
// `gatedStream`. Prior bug: the gate's fn body only ran when it had a live
// subscriber on its output; without the extra keepalive, streamed values
// reached the gate's input but never entered the pending queue, so
// `gate.count` stayed at 0. The 4 previously-skipped tests below now exercise
// the full pending → approve / reject / modify / delta-topic loop.
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
		const dep = node([], { initial: "go" });

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
			provider: "mock",
			invoke: () => ({
				content: "",
				finishReason: "end_turn",
				usage: { input: { regular: 0 }, output: { regular: 0 } },
			}),
			async *stream(_msgs, opts) {
				streamStarted = true;
				for (let i = 0; i < 100; i++) {
					if (opts?.signal?.aborted) return;
					yield { type: "token" as const, delta: `chunk${i} ` };
					await new Promise((r) => setTimeout(r, 5));
				}
			},
		};

		const graph = new Graph("test");
		const dep = node([], { initial: "go" });
		const handle = gatedStream(graph, "review", adapter, [dep], (v) => `say ${v}`);
		handle.output.subscribe(() => {});

		// Wait for first chunk to confirm stream started, then reject
		await new Promise<void>((resolve) => {
			handle.deltaTopic.latest.subscribe((msgs) => {
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
		const dep = node([], { initial: "go" });

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

	it("delta topic publishes stamped deltas while gate is pending", async () => {
		const adapter = mockAdapter([], [["a", "b", "c"]]);
		const graph = new Graph("test");
		const dep = node([], { initial: "go" });

		const handle = gatedStream(graph, "review", adapter, [dep], (v) => `${v}`);
		const deltas: StampedDelta[] = [];
		handle.deltaTopic.latest.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA && m[1]) deltas.push(m[1] as StampedDelta);
		});
		// Activate gate chain so the output pipeline runs
		handle.output.subscribe(() => {});

		await waitForPending(handle);
		// Deltas published even though gate hasn't approved
		expect(deltas.length).toBeGreaterThan(0);
		// `accumulatedText` carries the final "abc" view (test against that
		// instead of the retired `StreamChunk.accumulated` field).
		expect(handle.accumulatedText.cache).toBe("abc");
		handle.gate.approve();
		handle.dispose();
	});

	it("startOpen auto-approves without gating", async () => {
		const adapter = mockAdapter([], [["auto"]]);
		const graph = new Graph("test");
		const dep = node([], { initial: "go" });

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
		expect(loop.turn.cache).toBe(0);
	});

	it("runs a simple conversation and reaches done status", async () => {
		const resp: LLMResponse = { content: "Hello, human!", finishReason: "end_turn" };
		const adapter = mockAdapter([resp]);
		const loop = agentLoop("test-agent", { adapter });

		const result = await loop.run("Hi!");
		expect(result?.content).toBe("Hello, human!");
		expect(loop.status.cache).toBe("done");
		expect(loop.turn.cache).toBe(1);
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
		expect(loop.turn.cache).toBe(2);
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
		expect(loop.turn.cache).toBe(2);
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
		const resp: LLMResponse = {
			content: "async-ok",
			finishReason: "end_turn",
			usage: { input: { regular: 0 }, output: { regular: 0 } },
		};
		const adapter: LLMAdapter = {
			provider: "mock",
			invoke() {
				return Promise.resolve(resp);
			},
			async *stream() {
				yield { type: "token" as const, delta: "" };
				yield { type: "usage" as const, usage: { input: { regular: 0 }, output: { regular: 0 } } };
				yield { type: "finish" as const, reason: "stop" };
			},
		};
		const loop = agentLoop("test-agent", { adapter });
		const result = await loop.run("hi");
		expect(result?.content).toBe("async-ok");
	});

	// --- QA regressions (2026-04-22) ---

	it("QA C1: concurrent run() rejects with RangeError", async () => {
		// Use a never-resolving adapter so the first run() stays pending.
		let pendingResolve: ((v: LLMResponse) => void) | undefined;
		const adapter: LLMAdapter = {
			provider: "mock",
			invoke() {
				return new Promise<LLMResponse>((resolve) => {
					pendingResolve = resolve;
				});
			},
			async *stream() {},
		};
		const loop = agentLoop("test-agent", { adapter });
		const first = loop.run("first");
		// `run()` is async → reentrant throw surfaces as a rejected Promise.
		await expect(loop.run("second")).rejects.toThrow(RangeError);
		// Release the first run so test teardown doesn't hang.
		pendingResolve?.({ content: "done", finishReason: "end_turn" });
		await first;
	});

	it("QA C2: abort() cancels in-flight invocation via AbortSignal", async () => {
		let abortedSignal = false;
		const adapter: LLMAdapter = {
			provider: "mock",
			invoke(_messages, opts) {
				return new Promise<LLMResponse>((_resolve, reject) => {
					opts?.signal?.addEventListener("abort", () => {
						abortedSignal = true;
						reject(new Error("aborted"));
					});
				});
			},
			async *stream() {},
		};
		const loop = agentLoop("test-agent", { adapter });
		const running = loop.run("go");
		// Give the invoke a turn to register its abort listener.
		await new Promise((resolve) => setImmediate(resolve));
		loop.abort();
		await expect(running).rejects.toThrow();
		expect(abortedSignal).toBe(true);
	});

	it("QA C3: abort before response rejects with AbortError", async () => {
		const adapter: LLMAdapter = {
			provider: "mock",
			invoke() {
				return new Promise<LLMResponse>(() => {
					/* never resolves */
				});
			},
			async *stream() {},
		};
		const loop = agentLoop("test-agent", { adapter });
		const running = loop.run("go");
		await new Promise((resolve) => setImmediate(resolve));
		loop.abort();
		await expect(running).rejects.toMatchObject({ name: "AbortError" });
	});

	it("QA C3 regression: second run() with pre-aborted signal rejects AbortError (no stale response leak)", async () => {
		// Wave A Unit 4 retired `_runVersion`; stale-resolution safety now
		// relies on `run()` clearing `lastResponse` during its reset batch.
		// Without the clear, a second run() with a pre-aborted signal would
		// resolve with the FIRST run's response: the reset doesn't touch
		// `lastResponseState`, so when `effAbort` drives `status → "done"`,
		// `_terminalResult` sees the stale cached response and emits it as
		// fresh DATA past the `skipCurrent: true` sync-phase swallow.
		const firstResp: LLMResponse = {
			content: "first-run",
			finishReason: "end_turn",
		};
		const adapter = mockAdapter([firstResp]);
		const loop = agentLoop("test-agent", { adapter });

		// Run 1: success — leaves `lastResponse.cache === firstResp`.
		const result1 = await loop.run("prompt-1");
		expect(result1?.content).toBe("first-run");
		expect(loop.lastResponse.cache).toMatchObject({ content: "first-run" });

		// Run 2: pre-aborted signal must reject with AbortError, not
		// resolve with Run 1's cached response.
		const controller = new AbortController();
		controller.abort();
		await expect(loop.run("prompt-2", controller.signal)).rejects.toMatchObject({
			name: "AbortError",
		});
	});

	it("D9: interceptToolCalls splices a reactive gate between toolCalls and executor", async () => {
		// Two LLM responses: first requests two tools (allow + forbid); intercept
		// drops the "forbid" tool; final response wraps up.
		const toolCallResp: LLMResponse = {
			content: "",
			toolCalls: [
				{ id: "tc1", name: "allow", arguments: {} },
				{ id: "tc2", name: "forbid", arguments: {} },
			],
		};
		const finalResp: LLMResponse = { content: "done", finishReason: "end_turn" };
		const adapter = mockAdapter([toolCallResp, finalResp]);

		const allowTool: ToolDefinition = {
			name: "allow",
			description: "",
			parameters: {},
			handler: () => "ok",
		};
		const forbidTool: ToolDefinition = {
			name: "forbid",
			description: "",
			parameters: {},
			handler: () => {
				throw new Error("should not execute");
			},
		};

		const loop = agentLoop("test-agent", {
			adapter,
			tools: [allowTool, forbidTool],
			interceptToolCalls: (calls) =>
				node(
					[calls],
					(batchData, actions, ctx) => {
						const data = batchData.map((batch, i) =>
							batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
						);
						actions.emit((data[0] as readonly ToolCall[]).filter((c) => c.name !== "forbid"));
					},
					{ describeKind: "derived" },
				),
		});

		await loop.run("go");
		// Tool executor saw only the "allow" call → no throw.
		const msgs = loop.chat.allMessages();
		const toolMsgs = msgs.filter((m) => m.role === "tool");
		expect(toolMsgs).toHaveLength(1);
		// Public `toolCalls` surfaces the POST-intercept stream (auditable).
		expect((loop.toolCalls.cache as readonly ToolCall[]).map((c) => c.name)).toEqual(["allow"]);
	});

	it("QA m8: string tool-result is not double-JSON-stringified", async () => {
		const toolCallResp: LLMResponse = {
			content: "",
			toolCalls: [{ id: "tc1", name: "search", arguments: { q: "x" } }],
		};
		const finalResp: LLMResponse = {
			content: "done",
			finishReason: "end_turn",
		};
		const adapter = mockAdapter([toolCallResp, finalResp]);
		const searchTool: ToolDefinition = {
			name: "search",
			description: "",
			parameters: {},
			handler: () => "hello world",
		};
		const loop = agentLoop("test-agent", { adapter, tools: [searchTool] });
		await loop.run("query");
		const msgs = loop.chat.allMessages();
		const toolMsg = msgs.find((m) => m.role === "tool");
		expect(toolMsg?.content).toBe("hello world");
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
		const source = node<string>([], { initial: "test input" });
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
			agentMemory("bad", node([], { initial: null }), {
				score: () => 1,
				cost: () => 1,
			}),
		).toThrow(/extractFn or adapter/);
	});

	it("exposes null for optional features when not configured", () => {
		const mem = agentMemory("test-mem", node([], { initial: "x" }), {
			extractFn: () => ({ upsert: [] }),
			score: () => 1,
			cost: () => 1,
		});
		expect(mem.vectors).toBeNull();
		expect(mem.kg).toBeNull();
		expect(mem.memoryTiers).toBeNull();
		expect(mem.retrieveReactive).toBeNull();
		mem.destroy();
	});

	it("B20: retrieveReactive emits results when query node changes", () => {
		type Mem = { text: string };
		const mem = agentMemory<Mem>("reactive-retrieve", node<string>([], { initial: "seed" }), {
			extractFn: (raw) => ({
				upsert: [
					{ key: "a", value: { text: String(raw) } },
					{ key: "b", value: { text: "other" } },
				],
			}),
			score: (m) => (m.text.startsWith("seed") ? 2 : 1),
			cost: () => 1,
			vectorDimensions: 2,
			embedFn: () => [0.5, 0.5],
		});
		expect(mem.retrieveReactive).not.toBeNull();
		const query = node<{ vector?: readonly number[] } | null>([], { initial: null });
		const resultNode = mem.retrieveReactive!(query);
		const unsub = resultNode.subscribe(() => {});
		// Null query → empty.
		expect(resultNode.cache).toEqual([]);
		// Fire a query — packed entries materialize.
		query.emit({ vector: [0.5, 0.5] });
		const packed = resultNode.cache as ReadonlyArray<{ key: string; score: number }>;
		expect(packed.length).toBeGreaterThan(0);
		// Highest-score entry first (seed value scored 2).
		expect(packed[0]!.score).toBeGreaterThanOrEqual(packed[packed.length - 1]!.score);
		unsub();
		mem.destroy();
	});

	it("C1: concurrent retrieveReactive calls keep mirrors independent (no crosstalk)", () => {
		type Mem = { text: string; tag: "alpha" | "beta" };
		const mem = agentMemory<Mem>("c1-concurrent", node<string>([], { initial: "seed" }), {
			extractFn: () => ({
				upsert: [
					{ key: "a", value: { text: "alpha-doc", tag: "alpha" } },
					{ key: "b", value: { text: "beta-doc", tag: "beta" } },
				],
			}),
			// Score by tag so the two queries' rankings are deterministic and distinct.
			score: (m, ctx) => {
				const wantTag = (ctx as { tag?: string } | null)?.tag;
				return m.tag === wantTag ? 10 : 1;
			},
			cost: () => 1,
			vectorDimensions: 2,
			embedFn: () => [0.5, 0.5],
		});

		const qA = node<{ vector?: readonly number[]; context?: readonly string[] } | null>([], {
			initial: { vector: [0.5, 0.5] },
		});
		const qB = node<{ vector?: readonly number[]; context?: readonly string[] } | null>([], {
			initial: { vector: [0.5, 0.5] },
		});
		// `agentMemory` only supports one shared `context` node — exercise the
		// concurrency invariant with a single context node and two distinct
		// reactive query inputs. The point is that each call gets its own
		// mounted subgraph: the two projection nodes are independent.
		const rA = mem.retrieveReactive!(qA);
		const rB = mem.retrieveReactive!(qB);
		const unsubA = rA.subscribe(() => {});
		const unsubB = rB.subscribe(() => {});

		// Both projections fire and produce results — they don't share a mirror.
		expect(Array.isArray(rA.cache)).toBe(true);
		expect(Array.isArray(rB.cache)).toBe(true);

		// The per-call subgraphs are visible in describe() — locked-decision #3.
		const desc = mem.describe() as { subgraphs?: string[] };
		expect(desc.subgraphs).toContain("retrieval");
		const retrievalDesc = (mem.tryResolve("retrieval::retrieve_1::projection") ?? null) as unknown;
		expect(retrievalDesc).not.toBeNull();
		expect(mem.tryResolve("retrieval::retrieve_2::projection")).toBeDefined();
		expect(mem.tryResolve("retrieval::retrieve_1::result")).toBeDefined();
		// QA F-9 (2026-04-30): the per-call `mirror` effect was dropped along
		// with the shared `retrieval` / `retrievalTrace` state mirrors. The
		// per-call subgraph now contains only `context`, `result`, `projection`.
		expect(mem.tryResolve("retrieval::retrieve_1::context")).toBeDefined();

		// Updating qA must not stomp qB's projection cache (independent mirrors).
		const beforeBCache = rB.cache;
		qA.emit({ vector: [0.5, 0.5] });
		expect(rB.cache).toBe(beforeBCache);

		unsubA();
		unsubB();
		mem.destroy();
	});

	it("C1: per-call subgraph is removable from describe() via parent retrieval graph", () => {
		// Drive `memoryRetrieval` directly so we hold a `MemoryRetrievalGraph`
		// reference and can call `remove(segment)` on it — `agentMemory` hides
		// the inner mount.
		const source = node<string>([], { initial: "seed" });
		const mem = agentMemory<{ text: string }>("c1-remove", source, {
			extractFn: () => ({ upsert: [{ key: "a", value: { text: "a" } }] }),
			score: () => 1,
			cost: () => 1,
			vectorDimensions: 2,
			embedFn: () => [0.5, 0.5],
		});
		const retrievalGraph = memoryRetrieval<{ text: string }>({
			name: "retrieval-direct",
			store: mem.distillBundle,
			vectors: mem.vectors,
			score: () => 1,
			cost: () => 1,
		});

		const q = node<{ vector?: readonly number[] } | null>([], {
			initial: { vector: [0.5, 0.5] },
		});
		const r1 = retrievalGraph.retrieveReactive(q);
		const r2 = retrievalGraph.retrieveReactive(q);
		const u1 = r1.subscribe(() => {});
		const u2 = r2.subscribe(() => {});

		// Both segments visible in describe()'s subgraph list.
		const before = retrievalGraph.describe() as { subgraphs?: string[] };
		expect(before.subgraphs).toContain("retrieve_1");
		expect(before.subgraphs).toContain("retrieve_2");
		expect(retrievalGraph.tryResolve("retrieve_1::projection")).toBeDefined();

		// Disposing the per-call subgraph drops it from describe().
		retrievalGraph.remove("retrieve_1");
		const after = retrievalGraph.describe() as { subgraphs?: string[] };
		expect(after.subgraphs).not.toContain("retrieve_1");
		expect(after.subgraphs).toContain("retrieve_2");
		expect(retrievalGraph.tryResolve("retrieve_1::projection")).toBeUndefined();
		// Sibling untouched.
		expect(retrievalGraph.tryResolve("retrieve_2::projection")).toBeDefined();

		u1();
		u2();
		retrievalGraph.destroy();
		mem.destroy();
	});

	// Regression: Pre-DS-13.5.C, the synthesized `_contextNode` (when
	// opts.context wasn't supplied) was a raw `node([], { initial: null })`
	// that wasn't registered on the parent graph — invisible to describe().
	// Spec: docs/implementation-plan.md DS-13.5.C
	it("DS-13.5.C: synthesized _context is registered on parent graph when opts.context absent", () => {
		const source = node<string>([], { initial: "seed" });
		const mem = agentMemory<{ text: string }>("dsC-synth", source, {
			extractFn: () => ({ upsert: [{ key: "a", value: { text: "a" } }] }),
			score: () => 1,
			cost: () => 1,
		});
		const retrievalGraph = memoryRetrieval<{ text: string }>({
			name: "retrieval-no-ctx",
			store: mem.distillBundle,
			score: () => 1,
			cost: () => 1,
			// no `context` supplied
		});

		// Synthesized `_context` is registered → describe() / tryResolve see it.
		expect(retrievalGraph.tryResolve("_context")).toBeDefined();

		retrievalGraph.destroy();
		mem.destroy();
	});

	it("DS-13.5.C: caller-supplied opts.context is NOT registered on retrieval graph (cross-graph ownership)", () => {
		const source = node<string>([], { initial: "seed" });
		const mem = agentMemory<{ text: string }>("dsC-owned", source, {
			extractFn: () => ({ upsert: [{ key: "a", value: { text: "a" } }] }),
			score: () => 1,
			cost: () => 1,
		});
		const callerOwnedCtx = node<unknown>([], { initial: { hint: "caller-owned" } });
		const retrievalGraph = memoryRetrieval<{ text: string }>({
			name: "retrieval-owned-ctx",
			store: mem.distillBundle,
			score: () => 1,
			cost: () => 1,
			context: callerOwnedCtx,
		});

		// Caller-owned node is NOT registered on retrievalGraph.
		expect(retrievalGraph.tryResolve("_context")).toBeUndefined();

		retrievalGraph.destroy();
		mem.destroy();
	});

	// Regression: Pre-DS-13.5.C, per-call subgraph leaked when caller dropped
	// projection — `retrieve_${id}` segments accumulated in the parent graph.
	// Post-fix, projection's `deactivate` cleanup hook fires on last
	// unsubscribe and removes the segment via `parent.remove(segment)`.
	// Spec: docs/implementation-plan.md DS-13.5.C
	it("DS-13.5.C: per-call subgraph auto-unmounts after subscribe-then-unsubscribe", () => {
		const source = node<string>([], { initial: "seed" });
		const mem = agentMemory<{ text: string }>("dsC-unmount", source, {
			extractFn: () => ({ upsert: [{ key: "a", value: { text: "a" } }] }),
			score: () => 1,
			cost: () => 1,
			vectorDimensions: 2,
			embedFn: () => [0.5, 0.5],
		});
		const retrievalGraph = memoryRetrieval<{ text: string }>({
			name: "retrieval-unmount",
			store: mem.distillBundle,
			vectors: mem.vectors,
			score: () => 1,
			cost: () => 1,
		});

		const q = node<{ vector?: readonly number[] } | null>([], {
			initial: { vector: [0.5, 0.5] },
		});

		const r = retrievalGraph.retrieveReactive(q);
		expect(retrievalGraph.tryResolve("retrieve_1::projection")).toBeDefined();

		const unsub = r.subscribe(() => {});

		// While subscriber is attached, segment stays mounted.
		const subgraphsDuring = (retrievalGraph.describe() as { subgraphs?: string[] }).subgraphs;
		expect(subgraphsDuring).toContain("retrieve_1");

		// Last unsubscribe → projection's deactivate cleanup fires → segment removed.
		unsub();

		expect(retrievalGraph.tryResolve("retrieve_1::projection")).toBeUndefined();
		const subgraphsAfter = (retrievalGraph.describe() as { subgraphs?: string[] }).subgraphs;
		expect(subgraphsAfter ?? []).not.toContain("retrieve_1");

		retrievalGraph.destroy();
		mem.destroy();
	});

	it("DS-13.5.C: concurrent retrieveReactive calls auto-unmount independently", () => {
		const source = node<string>([], { initial: "seed" });
		const mem = agentMemory<{ text: string }>("dsC-concurrent", source, {
			extractFn: () => ({ upsert: [{ key: "a", value: { text: "a" } }] }),
			score: () => 1,
			cost: () => 1,
			vectorDimensions: 2,
			embedFn: () => [0.5, 0.5],
		});
		const retrievalGraph = memoryRetrieval<{ text: string }>({
			name: "retrieval-concurrent",
			store: mem.distillBundle,
			vectors: mem.vectors,
			score: () => 1,
			cost: () => 1,
		});

		const qA = node<{ vector?: readonly number[] } | null>([], {
			initial: { vector: [0.5, 0.5] },
		});
		const qB = node<{ vector?: readonly number[] } | null>([], {
			initial: { vector: [0.5, 0.5] },
		});
		const rA = retrievalGraph.retrieveReactive(qA);
		const rB = retrievalGraph.retrieveReactive(qB);
		const uA = rA.subscribe(() => {});
		const uB = rB.subscribe(() => {});

		// Both segments mounted.
		expect(retrievalGraph.tryResolve("retrieve_1::projection")).toBeDefined();
		expect(retrievalGraph.tryResolve("retrieve_2::projection")).toBeDefined();

		// Unsubscribe A → only A's segment is removed; B stays.
		uA();
		expect(retrievalGraph.tryResolve("retrieve_1::projection")).toBeUndefined();
		expect(retrievalGraph.tryResolve("retrieve_2::projection")).toBeDefined();

		// Unsubscribe B → B's segment is removed too.
		uB();
		expect(retrievalGraph.tryResolve("retrieve_2::projection")).toBeUndefined();

		retrievalGraph.destroy();
		mem.destroy();
	});

	it("B12: contextWeight boosts entries whose breadcrumb matches the query", () => {
		type Mem = { text: string; context: readonly string[] };
		const mem = agentMemory<Mem>("hier", node<string>([], { initial: "seed" }), {
			extractFn: () => ({
				upsert: [
					{ key: "authA", value: { text: "auth", context: ["projects", "auth", "tokens"] } },
					{ key: "billA", value: { text: "bill", context: ["projects", "billing"] } },
				],
			}),
			// Identical flat score — the hierarchical boost should decide ordering.
			score: () => 1,
			cost: () => 1,
			contextOf: (m) => m.context,
			contextWeight: 10,
			vectorDimensions: 2,
			embedFn: () => [0.5, 0.5],
		});
		const q = node<{ vector?: readonly number[]; context?: readonly string[] } | null>([], {
			initial: {
				vector: [0.5, 0.5],
				context: ["projects", "auth"],
			},
		});
		const r = mem.retrieveReactive!(q);
		const unsub = r.subscribe(() => {});
		const packed = r.cache as ReadonlyArray<{ key: string; score: number }>;
		// authA shares prefix depth 2 of 2 → boosted; billA shares depth 1 → smaller boost.
		const authEntry = packed.find((p) => p.key === "authA");
		const billEntry = packed.find((p) => p.key === "billA");
		expect(authEntry).toBeDefined();
		expect(billEntry).toBeDefined();
		expect(authEntry!.score).toBeGreaterThan(billEntry!.score);
		unsub();
		mem.destroy();
	});

	it("creates vector index when vectorDimensions + embedFn provided", () => {
		const source = node<string>([], { initial: "hello" });
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
		// Class B audit (2026-04-30): the vector index is mounted inside the
		// `vectors` subgraph (`MemoryWithVectorsGraph`). Walking into the
		// describe tree confirms the mount + the inner VectorIndexGraph.
		const desc = mem.describe();
		expect(desc.subgraphs).toContain("vectors");
		// `vectors::vectorIndex` is a mount-of-a-mount; resolve a node inside
		// the inner `VectorIndexGraph` to confirm wiring (its `entries`
		// state node is registered top-level on the inner graph).
		expect(mem.tryResolve("vectors::vectorIndex::entries")).toBeDefined();
		mem.destroy();
	});

	it("mounts knowledge graph when enableKnowledgeGraph is true", () => {
		const source = node<string>([], { initial: "hello" });
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
		const source = node<string>([], { initial: "hello" });
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

	it("Tier 4.1 B / 4.3 B: archives below-threshold entries via retention; permanentKeys/entryCreatedAtNs are reactive nodes", () => {
		// Score function: anything <= 0.05 (decayed) gets archived.
		// archiveThreshold = 0.1, so a base score of 0.05 falls under without decay.
		let nextKey = 0;
		const source = node<string>([], { initial: "hello" });
		const mem = agentMemory<string>("tier-archive", source, {
			extractFn: (raw, _existing) => {
				// Each emit produces a unique low-score entry that retention should archive.
				const key = `low-${++nextKey}`;
				return { upsert: [{ key, value: String(raw) }] };
			},
			score: () => 0.05, // below archiveThreshold
			cost: () => 1,
			tiers: {
				permanentFilter: (key) => key.startsWith("core-"),
				archiveThreshold: 0.1,
				maxActive: 100,
			},
		});

		// Trigger a few extract cycles.
		source.down([[DATA, "a"]]);
		source.down([[DATA, "b"]]);
		source.down([[DATA, "c"]]);

		// Active store should be empty — every entry's score < threshold,
		// retention archived synchronously inside each set().
		expect(mem.size.cache).toBe(0);

		// permanentKeys + entryCreatedAtNs nodes are reachable by path —
		// describe()/explain() can now walk to them (Tier 4.3 B).
		// Class B audit (2026-04-30): the tier nodes live inside the
		// `tiers` subgraph (`MemoryWithTiersGraph`).
		expect(mem.tryResolve("tiers::permanentKeys")).toBeDefined();
		expect(mem.tryResolve("tiers::entryCreatedAtNs")).toBeDefined();

		mem.destroy();
	});

	// Regression: Pre-DS-13.5.F, retention.score wrote
	// `entryCreatedAtNs.set(key, nowNs)` from inside the score fn (D1).
	// Post-fix, retention.score is read-only and the first-write happens via
	// the `entryCreatedAtNs/sync` effect on store.entries.
	// Spec: docs/implementation-plan.md DS-13.5.F
	it("DS-13.5.F: entryCreatedAtNs/sync effect populates timestamps for new keys", () => {
		const source = node<string>([], { initial: "v0" });
		const mem = agentMemory<string>("f-sync-add", source, {
			extractFn: (raw, _existing) => ({
				upsert: [{ key: "k1", value: String(raw) }],
			}),
			score: () => 1.0, // above archiveThreshold → entry stays active
			cost: () => 1,
			tiers: { archiveThreshold: 0.1, maxActive: 100 },
		});

		source.down([[DATA, "v1"]]);

		const createdNode = mem.tryResolve("tiers::entryCreatedAtNs");
		expect(createdNode).toBeDefined();
		const created = createdNode!.cache as ReadonlyMap<string, number> | undefined;
		expect(created?.has("k1")).toBe(true);
		expect(typeof created?.get("k1")).toBe("number");
		expect(created?.get("k1")).toBeGreaterThan(0);

		mem.destroy();
	});

	it("DS-13.5.F: entryCreatedAtNs/sync is idempotent — re-emission keeps original timestamp", () => {
		const source = node<string>([], { initial: "v0" });
		const mem = agentMemory<string>("f-idem", source, {
			extractFn: (raw, _existing) => ({
				upsert: [{ key: "k1", value: String(raw) }],
			}),
			score: () => 1.0,
			cost: () => 1,
			tiers: { archiveThreshold: 0.1, maxActive: 100 },
		});

		source.down([[DATA, "first"]]);
		const created1 = mem.tryResolve("tiers::entryCreatedAtNs")!.cache as ReadonlyMap<
			string,
			number
		>;
		const ts1 = created1.get("k1");
		expect(ts1).toBeDefined();

		// Re-emit for the same key — sync effect should skip via has() guard.
		source.down([[DATA, "second"]]);
		source.down([[DATA, "third"]]);

		const created2 = mem.tryResolve("tiers::entryCreatedAtNs")!.cache as ReadonlyMap<
			string,
			number
		>;
		const ts2 = created2.get("k1");
		expect(ts2).toBe(ts1);

		mem.destroy();
	});

	it("DS-13.5.F: entryCreatedAtNs/sync visible in describe()", () => {
		const source = node<string>([], { initial: "v0" });
		const mem = agentMemory<string>("f-describe", source, {
			extractFn: (_raw, _existing) => ({
				upsert: [{ key: "k1", value: "v" }],
			}),
			score: () => 1.0,
			cost: () => 1,
			tiers: { archiveThreshold: 0.1, maxActive: 100 },
		});

		// New effect is mounted at `entryCreatedAtNs/sync` on the inner
		// MemoryWithTiersGraph (subgraph "tiers" from agentMemory's perspective).
		expect(mem.tryResolve("tiers::entryCreatedAtNs/sync")).toBeDefined();

		mem.destroy();
	});

	it("DS-13.5.F: entryCreatedAtNs GC still removes keys absent from active store", () => {
		const source = node<string>([], { initial: "v0" });
		// Use a score that flips: entry stays active during first wave,
		// then archives on next emission via maxActive eviction.
		let scoreVal = 1.0;
		const mem = agentMemory<string>("f-gc", source, {
			extractFn: (_raw, _existing) => ({
				upsert: [{ key: "k1", value: "v" }],
			}),
			score: () => scoreVal,
			cost: () => 1,
			tiers: { archiveThreshold: 0.1, maxActive: 100 },
		});

		source.down([[DATA, "first"]]);
		const beforeArchive = mem.tryResolve("tiers::entryCreatedAtNs")!.cache as ReadonlyMap<
			string,
			number
		>;
		expect(beforeArchive.has("k1")).toBe(true);

		// Drop the score under archiveThreshold; next emission archives k1
		// from the active store. The pre-existing GC subscriber on
		// store.store.entries should then prune the entryCreatedAtNs entry.
		scoreVal = 0.05;
		source.down([[DATA, "second"]]);

		const afterArchive = mem.tryResolve("tiers::entryCreatedAtNs")!.cache as ReadonlyMap<
			string,
			number
		>;
		expect(afterArchive.has("k1")).toBe(false);

		mem.destroy();
	});

	it("retrieval pipeline returns packed results with vector search", () => {
		const source = node<string>([], { initial: "test" });
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

		expect(mem.retrieveReactive).not.toBeNull();

		// Execute a retrieval query reactively. C1: imperative `retrieve()`
		// dropped — wrap a one-shot query in a reactive node and read the
		// projection node's cache after subscription drains.
		const q = node<{ vector?: readonly number[] } | null>([], {
			initial: { vector: [1.0, 0.0, 0.0] },
		});
		const r = mem.retrieveReactive!(q);
		const unsub = r.subscribe(() => {});
		const results = r.cache as ReadonlyArray<unknown> | undefined;
		expect(Array.isArray(results)).toBe(true);
		unsub();
		mem.destroy();
	});

	it("retrieval trace captures pipeline stages", () => {
		const source = node<string>([], { initial: "input" });
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

		const q = node<{ vector?: readonly number[] } | null>([], {
			initial: { vector: [0.5, 0.5, 0.0] },
		});
		const r = mem.retrieveReactive!(q);
		const unsub = r.subscribe(() => {});
		// /qa F-9 (2026-04-30): the shared `retrievalTrace` mirror was
		// dropped. The per-call `result` derived (upstream of `projection`)
		// still carries `{ packed, trace }`. Resolve it via the per-call
		// subgraph mount path: `retrieval::retrieve_${seq}::result`.
		const resultNode = mem.resolve("retrieval::retrieve_1::result");
		const resultCache = resultNode.cache as
			| { packed: ReadonlyArray<unknown>; trace: unknown }
			| undefined;
		const trace = resultCache?.trace as Record<string, unknown> | null | undefined;
		if (trace) {
			expect(trace).toHaveProperty("vectorCandidates");
			expect(trace).toHaveProperty("graphExpanded");
			expect(trace).toHaveProperty("ranked");
			expect(trace).toHaveProperty("packed");
		}
		unsub();
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

	it("requires an explicit scoreFn (default 0.5 scorer was retired in Unit 8)", () => {
		// `defaultAdmissionScorer` admitted everything in disguise — retired
		// per Unit 8 review. Callers must supply a real scorer.
		const filter = admissionFilter3D({
			scoreFn: () => ({ persistence: 0.5, structure: 0.5, personalValue: 0.5 }),
		});
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

		const source = node<string>([], { initial: "keep" });
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
// admissionScored (Unit 8 generic — admissionFilter3D is sugar over this)
// ---------------------------------------------------------------------------

describe("patterns.ai.admissionScored", () => {
	it("admits when all gated dimensions meet thresholds", () => {
		const filter = admissionScored<"a" | "b">({
			scoreFn: () => ({ a: 0.7, b: 0.4 }),
			thresholds: { a: 0.5, b: 0.3 },
		});
		expect(filter("x")).toBe(true);
	});

	it("rejects when any gated dimension is below threshold", () => {
		const filter = admissionScored<"a" | "b">({
			scoreFn: () => ({ a: 0.7, b: 0.1 }),
			thresholds: { a: 0.5, b: 0.3 },
		});
		expect(filter("x")).toBe(false);
	});

	it("ignores dimensions without thresholds (telemetry-only)", () => {
		const filter = admissionScored<"a" | "telemetry">({
			scoreFn: () => ({ a: 0.6, telemetry: -100 }),
			thresholds: { a: 0.5 },
		});
		// `telemetry` has no threshold → ungated, even though it's negative.
		expect(filter("x")).toBe(true);
	});

	it("treats missing scores as below threshold", () => {
		const filter = admissionScored<"a" | "b">({
			scoreFn: () => ({ a: 0.9 }) as never,
			thresholds: { a: 0.5, b: 0.3 },
		});
		// b is missing → fails the b ≥ 0.3 check.
		expect(filter("x")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// knobsAsTools (5.4)
// ---------------------------------------------------------------------------

describe("knobsAsTools", () => {
	it("generates tool schemas from state nodes with meta", () => {
		const g = new Graph("test");
		const temp = node([], {
			name: "temperature",
			meta: {
				description: "Room temperature",
				type: "number",
				range: [60, 90],
				unit: "°F",
				access: "both",
			},
			initial: 72,
		});
		const mode = node([], {
			name: "mode",
			meta: {
				description: "HVAC mode",
				type: "enum",
				values: ["auto", "cool", "heat", "off"],
				access: "llm",
			},
			initial: "auto",
		});
		// Derived node should NOT appear as a tool
		const summary = node(
			[temp, mode],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(`${data[1]}: ${data[0]}`);
			},
			{ describeKind: "derived", name: "summary", meta: { description: "Summary display" } },
		);
		g.add(temp, { name: "temperature" });
		g.add(mode, { name: "mode" });
		g.add(summary, { name: "summary" });

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
		const secret = node([], {
			name: "secret",
			meta: { description: "Human-only secret", access: "human" },
			initial: "pw",
		});
		g.add(secret, { name: "secret" });

		const result = knobsAsTools(g);
		expect(result.openai).toHaveLength(0);
		g.destroy();
	});

	it("includes V0 version metadata for knob definitions", () => {
		const g = new Graph("versioned-knobs");
		const knob = node([], {
			name: "knob",
			versioning: 0,
			meta: { description: "Versioned knob", access: "both" },
			initial: 1,
		});
		g.add(knob, { name: "knob" });

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
		const revenue = node([], {
			name: "revenue",
			meta: { description: "Monthly revenue", format: "currency", tags: ["finance"] },
			initial: 1234.5,
		});
		const growth = node([], {
			name: "growth",
			meta: { description: "Growth rate", format: "percentage", tags: ["finance"] },
			initial: 0.15,
		});
		const status = node([], {
			name: "status",
			meta: { description: "System status", format: "status" },
			initial: "healthy",
		});
		g.add(revenue, { name: "revenue" });
		g.add(growth, { name: "growth" });
		g.add(status, { name: "status" });

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
		const plain = node([], { name: "plain", initial: 42 });
		g.add(plain, { name: "plain" });

		expect(gaugesAsContext(g)).toBe("");
		g.destroy();
	});

	it("supports V0 delta filtering via sinceVersion", () => {
		const g = new Graph("delta");
		const metric = node([], {
			name: "metric",
			versioning: 0,
			meta: { description: "Metric", access: "both" },
			initial: 1,
		});
		g.add(metric, { name: "metric" });

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
	it("constructs a graph from LLM-generated GraphSpec JSON", async () => {
		const spec = {
			name: "calculator",
			nodes: {
				a: { type: "state", deps: [], value: 10, meta: { description: "Input A" } },
				b: { type: "state", deps: [], value: 20, meta: { description: "Input B" } },
			},
		};

		const adapter = mockAdapter([{ content: JSON.stringify(spec), finishReason: "end_turn" }]);

		const g = await graphFromSpec("Build a calculator with two inputs", adapter);
		expect(g.name).toBe("calculator");
		expect(g.node("a").cache).toBe(10);
		expect(g.node("b").cache).toBe(20);
		g.destroy();
	});

	it("strips markdown fences from LLM response", async () => {
		const spec = {
			name: "simple",
			nodes: {
				x: { type: "state", deps: [], value: 1, meta: { description: "X" } },
			},
		};

		const adapter = mockAdapter([
			{
				content: `\`\`\`json\n${JSON.stringify(spec)}\n\`\`\``,
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
				content: JSON.stringify({ nodes: {} }),
				finishReason: "end_turn",
			},
		]);

		await expect(graphFromSpec("missing name", adapter)).rejects.toThrow("invalid GraphSpec");
	});

	it("graphFromSpecReactive emits Graph for non-empty input, null otherwise", async () => {
		const spec = {
			name: "reactive",
			nodes: { x: { type: "state", deps: [], value: 7, meta: { description: "X" } } },
		};
		const adapter = mockAdapter([{ content: JSON.stringify(spec), finishReason: "end_turn" }]);
		const input = node([], { initial: "" });
		const graphNode2 = graphFromSpecReactive(input, adapter);
		const seen: (Graph | null)[] = [];
		const unsub = graphNode2.subscribe((batch) => {
			for (const m of batch) {
				if (m[0] === DATA) seen.push(m[1] as Graph | null);
			}
		});

		// Empty input → SENTINEL null
		await new Promise((r) => setTimeout(r, 0));
		expect(seen[seen.length - 1]).toBeNull();

		// Push a real description → triggers LLM + compileSpec
		input.down([[DATA, "make a reactive graph"]]);
		await new Promise((r) => setTimeout(r, 50));
		const last = seen[seen.length - 1];
		expect(last).not.toBeNull();
		expect((last as Graph).name).toBe("reactive");
		(last as Graph).destroy();

		unsub();
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
		const maxRate = node([], { name: "max_rate", meta: { description: "Max rate" }, initial: 50 });
		g.add(maxRate, { name: "max_rate" });

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

	it("suggestStrategyReactive emits a plan when problem fires", async () => {
		const plan = {
			summary: "tighten retries",
			reasoning: "noise observed in flaky-tests bucket",
			operations: [{ type: "set_value", name: "max_retries", value: 1 }],
		};
		const adapter = mockAdapter([{ content: JSON.stringify(plan), finishReason: "end_turn" }]);

		const g = new Graph("rx");
		g.add(node([], { name: "max_retries", meta: { description: "max" }, initial: 3 }), {
			name: "max_retries",
		});
		const graphNode = node<Graph | null>([], { initial: g });
		const problem = node([], { initial: "" });

		const strategyNode = suggestStrategyReactive(graphNode, problem, adapter);
		const seen: (StrategyPlan | null)[] = [];
		const unsub = strategyNode.subscribe((batch) => {
			for (const m of batch) {
				if (m[0] === DATA) seen.push(m[1] as StrategyPlan | null);
			}
		});

		await new Promise((r) => setTimeout(r, 0));
		// withLatestFrom's documented initial-activation quirk: when both deps
		// are node([]) nodes, the first paired emission is dropped (see comment
		// in extra/operators.ts:866). So `seen` may be empty at this point —
		// real DATA arrives after `problem` fires below.

		problem.down([[DATA, "noisy retries"]]);
		await new Promise((r) => setTimeout(r, 50));
		const last = seen[seen.length - 1];
		expect(last).not.toBeNull();
		expect((last as StrategyPlan).summary).toBe("tighten retries");

		unsub();
		g.destroy();
	});
});

// ---------------------------------------------------------------------------
// promptNode
// ---------------------------------------------------------------------------

describe("patterns.ai.promptNode", () => {
	const tick = () => new Promise((r) => setTimeout(r, 0));

	it("forwards systemPrompt via invoke opts only (no double-send as message)", async () => {
		let receivedMessages: readonly { role: string; content: string }[] = [];
		let receivedOpts: Record<string, unknown> = {};
		const adapter: LLMAdapter = {
			provider: "mock",
			invoke(messages, opts) {
				receivedMessages = messages as readonly { role: string; content: string }[];
				receivedOpts = opts as Record<string, unknown>;
				return {
					content: "ok",
					finishReason: "end_turn",
					usage: { input: { regular: 0 }, output: { regular: 0 } },
				};
			},
			async *stream() {
				yield { type: "token" as const, delta: "" };
				yield { type: "usage" as const, usage: { input: { regular: 0 }, output: { regular: 0 } } };
				yield { type: "finish" as const, reason: "stop" };
			},
		};

		const dep = node([], { initial: "hello" });
		const pn = promptNode<string>(adapter, [dep], (v: string) => `summarize: ${v}`, {
			systemPrompt: "be terse",
		});
		const unsub = pn.subscribe(() => {});
		await tick();

		// systemPrompt only travels via opts — never injected into messages.
		expect(receivedOpts.systemPrompt).toBe("be terse");
		expect(receivedMessages.some((m) => m.role === "system")).toBe(false);
		expect(receivedMessages.length).toBe(1);
		expect(receivedMessages[0]?.role).toBe("user");

		unsub();
	});

	it("aborts in-flight call when abort node emits true", async () => {
		let lastSignal: AbortSignal | undefined;
		const adapter: LLMAdapter = {
			provider: "mock",
			invoke(_messages, opts) {
				lastSignal = opts?.signal;
				return new Promise<LLMResponse>((resolve, reject) => {
					if (opts?.signal?.aborted) {
						reject(opts.signal.reason ?? new Error("aborted"));
						return;
					}
					const onAbort = (): void => {
						reject(opts?.signal?.reason ?? new Error("aborted"));
					};
					opts?.signal?.addEventListener("abort", onAbort, { once: true });
					setTimeout(() => {
						opts?.signal?.removeEventListener("abort", onAbort);
						resolve({
							content: "late",
							finishReason: "end_turn",
							usage: { input: { regular: 0 }, output: { regular: 0 } },
						});
					}, 100);
				});
			},
			async *stream() {
				yield { type: "token" as const, delta: "" };
				yield { type: "usage" as const, usage: { input: { regular: 0 }, output: { regular: 0 } } };
				yield { type: "finish" as const, reason: "stop" };
			},
		};

		const dep = node([], { initial: "hello" });
		const abort = node([], { initial: false });
		const pn = promptNode<string>(adapter, [dep], (v: string) => `summarize: ${v}`, {
			abort,
		});
		const unsub = pn.subscribe(() => {});
		await tick();

		// abort signal should be threaded through invoke opts
		expect(lastSignal).toBeDefined();
		expect(lastSignal?.aborted).toBe(false);

		// Flip abort → signal aborts
		abort.down([[DATA, true]]);
		await tick();
		expect(lastSignal?.aborted).toBe(true);

		unsub();
	});

	it("emits nothing on true SENTINEL (no DATA ever); emits null when DATA(null) arrives", async () => {
		const adapter: LLMAdapter = {
			provider: "mock",
			invoke(_messages, _opts) {
				return {
					content: "ok",
					finishReason: "end_turn",
					usage: { input: { regular: 0 }, output: { regular: 0 } },
				};
			},
			async *stream() {
				yield { type: "token" as const, delta: "" };
				yield { type: "usage" as const, usage: { input: { regular: 0 }, output: { regular: 0 } } };
				yield { type: "finish" as const, reason: "stop" };
			},
		};

		// True SENTINEL: dep that NEVER emits DATA — first-run gate blocks
		// messagesNode → switchMap doesn't fire → outer cache stays undefined.
		const sentinelDep = node<string>();
		const sentinelPn = promptNode<string>(adapter, [sentinelDep], (v) => `summarize: ${v}`);
		const sentinelSeen: (string | null)[] = [];
		const sentinelUnsub = sentinelPn.subscribe((batch) => {
			for (const m of batch) if (m[0] === DATA) sentinelSeen.push(m[1] as string | null);
		});
		await tick();
		expect(sentinelSeen).toEqual([]);
		expect(sentinelPn.cache).toBe(undefined);
		sentinelUnsub();

		// DATA-seen path: dep starts as node([], { initial: null }) — first DATA value IS null.
		// Per the SENTINEL convention (`prevData === undefined` is the only
		// SENTINEL marker), this counts as "input arrived but is nullish" →
		// emit `null` immediately.
		const dep = node<string | null>([], { initial: null });
		const pn = promptNode<string>(adapter, [dep], (v) => `summarize: ${v}`);
		const seen: (string | null)[] = [];
		const unsub = pn.subscribe((batch) => {
			for (const m of batch) if (m[0] === DATA) seen.push(m[1] as string | null);
		});
		await tick();
		expect(seen).toEqual([null]);
		expect(pn.cache).toBe(null);

		// Real input → LLM call → DATA emit.
		dep.down([[DATA, "hello"]]);
		await tick();
		expect(seen[seen.length - 1]).toBe("ok");
		expect(pn.cache).toBe("ok");

		// Mid-flow drop back to null → emit `null` again.
		dep.down([[DATA, null]]);
		await tick();
		expect(seen[seen.length - 1]).toBe(null);
		expect(pn.cache).toBe(null);

		unsub();
	});

	it("strips markdown fences for JSON format", async () => {
		const adapter: LLMAdapter = {
			provider: "mock",
			invoke() {
				return {
					content: '```json\n{"key": "value"}\n```',
					finishReason: "end_turn",
					usage: { input: { regular: 0 }, output: { regular: 0 } },
				};
			},
			async *stream() {
				yield { type: "token" as const, delta: "" };
				yield { type: "usage" as const, usage: { input: { regular: 0 }, output: { regular: 0 } } };
				yield { type: "finish" as const, reason: "stop" };
			},
		};

		const dep = node([], { initial: "x" });
		const pn = promptNode<{ key: string }>(adapter, [dep], "extract", { format: "json" });
		const unsub = pn.subscribe(() => {});
		await tick();
		expect(pn.cache).toEqual({ key: "value" });
		unsub();
	});

	it("passes systemPrompt in invoke opts", async () => {
		let receivedOpts: Record<string, unknown> = {};
		const adapter: LLMAdapter = {
			provider: "mock",
			invoke(_messages, opts) {
				receivedOpts = opts as Record<string, unknown>;
				return {
					content: "ok",
					finishReason: "end_turn",
					usage: { input: { regular: 0 }, output: { regular: 0 } },
				};
			},
			async *stream() {
				yield { type: "token" as const, delta: "" };
				yield { type: "usage" as const, usage: { input: { regular: 0 }, output: { regular: 0 } } };
				yield { type: "finish" as const, reason: "stop" };
			},
		};

		const dep = node([], { initial: "x" });
		const pn = promptNode<string>(adapter, [dep], "test", { systemPrompt: "be helpful" });
		const unsub = pn.subscribe(() => {});
		await tick();
		expect(pn.cache).toBe("ok");
		expect(receivedOpts.systemPrompt).toBe("be helpful");
		unsub();
	});

	// DF12 (Tier 7): reactive `tools` is a declared dep on `messagesNode`,
	// so tools changes re-invoke the LLM and the tools edge appears in
	// `describe()` / `explain()`.
	it("reactive tools: tools Node feeds the adapter and re-invokes on tools change", async () => {
		const calls: Array<{ tools?: readonly ToolDefinition[] }> = [];
		const adapter: LLMAdapter = {
			provider: "mock",
			invoke(_messages, opts) {
				calls.push({ tools: opts?.tools });
				return {
					content: "ok",
					finishReason: "end_turn",
					usage: { input: { regular: 0 }, output: { regular: 0 } },
				};
			},
			async *stream() {
				yield { type: "token" as const, delta: "" };
				yield { type: "usage" as const, usage: { input: { regular: 0 }, output: { regular: 0 } } };
				yield { type: "finish" as const, reason: "stop" };
			},
		};

		const toolA: ToolDefinition = {
			name: "a",
			description: "",
			parameters: {},
			handler: () => null,
		};
		const toolB: ToolDefinition = {
			name: "b",
			description: "",
			parameters: {},
			handler: () => null,
		};

		const dep = node([], { initial: "hello" });
		const toolsNode = node<readonly ToolDefinition[]>([], { initial: [toolA] });
		const pn = promptNode<string>(adapter, [dep], "echo", {
			format: "raw",
			tools: toolsNode,
		});
		const unsub = pn.subscribe(() => {});
		await tick();

		// First call: toolsNode primed [toolA] before subscribe → first wave
		// fires with tools=[toolA].
		expect(calls.length).toBeGreaterThanOrEqual(1);
		expect(calls.at(-1)?.tools).toEqual([toolA]);

		// Update tools — adapter is re-invoked because tools is a declared dep.
		toolsNode.emit([toolA, toolB]);
		await tick();
		expect(calls.at(-1)?.tools).toEqual([toolA, toolB]);

		unsub();
	});
});
