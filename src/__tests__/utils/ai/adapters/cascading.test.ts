import { describe, expect, it } from "vitest";
import type { LLMAdapter, LLMResponse } from "../../../../utils/ai/adapters/core/types.js";
import {
	AllTiersExhaustedError,
	cascadingLlmAdapter,
} from "../../../../utils/ai/adapters/routing/cascading.js";

function tierAdapter(responses: readonly (LLMResponse | Error)[]): LLMAdapter & { calls: number } {
	let i = 0;
	const adapter: LLMAdapter & { calls: number } = {
		provider: "mock",
		model: "m",
		calls: 0,
		invoke(): Promise<LLMResponse> {
			adapter.calls += 1;
			const next = responses[Math.min(i, responses.length - 1)];
			i += 1;
			return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
		},
		async *stream() {},
	};
	return adapter;
}

const okResp = (content = "ok"): LLMResponse => ({
	content,
	usage: { input: { regular: 0 }, output: { regular: 0 } },
});

describe("cascadingLlmAdapter", () => {
	it("first success wins", async () => {
		const t0 = tierAdapter([okResp("A")]);
		const t1 = tierAdapter([okResp("B")]);
		const adapter = cascadingLlmAdapter([
			{ name: "tier-0", adapter: t0 },
			{ name: "tier-1", adapter: t1 },
		]);
		const r = await Promise.resolve(adapter.invoke([{ role: "user", content: "x" }]));
		expect(r.content).toBe("A");
		expect(t0.calls).toBe(1);
		expect(t1.calls).toBe(0);
	});

	it("falls through on error", async () => {
		const t0 = tierAdapter([new Error("nope")]);
		const t1 = tierAdapter([okResp("B")]);
		const fallbacks: string[] = [];
		const adapter = cascadingLlmAdapter(
			[
				{ name: "tier-0", adapter: t0 },
				{ name: "tier-1", adapter: t1 },
			],
			{ onFallback: (from, to) => fallbacks.push(`${from}->${to}`) },
		);
		const r = await Promise.resolve(adapter.invoke([{ role: "user", content: "x" }]));
		expect(r.content).toBe("B");
		expect(t0.calls).toBe(1);
		expect(t1.calls).toBe(1);
		expect(fallbacks).toEqual(["tier-0->tier-1"]);
	});

	it("all tiers exhausted → throws with failed map", async () => {
		const t0 = tierAdapter([new Error("a")]);
		const t1 = tierAdapter([new Error("b")]);
		const adapter = cascadingLlmAdapter([
			{ name: "tier-0", adapter: t0 },
			{ name: "tier-1", adapter: t1 },
		]);
		try {
			await Promise.resolve(adapter.invoke([{ role: "user", content: "x" }]));
			throw new Error("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(AllTiersExhaustedError);
			const e = err as AllTiersExhaustedError;
			expect(e.failed.size).toBe(2);
			expect(e.skipped).toHaveLength(0);
		}
	});

	it("filter skip shows in `skipped`, not `failed`", async () => {
		const t0 = tierAdapter([okResp("A")]);
		const t1 = tierAdapter([new Error("b")]);
		const adapter = cascadingLlmAdapter([
			{ name: "tier-0", adapter: t0, filter: () => false },
			{ name: "tier-1", adapter: t1 },
		]);
		try {
			await Promise.resolve(adapter.invoke([{ role: "user", content: "x" }]));
			throw new Error("expected throw");
		} catch (err) {
			const e = err as AllTiersExhaustedError;
			expect(e.skipped).toEqual([{ name: "tier-0", reason: "filter" }]);
			expect(e.failed.size).toBe(1);
			expect(e.failed.has("tier-1")).toBe(true);
		}
	});

	it("filter skips tier", async () => {
		const t0 = tierAdapter([okResp("should-not-run")]);
		const t1 = tierAdapter([okResp("used")]);
		const adapter = cascadingLlmAdapter([
			{ name: "tier-0", adapter: t0, filter: (_m, opts) => !opts?.tools },
			{ name: "tier-1", adapter: t1 },
		]);
		const r = await Promise.resolve(
			adapter.invoke([{ role: "user", content: "x" }], {
				tools: [{ name: "t", description: "", parameters: {}, handler: () => null }],
			}),
		);
		expect(r.content).toBe("used");
		expect(t0.calls).toBe(0);
	});
});
