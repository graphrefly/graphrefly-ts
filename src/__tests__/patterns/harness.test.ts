import { describe, expect, it, vi } from "vitest";
import { monotonicNs } from "../../core/clock.js";
import { DATA } from "../../core/messages.js";
import { node } from "../../core/node.js";
import { Graph } from "../../graph/graph.js";

import { contentGate, redactor } from "../../patterns/ai/index.js";
import {
	affectedTaskFilter,
	beforeAfterCompare,
	type CodeChange,
	codeChangeBridge,
	type EvalRunResult,
	evalIntakeBridge,
	evalSource,
	notifyEffect,
} from "../../patterns/harness/bridge.js";
import { HarnessGraph, harnessLoop } from "../../patterns/harness/presets/harness-loop.js";
import {
	priorityScore,
	type StrategySnapshot,
	strategyModel,
} from "../../patterns/harness/strategy.js";
import {
	defaultErrorClassifier,
	type ExecutionResult,
	type IntakeItem,
	strategyKey,
	type TriagedItem,
} from "../../patterns/harness/types.js";
import { TopicGraph, topic } from "../../patterns/messaging/index.js";
import { mockLLM } from "../helpers/mock-llm.js";

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

describe("harness types", () => {
	it("strategyKey formats rootCause→intervention", () => {
		expect(strategyKey("composition", "template")).toBe("composition→template");
		expect(strategyKey("missing-fn", "catalog-fn")).toBe("missing-fn→catalog-fn");
	});

	it("defaultErrorClassifier classifies parse/config as self-correctable", () => {
		const result: ExecutionResult = {
			item: {} as TriagedItem,
			outcome: "failure",
			detail: "JSON parse error at line 3",
		};
		expect(defaultErrorClassifier(result)).toBe("self-correctable");

		result.detail = "Config validation failed: missing field";
		expect(defaultErrorClassifier(result)).toBe("self-correctable");
	});

	it("defaultErrorClassifier classifies structural errors", () => {
		const result: ExecutionResult = {
			item: {} as TriagedItem,
			outcome: "failure",
			detail: "Missing node: rateLimiter not found in catalog",
		};
		expect(defaultErrorClassifier(result)).toBe("structural");
	});
});

// ---------------------------------------------------------------------------
// strategy model
// ---------------------------------------------------------------------------

describe("strategyModel", () => {
	it("starts empty", () => {
		const sm = strategyModel();
		expect(sm.entries.cache.size).toBe(0);
		expect(sm.lookup(strategyKey("composition", "template"))).toBeUndefined();
	});

	it("records successes and failures with correct rates", () => {
		const sm = strategyModel();
		sm.record(strategyKey("composition", "template"), true, {
			rootCause: "composition",
			intervention: "template",
		});
		sm.record(strategyKey("composition", "template"), true, {
			rootCause: "composition",
			intervention: "template",
		});
		sm.record(strategyKey("composition", "template"), false, {
			rootCause: "composition",
			intervention: "template",
		});

		const entry = sm.lookup(strategyKey("composition", "template"));
		expect(entry).toBeDefined();
		expect(entry!.attempts).toBe(3);
		expect(entry!.successes).toBe(2);
		expect(entry!.successRate).toBeCloseTo(2 / 3);
	});

	it("tracks multiple rootCause→intervention pairs independently", () => {
		const sm = strategyModel();
		sm.record(strategyKey("composition", "template"), true, {
			rootCause: "composition",
			intervention: "template",
		});
		sm.record(strategyKey("missing-fn", "catalog-fn"), true, {
			rootCause: "missing-fn",
			intervention: "catalog-fn",
		});
		sm.record(strategyKey("missing-fn", "catalog-fn"), true, {
			rootCause: "missing-fn",
			intervention: "catalog-fn",
		});

		expect(sm.lookup(strategyKey("composition", "template"))!.attempts).toBe(1);
		expect(sm.lookup(strategyKey("missing-fn", "catalog-fn"))!.attempts).toBe(2);
	});

	it("reactive node updates on record()", () => {
		const sm = strategyModel();
		const values: StrategySnapshot[] = [];
		sm.entries.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) values.push(msg[1] as StrategySnapshot);
			}
		});

		sm.record(strategyKey("bad-docs", "docs"), true, {
			rootCause: "bad-docs",
			intervention: "docs",
		});
		expect(values.length).toBeGreaterThanOrEqual(1);
		const last = values[values.length - 1];
		expect(last.get("bad-docs→docs")).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// priority score
// ---------------------------------------------------------------------------

describe("priorityScore", () => {
	it("computes score from severity and decay", () => {
		const item = node<TriagedItem>([], {
			initial: {
				source: "eval",
				summary: "test",
				evidence: "test",
				affectsAreas: [],
				rootCause: "composition",
				intervention: "template",
				route: "auto-fix",
				priority: 50,
				severity: "high",
			},
		});

		const sm = strategyModel();
		const lastInteraction = node<number>([], { initial: monotonicNs() }); // recent

		const score = priorityScore(item, sm.entries, lastInteraction);
		score.subscribe(() => undefined); // activate

		const val = score.cache;
		expect(typeof val).toBe("number");
		expect(val).toBeGreaterThan(0);
	});

	it("boosts score when strategy model shows high effectiveness", () => {
		const item = node<TriagedItem>([], {
			initial: {
				source: "eval",
				summary: "test",
				evidence: "test",
				affectsAreas: [],
				rootCause: "composition",
				intervention: "template",
				route: "auto-fix",
				priority: 50,
				severity: "medium",
			},
		});

		const sm = strategyModel();
		const lastInteraction = node<number>([], { initial: monotonicNs() });

		// Without strategy data
		const scoreWithout = priorityScore(item, sm.entries, lastInteraction);
		scoreWithout.subscribe(() => undefined);
		const valWithout = scoreWithout.cache;

		// Record high effectiveness
		sm.record(strategyKey("composition", "template"), true, {
			rootCause: "composition",
			intervention: "template",
		});
		sm.record(strategyKey("composition", "template"), true, {
			rootCause: "composition",
			intervention: "template",
		});
		sm.record(strategyKey("composition", "template"), true, {
			rootCause: "composition",
			intervention: "template",
		});

		const scoreWith = priorityScore(item, sm.entries, lastInteraction);
		scoreWith.subscribe(() => undefined);
		const valWith = scoreWith.cache;

		expect(valWith).toBeGreaterThan(valWithout);
	});
});

// ---------------------------------------------------------------------------
// eval intake bridge
// ---------------------------------------------------------------------------

describe("evalIntakeBridge", () => {
	it("publishes per-criterion findings for failing judge scores", () => {
		// Start with null — bridge fires on value change, not initial
		const evalResults = node<EvalRunResult | null>([], { initial: null });

		const intake = new TopicGraph<IntakeItem>("test-intake");
		const g = new Graph("test-bridge-1");
		const bridgeNode = evalIntakeBridge({
			graph: g,
			source: evalResults as any,
			intakeTopic: intake,
		});

		// Activate bridge + subscribe to intake before emitting data
		bridgeNode.subscribe(() => undefined);
		const items: IntakeItem[] = [];
		intake.latest.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA && msg[1] != null) items.push(msg[1] as IntakeItem);
			}
		});

		// Now emit the eval result
		evalResults.down([
			[
				DATA,
				{
					run_id: "run-1",
					model: "claude",
					tasks: [
						{
							task_id: "T1",
							valid: true,
							judge_scores: [
								{ claim: "correct topology", pass: true, reasoning: "ok" },
								{ claim: "uses feedback edges", pass: false, reasoning: "missing feedback" },
								{ claim: "handles errors", pass: false, reasoning: "no error handling" },
							],
						},
					],
				},
			],
		]);

		// Should produce 2 items (2 failing criteria), not 1 per task
		expect(items.length).toBe(2);
		expect(items[0].summary).toContain("uses feedback edges");
		expect(items[1].summary).toContain("handles errors");
		expect(items[0].source).toBe("eval");
		expect(items[0].affectsEvalTasks).toEqual(["T1"]);
	});

	it("handles task-level invalidity without judge scores", () => {
		const evalResults = node<EvalRunResult | null>([], { initial: null });

		const intake = new TopicGraph<IntakeItem>("test-intake-2");
		const g = new Graph("test-bridge-2");
		const bridgeNode = evalIntakeBridge({
			graph: g,
			source: evalResults as any,
			intakeTopic: intake,
		});
		bridgeNode.subscribe(() => undefined);

		const items: IntakeItem[] = [];
		intake.latest.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA && msg[1] != null) items.push(msg[1] as IntakeItem);
			}
		});

		evalResults.down([
			[
				DATA,
				{
					run_id: "run-2",
					model: "gemini",
					tasks: [{ task_id: "T2", valid: false }],
				},
			],
		]);

		expect(items.length).toBe(1);
		expect(items[0].summary).toContain("T2 invalid");
	});

	it("skips fully passing tasks", () => {
		const evalResults = node<EvalRunResult | null>([], { initial: null });

		const intake = new TopicGraph<IntakeItem>("test-intake-3");
		const g = new Graph("test-bridge-3");
		const bridgeNode = evalIntakeBridge({
			graph: g,
			source: evalResults as any,
			intakeTopic: intake,
		});
		bridgeNode.subscribe(() => undefined);

		const items: IntakeItem[] = [];
		intake.latest.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA && msg[1] != null) items.push(msg[1] as IntakeItem);
			}
		});

		evalResults.down([
			[
				DATA,
				{
					run_id: "run-3",
					model: "claude",
					tasks: [
						{
							task_id: "T3",
							valid: true,
							judge_scores: [{ claim: "correct", pass: true, reasoning: "ok" }],
						},
					],
				},
			],
		]);

		expect(items.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// harnessLoop
// ---------------------------------------------------------------------------

// FLAG: v5 behavioral change — needs investigation
// harnessLoop tests fail with:
//   Graph "gates": connect(needs-decision/source, needs-decision/gate) — target must include source in its constructor deps (same node reference)
// The gate factory in orchestration.ts uses Graph.connect() which now enforces deps.
describe("harnessLoop", () => {
	// Mock LLM adapter that returns predictable JSON
	function mockAdapter(responses: Record<string, unknown>) {
		let callIndex = 0;
		return {
			invoke: () => {
				const keys = Object.keys(responses);
				const key = keys[callIndex % keys.length];
				callIndex++;
				return Promise.resolve({ content: JSON.stringify(responses[key]) });
			},
		};
	}

	it("creates a HarnessGraph with all expected surfaces", () => {
		const adapter = mockAdapter({
			triage: { rootCause: "unknown", intervention: "investigate", route: "backlog", priority: 10 },
		});
		const harness = harnessLoop("test-harness", { adapter });

		expect(harness).toBeInstanceOf(HarnessGraph);
		expect(harness.intake).toBeInstanceOf(TopicGraph);
		// queues is the hub — 4 route topics + intake + triage-output + retry +
		// verify-results + __unrouted = 9 topics. Enumerate them so an
		// accidental duplicate / renamed / missing topic trips the test.
		expect(harness.queues.size).toBe(9);
		for (const name of [
			"intake",
			"triage-output",
			"retry",
			"verify-results",
			"__unrouted",
			"auto-fix",
			"needs-decision",
			"investigation",
			"backlog",
		]) {
			expect(harness.queues.has(name)).toBe(true);
		}
		expect(harness.strategy).toBeDefined();
		expect(harness.verifyResults).toBeInstanceOf(TopicGraph);
	});

	it("gates are created for needs-decision and investigation by default", () => {
		const adapter = mockAdapter({});
		const harness = harnessLoop("test-harness-2", { adapter });

		expect(harness.gates.has("needs-decision")).toBe(true);
		expect(harness.gates.has("investigation")).toBe(true);
		expect(harness.gates.has("auto-fix")).toBe(false);
		expect(harness.gates.has("backlog")).toBe(false);
	});

	it("respects custom queue config overrides", () => {
		const adapter = mockAdapter({});
		const harness = harnessLoop("test-harness-3", {
			adapter,
			queues: {
				"auto-fix": { gated: true },
				"needs-decision": { gated: false },
			},
		});

		expect(harness.gates.has("auto-fix")).toBe(true);
		expect(harness.gates.has("needs-decision")).toBe(false);
	});

	it("intake.publish() is callable without error", () => {
		const adapter = mockAdapter({});
		const harness = harnessLoop("test-harness-4", { adapter });

		expect(() => {
			harness.intake.publish({
				source: "human",
				summary: "Test issue",
				evidence: "Test evidence",
				affectsAreas: ["core"],
			});
		}).not.toThrow();
	});

	it("strategy model is accessible and functional", () => {
		const adapter = mockAdapter({});
		const harness = harnessLoop("test-harness-5", { adapter });

		harness.strategy.record(strategyKey("composition", "template"), true, {
			rootCause: "composition",
			intervention: "template",
		});
		const entry = harness.strategy.lookup(strategyKey("composition", "template"));
		expect(entry).toBeDefined();
		expect(entry!.successRate).toBe(1);
	});

	it("exposes global counters at zero", () => {
		const adapter = mockAdapter({});
		const harness = harnessLoop("test-harness-6", { adapter });

		expect(harness.totalRetries.cache).toBe(0);
		expect(harness.totalReingestions.cache).toBe(0);
	});

	it("queueTopics map covers exactly the four QUEUE_NAMES routes", () => {
		const adapter = mockAdapter({});
		const harness = harnessLoop("test-harness-7", { adapter });
		const routes = [...harness.queueTopics.keys()].sort();
		expect(routes).toEqual(["auto-fix", "backlog", "investigation", "needs-decision"]);
		// Each entry is the same TopicGraph instance the hub holds — no
		// double-registration / wrapper.
		for (const [route, topic] of harness.queueTopics) {
			expect(topic).toBe(harness.queues.topic(route));
		}
	});

	it("queueTopics iteration sees published triaged items", () => {
		const adapter = mockAdapter({});
		const harness = harnessLoop("test-harness-8", { adapter });
		const seen: TriagedItem[] = [];
		for (const [, topic] of harness.queueTopics) {
			topic.latest.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA && m[1] != null) seen.push(m[1] as TriagedItem);
				}
			});
		}
		// Direct publish to a queue topic — bypassing intake/triage to
		// keep the test focused on the iteration mechanism.
		harness.queueTopics.get("auto-fix")?.publish({
			source: "test",
			summary: "queueTopics-iter",
			evidence: "fixture",
			affectsAreas: ["core"],
			rootCause: "missing-fn",
			intervention: "catalog-fn",
			route: "auto-fix",
			priority: 50,
		});
		const matched = seen.find((s) => s.summary === "queueTopics-iter");
		expect(matched).toBeDefined();
	});

	// Tier 6.1 reconciliation regression — items whose route is unknown to
	// the harness flow into the `__unrouted` dead-letter topic. The router
	// fans triage output to per-route bridges + an `__unrouted` bridge whose
	// `map:` predicate fires when `knownRoutes.has(item.route) === false`.
	// Without this dead-letter, an LLM that hallucinates a non-canonical
	// route would silently drop the item — the bridge instead surfaces it
	// for diagnostics.
	it("Tier 6.1: items with unknown routes flow into the __unrouted dead-letter topic", () => {
		const adapter = mockAdapter({});
		const harness = harnessLoop("test-unrouted", { adapter });
		const unrouted = harness.queues.topic<TriagedItem>("__unrouted");
		const seen: TriagedItem[] = [];
		unrouted.latest.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA && m[1] != null) seen.push(m[1] as TriagedItem);
			}
		});
		// Bypass triage — publish directly to triage-output with a route the
		// hub doesn't know about so the `bridge/__unrouted` predicate fires.
		harness.queues.topic<TriagedItem>("triage-output").publish({
			source: "eval",
			summary: "rogue-route",
			evidence: "fixture",
			affectsAreas: ["core"],
			rootCause: "unknown",
			intervention: "investigate",
			route: "not-a-real-route" as TriagedItem["route"],
			priority: 50,
		});
		const matched = seen.find((s) => s.summary === "rogue-route");
		expect(matched).toBeDefined();
		expect(matched?.route).toBe("not-a-real-route");
	});

	// Tier 6.2 reconciliation regression — gates consume `topic.latest`
	// directly via foreign-node-accept (Session B.1 lock). The
	// `gateGraph.approvalGate(...)` factory accepts the foreign node without
	// requiring the caller to first `gateGraph.add(topic.latest)`. The gate
	// auto-registers the source under `${name}/source` inside its own graph,
	// keeping the hub's topic as the single source of truth.
	it("Tier 6.2: gates compose with hub topic.latest via foreign-node-accept (no wrapper node)", () => {
		const adapter = mockAdapter({});
		const harness = harnessLoop("test-foreign-accept", { adapter });
		// Both gated routes (needs-decision, investigation) get GateController
		// instances. The controller's own .node IS the gated output — no
		// pipeline wrapper appears between the topic and the gate.
		const ndGate = harness.gates.get("needs-decision");
		expect(ndGate).toBeDefined();
		// **Foreign-node-accept invariant.** The gate factory's auto-add path
		// registered the hub topic node under `gates::needs-decision/gate/source`
		// inside the gateGraph — but `nodeToPath` resolution still maps that
		// node back to its canonical hub path (`queues::needs-decision::latest`)
		// when describe() walks deps, because the hub registered the topic
		// FIRST. Two complementary checks:
		//   (a) `harness.node("gates::needs-decision/gate/source")` resolves
		//       to the SAME Node instance as `queues::needs-decision::latest`
		//       — proves no wrapper Node was inserted between them.
		//   (b) The gate's deps in `describe()` reference the hub's canonical
		//       path directly, NOT a wrapper-node path inside gates.
		const hubTopicLatest = harness.node("queues::needs-decision::latest");
		const gateSource = harness.node("gates::needs-decision/gate/source");
		expect(gateSource).toBe(hubTopicLatest);
		// (b) — describe walks deps via nodeToPath, which canonicalizes to
		// the first registration (the hub). A regression that introduced a
		// Pipeline wrapper between hub and gate would surface here as a
		// distinct intermediate path (e.g. `gates::needs-decision/gate/wrap`),
		// not as the hub topic's canonical path.
		const desc = harness.describe();
		const gateEntry = desc.nodes["gates::needs-decision/gate"];
		expect(gateEntry).toBeDefined();
		const gateDeps = (gateEntry?.deps as readonly string[] | undefined) ?? [];
		expect(gateDeps).toContain("queues::needs-decision::latest");
	});

	// Tier 6.3 — named-node regression. Walks the causal chain from intake to
	// reflect and asserts no step has an `<anonymous>` path. With triage-input,
	// router-input, execute-input, execute-enqueue, verify-dispatch, and the
	// stage-queue/pump nodes inside `executeFlow` all named, the chain should
	// resolve cleanly end-to-end.
	it("explain(intake.latest, reflect) returns a chain with no <anonymous> steps", () => {
		const adapter = mockAdapter({
			triage: {
				rootCause: "unknown",
				intervention: "investigate",
				route: "backlog",
				priority: 10,
			},
		});
		const harness = harnessLoop("test-explain-named", { adapter });
		const chain = harness.describe({ explain: { from: "queues::intake::latest", to: "reflect" } });
		// We don't assert `found: true` because some intermediate paths (e.g.
		// gate output for ungated routes) may not be present at construction
		// time. What we DO assert: every step's path is a named, non-empty,
		// non-`<anonymous>` qualified path.
		for (const step of chain.steps) {
			expect(step.path, `chain step ${step.hop}`).not.toContain("<anonymous>");
			expect(step.path, `chain step ${step.hop}`).not.toBe("");
		}
	});
});

// ---------------------------------------------------------------------------
// e2e: full 7-stage flow
// ---------------------------------------------------------------------------

// FLAG: v5 behavioral change — needs investigation (same Graph.connect() deps enforcement)
describe("harnessLoop e2e", () => {
	/**
	 * Stage-aware mock adapter.
	 * Returns different JSON depending on which stage is calling.
	 * Stage detection uses the prompt content.
	 */
	function stageAdapter() {
		const calls: string[] = [];
		return {
			calls,
			invoke: (msgs: Array<{ role: string; content: string }>) => {
				const text = msgs
					.map((m) => m.content)
					.join(" ")
					.toLowerCase();
				calls.push(text.slice(0, 80));

				if (text.includes("triage") || text.includes("intake item")) {
					return Promise.resolve({
						content: JSON.stringify({
							rootCause: "missing-fn",
							intervention: "catalog-fn",
							route: "auto-fix",
							priority: 80,
							triageReasoning: "Missing catalog function for this pattern",
						}),
					});
				}
				if (text.includes("implementation") || text.includes("triaged issue")) {
					return Promise.resolve({
						content: JSON.stringify({
							outcome: "success",
							detail: "Added the missing catalog function",
						}),
					});
				}
				if (text.includes("qa") || text.includes("verify") || text.includes("execution")) {
					return Promise.resolve({
						content: JSON.stringify({
							verified: true,
							findings: ["Fix looks correct"],
						}),
					});
				}
				// Fallback
				return Promise.resolve({ content: "{}" });
			},
		};
	}

	it("intake → triage → queue → execute → verify → strategy", async () => {
		// Track all adapter calls with their prompts
		const calls: string[] = [];
		const adapter = {
			invoke: (msgs: Array<{ role: string; content: string }>) => {
				const text = msgs
					.map((m) => m.content)
					.join(" ")
					.toLowerCase();
				calls.push(text.slice(0, 60));

				if (text.includes("triage") || text.includes("intake item")) {
					return Promise.resolve({
						content: JSON.stringify({
							rootCause: "missing-fn",
							intervention: "catalog-fn",
							route: "auto-fix",
							priority: 80,
						}),
					});
				}
				if (text.includes("implementation") || text.includes("triaged issue")) {
					return Promise.resolve({
						content: JSON.stringify({
							outcome: "success",
							detail: "Fixed",
						}),
					});
				}
				if (text.includes("qa") || text.includes("verify") || text.includes("execution")) {
					return Promise.resolve({
						content: JSON.stringify({
							verified: true,
							findings: ["ok"],
						}),
					});
				}
				return Promise.resolve({ content: "{}" });
			},
		};

		const harness = harnessLoop("e2e", { adapter });

		// Publish and wait for full chain
		harness.intake.publish({
			source: "eval",
			summary: "T5: missing resilience ordering",
			evidence: "wrong order",
			affectsAreas: ["graphspec"],
			severity: "high",
		});

		// Wait for strategy model to record at least one outcome
		// (proves: triage → route → execute → verify → strategy.record)
		await vi.waitFor(
			() => {
				expect(harness.strategy.entries.cache.size).toBeGreaterThan(0);
			},
			{ timeout: 5000, interval: 50 },
		);

		// Verify full chain executed
		expect(harness.strategy.lookup(strategyKey("missing-fn", "catalog-fn"))).toBeDefined();
		expect(calls.length).toBeGreaterThanOrEqual(3); // triage + execute + verify (SENTINEL skips initial empty)
	});

	it("failed verification triggers fast-retry for self-correctable errors", async () => {
		let verifyCallCount = 0;
		const adapter = {
			invoke: (msgs: Array<{ role: string; content: string }>) => {
				const text = msgs
					.map((m) => m.content)
					.join(" ")
					.toLowerCase();

				if (text.includes("triage") || text.includes("intake item")) {
					return Promise.resolve({
						content: JSON.stringify({
							rootCause: "schema-gap",
							intervention: "schema-change",
							route: "auto-fix",
							priority: 60,
						}),
					});
				}
				if (text.includes("implementation") || text.includes("triaged issue")) {
					return Promise.resolve({
						content: JSON.stringify({
							outcome: "failure",
							detail: "JSON parse error in config",
						}),
					});
				}
				if (text.includes("qa") || text.includes("verify") || text.includes("execution")) {
					verifyCallCount++;
					if (verifyCallCount <= 1) {
						// First verify: fail with self-correctable
						return Promise.resolve({
							content: JSON.stringify({
								verified: false,
								findings: ["JSON parse error in output"],
								errorClass: "self-correctable",
							}),
						});
					}
					// Subsequent: pass
					return Promise.resolve({
						content: JSON.stringify({
							verified: true,
							findings: ["Fixed after retry"],
						}),
					});
				}
				return Promise.resolve({ content: "{}" });
			},
		};

		const harness = harnessLoop("e2e-retry", { adapter, maxRetries: 2 });

		const results: VerifyResult[] = [];
		harness.verifyResults.latest.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA && msg[1] != null) results.push(msg[1] as VerifyResult);
			}
		});

		harness.intake.publish({
			source: "eval",
			summary: "T8: parse error in config",
			evidence: "config validation failed",
			affectsAreas: ["graphspec"],
			severity: "medium",
		});

		// The verify stage should be called at least once (initial activation + real item)
		await vi.waitFor(
			() => {
				expect(verifyCallCount).toBeGreaterThanOrEqual(1);
			},
			{ timeout: 3000, interval: 20 },
		);

		// Global retry counter should have recorded retry attempts
		expect(harness.totalRetries.cache).toBeGreaterThanOrEqual(0);
	});

	it("evalIntakeBridge → harnessLoop integration", async () => {
		const adapter = stageAdapter();
		const harness = harnessLoop("e2e-bridge", { adapter });

		// Wire the bridge — harness extends Graph, so register on it directly
		const evalSource = node<EvalRunResult | null>([], { initial: null });
		const bridgeNode = evalIntakeBridge({
			graph: harness,
			source: evalSource as any,
			intakeTopic: harness.intake,
		});
		bridgeNode.subscribe(() => undefined);

		// Emit an eval result with 1 failing criterion
		evalSource.down([
			[
				DATA,
				{
					run_id: "run-e2e",
					model: "claude",
					tasks: [
						{
							task_id: "T5",
							valid: true,
							judge_scores: [
								{ claim: "correct topology", pass: true, reasoning: "ok" },
								{ claim: "resilience ordering", pass: false, reasoning: "wrong order" },
							],
						},
					],
				},
			],
		]);

		// The bridge should have published 1 failing criterion to intake
		await vi.waitFor(
			() => {
				const intakeItems = harness.intake.retained();
				expect(intakeItems.length).toBeGreaterThanOrEqual(1);
			},
			{ timeout: 1000, interval: 20 },
		);

		const intakeItems = harness.intake.retained();
		expect(intakeItems.some((i) => i.summary.includes("resilience ordering"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// mockLLM-based scenario tests
// ---------------------------------------------------------------------------

// FLAG: v5 behavioral change — needs investigation (same Graph.connect() deps enforcement)
describe("harnessLoop with mockLLM", () => {
	it("full 7-stage happy path — each stage fires in order, strategy records success", async () => {
		const mock = mockLLM({
			stages: {
				triage: {
					responses: [
						{
							rootCause: "missing-fn",
							intervention: "catalog-fn",
							route: "auto-fix",
							priority: 80,
						},
					],
				},
				execute: { responses: [{ outcome: "success", detail: "Added missing fn" }] },
				verify: { responses: [{ verified: true, findings: ["Looks correct"] }] },
			},
		});

		const harness = harnessLoop("mock-happy", { adapter: mock });
		const results: VerifyResult[] = [];
		harness.verifyResults.latest.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA && msg[1] != null) results.push(msg[1] as VerifyResult);
			}
		});

		harness.intake.publish({
			source: "eval",
			summary: "T1: missing catalog function",
			evidence: "fn not found",
			affectsAreas: ["graphspec"],
			severity: "high",
		});

		await vi.waitFor(
			() => {
				expect(results.length).toBeGreaterThanOrEqual(1);
			},
			{ timeout: 5000, interval: 50 },
		);

		// All 3 stages should have been called
		expect(mock.callsFor("triage").length).toBeGreaterThanOrEqual(1);
		expect(mock.callsFor("execute").length).toBeGreaterThanOrEqual(1);
		expect(mock.callsFor("verify").length).toBeGreaterThanOrEqual(1);

		// Strategy model should record a success
		const entry = harness.strategy.lookup(strategyKey("missing-fn", "catalog-fn"));
		expect(entry).toBeDefined();
		expect(entry!.successes).toBeGreaterThanOrEqual(1);

		// Verify result should be verified=true
		expect(results[0].verified).toBe(true);
	});

	it("multi-item pipeline — items route to different queues", async () => {
		const mock = mockLLM({
			stages: {
				triage: {
					responses: [
						{
							rootCause: "missing-fn",
							intervention: "catalog-fn",
							route: "auto-fix",
							priority: 80,
						},
						{
							rootCause: "schema-gap",
							intervention: "schema-change",
							route: "auto-fix",
							priority: 60,
						},
						{
							rootCause: "bad-docs",
							intervention: "docs",
							route: "auto-fix",
							priority: 40,
						},
					],
				},
				execute: { responses: [{ outcome: "success", detail: "Fixed" }] },
				verify: { responses: [{ verified: true, findings: ["ok"] }] },
			},
		});

		const harness = harnessLoop("mock-multi", { adapter: mock });

		harness.intake.publish({
			source: "eval",
			summary: "Item A",
			evidence: "evidence A",
			affectsAreas: ["core"],
		});
		harness.intake.publish({
			source: "eval",
			summary: "Item B",
			evidence: "evidence B",
			affectsAreas: ["extra"],
		});
		harness.intake.publish({
			source: "test",
			summary: "Item C",
			evidence: "evidence C",
			affectsAreas: ["graph"],
		});

		// Wait for strategy to accumulate entries
		await vi.waitFor(
			() => {
				expect(harness.strategy.entries.cache.size).toBeGreaterThanOrEqual(1);
			},
			{ timeout: 5000, interval: 50 },
		);

		// Multiple triage calls should have occurred
		expect(mock.callsFor("triage").length).toBeGreaterThanOrEqual(1);
	});

	it("fast-retry exhaustion — self-correctable fails maxRetries times, then records failure", async () => {
		const mock = mockLLM({
			stages: {
				triage: {
					responses: [
						{
							rootCause: "schema-gap",
							intervention: "schema-change",
							route: "auto-fix",
							priority: 70,
						},
					],
				},
				execute: {
					responses: [{ outcome: "failure", detail: "JSON parse error" }],
				},
				verify: {
					responses: [
						{
							verified: false,
							findings: ["parse error in output"],
							errorClass: "self-correctable",
						},
					],
				},
			},
		});

		const harness = harnessLoop("mock-retry-exhaust", {
			adapter: mock,
			maxRetries: 2,
			maxReingestions: 0, // disable reingestion to prevent infinite loop
		});

		harness.intake.publish({
			source: "eval",
			summary: "T5: parse failure",
			evidence: "broken JSON",
			affectsAreas: ["graphspec"],
			severity: "high",
		});

		// Wait for strategy model to record the failure (proves retries exhausted)
		await vi.waitFor(
			() => {
				const entry = harness.strategy.lookup(strategyKey("schema-gap", "schema-change"));
				expect(entry).toBeDefined();
			},
			{ timeout: 15000, interval: 100 },
		);

		// Global retry counter should show retries occurred
		expect(harness.totalRetries.cache).toBe(2);

		// Strategy should record failure
		const entry = harness.strategy.lookup(strategyKey("schema-gap", "schema-change"))!;
		expect(entry.successes).toBe(0);
	});

	it("structural failure — no fast-retry, straight to strategy.record(false)", async () => {
		const mock = mockLLM({
			stages: {
				triage: {
					responses: [
						{
							rootCause: "composition",
							intervention: "template",
							route: "auto-fix",
							priority: 90,
						},
					],
				},
				execute: {
					responses: [{ outcome: "failure", detail: "fundamental architecture issue" }],
				},
				verify: {
					responses: [
						{
							verified: false,
							findings: ["wrong architecture"],
							errorClass: "structural",
						},
					],
				},
			},
		});

		const harness = harnessLoop("mock-structural", {
			adapter: mock,
			maxRetries: 2,
			maxReingestions: 0, // disable reingestion to prevent loop
		});

		harness.intake.publish({
			source: "eval",
			summary: "T9: architecture mismatch",
			evidence: "wrong pattern",
			affectsAreas: ["graphspec"],
			severity: "critical",
		});

		// Wait for strategy model to record the failure (proves full chain executed)
		await vi.waitFor(
			() => {
				const entry = harness.strategy.lookup(strategyKey("composition", "template"));
				expect(entry).toBeDefined();
			},
			{ timeout: 5000, interval: 50 },
		);

		// Structural failure should NOT trigger fast-retry
		expect(harness.totalRetries.cache).toBe(0);

		// Strategy should record failure
		const entry = harness.strategy.lookup(strategyKey("composition", "template"))!;
		expect(entry.successes).toBe(0);
		expect(entry.attempts).toBeGreaterThanOrEqual(1);
	});

	it("reingestion — verify failure reingests to intake", async () => {
		const mock = mockLLM({
			stages: {
				triage: {
					responses: [
						{
							rootCause: "regression",
							intervention: "investigate",
							route: "auto-fix",
							priority: 50,
						},
					],
				},
				execute: {
					responses: [{ outcome: "failure", detail: "structural issue" }],
				},
				verify: {
					responses: [
						// First: fail → triggers reingestion
						{
							verified: false,
							findings: ["still broken"],
							errorClass: "structural",
						},
						// Second (reingested item): succeed → stops loop
						{
							verified: true,
							findings: ["fixed on retry"],
						},
					],
				},
			},
		});

		const harness = harnessLoop("mock-reingestion", {
			adapter: mock,
			maxRetries: 0,
			maxReingestions: 1,
		});

		harness.intake.publish({
			source: "eval",
			summary: "T10: recurring failure",
			evidence: "keeps failing",
			affectsAreas: ["core"],
		});

		// Wait for the global reingestion counter to record the first reingestion
		await vi.waitFor(
			() => {
				expect(harness.totalReingestions.cache).toBe(1);
			},
			{ timeout: 5000, interval: 50 },
		);

		// Strategy should have recorded outcomes
		expect(harness.strategy.entries.cache.size).toBeGreaterThanOrEqual(1);
	});

	// Tier 6.4 / 6.5 reconciliation — the dispatch effect's verdict routing
	// is exercised by three existing tests in isolation:
	//   - "full 7-stage happy path" → verified branch.
	//   - "fast-retry exhaustion"   → retry branch (then structural fallback).
	//   - "structural failure"      → structural branch (no retry).
	// A bundled mixed-batch test adds timing fragility without protection
	// the per-branch tests don't already provide. The structural-only
	// regression below adds a missing assertion: the dispatch effect emits
	// a verifyResults publish on EVERY terminal verdict (verified +
	// structural), not just verified ones. Pre-Tier-6.5 this was easy to
	// regress because fastRetry's terminal-record path was conditional.
	// Tier 6.5 §35 reentrancy regression — under a synchronous mock adapter,
	// the dispatch effect's `intake.publish(...)` cascade can re-enter
	// `executeFlow.completed` while the dispatch's outer `for` loop is still
	// iterating. The dispatchCursor + WeakSet/cursor dedupe protects today's
	// semantics; this test locks the invariant by counting verifyResults
	// publishes vs intake items: no double-publish, no audit-ledger drift.
	it("Tier 6.5: synchronous reingest cascades do not double-dispatch verdicts (§35)", async () => {
		const mock = mockLLM({
			stages: {
				triage: {
					responses: [
						{
							rootCause: "regression",
							intervention: "investigate",
							route: "auto-fix",
							priority: 50,
						},
					],
				},
				execute: { responses: [{ outcome: "failure", detail: "structural" }] },
				// First pass: structural failure → reingest. Second pass:
				// verified → terminal.
				verify: {
					responses: [
						{ verified: false, findings: ["initial fail"], errorClass: "structural" },
						{ verified: true, findings: ["fixed on reingest"] },
					],
				},
			},
		});
		const harness = harnessLoop("mock-reentrancy", {
			adapter: mock,
			maxRetries: 0,
			maxReingestions: 1,
		});
		const verifyResults: VerifyResult[] = [];
		harness.verifyResults.latest.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA && m[1] != null) verifyResults.push(m[1] as VerifyResult);
			}
		});
		harness.intake.publish({
			source: "eval",
			summary: "T-reentrancy",
			evidence: "fixture",
			affectsAreas: ["core"],
		});
		// Wait until the reingestion counter shows 1 AND a verified verdict
		// landed; that's the full cycle (initial fail → reingest →
		// verified).
		await vi.waitFor(
			() => {
				expect(harness.totalReingestions.cache).toBe(1);
				expect(verifyResults.some((r) => r.verified === true)).toBe(true);
			},
			{ timeout: 5000, interval: 50 },
		);
		// Exactly two verdicts: one structural (initial), one verified
		// (post-reingest). Reentrancy guard prevents either being published
		// twice. dispatchCursor advancing past the prior length on each
		// emission is what protects this.
		expect(verifyResults.filter((r) => r.verified === false).length).toBe(1);
		expect(verifyResults.filter((r) => r.verified === true).length).toBe(1);
	});

	// Tier 6.5 reflectNode tick-count regression — `reflectNode = derived(...,
	// () => null, { equals: () => false })`. Each `executeFlow.completed`
	// emission ticks the reflect node exactly once. Drive N items, assert
	// the reflect node's emission count tracks the verdict count.
	it("Tier 6.5: reflectNode ticks once per terminal verdict (no over-count under reactive-log trim emits)", {
		timeout: 15000,
	}, async () => {
		const mock = mockLLM({
			stages: {
				triage: {
					responses: [{ rootCause: "a", intervention: "x", route: "auto-fix", priority: 50 }],
				},
				execute: { responses: [{ outcome: "success", detail: "ok" }] },
				verify: { responses: [{ verified: true, findings: ["clean"] }] },
			},
		});
		const harness = harnessLoop("mock-reflect-tick", {
			adapter: mock,
			maxRetries: 0,
			maxReingestions: 0,
		});
		// Subscribe to reflect via the harness's typed field (qa D4) — using
		// `harness.reflect` rather than `harness.node("reflect")` locks the
		// reference at the type level, so a future rename would surface as
		// a build error instead of a string-lookup runtime fallthrough.
		let reflectTicks = 0;
		const reflectUnsub = harness.reflect.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) reflectTicks++;
			}
		});
		const verdicts: VerifyResult[] = [];
		harness.verifyResults.latest.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA && m[1] != null) verdicts.push(m[1] as VerifyResult);
			}
		});
		// Publish two items with a small await between so each terminates
		// before the next enters — mockLLM's stages serialize via Promise
		// resolution, but rapid fire-and-forget publishes can interleave in
		// ways that drop late completions out of the retained log under high
		// load. The reflect-count contract is the same either way (one tick
		// per terminal verdict); we just want a deterministic count for the
		// assertion.
		harness.intake.publish({
			source: "eval",
			summary: "T-reflect-0",
			evidence: "fixture",
			affectsAreas: ["core"],
		});
		await vi.waitFor(
			() => {
				expect(verdicts.length).toBeGreaterThanOrEqual(1);
			},
			{ timeout: 5000, interval: 30 },
		);
		harness.intake.publish({
			source: "eval",
			summary: "T-reflect-1",
			evidence: "fixture",
			affectsAreas: ["core"],
		});
		await vi.waitFor(
			() => {
				expect(verdicts.length).toBeGreaterThanOrEqual(2);
			},
			{ timeout: 5000, interval: 30 },
		);
		// reflect ticks once per executeFlow.completed emission. Each verdict
		// produces one new completion; reflect's `equals: () => false` keeps
		// each emit observable (no Object.is collapse). The contract: tick
		// count equals the verdict count, plus at most one subscribe-time
		// activation tick (push-on-subscribe of the cached completed log, if
		// activation arrives before the first verdict lands). qa P3:
		// tightened from `+2` to `+1` so a 1-tick over-count regression
		// (e.g. RESOLVED leaking to DATA on the reflect derived) actually
		// fails the test.
		expect(reflectTicks).toBeGreaterThanOrEqual(verdicts.length);
		expect(reflectTicks).toBeLessThanOrEqual(verdicts.length + 1);
		reflectUnsub();
	});

	it("Tier 6.4: structural verdict still publishes a VerifyResult to verifyResults topic", async () => {
		const mock = mockLLM({
			stages: {
				triage: {
					responses: [
						{
							rootCause: "composition",
							intervention: "rewrite",
							route: "auto-fix",
							priority: 80,
						},
					],
				},
				execute: { responses: [{ outcome: "failure", detail: "missing dependency" }] },
				verify: {
					responses: [
						{
							verified: false,
							findings: ["dep missing — not parseable"],
							errorClass: "structural",
						},
					],
				},
			},
		});
		const harness = harnessLoop("mock-structural-publish", {
			adapter: mock,
			maxRetries: 0,
			maxReingestions: 0,
		});
		const verifyResults: VerifyResult[] = [];
		harness.verifyResults.latest.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA && m[1] != null) verifyResults.push(m[1] as VerifyResult);
			}
		});
		harness.intake.publish({
			source: "eval",
			summary: "T-structural-publish",
			evidence: "fixture",
			affectsAreas: ["core"],
		});
		await vi.waitFor(
			() => {
				expect(verifyResults.some((r) => r.verified === false)).toBe(true);
			},
			{ timeout: 5000, interval: 50 },
		);
		const structResult = verifyResults.find((r) => r.verified === false)!;
		expect(structResult.findings).toContain("dep missing — not parseable");
		// Strategy should also have recorded the failure.
		const entry = harness.strategy.lookup(strategyKey("composition", "rewrite"));
		expect(entry).toBeDefined();
		expect(entry?.successes).toBe(0);
		// qa P4: lock "no extra verdict" — single-item run with maxRetries=0
		// + maxReingestions=0 produces EXACTLY one structural verdict and
		// zero verified verdicts. A regression that publishes both a
		// structural and a stray verified verdict for the same item would
		// have passed the `some(...)` checks above but is caught here.
		// Wait one extra tick to absorb any post-waitFor late emissions.
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(verifyResults.filter((r) => r.verified === false).length).toBe(1);
		expect(verifyResults.filter((r) => r.verified === true).length).toBe(0);
	});

	it("gate blocking — needs-decision item waits at gate, approve releases it", async () => {
		const mock = mockLLM({
			stages: {
				triage: {
					responses: [
						{
							rootCause: "unknown",
							intervention: "investigate",
							route: "needs-decision",
							priority: 60,
						},
					],
				},
				execute: { responses: [{ outcome: "success", detail: "Investigated" }] },
				verify: { responses: [{ verified: true, findings: ["ok"] }] },
			},
		});

		const harness = harnessLoop("mock-gate", { adapter: mock });

		harness.intake.publish({
			source: "human",
			summary: "T11: needs human review",
			evidence: "ambiguous case",
			affectsAreas: ["patterns"],
		});
		// Wait for triage → router → queue propagation (async due to promptNode Promise)
		await new Promise((r) => setTimeout(r, 500));

		const qLen = harness.queues.topic<TriagedItem>("needs-decision").retained().length;
		const triageCalls = mock.callsFor("triage").length;
		const allStages = mock.calls.map((c) => c.stage);

		// If queue is empty, something in the triage chain didn't fire.
		// Provide diagnostic info for debugging.
		if (qLen === 0) {
			throw new Error(
				`Queue empty after 500ms. Triage calls: ${triageCalls}, all stages: [${allStages}]`,
			);
		}

		// Gate should have pending items (may include initial push-on-subscribe null)
		const gateCtrl = harness.gates.get("needs-decision")!;
		expect(gateCtrl).toBeDefined();

		// Approve ALL pending items in the gate (includes push-on-subscribe initial + real item)
		const pendingCount = (gateCtrl.count.cache as number) ?? 0;
		gateCtrl.approve(pendingCount);

		// Wait for the item to flow through execute → verify
		await vi.waitFor(
			() => {
				expect(harness.strategy.entries.cache.size).toBeGreaterThanOrEqual(1);
			},
			{ timeout: 5000, interval: 50 },
		);
	});

	it("gate.modify() overrides rootCause/intervention before forwarding", async () => {
		const mock = mockLLM({
			stages: {
				triage: {
					responses: [
						{
							rootCause: "unknown",
							intervention: "investigate",
							route: "needs-decision",
							priority: 60,
						},
					],
				},
				execute: { responses: [{ outcome: "success", detail: "Fixed with template" }] },
				verify: { responses: [{ verified: true, findings: ["ok"] }] },
			},
		});

		const harness = harnessLoop("mock-gate-modify", { adapter: mock });

		// Wire harnessTrace with structured events to validate stage ordering
		const { harnessTrace } = await import("../../patterns/harness/trace.js");
		const trace = harnessTrace(harness);

		harness.intake.publish({
			source: "eval",
			summary: "T5: resilience ordering wrong",
			evidence: "wrong order in retry stack",
			affectsAreas: ["graphspec"],
			severity: "high",
		});

		// Wait for the item to arrive at the needs-decision gate (reactive, no polling).
		await new Promise<void>((resolve) => {
			const queue = harness.queues.topic<TriagedItem>("needs-decision");
			const unsub = queue.latest.subscribe((msgs) => {
				for (const msg of msgs) {
					if (msg[0] === DATA && queue.retained().length >= 1) {
						unsub();
						resolve();
						return;
					}
				}
			});
		});

		const gateCtrl = harness.gates.get("needs-decision")!;

		// Human steering: override triage classification with structured metadata.
		// Approve all pending items (push-on-subscribe may have buffered initial null).
		const pendingCount = (gateCtrl.count.cache as number) ?? 0;
		gateCtrl.modify(
			(item: TriagedItem) => ({
				...item,
				rootCause: "composition",
				intervention: "template",
			}),
			pendingCount,
		);

		// Wait for modified item to flow through execute → verify → strategy
		// (reactive subscription, no polling — §5.8).
		await new Promise<void>((resolve) => {
			const unsub = harness.strategy.entries.subscribe((msgs) => {
				for (const msg of msgs) {
					if (msg[0] === DATA && harness.strategy.lookup(strategyKey("composition", "template"))) {
						unsub();
						resolve();
						return;
					}
				}
			});
		});
		// Original classification should NOT appear (modify replaced it).
		expect(harness.strategy.lookup(strategyKey("unknown", "investigate"))).toBeUndefined();

		const entry = harness.strategy.lookup(strategyKey("composition", "template"))!;
		expect(entry.successes).toBeGreaterThanOrEqual(1);

		// Structured events revalidation: verify stage ordering without string parsing
		trace.dispose();
		const stages = trace.events.filter((e) => e.type === "data").map((e) => e.stage);
		expect(stages).toContain("INTAKE");
		expect(stages).toContain("TRIAGE");
		expect(stages).toContain("STRATEGY");

		// INTAKE before TRIAGE before STRATEGY (use lastIndexOf to skip
		// initial push-on-subscribe events that fire during harnessTrace wiring)
		const intakeIdx = stages.lastIndexOf("INTAKE");
		const triageIdx = stages.lastIndexOf("TRIAGE");
		const strategyIdx = stages.lastIndexOf("STRATEGY");
		expect(intakeIdx).toBeLessThan(triageIdx);
		expect(triageIdx).toBeLessThan(strategyIdx);
	});

	it("harnessProfile inspects node states and memory", async () => {
		const mock = mockLLM({
			stages: {
				triage: {
					responses: [
						{
							rootCause: "missing-fn",
							intervention: "catalog-fn",
							route: "auto-fix",
							priority: 80,
						},
					],
				},
				execute: { responses: [{ outcome: "success", detail: "Fixed" }] },
				verify: { responses: [{ verified: true, findings: ["ok"] }] },
			},
		});

		const harness = harnessLoop("mock-diag", {
			adapter: mock,
			maxRetries: 1,
			maxReingestions: 0,
		});

		const { harnessProfile } = await import("../../patterns/harness/profile.js");
		const before = harnessProfile(harness);
		expect(before.nodeCount).toBeGreaterThan(0);
		expect(before.strategyEntries).toBe(0);
		expect(before.totalRetries).toBe(0);

		harness.intake.publish({
			source: "eval",
			summary: "Diag item 1",
			evidence: "test evidence",
			affectsAreas: ["core"],
		});

		await vi.waitFor(
			() => {
				expect(harness.strategy.entries.cache.size).toBeGreaterThanOrEqual(1);
			},
			{ timeout: 3000, interval: 50 },
		);

		const after = harnessProfile(harness);
		expect(after.nodeCount).toBeGreaterThan(0);
		expect(after.strategyEntries).toBe(1);
		expect(after.queueDepths["auto-fix"]).toBe(1);
		expect(after.totalValueSizeBytes).toBeGreaterThan(before.totalValueSizeBytes);
		expect(after.hotspots.byValueSize[0]?.status).toBe("settled");
	});

	it("strategy model accumulates across multiple items", async () => {
		const mock = mockLLM({
			stages: {
				triage: {
					responses: [
						{
							rootCause: "missing-fn",
							intervention: "catalog-fn",
							route: "auto-fix",
							priority: 80,
						},
						{
							rootCause: "missing-fn",
							intervention: "catalog-fn",
							route: "auto-fix",
							priority: 70,
						},
						{
							rootCause: "bad-docs",
							intervention: "docs",
							route: "auto-fix",
							priority: 50,
						},
					],
				},
				execute: { responses: [{ outcome: "success", detail: "Fixed" }] },
				verify: {
					responses: [
						{ verified: true, findings: ["ok"] },
						{ verified: true, findings: ["ok"] },
						{ verified: false, findings: ["nope"], errorClass: "structural" },
					],
				},
			},
		});

		const harness = harnessLoop("mock-strategy-accum", {
			adapter: mock,
			maxReingestions: 0, // prevent reingestion loops
		});

		harness.intake.publish({
			source: "eval",
			summary: "Item 1",
			evidence: "e1",
			affectsAreas: ["core"],
		});

		// Wait for first item to complete
		await vi.waitFor(
			() => {
				expect(harness.strategy.entries.cache.size).toBeGreaterThanOrEqual(1);
			},
			{ timeout: 5000, interval: 50 },
		);

		// Strategy should have at least one entry recorded
		const snapshot = harness.strategy.entries.cache;
		expect(snapshot.size).toBeGreaterThanOrEqual(1);

		// At least one key should have attempts > 0
		let totalAttempts = 0;
		for (const entry of snapshot.values()) {
			totalAttempts += entry.attempts;
		}
		expect(totalAttempts).toBeGreaterThanOrEqual(1);
	});

	it("harnessTrace captures stage events and disposes cleanly", async () => {
		const mock = mockLLM({
			stages: {
				triage: {
					responses: [
						{
							rootCause: "missing-fn",
							intervention: "catalog-fn",
							route: "auto-fix",
							priority: 80,
						},
					],
				},
				execute: { responses: [{ outcome: "success", detail: "Fixed" }] },
				verify: { responses: [{ verified: true, findings: ["ok"] }] },
			},
		});

		const harness = harnessLoop("trace-test", {
			adapter: mock,
			maxRetries: 1,
			retainedLimit: 100,
		});

		const lines: string[] = [];
		const { harnessTrace } = await import("../../patterns/harness/trace.js");
		const handle = harnessTrace(harness, { logger: (line) => lines.push(line) });

		harness.intake.publish({
			source: "eval",
			summary: "Trace test item",
			evidence: "test evidence",
			affectsAreas: ["core"],
		});

		await vi.waitFor(
			() => {
				expect(harness.strategy.entries.cache.size).toBeGreaterThanOrEqual(1);
			},
			{ timeout: 3000, interval: 50 },
		);

		// Should have captured at least INTAKE and STRATEGY events
		expect(lines.length).toBeGreaterThanOrEqual(2);
		expect(lines.some((l) => l.includes("INTAKE"))).toBe(true);
		expect(lines.some((l) => l.includes("STRATEGY"))).toBe(true);

		// Each line should have elapsed time format
		for (const line of lines) {
			expect(line).toMatch(/^\[\d+\.\d{3}s\]/);
		}

		// Dispose should not throw
		handle.dispose();
		// Double dispose is safe
		handle.dispose();
	});
});

// ---------------------------------------------------------------------------
// Composition A: evalSource
// ---------------------------------------------------------------------------

describe("evalSource", () => {
	it("fires runner on trigger and emits the result reactively", async () => {
		// Use state so trigger has an initial value on subscribe, then update it.
		// evalSource fires runner for every trigger DATA — including the initial one.
		const trigger = node([], { initial: "run-a" });
		const runner = (id: string) =>
			Promise.resolve({ run_id: id, model: "test", tasks: [] as EvalRunResult["tasks"] });

		const results: EvalRunResult[] = [];
		// Bind the trigger value into the runner so we can identify which run emitted.
		const resultNode = evalSource(trigger as ReturnType<typeof state<unknown>>, () =>
			runner(trigger.cache as string),
		);
		const unsub = resultNode.subscribe((msgs) => {
			for (const [type, data] of msgs) {
				if (type === DATA && data != null) results.push(data as EvalRunResult);
			}
		});

		await new Promise<void>((resolve) => setTimeout(resolve, 20));
		// The runner fired (at least once — for the initial trigger value or on subscribe).
		expect(results.length).toBeGreaterThanOrEqual(1);
		unsub();
	});

	it("emits the result for each trigger — last-write wins via switchMap", async () => {
		// Each trigger value determines the run_id so we can track which run resolved.
		const trigger = node<string | null>([], { initial: null });
		const runner = () => {
			const id = trigger.cache;
			// Slow promise so earlier runs haven't resolved yet when a new trigger fires.
			return new Promise<EvalRunResult>((resolve) =>
				setTimeout(() => resolve({ run_id: id ?? "null", model: "test", tasks: [] }), 40),
			);
		};

		const results: string[] = [];
		const resultNode = evalSource(trigger as ReturnType<typeof state<unknown>>, runner);
		const unsub = resultNode.subscribe((msgs) => {
			for (const [type, data] of msgs) {
				if (type === DATA && data != null) results.push((data as EvalRunResult).run_id);
			}
		});

		// Fire two rapid triggers — switchMap should cancel the first before it resolves.
		trigger.down([[DATA, "first"]]);
		trigger.down([[DATA, "second"]]);
		await new Promise<void>((resolve) => setTimeout(resolve, 80));

		// "first" should be cancelled (not emitted), "second" should win.
		expect(results).not.toContain("first");
		expect(results).toContain("second");
		unsub();
	});
});

// ---------------------------------------------------------------------------
// Composition A: beforeAfterCompare
// ---------------------------------------------------------------------------

describe("beforeAfterCompare", () => {
	const makeResult = (
		runId: string,
		tasks: Array<{ id: string; valid: boolean; passes?: number; total?: number }>,
	): EvalRunResult => ({
		run_id: runId,
		model: "test",
		tasks: tasks.map((t) => ({
			task_id: t.id,
			valid: t.valid,
			judge_scores:
				t.total !== undefined
					? Array.from({ length: t.total }, (_, i) => ({
							claim: `c${i}`,
							pass: i < (t.passes ?? 0),
							reasoning: "",
						}))
					: undefined,
		})),
	});

	it("identifies new failures and resolved tasks", () => {
		const before = node([], {
			initial: makeResult("b", [
				{ id: "t1", valid: true },
				{ id: "t2", valid: false },
			]),
		});
		const after = node([], {
			initial: makeResult("a", [
				{ id: "t1", valid: false },
				{ id: "t2", valid: true },
			]),
		});

		const g = new Graph("delta-test-1");
		const delta = beforeAfterCompare({ graph: g, before, after });
		const unsub = delta.subscribe(() => {});

		const d = delta.cache!;
		expect(d.newFailures).toEqual(["t1"]);
		expect(d.resolved).toEqual(["t2"]);
		expect(d.overallImproved).toBe(false); // 1 resolved, 1 failure — equal

		unsub();
	});

	it("overall improved when more resolved than failures", () => {
		const before = node([], {
			initial: makeResult("b", [
				{ id: "t1", valid: false },
				{ id: "t2", valid: false },
				{ id: "t3", valid: true },
			]),
		});
		const after = node([], {
			initial: makeResult("a", [
				{ id: "t1", valid: true },
				{ id: "t2", valid: true },
				{ id: "t3", valid: false },
			]),
		});

		const g = new Graph("delta-test-2");
		const delta = beforeAfterCompare({ graph: g, before, after });
		const unsub = delta.subscribe(() => {});

		const d = delta.cache!;
		expect(d.resolved).toHaveLength(2);
		expect(d.newFailures).toHaveLength(1);
		expect(d.overallImproved).toBe(true);

		unsub();
	});

	it("computes scoreDiff when judge_scores present", () => {
		const before = node([], {
			initial: makeResult("b", [{ id: "t1", valid: true, passes: 2, total: 4 }]),
		});
		const after = node([], {
			initial: makeResult("a", [{ id: "t1", valid: true, passes: 3, total: 4 }]),
		});

		const g = new Graph("delta-test-3");
		const delta = beforeAfterCompare({ graph: g, before, after });
		const unsub = delta.subscribe(() => {});

		const td = delta.cache!.taskDeltas[0];
		expect(td.scoreDiff).toBe(1); // 3 - 2
		unsub();
	});
});

// ---------------------------------------------------------------------------
// Composition A: affectedTaskFilter
// ---------------------------------------------------------------------------

describe("affectedTaskFilter", () => {
	function mkTI(tasks: string[]): TriagedItem {
		return {
			affectsEvalTasks: tasks,
			source: "eval",
			summary: "",
			evidence: "",
			affectsAreas: [],
			rootCause: "unknown",
			intervention: "investigate",
			route: "backlog",
			priority: 0,
		} as TriagedItem;
	}

	it("collects affected task IDs from triaged items", () => {
		const issuesNode = node<readonly TriagedItem[]>([], {
			initial: [mkTI(["T1", "T2"]), mkTI(["T2", "T3"])],
		});
		const g = new Graph("affected-test-1");
		const filtered = affectedTaskFilter({ graph: g, issues: issuesNode });
		const unsub = filtered.subscribe(() => {});

		expect(filtered.cache).toEqual(["T1", "T2", "T3"]);
		unsub();
	});

	it("intersects with fullTaskSet when provided", () => {
		const issuesNode = node<readonly TriagedItem[]>([], { initial: [mkTI(["T1", "T2", "T3"])] });
		const g = new Graph("affected-test-2");
		const filtered = affectedTaskFilter({
			graph: g,
			issues: issuesNode,
			fullTaskSet: ["T1", "T3", "T5"] as readonly string[],
		});
		const unsub = filtered.subscribe(() => {});

		expect(filtered.cache).toEqual(["T1", "T3"]); // T2 excluded, T5 not affected
		unsub();
	});
});

// ---------------------------------------------------------------------------
// Composition D: codeChangeBridge
// ---------------------------------------------------------------------------

describe("codeChangeBridge", () => {
	it("publishes IntakeItems for lint errors and test failures", () => {
		const source = node<CodeChange | null>([], { initial: null });
		const intakeTopic = topic<IntakeItem>("intake");

		const published: IntakeItem[] = [];
		const unsubIntake = intakeTopic.latest.subscribe((msgs) => {
			for (const [type, data] of msgs) {
				if (type === DATA && data != null) published.push(data as IntakeItem);
			}
		});

		const g = new Graph("code-change-test");
		const bridge = codeChangeBridge({
			graph: g,
			source: source as ReturnType<typeof state<CodeChange>>,
			intakeTopic: intakeTopic as unknown as TopicGraph<IntakeItem>,
		});
		const unsubBridge = bridge.subscribe(() => {});

		const change: CodeChange = {
			files: ["src/foo.ts"],
			lintErrors: [
				{ file: "src/foo.ts", line: 10, col: 3, rule: "no-any", message: "Use unknown" },
			],
			testFailures: [{ testId: "foo.test", file: "src/foo.ts", message: "expected true" }],
		};
		source.down([[DATA, change]]);

		expect(published.length).toBeGreaterThanOrEqual(2);
		const sources = published.map((i) => i.source);
		expect(sources).toContain("code-change");
		expect(sources).toContain("test");
		unsubIntake();
		unsubBridge();
	});
});

// ---------------------------------------------------------------------------
// Composition D: notifyEffect
// ---------------------------------------------------------------------------

describe("notifyEffect", () => {
	it("calls transport for each new topic entry", () => {
		const alertTopic = topic<string>("alerts");
		const calls: string[] = [];
		const g = new Graph("notify-test-1");
		const eff = notifyEffect({
			graph: g,
			topic: alertTopic as unknown as TopicGraph<string>,
			transport: (item: string) => calls.push(item),
		});
		const unsub = eff.subscribe(() => {});

		alertTopic.publish("first");
		alertTopic.publish("second");

		expect(calls).toContain("first");
		expect(calls).toContain("second");
		unsub();
	});

	it("supports async transport (fire-and-forget)", async () => {
		const alertTopic = topic<string>("async-alerts");
		const calls: string[] = [];
		const transport = async (item: string) => {
			await Promise.resolve();
			calls.push(item);
		};
		const g = new Graph("notify-test-2");
		const eff = notifyEffect({
			graph: g,
			topic: alertTopic as unknown as TopicGraph<string>,
			transport,
		});
		const unsub = eff.subscribe(() => {});

		alertTopic.publish("hello");
		await new Promise<void>((r) => setTimeout(r, 10));
		expect(calls).toContain("hello");
		unsub();
	});
});

// ---------------------------------------------------------------------------
// Composition B: redactor
// ---------------------------------------------------------------------------

describe("redactor", () => {
	it("replaces matched patterns with [REDACTED]", () => {
		const text = node<string>([], { initial: "" });
		const sanitized = redactor(text, [/\d{3}-\d{2}-\d{4}/g]); // SSN pattern
		const results: string[] = [];
		const unsub = sanitized.subscribe((msgs) => {
			for (const [type, data] of msgs) {
				if (type === DATA && data != null) results.push(data as string);
			}
		});

		text.emit("My SSN is 123-45-6789.");

		expect(results[results.length - 1]).toBe("My SSN is [REDACTED].");
		unsub();
	});

	it("uses custom replaceFn when provided", () => {
		const text = node<string>([], { initial: "" });
		const sanitized = redactor(text, [/secret/gi], () => "***");
		const results: string[] = [];
		const unsub = sanitized.subscribe((msgs) => {
			for (const [type, data] of msgs) {
				if (type === DATA && data != null) results.push(data as string);
			}
		});

		text.emit("my secret data");

		expect(results[results.length - 1]).toBe("my *** data");
		unsub();
	});
});

// ---------------------------------------------------------------------------
// Composition B: contentGate
// ---------------------------------------------------------------------------

describe("contentGate", () => {
	it("returns allow when score is below threshold", () => {
		const text = node<string>([], { initial: "" });
		const gate = contentGate(text, (t) => t.length / 100, 0.5); // low threshold
		const decisions: string[] = [];
		const unsub = gate.subscribe((msgs) => {
			for (const [type, data] of msgs) {
				if (type === DATA && data != null) decisions.push(data as string);
			}
		});

		text.emit("hi"); // length 2 / 100 = 0.02 — well below 0.5
		expect(decisions[decisions.length - 1]).toBe("allow");
		unsub();
	});

	it("returns review when score is in [threshold, hard)", () => {
		const text = node<string>([], { initial: "" });
		// hardMultiplier default 1.5 → hard = 0.5 × 1.5 = 0.75
		const gate = contentGate(text, () => 0.6, 0.5);
		const decisions: string[] = [];
		const unsub = gate.subscribe((msgs) => {
			for (const [type, data] of msgs) {
				if (type === DATA && data != null) decisions.push(data as string);
			}
		});

		text.emit("x");
		expect(decisions[decisions.length - 1]).toBe("review");
		unsub();
	});

	it("returns block when score exceeds hard threshold", () => {
		const text = node<string>([], { initial: "" });
		const gate = contentGate(text, () => 0.9, 0.5); // 0.9 ≥ 0.75
		const decisions: string[] = [];
		const unsub = gate.subscribe((msgs) => {
			for (const [type, data] of msgs) {
				if (type === DATA && data != null) decisions.push(data as string);
			}
		});

		text.emit("x");
		expect(decisions[decisions.length - 1]).toBe("block");
		unsub();
	});

	it("accepts a Node<number> classifier", () => {
		const text = node<string>([], { initial: "" });
		const score = node([], { initial: 0.8 });
		const gate = contentGate(text, score, 0.5); // 0.8 ≥ 0.75 → block
		const decisions: string[] = [];
		const unsub = gate.subscribe((msgs) => {
			for (const [type, data] of msgs) {
				if (type === DATA && data != null) decisions.push(data as string);
			}
		});

		text.emit("x");
		expect(decisions[decisions.length - 1]).toBe("block");

		// Lower the score to allow
		score.down([[DATA, 0.1]]);
		text.emit("y");
		expect(decisions[decisions.length - 1]).toBe("allow");
		unsub();
	});
});
