import { describe, expect, it, vi } from "vitest";
import {
	wireBridge,
	wireBridgeAckDriver,
	wireBridgeEnvelope,
	wireBridgeIdempotencyKey,
	wireEdgeGroup,
} from "../adapters/index.js";
import { batch } from "../batch/batch.js";
import { depBatch } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import { retryPolicy } from "../graph/resilience.js";
import { canonicalTupleKey, compoundTupleKey } from "../identity.js";

const wireCauseId = (name: string, seq: number) =>
	compoundTupleKey("wire-edge-group-cause", [name, String(seq)]);

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
		const dirtyWithValue = {
			kind: "dirty",
			edgeId: "edge-a",
			causeId: "cause-a",
			value: new Uint8Array([1]),
		};
		const dataWithoutValue = { kind: "data", edgeId: "edge-a", causeId: "cause-a" };
		const canonicalAccessor = {};
		Object.defineProperty(canonicalAccessor, "kind", {
			get: () => "dirty",
			enumerable: true,
		});
		Object.defineProperty(canonicalAccessor, "edgeId", { value: "edge-a", enumerable: true });
		Object.defineProperty(canonicalAccessor, "causeId", { value: "cause-a", enumerable: true });
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
			dirtyWithValue,
			dataWithoutValue,
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
		const outbound: unknown[] = [];
		const errors: unknown[] = [];
		bridge.outbound.subscribe((msg) => outbound.push(msg));
		bridge.errors.subscribe((msg) => errors.push(msg));

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
		const outbound: unknown[] = [];
		bridge.errors.subscribe((msg) => errors.push(msg));
		bridge.outbound.subscribe((msg) => outbound.push(msg));

		bridge.send({ socket: () => undefined });

		expect(outbound.filter((msg) => Array.isArray(msg) && msg[0] === "DATA")).toEqual([]);
		expect(errors).toContainEqual([
			"DATA",
			expect.stringMatching(
				/wire-admissible payload|strict JSON|stableJsonString|invalid canonical wire DTO/,
			),
		]);
		expect(bridge.errors.status).not.toBe("errored");
		expect(bridge.outbound.status).not.toBe("errored");
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
			const outbound: unknown[] = [];
			const errors: unknown[] = [];
			const status: unknown[] = [];
			bridge.outbound.subscribe((msg) => outbound.push(msg));
			bridge.errors.subscribe((msg) => errors.push(msg));
			bridge.status.subscribe((msg) => status.push(msg));

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
		const outbound: unknown[] = [];
		const events: unknown[] = [];
		const status: unknown[] = [];
		bridge.outbound.subscribe((msg) => outbound.push(msg));
		bridge.events.subscribe((msg) => events.push(msg));
		bridge.status.subscribe((msg) => status.push(msg));

		bridge.send("payload");
		bridge.command.down([["DATA", { kind: "ack-timeout", seq: 1, attempt: 2 }]]);
		expect(outbound.filter((msg) => msg[0] === "DATA")).toHaveLength(1);
		expect(events).not.toContainEqual(["DATA", { kind: "timeout", seq: 1, attempt: 2 }]);

		bridge.command.down([["DATA", { kind: "ack-timeout", seq: 1, attempt: 1 }]]);

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
		const outbound: unknown[] = [];
		const events: unknown[] = [];
		bridge.outbound.subscribe((msg) => outbound.push(msg));
		bridge.events.subscribe((msg) => events.push(msg));

		bridge.send("payload");
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
		bridge.command.down([["DATA", { kind: "ack-timeout", seq: 1, attempt: 1 }]]);

		expect(outbound.filter((msg) => msg[0] === "DATA")).toHaveLength(1);
		expect(events).not.toContainEqual(["DATA", { kind: "timeout", seq: 1, attempt: 1 }]);
	});

	it("surfaces malformed ack-timeout commands as invalid facts without protocol terminals (D502)", () => {
		const g = graph();
		const bridge = wireBridge<string, unknown>(g, { name: "bridge", sessionId: "session-a" });
		const errors: unknown[] = [];
		bridge.errors.subscribe((msg) => errors.push(msg));

		bridge.command.down([["DATA", { kind: "ack-timeout", seq: 1, attempt: 0 } as never]]);

		expect(errors).toContainEqual([
			"DATA",
			"wireBridge: ack-timeout command attempt must be a positive integer",
		]);
		expect(bridge.events.status).not.toBe("errored");
		expect(bridge.status.status).not.toBe("errored");
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
		bridge.errors.subscribe((msg) => errors.push(msg));
		bridge.status.subscribe((msg) => status.push(msg));
		bridge.events.subscribe((msg) => events.push(msg));

		bridge.send("payload");
		bridge.command.down([["DATA", { kind: "ack-timeout", seq: 1, attempt: 1 }]]);

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
		expect(bridge.events.status).not.toBe("errored");
		expect(bridge.status.status).not.toBe("errored");
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
		const commands: unknown[] = [];
		const outbound: unknown[] = [];
		const driverStatus: unknown[] = [];
		driver.commands.subscribe((msg) => commands.push(msg));
		driver.status.subscribe((msg) => driverStatus.push(msg));
		bridge.outbound.subscribe((msg) => outbound.push(msg));

		clock.down([["DATA", 1000]]);
		bridge.send("payload");
		clock.down([["DATA", 1004]]);
		expect(commands.filter((msg) => msg[0] === "DATA")).toEqual([]);

		clock.down([["DATA", 1005]]);

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
		bridge.command.down([
			["DATA", { kind: "ack-timeout", seq: 1, attempt: 1, observedAtMs: 1005 }],
		]);
		expect(outbound.filter((msg) => msg[0] === "DATA")).toHaveLength(1);
		clock.down([["DATA", 1014]]);
		expect(commands.filter((msg) => msg[0] === "DATA")).toHaveLength(1);
		clock.down([["DATA", 1015]]);
		expect(commands).toContainEqual([
			"DATA",
			{ kind: "ack-timeout", seq: 1, attempt: 1, observedAtMs: 1015 },
		]);
		bridge.command.down([
			["DATA", { kind: "ack-timeout", seq: 1, attempt: 1, observedAtMs: 1015 }],
		]);
		expect(outbound.filter((msg) => msg[0] === "DATA")).toHaveLength(2);
		const snap = g.describe();
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
		const commands: unknown[] = [];
		const outbound: unknown[] = [];
		driver.commands.subscribe((msg) => commands.push(msg));
		bridge.outbound.subscribe((msg) => outbound.push(msg));

		clock.down([["DATA", 1000]]);
		bridge.send("payload");
		batch(() => {
			clock.down([["DATA", 1005]]);
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
		});

		expect(commands).toContainEqual([
			"DATA",
			{ kind: "ack-timeout", seq: 1, attempt: 1, observedAtMs: 1005 },
		]);
		bridge.command.down([
			["DATA", { kind: "ack-timeout", seq: 1, attempt: 1, observedAtMs: 1005 }],
		]);
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
		const outbound: unknown[] = [];
		const commands: unknown[] = [];
		const unsubscribe = driver.commands.subscribe((msg) => commands.push(msg));
		bridge.outbound.subscribe((msg) => outbound.push(msg));

		clock.down([["DATA", 1000]]);
		bridge.send("payload");
		unsubscribe();
		driver.release();
		clock.down([["DATA", 1005]]);

		expect(commands.filter((msg) => msg[0] === "DATA")).toEqual([]);
		expect(g.describe().edges).not.toContainEqual({ from: "clock", to: "ackDriver/events" });
		expect(g.describe().edges).not.toContainEqual({
			from: "ackDriver/commands",
			to: "bridge/command",
		});
		expect(outbound.filter((msg) => msg[0] === "DATA")).toHaveLength(1);
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

	it("wireEdgeGroup D501 emits two-phase frames, gates release, fails closed, describes, and releases", () => {
		const bytes = (...values: number[]) => new Uint8Array(values);
		const dataValues = <T>(messages: T[][]): unknown[] =>
			messages.filter((msg) => msg[0] === "DATA").map((msg) => msg[1]);
		const g = graph();
		const sourceA = g.node<Uint8Array>([], null, { name: "edge/a" });
		const sourceB = g.node<Uint8Array>([], null, { name: "edge/b" });
		const bridge = wireBridge(g, { name: "bridgeWeg", sessionId: "session-a" });
		const group = wireEdgeGroup(g, bridge, {
			name: "group",
			edges: [
				{ edgeId: "a", outbound: sourceA },
				{ edgeId: "b", outbound: sourceB },
			],
		});
		const outbound: unknown[][] = [];
		bridge.outbound.subscribe((msg) => outbound.push(msg as unknown[]));
		batch(() => {
			sourceA.down([["DATA", bytes(1)]]);
			sourceB.down([["DATA", bytes(2)]]);
		});
		expect(
			dataValues(outbound).map(
				(envelope) =>
					(envelope as { payload?: { value?: { frame?: unknown } } }).payload?.value?.frame,
			),
		).toEqual([
			{ kind: "dirty", edgeId: "a", causeId: wireCauseId("group", 1) },
			{ kind: "dirty", edgeId: "b", causeId: wireCauseId("group", 1) },
			{ kind: "data", edgeId: "a", causeId: wireCauseId("group", 1), value: bytes(1) },
			{ kind: "data", edgeId: "b", causeId: wireCauseId("group", 1), value: bytes(2) },
		]);
		const inboundA = group.inbound.get("a");
		const inbound: unknown[][] = [];
		const issues: unknown[][] = [];
		const status: unknown[][] = [];
		inboundA?.subscribe((msg) => inbound.push(msg as unknown[]));
		group.issues.subscribe((msg) => issues.push(msg as unknown[]));
		group.status.subscribe((msg) => status.push(msg as unknown[]));
		const edgeEnvelope = (seq: number, frame: Record<string, unknown>) =>
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "data",
				seq,
				payload: { kind: "data", value: { kind: "wire_edge", frame } },
			});
		bridge.inbound.down([
			["DATA", edgeEnvelope(1, { kind: "dirty", edgeId: "a", causeId: "c1" })],
			["DATA", edgeEnvelope(2, { kind: "data", edgeId: "a", causeId: "c1", value: bytes(10) })],
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "close",
					seq: 3,
					payload: { kind: "close" },
				}),
			],
		]);
		expect(dataValues(inbound)).toEqual([]);
		bridge.inbound.down([
			["DATA", edgeEnvelope(4, { kind: "dirty", edgeId: "a", causeId: "c2" })],
			["DATA", edgeEnvelope(5, { kind: "dirty", edgeId: "b", causeId: "c2" })],
			["DATA", edgeEnvelope(6, { kind: "data", edgeId: "a", causeId: "c2", value: bytes(10) })],
			["DATA", edgeEnvelope(7, { kind: "data", edgeId: "b", causeId: "c2", value: bytes(20) })],
		]);
		expect(dataValues(inbound)).toEqual([bytes(10)]);
		bridge.inbound.down([
			["DATA", edgeEnvelope(8, { kind: "dirty", edgeId: "z", causeId: "bad" })],
		]);
		expect(dataValues(issues)).toContainEqual(
			expect.objectContaining({ code: "wire-edge-group-unknown-edge" }),
		);
		expect(status.at(-1)).toEqual(["DATA", expect.objectContaining({ state: "issues" })]);
		const snap = g.describe();
		expect(
			snap.edges.some(
				(edge) => edge.to === "group/events" && edge.from.includes("wireBridgeInbound"),
			),
		).toBe(true);
		expect(snap.edges).toContainEqual({ from: "group/events", to: "group/gate" });
		expect(snap.edges).toContainEqual({ from: "group/releaseCohorts", to: "group/inbound/a" });
		expect(snap.edges).not.toContainEqual({ from: "group/gate", to: "group/inbound/a" });
		expect(snap.edges).toContainEqual({ from: "group/commands", to: "bridgeWeg/command" });
		const bridge2 = wireBridge(g, { name: "bridgeWeg2", sessionId: "session-b" });
		const group2 = wireEdgeGroup(g, bridge2, {
			name: "group2",
			edges: [
				{ edgeId: "a", outbound: sourceA },
				{ edgeId: "b", outbound: sourceB },
			],
		});
		group2.release();
		expect(g.describe().edges).not.toContainEqual({
			from: "group2/commands",
			to: "bridgeWeg2/command",
		});
	});

	it("wireEdgeGroup release restores bridge command source when topology release is blocked", () => {
		const g = graph();
		const bridge = wireBridge(g, { name: "bridgeRelease", sessionId: "session-a" });
		const group = wireEdgeGroup(g, bridge, {
			name: "releaseGroup",
			edges: [{ edgeId: "a" }],
		});
		const unsubscribe = group.status.subscribe(() => {});

		expect(() => group.release()).toThrow(/live subscribers/);
		expect(g.describe().edges).toContainEqual({
			from: "releaseGroup/commands",
			to: "bridgeRelease/command",
		});

		unsubscribe();
		group.release();
		expect(g.describe().edges).not.toContainEqual({
			from: "releaseGroup/commands",
			to: "bridgeRelease/command",
		});
	});

	it("wireEdgeGroup release keeps private inbound projector state when topology release is blocked", () => {
		const bytes = (...values: number[]) => new Uint8Array(values);
		const g = graph();
		const bridge = wireBridge(g, { name: "releaseRollbackBridge", sessionId: "session-a" });
		const group = wireEdgeGroup(g, bridge, {
			name: "releaseRollbackGroup",
			edges: [{ edgeId: "a" }, { edgeId: "b" }],
		});
		const inboundA = group.inbound.get("a");
		if (inboundA === undefined) throw new Error("missing inbound edge");
		const unsubscribe = group.status.subscribe(() => {});
		const envelope = (seq: number, frame: Record<string, unknown>) =>
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "data",
				seq,
				payload: { kind: "data", value: { kind: "wire_edge", frame } },
			});
		bridge.inbound.down([
			["DATA", envelope(1, { kind: "dirty", edgeId: "a", causeId: "c1" })],
			["DATA", envelope(2, { kind: "dirty", edgeId: "b", causeId: "c1" })],
			["DATA", envelope(3, { kind: "data", edgeId: "a", causeId: "c1", value: bytes(10) })],
			["DATA", envelope(4, { kind: "data", edgeId: "b", causeId: "c1", value: bytes(20) })],
		]);

		expect(inboundA.cache).toEqual(bytes(10));
		expect(() => group.release()).toThrow(/live subscribers/);
		expect(inboundA.cache).toEqual(bytes(10));
		expect(g.describe().edges).toContainEqual({
			from: "releaseRollbackGroup/commands",
			to: "releaseRollbackBridge/command",
		});

		unsubscribe();
		group.release();
		expect(g.describe().edges).not.toContainEqual({
			from: "releaseRollbackGroup/commands",
			to: "releaseRollbackBridge/command",
		});
	});

	it("wireEdgeGroup D560/D561 admits only complete fresh outbound cohorts after bootstrap", () => {
		const bytes = (...values: number[]) => new Uint8Array(values);
		const dataValues = <T>(messages: T[][]): unknown[] =>
			messages.filter((msg) => msg[0] === "DATA").map((msg) => msg[1]);
		const frames = (messages: unknown[][]) =>
			dataValues(messages).map(
				(envelope) =>
					(envelope as { payload?: { value?: { frame?: unknown } } }).payload?.value?.frame,
			);
		const g = graph();
		const sourceA = g.node<Uint8Array>([], null, { name: "fresh/a" });
		const sourceB = g.node<Uint8Array>([], null, { name: "fresh/b" });
		const bridge = wireBridge(g, { name: "freshBridge", sessionId: "session-a" });
		wireEdgeGroup(g, bridge, {
			name: "freshGroup",
			edges: [
				{ edgeId: "a", outbound: sourceA },
				{ edgeId: "b", outbound: sourceB },
			],
		});
		const outbound: unknown[][] = [];
		bridge.outbound.subscribe((msg) => outbound.push(msg as unknown[]));

		sourceA.down([["DATA", bytes(1)]]);
		expect(frames(outbound)).toEqual([]);

		sourceB.down([["DATA", bytes(2)]]);
		expect(frames(outbound)).toEqual([
			{ kind: "dirty", edgeId: "a", causeId: wireCauseId("freshGroup", 1) },
			{ kind: "dirty", edgeId: "b", causeId: wireCauseId("freshGroup", 1) },
			{ kind: "data", edgeId: "a", causeId: wireCauseId("freshGroup", 1), value: bytes(1) },
			{ kind: "data", edgeId: "b", causeId: wireCauseId("freshGroup", 1), value: bytes(2) },
		]);

		outbound.length = 0;
		batch(() => {
			sourceA.down([["DATA", bytes(1)]]);
			sourceB.down([["DATA", bytes(2)]]);
		});
		expect(frames(outbound)).toEqual([
			{ kind: "dirty", edgeId: "a", causeId: wireCauseId("freshGroup", 2) },
			{ kind: "dirty", edgeId: "b", causeId: wireCauseId("freshGroup", 2) },
			{ kind: "data", edgeId: "a", causeId: wireCauseId("freshGroup", 2), value: bytes(1) },
			{ kind: "data", edgeId: "b", causeId: wireCauseId("freshGroup", 2), value: bytes(2) },
		]);

		outbound.length = 0;
		batch(() => {
			sourceA.down([["INVALIDATE"]]);
			sourceA.down([["DATA", bytes(5)]]);
			sourceB.down([["DATA", bytes(6)]]);
		});
		expect(frames(outbound)).toEqual([
			{ kind: "dirty", edgeId: "a", causeId: wireCauseId("freshGroup", 3) },
			{ kind: "dirty", edgeId: "b", causeId: wireCauseId("freshGroup", 3) },
			{ kind: "data", edgeId: "a", causeId: wireCauseId("freshGroup", 3), value: bytes(5) },
			{ kind: "data", edgeId: "b", causeId: wireCauseId("freshGroup", 3), value: bytes(6) },
		]);

		outbound.length = 0;
		batch(() => {
			sourceA.down([["DATA", bytes(3)], ["INVALIDATE"]]);
			sourceB.down([["DATA", bytes(4)]]);
		});
		expect(frames(outbound)).toEqual([]);
	});

	it("wireEdgeGroup D561 does not form post-bootstrap causes from current replay alone", () => {
		const bytes = (...values: number[]) => new Uint8Array(values);
		const dataValues = <T>(messages: T[][]): unknown[] =>
			messages.filter((msg) => msg[0] === "DATA").map((msg) => msg[1]);
		const frameCauseIds = (messages: unknown[][]) =>
			dataValues(messages)
				.map(
					(envelope) =>
						(envelope as { payload?: { value?: { frame?: { causeId?: string } } } }).payload?.value
							?.frame?.causeId,
				)
				.filter((causeId): causeId is string => causeId !== undefined);
		const g = graph();
		const sourceA = g.node<Uint8Array>([], null, { name: "replay/a" });
		const sourceB = g.node<Uint8Array>([], null, { name: "replay/b" });
		const bridge = wireBridge(g, { name: "replayFreshBridge", sessionId: "session-a" });
		wireEdgeGroup(g, bridge, {
			name: "replayFreshGroup",
			edges: [
				{ edgeId: "a", outbound: sourceA },
				{ edgeId: "b", outbound: sourceB },
			],
		});
		const first: unknown[][] = [];
		const unsubscribe = bridge.outbound.subscribe((msg) => first.push(msg as unknown[]));
		batch(() => {
			sourceA.down([["DATA", bytes(1)]]);
			sourceB.down([["DATA", bytes(2)]]);
		});
		expect(frameCauseIds(first)).toContain(wireCauseId("replayFreshGroup", 1));

		unsubscribe();
		const replayOnly: unknown[][] = [];
		bridge.outbound.subscribe((msg) => replayOnly.push(msg as unknown[]));

		expect(frameCauseIds(replayOnly)).not.toContain(wireCauseId("replayFreshGroup", 2));
	});

	it("wireEdgeGroup D562 isolates partial inbound progress from edge projectors and releases one cohort", () => {
		const bytes = (...values: number[]) => new Uint8Array(values);
		const dataValues = <T>(messages: T[][]): unknown[] =>
			messages.filter((msg) => msg[0] === "DATA").map((msg) => msg[1]);
		const g = graph();
		const bridge = wireBridge(g, { name: "releaseLaneBridge", sessionId: "session-a" });
		const group = wireEdgeGroup(g, bridge, {
			name: "releaseLaneGroup",
			edges: [{ edgeId: "a" }, { edgeId: "b" }],
		});
		const inboundA = group.inbound.get("a");
		const inboundB = group.inbound.get("b");
		if (inboundA === undefined || inboundB === undefined) throw new Error("missing inbound edge");
		const join = g.node<readonly [Uint8Array, Uint8Array]>(
			[inboundA, inboundB],
			(ctx) => {
				const a = depBatch(ctx, 0);
				const b = depBatch(ctx, 1);
				if (a && b) ctx.down([["DATA", [a.at(-1), b.at(-1)] as const]]);
			},
			{ name: "releaseLaneJoin" },
		);
		const inboundMessages: unknown[][] = [];
		const joinMessages: unknown[][] = [];
		const status: unknown[][] = [];
		const issues: unknown[][] = [];
		inboundA.subscribe((msg) => inboundMessages.push(msg as unknown[]));
		join.subscribe((msg) => joinMessages.push(msg as unknown[]));
		group.status.subscribe((msg) => status.push(msg as unknown[]));
		group.issues.subscribe((msg) => issues.push(msg as unknown[]));
		const envelope = (seq: number, frame: Record<string, unknown>) =>
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "data",
				seq,
				payload: { kind: "data", value: { kind: "wire_edge", frame } },
			});

		bridge.inbound.down([
			["DATA", envelope(1, { kind: "dirty", edgeId: "a", causeId: "c1" })],
			["DATA", envelope(2, { kind: "data", edgeId: "a", causeId: "c1", value: bytes(10) })],
		]);
		expect(inboundMessages).toEqual([["START"]]);
		expect(joinMessages).toEqual([["START"]]);
		expect(dataValues(status).at(-1)).toEqual(
			expect.objectContaining({ state: "collecting", dirty: 1, data: 1, released: 0 }),
		);

		bridge.inbound.down([
			["DATA", envelope(3, { kind: "dirty", edgeId: "b", causeId: "c1" })],
			["DATA", envelope(4, { kind: "data", edgeId: "b", causeId: "c1", value: bytes(20) })],
		]);
		expect(dataValues(inboundMessages)).toEqual([bytes(10)]);
		expect(dataValues(joinMessages)).toEqual([[bytes(10), bytes(20)]]);
		expect(dataValues(status).at(-1)).toEqual(
			expect.objectContaining({ state: "released", dirty: 2, data: 2, released: 2 }),
		);

		bridge.inbound.down([["DATA", envelope(5, { kind: "dirty", edgeId: "a", causeId: "c1" })]]);
		expect(dataValues(issues)).toContainEqual(
			expect.objectContaining({ code: "wire-edge-group-duplicate-dirty", causeId: "c1" }),
		);
		expect(group.issues.status).not.toBe("errored");
		expect(group.status.status).not.toBe("errored");
	});

	it("wireEdgeGroup D562 drains adapter-owned inbound projectors before tombstoning without public inbound subscribers", () => {
		const bytes = (...values: number[]) => new Uint8Array(values);
		const dataValues = <T>(messages: T[][]): unknown[] =>
			messages.filter((msg) => msg[0] === "DATA").map((msg) => msg[1]);
		const g = graph();
		const bridge = wireBridge(g, { name: "projectorDrainBridge", sessionId: "session-a" });
		const group = wireEdgeGroup(g, bridge, {
			name: "projectorDrainGroup",
			edges: [{ edgeId: "a" }, { edgeId: "b" }],
		});
		const inboundA = group.inbound.get("a");
		const inboundB = group.inbound.get("b");
		if (inboundA === undefined || inboundB === undefined) throw new Error("missing inbound edge");
		const status: unknown[][] = [];
		const issues: unknown[][] = [];
		group.status.subscribe((msg) => status.push(msg as unknown[]));
		group.issues.subscribe((msg) => issues.push(msg as unknown[]));
		const envelope = (seq: number, frame: Record<string, unknown>) =>
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "data",
				seq,
				payload: { kind: "data", value: { kind: "wire_edge", frame } },
			});

		bridge.inbound.down([
			["DATA", envelope(1, { kind: "dirty", edgeId: "a", causeId: "c1" })],
			["DATA", envelope(2, { kind: "dirty", edgeId: "b", causeId: "c1" })],
			["DATA", envelope(3, { kind: "data", edgeId: "a", causeId: "c1", value: bytes(10) })],
			["DATA", envelope(4, { kind: "data", edgeId: "b", causeId: "c1", value: bytes(20) })],
		]);

		expect(inboundA.cache).toEqual(bytes(10));
		expect(inboundB.cache).toEqual(bytes(20));
		expect(dataValues(status).at(-1)).toEqual(
			expect.objectContaining({ state: "released", dirty: 2, data: 2, released: 2 }),
		);
		expect(dataValues(issues)).toEqual([]);

		bridge.inbound.down([["DATA", envelope(5, { kind: "dirty", edgeId: "a", causeId: "c1" })]]);
		expect(dataValues(issues)).toContainEqual(
			expect.objectContaining({ code: "wire-edge-group-duplicate-dirty", causeId: "c1" }),
		);
	});

	it("wireEdgeGroup D501 fails closed for duplicate, data-before-dirty, competing, and incomplete causes", () => {
		const bytes = (...values: number[]) => new Uint8Array(values);
		const dataValues = <T>(messages: T[][]): unknown[] =>
			messages.filter((msg) => msg[0] === "DATA").map((msg) => msg[1]);
		const run = (name: string, frames: Record<string, unknown>[]) => {
			const g = graph();
			const bridge = wireBridge(g, { name: `${name}/bridge`, sessionId: "session-a" });
			const group = wireEdgeGroup(g, bridge, {
				name,
				edges: [{ edgeId: "a" }, { edgeId: "b" }],
			});
			const inbound: unknown[][] = [];
			const issues: unknown[][] = [];
			const status: unknown[][] = [];
			group.inbound.get("a")?.subscribe((msg) => inbound.push(msg as unknown[]));
			group.issues.subscribe((msg) => issues.push(msg as unknown[]));
			group.status.subscribe((msg) => status.push(msg as unknown[]));
			const envelope = (seq: number, frame: Record<string, unknown>) =>
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq,
					payload: { kind: "data", value: { kind: "wire_edge", frame } },
				});
			bridge.inbound.down(
				frames.map((frame, index) =>
					frame.kind === "close"
						? [
								"DATA",
								wireBridgeEnvelope({
									sessionId: "session-a",
									type: "close",
									seq: index + 1,
									payload: { kind: "close" },
								}),
							]
						: ["DATA", envelope(index + 1, frame)],
				),
			);
			return { inbound, issues, status, group };
		};
		const cases: [string, string, Record<string, unknown>[]][] = [
			[
				"dup-dirty",
				"wire-edge-group-duplicate-dirty",
				[
					{ kind: "dirty", edgeId: "a", causeId: "c1" },
					{ kind: "dirty", edgeId: "a", causeId: "c1" },
				],
			],
			[
				"dup-data",
				"wire-edge-group-duplicate-data",
				[
					{ kind: "dirty", edgeId: "a", causeId: "c1" },
					{ kind: "dirty", edgeId: "b", causeId: "c1" },
					{ kind: "data", edgeId: "a", causeId: "c1", value: bytes(1) },
					{ kind: "data", edgeId: "a", causeId: "c1", value: bytes(2) },
				],
			],
			[
				"data-before-dirty",
				"wire-edge-group-data-before-dirty",
				[{ kind: "data", edgeId: "a", causeId: "c1", value: bytes(1) }],
			],
			[
				"competing",
				"wire-edge-group-competing-cause",
				[
					{ kind: "dirty", edgeId: "a", causeId: "c1" },
					{ kind: "dirty", edgeId: "b", causeId: "c2" },
				],
			],
			[
				"incomplete",
				"wire-edge-group-incomplete-cause",
				[{ kind: "dirty", edgeId: "a", causeId: "c1" }, { kind: "close" }],
			],
		];
		for (const [name, code, frames] of cases) {
			const result = run(name, frames);
			expect(dataValues(result.inbound)).toEqual([]);
			expect(dataValues(result.issues)).toContainEqual(expect.objectContaining({ code }));
			expect(result.status.at(-1)).toEqual(["DATA", expect.objectContaining({ state: "issues" })]);
			expect(result.group.issues.status).not.toBe("errored");
			expect(result.group.status.status).not.toBe("errored");
		}
	});

	it("wireEdgeGroup D506 keeps only bounded recent replay tombstones", () => {
		const bytes = (...values: number[]) => new Uint8Array(values);
		const dataValues = <T>(messages: T[][]): unknown[] =>
			messages.filter((msg) => msg[0] === "DATA").map((msg) => msg[1]);
		const g = graph();
		const bridge = wireBridge(g, { name: "replayBridge", sessionId: "session-a" });
		const group = wireEdgeGroup(g, bridge, {
			name: "replayGroup",
			edges: [{ edgeId: "a" }],
		});
		const inbound: unknown[][] = [];
		const issues: unknown[][] = [];
		group.inbound.get("a")?.subscribe((msg) => inbound.push(msg as unknown[]));
		group.issues.subscribe((msg) => issues.push(msg as unknown[]));
		let seq = 1;
		const envelope = (causeId: string, kind: "dirty" | "data", value?: Uint8Array) =>
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "data",
				seq: seq++,
				payload: {
					kind: "data",
					value: {
						kind: "wire_edge",
						frame:
							kind === "dirty"
								? { kind, edgeId: "a", causeId }
								: { kind, edgeId: "a", causeId, value: value ?? bytes(0) },
					},
				},
			});
		const release = (causeId: string, value: Uint8Array) => {
			bridge.inbound.down([
				["DATA", envelope(causeId, "dirty")],
				["DATA", envelope(causeId, "data", value)],
			]);
		};

		release("c1", bytes(1));
		bridge.inbound.down([["DATA", envelope("c1", "dirty")]]);
		expect(dataValues(issues)).toContainEqual(
			expect.objectContaining({
				code: "wire-edge-group-duplicate-dirty",
				causeId: "c1",
			}),
		);

		for (let i = 2; i <= 1026; i++) release(`c${i}`, bytes(i % 256));
		const releaseCountBeforeOldReplay = dataValues(inbound).length;
		release("c1", bytes(99));

		expect(dataValues(inbound).length).toBe(releaseCountBeforeOldReplay + 1);
		expect(dataValues(inbound).at(-1)).toEqual(bytes(99));
	});

	it("wireEdgeGroup D501 is stable when status/issues subscribe before inbound edges", () => {
		const bytes = (...values: number[]) => new Uint8Array(values);
		const dataValues = <T>(messages: T[][]): unknown[] =>
			messages.filter((msg) => msg[0] === "DATA").map((msg) => msg[1]);
		const g = graph();
		const bridge = wireBridge(g, { name: "orderBridge", sessionId: "session-a" });
		const group = wireEdgeGroup(g, bridge, {
			name: "orderGroup",
			edges: [{ edgeId: "a" }, { edgeId: "b" }],
		});
		const issues: unknown[][] = [];
		const status: unknown[][] = [];
		const inbound: unknown[][] = [];
		group.status.subscribe((msg) => status.push(msg as unknown[]));
		group.issues.subscribe((msg) => issues.push(msg as unknown[]));
		group.inbound.get("a")?.subscribe((msg) => inbound.push(msg as unknown[]));
		const envelope = (seq: number, frame: Record<string, unknown>) =>
			wireBridgeEnvelope({
				sessionId: "session-a",
				type: "data",
				seq,
				payload: { kind: "data", value: { kind: "wire_edge", frame } },
			});
		bridge.inbound.down([
			["DATA", envelope(1, { kind: "dirty", edgeId: "a", causeId: "c1" })],
			["DATA", envelope(2, { kind: "dirty", edgeId: "b", causeId: "c1" })],
			["DATA", envelope(3, { kind: "data", edgeId: "a", causeId: "c1", value: bytes(1) })],
			["DATA", envelope(4, { kind: "data", edgeId: "b", causeId: "c1", value: bytes(2) })],
		]);
		expect(dataValues(inbound)).toEqual([bytes(1)]);
		expect(dataValues(issues)).toEqual([]);
		expect(status.at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ state: "released", released: 2 }),
		]);
	});
});
