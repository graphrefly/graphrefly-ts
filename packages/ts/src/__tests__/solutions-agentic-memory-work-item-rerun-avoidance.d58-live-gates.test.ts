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
	D55_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD55Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d55-provider-boundary-implementation-manifest.js";
import { runD55InjectedNoNetworkQualification } from "../../evals/empirical-memory-rerun-avoidance/d55-provider-boundary-qualification.js";
import {
	acquireD58DispatchClaim,
	composeD58Preclaim,
	constructD58LiveBundle,
	consumeD58DispatchClaim,
	persistD58LiveBundle,
	prepareD58PrivateRoot,
} from "../../evals/empirical-memory-rerun-avoidance/d58-provider-boundary-live-gates.js";
import {
	D58_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD58LiveImplementation,
} from "../../evals/empirical-memory-rerun-avoidance/d58-provider-boundary-live-implementation-manifest.js";
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

describe("graphrefly-ts:D58 provider-boundary live gates", () => {
	it("qualifies one durable D58 claim and publishes only the Graph-derived efficacy gate", async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d58-live-gates-")));
		roots.push(root);
		await prepareD58PrivateRoot(root);
		const { credential, pricing, zeroByok } = fixtures();
		const preclaim = composeD58Preclaim({ credential, pricing, zeroByok });
		const claim = await acquireD58DispatchClaim({
			privateRoot: root,
			preclaim,
			implementationCommit: "cbe2ada147a7a1764388bc273b91858be90b4eae",
			implementationManifestDigest: D58_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest:
				"sha256:4ff61a3776c43ad067185f7a33f581d9eedb3138359b0b5a367c2a23587b08d8",
			qualificationDigest:
				"sha256:c2e48c4055bc7837f75c50cb28eed828b81b7efab7f2828dcaa86bc80a365cc8",
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
		const authority = await consumeD58DispatchClaim({ claim, currentKeyAdmission });
		await expect(consumeD58DispatchClaim({ claim, currentKeyAdmission })).rejects.toThrow();
		const qualification = await runD55InjectedNoNetworkQualification();
		const evidence = qualification.canonicalEvidence;
		expect(qualification.exactSixArmsCompleted).toBe(true);
		expect(evidence.frozenGateWouldPass).toBe(false);
		const bundle = constructD58LiveBundle({
			authority,
			pricing,
			zeroByok,
			implementationCommit: "cbe2ada147a7a1764388bc273b91858be90b4eae",
			implementationManifestDigest: D58_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest:
				"sha256:4ff61a3776c43ad067185f7a33f581d9eedb3138359b0b5a367c2a23587b08d8",
			qualificationDigest:
				"sha256:c2e48c4055bc7837f75c50cb28eed828b81b7efab7f2828dcaa86bc80a365cc8",
			providerCalls: qualification.providerCalls,
			measurement: { disposition: "success", evidence },
		});
		expect(bundle.efficacyClaim).toBe("none");
		const receipt = await persistD58LiveBundle({ privateRoot: root, bundle });
		expect(receipt.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
		await expect(persistD58LiveBundle({ privateRoot: root, bundle })).rejects.toThrow();
	}, 300_000);

	it("binds the exact D55 implementation and D58 live closure", async () => {
		expect(await measureD55Implementation()).toBe(D55_IMPLEMENTATION_MANIFEST_DIGEST);
		expect(await measureD58LiveImplementation()).toBe(D58_LIVE_IMPLEMENTATION_MANIFEST_DIGEST);
	});
});
