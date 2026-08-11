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
	D729_BUDGET_LIMITS,
	D729_COORDINATES_DIGEST,
	D729_DECISION_REF,
	D729_DECISION_REVISION,
	D729_EFFECT_CEILINGS,
	D729_GENERATION_REF,
	D729_MODEL_SLUG,
} from "./d729-coordinates.js";
import {
	consumeD729PrivateImplementationAttestation,
	D729_IMPLEMENTATION_MANIFEST_DIGEST,
	type D729PrivateImplementationAttestationV1,
} from "./d729-implementation-manifest.js";
import {
	type D726ProviderAdapterV1,
	runD726GraphProviderBlockCore,
	validateD726TerminalProviderCoverage,
} from "./d729-provider-block-core.js";
import {
	consumeD729ExecutionAuthority,
	type D729ExecutionAuthorityV1,
} from "./d729-single-use-dispatch-claim.js";

export const D729_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d729.failure-safe-live-qualification.v1" as const;
export const D729_BUNDLE_SCHEMA = "graphrefly.b112.d729.failure-safe-live-bundle.v1" as const;
export const D729_OBSERVATION_SCHEMA =
	"graphrefly.b112.d729.failure-safe-live-observation.v1" as const;
export const D729_GENERATION_SCHEMA =
	"graphrefly.b112.d729.failure-safe-success-generation.v1" as const;
export const D729_PARTIAL_FAILURE_SCHEMA =
	"graphrefly.b112.d729.partial-graph-failure-generation.v1" as const;
export const D729_TERMINAL_RECEIPT_SCHEMA =
	"graphrefly.b112.d729.atomic-terminal-receipt.v1" as const;

export interface D729LiveAdapterBindingV1 {
	readonly revision: "graphrefly.b112.d729.live-adapter-binding.v1";
}

export interface D729LiveBundleV1 {
	readonly schemaVersion: typeof D729_BUNDLE_SCHEMA;
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

export function createD729LiveAdapterBinding(inputValue: {
	readonly adapter: D726ProviderAdapterV1;
	readonly privateImplementationAttestation: D729PrivateImplementationAttestationV1;
	readonly implementationManifestDigest: string;
	readonly coordinatesDigest: string;
}): D729LiveAdapterBindingV1 {
	const input = record(inputValue, "d729.adapterBinding");
	exactKeys(
		input,
		[
			"adapter",
			"coordinatesDigest",
			"implementationManifestDigest",
			"privateImplementationAttestation",
		],
		"d729.adapterBinding",
	);
	literal(
		digest(input.implementationManifestDigest, "d729.adapterBinding.implementation"),
		D729_IMPLEMENTATION_MANIFEST_DIGEST,
		"d729.adapterBinding.implementation",
	);
	literal(
		digest(input.coordinatesDigest, "d729.adapterBinding.coordinates"),
		D729_COORDINATES_DIGEST,
		"d729.adapterBinding.coordinates",
	);
	consumeD729PrivateImplementationAttestation(input.privateImplementationAttestation);
	const binding = Object.freeze({
		revision: "graphrefly.b112.d729.live-adapter-binding.v1" as const,
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
				"d729.executorFailure.classification",
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
	if (facts.length > 256) throw new TypeError("D729 executor failure fact bound exceeded");
	return Object.freeze(facts);
}

function cleanupFacts(graphEvidence: D722CanonicalGraphEvidenceV1) {
	return Object.freeze(
		graphEvidence.effectRuns.map((run) => {
			const cleanups = run.facts.filter(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" && fact.result.effectKind === "cleanup",
			);
			if (cleanups.length !== 1) throw new TypeError("D729 requires one cleanup fact per arm");
			const cleanup = cleanups[0]!;
			if (cleanup.kind !== "graph-effect-result-admitted")
				throw new TypeError("D729 cleanup fact drifted");
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
	const candidate = record(value, "d729.graphEvidence");
	const runs = array(candidate.effectRuns, "d729.graphEvidence.effectRuns");
	if (runs.length > 12) throw new TypeError("D729 graph run bound exceeded");
	const replay = deriveD722CanonicalGraphEvidence(
		candidate.ledger,
		runs as D722CanonicalGraphEvidenceV1["effectRuns"],
		createD726ArmLocalTerminalProviderPolicy(),
	);
	literal(
		empiricalStrictJsonDigest(replay),
		empiricalStrictJsonDigest(candidate),
		"d729.graph.replay",
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
		budgetLimits: D729_BUDGET_LIMITS,
		effectCeilings: D729_EFFECT_CEILINGS,
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
): D729LiveBundleV1 {
	const usage = run.usage;
	literal(
		usage.requests,
		safeInteger(input.providerTransportCalls, "d729.providerTransportCalls", { max: 96 }),
		"d729.providerTransportCalls",
	);
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D729_QUALIFICATION_SCHEMA,
		decisionRef: D729_DECISION_REF,
		decisionRevision: D729_DECISION_REVISION,
		executionClass: input.executionClass,
		coordinatesDigest: D729_COORDINATES_DIGEST,
		implementationManifestDigest: D729_IMPLEMENTATION_MANIFEST_DIGEST,
		graphEvidenceDigest: run.graphEvidence.evidenceDigest,
		terminalHttpGraphEvidenceDigest: run.terminalHttpGraphEvidence.evidenceDigest,
		executorFailureFactDigest: empiricalStrictJsonDigest(run.executorFailureFacts),
		cleanupFactDigest: empiricalStrictJsonDigest(run.cleanupFacts),
		pricingReadDigest: digest(input.pricingReadDigest, "d729.pricingRead"),
		pricingObservationDigest: digest(input.pricingObservationDigest, "d729.pricingObservation"),
		zeroByokObservationDigest: digest(input.zeroByokObservationDigest, "d729.zeroByok"),
		currentKeyAdmissionDigest: digest(input.currentKeyAdmissionDigest, "d729.currentKey"),
		claimDigest: digest(input.claimDigest, "d729.claim"),
		providerTransportCalls: input.providerTransportCalls,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = strictSnapshot({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const observationMaterial = strictSnapshot({
		schemaVersion: D729_OBSERVATION_SCHEMA,
		disposition: run.disposition,
		model: D729_MODEL_SLUG,
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
			run.disposition === "success" ? D729_GENERATION_SCHEMA : D729_PARTIAL_FAILURE_SCHEMA,
		generationRef: D729_GENERATION_REF,
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
		schemaVersion: D729_TERMINAL_RECEIPT_SCHEMA,
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
		schemaVersion: D729_BUNDLE_SCHEMA,
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
	return bundle as unknown as D729LiveBundleV1;
}

export async function runD729InjectedNoNetworkQualification(input: {
	readonly adapter: D726ProviderAdapterV1;
	readonly providerTransportCalls: () => number;
	readonly signal: AbortSignal;
}): Promise<D729LiveBundleV1> {
	const run = await execute(
		input.adapter,
		"injected-no-network",
		empiricalStrictJsonDigest({ decisionRef: D729_DECISION_REF, executionClass: "injected" }),
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

export async function runD729LiveReplacement(input: {
	readonly sourceDigest: string;
	readonly adapterBinding: D729LiveAdapterBindingV1;
	readonly executionAuthority: D729ExecutionAuthorityV1;
	readonly pricingReadDigest: string;
	readonly pricingObservationDigest: string;
	readonly providerTransportCalls: () => number;
	readonly signal: AbortSignal;
}): Promise<D729LiveBundleV1> {
	const adapter = adapterBindings.get(input.adapterBinding);
	if (adapter === undefined)
		throw new TypeError("D729 live adapter binding is invalid or consumed");
	adapterBindings.delete(input.adapterBinding);
	const authority = consumeD729ExecutionAuthority(input.executionAuthority);
	if (authority.scope !== "live-fixed-root")
		throw new TypeError("D729 live execution requires the fixed-root claim");
	literal(authority.claim.pricingReadDigest, input.pricingReadDigest, "d729.live.pricing");
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

export function validateD729LiveBundle(value: unknown): D729LiveBundleV1 {
	const candidate = record(value, "d729.bundle");
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
		"d729.bundle",
	);
	literal(candidate.schemaVersion, D729_BUNDLE_SCHEMA, "d729.bundle.schema");
	const disposition = oneOf(
		candidate.disposition,
		["success", "partial-failure"],
		"d729.disposition",
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
		"d729.executorFailures",
	);
	const expectedPartial =
		graphEvidence.runStatus !== "complete" ||
		graphEvidence.ledger.completedArms.length !== 6 ||
		terminalHttpGraphEvidence.facts.length > 0 ||
		expectedExecutorFailures.length > 0 ||
		cleanupFacts(graphEvidence).some((fact) => fact.status !== "succeeded");
	literal(disposition, expectedPartial ? "partial-failure" : "success", "d729.disposition");
	const qualification = record(candidate.qualification, "d729.qualification");
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
		"d729.qualification",
	);
	const { qualificationDigest, ...qualificationBody } = qualification;
	const qualificationDigestValue = digest(qualificationDigest, "d729.qualification.digest");
	literal(qualification.schemaVersion, D729_QUALIFICATION_SCHEMA, "d729.qualification.schema");
	literal(qualification.decisionRef, D729_DECISION_REF, "d729.qualification.decision");
	literal(qualification.decisionRevision, D729_DECISION_REVISION, "d729.qualification.revision");
	literal(
		qualification.coordinatesDigest,
		D729_COORDINATES_DIGEST,
		"d729.qualification.coordinates",
	);
	literal(
		qualification.implementationManifestDigest,
		D729_IMPLEMENTATION_MANIFEST_DIGEST,
		"d729.qualification.implementation",
	);
	literal(
		qualification.graphEvidenceDigest,
		graphEvidence.evidenceDigest,
		"d729.qualification.graph",
	);
	literal(
		qualification.terminalHttpGraphEvidenceDigest,
		terminalHttpGraphEvidence.evidenceDigest,
		"d729.qualification.http",
	);
	literal(
		qualification.executorFailureFactDigest,
		empiricalStrictJsonDigest(expectedExecutorFailures),
		"d729.qualification.executorFailures",
	);
	literal(
		qualificationDigestValue,
		empiricalStrictJsonDigest(qualificationBody),
		"d729.qualification.digest",
	);
	const observation = record(candidate.observation, "d729.observation");
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
		"d729.observation",
	);
	literal(observation.schemaVersion, D729_OBSERVATION_SCHEMA, "d729.observation.schema");
	literal(observation.disposition, disposition, "d729.observation.disposition");
	literal(
		observation.qualificationDigest,
		qualificationDigestValue,
		"d729.observation.qualification",
	);
	literal(observation.graphEvidenceDigest, graphEvidence.evidenceDigest, "d729.observation.graph");
	literal(
		observation.terminalHttpGraphEvidenceDigest,
		terminalHttpGraphEvidence.evidenceDigest,
		"d729.observation.http",
	);
	const observationDigest = digest(observation.observationDigest, "d729.observation.digest");
	const { observationDigest: _observationDigest, ...observationBody } = observation;
	literal(observationDigest, empiricalStrictJsonDigest(observationBody), "d729.observation.digest");
	const generation = record(candidate.generation, "d729.generation");
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
		"d729.generation",
	);
	literal(
		generation.schemaVersion,
		disposition === "success" ? D729_GENERATION_SCHEMA : D729_PARTIAL_FAILURE_SCHEMA,
		"d729.generation.schema",
	);
	literal(generation.disposition, disposition, "d729.generation.disposition");
	literal(
		generation.qualificationDigest,
		qualificationDigestValue,
		"d729.generation.qualification",
	);
	literal(generation.observationDigest, observationDigest, "d729.generation.observation");
	literal(generation.graphEvidenceDigest, graphEvidence.evidenceDigest, "d729.generation.graph");
	const generationDigest = digest(generation.generationDigest, "d729.generation.digest");
	const { generationDigest: _generationDigest, ...generationBody } = generation;
	literal(generationDigest, empiricalStrictJsonDigest(generationBody), "d729.generation.digest");
	const terminalReceipt = record(candidate.terminalReceipt, "d729.terminalReceipt");
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
		"d729.terminalReceipt",
	);
	literal(terminalReceipt.schemaVersion, D729_TERMINAL_RECEIPT_SCHEMA, "d729.terminal.schema");
	literal(terminalReceipt.status, disposition, "d729.terminal.status");
	literal(terminalReceipt.graphEvidenceDigest, graphEvidence.evidenceDigest, "d729.terminal.graph");
	literal(
		terminalReceipt.terminalHttpGraphEvidenceDigest,
		terminalHttpGraphEvidence.evidenceDigest,
		"d729.terminal.http",
	);
	const terminalReceiptDigest = digest(
		terminalReceipt.terminalReceiptDigest,
		"d729.terminal.digest",
	);
	const { terminalReceiptDigest: _terminalReceiptDigest, ...terminalBody } = terminalReceipt;
	literal(terminalReceiptDigest, empiricalStrictJsonDigest(terminalBody), "d729.terminal.digest");
	const material = strictSnapshot({
		schemaVersion: D729_BUNDLE_SCHEMA,
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
		digest(candidate.bundleDigest, "d729.bundle.digest"),
		empiricalStrictJsonDigest(material),
		"d729.bundle.digest",
	);
	return strictSnapshot({
		...material,
		bundleDigest: candidate.bundleDigest,
	}) as unknown as D729LiveBundleV1;
}

export function consumeConstructedD729LiveBundle(value: unknown): D729LiveBundleV1 {
	if (typeof value !== "object" || value === null || !constructedBundles.delete(value))
		throw new TypeError("D729 persistence requires the exact constructed bundle");
	return validateD729LiveBundle(value);
}
