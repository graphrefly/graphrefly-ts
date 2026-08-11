import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	strictSnapshot,
} from "./canonical.js";

export const D724_DECISION_REF = "decision.D724" as const;
export const D724_DECISION_REVISION = "2026-08-11.v1" as const;
export const D724_FORENSIC_SCHEMA = "graphrefly.b112.d724.d723-terminal-http-forensic.v1" as const;
export const D724_GENERATION_SCHEMA =
	"graphrefly.b112.d724.d723-terminal-http-forensic-generation.v1" as const;
export const D724_GENERATION_REF = "d724-d723-terminal-http-forensic-2026-08-11-v1" as const;

export const D724_D723_ARTIFACT_SHA256 = Object.freeze({
	dispatchClaim: "sha256:bcc737dc78a88a2ddcb7322819e79784b584b1fcff540ba9ed96ae74b21aa339",
	currentKeyAdmission: "sha256:be7b115590dcd02ff05e3ce160a20960c6ed5605f1a24c6a611928fbf64ba661",
	terminalReceipt: "sha256:8b2d6f22bfb1c8c367906b89d6801a0450cf8fc7d8eac58f233ee73074e8b1d0",
	graphEvidence: "sha256:0ac5af97ee06884f432bd524769339050ad2582b90dbf9f7aad6add8301351e3",
	observation: "sha256:97260d59f947bd41955bbf780f5d614b9bc933b4b4053491c201d47e0f67b078",
	generation: "sha256:4c7db3a5a506195c63b160f4cbab37e540138418ea7aad089b51e1191a50c68a",
});

export interface D724D723ArtifactBytesV1 {
	readonly dispatchClaim: Uint8Array;
	readonly currentKeyAdmission: Uint8Array;
	readonly terminalReceipt: Uint8Array;
	readonly graphEvidence: Uint8Array;
	readonly observation: Uint8Array;
	readonly generation: Uint8Array;
}

const ARTIFACT_LIMITS = Object.freeze({
	dispatchClaim: 16_384,
	currentKeyAdmission: 16_384,
	terminalReceipt: 16_384,
	graphEvidence: 1_048_576,
	observation: 128 * 1_024,
	generation: 16_384,
});

function decodeArtifact(
	value: unknown,
	key: keyof D724D723ArtifactBytesV1,
): Record<string, unknown> {
	if (!(value instanceof Uint8Array)) throw new TypeError(`D724 ${key} must be Uint8Array`);
	const bytes = new Uint8Array(value);
	if (bytes.byteLength < 1 || bytes.byteLength > ARTIFACT_LIMITS[key])
		throw new TypeError(`D724 ${key} bytes exceed the bound`);
	literal(empiricalSha256(bytes), D724_D723_ARTIFACT_SHA256[key], `d724.${key}.sha256`);
	return record(strictJsonCodec.decode(bytes), `d724.${key}`);
}

export function createD724D723TerminalHttpForensic(inputValue: D724D723ArtifactBytesV1) {
	const input = record(inputValue, "d724.artifacts");
	exactKeys(
		input,
		[
			"currentKeyAdmission",
			"dispatchClaim",
			"generation",
			"graphEvidence",
			"observation",
			"terminalReceipt",
		],
		"d724.artifacts",
	);
	const claim = decodeArtifact(input.dispatchClaim, "dispatchClaim");
	const currentKey = decodeArtifact(input.currentKeyAdmission, "currentKeyAdmission");
	const terminal = decodeArtifact(input.terminalReceipt, "terminalReceipt");
	const graphEvidence = decodeArtifact(input.graphEvidence, "graphEvidence");
	const observation = decodeArtifact(input.observation, "observation");
	const generation = decodeArtifact(input.generation, "generation");

	literal(claim.decisionRef, "decision.D723", "d724.claim.decisionRef");
	literal(claim.decisionRevision, "2026-08-11.v1", "d724.claim.decisionRevision");
	const claimDigest = digest(claim.claimDigest, "d724.claim.claimDigest");
	const { claimDigest: _claimDigest, ...claimMaterial } = claim;
	literal(claimDigest, empiricalStrictJsonDigest(claimMaterial), "d724.claim.claimDigest");
	const currentKeyAdmissionDigest = digest(
		currentKey.currentKeyAdmissionDigest,
		"d724.currentKey.admissionDigest",
	);
	literal(currentKey.remainingMicrousd, 19_424_009, "d724.currentKey.remainingMicrousd");
	literal(terminal.terminalStatus, "success", "d724.terminal.status");
	literal(terminal.terminalPhase, "generation-persistence", "d724.terminal.phase");
	literal(terminal.claimDigest, claimDigest, "d724.terminal.claimDigest");
	literal(
		terminal.currentKeyAdmissionDigest,
		currentKeyAdmissionDigest,
		"d724.terminal.currentKeyDigest",
	);
	literal(terminal.currentKeyNetworkCalls, 1, "d724.terminal.currentKeyCalls");
	literal(terminal.providerTransportCalls, 1, "d724.terminal.providerCalls");

	const ledger = record(graphEvidence.ledger, "d724.graph.ledger");
	literal(ledger.runStatus, "stopped", "d724.graph.runStatus");
	const completedArms = array(ledger.completedArms, "d724.graph.completedArms");
	if (completedArms.length !== 0) throw new TypeError("D724 historical run completed an arm");
	const proposals = array(ledger.effectProposals, "d724.graph.proposals");
	const reconciliations = array(ledger.effectReconciliations, "d724.graph.reconciliations");
	const providerProposals = proposals.filter(
		(value) => record(value, "d724.graph.proposal").effectKind === "provider-request",
	);
	if (providerProposals.length !== 1) throw new TypeError("D724 historical provider count drifted");
	const providerProposal = record(providerProposals[0], "d724.graph.providerProposal");
	const providerReconciliation = reconciliations
		.map((value) => record(value, "d724.graph.reconciliation"))
		.find((value) => value.effectSequence === providerProposal.effectSequence);
	if (providerReconciliation === undefined)
		throw new TypeError("D724 provider reconciliation is absent");
	literal(providerReconciliation.outcome, "terminal-failure", "d724.provider.outcome");
	literal(providerReconciliation.actualCostMicrousd, 0, "d724.provider.cost");
	literal(providerReconciliation.failureDiscriminator, "none", "d724.provider.retry");
	const effectRuns = array(graphEvidence.effectRuns, "d724.graph.effectRuns");
	if (effectRuns.length !== 1) throw new TypeError("D724 historical effect run count drifted");
	const facts = array(record(effectRuns[0], "d724.graph.effectRun").facts, "d724.graph.facts");
	const providerFacts = facts
		.map((value) => record(value, "d724.graph.fact"))
		.filter(
			(fact) => record(fact.result, "d724.graph.fact.result").effectKind === "provider-request",
		);
	if (providerFacts.length !== 1)
		throw new TypeError("D724 historical provider fact count drifted");
	const providerFact = providerFacts[0];
	if (providerFact === undefined) throw new TypeError("D724 historical provider fact is absent");
	const providerResult = record(providerFact.result, "d724.graph.providerResult");
	const providerRequest = record(providerFact.request, "d724.graph.providerRequest");
	literal(providerResult.status, "terminal-failure", "d724.provider.status");
	literal(providerResult.failureDiscriminator, "none", "d724.provider.discriminator");
	if (Object.hasOwn(providerResult, "terminalHttpEvidence"))
		throw new TypeError("D724 may not reinterpret D723 as exact terminal HTTP evidence");
	if (Object.hasOwn(providerRequest, "completionContext"))
		throw new TypeError("D724 historical provider request unexpectedly exposed completion context");
	const toolFacts = facts.filter(
		(value) =>
			record(record(value, "d724.graph.fact").result, "d724.graph.result").effectKind ===
			"tool-action",
	);
	const verifierFacts = facts.filter(
		(value) =>
			record(record(value, "d724.graph.fact").result, "d724.graph.result").effectKind ===
			"hidden-verifier",
	);
	const cleanupFacts = facts
		.map((value) => record(value, "d724.graph.fact"))
		.filter((fact) => record(fact.result, "d724.graph.result").effectKind === "cleanup");
	if (toolFacts.length !== 0 || verifierFacts.length !== 0 || cleanupFacts.length !== 1)
		throw new TypeError("D724 pre-treatment execution coordinates drifted");
	const cleanupResult = record(
		record(cleanupFacts[0], "d724.graph.cleanupFact").result,
		"d724.graph.cleanup",
	);
	literal(cleanupResult.status, "succeeded", "d724.cleanup.status");

	const graphEvidenceDigest = empiricalStrictJsonDigest(graphEvidence);
	literal(graphEvidenceDigest, D724_D723_ARTIFACT_SHA256.graphEvidence, "d724.graph.digest");
	literal(observation.graphEvidenceDigest, graphEvidenceDigest, "d724.observation.graphDigest");
	literal(observation.graphRunStatus, "stopped", "d724.observation.status");
	literal(record(observation.usage, "d724.observation.usage").requests, 1, "d724.usage.requests");
	literal(record(observation.usage, "d724.observation.usage").retryWaits, 0, "d724.usage.retries");
	literal(record(observation.usage, "d724.observation.usage").costMicrousd, 0, "d724.usage.cost");
	literal(
		record(observation.operational, "d724.observation.operational").failedEffectCount,
		0,
		"d724.operational.failedEffectCount",
	);
	const observationDigest = digest(observation.observationDigest, "d724.observation.digest");
	const { observationDigest: _observationDigest, ...observationMaterial } = observation;
	literal(
		observationDigest,
		empiricalStrictJsonDigest(observationMaterial),
		"d724.observation.digest",
	);
	literal(generation.observationDigest, observationDigest, "d724.generation.observationDigest");
	literal(generation.graphEvidenceDigest, graphEvidenceDigest, "d724.generation.graphDigest");
	const generationDigest = digest(generation.generationDigest, "d724.generation.digest");
	const { generationDigest: _generationDigest, ...generationMaterial } = generation;
	literal(
		generationDigest,
		empiricalStrictJsonDigest(generationMaterial),
		"d724.generation.digest",
	);
	literal(terminal.observationDigest, observationDigest, "d724.terminal.observationDigest");
	literal(terminal.generationDigest, generationDigest, "d724.terminal.generationDigest");
	literal(observation.causalAttribution, "undetermined", "d724.observation.attribution");
	literal(observation.efficacyClaim, "none", "d724.observation.efficacy");

	const material = strictSnapshot({
		schemaVersion: D724_FORENSIC_SCHEMA,
		decisionRef: D724_DECISION_REF,
		decisionRevision: D724_DECISION_REVISION,
		sourceDecisionRef: "decision.D723",
		sourceImplementationCommit: "b5f95310",
		sourceArtifactDigests: D724_D723_ARTIFACT_SHA256,
		sourceCoordinates: {
			claimDigest,
			currentKeyAdmissionDigest,
			graphEvidenceDigest,
			observationDigest,
			generationDigest,
		},
		classification: "non-retryable-non-200-before-treatment",
		historicalExactHttpStatus: "unavailable",
		historicalTerminalHttpEvidencePresent: false,
		providerRequestCount: 1,
		retryWaitCount: 0,
		completedArmCount: 0,
		toolActionCount: 0,
		hiddenVerifierCount: 0,
		completionContextExposure: false,
		memoryInsightAdmissionCount: 0,
		cleanupStatus: "succeeded",
		graphAccountedCostMicrousd: 0,
		knownUnknowns: [
			"exact-http-status",
			"response-media-type",
			"response-body-shape",
			"recognized-error-type-or-code",
			"retry-after-presence",
		],
		causalAttribution: "undetermined",
		efficacyClaim: "none",
	});
	return strictSnapshot({
		...material,
		forensicDigest: empiricalStrictJsonDigest(material),
	});
}

export function createD724ForensicGeneration(forensicValue: unknown) {
	const forensic = validateD724D723TerminalHttpForensic(forensicValue);
	const forensicDigest = forensic.forensicDigest;
	const material = strictSnapshot({
		schemaVersion: D724_GENERATION_SCHEMA,
		generationRef: D724_GENERATION_REF,
		forensicDigest,
		sourceArtifactDigests: D724_D723_ARTIFACT_SHA256,
		causalAttribution: "undetermined",
		efficacyClaim: "none",
	});
	return strictSnapshot({
		...material,
		generationDigest: empiricalStrictJsonDigest(material),
	});
}

export function validateD724D723TerminalHttpForensic(value: unknown) {
	const candidate = record(value, "d724.forensic");
	exactKeys(
		candidate,
		[
			"causalAttribution",
			"classification",
			"cleanupStatus",
			"completedArmCount",
			"completionContextExposure",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"forensicDigest",
			"graphAccountedCostMicrousd",
			"hiddenVerifierCount",
			"historicalExactHttpStatus",
			"historicalTerminalHttpEvidencePresent",
			"knownUnknowns",
			"memoryInsightAdmissionCount",
			"providerRequestCount",
			"retryWaitCount",
			"schemaVersion",
			"sourceArtifactDigests",
			"sourceCoordinates",
			"sourceDecisionRef",
			"sourceImplementationCommit",
			"toolActionCount",
		],
		"d724.forensic",
	);
	literal(candidate.schemaVersion, D724_FORENSIC_SCHEMA, "d724.forensic.schema");
	literal(candidate.decisionRef, D724_DECISION_REF, "d724.forensic.decisionRef");
	literal(candidate.decisionRevision, D724_DECISION_REVISION, "d724.forensic.decisionRevision");
	literal(candidate.sourceDecisionRef, "decision.D723", "d724.forensic.sourceDecisionRef");
	literal(
		candidate.sourceImplementationCommit,
		"b5f95310",
		"d724.forensic.sourceImplementationCommit",
	);
	literal(
		empiricalStrictJsonDigest(candidate.sourceArtifactDigests),
		empiricalStrictJsonDigest(D724_D723_ARTIFACT_SHA256),
		"d724.forensic.sourceArtifactDigests",
	);
	const coordinates = record(candidate.sourceCoordinates, "d724.forensic.sourceCoordinates");
	exactKeys(
		coordinates,
		[
			"claimDigest",
			"currentKeyAdmissionDigest",
			"generationDigest",
			"graphEvidenceDigest",
			"observationDigest",
		],
		"d724.forensic.sourceCoordinates",
	);
	for (const key of Object.keys(coordinates)) digest(coordinates[key], `d724.forensic.${key}`);
	literal(
		candidate.classification,
		"non-retryable-non-200-before-treatment",
		"d724.forensic.classification",
	);
	literal(candidate.historicalExactHttpStatus, "unavailable", "d724.forensic.httpStatus");
	literal(
		candidate.historicalTerminalHttpEvidencePresent,
		false,
		"d724.forensic.httpEvidencePresent",
	);
	for (const [key, expected] of Object.entries({
		providerRequestCount: 1,
		retryWaitCount: 0,
		completedArmCount: 0,
		toolActionCount: 0,
		hiddenVerifierCount: 0,
		memoryInsightAdmissionCount: 0,
		graphAccountedCostMicrousd: 0,
	}))
		literal(candidate[key], expected, `d724.forensic.${key}`);
	literal(candidate.completionContextExposure, false, "d724.forensic.contextExposure");
	literal(candidate.cleanupStatus, "succeeded", "d724.forensic.cleanupStatus");
	const knownUnknowns = array(candidate.knownUnknowns, "d724.forensic.knownUnknowns");
	literal(
		empiricalStrictJsonDigest(knownUnknowns),
		empiricalStrictJsonDigest([
			"exact-http-status",
			"response-media-type",
			"response-body-shape",
			"recognized-error-type-or-code",
			"retry-after-presence",
		]),
		"d724.forensic.knownUnknowns",
	);
	literal(candidate.causalAttribution, "undetermined", "d724.forensic.attribution");
	literal(candidate.efficacyClaim, "none", "d724.forensic.efficacy");
	const forensicDigest = digest(candidate.forensicDigest, "d724.forensic.digest");
	const { forensicDigest: _ignored, ...material } = candidate;
	literal(forensicDigest, empiricalStrictJsonDigest(material), "d724.forensic.digest");
	return strictSnapshot(candidate);
}

export function validateD724ForensicGeneration(value: unknown) {
	const candidate = record(value, "d724.generation");
	exactKeys(
		candidate,
		[
			"causalAttribution",
			"efficacyClaim",
			"forensicDigest",
			"generationDigest",
			"generationRef",
			"schemaVersion",
			"sourceArtifactDigests",
		],
		"d724.generation",
	);
	literal(candidate.schemaVersion, D724_GENERATION_SCHEMA, "d724.generation.schema");
	literal(candidate.generationRef, D724_GENERATION_REF, "d724.generation.ref");
	digest(candidate.forensicDigest, "d724.generation.forensicDigest");
	literal(
		empiricalStrictJsonDigest(candidate.sourceArtifactDigests),
		empiricalStrictJsonDigest(D724_D723_ARTIFACT_SHA256),
		"d724.generation.sourceArtifactDigests",
	);
	literal(candidate.causalAttribution, "undetermined", "d724.generation.attribution");
	literal(candidate.efficacyClaim, "none", "d724.generation.efficacy");
	const generationDigest = digest(candidate.generationDigest, "d724.generation.digest");
	const { generationDigest: _ignored, ...material } = candidate;
	literal(generationDigest, empiricalStrictJsonDigest(material), "d724.generation.digest");
	return strictSnapshot(candidate);
}
