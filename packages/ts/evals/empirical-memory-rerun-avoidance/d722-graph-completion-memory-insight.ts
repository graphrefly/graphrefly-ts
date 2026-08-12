import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	oneOf,
	record,
	safeInteger,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	D719_CLEAN_GRAPH_ARM_ORDER,
	type D719CleanArm,
	type D719CleanBudgetLimitsV1,
	type D719CleanGraphEvidenceV1,
	validateD719CleanGraphEvidence,
} from "./d719-clean-graph-ledger.js";
import { D721_PROVIDER_CAPABLE_ADAPTER_REVISION } from "./d721-provider-capable-effect-adapter.js";
import {
	D722_COMPLETION_CONTEXT_SCHEMA,
	type D722GraphCompletionContextV1,
	type D722GraphEffectEvidenceV1,
	type D726ArmLocalTerminalProviderPolicyV1,
	D737_OBJECTIVE_PHASE_CONTEXT_SCHEMA,
	type D737GraphObjectivePhaseRecoveryPolicyV1,
	D745_MAX_COMPLETION_CONTEXTS_PER_RUN,
	D745_PHASE_SCOPED_CONTEXT_SCHEMA,
	D748_FORWARD_PHASE_CONTEXT_SCHEMA,
	D748_MAX_COMPLETION_CONTEXTS_PER_RUN,
	deriveD722GraphArmResultFromEvidence,
	validateD722GraphEffectEvidence,
} from "./d722-graph-native-effect-runtime.js";
import type { D720EffectCeilingsV2 } from "./d722-graph-native-eval.js";
import {
	D722_PROVIDER_CAPABLE_ADAPTER_REVISION,
	runD722InjectedProviderCapableAdapter,
} from "./d722-provider-capable-effect-adapter.js";

export const D722_DECISION_REF = "decision.D722" as const;
export const D722_DECISION_REVISION = "2026-08-11.v1" as const;
export const D722_D720_BASELINE_COMMIT = "c2aee022" as const;
export const D722_D721_BASELINE_COMMIT = "1585e315" as const;
export const D722_MEMORY_INSIGHT_SCHEMA = "graphrefly.b112.d722.memory-insight.v1" as const;
export const D722_GRAPH_EVIDENCE_SCHEMA =
	"graphrefly.b112.d722.canonical-graph-evidence.v1" as const;
export const D722_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d722.completion-memory-insight-qualification.v1" as const;
export const D722_GENERATION_SCHEMA =
	"graphrefly.b112.d722.completion-memory-insight-generation.v1" as const;
export const D722_BUNDLE_SCHEMA =
	"graphrefly.b112.d722.completion-memory-insight-bundle.v1" as const;
export const D722_PERSISTENCE_SCHEMA =
	"graphrefly.b112.d722.completion-memory-insight-persistence.v1" as const;
export const D722_GENERATION_REF = "d722-graph-completion-memory-insight-v1" as const;
export const D722_EXPECTED_RUNTIME_SOURCE_DIGEST =
	"sha256:56e59694b4a98cd8403eb1b314169cab0e0b97dcf40b231db982ae252912be90" as const;
export const D722_EXPECTED_EVAL_SOURCE_DIGEST =
	"sha256:f50fea949840d72ff1e53fad634543e991375eb031cbe9fbb8ac57f527c5f209" as const;
export const D722_EXPECTED_ADAPTER_SOURCE_DIGEST =
	"sha256:c0c5faead095c8a0cc290dee9734a460cf9138768bf68183ef5ce940ffb6f9ba" as const;
export const D722_EXPECTED_MODEL_FIXTURE_SOURCE_DIGEST =
	"sha256:dc1bcbfa3eb6005b5811b711a48478c322f182fbb4c40a1475df5d58894fae70" as const;

const MAX_ARMS = 6;
const MAX_RUNS = 12;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

export interface D722MemoryInsightProposalV1 {
	readonly schemaVersion: typeof D722_MEMORY_INSIGHT_SCHEMA;
	readonly kind: "memory-insight-proposal";
	readonly arm: D719CleanArm;
	readonly runSequence: number;
	readonly insightCode: "graph-completion-context-recovered-objective-progress";
	readonly sourceEvidenceDigest: string;
	readonly completionContextDigest: string;
	readonly evidenceRefs: readonly string[];
	readonly unknowns: readonly ["causal-attribution-undetermined", "efficacy-undetermined"];
	readonly recommendedHarnessAdjustment: "retain-graph-authored-completion-context";
	readonly proposalDigest: string;
}

export interface D722MemoryInsightV1 {
	readonly schemaVersion: typeof D722_MEMORY_INSIGHT_SCHEMA;
	readonly kind: "memory-insight-admitted";
	readonly arm: D719CleanArm;
	readonly runSequence: number;
	readonly insightCode: "graph-completion-context-recovered-objective-progress";
	readonly sourceEvidenceDigest: string;
	readonly completionContextDigest: string;
	readonly evidenceRefs: readonly string[];
	readonly unknowns: readonly ["causal-attribution-undetermined", "efficacy-undetermined"];
	readonly recommendedHarnessAdjustment: "retain-graph-authored-completion-context";
	readonly proposalDigest: string;
	readonly admissionDigest: string;
	readonly insightDigest: string;
}

export interface D722CanonicalGraphEvidenceV1 {
	readonly schemaVersion: typeof D722_GRAPH_EVIDENCE_SCHEMA;
	readonly ledger: D719CleanGraphEvidenceV1;
	readonly effectRuns: readonly D722GraphEffectEvidenceV1[];
	readonly completionContexts: readonly D722GraphCompletionContextV1[];
	readonly memoryInsights: readonly D722MemoryInsightV1[];
	readonly insightTopology: {
		readonly nodes: readonly {
			readonly id: string;
			readonly factory: string;
			readonly deps: readonly string[];
		}[];
		readonly edges: readonly { readonly from: string; readonly to: string }[];
	};
	readonly insightTopologyDigest: string;
	readonly runStatus: "complete" | "stopped";
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D722PreLiveQualificationV1 {
	readonly schemaVersion: typeof D722_QUALIFICATION_SCHEMA;
	readonly decisionRef: typeof D722_DECISION_REF;
	readonly decisionRevision: typeof D722_DECISION_REVISION;
	readonly d720BaselineCommit: typeof D722_D720_BASELINE_COMMIT;
	readonly d721BaselineCommit: typeof D722_D721_BASELINE_COMMIT;
	readonly adapterRevision: typeof D721_PROVIDER_CAPABLE_ADAPTER_REVISION;
	readonly completionAdapterRevision: typeof D722_PROVIDER_CAPABLE_ADAPTER_REVISION;
	readonly completionAdapterSourceDigest: string;
	readonly modelFixtureSourceDigest: string;
	readonly graphRuntimeSourceDigest: string;
	readonly graphEvalSourceDigest: string;
	readonly projectionSourceDigest: string;
	readonly executionClass: "provider-capable-injected-no-network";
	readonly graphEvidenceDigest: string;
	readonly completedArmCount: 6;
	readonly completionContextCount: 6;
	readonly memoryInsightCount: 6;
	readonly injectedProviderEffectCount: number;
	readonly graphAdmittedEffectCount: number;
	readonly maxActiveInvocations: 1;
	readonly allEffectsGraphAdmitted: true;
	readonly allUsageGraphReconciled: true;
	readonly networkCallCount: 0;
	readonly providerNetworkCallCount: 0;
	readonly memoryInsightsAutoApplied: false;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly qualificationDigest: string;
}

export interface D722GenerationV1 {
	readonly schemaVersion: typeof D722_GENERATION_SCHEMA;
	readonly generationRef: typeof D722_GENERATION_REF;
	readonly qualificationDigest: string;
	readonly graphEvidenceDigest: string;
	readonly d720BaselineCommit: typeof D722_D720_BASELINE_COMMIT;
	readonly d721BaselineCommit: typeof D722_D721_BASELINE_COMMIT;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly generationDigest: string;
}

export interface D722PreLiveBundleV1 {
	readonly schemaVersion: typeof D722_BUNDLE_SCHEMA;
	readonly graphEvidence: D722CanonicalGraphEvidenceV1;
	readonly qualification: D722PreLiveQualificationV1;
	readonly generation: D722GenerationV1;
	readonly bundleDigest: string;
}

export interface D722PersistenceReceiptV1 {
	readonly schemaVersion: typeof D722_PERSISTENCE_SCHEMA;
	readonly generationRef: typeof D722_GENERATION_REF;
	readonly graphArtifactDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly generationArtifactDigest: string;
	readonly bundleArtifactDigest: string;
	readonly bundleDigest: string;
	readonly persistenceDigest: string;
}

export interface D722PersistenceFaultV1 {
	readonly revision: "graphrefly.b112.d722.persistence-fault.v1";
}

const constructedBundles = new WeakSet<object>();
const constructedFaults = new WeakMap<
	object,
	{ stage: "after-staging-sync" | "after-rename"; consumed: boolean }
>();

function completionContext(value: unknown, path: string): D722GraphCompletionContextV1 {
	const candidate = record(value, path);
	exactKeys(
		candidate,
		[
			"budgetProjectionDigest",
			"contextDigest",
			"evidenceFreshnessRefs",
			"issuedRequestDigest",
			"missingObjectivePhases",
			"nextRequiredPhase",
			"reason",
			"rejectedRequestDigest",
			"remainingCompletionContexts",
			"remainingAdmittedBounds",
			"remainingEffectFacts",
			"requiredDisposition",
			"runSequence",
			"schemaVersion",
			"workspaceStateDigest",
		],
		path,
	);
	const contextCoordinatesValid =
		(candidate.schemaVersion === D722_COMPLETION_CONTEXT_SCHEMA &&
			candidate.reason === "premature-structured-final") ||
		(candidate.schemaVersion === D737_OBJECTIVE_PHASE_CONTEXT_SCHEMA &&
			candidate.reason === "objective-phase-policy-violation") ||
		(candidate.schemaVersion === D745_PHASE_SCOPED_CONTEXT_SCHEMA &&
			(candidate.reason === "premature-structured-final" ||
				candidate.reason === "objective-phase-policy-violation")) ||
		(candidate.schemaVersion === D748_FORWARD_PHASE_CONTEXT_SCHEMA &&
			(candidate.reason === "premature-structured-final" ||
				candidate.reason === "objective-phase-policy-violation" ||
				candidate.reason === "objective-phase-advanced"));
	if (
		!contextCoordinatesValid ||
		(candidate.requiredDisposition !== "tool-intents" &&
			candidate.requiredDisposition !== "structured-final") ||
		(candidate.requiredDisposition === "structured-final" &&
			(candidate.schemaVersion !== D748_FORWARD_PHASE_CONTEXT_SCHEMA ||
				candidate.nextRequiredPhase !== "hidden-verifier"))
	)
		throw new TypeError("D722 completion context coordinates drifted");
	const remainingCompletionContexts = safeInteger(
		candidate.remainingCompletionContexts,
		`${path}.remainingCompletionContexts`,
		{
			max:
				candidate.schemaVersion === D748_FORWARD_PHASE_CONTEXT_SCHEMA
					? D748_MAX_COMPLETION_CONTEXTS_PER_RUN - 1
					: D745_MAX_COMPLETION_CONTEXTS_PER_RUN - 1,
		},
	);
	if (
		candidate.schemaVersion !== D745_PHASE_SCOPED_CONTEXT_SCHEMA &&
		candidate.schemaVersion !== D748_FORWARD_PHASE_CONTEXT_SCHEMA &&
		remainingCompletionContexts !== 0
	)
		throw new TypeError("D722 legacy completion context count drifted");
	const runSequence = safeInteger(candidate.runSequence, `${path}.runSequence`, {
		min: 0,
		max: 11,
	});
	for (const key of [
		"issuedRequestDigest",
		"rejectedRequestDigest",
		"workspaceStateDigest",
	] as const)
		digest(candidate[key], `${path}.${key}`);
	oneOf(
		candidate.nextRequiredPhase,
		["inspection", "exact-mutation", "workspace-diff", "focused-validation", "hidden-verifier"],
		`${path}.nextRequiredPhase`,
	);
	if (
		!Array.isArray(candidate.missingObjectivePhases) ||
		(candidate.missingObjectivePhases.length < 1 &&
			candidate.nextRequiredPhase !== "hidden-verifier") ||
		candidate.missingObjectivePhases.length > 4
	)
		throw new TypeError("D722 completion context missing-phase bound drifted");
	const missing = array(candidate.missingObjectivePhases, `${path}.missingObjectivePhases`);
	for (const [index, phase] of missing.entries())
		oneOf(
			phase,
			["inspection", "exact-mutation", "workspace-diff", "focused-validation"],
			`${path}.missingObjectivePhases[${index}]`,
		);
	if (
		!Array.isArray(candidate.evidenceFreshnessRefs) ||
		candidate.evidenceFreshnessRefs.length !== 2
	)
		throw new TypeError("D722 completion context freshness coverage drifted");
	const refs = array(candidate.evidenceFreshnessRefs, `${path}.evidenceFreshnessRefs`);
	for (const [index, ref] of refs.entries()) digest(ref, `${path}.evidenceFreshnessRefs[${index}]`);
	safeInteger(candidate.remainingEffectFacts, `${path}.remainingEffectFacts`, { max: 512 });
	const remaining = record(candidate.remainingAdmittedBounds, `${path}.remainingAdmittedBounds`);
	exactKeys(
		remaining,
		["costMicrousd", "elapsedMs", "requests", "retryWaits"],
		`${path}.remainingAdmittedBounds`,
	);
	for (const key of ["costMicrousd", "elapsedMs", "requests", "retryWaits"] as const)
		safeInteger(remaining[key], `${path}.remainingAdmittedBounds.${key}`, {
			max: 1_000_000_000,
		});
	digest(candidate.budgetProjectionDigest, `${path}.budgetProjectionDigest`);
	const material = strictSnapshot({
		schemaVersion: candidate.schemaVersion,
		reason: candidate.reason,
		runSequence,
		issuedRequestDigest: candidate.issuedRequestDigest as string,
		rejectedRequestDigest: candidate.rejectedRequestDigest as string,
		workspaceStateDigest: candidate.workspaceStateDigest as string,
		nextRequiredPhase: candidate.nextRequiredPhase,
		missingObjectivePhases: Object.freeze(missing),
		evidenceFreshnessRefs: Object.freeze(refs),
		requiredDisposition: candidate.requiredDisposition as "tool-intents" | "structured-final",
		remainingEffectFacts: candidate.remainingEffectFacts as number,
		remainingCompletionContexts,
		remainingAdmittedBounds: strictSnapshot(remaining),
		budgetProjectionDigest: candidate.budgetProjectionDigest as string,
	});
	if (
		digest(candidate.contextDigest, `${path}.contextDigest`) !== empiricalStrictJsonDigest(material)
	)
		throw new TypeError("D722 completion context digest mismatch");
	return Object.freeze({
		...material,
		contextDigest: candidate.contextDigest as string,
	}) as unknown as D722GraphCompletionContextV1;
}

function deriveContexts(
	ledger: D719CleanGraphEvidenceV1,
	effectRuns: readonly D722GraphEffectEvidenceV1[],
	armLocalTerminalPolicy?: D726ArmLocalTerminalProviderPolicyV1,
	objectivePhaseRecoveryPolicy?: D737GraphObjectivePhaseRecoveryPolicyV1,
): readonly D722GraphCompletionContextV1[] {
	const contexts: D722GraphCompletionContextV1[] = [];
	for (const [runIndex, run] of effectRuns.entries()) {
		const issued = ledger.issuedRequests[runIndex];
		const armFact = ledger.facts[runIndex];
		if (issued === undefined || armFact === undefined)
			throw new TypeError("D722 Graph run/arm coverage drifted");
		const validatedRun = validateD722GraphEffectEvidence(
			run,
			issued,
			runIndex,
			armLocalTerminalPolicy,
			objectivePhaseRecoveryPolicy,
		);
		const derivedArm = deriveD722GraphArmResultFromEvidence(
			validatedRun,
			issued,
			runIndex,
			armLocalTerminalPolicy,
			objectivePhaseRecoveryPolicy,
		);
		if (
			empiricalStrictJsonDigest(derivedArm.materialization) !==
				empiricalStrictJsonDigest(armFact.materialization) ||
			empiricalStrictJsonDigest(derivedArm.execution) !==
				empiricalStrictJsonDigest(armFact.execution) ||
			empiricalStrictJsonDigest(derivedArm.cleanup) !== empiricalStrictJsonDigest(armFact.cleanup)
		)
			throw new TypeError("D722 runtime projection contradicts the canonical Graph arm fact");
		const admittedFacts = validatedRun.facts.filter(
			(fact) => fact.kind === "graph-effect-result-admitted",
		);
		const contextOccurrences = admittedFacts.flatMap((fact) =>
			fact.request.completionContext === undefined
				? []
				: [completionContext(fact.request.completionContext, `d722.contexts[${contexts.length}]`)],
		);
		const runContexts = [
			...new Map(contextOccurrences.map((context) => [context.contextDigest, context])).values(),
		];
		const phaseScoped = runContexts.some(
			(context) =>
				context.schemaVersion === D745_PHASE_SCOPED_CONTEXT_SCHEMA ||
				context.schemaVersion === D748_FORWARD_PHASE_CONTEXT_SCHEMA,
		);
		const forwardPhase = runContexts.some(
			(context) => context.schemaVersion === D748_FORWARD_PHASE_CONTEXT_SCHEMA,
		);
		if (
			runContexts.length >
			(forwardPhase
				? D748_MAX_COMPLETION_CONTEXTS_PER_RUN
				: phaseScoped
					? D745_MAX_COMPLETION_CONTEXTS_PER_RUN
					: 1)
		)
			throw new TypeError("D722 completion context per-run bound exceeded");
		if (
			phaseScoped &&
			new Set(
				runContexts.map((context) =>
					forwardPhase
						? `${context.reason}:${context.nextRequiredPhase}`
						: context.nextRequiredPhase,
				),
			).size !== runContexts.length
		)
			throw new TypeError("D745 completion context phase was reused");
		for (const context of runContexts) {
			if (
				contextOccurrences
					.filter((candidate) => candidate.contextDigest === context.contextDigest)
					.some(
						(candidate) =>
							empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(context),
					)
			)
				throw new TypeError("D722 completion context retry bytes drifted");
			const contextFactIndex = admittedFacts.findIndex(
				(fact) => fact.request.completionContext?.contextDigest === context.contextDigest,
			);
			const rejected = admittedFacts[contextFactIndex - 1];
			const contextFact = admittedFacts[contextFactIndex];
			const contextAdmission =
				contextFact === undefined
					? undefined
					: ledger.effectAdmissions.find(
							(admission) => admission.decisionDigest === contextFact.admissionDigest,
						);
			const expectedRemaining =
				contextAdmission === undefined
					? null
					: Object.freeze({
							requests: Math.max(
								0,
								ledger.budgetLimits.maxRequests - contextAdmission.budgetStateIfReserved.requests,
							),
							retryWaits: Math.max(
								0,
								ledger.budgetLimits.maxRetryWaits -
									contextAdmission.budgetStateIfReserved.retryWaits,
							),
							costMicrousd: Math.max(
								0,
								ledger.budgetLimits.maxCostMicrousd -
									contextAdmission.budgetStateIfReserved.costMicrousd,
							),
							elapsedMs: Math.max(
								0,
								ledger.budgetLimits.maxElapsedMs - contextAdmission.budgetStateIfReserved.elapsedMs,
							),
						});
			const contextProposal =
				contextAdmission === undefined
					? undefined
					: ledger.effectProposals.find(
							(proposal) => proposal.proposalDigest === contextAdmission.proposalDigest,
						);
			const expectedBudgetProjectionDigest =
				contextAdmission === undefined ||
				contextProposal === undefined ||
				expectedRemaining === null
					? null
					: empiricalStrictJsonDigest({
							budgetStateBeforeContinuation: contextAdmission.budgetStateBefore,
							providerReservation: {
								maxCostMicrousd: contextProposal.maxCostMicrousd,
								maxElapsedMs: contextProposal.maxElapsedMs,
							},
							remainingAdmittedBounds: expectedRemaining,
						});
			const saturationTrigger =
				context.reason === "objective-phase-policy-violation" &&
				rejected?.result.effectKind === "tool-action" &&
				rejected.result.status === "succeeded" &&
				(rejected.result.toolRef === "read-file" ||
					rejected.result.toolRef === "search-repository") &&
				admittedFacts
					.slice(0, contextFactIndex)
					.filter(
						(fact) =>
							fact.result.effectKind === "tool-action" &&
							(fact.result.toolRef === "read-file" || fact.result.toolRef === "search-repository"),
					).length === 6 &&
				!admittedFacts
					.slice(0, contextFactIndex)
					.some(
						(fact) =>
							fact.result.effectKind === "tool-action" && fact.result.toolRef === "replace-exact",
					);
			const rejectedDispositionMatches =
				context.reason === "premature-structured-final"
					? rejected?.result.effectKind === "provider-request" &&
						rejected.result.status === "structured-final"
					: context.reason === "objective-phase-policy-violation"
						? (rejected?.result.effectKind === "provider-request" &&
								rejected.result.status === "tool-intents") ||
							saturationTrigger
						: rejected?.result.effectKind === "tool-action" &&
							rejected.result.status === "succeeded" &&
							((rejected.request.phaseBefore === "none" &&
								(rejected.result.toolRef === "read-file" ||
									rejected.result.toolRef === "search-repository") &&
								context.nextRequiredPhase === "exact-mutation") ||
								(rejected.request.phaseBefore === "inspection" &&
									rejected.result.toolRef === "replace-exact" &&
									context.nextRequiredPhase === "workspace-diff") ||
								(rejected.request.phaseBefore === "exact-mutation" &&
									rejected.result.toolRef === "workspace-diff" &&
									rejected.result.nonEmptyDiff &&
									context.nextRequiredPhase === "focused-validation") ||
								(rejected.request.phaseBefore === "workspace-diff" &&
									rejected.result.toolRef === "focused-validation" &&
									context.nextRequiredPhase === "hidden-verifier"));
			if (
				rejected === undefined ||
				contextFact === undefined ||
				!rejectedDispositionMatches ||
				context.rejectedRequestDigest !== rejected.request.requestDigest ||
				context.workspaceStateDigest !== contextFact.request.workspaceStateDigest ||
				context.issuedRequestDigest !== validatedRun.issuedRequestDigest ||
				contextAdmission?.admitted !== true ||
				expectedRemaining === null ||
				expectedBudgetProjectionDigest === null ||
				context.budgetProjectionDigest !== expectedBudgetProjectionDigest ||
				empiricalStrictJsonDigest(context.remainingAdmittedBounds) !==
					empiricalStrictJsonDigest(expectedRemaining) ||
				empiricalStrictJsonDigest(context.evidenceFreshnessRefs) !==
					empiricalStrictJsonDigest([rejected.resultDigest, rejected.factDigest])
			)
				throw new TypeError("D722 completion context lacks exact rejected-final provenance");
			contexts.push(context);
		}
	}
	return Object.freeze(contexts);
}

function proposedInsights(
	ledger: D719CleanGraphEvidenceV1,
	contexts: readonly D722GraphCompletionContextV1[],
): readonly D722MemoryInsightProposalV1[] {
	return Object.freeze(
		contexts.flatMap((context) => {
			const fact = ledger.facts[context.runSequence];
			if (fact === undefined || !fact.execution.hiddenVerifierPassed) return [];
			const material = strictSnapshot({
				schemaVersion: D722_MEMORY_INSIGHT_SCHEMA,
				kind: "memory-insight-proposal" as const,
				arm: fact.arm,
				runSequence: context.runSequence,
				insightCode: "graph-completion-context-recovered-objective-progress" as const,
				sourceEvidenceDigest: fact.factDigest,
				completionContextDigest: context.contextDigest,
				evidenceRefs: Object.freeze([fact.factDigest, context.contextDigest]),
				unknowns: Object.freeze([
					"causal-attribution-undetermined" as const,
					"efficacy-undetermined" as const,
				]) as readonly ["causal-attribution-undetermined", "efficacy-undetermined"],
				recommendedHarnessAdjustment: "retain-graph-authored-completion-context" as const,
			});
			return [Object.freeze({ ...material, proposalDigest: empiricalStrictJsonDigest(material) })];
		}),
	);
}

function admitInsights(
	ledger: D719CleanGraphEvidenceV1,
	contexts: readonly D722GraphCompletionContextV1[],
): {
	readonly insights: readonly D722MemoryInsightV1[];
	readonly topology: D722CanonicalGraphEvidenceV1["insightTopology"];
} {
	const owner = graph({ name: "d722/memory-insight-admission" });
	const proposalNode = owner.node<D722MemoryInsightProposalV1>([], null, {
		name: "d722/memory-insight-proposals",
	});
	const insights: D722MemoryInsightV1[] = [];
	const admissionNode = owner.node<D722MemoryInsightV1>(
		[proposalNode],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const proposal = raw as D722MemoryInsightProposalV1;
				const fact = ledger.facts[proposal.runSequence];
				const context = contexts.find(
					(candidate) => candidate.contextDigest === proposal.completionContextDigest,
				);
				if (
					fact === undefined ||
					context === undefined ||
					fact.arm !== proposal.arm ||
					fact.factDigest !== proposal.sourceEvidenceDigest ||
					!fact.execution.hiddenVerifierPassed
				)
					continue;
				const admissionDigest = empiricalStrictJsonDigest({
					proposalDigest: proposal.proposalDigest,
					factDigest: fact.factDigest,
					contextDigest: context.contextDigest,
				});
				const material = strictSnapshot({
					...proposal,
					kind: "memory-insight-admitted" as const,
					admissionDigest,
				});
				ctx.down([
					[
						"DATA",
						Object.freeze({ ...material, insightDigest: empiricalStrictJsonDigest(material) }),
					],
				]);
			}
		},
		{ name: "d722/memory-insight-admissions", factory: "d722MemoryInsightAdmission" },
	);
	admissionNode.subscribe((message) => {
		if (message[0] === "DATA") insights.push(message[1] as D722MemoryInsightV1);
	});
	for (const proposal of proposedInsights(ledger, contexts))
		proposalNode.down([["DATA", proposal]]);
	const raw = owner.topology();
	const topology = strictSnapshot({
		nodes: raw.nodes.map((node) => ({
			id: node.id,
			factory: node.factory,
			deps: Object.freeze([...node.deps]),
		})),
		edges: raw.edges,
	});
	return Object.freeze({ insights: Object.freeze(insights), topology });
}

function validateInsight(value: unknown, path: string): D722MemoryInsightV1 {
	const candidate = record(value, path);
	exactKeys(
		candidate,
		[
			"admissionDigest",
			"arm",
			"completionContextDigest",
			"evidenceRefs",
			"insightCode",
			"insightDigest",
			"kind",
			"proposalDigest",
			"recommendedHarnessAdjustment",
			"runSequence",
			"schemaVersion",
			"sourceEvidenceDigest",
			"unknowns",
		],
		path,
	);
	if (
		candidate.schemaVersion !== D722_MEMORY_INSIGHT_SCHEMA ||
		candidate.kind !== "memory-insight-admitted" ||
		candidate.insightCode !== "graph-completion-context-recovered-objective-progress" ||
		candidate.recommendedHarnessAdjustment !== "retain-graph-authored-completion-context"
	)
		throw new TypeError("D722 memory insight coordinates drifted");
	oneOf(candidate.arm, D719_CLEAN_GRAPH_ARM_ORDER, `${path}.arm`);
	safeInteger(candidate.runSequence, `${path}.runSequence`, { min: 0, max: 11 });
	for (const key of [
		"sourceEvidenceDigest",
		"completionContextDigest",
		"proposalDigest",
		"admissionDigest",
	] as const)
		digest(candidate[key], `${path}.${key}`);
	if (!Array.isArray(candidate.evidenceRefs) || candidate.evidenceRefs.length !== 2)
		throw new TypeError("D722 memory insight evidence coverage drifted");
	const refs = array(candidate.evidenceRefs, `${path}.evidenceRefs`);
	for (const [index, ref] of refs.entries()) digest(ref, `${path}.evidenceRefs[${index}]`);
	if (!Array.isArray(candidate.unknowns) || candidate.unknowns.length !== 2)
		throw new TypeError("D722 memory insight unknown boundary drifted");
	const unknowns = array(candidate.unknowns, `${path}.unknowns`);
	if (
		empiricalStrictJsonDigest(unknowns) !==
		empiricalStrictJsonDigest(["causal-attribution-undetermined", "efficacy-undetermined"])
	)
		throw new TypeError("D722 memory insight unknown boundary drifted");
	digest(candidate.insightDigest, `${path}.insightDigest`);
	return strictSnapshot(candidate) as unknown as D722MemoryInsightV1;
}

export function deriveD722CanonicalGraphEvidence(
	ledgerValue: unknown,
	effectRunsValue: readonly D722GraphEffectEvidenceV1[],
	armLocalTerminalPolicy?: D726ArmLocalTerminalProviderPolicyV1,
	objectivePhaseRecoveryPolicy?: D737GraphObjectivePhaseRecoveryPolicyV1,
): D722CanonicalGraphEvidenceV1 {
	const ledger = validateD719CleanGraphEvidence(ledgerValue);
	if (effectRunsValue.length !== ledger.issuedRequests.length || effectRunsValue.length > MAX_RUNS)
		throw new TypeError("D722 effect-run coverage drifted");
	const effectRuns = Object.freeze(
		effectRunsValue.map((run, index) => {
			const request = ledger.issuedRequests[index];
			if (request === undefined) throw new TypeError("D722 issued request is missing");
			return validateD722GraphEffectEvidence(
				run,
				request,
				index,
				armLocalTerminalPolicy,
				objectivePhaseRecoveryPolicy,
			);
		}),
	);
	const completionContexts = deriveContexts(
		ledger,
		effectRuns,
		armLocalTerminalPolicy,
		objectivePhaseRecoveryPolicy,
	);
	const insightProjection = admitInsights(ledger, completionContexts);
	const material = strictSnapshot({
		schemaVersion: D722_GRAPH_EVIDENCE_SCHEMA,
		ledger,
		effectRuns,
		completionContexts,
		memoryInsights: insightProjection.insights,
		insightTopology: insightProjection.topology,
		insightTopologyDigest: empiricalStrictJsonDigest(insightProjection.topology),
		runStatus: ledger.runStatus,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

interface D722MeasuredSources {
	readonly graphRuntimeSourceDigest: string;
	readonly graphEvalSourceDigest: string;
	readonly completionAdapterSourceDigest: string;
	readonly modelFixtureSourceDigest: string;
	readonly projectionSourceDigest: string;
}

async function measureD722Sources(): Promise<D722MeasuredSources> {
	const [runtime, evalSource, adapter, model, projection] = await Promise.all([
		readFile(new URL("./d722-graph-native-effect-runtime.ts", import.meta.url)),
		readFile(new URL("./d722-graph-native-eval.ts", import.meta.url)),
		readFile(new URL("./d722-provider-capable-effect-adapter.ts", import.meta.url)),
		readFile(new URL("./d722-injected-model-fixture.ts", import.meta.url)),
		readFile(new URL("./d722-graph-completion-memory-insight.ts", import.meta.url)),
	]);
	return Object.freeze({
		graphRuntimeSourceDigest: empiricalSha256(runtime),
		graphEvalSourceDigest: empiricalSha256(evalSource),
		completionAdapterSourceDigest: empiricalSha256(adapter),
		modelFixtureSourceDigest: empiricalSha256(model),
		projectionSourceDigest: empiricalSha256(projection),
	});
}

function assertFrozenD722Sources(sources: D722MeasuredSources): void {
	if (
		sources.graphRuntimeSourceDigest !== D722_EXPECTED_RUNTIME_SOURCE_DIGEST ||
		sources.graphEvalSourceDigest !== D722_EXPECTED_EVAL_SOURCE_DIGEST ||
		sources.completionAdapterSourceDigest !== D722_EXPECTED_ADAPTER_SOURCE_DIGEST ||
		sources.modelFixtureSourceDigest !== D722_EXPECTED_MODEL_FIXTURE_SOURCE_DIGEST
	)
		throw new TypeError("D722 frozen implementation source drifted");
}

export async function runD722PreLiveQualification(inputValue: {
	readonly sourceDigest: string;
	readonly budgetLimits: D719CleanBudgetLimitsV1;
	readonly effectCeilings: D720EffectCeilingsV2;
	readonly signal?: AbortSignal;
}): Promise<D722PreLiveBundleV1> {
	const input = record(inputValue, "d722.qualificationRun");
	exactKeys(
		input,
		Object.hasOwn(input, "signal")
			? ["budgetLimits", "effectCeilings", "signal", "sourceDigest"]
			: ["budgetLimits", "effectCeilings", "sourceDigest"],
		"d722.qualificationRun",
	);
	if (Object.hasOwn(input, "signal") && !(input.signal instanceof AbortSignal))
		throw new TypeError("D722 signal is invalid");
	const sourceDigestsBefore = await measureD722Sources();
	assertFrozenD722Sources(sourceDigestsBefore);
	const adapterRun = await runD722InjectedProviderCapableAdapter(
		Object.hasOwn(input, "signal")
			? {
					sourceDigest: input.sourceDigest as string,
					budgetLimits: input.budgetLimits as D719CleanBudgetLimitsV1,
					effectCeilings: input.effectCeilings as D720EffectCeilingsV2,
					signal: input.signal as AbortSignal,
				}
			: {
					sourceDigest: input.sourceDigest as string,
					budgetLimits: input.budgetLimits as D719CleanBudgetLimitsV1,
					effectCeilings: input.effectCeilings as D720EffectCeilingsV2,
				},
	);
	const sourceDigestsAfter = await measureD722Sources();
	assertFrozenD722Sources(sourceDigestsAfter);
	if (
		empiricalStrictJsonDigest(sourceDigestsBefore) !== empiricalStrictJsonDigest(sourceDigestsAfter)
	)
		throw new TypeError("D722 implementation changed during qualification");
	const graphEvidence = deriveD722CanonicalGraphEvidence(
		adapterRun.core.ledger,
		adapterRun.core.effectRuns,
	);
	const admittedEffects = graphEvidence.ledger.effectAdmissions.filter(
		(fact) => fact.admitted,
	).length;
	const providerEffects = adapterRun.callsByEffectKind.get("provider-request") ?? 0;
	if (
		graphEvidence.runStatus !== "complete" ||
		graphEvidence.ledger.completedArms.length !== MAX_ARMS ||
		graphEvidence.completionContexts.length !== MAX_ARMS ||
		graphEvidence.memoryInsights.length !== MAX_ARMS ||
		adapterRun.executedEffectCount !== admittedEffects ||
		adapterRun.failedEffectCount !== 0 ||
		adapterRun.maxActiveInvocations !== 1 ||
		adapterRun.cleanupCalls !== MAX_ARMS ||
		adapterRun.remainingWorkspaces !== 0
	)
		throw new TypeError("D722 injected no-network qualification coverage drifted");
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D722_QUALIFICATION_SCHEMA,
		decisionRef: D722_DECISION_REF,
		decisionRevision: D722_DECISION_REVISION,
		d720BaselineCommit: D722_D720_BASELINE_COMMIT,
		d721BaselineCommit: D722_D721_BASELINE_COMMIT,
		adapterRevision: D721_PROVIDER_CAPABLE_ADAPTER_REVISION,
		completionAdapterRevision: D722_PROVIDER_CAPABLE_ADAPTER_REVISION,
		...sourceDigestsBefore,
		executionClass: "provider-capable-injected-no-network" as const,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		completedArmCount: 6 as const,
		completionContextCount: 6 as const,
		memoryInsightCount: 6 as const,
		injectedProviderEffectCount: providerEffects,
		graphAdmittedEffectCount: admittedEffects,
		maxActiveInvocations: 1 as const,
		allEffectsGraphAdmitted: true as const,
		allUsageGraphReconciled: true as const,
		networkCallCount: 0 as const,
		providerNetworkCallCount: 0 as const,
		memoryInsightsAutoApplied: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = Object.freeze({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: D722_GENERATION_SCHEMA,
		generationRef: D722_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		d720BaselineCommit: D722_D720_BASELINE_COMMIT,
		d721BaselineCommit: D722_D721_BASELINE_COMMIT,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = Object.freeze({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const bundleMaterial = strictSnapshot({
		schemaVersion: D722_BUNDLE_SCHEMA,
		graphEvidence,
		qualification,
		generation,
	});
	const bundle = Object.freeze({
		...bundleMaterial,
		bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
	});
	constructedBundles.add(bundle);
	return bundle;
}

export function validateD722PreLiveBundle(value: unknown): D722PreLiveBundleV1 {
	const candidate = record(value, "d722.bundle");
	exactKeys(
		candidate,
		["bundleDigest", "generation", "graphEvidence", "qualification", "schemaVersion"],
		"d722.bundle",
	);
	if (candidate.schemaVersion !== D722_BUNDLE_SCHEMA)
		throw new TypeError("D722 bundle schema drifted");
	const graphCandidate = record(candidate.graphEvidence, "d722.graphEvidence");
	exactKeys(
		graphCandidate,
		[
			"causalAttribution",
			"completionContexts",
			"effectRuns",
			"efficacyClaim",
			"evidenceDigest",
			"insightTopology",
			"insightTopologyDigest",
			"ledger",
			"memoryInsights",
			"runStatus",
			"schemaVersion",
		],
		"d722.graphEvidence",
	);
	if (!Array.isArray(graphCandidate.effectRuns) || graphCandidate.effectRuns.length > MAX_ARMS)
		throw new TypeError("D722 effect-run bound exceeded");
	if (
		!Array.isArray(graphCandidate.completionContexts) ||
		graphCandidate.completionContexts.length > MAX_ARMS ||
		!Array.isArray(graphCandidate.memoryInsights) ||
		graphCandidate.memoryInsights.length > MAX_ARMS
	)
		throw new TypeError("D722 completion/insight projection bound exceeded");
	const rawContexts = array(
		graphCandidate.completionContexts,
		"d722.graphEvidence.completionContexts",
	);
	const rawInsights = array(graphCandidate.memoryInsights, "d722.graphEvidence.memoryInsights");
	for (const [index, rawContext] of rawContexts.entries())
		completionContext(rawContext, `d722.graphEvidence.completionContexts[${index}]`);
	for (const [index, rawInsight] of rawInsights.entries())
		validateInsight(rawInsight, `d722.graphEvidence.memoryInsights[${index}]`);
	const rawTopology = record(graphCandidate.insightTopology, "d722.graphEvidence.insightTopology");
	exactKeys(rawTopology, ["edges", "nodes"], "d722.graphEvidence.insightTopology");
	if (
		!Array.isArray(rawTopology.nodes) ||
		rawTopology.nodes.length > 4 ||
		!Array.isArray(rawTopology.edges) ||
		rawTopology.edges.length > 4
	)
		throw new TypeError("D722 insight topology bound exceeded");
	array(rawTopology.nodes, "d722.graphEvidence.insightTopology.nodes");
	array(rawTopology.edges, "d722.graphEvidence.insightTopology.edges");
	const replayedEvidence = deriveD722CanonicalGraphEvidence(
		graphCandidate.ledger,
		array(
			graphCandidate.effectRuns,
			"d722.graphEvidence.effectRuns",
		) as readonly D722GraphEffectEvidenceV1[],
	);
	if (empiricalStrictJsonDigest(replayedEvidence) !== empiricalStrictJsonDigest(graphCandidate))
		throw new TypeError("D722 canonical Graph evidence is not an exact replay");
	const qualification = record(candidate.qualification, "d722.qualification");
	exactKeys(
		qualification,
		[
			"adapterRevision",
			"completionAdapterRevision",
			"completionAdapterSourceDigest",
			"allEffectsGraphAdmitted",
			"allUsageGraphReconciled",
			"causalAttribution",
			"completedArmCount",
			"completionContextCount",
			"d720BaselineCommit",
			"d721BaselineCommit",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"executionClass",
			"graphAdmittedEffectCount",
			"graphEvalSourceDigest",
			"graphEvidenceDigest",
			"graphRuntimeSourceDigest",
			"injectedProviderEffectCount",
			"maxActiveInvocations",
			"memoryInsightCount",
			"modelFixtureSourceDigest",
			"memoryInsightsAutoApplied",
			"networkCallCount",
			"providerNetworkCallCount",
			"projectionSourceDigest",
			"qualificationDigest",
			"schemaVersion",
		],
		"d722.qualification",
	);
	for (const key of ["graphAdmittedEffectCount", "injectedProviderEffectCount"] as const)
		safeInteger(qualification[key], `d722.qualification.${key}`, { max: 6_144 });
	const derivedAdmittedEffects = replayedEvidence.ledger.effectAdmissions.filter(
		(fact) => fact.admitted,
	).length;
	const derivedProviderEffects = replayedEvidence.effectRuns.reduce(
		(count, run) =>
			count +
			run.facts.filter(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.request.effectKind === "provider-request",
			).length,
		0,
	);
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D722_QUALIFICATION_SCHEMA,
		decisionRef: D722_DECISION_REF,
		decisionRevision: D722_DECISION_REVISION,
		d720BaselineCommit: D722_D720_BASELINE_COMMIT,
		d721BaselineCommit: D722_D721_BASELINE_COMMIT,
		adapterRevision: D721_PROVIDER_CAPABLE_ADAPTER_REVISION,
		completionAdapterRevision: D722_PROVIDER_CAPABLE_ADAPTER_REVISION,
		completionAdapterSourceDigest: D722_EXPECTED_ADAPTER_SOURCE_DIGEST,
		modelFixtureSourceDigest: D722_EXPECTED_MODEL_FIXTURE_SOURCE_DIGEST,
		graphRuntimeSourceDigest: D722_EXPECTED_RUNTIME_SOURCE_DIGEST,
		graphEvalSourceDigest: D722_EXPECTED_EVAL_SOURCE_DIGEST,
		projectionSourceDigest: digest(
			qualification.projectionSourceDigest,
			"d722.qualification.projectionSourceDigest",
		),
		executionClass: "provider-capable-injected-no-network" as const,
		graphEvidenceDigest: replayedEvidence.evidenceDigest,
		completedArmCount: 6 as const,
		completionContextCount: 6 as const,
		memoryInsightCount: 6 as const,
		injectedProviderEffectCount: derivedProviderEffects,
		graphAdmittedEffectCount: derivedAdmittedEffects,
		maxActiveInvocations: 1 as const,
		allEffectsGraphAdmitted: true as const,
		allUsageGraphReconciled: true as const,
		networkCallCount: 0 as const,
		providerNetworkCallCount: 0 as const,
		memoryInsightsAutoApplied: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	if (
		empiricalStrictJsonDigest(qualificationMaterial) !==
		digest(qualification.qualificationDigest, "d722.qualification.qualificationDigest")
	)
		throw new TypeError("D722 qualification digest mismatch");
	const canonicalQualification = Object.freeze({
		...qualificationMaterial,
		qualificationDigest: qualification.qualificationDigest as string,
	});
	if (
		empiricalStrictJsonDigest(canonicalQualification) !== empiricalStrictJsonDigest(qualification)
	)
		throw new TypeError("D722 qualification is not canonical");
	const generation = record(candidate.generation, "d722.generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"d720BaselineCommit",
			"d721BaselineCommit",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"graphEvidenceDigest",
			"qualificationDigest",
			"schemaVersion",
		],
		"d722.generation",
	);
	const generationMaterial = strictSnapshot({
		schemaVersion: D722_GENERATION_SCHEMA,
		generationRef: D722_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest as string,
		graphEvidenceDigest: replayedEvidence.evidenceDigest,
		d720BaselineCommit: D722_D720_BASELINE_COMMIT,
		d721BaselineCommit: D722_D721_BASELINE_COMMIT,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	if (
		empiricalStrictJsonDigest(generationMaterial) !==
		digest(generation.generationDigest, "d722.generation.generationDigest")
	)
		throw new TypeError("D722 generation digest mismatch");
	const canonicalGeneration = Object.freeze({
		...generationMaterial,
		generationDigest: generation.generationDigest as string,
	});
	if (empiricalStrictJsonDigest(canonicalGeneration) !== empiricalStrictJsonDigest(generation))
		throw new TypeError("D722 generation is not canonical");
	const material = strictSnapshot({
		schemaVersion: D722_BUNDLE_SCHEMA,
		graphEvidence: replayedEvidence,
		qualification: canonicalQualification,
		generation: canonicalGeneration,
	});
	if (
		empiricalStrictJsonDigest(material) !==
		digest(candidate.bundleDigest, "d722.bundle.bundleDigest")
	)
		throw new TypeError("D722 bundle digest mismatch");
	return Object.freeze({ ...material, bundleDigest: candidate.bundleDigest as string });
}

export function createD722PersistenceFaultForTest(
	stage: "after-staging-sync" | "after-rename",
): D722PersistenceFaultV1 {
	const fault = Object.freeze({ revision: "graphrefly.b112.d722.persistence-fault.v1" as const });
	constructedFaults.set(fault, { stage, consumed: false });
	return fault;
}

interface FileIdentity {
	readonly dev: number;
	readonly ino: number;
}

async function canonicalPrivateRoot(
	value: unknown,
): Promise<{ readonly path: string; readonly identity: FileIdentity }> {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError("D722 privateRoot is invalid");
	const absolute = resolve(value);
	if (absolute !== value) throw new TypeError("D722 privateRoot must be absolute and canonical");
	const stat = await lstat(absolute);
	if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700)
		throw new TypeError("D722 privateRoot must be a real 0700 directory");
	if ((await realpath(absolute)) !== absolute)
		throw new TypeError("D722 privateRoot realpath drifted");
	return Object.freeze({ path: absolute, identity: { dev: stat.dev, ino: stat.ino } });
}

async function assertDirectoryIdentity(
	path: string,
	identity: FileIdentity,
	mode: number,
): Promise<void> {
	const stat = await lstat(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o777) !== mode ||
		stat.dev !== identity.dev ||
		stat.ino !== identity.ino ||
		(await realpath(path)) !== path
	)
		throw new TypeError("D722 directory identity drifted");
}

async function writeCanonical(path: string, bytes: Uint8Array): Promise<FileIdentity> {
	if (bytes.byteLength > MAX_ARTIFACT_BYTES)
		throw new TypeError("D722 artifact byte bound exceeded");
	const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1)
			throw new TypeError("D722 canonical artifact is not an owned 0600 file");
		await handle.writeFile(bytes);
		await handle.sync();
		return { dev: stat.dev, ino: stat.ino };
	} finally {
		await handle.close();
	}
}

async function assertFile(
	path: string,
	identity: FileIdentity,
	expected: Uint8Array,
): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		const actual = await handle.readFile();
		if (
			!stat.isFile() ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.nlink !== 1 ||
			stat.dev !== identity.dev ||
			stat.ino !== identity.ino ||
			!sameBytes(actual, expected)
		)
			throw new TypeError("D722 artifact identity or bytes drifted");
	} finally {
		await handle.close();
	}
}

export async function persistD722PreLiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D722PreLiveBundleV1;
	readonly fault?: D722PersistenceFaultV1;
}): Promise<D722PersistenceReceiptV1> {
	const input = record(inputValue, "d722.persist");
	exactKeys(
		input,
		Object.hasOwn(input, "fault") ? ["bundle", "fault", "privateRoot"] : ["bundle", "privateRoot"],
		"d722.persist",
	);
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.has(input.bundle)
	)
		throw new TypeError("D722 persistence requires a same-process constructed bundle");
	const bundle = validateD722PreLiveBundle(input.bundle);
	let faultStage: "after-staging-sync" | "after-rename" | null = null;
	if (Object.hasOwn(input, "fault")) {
		if (typeof input.fault !== "object" || input.fault === null)
			throw new TypeError("D722 persistence fault capability is invalid");
		const fault = constructedFaults.get(input.fault);
		if (fault === undefined || fault.consumed)
			throw new TypeError("D722 persistence fault capability is invalid or consumed");
		fault.consumed = true;
		faultStage = fault.stage;
	}
	const validatedRoot = await canonicalPrivateRoot(input.privateRoot);
	const privateRoot = validatedRoot.path;
	const parentHandle = await open(privateRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
	const finalRoot = join(privateRoot, D722_GENERATION_REF);
	let parentIdentity: FileIdentity | null = null;
	let claimCreated = false;
	let finalIdentity: FileIdentity | null = null;
	let finalHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactsHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactsIdentity: FileIdentity | null = null;
	let graphBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
	let qualificationBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
	let generationBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
	let bundleBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
	let operationError: unknown = null;
	try {
		const parentStat = await parentHandle.stat();
		parentIdentity = { dev: parentStat.dev, ino: parentStat.ino };
		if (
			parentIdentity.dev !== validatedRoot.identity.dev ||
			parentIdentity.ino !== validatedRoot.identity.ino
		)
			throw new TypeError("D722 privateRoot changed before stable-handle acquisition");
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		try {
			await mkdir(finalRoot, { mode: 0o700 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST")
				throw new TypeError("D722 generation already exists");
			throw error;
		}
		claimCreated = true;
		finalHandle = await open(finalRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
		const finalStat = await finalHandle.stat();
		if (!finalStat.isDirectory() || (finalStat.mode & 0o777) !== 0o700)
			throw new TypeError("D722 claimed generation identity is invalid");
		finalIdentity = { dev: finalStat.dev, ino: finalStat.ino };
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		graphBytes = strictJsonCodec.encode(bundle.graphEvidence);
		qualificationBytes = strictJsonCodec.encode(bundle.qualification);
		generationBytes = strictJsonCodec.encode(bundle.generation);
		bundleBytes = strictJsonCodec.encode(bundle);
		const artifacts = [
			["graph-evidence.v1.json", graphBytes],
			["qualification.v1.json", qualificationBytes],
			["generation.v1.json", generationBytes],
			["bundle.v1.json", bundleBytes],
		] as const;
		const stagingRoot = join(finalRoot, `.d722-staging-${randomUUID()}`);
		await mkdir(stagingRoot, { mode: 0o700 });
		const stagingStat = await lstat(stagingRoot);
		const stagingIdentity = { dev: stagingStat.dev, ino: stagingStat.ino };
		await assertDirectoryIdentity(stagingRoot, stagingIdentity, 0o700);
		const identities = new Map<string, FileIdentity>();
		for (const [name, bytes] of artifacts)
			identities.set(name, await writeCanonical(join(stagingRoot, name), bytes));
		const stagingHandle = await open(stagingRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			await stagingHandle.sync();
		} finally {
			await stagingHandle.close();
		}
		for (const [name, bytes] of artifacts)
			await assertFile(join(stagingRoot, name), identities.get(name)!, bytes);
		if (faultStage === "after-staging-sync")
			throw new TypeError("D722 injected post-staging-sync failure");
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		const artifactsRoot = join(finalRoot, "artifacts");
		await rename(stagingRoot, artifactsRoot);
		artifactsHandle = await open(artifactsRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
		const artifactsStat = await artifactsHandle.stat();
		artifactsIdentity = { dev: artifactsStat.dev, ino: artifactsStat.ino };
		if (
			!artifactsStat.isDirectory() ||
			(artifactsStat.mode & 0o777) !== 0o700 ||
			artifactsIdentity.dev !== stagingIdentity.dev ||
			artifactsIdentity.ino !== stagingIdentity.ino
		)
			throw new TypeError("D722 committed artifacts identity drifted");
		await assertDirectoryIdentity(artifactsRoot, artifactsIdentity, 0o700);
		if (faultStage === "after-rename") throw new TypeError("D722 injected post-rename failure");
		const commitBytes = strictJsonCodec.encode(
			strictSnapshot({
				schemaVersion: "graphrefly.b112.d722.provider-capable-pre-live-commit.v2",
				generationDigest: bundle.generation.generationDigest,
				bundleDigest: bundle.bundleDigest,
				artifactsDirectory: "artifacts",
			}),
		);
		const commitIdentity = await writeCanonical(join(finalRoot, "commit.v2.json"), commitBytes);
		await finalHandle.sync();
		for (const [name, bytes] of artifacts)
			await assertFile(join(artifactsRoot, name), identities.get(name)!, bytes);
		await assertFile(join(finalRoot, "commit.v2.json"), commitIdentity, commitBytes);
		await assertDirectoryIdentity(artifactsRoot, artifactsIdentity, 0o700);
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		await parentHandle.sync();
		await assertDirectoryIdentity(privateRoot, parentIdentity, 0o700);
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		await assertDirectoryIdentity(artifactsRoot, artifactsIdentity, 0o700);
		for (const [name, bytes] of artifacts)
			await assertFile(join(artifactsRoot, name), identities.get(name)!, bytes);
		await assertFile(join(finalRoot, "commit.v2.json"), commitIdentity, commitBytes);
		const finalHandleStat = await finalHandle.stat();
		const artifactsHandleStat = await artifactsHandle.stat();
		if (
			finalHandleStat.dev !== finalIdentity.dev ||
			finalHandleStat.ino !== finalIdentity.ino ||
			artifactsHandleStat.dev !== artifactsIdentity.dev ||
			artifactsHandleStat.ino !== artifactsIdentity.ino
		)
			throw new TypeError("D722 stable directory handle identity drifted");
		await assertDirectoryIdentity(finalRoot, finalIdentity, 0o700);
		await assertDirectoryIdentity(artifactsRoot, artifactsIdentity, 0o700);
	} catch (error) {
		operationError = error;
	}
	const closeResults = await Promise.allSettled([
		artifactsHandle?.close() ?? Promise.resolve(),
		finalHandle?.close() ?? Promise.resolve(),
	]);
	const closeErrors = closeResults
		.filter((result): result is PromiseRejectedResult => result.status === "rejected")
		.map((result) => result.reason);
	if (closeErrors.length > 0)
		operationError = new AggregateError(
			operationError === null ? closeErrors : [operationError, ...closeErrors],
			"D722 persistence handle cleanup failed",
		);
	let cleanupError: unknown = null;
	if (operationError !== null && claimCreated) {
		if (parentIdentity === null || finalIdentity === null) {
			cleanupError = new TypeError("D722 exact cleanup ownership was not established");
		} else {
			const currentRoot = await lstat(privateRoot).catch(() => null);
			const currentFinal = await lstat(finalRoot).catch(() => null);
			if (
				currentRoot === null ||
				currentRoot.dev !== parentIdentity.dev ||
				currentRoot.ino !== parentIdentity.ino ||
				currentFinal === null ||
				currentFinal.dev !== finalIdentity.dev ||
				currentFinal.ino !== finalIdentity.ino
			) {
				cleanupError = new TypeError("D722 cleanup refused after ownership drift");
			} else {
				try {
					await rm(finalRoot, { recursive: true, force: true });
					await parentHandle.sync();
				} catch (error) {
					cleanupError = error;
				}
			}
		}
	}
	const parentClose = await Promise.allSettled([parentHandle.close()]);
	const parentCloseError = parentClose[0]?.status === "rejected" ? parentClose[0].reason : null;
	if (operationError !== null) {
		const errors = [operationError];
		if (cleanupError !== null) errors.push(cleanupError);
		if (parentCloseError !== null) errors.push(parentCloseError);
		if (errors.length > 1) throw new AggregateError(errors, "D722 persistence cleanup failed");
		throw operationError;
	}
	// The transaction linearizes at the final stable-handle/path rebind, second
	// readback, and parent fsync above. A later close failure cannot revoke that
	// durable commit or turn it into a false failed generation.
	void parentCloseError;
	const material = strictSnapshot({
		schemaVersion: D722_PERSISTENCE_SCHEMA,
		generationRef: D722_GENERATION_REF,
		graphArtifactDigest: empiricalSha256(graphBytes),
		qualificationArtifactDigest: empiricalSha256(qualificationBytes),
		generationArtifactDigest: empiricalSha256(generationBytes),
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		bundleDigest: bundle.bundleDigest,
	});
	return Object.freeze({ ...material, persistenceDigest: empiricalStrictJsonDigest(material) });
}
