import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { D733_DEEPSEEK_V4_FLASH_0731_PROFILE } from "../../evals/empirical-memory-rerun-avoidance/d733-coordinates.js";
import {
	createD733GraphNativeRouteAdmission,
	createD733RouteAccessProjection,
	createD733RouteEligibility,
} from "../../evals/empirical-memory-rerun-avoidance/d733-graph-native-route-profile.js";
import { createD734InjectedRouteProfileFixture } from "../../evals/empirical-memory-rerun-avoidance/d734-injected-route-profile-fixture.js";
import { runD734RouteProfileSixArmLiveIntegration } from "../../evals/empirical-memory-rerun-avoidance/d734-route-profile-provider-integration.js";
import {
	D736_COORDINATES,
	D736_D735_ARTIFACT_SHA256,
	D736_D735_BUNDLE_DIGEST,
} from "../../evals/empirical-memory-rerun-avoidance/d736-coordinates.js";
import {
	acquireD736SingleUseDispatchClaimAtRootForTest,
	consumeD736DispatchClaimForExecution,
	consumeD736ExecutionAuthority,
} from "../../evals/empirical-memory-rerun-avoidance/d736-single-use-dispatch-claim.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "../../evals/empirical-memory-rerun-avoidance/openrouter-current-key-spend-admission.js";

const encoder = new TextEncoder();
const sha = (label: string) => empiricalStrictJsonDigest({ label });

function routeAdmission() {
	const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
	return createD733GraphNativeRouteAdmission({
		profile,
		access: createD733RouteAccessProjection({
			profile,
			observationRevision: "d736.test-access.v1",
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

async function currentKey() {
	return createOpenRouterCurrentKeySpendAdmissionCapability({
		async fetch() {
			return new Response(
				JSON.stringify({
					data: {
						limit: 32,
						limit_remaining: 20,
						usage: 12,
						limit_reset: null,
						is_management_key: false,
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		},
	}).read({
		credential: {
			bearerToken: "not-a-live-d736-test-credential",
			credentialBindingRef: "d736.test",
			credentialBindingRevision: "v1",
		},
		expectedLimitMicrousd: 32_000_000,
		requiredRemainingMicrousd: 6_000_000,
		signal: new AbortController().signal,
	});
}

describe("D736 D735-qualified Graph-native live boundary", () => {
	it("freezes the exact D735 baseline and one serial USD 6 block", () => {
		expect(D736_D735_ARTIFACT_SHA256).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(D736_D735_BUNDLE_DIGEST).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(D736_COORDINATES.blockHardCapMicrousd).toBe(6_000_000);
		expect(D736_COORDINATES.localEvalNoResetLimitMicrousd).toBe(32_000_000);
		expect(D736_COORDINATES.armOrder).toHaveLength(6);
		expect(D736_COORDINATES.maxActiveArms).toBe(1);
		expect(D736_COORDINATES.coldCensorsWarm).toBe(false);
		expect(D736_COORDINATES.retryPolicies).toEqual(["D671", "D675", "D710"]);
	});

	it("runs the live execution class through all six Graph arms without network", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: routeAdmission(),
			executionClass: "live-provider",
		});
		const result = await runD734RouteProfileSixArmLiveIntegration({
			sourceDigest: sha("d736-injected-live"),
			adapter: fixture.adapter,
			signal: AbortSignal.timeout(30_000),
		});
		expect(result.run.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(result.run.graphEvidence.runStatus).toBe("complete");
		expect(result.routeEvidence.facts).toHaveLength(fixture.providerCalls());
		expect(fixture.maxActiveInvocations()).toBe(1);
		expect(fixture.networkCalls()).toBe(0);
	}, 30_000);

	it("makes arbitrary-root claims non-executable and rejects duplicate acquisition", async () => {
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d736-claim-"));
		try {
			await chmod(root, 0o700);
			const inputs = {
				pricingReadDigest: sha("pricing"),
				zeroByokObservationDigest: sha("zero-byok"),
				implementationManifestDigest: sha("implementation"),
			};
			const claim = await acquireD736SingleUseDispatchClaimAtRootForTest(
				await realpath(root),
				inputs,
			);
			await expect(
				acquireD736SingleUseDispatchClaimAtRootForTest(await realpath(root), inputs),
			).rejects.toThrow();
			const authority = await consumeD736DispatchClaimForExecution({
				claim,
				currentKeyAdmission: await currentKey(),
			});
			expect(() => consumeD736ExecutionAuthority(authority)).toThrow(/fixed-root/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
