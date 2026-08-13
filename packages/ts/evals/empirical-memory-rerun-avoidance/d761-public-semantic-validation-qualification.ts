import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm, rmdir } from "node:fs/promises";
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
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import { validateD760LiveBundle } from "./d760-graph-native-live.js";
import {
	type D722CanonicalGraphEvidenceV1,
	deriveD722CanonicalGraphEvidence,
} from "./d761-graph-completion-memory-insight.js";
import {
	createD761GraphPublicSemanticValidationPolicy,
	D761_CRITERION_FAILURE_CONTEXT_SCHEMA,
	D761_PUBLIC_SEMANTIC_VALIDATION_POLICY_REVISION,
	type D761PublicCriterionFailureCodeV1,
} from "./d761-graph-native-effect-runtime.js";
import {
	createD720SimulatedCallerExecutor,
	runD722GraphNativeEvalCore,
} from "./d761-graph-native-eval.js";
import {
	D761_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD761Implementation,
} from "./d761-implementation-manifest.js";

export const D761_DECISION_REF = "decision.D761" as const;
export const D761_DECISION_REVISION = "2026-08-12.v1" as const;
export const D761_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d761.public-semantic-validation-qualification.v1" as const;
export const D761_GENERATION_SCHEMA =
	"graphrefly.b112.d761.public-semantic-validation-generation.v1" as const;
export const D761_BUNDLE_SCHEMA =
	"graphrefly.b112.d761.public-semantic-validation-bundle.v1" as const;
export const D761_GENERATION_REF = "d761-public-semantic-validation-no-network-v6" as const;
export const D761_TEST_GENERATION_REF = "d761-public-semantic-validation-injected-test-v1" as const;
export const D761_PERSISTENCE_SCHEMA =
	"graphrefly.b112.d761.public-semantic-validation-persistence.v1" as const;
export const D761_D760_BUNDLE_ARTIFACT_SHA256 =
	"sha256:873781f630d57fb1691226bf7aaf3ffc7a5298c00f964cb976300d87db7742c3" as const;
export const D761_D760_BUNDLE_DIGEST =
	"sha256:85c074e83b8b6ee7a2c3d0b8264ddff5e3a7da8f3dbb5c95f2525d70bb4ebf93" as const;
export const D761_D760_GRAPH_EVIDENCE_DIGEST =
	"sha256:baaf9f2e242e69fb7bc138101275e8b568da767ea541a388f12aa0cb3d7d0d96" as const;
export const D761_D760_CLAIM_DIGEST =
	"sha256:c14f2323183eb7729e0ee1e88a36f2559986287098b04e8e48b7886cc9ef4964" as const;

const LIMITS = Object.freeze({
	maxRequests: 128,
	maxRetryWaits: 12,
	maxCostMicrousd: 6_000_000,
	maxElapsedMs: 7_200_000,
});
const CEILINGS = Object.freeze({
	routeDigest: empiricalStrictJsonDigest({ route: "d761-injected-no-network" }),
	providerMaxCostMicrousd: 10,
	providerMaxElapsedMs: 1_000,
	localEffectMaxElapsedMs: 1_000,
});
const CRITERION_FAILURE: D761PublicCriterionFailureCodeV1 = "canonical-provenance-not-admitted";

export interface D761PublicSemanticValidationBundleV1 {
	readonly schemaVersion: typeof D761_BUNDLE_SCHEMA;
	readonly executionClass: "simulated-contract";
	readonly graphEvidence: D722CanonicalGraphEvidenceV1;
	readonly repeatedFailureGraphEvidence: D722CanonicalGraphEvidenceV1;
	readonly executorFailureGraphEvidence: D722CanonicalGraphEvidenceV1;
	readonly insufficientHeadroomGraphEvidence: D722CanonicalGraphEvidenceV1;
	readonly wrongToolGraphEvidence: D722CanonicalGraphEvidenceV1;
	readonly hiddenFailureHeadroomGraphEvidence: D722CanonicalGraphEvidenceV1;
	readonly qualification: Readonly<Record<string, unknown>>;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly bundleDigest: string;
}

export interface D761PersistenceReceiptV1 {
	readonly schemaVersion: typeof D761_PERSISTENCE_SCHEMA;
	readonly generationRef: typeof D761_GENERATION_REF | typeof D761_TEST_GENERATION_REF;
	readonly bundleArtifactDigest: string;
	readonly bundleDigest: string;
	readonly persistenceDigest: string;
}

export interface D761PersistenceFaultV1 {
	readonly revision: "graphrefly.b112.d761.persistence-fault.v1";
}

export const D761_POSITIVE_DIFFERENTIAL_GATE_DEFINITION = strictSnapshot({
	revision: "graphrefly.b112.d761.positive-differential-gate.v1",
	baseline: {
		d760BundleArtifactSha256: D761_D760_BUNDLE_ARTIFACT_SHA256,
		d760BundleDigest: D761_D760_BUNDLE_DIGEST,
		d760GraphEvidenceDigest: D761_D760_GRAPH_EVIDENCE_DIGEST,
		d760ClaimDigest: D761_D760_CLAIM_DIGEST,
	},
	evidenceRule: "derive-every-outcome-from-one-validated-canonical-six-arm-graph-bundle",
	armOrder: "exact-frozen-six-arm-order",
	armHorizon: "cold-plus-five-warm-all-attempted",
	stopping: "frozen-d760-budget-retry-cleanup-stopping",
	recovery: "exactly-one-graph-admitted-public-criterion-correction-per-run",
	arms: [
		"cold",
		"relevant-applied",
		"proposal-only",
		"admission-rejected",
		"irrelevant-applied",
		"wrong-scope-applied",
	],
	requiredMemoryExposure: {
		cold: "none",
		"relevant-applied": "relevant-admitted",
		"proposal-only": "proposal-only",
		"admission-rejected": "admission-rejected",
		"irrelevant-applied": "irrelevant-admitted",
		"wrong-scope-applied": "wrong-scope-admitted",
	},
	requiredHiddenVerifierDisposition: {
		cold: "failed",
		"relevant-applied": "passed",
		"proposal-only": "failed",
		"admission-rejected": "failed",
		"irrelevant-applied": "failed",
		"wrong-scope-applied": "failed",
	},
	requiredForEveryArm: [
		"evaluable",
		"public-semantic-validation-passed",
		"exact-accounting",
		"cleanup-passed",
		"provenance-bound",
		"zero-executor-transport-http-failures",
	],
});
export const D761_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST = empiricalStrictJsonDigest(
	D761_POSITIVE_DIFFERENTIAL_GATE_DEFINITION,
);

export interface D761ConsumedD760BaselineV1 {
	readonly revision: "graphrefly.b112.d761.consumed-d760-baseline.v1";
}
export interface D761InjectedBaselineForTestV1 {
	readonly revision: "graphrefly.b112.d761.injected-baseline-for-test.v1";
}

interface D761PublicAcceptanceProjectionV1 {
	readonly canonicalProvenanceAdmitted: boolean;
	readonly malformedProvenanceRejected: boolean;
	readonly localReconstructionRejected: boolean;
	readonly authorizationInvariantPreserved: boolean;
}

const constructedBundles = new WeakMap<object, "exact-private-bytes" | "injected-test">();
const constructedHistoricalBaselines = new WeakMap<
	object,
	Readonly<Record<string, string>> & { readonly basis: "exact-private-bytes" | "injected-test" }
>();
const constructedPersistenceFaults = new WeakMap<
	object,
	{ readonly stage: "after-write" | "after-claim" | "after-commit"; consumed: boolean }
>();

export function createD761PersistenceFaultForTest(
	stage: "after-write" | "after-claim" | "after-commit",
): D761PersistenceFaultV1 {
	if (!(["after-write", "after-claim", "after-commit"] as const).includes(stage))
		throw new TypeError("D761 persistence fault stage is invalid");
	const capability = Object.freeze({
		revision: "graphrefly.b112.d761.persistence-fault.v1" as const,
	});
	constructedPersistenceFaults.set(capability, { stage, consumed: false });
	return capability;
}

function consumePersistenceFault(value: unknown) {
	if (value === undefined) return null;
	if (typeof value !== "object" || value === null)
		throw new TypeError("D761 persistence fault is invalid");
	const state = constructedPersistenceFaults.get(value);
	if (state === undefined || state.consumed)
		throw new TypeError("D761 persistence fault is forged or replayed");
	state.consumed = true;
	return state.stage;
}

function sha(value: unknown): string {
	return empiricalStrictJsonDigest(value);
}

export function admitD761ConsumedD760Baseline(bytesValue: Uint8Array): D761ConsumedD760BaselineV1 {
	if (!(bytesValue instanceof Uint8Array))
		throw new TypeError("D761 D760 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D761_D760_BUNDLE_ARTIFACT_SHA256)
		throw new TypeError("D761 consumed D760 artifact bytes drifted");
	const baseline = validateD760LiveBundle(strictJsonCodec.decode(bytes));
	const claimDigest = digest(baseline.terminalReceipt.claimDigest, "d761.consumedD760.claimDigest");
	if (
		baseline.bundleDigest !== D761_D760_BUNDLE_DIGEST ||
		baseline.graphEvidence.evidenceDigest !== D761_D760_GRAPH_EVIDENCE_DIGEST ||
		claimDigest !== D761_D760_CLAIM_DIGEST
	)
		throw new TypeError("D761 consumed D760 canonical coordinates drifted");
	const capability = Object.freeze({
		revision: "graphrefly.b112.d761.consumed-d760-baseline.v1" as const,
	});
	constructedHistoricalBaselines.set(
		capability,
		Object.freeze({
			basis: "exact-private-bytes" as const,
			artifactSha256: D761_D760_BUNDLE_ARTIFACT_SHA256,
			bundleDigest: baseline.bundleDigest,
			graphEvidenceDigest: baseline.graphEvidence.evidenceDigest,
			claimDigest,
		}),
	);
	return capability;
}

export function createD761InjectedBaselineForTest(): D761InjectedBaselineForTestV1 {
	const capability = Object.freeze({
		revision: "graphrefly.b112.d761.injected-baseline-for-test.v1" as const,
	});
	constructedHistoricalBaselines.set(
		capability,
		Object.freeze({
			basis: "injected-test" as const,
			artifactSha256: D761_D760_BUNDLE_ARTIFACT_SHA256,
			bundleDigest: D761_D760_BUNDLE_DIGEST,
			graphEvidenceDigest: D761_D760_GRAPH_EVIDENCE_DIGEST,
			claimDigest: D761_D760_CLAIM_DIGEST,
		}),
	);
	return capability;
}

function consumeD761Baseline(value: unknown) {
	if (typeof value !== "object" || value === null)
		throw new TypeError("D761 consumed D760 baseline capability is invalid");
	const coordinates = constructedHistoricalBaselines.get(value);
	if (coordinates === undefined)
		throw new TypeError("D761 consumed D760 baseline capability is forged or replayed");
	constructedHistoricalBaselines.delete(value);
	return coordinates;
}

export function evaluateD761PublicAcceptanceProjection(
	value: unknown,
): readonly D761PublicCriterionFailureCodeV1[] {
	const candidate = record(value, "d761.publicAcceptanceProjection");
	exactKeys(
		candidate,
		[
			"authorizationInvariantPreserved",
			"canonicalProvenanceAdmitted",
			"localReconstructionRejected",
			"malformedProvenanceRejected",
		],
		"d761.publicAcceptanceProjection",
	);
	for (const key of Object.keys(candidate))
		if (typeof candidate[key] !== "boolean")
			throw new TypeError(`D761 public acceptance projection ${key} is invalid`);
	const failures: D761PublicCriterionFailureCodeV1[] = [];
	if (candidate.canonicalProvenanceAdmitted !== true)
		failures.push("canonical-provenance-not-admitted");
	if (candidate.malformedProvenanceRejected !== true)
		failures.push("malformed-provenance-not-rejected");
	if (candidate.localReconstructionRejected !== true)
		failures.push("local-reconstruction-not-rejected");
	if (candidate.authorizationInvariantPreserved !== true)
		failures.push("authorization-invariant-regressed");
	return Object.freeze(failures);
}

function toolForPhase(phase: string) {
	if (phase === "inspection") return "read-file" as const;
	if (phase === "exact-mutation") return "replace-exact" as const;
	if (phase === "workspace-diff") return "workspace-diff" as const;
	if (phase === "focused-validation") return "focused-validation" as const;
	throw new TypeError("D761 model fixture received a non-tool phase");
}

function deriveMechanismCounts(graph: D722CanonicalGraphEvidenceV1) {
	let providerRequestCount = 0;
	let semanticValidationCount = 0;
	let criterionFailureContinuationCount = 0;
	for (const run of graph.effectRuns) {
		const admitted = run.facts.filter((fact) => fact.kind === "graph-effect-result-admitted");
		const semantics = admitted.filter(
			(fact) => fact.result.effectKind === "public-semantic-validation",
		);
		providerRequestCount += admitted.filter(
			(fact) => fact.result.effectKind === "provider-request",
		).length;
		semanticValidationCount += semantics.length;
		const criterionContexts = admitted.flatMap((fact) =>
			fact.request.completionContext?.reason === "public-semantic-validation-failed"
				? [fact.request.completionContext]
				: [],
		);
		criterionFailureContinuationCount += new Set(
			criterionContexts.map((context) => context.contextDigest),
		).size;
		const hiddenIndex = admitted.findIndex((fact) => fact.result.effectKind === "hidden-verifier");
		const passedSemanticIndex = admitted.findIndex(
			(fact) =>
				fact.result.effectKind === "public-semantic-validation" && fact.result.status === "passed",
		);
		if (hiddenIndex >= 0 && (passedSemanticIndex < 0 || hiddenIndex < passedSemanticIndex))
			throw new TypeError("D761 hidden verifier was not independent of public semantic admission");
		for (const context of criterionContexts) {
			if (
				context.schemaVersion !== D761_CRITERION_FAILURE_CONTEXT_SCHEMA ||
				context.nextRequiredPhase !== "exact-mutation" ||
				context.requiredDisposition !== "tool-intents" ||
				context.criterionFailures === undefined ||
				context.criterionFailures.length < 1
			)
				throw new TypeError("D761 criterion continuation coordinates drifted");
			const contextIndex = admitted.findIndex(
				(fact) => fact.request.completionContext?.contextDigest === context.contextDigest,
			);
			const firstTool = admitted
				.slice(contextIndex + 1)
				.find((fact) => fact.result.effectKind === "tool-action");
			if (
				firstTool?.result.effectKind !== "tool-action" ||
				firstTool.result.toolRef !== "replace-exact"
			)
				throw new TypeError("D761 criterion continuation did not admit exact mutation first");
		}
	}
	return Object.freeze({
		providerRequestCount,
		semanticValidationCount,
		criterionFailureContinuationCount,
	});
}

function assertD761MainGraphMechanism(graph: D722CanonicalGraphEvidenceV1): void {
	const expectedArms = [
		"cold",
		"relevant-applied",
		"proposal-only",
		"admission-rejected",
		"irrelevant-applied",
		"wrong-scope-applied",
	];
	if (
		graph.runStatus !== "complete" ||
		graph.effectRuns.length !== 6 ||
		graph.ledger.completedArms.join(",") !== expectedArms.join(",")
	)
		throw new TypeError("D761 main six-arm Graph lifecycle drifted");
	for (const [runSequence, run] of graph.effectRuns.entries()) {
		if (run.runSequence !== runSequence || run.runtimeStatus !== "complete")
			throw new TypeError("D761 main Graph run identity drifted");
		const admitted = run.facts.filter((fact) => fact.kind === "graph-effect-result-admitted");
		const semantic = admitted.filter(
			(fact) => fact.result.effectKind === "public-semantic-validation",
		);
		const hidden = admitted.filter((fact) => fact.result.effectKind === "hidden-verifier");
		const cleanup = admitted.filter((fact) => fact.result.effectKind === "cleanup");
		const contexts = new Map(
			admitted.flatMap((fact) =>
				fact.request.completionContext?.reason === "public-semantic-validation-failed"
					? [
							[
								fact.request.completionContext.contextDigest,
								fact.request.completionContext,
							] as const,
						]
					: [],
			),
		);
		if (
			semantic.length !== 2 ||
			semantic[0]?.result.effectKind !== "public-semantic-validation" ||
			semantic[0].result.status !== "failed" ||
			semantic[1]?.result.effectKind !== "public-semantic-validation" ||
			semantic[1].result.status !== "passed" ||
			contexts.size !== 1 ||
			hidden.length !== 1 ||
			hidden[0]?.result.effectKind !== "hidden-verifier" ||
			hidden[0].result.status !== "passed" ||
			cleanup.length !== 1 ||
			cleanup[0]?.result.effectKind !== "cleanup" ||
			cleanup[0].result.status !== "succeeded"
		)
			throw new TypeError("D761 main public-semantic lifecycle drifted");
		const failedIndex = admitted.indexOf(semantic[0]);
		const passedIndex = admitted.indexOf(semantic[1]);
		const hiddenIndex = admitted.indexOf(hidden[0]);
		const correctionMutationIndex = admitted.findIndex(
			(fact, index) =>
				index > failedIndex &&
				fact.result.effectKind === "tool-action" &&
				fact.result.toolRef === "replace-exact",
		);
		const correctionDiffIndex = admitted.findIndex(
			(fact, index) =>
				index > correctionMutationIndex &&
				fact.result.effectKind === "tool-action" &&
				fact.result.toolRef === "workspace-diff" &&
				fact.result.nonEmptyDiff,
		);
		const correctionValidationIndex = admitted.findIndex(
			(fact, index) =>
				index > correctionDiffIndex &&
				fact.result.effectKind === "tool-action" &&
				fact.result.toolRef === "focused-validation" &&
				fact.result.status === "succeeded",
		);
		if (
			correctionMutationIndex < 0 ||
			correctionDiffIndex < 0 ||
			correctionValidationIndex < 0 ||
			passedIndex <= correctionValidationIndex ||
			hiddenIndex <= passedIndex
		)
			throw new TypeError("D761 corrected objective phase ordering drifted");
	}
}

function everyD761RunCleaned(graph: D722CanonicalGraphEvidenceV1): boolean {
	return graph.effectRuns.every((run) =>
		run.facts.some(
			(fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.result.effectKind === "cleanup" &&
				fact.result.status === "succeeded",
		),
	);
}

function assertD761WrongToolRejected(graph: D722CanonicalGraphEvidenceV1): void {
	if (
		graph.runStatus !== "complete" ||
		graph.effectRuns.length !== 7 ||
		graph.ledger.completedArms.length !== 6
	)
		throw new TypeError("D761 wrong-tool Graph lifecycle drifted");
	const run = graph.effectRuns[0];
	if (run?.runtimeStatus !== "complete") throw new TypeError("D761 wrong-tool run status drifted");
	const admitted = run.facts.filter((fact) => fact.kind === "graph-effect-result-admitted");
	const semanticFailed = admitted.filter(
		(fact) =>
			fact.result.effectKind === "public-semantic-validation" && fact.result.status === "failed",
	);
	const wrongResponse = admitted.filter(
		(fact) =>
			fact.result.effectKind === "provider-request" &&
			fact.request.completionContext?.reason === "public-semantic-validation-failed" &&
			fact.result.status === "tool-intents" &&
			fact.result.toolIntents[0]?.toolRef === "read-file",
	);
	const correctionTools = admitted.filter(
		(fact) =>
			fact.result.effectKind === "tool-action" &&
			fact.request.completionContext?.reason === "public-semantic-validation-failed",
	);
	const cleanup = admitted.filter(
		(fact) => fact.result.effectKind === "cleanup" && fact.result.status === "succeeded",
	);
	if (
		semanticFailed.length !== 1 ||
		wrongResponse.length !== 1 ||
		correctionTools.length !== 0 ||
		cleanup.length !== 1
	)
		throw new TypeError("D761 wrong-first-tool rejection evidence drifted");
}

function assertD761HeadroomDenied(
	graph: D722CanonicalGraphEvidenceV1,
	effectKind: "public-semantic-validation" | "hidden-verifier",
): void {
	const contextReason =
		effectKind === "public-semantic-validation"
			? "public-semantic-validation-failed"
			: "hidden-verifier-failed";
	if (graph.completionContexts.some((context) => context.reason === contextReason))
		throw new TypeError("D761 insufficient headroom changed the model information set");
	const matchingRuns = graph.effectRuns.filter((run) =>
		run.facts.some(
			(fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.result.effectKind === effectKind &&
				fact.result.status === "failed",
		),
	);
	if (matchingRuns.length < 1)
		throw new TypeError("D761 insufficient-headroom failure evidence drifted");
	for (const run of matchingRuns) {
		const admitted = run.facts.filter((fact) => fact.kind === "graph-effect-result-admitted");
		const failedIndex = admitted.findIndex(
			(fact) => fact.result.effectKind === effectKind && fact.result.status === "failed",
		);
		const cleanup = admitted[failedIndex + 1];
		const elapsedAtFailure =
			run.budgetContext.initialState.elapsedMs +
			admitted.slice(0, failedIndex + 1).reduce((sum, fact) => sum + fact.actualElapsedMs, 0);
		const requiredRecoveryElapsed =
			run.budgetContext.providerMaxElapsedMs * 4 +
			(run.budgetContext.localEffectMaxElapsedMs ?? 0) * 6;
		if (
			failedIndex < 0 ||
			cleanup?.result.effectKind !== "cleanup" ||
			cleanup.result.status !== "succeeded" ||
			run.budgetContext.limits.maxElapsedMs - elapsedAtFailure >= requiredRecoveryElapsed
		)
			throw new TypeError("D761 insufficient-headroom arithmetic or cleanup drifted");
	}
}

async function runCase(
	label: string,
	options: {
		readonly failSemanticTwice?: boolean;
		readonly throwSemanticOnce?: boolean;
		readonly wrongCorrectionTool?: boolean;
		readonly failHiddenVerifier?: boolean;
		readonly budgetLimits?: {
			readonly maxRequests: number;
			readonly maxRetryWaits: number;
			readonly maxCostMicrousd: number;
			readonly maxElapsedMs: number;
		};
	} = {},
) {
	const workspaces = new Map<number, string>();
	const publicAcceptance = new Map<number, D761PublicAcceptanceProjectionV1>();
	const correctionAuthorized = new Set<number>();
	const semanticPassed = new Set<number>();
	let active = 0;
	let maxActive = 0;
	let providerCalls = 0;
	let semanticCalls = 0;
	const executor = createD720SimulatedCallerExecutor(async ({ effectRequest }) => {
		active += 1;
		maxActive = Math.max(maxActive, active);
		if (active !== 1) throw new TypeError("D761 observed parallel effects");
		try {
			if (effectRequest.effectKind === "materialization") {
				const workspace = sha({ label, runSequence: effectRequest.runSequence, workspace: 0 });
				workspaces.set(effectRequest.runSequence, workspace);
				publicAcceptance.set(effectRequest.runSequence, {
					canonicalProvenanceAdmitted: false,
					malformedProvenanceRejected: true,
					localReconstructionRejected: true,
					authorizationInvariantPreserved: true,
				});
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "materialization" as const,
						status: "ready" as const,
						workspaceStateDigest: workspace,
						evidenceDigest: sha({ label, materialization: effectRequest.runSequence }),
					},
				};
			}
			if (effectRequest.effectKind === "provider-request") {
				providerCalls += 1;
				const workspace = workspaces.get(effectRequest.runSequence);
				if (workspace === undefined) throw new TypeError("D761 provider workspace is missing");
				if (semanticPassed.has(effectRequest.runSequence)) {
					return {
						actualCostMicrousd: 1,
						actualElapsedMs: 1,
						result: {
							effectKind: "provider-request" as const,
							status: "structured-final" as const,
							toolIntents: Object.freeze([]),
							failureDiscriminator: "none" as const,
							retryAfterMs: null,
							workspaceStateDigest: workspace,
							evidenceDigest: sha({ label, final: effectRequest.requestDigest }),
						},
					};
				}
				const toolRef =
					effectRequest.completionContext === undefined
						? "read-file"
						: options.wrongCorrectionTool === true &&
								effectRequest.runSequence === 0 &&
								effectRequest.completionContext.reason === "public-semantic-validation-failed"
							? "read-file"
							: toolForPhase(effectRequest.completionContext.nextRequiredPhase);
				if (effectRequest.completionContext?.reason === "public-semantic-validation-failed")
					correctionAuthorized.add(effectRequest.runSequence);
				return {
					actualCostMicrousd: 1,
					actualElapsedMs: 1,
					result: {
						effectKind: "provider-request" as const,
						status: "tool-intents" as const,
						toolIntents: Object.freeze([
							Object.freeze({
								toolRef,
								intentDigest: sha({ label, toolRef, request: effectRequest.requestDigest }),
							}),
						]),
						failureDiscriminator: "none" as const,
						retryAfterMs: null,
						workspaceStateDigest: workspace,
						evidenceDigest: sha({ label, tools: effectRequest.requestDigest }),
					},
				};
			}
			if (effectRequest.effectKind === "retry-wait")
				throw new TypeError("D761 injected qualification did not authorize retry");
			if (effectRequest.effectKind === "tool-action") {
				const intent = effectRequest.toolIntent;
				const before = workspaces.get(effectRequest.runSequence);
				if (intent === null || before === undefined)
					throw new TypeError("D761 tool state is missing");
				const after =
					intent.toolRef === "replace-exact"
						? sha({ before, mutation: intent.intentDigest })
						: before;
				workspaces.set(effectRequest.runSequence, after);
				if (
					intent.toolRef === "replace-exact" &&
					correctionAuthorized.has(effectRequest.runSequence)
				) {
					correctionAuthorized.delete(effectRequest.runSequence);
					if (!(options.failSemanticTwice === true && effectRequest.runSequence === 0))
						publicAcceptance.set(effectRequest.runSequence, {
							canonicalProvenanceAdmitted: true,
							malformedProvenanceRejected: true,
							localReconstructionRejected: true,
							authorizationInvariantPreserved: true,
						});
				}
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "tool-action" as const,
						toolRef: intent.toolRef,
						intentDigest: intent.intentDigest,
						status: "succeeded" as const,
						nonEmptyDiff: intent.toolRef === "workspace-diff",
						workspaceStateBeforeDigest: before,
						workspaceStateAfterDigest: after,
						evidenceDigest: sha({ label, tool: intent.intentDigest }),
					},
				};
			}
			if (effectRequest.effectKind === "public-semantic-validation") {
				semanticCalls += 1;
				const projection = publicAcceptance.get(effectRequest.runSequence);
				if (projection === undefined) throw new TypeError("D761 public projection is missing");
				const failures = evaluateD761PublicAcceptanceProjection(projection);
				if (
					options.throwSemanticOnce === true &&
					effectRequest.runSequence === 0 &&
					!semanticPassed.has(effectRequest.runSequence) &&
					failures.length > 0
				)
					throw new TypeError("D761 injected semantic executor failure");
				const failed = failures.length > 0;
				if (!failed) semanticPassed.add(effectRequest.runSequence);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "public-semantic-validation" as const,
						status: failed ? ("failed" as const) : ("passed" as const),
						criterionFailures: failures,
						workspaceStateDigest: workspaces.get(effectRequest.runSequence)!,
						evidenceDigest: sha({
							label,
							semantic: effectRequest.runSequence,
							projection,
							failures,
						}),
					},
				};
			}
			if (effectRequest.effectKind === "hidden-verifier") {
				const failed = options.failHiddenVerifier === true && effectRequest.runSequence === 0;
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "hidden-verifier" as const,
						status: failed ? ("failed" as const) : ("passed" as const),
						workspaceStateDigest: workspaces.get(effectRequest.runSequence)!,
						evidenceDigest: sha({ label, hidden: effectRequest.runSequence }),
					},
				};
			}
			workspaces.delete(effectRequest.runSequence);
			publicAcceptance.delete(effectRequest.runSequence);
			correctionAuthorized.delete(effectRequest.runSequence);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup" as const,
					status: "succeeded" as const,
					evidenceDigest: sha({ label, cleanup: effectRequest.runSequence }),
				},
			};
		} finally {
			active -= 1;
		}
	});
	const policy = createD761GraphPublicSemanticValidationPolicy();
	const core = await runD722GraphNativeEvalCore({
		sourceDigest: sha({ d761: label }),
		budgetLimits: options.budgetLimits ?? LIMITS,
		effectCeilings: CEILINGS,
		executor,
		objectivePhaseRecoveryPolicy: policy,
		signal: AbortSignal.timeout(30_000),
	});
	return Object.freeze({
		graph: deriveD722CanonicalGraphEvidence(core.ledger, core.effectRuns, undefined, policy),
		providerCalls,
		semanticCalls,
		maxActive,
		workspaceResidueCount: workspaces.size,
	});
}

export async function runD761InjectedNoNetworkQualification(
	baselineCapability: D761ConsumedD760BaselineV1 | D761InjectedBaselineForTestV1,
): Promise<D761PublicSemanticValidationBundleV1> {
	const baseline = consumeD761Baseline(baselineCapability);
	if ((await measureD761Implementation()) !== D761_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D761 implementation manifest validation failed");
	const main = await runCase("main");
	const repeatedFailure = await runCase("repeated-failure", { failSemanticTwice: true });
	const executorFailure = await runCase("executor-failure", { throwSemanticOnce: true });
	const insufficientHeadroom = await runCase("insufficient-headroom", {
		budgetLimits: Object.freeze({ ...LIMITS, maxElapsedMs: 6_000 }),
	});
	const wrongTool = await runCase("wrong-tool", { wrongCorrectionTool: true });
	const hiddenFailureHeadroom = await runCase("hidden-failure-headroom", {
		failHiddenVerifier: true,
		budgetLimits: Object.freeze({ ...LIMITS, maxElapsedMs: 10_015 }),
	});
	const contexts = main.graph.completionContexts.filter(
		(context) => context.reason === "public-semantic-validation-failed",
	);
	const semanticFacts = main.graph.effectRuns.flatMap((run) =>
		run.facts.filter(
			(fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.result.effectKind === "public-semantic-validation",
		),
	);
	const repeatedRunZeroContexts = repeatedFailure.graph.completionContexts.filter(
		(context) =>
			context.runSequence === 0 && context.reason === "public-semantic-validation-failed",
	);
	const repeatedRunZeroSemanticFacts = repeatedFailure.graph.effectRuns[0]?.facts.filter(
		(fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.result.effectKind === "public-semantic-validation",
	);
	const executorFailureContexts = executorFailure.graph.completionContexts.filter(
		(context) => context.reason === "public-semantic-validation-failed",
	);
	const executorFailureSemanticStatus = executorFailure.graph.effectRuns[0]?.facts.flatMap(
		(fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.result.effectKind === "public-semantic-validation"
				? [fact.result.status]
				: [],
	);
	const insufficientContexts = insufficientHeadroom.graph.completionContexts.filter(
		(context) => context.reason === "public-semantic-validation-failed",
	);
	const wrongToolRunZeroFacts = wrongTool.graph.effectRuns[0]?.facts.filter(
		(fact) => fact.kind === "graph-effect-result-admitted",
	);
	const hiddenFailureContexts = hiddenFailureHeadroom.graph.completionContexts.filter(
		(context) => context.reason === "hidden-verifier-failed",
	);
	assertD761MainGraphMechanism(main.graph);
	assertD761WrongToolRejected(wrongTool.graph);
	assertD761HeadroomDenied(insufficientHeadroom.graph, "public-semantic-validation");
	assertD761HeadroomDenied(hiddenFailureHeadroom.graph, "hidden-verifier");
	if (
		main.graph.runStatus !== "complete" ||
		main.graph.ledger.completedArms.length !== 6 ||
		main.graph.effectRuns.length !== 6 ||
		contexts.length !== 6 ||
		semanticFacts.length !== 12 ||
		main.semanticCalls !== 12 ||
		main.maxActive !== 1 ||
		main.workspaceResidueCount !== 0 ||
		!contexts.every(
			(context) =>
				context.schemaVersion === D761_CRITERION_FAILURE_CONTEXT_SCHEMA &&
				context.nextRequiredPhase === "exact-mutation" &&
				context.criterionFailures?.join(",") === CRITERION_FAILURE,
		) ||
		repeatedRunZeroContexts.length !== 1 ||
		repeatedRunZeroSemanticFacts?.length !== 2 ||
		repeatedFailure.workspaceResidueCount !== 0 ||
		executorFailure.graph.runStatus !== "stopped" ||
		executorFailureContexts.length !== 0 ||
		executorFailureSemanticStatus?.join(",") !== "executor-failed" ||
		!everyD761RunCleaned(executorFailure.graph) ||
		executorFailure.workspaceResidueCount !== 0 ||
		insufficientContexts.length !== 0 ||
		!everyD761RunCleaned(insufficientHeadroom.graph) ||
		insufficientHeadroom.workspaceResidueCount !== 0 ||
		wrongToolRunZeroFacts?.some(
			(fact) =>
				fact.result.effectKind === "tool-action" &&
				fact.result.toolRef === "read-file" &&
				fact.request.phaseBefore !== "none",
		) ||
		!everyD761RunCleaned(wrongTool.graph) ||
		hiddenFailureContexts.length !== 0 ||
		!everyD761RunCleaned(hiddenFailureHeadroom.graph)
	)
		throw new TypeError("D761 no-network qualification coverage failed");
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D761_QUALIFICATION_SCHEMA,
		decisionRef: D761_DECISION_REF,
		decisionRevision: D761_DECISION_REVISION,
		policyRevision: D761_PUBLIC_SEMANTIC_VALIDATION_POLICY_REVISION,
		contextSchema: D761_CRITERION_FAILURE_CONTEXT_SCHEMA,
		implementationManifestDigest: D761_IMPLEMENTATION_MANIFEST_DIGEST,
		d760BundleArtifactSha256: D761_D760_BUNDLE_ARTIFACT_SHA256,
		d760BundleDigest: baseline.bundleDigest,
		d760GraphEvidenceDigest: baseline.graphEvidenceDigest,
		d760ClaimDigest: baseline.claimDigest,
		baselineAdmissionBasis: baseline.basis,
		graphEvidenceDigest: main.graph.evidenceDigest,
		repeatedFailureGraphEvidenceDigest: repeatedFailure.graph.evidenceDigest,
		executorFailureGraphEvidenceDigest: executorFailure.graph.evidenceDigest,
		insufficientHeadroomGraphEvidenceDigest: insufficientHeadroom.graph.evidenceDigest,
		wrongToolGraphEvidenceDigest: wrongTool.graph.evidenceDigest,
		hiddenFailureHeadroomGraphEvidenceDigest: hiddenFailureHeadroom.graph.evidenceDigest,
		providerRequestCount: main.providerCalls,
		semanticValidationCount: main.semanticCalls,
		criterionFailureContinuationCount: contexts.length,
		maxActiveArms: main.graph.ledger.maxActiveArms,
		maxActiveEffects: main.maxActive,
		workspaceResidueCount: main.workspaceResidueCount,
		positiveDifferentialGateFrozen: true,
		positiveDifferentialGateDefinitionDigest: D761_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
		liveGateEvaluated: false,
		publicCriteriaOnly: true,
		hiddenVerifierIndependent: true,
		hiddenMaterialReferenced: false,
		providerNetworkCalls: 0,
		materialFree: true,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = strictSnapshot({
		...qualificationMaterial,
		qualificationDigest: sha(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: D761_GENERATION_SCHEMA,
		generationRef:
			baseline.basis === "exact-private-bytes" ? D761_GENERATION_REF : D761_TEST_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		implementationManifestDigest: D761_IMPLEMENTATION_MANIFEST_DIGEST,
		graphEvidenceDigest: main.graph.evidenceDigest,
		d760BundleArtifactSha256: D761_D760_BUNDLE_ARTIFACT_SHA256,
		d760BundleDigest: baseline.bundleDigest,
		d760GraphEvidenceDigest: baseline.graphEvidenceDigest,
		d760ClaimDigest: baseline.claimDigest,
		baselineAdmissionBasis: baseline.basis,
		providerNetworkCalls: 0,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: sha(generationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D761_BUNDLE_SCHEMA,
		executionClass: "simulated-contract" as const,
		graphEvidence: main.graph,
		repeatedFailureGraphEvidence: repeatedFailure.graph,
		executorFailureGraphEvidence: executorFailure.graph,
		insufficientHeadroomGraphEvidence: insufficientHeadroom.graph,
		wrongToolGraphEvidence: wrongTool.graph,
		hiddenFailureHeadroomGraphEvidence: hiddenFailureHeadroom.graph,
		qualification,
		generation,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const bundle = Object.freeze({ ...material, bundleDigest: sha(material) });
	if ((await measureD761Implementation()) !== D761_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D761 implementation changed during qualification");
	constructedBundles.set(bundle, baseline.basis);
	return bundle as unknown as D761PublicSemanticValidationBundleV1;
}

export function validateD761QualificationBundle(
	value: unknown,
): D761PublicSemanticValidationBundleV1 {
	const candidate = record(value, "d761.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"causalAttribution",
			"efficacyClaim",
			"executionClass",
			"executorFailureGraphEvidence",
			"generation",
			"graphEvidence",
			"hiddenFailureHeadroomGraphEvidence",
			"insufficientHeadroomGraphEvidence",
			"qualification",
			"repeatedFailureGraphEvidence",
			"schemaVersion",
			"wrongToolGraphEvidence",
		],
		"d761.bundle",
	);
	literal(candidate.schemaVersion, D761_BUNDLE_SCHEMA, "d761.bundle.schema");
	literal(candidate.executionClass, "simulated-contract", "d761.bundle.executionClass");
	literal(candidate.causalAttribution, "undetermined", "d761.bundle.attribution");
	literal(candidate.efficacyClaim, "none", "d761.bundle.efficacy");
	const policy = createD761GraphPublicSemanticValidationPolicy();
	const graph = record(candidate.graphEvidence, "d761.bundle.graphEvidence");
	const repeated = record(candidate.repeatedFailureGraphEvidence, "d761.bundle.repeatedFailure");
	const executorFailure = record(
		candidate.executorFailureGraphEvidence,
		"d761.bundle.executorFailure",
	);
	const insufficientHeadroom = record(
		candidate.insufficientHeadroomGraphEvidence,
		"d761.bundle.insufficientHeadroom",
	);
	const wrongTool = record(candidate.wrongToolGraphEvidence, "d761.bundle.wrongTool");
	const hiddenFailureHeadroom = record(
		candidate.hiddenFailureHeadroomGraphEvidence,
		"d761.bundle.hiddenFailureHeadroom",
	);
	const validatedGraph = deriveD722CanonicalGraphEvidence(
		graph.ledger,
		array(
			graph.effectRuns,
			"d761.bundle.graphEvidence.effectRuns",
		) as D722CanonicalGraphEvidenceV1["effectRuns"],
		undefined,
		policy,
	);
	const validatedRepeated = deriveD722CanonicalGraphEvidence(
		repeated.ledger,
		array(
			repeated.effectRuns,
			"d761.bundle.repeatedFailure.effectRuns",
		) as D722CanonicalGraphEvidenceV1["effectRuns"],
		undefined,
		policy,
	);
	const validatedExecutorFailure = deriveD722CanonicalGraphEvidence(
		executorFailure.ledger,
		array(
			executorFailure.effectRuns,
			"d761.bundle.executorFailure.effectRuns",
		) as D722CanonicalGraphEvidenceV1["effectRuns"],
		undefined,
		policy,
	);
	const validatedInsufficientHeadroom = deriveD722CanonicalGraphEvidence(
		insufficientHeadroom.ledger,
		array(
			insufficientHeadroom.effectRuns,
			"d761.bundle.insufficientHeadroom.effectRuns",
		) as D722CanonicalGraphEvidenceV1["effectRuns"],
		undefined,
		policy,
	);
	const validatedWrongTool = deriveD722CanonicalGraphEvidence(
		wrongTool.ledger,
		array(
			wrongTool.effectRuns,
			"d761.bundle.wrongTool.effectRuns",
		) as D722CanonicalGraphEvidenceV1["effectRuns"],
		undefined,
		policy,
	);
	const validatedHiddenFailureHeadroom = deriveD722CanonicalGraphEvidence(
		hiddenFailureHeadroom.ledger,
		array(
			hiddenFailureHeadroom.effectRuns,
			"d761.bundle.hiddenFailureHeadroom.effectRuns",
		) as D722CanonicalGraphEvidenceV1["effectRuns"],
		undefined,
		policy,
	);
	if (
		sha(validatedGraph) !== sha(graph) ||
		sha(validatedRepeated) !== sha(repeated) ||
		sha(validatedExecutorFailure) !== sha(executorFailure) ||
		sha(validatedInsufficientHeadroom) !== sha(insufficientHeadroom) ||
		sha(validatedWrongTool) !== sha(wrongTool) ||
		sha(validatedHiddenFailureHeadroom) !== sha(hiddenFailureHeadroom)
	)
		throw new TypeError("D761 canonical Graph replay drifted");
	const qualification = record(candidate.qualification, "d761.bundle.qualification");
	const generation = record(candidate.generation, "d761.bundle.generation");
	exactKeys(
		qualification,
		[
			"causalAttribution",
			"baselineAdmissionBasis",
			"contextSchema",
			"criterionFailureContinuationCount",
			"d760BundleArtifactSha256",
			"d760BundleDigest",
			"d760ClaimDigest",
			"d760GraphEvidenceDigest",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"executorFailureGraphEvidenceDigest",
			"insufficientHeadroomGraphEvidenceDigest",
			"graphEvidenceDigest",
			"hiddenFailureHeadroomGraphEvidenceDigest",
			"hiddenMaterialReferenced",
			"hiddenVerifierIndependent",
			"implementationManifestDigest",
			"materialFree",
			"maxActiveArms",
			"maxActiveEffects",
			"policyRevision",
			"positiveDifferentialGateFrozen",
			"positiveDifferentialGateDefinitionDigest",
			"liveGateEvaluated",
			"providerNetworkCalls",
			"providerRequestCount",
			"publicCriteriaOnly",
			"qualificationDigest",
			"repeatedFailureGraphEvidenceDigest",
			"schemaVersion",
			"semanticValidationCount",
			"workspaceResidueCount",
			"wrongToolGraphEvidenceDigest",
		],
		"d761.bundle.qualification",
	);
	exactKeys(
		generation,
		[
			"baselineAdmissionBasis",
			"causalAttribution",
			"d760BundleArtifactSha256",
			"d760BundleDigest",
			"d760ClaimDigest",
			"d760GraphEvidenceDigest",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"graphEvidenceDigest",
			"implementationManifestDigest",
			"providerNetworkCalls",
			"qualificationDigest",
			"schemaVersion",
		],
		"d761.bundle.generation",
	);
	const derivedCounts = deriveMechanismCounts(validatedGraph);
	assertD761MainGraphMechanism(validatedGraph);
	assertD761WrongToolRejected(validatedWrongTool);
	assertD761HeadroomDenied(validatedInsufficientHeadroom, "public-semantic-validation");
	assertD761HeadroomDenied(validatedHiddenFailureHeadroom, "hidden-verifier");
	const repeatedRunZeroFacts = validatedRepeated.effectRuns[0]?.facts.filter(
		(fact) => fact.kind === "graph-effect-result-admitted",
	);
	const repeatedSemanticStatuses = repeatedRunZeroFacts?.flatMap((fact) =>
		fact.result.effectKind === "public-semantic-validation" ? [fact.result.status] : [],
	);
	const repeatedContexts = new Set(
		repeatedRunZeroFacts?.flatMap((fact) =>
			fact.request.completionContext?.reason === "public-semantic-validation-failed"
				? [fact.request.completionContext.contextDigest]
				: [],
		) ?? [],
	);
	const executorFailureStatuses = validatedExecutorFailure.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.result.effectKind === "public-semantic-validation"
				? [fact.result.status]
				: [],
		),
	);
	const insufficientContexts = validatedInsufficientHeadroom.completionContexts.filter(
		(context) => context.reason === "public-semantic-validation-failed",
	);
	const wrongToolRunZeroFacts = validatedWrongTool.effectRuns[0]?.facts.filter(
		(fact) => fact.kind === "graph-effect-result-admitted",
	);
	const hiddenFailureContexts = validatedHiddenFailureHeadroom.completionContexts.filter(
		(context) => context.reason === "hidden-verifier-failed",
	);
	const hiddenFailureStatuses = validatedHiddenFailureHeadroom.effectRuns[0]?.facts.flatMap(
		(fact) =>
			fact.kind === "graph-effect-result-admitted" && fact.result.effectKind === "hidden-verifier"
				? [fact.result.status]
				: [],
	);
	if (
		validatedRepeated.runStatus !== "complete" ||
		validatedRepeated.effectRuns.length !== 7 ||
		validatedRepeated.ledger.completedArms.length !== 6 ||
		repeatedSemanticStatuses?.join(",") !== "failed,failed" ||
		repeatedContexts.size !== 1 ||
		repeatedRunZeroFacts?.some((fact) => fact.result.effectKind === "hidden-verifier") ||
		!repeatedRunZeroFacts?.some(
			(fact) => fact.result.effectKind === "cleanup" && fact.result.status === "succeeded",
		)
	)
		throw new TypeError("D761 repeated criterion failure did not stop after one continuation");
	if (
		validatedExecutorFailure.runStatus !== "stopped" ||
		executorFailureStatuses.join(",") !== "executor-failed" ||
		validatedExecutorFailure.completionContexts.some(
			(context) => context.reason === "public-semantic-validation-failed",
		) ||
		insufficientContexts.length !== 0 ||
		validatedInsufficientHeadroom.runStatus !== "complete" ||
		validatedInsufficientHeadroom.effectRuns.length !== 12 ||
		validatedInsufficientHeadroom.ledger.completedArms.length !== 6 ||
		!everyD761RunCleaned(validatedExecutorFailure) ||
		!everyD761RunCleaned(validatedInsufficientHeadroom) ||
		wrongToolRunZeroFacts?.some(
			(fact) =>
				fact.result.effectKind === "tool-action" &&
				fact.result.toolRef === "read-file" &&
				fact.request.phaseBefore !== "none",
		) ||
		!everyD761RunCleaned(validatedWrongTool) ||
		hiddenFailureStatuses?.join(",") !== "failed" ||
		hiddenFailureContexts.length !== 0 ||
		!everyD761RunCleaned(validatedHiddenFailureHeadroom)
	)
		throw new TypeError("D761 negative Graph mechanism coverage drifted");
	if (
		qualification.schemaVersion !== D761_QUALIFICATION_SCHEMA ||
		qualification.decisionRef !== D761_DECISION_REF ||
		qualification.decisionRevision !== D761_DECISION_REVISION ||
		qualification.graphEvidenceDigest !== validatedGraph.evidenceDigest ||
		qualification.repeatedFailureGraphEvidenceDigest !== validatedRepeated.evidenceDigest ||
		qualification.executorFailureGraphEvidenceDigest !== validatedExecutorFailure.evidenceDigest ||
		qualification.insufficientHeadroomGraphEvidenceDigest !==
			validatedInsufficientHeadroom.evidenceDigest ||
		qualification.wrongToolGraphEvidenceDigest !== validatedWrongTool.evidenceDigest ||
		qualification.hiddenFailureHeadroomGraphEvidenceDigest !==
			validatedHiddenFailureHeadroom.evidenceDigest ||
		qualification.d760BundleArtifactSha256 !== D761_D760_BUNDLE_ARTIFACT_SHA256 ||
		qualification.d760BundleDigest !== D761_D760_BUNDLE_DIGEST ||
		qualification.d760GraphEvidenceDigest !== D761_D760_GRAPH_EVIDENCE_DIGEST ||
		qualification.d760ClaimDigest !== D761_D760_CLAIM_DIGEST ||
		!(
			qualification.baselineAdmissionBasis === "exact-private-bytes" ||
			qualification.baselineAdmissionBasis === "injected-test"
		) ||
		generation.d760BundleDigest !== D761_D760_BUNDLE_DIGEST ||
		generation.d760GraphEvidenceDigest !== D761_D760_GRAPH_EVIDENCE_DIGEST ||
		generation.d760ClaimDigest !== D761_D760_CLAIM_DIGEST ||
		generation.baselineAdmissionBasis !== qualification.baselineAdmissionBasis ||
		qualification.policyRevision !== D761_PUBLIC_SEMANTIC_VALIDATION_POLICY_REVISION ||
		qualification.contextSchema !== D761_CRITERION_FAILURE_CONTEXT_SCHEMA ||
		qualification.implementationManifestDigest !== D761_IMPLEMENTATION_MANIFEST_DIGEST ||
		generation.qualificationDigest !== qualification.qualificationDigest ||
		generation.schemaVersion !== D761_GENERATION_SCHEMA ||
		generation.generationRef !==
			(qualification.baselineAdmissionBasis === "exact-private-bytes"
				? D761_GENERATION_REF
				: D761_TEST_GENERATION_REF) ||
		generation.implementationManifestDigest !== D761_IMPLEMENTATION_MANIFEST_DIGEST ||
		generation.graphEvidenceDigest !== validatedGraph.evidenceDigest ||
		qualification.providerRequestCount !== derivedCounts.providerRequestCount ||
		qualification.semanticValidationCount !== derivedCounts.semanticValidationCount ||
		qualification.criterionFailureContinuationCount !==
			derivedCounts.criterionFailureContinuationCount ||
		qualification.maxActiveArms !== 1 ||
		qualification.maxActiveEffects !== 1 ||
		qualification.workspaceResidueCount !== 0 ||
		qualification.positiveDifferentialGateFrozen !== true ||
		qualification.positiveDifferentialGateDefinitionDigest !==
			D761_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST ||
		qualification.liveGateEvaluated !== false ||
		qualification.publicCriteriaOnly !== true ||
		qualification.hiddenVerifierIndependent !== true ||
		qualification.hiddenMaterialReferenced !== false ||
		qualification.providerNetworkCalls !== 0 ||
		qualification.materialFree !== true ||
		qualification.causalAttribution !== "undetermined" ||
		qualification.efficacyClaim !== "none" ||
		generation.providerNetworkCalls !== 0 ||
		generation.causalAttribution !== "undetermined" ||
		generation.efficacyClaim !== "none"
	)
		throw new TypeError("D761 qualification cross-binding drifted");
	const qualificationDigest = qualification.qualificationDigest;
	const generationDigest = generation.generationDigest;
	digest(qualificationDigest, "d761.qualification.digest");
	digest(generationDigest, "d761.generation.digest");
	const qualificationMaterial = { ...qualification };
	delete qualificationMaterial.qualificationDigest;
	const generationMaterial = { ...generation };
	delete generationMaterial.generationDigest;
	if (
		sha(qualificationMaterial) !== qualificationDigest ||
		sha(generationMaterial) !== generationDigest
	)
		throw new TypeError("D761 qualification digest drifted");
	const material = strictSnapshot({
		schemaVersion: candidate.schemaVersion,
		executionClass: candidate.executionClass,
		graphEvidence: validatedGraph,
		repeatedFailureGraphEvidence: validatedRepeated,
		executorFailureGraphEvidence: validatedExecutorFailure,
		insufficientHeadroomGraphEvidence: validatedInsufficientHeadroom,
		wrongToolGraphEvidence: validatedWrongTool,
		hiddenFailureHeadroomGraphEvidence: validatedHiddenFailureHeadroom,
		qualification: strictSnapshot(qualification),
		generation: strictSnapshot(generation),
		causalAttribution: candidate.causalAttribution,
		efficacyClaim: candidate.efficacyClaim,
	});
	if (digest(candidate.bundleDigest, "d761.bundle.digest") !== sha(material))
		throw new TypeError("D761 bundle digest drifted");
	return Object.freeze({
		...material,
		bundleDigest: candidate.bundleDigest as string,
	}) as unknown as D761PublicSemanticValidationBundleV1;
}

export async function persistD761QualificationBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D761PublicSemanticValidationBundleV1;
	readonly fault?: D761PersistenceFaultV1;
}): Promise<D761PersistenceReceiptV1> {
	const input = record(inputValue, "d761.persist");
	exactKeys(
		input,
		Object.hasOwn(input, "fault") ? ["bundle", "fault", "privateRoot"] : ["bundle", "privateRoot"],
		"d761.persist",
	);
	const fault = consumePersistenceFault(input.fault);
	if (typeof input.privateRoot !== "string") throw new TypeError("D761 private root is invalid");
	const bundleBasis = constructedBundles.get(input.bundle as object);
	if (bundleBasis === undefined)
		throw new TypeError("D761 persistence requires a same-process constructed bundle");
	const bundle = validateD761QualificationBundle(input.bundle);
	if (resolve(input.privateRoot) !== input.privateRoot)
		throw new TypeError("D761 private root must be absolute");
	const privateRoot = await realpath(input.privateRoot);
	if (privateRoot !== input.privateRoot) throw new TypeError("D761 private root is not canonical");
	type Identity = { readonly dev: number; readonly ino: number };
	const assertDirectory = async (path: string, identity: Identity) => {
		const status = await lstat(path);
		if (
			!status.isDirectory() ||
			status.isSymbolicLink() ||
			(status.mode & 0o777) !== 0o700 ||
			status.nlink < 1 ||
			status.dev !== identity.dev ||
			status.ino !== identity.ino ||
			(await realpath(path)) !== path
		)
			throw new TypeError("D761 persistence directory identity drifted");
	};
	const bytes = strictJsonCodec.encode(bundle);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly.b112.d761.commit.v1",
		bundleArtifactDigest: empiricalSha256(bytes),
		bundleDigest: bundle.bundleDigest,
	});
	const commitBytes = strictJsonCodec.encode({
		...commitMaterial,
		commitDigest: sha(commitMaterial),
	});
	const generationRef =
		bundleBasis === "exact-private-bytes" ? D761_GENERATION_REF : D761_TEST_GENERATION_REF;
	const finalRoot = join(privateRoot, generationRef);
	const claimRoot = join(privateRoot, `.d761-claim-${generationRef}`);
	const stagingRoot = join(privateRoot, `.d761-staging-${randomUUID()}`);
	const parentHandle = await open(
		privateRoot,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	let claimIdentity: Identity | null = null;
	let stagingIdentity: Identity | null = null;
	let finalIdentity: Identity | null = null;
	let artifactsIdentity: Identity | null = null;
	let bundleIdentity: Identity | null = null;
	let commitIdentity: Identity | null = null;
	let artifactsHandle: Awaited<ReturnType<typeof open>> | null = null;
	let finalHandle: Awaited<ReturnType<typeof open>> | null = null;
	let operationError: unknown = null;
	try {
		const parentStatus = await parentHandle.stat();
		const parentIdentity = { dev: parentStatus.dev, ino: parentStatus.ino };
		await assertDirectory(privateRoot, parentIdentity);
		await mkdir(claimRoot, { recursive: false, mode: 0o700 });
		const claimHandle = await open(
			claimRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			const status = await claimHandle.stat();
			claimIdentity = { dev: status.dev, ino: status.ino };
			await claimHandle.sync();
			await assertDirectory(claimRoot, claimIdentity);
		} finally {
			await claimHandle.close();
		}
		await parentHandle.sync();
		await mkdir(stagingRoot, { recursive: false, mode: 0o700 });
		const stagingStatus = await lstat(stagingRoot);
		stagingIdentity = { dev: stagingStatus.dev, ino: stagingStatus.ino };
		await assertDirectory(stagingRoot, stagingIdentity);
		const artifactsRoot = join(stagingRoot, "artifacts");
		await mkdir(artifactsRoot, { recursive: false, mode: 0o700 });
		artifactsHandle = await open(
			artifactsRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const artifactsStatus = await artifactsHandle.stat();
		artifactsIdentity = { dev: artifactsStatus.dev, ino: artifactsStatus.ino };
		const bundleHandle = await open(
			join(artifactsRoot, "bundle.v1.json"),
			constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
			0o600,
		);
		try {
			await bundleHandle.writeFile(bytes);
			await bundleHandle.sync();
			const status = await bundleHandle.stat();
			if (!status.isFile() || status.nlink !== 1 || (status.mode & 0o777) !== 0o600)
				throw new TypeError("D761 bundle file ownership drifted");
			bundleIdentity = { dev: status.dev, ino: status.ino };
			const readback = new Uint8Array(bytes.length);
			await bundleHandle.read(readback, 0, readback.length, 0);
			if (!sameBytes(readback, bytes)) throw new TypeError("D761 bundle handle readback drifted");
		} finally {
			await bundleHandle.close();
		}
		await artifactsHandle.sync();
		if (fault === "after-write") throw new TypeError("D761 injected after-write failure");
		const commitHandle = await open(
			join(stagingRoot, "commit.v1.json"),
			constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
			0o600,
		);
		try {
			await commitHandle.writeFile(commitBytes);
			await commitHandle.sync();
			const status = await commitHandle.stat();
			if (!status.isFile() || status.nlink !== 1 || (status.mode & 0o777) !== 0o600)
				throw new TypeError("D761 commit file ownership drifted");
			commitIdentity = { dev: status.dev, ino: status.ino };
			const readback = new Uint8Array(commitBytes.length);
			await commitHandle.read(readback, 0, readback.length, 0);
			if (!sameBytes(readback, commitBytes))
				throw new TypeError("D761 commit handle readback drifted");
		} finally {
			await commitHandle.close();
		}
		const stagingHandle = await open(
			stagingRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			await stagingHandle.sync();
		} finally {
			await stagingHandle.close();
		}
		if (fault === "after-claim") throw new TypeError("D761 injected after-claim failure");
		await assertDirectory(privateRoot, parentIdentity);
		await assertDirectory(claimRoot, claimIdentity);
		await rename(stagingRoot, finalRoot);
		finalIdentity = stagingIdentity;
		finalHandle = await open(
			finalRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		if (fault === "after-commit") throw new TypeError("D761 injected after-commit failure");
		await finalHandle.sync();
		await parentHandle.sync();
		const finalArtifactsRoot = join(finalRoot, "artifacts");
		const assertFile = async (path: string, identity: Identity, expected: Uint8Array) => {
			const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
			try {
				const status = await handle.stat();
				if (
					!status.isFile() ||
					status.nlink !== 1 ||
					(status.mode & 0o777) !== 0o600 ||
					status.dev !== identity.dev ||
					status.ino !== identity.ino ||
					!sameBytes(new Uint8Array(await handle.readFile()), expected)
				)
					throw new TypeError("D761 persistence artifact readback drifted");
			} finally {
				await handle.close();
			}
		};
		await assertFile(join(finalArtifactsRoot, "bundle.v1.json"), bundleIdentity!, bytes);
		await assertFile(join(finalRoot, "commit.v1.json"), commitIdentity!, commitBytes);
		const [finalStable, artifactsStable] = await Promise.all([
			finalHandle.stat(),
			artifactsHandle.stat(),
		]);
		if (
			finalStable.dev !== finalIdentity.dev ||
			finalStable.ino !== finalIdentity.ino ||
			artifactsStable.dev !== artifactsIdentity.dev ||
			artifactsStable.ino !== artifactsIdentity.ino
		)
			throw new TypeError("D761 stable persistence handle drifted");
		await assertDirectory(finalArtifactsRoot, artifactsIdentity);
		await assertDirectory(finalRoot, finalIdentity);
		await assertDirectory(privateRoot, parentIdentity);
		await assertFile(join(finalArtifactsRoot, "bundle.v1.json"), bundleIdentity!, bytes);
		await assertFile(join(finalRoot, "commit.v1.json"), commitIdentity!, commitBytes);
		await assertDirectory(finalArtifactsRoot, artifactsIdentity);
		await assertDirectory(finalRoot, finalIdentity);
		await rmdir(claimRoot);
		claimIdentity = null;
		await parentHandle.sync();
	} catch (error) {
		operationError = error;
	}
	const closes = await Promise.allSettled([
		artifactsHandle?.close() ?? Promise.resolve(),
		finalHandle?.close() ?? Promise.resolve(),
	]);
	const closeErrors = closes
		.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected")
		.map((entry) => entry.reason);
	if (closeErrors.length > 0)
		operationError = new AggregateError(
			operationError === null ? closeErrors : [operationError, ...closeErrors],
			"D761 persistence handle cleanup failed",
		);
	let cleanupError: unknown = null;
	if (operationError !== null) {
		try {
			const removeOwned = async (path: string, identity: Identity) => {
				await assertDirectory(path, identity);
				const tombstone = join(privateRoot, `.d761-tombstone-${randomUUID()}`);
				await rename(path, tombstone);
				const moved = await lstat(tombstone);
				if (moved.dev !== identity.dev || moved.ino !== identity.ino)
					throw new TypeError("D761 cleanup tombstone ownership drifted");
				await rm(tombstone, { recursive: true, force: true });
				await parentHandle.sync();
			};
			if (finalIdentity !== null) await removeOwned(finalRoot, finalIdentity);
			else if (stagingIdentity !== null) await removeOwned(stagingRoot, stagingIdentity);
			if (claimIdentity !== null) {
				await assertDirectory(claimRoot, claimIdentity);
				await rmdir(claimRoot);
				await parentHandle.sync();
			}
		} catch (error) {
			cleanupError = error;
		}
	}
	const parentClose = await Promise.allSettled([parentHandle.close()]);
	if (operationError !== null) {
		const errors = [operationError];
		if (cleanupError !== null) errors.push(cleanupError);
		if (parentClose[0]?.status === "rejected") errors.push(parentClose[0].reason);
		if (errors.length > 1) throw new AggregateError(errors, "D761 persistence cleanup failed");
		throw operationError;
	}
	const receiptMaterial = strictSnapshot({
		schemaVersion: D761_PERSISTENCE_SCHEMA,
		generationRef,
		bundleArtifactDigest: empiricalSha256(bytes),
		bundleDigest: bundle.bundleDigest,
	});
	return Object.freeze({ ...receiptMaterial, persistenceDigest: sha(receiptMaterial) });
}
