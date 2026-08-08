import { spawn } from "node:child_process";
import {
	chmod,
	lstat,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	commitSha,
	coordinate,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	fail,
	literal,
	record,
	safeInteger,
	strictSnapshot,
	string,
} from "./canonical.js";
import {
	buildD689OfflineEvidence,
	createD689PrivateMaterialProtectionBundle,
	D689_PAIR_QUALIFICATION_VERSION,
	D689_TRANSFER_MEMORY_VERSION,
	type D689PairQualificationV1,
	type D689PrivateMaterialProtectionBundleV1,
	type D689ProtectedMaterialClass,
	type D689TransferMemoryV1,
	qualifyD689TransferMemory,
	validateD689TransferMemory,
} from "./cross-work-item-memory-transfer.js";
import {
	type HistoryFreeSingleBaselineRepositoryMaterializationV1,
	materializeHistoryFreeSingleBaselineRepository,
	type SingleBaselineWorkspaceAllocationV1,
	type SingleBaselineWorkspaceAllocatorCapabilityV1,
} from "./single-baseline-repository-node.js";

export const D690_HISTORICAL_PAIR_EVIDENCE_VERSION =
	"graphrefly.private-solution-eval.d690-historical-pair-offline-evidence.v1" as const;
export const D690_CLAIM_BOUNDARY =
	"historical-cross-work-item-transfer-offline-no-efficacy-claim" as const;
export const D690_FAILURE_MECHANISM_REF =
	"producer-owned-canonical-admission-provenance-consumer-local-grammar.v1" as const;
export const D690_FAILURE_MECHANISM_REVISION =
	"producer-owned-canonical-admission-provenance-consumer-local-grammar.2026-08-07.v1" as const;

export const D690_SOURCE = Object.freeze({
	taskRef: "canonical-managed-compute-admission-ref",
	observationDigest: "sha256:b499de6e20118b17384c091ad4576838102ef21f345c0f4a44db5489b9ae1b87",
	runDigest: "sha256:a2f6c4cd6142fa354d9bb518e45c9935f079f1e5ad23a00fd99e19856702c96a",
	actionTraceDigest: "sha256:4becd0524dc3bbdf5e2768ffac8572a04870ee1aea71b5ce8c5b1e35cbfeca44",
	mutationEvidenceDigest: "sha256:2db25b625c5387afb15576363b3bdae98f36b3f8722de4c09fb02069eb026544",
	verifierRef: "verifier-profile.canonical-managed-compute-admission-ref",
	verifierRevision: "b112-exact-five-verifier-profile.v1",
	verifierEvidenceDigest: "sha256:f5ec8ecfd35c529cf19a3c504b7b69ce00f144be7feedc7ab3b8e1554faec1c9",
	fileIdentityDigest: empiricalStrictJsonDigest({
		kind: "d690-file-identity.v1",
		path: "packages/ts/src/executors/managed-untrusted-js-compute.ts",
	}),
	symbolIdentityDigest: empiricalStrictJsonDigest({
		kind: "d690-symbol-identity.v1",
		symbols: ["admit"],
	}),
	testIdentityDigest: "sha256:b9d47b0ac96c4de264c9a1143763805a0243f4734a9d7fbea7bb6ad9af54aa72",
	expectedMaterialIdentityDigest:
		"sha256:20c80bf8da0ece8558332ee6ff3345a9eb60a3f981f96949e9c4d18907aae533",
});

const D690_TARGET = Object.freeze({
	taskRef: "managed-cloud-postgresql-canonical-admission-proposal-ref",
	preFixCommitSha: "1682838831f66637317d2460d1496a6f8848204b",
	preFixTreeObjectId: "111c265403508fa0dc85c03032e2edd987ba7909",
	fixedCommitSha: "058bf087907512ca85c265d80b44be80d2baa90b",
	fixedTreeObjectId: "86f6fb90e583f1a1b1615d01757b45309822e6b5",
	fileIdentityDigest: empiricalStrictJsonDigest({
		kind: "d690-file-identity.v1",
		path: "packages/ts/src/executors/managed-cloud-postgresql.ts",
	}),
	symbolIdentityDigest: empiricalStrictJsonDigest({
		kind: "d690-symbol-identity.v1",
		symbols: [
			"admittedEnvelope",
			"refs",
			"snapshotAuthorizationRecheckResult",
			"snapshotAdmittedEnvelope",
		],
	}),
	testIdentityDigest: "sha256:bdeb9d023afd9d314e399c2f280359e783ea15f24bc89c854e9c4cfc4f0c4e44",
	expectedMaterialIdentityDigest:
		"sha256:095d363bcdfd972eeb33bd77bda7ce73ce260c0bf8ceaa3c62f33269f2dfc236",
});

const D690_TARGET_VERIFIER = Object.freeze({
	verifierRef: "verifier.d690.managed-cloud-postgresql-canonical-admission",
	verifierRevision: "verifier.d690.managed-cloud-postgresql-canonical-admission.v1",
	hiddenFixtureDigest: D690_TARGET.testIdentityDigest,
});

export const D690_TARGET_TASK_REF = D690_TARGET.taskRef;

export interface D690HistoricalTargetOperatorCapabilityV1 {
	readonly revision: "d690-historical-target-operator.2026-08-07.v1";
	readonly taskRef: typeof D690_TARGET.taskRef;
	readonly sourceCommitSha: string;
	readonly sourceTreeObjectId: string;
	readonly verifierRef: string;
	readonly verifierRevision: string;
	readonly hiddenFixtureDigest: string;
	readonly verifierToolchainBindingDigest: string;
	createMaterialization(
		signal: AbortSignal,
	): Promise<HistoryFreeSingleBaselineRepositoryMaterializationV1>;
	verify(input: { readonly actorWorkspaceRoot: string; readonly signal: AbortSignal }): Promise<{
		readonly verdict: "passed" | "failed" | "unverifiable";
		readonly evidenceDigest: string;
		readonly networkCallCount: 0;
	}>;
}

const REQUIRED_PROTECTED_MATERIAL_CLASSES = Object.freeze([
	"credential",
	"environment",
	"private-workspace",
	"source-raw-code-or-patch",
	"target-expected-material",
] as const satisfies readonly D689ProtectedMaterialClass[]);

const VERIFIER_CASES = Object.freeze([
	"target-baseline-rejected",
	"target-fixed-accepted",
] as const);

type D690VerifierCaseKind = (typeof VERIFIER_CASES)[number];
type D690VerifierObservation = "accepted" | "rejected" | "non-evaluable";

const TARGET_TEST_PATH = "packages/ts/src/__tests__/managed-cloud-postgresql.test.ts";
const TARGET_FOCUSED_TEST_NAME =
	"admits only a fresh D419 managed remote run, then atomically claims with a fresh fenced session";
const D690_REPOSITORY_ROOT = resolve(import.meta.dirname, "../../../..");
const D690_NETWORK_SANDBOX_EXECUTABLE = "/usr/bin/sandbox-exec";
const D690_NETWORK_SANDBOX_PROFILE = "(version 1)\n(allow default)\n(deny network*)\n";
const D690_EXPECTED_LOCKFILE_DIGEST =
	"sha256:d45eaf9f7207ecf19c4b78403f8feee2983605ade4481aefad874cf41d71c485";
const D690_EXPECTED_VITEST_ENTRY_DIGEST =
	"sha256:39db22f579acf5639bbb17a261408debbde03f4692c0c439e77e7f13aeba74d6";
const D690_EXPECTED_VERIFIER_RUNTIME_CLOSURE_DIGEST =
	"sha256:11db170110d6a14790c026345b3fd546f1fb3f992767f398c36665716ff47954";
const D690_EXPECTED_VERIFIER_RUNTIME_CLOSURE_PACKAGE_COUNT = 149;
const D690_REQUIRED_VERIFIER_RUNTIME_PACKAGE_REF = "strip-literal@3.1.0";
const D690_ALLOWED_NODE_TOOLCHAINS = Object.freeze([
	Object.freeze({
		nodeVersion: "24.18.0",
		nodeExecutableDigest: "sha256:ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a",
		bindingDigest: "sha256:6f1dbd81e664053f8858c98e00619d5850adc1653f44032fcb2165b061dab3c0",
	}),
	Object.freeze({
		nodeVersion: "26.4.0",
		nodeExecutableDigest: "sha256:59cd4fb59cf5bc239f43d5db8c0cd8c23c22db79419612b92da3b7cf34de8553",
		bindingDigest: "sha256:a6207f4c52dc61dcfdf94ead3dfaa264e071613c7a2b952d899ae59ea93e6dd7",
	}),
]);
const D690_PROTECTION_COORDINATES = Object.freeze({
	policyRef: "policy.d690.private-material",
	policyRevision: "policy.d690.private-material.v1",
	capabilityRef: "capability.d690.private-material",
	capabilityRevision: "capability.d690.private-material.2026-08-07.v1",
});
const D690_PROTECTED_NEEDLES = Object.freeze({
	credential: Object.freeze(["sk-d690-offline-credential-sentinel"]),
	environment: Object.freeze(["D690_OFFLINE_ENVIRONMENT_SENTINEL"]),
	"private-workspace": Object.freeze(["graphrefly-d690-baseline-", "graphrefly-d690-fixed-"]),
	"source-raw-code-or-patch": Object.freeze([
		'source.kind === "admission"',
		'source.kind === "tool-provider-run-admission"',
	]),
	"target-expected-material": Object.freeze([
		"parseCanonicalTupleKey",
		D690_TARGET.fixedCommitSha,
		D690_TARGET.fixedTreeObjectId,
		TARGET_FOCUSED_TEST_NAME,
		"canonicalAdmissionProposalId = compoundTupleKey",
		"const malformedProposalId =",
		"safeSourceRefId(value: string, depth = 0)",
		"assertBoundedAuthorityId(admissionProposalId",
		"assertAuthorizationAuthorityId(raw.admissionProposalId",
		"assertNoPrivateAuthorizationTerm(value);",
	]),
} as const satisfies Readonly<Record<D689ProtectedMaterialClass, readonly string[]>>);
const D690_EXPECTED_TRANSFER_MEMORY_DIGEST =
	"sha256:1118302a3b4279eca5b534fa0c4768556445a49a4aeeec383a35db2382c09f3e";
const D690_INDEPENDENT_PAIR_ANALYSIS_DIGEST =
	"sha256:3bbe5205ef19510592b68cb8315908fdf8f7bb2aae25851280c08b1d51cf6368";
const D690_INDEPENDENT_SAME_MECHANISM_EVIDENCE_DIGEST =
	"sha256:1b4744ccb0996cae806f8a27fa29905e77b3caeafac4f7a9ad85901e4c5268e1";
const D690_INDEPENDENT_ACTIONABILITY_EVIDENCE_DIGEST =
	"sha256:1cc37653c7ebc2e74999ea2462d7bd676ef71d9ad81ffc7d181a49fd7fcced7e";
const D690_EXPECTED_PRIVATE_MATERIAL_PROTECTED_SET_BINDING_DIGEST =
	"sha256:3f88d0835234371d4b53631e4dd5117bdcb774cccc467be8b5f21c70b8ba0f13";

export interface D690SourceSuccessEvidenceV1 {
	readonly schemaVersion: "graphrefly.private-solution-eval.d690-source-success-evidence.v1";
	readonly observationDigest: string;
	readonly taskRef: string;
	readonly runDigest: string;
	readonly actionTraceDigest: string;
	readonly mutationEvidenceDigest: string;
	readonly verifierRef: string;
	readonly verifierRevision: string;
	readonly verifierEvidenceDigest: string;
	readonly classification: "complete";
	readonly verifierStatus: "passed";
	readonly workspaceChanged: true;
	readonly historicalEvidenceRewritten: false;
}

export interface D690HistoricalPairOfflineEvidenceV1 {
	readonly version: typeof D690_HISTORICAL_PAIR_EVIDENCE_VERSION;
	readonly claimBoundary: typeof D690_CLAIM_BOUNDARY;
	readonly efficacyClaim: "none";
	readonly sourceTaskRef: typeof D690_SOURCE.taskRef;
	readonly targetTaskRef: typeof D690_TARGET.taskRef;
	readonly failureMechanismRef: typeof D690_FAILURE_MECHANISM_REF;
	readonly sourceObservationDigest: string;
	readonly targetMaterializationEvidenceDigest: string;
	readonly verifierCalibrationDigest: string;
	readonly verifierToolchainBindingDigest: string;
	readonly verifierRuntimeClosurePackageCount: number;
	readonly networkIsolationProfile: "macos-sandbox-exec-deny-network.v1";
	readonly transferMemoryDigest: string;
	readonly pairQualificationDigest: string;
	readonly d689OfflineEvidenceDigest: string;
	readonly d689OfflineCaseCount: number;
	readonly privateMaterialProtectionSetBindingDigest: string;
	readonly leakageProbeSetDigest: string;
	readonly protectionCoverageClaim: "exact-frozen-needle-set-plus-exact-memory-digest";
	readonly protectedLeakageClassCount: 5;
	readonly historyFreeTargetQualified: true;
	readonly hiddenVerifierQualified: true;
	readonly preProviderQualityGatePassed: true;
	readonly providerCallCount: 0;
	readonly networkCallCount: 0;
	readonly chargedCostMicrousd: 0;
	readonly historicalEvidenceRewritten: false;
	readonly naturalChronologyClaimed: false;
	readonly targetExpectedMaterialPersisted: false;
	readonly publicExportDelta: false;
	readonly evidenceDigest: string;
}

export async function runD690HistoricalPairOfflineQualification(input: {
	readonly sourceEvidence: unknown;
	readonly signal: AbortSignal;
}): Promise<D690HistoricalPairOfflineEvidenceV1> {
	const candidate = record(input, "d690.input");
	exactKeys(candidate, ["signal", "sourceEvidence"], "d690.input");
	const signal = candidate.signal as AbortSignal;
	if (!(signal instanceof AbortSignal)) {
		fail("d690.input.signal", "expected AbortSignal");
	}
	assertNotCancelled(signal);
	const source = validateSourceSuccessEvidence(candidate.sourceEvidence);
	const sealedTarget = await materializeAndCalibrateExactD690Target(signal);
	const targetMaterialization = validateTargetMaterializationEvidence(
		sealedTarget.baselineMaterializationEvidence,
	);
	const verifierCalibration = sealedTarget.verifierCalibration;
	const privateMaterialProtection = createExactD690PrivateMaterialProtection();
	const transferMemory = createD690HistoricalTransferMemory();
	const pairQualification = d690PairQualification({
		memory: transferMemory,
		targetMaterializationEvidence: targetMaterialization,
		verifierCalibration,
		privateMaterialProtection,
	});
	const report = qualifyD689TransferMemory({
		memory: transferMemory,
		pairQualification,
		privateMaterialProtection,
	});
	if (!report.preProviderQualityGatePassed || report.issueCodes.length !== 0) {
		fail("d690.qualityReport", "historical pair did not pass the D689 pre-provider gate");
	}

	const leakageCases = createExactD690LeakageNegativeMemories(transferMemory);
	for (const leakageCase of leakageCases) {
		const rejected = qualifyD689TransferMemory({
			memory: leakageCase.memory,
			pairQualification,
			privateMaterialProtection,
		});
		if (
			rejected.preProviderQualityGatePassed ||
			!rejected.issueCodes.includes("memory-protection-blocked")
		) {
			fail(
				`d690.leakageNegativeMemories.${leakageCase.materialClass}`,
				"did not prove fail-closed private-material rejection",
			);
		}
	}

	const offlineEvidence = buildD689OfflineEvidence([
		{
			caseRef: "d690.actual-pair.pass",
			expectedDisposition: "pass",
			memory: transferMemory,
			pairQualification,
			privateMaterialProtection,
		},
		{
			caseRef: "d690.mechanism-mismatch.reject",
			expectedDisposition: "reject",
			memory: transferMemory,
			pairQualification: {
				...pairQualification,
				targetFailureMechanismRef: "unrelated-target-mechanism.v1",
			},
			privateMaterialProtection,
		},
		{
			caseRef: "d690.source-verifier-failed.reject",
			expectedDisposition: "reject",
			memory: transferMemory,
			pairQualification: {
				...pairQualification,
				source: { ...pairQualification.source, verifierStatus: "failed" },
			},
			privateMaterialProtection,
		},
		{
			caseRef: "d690.target-history-exposed.reject",
			expectedDisposition: "reject",
			memory: transferMemory,
			pairQualification: {
				...pairQualification,
				target: { ...pairQualification.target, historyStatus: "history-exposed" },
			},
			privateMaterialProtection,
		},
		...leakageCases.map((leakageCase) => ({
			caseRef: `d690.private-${leakageCase.materialClass}.reject`,
			expectedDisposition: "reject" as const,
			memory: leakageCase.memory,
			pairQualification,
			privateMaterialProtection,
		})),
	]);
	assertNotCancelled(signal);

	const material = strictSnapshot({
		version: D690_HISTORICAL_PAIR_EVIDENCE_VERSION,
		claimBoundary: D690_CLAIM_BOUNDARY,
		efficacyClaim: "none" as const,
		sourceTaskRef: D690_SOURCE.taskRef,
		targetTaskRef: D690_TARGET.taskRef,
		failureMechanismRef: D690_FAILURE_MECHANISM_REF,
		sourceObservationDigest: source.observationDigest,
		targetMaterializationEvidenceDigest: empiricalStrictJsonDigest(targetMaterialization),
		verifierCalibrationDigest: verifierCalibration.calibrationDigest,
		verifierToolchainBindingDigest: verifierCalibration.verifierToolchainBindingDigest,
		verifierRuntimeClosurePackageCount: verifierCalibration.verifierRuntimeClosurePackageCount,
		networkIsolationProfile: "macos-sandbox-exec-deny-network.v1" as const,
		transferMemoryDigest: empiricalStrictJsonDigest(transferMemory),
		pairQualificationDigest: empiricalStrictJsonDigest(pairQualification),
		d689OfflineEvidenceDigest: offlineEvidence.evidenceDigest,
		d689OfflineCaseCount: offlineEvidence.caseCount,
		privateMaterialProtectionSetBindingDigest: privateMaterialProtection.protectedSetBindingDigest,
		leakageProbeSetDigest: empiricalStrictJsonDigest(
			leakageCases.map(({ materialClass, probeBindingDigest }) => ({
				materialClass,
				probeBindingDigest,
			})),
		),
		protectionCoverageClaim: "exact-frozen-needle-set-plus-exact-memory-digest" as const,
		protectedLeakageClassCount: 5 as const,
		historyFreeTargetQualified: true as const,
		hiddenVerifierQualified: true as const,
		preProviderQualityGatePassed: true as const,
		providerCallCount: 0 as const,
		networkCallCount: 0 as const,
		chargedCostMicrousd: 0 as const,
		historicalEvidenceRewritten: false as const,
		naturalChronologyClaimed: false as const,
		targetExpectedMaterialPersisted: false as const,
		publicExportDelta: false as const,
	});
	return strictSnapshot({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

function validateSourceSuccessEvidence(value: unknown): D690SourceSuccessEvidenceV1 {
	const source = record(value, "d690.sourceEvidence");
	exactKeys(
		source,
		[
			"actionTraceDigest",
			"classification",
			"historicalEvidenceRewritten",
			"mutationEvidenceDigest",
			"observationDigest",
			"runDigest",
			"schemaVersion",
			"taskRef",
			"verifierEvidenceDigest",
			"verifierRef",
			"verifierRevision",
			"verifierStatus",
			"workspaceChanged",
		],
		"d690.sourceEvidence",
	);
	const validated = strictSnapshot({
		schemaVersion: literal(
			source.schemaVersion,
			"graphrefly.private-solution-eval.d690-source-success-evidence.v1",
			"d690.sourceEvidence.schemaVersion",
		),
		observationDigest: digest(source.observationDigest, "d690.sourceEvidence.observationDigest"),
		taskRef: coordinate(source.taskRef, "d690.sourceEvidence.taskRef"),
		runDigest: digest(source.runDigest, "d690.sourceEvidence.runDigest"),
		actionTraceDigest: digest(source.actionTraceDigest, "d690.sourceEvidence.actionTraceDigest"),
		mutationEvidenceDigest: digest(
			source.mutationEvidenceDigest,
			"d690.sourceEvidence.mutationEvidenceDigest",
		),
		verifierRef: coordinate(source.verifierRef, "d690.sourceEvidence.verifierRef"),
		verifierRevision: coordinate(source.verifierRevision, "d690.sourceEvidence.verifierRevision"),
		verifierEvidenceDigest: digest(
			source.verifierEvidenceDigest,
			"d690.sourceEvidence.verifierEvidenceDigest",
		),
		classification: literal(
			source.classification,
			"complete",
			"d690.sourceEvidence.classification",
		),
		verifierStatus: literal(source.verifierStatus, "passed", "d690.sourceEvidence.verifierStatus"),
		workspaceChanged: literal(
			source.workspaceChanged,
			true,
			"d690.sourceEvidence.workspaceChanged",
		),
		historicalEvidenceRewritten: literal(
			source.historicalEvidenceRewritten,
			false,
			"d690.sourceEvidence.historicalEvidenceRewritten",
		),
	});
	for (const [key, expected] of Object.entries({
		observationDigest: D690_SOURCE.observationDigest,
		taskRef: D690_SOURCE.taskRef,
		runDigest: D690_SOURCE.runDigest,
		actionTraceDigest: D690_SOURCE.actionTraceDigest,
		mutationEvidenceDigest: D690_SOURCE.mutationEvidenceDigest,
		verifierRef: D690_SOURCE.verifierRef,
		verifierRevision: D690_SOURCE.verifierRevision,
		verifierEvidenceDigest: D690_SOURCE.verifierEvidenceDigest,
	})) {
		if (validated[key as keyof typeof validated] !== expected) {
			fail(`d690.sourceEvidence.${key}`, "does not match the frozen v14 source success");
		}
	}
	return validated as D690SourceSuccessEvidenceV1;
}

function validateTargetMaterializationEvidence(value: unknown) {
	const evidence = record(value, "d690.targetMaterializationEvidence");
	exactKeys(
		evidence,
		[
			"actorCommitSha",
			"actorGitTreeObjectId",
			"actorTreeDigest",
			"commitCount",
			"entryCount",
			"fullFilesystemMatch",
			"gitProcessCount",
			"originalTreeDigest",
			"overlayDigest",
			"overlayVisibleAsDiff",
			"parentCount",
			"reflogs",
			"remotes",
			"repositoryRef",
			"repositoryState",
			"schemaVersion",
			"sharedObjectStore",
			"sourceCommitSha",
			"sourceHistoryVisible",
			"sourceTreeObjectId",
			"totalBytes",
			"unreachableObjects",
		],
		"d690.targetMaterializationEvidence",
	);
	const validated = strictSnapshot({
		schemaVersion: literal(
			evidence.schemaVersion,
			"graphrefly.private-solution-eval.single-baseline-repository-evidence.v1",
			"d690.targetMaterializationEvidence.schemaVersion",
		),
		repositoryRef: literal(
			evidence.repositoryRef,
			"graphrefly-ts",
			"d690.targetMaterializationEvidence.repositoryRef",
		),
		sourceCommitSha: commitSha(
			evidence.sourceCommitSha,
			"d690.targetMaterializationEvidence.sourceCommitSha",
		),
		sourceTreeObjectId: commitSha(
			evidence.sourceTreeObjectId,
			"d690.targetMaterializationEvidence.sourceTreeObjectId",
		),
		originalTreeDigest: digest(
			evidence.originalTreeDigest,
			"d690.targetMaterializationEvidence.originalTreeDigest",
		),
		actorTreeDigest: digest(
			evidence.actorTreeDigest,
			"d690.targetMaterializationEvidence.actorTreeDigest",
		),
		overlayDigest: literal(
			evidence.overlayDigest,
			null,
			"d690.targetMaterializationEvidence.overlayDigest",
		),
		actorGitTreeObjectId: commitSha(
			evidence.actorGitTreeObjectId,
			"d690.targetMaterializationEvidence.actorGitTreeObjectId",
		),
		actorCommitSha: commitSha(
			evidence.actorCommitSha,
			"d690.targetMaterializationEvidence.actorCommitSha",
		),
		entryCount: safeInteger(evidence.entryCount, "d690.targetMaterializationEvidence.entryCount", {
			min: 1,
		}),
		totalBytes: safeInteger(evidence.totalBytes, "d690.targetMaterializationEvidence.totalBytes", {
			min: 1,
		}),
		gitProcessCount: safeInteger(
			evidence.gitProcessCount,
			"d690.targetMaterializationEvidence.gitProcessCount",
			{ min: 1 },
		),
		repositoryState: literal(
			evidence.repositoryState,
			"clean-single-baseline",
			"d690.targetMaterializationEvidence.repositoryState",
		),
		commitCount: literal(evidence.commitCount, 1, "d690.targetMaterializationEvidence.commitCount"),
		parentCount: literal(evidence.parentCount, 0, "d690.targetMaterializationEvidence.parentCount"),
		remotes: literal(evidence.remotes, 0, "d690.targetMaterializationEvidence.remotes"),
		reflogs: literal(evidence.reflogs, 0, "d690.targetMaterializationEvidence.reflogs"),
		unreachableObjects: literal(
			evidence.unreachableObjects,
			0,
			"d690.targetMaterializationEvidence.unreachableObjects",
		),
		sharedObjectStore: literal(
			evidence.sharedObjectStore,
			false,
			"d690.targetMaterializationEvidence.sharedObjectStore",
		),
		fullFilesystemMatch: literal(
			evidence.fullFilesystemMatch,
			true,
			"d690.targetMaterializationEvidence.fullFilesystemMatch",
		),
		sourceHistoryVisible: literal(
			evidence.sourceHistoryVisible,
			false,
			"d690.targetMaterializationEvidence.sourceHistoryVisible",
		),
		overlayVisibleAsDiff: literal(
			evidence.overlayVisibleAsDiff,
			false,
			"d690.targetMaterializationEvidence.overlayVisibleAsDiff",
		),
	});
	if (
		validated.sourceCommitSha !== D690_TARGET.preFixCommitSha ||
		validated.sourceTreeObjectId !== D690_TARGET.preFixTreeObjectId ||
		validated.actorGitTreeObjectId !== D690_TARGET.preFixTreeObjectId ||
		validated.originalTreeDigest !== validated.actorTreeDigest
	) {
		fail(
			"d690.targetMaterializationEvidence",
			"does not prove the exact unchanged D690 history-free target baseline",
		);
	}
	return validated;
}

async function materializeAndCalibrateExactD690Target(signal: AbortSignal) {
	const baseline = await materializeHistoryFreeSingleBaselineRepository(
		{ repositoryRef: "graphrefly-ts", rootPath: D690_REPOSITORY_ROOT },
		createD690WorkspaceAllocator("baseline"),
		{
			sourceCommitSha: D690_TARGET.preFixCommitSha,
			sourceTreeObjectId: D690_TARGET.preFixTreeObjectId,
			overlay: null,
			signal,
		},
	);
	let fixed: Awaited<ReturnType<typeof materializeHistoryFreeSingleBaselineRepository>> | null =
		null;
	try {
		fixed = await materializeHistoryFreeSingleBaselineRepository(
			{ repositoryRef: "graphrefly-ts", rootPath: D690_REPOSITORY_ROOT },
			createD690WorkspaceAllocator("fixed"),
			{
				sourceCommitSha: D690_TARGET.fixedCommitSha,
				sourceTreeObjectId: D690_TARGET.fixedTreeObjectId,
				overlay: null,
				signal,
			},
		);
		const baselineRoot = baseline.workspace.rootPathForHostRunner();
		const fixedRoot = fixed.workspace.rootPathForHostRunner();
		const hiddenFixtureBytes = await readFile(join(fixedRoot, TARGET_TEST_PATH));
		if (empiricalSha256(hiddenFixtureBytes) !== D690_TARGET_VERIFIER.hiddenFixtureDigest) {
			fail("d690.verifierCalibration", "hidden verifier fixture digest drift");
		}
		await writeFile(join(baselineRoot, TARGET_TEST_PATH), hiddenFixtureBytes, { mode: 0o600 });
		const nodeModulesPath = join(D690_REPOSITORY_ROOT, "node_modules");
		await symlink(nodeModulesPath, join(baselineRoot, "node_modules"));
		await symlink(nodeModulesPath, join(fixedRoot, "node_modules"));
		const verifierToolchain = await verifyD690VerifierToolchain(nodeModulesPath);
		const verifierCalibration = await runSealedVerifierCalibration(
			{
				baselineRoot,
				fixedRoot,
				baselineEvidence: baseline.evidence,
				fixedEvidence: fixed.evidence,
				verifierToolchain,
			},
			signal,
		);
		return Object.freeze({
			baselineMaterializationEvidence: baseline.evidence,
			verifierCalibration,
		});
	} finally {
		try {
			if (fixed !== null) await fixed.cleanup();
		} finally {
			await baseline.cleanup();
		}
	}
}

/**
 * Constructs the package-private D691 operator boundary for the exact D690
 * history-free target. Hidden fixed bytes and verifier tooling stay inside the
 * closure; actor workspaces contain only the pre-fix source tree.
 */
export async function createD690HistoricalTargetOperatorCapability(
	signal: AbortSignal,
): Promise<D690HistoricalTargetOperatorCapabilityV1> {
	assertNotCancelled(signal);
	const fixed = await materializeHistoryFreeSingleBaselineRepository(
		{ repositoryRef: "graphrefly-ts", rootPath: D690_REPOSITORY_ROOT },
		createD690WorkspaceAllocator("fixed"),
		{
			sourceCommitSha: D690_TARGET.fixedCommitSha,
			sourceTreeObjectId: D690_TARGET.fixedTreeObjectId,
			overlay: null,
			signal,
		},
	);
	let hiddenFixtureBytes: Uint8Array;
	try {
		hiddenFixtureBytes = await readFile(
			join(fixed.workspace.rootPathForHostRunner(), TARGET_TEST_PATH),
		);
		if (empiricalSha256(hiddenFixtureBytes) !== D690_TARGET_VERIFIER.hiddenFixtureDigest) {
			fail("d690.operator", "hidden verifier fixture digest drift");
		}
	} finally {
		await fixed.cleanup();
	}
	const nodeModulesPath = join(D690_REPOSITORY_ROOT, "node_modules");
	const verifierToolchain = await verifyD690VerifierToolchain(nodeModulesPath);
	const ownedActorRoots = new Set<string>();
	const createMaterialization = async (
		materializationSignal: AbortSignal,
	): Promise<HistoryFreeSingleBaselineRepositoryMaterializationV1> => {
		assertNotCancelled(materializationSignal);
		const materialization = await materializeHistoryFreeSingleBaselineRepository(
			{ repositoryRef: "graphrefly-ts", rootPath: D690_REPOSITORY_ROOT },
			createD690WorkspaceAllocator("baseline"),
			{
				sourceCommitSha: D690_TARGET.preFixCommitSha,
				sourceTreeObjectId: D690_TARGET.preFixTreeObjectId,
				overlay: null,
				signal: materializationSignal,
			},
		);
		try {
			validateTargetMaterializationEvidence(materialization.evidence);
			ownedActorRoots.add(await realpath(materialization.workspace.rootPathForHostRunner()));
			return materialization;
		} catch (error) {
			await materialization.cleanup().catch(() => undefined);
			throw error;
		}
	};
	return Object.freeze({
		revision: "d690-historical-target-operator.2026-08-07.v1" as const,
		taskRef: D690_TARGET.taskRef,
		sourceCommitSha: D690_TARGET.preFixCommitSha,
		sourceTreeObjectId: D690_TARGET.preFixTreeObjectId,
		verifierRef: D690_TARGET_VERIFIER.verifierRef,
		verifierRevision: D690_TARGET_VERIFIER.verifierRevision,
		hiddenFixtureDigest: D690_TARGET_VERIFIER.hiddenFixtureDigest,
		verifierToolchainBindingDigest: verifierToolchain.bindingDigest,
		createMaterialization,
		async verify(verificationInput: {
			readonly actorWorkspaceRoot: string;
			readonly signal: AbortSignal;
		}) {
			const request = record(verificationInput, "d690.operator.verify");
			exactKeys(request, ["actorWorkspaceRoot", "signal"], "d690.operator.verify");
			if (!(request.signal instanceof AbortSignal)) {
				fail("d690.operator.verify.signal", "expected AbortSignal");
			}
			assertNotCancelled(request.signal);
			const actorWorkspaceRoot = await realpath(
				string(request.actorWorkspaceRoot, "d690.operator.verify.actorWorkspaceRoot", 1_024),
			);
			if (!ownedActorRoots.has(actorWorkspaceRoot)) {
				fail("d690.operator.verify", "actor workspace is not an operator-owned D690 baseline");
			}
			const actorFileBytes = await readFile(
				join(actorWorkspaceRoot, "packages/ts/src/executors/managed-cloud-postgresql.ts"),
			);
			if (actorFileBytes.byteLength > 128 * 1024) {
				fail("d690.operator.verify", "actor target file exceeds its frozen byte bound");
			}
			const verification = await materializeHistoryFreeSingleBaselineRepository(
				{ repositoryRef: "graphrefly-ts", rootPath: D690_REPOSITORY_ROOT },
				createD690WorkspaceAllocator("baseline"),
				{
					sourceCommitSha: D690_TARGET.preFixCommitSha,
					sourceTreeObjectId: D690_TARGET.preFixTreeObjectId,
					overlay: null,
					signal: request.signal,
				},
			);
			try {
				validateTargetMaterializationEvidence(verification.evidence);
				const root = verification.workspace.rootPathForHostRunner();
				await writeFile(
					join(root, "packages/ts/src/executors/managed-cloud-postgresql.ts"),
					actorFileBytes,
					{ mode: 0o600 },
				);
				await writeFile(join(root, TARGET_TEST_PATH), hiddenFixtureBytes, { mode: 0o600 });
				await symlink(nodeModulesPath, join(root, "node_modules"));
				const exitCode = await runExactFocusedVerifier({
					root,
					signal: request.signal,
					vitestEntryPath: verifierToolchain.vitestEntryPath,
				});
				if (
					(await d690VerifierRuntimeClosureDigest(verifierToolchain.runtimeRootPackagePath))
						.digest !== verifierToolchain.runtimeClosureDigest
				) {
					fail("d690.operator.verify", "verifier runtime closure changed during execution");
				}
				const verdict =
					exitCode === 0
						? ("passed" as const)
						: exitCode === 1
							? ("failed" as const)
							: ("unverifiable" as const);
				return Object.freeze({
					verdict,
					evidenceDigest: empiricalStrictJsonDigest({
						kind: "d690-historical-target-operator-verifier-run.v1",
						verdict,
						actorFileDigest: empiricalSha256(actorFileBytes),
						hiddenFixtureDigest: D690_TARGET_VERIFIER.hiddenFixtureDigest,
						materializationEvidenceDigest: empiricalStrictJsonDigest(verification.evidence),
						verifierToolchainBindingDigest: verifierToolchain.bindingDigest,
						networkIsolationProfile: "macos-sandbox-exec-deny-network.v1",
					}),
					networkCallCount: 0 as const,
				});
			} finally {
				await verification.cleanup();
			}
		},
	});
}

async function verifyD690VerifierToolchain(nodeModulesPath: string) {
	const realNodeModulesPath = await realpath(nodeModulesPath);
	const vitestEntryPath = await realpath(join(realNodeModulesPath, "vitest", "vitest.mjs"));
	const runtimeRootPackagePath = await realpath(join(realNodeModulesPath, "vitest"));
	if (!vitestEntryPath.startsWith(`${realNodeModulesPath}/`)) {
		fail("d690.verifierToolchain", "vitest entry escaped the fixed node_modules tree");
	}
	const lockfileDigest = empiricalSha256(
		await readFile(join(D690_REPOSITORY_ROOT, "pnpm-lock.yaml")),
	);
	const vitestEntryDigest = empiricalSha256(await readFile(vitestEntryPath));
	const nodeExecutableDigest = empiricalSha256(await readFile(process.execPath));
	const runtimeClosure = await d690VerifierRuntimeClosureDigest(runtimeRootPackagePath);
	if (lockfileDigest !== D690_EXPECTED_LOCKFILE_DIGEST) {
		fail("d690.verifierToolchain", "frozen lockfile drift");
	}
	if (vitestEntryDigest !== D690_EXPECTED_VITEST_ENTRY_DIGEST) {
		fail("d690.verifierToolchain", "frozen vitest entry drift");
	}
	if (
		runtimeClosure.digest !== D690_EXPECTED_VERIFIER_RUNTIME_CLOSURE_DIGEST ||
		runtimeClosure.packageCount !== D690_EXPECTED_VERIFIER_RUNTIME_CLOSURE_PACKAGE_COUNT ||
		!runtimeClosure.packageRefs.includes(D690_REQUIRED_VERIFIER_RUNTIME_PACKAGE_REF)
	) {
		fail(
			"d690.verifierToolchain",
			`frozen runtime closure drift (${runtimeClosure.digest}; packages=${runtimeClosure.packageCount}; required=${runtimeClosure.packageRefs.includes(D690_REQUIRED_VERIFIER_RUNTIME_PACKAGE_REF)})`,
		);
	}
	const nodeToolchain = D690_ALLOWED_NODE_TOOLCHAINS.find(
		(entry) =>
			entry.nodeVersion === process.versions.node &&
			entry.nodeExecutableDigest === nodeExecutableDigest,
	);
	if (nodeToolchain === undefined) fail("d690.verifierToolchain", "frozen Node runtime drift");
	const sandboxProfileDigest = empiricalStrictJsonDigest({
		kind: "d690-network-sandbox-profile.v1",
		profile: D690_NETWORK_SANDBOX_PROFILE,
	});
	const bindingDigest = empiricalStrictJsonDigest({
		kind: "d690-sealed-verifier-toolchain-binding.v1",
		lockfileDigest,
		nodeVersion: process.versions.node,
		nodeExecutableDigest,
		runtimeClosureDigest: runtimeClosure.digest,
		sandboxExecutable: D690_NETWORK_SANDBOX_EXECUTABLE,
		sandboxProfileDigest,
		vitestEntryDigest,
		vitestVersion: "3.2.4",
	});
	if (bindingDigest !== nodeToolchain.bindingDigest) {
		fail("d690.verifierToolchain", `frozen verifier toolchain binding drift (${bindingDigest})`);
	}
	return Object.freeze({
		bindingDigest,
		runtimeClosureDigest: runtimeClosure.digest,
		runtimeClosurePackageCount: runtimeClosure.packageCount,
		runtimeRootPackagePath,
		sandboxProfileDigest,
		vitestEntryPath,
	});
}

async function d690VerifierRuntimeClosureDigest(rootPackagePath: string): Promise<{
	readonly digest: string;
	readonly packageCount: number;
	readonly packageRefs: readonly string[];
}> {
	const pending = [await realpath(rootPackagePath)];
	const visited = new Set<string>();
	const packages: Array<{
		packageRef: string;
		contentDigest: string;
		dependencyLinks: readonly { linkRef: string; targetPackageRef: string }[];
	}> = [];
	const counters = { files: 0, bytes: 0 };
	while (pending.length > 0) {
		const packagePath = pending.shift();
		if (packagePath === undefined || visited.has(packagePath)) continue;
		if (visited.size >= 512) fail("d690.verifierRuntimeClosure", "package bound exceeded");
		visited.add(packagePath);
		const manifest = JSON.parse(
			new TextDecoder().decode(await readFile(join(packagePath, "package.json"))),
		) as { name?: unknown; version?: unknown };
		if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
			fail("d690.verifierRuntimeClosure", "package identity missing");
		}
		const packageRef = `${manifest.name}@${manifest.version}`;
		const contentDigest = empiricalStrictJsonDigest({
			kind: "d690-verifier-package-content.v1",
			packageRef,
			files: await d690PackageFiles(packagePath, packagePath, counters),
		});
		const packageParent = dirname(packagePath);
		const dependencyRoot = packageParent.split("/").at(-1)?.startsWith("@")
			? dirname(packageParent)
			: packageParent;
		const dependencyLinks = await d690DependencyLinks(dependencyRoot);
		for (const dependency of dependencyLinks) {
			if (!visited.has(dependency.targetPath)) pending.push(dependency.targetPath);
		}
		packages.push({
			packageRef,
			contentDigest,
			dependencyLinks: dependencyLinks
				.map(({ linkRef, targetPackageRef }) => ({ linkRef, targetPackageRef }))
				.sort((left, right) => compareCodeUnits(left.linkRef, right.linkRef)),
		});
	}
	packages.sort((left, right) => {
		const refOrder = compareCodeUnits(left.packageRef, right.packageRef);
		return refOrder === 0 ? compareCodeUnits(left.contentDigest, right.contentDigest) : refOrder;
	});
	const packageRefs = packages.map(({ packageRef }) => packageRef);
	return Object.freeze({
		digest: empiricalStrictJsonDigest({
			kind: "d690-verifier-runtime-closure.v1",
			packages,
			packageCount: packages.length,
			fileCount: counters.files,
			totalBytes: counters.bytes,
		}),
		packageCount: packages.length,
		packageRefs: Object.freeze(packageRefs),
	});
}

async function d690PackageFiles(
	packageRoot: string,
	currentPath: string,
	counters: { files: number; bytes: number },
): Promise<readonly { path: string; mode: number; digest: string; byteLength: number }[]> {
	const files: Array<{ path: string; mode: number; digest: string; byteLength: number }> = [];
	const entries = await readdir(currentPath, { withFileTypes: true });
	entries.sort((left, right) => compareCodeUnits(left.name, right.name));
	for (const entry of entries) {
		if (entry.name === "node_modules") continue;
		const entryPath = join(currentPath, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await d690PackageFiles(packageRoot, entryPath, counters)));
			continue;
		}
		if (!entry.isFile()) fail("d690.verifierRuntimeClosure", "unsupported package entry");
		const bytes = await readFile(entryPath);
		counters.files += 1;
		counters.bytes += bytes.byteLength;
		if (counters.files > 20_000 || counters.bytes > 256 * 1024 * 1024) {
			fail("d690.verifierRuntimeClosure", "file or byte bound exceeded");
		}
		const metadata = await lstat(entryPath);
		files.push({
			path: entryPath.slice(packageRoot.length + 1),
			mode: metadata.mode & 0o777,
			digest: empiricalSha256(bytes),
			byteLength: bytes.byteLength,
		});
	}
	return files;
}

async function d690DependencyLinks(nodeModulesPath: string): Promise<
	readonly {
		linkRef: string;
		targetPackageRef: string;
		targetPath: string;
	}[]
> {
	const links: Array<{ linkRef: string; targetPackageRef: string; targetPath: string }> = [];
	const visit = async (directory: string, prefix: string): Promise<void> => {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => compareCodeUnits(left.name, right.name));
		for (const entry of entries) {
			const linkRef = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			const entryPath = join(directory, entry.name);
			if (entry.isDirectory() && entry.name.startsWith("@") && prefix === "") {
				await visit(entryPath, entry.name);
				continue;
			}
			if (!entry.isSymbolicLink()) continue;
			const targetPath = await realpath(entryPath);
			const manifest = JSON.parse(
				new TextDecoder().decode(await readFile(join(targetPath, "package.json"))),
			) as { name?: unknown; version?: unknown };
			if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
				fail("d690.verifierRuntimeClosure", "dependency identity missing");
			}
			links.push({
				linkRef,
				targetPackageRef: `${manifest.name}@${manifest.version}`,
				targetPath,
			});
		}
	};
	await visit(nodeModulesPath, "");
	return links;
}

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function createD690WorkspaceAllocator(
	label: "baseline" | "fixed",
): SingleBaselineWorkspaceAllocatorCapabilityV1 {
	const prefix = join(tmpdir(), `graphrefly-d690-${label}-`);
	return Object.freeze({
		async allocate(): Promise<SingleBaselineWorkspaceAllocationV1> {
			const rootPath = await mkdtemp(prefix);
			await chmod(rootPath, 0o700);
			return Object.freeze({ rootPath, ownershipToken: Object.freeze({ rootPath }) });
		},
		async cleanup(allocation: SingleBaselineWorkspaceAllocationV1): Promise<boolean> {
			if (!allocation.rootPath.startsWith(prefix)) return false;
			// A failing Vitest worker can release its last filesystem handle just after
			// the sealed CLI exits. Keep this operator-local cleanup bounded while
			// preserving fail-closed evidence if the directory cannot be removed.
			await rm(allocation.rootPath, {
				force: true,
				maxRetries: 4,
				recursive: true,
				retryDelay: 25,
			});
			return true;
		},
	});
}

async function runSealedVerifierCalibration(
	input: {
		readonly baselineRoot: string;
		readonly fixedRoot: string;
		readonly baselineEvidence: unknown;
		readonly fixedEvidence: unknown;
		readonly verifierToolchain: Awaited<ReturnType<typeof verifyD690VerifierToolchain>>;
	},
	signal: AbortSignal,
) {
	const cases = [] as Array<{
		caseKind: D690VerifierCaseKind;
		expected: D690VerifierObservation;
		observed: D690VerifierObservation;
		evidenceDigest: string;
	}>;
	for (const caseKind of VERIFIER_CASES) {
		assertNotCancelled(signal);
		const root = caseKind === "target-fixed-accepted" ? input.fixedRoot : input.baselineRoot;
		const materializationEvidence =
			caseKind === "target-fixed-accepted" ? input.fixedEvidence : input.baselineEvidence;
		const exitCode = await runExactFocusedVerifier({
			root,
			signal,
			vitestEntryPath: input.verifierToolchain.vitestEntryPath,
		});
		if (
			(await d690VerifierRuntimeClosureDigest(input.verifierToolchain.runtimeRootPackagePath))
				.digest !== input.verifierToolchain.runtimeClosureDigest
		) {
			fail(`d690.verifierCalibration.${caseKind}`, "verifier runtime closure changed");
		}
		const observed = exitCode === 0 ? "accepted" : exitCode === 1 ? "rejected" : "non-evaluable";
		const expected = caseKind === "target-fixed-accepted" ? "accepted" : "rejected";
		if (observed !== expected) {
			fail(`d690.verifierCalibration.${caseKind}`, "hidden verifier observation mismatch");
		}
		cases.push({
			caseKind,
			expected,
			observed,
			evidenceDigest: empiricalStrictJsonDigest({
				kind: "d690-sealed-hidden-verifier-case-evidence.v1",
				caseKind,
				exitCode,
				hiddenFixtureDigest: D690_TARGET_VERIFIER.hiddenFixtureDigest,
				materializationEvidenceDigest: empiricalStrictJsonDigest(materializationEvidence),
				networkIsolationProfile: "macos-sandbox-exec-deny-network.v1",
				sandboxProfileDigest: input.verifierToolchain.sandboxProfileDigest,
				verifierToolchainBindingDigest: input.verifierToolchain.bindingDigest,
			}),
		});
	}
	if (new Set(cases.map((entry) => entry.evidenceDigest)).size !== cases.length) {
		fail("d690.verifierCalibration", "case evidence digests must be distinct");
	}
	const material = strictSnapshot({
		verifierRef: D690_TARGET_VERIFIER.verifierRef,
		verifierRevision: D690_TARGET_VERIFIER.verifierRevision,
		hiddenFixtureDigest: D690_TARGET_VERIFIER.hiddenFixtureDigest,
		verifierToolchainBindingDigest: input.verifierToolchain.bindingDigest,
		verifierRuntimeClosurePackageCount: input.verifierToolchain.runtimeClosurePackageCount,
		networkIsolationProfile: "macos-sandbox-exec-deny-network.v1" as const,
		sandboxProfileDigest: input.verifierToolchain.sandboxProfileDigest,
		cases,
		qualified: true as const,
		providerCallCount: 0 as const,
		networkCallCount: 0 as const,
	});
	return strictSnapshot({ ...material, calibrationDigest: empiricalStrictJsonDigest(material) });
}

async function runExactFocusedVerifier(input: {
	readonly root: string;
	readonly signal: AbortSignal;
	readonly vitestEntryPath: string;
}): Promise<number | null> {
	const child = spawn(
		D690_NETWORK_SANDBOX_EXECUTABLE,
		[
			"-p",
			D690_NETWORK_SANDBOX_PROFILE,
			process.execPath,
			input.vitestEntryPath,
			"run",
			TARGET_TEST_PATH,
			"-t",
			TARGET_FOCUSED_TEST_NAME,
			"--reporter=dot",
		],
		{
			cwd: input.root,
			env: Object.freeze({
				CI: "1",
				LANG: "C",
				LC_ALL: "C",
				PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
			}),
			signal: input.signal,
			stdio: "ignore",
		},
	);
	return await new Promise<number | null>((resolveExit, rejectExit) => {
		child.once("error", rejectExit);
		child.once("close", resolveExit);
	});
}

export function createD690HistoricalTransferMemory(): D689TransferMemoryV1 {
	const sourceEvidenceDigests = [
		D690_SOURCE.actionTraceDigest,
		D690_SOURCE.mutationEvidenceDigest,
		D690_SOURCE.runDigest,
		D690_SOURCE.verifierEvidenceDigest,
	].sort();
	const rule = (statement: string, evidence: readonly string[]) => ({
		statement,
		sourceEvidenceDigests: [...evidence].sort(),
	});
	return validateD689TransferMemory({
		version: D689_TRANSFER_MEMORY_VERSION,
		memoryRef: "memory.d690.canonical-admission-provenance-consumer-grammar",
		memoryRevision: "memory.d690.canonical-admission-provenance-consumer-grammar.v1",
		sourceTaskRef: D690_SOURCE.taskRef,
		failureMechanismRef: D690_FAILURE_MECHANISM_REF,
		failureMechanismRevision: D690_FAILURE_MECHANISM_REVISION,
		triggerConditions: [
			rule(
				"A consumer rejects admission provenance that its producing boundary emitted as valid while an older local shorthand still satisfies the consumer's local grammar.",
				[D690_SOURCE.actionTraceDigest, D690_SOURCE.verifierEvidenceDigest],
			),
		],
		diagnosticDiscriminators: [
			rule(
				"Trace the provenance from its producing projector to the rejecting consumer and compare the producer-owned kind and identifier representation with every consumer guard before editing execution logic.",
				[D690_SOURCE.actionTraceDigest, D690_SOURCE.runDigest],
			),
		],
		correctionPrinciples: [
			rule(
				"Make the consumer validate the producer-owned canonical admission-provenance representation instead of inventing or retaining a local shorthand grammar.",
				[D690_SOURCE.mutationEvidenceDigest, D690_SOURCE.verifierEvidenceDigest],
			),
		],
		validationStrategy: [
			rule(
				"Feed producer-emitted canonical provenance through the focused consumer boundary, keep the contradicted local shorthand rejected, and run the focused verifier before the broader suite.",
				[D690_SOURCE.mutationEvidenceDigest, D690_SOURCE.verifierEvidenceDigest],
			),
		],
		knownBadRouteContraindications: [
			rule(
				"Do not loosen every identifier or bypass exact coordinate correlation when producer evidence contradicts only one consumer-owned grammar assumption.",
				[D690_SOURCE.actionTraceDigest, D690_SOURCE.verifierEvidenceDigest],
			),
		],
		applicabilityScope: [
			rule(
				"Apply only when a producer-owned admission-provenance contract and a downstream consumer grammar disagree; do not apply to unrelated transport or scheduling failures.",
				[D690_SOURCE.runDigest, D690_SOURCE.verifierEvidenceDigest],
			),
		],
		sourceEvidenceDigests,
	});
}

function d690PairQualification(input: {
	readonly memory: D689TransferMemoryV1;
	readonly targetMaterializationEvidence: ReturnType<typeof validateTargetMaterializationEvidence>;
	readonly verifierCalibration: Awaited<ReturnType<typeof runSealedVerifierCalibration>>;
	readonly privateMaterialProtection: D689PrivateMaterialProtectionBundleV1;
}): D689PairQualificationV1 {
	const memoryDigest = empiricalStrictJsonDigest(input.memory);
	if (memoryDigest !== D690_EXPECTED_TRANSFER_MEMORY_DIGEST) {
		fail("d690.memory", "does not match the independently qualified transfer memory");
	}
	assertIndependentPairAnalysis(memoryDigest);
	const sameMechanismEvidenceDigest = D690_INDEPENDENT_SAME_MECHANISM_EVIDENCE_DIGEST;
	const distinctnessEvidenceDigest = empiricalStrictJsonDigest({
		kind: "d690-pair-distinctness-attestation.v1",
		source: {
			taskRef: D690_SOURCE.taskRef,
			fileIdentityDigest: D690_SOURCE.fileIdentityDigest,
			symbolIdentityDigest: D690_SOURCE.symbolIdentityDigest,
			testIdentityDigest: D690_SOURCE.testIdentityDigest,
			expectedMaterialIdentityDigest: D690_SOURCE.expectedMaterialIdentityDigest,
		},
		target: {
			taskRef: D690_TARGET.taskRef,
			fileIdentityDigest: D690_TARGET.fileIdentityDigest,
			symbolIdentityDigest: D690_TARGET.symbolIdentityDigest,
			testIdentityDigest: D690_TARGET.testIdentityDigest,
			expectedMaterialIdentityDigest: D690_TARGET.expectedMaterialIdentityDigest,
		},
	});
	const historyFreedomEvidenceDigest = empiricalStrictJsonDigest({
		kind: "d690-target-history-freedom-attestation.v1",
		materializationEvidenceDigest: empiricalStrictJsonDigest(input.targetMaterializationEvidence),
		verifierCalibrationDigest: input.verifierCalibration.calibrationDigest,
		naturalChronologyClaimed: false,
	});
	const actionabilityEvidenceDigest = D690_INDEPENDENT_ACTIONABILITY_EVIDENCE_DIGEST;
	const protectionEvidenceDigest = empiricalStrictJsonDigest({
		kind: "d690-private-material-protection-attestation.v1",
		capabilityRef: input.privateMaterialProtection.capabilityRef,
		capabilityRevision: input.privateMaterialProtection.capabilityRevision,
		protectedMaterialClasses: input.privateMaterialProtection.protectedMaterialClasses,
		protectedSetBindingDigest: input.privateMaterialProtection.protectedSetBindingDigest,
	});
	return strictSnapshot({
		version: D689_PAIR_QUALIFICATION_VERSION,
		qualificationRef: "qualification.d690.historical-pair",
		qualificationRevision: "qualification.d690.historical-pair.2026-08-07.v1",
		authorityRef: "decision.D690",
		authorityRevision: "decision.D690.2026-08-07.v1",
		source: {
			taskRef: D690_SOURCE.taskRef,
			fileIdentityDigest: D690_SOURCE.fileIdentityDigest,
			symbolIdentityDigest: D690_SOURCE.symbolIdentityDigest,
			testIdentityDigest: D690_SOURCE.testIdentityDigest,
			expectedMaterialIdentityDigest: D690_SOURCE.expectedMaterialIdentityDigest,
			runDigest: D690_SOURCE.runDigest,
			actionTraceDigest: D690_SOURCE.actionTraceDigest,
			mutationEvidenceDigest: D690_SOURCE.mutationEvidenceDigest,
			verifierRef: D690_SOURCE.verifierRef,
			verifierRevision: D690_SOURCE.verifierRevision,
			verifierEvidenceDigest: D690_SOURCE.verifierEvidenceDigest,
			verifierStatus: "passed" as const,
		},
		target: {
			taskRef: D690_TARGET.taskRef,
			fileIdentityDigest: D690_TARGET.fileIdentityDigest,
			symbolIdentityDigest: D690_TARGET.symbolIdentityDigest,
			testIdentityDigest: D690_TARGET.testIdentityDigest,
			expectedMaterialIdentityDigest: D690_TARGET.expectedMaterialIdentityDigest,
			historyStatus: "history-free" as const,
		},
		sourceFailureMechanismRef: D690_FAILURE_MECHANISM_REF,
		sourceFailureMechanismRevision: D690_FAILURE_MECHANISM_REVISION,
		targetFailureMechanismRef: D690_FAILURE_MECHANISM_REF,
		targetFailureMechanismRevision: D690_FAILURE_MECHANISM_REVISION,
		sameMechanismQualified: true,
		sameMechanismEvidenceDigest,
		distinctnessEvidenceDigest,
		historyFreedomEvidenceDigest,
		actionabilityAttestation: {
			memoryDigest,
			actionable: true,
			genericOnly: false,
			evidenceDigest: actionabilityEvidenceDigest,
		},
		privateMaterialProtectionAttestation: {
			capabilityRef: input.privateMaterialProtection.capabilityRef,
			capabilityRevision: input.privateMaterialProtection.capabilityRevision,
			protectedMaterialClasses: input.privateMaterialProtection.protectedMaterialClasses,
			protectedSetBindingDigest: input.privateMaterialProtection.protectedSetBindingDigest,
			evidenceDigest: protectionEvidenceDigest,
		},
		qualificationEvidenceDigests: [
			actionabilityEvidenceDigest,
			distinctnessEvidenceDigest,
			historyFreedomEvidenceDigest,
			protectionEvidenceDigest,
			sameMechanismEvidenceDigest,
		].sort(),
	});
}

function assertIndependentPairAnalysis(memoryDigest: string): void {
	const analysis = {
		kind: "d690-independent-pair-analysis.v1",
		authorityRef: "decision.D690",
		authorityRevision: "decision.D690.2026-08-07.v1",
		sourceTaskRef: D690_SOURCE.taskRef,
		targetTaskRef: D690_TARGET.taskRef,
		failureMechanismRef: D690_FAILURE_MECHANISM_REF,
		sourceTargetDistinctness: {
			task: true,
			file: true,
			symbol: true,
			test: true,
			expectedMaterial: true,
		},
		actionability: {
			memoryDigest,
			triggerConditionsQualified: true,
			diagnosticDiscriminatorsQualified: true,
			correctionPrinciplesQualified: true,
			validationStrategyQualified: true,
			knownBadRouteContraindicationsQualified: true,
			applicabilityScopeQualified: true,
			sourceEvidenceBound: true,
			actionable: true,
			genericOnly: false,
		},
		sameMechanismQualified: true,
	};
	const analysisDigest = empiricalStrictJsonDigest(analysis);
	if (analysisDigest !== D690_INDEPENDENT_PAIR_ANALYSIS_DIGEST) {
		fail("d690.independentPairAnalysis", "frozen analysis binding drift");
	}
	if (
		empiricalStrictJsonDigest({
			kind: "d690-independent-same-mechanism-qualification.v1",
			analysisDigest,
			failureMechanismRef: D690_FAILURE_MECHANISM_REF,
			qualified: true,
		}) !== D690_INDEPENDENT_SAME_MECHANISM_EVIDENCE_DIGEST
	) {
		fail("d690.independentPairAnalysis", "same-mechanism evidence binding drift");
	}
	if (
		empiricalStrictJsonDigest({
			kind: "d690-independent-actionability-qualification.v1",
			analysisDigest,
			memoryDigest,
			actionable: true,
			genericOnly: false,
		}) !== D690_INDEPENDENT_ACTIONABILITY_EVIDENCE_DIGEST
	) {
		fail("d690.independentPairAnalysis", "actionability evidence binding drift");
	}
}

function createExactD690PrivateMaterialProtection(): D689PrivateMaterialProtectionBundleV1 {
	const bundle = createD689PrivateMaterialProtectionBundle({
		...D690_PROTECTION_COORDINATES,
		protectedNeedlesByClass: REQUIRED_PROTECTED_MATERIAL_CLASSES.map((materialClass) => ({
			materialClass,
			protectedNeedles: D690_PROTECTED_NEEDLES[materialClass],
		})),
	});
	if (
		bundle.protectedSetBindingDigest !== D690_EXPECTED_PRIVATE_MATERIAL_PROTECTED_SET_BINDING_DIGEST
	) {
		fail("d690.privateMaterialProtection", "frozen protected-set binding drift");
	}
	return bundle;
}

function createExactD690LeakageNegativeMemories(memory: D689TransferMemoryV1) {
	return Object.freeze(
		REQUIRED_PROTECTED_MATERIAL_CLASSES.map((materialClass) => {
			const protectedNeedle = D690_PROTECTED_NEEDLES[materialClass][0];
			return Object.freeze({
				materialClass,
				probeBindingDigest: empiricalStrictJsonDigest({
					kind: "d690-private-material-class-probe-binding.v1",
					materialClass,
					protectedNeedle,
				}),
				memory: validateD689TransferMemory({
					...memory,
					knownBadRouteContraindications: [
						...memory.knownBadRouteContraindications,
						{
							statement: `Forbidden operator material ${protectedNeedle}`,
							sourceEvidenceDigests: [D690_SOURCE.verifierEvidenceDigest],
						},
					],
				}),
			});
		}),
	);
}

function assertNotCancelled(signal: AbortSignal): void {
	if (signal.aborted) throw new DOMException("D690 offline qualification cancelled", "AbortError");
}
