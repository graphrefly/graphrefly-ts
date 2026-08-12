import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_BYTES,
} from "../../evals/empirical-memory-rerun-avoidance/d733-coordinates.js";
import {
	createD733GraphNativeRouteAdmission,
	createD733GraphNativeRouteProfile,
	createD733GraphNativeRouteProfileFromCanonicalBytes,
	createD733RouteAccessProjection,
	createD733RouteEligibility,
	type D733GraphNativeRouteAdmissionV1,
	type D733GraphNativeRouteProfileV1,
	validateD733GraphNativeRouteProfile,
} from "../../evals/empirical-memory-rerun-avoidance/d733-graph-native-route-profile.js";
import { validateD733TrackedImplementationBytes } from "../../evals/empirical-memory-rerun-avoidance/d733-implementation-manifest.js";
import { invokeD733OpenRouterGraphTurn } from "../../evals/empirical-memory-rerun-avoidance/d733-openrouter-graph-turn.js";

const encoder = new TextEncoder();

function endpointBytes(
	profile: D733GraphNativeRouteProfileV1,
	override: Readonly<Record<string, unknown>> = {},
): Uint8Array {
	return encoder.encode(
		JSON.stringify({
			data: {
				id: profile.requestModel,
				endpoints: [
					{
						name: `${profile.providerName} | ${profile.selectedEndpointModel}`,
						provider_name: profile.providerName,
						tag: profile.providerTag,
						quantization: profile.quantization,
						model: profile.selectedEndpointModel,
						supported_parameters: ["reasoning", "tool_choice", "tools"],
						pricing: {
							prompt: profile.pricing.promptUsdPerToken,
							completion: profile.pricing.completionUsdPerToken,
							input_cache_read: profile.pricing.cacheReadUsdPerToken,
						},
						...override,
					},
				],
			},
		}),
	);
}

function admission(profile: D733GraphNativeRouteProfileV1): D733GraphNativeRouteAdmissionV1 {
	return createD733GraphNativeRouteAdmission({
		profile,
		access: createD733RouteAccessProjection({
			profile,
			observationRevision: "d733.test-access.v1",
			allowedModels: [profile.requestModel],
			allowedProviders: [profile.providerName],
		}),
		eligibility: createD733RouteEligibility({ profile, responseBytes: endpointBytes(profile) }),
	});
}

function alternateProfile(): D733GraphNativeRouteProfileV1 {
	return createD733GraphNativeRouteProfile({
		profileRef: "d733.test.other-provider.v1",
		requestModel: "other/model-v1",
		selectedEndpointModel: "other/model-v1-20260811",
		providerName: "OtherProvider",
		providerTag: "other/provider-fp8",
		quantization: "fp8",
		endpointProtocol: "chat-completions",
		endpointUrl: "https://openrouter.ai/api/v1/chat/completions",
		reasoningEffort: "high",
		requiredWireModelParameters: ["reasoning", "tool_choice", "tools"],
		allowFallbacks: false,
		allowProviderSwitch: false,
		pricing: {
			sourceUrl: "https://openrouter.ai/api/v1/models/other/model-v1/endpoints",
			revision: "d733.test-price.v1",
			promptUsdPerToken: "0.0000001",
			completionUsdPerToken: "0.0000002",
			cacheReadUsdPerToken: "0.00000002",
			inputMicrousdPerMillionTokens: 100_000,
			outputMicrousdPerMillionTokens: 200_000,
			cacheReadMicrousdPerMillionTokens: 20_000,
		},
	});
}

async function capturedWire(
	profile: D733GraphNativeRouteProfileV1,
	routeAdmission: D733GraphNativeRouteAdmissionV1,
	conversation: readonly unknown[] = [],
): Promise<Record<string, unknown>> {
	let body: Record<string, unknown> | null = null;
	await invokeD733OpenRouterGraphTurn({
		effectRequest: {
			kind: "graph-effect-request",
			runSequence: 0,
			issuedRequestDigest: empiricalStrictJsonDigest({ issued: profile.profileDigest }),
			effectSequence: 1,
			effectKind: "provider-request",
			logicalRequestDigest: empiricalStrictJsonDigest({ logical: profile.profileDigest }),
			attemptOrdinal: 1,
			retryReason: "none",
			retryAfterMs: null,
			toolIntent: null,
			phaseBefore: "none",
			workspaceStateDigest: empiricalStrictJsonDigest({ workspace: profile.profileDigest }),
			requestDigest: empiricalStrictJsonDigest({ request: profile.profileDigest }),
		},
		credential: {
			bearerToken: "not-a-live-d733-test-credential",
			credentialBindingRef: "d733.test",
			credentialBindingRevision: "v1",
		},
		transport: {
			async request(request) {
				body = JSON.parse(new TextDecoder().decode(request.body)) as Record<string, unknown>;
				return {
					status: 200,
					retryAfterMs: null,
					body: encoder.encode(
						JSON.stringify({
							id: "d733-test-response",
							usage: { prompt_tokens: 1, completion_tokens: 1 },
							choices: [{ finish_reason: "stop", message: { content: "done" } }],
							openrouter_metadata: {
								endpoints: {
									available: [
										{
											provider: profile.providerName,
											model: profile.selectedEndpointModel,
											selected: true,
										},
									],
								},
							},
						}),
					),
				};
			},
		},
		taskStatement: "D733 injected test",
		conversation: { messages: conversation as never[] },
		signal: new AbortController().signal,
		monotonicNowMs: () => 1,
		routeAdmission,
	});
	if (body === null) throw new TypeError("D733 test did not capture a body");
	return body;
}

describe("D733 Graph-native route profile", () => {
	it("binds the exact decision-bearing implementation sources", async () => {
		const source = (name: string) =>
			readFile(new URL(`../../evals/empirical-memory-rerun-avoidance/${name}`, import.meta.url));
		expect(
			validateD733TrackedImplementationBytes({
				routeProfile: await source("d733-graph-native-route-profile.ts"),
				coordinates: await source("d733-coordinates.ts"),
				providerTurn: await source("d733-openrouter-graph-turn.ts"),
				preLive: await source("d733-route-profile-pre-live.ts"),
			}),
		).toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	it("loads the approved 0731 profile from exact canonical bytes", () => {
		const loaded = createD733GraphNativeRouteProfileFromCanonicalBytes(
			D733_DEEPSEEK_V4_FLASH_0731_PROFILE_BYTES,
		);
		expect(loaded).toEqual(D733_DEEPSEEK_V4_FLASH_0731_PROFILE);
		expect(loaded.requestModel).toBe("deepseek/deepseek-v4-flash-0731");
		expect(loaded.selectedEndpointModel).toBe("deepseek/deepseek-v4-flash-20260731");
		expect(loaded.pricing).toMatchObject({
			inputMicrousdPerMillionTokens: 80_000,
			outputMicrousdPerMillionTokens: 180_000,
			cacheReadMicrousdPerMillionTokens: 16_000,
		});
	});

	it("lowers two data-selected profiles without changing the harness", async () => {
		const alternate = alternateProfile();
		const primaryBody = await capturedWire(
			D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			admission(D733_DEEPSEEK_V4_FLASH_0731_PROFILE),
		);
		const alternateBody = await capturedWire(alternate, admission(alternate));
		expect(primaryBody).toMatchObject({
			model: "deepseek/deepseek-v4-flash-0731",
			provider: {
				order: ["deepinfra/fp4"],
				only: ["deepinfra/fp4"],
				allow_fallbacks: false,
				require_parameters: true,
			},
		});
		expect(alternateBody).toMatchObject({
			model: "other/model-v1",
			provider: {
				order: ["other/provider-fp8"],
				only: ["other/provider-fp8"],
			},
		});
		expect(primaryBody).not.toHaveProperty("parallel_tool_calls");
		expect(alternateBody).not.toHaveProperty("parallel_tool_calls");
	});

	it("admits bounded Graph conversations above 256 KiB and rejects more than one MiB before transport", async () => {
		const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
		const route = admission(profile);
		const body = await capturedWire(profile, route, [
			{ role: "user", content: "x".repeat(300_000) },
		]);
		expect(encoder.encode(JSON.stringify(body)).byteLength).toBeGreaterThan(262_144);
		let transportCalls = 0;
		await expect(
			invokeD733OpenRouterGraphTurn({
				effectRequest: {
					kind: "graph-effect-request",
					runSequence: 0,
					issuedRequestDigest: empiricalStrictJsonDigest({ issued: "d739-over-bound" }),
					effectSequence: 1,
					effectKind: "provider-request",
					logicalRequestDigest: empiricalStrictJsonDigest({ logical: "d739-over-bound" }),
					attemptOrdinal: 1,
					retryReason: "none",
					retryAfterMs: null,
					toolIntent: null,
					phaseBefore: "none",
					workspaceStateDigest: empiricalStrictJsonDigest({ workspace: "d739-over-bound" }),
					requestDigest: empiricalStrictJsonDigest({ request: "d739-over-bound" }),
				},
				credential: {
					bearerToken: "not-a-live-d739-test-credential",
					credentialBindingRef: "d739.test",
					credentialBindingRevision: "v1",
				},
				transport: {
					async request() {
						transportCalls += 1;
						throw new Error("unreachable");
					},
				},
				taskStatement: "D739 over-bound request test",
				conversation: { messages: [{ role: "user", content: "x".repeat(1_100_000) }] },
				signal: new AbortController().signal,
				monotonicNowMs: () => 1,
				routeAdmission: route,
			}),
		).rejects.toThrow(/wire bound/);
		expect(transportCalls).toBe(0);
	});

	it("fails closed on guardrail, pricing, forged admission, and accessor input", async () => {
		expect(() =>
			createD733RouteAccessProjection({
				profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
				observationRevision: "d733.test-access.v1",
				allowedModels: ["deepseek/deepseek-v4-flash"],
				allowedProviders: ["DeepInfra"],
			}),
		).toThrow(/not permitted/);
		expect(() =>
			createD733RouteEligibility({
				profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
				responseBytes: endpointBytes(D733_DEEPSEEK_V4_FLASH_0731_PROFILE, {
					pricing: {
						prompt: "0.00000009",
						completion: "0.00000018",
						input_cache_read: "0.000000016",
					},
				}),
			}),
		).toThrow(/pricing/);
		let transportCalls = 0;
		const realAdmission = admission(D733_DEEPSEEK_V4_FLASH_0731_PROFILE);
		await expect(
			invokeD733OpenRouterGraphTurn({
				effectRequest: {
					kind: "graph-effect-request",
					runSequence: 0,
					issuedRequestDigest: empiricalStrictJsonDigest({ issued: 1 }),
					effectSequence: 1,
					effectKind: "provider-request",
					logicalRequestDigest: empiricalStrictJsonDigest({ logical: 1 }),
					attemptOrdinal: 1,
					retryReason: "none",
					retryAfterMs: null,
					toolIntent: null,
					phaseBefore: "none",
					workspaceStateDigest: empiricalStrictJsonDigest({ workspace: 1 }),
					requestDigest: empiricalStrictJsonDigest({ request: 1 }),
				},
				credential: {
					bearerToken: "not-a-live-d733-test-credential",
					credentialBindingRef: "d733.test",
					credentialBindingRevision: "v1",
				},
				transport: {
					async request() {
						transportCalls += 1;
						throw new Error("unreachable");
					},
				},
				taskStatement: "D733 forged admission test",
				conversation: { messages: [] },
				signal: new AbortController().signal,
				monotonicNowMs: () => 1,
				routeAdmission: { ...realAdmission },
			}),
		).rejects.toThrow(/same-process constructed/);
		expect(transportCalls).toBe(0);
		let getterHits = 0;
		const candidate = {
			...D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			get requestModel() {
				getterHits += 1;
				return "deepseek/deepseek-v4-flash-0731";
			},
		};
		expect(() => validateD733GraphNativeRouteProfile(candidate)).toThrow();
		expect(getterHits).toBe(0);
		expect(() =>
			createD733GraphNativeRouteProfile(
				candidate as unknown as Parameters<typeof createD733GraphNativeRouteProfile>[0],
			),
		).toThrow();
		expect(getterHits).toBe(0);
	});
});
