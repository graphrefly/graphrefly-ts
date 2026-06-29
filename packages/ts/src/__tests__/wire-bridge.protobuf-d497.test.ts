import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	CanonicalProtobufError,
	decodeCanonicalWireBridgeEnvelope,
	decodeCanonicalWireEdgeFrame,
	encodeCanonicalWireBridgeEnvelope,
	encodeCanonicalWireEdgeFrame,
	type WireBridgeProtobufData,
	wireBridge,
	wireBridgeEnvelope,
	wireBridgeProtobuf,
	wireEdgeGroup,
} from "../adapters/index.js";
import { batch } from "../batch/batch.js";
import { depBatch } from "../ctx/types.js";
import { graph } from "../graph/graph.js";

interface VectorRecord {
	readonly schema: "graphrefly.protobuf.golden.v1";
	readonly id: string;
	readonly message: "WireBridgeEnvelope" | "WireEdgeFrame";
	readonly description: string;
	readonly hex: string;
	readonly canonical: boolean;
	readonly errorCategory?: string;
	readonly expect?: { readonly payload?: string };
}

const envelopeFixtureUrl = new URL(
	"./fixtures/protobuf/wire_bridge_envelope.v1.jsonl",
	import.meta.url,
);
const wireEdgeFixtureUrl = new URL("./fixtures/protobuf/wire_edge_frame.v1.jsonl", import.meta.url);

function vectors(fixtureUrl: URL, message: VectorRecord["message"]): VectorRecord[] {
	return readFileSync(fixtureUrl, "utf8")
		.trim()
		.split("\n")
		.map((line, index) => {
			const record = JSON.parse(line) as VectorRecord;
			expect(record.schema, `schema line ${index + 1}`).toBe("graphrefly.protobuf.golden.v1");
			expect(record.message, `message line ${index + 1}`).toBe(message);
			expect(record.id, `id line ${index + 1}`).toMatch(/^(positive|negative)\./);
			expect(record.hex, `hex line ${index + 1}`).toMatch(/^(?:[0-9a-f]{2})+$/);
			if (record.canonical) {
				expect(record.errorCategory, `${record.id} must not declare an error`).toBeUndefined();
			} else {
				expect(record.errorCategory, `${record.id} must declare an error`).toBeTypeOf("string");
			}
			return record;
		});
}

function fromHex(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

function toHex(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("hex");
}

type TestMessage = readonly [string, ...unknown[]];

function dataMessages(messages: readonly unknown[]): TestMessage[] {
	return messages.filter((msg): msg is TestMessage => Array.isArray(msg) && msg[0] === "DATA");
}

function vectorById(message: VectorRecord["message"], id: string): VectorRecord {
	const fixtureUrl = message === "WireBridgeEnvelope" ? envelopeFixtureUrl : wireEdgeFixtureUrl;
	const record = vectors(fixtureUrl, message).find((candidate) => candidate.id === id);
	if (record === undefined) throw new Error(`missing fixture ${id}`);
	return record;
}

const canonicalInboundBytes = () =>
	fromHex(vectorById("WireBridgeEnvelope", "positive.data.empty_value").hex);

const malformedInboundBytes = () =>
	fromHex(vectorById("WireBridgeEnvelope", "negative.old_wireframe_shape").hex);

describe("D497 canonical protobuf wire bridge envelope vectors", () => {
	it("parses fixture records with stable schema fields", () => {
		const records = vectors(envelopeFixtureUrl, "WireBridgeEnvelope");
		expect(records.some((record) => record.canonical)).toBe(true);
		expect(records.some((record) => !record.canonical)).toBe(true);
	});

	it.each(
		vectors(envelopeFixtureUrl, "WireBridgeEnvelope").filter((record) => record.canonical),
	)("decodes, validates, and re-encodes $id byte-for-byte", (record) => {
		const bytes = fromHex(record.hex);
		const decoded = decodeCanonicalWireBridgeEnvelope(bytes);
		const encoded = encodeCanonicalWireBridgeEnvelope(decoded);

		expect(toHex(encoded)).toBe(record.hex);
		if (record.expect?.payload === "data.value") {
			expect(decoded.payload.kind).toBe("data");
			expect(decoded.payload.kind === "data" && decoded.payload.body.kind).toBe("value");
		}
		if (record.expect?.payload === "data.wire_edge.dirty") {
			expect(decoded.payload.kind).toBe("data");
			expect(decoded.payload.kind === "data" && decoded.payload.body.kind).toBe("wire_edge");
			if (decoded.payload.kind === "data" && decoded.payload.body.kind === "wire_edge") {
				expect(decoded.payload.body.frame.kind).toBe("dirty");
			}
		}
		if (record.expect?.payload === "data.wire_edge.data") {
			expect(decoded.payload.kind).toBe("data");
			expect(decoded.payload.kind === "data" && decoded.payload.body.kind).toBe("wire_edge");
			if (decoded.payload.kind !== "data" || decoded.payload.body.kind !== "wire_edge") return;
			expect(decoded.payload.body.frame.kind).toBe("data");
			expect(decoded.payload.body.frame.value).toBeInstanceOf(Uint8Array);
		}
	});

	it.each(
		vectors(envelopeFixtureUrl, "WireBridgeEnvelope").filter((record) => !record.canonical),
	)("rejects $id as $errorCategory", (record) => {
		try {
			decodeCanonicalWireBridgeEnvelope(fromHex(record.hex));
		} catch (error) {
			expect(error).toBeInstanceOf(CanonicalProtobufError);
			expect((error as CanonicalProtobufError).category).toBe(record.errorCategory);
			return;
		}
		throw new Error(`${record.id} unexpectedly decoded`);
	});
});

describe("D497 canonical protobuf wire-edge frame vectors", () => {
	it("parses standalone WireEdgeFrame fixture records", () => {
		const records = vectors(wireEdgeFixtureUrl, "WireEdgeFrame");
		expect(records.some((record) => record.canonical)).toBe(true);
		expect(records.some((record) => !record.canonical)).toBe(true);
	});

	it.each(
		vectors(wireEdgeFixtureUrl, "WireEdgeFrame").filter((record) => record.canonical),
	)("decodes, validates, and re-encodes $id byte-for-byte", (record) => {
		const bytes = fromHex(record.hex);
		const decoded = decodeCanonicalWireEdgeFrame(bytes);
		const encoded = encodeCanonicalWireEdgeFrame(decoded);

		expect(toHex(encoded)).toBe(record.hex);
	});

	it.each(
		vectors(wireEdgeFixtureUrl, "WireEdgeFrame").filter((record) => !record.canonical),
	)("rejects $id as $errorCategory", (record) => {
		try {
			decodeCanonicalWireEdgeFrame(fromHex(record.hex));
		} catch (error) {
			expect(error).toBeInstanceOf(CanonicalProtobufError);
			expect((error as CanonicalProtobufError).category).toBe(record.errorCategory);
			return;
		}
		throw new Error(`${record.id} unexpectedly decoded`);
	});

	it("rejects invalid TS DTOs before writing bytes", () => {
		expect(() =>
			encodeCanonicalWireBridgeEnvelope({
				sessionId: "s1",
				metadata: {
					seq: -1n,
					cursor: 0n,
					idempotencyKey: "s1:1",
					attempt: 1,
					maxAttempts: 1,
				},
				payload: { kind: "start" },
			}),
		).toThrow(CanonicalProtobufError);
		expect(() =>
			encodeCanonicalWireBridgeEnvelope({
				sessionId: "s1",
				metadata: {
					seq: 1n,
					cursor: 0n,
					idempotencyKey: "s1:1",
					attempt: -1,
					maxAttempts: 1,
				},
				payload: { kind: "start" },
			}),
		).toThrow(CanonicalProtobufError);
		expect(() =>
			encodeCanonicalWireBridgeEnvelope({
				sessionId: "s1",
				metadata: {
					seq: 1n,
					cursor: 0n,
					idempotencyKey: "s1:1",
					attempt: 1,
					maxAttempts: 1,
				},
				payload: { kind: "bogus" } as never,
			}),
		).toThrow(CanonicalProtobufError);
		expect(() =>
			encodeCanonicalWireBridgeEnvelope({
				sessionId: "s1",
				metadata: {
					seq: 1n,
					cursor: 0n,
					idempotencyKey: "s1:1",
					attempt: 1,
					maxAttempts: 1,
					ackForSeq: 1n,
				},
				payload: { kind: "nack", error: new Uint8Array() },
			}),
		).toThrow(CanonicalProtobufError);
		expect(() =>
			encodeCanonicalWireBridgeEnvelope({
				sessionId: "s1",
				metadata: {
					seq: 1n,
					cursor: 0n,
					idempotencyKey: "s1:1",
					attempt: 1,
					maxAttempts: 1,
				},
				payload: { kind: "status", status: new Uint8Array() },
			}),
		).toThrow(CanonicalProtobufError);
		expect(() =>
			encodeCanonicalWireBridgeEnvelope({
				sessionId: "s1",
				metadata: {
					seq: 1n,
					cursor: 0n,
					idempotencyKey: "s1:1",
					attempt: 1,
					maxAttempts: 1,
				},
				payload: { kind: "error", error: new Uint8Array() },
			}),
		).toThrow(CanonicalProtobufError);
		expect(() =>
			encodeCanonicalWireBridgeEnvelope({
				sessionId: "s1",
				metadata: {
					seq: 1n,
					cursor: 0n,
					idempotencyKey: "s1:1",
					attempt: 1,
					maxAttempts: 1,
				},
				payload: { kind: "close", reason: new Uint8Array() },
			}),
		).toThrow(CanonicalProtobufError);
		expect(() =>
			encodeCanonicalWireEdgeFrame({
				kind: "bogus" as never,
				edgeId: "edge-a",
				causeId: "cause-1",
			}),
		).toThrow(CanonicalProtobufError);
		expect(() =>
			encodeCanonicalWireBridgeEnvelope({
				sessionId: "s1",
				metadata: {
					seq: 1n,
					cursor: 0n,
					idempotencyKey: "s1:1",
					attempt: 1,
					maxAttempts: 1,
					ackForSeq: 1n,
				},
				payload: { kind: "nack", error: new Uint8Array() },
			}),
		).toThrow(CanonicalProtobufError);
	});
});

describe("D498 wireBridgeProtobuf focused helper", () => {
	it("decodes canonical inbound bytes into the existing semantic wireBridge inbound fact lane", () => {
		const g = graph();
		const bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g, {
			name: "bridge",
			sessionId: "s1",
		});
		const protobuf = wireBridgeProtobuf(g, bridge, { name: "bridge/protobuf" });
		const inbound: unknown[] = [];
		const issues: unknown[] = [];
		const status: unknown[] = [];
		bridge.inbound.subscribe((msg) => inbound.push(msg));
		protobuf.issues.subscribe((msg) => issues.push(msg));
		protobuf.status.subscribe((msg) => status.push(msg));

		protobuf.inboundBytes.down([["DATA", canonicalInboundBytes()]]);

		expect(dataMessages(issues)).toEqual([]);
		expect(dataMessages(inbound)).toContainEqual([
			"DATA",
			expect.objectContaining({
				sessionId: "s1",
				type: "data",
				payload: { kind: "data", value: { kind: "value", value: new Uint8Array() } },
			}),
		]);
		expect(dataMessages(status).at(-1)).toEqual([
			"DATA",
			{ decoded: 1, encoded: 0, issues: 0, state: "active" },
		]);
	});

	it("emits one status fact for each protobuf observation in a multi-DATA wave", () => {
		const g = graph();
		const bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g, {
			name: "bridge",
			sessionId: "s1",
		});
		const protobuf = wireBridgeProtobuf(g, bridge, { name: "bridge/protobuf" });
		const status: unknown[] = [];
		protobuf.status.subscribe((msg) => status.push(msg));

		protobuf.inboundBytes.down([
			["DATA", canonicalInboundBytes()],
			["DATA", malformedInboundBytes()],
		]);

		expect(dataMessages(status)).toEqual([
			["DATA", { decoded: 1, encoded: 0, issues: 0, state: "active" }],
			[
				"DATA",
				{
					decoded: 1,
					encoded: 0,
					issues: 1,
					state: "issues",
					lastIssue: expect.objectContaining({
						direction: "inbound",
						operation: "decode",
						category: "unknown_field",
					}),
				},
			],
		]);
	});

	it("does not fabricate protobuf status facts for semantic bridge-only inbound activity", () => {
		const g = graph();
		const bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g, {
			name: "bridge",
			sessionId: "s1",
		});
		const protobuf = wireBridgeProtobuf(g, bridge, { name: "bridge/protobuf" });
		const status: unknown[] = [];
		protobuf.status.subscribe((msg) => status.push(msg));

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope<WireBridgeProtobufData>({
					sessionId: "s1",
					type: "data",
					seq: 1,
					payload: { kind: "data", value: { kind: "value", value: new Uint8Array([1]) } },
				}),
			],
		]);

		expect(dataMessages(status)).toEqual([]);
	});

	it("turns malformed inbound bytes into issue and invalid facts, not protocol terminals", () => {
		const g = graph();
		const bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g, {
			name: "bridge",
			sessionId: "s1",
		});
		const protobuf = wireBridgeProtobuf(g, bridge, { name: "bridge/protobuf" });
		const bridgeErrors: unknown[] = [];
		const bridgeEvents: unknown[] = [];
		const issues: unknown[] = [];
		const status: unknown[] = [];
		bridge.errors.subscribe((msg) => bridgeErrors.push(msg));
		bridge.events.subscribe((msg) => bridgeEvents.push(msg));
		protobuf.issues.subscribe((msg) => issues.push(msg));
		protobuf.status.subscribe((msg) => status.push(msg));

		protobuf.inboundBytes.down([["DATA", malformedInboundBytes()]]);

		expect(dataMessages(issues)).toContainEqual([
			"DATA",
			expect.objectContaining({
				direction: "inbound",
				operation: "decode",
				category: "unknown_field",
			}),
		]);
		expect(dataMessages(status).at(-1)).toEqual([
			"DATA",
			{
				decoded: 0,
				encoded: 0,
				issues: 1,
				state: "issues",
				lastIssue: expect.objectContaining({
					direction: "inbound",
					operation: "decode",
					category: "unknown_field",
				}),
			},
		]);
		expect(dataMessages(bridgeErrors)).toContainEqual([
			"DATA",
			expect.stringContaining("WireBridgeDataPayload contains unknown field 10"),
		]);
		expect(bridgeEvents).not.toContainEqual(["ERROR", expect.anything()]);
		expect(bridgeEvents).not.toContainEqual(["COMPLETE"]);
		expect(issues).not.toContainEqual(["ERROR", expect.anything()]);
		expect(issues).not.toContainEqual(["COMPLETE"]);
		expect(status).not.toContainEqual(["ERROR", expect.anything()]);
		expect(status).not.toContainEqual(["COMPLETE"]);
	});

	it("keeps malformed inbound issue fanout when bridge inbound subscribes before protobuf side facts", () => {
		const g = graph();
		const bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g, {
			name: "bridge",
			sessionId: "s1",
		});
		const protobuf = wireBridgeProtobuf(g, bridge, { name: "bridge/protobuf" });
		const inbound: unknown[] = [];
		const issues: unknown[] = [];
		const status: unknown[] = [];
		bridge.inbound.subscribe((msg) => inbound.push(msg));
		protobuf.issues.subscribe((msg) => issues.push(msg));
		protobuf.status.subscribe((msg) => status.push(msg));

		protobuf.inboundBytes.down([["DATA", malformedInboundBytes()]]);

		expect(dataMessages(inbound)).toContainEqual([
			"DATA",
			expect.objectContaining({ __wireBridgeInvalidIngress: true }),
		]);
		expect(dataMessages(issues)).toContainEqual([
			"DATA",
			expect.objectContaining({ direction: "inbound", operation: "decode" }),
		]);
		expect(dataMessages(status).at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ issues: 1, state: "issues" }),
		]);
	});

	it("keeps malformed inbound issue fanout when protobuf side facts subscribe before bridge inbound", () => {
		const g = graph();
		const bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g, {
			name: "bridge",
			sessionId: "s1",
		});
		const protobuf = wireBridgeProtobuf(g, bridge, { name: "bridge/protobuf" });
		const inbound: unknown[] = [];
		const issues: unknown[] = [];
		const status: unknown[] = [];
		protobuf.issues.subscribe((msg) => issues.push(msg));
		protobuf.status.subscribe((msg) => status.push(msg));
		bridge.inbound.subscribe((msg) => inbound.push(msg));

		protobuf.inboundBytes.down([["DATA", malformedInboundBytes()]]);

		expect(dataMessages(inbound)).toContainEqual([
			"DATA",
			expect.objectContaining({ __wireBridgeInvalidIngress: true }),
		]);
		expect(dataMessages(issues)).toContainEqual([
			"DATA",
			expect.objectContaining({ direction: "inbound", operation: "decode" }),
		]);
		expect(dataMessages(status).at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ issues: 1, state: "issues" }),
		]);
	});

	it("lets protobuf issues/status alone activate malformed inbound decoding", () => {
		const g = graph();
		const bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g, {
			name: "bridge",
			sessionId: "s1",
		});
		const protobuf = wireBridgeProtobuf(g, bridge, { name: "bridge/protobuf" });
		const issues: unknown[] = [];
		const status: unknown[] = [];
		protobuf.issues.subscribe((msg) => issues.push(msg));
		protobuf.status.subscribe((msg) => status.push(msg));

		protobuf.inboundBytes.down([["DATA", malformedInboundBytes()]]);

		expect(dataMessages(issues)).toContainEqual([
			"DATA",
			expect.objectContaining({ direction: "inbound", operation: "decode" }),
		]);
		expect(dataMessages(status).at(-1)).toEqual([
			"DATA",
			expect.objectContaining({ issues: 1, state: "issues" }),
		]);
	});

	it("encodes outbound semantic byte payloads and preserves valid empty DATA bytes", () => {
		const g = graph();
		const bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g, {
			name: "bridge",
			sessionId: "s1",
			now: () => 1,
		});
		const protobuf = wireBridgeProtobuf(g, bridge, { name: "bridge/protobuf" });
		const outboundBytes: unknown[] = [];
		const issues: unknown[] = [];
		protobuf.outboundBytes.subscribe((msg) => outboundBytes.push(msg));
		protobuf.issues.subscribe((msg) => issues.push(msg));

		bridge.send(new Uint8Array(), { requestId: "req-empty" });

		expect(dataMessages(issues)).toEqual([]);
		const bytes = dataMessages(outboundBytes).at(-1)?.[1] as Uint8Array;
		const decoded = decodeCanonicalWireBridgeEnvelope(bytes);
		expect(decoded.payload.kind).toBe("data");
		if (decoded.payload.kind !== "data") return;
		expect(decoded.payload.body).toEqual({ kind: "value", value: new Uint8Array() });
		expect(toHex(encodeCanonicalWireBridgeEnvelope(decoded))).toBe(toHex(bytes));
	});

	it("encodes outbound wire-edge DTOs without introducing a WireEdgeGroup runtime", () => {
		const g = graph();
		const bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g, {
			name: "bridge",
			sessionId: "s1",
			now: () => 1,
		});
		const protobuf = wireBridgeProtobuf(g, bridge, { name: "bridge/protobuf" });
		const outboundBytes: unknown[] = [];
		protobuf.outboundBytes.subscribe((msg) => outboundBytes.push(msg));

		bridge.send({
			kind: "wire_edge",
			frame: { kind: "data", edgeId: "edge-a", causeId: "cause-1", value: new Uint8Array() },
		});

		const decoded = decodeCanonicalWireBridgeEnvelope(
			dataMessages(outboundBytes).at(-1)?.[1] as Uint8Array,
		);
		expect(decoded.payload.kind).toBe("data");
		if (decoded.payload.kind !== "data") return;
		expect(decoded.payload.body).toEqual({
			kind: "wire_edge",
			frame: {
				kind: "data",
				edgeId: "edge-a",
				causeId: "cause-1",
				value: new Uint8Array(),
			},
		});
		expect(g.describe().nodes.map((node) => node.factory)).not.toContain("WireEdgeGroup");
	});

	it("reports outbound encode issues for non-canonical semantic payloads", () => {
		const g = graph();
		const bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g, {
			name: "bridge",
			sessionId: "s1",
		});
		const protobuf = wireBridgeProtobuf(g, bridge, { name: "bridge/protobuf" });
		const outboundBytes: unknown[] = [];
		const issues: unknown[] = [];
		const status: unknown[] = [];
		protobuf.outboundBytes.subscribe((msg) => outboundBytes.push(msg));
		protobuf.issues.subscribe((msg) => issues.push(msg));
		protobuf.status.subscribe((msg) => status.push(msg));

		bridge.send({ unsafe: true } as never);

		expect(dataMessages(outboundBytes)).toEqual([]);
		expect(dataMessages(issues)).toContainEqual([
			"DATA",
			expect.objectContaining({
				direction: "outbound",
				operation: "encode",
				category: "malformed",
			}),
		]);
		expect(dataMessages(status).at(-1)).toEqual([
			"DATA",
			{
				decoded: 0,
				encoded: 0,
				issues: 1,
				state: "issues",
				lastIssue: expect.objectContaining({
					direction: "outbound",
					operation: "encode",
					category: "malformed",
				}),
			},
		]);
	});

	it("keeps helper describe shape focused beside bridge core nodes", () => {
		const g = graph();
		const bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g, {
			name: "bridge",
			sessionId: "s1",
		});
		wireBridgeProtobuf(g, bridge, { name: "bridge/protobuf" });

		const snap = g.describe();
		expect(snap.nodes).toContainEqual(
			expect.objectContaining({
				id: "bridge/protobuf/inboundBytes",
				factory: "wireBridgeProtobufInboundBytes",
			}),
		);
		expect(snap.nodes).toContainEqual(
			expect.objectContaining({ id: "bridge/inbound", factory: "wireBridgeInbound" }),
		);
		expect(snap.edges).toContainEqual({
			from: "bridge/protobuf/inboundDecoded",
			to: "bridge/inbound",
		});
		expect(snap.edges).toContainEqual({
			from: "bridge/protobuf/inboundBytes",
			to: "bridge/protobuf/inboundResults",
		});
		expect(snap.edges).toContainEqual({
			from: "bridge/protobuf/inboundResults",
			to: "bridge/protobuf/inboundEvents",
		});
		expect(snap.edges).toContainEqual({
			from: "bridge/protobuf/inboundEvents",
			to: "bridge/protobuf/issues",
		});
		expect(snap.edges).toContainEqual({
			from: "bridge/protobuf/inboundEvents",
			to: "bridge/protobuf/status",
		});
		expect(snap.edges).toContainEqual({
			from: "bridge/outbound",
			to: "bridge/protobuf/outboundResults",
		});
		expect(snap.edges).toContainEqual({
			from: "bridge/protobuf/outboundResults",
			to: "bridge/protobuf/outboundEvents",
		});
		expect(snap.edges).toContainEqual({
			from: "bridge/protobuf/outboundEvents",
			to: "bridge/protobuf/outboundBytes",
		});
		expect(snap.nodes.filter((node) => node.factory === "wireBridgeEvents")).toHaveLength(1);
	});

	it("describe explain shows protobuf issue/status causal paths through result and event lanes", () => {
		const g = graph();
		const bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g, {
			name: "bridge",
			sessionId: "s1",
		});
		wireBridgeProtobuf(g, bridge, { name: "bridge/protobuf" });

		const issuePath = g.describe({
			explain: { from: "bridge/protobuf/inboundBytes", to: "bridge/protobuf/issues" },
		});
		expect(issuePath.nodes.map((node) => node.id)).toEqual(
			expect.arrayContaining([
				"bridge/protobuf/inboundBytes",
				"bridge/protobuf/inboundEvents",
				"bridge/protobuf/inboundResults",
				"bridge/protobuf/issues",
			]),
		);
		expect(issuePath.edges).toEqual(
			expect.arrayContaining([
				{ from: "bridge/protobuf/inboundBytes", to: "bridge/protobuf/inboundResults" },
				{ from: "bridge/protobuf/inboundResults", to: "bridge/protobuf/inboundEvents" },
				{ from: "bridge/protobuf/inboundEvents", to: "bridge/protobuf/issues" },
			]),
		);

		const statusPath = g.describe({
			explain: { from: "bridge/protobuf/inboundBytes", to: "bridge/protobuf/status" },
		});
		expect(statusPath.nodes.map((node) => node.id)).toEqual(
			expect.arrayContaining([
				"bridge/protobuf/inboundBytes",
				"bridge/protobuf/inboundEvents",
				"bridge/protobuf/inboundResults",
				"bridge/protobuf/status",
			]),
		);
		expect(statusPath.edges).toEqual(
			expect.arrayContaining([
				{ from: "bridge/protobuf/inboundBytes", to: "bridge/protobuf/inboundResults" },
				{ from: "bridge/protobuf/inboundResults", to: "bridge/protobuf/inboundEvents" },
				{ from: "bridge/protobuf/inboundEvents", to: "bridge/protobuf/status" },
			]),
		);

		const outboundIssuePath = g.describe({
			explain: { from: "bridge/outbound", to: "bridge/protobuf/issues" },
		});
		expect(outboundIssuePath.edges).toEqual(
			expect.arrayContaining([
				{ from: "bridge/outbound", to: "bridge/protobuf/outboundResults" },
				{ from: "bridge/protobuf/outboundResults", to: "bridge/protobuf/outboundEvents" },
				{ from: "bridge/protobuf/outboundEvents", to: "bridge/protobuf/issues" },
			]),
		);

		const outboundStatusPath = g.describe({
			explain: { from: "bridge/outbound", to: "bridge/protobuf/status" },
		});
		expect(outboundStatusPath.edges).toEqual(
			expect.arrayContaining([
				{ from: "bridge/outbound", to: "bridge/protobuf/outboundResults" },
				{ from: "bridge/protobuf/outboundResults", to: "bridge/protobuf/outboundEvents" },
				{ from: "bridge/protobuf/outboundEvents", to: "bridge/protobuf/status" },
			]),
		);
	});

	it("C-1 TS mixed-locality bridge diamond stays coherent over FIFO protobuf WireEdgeGroup pumps", () => {
		const text = new TextEncoder();
		const decode = new TextDecoder();
		const bytes = (value: string) => text.encode(value);
		const stringOf = (value: Uint8Array) => decode.decode(value);
		type TraceRow = {
			readonly direction: "g1_to_g2" | "g2_to_g1";
			readonly queueIndex: number;
			readonly seq: bigint;
			readonly edgeId?: string;
			readonly causeId?: string;
			readonly frameKind?: "dirty" | "data";
			readonly value?: string;
		};
		const trace: TraceRow[] = [];
		const captureBytes = (messages: unknown[], queue: Uint8Array[]) => {
			for (const msg of dataMessages(messages)) queue.push(Uint8Array.from(msg[1] as Uint8Array));
			messages.length = 0;
		};
		const pumpOne = (
			direction: TraceRow["direction"],
			queue: Uint8Array[],
			target: { down(msgs: readonly [readonly ["DATA", Uint8Array]]): void },
		) => {
			const item = queue.shift();
			if (item === undefined) throw new Error(`empty ${direction} queue`);
			const decoded = decodeCanonicalWireBridgeEnvelope(item);
			expect(toHex(encodeCanonicalWireBridgeEnvelope(decoded))).toBe(toHex(item));
			const payload = decoded.payload;
			const row: TraceRow = {
				direction,
				queueIndex: trace.filter((entry) => entry.direction === direction).length,
				seq: decoded.metadata.seq,
				...(payload.kind === "data" && payload.body.kind === "wire_edge"
					? {
							edgeId: payload.body.frame.edgeId,
							causeId: payload.body.frame.causeId,
							frameKind: payload.body.frame.kind,
							value:
								payload.body.frame.kind === "data"
									? stringOf(payload.body.frame.value ?? new Uint8Array())
									: undefined,
						}
					: {}),
			};
			trace.push(row);
			target.down([["DATA", item]]);
		};
		const pumpAll = (
			direction: TraceRow["direction"],
			queue: Uint8Array[],
			target: { down(msgs: readonly [readonly ["DATA", Uint8Array]]): void },
		) => {
			while (queue.length > 0) pumpOne(direction, queue, target);
		};
		const causeFrames = (direction: TraceRow["direction"], causeId: string) =>
			trace.filter((row) => row.direction === direction && row.causeId === causeId);

		const g1 = graph();
		const g2 = graph();
		const a = g1.node<Uint8Array>([], null, { name: "g1/A" });
		const aToB = g1.node<Uint8Array>(
			[a],
			(ctx) => {
				for (const value of depBatch(ctx, 0) ?? [])
					ctx.down([["DATA", Uint8Array.from(value as Uint8Array)]]);
			},
			{ name: "g1/A_to_B" },
		);
		const aToC = g1.node<Uint8Array>(
			[a],
			(ctx) => {
				for (const value of depBatch(ctx, 0) ?? [])
					ctx.down([["DATA", Uint8Array.from(value as Uint8Array)]]);
			},
			{ name: "g1/A_to_C" },
		);

		const g1ToG2Bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g1, {
			name: "g1/to_g2/bridge",
			sessionId: "g1-to-g2",
		});
		const g1ToG2Bytes = wireBridgeProtobuf(g1, g1ToG2Bridge, {
			name: "g1/to_g2/protobuf",
		});
		wireEdgeGroup(g1, g1ToG2Bridge, {
			name: "g1/split",
			edges: [
				{ edgeId: "A:B", outbound: aToB },
				{ edgeId: "A:C", outbound: aToC },
			],
		});
		const g2FromG1Bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g2, {
			name: "g2/from_g1/bridge",
			sessionId: "g1-to-g2",
		});
		const g2FromG1Bytes = wireBridgeProtobuf(g2, g2FromG1Bridge, {
			name: "g2/from_g1/protobuf",
		});
		const g2Inbound = wireEdgeGroup(g2, g2FromG1Bridge, {
			name: "g2/inbound_split",
			edges: [{ edgeId: "A:B" }, { edgeId: "A:C" }],
		});
		const inboundAB = g2Inbound.inbound.get("A:B");
		const inboundAC = g2Inbound.inbound.get("A:C");
		if (inboundAB === undefined || inboundAC === undefined) throw new Error("missing g2 inbound");
		const b = g2.node<Uint8Array>(
			[inboundAB],
			(ctx) => {
				for (const value of depBatch(ctx, 0) ?? [])
					ctx.down([["DATA", bytes(`B(${stringOf(value as Uint8Array)})`)]]);
			},
			{ name: "g2/B" },
		);
		const c = g2.node<Uint8Array>(
			[inboundAC],
			(ctx) => {
				for (const value of depBatch(ctx, 0) ?? [])
					ctx.down([["DATA", bytes(`C(${stringOf(value as Uint8Array)})`)]]);
			},
			{ name: "g2/C" },
		);
		const g2ToG1Bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g2, {
			name: "g2/to_g1/bridge",
			sessionId: "g2-to-g1",
		});
		const g2ToG1Bytes = wireBridgeProtobuf(g2, g2ToG1Bridge, {
			name: "g2/to_g1/protobuf",
		});
		wireEdgeGroup(g2, g2ToG1Bridge, {
			name: "g2/join_out",
			edges: [
				{ edgeId: "B:D", outbound: b },
				{ edgeId: "C:D", outbound: c },
			],
		});
		const g1FromG2Bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g1, {
			name: "g1/from_g2/bridge",
			sessionId: "g2-to-g1",
		});
		const g1FromG2Bytes = wireBridgeProtobuf(g1, g1FromG2Bridge, {
			name: "g1/from_g2/protobuf",
		});
		const g1Inbound = wireEdgeGroup(g1, g1FromG2Bridge, {
			name: "g1/inbound_join",
			edges: [{ edgeId: "B:D" }, { edgeId: "C:D" }],
		});
		const inboundBD = g1Inbound.inbound.get("B:D");
		const inboundCD = g1Inbound.inbound.get("C:D");
		if (inboundBD === undefined || inboundCD === undefined) throw new Error("missing g1 inbound");
		let dRuns = 0;
		const d = g1.node<string>(
			[inboundBD, inboundCD],
			(ctx) => {
				dRuns++;
				const bBatch = depBatch(ctx, 0);
				const cBatch = depBatch(ctx, 1);
				if (bBatch && cBatch) {
					ctx.down([
						[
							"DATA",
							`${stringOf(bBatch.at(-1) as Uint8Array)}|${stringOf(cBatch.at(-1) as Uint8Array)}`,
						],
					]);
				}
			},
			{ name: "g1/D" },
		);

		const g1ToG2Queue: Uint8Array[] = [];
		const g2ToG1Queue: Uint8Array[] = [];
		const g1ToG2Out: unknown[] = [];
		const g2ToG1Out: unknown[] = [];
		const g2InboundStatus: unknown[] = [];
		const g1InboundStatus: unknown[] = [];
		const dMessages: unknown[] = [];
		g1ToG2Bytes.outboundBytes.subscribe((msg) => g1ToG2Out.push(msg));
		g2ToG1Bytes.outboundBytes.subscribe((msg) => g2ToG1Out.push(msg));
		g2Inbound.status.subscribe((msg) => g2InboundStatus.push(msg));
		g1Inbound.status.subscribe((msg) => g1InboundStatus.push(msg));
		d.subscribe((msg) => dMessages.push(msg));

		a.down([["DATA", bytes("a0")]]);
		captureBytes(g1ToG2Out, g1ToG2Queue);
		pumpAll("g1_to_g2", g1ToG2Queue, g2FromG1Bytes.inboundBytes);
		captureBytes(g2ToG1Out, g2ToG1Queue);
		pumpAll("g2_to_g1", g2ToG1Queue, g1FromG2Bytes.inboundBytes);
		expect(dataMessages(dMessages).map((msg) => msg[1])).toEqual(["B(a0)|C(a0)"]);

		dMessages.length = 0;
		dRuns = 0;
		g2InboundStatus.length = 0;
		g1InboundStatus.length = 0;
		trace.length = 0;
		batch(() => {
			a.down([["DATA", bytes("a1")]]);
		});
		captureBytes(g1ToG2Out, g1ToG2Queue);

		pumpOne("g1_to_g2", g1ToG2Queue, g2FromG1Bytes.inboundBytes);
		expect(dRuns).toBe(0);
		expect(dataMessages(dMessages)).toEqual([]);
		expect(g2ToG1Queue).toEqual([]);
		expect(dataMessages(g2InboundStatus).at(-1)?.[1]).toEqual(
			expect.objectContaining({ state: "collecting", dirty: 1, data: 0, released: 2 }),
		);

		pumpAll("g1_to_g2", g1ToG2Queue, g2FromG1Bytes.inboundBytes);
		captureBytes(g2ToG1Out, g2ToG1Queue);
		expect(dRuns).toBe(0);
		expect(dataMessages(dMessages)).toEqual([]);
		expect(dataMessages(g2InboundStatus).at(-1)?.[1]).toEqual(
			expect.objectContaining({ state: "released", released: 4 }),
		);

		pumpOne("g2_to_g1", g2ToG1Queue, g1FromG2Bytes.inboundBytes);
		expect(dRuns).toBe(0);
		expect(dataMessages(dMessages)).toEqual([]);

		pumpAll("g2_to_g1", g2ToG1Queue, g1FromG2Bytes.inboundBytes);
		expect(dRuns).toBe(1);
		expect(dataMessages(dMessages).map((msg) => msg[1])).toEqual(["B(a1)|C(a1)"]);
		expect(dataMessages(g1InboundStatus).at(-1)?.[1]).toEqual(
			expect.objectContaining({ state: "released", released: 4 }),
		);

		const g1Cause = trace.find((row) => row.direction === "g1_to_g2" && row.causeId)?.causeId;
		const g2Cause = trace.find((row) => row.direction === "g2_to_g1" && row.causeId)?.causeId;
		if (g1Cause === undefined || g2Cause === undefined) throw new Error("missing stimulus causes");
		expect(causeFrames("g1_to_g2", g1Cause).map((row) => row.frameKind)).toEqual([
			"dirty",
			"dirty",
			"data",
			"data",
		]);
		expect(causeFrames("g2_to_g1", g2Cause).map((row) => row.frameKind)).toEqual([
			"dirty",
			"dirty",
			"data",
			"data",
		]);
		expect(causeFrames("g1_to_g2", g1Cause).filter((row) => row.frameKind === "data")).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ edgeId: "A:B", value: "a1" }),
				expect.objectContaining({ edgeId: "A:C", value: "a1" }),
			]),
		);
		expect(causeFrames("g2_to_g1", g2Cause).filter((row) => row.frameKind === "data")).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ edgeId: "B:D", value: "B(a1)" }),
				expect.objectContaining({ edgeId: "C:D", value: "C(a1)" }),
			]),
		);
		expect(g1.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "g1/split/commands", to: "g1/to_g2/bridge/command" },
				{ from: "g1/inbound_join/releaseCohorts", to: "g1/inbound_join/inbound/B:D" },
				{ from: "g1/inbound_join/releaseCohorts", to: "g1/inbound_join/inbound/C:D" },
			]),
		);
		expect(g2.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "g2/inbound_split/releaseCohorts", to: "g2/inbound_split/inbound/A:B" },
				{ from: "g2/inbound_split/releaseCohorts", to: "g2/inbound_split/inbound/A:C" },
				{ from: "g2/join_out/commands", to: "g2/to_g1/bridge/command" },
			]),
		);
	});

	it("release detaches protobuf ingress without disabling semantic bridge ingress", () => {
		const g = graph();
		const bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g, {
			name: "bridge",
			sessionId: "s1",
		});
		const protobuf = wireBridgeProtobuf(g, bridge, { name: "bridge/protobuf" });
		const inbound: unknown[] = [];
		bridge.inbound.subscribe((msg) => inbound.push(msg));

		protobuf.inboundBytes.down([["DATA", canonicalInboundBytes()]]);
		expect(dataMessages(inbound)).toContainEqual([
			"DATA",
			expect.objectContaining({ sessionId: "s1", type: "data" }),
		]);

		protobuf.release();
		expect(g.describe().edges).not.toContainEqual({
			from: "bridge/protobuf/inboundDecoded",
			to: "bridge/inbound",
		});
		expect(() => protobuf.inboundBytes.down([["DATA", canonicalInboundBytes()]])).toThrow(
			/released/,
		);

		bridge.inbound.down([
			[
				"DATA",
				wireBridgeEnvelope<WireBridgeProtobufData>({
					sessionId: "s1",
					type: "data",
					seq: 42,
					payload: { kind: "data", value: { kind: "value", value: new Uint8Array([1]) } },
				}),
			],
		]);
		expect(dataMessages(inbound)).toContainEqual([
			"DATA",
			expect.objectContaining({ metadata: expect.objectContaining({ seq: 42 }) }),
		]);
	});
});
