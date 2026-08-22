import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import {
	createD44LiveExecutor,
	D44_BUGGY_ADMISSION_BLOCK,
	D44_D45_BASELINE_COMMIT,
	D44_FIXED_ADMISSION_BLOCK,
	runD44D45Measurement,
} from "./d44-d45-live-composition.js";
import { injectedProviderResponse } from "./d44-d45-live-qualification.js";
import {
	type D45CanonicalEvidenceV1,
	validateD45CanonicalEvidence,
} from "./d45-graph-tool-authority.js";
import {
	D61_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD61Implementation,
} from "./d61-implementation-manifest.js";
import {
	executeD61PublicSemanticScenarios,
	executeD63WithheldSemanticScenario,
} from "./d61-public-semantic-scenarios.js";
import {
	type D61QualificationBundleV1,
	runD61InjectedNoNetworkQualification,
	validateD61QualificationBundle,
} from "./d61-semantic-recovery-qualification.js";

export const D63_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d63.withheld-semantic-qualification.v1" as const;
export const D63_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d63.withheld-semantic-qualification-bundle.v1" as const;

export interface D63QualificationBundleV1 {
	readonly schemaVersion: typeof D63_QUALIFICATION_BUNDLE_SCHEMA;
	readonly d61Qualification: D61QualificationBundleV1;
	readonly d61QualificationDigest: string;
	readonly qualification: Readonly<{
		readonly schemaVersion: typeof D63_QUALIFICATION_SCHEMA;
		readonly decisionRef: "graphrefly-ts:D63";
		readonly d61ImplementationManifestDigest: string;
		readonly exactSixArmScenarios: 6;
		readonly currentSemanticImplementationPassed: true;
		readonly sourceTextIndependentAlternativePassed: true;
		readonly originalBugRejected: true;
		readonly publicFixtureSpecialCaseRejected: true;
		readonly publicFixtureSpecialCasePassedPublicCriteria: true;
		readonly defaultLiveWithheldWiringQualified: true;
		readonly exactLiveDeadlineQualified: true;
		readonly executorFailureAdmissionAndCleanupQualified: true;
		readonly snapshotOmissionReplayRejected: true;
		readonly snapshotSubstitutionReplayRejected: true;
		readonly withheldMaterialVisibleToProvider: false;
		readonly providerNetworkCalls: 0;
		readonly credentialReads: 0;
		readonly dispatchClaims: 0;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly qualificationDigest: string;
	}>;
	readonly bundleDigest: string;
}

const CANDIDATE_DIGEST = `sha256:${"e".repeat(64)}`;
const EQUIVALENT_ADMISSION_BLOCK = D44_FIXED_ADMISSION_BLOCK.replace(
	'assertBoundedAuthorityId(admissionProposalId, "admission proposal coordinate");',
	'assertBoundedAuthorityId(\n\t\tadmissionProposalId,\n\t\t"admission proposal coordinate",\n\t);',
);
if (EQUIVALENT_ADMISSION_BLOCK.includes(D44_FIXED_ADMISSION_BLOCK))
	throw new TypeError("D63 equivalent semantic fixture retained the retired exact source block");

async function withCandidate<T>(
	repositoryRoot: string,
	mutate: (source: string) => string,
	run: (workspaceRoot: string) => Promise<T>,
): Promise<T> {
	const workspaceRoot = await mkdtemp(join(tmpdir(), "graphrefly-d63-qualification-"));
	try {
		await mkdir(join(workspaceRoot, "packages/ts"), { recursive: true });
		await cp(join(repositoryRoot, "packages/ts/src"), join(workspaceRoot, "packages/ts/src"), {
			recursive: true,
		});
		await cp(
			join(repositoryRoot, "packages/ts/package.json"),
			join(workspaceRoot, "packages/ts/package.json"),
		);
		await cp(join(repositoryRoot, "package.json"), join(workspaceRoot, "package.json"));
		const target = join(workspaceRoot, "packages/ts/src/executors/managed-cloud-postgresql.ts");
		await writeFile(target, mutate(await readFile(target, "utf8")), "utf8");
		return await run(workspaceRoot);
	} finally {
		await rm(workspaceRoot, { recursive: true, force: true });
	}
}

async function withheld(workspaceRoot: string): Promise<boolean> {
	return (
		await executeD63WithheldSemanticScenario({
			workspaceRoot,
			workspaceStateDigest: CANDIDATE_DIGEST,
			writeScopePreserved: true,
			timeoutMs: 60_000,
		})
	).passed;
}

export async function qualifyD63WithheldSemanticOracle(): Promise<
	Readonly<{
		readonly currentSemanticImplementationPassed: true;
		readonly sourceTextIndependentAlternativePassed: true;
		readonly originalBugRejected: true;
		readonly publicFixtureSpecialCaseRejected: true;
		readonly publicFixtureSpecialCasePassedPublicCriteria: true;
	}>
> {
	const repositoryRoot = resolve(import.meta.dirname, "../../../..");
	const currentSemanticImplementationPassed = await withCandidate(
		repositoryRoot,
		(source) => source,
		withheld,
	);
	const sourceTextIndependentAlternativePassed = await withCandidate(
		repositoryRoot,
		(source) => source.replace(D44_FIXED_ADMISSION_BLOCK, EQUIVALENT_ADMISSION_BLOCK),
		withheld,
	);
	const originalBugRejected = !(await withCandidate(
		repositoryRoot,
		(source) => source.replace(D44_FIXED_ADMISSION_BLOCK, D44_BUGGY_ADMISSION_BLOCK),
		withheld,
	));
	const publicOnly = D44_FIXED_ADMISSION_BLOCK.replace(
		'assertBoundedAuthorityId(admissionProposalId, "admission proposal coordinate");',
		'if (admissionProposalId !== \'tool-provider-run-admission-proposal:["candidate:run:1"]\') assertSafe(admissionProposalId, "admission proposal coordinate");',
	);
	const specialCase = await withCandidate(
		repositoryRoot,
		(source) => source.replace(D44_FIXED_ADMISSION_BLOCK, publicOnly),
		async (workspaceRoot) => {
			const publicResult = await executeD61PublicSemanticScenarios({
				workspaceRoot,
				workspaceStateDigest: CANDIDATE_DIGEST,
				writeScopePreserved: true,
				timeoutMs: 60_000,
			});
			return Object.freeze({
				publicPassed: publicResult.observations.every((value) => value.passed),
				hiddenPassed: await withheld(workspaceRoot),
			});
		},
	);
	if (
		!currentSemanticImplementationPassed ||
		!sourceTextIndependentAlternativePassed ||
		!originalBugRejected ||
		!specialCase.publicPassed ||
		specialCase.hiddenPassed
	)
		throw new TypeError("D63 withheld semantic oracle did not distinguish behavior correctly");
	return Object.freeze({
		currentSemanticImplementationPassed: true,
		sourceTextIndependentAlternativePassed: true,
		originalBugRejected: true,
		publicFixtureSpecialCaseRejected: true,
		publicFixtureSpecialCasePassedPublicCriteria: true,
	});
}

async function qualifyD63ExecutorFailureAdmission(): Promise<true> {
	const repositoryRoot = resolve(import.meta.dirname, "../../../..");
	const materializationRoot = await mkdtemp(join(tmpdir(), "graphrefly-d63-executor-failure-"));
	const executor = createD44LiveExecutor({
		repositoryRoot,
		materializationRoot,
		baselineCommit: D44_D45_BASELINE_COMMIT,
		bearerToken: "injected-no-network",
		fetchImpl: async (_request, init) => injectedProviderResponse(init?.body),
		executePublicSemanticScenarios: async (input) =>
			Object.freeze({
				observations: Object.freeze([
					Object.freeze({ passed: true, causeCode: null }),
					Object.freeze({ passed: true, causeCode: null }),
					Object.freeze({ passed: true, causeCode: null }),
					Object.freeze({ passed: true, causeCode: null }),
				]),
				sourceSnapshotDigest: empiricalStrictJsonDigest({
					workspaceStateDigest: input.workspaceStateDigest,
					qualification: "D63 injected public semantic boundary",
				}),
			}),
		executeWithheldSemanticScenario: async () => {
			throw new TypeError("D63 injected withheld executor failure");
		},
	});
	try {
		const measurement = await runD44D45Measurement({ executor, injectedNoNetwork: true });
		if (measurement.disposition !== "success")
			throw new TypeError("D63 withheld executor failure did not remain Graph-owned");
		const relevant = measurement.evidence.lifecycle.arms.find(
			(arm) => arm.arm === "relevant-applied",
		);
		const hiddenAdmission = measurement.evidence.facts.find(
			(fact) =>
				fact.factKind === "effect-admitted" &&
				fact.effect.arm === "relevant-applied" &&
				fact.effect.sourceD43EffectKind === "hidden-verifier",
		);
		const hiddenResult =
			hiddenAdmission?.factKind === "effect-admitted"
				? measurement.evidence.facts.find(
						(fact) =>
							fact.factKind === "local-result" &&
							fact.effectDigest === hiddenAdmission.effect.effectDigest &&
							fact.result.outcome === "executor-failed" &&
							fact.result.sourceSnapshotDigest === null,
					)
				: undefined;
		if (
			measurement.evidence.exactSixArmsCompleted !== true ||
			relevant?.cleanupCompleted !== true ||
			relevant.evaluable !== false ||
			hiddenResult === undefined
		)
			throw new TypeError("D63 withheld executor failure admission or cleanup drifted");
		return true;
	} finally {
		await rm(materializationRoot, { recursive: true, force: true });
	}
}

function snapshotReplayRejected(
	evidence: D45CanonicalEvidenceV1,
	effectDigest: string,
	mutate: (result: Record<string, unknown>) => void,
): true {
	const candidate = structuredClone(evidence) as unknown as {
		facts: Array<{
			factKind: string;
			effectDigest?: string;
			result?: Record<string, unknown>;
		}>;
	};
	const fact = candidate.facts.find(
		(value) => value.factKind === "local-result" && value.effectDigest === effectDigest,
	);
	if (fact?.result === undefined) throw new TypeError("D63 hidden result fixture drifted");
	mutate(fact.result);
	try {
		validateD45CanonicalEvidence(candidate);
	} catch {
		return true;
	}
	throw new TypeError("D63 semantic snapshot replay mutation was accepted");
}

export async function runD63InjectedNoNetworkQualification(): Promise<D63QualificationBundleV1> {
	if ((await measureD61Implementation()) !== D61_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D63 D61 implementation closure drifted before qualification");
	const d61Qualification = validateD61QualificationBundle(
		await runD61InjectedNoNetworkQualification(),
	);
	const oracle = await qualifyD63WithheldSemanticOracle();
	const defaultEvidence = d61Qualification.realCompositionQualification.evidence;
	const defaultHiddenAdmission = defaultEvidence.facts.find(
		(fact) =>
			fact.factKind === "effect-admitted" &&
			fact.effect.arm === "relevant-applied" &&
			fact.effect.sourceD43EffectKind === "hidden-verifier",
	);
	const defaultHiddenResult =
		defaultHiddenAdmission?.factKind === "effect-admitted"
			? defaultEvidence.facts.find(
					(fact) =>
						fact.factKind === "local-result" &&
						fact.effectDigest === defaultHiddenAdmission.effect.effectDigest &&
						fact.result.outcome === "passed" &&
						fact.result.elapsedMs <=
							d61Qualification.realCompositionQualification.evidence.lifecycle.policy.campaign
								.localEffectReservationMs &&
						typeof fact.result.sourceSnapshotDigest === "string",
				)
			: undefined;
	if (defaultHiddenResult === undefined)
		throw new TypeError("D63 default live withheld semantic wiring was not qualified");
	if (defaultHiddenAdmission?.factKind !== "effect-admitted")
		throw new TypeError("D63 default hidden admission fixture drifted");
	const snapshotOmissionReplayRejected = snapshotReplayRejected(
		defaultEvidence,
		defaultHiddenAdmission.effect.effectDigest,
		(result) => {
			delete result.sourceSnapshotDigest;
		},
	);
	const snapshotSubstitutionReplayRejected = snapshotReplayRejected(
		defaultEvidence,
		defaultHiddenAdmission.effect.effectDigest,
		(result) => {
			result.sourceSnapshotDigest = `sha256:${"f".repeat(64)}`;
		},
	);
	await qualifyD63ExecutorFailureAdmission();
	const d61QualificationDigest = empiricalStrictJsonDigest(d61Qualification);
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D63_QUALIFICATION_SCHEMA,
		decisionRef: "graphrefly-ts:D63" as const,
		d61ImplementationManifestDigest: D61_IMPLEMENTATION_MANIFEST_DIGEST,
		exactSixArmScenarios: 6 as const,
		...oracle,
		defaultLiveWithheldWiringQualified: true as const,
		exactLiveDeadlineQualified: true as const,
		executorFailureAdmissionAndCleanupQualified: true as const,
		snapshotOmissionReplayRejected,
		snapshotSubstitutionReplayRejected,
		withheldMaterialVisibleToProvider: false as const,
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
		schemaVersion: D63_QUALIFICATION_BUNDLE_SCHEMA,
		d61Qualification,
		d61QualificationDigest,
		qualification,
	});
	return Object.freeze({
		...material,
		bundleDigest: empiricalStrictJsonDigest(material),
	}) as D63QualificationBundleV1;
}

export function validateD63QualificationBundle(value: unknown): D63QualificationBundleV1 {
	const candidate = record(value, "D63 qualification bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"d61Qualification",
			"d61QualificationDigest",
			"qualification",
			"schemaVersion",
		],
		"D63 qualification bundle",
	);
	const d61Qualification = validateD61QualificationBundle(candidate.d61Qualification);
	const qualification = record(candidate.qualification, "D63 qualification");
	exactKeys(
		qualification,
		[
			"causalAttribution",
			"credentialReads",
			"currentSemanticImplementationPassed",
			"d61ImplementationManifestDigest",
			"defaultLiveWithheldWiringQualified",
			"decisionRef",
			"dispatchClaims",
			"efficacyClaim",
			"exactSixArmScenarios",
			"exactLiveDeadlineQualified",
			"executorFailureAdmissionAndCleanupQualified",
			"originalBugRejected",
			"providerNetworkCalls",
			"publicFixtureSpecialCasePassedPublicCriteria",
			"publicFixtureSpecialCaseRejected",
			"qualificationDigest",
			"schemaVersion",
			"snapshotOmissionReplayRejected",
			"snapshotSubstitutionReplayRejected",
			"sourceTextIndependentAlternativePassed",
			"withheldMaterialVisibleToProvider",
		],
		"D63 qualification",
	);
	const { bundleDigest, ...material } = candidate;
	const { qualificationDigest, ...qualificationMaterial } = qualification;
	if (
		candidate.schemaVersion !== D63_QUALIFICATION_BUNDLE_SCHEMA ||
		qualification.schemaVersion !== D63_QUALIFICATION_SCHEMA ||
		qualification.decisionRef !== "graphrefly-ts:D63" ||
		qualification.d61ImplementationManifestDigest !== D61_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.exactSixArmScenarios !== 6 ||
		qualification.currentSemanticImplementationPassed !== true ||
		qualification.sourceTextIndependentAlternativePassed !== true ||
		qualification.originalBugRejected !== true ||
		qualification.publicFixtureSpecialCaseRejected !== true ||
		qualification.publicFixtureSpecialCasePassedPublicCriteria !== true ||
		qualification.defaultLiveWithheldWiringQualified !== true ||
		qualification.exactLiveDeadlineQualified !== true ||
		qualification.executorFailureAdmissionAndCleanupQualified !== true ||
		qualification.snapshotOmissionReplayRejected !== true ||
		qualification.snapshotSubstitutionReplayRejected !== true ||
		qualification.withheldMaterialVisibleToProvider !== false ||
		qualification.providerNetworkCalls !== 0 ||
		qualification.credentialReads !== 0 ||
		qualification.dispatchClaims !== 0 ||
		qualification.causalAttribution !== "undetermined" ||
		qualification.efficacyClaim !== "none" ||
		digest(candidate.d61QualificationDigest, "D63 D61 qualification digest") !==
			empiricalStrictJsonDigest(d61Qualification) ||
		qualificationDigest !== empiricalStrictJsonDigest(qualificationMaterial) ||
		bundleDigest !== empiricalStrictJsonDigest(material)
	)
		throw new TypeError("D63 qualification bundle drifted");
	return strictSnapshot(candidate) as unknown as D63QualificationBundleV1;
}
