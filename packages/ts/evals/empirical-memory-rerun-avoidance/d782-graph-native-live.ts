import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	createD726ArmLocalTerminalProviderPolicy,
	createD761GraphPublicSemanticValidationPolicy,
} from "./d767-graph-native-effect-runtime.js";
import type { D771CanonicalGraphEvidenceV1 } from "./d771-graph-completion-memory-insight.js";
import { deriveD771CanonicalGraphEvidence } from "./d771-graph-completion-memory-insight.js";
import { evaluateD775ArmAwarePositiveGate } from "./d775-live-positive-gate.js";
import {
	type D776RouteEvidenceV1,
	validateD776RouteEvidence,
} from "./d776-provider-result-route-authority.js";
import type {
	D778TaskExposureFactV1,
	D778ToolRejectionFactV1,
} from "./d778-graph-task-tool-authority.js";
import {
	createD778GraphTaskEnvelope,
	D778_TASK_EXPOSURE_FACT_SCHEMA,
	D778_TOOL_REJECTION_FACT_SCHEMA,
} from "./d778-graph-task-tool-authority.js";
import { type D779CallerExecutorV1, runD779GraphNativeEvalCore } from "./d779-graph-native-eval.js";
import { validateD779QualificationBundle } from "./d779-pre-live-qualification.js";
import {
	D782_BUDGET_LIMITS,
	D782_COORDINATES_DIGEST,
	D782_D781_FORENSIC_ARTIFACT_SHA256,
	D782_D781_FORENSIC_DIGEST,
	D782_DECISION_REF,
	D782_DECISION_REVISION,
	D782_EFFECT_CEILINGS,
	D782_GENERATION_REF,
	D782_HISTORICAL_ARTIFACT_SHA256,
	D782_HISTORICAL_BUNDLE_DIGEST,
	D782_HISTORICAL_IMPLEMENTATION_MANIFEST_DIGEST,
	D782_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
} from "./d782-coordinates.js";
import { D782_IMPLEMENTATION_MANIFEST_DIGEST } from "./d782-implementation-manifest.js";
import {
	consumeD782ExecutionAuthority,
	type D782ExecutionAuthorityV1,
} from "./d782-single-use-dispatch-claim.js";

export const D782_BUNDLE_SCHEMA = "graphrefly.b112.d782.live-bundle.v1" as const;
export const D782_PERSISTENCE_SCHEMA = "graphrefly.b112.d782.live-persistence.v1" as const;

export interface D782LiveBundleV1 {
	readonly schemaVersion: typeof D782_BUNDLE_SCHEMA;
	readonly disposition: "success" | "partial-failure";
	readonly graphEvidence: D771CanonicalGraphEvidenceV1;
	readonly routeEvidence: D776RouteEvidenceV1;
	readonly taskExposureFacts: readonly D778TaskExposureFactV1[];
	readonly toolRejectionFacts: readonly D778ToolRejectionFactV1[];
	readonly qualification: Readonly<Record<string, unknown>>;
	readonly observation: Readonly<Record<string, unknown>>;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly terminalReceipt: Readonly<Record<string, unknown>>;
	readonly bundleDigest: string;
}

const constructed = new WeakSet<object>();

type D782AdmittedEffectFact = D771CanonicalGraphEvidenceV1["effectRuns"][number]["facts"][number];

function isD782GraphSynthesizedToolFailure(fact: D782AdmittedEffectFact): boolean {
	if (
		fact.kind !== "graph-effect-result-admitted" ||
		fact.request.effectKind !== "tool-action" ||
		fact.result.effectKind !== "tool-action" ||
		fact.result.status !== "failed"
	)
		return false;
	return (["executor-threw", "graph-admission-denied"] as const).some(
		(cause) =>
			fact.result.evidenceDigest ===
			empiricalStrictJsonDigest({ requestDigest: fact.request.requestDigest, cause }),
	);
}

export function isD782GraphSynthesizedToolFailureForTest(value: unknown): boolean {
	return isD782GraphSynthesizedToolFailure(value as D782AdmittedEffectFact);
}

function validateD782ToolRejectionFacts(
	toolValue: unknown,
	graphEvidence: D771CanonicalGraphEvidenceV1,
): readonly D778ToolRejectionFactV1[] {
	if (!Array.isArray(toolValue) || toolValue.length > 64)
		throw new TypeError("D782 tool rejection facts are outside the bound");
	const graphFacts = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) => (fact.kind === "graph-effect-result-admitted" ? [fact] : [])),
	);
	const toolRejectionFacts = toolValue.map((value, index) => {
		const fact = record(value, `d782.toolRejectionFacts[${index}]`);
		exactKeys(
			fact,
			[
				"admissionDigest",
				"causeCode",
				"factDigest",
				"reconciliationDigest",
				"requestDigest",
				"resultFactDigest",
				"runSequence",
				"schemaVersion",
				"toolRef",
				"workspaceStateAfterDigest",
				"workspaceStateBeforeDigest",
			],
			`d782.toolRejectionFacts[${index}]`,
		);
		literal(
			fact.schemaVersion,
			D778_TOOL_REJECTION_FACT_SCHEMA,
			`d782.toolRejectionFacts[${index}].schema`,
		);
		const { factDigest, ...material } = fact;
		literal(
			factDigest,
			empiricalStrictJsonDigest(material),
			`d782.toolRejectionFacts[${index}].digest`,
		);
		if (fact.workspaceStateBeforeDigest !== fact.workspaceStateAfterDigest)
			throw new TypeError("D782 rejected tool changed workspace state");
		const matches = graphFacts.filter(
			(candidate) =>
				candidate.request.effectKind === "tool-action" &&
				candidate.result.effectKind === "tool-action" &&
				candidate.result.status === "failed" &&
				candidate.result.toolRef === fact.toolRef &&
				candidate.request.requestDigest === fact.requestDigest &&
				candidate.admissionDigest === fact.admissionDigest &&
				candidate.factDigest === fact.resultFactDigest,
		);
		const reconciliationMatches = graphEvidence.ledger.effectReconciliations.filter(
			(candidate) =>
				candidate.admissionDigest === fact.admissionDigest &&
				candidate.reconciliationDigest === fact.reconciliationDigest,
		);
		if (matches.length !== 1 || reconciliationMatches.length !== 1)
			throw new TypeError("D782 tool rejection fact is not bijective with Graph evidence");
		return strictSnapshot(fact) as unknown as D778ToolRejectionFactV1;
	});
	const toolKeys = toolRejectionFacts.map(
		(fact) => `${fact.requestDigest}:${fact.admissionDigest}:${fact.resultFactDigest}`,
	);
	if (new Set(toolKeys).size !== toolKeys.length)
		throw new TypeError("D782 tool rejection fact replayed");
	const rejectedToolFacts = graphFacts.filter(
		(fact) =>
			fact.request.effectKind === "tool-action" &&
			fact.result.effectKind === "tool-action" &&
			fact.result.status === "failed" &&
			!isD782GraphSynthesizedToolFailure(fact),
	);
	if (toolRejectionFacts.length !== rejectedToolFacts.length)
		throw new TypeError("D782 tool rejection/failed effect coverage drifted");
	return Object.freeze(toolRejectionFacts);
}

function hasOperationalFailure(graphEvidence: D771CanonicalGraphEvidenceV1): boolean {
	return graphEvidence.effectRuns.some(
		(run) =>
			run.runtimeStatus !== "complete" ||
			run.facts.some((fact) => {
				if (fact.kind !== "graph-effect-result-admitted") return false;
				const result = fact.result;
				if (result.effectKind === "provider-request") return result.status === "terminal-failure";
				if (result.effectKind === "materialization" || result.effectKind === "retry-wait")
					return result.status === "failed";
				if (result.effectKind === "tool-action" || result.effectKind === "cleanup")
					return result.status === "failed";
				if (result.effectKind === "public-semantic-validation")
					return result.status === "executor-failed";
				return false;
			}),
	);
}

export function validateD782HistoricalBundleBytes(bytes: Uint8Array): void {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 16 * 1_048_576)
		throw new TypeError("D782 historical artifact bytes are invalid");
	literal(empiricalSha256(bytes), D782_HISTORICAL_ARTIFACT_SHA256, "d782.historical.sha256");
	const bundle = validateD779QualificationBundle(strictJsonCodec.decode(new Uint8Array(bytes)));
	literal(bundle.bundleDigest, D782_HISTORICAL_BUNDLE_DIGEST, "d782.historical.bundle");
	literal(
		bundle.qualification.implementationManifestDigest,
		D782_HISTORICAL_IMPLEMENTATION_MANIFEST_DIGEST,
		"d782.historical.implementation",
	);
}

export function validateD782D781ForensicBytes(
	bytes: Uint8Array,
): Readonly<Record<string, unknown>> {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 16_384)
		throw new TypeError("D782 D781 forensic artifact bytes are invalid");
	literal(empiricalSha256(bytes), D782_D781_FORENSIC_ARTIFACT_SHA256, "d782.d781Forensic.sha256");
	let decoded: unknown;
	try {
		decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (error) {
		throw new TypeError("D782 D781 forensic artifact is not bounded UTF-8 JSON", {
			cause: error,
		});
	}
	const forensic = record(decoded, "d782.d781Forensic");
	exactKeys(
		forensic,
		[
			"automaticRerun",
			"canonicalGraphEvidenceDisposition",
			"causalAttribution",
			"claimDigest",
			"currentKeyCalls",
			"currentKeyAdmissionDigest",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"failureCode",
			"failurePhase",
			"forensicDigest",
			"historicalArtifactImplementationManifestDigest",
			"implementationManifestDigest",
			"partialCanonicalGraphEvidencePublished",
			"pricingReadDigest",
			"providerCalls",
			"repairedD780BaselineImplementationManifestDigest",
			"remainingMicrousdAtCurrentKeyAdmission",
			"schemaVersion",
			"status",
			"successGenerationDisposition",
			"zeroByokObservationDigest",
		],
		"d782.d781Forensic",
	);
	literal(
		forensic.schemaVersion,
		"graphrefly.b112.d781.pre-provider-historical-coordinate-failure-forensic.v1",
		"d782.d781Forensic.schema",
	);
	literal(forensic.decisionRef, "decision.D781", "d782.d781Forensic.decision");
	literal(forensic.decisionRevision, "2026-08-14.v1", "d782.d781Forensic.revision");
	literal(forensic.status, "failed-pre-provider-validation", "d782.d781Forensic.status");
	literal(
		forensic.failurePhase,
		"live-measurement-historical-coordinate-validation",
		"d782.d781Forensic.failurePhase",
	);
	literal(
		forensic.failureCode,
		"historical-implementation-coordinate-conflated",
		"d782.d781Forensic.failureCode",
	);
	digest(forensic.claimDigest, "d782.d781Forensic.claim");
	digest(forensic.currentKeyAdmissionDigest, "d782.d781Forensic.currentKey");
	digest(forensic.pricingReadDigest, "d782.d781Forensic.pricing");
	digest(forensic.zeroByokObservationDigest, "d782.d781Forensic.zeroByok");
	digest(forensic.implementationManifestDigest, "d782.d781Forensic.implementation");
	if (
		!Number.isSafeInteger(forensic.remainingMicrousdAtCurrentKeyAdmission) ||
		(forensic.remainingMicrousdAtCurrentKeyAdmission as number) < 6_000_000 ||
		(forensic.remainingMicrousdAtCurrentKeyAdmission as number) > 32_000_000
	)
		throw new TypeError("D782 D781 forensic current-key admission is invalid");
	literal(
		forensic.historicalArtifactImplementationManifestDigest,
		D782_HISTORICAL_IMPLEMENTATION_MANIFEST_DIGEST,
		"d782.d781Forensic.historicalImplementation",
	);
	literal(
		forensic.repairedD780BaselineImplementationManifestDigest,
		"sha256:4b3f23f9b6b42e977dcb15869d76617ebaedb85724290fd8e7919ac2ff273328",
		"d782.d781Forensic.repairedD780Baseline",
	);
	literal(forensic.currentKeyCalls, 1, "d782.d781Forensic.currentKeyCalls");
	literal(forensic.providerCalls, 0, "d782.d781Forensic.providerCalls");
	literal(
		forensic.canonicalGraphEvidenceDisposition,
		"unavailable-provider-executor-not-started",
		"d782.d781Forensic.graphEvidence",
	);
	literal(forensic.successGenerationDisposition, "absent", "d782.d781Forensic.success");
	literal(forensic.partialCanonicalGraphEvidencePublished, false, "d782.d781Forensic.partial");
	literal(forensic.automaticRerun, false, "d782.d781Forensic.rerun");
	literal(forensic.causalAttribution, "undetermined", "d782.d781Forensic.attribution");
	literal(forensic.efficacyClaim, "none", "d782.d781Forensic.efficacy");
	const { forensicDigest, ...material } = forensic;
	literal(forensicDigest, D782_D781_FORENSIC_DIGEST, "d782.d781Forensic.digest");
	literal(forensicDigest, empiricalStrictJsonDigest(material), "d782.d781Forensic.canonicalDigest");
	return strictSnapshot(forensic);
}

export async function runD782LiveMeasurement(inputValue: {
	readonly historicalBundleBytes: Uint8Array;
	readonly d781ForensicBytes: Uint8Array;
	readonly executionAuthority: D782ExecutionAuthorityV1;
	readonly executor: D779CallerExecutorV1;
	readonly pricingReadDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly implementationManifestDigest: string;
	readonly signal: AbortSignal;
}): Promise<D782LiveBundleV1> {
	const input = record(inputValue, "d782.live.input");
	exactKeys(
		input,
		[
			"d781ForensicBytes",
			"executionAuthority",
			"executor",
			"historicalBundleBytes",
			"implementationManifestDigest",
			"pricingObservationDigest",
			"pricingReadDigest",
			"signal",
			"zeroByokObservationDigest",
		],
		"d782.live.input",
	);
	validateD782HistoricalBundleBytes(input.historicalBundleBytes as Uint8Array);
	validateD782D781ForensicBytes(input.d781ForensicBytes as Uint8Array);
	literal(
		input.implementationManifestDigest,
		D782_IMPLEMENTATION_MANIFEST_DIGEST,
		"d782.live.implementation",
	);
	const authority = consumeD782ExecutionAuthority(input.executionAuthority);
	if (!(input.signal instanceof AbortSignal)) throw new TypeError("D782 signal is invalid");
	const policy = createD761GraphPublicSemanticValidationPolicy();
	const terminalPolicy = createD726ArmLocalTerminalProviderPolicy();
	const sourceDigest = empiricalStrictJsonDigest({
		decisionRef: D782_DECISION_REF,
		coordinatesDigest: D782_COORDINATES_DIGEST,
		claimDigest: authority.claim.claimDigest,
	});
	const core = await runD779GraphNativeEvalCore({
		sourceDigest,
		budgetLimits: D782_BUDGET_LIMITS,
		effectCeilings: D782_EFFECT_CEILINGS,
		executor: input.executor as D779CallerExecutorV1,
		armLocalTerminalPolicy: terminalPolicy,
		objectivePhaseRecoveryPolicy: policy,
		signal: input.signal as AbortSignal,
	});
	const graphEvidence = deriveD771CanonicalGraphEvidence(
		core.ledger,
		core.effectRuns,
		terminalPolicy,
		policy,
	);
	const providerFacts = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.request.effectKind === "provider-request" &&
			fact.result.effectKind === "provider-request" &&
			fact.result.failureProvenance !== "executor-failure"
				? [fact as unknown as Readonly<Record<string, unknown>>]
				: [],
		),
	);
	const routeEvidence = validateD776RouteEvidence(
		core.routeEvidence,
		providerFacts,
		D782_EFFECT_CEILINGS,
		graphEvidence.ledger.effectReconciliations,
	);
	const gate = evaluateD775ArmAwarePositiveGate(
		graphEvidence,
		routeEvidence as never,
		sourceDigest,
	);
	const efficacyClaim = gate.passed
		? ("positive-differential-frozen-task-block" as const)
		: ("none" as const);
	const disposition =
		graphEvidence.runStatus === "complete" &&
		graphEvidence.ledger.completedArms.length === 6 &&
		routeEvidence.coverageComplete &&
		!hasOperationalFailure(graphEvidence)
			? ("success" as const)
			: ("partial-failure" as const);
	const qualificationMaterial = strictSnapshot({
		decisionRef: D782_DECISION_REF,
		decisionRevision: D782_DECISION_REVISION,
		coordinatesDigest: D782_COORDINATES_DIGEST,
		historicalArtifactSha256: D782_HISTORICAL_ARTIFACT_SHA256,
		historicalBundleDigest: D782_HISTORICAL_BUNDLE_DIGEST,
		historicalImplementationManifestDigest: D782_HISTORICAL_IMPLEMENTATION_MANIFEST_DIGEST,
		d781ForensicArtifactSha256: D782_D781_FORENSIC_ARTIFACT_SHA256,
		d781ForensicDigest: D782_D781_FORENSIC_DIGEST,
		baselineImplementationManifestDigest: D782_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
		implementationManifestDigest: D782_IMPLEMENTATION_MANIFEST_DIGEST,
		pricingReadDigest: digest(input.pricingReadDigest, "d782.pricingRead"),
		pricingObservationDigest: digest(input.pricingObservationDigest, "d782.pricingObservation"),
		zeroByokObservationDigest: digest(input.zeroByokObservationDigest, "d782.zeroByok"),
		claimDigest: authority.claim.claimDigest,
		currentKeyAdmissionDigest: authority.currentKeyAdmission.admissionDigest,
	});
	const qualification = strictSnapshot({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const observationMaterial = strictSnapshot({
		disposition,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		routeEvidenceDigest: routeEvidence.evidenceDigest,
		completedArms: graphEvidence.ledger.completedArms.length,
		gate,
		causalAttribution: "undetermined" as const,
		efficacyClaim,
	});
	const observation = strictSnapshot({
		...observationMaterial,
		observationDigest: empiricalStrictJsonDigest(observationMaterial),
	});
	const generationMaterial = strictSnapshot({
		generationRef: D782_GENERATION_REF,
		disposition,
		qualificationDigest: qualification.qualificationDigest,
		observationDigest: observation.observationDigest,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		routeEvidenceDigest: routeEvidence.evidenceDigest,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const terminalMaterial = strictSnapshot({
		generationRef: D782_GENERATION_REF,
		disposition,
		claimDigest: authority.claim.claimDigest,
		currentKeyAdmissionDigest: authority.currentKeyAdmission.admissionDigest,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		routeEvidenceDigest: routeEvidence.evidenceDigest,
		bundleOutcome: disposition === "success" ? "success-generation" : "partial-graph-evidence",
	});
	const terminalReceipt = strictSnapshot({
		...terminalMaterial,
		terminalReceiptDigest: empiricalStrictJsonDigest(terminalMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D782_BUNDLE_SCHEMA,
		disposition,
		graphEvidence,
		routeEvidence,
		taskExposureFacts: core.taskExposureFacts,
		toolRejectionFacts: core.toolRejectionFacts,
		qualification,
		observation,
		generation,
		terminalReceipt,
	});
	const bundle = Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
	constructed.add(bundle);
	return bundle;
}

function validateD782TaskToolFacts(
	taskValue: unknown,
	toolValue: unknown,
	graphEvidence: D771CanonicalGraphEvidenceV1,
	routeEvidence: D776RouteEvidenceV1,
): Readonly<{
	taskExposureFacts: readonly D778TaskExposureFactV1[];
	toolRejectionFacts: readonly D778ToolRejectionFactV1[];
}> {
	if (!Array.isArray(taskValue) || taskValue.length > 128)
		throw new TypeError("D782 task exposure facts are outside the bound");
	const graphFacts = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) => (fact.kind === "graph-effect-result-admitted" ? [fact] : [])),
	);
	const taskExposureFacts = taskValue.map((value, index) => {
		const fact = record(value, `d782.taskExposureFacts[${index}]`);
		exactKeys(
			fact,
			[
				"admissionDigest",
				"arm",
				"envelopeDigest",
				"factDigest",
				"modelVisibleMessagesDigest",
				"reconciliationDigest",
				"requestDigest",
				"resultFactDigest",
				"runSequence",
				"schemaVersion",
			],
			`d782.taskExposureFacts[${index}]`,
		);
		literal(
			fact.schemaVersion,
			D778_TASK_EXPOSURE_FACT_SCHEMA,
			`d782.taskExposureFacts[${index}].schema`,
		);
		const { factDigest, ...material } = fact;
		literal(
			factDigest,
			empiricalStrictJsonDigest(material),
			`d782.taskExposureFacts[${index}].digest`,
		);
		const matchingGraph = graphFacts.filter(
			(candidate) =>
				candidate.request.effectKind === "provider-request" &&
				candidate.request.requestDigest === fact.requestDigest &&
				candidate.admissionDigest === fact.admissionDigest &&
				candidate.factDigest === fact.resultFactDigest,
		);
		const matchingRoute = routeEvidence.facts.filter(
			(candidate) =>
				candidate.requestDigest === fact.requestDigest &&
				candidate.admissionDigest === fact.admissionDigest &&
				candidate.resultFactDigest === fact.resultFactDigest &&
				candidate.reconciliationDigest === fact.reconciliationDigest &&
				candidate.modelVisibleMessagesDigest === fact.modelVisibleMessagesDigest,
		);
		if (matchingGraph.length !== 1 || matchingRoute.length !== 1)
			throw new TypeError("D782 task exposure fact is not bijective with Graph and route evidence");
		const issued = graphEvidence.ledger.issuedRequests.find(
			(candidate) =>
				empiricalStrictJsonDigest(candidate) === matchingGraph[0]!.request.issuedRequestDigest,
		);
		if (issued?.payload === undefined)
			throw new TypeError("D782 task exposure fact lacks one Graph-issued run request");
		const expectedEnvelope = createD778GraphTaskEnvelope({
			arm: issued.payload.arm,
			effectRequest: matchingGraph[0]!.request,
		});
		if (
			fact.envelopeDigest !== expectedEnvelope.envelopeDigest ||
			fact.arm !== expectedEnvelope.arm ||
			fact.runSequence !== expectedEnvelope.runSequence ||
			fact.modelVisibleMessagesDigest !== matchingRoute[0]!.modelVisibleMessagesDigest
		)
			throw new TypeError("D782 task exposure envelope/wire projection drifted");
		return strictSnapshot(fact) as unknown as D778TaskExposureFactV1;
	});
	const providerGraphFacts = graphFacts.filter(
		(fact) =>
			fact.request.effectKind === "provider-request" &&
			fact.result.effectKind === "provider-request" &&
			fact.result.failureProvenance !== "executor-failure",
	);
	if (taskExposureFacts.length !== providerGraphFacts.length)
		throw new TypeError("D782 task exposure/provider result coverage drifted");
	const taskKeys = taskExposureFacts.map(
		(fact) => `${fact.requestDigest}:${fact.admissionDigest}:${fact.resultFactDigest}`,
	);
	if (new Set(taskKeys).size !== taskKeys.length)
		throw new TypeError("D782 task exposure fact replayed");
	const toolRejectionFacts = validateD782ToolRejectionFacts(toolValue, graphEvidence);
	return Object.freeze({
		taskExposureFacts: Object.freeze(taskExposureFacts),
		toolRejectionFacts: Object.freeze(toolRejectionFacts),
	});
}

export function validateD782ToolRejectionFactsForTest(input: {
	readonly toolRejectionFacts: unknown;
	readonly graphEvidence: D771CanonicalGraphEvidenceV1;
}): void {
	validateD782ToolRejectionFacts(input.toolRejectionFacts, input.graphEvidence);
}

export function validateD782TaskToolFactsForTest(input: {
	readonly taskExposureFacts: unknown;
	readonly toolRejectionFacts: unknown;
	readonly graphEvidence: D771CanonicalGraphEvidenceV1;
	readonly routeEvidence: D776RouteEvidenceV1;
}): void {
	validateD782TaskToolFacts(
		input.taskExposureFacts,
		input.toolRejectionFacts,
		input.graphEvidence,
		input.routeEvidence,
	);
}

export function validateD782LiveBundle(value: unknown): D782LiveBundleV1 {
	const candidate = record(value, "d782.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"disposition",
			"generation",
			"graphEvidence",
			"routeEvidence",
			"taskExposureFacts",
			"observation",
			"qualification",
			"schemaVersion",
			"terminalReceipt",
			"toolRejectionFacts",
		],
		"d782.bundle",
	);
	literal(candidate.schemaVersion, D782_BUNDLE_SCHEMA, "d782.bundle.schema");
	const graphCandidate = record(candidate.graphEvidence, "d782.bundle.graphEvidence");
	const policy = createD761GraphPublicSemanticValidationPolicy();
	const terminalPolicy = createD726ArmLocalTerminalProviderPolicy();
	const graphEvidence = deriveD771CanonicalGraphEvidence(
		graphCandidate.ledger as never,
		graphCandidate.effectRuns as never,
		terminalPolicy,
		policy,
	);
	literal(
		empiricalStrictJsonDigest(graphCandidate),
		empiricalStrictJsonDigest(graphEvidence),
		"d782.bundle.graphEvidence.canonicalReplay",
	);
	const providerFacts = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.request.effectKind === "provider-request" &&
			fact.result.effectKind === "provider-request" &&
			fact.result.failureProvenance !== "executor-failure"
				? [fact as unknown as Readonly<Record<string, unknown>>]
				: [],
		),
	);
	const routeEvidence = validateD776RouteEvidence(
		candidate.routeEvidence,
		providerFacts,
		D782_EFFECT_CEILINGS,
		graphEvidence.ledger.effectReconciliations,
	);
	const { taskExposureFacts, toolRejectionFacts } = validateD782TaskToolFacts(
		candidate.taskExposureFacts,
		candidate.toolRejectionFacts,
		graphEvidence,
		routeEvidence,
	);
	const qualification = record(candidate.qualification, "d782.bundle.qualification");
	exactKeys(
		qualification,
		[
			"baselineImplementationManifestDigest",
			"claimDigest",
			"coordinatesDigest",
			"currentKeyAdmissionDigest",
			"d781ForensicArtifactSha256",
			"d781ForensicDigest",
			"decisionRef",
			"decisionRevision",
			"historicalArtifactSha256",
			"historicalBundleDigest",
			"historicalImplementationManifestDigest",
			"implementationManifestDigest",
			"pricingObservationDigest",
			"pricingReadDigest",
			"qualificationDigest",
			"zeroByokObservationDigest",
		],
		"d782.bundle.qualification",
	);
	const { qualificationDigest: qualificationDigestValue, ...qualificationMaterial } = qualification;
	const qualificationDigest = digest(qualificationDigestValue, "d782.bundle.qualification.digest");
	literal(
		qualificationDigest,
		empiricalStrictJsonDigest(qualificationMaterial),
		"d782.bundle.qualification.digest",
	);
	literal(qualification.decisionRef, D782_DECISION_REF, "d782.bundle.qualification.decision");
	literal(
		qualification.decisionRevision,
		D782_DECISION_REVISION,
		"d782.bundle.qualification.revision",
	);
	literal(
		qualification.coordinatesDigest,
		D782_COORDINATES_DIGEST,
		"d782.bundle.qualification.coordinates",
	);
	literal(
		qualification.historicalArtifactSha256,
		D782_HISTORICAL_ARTIFACT_SHA256,
		"d782.bundle.qualification.historicalArtifact",
	);
	literal(
		qualification.historicalBundleDigest,
		D782_HISTORICAL_BUNDLE_DIGEST,
		"d782.bundle.qualification.historicalBundle",
	);
	literal(
		qualification.historicalImplementationManifestDigest,
		D782_HISTORICAL_IMPLEMENTATION_MANIFEST_DIGEST,
		"d782.bundle.qualification.historicalImplementation",
	);
	literal(
		qualification.d781ForensicArtifactSha256,
		D782_D781_FORENSIC_ARTIFACT_SHA256,
		"d782.bundle.qualification.d781ForensicArtifact",
	);
	literal(
		qualification.d781ForensicDigest,
		D782_D781_FORENSIC_DIGEST,
		"d782.bundle.qualification.d781ForensicDigest",
	);
	literal(
		qualification.baselineImplementationManifestDigest,
		D782_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
		"d782.bundle.qualification.baselineImplementation",
	);
	literal(
		qualification.implementationManifestDigest,
		D782_IMPLEMENTATION_MANIFEST_DIGEST,
		"d782.bundle.qualification.implementation",
	);
	digest(qualification.pricingReadDigest, "d782.bundle.qualification.pricingRead");
	digest(qualification.pricingObservationDigest, "d782.bundle.qualification.pricingObservation");
	digest(qualification.zeroByokObservationDigest, "d782.bundle.qualification.zeroByokObservation");
	digest(qualification.claimDigest, "d782.bundle.qualification.claim");
	digest(qualification.currentKeyAdmissionDigest, "d782.bundle.qualification.currentKeyAdmission");
	const expectedSourceDigest = empiricalStrictJsonDigest({
		decisionRef: D782_DECISION_REF,
		coordinatesDigest: D782_COORDINATES_DIGEST,
		claimDigest: digest(qualification.claimDigest, "d782.bundle.qualification.claimDigest"),
	});
	const gate = evaluateD775ArmAwarePositiveGate(
		graphEvidence,
		routeEvidence as never,
		expectedSourceDigest,
	);
	const observation = record(candidate.observation, "d782.bundle.observation");
	exactKeys(
		observation,
		[
			"causalAttribution",
			"completedArms",
			"disposition",
			"efficacyClaim",
			"gate",
			"graphEvidenceDigest",
			"observationDigest",
			"routeEvidenceDigest",
		],
		"d782.bundle.observation",
	);
	literal(
		empiricalStrictJsonDigest(observation.gate),
		empiricalStrictJsonDigest(gate),
		"d782.bundle.observation.gate",
	);
	const derivedDisposition =
		graphEvidence.runStatus === "complete" &&
		graphEvidence.ledger.completedArms.length === 6 &&
		routeEvidence.coverageComplete &&
		!hasOperationalFailure(graphEvidence)
			? "success"
			: "partial-failure";
	literal(candidate.disposition, derivedDisposition, "d782.bundle.disposition");
	literal(observation.disposition, derivedDisposition, "d782.bundle.observation.disposition");
	literal(
		observation.graphEvidenceDigest,
		graphEvidence.evidenceDigest,
		"d782.bundle.observation.graph",
	);
	literal(
		observation.routeEvidenceDigest,
		routeEvidence.evidenceDigest,
		"d782.bundle.observation.route",
	);
	literal(
		observation.completedArms,
		graphEvidence.ledger.completedArms.length,
		"d782.bundle.observation.arms",
	);
	literal(observation.causalAttribution, "undetermined", "d782.bundle.observation.attribution");
	literal(
		observation.efficacyClaim,
		gate.passed ? "positive-differential-frozen-task-block" : "none",
		"d782.bundle.observation.efficacy",
	);
	const { observationDigest: observationDigestValue, ...observationMaterial } = observation;
	const observationDigest = digest(observationDigestValue, "d782.bundle.observation.digest");
	literal(
		observationDigest,
		empiricalStrictJsonDigest(observationMaterial),
		"d782.bundle.observation.digest",
	);
	const generation = record(candidate.generation, "d782.bundle.generation");
	exactKeys(
		generation,
		[
			"disposition",
			"generationDigest",
			"generationRef",
			"graphEvidenceDigest",
			"observationDigest",
			"qualificationDigest",
			"routeEvidenceDigest",
		],
		"d782.bundle.generation",
	);
	const { generationDigest, ...generationMaterial } = generation;
	literal(
		generationDigest,
		empiricalStrictJsonDigest(generationMaterial),
		"d782.bundle.generation.digest",
	);
	literal(generation.generationRef, D782_GENERATION_REF, "d782.bundle.generation.ref");
	literal(generation.disposition, derivedDisposition, "d782.bundle.generation.disposition");
	literal(
		generation.qualificationDigest,
		qualificationDigest,
		"d782.bundle.generation.qualification",
	);
	literal(generation.observationDigest, observationDigest, "d782.bundle.generation.observation");
	literal(
		generation.graphEvidenceDigest,
		graphEvidence.evidenceDigest,
		"d782.bundle.generation.graph",
	);
	literal(
		generation.routeEvidenceDigest,
		routeEvidence.evidenceDigest,
		"d782.bundle.generation.route",
	);
	const terminalReceipt = record(candidate.terminalReceipt, "d782.bundle.terminalReceipt");
	exactKeys(
		terminalReceipt,
		[
			"bundleOutcome",
			"claimDigest",
			"currentKeyAdmissionDigest",
			"disposition",
			"generationRef",
			"graphEvidenceDigest",
			"routeEvidenceDigest",
			"terminalReceiptDigest",
		],
		"d782.bundle.terminalReceipt",
	);
	const { terminalReceiptDigest, ...terminalMaterial } = terminalReceipt;
	literal(
		terminalReceiptDigest,
		empiricalStrictJsonDigest(terminalMaterial),
		"d782.bundle.terminalReceipt.digest",
	);
	literal(
		terminalReceipt.disposition,
		derivedDisposition,
		"d782.bundle.terminalReceipt.disposition",
	);
	literal(
		terminalReceipt.claimDigest,
		digest(qualification.claimDigest, "d782.bundle.qualification.claim"),
		"d782.bundle.terminalReceipt.claim",
	);
	literal(
		terminalReceipt.currentKeyAdmissionDigest,
		digest(qualification.currentKeyAdmissionDigest, "d782.bundle.qualification.currentKey"),
		"d782.bundle.terminalReceipt.currentKey",
	);
	literal(
		terminalReceipt.bundleOutcome,
		derivedDisposition === "success" ? "success-generation" : "partial-graph-evidence",
		"d782.bundle.terminalReceipt.outcome",
	);
	const bundleDigest = digest(candidate.bundleDigest, "d782.bundle.digest");
	const material = strictSnapshot({
		schemaVersion: candidate.schemaVersion,
		disposition: candidate.disposition,
		graphEvidence,
		routeEvidence,
		taskExposureFacts,
		toolRejectionFacts,
		qualification,
		observation,
		generation,
		terminalReceipt,
	});
	literal(bundleDigest, empiricalStrictJsonDigest(material), "d782.bundle.digest");
	return strictSnapshot({ ...material, bundleDigest }) as D782LiveBundleV1;
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(
		path,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function writePrivateFile(path: string, bytes: Uint8Array): Promise<void> {
	const handle = await open(
		path,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
		const stat = await handle.stat();
		if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600)
			throw new TypeError("D782 private artifact identity is invalid");
	} finally {
		await handle.close();
	}
}

export async function persistD782LiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D782LiveBundleV1;
}) {
	const input = record(inputValue, "d782.persist.input");
	exactKeys(input, ["bundle", "privateRoot"], "d782.persist.input");
	const bundle = input.bundle as D782LiveBundleV1;
	if (!constructed.delete(bundle))
		throw new TypeError("D782 persistence requires fresh constructed bundle");
	validateD782LiveBundle(bundle);
	const privateRoot = resolve(input.privateRoot as string);
	if ((await realpath(privateRoot)) !== privateRoot)
		throw new TypeError("D782 private root is not canonical");
	const rootStat = await lstat(privateRoot);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o777) !== 0o700)
		throw new TypeError("D782 private root ownership is invalid");
	const rootIdentity = { dev: rootStat.dev, ino: rootStat.ino };
	const parentHandle = await open(
		privateRoot,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	const parentStat = await parentHandle.stat().catch(async (error) => {
		await parentHandle.close().catch(() => undefined);
		throw error;
	});
	if (
		parentStat.dev !== rootIdentity.dev ||
		parentStat.ino !== rootIdentity.ino ||
		!parentStat.isDirectory() ||
		(parentStat.mode & 0o777) !== 0o700
	) {
		await parentHandle.close();
		throw new TypeError("D782 private root changed before stable-handle acquisition");
	}
	const staging = join(privateRoot, `.d782-${randomUUID()}.tmp`);
	const finalRoot = join(privateRoot, D782_GENERATION_REF);
	let finalIdentity: Readonly<{ dev: number | bigint; ino: number | bigint }> | null = null;
	let stagingIdentity: Readonly<{ dev: number | bigint; ino: number | bigint }> | null = null;
	let finalHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactsHandle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		await mkdir(finalRoot, { mode: 0o700 });
		const finalStat = await lstat(finalRoot);
		finalIdentity = { dev: finalStat.dev, ino: finalStat.ino };
		finalHandle = await open(
			finalRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const stableFinal = await finalHandle.stat();
		if (
			stableFinal.dev !== finalIdentity.dev ||
			stableFinal.ino !== finalIdentity.ino ||
			!stableFinal.isDirectory() ||
			(stableFinal.mode & 0o777) !== 0o700
		)
			throw new TypeError("D782 final claim changed before stable-handle acquisition");
		await mkdir(staging, { mode: 0o700 });
		const stagingStat = await lstat(staging);
		stagingIdentity = { dev: stagingStat.dev, ino: stagingStat.ino };
		const files = {
			"graph-evidence.v1.json": strictJsonCodec.encode(bundle.graphEvidence),
			"route-evidence.v1.json": strictJsonCodec.encode(bundle.routeEvidence),
			"task-exposure-facts.v1.json": strictJsonCodec.encode(bundle.taskExposureFacts),
			"tool-rejection-facts.v1.json": strictJsonCodec.encode(bundle.toolRejectionFacts),
			"qualification.v1.json": strictJsonCodec.encode(bundle.qualification),
			"observation.v1.json": strictJsonCodec.encode(bundle.observation),
			[bundle.disposition === "success"
				? "success-generation.v1.json"
				: "partial-graph-generation.v1.json"]: strictJsonCodec.encode(bundle.generation),
			"terminal-receipt.v1.json": strictJsonCodec.encode(bundle.terminalReceipt),
			"bundle.v1.json": strictJsonCodec.encode(bundle),
		};
		for (const [name, bytes] of Object.entries(files)) {
			await writePrivateFile(join(staging, name), bytes);
		}
		await syncDirectory(staging);
		await rename(staging, join(finalRoot, "artifacts"));
		const artifactsRoot = join(finalRoot, "artifacts");
		artifactsHandle = await open(
			artifactsRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const stableArtifacts = await artifactsHandle.stat();
		if (
			stableArtifacts.dev !== stagingIdentity.dev ||
			stableArtifacts.ino !== stagingIdentity.ino ||
			!stableArtifacts.isDirectory() ||
			(stableArtifacts.mode & 0o777) !== 0o700
		)
			throw new TypeError("D782 committed artifacts identity drifted");
		stagingIdentity = null;
		const markerMaterial = strictSnapshot({
			generationRef: D782_GENERATION_REF,
			bundleDigest: bundle.bundleDigest,
			bundleArtifactDigest: empiricalSha256(files["bundle.v1.json"]),
			generationDigest: bundle.generation.generationDigest,
			terminalReceiptDigest: bundle.terminalReceipt.terminalReceiptDigest,
		});
		const marker = strictSnapshot({
			...markerMaterial,
			commitMarkerDigest: empiricalStrictJsonDigest(markerMaterial),
		});
		const markerBytes = strictJsonCodec.encode(marker);
		await writePrivateFile(join(finalRoot, "commit.v1.json"), markerBytes);
		await finalHandle.sync();
		await parentHandle.sync();
		for (const [name, bytes] of Object.entries(files)) {
			const handle = await open(
				join(artifactsRoot, name),
				constants.O_RDONLY | constants.O_NOFOLLOW,
			);
			try {
				const stat = await handle.stat();
				const readback = new Uint8Array(await handle.readFile());
				if (
					!stat.isFile() ||
					stat.nlink !== 1 ||
					(stat.mode & 0o777) !== 0o600 ||
					!sameBytes(readback, bytes)
				)
					throw new TypeError("D782 published artifact readback drifted");
			} finally {
				await handle.close();
			}
		}
		const markerHandle = await open(
			join(finalRoot, "commit.v1.json"),
			constants.O_RDONLY | constants.O_NOFOLLOW,
		);
		try {
			const stat = await markerHandle.stat();
			if (
				!stat.isFile() ||
				stat.nlink !== 1 ||
				(stat.mode & 0o777) !== 0o600 ||
				!sameBytes(new Uint8Array(await markerHandle.readFile()), markerBytes)
			)
				throw new TypeError("D782 commit marker readback drifted");
		} finally {
			await markerHandle.close();
		}
		const reboundRoot = await lstat(privateRoot);
		const reboundFinal = await lstat(finalRoot);
		const reboundArtifacts = await lstat(artifactsRoot);
		const stableFinalAfter = await finalHandle.stat();
		const stableArtifactsAfter = await artifactsHandle.stat();
		if (
			reboundRoot.dev !== rootIdentity.dev ||
			reboundRoot.ino !== rootIdentity.ino ||
			reboundFinal.dev !== finalIdentity.dev ||
			reboundFinal.ino !== finalIdentity.ino ||
			reboundArtifacts.dev !== stableArtifacts.dev ||
			reboundArtifacts.ino !== stableArtifacts.ino ||
			stableFinalAfter.dev !== finalIdentity.dev ||
			stableFinalAfter.ino !== finalIdentity.ino ||
			stableArtifactsAfter.dev !== stableArtifacts.dev ||
			stableArtifactsAfter.ino !== stableArtifacts.ino ||
			!reboundFinal.isDirectory() ||
			(reboundFinal.mode & 0o777) !== 0o700 ||
			(await realpath(finalRoot)) !== finalRoot
		)
			throw new TypeError("D782 final generation identity drifted");
		const closeResults = await Promise.allSettled([
			artifactsHandle.close(),
			finalHandle.close(),
			parentHandle.close(),
		]);
		artifactsHandle = null;
		finalHandle = null;
		const closeErrors = closeResults.filter(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		if (closeErrors.length > 0)
			throw new AggregateError(
				closeErrors.map((result) => result.reason),
				"D782 stable persistence handle close failed",
			);
		const receipt = strictSnapshot({
			schemaVersion: D782_PERSISTENCE_SCHEMA,
			generationRef: D782_GENERATION_REF,
			bundleArtifactDigest: marker.bundleArtifactDigest,
			bundleDigest: bundle.bundleDigest,
			generationDigest: bundle.generation.generationDigest,
			terminalReceiptDigest: bundle.terminalReceipt.terminalReceiptDigest,
			commitMarkerDigest: marker.commitMarkerDigest,
		});
		return strictSnapshot({ ...receipt, persistenceDigest: empiricalStrictJsonDigest(receipt) });
	} catch (error) {
		const cleanupErrors: unknown[] = [];
		for (const handle of [artifactsHandle, finalHandle])
			if (handle !== null)
				await handle.close().catch((cleanupError) => cleanupErrors.push(cleanupError));
		if (stagingIdentity !== null) {
			const current = await lstat(staging).catch(() => null);
			if (
				current !== null &&
				current.dev === stagingIdentity.dev &&
				current.ino === stagingIdentity.ino
			)
				await rm(staging, { recursive: true, force: true }).catch((cleanupError) =>
					cleanupErrors.push(cleanupError),
				);
		}
		if (finalIdentity !== null) {
			const current = await lstat(finalRoot).catch(() => null);
			if (
				current !== null &&
				current.dev === finalIdentity.dev &&
				current.ino === finalIdentity.ino
			) {
				const tombstone = join(privateRoot, `.d782-cleanup-${randomUUID()}.tmp`);
				await rename(finalRoot, tombstone).catch((cleanupError) =>
					cleanupErrors.push(cleanupError),
				);
				const moved = await lstat(tombstone).catch(() => null);
				if (moved !== null && moved.dev === finalIdentity.dev && moved.ino === finalIdentity.ino)
					await rm(tombstone, { recursive: true, force: true }).catch((cleanupError) =>
						cleanupErrors.push(cleanupError),
					);
				else if (moved !== null)
					cleanupErrors.push(new TypeError("D782 cleanup tombstone identity drifted"));
			}
		}
		await parentHandle.close().catch(() => undefined);
		if (cleanupErrors.length > 0)
			throw new AggregateError([error, ...cleanupErrors], "D782 persistence and cleanup failed");
		throw error;
	}
}
