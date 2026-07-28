import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	strictSnapshot,
} from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { createCanonicalRepositoryTreeMaterial } from "../../evals/empirical-memory-rerun-avoidance/canonical-repository-tree.js";
import {
	CLOSED_ACTOR_TOOL_REFS,
	CLOSED_TASK_PROFILE_HOST_SCHEMAS,
	type ClosedCommandPolicyV1,
	type ClosedTaskExecutionProfileV1,
	type ClosedVerifierCapabilityV1,
	type ClosedVerifierProfileV1,
	type ClosedVerifierRunCoordinatesV1,
	type ClosedWorkspaceRecipeV1,
	runClosedTaskProfileHost,
} from "../../evals/empirical-memory-rerun-avoidance/closed-task-profile-host.js";
import {
	CLOSED_VERIFIER_CALIBRATION_SCHEMAS,
	type ClosedVerifierCalibrationObservation,
	runClosedVerifierCalibration,
} from "../../evals/empirical-memory-rerun-avoidance/closed-task-profile-verifier-calibration.js";
import type {
	EmpiricalCampaignManifestV1,
	EmpiricalCampaignTaskV1,
	EmpiricalTaskCatalogV1,
	EmpiricalTaskQualificationReportV1,
	FrozenEmpiricalCampaignManifestV1,
} from "../../evals/empirical-memory-rerun-avoidance/contracts.js";
import { EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS } from "../../evals/empirical-memory-rerun-avoidance/contracts.js";
import {
	createEmpiricalExactPrivateNeedleProtectionExecutor,
	type EmpiricalExactPrivateNeedleProtectionExecutorV1,
} from "../../evals/empirical-memory-rerun-avoidance/exact-private-needle-protection.js";
import {
	EMPIRICAL_MODEL_EXECUTION_SCHEMAS,
	type EmpiricalModelToolIntentV1,
	type EmpiricalModelTurnOutcomeV1,
	type EmpiricalModelTurnPortV1,
	type EmpiricalModelTurnRequestV1,
	executeEmpiricalProtection,
	validateEmpiricalModelTurnOutcome,
} from "../../evals/empirical-memory-rerun-avoidance/model-execution.js";
import {
	createEmpiricalTaskQualificationReport,
	freezeEmpiricalCampaignManifest,
} from "../../evals/empirical-memory-rerun-avoidance/qualification.js";
import {
	type ExactLocalSourceRepositoryCapabilityV1,
	type HistoryFreeSingleBaselineRepositoryMaterializationV1,
	materializeHistoryFreeSingleBaselineRepository,
	type SingleBaselineWorkspaceAllocationV1,
	type SingleBaselineWorkspaceAllocatorCapabilityV1,
} from "../../evals/empirical-memory-rerun-avoidance/single-baseline-repository-node.js";
import {
	buildEmpiricalCampaignManifestFixture,
	buildEmpiricalQualificationCatalogFixture,
	buildEmpiricalQualificationObservationFixture,
} from "./eval-support/empirical-memory-rerun-avoidance/fixtures.js";
import { buildEmpiricalModelTurnRequestFixture } from "./eval-support/empirical-memory-rerun-avoidance/model-execution-fixtures.js";

const encoder = new TextEncoder();
const temporaryRoots: string[] = [];
interface ClosedHostFixture {
	readonly frozen: FrozenEmpiricalCampaignManifestV1;
	readonly report: EmpiricalTaskQualificationReportV1;
	readonly taskProfile: ClosedTaskExecutionProfileV1;
	readonly initialRequest: EmpiricalModelTurnRequestV1;
	readonly materialization: HistoryFreeSingleBaselineRepositoryMaterializationV1;
	readonly workspaceRoot: string;
	readonly verifier: ClosedVerifierCapabilityV1;
	readonly verifierCalls: { count: number };
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(label: string): string {
	const root = mkdtempSync(join(tmpdir(), `graphrefly-b112-d659-${label}-`));
	temporaryRoots.push(root);
	return root;
}

function git(rootPath: string, args: readonly string[]): string {
	return execFileSync("git", ["-C", rootPath, ...args], {
		encoding: "utf8",
		maxBuffer: 4 * 1024 * 1024,
	}).trim();
}

async function createClosedHostFixture(
	command: {
		readonly commandRef: string;
		readonly executable: string;
		readonly argv: readonly string[];
	} = {
		commandRef: "actor.status",
		executable: "/usr/bin/git",
		argv: ["status", "--porcelain=v1"],
	},
	sourceContent = "broken-placeholder-value\n",
): Promise<ClosedHostFixture> {
	const sourceRoot = temporaryRoot("source");
	git(sourceRoot, ["init", "--quiet", "--initial-branch=main"]);
	git(sourceRoot, ["config", "user.name", "D659 Test"]);
	git(sourceRoot, ["config", "user.email", "d659-test@graphrefly.invalid"]);
	writeFileSync(join(sourceRoot, ".gitignore"), "ignored-output/\n", { mode: 0o644 });
	writeFileSync(join(sourceRoot, "README.md"), sourceContent, { mode: 0o644 });
	chmodSync(join(sourceRoot, "README.md"), 0o644);
	git(sourceRoot, ["add", "--all"]);
	git(sourceRoot, ["commit", "--quiet", "-m", "source fixture"]);
	const sourceCommitSha = git(sourceRoot, ["rev-parse", "HEAD"]);
	const sourceTreeObjectId = git(sourceRoot, ["rev-parse", "HEAD^{tree}"]);
	const sourceMaterial = createCanonicalRepositoryTreeMaterial([
		{ path: ".gitignore", mode: "100644", bytes: encoder.encode("ignored-output/\n") },
		{
			path: "README.md",
			mode: "100644",
			bytes: encoder.encode(sourceContent),
		},
	]);

	const workspaceRecipe: ClosedWorkspaceRecipeV1 = strictSnapshot({
		schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.workspaceRecipe,
		workspaceRecipeRef: "workspace-recipe.d659",
		workspaceRecipeRevision: "workspace-recipe.d659.v1",
		readableFiles: ["README.md"],
		writableFiles: [{ path: "README.md", mode: "100644" }],
		maxFileBytes: 64 * 1024,
		maxSearchMatches: 32,
		maxDiffBytes: 64 * 1024,
		maxToolResultBytes: 1024 * 1024,
		maxToolActions: 8,
	});
	const commandPolicy: ClosedCommandPolicyV1 = strictSnapshot({
		schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.commandPolicy,
		policyRef: "command-policy.d659",
		policyRevision: "command-policy.d659.v1",
		environmentRevision: "posix-sanitized-v1",
		commands: [
			{
				...command,
				maxStdoutBytes: 64 * 1024,
				maxStderrBytes: 64 * 1024,
			},
		],
	});
	const verifierProfile: ClosedVerifierProfileV1 = strictSnapshot({
		schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.verifierProfile,
		verifierProfileRef: "verifier-profile.d659",
		verifierProfileRevision: "verifier-profile.d659.v1",
		fixtureSuiteRef: "fixture-suite.d659",
		fixtureSuiteRevision: "verifier-fixtures-placeholder.v1",
		fixtureSuiteDigest: empiricalSha256(encoder.encode("task.d659:verifier-fixtures")),
		harnessRevision: "qualification-harness-placeholder.v1",
		aggregation: "all-required",
		verifierCommandRefs: ["hidden.verify"],
	});

	const fixtureCatalog = buildEmpiricalQualificationCatalogFixture();
	const fixtureTask = fixtureCatalog.tasks[0] as EmpiricalCampaignTaskV1;
	const task: EmpiricalCampaignTaskV1 = strictSnapshot({
		...fixtureTask,
		taskRef: "task.d659",
		originalCommitSha: sourceCommitSha,
		originalTreeDigest: sourceMaterial.treeDigest,
		actorTreeDigest: sourceMaterial.treeDigest,
		overlayDigest: null,
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
	const catalog: EmpiricalTaskCatalogV1 = strictSnapshot({
		...fixtureCatalog,
		tasks: [task, ...fixtureCatalog.tasks.slice(1)],
	});
	const report = createEmpiricalTaskQualificationReport(
		catalog,
		catalog.tasks.map(buildEmpiricalQualificationObservationFixture),
	);
	const baseManifest = buildEmpiricalCampaignManifestFixture(catalog, report);
	const schemaCatalog = closedToolSchemaCatalog(baseManifest);
	const baseConfiguration = baseManifest.modelConfigurations[0];
	if (baseConfiguration === undefined) throw new Error("missing actor configuration fixture");
	const modelConfiguration = strictSnapshot({
		...baseConfiguration,
		settings: {
			...baseConfiguration.settings,
			tools: {
				...baseConfiguration.settings.tools,
				schemaRevision: schemaCatalog.catalogRevision,
				toolRefs: schemaCatalog.tools.map((tool) => tool.toolRef),
				toolSetDigest: empiricalStrictJsonDigest(schemaCatalog.tools),
				maxSteps: 8,
			},
		},
	});
	const manifest: EmpiricalCampaignManifestV1 = strictSnapshot({
		...baseManifest,
		schemaCatalog,
		modelConfigurations: [modelConfiguration],
		budgets: {
			...baseManifest.budgets,
			campaign: {
				...baseManifest.budgets.campaign,
				maxRequests: 48,
			},
			taskModel: {
				...baseManifest.budgets.taskModel,
				maxRequests: 48,
			},
			agentRun: {
				...baseManifest.budgets.agentRun,
				maxSteps: 8,
				maxRequests: 8,
			},
		},
	});
	const frozen = freezeEmpiricalCampaignManifest(manifest, report);
	const initialRequest = buildEmpiricalModelTurnRequestFixture({
		frozen,
		qualificationReport: report,
	});
	const protectionExecutor = createEmpiricalExactPrivateNeedleProtectionExecutor({
		policyRef: initialRequest.protectionPolicyRef,
		policyRevision: initialRequest.protectionPolicyRevision,
		protectedNeedleCapabilityRef: "protected-needles.d659",
		protectedNeedleCapabilityRevision: "protected-needles.d659.v1",
		protectedNeedles: ["private-secret-placeholder"],
	});

	const allocationRoot = temporaryRoot("allocation");
	const allocator: SingleBaselineWorkspaceAllocatorCapabilityV1 = {
		async allocate(): Promise<SingleBaselineWorkspaceAllocationV1> {
			const rootPath = join(allocationRoot, "workspace");
			mkdirSync(rootPath, { mode: 0o700 });
			return Object.freeze({ rootPath, ownershipToken: Object.freeze({ task: "d659" }) });
		},
		async cleanup(allocation): Promise<boolean> {
			rmSync(allocation.rootPath, { recursive: true, force: true });
			return true;
		},
	};
	const source: ExactLocalSourceRepositoryCapabilityV1 = {
		repositoryRef: "graphrefly-ts",
		rootPath: sourceRoot,
	};
	const materialization = await materializeHistoryFreeSingleBaselineRepository(source, allocator, {
		sourceCommitSha,
		sourceTreeObjectId,
		overlay: null,
		signal: new AbortController().signal,
	});
	const workspaceRoot = materialization.workspace.rootPathForHostRunner();
	const verifierCalls = { count: 0 };
	const verifier: ClosedVerifierCapabilityV1 = {
		verifierProfileRef: verifierProfile.verifierProfileRef,
		verifierProfileRevision: verifierProfile.verifierProfileRevision,
		verifierProfileDigest: empiricalStrictJsonDigest(verifierProfile),
		async verify(input) {
			verifierCalls.count += 1;
			expect(input.workspace.rootPathForHostRunner()).toBe(workspaceRoot);
			expect(input.profileCoordinates).toMatchObject({
				taskRef: task.taskRef,
				taskDigest: empiricalStrictJsonDigest(task),
				verifierProfileRef: verifierProfile.verifierProfileRef,
				verifierProfileRevision: verifierProfile.verifierProfileRevision,
				verifierProfileDigest: empiricalStrictJsonDigest(verifierProfile),
				fixtureSuiteDigest: verifierProfile.fixtureSuiteDigest,
				harnessRevision: verifierProfile.harnessRevision,
			});
			expect(readFileSync(join(workspaceRoot, "README.md"), "utf8")).toBe("fixed\n");
			return strictSnapshot({
				schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.verifierResult,
				verdict: "passed",
				evidenceRefs: [targetRunEvidence(input.profileCoordinates)],
				issueCodes: [],
			});
		},
	};
	return {
		frozen,
		report,
		taskProfile: strictSnapshot({
			schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.taskProfile,
			taskRef: task.taskRef,
			workspaceRecipe,
			commandPolicy,
			verifierProfile,
		}),
		initialRequest,
		materialization,
		workspaceRoot,
		verifier,
		verifierCalls,
		protectionExecutor,
	};
}

function closedToolSchemaCatalog(baseManifest: EmpiricalCampaignManifestV1) {
	const stringShape = {
		kind: "string",
		minLength: 1,
		maxLength: 32_768,
		enum: null,
	} as const;
	const integerShape = { kind: "integer", minimum: 1, maximum: 4_096 } as const;
	const objectShape = (
		properties: readonly {
			readonly name: string;
			readonly required: boolean;
			readonly shape: typeof stringShape | typeof integerShape;
		}[],
	) =>
		strictSnapshot({
			kind: "object" as const,
			properties,
			additionalProperties: false as const,
		});
	const entries = [
		{
			toolRef: CLOSED_ACTOR_TOOL_REFS.readFile,
			inputSchema: objectShape([{ name: "path", required: true, shape: stringShape }]),
		},
		{
			toolRef: CLOSED_ACTOR_TOOL_REFS.searchLiteral,
			inputSchema: objectShape([
				{ name: "maxMatches", required: true, shape: integerShape },
				{ name: "path", required: true, shape: stringShape },
				{ name: "query", required: true, shape: stringShape },
			]),
		},
		{
			toolRef: CLOSED_ACTOR_TOOL_REFS.replaceExact,
			inputSchema: objectShape([
				{ name: "baseContentDigest", required: true, shape: stringShape },
				{ name: "newText", required: true, shape: stringShape },
				{ name: "oldText", required: true, shape: stringShape },
				{ name: "path", required: true, shape: stringShape },
			]),
		},
		{
			toolRef: CLOSED_ACTOR_TOOL_REFS.workspaceDiff,
			inputSchema: objectShape([]),
		},
		{
			toolRef: CLOSED_ACTOR_TOOL_REFS.runCommand,
			inputSchema: objectShape([{ name: "commandRef", required: true, shape: stringShape }]),
		},
	].map((entry) =>
		strictSnapshot({
			...entry,
			schemaRevision: "closed-task-tools.d659.v1",
			inputSchemaDigest: empiricalStrictJsonDigest(entry.inputSchema),
		}),
	);
	return strictSnapshot({
		...baseManifest.schemaCatalog,
		catalogRevision: "closed-task-tools.d659.v1",
		tools: entries,
	});
}

function intent(
	stepIndex: number,
	toolRef: string,
	argumentsValue: EmpiricalModelToolIntentV1["arguments"],
): EmpiricalModelToolIntentV1 {
	return strictSnapshot({
		toolCallRef: `tool-call.${stepIndex}`,
		toolRef,
		argumentsDigest: empiricalStrictJsonDigest(argumentsValue),
		arguments: argumentsValue,
	});
}

function completedOutcome(
	request: EmpiricalModelTurnRequestV1,
	frozen: FrozenEmpiricalCampaignManifestV1,
	report: EmpiricalTaskQualificationReportV1,
	protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1,
	body:
		| {
				readonly finishReason: "tool-intents";
				readonly toolIntents: readonly EmpiricalModelToolIntentV1[];
		  }
		| {
				readonly finishReason: "structured-output";
				readonly structuredOutput: { readonly kind: string; readonly summary: string };
		  },
): EmpiricalModelTurnOutcomeV1 {
	const structuredOutput = body.finishReason === "structured-output" ? body.structuredOutput : null;
	const toolIntents = body.finishReason === "tool-intents" ? body.toolIntents : [];
	const evidenceRefs = strictSnapshot([]);
	const issueCodes = strictSnapshot([]);
	const protectedToolIntents = strictSnapshot(
		toolIntents.map((entry) => ({
			toolCallRef: entry.toolCallRef,
			toolRef: entry.toolRef,
			argumentsDigest: entry.argumentsDigest,
			arguments: entry.arguments,
		})),
	);
	const egressMaterial = strictSnapshot({
		evidenceRefs,
		issueCodes,
		structuredOutput,
		toolIntents: protectedToolIntents,
	});
	const protectionReceipt = executeEmpiricalProtection(protectionExecutor, {
		policyRef: request.protectionPolicyRef,
		policyRevision: request.protectionPolicyRevision,
		stage: "model-egress",
		subject: egressMaterial,
	}).receipt;
	return validateEmpiricalModelTurnOutcome(
		{
			schemaVersion: EMPIRICAL_MODEL_EXECUTION_SCHEMAS.outcome,
			requestRef: request.requestRef,
			requestDigest: empiricalStrictJsonDigest(request),
			configurationRef: request.configurationRef,
			configurationDigest: request.configurationDigest,
			role: request.role,
			status: "completed",
			finishReason: body.finishReason,
			outputSchemaDigest: request.outputSchema.schemaDigest,
			structuredOutput,
			structuredOutputDigest:
				structuredOutput === null ? null : empiricalStrictJsonDigest(structuredOutput),
			toolIntents,
			usage: {
				source: request.usageSource,
				inputTokens: 10,
				outputTokens: 10,
				totalTokens: 20,
				requests: 1,
				hostInputBytes: 128,
				hostOutputBytes: 2_048,
			},
			latencyMs: 1,
			issueCodes,
			evidenceRefs,
			protectionReceipt,
		},
		request,
		frozen,
		report,
	);
}

function scriptedPort(
	fixture: ClosedHostFixture,
	select: (request: EmpiricalModelTurnRequestV1) =>
		| {
				readonly finishReason: "tool-intents";
				readonly toolIntents: readonly EmpiricalModelToolIntentV1[];
		  }
		| {
				readonly finishReason: "structured-output";
				readonly structuredOutput: { readonly kind: string; readonly summary: string };
		  },
): EmpiricalModelTurnPortV1 {
	return {
		async invoke(request, signal) {
			if (signal.aborted) throw new DOMException("cancelled", "AbortError");
			return completedOutcome(
				request,
				fixture.frozen,
				fixture.report,
				fixture.protectionExecutor,
				select(request),
			);
		},
	};
}

function expectedCalibrationObservation(
	caseKind: (typeof EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS)[number],
): ClosedVerifierCalibrationObservation {
	if (
		caseKind === "command-policy" ||
		caseKind === "known-good-verifier" ||
		caseKind === "workspace-isolation"
	) {
		return "accepted";
	}
	if (
		caseKind === "missing-evidence-non-evaluable" ||
		caseKind === "non-executable-evidence-non-evaluable" ||
		caseKind === "unreliable-evidence-non-evaluable"
	) {
		return "non-evaluable";
	}
	return "rejected";
}

function targetRunEvidence(coordinates: ClosedVerifierRunCoordinatesV1, id = "target-run.d659") {
	return strictSnapshot({
		kind: "target-verification" as const,
		id,
		digest: empiricalSha256(encoder.encode(`${id}:${coordinates.workspaceStateDigest}`)),
		taskRef: coordinates.taskRef,
		taskDigest: coordinates.taskDigest,
		verifierProfileRef: coordinates.verifierProfileRef,
		verifierProfileDigest: coordinates.verifierProfileDigest,
		fixtureSuiteDigest: coordinates.fixtureSuiteDigest,
		workspaceStateDigest: coordinates.workspaceStateDigest,
		harnessRevision: coordinates.harnessRevision,
	});
}

describe("B112 D659 deterministic closed task-profile host", () => {
	it("runs five code-closed actor tools in explicit turns, gates the diff, verifies, and cleans up", async () => {
		const fixture = await createClosedHostFixture();
		const baseContentDigest = empiricalSha256(encoder.encode("broken-placeholder-value\n"));
		const port = scriptedPort(fixture, (request) => {
			expect(request.priorToolResults).toHaveLength(request.stepIndex === 0 ? 0 : 1);
			switch (request.stepIndex) {
				case 0:
					return {
						finishReason: "tool-intents",
						toolIntents: [intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
					};
				case 1:
					return {
						finishReason: "tool-intents",
						toolIntents: [
							intent(1, CLOSED_ACTOR_TOOL_REFS.searchLiteral, {
								maxMatches: 8,
								path: "README.md",
								query: "broken",
							}),
						],
					};
				case 2:
					return {
						finishReason: "tool-intents",
						toolIntents: [
							intent(2, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
								baseContentDigest,
								newText: "fixed",
								oldText: "broken-placeholder-value",
								path: "README.md",
							}),
						],
					};
				case 3:
					return {
						finishReason: "tool-intents",
						toolIntents: [intent(3, CLOSED_ACTOR_TOOL_REFS.workspaceDiff, {})],
					};
				case 4:
					return {
						finishReason: "tool-intents",
						toolIntents: [
							intent(4, CLOSED_ACTOR_TOOL_REFS.runCommand, {
								commandRef: "actor.status",
							}),
						],
					};
				default:
					return {
						finishReason: "structured-output",
						structuredOutput: {
							kind: "model-turn-output-placeholder",
							summary: "bounded-placeholder",
						},
					};
			}
		});

		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: port,
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			signal: new AbortController().signal,
		});

		expect(outcome).toMatchObject({
			status: "completed",
			turnCount: 6,
			remoteRequests: 6,
			toolActionCount: 5,
			verifierVerdict: "passed",
			cleanupSucceeded: true,
			issueCodes: [],
		});
		expect(fixture.verifierCalls.count).toBe(1);
		expect(outcome.toolEvidence.map((entry) => entry.toolRef)).toEqual([
			CLOSED_ACTOR_TOOL_REFS.readFile,
			CLOSED_ACTOR_TOOL_REFS.searchLiteral,
			CLOSED_ACTOR_TOOL_REFS.replaceExact,
			CLOSED_ACTOR_TOOL_REFS.workspaceDiff,
			CLOSED_ACTOR_TOOL_REFS.runCommand,
		]);
		expect(JSON.stringify(outcome)).not.toContain("broken");
		expect(JSON.stringify(outcome)).not.toContain(fixture.workspaceRoot);
		expect(() => readFileSync(join(fixture.workspaceRoot, "README.md"))).toThrow();
	});

	it("rejects a profile-digest mismatch before model invocation and still cleans the workspace", async () => {
		const fixture = await createClosedHostFixture();
		let invocations = 0;
		const port: EmpiricalModelTurnPortV1 = {
			async invoke() {
				invocations += 1;
				throw new Error("must not run");
			},
		};
		const mismatchedProfile = {
			...fixture.taskProfile,
			workspaceRecipe: {
				...fixture.taskProfile.workspaceRecipe,
				maxFileBytes: fixture.taskProfile.workspaceRecipe.maxFileBytes + 1,
			},
		};

		await expect(
			runClosedTaskProfileHost({
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: mismatchedProfile,
				materialization: fixture.materialization,
				modelTurnPort: port,
				protectionExecutor: fixture.protectionExecutor,
				verifier: fixture.verifier,
				signal: new AbortController().signal,
			}),
		).rejects.toThrow(/does not match the task recipe coordinates/);
		expect(invocations).toBe(0);
		expect(() => readFileSync(join(fixture.workspaceRoot, "README.md"))).toThrow();
	});

	it("classifies an actor-selected unknown commandRef non-evaluable without invoking the verifier", async () => {
		const fixture = await createClosedHostFixture();
		const port = scriptedPort(fixture, () => ({
			finishReason: "tool-intents",
			toolIntents: [
				intent(0, CLOSED_ACTOR_TOOL_REFS.runCommand, {
					commandRef: "actor.not-registered",
				}),
			],
		}));

		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: port,
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			signal: new AbortController().signal,
		});

		expect(outcome.status).toBe("non-evaluable");
		expect(outcome.issueCodes).toContain("command-ref-not-allowed");
		expect(outcome.cleanupSucceeded).toBe(true);
		expect(outcome.turnCount).toBe(1);
		expect(outcome.remoteRequests).toBe(1);
		expect(fixture.verifierCalls.count).toBe(0);
	});

	it("classifies a schema-valid but non-portable actor path without widening filesystem access", async () => {
		const fixture = await createClosedHostFixture();
		const port = scriptedPort(fixture, () => ({
			finishReason: "tool-intents",
			toolIntents: [intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "../README.md" })],
		}));

		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: port,
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			signal: new AbortController().signal,
		});

		expect(outcome.status).toBe("non-evaluable");
		expect(outcome.issueCodes).toEqual(["tool-execution-invalid"]);
		expect(outcome.turnCount).toBe(1);
		expect(outcome.toolActionCount).toBe(0);
		expect(fixture.verifierCalls.count).toBe(0);
	});

	it("protects every tool result before the next turn and stops when protection blocks", async () => {
		const fixture = await createClosedHostFixture();
		const port = scriptedPort(fixture, () => ({
			finishReason: "tool-intents",
			toolIntents: [intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
		}));
		const blockingProtection = createEmpiricalExactPrivateNeedleProtectionExecutor({
			policyRef: fixture.initialRequest.protectionPolicyRef,
			policyRevision: fixture.initialRequest.protectionPolicyRevision,
			protectedNeedleCapabilityRef: "blocking-needles.d659",
			protectedNeedleCapabilityRevision: "blocking-needles.d659.v1",
			protectedNeedles: ["broken-placeholder-value"],
		});

		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: port,
			protectionExecutor: blockingProtection,
			verifier: fixture.verifier,
			signal: new AbortController().signal,
		});

		expect(outcome.status).toBe("non-evaluable");
		expect(outcome.issueCodes).toContain("tool-result-protection-blocked");
		expect(outcome.toolActionCount).toBe(0);
		expect(fixture.verifierCalls.count).toBe(0);
	});

	it("classifies cancellation non-evaluable, performs no model call, and cleans exactly once", async () => {
		const fixture = await createClosedHostFixture();
		const controller = new AbortController();
		controller.abort();
		let invocations = 0;
		const port: EmpiricalModelTurnPortV1 = {
			async invoke() {
				invocations += 1;
				throw new Error("must not run");
			},
		};

		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: port,
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			signal: controller.signal,
		});

		expect(outcome.status).toBe("non-evaluable");
		expect(outcome.issueCodes).toContain("host-cancelled");
		expect(outcome.cleanupSucceeded).toBe(true);
		expect(invocations).toBe(0);
		expect(fixture.verifierCalls.count).toBe(0);
	});

	it("keeps verifier authority disjoint and classifies an unverifiable result", async () => {
		const fixture = await createClosedHostFixture();
		const verifier: ClosedVerifierCapabilityV1 = {
			verifierProfileRef: fixture.verifier.verifierProfileRef,
			verifierProfileRevision: fixture.verifier.verifierProfileRevision,
			verifierProfileDigest: fixture.verifier.verifierProfileDigest,
			async verify(input) {
				return strictSnapshot({
					schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.verifierResult,
					verdict: "unverifiable",
					evidenceRefs: [
						targetRunEvidence(input.profileCoordinates, "target-run-unverifiable.d659"),
					],
					issueCodes: ["hidden-evidence-missing"],
				});
			},
		};
		const port = scriptedPort(fixture, () => ({
			finishReason: "structured-output",
			structuredOutput: {
				kind: "model-turn-output-placeholder",
				summary: "bounded-placeholder",
			},
		}));

		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: port,
			protectionExecutor: fixture.protectionExecutor,
			verifier,
			signal: new AbortController().signal,
		});

		expect(outcome.status).toBe("non-evaluable");
		expect(outcome.verifierVerdict).toBeNull();
		expect(outcome.finalOutput).toBeNull();
		expect(outcome.issueCodes).toEqual(["hidden-evidence-missing", "verifier-unverifiable"]);
	});

	it("rejects a fixed command's out-of-policy filesystem effect before verifier execution", async () => {
		const fixture = await createClosedHostFixture({
			commandRef: "actor.create-ignored",
			executable: "/usr/bin/git",
			argv: ["checkout-index", "--prefix=ignored-output/", "--all"],
		});
		const baseContentDigest = empiricalSha256(encoder.encode("broken-placeholder-value\n"));
		const port = scriptedPort(fixture, (request) => {
			if (request.stepIndex === 0) {
				return {
					finishReason: "tool-intents",
					toolIntents: [
						intent(0, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
							baseContentDigest,
							newText: "fixed",
							oldText: "broken-placeholder-value",
							path: "README.md",
						}),
					],
				};
			}
			if (request.stepIndex === 1) {
				return {
					finishReason: "tool-intents",
					toolIntents: [
						intent(1, CLOSED_ACTOR_TOOL_REFS.runCommand, {
							commandRef: "actor.create-ignored",
						}),
					],
				};
			}
			return {
				finishReason: "structured-output",
				structuredOutput: {
					kind: "model-turn-output-placeholder",
					summary: "bounded-placeholder",
				},
			};
		});

		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: port,
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			signal: new AbortController().signal,
		});

		expect(outcome.status).toBe("non-evaluable");
		expect(outcome.issueCodes).toContain("out-of-policy-workspace-diff");
		expect(fixture.verifierCalls.count).toBe(0);
	});

	it("never widens the initial remaining output-byte budget and classifies exact exhaustion", async () => {
		const fixture = await createClosedHostFixture();
		const initialRequest = {
			...fixture.initialRequest,
			remainingTurnBudget: {
				...fixture.initialRequest.remainingTurnBudget,
				maxOutputBytes: 2_048,
			},
		};
		let invocations = 0;
		const port = scriptedPort(fixture, (request) => {
			invocations += 1;
			expect(request.remainingTurnBudget.maxOutputBytes).toBe(2_048);
			return {
				finishReason: "tool-intents",
				toolIntents: [intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
			};
		});

		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: port,
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			signal: new AbortController().signal,
		});

		expect(outcome.status).toBe("non-evaluable");
		expect(outcome.issueCodes).toEqual(["agent-output-byte-budget-exhausted"]);
		expect(outcome.turnCount).toBe(1);
		expect(invocations).toBe(1);
	});

	it("rejects a duplicate toolCallRef across turns before a second side effect", async () => {
		const fixture = await createClosedHostFixture();
		const port = scriptedPort(fixture, (request) => ({
			finishReason: "tool-intents",
			toolIntents: [
				intent(
					0,
					request.stepIndex === 0
						? CLOSED_ACTOR_TOOL_REFS.readFile
						: CLOSED_ACTOR_TOOL_REFS.workspaceDiff,
					request.stepIndex === 0 ? { path: "README.md" } : {},
				),
			],
		}));

		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: port,
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			signal: new AbortController().signal,
		});

		expect(outcome.status).toBe("non-evaluable");
		expect(outcome.issueCodes).toEqual(["duplicate-tool-call-ref"]);
		expect(outcome.turnCount).toBe(2);
		expect(outcome.toolActionCount).toBe(1);
	});

	it("classifies a nonzero preregistered command without returning its raw output", async () => {
		const fixture = await createClosedHostFixture({
			commandRef: "actor.diff-quiet",
			executable: "/usr/bin/git",
			argv: ["diff", "--quiet", "--exit-code", "--", "README.md"],
		});
		const baseContentDigest = empiricalSha256(encoder.encode("broken-placeholder-value\n"));
		const port = scriptedPort(fixture, (request) => ({
			finishReason: "tool-intents",
			toolIntents:
				request.stepIndex === 0
					? [
							intent(0, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
								baseContentDigest,
								newText: "fixed",
								oldText: "broken-placeholder-value",
								path: "README.md",
							}),
						]
					: [
							intent(1, CLOSED_ACTOR_TOOL_REFS.runCommand, {
								commandRef: "actor.diff-quiet",
							}),
						],
		}));

		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: port,
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			signal: new AbortController().signal,
		});

		expect(outcome.status).toBe("non-evaluable");
		expect(outcome.issueCodes).toEqual(["command-nonzero-exit"]);
		expect(outcome.toolActionCount).toBe(1);
		expect(outcome.toolEvidence).toHaveLength(1);
	});

	it("rejects overlapping exact-replacement matches", async () => {
		const fixture = await createClosedHostFixture(undefined, "aaa\n");
		const port = scriptedPort(fixture, () => ({
			finishReason: "tool-intents",
			toolIntents: [
				intent(0, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
					baseContentDigest: empiricalSha256(encoder.encode("aaa\n")),
					newText: "b",
					oldText: "aa",
					path: "README.md",
				}),
			],
		}));

		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: port,
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			signal: new AbortController().signal,
		});

		expect(outcome.issueCodes).toEqual(["exact-replacement-match-count-invalid"]);
		expect(outcome.toolActionCount).toBe(0);
	});

	it("honors cancellation raised by the verifier before accepting its verdict", async () => {
		const fixture = await createClosedHostFixture();
		const controller = new AbortController();
		const verifier: ClosedVerifierCapabilityV1 = {
			verifierProfileRef: fixture.verifier.verifierProfileRef,
			verifierProfileRevision: fixture.verifier.verifierProfileRevision,
			verifierProfileDigest: fixture.verifier.verifierProfileDigest,
			async verify(input) {
				controller.abort();
				return strictSnapshot({
					schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.verifierResult,
					verdict: "passed",
					evidenceRefs: [targetRunEvidence(input.profileCoordinates)],
					issueCodes: [],
				});
			},
		};
		const port = scriptedPort(fixture, () => ({
			finishReason: "structured-output",
			structuredOutput: {
				kind: "model-turn-output-placeholder",
				summary: "bounded-placeholder",
			},
		}));

		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: port,
			protectionExecutor: fixture.protectionExecutor,
			verifier,
			signal: controller.signal,
		});

		expect(outcome.status).toBe("non-evaluable");
		expect(outcome.issueCodes).toEqual(["host-cancelled"]);
	});

	it("rejects verifier evidence substituted from another subject", async () => {
		const fixture = await createClosedHostFixture();
		const verifier: ClosedVerifierCapabilityV1 = {
			verifierProfileRef: fixture.verifier.verifierProfileRef,
			verifierProfileRevision: fixture.verifier.verifierProfileRevision,
			verifierProfileDigest: fixture.verifier.verifierProfileDigest,
			async verify(input) {
				const evidence = targetRunEvidence(input.profileCoordinates);
				return strictSnapshot({
					schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.verifierResult,
					verdict: "passed",
					evidenceRefs: [
						{
							...evidence,
							workspaceStateDigest: empiricalSha256(encoder.encode("other-workspace")),
						},
					],
					issueCodes: [],
				});
			},
		};
		const port = scriptedPort(fixture, () => ({
			finishReason: "structured-output",
			structuredOutput: {
				kind: "model-turn-output-placeholder",
				summary: "bounded-placeholder",
			},
		}));

		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: port,
			protectionExecutor: fixture.protectionExecutor,
			verifier,
			signal: new AbortController().signal,
		});

		expect(outcome.status).toBe("non-evaluable");
		expect(outcome.issueCodes).toEqual(["verifier-result-invalid"]);
	});

	it("rejects an explicitly preregistered shell-launching wrapper before model invocation", async () => {
		const fixture = await createClosedHostFixture({
			commandRef: "actor.shell",
			executable: "/usr/bin/env",
			argv: ["sh", "-c", "true"],
		});
		let invocations = 0;
		const port: EmpiricalModelTurnPortV1 = {
			async invoke() {
				invocations += 1;
				throw new Error("must not run");
			},
		};

		await expect(
			runClosedTaskProfileHost({
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: fixture.materialization,
				modelTurnPort: port,
				protectionExecutor: fixture.protectionExecutor,
				verifier: fixture.verifier,
				signal: new AbortController().signal,
			}),
		).rejects.toThrow(/shell and command-launcher executables are forbidden/);
		expect(invocations).toBe(0);
	});

	it("keeps malformed model tool intents distinct from invocation failure", async () => {
		const fixture = await createClosedHostFixture();
		const port: EmpiricalModelTurnPortV1 = {
			async invoke(request) {
				const valid = completedOutcome(
					request,
					fixture.frozen,
					fixture.report,
					fixture.protectionExecutor,
					{
						finishReason: "tool-intents",
						toolIntents: [intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
					},
				);
				return {
					...valid,
					toolIntents: [
						{
							...valid.toolIntents[0],
							argumentsDigest: empiricalSha256(encoder.encode("wrong-arguments")),
						},
					],
				} as EmpiricalModelTurnOutcomeV1;
			},
		};

		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: port,
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			signal: new AbortController().signal,
		});

		expect(outcome.issueCodes).toEqual(["model-turn-tool-intent-invalid"]);
		expect(outcome.turnCount).toBe(1);
		expect(outcome.remoteRequests).toBe(0);
	});

	it("keeps model output-budget exhaustion distinct from malformed output and invocation failure", async () => {
		const fixture = await createClosedHostFixture();
		const initialRequest = {
			...fixture.initialRequest,
			remainingTurnBudget: {
				...fixture.initialRequest.remainingTurnBudget,
				maxOutputBytes: 4_096,
			},
		};
		const port: EmpiricalModelTurnPortV1 = {
			async invoke(request) {
				const valid = completedOutcome(
					request,
					fixture.frozen,
					fixture.report,
					fixture.protectionExecutor,
					{
						finishReason: "structured-output",
						structuredOutput: {
							kind: "model-turn-output-placeholder",
							summary: "bounded-placeholder",
						},
					},
				);
				return {
					...valid,
					usage: {
						...valid.usage,
						hostOutputBytes: 4_097,
					},
				};
			},
		};

		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: port,
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			signal: new AbortController().signal,
		});

		expect(outcome.issueCodes).toEqual(["model-turn-output-budget-exhausted"]);
		expect(outcome.turnCount).toBe(1);
		expect(outcome.remoteRequests).toBe(0);
	});

	it("kills the preregistered command process group on cancellation", async () => {
		const fixture = await createClosedHostFixture({
			commandRef: "actor.descendant-probe",
			executable: "/usr/bin/python3",
			argv: ["-c", "import subprocess,time; subprocess.Popen(['/bin/sleep','60']); time.sleep(60)"],
		});
		const port = scriptedPort(fixture, () => ({
			finishReason: "tool-intents",
			toolIntents: [
				intent(0, CLOSED_ACTOR_TOOL_REFS.runCommand, {
					commandRef: "actor.descendant-probe",
				}),
			],
		}));
		const controller = new AbortController();
		const startedAt = performance.now();
		const run = runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: port,
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			signal: controller.signal,
		});
		setTimeout(() => controller.abort(), 100);

		const outcome = await run;
		expect(outcome.issueCodes).toEqual(["host-cancelled"]);
		expect(performance.now() - startedAt).toBeLessThan(5_000);
		expect(outcome.cleanupSucceeded).toBe(true);
	});

	it("executes every D639 calibration case sequentially through one hidden-fixture capability", async () => {
		const fixture = await createClosedHostFixture();
		const profile = fixture.taskProfile.verifierProfile;
		const profileCoordinates = strictSnapshot({
			taskRef: fixture.initialRequest.taskRef,
			taskDigest: fixture.initialRequest.taskDigest,
			verifierProfileRef: profile.verifierProfileRef,
			verifierProfileRevision: profile.verifierProfileRevision,
			verifierProfileDigest: empiricalStrictJsonDigest(profile),
			fixtureSuiteRef: profile.fixtureSuiteRef,
			fixtureSuiteRevision: profile.fixtureSuiteRevision,
			fixtureSuiteDigest: profile.fixtureSuiteDigest,
			harnessRevision: profile.harnessRevision,
		});
		const requestedCases: string[] = [];
		const evidenceByKind = new Map(
			fixture.report.observations[0]?.verifierCalibration.evidenceRefs.map((entry) => [
				entry.kind,
				entry,
			]) ?? [],
		);
		const report = await runClosedVerifierCalibration({
			profileCoordinates,
			capability: {
				verifierProfileRef: profile.verifierProfileRef,
				verifierProfileRevision: profile.verifierProfileRevision,
				verifierProfileDigest: empiricalStrictJsonDigest(profile),
				async runCase(input) {
					requestedCases.push(input.caseKind);
					const evidenceRef = evidenceByKind.get(input.caseKind);
					if (evidenceRef === undefined) throw new Error("missing closed fixture evidence");
					return strictSnapshot({
						schemaVersion: CLOSED_VERIFIER_CALIBRATION_SCHEMAS.caseResult,
						caseKind: input.caseKind,
						observation: expectedCalibrationObservation(input.caseKind),
						evidenceRef,
					});
				},
			},
			signal: new AbortController().signal,
		});

		expect(requestedCases).toEqual(EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS);
		expect(report.qualified).toBe(true);
		expect(report.issueCodes).toEqual([]);
		expect(report.cases).toHaveLength(EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS.length);
		expect(JSON.stringify(report)).not.toContain(fixture.workspaceRoot);
		await fixture.materialization.cleanup();
	});

	it("fails closed when a calibration case reports the plausible-wrong result as accepted", async () => {
		const fixture = await createClosedHostFixture();
		const profile = fixture.taskProfile.verifierProfile;
		const profileCoordinates = strictSnapshot({
			taskRef: fixture.initialRequest.taskRef,
			taskDigest: fixture.initialRequest.taskDigest,
			verifierProfileRef: profile.verifierProfileRef,
			verifierProfileRevision: profile.verifierProfileRevision,
			verifierProfileDigest: empiricalStrictJsonDigest(profile),
			fixtureSuiteRef: profile.fixtureSuiteRef,
			fixtureSuiteRevision: profile.fixtureSuiteRevision,
			fixtureSuiteDigest: profile.fixtureSuiteDigest,
			harnessRevision: profile.harnessRevision,
		});
		const evidenceByKind = new Map(
			fixture.report.observations[0]?.verifierCalibration.evidenceRefs.map((entry) => [
				entry.kind,
				entry,
			]) ?? [],
		);
		const report = await runClosedVerifierCalibration({
			profileCoordinates,
			capability: {
				verifierProfileRef: profile.verifierProfileRef,
				verifierProfileRevision: profile.verifierProfileRevision,
				verifierProfileDigest: empiricalStrictJsonDigest(profile),
				async runCase(input) {
					const evidenceRef = evidenceByKind.get(input.caseKind);
					if (evidenceRef === undefined) throw new Error("missing closed fixture evidence");
					return strictSnapshot({
						schemaVersion: CLOSED_VERIFIER_CALIBRATION_SCHEMAS.caseResult,
						caseKind: input.caseKind,
						observation:
							input.caseKind === "plausible-wrong-verifier"
								? "accepted"
								: expectedCalibrationObservation(input.caseKind),
						evidenceRef,
					});
				},
			},
			signal: new AbortController().signal,
		});

		expect(report.qualified).toBe(false);
		expect(report.issueCodes).toContain("calibration-case-mismatch:plausible-wrong-verifier");
		await fixture.materialization.cleanup();
	});

	it("does not report a nonconforming false cleanup result as success", async () => {
		const fixture = await createClosedHostFixture();
		const baseContentDigest = empiricalSha256(encoder.encode("broken-placeholder-value\n"));
		const port = scriptedPort(fixture, (request) =>
			request.stepIndex === 0
				? {
						finishReason: "tool-intents",
						toolIntents: [
							intent(0, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
								baseContentDigest,
								newText: "fixed",
								oldText: "broken-placeholder-value",
								path: "README.md",
							}),
						],
					}
				: {
						finishReason: "structured-output",
						structuredOutput: {
							kind: "model-turn-output-placeholder",
							summary: "bounded-placeholder",
						},
					},
		);
		const nonconformingMaterialization = {
			...fixture.materialization,
			cleanup: (() => Promise.resolve(false)) as unknown as () => Promise<void>,
		};

		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: nonconformingMaterialization,
			modelTurnPort: port,
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			signal: new AbortController().signal,
		});

		expect(outcome.status).toBe("non-evaluable");
		expect(outcome.cleanupSucceeded).toBe(false);
		expect(outcome.issueCodes).toEqual(["workspace-cleanup-failed"]);
		expect(readFileSync(join(fixture.workspaceRoot, "README.md"), "utf8")).toBe("fixed\n");
		await fixture.materialization.cleanup();
	});
});
