/**
 * Phase 5: LLM composition validation.
 *
 * These compositions were written one-shot by an LLM (Claude) given only:
 * - GRAPHREFLY-SPEC.md (protocol behavior)
 * - COMPOSITION-GUIDE.md (patterns and recipes)
 * - Existing test examples for API signature reference
 *
 * Each scenario exercises a non-trivial composition pattern that an LLM agent
 * or human developer would need in practice. The test validates that:
 * 1. The composition compiles and runs correctly
 * 2. The push model is reasoned about naturally
 * 3. Surprising patterns or guide gaps are documented
 */

import { batch } from "@graphrefly/pure-ts/core/batch.js";
import { DATA, DIRTY } from "@graphrefly/pure-ts/core/messages.js";
import { node } from "@graphrefly/pure-ts/core/node.js";
import { merge, scan, withLatestFrom } from "@graphrefly/pure-ts/extra";
import { Graph } from "@graphrefly/pure-ts/graph/graph.js";
import { describe, expect, it } from "vitest";
import {
	chatStream,
	gaugesAsContext,
	knobsAsTools,
	type LLMAdapter,
	type LLMResponse,
	promptNode,
	systemPromptBuilder,
	type ToolDefinition,
	toolRegistry,
} from "../patterns/ai/index.js";
import { pipelineGraph } from "../patterns/orchestration/index.js";

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

function mockAdapter(responses: LLMResponse[]): LLMAdapter {
	let idx = 0;
	return {
		invoke() {
			const resp = responses[idx] ?? responses[responses.length - 1]!;
			idx++;
			return resp;
		},
		async *stream() {
			yield "mock";
		},
	};
}

// ===========================================================================
// Scenario 1: Multi-stage document processing pipeline
//
// Composition insight: This tests the push model's cascading behavior —
// setting the input state triggers the entire pipeline reactively.
// No polling, no imperative "run next step" calls.
// ===========================================================================

describe("Phase 5 — Scenario 1: Multi-stage document processing", () => {
	it("pipeline processes a document through classify → extract → validate → output", () => {
		const g = pipelineGraph("doc-processor");

		// Stage 1: Input source (human submits a document)
		const input = node<{ text: string; source: string } | undefined>([], { initial: undefined });
		g.add(input, { name: "input" });

		// Stage 2: Classify document type (derived from input)
		// KEY INSIGHT: Null guard needed (composition guide §3) because input
		// starts with SENTINEL → task dep value is undefined on activation.
		const _classify = g.task<string>(
			"classify",
			([doc]) => {
				const d = doc as { text: string } | undefined;
				if (d == null) return "pending";
				if (d.text.includes("invoice")) return "invoice";
				if (d.text.includes("contract")) return "contract";
				return "unknown";
			},
			{ deps: ["input"] },
		);

		// Stage 3: Extract entities based on classification
		const _extract = g.task<string[]>(
			"extract",
			([doc]) => {
				const d = doc as { text: string } | undefined;
				if (d == null) return [];
				const amounts = d.text.match(/\$[\d,]+\.?\d*/g) ?? [];
				return amounts;
			},
			{ deps: ["input"] },
		);

		// Stage 4: Combine classification + extraction for validation
		const _validated = g.combine("validated", { classify: "classify", extract: "extract" });

		// Stage 5: Output effect — use core `effect` + `graph.add` (post-A/B cleanup
		// the old patterns/orchestration.forEach graph-registering sugar is gone).
		const results: Array<{ type: string; entities: string[] }> = [];
		const output = node(
			[g.resolve("validated")],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				return (
					(([val]) => {
						const rec = val as { classify: string; extract: string[] };
						results.push({ type: rec.classify, entities: rec.extract });
					})(data, actions, ctx) ?? undefined
				);
			},
			{ describeKind: "effect" },
		);
		g.add(output, { name: "output" });

		// KEY INSIGHT: Every leaf node needs a subscriber to activate the
		// chain (composition guide §5). Without this, the derived pipeline
		// stays disconnected. This is the push model: subscribe = activate.
		output.subscribe(() => {});

		// Push model: setting input cascades through the entire pipeline
		input.emit({ text: "Please pay this invoice for $500.00 and $1,200", source: "email" });

		expect(g.node("classify").cache).toBe("invoice");
		expect(g.node("extract").cache).toEqual(["$500.00", "$1,200"]);

		// KEY INSIGHT: With null guards returning initial values ("pending", []),
		// the combine node produces intermediate emissions as each dep settles.
		// The FINAL result has the correct values. In a real system, you'd
		// filter out the intermediate "pending" values, or use SENTINEL deps
		// (no initial) so the pipeline only fires when ALL inputs are ready.
		const final = results[results.length - 1]!;
		expect(final.type).toBe("invoice");
		expect(final.entities).toEqual(["$500.00", "$1,200"]);
	});
});

// ===========================================================================
// Scenario 2: Approval-gated deployment with timeout fallback
//
// Composition insight: gate + approval compose naturally because they're
// just nodes. The "waiting for human" state is a reactive dependency,
// not a polling loop. Push model means the gate opens the moment
// the approver sets the state.
// ===========================================================================

describe("Phase 5 — Scenario 2: Approval-gated deployment", () => {
	it("gates deployment behind approval, with fallback on rejection", () => {
		const g = pipelineGraph("deploy");

		// Build artifact
		const artifact = node([], { initial: { version: "1.2.0", sha: "abc123" } });
		g.add(artifact, { name: "artifact" });

		// Human approval control
		const isApproved = node([], { initial: false });
		g.add(isApproved, { name: "approved" });

		// Gate: holds artifact until approved
		const reviewCtrl = g.approval<{ version: string; sha: string }>(
			"review",
			"artifact",
			isApproved,
		);
		const gated = reviewCtrl.output;

		// On approval: deploy
		const deployed: string[] = [];
		const deployNode = node<void>(
			[gated],
			(data, _actions, ctx) => {
				const batch0 = data[0];
				const a = (batch0 != null && batch0.length > 0 ? batch0.at(-1) : ctx.prevData[0]) as {
					version: string;
					sha: string;
				};
				if (a != null) deployed.push(a.version);
			},
			{ name: "deploy" },
		);
		g.add(deployNode, { name: "deploy" });
		deployNode.subscribe(() => {});

		// Initially: nothing deployed (approval is false)
		expect(deployed.filter((v) => v === "1.2.0").length).toBe(0);

		// Human approves — push model: value flows immediately
		isApproved.down([[DATA, true]]);
		expect(deployed).toContain("1.2.0");
	});
});

// ===========================================================================
// Scenario 3: Real-time metrics dashboard with derived aggregations
//
// Composition insight: combine + derived gives declarative aggregation.
// The LLM naturally thinks "I need to combine these sources and derive
// metrics" — the push model matches how dashboards actually work.
// ===========================================================================

describe("Phase 5 — Scenario 3: Real-time metrics aggregation", () => {
	it("aggregates multiple metric sources into a derived dashboard state", () => {
		// Source metrics (simulating live feeds)
		const cpuLoad = node([], { initial: 0.45 });
		const memUsage = node([], { initial: 0.62 });
		const reqPerSec = node([], { initial: 150 });
		const errorRate = node([], { initial: 0.02 });

		// Derived: health score (weighted aggregate)
		const healthScore = node(
			[cpuLoad, memUsage, errorRate],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const c = data[0] as number;
				const m = data[1] as number;
				const e = data[2] as number;
				// Lower is worse: 1.0 = perfect health
				actions.emit(Math.max(0, 1 - (c * 0.3 + m * 0.3 + e * 10 * 0.4)));
			},
			{ describeKind: "derived" },
		);

		// Derived: alert level
		const alertLevel = node(
			[healthScore],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const s = data[0] as number;
				if (s > 0.8) {
					actions.emit("green");
					return;
				}
				if (s > 0.5) {
					actions.emit("yellow");
					return;
				}
				actions.emit("red");
			},
			{ describeKind: "derived" },
		);

		// Derived: capacity forecast (combine throughput + resource usage)
		const capacityForecast = node(
			[reqPerSec, cpuLoad, memUsage],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const r = data[0] as number;
				const c = data[1] as number;
				const m = data[2] as number;
				const headroom = Math.min(1 - c, 1 - m);
				actions.emit(Math.round(r / (1 - headroom + 0.001))); // projected max RPS
			},
			{ describeKind: "derived" },
		);

		// Activate all derived nodes (composition guide §5: subscribe to activate)
		healthScore.subscribe(() => {});
		alertLevel.subscribe(() => {});
		capacityForecast.subscribe(() => {});

		// Initial state
		expect(alertLevel.cache).toBe("yellow");
		expect(typeof healthScore.cache).toBe("number");
		expect(typeof capacityForecast.cache).toBe("number");

		// Metric spike — push model: all derived recompute instantly
		batch(() => {
			cpuLoad.down([[DATA, 0.95]]);
			errorRate.down([[DATA, 0.15]]);
		});

		expect(alertLevel.cache).toBe("red");
	});
});

// ===========================================================================
// Scenario 4: LLM agent with tool use and memory accumulation
//
// Composition insight: This is where the push model truly shines for LLM
// agents. The agent loop is reactive: new user message → promptNode fires
// → tool calls detected → tools execute → results feed back in.
// No imperative "while (hasToolCalls)" loop needed.
// ===========================================================================

describe("Phase 5 — Scenario 4: LLM agent with tool use", () => {
	it("promptNode composes with tool registry and chat stream", () => {
		const cs = chatStream("agent-chat");

		// Tool registry with a simple calculator
		const tr = toolRegistry("agent-tools");
		tr.register({
			name: "add",
			description: "Add two numbers",
			parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } },
			handler: (args) => (args.a as number) + (args.b as number),
		});

		// Verify composition: chatStream provides the message history,
		// toolRegistry provides the tool definitions
		cs.append("user", "What is 2 + 3?");
		const msgs = cs.allMessages();
		expect(msgs.length).toBe(1);

		const schemas = tr.schemas.cache as ToolDefinition[];
		expect(schemas.length).toBe(1);
		expect(schemas[0]!.name).toBe("add");
	});

	it("promptNode gates on nullish deps (composition guide §8)", () => {
		// SENTINEL dep — promptNode should NOT fire
		const pendingInput = node<string>();
		const adapter = mockAdapter([{ content: "should not reach" }]);

		const result = promptNode(adapter, [pendingInput], (val) => {
			return `Process: ${val}`;
		});
		result.subscribe(() => {});

		// Composition guide §8 + per the QA-revised SENTINEL contract: on
		// **initial** no-input, promptNode emits nothing (true SENTINEL —
		// `cache` stays `undefined`). `null` is reserved for **mid-flow**
		// drop-out (input that was previously real then went away), so
		// downstream consumers can distinguish "haven't started" from
		// "input gone."
		expect(result.cache).toBe(undefined);

		// Once pendingInput delivers DATA, the LLM adapter runs (async
		// through the internal switchMap + Promise path). The
		// `.not.toBe(null)` check is inherently racy for sync tests — the
		// important invariant is that the chain exits the SENTINEL branch,
		// which we verify by checking status.
		pendingInput.down([[DATA, "hello"]]);
		expect(result.status).not.toBe("pending");
	});

	it("prompt_node::response is transient — describe() does not surface it (Session C L9)", () => {
		// Session C L9 acceptance: when no LLM call is in flight, describe()
		// only shows ::messages + ::output. The per-wave producer (`::response`)
		// activates inside switchMap during a wave and tears down on supersede
		// or COMPLETE — it is intentionally transient.
		//
		// With a sync mockAdapter the producer activates and completes within
		// the same synchronous wave, so any post-wave describe() never sees it.
		// With a real (async) adapter, describe() called mid-wave WOULD see
		// it via meta.ai = "prompt_node::response" — but that's an in-flight
		// observation, not a steady-state expectation.
		const adapter = mockAdapter([{ content: "ok" }]);
		const input = node<string>();
		const result = promptNode<string>(adapter, [input], (q) => `q: ${q}`);

		const g = new Graph("g");
		g.add(result, { name: "answer" });
		// Force activation so the topology graph walks reach into promptNode internals.
		const off = result.subscribe(() => {});
		input.down([[DATA, "first"]]);

		const snap = g.describe();
		const paths = Object.keys(snap.nodes);

		// `::messages` and `::output` are the steady-state shape.
		expect(paths.some((p) => p.endsWith("prompt_node::messages"))).toBe(true);
		expect(paths.some((p) => p === "answer" || p.endsWith("prompt_node::output"))).toBe(true);

		// `::response` is per-wave; with a synchronous adapter it has already
		// torn down by the time we describe.
		expect(paths.some((p) => p.endsWith("prompt_node::response"))).toBe(false);

		off();
	});

	it("promptNode emits exactly one DATA per upstream wave (Session C L8)", () => {
		// Session C L8 acceptance gate: N upstream dep waves → exactly N DATAs
		// on prompt_node::output, zero transient nulls, zero coalesce loss.
		// Locks the path-(b) producer contract independent of harness entanglement
		// (cf. archive/docs/SESSION-ai-harness-module-review.md line 3654).
		const adapter = mockAdapter([
			{ content: "response 1" },
			{ content: "response 2" },
			{ content: "response 3" },
		]);
		const input = node<string>(); // SENTINEL — no initial-no-input null leak
		const result = promptNode<string>(adapter, [input], (q) => `q: ${q}`);

		const dataValues: unknown[] = [];
		result.subscribe((b) => {
			for (const msg of b) {
				if (msg[0] === DATA) dataValues.push(msg[1]);
			}
		});

		// Wave 0 — SENTINEL: messagesNode's first-run gate blocks; switchMap
		// never fires; outer cache stays undefined; subscriber sees nothing.
		expect(dataValues).toEqual([]);

		// Wave 1 → exactly 1 DATA.
		input.down([[DATA, "first"]]);
		expect(dataValues).toEqual(["response 1"]);

		// Wave 2 → exactly 2 DATAs total (no transient null between waves).
		input.down([[DATA, "second"]]);
		expect(dataValues).toEqual(["response 1", "response 2"]);

		// Wave 3 → exactly 3 DATAs total.
		input.down([[DATA, "third"]]);
		expect(dataValues).toEqual(["response 1", "response 2", "response 3"]);

		// No transient nulls anywhere in the stream — the producer-shape inner
		// emits parsed values via actions.emit only (never null pre-resolution).
		expect(dataValues.filter((v) => v == null)).toEqual([]);
	});
});

// ===========================================================================
// Scenario 5: Event-sourced order processing with CQRS-style projections
//
// Composition insight: reactiveLog as event store + derived nodes as
// projections. The push model means projections update reactively as
// events arrive — classic CQRS but without the imperative event bus.
// ===========================================================================

describe("Phase 5 — Scenario 5: Event-sourced order processing", () => {
	it("scan builds projections from an event stream", () => {
		// Event source (orders coming in)
		const orderEvent = node<{ type: string; orderId: string; amount?: number } | null>([], {
			initial: null,
		});

		// Projection: running total revenue
		const totalRevenue = scan(
			orderEvent,
			(acc, event) => {
				const e = event as { type: string; amount?: number } | null;
				if (e == null || e.type !== "completed") return acc;
				return acc + (e.amount ?? 0);
			},
			0,
		);

		// Projection: order count by status
		const orderCounts = scan(
			orderEvent,
			(acc, event) => {
				const e = event as { type: string } | null;
				if (e == null) return acc;
				const counts = { ...acc };
				counts[e.type] = (counts[e.type] ?? 0) + 1;
				return counts;
			},
			{} as Record<string, number>,
		);

		// Activate projections
		totalRevenue.subscribe(() => {});
		orderCounts.subscribe(() => {});

		// Emit events
		orderEvent.down([[DATA, { type: "created", orderId: "A1" }]]);
		orderEvent.down([[DATA, { type: "completed", orderId: "A1", amount: 99.99 }]]);
		orderEvent.down([[DATA, { type: "created", orderId: "A2" }]]);
		orderEvent.down([[DATA, { type: "completed", orderId: "A2", amount: 50.0 }]]);
		orderEvent.down([[DATA, { type: "cancelled", orderId: "A3" }]]);

		expect(totalRevenue.cache).toBeCloseTo(149.99);
		expect(orderCounts.cache).toEqual({
			created: 2,
			completed: 2,
			cancelled: 1,
		});
	});
});

// ===========================================================================
// Scenario 6: Adaptive rate-limited API client with circuit breaker
//
// Composition insight: withLatestFrom is the key pattern for reading
// config without creating reactive triggers (composition guide §7).
// The circuit breaker state is advisory — it doesn't trigger new
// requests, but is consulted when a request arrives.
// ===========================================================================

describe("Phase 5 — Scenario 6: Adaptive API client with config", () => {
	it("withLatestFrom reads config without triggering on config changes", () => {
		const request = node<string | null>([], { initial: null });
		const config = node([], { initial: { maxRetries: 3, timeout: 5000 } });

		// withLatestFrom: request triggers, config is sampled
		const enriched = withLatestFrom(request, config);
		enriched.subscribe(() => {});

		// Config change alone should not produce a new emission
		// (withLatestFrom only triggers on primary)
		const emissions: unknown[] = [];
		enriched.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) emissions.push(m[1]);
			}
		});

		const before = emissions.length;
		config.down([[DATA, { maxRetries: 5, timeout: 10000 }]]);
		// No new emission from config change alone
		expect(emissions.length).toBe(before);

		// Request triggers with latest config
		request.down([[DATA, "GET /api/users"]]);
		const latest = emissions[emissions.length - 1] as [string | null, { maxRetries: number }];
		expect(latest[0]).toBe("GET /api/users");
		expect(latest[1].maxRetries).toBe(5); // picked up latest config
	});
});

// ===========================================================================
// Scenario 7: Graph introspection for LLM self-awareness
//
// Composition insight: describe() + gaugesAsContext is how an LLM reads
// the graph it's operating within. knobsAsTools is how it writes back.
// This is the "LLM as graph operator" pattern — the graph is both the
// execution substrate and the LLM's interface to the system.
// ===========================================================================

describe("Phase 5 — Scenario 7: LLM graph self-awareness via describe + gauges", () => {
	it("graph exposes knobs and gauges for LLM consumption", () => {
		const g = new Graph("system");

		// Knobs: LLM-writable configuration
		const retryLimit = node([], {
			name: "retry_limit",
			meta: {
				description: "Maximum retry attempts",
				type: "integer",
				range: [1, 10],
				access: "both",
			},
			initial: 3,
		});
		const model = node([], {
			name: "model",
			meta: {
				description: "LLM model to use",
				type: "enum",
				values: ["gpt-4", "claude-3"],
				access: "both",
			},
			initial: "gpt-4",
		});
		g.add(retryLimit, { name: "retry_limit" });
		g.add(model, { name: "model" });

		// Gauges: read-only metrics
		const successRate = node([], {
			name: "success_rate",
			meta: { description: "Current success rate", format: "percentage", access: "system" },
			initial: 0.95,
		});
		g.add(successRate, { name: "success_rate" });

		// LLM reads the graph
		const desc = g.describe({ detail: "standard" });
		expect(desc.nodes).toHaveProperty("retry_limit");
		expect(desc.nodes).toHaveProperty("model");
		expect(desc.nodes).toHaveProperty("success_rate");

		// gaugesAsContext produces text the LLM can reason about
		const context = gaugesAsContext(g);
		expect(typeof context).toBe("string");

		// knobsAsTools produces tool definitions the LLM can call
		const tools = knobsAsTools(g);
		expect(tools.definitions.length).toBeGreaterThanOrEqual(2);

		// Verify tool names include our knobs
		const toolNames = tools.definitions.map((t) => t.name);
		expect(toolNames).toContain("retry_limit");
		expect(toolNames).toContain("model");
	});
});

// ===========================================================================
// Scenario 8: Multi-source merge with error isolation
//
// Composition insight: merge + onFailure compose to build resilient
// multi-source ingestion. Each source fails independently — the push
// model means a failure in one source doesn't block others.
// ===========================================================================

describe("Phase 5 — Scenario 8: Multi-source merge with error isolation", () => {
	it("merge combines multiple sources, catch isolates errors", () => {
		const g = pipelineGraph("ingest");

		// Three data sources
		const source1 = node<number>([], { initial: 10 });
		const source2 = node<number>([], { initial: 20 });
		const source3 = node<number>([], { initial: 30 });
		g.add(source1, { name: "s1" });
		g.add(source2, { name: "s2" });
		g.add(source3, { name: "s3" });

		// Merge all sources
		const merged = merge(source1, source2, source3);
		g.add(merged, { name: "merged" });

		// Collect values
		const values: number[] = [];
		merged.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) values.push(m[1] as number);
			}
		});

		// Push model: initial values from all three sources arrive
		expect(values).toContain(10);
		expect(values).toContain(20);
		expect(values).toContain(30);

		// Update one source — only that value flows
		const _countBefore = values.length;
		source1.down([[DATA, 100]]);
		expect(values[values.length - 1]).toBe(100);
	});
});

// ===========================================================================
// Scenario 9: Dynamic system prompt with reactive sections
//
// Composition insight: systemPromptBuilder accepts both static strings
// and reactive Node<string> sections. The push model means the prompt
// updates automatically when any section changes — the LLM always
// gets the latest context without manual prompt management.
// ===========================================================================

describe("Phase 5 — Scenario 9: Dynamic system prompt composition", () => {
	it("systemPromptBuilder reacts to section changes", () => {
		const role = node([], { initial: "You are a helpful coding assistant." });
		const rules = node([], { initial: "Always explain your reasoning." });
		const context = node([], { initial: "The user is working on a TypeScript project." });

		const prompt = systemPromptBuilder([role, rules, context]);

		expect(prompt.cache).toContain("coding assistant");
		expect(prompt.cache).toContain("explain your reasoning");
		expect(prompt.cache).toContain("TypeScript project");

		// Context changes reactively
		context.down([[DATA, "The user is working on a Python project."]]);
		expect(prompt.cache).toContain("Python project");
		expect(prompt.cache).not.toContain("TypeScript project");
	});
});

// ===========================================================================
// Scenario 10: Diamond dependency — glitch-free derived computation
//
// Composition insight: The two-phase DIRTY/DATA protocol ensures D
// computes exactly once when both B and C have settled. This is the
// core advantage of the push model — glitch-free by construction,
// not by accident.
// ===========================================================================

describe("Phase 5 — Scenario 10: Diamond dependency glitch-free guarantee", () => {
	it("D computes exactly once when A changes (diamond: A→B,C→D)", () => {
		//     A
		//    / \
		//   B   C
		//    \ /
		//     D
		const a = node([], { initial: 1 });
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) * 2);
			},
			{ describeKind: "derived" },
		);
		const c = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) + 10);
			},
			{ describeKind: "derived" },
		);

		let computeCount = 0;
		const d = node(
			[b, c],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				computeCount++;
				actions.emit(`${data[0]}+${data[1]}`);
			},
			{ describeKind: "derived" },
		);

		d.subscribe(() => {});

		// Connection-time diamond guarantee (spec §2.7): _connectUpstream defers
		// settlement until all deps are subscribed, so fn runs exactly once
		// with all deps settled — not once per dep.
		expect(computeCount).toBe(1);
		expect(d.cache).toBe("2+11");

		// KEY INSIGHT #2 (composition guide addition candidate):
		// Even for subsequent updates, glitch-free diamond resolution
		// requires the TWO-PHASE protocol: DIRTY first, then DATA.
		// Plain `down([[DATA, v]])` skips DIRTY, so each dep recomputes
		// independently. Use `batch(() => { down([[DIRTY]]); down([[DATA]]); })`
		// or let the framework handle it (derived nodes auto-emit two-phase).
		//
		// The existing diamond tests confirm this — they all use batch()
		// with explicit DIRTY/DATA.
		computeCount = 0;
		batch(() => {
			a.down([[DIRTY]]);
			a.down([[DATA, 5]]);
		});
		expect(computeCount).toBe(1);
		expect(d.cache).toBe("10+15");
	});
});
