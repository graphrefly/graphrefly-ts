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
	acquireD47DispatchClaim,
	composeD47Preclaim,
	constructD47LiveBundle,
	consumeD47DispatchClaim,
	persistD47LiveBundle,
	prepareD47PrivateRoot,
} from "../../evals/empirical-memory-rerun-avoidance/d47-bounded-inspection-live-gates.js";
import {
	D47_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD47LiveImplementation,
} from "../../evals/empirical-memory-rerun-avoidance/d47-bounded-inspection-live-implementation-manifest.js";
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

describe("graphrefly-ts:D47 bounded-inspection live gates", () => {
	it("qualifies one six-arm no-network measurement and one no-replace live publication", async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d47-live-gates-")));
		roots.push(root);
		await prepareD47PrivateRoot(root);
		const { credential, pricing, zeroByok } = fixtures();
		const preclaim = composeD47Preclaim({ credential, pricing, zeroByok });
		const claim = await acquireD47DispatchClaim({
			privateRoot: root,
			preclaim,
			implementationCommit: "a2097c3db6ecdfbc591c5c21b4359cced6c424af",
			implementationManifestDigest: D47_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest:
				"sha256:72a633a16ae447af17b90f82f194858c2ff8403f9ae66db64d71a76a41921cba",
			qualificationDigest:
				"sha256:51bd86be1bd3b112bdcb122b336e1162451f996da2692c41ab5f9dbbf4aecdc5",
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
		const authority = await consumeD47DispatchClaim({ claim, currentKeyAdmission });
		const qualification = await runD46InjectedNoNetworkQualification();
		const bundle = constructD47LiveBundle({
			authority,
			pricing,
			zeroByok,
			implementationCommit: "a2097c3db6ecdfbc591c5c21b4359cced6c424af",
			implementationManifestDigest: D47_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest:
				"sha256:72a633a16ae447af17b90f82f194858c2ff8403f9ae66db64d71a76a41921cba",
			qualificationDigest:
				"sha256:51bd86be1bd3b112bdcb122b336e1162451f996da2692c41ab5f9dbbf4aecdc5",
			providerCalls: qualification.qualification.providerCalls,
			measurement: { disposition: "success", evidence: qualification.evidence },
		});
		const receipt = await persistD47LiveBundle({ privateRoot: root, bundle });
		expect(receipt.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
		await expect(persistD47LiveBundle({ privateRoot: root, bundle })).rejects.toThrow();
	}, 120_000);

	it("binds both the qualified D46 closure and the exact D47 live implementation", async () => {
		expect(await measureD46Implementation()).toBe(D46_IMPLEMENTATION_MANIFEST_DIGEST);
		expect(await measureD47LiveImplementation()).toBe(D47_LIVE_IMPLEMENTATION_MANIFEST_DIGEST);
	});
});
