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
	acquireD57DispatchClaim,
	composeD57Preclaim,
	constructD57LiveBundle,
	consumeD57DispatchClaim,
	persistD57LiveBundle,
	prepareD57PrivateRoot,
} from "../../evals/empirical-memory-rerun-avoidance/d57-provider-boundary-live-gates.js";
import {
	D57_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD57LiveImplementation,
} from "../../evals/empirical-memory-rerun-avoidance/d57-provider-boundary-live-implementation-manifest.js";
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

describe("graphrefly-ts:D57 provider-boundary live gates", () => {
	it("qualifies one durable D57 claim and publishes only the Graph-derived efficacy gate", async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d57-live-gates-")));
		roots.push(root);
		await prepareD57PrivateRoot(root);
		const { credential, pricing, zeroByok } = fixtures();
		const preclaim = composeD57Preclaim({ credential, pricing, zeroByok });
		const claim = await acquireD57DispatchClaim({
			privateRoot: root,
			preclaim,
			implementationCommit: "b830a2c9e27e2361bdc0c1ca0ae5aa38e68abb47",
			implementationManifestDigest: D57_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest:
				"sha256:619f3066b47e332f8bdf8b2b51119bfe55a5078e705eaef07895a546122a63b6",
			qualificationDigest:
				"sha256:0a20f1901877360045f7b1647a134011e4524a227f8cfebd9432ffd83b423023",
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
		const authority = await consumeD57DispatchClaim({ claim, currentKeyAdmission });
		await expect(consumeD57DispatchClaim({ claim, currentKeyAdmission })).rejects.toThrow();
		const qualification = await runD55InjectedNoNetworkQualification();
		const evidence = qualification.canonicalEvidence;
		expect(qualification.exactSixArmsCompleted).toBe(true);
		expect(evidence.frozenGateWouldPass).toBe(false);
		const bundle = constructD57LiveBundle({
			authority,
			pricing,
			zeroByok,
			implementationCommit: "b830a2c9e27e2361bdc0c1ca0ae5aa38e68abb47",
			implementationManifestDigest: D57_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest:
				"sha256:619f3066b47e332f8bdf8b2b51119bfe55a5078e705eaef07895a546122a63b6",
			qualificationDigest:
				"sha256:0a20f1901877360045f7b1647a134011e4524a227f8cfebd9432ffd83b423023",
			providerCalls: qualification.providerCalls,
			measurement: { disposition: "success", evidence },
		});
		expect(bundle.efficacyClaim).toBe("none");
		const receipt = await persistD57LiveBundle({ privateRoot: root, bundle });
		expect(receipt.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
		await expect(persistD57LiveBundle({ privateRoot: root, bundle })).rejects.toThrow();
	}, 300_000);

	it("binds the exact D55 implementation and D57 live closure", async () => {
		expect(await measureD55Implementation()).toBe(D55_IMPLEMENTATION_MANIFEST_DIGEST);
		expect(await measureD57LiveImplementation()).toBe(D57_LIVE_IMPLEMENTATION_MANIFEST_DIGEST);
	});
});
