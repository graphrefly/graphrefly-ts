/**
 * Graph-visible wire bridge envelope helpers (D134).
 *
 * This first slice is transport-free: commands become outbound envelope facts,
 * remote receipts enter only through the inbound fact node, and retry/ack timeout
 * state is surfaced through graph-visible attempts/status/errors nodes.
 */

import { assertStrictJsonValue } from "../json/codec.js";
import type { CanonicalWireBridgeDataBody, CanonicalWireEdgeFrame } from "./bridge-protobuf.js";
import type {
	RemoteCallRequest,
	RemoteCallResponse,
	WireBridgeEnvelope,
	WireBridgeEnvelopeType,
	WireBridgeMetadata,
} from "./bridge-types.js";

export const envelopeTypes = new Set<WireBridgeEnvelopeType>([
	"start",
	"data",
	"ack",
	"nack",
	"status",
	"error",
	"close",
]);

export function validateRemoteCallRequest<T>(value: unknown): RemoteCallRequest<T> | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.operation !== "string" || value.operation.length === 0) return undefined;
	if (typeof value.requestId !== "string" || value.requestId.length === 0) return undefined;
	if (!("payload" in value)) return undefined;
	return {
		operation: value.operation,
		requestId: value.requestId,
		payload: value.payload as T,
	};
}

export function validateRemoteCallResponse<T>(value: unknown): RemoteCallResponse<T> | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.operation !== "string" || value.operation.length === 0) return undefined;
	if (typeof value.requestId !== "string" || value.requestId.length === 0) return undefined;
	if (value.kind === "result" && "payload" in value) {
		return {
			kind: "result",
			operation: value.operation,
			requestId: value.requestId,
			payload: value.payload as T,
		};
	}
	if (value.kind === "error" && typeof value.error === "string" && value.error.length > 0) {
		return {
			kind: "error",
			operation: value.operation,
			requestId: value.requestId,
			error: value.error,
		};
	}
	if (value.kind === "status" && typeof value.status === "string" && value.status.length > 0) {
		return {
			kind: "status",
			operation: value.operation,
			requestId: value.requestId,
			status: value.status,
		};
	}
	return undefined;
}

export function remoteMalformedResponseRequestId(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	return typeof value.requestId === "string" && value.requestId.length > 0
		? value.requestId
		: undefined;
}

export function remoteMalformedResponseOperation(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	return typeof value.operation === "string" && value.operation.length > 0
		? value.operation
		: undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function isThenable(value: unknown): boolean {
	return isRecord(value) && typeof value.then === "function";
}

export function validateInboundEnvelope(envelope: unknown): string | undefined {
	if (typeof envelope !== "object" || envelope === null) {
		return "wireBridge: inbound envelope must be an object";
	}
	const candidate = envelope as Partial<WireBridgeEnvelope<unknown>>;
	if (typeof candidate.sessionId !== "string" || candidate.sessionId.length === 0) {
		return "wireBridge: inbound envelope sessionId must be a non-empty string";
	}
	if (
		typeof candidate.type !== "string" ||
		!envelopeTypes.has(candidate.type as WireBridgeEnvelopeType)
	) {
		return "wireBridge: inbound envelope type is not recognized";
	}
	const metadata = candidate.metadata as Partial<WireBridgeMetadata> | undefined;
	if (typeof metadata !== "object" || metadata === null) {
		return "wireBridge: inbound envelope metadata must be an object";
	}
	if (!isSafePositiveInteger(metadata.seq)) {
		return "wireBridge: inbound envelope seq must be a positive integer";
	}
	if (!isSafeNonNegativeInteger(metadata.cursor)) {
		return "wireBridge: inbound envelope cursor must be a non-negative integer";
	}
	if (
		typeof metadata.idempotencyKey !== "string" ||
		(metadata.idempotencyKey as string).length === 0
	) {
		return "wireBridge: inbound envelope idempotencyKey must be a non-empty string";
	}
	if (!isSafePositiveInteger(metadata.attempt)) {
		return "wireBridge: inbound envelope attempt must be a positive integer";
	}
	if (
		!isSafePositiveInteger(metadata.maxAttempts) ||
		(metadata.maxAttempts as number) < (metadata.attempt as number)
	) {
		return "wireBridge: inbound envelope maxAttempts must be >= attempt";
	}
	if (metadata.ackForSeq !== undefined && !isSafePositiveInteger(metadata.ackForSeq)) {
		return "wireBridge: inbound envelope ackForSeq must be a positive integer";
	}
	if ((candidate.type === "ack" || candidate.type === "nack") && metadata.ackForSeq === undefined) {
		return `wireBridge: inbound ${candidate.type} envelope requires ackForSeq`;
	}
	const payloadError = validatePayloadForType(
		candidate.type as WireBridgeEnvelopeType,
		candidate.payload,
		"wireBridge: inbound envelope",
	);
	if (payloadError !== undefined) return payloadError;
	return undefined;
}

export function validateCommand(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null) {
		return "wireBridge: command fact must be an object";
	}
	const kind = (value as { readonly kind?: unknown }).kind;
	if (
		kind !== "start" &&
		kind !== "send" &&
		kind !== "ack" &&
		kind !== "nack" &&
		kind !== "ack-timeout" &&
		kind !== "close"
	) {
		return "wireBridge: command kind is not recognized";
	}
	if (
		(kind === "ack" || kind === "nack") &&
		!isSafePositiveInteger((value as { readonly ackForSeq?: unknown }).ackForSeq)
	) {
		return `wireBridge: ${kind} command ackForSeq must be a positive integer`;
	}
	if (kind === "ack-timeout") {
		const timeout = value as {
			readonly seq?: unknown;
			readonly attempt?: unknown;
			readonly observedAtMs?: unknown;
		};
		if (!isSafePositiveInteger(timeout.seq)) {
			return "wireBridge: ack-timeout command seq must be a positive integer";
		}
		if (!isSafePositiveInteger(timeout.attempt)) {
			return "wireBridge: ack-timeout command attempt must be a positive integer";
		}
		const observedAtMs = timeout.observedAtMs;
		if (
			observedAtMs !== undefined &&
			(typeof observedAtMs !== "number" || !Number.isFinite(observedAtMs) || observedAtMs < 0)
		) {
			return "wireBridge: ack-timeout command observedAtMs must be a non-negative finite number";
		}
	}
	return undefined;
}

export function shouldTrackAck(type: WireBridgeEnvelopeType): boolean {
	return type === "start" || type === "data" || type === "close";
}

export function isSafePositiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

export function isSafeNonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function validatePayloadForType(
	type: WireBridgeEnvelopeType,
	payload: unknown,
	prefix: string,
): string | undefined {
	const record =
		typeof payload === "object" && payload !== null
			? (payload as Record<string, unknown>)
			: undefined;
	const kind = record === undefined ? undefined : ownData(record, "kind");
	switch (type) {
		case "data":
			if (kind !== "data" || record === undefined || !hasOwnData(record, "value")) {
				return `${prefix}: data envelope requires data payload`;
			}
			return wireAdmissiblePayloadError(ownData(record, "value"), `${prefix}: data payload`);
		case "nack":
		case "error":
			if (kind !== "error" || record === undefined || !hasOwnData(record, "error")) {
				return `${prefix}: ${type} envelope requires error payload`;
			}
			return wireAdmissiblePayloadError(ownData(record, "error"), `${prefix}: ${type} payload`);
		case "status":
			if (kind !== "status" || record === undefined || !hasOwnData(record, "status")) {
				return `${prefix}: status envelope requires status payload`;
			}
			return wireAdmissiblePayloadError(ownData(record, "status"), `${prefix}: status payload`);
		case "close":
			if (kind !== "close") return `${prefix}: close envelope requires close payload`;
			if (record === undefined || !("reason" in record)) return undefined;
			if (!hasOwnData(record, "reason")) {
				return `${prefix}: close reason must be a data property`;
			}
			return wireAdmissiblePayloadError(ownData(record, "reason"), `${prefix}: close reason`);
		case "start":
		case "ack":
			return payload === undefined
				? undefined
				: `${prefix}: ${type} envelope must not carry a payload`;
	}
}

export function normalizeWireAdmissiblePayload(value: unknown, label: string): unknown {
	if (value instanceof Uint8Array) return Uint8Array.from(value);
	if (isCanonicalWireBridgeDataBody(value)) return cloneCanonicalWireBridgeDataBody(value);
	if (isCanonicalWireEdgeFrame(value)) return cloneCanonicalWireEdgeFrame(value);
	if (isCanonicalWireBridgeDataBodyLike(value) || isCanonicalWireEdgeFrameLike(value)) {
		throw new TypeError(`${label}: invalid canonical wire DTO`);
	}
	try {
		return assertStrictJsonValue(value, label);
	} catch (error) {
		throw new TypeError(
			`${label}: wire-admissible payload must be copied bytes, canonical WireEdgeFrame material, or strict JSON-like material`,
			{ cause: error },
		);
	}
}

export function wireAdmissiblePayloadError(value: unknown, label: string): string | undefined {
	try {
		normalizeWireAdmissiblePayload(value, label);
		return undefined;
	} catch (error) {
		return errorMessage(error);
	}
}

export function normalizeWireBridgePayload<T>(
	payload:
		| { readonly kind: "data"; readonly value: T }
		| { readonly kind: "error"; readonly error: unknown }
		| { readonly kind: "status"; readonly status: unknown }
		| { readonly kind: "close"; readonly reason?: unknown }
		| undefined,
	prefix: string,
): typeof payload {
	if (payload === undefined) return undefined;
	if (payload.kind === "data") {
		return {
			...payload,
			value: normalizeWireAdmissiblePayload(payload.value, `${prefix}: data payload`) as T,
		};
	}
	if (payload.kind === "error") {
		return {
			...payload,
			error: normalizeWireAdmissiblePayload(payload.error, `${prefix}: error payload`),
		};
	}
	if (payload.kind === "status") {
		return {
			...payload,
			status: normalizeWireAdmissiblePayload(payload.status, `${prefix}: status payload`),
		};
	}
	if ("reason" in payload) {
		if (payload.reason === undefined) return { kind: "close" };
		return {
			...payload,
			reason: normalizeWireAdmissiblePayload(payload.reason, `${prefix}: close reason`),
		};
	}
	return payload;
}

function isCanonicalWireBridgeDataBody(value: unknown): value is CanonicalWireBridgeDataBody {
	if (!isPlainDataRecord(value)) return false;
	const kind = ownData(value, "kind");
	if (kind === "value") {
		return hasOnlyKeys(value, ["kind", "value"]) && ownData(value, "value") instanceof Uint8Array;
	}
	if (kind === "wire_edge") {
		return (
			hasOnlyKeys(value, ["frame", "kind"]) && isCanonicalWireEdgeFrame(ownData(value, "frame"))
		);
	}
	return false;
}

function isCanonicalWireBridgeDataBodyLike(value: unknown): boolean {
	if (!isPlainDataRecord(value)) return false;
	const kind = ownData(value, "kind");
	if (kind === "wire_edge") return "frame" in value;
	if (kind !== "value") return false;
	return "value" in value && ownData(value, "value") instanceof Uint8Array;
}

function isCanonicalWireEdgeFrame(value: unknown): value is CanonicalWireEdgeFrame {
	if (!isPlainDataRecord(value)) return false;
	const kind = ownData(value, "kind");
	const edgeId = ownData(value, "edgeId");
	const causeId = ownData(value, "causeId");
	if (typeof edgeId !== "string" || edgeId.length === 0) return false;
	if (typeof causeId !== "string" || causeId.length === 0) return false;
	if (kind === "dirty") return hasOnlyKeys(value, ["causeId", "edgeId", "kind"]);
	if (kind === "data") {
		return (
			hasOnlyKeys(value, ["causeId", "edgeId", "kind", "value"]) &&
			ownData(value, "value") instanceof Uint8Array
		);
	}
	return false;
}

function isCanonicalWireEdgeFrameLike(value: unknown): boolean {
	if (!isPlainDataRecord(value)) return false;
	const kind = ownData(value, "kind");
	if (kind !== "dirty" && kind !== "data") return false;
	return "edgeId" in value || "causeId" in value || "value" in value;
}

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
	if (!isRecord(value)) return false;
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) return false;
	if (Object.getOwnPropertySymbols(value).length > 0) return false;
	for (const key of Object.getOwnPropertyNames(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
			return false;
		}
	}
	return true;
}

function ownData(value: Record<string, unknown>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function hasOwnData(value: Record<string, unknown>, key: string): boolean {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor !== undefined && "value" in descriptor;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const allowed = new Set(keys);
	const actual = Object.getOwnPropertyNames(value);
	return actual.length === keys.length && actual.every((key) => allowed.has(key));
}

function cloneCanonicalWireBridgeDataBody(
	value: CanonicalWireBridgeDataBody,
): CanonicalWireBridgeDataBody {
	if (value.kind === "value") return { kind: "value", value: Uint8Array.from(value.value) };
	return { kind: "wire_edge", frame: cloneCanonicalWireEdgeFrame(value.frame) };
}

function cloneCanonicalWireEdgeFrame(value: CanonicalWireEdgeFrame): CanonicalWireEdgeFrame {
	return {
		kind: value.kind,
		edgeId: value.edgeId,
		causeId: value.causeId,
		...(value.value === undefined ? {} : { value: Uint8Array.from(value.value) }),
	};
}

export function bridgePayloadError(payload: unknown, fallback: unknown): unknown {
	if (
		typeof payload === "object" &&
		payload !== null &&
		(payload as { readonly kind?: unknown }).kind === "error"
	) {
		return (payload as { readonly error?: unknown }).error;
	}
	return fallback;
}

export function rethrowGraphRuntimeInvariant(error: unknown): void {
	const message = errorMessage(error);
	if (
		message.includes("R-reentrancy") ||
		message.includes("R-rewire") ||
		message.includes("R-graph-domain") ||
		message.includes("D37") ||
		message.includes("D22") ||
		message.includes("different graph") ||
		message.includes("cross-graph") ||
		message.includes("wire bridge") ||
		message.includes("mid-fn topology mutation") ||
		message.includes("reentrant dep mutation") ||
		message.includes("feedback cycle")
	) {
		throw error;
	}
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
