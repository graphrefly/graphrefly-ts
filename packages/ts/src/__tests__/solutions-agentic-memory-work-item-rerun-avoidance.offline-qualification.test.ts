import { vi } from "vitest";

const materialize = vi.hoisted(() => vi.fn());

vi.mock(
	"../../evals/empirical-memory-rerun-avoidance/single-baseline-repository-node.js",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("../../evals/empirical-memory-rerun-avoidance/single-baseline-repository-node.js")
		>()),
		materializeHistoryFreeSingleBaselineRepository: materialize,
	}),
);

import { beforeEach, describe, expect, it } from "vitest";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	strictSnapshot,
} from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	PRIVATE_REPOSITORY_OVERLAY_SCHEMA_VERSION,
	type PrivateRepositoryOverlayV1,
} from "../../evals/empirical-memory-rerun-avoidance/canonical-repository-tree.js";
import {
	CLOSED_TASK_PROFILE_HOST_SCHEMAS,
	type ClosedCommandPolicyV1,
	type ClosedTaskExecutionProfileV1,
	type ClosedVerifierProfileV1,
	type ClosedWorkspaceRecipeV1,
} from "../../evals/empirical-memory-rerun-avoidance/closed-task-profile-host.js";
import {
	CLOSED_VERIFIER_CALIBRATION_SCHEMAS,
	type ClosedVerifierCalibrationCapabilityV1,
} from "../../evals/empirical-memory-rerun-avoidance/closed-task-profile-verifier-calibration.js";
import {
	EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS,
	type EmpiricalCampaignTaskV1,
	type EmpiricalTaskCatalogV1,
} from "../../evals/empirical-memory-rerun-avoidance/contracts.js";
import {
	EXACT_FIVE_TASK_IDENTITIES,
	type ExactFiveTaskManifestTemplateV1,
	type ExactFiveTaskPrivateMaterialV1,
	runExactFiveTaskOfflineQualification,
} from "../../evals/empirical-memory-rerun-avoidance/exact-five-task-offline-qualification.js";
import { createEmpiricalTaskQualificationReport } from "../../evals/empirical-memory-rerun-avoidance/qualification.js";
import {
	buildEmpiricalCampaignManifestFixture,
	buildEmpiricalQualificationObservationFixture,
} from "./eval-support/empirical-memory-rerun-avoidance/fixtures.js";

const encoder = new TextEncoder();

interface QualificationFixture {
	readonly catalog: EmpiricalTaskCatalogV1;
	readonly materials: readonly ExactFiveTaskPrivateMaterialV1[];
	readonly manifestTemplate: ExactFiveTaskManifestTemplateV1;
}

beforeEach(() => {
	materialize.mockReset();
});

describe("B112 exact five-task offline qualification orchestrator contract", () => {
	it("assembles the frozen 3+2 contract model and freezes a manifest without a model port", async () => {
		const fixture = qualificationFixture();
		const cleanup = vi.fn(async () => undefined);
		materialize.mockImplementation(async (_source, _allocator, request) => {
			const index = EXACT_FIVE_TASK_IDENTITIES.findIndex(
				(identity) => identity.sourceCommitSha === request.sourceCommitSha,
			);
			const task =
				fixture.catalog.tasks[
					request.overlay === null
						? index
						: request.overlay.replacements[0]?.path === "held-out-3.txt"
							? 3
							: 4
				];
			const identity = EXACT_FIVE_TASK_IDENTITIES.find(
				(candidate) => candidate.taskRef === task?.taskRef,
			);
			if (task === undefined || identity === undefined) throw new Error("unexpected task");
			return {
				workspace: {
					kind: "graphrefly.private-solution-eval.single-baseline-workspace.v1",
					rootPathForHostRunner: () => "/private/not-exposed",
				},
				evidence: workspaceEvidence(task, identity.sourceTreeObjectId),
				cleanup,
			};
		});
		let clock = 10_000;

		const result = await runExactFiveTaskOfflineQualification({
			source: { repositoryRef: "graphrefly-ts", rootPath: "/source/not-read-by-mock" },
			catalog: fixture.catalog,
			materials: fixture.materials,
			allocators: fixture.materials.map(() => allocator()),
			manifestTemplate: fixture.manifestTemplate,
			qualificationRevision: "exact-five-task-offline-qualification.v1",
			monotonicClock: { readMs: () => (clock += 10) },
			signal: new AbortController().signal,
		});

		expect(result.issueCodes).toEqual([]);
		expect(result.qualified).toBe(true);
		expect(result.qualificationReport.observations.map((entry) => entry.taskRef)).toEqual(
			EXACT_FIVE_TASK_IDENTITIES.map((identity) => identity.taskRef),
		);
		expect(result.frozenManifest?.manifest.catalog).toEqual(fixture.catalog);
		expect(result.frozenManifest?.manifest.trialPlan).toMatchObject({
			profile: "smoke",
			activeTaskRefs: [EXACT_FIVE_TASK_IDENTITIES[0].taskRef],
		});
		expect(materialize).toHaveBeenCalledTimes(5);
		expect(cleanup).toHaveBeenCalledTimes(5);
		expect(materialize.mock.calls.map((call) => call[2].sourceTreeObjectId)).toEqual(
			EXACT_FIVE_TASK_IDENTITIES.map((identity) => identity.sourceTreeObjectId),
		);
	});

	it("fails closed and withholds the frozen manifest when exact cleanup evidence is unavailable", async () => {
		const fixture = qualificationFixture();
		let callIndex = 0;
		materialize.mockImplementation(async (_source, _allocator, _request) => {
			const task = fixture.catalog.tasks[callIndex];
			const identity = EXACT_FIVE_TASK_IDENTITIES[callIndex];
			const current = callIndex;
			callIndex += 1;
			if (task === undefined || identity === undefined) throw new Error("unexpected task");
			return {
				workspace: {
					kind: "graphrefly.private-solution-eval.single-baseline-workspace.v1",
					rootPathForHostRunner: () => "/private/not-exposed",
				},
				evidence: workspaceEvidence(task, identity.sourceTreeObjectId),
				cleanup: async () => {
					if (current === 2) throw new Error("private cleanup detail");
				},
			};
		});
		let clock = 20_000;

		const result = await runExactFiveTaskOfflineQualification({
			source: { repositoryRef: "graphrefly-ts", rootPath: "/source/not-read-by-mock" },
			catalog: fixture.catalog,
			materials: fixture.materials,
			allocators: fixture.materials.map(() => allocator()),
			manifestTemplate: fixture.manifestTemplate,
			qualificationRevision: "exact-five-task-offline-qualification.v1",
			monotonicClock: { readMs: () => (clock += 10) },
			signal: new AbortController().signal,
		});

		expect(result.qualified).toBe(false);
		expect(result.frozenManifest).toBeNull();
		expect(result.issueCodes).toContain(
			`${EXACT_FIVE_TASK_IDENTITIES[2].taskRef}:workspace-cleanup-failed`,
		);
		expect(result.issueCodes).toContain(
			`${EXACT_FIVE_TASK_IDENTITIES[2].taskRef}:observation-has-issues`,
		);
		expect(JSON.stringify(result)).not.toContain("private cleanup detail");
	});

	it("classifies a regressing host clock instead of accepting fabricated duration evidence", async () => {
		const fixture = qualificationFixture();
		let callIndex = 0;
		materialize.mockImplementation(async () => {
			const task = fixture.catalog.tasks[callIndex];
			const identity = EXACT_FIVE_TASK_IDENTITIES[callIndex];
			callIndex += 1;
			if (task === undefined || identity === undefined) throw new Error("unexpected task");
			return {
				workspace: {
					kind: "graphrefly.private-solution-eval.single-baseline-workspace.v1",
					rootPathForHostRunner: () => "/private/not-exposed",
				},
				evidence: workspaceEvidence(task, identity.sourceTreeObjectId),
				cleanup: async () => undefined,
			};
		});
		const readings = [100, 90, 200, 210, 300, 310, 400, 410, 500, 510];

		const result = await runExactFiveTaskOfflineQualification({
			source: { repositoryRef: "graphrefly-ts", rootPath: "/source/not-read-by-mock" },
			catalog: fixture.catalog,
			materials: fixture.materials,
			allocators: fixture.materials.map(() => allocator()),
			manifestTemplate: fixture.manifestTemplate,
			qualificationRevision: "exact-five-task-offline-qualification.v1",
			monotonicClock: { readMs: () => readings.shift() ?? 1_000 },
			signal: new AbortController().signal,
		});

		expect(result.qualified).toBe(false);
		expect(result.frozenManifest).toBeNull();
		expect(result.issueCodes).toContain(
			`${EXACT_FIVE_TASK_IDENTITIES[0].taskRef}:monotonic-clock-regression`,
		);
	});

	it("observes cancellation raised during final cleanup before report or manifest freeze", async () => {
		const fixture = qualificationFixture();
		const controller = new AbortController();
		const cleanup = vi.fn(async () => undefined);
		let callIndex = 0;
		materialize.mockImplementation(async () => {
			const task = fixture.catalog.tasks[callIndex];
			const identity = EXACT_FIVE_TASK_IDENTITIES[callIndex];
			const current = callIndex;
			callIndex += 1;
			if (task === undefined || identity === undefined) throw new Error("unexpected task");
			return {
				workspace: {
					kind: "graphrefly.private-solution-eval.single-baseline-workspace.v1",
					rootPathForHostRunner: () => "/private/not-exposed",
				},
				evidence: workspaceEvidence(task, identity.sourceTreeObjectId),
				cleanup: async () => {
					await cleanup();
					if (current === 4) controller.abort();
				},
			};
		});
		let clock = 30_000;

		await expect(
			runExactFiveTaskOfflineQualification({
				source: { repositoryRef: "graphrefly-ts", rootPath: "/source/not-read-by-mock" },
				catalog: fixture.catalog,
				materials: fixture.materials,
				allocators: fixture.materials.map(() => allocator()),
				manifestTemplate: fixture.manifestTemplate,
				qualificationRevision: "exact-five-task-offline-qualification.v1",
				monotonicClock: { readMs: () => (clock += 10) },
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(cleanup).toHaveBeenCalledTimes(5);
	});

	it("rejects a smoke manifest that selects a task other than the preregistered first task", async () => {
		const fixture = qualificationFixture();
		const manifestTemplate: ExactFiveTaskManifestTemplateV1 = {
			...fixture.manifestTemplate,
			trialPlan: {
				...fixture.manifestTemplate.trialPlan,
				profile: "smoke",
				activeTaskRefs: [EXACT_FIVE_TASK_IDENTITIES[1].taskRef],
				attemptedColdBlocksPerTask: 1,
			},
		};

		await expect(
			runExactFiveTaskOfflineQualification({
				source: { repositoryRef: "graphrefly-ts", rootPath: "/source/not-read-by-mock" },
				catalog: fixture.catalog,
				materials: fixture.materials,
				allocators: fixture.materials.map(() => allocator()),
				manifestTemplate,
				qualificationRevision: "exact-five-task-offline-qualification.v1",
				monotonicClock: { readMs: () => 1 },
				signal: new AbortController().signal,
			}),
		).rejects.toThrow(/smoke task does not match preregistration/);
		expect(materialize).not.toHaveBeenCalled();
	});

	it("snapshots preregistered materials and manifest data before the first async boundary", async () => {
		const fixture = qualificationFixture();
		const materials = [...fixture.materials];
		const manifestTemplate = structuredClone(fixture.manifestTemplate);
		let releaseFirst: (() => void) | undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let callIndex = 0;
		materialize.mockImplementation(async () => {
			const task = fixture.catalog.tasks[callIndex];
			const identity = EXACT_FIVE_TASK_IDENTITIES[callIndex];
			const current = callIndex;
			callIndex += 1;
			if (current === 0) await firstGate;
			if (task === undefined || identity === undefined) throw new Error("unexpected task");
			return {
				workspace: {
					kind: "graphrefly.private-solution-eval.single-baseline-workspace.v1",
					rootPathForHostRunner: () => "/private/not-exposed",
				},
				evidence: workspaceEvidence(task, identity.sourceTreeObjectId),
				cleanup: async () => undefined,
			};
		});
		let clock = 40_000;
		const run = runExactFiveTaskOfflineQualification({
			source: { repositoryRef: "graphrefly-ts", rootPath: "/source/not-read-by-mock" },
			catalog: fixture.catalog,
			materials,
			allocators: fixture.materials.map(() => allocator()),
			manifestTemplate,
			qualificationRevision: "exact-five-task-offline-qualification.v1",
			monotonicClock: { readMs: () => (clock += 10) },
			signal: new AbortController().signal,
		});

		materials[1] = { ...materials[1]!, taskRef: "mutated-after-start" };
		Object.assign(manifestTemplate, {
			trialPlan: {
				...manifestTemplate.trialPlan,
				activeTaskRefs: [EXACT_FIVE_TASK_IDENTITIES[1].taskRef],
			},
		});
		releaseFirst?.();

		const result = await run;
		expect(result.qualified).toBe(true);
		expect(result.frozenManifest?.manifest.trialPlan).toMatchObject({
			activeTaskRefs: [EXACT_FIVE_TASK_IDENTITIES[0].taskRef],
		});
	});
});

function qualificationFixture(): QualificationFixture {
	const tasks: EmpiricalCampaignTaskV1[] = [];
	const materials: ExactFiveTaskPrivateMaterialV1[] = [];
	for (let index = 0; index < EXACT_FIVE_TASK_IDENTITIES.length; index += 1) {
		const identity = EXACT_FIVE_TASK_IDENTITIES[index];
		if (identity === undefined) throw new Error("missing identity");
		const workspaceRecipe = workspaceRecipeFor(identity.taskRef);
		const commandPolicy = commandPolicyFor(identity.taskRef);
		const verifierProfile = verifierProfileFor(identity.taskRef);
		const originalTreeDigest = digest(`${identity.taskRef}:original-tree`);
		const actorTreeDigest =
			identity.sourceStratum === "historical-pre-fix"
				? originalTreeDigest
				: digest(`${identity.taskRef}:actor-tree`);
		const overlay = identity.sourceStratum === "historical-pre-fix" ? null : overlayFor(index);
		const task = strictSnapshot({
			taskRef: identity.taskRef,
			sourceStratum: identity.sourceStratum,
			repositoryRef: "graphrefly-ts",
			originalCommitSha: identity.sourceCommitSha,
			originalTreeDigest,
			actorTreeDigest,
			overlayDigest: overlay === null ? null : overlayDigestFor(identity.taskRef),
			worldDigest: digest(`${identity.taskRef}:world`),
			worldRevision: "exact-five-task-world.v1",
			evalScopeDigest: digest(`${identity.taskRef}:eval-scope`),
			environmentRef: "graphrefly-ts-posix-offline",
			environmentRevision: "graphrefly-ts-posix-offline.v1",
			environmentDigest: digest("graphrefly-ts-posix-offline"),
			toolchainRevision: "graphrefly-ts-toolchain.v1",
			toolchainDigest: digest("graphrefly-ts-toolchain"),
			workItemRef: `work-item.${identity.taskRef}`,
			workItemDigest: digest(`${identity.taskRef}:work-item`),
			acceptanceDigest: digest(`${identity.taskRef}:acceptance`),
			workspaceRecipeRef: workspaceRecipe.workspaceRecipeRef,
			workspaceRecipeRevision: workspaceRecipe.workspaceRecipeRevision,
			workspaceRecipeDigest: empiricalStrictJsonDigest(workspaceRecipe),
			allowedCommandPolicyRef: commandPolicy.policyRef,
			allowedCommandPolicyRevision: commandPolicy.policyRevision,
			allowedCommandPolicyDigest: empiricalStrictJsonDigest(commandPolicy),
			verifierProfileRef: verifierProfile.verifierProfileRef,
			verifierProfileRevision: verifierProfile.verifierProfileRevision,
			verifierProfileDigest: empiricalStrictJsonDigest(verifierProfile),
		});
		const taskProfile: ClosedTaskExecutionProfileV1 = strictSnapshot({
			schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.taskProfile,
			taskRef: identity.taskRef,
			workspaceRecipe,
			commandPolicy,
			verifierProfile,
		});
		tasks.push(task);
		materials.push({
			taskRef: identity.taskRef,
			overlay,
			taskProfile,
			calibrationCapability: calibrationCapability(task, verifierProfile),
			durationLimitMs: 5_000,
		});
	}
	const catalog: EmpiricalTaskCatalogV1 = strictSnapshot({
		taskCatalogRevision: "exact-five-task-catalog.test.v1",
		tasks,
	});
	const preliminaryReport = createEmpiricalTaskQualificationReport(
		catalog,
		catalog.tasks.map(buildEmpiricalQualificationObservationFixture),
	);
	const base = buildEmpiricalCampaignManifestFixture(catalog, preliminaryReport);
	const { catalog: _catalog, qualification: _qualification, ...manifestTemplate } = base;
	return { catalog, materials, manifestTemplate };
}

function workspaceRecipeFor(taskRef: string): ClosedWorkspaceRecipeV1 {
	return strictSnapshot({
		schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.workspaceRecipe,
		workspaceRecipeRef: `workspace-recipe.${taskRef}`,
		workspaceRecipeRevision: "exact-five-task-workspace-recipe.v1",
		readableFiles: ["README.md"],
		writableFiles: [{ path: "README.md", mode: "100644" }],
		maxFileBytes: 64 * 1024,
		maxSearchMatches: 32,
		maxDiffBytes: 64 * 1024,
		maxToolResultBytes: 1024 * 1024,
		maxToolActions: 8,
	});
}

function commandPolicyFor(taskRef: string): ClosedCommandPolicyV1 {
	return strictSnapshot({
		schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.commandPolicy,
		policyRef: `command-policy.${taskRef}`,
		policyRevision: "exact-five-task-command-policy.v1",
		environmentRevision: "posix-sanitized-v1",
		commands: [
			{
				commandRef: "actor.git-status",
				executable: "/usr/bin/git",
				argv: ["status", "--porcelain=v1"],
				maxStdoutBytes: 64 * 1024,
				maxStderrBytes: 64 * 1024,
			},
		],
	});
}

function verifierProfileFor(taskRef: string): ClosedVerifierProfileV1 {
	return strictSnapshot({
		schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.verifierProfile,
		verifierProfileRef: `verifier-profile.${taskRef}`,
		verifierProfileRevision: "exact-five-task-verifier-profile.v1",
		fixtureSuiteRef: `fixture-suite.${taskRef}`,
		fixtureSuiteRevision: "exact-five-task-fixture-suite.v1",
		fixtureSuiteDigest: digest(`${taskRef}:fixture-suite`),
		harnessRevision: "exact-five-task-verifier-harness.v1",
		aggregation: "all-required",
		verifierCommandRefs: [`hidden.verify.${taskRef}`],
	});
}

function calibrationCapability(
	task: EmpiricalCampaignTaskV1,
	profile: ClosedVerifierProfileV1,
): ClosedVerifierCalibrationCapabilityV1 {
	return {
		verifierProfileRef: task.verifierProfileRef,
		verifierProfileRevision: task.verifierProfileRevision,
		verifierProfileDigest: task.verifierProfileDigest,
		async runCase({ caseKind, profileCoordinates }) {
			const accepted = new Set(["command-policy", "known-good-verifier", "workspace-isolation"]);
			const nonEvaluable = new Set([
				"missing-evidence-non-evaluable",
				"non-executable-evidence-non-evaluable",
				"unreliable-evidence-non-evaluable",
			]);
			const taskSpecific = new Set([
				"command-policy",
				"out-of-policy-diff-rejection",
				"target-defect-verifier",
				"workspace-isolation",
			]);
			return strictSnapshot({
				schemaVersion: CLOSED_VERIFIER_CALIBRATION_SCHEMAS.caseResult,
				caseKind,
				observation: accepted.has(caseKind)
					? ("accepted" as const)
					: nonEvaluable.has(caseKind)
						? ("non-evaluable" as const)
						: ("rejected" as const),
				evidenceRef: {
					kind: caseKind,
					id: `${task.taskRef}:${caseKind}`,
					digest: digest(`${task.taskRef}:${caseKind}:evidence`),
					subjectRef: taskSpecific.has(caseKind) ? task.taskRef : profile.verifierProfileRef,
					subjectDigest: taskSpecific.has(caseKind)
						? profileCoordinates.taskDigest
						: profileCoordinates.verifierProfileDigest,
					fixtureSuiteDigest: profile.fixtureSuiteDigest,
					harnessRevision: profile.harnessRevision,
				},
			});
		},
	};
}

function overlayFor(index: number): PrivateRepositoryOverlayV1 {
	const baseBytes = encoder.encode(`held-out-base-${index}`);
	const replacementBytes = encoder.encode(`held-out-replacement-${index}`);
	return {
		schemaVersion: PRIVATE_REPOSITORY_OVERLAY_SCHEMA_VERSION,
		replacements: [
			{
				path: `held-out-${index}.txt`,
				baseMode: "100644",
				baseContentDigest: empiricalSha256(baseBytes),
				replacementByteLength: replacementBytes.byteLength,
				replacementContentDigest: empiricalSha256(replacementBytes),
				replacementBytes,
			},
		],
	};
}

function overlayDigestFor(taskRef: string): string {
	return digest(`${taskRef}:overlay`);
}

function workspaceEvidence(task: EmpiricalCampaignTaskV1, sourceTreeObjectId: string) {
	return strictSnapshot({
		schemaVersion: "graphrefly.private-solution-eval.single-baseline-repository-evidence.v1",
		repositoryRef: "graphrefly-ts",
		sourceCommitSha: task.originalCommitSha,
		sourceTreeObjectId,
		originalTreeDigest: task.originalTreeDigest,
		actorTreeDigest: task.actorTreeDigest,
		overlayDigest: task.overlayDigest,
		actorGitTreeObjectId: digest(`${task.taskRef}:actor-git-tree`).slice("sha256:".length, 40),
		actorCommitSha: digest(`${task.taskRef}:actor-commit`).slice("sha256:".length, 40),
		entryCount: 100,
		totalBytes: 10_000,
		gitProcessCount: 8,
		repositoryState: "clean-single-baseline",
		commitCount: 1,
		parentCount: 0,
		remotes: 0,
		reflogs: 0,
		unreachableObjects: 0,
		sharedObjectStore: false,
		fullFilesystemMatch: true,
		sourceHistoryVisible: false,
		overlayVisibleAsDiff: false,
	});
}

function allocator() {
	return {
		async allocate() {
			return { rootPath: "/private/not-used", ownershipToken: Object.freeze({}) };
		},
		async cleanup() {
			return true;
		},
	};
}

function digest(label: string): string {
	return empiricalSha256(encoder.encode(label));
}

expect(EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS).toHaveLength(12);
