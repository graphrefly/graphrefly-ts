import { describe, expect, it } from "vitest";
import {
	adaptiveRateLimiter,
	type RateLimitSignal,
} from "../../../../utils/resilience/adaptive-rate-limiter.js";

describe("adaptiveRateLimiter", () => {
	it("acquire() resolves when rpm has capacity", async () => {
		const limiter = adaptiveRateLimiter({ rpm: 60 });
		await limiter.acquire();
		await limiter.acquire();
		limiter.dispose();
	});

	it("recordSignal with retryAfterMs blocks acquire", async () => {
		const limiter = adaptiveRateLimiter({ rpm: 60 });
		limiter.recordSignal({ retryAfterMs: 200 } as RateLimitSignal);
		const start = Date.now();
		await limiter.acquire();
		const elapsed = Date.now() - start;
		// Should wait at least close to 200ms.
		expect(elapsed).toBeGreaterThanOrEqual(150);
		limiter.dispose();
	});

	it("recordSignal with rpmCap tightens effective rpm", async () => {
		const limiter = adaptiveRateLimiter({ rpm: 1000 });
		expect(limiter.effectiveRpm.cache).toBe(1000);
		limiter.recordSignal({ rpmCap: 5 } as RateLimitSignal);
		expect(limiter.effectiveRpm.cache).toBe(5);
		limiter.dispose();
	});

	it("lastSignal exposes the last recorded signal", async () => {
		const limiter = adaptiveRateLimiter({ rpm: 60 });
		limiter.recordSignal({ rpmCap: 30 } as RateLimitSignal);
		expect(limiter.lastSignal.cache?.rpmCap).toBe(30);
		limiter.dispose();
	});

	it("abort signal cancels a pending acquire", async () => {
		const limiter = adaptiveRateLimiter({ rpm: 1 });
		// Consume the one token.
		await limiter.acquire();
		const ac = new AbortController();
		const promise = limiter.acquire({ signal: ac.signal });
		ac.abort();
		await expect(promise).rejects.toThrow(/abort/i);
		limiter.dispose();
	});
});
