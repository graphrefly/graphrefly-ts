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
	D781_COORDINATES_DIGEST,
	D781_D780_FORENSIC_ARTIFACT_SHA256,
	D781_D780_FORENSIC_DIGEST,
	D781_DECISION_REF,
	D781_DECISION_REVISION,
} from "./d781-coordinates.js";
import {
	isD781GraphSynthesizedToolFailureForTest,
	validateD781D780ForensicBytes,
	validateD781TaskToolFactsForTest,
	validateD781ToolRejectionFactsForTest,
} from "./d781-graph-native-live.js";
import {
	D781_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD781Implementation,
} from "./d781-implementation-manifest.js";

export const D781_PRE_LIVE_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d781.tool-failure-provenance-no-network-qualification.v1" as const;

export interface D781PreLiveQualificationV1 {
	readonly schemaVersion: typeof D781_PRE_LIVE_QUALIFICATION_SCHEMA;
	readonly decisionRef: typeof D781_DECISION_REF;
	readonly decisionRevision: typeof D781_DECISION_REVISION;
	readonly coordinatesDigest: string;
	readonly implementationManifestDigest: string;
	readonly d780ForensicArtifactSha256: string;
	readonly d780ForensicDigest: string;
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

export function createD781D780ForensicBytesForTest(): Uint8Array {
	const material = {
		schemaVersion: "graphrefly.b112.d780.post-run-validator-failure-forensic.v1",
		decisionRef: "decision.D780",
		decisionRevision: "2026-08-13.v1",
		status: "failed-post-run-validation",
		failurePhase: "post-run-canonical-bundle-validation",
		failureCode: "tool-rejection-failed-effect-coverage-drift",
		claimDigest: "sha256:c88b010dbb2b860bcbc03857f9d99ac0196f14ba43e81bac95992a06fedf6ff7",
		currentKeyAdmissionDigest:
			"sha256:0a00a9f822a44b5b0c34e9bb9c882a23d4f1fe4c49d12f5b2bc845ec9f9de305",
		pricingReadDigest: "sha256:828b694f928bc9b38920185b241e5be26d37e954f55827e2eddbd64836dccdae",
		zeroByokObservationDigest:
			"sha256:d681a75a6098bc98adb35e75540a81047948a5df12f10780a7f7f057254e8c67",
		implementationManifestDigest:
			"sha256:e4ba3a827f635aa9d9bbad6d21e8823e5be296ba66e6a26c346450fc11461a78",
		remainingMicrousdAtCurrentKeyAdmission: 17_921_611,
		providerActivityObserved: true,
		canonicalGraphEvidenceDisposition: "unavailable-process-exited-before-persistence",
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

export async function runD781InjectedNoNetworkQualification(inputValue: {
	readonly d780ForensicBytes: Uint8Array;
}): Promise<D781PreLiveQualificationV1> {
	const input = record(inputValue, "d781.preLive.input");
	exactKeys(input, ["d780ForensicBytes"], "d781.preLive.input");
	validateD781D780ForensicBytes(input.d780ForensicBytes as Uint8Array);
	literal(
		await measureD781Implementation(),
		D781_IMPLEMENTATION_MANIFEST_DIGEST,
		"d781.preLive.implementation",
	);
	const injected = validateD779QualificationBundle(
		await runD779InjectedNoNetworkQualification(createD779InjectedBaselineForTest()),
	);
	validateD781TaskToolFactsForTest({
		taskExposureFacts: injected.taskExposureFacts,
		toolRejectionFacts: injected.toolRejectionFacts,
		graphEvidence: injected.graphEvidence,
		routeEvidence: injected.routeEvidence,
	});
	validateD781ToolRejectionFactsForTest({
		toolRejectionFacts: injected.diagnosticToolRejectionFacts,
		graphEvidence: injected.toolRejectionGraphEvidence,
	});
	validateD781ToolRejectionFactsForTest({
		toolRejectionFacts: [],
		graphEvidence: injected.wrongToolGraphEvidence,
	});
	for (const cause of ["executor-threw", "graph-admission-denied"] as const) {
		const requestDigest = empiricalStrictJsonDigest({ cause });
		if (
			!isD781GraphSynthesizedToolFailureForTest({
				kind: "graph-effect-result-admitted",
				request: { effectKind: "tool-action", requestDigest },
				result: {
					effectKind: "tool-action",
					status: "failed",
					evidenceDigest: empiricalStrictJsonDigest({ requestDigest, cause }),
				},
			})
		)
			throw new TypeError(`D781 ${cause} classification did not qualify`);
	}
	const q = injected.qualification;
	literal(q.completedArms, 6, "d781.preLive.completedArms");
	literal(injected.graphEvidence.ledger.maxActiveArms, 1, "d781.preLive.maxActiveArms");
	literal(q.providerNetworkCalls, 0, "d781.preLive.providerNetworkCalls");
	literal(q.credentialReads, 0, "d781.preLive.credentialReads");
	literal(q.controlPlaneCalls, 0, "d781.preLive.controlPlaneCalls");
	literal(q.workspaceResidueCount, 0, "d781.preLive.workspaceResidueCount");
	literal(q.adapterSideLedgerCount, 0, "d781.preLive.adapterSideLedgerCount");
	literal(q.providerCalls, 60, "d781.preLive.providerCalls");
	literal(q.retryWaits, 6, "d781.preLive.retryWaits");
	literal(
		injected.diagnosticToolRejectionFacts.length,
		5,
		"d781.preLive.sanitizedToolRejectionFacts",
	);
	const material = strictSnapshot({
		schemaVersion: D781_PRE_LIVE_QUALIFICATION_SCHEMA,
		decisionRef: D781_DECISION_REF,
		decisionRevision: D781_DECISION_REVISION,
		coordinatesDigest: D781_COORDINATES_DIGEST,
		implementationManifestDigest: D781_IMPLEMENTATION_MANIFEST_DIGEST,
		d780ForensicArtifactSha256: D781_D780_FORENSIC_ARTIFACT_SHA256,
		d780ForensicDigest: D781_D780_FORENSIC_DIGEST,
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
	return validateD781PreLiveQualification({
		...material,
		qualificationDigest: empiricalStrictJsonDigest(material),
	});
}

export function validateD781PreLiveQualification(value: unknown): D781PreLiveQualificationV1 {
	const candidate = record(value, "d781.preLive.qualification");
	exactKeys(
		candidate,
		[
			"budgetRetrySemanticsInherited",
			"causalAttribution",
			"completedArms",
			"controlPlaneCalls",
			"coordinatesDigest",
			"credentialReads",
			"d780ForensicArtifactSha256",
			"d780ForensicDigest",
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
		"d781.preLive.qualification",
	);
	const { qualificationDigest, ...material } = candidate;
	literal(
		qualificationDigest,
		empiricalStrictJsonDigest(material),
		"d781.preLive.qualification.digest",
	);
	literal(candidate.schemaVersion, D781_PRE_LIVE_QUALIFICATION_SCHEMA, "d781.preLive.schema");
	literal(candidate.decisionRef, D781_DECISION_REF, "d781.preLive.decision");
	literal(candidate.decisionRevision, D781_DECISION_REVISION, "d781.preLive.revision");
	literal(candidate.coordinatesDigest, D781_COORDINATES_DIGEST, "d781.preLive.coordinates");
	literal(
		candidate.implementationManifestDigest,
		D781_IMPLEMENTATION_MANIFEST_DIGEST,
		"d781.preLive.implementation",
	);
	literal(
		candidate.d780ForensicArtifactSha256,
		D781_D780_FORENSIC_ARTIFACT_SHA256,
		"d781.preLive.forensicArtifact",
	);
	literal(candidate.d780ForensicDigest, D781_D780_FORENSIC_DIGEST, "d781.preLive.forensic");
	for (const key of ["injectedGraphEvidenceDigest", "injectedRouteEvidenceDigest"] as const)
		if (typeof candidate[key] !== "string" || !/^sha256:[0-9a-f]{64}$/.test(candidate[key]))
			throw new TypeError(`D781 ${key} is invalid`);
	for (const [key, expected] of [
		["completedArms", 6],
		["maxActiveArms", 1],
		["graphSynthesizedFailureCases", 2],
		["providerNetworkCalls", 0],
		["credentialReads", 0],
		["controlPlaneCalls", 0],
		["workspaceResidueCount", 0],
	] as const)
		literal(candidate[key], expected, `d781.preLive.${key}`);
	for (const [key, expected] of [
		["providerCalls", 60],
		["retryWaits", 6],
		["sanitizedToolRejectionFacts", 5],
	] as const)
		literal(candidate[key], expected, `d781.preLive.${key}`);
	for (const key of [
		"budgetRetrySemanticsInherited",
		"realRejectionBijectionPassed",
		"wrongToolSyntheticFailureWithoutProposalPassed",
	] as const)
		literal(candidate[key], true, `d781.preLive.${key}`);
	literal(candidate.causalAttribution, "undetermined", "d781.preLive.attribution");
	literal(candidate.efficacyClaim, "none", "d781.preLive.efficacy");
	return strictSnapshot(candidate) as unknown as D781PreLiveQualificationV1;
}
