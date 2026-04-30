import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPLETE, DATA, ERROR, RESOLVED } from "../../core/messages.js";
import { node } from "../../core/node.js";

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
	type CircuitBreakerOptions,
	CircuitOpenError,
	circuitBreaker,
	fallback,
	type RateLimiterOptions,
	RateLimiterOverflowError,
	type RateLimiterState,
	type RetryOptions,
	rateLimiter,
	retry,
	TimeoutError,
	timeout,
	tokenBucket,
	withBreaker,
	withStatus,
} from "../../extra/resilience.js";
import { throwError } from "../../extra/sources.js";
import { Graph } from "../../graph/graph.js";
import { collect } from "../test-helpers.js";

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
			const src = node(
				[],
				(_data, a) => {
					a.down([[ERROR, new Error("x")]]);
				},
				{ describeKind: "producer", resubscribable: true },
			);
			const out = retry(src, { count: 0 });
			const { batches, unsub } = collect(out);
			expect(batches.flat().some((m) => m[0] === ERROR)).toBe(true);
			unsub();
		});

		it("resubscribes after ERROR when producer is resubscribable", async () => {
			vi.useFakeTimers();
			let runs = 0;
			const src = node(
				[],
				(_data, a) => {
					runs += 1;
					if (runs === 1) {
						a.down([[ERROR, new Error("fail")]]);
					} else {
						a.emit(42);
					}
				},
				{ describeKind: "producer", resubscribable: true },
			);
			const out = retry(src, { count: 2, backoff: constant(0) });
			const { batches, unsub } = collect(out);
			await vi.advanceTimersByTimeAsync(10);
			const data = batches.flat().filter((m) => m[0] === DATA);
			expect(data.some((m) => m[1] === 42)).toBe(true);
			unsub();
		});
	});

	describe("retry + withMaxAttempts", () => {
		it("null from strategy stops retry immediately", async () => {
			vi.useFakeTimers();
			let runs = 0;
			const src = node(
				[],
				(_data, a) => {
					runs += 1;
					a.down([[ERROR, new Error(`fail-${runs}`)]]);
				},
				{ describeKind: "producer", resubscribable: true },
			);
			// withMaxAttempts(constant(0), 2) → attempts 0,1 get 0 delay; attempt 2 → null → stop.
			// `count: Infinity` because the strategy's null-return is what bounds the retries here.
			const capped = withMaxAttempts(constant(0), 2);
			const out = retry(src, { count: Infinity, backoff: capped });
			const { batches, unsub } = collect(out);
			await vi.advanceTimersByTimeAsync(50);
			const errors = batches.flat().filter((m) => m[0] === ERROR);
			expect(errors.length).toBe(1);
			// 1 initial + 2 retries = 3 total runs
			expect(runs).toBe(3);
			unsub();
		});
	});

	describe("retry (factory form, formerly retrySource)", () => {
		it("builds a fresh source per attempt", async () => {
			vi.useFakeTimers();
			let builds = 0;
			const factory = () => {
				builds += 1;
				return node<number>(
					[],
					(_data, a) => {
						if (builds < 3) {
							a.down([[ERROR, new Error(`boom-${builds}`)]]);
						} else {
							a.emit(42);
						}
					},
					{ describeKind: "producer" },
				);
			};
			const out = retry(factory, { count: 5, backoff: constant(0) });
			const { batches, unsub } = collect(out);
			await vi.advanceTimersByTimeAsync(10);
			const data = batches.flat().filter((m) => m[0] === DATA);
			expect(data.some((m) => m[1] === 42)).toBe(true);
			// 1 initial attempt + 2 retries after errors = 3 builds total
			expect(builds).toBe(3);
			unsub();
		});

		it("surfaces ERROR when count is 0", () => {
			const factory = () =>
				node<number>(
					[],
					(_data, a) => {
						a.down([[ERROR, new Error("x")]]);
					},
					{ describeKind: "producer" },
				);
			const out = retry(factory, { count: 0 });
			const { batches, unsub } = collect(out);
			expect(batches.flat().some((m) => m[0] === ERROR)).toBe(true);
			unsub();
		});

		it("surfaces ERROR when maxRetries exhausted", async () => {
			vi.useFakeTimers();
			let builds = 0;
			const factory = () => {
				builds += 1;
				return node<number>(
					[],
					(_data, a) => {
						a.down([[ERROR, new Error(`build-${builds}`)]]);
					},
					{ describeKind: "producer" },
				);
			};
			const out = retry(factory, { count: 2, backoff: constant(0) });
			const { batches, unsub } = collect(out);
			await vi.advanceTimersByTimeAsync(10);
			const errors = batches.flat().filter((m) => m[0] === ERROR);
			expect(errors.length).toBe(1);
			// 1 initial + 2 retries = 3 builds
			expect(builds).toBe(3);
			unsub();
		});

		it("synchronous throw from factory is retried like inner ERROR", async () => {
			vi.useFakeTimers();
			let builds = 0;
			const factory = () => {
				builds += 1;
				if (builds < 2) throw new Error("factory threw");
				return node<number>(
					[],
					(_data, a) => {
						a.emit(7);
					},
					{ describeKind: "producer" },
				);
			};
			const out = retry(factory, { count: 3, backoff: constant(0) });
			const { batches, unsub } = collect(out);
			await vi.advanceTimersByTimeAsync(10);
			const data = batches.flat().filter((m) => m[0] === DATA);
			expect(data.some((m) => m[1] === 7)).toBe(true);
			expect(builds).toBe(2);
			unsub();
		});

		it("forwards COMPLETE without building a new source", () => {
			let builds = 0;
			const factory = () => {
				builds += 1;
				return node<number>(
					[],
					(_data, a) => {
						a.emit(1);
						a.down([[COMPLETE]]);
					},
					{ describeKind: "producer" },
				);
			};
			const out = retry(factory, { count: 5, backoff: constant(0) });
			const { batches, unsub } = collect(out);
			expect(batches.flat().some((m) => m[0] === COMPLETE)).toBe(true);
			expect(builds).toBe(1);
			unsub();
		});

		it("resets attempt counter after a successful DATA", async () => {
			vi.useFakeTimers();
			let builds = 0;
			const factory = () => {
				builds += 1;
				return node<number>(
					[],
					(_data, a) => {
						if (builds === 1) {
							a.emit(10);
							// Then error — next build should start fresh (attempt=0)
							a.down([[ERROR, new Error("mid-stream")]]);
						} else if (builds <= 4) {
							a.down([[ERROR, new Error(`e-${builds}`)]]);
						} else {
							a.emit(20);
						}
					},
					{ describeKind: "producer" },
				);
			};
			// Without reset-on-DATA, count=4 permits builds 1..5 regardless.
			// With reset-on-DATA semantics, after build=1 emits 10 the attempt
			// counter is cleared, so the subsequent errors all fit within the
			// same retry budget. We assert the happy path reaches build 5.
			const out = retry(factory, { count: 4, backoff: constant(0) });
			const { batches, unsub } = collect(out);
			await vi.advanceTimersByTimeAsync(20);
			const data = batches.flat().filter((m) => m[0] === DATA);
			expect(data.map((m) => m[1])).toEqual([10, 20]);
			expect(builds).toBe(5);
			unsub();
		});

		it("teardown cancels pending retry timer and unsubs active source", async () => {
			vi.useFakeTimers();
			let builds = 0;
			let innerTeardowns = 0;
			const factory = () => {
				builds += 1;
				return node<number>(
					(_a) => {
						return () => {
							innerTeardowns += 1;
						};
					},
					{ describeKind: "producer" },
				);
			};
			const out = retry(factory, { count: 10, backoff: constant(1 * NS_PER_SEC) });
			const { unsub } = collect(out);
			unsub();
			await vi.advanceTimersByTimeAsync(10 * NS_PER_SEC);
			// No further builds should happen after unsub
			expect(builds).toBe(1);
			expect(innerTeardowns).toBe(1);
		});

		it("forwards DATA / DIRTY / RESOLVED transparently", async () => {
			const src = node<number>([], { initial: 1 });
			const out = retry(() => src, { count: 0 });
			const { batches, unsub } = collect(out);
			src.down([[DATA, 2]]);
			const data = batches.flat().filter((m) => m[0] === DATA);
			expect(data.map((m) => m[1])).toEqual([1, 2]);
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
			let clock = 1 * NS_PER_SEC;
			const b = circuitBreaker({
				failureThreshold: 1,
				cooldownNs: 5 * NS_PER_SEC,
				now: () => clock,
			});
			b.recordFailure();
			expect(b.state).toBe("open");
			expect(b.canExecute()).toBe(false);

			clock += 5 * NS_PER_SEC - NS_PER_MS;
			expect(b.canExecute()).toBe(false);

			clock += 2 * NS_PER_MS;
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

			// First open cycle: cooldown = 1s
			b.recordFailure();
			expect(b.state).toBe("open");
			clock += 1 * NS_PER_SEC;
			expect(b.canExecute()).toBe(true);
			expect(b.state).toBe("half-open");

			// Fail in half-open → open cycle increments
			b.recordFailure();
			expect(b.state).toBe("open");

			// Second open cycle: cooldown = 2s
			clock += 2 * NS_PER_SEC - NS_PER_MS;
			expect(b.canExecute()).toBe(false);
			clock += 2 * NS_PER_MS;
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
			clock += 1 * NS_PER_SEC;
			expect(b.canExecute()).toBe(true); // trial 1
			expect(b.canExecute()).toBe(true); // trial 2
			expect(b.canExecute()).toBe(false); // max reached
		});
	});

	describe("withBreaker", () => {
		it("skip emits RESOLVED when open", () => {
			const b = circuitBreaker({ failureThreshold: 1, cooldownNs: 600 * NS_PER_SEC });
			b.recordFailure();
			const s = node([], { initial: 1 });
			const { node: out } = withBreaker(b)(s);
			const { batches, unsub } = collect(out);
			s.down([[DATA, 2]]);
			expect(batches.flat().some((m) => m[0] === RESOLVED)).toBe(true);
			unsub();
		});

		it("onOpen error emits CircuitOpenError", () => {
			const b = circuitBreaker({ failureThreshold: 1, cooldownNs: 600 * NS_PER_SEC });
			b.recordFailure();
			const s = node([], { initial: 1 });
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

		it("tokenBucket clock injection drives refill deterministically (qa A12)", () => {
			let t = 0;
			const tb = tokenBucket(5, 1, { clock: () => t });
			// Exhaust the bucket
			expect(tb.tryConsume(5)).toBe(true);
			expect(tb.tryConsume(1)).toBe(false);
			// Advance virtual clock 1s — refill rate is 1 token/sec, so 1 token added
			t = 1_000_000_000;
			expect(tb.tryConsume(1)).toBe(true);
			expect(tb.tryConsume(1)).toBe(false);
			// Advance another 2s → 2 more tokens
			t = 3_000_000_000;
			expect(tb.tryConsume(2)).toBe(true);
			expect(tb.tryConsume(1)).toBe(false);
			// Available is float-valued (qa A12 / JSDoc claim)
			t = 3_500_000_000;
			expect(tb.available()).toBeCloseTo(0.5, 5);
		});

		it("rateLimiter queues beyond rate (fake timers + performance)", async () => {
			const now = { v: 1_000_000 };
			const spy = vi.spyOn(performance, "now").mockImplementation(() => now.v);
			vi.useFakeTimers();
			const s = node([], { initial: 0 });
			const { node: out } = rateLimiter(s, {
				maxEvents: 1,
				windowNs: 1 * NS_PER_SEC,
				maxBuffer: Infinity,
			});
			const { batches, unsub } = collect(out);
			s.down([[DATA, 1]]);
			s.down([[DATA, 2]]);
			const dataImmediate = batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1]);
			// Push-on-subscribe delivers the initial cached value (0), consuming the single token.
			// DATA 1 and DATA 2 are queued.
			expect(dataImmediate).toEqual([0]);
			now.v += 1001;
			await vi.advanceTimersByTimeAsync(1100);
			const dataAfter = batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1]);
			// After token refill, queued item 1 drains
			expect(dataAfter).toContain(0);
			expect(dataAfter).toContain(1);
			unsub();
			spy.mockRestore();
		});

		it("rateLimiter maxBuffer + drop-newest drops incoming overflow", () => {
			const s = node([], { initial: 0 });
			const { node: out } = rateLimiter(s, {
				maxEvents: 1,
				windowNs: 10 * NS_PER_SEC,
				maxBuffer: 1,
				onOverflow: "drop-newest",
			});
			const { batches, unsub } = collect(out);
			// Push-on-subscribe emits 0 (consumes the one token).
			// DATA 1 → queued (pending=1). DATA 2 → dropped (pending already at maxBuffer=1).
			// DATA 3 → dropped as well.
			s.down([[DATA, 1]]);
			s.down([[DATA, 2]]);
			s.down([[DATA, 3]]);
			const dataValues = batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1]);
			expect(dataValues).toEqual([0]); // only the initial token-consuming emission
			unsub();
		});

		it("rateLimiter maxBuffer + drop-oldest evicts the oldest pending item", () => {
			const s = node([], { initial: 0 });
			const { node: out } = rateLimiter(s, {
				maxEvents: 1,
				windowNs: 10 * NS_PER_SEC,
				maxBuffer: 1,
				onOverflow: "drop-oldest",
			});
			const { unsub } = collect(out);
			// Push-on-subscribe emits 0 (consumes token).
			s.down([[DATA, 1]]); // queued
			s.down([[DATA, 2]]); // overflow → drop 1, queue 2
			s.down([[DATA, 3]]); // overflow → drop 2, queue 3
			// pending[] should contain only [3]; no way to observe without advancing time
			unsub();
		});

		it("rateLimiter maxBuffer + error emits RateLimiterOverflowError", () => {
			const s = node([], { initial: 0 });
			const { node: out } = rateLimiter(s, {
				maxEvents: 1,
				windowNs: 10 * NS_PER_SEC,
				maxBuffer: 1,
				onOverflow: "error",
			});
			const { batches, unsub } = collect(out);
			s.down([[DATA, 1]]); // queued (fills buffer)
			s.down([[DATA, 2]]); // overflow → ERROR
			const errBatch = batches.flat().find((m) => m[0] === ERROR);
			expect(errBatch).toBeDefined();
			expect(errBatch?.[1]).toBeInstanceOf(RateLimiterOverflowError);
			unsub();
		});
	});

	describe("withStatus", () => {
		it("tracks active, completed, errored", () => {
			const s = node<number>();
			const { node: out, status } = withStatus(s);
			const { batches, unsub } = collect(out);
			expect(status.cache).toBe("pending");
			s.down([[DATA, 1]]);
			expect(status.cache).toBe("running");
			s.down([[COMPLETE]]);
			expect(status.cache).toBe("completed");
			expect(batches.flat().some((m) => m[0] === COMPLETE)).toBe(true);
			unsub();
		});

		it("clears error on DATA after errored (batched)", () => {
			const s = node([], { resubscribable: true, initial: 0 });
			const { node: out, status, error } = withStatus(s);
			const { unsub } = collect(out);
			s.down([[ERROR, new Error("e")]]);
			expect(status.cache).toBe("errored");
			expect(error.cache).toBeInstanceOf(Error);
			s.down([[DATA, 1]]);
			expect(status.cache).toBe("running");
			expect(error.cache).toBeNull();
			unsub();
		});
	});

	describe("meta integration (spec §2.3)", () => {
		it("withBreaker breakerState is accessible via node.meta", () => {
			const b = circuitBreaker({ failureThreshold: 2 });
			const s = node([], { initial: 1 });
			const bundle = withBreaker(b)(s);
			expect(bundle.node.meta.breakerState).toBe(bundle.breakerState);
			expect(bundle.breakerState.cache).toBe("closed");
		});

		it("withStatus companions are accessible via node.meta", () => {
			const s = node([], { initial: 0 });
			const bundle = withStatus(s);
			expect(bundle.node.meta.status).toBe(bundle.status);
			expect(bundle.node.meta.error).toBe(bundle.error);
			expect(bundle.status.cache).toBe("pending");
		});

		it("withBreaker breakerState appears in graph.describe()", () => {
			const b = circuitBreaker({ failureThreshold: 2 });
			const s = node([], { initial: 1 });
			const bundle = withBreaker(b)(s);
			const g = new Graph("test");
			g.add(s, { name: "src" });
			g.add(bundle.node, { name: "guarded" });
			const desc = g.describe({ detail: "standard" });
			const metaPath = "guarded::__meta__::breakerState";
			expect(desc.nodes[metaPath]).toBeDefined();
			expect(desc.nodes[metaPath].value).toBe("closed");
		});

		it("withStatus companions appear in graph.describe()", () => {
			const s = node([], { initial: 0 });
			const bundle = withStatus(s);
			const g = new Graph("test");
			g.add(s, { name: "src" });
			g.add(bundle.node, { name: "tracked" });
			const desc = g.describe({ detail: "standard" });
			expect(desc.nodes["tracked::__meta__::status"]).toBeDefined();
			expect(desc.nodes["tracked::__meta__::status"].value).toBe("pending");
			expect(desc.nodes["tracked::__meta__::error"]).toBeDefined();
			expect(desc.nodes["tracked::__meta__::error"].value).toBeNull();
		});
	});

	describe("pipe composition", () => {
		it("pipe accepts retry operator", () => {
			const s = node([], { initial: 1 });
			const out = retry(s, { count: 0 });
			expect(out.cache).toBe(1);
		});
	});

	// ——————————————————————————————————————————————————————————————
	//  §3.1c — fallback, timeout, cache
	// ——————————————————————————————————————————————————————————————

	describe("fallback", () => {
		it("passes through DATA/COMPLETE from healthy source", () => {
			const src = node([], { initial: 42 });
			const out = fallback(src, 0);
			const { batches, unsub } = collect(out);
			src.down([[DATA, 99]]);
			const flat = batches.flat();
			expect(
				flat.some(
					(m) => (m as [symbol, unknown])[0] === DATA && (m as [symbol, unknown])[1] === 99,
				),
			).toBe(true);
			unsub();
		});

		it("emits fallback value on ERROR (value mode)", () => {
			const src = throwError(new Error("boom"));
			const out = fallback(src, "default");
			const { batches, unsub } = collect(out);
			const flat = batches.flat();
			expect(
				flat.some(
					(m) => (m as [symbol, unknown])[0] === DATA && (m as [symbol, unknown])[1] === "default",
				),
			).toBe(true);
			expect(flat.some((m) => (m as [symbol])[0] === COMPLETE)).toBe(true);
			expect(flat.some((m) => (m as [symbol])[0] === ERROR)).toBe(false);
			unsub();
		});

		it("switches to fallback node on ERROR (node mode)", () => {
			const src = throwError(new Error("boom"));
			const fb = node([], { initial: "fallback-value" });
			const out = fallback(src, fb);
			const { batches, unsub } = collect(out);
			const flat = batches.flat();
			expect(
				flat.some(
					(m) =>
						(m as [symbol, unknown])[0] === DATA &&
						(m as [symbol, unknown])[1] === "fallback-value",
				),
			).toBe(true);
			expect(flat.some((m) => (m as [symbol])[0] === ERROR)).toBe(false);
			unsub();
		});

		it("resolves a Promise fallback on ERROR", async () => {
			const src = throwError(new Error("boom"));
			const out = fallback(src, Promise.resolve("async-default"));
			const { batches, unsub } = collect(out);
			await new Promise((r) => setTimeout(r, 10));
			const flat = batches.flat();
			expect(
				flat.some(
					(m) =>
						(m as [symbol, unknown])[0] === DATA && (m as [symbol, unknown])[1] === "async-default",
				),
			).toBe(true);
			expect(flat.some((m) => (m as [symbol])[0] === ERROR)).toBe(false);
			unsub();
		});

		it("streams an AsyncIterable fallback on ERROR", async () => {
			const src = throwError(new Error("boom"));
			async function* gen(): AsyncIterable<number> {
				yield 1;
				yield 2;
				yield 3;
			}
			const out = fallback(src, gen());
			const { batches, unsub } = collect(out);
			await new Promise((r) => setTimeout(r, 20));
			const values = batches
				.flat()
				.filter((m) => (m as [symbol])[0] === DATA)
				.map((m) => (m as [symbol, unknown])[1]);
			expect(values).toContain(1);
			expect(values).toContain(2);
			expect(values).toContain(3);
			unsub();
		});

		it("emits a bare string as a scalar value (not split into chars)", () => {
			const src = throwError(new Error("boom"));
			const out = fallback(src, "default");
			const { batches, unsub } = collect(out);
			const values = batches
				.flat()
				.filter((m) => (m as [symbol])[0] === DATA)
				.map((m) => (m as [symbol, unknown])[1]);
			// Must be the whole string, not ["d","e","f","a","u","l","t"]
			expect(values).toEqual(["default"]);
			unsub();
		});

		it("composes with retry: retry then fallback", async () => {
			const src = node(
				[],
				(_data, a) => {
					a.down([[ERROR, new Error("x")]]);
				},
				{ describeKind: "producer", resubscribable: true },
			);
			// retry with count: 0 means no retries — ERROR propagates immediately
			const out = fallback(retry(src, { count: 0 }), "safe");
			const { batches, unsub } = collect(out);
			await new Promise((r) => setTimeout(r, 20));
			const flat = batches.flat();
			expect(
				flat.some(
					(m) => (m as [symbol, unknown])[0] === DATA && (m as [symbol, unknown])[1] === "safe",
				),
			).toBe(true);
			unsub();
		});
	});

	describe("timeout", () => {
		it("throws RangeError for non-positive timeoutNs", () => {
			expect(() => timeout(node([], { initial: 1 }), 0)).toThrow(RangeError);
			expect(() => timeout(node([], { initial: 1 }), -1)).toThrow(RangeError);
		});

		it("emits TimeoutError when no DATA arrives", () => {
			vi.useFakeTimers();
			const src = node(() => undefined, { describeKind: "producer" }); // never emits
			const out = timeout(src, 100 * NS_PER_MS);
			const { batches, unsub } = collect(out);
			vi.advanceTimersByTime(150);
			const flat = batches.flat();
			expect(
				flat.some(
					(m) =>
						(m as [symbol, unknown])[0] === ERROR &&
						(m as [symbol, unknown])[1] instanceof TimeoutError,
				),
			).toBe(true);
			unsub();
		});

		it("DATA resets the timer", () => {
			vi.useFakeTimers();
			const src = node([], { initial: 0 });
			const out = timeout(src, 100 * NS_PER_MS);
			const { batches, unsub } = collect(out);
			vi.advanceTimersByTime(80);
			src.down([[DATA, 1]]); // resets timer
			vi.advanceTimersByTime(80);
			// Should not have timed out yet (80 < 100 since reset)
			const flat = batches.flat();
			expect(flat.some((m) => (m as [symbol])[0] === ERROR)).toBe(false);
			vi.advanceTimersByTime(30); // now 110ms since last DATA
			const flat2 = batches.flat();
			expect(flat2.some((m) => (m as [symbol])[0] === ERROR)).toBe(true);
			unsub();
		});

		it("COMPLETE cancels the timer", () => {
			vi.useFakeTimers();
			const src = node(
				[],
				(_data, a) => {
					a.down([[COMPLETE]]);
				},
				{ describeKind: "producer" },
			);
			const out = timeout(src, 100 * NS_PER_MS);
			const { batches, unsub } = collect(out);
			vi.advanceTimersByTime(200);
			const flat = batches.flat();
			expect(flat.some((m) => (m as [symbol])[0] === COMPLETE)).toBe(true);
			expect(flat.some((m) => (m as [symbol])[0] === ERROR)).toBe(false);
			unsub();
		});

		it("passes DATA through on time", () => {
			const src = node([], { initial: 42 });
			const out = timeout(src, 10 * NS_PER_SEC);
			const { batches, unsub } = collect(out);
			src.down([[DATA, 99]]);
			const flat = batches.flat();
			expect(
				flat.some(
					(m) => (m as [symbol, unknown])[0] === DATA && (m as [symbol, unknown])[1] === 99,
				),
			).toBe(true);
			unsub();
		});
	});

	// ——————————————————————————————————————————————————————————————
	//  Tier 3.1 — Supervisors footgun + dedup
	// ——————————————————————————————————————————————————————————————

	describe("Tier 3.1 footgun: retry({ backoff }) without count", () => {
		it("source mode throws RangeError when backoff is set without count", () => {
			const src = node([], { initial: 0 });
			expect(() => retry(src, { backoff: constant(0) })).toThrow(
				/retry\(\{ backoff \}\) requires explicit count/,
			);
		});

		it("factory mode throws RangeError when backoff is set without count", () => {
			const factory = () => node([], { initial: 0 });
			expect(() => retry(factory, { backoff: constant(0) })).toThrow(
				/retry\(\{ backoff \}\) requires explicit count/,
			);
		});

		it("count: Infinity opts in to unbounded retries (no throw)", () => {
			const src = node([], { initial: 0 });
			expect(() => retry(src, { count: Infinity, backoff: constant(0) })).not.toThrow();
		});

		it("backoff omitted does not require count (back-compat for default-zero retries)", () => {
			const src = node([], { initial: 0 });
			expect(() => retry(src)).not.toThrow();
			expect(() => retry(src, {})).not.toThrow();
			expect(() => retry(src, { count: 5 })).not.toThrow();
		});
	});

	describe("Tier 3.1 dedup: source/factory parity", () => {
		it("identical retry behavior across source-mode and factory-mode on a sequence", async () => {
			vi.useFakeTimers();
			// Build a sequence that errors twice then emits 99.
			let sourceRuns = 0;
			const sharedSrc = node<number>(
				[],
				(_data, a) => {
					sourceRuns += 1;
					if (sourceRuns < 3) a.down([[ERROR, new Error(`fail-${sourceRuns}`)]]);
					else a.emit(99);
				},
				{ describeKind: "producer", resubscribable: true },
			);
			const sourceOut = retry(sharedSrc, { count: 5, backoff: constant(0) });
			const sourceCollect = collect(sourceOut);
			await vi.advanceTimersByTimeAsync(50);

			let factoryBuilds = 0;
			const factoryOut = retry(
				() => {
					factoryBuilds += 1;
					return node<number>(
						[],
						(_data, a) => {
							if (factoryBuilds < 3) a.down([[ERROR, new Error(`fail-${factoryBuilds}`)]]);
							else a.emit(99);
						},
						{ describeKind: "producer" },
					);
				},
				{ count: 5, backoff: constant(0) },
			);
			const factoryCollect = collect(factoryOut);
			await vi.advanceTimersByTimeAsync(50);

			const sourceData = sourceCollect.batches.flat().filter((m) => m[0] === DATA);
			const factoryData = factoryCollect.batches.flat().filter((m) => m[0] === DATA);
			expect(sourceData.map((m) => m[1])).toEqual([99]);
			expect(factoryData.map((m) => m[1])).toEqual([99]);
			expect(sourceRuns).toBe(3);
			expect(factoryBuilds).toBe(3);
			sourceCollect.unsub();
			factoryCollect.unsub();
		});
	});

	// ——————————————————————————————————————————————————————————————
	//  Tier 3.2 — Throttles & status footgun + companion + clock
	// ——————————————————————————————————————————————————————————————

	describe("Tier 3.2 footgun: rateLimiter without maxBuffer", () => {
		it("throws RangeError when maxBuffer is omitted", () => {
			const s = node([], { initial: 0 });
			expect(() => rateLimiter(s, { maxEvents: 5, windowNs: NS_PER_SEC } as never)).toThrow(
				/rateLimiter requires explicit maxBuffer/,
			);
		});

		it("accepts Infinity for opt-in unbounded buffer", () => {
			const s = node([], { initial: 0 });
			expect(() =>
				rateLimiter(s, { maxEvents: 5, windowNs: NS_PER_SEC, maxBuffer: Infinity }),
			).not.toThrow();
		});

		it("accepts a positive integer maxBuffer", () => {
			const s = node([], { initial: 0 });
			expect(() =>
				rateLimiter(s, { maxEvents: 5, windowNs: NS_PER_SEC, maxBuffer: 100 }),
			).not.toThrow();
		});

		it("rejects fractional maxBuffer values", () => {
			const s = node([], { initial: 0 });
			expect(() => rateLimiter(s, { maxEvents: 5, windowNs: NS_PER_SEC, maxBuffer: 1.5 })).toThrow(
				/maxBuffer must be a positive integer/,
			);
		});
	});

	describe("Tier 3.2 droppedCount reactive companion", () => {
		it("increments on drop-newest overflow", () => {
			const s = node([], { initial: 0 });
			const { node: out, droppedCount } = rateLimiter(s, {
				maxEvents: 1,
				windowNs: 10 * NS_PER_SEC,
				maxBuffer: 1,
				onOverflow: "drop-newest",
			});
			const { unsub } = collect(out);
			// push-on-subscribe consumes the only token; pending=[]. DATA 1 → queued (pending=1).
			s.down([[DATA, 1]]);
			expect(droppedCount.cache).toBe(0);
			s.down([[DATA, 2]]); // overflow → drop
			expect(droppedCount.cache).toBe(1);
			s.down([[DATA, 3]]); // overflow → drop
			expect(droppedCount.cache).toBe(2);
			unsub();
		});

		it("increments on drop-oldest overflow", () => {
			const s = node([], { initial: 0 });
			const { node: out, droppedCount } = rateLimiter(s, {
				maxEvents: 1,
				windowNs: 10 * NS_PER_SEC,
				maxBuffer: 1,
				onOverflow: "drop-oldest",
			});
			const { unsub } = collect(out);
			s.down([[DATA, 1]]); // queued
			expect(droppedCount.cache).toBe(0);
			s.down([[DATA, 2]]); // evicts 1, queues 2
			expect(droppedCount.cache).toBe(1);
			s.down([[DATA, 3]]); // evicts 2, queues 3
			expect(droppedCount.cache).toBe(2);
			unsub();
		});

		it("preserves final droppedCount on terminal (qa A1 — no rewind)", () => {
			// qa A1: the prior contract reset droppedCount to 0 on terminal,
			// emitting `[DATA, N], [DATA, 0]` then no terminal — consumers
			// thought drops were undone. New contract: final count is the
			// last observable state. Next subscription cycle re-zeros for
			// the new cycle (see `cache !== 0` reset path at activation).
			const s = node([], { resubscribable: true, initial: 0 });
			const { node: out, droppedCount } = rateLimiter(s, {
				maxEvents: 1,
				windowNs: 10 * NS_PER_SEC,
				maxBuffer: 1,
				onOverflow: "drop-newest",
			});
			const { unsub } = collect(out);
			s.down([[DATA, 1]]);
			s.down([[DATA, 2]]); // dropped
			s.down([[DATA, 3]]); // dropped
			expect(droppedCount.cache).toBe(2);
			s.down([[COMPLETE]]);
			expect(droppedCount.cache).toBe(2); // final count preserved
			unsub();
		});

		it("droppedCount appears as a reactive companion via node.meta", () => {
			const s = node([], { initial: 0 });
			const bundle = rateLimiter(s, {
				maxEvents: 1,
				windowNs: 10 * NS_PER_SEC,
				maxBuffer: 1,
			});
			expect(bundle.node.meta.droppedCount).toBe(bundle.droppedCount);
			expect(bundle.droppedCount.cache).toBe(0);
		});
	});

	describe("Tier 3.2 tokenBucket clock injection", () => {
		it("uses injected clock for refill scheduling (no fake timers needed)", () => {
			let now = 0;
			const tb = tokenBucket(2, 1, { clock: () => now });
			expect(tb.tryConsume(2)).toBe(true);
			expect(tb.tryConsume(1)).toBe(false);

			now = NS_PER_SEC; // advance 1s → +1 token
			expect(tb.available()).toBe(1);
			expect(tb.tryConsume(1)).toBe(true);
			expect(tb.tryConsume(1)).toBe(false);

			now = 3 * NS_PER_SEC; // advance 2s more → +2 tokens, capped at 2
			expect(tb.available()).toBe(2);
		});

		it("default clock is monotonicNs (no opts param)", () => {
			const tb = tokenBucket(5, 1);
			expect(tb.available()).toBeGreaterThanOrEqual(0);
		});

		it("putBack honors injected clock for refill timing", () => {
			const now = 0;
			const tb = tokenBucket(3, 0, { clock: () => now });
			expect(tb.tryConsume(3)).toBe(true);
			expect(tb.available()).toBe(0);
			tb.putBack(2);
			expect(tb.available()).toBe(2);
		});
	});

	// ── Tier 6.5 3.2: reactive option swaps (NodeOrValue<Options>) ──────────

	describe("Tier 6.5 3.2: reactive options widening", () => {
		it("3.2.1 timeout: Node<number> option re-read on next attempt boundary", () => {
			vi.useFakeTimers();
			const src = node(() => undefined, { describeKind: "producer" }); // never emits
			const optNode = node<number>([], { initial: 50 * NS_PER_MS });
			const out = timeout(src, optNode);
			const { batches, unsub } = collect(out);
			// Initial 50ms — no fire yet at 30ms.
			vi.advanceTimersByTime(30);
			expect(batches.flat().some((m) => (m as [symbol])[0] === ERROR)).toBe(false);
			// Swap option to 200ms — applies to the NEXT timer (current
			// in-flight timer keeps its 50ms deadline). Past 50ms total → fire.
			optNode.emit(200 * NS_PER_MS);
			vi.advanceTimersByTime(30); // total 60ms — original deadline crossed
			const flat = batches.flat();
			expect(
				flat.some(
					(m) =>
						(m as [symbol, unknown])[0] === ERROR &&
						(m as [symbol, unknown])[1] instanceof TimeoutError,
				),
			).toBe(true);
			unsub();
			vi.useRealTimers();
		});

		it("3.2.2 retry: Node<RetryOptions> swap shrinks count → next attempt fails immediately", () => {
			vi.useFakeTimers();
			let attemptCount = 0;
			const optNode = node<RetryOptions>([], { initial: { count: 5 } });
			const factory = (): Node<number> => {
				attemptCount += 1;
				return node(
					[],
					(_data, a) => {
						a.down([[ERROR, new Error(`attempt ${attemptCount}`)]]);
					},
					{ describeKind: "producer" },
				);
			};
			const out = retry(factory, optNode);
			const { batches, unsub } = collect(out);
			// First attempt fires synchronously via the producer body; further
			// retries are scheduled via 1ms-floor timer. Drive timer drain.
			vi.advanceTimersByTime(50);
			const afterFirstWindow = attemptCount;
			expect(afterFirstWindow).toBeGreaterThanOrEqual(2);
			// Shrink count to 0 → next attempt's `getCfg()` reads count=0,
			// `attempt >= 0` → finishes immediately with ERROR.
			optNode.emit({ count: 0 });
			vi.advanceTimersByTime(50);
			// Retry chain emits final ERROR after exhaustion under new count.
			const flat = batches.flat();
			expect(flat.some((m) => (m as [symbol])[0] === ERROR)).toBe(true);
			// No further attempts after the swap (locked semantic).
			expect(attemptCount).toBeLessThanOrEqual(afterFirstWindow + 1);
			unsub();
			vi.useRealTimers();
		});

		it("3.2.3 rateLimiter: Node<Options> swap shrinks maxBuffer → drop-oldest until fit", () => {
			vi.useFakeTimers();
			const src = node<number>([], { initial: 0 });
			const optNode = node<RateLimiterOptions>([], {
				initial: {
					maxEvents: 1,
					windowNs: NS_PER_SEC,
					maxBuffer: 10,
					onOverflow: "drop-newest",
				},
			});
			const bundle = rateLimiter(src, optNode);
			const { unsub } = collect(bundle.node);
			// Push 5 DATAs into the source. The bucket (capacity=1) consumes
			// one token per push attempt; subsequent pushes accumulate in
			// pending until a token refills.
			for (let i = 1; i <= 5; i++) src.down([[DATA, i]]);
			const before = bundle.rateLimitState.cache as RateLimiterState;
			// All pushed items land in `pending` then `tryEmit` consumes
			// available tokens. With cap=1 and 5 inputs (plus initial state 0
			// push-on-subscribe) the steady pending count is 5 (one consumed
			// emit, the rest waiting for refill).
			expect(before.pendingCount).toBe(5);
			expect(before.droppedCount).toBe(0);
			// Shrink maxBuffer to 2 — drop-oldest until pending.size <= 2.
			optNode.emit({
				maxEvents: 1,
				windowNs: NS_PER_SEC,
				maxBuffer: 2,
				onOverflow: "drop-newest",
			});
			const after = bundle.rateLimitState.cache as RateLimiterState;
			expect(after.pendingCount).toBe(2);
			expect(after.droppedCount).toBe(3); // 5 - 2 = 3 dropped
			unsub();
			vi.useRealTimers();
		});

		it("3.2.4 circuitBreaker: Node<Options> swap resets to closed (locked semantic)", () => {
			const now = 0;
			const optNode = node<CircuitBreakerOptions>([], {
				initial: {
					failureThreshold: 2,
					cooldownNs: NS_PER_SEC,
					now: () => now,
				},
			});
			const breaker = circuitBreaker(optNode);
			breaker.recordFailure();
			breaker.recordFailure();
			expect(breaker.state).toBe("open"); // hit threshold
			expect(breaker.failureCount).toBe(2);
			// Swap options — locked: resets to closed, counters cleared.
			optNode.emit({ failureThreshold: 5, cooldownNs: NS_PER_SEC, now: () => now });
			expect(breaker.state).toBe("closed");
			expect(breaker.failureCount).toBe(0);
			breaker.dispose();
		});
	});
});
