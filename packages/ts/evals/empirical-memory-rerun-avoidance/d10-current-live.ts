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
import type {
	CurrentGraphProviderAdmittedEffectV1,
	CurrentGraphProviderEffectResultInputV1,
	CurrentGraphProviderEvidenceV1,
} from "./d6-current-provider-authority.js";
import {
	admitD9ProviderEffectResult,
	createD9ProviderRejectionAuthority,
	type D9ProviderRejectionEvidenceV1,
	type D9ProviderRejectionFactV1,
	snapshotD9ProviderRejectionEvidence,
	takeD9ProviderEffect,
	validateD9ProviderRejectionEvidence,
} from "./d9-current-provider-rejection-authority.js";
import {
	consumeD10CurrentGraphLiveExecutionAuthority,
	type D10CurrentGraphLiveDispatchClaimV1,
	type D10CurrentGraphLiveExecutionAuthorityV1,
} from "./d10-current-live-claim.js";
import {
	D10_CURRENT_GRAPH_LIVE_COORDINATES_DIGEST,
	D10_CURRENT_GRAPH_LIVE_DECISION_REF,
	D10_CURRENT_GRAPH_LIVE_GENERATION_REF,
	D10_CURRENT_GRAPH_LIVE_LIMITS,
	D10_CURRENT_GRAPH_LIVE_ROUTE,
	D10_CURRENT_GRAPH_LIVE_TASK,
} from "./d10-current-live-coordinates.js";

export const D10_CURRENT_GRAPH_LIVE_BUNDLE_SCHEMA =
	"graphrefly-ts.d10.current-graph-live-bundle.v1" as const;
export const D10_CURRENT_GRAPH_LIVE_PARTIAL_GRAPH_SCHEMA =
	"graphrefly-ts.d10.current-graph-live-partial-graph.v1" as const;
export const D10_CURRENT_GRAPH_LIVE_GENERATION_SCHEMA =
	"graphrefly-ts.d10.current-graph-live-generation.v1" as const;
export const D10_CURRENT_GRAPH_LIVE_TERMINAL_RECEIPT_SCHEMA =
	"graphrefly-ts.d10.current-graph-live-terminal-receipt.v1" as const;
export const D10_CURRENT_GRAPH_LIVE_PERSISTENCE_SCHEMA =
	"graphrefly-ts.d10.current-graph-live-persistence.v1" as const;
export const D10_CURRENT_GRAPH_LIVE_PREEXECUTION_FAILURE_SCHEMA =
	"graphrefly-ts.d10.current-graph-live-preexecution-failure.v1" as const;
export const D10_CURRENT_GRAPH_LIVE_MAX_BUNDLE_BYTES = 4_194_304;

type D10CurrentGraphLiveProviderFactV1 = CurrentGraphProviderEvidenceV1["facts"][number];

export interface D10CurrentGraphLivePartialGraphV1 {
	readonly schemaVersion: typeof D10_CURRENT_GRAPH_LIVE_PARTIAL_GRAPH_SCHEMA;
	readonly decisionRef: typeof D10_CURRENT_GRAPH_LIVE_DECISION_REF;
	readonly routeDigest: string;
	readonly taskProfileDigest: string;
	readonly facts: readonly D10CurrentGraphLiveProviderFactV1[];
	readonly rejectionFacts: readonly D9ProviderRejectionFactV1[];
	readonly activeRequestDigest: string | null;
	readonly failureCode: "executor-boundary-failed" | "graph-admission-failed";
	readonly failureEffectKind: string | null;
	readonly partialGraphDigest: string;
}

export interface D10CurrentGraphLiveBundleV1 {
	readonly schemaVersion: typeof D10_CURRENT_GRAPH_LIVE_BUNDLE_SCHEMA;
	readonly decisionRef: typeof D10_CURRENT_GRAPH_LIVE_DECISION_REF;
	readonly executionClass: "live-provider" | "injected-no-network";
	readonly disposition: "success" | "partial-failure";
	readonly coordinatesDigest: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly d9QualificationArtifactDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly claimDigest: string;
	readonly currentKeyAdmissionDigest: string;
	readonly graphEvidence: D9ProviderRejectionEvidenceV1 | null;
	readonly partialGraphEvidence: D10CurrentGraphLivePartialGraphV1 | null;
	readonly generation: Readonly<Record<string, unknown>> | null;
	readonly terminalReceipt: Readonly<Record<string, unknown>>;
	readonly bundleDigest: string;
}

export interface D10CurrentGraphLiveExecutorV1 {
	readonly execute: (
		effect: CurrentGraphProviderAdmittedEffectV1,
	) => Promise<CurrentGraphProviderEffectResultInputV1>;
	readonly dispose: () => Promise<void>;
}

const constructedBundles = new WeakSet<object>();

export async function persistD10CurrentGraphLivePreexecutionFailure(inputValue: {
	readonly privateRoot: string;
	readonly claim: D10CurrentGraphLiveDispatchClaimV1;
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
		claim.decisionRef !== D10_CURRENT_GRAPH_LIVE_DECISION_REF ||
		claim.generationRef !== D10_CURRENT_GRAPH_LIVE_GENERATION_REF ||
		claim.coordinatesDigest !== D10_CURRENT_GRAPH_LIVE_COORDINATES_DIGEST ||
		(claim.scope !== "live-fixed-root" && input.allowInjectedTestScope !== true) ||
		claim.blockCount !== 1 ||
		claim.blockHardCapMicrousd !== 6_000_000 ||
		claim.localEvalNoResetLimitMicrousd !== 32_000_000 ||
		claim.implementationManifestDigest !== input.implementationManifestDigest
	)
		throw new TypeError("current live pre-execution failure claim drifted");
	const material = strictSnapshot({
		schemaVersion: D10_CURRENT_GRAPH_LIVE_PREEXECUTION_FAILURE_SCHEMA,
		decisionRef: D10_CURRENT_GRAPH_LIVE_DECISION_REF,
		generationRef: D10_CURRENT_GRAPH_LIVE_GENERATION_REF,
		disposition: "partial-failure" as const,
		failurePhase: "current-key-admission" as const,
		failureCode: "current-key-admission-failed" as const,
		coordinatesDigest: D10_CURRENT_GRAPH_LIVE_COORDINATES_DIGEST,
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
		schemaVersion: "graphrefly-ts.d10.current-graph-live-commit.v1",
		generationRef: D10_CURRENT_GRAPH_LIVE_GENERATION_REF,
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
		generationRef: D10_CURRENT_GRAPH_LIVE_GENERATION_REF,
		artifacts: { "preexecution-failure.v1.json": bytes },
		commitBytes: strictJsonCodec.encode(commit as unknown as StrictJsonValue),
	});
	return Object.freeze({
		schemaVersion: D10_CURRENT_GRAPH_LIVE_PERSISTENCE_SCHEMA,
		generationRef: D10_CURRENT_GRAPH_LIVE_GENERATION_REF,
		disposition: "partial-failure" as const,
		failureDigest: failure.failureDigest,
		commitDigest: commit.commitDigest,
		persistenceDigest: empiricalStrictJsonDigest({
			generationRef: D10_CURRENT_GRAPH_LIVE_GENERATION_REF,
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

function completeSixArms(evidence: D9ProviderRejectionEvidenceV1): boolean {
	const provider = evidence.providerEvidence;
	return (
		provider.runStatus === "complete" &&
		provider.workflowEvidence.runs.length === 6 &&
		provider.workflowEvidence.runs.every((run) => run.cleanupStatus === "completed")
	);
}

export async function runD10CurrentGraphLiveMeasurement(inputValue: {
	readonly executionAuthority: D10CurrentGraphLiveExecutionAuthorityV1;
	readonly executionClass: "live-provider" | "injected-no-network";
	readonly executor: D10CurrentGraphLiveExecutorV1;
	readonly implementationManifestDigest: string;
	readonly d9QualificationArtifactDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
}): Promise<D10CurrentGraphLiveBundleV1> {
	const input = record(inputValue, "current.live.run.input");
	exactKeys(
		input,
		[
			"d9QualificationArtifactDigest",
			"executionAuthority",
			"executionClass",
			"executor",
			"implementationManifestDigest",
			"pricingObservationDigest",
			"zeroByokObservationDigest",
		],
		"current.live.run.input",
	);
	const authority = consumeD10CurrentGraphLiveExecutionAuthority(input.executionAuthority);
	const executorRecord = record(input.executor, "current.live.executor");
	exactKeys(executorRecord, ["dispose", "execute"], "current.live.executor");
	if (typeof executorRecord.execute !== "function" || typeof executorRecord.dispose !== "function")
		throw new TypeError("current live executor is invalid");
	const graphAuthority = createD9ProviderRejectionAuthority({
		limits: D10_CURRENT_GRAPH_LIVE_LIMITS,
		routeProfile: D10_CURRENT_GRAPH_LIVE_ROUTE,
		taskProfile: D10_CURRENT_GRAPH_LIVE_TASK,
	});
	const facts: D10CurrentGraphLiveProviderFactV1[] = [];
	const rejectionFacts: D9ProviderRejectionFactV1[] = [];
	let graphEvidence: D9ProviderRejectionEvidenceV1 | null = null;
	let active: CurrentGraphProviderAdmittedEffectV1 | null = null;
	let failureCode: "executor-boundary-failed" | "graph-admission-failed" | null = null;
	let failureEffectKind: string | null = null;
	let stopAfterFailureCleanup = false;
	try {
		for (let guard = 0; guard < D10_CURRENT_GRAPH_LIVE_LIMITS.maxEffectFacts; guard += 1) {
			active = takeD9ProviderEffect(graphAuthority);
			if (active === null) {
				graphEvidence = validateD9ProviderRejectionEvidence(
					snapshotD9ProviderRejectionEvidence(graphAuthority),
				);
				break;
			}
			if (stopAfterFailureCleanup && active.request.effectKind !== "cleanup") break;
			let result: CurrentGraphProviderEffectResultInputV1;
			try {
				result = await Reflect.apply(executorRecord.execute, input.executor, [active]);
			} catch (error) {
				failureCode = "executor-boundary-failed";
				failureEffectKind = active.request.effectKind;
				stopAfterFailureCleanup = true;
				result = failedResultFor(active, error);
			}
			try {
				const outcome = admitD9ProviderEffectResult(
					graphAuthority,
					active.request.requestDigest,
					result,
				);
				facts.push(outcome.providerFact);
				if (outcome.rejectionFact !== null) rejectionFacts.push(outcome.rejectionFact);
				if (stopAfterFailureCleanup && active.request.effectKind === "cleanup") break;
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
	const publishedGraphEvidence = success ? graphEvidence : null;
	const partialGraphEvidence = success
		? null
		: (() => {
				const material = strictSnapshot({
					schemaVersion: D10_CURRENT_GRAPH_LIVE_PARTIAL_GRAPH_SCHEMA,
					decisionRef: D10_CURRENT_GRAPH_LIVE_DECISION_REF,
					routeDigest: D10_CURRENT_GRAPH_LIVE_ROUTE.routeDigest,
					taskProfileDigest: D10_CURRENT_GRAPH_LIVE_TASK.taskProfileDigest,
					facts,
					rejectionFacts,
					activeRequestDigest: active?.request.requestDigest ?? null,
					failureCode: failureCode ?? "graph-admission-failed",
					failureEffectKind,
				});
				return Object.freeze({
					...material,
					partialGraphDigest: empiricalStrictJsonDigest(material),
				}) as D10CurrentGraphLivePartialGraphV1;
			})();
	const generation = success
		? (() => {
				const material = strictSnapshot({
					schemaVersion: D10_CURRENT_GRAPH_LIVE_GENERATION_SCHEMA,
					generationRef: D10_CURRENT_GRAPH_LIVE_GENERATION_REF,
					graphEvidenceDigest: graphEvidence!.evidenceDigest,
					coordinatesDigest: D10_CURRENT_GRAPH_LIVE_COORDINATES_DIGEST,
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
		schemaVersion: D10_CURRENT_GRAPH_LIVE_TERMINAL_RECEIPT_SCHEMA,
		decisionRef: D10_CURRENT_GRAPH_LIVE_DECISION_REF,
		disposition: success ? ("success" as const) : ("partial-failure" as const),
		claimDigest: authority.claim.claimDigest,
		currentKeyAdmissionDigest: authority.currentKeyAdmission.admissionDigest,
		graphEvidenceDigest: publishedGraphEvidence?.evidenceDigest ?? null,
		partialGraphDigest: partialGraphEvidence?.partialGraphDigest ?? null,
		failureCode: success ? null : (failureCode ?? "graph-admission-failed"),
		failureEffectKind: success ? null : failureEffectKind,
		providerAttempts:
			publishedGraphEvidence?.providerEvidence.budget.providerAttempts ??
			facts.filter((fact) => fact.request.effectKind === "provider-request").length,
		confirmedCostMicrousd:
			publishedGraphEvidence?.providerEvidence.budget.confirmedCostMicrousd ??
			facts.reduce((sum, fact) => sum + fact.reconciliation.actualCostMicrousd, 0),
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const terminalReceipt = Object.freeze({
		...terminalMaterial,
		terminalReceiptDigest: empiricalStrictJsonDigest(terminalMaterial),
	});
	const bundleMaterial = strictSnapshot({
		schemaVersion: D10_CURRENT_GRAPH_LIVE_BUNDLE_SCHEMA,
		decisionRef: D10_CURRENT_GRAPH_LIVE_DECISION_REF,
		executionClass: input.executionClass,
		disposition: success ? ("success" as const) : ("partial-failure" as const),
		coordinatesDigest: D10_CURRENT_GRAPH_LIVE_COORDINATES_DIGEST,
		implementationManifestDigest: digest(
			input.implementationManifestDigest,
			"current.live.implementationManifestDigest",
		),
		qualificationArtifactDigest: authority.claim.qualificationArtifactDigest,
		qualificationDigest: authority.claim.qualificationDigest,
		d9QualificationArtifactDigest: digest(
			input.d9QualificationArtifactDigest,
			"current.live.d9QualificationArtifactDigest",
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
		graphEvidence: publishedGraphEvidence,
		partialGraphEvidence,
		generation,
		terminalReceipt,
	});
	const bundle = Object.freeze({
		...bundleMaterial,
		bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
	}) as D10CurrentGraphLiveBundleV1;
	if (
		strictJsonCodec.encode(bundle as unknown as StrictJsonValue).byteLength >
		D10_CURRENT_GRAPH_LIVE_MAX_BUNDLE_BYTES
	)
		throw new TypeError("current live bundle exceeded its byte bound");
	constructedBundles.add(bundle);
	return bundle;
}

function validatePartial(value: unknown): D10CurrentGraphLivePartialGraphV1 {
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
			"rejectionFacts",
			"routeDigest",
			"schemaVersion",
			"taskProfileDigest",
		],
		"current.live.partialGraph",
	);
	if (
		candidate.schemaVersion !== D10_CURRENT_GRAPH_LIVE_PARTIAL_GRAPH_SCHEMA ||
		candidate.decisionRef !== D10_CURRENT_GRAPH_LIVE_DECISION_REF ||
		candidate.routeDigest !== D10_CURRENT_GRAPH_LIVE_ROUTE.routeDigest ||
		candidate.taskProfileDigest !== D10_CURRENT_GRAPH_LIVE_TASK.taskProfileDigest
	)
		throw new TypeError("current live partial Graph coordinates drifted");
	const facts = array(candidate.facts, "current.live.partialGraph.facts");
	if (facts.length > D10_CURRENT_GRAPH_LIVE_LIMITS.maxEffectFacts)
		throw new TypeError("current live partial Graph fact bound drifted");
	for (const [index, factValue] of facts.entries()) {
		const fact = record(factValue, `current.live.partialGraph.facts[${index}]`);
		if (fact.sequence !== index) throw new TypeError("current live partial Graph sequence drifted");
		digest(fact.factDigest, `current.live.partialGraph.facts[${index}].factDigest`);
	}
	const rejectionFacts = array(
		candidate.rejectionFacts,
		"current.live.partialGraph.rejectionFacts",
	);
	if (rejectionFacts.length > 6)
		throw new TypeError("current live partial Graph rejection fact bound drifted");
	for (const [index, factValue] of rejectionFacts.entries()) {
		const fact = record(factValue, `current.live.partialGraph.rejectionFacts[${index}]`);
		if (fact.sequence !== index)
			throw new TypeError("current live partial Graph rejection sequence drifted");
		digest(fact.factDigest, `current.live.partialGraph.rejectionFacts[${index}].factDigest`);
	}
	const { partialGraphDigest, ...material } = candidate;
	if (partialGraphDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("current live partial Graph digest drifted");
	return strictSnapshot(candidate) as unknown as D10CurrentGraphLivePartialGraphV1;
}

export function validateD10CurrentGraphLiveBundle(value: unknown): D10CurrentGraphLiveBundleV1 {
	const candidate = record(value, "current.live.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"claimDigest",
			"coordinatesDigest",
			"currentKeyAdmissionDigest",
			"d9QualificationArtifactDigest",
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
		candidate.schemaVersion !== D10_CURRENT_GRAPH_LIVE_BUNDLE_SCHEMA ||
		candidate.decisionRef !== D10_CURRENT_GRAPH_LIVE_DECISION_REF ||
		candidate.coordinatesDigest !== D10_CURRENT_GRAPH_LIVE_COORDINATES_DIGEST ||
		(candidate.executionClass !== "live-provider" &&
			candidate.executionClass !== "injected-no-network")
	)
		throw new TypeError("current live bundle coordinates drifted");
	for (const key of [
		"claimDigest",
		"currentKeyAdmissionDigest",
		"d9QualificationArtifactDigest",
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
			: validateD9ProviderRejectionEvidence(candidate.graphEvidence);
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
		terminal.schemaVersion !== D10_CURRENT_GRAPH_LIVE_TERMINAL_RECEIPT_SCHEMA ||
		terminal.decisionRef !== D10_CURRENT_GRAPH_LIVE_DECISION_REF ||
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
			generation.schemaVersion !== D10_CURRENT_GRAPH_LIVE_GENERATION_SCHEMA ||
			generation.generationRef !== D10_CURRENT_GRAPH_LIVE_GENERATION_REF ||
			generation.graphEvidenceDigest !== graphEvidence?.evidenceDigest ||
			generation.coordinatesDigest !== D10_CURRENT_GRAPH_LIVE_COORDINATES_DIGEST ||
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
	return strictSnapshot(candidate) as unknown as D10CurrentGraphLiveBundleV1;
}

export async function persistD10CurrentGraphLiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D10CurrentGraphLiveBundleV1;
}) {
	const input = record(inputValue, "current.live.persistence.input");
	exactKeys(input, ["bundle", "privateRoot"], "current.live.persistence.input");
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.delete(input.bundle)
	)
		throw new TypeError("current live persistence requires a fresh constructed bundle");
	const bundle = validateD10CurrentGraphLiveBundle(input.bundle);
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
		schemaVersion: "graphrefly-ts.d10.current-graph-live-commit.v1",
		generationRef: D10_CURRENT_GRAPH_LIVE_GENERATION_REF,
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
		generationRef: D10_CURRENT_GRAPH_LIVE_GENERATION_REF,
		artifacts,
		commitBytes: strictJsonCodec.encode(commit as unknown as StrictJsonValue),
	});
	return Object.freeze({
		schemaVersion: D10_CURRENT_GRAPH_LIVE_PERSISTENCE_SCHEMA,
		generationRef: D10_CURRENT_GRAPH_LIVE_GENERATION_REF,
		disposition: bundle.disposition,
		bundleDigest: bundle.bundleDigest,
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		commitDigest: commit.commitDigest,
		persistenceDigest: empiricalStrictJsonDigest({
			generationRef: D10_CURRENT_GRAPH_LIVE_GENERATION_REF,
			bundleDigest: bundle.bundleDigest,
			commitDigest: commit.commitDigest,
		}),
	});
}
