import { GuardDenied } from "@graphrefly/pure-ts/core/guard.js";
import { memoryAppendLog, mergeReactiveLogs } from "@graphrefly/pure-ts/extra";
import { describe, expect, it } from "vitest";
import { OptimisticConcurrencyError, UndeclaredEmitError } from "../../../utils/_errors/index.js";
import { type CqrsEvent, CqrsGraph, cqrs } from "../../../utils/cqrs/index.js";

describe("cqrs — roadmap §4.5", () => {
	// -- Factory --------------------------------------------------------------

	it("cqrs() returns a CqrsGraph", () => {
		const app = cqrs("test");
		expect(app).toBeInstanceOf(CqrsGraph);
		app.destroy();
	});

	// -- Events ---------------------------------------------------------------

	it("event() registers an observable event stream", () => {
		const app = cqrs("test");
		const evtNode = app.event("orderPlaced");
		expect(evtNode).toBeDefined();
		const entries = evtNode.cache as readonly unknown[];
		expect(entries).toEqual([]);
		app.destroy();
	});

	it("event() is idempotent — returns same node on second call", () => {
		const app = cqrs("test");
		const a = app.event("orderPlaced");
		const b = app.event("orderPlaced");
		expect(a).toBe(b);
		app.destroy();
	});

	it("event node guard denies external write", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		const evtNode = app.resolve("orderPlaced");
		expect(() => {
			evtNode.down([["DATA", "bad"]], { actor: { type: "human", id: "h1" } });
		}).toThrow(GuardDenied);
		app.destroy();
	});

	// -- Commands -------------------------------------------------------------

	it("command() registers a write-only command node", () => {
		const app = cqrs("test");
		app.command("placeOrder", (_payload, { emit }) => {
			emit("orderPlaced", { id: "1" });
		});
		const desc = app.describe({ detail: "standard" });
		expect(desc.nodes.placeOrder).toBeDefined();
		expect(desc.nodes.placeOrder.meta?.cqrs_type).toBe("command");
		app.destroy();
	});

	it("command node guard denies observe", () => {
		const app = cqrs("test");
		app.command("placeOrder", () => {});
		const cmdNode = app.resolve("placeOrder");
		expect(() => {
			cmdNode.subscribe(() => {}, { actor: { type: "human", id: "h1" } });
		}).toThrow(GuardDenied);
		app.destroy();
	});

	// -- Dispatch -------------------------------------------------------------

	it("dispatch() runs handler and appends events", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.command("placeOrder", (payload: any, { emit }) => {
			emit("orderPlaced", { orderId: payload.id });
		});
		app.dispatch("placeOrder", { id: "order-1" });

		const entries = app.event("orderPlaced").cache as readonly CqrsEvent[];
		expect(entries).toHaveLength(1);
		expect(entries[0].type).toBe("orderPlaced");
		expect(entries[0].payload).toEqual({ orderId: "order-1" });
		app.destroy();
	});

	it("dispatch() auto-registers events not explicitly declared", () => {
		const app = cqrs("test");
		app.command("placeOrder", (_payload: any, { emit }) => {
			emit("orderPlaced", { id: "1" });
		});
		app.dispatch("placeOrder", {});
		const desc = app.describe({ detail: "standard" });
		expect(desc.nodes.orderPlaced).toBeDefined();
		expect(desc.nodes.orderPlaced.meta?.cqrs_type).toBe("event");
		app.destroy();
	});

	it("dispatch() throws for unknown command", () => {
		const app = cqrs("test");
		expect(() => app.dispatch("nonexistent", {})).toThrow(/Unknown command/);
		app.destroy();
	});

	it("dispatch() sets command node value", () => {
		const app = cqrs("test");
		app.command("placeOrder", () => {});
		app.dispatch("placeOrder", { id: "42" });
		expect(app.node("placeOrder").cache).toEqual({ id: "42" });
		app.destroy();
	});

	it("events carry timestampNs and seq fields", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.command("placeOrder", (payload: any, { emit }) => {
			emit("orderPlaced", payload);
		});
		app.dispatch("placeOrder", { id: "1" });
		const entries = app.event("orderPlaced").cache as readonly CqrsEvent[];
		const evt = entries[0];
		expect(evt.timestampNs).toBeGreaterThan(0);
		expect(evt.seq).toBe(1);
		app.destroy();
	});

	it("events carry v0 identity when event log node is versioned", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.command("placeOrder", (payload: any, { emit }) => {
			emit("orderPlaced", payload);
		});
		app.dispatch("placeOrder", { id: "1" });
		const entries = app.event("orderPlaced").cache as readonly CqrsEvent[];
		expect(entries[0].v0).toBeDefined();
		expect(entries[0].v0!.id).toBeTypeOf("string");
		app.destroy();
	});

	it("seq increments monotonically across dispatches", () => {
		const app = cqrs("test");
		app.event("a");
		app.event("b");
		app.command("cmd", (_p: any, { emit }) => {
			emit("a", 1);
			emit("b", 2);
		});
		app.dispatch("cmd", {});
		const entriesA = app.event("a").cache as readonly CqrsEvent[];
		const entriesB = app.event("b").cache as readonly CqrsEvent[];
		expect(entriesA[0].seq).toBe(1);
		expect(entriesB[0].seq).toBe(2);
		app.destroy();
	});

	// -- Dispatch failure audit (post-rollback) --------------------------------

	it("dispatch() records failure audit record with errorType after throwing handler", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.command("bad", (_p: any, { emit }) => {
			emit("orderPlaced", { id: "1" });
			throw new TypeError("handler boom");
		});
		expect(() => app.dispatch("bad", {})).toThrow("handler boom");

		const dispatches = app.dispatches.entries
			.cache as readonly import("../../../utils/cqrs/index.js").DispatchRecord[];
		expect(dispatches).toHaveLength(1);
		const record = dispatches[0];
		expect(record.outcome).toBe("failure");
		expect(record.error).toBeDefined();
		expect(record.errorType).toBe("TypeError");
		app.destroy();
	});

	it("dispatch() audit records emittedEvents list on failure as attempted list", () => {
		const app = cqrs("test");
		app.event("a");
		app.event("b");
		app.command("multi", (_p: any, { emit }) => {
			emit("a", 1);
			emit("b", 2);
			throw new Error("mid-flight throw");
		});
		expect(() => app.dispatch("multi", {})).toThrow("mid-flight throw");

		const dispatches = app.dispatches.entries
			.cache as readonly import("../../../utils/cqrs/index.js").DispatchRecord[];
		expect(dispatches[0].outcome).toBe("failure");
		expect(dispatches[0].emittedEvents).toEqual(["a", "b"]);
		app.destroy();
	});

	it("dispatch() audit records success on successful dispatch", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.command("place", (_p: any, { emit }) => {
			emit("orderPlaced", { id: "1" });
		});
		app.dispatch("place", { id: "x" });

		const dispatches = app.dispatches.entries
			.cache as readonly import("../../../utils/cqrs/index.js").DispatchRecord[];
		expect(dispatches).toHaveLength(1);
		expect(dispatches[0].outcome).toBe("success");
		expect(dispatches[0].emittedEvents).toEqual(["orderPlaced"]);
		expect(dispatches[0].errorType).toBeUndefined();
		app.destroy();
	});

	it("dispatch() cmdNode.meta.error is set after rollback", () => {
		const app = cqrs("test");
		const err = new RangeError("bad range");
		app.command("bad", () => {
			throw err;
		});
		expect(() => app.dispatch("bad", {})).toThrow("bad range");
		const cmdNode = app.resolve("bad");
		expect(cmdNode.meta.error.cache).toBe(err);
		app.destroy();
	});

	// -- Command handler error ------------------------------------------------

	it("dispatch() sets meta.error on handler throw and re-throws", () => {
		const app = cqrs("test");
		const err = new Error("boom");
		app.command("bad", () => {
			throw err;
		});
		expect(() => app.dispatch("bad", {})).toThrow("boom");
		const cmdNode = app.resolve("bad");
		expect(cmdNode.meta.error.cache).toBe(err);
		app.destroy();
	});

	it("dispatch() clears meta.error on success after prior error", () => {
		const app = cqrs("test");
		let shouldThrow = true;
		app.command("maybe", (_p, { emit }) => {
			if (shouldThrow) throw new Error("fail");
			emit("ok", {});
		});
		expect(() => app.dispatch("maybe", {})).toThrow("fail");
		const cmdNode = app.resolve("maybe");
		expect(cmdNode.meta.error.cache).toBeInstanceOf(Error);
		shouldThrow = false;
		app.dispatch("maybe", {});
		expect(cmdNode.meta.error.cache).toBeNull();
		app.destroy();
	});

	// -- Projections ----------------------------------------------------------

	it("projection() derives read model from events", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.projection<number>({
			name: "orderCount",
			events: ["orderPlaced"],
			reducer: (_state, events) => events.length,
			initial: 0,
			mode: "replay",
		});
		app.command("placeOrder", (payload: any, { emit }) => {
			emit("orderPlaced", payload);
		});

		expect(app.node("orderCount").cache).toBe(0);
		app.dispatch("placeOrder", { id: "1" });
		expect(app.node("orderCount").cache).toBe(1);
		app.dispatch("placeOrder", { id: "2" });
		expect(app.node("orderCount").cache).toBe(2);
		app.destroy();
	});

	it("projection from multiple event streams", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.event("orderCancelled");

		type Summary = { placed: number; cancelled: number };
		app.projection<Summary>({
			name: "summary",
			events: ["orderPlaced", "orderCancelled"],
			reducer: (_state, events) => ({
				placed: events.filter((e) => e.type === "orderPlaced").length,
				cancelled: events.filter((e) => e.type === "orderCancelled").length,
			}),
			initial: { placed: 0, cancelled: 0 },
			mode: "replay",
		});

		app.command("placeOrder", (_p: any, { emit }) => emit("orderPlaced", {}));
		app.command("cancelOrder", (_p: any, { emit }) => emit("orderCancelled", {}));

		app.dispatch("placeOrder", {});
		app.dispatch("placeOrder", {});
		app.dispatch("cancelOrder", {});

		const summary = app.node("summary").cache as Summary;
		expect(summary.placed).toBe(2);
		expect(summary.cancelled).toBe(1);
		app.destroy();
	});

	it("projection node guard denies write", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.projection({
			name: "orderCount",
			events: ["orderPlaced"],
			reducer: (_s, e) => e.length,
			initial: 0,
		});
		const projNode = app.resolve("orderCount");
		expect(() => {
			projNode.down([["DATA", 999]], { actor: { type: "human", id: "h1" } });
		}).toThrow(GuardDenied);
		app.destroy();
	});

	// -- Sagas ----------------------------------------------------------------

	it("saga() runs handler on new events", () => {
		const app = cqrs("test");
		app.event("orderPlaced");

		const sagaLog: CqrsEvent[] = [];
		app.saga("notifyShipping", ["orderPlaced"], (evt) => {
			sagaLog.push(evt);
		});

		app.command("placeOrder", (payload: any, { emit }) => {
			emit("orderPlaced", payload);
		});

		app.dispatch("placeOrder", { id: "1" });
		expect(sagaLog.length).toBeGreaterThanOrEqual(1);
		expect(sagaLog[0].type).toBe("orderPlaced");
		app.destroy();
	});

	it("saga() sets meta.error on handler throw and clears on later success", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		let shouldThrow = true;
		app.saga("sideFx", ["orderPlaced"], () => {
			if (shouldThrow) throw new Error("saga boom");
		});
		app.command("placeOrder", (payload: any, { emit }) => {
			emit("orderPlaced", payload);
		});
		app.dispatch("placeOrder", { id: "1" });
		const sagaNode = app.resolve("sideFx");
		expect(sagaNode.meta.error.cache).toBeInstanceOf(Error);
		shouldThrow = false;
		app.dispatch("placeOrder", { id: "2" });
		expect(sagaNode.meta.error.cache).toBeNull();
		app.destroy();
	});

	it("saga only processes new events, not historical replay", () => {
		const app = cqrs("test");
		app.event("orderPlaced");

		const sagaLog: CqrsEvent[] = [];
		app.saga("notifyShipping", ["orderPlaced"], (evt) => {
			sagaLog.push(evt);
		});

		app.command("placeOrder", (payload: any, { emit }) => {
			emit("orderPlaced", payload);
		});

		app.dispatch("placeOrder", { id: "1" });
		const countAfterFirst = sagaLog.length;

		app.dispatch("placeOrder", { id: "2" });
		// Should only have processed the NEW event, not replayed event "1"
		const newEvents = sagaLog.slice(countAfterFirst);
		expect(newEvents).toHaveLength(1);
		expect(newEvents[0].payload).toEqual({ id: "2" });
		app.destroy();
	});

	// -- describe() -----------------------------------------------------------

	it("describe() distinguishes command / event / projection / saga roles", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.command("placeOrder", () => {});
		app.projection({
			name: "orderCount",
			events: ["orderPlaced"],
			reducer: (_s, e) => e.length,
			initial: 0,
		});
		app.saga("notifyShipping", ["orderPlaced"], () => {});

		const desc = app.describe({ detail: "standard" });
		expect(desc.nodes.placeOrder.meta?.cqrs_type).toBe("command");
		expect(desc.nodes.orderPlaced.meta?.cqrs_type).toBe("event");
		expect(desc.nodes.orderCount.meta?.cqrs_type).toBe("projection");
		expect(desc.nodes.notifyShipping.meta?.cqrs_type).toBe("saga");
		app.destroy();
	});

	it("describe() shows edges from events to projections and sagas", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.projection({
			name: "orderCount",
			events: ["orderPlaced"],
			reducer: (_s, e) => e.length,
			initial: 0,
		});
		app.saga("notifyShipping", ["orderPlaced"], () => {});

		const desc = app.describe();
		const edgePairs = desc.edges.map((e: any) => `${e.from}->${e.to}`);
		expect(edgePairs).toContain("orderPlaced->orderCount");
		expect(edgePairs).toContain("orderPlaced->notifyShipping");
		app.destroy();
	});

	// -- UndeclaredEmitError --------------------------------------------------

	it("dispatch() throws UndeclaredEmitError when emitting undeclared event (inside batch → re-thrown)", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.command("place", {
			handler: (_p: any, { emit }) => emit("orderShipped", {}),
			emits: ["orderPlaced"],
		});
		expect(() => app.dispatch("place", {})).toThrow(UndeclaredEmitError);
		app.destroy();
	});

	it("dispatch() allows any event name when emits is omitted (open mode)", () => {
		const app = cqrs("test");
		app.command("place", (_p: any, { emit }) => emit("anything", {}));
		expect(() => app.dispatch("place", {})).not.toThrow();
		app.destroy();
	});

	it("dispatch() succeeds when emitting a declared event name", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.command("place", {
			handler: (_p: any, { emit }) => emit("orderPlaced", { id: "1" }),
			emits: ["orderPlaced"],
		});
		expect(() => app.dispatch("place", {})).not.toThrow();
		app.destroy();
	});

	// -- attachEventStorage + projection.rebuild() ----------------------------

	it("attachEventStorage persists events on dispatch", async () => {
		const tier = memoryAppendLog<CqrsEvent>();
		const app = cqrs("test");
		app.attachEventStorage([tier]);
		app.event("orderPlaced");
		app.command("placeOrder", (payload: any, { emit }) => {
			emit("orderPlaced", payload);
		});

		app.dispatch("placeOrder", { id: "1" });
		app.dispatch("placeOrder", { id: "2" });

		// Drain all microtask + promise-chain flushes. appendLogStorage flushes
		// are chained via Promise microtasks. A macrotask break ensures all
		// pending promise chains complete before we read.
		await new Promise((r) => setTimeout(r, 0));

		// Read back via loadEntries.
		if (tier.loadEntries) {
			const result = await tier.loadEntries();
			expect(result.entries).toHaveLength(2);
			expect((result.entries[0] as CqrsEvent).payload).toEqual({ id: "1" });
		}
		app.destroy();
	});

	it("projection.rebuild() replays from attached storage tier", async () => {
		const tier = memoryAppendLog<CqrsEvent>();
		const app = cqrs("test");
		app.attachEventStorage([tier]);
		app.event("orderPlaced");
		app.command("placeOrder", (payload: any, { emit }) => {
			emit("orderPlaced", payload);
		});

		app.dispatch("placeOrder", { id: "1" });
		app.dispatch("placeOrder", { id: "2" });

		// Drain async flush microtask chains (appendLogStorage batches via Promise.resolve chains).
		await new Promise((r) => setTimeout(r, 0));

		const { rebuild } = app.projection<number>({
			name: "orderCount",
			events: ["orderPlaced"],
			// Reducer for rebuild: receives all persisted events in each page.
			reducer: (acc, events) => acc + events.length,
			initial: 0,
		});

		const rebuilt = await rebuild({ fromTier: tier });
		expect(rebuilt).toBe(2);
		app.destroy();
	});

	it("projection.reset() re-folds in-memory events on top of initial state", async () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.command("placeOrder", (payload: any, { emit }) => {
			emit("orderPlaced", payload);
		});
		app.dispatch("placeOrder", { id: "1" });
		app.dispatch("placeOrder", { id: "2" });

		const { node: orderCountNode, reset } = app.projection<number>({
			name: "orderCount",
			events: ["orderPlaced"],
			reducer: (_s, events) => events.length,
			initial: 0,
		});

		// Initial state reflects dispatches made before projection was created.
		const afterReset = await reset();
		expect(afterReset).toBe(2);
		expect(orderCountNode.cache).toBe(2);
		app.destroy();
	});

	it("projection returns ProjectionController with node", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		const ctrl = app.projection<number>({
			name: "orderCount",
			events: ["orderPlaced"],
			reducer: (_s, e) => e.length,
			initial: 0,
		});
		expect(ctrl.node).toBeDefined();
		expect(typeof ctrl.rebuild).toBe("function");
		expect(typeof ctrl.reset).toBe("function");
		app.destroy();
	});

	it("projection mode=replay: reducer always receives initial state", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.command("place", (p: any, { emit }) => emit("orderPlaced", p));
		app.projection<number>({
			name: "orderCount",
			events: ["orderPlaced"],
			reducer: (_state, events) => events.length,
			initial: 0,
			mode: "replay",
		});
		app.dispatch("place", { id: "1" });
		expect(app.node("orderCount").cache).toBe(1);
		app.dispatch("place", { id: "2" });
		expect(app.node("orderCount").cache).toBe(2);
		app.destroy();
	});

	it("projection mode=scan (default): incremental fold", () => {
		let reducerCallCount = 0;
		const app = cqrs("test");
		app.event("orderPlaced");
		app.command("place", (p: any, { emit }) => emit("orderPlaced", p));
		app.projection<number>({
			name: "orderCount",
			events: ["orderPlaced"],
			reducer: (state, events) => {
				reducerCallCount++;
				return state + events.length;
			},
			initial: 0,
			mode: "scan",
		});
		// Capture the count after projection construction (includes the
		// push-on-subscribe activation for the empty initial state).
		const countAfterConstruction = reducerCallCount;
		app.dispatch("place", { id: "1" });
		expect(app.node("orderCount").cache).toBe(1);
		app.dispatch("place", { id: "2" });
		expect(app.node("orderCount").cache).toBe(2);
		// Each dispatch fires the reducer exactly once (incremental, not full replay).
		expect(reducerCallCount - countAfterConstruction).toBe(2);
		app.destroy();
	});

	// -- D1 — per-aggregate streams + LRU + optimistic concurrency -----------

	it("aggregateVersion increments per-(type, aggregateId) on emit", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.command("place", (_: unknown, { emit }) => {
			emit("orderPlaced", { id: "x" });
		});
		app.dispatch("place", { id: "1" }, { aggregateId: "agg-1" });
		expect(app.aggregateVersion("orderPlaced", "agg-1")).toBe(1);
		app.dispatch("place", { id: "2" }, { aggregateId: "agg-1" });
		expect(app.aggregateVersion("orderPlaced", "agg-1")).toBe(2);
		expect(app.aggregateVersion("orderPlaced", "agg-2")).toBe(0);
		const events = app.event("orderPlaced", "agg-1").cache as readonly CqrsEvent[];
		expect(events).toHaveLength(2);
		expect(events[0].aggregateVersion).toBe(1);
		expect(events[1].aggregateVersion).toBe(2);
		app.destroy();
	});

	it("dispatch throws OptimisticConcurrencyError on version mismatch", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.command("place", {
			handler: (_: unknown, { emit }) => emit("orderPlaced", { id: "x" }),
			emits: ["orderPlaced"],
		});
		app.dispatch("place", { id: "1" }, { aggregateId: "agg-1" });
		// Aggregate is at v1; expecting v0 should throw.
		expect(() =>
			app.dispatch("place", { id: "2" }, { aggregateId: "agg-1", expectedAggregateVersion: 0 }),
		).toThrow(OptimisticConcurrencyError);
		// Expecting v1 should succeed.
		app.dispatch("place", { id: "3" }, { aggregateId: "agg-1", expectedAggregateVersion: 1 });
		expect(app.aggregateVersion("orderPlaced", "agg-1")).toBe(2);
		app.destroy();
	});

	it("LRU eviction removes oldest aggregate streams when maxAggregates exceeded", () => {
		const app = cqrs("test", { maxAggregates: 2 });
		app.event("e");
		app.command("emit", (_: unknown, { emit }) => emit("e", { v: 1 }));
		app.dispatch("emit", {}, { aggregateId: "a" });
		app.dispatch("emit", {}, { aggregateId: "b" });
		app.dispatch("emit", {}, { aggregateId: "c" }); // evicts "a"
		const evictions = app.aggregateEvictions.entries.cache as readonly {
			aggregateId: string;
			type: string;
			lastVersion: number;
		}[];
		expect(evictions).toHaveLength(1);
		expect(evictions[0].aggregateId).toBe("a");
		expect(evictions[0].type).toBe("e");
		expect(evictions[0].lastVersion).toBe(1);
		// Aggregate "a" version is reset (its dedicated stream + counter were dropped).
		expect(app.aggregateVersion("e", "a")).toBe(0);
		expect(app.aggregateVersion("e", "b")).toBe(1);
		app.destroy();
	});

	// ── C.1 E — per-aggregate streams (fan-in) ────────────────────────

	it("event(type) and event(type, aggregateId) point at distinct streams; per-aggregate isolates", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.command("place", {
			handler: (p, a) => a.emit("orderPlaced", p),
			emits: ["orderPlaced"],
		});

		app.dispatch("place", { id: 1 }, { aggregateId: "a" });
		app.dispatch("place", { id: 2 }, { aggregateId: "b" });
		app.dispatch("place", { id: 3 }, { aggregateId: "a" });

		// Type-level (fan-in) stream — all events for the type, in dispatch order.
		const all = app.event("orderPlaced").cache as readonly CqrsEvent[];
		expect(all.map((e) => e.aggregateId)).toEqual(["a", "b", "a"]);

		// Per-aggregate streams isolate.
		const aOnly = app.event("orderPlaced", "a").cache as readonly CqrsEvent[];
		const bOnly = app.event("orderPlaced", "b").cache as readonly CqrsEvent[];
		expect(aOnly).toHaveLength(2);
		expect(bOnly).toHaveLength(1);
		expect(aOnly.every((e) => e.aggregateId === "a")).toBe(true);
		expect(bOnly[0]!.aggregateId).toBe("b");

		// aggregateVersion is per-(type, aggregateId).
		expect(app.aggregateVersion("orderPlaced", "a")).toBe(2);
		expect(app.aggregateVersion("orderPlaced", "b")).toBe(1);

		app.destroy();
	});

	it("mergeReactiveLogs over per-aggregate streams produces a stable fan-in stream", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.command("place", {
			handler: (p, a) => a.emit("orderPlaced", p),
			emits: ["orderPlaced"],
		});

		// Touch both aggregate streams so they exist.
		app.dispatch("place", { id: 1 }, { aggregateId: "a" });
		app.dispatch("place", { id: 2 }, { aggregateId: "b" });

		const aLog = app.event("orderPlaced", "a");
		const bLog = app.event("orderPlaced", "b");
		const merged = mergeReactiveLogs([aLog, bLog]);
		expect((merged.node.cache as readonly CqrsEvent[]).length).toBe(2);

		// New emission to "a" propagates through the merged stream.
		app.dispatch("place", { id: 3 }, { aggregateId: "a" });
		const after = merged.node.cache as readonly CqrsEvent[];
		expect(after.length).toBe(3);
		// Per-aggregate ordering preserved within each input log; merge is
		// concatenation order across input identities.
		expect(after.map((e) => e.aggregateId)).toEqual(["a", "a", "b"]);

		merged.dispose();
		app.destroy();
	});

	// ── Audit 2 — saga errorPolicy + invocations audit ────────────────

	it("saga errorPolicy='advance' (default) skips past failure; invocations log captures both records", () => {
		const app = cqrs<{ orderPlaced: { id: number } }>("test");
		app.command("placeOrder", {
			handler: (p, a) => a.emit("orderPlaced", p),
			emits: ["orderPlaced"],
		});
		const seen: number[] = [];
		const ctrl = app.saga<{ id: number }>("notifyShipping", ["orderPlaced"], (evt) => {
			if ((evt.payload as { id: number }).id === 2) throw new Error("boom");
			seen.push((evt.payload as { id: number }).id);
		});

		app.dispatch("placeOrder", { id: 1 });
		app.dispatch("placeOrder", { id: 2 });
		app.dispatch("placeOrder", { id: 3 });

		// "advance" policy: failure is recorded but cursor moves past it, so
		// id=3 is still processed.
		expect(seen).toEqual([1, 3]);

		const inv = ctrl.invocations.entries.cache as readonly {
			outcome: string;
			errorType?: string;
		}[];
		expect(inv.length).toBe(3);
		expect(inv[0]!.outcome).toBe("success");
		expect(inv[1]!.outcome).toBe("failure");
		expect(inv[1]!.errorType).toBe("Error");
		expect(inv[2]!.outcome).toBe("success");

		app.destroy();
	});

	it("saga errorPolicy='hold' stops cursor at failure; later events are NOT processed until handler stops throwing", () => {
		const app = cqrs<{ orderPlaced: { id: number } }>("test");
		app.command("placeOrder", {
			handler: (p, a) => a.emit("orderPlaced", p),
			emits: ["orderPlaced"],
		});
		let throwOnId: number | null = 2;
		const seen: number[] = [];
		app.saga<{ id: number }>(
			"notifyShipping",
			["orderPlaced"],
			(evt) => {
				const id = (evt.payload as { id: number }).id;
				if (id === throwOnId) throw new Error("hold");
				seen.push(id);
			},
			{ errorPolicy: "hold" },
		);

		app.dispatch("placeOrder", { id: 1 });
		app.dispatch("placeOrder", { id: 2 });
		app.dispatch("placeOrder", { id: 3 });

		// "hold" policy: cursor stops at the failing event; id=3 is NOT seen
		// because the saga didn't advance past id=2.
		expect(seen).toEqual([1]);

		// Disable the throw and emit a fresh event — the saga retries from the
		// held cursor and processes id=2 + id=3 + id=4 in order.
		throwOnId = null;
		app.dispatch("placeOrder", { id: 4 });
		expect(seen).toEqual([1, 2, 3, 4]);

		app.destroy();
	});
});
