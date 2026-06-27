import { describe, expect, it } from "vitest";
import {
	remoteCall,
	remoteResponder,
	remoteResponderHandler,
	wireBridge,
	wireBridgeEnvelope,
} from "../adapters/index.js";
import { graph } from "../graph/graph.js";
import { batch } from "../index.js";

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
		const errors: unknown[] = [];
		const status: unknown[] = [];
		remote.results.subscribe((msg) => results.push(msg));
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
		expect(errors).toContainEqual([
			"DATA",
			{
				operation: "upper",
				requestId: "req-1",
				error: "remoteCall: orphan response for unknown or completed request",
			},
		]);
		expect(status).toContainEqual([
			"DATA",
			expect.objectContaining({
				state: "errored",
				operation: "upper",
				requestId: "req-1",
				pending: 0,
				errors: 1,
			}),
		]);

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
		const errors: unknown[] = [];
		const status: unknown[] = [];
		remote.results.subscribe((msg) => results.push(msg));
		remote.errors.subscribe((msg) => errors.push(msg));
		remote.status.subscribe((msg) => status.push(msg));

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
		expect(errors).toContainEqual([
			"DATA",
			{
				operation: "upper",
				requestId: "req-1",
				error: "remoteCall: orphan response for unknown or completed request",
			},
		]);
		expect(status).toContainEqual([
			"DATA",
			expect.objectContaining({
				state: "errored",
				operation: "upper",
				requestId: "req-1",
				pending: 0,
				errors: 1,
			}),
		]);

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

	it("remoteCall requires operation correlation and keeps status responses non-terminal", () => {
		const g = graph();
		const bridge = wireBridge<
			{ operation: string; requestId: string; payload: string },
			{
				kind: "result" | "status";
				operation: string;
				requestId: string;
				payload?: string;
				status?: string;
			}
		>(g, { name: "bridge", sessionId: "session-a" });
		const remote = remoteCall<string, string>(g, bridge, { name: "rpc" });
		const results: unknown[] = [];
		const responses: unknown[] = [];
		const errors: unknown[] = [];
		const status: unknown[] = [];
		remote.results.subscribe((msg) => results.push(msg));
		remote.responses.subscribe((msg) => responses.push(msg));
		remote.errors.subscribe((msg) => errors.push(msg));
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
						value: {
							kind: "result",
							operation: "lower",
							requestId: "req-1",
							payload: "wrong",
						},
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
				error: "remoteCall: response operation 'lower' did not match pending operation 'upper'",
			},
		]);
		expect(status).toContainEqual([
			"DATA",
			expect.objectContaining({
				state: "errored",
				operation: "upper",
				requestId: "req-1",
				pending: 1,
				errors: 1,
			}),
		]);

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
							kind: "status",
							operation: "upper",
							requestId: "req-1",
							status: "working",
						},
					},
				}),
			],
		]);

		expect(responses).toContainEqual([
			"DATA",
			{ kind: "status", operation: "upper", requestId: "req-1", status: "working" },
		]);
		expect(status.at(-1)).toEqual([
			"DATA",
			{
				state: "requested",
				operation: "upper",
				requestId: "req-1",
				pending: 1,
				completed: 0,
				errors: 1,
				timeouts: 0,
			},
		]);

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope({
					sessionId: "session-a",
					type: "data",
					seq: 3,
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

	it("remoteCall surfaces malformed responses for unknown request ids without buffering", () => {
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

		expect(errors).toContainEqual([
			"DATA",
			{
				operation: "upper",
				requestId: "req-unknown",
				error: "remoteCall: response payload is malformed",
			},
		]);
		expect(status).toContainEqual([
			"DATA",
			expect.objectContaining({
				state: "errored",
				operation: "upper",
				requestId: "req-unknown",
				pending: 0,
				errors: 1,
			}),
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
