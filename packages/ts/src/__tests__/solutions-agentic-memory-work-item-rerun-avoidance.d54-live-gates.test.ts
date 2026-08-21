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
	D52_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD52Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d52-task-outcome-implementation-manifest.js";
import { runD52FullInjectedNoNetworkQualification } from "../../evals/empirical-memory-rerun-avoidance/d52-task-outcome-qualification.js";
import {
	acquireD54DispatchClaim,
	composeD54Preclaim,
	constructD54LiveBundle,
	consumeD54DispatchClaim,
	persistD54LiveBundle,
	prepareD54PrivateRoot,
} from "../../evals/empirical-memory-rerun-avoidance/d54-task-outcome-live-gates.js";
import {
	D54_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD54LiveImplementation,
} from "../../evals/empirical-memory-rerun-avoidance/d54-task-outcome-live-implementation-manifest.js";
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

describe("graphrefly-ts:D54 task-outcome live gates", () => {
	it("qualifies one durable D54 claim and publishes only the Graph-derived efficacy gate", async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d54-live-gates-")));
		roots.push(root);
		await prepareD54PrivateRoot(root);
		const { credential, pricing, zeroByok } = fixtures();
		const preclaim = composeD54Preclaim({ credential, pricing, zeroByok });
		const claim = await acquireD54DispatchClaim({
			privateRoot: root,
			preclaim,
			implementationCommit: "55f2b1fba1b216712f5d1c277221307d0650c219",
			implementationManifestDigest: D54_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest:
				"sha256:42807837b60f5ed4f6385d5df3f9d979d03b539cd3b5555ca238ef30e76b2d9d",
			qualificationDigest:
				"sha256:a41f43ea26e539f7f45910959e20e676e2fe2f3adc3410b82c6358664b996b1f",
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
		const authority = await consumeD54DispatchClaim({ claim, currentKeyAdmission });
		await expect(consumeD54DispatchClaim({ claim, currentKeyAdmission })).rejects.toThrow();
		const qualification = await runD52FullInjectedNoNetworkQualification();
		const evidence = qualification.fullSixArm.evidence;
		expect(qualification.taskOutcome.qualification.frozenGateWouldPass).toBe(true);
		expect(evidence.frozenGateWouldPass).toBe(false);
		const bundle = constructD54LiveBundle({
			authority,
			pricing,
			zeroByok,
			implementationCommit: "55f2b1fba1b216712f5d1c277221307d0650c219",
			implementationManifestDigest: D54_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest:
				"sha256:42807837b60f5ed4f6385d5df3f9d979d03b539cd3b5555ca238ef30e76b2d9d",
			qualificationDigest:
				"sha256:a41f43ea26e539f7f45910959e20e676e2fe2f3adc3410b82c6358664b996b1f",
			providerCalls: qualification.fullSixArm.qualification.providerCalls,
			measurement: { disposition: "success", evidence },
		});
		expect(bundle.efficacyClaim).toBe("none");
		const receipt = await persistD54LiveBundle({ privateRoot: root, bundle });
		expect(receipt.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
		await expect(persistD54LiveBundle({ privateRoot: root, bundle })).rejects.toThrow();
	}, 300_000);

	it("binds the exact D52 implementation and D54 live closure", async () => {
		expect(await measureD52Implementation()).toBe(D52_IMPLEMENTATION_MANIFEST_DIGEST);
		expect(await measureD54LiveImplementation()).toBe(D54_LIVE_IMPLEMENTATION_MANIFEST_DIGEST);
	});
});
