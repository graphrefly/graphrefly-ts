import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D761_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST } from "./d761-public-semantic-validation-qualification.js";
import { deriveD771ModelExposure } from "./d771-arm-aware-positive-gate.js";
import type { D771CanonicalGraphEvidenceV1 } from "./d771-graph-completion-memory-insight.js";
import type { D774RouteEvidenceV1 } from "./d774-provider-result-route-authority.js";

export const D775_ARM_AWARE_GATE_PROJECTION_REVISION =
	"graphrefly.b112.d775.arm-aware-positive-gate-projection.v1" as const;

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

export interface D775ArmAwarePositiveGateV1 {
	readonly projectionRevision: typeof D775_ARM_AWARE_GATE_PROJECTION_REVISION;
	readonly gateDefinitionDigest: string;
	readonly passed: boolean;
	readonly failureCodes: readonly string[];
	readonly qualifyingRunByArm: Readonly<Record<(typeof ARMS)[number], number | null>>;
	readonly projectionDigest: string;
}

export function evaluateD775ArmAwarePositiveGate(
	graph: D771CanonicalGraphEvidenceV1,
	routeEvidence: D774RouteEvidenceV1,
	expectedSourceDigest: string,
): D775ArmAwarePositiveGateV1 {
	const failures: string[] = [];
	const factsByRequest = new Map(
		graph.ledger.facts.map((fact) => [fact.issuedRequestDigest, fact] as const),
	);
	const runsByRequest = new Map(
		graph.effectRuns.map((run) => [run.issuedRequestDigest, run] as const),
	);
	const routeFactsByRequest = new Map(
		routeEvidence.facts.map((fact) => [fact.requestDigest, fact] as const),
	);
	const exposureBound = (_arm: (typeof ARMS)[number], fact: AdmittedFact) => {
		const routeFact = routeFactsByRequest.get(fact.request.requestDigest);
		return routeFact !== undefined;
	};
	if (
		factsByRequest.size !== graph.ledger.facts.length ||
		runsByRequest.size !== graph.effectRuns.length ||
		factsByRequest.size !== runsByRequest.size ||
		[...factsByRequest.keys()].some((key) => !runsByRequest.has(key))
	)
		failures.push("run-ledger-bijection-failed");
	if (graph.ledger.sourceDigest !== expectedSourceDigest)
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
		const initialProvider = admitted(qualifyingRun).find(
			(fact) =>
				fact.result.effectKind === "provider-request" &&
				fact.request.completionContext === undefined,
		);
		const initialRoute =
			initialProvider === undefined
				? undefined
				: routeFactsByRequest.get(initialProvider.request.requestDigest);
		if (
			initialProvider === undefined ||
			initialRoute?.modelVisibleMessagesDigest !==
				deriveD771ModelExposure(arm, initialProvider.request).modelVisibleMessagesDigest
		)
			failures.push(`${arm}:model-exposure-not-bound`);
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
		projectionRevision: D775_ARM_AWARE_GATE_PROJECTION_REVISION,
		gateDefinitionDigest: D761_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
		passed: failures.length === 0,
		failureCodes: Object.freeze(failures),
		qualifyingRunByArm: Object.freeze(qualifyingRunByArm),
	});
	return Object.freeze({ ...material, projectionDigest: empiricalStrictJsonDigest(material) });
}
