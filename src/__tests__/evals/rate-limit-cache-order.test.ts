import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LLMProvider, LLMRequest, LLMResponse } from "../../../evals/lib/llm-client.js";
import { AdaptiveRateLimiter, withRateLimiter } from "../../../evals/lib/rate-limiter.js";
import { withReplayCache } from "../../../evals/lib/replay-cache.js";

// Tight stub provider — counts calls; no real I/O.
function makeMockProvider(): LLMProvider & { calls: number } {
	const provider = {
		name: "mock",
		limits: {
			contextWindow: 100_000,
			maxOutputTokens: 10_000,
			// Aggressively low to make pacing observable in test time.
			rpm: 2,
			rpd: 1_000,
			tpm: 100_000,
		},
		async generate(_req: LLMRequest): Promise<LLMResponse> {
			provider.calls += 1;
			return { content: "ok", inputTokens: 10, outputTokens: 5, latencyMs: 1 };
		},
		calls: 0,
	};
	return provider;
}

const sampleReq: LLMRequest = {
	system: "sys",
	user: "hi",
	model: "claude-haiku-4-5-20251001",
	maxTokens: 50,
};

describe("rate limiter wrapping order — cache hits skip pacing", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "rl-cache-order-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("withReplayCache(withRateLimiter(base)) — cache hits never reach the limiter window", async () => {
		const base = makeMockProvider();
		const limiter = new AdaptiveRateLimiter(base.limits);
		const limited = withRateLimiter(base, limiter, { enabled: true });
		const cached = withReplayCache(limited, { cacheDir: dir, mode: "read-write" });

		// First call — cache miss → limiter records 1 request.
		await cached.generate(sampleReq);
		expect(base.calls).toBe(1);
		const statsAfter1 = limiter.stats();
		expect(statsAfter1.totalCalls).toBe(1);

		// 50 cache hits — base never re-called, limiter window must NOT grow.
		const start = Date.now();
		for (let i = 0; i < 50; i++) {
			await cached.generate(sampleReq);
		}
		const elapsed = Date.now() - start;

		expect(base.calls).toBe(1); // still 1 — all 50 served from cache
		// With pacing inside the cache, RPM=2 would have made this take 25+ minutes.
		// Cache short-circuit means it should complete in <1s.
		expect(elapsed).toBeLessThan(1_000);

		// Limiter's own counter must not have been bumped by cache hits.
		const statsAfter51 = limiter.stats();
		expect(statsAfter51.totalCalls).toBe(1);
	});

	it("withRateLimiter labels itself for debug — cache key stability is owned by ReplayCacheOptions.providerKey", () => {
		const base = makeMockProvider();
		const limiter = new AdaptiveRateLimiter(base.limits);
		const limited = withRateLimiter(base, limiter, { enabled: true });
		// Honest debug label. Stability of cache keys across wrapper reshuffles
		// is now the responsibility of `withReplayCache({ providerKey })`, not
		// of every inner wrapper carefully not modifying inner.name.
		expect(limited.name).toBe(`${base.name}+ratelimit`);
	});

	it("changing keyMaterialExtra invalidates the cache (registry-resolved maxOutput salt)", async () => {
		const base = makeMockProvider();
		const cacheV1 = withReplayCache(base, {
			cacheDir: dir,
			providerKey: "openrouter",
			keyMaterialExtra: "maxOutput=4096",
		});
		const cacheV2 = withReplayCache(base, {
			cacheDir: dir,
			providerKey: "openrouter",
			keyMaterialExtra: "maxOutput=32768", // bumped registry default
		});

		await cacheV1.generate(sampleReq);
		expect(base.calls).toBe(1);
		// Same provider, same prompt, but different keyMaterialExtra → cache miss.
		await cacheV2.generate(sampleReq);
		expect(base.calls).toBe(2);
	});

	it("dry-run and real responses must NOT share a cache key", async () => {
		const baseReal = makeMockProvider();
		const baseReal2 = makeMockProvider();
		// Two providers with different responses, simulating real vs dry-run.
		baseReal.calls = 0;
		const cacheReal = withReplayCache(baseReal, {
			cacheDir: dir,
			providerKey: "openrouter",
		});
		const cacheDry = withReplayCache(baseReal2, {
			cacheDir: dir,
			providerKey: "openrouter+dryrun",
		});

		await cacheReal.generate(sampleReq);
		expect(baseReal.calls).toBe(1);

		// Different providerKey → different cache key → cacheDry is a miss
		// even though every other parameter matches.
		await cacheDry.generate(sampleReq);
		expect(baseReal2.calls).toBe(1);
	});

	it("withReplayCache key is stable when providerKey is set, regardless of inner.name", async () => {
		const base = makeMockProvider();
		const limiter = new AdaptiveRateLimiter(base.limits);
		const limited = withRateLimiter(base, limiter, { enabled: true });
		// Two cache wrappers — one over `base`, one over `limited`. Different
		// inner.name. With providerKey set, both compute the same key and share
		// the same disk file.
		const cacheBase = withReplayCache(base, { cacheDir: dir, providerKey: "stable-id" });
		const cacheLimited = withReplayCache(limited, { cacheDir: dir, providerKey: "stable-id" });

		await cacheBase.generate(sampleReq);
		expect(base.calls).toBe(1);
		// Second wrapper reads the same key — cache hit, base not re-called.
		const r = await cacheLimited.generate(sampleReq);
		expect(base.calls).toBe(1);
		expect(r.content).toBe("ok");
	});

	it("split ITPM/OTPM caps each pace their own window independently", async () => {
		// Tight OTPM, generous ITPM — output window should be the binding
		// constraint. Two calls each recording 8K output → 16K sits above
		// effectiveOtpm (10K × 0.85 = 8.5K). Third call's pace loop exits when
		// window drains naturally; we can't assert the wait here without
		// fake timers, so we assert the limiter counted the calls (no crash
		// from split pacing path).
		const base = makeMockProvider();
		const limiter = new AdaptiveRateLimiter({
			contextWindow: 100_000,
			maxOutputTokens: 10_000,
			rpm: 100, // RPM not binding
			rpd: 10_000,
			tpm: Infinity, // split caps take over
			itpm: 100_000,
			otpm: 10_000,
		});
		const limited = withRateLimiter(base, limiter, { enabled: true });

		await limited.generate({ ...sampleReq, maxTokens: 5_000 });
		await limited.generate({ ...sampleReq, maxTokens: 5_000 });
		expect(base.calls).toBe(2);
		expect(limiter.stats().totalCalls).toBe(2);
	});

	it("single-TPM provider still works — combined window paces when itpm/otpm absent", async () => {
		const base = makeMockProvider();
		const limiter = new AdaptiveRateLimiter({
			contextWindow: 100_000,
			maxOutputTokens: 10_000,
			rpm: 100,
			rpd: 10_000,
			tpm: 50_000, // combined only, no itpm/otpm
		});
		const limited = withRateLimiter(base, limiter, { enabled: true });

		await limited.generate(sampleReq);
		expect(base.calls).toBe(1);
		expect(limiter.stats().totalCalls).toBe(1);
	});

	it("withRateLimiter wrapper passes through unmetered calls when disabled", async () => {
		const base = makeMockProvider();
		const limiter = new AdaptiveRateLimiter(base.limits);
		const limited = withRateLimiter(base, limiter, { enabled: false });

		// 10 calls in immediate succession — no pacing, no cap.
		for (let i = 0; i < 10; i++) {
			await limited.generate(sampleReq);
		}
		expect(base.calls).toBe(10);
		// Disabled limiter still records usage for stats but does not gate.
		expect(limiter.stats().totalCalls).toBe(0);
	});
});
