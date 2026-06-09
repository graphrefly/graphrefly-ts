import { describe, expect, it, vi } from "vitest";
import {
	remoteCall,
	remoteResponder,
	remoteResponderHandler,
	wireBridge,
	wireBridgeEnvelope,
	wireBridgeIdempotencyKey,
} from "../adapters/index.js";
import { graph } from "../graph/graph.js";
import { retryPolicy } from "../graph/resilience.js";
import { batch } from "../index.js";

describe("wire bridge envelopes (D134)", () => {
	it("creates ordered, idempotent envelope metadata", () => {
		expect(wireBridgeIdempotencyKey("session-a", 7)).toBe("session-a:7");
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
				idempotencyKey: "session-a:7",
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

	it("exposes command, outbound, inbound, ack, cursor, status, and error nodes in describe", () => {
		const g = graph();
		const bridge = wireBridge<{ task: string }, { ok: boolean }>(g, {
			name: "bridge",
			sessionId: "session-a",
		});
		const outbound: unknown[] = [];
		const acks: unknown[] = [];
		const cursor: unknown[] = [];
		const status: unknown[] = [];
		bridge.outbound.subscribe((msg) => outbound.push(msg));
		bridge.acks.subscribe((msg) => acks.push(msg));
		bridge.cursor.subscribe((msg) => cursor.push(msg));
		bridge.status.subscribe((msg) => status.push(msg));

		bridge.send({ task: "compile" }, { requestId: "req-1" });
		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "ack",
					seq: 1,
					cursor: 1,
					ackForSeq: 1,
				}),
			],
		]);

		expect(outbound).toContainEqual([
			"DATA",
			{
				sessionId: "session-a",
				type: "data",
				payload: { kind: "data", value: { task: "compile" } },
				metadata: {
					seq: 1,
					cursor: 0,
					idempotencyKey: "session-a:1",
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
		const snap = g.describe();
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
		const commands: unknown[] = [];
		bridge.command.subscribe((msg) => {
			if (msg[0] === "DATA") commands.push(msg);
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

	it("retries a data envelope on ack timeout and exhausts through graph-visible facts", () => {
		vi.useFakeTimers();
		try {
			const g = graph();
			const bridge = wireBridge<string, unknown>(g, {
				name: "bridge",
				sessionId: "session-a",
				retry: retryPolicy(2, { kind: "constant", delayMs: 10 }),
				ackTimeoutMs: 5,
				now: () => 1000,
			});
			const outbound: unknown[] = [];
			const attempts: unknown[] = [];
			const errors: unknown[] = [];
			const status: unknown[] = [];
			bridge.outbound.subscribe((msg) => outbound.push(msg));
			bridge.attempts.subscribe((msg) => attempts.push(msg));
			bridge.errors.subscribe((msg) => errors.push(msg));
			bridge.status.subscribe((msg) => status.push(msg));

			bridge.send("payload");
			vi.advanceTimersByTime(5);
			expect(outbound.filter((msg) => msg[0] === "DATA")).toHaveLength(1);
			expect(status.at(-1)).toEqual([
				"DATA",
				{
					sessionId: "session-a",
					state: "waiting",
					cursor: 0,
					nextSeq: 2,
					pending: 1,
					attempts: 1,
					acked: 0,
					nacked: 0,
					errors: 0,
					lastSeq: 1,
					lastDelayMs: 10,
				},
			]);
			vi.advanceTimersByTime(10);
			vi.advanceTimersByTime(5);

			expect(outbound.filter((msg) => msg[0] === "DATA")).toEqual([
				[
					"DATA",
					{
						sessionId: "session-a",
						type: "data",
						payload: { kind: "data", value: "payload" },
						metadata: {
							seq: 1,
							cursor: 0,
							idempotencyKey: "session-a:1",
							attempt: 1,
							maxAttempts: 2,
							timestampMs: 1000,
							ackForSeq: undefined,
							requestId: undefined,
						},
					},
				],
				[
					"DATA",
					{
						sessionId: "session-a",
						type: "data",
						payload: { kind: "data", value: "payload" },
						metadata: {
							seq: 1,
							cursor: 0,
							idempotencyKey: "session-a:1",
							attempt: 2,
							maxAttempts: 2,
							timestampMs: 1000,
							ackForSeq: undefined,
							requestId: undefined,
						},
					},
				],
			]);
			expect(attempts.filter((msg) => msg[0] === "DATA")).toEqual([
				["DATA", { seq: 1, attempt: 1, maxAttempts: 2 }],
				["DATA", { seq: 1, attempt: 2, maxAttempts: 2 }],
			]);
			expect(errors).toContainEqual(["DATA", "session-a: ack timeout for seq 1"]);
			expect(status.at(-1)).toEqual([
				"DATA",
				{
					sessionId: "session-a",
					state: "exhausted",
					cursor: 0,
					nextSeq: 2,
					pending: 0,
					attempts: 2,
					acked: 0,
					nacked: 0,
					errors: 1,
					lastSeq: 1,
					lastDelayMs: 10,
				},
			]);
			bridge.inbound.down([
				[
					"DATA",
					wireBridgeEnvelope({
						sessionId: "session-a",
						type: "ack",
						seq: 1,
						ackForSeq: 1,
					}),
				],
			]);
			expect(errors).toContainEqual([
				"DATA",
				"bridge: late ack for unknown or completed ackForSeq 1",
			]);
			expect(status.at(-1)).toEqual([
				"DATA",
				{
					sessionId: "session-a",
					state: "errored",
					cursor: 1,
					nextSeq: 2,
					pending: 0,
					attempts: 2,
					acked: 0,
					nacked: 0,
					errors: 2,
					lastSeq: 1,
					lastDelayMs: 10,
				},
			]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("close clears pending bridge status without emitting protocol terminal state", () => {
		const g = graph();
		const bridge = wireBridge<string, unknown>(g, { name: "bridge", sessionId: "session-a" });
		const status: unknown[] = [];
		bridge.status.subscribe((msg) => status.push(msg));

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
		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "ack",
					seq: 1,
					ackForSeq: 2,
				}),
			],
		]);
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
		const cursor: unknown[] = [];
		const status: unknown[] = [];
		bridge.errors.subscribe((msg) => errors.push(msg));
		bridge.cursor.subscribe((msg) => cursor.push(msg));
		bridge.status.subscribe((msg) => status.push(msg));

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-b",
					type: "data",
					seq: 1,
					payload: { kind: "data", value: "wrong-session" },
				}),
			],
		]);
		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 1,
					payload: { kind: "data", value: "right-session" },
				}),
			],
		]);

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
		const cursor: unknown[] = [];
		bridge.errors.subscribe((msg) => errors.push(msg));
		bridge.cursor.subscribe((msg) => cursor.push(msg));

		bridge.inbound.down([
			[
				"DATA",
				{
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
				} as never,
			],
		]);
		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 1,
					payload: { kind: "data", value: "good" },
				}),
			],
		]);

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
		const cursor: unknown[] = [];
		bridge.errors.subscribe((msg) => errors.push(msg));
		bridge.cursor.subscribe((msg) => cursor.push(msg));

		bridge.inbound.down([["ERROR", "remote protocol error"]]);
		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 1,
					payload: { kind: "data", value: "still-live" },
				}),
			],
		]);

		expect(errors).toContainEqual([
			"DATA",
			"session-a: inbound protocol ERROR remote protocol error is local misuse; remote errors must arrive as DATA envelope facts",
		]);
		expect(cursor).toContainEqual(["DATA", 1]);
		expect(bridge.events.status).not.toBe("errored");
		expect(bridge.status.status).not.toBe("errored");
	});

	it("treats remote error and out-of-order receipt as inbound facts, not local terminal errors", () => {
		const g = graph();
		const bridge = wireBridge(g, { name: "bridge", sessionId: "session-a" });
		const events: unknown[] = [];
		const errors: unknown[] = [];
		const status: unknown[] = [];
		bridge.events.subscribe((msg) => events.push(msg));
		bridge.errors.subscribe((msg) => errors.push(msg));
		bridge.status.subscribe((msg) => status.push(msg));

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "error",
					seq: 2,
					payload: { kind: "error", error: "remote failed" },
				}),
			],
		]);
		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "error",
					seq: 1,
					payload: { kind: "error", error: "remote failed" },
				}),
			],
		]);

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
		expect(bridge.status.status).not.toBe("errored");
	});

	it("requires ackForSeq on inbound ack/nack before advancing cursor", () => {
		const g = graph();
		const bridge = wireBridge<string, unknown>(g, { name: "bridge", sessionId: "session-a" });
		const errors: unknown[] = [];
		const cursor: unknown[] = [];
		bridge.errors.subscribe((msg) => errors.push(msg));
		bridge.cursor.subscribe((msg) => cursor.push(msg));

		bridge.send("payload");
		bridge.inbound.down([
			[
				"DATA",
				{
					sessionId: "session-a",
					type: "ack",
					metadata: {
						seq: 1,
						cursor: 0,
						idempotencyKey: "bad-ack",
						attempt: 1,
						maxAttempts: 1,
					},
				} as never,
			],
		]);
		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "ack",
					seq: 1,
					ackForSeq: 1,
				}),
			],
		]);

		expect(errors).toContainEqual(["DATA", "wireBridge: inbound ack envelope requires ackForSeq"]);
		expect(cursor).toContainEqual(["DATA", 1]);
	});

	it("treats idempotencyKey as metadata and correlates receipts by ackForSeq (D151)", () => {
		const g = graph();
		const bridge = wireBridge<string, string>(g, { name: "bridge", sessionId: "session-a" });
		const events: unknown[] = [];
		const acks: unknown[] = [];
		const cursor: unknown[] = [];
		const status: unknown[] = [];
		bridge.events.subscribe((msg) => events.push(msg));
		bridge.acks.subscribe((msg) => acks.push(msg));
		bridge.cursor.subscribe((msg) => cursor.push(msg));
		bridge.status.subscribe((msg) => status.push(msg));

		bridge.send("first", { idempotencyKey: "same-key" });
		bridge.send("second", { idempotencyKey: "same-key" });
		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 1,
					payload: { kind: "data", value: "remote-one" },
					idempotencyKey: "same-key",
				}),
			],
		]);
		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 2,
					payload: { kind: "data", value: "remote-two" },
					idempotencyKey: "same-key",
				}),
			],
		]);
		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "ack",
					seq: 3,
					ackForSeq: 2,
					idempotencyKey: "different-correlation-key",
				}),
			],
		]);

		expect(
			events.filter(
				(msg) =>
					(msg as unknown[])[0] === "DATA" &&
					((msg as unknown[])[1] as { kind?: string }).kind === "duplicate",
			),
		).toEqual([]);
		expect(cursor.filter((msg) => (msg as unknown[])[0] === "DATA")).toEqual([
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
		const cursor: unknown[] = [];
		bridge.errors.subscribe((msg) => errors.push(msg));
		bridge.cursor.subscribe((msg) => cursor.push(msg));

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 1,
					cursor: 3,
					payload: { kind: "data", value: "one" },
				}),
			],
		]);
		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 2,
					cursor: 2,
					payload: { kind: "data", value: "two" },
				}),
			],
		]);

		expect(errors).toContainEqual(["DATA", "session-a: inbound cursor 2 regressed below 3"]);
		expect(cursor.filter((msg) => msg[0] === "DATA")).toEqual([["DATA", 1]]);
	});

	it("updates status for a remote error envelope without protocol terminalizing locally", () => {
		const g = graph();
		const bridge = wireBridge(g, { name: "bridge", sessionId: "session-a" });
		const errors: unknown[] = [];
		const status: unknown[] = [];
		bridge.errors.subscribe((msg) => errors.push(msg));
		bridge.status.subscribe((msg) => status.push(msg));

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "error",
					seq: 1,
					payload: { kind: "error", error: "remote failed" },
				}),
			],
		]);

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
		expect(bridge.status.status).not.toBe("errored");
	});

	it("surfaces malformed command facts without treating them as close", () => {
		const g = graph();
		const bridge = wireBridge(g, { name: "bridge", sessionId: "session-a" });
		const outbound: unknown[] = [];
		const errors: unknown[] = [];
		bridge.outbound.subscribe((msg) => outbound.push(msg));
		bridge.errors.subscribe((msg) => errors.push(msg));

		bridge.command.down([["DATA", { kind: "wat" } as never]]);
		bridge.command.down([["DATA", { kind: "ack", ackForSeq: 0 } as never]]);
		bridge.command.down([["DATA", { kind: "send", payload: "ok", idempotencyKey: "" } as never]]);
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
						idempotencyKey: "session-a:1",
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
});

describe("remote dispatcher helpers over wireBridge facts (D147)", () => {
	it("remoteCall emits request facts and projects later response/status/error facts", () => {
		const g = graph();
		const bridge = wireBridge<
			{ operation: string; requestId: string; payload: string },
			{
				kind: "result" | "error" | "status";
				operation: string;
				requestId: string;
				payload?: string;
				error?: string;
				status?: string;
			}
		>(g, { name: "bridge", sessionId: "session-a" });
		const remote = remoteCall<string, string>(g, bridge, { name: "rpc" });
		const outbound: unknown[] = [];
		const results: unknown[] = [];
		const status: unknown[] = [];
		const errors: unknown[] = [];
		bridge.outbound.subscribe((msg) => outbound.push(msg));
		remote.results.subscribe((msg) => results.push(msg));
		remote.status.subscribe((msg) => status.push(msg));
		remote.errors.subscribe((msg) => errors.push(msg));

		remote.call("upper", "req-1", "hello");
		expect(outbound.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({
				type: "data",
				payload: {
					kind: "data",
					value: { operation: "upper", requestId: "req-1", payload: "hello" },
				},
				metadata: expect.objectContaining({ requestId: "req-1" }),
			}),
		]);
		expect(status.at(-1)).toEqual([
			"DATA",
			{
				state: "requested",
				operation: "upper",
				requestId: "req-1",
				pending: 1,
				completed: 0,
				errors: 0,
				timeouts: 0,
			},
		]);

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 1,
					cursor: 1,
					payload: {
						kind: "data",
						value: { kind: "result", operation: "upper", requestId: "req-1", payload: "HELLO" },
					},
					requestId: "req-1",
				}),
			],
		]);

		expect(results).toContainEqual([
			"DATA",
			{ operation: "upper", requestId: "req-1", payload: "HELLO" },
		]);
		expect(status.at(-1)).toEqual([
			"DATA",
			{
				state: "responded",
				operation: "upper",
				requestId: "req-1",
				pending: 0,
				completed: 1,
				errors: 0,
				timeouts: 0,
			},
		]);

		remote.timeout("req-timeout", "upper", "local timeout");
		expect(errors).toContainEqual([
			"DATA",
			{ operation: "upper", requestId: "req-timeout", error: "local timeout" },
		]);
	});

	it("remoteCall ignores unknown responses instead of buffering them for future calls", () => {
		const g = graph();
		const bridge = wireBridge<
			{ operation: string; requestId: string; payload: string },
			{
				kind: "result";
				operation: string;
				requestId: string;
				payload: string;
			}
		>(g, { name: "bridge", sessionId: "session-a" });
		const remote = remoteCall<string, string>(g, bridge, { name: "rpc" });
		const results: unknown[] = [];
		remote.results.subscribe((msg) => results.push(msg));

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 1,
					cursor: 0,
					payload: {
						kind: "data",
						value: {
							kind: "result",
							operation: "upper",
							requestId: "req-1",
							payload: "STALE",
						},
					},
					requestId: "req-1",
				}),
			],
		]);
		remote.call("upper", "req-1", "hello");

		expect(results).not.toContainEqual(["DATA", expect.anything()]);

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 2,
					cursor: 1,
					payload: {
						kind: "data",
						value: {
							kind: "result",
							operation: "upper",
							requestId: "req-1",
							payload: "HELLO",
						},
					},
					requestId: "req-1",
				}),
			],
		]);

		expect(results).toContainEqual([
			"DATA",
			{ operation: "upper", requestId: "req-1", payload: "HELLO" },
		]);
	});

	it("remoteCall ignores same-wave stale responses that precede a new outbound request", () => {
		const g = graph();
		const bridge = wireBridge<
			{ operation: string; requestId: string; payload: string },
			{
				kind: "result";
				operation: string;
				requestId: string;
				payload: string;
			}
		>(g, { name: "bridge", sessionId: "session-a" });
		const remote = remoteCall<string, string>(g, bridge, { name: "rpc" });
		const results: unknown[] = [];
		remote.results.subscribe((msg) => results.push(msg));

		batch(() => {
			bridge.inbound.down([
				[
					"DATA",
					wireBridgeEnvelope({
						sessionId: "session-a",
						type: "data",
						seq: 1,
						cursor: 0,
						payload: {
							kind: "data",
							value: {
								kind: "result",
								operation: "upper",
								requestId: "req-1",
								payload: "STALE",
							},
						},
						requestId: "req-1",
					}),
				],
			]);
			remote.call("upper", "req-1", "hello");
		});

		expect(results).not.toContainEqual(["DATA", expect.anything()]);

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 2,
					cursor: 1,
					payload: {
						kind: "data",
						value: {
							kind: "result",
							operation: "upper",
							requestId: "req-1",
							payload: "HELLO",
						},
					},
					requestId: "req-1",
				}),
			],
		]);

		expect(results).toContainEqual([
			"DATA",
			{ operation: "upper", requestId: "req-1", payload: "HELLO" },
		]);
	});

	it("remoteCall rejects duplicate in-flight request ids instead of replacing pending state", () => {
		const g = graph();
		const bridge = wireBridge<
			{ operation: string; requestId: string; payload: string },
			{ kind: "result"; operation: string; requestId: string; payload: string }
		>(g, { name: "bridge", sessionId: "session-a" });
		const remote = remoteCall<string, string>(g, bridge, { name: "rpc" });
		const results: unknown[] = [];
		const errors: unknown[] = [];
		remote.results.subscribe((msg) => results.push(msg));
		remote.errors.subscribe((msg) => errors.push(msg));

		remote.call("upper", "req-1", "first");
		remote.call("upper", "req-1", "second");

		expect(errors).toContainEqual([
			"DATA",
			{
				operation: "upper",
				requestId: "req-1",
				error: "remoteCall: duplicate in-flight requestId 'req-1'",
			},
		]);

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 1,
					cursor: 1,
					payload: {
						kind: "data",
						value: {
							kind: "result",
							operation: "upper",
							requestId: "req-1",
							payload: "FIRST",
						},
					},
				}),
			],
		]);

		expect(results).toContainEqual([
			"DATA",
			{ operation: "upper", requestId: "req-1", payload: "FIRST" },
		]);

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 2,
					cursor: 2,
					payload: {
						kind: "data",
						value: {
							kind: "result",
							operation: "upper",
							requestId: "req-1",
							payload: "SECOND",
						},
					},
				}),
			],
		]);

		expect(results).not.toContainEqual([
			"DATA",
			{ operation: "upper", requestId: "req-1", payload: "SECOND" },
		]);
	});

	it("remoteCall duplicate request NACK does not clear the original pending request", () => {
		const g = graph();
		const bridge = wireBridge<
			{ operation: string; requestId: string; payload: string },
			{ kind: "result"; operation: string; requestId: string; payload: string }
		>(g, { name: "bridge", sessionId: "session-a" });
		const remote = remoteCall<string, string>(g, bridge, { name: "rpc" });
		const results: unknown[] = [];
		const errors: unknown[] = [];
		remote.results.subscribe((msg) => results.push(msg));
		remote.errors.subscribe((msg) => errors.push(msg));

		remote.call("upper", "req-1", "first");
		remote.call("upper", "req-1", "second");

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "nack",
					seq: 1,
					cursor: 2,
					ackForSeq: 2,
					payload: { kind: "error", error: { message: "duplicate rejected remotely" } },
					requestId: "req-1",
				}),
			],
		]);

		expect(errors).toContainEqual([
			"DATA",
			{
				operation: "upper",
				requestId: "req-1",
				error: "remoteCall: duplicate in-flight requestId 'req-1'",
			},
		]);

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 2,
					cursor: 2,
					payload: {
						kind: "data",
						value: {
							kind: "result",
							operation: "upper",
							requestId: "req-1",
							payload: "FIRST",
						},
					},
					requestId: "req-1",
				}),
			],
		]);

		expect(results).toContainEqual([
			"DATA",
			{ operation: "upper", requestId: "req-1", payload: "FIRST" },
		]);
	});

	it("remoteResponder dispatches sync handlers through bridge command facts", () => {
		const g = graph();
		const bridge = wireBridge<
			{
				kind: "result" | "error" | "status";
				operation: string;
				requestId: string;
				payload?: string;
				error?: string;
				status?: string;
			},
			{ operation: string; requestId: string; payload: string }
		>(g, { name: "bridge", sessionId: "session-a" });
		const responder = remoteResponder<string, string>(g, bridge, {
			name: "responder",
			handlers: [remoteResponderHandler("upper", (request) => request.payload.toUpperCase())],
			rejectUnknown: true,
		});
		const outbound: unknown[] = [];
		const responseCommands: unknown[] = [];
		const requests: unknown[] = [];
		bridge.outbound.subscribe((msg) => outbound.push(msg));
		responder.responseCommands.subscribe((msg) => responseCommands.push(msg));
		responder.requests.subscribe((msg) => requests.push(msg));

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 1,
					cursor: 0,
					payload: {
						kind: "data",
						value: { operation: "upper", requestId: "req-1", payload: "hello" },
					},
					requestId: "req-1",
				}),
			],
		]);

		expect(requests).toContainEqual([
			"DATA",
			{ operation: "upper", requestId: "req-1", payload: "hello" },
		]);
		expect(responseCommands).toContainEqual([
			"DATA",
			{
				kind: "send",
				payload: { kind: "result", operation: "upper", requestId: "req-1", payload: "HELLO" },
				requestId: "req-1",
			},
		]);
		expect(outbound).toContainEqual([
			"DATA",
			expect.objectContaining({
				type: "data",
				payload: {
					kind: "data",
					value: { kind: "result", operation: "upper", requestId: "req-1", payload: "HELLO" },
				},
				metadata: expect.objectContaining({ requestId: "req-1" }),
			}),
		]);

		const snap = g.describe();
		expect(snap.edges).toContainEqual({ from: "bridge/inbound", to: "responder/events" });
		expect(snap.edges).toContainEqual({
			from: "responder/responseCommands",
			to: "bridge/command",
		});
		expect(snap.edges).toContainEqual({ from: "bridge/command", to: "bridge/events" });
	});

	it("remoteResponder release detaches responseCommands from a long-lived bridge", () => {
		const g = graph();
		const bridge = wireBridge<
			{ kind: "result" | "error"; operation: string; requestId: string; payload?: string },
			{ operation: string; requestId: string; payload: string }
		>(g, { name: "bridge", sessionId: "session-a" });
		const responder = remoteResponder<string, string>(g, bridge, {
			name: "responder",
			handlers: [remoteResponderHandler("upper", (request) => request.payload.toUpperCase())],
		});
		const outbound: unknown[] = [];
		bridge.outbound.subscribe((msg) => outbound.push(msg));
		expect(g.describe().edges).toContainEqual({
			from: "responder/responseCommands",
			to: "bridge/command",
		});

		responder.release();
		responder.release();
		expect(g.find("responder/responseCommands")).toBeUndefined();
		expect(g.describe().edges).not.toContainEqual({
			from: "responder/responseCommands",
			to: "bridge/command",
		});
		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 1,
					cursor: 0,
					payload: {
						kind: "data",
						value: { operation: "upper", requestId: "req-1", payload: "hello" },
					},
					requestId: "req-1",
				}),
			],
		]);
		expect(outbound.filter((msg) => Array.isArray(msg) && msg[0] === "DATA")).toEqual([]);
	});

	it("remoteResponder release is retryable when external subscribers block topology release", () => {
		const g = graph();
		const bridge = wireBridge<
			{ kind: "result" | "error"; operation: string; requestId: string; payload?: string },
			{ operation: string; requestId: string; payload: string }
		>(g, { name: "bridge", sessionId: "session-a" });
		const responder = remoteResponder<string, string>(g, bridge, {
			name: "responder",
			handlers: [remoteResponderHandler("upper", (request) => request.payload.toUpperCase())],
		});
		const outbound: unknown[] = [];
		const unsub = responder.status.subscribe(() => {});
		bridge.outbound.subscribe((msg) => outbound.push(msg));

		expect(() => responder.release()).toThrow(/live subscribers/);
		expect(g.describe().edges).toContainEqual({
			from: "responder/responseCommands",
			to: "bridge/command",
		});
		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 1,
					cursor: 0,
					payload: {
						kind: "data",
						value: { operation: "upper", requestId: "req-1", payload: "hello" },
					},
					requestId: "req-1",
				}),
			],
		]);
		expect(outbound.filter((msg) => Array.isArray(msg) && msg[0] === "DATA")).toHaveLength(1);

		unsub();
		responder.release();
		expect(g.find("responder/status")).toBeUndefined();
	});

	it("remoteResponder rejects wrong-session inbound requests before handler dispatch", () => {
		const g = graph();
		const bridge = wireBridge<
			{ kind: "result" | "error"; operation: string; requestId: string; payload?: string },
			{ operation: string; requestId: string; payload: string }
		>(g, { name: "bridge", sessionId: "session-a" });
		const handled: string[] = [];
		const responder = remoteResponder<string, string>(g, bridge, {
			name: "responder",
			handlers: [
				remoteResponderHandler("upper", (request) => {
					handled.push(request.requestId);
					return request.payload.toUpperCase();
				}),
			],
		});
		const errors: unknown[] = [];
		const outbound: unknown[] = [];
		responder.errors.subscribe((msg) => errors.push(msg));
		bridge.outbound.subscribe((msg) => outbound.push(msg));

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "wrong-session",
					type: "data",
					seq: 1,
					cursor: 0,
					payload: {
						kind: "data",
						value: { operation: "upper", requestId: "req-1", payload: "hello" },
					},
				}),
			],
		]);

		expect(handled).toEqual([]);
		expect(outbound).not.toContainEqual(["DATA", expect.anything()]);
		expect(errors).toContainEqual([
			"DATA",
			{
				error: "remoteResponder: inbound session wrong-session did not match expected session-a",
			},
		]);
	});

	it("remoteCall surfaces malformed response payloads as visible errors", () => {
		const g = graph();
		const bridge = wireBridge<{ operation: string; requestId: string; payload: string }, unknown>(
			g,
			{ name: "bridge", sessionId: "session-a" },
		);
		const remote = remoteCall<string, string>(g, bridge, { name: "rpc" });
		const errors: unknown[] = [];
		const results: unknown[] = [];
		const status: unknown[] = [];
		remote.errors.subscribe((msg) => errors.push(msg));
		remote.results.subscribe((msg) => results.push(msg));
		remote.status.subscribe((msg) => status.push(msg));

		remote.call("upper", "req-1", "hello");
		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 1,
					cursor: 1,
					payload: {
						kind: "data",
						value: { kind: "result", operation: "upper", requestId: "req-1" },
					},
				}),
			],
		]);

		expect(results).not.toContainEqual(["DATA", expect.anything()]);
		expect(errors).toContainEqual([
			"DATA",
			{
				operation: "upper",
				requestId: "req-1",
				error: "remoteCall: response payload is malformed",
			},
		]);
		expect(status).toContainEqual([
			"DATA",
			{
				state: "errored",
				operation: "upper",
				requestId: "req-1",
				pending: 0,
				completed: 0,
				errors: 1,
				timeouts: 0,
			},
		]);
	});

	it("remoteCall ignores malformed responses for unknown request ids", () => {
		const g = graph();
		const bridge = wireBridge<{ operation: string; requestId: string; payload: string }, unknown>(
			g,
			{ name: "bridge", sessionId: "session-a" },
		);
		const remote = remoteCall<string, string>(g, bridge, { name: "rpc" });
		const errors: unknown[] = [];
		const status: unknown[] = [];
		remote.errors.subscribe((msg) => errors.push(msg));
		remote.status.subscribe((msg) => status.push(msg));

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 1,
					cursor: 0,
					payload: {
						kind: "data",
						value: { kind: "result", operation: "upper", requestId: "req-unknown" },
					},
				}),
			],
		]);

		expect(errors).not.toContainEqual([
			"DATA",
			expect.objectContaining({ requestId: "req-unknown" }),
		]);
		expect(status).not.toContainEqual([
			"DATA",
			expect.objectContaining({ state: "errored", requestId: "req-unknown" }),
		]);
	});

	it("remoteResponder rejects malformed request payloads before handler dispatch", () => {
		const g = graph();
		const bridge = wireBridge<
			{ kind: "result" | "error"; operation: string; requestId: string; payload?: string },
			unknown
		>(g, { name: "bridge", sessionId: "session-a" });
		const handled: string[] = [];
		const responder = remoteResponder<string, string>(g, bridge, {
			name: "responder",
			handlers: [
				remoteResponderHandler("upper", (request) => {
					handled.push(request.requestId);
					return request.payload.toUpperCase();
				}),
			],
		});
		const errors: unknown[] = [];
		responder.errors.subscribe((msg) => errors.push(msg));

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 1,
					cursor: 0,
					payload: { kind: "data", value: { operation: "upper" } },
				}),
			],
		]);

		expect(handled).toEqual([]);
		expect(errors).toContainEqual([
			"DATA",
			{ error: "remoteResponder: request payload is malformed" },
		]);
	});

	it("remoteResponder rejects async handler results in the sync first slice", () => {
		const g = graph();
		const bridge = wireBridge<
			{ kind: "result" | "error"; operation: string; requestId: string; payload?: string },
			{ operation: string; requestId: string; payload: string }
		>(g, { name: "bridge", sessionId: "session-a" });
		const responder = remoteResponder<string, unknown>(g, bridge, {
			name: "responder",
			handlers: [
				remoteResponderHandler("upper", (request) =>
					Promise.resolve(request.payload.toUpperCase()),
				),
			],
		});
		const errors: unknown[] = [];
		const outbound: unknown[] = [];
		responder.errors.subscribe((msg) => errors.push(msg));
		bridge.outbound.subscribe((msg) => outbound.push(msg));

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 1,
					cursor: 0,
					payload: {
						kind: "data",
						value: { operation: "upper", requestId: "req-1", payload: "hello" },
					},
				}),
			],
		]);

		expect(errors).toContainEqual([
			"DATA",
			{
				operation: "upper",
				requestId: "req-1",
				error: "remoteResponder: async handler results require a later adapter shape",
			},
		]);
		expect(outbound).toContainEqual([
			"DATA",
			expect.objectContaining({
				payload: {
					kind: "data",
					value: {
						kind: "error",
						operation: "upper",
						requestId: "req-1",
						error: "remoteResponder: async handler results require a later adapter shape",
					},
				},
			}),
		]);
	});
});
