import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import { empiricalStrictJsonDigest, exactKeys, record, strictSnapshot } from "./canonical.js";
import { persistCurrentGraphPrivateGeneration } from "./d6-current-private-persistence.js";
import type {
	CurrentGraphProviderEffectResultInputV1,
	CurrentGraphRuntimeToolArgumentsV1,
} from "./d6-current-provider-authority.js";
import { CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE } from "./d6-current-provider-authority.js";
import { CURRENT_GRAPH_LIVE_READABLE_FILES } from "./d8-current-live-coordinates.js";
import { D21_LIMITS, D21_TASK_PROFILE } from "./d21-current-efficacy-recovery-authority.js";
import {
	admitD25EffectResult,
	consumeD25Baseline,
	createD25PhaseAuthority,
	type D25AdmittedEffectV1,
	type D25D24BaselineAdmissionV1,
	type D25PhaseEvidenceV1,
	snapshotD25PhaseEvidence,
	takeD25AdmittedEffect,
	validateD25PhaseEvidence,
} from "./d25-phase-specific-tool-admission.js";
import { D25_IMPLEMENTATION_MANIFEST_DIGEST } from "./d25-phase-specific-tool-implementation-manifest.js";

export const D25_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d25.phase-specific-tool-qualification.v1" as const;
export const D25_BUNDLE_SCHEMA =
	"graphrefly-ts.d25.phase-specific-tool-qualification-bundle.v1" as const;
export const D25_GENERATION_SCHEMA =
	"graphrefly-ts.d25.phase-specific-tool-qualification-generation.v1" as const;
export const D25_GENERATION_REF =
	"current-graph-native-phase-specific-tool-no-network-2026-08-16-d25-v2" as const;
export const D25_INJECTED_GENERATION_REF =
	"current-graph-native-phase-specific-tool-injected-test-d25-v2" as const;

export interface D25QualificationBundleV1 {
	readonly schemaVersion: typeof D25_BUNDLE_SCHEMA;
	readonly basis: "consumed-d24-artifact" | "injected-test";
	readonly mainEvidence: D25PhaseEvidenceV1;
	readonly nearMissEvidence: D25PhaseEvidenceV1;
	readonly qualification: Readonly<{
		schemaVersion: typeof D25_QUALIFICATION_SCHEMA;
		decisionRef: "graphrefly-ts:D25";
		implementationManifestDigest: string;
		mainEvidenceDigest: string;
		nearMissEvidenceDigest: string;
		exactSixArmsCompleted: true;
		graphOwnedNamedInspectionPassed: true;
		graphOwnedNamedMutationPassed: true;
		singleMutationProposalPassed: true;
		graphSerialDiffAndFocusedValidationPassed: true;
		semanticCorrectionPassed: true;
		d24NearMissMatrixPassed: true;
		retryIdentityPassed: true;
		retryDelayCoverageMs: readonly [1_000, 7_000, 60_000];
		providerNetworkCalls: 0;
		maxActiveEffects: 1;
		workspaceResidueCount: 0;
		liveGateEvaluated: false;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		qualified: true;
		qualificationDigest: string;
	}>;
	readonly generation: Readonly<{
		schemaVersion: typeof D25_GENERATION_SCHEMA;
		generationRef: typeof D25_GENERATION_REF;
		qualificationDigest: string;
		mainEvidenceDigest: string;
		nearMissEvidenceDigest: string;
		implementationManifestDigest: string;
		liveGateEvaluated: false;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

interface FixtureState {
	readonly semanticAttempts: Map<number, number>;
	readonly retriedRuns: Set<number>;
	readonly mode: "main" | "near-miss";
	active: number;
	maxActive: number;
	providerCalls: number;
}

const constructed = new WeakSet<object>();

function digestOf(label: string, ...values: unknown[]): string {
	return empiricalStrictJsonDigest({ label, values });
}

function usage(_request: D25AdmittedEffectV1["effect"]["request"], cost = 7) {
	return Object.freeze({
		requests: 1 as const,
		inputTokens: 17,
		outputTokens: 11,
		cacheReadTokens: 0,
		actualCostMicrousd: cost,
		actualElapsedMs: 3,
		costBasis: "reported" as const,
	});
}

function retryProposal(effect: D25AdmittedEffectV1, delayMs: number) {
	const request = effect.effect.request;
	if (request.logicalRequestDigest === null)
		throw new TypeError("D25 injected retry lost its logical request");
	const material = strictSnapshot({
		retryClass: "retryable-transient" as const,
		retryAfterMs: delayMs,
		requestDigest: request.requestDigest,
		logicalRequestDigest: request.logicalRequestDigest,
	});
	return Object.freeze({
		retryClass: "retryable-transient" as const,
		retryAfterMs: delayMs,
		proposalDigest: empiricalStrictJsonDigest(material),
	});
}

function successfulProvider(
	effect: D25AdmittedEffectV1,
	toolCalls: readonly CurrentGraphRuntimeToolArgumentsV1[],
): CurrentGraphProviderEffectResultInputV1 {
	return Object.freeze({
		effectKind: "provider-request" as const,
		status: "completed" as const,
		toolCalls,
		failureCode: null,
		retryProposal: null,
		usage: usage(effect.effect.request),
		evidenceDigest: digestOf(
			"D25 injected provider result",
			effect.effect.request.requestDigest,
			toolCalls,
		),
	});
}

function failedProvider(
	effect: D25AdmittedEffectV1,
	delayMs: number | null,
): CurrentGraphProviderEffectResultInputV1 {
	return Object.freeze({
		effectKind: "provider-request" as const,
		status: "failed" as const,
		toolCalls: [] as const,
		failureCode: delayMs === null ? ("provider-failed" as const) : ("retryable-transient" as const),
		retryProposal: delayMs === null ? null : retryProposal(effect, delayMs),
		usage: usage(effect.effect.request, 19),
		evidenceDigest: digestOf(
			"D25 injected failed provider result",
			effect.effect.request.requestDigest,
			delayMs,
		),
	});
}

function nearMissMutation(effect: D25AdmittedEffectV1): CurrentGraphProviderEffectResultInputV1 {
	const arm = effect.effect.request.arm;
	if (arm === "cold") return successfulProvider(effect, [{ toolRef: "workspace-diff" }]);
	if (arm === "relevant-applied" || arm === "proposal-only")
		return successfulProvider(effect, [
			{ toolRef: "replace-exact", path: "src/current.ts", oldText: "before", newText: "after" },
			{ toolRef: "replace-exact", path: "src/current.ts", oldText: "before", newText: "after" },
		]);
	if (arm === "admission-rejected")
		return successfulProvider(
			effect,
			Array.from({ length: 33 }, () => ({
				toolRef: "replace-exact" as const,
				path: "src/current.ts",
				oldText: "before",
				newText: "after",
			})),
		);
	if (arm === "irrelevant-applied") return failedProvider(effect, null);
	return successfulProvider(effect, [{ toolRef: "focused-validation" }]);
}

function providerResult(effect: D25AdmittedEffectV1, state: FixtureState) {
	const directive = effect.phaseDirective;
	if (directive === null) throw new TypeError("D25 injected provider directive is missing");
	state.providerCalls += 1;
	if (state.mode === "main") {
		const delayByRun = [1_000, 7_000, 60_000] as const;
		const runSequence = effect.effect.request.runSequence;
		const delay = delayByRun[runSequence];
		const logical = effect.effect.request.logicalRequestDigest;
		if (delay !== undefined && logical !== null && !state.retriedRuns.has(runSequence)) {
			state.retriedRuns.add(runSequence);
			return failedProvider(effect, delay);
		}
	}
	if (directive.namedToolRef === "read-file")
		return successfulProvider(
			effect,
			CURRENT_GRAPH_LIVE_READABLE_FILES.map((path) => ({ toolRef: "read-file" as const, path })),
		);
	if (state.mode === "near-miss") return nearMissMutation(effect);
	return successfulProvider(effect, [
		{
			toolRef: "replace-exact" as const,
			path: "src/current.ts",
			oldText: "before",
			newText: "after",
		},
	]);
}

function localResult(effect: D25AdmittedEffectV1, state: FixtureState) {
	const request = effect.effect.request;
	if (request.effectKind === "materialization")
		return Object.freeze({
			effectKind: "materialization" as const,
			status: "completed" as const,
			workspaceStateDigest: digestOf("D25 workspace", request.arm, request.runSequence, 0),
			evidenceDigest: digestOf("D25 materialization", request.requestDigest),
			actualCostMicrousd: 0 as const,
			actualElapsedMs: 1,
		});
	if (request.effectKind === "retry-wait")
		return Object.freeze({
			effectKind: "retry-wait" as const,
			status: "completed" as const,
			actualElapsedMs: request.retryDelayMs,
			evidenceDigest: digestOf("D25 retry wait", request.requestDigest, request.retryDelayMs),
		});
	if (request.effectKind === "tool-action") {
		const before = request.workspaceStateDigest;
		if (before === null) throw new TypeError("D25 injected tool lost its workspace");
		const after =
			request.toolRef === "replace-exact"
				? digestOf("D25 mutated workspace", before, request.requestDigest)
				: before;
		return Object.freeze({
			effectKind: "tool-action" as const,
			toolRef: request.toolRef,
			status: "succeeded" as const,
			causeCode: null,
			workspaceStateBeforeDigest: before,
			workspaceStateAfterDigest: after,
			nonEmptyDiff: request.toolRef === "workspace-diff",
			evidenceDigest: digestOf("D25 tool result", request.requestDigest, request.toolRef),
			actualCostMicrousd: 0 as const,
			actualElapsedMs: 1,
		});
	}
	if (request.effectKind === "public-semantic-validation") {
		const prior = state.semanticAttempts.get(request.runSequence) ?? 0;
		state.semanticAttempts.set(request.runSequence, prior + 1);
		const passed = prior > 0;
		return Object.freeze({
			effectKind: "public-semantic-validation" as const,
			status: passed ? ("passed" as const) : ("failed" as const),
			criterionFailures: passed ? [] : (["canonical-proposal-not-admitted"] as const),
			workspaceStateDigest: request.workspaceStateDigest,
			evidenceDigest: digestOf("D25 public semantic", request.requestDigest, passed),
			actualCostMicrousd: 0 as const,
			actualElapsedMs: 1,
		});
	}
	if (request.effectKind === "hidden-verifier")
		return Object.freeze({
			effectKind: "hidden-verifier" as const,
			status: "passed" as const,
			workspaceStateDigest: request.workspaceStateDigest,
			evidenceDigest: digestOf("D25 hidden verifier", request.requestDigest),
			actualCostMicrousd: 0 as const,
			actualElapsedMs: 1,
		});
	return Object.freeze({
		effectKind: "cleanup" as const,
		status: "completed" as const,
		workspaceStateDigest: null,
		evidenceDigest: digestOf("D25 cleanup", request.requestDigest),
		actualCostMicrousd: 0 as const,
		actualElapsedMs: 1,
	});
}

async function runFixture(mode: FixtureState["mode"]) {
	const authority = createD25PhaseAuthority({
		limits: D21_LIMITS,
		routeProfile: CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE,
		taskProfile: D21_TASK_PROFILE,
	});
	const state: FixtureState = {
		semanticAttempts: new Map(),
		retriedRuns: new Set(),
		mode,
		active: 0,
		maxActive: 0,
		providerCalls: 0,
	};
	for (let guard = 0; guard < D21_LIMITS.maxEffectFacts; guard += 1) {
		const effect = takeD25AdmittedEffect(authority);
		if (effect === null)
			return Object.freeze({
				evidence: validateD25PhaseEvidence(snapshotD25PhaseEvidence(authority)),
				maxActive: state.maxActive,
				providerCalls: state.providerCalls,
			});
		state.active += 1;
		state.maxActive = Math.max(state.maxActive, state.active);
		try {
			const result =
				effect.effect.request.effectKind === "provider-request"
					? providerResult(effect, state)
					: localResult(effect, state);
			admitD25EffectResult(authority, effect, result);
		} finally {
			state.active -= 1;
		}
	}
	throw new TypeError("D25 injected fixture exceeded its effect bound");
}

function retryDelays(evidence: D25PhaseEvidenceV1): readonly number[] {
	return Object.freeze(
		evidence.workflowEvidence.providerEvidence.facts
			.filter((fact) => fact.request.effectKind === "retry-wait")
			.map((fact) => fact.request.retryDelayMs)
			.sort((left, right) => left - right),
	);
}

function assertMainEvidence(evidence: D25PhaseEvidenceV1): void {
	const workflow = evidence.workflowEvidence.providerEvidence.workflowEvidence;
	if (workflow.runStatus !== "complete" || workflow.runs.length !== 6)
		throw new TypeError("D25 main qualification did not complete exactly six arms");
	if (workflow.runs.some((run) => run.cleanupStatus !== "completed"))
		throw new TypeError("D25 main qualification cleanup drifted");
	const mutationFacts = evidence.phaseFacts.filter(
		(fact) => fact.disposition === "accepted-mutation",
	);
	if (
		mutationFacts.length !== 12 ||
		mutationFacts.some(
			(fact) =>
				fact.proposalToolRefs.join(",") !== "replace-exact" ||
				fact.deterministicSuccessors.join(",") !== "workspace-diff,focused-validation",
		)
	)
		throw new TypeError("D25 main mutation lifecycle drifted");
	for (const run of workflow.runs)
		if (
			!run.publicSemanticValidationAttempted ||
			!run.publicSemanticValidationPassed ||
			!run.hiddenVerifierAttempted ||
			!run.hiddenVerifierPassed
		)
			throw new TypeError("D25 main validation lifecycle drifted");
	if (retryDelays(evidence).join(",") !== "1000,7000,60000")
		throw new TypeError("D25 retry identity coverage drifted");
}

function assertNearMissEvidence(evidence: D25PhaseEvidenceV1): void {
	const workflow = evidence.workflowEvidence.providerEvidence.workflowEvidence;
	if (workflow.runStatus !== "complete" || workflow.runs.length !== 6)
		throw new TypeError("D25 near-miss matrix did not preserve six-arm orchestration");
	if (workflow.runs.some((run) => run.status !== "incomplete" || run.cleanupStatus !== "completed"))
		throw new TypeError("D25 near-miss cleanup/stopping drifted");
	const dispositions = new Set(evidence.phaseFacts.map((fact) => fact.disposition));
	for (const expected of [
		"phase-tool-mismatch",
		"mutation-proposal-cardinality",
		"provider-result-rejected",
		"provider-failed",
	] as const)
		if (!dispositions.has(expected))
			throw new TypeError(`D25 near-miss coverage is missing ${expected}`);
}

function buildBundle(input: {
	readonly basis: D25QualificationBundleV1["basis"];
	readonly implementationManifestDigest: string;
	readonly mainEvidence: D25PhaseEvidenceV1;
	readonly nearMissEvidence: D25PhaseEvidenceV1;
}): D25QualificationBundleV1 {
	const qualificationBase = strictSnapshot({
		schemaVersion: D25_QUALIFICATION_SCHEMA,
		decisionRef: "graphrefly-ts:D25" as const,
		implementationManifestDigest: input.implementationManifestDigest,
		mainEvidenceDigest: input.mainEvidence.evidenceDigest,
		nearMissEvidenceDigest: input.nearMissEvidence.evidenceDigest,
		exactSixArmsCompleted: true as const,
		graphOwnedNamedInspectionPassed: true as const,
		graphOwnedNamedMutationPassed: true as const,
		singleMutationProposalPassed: true as const,
		graphSerialDiffAndFocusedValidationPassed: true as const,
		semanticCorrectionPassed: true as const,
		d24NearMissMatrixPassed: true as const,
		retryIdentityPassed: true as const,
		retryDelayCoverageMs: [1_000, 7_000, 60_000] as const,
		providerNetworkCalls: 0 as const,
		maxActiveEffects: 1 as const,
		workspaceResidueCount: 0 as const,
		liveGateEvaluated: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		qualified: true as const,
	});
	const qualification = Object.freeze({
		...qualificationBase,
		qualificationDigest: empiricalStrictJsonDigest(qualificationBase),
	});
	const generationBase = strictSnapshot({
		schemaVersion: D25_GENERATION_SCHEMA,
		generationRef: D25_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		mainEvidenceDigest: input.mainEvidence.evidenceDigest,
		nearMissEvidenceDigest: input.nearMissEvidence.evidenceDigest,
		implementationManifestDigest: input.implementationManifestDigest,
		liveGateEvaluated: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = Object.freeze({
		...generationBase,
		generationDigest: empiricalStrictJsonDigest(generationBase),
	});
	const base = strictSnapshot({
		schemaVersion: D25_BUNDLE_SCHEMA,
		basis: input.basis,
		mainEvidence: input.mainEvidence,
		nearMissEvidence: input.nearMissEvidence,
		qualification,
		generation,
	});
	return Object.freeze({
		...base,
		bundleDigest: empiricalStrictJsonDigest(base),
	}) as D25QualificationBundleV1;
}

export async function runD25InjectedNoNetworkQualification(input: {
	readonly baseline: D25D24BaselineAdmissionV1;
	readonly basis: D25QualificationBundleV1["basis"];
	readonly implementationManifestDigest: string;
}): Promise<D25QualificationBundleV1> {
	consumeD25Baseline(input.baseline, input.basis);
	if (input.implementationManifestDigest !== D25_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D25 implementation manifest drifted");
	const [main, nearMiss] = await Promise.all([runFixture("main"), runFixture("near-miss")]);
	if (main.maxActive !== 1 || nearMiss.maxActive !== 1)
		throw new TypeError("D25 injected fixture lost serial execution");
	assertMainEvidence(main.evidence);
	assertNearMissEvidence(nearMiss.evidence);
	const bundle = buildBundle({
		basis: input.basis,
		implementationManifestDigest: input.implementationManifestDigest,
		mainEvidence: main.evidence,
		nearMissEvidence: nearMiss.evidence,
	});
	constructed.add(bundle);
	return bundle;
}

export function validateD25QualificationBundle(value: unknown): D25QualificationBundleV1 {
	const candidate = record(value, "D25 bundle");
	exactKeys(
		candidate,
		[
			"basis",
			"bundleDigest",
			"generation",
			"mainEvidence",
			"nearMissEvidence",
			"qualification",
			"schemaVersion",
		],
		"D25 bundle",
	);
	if (candidate.schemaVersion !== D25_BUNDLE_SCHEMA)
		throw new TypeError("D25 bundle schema drifted");
	if (candidate.basis !== "consumed-d24-artifact" && candidate.basis !== "injected-test")
		throw new TypeError("D25 bundle basis drifted");
	const main = validateD25PhaseEvidence(candidate.mainEvidence);
	const nearMiss = validateD25PhaseEvidence(candidate.nearMissEvidence);
	assertMainEvidence(main);
	assertNearMissEvidence(nearMiss);
	const qualification = record(candidate.qualification, "D25 qualification");
	const generation = record(candidate.generation, "D25 generation");
	const rebuilt = buildBundle({
		basis: candidate.basis,
		implementationManifestDigest: String(qualification.implementationManifestDigest),
		mainEvidence: main,
		nearMissEvidence: nearMiss,
	});
	if (
		empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(rebuilt) ||
		empiricalStrictJsonDigest(qualification) !== empiricalStrictJsonDigest(rebuilt.qualification) ||
		empiricalStrictJsonDigest(generation) !== empiricalStrictJsonDigest(rebuilt.generation)
	)
		throw new TypeError("D25 qualification canonical replay drifted");
	return rebuilt;
}

export async function persistD25QualificationBundle(input: {
	readonly privateRoot: string;
	readonly bundle: D25QualificationBundleV1;
}): Promise<Readonly<{ artifactDigest: string; persistenceDigest: string }>> {
	if (!constructed.delete(input.bundle))
		throw new TypeError("D25 bundle was not constructed or replayed");
	const bundle = validateD25QualificationBundle(input.bundle);
	if (bundle.basis !== "consumed-d24-artifact")
		throw new TypeError("D25 production persistence rejects injected evidence");
	return persistD25(input.privateRoot, bundle, D25_GENERATION_REF);
}

async function persistD25(
	privateRoot: string,
	bundle: D25QualificationBundleV1,
	generationRef: string,
) {
	const bytes = strictJsonCodec.encode(bundle as unknown as StrictJsonValue);
	const commitBytes = strictJsonCodec.encode(
		strictSnapshot({
			schemaVersion: "graphrefly-ts.d25.phase-specific-tool-commit.v1",
			generationRef,
			bundleDigest: bundle.bundleDigest,
			qualificationDigest: bundle.qualification.qualificationDigest,
			generationDigest: bundle.generation.generationDigest,
		}) as StrictJsonValue,
	);
	const receipt = await persistCurrentGraphPrivateGeneration({
		privateRoot,
		generationRef,
		artifacts: Object.freeze({ "bundle.v1.json": bytes }),
		commitBytes,
	});
	return Object.freeze({
		artifactDigest: receipt.artifactDigests["bundle.v1.json"]!,
		persistenceDigest: receipt.receiptDigest,
	});
}

export async function persistD25InjectedQualificationForTest(input: {
	readonly privateRoot: string;
	readonly bundle: D25QualificationBundleV1;
}) {
	if (!constructed.delete(input.bundle))
		throw new TypeError("D25 bundle was not constructed or replayed");
	const bundle = validateD25QualificationBundle(input.bundle);
	if (bundle.basis !== "injected-test")
		throw new TypeError("D25 injected persistence basis drifted");
	return persistD25(input.privateRoot, bundle, D25_INJECTED_GENERATION_REF);
}
