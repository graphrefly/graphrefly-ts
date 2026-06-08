import { describe, expect, it, vi } from "vitest";
import { wireBridge, wireBridgeEnvelope, wireBridgeIdempotencyKey } from "../adapters/index.js";
import { graph } from "../graph/graph.js";
import { retryPolicy } from "../graph/resilience.js";

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
				seq: 1,
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
			["DATA", { kind: "ack", seq: 3, idempotencyKey: undefined, requestId: undefined }],
			[
				"DATA",
				{ kind: "nack", seq: 4, error: "bad", idempotencyKey: undefined, requestId: undefined },
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
			expect(errors).toContainEqual(["DATA", "bridge: late ack for unknown or completed seq 1"]);
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
				lastSeq: 2,
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
		bridge.command.down([["DATA", { kind: "ack", seq: 0 } as never]]);
		bridge.command.down([["DATA", { kind: "send", payload: "ok", idempotencyKey: "" } as never]]);
		bridge.send("after-invalid");

		expect(errors).toContainEqual(["DATA", "wireBridge: command kind is not recognized"]);
		expect(errors).toContainEqual([
			"DATA",
			"wireBridge: ack command seq must be a positive integer",
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
