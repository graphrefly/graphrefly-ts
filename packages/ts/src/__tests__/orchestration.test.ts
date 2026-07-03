import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import { compoundTupleKey } from "../identity.js";
import {
	backoffDelayMs,
	breakerBundle,
	type ProcessEffectCommandPayload,
	type ProcessEffectOutcome,
	processBundle,
	processEffectRunner,
	rateLimitBundle,
	retryPolicy,
	retryStatusBundle,
} from "../orchestration/index.js";

describe("graph-visible resilience bundles (D132)", () => {
	it("shares bounded retry/backoff policy semantics", () => {
		const policy = retryPolicy(3, {
			kind: "linear",
			initialMs: 10,
			stepMs: 5,
			maxMs: 18,
		});
		expect(backoffDelayMs(policy.backoff, 1)).toBe(10);
		expect(backoffDelayMs(policy.backoff, 3)).toBe(18);
	});

	it("projects retry and breaker status from graph-visible event facts", () => {
		const g = graph();
		const events = g.node<{
			kind: "attempt" | "failure" | "success";
			attempt?: number;
			error?: unknown;
		}>([], null, { name: "resilience/events" });
		const retry = retryStatusBundle(g, events, {
			name: "retry",
			policy: retryPolicy(2, { kind: "constant", delayMs: 25 }),
		});
		const breaker = breakerBundle(g, events, {
			name: "breaker",
			failureThreshold: 1,
			now: () => 100,
		});
		const retryStatuses: unknown[] = [];
		const breakerStatuses: unknown[] = [];
		retry.status.subscribe((msg) => retryStatuses.push(msg));
		breaker.status.subscribe((msg) => breakerStatuses.push(msg));

		events.down([["DATA", { kind: "attempt", attempt: 1 }]]);
		events.down([["DATA", { kind: "failure", attempt: 1, error: "nope" }]]);

		expect(retryStatuses.at(-1)).toEqual([
			"DATA",
			{ state: "failed", attempt: 1, maxAttempts: 2, delayMs: 25 },
		]);
		expect(breakerStatuses.at(-1)).toEqual([
			"DATA",
			{ state: "open", failures: 1, openedAtMs: 100 },
		]);
	});

	it("rate-limits DATA while exposing allowed/dropped/status nodes", () => {
		let now = 0;
		const g = graph();
		const source = g.node<number>([], null, { name: "source" });
		const bundle = rateLimitBundle(g, source, {
			name: "limit",
			max: 2,
			windowMs: 100,
			now: () => now,
		});
		const allowed: unknown[] = [];
		const dropped: unknown[] = [];
		const statuses: unknown[] = [];
		bundle.allowed.subscribe((msg) => allowed.push(msg));
		bundle.dropped.subscribe((msg) => dropped.push(msg));
		bundle.status.subscribe((msg) => statuses.push(msg));

		source.down([
			["DATA", 1],
			["DATA", 2],
			["DATA", 3],
		]);
		now = 101;
		source.down([["DATA", 4]]);

		expect(allowed.filter((msg) => Array.isArray(msg) && msg[0] === "DATA")).toEqual([
			["DATA", 1],
			["DATA", 2],
			["DATA", 4],
		]);
		expect(dropped).toContainEqual(["DATA", 3]);
		expect(statuses.at(-1)).toEqual([
			"DATA",
			{ allowed: 3, dropped: 1, remaining: 1, resetAtMs: 201 },
		]);
	});
});

describe("ProcessBundle — graph-visible facts-plus-reducer orchestration (D136)", () => {
	it("reduces commands into visible state, events, effects, status, audit, and cursor facts", () => {
		const g = graph();
		const process = processBundle<
			{ amount?: number },
			{ total: number },
			{ total: number },
			{ url: string }
		>(g, {
			name: "order",
			initialState: { total: 0 },
			now: () => 123,
			reduce(command, state) {
				const total = state.total + (command.payload.amount ?? 0);
				return {
					state: { total },
					events: [{ type: "amount-added", payload: { total } }],
					effects: [{ type: "notify", payload: { url: `/orders/${command.processId}` } }],
				};
			},
		});

		process.dispatch({
			id: "cmd-1",
			type: "add",
			processId: "p-1",
			payload: { amount: 7 },
		});

		expect(process.state.cache).toEqual({ total: 7 });
		expect(process.events.cache).toMatchObject({
			id: compoundTupleKey("process-event", ["cmd-1", "1"]),
			type: "amount-added",
			seq: 1,
			cursor: 1,
			commandId: "cmd-1",
			commandType: "add",
			payload: { total: 7 },
			timestampMs: 123,
		});
		expect(process.effectRequests.cache).toMatchObject({
			id: compoundTupleKey("process-effect", ["cmd-1", "1"]),
			type: "notify",
			seq: 1,
			cursor: 1,
			commandId: "cmd-1",
			commandType: "add",
			payload: { url: "/orders/p-1" },
			timestampMs: 123,
		});
		expect(process.status.cache).toEqual({
			state: "accepted",
			commandId: "cmd-1",
			commandType: "add",
			eventCount: 1,
			effectCount: 1,
			cursor: { eventSeq: 1, effectSeq: 1, commandCount: 1, errorCount: 0, auditSeq: 0 },
		});
		expect(process.audit.cache).toEqual({
			seq: 1,
			commandId: "cmd-1",
			commandType: "add",
			outcome: "success",
			eventIds: [compoundTupleKey("process-event", ["cmd-1", "1"])],
			eventTypes: ["amount-added"],
			effectIds: [compoundTupleKey("process-effect", ["cmd-1", "1"])],
			effectTypes: ["notify"],
			cursor: { eventSeq: 1, effectSeq: 1, commandCount: 1, errorCount: 0, auditSeq: 1 },
		});
		expect(process.cursor.cache).toEqual({
			eventSeq: 1,
			effectSeq: 1,
			commandCount: 1,
			errorCount: 0,
			auditSeq: 1,
		});
		expect(process.errors.cache).toBeUndefined();
	});

	it("keeps process.cursor as the final command-attempt high-water, not a read offset", () => {
		const g = graph();
		const process = processBundle<
			{ ok: boolean },
			{ count: number },
			{ ok: boolean },
			{ task: string }
		>(g, {
			name: "process",
			initialState: { count: 0 },
			reduce(command, state) {
				if (!command.payload.ok) throw new Error("nope");
				return {
					state: { count: state.count + 1 },
					events: [{ type: "accepted", payload: { ok: true } }],
					effects: [{ type: "notify", payload: { task: command.id } }],
				};
			},
		});

		process.dispatch({ id: "cmd-1", type: "run", payload: { ok: true } });
		expect(process.events.cache?.cursor).toBe(1);
		expect(process.effectRequests.cache?.cursor).toBe(1);
		expect(process.status.cache?.cursor).toEqual({
			eventSeq: 1,
			effectSeq: 1,
			commandCount: 1,
			errorCount: 0,
			auditSeq: 0,
		});
		expect(process.cursor.cache).toEqual({
			eventSeq: 1,
			effectSeq: 1,
			commandCount: 1,
			errorCount: 0,
			auditSeq: 1,
		});

		process.dispatch({ id: "cmd-2", type: "run", payload: { ok: false } });
		expect(process.errors.cache?.cursor).toEqual({
			eventSeq: 1,
			effectSeq: 1,
			commandCount: 2,
			errorCount: 1,
			auditSeq: 1,
		});
		expect(process.cursor.cache).toEqual({
			eventSeq: 1,
			effectSeq: 1,
			commandCount: 2,
			errorCount: 1,
			auditSeq: 2,
		});
	});

	it("keeps the ProcessBundle topology describe-visible with declared graph deps", () => {
		const g = graph();
		processBundle(g, {
			name: "process",
			initialState: { open: true },
			reduce: (_command, state) => ({ state }),
		});

		const snap = g.describe();
		const byId = Object.fromEntries(snap.nodes.map((node) => [node.id, node]));
		expect(byId["process/command"].factory).toBe("processCommand");
		expect(byId["process/runtime"].deps).toEqual(["process/command"]);
		expect(byId["process/state"].deps).toEqual(["process/runtime"]);
		expect(byId["process/effectRequests"].deps).toEqual(["process/runtime"]);
		expect(snap.edges).toContainEqual({ from: "process/command", to: "process/runtime" });
		expect(snap.edges).toContainEqual({ from: "process/runtime", to: "process/state" });
	});

	it("surfaces reducer failures as process error/status/audit DATA facts without mutating state", () => {
		const g = graph();
		const process = processBundle<{ ok: boolean }, { count: number }>(g, {
			name: "process",
			initialState: { count: 0 },
			reduce(command, state) {
				if (!command.payload.ok) throw new Error("process failed");
				return { state: { count: state.count + 1 } };
			},
		});

		process.dispatch({ id: "bad", type: "run", payload: { ok: false } });

		expect(process.state.cache).toBeUndefined();
		expect(process.errors.cache).toMatchObject({
			code: "reducer-threw",
			message: "process failed",
			commandId: "bad",
			commandType: "run",
			cursor: { eventSeq: 0, effectSeq: 0, commandCount: 1, errorCount: 1, auditSeq: 0 },
		});
		expect(process.status.cache).toEqual({
			state: "rejected",
			commandId: "bad",
			commandType: "run",
			eventCount: 0,
			effectCount: 0,
			errorCode: "reducer-threw",
			cursor: { eventSeq: 0, effectSeq: 0, commandCount: 1, errorCount: 1, auditSeq: 0 },
		});
		expect(process.audit.cache).toEqual({
			seq: 1,
			commandId: "bad",
			commandType: "run",
			outcome: "failure",
			eventIds: [],
			eventTypes: [],
			effectIds: [],
			effectTypes: [],
			errorCode: "reducer-threw",
			errorMessage: "process failed",
			cursor: { eventSeq: 0, effectSeq: 0, commandCount: 1, errorCount: 1, auditSeq: 1 },
		});
		expect(process.cursor.cache).toEqual({
			eventSeq: 0,
			effectSeq: 0,
			commandCount: 1,
			errorCount: 1,
			auditSeq: 1,
		});
	});

	it("fails honestly for malformed commands and undefined visible state", () => {
		const g = graph();
		expect(() =>
			processBundle(g, {
				name: "bad",
				initialState: undefined,
				reduce: (_command, state) => ({ state }),
			}),
		).toThrow(/initialState/);

		const process = processBundle<{ ok: boolean }, { count: number }>(g, {
			name: "process",
			initialState: { count: 0 },
			reduce: (command, state) => (command.payload.ok ? { state } : { state: undefined as never }),
		});
		process.command.down([["DATA", { type: "missing-id", payload: { ok: true } } as never]]);
		expect(process.errors.cache).toMatchObject({
			code: "malformed-command",
			message: "processBundle: command id must be a non-empty string",
		});

		process.dispatch({ id: "undef", type: "run", payload: { ok: false } });
		expect(process.errors.cache).toMatchObject({
			code: "malformed-state",
			message: "processBundle: reducer state must not be undefined",
			commandId: "undef",
		});
	});

	it("does not let failed reducer attempts mutate hidden process state", () => {
		const g = graph();
		const process = processBundle<{ ok: boolean }, { count: number }>(g, {
			name: "process",
			initialState: { count: 0 },
			reduce(command, state) {
				state.count += 100;
				if (!command.payload.ok) throw new Error("boom");
				return { state: { count: state.count + 1 } };
			},
		});

		process.dispatch({ id: "bad", type: "run", payload: { ok: false } });
		process.dispatch({ id: "good", type: "run", payload: { ok: true } });

		expect(process.state.cache).toEqual({ count: 101 });
		expect(process.status.cache).toMatchObject({ state: "accepted", commandId: "good" });
	});

	it("keeps public state cache mutations from aliasing the next reducer input", () => {
		const g = graph();
		const process = processBundle<{ amount: number }, { count: number }>(g, {
			name: "process",
			initialState: { count: 0 },
			reduce(command, state) {
				return { state: { count: state.count + command.payload.amount } };
			},
		});

		process.dispatch({ id: "cmd-1", type: "add", payload: { amount: 1 } });
		(process.state.cache as { count: number }).count = 1000;
		process.dispatch({ id: "cmd-2", type: "add", payload: { amount: 1 } });

		expect(process.state.cache).toEqual({ count: 2 });
	});

	it("accepts primitive string process state without confusing it for clone failure", () => {
		const g = graph();
		const process = processBundle<{ suffix: string }, string>(g, {
			name: "process",
			initialState: "start",
			reduce(command, state) {
				return { state: `${state}:${command.payload.suffix}` };
			},
		});

		process.dispatch({ id: "cmd-1", type: "append", payload: { suffix: "next" } });

		expect(process.state.cache).toBe("start:next");
		expect(process.errors.cache).toBeUndefined();
	});

	it("rejects duplicate event and effect ids across command reductions", () => {
		const g = graph();
		const process = processBundle<{ mode: "event" | "effect" }, { count: number }>(g, {
			name: "process",
			initialState: { count: 0 },
			reduce(command, state) {
				return command.payload.mode === "event"
					? {
							state: { count: state.count + 1 },
							events: [{ id: "same", type: "seen", payload: {} }],
						}
					: {
							state: { count: state.count + 1 },
							effects: [{ id: "same-effect", type: "call", payload: {} }],
						};
			},
		});

		process.dispatch({ id: "event-1", type: "run", payload: { mode: "event" } });
		process.dispatch({ id: "event-2", type: "run", payload: { mode: "event" } });
		expect(process.errors.cache).toMatchObject({
			code: "malformed-event",
			message: "processBundle: duplicate event 'same'",
			commandId: "event-2",
		});
		expect(process.state.cache).toEqual({ count: 1 });

		process.dispatch({ id: "effect-1", type: "run", payload: { mode: "effect" } });
		process.dispatch({ id: "effect-2", type: "run", payload: { mode: "effect" } });
		expect(process.errors.cache).toMatchObject({
			code: "malformed-effect",
			message: "processBundle: duplicate effect 'same-effect'",
			commandId: "effect-2",
		});
		expect(process.state.cache).toEqual({ count: 2 });
	});

	it("release drops graph-owned retain roots and helper topology without exposing runtime", () => {
		const g = graph();
		const process = processBundle(g, {
			name: "process",
			initialState: { count: 0 },
			reduce: (_command, state) => ({ state }),
		});
		expect(Object.hasOwn(process, "runtime")).toBe(false);

		process.release();
		process.release();
		expect(g.find("process/command")).toBeUndefined();
		expect(g.find("process/runtime")).toBeUndefined();
		expect(g.find("process/state")).toBeUndefined();
		expect(() => process.dispatch({ id: "late", type: "run", payload: {} })).toThrow(/released/);
	});

	it("keeps ProcessBundle release retryable when external subscribers block topology release", () => {
		const g = graph();
		const process = processBundle(g, {
			name: "process",
			initialState: { count: 0 },
			reduce: (_command, state) => ({ state }),
		});
		const unsub = process.state.subscribe(() => {});

		expect(() => process.release()).toThrow(/live subscribers/);
		expect(g.find("process/state")).toBe(process.state);

		unsub();
		process.release();
		expect(g.find("process/state")).toBeUndefined();
	});
});

describe("ProcessBundle effect runner — visible outcome-command adapter (D156)", () => {
	it("projects effect outcomes into visible ProcessCommand facts over declared graph deps", () => {
		type CommandPayload = { orderId: string } | ProcessEffectCommandPayload<{ delivered: boolean }>;
		const g = graph();
		const process = processBundle<
			CommandPayload,
			{ notified: boolean },
			{ kind: string },
			{ url: string }
		>(g, {
			name: "order",
			initialState: { notified: false },
			reduce(command, state) {
				if (command.type === "start") {
					return {
						state,
						effects: [
							{
								type: "notify",
								payload: { url: `/orders/${(command.payload as { orderId: string }).orderId}` },
								processId: command.processId,
								correlationId: command.correlationId,
							},
						],
					};
				}
				if (command.type === "effect.result") {
					return {
						state: {
							notified: (
								command.payload as ProcessEffectCommandPayload<{ delivered: boolean }> & {
									kind: "result";
								}
							).value.delivered,
						},
						events: [{ type: "notified", payload: { kind: "effect-result" } }],
					};
				}
				return { state };
			},
		});
		const outcomes = g.node<ProcessEffectOutcome<{ delivered: boolean }>>([], null, {
			name: "notify/outcomeFacts",
			factory: "testEffectOutcomes",
		});
		const runner = processEffectRunner(g, process, { name: "notify", outcomes: [outcomes] });

		process.dispatch({
			id: "cmd-1",
			type: "start",
			payload: { orderId: "o-1" },
			processId: "p-1",
			correlationId: "corr-1",
		});
		expect(runner.requests.cache).toMatchObject({
			id: compoundTupleKey("process-effect", ["cmd-1", "1"]),
			type: "notify",
			processId: "p-1",
			correlationId: "corr-1",
		});
		outcomes.down([
			[
				"DATA",
				{
					kind: "result",
					effectId: "cmd-1:effect:1",
					effectType: "notify",
					value: { delivered: true },
					processId: "p-1",
					correlationId: "corr-1",
				},
			],
		]);

		expect(runner.commands.cache).toEqual({
			id: compoundTupleKey("process-effect-command", ["cmd-1:effect:1", "effect.result"]),
			type: "effect.result",
			payload: {
				kind: "result",
				effectId: "cmd-1:effect:1",
				effectType: "notify",
				value: { delivered: true },
				processId: "p-1",
				correlationId: "corr-1",
				causationId: undefined,
				metadata: undefined,
			},
			processId: "p-1",
			correlationId: "corr-1",
			causationId: undefined,
			metadata: undefined,
		});
		expect(process.state.cache).toEqual({ notified: true });
		const snap = g.describe();
		expect(snap.edges).toContainEqual({ from: "order/effectRequests", to: "notify/requests" });
		expect(snap.edges).toContainEqual({ from: "notify/outcomeFacts", to: "notify/runtime" });
		expect(snap.edges).toContainEqual({ from: "notify/commands", to: "order/command" });
	});

	it("retries release without losing the process.command edge when the runner is not quiescent", () => {
		type CommandPayload = { run: boolean } | ProcessEffectCommandPayload<string>;
		const g = graph();
		const process = processBundle<CommandPayload, { done: number }, never, { task: string }>(g, {
			name: "process",
			initialState: { done: 0 },
			reduce(command, state) {
				if (command.type === "run") {
					return { state, effects: [{ type: "work", payload: { task: "one" } }] };
				}
				if (command.type === "effect.result") return { state: { done: state.done + 1 } };
				return { state };
			},
		});
		const outcomes = g.node<ProcessEffectOutcome<string>>([], null, { name: "work/outcomeFacts" });
		const runner = processEffectRunner(g, process, { name: "work", outcomes: [outcomes] });
		const unsub = runner.status.subscribe(() => {});

		expect(() => runner.release()).toThrow(/live subscribers/);
		outcomes.down([
			[
				"DATA",
				{
					kind: "result",
					effectId: "effect-1",
					effectType: "work",
					value: "ok",
				},
			],
		]);
		expect(process.state.cache).toEqual({ done: 1 });

		unsub();
		runner.release();
		runner.release();
		expect(g.find("work/commands")).toBeUndefined();
		expect(g.describe().edges).not.toContainEqual({ from: "work/commands", to: "process/command" });
	});
});
