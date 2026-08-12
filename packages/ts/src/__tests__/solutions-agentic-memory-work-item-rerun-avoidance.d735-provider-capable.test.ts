import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { D733_DEEPSEEK_V4_FLASH_0731_PROFILE } from "../../evals/empirical-memory-rerun-avoidance/d733-coordinates.js";
import {
	createD733GraphNativeRouteAdmission,
	createD733RouteAccessProjection,
	createD733RouteEligibility,
} from "../../evals/empirical-memory-rerun-avoidance/d733-graph-native-route-profile.js";
import { createD734InjectedRouteProfileFixture } from "../../evals/empirical-memory-rerun-avoidance/d734-injected-route-profile-fixture.js";
import { validateD735TrackedImplementationBytes } from "../../evals/empirical-memory-rerun-avoidance/d735-implementation-manifest.js";
import {
	createD735ProviderCapableRouteAdapter,
	createD735SimulatedLivePreflight,
	D735_PREFLIGHT_STAGES,
	runD735ProviderCapableSixArmPreflight,
	validateD735FailureClassification,
	validateD735PreflightGraphEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/d735-provider-capable-route-preflight.js";

const encoder = new TextEncoder();

function admission() {
	const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
	return createD733GraphNativeRouteAdmission({
		profile,
		access: createD733RouteAccessProjection({
			profile,
			observationRevision: "d735.test-access.v1",
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

function stages(seed: string) {
	return D735_PREFLIGHT_STAGES.map((stage, sequence) =>
		empiricalStrictJsonDigest({ seed, sequence, stage }),
	);
}

describe("D735 provider-capable Graph route pre-live", () => {
	it("routes the full six-arm injected block through Graph-owned preflight and route authority", async () => {
		const routeAdmission = admission();
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission,
		});
		const sourceDigest = D733_DEEPSEEK_V4_FLASH_0731_PROFILE.profileDigest;
		const result = await runD735ProviderCapableSixArmPreflight({
			sourceDigest,
			adapter: createD735ProviderCapableRouteAdapter({
				routeAdmission,
				baseAdapter: fixture.adapter,
				adapterSourceDigest: sourceDigest,
				executionClass: "injected-no-network",
			}),
			preflight: createD735SimulatedLivePreflight({
				routeAdmission,
				stageEvidenceDigests: stages(sourceDigest),
			}),
			signal: new AbortController().signal,
		});
		expect(result.preflightEvidence.facts.map((fact) => fact.stage)).toEqual(D735_PREFLIGHT_STAGES);
		expect(result.integration.run.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(result.integration.routeEvidence.facts).toHaveLength(fixture.providerCalls());
		expect(fixture.maxActiveInvocations()).toBe(1);
		expect(fixture.activeWorkspaceCount()).toBe(0);
		expect(fixture.networkCalls()).toBe(0);
	}, 30_000);

	it("rejects accessor, replay, and canonical preflight substitutions before provider execution", async () => {
		let getterHits = 0;
		expect(() =>
			createD735SimulatedLivePreflight({
				routeAdmission: admission(),
				get stageEvidenceDigests() {
					getterHits += 1;
					return stages(D733_DEEPSEEK_V4_FLASH_0731_PROFILE.profileDigest);
				},
			}),
		).toThrow();
		expect(getterHits).toBe(0);

		const routeAdmission = admission();
		const sourceDigest = D733_DEEPSEEK_V4_FLASH_0731_PROFILE.profileDigest;
		const preflight = createD735SimulatedLivePreflight({
			routeAdmission,
			stageEvidenceDigests: stages(sourceDigest),
		});
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission,
		});
		const adapter = createD735ProviderCapableRouteAdapter({
			routeAdmission,
			baseAdapter: fixture.adapter,
			adapterSourceDigest: sourceDigest,
			executionClass: "injected-no-network",
		});
		const result = await runD735ProviderCapableSixArmPreflight({
			sourceDigest,
			adapter,
			preflight,
			signal: new AbortController().signal,
		});
		await expect(
			runD735ProviderCapableSixArmPreflight({
				sourceDigest,
				adapter,
				preflight,
				signal: new AbortController().signal,
			}),
		).rejects.toThrow(/consumed/);
		const forged = structuredClone(result.preflightEvidence);
		(forged.facts[0] as { evidenceDigest: string }).evidenceDigest = sourceDigest;
		expect(() => validateD735PreflightGraphEvidence(forged)).toThrow(/factDigest/);
	});

	it("freezes failure classifications and every tracked D735 decision source", async () => {
		for (const classification of [
			"terminal-http",
			"response-decode-failure",
			"transport-failure",
			"route-evidence-failure",
		] as const)
			expect(validateD735FailureClassification(classification)).toBe(classification);
		expect(() => validateD735FailureClassification("provider-success")).toThrow();
		const source = (name: string) =>
			readFile(new URL(`../../evals/empirical-memory-rerun-avoidance/${name}`, import.meta.url));
		expect(
			validateD735TrackedImplementationBytes({
				providerPreflight: await source("d735-provider-capable-route-preflight.ts"),
				preLive: await source("d735-provider-capable-pre-live.ts"),
			}),
		).toMatch(/^sha256:[a-f0-9]{64}$/);
	});
});
