import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	safeInteger,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	type D722CanonicalGraphEvidenceV1,
	deriveD722CanonicalGraphEvidence,
} from "./d722-graph-completion-memory-insight.js";
import {
	createD726ArmLocalTerminalProviderPolicy,
	createD748GraphForwardPhaseContinuationPolicy,
	type D720AdmittedEffectFactV1,
	D748_FORWARD_PHASE_CONTINUATION_POLICY_REVISION,
} from "./d722-graph-native-effect-runtime.js";
import {
	createD720SimulatedCallerExecutor,
	runD722GraphNativeEvalCore,
} from "./d722-graph-native-eval.js";
import { D733_DEEPSEEK_V4_FLASH_0731_PROFILE } from "./d733-coordinates.js";
import {
	createD733GraphNativeRouteAdmission,
	createD733RouteAccessProjection,
	createD733RouteEligibility,
} from "./d733-graph-native-route-profile.js";
import { createD734InjectedRouteProfileFixture } from "./d734-injected-route-profile-fixture.js";
import {
	type D734RouteGraphEvidenceV1,
	runD734RouteProfileSixArmLiveIntegration,
	validateD734RouteGraphEvidence,
} from "./d734-route-profile-provider-integration.js";

export const D748_DECISION_REF = "decision.D748" as const;
export const D748_DECISION_REVISION = "2026-08-12.v1" as const;
export const D748_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d748.forward-phase-continuation-qualification.v2" as const;
export const D748_GENERATION_SCHEMA =
	"graphrefly.b112.d748.forward-phase-continuation-generation.v2" as const;
export const D748_BUNDLE_SCHEMA =
	"graphrefly.b112.d748.forward-phase-continuation-bundle.v2" as const;
export const D748_PERSISTENCE_SCHEMA =
	"graphrefly.b112.d748.forward-phase-continuation-persistence.v2" as const;
export const D748_GENERATION_REF = "d748-forward-phase-continuation-no-network-v2" as const;

export interface D748ForwardPhaseQualificationBundleV1 {
	readonly schemaVersion: typeof D748_BUNDLE_SCHEMA;
	readonly executionClass: "simulated-contract";
	readonly graphEvidence: D722CanonicalGraphEvidenceV1;
	readonly retryGraphEvidence: D722CanonicalGraphEvidenceV1;
	readonly routeEvidence: D734RouteGraphEvidenceV1;
	readonly retryRouteEvidence: D734RouteGraphEvidenceV1;
	readonly qualification: Readonly<Record<string, unknown>>;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly bundleDigest: string;
}

const constructedBundles = new WeakSet<object>();

function replayGraph(value: unknown, path: string): D722CanonicalGraphEvidenceV1 {
	const candidate = record(value, path);
	const runs = array(candidate.effectRuns, `${path}.effectRuns`);
	if (runs.length > 12) throw new TypeError("D748 Graph run bound exceeded");
	const replay = deriveD722CanonicalGraphEvidence(
		candidate.ledger,
		runs as D722CanonicalGraphEvidenceV1["effectRuns"],
		createD726ArmLocalTerminalProviderPolicy(),
		createD748GraphForwardPhaseContinuationPolicy(),
	);
	literal(
		empiricalStrictJsonDigest(candidate),
		empiricalStrictJsonDigest(replay),
		`${path}.replay`,
	);
	return replay;
}

function providerEffectCount(graph: D722CanonicalGraphEvidenceV1): number {
	return graph.ledger.effectProposals.filter(
		(proposal) => proposal.effectKind === "provider-request",
	).length;
}

function multiInspectionTriggerBinding(graph: D722CanonicalGraphEvidenceV1): boolean {
	return graph.effectRuns.every((run) => {
		const facts = run.facts.filter((fact) => fact.kind === "graph-effect-result-admitted");
		const contextIndex = facts.findIndex(
			(fact) =>
				fact.request.completionContext?.reason === "objective-phase-advanced" &&
				fact.request.completionContext.nextRequiredPhase === "exact-mutation",
		);
		if (contextIndex < 2) return false;
		const context = facts[contextIndex]?.request.completionContext;
		const triggerIndex = facts.findIndex(
			(fact) => fact.request.requestDigest === context?.rejectedRequestDigest,
		);
		if (triggerIndex < 0 || triggerIndex >= contextIndex - 1) return false;
		const trigger = facts[triggerIndex];
		const intervening = facts.slice(triggerIndex + 1, contextIndex);
		return (
			trigger?.result.effectKind === "tool-action" &&
			trigger.result.toolRef === "read-file" &&
			intervening.some(
				(fact) =>
					fact.result.effectKind === "tool-action" && fact.result.toolRef === "search-repository",
			)
		);
	});
}

function retryIdentity(graph: D722CanonicalGraphEvidenceV1): {
	readonly retryWaitCount: number;
	readonly retriedContextAttemptCount: number;
	readonly exactIdentity: boolean;
} {
	const retryWaitCount = graph.effectRuns
		.flatMap((run) => run.facts)
		.filter(
			(fact) =>
				fact.kind === "graph-effect-result-admitted" && fact.result.effectKind === "retry-wait",
		).length;
	const groups = new Map<string, readonly D720AdmittedEffectFactV1[]>();
	for (const run of graph.effectRuns) {
		for (const fact of run.facts) {
			if (
				fact.kind !== "graph-effect-result-admitted" ||
				fact.result.effectKind !== "provider-request" ||
				fact.request.completionContext?.reason !== "objective-phase-advanced"
			)
				continue;
			const key = `${run.runSequence}:${fact.request.logicalRequestDigest}`;
			groups.set(key, Object.freeze([...(groups.get(key) ?? []), fact]));
		}
	}
	const retried = [...groups.values()].filter((facts) => facts.length > 1);
	const exactIdentity =
		retried.length === 1 &&
		retried[0]?.length === 2 &&
		retried[0][0]?.request.attemptOrdinal === 1 &&
		retried[0][1]?.request.attemptOrdinal === 2 &&
		new Set(retried[0].map((fact) => fact.request.requestDigest)).size === 2 &&
		new Set(retried[0].map((fact) => fact.request.logicalRequestDigest)).size === 1 &&
		new Set(retried[0].map((fact) => fact.request.completionContext?.contextDigest)).size === 1;
	return Object.freeze({
		retryWaitCount,
		retriedContextAttemptCount: retried[0]?.length ?? 0,
		exactIdentity,
	});
}

async function conservativeAccountingProbe(): Promise<Readonly<Record<string, unknown>>> {
	const workspace = empiricalStrictJsonDigest({ d748: "conservative-workspace" });
	const providerMaxCostMicrousd = 100_000;
	const providerMaxElapsedMs = 1_200_000;
	const probe = await runD722GraphNativeEvalCore({
		sourceDigest: empiricalStrictJsonDigest({ d748: "conservative-probe" }),
		budgetLimits: {
			maxRequests: 96,
			maxRetryWaits: 12,
			maxCostMicrousd: 6_000_000,
			maxElapsedMs: 7_200_000,
		},
		effectCeilings: {
			routeDigest: empiricalStrictJsonDigest({ d748: "probe-route" }),
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
						effectKind: "materialization" as const,
						status: "ready" as const,
						workspaceStateDigest: workspace,
						evidenceDigest: empiricalStrictJsonDigest({ d748: "probe-materialized" }),
					},
				};
			if (effectRequest.effectKind === "provider-request")
				return {
					actualCostMicrousd: providerMaxCostMicrousd,
					actualElapsedMs: providerMaxElapsedMs,
					usageBasis: "conservative-reservation" as const,
					result: {
						effectKind: "provider-request" as const,
						status: "terminal-failure" as const,
						toolIntents: Object.freeze([]),
						failureDiscriminator: "none" as const,
						retryAfterMs: null,
						workspaceStateDigest: workspace,
						failureProvenance: "executor-failure" as const,
						executorFailureClassification: "transport-failure" as const,
						evidenceDigest: empiricalStrictJsonDigest({ d748: "probe-provider" }),
					},
				};
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup" as const,
					status: "succeeded" as const,
					evidenceDigest: empiricalStrictJsonDigest({ d748: "probe-cleanup" }),
				},
			};
		}),
	});
	const providerProposal = probe.ledger.effectProposals.find(
		(proposal) => proposal.effectKind === "provider-request",
	);
	const reconciliation = probe.ledger.effectReconciliations.find(
		(candidate) => candidate.proposalDigest === providerProposal?.proposalDigest,
	);
	if (
		reconciliation?.basis !== "conservative-reservation" ||
		reconciliation.actualCostMicrousd !== providerMaxCostMicrousd ||
		reconciliation.actualElapsedMs !== providerMaxElapsedMs
	)
		throw new TypeError("D748 conservative reconciliation qualification failed");
	return strictSnapshot({
		proposalDigest: reconciliation.proposalDigest,
		reconciliationDigest: reconciliation.reconciliationDigest,
		basis: reconciliation.basis,
		actualCostMicrousd: reconciliation.actualCostMicrousd,
		actualElapsedMs: reconciliation.actualElapsedMs,
	});
}

export async function runD748InjectedNoNetworkQualification(inputValue: {
	readonly sourceDigest: string;
}): Promise<D748ForwardPhaseQualificationBundleV1> {
	const input = record(inputValue, "d748.qualificationRun");
	exactKeys(input, ["sourceDigest"], "d748.qualificationRun");
	const sourceDigest = digest(input.sourceDigest, "d748.sourceDigest");
	const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
	const routeAdmission = createD733GraphNativeRouteAdmission({
		profile,
		access: createD733RouteAccessProjection({
			profile,
			observationRevision: "d748.injected-no-network.v1",
			allowedModels: [profile.requestModel],
			allowedProviders: [profile.providerName],
		}),
		eligibility: createD733RouteEligibility({
			profile,
			responseBytes: new TextEncoder().encode(
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
	const mainFixture = createD734InjectedRouteProfileFixture({
		profile,
		routeAdmission,
		executionClass: "live-provider",
		forwardPhaseContinuation: true,
	});
	const retryFixture = createD734InjectedRouteProfileFixture({
		profile,
		routeAdmission,
		executionClass: "live-provider",
		forwardPhaseContinuation: true,
		retryForwardPhaseOnce: true,
	});
	const main = await runD734RouteProfileSixArmLiveIntegration({
		sourceDigest,
		adapter: mainFixture.adapter,
		objectivePhaseRecoveryPolicy: createD748GraphForwardPhaseContinuationPolicy(),
		signal: AbortSignal.timeout(30_000),
	});
	const retry = await runD734RouteProfileSixArmLiveIntegration({
		sourceDigest: empiricalStrictJsonDigest({ sourceDigest, probe: "retry" }),
		adapter: retryFixture.adapter,
		objectivePhaseRecoveryPolicy: createD748GraphForwardPhaseContinuationPolicy(),
		signal: AbortSignal.timeout(30_000),
	});
	const conservativeReconciliation = await conservativeAccountingProbe();
	const graphEvidence = replayGraph(main.run.graphEvidence, "d748.mainGraph");
	const retryGraphEvidence = replayGraph(retry.run.graphEvidence, "d748.retryGraph");
	const routeEvidence = validateD734RouteGraphEvidence(main.routeEvidence);
	const retryRouteEvidence = validateD734RouteGraphEvidence(retry.routeEvidence);
	const retryProof = retryIdentity(retryGraphEvidence);
	const forwardContexts = graphEvidence.completionContexts.filter(
		(context) => context.reason === "objective-phase-advanced",
	);
	if (
		graphEvidence.runStatus !== "complete" ||
		graphEvidence.ledger.completedArms.length !== 6 ||
		graphEvidence.effectRuns.length !== 6 ||
		forwardContexts.length !== 24 ||
		providerEffectCount(graphEvidence) !== 30 ||
		!graphEvidence.effectRuns.every((run) =>
			run.facts.some(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.result.effectKind === "hidden-verifier" &&
					fact.result.status === "passed",
			),
		) ||
		retryGraphEvidence.ledger.completedArms.length !== 6 ||
		retryGraphEvidence.completionContexts.filter(
			(context) => context.reason === "objective-phase-advanced",
		).length !== 24 ||
		retryProof.retryWaitCount !== 1 ||
		!retryProof.exactIdentity ||
		!multiInspectionTriggerBinding(graphEvidence) ||
		!multiInspectionTriggerBinding(retryGraphEvidence) ||
		mainFixture.providerCalls() !== 30 ||
		retryFixture.providerCalls() !== 31 ||
		mainFixture.networkCalls() !== 0 ||
		retryFixture.networkCalls() !== 0 ||
		mainFixture.maxActiveInvocations() !== 1 ||
		retryFixture.maxActiveInvocations() !== 1 ||
		mainFixture.activeWorkspaceCount() !== 0 ||
		retryFixture.activeWorkspaceCount() !== 0
	)
		throw new TypeError("D748 full no-network qualification coverage failed");
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D748_QUALIFICATION_SCHEMA,
		decisionRef: D748_DECISION_REF,
		decisionRevision: D748_DECISION_REVISION,
		policyRevision: D748_FORWARD_PHASE_CONTINUATION_POLICY_REVISION,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		retryGraphEvidenceDigest: retryGraphEvidence.evidenceDigest,
		routeEvidenceDigest: routeEvidence.evidenceDigest,
		retryRouteEvidenceDigest: retryRouteEvidence.evidenceDigest,
		completedArms: graphEvidence.ledger.completedArms.length,
		forwardContextCount: forwardContexts.length,
		providerEffectCount: providerEffectCount(graphEvidence),
		retryWaitCount: retryProof.retryWaitCount,
		retriedContextAttemptCount: retryProof.retriedContextAttemptCount,
		retryIdentityDisposition: "exact" as const,
		multiInspectionTriggerBindingDisposition: "exact-phase-advancing-fact" as const,
		conservativeReconciliation,
		conservativeUsageBasis: "conservative-reservation" as const,
		maxActiveArms: graphEvidence.ledger.maxActiveArms,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = strictSnapshot({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: D748_GENERATION_SCHEMA,
		generationRef: D748_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		retryGraphEvidenceDigest: retryGraphEvidence.evidenceDigest,
		materialFree: true as const,
		providerNetworkCalls: 0,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D748_BUNDLE_SCHEMA,
		executionClass: "simulated-contract" as const,
		graphEvidence,
		retryGraphEvidence,
		routeEvidence,
		retryRouteEvidence,
		qualification,
		generation,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const bundle = Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
	constructedBundles.add(bundle);
	return bundle as unknown as D748ForwardPhaseQualificationBundleV1;
}

export function validateD748QualificationBundle(
	value: unknown,
): D748ForwardPhaseQualificationBundleV1 {
	const candidate = record(value, "d748.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"causalAttribution",
			"efficacyClaim",
			"executionClass",
			"generation",
			"graphEvidence",
			"qualification",
			"retryGraphEvidence",
			"retryRouteEvidence",
			"routeEvidence",
			"schemaVersion",
		],
		"d748.bundle",
	);
	literal(candidate.schemaVersion, D748_BUNDLE_SCHEMA, "d748.bundle.schema");
	literal(candidate.executionClass, "simulated-contract", "d748.bundle.executionClass");
	literal(candidate.causalAttribution, "undetermined", "d748.bundle.causalAttribution");
	literal(candidate.efficacyClaim, "none", "d748.bundle.efficacyClaim");
	const graphEvidence = replayGraph(candidate.graphEvidence, "d748.bundle.graphEvidence");
	const retryGraphEvidence = replayGraph(
		candidate.retryGraphEvidence,
		"d748.bundle.retryGraphEvidence",
	);
	const routeEvidence = validateD734RouteGraphEvidence(candidate.routeEvidence);
	const retryRouteEvidence = validateD734RouteGraphEvidence(candidate.retryRouteEvidence);
	const qualification = record(candidate.qualification, "d748.bundle.qualification");
	const generation = record(candidate.generation, "d748.bundle.generation");
	exactKeys(
		qualification,
		[
			"causalAttribution",
			"completedArms",
			"conservativeReconciliation",
			"conservativeUsageBasis",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"forwardContextCount",
			"graphEvidenceDigest",
			"maxActiveArms",
			"multiInspectionTriggerBindingDisposition",
			"policyRevision",
			"providerEffectCount",
			"qualificationDigest",
			"retriedContextAttemptCount",
			"retryGraphEvidenceDigest",
			"retryIdentityDisposition",
			"retryRouteEvidenceDigest",
			"retryWaitCount",
			"routeEvidenceDigest",
			"schemaVersion",
		],
		"d748.bundle.qualification",
	);
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"graphEvidenceDigest",
			"materialFree",
			"providerNetworkCalls",
			"qualificationDigest",
			"retryGraphEvidenceDigest",
			"schemaVersion",
		],
		"d748.bundle.generation",
	);
	literal(qualification.schemaVersion, D748_QUALIFICATION_SCHEMA, "d748.qualification.schema");
	literal(qualification.decisionRef, D748_DECISION_REF, "d748.qualification.decisionRef");
	literal(
		qualification.decisionRevision,
		D748_DECISION_REVISION,
		"d748.qualification.decisionRevision",
	);
	literal(
		qualification.policyRevision,
		D748_FORWARD_PHASE_CONTINUATION_POLICY_REVISION,
		"d748.qualification.policyRevision",
	);
	literal(
		qualification.graphEvidenceDigest,
		graphEvidence.evidenceDigest,
		"d748.qualification.graphEvidenceDigest",
	);
	literal(
		qualification.retryGraphEvidenceDigest,
		retryGraphEvidence.evidenceDigest,
		"d748.qualification.retryGraphEvidenceDigest",
	);
	literal(
		qualification.routeEvidenceDigest,
		routeEvidence.evidenceDigest,
		"d748.qualification.routeEvidenceDigest",
	);
	literal(
		qualification.retryRouteEvidenceDigest,
		retryRouteEvidence.evidenceDigest,
		"d748.qualification.retryRouteEvidenceDigest",
	);
	literal(
		qualification.completedArms,
		graphEvidence.ledger.completedArms.length,
		"d748.qualification.completedArms",
	);
	literal(qualification.completedArms, 6, "d748.qualification.completedArmsExact");
	const forwardContextCount = graphEvidence.completionContexts.filter(
		(context) => context.reason === "objective-phase-advanced",
	).length;
	literal(
		qualification.forwardContextCount,
		forwardContextCount,
		"d748.qualification.forwardContextCoverage",
	);
	safeInteger(qualification.forwardContextCount, "d748.qualification.forwardContextCount", {
		min: 24,
		max: 24,
	});
	literal(
		qualification.providerEffectCount,
		providerEffectCount(graphEvidence),
		"d748.qualification.providerEffectCoverage",
	);
	safeInteger(qualification.providerEffectCount, "d748.qualification.providerEffectCount", {
		min: 30,
		max: 30,
	});
	const retryProof = retryIdentity(retryGraphEvidence);
	literal(qualification.retryWaitCount, retryProof.retryWaitCount, "d748.qualification.retryWaits");
	literal(
		qualification.retriedContextAttemptCount,
		retryProof.retriedContextAttemptCount,
		"d748.qualification.retryAttempts",
	);
	if (!retryProof.exactIdentity) throw new TypeError("D748 retry identity replay failed");
	literal(qualification.retryIdentityDisposition, "exact", "d748.qualification.retryIdentity");
	if (
		!multiInspectionTriggerBinding(graphEvidence) ||
		!multiInspectionTriggerBinding(retryGraphEvidence)
	)
		throw new TypeError("D748 multi-inspection trigger binding replay failed");
	literal(
		qualification.multiInspectionTriggerBindingDisposition,
		"exact-phase-advancing-fact",
		"d748.qualification.multiInspectionTriggerBinding",
	);
	literal(
		qualification.conservativeUsageBasis,
		"conservative-reservation",
		"d748.qualification.conservativeUsageBasis",
	);
	const conservative = record(
		qualification.conservativeReconciliation,
		"d748.qualification.conservativeReconciliation",
	);
	exactKeys(
		conservative,
		["actualCostMicrousd", "actualElapsedMs", "basis", "proposalDigest", "reconciliationDigest"],
		"d748.qualification.conservativeReconciliation",
	);
	digest(conservative.proposalDigest, "d748.conservative.proposalDigest");
	digest(conservative.reconciliationDigest, "d748.conservative.reconciliationDigest");
	literal(conservative.basis, "conservative-reservation", "d748.conservative.basis");
	safeInteger(conservative.actualCostMicrousd, "d748.conservative.actualCostMicrousd", {
		min: 100_000,
		max: 100_000,
	});
	safeInteger(conservative.actualElapsedMs, "d748.conservative.actualElapsedMs", {
		min: 1_200_000,
		max: 1_200_000,
	});
	literal(qualification.maxActiveArms, 1, "d748.qualification.maxActiveArms");
	literal(qualification.causalAttribution, "undetermined", "d748.qualification.causal");
	literal(qualification.efficacyClaim, "none", "d748.qualification.efficacy");
	const qualificationMaterial = strictSnapshot({
		schemaVersion: qualification.schemaVersion,
		decisionRef: qualification.decisionRef,
		decisionRevision: qualification.decisionRevision,
		policyRevision: qualification.policyRevision,
		graphEvidenceDigest: qualification.graphEvidenceDigest,
		retryGraphEvidenceDigest: qualification.retryGraphEvidenceDigest,
		routeEvidenceDigest: qualification.routeEvidenceDigest,
		retryRouteEvidenceDigest: qualification.retryRouteEvidenceDigest,
		completedArms: qualification.completedArms,
		forwardContextCount: qualification.forwardContextCount,
		providerEffectCount: qualification.providerEffectCount,
		retryWaitCount: qualification.retryWaitCount,
		retriedContextAttemptCount: qualification.retriedContextAttemptCount,
		retryIdentityDisposition: qualification.retryIdentityDisposition,
		multiInspectionTriggerBindingDisposition:
			qualification.multiInspectionTriggerBindingDisposition,
		conservativeReconciliation: strictSnapshot(conservative),
		conservativeUsageBasis: qualification.conservativeUsageBasis,
		maxActiveArms: qualification.maxActiveArms,
		causalAttribution: qualification.causalAttribution,
		efficacyClaim: qualification.efficacyClaim,
	});
	const qualificationDigest = digest(
		qualification.qualificationDigest,
		"d748.qualification.qualificationDigest",
	);
	literal(
		qualificationDigest,
		empiricalStrictJsonDigest(qualificationMaterial),
		"d748.qualification.digest",
	);
	literal(generation.schemaVersion, D748_GENERATION_SCHEMA, "d748.generation.schema");
	literal(generation.generationRef, D748_GENERATION_REF, "d748.generation.ref");
	literal(generation.providerNetworkCalls, 0, "d748.generation.network");
	literal(generation.materialFree, true, "d748.generation.materialFree");
	literal(
		generation.qualificationDigest,
		qualificationDigest,
		"d748.generation.qualificationDigest",
	);
	literal(
		generation.graphEvidenceDigest,
		graphEvidence.evidenceDigest,
		"d748.generation.graphEvidenceDigest",
	);
	literal(
		generation.retryGraphEvidenceDigest,
		retryGraphEvidence.evidenceDigest,
		"d748.generation.retryGraphEvidenceDigest",
	);
	literal(generation.causalAttribution, "undetermined", "d748.generation.causal");
	literal(generation.efficacyClaim, "none", "d748.generation.efficacy");
	const generationMaterial = strictSnapshot({
		schemaVersion: generation.schemaVersion,
		generationRef: generation.generationRef,
		qualificationDigest: generation.qualificationDigest,
		graphEvidenceDigest: generation.graphEvidenceDigest,
		retryGraphEvidenceDigest: generation.retryGraphEvidenceDigest,
		materialFree: generation.materialFree,
		providerNetworkCalls: generation.providerNetworkCalls,
		causalAttribution: generation.causalAttribution,
		efficacyClaim: generation.efficacyClaim,
	});
	literal(
		generation.generationDigest,
		empiricalStrictJsonDigest(generationMaterial),
		"d748.generation.digest",
	);
	const material = strictSnapshot({
		schemaVersion: candidate.schemaVersion,
		executionClass: candidate.executionClass,
		graphEvidence,
		retryGraphEvidence,
		routeEvidence,
		retryRouteEvidence,
		qualification: strictSnapshot(qualification),
		generation: strictSnapshot(generation),
		causalAttribution: candidate.causalAttribution,
		efficacyClaim: candidate.efficacyClaim,
	});
	literal(candidate.bundleDigest, empiricalStrictJsonDigest(material), "d748.bundle.digest");
	return Object.freeze({
		...material,
		bundleDigest: candidate.bundleDigest as string,
	}) as unknown as D748ForwardPhaseQualificationBundleV1;
}

export async function persistD748QualificationBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D748ForwardPhaseQualificationBundleV1;
}): Promise<Readonly<Record<string, unknown>>> {
	const input = record(inputValue, "d748.persist");
	exactKeys(input, ["bundle", "privateRoot"], "d748.persist");
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.has(input.bundle)
	)
		throw new TypeError("D748 persistence requires the same-process constructed bundle");
	const bundle = validateD748QualificationBundle(input.bundle);
	const privateRoot = resolve(input.privateRoot as string);
	const rootStat = await lstat(privateRoot);
	if (
		!rootStat.isDirectory() ||
		rootStat.isSymbolicLink() ||
		(rootStat.mode & 0o777) !== 0o700 ||
		(await realpath(privateRoot)) !== privateRoot
	)
		throw new TypeError("D748 private root is invalid");
	const stagingRoot = join(privateRoot, `.d748-staging-${randomUUID()}`);
	const finalRoot = join(privateRoot, D748_GENERATION_REF);
	const bundleBytes = strictJsonCodec.encode(bundle);
	let renamed = false;
	try {
		await mkdir(stagingRoot, { mode: 0o700 });
		await chmod(stagingRoot, 0o700);
		const filePath = join(stagingRoot, "bundle.v1.json");
		const file = await open(
			filePath,
			constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
			0o600,
		);
		try {
			await file.writeFile(bundleBytes);
			await file.sync();
		} finally {
			await file.close();
		}
		const directory = await open(stagingRoot, constants.O_RDONLY | constants.O_DIRECTORY);
		try {
			await directory.sync();
		} finally {
			await directory.close();
		}
		try {
			await lstat(finalRoot);
			throw new TypeError("D748 generation already exists");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		await rename(stagingRoot, finalRoot);
		renamed = true;
		const parent = await open(privateRoot, constants.O_RDONLY | constants.O_DIRECTORY);
		try {
			await parent.sync();
		} finally {
			await parent.close();
		}
		const persisted = new Uint8Array(await readFile(join(finalRoot, "bundle.v1.json")));
		if (!sameBytes(persisted, bundleBytes)) throw new TypeError("D748 persisted readback drifted");
		const material = strictSnapshot({
			schemaVersion: D748_PERSISTENCE_SCHEMA,
			generationRef: D748_GENERATION_REF,
			bundleDigest: bundle.bundleDigest,
			bundleSha256: empiricalSha256(bundleBytes),
		});
		return strictSnapshot({ ...material, persistenceDigest: empiricalStrictJsonDigest(material) });
	} catch (error) {
		await rm(renamed ? finalRoot : stagingRoot, { recursive: true, force: true });
		throw error;
	}
}
