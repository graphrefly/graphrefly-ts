import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import { persistCurrentGraphPrivateGeneration } from "./d6-current-private-persistence.js";
import {
	admitCurrentGraphProviderEffectResult,
	type CurrentGraphProviderAdmittedEffectV1,
	type CurrentGraphProviderEffectResultInputV1,
	type CurrentGraphProviderEvidenceV1,
	createCurrentGraphProviderAuthority,
	snapshotCurrentGraphProviderEvidence,
	takeCurrentGraphProviderEffect,
	validateCurrentGraphProviderEvidence,
} from "./d6-current-provider-authority.js";
import {
	type CurrentGraphLiveDispatchClaimV1,
	type CurrentGraphLiveExecutionAuthorityV1,
	consumeCurrentGraphLiveExecutionAuthority,
} from "./d8-current-live-claim.js";
import {
	CURRENT_GRAPH_LIVE_COORDINATES_DIGEST,
	CURRENT_GRAPH_LIVE_DECISION_REF,
	CURRENT_GRAPH_LIVE_GENERATION_REF,
	CURRENT_GRAPH_LIVE_LIMITS,
	CURRENT_GRAPH_LIVE_ROUTE,
	CURRENT_GRAPH_LIVE_TASK,
} from "./d8-current-live-coordinates.js";

export const CURRENT_GRAPH_LIVE_BUNDLE_SCHEMA =
	"graphrefly-ts.d8.current-graph-live-bundle.v1" as const;
export const CURRENT_GRAPH_LIVE_PARTIAL_GRAPH_SCHEMA =
	"graphrefly-ts.d8.current-graph-live-partial-graph.v1" as const;
export const CURRENT_GRAPH_LIVE_GENERATION_SCHEMA =
	"graphrefly-ts.d8.current-graph-live-generation.v1" as const;
export const CURRENT_GRAPH_LIVE_TERMINAL_RECEIPT_SCHEMA =
	"graphrefly-ts.d8.current-graph-live-terminal-receipt.v1" as const;
export const CURRENT_GRAPH_LIVE_PERSISTENCE_SCHEMA =
	"graphrefly-ts.d8.current-graph-live-persistence.v1" as const;
export const CURRENT_GRAPH_LIVE_PREEXECUTION_FAILURE_SCHEMA =
	"graphrefly-ts.d8.current-graph-live-preexecution-failure.v1" as const;
export const CURRENT_GRAPH_LIVE_MAX_BUNDLE_BYTES = 4_194_304;

type CurrentGraphLiveFactV1 = CurrentGraphProviderEvidenceV1["facts"][number];

export interface CurrentGraphLivePartialGraphV1 {
	readonly schemaVersion: typeof CURRENT_GRAPH_LIVE_PARTIAL_GRAPH_SCHEMA;
	readonly decisionRef: typeof CURRENT_GRAPH_LIVE_DECISION_REF;
	readonly routeDigest: string;
	readonly taskProfileDigest: string;
	readonly facts: readonly CurrentGraphLiveFactV1[];
	readonly activeRequestDigest: string | null;
	readonly failureCode: "executor-boundary-failed" | "graph-admission-failed";
	readonly failureEffectKind: string | null;
	readonly partialGraphDigest: string;
}

export interface CurrentGraphLiveBundleV1 {
	readonly schemaVersion: typeof CURRENT_GRAPH_LIVE_BUNDLE_SCHEMA;
	readonly decisionRef: typeof CURRENT_GRAPH_LIVE_DECISION_REF;
	readonly executionClass: "live-provider" | "injected-no-network";
	readonly disposition: "success" | "partial-failure";
	readonly coordinatesDigest: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly d6QualificationArtifactDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly claimDigest: string;
	readonly currentKeyAdmissionDigest: string;
	readonly graphEvidence: CurrentGraphProviderEvidenceV1 | null;
	readonly partialGraphEvidence: CurrentGraphLivePartialGraphV1 | null;
	readonly generation: Readonly<Record<string, unknown>> | null;
	readonly terminalReceipt: Readonly<Record<string, unknown>>;
	readonly bundleDigest: string;
}

export interface CurrentGraphLiveExecutorV1 {
	readonly execute: (
		effect: CurrentGraphProviderAdmittedEffectV1,
	) => Promise<CurrentGraphProviderEffectResultInputV1>;
	readonly dispose: () => Promise<void>;
}

const constructedBundles = new WeakSet<object>();

export async function persistCurrentGraphLivePreexecutionFailure(inputValue: {
	readonly privateRoot: string;
	readonly claim: CurrentGraphLiveDispatchClaimV1;
	readonly implementationManifestDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly allowInjectedTestScope?: boolean;
}) {
	const input = record(inputValue, "current.live.preexecutionFailure.input");
	exactKeys(
		input,
		Object.hasOwn(input, "allowInjectedTestScope")
			? [
					"allowInjectedTestScope",
					"claim",
					"implementationManifestDigest",
					"pricingObservationDigest",
					"privateRoot",
					"zeroByokObservationDigest",
				]
			: [
					"claim",
					"implementationManifestDigest",
					"pricingObservationDigest",
					"privateRoot",
					"zeroByokObservationDigest",
				],
		"current.live.preexecutionFailure.input",
	);
	const claim = record(input.claim, "current.live.preexecutionFailure.claim");
	for (const key of [
		"claimDigest",
		"implementationManifestDigest",
		"qualificationArtifactDigest",
		"qualificationDigest",
	] as const)
		digest(claim[key], `current.live.preexecutionFailure.claim.${key}`);
	if (
		claim.decisionRef !== CURRENT_GRAPH_LIVE_DECISION_REF ||
		claim.generationRef !== CURRENT_GRAPH_LIVE_GENERATION_REF ||
		claim.coordinatesDigest !== CURRENT_GRAPH_LIVE_COORDINATES_DIGEST ||
		(claim.scope !== "live-fixed-root" && input.allowInjectedTestScope !== true) ||
		claim.blockCount !== 1 ||
		claim.blockHardCapMicrousd !== 6_000_000 ||
		claim.localEvalNoResetLimitMicrousd !== 32_000_000 ||
		claim.implementationManifestDigest !== input.implementationManifestDigest
	)
		throw new TypeError("current live pre-execution failure claim drifted");
	const material = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_LIVE_PREEXECUTION_FAILURE_SCHEMA,
		decisionRef: CURRENT_GRAPH_LIVE_DECISION_REF,
		generationRef: CURRENT_GRAPH_LIVE_GENERATION_REF,
		disposition: "partial-failure" as const,
		failurePhase: "current-key-admission" as const,
		failureCode: "current-key-admission-failed" as const,
		coordinatesDigest: CURRENT_GRAPH_LIVE_COORDINATES_DIGEST,
		claimDigest: claim.claimDigest,
		implementationManifestDigest: digest(
			input.implementationManifestDigest,
			"current.live.preexecutionFailure.implementationManifestDigest",
		),
		qualificationArtifactDigest: claim.qualificationArtifactDigest,
		qualificationDigest: claim.qualificationDigest,
		pricingObservationDigest: digest(
			input.pricingObservationDigest,
			"current.live.preexecutionFailure.pricingObservationDigest",
		),
		zeroByokObservationDigest: digest(
			input.zeroByokObservationDigest,
			"current.live.preexecutionFailure.zeroByokObservationDigest",
		),
		providerAttempts: 0 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const failure = Object.freeze({
		...material,
		failureDigest: empiricalStrictJsonDigest(material),
	});
	const bytes = strictJsonCodec.encode(failure as unknown as StrictJsonValue);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d8.current-graph-live-commit.v1",
		generationRef: CURRENT_GRAPH_LIVE_GENERATION_REF,
		disposition: "partial-failure" as const,
		bundleDigest: null,
		bundleArtifactDigest: null,
		terminalReceiptDigest: failure.failureDigest,
	});
	const commit = Object.freeze({
		...commitMaterial,
		commitDigest: empiricalStrictJsonDigest(commitMaterial),
	});
	await persistCurrentGraphPrivateGeneration({
		privateRoot: String(input.privateRoot),
		generationRef: CURRENT_GRAPH_LIVE_GENERATION_REF,
		artifacts: { "preexecution-failure.v1.json": bytes },
		commitBytes: strictJsonCodec.encode(commit as unknown as StrictJsonValue),
	});
	return Object.freeze({
		schemaVersion: CURRENT_GRAPH_LIVE_PERSISTENCE_SCHEMA,
		generationRef: CURRENT_GRAPH_LIVE_GENERATION_REF,
		disposition: "partial-failure" as const,
		failureDigest: failure.failureDigest,
		commitDigest: commit.commitDigest,
		persistenceDigest: empiricalStrictJsonDigest({
			generationRef: CURRENT_GRAPH_LIVE_GENERATION_REF,
			failureDigest: failure.failureDigest,
			commitDigest: commit.commitDigest,
		}),
	});
}

function failedResultFor(
	effect: CurrentGraphProviderAdmittedEffectV1,
	error: unknown,
): CurrentGraphProviderEffectResultInputV1 {
	const evidenceDigest = empiricalStrictJsonDigest({
		requestDigest: effect.request.requestDigest,
		failureClass:
			error instanceof DOMException && error.name === "AbortError" ? "cancelled" : "executor-threw",
	});
	const elapsed = effect.request.reservation.maxElapsedMs;
	if (effect.request.effectKind === "provider-request")
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
				actualElapsedMs: elapsed,
				costBasis: "conservative-reservation",
			},
			evidenceDigest,
		};
	if (effect.request.effectKind === "retry-wait")
		return {
			effectKind: "retry-wait",
			status: "failed",
			actualElapsedMs: elapsed,
			evidenceDigest,
		};
	if (effect.request.effectKind === "materialization")
		return {
			effectKind: "materialization",
			status: "failed",
			workspaceStateDigest: null,
			evidenceDigest,
			actualCostMicrousd: 0,
			actualElapsedMs: elapsed,
		};
	if (effect.request.effectKind === "tool-action") {
		const state = effect.request.workspaceStateDigest ?? empiricalStrictJsonDigest({ empty: true });
		return {
			effectKind: "tool-action",
			toolRef: effect.request.toolRef!,
			status: "failed",
			causeCode: "unexpected-arguments",
			workspaceStateBeforeDigest: state,
			workspaceStateAfterDigest: state,
			nonEmptyDiff: false,
			evidenceDigest,
			actualCostMicrousd: 0,
			actualElapsedMs: elapsed,
		};
	}
	if (effect.request.effectKind === "public-semantic-validation")
		return {
			effectKind: "public-semantic-validation",
			status: "failed",
			criterionFailures: [
				"canonical-proposal-not-admitted",
				"malformed-provenance-not-rejected",
				"local-reconstruction-not-rejected",
				"authorization-claim-invariant-regressed",
			],
			workspaceStateDigest:
				effect.request.workspaceStateDigest ?? empiricalStrictJsonDigest({ empty: true }),
			evidenceDigest,
			actualCostMicrousd: 0,
			actualElapsedMs: elapsed,
		};
	if (effect.request.effectKind === "hidden-verifier")
		return {
			effectKind: "hidden-verifier",
			status: "failed",
			workspaceStateDigest:
				effect.request.workspaceStateDigest ?? empiricalStrictJsonDigest({ empty: true }),
			evidenceDigest,
			actualCostMicrousd: 0,
			actualElapsedMs: elapsed,
		};
	return {
		effectKind: "cleanup",
		status: "failed",
		workspaceStateDigest: effect.request.workspaceStateDigest,
		evidenceDigest,
		actualCostMicrousd: 0,
		actualElapsedMs: elapsed,
	};
}

function completeSixArms(evidence: CurrentGraphProviderEvidenceV1): boolean {
	return (
		evidence.runStatus === "complete" &&
		evidence.workflowEvidence.runs.length === 6 &&
		evidence.workflowEvidence.runs.every(
			(run) =>
				run.status === "completed" &&
				run.publicSemanticValidationPassed &&
				run.hiddenVerifierPassed &&
				run.cleanupStatus === "completed",
		)
	);
}

export async function runCurrentGraphLiveMeasurement(inputValue: {
	readonly executionAuthority: CurrentGraphLiveExecutionAuthorityV1;
	readonly executionClass: "live-provider" | "injected-no-network";
	readonly executor: CurrentGraphLiveExecutorV1;
	readonly implementationManifestDigest: string;
	readonly d6QualificationArtifactDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
}): Promise<CurrentGraphLiveBundleV1> {
	const input = record(inputValue, "current.live.run.input");
	exactKeys(
		input,
		[
			"d6QualificationArtifactDigest",
			"executionAuthority",
			"executionClass",
			"executor",
			"implementationManifestDigest",
			"pricingObservationDigest",
			"zeroByokObservationDigest",
		],
		"current.live.run.input",
	);
	const authority = consumeCurrentGraphLiveExecutionAuthority(input.executionAuthority);
	const executorRecord = record(input.executor, "current.live.executor");
	exactKeys(executorRecord, ["dispose", "execute"], "current.live.executor");
	if (typeof executorRecord.execute !== "function" || typeof executorRecord.dispose !== "function")
		throw new TypeError("current live executor is invalid");
	const graphAuthority = createCurrentGraphProviderAuthority({
		limits: CURRENT_GRAPH_LIVE_LIMITS,
		routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
		taskProfile: CURRENT_GRAPH_LIVE_TASK,
	});
	const facts: CurrentGraphLiveFactV1[] = [];
	let graphEvidence: CurrentGraphProviderEvidenceV1 | null = null;
	let active: CurrentGraphProviderAdmittedEffectV1 | null = null;
	let failureCode: "executor-boundary-failed" | "graph-admission-failed" | null = null;
	let failureEffectKind: string | null = null;
	try {
		for (let guard = 0; guard < CURRENT_GRAPH_LIVE_LIMITS.maxEffectFacts; guard += 1) {
			active = takeCurrentGraphProviderEffect(graphAuthority);
			if (active === null) {
				graphEvidence = validateCurrentGraphProviderEvidence(
					snapshotCurrentGraphProviderEvidence(graphAuthority),
				);
				break;
			}
			let result: CurrentGraphProviderEffectResultInputV1;
			try {
				result = await Reflect.apply(executorRecord.execute, input.executor, [active]);
			} catch (error) {
				failureCode = "executor-boundary-failed";
				failureEffectKind = active.request.effectKind;
				result = failedResultFor(active, error);
			}
			try {
				facts.push(
					admitCurrentGraphProviderEffectResult(
						graphAuthority,
						active.request.requestDigest,
						result,
					),
				);
			} catch {
				failureCode = "graph-admission-failed";
				failureEffectKind = active.request.effectKind;
				break;
			}
		}
	} finally {
		try {
			await Reflect.apply(executorRecord.dispose, input.executor, []);
		} catch {
			failureCode ??= "executor-boundary-failed";
			failureEffectKind ??= "cleanup";
		}
	}
	const success = graphEvidence !== null && completeSixArms(graphEvidence) && failureCode === null;
	const partialGraphEvidence =
		success || graphEvidence !== null
			? null
			: (() => {
					const material = strictSnapshot({
						schemaVersion: CURRENT_GRAPH_LIVE_PARTIAL_GRAPH_SCHEMA,
						decisionRef: CURRENT_GRAPH_LIVE_DECISION_REF,
						routeDigest: CURRENT_GRAPH_LIVE_ROUTE.routeDigest,
						taskProfileDigest: CURRENT_GRAPH_LIVE_TASK.taskProfileDigest,
						facts,
						activeRequestDigest: active?.request.requestDigest ?? null,
						failureCode: failureCode ?? "graph-admission-failed",
						failureEffectKind,
					});
					return Object.freeze({
						...material,
						partialGraphDigest: empiricalStrictJsonDigest(material),
					}) as CurrentGraphLivePartialGraphV1;
				})();
	const generation = success
		? (() => {
				const material = strictSnapshot({
					schemaVersion: CURRENT_GRAPH_LIVE_GENERATION_SCHEMA,
					generationRef: CURRENT_GRAPH_LIVE_GENERATION_REF,
					graphEvidenceDigest: graphEvidence!.evidenceDigest,
					coordinatesDigest: CURRENT_GRAPH_LIVE_COORDINATES_DIGEST,
					implementationManifestDigest: digest(
						input.implementationManifestDigest,
						"current.live.implementationManifestDigest",
					),
					qualificationArtifactDigest: authority.claim.qualificationArtifactDigest,
					qualificationDigest: authority.claim.qualificationDigest,
					causalAttribution: "undetermined" as const,
					efficacyClaim: "none" as const,
				});
				return Object.freeze({
					...material,
					generationDigest: empiricalStrictJsonDigest(material),
				});
			})()
		: null;
	const terminalMaterial = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_LIVE_TERMINAL_RECEIPT_SCHEMA,
		decisionRef: CURRENT_GRAPH_LIVE_DECISION_REF,
		disposition: success ? ("success" as const) : ("partial-failure" as const),
		claimDigest: authority.claim.claimDigest,
		currentKeyAdmissionDigest: authority.currentKeyAdmission.admissionDigest,
		graphEvidenceDigest: graphEvidence?.evidenceDigest ?? null,
		partialGraphDigest: partialGraphEvidence?.partialGraphDigest ?? null,
		failureCode: success ? null : (failureCode ?? "graph-admission-failed"),
		failureEffectKind: success ? null : failureEffectKind,
		providerAttempts:
			graphEvidence?.budget.providerAttempts ??
			facts.filter((fact) => fact.request.effectKind === "provider-request").length,
		confirmedCostMicrousd:
			graphEvidence?.budget.confirmedCostMicrousd ??
			facts.reduce((sum, fact) => sum + fact.reconciliation.actualCostMicrousd, 0),
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const terminalReceipt = Object.freeze({
		...terminalMaterial,
		terminalReceiptDigest: empiricalStrictJsonDigest(terminalMaterial),
	});
	const bundleMaterial = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_LIVE_BUNDLE_SCHEMA,
		decisionRef: CURRENT_GRAPH_LIVE_DECISION_REF,
		executionClass: input.executionClass,
		disposition: success ? ("success" as const) : ("partial-failure" as const),
		coordinatesDigest: CURRENT_GRAPH_LIVE_COORDINATES_DIGEST,
		implementationManifestDigest: digest(
			input.implementationManifestDigest,
			"current.live.implementationManifestDigest",
		),
		qualificationArtifactDigest: authority.claim.qualificationArtifactDigest,
		qualificationDigest: authority.claim.qualificationDigest,
		d6QualificationArtifactDigest: digest(
			input.d6QualificationArtifactDigest,
			"current.live.d6QualificationArtifactDigest",
		),
		pricingObservationDigest: digest(
			input.pricingObservationDigest,
			"current.live.pricingObservationDigest",
		),
		zeroByokObservationDigest: digest(
			input.zeroByokObservationDigest,
			"current.live.zeroByokObservationDigest",
		),
		claimDigest: authority.claim.claimDigest,
		currentKeyAdmissionDigest: authority.currentKeyAdmission.admissionDigest,
		graphEvidence,
		partialGraphEvidence,
		generation,
		terminalReceipt,
	});
	const bundle = Object.freeze({
		...bundleMaterial,
		bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
	}) as CurrentGraphLiveBundleV1;
	if (
		strictJsonCodec.encode(bundle as unknown as StrictJsonValue).byteLength >
		CURRENT_GRAPH_LIVE_MAX_BUNDLE_BYTES
	)
		throw new TypeError("current live bundle exceeded its byte bound");
	constructedBundles.add(bundle);
	return bundle;
}

function validatePartial(value: unknown): CurrentGraphLivePartialGraphV1 {
	const candidate = record(value, "current.live.partialGraph");
	exactKeys(
		candidate,
		[
			"activeRequestDigest",
			"decisionRef",
			"facts",
			"failureCode",
			"failureEffectKind",
			"partialGraphDigest",
			"routeDigest",
			"schemaVersion",
			"taskProfileDigest",
		],
		"current.live.partialGraph",
	);
	if (
		candidate.schemaVersion !== CURRENT_GRAPH_LIVE_PARTIAL_GRAPH_SCHEMA ||
		candidate.decisionRef !== CURRENT_GRAPH_LIVE_DECISION_REF ||
		candidate.routeDigest !== CURRENT_GRAPH_LIVE_ROUTE.routeDigest ||
		candidate.taskProfileDigest !== CURRENT_GRAPH_LIVE_TASK.taskProfileDigest
	)
		throw new TypeError("current live partial Graph coordinates drifted");
	const facts = array(candidate.facts, "current.live.partialGraph.facts");
	if (facts.length > CURRENT_GRAPH_LIVE_LIMITS.maxEffectFacts)
		throw new TypeError("current live partial Graph fact bound drifted");
	for (const [index, factValue] of facts.entries()) {
		const fact = record(factValue, `current.live.partialGraph.facts[${index}]`);
		if (fact.sequence !== index) throw new TypeError("current live partial Graph sequence drifted");
		digest(fact.factDigest, `current.live.partialGraph.facts[${index}].factDigest`);
	}
	const { partialGraphDigest, ...material } = candidate;
	if (partialGraphDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("current live partial Graph digest drifted");
	return strictSnapshot(candidate) as unknown as CurrentGraphLivePartialGraphV1;
}

export function validateCurrentGraphLiveBundle(value: unknown): CurrentGraphLiveBundleV1 {
	const candidate = record(value, "current.live.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"claimDigest",
			"coordinatesDigest",
			"currentKeyAdmissionDigest",
			"d6QualificationArtifactDigest",
			"decisionRef",
			"disposition",
			"executionClass",
			"generation",
			"graphEvidence",
			"implementationManifestDigest",
			"partialGraphEvidence",
			"pricingObservationDigest",
			"qualificationArtifactDigest",
			"qualificationDigest",
			"schemaVersion",
			"terminalReceipt",
			"zeroByokObservationDigest",
		],
		"current.live.bundle",
	);
	if (
		candidate.schemaVersion !== CURRENT_GRAPH_LIVE_BUNDLE_SCHEMA ||
		candidate.decisionRef !== CURRENT_GRAPH_LIVE_DECISION_REF ||
		candidate.coordinatesDigest !== CURRENT_GRAPH_LIVE_COORDINATES_DIGEST ||
		(candidate.executionClass !== "live-provider" &&
			candidate.executionClass !== "injected-no-network")
	)
		throw new TypeError("current live bundle coordinates drifted");
	for (const key of [
		"claimDigest",
		"currentKeyAdmissionDigest",
		"d6QualificationArtifactDigest",
		"implementationManifestDigest",
		"pricingObservationDigest",
		"qualificationArtifactDigest",
		"qualificationDigest",
		"zeroByokObservationDigest",
	] as const)
		digest(candidate[key], `current.live.bundle.${key}`);
	const disposition = candidate.disposition;
	if (disposition !== "success" && disposition !== "partial-failure")
		throw new TypeError("current live bundle disposition drifted");
	const graphEvidence =
		candidate.graphEvidence === null
			? null
			: validateCurrentGraphProviderEvidence(candidate.graphEvidence);
	const partialGraphEvidence =
		candidate.partialGraphEvidence === null
			? null
			: validatePartial(candidate.partialGraphEvidence);
	if (
		(disposition === "success" &&
			(graphEvidence === null || partialGraphEvidence !== null || candidate.generation === null)) ||
		(disposition === "partial-failure" && candidate.generation !== null) ||
		(graphEvidence === null) === (partialGraphEvidence === null)
	)
		throw new TypeError("current live success/partial evidence cardinality drifted");
	if (disposition === "success" && !completeSixArms(graphEvidence!))
		throw new TypeError("current live success does not contain six completed arms");
	const terminal = record(candidate.terminalReceipt, "current.live.terminalReceipt");
	exactKeys(
		terminal,
		[
			"causalAttribution",
			"claimDigest",
			"confirmedCostMicrousd",
			"currentKeyAdmissionDigest",
			"decisionRef",
			"disposition",
			"efficacyClaim",
			"failureCode",
			"failureEffectKind",
			"graphEvidenceDigest",
			"partialGraphDigest",
			"providerAttempts",
			"schemaVersion",
			"terminalReceiptDigest",
		],
		"current.live.terminalReceipt",
	);
	if (
		terminal.schemaVersion !== CURRENT_GRAPH_LIVE_TERMINAL_RECEIPT_SCHEMA ||
		terminal.decisionRef !== CURRENT_GRAPH_LIVE_DECISION_REF ||
		terminal.disposition !== disposition ||
		terminal.claimDigest !== candidate.claimDigest ||
		terminal.currentKeyAdmissionDigest !== candidate.currentKeyAdmissionDigest ||
		terminal.graphEvidenceDigest !== (graphEvidence?.evidenceDigest ?? null) ||
		terminal.partialGraphDigest !== (partialGraphEvidence?.partialGraphDigest ?? null) ||
		terminal.causalAttribution !== "undetermined" ||
		terminal.efficacyClaim !== "none"
	)
		throw new TypeError("current live terminal receipt cross-binding drifted");
	const { terminalReceiptDigest, ...terminalMaterial } = terminal;
	if (terminalReceiptDigest !== empiricalStrictJsonDigest(terminalMaterial))
		throw new TypeError("current live terminal receipt digest drifted");
	if (candidate.generation !== null) {
		const generation = record(candidate.generation, "current.live.generation");
		exactKeys(
			generation,
			[
				"causalAttribution",
				"coordinatesDigest",
				"efficacyClaim",
				"generationDigest",
				"generationRef",
				"graphEvidenceDigest",
				"implementationManifestDigest",
				"qualificationArtifactDigest",
				"qualificationDigest",
				"schemaVersion",
			],
			"current.live.generation",
		);
		if (
			generation.schemaVersion !== CURRENT_GRAPH_LIVE_GENERATION_SCHEMA ||
			generation.generationRef !== CURRENT_GRAPH_LIVE_GENERATION_REF ||
			generation.graphEvidenceDigest !== graphEvidence?.evidenceDigest ||
			generation.coordinatesDigest !== CURRENT_GRAPH_LIVE_COORDINATES_DIGEST ||
			generation.implementationManifestDigest !== candidate.implementationManifestDigest ||
			generation.qualificationArtifactDigest !== candidate.qualificationArtifactDigest ||
			generation.qualificationDigest !== candidate.qualificationDigest ||
			generation.causalAttribution !== "undetermined" ||
			generation.efficacyClaim !== "none"
		)
			throw new TypeError("current live generation coordinates drifted");
		const { generationDigest, ...generationMaterial } = generation;
		if (generationDigest !== empiricalStrictJsonDigest(generationMaterial))
			throw new TypeError("current live generation digest drifted");
	}
	const { bundleDigest, ...bundleMaterial } = candidate;
	if (bundleDigest !== empiricalStrictJsonDigest(bundleMaterial))
		throw new TypeError("current live bundle digest drifted");
	return strictSnapshot(candidate) as unknown as CurrentGraphLiveBundleV1;
}

export async function persistCurrentGraphLiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: CurrentGraphLiveBundleV1;
}) {
	const input = record(inputValue, "current.live.persistence.input");
	exactKeys(input, ["bundle", "privateRoot"], "current.live.persistence.input");
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.delete(input.bundle)
	)
		throw new TypeError("current live persistence requires a fresh constructed bundle");
	const bundle = validateCurrentGraphLiveBundle(input.bundle);
	const privateRoot = String(input.privateRoot);
	const bundleBytes = strictJsonCodec.encode(bundle as unknown as StrictJsonValue);
	const terminalBytes = strictJsonCodec.encode(bundle.terminalReceipt as StrictJsonValue);
	const artifacts: Record<string, Uint8Array> = {
		"bundle.v1.json": bundleBytes,
		"terminal-receipt.v1.json": terminalBytes,
	};
	if (bundle.generation !== null)
		artifacts["generation.v1.json"] = strictJsonCodec.encode(bundle.generation as StrictJsonValue);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d8.current-graph-live-commit.v1",
		generationRef: CURRENT_GRAPH_LIVE_GENERATION_REF,
		disposition: bundle.disposition,
		bundleDigest: bundle.bundleDigest,
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		terminalReceiptDigest: bundle.terminalReceipt.terminalReceiptDigest,
	});
	const commit = Object.freeze({
		...commitMaterial,
		commitDigest: empiricalStrictJsonDigest(commitMaterial),
	});
	await persistCurrentGraphPrivateGeneration({
		privateRoot,
		generationRef: CURRENT_GRAPH_LIVE_GENERATION_REF,
		artifacts,
		commitBytes: strictJsonCodec.encode(commit as unknown as StrictJsonValue),
	});
	return Object.freeze({
		schemaVersion: CURRENT_GRAPH_LIVE_PERSISTENCE_SCHEMA,
		generationRef: CURRENT_GRAPH_LIVE_GENERATION_REF,
		disposition: bundle.disposition,
		bundleDigest: bundle.bundleDigest,
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		commitDigest: commit.commitDigest,
		persistenceDigest: empiricalStrictJsonDigest({
			generationRef: CURRENT_GRAPH_LIVE_GENERATION_REF,
			bundleDigest: bundle.bundleDigest,
			commitDigest: commit.commitDigest,
		}),
	});
}
