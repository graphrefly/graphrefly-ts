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
	CurrentGraphProviderEvidenceV1,
} from "./d6-current-provider-authority.js";
import type { D9ProviderRejectionFactV1 } from "./d9-current-provider-rejection-authority.js";
import type { D11TransportResultEnvelopeV1 } from "./d11-current-transport-contract.js";
import {
	admitD11ProviderEffectEnvelope,
	createD11TransportFailureAuthority,
	type D11TransportFailureEvidenceV1,
	type D11TransportFailureFactV1,
	snapshotD11TransportFailureEvidence,
	takeD11ProviderEffect,
	validateD11TransportFailureEvidence,
} from "./d11-current-transport-failure-authority.js";
import { D15_IMPLEMENTATION_MANIFEST_DIGEST } from "./d15-current-implementation-manifest.js";
import {
	consumeD15CurrentGraphLiveExecutionAuthority,
	type D15CurrentGraphLiveDispatchClaimV1,
	type D15CurrentGraphLiveExecutionAuthorityV1,
} from "./d15-current-live-claim.js";
import {
	D15_CURRENT_GRAPH_LIVE_COORDINATES_DIGEST,
	D15_CURRENT_GRAPH_LIVE_DECISION_REF,
	D15_CURRENT_GRAPH_LIVE_GENERATION_REF,
	D15_CURRENT_GRAPH_LIVE_LIMITS,
	D15_CURRENT_GRAPH_LIVE_ROUTE,
	D15_CURRENT_GRAPH_LIVE_TASK,
	D15_D6_QUALIFICATION_ARTIFACT_DIGEST,
} from "./d15-current-live-coordinates.js";

export const D15_CURRENT_GRAPH_LIVE_BUNDLE_SCHEMA =
	"graphrefly-ts.d15.current-graph-live-bundle.v1" as const;
export const D15_CURRENT_GRAPH_LIVE_PARTIAL_GRAPH_SCHEMA =
	"graphrefly-ts.d15.current-graph-live-partial-graph.v1" as const;
export const D15_CURRENT_GRAPH_LIVE_GENERATION_SCHEMA =
	"graphrefly-ts.d15.current-graph-live-generation.v1" as const;
export const D15_CURRENT_GRAPH_LIVE_TERMINAL_RECEIPT_SCHEMA =
	"graphrefly-ts.d15.current-graph-live-terminal-receipt.v1" as const;
export const D15_CURRENT_GRAPH_LIVE_PERSISTENCE_SCHEMA =
	"graphrefly-ts.d15.current-graph-live-persistence.v1" as const;
export const D15_CURRENT_GRAPH_LIVE_PREEXECUTION_FAILURE_SCHEMA =
	"graphrefly-ts.d15.current-graph-live-preexecution-failure.v1" as const;
export const D15_CURRENT_GRAPH_LIVE_MAX_BUNDLE_BYTES = 4_194_304;

type D15CurrentGraphLiveProviderFactV1 = CurrentGraphProviderEvidenceV1["facts"][number];

export interface D15CurrentGraphLivePartialGraphV1 {
	readonly schemaVersion: typeof D15_CURRENT_GRAPH_LIVE_PARTIAL_GRAPH_SCHEMA;
	readonly decisionRef: typeof D15_CURRENT_GRAPH_LIVE_DECISION_REF;
	readonly routeDigest: string;
	readonly taskProfileDigest: string;
	readonly facts: readonly D15CurrentGraphLiveProviderFactV1[];
	readonly rejectionFacts: readonly D9ProviderRejectionFactV1[];
	readonly transportFacts: readonly D11TransportFailureFactV1[];
	readonly activeRequestDigest: string | null;
	readonly failureCode: "executor-boundary-failed" | "graph-admission-failed";
	readonly failureEffectKind: string | null;
	readonly partialGraphDigest: string;
}

export interface D15CurrentGraphLiveBundleV1 {
	readonly schemaVersion: typeof D15_CURRENT_GRAPH_LIVE_BUNDLE_SCHEMA;
	readonly decisionRef: typeof D15_CURRENT_GRAPH_LIVE_DECISION_REF;
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
	readonly graphEvidence: D11TransportFailureEvidenceV1 | null;
	readonly partialGraphEvidence: D15CurrentGraphLivePartialGraphV1 | null;
	readonly generation: Readonly<Record<string, unknown>> | null;
	readonly terminalReceipt: Readonly<Record<string, unknown>>;
	readonly bundleDigest: string;
}

export interface D15CurrentGraphLiveExecutorV1 {
	readonly execute: (
		effect: CurrentGraphProviderAdmittedEffectV1,
	) => Promise<D11TransportResultEnvelopeV1>;
	readonly dispose: () => Promise<void>;
}

const constructedBundles = new WeakSet<object>();

export async function persistD15CurrentGraphLivePreexecutionFailure(inputValue: {
	readonly privateRoot: string;
	readonly claim: D15CurrentGraphLiveDispatchClaimV1;
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
		claim.decisionRef !== D15_CURRENT_GRAPH_LIVE_DECISION_REF ||
		claim.generationRef !== D15_CURRENT_GRAPH_LIVE_GENERATION_REF ||
		claim.coordinatesDigest !== D15_CURRENT_GRAPH_LIVE_COORDINATES_DIGEST ||
		(claim.scope !== "live-fixed-root" && input.allowInjectedTestScope !== true) ||
		claim.blockCount !== 1 ||
		claim.blockHardCapMicrousd !== 6_000_000 ||
		claim.localEvalNoResetLimitMicrousd !== 32_000_000 ||
		claim.implementationManifestDigest !== input.implementationManifestDigest
	)
		throw new TypeError("current live pre-execution failure claim drifted");
	const material = strictSnapshot({
		schemaVersion: D15_CURRENT_GRAPH_LIVE_PREEXECUTION_FAILURE_SCHEMA,
		decisionRef: D15_CURRENT_GRAPH_LIVE_DECISION_REF,
		generationRef: D15_CURRENT_GRAPH_LIVE_GENERATION_REF,
		disposition: "partial-failure" as const,
		failurePhase: "current-key-admission" as const,
		failureCode: "current-key-admission-failed" as const,
		coordinatesDigest: D15_CURRENT_GRAPH_LIVE_COORDINATES_DIGEST,
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
		schemaVersion: "graphrefly-ts.d15.current-graph-live-commit.v1",
		generationRef: D15_CURRENT_GRAPH_LIVE_GENERATION_REF,
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
		generationRef: D15_CURRENT_GRAPH_LIVE_GENERATION_REF,
		artifacts: { "preexecution-failure.v1.json": bytes },
		commitBytes: strictJsonCodec.encode(commit as unknown as StrictJsonValue),
	});
	return Object.freeze({
		schemaVersion: D15_CURRENT_GRAPH_LIVE_PERSISTENCE_SCHEMA,
		generationRef: D15_CURRENT_GRAPH_LIVE_GENERATION_REF,
		disposition: "partial-failure" as const,
		failureDigest: failure.failureDigest,
		commitDigest: commit.commitDigest,
		persistenceDigest: empiricalStrictJsonDigest({
			generationRef: D15_CURRENT_GRAPH_LIVE_GENERATION_REF,
			failureDigest: failure.failureDigest,
			commitDigest: commit.commitDigest,
		}),
	});
}

function completeSixArms(evidence: D11TransportFailureEvidenceV1): boolean {
	const provider = evidence.d9Evidence.providerEvidence;
	return (
		provider.runStatus === "complete" &&
		provider.workflowEvidence.runs.length === 6 &&
		provider.workflowEvidence.runs.every((run) => run.cleanupStatus === "completed")
	);
}

export function isD15CompleteSixArmMeasurementForTest(
	evidence: D11TransportFailureEvidenceV1,
): boolean {
	return completeSixArms(evidence);
}

export async function runD15CurrentGraphLiveMeasurement(inputValue: {
	readonly executionAuthority: D15CurrentGraphLiveExecutionAuthorityV1;
	readonly executionClass: "live-provider" | "injected-no-network";
	readonly executor: D15CurrentGraphLiveExecutorV1;
	readonly implementationManifestDigest: string;
	readonly d6QualificationArtifactDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
}): Promise<D15CurrentGraphLiveBundleV1> {
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
	if (
		input.implementationManifestDigest !== D15_IMPLEMENTATION_MANIFEST_DIGEST ||
		input.d6QualificationArtifactDigest !== D15_D6_QUALIFICATION_ARTIFACT_DIGEST ||
		(input.executionClass !== "live-provider" && input.executionClass !== "injected-no-network")
	)
		throw new TypeError("current live approved execution coordinates drifted");
	const authority = consumeD15CurrentGraphLiveExecutionAuthority(input.executionAuthority);
	if (
		authority.claim.implementationManifestDigest !== input.implementationManifestDigest ||
		(authority.claim.scope === "live-fixed-root") !== (input.executionClass === "live-provider")
	)
		throw new TypeError("current live execution authority scope drifted");
	const executorRecord = record(input.executor, "current.live.executor");
	exactKeys(executorRecord, ["dispose", "execute"], "current.live.executor");
	if (typeof executorRecord.execute !== "function" || typeof executorRecord.dispose !== "function")
		throw new TypeError("current live executor is invalid");
	const graphAuthority = createD11TransportFailureAuthority({
		limits: D15_CURRENT_GRAPH_LIVE_LIMITS,
		routeProfile: D15_CURRENT_GRAPH_LIVE_ROUTE,
		taskProfile: D15_CURRENT_GRAPH_LIVE_TASK,
	});
	const facts: D15CurrentGraphLiveProviderFactV1[] = [];
	const rejectionFacts: D9ProviderRejectionFactV1[] = [];
	const transportFacts: D11TransportFailureFactV1[] = [];
	let graphEvidence: D11TransportFailureEvidenceV1 | null = null;
	let active: CurrentGraphProviderAdmittedEffectV1 | null = null;
	let failureCode: "executor-boundary-failed" | "graph-admission-failed" | null = null;
	let failureEffectKind: string | null = null;
	try {
		for (let guard = 0; guard < D15_CURRENT_GRAPH_LIVE_LIMITS.maxEffectFacts; guard += 1) {
			active = takeD11ProviderEffect(graphAuthority);
			if (active === null) {
				graphEvidence = validateD11TransportFailureEvidence(
					snapshotD11TransportFailureEvidence(graphAuthority),
				);
				break;
			}
			let envelope: D11TransportResultEnvelopeV1;
			try {
				envelope = await Reflect.apply(executorRecord.execute, input.executor, [active]);
			} catch {
				failureCode = "executor-boundary-failed";
				failureEffectKind = active.request.effectKind;
				break;
			}
			try {
				const outcome = admitD11ProviderEffectEnvelope(
					graphAuthority,
					active.request.requestDigest,
					envelope,
				);
				facts.push(outcome.providerOutcome.providerFact);
				if (outcome.providerOutcome.rejectionFact !== null)
					rejectionFacts.push(outcome.providerOutcome.rejectionFact);
				if (outcome.transportFact !== null) transportFacts.push(outcome.transportFact);
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
					schemaVersion: D15_CURRENT_GRAPH_LIVE_PARTIAL_GRAPH_SCHEMA,
					decisionRef: D15_CURRENT_GRAPH_LIVE_DECISION_REF,
					routeDigest: D15_CURRENT_GRAPH_LIVE_ROUTE.routeDigest,
					taskProfileDigest: D15_CURRENT_GRAPH_LIVE_TASK.taskProfileDigest,
					facts,
					rejectionFacts,
					transportFacts,
					activeRequestDigest: active?.request.requestDigest ?? null,
					failureCode: failureCode ?? "graph-admission-failed",
					failureEffectKind,
				});
				return Object.freeze({
					...material,
					partialGraphDigest: empiricalStrictJsonDigest(material),
				}) as D15CurrentGraphLivePartialGraphV1;
			})();
	const generation = success
		? (() => {
				const material = strictSnapshot({
					schemaVersion: D15_CURRENT_GRAPH_LIVE_GENERATION_SCHEMA,
					generationRef: D15_CURRENT_GRAPH_LIVE_GENERATION_REF,
					graphEvidenceDigest: graphEvidence!.evidenceDigest,
					coordinatesDigest: D15_CURRENT_GRAPH_LIVE_COORDINATES_DIGEST,
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
		schemaVersion: D15_CURRENT_GRAPH_LIVE_TERMINAL_RECEIPT_SCHEMA,
		decisionRef: D15_CURRENT_GRAPH_LIVE_DECISION_REF,
		disposition: success ? ("success" as const) : ("partial-failure" as const),
		claimDigest: authority.claim.claimDigest,
		currentKeyAdmissionDigest: authority.currentKeyAdmission.admissionDigest,
		graphEvidenceDigest: publishedGraphEvidence?.evidenceDigest ?? null,
		partialGraphDigest: partialGraphEvidence?.partialGraphDigest ?? null,
		failureCode: success ? null : (failureCode ?? "graph-admission-failed"),
		failureEffectKind: success ? null : failureEffectKind,
		providerAttempts:
			publishedGraphEvidence?.d9Evidence.providerEvidence.budget.providerAttempts ??
			facts.filter((fact) => fact.request.effectKind === "provider-request").length,
		confirmedCostMicrousd:
			publishedGraphEvidence?.d9Evidence.providerEvidence.budget.confirmedCostMicrousd ??
			facts.reduce((sum, fact) => sum + fact.reconciliation.actualCostMicrousd, 0),
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const terminalReceipt = Object.freeze({
		...terminalMaterial,
		terminalReceiptDigest: empiricalStrictJsonDigest(terminalMaterial),
	});
	const bundleMaterial = strictSnapshot({
		schemaVersion: D15_CURRENT_GRAPH_LIVE_BUNDLE_SCHEMA,
		decisionRef: D15_CURRENT_GRAPH_LIVE_DECISION_REF,
		executionClass: input.executionClass,
		disposition: success ? ("success" as const) : ("partial-failure" as const),
		coordinatesDigest: D15_CURRENT_GRAPH_LIVE_COORDINATES_DIGEST,
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
		graphEvidence: publishedGraphEvidence,
		partialGraphEvidence,
		generation,
		terminalReceipt,
	});
	const bundle = Object.freeze({
		...bundleMaterial,
		bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
	}) as D15CurrentGraphLiveBundleV1;
	if (
		strictJsonCodec.encode(bundle as unknown as StrictJsonValue).byteLength >
		D15_CURRENT_GRAPH_LIVE_MAX_BUNDLE_BYTES
	)
		throw new TypeError("current live bundle exceeded its byte bound");
	constructedBundles.add(bundle);
	return bundle;
}

function validatePartial(value: unknown): D15CurrentGraphLivePartialGraphV1 {
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
			"transportFacts",
			"routeDigest",
			"schemaVersion",
			"taskProfileDigest",
		],
		"current.live.partialGraph",
	);
	if (
		candidate.schemaVersion !== D15_CURRENT_GRAPH_LIVE_PARTIAL_GRAPH_SCHEMA ||
		candidate.decisionRef !== D15_CURRENT_GRAPH_LIVE_DECISION_REF ||
		candidate.routeDigest !== D15_CURRENT_GRAPH_LIVE_ROUTE.routeDigest ||
		candidate.taskProfileDigest !== D15_CURRENT_GRAPH_LIVE_TASK.taskProfileDigest
	)
		throw new TypeError("current live partial Graph coordinates drifted");
	if (
		(candidate.failureCode !== "executor-boundary-failed" &&
			candidate.failureCode !== "graph-admission-failed") ||
		(candidate.failureEffectKind !== null &&
			(typeof candidate.failureEffectKind !== "string" ||
				candidate.failureEffectKind.length === 0 ||
				Buffer.byteLength(candidate.failureEffectKind, "utf8") > 64)) ||
		(candidate.activeRequestDigest !== null &&
			digest(candidate.activeRequestDigest, "current.live.partialGraph.activeRequestDigest") !==
				candidate.activeRequestDigest)
	)
		throw new TypeError("current live partial Graph failure coordinates drifted");
	const facts = array(candidate.facts, "current.live.partialGraph.facts");
	if (facts.length > D15_CURRENT_GRAPH_LIVE_LIMITS.maxEffectFacts)
		throw new TypeError("current live partial Graph fact bound drifted");
	const providerFactsByDigest = new Map<string, Readonly<Record<string, unknown>>>();
	for (const [index, factValue] of facts.entries()) {
		const fact = record(factValue, `current.live.partialGraph.facts[${index}]`);
		exactKeys(
			fact,
			[
				"admission",
				"arm",
				"factDigest",
				"reconciliation",
				"request",
				"result",
				"runSequence",
				"sequence",
			],
			`current.live.partialGraph.facts[${index}]`,
		);
		if (fact.sequence !== index) throw new TypeError("current live partial Graph sequence drifted");
		const providerFactDigest = digest(
			fact.factDigest,
			`current.live.partialGraph.facts[${index}].factDigest`,
		);
		const { factDigest, ...factMaterial } = fact;
		if (factDigest !== empiricalStrictJsonDigest(factMaterial))
			throw new TypeError("current live partial Graph provider fact digest drifted");
		if (providerFactsByDigest.has(providerFactDigest))
			throw new TypeError("current live partial Graph provider fact digest repeated");
		providerFactsByDigest.set(providerFactDigest, fact);
	}
	const rejectionFacts = array(
		candidate.rejectionFacts,
		"current.live.partialGraph.rejectionFacts",
	);
	if (rejectionFacts.length > 6)
		throw new TypeError("current live partial Graph rejection fact bound drifted");
	const mechanismProviderDigests: string[] = [];
	for (const [index, factValue] of rejectionFacts.entries()) {
		const fact = record(factValue, `current.live.partialGraph.rejectionFacts[${index}]`);
		exactKeys(
			fact,
			[
				"admission",
				"arm",
				"candidateDigest",
				"causeCode",
				"factDigest",
				"providerFactDigest",
				"reconciliation",
				"request",
				"runSequence",
				"schemaVersion",
				"sequence",
			],
			`current.live.partialGraph.rejectionFacts[${index}]`,
		);
		if (fact.sequence !== index)
			throw new TypeError("current live partial Graph rejection sequence drifted");
		digest(fact.factDigest, `current.live.partialGraph.rejectionFacts[${index}].factDigest`);
		const providerFactDigest = digest(
			fact.providerFactDigest,
			`current.live.partialGraph.rejectionFacts[${index}].providerFactDigest`,
		);
		const providerFact = providerFactsByDigest.get(providerFactDigest);
		const { factDigest, ...factMaterial } = fact;
		if (
			providerFact === undefined ||
			fact.arm !== providerFact.arm ||
			fact.runSequence !== providerFact.runSequence ||
			empiricalStrictJsonDigest(fact.request) !== empiricalStrictJsonDigest(providerFact.request) ||
			empiricalStrictJsonDigest(fact.admission) !==
				empiricalStrictJsonDigest(providerFact.admission) ||
			empiricalStrictJsonDigest(fact.reconciliation) !==
				empiricalStrictJsonDigest(providerFact.reconciliation) ||
			factDigest !== empiricalStrictJsonDigest(factMaterial)
		)
			throw new TypeError("current live partial Graph rejection binding drifted");
		mechanismProviderDigests.push(providerFactDigest);
	}
	const transportFacts = array(
		candidate.transportFacts,
		"current.live.partialGraph.transportFacts",
	);
	if (transportFacts.length > 6)
		throw new TypeError("current live partial Graph transport fact bound drifted");
	for (const [index, factValue] of transportFacts.entries()) {
		const fact = record(factValue, `current.live.partialGraph.transportFacts[${index}]`);
		exactKeys(
			fact,
			[
				"admission",
				"arm",
				"causeCode",
				"factDigest",
				"phase",
				"proposalDigest",
				"providerFactDigest",
				"reconciliation",
				"request",
				"runSequence",
				"schemaVersion",
				"sequence",
			],
			`current.live.partialGraph.transportFacts[${index}]`,
		);
		if (fact.sequence !== index)
			throw new TypeError("current live partial Graph transport sequence drifted");
		digest(fact.factDigest, `current.live.partialGraph.transportFacts[${index}].factDigest`);
		const providerFactDigest = digest(
			fact.providerFactDigest,
			`current.live.partialGraph.transportFacts[${index}].providerFactDigest`,
		);
		const providerFact = providerFactsByDigest.get(providerFactDigest);
		const { factDigest, ...factMaterial } = fact;
		if (
			providerFact === undefined ||
			fact.arm !== providerFact.arm ||
			fact.runSequence !== providerFact.runSequence ||
			empiricalStrictJsonDigest(fact.request) !== empiricalStrictJsonDigest(providerFact.request) ||
			empiricalStrictJsonDigest(fact.admission) !==
				empiricalStrictJsonDigest(providerFact.admission) ||
			empiricalStrictJsonDigest(fact.reconciliation) !==
				empiricalStrictJsonDigest(providerFact.reconciliation) ||
			factDigest !== empiricalStrictJsonDigest(factMaterial)
		)
			throw new TypeError("current live partial Graph transport binding drifted");
		mechanismProviderDigests.push(providerFactDigest);
	}
	if (new Set(mechanismProviderDigests).size !== mechanismProviderDigests.length)
		throw new TypeError("current live partial Graph mechanism facts overlap");
	const { partialGraphDigest, ...material } = candidate;
	if (partialGraphDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("current live partial Graph digest drifted");
	return strictSnapshot(candidate) as unknown as D15CurrentGraphLivePartialGraphV1;
}

export function validateD15CurrentGraphLiveBundle(value: unknown): D15CurrentGraphLiveBundleV1 {
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
		candidate.schemaVersion !== D15_CURRENT_GRAPH_LIVE_BUNDLE_SCHEMA ||
		candidate.decisionRef !== D15_CURRENT_GRAPH_LIVE_DECISION_REF ||
		candidate.coordinatesDigest !== D15_CURRENT_GRAPH_LIVE_COORDINATES_DIGEST ||
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
	if (
		candidate.implementationManifestDigest !== D15_IMPLEMENTATION_MANIFEST_DIGEST ||
		candidate.d6QualificationArtifactDigest !== D15_D6_QUALIFICATION_ARTIFACT_DIGEST
	)
		throw new TypeError("current live bundle approved provenance drifted");
	const disposition = candidate.disposition;
	if (disposition !== "success" && disposition !== "partial-failure")
		throw new TypeError("current live bundle disposition drifted");
	const graphEvidence =
		candidate.graphEvidence === null
			? null
			: validateD11TransportFailureEvidence(candidate.graphEvidence);
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
		terminal.schemaVersion !== D15_CURRENT_GRAPH_LIVE_TERMINAL_RECEIPT_SCHEMA ||
		terminal.decisionRef !== D15_CURRENT_GRAPH_LIVE_DECISION_REF ||
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
	const canonicalFacts =
		graphEvidence?.d9Evidence.providerEvidence.facts ?? partialGraphEvidence?.facts ?? [];
	const expectedProviderAttempts = canonicalFacts.filter(
		(fact) => fact.request.effectKind === "provider-request",
	).length;
	const expectedCostMicrousd = canonicalFacts.reduce(
		(sum, fact) => sum + fact.reconciliation.actualCostMicrousd,
		0,
	);
	if (
		terminal.providerAttempts !== expectedProviderAttempts ||
		terminal.confirmedCostMicrousd !== expectedCostMicrousd ||
		(disposition === "success" &&
			(terminal.failureCode !== null || terminal.failureEffectKind !== null)) ||
		(disposition === "partial-failure" &&
			(partialGraphEvidence === null ||
				terminal.failureCode !== partialGraphEvidence.failureCode ||
				terminal.failureEffectKind !== partialGraphEvidence.failureEffectKind))
	)
		throw new TypeError("current live terminal accounting drifted");
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
			generation.schemaVersion !== D15_CURRENT_GRAPH_LIVE_GENERATION_SCHEMA ||
			generation.generationRef !== D15_CURRENT_GRAPH_LIVE_GENERATION_REF ||
			generation.graphEvidenceDigest !== graphEvidence?.evidenceDigest ||
			generation.coordinatesDigest !== D15_CURRENT_GRAPH_LIVE_COORDINATES_DIGEST ||
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
	return strictSnapshot(candidate) as unknown as D15CurrentGraphLiveBundleV1;
}

export async function persistD15CurrentGraphLiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D15CurrentGraphLiveBundleV1;
}) {
	const input = record(inputValue, "current.live.persistence.input");
	exactKeys(input, ["bundle", "privateRoot"], "current.live.persistence.input");
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.delete(input.bundle)
	)
		throw new TypeError("current live persistence requires a fresh constructed bundle");
	const bundle = validateD15CurrentGraphLiveBundle(input.bundle);
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
		schemaVersion: "graphrefly-ts.d15.current-graph-live-commit.v1",
		generationRef: D15_CURRENT_GRAPH_LIVE_GENERATION_REF,
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
		generationRef: D15_CURRENT_GRAPH_LIVE_GENERATION_REF,
		artifacts,
		commitBytes: strictJsonCodec.encode(commit as unknown as StrictJsonValue),
	});
	return Object.freeze({
		schemaVersion: D15_CURRENT_GRAPH_LIVE_PERSISTENCE_SCHEMA,
		generationRef: D15_CURRENT_GRAPH_LIVE_GENERATION_REF,
		disposition: bundle.disposition,
		bundleDigest: bundle.bundleDigest,
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		commitDigest: commit.commitDigest,
		persistenceDigest: empiricalStrictJsonDigest({
			generationRef: D15_CURRENT_GRAPH_LIVE_GENERATION_REF,
			bundleDigest: bundle.bundleDigest,
			commitDigest: commit.commitDigest,
		}),
	});
}
