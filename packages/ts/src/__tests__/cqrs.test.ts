import { describe, expect, it } from "vitest";
import { cqrs, cqrsCommandHandler, cqrsProjection } from "../cqrs/index.js";
import { graph } from "../graph/graph.js";
import { compoundTupleKey } from "../identity.js";

const cqrsEventId = (commandId: string, seq: string) =>
	compoundTupleKey("cqrs-event", [commandId, seq]);

/** R-failure@3: a throw inside a node's function is that node's ERROR, not a host throw. */
function watchError(g: ReturnType<typeof graph>, path: string): () => string {
	const n = g.find(path);
	if (n === undefined) throw new Error(`missing ${path}`);
	let error: unknown;
	n.subscribe((incoming) => {
		for (const m of incoming) {
			if (m[0] === "ERROR") error = m[1];
		}
	});
	return () => {
		expect(n.status.output).toBe("errored");
		return String((error as Error | undefined)?.message ?? error);
	};
}

describe("CQRS application infrastructure (B63 / D125 / D129)", () => {
	it("dispatches commands as graph-owned command facts and emits audit/status facts", () => {
		const g = graph();
		const app = cqrs(g, {
			name: "orders",
			events: ["OrderPlaced"],
			now: () => 10,
			handlers: [
				cqrsCommandHandler("PlaceOrder", (command) => [
					{ type: "OrderPlaced", payload: command.payload },
				]),
			],
		});
		const commands: unknown[] = [];
		const audit: unknown[] = [];
		const status: unknown[] = [];
		app.command.subscribe((incoming) => {
			for (const msg of incoming) {
				commands.push(msg);
			}
		});
		app.audit.subscribe((incoming) => {
			for (const msg of incoming) {
				audit.push(msg);
			}
		});
		app.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});

		app.dispatch({ id: "cmd-1", type: "PlaceOrder", payload: { id: "o1" } });

		expect(commands.at(-1)).toEqual([
			"DATA",
			{ id: "cmd-1", type: "PlaceOrder", payload: { id: "o1" } },
		]);
		expect(audit.at(-1)).toEqual([
			"DATA",
			{
				seq: 1,
				commandId: "cmd-1",
				commandType: "PlaceOrder",
				outcome: "success",
				eventIds: [cqrsEventId("cmd-1", "1")],
				eventTypes: ["OrderPlaced"],
				cursor: { eventSeq: 1, commandCount: 1, errorCount: 0, auditSeq: 1 },
			},
		]);
		expect(status.at(-1)).toEqual([
			"DATA",
			{
				state: "accepted",
				commandId: "cmd-1",
				commandType: "PlaceOrder",
				eventCount: 1,
				cursor: { eventSeq: 1, commandCount: 1, errorCount: 0, auditSeq: 0 },
			},
		]);
	});

	it("keeps public fact nodes active before external observers subscribe", () => {
		const g = graph();
		const app = cqrs(g, {
			name: "orders",
			events: ["OrderPlaced"],
			now: () => 15,
			handlers: [
				cqrsCommandHandler("PlaceOrder", (command) => [
					{ type: "OrderPlaced", payload: command.payload },
				]),
			],
		});

		app.dispatch({ id: "cmd-1", type: "PlaceOrder", payload: { id: "o1" } });

		const events: unknown[] = [];
		const audit: unknown[] = [];
		const status: unknown[] = [];
		const cursor: unknown[] = [];
		app.events.subscribe((incoming) => {
			for (const msg of incoming) {
				events.push(msg);
			}
		});
		app.audit.subscribe((incoming) => {
			for (const msg of incoming) {
				audit.push(msg);
			}
		});
		app.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});
		app.cursor.subscribe((incoming) => {
			for (const msg of incoming) {
				cursor.push(msg);
			}
		});

		expect(events.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				id: cqrsEventId("cmd-1", "1"),
				type: "OrderPlaced",
				commandId: "cmd-1",
				timestampMs: 15,
			}),
		]);
		expect(audit.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ commandId: "cmd-1", outcome: "success" }),
		]);
		expect(status.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ commandId: "cmd-1", state: "accepted" }),
		]);
		expect(cursor.at(-1)).toEqual([
			"DATA",
			{ eventSeq: 1, commandCount: 1, errorCount: 0, auditSeq: 1 },
		]);
	});

	it("orders handler-emitted event facts", () => {
		const g = graph();
		const app = cqrs(g, {
			name: "orders",
			events: ["OrderPlaced", "OrderConfirmed"],
			now: () => 20,
			handlers: [
				cqrsCommandHandler("PlaceOrder", (command) => [
					{ type: "OrderPlaced", payload: command.payload },
					{ type: "OrderConfirmed", payload: { id: (command.payload as { id: string }).id } },
				]),
			],
		});
		const events: unknown[] = [];
		const cursor: unknown[] = [];
		app.events.subscribe((incoming) => {
			for (const msg of incoming) {
				events.push(msg);
			}
		});
		app.cursor.subscribe((incoming) => {
			for (const msg of incoming) {
				cursor.push(msg);
			}
		});

		app.dispatch({ id: "cmd-1", type: "PlaceOrder", payload: { id: "o1" } });

		expect(events.filter((msg) => (msg as unknown[])[0] === "DATA")).toEqual([
			[
				"DATA",
				{
					id: cqrsEventId("cmd-1", "1"),
					type: "OrderPlaced",
					seq: 1,
					cursor: 1,
					runtimeCursor: { eventSeq: 1, commandCount: 1, errorCount: 0, auditSeq: 0 },
					commandId: "cmd-1",
					commandType: "PlaceOrder",
					payload: { id: "o1" },
					timestampMs: 20,
				},
			],
			[
				"DATA",
				{
					id: cqrsEventId("cmd-1", "2"),
					type: "OrderConfirmed",
					seq: 2,
					cursor: 2,
					runtimeCursor: { eventSeq: 2, commandCount: 1, errorCount: 0, auditSeq: 0 },
					commandId: "cmd-1",
					commandType: "PlaceOrder",
					payload: { id: "o1" },
					timestampMs: 20,
				},
			],
		]);
		expect(cursor.at(-1)).toEqual([
			"DATA",
			{ eventSeq: 2, commandCount: 1, errorCount: 0, auditSeq: 1 },
		]);
	});

	it("routes duplicate and unknown command/event cases to graph-visible errors", () => {
		const g = graph();
		let duplicateEvent = false;
		const app = cqrs(g, {
			name: "orders",
			events: ["OrderPlaced"],
			now: () => 30,
			handlers: [
				cqrsCommandHandler("PlaceOrder", () => [
					{
						id: duplicateEvent ? "event-1" : undefined,
						type: "OrderPlaced",
						payload: { ok: true },
					},
				]),
				cqrsCommandHandler("EmitUnknown", () => [{ type: "OrderRouted", payload: {} }]),
			],
		});
		const errors: unknown[] = [];
		const events: unknown[] = [];
		app.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});
		app.events.subscribe((incoming) => {
			for (const msg of incoming) {
				events.push(msg);
			}
		});

		app.dispatch({ id: "cmd-1", type: "Missing", payload: {} });
		app.dispatch({ id: "cmd-1", type: "Missing", payload: {} });
		app.dispatch({ id: "cmd-2", type: "EmitUnknown", payload: {} });
		duplicateEvent = true;
		app.dispatch({ id: "cmd-3", type: "PlaceOrder", payload: {} });
		app.dispatch({ id: "cmd-4", type: "PlaceOrder", payload: {} });
		app.dispatch({ id: "cmd-3", type: "PlaceOrder", payload: {} });

		expect(errors).toContainEqual([
			"DATA",
			expect.objectContaining({ code: "unknown-command", commandId: "cmd-1" }),
		]);
		expect(errors).toContainEqual([
			"DATA",
			expect.objectContaining({ code: "duplicate-command", commandId: "cmd-1" }),
		]);
		expect(errors).toContainEqual([
			"DATA",
			expect.objectContaining({ code: "unknown-event", commandId: "cmd-2" }),
		]);
		expect(errors).toContainEqual([
			"DATA",
			expect.objectContaining({ code: "duplicate-event", commandId: "cmd-4" }),
		]);
		expect(errors).toContainEqual([
			"DATA",
			expect.objectContaining({ code: "duplicate-command", commandId: "cmd-3" }),
		]);
		expect(events.filter((msg) => (msg as unknown[])[0] === "DATA")).toHaveLength(1);
	});

	it("bounds command and event dedupe windows explicitly (D142)", () => {
		const g = graph();
		const app = cqrs(g, {
			name: "orders",
			events: ["OrderPlaced"],
			dedupe: {
				commands: { maxEntries: 1 },
				events: { maxEntries: 1 },
			},
			handlers: [
				cqrsCommandHandler("PlaceOrder", (command) => [
					{
						id: (command.payload as { eventId: string }).eventId,
						type: "OrderPlaced",
						payload: command.payload,
					},
				]),
			],
		});
		const events: unknown[] = [];
		const errors: unknown[] = [];
		const cursor: unknown[] = [];
		app.events.subscribe((incoming) => {
			for (const msg of incoming) {
				events.push(msg);
			}
		});
		app.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});
		app.cursor.subscribe((incoming) => {
			for (const msg of incoming) {
				cursor.push(msg);
			}
		});

		app.dispatch({ id: "cmd-1", type: "PlaceOrder", payload: { eventId: "event-1" } });
		app.dispatch({ id: "cmd-2", type: "PlaceOrder", payload: { eventId: "event-2" } });
		app.dispatch({ id: "cmd-1", type: "PlaceOrder", payload: { eventId: "event-1" } });
		app.dispatch({ id: "cmd-1", type: "PlaceOrder", payload: { eventId: "event-3" } });

		expect(events.filter((msg) => (msg as unknown[])[0] === "DATA")).toHaveLength(3);
		expect(errors.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				code: "duplicate-command",
				commandId: "cmd-1",
				cursor: expect.objectContaining({
					dedupe: {
						commandIdsRetained: 1,
						eventIdsRetained: 1,
						commandIdsEvicted: 2,
						eventIdsEvicted: 2,
					},
				}),
			}),
		]);
		expect(cursor.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				dedupe: {
					commandIdsRetained: 1,
					eventIdsRetained: 1,
					commandIdsEvicted: 2,
					eventIdsEvicted: 2,
				},
			}),
		]);
	});

	it("keeps default CQRS dedupe as unbounded id membership, not a shared engine (D151)", () => {
		const g = graph();
		const app = cqrs(g, {
			name: "orders",
			events: ["OrderPlaced"],
			handlers: [
				cqrsCommandHandler("PlaceOrder", (command) => [
					{
						id: (command.payload as { eventId: string }).eventId,
						type: "OrderPlaced",
						payload: command.payload,
					},
				]),
			],
		});
		const events: unknown[] = [];
		const errors: unknown[] = [];
		const cursor: unknown[] = [];
		app.events.subscribe((incoming) => {
			for (const msg of incoming) {
				events.push(msg);
			}
		});
		app.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});
		app.cursor.subscribe((incoming) => {
			for (const msg of incoming) {
				cursor.push(msg);
			}
		});

		app.dispatch({ id: "cmd-1", type: "PlaceOrder", payload: { eventId: "event-1" } });
		app.dispatch({ id: "cmd-2", type: "PlaceOrder", payload: { eventId: "event-2" } });
		app.dispatch({ id: "cmd-3", type: "PlaceOrder", payload: { eventId: "event-3" } });
		app.dispatch({ id: "cmd-1", type: "PlaceOrder", payload: { eventId: "event-4" } });

		expect(events.filter((msg) => (msg as unknown[])[0] === "DATA")).toHaveLength(3);
		expect(errors.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ code: "duplicate-command", commandId: "cmd-1" }),
		]);
		expect(cursor.at(-1)).toEqual([
			"DATA",
			{ eventSeq: 3, commandCount: 4, errorCount: 1, auditSeq: 4 },
		]);
	});

	it("does not partially commit events when command validation fails", () => {
		const g = graph();
		const app = cqrs(g, {
			name: "orders",
			events: ["OrderPlaced"],
			handlers: [
				cqrsCommandHandler("PlaceOrder", () => [
					{ type: "OrderPlaced", payload: { id: "o1" } },
					{ type: "OrderRouted", payload: { id: "o1" } },
				]),
			],
		});
		const events: unknown[] = [];
		const audit: unknown[] = [];
		app.events.subscribe((incoming) => {
			for (const msg of incoming) {
				events.push(msg);
			}
		});
		app.audit.subscribe((incoming) => {
			for (const msg of incoming) {
				audit.push(msg);
			}
		});

		app.dispatch({ id: "cmd-1", type: "PlaceOrder", payload: {} });

		expect(events.filter((msg) => (msg as unknown[])[0] === "DATA")).toEqual([]);
		expect(audit.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				commandId: "cmd-1",
				outcome: "failure",
				eventIds: [],
				eventTypes: [],
				errorCode: "unknown-event",
			}),
		]);
	});

	it("routes timestamp provider failures to graph-visible CQRS errors", () => {
		const g = graph();
		const app = cqrs(g, {
			name: "orders",
			events: ["OrderPlaced"],
			now: () => {
				throw new Error("clock down");
			},
			handlers: [
				cqrsCommandHandler("PlaceOrder", (command) => [
					{ type: "OrderPlaced", payload: command.payload },
				]),
			],
		});
		const events: unknown[] = [];
		const errors: unknown[] = [];
		const audit: unknown[] = [];
		app.events.subscribe((incoming) => {
			for (const msg of incoming) {
				events.push(msg);
			}
		});
		app.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});
		app.audit.subscribe((incoming) => {
			for (const msg of incoming) {
				audit.push(msg);
			}
		});

		app.dispatch({ id: "cmd-1", type: "PlaceOrder", payload: {} });

		expect(events.filter((msg) => (msg as unknown[])[0] === "DATA")).toEqual([]);
		expect(errors.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				code: "clock-threw",
				message: "cqrs: now() threw: clock down",
				commandId: "cmd-1",
			}),
		]);
		expect(audit.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				commandId: "cmd-1",
				outcome: "failure",
				errorCode: "clock-threw",
			}),
		]);
	});

	it("derives projections from declared event deps and reports reducer throws as error facts", () => {
		const g = graph();
		const app = cqrs(g, {
			name: "orders",
			events: ["OrderPlaced", "OrderFailed"],
			handlers: [
				cqrsCommandHandler("PlaceOrder", (command) => [
					{
						type: (command.payload as { fail?: boolean }).fail ? "OrderFailed" : "OrderPlaced",
						payload: command.payload,
					},
				]),
			],
		});
		const projection = cqrsProjection(g, app, {
			name: "orders/count",
			events: ["OrderPlaced", "OrderFailed"],
			initial: { placed: 0 },
			reducer(state, event) {
				if (event.type === "OrderFailed") throw new Error("projection failed");
				return { placed: state.placed + 1 };
			},
		});
		const values: unknown[] = [];
		const projectionErrors: unknown[] = [];
		const protocolErrors: unknown[] = [];
		projection.value.subscribe((incoming) => {
			for (const msg of incoming) {
				values.push(msg);
			}
		});
		projection.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				projectionErrors.push(msg);
			}
		});
		projection.frames.subscribe((incoming) => {
			for (const msg of incoming) {
				protocolErrors.push(msg);
			}
		});

		app.dispatch({ id: "cmd-1", type: "PlaceOrder", payload: { id: "o1" } });
		app.dispatch({ id: "cmd-2", type: "PlaceOrder", payload: { id: "o2", fail: true } });

		expect(values.filter((msg) => (msg as unknown[])[0] === "DATA").at(-1)).toEqual([
			"DATA",
			{ placed: 1 },
		]);
		expect(projectionErrors.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				code: "projection-threw",
				message: "projection failed",
				eventId: cqrsEventId("cmd-2", "1"),
				eventType: "OrderFailed",
			}),
		]);
		expect(protocolErrors).not.toContainEqual(["ERROR", expect.anything()]);
	});

	it("keeps a projection's successful prefix when a later event in the same batch throws", () => {
		const g = graph();
		const app = cqrs(g, {
			name: "orders",
			events: ["OrderPlaced", "OrderFailed"],
			handlers: [
				cqrsCommandHandler("PlaceOrder", (command) => [
					{ type: "OrderPlaced", payload: command.payload },
					{ type: "OrderFailed", payload: command.payload },
				]),
			],
		});
		const projection = cqrsProjection(g, app, {
			name: "orders/count",
			events: ["OrderPlaced", "OrderFailed"],
			initial: { placed: 0 },
			reducer(state, event) {
				if (event.type === "OrderFailed") throw new Error("projection failed");
				return { placed: state.placed + 1 };
			},
		});
		const values: unknown[] = [];
		const errors: unknown[] = [];
		projection.value.subscribe((incoming) => {
			for (const msg of incoming) {
				values.push(msg);
			}
		});
		projection.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});

		app.dispatch({ id: "cmd-1", type: "PlaceOrder", payload: { id: "o1" } });

		expect(values.filter((msg) => (msg as unknown[])[0] === "DATA")).toContainEqual([
			"DATA",
			{ placed: 1 },
		]);
		expect(errors.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				code: "projection-threw",
				eventId: cqrsEventId("cmd-1", "2"),
				eventType: "OrderFailed",
			}),
		]);
	});

	it("a dispatch from a command handler is a later request, not a reentry (C-6)", () => {
		const g = graph();
		let app!: ReturnType<typeof cqrs>;
		app = cqrs(g, {
			name: "orders",
			events: ["OrderPlaced"],
			handlers: [
				cqrsCommandHandler("PlaceOrder", (command) => {
					if (command.id === "cmd-1") {
						app.dispatch({ id: "cmd-2", type: "PlaceOrder", payload: {} });
					}
					return [{ type: "OrderPlaced", payload: command.payload }];
				}),
			],
		});
		const errors: unknown[] = [];
		app.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});

		app.dispatch({ id: "cmd-1", type: "PlaceOrder", payload: {} });
		expect(g.find("orders/runtime")?.status.output).toBe("open");
		expect(errors).not.toContainEqual(["DATA", expect.objectContaining({ code: "handler-threw" })]);
	});

	it("does not downgrade graph-domain violations from command handlers into CQRS facts", () => {
		const g = graph();
		const other = graph();
		const foreign = other.state(1, { name: "foreign" });
		const app = cqrs(g, {
			name: "orders",
			events: ["OrderPlaced"],
			handlers: [
				cqrsCommandHandler("PlaceOrder", (command) => {
					g.derived([foreign], (value) => value, { name: "illegal-cross-graph" });
					return [{ type: "OrderPlaced", payload: command.payload }];
				}),
			],
		});
		const errors: unknown[] = [];
		app.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});

		const runtimeError = watchError(g, "orders/runtime");
		app.dispatch({ id: "cmd-1", type: "PlaceOrder", payload: {} });
		expect(runtimeError()).toMatch(
			/different graph|cross-graph|R-graph-domain|wire bridge|construction/i,
		);
		expect(errors).not.toContainEqual(["DATA", expect.objectContaining({ code: "handler-threw" })]);
	});

	it("a dispatch from a projection reducer is a later request, not a reentry (C-6)", () => {
		const g = graph();
		const app = cqrs(g, {
			name: "orders",
			events: ["OrderPlaced"],
			handlers: [
				cqrsCommandHandler("PlaceOrder", (command) => [
					{ type: "OrderPlaced", payload: command.payload },
				]),
			],
		});
		const projection = cqrsProjection(g, app, {
			name: "orders/count",
			events: ["OrderPlaced"],
			initial: 0,
			reducer(state, event) {
				if (event.commandId === "cmd-1") {
					app.dispatch({ id: "cmd-2", type: "PlaceOrder", payload: {} });
				}
				return state + 1;
			},
		});
		const projectionErrors: unknown[] = [];
		projection.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				projectionErrors.push(msg);
			}
		});

		app.dispatch({ id: "cmd-1", type: "PlaceOrder", payload: {} });
		expect(g.find("orders/count")?.status.output).toBe("open");
		expect(projectionErrors).not.toContainEqual([
			"DATA",
			expect.objectContaining({ code: "projection-threw" }),
		]);
	});

	it("keeps runtime state checkpoint/JSON friendly", () => {
		const g = graph();
		const app = cqrs(g, {
			name: "orders",
			events: ["OrderPlaced"],
			handlers: [
				cqrsCommandHandler("PlaceOrder", () => [
					{ id: "event-1", type: "OrderPlaced", payload: {} },
				]),
			],
		});

		app.dispatch({ id: "cmd-1", type: "PlaceOrder", payload: {} });

		const checkpoint = g.checkpoint();
		expect(() => JSON.stringify(checkpoint)).not.toThrow();
		const runtime = checkpoint.nodes.find((node) => node.id === "orders/runtime");
		expect(runtime?.ctxState).toEqual({
			persist: false,
			value: {
				kind: "DATA",
				data: {
					eventSeq: 1,
					commandCount: 1,
					errorCount: 0,
					auditSeq: 1,
					seenCommandIds: ["cmd-1"],
					seenEventIds: ["event-1"],
				},
			},
		});
	});

	it("shows command/event/projection nodes and declared deps in describe", () => {
		const g = graph();
		const app = cqrs(g, {
			name: "orders",
			events: ["OrderPlaced"],
			handlers: [cqrsCommandHandler("PlaceOrder", () => [{ type: "OrderPlaced", payload: {} }])],
		});
		cqrsProjection(g, app, {
			name: "orders/count",
			events: ["OrderPlaced"],
			initial: 0,
			reducer: (state) => state + 1,
		});

		const snap = g.describe();

		expect(snap.nodes.map((node) => [node.id, node.factory])).toEqual(
			expect.arrayContaining([
				["orders/command", "cqrsCommand"],
				["orders/runtime", "cqrsRuntime"],
				["orders/events", "cqrsEvents"],
				["orders/status", "cqrsStatus"],
				["orders/errors", "cqrsErrors"],
				["orders/audit", "cqrsAudit"],
				["orders/cursor", "cqrsCursor"],
				["orders/count", "cqrsProjection"],
				["orders/count/value", "cqrsProjectionValue"],
				["orders/count/errors", "cqrsProjectionErrors"],
				["orders/count/status", "cqrsProjectionStatus"],
			]),
		);
		expect(snap.edges).toEqual(
			expect.arrayContaining([
				{ from: "orders/command", to: "orders/runtime" },
				{ from: "orders/runtime", to: "orders/events" },
				{ from: "orders/runtime", to: "orders/status" },
				{ from: "orders/runtime", to: "orders/errors" },
				{ from: "orders/runtime", to: "orders/audit" },
				{ from: "orders/runtime", to: "orders/cursor" },
				{ from: "orders/events", to: "orders/count" },
				{ from: "orders/count", to: "orders/count/value" },
				{ from: "orders/count", to: "orders/count/errors" },
				{ from: "orders/count", to: "orders/count/status" },
			]),
		);
	});
});
