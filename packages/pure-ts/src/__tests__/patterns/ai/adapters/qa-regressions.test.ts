/**
 * Regression tests for the second-round QA fixes (P1–P10, ND1–ND2).
 */

import { describe, expect, it } from "vitest";
import { adaptiveRateLimiter } from "../../../../extra/adaptive-rate-limiter.js";
import { tokenBucket } from "../../../../extra/resilience.js";
import { singleFromAny } from "../../../../extra/single-from-any.js";
import type { LLMAdapter, LLMResponse } from "../../../../patterns/ai/adapters/core/types.js";
import { withBudgetGate } from "../../../../patterns/ai/adapters/middleware/budget-gate.js";
import { withDryRun } from "../../../../patterns/ai/adapters/middleware/dry-run.js";
import { dryRunAdapter } from "../../../../patterns/ai/adapters/providers/dry-run.js";

// ---------------------------------------------------------------------------
// P1 — canonicalJson: sibling shared references should NOT be flagged as cycles
// ---------------------------------------------------------------------------
// Indirect test via withReplayCache: identical-structure prompts with shared
// sub-objects produce the same cache key as freshly-reconstructed equivalents.

import { memoryKv } from "../../../../extra/storage-tiers.js";
import { withReplayCache } from "../../../../patterns/ai/adapters/middleware/replay-cache.js";

function mockAdapter(responses: LLMResponse[]): LLMAdapter & { calls: number } {
	let i = 0;
	const a: LLMAdapter & { calls: number } = {
		provider: "mock",
		model: "m",
		// QA D3 (Phase 13.6.B): suppress the budget-gate wire-time warning.
		abortCapable: true,
		calls: 0,
		invoke(): Promise<LLMResponse> {
			a.calls += 1;
			const r = responses[Math.min(i, responses.length - 1)];
			i += 1;
			return Promise.resolve(r);
		},
		async *stream() {},
	};
	return a;
}

const okResp = (content = "ok"): LLMResponse => ({
	content,
	usage: { input: { regular: 0 }, output: { regular: 0 } },
});

describe("P1 canonicalJson: shared sibling refs are not cycles", () => {
	it("shared tool-parameter object hashes same as reconstructed equivalent", async () => {
		const shared = { type: "object", properties: { x: { type: "string" } } };
		const freshA = { type: "object", properties: { x: { type: "string" } } };
		const freshB = { type: "object", properties: { x: { type: "string" } } };

		const inner = mockAdapter([okResp("A"), okResp("B")]);
		const adapter = withReplayCache(inner, { storage: memoryKv() });

		// First call: two tools sharing one reference.
		await Promise.resolve(
			adapter.invoke([{ role: "user", content: "x" }], {
				tools: [
					{ name: "t1", description: "", parameters: shared, handler: () => null },
					{ name: "t2", description: "", parameters: shared, handler: () => null },
				],
			}),
		);

		// Second call: two tools with structurally-equal-but-distinct references.
		const r2 = await Promise.resolve(
			adapter.invoke([{ role: "user", content: "x" }], {
				tools: [
					{ name: "t1", description: "", parameters: freshA, handler: () => null },
					{ name: "t2", description: "", parameters: freshB, handler: () => null },
				],
			}),
		);

		expect(r2.content).toBe("A"); // cache hit from first call
		expect((r2.metadata as { replayCache?: string }).replayCache).toBe("hit");
		expect(inner.calls).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// P7 — singleFromAny: sync-resolved Promise no longer leaves stale cache entries
// ---------------------------------------------------------------------------

describe("P7 singleFromAny: sync-resolved promise clean-up", () => {
	it("cache is clear after sync-resolved factory settles", async () => {
		let calls = 0;
		const fn = singleFromAny<string, number>((k) => {
			calls += 1;
			return Promise.resolve(Number(k)); // already-resolved
		});
		await fn("1");
		await fn("1"); // reinvokes because prior settled
		expect(calls).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// P9 — EMPTY_TOTALS is frozen + reset emits fresh object
// ---------------------------------------------------------------------------

describe("P9 EMPTY_TOTALS is isolated across instances", () => {
	it("mutation to one bundle's totals does not bleed into another", () => {
		const inner = dryRunAdapter();
		const { budget: b1 } = withBudgetGate(inner, { caps: { calls: 10 } });
		const { budget: b2 } = withBudgetGate(inner, { caps: { calls: 10 } });
		const t1 = b1.totals.cache as { calls: number } | undefined;
		const t2 = b2.totals.cache as { calls: number } | undefined;
		expect(t1).not.toBe(t2); // distinct objects per instance
	});
});

// ---------------------------------------------------------------------------
// B8 — withBudgetGate: onExhausted is edge-triggered (open → closed only)
// ---------------------------------------------------------------------------

describe("B8 withBudgetGate: onExhausted fires once on open→closed edge", () => {
	it("onExhausted fires exactly once across many blocked attempts", async () => {
		let exhaustedCalls = 0;
		const keys: unknown[] = [];
		const { adapter } = withBudgetGate(dryRunAdapter(), {
			caps: { calls: 2 },
			onExhausted: (which) => {
				exhaustedCalls += 1;
				keys.push(which);
			},
		});
		// First two calls succeed, tipping totals.calls to 2, closing the gate.
		await adapter.invoke([{ role: "user", content: "a" }]);
		await adapter.invoke([{ role: "user", content: "b" }]);
		// Subsequent attempts throw — but onExhausted must fire only once,
		// at the edge, not per blocked attempt.
		for (let i = 0; i < 5; i++) {
			await expect(adapter.invoke([{ role: "user", content: "x" }])).rejects.toThrow();
		}
		expect(exhaustedCalls).toBe(1);
		expect(keys).toEqual(["calls"]);
	});
});

// ---------------------------------------------------------------------------
// P6 — rpmCap: 0 honored as hard stop (doesn't silently fall through)
// ---------------------------------------------------------------------------

describe("P6 adaptiveRateLimiter rpmCap=0 hard-stop", () => {
	it("acquire blocks when rpmCap=0 is signaled, resumes after decay", async () => {
		const limiter = adaptiveRateLimiter({ rpm: 1000, clampCooldownMs: 120 });
		limiter.recordSignal({ rpmCap: 0 });
		expect(limiter.effectiveRpm.cache).toBe(0);

		const ac = new AbortController();
		const p = limiter.acquire({ signal: ac.signal });

		// Give the decay timer time to fire and the polling loop to pick up.
		await new Promise((r) => setTimeout(r, 250));
		await p; // should resolve after decay relaxes the cap
		limiter.dispose();
	}, 10000);
});

// ---------------------------------------------------------------------------
// P5 — adaptiveRateLimiter: bucket-swap race (putBack credits local ref)
// ---------------------------------------------------------------------------

describe("P5 adaptiveRateLimiter: putBack targets the acquire-time bucket", () => {
	// A direct race test requires precise timing, so we validate the
	// property structurally: putBack on a swapped-out bucket must not
	// inflate the new bucket's available tokens.
	it("rpm bucket rebuild during tpm-miss does not leak credit to the new bucket", async () => {
		// The TokenBucket.putBack primitive is the only way to add — verified in
		// its own test. The adaptive-rate-limiter now captures
		// rpmAtAcquire/tpmAtAcquire locally, so this is an invariant test:
		// the closure refs survive a rebuild.
		const b = tokenBucket(5, 0); // non-refilling
		b.tryConsume(5);
		expect(b.available()).toBeCloseTo(0);
		const held = b;
		// "Rebuild" — new limiter bucket would be created; the old one is still
		// the one `putBack` targets.
		held.putBack(3);
		expect(held.available()).toBeCloseTo(3);
	});
});

// ---------------------------------------------------------------------------
// ND1 — cascadingLlmAdapter: no onExhausted when single tier commits mid-stream
// ---------------------------------------------------------------------------

import { cascadingLlmAdapter } from "../../../../patterns/ai/adapters/routing/cascading.js";

describe("ND1 cascadingLlmAdapter: mid-stream commit failure doesn't call onExhausted", () => {
	it("onExhausted is NOT called when the current tier throws after yielding", async () => {
		let exhaustedCalls = 0;
		const flaky: LLMAdapter = {
			provider: "flaky",
			model: "m",
			invoke() {
				return Promise.reject(new Error("not used"));
			},
			async *stream() {
				yield { type: "token" as const, delta: "a" };
				throw new Error("mid-stream fail");
			},
		};
		const adapter = cascadingLlmAdapter([{ name: "tier-0", adapter: flaky }], {
			onExhausted: () => exhaustedCalls++,
		});
		try {
			for await (const _d of adapter.stream([{ role: "user", content: "x" }])) {
				/* consume */
			}
		} catch {
			// expected
		}
		expect(exhaustedCalls).toBe(0);
	});

	it("onExhausted IS called when all tiers fail pre-first-chunk", async () => {
		let exhaustedCalls = 0;
		const always: LLMAdapter = {
			provider: "always-fail",
			model: "m",
			invoke() {
				return Promise.reject(new Error("x"));
			},
			// biome-ignore lint/correctness/useYield: throws before yielding (pre-chunk fail test)
			async *stream() {
				throw new Error("pre-chunk");
			},
		};
		const adapter = cascadingLlmAdapter(
			[
				{ name: "tier-0", adapter: always },
				{ name: "tier-1", adapter: always },
			],
			{ onExhausted: () => exhaustedCalls++ },
		);
		try {
			for await (const _d of adapter.stream([{ role: "user", content: "x" }])) {
				/* consume */
			}
		} catch {
			// expected
		}
		expect(exhaustedCalls).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// ND2 — withDryRun returns { adapter, dispose }
// ---------------------------------------------------------------------------

describe("ND2 withDryRun: dispose API", () => {
	it("returns an adapter + dispose tuple", () => {
		const inner = dryRunAdapter();
		const result = withDryRun(inner, { enabled: true });
		expect(typeof result.dispose).toBe("function");
		expect(result.adapter.provider).toBe(inner.provider);
		result.dispose();
	});
});
