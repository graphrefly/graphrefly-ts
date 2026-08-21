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
	acquireD49DispatchClaim,
	composeD49Preclaim,
	constructD49LiveBundle,
	consumeD49DispatchClaim,
	persistD49LiveBundle,
	prepareD49PrivateRoot,
} from "../../evals/empirical-memory-rerun-avoidance/d49-deadline-live-gates.js";
import {
	D49_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD49LiveImplementation,
} from "../../evals/empirical-memory-rerun-avoidance/d49-deadline-live-implementation-manifest.js";
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

describe("graphrefly-ts:D49 deadline-profile live gates", () => {
	it("qualifies the six-arm D48 measurement and no-replace D49 publication", async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d49-live-gates-")));
		roots.push(root);
		await prepareD49PrivateRoot(root);
		const { credential, pricing, zeroByok } = fixtures();
		const preclaim = composeD49Preclaim({ credential, pricing, zeroByok });
		const claim = await acquireD49DispatchClaim({
			privateRoot: root,
			preclaim,
			implementationCommit: "d0958365ac309c283bc25d485ea64a299c7c911f",
			implementationManifestDigest: D49_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest:
				"sha256:e641976cb66ac74af95c90fd7469354d18008ac88546d8587c5f942923427448",
			qualificationDigest:
				"sha256:47f794dbe9c85c379f80645e9dfed9a9200a0181a80d3b73b9d42e462e37718a",
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
		const authority = await consumeD49DispatchClaim({ claim, currentKeyAdmission });
		await expect(consumeD49DispatchClaim({ claim, currentKeyAdmission })).rejects.toThrow();
		const qualification = await runD46InjectedNoNetworkQualification();
		const bundle = constructD49LiveBundle({
			authority,
			pricing,
			zeroByok,
			implementationCommit: "d0958365ac309c283bc25d485ea64a299c7c911f",
			implementationManifestDigest: D49_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest:
				"sha256:e641976cb66ac74af95c90fd7469354d18008ac88546d8587c5f942923427448",
			qualificationDigest:
				"sha256:47f794dbe9c85c379f80645e9dfed9a9200a0181a80d3b73b9d42e462e37718a",
			providerCalls: qualification.qualification.providerCalls,
			measurement: { disposition: "success", evidence: qualification.evidence },
		});
		const receipt = await persistD49LiveBundle({ privateRoot: root, bundle });
		expect(receipt.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
		await expect(persistD49LiveBundle({ privateRoot: root, bundle })).rejects.toThrow();
	}, 300_000);

	it("binds the exact D48 implementation and D49 live closure", async () => {
		expect(await measureD46Implementation()).toBe(D46_IMPLEMENTATION_MANIFEST_DIGEST);
		expect(await measureD49LiveImplementation()).toBe(D49_LIVE_IMPLEMENTATION_MANIFEST_DIGEST);
	});
});
