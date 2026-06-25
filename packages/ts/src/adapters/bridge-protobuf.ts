// D497 canonical protobuf profile for the D134/D496 wire bridge envelope subset.

export type CanonicalProtobufErrorCategory =
	| "unknown_field"
	| "duplicate_singular"
	| "noncanonical_bytes"
	| "invalid_oneof"
	| "missing_required"
	| "invalid_wire_edge"
	| "default_emission"
	| "malformed";

export class CanonicalProtobufError extends Error {
	readonly category: CanonicalProtobufErrorCategory;

	constructor(category: CanonicalProtobufErrorCategory, message: string) {
		super(message);
		this.name = "CanonicalProtobufError";
		this.category = category;
	}
}

export interface CanonicalWireBridgeMetadata {
	readonly seq: bigint;
	readonly cursor: bigint;
	readonly idempotencyKey: string;
	readonly attempt: number;
	readonly maxAttempts: number;
	readonly timestampMs?: bigint;
	readonly ackForSeq?: bigint;
	readonly requestId?: string;
}

export type CanonicalWireBridgeDataBody =
	| { readonly kind: "value"; readonly value: Uint8Array }
	| { readonly kind: "wire_edge"; readonly frame: CanonicalWireEdgeFrame };

export interface CanonicalWireEdgeFrame {
	readonly kind: "dirty" | "data";
	readonly edgeId: string;
	readonly causeId: string;
	readonly value?: Uint8Array;
}

export type CanonicalWireBridgePayload =
	| { readonly kind: "start" }
	| { readonly kind: "data"; readonly body: CanonicalWireBridgeDataBody }
	| { readonly kind: "ack" }
	| { readonly kind: "nack"; readonly error?: Uint8Array }
	| { readonly kind: "status"; readonly status: Uint8Array }
	| { readonly kind: "error"; readonly error: Uint8Array }
	| { readonly kind: "close"; readonly reason?: Uint8Array };

export interface CanonicalWireBridgeEnvelope {
	readonly sessionId: string;
	readonly metadata: CanonicalWireBridgeMetadata;
	readonly payload: CanonicalWireBridgePayload;
}

interface Field {
	readonly no: number;
	readonly wireType: number;
	readonly value: bigint | Uint8Array;
}

const maxUint64 = (1n << 64n) - 1n;
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();

export function decodeCanonicalWireBridgeEnvelope(bytes: Uint8Array): CanonicalWireBridgeEnvelope {
	const input = Uint8Array.from(bytes);
	const envelope = parseWireBridgeEnvelope(input);
	validateWireBridgeEnvelope(envelope);
	const canonical = encodeCanonicalWireBridgeEnvelope(envelope);
	if (!bytesEqual(input, canonical)) {
		throw new CanonicalProtobufError(
			"noncanonical_bytes",
			"WireBridgeEnvelope bytes are not canonical deterministic protobuf",
		);
	}
	return envelope;
}

export function decodeCanonicalWireEdgeFrame(bytes: Uint8Array): CanonicalWireEdgeFrame {
	const input = Uint8Array.from(bytes);
	const frame = parseWireEdgeFrame(input);
	validateWireEdgeFrame(frame);
	const canonical = encodeWireEdgeFrame(frame);
	if (!bytesEqual(input, canonical)) {
		throw new CanonicalProtobufError(
			"noncanonical_bytes",
			"WireEdgeFrame bytes are not canonical deterministic protobuf",
		);
	}
	return frame;
}

export function encodeCanonicalWireEdgeFrame(frame: CanonicalWireEdgeFrame): Uint8Array {
	validateWireEdgeFrame(frame);
	return encodeWireEdgeFrame(frame);
}

export function encodeCanonicalWireBridgeEnvelope(
	envelope: CanonicalWireBridgeEnvelope,
): Uint8Array {
	validateWireBridgeEnvelope(envelope);
	const out = new ByteWriter();
	out.stringField(1, envelope.sessionId);
	out.messageField(2, encodeMetadata(envelope.metadata));
	switch (envelope.payload.kind) {
		case "start":
			out.messageField(3, new Uint8Array());
			break;
		case "data":
			out.messageField(4, encodeDataPayload(envelope.payload.body));
			break;
		case "ack":
			out.messageField(5, new Uint8Array());
			break;
		case "nack":
			out.messageField(6, encodeOptionalBytesMessage(1, envelope.payload.error));
			break;
		case "status":
			out.messageField(7, encodeRequiredBytesMessage(1, envelope.payload.status));
			break;
		case "error":
			out.messageField(8, encodeRequiredBytesMessage(1, envelope.payload.error));
			break;
		case "close":
			out.messageField(9, encodeOptionalBytesMessage(1, envelope.payload.reason));
			break;
	}
	return out.finish();
}

function parseWireBridgeEnvelope(bytes: Uint8Array): CanonicalWireBridgeEnvelope {
	const fields = readFields(
		bytes,
		new Map([
			[1, 2],
			[2, 2],
			[3, 2],
			[4, 2],
			[5, 2],
			[6, 2],
			[7, 2],
			[8, 2],
			[9, 2],
		]),
		"WireBridgeEnvelope",
	);
	const session = bytesField(fields, 1);
	const metadataBytes = bytesField(fields, 2);
	const payloadFields = fields.filter((field) => field.no >= 3 && field.no <= 9);
	if (session === undefined || metadataBytes === undefined || payloadFields.length === 0) {
		throw new CanonicalProtobufError(
			"missing_required",
			"WireBridgeEnvelope missing required fields",
		);
	}
	if (payloadFields.length !== 1) {
		throw new CanonicalProtobufError(
			"invalid_oneof",
			"WireBridgeEnvelope payload oneof has multiple cases",
		);
	}
	const payloadField = payloadFields[0];
	if (!(payloadField.value instanceof Uint8Array)) {
		throw new CanonicalProtobufError("malformed", "WireBridgeEnvelope payload is malformed");
	}
	return {
		sessionId: utf8String(session, "session_id"),
		metadata: parseMetadata(metadataBytes),
		payload: parseEnvelopePayload(payloadField.no, payloadField.value),
	};
}

function parseEnvelopePayload(fieldNo: number, bytes: Uint8Array): CanonicalWireBridgePayload {
	switch (fieldNo) {
		case 3:
			requireEmptyMessage(bytes, "start");
			return { kind: "start" };
		case 4:
			return { kind: "data", body: parseDataPayload(bytes) };
		case 5:
			requireEmptyMessage(bytes, "ack");
			return { kind: "ack" };
		case 6:
			return { kind: "nack", error: parseOptionalBytesPayload(bytes, "nack") };
		case 7:
			return { kind: "status", status: parseRequiredBytesPayload(bytes, "status") };
		case 8:
			return { kind: "error", error: parseRequiredBytesPayload(bytes, "error") };
		case 9:
			return { kind: "close", reason: parseOptionalBytesPayload(bytes, "close") };
		default:
			throw new CanonicalProtobufError("unknown_field", "unknown envelope payload field");
	}
}

function parseMetadata(bytes: Uint8Array): CanonicalWireBridgeMetadata {
	const fields = readFields(
		bytes,
		new Map([
			[1, 0],
			[2, 0],
			[3, 2],
			[4, 0],
			[5, 0],
			[6, 0],
			[7, 0],
			[8, 2],
		]),
		"WireBridgeMetadata",
	);
	const seq = uintField(fields, 1);
	const cursor = uintField(fields, 2);
	const key = bytesField(fields, 3);
	const attempt = uintField(fields, 4);
	const maxAttempts = uintField(fields, 5);
	if (
		seq === undefined ||
		cursor === undefined ||
		key === undefined ||
		attempt === undefined ||
		maxAttempts === undefined
	) {
		throw new CanonicalProtobufError(
			"missing_required",
			"WireBridgeMetadata missing required fields",
		);
	}
	const timestampMs = uintField(fields, 6);
	const ackForSeq = uintField(fields, 7);
	const requestId = bytesField(fields, 8);
	if (timestampMs === 0n || ackForSeq === 0n || requestId?.length === 0) {
		throw new CanonicalProtobufError(
			"default_emission",
			"optional metadata default value was emitted",
		);
	}
	return {
		seq,
		cursor,
		idempotencyKey: utf8String(key, "idempotency_key"),
		attempt: uint32(attempt, "attempt"),
		maxAttempts: uint32(maxAttempts, "max_attempts"),
		timestampMs,
		ackForSeq,
		requestId: requestId === undefined ? undefined : utf8String(requestId, "request_id"),
	};
}

function parseDataPayload(bytes: Uint8Array): CanonicalWireBridgeDataBody {
	const fields = readFields(
		bytes,
		new Map([
			[1, 2],
			[2, 2],
		]),
		"WireBridgeDataPayload",
	);
	const value = bytesField(fields, 1);
	const wireEdge = bytesField(fields, 2);
	if (value !== undefined && wireEdge !== undefined) {
		throw new CanonicalProtobufError(
			"invalid_oneof",
			"WireBridgeDataPayload body has multiple cases",
		);
	}
	if (value !== undefined) return { kind: "value", value };
	if (wireEdge !== undefined) return { kind: "wire_edge", frame: parseWireEdgeFrame(wireEdge) };
	throw new CanonicalProtobufError("missing_required", "WireBridgeDataPayload missing body");
}

function parseWireEdgeFrame(bytes: Uint8Array): CanonicalWireEdgeFrame {
	const fields = readFields(
		bytes,
		new Map([
			[1, 0],
			[2, 2],
			[3, 2],
			[4, 2],
		]),
		"WireEdgeFrame",
	);
	const kind = uintField(fields, 1);
	const edge = bytesField(fields, 2);
	const cause = bytesField(fields, 3);
	const value = bytesField(fields, 4);
	if (kind === undefined || edge === undefined || cause === undefined) {
		throw new CanonicalProtobufError("missing_required", "WireEdgeFrame missing required fields");
	}
	if (edge.length === 0 || cause.length === 0) {
		throw new CanonicalProtobufError(
			"missing_required",
			"WireEdgeFrame edge_id/cause_id must be non-empty",
		);
	}
	if (kind === 1n) {
		if (value !== undefined) {
			throw new CanonicalProtobufError(
				"invalid_wire_edge",
				"DIRTY WireEdgeFrame must not carry value",
			);
		}
		return {
			kind: "dirty",
			edgeId: utf8String(edge, "edge_id"),
			causeId: utf8String(cause, "cause_id"),
		};
	}
	if (kind === 2n) {
		if (value === undefined) {
			throw new CanonicalProtobufError("invalid_wire_edge", "DATA WireEdgeFrame requires value");
		}
		return {
			kind: "data",
			edgeId: utf8String(edge, "edge_id"),
			causeId: utf8String(cause, "cause_id"),
			value,
		};
	}
	throw new CanonicalProtobufError("invalid_wire_edge", "WireEdgeFrame kind is invalid");
}

function validateWireBridgeEnvelope(envelope: CanonicalWireBridgeEnvelope): void {
	if (!isRecord(envelope)) {
		throw new CanonicalProtobufError("malformed", "WireBridgeEnvelope DTO must be an object");
	}
	if (typeof envelope.sessionId !== "string" || envelope.sessionId.length === 0) {
		throw new CanonicalProtobufError(
			"missing_required",
			"WireBridgeEnvelope session_id must be non-empty",
		);
	}
	const metadata = envelope.metadata;
	if (!isRecord(metadata)) {
		throw new CanonicalProtobufError("malformed", "WireBridgeMetadata DTO must be an object");
	}
	assertUint64(metadata.seq, "seq");
	assertUint64(metadata.cursor, "cursor");
	assertUint32Number(metadata.attempt, "attempt");
	assertUint32Number(metadata.maxAttempts, "max_attempts");
	if (metadata.timestampMs !== undefined) assertUint64(metadata.timestampMs, "timestamp_ms");
	if (metadata.ackForSeq !== undefined) assertUint64(metadata.ackForSeq, "ack_for_seq");
	if (metadata.seq === 0n || metadata.attempt === 0 || metadata.maxAttempts < metadata.attempt) {
		throw new CanonicalProtobufError(
			"missing_required",
			"WireBridgeMetadata positive fields are invalid",
		);
	}
	if (typeof metadata.idempotencyKey !== "string" || metadata.idempotencyKey.length === 0) {
		throw new CanonicalProtobufError(
			"missing_required",
			"WireBridgeMetadata idempotency_key is required",
		);
	}
	if (metadata.requestId !== undefined && typeof metadata.requestId !== "string") {
		throw new CanonicalProtobufError("malformed", "WireBridgeMetadata request_id must be a string");
	}
	if (!isRecord(envelope.payload)) {
		throw new CanonicalProtobufError("missing_required", "WireBridgeEnvelope payload is required");
	}
	validatePayloadDto(envelope.payload);
	if (
		(envelope.payload.kind === "ack" || envelope.payload.kind === "nack") &&
		metadata.ackForSeq === undefined
	) {
		throw new CanonicalProtobufError("missing_required", "ACK/NACK requires metadata.ack_for_seq");
	}
	if (metadata.timestampMs === 0n || metadata.ackForSeq === 0n || metadata.requestId === "") {
		throw new CanonicalProtobufError(
			"default_emission",
			"optional metadata default value was emitted",
		);
	}
}

function validatePayloadDto(payload: CanonicalWireBridgePayload): void {
	switch (payload.kind) {
		case "start":
		case "ack":
			return;
		case "data":
			if (!isRecord(payload.body)) {
				throw new CanonicalProtobufError(
					"missing_required",
					"WireBridgeDataPayload body is required",
				);
			}
			if (payload.body.kind === "value") {
				assertUint8Array(payload.body.value, "WireBridgeDataPayload value");
				return;
			}
			if (payload.body.kind === "wire_edge") {
				validateWireEdgeFrame(payload.body.frame);
				return;
			}
			throw new CanonicalProtobufError(
				"invalid_oneof",
				"WireBridgeDataPayload body kind is invalid",
			);
		case "nack":
			if (payload.error !== undefined)
				assertNonEmptyOptionalBytes(payload.error, "WireBridgeNackPayload error");
			return;
		case "status":
			assertNonEmptyRequiredBytes(payload.status, "WireBridgeStatusPayload status");
			return;
		case "error":
			assertNonEmptyRequiredBytes(payload.error, "WireBridgeErrorPayload error");
			return;
		case "close":
			if (payload.reason !== undefined)
				assertNonEmptyOptionalBytes(payload.reason, "WireBridgeClosePayload reason");
			return;
		default:
			throw new CanonicalProtobufError(
				"invalid_oneof",
				"WireBridgeEnvelope payload kind is invalid",
			);
	}
}

function validateWireEdgeFrame(frame: CanonicalWireEdgeFrame): void {
	if (!isRecord(frame)) {
		throw new CanonicalProtobufError("malformed", "WireEdgeFrame DTO must be an object");
	}
	if (typeof frame.edgeId !== "string" || typeof frame.causeId !== "string") {
		throw new CanonicalProtobufError(
			"missing_required",
			"WireEdgeFrame edge_id/cause_id are required",
		);
	}
	if (frame.edgeId.length === 0 || frame.causeId.length === 0) {
		throw new CanonicalProtobufError(
			"missing_required",
			"WireEdgeFrame edge_id/cause_id must be non-empty",
		);
	}
	switch (frame.kind) {
		case "dirty":
			if (frame.value !== undefined) {
				throw new CanonicalProtobufError(
					"invalid_wire_edge",
					"DIRTY WireEdgeFrame must not carry value",
				);
			}
			return;
		case "data":
			if (frame.value === undefined) {
				throw new CanonicalProtobufError("invalid_wire_edge", "DATA WireEdgeFrame requires value");
			}
			assertUint8Array(frame.value, "WireEdgeFrame value");
			return;
		default:
			throw new CanonicalProtobufError("invalid_wire_edge", "WireEdgeFrame kind is invalid");
	}
}

function encodeMetadata(metadata: CanonicalWireBridgeMetadata): Uint8Array {
	const out = new ByteWriter();
	out.varintField(1, metadata.seq);
	out.varintField(2, metadata.cursor);
	out.stringField(3, metadata.idempotencyKey);
	out.varintField(4, BigInt(metadata.attempt));
	out.varintField(5, BigInt(metadata.maxAttempts));
	if (metadata.timestampMs !== undefined) out.varintField(6, metadata.timestampMs);
	if (metadata.ackForSeq !== undefined) out.varintField(7, metadata.ackForSeq);
	if (metadata.requestId !== undefined) out.stringField(8, metadata.requestId);
	return out.finish();
}

function encodeDataPayload(body: CanonicalWireBridgeDataBody): Uint8Array {
	const out = new ByteWriter();
	if (body.kind === "value") {
		out.bytesField(1, body.value);
	} else {
		out.messageField(2, encodeWireEdgeFrame(body.frame));
	}
	return out.finish();
}

function encodeWireEdgeFrame(frame: CanonicalWireEdgeFrame): Uint8Array {
	const out = new ByteWriter();
	out.varintField(1, frame.kind === "dirty" ? 1n : 2n);
	out.stringField(2, frame.edgeId);
	out.stringField(3, frame.causeId);
	if (frame.value !== undefined) out.bytesField(4, frame.value);
	return out.finish();
}

function encodeRequiredBytesMessage(fieldNo: number, value: Uint8Array): Uint8Array {
	const out = new ByteWriter();
	out.bytesField(fieldNo, value);
	return out.finish();
}

function encodeOptionalBytesMessage(fieldNo: number, value: Uint8Array | undefined): Uint8Array {
	const out = new ByteWriter();
	if (value !== undefined) {
		assertNonEmptyOptionalBytes(value, "optional bytes payload");
		out.bytesField(fieldNo, value);
	}
	return out.finish();
}

function parseRequiredBytesPayload(bytes: Uint8Array, name: string): Uint8Array {
	const fields = readFields(bytes, new Map([[1, 2]]), `WireBridge${name}Payload`);
	const value = bytesField(fields, 1);
	if (value === undefined) {
		throw new CanonicalProtobufError("missing_required", `${name} payload missing required bytes`);
	}
	if (value.length === 0) {
		throw new CanonicalProtobufError("missing_required", `${name} payload bytes must be non-empty`);
	}
	return value;
}

function parseOptionalBytesPayload(bytes: Uint8Array, name: string): Uint8Array | undefined {
	const fields = readFields(bytes, new Map([[1, 2]]), `WireBridge${name}Payload`);
	const value = bytesField(fields, 1);
	if (value?.length === 0) {
		throw new CanonicalProtobufError(
			"default_emission",
			`${name} optional bytes default value was emitted`,
		);
	}
	return value;
}

function requireEmptyMessage(bytes: Uint8Array, name: string): void {
	if (bytes.length !== 0) {
		throw new CanonicalProtobufError("unknown_field", `${name} payload must be empty`);
	}
}

function readFields(bytes: Uint8Array, allowed: Map<number, number>, messageName: string): Field[] {
	const reader = new ByteReader(bytes);
	const fields: Field[] = [];
	const seen = new Set<number>();
	while (!reader.done()) {
		const key = reader.varint();
		const fieldNo = Number(key >> 3n);
		const wireType = Number(key & 7n);
		const expectedWireType = allowed.get(fieldNo);
		if (fieldNo <= 0 || expectedWireType === undefined) {
			throw new CanonicalProtobufError(
				"unknown_field",
				`${messageName} contains unknown field ${fieldNo}`,
			);
		}
		if (wireType !== expectedWireType) {
			throw new CanonicalProtobufError(
				"malformed",
				`${messageName} field ${fieldNo} has wrong wire type`,
			);
		}
		if (seen.has(fieldNo)) {
			throw new CanonicalProtobufError(
				"duplicate_singular",
				`${messageName} field ${fieldNo} is duplicated`,
			);
		}
		seen.add(fieldNo);
		if (wireType === 0) {
			fields.push({ no: fieldNo, wireType, value: reader.varint() });
		} else if (wireType === 2) {
			fields.push({ no: fieldNo, wireType, value: reader.readBytes() });
		} else {
			throw new CanonicalProtobufError("malformed", `${messageName} unsupported wire type`);
		}
	}
	return fields;
}

function uintField(fields: readonly Field[], no: number): bigint | undefined {
	const field = fields.find((candidate) => candidate.no === no);
	return typeof field?.value === "bigint" ? field.value : undefined;
}

function bytesField(fields: readonly Field[], no: number): Uint8Array | undefined {
	const field = fields.find((candidate) => candidate.no === no);
	return field?.value instanceof Uint8Array ? field.value : undefined;
}

function utf8String(bytes: Uint8Array, field: string): string {
	let text: string;
	try {
		text = textDecoder.decode(bytes);
	} catch (error) {
		throw new CanonicalProtobufError(
			"malformed",
			`${field} is not valid utf-8: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (text.length === 0) {
		throw new CanonicalProtobufError("missing_required", `${field} must be non-empty`);
	}
	return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function assertUint64(value: unknown, field: string): asserts value is bigint {
	if (typeof value !== "bigint" || value < 0n || value > maxUint64) {
		throw new CanonicalProtobufError("malformed", `${field} must be a uint64 bigint`);
	}
}

function assertUint32Number(value: unknown, field: string): asserts value is number {
	if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xffff_ffff) {
		throw new CanonicalProtobufError("malformed", `${field} must be a uint32 number`);
	}
}

function assertUint8Array(value: unknown, field: string): asserts value is Uint8Array {
	if (!(value instanceof Uint8Array)) {
		throw new CanonicalProtobufError("malformed", `${field} must be Uint8Array bytes`);
	}
}

function assertNonEmptyOptionalBytes(value: unknown, field: string): asserts value is Uint8Array {
	assertUint8Array(value, field);
	if (value.length === 0) {
		throw new CanonicalProtobufError("default_emission", `${field} default value must be omitted`);
	}
}

function assertNonEmptyRequiredBytes(value: unknown, field: string): asserts value is Uint8Array {
	assertUint8Array(value, field);
	if (value.length === 0) {
		throw new CanonicalProtobufError("missing_required", `${field} must be non-empty`);
	}
}

function uint32(value: bigint, field: string): number {
	if (value > 0xffff_ffffn) {
		throw new CanonicalProtobufError("malformed", `${field} exceeds uint32`);
	}
	return Number(value);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) return false;
	for (let i = 0; i < left.length; i++) {
		if (left[i] !== right[i]) return false;
	}
	return true;
}

class ByteReader {
	private offset = 0;

	constructor(private readonly buf: Uint8Array) {}

	done(): boolean {
		return this.offset === this.buf.length;
	}

	varint(): bigint {
		let shift = 0n;
		let result = 0n;
		for (let i = 0; i < 10; i++) {
			if (this.offset >= this.buf.length) {
				throw new CanonicalProtobufError("malformed", "truncated varint");
			}
			const byte = this.buf[this.offset++];
			if (i === 9 && (byte & 0xfe) !== 0) {
				throw new CanonicalProtobufError("malformed", "varint exceeds 64 bits");
			}
			result |= BigInt(byte & 0x7f) << shift;
			if ((byte & 0x80) === 0) return result;
			shift += 7n;
		}
		throw new CanonicalProtobufError("malformed", "varint exceeds 64 bits");
	}

	readBytes(): Uint8Array {
		const len = this.varint();
		if (len > BigInt(this.buf.length - this.offset)) {
			throw new CanonicalProtobufError("malformed", "length-delimited field is truncated");
		}
		const start = this.offset;
		this.offset += Number(len);
		return this.buf.slice(start, this.offset);
	}
}

class ByteWriter {
	private readonly chunks: number[] = [];

	varintField(fieldNo: number, value: bigint): void {
		this.tag(fieldNo, 0);
		this.varint(value);
	}

	bytesField(fieldNo: number, value: Uint8Array): void {
		this.tag(fieldNo, 2);
		this.varint(BigInt(value.length));
		this.bytes(value);
	}

	stringField(fieldNo: number, value: string): void {
		this.bytesField(fieldNo, textEncoder.encode(value));
	}

	messageField(fieldNo: number, value: Uint8Array): void {
		this.bytesField(fieldNo, value);
	}

	finish(): Uint8Array {
		return new Uint8Array(this.chunks);
	}

	private tag(fieldNo: number, wireType: number): void {
		this.varint(BigInt((fieldNo << 3) | wireType));
	}

	private varint(value: bigint): void {
		if (value < 0n || value > maxUint64) {
			throw new CanonicalProtobufError("malformed", "varint value must fit uint64");
		}
		let next = value;
		do {
			let byte = Number(next & 0x7fn);
			next >>= 7n;
			if (next !== 0n) byte |= 0x80;
			this.chunks.push(byte);
		} while (next !== 0n);
	}

	private bytes(value: Uint8Array): void {
		for (const byte of value) this.chunks.push(byte);
	}
}
