import { describe, expect, it } from "vitest";
import { CircuitOpenError } from "../../../../extra/resilience.js";
import type {
	LLMAdapter,
	LLMResponse,
	StreamDelta,
} from "../../../../patterns/ai/adapters/core/types.js";
import { BudgetExhaustedError } from "../../../../patterns/ai/adapters/middleware/budget-gate.js";
import { resilientAdapter } from "../../../../patterns/ai/adapters/middleware/resilient-adapter.js";

function mockAdapter(
	responses: readonly (LLMResponse | Error)[] = [],
): LLMAdapter & { calls: number } {
	let i = 0;
	const adapter: LLMAdapter & { calls: number } = {
		provider: "mock",
		model: "mock-m",
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

describe("resilientAdapter", () => {
	it("returns inner adapter unchanged when no layers configured", () => {
		const inner = mockAdapter([okResp()]);
		const { adapter, rateLimiter, budget, breaker } = resilientAdapter(inner);
		expect(adapter).toBe(inner);
		expect(rateLimiter).toBeUndefined();
		expect(budget).toBeUndefined();
		expect(breaker).toBeUndefined();
	});

	it("applies retry + timeout (timeout rearms per attempt; default predicate retries)", async () => {
		let call = 0;
		// Model a real fetch-style adapter: rejects aborted requests with an
		// AbortError regardless of `signal.reason`. `withTimeout` must
		// convert its own timer-fire path into `LLMTimeoutError` so the
		// default retry predicate recognizes it.
		const slow: LLMAdapter = {
			provider: "slow",
			model: "s",
			invoke(_msgs, opts): Promise<LLMResponse> {
				call += 1;
				const hangMs = call === 1 ? 60 : 0;
				return new Promise((resolve, reject) => {
					const t = setTimeout(() => resolve(okResp("done")), hangMs);
					opts?.signal?.addEventListener("abort", () => {
						clearTimeout(t);
						const abortErr = new Error("The operation was aborted");
						abortErr.name = "AbortError";
						reject(abortErr);
					});
				});
			},
			async *stream() {},
		};
		const { adapter } = resilientAdapter(slow, {
			timeoutMs: 20,
			retry: { attempts: 2, baseDelayMs: 1, jitter: false },
		});
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "x" }]));
		expect(resp.content).toBe("done");
		expect(call).toBe(2);
	});

	it("retry runs through breaker — each attempt checks circuit", async () => {
		const err500 = Object.assign(new Error("boom"), { status: 500 });
		const inner = mockAdapter([err500, err500, err500, err500, err500]);
		const { adapter, breaker } = resilientAdapter(inner, {
			breaker: { failureThreshold: 2 },
			retry: { attempts: 5, baseDelayMs: 1, jitter: false },
		});
		// Breaker opens after 2 recorded failures, then retry hits
		// CircuitOpenError (in defaultShouldRetry's no-retry list) and bails.
		// The final error MUST be CircuitOpenError — asserting the class
		// catches regressions where the breaker silently doesn't open.
		await expect(
			Promise.resolve(adapter.invoke([{ role: "user", content: "x" }])),
		).rejects.toBeInstanceOf(CircuitOpenError);
		expect(inner.calls).toBe(2);
		expect(breaker?.state).toBe("open");
	});

	it("budget cap closes gate after N successful calls under retry", async () => {
		// Budget `calls` counts only successful invocations — errors don't
		// debit the cap. Once the cap is reached, subsequent calls fast-fail
		// with BudgetExhaustedError; retry's defaultShouldRetry excludes that
		// class so retries don't fire against a closed gate.
		const inner = mockAdapter([okResp("a"), okResp("b"), okResp("c")]);
		const { adapter } = resilientAdapter(inner, {
			budget: { caps: { calls: 2 } },
			retry: { attempts: 3, baseDelayMs: 1, jitter: false },
		});
		await adapter.invoke([{ role: "user", content: "1" }]);
		await adapter.invoke([{ role: "user", content: "2" }]);
		await expect(
			Promise.resolve(adapter.invoke([{ role: "user", content: "3" }])),
		).rejects.toBeInstanceOf(BudgetExhaustedError);
		// Third call never reached inner — budget short-circuited + retry
		// skipped BudgetExhaustedError → inner.calls stays at 2.
		expect(inner.calls).toBe(2);
	});

	it("falls back to secondary adapter when primary exhausts retries", async () => {
		const err500 = Object.assign(new Error("boom"), { status: 500 });
		const primary = mockAdapter([err500, err500]);
		const secondary = mockAdapter([okResp("from-fallback")]);
		const { adapter } = resilientAdapter(primary, {
			retry: { attempts: 2, baseDelayMs: 1, jitter: false },
			fallback: secondary,
		});
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "x" }]));
		expect(resp.content).toBe("from-fallback");
		expect(primary.calls).toBe(2);
		expect(secondary.calls).toBe(1);
		// Cascading adapter stamps the tier name onto the response metadata.
		expect((resp.metadata as { tier?: string })?.tier).toBe("fallback");
	});

	it("does not wrap fallback when no primary failure", async () => {
		const primary = mockAdapter([okResp("primary-ok")]);
		const secondary = mockAdapter([okResp("fallback-ok")]);
		const { adapter } = resilientAdapter(primary, { fallback: secondary });
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "x" }]));
		expect(resp.content).toBe("primary-ok");
		expect(primary.calls).toBe(1);
		expect(secondary.calls).toBe(0);
	});

	it("exposes breaker / budget / rateLimiter bundles when configured", () => {
		const { adapter, breaker, budget, rateLimiter } = resilientAdapter(mockAdapter(), {
			breaker: { failureThreshold: 3 },
			budget: { caps: { calls: 10 } },
			rateLimit: { rpm: 60 },
		});
		expect(adapter).toBeDefined();
		expect(breaker).toBeDefined();
		expect(breaker?.state).toBe("closed");
		expect(budget).toBeDefined();
		expect(budget?.totals.cache?.calls).toBe(0);
		expect(rateLimiter).toBeDefined();
	});

	it('rejects `name: "fallback"` — collides with the hardcoded secondary tier label', () => {
		expect(() =>
			resilientAdapter(mockAdapter(), {
				name: "fallback",
				fallback: mockAdapter([okResp()]),
			}),
		).toThrow(RangeError);
	});

	// Helper: build a streaming mock adapter whose per-call behavior is
	// driven by a caller-supplied script.
	type StreamScript =
		| { kind: "chunks"; chunks: readonly StreamDelta[] }
		| { kind: "failBeforeChunks"; error: Error }
		| { kind: "failAfterFirst"; firstChunk: StreamDelta; error: Error };

	function streamingMock(scripts: readonly StreamScript[]): LLMAdapter & { streamCalls: number } {
		let i = 0;
		const adapter: LLMAdapter & { streamCalls: number } = {
			provider: "stream-mock",
			model: "m",
			streamCalls: 0,
			invoke(): Promise<LLMResponse> {
				return Promise.reject(new Error("invoke not used in stream tests"));
			},
			async *stream() {
				const script = scripts[i % scripts.length];
				i += 1;
				adapter.streamCalls += 1;
				switch (script.kind) {
					case "chunks":
						for (const c of script.chunks) yield c;
						return;
					case "failBeforeChunks":
						throw script.error;
					case "failAfterFirst":
						yield script.firstChunk;
						throw script.error;
				}
			},
		};
		return adapter;
	}

	const contentDelta = (text: string): StreamDelta => ({ type: "content", delta: text });

	it("stream: primary fails pre-first-chunk → fallback tier streams", async () => {
		const err500 = Object.assign(new Error("boom"), { status: 500 });
		const primary = streamingMock([{ kind: "failBeforeChunks", error: err500 }]);
		const secondary = streamingMock([
			{ kind: "chunks", chunks: [contentDelta("fall"), contentDelta("back")] },
		]);
		const { adapter } = resilientAdapter(primary, {
			// No retry — isolate the cascade path. Retry interaction is
			// exercised in the next test.
			fallback: secondary,
		});
		const chunks: string[] = [];
		for await (const d of adapter.stream([{ role: "user", content: "x" }])) {
			if (d.type === "content") chunks.push(d.delta);
		}
		expect(chunks.join("")).toBe("fallback");
		expect(primary.streamCalls).toBe(1);
		expect(secondary.streamCalls).toBe(1);
	});

	it("stream: mid-stream failure propagates; fallback does NOT replay partial output", async () => {
		const err500 = Object.assign(new Error("boom"), { status: 500 });
		const primary = streamingMock([
			{
				kind: "failAfterFirst",
				firstChunk: contentDelta("partial-"),
				error: err500,
			},
		]);
		const secondary = streamingMock([{ kind: "chunks", chunks: [contentDelta("from-fallback")] }]);
		const { adapter } = resilientAdapter(primary, { fallback: secondary });
		const chunks: string[] = [];
		let caught: unknown;
		try {
			for await (const d of adapter.stream([{ role: "user", content: "x" }])) {
				if (d.type === "content") chunks.push(d.delta);
			}
		} catch (err) {
			caught = err;
		}
		// Primary's partial output must be visible to the caller (we don't
		// silently discard it). Error propagates. Fallback MUST NOT be
		// engaged — mid-stream commit is the documented contract.
		expect(chunks.join("")).toBe("partial-");
		expect(caught).toBe(err500);
		expect(secondary.streamCalls).toBe(0);
	});

	it("stream: retry does not replay a partially-streamed output", async () => {
		const err500 = Object.assign(new Error("boom"), { status: 500 });
		const primary = streamingMock([
			{ kind: "failAfterFirst", firstChunk: contentDelta("p1-"), error: err500 },
			// This second script would run only if retry re-invoked stream; assertion
			// that primary.streamCalls stays at 1 proves it doesn't.
			{ kind: "chunks", chunks: [contentDelta("p2")] },
		]);
		const { adapter } = resilientAdapter(primary, {
			retry: { attempts: 3, baseDelayMs: 1, jitter: false },
		});
		const chunks: string[] = [];
		let caught: unknown;
		try {
			for await (const d of adapter.stream([{ role: "user", content: "x" }])) {
				if (d.type === "content") chunks.push(d.delta);
			}
		} catch (err) {
			caught = err;
		}
		expect(chunks.join("")).toBe("p1-");
		expect(caught).toBe(err500);
		// Retry commits after first chunk — exactly one stream() call.
		expect(primary.streamCalls).toBe(1);
	});
});
