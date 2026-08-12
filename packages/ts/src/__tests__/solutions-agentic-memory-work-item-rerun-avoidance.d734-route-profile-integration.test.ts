import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { D733_DEEPSEEK_V4_FLASH_0731_PROFILE } from "../../evals/empirical-memory-rerun-avoidance/d733-coordinates.js";
import {
	createD733GraphNativeRouteAdmission,
	createD733RouteAccessProjection,
	createD733RouteEligibility,
} from "../../evals/empirical-memory-rerun-avoidance/d733-graph-native-route-profile.js";
import { validateD734TrackedImplementationBytes } from "../../evals/empirical-memory-rerun-avoidance/d734-implementation-manifest.js";
import { createD734InjectedRouteProfileFixture } from "../../evals/empirical-memory-rerun-avoidance/d734-injected-route-profile-fixture.js";
import {
	createD734RouteBoundProviderAdapter,
	invokeD734RouteBoundOpenRouterTurn,
	runD734RouteProfileSixArmIntegration,
	validateD734RouteGraphEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/d734-route-profile-provider-integration.js";

const encoder = new TextEncoder();

function admission() {
	const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
	return createD733GraphNativeRouteAdmission({
		profile,
		access: createD733RouteAccessProjection({
			profile,
			observationRevision: "d734.injected-access.v1",
			allowedModels: [profile.requestModel],
			allowedProviders: [profile.providerName],
		}),
		eligibility: createD733RouteEligibility({
			profile,
			responseBytes: encoder.encode(
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
							},
						],
					},
				}),
			),
		}),
	});
}

describe("D734 route-profile six-arm integration", () => {
	it("binds every decision-bearing tracked D734 source", async () => {
		const source = (name: string) =>
			readFile(new URL(`../../evals/empirical-memory-rerun-avoidance/${name}`, import.meta.url));
		expect(
			validateD734TrackedImplementationBytes({
				providerIntegration: await source("d734-route-profile-provider-integration.ts"),
				injectedFixture: await source("d734-injected-route-profile-fixture.ts"),
				preLive: await source("d734-route-profile-integration-pre-live.ts"),
			}),
		).toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	it("routes every admitted provider result through Graph and completes six serial arms", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: admission(),
		});
		const result = await runD734RouteProfileSixArmIntegration({
			sourceDigest: D733_DEEPSEEK_V4_FLASH_0731_PROFILE.profileDigest,
			adapter: fixture.adapter,
			signal: new AbortController().signal,
		});
		expect(result.run.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(result.run.graphEvidence.runStatus).toBe("complete");
		expect(result.routeEvidence.facts).toHaveLength(fixture.providerCalls());
		expect(
			result.routeEvidence.facts.filter((fact) => fact.actualRouteEvidenceDigest === null),
		).toHaveLength(6);
		expect(
			result.routeEvidence.facts.filter((fact) => fact.actualRouteEvidenceDigest !== null).length,
		).toBeGreaterThanOrEqual(6);
		expect(fixture.maxActiveInvocations()).toBe(1);
		expect(fixture.activeWorkspaceCount()).toBe(0);
		expect(fixture.networkCalls()).toBe(0);
		expect(fixture.capturedWireBodies()).toHaveLength(fixture.providerCalls());
		await expect(
			runD734RouteProfileSixArmIntegration({
				sourceDigest: D733_DEEPSEEK_V4_FLASH_0731_PROFILE.profileDigest,
				adapter: fixture.adapter,
				signal: new AbortController().signal,
			}),
		).rejects.toThrow(/consumed/);

		const forged = structuredClone(result.routeEvidence);
		(forged.facts[0] as { providerResultDigest: string }).providerResultDigest =
			D733_DEEPSEEK_V4_FLASH_0731_PROFILE.profileDigest;
		expect(() => validateD734RouteGraphEvidence(forged)).toThrow(/factDigest/);
	}, 30_000);

	it("rejects route-admission accessors without evaluating them", () => {
		let getterHits = 0;
		const port = async () => {
			throw new TypeError("unreachable");
		};
		const input = {
			get routeAdmission() {
				getterHits += 1;
				return admission();
			},
			materialization: port,
			providerRequest: port,
			retryWait: port,
			toolAction: port,
			hiddenVerifier: port,
			cleanup: port,
		};
		expect(() => createD734RouteBoundProviderAdapter(input)).toThrow();
		expect(getterHits).toBe(0);
	});

	it("binds repeated terminal HTTP results to distinct Graph admissions", async () => {
		const routeAdmission = admission();
		const workspace = D733_DEEPSEEK_V4_FLASH_0731_PROFILE.profileDigest;
		let providerCalls = 0;
		const adapter = createD734RouteBoundProviderAdapter({
			routeAdmission,
			async materialization() {
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "materialization",
						status: "ready",
						workspaceStateDigest: workspace,
						evidenceDigest: workspace,
					},
				};
			},
			async providerRequest(input) {
				return invokeD734RouteBoundOpenRouterTurn({
					effectRequest: input.effectRequest,
					credential: {
						bearerToken: "not-a-live-d734-terminal-credential",
						credentialBindingRef: "d734.terminal-test",
						credentialBindingRevision: "v1",
					},
					transport: {
						async request() {
							providerCalls += 1;
							return {
								status: 400,
								retryAfterMs: null,
								retryAfterDisposition: "absent" as const,
								body: encoder.encode('{"error":{"code":"invalid_request"}}'),
							};
						},
					},
					taskStatement: "D734 terminal binding test",
					conversation: { messages: [] },
					signal: input.signal ?? new AbortController().signal,
					monotonicNowMs: () => providerCalls,
					routeAdmission,
					usageBasis: "measured",
				});
			},
			async retryWait() {
				throw new TypeError("terminal response cannot retry");
			},
			async toolAction() {
				throw new TypeError("terminal response cannot run tools");
			},
			async hiddenVerifier() {
				throw new TypeError("terminal response cannot verify");
			},
			async cleanup() {
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "cleanup",
						status: "succeeded",
						evidenceDigest: workspace,
					},
				};
			},
		});
		const result = await runD734RouteProfileSixArmIntegration({
			sourceDigest: workspace,
			adapter,
			signal: new AbortController().signal,
		});
		expect(providerCalls).toBe(6);
		expect(result.routeEvidence.facts).toHaveLength(6);
		expect(new Set(result.routeEvidence.facts.map((fact) => fact.effectAdmissionDigest)).size).toBe(
			6,
		);
		expect(result.run.terminalHttpGraphEvidence.facts).toHaveLength(6);
	}, 30_000);
});
