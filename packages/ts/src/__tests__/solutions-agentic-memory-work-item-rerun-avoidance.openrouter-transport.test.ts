import { describe, expect, it, vi } from "vitest";
import {
	createOpenRouterCredentialCapabilityFromOperatorEnvironment,
	OPENROUTER_API_KEY_ENVIRONMENT_NAME,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-first-task-smoke.js";
import { readOpenRouterSmokeOperatorMonotonicMs } from "../../evals/empirical-memory-rerun-avoidance/openrouter-first-task-smoke-operator.js";
import { createOpenRouterResponsesFetchByteTransport } from "../../evals/empirical-memory-rerun-avoidance/openrouter-responses-byte-transport.js";
import {
	MAX_OPENROUTER_RESPONSES_RESPONSE_BYTES,
	OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
	OPENROUTER_RESPONSES_ENDPOINT,
	type OpenRouterResponsesTransportRequestV1,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-responses-model-turn.js";
import type { OpenRouterRouteQualificationV1 } from "../../evals/empirical-memory-rerun-avoidance/openrouter-route-qualification.js";

const encoder = new TextEncoder();
const credentialSentinel = "openrouter-transport-secret-sentinel-0123456789";

function transportRequest(
	overrides: Partial<OpenRouterResponsesTransportRequestV1> = {},
): OpenRouterResponsesTransportRequestV1 {
	return {
		endpoint: OPENROUTER_RESPONSES_ENDPOINT,
		method: "POST",
		authorizationBearer: credentialSentinel,
		contentType: "application/json",
		xOpenRouterMetadata: "enabled",
		body: encoder.encode('{"bounded":true}'),
		maxResponseBytes: MAX_OPENROUTER_RESPONSES_RESPONSE_BYTES,
		signal: new AbortController().signal,
		...overrides,
	};
}

describe("B112 package-private OpenRouter live byte transport", () => {
	it("supplies safe-integer monotonic milliseconds at the outermost live operator boundary", () => {
		const observedAtMs = readOpenRouterSmokeOperatorMonotonicMs();
		expect(Number.isSafeInteger(observedAtMs)).toBe(true);
		expect(observedAtMs).toBeGreaterThanOrEqual(0);
	});

	it("constructs credential capability only from the outer operator environment snapshot", () => {
		const route = {
			dispatchMode: "live-approved",
			sharedCapacityQualification: {
				credentialBindingRef: "credential-binding.b112",
				credentialBindingRevision: "credential-binding.b112.v1",
			},
		} as OpenRouterRouteQualificationV1;
		const environmentReads: PropertyKey[] = [];
		const environment = new Proxy<Record<string, string | undefined>>(
			{ [OPENROUTER_API_KEY_ENVIRONMENT_NAME]: credentialSentinel },
			{
				get(target, key, receiver) {
					environmentReads.push(key);
					return Reflect.get(target, key, receiver);
				},
			},
		);
		const capability = createOpenRouterCredentialCapabilityFromOperatorEnvironment(
			environment,
			route,
		);
		expect(environmentReads).toEqual([OPENROUTER_API_KEY_ENVIRONMENT_NAME]);
		expect(capability).toEqual({
			credentialBindingRef: "credential-binding.b112",
			credentialBindingRevision: "credential-binding.b112.v1",
			bearerToken: credentialSentinel,
		});
		expect(() => createOpenRouterCredentialCapabilityFromOperatorEnvironment({}, route)).toThrow(
			OPENROUTER_API_KEY_ENVIRONMENT_NAME,
		);
		expect(() =>
			createOpenRouterCredentialCapabilityFromOperatorEnvironment(
				{ [OPENROUTER_API_KEY_ENVIRONMENT_NAME]: credentialSentinel },
				{ ...route, dispatchMode: "simulated" } as OpenRouterRouteQualificationV1,
			),
		).toThrow(/live-approved route/);
	});

	it("maps one request with redirect rejection and reads a bounded byte stream", async () => {
		const fetchCapability = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(encoder.encode('{"ok":'));
							controller.enqueue(encoder.encode("true}"));
							controller.close();
						},
					}),
					{ status: 200 },
				),
			),
		);
		const transport = createOpenRouterResponsesFetchByteTransport({
			fetch: fetchCapability,
		});
		const response = await transport.request(transportRequest());

		expect(fetchCapability).toHaveBeenCalledTimes(1);
		const [endpoint, init] = fetchCapability.mock.calls[0] ?? [];
		expect(endpoint).toBe(OPENROUTER_RESPONSES_ENDPOINT);
		expect(init).toMatchObject({
			method: "POST",
			redirect: "error",
			cache: "no-store",
			credentials: "omit",
			referrerPolicy: "no-referrer",
		});
		expect(init?.headers).toMatchObject({
			authorization: `Bearer ${credentialSentinel}`,
			"content-type": "application/json",
			"x-openrouter-metadata": "enabled",
		});
		expect(new TextDecoder().decode(response.body)).toBe('{"ok":true}');
	});

	it("allows only the separately qualified Chat Completions wire endpoint", async () => {
		const fetchCapability = vi.fn<typeof fetch>(() =>
			Promise.resolve(new Response('{"ok":true}', { status: 200 })),
		);
		const transport = createOpenRouterResponsesFetchByteTransport({ fetch: fetchCapability });

		await transport.request(transportRequest({ endpoint: OPENROUTER_CHAT_COMPLETIONS_ENDPOINT }));

		expect(fetchCapability).toHaveBeenCalledTimes(1);
		expect(fetchCapability.mock.calls[0]?.[0]).toBe(OPENROUTER_CHAT_COMPLETIONS_ENDPOINT);
	});

	it("fails closed on declared or streamed overflow without retry", async () => {
		const declaredBody = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode("x"));
				controller.close();
			},
		});
		const cancelDeclaredBody = vi.spyOn(declaredBody, "cancel");
		const declaredOverflow = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(declaredBody, {
					status: 200,
					headers: {
						"content-length": String(MAX_OPENROUTER_RESPONSES_RESPONSE_BYTES + 1),
					},
				}),
			),
		);
		await expect(
			createOpenRouterResponsesFetchByteTransport({
				fetch: declaredOverflow,
			}).request(transportRequest()),
		).rejects.toThrow(/byte bound/);
		expect(declaredOverflow).toHaveBeenCalledTimes(1);
		expect(cancelDeclaredBody).toHaveBeenCalledTimes(1);

		const streamedOverflow = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new Uint8Array(MAX_OPENROUTER_RESPONSES_RESPONSE_BYTES));
							controller.enqueue(new Uint8Array(1));
							controller.close();
						},
					}),
					{ status: 200 },
				),
			),
		);
		await expect(
			createOpenRouterResponsesFetchByteTransport({
				fetch: streamedOverflow,
			}).request(transportRequest()),
		).rejects.toThrow(/byte bound/);
		expect(streamedOverflow).toHaveBeenCalledTimes(1);
	});

	it("rejects route, method, or body substitution before fetch", async () => {
		const fetchCapability = vi.fn<typeof fetch>();
		const transport = createOpenRouterResponsesFetchByteTransport({ fetch: fetchCapability });
		for (const request of [
			transportRequest({ endpoint: "https://example.invalid/responses" as never }),
			transportRequest({ method: "GET" as never }),
			transportRequest({ body: new Uint8Array(262_145) }),
			transportRequest({ body: new (class extends Uint8Array {})(1) }),
		]) {
			await expect(transport.request(request)).rejects.toThrow(/qualified/);
		}
		expect(fetchCapability).not.toHaveBeenCalled();
	});

	it("does not call fetch after cancellation and never retries a thrown fetch", async () => {
		const cancelledFetch = vi.fn<typeof fetch>();
		const controller = new AbortController();
		controller.abort();
		await expect(
			createOpenRouterResponsesFetchByteTransport({
				fetch: cancelledFetch,
			}).request(transportRequest({ signal: controller.signal })),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(cancelledFetch).not.toHaveBeenCalled();

		const failedFetch = vi.fn<typeof fetch>(() =>
			Promise.reject(new Error(`raw transport failure ${credentialSentinel}`)),
		);
		let failure: unknown;
		try {
			await createOpenRouterResponsesFetchByteTransport({
				fetch: failedFetch,
			}).request(transportRequest());
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(TypeError);
		expect(String(failure)).toContain("OpenRouter byte transport failed");
		expect(String(failure)).not.toContain(credentialSentinel);
		expect(failedFetch).toHaveBeenCalledTimes(1);
	});
});
