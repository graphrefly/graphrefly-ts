import { chmod, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { createD737GraphObjectivePhaseRecoveryPolicy } from "../../evals/empirical-memory-rerun-avoidance/d722-graph-native-effect-runtime.js";
import { D733_DEEPSEEK_V4_FLASH_0731_PROFILE } from "../../evals/empirical-memory-rerun-avoidance/d733-coordinates.js";
import {
	createD733GraphNativeRouteAdmission,
	createD733RouteAccessProjection,
	createD733RouteEligibility,
} from "../../evals/empirical-memory-rerun-avoidance/d733-graph-native-route-profile.js";
import { createD734InjectedRouteProfileFixture } from "../../evals/empirical-memory-rerun-avoidance/d734-injected-route-profile-fixture.js";
import { runD734RouteProfileSixArmLiveIntegration } from "../../evals/empirical-memory-rerun-avoidance/d734-route-profile-provider-integration.js";
import {
	persistD737LiveBundle,
	runD737InjectedNoNetworkQualification,
	validateD737LiveBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d737-graph-native-live.js";
import {
	acquireD737SingleUseDispatchClaimAtRootForTest,
	consumeD737DispatchClaimForExecution,
	consumeD737ExecutionAuthority,
} from "../../evals/empirical-memory-rerun-avoidance/d737-single-use-dispatch-claim.js";
import {
	runD738InjectedNoNetworkQualification,
	validateD738LiveBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d738-graph-native-live.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "../../evals/empirical-memory-rerun-avoidance/openrouter-current-key-spend-admission.js";

const encoder = new TextEncoder();
const sha = (label: string) => empiricalStrictJsonDigest({ label });

function routeAdmission() {
	const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
	return createD733GraphNativeRouteAdmission({
		profile,
		access: createD733RouteAccessProjection({
			profile,
			observationRevision: "d737.test-access.v1",
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
						limit_remaining: 19,
						usage: 13,
						limit_reset: null,
						is_management_key: false,
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		},
	}).read({
		credential: {
			bearerToken: "not-a-live-d737-test-credential",
			credentialBindingRef: "d737.test",
			credentialBindingRevision: "v1",
		},
		expectedLimitMicrousd: 32_000_000,
		requiredRemainingMicrousd: 6_000_000,
		signal: new AbortController().signal,
	});
}

describe("D737 Graph objective-phase recovery", () => {
	it("keeps the D736 out-of-order batch fail-closed when the policy is absent", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: routeAdmission(),
			executionClass: "live-provider",
			objectivePhaseViolationBeforeMutation: true,
		});
		const result = await runD734RouteProfileSixArmLiveIntegration({
			sourceDigest: sha("d737-absent-policy"),
			adapter: fixture.adapter,
			signal: AbortSignal.timeout(30_000),
		});
		expect(result.run.graphEvidence.runStatus).toBe("stopped");
		expect(result.run.graphEvidence.ledger.completedArms).toHaveLength(0);
		expect(result.run.graphEvidence.completionContexts).toHaveLength(0);
		expect(result.run.graphEvidence.ledger.findings[0]?.code).toBe("executor-failed");
		expect(fixture.activeWorkspaceCount()).toBe(0);
	}, 30_000);

	it("rejects the invalid batch without tool effects and completes all six arms from Graph context", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: routeAdmission(),
			executionClass: "live-provider",
			objectivePhaseViolationBeforeMutation: true,
		});
		const result = await runD734RouteProfileSixArmLiveIntegration({
			sourceDigest: sha("d737-qualified"),
			adapter: fixture.adapter,
			objectivePhaseRecoveryPolicy: createD737GraphObjectivePhaseRecoveryPolicy(),
			signal: AbortSignal.timeout(30_000),
		});
		expect(result.run.graphEvidence.runStatus).toBe("complete");
		expect(result.run.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(result.run.graphEvidence.completionContexts).toHaveLength(6);
		for (const [index, context] of result.run.graphEvidence.completionContexts.entries()) {
			expect(context.reason).toBe("objective-phase-policy-violation");
			expect(context.nextRequiredPhase).toBe("exact-mutation");
			expect(context.missingObjectivePhases).toEqual([
				"exact-mutation",
				"workspace-diff",
				"focused-validation",
			]);
			const run = result.run.graphEvidence.effectRuns[index];
			const contextRequest = run?.facts.find(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.request.completionContext?.contextDigest === context.contextDigest,
			);
			expect(contextRequest?.request.effectKind).toBe("provider-request");
			const rejected = run?.facts.find(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.result.effectKind === "provider-request" &&
					fact.result.status === "tool-intents" &&
					fact.result.toolIntents[0]?.toolRef === "workspace-diff",
			);
			expect(rejected).toBeDefined();
			expect(
				run?.facts.some(
					(fact) =>
						fact.kind === "graph-effect-result-admitted" &&
						fact.result.effectKind === "tool-action" &&
						rejected?.result.effectKind === "provider-request" &&
						rejected.result.toolIntents.some(
							(intent) => intent.intentDigest === fact.result.intentDigest,
						),
				),
			).toBe(false);
		}
		expect(fixture.maxActiveInvocations()).toBe(1);
		expect(fixture.networkCalls()).toBe(0);
		expect(fixture.activeWorkspaceCount()).toBe(0);
	}, 30_000);

	it("preflights every ordered intent and rejects a later phase violation before all tool effects", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: routeAdmission(),
			executionClass: "live-provider",
			objectivePhaseViolationBeforeMutation: true,
			objectivePhaseViolationAfterInspectionPrefix: true,
		});
		const result = await runD734RouteProfileSixArmLiveIntegration({
			sourceDigest: sha("d739-later-phase-violation"),
			adapter: fixture.adapter,
			objectivePhaseRecoveryPolicy: createD737GraphObjectivePhaseRecoveryPolicy(),
			signal: AbortSignal.timeout(30_000),
		});
		expect(result.run.graphEvidence.runStatus).toBe("complete");
		expect(result.run.graphEvidence.ledger.completedArms).toHaveLength(6);
		for (const run of result.run.graphEvidence.effectRuns) {
			const rejected = run.facts.find(
				(fact) =>
					fact.result.effectKind === "provider-request" &&
					fact.result.status === "tool-intents" &&
					fact.result.toolIntents[0]?.toolRef === "search-repository" &&
					fact.result.toolIntents[1]?.toolRef === "workspace-diff",
			);
			expect(rejected).toBeDefined();
			expect(
				run.facts.some(
					(fact) =>
						fact.result.effectKind === "tool-action" &&
						rejected?.result.effectKind === "provider-request" &&
						rejected.result.toolIntents.some(
							(intent) => intent.intentDigest === fact.result.intentDigest,
						),
				),
			).toBe(false);
		}
		expect(fixture.activeWorkspaceCount()).toBe(0);
	}, 30_000);

	it("turns exact inspection saturation into a Graph-authored mutation continuation", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: routeAdmission(),
			executionClass: "live-provider",
			inspectionSaturationBeforeMutation: true,
		});
		const result = await runD734RouteProfileSixArmLiveIntegration({
			sourceDigest: sha("d740-inspection-saturation"),
			adapter: fixture.adapter,
			objectivePhaseRecoveryPolicy: createD737GraphObjectivePhaseRecoveryPolicy(),
			signal: AbortSignal.timeout(30_000),
		});
		expect(result.run.graphEvidence.runStatus).toBe("complete");
		expect(result.run.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(result.run.graphEvidence.completionContexts).toHaveLength(6);
		for (const [index, run] of result.run.graphEvidence.effectRuns.entries()) {
			const inspectionFacts = run.facts.filter(
				(fact) =>
					fact.result.effectKind === "tool-action" &&
					(fact.result.toolRef === "read-file" || fact.result.toolRef === "search-repository"),
			);
			expect(inspectionFacts).toHaveLength(6);
			const context = result.run.graphEvidence.completionContexts[index];
			expect(context?.reason).toBe("objective-phase-policy-violation");
			expect(context?.nextRequiredPhase).toBe("exact-mutation");
			const contextFact = run.facts.find(
				(fact) => fact.request.completionContext?.contextDigest === context?.contextDigest,
			);
			expect(contextFact?.result.effectKind).toBe("provider-request");
			if (contextFact?.result.effectKind === "provider-request")
				expect(contextFact.result.toolIntents[0]?.toolRef).toBe("replace-exact");
		}
		expect(fixture.activeWorkspaceCount()).toBe(0);
	}, 30_000);

	it("rejects a saturated recovery response whose first tool does not match the Graph phase", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: routeAdmission(),
			executionClass: "live-provider",
			inspectionSaturationBeforeMutation: true,
			wrongRecoveryFirstTool: true,
		});
		const result = await runD734RouteProfileSixArmLiveIntegration({
			sourceDigest: sha("d740-wrong-recovery-tool"),
			adapter: fixture.adapter,
			objectivePhaseRecoveryPolicy: createD737GraphObjectivePhaseRecoveryPolicy(),
			signal: AbortSignal.timeout(30_000),
		});
		expect(result.run.graphEvidence.runStatus).toBe("complete");
		expect(result.run.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(result.run.graphEvidence.ledger.findings).toHaveLength(12);
		for (const run of result.run.graphEvidence.effectRuns) {
			expect(
				run.facts.some(
					(fact) =>
						fact.result.effectKind === "tool-action" && fact.result.toolRef === "replace-exact",
				),
			).toBe(false);
			expect(
				run.facts.filter(
					(fact) =>
						fact.result.effectKind === "tool-action" &&
						(fact.result.toolRef === "read-file" || fact.result.toolRef === "search-repository"),
				),
			).toHaveLength(6);
		}
		expect(fixture.activeWorkspaceCount()).toBe(0);
	}, 30_000);

	it("rejects an overflowing inspection batch before effects and recovers from the retained prefix", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: routeAdmission(),
			executionClass: "live-provider",
			inspectionOverflowBeforeMutation: true,
		});
		const result = await runD734RouteProfileSixArmLiveIntegration({
			sourceDigest: sha("d740-overflow-recovery"),
			adapter: fixture.adapter,
			objectivePhaseRecoveryPolicy: createD737GraphObjectivePhaseRecoveryPolicy(),
			signal: AbortSignal.timeout(30_000),
		});
		expect(result.run.graphEvidence.runStatus).toBe("complete");
		expect(result.run.graphEvidence.completionContexts).toHaveLength(6);
		for (const run of result.run.graphEvidence.effectRuns) {
			expect(
				run.facts.filter(
					(fact) =>
						fact.result.effectKind === "tool-action" &&
						(fact.result.toolRef === "read-file" || fact.result.toolRef === "search-repository"),
				),
			).toHaveLength(4);
			expect(
				run.facts.some(
					(fact) =>
						fact.result.effectKind === "tool-action" && fact.result.toolRef === "replace-exact",
				),
			).toBe(true);
		}
		expect(fixture.activeWorkspaceCount()).toBe(0);
	}, 30_000);

	it("admits a bounded failed tool fact without censoring later arms", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: routeAdmission(),
			executionClass: "live-provider",
			inspectionSaturationBeforeMutation: true,
			armLocalToolRejectionAfterMutation: true,
		});
		const result = await runD734RouteProfileSixArmLiveIntegration({
			sourceDigest: sha("d741-arm-local-tool-rejection"),
			adapter: fixture.adapter,
			objectivePhaseRecoveryPolicy: createD737GraphObjectivePhaseRecoveryPolicy(),
			signal: AbortSignal.timeout(30_000),
		});
		expect(result.run.graphEvidence.runStatus).toBe("complete");
		expect(result.run.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(
			result.run.graphEvidence.ledger.findings.some(
				(finding) => finding.code === "executor-failed",
			),
		).toBe(false);
		expect(
			result.run.graphEvidence.effectRuns.flatMap((run) =>
				run.facts.filter(
					(fact) => fact.result.effectKind === "tool-action" && fact.result.status === "failed",
				),
			),
		).toHaveLength(12);
		expect(fixture.activeWorkspaceCount()).toBe(0);
	}, 30_000);

	it("constructs and canonically replays the full no-network six-arm qualification", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: routeAdmission(),
			executionClass: "live-provider",
			objectivePhaseViolationBeforeMutation: true,
		});
		const d736PartialBundleBytes = new Uint8Array(
			await readFile(
				join(
					import.meta.dirname,
					"../../evals/.private/empirical-memory-rerun-avoidance/.d736-live-private/d736-d735-qualified-route-profile-live-2026-08-11-v1/artifacts/bundle.v1.json",
				),
			),
		);
		const bundle = await runD737InjectedNoNetworkQualification({
			d736PartialBundleBytes,
			implementationManifestDigest: sha("d737-test-implementation"),
			adapter: fixture.adapter,
			providerTransportCalls: fixture.providerCalls,
			signal: AbortSignal.timeout(30_000),
		});
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d737-persist-"));
		try {
			await chmod(root, 0o700);
			const replay = validateD737LiveBundle(bundle);
			expect(replay.disposition).toBe("success");
			expect(replay.graphEvidence.ledger.completedArms).toHaveLength(6);
			expect(replay.graphEvidence.completionContexts).toHaveLength(6);
			expect(replay.terminalHttpGraphEvidence.facts).toHaveLength(0);
			expect(replay.executorFailureFacts).toHaveLength(0);
			expect(replay.cleanupFacts.every((fact) => fact.status === "succeeded")).toBe(true);
			const persistence = await persistD737LiveBundle({ privateRoot: root, bundle });
			expect(persistence.disposition).toBe("success");
			expect(persistence.bundleDigest).toBe(replay.bundleDigest);
			expect(fixture.networkCalls()).toBe(0);
			expect(fixture.activeWorkspaceCount()).toBe(0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);

	it("keeps injected claims non-executable and rejects duplicate durable acquisition", async () => {
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d737-claim-"));
		try {
			await chmod(root, 0o700);
			const inputs = {
				pricingReadDigest: sha("pricing"),
				zeroByokObservationDigest: sha("zero-byok"),
				implementationManifestDigest: sha("implementation"),
			};
			const canonicalRoot = await realpath(root);
			const claim = await acquireD737SingleUseDispatchClaimAtRootForTest(canonicalRoot, inputs);
			await expect(
				acquireD737SingleUseDispatchClaimAtRootForTest(canonicalRoot, inputs),
			).rejects.toThrow();
			const authority = await consumeD737DispatchClaimForExecution({
				claim,
				currentKeyAdmission: await currentKey(),
			});
			expect(() => consumeD737ExecutionAuthority(authority)).toThrow(/fixed-root/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);

	it("keeps the outer transport observation non-authoritative while preserving exact Graph counts", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: routeAdmission(),
			executionClass: "live-provider",
			objectivePhaseViolationBeforeMutation: true,
		});
		const d736PartialBundleBytes = new Uint8Array(
			await readFile(
				join(
					import.meta.dirname,
					"../../evals/.private/empirical-memory-rerun-avoidance/.d740-live-private/d740-inspection-saturation-recovery-live-2026-08-12-v1/artifacts/bundle.v1.json",
				),
			),
		);
		const bundle = await runD738InjectedNoNetworkQualification({
			d736PartialBundleBytes,
			implementationManifestDigest: sha("d738-test-implementation"),
			adapter: fixture.adapter,
			providerTransportCalls: () => fixture.providerCalls() - 1,
			signal: AbortSignal.timeout(30_000),
		});
		const replay = validateD738LiveBundle(bundle);
		expect(replay.disposition).toBe("success");
		expect(replay.qualification.graphProviderEffectCount).toBe(fixture.providerCalls());
		expect(replay.qualification.routeFactCount).toBe(fixture.providerCalls());
		expect(replay.qualification.providerTransportCalls).toBe(fixture.providerCalls() - 1);
		expect(replay.qualification.providerAttemptEvidenceDisposition).toBe(
			"pre-transport-failure-observed",
		);
	}, 30_000);
});
