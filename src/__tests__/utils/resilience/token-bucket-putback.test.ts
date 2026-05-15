import { describe, expect, it } from "vitest";
import { tokenBucket } from "../../../utils/resilience/rate-limiter.js";

describe("TokenBucket.putBack", () => {
	it("returns consumed tokens to the bucket", () => {
		const b = tokenBucket(10, 0);
		expect(b.tryConsume(5)).toBe(true);
		expect(b.available()).toBeCloseTo(5);
		b.putBack(3);
		expect(b.available()).toBeCloseTo(8);
	});

	it("caps at capacity", () => {
		const b = tokenBucket(10, 0);
		expect(b.tryConsume(2)).toBe(true);
		b.putBack(100);
		expect(b.available()).toBeCloseTo(10);
	});

	it("no-op on non-positive cost", () => {
		const b = tokenBucket(10, 0);
		b.tryConsume(5);
		b.putBack(0);
		b.putBack(-5);
		expect(b.available()).toBeCloseTo(5);
	});

	it("default cost is 1", () => {
		const b = tokenBucket(10, 0);
		b.tryConsume(5);
		b.putBack();
		expect(b.available()).toBeCloseTo(6);
	});
});
