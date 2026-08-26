import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
import {
	ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT,
	ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT_DIGEST,
	ROOT_EVAL_LIVE_QUALIFICATION,
} from "./root-eval-live-qualification.js";
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
const D124_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:2bf1f7b4fa15262f09fdadc491af567d455d4dea81e28478db7223fb22556e0e";
const D124_TOPOLOGY_QA_DIGEST =
	"sha256:a5dfafaca9437a317c82433e3de528fcc6d32805210329ab37bf167497d7200e";
const D124_TOPOLOGY_QUALIFICATION_DIGEST =
	"sha256:422491364a267407ea4f837e77b4c942122da658f1d9b633ae65dd1862279493";
const D124_LIVE_QA_DIGEST =
	"sha256:90fdba7d97a6cd4e353cefe6f762ea114d92b2f1b6cdc23e4451f44656cefcfa";
const D124_LIVE_QUALIFICATION_DIGEST =
	"sha256:b6d49961927d36d18153d32c673414bf9488edaa3fe8f96d9294f2e9efacc3a4";
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
					ref !== "graphrefly-ts:D125",
			),
		),
		implementationManifestDigest: D120_IMPLEMENTATION_MANIFEST_DIGEST,
		caseResults: remapHistoricalCases(
			ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT.caseResults,
			{
				d121GenerationIsolatedFromConsumedD116: "d116GenerationIsolatedFromConsumedD111",
				d121GenerationIsolatedFromD118Qualification:
					"d116GenerationIsolatedFromD109PreclaimFailure",
				d121GenerationIsolatedFromConsumedD111: "d116GenerationIsolatedFromConsumedD103",
			},
			new Set([
				"d120QualificationArtifactsImmutable",
				"d121ResultNamespacesFresh",
				"d125ResultNamespacesFresh",
				"d125RejectsConsumedD121Coordinates",
				"d125BindsD124RepairReceipt",
				"sixConcurrentHttp429RetryConservation",
				"retryProgressDataPreventsFanInWedge",
				"retryConservationGraphObservation",
				"terminalProviderOutcomePartition",
				"directProviderResultAdmissionSettlement",
				"retryCompletionOrderPermutations",
				"callerSettlementDeadlineTechnicalOnly",
				"budgetStopDrainsAdmittedEffects",
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
					ref !== "graphrefly-ts:D125",
			),
		),
		implementationManifestDigest: D120_IMPLEMENTATION_MANIFEST_DIGEST,
		caseResults: remapHistoricalCases(
			ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT.caseResults,
			{
				d121LiveClaimRequiresRuntimeAuthorityProvenance:
					"d116LiveClaimRequiresRuntimeAuthorityProvenance",
				d121LiveExecutorConsumesOnlyCommittedLiveClaim:
					"d116LiveExecutorConsumesOnlyCommittedLiveClaim",
				evidenceV18FilenameExact: "evidenceV15FilenameExact",
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
				"sixConcurrentHttp429RetryConservation",
				"realParserSixConcurrentHttp429Integration",
				"retryConservationGraphObservation",
				"retryCompletionOrderPermutations",
				"callerSettlementDeadlineTechnicalOnly",
				"callerDeadlineCancelsGraphAndExecutor",
				"callerDeadlineDurableClosedCode",
				"partialEvidenceRetainsLatestGraphObservation",
				"d125LiveClaimRequiresRuntimeAuthorityProvenance",
				"d125LiveExecutorConsumesOnlyCommittedLiveClaim",
				"d125QualificationClaimAndEvidenceCoordinatesFresh",
				"d125GenerationIsolatedFromConsumedD121",
				"d125PreclaimWriteSingleUse",
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

function remapD124DescribeValue(value: unknown, key = ""): unknown {
	if (Array.isArray(value)) return value.map((item) => remapD124DescribeValue(item));
	if (value !== null && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([entryKey, entryValue]) => [
				entryKey,
				remapD124DescribeValue(entryValue, entryKey),
			]),
		);
	if (typeof value !== "string") return value;
	if (key === "currentImplementationManifestDigest" || key === "implementationManifestDigest")
		return D124_IMPLEMENTATION_MANIFEST_DIGEST;
	if (key === "qualificationArtifactDigest")
		return "sha256:c60022f0351797252fb05ed69fc1823d53b23c1226f40243fc32f1b9af8e72de";
	if (key === "qualificationDigest")
		return "sha256:d2a8077750a017af669b9c566f22661e6314a524c332ef631fcaa50d7d49644b";
	if (key === "eligibilityDigest")
		return "sha256:a2dbbc97331e6644446d291ccfffbd144b2bce3803a4e8cbe39ba04ac337c001";
	if (key === "resolutionDigest")
		return "sha256:79c90f74dd329ad58024dc9a1990161ae018273b19f3c92b8f51871695d54038";
	return value === "root-eval-live-2026-08-26-d125-v1"
		? "root-eval-live-2026-08-25-d121-v1"
		: value;
}

function buildD124FrozenArtifactBytes(input: {
	readonly describe: string;
	readonly observeEvents: string;
	readonly runSummary: string;
	readonly mermaid: string;
}): Readonly<{
	readonly describe: string;
	readonly observeEvents: string;
	readonly runSummary: string;
	readonly topologyQualification: string;
	readonly liveQualification: string;
	readonly mermaid: string;
}> {
	const describe = prettyJson(remapD124DescribeValue(JSON.parse(input.describe)));
	const observeEvents = input.observeEvents;
	const runSummary = input.runSummary;
	const mermaid = input.mermaid;
	for (const [name, bytes, digest] of [
		["describe", describe, D124_DESCRIBE_DIGEST],
		["observe", observeEvents, D124_OBSERVE_DIGEST],
		["run-summary", runSummary, D124_RUN_SUMMARY_DIGEST],
		["mermaid", mermaid, D124_MERMAID_DIGEST],
	] as const)
		if (empiricalSha256(Buffer.from(bytes)) !== digest)
			throw new Error(`root eval D124 frozen ${name} reconstruction drifted`);

	const topologyArtifact = Object.freeze({
		...ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT,
		schemaVersion: "graphrefly-ts.root-eval-topology-no-network-qa.v18",
		decisionRefs: Object.freeze(
			ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT.decisionRefs.filter(
				(ref) => ref !== "graphrefly-ts:D124" && ref !== "graphrefly-ts:D125",
			),
		),
		implementationManifestDigest: D124_IMPLEMENTATION_MANIFEST_DIGEST,
		caseResults: remapHistoricalCases(
			ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT.caseResults,
			{},
			new Set([
				"d125ResultNamespacesFresh",
				"d125RejectsConsumedD121Coordinates",
				"d125BindsD124RepairReceipt",
			]),
		),
	});
	if (empiricalStrictJsonDigest(topologyArtifact) !== D124_TOPOLOGY_QA_DIGEST)
		throw new Error("root eval D124 frozen topology QA reconstruction drifted");
	const {
		qualificationDigest: _topologyDigest,
		d122ImplementationReceiptRef: _topologyD122Receipt,
		...topologyMaterialCurrent
	} = ROOT_EVAL_TOPOLOGY_QUALIFICATION;
	const topologyMaterial = Object.freeze({
		...topologyMaterialCurrent,
		schemaVersion: "graphrefly-ts.root-eval-topology-qualification.v18",
		currentLiveExecutionApprovalRef: null,
		implementationManifestDigest: D124_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: D124_TOPOLOGY_QA_DIGEST,
		status: "qualified-no-network-d122-awaiting-fresh-live-decision",
	});
	if (empiricalStrictJsonDigest(topologyMaterial) !== D124_TOPOLOGY_QUALIFICATION_DIGEST)
		throw new Error("root eval D124 frozen topology qualification reconstruction drifted");
	const evidenceDigests = Object.freeze({
		describe: D124_DESCRIBE_DIGEST,
		observeEvents: D124_OBSERVE_DIGEST,
		runSummary: D124_RUN_SUMMARY_DIGEST,
		explanatoryMermaid: D124_MERMAID_DIGEST,
	});
	const topologyQualification = prettyJson({
		artifact: topologyArtifact,
		artifactDigest: D124_TOPOLOGY_QA_DIGEST,
		qualification: Object.freeze({
			...topologyMaterial,
			qualificationDigest: D124_TOPOLOGY_QUALIFICATION_DIGEST,
		}),
		measuredImplementationManifestDigest: D124_IMPLEMENTATION_MANIFEST_DIGEST,
		evidenceDigests,
		evidenceBindingDigest: empiricalStrictJsonDigest({
			implementationManifestDigest: D124_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationDigest: D124_TOPOLOGY_QUALIFICATION_DIGEST,
			evidenceDigests,
		}),
	});

	const liveArtifact = Object.freeze({
		...ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT,
		schemaVersion: "graphrefly-ts.root-eval-live-no-network-qa.v25",
		decisionRefs: Object.freeze(
			ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT.decisionRefs.filter(
				(ref) => ref !== "graphrefly-ts:D124" && ref !== "graphrefly-ts:D125",
			),
		),
		implementationManifestDigest: D124_IMPLEMENTATION_MANIFEST_DIGEST,
		caseResults: remapHistoricalCases(
			ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT.caseResults,
			{ evidenceV18FilenameExact: "evidenceV17FilenameExact" },
			new Set([
				"d125LiveClaimRequiresRuntimeAuthorityProvenance",
				"d125LiveExecutorConsumesOnlyCommittedLiveClaim",
				"d125QualificationClaimAndEvidenceCoordinatesFresh",
				"d125GenerationIsolatedFromConsumedD121",
				"d125PreclaimWriteSingleUse",
			]),
		),
	});
	if (empiricalStrictJsonDigest(liveArtifact) !== D124_LIVE_QA_DIGEST)
		throw new Error("root eval D124 frozen live QA reconstruction drifted");
	const {
		qualificationDigest: _liveDigest,
		d122ImplementationReceiptRef: _liveD122Receipt,
		...liveMaterialCurrent
	} = ROOT_EVAL_LIVE_QUALIFICATION;
	const liveMaterial = Object.freeze({
		...liveMaterialCurrent,
		schemaVersion: "graphrefly-ts.root-eval-live-qualification.v25",
		currentLiveExecutionApprovalRef: null,
		implementationManifestDigest: D124_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: D124_LIVE_QA_DIGEST,
		status: "qualified-no-network-d122-awaiting-fresh-live-decision",
	});
	if (empiricalStrictJsonDigest(liveMaterial) !== D124_LIVE_QUALIFICATION_DIGEST)
		throw new Error("root eval D124 frozen live qualification reconstruction drifted");
	const liveQualification = prettyJson({
		artifact: liveArtifact,
		artifactDigest: D124_LIVE_QA_DIGEST,
		qualification: Object.freeze({
			...liveMaterial,
			qualificationDigest: D124_LIVE_QUALIFICATION_DIGEST,
		}),
		measuredImplementationManifestDigest: D124_IMPLEMENTATION_MANIFEST_DIGEST,
	});
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
	const passed = payload?.memoryExposureCount === 1;
	const expectedDigest = empiricalStrictJsonDigest({
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
	const tool = Object.freeze({
		toolRef: "graphrefly.eval.exact-tool.v1" as const,
		path: "packages/ts/src/executors/managed-cloud-postgresql.ts",
		oldText: "old",
		newText: "new",
	});
	return Object.freeze({
		kind: "eval-provider-outcome" as const,
		admission: effect,
		admissionId: effect.admissionId,
		executionId: effect.executionId,
		operationId: effect.operationId,
		effectRunId: effect.effectRunId,
		workItemId: effect.workItemId,
		replicate: effect.replicate,
		arm: effect.arm,
		attempt: effect.attempt,
		status: "tool-proposed" as const,
		reason: "tool-proposed" as const,
		dispatchAttempted: true,
		costMicrousd: 10,
		costEvidence: "provider-reported" as const,
		pricingRoundingAllowanceMicrousd: 0,
		elapsedMs: effect.replicate * 10 + effect.attempt,
		resultDigest: empiricalStrictJsonDigest({
			kind: "qualification-provider",
			id: effect.executionId,
		}),
		retryAfterMs: 0,
		cleanupCompleted: false,
		toolProposal: Object.freeze({
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
	const d124Frozen = buildD124FrozenArtifactBytes({
		describe: describeBytes,
		observeEvents: observeEventBytes,
		runSummary: runSummaryBytes,
		mermaid: mermaidBytes,
	});
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
