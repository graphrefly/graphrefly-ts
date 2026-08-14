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
	D781_BUDGET_LIMITS,
	D781_COORDINATES_DIGEST,
	D781_D780_FORENSIC_ARTIFACT_SHA256,
	D781_D780_FORENSIC_DIGEST,
	D781_DECISION_REF,
	D781_DECISION_REVISION,
	D781_EFFECT_CEILINGS,
	D781_GENERATION_REF,
	D781_HISTORICAL_ARTIFACT_SHA256,
	D781_HISTORICAL_BUNDLE_DIGEST,
	D781_HISTORICAL_IMPLEMENTATION_MANIFEST_DIGEST,
	D781_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
} from "./d781-coordinates.js";
import { D781_IMPLEMENTATION_MANIFEST_DIGEST } from "./d781-implementation-manifest.js";
import {
	consumeD781ExecutionAuthority,
	type D781ExecutionAuthorityV1,
} from "./d781-single-use-dispatch-claim.js";

export const D781_BUNDLE_SCHEMA = "graphrefly.b112.d781.live-bundle.v1" as const;
export const D781_PERSISTENCE_SCHEMA = "graphrefly.b112.d781.live-persistence.v1" as const;

export interface D781LiveBundleV1 {
	readonly schemaVersion: typeof D781_BUNDLE_SCHEMA;
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

type D781AdmittedEffectFact = D771CanonicalGraphEvidenceV1["effectRuns"][number]["facts"][number];

function isD781GraphSynthesizedToolFailure(fact: D781AdmittedEffectFact): boolean {
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

export function isD781GraphSynthesizedToolFailureForTest(value: unknown): boolean {
	return isD781GraphSynthesizedToolFailure(value as D781AdmittedEffectFact);
}

function validateD781ToolRejectionFacts(
	toolValue: unknown,
	graphEvidence: D771CanonicalGraphEvidenceV1,
): readonly D778ToolRejectionFactV1[] {
	if (!Array.isArray(toolValue) || toolValue.length > 64)
		throw new TypeError("D781 tool rejection facts are outside the bound");
	const graphFacts = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) => (fact.kind === "graph-effect-result-admitted" ? [fact] : [])),
	);
	const toolRejectionFacts = toolValue.map((value, index) => {
		const fact = record(value, `d781.toolRejectionFacts[${index}]`);
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
			`d781.toolRejectionFacts[${index}]`,
		);
		literal(
			fact.schemaVersion,
			D778_TOOL_REJECTION_FACT_SCHEMA,
			`d781.toolRejectionFacts[${index}].schema`,
		);
		const { factDigest, ...material } = fact;
		literal(
			factDigest,
			empiricalStrictJsonDigest(material),
			`d781.toolRejectionFacts[${index}].digest`,
		);
		if (fact.workspaceStateBeforeDigest !== fact.workspaceStateAfterDigest)
			throw new TypeError("D781 rejected tool changed workspace state");
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
			throw new TypeError("D781 tool rejection fact is not bijective with Graph evidence");
		return strictSnapshot(fact) as unknown as D778ToolRejectionFactV1;
	});
	const toolKeys = toolRejectionFacts.map(
		(fact) => `${fact.requestDigest}:${fact.admissionDigest}:${fact.resultFactDigest}`,
	);
	if (new Set(toolKeys).size !== toolKeys.length)
		throw new TypeError("D781 tool rejection fact replayed");
	const rejectedToolFacts = graphFacts.filter(
		(fact) =>
			fact.request.effectKind === "tool-action" &&
			fact.result.effectKind === "tool-action" &&
			fact.result.status === "failed" &&
			!isD781GraphSynthesizedToolFailure(fact),
	);
	if (toolRejectionFacts.length !== rejectedToolFacts.length)
		throw new TypeError("D781 tool rejection/failed effect coverage drifted");
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

export function validateD781HistoricalBundleBytes(bytes: Uint8Array): void {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 16 * 1_048_576)
		throw new TypeError("D781 historical artifact bytes are invalid");
	literal(empiricalSha256(bytes), D781_HISTORICAL_ARTIFACT_SHA256, "d781.historical.sha256");
	const bundle = validateD779QualificationBundle(strictJsonCodec.decode(new Uint8Array(bytes)));
	literal(bundle.bundleDigest, D781_HISTORICAL_BUNDLE_DIGEST, "d781.historical.bundle");
	literal(
		bundle.qualification.implementationManifestDigest,
		D781_HISTORICAL_IMPLEMENTATION_MANIFEST_DIGEST,
		"d781.historical.implementation",
	);
}

export function validateD781D780ForensicBytes(
	bytes: Uint8Array,
): Readonly<Record<string, unknown>> {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 16_384)
		throw new TypeError("D781 D780 forensic artifact bytes are invalid");
	literal(empiricalSha256(bytes), D781_D780_FORENSIC_ARTIFACT_SHA256, "d781.d780Forensic.sha256");
	let decoded: unknown;
	try {
		decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (error) {
		throw new TypeError("D781 D780 forensic artifact is not bounded UTF-8 JSON", {
			cause: error,
		});
	}
	const forensic = record(decoded, "d781.d780Forensic");
	exactKeys(
		forensic,
		[
			"automaticRerun",
			"canonicalGraphEvidenceDisposition",
			"causalAttribution",
			"claimDigest",
			"currentKeyAdmissionDigest",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"failureCode",
			"failurePhase",
			"forensicDigest",
			"implementationManifestDigest",
			"partialCanonicalGraphEvidencePublished",
			"pricingReadDigest",
			"providerActivityObserved",
			"remainingMicrousdAtCurrentKeyAdmission",
			"schemaVersion",
			"status",
			"successGenerationDisposition",
			"zeroByokObservationDigest",
		],
		"d781.d780Forensic",
	);
	literal(
		forensic.schemaVersion,
		"graphrefly.b112.d780.post-run-validator-failure-forensic.v1",
		"d781.d780Forensic.schema",
	);
	literal(forensic.decisionRef, "decision.D780", "d781.d780Forensic.decision");
	literal(forensic.decisionRevision, "2026-08-13.v1", "d781.d780Forensic.revision");
	literal(forensic.status, "failed-post-run-validation", "d781.d780Forensic.status");
	literal(
		forensic.failurePhase,
		"post-run-canonical-bundle-validation",
		"d781.d780Forensic.failurePhase",
	);
	literal(
		forensic.failureCode,
		"tool-rejection-failed-effect-coverage-drift",
		"d781.d780Forensic.failureCode",
	);
	digest(forensic.claimDigest, "d781.d780Forensic.claim");
	digest(forensic.currentKeyAdmissionDigest, "d781.d780Forensic.currentKey");
	digest(forensic.pricingReadDigest, "d781.d780Forensic.pricing");
	digest(forensic.zeroByokObservationDigest, "d781.d780Forensic.zeroByok");
	digest(forensic.implementationManifestDigest, "d781.d780Forensic.implementation");
	if (
		!Number.isSafeInteger(forensic.remainingMicrousdAtCurrentKeyAdmission) ||
		(forensic.remainingMicrousdAtCurrentKeyAdmission as number) < 6_000_000 ||
		(forensic.remainingMicrousdAtCurrentKeyAdmission as number) > 32_000_000
	)
		throw new TypeError("D781 D780 forensic current-key admission is invalid");
	literal(forensic.providerActivityObserved, true, "d781.d780Forensic.providerActivity");
	literal(
		forensic.canonicalGraphEvidenceDisposition,
		"unavailable-process-exited-before-persistence",
		"d781.d780Forensic.graphEvidence",
	);
	literal(forensic.successGenerationDisposition, "absent", "d781.d780Forensic.success");
	literal(forensic.partialCanonicalGraphEvidencePublished, false, "d781.d780Forensic.partial");
	literal(forensic.automaticRerun, false, "d781.d780Forensic.rerun");
	literal(forensic.causalAttribution, "undetermined", "d781.d780Forensic.attribution");
	literal(forensic.efficacyClaim, "none", "d781.d780Forensic.efficacy");
	const { forensicDigest, ...material } = forensic;
	literal(forensicDigest, D781_D780_FORENSIC_DIGEST, "d781.d780Forensic.digest");
	literal(forensicDigest, empiricalStrictJsonDigest(material), "d781.d780Forensic.canonicalDigest");
	return strictSnapshot(forensic);
}

export async function runD781LiveMeasurement(inputValue: {
	readonly historicalBundleBytes: Uint8Array;
	readonly d780ForensicBytes: Uint8Array;
	readonly executionAuthority: D781ExecutionAuthorityV1;
	readonly executor: D779CallerExecutorV1;
	readonly pricingReadDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly implementationManifestDigest: string;
	readonly signal: AbortSignal;
}): Promise<D781LiveBundleV1> {
	const input = record(inputValue, "d781.live.input");
	exactKeys(
		input,
		[
			"d780ForensicBytes",
			"executionAuthority",
			"executor",
			"historicalBundleBytes",
			"implementationManifestDigest",
			"pricingObservationDigest",
			"pricingReadDigest",
			"signal",
			"zeroByokObservationDigest",
		],
		"d781.live.input",
	);
	validateD781HistoricalBundleBytes(input.historicalBundleBytes as Uint8Array);
	validateD781D780ForensicBytes(input.d780ForensicBytes as Uint8Array);
	literal(
		input.implementationManifestDigest,
		D781_IMPLEMENTATION_MANIFEST_DIGEST,
		"d781.live.implementation",
	);
	const authority = consumeD781ExecutionAuthority(input.executionAuthority);
	if (!(input.signal instanceof AbortSignal)) throw new TypeError("D781 signal is invalid");
	const policy = createD761GraphPublicSemanticValidationPolicy();
	const terminalPolicy = createD726ArmLocalTerminalProviderPolicy();
	const sourceDigest = empiricalStrictJsonDigest({
		decisionRef: D781_DECISION_REF,
		coordinatesDigest: D781_COORDINATES_DIGEST,
		claimDigest: authority.claim.claimDigest,
	});
	const core = await runD779GraphNativeEvalCore({
		sourceDigest,
		budgetLimits: D781_BUDGET_LIMITS,
		effectCeilings: D781_EFFECT_CEILINGS,
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
		D781_EFFECT_CEILINGS,
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
		decisionRef: D781_DECISION_REF,
		decisionRevision: D781_DECISION_REVISION,
		coordinatesDigest: D781_COORDINATES_DIGEST,
		historicalArtifactSha256: D781_HISTORICAL_ARTIFACT_SHA256,
		historicalBundleDigest: D781_HISTORICAL_BUNDLE_DIGEST,
		historicalImplementationManifestDigest: D781_HISTORICAL_IMPLEMENTATION_MANIFEST_DIGEST,
		d780ForensicArtifactSha256: D781_D780_FORENSIC_ARTIFACT_SHA256,
		d780ForensicDigest: D781_D780_FORENSIC_DIGEST,
		baselineImplementationManifestDigest: D781_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
		implementationManifestDigest: D781_IMPLEMENTATION_MANIFEST_DIGEST,
		pricingReadDigest: digest(input.pricingReadDigest, "d781.pricingRead"),
		pricingObservationDigest: digest(input.pricingObservationDigest, "d781.pricingObservation"),
		zeroByokObservationDigest: digest(input.zeroByokObservationDigest, "d781.zeroByok"),
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
		generationRef: D781_GENERATION_REF,
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
		generationRef: D781_GENERATION_REF,
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
		schemaVersion: D781_BUNDLE_SCHEMA,
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

function validateD781TaskToolFacts(
	taskValue: unknown,
	toolValue: unknown,
	graphEvidence: D771CanonicalGraphEvidenceV1,
	routeEvidence: D776RouteEvidenceV1,
): Readonly<{
	taskExposureFacts: readonly D778TaskExposureFactV1[];
	toolRejectionFacts: readonly D778ToolRejectionFactV1[];
}> {
	if (!Array.isArray(taskValue) || taskValue.length > 128)
		throw new TypeError("D781 task exposure facts are outside the bound");
	const graphFacts = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) => (fact.kind === "graph-effect-result-admitted" ? [fact] : [])),
	);
	const taskExposureFacts = taskValue.map((value, index) => {
		const fact = record(value, `d781.taskExposureFacts[${index}]`);
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
			`d781.taskExposureFacts[${index}]`,
		);
		literal(
			fact.schemaVersion,
			D778_TASK_EXPOSURE_FACT_SCHEMA,
			`d781.taskExposureFacts[${index}].schema`,
		);
		const { factDigest, ...material } = fact;
		literal(
			factDigest,
			empiricalStrictJsonDigest(material),
			`d781.taskExposureFacts[${index}].digest`,
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
			throw new TypeError("D781 task exposure fact is not bijective with Graph and route evidence");
		const issued = graphEvidence.ledger.issuedRequests.find(
			(candidate) =>
				empiricalStrictJsonDigest(candidate) === matchingGraph[0]!.request.issuedRequestDigest,
		);
		if (issued?.payload === undefined)
			throw new TypeError("D781 task exposure fact lacks one Graph-issued run request");
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
			throw new TypeError("D781 task exposure envelope/wire projection drifted");
		return strictSnapshot(fact) as unknown as D778TaskExposureFactV1;
	});
	const providerGraphFacts = graphFacts.filter(
		(fact) =>
			fact.request.effectKind === "provider-request" &&
			fact.result.effectKind === "provider-request" &&
			fact.result.failureProvenance !== "executor-failure",
	);
	if (taskExposureFacts.length !== providerGraphFacts.length)
		throw new TypeError("D781 task exposure/provider result coverage drifted");
	const taskKeys = taskExposureFacts.map(
		(fact) => `${fact.requestDigest}:${fact.admissionDigest}:${fact.resultFactDigest}`,
	);
	if (new Set(taskKeys).size !== taskKeys.length)
		throw new TypeError("D781 task exposure fact replayed");
	const toolRejectionFacts = validateD781ToolRejectionFacts(toolValue, graphEvidence);
	return Object.freeze({
		taskExposureFacts: Object.freeze(taskExposureFacts),
		toolRejectionFacts: Object.freeze(toolRejectionFacts),
	});
}

export function validateD781ToolRejectionFactsForTest(input: {
	readonly toolRejectionFacts: unknown;
	readonly graphEvidence: D771CanonicalGraphEvidenceV1;
}): void {
	validateD781ToolRejectionFacts(input.toolRejectionFacts, input.graphEvidence);
}

export function validateD781TaskToolFactsForTest(input: {
	readonly taskExposureFacts: unknown;
	readonly toolRejectionFacts: unknown;
	readonly graphEvidence: D771CanonicalGraphEvidenceV1;
	readonly routeEvidence: D776RouteEvidenceV1;
}): void {
	validateD781TaskToolFacts(
		input.taskExposureFacts,
		input.toolRejectionFacts,
		input.graphEvidence,
		input.routeEvidence,
	);
}

export function validateD781LiveBundle(value: unknown): D781LiveBundleV1 {
	const candidate = record(value, "d781.bundle");
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
		"d781.bundle",
	);
	literal(candidate.schemaVersion, D781_BUNDLE_SCHEMA, "d781.bundle.schema");
	const graphCandidate = record(candidate.graphEvidence, "d781.bundle.graphEvidence");
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
		"d781.bundle.graphEvidence.canonicalReplay",
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
		D781_EFFECT_CEILINGS,
		graphEvidence.ledger.effectReconciliations,
	);
	const { taskExposureFacts, toolRejectionFacts } = validateD781TaskToolFacts(
		candidate.taskExposureFacts,
		candidate.toolRejectionFacts,
		graphEvidence,
		routeEvidence,
	);
	const qualification = record(candidate.qualification, "d781.bundle.qualification");
	exactKeys(
		qualification,
		[
			"baselineImplementationManifestDigest",
			"claimDigest",
			"coordinatesDigest",
			"currentKeyAdmissionDigest",
			"d780ForensicArtifactSha256",
			"d780ForensicDigest",
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
		"d781.bundle.qualification",
	);
	const { qualificationDigest: qualificationDigestValue, ...qualificationMaterial } = qualification;
	const qualificationDigest = digest(qualificationDigestValue, "d781.bundle.qualification.digest");
	literal(
		qualificationDigest,
		empiricalStrictJsonDigest(qualificationMaterial),
		"d781.bundle.qualification.digest",
	);
	literal(qualification.decisionRef, D781_DECISION_REF, "d781.bundle.qualification.decision");
	literal(
		qualification.decisionRevision,
		D781_DECISION_REVISION,
		"d781.bundle.qualification.revision",
	);
	literal(
		qualification.coordinatesDigest,
		D781_COORDINATES_DIGEST,
		"d781.bundle.qualification.coordinates",
	);
	literal(
		qualification.historicalArtifactSha256,
		D781_HISTORICAL_ARTIFACT_SHA256,
		"d781.bundle.qualification.historicalArtifact",
	);
	literal(
		qualification.historicalBundleDigest,
		D781_HISTORICAL_BUNDLE_DIGEST,
		"d781.bundle.qualification.historicalBundle",
	);
	literal(
		qualification.historicalImplementationManifestDigest,
		D781_HISTORICAL_IMPLEMENTATION_MANIFEST_DIGEST,
		"d781.bundle.qualification.historicalImplementation",
	);
	literal(
		qualification.d780ForensicArtifactSha256,
		D781_D780_FORENSIC_ARTIFACT_SHA256,
		"d781.bundle.qualification.d780ForensicArtifact",
	);
	literal(
		qualification.d780ForensicDigest,
		D781_D780_FORENSIC_DIGEST,
		"d781.bundle.qualification.d780ForensicDigest",
	);
	literal(
		qualification.baselineImplementationManifestDigest,
		D781_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
		"d781.bundle.qualification.baselineImplementation",
	);
	literal(
		qualification.implementationManifestDigest,
		D781_IMPLEMENTATION_MANIFEST_DIGEST,
		"d781.bundle.qualification.implementation",
	);
	digest(qualification.pricingReadDigest, "d781.bundle.qualification.pricingRead");
	digest(qualification.pricingObservationDigest, "d781.bundle.qualification.pricingObservation");
	digest(qualification.zeroByokObservationDigest, "d781.bundle.qualification.zeroByokObservation");
	digest(qualification.claimDigest, "d781.bundle.qualification.claim");
	digest(qualification.currentKeyAdmissionDigest, "d781.bundle.qualification.currentKeyAdmission");
	const expectedSourceDigest = empiricalStrictJsonDigest({
		decisionRef: D781_DECISION_REF,
		coordinatesDigest: D781_COORDINATES_DIGEST,
		claimDigest: digest(qualification.claimDigest, "d781.bundle.qualification.claimDigest"),
	});
	const gate = evaluateD775ArmAwarePositiveGate(
		graphEvidence,
		routeEvidence as never,
		expectedSourceDigest,
	);
	const observation = record(candidate.observation, "d781.bundle.observation");
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
		"d781.bundle.observation",
	);
	literal(
		empiricalStrictJsonDigest(observation.gate),
		empiricalStrictJsonDigest(gate),
		"d781.bundle.observation.gate",
	);
	const derivedDisposition =
		graphEvidence.runStatus === "complete" &&
		graphEvidence.ledger.completedArms.length === 6 &&
		routeEvidence.coverageComplete &&
		!hasOperationalFailure(graphEvidence)
			? "success"
			: "partial-failure";
	literal(candidate.disposition, derivedDisposition, "d781.bundle.disposition");
	literal(observation.disposition, derivedDisposition, "d781.bundle.observation.disposition");
	literal(
		observation.graphEvidenceDigest,
		graphEvidence.evidenceDigest,
		"d781.bundle.observation.graph",
	);
	literal(
		observation.routeEvidenceDigest,
		routeEvidence.evidenceDigest,
		"d781.bundle.observation.route",
	);
	literal(
		observation.completedArms,
		graphEvidence.ledger.completedArms.length,
		"d781.bundle.observation.arms",
	);
	literal(observation.causalAttribution, "undetermined", "d781.bundle.observation.attribution");
	literal(
		observation.efficacyClaim,
		gate.passed ? "positive-differential-frozen-task-block" : "none",
		"d781.bundle.observation.efficacy",
	);
	const { observationDigest: observationDigestValue, ...observationMaterial } = observation;
	const observationDigest = digest(observationDigestValue, "d781.bundle.observation.digest");
	literal(
		observationDigest,
		empiricalStrictJsonDigest(observationMaterial),
		"d781.bundle.observation.digest",
	);
	const generation = record(candidate.generation, "d781.bundle.generation");
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
		"d781.bundle.generation",
	);
	const { generationDigest, ...generationMaterial } = generation;
	literal(
		generationDigest,
		empiricalStrictJsonDigest(generationMaterial),
		"d781.bundle.generation.digest",
	);
	literal(generation.generationRef, D781_GENERATION_REF, "d781.bundle.generation.ref");
	literal(generation.disposition, derivedDisposition, "d781.bundle.generation.disposition");
	literal(
		generation.qualificationDigest,
		qualificationDigest,
		"d781.bundle.generation.qualification",
	);
	literal(generation.observationDigest, observationDigest, "d781.bundle.generation.observation");
	literal(
		generation.graphEvidenceDigest,
		graphEvidence.evidenceDigest,
		"d781.bundle.generation.graph",
	);
	literal(
		generation.routeEvidenceDigest,
		routeEvidence.evidenceDigest,
		"d781.bundle.generation.route",
	);
	const terminalReceipt = record(candidate.terminalReceipt, "d781.bundle.terminalReceipt");
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
		"d781.bundle.terminalReceipt",
	);
	const { terminalReceiptDigest, ...terminalMaterial } = terminalReceipt;
	literal(
		terminalReceiptDigest,
		empiricalStrictJsonDigest(terminalMaterial),
		"d781.bundle.terminalReceipt.digest",
	);
	literal(
		terminalReceipt.disposition,
		derivedDisposition,
		"d781.bundle.terminalReceipt.disposition",
	);
	literal(
		terminalReceipt.claimDigest,
		digest(qualification.claimDigest, "d781.bundle.qualification.claim"),
		"d781.bundle.terminalReceipt.claim",
	);
	literal(
		terminalReceipt.currentKeyAdmissionDigest,
		digest(qualification.currentKeyAdmissionDigest, "d781.bundle.qualification.currentKey"),
		"d781.bundle.terminalReceipt.currentKey",
	);
	literal(
		terminalReceipt.bundleOutcome,
		derivedDisposition === "success" ? "success-generation" : "partial-graph-evidence",
		"d781.bundle.terminalReceipt.outcome",
	);
	const bundleDigest = digest(candidate.bundleDigest, "d781.bundle.digest");
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
	literal(bundleDigest, empiricalStrictJsonDigest(material), "d781.bundle.digest");
	return strictSnapshot({ ...material, bundleDigest }) as D781LiveBundleV1;
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
			throw new TypeError("D781 private artifact identity is invalid");
	} finally {
		await handle.close();
	}
}

export async function persistD781LiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D781LiveBundleV1;
}) {
	const input = record(inputValue, "d781.persist.input");
	exactKeys(input, ["bundle", "privateRoot"], "d781.persist.input");
	const bundle = input.bundle as D781LiveBundleV1;
	if (!constructed.delete(bundle))
		throw new TypeError("D781 persistence requires fresh constructed bundle");
	validateD781LiveBundle(bundle);
	const privateRoot = resolve(input.privateRoot as string);
	if ((await realpath(privateRoot)) !== privateRoot)
		throw new TypeError("D781 private root is not canonical");
	const rootStat = await lstat(privateRoot);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o777) !== 0o700)
		throw new TypeError("D781 private root ownership is invalid");
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
		throw new TypeError("D781 private root changed before stable-handle acquisition");
	}
	const staging = join(privateRoot, `.d781-${randomUUID()}.tmp`);
	const finalRoot = join(privateRoot, D781_GENERATION_REF);
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
			throw new TypeError("D781 final claim changed before stable-handle acquisition");
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
			throw new TypeError("D781 committed artifacts identity drifted");
		stagingIdentity = null;
		const markerMaterial = strictSnapshot({
			generationRef: D781_GENERATION_REF,
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
					throw new TypeError("D781 published artifact readback drifted");
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
				throw new TypeError("D781 commit marker readback drifted");
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
			throw new TypeError("D781 final generation identity drifted");
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
				"D781 stable persistence handle close failed",
			);
		const receipt = strictSnapshot({
			schemaVersion: D781_PERSISTENCE_SCHEMA,
			generationRef: D781_GENERATION_REF,
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
				const tombstone = join(privateRoot, `.d781-cleanup-${randomUUID()}.tmp`);
				await rename(finalRoot, tombstone).catch((cleanupError) =>
					cleanupErrors.push(cleanupError),
				);
				const moved = await lstat(tombstone).catch(() => null);
				if (moved !== null && moved.dev === finalIdentity.dev && moved.ino === finalIdentity.ino)
					await rm(tombstone, { recursive: true, force: true }).catch((cleanupError) =>
						cleanupErrors.push(cleanupError),
					);
				else if (moved !== null)
					cleanupErrors.push(new TypeError("D781 cleanup tombstone identity drifted"));
			}
		}
		await parentHandle.close().catch(() => undefined);
		if (cleanupErrors.length > 0)
			throw new AggregateError([error, ...cleanupErrors], "D781 persistence and cleanup failed");
		throw error;
	}
}
