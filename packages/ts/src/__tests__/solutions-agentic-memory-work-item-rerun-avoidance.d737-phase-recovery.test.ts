import { chmod, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	createD737GraphObjectivePhaseRecoveryPolicy,
	createD745GraphPhaseScopedRecoveryPolicy,
	createD748GraphForwardPhaseContinuationPolicy,
} from "../../evals/empirical-memory-rerun-avoidance/d722-graph-native-effect-runtime.js";
import {
	createD720SimulatedCallerExecutor,
	runD722GraphNativeEvalCore,
} from "../../evals/empirical-memory-rerun-avoidance/d722-graph-native-eval.js";
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
import {
	acquireD738SingleUseDispatchClaimAtRootForTest,
	consumeD738DispatchClaimForExecution,
	consumeD738ExecutionAuthority,
} from "../../evals/empirical-memory-rerun-avoidance/d738-single-use-dispatch-claim.js";
import {
	persistD748QualificationBundle,
	runD748InjectedNoNetworkQualification,
	validateD748QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d748-forward-phase-continuation-qualification.js";
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

	it("keeps an out-of-order post-mutation tool intent arm-local and admits every frozen arm", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: routeAdmission(),
			executionClass: "live-provider",
			armLocalOutOfOrderAfterMutation: true,
		});
		const result = await runD734RouteProfileSixArmLiveIntegration({
			sourceDigest: sha("d744-arm-local-policy"),
			adapter: fixture.adapter,
			objectivePhaseRecoveryPolicy: createD737GraphObjectivePhaseRecoveryPolicy(),
			signal: AbortSignal.timeout(30_000),
		});
		expect(result.run.graphEvidence.runStatus).toBe("complete");
		expect(result.run.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(result.run.graphEvidence.effectRuns).toHaveLength(12);
		expect(result.run.graphEvidence.ledger.findings).toHaveLength(12);
		expect(
			result.run.graphEvidence.ledger.findings.every(
				(finding) => finding.code === "arm-policy-violated",
			),
		).toBe(true);
		expect(fixture.providerCalls()).toBe(48);
		expect(fixture.activeWorkspaceCount()).toBe(0);
	}, 30_000);

	it("bounds every recovery run to eight provider attempts and preserves six-arm scheduling", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: routeAdmission(),
			executionClass: "live-provider",
			providerTurnLoopAfterInspection: true,
		});
		const result = await runD734RouteProfileSixArmLiveIntegration({
			sourceDigest: sha("d744-provider-turn-bound"),
			adapter: fixture.adapter,
			objectivePhaseRecoveryPolicy: createD737GraphObjectivePhaseRecoveryPolicy(),
			signal: AbortSignal.timeout(30_000),
		});
		expect(result.run.graphEvidence.runStatus).toBe("complete");
		expect(result.run.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(result.run.graphEvidence.effectRuns).toHaveLength(12);
		expect(result.run.usage.requests).toBe(96);
		expect(fixture.providerCalls()).toBe(96);
		expect(
			result.run.graphEvidence.ledger.findings.every(
				(finding) => finding.code === "arm-provider-turn-bound-exhausted",
			),
		).toBe(true);
		expect(fixture.activeWorkspaceCount()).toBe(0);
	}, 30_000);

	it("recovers each distinct forward objective phase under the same eight-turn bound", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: routeAdmission(),
			executionClass: "live-provider",
			phaseScopedObjectiveRecovery: true,
		});
		const result = await runD734RouteProfileSixArmLiveIntegration({
			sourceDigest: sha("d745-phase-scoped-objective-recovery"),
			adapter: fixture.adapter,
			objectivePhaseRecoveryPolicy: createD745GraphPhaseScopedRecoveryPolicy(),
			signal: AbortSignal.timeout(30_000),
		});
		expect(result.run.graphEvidence.runStatus).toBe("complete");
		expect(result.run.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(result.run.graphEvidence.effectRuns).toHaveLength(6);
		expect(result.run.graphEvidence.completionContexts).toHaveLength(18);
		expect(result.run.usage.requests).toBe(48);
		expect(fixture.providerCalls()).toBe(48);
		for (const run of result.run.graphEvidence.effectRuns) {
			const contexts = result.run.graphEvidence.completionContexts.filter(
				(context) => context.runSequence === run.runSequence,
			);
			expect(contexts.map((context) => context.nextRequiredPhase)).toEqual([
				"exact-mutation",
				"workspace-diff",
				"focused-validation",
			]);
			expect(contexts.map((context) => context.remainingCompletionContexts)).toEqual([3, 2, 1]);
			expect(
				run.facts.filter(
					(fact) =>
						fact.result.effectKind === "tool-action" &&
						fact.result.toolRef === "focused-validation",
				),
			).toHaveLength(1);
			expect(
				run.facts.some(
					(fact) => fact.result.effectKind === "hidden-verifier" && fact.result.status === "passed",
				),
			).toBe(true);
		}
		expect(fixture.maxActiveInvocations()).toBe(1);
		expect(fixture.networkCalls()).toBe(0);
		expect(fixture.activeWorkspaceCount()).toBe(0);
	}, 30_000);

	it("uses Graph-authored forward-phase contexts through verification across all six arms", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: routeAdmission(),
			executionClass: "live-provider",
			forwardPhaseContinuation: true,
		});
		const result = await runD734RouteProfileSixArmLiveIntegration({
			sourceDigest: sha("d748-forward-phase-continuation"),
			adapter: fixture.adapter,
			objectivePhaseRecoveryPolicy: createD748GraphForwardPhaseContinuationPolicy(),
			signal: AbortSignal.timeout(30_000),
		});
		expect(result.run.graphEvidence.runStatus).toBe("complete");
		expect(result.run.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(result.run.graphEvidence.effectRuns).toHaveLength(6);
		expect(result.run.graphEvidence.completionContexts).toHaveLength(24);
		expect(result.run.usage.requests).toBe(30);
		for (const run of result.run.graphEvidence.effectRuns) {
			const contexts = result.run.graphEvidence.completionContexts.filter(
				(context) => context.runSequence === run.runSequence,
			);
			const admitted = run.facts.filter((fact) => fact.kind === "graph-effect-result-admitted");
			const firstContextFactIndex = admitted.findIndex(
				(fact) => fact.request.completionContext?.contextDigest === contexts[0]?.contextDigest,
			);
			const triggerFactIndex = admitted.findIndex(
				(fact) => fact.request.requestDigest === contexts[0]?.rejectedRequestDigest,
			);
			expect(triggerFactIndex).toBeGreaterThanOrEqual(0);
			expect(firstContextFactIndex - triggerFactIndex).toBeGreaterThan(1);
			expect(admitted[triggerFactIndex]?.result).toMatchObject({
				effectKind: "tool-action",
				toolRef: "read-file",
			});
			expect(
				admitted
					.slice(triggerFactIndex + 1, firstContextFactIndex)
					.some(
						(fact) =>
							fact.result.effectKind === "tool-action" &&
							fact.result.toolRef === "search-repository",
					),
			).toBe(true);
			expect(contexts.map((context) => context.reason)).toEqual([
				"objective-phase-advanced",
				"objective-phase-advanced",
				"objective-phase-advanced",
				"objective-phase-advanced",
			]);
			expect(contexts.map((context) => context.nextRequiredPhase)).toEqual([
				"exact-mutation",
				"workspace-diff",
				"focused-validation",
				"hidden-verifier",
			]);
			expect(contexts.map((context) => context.requiredDisposition)).toEqual([
				"tool-intents",
				"tool-intents",
				"tool-intents",
				"structured-final",
			]);
			expect(
				run.facts.some(
					(fact) => fact.result.effectKind === "hidden-verifier" && fact.result.status === "passed",
				),
			).toBe(true);
		}
		expect(fixture.providerCalls()).toBe(30);
		expect(fixture.maxActiveInvocations()).toBe(1);
		expect(fixture.networkCalls()).toBe(0);
		expect(fixture.activeWorkspaceCount()).toBe(0);
	}, 30_000);

	it("preserves conservative reservation provenance in the D722 core ledger", async () => {
		const workspace = sha("d748-conservative-workspace");
		const providerMaxCostMicrousd = 100_000;
		const providerMaxElapsedMs = 1_200_000;
		const result = await runD722GraphNativeEvalCore({
			sourceDigest: sha("d748-conservative-reconciliation"),
			budgetLimits: {
				maxRequests: 96,
				maxRetryWaits: 12,
				maxCostMicrousd: 6_000_000,
				maxElapsedMs: 7_200_000,
			},
			effectCeilings: {
				routeDigest: sha("d748-conservative-route"),
				providerMaxCostMicrousd,
				providerMaxElapsedMs,
				localEffectMaxElapsedMs: 10_000,
			},
			executor: createD720SimulatedCallerExecutor(async ({ effectRequest }) => {
				if (effectRequest.effectKind === "materialization")
					return {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "materialization",
							status: "ready",
							workspaceStateDigest: workspace,
							evidenceDigest: sha("d748-materialized"),
						},
					};
				if (effectRequest.effectKind === "provider-request")
					return {
						actualCostMicrousd: providerMaxCostMicrousd,
						actualElapsedMs: providerMaxElapsedMs,
						usageBasis: "conservative-reservation",
						result: {
							effectKind: "provider-request",
							status: "terminal-failure",
							toolIntents: Object.freeze([]),
							failureDiscriminator: "none",
							retryAfterMs: null,
							workspaceStateDigest: workspace,
							failureProvenance: "executor-failure",
							executorFailureClassification: "transport-failure",
							evidenceDigest: sha("d748-provider-failed"),
						},
					};
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "cleanup",
						status: "succeeded",
						evidenceDigest: sha("d748-cleanup"),
					},
				};
			}),
		});
		const providerProposal = result.ledger.effectProposals.find(
			(proposal) => proposal.effectKind === "provider-request",
		);
		const reconciliation = result.ledger.effectReconciliations.find(
			(candidate) => candidate.proposalDigest === providerProposal?.proposalDigest,
		);
		expect(reconciliation?.basis).toBe("conservative-reservation");
		expect(reconciliation?.actualCostMicrousd).toBe(providerMaxCostMicrousd);
		expect(reconciliation?.actualElapsedMs).toBe(providerMaxElapsedMs);
	}, 30_000);

	it("retries the exact Graph-authored forward context without reissuing it", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: routeAdmission(),
			executionClass: "live-provider",
			forwardPhaseContinuation: true,
			retryForwardPhaseOnce: true,
		});
		const result = await runD734RouteProfileSixArmLiveIntegration({
			sourceDigest: sha("d748-forward-context-retry"),
			adapter: fixture.adapter,
			objectivePhaseRecoveryPolicy: createD748GraphForwardPhaseContinuationPolicy(),
			signal: AbortSignal.timeout(30_000),
		});
		const run = result.run.graphEvidence.effectRuns[0];
		const retryWaits = run?.facts.filter((fact) => fact.result.effectKind === "retry-wait");
		const retriedContextFacts = run?.facts.filter(
			(fact) =>
				fact.result.effectKind === "provider-request" &&
				fact.request.completionContext?.reason === "objective-phase-advanced" &&
				fact.request.completionContext.nextRequiredPhase === "exact-mutation",
		);
		expect(retryWaits).toHaveLength(1);
		expect(retriedContextFacts).toHaveLength(2);
		expect(retriedContextFacts?.map((fact) => fact.request.attemptOrdinal)).toEqual([1, 2]);
		expect(
			new Set(retriedContextFacts?.map((fact) => fact.request.logicalRequestDigest)).size,
		).toBe(1);
		expect(
			new Set(retriedContextFacts?.map((fact) => fact.request.completionContext?.contextDigest))
				.size,
		).toBe(1);
		expect(result.run.graphEvidence.completionContexts).toHaveLength(24);
		expect(result.run.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(fixture.providerCalls()).toBe(31);
		expect(fixture.activeWorkspaceCount()).toBe(0);
	}, 30_000);

	it("rejects a wrong forward-phase response before mutation side effects", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: routeAdmission(),
			executionClass: "live-provider",
			forwardPhaseContinuation: true,
			wrongForwardPhaseTool: true,
		});
		const result = await runD734RouteProfileSixArmLiveIntegration({
			sourceDigest: sha("d748-wrong-forward-phase-tool"),
			adapter: fixture.adapter,
			objectivePhaseRecoveryPolicy: createD748GraphForwardPhaseContinuationPolicy(),
			signal: AbortSignal.timeout(30_000),
		});
		expect(result.run.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(
			result.run.graphEvidence.ledger.findings.every(
				(finding) => finding.code === "arm-policy-violated",
			),
		).toBe(true);
		for (const run of result.run.graphEvidence.effectRuns)
			expect(
				run.facts.some(
					(fact) =>
						fact.kind === "graph-effect-result-admitted" &&
						fact.result.effectKind === "tool-action" &&
						fact.result.toolRef === "replace-exact",
				),
			).toBe(false);
		expect(fixture.activeWorkspaceCount()).toBe(0);
	}, 30_000);

	it("persists and replays the material-free D748 no-network qualification atomically", async () => {
		const bundle = await runD748InjectedNoNetworkQualification({
			sourceDigest: sha("d748-no-network-qualification"),
		});
		const replay = validateD748QualificationBundle(bundle);
		expect(replay.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(replay.retryGraphEvidence.ledger.completedArms).toHaveLength(6);
		expect(replay.qualification).toMatchObject({
			forwardContextCount: 24,
			providerEffectCount: 30,
			retryWaitCount: 1,
			retryIdentityDisposition: "exact",
			conservativeUsageBasis: "conservative-reservation",
		});
		const forged = structuredClone(bundle) as any;
		forged.qualification.forwardContextCount = 23;
		expect(() => validateD748QualificationBundle(forged)).toThrow();
		const contextForgery = structuredClone(bundle) as any;
		contextForgery.graphEvidence.completionContexts[0].nextRequiredPhase = "inspection";
		expect(() => validateD748QualificationBundle(contextForgery)).toThrow();
		let getterHits = 0;
		await expect(
			runD748InjectedNoNetworkQualification(
				Object.freeze({
					get sourceDigest() {
						getterHits += 1;
						return sha("d748-accessor");
					},
				}),
			),
		).rejects.toThrow();
		expect(getterHits).toBe(0);
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d748-persist-"));
		try {
			await chmod(root, 0o700);
			const canonicalRoot = await realpath(root);
			const receipt = await persistD748QualificationBundle({ privateRoot: canonicalRoot, bundle });
			expect(receipt).toMatchObject({
				generationRef: "d748-forward-phase-continuation-no-network-v2",
			});
			await expect(
				persistD748QualificationBundle({ privateRoot: canonicalRoot, bundle }),
			).rejects.toThrow(/already exists/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);

	it("rejects a second recovery request for the same objective phase without executing its batch", async () => {
		const fixture = createD734InjectedRouteProfileFixture({
			profile: D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
			routeAdmission: routeAdmission(),
			executionClass: "live-provider",
			repeatedPhaseScopedRecovery: true,
		});
		const result = await runD734RouteProfileSixArmLiveIntegration({
			sourceDigest: sha("d745-repeated-phase-recovery"),
			adapter: fixture.adapter,
			objectivePhaseRecoveryPolicy: createD745GraphPhaseScopedRecoveryPolicy(),
			signal: AbortSignal.timeout(30_000),
		});
		expect(result.run.graphEvidence.runStatus).toBe("complete");
		expect(result.run.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(result.run.graphEvidence.effectRuns).toHaveLength(12);
		expect(
			result.run.graphEvidence.ledger.findings.filter(
				(finding) => finding.code === "arm-policy-violated",
			),
		).toHaveLength(12);
		for (const run of result.run.graphEvidence.effectRuns) {
			const contexts = result.run.graphEvidence.completionContexts.filter(
				(context) => context.runSequence === run.runSequence,
			);
			expect(contexts.map((context) => context.nextRequiredPhase)).toEqual([
				"exact-mutation",
				"workspace-diff",
			]);
			const rejected = run.facts.findLast(
				(fact) =>
					fact.result.effectKind === "provider-request" &&
					fact.result.status === "tool-intents" &&
					fact.result.toolIntents[0]?.toolRef === "focused-validation",
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
			forwardPhaseContinuation: true,
		});
		const historicalBundleBytes = new Uint8Array(
			await readFile(
				join(
					import.meta.dirname,
					"../../evals/.private/empirical-memory-rerun-avoidance/.d748-pre-live-private/d748-forward-phase-continuation-no-network-v2/bundle.v1.json",
				),
			),
		);
		const bundle = await runD738InjectedNoNetworkQualification({
			historicalBundleBytes,
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

	it("keeps the D749 durable claim exclusive and test-root authority non-executable", async () => {
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d749-claim-"));
		try {
			await chmod(root, 0o700);
			const inputs = {
				pricingReadDigest: sha("d749-pricing"),
				zeroByokObservationDigest: sha("d749-zero-byok"),
				implementationManifestDigest: sha("d749-implementation"),
			};
			const canonicalRoot = await realpath(root);
			const claim = await acquireD738SingleUseDispatchClaimAtRootForTest(canonicalRoot, inputs);
			await expect(
				acquireD738SingleUseDispatchClaimAtRootForTest(canonicalRoot, inputs),
			).rejects.toThrow();
			const authority = await consumeD738DispatchClaimForExecution({
				claim,
				currentKeyAdmission: await currentKey(),
			});
			expect(() => consumeD738ExecutionAuthority(authority)).toThrow(/fixed-root/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);
});
