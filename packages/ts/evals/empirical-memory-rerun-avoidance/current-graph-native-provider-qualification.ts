import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import { CURRENT_GRAPH_ARMS } from "./current-graph-native-eval-authority.js";
import {
	CURRENT_GRAPH_IMPLEMENTATION_MANIFEST_DIGEST,
	measureCurrentGraphImplementation,
} from "./current-graph-native-eval-implementation-manifest.js";
import { validateCurrentGraphQualificationBundle } from "./current-graph-native-eval-qualification.js";
import {
	CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE,
	CURRENT_GRAPH_PROVIDER_INJECTED_TASK,
	CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
	type CurrentGraphProviderAdmittedEffectV1,
	type CurrentGraphProviderEffectResultInputV1,
	type CurrentGraphProviderEvidenceV1,
	runCurrentGraphProviderEval,
	validateCurrentGraphProviderEvidence,
} from "./current-graph-native-provider-authority.js";
import {
	CURRENT_GRAPH_PROVIDER_IMPLEMENTATION_MANIFEST_DIGEST,
	measureCurrentGraphProviderImplementation,
} from "./current-graph-native-provider-implementation-manifest.js";

export const CURRENT_GRAPH_PROVIDER_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d2.current-graph-native-provider-qualification.v1" as const;
export const CURRENT_GRAPH_PROVIDER_GENERATION_SCHEMA =
	"graphrefly-ts.d2.current-graph-native-provider-generation.v1" as const;
export const CURRENT_GRAPH_PROVIDER_BUNDLE_SCHEMA =
	"graphrefly-ts.d2.current-graph-native-provider-bundle.v1" as const;
export const CURRENT_GRAPH_PROVIDER_GENERATION_REF =
	"current-graph-native-provider-no-network-qualification-2026-08-14-v3" as const;
export const CURRENT_GRAPH_PROVIDER_TEST_GENERATION_REF =
	"current-graph-native-provider-injected-test-2026-08-14-v3" as const;
export const CURRENT_GRAPH_PROVIDER_MAX_BUNDLE_BYTES = 2_097_152 as const;

const D1_COMMIT = "fa6a731695c63a9da6681e76c07bd1ed3182e7a2" as const;
const D1_BUNDLE_ARTIFACT_DIGEST =
	"sha256:1ef86a1aede3ba96614b0fe9d39ac3c14c630d37f27fd878982991afcf3937ae" as const;

type BaselineBasis = "exact-d1-artifact" | "injected-test";
export interface CurrentGraphProviderD1BaselineV1 {
	readonly __currentGraphProviderD1Baseline: true;
	readonly basis: BaselineBasis;
}

interface BaselineState {
	readonly basis: BaselineBasis;
	consumed: boolean;
}

const baselines = new WeakMap<object, BaselineState>();

export function admitCurrentGraphProviderD1BaselineArtifact(
	bytesValue: Uint8Array,
): CurrentGraphProviderD1BaselineV1 {
	const bytes = new Uint8Array(bytesValue);
	if (bytes.byteLength === 0 || bytes.byteLength > 1_048_576)
		throw new TypeError("current provider D1 baseline artifact byte bound drifted");
	if (empiricalSha256(bytes) !== D1_BUNDLE_ARTIFACT_DIGEST)
		throw new TypeError("current provider D1 baseline artifact digest drifted");
	const decoded = strictJsonCodec.decode(bytes);
	const bundle = validateCurrentGraphQualificationBundle(decoded);
	if (
		bundle.qualification.implementationManifestDigest !==
			CURRENT_GRAPH_IMPLEMENTATION_MANIFEST_DIGEST ||
		bundle.qualification.decisionRef !== "graphrefly-ts:D1"
	)
		throw new TypeError("current provider D1 baseline coordinates drifted");
	const capability = Object.freeze({
		__currentGraphProviderD1Baseline: true as const,
		basis: "exact-d1-artifact" as const,
	});
	baselines.set(capability, { basis: "exact-d1-artifact", consumed: false });
	return capability;
}

export function createCurrentGraphProviderInjectedBaselineForTest(): CurrentGraphProviderD1BaselineV1 {
	const capability = Object.freeze({
		__currentGraphProviderD1Baseline: true as const,
		basis: "injected-test" as const,
	});
	baselines.set(capability, { basis: "injected-test", consumed: false });
	return capability;
}

function consumeBaseline(value: unknown): BaselineBasis {
	if (value === null || typeof value !== "object")
		throw new TypeError("current provider D1 baseline capability is invalid");
	const state = baselines.get(value);
	if (state === undefined || state.consumed)
		throw new TypeError("current provider D1 baseline capability is forged or replayed");
	state.consumed = true;
	return state.basis;
}

export interface CurrentGraphProviderQualificationBundleV1 {
	readonly schemaVersion: typeof CURRENT_GRAPH_PROVIDER_BUNDLE_SCHEMA;
	readonly mainGraphEvidence: CurrentGraphProviderEvidenceV1;
	readonly terminalFailureGraphEvidence: CurrentGraphProviderEvidenceV1;
	readonly cleanupFailureGraphEvidence: CurrentGraphProviderEvidenceV1;
	readonly qualification: Readonly<{
		schemaVersion: typeof CURRENT_GRAPH_PROVIDER_QUALIFICATION_SCHEMA;
		decisionRef: "graphrefly-ts:D2";
		executionClass: "injected-no-network";
		baselineBasis: BaselineBasis;
		d1Commit: typeof D1_COMMIT;
		d1BundleArtifactDigest: typeof D1_BUNDLE_ARTIFACT_DIGEST;
		d1ImplementationManifestDigest: typeof CURRENT_GRAPH_IMPLEMENTATION_MANIFEST_DIGEST;
		implementationManifestDigest: string;
		mainGraphEvidenceDigest: string;
		terminalFailureGraphEvidenceDigest: string;
		cleanupFailureGraphEvidenceDigest: string;
		exactSixArmsCompleted: true;
		coldDidNotCensorWarm: true;
		providerAttemptCount: number;
		retryWaitCount: 1;
		retryWireIdentityPassed: true;
		maxActiveEffects: 1;
		adapterEvidenceLedgerPresent: false;
		materialFreeCanonicalProjection: true;
		workspaceResidueCount: 0;
		networkCalls: 0;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		qualified: true;
		qualificationDigest: string;
	}>;
	readonly generation: Readonly<{
		schemaVersion: typeof CURRENT_GRAPH_PROVIDER_GENERATION_SCHEMA;
		generationRef:
			| typeof CURRENT_GRAPH_PROVIDER_GENERATION_REF
			| typeof CURRENT_GRAPH_PROVIDER_TEST_GENERATION_REF;
		baselineBasis: BaselineBasis;
		qualificationDigest: string;
		mainGraphEvidenceDigest: string;
		implementationManifestDigest: string;
		generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

export interface CurrentGraphProviderPersistenceReceiptV1 {
	readonly generationRef: string;
	readonly bundleDigest: string;
	readonly bundleArtifactDigest: string;
	readonly finalRoot: string;
	readonly receiptDigest: string;
}

type FaultStage = "after-claim" | "after-write" | "after-rename" | "after-marker";
export type CurrentGraphProviderPersistenceFaultV1 = Readonly<{
	readonly __currentGraphProviderPersistenceFault: true;
}>;

const constructedBundles = new WeakSet<object>();
const persistenceFaults = new WeakMap<object, FaultStage>();

export function createCurrentGraphProviderPersistenceFaultForTest(
	stage: FaultStage,
): CurrentGraphProviderPersistenceFaultV1 {
	if (!["after-claim", "after-write", "after-rename", "after-marker"].includes(stage))
		throw new TypeError("current provider persistence fault stage is invalid");
	const capability = Object.freeze({ __currentGraphProviderPersistenceFault: true as const });
	persistenceFaults.set(capability, stage);
	return capability;
}

function resultDigest(value: unknown) {
	return empiricalStrictJsonDigest(value);
}

interface ExecutorMetrics {
	active: number;
	maxActive: number;
	providerAttempts: number;
	retryWaits: number;
	logicalBodies: Map<string, string>;
}

function createMainExecutor(metrics: ExecutorMetrics) {
	const replacementRejected = new Set<number>();
	const semanticRejected = new Set<number>();
	let retryInjected = false;
	return async (
		effect: CurrentGraphProviderAdmittedEffectV1,
	): Promise<CurrentGraphProviderEffectResultInputV1> => {
		metrics.active += 1;
		metrics.maxActive = Math.max(metrics.maxActive, metrics.active);
		try {
			const request = effect.request;
			const local = { actualCostMicrousd: 0 as const, actualElapsedMs: 1 };
			if (request.effectKind === "provider-request") {
				metrics.providerAttempts += 1;
				if (
					effect.runtime.route?.routeDigest !== CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE.routeDigest ||
					effect.runtime.modelEnvelope === null ||
					effect.runtime.modelEnvelope.envelopeDigest !== request.taskEnvelopeDigest
				)
					throw new TypeError("current provider injected envelope drifted");
				const logical = request.logicalRequestDigest;
				if (logical === null) throw new TypeError("current provider logical request is missing");
				const bodyDigest = resultDigest({
					route: effect.runtime.route,
					envelope: effect.runtime.modelEnvelope,
				});
				const priorBody = metrics.logicalBodies.get(logical);
				if (priorBody !== undefined && priorBody !== bodyDigest)
					throw new TypeError("current provider retry body identity drifted");
				metrics.logicalBodies.set(logical, bodyDigest);
				const usage = Object.freeze({
					requests: 1 as const,
					inputTokens: 120,
					outputTokens: 30,
					cacheReadTokens: 0,
					actualCostMicrousd: 10,
					actualElapsedMs: 2,
					costBasis: "reported" as const,
				});
				if (!retryInjected) {
					retryInjected = true;
					const retryAfterMs = 7;
					const proposalMaterial = strictSnapshot({
						retryClass: "retryable-transient" as const,
						retryAfterMs,
						requestDigest: request.requestDigest,
						logicalRequestDigest: logical,
					});
					return Object.freeze({
						effectKind: "provider-request" as const,
						status: "failed" as const,
						toolCalls: [],
						failureCode: "retryable-transient" as const,
						retryProposal: Object.freeze({
							retryClass: "retryable-transient" as const,
							retryAfterMs,
							proposalDigest: resultDigest(proposalMaterial),
						}),
						usage,
						evidenceDigest: resultDigest({ request: request.requestDigest, transient: true }),
					});
				}
				const phase = effect.runtime.modelEnvelope.phaseBefore;
				const requiredFirstToolRef = effect.runtime.modelEnvelope.requiredFirstToolRef;
				const toolCalls =
					phase === "none" || requiredFirstToolRef === "read-file"
						? ([{ toolRef: "read-file" as const, path: "src/current.ts" }] as const)
						: ([
								{
									toolRef: "replace-exact" as const,
									path: "src/current.ts",
									oldText: "old-value",
									newText: "new-value",
								},
								{ toolRef: "workspace-diff" as const },
								{ toolRef: "focused-validation" as const },
							] as const);
				return Object.freeze({
					effectKind: "provider-request" as const,
					status: "completed" as const,
					toolCalls,
					failureCode: null,
					retryProposal: null,
					usage,
					evidenceDigest: resultDigest({ request: request.requestDigest, toolCalls }),
				});
			}
			if (request.effectKind === "retry-wait") {
				metrics.retryWaits += 1;
				return Object.freeze({
					effectKind: "retry-wait" as const,
					status: "completed" as const,
					actualElapsedMs: request.retryDelayMs,
					evidenceDigest: resultDigest({
						request: request.requestDigest,
						waited: request.retryDelayMs,
					}),
				});
			}
			if (request.effectKind === "materialization") {
				const workspaceStateDigest = resultDigest({ arm: request.arm, state: "materialized" });
				return Object.freeze({
					...local,
					effectKind: "materialization" as const,
					status: "completed" as const,
					workspaceStateDigest,
					evidenceDigest: resultDigest({ request: request.requestDigest, workspaceStateDigest }),
				});
			}
			if (request.effectKind === "tool-action") {
				const args = effect.runtime.toolArguments;
				if (args === null || args.toolRef !== request.toolRef)
					throw new TypeError("current provider injected tool arguments drifted");
				const workflowFact = request.sourceWorkflowRequestDigest;
				const before = request.workspaceStateDigest;
				if (before === null)
					throw new TypeError("current provider injected tool workspace is missing");
				if (request.toolRef === "replace-exact" && !replacementRejected.has(request.runSequence)) {
					replacementRejected.add(request.runSequence);
					return Object.freeze({
						...local,
						effectKind: "tool-action" as const,
						toolRef: "replace-exact" as const,
						status: "failed" as const,
						causeCode: "exact-replacement-not-applicable" as const,
						workspaceStateBeforeDigest: before,
						workspaceStateAfterDigest: before,
						nonEmptyDiff: false,
						evidenceDigest: resultDigest({ workflowFact, rejected: true }),
					});
				}
				const after =
					request.toolRef === "replace-exact"
						? resultDigest({ before, run: request.runSequence, mutation: "fresh" })
						: before;
				return Object.freeze({
					...local,
					effectKind: "tool-action" as const,
					toolRef: request.toolRef!,
					status: "succeeded" as const,
					causeCode: null,
					workspaceStateBeforeDigest: before,
					workspaceStateAfterDigest: after,
					nonEmptyDiff: request.toolRef === "workspace-diff",
					evidenceDigest: resultDigest({ workflowFact, after }),
				});
			}
			if (request.effectKind === "public-semantic-validation") {
				const first = !semanticRejected.has(request.runSequence);
				semanticRejected.add(request.runSequence);
				const criterionFailures = first
					? (["local-reconstruction-not-rejected"] as const)
					: ([] as const);
				return Object.freeze({
					...local,
					effectKind: "public-semantic-validation" as const,
					status: first ? ("failed" as const) : ("passed" as const),
					criterionFailures,
					workspaceStateDigest: request.workspaceStateDigest!,
					evidenceDigest: resultDigest({ request: request.requestDigest, criterionFailures }),
				});
			}
			if (request.effectKind === "hidden-verifier") {
				return Object.freeze({
					...local,
					effectKind: "hidden-verifier" as const,
					status: "passed" as const,
					workspaceStateDigest: request.workspaceStateDigest!,
					evidenceDigest: resultDigest({ request: request.requestDigest, hidden: "passed" }),
				});
			}
			return Object.freeze({
				...local,
				effectKind: "cleanup" as const,
				status: "completed" as const,
				workspaceStateDigest: null,
				evidenceDigest: resultDigest({ request: request.requestDigest, cleanup: true }),
			});
		} finally {
			metrics.active -= 1;
		}
	};
}

function createTerminalFailureExecutor() {
	return async (
		effect: CurrentGraphProviderAdmittedEffectV1,
	): Promise<CurrentGraphProviderEffectResultInputV1> => {
		if (effect.request.effectKind === "materialization") {
			return {
				effectKind: "materialization",
				status: "completed",
				workspaceStateDigest: resultDigest({ arm: effect.request.arm, terminal: true }),
				evidenceDigest: resultDigest(effect.request.requestDigest),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			};
		}
		if (effect.request.effectKind === "provider-request") {
			return {
				effectKind: "provider-request",
				status: "failed",
				toolCalls: [],
				failureCode: "provider-failed",
				retryProposal: null,
				usage: {
					requests: 1,
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					actualCostMicrousd: effect.request.reservation.maxCostMicrousd,
					actualElapsedMs: 1,
					costBasis: "conservative-reservation",
				},
				evidenceDigest: resultDigest({ request: effect.request.requestDigest, terminal: true }),
			};
		}
		if (effect.request.effectKind !== "cleanup")
			throw new TypeError("current provider terminal fixture observed an unexpected effect");
		return {
			effectKind: "cleanup",
			status: "completed",
			workspaceStateDigest: null,
			evidenceDigest: resultDigest({ request: effect.request.requestDigest, cleanup: true }),
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		};
	};
}

function createCleanupFailureExecutor() {
	return async (
		effect: CurrentGraphProviderAdmittedEffectV1,
	): Promise<CurrentGraphProviderEffectResultInputV1> => {
		if (effect.request.effectKind === "materialization") {
			return {
				effectKind: "materialization",
				status: "failed",
				workspaceStateDigest: null,
				evidenceDigest: resultDigest({ request: effect.request.requestDigest, failed: true }),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			};
		}
		if (effect.request.effectKind !== "cleanup")
			throw new TypeError("current provider cleanup fixture observed an unexpected effect");
		return {
			effectKind: "cleanup",
			status: "failed",
			workspaceStateDigest: null,
			evidenceDigest: resultDigest({ request: effect.request.requestDigest, cleanupFailed: true }),
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		};
	};
}

export async function runCurrentGraphProviderNoNetworkQualification(input: {
	readonly d1Baseline: CurrentGraphProviderD1BaselineV1;
}): Promise<CurrentGraphProviderQualificationBundleV1> {
	const captured = record(input, "current.provider.qualificationInput");
	exactKeys(captured, ["d1Baseline"], "current.provider.qualificationInput");
	const baselineBasis = consumeBaseline(captured.d1Baseline);
	if ((await measureCurrentGraphImplementation()) !== CURRENT_GRAPH_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("current provider D1 implementation drifted before qualification");
	if (
		(await measureCurrentGraphProviderImplementation()) !==
		CURRENT_GRAPH_PROVIDER_IMPLEMENTATION_MANIFEST_DIGEST
	)
		throw new TypeError("current provider D2 implementation drifted before qualification");
	const metrics: ExecutorMetrics = {
		active: 0,
		maxActive: 0,
		providerAttempts: 0,
		retryWaits: 0,
		logicalBodies: new Map(),
	};
	const mainGraphEvidence = validateCurrentGraphProviderEvidence(
		await runCurrentGraphProviderEval({
			limits: CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
			routeProfile: CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE,
			taskProfile: CURRENT_GRAPH_PROVIDER_INJECTED_TASK,
			execute: createMainExecutor(metrics),
		}),
	);
	const terminalFailureGraphEvidence = validateCurrentGraphProviderEvidence(
		await runCurrentGraphProviderEval({
			limits: CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
			routeProfile: CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE,
			taskProfile: CURRENT_GRAPH_PROVIDER_INJECTED_TASK,
			execute: createTerminalFailureExecutor(),
		}),
	);
	const cleanupFailureGraphEvidence = validateCurrentGraphProviderEvidence(
		await runCurrentGraphProviderEval({
			limits: CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
			routeProfile: CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE,
			taskProfile: CURRENT_GRAPH_PROVIDER_INJECTED_TASK,
			execute: createCleanupFailureExecutor(),
		}),
	);
	if (
		mainGraphEvidence.runStatus !== "complete" ||
		mainGraphEvidence.workflowEvidence.runs.length !== CURRENT_GRAPH_ARMS.length ||
		mainGraphEvidence.workflowEvidence.runs.some(
			(run, index) =>
				run.arm !== CURRENT_GRAPH_ARMS[index] ||
				run.status !== "completed" ||
				!run.replacementRecoveryUsed ||
				!run.semanticRecoveryUsed ||
				!run.publicSemanticValidationPassed ||
				!run.hiddenVerifierPassed ||
				run.cleanupStatus !== "completed",
		) ||
		terminalFailureGraphEvidence.workflowEvidence.runs.length !== CURRENT_GRAPH_ARMS.length ||
		terminalFailureGraphEvidence.workflowEvidence.runs.some(
			(run) => run.status !== "incomplete" || run.cleanupStatus !== "completed",
		) ||
		cleanupFailureGraphEvidence.runStatus !== "stopped" ||
		cleanupFailureGraphEvidence.workflowEvidence.runs.length !== 1 ||
		cleanupFailureGraphEvidence.workflowEvidence.runs[0]?.cleanupStatus !== "failed" ||
		metrics.retryWaits !== 1 ||
		metrics.maxActive !== 1 ||
		mainGraphEvidence.budget.providerAttempts !== metrics.providerAttempts ||
		mainGraphEvidence.budget.retryWaits !== metrics.retryWaits
	)
		throw new TypeError("current provider exact qualification lifecycle drifted");
	const retryFacts = mainGraphEvidence.facts.filter(
		(fact) =>
			fact.request.logicalRequestDigest ===
			mainGraphEvidence.facts[1]?.request.logicalRequestDigest,
	);
	const providerRetryFacts = retryFacts.filter(
		(fact) => fact.result.effectKind === "provider-request",
	);
	if (
		providerRetryFacts.length !== 2 ||
		providerRetryFacts[0]?.request.taskEnvelopeDigest !==
			providerRetryFacts[1]?.request.taskEnvelopeDigest ||
		providerRetryFacts[0]?.request.routeDigest !== providerRetryFacts[1]?.request.routeDigest ||
		providerRetryFacts[0]?.request.logicalRequestDigest !==
			providerRetryFacts[1]?.request.logicalRequestDigest
	)
		throw new TypeError("current provider retry identity qualification drifted");
	const serializedEvidence = JSON.stringify({
		mainGraphEvidence,
		terminalFailureGraphEvidence,
		cleanupFailureGraphEvidence,
	});
	for (const forbidden of [
		"OPENROUTER_API_KEY",
		"old-value",
		"new-value",
		"systemInstruction",
		"taskStatement",
		"allowedWorkspacePath",
	])
		if (serializedEvidence.includes(forbidden))
			throw new TypeError("current provider canonical evidence leaked runtime material");
	const qualificationMaterial = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_PROVIDER_QUALIFICATION_SCHEMA,
		decisionRef: "graphrefly-ts:D2" as const,
		executionClass: "injected-no-network" as const,
		baselineBasis,
		d1Commit: D1_COMMIT,
		d1BundleArtifactDigest: D1_BUNDLE_ARTIFACT_DIGEST,
		d1ImplementationManifestDigest: CURRENT_GRAPH_IMPLEMENTATION_MANIFEST_DIGEST,
		implementationManifestDigest: CURRENT_GRAPH_PROVIDER_IMPLEMENTATION_MANIFEST_DIGEST,
		mainGraphEvidenceDigest: mainGraphEvidence.evidenceDigest,
		terminalFailureGraphEvidenceDigest: terminalFailureGraphEvidence.evidenceDigest,
		cleanupFailureGraphEvidenceDigest: cleanupFailureGraphEvidence.evidenceDigest,
		exactSixArmsCompleted: true as const,
		coldDidNotCensorWarm: true as const,
		providerAttemptCount: metrics.providerAttempts,
		retryWaitCount: 1 as const,
		retryWireIdentityPassed: true as const,
		maxActiveEffects: 1 as const,
		adapterEvidenceLedgerPresent: false as const,
		materialFreeCanonicalProjection: true as const,
		workspaceResidueCount: 0 as const,
		networkCalls: 0 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		qualified: true as const,
	});
	const qualification = Object.freeze({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_PROVIDER_GENERATION_SCHEMA,
		generationRef:
			baselineBasis === "exact-d1-artifact"
				? CURRENT_GRAPH_PROVIDER_GENERATION_REF
				: CURRENT_GRAPH_PROVIDER_TEST_GENERATION_REF,
		baselineBasis,
		qualificationDigest: qualification.qualificationDigest,
		mainGraphEvidenceDigest: mainGraphEvidence.evidenceDigest,
		implementationManifestDigest: CURRENT_GRAPH_PROVIDER_IMPLEMENTATION_MANIFEST_DIGEST,
	});
	const generation = Object.freeze({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const bundleMaterial = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_PROVIDER_BUNDLE_SCHEMA,
		mainGraphEvidence,
		terminalFailureGraphEvidence,
		cleanupFailureGraphEvidence,
		qualification,
		generation,
	});
	const bundle = Object.freeze({
		...bundleMaterial,
		bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
	}) as CurrentGraphProviderQualificationBundleV1;
	if (strictJsonCodec.encode(bundle).byteLength > CURRENT_GRAPH_PROVIDER_MAX_BUNDLE_BYTES)
		throw new TypeError("current provider qualification bundle exceeded its byte bound");
	constructedBundles.add(bundle);
	if (
		(await measureCurrentGraphProviderImplementation()) !==
		CURRENT_GRAPH_PROVIDER_IMPLEMENTATION_MANIFEST_DIGEST
	)
		throw new TypeError("current provider D2 implementation drifted after qualification");
	return bundle;
}

export function validateCurrentGraphProviderQualificationBundle(
	value: unknown,
): CurrentGraphProviderQualificationBundleV1 {
	const candidate = record(value, "current.provider.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"cleanupFailureGraphEvidence",
			"generation",
			"mainGraphEvidence",
			"qualification",
			"schemaVersion",
			"terminalFailureGraphEvidence",
		],
		"current.provider.bundle",
	);
	const qualification = record(candidate.qualification, "current.provider.bundle.qualification");
	const generation = record(candidate.generation, "current.provider.bundle.generation");
	exactKeys(
		qualification,
		[
			"adapterEvidenceLedgerPresent",
			"baselineBasis",
			"causalAttribution",
			"cleanupFailureGraphEvidenceDigest",
			"coldDidNotCensorWarm",
			"d1BundleArtifactDigest",
			"d1Commit",
			"d1ImplementationManifestDigest",
			"decisionRef",
			"efficacyClaim",
			"exactSixArmsCompleted",
			"executionClass",
			"implementationManifestDigest",
			"mainGraphEvidenceDigest",
			"materialFreeCanonicalProjection",
			"maxActiveEffects",
			"networkCalls",
			"providerAttemptCount",
			"qualificationDigest",
			"qualified",
			"retryWaitCount",
			"retryWireIdentityPassed",
			"schemaVersion",
			"terminalFailureGraphEvidenceDigest",
			"workspaceResidueCount",
		],
		"current.provider.bundle.qualification",
	);
	exactKeys(
		generation,
		[
			"baselineBasis",
			"generationDigest",
			"generationRef",
			"implementationManifestDigest",
			"mainGraphEvidenceDigest",
			"qualificationDigest",
			"schemaVersion",
		],
		"current.provider.bundle.generation",
	);
	if (
		candidate.schemaVersion !== CURRENT_GRAPH_PROVIDER_BUNDLE_SCHEMA ||
		qualification.schemaVersion !== CURRENT_GRAPH_PROVIDER_QUALIFICATION_SCHEMA ||
		generation.schemaVersion !== CURRENT_GRAPH_PROVIDER_GENERATION_SCHEMA ||
		qualification.decisionRef !== "graphrefly-ts:D2" ||
		qualification.executionClass !== "injected-no-network" ||
		qualification.d1Commit !== D1_COMMIT ||
		qualification.d1BundleArtifactDigest !== D1_BUNDLE_ARTIFACT_DIGEST ||
		qualification.d1ImplementationManifestDigest !== CURRENT_GRAPH_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.implementationManifestDigest !==
			CURRENT_GRAPH_PROVIDER_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.exactSixArmsCompleted !== true ||
		qualification.coldDidNotCensorWarm !== true ||
		qualification.retryWaitCount !== 1 ||
		qualification.retryWireIdentityPassed !== true ||
		qualification.maxActiveEffects !== 1 ||
		qualification.adapterEvidenceLedgerPresent !== false ||
		qualification.materialFreeCanonicalProjection !== true ||
		qualification.workspaceResidueCount !== 0 ||
		qualification.networkCalls !== 0 ||
		qualification.causalAttribution !== "undetermined" ||
		qualification.efficacyClaim !== "none" ||
		qualification.qualified !== true
	)
		throw new TypeError("current provider qualification coordinates drifted");
	const basis = qualification.baselineBasis;
	if (basis !== "exact-d1-artifact" && basis !== "injected-test")
		throw new TypeError("current provider qualification baseline basis drifted");
	const expectedGenerationRef =
		basis === "exact-d1-artifact"
			? CURRENT_GRAPH_PROVIDER_GENERATION_REF
			: CURRENT_GRAPH_PROVIDER_TEST_GENERATION_REF;
	if (
		generation.generationRef !== expectedGenerationRef ||
		generation.baselineBasis !== basis ||
		generation.implementationManifestDigest !==
			CURRENT_GRAPH_PROVIDER_IMPLEMENTATION_MANIFEST_DIGEST
	)
		throw new TypeError("current provider generation coordinates drifted");
	const mainGraphEvidence = validateCurrentGraphProviderEvidence(candidate.mainGraphEvidence);
	const terminalFailureGraphEvidence = validateCurrentGraphProviderEvidence(
		candidate.terminalFailureGraphEvidence,
	);
	const cleanupFailureGraphEvidence = validateCurrentGraphProviderEvidence(
		candidate.cleanupFailureGraphEvidence,
	);
	if (
		mainGraphEvidence.runStatus !== "complete" ||
		mainGraphEvidence.routeProfile.routeDigest !==
			CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE.routeDigest ||
		mainGraphEvidence.taskProfileDigest !==
			CURRENT_GRAPH_PROVIDER_INJECTED_TASK.taskProfileDigest ||
		mainGraphEvidence.workflowEvidence.runs.length !== CURRENT_GRAPH_ARMS.length ||
		mainGraphEvidence.workflowEvidence.runs.some(
			(run, index) =>
				run.arm !== CURRENT_GRAPH_ARMS[index] ||
				run.status !== "completed" ||
				!run.replacementRecoveryUsed ||
				!run.semanticRecoveryUsed ||
				!run.publicSemanticValidationPassed ||
				!run.hiddenVerifierPassed ||
				run.cleanupStatus !== "completed",
		) ||
		terminalFailureGraphEvidence.routeProfile.routeDigest !==
			CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE.routeDigest ||
		terminalFailureGraphEvidence.taskProfileDigest !==
			CURRENT_GRAPH_PROVIDER_INJECTED_TASK.taskProfileDigest ||
		terminalFailureGraphEvidence.workflowEvidence.runs.length !== CURRENT_GRAPH_ARMS.length ||
		terminalFailureGraphEvidence.workflowEvidence.runs.some(
			(run, index) =>
				run.arm !== CURRENT_GRAPH_ARMS[index] ||
				run.status !== "incomplete" ||
				run.cleanupStatus !== "completed",
		) ||
		cleanupFailureGraphEvidence.routeProfile.routeDigest !==
			CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE.routeDigest ||
		cleanupFailureGraphEvidence.taskProfileDigest !==
			CURRENT_GRAPH_PROVIDER_INJECTED_TASK.taskProfileDigest ||
		cleanupFailureGraphEvidence.runStatus !== "stopped" ||
		cleanupFailureGraphEvidence.workflowEvidence.runs.length !== 1 ||
		cleanupFailureGraphEvidence.workflowEvidence.runs[0]?.cleanupStatus !== "failed" ||
		qualification.providerAttemptCount !== mainGraphEvidence.budget.providerAttempts ||
		qualification.retryWaitCount !==
			mainGraphEvidence.facts.filter((fact) => fact.result.effectKind === "retry-wait").length ||
		qualification.mainGraphEvidenceDigest !== mainGraphEvidence.evidenceDigest ||
		qualification.terminalFailureGraphEvidenceDigest !==
			terminalFailureGraphEvidence.evidenceDigest ||
		qualification.cleanupFailureGraphEvidenceDigest !==
			cleanupFailureGraphEvidence.evidenceDigest ||
		generation.mainGraphEvidenceDigest !== mainGraphEvidence.evidenceDigest ||
		generation.qualificationDigest !== qualification.qualificationDigest
	)
		throw new TypeError("current provider qualification evidence binding drifted");
	for (const [object, key, path] of [
		[qualification, "qualificationDigest", "current.provider.qualification"],
		[generation, "generationDigest", "current.provider.generation"],
		[candidate, "bundleDigest", "current.provider.bundle"],
	] as const) {
		digest(object[key], `${path}.${key}`);
		const material = { ...object } as Record<string, unknown>;
		delete material[key];
		if (empiricalStrictJsonDigest(material) !== object[key])
			throw new TypeError(`${path} digest drifted`);
	}
	const validated = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_PROVIDER_BUNDLE_SCHEMA,
		mainGraphEvidence,
		terminalFailureGraphEvidence,
		cleanupFailureGraphEvidence,
		qualification,
		generation,
		bundleDigest: candidate.bundleDigest,
	}) as CurrentGraphProviderQualificationBundleV1;
	if (strictJsonCodec.encode(validated).byteLength > CURRENT_GRAPH_PROVIDER_MAX_BUNDLE_BYTES)
		throw new TypeError("current provider qualification bundle exceeded its byte bound");
	return validated;
}

interface FileIdentity {
	readonly dev: number;
	readonly ino: number;
}

async function assertDirectory(path: string, identity: FileIdentity, mode: number) {
	const stat = await lstat(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o777) !== mode ||
		stat.nlink < 1 ||
		stat.dev !== identity.dev ||
		stat.ino !== identity.ino ||
		(await realpath(path)) !== path
	)
		throw new TypeError("current provider persistence directory identity drifted");
}

async function writePrivateFile(path: string, bytes: Uint8Array) {
	const handle = await open(
		path,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
		const stat = await handle.stat();
		if (
			!stat.isFile() ||
			stat.isSymbolicLink() ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.nlink !== 1
		)
			throw new TypeError("current provider persistence file identity drifted");
		return Object.freeze({ dev: stat.dev, ino: stat.ino });
	} finally {
		await handle.close();
	}
}

async function assertPrivateFile(path: string, identity: FileIdentity, bytes: Uint8Array) {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (
			!stat.isFile() ||
			stat.isSymbolicLink() ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.nlink !== 1 ||
			stat.dev !== identity.dev ||
			stat.ino !== identity.ino ||
			!sameBytes(new Uint8Array(await handle.readFile()), bytes)
		)
			throw new TypeError("current provider persistence file readback drifted");
	} finally {
		await handle.close();
	}
}

async function removeOwned(
	path: string,
	identity: FileIdentity,
	parent: string,
	parentHandle: Awaited<ReturnType<typeof open>>,
) {
	await assertDirectory(path, identity, 0o700);
	const tombstone = join(parent, `.current-d2-tombstone-${randomUUID()}`);
	await rename(path, tombstone);
	const moved = await lstat(tombstone);
	if (moved.dev !== identity.dev || moved.ino !== identity.ino)
		throw new TypeError("current provider persistence tombstone ownership drifted");
	await rm(tombstone, { recursive: true, force: true });
	await parentHandle.sync();
}

async function persistCurrentGraphProviderQualificationBundleInternal(
	input: {
		readonly privateRoot: string;
		readonly bundle: CurrentGraphProviderQualificationBundleV1;
		readonly fault?: CurrentGraphProviderPersistenceFaultV1;
	},
	allowInjectedTest: boolean,
): Promise<CurrentGraphProviderPersistenceReceiptV1> {
	const captured = record(input, "current.provider.persistence");
	exactKeys(
		captured,
		Object.hasOwn(captured, "fault")
			? ["bundle", "fault", "privateRoot"]
			: ["bundle", "privateRoot"],
		"current.provider.persistence",
	);
	if (typeof captured.privateRoot !== "string" || !isAbsolute(captured.privateRoot))
		throw new TypeError("current provider private root must be absolute");
	const privateRoot = await realpath(captured.privateRoot);
	if (privateRoot !== captured.privateRoot)
		throw new TypeError("current provider private root must be canonical");
	const bundle = validateCurrentGraphProviderQualificationBundle(captured.bundle);
	if (!constructedBundles.delete(captured.bundle as object))
		throw new TypeError("current provider persistence bundle is forged or replayed");
	if (!allowInjectedTest && bundle.qualification.baselineBasis !== "exact-d1-artifact")
		throw new TypeError(
			"current provider production persistence requires exact D1 artifact admission",
		);
	if (allowInjectedTest && bundle.qualification.baselineBasis !== "injected-test")
		throw new TypeError("current provider test persistence requires injected-test admission");
	let faultStage: FaultStage | null = null;
	if (Object.hasOwn(captured, "fault")) {
		if (captured.fault === null || typeof captured.fault !== "object")
			throw new TypeError("current provider persistence fault is invalid");
		faultStage = persistenceFaults.get(captured.fault) ?? null;
		if (faultStage === null) throw new TypeError("current provider persistence fault is forged");
		persistenceFaults.delete(captured.fault);
	}
	const rootStat = await lstat(privateRoot);
	const rootIdentity = Object.freeze({ dev: rootStat.dev, ino: rootStat.ino });
	await assertDirectory(privateRoot, rootIdentity, 0o700);
	const parentHandle = await open(
		privateRoot,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	const generationRef = bundle.generation.generationRef;
	const finalRoot = join(privateRoot, generationRef);
	const stagingRoot = join(finalRoot, "staging");
	const artifactsRoot = join(finalRoot, "artifacts");
	const bundlePath = join(artifactsRoot, "bundle.v1.json");
	const markerPath = join(finalRoot, "commit.v1.json");
	let finalHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactsHandle: Awaited<ReturnType<typeof open>> | null = null;
	let finalIdentity: FileIdentity | null = null;
	let artifactsIdentity: FileIdentity | null = null;
	let receipt: CurrentGraphProviderPersistenceReceiptV1 | null = null;
	let operationError: unknown = null;
	try {
		const parentStat = await parentHandle.stat();
		if (parentStat.dev !== rootIdentity.dev || parentStat.ino !== rootIdentity.ino)
			throw new TypeError("current provider persistence parent handle drifted");
		await mkdir(finalRoot, { mode: 0o700 });
		finalHandle = await open(
			finalRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const finalStat = await finalHandle.stat();
		finalIdentity = Object.freeze({ dev: finalStat.dev, ino: finalStat.ino });
		await assertDirectory(finalRoot, finalIdentity, 0o700);
		await finalHandle.sync();
		await parentHandle.sync();
		if (faultStage === "after-claim")
			throw new TypeError("current provider injected after-claim failure");
		await mkdir(stagingRoot, { mode: 0o700 });
		artifactsHandle = await open(
			stagingRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const artifactsStat = await artifactsHandle.stat();
		artifactsIdentity = Object.freeze({ dev: artifactsStat.dev, ino: artifactsStat.ino });
		const bytes = strictJsonCodec.encode(bundle);
		if (bytes.byteLength > CURRENT_GRAPH_PROVIDER_MAX_BUNDLE_BYTES)
			throw new TypeError("current provider persisted bundle exceeded its byte bound");
		const bundleIdentity = await writePrivateFile(join(stagingRoot, "bundle.v1.json"), bytes);
		await artifactsHandle.sync();
		await assertPrivateFile(join(stagingRoot, "bundle.v1.json"), bundleIdentity, bytes);
		if (faultStage === "after-write")
			throw new TypeError("current provider injected after-write failure");
		await rename(stagingRoot, artifactsRoot);
		await assertDirectory(artifactsRoot, artifactsIdentity, 0o700);
		await finalHandle.sync();
		if (faultStage === "after-rename")
			throw new TypeError("current provider injected after-rename failure");
		const markerMaterial = strictSnapshot({
			schemaVersion: "graphrefly-ts.d2.current-graph-native-provider-commit.v1",
			generationRef,
			bundleDigest: bundle.bundleDigest,
			bundleArtifactDigest: empiricalSha256(bytes),
		});
		const markerBytes = strictJsonCodec.encode(markerMaterial);
		const markerIdentity = await writePrivateFile(markerPath, markerBytes);
		await finalHandle.sync();
		await parentHandle.sync();
		if (faultStage === "after-marker")
			throw new TypeError("current provider injected after-marker failure");
		await assertPrivateFile(bundlePath, bundleIdentity, bytes);
		await assertPrivateFile(markerPath, markerIdentity, markerBytes);
		const [finalStable, artifactsStable, parentStable] = await Promise.all([
			finalHandle.stat(),
			artifactsHandle.stat(),
			parentHandle.stat(),
		]);
		if (
			finalStable.dev !== finalIdentity.dev ||
			finalStable.ino !== finalIdentity.ino ||
			artifactsStable.dev !== artifactsIdentity.dev ||
			artifactsStable.ino !== artifactsIdentity.ino ||
			parentStable.dev !== rootIdentity.dev ||
			parentStable.ino !== rootIdentity.ino
		)
			throw new TypeError("current provider persistence stable handle drifted");
		await assertDirectory(privateRoot, rootIdentity, 0o700);
		await assertDirectory(finalRoot, finalIdentity, 0o700);
		await assertDirectory(artifactsRoot, artifactsIdentity, 0o700);
		await assertPrivateFile(bundlePath, bundleIdentity, bytes);
		await assertPrivateFile(markerPath, markerIdentity, markerBytes);
		const receiptMaterial = strictSnapshot({
			generationRef,
			bundleDigest: bundle.bundleDigest,
			bundleArtifactDigest: empiricalSha256(bytes),
			finalRoot,
		});
		receipt = Object.freeze({
			...receiptMaterial,
			receiptDigest: empiricalStrictJsonDigest(receiptMaterial),
		});
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
			"current provider persistence handle cleanup failed",
		);
	let cleanupError: unknown = null;
	if (operationError !== null && finalIdentity !== null) {
		try {
			await removeOwned(finalRoot, finalIdentity, privateRoot, parentHandle);
		} catch (error) {
			cleanupError = error;
		}
	}
	const parentClose = await Promise.allSettled([parentHandle.close()]);
	if (operationError !== null) {
		const errors = [operationError];
		if (cleanupError !== null) errors.push(cleanupError);
		if (parentClose[0]?.status === "rejected") errors.push(parentClose[0].reason);
		if (errors.length > 1)
			throw new AggregateError(errors, "current provider persistence cleanup failed");
		throw operationError;
	}
	if (receipt === null) throw new TypeError("current provider persistence did not linearize");
	return receipt;
}

export async function persistCurrentGraphProviderQualificationBundle(input: {
	readonly privateRoot: string;
	readonly bundle: CurrentGraphProviderQualificationBundleV1;
	readonly fault?: CurrentGraphProviderPersistenceFaultV1;
}): Promise<CurrentGraphProviderPersistenceReceiptV1> {
	return persistCurrentGraphProviderQualificationBundleInternal(input, false);
}

export async function persistCurrentGraphProviderInjectedTestBundleForTest(input: {
	readonly privateRoot: string;
	readonly bundle: CurrentGraphProviderQualificationBundleV1;
	readonly fault?: CurrentGraphProviderPersistenceFaultV1;
}): Promise<CurrentGraphProviderPersistenceReceiptV1> {
	return persistCurrentGraphProviderQualificationBundleInternal(input, true);
}

export async function readCurrentGraphProviderD1Baseline(path: string) {
	return admitCurrentGraphProviderD1BaselineArtifact(new Uint8Array(await readFile(path)));
}
