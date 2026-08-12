import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { StrictJsonValue } from "../../src/json/codec.js";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	oneOf,
	record,
	safeInteger,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	type D722CanonicalGraphEvidenceV1,
	deriveD722CanonicalGraphEvidence,
} from "./d722-graph-completion-memory-insight.js";
import {
	createD726ArmLocalTerminalProviderPolicy,
	createD748GraphForwardPhaseContinuationPolicy,
} from "./d722-graph-native-effect-runtime.js";
import { validateD724TerminalHttpGraphEvidence } from "./d724-terminal-http-evidence.js";
import {
	type D734RouteBoundProviderAdapterV1,
	runD734RouteProfileSixArmLiveIntegration,
	validateD734RouteGraphEvidence,
} from "./d734-route-profile-provider-integration.js";
import { validateD752Bundle } from "./d752-provider-transport-diagnostic-integration.js";
import {
	D753_COORDINATES_DIGEST,
	D753_DECISION_REF,
	D753_DECISION_REVISION,
	D753_GENERATION_REF,
	D753_HISTORICAL_ARTIFACT_SHA256,
	D753_HISTORICAL_BUNDLE_DIGEST,
	D753_HISTORICAL_GENERATION_DIGEST,
	D753_HISTORICAL_QUALIFICATION_DIGEST,
	D753_ROUTE_PROFILE,
	D753_ROUTE_PROFILE_DIGEST,
} from "./d753-coordinates.js";
import {
	consumeD753ExecutionAuthority,
	type D753ExecutionAuthorityV1,
} from "./d753-single-use-dispatch-claim.js";
import {
	type D753TransportDiagnosticGraphEvidenceV1,
	type D753TransportDiagnosticRouteAdapterV1,
	finalizeD753TransportDiagnostics,
	validateD753TransportDiagnosticGraphEvidence,
} from "./d753-transport-diagnostic-route-adapter.js";

export const D753_QUALIFICATION_SCHEMA = "graphrefly.b112.d753.live-qualification.v1" as const;
export const D753_OBSERVATION_SCHEMA = "graphrefly.b112.d753.live-observation.v1" as const;
export const D753_GENERATION_SCHEMA = "graphrefly.b112.d753.success-generation.v1" as const;
export const D753_PARTIAL_SCHEMA = "graphrefly.b112.d753.partial-failure-generation.v1" as const;
export const D753_TERMINAL_SCHEMA = "graphrefly.b112.d753.terminal-receipt.v1" as const;
export const D753_BUNDLE_SCHEMA = "graphrefly.b112.d753.live-bundle.v1" as const;

export interface D753LiveBundleV1 {
	readonly schemaVersion: typeof D753_BUNDLE_SCHEMA;
	readonly disposition: "success" | "partial-failure";
	readonly qualification: Readonly<Record<string, unknown>>;
	readonly graphEvidence: D722CanonicalGraphEvidenceV1;
	readonly terminalHttpGraphEvidence: Readonly<Record<string, unknown>>;
	readonly transportDiagnosticGraphEvidence: D753TransportDiagnosticGraphEvidenceV1;
	readonly routeEvidence: Readonly<Record<string, unknown>>;
	readonly executorFailureFacts: readonly Readonly<Record<string, unknown>>[];
	readonly cleanupFacts: readonly Readonly<Record<string, unknown>>[];
	readonly observation: Readonly<Record<string, unknown>>;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly terminalReceipt: Readonly<Record<string, unknown>>;
	readonly bundleDigest: string;
}

const constructedBundles = new WeakSet<object>();

function replayGraph(value: unknown): D722CanonicalGraphEvidenceV1 {
	const candidate = record(value, "d753.graphEvidence");
	const runs = array(candidate.effectRuns, "d753.graphEvidence.effectRuns");
	if (runs.length > 12) throw new TypeError("D753 Graph run bound exceeded");
	const replay = deriveD722CanonicalGraphEvidence(
		candidate.ledger,
		runs as D722CanonicalGraphEvidenceV1["effectRuns"],
		createD726ArmLocalTerminalProviderPolicy(),
		createD748GraphForwardPhaseContinuationPolicy(),
	);
	literal(
		empiricalStrictJsonDigest(replay),
		empiricalStrictJsonDigest(candidate),
		"d753.graph.replay",
	);
	return replay;
}

function executorFailureFacts(graph: D722CanonicalGraphEvidenceV1) {
	return Object.freeze(
		graph.effectRuns.flatMap((run) =>
			run.facts.flatMap((fact) => {
				if (
					fact.kind !== "graph-effect-result-admitted" ||
					fact.result.effectKind !== "provider-request" ||
					fact.result.failureProvenance !== "executor-failure"
				)
					return [];
				const material = strictSnapshot({
					runSequence: run.runSequence,
					effectSequence: fact.request.effectSequence,
					requestDigest: fact.request.requestDigest,
					admissionDigest: fact.admissionDigest,
					resultDigest: fact.resultDigest,
					classification: fact.result.executorFailureClassification,
				});
				return [strictSnapshot({ ...material, factDigest: empiricalStrictJsonDigest(material) })];
			}),
		),
	);
}

function cleanupFacts(graph: D722CanonicalGraphEvidenceV1) {
	return Object.freeze(
		graph.effectRuns.map((run) => {
			const facts = run.facts.filter(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" && fact.result.effectKind === "cleanup",
			);
			if (facts.length !== 1 || facts[0]?.kind !== "graph-effect-result-admitted")
				throw new TypeError("D753 requires one Graph cleanup fact per arm");
			const fact = facts[0];
			return strictSnapshot({
				runSequence: run.runSequence,
				status: fact.result.status,
				requestDigest: fact.request.requestDigest,
				admissionDigest: fact.admissionDigest,
				resultDigest: fact.resultDigest,
			});
		}),
	);
}

function validateHistoricalBundle(bytes: Uint8Array): void {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 16 * 1_048_576)
		throw new TypeError("D753 D752 qualification artifact bytes are invalid");
	literal(empiricalSha256(bytes), D753_HISTORICAL_ARTIFACT_SHA256, "d753.historical.artifact");
	const bundle = validateD752Bundle(strictJsonCodec.decode(new Uint8Array(bytes)));
	literal(bundle.bundleDigest, D753_HISTORICAL_BUNDLE_DIGEST, "d753.historical.bundle");
	literal(
		bundle.generation.generationDigest,
		D753_HISTORICAL_GENERATION_DIGEST,
		"d753.historical.generation",
	);
	literal(
		bundle.qualification.qualificationDigest,
		D753_HISTORICAL_QUALIFICATION_DIGEST,
		"d753.historical.qualification",
	);
}

function buildBundle(
	integration: Awaited<ReturnType<typeof runD734RouteProfileSixArmLiveIntegration>>,
	input: {
		readonly claimDigest: string;
		readonly currentKeyAdmissionDigest: string;
		readonly pricingReadDigest: string;
		readonly pricingObservationDigest: string;
		readonly zeroByokObservationDigest: string;
		readonly implementationManifestDigest: string;
		readonly providerTransportCalls: number;
		readonly transportDiagnosticGraphEvidence: D753TransportDiagnosticGraphEvidenceV1;
		readonly terminalDiagnosticProposalCount: number;
		readonly retryDiagnosticProposalCount: number;
	},
): D753LiveBundleV1 {
	const graphEvidence = replayGraph(integration.run.graphEvidence);
	const terminalHttpGraphEvidence = validateD724TerminalHttpGraphEvidence(
		integration.run.terminalHttpGraphEvidence,
	);
	const routeEvidence = validateD734RouteGraphEvidence(integration.routeEvidence);
	const transportDiagnosticGraphEvidence = validateD753TransportDiagnosticGraphEvidence(
		input.transportDiagnosticGraphEvidence,
		graphEvidence,
	);
	for (const fact of routeEvidence.facts)
		literal(fact.routeProfileDigest, D753_ROUTE_PROFILE_DIGEST, "d753.route.profile");
	const failures = executorFailureFacts(graphEvidence);
	const cleanups = cleanupFacts(graphEvidence);
	const providerTransportCalls = safeInteger(input.providerTransportCalls, "d753.providerCalls", {
		max: 96,
	});
	const graphProviderEffectCount = graphEvidence.ledger.effectProposals.filter(
		(proposal) => proposal.effectKind === "provider-request",
	).length;
	const routeFactCount = routeEvidence.facts.length;
	const providerAttemptEvidenceDisposition =
		providerTransportCalls === graphProviderEffectCount
			? ("exact" as const)
			: providerTransportCalls < graphProviderEffectCount
				? ("pre-transport-failure-observed" as const)
				: ("unexpected-extra-transport-observed" as const);
	const success =
		graphEvidence.runStatus === "complete" &&
		graphEvidence.ledger.completedArms.length === 6 &&
		terminalHttpGraphEvidence.facts.length === 0 &&
		failures.length === 0 &&
		providerAttemptEvidenceDisposition !== "unexpected-extra-transport-observed" &&
		cleanups.every((fact) => fact.status === "succeeded");
	const disposition = success ? ("success" as const) : ("partial-failure" as const);
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D753_QUALIFICATION_SCHEMA,
		decisionRef: D753_DECISION_REF,
		decisionRevision: D753_DECISION_REVISION,
		coordinatesDigest: D753_COORDINATES_DIGEST,
		historicalArtifactSha256: D753_HISTORICAL_ARTIFACT_SHA256,
		historicalBundleDigest: D753_HISTORICAL_BUNDLE_DIGEST,
		historicalGenerationDigest: D753_HISTORICAL_GENERATION_DIGEST,
		historicalQualificationDigest: D753_HISTORICAL_QUALIFICATION_DIGEST,
		implementationManifestDigest: digest(input.implementationManifestDigest, "d753.implementation"),
		routeProfileDigest: D753_ROUTE_PROFILE_DIGEST,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		terminalHttpGraphEvidenceDigest: terminalHttpGraphEvidence.evidenceDigest,
		routeEvidenceDigest: routeEvidence.evidenceDigest,
		transportDiagnosticGraphEvidenceDigest: transportDiagnosticGraphEvidence.evidenceDigest,
		claimDigest: digest(input.claimDigest, "d753.claim"),
		currentKeyAdmissionDigest: digest(input.currentKeyAdmissionDigest, "d753.currentKey"),
		pricingReadDigest: digest(input.pricingReadDigest, "d753.pricingRead"),
		pricingObservationDigest: digest(input.pricingObservationDigest, "d753.pricingObservation"),
		zeroByokObservationDigest: digest(input.zeroByokObservationDigest, "d753.zeroByok"),
		graphProviderEffectCount,
		routeFactCount,
		providerTransportCalls,
		providerAttemptEvidenceDisposition,
		terminalDiagnosticProposalCount: safeInteger(
			input.terminalDiagnosticProposalCount,
			"d753.terminalDiagnosticProposalCount",
			{ max: 24 },
		),
		retryDiagnosticProposalCount: safeInteger(
			input.retryDiagnosticProposalCount,
			"d753.retryDiagnosticProposalCount",
			{ max: 24 },
		),
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = strictSnapshot({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const observationMaterial = strictSnapshot({
		schemaVersion: D753_OBSERVATION_SCHEMA,
		disposition,
		model: D753_ROUTE_PROFILE.requestModel,
		selectedEndpointModel: D753_ROUTE_PROFILE.selectedEndpointModel,
		provider: D753_ROUTE_PROFILE.providerName,
		providerTag: D753_ROUTE_PROFILE.providerTag,
		quantization: D753_ROUTE_PROFILE.quantization,
		endpointProtocol: D753_ROUTE_PROFILE.endpointProtocol,
		reasoningEffort: D753_ROUTE_PROFILE.reasoningEffort,
		qualificationDigest: qualification.qualificationDigest,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		terminalHttpGraphEvidenceDigest: terminalHttpGraphEvidence.evidenceDigest,
		routeEvidenceDigest: routeEvidence.evidenceDigest,
		transportDiagnosticGraphEvidenceDigest: transportDiagnosticGraphEvidence.evidenceDigest,
		graphRunStatus: graphEvidence.runStatus,
		completedArms: graphEvidence.ledger.completedArms,
		findings: graphEvidence.ledger.findings,
		usage: integration.run.usage,
		graphProviderEffectCount,
		routeFactCount,
		providerTransportCalls,
		providerAttemptEvidenceDisposition,
		fallbackUsed: false,
		providerSwitchUsed: false,
		routeSwitchUsed: false,
		parallelOrBackgroundCalls: false,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const observation = strictSnapshot({
		...observationMaterial,
		observationDigest: empiricalStrictJsonDigest(observationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: success ? D753_GENERATION_SCHEMA : D753_PARTIAL_SCHEMA,
		generationRef: D753_GENERATION_REF,
		disposition,
		qualificationDigest: qualification.qualificationDigest,
		observationDigest: observation.observationDigest,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		terminalHttpGraphEvidenceDigest: terminalHttpGraphEvidence.evidenceDigest,
		routeEvidenceDigest: routeEvidence.evidenceDigest,
		transportDiagnosticGraphEvidenceDigest: transportDiagnosticGraphEvidence.evidenceDigest,
		claimDigest: input.claimDigest,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const terminalMaterial = strictSnapshot({
		schemaVersion: D753_TERMINAL_SCHEMA,
		status: disposition,
		claimDigest: input.claimDigest,
		currentKeyAdmissionDigest: input.currentKeyAdmissionDigest,
		pricingReadDigest: input.pricingReadDigest,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		terminalHttpGraphEvidenceDigest: terminalHttpGraphEvidence.evidenceDigest,
		routeEvidenceDigest: routeEvidence.evidenceDigest,
		transportDiagnosticGraphEvidenceDigest: transportDiagnosticGraphEvidence.evidenceDigest,
		graphProviderEffectCount,
		routeFactCount,
		providerTransportCalls,
		providerAttemptEvidenceDisposition,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const terminalReceipt = strictSnapshot({
		...terminalMaterial,
		terminalReceiptDigest: empiricalStrictJsonDigest(terminalMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D753_BUNDLE_SCHEMA,
		disposition,
		qualification,
		graphEvidence,
		terminalHttpGraphEvidence,
		transportDiagnosticGraphEvidence,
		routeEvidence,
		executorFailureFacts: failures,
		cleanupFacts: cleanups,
		observation,
		generation,
		terminalReceipt,
	});
	const bundle = strictSnapshot({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
	constructedBundles.add(bundle);
	return bundle as unknown as D753LiveBundleV1;
}

export async function runD753LiveReplacement(inputValue: {
	readonly historicalBundleBytes: Uint8Array;
	readonly implementationManifestDigest: string;
	readonly diagnosticCapability: D753TransportDiagnosticRouteAdapterV1;
	readonly executionAuthority: D753ExecutionAuthorityV1;
	readonly pricingReadDigest: string;
	readonly pricingObservationDigest: string;
	readonly providerTransportCalls: () => number;
	readonly signal: AbortSignal;
}): Promise<D753LiveBundleV1> {
	const input = record(inputValue, "d753.run");
	exactKeys(
		input,
		[
			"diagnosticCapability",
			"historicalBundleBytes",
			"executionAuthority",
			"implementationManifestDigest",
			"pricingObservationDigest",
			"pricingReadDigest",
			"providerTransportCalls",
			"signal",
		],
		"d753.run",
	);
	validateHistoricalBundle(input.historicalBundleBytes as Uint8Array);
	const authority = consumeD753ExecutionAuthority(input.executionAuthority);
	const pricingReadDigest = digest(input.pricingReadDigest, "d753.run.pricingReadDigest");
	const implementationManifestDigest = digest(
		input.implementationManifestDigest,
		"d753.run.implementationManifestDigest",
	);
	literal(
		authority.claim.historicalBundleDigest,
		D753_HISTORICAL_BUNDLE_DIGEST,
		"d753.authority.historical",
	);
	literal(authority.claim.routeProfileDigest, D753_ROUTE_PROFILE_DIGEST, "d753.authority.route");
	literal(authority.claim.pricingReadDigest, pricingReadDigest, "d753.authority.pricing");
	literal(
		authority.claim.implementationManifestDigest,
		implementationManifestDigest,
		"d753.authority.implementation",
	);
	if (typeof input.providerTransportCalls !== "function")
		throw new TypeError("D753 provider call counter is invalid");
	const integration = await runD734RouteProfileSixArmLiveIntegration({
		sourceDigest: empiricalStrictJsonDigest({
			decisionRef: D753_DECISION_REF,
			coordinatesDigest: D753_COORDINATES_DIGEST,
			claimDigest: authority.claim.claimDigest,
			implementationManifestDigest,
		}),
		adapter: (input.diagnosticCapability as D753TransportDiagnosticRouteAdapterV1).adapter,
		objectivePhaseRecoveryPolicy: createD748GraphForwardPhaseContinuationPolicy(),
		signal: input.signal as AbortSignal,
	});
	const diagnosticFinalization = finalizeD753TransportDiagnostics(
		input.diagnosticCapability as D753TransportDiagnosticRouteAdapterV1,
		integration.run.graphEvidence,
	);
	return buildBundle(integration, {
		claimDigest: authority.claim.claimDigest,
		currentKeyAdmissionDigest: authority.currentKeyAdmission.admissionDigest,
		pricingReadDigest,
		pricingObservationDigest: input.pricingObservationDigest as string,
		zeroByokObservationDigest: authority.claim.zeroByokObservationDigest,
		implementationManifestDigest,
		providerTransportCalls: (input.providerTransportCalls as () => number)(),
		transportDiagnosticGraphEvidence: diagnosticFinalization.transportGraphEvidence,
		terminalDiagnosticProposalCount: diagnosticFinalization.terminalDiagnosticProposalCount,
		retryDiagnosticProposalCount: diagnosticFinalization.retryDiagnosticProposalCount,
	});
}

export async function runD753InjectedNoNetworkQualification(inputValue: {
	readonly historicalBundleBytes: Uint8Array;
	readonly implementationManifestDigest: string;
	readonly adapter: D734RouteBoundProviderAdapterV1;
	readonly providerTransportCalls: () => number;
	readonly signal: AbortSignal;
}): Promise<D753LiveBundleV1> {
	const input = record(inputValue, "d753.injectedRun");
	exactKeys(
		input,
		[
			"adapter",
			"historicalBundleBytes",
			"implementationManifestDigest",
			"providerTransportCalls",
			"signal",
		],
		"d753.injectedRun",
	);
	validateHistoricalBundle(input.historicalBundleBytes as Uint8Array);
	const implementationManifestDigest = digest(
		input.implementationManifestDigest,
		"d753.injectedRun.implementation",
	);
	if (typeof input.providerTransportCalls !== "function")
		throw new TypeError("D753 injected provider call counter is invalid");
	const integration = await runD734RouteProfileSixArmLiveIntegration({
		sourceDigest: empiricalStrictJsonDigest({
			decisionRef: D753_DECISION_REF,
			executionClass: "injected-no-network",
			implementationManifestDigest,
		}),
		adapter: input.adapter as D734RouteBoundProviderAdapterV1,
		objectivePhaseRecoveryPolicy: createD748GraphForwardPhaseContinuationPolicy(),
		signal: input.signal as AbortSignal,
	});
	const emptyDiagnosticMaterial = strictSnapshot({
		schemaVersion: "graphrefly.b112.d753.transport-diagnostic-graph-evidence.v1" as const,
		facts: Object.freeze([]),
	});
	const transportDiagnosticGraphEvidence = validateD753TransportDiagnosticGraphEvidence(
		strictSnapshot({
			...emptyDiagnosticMaterial,
			evidenceDigest: empiricalStrictJsonDigest(emptyDiagnosticMaterial),
		}),
		integration.run.graphEvidence,
	);
	return buildBundle(integration, {
		claimDigest: empiricalStrictJsonDigest({ d753: "injected-claim" }),
		currentKeyAdmissionDigest: empiricalStrictJsonDigest({ d753: "injected-current-key" }),
		pricingReadDigest: empiricalStrictJsonDigest({ d753: "injected-pricing-read" }),
		pricingObservationDigest: empiricalStrictJsonDigest({ d753: "injected-pricing-observation" }),
		zeroByokObservationDigest: empiricalStrictJsonDigest({ d753: "injected-zero-byok" }),
		implementationManifestDigest,
		providerTransportCalls: (input.providerTransportCalls as () => number)(),
		transportDiagnosticGraphEvidence,
		terminalDiagnosticProposalCount: 0,
		retryDiagnosticProposalCount: 0,
	});
}

export function validateD753LiveBundle(value: unknown): D753LiveBundleV1 {
	const candidate = record(value, "d753.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"cleanupFacts",
			"disposition",
			"executorFailureFacts",
			"generation",
			"graphEvidence",
			"observation",
			"qualification",
			"routeEvidence",
			"schemaVersion",
			"terminalHttpGraphEvidence",
			"transportDiagnosticGraphEvidence",
			"terminalReceipt",
		],
		"d753.bundle",
	);
	literal(candidate.schemaVersion, D753_BUNDLE_SCHEMA, "d753.bundle.schema");
	const graph = replayGraph(candidate.graphEvidence);
	const terminal = validateD724TerminalHttpGraphEvidence(candidate.terminalHttpGraphEvidence);
	const transportDiagnostic = validateD753TransportDiagnosticGraphEvidence(
		candidate.transportDiagnosticGraphEvidence,
		graph,
	);
	const route = validateD734RouteGraphEvidence(candidate.routeEvidence);
	const failures = executorFailureFacts(graph);
	const cleanups = cleanupFacts(graph);
	literal(
		empiricalStrictJsonDigest(candidate.executorFailureFacts),
		empiricalStrictJsonDigest(failures),
		"d753.failures",
	);
	literal(
		empiricalStrictJsonDigest(candidate.cleanupFacts),
		empiricalStrictJsonDigest(cleanups),
		"d753.cleanups",
	);
	const qualification = record(candidate.qualification, "d753.qualification");
	const observation = record(candidate.observation, "d753.observation");
	const generation = record(candidate.generation, "d753.generation");
	const terminalReceipt = record(candidate.terminalReceipt, "d753.terminalReceipt");
	const graphProviderEffectCount = graph.ledger.effectProposals.filter(
		(proposal) => proposal.effectKind === "provider-request",
	).length;
	const routeFactCount = route.facts.length;
	const providerTransportCalls = safeInteger(
		qualification.providerTransportCalls,
		"d753.qualification.providerTransportCalls",
		{ max: 96 },
	);
	const providerAttemptEvidenceDisposition =
		providerTransportCalls === graphProviderEffectCount
			? "exact"
			: providerTransportCalls < graphProviderEffectCount
				? "pre-transport-failure-observed"
				: "unexpected-extra-transport-observed";
	const terminalDiagnosticProposalCount = safeInteger(
		qualification.terminalDiagnosticProposalCount,
		"d753.qualification.terminalDiagnosticProposalCount",
		{ max: 24 },
	);
	const retryDiagnosticProposalCount = safeInteger(
		qualification.retryDiagnosticProposalCount,
		"d753.qualification.retryDiagnosticProposalCount",
		{ max: 24 },
	);
	literal(
		terminalDiagnosticProposalCount,
		transportDiagnostic.facts.length,
		"d753.qualification.terminalDiagnosticProposalCount",
	);
	const expectedRetryDiagnostics = graph.effectRuns.flatMap((run) =>
		run.facts.filter(
			(fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.result.effectKind === "provider-request" &&
				fact.result.status === "retryable-failure" &&
				fact.result.failureDiscriminator === "d675-und-err-socket",
		),
	).length;
	literal(
		retryDiagnosticProposalCount,
		expectedRetryDiagnostics,
		"d753.qualification.retryDiagnosticProposalCount",
	);
	for (const [object, path] of [
		[qualification, "d753.qualification"],
		[observation, "d753.observation"],
		[terminalReceipt, "d753.terminalReceipt"],
	] as const) {
		literal(
			object.graphProviderEffectCount,
			graphProviderEffectCount,
			`${path}.graphProviderEffects`,
		);
		literal(object.routeFactCount, routeFactCount, `${path}.routeFacts`);
		literal(
			object.providerTransportCalls,
			providerTransportCalls,
			`${path}.providerTransportCalls`,
		);
		literal(
			object.providerAttemptEvidenceDisposition,
			providerAttemptEvidenceDisposition,
			`${path}.providerAttemptEvidenceDisposition`,
		);
	}
	const expectedDisposition =
		graph.runStatus === "complete" &&
		graph.ledger.completedArms.length === 6 &&
		terminal.facts.length === 0 &&
		failures.length === 0 &&
		providerAttemptEvidenceDisposition !== "unexpected-extra-transport-observed" &&
		cleanups.every((fact) => fact.status === "succeeded")
			? "success"
			: "partial-failure";
	literal(
		oneOf(candidate.disposition, ["success", "partial-failure"], "d753.disposition"),
		expectedDisposition,
		"d753.disposition",
	);
	for (const [object, key, path] of [
		[qualification, "qualificationDigest", "d753.qualification"],
		[observation, "observationDigest", "d753.observation"],
		[generation, "generationDigest", "d753.generation"],
		[terminalReceipt, "terminalReceiptDigest", "d753.terminalReceipt"],
	] as const) {
		const expected = digest(object[key], `${path}.digest`);
		const { [key]: _discarded, ...material } = object;
		literal(expected, empiricalStrictJsonDigest(material), `${path}.digest`);
	}
	literal(
		qualification.coordinatesDigest,
		D753_COORDINATES_DIGEST,
		"d753.qualification.coordinates",
	);
	literal(
		qualification.historicalArtifactSha256,
		D753_HISTORICAL_ARTIFACT_SHA256,
		"d753.qualification.historicalArtifact",
	);
	literal(
		qualification.historicalBundleDigest,
		D753_HISTORICAL_BUNDLE_DIGEST,
		"d753.qualification.historicalBundle",
	);
	literal(
		qualification.historicalGenerationDigest,
		D753_HISTORICAL_GENERATION_DIGEST,
		"d753.qualification.historicalGeneration",
	);
	literal(
		qualification.historicalQualificationDigest,
		D753_HISTORICAL_QUALIFICATION_DIGEST,
		"d753.qualification.historicalQualification",
	);
	literal(qualification.routeProfileDigest, D753_ROUTE_PROFILE_DIGEST, "d753.qualification.route");
	literal(qualification.graphEvidenceDigest, graph.evidenceDigest, "d753.qualification.graph");
	literal(
		qualification.routeEvidenceDigest,
		route.evidenceDigest,
		"d753.qualification.routeEvidence",
	);
	literal(
		qualification.terminalHttpGraphEvidenceDigest,
		terminal.evidenceDigest,
		"d753.qualification.terminal",
	);
	literal(
		qualification.transportDiagnosticGraphEvidenceDigest,
		transportDiagnostic.evidenceDigest,
		"d753.qualification.transportDiagnostic",
	);
	literal(observation.graphEvidenceDigest, graph.evidenceDigest, "d753.observation.graph");
	literal(observation.routeEvidenceDigest, route.evidenceDigest, "d753.observation.route");
	literal(
		observation.transportDiagnosticGraphEvidenceDigest,
		transportDiagnostic.evidenceDigest,
		"d753.observation.transportDiagnostic",
	);
	literal(
		generation.transportDiagnosticGraphEvidenceDigest,
		transportDiagnostic.evidenceDigest,
		"d753.generation.transportDiagnostic",
	);
	literal(
		digest(generation.observationDigest, "d753.generation.observationDigest"),
		digest(observation.observationDigest, "d753.observation.observationDigest"),
		"d753.generation.observation",
	);
	literal(terminalReceipt.graphEvidenceDigest, graph.evidenceDigest, "d753.terminal.graph");
	literal(
		terminalReceipt.transportDiagnosticGraphEvidenceDigest,
		transportDiagnostic.evidenceDigest,
		"d753.terminal.transportDiagnostic",
	);
	for (const object of [qualification, observation, generation, terminalReceipt]) {
		literal(object.causalAttribution, "undetermined", "d753.attribution");
		literal(object.efficacyClaim, "none", "d753.efficacy");
	}
	const bundleDigest = digest(candidate.bundleDigest, "d753.bundle.digest");
	const { bundleDigest: _bundleDigest, ...material } = candidate;
	literal(bundleDigest, empiricalStrictJsonDigest(material), "d753.bundle.digest");
	return strictSnapshot(candidate) as unknown as D753LiveBundleV1;
}

interface Identity {
	readonly dev: number;
	readonly ino: number;
}

async function assertDirectory(path: string, identity: Identity): Promise<void> {
	const stat = await lstat(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o777) !== 0o700 ||
		stat.dev !== identity.dev ||
		stat.ino !== identity.ino ||
		(await realpath(path)) !== path
	)
		throw new TypeError("D753 persistence directory identity drifted");
}

async function writeArtifact(path: string, bytes: Uint8Array): Promise<Identity> {
	const handle = await open(
		path,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
		const stat = await handle.stat();
		if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1)
			throw new TypeError("D753 persistence file identity drifted");
		return { dev: stat.dev, ino: stat.ino };
	} finally {
		await handle.close();
	}
}

async function assertArtifact(path: string, identity: Identity, bytes: Uint8Array): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (
			!stat.isFile() ||
			stat.nlink !== 1 ||
			stat.dev !== identity.dev ||
			stat.ino !== identity.ino ||
			!sameBytes(new Uint8Array(await handle.readFile()), bytes)
		)
			throw new TypeError("D753 persistence file readback drifted");
	} finally {
		await handle.close();
	}
}

export async function persistD753LiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D753LiveBundleV1;
}) {
	const input = record(inputValue, "d753.persist");
	exactKeys(input, ["bundle", "privateRoot"], "d753.persist");
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.delete(input.bundle)
	)
		throw new TypeError("D753 persistence requires the exact constructed bundle");
	const bundle = validateD753LiveBundle(input.bundle);
	if (typeof input.privateRoot !== "string" || resolve(input.privateRoot) !== input.privateRoot)
		throw new TypeError("D753 persistence root must be absolute");
	const privateRoot = await realpath(input.privateRoot);
	const parent = await open(
		privateRoot,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	const parentStat = await parent.stat();
	if (!parentStat.isDirectory() || (parentStat.mode & 0o777) !== 0o700)
		throw new TypeError("D753 persistence root is invalid");
	const finalRoot = join(privateRoot, D753_GENERATION_REF);
	let finalIdentity: Identity | null = null;
	try {
		await mkdir(finalRoot, { recursive: false, mode: 0o700 });
		const finalStat = await lstat(finalRoot);
		finalIdentity = { dev: finalStat.dev, ino: finalStat.ino };
		await assertDirectory(finalRoot, finalIdentity);
		const staging = join(finalRoot, `.d753-staging-${randomUUID()}`);
		await mkdir(staging, { recursive: false, mode: 0o700 });
		const stagingStat = await lstat(staging);
		const stagingIdentity = { dev: stagingStat.dev, ino: stagingStat.ino };
		await assertDirectory(staging, stagingIdentity);
		const artifacts = [
			["qualification.v1.json", bundle.qualification],
			["graph-evidence.v1.json", bundle.graphEvidence],
			["terminal-http-graph-evidence.v1.json", bundle.terminalHttpGraphEvidence],
			["transport-diagnostic-graph-evidence.v1.json", bundle.transportDiagnosticGraphEvidence],
			["route-evidence.v1.json", bundle.routeEvidence],
			["executor-failure-facts.v1.json", bundle.executorFailureFacts],
			["cleanup-facts.v1.json", bundle.cleanupFacts],
			["observation.v1.json", bundle.observation],
			[
				bundle.disposition === "success"
					? "success-generation.v1.json"
					: "partial-failure-generation.v1.json",
				bundle.generation,
			],
			["terminal-receipt.v1.json", bundle.terminalReceipt],
			["bundle.v1.json", bundle],
		] as const;
		const encoded = artifacts.map(
			([name, value]) => [name, strictJsonCodec.encode(value as StrictJsonValue)] as const,
		);
		const identities = new Map<string, Identity>();
		for (const [name, bytes] of encoded)
			identities.set(name, await writeArtifact(join(staging, name), bytes));
		const stagingHandle = await open(
			staging,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			await stagingHandle.sync();
		} finally {
			await stagingHandle.close();
		}
		for (const [name, bytes] of encoded)
			await assertArtifact(join(staging, name), identities.get(name)!, bytes);
		const artifactsRoot = join(finalRoot, "artifacts");
		await rename(staging, artifactsRoot);
		const artifactsStat = await lstat(artifactsRoot);
		const artifactsIdentity = { dev: artifactsStat.dev, ino: artifactsStat.ino };
		if (
			artifactsIdentity.dev !== stagingIdentity.dev ||
			artifactsIdentity.ino !== stagingIdentity.ino
		)
			throw new TypeError("D753 persistence rename identity drifted");
		const commit = strictSnapshot({
			schemaVersion: "graphrefly.b112.d753.atomic-commit.v1",
			generationRef: D753_GENERATION_REF,
			disposition: bundle.disposition,
			bundleDigest: bundle.bundleDigest,
			terminalReceiptDigest: bundle.terminalReceipt.terminalReceiptDigest,
		});
		const commitBytes = strictJsonCodec.encode(commit);
		const commitIdentity = await writeArtifact(join(finalRoot, "commit.v1.json"), commitBytes);
		const finalHandle = await open(
			finalRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			await finalHandle.sync();
		} finally {
			await finalHandle.close();
		}
		await parent.sync();
		for (const [name, bytes] of encoded)
			await assertArtifact(join(artifactsRoot, name), identities.get(name)!, bytes);
		await assertArtifact(join(finalRoot, "commit.v1.json"), commitIdentity, commitBytes);
		await assertDirectory(finalRoot, finalIdentity);
		await assertDirectory(artifactsRoot, artifactsIdentity);
		return Object.freeze({
			generationRef: D753_GENERATION_REF,
			disposition: bundle.disposition,
			bundleDigest: bundle.bundleDigest,
			bundleSha256: empiricalSha256(strictJsonCodec.encode(bundle as unknown as StrictJsonValue)),
		});
	} catch (error) {
		if (finalIdentity !== null) {
			const current = await lstat(finalRoot).catch(() => null);
			if (
				current?.isDirectory() &&
				!current.isSymbolicLink() &&
				current.dev === finalIdentity.dev &&
				current.ino === finalIdentity.ino
			)
				await rm(finalRoot, { recursive: true, force: true });
		}
		throw error;
	} finally {
		await parent.close();
	}
}
