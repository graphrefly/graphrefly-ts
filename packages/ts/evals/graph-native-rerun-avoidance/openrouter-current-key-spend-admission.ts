import { empiricalStrictJsonDigest, exactKeys, record, safeInteger } from "./canonical.js";
import type { OpenRouterResponsesCredentialCapabilityV1 } from "./openrouter-responses-model-turn.js";

export const OPENROUTER_CURRENT_KEY_ENDPOINT = "https://openrouter.ai/api/v1/key";
export const OPENROUTER_CURRENT_KEY_SPEND_ADMISSION_SCHEMA =
	"graphrefly.private-solution-eval.openrouter-current-key-spend-admission.v1";
export const OPENROUTER_CURRENT_KEY_MAX_RESPONSE_BYTES = 16_384;

export interface OpenRouterCurrentKeySpendAdmissionV1 {
	readonly schemaVersion: typeof OPENROUTER_CURRENT_KEY_SPEND_ADMISSION_SCHEMA;
	readonly limitMicrousd: number;
	readonly remainingMicrousd: number;
	readonly usageMicrousd: number;
	readonly limitReset: "none";
	readonly isManagementKey: false;
	readonly admissionDigest: string;
}

export interface OpenRouterCurrentKeySpendAdmissionRequestV1 {
	readonly credential: OpenRouterResponsesCredentialCapabilityV1;
	readonly expectedLimitMicrousd: number;
	readonly requiredRemainingMicrousd: number;
	readonly signal: AbortSignal;
}

export interface OpenRouterCurrentKeySpendAdmissionCapabilityV1 {
	read(
		input: OpenRouterCurrentKeySpendAdmissionRequestV1,
	): Promise<OpenRouterCurrentKeySpendAdmissionV1>;
}

const constructedAdmissions = new WeakSet<object>();

export function consumeOpenRouterCurrentKeySpendAdmission(
	value: unknown,
): OpenRouterCurrentKeySpendAdmissionV1 {
	if (value === null || typeof value !== "object" || !constructedAdmissions.delete(value)) {
		throw new TypeError("OpenRouter current-key admission must be same-process and single-use");
	}
	return value as OpenRouterCurrentKeySpendAdmissionV1;
}

function ownFetch(value: unknown): typeof fetch {
	const capability = record(value, "openRouter.currentKey.fetchCapability");
	exactKeys(capability, ["fetch"], "openRouter.currentKey.fetchCapability");
	const descriptor = Object.getOwnPropertyDescriptor(capability, "fetch");
	if (
		descriptor === undefined ||
		"get" in descriptor ||
		"set" in descriptor ||
		typeof descriptor.value !== "function"
	) {
		throw new TypeError("OpenRouter current-key fetch capability must be an own function");
	}
	return descriptor.value as typeof fetch;
}

async function readBoundedBody(response: Response, signal: AbortSignal): Promise<Uint8Array> {
	let declaredLength: string | null;
	try {
		declaredLength = response.headers.get("content-length");
	} catch {
		throw new TypeError("OpenRouter current-key response headers were unreadable");
	}
	if (declaredLength !== null) {
		const parsed = Number(declaredLength);
		if (
			!Number.isSafeInteger(parsed) ||
			parsed < 0 ||
			parsed > OPENROUTER_CURRENT_KEY_MAX_RESPONSE_BYTES
		) {
			await response.body?.cancel().catch(() => undefined);
			throw new TypeError("OpenRouter current-key response exceeds its byte bound");
		}
	}
	if (response.body === null) return new Uint8Array();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	try {
		for (;;) {
			const next = await reader.read().catch(() => {
				if (signal.aborted) {
					throw new DOMException("OpenRouter current-key request cancelled by host", "AbortError");
				}
				throw new TypeError("OpenRouter current-key response body was unreadable");
			});
			if (next.done) break;
			if (!(next.value instanceof Uint8Array)) {
				throw new TypeError("OpenRouter current-key response yielded non-byte data");
			}
			byteLength += next.value.byteLength;
			if (byteLength > OPENROUTER_CURRENT_KEY_MAX_RESPONSE_BYTES) {
				throw new TypeError("OpenRouter current-key response exceeds its byte bound");
			}
			chunks.push(next.value.slice());
		}
	} catch (error) {
		await reader.cancel().catch(() => undefined);
		if (signal.aborted) {
			throw new DOMException("OpenRouter current-key request cancelled by host", "AbortError");
		}
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

function usdToMicrousd(value: unknown, direction: "ceil" | "floor", path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new TypeError(`${path} must be a finite non-negative USD amount`);
	}
	const scaled = value * 1_000_000;
	const converted = direction === "ceil" ? Math.ceil(scaled) : Math.floor(scaled);
	return safeInteger(converted, `${path}.microusd`);
}

function ownData(value: Record<string, unknown>, key: string, path: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (descriptor === undefined || "get" in descriptor || "set" in descriptor) {
		throw new TypeError(`${path}.${key} must be an own data property`);
	}
	return descriptor.value;
}

export function createOpenRouterCurrentKeySpendAdmissionCapability(value: {
	readonly fetch: typeof fetch;
}): OpenRouterCurrentKeySpendAdmissionCapabilityV1 {
	const fetchRequest = ownFetch(value);
	return Object.freeze({
		async read(
			input: OpenRouterCurrentKeySpendAdmissionRequestV1,
		): Promise<OpenRouterCurrentKeySpendAdmissionV1> {
			const credential = record(input.credential, "openRouter.currentKey.credential");
			exactKeys(
				credential,
				["bearerToken", "credentialBindingRef", "credentialBindingRevision"],
				"openRouter.currentKey.credential",
			);
			const bearerToken = ownData(credential, "bearerToken", "openRouter.currentKey.credential");
			const expectedLimitMicrousd = safeInteger(
				input.expectedLimitMicrousd,
				"openRouter.currentKey.expectedLimitMicrousd",
				{ min: 1 },
			);
			const requiredRemainingMicrousd = safeInteger(
				input.requiredRemainingMicrousd,
				"openRouter.currentKey.requiredRemainingMicrousd",
				{ max: expectedLimitMicrousd },
			);
			if (
				typeof bearerToken !== "string" ||
				bearerToken.length < 16 ||
				bearerToken.length > 4_096
			) {
				throw new TypeError("OpenRouter current-key admission requires an explicit credential");
			}
			if (!(input.signal instanceof AbortSignal)) {
				throw new TypeError("OpenRouter current-key admission requires an AbortSignal");
			}
			if (input.signal.aborted) {
				throw new DOMException("OpenRouter current-key request cancelled by host", "AbortError");
			}
			let response: Response;
			try {
				response = await fetchRequest(OPENROUTER_CURRENT_KEY_ENDPOINT, {
					method: "GET",
					headers: {
						authorization: `Bearer ${bearerToken}`,
						accept: "application/json",
					},
					signal: input.signal,
					redirect: "error",
					cache: "no-store",
					credentials: "omit",
					referrerPolicy: "no-referrer",
				});
			} catch {
				if (input.signal.aborted) {
					throw new DOMException("OpenRouter current-key request cancelled by host", "AbortError");
				}
				throw new TypeError("OpenRouter current-key metadata request failed");
			}
			if (!(response instanceof Response)) {
				throw new TypeError("OpenRouter current-key fetch returned an invalid response");
			}
			if (response.status !== 200) {
				await response.body?.cancel().catch(() => undefined);
				throw new TypeError("OpenRouter current-key metadata request was rejected");
			}
			const bytes = await readBoundedBody(response, input.signal);
			let parsed: unknown;
			try {
				parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
			} catch {
				throw new TypeError("OpenRouter current-key metadata was not bounded UTF-8 JSON");
			}
			const envelope = record(parsed, "openRouter.currentKey.response");
			const data = record(
				ownData(envelope, "data", "openRouter.currentKey.response"),
				"openRouter.currentKey.response.data",
			);
			const limitMicrousd = usdToMicrousd(
				ownData(data, "limit", "openRouter.currentKey.response.data"),
				"floor",
				"openRouter.currentKey.limit",
			);
			const remainingMicrousd = usdToMicrousd(
				ownData(data, "limit_remaining", "openRouter.currentKey.response.data"),
				"floor",
				"openRouter.currentKey.limitRemaining",
			);
			const usageMicrousd = usdToMicrousd(
				ownData(data, "usage", "openRouter.currentKey.response.data"),
				"ceil",
				"openRouter.currentKey.usage",
			);
			if (
				ownData(data, "limit_reset", "openRouter.currentKey.response.data") !== null ||
				ownData(data, "is_management_key", "openRouter.currentKey.response.data") !== false ||
				limitMicrousd !== expectedLimitMicrousd ||
				remainingMicrousd > limitMicrousd ||
				usageMicrousd > limitMicrousd ||
				remainingMicrousd < requiredRemainingMicrousd
			) {
				throw new TypeError("OpenRouter current-key metadata failed spend admission");
			}
			const admitted = Object.freeze({
				schemaVersion: OPENROUTER_CURRENT_KEY_SPEND_ADMISSION_SCHEMA,
				limitMicrousd,
				remainingMicrousd,
				usageMicrousd,
				limitReset: "none" as const,
				isManagementKey: false as const,
			});
			const result = Object.freeze({
				...admitted,
				admissionDigest: empiricalStrictJsonDigest(admitted),
			});
			constructedAdmissions.add(result);
			return result;
		},
	});
}
