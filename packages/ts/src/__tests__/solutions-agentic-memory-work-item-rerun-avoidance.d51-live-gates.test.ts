import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import type {
	D44D45CredentialV1,
	D44D45PricingObservationV1,
	D44D45ZeroByokObservationV1,
} from "../../evals/empirical-memory-rerun-avoidance/d44-d45-live-gates.js";
import {
	D46_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD46Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d46-bounded-inspection-implementation-manifest.js";
import { runD46InjectedNoNetworkQualification } from "../../evals/empirical-memory-rerun-avoidance/d46-bounded-inspection-qualification.js";
import {
	acquireD51DispatchClaim,
	composeD51Preclaim,
	constructD51LiveBundle,
	consumeD51DispatchClaim,
	persistD51LiveBundle,
	prepareD51PrivateRoot,
} from "../../evals/empirical-memory-rerun-avoidance/d51-phase-composite-live-gates.js";
import {
	D51_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD51LiveImplementation,
} from "../../evals/empirical-memory-rerun-avoidance/d51-phase-composite-live-implementation-manifest.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "../../evals/empirical-memory-rerun-avoidance/openrouter-current-key-spend-admission.js";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fixtures(): Readonly<{
	credential: D44D45CredentialV1;
	pricing: D44D45PricingObservationV1;
	zeroByok: D44D45ZeroByokObservationV1;
}> {
	const credential = Object.freeze({
		bearerToken: "injected-no-network-token-00000000",
		credentialBindingRef: "openrouter.local-eval-2" as const,
		credentialBindingRevision: "2026-08-21.d45.v1" as const,
	});
	const pricingMaterial = {
		sourceUrl:
			"https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints" as const,
		modelRef: "deepseek/deepseek-v4-flash-0731" as const,
		endpointModelRef: "deepseek/deepseek-v4-flash-20260731" as const,
		providerName: "DeepInfra" as const,
		providerTag: "deepinfra/fp8" as const,
		quantization: "fp8" as const,
		inputMicrousdPerMillionTokens: 80_000 as const,
		outputMicrousdPerMillionTokens: 180_000 as const,
		cacheReadMicrousdPerMillionTokens: 16_000 as const,
		supportedParametersDigest: empiricalStrictJsonDigest(["reasoning", "tool_choice", "tools"]),
		officialResponseDigest: empiricalStrictJsonDigest({ injected: "pricing" }),
		observedAtMs: 1,
	};
	const zeroByokMaterial = {
		workspaceSlug: "graph-re-fly" as const,
		keyName: "Local Eval 2" as const,
		byokCredentialCount: 0 as const,
		providerObservation: "DeepInfra Not configured" as const,
		observedAtMs: 1,
		sourceArtifactDigest: empiricalStrictJsonDigest({ injected: "zero-byok" }),
	};
	return Object.freeze({
		credential,
		pricing: Object.freeze({
			...pricingMaterial,
			observationDigest: empiricalStrictJsonDigest(pricingMaterial),
		}),
		zeroByok: Object.freeze({
			...zeroByokMaterial,
			observationDigest: empiricalStrictJsonDigest(zeroByokMaterial),
		}),
	});
}

describe("graphrefly-ts:D51 phase-composite live gates", () => {
	it("qualifies the six-arm D50 measurement and no-replace D51 publication", async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d51-live-gates-")));
		roots.push(root);
		await prepareD51PrivateRoot(root);
		const { credential, pricing, zeroByok } = fixtures();
		const preclaim = composeD51Preclaim({ credential, pricing, zeroByok });
		const claim = await acquireD51DispatchClaim({
			privateRoot: root,
			preclaim,
			implementationCommit: "d0958365ac309c283bc25d505ea64a299c7c911f",
			implementationManifestDigest: D51_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest:
				"sha256:6d0a53b698ae015b467c4e9da5eb8c49a4f78392646729dae74dc2c96880744b",
			qualificationDigest:
				"sha256:b77622156adfa58f96b40ca250ba3b7d1c6cf7787c3b0acf3ac60f1c6cbdbb61",
		});
		const currentKeyAdmission = await createOpenRouterCurrentKeySpendAdmissionCapability({
			fetch: async () =>
				new Response(
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
				),
		}).read({
			credential,
			expectedLimitMicrousd: 32_000_000,
			requiredRemainingMicrousd: 6_000_000,
			signal: AbortSignal.timeout(1_000),
		});
		const authority = await consumeD51DispatchClaim({ claim, currentKeyAdmission });
		await expect(consumeD51DispatchClaim({ claim, currentKeyAdmission })).rejects.toThrow();
		const qualification = await runD46InjectedNoNetworkQualification();
		const bundle = constructD51LiveBundle({
			authority,
			pricing,
			zeroByok,
			implementationCommit: "d0958365ac309c283bc25d505ea64a299c7c911f",
			implementationManifestDigest: D51_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest:
				"sha256:6d0a53b698ae015b467c4e9da5eb8c49a4f78392646729dae74dc2c96880744b",
			qualificationDigest:
				"sha256:b77622156adfa58f96b40ca250ba3b7d1c6cf7787c3b0acf3ac60f1c6cbdbb61",
			providerCalls: qualification.qualification.providerCalls,
			measurement: { disposition: "success", evidence: qualification.evidence },
		});
		const receipt = await persistD51LiveBundle({ privateRoot: root, bundle });
		expect(receipt.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
		await expect(persistD51LiveBundle({ privateRoot: root, bundle })).rejects.toThrow();
	}, 300_000);

	it("binds the exact D50 implementation and D51 live closure", async () => {
		expect(await measureD46Implementation()).toBe(D46_IMPLEMENTATION_MANIFEST_DIGEST);
		expect(await measureD51LiveImplementation()).toBe(D51_LIVE_IMPLEMENTATION_MANIFEST_DIGEST);
	});
});
