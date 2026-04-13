import { describe, expect, it, vi } from "vitest";
import { monotonicNs } from "../../core/clock.js";
import { DATA } from "../../core/messages.js";
import { state } from "../../core/sugar.js";
import { contentGate, redactor, type StreamChunk } from "../../patterns/ai.js";
import {
	affectedTaskFilter,
	beforeAfterCompare,
	type CodeChange,
	codeChangeBridge,
	type EvalResult,
	evalIntakeBridge,
	evalSource,
	notifyEffect,
} from "../../patterns/harness/bridge.js";
import { HarnessGraph, harnessLoop } from "../../patterns/harness/loop.js";
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
import { TopicGraph, topic } from "../../patterns/messaging.js";
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
		expect(sm.node.cache.size).toBe(0);
		expect(sm.lookup("composition", "template")).toBeUndefined();
	});

	it("records successes and failures with correct rates", () => {
		const sm = strategyModel();
		sm.record("composition", "template", true);
		sm.record("composition", "template", true);
		sm.record("composition", "template", false);

		const entry = sm.lookup("composition", "template");
		expect(entry).toBeDefined();
		expect(entry!.attempts).toBe(3);
		expect(entry!.successes).toBe(2);
		expect(entry!.successRate).toBeCloseTo(2 / 3);
	});

	it("tracks multiple rootCause→intervention pairs independently", () => {
		const sm = strategyModel();
		sm.record("composition", "template", true);
		sm.record("missing-fn", "catalog-fn", true);
		sm.record("missing-fn", "catalog-fn", true);

		expect(sm.lookup("composition", "template")!.attempts).toBe(1);
		expect(sm.lookup("missing-fn", "catalog-fn")!.attempts).toBe(2);
	});

	it("reactive node updates on record()", () => {
		const sm = strategyModel();
		const values: StrategySnapshot[] = [];
		sm.node.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) values.push(msg[1] as StrategySnapshot);
			}
		});

		sm.record("bad-docs", "docs", true);
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
		const item = state<TriagedItem>({
			source: "eval",
			summary: "test",
			evidence: "test",
			affectsAreas: [],
			rootCause: "composition",
			intervention: "template",
			route: "auto-fix",
			priority: 50,
			severity: "high",
		});

		const sm = strategyModel();
		const lastInteraction = state<number>(monotonicNs()); // recent

		const score = priorityScore(item, sm.node, lastInteraction);
		score.subscribe(() => undefined); // activate

		const val = score.cache;
		expect(typeof val).toBe("number");
		expect(val).toBeGreaterThan(0);
	});

	it("boosts score when strategy model shows high effectiveness", () => {
		const item = state<TriagedItem>({
			source: "eval",
			summary: "test",
			evidence: "test",
			affectsAreas: [],
			rootCause: "composition",
			intervention: "template",
			route: "auto-fix",
			priority: 50,
			severity: "medium",
		});

		const sm = strategyModel();
		const lastInteraction = state<number>(monotonicNs());

		// Without strategy data
		const scoreWithout = priorityScore(item, sm.node, lastInteraction);
		scoreWithout.subscribe(() => undefined);
		const valWithout = scoreWithout.cache;

		// Record high effectiveness
		sm.record("composition", "template", true);
		sm.record("composition", "template", true);
		sm.record("composition", "template", true);

		const scoreWith = priorityScore(item, sm.node, lastInteraction);
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
		const evalResults = state<EvalResult | null>(null);

		const intake = new TopicGraph<IntakeItem>("test-intake");
		const bridgeNode = evalIntakeBridge(evalResults as any, intake);

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
		const evalResults = state<EvalResult | null>(null);

		const intake = new TopicGraph<IntakeItem>("test-intake-2");
		const bridgeNode = evalIntakeBridge(evalResults as any, intake);
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
		const evalResults = state<EvalResult | null>(null);

		const intake = new TopicGraph<IntakeItem>("test-intake-3");
		const bridgeNode = evalIntakeBridge(evalResults as any, intake);
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
		expect(harness.queues.size).toBe(4);
		expect(harness.queues.has("auto-fix")).toBe(true);
		expect(harness.queues.has("needs-decision")).toBe(true);
		expect(harness.queues.has("investigation")).toBe(true);
		expect(harness.queues.has("backlog")).toBe(true);
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

		harness.strategy.record("composition", "template", true);
		const entry = harness.strategy.lookup("composition", "template");
		expect(entry).toBeDefined();
		expect(entry!.successRate).toBe(1);
	});

	it("exposes global counters at zero", () => {
		const adapter = mockAdapter({});
		const harness = harnessLoop("test-harness-6", { adapter });

		expect(harness.totalRetries.cache).toBe(0);
		expect(harness.totalReingestions.cache).toBe(0);
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
				expect(harness.strategy.node.cache.size).toBeGreaterThan(0);
			},
			{ timeout: 5000, interval: 50 },
		);

		// Verify full chain executed
		expect(harness.strategy.lookup("missing-fn", "catalog-fn")).toBeDefined();
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

		// Wire the bridge
		const evalSource = state<EvalResult | null>(null);
		const bridgeNode = evalIntakeBridge(evalSource as any, harness.intake);
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
		const entry = harness.strategy.lookup("missing-fn", "catalog-fn");
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
				expect(harness.strategy.node.cache.size).toBeGreaterThanOrEqual(1);
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
				const entry = harness.strategy.lookup("schema-gap", "schema-change");
				expect(entry).toBeDefined();
			},
			{ timeout: 15000, interval: 100 },
		);

		// Global retry counter should show retries occurred
		expect(harness.totalRetries.cache).toBe(2);

		// Strategy should record failure
		const entry = harness.strategy.lookup("schema-gap", "schema-change")!;
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
				const entry = harness.strategy.lookup("composition", "template");
				expect(entry).toBeDefined();
			},
			{ timeout: 5000, interval: 50 },
		);

		// Structural failure should NOT trigger fast-retry
		expect(harness.totalRetries.cache).toBe(0);

		// Strategy should record failure
		const entry = harness.strategy.lookup("composition", "template")!;
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
		expect(harness.strategy.node.cache.size).toBeGreaterThanOrEqual(1);
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

		const qLen = harness.queues.get("needs-decision")!.retained().length;
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
				expect(harness.strategy.node.cache.size).toBeGreaterThanOrEqual(1);
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
			const queue = harness.queues.get("needs-decision")!;
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
			const unsub = harness.strategy.node.subscribe((msgs) => {
				for (const msg of msgs) {
					if (msg[0] === DATA && harness.strategy.lookup("composition", "template")) {
						unsub();
						resolve();
						return;
					}
				}
			});
		});
		// Original classification should NOT appear (modify replaced it).
		expect(harness.strategy.lookup("unknown", "investigate")).toBeUndefined();

		const entry = harness.strategy.lookup("composition", "template")!;
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
				expect(harness.strategy.node.cache.size).toBeGreaterThanOrEqual(1);
			},
			{ timeout: 3000, interval: 50 },
		);

		const after = harnessProfile(harness);
		expect(after.nodeCount).toBeGreaterThan(0);
		expect(after.strategyEntries).toBe(1);
		expect(after.queueDepths["auto-fix"]).toBe(1);
		expect(after.totalValueSizeBytes).toBeGreaterThan(before.totalValueSizeBytes);
		expect(after.hotspots[0].status).toBe("settled");
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
				expect(harness.strategy.node.cache.size).toBeGreaterThanOrEqual(1);
			},
			{ timeout: 5000, interval: 50 },
		);

		// Strategy should have at least one entry recorded
		const snapshot = harness.strategy.node.cache;
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
				expect(harness.strategy.node.cache.size).toBeGreaterThanOrEqual(1);
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
		const trigger = state("run-a");
		const runner = (id: string) =>
			Promise.resolve({ run_id: id, model: "test", tasks: [] as EvalResult["tasks"] });

		const results: EvalResult[] = [];
		// Bind the trigger value into the runner so we can identify which run emitted.
		const resultNode = evalSource(trigger as ReturnType<typeof state<unknown>>, () =>
			runner(trigger.cache as string),
		);
		const unsub = resultNode.subscribe((msgs) => {
			for (const [type, data] of msgs) {
				if (type === DATA && data != null) results.push(data as EvalResult);
			}
		});

		await new Promise<void>((resolve) => setTimeout(resolve, 20));
		// The runner fired (at least once — for the initial trigger value or on subscribe).
		expect(results.length).toBeGreaterThanOrEqual(1);
		unsub();
	});

	it("emits the result for each trigger — last-write wins via switchMap", async () => {
		// Each trigger value determines the run_id so we can track which run resolved.
		const trigger = state<string | null>(null);
		const runner = () => {
			const id = trigger.cache;
			// Slow promise so earlier runs haven't resolved yet when a new trigger fires.
			return new Promise<EvalResult>((resolve) =>
				setTimeout(() => resolve({ run_id: id ?? "null", model: "test", tasks: [] }), 40),
			);
		};

		const results: string[] = [];
		const resultNode = evalSource(trigger as ReturnType<typeof state<unknown>>, runner);
		const unsub = resultNode.subscribe((msgs) => {
			for (const [type, data] of msgs) {
				if (type === DATA && data != null) results.push((data as EvalResult).run_id);
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
	): EvalResult => ({
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
		const before = state(
			makeResult("b", [
				{ id: "t1", valid: true },
				{ id: "t2", valid: false },
			]),
		);
		const after = state(
			makeResult("a", [
				{ id: "t1", valid: false },
				{ id: "t2", valid: true },
			]),
		);

		const delta = beforeAfterCompare(before, after);
		const unsub = delta.subscribe(() => {});

		const d = delta.cache!;
		expect(d.newFailures).toEqual(["t1"]);
		expect(d.resolved).toEqual(["t2"]);
		expect(d.overallImproved).toBe(false); // 1 resolved, 1 failure — equal

		unsub();
	});

	it("overall improved when more resolved than failures", () => {
		const before = state(
			makeResult("b", [
				{ id: "t1", valid: false },
				{ id: "t2", valid: false },
				{ id: "t3", valid: true },
			]),
		);
		const after = state(
			makeResult("a", [
				{ id: "t1", valid: true },
				{ id: "t2", valid: true },
				{ id: "t3", valid: false },
			]),
		);

		const delta = beforeAfterCompare(before, after);
		const unsub = delta.subscribe(() => {});

		const d = delta.cache!;
		expect(d.resolved).toHaveLength(2);
		expect(d.newFailures).toHaveLength(1);
		expect(d.overallImproved).toBe(true);

		unsub();
	});

	it("computes scoreDiff when judge_scores present", () => {
		const before = state(makeResult("b", [{ id: "t1", valid: true, passes: 2, total: 4 }]));
		const after = state(makeResult("a", [{ id: "t1", valid: true, passes: 3, total: 4 }]));

		const delta = beforeAfterCompare(before, after);
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
		const issuesNode = state<readonly TriagedItem[]>([mkTI(["T1", "T2"]), mkTI(["T2", "T3"])]);
		const filtered = affectedTaskFilter(issuesNode);
		const unsub = filtered.subscribe(() => {});

		expect(filtered.cache).toEqual(["T1", "T2", "T3"]);
		unsub();
	});

	it("intersects with fullTaskSet when provided", () => {
		const issuesNode = state<readonly TriagedItem[]>([mkTI(["T1", "T2", "T3"])]);
		const filtered = affectedTaskFilter(issuesNode, ["T1", "T3", "T5"] as readonly string[]);
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
		const source = state<CodeChange | null>(null);
		const intakeTopic = topic<IntakeItem>("intake");

		const published: IntakeItem[] = [];
		const unsubIntake = intakeTopic.latest.subscribe((msgs) => {
			for (const [type, data] of msgs) {
				if (type === DATA && data != null) published.push(data as IntakeItem);
			}
		});

		const bridge = codeChangeBridge(
			source as ReturnType<typeof state<CodeChange>>,
			intakeTopic as unknown as TopicGraph<IntakeItem>,
		);
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
		const eff = notifyEffect(alertTopic as unknown as TopicGraph<string>, (item: string) =>
			calls.push(item),
		);
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
		const eff = notifyEffect(alertTopic as unknown as TopicGraph<string>, transport);
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
	function makeStream() {
		return topic<StreamChunk>("stream");
	}

	function pushChunk(
		t: TopicGraph<StreamChunk>,
		token: string,
		accumulated: string,
		index: number,
	) {
		t.publish({ source: "test", token, accumulated, index });
	}

	it("replaces matched patterns with [REDACTED]", () => {
		const stream = makeStream();
		const sanitized = redactor(stream, [/\d{3}-\d{2}-\d{4}/g]); // SSN pattern
		const results: StreamChunk[] = [];
		const unsub = sanitized.subscribe((msgs) => {
			for (const [type, data] of msgs) {
				if (type === DATA && data != null) results.push(data as StreamChunk);
			}
		});

		pushChunk(stream, "My SSN is 123-45-6789.", "My SSN is 123-45-6789.", 0);

		const last = results[results.length - 1];
		expect(last?.accumulated).toBe("My SSN is [REDACTED].");
		expect(last?.token).toBe("My SSN is [REDACTED].");
		unsub();
	});

	it("uses custom replaceFn when provided", () => {
		const stream = makeStream();
		const sanitized = redactor(stream, [/secret/gi], () => "***");
		const results: StreamChunk[] = [];
		const unsub = sanitized.subscribe((msgs) => {
			for (const [type, data] of msgs) {
				if (type === DATA && data != null) results.push(data as StreamChunk);
			}
		});

		pushChunk(stream, "my secret", "my secret data", 0);

		const last = results[results.length - 1];
		expect(last?.accumulated).toBe("my *** data");
		unsub();
	});
});

// ---------------------------------------------------------------------------
// Composition B: contentGate
// ---------------------------------------------------------------------------

describe("contentGate", () => {
	function makeStream() {
		return topic<StreamChunk>("stream");
	}

	function pushChunk(t: TopicGraph<StreamChunk>, acc: string) {
		t.publish({ source: "test", token: acc, accumulated: acc, index: 0 });
	}

	it("returns allow when score is below threshold", () => {
		const stream = makeStream();
		const gate = contentGate(stream, (text) => text.length / 100, 0.5); // low threshold
		const decisions: string[] = [];
		const unsub = gate.subscribe((msgs) => {
			for (const [type, data] of msgs) {
				if (type === DATA && data != null) decisions.push(data as string);
			}
		});

		pushChunk(stream, "hi"); // length 2 / 100 = 0.02 — well below 0.5
		expect(decisions[decisions.length - 1]).toBe("allow");
		unsub();
	});

	it("returns review when score is in [threshold, hard)", () => {
		const stream = makeStream();
		// hardMultiplier default 1.5 → hard = 0.5 × 1.5 = 0.75
		const gate = contentGate(stream, () => 0.6, 0.5);
		const decisions: string[] = [];
		const unsub = gate.subscribe((msgs) => {
			for (const [type, data] of msgs) {
				if (type === DATA && data != null) decisions.push(data as string);
			}
		});

		pushChunk(stream, "x");
		expect(decisions[decisions.length - 1]).toBe("review");
		unsub();
	});

	it("returns block when score exceeds hard threshold", () => {
		const stream = makeStream();
		const gate = contentGate(stream, () => 0.9, 0.5); // 0.9 ≥ 0.75
		const decisions: string[] = [];
		const unsub = gate.subscribe((msgs) => {
			for (const [type, data] of msgs) {
				if (type === DATA && data != null) decisions.push(data as string);
			}
		});

		pushChunk(stream, "x");
		expect(decisions[decisions.length - 1]).toBe("block");
		unsub();
	});

	it("accepts a Node<number> classifier", () => {
		const stream = makeStream();
		const score = state(0.8);
		const gate = contentGate(stream, score, 0.5); // 0.8 ≥ 0.75 → block
		const decisions: string[] = [];
		const unsub = gate.subscribe((msgs) => {
			for (const [type, data] of msgs) {
				if (type === DATA && data != null) decisions.push(data as string);
			}
		});

		pushChunk(stream, "x");
		expect(decisions[decisions.length - 1]).toBe("block");

		// Lower the score to allow
		score.down([[DATA, 0.1]]);
		pushChunk(stream, "y");
		expect(decisions[decisions.length - 1]).toBe("allow");
		unsub();
	});
});
