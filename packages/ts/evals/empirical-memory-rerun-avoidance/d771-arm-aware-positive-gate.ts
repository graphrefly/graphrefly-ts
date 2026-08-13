import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D761_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST } from "./d761-public-semantic-validation-qualification.js";
import type { D720GraphEffectRequestV1 } from "./d767-graph-native-effect-runtime.js";
import type { D771CanonicalGraphEvidenceV1 } from "./d771-graph-completion-memory-insight.js";
import type { D771LoweringGraphEvidenceV1 } from "./d771-lowering-evidence-authority.js";

export const D771_ARM_AWARE_GATE_PROJECTION_REVISION =
	"graphrefly.b112.d771.arm-aware-positive-gate-projection.v1" as const;

const ARMS = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);
const EXPECTED_HIDDEN = Object.freeze([
	"failed",
	"passed",
	"failed",
	"failed",
	"failed",
	"failed",
] as const);

export const D771_ARM_EXPOSURE_BY_ARM = Object.freeze({
	cold: "none",
	"relevant-applied": "relevant-admitted",
	"proposal-only": "proposal-only",
	"admission-rejected": "admission-rejected",
	"irrelevant-applied": "irrelevant-admitted",
	"wrong-scope-applied": "wrong-scope-admitted",
} as const);

export const D771_QUALIFICATION_SOURCE_DIGEST = empiricalStrictJsonDigest({
	decisionRef: "decision.D771",
	fixtureRevision: "graphrefly.b112.d771.arm-exposure-fixture.v1",
	armOrder: ARMS,
	armExposure: D771_ARM_EXPOSURE_BY_ARM,
	taskCoordinate: "graphrefly.b112.d771.public-semantic-validation-task.v1",
});

export const D771_MODEL_EXPOSURE_EVIDENCE_REVISION =
	"graphrefly.b112.d771.model-exposure-evidence.v1" as const;

export function deriveD771ModelExposure(
	arm: (typeof ARMS)[number],
	effectRequest: D720GraphEffectRequestV1,
) {
	const taskStatement = "D771 task coordinate is encoded in the Graph-authored conversation.";
	const conversation = strictSnapshot({
		messages: [
			{
				role: "user",
				content: `Task coordinate: graphrefly.b112.d771.public-semantic-validation-task.v1; Graph-admitted memory exposure: ${D771_ARM_EXPOSURE_BY_ARM[arm]}`,
			},
		],
	});
	const modelVisibleMessages = strictSnapshot([
		...conversation.messages,
		...(effectRequest.completionContext === undefined
			? []
			: [
					{
						role: "user",
						content: JSON.stringify({ graphCompletionContext: effectRequest.completionContext }),
					},
				]),
	]);
	const evidenceMaterial = strictSnapshot({
		revision: D771_MODEL_EXPOSURE_EVIDENCE_REVISION,
		arm,
		effectRequestDigest: effectRequest.requestDigest,
		conversationDigest: empiricalStrictJsonDigest(conversation),
		modelVisibleMessagesDigest: empiricalStrictJsonDigest(modelVisibleMessages),
	});
	return Object.freeze({
		taskStatement,
		conversation,
		conversationDigest: evidenceMaterial.conversationDigest,
		modelVisibleMessagesDigest: evidenceMaterial.modelVisibleMessagesDigest,
		evidenceDigest: empiricalStrictJsonDigest(evidenceMaterial),
	});
}

type EffectRun = D771CanonicalGraphEvidenceV1["effectRuns"][number];
type AdmittedFact = Extract<EffectRun["facts"][number], { kind: "graph-effect-result-admitted" }>;

function admitted(run: EffectRun): readonly AdmittedFact[] {
	return run.facts.filter(
		(fact): fact is AdmittedFact => fact.kind === "graph-effect-result-admitted",
	);
}

function isQualifyingLifecycle(
	run: EffectRun,
	expectedHidden: (typeof EXPECTED_HIDDEN)[number],
	exposureBound: (fact: AdmittedFact) => boolean,
): boolean {
	if (run.runtimeStatus !== "complete") return false;
	const facts = admitted(run);
	if (facts.length !== (expectedHidden === "passed" ? 15 : 24)) return false;
	const [
		materialization,
		initialProvider,
		inspection,
		initialMutation,
		initialDiff,
		initialFocus,
		semanticFailed,
		correctionProvider,
		correctionMutation,
		correctionDiff,
		correctionFocus,
		semanticPassed,
		forwardProvider,
		hidden,
		cleanup,
	] = facts;
	const succeededTool = (fact: AdmittedFact | undefined, toolRef: string) =>
		fact?.result.effectKind === "tool-action" &&
		fact.result.toolRef === toolRef &&
		fact.result.status === "succeeded";
	const providerExposureBound = facts
		.filter((fact) => fact.result.effectKind === "provider-request")
		.every(exposureBound);
	const commonLifecycle =
		providerExposureBound &&
		materialization?.result.effectKind === "materialization" &&
		materialization.result.status === "ready" &&
		initialProvider?.result.effectKind === "provider-request" &&
		initialProvider.result.status === "tool-intents" &&
		initialProvider.request.completionContext === undefined &&
		succeededTool(inspection, "read-file") &&
		succeededTool(initialMutation, "replace-exact") &&
		initialMutation?.result.effectKind === "tool-action" &&
		initialMutation.result.workspaceStateBeforeDigest !==
			initialMutation.result.workspaceStateAfterDigest &&
		succeededTool(initialDiff, "workspace-diff") &&
		initialDiff?.result.effectKind === "tool-action" &&
		initialDiff.result.nonEmptyDiff === true &&
		succeededTool(initialFocus, "focused-validation") &&
		semanticFailed?.result.effectKind === "public-semantic-validation" &&
		semanticFailed.result.status === "failed" &&
		semanticFailed.result.criterionFailures.length > 0 &&
		correctionProvider?.result.effectKind === "provider-request" &&
		correctionProvider.result.status === "tool-intents" &&
		correctionProvider.request.completionContext?.reason === "public-semantic-validation-failed" &&
		succeededTool(correctionMutation, "replace-exact") &&
		correctionMutation?.result.effectKind === "tool-action" &&
		correctionMutation.result.workspaceStateBeforeDigest !==
			correctionMutation.result.workspaceStateAfterDigest &&
		succeededTool(correctionDiff, "workspace-diff") &&
		correctionDiff?.result.effectKind === "tool-action" &&
		correctionDiff.result.nonEmptyDiff === true &&
		succeededTool(correctionFocus, "focused-validation") &&
		semanticPassed?.result.effectKind === "public-semantic-validation" &&
		semanticPassed.result.status === "passed" &&
		semanticPassed.result.criterionFailures.length === 0 &&
		forwardProvider?.result.effectKind === "provider-request" &&
		forwardProvider.result.status === "structured-final" &&
		forwardProvider.request.completionContext === undefined &&
		hidden?.result.effectKind === "hidden-verifier" &&
		hidden.result.status === expectedHidden &&
		(expectedHidden === "failed" ||
			(cleanup?.result.effectKind === "cleanup" && cleanup.result.status === "succeeded"));
	if (!commonLifecycle) return false;
	if (expectedHidden === "passed") return true;
	const [
		hiddenCorrectionProvider,
		hiddenCorrectionMutation,
		diffProvider,
		hiddenCorrectionDiff,
		focusProvider,
		hiddenCorrectionFocus,
		secondSemanticPass,
		secondFinal,
		secondHidden,
		finalCleanup,
	] = facts.slice(14);
	return (
		hiddenCorrectionProvider?.result.effectKind === "provider-request" &&
		hiddenCorrectionProvider.result.status === "tool-intents" &&
		hiddenCorrectionProvider.request.completionContext?.reason === "hidden-verifier-failed" &&
		succeededTool(hiddenCorrectionMutation, "replace-exact") &&
		diffProvider?.result.effectKind === "provider-request" &&
		diffProvider.result.status === "tool-intents" &&
		diffProvider.request.completionContext?.reason === "objective-phase-advanced" &&
		succeededTool(hiddenCorrectionDiff, "workspace-diff") &&
		hiddenCorrectionDiff?.result.effectKind === "tool-action" &&
		hiddenCorrectionDiff.result.nonEmptyDiff === true &&
		focusProvider?.result.effectKind === "provider-request" &&
		focusProvider.result.status === "tool-intents" &&
		focusProvider.request.completionContext?.reason === "objective-phase-advanced" &&
		succeededTool(hiddenCorrectionFocus, "focused-validation") &&
		secondSemanticPass?.result.effectKind === "public-semantic-validation" &&
		secondSemanticPass.result.status === "passed" &&
		secondFinal?.result.effectKind === "provider-request" &&
		secondFinal.result.status === "structured-final" &&
		secondHidden?.result.effectKind === "hidden-verifier" &&
		secondHidden.result.status === "failed" &&
		finalCleanup?.result.effectKind === "cleanup" &&
		finalCleanup.result.status === "succeeded"
	);
}

function isCleanNonqualifyingRun(
	run: EffectRun,
	exposureBound: (fact: AdmittedFact) => boolean,
): boolean {
	if (run.runtimeStatus !== "complete") return false;
	const facts = admitted(run);
	const [materialization, initialProvider, boundedContinuation, cleanup] = facts;
	return (
		facts.length === 4 &&
		materialization?.result.effectKind === "materialization" &&
		materialization.result.status === "ready" &&
		initialProvider?.result.effectKind === "provider-request" &&
		initialProvider.result.status === "structured-final" &&
		initialProvider.request.completionContext === undefined &&
		exposureBound(initialProvider) &&
		boundedContinuation?.result.effectKind === "provider-request" &&
		boundedContinuation.result.status === "structured-final" &&
		boundedContinuation.request.completionContext !== undefined &&
		exposureBound(boundedContinuation) &&
		cleanup?.result.effectKind === "cleanup" &&
		cleanup.result.status === "succeeded"
	);
}

export interface D771ArmAwarePositiveGateV1 {
	readonly projectionRevision: typeof D771_ARM_AWARE_GATE_PROJECTION_REVISION;
	readonly gateDefinitionDigest: string;
	readonly passed: boolean;
	readonly failureCodes: readonly string[];
	readonly qualifyingRunByArm: Readonly<Record<(typeof ARMS)[number], number | null>>;
	readonly projectionDigest: string;
}

export function evaluateD771ArmAwarePositiveGate(
	graph: D771CanonicalGraphEvidenceV1,
	routeEvidence: D771LoweringGraphEvidenceV1,
): D771ArmAwarePositiveGateV1 {
	const failures: string[] = [];
	const factsByRequest = new Map(
		graph.ledger.facts.map((fact) => [fact.issuedRequestDigest, fact] as const),
	);
	const runsByRequest = new Map(
		graph.effectRuns.map((run) => [run.issuedRequestDigest, run] as const),
	);
	const routeFactsByRequest = new Map(
		routeEvidence.facts
			.filter((fact) => fact.graphEvidenceDigest === graph.evidenceDigest)
			.map((fact) => [fact.requestDigest, fact] as const),
	);
	const exposureBound = (arm: (typeof ARMS)[number], fact: AdmittedFact) => {
		const routeFact = routeFactsByRequest.get(fact.request.requestDigest);
		const expected = deriveD771ModelExposure(arm, fact.request);
		return (
			routeFact !== undefined &&
			routeFact.exposureEvidenceDigest === expected.evidenceDigest &&
			routeFact.conversationDigest === expected.conversationDigest &&
			routeFact.modelVisibleMessagesDigest === expected.modelVisibleMessagesDigest
		);
	};
	if (
		factsByRequest.size !== graph.ledger.facts.length ||
		runsByRequest.size !== graph.effectRuns.length ||
		factsByRequest.size !== runsByRequest.size ||
		[...factsByRequest.keys()].some((key) => !runsByRequest.has(key))
	)
		failures.push("run-ledger-bijection-failed");
	if (graph.ledger.sourceDigest !== D771_QUALIFICATION_SOURCE_DIGEST)
		failures.push("qualification-source-provenance-failed");
	if (
		graph.runStatus !== "complete" ||
		graph.ledger.runStatus !== "complete" ||
		graph.ledger.completedArms.join(",") !== ARMS.join(",") ||
		graph.ledger.maxActiveArms !== 1
	)
		failures.push("six-arm-horizon-not-complete");
	const qualifyingRunByArm = Object.fromEntries(ARMS.map((arm) => [arm, null])) as Record<
		(typeof ARMS)[number],
		number | null
	>;
	for (const [armIndex, arm] of ARMS.entries()) {
		const ledgerRuns = graph.ledger.facts.filter((fact) => fact.arm === arm);
		if (
			ledgerRuns.length < 1 ||
			ledgerRuns.length > 2 ||
			ledgerRuns[0]?.runKind !== "primary" ||
			(ledgerRuns.length === 2 && ledgerRuns[1]?.runKind !== "recovery") ||
			ledgerRuns.some((fact) => fact.cleanup.status !== "succeeded")
		) {
			failures.push(`${arm}:run-shape-invalid`);
			continue;
		}
		const runs = ledgerRuns.flatMap((fact) => {
			const run = runsByRequest.get(fact.issuedRequestDigest);
			return run === undefined ? [] : [run];
		});
		const qualifying = runs.filter((run) =>
			isQualifyingLifecycle(run, EXPECTED_HIDDEN[armIndex]!, (fact) => exposureBound(arm, fact)),
		);
		if (qualifying.length !== 1) {
			failures.push(`${arm}:required-differential-not-observed`);
			continue;
		}
		const qualifyingRun = qualifying[0]!;
		qualifyingRunByArm[arm] = qualifyingRun.runSequence;
		if (
			runs.some(
				(run) =>
					run !== qualifyingRun &&
					!isCleanNonqualifyingRun(run, (fact) => exposureBound(arm, fact)),
			)
		)
			failures.push(`${arm}:nonqualifying-run-not-clean`);
	}
	if (
		graph.ledger.effectAdmissions.filter((value) => value.admitted).length !==
		graph.ledger.effectReconciliations.length
	)
		failures.push("accounting-not-exact");
	const material = strictSnapshot({
		projectionRevision: D771_ARM_AWARE_GATE_PROJECTION_REVISION,
		gateDefinitionDigest: D761_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
		passed: failures.length === 0,
		failureCodes: Object.freeze(failures),
		qualifyingRunByArm: Object.freeze(qualifyingRunByArm),
	});
	return Object.freeze({ ...material, projectionDigest: empiricalStrictJsonDigest(material) });
}
