import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	CanonicalProtobufError,
	decodeCanonicalWireBridgeEnvelope,
	decodeCanonicalWireEdgeFrame,
	encodeCanonicalWireBridgeEnvelope,
	encodeCanonicalWireEdgeFrame,
} from "../adapters/index.js";

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
	"../../../../../graphrefly/spec/fixtures/protobuf/wire_bridge_envelope.v1.jsonl",
	import.meta.url,
);
const wireEdgeFixtureUrl = new URL(
	"../../../../../graphrefly/spec/fixtures/protobuf/wire_edge_frame.v1.jsonl",
	import.meta.url,
);

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
