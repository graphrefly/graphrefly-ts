import {
	array,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	type D722CanonicalGraphEvidenceV1,
	deriveD722CanonicalGraphEvidence,
} from "./d722-graph-completion-memory-insight.js";
import { createD726ArmLocalTerminalProviderPolicy } from "./d722-graph-native-effect-runtime.js";
import type { D724TerminalHttpGraphEvidenceV1 } from "./d724-terminal-http-evidence.js";
import { validateD724TerminalHttpGraphEvidence } from "./d724-terminal-http-evidence.js";
import {
	D728_BUDGET_LIMITS,
	D728_COORDINATES_DIGEST,
	D728_DECISION_REF,
	D728_DECISION_REVISION,
	D728_EFFECT_CEILINGS,
	D728_GENERATION_REF,
} from "./d728-coordinates.js";
import {
	consumeD728PrivateImplementationAttestation,
	D728_IMPLEMENTATION_MANIFEST_DIGEST,
	type D728PrivateImplementationAttestationV1,
} from "./d728-implementation-manifest.js";
import {
	type D726ProviderAdapterV1,
	runD726GraphProviderBlockCore,
	validateD726TerminalProviderCoverage,
} from "./d728-provider-block-core.js";
import {
	consumeD728ExecutionAuthority,
	type D728ExecutionAuthorityV1,
} from "./d728-single-use-dispatch-claim.js";

export const D728_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d728.failure-safe-live-qualification.v1" as const;
export const D728_BUNDLE_SCHEMA = "graphrefly.b112.d728.failure-safe-live-bundle.v1" as const;
export const D728_OBSERVATION_SCHEMA =
	"graphrefly.b112.d728.failure-safe-live-observation.v1" as const;
export const D728_GENERATION_SCHEMA =
	"graphrefly.b112.d728.failure-safe-success-generation.v1" as const;
export const D728_PARTIAL_FAILURE_SCHEMA =
	"graphrefly.b112.d728.partial-graph-failure-generation.v1" as const;
export const D728_TERMINAL_RECEIPT_SCHEMA =
	"graphrefly.b112.d728.atomic-terminal-receipt.v1" as const;

export interface D728LiveAdapterBindingV1 {
	readonly revision: "graphrefly.b112.d728.live-adapter-binding.v1";
}

export interface D728LiveBundleV1 {
	readonly schemaVersion: typeof D728_BUNDLE_SCHEMA;
	readonly disposition: "success" | "partial-failure";
	readonly qualification: Readonly<Record<string, unknown>>;
	readonly graphEvidence: D722CanonicalGraphEvidenceV1;
	readonly terminalHttpGraphEvidence: D724TerminalHttpGraphEvidenceV1;
	readonly executorFailureFacts: readonly Readonly<Record<string, unknown>>[];
	readonly observation: Readonly<Record<string, unknown>>;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly terminalReceipt: Readonly<Record<string, unknown>>;
	readonly bundleDigest: string;
}

const adapterBindings = new WeakMap<object, D726ProviderAdapterV1>();
const constructedBundles = new WeakSet<object>();

export function createD728LiveAdapterBinding(inputValue: {
	readonly adapter: D726ProviderAdapterV1;
	readonly privateImplementationAttestation: D728PrivateImplementationAttestationV1;
	readonly implementationManifestDigest: string;
	readonly coordinatesDigest: string;
}): D728LiveAdapterBindingV1 {
	const input = record(inputValue, "d728.adapterBinding");
	exactKeys(
		input,
		[
			"adapter",
			"coordinatesDigest",
			"implementationManifestDigest",
			"privateImplementationAttestation",
		],
		"d728.adapterBinding",
	);
	literal(
		digest(input.implementationManifestDigest, "d728.adapterBinding.implementation"),
		D728_IMPLEMENTATION_MANIFEST_DIGEST,
		"d728.adapterBinding.implementation",
	);
	literal(
		digest(input.coordinatesDigest, "d728.adapterBinding.coordinates"),
		D728_COORDINATES_DIGEST,
		"d728.adapterBinding.coordinates",
	);
	consumeD728PrivateImplementationAttestation(input.privateImplementationAttestation);
	const binding = Object.freeze({
		revision: "graphrefly.b112.d728.live-adapter-binding.v1" as const,
	});
	adapterBindings.set(binding, input.adapter as D726ProviderAdapterV1);
	return binding;
}

function executorFailureFacts(graphEvidence: D722CanonicalGraphEvidenceV1) {
	const facts = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) => {
			if (
				fact.kind !== "graph-effect-result-admitted" ||
				fact.result.effectKind !== "provider-request" ||
				fact.result.status !== "terminal-failure" ||
				fact.result.failureProvenance !== "executor-failure"
			)
				return [];
			const classification = oneOf(
				fact.result.executorFailureClassification,
				[
					"graph-admission-denied",
					"executor-threw",
					"invalid-executor-result",
					"transport-failure",
					"route-evidence-failure",
					"response-decode-failure",
				],
				"d728.executorFailure.classification",
			);
			const material = strictSnapshot({
				runSequence: run.runSequence,
				effectSequence: fact.request.effectSequence,
				effectRequestDigest: fact.request.requestDigest,
				effectAdmissionDigest: fact.admissionDigest,
				providerResultDigest: fact.resultDigest,
				classification,
			});
			return [strictSnapshot({ ...material, factDigest: empiricalStrictJsonDigest(material) })];
		}),
	);
	if (facts.length > 256) throw new TypeError("D728 executor failure fact bound exceeded");
	return Object.freeze(facts);
}

function cleanupFacts(graphEvidence: D722CanonicalGraphEvidenceV1) {
	return Object.freeze(
		graphEvidence.effectRuns.map((run) => {
			const cleanups = run.facts.filter(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" && fact.result.effectKind === "cleanup",
			);
			if (cleanups.length !== 1) throw new TypeError("D728 requires one cleanup fact per arm");
			const cleanup = cleanups[0]!;
			if (cleanup.kind !== "graph-effect-result-admitted")
				throw new TypeError("D728 cleanup fact drifted");
			return strictSnapshot({
				runSequence: run.runSequence,
				status: cleanup.result.status,
				requestDigest: cleanup.request.requestDigest,
				admissionDigest: cleanup.admissionDigest,
				resultDigest: cleanup.resultDigest,
			});
		}),
	);
}

function replayGraph(value: unknown) {
	const candidate = record(value, "d728.graphEvidence");
	const runs = array(candidate.effectRuns, "d728.graphEvidence.effectRuns");
	if (runs.length > 12) throw new TypeError("D728 graph run bound exceeded");
	const replay = deriveD722CanonicalGraphEvidence(
		candidate.ledger,
		runs as D722CanonicalGraphEvidenceV1["effectRuns"],
		createD726ArmLocalTerminalProviderPolicy(),
	);
	literal(
		empiricalStrictJsonDigest(replay),
		empiricalStrictJsonDigest(candidate),
		"d728.graph.replay",
	);
	return replay;
}

async function execute(
	adapter: D726ProviderAdapterV1,
	executionClass: "injected-no-network" | "live-provider",
	sourceDigest: string,
	signal: AbortSignal,
) {
	const run = await runD726GraphProviderBlockCore({
		sourceDigest,
		budgetLimits: D728_BUDGET_LIMITS,
		effectCeilings: D728_EFFECT_CEILINGS,
		adapter,
		executionClass,
		signal,
	});
	const graphEvidence = replayGraph(run.graphEvidence);
	const terminalHttpGraphEvidence = validateD724TerminalHttpGraphEvidence(
		run.terminalHttpGraphEvidence,
	);
	validateD726TerminalProviderCoverage(graphEvidence, terminalHttpGraphEvidence);
	const failures = executorFailureFacts(graphEvidence);
	const cleanups = cleanupFacts(graphEvidence);
	const allCleanupSucceeded = cleanups.every((fact) => fact.status === "succeeded");
	const success =
		graphEvidence.runStatus === "complete" &&
		graphEvidence.ledger.completedArms.length === 6 &&
		terminalHttpGraphEvidence.facts.length === 0 &&
		failures.length === 0 &&
		allCleanupSucceeded;
	return Object.freeze({
		...run,
		graphEvidence,
		terminalHttpGraphEvidence,
		executorFailureFacts: failures,
		cleanupFacts: cleanups,
		disposition: success ? ("success" as const) : ("partial-failure" as const),
	});
}

function buildBundle(
	run: Awaited<ReturnType<typeof execute>>,
	input: {
		readonly executionClass: "injected-no-network" | "live-provider";
		readonly claimDigest: string;
		readonly pricingReadDigest: string;
		readonly pricingObservationDigest: string;
		readonly zeroByokObservationDigest: string;
		readonly currentKeyAdmissionDigest: string;
		readonly providerTransportCalls: number;
	},
): D728LiveBundleV1 {
	const usage = run.usage;
	literal(
		usage.requests,
		safeInteger(input.providerTransportCalls, "d728.providerTransportCalls", { max: 96 }),
		"d728.providerTransportCalls",
	);
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D728_QUALIFICATION_SCHEMA,
		decisionRef: D728_DECISION_REF,
		decisionRevision: D728_DECISION_REVISION,
		executionClass: input.executionClass,
		coordinatesDigest: D728_COORDINATES_DIGEST,
		implementationManifestDigest: D728_IMPLEMENTATION_MANIFEST_DIGEST,
		graphEvidenceDigest: run.graphEvidence.evidenceDigest,
		terminalHttpGraphEvidenceDigest: run.terminalHttpGraphEvidence.evidenceDigest,
		executorFailureFactDigest: empiricalStrictJsonDigest(run.executorFailureFacts),
		cleanupFactDigest: empiricalStrictJsonDigest(run.cleanupFacts),
		pricingReadDigest: digest(input.pricingReadDigest, "d728.pricingRead"),
		pricingObservationDigest: digest(input.pricingObservationDigest, "d728.pricingObservation"),
		zeroByokObservationDigest: digest(input.zeroByokObservationDigest, "d728.zeroByok"),
		currentKeyAdmissionDigest: digest(input.currentKeyAdmissionDigest, "d728.currentKey"),
		claimDigest: digest(input.claimDigest, "d728.claim"),
		providerTransportCalls: input.providerTransportCalls,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = strictSnapshot({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const observationMaterial = strictSnapshot({
		schemaVersion: D728_OBSERVATION_SCHEMA,
		disposition: run.disposition,
		model: "deepseek/deepseek-v4-flash-0731",
		provider: "DeepInfra",
		providerSlug: "deepinfra",
		quantization: "fp4",
		endpoint: "chat-completions",
		reasoningEffort: "high",
		qualificationDigest: qualification.qualificationDigest,
		graphEvidenceDigest: run.graphEvidence.evidenceDigest,
		terminalHttpGraphEvidenceDigest: run.terminalHttpGraphEvidence.evidenceDigest,
		graphRunStatus: run.graphEvidence.runStatus,
		completedArms: run.graphEvidence.ledger.completedArms,
		findings: run.graphEvidence.ledger.findings,
		usage,
		providerTransportCalls: input.providerTransportCalls,
		fallbackUsed: false,
		providerSwitchUsed: false,
		modelOrRouteSwitchUsed: false,
		parallelOrBackgroundCalls: false,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const observation = strictSnapshot({
		...observationMaterial,
		observationDigest: empiricalStrictJsonDigest(observationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion:
			run.disposition === "success" ? D728_GENERATION_SCHEMA : D728_PARTIAL_FAILURE_SCHEMA,
		generationRef: D728_GENERATION_REF,
		disposition: run.disposition,
		qualificationDigest: qualification.qualificationDigest,
		observationDigest: observation.observationDigest,
		graphEvidenceDigest: run.graphEvidence.evidenceDigest,
		terminalHttpGraphEvidenceDigest: run.terminalHttpGraphEvidence.evidenceDigest,
		executorFailureFactDigest: empiricalStrictJsonDigest(run.executorFailureFacts),
		cleanupFactDigest: empiricalStrictJsonDigest(run.cleanupFacts),
		claimDigest: input.claimDigest,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const terminalMaterial = strictSnapshot({
		schemaVersion: D728_TERMINAL_RECEIPT_SCHEMA,
		status: run.disposition,
		claimDigest: input.claimDigest,
		currentKeyAdmissionDigest: input.currentKeyAdmissionDigest,
		pricingReadDigest: input.pricingReadDigest,
		graphEvidenceDigest: run.graphEvidence.evidenceDigest,
		terminalHttpGraphEvidenceDigest: run.terminalHttpGraphEvidence.evidenceDigest,
		executorFailureFactDigest: empiricalStrictJsonDigest(run.executorFailureFacts),
		cleanupFactDigest: empiricalStrictJsonDigest(run.cleanupFacts),
		providerTransportCalls: input.providerTransportCalls,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const terminalReceipt = strictSnapshot({
		...terminalMaterial,
		terminalReceiptDigest: empiricalStrictJsonDigest(terminalMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D728_BUNDLE_SCHEMA,
		disposition: run.disposition,
		qualification,
		graphEvidence: run.graphEvidence,
		terminalHttpGraphEvidence: run.terminalHttpGraphEvidence,
		executorFailureFacts: run.executorFailureFacts,
		observation,
		generation,
		terminalReceipt,
	});
	const bundle = strictSnapshot({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
	constructedBundles.add(bundle);
	return bundle as unknown as D728LiveBundleV1;
}

export async function runD728InjectedNoNetworkQualification(input: {
	readonly adapter: D726ProviderAdapterV1;
	readonly providerTransportCalls: () => number;
	readonly signal: AbortSignal;
}): Promise<D728LiveBundleV1> {
	const run = await execute(
		input.adapter,
		"injected-no-network",
		empiricalStrictJsonDigest({ decisionRef: D728_DECISION_REF, executionClass: "injected" }),
		input.signal,
	);
	return buildBundle(run, {
		executionClass: "injected-no-network",
		claimDigest: empiricalStrictJsonDigest({ injected: "claim" }),
		pricingReadDigest: empiricalStrictJsonDigest({ injected: "pricing-read" }),
		pricingObservationDigest: empiricalStrictJsonDigest({ injected: "pricing-observation" }),
		zeroByokObservationDigest: empiricalStrictJsonDigest({ injected: "zero-byok" }),
		currentKeyAdmissionDigest: empiricalStrictJsonDigest({ injected: "current-key" }),
		providerTransportCalls: input.providerTransportCalls(),
	});
}

export async function runD728LiveReplacement(input: {
	readonly sourceDigest: string;
	readonly adapterBinding: D728LiveAdapterBindingV1;
	readonly executionAuthority: D728ExecutionAuthorityV1;
	readonly pricingReadDigest: string;
	readonly pricingObservationDigest: string;
	readonly providerTransportCalls: () => number;
	readonly signal: AbortSignal;
}): Promise<D728LiveBundleV1> {
	const adapter = adapterBindings.get(input.adapterBinding);
	if (adapter === undefined)
		throw new TypeError("D728 live adapter binding is invalid or consumed");
	adapterBindings.delete(input.adapterBinding);
	const authority = consumeD728ExecutionAuthority(input.executionAuthority);
	if (authority.scope !== "live-fixed-root")
		throw new TypeError("D728 live execution requires the fixed-root claim");
	literal(authority.claim.pricingReadDigest, input.pricingReadDigest, "d728.live.pricing");
	const run = await execute(adapter, "live-provider", input.sourceDigest, input.signal);
	return buildBundle(run, {
		executionClass: "live-provider",
		claimDigest: authority.claim.claimDigest,
		pricingReadDigest: input.pricingReadDigest,
		pricingObservationDigest: input.pricingObservationDigest,
		zeroByokObservationDigest: authority.claim.zeroByokObservationDigest,
		currentKeyAdmissionDigest: authority.currentKeyAdmission.admissionDigest,
		providerTransportCalls: input.providerTransportCalls(),
	});
}

export function validateD728LiveBundle(value: unknown): D728LiveBundleV1 {
	const candidate = record(value, "d728.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"disposition",
			"executorFailureFacts",
			"generation",
			"graphEvidence",
			"observation",
			"qualification",
			"schemaVersion",
			"terminalHttpGraphEvidence",
			"terminalReceipt",
		],
		"d728.bundle",
	);
	literal(candidate.schemaVersion, D728_BUNDLE_SCHEMA, "d728.bundle.schema");
	const disposition = oneOf(
		candidate.disposition,
		["success", "partial-failure"],
		"d728.disposition",
	);
	const graphEvidence = replayGraph(candidate.graphEvidence);
	const terminalHttpGraphEvidence = validateD724TerminalHttpGraphEvidence(
		candidate.terminalHttpGraphEvidence,
	);
	validateD726TerminalProviderCoverage(graphEvidence, terminalHttpGraphEvidence);
	const expectedExecutorFailures = executorFailureFacts(graphEvidence);
	literal(
		empiricalStrictJsonDigest(candidate.executorFailureFacts),
		empiricalStrictJsonDigest(expectedExecutorFailures),
		"d728.executorFailures",
	);
	const expectedPartial =
		graphEvidence.runStatus !== "complete" ||
		graphEvidence.ledger.completedArms.length !== 6 ||
		terminalHttpGraphEvidence.facts.length > 0 ||
		expectedExecutorFailures.length > 0 ||
		cleanupFacts(graphEvidence).some((fact) => fact.status !== "succeeded");
	literal(disposition, expectedPartial ? "partial-failure" : "success", "d728.disposition");
	const qualification = record(candidate.qualification, "d728.qualification");
	exactKeys(
		qualification,
		[
			"causalAttribution",
			"claimDigest",
			"cleanupFactDigest",
			"coordinatesDigest",
			"currentKeyAdmissionDigest",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"executionClass",
			"executorFailureFactDigest",
			"graphEvidenceDigest",
			"implementationManifestDigest",
			"pricingObservationDigest",
			"pricingReadDigest",
			"providerTransportCalls",
			"qualificationDigest",
			"schemaVersion",
			"terminalHttpGraphEvidenceDigest",
			"zeroByokObservationDigest",
		],
		"d728.qualification",
	);
	const { qualificationDigest, ...qualificationBody } = qualification;
	const qualificationDigestValue = digest(qualificationDigest, "d728.qualification.digest");
	literal(qualification.schemaVersion, D728_QUALIFICATION_SCHEMA, "d728.qualification.schema");
	literal(qualification.decisionRef, D728_DECISION_REF, "d728.qualification.decision");
	literal(qualification.decisionRevision, D728_DECISION_REVISION, "d728.qualification.revision");
	literal(
		qualification.coordinatesDigest,
		D728_COORDINATES_DIGEST,
		"d728.qualification.coordinates",
	);
	literal(
		qualification.implementationManifestDigest,
		D728_IMPLEMENTATION_MANIFEST_DIGEST,
		"d728.qualification.implementation",
	);
	literal(
		qualification.graphEvidenceDigest,
		graphEvidence.evidenceDigest,
		"d728.qualification.graph",
	);
	literal(
		qualification.terminalHttpGraphEvidenceDigest,
		terminalHttpGraphEvidence.evidenceDigest,
		"d728.qualification.http",
	);
	literal(
		qualification.executorFailureFactDigest,
		empiricalStrictJsonDigest(expectedExecutorFailures),
		"d728.qualification.executorFailures",
	);
	literal(
		qualificationDigestValue,
		empiricalStrictJsonDigest(qualificationBody),
		"d728.qualification.digest",
	);
	const observation = record(candidate.observation, "d728.observation");
	exactKeys(
		observation,
		[
			"causalAttribution",
			"completedArms",
			"disposition",
			"efficacyClaim",
			"endpoint",
			"fallbackUsed",
			"findings",
			"graphEvidenceDigest",
			"graphRunStatus",
			"model",
			"modelOrRouteSwitchUsed",
			"observationDigest",
			"parallelOrBackgroundCalls",
			"provider",
			"providerSlug",
			"providerSwitchUsed",
			"providerTransportCalls",
			"qualificationDigest",
			"quantization",
			"reasoningEffort",
			"schemaVersion",
			"terminalHttpGraphEvidenceDigest",
			"usage",
		],
		"d728.observation",
	);
	literal(observation.schemaVersion, D728_OBSERVATION_SCHEMA, "d728.observation.schema");
	literal(observation.disposition, disposition, "d728.observation.disposition");
	literal(
		observation.qualificationDigest,
		qualificationDigestValue,
		"d728.observation.qualification",
	);
	literal(observation.graphEvidenceDigest, graphEvidence.evidenceDigest, "d728.observation.graph");
	literal(
		observation.terminalHttpGraphEvidenceDigest,
		terminalHttpGraphEvidence.evidenceDigest,
		"d728.observation.http",
	);
	const observationDigest = digest(observation.observationDigest, "d728.observation.digest");
	const { observationDigest: _observationDigest, ...observationBody } = observation;
	literal(observationDigest, empiricalStrictJsonDigest(observationBody), "d728.observation.digest");
	const generation = record(candidate.generation, "d728.generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"claimDigest",
			"cleanupFactDigest",
			"disposition",
			"efficacyClaim",
			"executorFailureFactDigest",
			"generationDigest",
			"generationRef",
			"graphEvidenceDigest",
			"observationDigest",
			"qualificationDigest",
			"schemaVersion",
			"terminalHttpGraphEvidenceDigest",
		],
		"d728.generation",
	);
	literal(
		generation.schemaVersion,
		disposition === "success" ? D728_GENERATION_SCHEMA : D728_PARTIAL_FAILURE_SCHEMA,
		"d728.generation.schema",
	);
	literal(generation.disposition, disposition, "d728.generation.disposition");
	literal(
		generation.qualificationDigest,
		qualificationDigestValue,
		"d728.generation.qualification",
	);
	literal(generation.observationDigest, observationDigest, "d728.generation.observation");
	literal(generation.graphEvidenceDigest, graphEvidence.evidenceDigest, "d728.generation.graph");
	const generationDigest = digest(generation.generationDigest, "d728.generation.digest");
	const { generationDigest: _generationDigest, ...generationBody } = generation;
	literal(generationDigest, empiricalStrictJsonDigest(generationBody), "d728.generation.digest");
	const terminalReceipt = record(candidate.terminalReceipt, "d728.terminalReceipt");
	exactKeys(
		terminalReceipt,
		[
			"causalAttribution",
			"claimDigest",
			"cleanupFactDigest",
			"currentKeyAdmissionDigest",
			"efficacyClaim",
			"executorFailureFactDigest",
			"graphEvidenceDigest",
			"pricingReadDigest",
			"providerTransportCalls",
			"schemaVersion",
			"status",
			"terminalHttpGraphEvidenceDigest",
			"terminalReceiptDigest",
		],
		"d728.terminalReceipt",
	);
	literal(terminalReceipt.schemaVersion, D728_TERMINAL_RECEIPT_SCHEMA, "d728.terminal.schema");
	literal(terminalReceipt.status, disposition, "d728.terminal.status");
	literal(terminalReceipt.graphEvidenceDigest, graphEvidence.evidenceDigest, "d728.terminal.graph");
	literal(
		terminalReceipt.terminalHttpGraphEvidenceDigest,
		terminalHttpGraphEvidence.evidenceDigest,
		"d728.terminal.http",
	);
	const terminalReceiptDigest = digest(
		terminalReceipt.terminalReceiptDigest,
		"d728.terminal.digest",
	);
	const { terminalReceiptDigest: _terminalReceiptDigest, ...terminalBody } = terminalReceipt;
	literal(terminalReceiptDigest, empiricalStrictJsonDigest(terminalBody), "d728.terminal.digest");
	const material = strictSnapshot({
		schemaVersion: D728_BUNDLE_SCHEMA,
		disposition,
		qualification,
		graphEvidence,
		terminalHttpGraphEvidence,
		executorFailureFacts: expectedExecutorFailures,
		observation,
		generation,
		terminalReceipt,
	});
	literal(
		digest(candidate.bundleDigest, "d728.bundle.digest"),
		empiricalStrictJsonDigest(material),
		"d728.bundle.digest",
	);
	return strictSnapshot({
		...material,
		bundleDigest: candidate.bundleDigest,
	}) as unknown as D728LiveBundleV1;
}

export function consumeConstructedD728LiveBundle(value: unknown): D728LiveBundleV1 {
	if (typeof value !== "object" || value === null || !constructedBundles.delete(value))
		throw new TypeError("D728 persistence requires the exact constructed bundle");
	return validateD728LiveBundle(value);
}
