import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPLETE, DATA, ERROR, RESOLVED } from "../../core/messages.js";
import { pipe, producer, state } from "../../core/sugar.js";
import {
	constant,
	decorrelatedJitter,
	exponential,
	fibonacci,
	linear,
	NS_PER_MS,
	NS_PER_SEC,
	resolveBackoffPreset,
	withMaxAttempts,
} from "../../extra/backoff.js";
import {
	CircuitOpenError,
	circuitBreaker,
	rateLimiter,
	retry,
	tokenBucket,
	withBreaker,
	withStatus,
} from "../../extra/resilience.js";
import { Graph } from "../../graph/graph.js";

function collect(node: { subscribe: (fn: (m: unknown) => void) => () => void }) {
	const batches: unknown[][] = [];
	const unsub = node.subscribe((msgs) => {
		batches.push([...msgs]);
	});
	return { batches, unsub };
}

describe("extra resilience (roadmap §3.1)", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	describe("backoff (nanosecond units)", () => {
		it("constant returns fixed delay in ns", () => {
			const s = constant(500 * NS_PER_MS);
			expect(s(0)).toBe(500_000_000);
			expect(s(5)).toBe(500_000_000);
		});

		it("linear grows with attempt", () => {
			const s = linear(1 * NS_PER_SEC, 0.5 * NS_PER_SEC);
			expect(s(0)).toBe(1 * NS_PER_SEC);
			expect(s(1)).toBe(1.5 * NS_PER_SEC);
			expect(s(2)).toBe(2 * NS_PER_SEC);
		});

		it("fibonacci scales base", () => {
			const s = fibonacci(1 * NS_PER_SEC, 100 * NS_PER_SEC);
			expect(s(0)).toBe(1 * NS_PER_SEC);
			expect(s(1)).toBe(2 * NS_PER_SEC);
			expect(s(2)).toBe(3 * NS_PER_SEC);
		});

		it("resolveBackoffPreset returns strategies for all presets", () => {
			expect(typeof resolveBackoffPreset("constant")(0)).toBe("number");
			expect(typeof resolveBackoffPreset("exponential")(0)).toBe("number");
			expect(typeof resolveBackoffPreset("decorrelatedJitter")(0)).toBe("number");
		});

		it("resolveBackoffPreset throws on unknown", () => {
			expect(() => resolveBackoffPreset("nope" as never)).toThrow(/Unknown backoff preset/);
		});

		it("exponential caps maxDelayNs", () => {
			const s = exponential({
				baseNs: 1 * NS_PER_SEC,
				factor: 10,
				maxDelayNs: 5 * NS_PER_SEC,
				jitter: "none",
			});
			expect(s(100)).toBe(5 * NS_PER_SEC);
		});
	});

	describe("decorrelatedJitter", () => {
		it("returns values between base and ceiling", () => {
			const s = decorrelatedJitter(100 * NS_PER_MS, 10 * NS_PER_SEC);
			for (let i = 0; i < 50; i++) {
				const d = s(i, undefined, null);
				expect(d).toBeGreaterThanOrEqual(100 * NS_PER_MS);
				expect(d).toBeLessThanOrEqual(10 * NS_PER_SEC);
			}
		});

		it("uses prevDelay to compute ceiling", () => {
			const s = decorrelatedJitter(100 * NS_PER_MS, 10 * NS_PER_SEC);
			const d = s(1, undefined, 200 * NS_PER_MS);
			expect(d).toBeGreaterThanOrEqual(100 * NS_PER_MS);
			expect(d).toBeLessThanOrEqual(600 * NS_PER_MS); // min(10s, 200ms * 3)
		});

		it("defaults prevDelay to base", () => {
			const s = decorrelatedJitter(100 * NS_PER_MS, 10 * NS_PER_SEC);
			const d = s(0);
			expect(d).toBeGreaterThanOrEqual(100 * NS_PER_MS);
			expect(d).toBeLessThanOrEqual(300 * NS_PER_MS); // min(10s, 100ms * 3)
		});
	});

	describe("withMaxAttempts", () => {
		it("returns null after max attempts", () => {
			const inner = constant(1 * NS_PER_SEC);
			const capped = withMaxAttempts(inner, 3);
			expect(capped(0)).toBe(1 * NS_PER_SEC);
			expect(capped(1)).toBe(1 * NS_PER_SEC);
			expect(capped(2)).toBe(1 * NS_PER_SEC);
			expect(capped(3)).toBeNull();
			expect(capped(100)).toBeNull();
		});

		it("passes through inner strategy args", () => {
			const inner = linear(1 * NS_PER_SEC);
			const capped = withMaxAttempts(inner, 5);
			expect(capped(0)).toBe(1 * NS_PER_SEC);
			expect(capped(2)).toBe(3 * NS_PER_SEC);
		});
	});

	describe("retry", () => {
		it("forwards ERROR when count is 0", () => {
			const src = producer(
				(_d, a) => {
					a.down([[ERROR, new Error("x")]]);
				},
				{ resubscribable: true },
			);
			const out = retry({ count: 0 })(src);
			const { batches, unsub } = collect(out);
			expect(batches.flat().some((m) => m[0] === ERROR)).toBe(true);
			unsub();
		});

		it("resubscribes after ERROR when producer is resubscribable", async () => {
			vi.useFakeTimers();
			let runs = 0;
			const src = producer(
				(_d, a) => {
					runs += 1;
					if (runs === 1) {
						a.down([[ERROR, new Error("fail")]]);
					} else {
						a.emit(42);
					}
				},
				{ resubscribable: true },
			);
			const out = retry({ count: 2, backoff: constant(0) })(src);
			const { batches, unsub } = collect(out);
			await vi.advanceTimersByTimeAsync(10);
			const data = batches.flat().filter((m) => m[0] === DATA);
			expect(data.some((m) => m[1] === 42)).toBe(true);
			unsub();
		});
	});

	describe("circuitBreaker (factory)", () => {
		it("opens after threshold failures", () => {
			const b = circuitBreaker({ failureThreshold: 2, cooldownNs: 60 * NS_PER_SEC });
			expect(b.canExecute()).toBe(true);
			b.recordFailure();
			b.recordFailure();
			expect(b.state).toBe("open");
			expect(b.canExecute()).toBe(false);
		});

		it("exposes failureCount", () => {
			const b = circuitBreaker({ failureThreshold: 5 });
			expect(b.failureCount).toBe(0);
			b.recordFailure();
			expect(b.failureCount).toBe(1);
			b.recordFailure();
			expect(b.failureCount).toBe(2);
		});

		it("reset() returns to closed", () => {
			const b = circuitBreaker({ failureThreshold: 1 });
			b.recordFailure();
			expect(b.state).toBe("open");
			b.reset();
			expect(b.state).toBe("closed");
			expect(b.failureCount).toBe(0);
			expect(b.canExecute()).toBe(true);
		});

		it("injectable now() for testing", () => {
			let clock = 1000;
			const b = circuitBreaker({
				failureThreshold: 1,
				cooldownNs: 5 * NS_PER_SEC,
				now: () => clock,
			});
			b.recordFailure();
			expect(b.state).toBe("open");
			expect(b.canExecute()).toBe(false);

			clock += 4999;
			expect(b.canExecute()).toBe(false);

			clock += 2;
			expect(b.canExecute()).toBe(true);
			expect(b.state).toBe("half-open");
		});

		it("escalating cooldown via backoff strategy", () => {
			let clock = 0;
			const b = circuitBreaker({
				failureThreshold: 1,
				cooldown: (openCycle) => (openCycle + 1) * NS_PER_SEC,
				now: () => clock,
			});

			// First open cycle: cooldown = 1s = 1000ms
			b.recordFailure();
			expect(b.state).toBe("open");
			clock += 1000;
			expect(b.canExecute()).toBe(true);
			expect(b.state).toBe("half-open");

			// Fail in half-open → open cycle increments
			b.recordFailure();
			expect(b.state).toBe("open");

			// Second open cycle: cooldown = 2s = 2000ms
			clock += 1999;
			expect(b.canExecute()).toBe(false);
			clock += 2;
			expect(b.canExecute()).toBe(true);
			expect(b.state).toBe("half-open");

			// Success resets open cycle
			b.recordSuccess();
			expect(b.state).toBe("closed");
		});

		it("half-open respects halfOpenMax", () => {
			let clock = 0;
			const b = circuitBreaker({
				failureThreshold: 1,
				cooldownNs: 1 * NS_PER_SEC,
				halfOpenMax: 2,
				now: () => clock,
			});
			b.recordFailure();
			clock += 1000;
			expect(b.canExecute()).toBe(true); // trial 1
			expect(b.canExecute()).toBe(true); // trial 2
			expect(b.canExecute()).toBe(false); // max reached
		});
	});

	describe("withBreaker", () => {
		it("skip emits RESOLVED when open", () => {
			const b = circuitBreaker({ failureThreshold: 1, cooldownNs: 600 * NS_PER_SEC });
			b.recordFailure();
			const s = state(1);
			const { node: out } = withBreaker(b)(s);
			const { batches, unsub } = collect(out);
			s.down([[DATA, 2]]);
			expect(batches.flat().some((m) => m[0] === RESOLVED)).toBe(true);
			unsub();
		});

		it("onOpen error emits CircuitOpenError", () => {
			const b = circuitBreaker({ failureThreshold: 1, cooldownNs: 600 * NS_PER_SEC });
			b.recordFailure();
			const s = state(1);
			const { node: out } = withBreaker(b, { onOpen: "error" })(s);
			const { batches, unsub } = collect(out);
			s.down([[DATA, 2]]);
			const errBatch = batches.flat().find((m) => m[0] === ERROR);
			expect(errBatch).toBeDefined();
			expect(errBatch?.[1]).toBeInstanceOf(CircuitOpenError);
			unsub();
		});
	});

	describe("tokenBucket / rateLimiter", () => {
		it("tokenBucket tryConsume respects capacity", () => {
			const tb = tokenBucket(2, 0);
			expect(tb.tryConsume(1)).toBe(true);
			expect(tb.tryConsume(1)).toBe(true);
			expect(tb.tryConsume(1)).toBe(false);
		});

		it("rateLimiter queues beyond window (fake timers + performance)", async () => {
			const now = { v: 1_000_000 };
			const spy = vi.spyOn(performance, "now").mockImplementation(() => now.v);
			vi.useFakeTimers();
			const s = state(0);
			const out = rateLimiter(1, 1 * NS_PER_SEC)(s);
			const { batches, unsub } = collect(out);
			s.down([[DATA, 1]]);
			s.down([[DATA, 2]]);
			const dataImmediate = batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1]);
			expect(dataImmediate).toEqual([1]);
			now.v += 1001;
			await vi.advanceTimersByTimeAsync(1100);
			const dataAfter = batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1]);
			expect(dataAfter).toEqual([1, 2]);
			unsub();
			spy.mockRestore();
		});
	});

	describe("withStatus", () => {
		it("tracks active, completed, errored", () => {
			const s = state(0);
			const { node: out, status } = withStatus(s);
			const { batches, unsub } = collect(out);
			expect(status.get()).toBe("pending");
			s.down([[DATA, 1]]);
			expect(status.get()).toBe("active");
			s.down([[COMPLETE]]);
			expect(status.get()).toBe("completed");
			expect(batches.flat().some((m) => m[0] === COMPLETE)).toBe(true);
			unsub();
		});

		it("clears error on DATA after errored (batched)", () => {
			const s = state(0, { resubscribable: true });
			const { node: out, status, error } = withStatus(s);
			const { unsub } = collect(out);
			s.down([[ERROR, new Error("e")]]);
			expect(status.get()).toBe("errored");
			expect(error.get()).toBeInstanceOf(Error);
			s.down([[DATA, 1]]);
			expect(status.get()).toBe("active");
			expect(error.get()).toBeNull();
			unsub();
		});
	});

	describe("meta integration (spec §2.3)", () => {
		it("withBreaker breakerState is accessible via node.meta", () => {
			const b = circuitBreaker({ failureThreshold: 2 });
			const s = state(1);
			const bundle = withBreaker(b)(s);
			expect(bundle.node.meta.breakerState).toBe(bundle.breakerState);
			expect(bundle.breakerState.get()).toBe("closed");
		});

		it("withStatus companions are accessible via node.meta", () => {
			const s = state(0);
			const bundle = withStatus(s);
			expect(bundle.node.meta.status).toBe(bundle.status);
			expect(bundle.node.meta.error).toBe(bundle.error);
			expect(bundle.status.get()).toBe("pending");
		});

		it("withBreaker breakerState appears in graph.describe()", () => {
			const b = circuitBreaker({ failureThreshold: 2 });
			const s = state(1);
			const bundle = withBreaker(b)(s);
			const g = new Graph("test");
			g.add("src", s);
			g.add("guarded", bundle.node);
			const desc = g.describe();
			const metaPath = "guarded::__meta__::breakerState";
			expect(desc.nodes[metaPath]).toBeDefined();
			expect(desc.nodes[metaPath].value).toBe("closed");
		});

		it("withStatus companions appear in graph.describe()", () => {
			const s = state(0);
			const bundle = withStatus(s);
			const g = new Graph("test");
			g.add("src", s);
			g.add("tracked", bundle.node);
			const desc = g.describe();
			expect(desc.nodes["tracked::__meta__::status"]).toBeDefined();
			expect(desc.nodes["tracked::__meta__::status"].value).toBe("pending");
			expect(desc.nodes["tracked::__meta__::error"]).toBeDefined();
			expect(desc.nodes["tracked::__meta__::error"].value).toBeNull();
		});
	});

	describe("pipe composition", () => {
		it("pipe accepts retry operator", () => {
			const s = state(1);
			const out = pipe(s, retry({ count: 0 }));
			expect(out.get()).toBe(1);
		});
	});
});
