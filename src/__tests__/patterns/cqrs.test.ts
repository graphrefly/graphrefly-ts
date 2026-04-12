import { describe, expect, it } from "vitest";
import { GuardDenied } from "../../core/guard.js";
import { type CqrsEvent, CqrsGraph, cqrs, MemoryEventStore } from "../../patterns/cqrs.js";

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
		expect(app.get("placeOrder")).toEqual({ id: "42" });
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

	// FLAG: v5 behavioral change — needs investigation (_applyVersioning removed, v0 not populated)
	it("events carry v0 identity when event log node is versioned", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		// FLAG: _applyVersioning removed in v5
		// ((app as any)._eventLogs.get("orderPlaced").log.entries as any)._applyVersioning(0);
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
		app.projection<number>("orderCount", ["orderPlaced"], (_state, events) => events.length, 0);
		app.command("placeOrder", (payload: any, { emit }) => {
			emit("orderPlaced", payload);
		});

		expect(app.get("orderCount")).toBe(0);
		app.dispatch("placeOrder", { id: "1" });
		expect(app.get("orderCount")).toBe(1);
		app.dispatch("placeOrder", { id: "2" });
		expect(app.get("orderCount")).toBe(2);
		app.destroy();
	});

	it("projection from multiple event streams", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.event("orderCancelled");

		type Summary = { placed: number; cancelled: number };
		app.projection<Summary>(
			"summary",
			["orderPlaced", "orderCancelled"],
			(_state, events) => ({
				placed: events.filter((e) => e.type === "orderPlaced").length,
				cancelled: events.filter((e) => e.type === "orderCancelled").length,
			}),
			{ placed: 0, cancelled: 0 },
		);

		app.command("placeOrder", (_p: any, { emit }) => emit("orderPlaced", {}));
		app.command("cancelOrder", (_p: any, { emit }) => emit("orderCancelled", {}));

		app.dispatch("placeOrder", {});
		app.dispatch("placeOrder", {});
		app.dispatch("cancelOrder", {});

		const summary = app.get("summary") as Summary;
		expect(summary.placed).toBe(2);
		expect(summary.cancelled).toBe(1);
		app.destroy();
	});

	it("projection node guard denies write", () => {
		const app = cqrs("test");
		app.event("orderPlaced");
		app.projection("orderCount", ["orderPlaced"], (_s, e) => e.length, 0);
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
		app.projection("orderCount", ["orderPlaced"], (_s, e) => e.length, 0);
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
		app.projection("orderCount", ["orderPlaced"], (_s, e) => e.length, 0);
		app.saga("notifyShipping", ["orderPlaced"], () => {});

		const desc = app.describe();
		const edgePairs = desc.edges.map((e: any) => `${e.from}->${e.to}`);
		expect(edgePairs).toContain("orderPlaced->orderCount");
		expect(edgePairs).toContain("orderPlaced->notifyShipping");
		app.destroy();
	});

	// -- Event store ----------------------------------------------------------

	it("useEventStore() persists events on dispatch", () => {
		const store = new MemoryEventStore();
		const app = cqrs("test");
		app.useEventStore(store);
		app.event("orderPlaced");
		app.command("placeOrder", (payload: any, { emit }) => {
			emit("orderPlaced", payload);
		});

		app.dispatch("placeOrder", { id: "1" });
		app.dispatch("placeOrder", { id: "2" });

		const persisted = store.loadEvents("orderPlaced");
		expect(persisted.events).toHaveLength(2);
		expect(persisted.events[0].payload).toEqual({ id: "1" });
		app.destroy();
	});

	it("rebuildProjection() replays from event store", async () => {
		const store = new MemoryEventStore();
		const app = cqrs("test");
		app.useEventStore(store);
		app.event("orderPlaced");
		app.command("placeOrder", (payload: any, { emit }) => {
			emit("orderPlaced", payload);
		});

		app.dispatch("placeOrder", { id: "1" });
		app.dispatch("placeOrder", { id: "2" });

		const rebuilt = await app.rebuildProjection(["orderPlaced"], (_s, events) => events.length, 0);
		expect(rebuilt).toBe(2);
		app.destroy();
	});

	it("rebuildProjection() throws without event store", async () => {
		const app = cqrs("test");
		await expect(app.rebuildProjection(["y"], (_s, e) => e.length, 0)).rejects.toThrow(
			/No event store/,
		);
		app.destroy();
	});

	// -- MemoryEventStore -----------------------------------------------------

	it("MemoryEventStore loadEvents with cursor filter", () => {
		const store = new MemoryEventStore();
		const t1 = Date.now() * 1_000_000 - 100_000_000;
		const t2 = Date.now() * 1_000_000;
		store.persist({ type: "a", payload: 1, timestampNs: t1, seq: 1 });
		store.persist({ type: "a", payload: 2, timestampNs: t2, seq: 2 });

		const all = store.loadEvents("a");
		expect(all.events).toHaveLength(2);

		const recent = store.loadEvents("a", { timestampNs: t1, seq: 1 });
		expect(recent.events).toHaveLength(1);
		expect(recent.events[0].payload).toBe(2);
	});

	it("MemoryEventStore clear() removes all events", () => {
		const store = new MemoryEventStore();
		store.persist({ type: "a", payload: 1, timestampNs: 0, seq: 1 });
		store.clear();
		expect(store.loadEvents("a").events).toHaveLength(0);
	});
});
