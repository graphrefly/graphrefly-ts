import {
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	strictSnapshot,
} from "./canonical.js";
import {
	createD779InjectedBaselineForTest,
	runD779InjectedNoNetworkQualification,
	validateD779QualificationBundle,
} from "./d779-pre-live-qualification.js";
import {
	D782_COORDINATES_DIGEST,
	D782_D781_FORENSIC_ARTIFACT_SHA256,
	D782_D781_FORENSIC_DIGEST,
	D782_DECISION_REF,
	D782_DECISION_REVISION,
} from "./d782-coordinates.js";
import {
	isD782GraphSynthesizedToolFailureForTest,
	validateD782D781ForensicBytes,
	validateD782TaskToolFactsForTest,
	validateD782ToolRejectionFactsForTest,
} from "./d782-graph-native-live.js";
import {
	D782_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD782Implementation,
} from "./d782-implementation-manifest.js";

export const D782_PRE_LIVE_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d782.historical-coordinate-no-network-qualification.v1" as const;

export interface D782PreLiveQualificationV1 {
	readonly schemaVersion: typeof D782_PRE_LIVE_QUALIFICATION_SCHEMA;
	readonly decisionRef: typeof D782_DECISION_REF;
	readonly decisionRevision: typeof D782_DECISION_REVISION;
	readonly coordinatesDigest: string;
	readonly implementationManifestDigest: string;
	readonly d781ForensicArtifactSha256: string;
	readonly d781ForensicDigest: string;
	readonly injectedGraphEvidenceDigest: string;
	readonly injectedRouteEvidenceDigest: string;
	readonly completedArms: 6;
	readonly maxActiveArms: 1;
	readonly providerCalls: number;
	readonly retryWaits: number;
	readonly sanitizedToolRejectionFacts: number;
	readonly graphSynthesizedFailureCases: 2;
	readonly providerNetworkCalls: 0;
	readonly credentialReads: 0;
	readonly controlPlaneCalls: 0;
	readonly workspaceResidueCount: 0;
	readonly budgetRetrySemanticsInherited: true;
	readonly realRejectionBijectionPassed: true;
	readonly wrongToolSyntheticFailureWithoutProposalPassed: true;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly qualificationDigest: string;
}

export function createD782D781ForensicBytesForTest(): Uint8Array {
	const material = {
		schemaVersion: "graphrefly.b112.d781.pre-provider-historical-coordinate-failure-forensic.v1",
		decisionRef: "decision.D781",
		decisionRevision: "2026-08-14.v1",
		status: "failed-pre-provider-validation",
		failurePhase: "live-measurement-historical-coordinate-validation",
		failureCode: "historical-implementation-coordinate-conflated",
		claimDigest: "sha256:bf0eb7dd1f0b70b685a53f0dd67707e43e81ba2d3d894b63fa97afc71a52a2d3",
		currentKeyAdmissionDigest:
			"sha256:f37b1f223de5c8a469a18c401f145860ab2f1228a647e05a1cdbbea00f0bd54c",
		pricingReadDigest: "sha256:7ded2e71e76f0670a26321708410e2e73185f8d81579180268ba9a2223ceb9e1",
		zeroByokObservationDigest:
			"sha256:814c1f3f25b040f81d0faec845e96e188a5a15abbb7dad423615985a5800804e",
		implementationManifestDigest:
			"sha256:44f603808f7a05a71f3061edbac82e3cf3282913da2544d339458774b40d9a5e",
		remainingMicrousdAtCurrentKeyAdmission: 17_748_444,
		historicalArtifactImplementationManifestDigest:
			"sha256:5900a0b65b488370e498f4ed953329522e4585e44070b09e014f6269e675a066",
		repairedD780BaselineImplementationManifestDigest:
			"sha256:4b3f23f9b6b42e977dcb15869d76617ebaedb85724290fd8e7919ac2ff273328",
		currentKeyCalls: 1,
		providerCalls: 0,
		canonicalGraphEvidenceDisposition: "unavailable-provider-executor-not-started",
		successGenerationDisposition: "absent",
		partialCanonicalGraphEvidencePublished: false,
		automaticRerun: false,
		causalAttribution: "undetermined",
		efficacyClaim: "none",
	};
	return new TextEncoder().encode(
		`${JSON.stringify({ ...material, forensicDigest: empiricalStrictJsonDigest(material) })}\n`,
	);
}

export async function runD782InjectedNoNetworkQualification(inputValue: {
	readonly d781ForensicBytes: Uint8Array;
}): Promise<D782PreLiveQualificationV1> {
	const input = record(inputValue, "d782.preLive.input");
	exactKeys(input, ["d781ForensicBytes"], "d782.preLive.input");
	validateD782D781ForensicBytes(input.d781ForensicBytes as Uint8Array);
	literal(
		await measureD782Implementation(),
		D782_IMPLEMENTATION_MANIFEST_DIGEST,
		"d782.preLive.implementation",
	);
	const injected = validateD779QualificationBundle(
		await runD779InjectedNoNetworkQualification(createD779InjectedBaselineForTest()),
	);
	validateD782TaskToolFactsForTest({
		taskExposureFacts: injected.taskExposureFacts,
		toolRejectionFacts: injected.toolRejectionFacts,
		graphEvidence: injected.graphEvidence,
		routeEvidence: injected.routeEvidence,
	});
	validateD782ToolRejectionFactsForTest({
		toolRejectionFacts: injected.diagnosticToolRejectionFacts,
		graphEvidence: injected.toolRejectionGraphEvidence,
	});
	validateD782ToolRejectionFactsForTest({
		toolRejectionFacts: [],
		graphEvidence: injected.wrongToolGraphEvidence,
	});
	for (const cause of ["executor-threw", "graph-admission-denied"] as const) {
		const requestDigest = empiricalStrictJsonDigest({ cause });
		if (
			!isD782GraphSynthesizedToolFailureForTest({
				kind: "graph-effect-result-admitted",
				request: { effectKind: "tool-action", requestDigest },
				result: {
					effectKind: "tool-action",
					status: "failed",
					evidenceDigest: empiricalStrictJsonDigest({ requestDigest, cause }),
				},
			})
		)
			throw new TypeError(`D782 ${cause} classification did not qualify`);
	}
	const q = injected.qualification;
	literal(q.completedArms, 6, "d782.preLive.completedArms");
	literal(injected.graphEvidence.ledger.maxActiveArms, 1, "d782.preLive.maxActiveArms");
	literal(q.providerNetworkCalls, 0, "d782.preLive.providerNetworkCalls");
	literal(q.credentialReads, 0, "d782.preLive.credentialReads");
	literal(q.controlPlaneCalls, 0, "d782.preLive.controlPlaneCalls");
	literal(q.workspaceResidueCount, 0, "d782.preLive.workspaceResidueCount");
	literal(q.adapterSideLedgerCount, 0, "d782.preLive.adapterSideLedgerCount");
	literal(q.providerCalls, 60, "d782.preLive.providerCalls");
	literal(q.retryWaits, 6, "d782.preLive.retryWaits");
	literal(
		injected.diagnosticToolRejectionFacts.length,
		5,
		"d782.preLive.sanitizedToolRejectionFacts",
	);
	const material = strictSnapshot({
		schemaVersion: D782_PRE_LIVE_QUALIFICATION_SCHEMA,
		decisionRef: D782_DECISION_REF,
		decisionRevision: D782_DECISION_REVISION,
		coordinatesDigest: D782_COORDINATES_DIGEST,
		implementationManifestDigest: D782_IMPLEMENTATION_MANIFEST_DIGEST,
		d781ForensicArtifactSha256: D782_D781_FORENSIC_ARTIFACT_SHA256,
		d781ForensicDigest: D782_D781_FORENSIC_DIGEST,
		injectedGraphEvidenceDigest: injected.graphEvidence.evidenceDigest,
		injectedRouteEvidenceDigest: injected.routeEvidence.evidenceDigest,
		completedArms: 6 as const,
		maxActiveArms: 1 as const,
		providerCalls: q.providerCalls as number,
		retryWaits: q.retryWaits as number,
		sanitizedToolRejectionFacts: injected.diagnosticToolRejectionFacts.length,
		graphSynthesizedFailureCases: 2 as const,
		providerNetworkCalls: 0 as const,
		credentialReads: 0 as const,
		controlPlaneCalls: 0 as const,
		workspaceResidueCount: 0 as const,
		budgetRetrySemanticsInherited: true as const,
		realRejectionBijectionPassed: true as const,
		wrongToolSyntheticFailureWithoutProposalPassed: true as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return validateD782PreLiveQualification({
		...material,
		qualificationDigest: empiricalStrictJsonDigest(material),
	});
}

export function validateD782PreLiveQualification(value: unknown): D782PreLiveQualificationV1 {
	const candidate = record(value, "d782.preLive.qualification");
	exactKeys(
		candidate,
		[
			"budgetRetrySemanticsInherited",
			"causalAttribution",
			"completedArms",
			"controlPlaneCalls",
			"coordinatesDigest",
			"credentialReads",
			"d781ForensicArtifactSha256",
			"d781ForensicDigest",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"graphSynthesizedFailureCases",
			"implementationManifestDigest",
			"injectedGraphEvidenceDigest",
			"injectedRouteEvidenceDigest",
			"maxActiveArms",
			"providerCalls",
			"providerNetworkCalls",
			"qualificationDigest",
			"realRejectionBijectionPassed",
			"retryWaits",
			"sanitizedToolRejectionFacts",
			"schemaVersion",
			"workspaceResidueCount",
			"wrongToolSyntheticFailureWithoutProposalPassed",
		],
		"d782.preLive.qualification",
	);
	const { qualificationDigest, ...material } = candidate;
	literal(
		qualificationDigest,
		empiricalStrictJsonDigest(material),
		"d782.preLive.qualification.digest",
	);
	literal(candidate.schemaVersion, D782_PRE_LIVE_QUALIFICATION_SCHEMA, "d782.preLive.schema");
	literal(candidate.decisionRef, D782_DECISION_REF, "d782.preLive.decision");
	literal(candidate.decisionRevision, D782_DECISION_REVISION, "d782.preLive.revision");
	literal(candidate.coordinatesDigest, D782_COORDINATES_DIGEST, "d782.preLive.coordinates");
	literal(
		candidate.implementationManifestDigest,
		D782_IMPLEMENTATION_MANIFEST_DIGEST,
		"d782.preLive.implementation",
	);
	literal(
		candidate.d781ForensicArtifactSha256,
		D782_D781_FORENSIC_ARTIFACT_SHA256,
		"d782.preLive.forensicArtifact",
	);
	literal(candidate.d781ForensicDigest, D782_D781_FORENSIC_DIGEST, "d782.preLive.forensic");
	for (const key of ["injectedGraphEvidenceDigest", "injectedRouteEvidenceDigest"] as const)
		if (typeof candidate[key] !== "string" || !/^sha256:[0-9a-f]{64}$/.test(candidate[key]))
			throw new TypeError(`D782 ${key} is invalid`);
	for (const [key, expected] of [
		["completedArms", 6],
		["maxActiveArms", 1],
		["graphSynthesizedFailureCases", 2],
		["providerNetworkCalls", 0],
		["credentialReads", 0],
		["controlPlaneCalls", 0],
		["workspaceResidueCount", 0],
	] as const)
		literal(candidate[key], expected, `d782.preLive.${key}`);
	for (const [key, expected] of [
		["providerCalls", 60],
		["retryWaits", 6],
		["sanitizedToolRejectionFacts", 5],
	] as const)
		literal(candidate[key], expected, `d782.preLive.${key}`);
	for (const key of [
		"budgetRetrySemanticsInherited",
		"realRejectionBijectionPassed",
		"wrongToolSyntheticFailureWithoutProposalPassed",
	] as const)
		literal(candidate[key], true, `d782.preLive.${key}`);
	literal(candidate.causalAttribution, "undetermined", "d782.preLive.attribution");
	literal(candidate.efficacyClaim, "none", "d782.preLive.efficacy");
	return strictSnapshot(candidate) as unknown as D782PreLiveQualificationV1;
}
