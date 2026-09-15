import { describe, expect, it } from "vitest";
import {
	classifyHttpRecovery,
	parseRetryAfterMs,
	recoveryDelay,
} from "../../evals/graph-native-rerun-avoidance/openrouter-recovery.mjs";

describe("shared OpenRouter recovery policy", () => {
	it("parses seconds and dates without shortening an over-limit provider wait", () => {
		const now = Date.parse("2026-09-15T00:00:00Z");
		expect(parseRetryAfterMs(null, now)).toEqual({ kind: "absent" });
		expect(parseRetryAfterMs("nonsense", now)).toEqual({ kind: "invalid" });
		expect(parseRetryAfterMs("0", now)).toEqual({ kind: "invalid" });
		expect(parseRetryAfterMs("1", now)).toEqual({ kind: "valid", delayMs: 1000 });
		expect(parseRetryAfterMs("Tue, 15 Sep 2026 00:02:00 GMT", now)).toEqual({
			kind: "valid",
			delayMs: 120000,
		});
		expect(parseRetryAfterMs("240", now)).toEqual({ kind: "valid", delayMs: 240000 });
		expect(parseRetryAfterMs("241", now)).toEqual({ kind: "valid-over-limit" });
		expect(parseRetryAfterMs("999999999999999999999999999999", now)).toEqual({
			kind: "valid-over-limit",
		});
	});
	it("classifies capacity, unconditional, conditional and terminal HTTP failures", () => {
		const absent = { kind: "absent" } as const;
		expect(classifyHttpRecovery(429, {}, absent)).toBe("capacity");
		for (const status of [408, 425, 502, 503, 504, 520])
			expect(classifyHttpRecovery(status, {}, absent)).toBe("availability");
		for (const status of [409, 423, 424, 500]) {
			expect(classifyHttpRecovery(status, {}, absent)).toBeNull();
			expect(classifyHttpRecovery(status, {}, { kind: "valid", delayMs: 1000 })).toBe(
				"availability",
			);
			expect(classifyHttpRecovery(status, {}, { kind: "valid-over-limit" })).toBe("availability");
			expect(
				classifyHttpRecovery(
					status,
					{ error: { metadata: { provider_error_code: "UPSTREAM_TIMEOUT" } } },
					absent,
				),
			).toBe("availability");
		}
		for (const status of [200, 400, 401, 402, 403, 404, 422])
			expect(
				classifyHttpRecovery(status, { error: { code: "upstream_timeout" } }, absent),
			).toBeNull();
	});
	it("bounds independent retry classes and honors Retry-After over the fallback", () => {
		const input = {
			recoveryClass: "capacity" as const,
			capacityRetryOrdinal: 0,
			availabilityRetryOrdinal: 0,
			retryAfterMs: 1000,
		};
		expect(
			[0, 1, 2, 3].map((capacityRetryOrdinal) => recoveryDelay({ ...input, capacityRetryOrdinal })),
		).toEqual([60000, 120000, 240000, null]);
		expect(recoveryDelay({ ...input, retryAfterMs: 150000 })).toBe(150000);
		expect(recoveryDelay({ ...input, retryAfterMs: 240001 })).toBeNull();
		expect(
			recoveryDelay({ ...input, recoveryClass: "availability", capacityRetryOrdinal: 3 }),
		).toBe(60000);
		expect(
			recoveryDelay({ ...input, recoveryClass: "availability", availabilityRetryOrdinal: 1 }),
		).toBeNull();
		expect(recoveryDelay({ ...input, availabilityRetryOrdinal: 1 })).toBe(60000);
		expect(() => recoveryDelay({ ...input, capacityRetryOrdinal: -1 })).toThrow();
		expect(() => recoveryDelay({ ...input, retryAfterMs: NaN })).toThrow();
	});
});
