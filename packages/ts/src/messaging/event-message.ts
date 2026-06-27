import type { DataIssue } from "../data/index.js";
import type { EventMessage, EventMessageOptions } from "./types.js";
import { assertNonEmpty, isObjectRecord } from "./utils.js";

export function eventMessage<T>(
	type: string,
	payload: T,
	opts: EventMessageOptions,
): EventMessage<T> {
	assertNonEmpty(type, "eventMessage.type");
	assertNonEmpty(opts.id, "eventMessage.id");
	return {
		id: opts.id,
		type,
		payload,
		...(opts.key === undefined ? {} : { key: opts.key }),
		...(opts.subjectId === undefined ? {} : { subjectId: opts.subjectId }),
		...(opts.correlationId === undefined ? {} : { correlationId: opts.correlationId }),
		...(opts.causationId === undefined ? {} : { causationId: opts.causationId }),
		...(opts.occurredAtMs === undefined ? {} : { occurredAtMs: opts.occurredAtMs }),
		...(opts.actor === undefined ? {} : { actor: opts.actor }),
		...(opts.evidenceRefs === undefined ? {} : { evidenceRefs: opts.evidenceRefs }),
		...(opts.schema === undefined ? {} : { schema: opts.schema }),
		...(opts.metadata === undefined ? {} : { metadata: opts.metadata }),
	};
}

export function isEventMessage(value: unknown): value is EventMessage {
	return eventMessageIssue(value) === undefined;
}

export function eventMessageIssue(value: unknown): DataIssue | undefined {
	if (!isObjectRecord(value)) {
		return eventIssue("event message must be an object");
	}
	if (typeof value.id !== "string" || value.id.length === 0) {
		return eventIssue("event message id must be a non-empty string");
	}
	if (typeof value.type !== "string" || value.type.length === 0) {
		return eventIssue("event message type must be a non-empty string");
	}
	if (!("payload" in value)) {
		return eventIssue("event message payload field is required");
	}
	return undefined;
}

function eventIssue(message: string): DataIssue {
	return {
		kind: "issue",
		code: "malformed-event-message",
		message,
		severity: "error",
		source: "messageBus.eventMessage",
	};
}
