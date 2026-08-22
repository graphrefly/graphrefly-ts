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
	acquireD59DispatchClaim,
	composeD59Preclaim,
	constructD59LiveBundle,
	consumeD59DispatchClaim,
	persistD59LiveBundle,
	prepareD59PrivateRoot,
} from "../../evals/empirical-memory-rerun-avoidance/d59-semantic-correction-live-gates.js";
import {
	D59_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD59LiveImplementation,
} from "../../evals/empirical-memory-rerun-avoidance/d59-semantic-correction-live-implementation-manifest.js";
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

describe("graphrefly-ts:D59 provider-boundary live gates", () => {
	it("qualifies one durable D59 claim and publishes only the Graph-derived efficacy gate", async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d59-live-gates-")));
		roots.push(root);
		await prepareD59PrivateRoot(root);
		const { credential, pricing, zeroByok } = fixtures();
		const preclaim = composeD59Preclaim({ credential, pricing, zeroByok });
		const claim = await acquireD59DispatchClaim({
			privateRoot: root,
			preclaim,
			implementationCommit: "f7a511983e22f332769bd7cb453b8869c352747c",
			implementationManifestDigest: D59_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest:
				"sha256:35be33ce82a1d0c2c77c1a94fa2de1be57c19eba550d60ab99d785bc93ee53ed",
			qualificationDigest:
				"sha256:2127cf1580dd7f81e33c279ec1aa9c0ede8179d8f901090ff8f60bfe09209597",
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
		const authority = await consumeD59DispatchClaim({ claim, currentKeyAdmission });
		await expect(consumeD59DispatchClaim({ claim, currentKeyAdmission })).rejects.toThrow();
		const qualification = await runD55InjectedNoNetworkQualification();
		const evidence = qualification.canonicalEvidence;
		expect(qualification.exactSixArmsCompleted).toBe(true);
		expect(evidence.frozenGateWouldPass).toBe(false);
		const bundle = constructD59LiveBundle({
			authority,
			pricing,
			zeroByok,
			implementationCommit: "f7a511983e22f332769bd7cb453b8869c352747c",
			implementationManifestDigest: D59_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest:
				"sha256:35be33ce82a1d0c2c77c1a94fa2de1be57c19eba550d60ab99d785bc93ee53ed",
			qualificationDigest:
				"sha256:2127cf1580dd7f81e33c279ec1aa9c0ede8179d8f901090ff8f60bfe09209597",
			providerCalls: qualification.providerCalls,
			measurement: { disposition: "success", evidence },
		});
		expect(bundle.efficacyClaim).toBe("none");
		const receipt = await persistD59LiveBundle({ privateRoot: root, bundle });
		expect(receipt.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
		await expect(persistD59LiveBundle({ privateRoot: root, bundle })).rejects.toThrow();
	}, 300_000);

	it("binds the exact D55 implementation and D59 live closure", async () => {
		expect(await measureD55Implementation()).toBe(D55_IMPLEMENTATION_MANIFEST_DIGEST);
		expect(await measureD59LiveImplementation()).toBe(D59_LIVE_IMPLEMENTATION_MANIFEST_DIGEST);
	});
});
