import { exactKeys, record, safeInteger } from "./canonical.js";
import { MAX_EMPIRICAL_MODEL_TURN_REQUEST_BYTES } from "./model-execution.js";
import type {
	OpenRouterResponsesByteTransportV1,
	OpenRouterResponsesTransportRequestV1,
	OpenRouterResponsesTransportResponseV1,
} from "./openrouter-responses-model-turn.js";
import {
	OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
	OPENROUTER_RESPONSES_ENDPOINT,
} from "./openrouter-route-qualification.js";
import { createOpenRouterTransportFailure } from "./openrouter-transport-failure.js";

const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
	Object.getPrototypeOf(Uint8Array.prototype),
	"byteLength",
)?.get;

export interface OpenRouterResponsesFetchCapabilityV1 {
	readonly fetch: typeof fetch;
}

function ownFetch(value: unknown): typeof fetch {
	const capability = record(value, "openRouter.fetchCapability");
	exactKeys(capability, ["fetch"], "openRouter.fetchCapability");
	const descriptor = Object.getOwnPropertyDescriptor(capability, "fetch");
	if (
		descriptor === undefined ||
		"get" in descriptor ||
		"set" in descriptor ||
		typeof descriptor.value !== "function"
	) {
		throw new TypeError("OpenRouter fetch capability must be an own function data property");
	}
	return descriptor.value as typeof fetch;
}

async function readBoundedResponseBody(
	response: Response,
	maxResponseBytes: number,
	signal: AbortSignal,
): Promise<Uint8Array> {
	const declaredLength = response.headers.get("content-length");
	if (declaredLength !== null) {
		const parsedLength = Number(declaredLength);
		if (
			!Number.isSafeInteger(parsedLength) ||
			parsedLength < 0 ||
			parsedLength > maxResponseBytes
		) {
			await response.body?.cancel().catch(() => undefined);
			throw new TypeError("OpenRouter response exceeds the qualified byte bound");
		}
	}
	if (response.body === null) return new Uint8Array();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	try {
		for (;;) {
			let next: Awaited<ReturnType<typeof reader.read>>;
			try {
				next = await reader.read();
			} catch (error) {
				if (signal.aborted) {
					throw new DOMException("OpenRouter request cancelled by host", "AbortError");
				}
				throw createOpenRouterTransportFailure("response-body", error);
			}
			if (next.done) break;
			if (!(next.value instanceof Uint8Array)) {
				throw new TypeError("OpenRouter response stream yielded non-byte data");
			}
			byteLength += next.value.byteLength;
			if (byteLength > maxResponseBytes) {
				throw new TypeError("OpenRouter response exceeds the qualified byte bound");
			}
			chunks.push(next.value.slice());
		}
	} catch (error) {
		await reader.cancel().catch(() => undefined);
		throw error;
	} finally {
		reader.releaseLock();
	}
	const body = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

function retryAfterObservation(response: Response): Readonly<{
	retryAfterMs: number | null;
	retryAfterDisposition: "absent" | "parsed" | "invalid" | "unavailable";
}> {
	let raw: string | null;
	try {
		raw = response.headers.get("retry-after");
	} catch {
		return Object.freeze({ retryAfterMs: null, retryAfterDisposition: "unavailable" });
	}
	if (raw === null) {
		return Object.freeze({ retryAfterMs: null, retryAfterDisposition: "absent" });
	}
	if (!/^[1-9]\d{0,2}$/.test(raw)) {
		return Object.freeze({ retryAfterMs: null, retryAfterDisposition: "invalid" });
	}
	const seconds = Number(raw);
	if (!Number.isSafeInteger(seconds) || seconds > 600) {
		return Object.freeze({ retryAfterMs: null, retryAfterDisposition: "invalid" });
	}
	return Object.freeze({ retryAfterMs: seconds * 1_000, retryAfterDisposition: "parsed" });
}

/**
 * Package-private, one-fetch byte transport. Redirects are rejected so the
 * explicit bearer capability can never be replayed to a second URL.
 */
export function createOpenRouterResponsesFetchByteTransport(
	value: OpenRouterResponsesFetchCapabilityV1,
): OpenRouterResponsesByteTransportV1 {
	const fetchRequest = ownFetch(value);
	return Object.freeze({
		async request(
			input: OpenRouterResponsesTransportRequestV1,
		): Promise<OpenRouterResponsesTransportResponseV1> {
			if (
				(input.endpoint !== OPENROUTER_RESPONSES_ENDPOINT &&
					input.endpoint !== OPENROUTER_CHAT_COMPLETIONS_ENDPOINT) ||
				input.method !== "POST" ||
				input.contentType !== "application/json" ||
				input.xOpenRouterMetadata !== "enabled" ||
				input.maxResponseBytes !== 1_048_576 ||
				typeof input.authorizationBearer !== "string" ||
				input.authorizationBearer.length < 16 ||
				input.authorizationBearer.length > 4_096 ||
				!(input.body instanceof Uint8Array) ||
				typedArrayByteLengthGetter === undefined ||
				Object.getPrototypeOf(input.body) !== Uint8Array.prototype ||
				Object.hasOwn(input.body, "byteLength")
			) {
				throw new TypeError("OpenRouter transport request is outside the qualified route");
			}
			const bodyByteLength = typedArrayByteLengthGetter.call(input.body) as number;
			if (bodyByteLength > MAX_EMPIRICAL_MODEL_TURN_REQUEST_BYTES) {
				throw new TypeError("OpenRouter transport request exceeds the qualified byte bound");
			}
			if (input.signal.aborted) {
				throw new DOMException("OpenRouter request cancelled by host", "AbortError");
			}
			const maxResponseBytes = safeInteger(
				input.maxResponseBytes,
				"openRouter.transport.maxResponseBytes",
				{ min: 1, max: 1_048_576 },
			);
			let response: Response;
			try {
				response = await fetchRequest(input.endpoint, {
					method: input.method,
					headers: {
						authorization: `Bearer ${input.authorizationBearer}`,
						"content-type": input.contentType,
						"x-openrouter-metadata": input.xOpenRouterMetadata,
					},
					body: input.body.slice(),
					signal: input.signal,
					redirect: "error",
					cache: "no-store",
					credentials: "omit",
					referrerPolicy: "no-referrer",
				});
			} catch (error) {
				if (input.signal.aborted) {
					throw new DOMException("OpenRouter request cancelled by host", "AbortError");
				}
				throw createOpenRouterTransportFailure("request", error);
			}
			let status: number;
			try {
				status = safeInteger(response.status, "openRouter.transport.status", {
					min: 100,
					max: 599,
				});
			} catch (error) {
				await response.body?.cancel().catch(() => undefined);
				throw error;
			}
			const retryAfter = retryAfterObservation(response);
			return Object.freeze({
				status,
				body: await readBoundedResponseBody(response, maxResponseBytes, input.signal),
				...retryAfter,
			});
		},
	});
}
