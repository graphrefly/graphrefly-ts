import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	BudgetExceededError,
	type BudgetGateOptions,
	withBudgetGate,
} from "../../../evals/lib/budget-gate.js";
import { createDryRunProvider } from "../../../evals/lib/dry-run-provider.js";
import type { LLMProvider, LLMRequest, LLMResponse } from "../../../evals/lib/llm-client.js";
import { ReplayCacheMissError, withReplayCache } from "../../../evals/lib/replay-cache.js";

// ---------------------------------------------------------------------------
// Test provider — counts calls, parameterizable response.
// ---------------------------------------------------------------------------

function makeMockProvider(
	responses: readonly LLMResponse[] | ((req: LLMRequest, n: number) => LLMResponse),
): LLMProvider & { calls: number } {
	let n = 0;
	const provider = {
		name: "mock",
		limits: {
			contextWindow: 100_000,
			maxOutputTokens: 10_000,
			rpm: 60,
			rpd: 1_000,
			tpm: 100_000,
		},
		async generate(req: LLMRequest): Promise<LLMResponse> {
			n += 1;
			provider.calls = n;
			if (typeof responses === "function") return responses(req, n);
			return responses[Math.min(n - 1, responses.length - 1)];
		},
		calls: 0,
	};
	return provider;
}

const sampleReq: LLMRequest = {
	system: "sys",
	user: "hi",
	model: "claude-haiku-4-5-20251001", // known in cost.ts pricing table
	maxTokens: 50,
};

// ---------------------------------------------------------------------------
// Dry-run provider
// ---------------------------------------------------------------------------

describe("createDryRunProvider", () => {
	it("returns canned content and zero tokens", async () => {
		const p = createDryRunProvider({ cannedContent: "stub" });
		const r = await p.generate(sampleReq);
		expect(r.content).toBe("stub");
		expect(r.inputTokens).toBe(0);
		expect(r.outputTokens).toBe(0);
		expect(r.latencyMs).toBe(0);
	});

	it("fires onCall with incrementing call numbers", async () => {
		const seen: number[] = [];
		const p = createDryRunProvider({ onCall: (_req, n) => seen.push(n) });
		await p.generate(sampleReq);
		await p.generate(sampleReq);
		await p.generate(sampleReq);
		expect(seen).toEqual([1, 2, 3]);
	});
});

// ---------------------------------------------------------------------------
// Budget gate
// ---------------------------------------------------------------------------

describe("withBudgetGate", () => {
	it("enforces maxCalls", async () => {
		const mock = makeMockProvider([
			{ content: "a", inputTokens: 10, outputTokens: 5, latencyMs: 1 },
		]);
		const gated = withBudgetGate(mock, { caps: { maxCalls: 2 } });
		await gated.generate(sampleReq);
		await gated.generate(sampleReq);
		await expect(gated.generate(sampleReq)).rejects.toBeInstanceOf(BudgetExceededError);
		expect(mock.calls).toBe(2); // third call never reached the inner provider
	});

	it("enforces maxPriceUsd post-call and surfaces on the crossing call", async () => {
		// haiku pricing: 0.8 input / 4 output per 1M. 1000 input + 500 output = $0.0028 per call.
		const mock = makeMockProvider([
			{ content: "a", inputTokens: 1000, outputTokens: 500, latencyMs: 1 },
		]);
		const exceeded: BudgetExceededError[] = [];
		const gated = withBudgetGate(mock, {
			caps: { maxPriceUsd: 0.005 },
			onExceed: (err) => exceeded.push(err),
		});
		// First call: priceUsd = 0.0028 < 0.005 → ok.
		await gated.generate(sampleReq);
		// Second call: 0.0056 ≥ 0.005 → inner runs, then post-call check throws.
		await expect(gated.generate(sampleReq)).rejects.toThrow(BudgetExceededError);
		expect(exceeded).toHaveLength(1);
		expect(exceeded[0].cap).toBe("maxPriceUsd");
		expect(mock.calls).toBe(2); // crossing call DID hit the inner provider
	});

	it("fires onUpdate after each successful call", async () => {
		const mock = makeMockProvider([
			{ content: "a", inputTokens: 10, outputTokens: 5, latencyMs: 1 },
		]);
		const states: number[] = [];
		const gated = withBudgetGate(mock, {
			caps: { maxCalls: 10 },
			onUpdate: (s) => states.push(s.calls),
		});
		await gated.generate(sampleReq);
		await gated.generate(sampleReq);
		expect(states).toEqual([1, 2]);
	});

	it("reset() clears state", async () => {
		const mock = makeMockProvider([
			{ content: "a", inputTokens: 10, outputTokens: 5, latencyMs: 1 },
		]);
		const gated = withBudgetGate(mock, { caps: { maxCalls: 2 } });
		await gated.generate(sampleReq);
		await gated.generate(sampleReq);
		await expect(gated.generate(sampleReq)).rejects.toThrow(BudgetExceededError);
		gated.reset();
		await expect(gated.generate(sampleReq)).resolves.toBeDefined();
	});

	it("unknown model contributes 0 price; relies on call/token caps", async () => {
		const mock = makeMockProvider([
			{ content: "a", inputTokens: 100, outputTokens: 100, latencyMs: 1 },
		]);
		const gated = withBudgetGate(mock, {
			caps: { maxPriceUsd: 0.01, maxCalls: 3 },
		});
		const reqUnknown: LLMRequest = { ...sampleReq, model: "unknown-model-xyz" };
		await gated.generate(reqUnknown);
		await gated.generate(reqUnknown);
		expect(gated.state.priceUsd).toBe(0); // unknown → zero
		// Call cap still enforced.
		await gated.generate(reqUnknown);
		await expect(gated.generate(reqUnknown)).rejects.toThrow(BudgetExceededError);
	});
});

// ---------------------------------------------------------------------------
// Replay cache
// ---------------------------------------------------------------------------

describe("withReplayCache", () => {
	let cacheDir: string;
	beforeEach(() => {
		cacheDir = mkdtempSync(join(tmpdir(), "replay-cache-test-"));
	});
	afterEach(() => {
		rmSync(cacheDir, { recursive: true, force: true });
	});

	it("writes on miss, reads on hit (read-write default)", async () => {
		const mock = makeMockProvider([
			{ content: "first", inputTokens: 10, outputTokens: 5, latencyMs: 123 },
		]);
		const wrapped = withReplayCache(mock, { cacheDir });
		const r1 = await wrapped.generate(sampleReq);
		expect(r1.content).toBe("first");
		expect(mock.calls).toBe(1);
		// Second call: cache hit — inner not invoked, latencyMs zeroed.
		const r2 = await wrapped.generate(sampleReq);
		expect(r2.content).toBe("first");
		expect(r2.latencyMs).toBe(0);
		expect(mock.calls).toBe(1);
	});

	it("read-only throws on miss", async () => {
		const mock = makeMockProvider([
			{ content: "x", inputTokens: 1, outputTokens: 1, latencyMs: 1 },
		]);
		const wrapped = withReplayCache(mock, { cacheDir, mode: "read-only" });
		await expect(wrapped.generate(sampleReq)).rejects.toBeInstanceOf(ReplayCacheMissError);
		expect(mock.calls).toBe(0);
	});

	it("write-only always calls inner and overwrites cache", async () => {
		const mock = makeMockProvider((_req, n) => ({
			content: `call-${n}`,
			inputTokens: n,
			outputTokens: n,
			latencyMs: 10,
		}));
		const wrapped = withReplayCache(mock, { cacheDir, mode: "write-only" });
		const r1 = await wrapped.generate(sampleReq);
		const r2 = await wrapped.generate(sampleReq);
		expect(r1.content).toBe("call-1");
		expect(r2.content).toBe("call-2");
		expect(mock.calls).toBe(2);
	});

	it("off: passthrough, nothing cached", async () => {
		const mock = makeMockProvider((_req, n) => ({
			content: `call-${n}`,
			inputTokens: n,
			outputTokens: n,
			latencyMs: 10,
		}));
		const wrapped = withReplayCache(mock, { cacheDir, mode: "off" });
		const r1 = await wrapped.generate(sampleReq);
		const r2 = await wrapped.generate(sampleReq);
		expect(r1.content).toBe("call-1");
		expect(r2.content).toBe("call-2");
	});

	it("different models yield different cache keys", async () => {
		const mock = makeMockProvider((req, n) => ({
			content: `${req.model}-${n}`,
			inputTokens: 1,
			outputTokens: 1,
			latencyMs: 1,
		}));
		const wrapped = withReplayCache(mock, { cacheDir });
		const a = await wrapped.generate({ ...sampleReq, model: "model-a" });
		const b = await wrapped.generate({ ...sampleReq, model: "model-b" });
		expect(a.content).toBe("model-a-1");
		expect(b.content).toBe("model-b-2");
		expect(mock.calls).toBe(2);
	});

	it("composes with budget gate — cache hit does NOT charge budget", async () => {
		const mock = makeMockProvider([
			{ content: "hello", inputTokens: 1000, outputTokens: 500, latencyMs: 20 },
		]);
		// Wrapping order per llm-client.ts: cache OUTSIDE budget.
		const budgetOpts: BudgetGateOptions = { caps: { maxCalls: 2 } };
		const gated = withBudgetGate(mock, budgetOpts);
		const cached = withReplayCache(gated, { cacheDir });
		// First call: miss → inner (budget charged).
		await cached.generate(sampleReq);
		expect(gated.state.calls).toBe(1);
		// Second call: hit → inner NOT called, budget NOT charged.
		await cached.generate(sampleReq);
		expect(gated.state.calls).toBe(1);
		// Third call: still a hit, still no budget charge.
		await cached.generate(sampleReq);
		expect(gated.state.calls).toBe(1);
	});
});
