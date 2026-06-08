import { describe, expect, it, vi } from "vitest";
import { toHttp, webSocketSession } from "../adapters/index.js";
import {
	EnvironmentDrivers,
	type HttpRequest,
	type HttpResponse,
	type WebSocketDriverEvent,
	type WebSocketRequest,
	type WebSocketSend,
	type WebSocketSendResult,
	type WebSocketSessionHandle,
} from "../graph/environment.js";
import { graph } from "../graph/graph.js";
import { retryPolicy } from "../graph/resilience.js";

describe("environment outbound adapters (D130/D132)", () => {
	it("routes outbound HTTP attempts and results through graph-visible nodes", () => {
		const calls: Array<{
			request: HttpRequest;
			callback: (result: { ok: true; value: HttpResponse } | { ok: false; error: unknown }) => void;
		}> = [];
		const http = {
			request(
				request: HttpRequest,
				callback: (
					result: { ok: true; value: HttpResponse } | { ok: false; error: unknown },
				) => void,
			) {
				calls.push({ request, callback });
				return () => {};
			},
		};
		const g = graph({ environment: new EnvironmentDrivers({ http }) });
		const source = g.node<string>([], null, { name: "source" });
		const bundle = toHttp(g, source, (value) => ({ method: "POST", url: "/events", body: value }), {
			name: "egress",
		});
		const events: unknown[] = [];
		const statuses: unknown[] = [];
		bundle.events.subscribe((msg) => events.push(msg));
		bundle.status.subscribe((msg) => statuses.push(msg));

		source.down([["DATA", "alpha"]]);
		expect(calls.map((call) => call.request)).toEqual([
			{ method: "POST", url: "/events", body: "alpha" },
		]);
		calls[0]?.callback({
			ok: true,
			value: { status: 202, headers: [], body: new Uint8Array([1]) },
		});

		expect(events).toContainEqual(["DATA", { kind: "attempt", value: "alpha", attempt: 1 }]);
		expect(events).toContainEqual([
			"DATA",
			{
				kind: "sent",
				value: "alpha",
				attempt: 1,
				result: { status: 202, headers: [], body: new Uint8Array([1]) },
			},
		]);
		expect(statuses.at(-1)).toEqual([
			"DATA",
			{ state: "succeeded", inFlight: 0, attempt: 1, sent: 1, failed: 0 },
		]);
		const snap = g.describe();
		expect(snap.edges).toContainEqual({ from: "source", to: "egress" });
		expect(snap.edges).toContainEqual({ from: "egress", to: "egress/status" });
	});

	it("closes the status ledger when a send capability is missing", () => {
		const g = graph();
		const source = g.node<string>([], null, { name: "source" });
		const bundle = toHttp(g, source, (value) => ({ method: "POST", url: "/events", body: value }), {
			name: "egress",
		});
		const events: unknown[] = [];
		const statuses: unknown[] = [];
		bundle.events.subscribe((msg) => events.push(msg));
		bundle.status.subscribe((msg) => statuses.push(msg));

		source.down([["DATA", "alpha"]]);

		expect(events).toContainEqual(["DATA", { kind: "attempt", value: "alpha", attempt: 1 }]);
		expect(events).toContainEqual([
			"DATA",
			{
				kind: "exhausted",
				value: "alpha",
				attempt: 1,
				error: "egress: missing environment driver capability",
			},
		]);
		expect(statuses).toContainEqual([
			"DATA",
			{ state: "exhausted", inFlight: 0, attempt: 1, sent: 0, failed: 1 },
		]);
	});

	it("does not retain cancel handles after a synchronous driver callback completes", () => {
		let canceled = 0;
		const http = {
			request(
				_request: HttpRequest,
				callback: (
					result: { ok: true; value: HttpResponse } | { ok: false; error: unknown },
				) => void,
			) {
				callback({ ok: true, value: { status: 204, headers: [] } });
				return () => {
					canceled++;
				};
			},
		};
		const g = graph({ environment: new EnvironmentDrivers({ http }) });
		const source = g.node<string>([], null, { name: "source" });
		const bundle = toHttp(g, source, (value) => ({ method: "POST", url: "/events", body: value }), {
			name: "egress",
		});
		const unsubscribe = bundle.events.subscribe(() => {});

		source.down([["DATA", "alpha"]]);
		unsubscribe();

		expect(canceled).toBe(0);
	});
});

describe("environment session adapters (D133)", () => {
	it("exposes a describe-visible WebSocket SessionBundle over command facts", () => {
		const connects: Array<{
			request: WebSocketRequest;
			callback: (event: WebSocketDriverEvent) => void;
		}> = [];
		const sends: Array<{
			request: WebSocketRequest;
			message: WebSocketSend;
			callback: (
				result: { ok: true; value: WebSocketSendResult } | { ok: false; error: unknown },
			) => void;
		}> = [];
		let canceled = 0;
		const closes: Array<{ code?: number; reason?: string }> = [];
		const websocket = {
			connectSession(request: WebSocketRequest, callback: (event: WebSocketDriverEvent) => void) {
				connects.push({ request, callback });
				const handle: WebSocketSessionHandle = {
					send(message, sendCallback) {
						sends.push({ request, message, callback: sendCallback });
						return () => {};
					},
					close(code, reason) {
						closes.push({ code, reason });
					},
					cancel() {
						canceled++;
					},
				};
				return handle;
			},
		};
		const g = graph({ environment: new EnvironmentDrivers({ websocket }) });
		const bundle = webSocketSession(g, { url: "ws://example.test/socket" }, { name: "session" });
		const inbound: unknown[] = [];
		const lifecycle: unknown[] = [];
		const statuses: unknown[] = [];
		const attempts: unknown[] = [];
		const errors: unknown[] = [];
		bundle.inbound.subscribe((msg) => inbound.push(msg));
		bundle.lifecycle.subscribe((msg) => lifecycle.push(msg));
		bundle.status.subscribe((msg) => statuses.push(msg));
		bundle.attempts.subscribe((msg) => attempts.push(msg));
		bundle.errors.subscribe((msg) => {
			if (msg[0] === "DATA") errors.push(msg);
		});

		bundle.start();
		connects[0]?.callback({ kind: "event", event: { kind: "open" } });
		bundle.send("hello");
		sends[0]?.callback({ ok: true, value: { sent: true } });
		connects[0]?.callback({ kind: "event", event: { kind: "text", data: "world" } });
		bundle.close(1000, "done");

		expect(connects.map((call) => call.request)).toEqual([{ url: "ws://example.test/socket" }]);
		expect(sends.map((call) => call.message)).toEqual([{ data: "hello" }]);
		expect(closes).toEqual([{ code: 1000, reason: "done" }]);
		expect(attempts).toContainEqual(["DATA", 1]);
		expect(lifecycle).toContainEqual(["DATA", { kind: "starting", attempt: 1, maxAttempts: 1 }]);
		expect(lifecycle).toContainEqual(["DATA", { kind: "open", attempt: 1 }]);
		expect(lifecycle).toContainEqual(["DATA", { kind: "sent", message: { data: "hello" } }]);
		expect(lifecycle).toContainEqual(["DATA", { kind: "closing", code: 1000, reason: "done" }]);
		expect(lifecycle).toContainEqual(["DATA", { kind: "closed", code: 1000, reason: "done" }]);
		expect(inbound).toContainEqual(["DATA", { kind: "text", data: "world" }]);
		expect(statuses.at(-1)).toEqual([
			"DATA",
			{
				state: "closed",
				attempt: 1,
				maxAttempts: 1,
				sent: 1,
				received: 1,
				errors: 0,
				lastDelayMs: undefined,
			},
		]);
		expect(errors).toEqual([]);
		expect(canceled).toBe(1);
		const snap = g.describe();
		expect(snap.nodes.map((node) => node.id).sort()).toEqual([
			"session/attempts",
			"session/command",
			"session/errors",
			"session/events",
			"session/inbound",
			"session/lifecycle",
			"session/status",
		]);
		expect(snap.edges).toContainEqual({ from: "session/command", to: "session/events" });
		expect(snap.edges).toContainEqual({ from: "session/events", to: "session/inbound" });
		expect(snap.edges).toContainEqual({ from: "session/events", to: "session/lifecycle" });
		expect(snap.edges).toContainEqual({ from: "session/events", to: "session/status" });
		expect(snap.edges).toContainEqual({ from: "session/events", to: "session/errors" });
		expect(snap.edges).toContainEqual({ from: "session/events", to: "session/attempts" });
	});

	it("keeps convenience start/send/close as command fact publishers", () => {
		const connects: WebSocketRequest[] = [];
		const websocket = {
			connectSession(request: WebSocketRequest, _callback: (event: WebSocketDriverEvent) => void) {
				connects.push(request);
				return {
					send() {
						return () => {};
					},
					close() {},
					cancel() {},
				} satisfies WebSocketSessionHandle;
			},
		};
		const g = graph({ environment: new EnvironmentDrivers({ websocket }) });
		const bundle = webSocketSession(g, { url: "ws://example.test/socket" }, { name: "session" });
		const commands: unknown[] = [];
		bundle.command.subscribe((msg) => {
			if (msg[0] === "DATA") commands.push(msg);
		});

		bundle.start();
		bundle.send({ data: "hello" });
		bundle.close(1001, "bye");

		expect(commands).toEqual([
			["DATA", { kind: "start" }],
			["DATA", { kind: "send", message: { data: "hello" } }],
			["DATA", { kind: "close", code: 1001, reason: "bye" }],
		]);
		expect(connects).toEqual([]);
	});

	it("surfaces bounded reconnect attempts, status, and errors", () => {
		vi.useFakeTimers();
		try {
			const boom = new Error("boom");
			const connects: Array<(event: WebSocketDriverEvent) => void> = [];
			const websocket = {
				connectSession(
					_request: WebSocketRequest,
					callback: (event: WebSocketDriverEvent) => void,
				) {
					connects.push(callback);
					if (connects.length === 1) callback({ kind: "error", error: boom });
					else callback({ kind: "event", event: { kind: "open" } });
					return {
						send() {
							return () => {};
						},
						close() {},
						cancel() {},
					} satisfies WebSocketSessionHandle;
				},
			};
			const g = graph({ environment: new EnvironmentDrivers({ websocket }) });
			const bundle = webSocketSession(
				g,
				{ url: "ws://example.test/socket" },
				{ name: "session", retry: retryPolicy(2, { kind: "constant", delayMs: 0 }) },
			);
			const attempts: unknown[] = [];
			const statuses: unknown[] = [];
			const errors: unknown[] = [];
			bundle.attempts.subscribe((msg) => attempts.push(msg));
			bundle.status.subscribe((msg) => statuses.push(msg));
			bundle.errors.subscribe((msg) => errors.push(msg));

			bundle.start();
			expect(connects).toHaveLength(1);
			expect(attempts).toContainEqual(["DATA", 1]);
			expect(errors).toContainEqual(["DATA", boom]);
			expect(statuses.at(-1)).toEqual([
				"DATA",
				{
					state: "waiting",
					attempt: 1,
					maxAttempts: 2,
					sent: 0,
					received: 0,
					errors: 1,
					lastDelayMs: 0,
				},
			]);

			vi.runOnlyPendingTimers();

			expect(connects).toHaveLength(2);
			expect(attempts).toContainEqual(["DATA", 2]);
			expect(statuses.at(-1)).toEqual([
				"DATA",
				{
					state: "open",
					attempt: 2,
					maxAttempts: 2,
					sent: 0,
					received: 0,
					errors: 1,
					lastDelayMs: undefined,
				},
			]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("suppresses late send callbacks after close", () => {
		let sendCallback:
			| ((result: { ok: true; value: WebSocketSendResult } | { ok: false; error: unknown }) => void)
			| undefined;
		const websocket = {
			connectSession(_request: WebSocketRequest, callback: (event: WebSocketDriverEvent) => void) {
				callback({ kind: "event", event: { kind: "open" } });
				return {
					send(_message, cb) {
						sendCallback = cb;
						return () => {};
					},
					close() {},
					cancel() {},
				} satisfies WebSocketSessionHandle;
			},
		};
		const g = graph({ environment: new EnvironmentDrivers({ websocket }) });
		const bundle = webSocketSession(g, { url: "ws://example.test/socket" }, { name: "session" });
		const lifecycle: unknown[] = [];
		const statuses: unknown[] = [];
		bundle.lifecycle.subscribe((msg) => lifecycle.push(msg));
		bundle.status.subscribe((msg) => statuses.push(msg));

		bundle.start();
		bundle.send("late");
		bundle.close(1000, "done");
		sendCallback?.({ ok: true, value: { sent: true } });

		expect(lifecycle).not.toContainEqual(["DATA", { kind: "sent", message: { data: "late" } }]);
		expect(statuses.at(-1)).toEqual([
			"DATA",
			{
				state: "closed",
				attempt: 1,
				maxAttempts: 1,
				sent: 0,
				received: 0,
				errors: 0,
				lastDelayMs: undefined,
			},
		]);
	});

	it("cleans up remote closes and does not classify normal close as an error", () => {
		let canceled = 0;
		let connectCallback: ((event: WebSocketDriverEvent) => void) | undefined;
		const websocket = {
			connectSession(_request: WebSocketRequest, callback: (event: WebSocketDriverEvent) => void) {
				connectCallback = callback;
				return {
					send() {
						return () => {};
					},
					close() {},
					cancel() {
						canceled++;
					},
				} satisfies WebSocketSessionHandle;
			},
		};
		const g = graph({ environment: new EnvironmentDrivers({ websocket }) });
		const bundle = webSocketSession(g, { url: "ws://example.test/socket" }, { name: "session" });
		const statuses: unknown[] = [];
		const errors: unknown[] = [];
		bundle.status.subscribe((msg) => statuses.push(msg));
		bundle.errors.subscribe((msg) => {
			if (msg[0] === "DATA") errors.push(msg);
		});

		bundle.start();
		connectCallback?.({ kind: "event", event: { kind: "open" } });
		connectCallback?.({ kind: "event", event: { kind: "close", code: 1000, reason: "ok" } });

		expect(canceled).toBe(1);
		expect(errors).toEqual([]);
		expect(statuses.at(-1)).toEqual([
			"DATA",
			{
				state: "closed",
				attempt: 1,
				maxAttempts: 1,
				sent: 0,
				received: 0,
				errors: 0,
				lastDelayMs: undefined,
			},
		]);
	});

	it("ignores explicit start while a retry timer is pending", () => {
		vi.useFakeTimers();
		try {
			const connects: Array<(event: WebSocketDriverEvent) => void> = [];
			const websocket = {
				connectSession(
					_request: WebSocketRequest,
					callback: (event: WebSocketDriverEvent) => void,
				) {
					connects.push(callback);
					if (connects.length === 1) callback({ kind: "error", error: "boom" });
					return {
						send() {
							return () => {};
						},
						close() {},
						cancel() {},
					} satisfies WebSocketSessionHandle;
				},
			};
			const g = graph({ environment: new EnvironmentDrivers({ websocket }) });
			const bundle = webSocketSession(
				g,
				{ url: "ws://example.test/socket" },
				{ name: "session", retry: retryPolicy(2, { kind: "constant", delayMs: 10 }) },
			);
			const attempts: unknown[] = [];
			bundle.attempts.subscribe((msg) => attempts.push(msg));

			bundle.start();
			bundle.start();
			expect(connects).toHaveLength(1);

			vi.advanceTimersByTime(10);

			expect(connects).toHaveLength(2);
			expect(attempts.filter((msg) => msg[0] === "DATA")).toEqual([
				["DATA", 1],
				["DATA", 2],
			]);
		} finally {
			vi.useRealTimers();
		}
	});
});
