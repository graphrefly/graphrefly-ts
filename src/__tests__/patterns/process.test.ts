import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA } from "../../core/messages.js";
import { memoryAppendLog } from "../../extra/storage-tiers.js";
import type { CqrsEvent } from "../../patterns/cqrs/index.js";
import { cqrs } from "../../patterns/cqrs/index.js";
import {
	type ProcessInstance,
	processInstanceKeyOf,
	processManager,
} from "../../patterns/process/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all DATA values emitted by a node into an array. Returns unsub. */
function collectData<T>(node: {
	subscribe: (sink: (msgs: readonly [symbol, unknown?][]) => void) => () => void;
}): {
	values: T[];
	unsub: () => void;
} {
	const values: T[] = [];
	const unsub = node.subscribe((msgs) => {
		for (const m of msgs) {
			if (m[0] === DATA) values.push(m[1] as T);
		}
	});
	return { values, unsub };
}

/**
 * Wait for pending async steps to complete.
 * Uses a chain of Promise.resolve() ticks to drain the microtask queue,
 * followed by a setTimeout(0) to catch any subsequent microtask waves.
 */
async function flushPromises(): Promise<void> {
	// Multiple Promise.resolve() ticks to drain nested async chains.
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
	}
	// setTimeout(0) to yield to any freshly-scheduled microtasks.
	await new Promise<void>((r) => setTimeout(r, 0));
	// One more microtask drain after the setTimeout.
	for (let i = 0; i < 5; i++) {
		await Promise.resolve();
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("processManager", () => {
	// ── 1. Happy path ────────────────────────────────────────────────────────

	describe("happy path — start + continue", () => {
		it("start() registers instance with initial state; getState() reflects it", () => {
			const app = cqrs<{ orderPlaced: { orderId: string } }>("orders");
			const pm = processManager(app, "fulfillment", {
				initial: { step: "new", orderId: "" },
				watching: ["orderPlaced"],
				steps: {
					orderPlaced(state, event) {
						return {
							outcome: "success",
							state: { ...state, orderId: event.payload.orderId, step: "processing" },
						};
					},
				},
			});

			pm.start("corr-1");
			expect(pm.getState("corr-1")).toEqual({ step: "new", orderId: "" });
			app.destroy();
		});

		it("watched event fires → step runs → getState updates", async () => {
			const app = cqrs<{ orderPlaced: { orderId: string } }>("orders");
			app.command("placeOrder", (payload: { id: string; corrId: string }, { emit }) => {
				emit("orderPlaced", { orderId: payload.id });
			});

			const pm = processManager(app, "fulfillment", {
				initial: { step: "new", orderId: "" },
				watching: ["orderPlaced"],
				steps: {
					orderPlaced(state, event) {
						return {
							outcome: "success",
							state: { ...state, orderId: event.payload.orderId, step: "processing" },
						};
					},
				},
			});

			pm.start("corr-1");
			app.dispatch("placeOrder", { id: "order-42", corrId: "corr-1" }, { correlationId: "corr-1" });
			await flushPromises();

			const state = pm.getState("corr-1");
			expect(state?.orderId).toBe("order-42");
			expect(state?.step).toBe("processing");
			app.destroy();
		});

		it("instances audit log receives a record on start", async () => {
			const app = cqrs<{ orderPlaced: { orderId: string } }>("orders");
			const pm = processManager(app, "audit-test", {
				initial: { count: 0 },
				watching: ["orderPlaced"],
				steps: {},
			});

			pm.start("corr-audit");
			await flushPromises();

			const entries = pm.instances.entries.cache as readonly ProcessInstance<{ count: number }>[];
			expect(entries.length).toBeGreaterThanOrEqual(1);
			const first = entries[0]!;
			expect(first.correlationId).toBe("corr-audit");
			expect(first.status).toBe("running");
			app.destroy();
		});

		it("audit aliases instances", () => {
			const app = cqrs("orders");
			const pm = processManager(app, "alias-test", {
				initial: {},
				watching: [],
				steps: {},
			});
			expect(pm.audit).toBe(pm.instances);
			app.destroy();
		});

		it("processInstanceKeyOf returns correlationId", () => {
			const record: ProcessInstance<number> = {
				correlationId: "cid-1",
				state: 0,
				status: "running",
				startedAt: 0,
				updatedAt: 0,
				t_ns: 0,
			};
			expect(processInstanceKeyOf(record)).toBe("cid-1");
		});
	});

	// ── 2. Terminate ─────────────────────────────────────────────────────────

	describe("terminate — step returns terminate", () => {
		it("step returning terminate sets status to terminated and removes from getState", async () => {
			const app = cqrs<{ done: { result: string } }>("workflow");
			app.command("finish", (payload: { corrId: string; result: string }, { emit }) => {
				emit("done", { result: payload.result });
			});

			const pm = processManager(app, "term-test", {
				initial: { result: "" },
				watching: ["done"],
				steps: {
					done(_state, event) {
						return {
							outcome: "terminate",
							state: { result: event.payload.result },
							reason: "all done",
						};
					},
				},
			});

			pm.start("corr-term");
			app.dispatch(
				"finish",
				{ corrId: "corr-term", result: "success" },
				{ correlationId: "corr-term" },
			);
			await flushPromises();

			// After terminate, getState should return undefined (removed from active).
			expect(pm.getState("corr-term")).toBeUndefined();

			// Audit log should contain a terminated record.
			const entries = pm.instances.entries.cache as readonly ProcessInstance<{ result: string }>[];
			const terminated = entries.find((e) => e.status === "terminated");
			expect(terminated).toBeDefined();
			expect(terminated?.correlationId).toBe("corr-term");
			app.destroy();
		});

		it("subsequent events for a terminated correlationId are ignored", async () => {
			let stepCallCount = 0;
			const app = cqrs<{ ev: unknown }>("workflow");
			app.command("fireEv", (_payload: unknown, { emit }) => {
				emit("ev", {});
			});

			const pm = processManager(app, "term-ignore", {
				initial: { n: 0 },
				watching: ["ev"],
				steps: {
					ev(state) {
						stepCallCount++;
						if (stepCallCount === 1) {
							return { outcome: "terminate", state };
						}
						// Should never be called a second time.
						return { outcome: "success", state: { ...state, n: state.n + 1 } };
					},
				},
			});

			pm.start("corr-ignore");
			app.dispatch("fireEv", {}, { correlationId: "corr-ignore" });
			await flushPromises();

			// Fire a second event with the same correlationId — should be ignored.
			app.dispatch("fireEv", {}, { correlationId: "corr-ignore" });
			await flushPromises();

			expect(stepCallCount).toBe(1);
			app.destroy();
		});

		it("isTerminal predicate terminates after continue step", async () => {
			// In CQRS pattern, commands and events have distinct names.
			// Command "doTick" emits event "ticked"; processManager watches "ticked".
			const app = cqrs<{ ticked: unknown }>("workflow");
			app.command("doTick", (_payload: unknown, { emit }) => {
				emit("ticked", {});
			});

			const pm = processManager(app, "terminal-pred", {
				initial: { count: 0 },
				watching: ["ticked"],
				steps: {
					ticked(state) {
						return { outcome: "success", state: { count: state.count + 1 } };
					},
				},
				isTerminal: (state) => state.count >= 2,
			});

			pm.start("corr-pred");
			app.dispatch("doTick", {}, { correlationId: "corr-pred" });
			await flushPromises();
			// count=1, not terminal yet
			expect(pm.getState("corr-pred")).toEqual({ count: 1 });

			app.dispatch("doTick", {}, { correlationId: "corr-pred" });
			await flushPromises();
			// count=2, isTerminal → terminated
			expect(pm.getState("corr-pred")).toBeUndefined();

			const entries = pm.instances.entries.cache as readonly ProcessInstance<{ count: number }>[];
			const terminated = entries.find((e) => e.status === "terminated");
			expect(terminated).toBeDefined();
			app.destroy();
		});
	});

	// ── 3. Fail + compensate ──────────────────────────────────────────────────

	describe("fail + compensate", () => {
		it("step returning outcome:failure triggers compensate; status becomes compensated", async () => {
			let compensateCalled = false;
			const app = cqrs<{ ev: unknown }>("workflow");
			app.command("fireEv", (_payload: unknown, { emit }) => {
				emit("ev", {});
			});

			const pm = processManager(app, "fail-test", {
				initial: { value: 1 },
				watching: ["ev"],
				steps: {
					ev() {
						return { outcome: "failure", error: new Error("step failed") };
					},
				},
				compensate(state, _error) {
					compensateCalled = true;
					expect(state).toEqual({ value: 1 });
				},
			});

			pm.start("corr-fail");
			app.dispatch("fireEv", {}, { correlationId: "corr-fail" });
			await flushPromises();

			expect(compensateCalled).toBe(true);
			expect(pm.getState("corr-fail")).toBeUndefined();

			const entries = pm.instances.entries.cache as readonly ProcessInstance<unknown>[];
			const comp = entries.find((e) => e.status === "compensated");
			expect(comp?.correlationId).toBe("corr-fail");
			app.destroy();
		});

		it("step throwing triggers compensate; status becomes compensated", async () => {
			let compensateCalled = false;
			const app = cqrs<{ ev: unknown }>("workflow");
			app.command("fireEv", (_payload: unknown, { emit }) => {
				emit("ev", {});
			});

			const pm = processManager(app, "throw-test", {
				initial: {},
				watching: ["ev"],
				steps: {
					ev() {
						throw new Error("step threw");
					},
				},
				compensate(_state, _error) {
					compensateCalled = true;
				},
			});

			pm.start("corr-throw");
			app.dispatch("fireEv", {}, { correlationId: "corr-throw" });
			await flushPromises();

			expect(compensateCalled).toBe(true);
			expect(pm.getState("corr-throw")).toBeUndefined();
			app.destroy();
		});

		it("without compensate, fail sets status to failed", async () => {
			const app = cqrs<{ ev: unknown }>("workflow");
			app.command("fireEv", (_payload: unknown, { emit }) => {
				emit("ev", {});
			});

			const pm = processManager(app, "no-compensate", {
				initial: {},
				watching: ["ev"],
				steps: {
					ev() {
						return { outcome: "failure", error: new Error("boom") };
					},
				},
				// no compensate
			});

			pm.start("corr-nocomp");
			app.dispatch("fireEv", {}, { correlationId: "corr-nocomp" });
			await flushPromises();

			const entries = pm.instances.entries.cache as readonly ProcessInstance<unknown>[];
			const failed = entries.find((e) => e.status === "errored");
			expect(failed?.correlationId).toBe("corr-nocomp");
			app.destroy();
		});
	});

	// ── 4. Retry ─────────────────────────────────────────────────────────────

	describe("retry", () => {
		it("retries up to retryMax on throw; succeeds on attempt N+1", async () => {
			let attempts = 0;
			const app = cqrs<{ ev: unknown }>("workflow");
			app.command("fireEv", (_payload: unknown, { emit }) => {
				emit("ev", {});
			});

			const pm = processManager(app, "retry-test", {
				initial: { done: false },
				watching: ["ev"],
				steps: {
					ev(state) {
						attempts++;
						if (attempts < 3) throw new Error(`fail attempt ${attempts}`);
						return { outcome: "success", state: { ...state, done: true } };
					},
				},
				retryMax: 3,
				backoffMs: [0],
			});

			pm.start("corr-retry");
			app.dispatch("fireEv", {}, { correlationId: "corr-retry" });
			await flushPromises();
			// Attempt 1 fails, 2 fails, 3 succeeds.
			expect(attempts).toBe(3);
			expect(pm.getState("corr-retry")).toEqual({ done: true });
			app.destroy();
		});

		it("exhausts retryMax → fails and triggers compensate", async () => {
			let attempts = 0;
			let compensateCalled = false;
			const app = cqrs<{ ev: unknown }>("workflow");
			app.command("fireEv", (_payload: unknown, { emit }) => {
				emit("ev", {});
			});

			const pm = processManager(app, "exhaust-retry", {
				initial: {},
				watching: ["ev"],
				steps: {
					ev() {
						attempts++;
						throw new Error("always fails");
					},
				},
				retryMax: 2,
				backoffMs: [0],
				compensate(_state, _error) {
					compensateCalled = true;
				},
			});

			pm.start("corr-exhaust");
			app.dispatch("fireEv", {}, { correlationId: "corr-exhaust" });
			await flushPromises();

			// 1 initial + 2 retries = 3 total attempts
			expect(attempts).toBe(3);
			expect(compensateCalled).toBe(true);
			expect(pm.getState("corr-exhaust")).toBeUndefined();
			app.destroy();
		});
	});

	// ── 5. Cancel ────────────────────────────────────────────────────────────

	describe("cancel", () => {
		it("cancel() on running instance triggers compensate + marks compensated", async () => {
			let compensateCalled = false;
			const app = cqrs("workflow");

			const pm = processManager(app, "cancel-test", {
				initial: { value: 42 },
				watching: [],
				steps: {},
				compensate(_state, _error) {
					compensateCalled = true;
				},
			});

			pm.start("corr-cancel");
			expect(pm.getState("corr-cancel")).toEqual({ value: 42 });

			pm.cancel("corr-cancel", "user requested");
			await flushPromises();

			expect(compensateCalled).toBe(true);
			expect(pm.getState("corr-cancel")).toBeUndefined();

			const entries = pm.instances.entries.cache as readonly ProcessInstance<unknown>[];
			const comp = entries.find((e) => e.status === "compensated");
			expect(comp?.correlationId).toBe("corr-cancel");
			app.destroy();
		});

		it("cancel() on non-running instance is a no-op", async () => {
			let compensateCalled = false;
			const app = cqrs("workflow");

			const pm = processManager(app, "cancel-noop", {
				initial: {},
				watching: [],
				steps: {},
				compensate() {
					compensateCalled = true;
				},
			});

			// Never started — cancel is a no-op.
			pm.cancel("not-started");
			await flushPromises();
			expect(compensateCalled).toBe(false);
			app.destroy();
		});

		it("start() is idempotent — second call with same correlationId is no-op", () => {
			const app = cqrs("workflow");
			const pm = processManager(app, "idempotent", {
				initial: { n: 0 },
				watching: [],
				steps: {},
			});

			pm.start("corr-idem");
			pm.start("corr-idem"); // second call — no-op

			const entries = pm.instances.entries.cache as readonly ProcessInstance<{ n: number }>[];
			const running = entries.filter(
				(e) => e.correlationId === "corr-idem" && e.status === "running",
			);
			// Only one start record.
			expect(running.length).toBe(1);
			app.destroy();
		});
	});

	// ── 6. Multiple instances ─────────────────────────────────────────────────

	describe("multiple instances", () => {
		it("two correlationIds running concurrently receive their own steps independently", async () => {
			const results: Record<string, string> = {};
			const app = cqrs<{ ev: { value: string } }>("workflow");
			app.command("fireEv", (payload: { value: string }, { emit }) => {
				emit("ev", { value: payload.value });
			});

			const pm = processManager(app, "multi", {
				initial: { value: "" },
				watching: ["ev"],
				steps: {
					ev(state, event) {
						return { outcome: "success", state: { ...state, value: event.payload.value } };
					},
				},
			});

			pm.start("corr-A");
			pm.start("corr-B");

			// Dispatch with correlationId = corr-A
			app.dispatch("fireEv", { value: "hello-A" }, { correlationId: "corr-A" });
			// Dispatch with correlationId = corr-B
			app.dispatch("fireEv", { value: "hello-B" }, { correlationId: "corr-B" });

			await flushPromises();

			expect(pm.getState("corr-A")?.value).toBe("hello-A");
			expect(pm.getState("corr-B")?.value).toBe("hello-B");
			app.destroy();
		});

		it("event without correlationId is ignored by all instances", async () => {
			let stepCallCount = 0;
			const app = cqrs<{ ev: unknown }>("workflow");
			app.command("fireEv", (_payload: unknown, { emit }) => {
				emit("ev", {});
			});

			const pm = processManager(app, "no-corr", {
				initial: {},
				watching: ["ev"],
				steps: {
					ev(state) {
						stepCallCount++;
						return { outcome: "success", state };
					},
				},
			});

			pm.start("corr-X");
			// Dispatch WITHOUT correlationId — should be ignored.
			app.dispatch("fireEv", {});
			await flushPromises();

			expect(stepCallCount).toBe(0);
			app.destroy();
		});

		it("events for unknown correlationId are ignored", async () => {
			let stepCallCount = 0;
			const app = cqrs<{ ev: unknown }>("workflow");
			app.command("fireEv", (_payload: unknown, { emit }) => {
				emit("ev", {});
			});

			const pm = processManager(app, "unknown-corr", {
				initial: {},
				watching: ["ev"],
				steps: {
					ev(state) {
						stepCallCount++;
						return { outcome: "success", state };
					},
				},
			});

			pm.start("corr-Y");
			// Dispatch with a different correlationId that has no instance.
			app.dispatch("fireEv", {}, { correlationId: "corr-other" });
			await flushPromises();

			expect(stepCallCount).toBe(0);
			app.destroy();
		});
	});

	// ── 7. Schedule (timer) ───────────────────────────────────────────────────

	describe("schedule — step returns schedule", () => {
		it("schedule fires synthetic event after delay and routes to matching step", async () => {
			vi.useFakeTimers();
			const stepLog: string[] = [];
			const app = cqrs<{ start: unknown; timeout: unknown }>("workflow");
			app.command("fireStart", (_payload: unknown, { emit }) => {
				emit("start", {});
			});

			const pm = processManager(app, "sched-test", {
				initial: { phase: "init" },
				watching: ["start", "timeout"],
				steps: {
					start(state) {
						stepLog.push("start");
						return {
							outcome: "success",
							state: { ...state, phase: "waiting" },
							schedule: { afterMs: 100, eventType: "timeout" },
						};
					},
					timeout(state) {
						stepLog.push("timeout");
						return { outcome: "terminate", state: { ...state, phase: "timed-out" } };
					},
				},
			});

			pm.start("corr-sched");
			app.dispatch("fireStart", {}, { correlationId: "corr-sched" });

			// Flush microtasks so handleStepResult runs and sets up the fromTimer.
			for (let i = 0; i < 20; i++) await Promise.resolve();
			// Now advance fake timers past the scheduled delay.
			await vi.advanceTimersByTimeAsync(200);
			// Flush microtasks so the timeout step completes.
			for (let i = 0; i < 20; i++) await Promise.resolve();

			vi.useRealTimers();

			expect(stepLog).toContain("start");
			expect(stepLog).toContain("timeout");
			// After terminate, instance should be gone.
			expect(pm.getState("corr-sched")).toBeUndefined();
			app.destroy();
		});

		it("schedule does not fire if instance is cancelled before timer fires", async () => {
			vi.useFakeTimers();
			const stepLog: string[] = [];
			const app = cqrs<{ start: unknown; timeout: unknown }>("workflow");
			app.command("fireStart", (_payload: unknown, { emit }) => {
				emit("start", {});
			});

			const pm = processManager(app, "sched-cancel", {
				initial: { phase: "init" },
				watching: ["start", "timeout"],
				steps: {
					start(state) {
						stepLog.push("start");
						return {
							outcome: "success",
							state: { ...state, phase: "waiting" },
							schedule: { afterMs: 500, eventType: "timeout" },
						};
					},
					timeout(state) {
						stepLog.push("timeout");
						return { outcome: "terminate", state };
					},
				},
			});

			pm.start("corr-sched-cancel");
			app.dispatch("fireStart", {}, { correlationId: "corr-sched-cancel" });

			// Flush microtasks so start step completes and timer is registered.
			for (let i = 0; i < 20; i++) await Promise.resolve();
			expect(stepLog).toContain("start");

			// Cancel the instance BEFORE the 500ms timer fires.
			pm.cancel("corr-sched-cancel");
			// Flush microtasks for compensation.
			for (let i = 0; i < 20; i++) await Promise.resolve();

			// Now advance timers past the 500ms delay — timer fires, but the
			// guard in the timer callback checks activeInstances (instance gone)
			// so the timeout step is NOT called.
			await vi.advanceTimersByTimeAsync(600);
			for (let i = 0; i < 10; i++) await Promise.resolve();

			vi.useRealTimers();

			expect(stepLog).not.toContain("timeout");
			app.destroy();
		});
	});

	// ── 8. Async step ────────────────────────────────────────────────────────

	describe("async step (Promise)", () => {
		it("step returning a Promise resolves correctly", async () => {
			const app = cqrs<{ ev: { value: number } }>("workflow");
			app.command("fireEv", (payload: { value: number }, { emit }) => {
				emit("ev", { value: payload.value });
			});

			const pm = processManager(app, "async-test", {
				initial: { doubled: 0 },
				watching: ["ev"],
				steps: {
					async ev(state, event) {
						// Simulate async work.
						await Promise.resolve();
						return { outcome: "success", state: { ...state, doubled: event.payload.value * 2 } };
					},
				},
			});

			pm.start("corr-async");
			app.dispatch("fireEv", { value: 5 }, { correlationId: "corr-async" });
			await flushPromises();

			expect(pm.getState("corr-async")?.doubled).toBe(10);
			app.destroy();
		});
	});

	// ── 9. Side-effect emit ───────────────────────────────────────────────────

	describe("side-effect emit from step result", () => {
		it("step result emit adds events to CQRS graph", async () => {
			const app = cqrs<{ trigger: unknown; sideEffect: { from: string } }>("workflow");
			app.command("fireTrigger", (_payload: unknown, { emit }) => {
				emit("trigger", {});
			});
			// Register the side-effect event stream so dispatch can see it.
			const sideEffectEvents = app.event("sideEffect");

			const pm = processManager(app, "emit-test", {
				initial: {},
				watching: ["trigger"],
				steps: {
					trigger(state) {
						return {
							outcome: "success",
							state,
							emit: [{ type: "sideEffect", payload: { from: "step" } }],
						};
					},
				},
			});

			pm.start("corr-emit");
			app.dispatch("fireTrigger", {}, { correlationId: "corr-emit" });
			await flushPromises();

			// The side-effect event should have been appended.
			const events = sideEffectEvents.cache as readonly { payload: { from: string } }[];
			expect(events.length).toBeGreaterThanOrEqual(1);
			const found = events.find(
				(e) => (e as { payload: { from: string } }).payload.from === "step",
			);
			expect(found).toBeDefined();
			app.destroy();
		});
	});

	// ── 10. Concurrency / dispose ────────────────────────────────────────────

	describe("concurrency and dispose", () => {
		it("cancel() during async step doesn't double-compensate (C1)", async () => {
			let compensateCallCount = 0;
			let resolveStep!: () => void;
			const stepDone = new Promise<void>((r) => {
				resolveStep = r;
			});

			const app = cqrs<{ ev: unknown }>("workflow");
			app.command("fireEv", (_payload: unknown, { emit }) => {
				emit("ev", {});
			});

			const pm = processManager(app, "double-cancel", {
				initial: {},
				watching: ["ev"],
				steps: {
					ev(_state) {
						// Async step: pause until resolveStep is called.
						return new Promise<never>(() => {
							resolveStep();
							// Never resolves — simulates a long-running step.
						}) as Promise<{ outcome: "success"; state: {} }>;
					},
				},
				compensate(_state, _error) {
					compensateCallCount++;
				},
			});

			pm.start("corr-double");
			app.dispatch("fireEv", {}, { correlationId: "corr-double" });

			// Wait until the step has started (step body executed).
			await stepDone;

			// cancel() while the step is in-flight.
			pm.cancel("corr-double");
			await flushPromises();

			// compensate should have been called exactly once (from cancel).
			// The step itself never settles, so it doesn't trigger a second compensate.
			expect(compensateCallCount).toBe(1);
			app.destroy();
		});

		it("double-cancel is idempotent (C1)", async () => {
			let compensateCallCount = 0;
			const app = cqrs("workflow");

			const pm = processManager(app, "idempotent-cancel", {
				initial: { v: 0 },
				watching: [],
				steps: {},
				compensate(_state, _error) {
					compensateCallCount++;
				},
			});

			pm.start("corr-dc");
			// Two cancel calls in rapid succession — only one compensation should run.
			pm.cancel("corr-dc");
			pm.cancel("corr-dc"); // second call — no-op after eager delete
			await flushPromises();

			expect(compensateCallCount).toBe(1);
			app.destroy();
		});

		it("multiple events for same correlationId serialize (C2)", async () => {
			const stateLog: number[] = [];
			const app = cqrs<{ ev: unknown }>("workflow");
			app.command("fireEv", (_payload: unknown, { emit }) => {
				emit("ev", {});
			});

			const pm = processManager(app, "serialize", {
				initial: { count: 0 },
				watching: ["ev"],
				steps: {
					ev(state) {
						// Increment count; use async to make serialization observable.
						return Promise.resolve().then(() => {
							const next = { count: state.count + 1 };
							stateLog.push(next.count);
							return { outcome: "success" as const, state: next };
						});
					},
				},
			});

			pm.start("corr-ser");

			// Dispatch two commands — they emit two events in the same reactive wave.
			app.dispatch("fireEv", {}, { correlationId: "corr-ser" });
			app.dispatch("fireEv", {}, { correlationId: "corr-ser" });
			await flushPromises();

			// Both steps must have run and each must have seen the prior step's output.
			// stateLog should be [1, 2] not [1, 1] (C2: no state corruption).
			expect(stateLog).toEqual([1, 2]);
			expect(pm.getState("corr-ser")).toEqual({ count: 2 });
			app.destroy();
		});

		it("dispose() releases watch subscriptions and stops processing (C3)", async () => {
			let stepCallCount = 0;
			const app = cqrs<{ ev: unknown }>("workflow");
			app.command("fireEv", (_payload: unknown, { emit }) => {
				emit("ev", {});
			});

			const pm = processManager(app, "dispose-test", {
				initial: { n: 0 },
				watching: ["ev"],
				steps: {
					ev(state) {
						stepCallCount++;
						return { outcome: "success", state: { n: state.n + 1 } };
					},
				},
			});

			pm.start("corr-dispose");

			// Verify step runs before dispose.
			app.dispatch("fireEv", {}, { correlationId: "corr-dispose" });
			await flushPromises();
			expect(stepCallCount).toBe(1);

			// Dispose — releases watch subscriptions.
			pm.dispose();

			// Dispatch another event — should NOT reach the step (subscriptions gone).
			app.dispatch("fireEv", {}, { correlationId: "corr-dispose" });
			await flushPromises();

			expect(stepCallCount).toBe(1); // unchanged
			app.destroy();
		});
	});

	// ── 11. persistence — eventStorage wiring (Audit 3 + Audit 4) ──────────

	describe("persistence", () => {
		it("eventStorage tiers persist `_process_<name>_started` events for each start()", async () => {
			const app = cqrs("workflow");
			const tier = memoryAppendLog<CqrsEvent>({ name: "process-events" });

			const pm = processManager(app, "persisted", {
				initial: { step: 0 },
				watching: [],
				steps: {},
				persistence: { eventStorage: [tier] },
			});

			pm.start("corr-1");
			pm.start("corr-2");
			await flushPromises();
			await tier.flush?.();

			const result = await tier.loadEntries?.();
			const startedType = "_process_persisted_started";
			const started = (result?.entries ?? []).filter((e) => e.type === startedType);

			// Pins the auto-wired `cqrs.attachEventStorage(eventStorage)`
			// plumbing — every `start()` produces at least one persisted
			// started-event. The impl wires storage to BOTH the fan-in event
			// stream and the per-aggregate streams (per Audit 4), so the same
			// event may be persisted under multiple backend keys; what we
			// assert is the correlationId set is round-tripped end-to-end.
			expect(started.length).toBeGreaterThanOrEqual(2);
			const correlationIds = new Set(started.map((e) => e.aggregateId));
			expect(correlationIds).toEqual(new Set(["corr-1", "corr-2"]));

			app.destroy();
		});
	});

	// ── 12. handlerVersion stamping ───────────────────────────────────────────

	describe("handlerVersion", () => {
		it("handlerVersion is stamped onto audit records", async () => {
			const app = cqrs("workflow");

			const pm = processManager(app, "version-test", {
				initial: {},
				watching: [],
				steps: {},
				handlerVersion: { id: "fulfillment-handler", version: "1.2.3" },
			});

			pm.start("corr-v");
			await flushPromises();

			const entries = pm.instances.entries.cache as readonly ProcessInstance<unknown>[];
			const record = entries.find((e) => e.correlationId === "corr-v");
			expect(record?.handlerVersion).toEqual({ id: "fulfillment-handler", version: "1.2.3" });
			app.destroy();
		});
	});
});
