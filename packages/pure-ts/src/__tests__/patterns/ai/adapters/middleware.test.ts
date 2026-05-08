import { describe, expect, it, vi } from "vitest";
import { memoryKv } from "../../../../extra/storage-tiers.js";
import type { LLMAdapter, LLMResponse } from "../../../../patterns/ai/adapters/core/types.js";
import { withBreaker } from "../../../../patterns/ai/adapters/middleware/breaker.js";
import {
	BudgetExhaustedError,
	withBudgetGate,
} from "../../../../patterns/ai/adapters/middleware/budget-gate.js";
import { withDryRun } from "../../../../patterns/ai/adapters/middleware/dry-run.js";
import { withReplayCache } from "../../../../patterns/ai/adapters/middleware/replay-cache.js";
import { withRetry } from "../../../../patterns/ai/adapters/middleware/retry.js";
import {
	LLMTimeoutError,
	withTimeout,
} from "../../../../patterns/ai/adapters/middleware/timeout.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockAdapter(
	responses: readonly (LLMResponse | Error)[] = [],
	opts?: { abortCapable?: boolean },
): LLMAdapter & { calls: number } {
	let i = 0;
	const adapter: LLMAdapter & { calls: number } = {
		provider: "mock",
		model: "mock-m",
		// QA D3 (Phase 13.6.B QA pass): default `abortCapable: true` so
		// existing tests don't trigger the wire-time warning. Tests
		// covering the warning explicitly pass `abortCapable: false`.
		abortCapable: opts?.abortCapable ?? true,
		calls: 0,
		invoke(): Promise<LLMResponse> {
			adapter.calls += 1;
			const next = responses[i % responses.length];
			i += 1;
			if (next instanceof Error) return Promise.reject(next);
			return Promise.resolve(next);
		},
		// biome-ignore lint/correctness/useYield: throws intentionally; test adapter never streams
		async *stream() {
			throw new Error("stream not implemented in mock");
		},
	};
	return adapter;
}

const okResp = (content = "ok", inputTok = 10, outputTok = 5): LLMResponse => ({
	content,
	usage: { input: { regular: inputTok }, output: { regular: outputTok } },
});

// ---------------------------------------------------------------------------
// withBudgetGate
// ---------------------------------------------------------------------------

describe("withBudgetGate", () => {
	it("enforces calls cap", async () => {
		const { adapter } = withBudgetGate(mockAdapter([okResp(), okResp(), okResp()]), {
			caps: { calls: 2 },
		});
		await Promise.resolve(adapter.invoke([{ role: "user", content: "a" }]));
		await Promise.resolve(adapter.invoke([{ role: "user", content: "b" }]));
		await expect(
			Promise.resolve(adapter.invoke([{ role: "user", content: "c" }])),
		).rejects.toBeInstanceOf(BudgetExhaustedError);
	});

	it("QA D2: dispose() exists and is idempotent", async () => {
		const inner = mockAdapter([okResp(), okResp()]);
		const { adapter, budget } = withBudgetGate(inner, { caps: { calls: 5 } });
		await Promise.resolve(adapter.invoke([{ role: "user", content: "a" }]));
		expect(typeof budget.dispose).toBe("function");
		// First call releases; second is a no-op.
		expect(() => {
			budget.dispose();
			budget.dispose();
		}).not.toThrow();
	});

	it("QA D2: dispose() aborts in-flight controllers", async () => {
		// Inner adapter that hangs forever unless its signal aborts.
		let externalAbortReason: unknown;
		const slowInner: LLMAdapter = {
			provider: "slow",
			model: "slow-m",
			abortCapable: true,
			invoke(_messages, opts): Promise<LLMResponse> {
				return new Promise<LLMResponse>((_resolve, reject) => {
					if (opts?.signal != null) {
						if (opts.signal.aborted) {
							externalAbortReason = opts.signal.reason;
							reject(opts.signal.reason);
							return;
						}
						opts.signal.addEventListener(
							"abort",
							() => {
								externalAbortReason = (opts.signal as AbortSignal).reason;
								reject((opts.signal as AbortSignal).reason);
							},
							{ once: true },
						);
					}
				});
			},
			// biome-ignore lint/correctness/useYield: throws intentionally
			async *stream() {
				throw new Error("stream not implemented");
			},
		};
		const { adapter, budget } = withBudgetGate(slowInner, { caps: { calls: 5 } });
		// Kick off an invoke that will hang.
		const inflight = Promise.resolve(adapter.invoke([{ role: "user", content: "a" }]));
		// Dispose now — should abort the in-flight controller.
		budget.dispose();
		// The Promise should reject with the dispose reason.
		await expect(inflight).rejects.toBeDefined();
		expect(externalAbortReason).toBeDefined();
	});

	it("QA D3: emits dev-mode warning when adapter does not declare abortCapable", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const inner = mockAdapter([], { abortCapable: false });
		const { budget } = withBudgetGate(inner, { caps: { calls: 1 } });
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0]?.[0]).toMatch(/abortCapable/);
		expect(warnSpy.mock.calls[0]?.[0]).toMatch(/Lock 3\.C/);
		budget.dispose();
		warnSpy.mockRestore();
	});

	it("QA D3: no warning when adapter declares abortCapable: true", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const inner = mockAdapter([], { abortCapable: true });
		const { budget } = withBudgetGate(inner, { caps: { calls: 1 } });
		expect(warnSpy).not.toHaveBeenCalled();
		budget.dispose();
		warnSpy.mockRestore();
	});

	it("enforces usd cap via pricingFn", async () => {
		const { adapter } = withBudgetGate(
			mockAdapter([okResp("a", 1_000_000, 0), okResp("b", 1_000_000, 0)]),
			{
				caps: { usd: 5 },
				pricingFn: (u) => ({
					total: (u.input.regular / 1_000_000) * 3,
					currency: "USD",
				}),
			},
		);
		await Promise.resolve(adapter.invoke([{ role: "user", content: "a" }])); // $3
		// Second call would put total at $6 → but isOpen at invoke time is based on what's logged.
		// First call logs 1M * $3 = $3; second call would be $3 more. Cap $5 — after the 2nd call
		// the gate closes. Third call trips.
		await Promise.resolve(adapter.invoke([{ role: "user", content: "b" }])); // $6 total after this
		await expect(
			Promise.resolve(adapter.invoke([{ role: "user", content: "c" }])),
		).rejects.toBeInstanceOf(BudgetExhaustedError);
	});
});

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

describe("withRetry", () => {
	it("retries on transient 5xx", async () => {
		const err500 = Object.assign(new Error("boom"), { status: 500 });
		const inner = mockAdapter([err500, err500, okResp()]);
		const adapter = withRetry(inner, { attempts: 3, baseDelayMs: 1, jitter: false });
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "x" }]));
		expect(resp.content).toBe("ok");
		expect(inner.calls).toBe(3);
	});

	it("does not retry on 4xx (other than 429)", async () => {
		const err400 = Object.assign(new Error("bad"), { status: 400 });
		const inner = mockAdapter([err400]);
		const adapter = withRetry(inner, { attempts: 3, baseDelayMs: 1 });
		await expect(Promise.resolve(adapter.invoke([{ role: "user", content: "x" }]))).rejects.toBe(
			err400,
		);
		expect(inner.calls).toBe(1);
	});

	it("does retry on 429", async () => {
		const err429 = Object.assign(new Error("slow down"), { status: 429 });
		const inner = mockAdapter([err429, okResp()]);
		const adapter = withRetry(inner, { attempts: 3, baseDelayMs: 1, jitter: false });
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "x" }]));
		expect(resp.content).toBe("ok");
	});
});

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

describe("withTimeout", () => {
	it("aborts after ms elapse", async () => {
		const slow: LLMAdapter = {
			provider: "slow",
			model: "s",
			invoke(_msgs, opts): Promise<LLMResponse> {
				return new Promise((resolve, reject) => {
					const t = setTimeout(() => resolve(okResp()), 1000);
					opts?.signal?.addEventListener("abort", () => {
						clearTimeout(t);
						reject(opts.signal?.reason ?? new Error("aborted"));
					});
				});
			},
			async *stream() {},
		};
		const adapter = withTimeout(slow, 20);
		await expect(
			Promise.resolve(adapter.invoke([{ role: "user", content: "x" }])),
		).rejects.toBeInstanceOf(LLMTimeoutError);
	});
});

// ---------------------------------------------------------------------------
// withBreaker
// ---------------------------------------------------------------------------

describe("withBreaker", () => {
	it("opens after failureThreshold consecutive errors", async () => {
		const inner = mockAdapter([new Error("e1"), new Error("e2"), new Error("e3"), okResp()]);
		const { adapter } = withBreaker(inner, { failureThreshold: 2 });
		await expect(Promise.resolve(adapter.invoke([{ role: "user", content: "a" }]))).rejects.toThrow(
			"e1",
		);
		await expect(Promise.resolve(adapter.invoke([{ role: "user", content: "b" }]))).rejects.toThrow(
			"e2",
		);
		await expect(Promise.resolve(adapter.invoke([{ role: "user", content: "c" }]))).rejects.toThrow(
			"Circuit breaker is open",
		);
		expect(inner.calls).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// withReplayCache
// ---------------------------------------------------------------------------

describe("withReplayCache", () => {
	it("returns cached response on second call", async () => {
		const inner = mockAdapter([okResp("first"), okResp("second")]);
		const adapter = withReplayCache(inner, { storage: memoryKv() });
		const r1 = await Promise.resolve(adapter.invoke([{ role: "user", content: "x" }]));
		const r2 = await Promise.resolve(adapter.invoke([{ role: "user", content: "x" }]));
		expect(r1.content).toBe("first");
		expect(r2.content).toBe("first"); // cached
		expect((r2.metadata as { replayCache?: string })?.replayCache).toBe("hit");
		expect(inner.calls).toBe(1); // miss only
	});

	it("different messages miss separately", async () => {
		const inner = mockAdapter([okResp("a"), okResp("b")]);
		const adapter = withReplayCache(inner, { storage: memoryKv() });
		const r1 = await Promise.resolve(adapter.invoke([{ role: "user", content: "x" }]));
		const r2 = await Promise.resolve(adapter.invoke([{ role: "user", content: "y" }]));
		expect(r1.content).toBe("a");
		expect(r2.content).toBe("b");
		expect(inner.calls).toBe(2);
	});

	it("B4: keyFn receives ctx.context from invokeOpts.keyContext", async () => {
		const inner = mockAdapter([okResp("tenantA"), okResp("tenantB"), okResp("tenantA-2")]);
		const adapter = withReplayCache(inner, {
			storage: memoryKv(),
			// 1-arg ctx form — shards by tenant.
			keyFn: (ctx) => {
				const tenant = (ctx.context as { tenant?: string })?.tenant ?? "default";
				return `t:${tenant}:${ctx.messages.at(-1)?.content ?? ""}`;
			},
		});
		const msg = [{ role: "user" as const, content: "hi" }];
		const r1 = await adapter.invoke(msg, { keyContext: { tenant: "A" } });
		const r2 = await adapter.invoke(msg, { keyContext: { tenant: "B" } });
		const r3 = await adapter.invoke(msg, { keyContext: { tenant: "A" } }); // cache hit on A
		expect(r1.content).toBe("tenantA");
		expect(r2.content).toBe("tenantB");
		expect(r3.content).toBe("tenantA"); // served from A's cache
		expect(inner.calls).toBe(2);
	});

	it("B4: legacy 2-arg keyFn form still works", async () => {
		const inner = mockAdapter([okResp("one"), okResp("two")]);
		let calls = 0;
		const adapter = withReplayCache(inner, {
			storage: memoryKv(),
			keyFn: (messages, _opts) => {
				calls += 1;
				return `msg:${messages.length}`;
			},
		});
		await adapter.invoke([{ role: "user", content: "a" }]);
		await adapter.invoke([{ role: "user", content: "b" }]); // same length → same key → hit
		expect(calls).toBeGreaterThan(0);
		expect(inner.calls).toBe(1);
	});

	it("B4: default key function ignores keyContext", async () => {
		const inner = mockAdapter([okResp("shared")]);
		const adapter = withReplayCache(inner, { storage: memoryKv() });
		const msg = [{ role: "user" as const, content: "ping" }];
		const r1 = await adapter.invoke(msg, { keyContext: { any: 1 } });
		const r2 = await adapter.invoke(msg, { keyContext: { any: 2 } });
		// Without a custom keyFn, keyContext is stripped from canonical hashing
		// — so the second call hits the cache even though keyContext differs.
		expect(r1.content).toBe("shared");
		expect(r2.content).toBe("shared");
		expect(inner.calls).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// withDryRun
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// withRateLimiter — A2: shared limiter across wraps
// ---------------------------------------------------------------------------

import { adaptiveRateLimiter } from "../../../../extra/adaptive-rate-limiter.js";
import { withRateLimiter } from "../../../../patterns/ai/adapters/middleware/rate-limiter.js";

describe("withRateLimiter", () => {
	it("A2: shared AdaptiveRateLimiterBundle is reused across wraps", () => {
		const shared = adaptiveRateLimiter({ name: "shared", rpm: 60 });
		const a = withRateLimiter(mockAdapter([okResp()]), { limiter: shared });
		const b = withRateLimiter(mockAdapter([okResp()]), { limiter: shared });
		expect(a.limiter).toBe(shared);
		expect(b.limiter).toBe(shared);
	});

	it("A2: fresh limiter constructed when not supplied", () => {
		const a = withRateLimiter(mockAdapter([okResp()]), {});
		const b = withRateLimiter(mockAdapter([okResp()]), {});
		expect(a.limiter).not.toBe(b.limiter);
	});
});

describe("withDryRun", () => {
	it("bypasses inner when enabled:true", async () => {
		const inner = mockAdapter([okResp("real")]);
		const { adapter, dispose } = withDryRun(inner, { enabled: true });
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "x" }]));
		expect(resp.content).not.toBe("real");
		expect(inner.calls).toBe(0);
		dispose();
	});

	it("passes through when enabled:false", async () => {
		const inner = mockAdapter([okResp("real")]);
		const { adapter, dispose } = withDryRun(inner, { enabled: false });
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "x" }]));
		expect(resp.content).toBe("real");
		dispose();
	});

	it("dispose is idempotent and safe on literal-boolean flag (no keepalive)", () => {
		const inner = mockAdapter([okResp("real")]);
		const { dispose } = withDryRun(inner, { enabled: false });
		dispose();
		dispose(); // no throw
	});
});
