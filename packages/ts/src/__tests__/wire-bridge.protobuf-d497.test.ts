import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	CanonicalProtobufError,
	decodeCanonicalWireBridgeEnvelope,
	decodeCanonicalWireEdgeCause,
	encodeCanonicalWireBridgeEnvelope,
	encodeCanonicalWireEdgeCause,
	type WireBridgeProtobufData,
	wireBridge,
	wireBridgeEnvelope,
	wireBridgeProtobuf,
} from "../adapters/index.js";
import { depBatch } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import { asState } from "./helpers/as-state.js";

interface VectorRecord {
	readonly schema: "graphrefly.protobuf.golden.v1";
	readonly id: string;
	readonly message: "WireBridgeEnvelope" | "WireEdgeCause";
	readonly description: string;
	readonly hex: string;
	readonly canonical: boolean;
	readonly errorCategory?: string;
	readonly expect?: { readonly payload?: string; readonly edges?: number };
}

const envelopeFixtureUrl = new URL(
	"./fixtures/protobuf/wire_bridge_envelope.v1.jsonl",
	import.meta.url,
);
const wireEdgeFixtureUrl = new URL("./fixtures/protobuf/wire_edge_cause.v1.jsonl", import.meta.url);

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
		if (record.expect?.payload === "data.edge_cause") {
			expect(decoded.payload.kind).toBe("data");
			expect(decoded.payload.kind === "data" && decoded.payload.body.kind).toBe("edge_cause");
			if (decoded.payload.kind !== "data" || decoded.payload.body.kind !== "edge_cause") return;
			const { cause } = decoded.payload.body;
			expect(cause.group).toBe("g");
			expect(cause.cause).toBeGreaterThanOrEqual(1);
			for (const edge of cause.edges)
				for (const wave of edge.arrays)
					for (const m of wave)
						if (m[0] === "DATA" || m[0] === "ERROR") expect(m[1]).toBeInstanceOf(Uint8Array);
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

describe("C-1a canonical protobuf WireEdgeCause vectors (R-bridge@1, D803)", () => {
	it("parses standalone WireEdgeCause fixture records", () => {
		const records = vectors(wireEdgeFixtureUrl, "WireEdgeCause");
		expect(records.some((record) => record.canonical)).toBe(true);
		expect(records.some((record) => !record.canonical)).toBe(true);
	});

	it.each(
		vectors(wireEdgeFixtureUrl, "WireEdgeCause").filter((record) => record.canonical),
	)("decodes, validates, and re-encodes $id byte-for-byte", (record) => {
		const bytes = fromHex(record.hex);
		const decoded = decodeCanonicalWireEdgeCause(bytes);
		const encoded = encodeCanonicalWireEdgeCause(decoded);

		expect(toHex(encoded)).toBe(record.hex);
		expect(decoded.edges).toHaveLength(record.expect?.edges ?? decoded.edges.length);
	});

	it("decodes the fixtures into the frames a wire edge group sends", () => {
		const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
		const first = decodeCanonicalWireEdgeCause(
			fromHex(vectorById("WireEdgeCause", "positive.edge_cause.first_with_invalidate").hex),
		);
		expect(first.group).toBe("g");
		expect(first.session).toBe("s1");
		expect(first.cause).toBe(1);
		expect(first.edges.map((e) => e.edgeId)).toEqual(["x", "y"]);
		expect(first.edges[0]?.arrays.map((w) => w.map((m) => m[0]))).toEqual([["DATA"]]);
		expect(text(first.edges[0]?.arrays[0]?.[0]?.[1] as Uint8Array)).toBe('{"ok":true}');
		expect(first.edges[1]?.arrays).toEqual([[["INVALIDATE"]]]);
		const ordered = decodeCanonicalWireEdgeCause(
			fromHex(vectorById("WireEdgeCause", "positive.edge_cause.arrays_in_order").hex),
		);
		expect(ordered.cause).toBe(4);
		expect(ordered.edges[0]?.arrays.map((w) => w.map((m) => m[0]))).toEqual([
			["DATA"],
			["DATA", "COMPLETE"],
		]);
		const failed = decodeCanonicalWireEdgeCause(
			fromHex(vectorById("WireEdgeCause", "positive.edge_cause.error").hex),
		);
		expect(failed.edges[0]?.arrays[0]?.[0]?.[0]).toBe("ERROR");
		expect(text(failed.edges[0]?.arrays[0]?.[0]?.[1] as Uint8Array)).toBe('{"error":"boom"}');
	});

	it.each(
		vectors(wireEdgeFixtureUrl, "WireEdgeCause").filter((record) => !record.canonical),
	)("rejects $id as $errorCategory", (record) => {
		try {
			decodeCanonicalWireEdgeCause(fromHex(record.hex));
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
			encodeCanonicalWireEdgeCause({ group: "g", session: "s1", cause: 0, edges: [] }),
		).toThrow(CanonicalProtobufError);
		expect(() =>
			encodeCanonicalWireEdgeCause({
				group: "g",
				session: "s1",
				cause: 1,
				edges: [{ edgeId: "x", arrays: [[["RESOLVED"]]] }],
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
		bridge.inbound.subscribe((incoming) => {
			for (const msg of incoming) {
				inbound.push(msg);
			}
		});
		protobuf.issues.subscribe((incoming) => {
			for (const msg of incoming) {
				issues.push(msg);
			}
		});
		protobuf.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});

		asState(protobuf.inboundBytes).set(canonicalInboundBytes());

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
		protobuf.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});

		g.batch(() => {
			const target = asState(protobuf.inboundBytes);
			target.set(canonicalInboundBytes());
			target.set(malformedInboundBytes());
		});

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
		protobuf.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});

		bridge.inbound.set(
			wireBridgeEnvelope<WireBridgeProtobufData>({
				sessionId: "s1",
				type: "data",
				seq: 1,
				payload: { kind: "data", value: { kind: "value", value: new Uint8Array([1]) } },
			}),
		);

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
		bridge.errors.subscribe((incoming) => {
			for (const msg of incoming) {
				bridgeErrors.push(msg);
			}
		});
		bridge.events.subscribe((incoming) => {
			for (const msg of incoming) {
				bridgeEvents.push(msg);
			}
		});
		protobuf.issues.subscribe((incoming) => {
			for (const msg of incoming) {
				issues.push(msg);
			}
		});
		protobuf.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});

		asState(protobuf.inboundBytes).set(malformedInboundBytes());

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
		bridge.inbound.subscribe((incoming) => {
			for (const msg of incoming) {
				inbound.push(msg);
			}
		});
		protobuf.issues.subscribe((incoming) => {
			for (const msg of incoming) {
				issues.push(msg);
			}
		});
		protobuf.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});

		asState(protobuf.inboundBytes).set(malformedInboundBytes());

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
		protobuf.issues.subscribe((incoming) => {
			for (const msg of incoming) {
				issues.push(msg);
			}
		});
		protobuf.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});
		bridge.inbound.subscribe((incoming) => {
			for (const msg of incoming) {
				inbound.push(msg);
			}
		});

		asState(protobuf.inboundBytes).set(malformedInboundBytes());

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
		protobuf.issues.subscribe((incoming) => {
			for (const msg of incoming) {
				issues.push(msg);
			}
		});
		protobuf.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});

		asState(protobuf.inboundBytes).set(malformedInboundBytes());

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
		protobuf.outboundBytes.subscribe((incoming) => {
			for (const msg of incoming) {
				outboundBytes.push(msg);
			}
		});
		protobuf.issues.subscribe((incoming) => {
			for (const msg of incoming) {
				issues.push(msg);
			}
		});

		bridge.send(new Uint8Array(), { requestId: "req-empty" });

		expect(dataMessages(issues)).toEqual([]);
		const bytes = dataMessages(outboundBytes).at(-1)?.[1] as Uint8Array;
		const decoded = decodeCanonicalWireBridgeEnvelope(bytes);
		expect(decoded.payload.kind).toBe("data");
		if (decoded.payload.kind !== "data") return;
		expect(decoded.payload.body).toEqual({ kind: "value", value: new Uint8Array() });
		expect(toHex(encodeCanonicalWireBridgeEnvelope(decoded))).toBe(toHex(bytes));
	});

	it("encodes outbound edge-cause DTOs without introducing a wire edge group runtime", () => {
		const g = graph();
		const bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g, {
			name: "bridge",
			sessionId: "s1",
			now: () => 1,
		});
		const protobuf = wireBridgeProtobuf(g, bridge, { name: "bridge/protobuf" });
		const outboundBytes: unknown[] = [];
		protobuf.outboundBytes.subscribe((incoming) => {
			for (const msg of incoming) {
				outboundBytes.push(msg);
			}
		});

		const cause = {
			group: "g",
			session: "s1",
			cause: 1,
			edges: [{ edgeId: "x", arrays: [[["DATA", new Uint8Array()] as const]] }],
		};
		bridge.send({ kind: "edge_cause", cause });

		const decoded = decodeCanonicalWireBridgeEnvelope(
			dataMessages(outboundBytes).at(-1)?.[1] as Uint8Array,
		);
		expect(decoded.payload.kind).toBe("data");
		if (decoded.payload.kind !== "data") return;
		expect(decoded.payload.body).toEqual({ kind: "edge_cause", cause });
		expect(g.inspect().nodes.map((node) => node.factory)).not.toContain("wireEdgeGroupOut");
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
		protobuf.outboundBytes.subscribe((incoming) => {
			for (const msg of incoming) {
				outboundBytes.push(msg);
			}
		});
		protobuf.issues.subscribe((incoming) => {
			for (const msg of incoming) {
				issues.push(msg);
			}
		});
		protobuf.status.subscribe((incoming) => {
			for (const msg of incoming) {
				status.push(msg);
			}
		});

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

		const snap = g.inspect();
		expect(snap.nodes).toContainEqual(
			expect.objectContaining({
				id: "bridge/protobuf/inboundBytes",
				factory: "wireBridgeProtobufInboundBytes",
			}),
		);
		expect(snap.nodes).toContainEqual(
			expect.objectContaining({ id: "bridge/inbound", factory: "wireBridgeInbound" }),
		);
		// D803: the decoded lane writes into the bridge's inbound state; it is not a dependency.
		expect(snap.edges).not.toContainEqual({
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

		const issuePath = g.inspect({
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

		const statusPath = g.inspect({
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

		const outboundIssuePath = g.inspect({
			explain: { from: "bridge/outbound", to: "bridge/protobuf/issues" },
		});
		expect(outboundIssuePath.edges).toEqual(
			expect.arrayContaining([
				{ from: "bridge/outbound", to: "bridge/protobuf/outboundResults" },
				{ from: "bridge/protobuf/outboundResults", to: "bridge/protobuf/outboundEvents" },
				{ from: "bridge/protobuf/outboundEvents", to: "bridge/protobuf/issues" },
			]),
		);

		const outboundStatusPath = g.inspect({
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

	it("release detaches protobuf ingress without disabling semantic bridge ingress", () => {
		const g = graph();
		const bridge = wireBridge<WireBridgeProtobufData, WireBridgeProtobufData>(g, {
			name: "bridge",
			sessionId: "s1",
		});
		const protobuf = wireBridgeProtobuf(g, bridge, { name: "bridge/protobuf" });
		const inbound: unknown[] = [];
		bridge.inbound.subscribe((incoming) => {
			for (const msg of incoming) {
				inbound.push(msg);
			}
		});

		asState(protobuf.inboundBytes).set(canonicalInboundBytes());
		expect(dataMessages(inbound)).toContainEqual([
			"DATA",
			expect.objectContaining({ sessionId: "s1", type: "data" }),
		]);

		protobuf.release();
		expect(g.inspect().edges).not.toContainEqual({
			from: "bridge/protobuf/inboundDecoded",
			to: "bridge/inbound",
		});
		expect(() => asState(protobuf.inboundBytes).set(canonicalInboundBytes())).toThrow(/released/);

		bridge.inbound.set(
			wireBridgeEnvelope<WireBridgeProtobufData>({
				sessionId: "s1",
				type: "data",
				seq: 42,
				payload: { kind: "data", value: { kind: "value", value: new Uint8Array([1]) } },
			}),
		);
		expect(dataMessages(inbound)).toContainEqual([
			"DATA",
			expect.objectContaining({ metadata: expect.objectContaining({ seq: 42 }) }),
		]);
	});
});
