import { describe, expect, it } from "vitest";
import { parseRateLimitFromError } from "../../../../patterns/ai/adapters/middleware/http429-parser.js";

describe("parseRateLimitFromError", () => {
	it("extracts retry-after seconds from 429", () => {
		const sig = parseRateLimitFromError({
			status: 429,
			headers: { "retry-after": "5" },
			message: "rate limit",
		});
		expect(sig?.retryAfterMs).toBe(5000);
	});

	it("parses x-ratelimit-limit-* headers", () => {
		const sig = parseRateLimitFromError({
			status: 429,
			headers: {
				"x-ratelimit-limit-requests": "60",
				"x-ratelimit-limit-tokens": "100000",
				"x-ratelimit-remaining-requests": "30",
				"x-ratelimit-remaining-tokens": "75000",
			},
		});
		expect(sig?.rpmCap).toBe(60);
		expect(sig?.tpmCap).toBe(100000);
		expect(sig?.usageHint?.rpm).toBeCloseTo(0.5);
		expect(sig?.usageHint?.tpm).toBeCloseTo(0.25);
	});

	it("ignores non-rate-limit errors", () => {
		const sig = parseRateLimitFromError({
			status: 400,
			message: "invalid request",
		});
		expect(sig).toBeUndefined();
	});

	it("extracts from error message fallback", () => {
		const sig = parseRateLimitFromError({
			status: 429,
			message: "Please retry after 3 seconds",
		});
		expect(sig?.retryAfterMs).toBe(3000);
	});

	it("handles Headers-like objects", () => {
		const headers = new Headers({ "retry-after": "10" });
		const sig = parseRateLimitFromError({ status: 429, headers, message: "" });
		expect(sig?.retryAfterMs).toBe(10_000);
	});
});
