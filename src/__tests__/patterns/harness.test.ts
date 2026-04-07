import { describe, expect, it } from "vitest";
import { monotonicNs } from "../../core/clock.js";
import { DATA } from "../../core/messages.js";
import { state } from "../../core/sugar.js";
import { type EvalResult, evalIntakeBridge } from "../../patterns/harness/bridge.js";
import { HarnessGraph, harnessLoop } from "../../patterns/harness/loop.js";
import {
	priorityScore,
	type StrategySnapshot,
	strategyModel,
} from "../../patterns/harness/strategy.js";
import {
	DEFAULT_DECAY_RATE,
	DEFAULT_SEVERITY_WEIGHTS,
	defaultErrorClassifier,
	type ExecutionResult,
	type IntakeItem,
	type StrategyEntry,
	strategyKey,
	type TriagedItem,
	type VerifyResult,
} from "../../patterns/harness/types.js";
import { TopicGraph } from "../../patterns/messaging.js";

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
			retryCount: 0,
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
			retryCount: 0,
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
		expect(sm.node.get().size).toBe(0);
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

		const val = score.get();
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
		const valWithout = scoreWithout.get();

		// Record high effectiveness
		sm.record("composition", "template", true);
		sm.record("composition", "template", true);
		sm.record("composition", "template", true);

		const scoreWith = priorityScore(item, sm.node, lastInteraction);
		scoreWith.subscribe(() => undefined);
		const valWith = scoreWith.get();

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
});
