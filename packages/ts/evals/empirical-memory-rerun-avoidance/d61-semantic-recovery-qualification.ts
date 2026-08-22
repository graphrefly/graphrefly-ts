import {
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import {
	D44_D45_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD44D45LiveImplementation,
} from "./d44-d45-live-implementation-manifest.js";
import {
	type D44D45LiveQualificationBundleV1,
	runD44D45InjectedNoNetworkQualification,
	validateD44D45QualificationBundle,
} from "./d44-d45-live-qualification.js";
import {
	type D45QualificationBundleV1,
	runD45InjectedNoNetworkQualification,
	validateD45QualificationBundle,
} from "./d45-graph-tool-qualification.js";
import {
	D45_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD45Implementation,
} from "./d45-implementation-manifest.js";
import {
	D55_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD55Implementation,
} from "./d55-provider-boundary-implementation-manifest.js";
import {
	runD55InjectedNoNetworkQualification,
	validateD55Qualification,
} from "./d55-provider-boundary-qualification.js";
import { qualifyD61PublicSemanticTruthTables } from "./d61-public-semantic-scenarios.js";

export const D61_QUALIFICATION_SCHEMA = "graphrefly-ts.d61.full-qualification.v1" as const;
export const D61_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d61.full-qualification-bundle.v1" as const;

export interface D61QualificationBundleV1 {
	readonly schemaVersion: typeof D61_QUALIFICATION_BUNDLE_SCHEMA;
	readonly graphToolQualification: D45QualificationBundleV1;
	readonly realCompositionQualification: D44D45LiveQualificationBundleV1;
	readonly providerBoundaryQualification: unknown;
	readonly graphToolQualificationDigest: string;
	readonly realCompositionQualificationDigest: string;
	readonly providerBoundaryQualificationDigest: string;
	readonly qualification: Readonly<{
		readonly schemaVersion: typeof D61_QUALIFICATION_SCHEMA;
		readonly decisionRef: "graphrefly-ts:D61";
		readonly graphToolImplementationManifestDigest: string;
		readonly liveImplementationManifestDigest: string;
		readonly providerBoundaryImplementationManifestDigest: string;
		readonly exactSixArmScenarios: 6;
		readonly independentPublicSemanticEvidenceQualified: true;
		readonly boundedFreshMutationCorrectionQualified: true;
		readonly providerBoundaryFailureClosureQualified: true;
		readonly realWorktreeSixArmsQualified: true;
		readonly providerNetworkCalls: 0;
		readonly credentialReads: 0;
		readonly dispatchClaims: 0;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly qualificationDigest: string;
	}>;
	readonly bundleDigest: string;
}

export async function runD61InjectedNoNetworkQualification(): Promise<D61QualificationBundleV1> {
	if (
		(await measureD45Implementation()) !== D45_IMPLEMENTATION_MANIFEST_DIGEST ||
		(await measureD44D45LiveImplementation()) !== D44_D45_LIVE_IMPLEMENTATION_MANIFEST_DIGEST ||
		(await measureD55Implementation()) !== D55_IMPLEMENTATION_MANIFEST_DIGEST
	)
		throw new TypeError("D61 current implementation closure drifted before qualification");
	const graphTool = validateD45QualificationBundle(await runD45InjectedNoNetworkQualification());
	const realComposition = validateD44D45QualificationBundle(
		await runD44D45InjectedNoNetworkQualification(),
	);
	const providerBoundary = validateD55Qualification(await runD55InjectedNoNetworkQualification());
	if (
		qualifyD61PublicSemanticTruthTables() !== true ||
		graphTool.qualification.independentPublicSemanticEvidenceQualified !== true ||
		realComposition.qualification.independentPublicSemanticEvidenceQualified !== true
	)
		throw new TypeError("D61 independent public semantic truth tables were not qualified");
	const graphToolQualificationDigest = empiricalStrictJsonDigest(graphTool);
	const realCompositionQualificationDigest = empiricalStrictJsonDigest(realComposition);
	const providerBoundaryQualificationDigest = empiricalStrictJsonDigest(providerBoundary);
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D61_QUALIFICATION_SCHEMA,
		decisionRef: "graphrefly-ts:D61" as const,
		graphToolImplementationManifestDigest: D45_IMPLEMENTATION_MANIFEST_DIGEST,
		liveImplementationManifestDigest: D44_D45_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
		providerBoundaryImplementationManifestDigest: D55_IMPLEMENTATION_MANIFEST_DIGEST,
		exactSixArmScenarios: 6 as const,
		independentPublicSemanticEvidenceQualified: true as const,
		boundedFreshMutationCorrectionQualified: true as const,
		providerBoundaryFailureClosureQualified: true as const,
		realWorktreeSixArmsQualified: true as const,
		providerNetworkCalls: 0 as const,
		credentialReads: 0 as const,
		dispatchClaims: 0 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = Object.freeze({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D61_QUALIFICATION_BUNDLE_SCHEMA,
		graphToolQualification: graphTool,
		realCompositionQualification: realComposition,
		providerBoundaryQualification: providerBoundary,
		graphToolQualificationDigest,
		realCompositionQualificationDigest,
		providerBoundaryQualificationDigest,
		qualification,
	});
	return Object.freeze({
		...material,
		bundleDigest: empiricalStrictJsonDigest(material),
	}) as D61QualificationBundleV1;
}

export function validateD61QualificationBundle(value: unknown): D61QualificationBundleV1 {
	const candidate = record(value, "D61 qualification bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"graphToolQualification",
			"graphToolQualificationDigest",
			"providerBoundaryQualification",
			"providerBoundaryQualificationDigest",
			"qualification",
			"realCompositionQualification",
			"realCompositionQualificationDigest",
			"schemaVersion",
		],
		"D61 qualification bundle",
	);
	const graphTool = validateD45QualificationBundle(
		candidate.graphToolQualification as D45QualificationBundleV1,
	);
	const realComposition = validateD44D45QualificationBundle(
		candidate.realCompositionQualification as D44D45LiveQualificationBundleV1,
	);
	const providerBoundary = validateD55Qualification(candidate.providerBoundaryQualification);
	const qualificationCandidate = record(candidate.qualification, "D61 qualification");
	exactKeys(
		qualificationCandidate,
		[
			"boundedFreshMutationCorrectionQualified",
			"causalAttribution",
			"credentialReads",
			"decisionRef",
			"dispatchClaims",
			"efficacyClaim",
			"exactSixArmScenarios",
			"graphToolImplementationManifestDigest",
			"independentPublicSemanticEvidenceQualified",
			"liveImplementationManifestDigest",
			"providerBoundaryFailureClosureQualified",
			"providerBoundaryImplementationManifestDigest",
			"providerNetworkCalls",
			"qualificationDigest",
			"realWorktreeSixArmsQualified",
			"schemaVersion",
		],
		"D61 qualification",
	);
	const { bundleDigest, ...material } = candidate;
	const { qualificationDigest, ...qualificationMaterial } = qualificationCandidate;
	if (
		candidate.schemaVersion !== D61_QUALIFICATION_BUNDLE_SCHEMA ||
		qualificationCandidate.schemaVersion !== D61_QUALIFICATION_SCHEMA ||
		qualificationCandidate.decisionRef !== "graphrefly-ts:D61" ||
		qualificationCandidate.graphToolImplementationManifestDigest !==
			D45_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualificationCandidate.liveImplementationManifestDigest !==
			D44_D45_LIVE_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualificationCandidate.providerBoundaryImplementationManifestDigest !==
			D55_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualificationCandidate.exactSixArmScenarios !== 6 ||
		qualificationCandidate.independentPublicSemanticEvidenceQualified !== true ||
		qualificationCandidate.boundedFreshMutationCorrectionQualified !== true ||
		qualificationCandidate.providerBoundaryFailureClosureQualified !== true ||
		qualificationCandidate.realWorktreeSixArmsQualified !== true ||
		qualificationCandidate.providerNetworkCalls !== 0 ||
		qualificationCandidate.credentialReads !== 0 ||
		qualificationCandidate.dispatchClaims !== 0 ||
		qualificationCandidate.causalAttribution !== "undetermined" ||
		qualificationCandidate.efficacyClaim !== "none" ||
		digest(candidate.graphToolQualificationDigest, "D61 graph tool digest") !==
			empiricalStrictJsonDigest(graphTool) ||
		digest(candidate.realCompositionQualificationDigest, "D61 composition digest") !==
			empiricalStrictJsonDigest(realComposition) ||
		digest(candidate.providerBoundaryQualificationDigest, "D61 provider boundary digest") !==
			empiricalStrictJsonDigest(providerBoundary) ||
		qualificationDigest !== empiricalStrictJsonDigest(qualificationMaterial) ||
		bundleDigest !== empiricalStrictJsonDigest(material)
	)
		throw new TypeError("D61 qualification bundle drifted");
	return strictSnapshot(candidate) as unknown as D61QualificationBundleV1;
}
