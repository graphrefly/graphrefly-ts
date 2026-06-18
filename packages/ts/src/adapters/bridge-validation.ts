/**
 * Graph-visible wire bridge envelope helpers (D134).
 *
 * This first slice is transport-free: commands become outbound envelope facts,
 * remote receipts enter only through the inbound fact node, and retry/ack timeout
 * state is surfaced through graph-visible attempts/status/errors nodes.
 */

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
	const kind =
		typeof payload === "object" && payload !== null
			? (payload as { readonly kind?: unknown }).kind
			: undefined;
	switch (type) {
		case "data":
			return kind === "data" && (payload as { readonly value?: unknown }).value !== undefined
				? undefined
				: `${prefix}: data envelope requires data payload`;
		case "nack":
		case "error":
			return kind === "error" && (payload as { readonly error?: unknown }).error !== undefined
				? undefined
				: `${prefix}: ${type} envelope requires error payload`;
		case "status":
			return kind === "status" && (payload as { readonly status?: unknown }).status !== undefined
				? undefined
				: `${prefix}: status envelope requires status payload`;
		case "close":
			return kind === "close" ? undefined : `${prefix}: close envelope requires close payload`;
		case "start":
		case "ack":
			return payload === undefined
				? undefined
				: `${prefix}: ${type} envelope must not carry a payload`;
	}
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
