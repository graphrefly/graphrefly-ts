import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	acquireD44D45DispatchClaim,
	admitD44D45FreshZeroByok,
	composeD44D45Preclaim,
	consumeD44D45DispatchClaim,
	D44_D45_PRICING_SOURCE,
	readD44D45FreshPricing,
} from "../../evals/empirical-memory-rerun-avoidance/d44-d45-live-gates.js";
import {
	D44_D45_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD44D45LiveImplementation,
} from "../../evals/empirical-memory-rerun-avoidance/d44-d45-live-implementation-manifest.js";
import {
	runD44D45InjectedNoNetworkQualification,
	validateD44D45QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d44-d45-live-qualification.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "../../evals/empirical-memory-rerun-avoidance/openrouter-current-key-spend-admission.js";

describe("graphrefly-ts:D44/D45 live composition", () => {
	it("runs all six arms through Graph-owned provider proposal and exact tool effects without network", async () => {
		const bundle = validateD44D45QualificationBundle(
			await runD44D45InjectedNoNetworkQualification(),
		);
		expect(bundle.qualification.exactSixArmsCompleted).toBe(true);
		expect(bundle.qualification.evaluableArms).toBe(6);
		expect(bundle.qualification.providerCalls).toBeGreaterThanOrEqual(12);
		expect(bundle.qualification.providerNetworkCalls).toBe(0);
		expect(bundle.qualification.credentialReads).toBe(0);
		expect(bundle.qualification.dispatchClaims).toBe(0);
		expect(await measureD44D45LiveImplementation()).toBe(
			D44_D45_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
		);
	}, 180_000);

	it("admits fresh fp8 pricing, same-credential zero-BYOK, and one durable claim without network", async () => {
		const nowMs = Date.now();
		const official = new Response(
			JSON.stringify({
				data: {
					id: "deepseek/deepseek-v4-flash-0731",
					endpoints: [
						{
							provider_name: "DeepInfra",
							tag: "deepinfra/fp8",
							quantization: "fp8",
							model: "deepseek/deepseek-v4-flash-20260731",
							supported_parameters: ["tools", "reasoning", "tool_choice"],
							pricing: {
								prompt: "0.00000008",
								completion: "0.00000018",
								input_cache_read: "0.000000016",
							},
						},
					],
				},
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
		Object.defineProperty(official, "url", { value: D44_D45_PRICING_SOURCE });
		const pricing = await readD44D45FreshPricing({
			fetchImpl: async () => official,
			nowMs,
		});
		const credential = Object.freeze({
			bearerToken: "sk-or-v1-prefix-bounded-suffix",
			credentialBindingRef: "openrouter.local-eval-2" as const,
			credentialBindingRevision: "2026-08-21.d45.v1" as const,
		});
		const zeroByok = admitD44D45FreshZeroByok({
			credential,
			nowMs,
			bytes: new TextEncoder().encode(
				JSON.stringify({
					schemaVersion: "graphrefly-ts.d44.d45-zero-byok-observation.v1",
					decisionRef: "graphrefly-ts:D45",
					authorityRef: "graphrefly-ts:D44",
					workspaceName: "GraphReFly",
					workspaceSlug: "graph-re-fly",
					keyName: "Local Eval 2",
					keyVisiblePrefix: "sk-or-v1-prefix",
					keyVisibleSuffix: "suffix",
					byokCredentialCount: 0,
					allowedModels: ["deepseek/deepseek-v4-flash-0731"],
					allowedProviders: ["DeepInfra"],
					observedAt: new Date(nowMs).toISOString(),
					source: "openrouter-browser-settings",
					providerObservation: "DeepInfra Not configured",
				}),
			),
		});
		const preclaim = composeD44D45Preclaim({ pricing, zeroByok, credential });
		const root = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d44-claim-")));
		await chmod(root, 0o700);
		try {
			const claim = await acquireD44D45DispatchClaim({
				privateRoot: root,
				preclaim,
				implementationCommit: "a".repeat(40),
				implementationManifestDigest: `sha256:${"1".repeat(64)}`,
				qualificationArtifactDigest: `sha256:${"2".repeat(64)}`,
				qualificationDigest: `sha256:${"3".repeat(64)}`,
			});
			const currentKeyAdmission = await createOpenRouterCurrentKeySpendAdmissionCapability({
				fetch: async () =>
					new Response(
						JSON.stringify({
							data: {
								limit: 32,
								limit_remaining: 30,
								usage: 2,
								limit_reset: null,
								is_management_key: false,
							},
						}),
						{ status: 200 },
					),
			}).read({
				credential,
				expectedLimitMicrousd: 32_000_000,
				requiredRemainingMicrousd: 6_000_000,
				signal: AbortSignal.timeout(1_000),
			});
			const authority = await consumeD44D45DispatchClaim({ claim, currentKeyAdmission });
			expect(authority.currentKeyAdmission.remainingMicrousd).toBe(30_000_000);
			await expect(consumeD44D45DispatchClaim({ claim, currentKeyAdmission })).rejects.toThrow(
				/absent or consumed/,
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
		expect(await measureD44D45LiveImplementation()).toBe(
			D44_D45_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
		);
	});
});
