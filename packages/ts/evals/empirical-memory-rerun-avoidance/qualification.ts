import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	assertCanonicalBytes,
	boolean,
	coordinate,
	deepFreeze,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	fail,
	literal,
	oneOf,
	record,
	safeInteger,
	sameBytes,
	strictSnapshot,
	string,
} from "./canonical.js";
import {
	EMPIRICAL_MEMORY_RERUN_AVOIDANCE_SCHEMAS,
	EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS,
	type EmpiricalCampaignTaskV1,
	type EmpiricalEvidenceRefV1,
	type EmpiricalQualificationEvidenceKind,
	type EmpiricalTaskCatalogV1,
	type EmpiricalTaskQualificationObservationV1,
	type EmpiricalTaskQualificationReportV1,
	type FrozenEmpiricalCampaignManifestV1,
} from "./contracts.js";
import {
	MAX_EMPIRICAL_CAMPAIGN_MANIFEST_BYTES,
	validateEmpiricalCampaignManifest,
	validateEmpiricalCampaignManifestBytes,
	validateEmpiricalTaskCatalog,
} from "./manifest.js";

const OBSERVATION_KEYS = Object.freeze([
	"commands",
	"duration",
	"issueCodes",
	"schemaVersion",
	"taskDigest",
	"taskRef",
	"verifierCalibration",
	"verifierProfileDigest",
	"verifierProfileRef",
	"verifierProfileRevision",
	"workspace",
]);

const QUALIFICATION_REPORT_KEYS = Object.freeze([
	"issueCodes",
	"observations",
	"qualified",
	"schemaVersion",
	"taskCatalogDigest",
]);

export const MAX_EMPIRICAL_TASK_QUALIFICATION_REPORT_BYTES = 1024 * 1024;

const TASK_SPECIFIC_EVIDENCE_KINDS = new Set<EmpiricalQualificationEvidenceKind>([
	"command-policy",
	"out-of-policy-diff-rejection",
	"target-defect-verifier",
	"workspace-isolation",
]);

function issueCodeList(value: unknown, path: string, max: number): readonly string[] {
	const raw = array(value, path);
	if (raw.length > max) fail(path, `expected at most ${max} entries`);
	const values = raw.map((entry, index) => coordinate(entry, `${path}[${index}]`));
	if (new Set(values).size !== values.length) fail(path, "expected unique entries");
	const sorted = [...values].sort();
	if (values.some((entry, index) => entry !== sorted[index])) {
		fail(path, "issue codes must be sorted");
	}
	return Object.freeze(sorted);
}

function validateEvidenceRefs(
	value: unknown,
	path: string,
	taskRef: string,
	taskDigest: string,
	verifierProfileRef: string,
	verifierProfileDigest: string,
	fixtureSuiteDigest: string,
	harnessRevision: string,
): readonly EmpiricalEvidenceRefV1[] {
	const refs = array(value, path);
	if (refs.length !== EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS.length) {
		fail(path, "expected the complete closed qualification evidence set");
	}
	const result = refs.map((value, index) => {
		const ref = record(value, `${path}[${index}]`);
		exactKeys(
			ref,
			[
				"digest",
				"fixtureSuiteDigest",
				"harnessRevision",
				"id",
				"kind",
				"subjectDigest",
				"subjectRef",
			],
			`${path}[${index}]`,
		);
		const kind = oneOf(
			ref.kind,
			EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS,
			`${path}[${index}].kind`,
		) as EmpiricalQualificationEvidenceKind;
		const subjectRef = string(ref.subjectRef, `${path}[${index}].subjectRef`);
		const subjectDigest = digest(ref.subjectDigest, `${path}[${index}].subjectDigest`);
		const evidenceFixtureSuiteDigest = digest(
			ref.fixtureSuiteDigest,
			`${path}[${index}].fixtureSuiteDigest`,
		);
		const evidenceHarnessRevision = coordinate(
			ref.harnessRevision,
			`${path}[${index}].harnessRevision`,
		);
		const expectedSubjectRef = TASK_SPECIFIC_EVIDENCE_KINDS.has(kind)
			? taskRef
			: verifierProfileRef;
		const expectedSubjectDigest = TASK_SPECIFIC_EVIDENCE_KINDS.has(kind)
			? taskDigest
			: verifierProfileDigest;
		if (subjectRef !== expectedSubjectRef || subjectDigest !== expectedSubjectDigest) {
			fail(
				`${path}[${index}]`,
				"evidence subject must match its exact task or verifier-profile identity",
			);
		}
		if (
			evidenceFixtureSuiteDigest !== fixtureSuiteDigest ||
			evidenceHarnessRevision !== harnessRevision
		) {
			fail(`${path}[${index}]`, "evidence must bind the exact fixture suite and harness revision");
		}
		return strictSnapshot({
			kind,
			id: coordinate(ref.id, `${path}[${index}].id`),
			digest: digest(ref.digest, `${path}[${index}].digest`),
			subjectRef,
			subjectDigest,
			fixtureSuiteDigest: evidenceFixtureSuiteDigest,
			harnessRevision: evidenceHarnessRevision,
		});
	});
	const identities = result.map((ref) => `${ref.kind}\u0000${ref.id}`);
	if (new Set(identities).size !== identities.length) {
		fail(path, "expected unique evidence identities");
	}
	const byKind = new Map(result.map((ref) => [ref.kind, ref] as const));
	if (
		EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS.some((kind) => !byKind.has(kind)) ||
		byKind.size !== EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS.length
	) {
		fail(path, "expected exactly one ref for each qualification evidence kind");
	}
	return Object.freeze(
		EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS.map(
			(kind) => byKind.get(kind) as EmpiricalEvidenceRefV1,
		),
	);
}

export function validateEmpiricalTaskQualificationObservation(
	value: unknown,
	path = "qualificationObservation",
): EmpiricalTaskQualificationObservationV1 {
	const observation = record(value, path);
	exactKeys(observation, OBSERVATION_KEYS, path);
	literal(
		observation.schemaVersion,
		EMPIRICAL_MEMORY_RERUN_AVOIDANCE_SCHEMAS.taskQualificationObservation,
		`${path}.schemaVersion`,
	);
	const workspace = record(observation.workspace, `${path}.workspace`);
	exactKeys(
		workspace,
		[
			"actorTreeDigest",
			"cleanupFailureClassifiedNonEvaluable",
			"descendantHistoryVisible",
			"environmentDigest",
			"expectedPatchVisible",
			"freshMaterializationVerified",
			"hiddenVerifierMaterialVisible",
			"overlayVisibleAsDiff",
			"remotes",
			"repositoryState",
			"sharedCacheMode",
			"toolchainDigest",
			"uncommittedChanges",
			"workspaceRecipeDigest",
			"workspaceRecipeRef",
			"workspaceRecipeRevision",
		],
		`${path}.workspace`,
	);
	const commands = record(observation.commands, `${path}.commands`);
	exactKeys(
		commands,
		[
			"containerRuntimeAllowed",
			"credentialAccessAllowed",
			"networkAllowed",
			"outOfTreeWritesAllowed",
			"policyRef",
			"policyRevision",
			"policyDigest",
			"resolved",
		],
		`${path}.commands`,
	);
	const verifier = record(observation.verifierCalibration, `${path}.verifierCalibration`);
	exactKeys(
		verifier,
		[
			"actorClaimsCanSatisfy",
			"evidenceComplete",
			"evidenceRefs",
			"executable",
			"fixtureSuiteDigest",
			"fixtureSuiteRevision",
			"harnessRevision",
			"knownGoodVerdict",
			"missingEvidenceClassifiedNonEvaluable",
			"nonExecutableEvidenceClassifiedNonEvaluable",
			"outOfPolicyDiffRejected",
			"plausibleWrongVerdict",
			"targetDefectVerdict",
			"testTamperingRejected",
			"unreliableEvidenceClassifiedNonEvaluable",
			"verifierTamperingRejected",
		],
		`${path}.verifierCalibration`,
	);
	const duration = record(observation.duration, `${path}.duration`);
	exactKeys(duration, ["limitMs", "observedDurationMs"], `${path}.duration`);
	const taskRef = coordinate(observation.taskRef, `${path}.taskRef`);
	const taskDigest = digest(observation.taskDigest, `${path}.taskDigest`);
	const verifierProfileRef = coordinate(
		observation.verifierProfileRef,
		`${path}.verifierProfileRef`,
	);
	const verifierProfileRevision = string(
		observation.verifierProfileRevision,
		`${path}.verifierProfileRevision`,
	);
	const verifierProfileDigest = digest(
		observation.verifierProfileDigest,
		`${path}.verifierProfileDigest`,
	);
	const fixtureSuiteDigest = digest(
		verifier.fixtureSuiteDigest,
		`${path}.verifierCalibration.fixtureSuiteDigest`,
	);
	const harnessRevision = coordinate(
		verifier.harnessRevision,
		`${path}.verifierCalibration.harnessRevision`,
	);
	return strictSnapshot({
		schemaVersion: EMPIRICAL_MEMORY_RERUN_AVOIDANCE_SCHEMAS.taskQualificationObservation,
		taskRef,
		taskDigest,
		verifierProfileRef,
		verifierProfileRevision,
		verifierProfileDigest,
		workspace: {
			actorTreeDigest: digest(workspace.actorTreeDigest, `${path}.workspace.actorTreeDigest`),
			workspaceRecipeRef: string(
				workspace.workspaceRecipeRef,
				`${path}.workspace.workspaceRecipeRef`,
			),
			workspaceRecipeRevision: string(
				workspace.workspaceRecipeRevision,
				`${path}.workspace.workspaceRecipeRevision`,
			),
			workspaceRecipeDigest: digest(
				workspace.workspaceRecipeDigest,
				`${path}.workspace.workspaceRecipeDigest`,
			),
			environmentDigest: digest(workspace.environmentDigest, `${path}.workspace.environmentDigest`),
			toolchainDigest: digest(workspace.toolchainDigest, `${path}.workspace.toolchainDigest`),
			repositoryState: oneOf(
				workspace.repositoryState,
				["clean-single-baseline", "other"],
				`${path}.workspace.repositoryState`,
			),
			remotes: safeInteger(workspace.remotes, `${path}.workspace.remotes`, {
				max: 1_000,
			}),
			descendantHistoryVisible: boolean(
				workspace.descendantHistoryVisible,
				`${path}.workspace.descendantHistoryVisible`,
			),
			uncommittedChanges: boolean(
				workspace.uncommittedChanges,
				`${path}.workspace.uncommittedChanges`,
			),
			overlayVisibleAsDiff: boolean(
				workspace.overlayVisibleAsDiff,
				`${path}.workspace.overlayVisibleAsDiff`,
			),
			hiddenVerifierMaterialVisible: boolean(
				workspace.hiddenVerifierMaterialVisible,
				`${path}.workspace.hiddenVerifierMaterialVisible`,
			),
			expectedPatchVisible: boolean(
				workspace.expectedPatchVisible,
				`${path}.workspace.expectedPatchVisible`,
			),
			freshMaterializationVerified: boolean(
				workspace.freshMaterializationVerified,
				`${path}.workspace.freshMaterializationVerified`,
			),
			sharedCacheMode: oneOf(
				workspace.sharedCacheMode,
				["none", "readonly", "mutable"],
				`${path}.workspace.sharedCacheMode`,
			),
			cleanupFailureClassifiedNonEvaluable: boolean(
				workspace.cleanupFailureClassifiedNonEvaluable,
				`${path}.workspace.cleanupFailureClassifiedNonEvaluable`,
			),
		},
		commands: {
			policyRef: string(commands.policyRef, `${path}.commands.policyRef`),
			policyRevision: string(commands.policyRevision, `${path}.commands.policyRevision`),
			policyDigest: digest(commands.policyDigest, `${path}.commands.policyDigest`),
			resolved: boolean(commands.resolved, `${path}.commands.resolved`),
			networkAllowed: boolean(commands.networkAllowed, `${path}.commands.networkAllowed`),
			containerRuntimeAllowed: boolean(
				commands.containerRuntimeAllowed,
				`${path}.commands.containerRuntimeAllowed`,
			),
			credentialAccessAllowed: boolean(
				commands.credentialAccessAllowed,
				`${path}.commands.credentialAccessAllowed`,
			),
			outOfTreeWritesAllowed: boolean(
				commands.outOfTreeWritesAllowed,
				`${path}.commands.outOfTreeWritesAllowed`,
			),
		},
		verifierCalibration: {
			executable: boolean(verifier.executable, `${path}.verifierCalibration.executable`),
			targetDefectVerdict: oneOf(
				verifier.targetDefectVerdict,
				["passed", "failed", "unverifiable"],
				`${path}.verifierCalibration.targetDefectVerdict`,
			),
			knownGoodVerdict: oneOf(
				verifier.knownGoodVerdict,
				["passed", "failed", "unverifiable"],
				`${path}.verifierCalibration.knownGoodVerdict`,
			),
			plausibleWrongVerdict: oneOf(
				verifier.plausibleWrongVerdict,
				["passed", "failed", "unverifiable"],
				`${path}.verifierCalibration.plausibleWrongVerdict`,
			),
			actorClaimsCanSatisfy: boolean(
				verifier.actorClaimsCanSatisfy,
				`${path}.verifierCalibration.actorClaimsCanSatisfy`,
			),
			verifierTamperingRejected: boolean(
				verifier.verifierTamperingRejected,
				`${path}.verifierCalibration.verifierTamperingRejected`,
			),
			outOfPolicyDiffRejected: boolean(
				verifier.outOfPolicyDiffRejected,
				`${path}.verifierCalibration.outOfPolicyDiffRejected`,
			),
			evidenceComplete: boolean(
				verifier.evidenceComplete,
				`${path}.verifierCalibration.evidenceComplete`,
			),
			missingEvidenceClassifiedNonEvaluable: boolean(
				verifier.missingEvidenceClassifiedNonEvaluable,
				`${path}.verifierCalibration.missingEvidenceClassifiedNonEvaluable`,
			),
			unreliableEvidenceClassifiedNonEvaluable: boolean(
				verifier.unreliableEvidenceClassifiedNonEvaluable,
				`${path}.verifierCalibration.unreliableEvidenceClassifiedNonEvaluable`,
			),
			nonExecutableEvidenceClassifiedNonEvaluable: boolean(
				verifier.nonExecutableEvidenceClassifiedNonEvaluable,
				`${path}.verifierCalibration.nonExecutableEvidenceClassifiedNonEvaluable`,
			),
			testTamperingRejected: boolean(
				verifier.testTamperingRejected,
				`${path}.verifierCalibration.testTamperingRejected`,
			),
			fixtureSuiteRevision: string(
				verifier.fixtureSuiteRevision,
				`${path}.verifierCalibration.fixtureSuiteRevision`,
			),
			fixtureSuiteDigest,
			harnessRevision,
			evidenceRefs: validateEvidenceRefs(
				verifier.evidenceRefs,
				`${path}.verifierCalibration.evidenceRefs`,
				taskRef,
				taskDigest,
				verifierProfileRef,
				verifierProfileDigest,
				fixtureSuiteDigest,
				harnessRevision,
			),
		},
		duration: {
			observedDurationMs: safeInteger(
				duration.observedDurationMs,
				`${path}.duration.observedDurationMs`,
			),
			limitMs: safeInteger(duration.limitMs, `${path}.duration.limitMs`, {
				min: 1,
			}),
		},
		issueCodes: issueCodeList(observation.issueCodes, `${path}.issueCodes`, 32),
	});
}

function taskQualificationIssues(
	task: EmpiricalCampaignTaskV1,
	observation: EmpiricalTaskQualificationObservationV1,
): readonly string[] {
	const issues: string[] = [];
	const add = (condition: boolean, code: string): void => {
		if (condition) issues.push(`${task.taskRef}:${code}`);
	};
	add(observation.taskDigest !== empiricalStrictJsonDigest(task), "task-digest-mismatch");
	add(observation.verifierProfileRef !== task.verifierProfileRef, "verifier-profile-ref-mismatch");
	add(
		observation.verifierProfileRevision !== task.verifierProfileRevision,
		"verifier-profile-revision-mismatch",
	);
	add(
		observation.verifierProfileDigest !== task.verifierProfileDigest,
		"verifier-profile-digest-mismatch",
	);
	add(observation.workspace.actorTreeDigest !== task.actorTreeDigest, "actor-tree-digest-mismatch");
	add(
		observation.workspace.repositoryState !== "clean-single-baseline",
		"workspace-not-clean-single-baseline",
	);
	add(observation.workspace.remotes !== 0, "workspace-remotes-visible");
	add(observation.workspace.descendantHistoryVisible, "workspace-descendant-history-visible");
	add(observation.workspace.uncommittedChanges, "workspace-uncommitted-changes");
	add(observation.workspace.overlayVisibleAsDiff, "workspace-overlay-visible-as-diff");
	add(
		observation.workspace.hiddenVerifierMaterialVisible,
		"workspace-hidden-verifier-material-visible",
	);
	add(observation.workspace.expectedPatchVisible, "workspace-expected-patch-visible");
	add(
		observation.workspace.workspaceRecipeRef !== task.workspaceRecipeRef,
		"workspace-recipe-ref-mismatch",
	);
	add(
		observation.workspace.workspaceRecipeRevision !== task.workspaceRecipeRevision,
		"workspace-recipe-revision-mismatch",
	);
	add(
		observation.workspace.workspaceRecipeDigest !== task.workspaceRecipeDigest,
		"workspace-recipe-digest-mismatch",
	);
	add(
		observation.workspace.environmentDigest !== task.environmentDigest,
		"environment-digest-mismatch",
	);
	add(observation.workspace.toolchainDigest !== task.toolchainDigest, "toolchain-digest-mismatch");
	add(!observation.workspace.freshMaterializationVerified, "fresh-materialization-not-verified");
	add(observation.workspace.sharedCacheMode === "mutable", "mutable-shared-cache");
	add(
		!observation.workspace.cleanupFailureClassifiedNonEvaluable,
		"cleanup-failure-not-classified-non-evaluable",
	);
	add(
		observation.commands.policyRef !== task.allowedCommandPolicyRef,
		"command-policy-ref-mismatch",
	);
	add(
		observation.commands.policyRevision !== task.allowedCommandPolicyRevision,
		"command-policy-revision-mismatch",
	);
	add(
		observation.commands.policyDigest !== task.allowedCommandPolicyDigest,
		"command-policy-digest-mismatch",
	);
	add(!observation.commands.resolved, "command-policy-unresolved");
	add(observation.commands.networkAllowed, "network-command-authority-present");
	add(observation.commands.containerRuntimeAllowed, "container-runtime-command-authority-present");
	add(observation.commands.credentialAccessAllowed, "credential-command-authority-present");
	add(observation.commands.outOfTreeWritesAllowed, "out-of-tree-write-authority-present");
	add(!observation.verifierCalibration.executable, "verifier-not-executable");
	add(
		observation.verifierCalibration.targetDefectVerdict !== "failed",
		"target-defect-not-rejected",
	);
	add(observation.verifierCalibration.knownGoodVerdict !== "passed", "known-good-not-accepted");
	add(
		observation.verifierCalibration.plausibleWrongVerdict !== "failed",
		"plausible-wrong-not-rejected",
	);
	add(observation.verifierCalibration.actorClaimsCanSatisfy, "actor-claim-can-satisfy-verifier");
	add(
		!observation.verifierCalibration.verifierTamperingRejected,
		"verifier-tampering-not-rejected",
	);
	add(!observation.verifierCalibration.outOfPolicyDiffRejected, "out-of-policy-diff-not-rejected");
	add(!observation.verifierCalibration.evidenceComplete, "verifier-evidence-incomplete");
	add(
		!observation.verifierCalibration.missingEvidenceClassifiedNonEvaluable,
		"missing-evidence-not-classified-non-evaluable",
	);
	add(
		!observation.verifierCalibration.unreliableEvidenceClassifiedNonEvaluable,
		"unreliable-evidence-not-classified-non-evaluable",
	);
	add(
		!observation.verifierCalibration.nonExecutableEvidenceClassifiedNonEvaluable,
		"non-executable-evidence-not-classified-non-evaluable",
	);
	add(!observation.verifierCalibration.testTamperingRejected, "test-tampering-not-rejected");
	add(
		observation.duration.observedDurationMs > observation.duration.limitMs,
		"qualification-duration-exceeded",
	);
	add(observation.issueCodes.length > 0, "observation-has-issues");
	return Object.freeze(issues);
}

export function empiricalTaskCatalogDigest(catalog: EmpiricalTaskCatalogV1): string {
	return empiricalStrictJsonDigest(validateEmpiricalTaskCatalog(catalog));
}

export function createEmpiricalTaskQualificationReport(
	catalogValue: unknown,
	observationValues: readonly unknown[],
): EmpiricalTaskQualificationReportV1 {
	const catalog = validateEmpiricalTaskCatalog(catalogValue);
	if (observationValues.length > 16) {
		fail("qualificationReport.observations", "expected at most 16 bounded observations");
	}
	const validatedObservations = observationValues.map((observation, index) =>
		validateEmpiricalTaskQualificationObservation(
			observation,
			`qualificationReport.observations[${index}]`,
		),
	);
	const evidenceSubjects = new Map<string, string>();
	for (const observation of validatedObservations) {
		for (const ref of observation.verifierCalibration.evidenceRefs) {
			const subject = empiricalStrictJsonDigest([ref.subjectRef, ref.subjectDigest]);
			for (const coordinate of [
				empiricalStrictJsonDigest([ref.kind, "id", ref.id]),
				empiricalStrictJsonDigest(["digest", ref.digest]),
			]) {
				const priorSubject = evidenceSubjects.get(coordinate);
				if (priorSubject !== undefined && priorSubject !== subject) {
					fail(
						"qualificationReport.observations",
						"evidence identity or digest cannot be reused across different subjects",
					);
				}
				evidenceSubjects.set(coordinate, subject);
			}
		}
	}
	const catalogOrder = new Map(catalog.tasks.map((task, index) => [task.taskRef, index] as const));
	const observations = [...validatedObservations].sort((left, right) => {
		const leftOrder = catalogOrder.get(left.taskRef) ?? Number.MAX_SAFE_INTEGER;
		const rightOrder = catalogOrder.get(right.taskRef) ?? Number.MAX_SAFE_INTEGER;
		if (leftOrder !== rightOrder) return leftOrder - rightOrder;
		if (left.taskRef !== right.taskRef) return left.taskRef < right.taskRef ? -1 : 1;
		const leftDigest = empiricalStrictJsonDigest(left);
		const rightDigest = empiricalStrictJsonDigest(right);
		return leftDigest < rightDigest ? -1 : leftDigest > rightDigest ? 1 : 0;
	});
	const issues: string[] = [];
	const byTaskRef = new Map<string, EmpiricalTaskQualificationObservationV1[]>();
	for (const observation of observations) {
		const current = byTaskRef.get(observation.taskRef) ?? [];
		current.push(observation);
		byTaskRef.set(observation.taskRef, current);
	}
	for (const task of catalog.tasks) {
		const matches = byTaskRef.get(task.taskRef) ?? [];
		if (matches.length === 0) {
			issues.push(`${task.taskRef}:qualification-observation-missing`);
			continue;
		}
		if (matches.length > 1) {
			issues.push(`${task.taskRef}:qualification-observation-duplicate`);
			continue;
		}
		issues.push(
			...taskQualificationIssues(task, matches[0] as EmpiricalTaskQualificationObservationV1),
		);
	}
	const catalogRefs = new Set(catalog.tasks.map((task) => task.taskRef));
	for (const taskRef of byTaskRef.keys()) {
		if (!catalogRefs.has(taskRef)) issues.push(`${taskRef}:qualification-observation-unknown-task`);
	}
	const uniqueIssues = [...new Set(issues)].sort();
	if (uniqueIssues.length > 64) {
		fail(
			"qualificationReport.issueCodes",
			"derived qualification issues exceed the bounded report",
		);
	}
	const issueCodes = Object.freeze(uniqueIssues);
	return strictSnapshot({
		schemaVersion: EMPIRICAL_MEMORY_RERUN_AVOIDANCE_SCHEMAS.taskQualificationReport,
		taskCatalogDigest: empiricalTaskCatalogDigest(catalog),
		observations,
		qualified: issueCodes.length === 0,
		issueCodes,
	});
}

export function validateEmpiricalTaskQualificationReport(
	value: unknown,
	catalogValue: unknown,
): EmpiricalTaskQualificationReportV1 {
	const report = record(value, "qualificationReport");
	exactKeys(report, QUALIFICATION_REPORT_KEYS, "qualificationReport");
	literal(
		report.schemaVersion,
		EMPIRICAL_MEMORY_RERUN_AVOIDANCE_SCHEMAS.taskQualificationReport,
		"qualificationReport.schemaVersion",
	);
	const observationValues = array(report.observations, "qualificationReport.observations");
	if (observationValues.length > 16) {
		fail("qualificationReport.observations", "expected at most 16 bounded observations");
	}
	const observations = observationValues.map((observation, index) =>
		validateEmpiricalTaskQualificationObservation(
			observation,
			`qualificationReport.observations[${index}]`,
		),
	);
	const issueCodes = issueCodeList(report.issueCodes, "qualificationReport.issueCodes", 64);
	const qualified = boolean(report.qualified, "qualificationReport.qualified");
	if (qualified !== (issueCodes.length === 0)) {
		fail("qualificationReport.qualified", "must equal issueCodes.length === 0");
	}
	const parsed = strictSnapshot({
		schemaVersion: EMPIRICAL_MEMORY_RERUN_AVOIDANCE_SCHEMAS.taskQualificationReport,
		taskCatalogDigest: digest(report.taskCatalogDigest, "qualificationReport.taskCatalogDigest"),
		observations,
		qualified,
		issueCodes,
	});
	const recomputed = createEmpiricalTaskQualificationReport(catalogValue, parsed.observations);
	if (!sameBytes(strictJsonCodec.encode(parsed), strictJsonCodec.encode(recomputed))) {
		fail("qualificationReport", "does not match the supplied catalog and observations");
	}
	return parsed;
}

export function validateEmpiricalTaskQualificationReportBytes(
	bytes: Uint8Array,
	catalogValue: unknown,
): EmpiricalTaskQualificationReportV1 {
	if (bytes.byteLength === 0 || bytes.byteLength > MAX_EMPIRICAL_TASK_QUALIFICATION_REPORT_BYTES) {
		fail(
			"qualificationReport",
			`expected between 1 and ${MAX_EMPIRICAL_TASK_QUALIFICATION_REPORT_BYTES} canonical bytes`,
		);
	}
	const decoded = strictJsonCodec.decode(bytes);
	assertCanonicalBytes(decoded, bytes, "qualificationReport");
	return deepFreeze(validateEmpiricalTaskQualificationReport(decoded, catalogValue));
}

export function freezeEmpiricalCampaignManifest(
	manifestValue: unknown,
	qualificationReportValue: unknown,
): FrozenEmpiricalCampaignManifestV1 {
	const manifest = validateEmpiricalCampaignManifest(manifestValue);
	const report = validateEmpiricalTaskQualificationReport(
		qualificationReportValue,
		manifest.catalog,
	);
	if (!report.qualified) {
		fail("qualificationReport", `catalog is not qualified: ${JSON.stringify(report.issueCodes)}`);
	}
	const canonical = strictJsonCodec.encode(manifest);
	validateEmpiricalCampaignManifestBytes(canonical);
	const reportDigest = empiricalSha256(strictJsonCodec.encode(report));
	if (manifest.qualification.reportDigest !== reportDigest) {
		fail("manifest.qualification.reportDigest", "does not match qualification report");
	}
	if (manifest.qualification.taskCatalogDigest !== report.taskCatalogDigest) {
		fail("manifest.qualification.taskCatalogDigest", "does not match qualification report");
	}
	return Object.freeze({
		manifest,
		canonicalBytes: Object.freeze([...canonical]),
		manifestDigest: empiricalSha256(canonical),
		taskCatalogDigest: empiricalTaskCatalogDigest(manifest.catalog),
	});
}

export function validateFrozenEmpiricalCampaignManifest(
	frozen: FrozenEmpiricalCampaignManifestV1,
	qualificationReportValue: unknown,
): FrozenEmpiricalCampaignManifestV1 {
	const canonicalValues = array(frozen.canonicalBytes, "frozenManifest.canonicalBytes");
	if (
		canonicalValues.length === 0 ||
		canonicalValues.length > MAX_EMPIRICAL_CAMPAIGN_MANIFEST_BYTES
	) {
		fail(
			"frozenManifest.canonicalBytes",
			`expected between 1 and ${MAX_EMPIRICAL_CAMPAIGN_MANIFEST_BYTES} bytes`,
		);
	}
	for (let index = 0; index < canonicalValues.length; index += 1) {
		safeInteger(canonicalValues[index], `frozenManifest.canonicalBytes[${index}]`, { max: 255 });
	}
	digest(frozen.manifestDigest, "frozenManifest.manifestDigest");
	digest(frozen.taskCatalogDigest, "frozenManifest.taskCatalogDigest");
	const bytes = new Uint8Array(frozen.canonicalBytes);
	const manifest = validateEmpiricalCampaignManifestBytes(bytes);
	if (!sameBytes(bytes, strictJsonCodec.encode(frozen.manifest))) {
		fail("frozenManifest.canonicalBytes", "do not match manifest");
	}
	if (frozen.manifestDigest !== empiricalSha256(bytes)) {
		fail("frozenManifest.manifestDigest", "does not match canonical bytes");
	}
	if (frozen.taskCatalogDigest !== empiricalTaskCatalogDigest(manifest.catalog)) {
		fail("frozenManifest.taskCatalogDigest", "does not match manifest catalog");
	}
	return freezeEmpiricalCampaignManifest(manifest, qualificationReportValue);
}
