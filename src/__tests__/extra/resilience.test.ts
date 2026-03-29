import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPLETE, DATA, ERROR, RESOLVED } from "../../core/messages.js";
import { pipe, producer, state } from "../../core/sugar.js";
import {
	constant,
	exponential,
	fibonacci,
	linear,
	resolveBackoffPreset,
} from "../../extra/backoff.js";
import {
	CircuitBreaker,
	CircuitOpenError,
	rateLimiter,
	retry,
	tokenTracker,
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

	describe("backoff", () => {
		it("linear grows with attempt", () => {
			const s = linear(1, 0.5);
			expect(s(0)).toBe(1);
			expect(s(1)).toBe(1.5);
			expect(s(2)).toBe(2);
		});

		it("fibonacci scales base", () => {
			const s = fibonacci(1, 100);
			expect(s(0)).toBe(1);
			expect(s(1)).toBe(2);
			expect(s(2)).toBe(3);
		});

		it("resolveBackoffPreset returns strategies", () => {
			expect(typeof resolveBackoffPreset("constant")(0)).toBe("number");
			expect(typeof resolveBackoffPreset("exponential")(0)).toBe("number");
		});

		it("exponential caps maxDelaySeconds", () => {
			const s = exponential({ baseSeconds: 1, factor: 10, maxDelaySeconds: 5, jitter: "none" });
			expect(s(100)).toBe(5);
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

	describe("CircuitBreaker and withBreaker", () => {
		it("opens after threshold failures", () => {
			const b = new CircuitBreaker({ failureThreshold: 2, cooldownSeconds: 60 });
			expect(b.canExecute()).toBe(true);
			b.recordFailure();
			b.recordFailure();
			expect(b.state).toBe("open");
			expect(b.canExecute()).toBe(false);
		});

		it("withBreaker skip emits RESOLVED when open", () => {
			const b = new CircuitBreaker({ failureThreshold: 1, cooldownSeconds: 600 });
			b.recordFailure();
			const s = state(1);
			const { node: out } = withBreaker(b)(s);
			const { batches, unsub } = collect(out);
			s.down([[DATA, 2]]);
			expect(batches.flat().some((m) => m[0] === RESOLVED)).toBe(true);
			unsub();
		});

		it("withBreaker onOpen error", () => {
			const b = new CircuitBreaker({ failureThreshold: 1, cooldownSeconds: 600 });
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

	describe("tokenTracker / rateLimiter", () => {
		it("TokenBucket tryConsume respects capacity", () => {
			const tb = tokenTracker(2, 0);
			expect(tb.tryConsume(1)).toBe(true);
			expect(tb.tryConsume(1)).toBe(true);
			expect(tb.tryConsume(1)).toBe(false);
		});

		it("rateLimiter queues beyond window (fake timers + performance)", async () => {
			const now = { v: 1_000_000 };
			const spy = vi.spyOn(performance, "now").mockImplementation(() => now.v);
			vi.useFakeTimers();
			const s = state(0);
			const out = rateLimiter(1, 1)(s);
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
			const b = new CircuitBreaker({ failureThreshold: 2 });
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
			const b = new CircuitBreaker({ failureThreshold: 2 });
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
