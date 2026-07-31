import { execFileSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
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
	createEmpiricalCampaignScorecard,
	validateEmpiricalCampaignScorecard,
	validateEmpiricalTrialBlockObservation,
} from "../../evals/empirical-memory-rerun-avoidance/empirical-smoke-evidence.js";
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
	B112_FIRST_TASK_SMOKE_AGGREGATION_REVISION,
	B112_SMOKE_BUDGET_ISSUE_CODE,
	runOpenRouterFirstTaskSmoke,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-first-task-smoke.js";
import {
	OPENROUTER_CHAT_COMPLETIONS_ADAPTER_REVISION,
	OPENROUTER_CHAT_COMPLETIONS_BINDING_REVISION,
	OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
	OPENROUTER_CHAT_COMPLETIONS_ENDPOINT_REVISION,
	OPENROUTER_CHAT_COMPLETIONS_PROMPT_REVISION,
	OPENROUTER_CHAT_COMPLETIONS_SYSTEM_PROMPT_REVISION,
	OPENROUTER_RESPONSES_ADAPTER_REVISION,
	OPENROUTER_RESPONSES_BINDING_REVISION,
	OPENROUTER_RESPONSES_ENDPOINT,
	OPENROUTER_RESPONSES_ENDPOINT_REVISION,
	OPENROUTER_RESPONSES_ISSUE_CODES,
	OPENROUTER_RESPONSES_PROMPT_REVISION,
	OPENROUTER_RESPONSES_SYSTEM_PROMPT_REVISION,
	type OpenRouterResponsesByteTransportV1,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-responses-model-turn.js";
import {
	calculateOpenRouterCostMicrousd,
	OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_FIRST_SMOKE_REQUEST_MODEL,
	OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_GLM_5_2_INPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_GLM_5_2_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_GLM_5_2_PRICING_REVISION,
	OPENROUTER_GLM_5_2_PRICING_SOURCE,
	OPENROUTER_GLM_5_2_REQUEST_MODEL,
	OPENROUTER_OFFICIAL_PRICING_REVISION,
	OPENROUTER_OFFICIAL_PRICING_SOURCE,
	OPENROUTER_PROVIDER_USAGE_REVISION,
	OPENROUTER_ROUTE_EVIDENCE_SCHEMA_REVISION,
	OPENROUTER_ROUTE_QUALIFICATION_SCHEMA,
	OPENROUTER_SHARED_CAPACITY_QUALIFICATION_SCHEMA,
	type OpenRouterRouteQualificationV1,
	validateOpenRouterRouteQualification,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-route-qualification.js";
import { persistPrivateSmokeGeneration } from "../../evals/empirical-memory-rerun-avoidance/private-smoke-persistence.js";
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
import { strictJsonCodec } from "../json/codec.js";
import {
	buildEmpiricalCampaignManifestFixture,
	buildEmpiricalQualificationCatalogFixture,
	buildEmpiricalQualificationObservationFixture,
} from "./eval-support/empirical-memory-rerun-avoidance/fixtures.js";
import { buildEmpiricalModelTurnRequestFixture } from "./eval-support/empirical-memory-rerun-avoidance/model-execution-fixtures.js";

const encoder = new TextEncoder();
const immediateRetryWait = Object.freeze({
	async wait(): Promise<void> {},
});
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
	readonly prepareFreshMaterialization: (
		signal: AbortSignal,
	) => Promise<HistoryFreeSingleBaselineRepositoryMaterializationV1>;
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
	modelProfile: "gpt-5.6-sol-medium" | "glm-5.2-high" | "glm-5.2-medium" = "gpt-5.6-sol-medium",
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
	const glmProfile = modelProfile !== "gpt-5.6-sol-medium";
	const modelConfiguration = strictSnapshot({
		...baseConfiguration,
		configurationRef: glmProfile
			? "actor.openrouter.z-ai.glm-5.2"
			: "actor.openrouter.openai.gpt-5.6-sol",
		providerFamily: "openrouter",
		provider: "openrouter",
		model: glmProfile ? OPENROUTER_GLM_5_2_REQUEST_MODEL : OPENROUTER_FIRST_SMOKE_REQUEST_MODEL,
		modelIdentityKind: "alias-disclosed" as const,
		endpoint: glmProfile ? OPENROUTER_CHAT_COMPLETIONS_ENDPOINT : OPENROUTER_RESPONSES_ENDPOINT,
		endpointRevision: glmProfile
			? OPENROUTER_CHAT_COMPLETIONS_ENDPOINT_REVISION
			: OPENROUTER_RESPONSES_ENDPOINT_REVISION,
		adapterRevision: glmProfile
			? OPENROUTER_CHAT_COMPLETIONS_ADAPTER_REVISION
			: OPENROUTER_RESPONSES_ADAPTER_REVISION,
		bindingRevision: glmProfile
			? OPENROUTER_CHAT_COMPLETIONS_BINDING_REVISION
			: OPENROUTER_RESPONSES_BINDING_REVISION,
		promptRevision: glmProfile
			? OPENROUTER_CHAT_COMPLETIONS_PROMPT_REVISION
			: OPENROUTER_RESPONSES_PROMPT_REVISION,
		systemPromptRevision: glmProfile
			? OPENROUTER_CHAT_COMPLETIONS_SYSTEM_PROMPT_REVISION
			: OPENROUTER_RESPONSES_SYSTEM_PROMPT_REVISION,
		capabilities: {
			toolCalling: true,
			structuredOutput: true,
			reasoningControl: true,
			seed: false,
			providerUsage: true,
		},
		settings: {
			...baseConfiguration.settings,
			sampling: { temperature: null, topP: null, seed: null },
			reasoning: {
				mode: "provider-native" as const,
				effort: modelProfile === "glm-5.2-high" ? "high" : "medium",
			},
			tools: {
				...baseConfiguration.settings.tools,
				schemaRevision: schemaCatalog.catalogRevision,
				toolRefs: schemaCatalog.tools.map((tool) => tool.toolRef),
				toolSetDigest: empiricalStrictJsonDigest(schemaCatalog.tools),
				maxSteps: 8,
			},
		},
		usageSource: "provider-reported" as const,
		pricingRevision: glmProfile
			? OPENROUTER_GLM_5_2_PRICING_REVISION
			: OPENROUTER_OFFICIAL_PRICING_REVISION,
		pricingScheduleRef: glmProfile
			? OPENROUTER_GLM_5_2_PRICING_SOURCE
			: OPENROUTER_OFFICIAL_PRICING_SOURCE,
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
			const targetAccepted = readFileSync(join(workspaceRoot, "README.md"), "utf8") === "fixed\n";
			return strictSnapshot({
				schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.verifierResult,
				verdict: targetAccepted ? "passed" : "failed",
				evidenceRefs: [targetRunEvidence(input.profileCoordinates)],
				issueCodes: targetAccepted ? [] : ["target-artifact-mismatch"],
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
		prepareFreshMaterialization: (signal) =>
			materializeHistoryFreeSingleBaselineRepository(source, allocator, {
				sourceCommitSha,
				sourceTreeObjectId,
				overlay: null,
				signal,
			}),
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
				providerCostMicrousd: null,
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

function nonEvaluableOutcome(
	request: EmpiricalModelTurnRequestV1,
	frozen: FrozenEmpiricalCampaignManifestV1,
	report: EmpiricalTaskQualificationReportV1,
	protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1,
	issueCodes: readonly string[],
	hostOutputBytes: number,
): EmpiricalModelTurnOutcomeV1 {
	const evidenceRefs = strictSnapshot([]);
	const protectedIssueCodes = strictSnapshot(issueCodes);
	const egressMaterial = strictSnapshot({
		evidenceRefs,
		issueCodes: protectedIssueCodes,
		structuredOutput: null,
		toolIntents: [],
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
			status: "non-evaluable",
			finishReason: null,
			outputSchemaDigest: request.outputSchema.schemaDigest,
			structuredOutput: null,
			structuredOutputDigest: null,
			toolIntents: [],
			usage: {
				source: request.usageSource,
				inputTokens: null,
				outputTokens: null,
				totalTokens: null,
				providerCostMicrousd: null,
				requests: 1,
				hostInputBytes: 128,
				hostOutputBytes,
			},
			latencyMs: 1,
			issueCodes: protectedIssueCodes,
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

function simulatedRouteQualification(
	fixture: ClosedHostFixture,
	budgetOverrides: Readonly<Record<string, number>> = {},
): OpenRouterRouteQualificationV1 {
	const configuration = fixture.frozen.manifest.modelConfigurations[0];
	if (configuration === undefined) throw new Error("missing smoke configuration");
	const credentialBindingRef = fixture.frozen.manifest.policies.actorCredentialBindingRef;
	const credentialBindingRevision = fixture.frozen.manifest.policies.actorCredentialBindingRevision;
	const glmProfile = configuration.model === OPENROUTER_GLM_5_2_REQUEST_MODEL;
	const qualification: OpenRouterRouteQualificationV1 = {
		schemaVersion: OPENROUTER_ROUTE_QUALIFICATION_SCHEMA,
		qualificationRef: "b112-simulated-route-qualification",
		qualificationRevision: "b112-simulated-route-qualification.v1",
		dispatchMode: "simulated" as const,
		campaignRef: fixture.frozen.manifest.campaignRef,
		manifestDigest: fixture.frozen.manifestDigest,
		trialBlockRef: fixture.initialRequest.trialBlockRef,
		trialBlockDigest: fixture.initialRequest.trialBlockDigest,
		configurationRef: configuration.configurationRef,
		configurationDigest: empiricalStrictJsonDigest(configuration),
		requestModel: configuration.model,
		modelIdentityKind: configuration.modelIdentityKind,
		downstreamProviderSlug: glmProfile
			? OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_SLUG
			: OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_SLUG,
		downstreamProviderName: glmProfile
			? OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME
			: OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_NAME,
		endpoint: configuration.endpoint as OpenRouterRouteQualificationV1["endpoint"],
		endpointRevision: configuration.endpointRevision,
		adapterRevision: configuration.adapterRevision,
		bindingRevision: configuration.bindingRevision,
		capabilitiesDigest: empiricalStrictJsonDigest(configuration.capabilities),
		settingsDigest: empiricalStrictJsonDigest(configuration.settings),
		usageSource: configuration.usageSource,
		usageRevision: OPENROUTER_PROVIDER_USAGE_REVISION,
		routeEvidenceSchemaRevision: OPENROUTER_ROUTE_EVIDENCE_SCHEMA_REVISION,
		pricing: {
			sourceUrl: configuration.pricingScheduleRef,
			pricingRevision: configuration.pricingRevision,
			currency: "USD" as const,
			inputMicrousdPerMillionTokens: glmProfile
				? OPENROUTER_GLM_5_2_INPUT_MICROUSD_PER_MILLION_TOKENS
				: 6_250_000,
			outputMicrousdPerMillionTokens: glmProfile
				? OPENROUTER_GLM_5_2_OUTPUT_MICROUSD_PER_MILLION_TOKENS
				: 30_000_000,
		},
		budget: {
			approvalRef: "b112-simulated-budget",
			approvalRevision: "b112-simulated-budget.v1",
			maxSmokeSpendMicrousd: 1_000_000,
			maxRequests: 8,
			maxStepsPerRun: 8,
			maxCanonicalRequestBytes: 262_144,
			maxInputTokens: 100_000,
			maxOutputTokens: 49_152,
			maxLatencyMs: 60_000,
			reservationRevision: "canonical-byte-upper-bound-reservation.v1",
			inputTokensPerCanonicalByteUpperBound: 1 as const,
			fixedInputTokenOverheadPerRequest: 4_096,
			...budgetOverrides,
		},
		keySpendLimit: {
			qualificationRef: "b112-simulated-key-limit",
			qualificationRevision: "b112-simulated-key-limit.v1",
			readOnlyQualified: false,
			limitReset: "none" as const,
			limitMicrousd: 1_000_000,
			remainingMicrousd: 1_000_000,
			credentialBindingRef,
			credentialBindingRevision,
			workspaceRef: "b112-dedicated-openrouter-workspace",
			workspaceRevision: "b112-simulated-workspace-attestation.v1",
		},
		sharedCapacityQualification: {
			schemaVersion: OPENROUTER_SHARED_CAPACITY_QUALIFICATION_SCHEMA,
			qualificationRef: "b112-simulated-shared-capacity",
			qualificationRevision: "b112-simulated-shared-capacity.v1",
			credentialBindingRef,
			credentialBindingRevision,
			workspaceRef: "b112-dedicated-openrouter-workspace",
			workspaceRevision: "b112-simulated-workspace-attestation.v1",
			capacityMode: "openrouter-shared-only" as const,
			qualified: true as const,
			byokCredentialCount: 0 as const,
		},
	};
	return strictSnapshot(qualification);
}

function liveRouteQualification(
	fixture: ClosedHostFixture,
	budgetOverrides: Readonly<Record<string, number>> = {},
): OpenRouterRouteQualificationV1 {
	const simulated = simulatedRouteQualification(fixture, budgetOverrides);
	const workspaceRef = "openrouter-workspace.closed-host-fixture";
	const workspaceRevision = "openrouter-workspace.closed-host-fixture.v1";
	return strictSnapshot({
		...simulated,
		qualificationRef: "b112-live-route-qualification",
		qualificationRevision: "b112-live-route-qualification.v1",
		dispatchMode: "live-approved" as const,
		budget: {
			...simulated.budget,
			approvalRef: "b112-live-budget-approval",
			approvalRevision: "b112-live-budget-approval.v1",
		},
		keySpendLimit: {
			...simulated.keySpendLimit,
			qualificationRef: "b112-live-key-limit",
			qualificationRevision: "b112-live-key-limit.v1",
			readOnlyQualified: true,
			workspaceRef,
			workspaceRevision,
		},
		sharedCapacityQualification: {
			...simulated.sharedCapacityQualification,
			qualificationRef: "d661-live-shared-capacity",
			qualificationRevision: "d661-live-shared-capacity.v1",
			workspaceRef,
			workspaceRevision,
		},
	});
}

function dryRunOpenRouterResponse(
	id: string,
	output: readonly unknown[],
	usage: Readonly<Record<string, unknown>> = {
		input_tokens: 100,
		output_tokens: 20,
		total_tokens: 120,
		cost: 0.001_225,
	},
	route: {
		readonly requestModel: string;
		readonly downstreamProviderName: string;
	} = {
		requestModel: OPENROUTER_FIRST_SMOKE_REQUEST_MODEL,
		downstreamProviderName: OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_NAME,
	},
): { readonly status: 200; readonly body: Uint8Array; readonly retryAfterMs: null } {
	const routeMetadata = {
		requested: route.requestModel,
		strategy: "direct",
		attempt: 1,
		is_byok: false,
		endpoints: {
			total: 1,
			available: [
				{
					provider: route.downstreamProviderName,
					model: route.requestModel,
					selected: true,
				},
			],
		},
		attempts: [
			{
				provider: route.downstreamProviderName,
				model: route.requestModel,
				status: 200,
			},
		],
		pipeline: [],
	};
	let response: Record<string, unknown>;
	if (route.requestModel === OPENROUTER_GLM_5_2_REQUEST_MODEL) {
		const functionCalls = output
			.map((item) => item as Record<string, unknown>)
			.filter((item) => item.type === "function_call");
		const message = output
			.map((item) => item as Record<string, unknown>)
			.find((item) => item.type === "message");
		const content = message?.content as readonly { readonly text?: unknown }[] | undefined;
		const inputTokens = usage.input_tokens;
		const outputTokens = usage.output_tokens;
		response = {
			id,
			object: "chat.completion",
			model: route.requestModel,
			choices: [
				functionCalls.length > 0
					? {
							index: 0,
							finish_reason: "tool_calls",
							message: {
								role: "assistant",
								content: null,
								tool_calls: functionCalls.map((call) => ({
									id: call.call_id,
									type: "function",
									function: {
										name: call.name,
										arguments: call.arguments,
									},
								})),
							},
						}
					: {
							index: 0,
							finish_reason: "stop",
							message: {
								role: "assistant",
								content: content?.[0]?.text,
							},
						},
			],
			usage: {
				prompt_tokens: inputTokens,
				completion_tokens: outputTokens,
				total_tokens: usage.total_tokens,
				cost: usage.cost,
			},
			openrouter_metadata: routeMetadata,
		};
	} else {
		response = {
			id,
			object: "response",
			status: "completed",
			model: route.requestModel,
			output,
			usage,
			openrouter_metadata: routeMetadata,
		};
	}
	return {
		status: 200,
		body: encoder.encode(JSON.stringify(response)),
		retryAfterMs: null,
	};
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
			logicalStepCount: 6,
			attemptCount: 6,
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
		expect(outcome.actionTrace.map((entry) => entry.actionIndex)).toEqual([0, 1, 2, 3, 4]);
		expect(outcome.actionTrace.map((entry) => entry.stepIndex)).toEqual([0, 1, 2, 3, 4]);
		expect(
			outcome.actionTrace.every(
				(entry) =>
					entry.initialRequestDigest === outcome.initialRequestDigest &&
					entry.memoryContextRecordDigest === null &&
					outcome.turnEvidence[entry.stepIndex]?.requestDigest === entry.requestDigest &&
					outcome.toolEvidence.some(
						(tool) =>
							tool.toolCallRefDigest === entry.toolCallRefDigest &&
							tool.toolRef === entry.toolRef &&
							tool.resultDigest === entry.resultDigest,
					),
			),
		).toBe(true);
		expect(outcome.workspaceChanged).toBe(true);
		expect(outcome.workspaceBaselineDigest).not.toBe(outcome.workspaceStateDigest);
		expect(JSON.stringify(outcome)).not.toContain("broken");
		expect(JSON.stringify(outcome)).not.toContain(fixture.workspaceRoot);
		expect(() => readFileSync(join(fixture.workspaceRoot, "README.md"))).toThrow();
	});

	it("rejects GLM downstream-provider or pricing substitution before transport", async () => {
		const fixture = await createClosedHostFixture(undefined, undefined, "glm-5.2-high");
		const route = simulatedRouteQualification(fixture);
		let transportCalls = 0;
		const input = {
			host: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: fixture.materialization,
				verifier: fixture.verifier,
			},
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: "openrouter-route-substitution-secret-sentinel-0123456789",
			},
			transport: {
				request() {
					transportCalls += 1;
					throw new Error("transport must not run");
				},
			},
			monotonicMeasurement: { readMs: () => 0 },
			retryWait: immediateRetryWait,
			executionClass: "simulated-contract" as const,
			privateRoot: temporaryRoot("route-substitution"),
			generationRef: "route-substitution-generation",
			signal: new AbortController().signal,
		};
		await expect(
			runOpenRouterFirstTaskSmoke({
				...input,
				routeQualification: strictSnapshot({
					...route,
					downstreamProviderSlug: "other-provider/fp4",
				}),
			}),
		).rejects.toThrow(/frozen exact route and pricing/);
		await expect(
			runOpenRouterFirstTaskSmoke({
				...input,
				routeQualification: strictSnapshot({
					...route,
					pricing: {
						...route.pricing,
						inputMicrousdPerMillionTokens: 1,
						outputMicrousdPerMillionTokens: 1,
					},
				}),
			}),
		).rejects.toThrow(/frozen exact route and pricing/);
		expect(transportCalls).toBe(0);
		await fixture.materialization.cleanup();
	});

	it("rejects a GLM medium-effort profile before transport", async () => {
		const fixture = await createClosedHostFixture(undefined, undefined, "glm-5.2-medium");
		let transportCalls = 0;
		await expect(
			runOpenRouterFirstTaskSmoke({
				host: {
					frozen: fixture.frozen,
					qualificationReport: fixture.report,
					initialRequest: fixture.initialRequest,
					taskProfile: fixture.taskProfile,
					materialization: fixture.materialization,
					verifier: fixture.verifier,
				},
				routeQualification: simulatedRouteQualification(fixture),
				credential: {
					credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
					credentialBindingRevision:
						fixture.frozen.manifest.policies.actorCredentialBindingRevision,
					bearerToken: "openrouter-medium-effort-secret-sentinel-0123456789",
				},
				transport: {
					request() {
						transportCalls += 1;
						throw new Error("transport must not run");
					},
				},
				monotonicMeasurement: { readMs: () => 0 },
				retryWait: immediateRetryWait,
				executionClass: "simulated-contract",
				privateRoot: temporaryRoot("medium-effort"),
				generationRef: "medium-effort-generation",
				signal: new AbortController().signal,
			}),
		).rejects.toThrow(/frozen exact route and pricing/);
		expect(transportCalls).toBe(0);
		await fixture.materialization.cleanup();
	});

	it("dry-runs injected OpenRouter bytes through host, verifier, canonical evidence, and atomic private persistence", async () => {
		const fixture = await createClosedHostFixture();
		const credentialSentinel = "openrouter-dry-run-secret-sentinel-0123456789";
		const baseContentDigest = empiricalSha256(encoder.encode("broken-placeholder-value\n"));
		let transportCalls = 0;
		const transport: OpenRouterResponsesByteTransportV1 = {
			async request(input) {
				transportCalls += 1;
				const requestBody = JSON.parse(new TextDecoder().decode(input.body)) as {
					readonly tools: readonly { readonly name: string }[];
				};
				const output =
					transportCalls === 1
						? [
								{ type: "reasoning", summary: [] },
								{
									type: "function_call",
									status: "completed",
									call_id: "call.replace-exact",
									name: requestBody.tools[2]?.name,
									arguments: JSON.stringify({
										baseContentDigest,
										newText: "fixed",
										oldText: "broken-placeholder-value",
										path: "README.md",
									}),
								},
							]
						: [
								{ type: "reasoning", summary: [] },
								{
									type: "message",
									role: "assistant",
									status: "completed",
									content: [
										{
											type: "output_text",
											text: JSON.stringify({
												kind: "model-turn-output-placeholder",
												summary: "bounded-placeholder",
											}),
										},
									],
								},
							];
				return {
					status: 200,
					body: encoder.encode(
						JSON.stringify({
							id: `response.dry-run.${transportCalls}`,
							object: "response",
							status: "completed",
							model: OPENROUTER_FIRST_SMOKE_REQUEST_MODEL,
							output,
							usage: {
								input_tokens: 100,
								output_tokens: 20,
								total_tokens: 120,
								cost: 0.001_225,
							},
							openrouter_metadata: {
								requested: OPENROUTER_FIRST_SMOKE_REQUEST_MODEL,
								strategy: "direct",
								attempt: 1,
								is_byok: false,
								endpoints: {
									total: 1,
									available: [
										{
											provider: OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_NAME,
											model: OPENROUTER_FIRST_SMOKE_REQUEST_MODEL,
											selected: true,
										},
									],
								},
								attempts: [
									{
										provider: OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_NAME,
										model: OPENROUTER_FIRST_SMOKE_REQUEST_MODEL,
										status: 200,
									},
								],
								pipeline: [],
							},
						}),
					),
					retryAfterMs: null,
				};
			},
		};
		const artifactRoot = temporaryRoot("private-artifacts");
		const privateRoot = join(artifactRoot, ".private", "empirical-memory-rerun-avoidance");
		mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
		chmodSync(privateRoot, 0o700);
		let measurement = 0;
		const routeQualification = simulatedRouteQualification(fixture);
		const result = await runOpenRouterFirstTaskSmoke({
			host: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: fixture.materialization,
				verifier: fixture.verifier,
			},
			routeQualification,
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: credentialSentinel,
			},
			transport,
			monotonicMeasurement: { readMs: () => (measurement += 1) },
			retryWait: immediateRetryWait,
			executionClass: "simulated-contract",
			privateRoot,
			generationRef: "dry-run-generation",
			signal: new AbortController().signal,
		});

		expect(transportCalls).toBe(2);
		expect(result.observation).toMatchObject({
			executionClass: "simulated-contract",
			empiricalLiveEvidence: false,
			result: {
				classification: "complete",
				verifierStatus: "passed",
				requests: 2,
				steps: 2,
				costMicrousd: 0,
				costBasis: "simulated-contract",
			},
		});
		expect(result.scorecard).toMatchObject({
			evidenceClass: "simulated-contract",
			empiricalLiveEvidence: false,
			efficacyClaim: "none",
			costMicrousd: 0,
			costBasis: "simulated-contract",
			status: "smoke-complete-no-efficacy-claim",
			aggregationRevision: B112_FIRST_TASK_SMOKE_AGGREGATION_REVISION,
		});
		expect(validateEmpiricalTrialBlockObservation(result.observation)).toEqual(result.observation);
		const providerReportedCostObservation = validateEmpiricalTrialBlockObservation({
			...result.observation,
			executionClass: "live-provider",
			empiricalLiveEvidence: true,
			result: {
				...result.observation.result,
				costBasis: "provider-usage",
				costMicrousd: 2_452,
				reservedInputTokens: 200,
				reservedOutputTokens: 40,
			},
			cold: {
				...result.observation.cold,
				costBasis: "provider-usage",
				costMicrousd: 2_452,
				reservedInputTokens: 200,
				reservedOutputTokens: 40,
			},
		});
		expect(
			strictJsonCodec.encode(
				createEmpiricalCampaignScorecard(
					result.observation,
					B112_FIRST_TASK_SMOKE_AGGREGATION_REVISION,
				),
			),
		).toEqual(strictJsonCodec.encode(result.scorecard));
		expect(providerReportedCostObservation.result.costMicrousd).toBe(2_452);
		expect(validateEmpiricalCampaignScorecard(result.scorecard)).toEqual(result.scorecard);
		const repeatedScorecard = createEmpiricalCampaignScorecard(
			result.observation,
			B112_FIRST_TASK_SMOKE_AGGREGATION_REVISION,
		);
		expect(strictJsonCodec.encode(repeatedScorecard)).toEqual(
			strictJsonCodec.encode(result.scorecard),
		);
		const preDispatchObservation = validateEmpiricalTrialBlockObservation({
			...result.observation,
			executionClass: "live-approved-no-provider-evidence",
			empiricalLiveEvidence: false,
			result: {
				...result.observation.result,
				classification: "non-evaluable",
				verifierStatus: "not-run",
				requests: 0,
				inputTokens: null,
				outputTokens: null,
				totalTokens: null,
				costMicrousd: 109_122,
				costBasis: "conservative-reservation",
				reservedInputTokens: 7_629,
				reservedOutputTokens: 2_048,
			},
			cold: {
				...result.observation.cold,
				classification: "non-evaluable",
				verifierStatus: "not-run",
				requests: 0,
				inputTokens: null,
				outputTokens: null,
				totalTokens: null,
				costMicrousd: 109_122,
				costBasis: "conservative-reservation",
				reservedInputTokens: 7_629,
				reservedOutputTokens: 2_048,
				routeEvidenceDigests: [],
				verifierEvidenceDigests: [],
				attemptTrace: result.observation.cold.attemptTrace.map((attempt) => ({
					...attempt,
					requests: 0 as const,
				})),
			},
			rerunEligible: false,
			routeEvidenceDigests: [],
			verifierEvidenceDigests: [],
			issueCodes: ["model-turn-non-evaluable", "openrouter-measurement-invalid"],
		});
		const preDispatchScorecard = createEmpiricalCampaignScorecard(
			preDispatchObservation,
			B112_FIRST_TASK_SMOKE_AGGREGATION_REVISION,
		);
		expect(preDispatchScorecard).toMatchObject({
			evidenceClass: "live-approved-no-provider-evidence",
			empiricalLiveEvidence: false,
			requests: 0,
			costMicrousd: 109_122,
			costBasis: "conservative-reservation",
			reservedInputTokens: 7_629,
			reservedOutputTokens: 2_048,
			status: "non-evaluable",
		});
		expect(() =>
			validateEmpiricalTrialBlockObservation({
				...preDispatchObservation,
				result: {
					...preDispatchObservation.result,
					inputTokens: 1,
					outputTokens: 1,
					totalTokens: 2,
					costBasis: "provider-usage",
				},
			}),
		).toThrow(/aggregate does not match|exceeds or mismatches/);
		expect(() =>
			validateEmpiricalCampaignScorecard({
				...preDispatchScorecard,
				inputTokens: 1,
				outputTokens: 1,
				totalTokens: 2,
				costBasis: "provider-usage",
			}),
		).toThrow(/evidence and cost provenance/);
		expect(() =>
			validateEmpiricalTrialBlockObservation({
				...preDispatchObservation,
				result: {
					...preDispatchObservation.result,
					costMicrousd: 0,
				},
			}),
		).toThrow(/aggregate does not match|frozen pricing and token basis/);
		const liveFailureObservation = validateEmpiricalTrialBlockObservation({
			...result.observation,
			executionClass: "live-provider",
			empiricalLiveEvidence: true,
			result: {
				...result.observation.result,
				classification: "non-evaluable",
				verifierStatus: "not-run",
				requests: 1,
				inputTokens: null,
				outputTokens: null,
				totalTokens: null,
				costMicrousd: 109_122,
				costBasis: "conservative-reservation",
				reservedInputTokens: 7_629,
				reservedOutputTokens: 2_048,
			},
			cold: {
				...result.observation.cold,
				classification: "non-evaluable",
				verifierStatus: "not-run",
				requests: 1,
				inputTokens: null,
				outputTokens: null,
				totalTokens: null,
				costMicrousd: 109_122,
				costBasis: "conservative-reservation",
				reservedInputTokens: 7_629,
				reservedOutputTokens: 2_048,
				routeEvidenceDigests: [],
				verifierEvidenceDigests: [],
				attemptTrace: result.observation.cold.attemptTrace.map((attempt, index) => ({
					...attempt,
					requests: (index === 0 ? 1 : 0) as 0 | 1,
				})),
			},
			rerunEligible: false,
			routeEvidenceDigests: [],
			verifierEvidenceDigests: [],
			issueCodes: ["openrouter-transport-unavailable"],
		});
		const liveFailureScorecard = createEmpiricalCampaignScorecard(
			liveFailureObservation,
			B112_FIRST_TASK_SMOKE_AGGREGATION_REVISION,
		);
		expect(liveFailureScorecard).toMatchObject({
			evidenceClass: "live-provider",
			empiricalLiveEvidence: true,
			requests: 1,
			costBasis: "conservative-reservation",
			status: "non-evaluable",
		});
		await expect(
			persistPrivateSmokeGeneration({
				privateRoot,
				generationRef: "live-failure-contract-generation",
				observation: liveFailureObservation,
				scorecard: liveFailureScorecard,
				protectionExecutor: fixture.protectionExecutor,
			}),
		).resolves.toMatchObject({
			observationDigest: liveFailureScorecard.observationDigests[0],
		});
		expect(() =>
			validateEmpiricalTrialBlockObservation({
				...result.observation,
				rawProviderResponse: "forbidden",
			}),
		).toThrow(/unexpected keys/);
		expect(() =>
			validateEmpiricalTrialBlockObservation({
				...result.observation,
				routeEvidenceDigests: [],
				verifierEvidenceDigests: [],
				protectionReceiptDigests: [],
			}),
		).toThrow(/evidence digests do not match|required frozen evidence/);
		const overrunInputTokens = result.observation.route.maxInputTokens + 1;
		const overrunOutputTokens = result.observation.route.maxOutputTokens + 1;
		const overrunObservation = {
			...result.observation,
			executionClass: "live-provider" as const,
			empiricalLiveEvidence: true,
			result: {
				...result.observation.result,
				classification: "non-evaluable" as const,
				verifierStatus: "not-run" as const,
				inputTokens: overrunInputTokens,
				outputTokens: overrunOutputTokens,
				costMicrousd: calculateOpenRouterCostMicrousd(overrunInputTokens, overrunOutputTokens, {
					currency: "USD",
					inputMicrousdPerMillionTokens: result.observation.route.inputMicrousdPerMillionTokens,
					outputMicrousdPerMillionTokens: result.observation.route.outputMicrousdPerMillionTokens,
					pricingRevision: result.observation.route.pricingRevision,
					sourceUrl: result.observation.route.pricingSourceUrl,
				}),
				costBasis: "provider-usage" as const,
				reservedInputTokens: overrunInputTokens,
				reservedOutputTokens: overrunOutputTokens,
			},
			cold: {
				...result.observation.cold,
				classification: "non-evaluable" as const,
				verifierStatus: "not-run" as const,
				inputTokens: overrunInputTokens,
				outputTokens: overrunOutputTokens,
				costMicrousd: calculateOpenRouterCostMicrousd(overrunInputTokens, overrunOutputTokens, {
					currency: "USD",
					inputMicrousdPerMillionTokens: result.observation.route.inputMicrousdPerMillionTokens,
					outputMicrousdPerMillionTokens: result.observation.route.outputMicrousdPerMillionTokens,
					pricingRevision: result.observation.route.pricingRevision,
					sourceUrl: result.observation.route.pricingSourceUrl,
				}),
				costBasis: "provider-usage" as const,
				reservedInputTokens: overrunInputTokens,
				reservedOutputTokens: overrunOutputTokens,
			},
			rerunEligible: false,
			issueCodes: ["smoke-budget-exhausted"],
		};
		expect(validateEmpiricalTrialBlockObservation(overrunObservation).result.costBasis).toBe(
			"provider-usage",
		);
		expect(() =>
			validateEmpiricalTrialBlockObservation({
				...overrunObservation,
				result: {
					...overrunObservation.result,
					costBasis: "conservative-reservation",
					costMicrousd: 0,
					reservedInputTokens: 0,
					reservedOutputTokens: 0,
				},
			}),
		).toThrow(/aggregate does not match|frozen pricing and token basis/);
		expect(() =>
			validateEmpiricalTrialBlockObservation({
				...overrunObservation,
				routeEvidenceDigests: [],
				protectionReceiptDigests: [],
			}),
		).toThrow(/evidence digests do not match|required frozen evidence/);
		const persistedFiles = readdirSync(result.persistence.generationPath).sort();
		expect(persistedFiles).toEqual([
			"campaign-scorecard.v3.json",
			"generation.v3.json",
			"trial-block-observation.v3.json",
		]);
		for (const file of persistedFiles) {
			expect(statSync(join(result.persistence.generationPath, file)).mode & 0o777).toBe(0o600);
			const persisted = readFileSync(join(result.persistence.generationPath, file), "utf8");
			expect(persisted).not.toContain(credentialSentinel);
			expect(persisted).not.toMatch(
				/raw provider|rawResponse|stdout|stderr|expected patch|environment material/i,
			);
		}
		await expect(
			persistPrivateSmokeGeneration({
				privateRoot,
				generationRef: "dry-run-generation",
				observation: result.observation,
				scorecard: result.scorecard,
				protectionExecutor: fixture.protectionExecutor,
			}),
		).rejects.toThrow();
		expect(readdirSync(privateRoot).filter((name) => name.startsWith(".staging-"))).toEqual([]);
		await expect(
			persistPrivateSmokeGeneration({
				privateRoot,
				generationRef: "safe/../../escaped-generation",
				observation: result.observation,
				scorecard: result.scorecard,
				protectionExecutor: fixture.protectionExecutor,
			}),
		).rejects.toThrow(/path-free coordinate/);
		expect(readdirSync(join(artifactRoot, ".private"))).not.toContain("escaped-generation");
		await expect(
			persistPrivateSmokeGeneration({
				privateRoot,
				generationRef: "forged-live-scorecard",
				observation: result.observation,
				scorecard: {
					...result.scorecard,
					evidenceClass: "live-provider",
					empiricalLiveEvidence: true,
				},
				protectionExecutor: fixture.protectionExecutor,
			}),
		).rejects.toThrow(/evidence and cost provenance|canonical aggregation/);
		expect(readdirSync(privateRoot)).not.toContain("forged-live-scorecard");

		const contaminatedObservation = strictSnapshot({
			...result.observation,
			issueCodes: [credentialSentinel],
		});
		const contaminatedScorecard = createEmpiricalCampaignScorecard(
			contaminatedObservation,
			B112_FIRST_TASK_SMOKE_AGGREGATION_REVISION,
		);
		const sentinelProtection = createEmpiricalExactPrivateNeedleProtectionExecutor({
			policyRef: fixture.initialRequest.protectionPolicyRef,
			policyRevision: fixture.initialRequest.protectionPolicyRevision,
			protectedNeedleCapabilityRef: "dry-run-sentinel",
			protectedNeedleCapabilityRevision: "dry-run-sentinel.v1",
			protectedNeedles: [credentialSentinel],
		});
		await expect(
			persistPrivateSmokeGeneration({
				privateRoot,
				generationRef: "credential-leak-generation",
				observation: contaminatedObservation,
				scorecard: contaminatedScorecard,
				protectionExecutor: sentinelProtection,
			}),
		).rejects.toThrow(/artifact-persistence protection/);
		expect(readdirSync(privateRoot)).not.toContain("credential-leak-generation");
		await expect(
			persistPrivateSmokeGeneration({
				privateRoot,
				generationRef: credentialSentinel,
				observation: result.observation,
				scorecard: result.scorecard,
				protectionExecutor: sentinelProtection,
			}),
		).rejects.toThrow(/generation failed artifact-persistence protection/);
		expect(readdirSync(privateRoot)).not.toContain(credentialSentinel);
	});

	it("dry-runs one failed cold run and the exact five fresh matched warm arms atomically", async () => {
		const fixture = await createClosedHostFixture(undefined, undefined, "glm-5.2-high");
		const credentialSentinel = "openrouter-matched-block-secret-sentinel-0123456789";
		const baseContentDigest = empiricalSha256(encoder.encode("broken-placeholder-value\n"));
		const taskSpecificCorrectionSentinel =
			"replace broken-placeholder-value with fixed task-specific correction";
		const wireBodies: string[] = [];
		const actorInputs: string[] = [];
		let transportCalls = 0;
		let correctionIssued = false;
		let expectedRelevantMemoryDigest: string | null = null;
		const validatesGenericMemory = (
			memoryContext:
				| {
						readonly kind?: string;
						readonly revision?: string;
						readonly recordDigest?: string;
						readonly text?: string;
				  }
				| undefined,
			expectedDigest: string | null,
		) =>
			memoryContext?.kind === "agentic-memory-context" &&
			memoryContext.revision === "b112-matched-block-memory.v2" &&
			memoryContext.recordDigest === expectedDigest &&
			typeof memoryContext.text === "string" &&
			memoryContext.text.includes("Previous bounded action route") &&
			memoryContext.text.includes("re-inspect the allowed implementation and tests") &&
			!memoryContext.text.match(/managed-compute|tool-provider-run-admission/);
		expect(
			validatesGenericMemory(
				{
					kind: "agentic-memory-context",
					revision: "b112-matched-block-memory.v2",
					recordDigest: `sha256:${"a".repeat(64)}`,
					text: "Previous bounded action route; re-inspect the allowed implementation and tests.",
				},
				`sha256:${"b".repeat(64)}`,
			),
		).toBe(false);
		const transport: OpenRouterResponsesByteTransportV1 = {
			async request(input) {
				transportCalls += 1;
				const wireBody = new TextDecoder().decode(input.body);
				wireBodies.push(wireBody);
				const requestBody = JSON.parse(wireBody) as {
					readonly tools: readonly {
						readonly function: { readonly name: string };
					}[];
					readonly messages: readonly {
						readonly role: string;
						readonly content: string;
					}[];
				};
				const userMessage = requestBody.messages.find((message) => message.role === "user");
				if (userMessage === undefined) throw new TypeError("missing GLM Chat user message");
				actorInputs.push(userMessage.content);
				const userEnvelope = JSON.parse(userMessage.content) as {
					readonly structuredInput?: {
						readonly memoryContext?: {
							readonly kind?: string;
							readonly revision?: string;
							readonly recordDigest?: string;
							readonly text?: string;
						};
					};
				};
				const memoryContext = userEnvelope.structuredInput?.memoryContext;
				const hasValidatedGenericMemory = validatesGenericMemory(
					memoryContext,
					expectedRelevantMemoryDigest,
				);
				const output =
					transportCalls === 1
						? [
								{
									type: "function_call",
									status: "completed",
									call_id: "call.matched-cold-read",
									name: requestBody.tools[0]?.function.name,
									arguments: JSON.stringify({ path: "README.md" }),
								},
							]
						: hasValidatedGenericMemory && !correctionIssued
							? [
									{
										type: "function_call",
										status: "completed",
										call_id: "call.matched-replace",
										name: requestBody.tools[2]?.function.name,
										arguments: JSON.stringify({
											baseContentDigest,
											newText: "fixed",
											oldText: "broken-placeholder-value",
											path: "README.md",
										}),
									},
								]
							: [
									{
										type: "message",
										role: "assistant",
										status: "completed",
										content: [
											{
												type: "output_text",
												text: JSON.stringify({
													kind: "model-turn-output-placeholder",
													summary:
														transportCalls === 2
															? taskSpecificCorrectionSentinel
															: "Bounded matched-block completion.",
												}),
											},
										],
									},
								];
				if (hasValidatedGenericMemory && !correctionIssued) correctionIssued = true;
				return dryRunOpenRouterResponse(`response.matched.${transportCalls}`, output, undefined, {
					requestModel: OPENROUTER_GLM_5_2_REQUEST_MODEL,
					downstreamProviderName: OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME,
				});
			},
		};
		const privateRoot = join(
			temporaryRoot("matched-private-artifacts"),
			".private",
			"empirical-memory-rerun-avoidance",
		);
		mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
		chmodSync(privateRoot, 0o700);
		const historicalGenerationRef = "historical-v1-generation";
		const historicalGenerationRoot = join(privateRoot, historicalGenerationRef);
		mkdirSync(historicalGenerationRoot, { mode: 0o700 });
		const historicalV1Files = [
			"trial-block-observation.v1.json",
			"campaign-scorecard.v1.json",
			"generation.v1.json",
		] as const;
		const historicalV1Bytes = new Map<string, string>();
		for (const file of historicalV1Files) {
			const content = JSON.stringify({ kind: "immutable-historical-v1", file });
			writeFileSync(join(historicalGenerationRoot, file), content, { mode: 0o600 });
			chmodSync(join(historicalGenerationRoot, file), 0o600);
			historicalV1Bytes.set(file, content);
		}
		let measurement = 0;
		const routeQualification = simulatedRouteQualification(fixture, {
			maxRequests: 48,
			maxStepsPerRun: 8,
			maxInputTokens: 600_000,
			maxOutputTokens: 49_152,
		});
		const credential = {
			credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
			credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
			bearerToken: credentialSentinel,
		};
		const prepareWarmHost = async (
			input: Parameters<
				NonNullable<Parameters<typeof runOpenRouterFirstTaskSmoke>[0]["prepareWarmHost"]>
			>[0],
		) => {
			const structuredInput = input.initialRequest.structuredInput;
			if (
				structuredInput !== null &&
				typeof structuredInput === "object" &&
				!Array.isArray(structuredInput) &&
				"memoryContext" in structuredInput &&
				structuredInput.memoryContext !== null &&
				typeof structuredInput.memoryContext === "object" &&
				!Array.isArray(structuredInput.memoryContext) &&
				"recordDigest" in structuredInput.memoryContext &&
				typeof structuredInput.memoryContext.recordDigest === "string"
			) {
				expectedRelevantMemoryDigest = structuredInput.memoryContext.recordDigest;
			}
			return fixture.prepareFreshMaterialization(input.signal);
		};
		const common = {
			prepareWarmHost,
			routeQualification,
			credential,
			transport,
			monotonicMeasurement: { readMs: () => (measurement += 1) },
			retryWait: immediateRetryWait,
			executionClass: "simulated-contract" as const,
			privateRoot,
			generationRef: "matched-dry-run-generation",
			signal: new AbortController().signal,
		};
		const result = await runOpenRouterFirstTaskSmoke({
			...common,
			host: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: fixture.materialization,
				verifier: fixture.verifier,
			},
		});

		expect(transportCalls).toBe(8);
		for (const wireBody of wireBodies) {
			const parsedWireBody = JSON.parse(wireBody) as Record<string, unknown>;
			expect(parsedWireBody).toMatchObject({
				model: OPENROUTER_GLM_5_2_REQUEST_MODEL,
				provider: {
					order: [OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_SLUG],
					only: [OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_SLUG],
					allow_fallbacks: false,
					require_parameters: true,
				},
				messages: [{ role: "system" }, { role: "user" }],
				max_tokens: expect.any(Number),
				reasoning: { effort: "high" },
				response_format: {
					type: "json_schema",
					json_schema: { strict: true },
				},
			});
			expect(parsedWireBody).not.toHaveProperty("input");
			expect(parsedWireBody).not.toHaveProperty("instructions");
			expect(parsedWireBody).not.toHaveProperty("parallel_tool_calls");
		}
		expect(result.admissionRejection).toBeNull();
		expect(fixture.verifierCalls.count).toBe(6);
		expect(result.observation).toMatchObject({
			rerunEligible: true,
			familyPassed: false,
			result: {
				classification: "complete",
				verifierStatus: "failed",
				coldRunsAttempted: 1,
				warmRunsAttempted: 5,
				requests: 8,
				steps: 8,
			},
		});
		expect(result.observation.warmBranches.map((branch) => branch.branchKind)).toEqual([
			"relevant-applied",
			"proposal-only",
			"admission-rejected",
			"irrelevant-applied",
			"wrong-scope-applied",
		]);
		expect(result.observation.warmBranches.map((branch) => branch.run?.verifierStatus)).toEqual([
			"passed",
			"failed",
			"failed",
			"failed",
			"failed",
		]);
		expect(result.scorecard).toMatchObject({
			status: "smoke-complete-no-efficacy-claim",
			efficacyClaim: "none",
			eligibleColdFailures: 1,
			warmRunsAttempted: 5,
			warmRunsEvaluable: 5,
			familyPassed: false,
			primaryComparison: {
				relevantAppliedPass: 1,
				proposalOnlyPass: 0,
				riskDifference: 1,
				discordance: "relevant-only",
			},
			secondaryComparisons: [
				{
					controlBranchKind: "admission-rejected",
					relevantAppliedPass: 1,
					controlPass: 0,
					riskDifference: 1,
					discordance: "relevant-only",
				},
				{
					controlBranchKind: "irrelevant-applied",
					relevantAppliedPass: 1,
					controlPass: 0,
					riskDifference: 1,
					discordance: "relevant-only",
				},
				{
					controlBranchKind: "wrong-scope-applied",
					relevantAppliedPass: 1,
					controlPass: 0,
					riskDifference: 1,
					discordance: "relevant-only",
				},
			],
		});
		const relevantLifecycle = result.observation.warmBranches[0]?.lifecycle;
		expect(relevantLifecycle).not.toBeNull();
		if (relevantLifecycle === null || relevantLifecycle === undefined) {
			throw new TypeError("matched dry-run relevant lifecycle is missing");
		}
		const relevantRun = result.observation.warmBranches[0]?.run;
		if (relevantRun === null || relevantRun === undefined) {
			throw new TypeError("matched dry-run relevant run is missing");
		}
		expect(relevantLifecycle.traceMemoryDisposition).toBe("delivered");
		expect(expectedRelevantMemoryDigest).toBe(relevantLifecycle.selectedRecordDigest);
		expect(relevantLifecycle.stagePredicates).toMatchObject({
			warm_decision_trace_includes_memory: false,
			warm_action_trace_bound_to_memory_context: true,
			prior_failure_route_avoided: true,
			warm_run_passed: true,
		});
		expect(result.observation.cold.actionTrace).toHaveLength(1);
		expect(result.observation.warmBranches[0]?.run?.actionTrace).toHaveLength(1);
		expect(
			result.observation.warmBranches
				.slice(1)
				.every(
					(branch) =>
						branch.lifecycle?.stagePredicates.warm_decision_trace_includes_memory === false &&
						branch.lifecycle?.stagePredicates.warm_action_trace_bound_to_memory_context === false &&
						branch.lifecycle?.stagePredicates.prior_failure_route_avoided === false,
				),
		).toBe(true);
		expect(() =>
			validateEmpiricalTrialBlockObservation({
				...result.observation,
				warmBranches: result.observation.warmBranches.map((branch, index) =>
					index === 0
						? {
								...branch,
								lifecycle: {
									...relevantLifecycle,
									caseConforms: true,
								},
							}
						: branch,
				),
			}),
		).toThrow(/caseConforms/);
		const repeatedColdRoute = result.observation.cold.actionTrace.map((entry) => ({
			...entry,
			initialRequestDigest: relevantRun.initialRequestDigest as string,
		}));
		expect(() =>
			validateEmpiricalTrialBlockObservation({
				...result.observation,
				warmBranches: result.observation.warmBranches.map((branch, index) =>
					index === 0
						? {
								...branch,
								run: {
									...relevantRun,
									actionTrace: repeatedColdRoute,
									actionTraceDigest: empiricalStrictJsonDigest(repeatedColdRoute),
									workspaceStateDigest: result.observation.cold.workspaceStateDigest,
									workspaceChangeDigest: result.observation.cold.workspaceChangeDigest,
									workspaceChanged: result.observation.cold.workspaceChanged,
								},
							}
						: branch,
				),
			}),
		).toThrow(/exact request and tool result|bound action trace/);
		const relevantAction = relevantRun.actionTrace[0];
		const relevantBinding = relevantRun.toolResultBindings[0];
		if (relevantAction === undefined || relevantBinding === undefined) {
			throw new TypeError("matched dry-run relevant action binding is missing");
		}
		const duplicatedActionTrace = [relevantAction, { ...relevantAction, actionIndex: 1 }] as const;
		expect(() =>
			validateEmpiricalTrialBlockObservation({
				...result.observation,
				warmBranches: result.observation.warmBranches.map((branch, index) =>
					index === 0
						? {
								...branch,
								run: {
									...relevantRun,
									actionTrace: duplicatedActionTrace,
									actionTraceDigest: empiricalStrictJsonDigest(duplicatedActionTrace),
									toolResultBindings: [relevantBinding, relevantBinding],
								},
							}
						: branch,
				),
			}),
		).toThrow(/unique tool-call digests/);
		const secondTurnRequestDigest = relevantRun.turnRequestDigests[1];
		if (secondTurnRequestDigest === undefined) {
			throw new TypeError("matched dry-run second turn request digest is missing");
		}
		const reversedStepToolCallDigest = empiricalStrictJsonDigest({
			toolCallRef: "reversed-step-tool-call",
		});
		const reversedStepResultDigest = empiricalStrictJsonDigest({
			result: "reversed-step-result",
		});
		const reversedStepActionTrace = [
			{
				...relevantAction,
				stepIndex: 1,
				actionIndex: 0,
				requestDigest: secondTurnRequestDigest,
				toolCallRefDigest: reversedStepToolCallDigest,
				intentDigest: empiricalStrictJsonDigest({ intent: "reversed-step-intent" }),
				resultDigest: reversedStepResultDigest,
			},
			{ ...relevantAction, stepIndex: 0, actionIndex: 1 },
		] as const;
		expect(() =>
			validateEmpiricalTrialBlockObservation({
				...result.observation,
				warmBranches: result.observation.warmBranches.map((branch, index) =>
					index === 0
						? {
								...branch,
								run: {
									...relevantRun,
									actionTrace: reversedStepActionTrace,
									actionTraceDigest: empiricalStrictJsonDigest(reversedStepActionTrace),
									toolResultBindings: [
										{
											toolCallRefDigest: reversedStepToolCallDigest,
											toolRef: relevantAction.toolRef,
											resultDigest: reversedStepResultDigest,
										},
										relevantBinding,
									],
								},
							}
						: branch,
				),
			}),
		).toThrow(/step indexes must be nondecreasing/);
		expect(() =>
			validateEmpiricalTrialBlockObservation({
				...result.observation,
				warmBranches: result.observation.warmBranches.map((branch, index) =>
					index === 0
						? {
								...branch,
								run: {
									...relevantRun,
									turnRequestDigests: relevantRun.turnRequestDigests.map((value, turnIndex) =>
										turnIndex === 0
											? empiricalStrictJsonDigest({ kind: "substituted-initial-turn" })
											: value,
									),
								},
							}
						: branch,
				),
			}),
		).toThrow(/must equal the initial request digest/);
		expect(() =>
			validateEmpiricalTrialBlockObservation({
				...result.observation,
				warmBranches: result.observation.warmBranches.map((branch, index) =>
					index === 0
						? {
								...branch,
								run: {
									...relevantRun,
									workspaceBaselineDigest: empiricalStrictJsonDigest({
										kind: "different-baseline",
									}),
								},
							}
						: branch,
				),
			}),
		).toThrow(/derived from its bound action trace/);
		expect(() =>
			validateEmpiricalCampaignScorecard({
				...result.scorecard,
				secondaryComparisons: result.scorecard.secondaryComparisons.map((comparison, index) =>
					index === 0 ? { ...comparison, riskDifference: 0 } : comparison,
				),
			}),
		).toThrow(/secondaryComparisons\[0\]/);
		expect(actorInputs.map((body) => body.includes('"memoryContext"'))).toEqual([
			false,
			false,
			true,
			true,
			false,
			false,
			false,
			false,
		]);
		expect(actorInputs[2]).toContain("Previous bounded action route");
		expect(actorInputs[2]).toContain(CLOSED_ACTOR_TOOL_REFS.readFile);
		expect(actorInputs[2]).not.toMatch(/managed-compute|tool-provider-run-admission/);
		expect(actorInputs[2]).not.toContain(taskSpecificCorrectionSentinel);
		for (const body of wireBodies) {
			expect(body).not.toContain(credentialSentinel);
			expect(body).not.toMatch(
				/relevant-applied|proposal-only|admission-rejected|irrelevant-applied|wrong-scope-applied/,
			);
		}
		const generationRoot = result.persistence.generationPath;
		const persisted = [
			readFileSync(join(generationRoot, "trial-block-observation.v3.json"), "utf8"),
			readFileSync(join(generationRoot, "campaign-scorecard.v3.json"), "utf8"),
			readFileSync(join(generationRoot, "generation.v3.json"), "utf8"),
		].join("\n");
		expect(persisted).not.toContain(credentialSentinel);
		expect(persisted).toContain('"actionTrace"');
		expect(persisted).not.toContain(fixture.workspaceRoot);
		expect(statSync(join(generationRoot, "trial-block-observation.v3.json")).mode & 0o777).toBe(
			0o600,
		);
		const persistenceProtection = createEmpiricalExactPrivateNeedleProtectionExecutor({
			policyRef: fixture.initialRequest.protectionPolicyRef,
			policyRevision: fixture.initialRequest.protectionPolicyRevision,
			protectedNeedleCapabilityRef: "matched-v2-persistence-sentinel",
			protectedNeedleCapabilityRevision: "matched-v2-persistence-sentinel.v1",
			protectedNeedles: [credentialSentinel],
		});
		await expect(
			persistPrivateSmokeGeneration({
				privateRoot,
				generationRef: historicalGenerationRef,
				observation: result.observation,
				scorecard: result.scorecard,
				protectionExecutor: persistenceProtection,
			}),
		).rejects.toThrow();
		for (const file of historicalV1Files) {
			expect(readFileSync(join(historicalGenerationRoot, file), "utf8")).toBe(
				historicalV1Bytes.get(file),
			);
			expect(statSync(join(historicalGenerationRoot, file)).mode & 0o777).toBe(0o600);
		}
		const adjacentPersistence = await persistPrivateSmokeGeneration({
			privateRoot,
			generationRef: "adjacent-v2-generation",
			observation: result.observation,
			scorecard: result.scorecard,
			protectionExecutor: persistenceProtection,
		});
		expect(adjacentPersistence.generationPath.endsWith("/adjacent-v2-generation")).toBe(true);
		expect(() => readFileSync(join(fixture.workspaceRoot, "README.md"))).toThrow();
		let boundedTransportCalls = 0;
		const boundedTransport: OpenRouterResponsesByteTransportV1 = {
			async request() {
				boundedTransportCalls += 1;
				return dryRunOpenRouterResponse(
					`response.bounded.${boundedTransportCalls}`,
					[
						{
							type: "message",
							role: "assistant",
							status: "completed",
							content: [
								{
									type: "output_text",
									text: JSON.stringify({
										kind: "model-turn-output-placeholder",
										summary: "Bounded control completion without a workspace correction.",
									}),
								},
							],
						},
					],
					undefined,
					{
						requestModel: OPENROUTER_GLM_5_2_REQUEST_MODEL,
						downstreamProviderName: OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME,
					},
				);
			},
		};
		const boundedRoute = simulatedRouteQualification(fixture, {
			maxRequests: 3,
			maxStepsPerRun: 2,
			maxInputTokens: 600_000,
			maxOutputTokens: 49_152,
		});
		const budgetExhausted = await runOpenRouterFirstTaskSmoke({
			...common,
			host: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: await fixture.prepareFreshMaterialization(new AbortController().signal),
				verifier: fixture.verifier,
			},
			routeQualification: boundedRoute,
			transport: boundedTransport,
			generationRef: "matched-budget-exhausted-generation",
		});
		expect(boundedTransportCalls).toBe(3);
		expect(budgetExhausted.observation.result.classification).toBe("incomplete");
		expect(budgetExhausted.observation.issueCodes).toContain(B112_SMOKE_BUDGET_ISSUE_CODE);
		expect(
			budgetExhausted.observation.warmBranches
				.filter((branch) => !branch.attempted)
				.every((branch) => branch.lifecycle === null),
		).toBe(true);
		const preparationFailure = await runOpenRouterFirstTaskSmoke({
			...common,
			host: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: await fixture.prepareFreshMaterialization(new AbortController().signal),
				verifier: fixture.verifier,
			},
			routeQualification,
			transport: boundedTransport,
			prepareWarmHost: async () => {
				throw new TypeError("simulated materialization failure");
			},
			generationRef: "matched-preparation-failure-generation",
		});
		expect(boundedTransportCalls).toBe(4);
		expect(preparationFailure.observation).toMatchObject({
			result: { classification: "incomplete", requests: 1, warmRunsAttempted: 0 },
		});
		expect(preparationFailure.observation.issueCodes).toContain("warm-host-preparation-failed");
	}, 60_000);

	it("persists a sanitized non-evaluable generation after one transport attempt fails", async () => {
		const fixture = await createClosedHostFixture();
		const failureCredentialSentinel = "openrouter-transport-failure-secret-0123456789";
		let transportCalls = 0;
		const privateRoot = join(
			temporaryRoot("transport-failure"),
			".private",
			"empirical-memory-rerun-avoidance",
		);
		mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
		chmodSync(privateRoot, 0o700);
		const result = await runOpenRouterFirstTaskSmoke({
			host: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: fixture.materialization,
				verifier: fixture.verifier,
			},
			routeQualification: liveRouteQualification(fixture),
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: failureCredentialSentinel,
			},
			transport: {
				request() {
					transportCalls += 1;
					return Promise.reject(new Error(`raw ${failureCredentialSentinel}`));
				},
			},
			monotonicMeasurement: { readMs: () => 0 },
			retryWait: immediateRetryWait,
			executionClass: "live-provider",
			privateRoot,
			generationRef: "transport-failure-generation",
			signal: new AbortController().signal,
		});
		expect(transportCalls).toBe(1);
		expect(result.observation).toMatchObject({
			result: { classification: "non-evaluable", requests: 1 },
			routeEvidenceDigests: [],
		});
		expect(result.scorecard.status).toBe("non-evaluable");
		expect(
			readFileSync(
				join(result.persistence.generationPath, "trial-block-observation.v3.json"),
				"utf8",
			),
		).not.toContain(failureCredentialSentinel);
	});

	it("persists only allowlisted rejection diagnostics after one provider response", async () => {
		const fixture = await createClosedHostFixture();
		const rejectionCredentialSentinel = "openrouter-rejection-secret-0123456789";
		const privateRoot = join(
			temporaryRoot("provider-rejection"),
			".private",
			"empirical-memory-rerun-avoidance",
		);
		mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
		chmodSync(privateRoot, 0o700);
		const result = await runOpenRouterFirstTaskSmoke({
			host: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: fixture.materialization,
				verifier: fixture.verifier,
			},
			routeQualification: liveRouteQualification(fixture),
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: rejectionCredentialSentinel,
			},
			transport: {
				request() {
					return Promise.resolve({
						status: 400,
						body: encoder.encode(
							JSON.stringify({
								error: {
									code: "invalid_prompt",
									message: `raw ${rejectionCredentialSentinel}`,
								},
								error_type: rejectionCredentialSentinel,
							}),
						),
						retryAfterMs: null,
					});
				},
			},
			monotonicMeasurement: { readMs: () => 0 },
			retryWait: immediateRetryWait,
			executionClass: "live-provider",
			privateRoot,
			generationRef: "provider-rejection-generation",
			signal: new AbortController().signal,
		});
		expect(result.observation.issueCodes).toEqual([
			"model-turn-non-evaluable",
			"openrouter-error-code:invalid_prompt",
			"openrouter-error-type:unrecognized",
			"openrouter-http-status:400",
			"openrouter-invalid-unsupported-response",
		]);
		expect(result.scorecard.issueCodes).toEqual(result.observation.issueCodes);
		for (const file of readdirSync(result.persistence.generationPath)) {
			expect(readFileSync(join(result.persistence.generationPath, file), "utf8")).not.toContain(
				rejectionCredentialSentinel,
			);
		}
	});

	it("persists a live-approved zero-request budget rejection with conservative cost provenance", async () => {
		const fixture = await createClosedHostFixture();
		let transportCalls = 0;
		const privateRoot = join(
			temporaryRoot("live-pre-admission"),
			".private",
			"empirical-memory-rerun-avoidance",
		);
		mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
		chmodSync(privateRoot, 0o700);
		const result = await runOpenRouterFirstTaskSmoke({
			host: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: fixture.materialization,
				verifier: fixture.verifier,
			},
			routeQualification: liveRouteQualification(fixture, { maxSmokeSpendMicrousd: 1 }),
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: "openrouter-live-pre-admission-secret-0123456789",
			},
			transport: {
				request() {
					transportCalls += 1;
					throw new Error("transport must not run");
				},
			},
			monotonicMeasurement: { readMs: () => 0 },
			retryWait: immediateRetryWait,
			executionClass: "live-provider",
			privateRoot,
			generationRef: "live-pre-admission-generation",
			signal: new AbortController().signal,
		});
		expect(transportCalls).toBe(0);
		expect(result.observation).toMatchObject({
			executionClass: "live-approved-no-provider-evidence",
			empiricalLiveEvidence: false,
			result: {
				classification: "non-evaluable",
				requests: 0,
				costBasis: "conservative-reservation",
				costMicrousd: 0,
			},
		});
		expect(result.observation.issueCodes).toContain(B112_SMOKE_BUDGET_ISSUE_CODE);
		expect(result.persistence.observationDigest).toBe(result.scorecard.observationDigests[0]);
	});

	it("requires the live incremental budget to fit both the total key limit and current remainder", async () => {
		const fixture = await createClosedHostFixture();
		const route = liveRouteQualification(fixture);
		const configuration = fixture.frozen.manifest.modelConfigurations[0];
		if (configuration === undefined) throw new Error("missing fixture model configuration");
		const validate = (candidate: OpenRouterRouteQualificationV1) =>
			validateOpenRouterRouteQualification(
				candidate,
				configuration,
				fixture.frozen.manifest.policies.actorCredentialBindingRef,
				fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				fixture.frozen.manifest.campaignRef,
				fixture.frozen.manifestDigest,
			);
		expect(validate(route).qualification.dispatchMode).toBe("live-approved");
		expect(() =>
			validate({
				...route,
				keySpendLimit: {
					...route.keySpendLimit,
					limitMicrousd: route.budget.maxSmokeSpendMicrousd - 1,
					remainingMicrousd: route.budget.maxSmokeSpendMicrousd - 1,
				},
			}),
		).toThrow(/does not prove the approved smoke budget/);
		expect(() =>
			validate({
				...route,
				keySpendLimit: {
					...route.keySpendLimit,
					remainingMicrousd: route.budget.maxSmokeSpendMicrousd - 1,
				},
			}),
		).toThrow(/does not prove the approved smoke budget/);
	});

	it("preserves one attempted request when the outer deadline aborts in-flight transport", async () => {
		const fixture = await createClosedHostFixture();
		const controller = new AbortController();
		const timeoutCredentialSentinel = "openrouter-timeout-secret-0123456789";
		const privateRoot = join(
			temporaryRoot("transport-timeout"),
			".private",
			"empirical-memory-rerun-avoidance",
		);
		mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
		chmodSync(privateRoot, 0o700);
		const result = await runOpenRouterFirstTaskSmoke({
			host: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: fixture.materialization,
				verifier: fixture.verifier,
			},
			routeQualification: liveRouteQualification(fixture),
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: timeoutCredentialSentinel,
			},
			transport: {
				request() {
					controller.abort();
					return Promise.reject(new DOMException("raw provider timeout", "AbortError"));
				},
			},
			monotonicMeasurement: { readMs: () => 0 },
			retryWait: immediateRetryWait,
			executionClass: "live-provider",
			privateRoot,
			generationRef: "transport-timeout-generation",
			signal: controller.signal,
		});
		expect(result.observation).toMatchObject({
			result: { classification: "non-evaluable", requests: 1, steps: 1 },
			routeEvidenceDigests: [],
		});
		expect(result.observation.issueCodes).toContain(
			OPENROUTER_RESPONSES_ISSUE_CODES.unavailableTransport,
		);
		expect(
			readFileSync(
				join(result.persistence.generationPath, "trial-block-observation.v3.json"),
				"utf8",
			),
		).not.toContain(timeoutCredentialSentinel);
	});

	it("persists known provider usage when a completed attempt exceeds the frozen budget", async () => {
		const fixture = await createClosedHostFixture();
		const privateRoot = join(
			temporaryRoot("known-overrun"),
			".private",
			"empirical-memory-rerun-avoidance",
		);
		mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
		chmodSync(privateRoot, 0o700);
		const result = await runOpenRouterFirstTaskSmoke({
			host: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: fixture.materialization,
				verifier: fixture.verifier,
			},
			routeQualification: liveRouteQualification(fixture),
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: "openrouter-known-overrun-secret-0123456789",
			},
			transport: {
				request(input) {
					const requestBody = JSON.parse(new TextDecoder().decode(input.body)) as {
						readonly tools: readonly { readonly name: string }[];
					};
					return Promise.resolve(
						dryRunOpenRouterResponse(
							"response.known-overrun",
							[
								{
									type: "function_call",
									status: "completed",
									call_id: "call.known-overrun",
									name: requestBody.tools[0]?.name,
									arguments: JSON.stringify({ path: "README.md" }),
								},
							],
							{
								input_tokens: 100_001,
								output_tokens: 20,
								total_tokens: 100_021,
								cost: 0.625_606_25,
							},
						),
					);
				},
			},
			monotonicMeasurement: { readMs: () => 0 },
			retryWait: immediateRetryWait,
			executionClass: "live-provider",
			privateRoot,
			generationRef: "known-overrun-generation",
			signal: new AbortController().signal,
		});
		expect(result.observation).toMatchObject({
			result: {
				classification: "non-evaluable",
				requests: 1,
				inputTokens: 100_001,
				outputTokens: 20,
				costMicrousd: 625_607,
				costBasis: "provider-usage",
			},
		});
		expect(result.observation.issueCodes).toContain(B112_SMOKE_BUDGET_ISSUE_CODE);
		expect(result.observation.routeEvidenceDigests).toHaveLength(1);
		expect(result.scorecard.status).toBe("non-evaluable");
	});

	it("retains known provider cost when a later attempted turn has unknown usage", async () => {
		const fixture = await createClosedHostFixture();
		const artifactRoot = temporaryRoot("mixed-known-unknown-cost");
		const privateRoot = join(artifactRoot, ".private", "empirical-memory-rerun-avoidance");
		mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
		chmodSync(privateRoot, 0o700);
		let transportCalls = 0;
		const result = await runOpenRouterFirstTaskSmoke({
			host: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: fixture.materialization,
				verifier: fixture.verifier,
			},
			routeQualification: liveRouteQualification(fixture),
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: "openrouter-mixed-cost-secret-0123456789",
			},
			transport: {
				request(input) {
					transportCalls += 1;
					const requestBody = JSON.parse(new TextDecoder().decode(input.body)) as {
						readonly tools: readonly { readonly name: string }[];
					};
					if (transportCalls === 1) {
						return Promise.resolve(
							dryRunOpenRouterResponse(
								"response.mixed-cost.1",
								[
									{
										type: "function_call",
										status: "completed",
										call_id: "call.mixed-cost.1",
										name: requestBody.tools[0]?.name,
										arguments: JSON.stringify({ path: "README.md" }),
									},
								],
								{
									input_tokens: 100,
									output_tokens: 20,
									total_tokens: 120,
									cost: 0.1,
								},
							),
						);
					}
					return Promise.resolve(
						dryRunOpenRouterResponse(
							"response.mixed-cost.2",
							[
								{
									type: "message",
									role: "assistant",
									status: "completed",
									content: [
										{
											type: "output_text",
											text: JSON.stringify({
												kind: "model-turn-output-placeholder",
												summary: "bounded-placeholder",
											}),
										},
									],
								},
							],
							{ input_tokens: 100, output_tokens: 20, total_tokens: 120 },
						),
					);
				},
			},
			monotonicMeasurement: { readMs: () => 0 },
			retryWait: immediateRetryWait,
			executionClass: "live-provider",
			privateRoot,
			generationRef: "mixed-known-unknown-cost-generation",
			signal: new AbortController().signal,
		});
		expect(transportCalls).toBe(2);
		expect(result.observation.result).toMatchObject({
			classification: "non-evaluable",
			requests: 2,
			inputTokens: null,
			outputTokens: null,
			costBasis: "conservative-reservation",
		});
		const pricing = {
			currency: "USD" as const,
			inputMicrousdPerMillionTokens: result.observation.route.inputMicrousdPerMillionTokens,
			outputMicrousdPerMillionTokens: result.observation.route.outputMicrousdPerMillionTokens,
			pricingRevision: result.observation.route.pricingRevision,
			sourceUrl: result.observation.route.pricingSourceUrl,
		};
		const fullReservationCost = calculateOpenRouterCostMicrousd(
			result.observation.result.reservedInputTokens,
			result.observation.result.reservedOutputTokens,
			pricing,
		);
		const pendingSecondTurnCost = calculateOpenRouterCostMicrousd(
			result.observation.result.reservedInputTokens - 100,
			result.observation.result.reservedOutputTokens - 20,
			pricing,
		);
		const expectedHybridCost = 100_000 + pendingSecondTurnCost;
		expect(expectedHybridCost).toBeGreaterThan(fullReservationCost);
		expect(result.observation.result.costMicrousd).toBe(expectedHybridCost);
		expect(result.persistence.observationDigest).toBe(result.scorecard.observationDigests[0]);
		const persistedObservation = JSON.parse(
			readFileSync(
				join(result.persistence.generationPath, "trial-block-observation.v3.json"),
				"utf8",
			),
		) as { readonly result: { readonly costBasis: string; readonly costMicrousd: number } };
		expect(persistedObservation.result).toMatchObject({
			costBasis: "conservative-reservation",
			costMicrousd: expectedHybridCost,
		});
	});

	it("stops a simulated bad loop at request/step bounds and fails closed before a cost-overrun request", async () => {
		const runBoundedCase = async (
			label: string,
			budgetOverrides: Readonly<Record<string, number>>,
			expectedTransportCalls: number,
			expectedIssueCode = "smoke-budget-exhausted",
		) => {
			const fixture = await createClosedHostFixture();
			let transportCalls = 0;
			const transport: OpenRouterResponsesByteTransportV1 = {
				async request(input) {
					transportCalls += 1;
					const requestBody = JSON.parse(new TextDecoder().decode(input.body)) as {
						readonly tools: readonly { readonly name: string }[];
					};
					return dryRunOpenRouterResponse(`response.${label}.${transportCalls}`, [
						{
							type: "function_call",
							status: "completed",
							call_id: `call.${label}.${transportCalls}`,
							name: requestBody.tools[0]?.name,
							arguments: JSON.stringify({ path: "README.md" }),
						},
					]);
				},
			};
			const artifactRoot = temporaryRoot(`bounded-${label}`);
			const privateRoot = join(artifactRoot, ".private", "empirical-memory-rerun-avoidance");
			mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
			chmodSync(privateRoot, 0o700);
			let measurement = 0;
			const result = await runOpenRouterFirstTaskSmoke({
				host: {
					frozen: fixture.frozen,
					qualificationReport: fixture.report,
					initialRequest: fixture.initialRequest,
					taskProfile: fixture.taskProfile,
					materialization: fixture.materialization,
					verifier: fixture.verifier,
				},
				routeQualification: simulatedRouteQualification(fixture, budgetOverrides),
				credential: {
					credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
					credentialBindingRevision:
						fixture.frozen.manifest.policies.actorCredentialBindingRevision,
					bearerToken: "openrouter-bounded-secret-sentinel-0123456789",
				},
				transport,
				monotonicMeasurement: { readMs: () => (measurement += 1) },
				retryWait: immediateRetryWait,
				executionClass: "simulated-contract",
				privateRoot,
				generationRef: `bounded-${label}`,
				signal: new AbortController().signal,
			});
			expect(transportCalls).toBe(expectedTransportCalls);
			expect(result.observation.result.classification).toBe("non-evaluable");
			expect(result.observation.issueCodes).toContain(expectedIssueCode);
			expect(result.scorecard.status).toBe("non-evaluable");
			expect(result.scorecard.empiricalLiveEvidence).toBe(false);
			return result;
		};

		const loopBound = await runBoundedCase(
			"request-step",
			{ maxRequests: 2 },
			2,
			OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
		);
		expect(loopBound.observation.result).toMatchObject({ requests: 2, steps: 2 });
		expect(loopBound.admissionRejection).toBeNull();

		const stepBound = await runBoundedCase(
			"step",
			{},
			8,
			OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
		);
		expect(stepBound.observation.result).toMatchObject({ requests: 8, steps: 8 });
		expect(stepBound.admissionRejection).toBeNull();

		const settledReservation = await runBoundedCase(
			"settled-reservation",
			{ maxInputTokens: 10_000 },
			8,
			OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
		);
		expect(settledReservation.observation.result).toMatchObject({
			inputTokens: 800,
			outputTokens: 160,
			requests: 8,
			steps: 8,
		});

		const costBound = await runBoundedCase("cost", { maxSmokeSpendMicrousd: 1 }, 0);
		expect(costBound.observation.result).toMatchObject({ requests: 0, steps: 1 });
		expect(costBound.admissionRejection).toMatchObject({
			reasons: ["cost-reservation"],
			requests: 0,
			reservedCostMicrousd: 0,
			maxSmokeSpendMicrousd: 1,
		});
		expect(costBound.admissionRejection?.prospectiveCostMicrousd).toBeGreaterThan(1);
		expect(JSON.stringify(costBound.observation)).not.toContain(
			"b112-smoke-admission-rejection.v1",
		);
		expect(JSON.stringify(costBound.scorecard)).not.toContain("b112-smoke-admission-rejection.v1");
		for (const artifactName of [
			"trial-block-observation.v3.json",
			"campaign-scorecard.v3.json",
			"generation.v3.json",
		]) {
			expect(
				readFileSync(join(costBound.persistence.generationPath, artifactName), "utf8"),
			).not.toContain("b112-smoke-admission-rejection.v1");
		}

		const byteBound = await runBoundedCase(
			"canonical-request-bytes",
			{ maxCanonicalRequestBytes: 1 },
			0,
		);
		expect(byteBound.admissionRejection?.reasons).toContain("canonical-request-bytes");
		expect(byteBound.admissionRejection?.wireRequestBytes).toBeGreaterThan(1);
	}, 15_000);

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

	it("retries one exact 429 turn after the bounded server floor and persists distinct attempt evidence", async () => {
		const fixture = await createClosedHostFixture();
		const credentialSentinel = "openrouter-retry-secret-sentinel-0123456789";
		const rawProviderSentinel = "raw-openrouter-retry-provider-sentinel";
		const baseContentDigest = empiricalSha256(encoder.encode("broken-placeholder-value\n"));
		const requestBodies: Uint8Array[] = [];
		const waits: number[] = [];
		let transportCalls = 0;
		let activeCalls = 0;
		let maximumActiveCalls = 0;
		const transport: OpenRouterResponsesByteTransportV1 = {
			async request(input) {
				transportCalls += 1;
				activeCalls += 1;
				maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
				requestBodies.push(input.body.slice());
				try {
					if (transportCalls === 1) {
						return {
							status: 429,
							body: encoder.encode(
								JSON.stringify({
									error: {
										code: "rate_limit_exceeded",
										message: rawProviderSentinel,
										metadata: { error_type: "rate_limit_exceeded" },
									},
								}),
							),
							retryAfterMs: 7_000,
						};
					}
					const requestBody = JSON.parse(new TextDecoder().decode(input.body)) as {
						readonly tools: readonly { readonly name: string }[];
					};
					return dryRunOpenRouterResponse(
						`response.retry.${transportCalls}`,
						transportCalls === 2
							? [
									{
										type: "function_call",
										status: "completed",
										call_id: "call.retry.replace-exact",
										name: requestBody.tools[2]?.name,
										arguments: JSON.stringify({
											baseContentDigest,
											newText: "fixed",
											oldText: "broken-placeholder-value",
											path: "README.md",
										}),
									},
								]
							: [
									{
										type: "message",
										role: "assistant",
										status: "completed",
										content: [
											{
												type: "output_text",
												text: JSON.stringify({
													kind: "model-turn-output-placeholder",
													summary: "bounded-placeholder",
												}),
											},
										],
									},
								],
					);
				} finally {
					activeCalls -= 1;
				}
			},
		};
		const artifactRoot = temporaryRoot("retry-private-artifacts");
		const privateRoot = join(artifactRoot, ".private", "empirical-memory-rerun-avoidance");
		mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
		chmodSync(privateRoot, 0o700);
		let measurement = 0;

		const result = await runOpenRouterFirstTaskSmoke({
			host: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: fixture.materialization,
				verifier: fixture.verifier,
			},
			routeQualification: simulatedRouteQualification(fixture),
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: credentialSentinel,
			},
			transport,
			monotonicMeasurement: { readMs: () => measurement },
			retryWait: {
				async wait(input) {
					expect(input.signal.aborted).toBe(false);
					waits.push(input.delayMs);
					measurement += input.delayMs;
				},
			},
			executionClass: "simulated-contract",
			privateRoot,
			generationRef: "retry-dry-run-generation",
			signal: new AbortController().signal,
		});

		expect(transportCalls).toBe(3);
		expect(maximumActiveCalls).toBe(1);
		expect(waits).toEqual([7_000]);
		expect(requestBodies[0]).toEqual(requestBodies[1]);
		expect(result.observation.cold).toMatchObject({
			classification: "complete",
			requests: 3,
			steps: 2,
			attempts: 3,
			retryWaitMs: 7_000,
		});
		expect(
			result.observation.cold.attemptTrace.map((attempt) => [
				attempt.stepIndex,
				attempt.attemptOrdinal,
				attempt.requests,
			]),
		).toEqual([
			[0, 1, 1],
			[0, 2, 1],
			[1, 1, 1],
		]);
		expect(result.observation.cold.retryWaitTrace).toEqual([
			{
				stepIndex: 0,
				afterAttemptOrdinal: 1,
				scheduledDelayMs: 7_000,
				elapsedMs: 7_000,
			},
		]);
		const [retryAttemptOne, retryAttemptTwo, nextStepAttempt] =
			result.observation.cold.attemptTrace;
		if (
			retryAttemptOne === undefined ||
			retryAttemptTwo === undefined ||
			nextStepAttempt === undefined
		) {
			throw new TypeError("retry dry run did not produce the exact three-attempt fixture");
		}
		for (const invalidCold of [
			{
				...result.observation.cold,
				attemptTrace: [retryAttemptTwo, retryAttemptOne, nextStepAttempt],
			},
			{
				...result.observation.cold,
				retryWaitTrace: [],
			},
			{
				...result.observation.cold,
				retryWaitTrace: [
					...result.observation.cold.retryWaitTrace,
					...result.observation.cold.retryWaitTrace,
				],
			},
			{
				...result.observation.cold,
				protectionReceiptDigests: [
					...result.observation.cold.protectionReceiptDigests,
					empiricalStrictJsonDigest({ extra: "receipt" }),
				].sort(),
			},
		]) {
			expect(() =>
				validateEmpiricalTrialBlockObservation({
					...result.observation,
					cold: invalidCold,
				}),
			).toThrow();
		}
		expect(result.scorecard).toMatchObject({
			status: "smoke-complete-no-efficacy-claim",
			requests: 3,
			steps: 2,
			attempts: 3,
			efficacyClaim: "none",
		});
		const persisted = [
			"trial-block-observation.v3.json",
			"campaign-scorecard.v3.json",
			"generation.v3.json",
		]
			.map((file) => readFileSync(join(result.persistence.generationPath, file), "utf8"))
			.join("\n");
		expect(persisted).not.toContain(credentialSentinel);
		expect(persisted).not.toContain(rawProviderSentinel);
	});

	it("bounds 503 fallback, never retries 409, and re-admits every retry against request budget", async () => {
		const runFailureCase = async (input: {
			readonly label: string;
			readonly status: 409 | 429 | 503;
			readonly errorType: "rate_limit_exceeded" | "provider_overloaded";
			readonly maxRequests?: number;
			readonly maxLatencyMs?: number;
			readonly abortWait?: boolean;
			readonly earlyReturnWait?: boolean;
		}) => {
			const fixture = await createClosedHostFixture();
			const waits: number[] = [];
			const requestBodies: Uint8Array[] = [];
			let transportCalls = 0;
			const route = simulatedRouteQualification(fixture);
			const routeQualification = strictSnapshot({
				...route,
				budget: {
					...route.budget,
					...(input.maxRequests === undefined ? {} : { maxRequests: input.maxRequests }),
					...(input.maxLatencyMs === undefined ? {} : { maxLatencyMs: input.maxLatencyMs }),
				},
			});
			const artifactRoot = temporaryRoot(`retry-${input.label}`);
			const privateRoot = join(artifactRoot, ".private", "empirical-memory-rerun-avoidance");
			mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
			chmodSync(privateRoot, 0o700);
			let measurement = 0;
			const controller = new AbortController();
			const result = await runOpenRouterFirstTaskSmoke({
				host: {
					frozen: fixture.frozen,
					qualificationReport: fixture.report,
					initialRequest: fixture.initialRequest,
					taskProfile: fixture.taskProfile,
					materialization: fixture.materialization,
					verifier: fixture.verifier,
				},
				routeQualification,
				credential: {
					credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
					credentialBindingRevision:
						fixture.frozen.manifest.policies.actorCredentialBindingRevision,
					bearerToken: `openrouter-${input.label}-secret-sentinel-0123456789`,
				},
				transport: {
					async request(request) {
						transportCalls += 1;
						requestBodies.push(request.body.slice());
						return {
							status: input.status,
							body: encoder.encode(
								JSON.stringify({
									error: {
										code:
											input.errorType === "rate_limit_exceeded"
												? "rate_limit_exceeded"
												: "server_error",
										message: `raw-${input.label}-provider-sentinel`,
										metadata: { error_type: input.errorType },
									},
								}),
							),
							retryAfterMs: null,
						};
					},
				},
				monotonicMeasurement: { readMs: () => measurement },
				retryWait: {
					async wait(waitInput) {
						waits.push(waitInput.delayMs);
						if (input.abortWait) {
							controller.abort();
							throw new DOMException("test retry wait cancellation", "AbortError");
						}
						if (!input.earlyReturnWait) measurement += waitInput.delayMs;
					},
				},
				executionClass: "simulated-contract",
				privateRoot,
				generationRef: `retry-${input.label}-generation`,
				signal: controller.signal,
			});
			return { result, waits, requestBodies, transportCalls };
		};

		const exhausted = await runFailureCase({
			label: "503-exhausted",
			status: 503,
			errorType: "provider_overloaded",
		});
		expect(exhausted.transportCalls).toBe(3);
		expect(exhausted.waits).toEqual([5_000, 10_000]);
		expect(exhausted.requestBodies[0]).toEqual(exhausted.requestBodies[1]);
		expect(exhausted.requestBodies[1]).toEqual(exhausted.requestBodies[2]);
		expect(exhausted.result.observation.cold).toMatchObject({
			classification: "non-evaluable",
			requests: 3,
			steps: 1,
			attempts: 3,
			retryWaitMs: 15_000,
		});
		expect(exhausted.result.observation.issueCodes).toContain("model-turn-retry-exhausted");

		const no409Retry = await runFailureCase({
			label: "409-no-retry",
			status: 409,
			errorType: "rate_limit_exceeded",
		});
		expect(no409Retry.transportCalls).toBe(1);
		expect(no409Retry.waits).toEqual([]);
		expect(no409Retry.result.observation.cold).toMatchObject({
			requests: 1,
			steps: 1,
			attempts: 1,
			retryWaitMs: 0,
		});

		const requestBound = await runFailureCase({
			label: "429-request-bound",
			status: 429,
			errorType: "rate_limit_exceeded",
			maxRequests: 1,
		});
		expect(requestBound.transportCalls).toBe(1);
		expect(requestBound.waits).toEqual([]);
		expect(requestBound.result.observation.cold).toMatchObject({
			requests: 1,
			steps: 1,
			attempts: 1,
		});
		expect(requestBound.result.admissionRejection?.reasons).toContain("request-limit");
		expect(requestBound.result.observation.issueCodes).toContain(B112_SMOKE_BUDGET_ISSUE_CODE);

		const serverFloorBound = await runFailureCase({
			label: "503-server-floor-bound",
			status: 503,
			errorType: "provider_overloaded",
			maxLatencyMs: 4_999,
		});
		expect(serverFloorBound.transportCalls).toBe(1);
		expect(serverFloorBound.waits).toEqual([]);
		expect(serverFloorBound.result.observation.issueCodes).toContain(
			"model-turn-retry-elapsed-budget-exhausted",
		);

		const elapsedBound = await runFailureCase({
			label: "503-elapsed-bound",
			status: 503,
			errorType: "provider_overloaded",
			maxLatencyMs: 5_000,
		});
		expect(elapsedBound.transportCalls).toBe(1);
		expect(elapsedBound.waits).toEqual([5_000]);
		expect(elapsedBound.result.observation.cold).toMatchObject({
			requests: 1,
			steps: 1,
			attempts: 1,
			retryWaitMs: 5_000,
		});
		expect(elapsedBound.result.observation.issueCodes).toContain(
			"model-turn-retry-elapsed-budget-exhausted",
		);

		const earlyWait = await runFailureCase({
			label: "503-early-wait",
			status: 503,
			errorType: "provider_overloaded",
			earlyReturnWait: true,
		});
		expect(earlyWait.transportCalls).toBe(1);
		expect(earlyWait.waits).toEqual([5_000]);
		expect(earlyWait.result.observation.issueCodes).toContain("model-turn-retry-wait-failed");

		const aborted = await runFailureCase({
			label: "429-aborted-wait",
			status: 429,
			errorType: "rate_limit_exceeded",
			abortWait: true,
		});
		expect(aborted.transportCalls).toBe(1);
		expect(aborted.waits).toEqual([5_000]);
		expect(aborted.result.observation.cold).toMatchObject({
			requests: 1,
			steps: 1,
			attempts: 1,
			retryWaitMs: 0,
		});
		expect(aborted.result.observation.issueCodes).toContain("host-cancelled");
	}, 15_000);

	it("retains every validated retry attempt when cumulative host output bytes exhaust", async () => {
		const fixture = await createClosedHostFixture();
		const initialRequest = {
			...fixture.initialRequest,
			remainingTurnBudget: {
				...fixture.initialRequest.remainingTurnBudget,
				maxOutputBytes: 4_096,
			},
		};
		let invocations = 0;
		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: {
				async invoke(request) {
					invocations += 1;
					return invocations === 1
						? nonEvaluableOutcome(
								request,
								fixture.frozen,
								fixture.report,
								fixture.protectionExecutor,
								["openrouter-error-type:provider_overloaded", "openrouter-http-status:503"],
								2_500,
							)
						: completedOutcome(
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
				},
			},
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			retry: {
				maxAttemptsPerTurn: 3,
				retryDelayMs: () => 1,
				retryAdmissionIssueCodes: () => [],
				remainingElapsedMs: () => 10_000,
				wait: async () => 1,
			},
			signal: new AbortController().signal,
		});

		expect(outcome.issueCodes).toEqual(["agent-output-byte-budget-exhausted"]);
		expect(outcome.logicalStepCount).toBe(1);
		expect(outcome.attemptCount).toBe(2);
		expect(outcome.turnEvidence).toHaveLength(2);
		expect(outcome.remoteRequests).toBe(2);
		expect(outcome.hostOutputBytes).toBe(4_548);
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
		expect(outcome.logicalStepCount).toBe(1);
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
		expect(outcome.logicalStepCount).toBe(1);
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
		expect(outcome.logicalStepCount).toBe(1);
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
		expect(outcome.logicalStepCount).toBe(2);
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
		expect(outcome.logicalStepCount).toBe(0);
		expect(outcome.attemptCount).toBe(0);
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
		expect(outcome.logicalStepCount).toBe(0);
		expect(outcome.attemptCount).toBe(0);
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
