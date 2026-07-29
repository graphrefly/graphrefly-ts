import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	type PrivateRepositoryOverlayV1,
	validatePrivateRepositoryOverlay,
} from "./canonical-repository-tree.js";
import {
	type ClosedTaskExecutionProfileV1,
	type ClosedVerifierProfileCoordinatesV1,
	validateClosedTaskExecutionProfile,
} from "./closed-task-profile-host.js";
import {
	type ClosedVerifierCalibrationCapabilityV1,
	type ClosedVerifierCalibrationObservation,
	type ClosedVerifierCalibrationReportV1,
	runClosedVerifierCalibration,
} from "./closed-task-profile-verifier-calibration.js";
import {
	EMPIRICAL_MEMORY_RERUN_AVOIDANCE_SCHEMAS,
	type EmpiricalCampaignManifestV1,
	type EmpiricalCampaignTaskV1,
	type EmpiricalQualificationEvidenceKind,
	type EmpiricalTaskCatalogV1,
	type EmpiricalTaskQualificationObservationV1,
	type EmpiricalTaskQualificationReportV1,
	type FrozenEmpiricalCampaignManifestV1,
} from "./contracts.js";
import { validateEmpiricalCampaignManifest, validateEmpiricalTaskCatalog } from "./manifest.js";
import {
	createEmpiricalTaskQualificationReport,
	freezeEmpiricalCampaignManifest,
} from "./qualification.js";
import {
	type ExactLocalSourceRepositoryCapabilityV1,
	type HistoryFreeSingleBaselineRepositoryEvidenceV1,
	materializeHistoryFreeSingleBaselineRepository,
	SingleBaselineRepositoryMaterializationError,
	type SingleBaselineWorkspaceAllocatorCapabilityV1,
} from "./single-baseline-repository-node.js";

export const EXACT_FIVE_TASK_IDENTITIES = Object.freeze([
	Object.freeze({
		taskRef: "canonical-managed-compute-admission-ref",
		sourceStratum: "historical-pre-fix" as const,
		sourceCommitSha: "a396eda3249b90e32de0f4c69f5380960adf3002",
		sourceTreeObjectId: "665f5ea2993087a54762d2bfac987efd68872666",
		smoke: true as const,
	}),
	Object.freeze({
		taskRef: "malformed-orphan-remote-call-isolation",
		sourceStratum: "historical-pre-fix" as const,
		sourceCommitSha: "62a3c4031402c5f810c239f97c79f36bcd85fe02",
		sourceTreeObjectId: "fc486aa93ce7b3e22c844eaedf4ea6bdd4830ca2",
		smoke: false as const,
	}),
	Object.freeze({
		taskRef: "closed-wave-message-directions",
		sourceStratum: "historical-pre-fix" as const,
		sourceCommitSha: "22c54fa393bc1c85bbbe29e7994b886ac7e3fc2f",
		sourceTreeObjectId: "8fa9fe95802a23e7974fb8f3eba60dae08a16074",
		smoke: false as const,
	}),
	Object.freeze({
		taskRef: "local-fixed-window-exact-boundary-rollover",
		sourceStratum: "held-out-overlay" as const,
		sourceCommitSha: "3b8115f37c8675b8970b24ada3aa351b772e5144",
		sourceTreeObjectId: "74f94a624b627aeb62ff0f1ea191bc5c62b13e78",
		smoke: false as const,
	}),
	Object.freeze({
		taskRef: "recursive-mounted-graph-find",
		sourceStratum: "held-out-overlay" as const,
		sourceCommitSha: "3b8115f37c8675b8970b24ada3aa351b772e5144",
		sourceTreeObjectId: "74f94a624b627aeb62ff0f1ea191bc5c62b13e78",
		smoke: false as const,
	}),
] as const);

export type ExactFiveTaskManifestTemplateV1 = Omit<
	EmpiricalCampaignManifestV1,
	"catalog" | "qualification"
>;

export interface ExactFiveTaskPrivateMaterialV1 {
	readonly taskRef: string;
	readonly overlay: PrivateRepositoryOverlayV1 | null;
	readonly taskProfile: ClosedTaskExecutionProfileV1;
	readonly calibrationCapability: ClosedVerifierCalibrationCapabilityV1;
	readonly durationLimitMs: number;
}

export interface ExactFiveTaskOfflineQualificationInputV1 {
	readonly source: ExactLocalSourceRepositoryCapabilityV1;
	readonly catalog: EmpiricalTaskCatalogV1;
	readonly materials: readonly ExactFiveTaskPrivateMaterialV1[];
	readonly allocators: readonly SingleBaselineWorkspaceAllocatorCapabilityV1[];
	readonly manifestTemplate: ExactFiveTaskManifestTemplateV1;
	readonly qualificationRevision: string;
	readonly monotonicClock: {
		readMs(): number;
	};
	readonly signal: AbortSignal;
}

export interface ExactFiveTaskOfflineQualificationResultV1 {
	readonly catalog: EmpiricalTaskCatalogV1;
	readonly qualificationReport: EmpiricalTaskQualificationReportV1;
	readonly frozenManifest: FrozenEmpiricalCampaignManifestV1 | null;
	readonly qualified: boolean;
	readonly issueCodes: readonly string[];
}

/**
 * Materializes and qualifies D639's exact ordered five-task catalog without constructing a model
 * port. Operator-private overlays, expected material, and hidden verifier fixtures stay behind the
 * supplied capabilities; the returned evidence contains only bounded digests and classifications.
 */
export async function runExactFiveTaskOfflineQualification(
	input: ExactFiveTaskOfflineQualificationInputV1,
): Promise<ExactFiveTaskOfflineQualificationResultV1> {
	const signal = input.signal;
	assertNotCancelled(signal);
	const catalog = validateExactCatalog(input.catalog);
	const source = Object.freeze({
		repositoryRef: input.source.repositoryRef,
		rootPath: input.source.rootPath,
	}) satisfies ExactLocalSourceRepositoryCapabilityV1;
	const materials = validateOrderedMaterials(input.materials, catalog);
	const allocators = validateAllocators(input.allocators);
	const manifestTemplate = strictSnapshot(input.manifestTemplate);
	assertPreregisteredSmokeTask(manifestTemplate);
	const qualificationRevision = input.qualificationRevision;
	const monotonicClock = snapshotMonotonicClock(input.monotonicClock);
	const observations: EmpiricalTaskQualificationObservationV1[] = [];
	const runnerIssues: string[] = [];

	for (let index = 0; index < EXACT_FIVE_TASK_IDENTITIES.length; index += 1) {
		assertNotCancelled(signal);
		const task = catalog.tasks[index] as EmpiricalCampaignTaskV1;
		const identity = EXACT_FIVE_TASK_IDENTITIES[
			index
		] as (typeof EXACT_FIVE_TASK_IDENTITIES)[number];
		const material = materials[index] as ExactFiveTaskPrivateMaterialV1;
		const allocator = allocators[index] as SingleBaselineWorkspaceAllocatorCapabilityV1;
		let result: Awaited<ReturnType<typeof qualifyTask>>;
		try {
			result = await qualifyTask({
				source,
				task,
				identity,
				material,
				allocator,
				clock: monotonicClock,
				signal,
			});
		} catch {
			assertNotCancelled(signal);
			result = {
				observation: null,
				issueCodes: Object.freeze([`${task.taskRef}:offline-qualification-invalid`]),
			};
		}
		assertNotCancelled(signal);
		if (result.observation === null) {
			runnerIssues.push(...result.issueCodes);
		} else {
			observations.push(result.observation);
			runnerIssues.push(...result.observation.issueCodes);
		}
	}

	assertNotCancelled(signal);
	const qualificationReport = createEmpiricalTaskQualificationReport(catalog, observations);
	const reportDigest = empiricalSha256(strictJsonCodec.encode(qualificationReport));
	const manifest = validateEmpiricalCampaignManifest({
		...manifestTemplate,
		catalog,
		qualification: {
			qualificationRevision,
			taskCatalogDigest: qualificationReport.taskCatalogDigest,
			reportDigest,
		},
	});
	assertNotCancelled(signal);
	const frozenManifest = qualificationReport.qualified
		? freezeEmpiricalCampaignManifest(manifest, qualificationReport)
		: null;
	const issueCodes = Object.freeze(
		[...new Set([...runnerIssues, ...qualificationReport.issueCodes])].sort(),
	);
	return strictSnapshot({
		catalog,
		qualificationReport,
		frozenManifest,
		qualified: frozenManifest !== null && issueCodes.length === 0,
		issueCodes,
	});
}

async function qualifyTask(input: {
	readonly source: ExactLocalSourceRepositoryCapabilityV1;
	readonly task: EmpiricalCampaignTaskV1;
	readonly identity: (typeof EXACT_FIVE_TASK_IDENTITIES)[number];
	readonly material: ExactFiveTaskPrivateMaterialV1;
	readonly allocator: SingleBaselineWorkspaceAllocatorCapabilityV1;
	readonly clock: ExactFiveTaskOfflineQualificationInputV1["monotonicClock"];
	readonly signal: AbortSignal;
}): Promise<{
	readonly observation: EmpiricalTaskQualificationObservationV1 | null;
	readonly issueCodes: readonly string[];
}> {
	const startedAtMs = readMonotonicMs(input.clock);
	let evidence: HistoryFreeSingleBaselineRepositoryEvidenceV1 | null = null;
	let calibration: ClosedVerifierCalibrationReportV1 | null = null;
	let profile: ClosedTaskExecutionProfileV1 | null = null;
	const issueCodes: string[] = [];
	let materialization: Awaited<
		ReturnType<typeof materializeHistoryFreeSingleBaselineRepository>
	> | null = null;

	try {
		materialization = await materializeHistoryFreeSingleBaselineRepository(
			input.source,
			input.allocator,
			{
				sourceCommitSha: input.identity.sourceCommitSha,
				sourceTreeObjectId: input.identity.sourceTreeObjectId,
				overlay: input.material.overlay,
				signal: input.signal,
			},
		);
		evidence = materialization.evidence;
		validateWorkspaceEvidence(input.task, input.identity, evidence);
		profile = validateClosedTaskExecutionProfile(input.material.taskProfile, input.task);
		const profileCoordinates = verifierProfileCoordinates(input.task, profile);
		calibration = await runClosedVerifierCalibration({
			profileCoordinates,
			capability: input.material.calibrationCapability,
			signal: input.signal,
		});
		issueCodes.push(...calibration.issueCodes);
	} catch (error) {
		if (input.signal.aborted) {
			throw new DOMException("exact five-task qualification cancelled", "AbortError");
		}
		issueCodes.push(classifyTaskFailure(input.task.taskRef, error));
	} finally {
		if (materialization !== null) {
			try {
				await materialization.cleanup();
			} catch {
				issueCodes.push(`${input.task.taskRef}:workspace-cleanup-failed`);
			}
		}
	}

	const endedAtMs = readMonotonicMs(input.clock);
	if (endedAtMs < startedAtMs) {
		return {
			observation: null,
			issueCodes: Object.freeze(
				[...new Set([...issueCodes, `${input.task.taskRef}:monotonic-clock-regression`])].sort(),
			),
		};
	}
	const observedDurationMs = endedAtMs - startedAtMs;
	const durationLimitMs = safeInteger(
		input.material.durationLimitMs,
		`${input.task.taskRef}.durationLimitMs`,
		{ min: 1 },
	);
	if (evidence === null || calibration === null || profile === null) {
		return {
			observation: null,
			issueCodes: Object.freeze([...new Set(issueCodes)].sort()),
		};
	}
	if (observedDurationMs > durationLimitMs) {
		issueCodes.push(`${input.task.taskRef}:qualification-duration-exceeded`);
	}
	return {
		observation: qualificationObservation({
			task: input.task,
			evidence,
			profile,
			calibration,
			observedDurationMs,
			durationLimitMs,
			issueCodes,
		}),
		issueCodes: Object.freeze([]),
	};
}

function qualificationObservation(input: {
	readonly task: EmpiricalCampaignTaskV1;
	readonly evidence: HistoryFreeSingleBaselineRepositoryEvidenceV1;
	readonly profile: ClosedTaskExecutionProfileV1;
	readonly calibration: ClosedVerifierCalibrationReportV1;
	readonly observedDurationMs: number;
	readonly durationLimitMs: number;
	readonly issueCodes: readonly string[];
}): EmpiricalTaskQualificationObservationV1 {
	const caseObservation = (
		kind: EmpiricalQualificationEvidenceKind,
	): ClosedVerifierCalibrationObservation | undefined =>
		input.calibration.cases.find((entry) => entry.caseKind === kind)?.observed;
	const verdict = (
		kind: EmpiricalQualificationEvidenceKind,
	): "passed" | "failed" | "unverifiable" => {
		const observation = caseObservation(kind);
		if (observation === "accepted") return "passed";
		if (observation === "rejected") return "failed";
		return "unverifiable";
	};
	const verifier = input.profile.verifierProfile;
	return strictSnapshot({
		schemaVersion: EMPIRICAL_MEMORY_RERUN_AVOIDANCE_SCHEMAS.taskQualificationObservation,
		taskRef: input.task.taskRef,
		taskDigest: empiricalStrictJsonDigest(input.task),
		verifierProfileRef: input.task.verifierProfileRef,
		verifierProfileRevision: input.task.verifierProfileRevision,
		verifierProfileDigest: input.task.verifierProfileDigest,
		workspace: {
			actorTreeDigest: input.evidence.actorTreeDigest,
			workspaceRecipeRef: input.task.workspaceRecipeRef,
			workspaceRecipeRevision: input.task.workspaceRecipeRevision,
			workspaceRecipeDigest: input.task.workspaceRecipeDigest,
			environmentDigest: input.task.environmentDigest,
			toolchainDigest: input.task.toolchainDigest,
			repositoryState: input.evidence.repositoryState,
			remotes: input.evidence.remotes,
			descendantHistoryVisible: input.evidence.sourceHistoryVisible,
			uncommittedChanges: !input.evidence.fullFilesystemMatch,
			overlayVisibleAsDiff: input.evidence.overlayVisibleAsDiff,
			hiddenVerifierMaterialVisible: false,
			expectedPatchVisible: false,
			freshMaterializationVerified:
				input.evidence.commitCount === 1 &&
				input.evidence.parentCount === 0 &&
				input.evidence.reflogs === 0 &&
				input.evidence.unreachableObjects === 0 &&
				!input.evidence.sharedObjectStore &&
				input.evidence.fullFilesystemMatch,
			sharedCacheMode: "none" as const,
			cleanupFailureClassifiedNonEvaluable: true,
		},
		commands: {
			policyRef: input.task.allowedCommandPolicyRef,
			policyRevision: input.task.allowedCommandPolicyRevision,
			policyDigest: input.task.allowedCommandPolicyDigest,
			resolved: true,
			networkAllowed: false,
			containerRuntimeAllowed: false,
			credentialAccessAllowed: false,
			outOfTreeWritesAllowed: false,
		},
		verifierCalibration: {
			executable: input.calibration.cases.length > 0,
			targetDefectVerdict: verdict("target-defect-verifier"),
			knownGoodVerdict: verdict("known-good-verifier"),
			plausibleWrongVerdict: verdict("plausible-wrong-verifier"),
			actorClaimsCanSatisfy: caseObservation("actor-claim-rejection") !== "rejected",
			verifierTamperingRejected: caseObservation("verifier-tamper-rejection") === "rejected",
			outOfPolicyDiffRejected: caseObservation("out-of-policy-diff-rejection") === "rejected",
			evidenceComplete: input.calibration.qualified,
			missingEvidenceClassifiedNonEvaluable:
				caseObservation("missing-evidence-non-evaluable") === "non-evaluable",
			unreliableEvidenceClassifiedNonEvaluable:
				caseObservation("unreliable-evidence-non-evaluable") === "non-evaluable",
			nonExecutableEvidenceClassifiedNonEvaluable:
				caseObservation("non-executable-evidence-non-evaluable") === "non-evaluable",
			testTamperingRejected: caseObservation("test-tamper-rejection") === "rejected",
			fixtureSuiteRevision: verifier.fixtureSuiteRevision,
			fixtureSuiteDigest: verifier.fixtureSuiteDigest,
			harnessRevision: verifier.harnessRevision,
			evidenceRefs: input.calibration.cases.map((entry) => entry.evidenceRef),
		},
		duration: {
			observedDurationMs: input.observedDurationMs,
			limitMs: input.durationLimitMs,
		},
		issueCodes: Object.freeze([...new Set(input.issueCodes)].sort()),
	});
}

function validateExactCatalog(value: EmpiricalTaskCatalogV1): EmpiricalTaskCatalogV1 {
	const catalog = validateEmpiricalTaskCatalog(value);
	for (let index = 0; index < EXACT_FIVE_TASK_IDENTITIES.length; index += 1) {
		const identity = EXACT_FIVE_TASK_IDENTITIES[
			index
		] as (typeof EXACT_FIVE_TASK_IDENTITIES)[number];
		const task = catalog.tasks[index];
		if (
			task === undefined ||
			task.taskRef !== identity.taskRef ||
			task.repositoryRef !== "graphrefly-ts" ||
			task.sourceStratum !== identity.sourceStratum ||
			task.originalCommitSha !== identity.sourceCommitSha
		) {
			throw new TypeError(`B112 exact five-task catalog identity mismatch at index ${index}`);
		}
	}
	return catalog;
}

function validateOrderedMaterials(
	values: readonly ExactFiveTaskPrivateMaterialV1[],
	catalog: EmpiricalTaskCatalogV1,
): readonly ExactFiveTaskPrivateMaterialV1[] {
	const materialValues = array(values, "offlineQualification.materials");
	if (materialValues.length !== EXACT_FIVE_TASK_IDENTITIES.length) {
		throw new TypeError("B112 exact five-task private material set must contain five entries");
	}
	const snapshots: ExactFiveTaskPrivateMaterialV1[] = [];
	for (let index = 0; index < materialValues.length; index += 1) {
		const value = record(
			materialValues[index],
			`offlineQualification.materials[${index}]`,
		) as unknown as ExactFiveTaskPrivateMaterialV1;
		exactKeys(
			value as unknown as Record<string, unknown>,
			["calibrationCapability", "durationLimitMs", "overlay", "taskProfile", "taskRef"],
			`offlineQualification.materials[${index}]`,
		);
		const identity = EXACT_FIVE_TASK_IDENTITIES[index];
		const task = catalog.tasks[index];
		if (
			value === undefined ||
			identity === undefined ||
			task === undefined ||
			value.taskRef !== identity.taskRef ||
			value.taskProfile.taskRef !== identity.taskRef ||
			(identity.sourceStratum === "historical-pre-fix"
				? value.overlay !== null
				: value.overlay === null)
		) {
			throw new TypeError(`B112 exact five-task private material mismatch at index ${index}`);
		}
		const taskProfile = validateClosedTaskExecutionProfile(value.taskProfile, task);
		const capability = snapshotCalibrationCapability(value.calibrationCapability, task);
		snapshots.push(
			Object.freeze({
				taskRef: identity.taskRef,
				overlay: value.overlay === null ? null : validatePrivateRepositoryOverlay(value.overlay),
				taskProfile,
				calibrationCapability: capability,
				durationLimitMs: safeInteger(
					value.durationLimitMs,
					`offlineQualification.materials[${index}].durationLimitMs`,
					{ min: 1 },
				),
			}),
		);
	}
	return Object.freeze(snapshots);
}

function validateAllocators(
	values: readonly SingleBaselineWorkspaceAllocatorCapabilityV1[],
): readonly SingleBaselineWorkspaceAllocatorCapabilityV1[] {
	const allocatorValues = array(values, "offlineQualification.allocators");
	if (allocatorValues.length !== EXACT_FIVE_TASK_IDENTITIES.length) {
		throw new TypeError("B112 exact five-task allocator set must contain five entries");
	}
	const snapshots: SingleBaselineWorkspaceAllocatorCapabilityV1[] = [];
	for (let index = 0; index < allocatorValues.length; index += 1) {
		const value = record(
			allocatorValues[index],
			`offlineQualification.allocators[${index}]`,
		) as unknown as SingleBaselineWorkspaceAllocatorCapabilityV1;
		exactKeys(
			value as unknown as Record<string, unknown>,
			["allocate", "cleanup"],
			`offlineQualification.allocators[${index}]`,
		);
		if (typeof value.allocate !== "function" || typeof value.cleanup !== "function") {
			throw new TypeError("B112 exact five-task allocator capability is invalid");
		}
		const allocate = value.allocate.bind(value);
		const cleanup = value.cleanup.bind(value);
		snapshots.push(Object.freeze({ allocate, cleanup }));
	}
	return Object.freeze(snapshots);
}

function snapshotCalibrationCapability(
	value: ClosedVerifierCalibrationCapabilityV1,
	task: EmpiricalCampaignTaskV1,
): ClosedVerifierCalibrationCapabilityV1 {
	const capability = record(
		value,
		"offlineQualification.calibrationCapability",
	) as unknown as ClosedVerifierCalibrationCapabilityV1;
	exactKeys(
		capability as unknown as Record<string, unknown>,
		["runCase", "verifierProfileDigest", "verifierProfileRef", "verifierProfileRevision"],
		"offlineQualification.calibrationCapability",
	);
	if (
		capability.verifierProfileRef !== task.verifierProfileRef ||
		capability.verifierProfileRevision !== task.verifierProfileRevision ||
		capability.verifierProfileDigest !== task.verifierProfileDigest ||
		typeof capability.runCase !== "function"
	) {
		throw new TypeError("B112 exact five-task calibration capability mismatch");
	}
	const runCase = capability.runCase.bind(capability);
	return Object.freeze({
		verifierProfileRef: task.verifierProfileRef,
		verifierProfileRevision: task.verifierProfileRevision,
		verifierProfileDigest: task.verifierProfileDigest,
		runCase,
	});
}

function snapshotMonotonicClock(
	value: ExactFiveTaskOfflineQualificationInputV1["monotonicClock"],
): ExactFiveTaskOfflineQualificationInputV1["monotonicClock"] {
	const clock = record(value, "offlineQualification.monotonicClock");
	exactKeys(clock, ["readMs"], "offlineQualification.monotonicClock");
	if (typeof clock.readMs !== "function") {
		throw new TypeError("B112 exact five-task monotonic clock capability is invalid");
	}
	const readMs = clock.readMs.bind(value);
	return Object.freeze({ readMs });
}

function assertPreregisteredSmokeTask(template: ExactFiveTaskManifestTemplateV1): void {
	if (
		template.trialPlan.profile === "smoke" &&
		(template.trialPlan.activeTaskRefs.length !== 1 ||
			template.trialPlan.activeTaskRefs[0] !== EXACT_FIVE_TASK_IDENTITIES[0].taskRef)
	) {
		throw new TypeError("B112 exact five-task smoke task does not match preregistration");
	}
}

function validateWorkspaceEvidence(
	task: EmpiricalCampaignTaskV1,
	identity: (typeof EXACT_FIVE_TASK_IDENTITIES)[number],
	evidence: HistoryFreeSingleBaselineRepositoryEvidenceV1,
): void {
	if (
		evidence.repositoryRef !== "graphrefly-ts" ||
		evidence.sourceCommitSha !== identity.sourceCommitSha ||
		evidence.sourceTreeObjectId !== identity.sourceTreeObjectId ||
		evidence.originalTreeDigest !== task.originalTreeDigest ||
		evidence.actorTreeDigest !== task.actorTreeDigest ||
		evidence.overlayDigest !== task.overlayDigest ||
		evidence.repositoryState !== "clean-single-baseline" ||
		evidence.commitCount !== 1 ||
		evidence.parentCount !== 0 ||
		evidence.remotes !== 0 ||
		evidence.reflogs !== 0 ||
		evidence.unreachableObjects !== 0 ||
		evidence.sharedObjectStore ||
		!evidence.fullFilesystemMatch ||
		evidence.sourceHistoryVisible ||
		evidence.overlayVisibleAsDiff
	) {
		throw new TypeError("B112 exact five-task workspace evidence mismatch");
	}
}

function verifierProfileCoordinates(
	task: EmpiricalCampaignTaskV1,
	profile: ClosedTaskExecutionProfileV1,
): ClosedVerifierProfileCoordinatesV1 {
	return strictSnapshot({
		taskRef: task.taskRef,
		taskDigest: empiricalStrictJsonDigest(task),
		verifierProfileRef: task.verifierProfileRef,
		verifierProfileRevision: task.verifierProfileRevision,
		verifierProfileDigest: task.verifierProfileDigest,
		fixtureSuiteRef: profile.verifierProfile.fixtureSuiteRef,
		fixtureSuiteRevision: profile.verifierProfile.fixtureSuiteRevision,
		fixtureSuiteDigest: profile.verifierProfile.fixtureSuiteDigest,
		harnessRevision: profile.verifierProfile.harnessRevision,
	});
}

function classifyTaskFailure(taskRef: string, error: unknown): string {
	if (error instanceof SingleBaselineRepositoryMaterializationError) {
		return `${taskRef}:materialization-${error.code}`;
	}
	return `${taskRef}:offline-qualification-invalid`;
}

function readMonotonicMs(
	clock: ExactFiveTaskOfflineQualificationInputV1["monotonicClock"],
): number {
	return safeInteger(clock.readMs(), "offlineQualification.monotonicClock", { min: 0 });
}

function assertNotCancelled(signal: AbortSignal): void {
	if (signal.aborted) {
		throw new DOMException("exact five-task qualification cancelled", "AbortError");
	}
}
