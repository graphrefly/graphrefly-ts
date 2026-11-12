/**
 * R-checkpoint@1 (graphrefly:D802, graphrefly-ts:D178): a module builds its nodes with their
 * recipes, so a graph built with modules can be restored. Each bundle is driven to non-trivial
 * state, checkpointed, JSON round-tripped and restored; the restored graph then continues exactly
 * as the original does on the same input. User functions (handlers, reducers, clocks) are named by
 * ref and supplied by the restoring caller as registry definitions.
 */

import { describe, expect, it } from "vitest";
import {
	type CqrsCommand,
	type CqrsEvent,
	cqrs,
	cqrsCommandHandler,
	cqrsProjection,
	cqrsRestoreRegistry,
} from "../cqrs/index.js";
import {
	cqrsEventOutboxCommands,
	cqrsMessageAckCommands,
	cqrsMessagingRestoreRegistry,
} from "../cqrs/messaging.js";
import type { DataIssue } from "../data/index.js";
import type { GraphCheckpoint } from "../graph/checkpoint.js";
import { type Graph, graph } from "../graph/index.js";
import {
	defaultRestoreRegistry,
	type GraphRestoreEntry,
	type GraphRestoreRegistry,
	restoreGraph,
} from "../graph/restore.js";
import type { Node } from "../node/node.js";
import {
	breakerBundle,
	breakerRestoreRegistry,
	type ProcessCommand,
	type ProcessEffectOutcome,
	type ProcessReducer,
	processBundle,
	processEffectRunner,
	processRestoreRegistry,
	type ResilienceEvent,
} from "../orchestration/index.js";
import {
	localFixedWindowRateLimitBundle,
	localFixedWindowRateLimitRestoreRegistry,
} from "../rate-limit/index.js";
import { asState } from "./helpers/as-state.js";

/** A registry definition for a user function (a reducer may take two arguments). */
function definition(ref: string, fn: unknown): GraphRestoreEntry {
	return { kind: "definition", ref, fn: fn as (v: unknown) => unknown };
}

function roundTrip(g: Graph): GraphCheckpoint {
	return JSON.parse(JSON.stringify(g.checkpoint())) as GraphCheckpoint;
}

/** Subscribe to each node and collect the DATA after its subscribe snapshot. */
function collect(g: Graph, ids: readonly string[]): Record<string, unknown[]> {
	const out: Record<string, unknown[]> = {};
	for (const id of ids) {
		const node = g.find(id);
		if (node === undefined) throw new Error(`no node '${id}'`);
		const seen: unknown[] = [];
		out[id] = seen;
		node.subscribe((msgs) => {
			if (msgs[0]?.[0] === "START") return;
			for (const m of msgs) if (m[0] === "DATA") seen.push(m[1]);
		});
	}
	return out;
}

function set<T>(g: Graph, id: string, value: T): void {
	asState(g.find(id) as Node<T>).set(value);
}

/** Run the same continuation on the original and the restored graph; both must emit the same. */
function continueBoth(
	original: Graph,
	restored: Graph,
	ids: readonly string[],
	step: (g: Graph) => void,
): Record<string, unknown[]> {
	const a = collect(original, ids);
	const b = collect(restored, ids);
	step(original);
	step(restored);
	expect(b).toEqual(a);
	return b;
}

describe("bundle recipes restore through a checkpoint (R-checkpoint@1)", () => {
	it("localFixedWindowRateLimitBundle: the window count and reset continue", () => {
		const clock = { t: 0 };
		const build = (now?: () => number, nowRef?: string) => {
			const g = graph({ name: "window" });
			const hits = g.state<string>(undefined as never, { name: "hits" });
			const bundle = localFixedWindowRateLimitBundle(g, hits, {
				name: "rl",
				max: 2,
				windowMs: 1000,
				...(now === undefined ? {} : { now }),
				...(nowRef === undefined ? {} : { nowRef }),
			});
			return { g, bundle };
		};
		const { g } = build(() => clock.t, "test.clock");
		collect(g, ["rl/allowed", "rl/dropped", "rl/status"]);
		for (const id of ["a", "b", "c"]) set(g, "hits", id);
		expect(g.find("rl/status")?.cache).toEqual({
			allowed: 2,
			dropped: 1,
			remaining: 0,
			resetAtMs: 1000,
		});

		const checkpoint = roundTrip(g);
		expect(checkpoint.nodes.find((n) => n.id === "rl/events")?.recipe).toEqual({
			ref: "localFixedWindowRateLimit.events",
			config: { max: 2, windowMs: 1000, nowRef: "test.clock" },
		});
		const restored = restoreGraph(checkpoint, {
			registry: {
				...defaultRestoreRegistry,
				...localFixedWindowRateLimitRestoreRegistry,
				"test.clock": definition("test.clock", () => clock.t),
			},
		});
		const out = continueBoth(g, restored, ["rl/allowed", "rl/dropped", "rl/status"], (x) => {
			set(x, "hits", "d");
		});
		// The window is still full: the next hit is dropped, the counts continue.
		expect(out["rl/dropped"]).toEqual(["d"]);
		expect(out["rl/status"]).toEqual([{ allowed: 2, dropped: 2, remaining: 0, resetAtMs: 1000 }]);
		clock.t = 1000;
		const reset = continueBoth(g, restored, ["rl/allowed", "rl/status"], (x) => {
			set(x, "hits", "e");
		});
		expect(reset["rl/allowed"]).toEqual(["e"]);
		expect(reset["rl/status"]).toEqual([{ allowed: 3, dropped: 2, remaining: 1, resetAtMs: 2000 }]);

		// A custom clock with no ref cannot be named: the window is local-only.
		const local = build(() => clock.t);
		collect(local.g, ["rl/status"]);
		set(local.g, "hits", "a");
		const localCheckpoint = roundTrip(local.g);
		expect(localCheckpoint.nodes.find((n) => n.id === "rl/events")?.recipe).toBeUndefined();
		expect(() =>
			restoreGraph(localCheckpoint, {
				registry: { ...defaultRestoreRegistry, ...localFixedWindowRateLimitRestoreRegistry },
			}),
		).toThrow(/local-only/);
	});

	it("breakerBundle: an open breaker stays open, then half-opens on time", () => {
		const clock = { t: 10 };
		const g = graph({ name: "breaker" });
		const events = g.state<ResilienceEvent>(undefined as never, { name: "events" });
		breakerBundle(g, events, {
			name: "br",
			failureThreshold: 2,
			resetAfterMs: 1000,
			now: () => clock.t,
			nowRef: "test.clock",
		});
		collect(g, ["br/allowed"]);
		set(g, "events", { kind: "failure", attempt: 1, error: "boom" });
		set(g, "events", { kind: "failure", attempt: 2, error: "boom" });
		expect(g.find("br/status")?.cache).toEqual({ state: "open", failures: 2, openedAtMs: 10 });

		const checkpoint = roundTrip(g);
		expect(checkpoint.nodes.find((n) => n.id === "br/status")?.recipe).toEqual({
			ref: "breaker.status",
			config: { failureThreshold: 2, resetAfterMs: 1000, nowRef: "test.clock" },
		});
		const restored = restoreGraph(checkpoint, {
			registry: {
				...defaultRestoreRegistry,
				...breakerRestoreRegistry,
				"test.clock": definition("test.clock", () => clock.t),
			},
		});
		clock.t = 500;
		const open = continueBoth(g, restored, ["br/status", "br/allowed"], (x) => {
			set(x, "events", { kind: "attempt", attempt: 3 });
		});
		expect(open["br/allowed"]).toEqual([false]);
		expect(open["br/status"]).toEqual([{ state: "open", failures: 2, openedAtMs: 10 }]);
		clock.t = 1010;
		const halfOpen = continueBoth(g, restored, ["br/status", "br/allowed"], (x) => {
			set(x, "events", { kind: "attempt", attempt: 4 });
		});
		expect(halfOpen["br/allowed"]).toEqual([true]);
		expect(halfOpen["br/status"]).toEqual([{ state: "half-open", failures: 2, openedAtMs: 10 }]);
	});

	it("processBundle + processEffectRunner: sequences, dedupe and the runner's attachment continue", () => {
		const clock = { t: 100 };
		type Cmd = { readonly effect?: string };
		type State = { readonly runs: number; readonly results: number };
		const reduce: ProcessReducer<Cmd, State, never, { task: string }> = (command, state) =>
			command.type === "effect.result"
				? { state: { ...state, results: state.results + 1 } }
				: {
						state: { ...state, runs: state.runs + 1 },
						effects: [
							{ id: command.payload.effect ?? "none", type: "work", payload: { task: "t" } },
						],
					};
		const g = graph({ name: "proc" });
		const process = processBundle<Cmd, State, never, { task: string }>(g, {
			name: "p",
			initialState: { runs: 0, results: 0 },
			reduce,
			reduceRef: "test.reduce",
			now: () => clock.t,
			nowRef: "test.clock",
		});
		g.state<ProcessEffectOutcome<string>>(undefined as never, { name: "w/outcomeFacts" });
		processEffectRunner(g, process, {
			name: "w",
			outcomes: [g.find("w/outcomeFacts") as Node<ProcessEffectOutcome<string>>],
		});
		const dispatch = (x: Graph, command: ProcessCommand<Cmd>) => set(x, "p/dispatch", command);
		const outcome = (x: Graph, effectId: string) =>
			set<ProcessEffectOutcome<string>>(x, "w/outcomeFacts", {
				kind: "result",
				effectId,
				effectType: "work",
				value: "ok",
			});
		dispatch(g, { id: "c1", type: "run", payload: { effect: "e1" } });
		dispatch(g, { id: "c2", type: "run", payload: { effect: "e1" } }); // duplicate effect
		outcome(g, "e1"); // through the runner back into the process
		expect(process.state.cache).toEqual({ runs: 1, results: 1 });
		expect(process.cursor.cache).toEqual({
			eventSeq: 0,
			effectSeq: 1,
			commandCount: 3,
			errorCount: 1,
			auditSeq: 3,
		});

		const checkpoint = roundTrip(g);
		expect(checkpoint.nodes.find((n) => n.id === "p/runtime")?.recipe).toEqual({
			ref: "process.runtime",
			config: {
				initialState: { results: 0, runs: 0 },
				nowRef: "test.clock",
				reduceRef: "test.reduce",
			},
		});
		expect(checkpoint.nodes.find((n) => n.id === "w/commands")?.recipe).toEqual({
			ref: "processEffectRunner.projection",
			config: { kind: "command", processCommand: "p/command" },
		});
		const restored = restoreGraph(checkpoint, {
			registry: {
				...defaultRestoreRegistry,
				...processRestoreRegistry,
				"test.reduce": definition("test.reduce", reduce),
				"test.clock": definition("test.clock", () => clock.t),
			},
		});
		// Retains are not part of a checkpoint: the restorer keeps the same nodes as the bundles.
		const retained = [
			"p/runtime",
			"p/events",
			"p/state",
			"p/audit",
			"p/effectRequests",
			"p/status",
			"p/errors",
			"p/cursor",
			"w/requests",
			"w/outcomes",
			"w/commands",
			"w/status",
			"w/errors",
		];
		for (const id of retained) restored.retain(id);
		const watched = ["p/state", "p/errors", "p/effectRequests", "p/cursor", "w/status"];
		const out = continueBoth(g, restored, watched, (x) => {
			clock.t = 200;
			dispatch(x, { id: "c3", type: "run", payload: { effect: "e1" } }); // still a duplicate
			dispatch(x, { id: "c4", type: "run", payload: { effect: "e2" } });
			outcome(x, "e2");
		});
		expect(out["p/errors"]).toMatchObject([
			{
				code: "malformed-effect",
				message: "processBundle: duplicate effect 'e1'",
				commandId: "c3",
			},
		]);
		expect(out["p/effectRequests"]).toMatchObject([{ id: "e2", seq: 2, timestampMs: 200 }]);
		expect(out["p/state"]).toEqual([
			{ runs: 2, results: 1 },
			{ runs: 2, results: 2 },
		]);
		expect(restored.find("p/cursor")?.cache).toEqual({
			eventSeq: 0,
			effectSeq: 2,
			commandCount: 6,
			errorCount: 2,
			auditSeq: 6,
		});
		expect(restored.find("w/status")?.cache).toMatchObject({ requested: 2, commanded: 2 });
	});

	it("a restored process command input rewires to the restored runner in a later lifetime", () => {
		const g = graph({ name: "proc" });
		const process = processBundle<unknown, number>(g, {
			name: "p",
			initialState: 0,
			reduce: (_command, state) => ({ state: state + 1 }),
			reduceRef: "test.count",
		});
		const outcomes = g.state<ProcessEffectOutcome>(undefined as never, { name: "w/outcomeFacts" });
		processEffectRunner(g, process, { name: "w", outcomes: [outcomes] });
		const restored = restoreGraph(roundTrip(g), {
			registry: {
				...defaultRestoreRegistry,
				...processRestoreRegistry,
				"test.count": definition("test.count", (_c: unknown, s: number) => ({ state: s + 1 })),
			},
		});
		const expected = [restored.find("p/dispatch"), restored.find("w/commands")];
		// Identity, not structure: the command node's current dependencies are those two nodes.
		const deps = () => {
			const live = restored.find("p/command")?.deps ?? [];
			return live.length === expected.length && live.every((d, i) => d === expected[i]);
		};
		const first = restored.retain("p/state");
		expect(deps()).toBe(true);
		first();
		const second = restored.retain("p/state");
		expect(deps()).toBe(true);
		set<ProcessEffectOutcome>(restored, "w/outcomeFacts", {
			kind: "cancel",
			effectId: "e1",
			effectType: "work",
		});
		// The runner's command reached the reducer through the rewired input.
		expect(restored.find("p/state")?.cache).toBe(1);
		second();
	});

	it("cqrs + cqrsProjection: a replayed command id is still a duplicate, sequences and folds continue", () => {
		const clock = { t: 1 };
		type Deposit = { readonly amount: number };
		const deposit = (command: CqrsCommand<Deposit>) => [
			{ type: "deposited", payload: command.payload.amount, aggregateId: "acct-1" },
		];
		const fold = (balance: number, event: CqrsEvent<number>) => balance + event.payload;
		const g = graph({ name: "bank" });
		const bank = cqrs<Deposit, number>(g, {
			name: "bank",
			handlers: [cqrsCommandHandler("deposit", deposit, { ref: "bank.deposit" })],
			events: ["deposited"],
			now: () => clock.t,
			nowRef: "test.clock",
			dedupe: { commands: { maxEntries: 8 } },
		});
		cqrsProjection<number, number>(g, bank, {
			name: "balance",
			initial: 0,
			reducer: fold,
			reducerRef: "bank.balance",
		});
		const send = (x: Graph, id: string, amount: number) =>
			set<CqrsCommand<Deposit>>(x, "bank/command", { id, type: "deposit", payload: { amount } });
		send(g, "c1", 10);
		send(g, "c2", 5);
		send(g, "c1", 10); // duplicate
		expect(g.find("balance/value")?.cache).toBe(15);

		const checkpoint = roundTrip(g);
		expect(checkpoint.nodes.find((n) => n.id === "bank/runtime")?.recipe).toEqual({
			ref: "cqrs.runtime",
			config: {
				dedupe: { commands: 8 },
				events: ["deposited"],
				handlers: [{ ref: "bank.deposit", type: "deposit" }],
				nowRef: "test.clock",
			},
		});
		expect(checkpoint.nodes.find((n) => n.id === "balance")?.recipe).toEqual({
			ref: "cqrsProjection.frames",
			config: { initial: 0, reducerRef: "bank.balance" },
		});
		const registry: GraphRestoreRegistry = {
			...defaultRestoreRegistry,
			...cqrsRestoreRegistry,
			"bank.deposit": definition("bank.deposit", deposit),
			"bank.balance": definition("bank.balance", fold),
			"test.clock": definition("test.clock", () => clock.t),
		};
		const restored = restoreGraph(checkpoint, { registry });
		for (const id of [
			"bank/runtime",
			"bank/events",
			"bank/status",
			"bank/errors",
			"bank/audit",
			"bank/cursor",
			"balance",
			"balance/value",
			"balance/status",
			"balance/errors",
		])
			restored.retain(id);
		const out = continueBoth(
			g,
			restored,
			["bank/events", "bank/errors", "bank/cursor", "balance/value"],
			(x) => {
				clock.t = 2;
				send(x, "c2", 5); // still a duplicate
				send(x, "c3", 7);
			},
		);
		expect(out["bank/errors"]).toMatchObject([{ code: "duplicate-command", commandId: "c2" }]);
		expect(out["bank/events"]).toMatchObject([{ commandId: "c3", seq: 3, timestampMs: 2 }]);
		expect(out["balance/value"]).toEqual([22]);
		expect(out["bank/cursor"]?.at(-1)).toEqual({
			eventSeq: 3,
			commandCount: 5,
			errorCount: 2,
			auditSeq: 5,
			dedupe: {
				commandIdsRetained: 3,
				eventIdsRetained: 3,
				commandIdsEvicted: 0,
				eventIdsEvicted: 0,
			},
		});

		// A handler with no ref cannot be named: the runtime is local-only.
		const local = graph({ name: "local" });
		cqrs(local, { name: "bank", handlers: [cqrsCommandHandler("deposit", deposit)] });
		expect(roundTrip(local).nodes.find((n) => n.id === "bank/runtime")?.recipe).toBeUndefined();
	});

	it("cqrs messaging ack and outbox commands: a pending delivery is acked after restore", () => {
		const g = graph({ name: "messaging" });
		const commands = g.state<CqrsCommand>(undefined as never, { name: "commands" });
		const status = g.state<{ state: "accepted" | "rejected"; commandId?: string }>(
			undefined as never,
			{ name: "status" },
		);
		const issues = g.state<DataIssue>(undefined as never, { name: "issues" });
		const events = g.state<CqrsEvent>(undefined as never, { name: "events" });
		cqrsMessageAckCommands(g, {
			name: "acks",
			commands,
			status: status as never,
			issues,
			ackRejected: false,
		});
		cqrsEventOutboxCommands(g, events, "orders", { name: "outbox" });
		collect(g, ["acks", "outbox"]);
		const delivered = (id: string, seq: number): CqrsCommand => ({
			id,
			type: "place",
			payload: {},
			metadata: { messageBus: { topic: "in", seq, subscriptionId: "sub", commandId: id } },
		});
		set(g, "commands", delivered("c1", 1));
		set(g, "commands", delivered("c2", 2));
		set(g, "status", { state: "accepted", commandId: "c1" });
		expect(g.find("acks")?.cache).toMatchObject({ kind: "ack", seq: 1 });
		const event = (id: string): CqrsEvent => ({
			id,
			type: "placed",
			seq: 1,
			cursor: 1,
			runtimeCursor: { eventSeq: 1, commandCount: 1, errorCount: 0, auditSeq: 1 },
			commandId: "c1",
			commandType: "place",
			payload: {},
			timestampMs: 1,
		});
		set(g, "events", event("ev1")); // no aggregate: no key

		const checkpoint = roundTrip(g);
		expect(checkpoint.nodes.find((n) => n.id === "acks")?.recipe).toEqual({
			ref: "cqrsMessaging.ackCommands",
			config: { ackRejected: false, issues: true },
		});
		expect(checkpoint.nodes.find((n) => n.id === "acks")?.lifetime?.state).toEqual([
			["c2", [{ topic: "in", seq: 2, subscriptionId: "sub", commandId: "c2" }]],
		]);
		const restored = restoreGraph(checkpoint, {
			registry: { ...defaultRestoreRegistry, ...cqrsMessagingRestoreRegistry },
		});
		const out = continueBoth(g, restored, ["acks", "outbox"], (x) => {
			set(x, "status", { state: "rejected", commandId: "c2" }); // not acked: ackRejected false
			set(x, "status", { state: "accepted", commandId: "c2" });
			set(x, "events", event("ev2"));
		});
		expect(out.acks).toMatchObject([{ kind: "ack", topic: "in", subscriptionId: "sub", seq: 2 }]);
		expect(out.outbox).toEqual([
			{
				kind: "publish",
				topic: "orders",
				payload: event("ev2"),
				commandId: expect.any(String),
				idempotencyKey: "ev2",
			},
		]);
	});
});
