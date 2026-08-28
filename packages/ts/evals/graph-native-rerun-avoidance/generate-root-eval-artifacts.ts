import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import { createCurrentExactModelHarnessProfileInput } from "./current-exact-profile.js";
import {
	createRootEvalTopology,
	type EvalAdmittedToolEffect,
	type EvalEffectOutcome,
	type EvalExecutableEffect,
	type EvalExecutorOutcome,
	materialFreeObservationValue,
	ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
	type RootEvalRunResult,
	runRootEval,
} from "./eval-topology.js";
import {
	CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
	measureCurrentImplementation,
} from "./implementation-manifest.js";
import { ROOT_EVAL_D145_EMPTY_CHARTER_LEDGER } from "./root-eval-charter-ledger.js";
import {
	ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT,
	ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT_DIGEST,
	ROOT_EVAL_LIVE_QUALIFICATION,
} from "./root-eval-live-qualification.js";
import { ROOT_EVAL_DEVELOPMENT_TASKS, ROOT_EVAL_HELD_OUT_SEAL_DIGEST } from "./root-eval-task.js";
import {
	ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT,
	ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT_DIGEST,
	ROOT_EVAL_TOPOLOGY_QUALIFICATION,
} from "./root-eval-topology-qualification.js";

export const ROOT_EVAL_ARTIFACT_DIRECTORY = resolve(import.meta.dirname, "artifacts");

export const ROOT_EVAL_GENERATED_ARTIFACT_PATHS = Object.freeze({
	describe: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "root-eval-describe.json"),
	observeEvents: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "root-eval-observe-events.jsonl"),
	runSummary: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "root-eval-run-summary.json"),
	qualification: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "root-eval-topology-qualification.json"),
	liveQualification: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "root-eval-live-qualification.json"),
	artifactSet: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "root-eval-artifact-set.json"),
	d120TopologyQualification: resolve(
		ROOT_EVAL_ARTIFACT_DIRECTORY,
		"history/d120-root-eval-topology-qualification.json",
	),
	d120LiveQualification: resolve(
		ROOT_EVAL_ARTIFACT_DIRECTORY,
		"history/d120-root-eval-live-qualification.json",
	),
	d124Describe: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "history/d124-root-eval-describe.json"),
	d124ObserveEvents: resolve(
		ROOT_EVAL_ARTIFACT_DIRECTORY,
		"history/d124-root-eval-observe-events.jsonl",
	),
	d124RunSummary: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "history/d124-root-eval-run-summary.json"),
	d124TopologyQualification: resolve(
		ROOT_EVAL_ARTIFACT_DIRECTORY,
		"history/d124-root-eval-topology-qualification.json",
	),
	d124LiveQualification: resolve(
		ROOT_EVAL_ARTIFACT_DIRECTORY,
		"history/d124-root-eval-live-qualification.json",
	),
	d124Mermaid: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "history/d124-root-eval-topology.mmd"),
});

const ROOT_EVAL_EXPLANATORY_MERMAID_PATH = resolve(
	ROOT_EVAL_ARTIFACT_DIRECTORY,
	"root-eval-topology.mmd",
);

export interface RootEvalGeneratedArtifactBytes {
	readonly describe: string;
	readonly observeEvents: string;
	readonly runSummary: string;
	readonly qualification: string;
	readonly liveQualification: string;
	readonly artifactSet: string;
	readonly d120TopologyQualification: string;
	readonly d120LiveQualification: string;
	readonly d124Describe: string;
	readonly d124ObserveEvents: string;
	readonly d124RunSummary: string;
	readonly d124TopologyQualification: string;
	readonly d124LiveQualification: string;
	readonly d124Mermaid: string;
}

export interface RootEvalGeneratedArtifactSnapshot {
	readonly artifactSetDigest: string;
	readonly implementationManifestDigest: string;
}

const ROOT_EVAL_ARTIFACT_MARKER_MAX_BYTES = 65_536;
const ROOT_EVAL_ARTIFACT_FILE_MAX_BYTES = 64 * 1_048_576;

function parseRootEvalArtifactSet(bytes: Uint8Array): {
	readonly implementationManifestDigest: string;
	readonly files: Readonly<Record<string, string>>;
} {
	if (bytes.byteLength < 1 || bytes.byteLength > ROOT_EVAL_ARTIFACT_MARKER_MAX_BYTES)
		throw new Error("root eval artifact-set marker exceeded its byte bound");
	const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error("root eval artifact-set marker was malformed");
	const marker = value as Record<string, unknown>;
	if (
		Object.keys(marker).sort().join("\0") !==
			["files", "format", "implementationManifestDigest", "publication", "version"]
				.sort()
				.join("\0") ||
		marker.format !== "graphrefly.rootEvalArtifactSet" ||
		marker.version !== 1 ||
		marker.publication !== "commit-marker-written-last" ||
		typeof marker.implementationManifestDigest !== "string" ||
		marker.files === null ||
		typeof marker.files !== "object" ||
		Array.isArray(marker.files)
	)
		throw new Error("root eval artifact-set marker was malformed");
	const files = marker.files as Record<string, unknown>;
	for (const [name, fileDigest] of Object.entries(files))
		if (
			!/^([a-z0-9-]+\/)*[a-z0-9.-]+$/u.test(name) ||
			typeof fileDigest !== "string" ||
			!/^sha256:[0-9a-f]{64}$/u.test(fileDigest)
		)
			throw new Error("root eval artifact-set marker file binding was malformed");
	return Object.freeze({
		implementationManifestDigest: marker.implementationManifestDigest,
		files: Object.freeze(files as Record<string, string>),
	});
}

export async function checkRootEvalGeneratedArtifactSnapshot(input?: {
	readonly artifactDirectory?: string;
}): Promise<RootEvalGeneratedArtifactSnapshot> {
	const artifactDirectory = resolve(input?.artifactDirectory ?? ROOT_EVAL_ARTIFACT_DIRECTORY);
	const artifactSetPath = resolve(artifactDirectory, "root-eval-artifact-set.json");
	const markerStat = await stat(artifactSetPath);
	if (!markerStat.isFile() || markerStat.size > ROOT_EVAL_ARTIFACT_MARKER_MAX_BYTES)
		throw new Error("root eval artifact-set marker exceeded its byte bound");
	const markerBefore = await readFile(artifactSetPath);
	const marker = parseRootEvalArtifactSet(markerBefore);
	if (marker.implementationManifestDigest !== CURRENT_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new Error("root eval artifact-set implementation manifest drifted");
	const expectedFiles = Object.entries(ROOT_EVAL_GENERATED_ARTIFACT_PATHS)
		.filter(([key]) => key !== "artifactSet")
		.map(([, path]) => relative(ROOT_EVAL_ARTIFACT_DIRECTORY, path))
		.concat(relative(ROOT_EVAL_ARTIFACT_DIRECTORY, ROOT_EVAL_EXPLANATORY_MERMAID_PATH))
		.sort();
	if (Object.keys(marker.files).sort().join("\0") !== expectedFiles.join("\0"))
		throw new Error("root eval artifact-set file membership drifted");
	for (const name of expectedFiles) {
		const path = resolve(artifactDirectory, name);
		if (!path.startsWith(`${artifactDirectory}/`))
			throw new Error("root eval artifact-set path escaped its directory");
		const fileStat = await stat(path);
		if (!fileStat.isFile() || fileStat.size > ROOT_EVAL_ARTIFACT_FILE_MAX_BYTES)
			throw new Error(`root eval generated artifact exceeded its byte bound: ${name}`);
		if (empiricalSha256(await readFile(path)) !== marker.files[name])
			throw new Error(`root eval generated artifact snapshot drift: ${name}`);
	}
	const markerAfter = await readFile(artifactSetPath);
	if (empiricalSha256(markerAfter) !== empiricalSha256(markerBefore))
		throw new Error("root eval artifact set changed while its snapshot was checked");
	return Object.freeze({
		artifactSetDigest: empiricalSha256(markerBefore),
		implementationManifestDigest: marker.implementationManifestDigest,
	});
}

const D120_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:bef7aae1a105d67c0dd1a55d2a474b70fbca80389654050855e9b78153cbcdcd";
const D120_TOPOLOGY_QA_DIGEST =
	"sha256:76df5924474c08e7ec0ddaf7e34ac8addd0e909e28ba0e20499eabeb62a718c3";
const D120_TOPOLOGY_QUALIFICATION_DIGEST =
	"sha256:ec6d474339d20e358e4f57f914f15bae797b75ccf9fc35a029f9d67cc791e203";
const D120_LIVE_QA_DIGEST =
	"sha256:debb0e0bda6b5edecb5fb22738fcf5258965020101f723fb23035ba6ce383a62";
const D120_LIVE_QUALIFICATION_DIGEST =
	"sha256:2048d8366ade35e83b2bc513f3d1849f1b5bbeb0a2117e0c436c63e8594afd21";
const D124_TOPOLOGY_QA_DIGEST =
	"sha256:a5dfafaca9437a317c82433e3de528fcc6d32805210329ab37bf167497d7200e";
const D124_TOPOLOGY_QUALIFICATION_DIGEST =
	"sha256:422491364a267407ea4f837e77b4c942122da658f1d9b633ae65dd1862279493";
const D124_LIVE_QA_DIGEST =
	"sha256:90fdba7d97a6cd4e353cefe6f762ea114d92b2f1b6cdc23e4451f44656cefcfa";
const D124_LIVE_QUALIFICATION_DIGEST =
	"sha256:b6d49961927d36d18153d32c673414bf9488edaa3fe8f96d9294f2e9efacc3a4";
const D124_TOPOLOGY_QUALIFICATION_BYTES_DIGEST =
	"sha256:66df4bc2853ece5b96449939c002521079d31aebe0989e6966b7ec5dbbf93c12";
const D124_LIVE_QUALIFICATION_BYTES_DIGEST =
	"sha256:4e83b0f797775e5c5dcb311a112f18fdd29ccb8ccf22380c34d8cf0816d8dfdc";
const D124_DESCRIBE_DIGEST =
	"sha256:91fc8d290eeecb70d281a86fcc3dc2437d6840e9fbaa88b20184d04757ffda54";
const D124_OBSERVE_DIGEST =
	"sha256:fb5600fa171f3e5cf5a69432595ab6282433501680d71d247193327bb1338e94";
const D124_RUN_SUMMARY_DIGEST =
	"sha256:38c2a81c0dedb762bb53ab31f9f5531758f711a0d3f2f8695e4fb2eb59096d9b";
const D124_MERMAID_DIGEST =
	"sha256:193f393ee67f8259bdc678ed182070d70108779598312498154a960ea4e9200a";

function remapHistoricalCases(
	cases: Readonly<Record<string, "passed">>,
	mapping: Readonly<Record<string, string>>,
	omit: ReadonlySet<string>,
): Readonly<Record<string, "passed">> {
	return Object.freeze(
		Object.fromEntries(
			Object.entries(cases)
				.filter(([key]) => !omit.has(key))
				.map(([key, value]) => [mapping[key] ?? key, value]),
		),
	);
}

function buildD120FrozenQualificationBytes(): Readonly<{
	readonly topology: string;
	readonly live: string;
}> {
	const topologyArtifact = Object.freeze({
		...ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT,
		schemaVersion: "graphrefly-ts.root-eval-topology-no-network-qa.v15",
		topologyRevision: "graphrefly-ts.root-eval-topology.v7",
		replicates: 5,
		requiredNodeCount: 66,
		criticalEdgeCount: 108,
		decisionRefs: Object.freeze(
			ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT.decisionRefs.filter(
				(ref) =>
					ref !== "graphrefly-ts:D120" &&
					ref !== "graphrefly-ts:D121" &&
					ref !== "graphrefly-ts:D122" &&
					ref !== "graphrefly-ts:D123" &&
					ref !== "graphrefly-ts:D124" &&
					ref !== "graphrefly-ts:D125" &&
					ref !== "graphrefly-ts:D126" &&
					ref !== "graphrefly-ts:D127" &&
					ref !== "graphrefly-ts:D128" &&
					ref !== "graphrefly-ts:D129" &&
					ref !== "graphrefly-ts:D130" &&
					ref !== "graphrefly-ts:D131" &&
					ref !== "graphrefly-ts:D132" &&
					ref !== "graphrefly-ts:D133" &&
					ref !== "graphrefly-ts:D134" &&
					ref !== "graphrefly-ts:D135" &&
					ref !== "graphrefly-ts:D136" &&
					ref !== "graphrefly-ts:D137" &&
					ref !== "graphrefly-ts:D138" &&
					ref !== "graphrefly-ts:D139" &&
					ref !== "graphrefly-ts:D140" &&
					ref !== "graphrefly-ts:D141" &&
					ref !== "graphrefly-ts:D144" &&
					ref !== "graphrefly-ts:D145",
			),
		),
		implementationManifestDigest: D120_IMPLEMENTATION_MANIFEST_DIGEST,
		caseResults: remapHistoricalCases(
			ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT.caseResults,
			{
				sixConcurrentWorkItemsWithTwoProviderSlots: "sixEffectConcurrency",
				d121GenerationIsolatedFromConsumedD116: "d116GenerationIsolatedFromConsumedD111",
				d121GenerationIsolatedFromD118Qualification:
					"d116GenerationIsolatedFromD109PreclaimFailure",
				d121GenerationIsolatedFromConsumedD111: "d116GenerationIsolatedFromConsumedD103",
			},
			new Set([
				"d120QualificationArtifactsImmutable",
				"d121ResultNamespacesFresh",
				"d136ResultNamespacesFresh",
				"d136RejectsConsumedD125Coordinates",
				"d136BindsD133ImplementationReceipt",
				"d136BrowserArtifactBuilderUsesCurrentSchema",
				"d136PrivateInputPreflightDoesNotConsumeGeneration",
				"d136ZeroChargePreclaimCloseout",
				"d138PrecredentialGateChronologyLeavesTopologyUnchanged",
				"d138ExecutableStagePlanMutationContract",
				"d140ResultNamespacesFresh",
				"d140RejectsClosedD136Coordinates",
				"d140BindsD139ImplementationReceipt",
				"d140BrowserArtifactBuilderUsesCurrentSchema",
				"d140PrivateInputPreflightDoesNotConsumeGeneration",
				"d145ExactlyOneRootCampaignContract",
				"d145OneFixedAgenticMemoryLifecycle",
				"d145SixArmsAreCorrelatedDataNotLifecycleCopies",
				"d145CausallyPriorSourceWorkItemVerifiedAndSettled",
				"d145MatchedSourceTargetFindingEvidence",
				"d145WholeReplicateTechnicalExclusion",
				"d145OperationallyInconclusiveBelowFourEvaluable",
				"d145DevelopmentAndConfirmatoryReplicateModes",
				"d145GraphOwnedDevelopmentQualification",
				"d145HeldOutSealAndBudgetPartitions",
				"d145CriticalCampaignAndQualificationEdges",
				"sixConcurrentHttp429RetryConservation",
				"retryProgressDataPreventsFanInWedge",
				"retryConservationGraphObservation",
				"terminalProviderOutcomePartition",
				"directProviderResultAdmissionSettlement",
				"retryCompletionOrderPermutations",
				"callerSettlementDeadlineTechnicalOnly",
				"budgetStopDrainsAdmittedEffects",
				"adaptiveProviderCapacityGraphState",
				"exactRouteHttp429Cooldown",
				"permanentRateLimitedSerialDownshift",
				"firstAndRetryProposalConservation",
				"perOutcomeRetryReadinessWithoutBatchWedge",
				"canonicalProviderCapacityBudgetStableCut",
				"failedCooldownReadinessFailsClosed",
				"callerCancellationDuringCooldownLeavesNoBackgroundAdmission",
				"sixArmHttp429RetryConservation",
				"initialProviderSlotCompletionOrderPermutations",
				"graphOwnedElapsedAdmissionBudget",
				"campaignStartWaveSettlesImmediately",
				"timerSourceResolvedThenBoundaryData",
				"exactElapsedBoundaryVirtualTime",
				"elapsedStateMonotoneAcrossStartReplay",
				"elapsedStoppingObservationStableCut",
				"configuredCampaignIdentityPreservedAtTimerBoundary",
				"elapsedStopDrainsAdmittedCausalTail",
				"earlyTerminalTimerDeactivation",
				"callerLeaseAfterGraphBudgetAndDrainReserve",
			]),
		),
	});
	if (empiricalStrictJsonDigest(topologyArtifact) !== D120_TOPOLOGY_QA_DIGEST)
		throw new Error("root eval D120 frozen topology QA reconstruction drifted");
	const {
		verificationDiagnosticsImplementationReceiptRef: _topologyReceipt,
		d121ConsumedLiveExecutionApprovalRef: _topologyD121Approval,
		d121LivenessIncidentRepairRef: _topologyD121Repair,
		d122ImplementationReceiptRef: _topologyD122Receipt,
		mostRecentConsumedLiveExecutionApprovalRef: _topologyD125Approval,
		mostRecentConsumedLiveExecutionCloseoutRef: _topologyD126Closeout,
		adaptiveProviderCapacityDecisionRef: _topologyD127,
		adaptiveProviderCapacityExecutionApprovalRef: _topologyD128,
		elapsedAdmissionBudgetDecisionRef: _topologyD129,
		elapsedAdmissionBudgetExecutionApprovalRef: _topologyD130,
		nonBlockingElapsedTimerDecisionRef: _topologyD131,
		nonBlockingElapsedTimerExecutionApprovalRef: _topologyD132,
		graphElapsedAdaptiveImplementationReceiptRef: _topologyD133Receipt,
		d136ZeroChargeCloseoutRef: _topologyD137Closeout,
		precredentialGateChronologyExecutionApprovalRef: _topologyD138Approval,
		precredentialGateChronologyImplementationReceiptRef: _topologyD139Receipt,
		completionCharterRef: _topologyD140Charter,
		currentLiveExecutionApprovalClosed: _topologyLiveApprovalClosed,
		callerHorizonDecisionRequired: _topologyCallerHorizon,
		mostRecentSuccessfulCanonicalLiveExecutionApprovalRef: _successfulApproval,
		mostRecentSuccessfulCanonicalLiveExecutionCloseoutRef: _successfulCloseout,
		...topologyCurrent
	} = ROOT_EVAL_TOPOLOGY_QUALIFICATION;
	const { qualificationDigest: _topologyDigest, ...topologyMaterialCurrent } = topologyCurrent;
	const topologyMaterialWithHistoricalNames = Object.fromEntries(
		Object.entries(topologyMaterialCurrent).flatMap(([key, value]) =>
			key === "efficacyBillingSeparationDecisionRef"
				? [
						["mostRecentlyConsumedLiveExecutionApprovalRef", "graphrefly-ts:D116"],
						["mostRecentlyConsumedLiveExecutionCloseoutRef", "graphrefly-ts:D117"],
						[key, value],
					]
				: [[key, value]],
		),
	);
	const topologyMaterial = Object.freeze({
		...topologyMaterialWithHistoricalNames,
		schemaVersion: "graphrefly-ts.root-eval-topology-qualification.v15",
		decisionRef: "graphrefly-ts:D118",
		executionApprovalRef: "graphrefly-ts:D119",
		currentLiveExecutionApprovalRef: null,
		implementationManifestDigest: D120_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: D120_TOPOLOGY_QA_DIGEST,
		status: "qualified-no-network-d118-awaiting-fresh-live-decision",
	});
	if (empiricalStrictJsonDigest(topologyMaterial) !== D120_TOPOLOGY_QUALIFICATION_DIGEST)
		throw new Error("root eval D120 frozen topology qualification reconstruction drifted");
	const topologyQualification = Object.freeze({
		...topologyMaterial,
		qualificationDigest: D120_TOPOLOGY_QUALIFICATION_DIGEST,
	});
	const evidenceDigests = Object.freeze({
		describe: "sha256:ea583b160b2430cb81450196c7892ef73fbde1d6f544b21bf034c9844f2c158e",
		observeEvents: "sha256:a911bcf5636bca9777c9dbfdb222ca6d7ebccc5f09d4fb7db74d58faa8d05667",
		runSummary: "sha256:578ae21ee10c67d5dbf815964c28934e1235c25266b3d553aa1566eec3fc9011",
		explanatoryMermaid: "sha256:d0dea4f49da01a671a40d82fba57ffea79d1e7db6e60ab5816bb1e12518dfca3",
	});
	const topology = prettyJson({
		artifact: topologyArtifact,
		artifactDigest: D120_TOPOLOGY_QA_DIGEST,
		qualification: topologyQualification,
		measuredImplementationManifestDigest: D120_IMPLEMENTATION_MANIFEST_DIGEST,
		evidenceDigests,
		evidenceBindingDigest: empiricalStrictJsonDigest({
			implementationManifestDigest: D120_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationDigest: D120_TOPOLOGY_QUALIFICATION_DIGEST,
			evidenceDigests,
		}),
	});
	if (
		empiricalSha256(Buffer.from(topology)) !==
		"sha256:afe7528e510006c2afe35315ded6edf00830df40af3d2d96878c5ee8ee6bc23e"
	)
		throw new Error("root eval D120 frozen topology qualification bytes drifted");

	const liveArtifact = Object.freeze({
		...ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT,
		schemaVersion: "graphrefly-ts.root-eval-live-no-network-qa.v22",
		decisionRefs: Object.freeze(
			ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT.decisionRefs.filter(
				(ref) =>
					ref !== "graphrefly-ts:D120" &&
					ref !== "graphrefly-ts:D121" &&
					ref !== "graphrefly-ts:D122" &&
					ref !== "graphrefly-ts:D123" &&
					ref !== "graphrefly-ts:D124" &&
					ref !== "graphrefly-ts:D125" &&
					ref !== "graphrefly-ts:D126" &&
					ref !== "graphrefly-ts:D127" &&
					ref !== "graphrefly-ts:D128" &&
					ref !== "graphrefly-ts:D129" &&
					ref !== "graphrefly-ts:D130" &&
					ref !== "graphrefly-ts:D131" &&
					ref !== "graphrefly-ts:D132" &&
					ref !== "graphrefly-ts:D133" &&
					ref !== "graphrefly-ts:D134" &&
					ref !== "graphrefly-ts:D135" &&
					ref !== "graphrefly-ts:D136" &&
					ref !== "graphrefly-ts:D137" &&
					ref !== "graphrefly-ts:D138" &&
					ref !== "graphrefly-ts:D139" &&
					ref !== "graphrefly-ts:D140" &&
					ref !== "graphrefly-ts:D141" &&
					ref !== "graphrefly-ts:D144" &&
					ref !== "graphrefly-ts:D145",
			),
		),
		implementationManifestDigest: D120_IMPLEMENTATION_MANIFEST_DIGEST,
		taskBindingDigest: "sha256:f020b4fdcb290a17ab7716fb6b432293c99c1da4d9d9289eceff1fa2de1901e8",
		caseResults: remapHistoricalCases(
			ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT.caseResults,
			{
				sixConcurrentWorkItemsTwoProviderSlotsDelegatedToRootGraph:
					"sixEffectConcurrencyDelegatedToRootGraph",
				d121LiveClaimRequiresRuntimeAuthorityProvenance:
					"d116LiveClaimRequiresRuntimeAuthorityProvenance",
				d121LiveExecutorConsumesOnlyCommittedLiveClaim:
					"d116LiveExecutorConsumesOnlyCommittedLiveClaim",
				evidenceV23FilenameExact: "evidenceV15FilenameExact",
				d121QualificationClaimAndEvidenceCoordinatesFresh:
					"d116QualificationClaimAndEvidenceCoordinatesFresh",
				d121GenerationIsolatedFromConsumedD116: "d116GenerationIsolatedFromConsumedD111",
				d121GenerationIsolatedFromD118Qualification: "d116GenerationIsolatedFromConsumedD109",
				d121GenerationIsolatedFromConsumedD111: "d116GenerationIsolatedFromConsumedD103",
				d121PreclaimWriteSingleUse: "d116PreclaimWriteSingleUse",
			},
			new Set([
				"providerUsageCostFieldIsRuntimeAuthority",
				"claimCommitCapabilityCannotBeSelfAuthored",
				"implementationCoordinateExactShape",
				"isolatedPrecredentialBootstrap",
				"precredentialGateReceiptBeforeBrowserObservation",
				"sixConcurrentHttp429RetryConservation",
				"realParserSixConcurrentHttp429Integration",
				"retryConservationGraphObservation",
				"retryCompletionOrderPermutations",
				"callerSettlementDeadlineTechnicalOnly",
				"callerDeadlineCancelsGraphAndExecutor",
				"callerDeadlineDurableClosedCode",
				"partialEvidenceRetainsLatestGraphObservation",
				"d136LiveClaimRequiresRuntimeAuthorityProvenance",
				"d136LiveExecutorConsumesOnlyCommittedLiveClaim",
				"d136QualificationClaimAndEvidenceCoordinatesFresh",
				"d136GenerationIsolatedFromConsumedD125",
				"d136PreclaimWriteSingleUse",
				"d136BrowserArtifactBuilderUsesCurrentSchema",
				"d136PrivateInputPreflightDoesNotConsumeGeneration",
				"d136ZeroChargePreclaimCloseout",
				"d138LongGatesOnlyBeforeReceipt",
				"d138NoLongGatesAfterReceipt",
				"d138BoundedCurrentnessBeforePrivateInputs",
				"d138StaleReceiptRejectedBeforeCredential",
				"d138UnexpectedPrivateStateRejectedBeforeCredential",
				"d138ExecutableStagePlanMutationContract",
				"d138ArtifactSnapshotByteMutationRejected",
				"d138ReceiptBindsCommitRepositoryAndArtifactSet",
				"d138ClosedD136EntryRejectsBeforeCapability",
				"d140LiveClaimRequiresRuntimeAuthorityProvenance",
				"d140LiveExecutorConsumesOnlyCommittedLiveClaim",
				"d140QualificationClaimAndEvidenceCoordinatesFresh",
				"d140GenerationIsolatedFromConsumedD136",
				"d140PreclaimWriteSingleUse",
				"d140BrowserArtifactBuilderUsesCurrentSchema",
				"d140PrivateInputPreflightDoesNotConsumeGeneration",
				"d140ExactExecutionAuthorityOpen",
				"d140FirstProviderDispatchConsumesAutomaticRerunAuthority",
				"d140CumulativeUsdSixHardCap",
				"d145CampaignContractGraphVisible",
				"d145OneReplicateDevelopmentGeneration",
				"d145DevelopmentAlwaysEmitsNoEfficacyClaim",
				"d145TwoConsecutiveGenerationGate",
				"d145HeldOutTaskAndVerifierSeal",
				"d145IndependentSpendPartitions",
				"d145PrivateDiagnosticsBoundedAndMode0600",
				"d145ExactHeldOutFiveReplicateAuthority",
				"fiveTransferWorkspaceVerifierVariants",
				"ambiguousPublicDiscriminatingPrivateVerifier",
				"oneFixedAgenticMemoryLifecycleSixCorrelatedData",
				"causallyPriorVerifiedSourceWorkItemCleanup",
				"disjointDevelopmentAndConfirmatoryTaskManifests",
				"privateTaskManifestMode0600AndDigestBinding",
				"missingConfirmatoryManifestFailsClosed",
				"matchedRelevantOverColdThreshold",
				"wholeReplicateTechnicalExclusion",
				"belowFourEvaluableOperationallyInconclusive",
				"developmentEvidenceCannotEmitEfficacyClaim",
				"adaptiveProviderCapacityGraphState",
				"exactFireworks429CooldownAndPermanentSerialDownshift",
				"firstAndRetryProposalConservation",
				"canonicalProviderCapacityBudgetStableCut",
				"peakProviderConcurrencyAtMostTwoEvidenceGate",
				"retryAfterFloorCapAndMalformedHeaderMatrix",
				"sixArmHttp429RetryConservation",
				"initialProviderSlotCompletionOrderPermutations",
				"graphOwnedElapsedAdmissionBudget",
				"nonBlockingElapsedTimerSource",
				"exactElapsedBoundaryAndEarlyCancellation",
				"boundedProviderToolBillingSettlementLeases",
				"boundedRetryAndCleanupFinalizerSettlementLeases",
				"nonCooperativeSettlementAdaptersContained",
				"mainNoNetworkExecutorUsesSettlementLeases",
				"postCutoffCausalTailBelowDrainReserve",
				"callerSafetyLeaseRemainsLastResort",
			]),
		),
	});
	if (empiricalStrictJsonDigest(liveArtifact) !== D120_LIVE_QA_DIGEST)
		throw new Error("root eval D120 frozen live QA reconstruction drifted");
	const {
		verificationDiagnosticsImplementationReceiptRef: _liveReceipt,
		d121ConsumedLiveExecutionApprovalRef: _liveD121Approval,
		d121LivenessIncidentRepairRef: _liveD121Repair,
		d122ImplementationReceiptRef: _liveD122Receipt,
		mostRecentConsumedLiveExecutionApprovalRef: _liveD125Approval,
		mostRecentConsumedLiveExecutionCloseoutRef: _liveD126Closeout,
		adaptiveProviderCapacityDecisionRef: _liveD127,
		adaptiveProviderCapacityExecutionApprovalRef: _liveD128,
		elapsedAdmissionBudgetDecisionRef: _liveD129,
		elapsedAdmissionBudgetExecutionApprovalRef: _liveD130,
		nonBlockingElapsedTimerDecisionRef: _liveD131,
		nonBlockingElapsedTimerExecutionApprovalRef: _liveD132,
		graphElapsedAdaptiveImplementationReceiptRef: _liveD133Receipt,
		d136ZeroChargeCloseoutRef: _liveD137Closeout,
		precredentialGateChronologyExecutionApprovalRef: _liveD138Approval,
		precredentialGateChronologyImplementationReceiptRef: _liveD139Receipt,
		completionCharterRef: _liveD140Charter,
		currentLiveExecutionApprovalClosed: _liveApprovalClosed,
		callerHorizonDecisionRequired: _liveCallerHorizon,
		mostRecentSuccessfulCanonicalLiveExecutionApprovalRef: _liveSuccessfulApproval,
		mostRecentSuccessfulCanonicalLiveExecutionCloseoutRef: _liveSuccessfulCloseout,
		...liveCurrent
	} = ROOT_EVAL_LIVE_QUALIFICATION;
	const { qualificationDigest: _liveDigest, ...liveMaterialCurrent } = liveCurrent;
	const liveMaterialWithHistoricalNames = Object.fromEntries(
		Object.entries(liveMaterialCurrent).flatMap(([key, value]) =>
			key === "efficacyBillingSeparationDecisionRef"
				? [
						["mostRecentlyConsumedLiveExecutionApprovalRef", "graphrefly-ts:D116"],
						["mostRecentlyConsumedLiveExecutionCloseoutRef", "graphrefly-ts:D117"],
						[key, value],
					]
				: [[key, value]],
		),
	);
	const liveMaterial = Object.freeze({
		...liveMaterialWithHistoricalNames,
		schemaVersion: "graphrefly-ts.root-eval-live-qualification.v22",
		decisionRef: "graphrefly-ts:D118",
		implementationExecutionApprovalRef: "graphrefly-ts:D119",
		currentLiveExecutionApprovalRef: null,
		implementationManifestDigest: D120_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: D120_LIVE_QA_DIGEST,
		status: "qualified-no-network-d118-awaiting-fresh-live-decision",
	});
	if (empiricalStrictJsonDigest(liveMaterial) !== D120_LIVE_QUALIFICATION_DIGEST)
		throw new Error("root eval D120 frozen live qualification reconstruction drifted");
	const live = prettyJson({
		artifact: liveArtifact,
		artifactDigest: D120_LIVE_QA_DIGEST,
		qualification: Object.freeze({
			...liveMaterial,
			qualificationDigest: D120_LIVE_QUALIFICATION_DIGEST,
		}),
		measuredImplementationManifestDigest: D120_IMPLEMENTATION_MANIFEST_DIGEST,
	});
	if (
		empiricalSha256(Buffer.from(live)) !==
		"sha256:b79f03e45490a6d728b933fe7bc2aa4f6fd1f622c8ebd02afdb6111004132aa9"
	)
		throw new Error("root eval D120 frozen live qualification bytes drifted");
	return Object.freeze({ topology, live });
}

async function readD124FrozenArtifactBytes(): Promise<
	Readonly<{
		readonly describe: string;
		readonly observeEvents: string;
		readonly runSummary: string;
		readonly topologyQualification: string;
		readonly liveQualification: string;
		readonly mermaid: string;
	}>
> {
	const [describe, observeEvents, runSummary, topologyQualification, liveQualification, mermaid] =
		await Promise.all([
			readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS.d124Describe, "utf8"),
			readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS.d124ObserveEvents, "utf8"),
			readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS.d124RunSummary, "utf8"),
			readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS.d124TopologyQualification, "utf8"),
			readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS.d124LiveQualification, "utf8"),
			readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS.d124Mermaid, "utf8"),
		]);
	for (const [name, bytes, digest] of [
		["describe", describe, D124_DESCRIBE_DIGEST],
		["observe", observeEvents, D124_OBSERVE_DIGEST],
		["run-summary", runSummary, D124_RUN_SUMMARY_DIGEST],
		["topology-qualification", topologyQualification, D124_TOPOLOGY_QUALIFICATION_BYTES_DIGEST],
		["live-qualification", liveQualification, D124_LIVE_QUALIFICATION_BYTES_DIGEST],
		["mermaid", mermaid, D124_MERMAID_DIGEST],
	] as const)
		if (empiricalSha256(Buffer.from(bytes)) !== digest)
			throw new Error(`root eval immutable D124 ${name} artifact drifted`);
	const parsedTopology = JSON.parse(topologyQualification) as {
		readonly artifactDigest?: string;
		readonly qualification?: { readonly qualificationDigest?: string };
	};
	const parsedLive = JSON.parse(liveQualification) as {
		readonly artifactDigest?: string;
		readonly qualification?: { readonly qualificationDigest?: string };
	};
	if (
		parsedTopology.artifactDigest !== D124_TOPOLOGY_QA_DIGEST ||
		parsedTopology.qualification?.qualificationDigest !== D124_TOPOLOGY_QUALIFICATION_DIGEST ||
		parsedLive.artifactDigest !== D124_LIVE_QA_DIGEST ||
		parsedLive.qualification?.qualificationDigest !== D124_LIVE_QUALIFICATION_DIGEST
	)
		throw new Error("root eval immutable D124 qualification identity drifted");
	return Object.freeze({
		describe,
		observeEvents,
		runSummary,
		topologyQualification,
		liveQualification,
		mermaid,
	});
}

function qualificationOutcome(effect: EvalAdmittedToolEffect): EvalEffectOutcome {
	const payload = effect.providerAdmission.request.payload as
		| { readonly memoryExposureCount?: number }
		| undefined;
	const passed = effect.workItemRole === "source" || payload?.memoryExposureCount === 1;
	const expectedDigest =
		effect.workItemRole === "source"
			? ROOT_EVAL_DEVELOPMENT_TASKS[effect.replicate - 1]!.sourceVerifierEvidenceDigest
			: empiricalStrictJsonDigest({
					kind: "expected-eval-result",
					replicate: effect.replicate,
					arm: effect.arm,
					attempt: effect.attempt,
				});
	return Object.freeze({
		kind: "eval-effect-outcome",
		admission: effect,
		executionId: effect.executionId,
		admissionId: effect.providerAdmission.admissionId,
		toolAdmissionId: effect.toolAdmissionId,
		operationId: effect.providerAdmission.operationId,
		argumentsDigest: effect.argumentsDigest,
		effectRunId: effect.effectRunId,
		workItemId: effect.workItemId,
		workItemRole: effect.workItemRole,
		replicate: effect.replicate,
		arm: effect.arm,
		attempt: effect.attempt,
		status: "completed",
		costMicrousd: 0,
		elapsedMs: effect.replicate * 10 + effect.attempt,
		resultDigest: empiricalStrictJsonDigest({
			kind: "no-network-eval-result",
			replicate: effect.replicate,
			arm: effect.arm,
			attempt: effect.attempt,
		}),
		evidence: Object.freeze({
			expectedDigest,
			actualDigest: empiricalStrictJsonDigest({
				kind: "actual-control-result",
				replicate: effect.replicate,
				arm: effect.arm,
			}),
			diff: passed ? "scoped-change" : "no-change",
			cleanupCompleted: true,
			publicSemantic: passed ? "equivalent" : "different",
			hiddenVerifier: passed ? "pass" : "fail",
		}),
	});
}

async function qualificationExecutor(effect: EvalExecutableEffect): Promise<EvalExecutorOutcome> {
	if (effect.kind === "eval-admitted-tool-effect") return qualificationOutcome(effect);
	if (effect.kind === "eval-admitted-billing-observation") {
		const before = effect.currentKeyBefore;
		const currentKeyAfter = Object.freeze({
			...before,
			remainingMicrousd: before.remainingMicrousd - effect.accountedUpperBoundMicrousd,
			usageMicrousd: before.usageMicrousd + effect.accountedUpperBoundMicrousd,
			admissionDigest: empiricalStrictJsonDigest({
				kind: "qualification-current-key-observation",
				executionId: effect.executionId,
			}),
		});
		return Object.freeze({
			kind: "eval-billing-observation-outcome" as const,
			admission: effect,
			executionId: effect.executionId,
			observation: effect.observation,
			status: "completed" as const,
			currentKeyAfter,
			resultDigest: empiricalStrictJsonDigest(currentKeyAfter),
		});
	}
	if (effect.kind === "eval-admitted-retry-delay")
		return Object.freeze({
			kind: "eval-retry-delay-outcome" as const,
			admission: effect,
			executionId: effect.executionId,
			elapsedMs: effect.delayMs,
			status: "completed" as const,
			resultDigest: empiricalStrictJsonDigest({
				kind: "qualification-delay",
				id: effect.executionId,
			}),
		});
	const task = ROOT_EVAL_DEVELOPMENT_TASKS[effect.replicate - 1]!;
	const tool = Object.freeze({
		toolRef: "graphrefly.eval.exact-tool.v1" as const,
		path: effect.workItemRole === "source" ? task.sourceWritablePath : task.writablePath,
		oldText: effect.workItemRole === "source" ? task.sourceFixtureBuggyText : task.fixtureBuggyText,
		newText:
			effect.workItemRole === "source" ? task.sourceFixtureCorrectText : task.fixtureCorrectText,
	});
	const exactRouteHttp429 =
		effect.workItemRole === "target" &&
		effect.replicate === 1 &&
		effect.arm === "cold" &&
		effect.attempt === 1;
	return Object.freeze({
		kind: "eval-provider-outcome" as const,
		admission: effect,
		admissionId: effect.admissionId,
		executionId: effect.executionId,
		operationId: effect.operationId,
		effectRunId: effect.effectRunId,
		workItemId: effect.workItemId,
		workItemRole: effect.workItemRole,
		replicate: effect.replicate,
		arm: effect.arm,
		attempt: effect.attempt,
		status: exactRouteHttp429 ? ("retryable" as const) : ("tool-proposed" as const),
		reason: exactRouteHttp429 ? ("http-429-retryable" as const) : ("tool-proposed" as const),
		dispatchAttempted: true,
		costMicrousd: exactRouteHttp429 ? 0 : 10,
		costEvidence: "provider-reported" as const,
		pricingRoundingAllowanceMicrousd: 0,
		elapsedMs: effect.replicate * 10 + effect.attempt,
		resultDigest: empiricalStrictJsonDigest({
			kind: "qualification-provider",
			id: effect.executionId,
		}),
		retryAfterMs: exactRouteHttp429 ? 60_000 : 0,
		cleanupCompleted: exactRouteHttp429,
		toolProposal: exactRouteHttp429
			? null
			: Object.freeze({
					...tool,
					argumentsDigest: empiricalStrictJsonDigest(tool),
				}),
	});
}

function prettyJson(value: unknown): string {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

export async function buildRootEvalGeneratedArtifactBytes(): Promise<RootEvalGeneratedArtifactBytes> {
	const measuredManifestDigest = await measureCurrentImplementation();
	if (measuredManifestDigest !== CURRENT_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new Error("root eval artifact generation rejects implementation manifest drift");
	const topology = createRootEvalTopology({
		profileInput: createCurrentExactModelHarnessProfileInput(),
		currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
		campaignRef: "root-eval-confirmatory-2026-08-27-d145-v1",
		campaignPurpose: "confirmatory",
		taskSetRef: ROOT_EVAL_DEVELOPMENT_TASKS[0]!.taskSetRef,
		generationRef: "root-eval-confirmatory-2026-08-27-d145-v1",
		replicateCount: 5,
		heldOutSealDigest: ROOT_EVAL_HELD_OUT_SEAL_DIGEST,
		budgetPartition: "confirmatory-usd-6",
		partitionHardCapMicrousd: 6_000_000,
		partitionSpentBeforeMicrousd: 0,
		partitionLedgerDigest: ROOT_EVAL_D145_EMPTY_CHARTER_LEDGER.ledgerDigest,
		developmentQualificationStreakBefore: 2,
	});
	const describe = topology.graph.describe();
	const rawObservationEvents: Array<RootEvalRunResult["observations"][number]> = [];
	const observationPaths = [
		"eval/observation/provider-effect-activity",
		"eval/observation/tool-effect-activity",
		"eval/observation/retry-effect-activity",
		"eval/observation/billing-effect-activity",
		"eval/observation/effect-activity",
		"eval/observation",
	] as const;
	const stopRawObservations = observationPaths.map((path) =>
		topology.graph.observe(path).subscribe((event) => rawObservationEvents.push(event)),
	);
	let result: RootEvalRunResult;
	try {
		result = await runRootEval(topology, qualificationExecutor);
	} finally {
		for (const stop of stopRawObservations) stop();
	}
	rawObservationEvents.sort((left, right) => left.seq - right.seq);
	const observation = [...result.observations]
		.reverse()
		.map(materialFreeObservationValue)
		.find((value) => value !== undefined);
	if (observation === undefined || observation.finding === "pending") {
		throw new Error("root eval artifact generation requires a terminal Graph observation");
	}
	const runSummary = Object.freeze({
		format: "graphrefly.rootEvalRunSummary" as const,
		version: 1 as const,
		authority: "derived-no-network-qa" as const,
		observation,
		finding: result.finding,
		peakConcurrentEffects: result.peakConcurrentEffects,
		executedAdmissionCount: result.executedAdmissionIds.length,
	});
	const describeBytes = prettyJson(describe);
	const observeEventBytes = `${rawObservationEvents.map((event) => JSON.stringify(event)).join("\n")}\n`;
	const runSummaryBytes = prettyJson(runSummary);
	const mermaidBytes = await readFile(ROOT_EVAL_EXPLANATORY_MERMAID_PATH, "utf8");
	const evidenceDigests = Object.freeze({
		describe: empiricalSha256(Buffer.from(describeBytes)),
		observeEvents: empiricalSha256(Buffer.from(observeEventBytes)),
		runSummary: empiricalSha256(Buffer.from(runSummaryBytes)),
		explanatoryMermaid: empiricalSha256(Buffer.from(mermaidBytes)),
	});
	const qualification = Object.freeze({
		artifact: ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT,
		artifactDigest: ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT_DIGEST,
		qualification: ROOT_EVAL_TOPOLOGY_QUALIFICATION,
		measuredImplementationManifestDigest: measuredManifestDigest,
		evidenceDigests,
		evidenceBindingDigest: empiricalStrictJsonDigest({
			implementationManifestDigest: measuredManifestDigest,
			qualificationDigest: ROOT_EVAL_TOPOLOGY_QUALIFICATION.qualificationDigest,
			evidenceDigests,
		}),
	});
	const qualificationBytes = prettyJson(qualification);
	const liveQualificationBytes = prettyJson({
		artifact: ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT,
		artifactDigest: ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT_DIGEST,
		qualification: ROOT_EVAL_LIVE_QUALIFICATION,
		measuredImplementationManifestDigest: measuredManifestDigest,
	});
	const d120Frozen = buildD120FrozenQualificationBytes();
	const d124Frozen = await readD124FrozenArtifactBytes();
	const artifactSet = Object.freeze({
		format: "graphrefly.rootEvalArtifactSet" as const,
		version: 1 as const,
		publication: "commit-marker-written-last" as const,
		implementationManifestDigest: measuredManifestDigest,
		files: Object.freeze({
			"root-eval-describe.json": evidenceDigests.describe,
			"root-eval-observe-events.jsonl": evidenceDigests.observeEvents,
			"root-eval-run-summary.json": evidenceDigests.runSummary,
			"root-eval-topology-qualification.json": empiricalSha256(Buffer.from(qualificationBytes)),
			"root-eval-live-qualification.json": empiricalSha256(Buffer.from(liveQualificationBytes)),
			"root-eval-topology.mmd": evidenceDigests.explanatoryMermaid,
			"history/d120-root-eval-topology-qualification.json": empiricalSha256(
				Buffer.from(d120Frozen.topology),
			),
			"history/d120-root-eval-live-qualification.json": empiricalSha256(
				Buffer.from(d120Frozen.live),
			),
			"history/d124-root-eval-describe.json": D124_DESCRIBE_DIGEST,
			"history/d124-root-eval-observe-events.jsonl": D124_OBSERVE_DIGEST,
			"history/d124-root-eval-run-summary.json": D124_RUN_SUMMARY_DIGEST,
			"history/d124-root-eval-topology-qualification.json": empiricalSha256(
				Buffer.from(d124Frozen.topologyQualification),
			),
			"history/d124-root-eval-live-qualification.json": empiricalSha256(
				Buffer.from(d124Frozen.liveQualification),
			),
			"history/d124-root-eval-topology.mmd": D124_MERMAID_DIGEST,
		}),
	});
	if ((await measureCurrentImplementation()) !== measuredManifestDigest)
		throw new Error("root eval implementation drifted during artifact generation");
	return Object.freeze({
		describe: describeBytes,
		observeEvents: observeEventBytes,
		runSummary: runSummaryBytes,
		qualification: qualificationBytes,
		liveQualification: liveQualificationBytes,
		artifactSet: prettyJson(artifactSet),
		d120TopologyQualification: d120Frozen.topology,
		d120LiveQualification: d120Frozen.live,
		d124Describe: d124Frozen.describe,
		d124ObserveEvents: d124Frozen.observeEvents,
		d124RunSummary: d124Frozen.runSummary,
		d124TopologyQualification: d124Frozen.topologyQualification,
		d124LiveQualification: d124Frozen.liveQualification,
		d124Mermaid: d124Frozen.mermaid,
	});
}

export async function writeRootEvalGeneratedArtifacts(): Promise<void> {
	const bytes = await buildRootEvalGeneratedArtifactBytes();
	await mkdir(ROOT_EVAL_ARTIFACT_DIRECTORY, { recursive: true });
	const publicationKeys = [
		"describe",
		"observeEvents",
		"runSummary",
		"qualification",
		"liveQualification",
		"d120TopologyQualification",
		"d120LiveQualification",
		"d124Describe",
		"d124ObserveEvents",
		"d124RunSummary",
		"d124TopologyQualification",
		"d124LiveQualification",
		"d124Mermaid",
	] as const;
	const temporaryPaths = new Map<keyof typeof bytes, string>();
	try {
		for (const key of [...publicationKeys, "artifactSet"] as const) {
			await mkdir(dirname(ROOT_EVAL_GENERATED_ARTIFACT_PATHS[key]), { recursive: true });
			const temporaryPath = `${ROOT_EVAL_GENERATED_ARTIFACT_PATHS[key]}.${randomUUID()}.tmp`;
			temporaryPaths.set(key, temporaryPath);
			await writeFile(temporaryPath, bytes[key], "utf8");
		}
		for (const key of publicationKeys)
			await rename(temporaryPaths.get(key)!, ROOT_EVAL_GENERATED_ARTIFACT_PATHS[key]);
		await rename(
			temporaryPaths.get("artifactSet")!,
			ROOT_EVAL_GENERATED_ARTIFACT_PATHS.artifactSet,
		);
	} finally {
		await Promise.all(
			[...temporaryPaths.values()].map((temporaryPath) => rm(temporaryPath, { force: true })),
		);
	}
}

export async function checkRootEvalGeneratedArtifacts(): Promise<void> {
	const expected = await buildRootEvalGeneratedArtifactBytes();
	const markerBefore = await readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS.artifactSet, "utf8");
	for (const key of Object.keys(ROOT_EVAL_GENERATED_ARTIFACT_PATHS) as (keyof typeof expected)[]) {
		const actual = await readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS[key], "utf8");
		if (actual !== expected[key]) {
			throw new Error(
				`root eval generated artifact drift: ${ROOT_EVAL_GENERATED_ARTIFACT_PATHS[key]}`,
			);
		}
	}
	const markerAfter = await readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS.artifactSet, "utf8");
	if (markerAfter !== markerBefore)
		throw new Error("root eval artifact set changed while it was being checked");
}

async function main(): Promise<void> {
	const mode = process.argv[2] ?? "--write";
	if (mode === "--write") return writeRootEvalGeneratedArtifacts();
	if (mode === "--check") return checkRootEvalGeneratedArtifacts();
	throw new Error(`unknown root eval artifact mode: ${mode}`);
}

const entryPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entryPath === fileURLToPath(import.meta.url)) {
	await main();
}
