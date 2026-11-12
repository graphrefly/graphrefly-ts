import { describe, expect, it, vi } from "vitest";
import {
	wireBridge,
	wireBridgeAckDriver,
	wireBridgeEnvelope,
	wireBridgeIdempotencyKey,
} from "../adapters/index.js";
import { graph } from "../graph/graph.js";
import { retryPolicy } from "../graph/resilience.js";
import { canonicalTupleKey } from "../identity.js";
import type { Message } from "../protocol/messages.js";

describe("wire bridge envelopes (D134)", () => {
	it("creates ordered, idempotent envelope metadata", () => {
		expect(wireBridgeIdempotencyKey("session-a", 7)).toBe(canonicalTupleKey(["session-a", "7"]));
		expect(
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "data",
				seq: 7,
				cursor: 3,
				payload: { kind: "data", value: { ok: true } },
				attempt: 2,
				maxAttempts: 4,
				requestId: "req-1",
			}),
		).toEqual({
			sessionId: "session-a",
			type: "data",
			payload: { kind: "data", value: { ok: true } },
			metadata: {
				seq: 7,
				cursor: 3,
				idempotencyKey: canonicalTupleKey(["session-a", "7"]),
				attempt: 2,
				maxAttempts: 4,
				timestampMs: undefined,
				ackForSeq: undefined,
				requestId: "req-1",
			},
		});
		expect(() => wireBridgeEnvelope({ sessionId: "session-a", type: "data", seq: 0 })).toThrow(
			/seq/,
		);
		expect(() => wireBridgeEnvelope({ sessionId: "session-a", type: "data", seq: 1 })).toThrow(
			/data envelope requires data payload/,
		);
		expect(() =>
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "error",
				seq: 1,
				payload: { kind: "data", value: "wrong" },
			}),
		).toThrow(/error envelope requires error payload/);
		expect(() =>
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "error",
				seq: 1,
				payload: { kind: "error" } as never,
			}),
		).toThrow(/error envelope requires error payload/);
		expect(() =>
			wireBridgeEnvelope({ sessionId: "session-a", type: "ack", seq: 1, ackForSeq: 0 }),
		).toThrow(/ackForSeq/);
		expect(() => wireBridgeEnvelope({ sessionId: "session-a", type: "ack", seq: 1 })).toThrow(
			/requires ackForSeq/,
		);
		expect(() =>
			wireBridgeEnvelope({ sessionId: "session-a", type: "unknown" as never, seq: 1 }),
		).toThrow(/type/);
		expect(() =>
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "data",
				seq: Number.MAX_SAFE_INTEGER + 1,
			}),
		).toThrow(/seq/);
	});

	it("enforces D559 wire-admissible payloads and copies mutable bytes", () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const envelope = wireBridgeEnvelope({
			sessionId: "session-a",
			type: "data",
			seq: 1,
			payload: { kind: "data", value: bytes },
		});
		bytes[0] = 9;
		expect(envelope.payload).toEqual({ kind: "data", value: new Uint8Array([1, 2, 3]) });
		expect(
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "data",
				seq: 1,
				payload: { kind: "data", value: { kind: "value", value: "plain-json" } },
			}).payload,
		).toEqual({ kind: "data", value: { kind: "value", value: "plain-json" } });

		const sparse: unknown[] = [];
		sparse[1] = "hole";
		const accessor = {};
		Object.defineProperty(accessor, "secret", { get: () => "nope", enumerable: true });
		const hidden = { ok: true };
		Object.defineProperty(hidden, "secret", { value: "nope", enumerable: false });
		const thenable = {};
		const thenKey = "th" + "en";
		Object.defineProperty(thenable, thenKey, { value: () => undefined, enumerable: true });
		// D803: an edge cause body that no receiver could release (R-bridge@1) is not admissible.
		const causeWithoutEdges = {
			kind: "edge_cause",
			cause: { group: "g", session: "s1", cause: 1, edges: [] },
		};
		const causeWithKernelMessage = {
			kind: "edge_cause",
			cause: {
				group: "g",
				session: "s1",
				cause: 1,
				edges: [{ edgeId: "x", arrays: [[["PENDING"], ["DATA", new Uint8Array([1])]]] }],
			},
		};
		const canonicalAccessor = {};
		Object.defineProperty(canonicalAccessor, "kind", {
			get: () => "edge_cause",
			enumerable: true,
		});
		Object.defineProperty(canonicalAccessor, "cause", { value: {}, enumerable: true });
		class HostObject {
			readonly ok = true;
		}
		const forbidden = [
			undefined,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			-0,
			Number.MIN_VALUE,
			Number.MAX_SAFE_INTEGER + 1,
			1n,
			Symbol("x"),
			() => undefined,
			accessor,
			new HostObject(),
			new Date(),
			new Map(),
			Promise.resolve("x"),
			thenable,
			sparse,
			hidden,
			causeWithoutEdges,
			causeWithKernelMessage,
			canonicalAccessor,
		];

		for (const value of forbidden) {
			expect(() =>
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 1,
					payload: { kind: "data", value },
				}),
			).toThrow(/wire-admissible payload|strict JSON|stableJsonString|invalid canonical wire DTO/);
		}

		expect(() =>
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "data",
				seq: 1,
				payload: 1 as never,
			}),
		).toThrow(/data envelope requires data payload/);
		const payloadAccessor = {};
		const getter = vi.fn(() => "data");
		Object.defineProperty(payloadAccessor, "kind", { get: getter, enumerable: true });
		Object.defineProperty(payloadAccessor, "value", { value: "ok", enumerable: true });
		expect(() =>
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "data",
				seq: 1,
				payload: payloadAccessor as never,
			}),
		).toThrow(/data envelope requires data payload/);
		expect(getter).not.toHaveBeenCalled();
	});

	it("emits close without an undefined reason payload", () => {
		const g = graph();
		const bridge = wireBridge(g, { name: "bridge", sessionId: "session-a" });
		const outbound: Message[] = [];
		const errors: unknown[] = [];
		bridge.outbound.subscribe((incoming) => {
			for (const msg of incoming) {
				outbound.push(msg);
			}
		});
		bridge.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});

		bridge.close();

		expect(errors.filter((msg) => Array.isArray(msg) && msg[0] === "DATA")).toEqual([]);
		expect(outbound.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				type: "close",
				payload: { kind: "close" },
			}),
		]);
	});

	it("surfaces invalid outbound payloads as bridge issues without protocol terminals", () => {
		const g = graph();
		const bridge = wireBridge(g, { name: "bridge", sessionId: "session-a" });
		const errors: unknown[] = [];
		const outbound: Message[] = [];
		bridge.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});
		bridge.outbound.subscribe((incoming) => {
			for (const msg of incoming) {
				outbound.push(msg);
			}
		});

		bridge.send({ socket: () => undefined });

		expect(outbound.filter((msg) => Array.isArray(msg) && msg[0] === "DATA")).toEqual([]);
		expect(errors).toContainEqual([
			"DATA",
			expect.stringMatching(
				/wire-admissible payload|strict JSON|stableJsonString|invalid canonical wire DTO/,
			),
		]);
		expect(bridge.errors.status.output).not.toBe("errored");
		expect(bridge.outbound.status.output).not.toBe("errored");
	});

	it("exposes command, outbound, inbound, ack, cursor, status, and error nodes in describe", () => {
		const g = graph();
		const bridge = wireBridge<{ task: string }, { ok: boolean }>(g, {
			name: "bridge",
			sessionId: "session-a",
		});
		const outbound: Message[] = [];
		const acks: unknown[] = [];
		const cursor: Message[] = [];
		const status: unknown[] = [];
		bridge.outbound.subscribe((incoming) => {
			for (const msg of incoming) {
				outbound.push(msg);
			}
		});
		bridge.acks.subscribe((incoming) => {
			for (const msg of incoming) {
				acks.push(msg);
			}
		});
		bridge.cursor.subscribe((incoming) => {
			for (const msg of incoming) {
				cursor.push(msg);
			}
		});
		bridge.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});

		bridge.send({ task: "compile" }, { requestId: "req-1" });
		bridge.inbound.set(
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "ack",
				seq: 1,
				cursor: 1,
				ackForSeq: 1,
			}),
		);

		expect(outbound).toContainEqual([
			"DATA",
			{
				sessionId: "session-a",
				type: "data",
				payload: { kind: "data", value: { task: "compile" } },
				metadata: {
					seq: 1,
					cursor: 0,
					idempotencyKey: canonicalTupleKey(["session-a", "1"]),
					attempt: 1,
					maxAttempts: 1,
					timestampMs: expect.any(Number),
					ackForSeq: undefined,
					requestId: "req-1",
				},
			},
		]);
		expect(acks).toContainEqual([
			"DATA",
			{
				ackForSeq: 1,
				envelope: wireBridgeEnvelope({
					sessionId: "session-a",
					type: "ack",
					seq: 1,
					cursor: 1,
					ackForSeq: 1,
				}),
			},
		]);
		expect(cursor).toContainEqual(["DATA", 1]);
		expect(status.at(-1)).toEqual([
			"DATA",
			{
				sessionId: "session-a",
				state: "open",
				cursor: 1,
				nextSeq: 2,
				pending: 0,
				attempts: 1,
				acked: 1,
				nacked: 0,
				errors: 0,
				lastSeq: 1,
			},
		]);
		const snap = g.inspect();
		expect(snap.nodes.map((node) => node.id).sort()).toEqual([
			"bridge/acks",
			"bridge/attempts",
			"bridge/command",
			"bridge/cursor",
			"bridge/errors",
			"bridge/events",
			"bridge/inbound",
			"bridge/nacks",
			"bridge/outbound",
			"bridge/status",
		]);
		expect(snap.edges).toContainEqual({ from: "bridge/command", to: "bridge/events" });
		expect(snap.edges).toContainEqual({ from: "bridge/inbound", to: "bridge/events" });
		expect(snap.edges).toContainEqual({ from: "bridge/events", to: "bridge/outbound" });
		expect(snap.edges).toContainEqual({ from: "bridge/events", to: "bridge/status" });
	});

	it("keeps convenience start/send/ack/nack/close as command fact publishers", () => {
		const g = graph();
		const bridge = wireBridge(g, { name: "bridge", sessionId: "session-a" });
		const commands: Message[] = [];
		bridge.command.subscribe((incoming) => {
			for (const msg of incoming) {
				if (msg[0] === "DATA") commands.push(msg);
			}
		});

		bridge.start();
		bridge.send("hello", { idempotencyKey: "custom", requestId: "req-1" });
		bridge.ack(3);
		bridge.nack(4, "bad");
		bridge.close("done");

		expect(commands).toEqual([
			["DATA", { kind: "start" }],
			["DATA", { kind: "send", payload: "hello", idempotencyKey: "custom", requestId: "req-1" }],
			["DATA", { kind: "ack", ackForSeq: 3, idempotencyKey: undefined, requestId: undefined }],
			[
				"DATA",
				{
					kind: "nack",
					ackForSeq: 4,
					error: "bad",
					idempotencyKey: undefined,
					requestId: undefined,
				},
			],
			["DATA", { kind: "close", reason: "done", idempotencyKey: undefined }],
		]);
	});

	it("does not mutate through a hidden ack timer when no driver command arrives (D502)", () => {
		vi.useFakeTimers();
		try {
			const g = graph();
			const bridge = wireBridge<string, unknown>(g, {
				name: "bridge",
				sessionId: "session-a",
				retry: retryPolicy(2, { kind: "constant", delayMs: 10 }),
				now: () => 1000,
			});
			const outbound: Message[] = [];
			const errors: unknown[] = [];
			const status: unknown[] = [];
			bridge.outbound.subscribe((incoming) => {
				for (const msg of incoming) {
					outbound.push(msg);
				}
			});
			bridge.errors.subscribe((incoming) => {
				for (const msg of incoming) {
					errors.push(msg);
				}
			});
			bridge.status.subscribe((incoming) => {
				for (const msg of incoming) {
					status.push(msg);
				}
			});

			bridge.send("payload");
			const beforeOutbound = [...outbound];
			const beforeErrors = [...errors];
			const beforeStatus = [...status];
			vi.advanceTimersByTime(60_000);

			expect(outbound).toEqual(beforeOutbound);
			expect(errors).toEqual(beforeErrors);
			expect(status).toEqual(beforeStatus);
		} finally {
			vi.useRealTimers();
		}
	});

	it("retries only a matching pending ack-timeout seq and attempt (D502)", () => {
		const g = graph();
		const bridge = wireBridge<string, unknown>(g, {
			name: "bridge",
			sessionId: "session-a",
			retry: retryPolicy(2, { kind: "constant", delayMs: 10 }),
			now: () => 1000,
		});
		const outbound: Message[] = [];
		const events: unknown[] = [];
		const status: unknown[] = [];
		bridge.outbound.subscribe((incoming) => {
			for (const msg of incoming) {
				outbound.push(msg);
			}
		});
		bridge.events.subscribe((incoming) => {
			for (const msg of incoming) {
				events.push(msg);
			}
		});
		bridge.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});

		bridge.send("payload");
		bridge.command.set({ kind: "ack-timeout", seq: 1, attempt: 2 });
		expect(outbound.filter((msg) => msg[0] === "DATA")).toHaveLength(1);
		expect(events).not.toContainEqual(["DATA", { kind: "timeout", seq: 1, attempt: 2 }]);

		bridge.command.set({ kind: "ack-timeout", seq: 1, attempt: 1 });

		expect(events).toContainEqual(["DATA", { kind: "timeout", seq: 1, attempt: 1 }]);
		expect(events).toContainEqual([
			"DATA",
			{
				kind: "retry",
				seq: 1,
				attempt: 2,
				delayMs: 10,
				error: "session-a: ack timeout for seq 1",
			},
		]);
		expect(outbound.filter((msg) => msg[0] === "DATA")).toEqual([
			[
				"DATA",
				expect.objectContaining({
					metadata: expect.objectContaining({ seq: 1, attempt: 1, maxAttempts: 2 }),
				}),
			],
			[
				"DATA",
				expect.objectContaining({
					metadata: expect.objectContaining({ seq: 1, attempt: 2, maxAttempts: 2 }),
				}),
			],
		]);
		expect(status.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				sessionId: "session-a",
				state: "open",
				pending: 1,
				attempts: 2,
				lastDelayMs: 10,
			}),
		]);
	});

	it("treats stale ack-timeout after ack as a fail-closed no-op (D502)", () => {
		const g = graph();
		const bridge = wireBridge<string, unknown>(g, {
			name: "bridge",
			sessionId: "session-a",
			retry: retryPolicy(2, { kind: "constant", delayMs: 10 }),
		});
		const outbound: Message[] = [];
		const events: unknown[] = [];
		bridge.outbound.subscribe((incoming) => {
			for (const msg of incoming) {
				outbound.push(msg);
			}
		});
		bridge.events.subscribe((incoming) => {
			for (const msg of incoming) {
				events.push(msg);
			}
		});

		bridge.send("payload");
		bridge.inbound.set(
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "ack",
				seq: 1,
				ackForSeq: 1,
			}),
		);
		bridge.command.set({ kind: "ack-timeout", seq: 1, attempt: 1 });

		expect(outbound.filter((msg) => msg[0] === "DATA")).toHaveLength(1);
		expect(events).not.toContainEqual(["DATA", { kind: "timeout", seq: 1, attempt: 1 }]);
	});

	it("surfaces malformed ack-timeout commands as invalid facts without protocol terminals (D502)", () => {
		const g = graph();
		const bridge = wireBridge<string, unknown>(g, { name: "bridge", sessionId: "session-a" });
		const errors: unknown[] = [];
		bridge.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});

		bridge.command.set({ kind: "ack-timeout", seq: 1, attempt: 0 } as never);

		expect(errors).toContainEqual([
			"DATA",
			"wireBridge: ack-timeout command attempt must be a positive integer",
		]);
		expect(bridge.events.status.output).not.toBe("errored");
		expect(bridge.status.status.output).not.toBe("errored");
	});

	it("keeps retry exhaustion graph-visible for matching ack-timeout commands (D502)", () => {
		const g = graph();
		const bridge = wireBridge<string, unknown>(g, {
			name: "bridge",
			sessionId: "session-a",
			retry: retryPolicy(1, { kind: "constant", delayMs: 10 }),
		});
		const errors: unknown[] = [];
		const status: unknown[] = [];
		const events: unknown[] = [];
		bridge.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});
		bridge.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});
		bridge.events.subscribe((incoming) => {
			for (const msg of incoming) {
				events.push(msg);
			}
		});

		bridge.send("payload");
		bridge.command.set({ kind: "ack-timeout", seq: 1, attempt: 1 });

		expect(events).toContainEqual(["DATA", { kind: "timeout", seq: 1, attempt: 1 }]);
		expect(errors).toContainEqual(["DATA", "session-a: ack timeout for seq 1"]);
		expect(status.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				sessionId: "session-a",
				state: "exhausted",
				pending: 0,
				errors: 1,
				lastSeq: 1,
			}),
		]);
		expect(bridge.events.status.output).not.toBe("errored");
		expect(bridge.status.status.output).not.toBe("errored");
	});

	it("derives ack-timeout commands from graph-visible clock facts and declared deps (D502)", () => {
		const g = graph();
		const clock = g.node<number>([], null, { name: "clock" });
		const bridge = wireBridge<string, unknown>(g, {
			name: "bridge",
			sessionId: "session-a",
			retry: retryPolicy(2, { kind: "constant", delayMs: 10 }),
		});
		const driver = wireBridgeAckDriver(g, bridge, { name: "ackDriver", clock, timeoutMs: 5 });
		const commands: Message[] = [];
		const outbound: Message[] = [];
		const driverStatus: unknown[] = [];
		driver.commands.subscribe((incoming) => {
			for (const msg of incoming) {
				commands.push(msg);
			}
		});
		driver.status.subscribe((incoming) => {
			for (const msg of incoming) {
				driverStatus.push(msg);
			}
		});
		bridge.outbound.subscribe((incoming) => {
			for (const msg of incoming) {
				outbound.push(msg);
			}
		});

		clock.set(1000);
		bridge.send("payload");
		clock.set(1004);
		expect(commands.filter((msg) => msg[0] === "DATA")).toEqual([]);

		clock.set(1005);

		expect(commands).toContainEqual([
			"DATA",
			{ kind: "ack-timeout", seq: 1, attempt: 1, observedAtMs: 1005 },
		]);
		expect(outbound.filter((msg) => msg[0] === "DATA")).toHaveLength(1);
		expect(driverStatus).toContainEqual([
			"DATA",
			expect.objectContaining({
				state: "timed-out",
				pending: 1,
				commands: 1,
				nowMs: 1005,
			}),
		]);
		bridge.command.set({ kind: "ack-timeout", seq: 1, attempt: 1, observedAtMs: 1005 });
		expect(outbound.filter((msg) => msg[0] === "DATA")).toHaveLength(1);
		clock.set(1014);
		expect(commands.filter((msg) => msg[0] === "DATA")).toHaveLength(1);
		clock.set(1015);
		expect(commands).toContainEqual([
			"DATA",
			{ kind: "ack-timeout", seq: 1, attempt: 1, observedAtMs: 1015 },
		]);
		bridge.command.set({ kind: "ack-timeout", seq: 1, attempt: 1, observedAtMs: 1015 });
		expect(outbound.filter((msg) => msg[0] === "DATA")).toHaveLength(2);
		const snap = g.inspect();
		expect(snap.edges).toContainEqual({ from: "clock", to: "ackDriver/events" });
		expect(snap.edges).toContainEqual({ from: "bridge/attempts", to: "ackDriver/events" });
		expect(snap.edges).toContainEqual({ from: "bridge/acks", to: "ackDriver/events" });
		expect(snap.edges).toContainEqual({ from: "bridge/nacks", to: "ackDriver/events" });
		expect(snap.edges).toContainEqual({ from: "bridge/status", to: "ackDriver/events" });
		expect(snap.edges).toContainEqual({ from: "ackDriver/events", to: "ackDriver/commands" });
		expect(snap.edges).not.toContainEqual({ from: "ackDriver/commands", to: "bridge/command" });
	});

	it("keeps stale explicit ack-timeout ingress as a bridge no-op after ack (D502)", () => {
		const g = graph();
		const clock = g.node<number>([], null, { name: "clock" });
		const bridge = wireBridge<string, unknown>(g, {
			name: "bridge",
			sessionId: "session-a",
			retry: retryPolicy(2, { kind: "constant", delayMs: 10 }),
		});
		const driver = wireBridgeAckDriver(g, bridge, { name: "ackDriver", clock, timeoutMs: 5 });
		const commands: Message[] = [];
		const outbound: Message[] = [];
		driver.commands.subscribe((incoming) => {
			for (const msg of incoming) {
				commands.push(msg);
			}
		});
		bridge.outbound.subscribe((incoming) => {
			for (const msg of incoming) {
				outbound.push(msg);
			}
		});

		clock.set(1000);
		bridge.send("payload");
		g.batch(() => {
			clock.set(1005);
			bridge.inbound.set(
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "ack",
					seq: 1,
					ackForSeq: 1,
				}),
			);
		});

		// The clock tick and the ack commit as one wave (R-request-order), so the ack driver runs
		// once on both and sends no timeout; a stale ack-timeout injected afterwards is a no-op.
		expect(commands).not.toContainEqual([
			"DATA",
			{ kind: "ack-timeout", seq: 1, attempt: 1, observedAtMs: 1005 },
		]);
		bridge.command.set({ kind: "ack-timeout", seq: 1, attempt: 1, observedAtMs: 1005 });
		expect(outbound.filter((msg) => msg[0] === "DATA")).toHaveLength(1);
	});

	it("releases the ack driver topology so late clocks cannot derive retry commands (D502)", () => {
		const g = graph();
		const clock = g.node<number>([], null, { name: "clock" });
		const bridge = wireBridge<string, unknown>(g, {
			name: "bridge",
			sessionId: "session-a",
			retry: retryPolicy(2, { kind: "constant", delayMs: 10 }),
		});
		const driver = wireBridgeAckDriver(g, bridge, { name: "ackDriver", clock, timeoutMs: 5 });
		const outbound: Message[] = [];
		const commands: Message[] = [];
		const unsubscribe = driver.commands.subscribe((incoming) => {
			for (const msg of incoming) {
				commands.push(msg);
			}
		});
		bridge.outbound.subscribe((incoming) => {
			for (const msg of incoming) {
				outbound.push(msg);
			}
		});

		clock.set(1000);
		bridge.send("payload");
		unsubscribe();
		driver.release();
		clock.set(1005);

		expect(commands.filter((msg) => msg[0] === "DATA")).toEqual([]);
		expect(g.inspect().edges).not.toContainEqual({ from: "clock", to: "ackDriver/events" });
		expect(g.inspect().edges).not.toContainEqual({
			from: "ackDriver/commands",
			to: "bridge/command",
		});
		expect(outbound.filter((msg) => msg[0] === "DATA")).toHaveLength(1);
	});

	it("close clears pending bridge status without emitting protocol terminal state", () => {
		const g = graph();
		const bridge = wireBridge<string, unknown>(g, { name: "bridge", sessionId: "session-a" });
		const status: unknown[] = [];
		bridge.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});

		bridge.send("payload");
		bridge.close("done");

		expect(status.at(-1)).toEqual([
			"DATA",
			{
				sessionId: "session-a",
				state: "closed",
				cursor: 0,
				nextSeq: 3,
				pending: 1,
				attempts: 2,
				acked: 0,
				nacked: 0,
				errors: 0,
				lastSeq: 2,
			},
		]);
		bridge.inbound.set(
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "ack",
				seq: 1,
				ackForSeq: 2,
			}),
		);
		expect(status.at(-1)).toEqual([
			"DATA",
			{
				sessionId: "session-a",
				state: "closed",
				cursor: 1,
				nextSeq: 3,
				pending: 0,
				attempts: 2,
				acked: 1,
				nacked: 0,
				errors: 0,
				lastSeq: 1,
			},
		]);
	});

	it("rejects inbound envelopes from a different bridge session without advancing cursor", () => {
		const g = graph();
		const bridge = wireBridge(g, { name: "bridge", sessionId: "session-a" });
		const errors: unknown[] = [];
		const cursor: Message[] = [];
		const status: unknown[] = [];
		bridge.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});
		bridge.cursor.subscribe((incoming) => {
			for (const msg of incoming) {
				cursor.push(msg);
			}
		});
		bridge.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});

		bridge.inbound.set(
			wireBridgeEnvelope({
				sessionId: "session-b",
				type: "data",
				seq: 1,
				payload: { kind: "data", value: "wrong-session" },
			}),
		);
		bridge.inbound.set(
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "data",
				seq: 1,
				payload: { kind: "data", value: "right-session" },
			}),
		);

		expect(errors).toContainEqual([
			"DATA",
			"bridge: inbound session session-b did not match expected session-a",
		]);
		expect(cursor).toContainEqual(["DATA", 1]);
		expect(status.at(-1)).toEqual([
			"DATA",
			{
				sessionId: "session-a",
				state: "errored",
				cursor: 1,
				nextSeq: 1,
				pending: 0,
				attempts: 0,
				acked: 0,
				nacked: 0,
				errors: 1,
			},
		]);
	});

	it("rejects malformed inbound metadata before it can poison the cursor", () => {
		const g = graph();
		const bridge = wireBridge(g, { name: "bridge", sessionId: "session-a" });
		const errors: unknown[] = [];
		const cursor: Message[] = [];
		bridge.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});
		bridge.cursor.subscribe((incoming) => {
			for (const msg of incoming) {
				cursor.push(msg);
			}
		});

		bridge.inbound.set({
			sessionId: "session-a",
			type: "data",
			payload: { kind: "data", value: "bad" },
			metadata: {
				seq: Number.NaN,
				cursor: 0,
				idempotencyKey: "bad",
				attempt: 1,
				maxAttempts: 1,
			},
		} as never);
		bridge.inbound.set(
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "data",
				seq: 1,
				payload: { kind: "data", value: "good" },
			}),
		);

		expect(errors).toContainEqual([
			"DATA",
			"wireBridge: inbound envelope seq must be a positive integer",
		]);
		expect(cursor).toContainEqual(["DATA", 1]);
	});

	it("treats raw inbound protocol ERROR as local misuse without poisoning later inbound facts", () => {
		const g = graph();
		const bridge = wireBridge(g, { name: "bridge", sessionId: "session-a" });
		const errors: unknown[] = [];
		const cursor: Message[] = [];
		bridge.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});
		bridge.cursor.subscribe((incoming) => {
			for (const msg of incoming) {
				cursor.push(msg);
			}
		});

		bridge.inbound.error("remote protocol error");
		bridge.inbound.set(
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "data",
				seq: 1,
				payload: { kind: "data", value: "still-live" },
			}),
		);

		expect(errors).toContainEqual([
			"DATA",
			"session-a: inbound protocol ERROR remote protocol error is local misuse; remote errors must arrive as DATA envelope facts",
		]);
		expect(cursor).toContainEqual(["DATA", 1]);
		expect(bridge.events.status.output).not.toBe("errored");
		expect(bridge.status.status.output).not.toBe("errored");
	});

	it("treats remote error and out-of-order receipt as inbound facts, not local terminal errors", () => {
		const g = graph();
		const bridge = wireBridge(g, { name: "bridge", sessionId: "session-a" });
		const events: unknown[] = [];
		const errors: unknown[] = [];
		const status: unknown[] = [];
		bridge.events.subscribe((incoming) => {
			for (const msg of incoming) {
				events.push(msg);
			}
		});
		bridge.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});
		bridge.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});

		bridge.inbound.set(
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "error",
				seq: 2,
				payload: { kind: "error", error: "remote failed" },
			}),
		);
		bridge.inbound.set(
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "error",
				seq: 1,
				payload: { kind: "error", error: "remote failed" },
			}),
		);

		expect(events).toContainEqual(["DATA", { kind: "out-of-order", seq: 2, expected: 1 }]);
		expect(errors).toContainEqual(["DATA", "bridge: inbound seq 2 arrived before expected seq 1"]);
		expect(errors).toContainEqual(["DATA", "remote failed"]);
		expect(status.at(-1)).toEqual([
			"DATA",
			{
				sessionId: "session-a",
				state: "errored",
				cursor: 1,
				nextSeq: 1,
				pending: 0,
				attempts: 0,
				acked: 0,
				nacked: 0,
				errors: 2,
				lastSeq: 1,
			},
		]);
		expect(bridge.status.status.output).not.toBe("errored");
	});

	it("requires ackForSeq on inbound ack/nack before advancing cursor", () => {
		const g = graph();
		const bridge = wireBridge<string, unknown>(g, { name: "bridge", sessionId: "session-a" });
		const errors: unknown[] = [];
		const cursor: Message[] = [];
		bridge.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});
		bridge.cursor.subscribe((incoming) => {
			for (const msg of incoming) {
				cursor.push(msg);
			}
		});

		bridge.send("payload");
		bridge.inbound.set({
			sessionId: "session-a",
			type: "ack",
			metadata: {
				seq: 1,
				cursor: 0,
				idempotencyKey: "bad-ack",
				attempt: 1,
				maxAttempts: 1,
			},
		} as never);
		bridge.inbound.set(
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "ack",
				seq: 1,
				ackForSeq: 1,
			}),
		);

		expect(errors).toContainEqual(["DATA", "wireBridge: inbound ack envelope requires ackForSeq"]);
		expect(cursor).toContainEqual(["DATA", 1]);
	});

	it("treats idempotencyKey as metadata and correlates receipts by ackForSeq (D151)", () => {
		const g = graph();
		const bridge = wireBridge<string, string>(g, { name: "bridge", sessionId: "session-a" });
		const events: unknown[] = [];
		const acks: unknown[] = [];
		const cursor: Message[] = [];
		const status: unknown[] = [];
		bridge.events.subscribe((incoming) => {
			for (const msg of incoming) {
				events.push(msg);
			}
		});
		bridge.acks.subscribe((incoming) => {
			for (const msg of incoming) {
				acks.push(msg);
			}
		});
		bridge.cursor.subscribe((incoming) => {
			for (const msg of incoming) {
				cursor.push(msg);
			}
		});
		bridge.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});

		bridge.send("first", { idempotencyKey: "same-key" });
		bridge.send("second", { idempotencyKey: "same-key" });
		bridge.inbound.set(
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "data",
				seq: 1,
				payload: { kind: "data", value: "remote-one" },
				idempotencyKey: "same-key",
			}),
		);
		bridge.inbound.set(
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "data",
				seq: 2,
				payload: { kind: "data", value: "remote-two" },
				idempotencyKey: "same-key",
			}),
		);
		bridge.inbound.set(
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "ack",
				seq: 3,
				ackForSeq: 2,
				idempotencyKey: "different-correlation-key",
			}),
		);

		expect(
			events.filter(
				(msg) =>
					(msg as unknown[])[0] === "DATA" &&
					((msg as unknown[])[1] as { kind?: string }).kind === "duplicate",
			),
		).toEqual([]);
		expect(cursor.filter((msg) => msg[0] === "DATA")).toEqual([
			["DATA", 1],
			["DATA", 2],
			["DATA", 3],
		]);
		expect(acks.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				ackForSeq: 2,
				envelope: expect.objectContaining({
					metadata: expect.objectContaining({
						ackForSeq: 2,
						idempotencyKey: "different-correlation-key",
					}),
				}),
			}),
		]);
		expect(status.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ pending: 1, acked: 1, cursor: 3, lastSeq: 3 }),
		]);
	});

	it("rejects inbound cursor regression before accepting the envelope", () => {
		const g = graph();
		const bridge = wireBridge(g, { name: "bridge", sessionId: "session-a" });
		const errors: unknown[] = [];
		const cursor: Message[] = [];
		bridge.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});
		bridge.cursor.subscribe((incoming) => {
			for (const msg of incoming) {
				cursor.push(msg);
			}
		});

		bridge.inbound.set(
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "data",
				seq: 1,
				cursor: 3,
				payload: { kind: "data", value: "one" },
			}),
		);
		bridge.inbound.set(
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "data",
				seq: 2,
				cursor: 2,
				payload: { kind: "data", value: "two" },
			}),
		);

		expect(errors).toContainEqual(["DATA", "session-a: inbound cursor 2 regressed below 3"]);
		expect(cursor.filter((msg) => msg[0] === "DATA")).toEqual([["DATA", 1]]);
	});

	it("updates status for a remote error envelope without protocol terminalizing locally", () => {
		const g = graph();
		const bridge = wireBridge(g, { name: "bridge", sessionId: "session-a" });
		const errors: unknown[] = [];
		const status: unknown[] = [];
		bridge.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});
		bridge.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});

		bridge.inbound.set(
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "error",
				seq: 1,
				payload: { kind: "error", error: "remote failed" },
			}),
		);

		expect(errors).toContainEqual(["DATA", "remote failed"]);
		expect(status.at(-1)).toEqual([
			"DATA",
			{
				sessionId: "session-a",
				state: "errored",
				cursor: 1,
				nextSeq: 1,
				pending: 0,
				attempts: 0,
				acked: 0,
				nacked: 0,
				errors: 1,
				lastSeq: 1,
			},
		]);
		expect(bridge.status.status.output).not.toBe("errored");
	});

	it("surfaces malformed command facts without treating them as close", () => {
		const g = graph();
		const bridge = wireBridge(g, { name: "bridge", sessionId: "session-a" });
		const outbound: Message[] = [];
		const errors: unknown[] = [];
		bridge.outbound.subscribe((incoming) => {
			for (const msg of incoming) {
				outbound.push(msg);
			}
		});
		bridge.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				errors.push(msg);
			}
		});

		bridge.command.set({ kind: "wat" } as never);
		bridge.command.set({ kind: "ack", ackForSeq: 0 } as never);
		bridge.command.set({ kind: "send", payload: "ok", idempotencyKey: "" } as never);
		bridge.send("after-invalid");

		expect(errors).toContainEqual(["DATA", "wireBridge: command kind is not recognized"]);
		expect(errors).toContainEqual([
			"DATA",
			"wireBridge: ack command ackForSeq must be a positive integer",
		]);
		expect(errors).toContainEqual([
			"DATA",
			"wireBridgeEnvelope: idempotencyKey must be a non-empty string",
		]);
		expect(outbound.filter((msg) => msg[0] === "DATA")).toEqual([
			[
				"DATA",
				{
					sessionId: "session-a",
					type: "data",
					payload: { kind: "data", value: "after-invalid" },
					metadata: {
						seq: 1,
						cursor: 0,
						idempotencyKey: canonicalTupleKey(["session-a", "1"]),
						attempt: 1,
						maxAttempts: 1,
						timestampMs: expect.any(Number),
						ackForSeq: undefined,
						requestId: undefined,
					},
				},
			],
		]);
	});

	it("handles every command sent while nothing subscribes (Q13)", () => {
		const g = graph();
		const bridge = wireBridge<string, unknown>(g, { name: "bridge", sessionId: "session-a" });
		bridge.send("first");
		bridge.send("second");
		const outbound: unknown[] = [];
		bridge.outbound.subscribe((incoming) => {
			for (const m of incoming) if (m[0] === "DATA") outbound.push(m[1]);
		});
		// The snapshot is the last envelope; it is the second, so the first was handled too.
		expect(outbound.at(-1)).toMatchObject({
			payload: { kind: "data", value: "second" },
			metadata: { seq: 2 },
		});
	});
});
