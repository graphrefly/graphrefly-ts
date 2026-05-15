import { describe, expect, it } from "vitest";
import {
	emptyUsage,
	isLLMAdapter,
	sumInputTokens,
	sumOutputTokens,
	type TokenUsage,
} from "../../../../utils/ai/adapters/core/types.js";

describe("TokenUsage helpers", () => {
	it("sumInputTokens sums all input classes + extensions", () => {
		const u: TokenUsage = {
			input: {
				regular: 100,
				cacheRead: 50,
				cacheWrite5m: 10,
				cacheWrite1h: 20,
				cacheWriteOther: 5,
				audio: 30,
				image: 40,
				video: 15,
				toolUse: 25,
				extensions: { exotic: 7 },
			},
			output: { regular: 0 },
		};
		expect(sumInputTokens(u)).toBe(100 + 50 + 10 + 20 + 5 + 30 + 40 + 15 + 25 + 7);
	});

	it("sumInputTokens handles missing optional fields", () => {
		const u = emptyUsage();
		u.input.regular = 100;
		u.input.cacheRead = 10;
		expect(sumInputTokens(u)).toBe(110);
	});

	it("sumOutputTokens sums all output classes + extensions", () => {
		const u: TokenUsage = {
			input: { regular: 0 },
			output: {
				regular: 100,
				reasoning: 200,
				audio: 30,
				predictionAccepted: 5,
				predictionRejected: 3,
				extensions: { foo: 2 },
			},
		};
		expect(sumOutputTokens(u)).toBe(100 + 200 + 30 + 5 + 3 + 2);
	});

	it("isLLMAdapter accepts well-formed adapter", () => {
		expect(
			isLLMAdapter({
				provider: "test",
				invoke: () => undefined,
				stream: () => (async function* () {})(),
			}),
		).toBe(true);
	});

	it("isLLMAdapter rejects non-adapters", () => {
		expect(isLLMAdapter(null)).toBe(false);
		expect(isLLMAdapter({})).toBe(false);
		expect(isLLMAdapter({ provider: "x" })).toBe(false);
		expect(isLLMAdapter({ provider: "x", invoke: () => undefined })).toBe(false);
	});
});
