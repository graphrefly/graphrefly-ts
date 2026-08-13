import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import {
	array,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	D719_CLEAN_GRAPH_ARM_ORDER,
	type D719CleanArm,
	type D719CleanGraphEvidenceV1,
	validateD719CleanGraphEvidence,
} from "./d767-clean-graph-ledger.js";
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
	D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA,
	D761_CRITERION_FAILURE_CONTEXT_SCHEMA,
	D761_MAX_PUBLIC_CRITERION_FAILURES,
	deriveD722GraphArmResultFromEvidence,
	validateD722GraphEffectEvidence,
} from "./d767-graph-native-effect-runtime.js";

export const D722_MEMORY_INSIGHT_SCHEMA = "graphrefly.b112.d722.memory-insight.v1" as const;
export const D771_GRAPH_EVIDENCE_SCHEMA =
	"graphrefly.b112.d771.canonical-graph-evidence.v1" as const;

const MAX_RUNS = 12;

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

export interface D771CanonicalGraphEvidenceV1 {
	readonly schemaVersion: typeof D771_GRAPH_EVIDENCE_SCHEMA;
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

function completionContext(value: unknown, path: string): D722GraphCompletionContextV1 {
	const candidate = record(value, path);
	exactKeys(
		candidate,
		[
			"budgetProjectionDigest",
			"contextDigest",
			...(Object.hasOwn(candidate, "criterionFailures") ? ["criterionFailures" as const] : []),
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
				candidate.reason === "objective-phase-advanced")) ||
		(candidate.schemaVersion === D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA &&
			(candidate.reason === "hidden-verifier-failed" ||
				candidate.reason === "objective-phase-advanced")) ||
		(candidate.schemaVersion === D761_CRITERION_FAILURE_CONTEXT_SCHEMA &&
			(candidate.reason === "public-semantic-validation-failed" ||
				candidate.reason === "objective-phase-advanced"));
	if (
		!contextCoordinatesValid ||
		(candidate.requiredDisposition !== "tool-intents" &&
			candidate.requiredDisposition !== "structured-final") ||
		(candidate.requiredDisposition === "structured-final" &&
			((candidate.schemaVersion !== D748_FORWARD_PHASE_CONTEXT_SCHEMA &&
				candidate.schemaVersion !== D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA &&
				candidate.schemaVersion !== D761_CRITERION_FAILURE_CONTEXT_SCHEMA) ||
				candidate.nextRequiredPhase !== "hidden-verifier"))
	)
		throw new TypeError("D722 completion context coordinates drifted");
	const remainingCompletionContexts = safeInteger(
		candidate.remainingCompletionContexts,
		`${path}.remainingCompletionContexts`,
		{
			max:
				candidate.schemaVersion === D748_FORWARD_PHASE_CONTEXT_SCHEMA ||
				candidate.schemaVersion === D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA
					? D748_MAX_COMPLETION_CONTEXTS_PER_RUN - 1
					: candidate.schemaVersion === D761_CRITERION_FAILURE_CONTEXT_SCHEMA
						? D748_MAX_COMPLETION_CONTEXTS_PER_RUN - 1
						: D745_MAX_COMPLETION_CONTEXTS_PER_RUN - 1,
		},
	);
	if (
		candidate.schemaVersion !== D745_PHASE_SCOPED_CONTEXT_SCHEMA &&
		candidate.schemaVersion !== D748_FORWARD_PHASE_CONTEXT_SCHEMA &&
		candidate.schemaVersion !== D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA &&
		candidate.schemaVersion !== D761_CRITERION_FAILURE_CONTEXT_SCHEMA &&
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
	if (candidate.reason === "public-semantic-validation-failed") {
		const failures = array(candidate.criterionFailures, `${path}.criterionFailures`);
		if (failures.length < 1 || failures.length > D761_MAX_PUBLIC_CRITERION_FAILURES)
			throw new TypeError("D761 criterion failure context is empty or oversized");
		for (const [index, failure] of failures.entries())
			oneOf(
				failure,
				[
					"authorization-invariant-regressed",
					"canonical-provenance-not-admitted",
					"local-reconstruction-not-rejected",
					"malformed-provenance-not-rejected",
				],
				`${path}.criterionFailures[${index}]`,
			);
		if (new Set(failures).size !== failures.length)
			throw new TypeError("D761 criterion failures are not unique");
	} else if (Object.hasOwn(candidate, "criterionFailures")) {
		throw new TypeError("D722 non-D761 context cannot carry criterion failures");
	}
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
		...(candidate.reason === "public-semantic-validation-failed"
			? {
					criterionFailures: Object.freeze(
						array(candidate.criterionFailures, `${path}.criterionFailures`),
					),
				}
			: {}),
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
				context.schemaVersion === D748_FORWARD_PHASE_CONTEXT_SCHEMA ||
				context.schemaVersion === D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA ||
				context.schemaVersion === D761_CRITERION_FAILURE_CONTEXT_SCHEMA,
		);
		const forwardPhase = runContexts.some(
			(context) =>
				context.schemaVersion === D748_FORWARD_PHASE_CONTEXT_SCHEMA ||
				context.schemaVersion === D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA ||
				context.schemaVersion === D761_CRITERION_FAILURE_CONTEXT_SCHEMA,
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
						? `${context.schemaVersion}:${context.reason}:${context.nextRequiredPhase}`
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
			const contextFact = admittedFacts[contextFactIndex];
			const rejected = admittedFacts.find(
				(fact, factIndex) =>
					factIndex < contextFactIndex &&
					fact.request.requestDigest === context.rejectedRequestDigest,
			);
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
						: context.reason === "hidden-verifier-failed"
							? rejected?.result.effectKind === "hidden-verifier" &&
								rejected.result.status === "failed" &&
								context.nextRequiredPhase === "exact-mutation"
							: context.reason === "public-semantic-validation-failed"
								? rejected?.result.effectKind === "public-semantic-validation" &&
									rejected.result.status === "failed" &&
									context.nextRequiredPhase === "exact-mutation"
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
	readonly topology: D771CanonicalGraphEvidenceV1["insightTopology"];
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

function _validateInsight(value: unknown, path: string): D722MemoryInsightV1 {
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

export function deriveD771CanonicalGraphEvidence(
	ledgerValue: unknown,
	effectRunsValue: readonly D722GraphEffectEvidenceV1[],
	armLocalTerminalPolicy?: D726ArmLocalTerminalProviderPolicyV1,
	objectivePhaseRecoveryPolicy?: D737GraphObjectivePhaseRecoveryPolicyV1,
): D771CanonicalGraphEvidenceV1 {
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
		schemaVersion: D771_GRAPH_EVIDENCE_SCHEMA,
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
