import { execFileSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
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
	type ClosedContinuationModelTurnPortV1,
	type ClosedHostContinuationV1,
	type ClosedMutationFirstContinuationModelTurnPortV1,
	type ClosedMutationFirstContinuationV1,
	type ClosedNoProgressContinuationPolicyV1,
	type ClosedNoProgressReceiptV1,
	type ClosedTaskExecutionProfileV1,
	type ClosedTaskProfileHostActionReceiptV1,
	type ClosedTaskProfileHostRunInputV1,
	type ClosedVerifierCapabilityV1,
	type ClosedVerifierProfileV1,
	type ClosedVerifierRunCoordinatesV1,
	type ClosedWorkspaceRecipeV1,
	D682_HOST_DERIVED_REPLACE_SCHEMA_REVISION,
	runClosedTaskProfileHost,
	sameClosedInspectionBatch,
	sameClosedMutationFirstState,
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
	createD682MechanicalActorInput,
	createD682MechanicalQualificationScorecard,
	D682_MECHANICAL_QUALIFICATION_CATALOG_SCHEMA,
	D682_MECHANICAL_QUALIFICATION_MAX_COST_MICROUSD,
	type D682MechanicalQualificationCatalogV1,
	validateD682MechanicalQualificationCatalog,
} from "../../evals/empirical-memory-rerun-avoidance/d682-mechanical-qualification.js";
import {
	createD690HistoricalTransferMemory,
	D690_CLAIM_BOUNDARY,
	D690_FAILURE_MECHANISM_REF,
	D690_HISTORICAL_PAIR_EVIDENCE_VERSION,
	D690_SOURCE,
	D690_TARGET_TASK_REF,
} from "../../evals/empirical-memory-rerun-avoidance/d690-historical-pair-qualification.js";
import {
	createD691Scorecard,
	D691_BUDGET,
	D691_PRIVATE_PERSISTENCE_ROOT,
	persistD691PrivateGeneration,
	runD691HistoricalTransferBlock,
} from "../../evals/empirical-memory-rerun-avoidance/d691-historical-transfer-live.js";
import {
	createD693AssistedProgressQualification,
	D693_ASSISTED_PROGRESS_POLICY,
	D693_CASE_ORDER,
	persistD693AssistedProgressQualification,
	runD693AssistedProgressCase,
	validateD693AssistedProgressQualification,
} from "../../evals/empirical-memory-rerun-avoidance/d693-assisted-progress-qualification.js";
import {
	commitD695PrivateGenerationAtomically,
	createD695OfflineQualification,
	D695_CASE_ORDER,
	D695_NO_PROGRESS_CONTINUATION_POLICY,
	persistD695OfflineQualification,
	runD695OfflineCase,
	validateD695OfflineQualification,
} from "../../evals/empirical-memory-rerun-avoidance/d695-no-progress-continuation-qualification.js";
import {
	createD702OfflineQualification,
	D702_CASE_ORDER,
	D702_STALE_RESULT_RECOVERY_POLICY,
	type D702CaseReportV1,
	persistD702OfflineQualification,
	runD702OfflineCase,
	validateD702OfflineQualification,
} from "../../evals/empirical-memory-rerun-avoidance/d702-mutation-first-recovery-qualification.js";
import {
	D710_UNTYPED_HTTP_429_RETRY_POLICY,
	d710UntypedHttp429RetryDelayMs,
	validateD710UntypedHttp429RetryPolicy,
} from "../../evals/empirical-memory-rerun-avoidance/d710-untyped-http-429-retry-policy.js";
import { D714_D713_SOURCE_OBSERVATION_DIGEST } from "../../evals/empirical-memory-rerun-avoidance/d714-d715-graph-native-qualification.js";
import {
	createD716GraphNativeSixArmCoordinator,
	D716_GRAPH_NATIVE_ARM_ORDER,
	D716_GRAPH_NATIVE_COORDINATOR_REVISION,
	D716_REQUIRED_D714_D715_QUALIFICATION_DIGEST,
	takeNextD716GraphNativeArmRequest,
} from "../../evals/empirical-memory-rerun-avoidance/d716-graph-native-live-coordinator.js";
import {
	createD716GraphNativeLiveQualification,
	createD716GraphNativeLiveScorecard,
	persistD716GraphNativePrivateGeneration,
} from "../../evals/empirical-memory-rerun-avoidance/d716-graph-native-live-qualification.js";
import {
	createD717InjectedHistoricalBaselineReceipt,
	persistD717GraphNativePrivateGeneration,
	runD717GraphNativePreLiveBlock,
} from "../../evals/empirical-memory-rerun-avoidance/d717-graph-native-prelive.js";
import {
	beginD719GraphNativeBudgetArm,
	createD719GraphNativeEvalAuthority,
	D719_GRAPH_NATIVE_EVAL_AUTHORITY_REVISION,
	decideD719GraphNativeBudget,
	snapshotD719GraphNativeBudgetEvidence,
	validateD719GraphNativeBudgetEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/d719-graph-native-eval-authority.js";
import {
	createDeveloperGuidanceObservation,
	developerGuidanceActionProgressEvidenceDigest,
	developerGuidanceCoordinateEvidenceDigest,
} from "../../evals/empirical-memory-rerun-avoidance/developer-guidance-utility.js";
import {
	B112_EXHAUSTIVE_TASK_CLUSTER_INTERVAL_REVISION,
	createB112CalibrationTrialBlockIdentity,
	validateB112CalibrationEmpiricalBlockResult,
} from "../../evals/empirical-memory-rerun-avoidance/empirical-calibration.js";
import {
	B112_CALIBRATION_EXPLORATORY_NO_EFFICACY_CLAIM,
	createEmpiricalCampaignScorecard,
	EMPIRICAL_CALIBRATION_TRIAL_BLOCK_OBSERVATION_SCHEMA,
	validateEmpiricalAggregateEvidenceDigestList,
	validateEmpiricalCalibrationTrialBlockObservation,
	validateEmpiricalCampaignScorecard,
	validateEmpiricalTrialBlockObservation,
} from "../../evals/empirical-memory-rerun-avoidance/empirical-smoke-evidence.js";
import {
	createEmpiricalExactPrivateNeedleProtectionExecutor,
	type EmpiricalExactPrivateNeedleProtectionExecutorV1,
} from "../../evals/empirical-memory-rerun-avoidance/exact-private-needle-protection.js";
import {
	createD682EffectRunCompletionAdmission,
	createD682ExecutionQualifiedMechanicalRecipe,
	createD682SerialEffectPlanProposal,
	type D682EffectRunCompletionV1,
} from "../../evals/empirical-memory-rerun-avoidance/execution-qualified-mechanical-recipe.js";
import { prepareB112MatchedBlockReflection } from "../../evals/empirical-memory-rerun-avoidance/matched-block-memory.js";
import {
	EMPIRICAL_MODEL_EXECUTION_SCHEMAS,
	type EmpiricalModelToolIntentV1,
	type EmpiricalModelTurnOutcomeV1,
	type EmpiricalModelTurnPortV1,
	type EmpiricalModelTurnRequestV1,
	executeEmpiricalProtection,
	validateEmpiricalModelTurnOutcome,
	validateEmpiricalModelTurnRequest,
} from "../../evals/empirical-memory-rerun-avoidance/model-execution.js";
import {
	B112_D678_AGENT_MAX_STEPS,
	B112_D678_BLOCK_MAX_COST_MICROUSD,
	B112_D678_BLOCK_MAX_INPUT_TOKENS,
	B112_D678_BLOCK_MAX_LATENCY_MS,
	B112_D678_BLOCK_MAX_OUTPUT_TOKENS,
	B112_D678_BLOCK_MAX_REQUESTS,
	B112_D678_CAMPAIGN_MAX_COST_MICROUSD,
	B112_D678_CAMPAIGN_MAX_ELAPSED_MS,
	B112_D678_CAMPAIGN_MAX_REQUESTS,
	B112_D678_MAX_CANONICAL_REQUEST_BYTES,
	B112_D678_TASK_MAX_REQUESTS,
	B112_D679_TASK_MAX_COST_MICROUSD,
	classifyOpenRouterCalibrationOperatorFailure,
	runLoadedOpenRouterCalibrationOperator,
	validateD678CalibrationRouteQualifications,
	validateOpenRouterCalibrationFreshRouteQualification,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-calibration-operator.js";
import {
	createOpenRouterCurrentKeySpendAdmissionCapability,
	OPENROUTER_CURRENT_KEY_ENDPOINT,
	OPENROUTER_CURRENT_KEY_SPEND_ADMISSION_SCHEMA,
	type OpenRouterCurrentKeySpendAdmissionCapabilityV1,
	type OpenRouterCurrentKeySpendAdmissionRequestV1,
	type OpenRouterCurrentKeySpendAdmissionV1,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-current-key-spend-admission.js";
import {
	d682MechanicalRouteProfileDigest,
	runLoadedOpenRouterD682MechanicalQualificationOperator,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-d682-mechanical-qualification-operator.js";
import { runLoadedOpenRouterDeveloperGuidanceCalibration } from "../../evals/empirical-memory-rerun-avoidance/openrouter-developer-guidance-calibration-operator.js";
import {
	B112_FIRST_TASK_SMOKE_AGGREGATION_REVISION,
	B112_SMOKE_BUDGET_ISSUE_CODE,
	canonicalMatchedWarmBranchIssueCodes,
	createOpenRouterCalibrationEmpiricalRunner,
	type OpenRouterFirstTaskRetryWaitCapabilityV1,
	runOpenRouterFirstTaskSmoke,
	runOpenRouterMatchedTrialBlock,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-first-task-smoke.js";
import {
	createOpenRouterResponsesEmpiricalBinding,
	OPENROUTER_CHAT_COMPLETIONS_ADAPTER_REVISION,
	OPENROUTER_CHAT_COMPLETIONS_BINDING_REVISION,
	OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
	OPENROUTER_CHAT_COMPLETIONS_ENDPOINT_REVISION,
	OPENROUTER_CHAT_COMPLETIONS_PROMPT_REVISION,
	OPENROUTER_CHAT_COMPLETIONS_SYSTEM_PROMPT_REVISION,
	OPENROUTER_DEEPSEEK_CHAT_COMPLETIONS_SYSTEM_PROMPT_REVISION,
	OPENROUTER_RESPONSE_DIAGNOSTIC_CODES,
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
	OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
	OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
	OPENROUTER_DEEPSEEK_V4_FLASH_SELECTED_MODEL,
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
import { createOpenRouterTransportFailure } from "../../evals/empirical-memory-rerun-avoidance/openrouter-transport-failure.js";
import {
	persistPrivateDeveloperGuidanceCalibrationGeneration,
	persistPrivateSmokeGeneration,
} from "../../evals/empirical-memory-rerun-avoidance/private-smoke-persistence.js";
import {
	createEmpiricalTaskQualificationReport,
	freezeEmpiricalCampaignManifest,
} from "../../evals/empirical-memory-rerun-avoidance/qualification.js";
import {
	createLocalSingleBaselineWorkspaceAllocator,
	type ExactLocalSourceRepositoryCapabilityV1,
	type HistoryFreeSingleBaselineRepositoryMaterializationV1,
	materializeHistoryFreeSingleBaselineRepository,
} from "../../evals/empirical-memory-rerun-avoidance/single-baseline-repository-node.js";
import { graph } from "../graph/graph.js";
import { strictJsonCodec } from "../json/codec.js";
import {
	type AgentDecision,
	type AgentRequestIssued,
	type AgentRequestStatusChanged,
	type EffectRunResult,
	effectRunCompletionProjector,
} from "../orchestration/agent-runtime.js";
import type { WorkItemSeed } from "../orchestration/work-item-runtime.js";
import type {
	WorkItemEffectPlanProposed,
	WorkItemProjection,
} from "../solutions/work-item/scheduling.js";
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
function simulatedCurrentKeySpendAdmission(
	onRead: () => void = () => undefined,
): OpenRouterCurrentKeySpendAdmissionCapabilityV1 {
	return Object.freeze({
		async read(input: OpenRouterCurrentKeySpendAdmissionRequestV1) {
			onRead();
			const admitted: Omit<OpenRouterCurrentKeySpendAdmissionV1, "admissionDigest"> = {
				schemaVersion: OPENROUTER_CURRENT_KEY_SPEND_ADMISSION_SCHEMA,
				limitMicrousd: input.expectedLimitMicrousd,
				remainingMicrousd: input.expectedLimitMicrousd,
				usageMicrousd: 0,
				limitReset: "none" as const,
				isManagementKey: false as const,
			};
			return Object.freeze({
				...admitted,
				admissionDigest: empiricalStrictJsonDigest(admitted),
			});
		},
	});
}
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
	command:
		| {
				readonly commandRef: string;
				readonly executable: string;
				readonly argv: readonly string[];
		  }
		| readonly {
				readonly commandRef: string;
				readonly executable: string;
				readonly argv: readonly string[];
		  }[] = {
		commandRef: "actor.status",
		executable: "/usr/bin/git",
		argv: ["status", "--porcelain=v1"],
	},
	sourceContent = "broken-placeholder-value\n",
	modelProfile:
		| "gpt-5.6-sol-medium"
		| "deepseek-v4-flash-high"
		| "glm-5.2-high"
		| "glm-5.2-high-auto"
		| "glm-5.2-medium" = "gpt-5.6-sol-medium",
	trialProfile: "smoke" | "calibration" = "smoke",
	hostDerivedReplace = false,
	taskRef = "task.d659",
	expectedContent = "fixed\n",
): Promise<ClosedHostFixture> {
	const d691Profile = taskRef === D690_TARGET_TASK_REF;
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
		maxToolActions: d691Profile ? D691_BUDGET.maxActionsPerRun : 8,
	});
	const commands = Array.isArray(command) ? command : [command];
	const commandPolicy: ClosedCommandPolicyV1 = strictSnapshot({
		schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.commandPolicy,
		policyRef: "command-policy.d659",
		policyRevision: "command-policy.d659.v1",
		environmentRevision: "posix-sanitized-v1",
		commands: commands.map(
			(candidate) =>
				({
					...candidate,
					maxStdoutBytes: 64 * 1024,
					maxStderrBytes: 64 * 1024,
				}) as const,
		),
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
		taskRef,
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
	const hostDerivedActorInput = hostDerivedReplace
		? createD682MechanicalActorInput({
				workItemRef: task.workItemRef,
				instructionRef: `instruction.${taskRef}`,
				readablePaths: workspaceRecipe.readableFiles,
				writablePaths: workspaceRecipe.writableFiles.map((rule) => rule.path),
				commandRefs: commandPolicy.commands.map((candidate) => candidate.commandRef),
				path: "README.md",
				oldText: sourceContent.trim(),
				newText: expectedContent.trim(),
			})
		: null;
	const schemaCatalog = closedToolSchemaCatalog(
		baseManifest,
		hostDerivedReplace,
		hostDerivedActorInput,
	);
	const baseConfiguration = baseManifest.modelConfigurations[0];
	if (baseConfiguration === undefined) throw new Error("missing actor configuration fixture");
	const chatProfile = modelProfile !== "gpt-5.6-sol-medium";
	const deepSeekProfile = modelProfile === "deepseek-v4-flash-high";
	const modelConfiguration = strictSnapshot({
		...baseConfiguration,
		configurationRef: deepSeekProfile
			? "actor.openrouter.deepseek.deepseek-v4-flash"
			: chatProfile
				? "actor.openrouter.z-ai.glm-5.2"
				: "actor.openrouter.openai.gpt-5.6-sol",
		providerFamily: "openrouter",
		provider: "openrouter",
		model: deepSeekProfile
			? OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL
			: chatProfile
				? OPENROUTER_GLM_5_2_REQUEST_MODEL
				: OPENROUTER_FIRST_SMOKE_REQUEST_MODEL,
		modelIdentityKind: "alias-disclosed" as const,
		endpoint: chatProfile ? OPENROUTER_CHAT_COMPLETIONS_ENDPOINT : OPENROUTER_RESPONSES_ENDPOINT,
		endpointRevision: chatProfile
			? OPENROUTER_CHAT_COMPLETIONS_ENDPOINT_REVISION
			: OPENROUTER_RESPONSES_ENDPOINT_REVISION,
		adapterRevision: chatProfile
			? OPENROUTER_CHAT_COMPLETIONS_ADAPTER_REVISION
			: OPENROUTER_RESPONSES_ADAPTER_REVISION,
		bindingRevision: chatProfile
			? OPENROUTER_CHAT_COMPLETIONS_BINDING_REVISION
			: OPENROUTER_RESPONSES_BINDING_REVISION,
		promptRevision: chatProfile
			? OPENROUTER_CHAT_COMPLETIONS_PROMPT_REVISION
			: OPENROUTER_RESPONSES_PROMPT_REVISION,
		systemPromptRevision: chatProfile
			? deepSeekProfile
				? OPENROUTER_DEEPSEEK_CHAT_COMPLETIONS_SYSTEM_PROMPT_REVISION
				: OPENROUTER_CHAT_COMPLETIONS_SYSTEM_PROMPT_REVISION
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
				effort: modelProfile.startsWith("glm-5.2-high") || deepSeekProfile ? "high" : "medium",
			},
			tools: {
				...baseConfiguration.settings.tools,
				schemaRevision: schemaCatalog.catalogRevision,
				toolRefs: schemaCatalog.tools.map((tool) => tool.toolRef),
				toolSetDigest: empiricalStrictJsonDigest(schemaCatalog.tools),
				choice:
					modelProfile === "glm-5.2-high-auto"
						? ("auto" as const)
						: chatProfile
							? ("required" as const)
							: baseConfiguration.settings.tools.choice,
				maxSteps:
					deepSeekProfile && (trialProfile === "calibration" || d691Profile)
						? D691_BUDGET.maxStepsPerRun
						: 8,
			},
			output: {
				...baseConfiguration.settings.output,
				maxOutputTokens:
					deepSeekProfile && (trialProfile === "calibration" || d691Profile)
						? D691_BUDGET.maxOutputTokensPerTurn
						: baseConfiguration.settings.output.maxOutputTokens,
			},
		},
		usageSource: "provider-reported" as const,
		pricingRevision: deepSeekProfile
			? OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION
			: chatProfile
				? OPENROUTER_GLM_5_2_PRICING_REVISION
				: OPENROUTER_OFFICIAL_PRICING_REVISION,
		pricingScheduleRef: deepSeekProfile
			? OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE
			: chatProfile
				? OPENROUTER_GLM_5_2_PRICING_SOURCE
				: OPENROUTER_OFFICIAL_PRICING_SOURCE,
	});
	const manifest: EmpiricalCampaignManifestV1 = strictSnapshot({
		...baseManifest,
		trialPlan:
			trialProfile === "calibration"
				? {
						profile: "calibration" as const,
						activeTaskRefs: catalog.tasks.map((candidate) => candidate.taskRef),
						attemptedColdBlocksPerTask: 3 as const,
						branchOrderMode: "explicit" as const,
						branchOrder: baseManifest.trialPlan.branchOrder,
					}
				: baseManifest.trialPlan,
		schemaCatalog,
		modelConfigurations: [modelConfiguration],
		budgets: {
			...baseManifest.budgets,
			campaign: {
				...baseManifest.budgets.campaign,
				maxRequests: d691Profile
					? D691_BUDGET.maxHttpAttempts
					: trialProfile === "calibration" && deepSeekProfile
						? B112_D678_CAMPAIGN_MAX_REQUESTS
						: trialProfile === "calibration"
							? 720
							: 48,
				maxCostMicrousd: d691Profile
					? D691_BUDGET.maxSpendMicrousd
					: trialProfile === "calibration" && deepSeekProfile
						? B112_D678_CAMPAIGN_MAX_COST_MICROUSD
						: trialProfile === "calibration"
							? baseManifest.budgets.taskModel.maxCostMicrousd * catalog.tasks.length
							: baseManifest.budgets.campaign.maxCostMicrousd,
				maxElapsedMs: d691Profile
					? D691_BUDGET.maxElapsedMs
					: trialProfile === "calibration" && deepSeekProfile
						? B112_D678_CAMPAIGN_MAX_ELAPSED_MS
						: baseManifest.budgets.campaign.maxElapsedMs,
			},
			taskModel: {
				...baseManifest.budgets.taskModel,
				maxAttemptedColdBlocks: trialProfile === "calibration" ? 3 : 1,
				maxRequests: d691Profile
					? D691_BUDGET.maxHttpAttempts
					: trialProfile === "calibration" && deepSeekProfile
						? B112_D678_TASK_MAX_REQUESTS
						: trialProfile === "calibration"
							? 144
							: 48,
				maxCostMicrousd: d691Profile
					? D691_BUDGET.maxSpendMicrousd
					: trialProfile === "calibration" && deepSeekProfile
						? B112_D679_TASK_MAX_COST_MICROUSD
						: baseManifest.budgets.taskModel.maxCostMicrousd,
			},
			agentRun: {
				...baseManifest.budgets.agentRun,
				maxElapsedMs: d691Profile
					? Math.floor(D691_BUDGET.maxElapsedMs / 6)
					: trialProfile === "calibration" && deepSeekProfile
						? 960_000
						: baseManifest.budgets.agentRun.maxElapsedMs,
				maxSteps:
					deepSeekProfile && (trialProfile === "calibration" || d691Profile)
						? D691_BUDGET.maxStepsPerRun
						: 8,
				maxRequests:
					deepSeekProfile && (trialProfile === "calibration" || d691Profile)
						? D691_BUDGET.maxStepsPerRun
						: 8,
				maxOutputBytes:
					deepSeekProfile && (trialProfile === "calibration" || d691Profile)
						? B112_D678_MAX_CANONICAL_REQUEST_BYTES
						: baseManifest.budgets.agentRun.maxOutputBytes,
			},
		},
		aggregation: {
			...baseManifest.aggregation,
			intervalRevision:
				trialProfile === "calibration"
					? B112_EXHAUSTIVE_TASK_CLUSTER_INTERVAL_REVISION
					: baseManifest.aggregation.intervalRevision,
		},
	});
	const frozen = freezeEmpiricalCampaignManifest(manifest, report);
	const initialRequestBase = buildEmpiricalModelTurnRequestFixture({
		frozen,
		qualificationReport: report,
	});
	const requestWithoutActorInput =
		trialProfile === "calibration"
			? validateEmpiricalModelTurnRequest(
					{
						...initialRequestBase,
						...createB112CalibrationTrialBlockIdentity(frozen, initialRequestBase.taskRef, 1),
					},
					frozen,
					report,
				)
			: initialRequestBase;
	const protectionExecutor = createEmpiricalExactPrivateNeedleProtectionExecutor({
		policyRef: requestWithoutActorInput.protectionPolicyRef,
		policyRevision: requestWithoutActorInput.protectionPolicyRevision,
		protectedNeedleCapabilityRef: "protected-needles.d659",
		protectedNeedleCapabilityRevision: "protected-needles.d659.v1",
		protectedNeedles: ["private-secret-placeholder"],
	});
	const initialRequest =
		hostDerivedActorInput === null
			? requestWithoutActorInput
			: validateEmpiricalModelTurnRequest(
					{
						...requestWithoutActorInput,
						structuredInput: hostDerivedActorInput,
						structuredInputDigest: empiricalStrictJsonDigest(hostDerivedActorInput),
						inputProtectionReceipt: executeEmpiricalProtection(protectionExecutor, {
							policyRef: requestWithoutActorInput.protectionPolicyRef,
							policyRevision: requestWithoutActorInput.protectionPolicyRevision,
							stage: "source-ingress",
							subject:
								hostDerivedActorInput as unknown as EmpiricalModelTurnRequestV1["structuredInput"],
						}).receipt,
					},
					frozen,
					report,
				);

	const allocationRoot = temporaryRoot("allocation");
	const allocator = createLocalSingleBaselineWorkspaceAllocator({
		allocationRoot,
		workspaceDirectoryName: "workspace",
	});
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
			const targetAccepted =
				readFileSync(join(workspaceRoot, "README.md"), "utf8") === expectedContent;
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

function closedToolSchemaCatalog(
	baseManifest: EmpiricalCampaignManifestV1,
	hostDerivedReplace = false,
	actorInput: ReturnType<typeof createD682MechanicalActorInput> | null = null,
) {
	const stringShape = (enumValues: readonly string[] | null = null) =>
		({
			kind: "string",
			minLength: 1,
			maxLength: 32_768,
			enum: enumValues,
		}) as const;
	const replacementStringShape = {
		kind: "string",
		minLength: 0,
		maxLength: 32_768,
		enum: null,
	} as const;
	const integerShape = {
		kind: "integer",
		minimum: 1,
		maximum: hostDerivedReplace ? 32 : 4_096,
	} as const;
	const objectShape = (
		properties: readonly {
			readonly name: string;
			readonly required: boolean;
			readonly shape:
				| ReturnType<typeof stringShape>
				| typeof replacementStringShape
				| typeof integerShape;
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
			inputSchema: objectShape([
				{
					name: "path",
					required: true,
					shape: stringShape(hostDerivedReplace ? (actorInput?.readablePaths ?? null) : null),
				},
			]),
		},
		{
			toolRef: CLOSED_ACTOR_TOOL_REFS.searchLiteral,
			inputSchema: objectShape([
				{ name: "maxMatches", required: true, shape: integerShape },
				{
					name: "path",
					required: true,
					shape: stringShape(hostDerivedReplace ? (actorInput?.readablePaths ?? null) : null),
				},
				{ name: "query", required: true, shape: stringShape() },
			]),
		},
		{
			toolRef: CLOSED_ACTOR_TOOL_REFS.replaceExact,
			inputSchema: objectShape([
				...(hostDerivedReplace
					? []
					: [{ name: "baseContentDigest", required: true, shape: stringShape() }]),
				{
					name: "newText",
					required: true,
					shape: hostDerivedReplace ? replacementStringShape : stringShape(),
				},
				{ name: "oldText", required: true, shape: stringShape() },
				{
					name: "path",
					required: true,
					shape: stringShape(hostDerivedReplace ? (actorInput?.writablePaths ?? null) : null),
				},
			]),
		},
		{
			toolRef: CLOSED_ACTOR_TOOL_REFS.workspaceDiff,
			inputSchema: objectShape([]),
		},
		{
			toolRef: CLOSED_ACTOR_TOOL_REFS.runCommand,
			inputSchema: objectShape([
				{
					name: "commandRef",
					required: true,
					shape: stringShape(hostDerivedReplace ? (actorInput?.commandRefs ?? null) : null),
				},
			]),
		},
	].map((entry) =>
		strictSnapshot({
			...entry,
			schemaRevision: hostDerivedReplace
				? D682_HOST_DERIVED_REPLACE_SCHEMA_REVISION
				: "closed-task-tools.d659.v1",
			inputSchemaDigest: empiricalStrictJsonDigest(entry.inputSchema),
		}),
	);
	return strictSnapshot({
		...baseManifest.schemaCatalog,
		catalogRevision: hostDerivedReplace
			? D682_HOST_DERIVED_REPLACE_SCHEMA_REVISION
			: "closed-task-tools.d659.v1",
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
	hostOutputBytes = 2_048,
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
				hostOutputBytes,
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
	const deepSeekProfile = configuration.model === OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL;
	const simulatedKeyLimitMicrousd = Math.max(1_000_000, budgetOverrides.maxSmokeSpendMicrousd ?? 0);
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
		downstreamProviderSlug: deepSeekProfile
			? OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG
			: glmProfile
				? OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_SLUG
				: OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_SLUG,
		downstreamProviderName: deepSeekProfile
			? OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME
			: glmProfile
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
			inputMicrousdPerMillionTokens: deepSeekProfile
				? OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS
				: glmProfile
					? OPENROUTER_GLM_5_2_INPUT_MICROUSD_PER_MILLION_TOKENS
					: 6_250_000,
			outputMicrousdPerMillionTokens: deepSeekProfile
				? OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS
				: glmProfile
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
			limitMicrousd: simulatedKeyLimitMicrousd,
			remainingMicrousd: simulatedKeyLimitMicrousd,
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

function d690OfflineEvidenceFixture() {
	const transferMemory = createD690HistoricalTransferMemory();
	const marker = (name: string) => empiricalStrictJsonDigest({ kind: `d690-test-${name}` });
	const material = strictSnapshot({
		version: D690_HISTORICAL_PAIR_EVIDENCE_VERSION,
		claimBoundary: D690_CLAIM_BOUNDARY,
		efficacyClaim: "none" as const,
		sourceTaskRef: D690_SOURCE.taskRef,
		targetTaskRef: D690_TARGET_TASK_REF,
		failureMechanismRef: D690_FAILURE_MECHANISM_REF,
		sourceObservationDigest: D690_SOURCE.observationDigest,
		targetMaterializationEvidenceDigest: marker("target-materialization"),
		verifierCalibrationDigest: marker("verifier-calibration"),
		verifierToolchainBindingDigest: marker("verifier-toolchain"),
		verifierRuntimeClosurePackageCount: 149,
		networkIsolationProfile: "macos-sandbox-exec-deny-network.v1" as const,
		transferMemoryDigest: empiricalStrictJsonDigest(transferMemory),
		pairQualificationDigest: marker("pair-qualification"),
		d689OfflineEvidenceDigest: marker("d689-offline"),
		d689OfflineCaseCount: 9,
		privateMaterialProtectionSetBindingDigest: marker("protection-set"),
		leakageProbeSetDigest: marker("leakage-probes"),
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

function d678SimulatedCalibrationQualifications(
	fixture: ClosedHostFixture,
): readonly OpenRouterRouteQualificationV1[] {
	const base = simulatedRouteQualification(fixture, {
		maxSmokeSpendMicrousd: B112_D678_BLOCK_MAX_COST_MICROUSD,
		maxRequests: B112_D678_BLOCK_MAX_REQUESTS,
		maxStepsPerRun: B112_D678_AGENT_MAX_STEPS,
		maxCanonicalRequestBytes: B112_D678_MAX_CANONICAL_REQUEST_BYTES,
		maxInputTokens: B112_D678_BLOCK_MAX_INPUT_TOKENS,
		maxOutputTokens: B112_D678_BLOCK_MAX_OUTPUT_TOKENS,
		maxLatencyMs: B112_D678_BLOCK_MAX_LATENCY_MS,
	});
	return strictSnapshot(
		fixture.frozen.manifest.trialPlan.activeTaskRefs.flatMap((taskRef, taskIndex) =>
			([1, 2, 3] as const).map((blockIndex) => {
				const block = createB112CalibrationTrialBlockIdentity(fixture.frozen, taskRef, blockIndex);
				const ordinal = taskIndex * 3 + blockIndex;
				return strictSnapshot({
					...base,
					qualificationRef: `b112-d678-simulated-route-${ordinal}`,
					qualificationRevision: `b112-d678-simulated-route.v${ordinal}`,
					...block,
					keySpendLimit: {
						...base.keySpendLimit,
						limitMicrousd: B112_D678_CAMPAIGN_MAX_COST_MICROUSD,
						remainingMicrousd: B112_D678_CAMPAIGN_MAX_COST_MICROUSD,
					},
				});
			}),
		),
	);
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
	const deepSeekProfile = route.requestModel === OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL;
	const selectedModel = deepSeekProfile
		? OPENROUTER_DEEPSEEK_V4_FLASH_SELECTED_MODEL
		: route.requestModel;
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
					model: selectedModel,
					selected: true,
				},
			],
		},
		attempts: [
			{
				provider: route.downstreamProviderName,
				model: selectedModel,
				status: 200,
			},
		],
		pipeline: [],
	};
	let response: Record<string, unknown>;
	if (route.requestModel === OPENROUTER_GLM_5_2_REQUEST_MODEL || deepSeekProfile) {
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
	it("executes one D674 multi-intent response serially before the next model turn", async () => {
		const fixture = await createClosedHostFixture();
		const baseContentDigest = empiricalSha256(encoder.encode("broken-placeholder-value\n"));
		const observedToolResultRefs: string[] = [];
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
						intent(1, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" }),
					],
				};
			}
			observedToolResultRefs.push(...request.priorToolResults.map((result) => result.toolCallRef));
			expect(JSON.stringify(request.priorToolResults[1]?.result)).toContain("fixed");
			expect(JSON.stringify(request.priorToolResults[1]?.result)).not.toContain(
				"broken-placeholder-value",
			);
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

		expect(outcome.status).toBe("completed");
		expect(outcome.toolActionCount).toBe(2);
		expect(outcome.logicalStepCount).toBe(2);
		expect(observedToolResultRefs).toEqual(["tool-call.0", "tool-call.1"]);
	});

	it("keeps D674 multi-intent execution ordered and non-transactional on a later tool failure", async () => {
		const fixture = await createClosedHostFixture();
		const port = scriptedPort(fixture, () => ({
			finishReason: "tool-intents",
			toolIntents: [
				intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" }),
				intent(1, CLOSED_ACTOR_TOOL_REFS.runCommand, {
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
		expect(outcome.toolActionCount).toBe(1);
		expect(outcome.toolEvidence).toHaveLength(1);
		expect(fixture.verifierCalls.count).toBe(0);
	});

	it("rejects a D674 batch above the 16-intent host ceiling before executing any tool", async () => {
		const fixture = await createClosedHostFixture();
		const initialRequest = {
			...fixture.initialRequest,
			remainingTurnBudget: {
				...fixture.initialRequest.remainingTurnBudget,
				maxOutputBytes: 4_096,
			},
		};
		let modelTurnCalls = 0;
		const port: EmpiricalModelTurnPortV1 = {
			async invoke(request) {
				modelTurnCalls += 1;
				return completedOutcome(
					request,
					fixture.frozen,
					fixture.report,
					fixture.protectionExecutor,
					{
						finishReason: "tool-intents",
						toolIntents: Array.from({ length: 17 }, (_, index) =>
							intent(index, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" }),
						),
					},
					4_096,
				);
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

		expect(outcome.status).toBe("non-evaluable");
		expect(outcome.issueCodes).toContain("tool-intent-count-exceeded");
		expect(outcome.toolActionCount).toBe(0);
		expect(outcome.toolEvidence).toEqual([]);
		expect(outcome.actionTrace).toEqual([]);
		expect(fixture.verifierCalls.count).toBe(0);
		expect(modelTurnCalls).toBe(1);
	});

	it("runs five code-closed actor tools in explicit turns, gates the diff, verifies, and cleans up", async () => {
		const fixture = await createClosedHostFixture();
		const actionReceipts: Array<{
			readonly actionIndex: number;
			readonly intentDigest: string;
			readonly resultDigest: string;
			readonly toolRef: string;
			readonly arguments: unknown;
			readonly result: unknown;
		}> = [];
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
			actionReceiptObserver: {
				observerRef: "developer-guidance-action-observer",
				observerRevision: "developer-guidance-action-observer.v1",
				record(receipt) {
					actionReceipts.push(receipt);
				},
			},
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
		expect(actionReceipts).toHaveLength(5);
		expect(actionReceipts.map((entry) => entry.toolRef)).toEqual(
			outcome.actionTrace.map((entry) => entry.toolRef),
		);
		expect(
			actionReceipts.every(
				(receipt, index) =>
					receipt.actionIndex === index &&
					receipt.intentDigest === outcome.actionTrace[index]?.intentDigest &&
					receipt.resultDigest === outcome.actionTrace[index]?.resultDigest,
			),
		).toBe(true);
		expect(actionReceipts[2]?.arguments).toMatchObject({ path: "README.md" });
		expect(actionReceipts[2]?.result).toMatchObject({ kind: "replace-exact", replacements: 1 });
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
	}, 30_000);

	it("fails closed without persisting a partial action receipt when its observer rejects", async () => {
		const fixture = await createClosedHostFixture();
		const port = scriptedPort(fixture, () => ({
			finishReason: "tool-intents",
			toolIntents: [intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
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
			actionReceiptObserver: {
				observerRef: "rejecting-action-observer",
				observerRevision: "rejecting-action-observer.v1",
				record() {
					throw new Error("private-observer-sentinel");
				},
			},
			signal: new AbortController().signal,
		});

		expect(outcome).toMatchObject({
			status: "non-evaluable",
			issueCodes: ["action-receipt-observer-failed"],
			cleanupSucceeded: true,
		});
		expect(outcome.toolEvidence).toHaveLength(1);
		expect(outcome.actionTrace).toEqual([]);
		expect(JSON.stringify(outcome)).not.toContain("private-observer-sentinel");
		expect(fixture.verifierCalls.count).toBe(0);
	});

	it("derives D682 replace integrity from the current workspace and returns bounded generic progress", async () => {
		const fixture = await createClosedHostFixture(
			undefined,
			undefined,
			"gpt-5.6-sol-medium",
			"smoke",
			true,
		);
		const observedArguments: EmpiricalModelToolIntentV1["arguments"][] = [];
		const observedResults: Array<EmpiricalModelTurnRequestV1["priorToolResults"][number]> = [];
		const port = scriptedPort(fixture, (request) => {
			observedResults.push(...request.priorToolResults);
			const tool = (() => {
				switch (request.stepIndex) {
					case 0:
						return intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" });
					case 1:
						return intent(1, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
							newText: "fixed",
							oldText: "broken-placeholder-value",
							path: "README.md",
						});
					case 2:
						return intent(2, CLOSED_ACTOR_TOOL_REFS.workspaceDiff, {});
					case 3:
						return intent(3, CLOSED_ACTOR_TOOL_REFS.runCommand, {
							commandRef: "actor.status",
						});
					default:
						return null;
				}
			})();
			if (tool !== null) {
				observedArguments.push(tool.arguments);
				return { finishReason: "tool-intents", toolIntents: [tool] };
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

		expect(outcome).toMatchObject({
			status: "completed",
			toolActionCount: 4,
			verifierVerdict: "passed",
			issueCodes: [],
		});
		expect(
			observedArguments.some(
				(value) =>
					typeof value === "object" &&
					value !== null &&
					!Array.isArray(value) &&
					Object.hasOwn(value, "baseContentDigest"),
			),
		).toBe(false);
		const progress = observedResults.map(
			(entry) => (entry.result as { readonly progress?: unknown }).progress,
		);
		expect(progress).toHaveLength(4);
		expect(progress).toEqual([
			expect.objectContaining({
				mutationObserved: false,
				diffObserved: false,
				commandObserved: false,
			}),
			expect.objectContaining({ mutationObserved: true }),
			expect.objectContaining({ mutationObserved: true, diffObserved: true }),
			expect.objectContaining({
				mutationObserved: true,
				diffObserved: true,
				commandObserved: true,
			}),
		]);
		expect(JSON.stringify(outcome)).not.toContain("progress");
	});

	it("qualifies D693 assisted progress through the real closed host without provider or network calls", async () => {
		const validationCommand = {
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/grep",
			argv: ["-q", "fixed", "README.md"],
		} as const;
		const otherCommand = {
			commandRef: "actor.status",
			executable: "/usr/bin/git",
			argv: ["status", "--porcelain=v1"],
		} as const;
		const plan = strictSnapshot({
			readPaths: ["README.md"],
			writablePath: "README.md",
			initialContentDigest: empiricalSha256(encoder.encode("broken-placeholder-value\n")),
			initialOldText: "broken-placeholder-value",
			acceptedNewText: "fixed",
			rejectedNewText: "still-broken",
			acceptedContentDigest: empiricalSha256(encoder.encode("fixed\n")),
			validationCommandRef: validationCommand.commandRef,
			otherCommandRef: otherCommand.commandRef,
		});
		const fixture = await createClosedHostFixture([validationCommand, otherCommand]);
		const reports: Awaited<ReturnType<typeof runD693AssistedProgressCase>>[] = [];
		for (const [index, caseRef] of D693_CASE_ORDER.entries()) {
			const materialization =
				index === 0
					? fixture.materialization
					: await fixture.prepareFreshMaterialization(new AbortController().signal);
			reports.push(
				await runD693AssistedProgressCase({
					caseRef,
					host: {
						frozen: fixture.frozen,
						qualificationReport: fixture.report,
						initialRequest: fixture.initialRequest,
						taskProfile: fixture.taskProfile,
						materialization,
						protectionExecutor: fixture.protectionExecutor,
					},
					plan,
					signal: new AbortController().signal,
				}),
			);
		}
		const qualification = createD693AssistedProgressQualification(reports);
		expect(
			validateD693AssistedProgressQualification(
				strictJsonCodec.decode(strictJsonCodec.encode(qualification)),
			),
		).toEqual(qualification);
		expect(() =>
			createD693AssistedProgressQualification(reports.map((report) => strictSnapshot(report))),
		).toThrow("requires reports produced by the closed host runner");
		expect(() =>
			validateD693AssistedProgressQualification({
				...qualification,
				efficacyClaim: "positive",
			}),
		).toThrow('expected "none"');
		const alternateValidationCommand = {
			...validationCommand,
			argv: ["-q", "fixed-alt", "README.md"],
		} as const;
		const alternateFixture = await createClosedHostFixture([
			alternateValidationCommand,
			otherCommand,
		]);
		const alternateWrong = await runD693AssistedProgressCase({
			caseRef: "assisted-wrong-command",
			host: {
				frozen: alternateFixture.frozen,
				qualificationReport: alternateFixture.report,
				initialRequest: alternateFixture.initialRequest,
				taskProfile: alternateFixture.taskProfile,
				materialization: alternateFixture.materialization,
				protectionExecutor: alternateFixture.protectionExecutor,
			},
			plan: {
				...plan,
				acceptedNewText: "fixed-alt",
				acceptedContentDigest: empiricalSha256(encoder.encode("fixed-alt\n")),
			},
			signal: new AbortController().signal,
		});
		expect(
			createD693AssistedProgressQualification([...reports.slice(0, 5), alternateWrong]).qualified,
		).toBe(false);
		expect(qualification).toMatchObject({
			qualified: true,
			sameInspectionIntentSet: true,
			sameInspectionResultSet: true,
			inspectionFinalRejectedBeforeVerifier: true,
			validProgressAcceptedByVerifier: true,
			nonzeroValidationReturnedSanitized: true,
			staleValidationRejected: true,
			wrongCommandRejected: true,
			boundedLoopStopped: true,
			providerCallCount: 0,
			networkCallCount: 0,
			chargedCostMicrousd: 0,
			causalAttribution: "undetermined",
			efficacyClaim: "none",
		});
		expect(qualification.cases[0]).toMatchObject({
			caseRef: "current-inspection-final",
			hostStatus: "completed",
			verifierInvocationCount: 1,
			verifierVerdict: "failed",
		});
		expect(qualification.cases[1]).toMatchObject({
			caseRef: "assisted-inspection-final",
			hostStatus: "non-evaluable",
			verifierInvocationCount: 0,
		});
		expect(qualification.cases[2]).toMatchObject({
			caseRef: "assisted-valid-progress",
			hostStatus: "completed",
			verifierInvocationCount: 1,
			verifierVerdict: "passed",
			validationReceiptStatus: "passed",
			validationReceiptSanitized: true,
		});
		expect(qualification.cases[3]).toMatchObject({
			validationReceiptStatus: "failed",
			validationReceiptSanitized: true,
			verifierInvocationCount: 0,
		});

		const persistenceProtection = fixture.protectionExecutor;
		const operatorRoot = temporaryRoot("d693-private");
		const privateParent = join(operatorRoot, ".private");
		const privateRoot = join(privateParent, "empirical-memory-rerun-avoidance");
		mkdirSync(privateParent, { mode: 0o700 });
		mkdirSync(privateRoot, { mode: 0o700 });
		chmodSync(privateRoot, 0o700);
		const persisted = await persistD693AssistedProgressQualification({
			privateRoot,
			generationRef: "d693-assisted-progress-offline-v1",
			qualification,
			protectionExecutor: persistenceProtection,
		});
		expect(readdirSync(persisted.generationPath).sort()).toEqual([
			"assisted-progress-qualification.v1.json",
			"generation.v1.json",
		]);
		for (const file of readdirSync(persisted.generationPath)) {
			expect(statSync(join(persisted.generationPath, file)).mode & 0o777).toBe(0o600);
		}
		await expect(
			persistD693AssistedProgressQualification({
				privateRoot,
				generationRef: "d693-assisted-progress-offline-v1",
				qualification,
				protectionExecutor: persistenceProtection,
			}),
		).rejects.toThrow("already exists");
		await expect(
			persistD693AssistedProgressQualification({
				privateRoot,
				generationRef: "d693-canonical-forgery",
				qualification: validateD693AssistedProgressQualification(
					strictJsonCodec.decode(strictJsonCodec.encode(qualification)),
				),
				protectionExecutor: persistenceProtection,
			}),
		).rejects.toThrow("qualification produced in this host process");
		expect(() => statSync(join(privateRoot, "d693-canonical-forgery"))).toThrow();
		let forgedProtectionCalls = 0;
		await expect(
			persistD693AssistedProgressQualification({
				privateRoot,
				generationRef: "d693-forged-protection",
				qualification,
				protectionExecutor: {
					policyRef: persistenceProtection.policyRef,
					policyRevision: persistenceProtection.policyRevision,
					inspect() {
						forgedProtectionCalls += 1;
						return { disposition: "allowed" };
					},
				} as unknown as EmpiricalExactPrivateNeedleProtectionExecutorV1,
			}),
		).rejects.toThrow("constructed private protection capability");
		expect(forgedProtectionCalls).toBe(0);
		expect(() => statSync(join(privateRoot, "d693-forged-protection"))).toThrow();
		expect(readdirSync(privateRoot).filter((entry) => entry.startsWith(".d693-staging-"))).toEqual(
			[],
		);
	}, 30_000);

	it("binds D693 progress to changed workspace state across no-op, mutating-command, and multi-intent paths", async () => {
		const initialDigest = empiricalSha256(encoder.encode("broken-placeholder-value\n"));
		const finalBody = {
			finishReason: "structured-output" as const,
			structuredOutput: { kind: "model-turn-output-placeholder", summary: "D693 state gate" },
		};
		const noOp = await createClosedHostFixture({
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/true",
			argv: [],
		});
		const noOpOutcome = await runClosedTaskProfileHost({
			frozen: noOp.frozen,
			qualificationReport: noOp.report,
			initialRequest: noOp.initialRequest,
			taskProfile: noOp.taskProfile,
			materialization: noOp.materialization,
			modelTurnPort: scriptedPort(noOp, (request) => {
				if (request.stepIndex === 0)
					return {
						finishReason: "tool-intents",
						toolIntents: [intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
					};
				if (request.stepIndex === 1)
					return {
						finishReason: "tool-intents",
						toolIntents: [
							intent(1, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
								baseContentDigest: initialDigest,
								oldText: "broken-placeholder-value",
								newText: "broken-placeholder-value",
								path: "README.md",
							}),
						],
					};
				if (request.stepIndex === 2)
					return {
						finishReason: "tool-intents",
						toolIntents: [intent(2, CLOSED_ACTOR_TOOL_REFS.workspaceDiff, {})],
					};
				if (request.stepIndex === 3)
					return {
						finishReason: "tool-intents",
						toolIntents: [
							intent(3, CLOSED_ACTOR_TOOL_REFS.runCommand, {
								commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
							}),
						],
					};
				return finalBody;
			}),
			protectionExecutor: noOp.protectionExecutor,
			verifier: noOp.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			signal: new AbortController().signal,
		});
		expect(noOpOutcome).toMatchObject({
			status: "non-evaluable",
			verifierVerdict: null,
		});
		expect(noOpOutcome.issueCodes).toContain("agent-step-budget-exhausted");
		expect(noOp.verifierCalls.count).toBe(0);

		const mutating = await createClosedHostFixture({
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/perl",
			argv: ["-pi", "-e", "s/fixed/changed/", "README.md"],
		});
		const mutatingOutcome = await runClosedTaskProfileHost({
			frozen: mutating.frozen,
			qualificationReport: mutating.report,
			initialRequest: mutating.initialRequest,
			taskProfile: mutating.taskProfile,
			materialization: mutating.materialization,
			modelTurnPort: scriptedPort(mutating, (request) => {
				if (request.stepIndex === 0)
					return {
						finishReason: "tool-intents",
						toolIntents: [intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
					};
				if (request.stepIndex === 1)
					return {
						finishReason: "tool-intents",
						toolIntents: [
							intent(1, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
								baseContentDigest: initialDigest,
								oldText: "broken-placeholder-value",
								newText: "fixed",
								path: "README.md",
							}),
						],
					};
				if (request.stepIndex === 2)
					return {
						finishReason: "tool-intents",
						toolIntents: [intent(2, CLOSED_ACTOR_TOOL_REFS.workspaceDiff, {})],
					};
				if (request.stepIndex === 3)
					return {
						finishReason: "tool-intents",
						toolIntents: [
							intent(3, CLOSED_ACTOR_TOOL_REFS.runCommand, {
								commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
							}),
						],
					};
				return finalBody;
			}),
			protectionExecutor: mutating.protectionExecutor,
			verifier: mutating.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			signal: new AbortController().signal,
		});
		expect(mutatingOutcome).toMatchObject({ status: "non-evaluable", verifierVerdict: null });
		expect(mutating.verifierCalls.count).toBe(0);

		const delayed = await createClosedHostFixture({
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/grep",
			argv: ["-q", "fixed", "README.md"],
		});
		const delayedOutcome = await runClosedTaskProfileHost({
			frozen: delayed.frozen,
			qualificationReport: delayed.report,
			initialRequest: delayed.initialRequest,
			taskProfile: delayed.taskProfile,
			materialization: delayed.materialization,
			modelTurnPort: scriptedPort(delayed, (request) => {
				if (request.stepIndex === 0)
					return {
						finishReason: "tool-intents",
						toolIntents: [intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
					};
				if (request.stepIndex === 1)
					return {
						finishReason: "tool-intents",
						toolIntents: [
							intent(1, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
								baseContentDigest: initialDigest,
								oldText: "broken-placeholder-value",
								newText: "fixed",
								path: "README.md",
							}),
						],
					};
				if (request.stepIndex === 2)
					return {
						finishReason: "tool-intents",
						toolIntents: [intent(2, CLOSED_ACTOR_TOOL_REFS.workspaceDiff, {})],
					};
				if (request.stepIndex === 3)
					return {
						finishReason: "tool-intents",
						toolIntents: [
							intent(3, CLOSED_ACTOR_TOOL_REFS.runCommand, {
								commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
							}),
						],
					};
				writeFileSync(join(delayed.workspaceRoot, "README.md"), "changed\n");
				return finalBody;
			}),
			protectionExecutor: delayed.protectionExecutor,
			verifier: delayed.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			signal: new AbortController().signal,
		});
		expect(delayedOutcome).toMatchObject({ status: "non-evaluable", verifierVerdict: null });
		expect(delayedOutcome.issueCodes).toContain("agent-step-budget-exhausted");
		expect(delayed.verifierCalls.count).toBe(0);

		const multi = await createClosedHostFixture({
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/grep",
			argv: ["-q", "fixed", "README.md"],
		});
		const multiIntent = (
			index: number,
			toolRef: string,
			argumentsValue: EmpiricalModelToolIntentV1["arguments"],
		): EmpiricalModelToolIntentV1 =>
			strictSnapshot({
				...intent(1, toolRef, argumentsValue),
				toolCallRef: `tool-call.1.${index}`,
			});
		const multiOutcome = await runClosedTaskProfileHost({
			frozen: multi.frozen,
			qualificationReport: multi.report,
			initialRequest: multi.initialRequest,
			taskProfile: multi.taskProfile,
			materialization: multi.materialization,
			modelTurnPort: scriptedPort(multi, (request) => {
				if (request.stepIndex === 0)
					return {
						finishReason: "tool-intents",
						toolIntents: [intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
					};
				if (request.stepIndex === 1)
					return {
						finishReason: "tool-intents",
						toolIntents: [
							multiIntent(0, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
								baseContentDigest: initialDigest,
								oldText: "broken-placeholder-value",
								newText: "fixed",
								path: "README.md",
							}),
							multiIntent(1, CLOSED_ACTOR_TOOL_REFS.workspaceDiff, {}),
							multiIntent(2, CLOSED_ACTOR_TOOL_REFS.runCommand, {
								commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
							}),
						],
					};
				return finalBody;
			}),
			protectionExecutor: multi.protectionExecutor,
			verifier: multi.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			signal: new AbortController().signal,
		});
		expect(multiOutcome).toMatchObject({
			status: "completed",
			verifierVerdict: "passed",
			toolActionCount: 4,
		});
		expect(multi.verifierCalls.count).toBe(1);
	}, 30_000);

	it("rejects an unbound or accessor-supplied D693 policy before model or verifier execution", async () => {
		const unbound = await createClosedHostFixture();
		let modelInvocations = 0;
		await expect(
			runClosedTaskProfileHost({
				frozen: unbound.frozen,
				qualificationReport: unbound.report,
				initialRequest: unbound.initialRequest,
				taskProfile: unbound.taskProfile,
				materialization: unbound.materialization,
				modelTurnPort: {
					async invoke() {
						modelInvocations += 1;
						throw new TypeError("unexpected D693 model invocation");
					},
				},
				protectionExecutor: unbound.protectionExecutor,
				verifier: unbound.verifier,
				objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("does not bind one actor-visible command");
		expect(modelInvocations).toBe(0);
		expect(unbound.verifierCalls.count).toBe(0);
		expect(() => statSync(unbound.workspaceRoot)).toThrow();

		const accessor = await createClosedHostFixture();
		let getterHits = 0;
		const hostInput: Record<string, unknown> = {
			frozen: accessor.frozen,
			qualificationReport: accessor.report,
			initialRequest: accessor.initialRequest,
			taskProfile: accessor.taskProfile,
			materialization: accessor.materialization,
			modelTurnPort: {
				async invoke() {
					throw new TypeError("unexpected D693 accessor model invocation");
				},
			},
			protectionExecutor: accessor.protectionExecutor,
			verifier: accessor.verifier,
			signal: new AbortController().signal,
		};
		Object.defineProperty(hostInput, "objectiveProgressPolicy", {
			enumerable: true,
			get() {
				getterHits += 1;
				return D693_ASSISTED_PROGRESS_POLICY;
			},
		});
		await expect(
			runClosedTaskProfileHost(hostInput as unknown as ClosedTaskProfileHostRunInputV1),
		).rejects.toThrow("expected an own enumerable data property");
		expect(getterHits).toBe(0);
		expect(accessor.verifierCalls.count).toBe(0);
		expect(() => statSync(accessor.workspaceRoot)).toThrow();

		const nested = await createClosedHostFixture({
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/true",
			argv: [],
		});
		let nestedGetterHits = 0;
		let nestedModelInvocations = 0;
		const nestedPolicy: Record<string, unknown> = {
			schemaVersion: D693_ASSISTED_PROGRESS_POLICY.schemaVersion,
			policyRef: D693_ASSISTED_PROGRESS_POLICY.policyRef,
			policyRevision: D693_ASSISTED_PROGRESS_POLICY.policyRevision,
		};
		Object.defineProperty(nestedPolicy, "validationCommandRef", {
			enumerable: true,
			get() {
				nestedGetterHits += 1;
				return D693_ASSISTED_PROGRESS_POLICY.validationCommandRef;
			},
		});
		Object.freeze(nestedPolicy);
		await expect(
			runClosedTaskProfileHost({
				frozen: nested.frozen,
				qualificationReport: nested.report,
				initialRequest: nested.initialRequest,
				taskProfile: nested.taskProfile,
				materialization: nested.materialization,
				modelTurnPort: {
					async invoke() {
						nestedModelInvocations += 1;
						throw new TypeError("unexpected D693 nested-accessor model invocation");
					},
				},
				protectionExecutor: nested.protectionExecutor,
				verifier: nested.verifier,
				objectiveProgressPolicy:
					nestedPolicy as unknown as ClosedTaskProfileHostRunInputV1["objectiveProgressPolicy"],
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("expected an own data property");
		expect(nestedGetterHits).toBe(0);
		expect(nestedModelInvocations).toBe(0);
		expect(nested.verifierCalls.count).toBe(0);
		expect(() => statSync(nested.workspaceRoot)).toThrow();
	}, 30_000);

	it("qualifies D695 host feedback recovery and rejects same-state inspection before duplicate execution", async () => {
		const policy = strictSnapshot({
			schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.noProgressContinuationPolicy,
			policyRef: "no-progress.d695.historical-transfer",
			policyRevision: "decision.D695.2026-08-08.v1",
			maxRetainedToolResults: 16,
			maxRetainedBytes: 131_072,
			maxRejectedTerminals: 2,
			maxSemanticDuplicateRejections: 1,
			maxInspectionBatchesPerState: 16,
		}) satisfies ClosedNoProgressContinuationPolicyV1;
		const validationCommand = {
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/grep",
			argv: ["-q", "fixed", "README.md"],
		} as const;
		const fixture = await createClosedHostFixture([validationCommand]);
		const baseContentDigest = empiricalSha256(encoder.encode("broken-placeholder-value\n"));
		const capsules: ClosedHostContinuationV1[] = [];
		const initialPort = scriptedPort(fixture, (request) =>
			request.stepIndex === 0
				? {
						finishReason: "tool-intents",
						toolIntents: [intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
					}
				: {
						finishReason: "structured-output",
						structuredOutput: {
							kind: "model-turn-output-placeholder",
							summary: "premature",
						},
					},
		);
		const continuationPort: ClosedContinuationModelTurnPortV1 = Object.freeze({
			async invoke(
				request: EmpiricalModelTurnRequestV1,
				continuation: ClosedHostContinuationV1,
				signal: AbortSignal,
			) {
				if (signal.aborted) throw new DOMException("cancelled", "AbortError");
				capsules.push(continuation);
				const body =
					request.stepIndex === 2
						? {
								finishReason: "tool-intents" as const,
								toolIntents: [
									intent(2, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
										baseContentDigest,
										newText: "fixed",
										oldText: "broken-placeholder-value",
										path: "README.md",
									}),
								],
							}
						: request.stepIndex === 3
							? {
									finishReason: "tool-intents" as const,
									toolIntents: [intent(3, CLOSED_ACTOR_TOOL_REFS.workspaceDiff, {})],
								}
							: request.stepIndex === 4
								? {
										finishReason: "tool-intents" as const,
										toolIntents: [
											intent(4, CLOSED_ACTOR_TOOL_REFS.runCommand, {
												commandRef: validationCommand.commandRef,
											}),
										],
									}
								: {
										finishReason: "structured-output" as const,
										structuredOutput: {
											kind: "model-turn-output-placeholder",
											summary: "verified",
										},
									};
				return completedOutcome(
					request,
					fixture.frozen,
					fixture.report,
					fixture.protectionExecutor,
					body,
				);
			},
		});
		const recovered = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: initialPort,
			continuationModelTurnPort: continuationPort,
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: policy,
			signal: new AbortController().signal,
		});
		expect(recovered.status).toBe("completed");
		expect(recovered.verifierVerdict).toBe("passed");
		expect(capsules[0]).toMatchObject({
			reason: "premature-structured-output",
			retainedToolResultCount: 1,
			requiredDisposition: "tool-intents",
		});
		expect(capsules.at(-1)?.requiredDisposition).toBe("final-allowed");

		const duplicateFixture = await createClosedHostFixture([validationCommand]);
		const receipts: ClosedNoProgressReceiptV1[] = [];
		const duplicateContinuation: ClosedContinuationModelTurnPortV1 = Object.freeze({
			async invoke(
				request: EmpiricalModelTurnRequestV1,
				_continuation: ClosedHostContinuationV1,
				_signal: AbortSignal,
			) {
				return completedOutcome(
					request,
					duplicateFixture.frozen,
					duplicateFixture.report,
					duplicateFixture.protectionExecutor,
					request.stepIndex === 1
						? {
								finishReason: "structured-output",
								structuredOutput: {
									kind: "model-turn-output-placeholder",
									summary: "premature",
								},
							}
						: {
								finishReason: "tool-intents",
								toolIntents: [intent(10, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
							},
				);
			},
		});
		const duplicate = await runClosedTaskProfileHost({
			frozen: duplicateFixture.frozen,
			qualificationReport: duplicateFixture.report,
			initialRequest: duplicateFixture.initialRequest,
			taskProfile: duplicateFixture.taskProfile,
			materialization: duplicateFixture.materialization,
			modelTurnPort: scriptedPort(duplicateFixture, (request) =>
				request.stepIndex === 0
					? {
							finishReason: "tool-intents",
							toolIntents: [intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
						}
					: {
							finishReason: "structured-output",
							structuredOutput: {
								kind: "model-turn-output-placeholder",
								summary: "premature",
							},
						},
			),
			continuationModelTurnPort: duplicateContinuation,
			protectionExecutor: duplicateFixture.protectionExecutor,
			verifier: duplicateFixture.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: policy,
			noProgressReceiptObserver: Object.freeze({
				observerRef: "observer.d695.test",
				observerRevision: "observer.d695.test.v1",
				record(receipt: ClosedNoProgressReceiptV1) {
					receipts.push(receipt);
				},
			}),
			signal: new AbortController().signal,
		});
		expect(duplicate.status).toBe("non-evaluable");
		expect(duplicate.issueCodes).toEqual(["repeated-inspection-turn-no-progress"]);
		expect(duplicate.toolActionCount).toBe(1);
		expect(receipts).toHaveLength(1);
		expect(receipts[0]?.disposition).toBe("rejected-before-tool-execution");
	}, 30_000);

	it("fails D695 multiple-intent duplicates before side effects and compares collision buckets by bytes", async () => {
		const policy = strictSnapshot({
			schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.noProgressContinuationPolicy,
			policyRef: "no-progress.d695.historical-transfer",
			policyRevision: "decision.D695.2026-08-08.v1",
			maxRetainedToolResults: 16,
			maxRetainedBytes: 131_072,
			maxRejectedTerminals: 2,
			maxSemanticDuplicateRejections: 1,
			maxInspectionBatchesPerState: 16,
		}) satisfies ClosedNoProgressContinuationPolicyV1;
		const fixture = await createClosedHostFixture({
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/true",
			argv: [],
		});
		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: scriptedPort(fixture, () => ({
				finishReason: "tool-intents",
				toolIntents: [
					intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" }),
					intent(1, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" }),
				],
			})),
			continuationModelTurnPort: Object.freeze({
				async invoke() {
					throw new TypeError("must reject before continuation");
				},
			}),
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: policy,
			signal: new AbortController().signal,
		});
		expect(outcome.issueCodes).toEqual(["duplicate-inspection-intent-in-turn"]);
		expect(outcome.toolActionCount).toBe(0);
		expect(
			sameClosedInspectionBatch(
				{ digest: "sha256:collision", canonicalBytes: encoder.encode("left") },
				{ digest: "sha256:collision", canonicalBytes: encoder.encode("right") },
			),
		).toBe(false);
		expect(
			sameClosedInspectionBatch(
				{ digest: "sha256:left-evidence", canonicalBytes: encoder.encode("same") },
				{ digest: "sha256:right-evidence", canonicalBytes: encoder.encode("same") },
			),
		).toBe(true);

		const mixedFixture = await createClosedHostFixture({
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/true",
			argv: [],
		});
		const mixedReceipts: ClosedNoProgressReceiptV1[] = [];
		const mixed = await runClosedTaskProfileHost({
			frozen: mixedFixture.frozen,
			qualificationReport: mixedFixture.report,
			initialRequest: mixedFixture.initialRequest,
			taskProfile: mixedFixture.taskProfile,
			materialization: mixedFixture.materialization,
			modelTurnPort: scriptedPort(mixedFixture, () => ({
				finishReason: "tool-intents",
				toolIntents: [
					intent(10, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" }),
					intent(11, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
						baseContentDigest: empiricalSha256(encoder.encode("broken-placeholder-value\n")),
						newText: "fixed",
						oldText: "broken-placeholder-value",
						path: "README.md",
					}),
				],
			})),
			continuationModelTurnPort: Object.freeze({
				async invoke() {
					throw new TypeError("D695 mixed-state results must stop before continuation");
				},
			}),
			protectionExecutor: mixedFixture.protectionExecutor,
			verifier: mixedFixture.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: policy,
			noProgressReceiptObserver: Object.freeze({
				observerRef: "observer.d695.mixed-effect",
				observerRevision: "observer.d695.mixed-effect.v1",
				record(receipt: ClosedNoProgressReceiptV1) {
					mixedReceipts.push(receipt);
				},
			}),
			signal: new AbortController().signal,
		});
		expect(mixed.issueCodes).toEqual(["no-progress-stale-result-intent-batch"]);
		expect(mixed.toolActionCount).toBe(0);
		expect(mixed.actionTrace).toEqual([]);
		expect(mixed.workspaceChanged).toBeNull();
		expect(mixedReceipts).toMatchObject([
			{
				kind: "stale-result-intent-batch",
				disposition: "rejected-before-tool-execution",
			},
		]);
		expect(mixedFixture.verifierCalls.count).toBe(0);

		const safeFixture = await createClosedHostFixture({
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/grep",
			argv: ["-q", "fixed", "README.md"],
		});
		const safe = await runClosedTaskProfileHost({
			frozen: safeFixture.frozen,
			qualificationReport: safeFixture.report,
			initialRequest: safeFixture.initialRequest,
			taskProfile: safeFixture.taskProfile,
			materialization: safeFixture.materialization,
			modelTurnPort: scriptedPort(safeFixture, (request) =>
				request.stepIndex === 0
					? {
							finishReason: "tool-intents",
							toolIntents: [
								intent(20, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
									baseContentDigest: empiricalSha256(encoder.encode("broken-placeholder-value\n")),
									newText: "fixed",
									oldText: "broken-placeholder-value",
									path: "README.md",
								}),
								intent(21, CLOSED_ACTOR_TOOL_REFS.workspaceDiff, {}),
								intent(22, CLOSED_ACTOR_TOOL_REFS.runCommand, {
									commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
								}),
							],
						}
					: {
							finishReason: "structured-output",
							structuredOutput: {
								kind: "model-turn-output-placeholder",
								summary: "safe ordered D695 multi-intent",
							},
						},
			),
			continuationModelTurnPort: Object.freeze({
				async invoke() {
					throw new TypeError("safe D695 multi-intent must not require continuation");
				},
			}),
			protectionExecutor: safeFixture.protectionExecutor,
			verifier: safeFixture.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: policy,
			signal: new AbortController().signal,
		});
		expect(safe).toMatchObject({ status: "completed", verifierVerdict: "passed" });
		expect(safe.toolActionCount).toBe(3);
	}, 30_000);

	it("retains exact D695 inspection history across A-B-A and same-state commands", async () => {
		const validationCommand = {
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/true",
			argv: [],
		} as const;
		const policy = strictSnapshot({
			schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.noProgressContinuationPolicy,
			policyRef: "no-progress.d695.historical-transfer",
			policyRevision: "decision.D695.2026-08-08.v1",
			maxRetainedToolResults: 16,
			maxRetainedBytes: 131_072,
			maxRejectedTerminals: 2,
			maxSemanticDuplicateRejections: 1,
			maxInspectionBatchesPerState: 16,
		}) satisfies ClosedNoProgressContinuationPolicyV1;
		const aBaFixture = await createClosedHostFixture(validationCommand);
		const aBa = await runClosedTaskProfileHost({
			frozen: aBaFixture.frozen,
			qualificationReport: aBaFixture.report,
			initialRequest: aBaFixture.initialRequest,
			taskProfile: aBaFixture.taskProfile,
			materialization: aBaFixture.materialization,
			modelTurnPort: scriptedPort(aBaFixture, (request) =>
				request.stepIndex === 0 || request.stepIndex === 2
					? {
							finishReason: "tool-intents",
							toolIntents: [
								intent(request.stepIndex, CLOSED_ACTOR_TOOL_REFS.readFile, {
									path: "README.md",
								}),
							],
						}
					: {
							finishReason: "tool-intents",
							toolIntents: [
								intent(1, CLOSED_ACTOR_TOOL_REFS.searchLiteral, {
									maxMatches: 8,
									path: "README.md",
									query: "broken",
								}),
							],
						},
			),
			continuationModelTurnPort: Object.freeze({
				async invoke() {
					throw new TypeError("D695 A-B-A must stop before continuation");
				},
			}),
			protectionExecutor: aBaFixture.protectionExecutor,
			verifier: aBaFixture.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: policy,
			signal: new AbortController().signal,
		});
		expect(aBa.issueCodes).toEqual(["repeated-inspection-turn-no-progress"]);
		expect(aBa.toolActionCount).toBe(2);

		const commandFixture = await createClosedHostFixture([
			validationCommand,
			{ commandRef: "actor.noop", executable: "/usr/bin/true", argv: [] },
		]);
		const command = await runClosedTaskProfileHost({
			frozen: commandFixture.frozen,
			qualificationReport: commandFixture.report,
			initialRequest: commandFixture.initialRequest,
			taskProfile: commandFixture.taskProfile,
			materialization: commandFixture.materialization,
			modelTurnPort: scriptedPort(commandFixture, (request) =>
				request.stepIndex === 1
					? {
							finishReason: "tool-intents",
							toolIntents: [
								intent(1, CLOSED_ACTOR_TOOL_REFS.runCommand, {
									commandRef: "actor.noop",
								}),
							],
						}
					: {
							finishReason: "tool-intents",
							toolIntents: [
								intent(request.stepIndex, CLOSED_ACTOR_TOOL_REFS.readFile, {
									path: "README.md",
								}),
							],
						},
			),
			continuationModelTurnPort: Object.freeze({
				async invoke() {
					throw new TypeError("D695 same-state command must not clear inspection history");
				},
			}),
			protectionExecutor: commandFixture.protectionExecutor,
			verifier: commandFixture.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: policy,
			signal: new AbortController().signal,
		});
		expect(command.issueCodes).toEqual(["repeated-inspection-turn-no-progress"]);
		expect(command.toolActionCount).toBe(2);
	}, 30_000);

	it("fails D695 accessor and retained-result bounds before continuation dispatch", async () => {
		const validationCommand = {
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/true",
			argv: [],
		} as const;
		const fixture = await createClosedHostFixture(validationCommand);
		let getterHits = 0;
		let modelInvocations = 0;
		const accessorPolicy: Record<string, unknown> = {
			schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.noProgressContinuationPolicy,
			policyRef: "no-progress.d695.historical-transfer",
			policyRevision: "decision.D695.2026-08-08.v1",
			maxRetainedToolResults: 16,
			maxRetainedBytes: 131_072,
			maxRejectedTerminals: 2,
			maxSemanticDuplicateRejections: 1,
		};
		Object.defineProperty(accessorPolicy, "maxInspectionBatchesPerState", {
			enumerable: true,
			get() {
				getterHits += 1;
				return 16;
			},
		});
		Object.freeze(accessorPolicy);
		await expect(
			runClosedTaskProfileHost({
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: fixture.materialization,
				modelTurnPort: {
					async invoke() {
						modelInvocations += 1;
						throw new TypeError("unexpected D695 accessor model invocation");
					},
				},
				continuationModelTurnPort: Object.freeze({
					async invoke() {
						throw new TypeError("unexpected D695 accessor continuation");
					},
				}),
				protectionExecutor: fixture.protectionExecutor,
				verifier: fixture.verifier,
				objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
				noProgressContinuationPolicy:
					accessorPolicy as unknown as ClosedNoProgressContinuationPolicyV1,
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("expected an own data property");
		expect(getterHits).toBe(0);
		expect(modelInvocations).toBe(0);

		const boundedFixture = await createClosedHostFixture(validationCommand);
		let continuationInvocations = 0;
		const boundedPolicy = strictSnapshot({
			schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.noProgressContinuationPolicy,
			policyRef: "no-progress.d695.historical-transfer",
			policyRevision: "decision.D695.2026-08-08.v1",
			maxRetainedToolResults: 16,
			maxRetainedBytes: 1,
			maxRejectedTerminals: 2,
			maxSemanticDuplicateRejections: 1,
			maxInspectionBatchesPerState: 16,
		}) satisfies ClosedNoProgressContinuationPolicyV1;
		const bounded = await runClosedTaskProfileHost({
			frozen: boundedFixture.frozen,
			qualificationReport: boundedFixture.report,
			initialRequest: boundedFixture.initialRequest,
			taskProfile: boundedFixture.taskProfile,
			materialization: boundedFixture.materialization,
			modelTurnPort: scriptedPort(boundedFixture, (request) =>
				request.stepIndex === 0
					? {
							finishReason: "tool-intents",
							toolIntents: [intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
						}
					: {
							finishReason: "structured-output",
							structuredOutput: {
								kind: "model-turn-output-placeholder",
								summary: "premature",
							},
						},
			),
			continuationModelTurnPort: Object.freeze({
				async invoke() {
					continuationInvocations += 1;
					throw new TypeError("D695 retained bound must stop before continuation");
				},
			}),
			protectionExecutor: boundedFixture.protectionExecutor,
			verifier: boundedFixture.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: boundedPolicy,
			signal: new AbortController().signal,
		});
		expect(bounded.issueCodes).toEqual(["no-progress-retained-result-byte-budget-exhausted"]);
		expect(continuationInvocations).toBe(0);

		const postRejectionFixture = await createClosedHostFixture(validationCommand);
		let postRejectionInvocations = 0;
		const postRejectionPolicy = strictSnapshot({
			...boundedPolicy,
			maxRetainedBytes: 64,
		}) satisfies ClosedNoProgressContinuationPolicyV1;
		const postRejection = await runClosedTaskProfileHost({
			frozen: postRejectionFixture.frozen,
			qualificationReport: postRejectionFixture.report,
			initialRequest: postRejectionFixture.initialRequest,
			taskProfile: postRejectionFixture.taskProfile,
			materialization: postRejectionFixture.materialization,
			modelTurnPort: scriptedPort(postRejectionFixture, () => ({
				finishReason: "structured-output",
				structuredOutput: {
					kind: "model-turn-output-placeholder",
					summary: "premature without results",
				},
			})),
			continuationModelTurnPort: Object.freeze({
				async invoke(request: EmpiricalModelTurnRequestV1) {
					postRejectionInvocations += 1;
					return completedOutcome(
						request,
						postRejectionFixture.frozen,
						postRejectionFixture.report,
						postRejectionFixture.protectionExecutor,
						{
							finishReason: "tool-intents",
							toolIntents: [intent(1, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
						},
					);
				},
			}),
			protectionExecutor: postRejectionFixture.protectionExecutor,
			verifier: postRejectionFixture.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: postRejectionPolicy,
			signal: new AbortController().signal,
		});
		expect(postRejection.issueCodes).toEqual(["no-progress-retained-result-byte-budget-exhausted"]);
		expect(postRejectionInvocations).toBe(1);
	}, 30_000);

	it("rejects D695 workspace drift during rejection and continuation model turns", async () => {
		const validationCommand = {
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/true",
			argv: [],
		} as const;
		const policy = strictSnapshot({
			schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.noProgressContinuationPolicy,
			policyRef: "no-progress.d695.historical-transfer",
			policyRevision: "decision.D695.2026-08-08.v1",
			maxRetainedToolResults: 16,
			maxRetainedBytes: 131_072,
			maxRejectedTerminals: 2,
			maxSemanticDuplicateRejections: 1,
			maxInspectionBatchesPerState: 16,
		}) satisfies ClosedNoProgressContinuationPolicyV1;
		const rejectionFixture = await createClosedHostFixture(validationCommand);
		let rejectionContinuationInvocations = 0;
		const rejectionDrift = await runClosedTaskProfileHost({
			frozen: rejectionFixture.frozen,
			qualificationReport: rejectionFixture.report,
			initialRequest: rejectionFixture.initialRequest,
			taskProfile: rejectionFixture.taskProfile,
			materialization: rejectionFixture.materialization,
			modelTurnPort: scriptedPort(rejectionFixture, (request) => {
				if (request.stepIndex === 0) {
					return {
						finishReason: "tool-intents",
						toolIntents: [intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
					};
				}
				writeFileSync(join(rejectionFixture.workspaceRoot, "README.md"), "external-drift\n");
				return {
					finishReason: "structured-output",
					structuredOutput: {
						kind: "model-turn-output-placeholder",
						summary: "premature",
					},
				};
			}),
			continuationModelTurnPort: Object.freeze({
				async invoke() {
					rejectionContinuationInvocations += 1;
					throw new TypeError("D695 rejection drift must stop before continuation");
				},
			}),
			protectionExecutor: rejectionFixture.protectionExecutor,
			verifier: rejectionFixture.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: policy,
			signal: new AbortController().signal,
		});
		expect(rejectionDrift.issueCodes).toEqual(["no-progress-retained-result-state-mismatch"]);
		expect(rejectionContinuationInvocations).toBe(0);

		const continuationFixture = await createClosedHostFixture(validationCommand);
		const continuationDrift = await runClosedTaskProfileHost({
			frozen: continuationFixture.frozen,
			qualificationReport: continuationFixture.report,
			initialRequest: continuationFixture.initialRequest,
			taskProfile: continuationFixture.taskProfile,
			materialization: continuationFixture.materialization,
			modelTurnPort: scriptedPort(continuationFixture, (request) =>
				request.stepIndex === 0
					? {
							finishReason: "tool-intents",
							toolIntents: [intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
						}
					: {
							finishReason: "structured-output",
							structuredOutput: {
								kind: "model-turn-output-placeholder",
								summary: "premature",
							},
						},
			),
			continuationModelTurnPort: Object.freeze({
				async invoke(request: EmpiricalModelTurnRequestV1) {
					writeFileSync(join(continuationFixture.workspaceRoot, "README.md"), "external-drift\n");
					return completedOutcome(
						request,
						continuationFixture.frozen,
						continuationFixture.report,
						continuationFixture.protectionExecutor,
						{
							finishReason: "tool-intents",
							toolIntents: [intent(2, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
						},
					);
				},
			}),
			protectionExecutor: continuationFixture.protectionExecutor,
			verifier: continuationFixture.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: policy,
			signal: new AbortController().signal,
		});
		expect(continuationDrift.issueCodes).toEqual(["no-progress-continuation-state-mismatch"]);
		expect(continuationDrift.toolActionCount).toBe(1);
		expect(continuationFixture.verifierCalls.count).toBe(0);

		const retryFixture = await createClosedHostFixture(validationCommand);
		let retryContinuationInvocations = 0;
		const retryDrift = await runClosedTaskProfileHost({
			frozen: retryFixture.frozen,
			qualificationReport: retryFixture.report,
			initialRequest: retryFixture.initialRequest,
			taskProfile: retryFixture.taskProfile,
			materialization: retryFixture.materialization,
			modelTurnPort: scriptedPort(retryFixture, (request) =>
				request.stepIndex === 0
					? {
							finishReason: "tool-intents",
							toolIntents: [intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
						}
					: {
							finishReason: "structured-output",
							structuredOutput: {
								kind: "model-turn-output-placeholder",
								summary: "premature",
							},
						},
			),
			continuationModelTurnPort: Object.freeze({
				async invoke(request: EmpiricalModelTurnRequestV1) {
					retryContinuationInvocations += 1;
					return nonEvaluableOutcome(
						request,
						retryFixture.frozen,
						retryFixture.report,
						retryFixture.protectionExecutor,
						["openrouter-error-type:provider_overloaded", "openrouter-http-status:503"],
						256,
					);
				},
			}),
			protectionExecutor: retryFixture.protectionExecutor,
			verifier: retryFixture.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: policy,
			retry: {
				maxAttemptsPerTurn: 2,
				retryDelayMs: () => 1,
				retryAdmissionIssueCodes: () => [],
				remainingElapsedMs: () => 10_000,
				wait: async () => {
					writeFileSync(join(retryFixture.workspaceRoot, "README.md"), "retry-drift\n");
					return 1;
				},
			},
			signal: new AbortController().signal,
		});
		expect(retryDrift.issueCodes).toEqual(["no-progress-continuation-state-mismatch"]);
		expect(retryContinuationInvocations).toBe(1);
		expect(retryFixture.verifierCalls.count).toBe(0);
	}, 30_000);

	it("lowers only host-issued D695 capsules through the actual OpenRouter wire", async () => {
		const validationCommand = {
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/grep",
			argv: ["-q", "fixed", "README.md"],
		} as const;
		const fixture = await createClosedHostFixture(
			validationCommand,
			undefined,
			"deepseek-v4-flash-high",
		);
		const routeQualification = simulatedRouteQualification(fixture, {
			maxRequests: 8,
			maxStepsPerRun: 8,
			maxInputTokens: 600_000,
			maxOutputTokens: 49_152,
		});
		const baseContentDigest = empiricalSha256(encoder.encode("broken-placeholder-value\n"));
		const expectedToolChoices = ["required", "auto", "required", "required", "required", "none"];
		const envelopeSchemas: string[] = [];
		let transportCalls = 0;
		const transport: OpenRouterResponsesByteTransportV1 = {
			async request(input) {
				const callIndex = transportCalls;
				transportCalls += 1;
				const body = JSON.parse(new TextDecoder().decode(input.body)) as {
					readonly tool_choice: string;
					readonly messages: readonly { readonly role: string; readonly content: string }[];
					readonly tools: readonly { readonly function: { readonly name: string } }[];
				};
				expect(body.tool_choice).toBe(expectedToolChoices[callIndex]);
				const userMessage = body.messages.find((message) => message.role === "user");
				if (userMessage === undefined) throw new TypeError("missing D695 user envelope");
				const envelope = JSON.parse(userMessage.content) as {
					readonly schemaVersion: string;
					readonly hostContinuation?: {
						readonly reason: string;
						readonly requiredDisposition: string;
						readonly retainedToolResultCount: number;
					};
				};
				envelopeSchemas.push(envelope.schemaVersion);
				if (callIndex < 2) {
					expect(envelope).not.toHaveProperty("hostContinuation");
				} else {
					expect(envelope.hostContinuation?.reason).toBe("premature-structured-output");
				}
				const toolNames = body.tools.map((tool) => tool.function.name);
				const output =
					callIndex === 0
						? [
								{
									type: "function_call",
									status: "completed",
									call_id: "call.d695.read",
									name: toolNames[0],
									arguments: JSON.stringify({ path: "README.md" }),
								},
							]
						: callIndex === 1
							? [
									{
										type: "message",
										role: "assistant",
										status: "completed",
										content: [
											{
												type: "output_text",
												text: JSON.stringify({
													kind: "model-turn-output-placeholder",
													summary: "premature",
												}),
											},
										],
									},
								]
							: callIndex === 2
								? [
										{
											type: "function_call",
											status: "completed",
											call_id: "call.d695.replace",
											name: toolNames[2],
											arguments: JSON.stringify({
												baseContentDigest,
												newText: "fixed",
												oldText: "broken-placeholder-value",
												path: "README.md",
											}),
										},
									]
								: callIndex === 3
									? [
											{
												type: "function_call",
												status: "completed",
												call_id: "call.d695.diff",
												name: toolNames[3],
												arguments: "{}",
											},
										]
									: callIndex === 4
										? [
												{
													type: "function_call",
													status: "completed",
													call_id: "call.d695.command",
													name: toolNames[4],
													arguments: JSON.stringify({
														commandRef: validationCommand.commandRef,
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
																summary: "verified",
															}),
														},
													],
												},
											];
				return dryRunOpenRouterResponse(`response.d695.${transportCalls}`, output, undefined, {
					requestModel: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
					downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
				});
			},
		};
		let measurement = 0;
		const binding = createOpenRouterResponsesEmpiricalBinding({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			configurationRef: fixture.initialRequest.configurationRef,
			routeQualification,
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: "d695-wire-credential-placeholder",
			},
			transport,
			transportAdmission: { admit: () => true },
			monotonicMeasurement: { readMs: () => (measurement += 1) },
		});
		const continuationCaptures: {
			readonly request: EmpiricalModelTurnRequestV1;
			readonly continuation: ClosedHostContinuationV1;
		}[] = [];
		const forwardingContinuationPort: ClosedContinuationModelTurnPortV1 = Object.freeze({
			async invoke(
				request: EmpiricalModelTurnRequestV1,
				continuation: ClosedHostContinuationV1,
				signal: AbortSignal,
			) {
				if (continuationCaptures.length === 0) {
					continuationCaptures.push({ request, continuation });
				}
				return binding.continuationModelTurnPort.invoke(request, continuation, signal);
			},
		});
		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: binding.modelTurnPort,
			continuationModelTurnPort: forwardingContinuationPort,
			protectionExecutor: binding.protectionExecutor,
			verifier: fixture.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: D695_NO_PROGRESS_CONTINUATION_POLICY,
			signal: new AbortController().signal,
		});
		expect(outcome).toMatchObject({ status: "completed", verifierVerdict: "passed" });
		expect(transportCalls).toBe(6);
		expect(envelopeSchemas.slice(0, 2)).toEqual([
			"graphrefly.private-solution-eval.openrouter-user-envelope.v2",
			"graphrefly.private-solution-eval.openrouter-user-envelope.v2",
		]);
		expect(new Set(envelopeSchemas.slice(2))).toEqual(
			new Set(["graphrefly.private-solution-eval.openrouter-user-envelope.d695.v1"]),
		);
		const captured = continuationCaptures[0];
		if (captured === undefined) {
			throw new TypeError("D695 host did not issue a continuation request");
		}
		const substitutedRequest = validateEmpiricalModelTurnRequest(
			{
				...captured.request,
				requestRef: `${captured.request.requestRef}.substituted`,
			},
			fixture.frozen,
			fixture.report,
		);
		await expect(
			binding.continuationModelTurnPort.invoke(
				substitutedRequest,
				captured.continuation,
				new AbortController().signal,
			),
		).rejects.toThrow("OpenRouter continuation was not issued by the closed host");
		expect(transportCalls).toBe(6);
	}, 30_000);

	it("runs one D702 mutation-first recovery and lowers it to exact named tool_choice", async () => {
		const validationCommand = {
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/grep",
			argv: ["-q", "fixed", "README.md"],
		} as const;
		const fixture = await createClosedHostFixture(
			validationCommand,
			undefined,
			"deepseek-v4-flash-high",
		);
		const routeQualification = simulatedRouteQualification(fixture, {
			maxRequests: 10,
			maxStepsPerRun: 10,
			maxInputTokens: 600_000,
			maxOutputTokens: 65_536,
		});
		const baseContentDigest = empiricalSha256(encoder.encode("broken-placeholder-value\n"));
		let transportCalls = 0;
		const transport: OpenRouterResponsesByteTransportV1 = {
			async request(input) {
				const callIndex = transportCalls++;
				const body = JSON.parse(new TextDecoder().decode(input.body)) as {
					readonly tool_choice:
						| string
						| { readonly type: string; readonly function: { readonly name: string } };
					readonly messages: readonly { readonly role: string; readonly content: string }[];
					readonly tools: readonly { readonly function: { readonly name: string } }[];
				};
				const toolNames = body.tools.map((tool) => tool.function.name);
				if (callIndex === 3) {
					expect(body.tool_choice).toEqual({
						type: "function",
						function: { name: toolNames[2] },
					});
					const user = body.messages.find((message) => message.role === "user");
					if (user === undefined) throw new TypeError("missing D702 user envelope");
					const envelope = JSON.parse(user.content) as {
						readonly schemaVersion: string;
						readonly hostContinuation: {
							readonly reason: string;
							readonly requiredFirstToolRef: string;
						};
					};
					expect(envelope).toMatchObject({
						schemaVersion: "graphrefly.private-solution-eval.openrouter-user-envelope.d702.v1",
						hostContinuation: {
							reason: "stale-result-intent-batch",
							requiredFirstToolRef: CLOSED_ACTOR_TOOL_REFS.replaceExact,
						},
					});
				}
				const output =
					callIndex === 0
						? [
								{
									type: "function_call",
									status: "completed",
									call_id: "call.d702.read",
									name: toolNames[0],
									arguments: JSON.stringify({ path: "README.md" }),
								},
							]
						: callIndex === 1
							? [
									{
										type: "message",
										role: "assistant",
										status: "completed",
										content: [
											{
												type: "output_text",
												text: JSON.stringify({
													kind: "model-turn-output-placeholder",
													summary: "premature",
												}),
											},
										],
									},
								]
							: callIndex === 2
								? [
										{
											type: "function_call",
											status: "completed",
											call_id: "call.d702.stale-read",
											name: toolNames[0],
											arguments: JSON.stringify({ path: "README.md" }),
										},
										{
											type: "function_call",
											status: "completed",
											call_id: "call.d702.stale-replace",
											name: toolNames[2],
											arguments: JSON.stringify({
												baseContentDigest,
												newText: "fixed",
												oldText: "broken-placeholder-value",
												path: "README.md",
											}),
										},
									]
								: callIndex === 3
									? [
											{
												type: "function_call",
												status: "completed",
												call_id: "call.d702.replace",
												name: toolNames[2],
												arguments: JSON.stringify({
													baseContentDigest,
													newText: "fixed",
													oldText: "broken-placeholder-value",
													path: "README.md",
												}),
											},
										]
									: callIndex === 4
										? [
												{
													type: "function_call",
													status: "completed",
													call_id: "call.d702.diff",
													name: toolNames[3],
													arguments: "{}",
												},
											]
										: callIndex === 5
											? [
													{
														type: "function_call",
														status: "completed",
														call_id: "call.d702.command",
														name: toolNames[4],
														arguments: JSON.stringify({
															commandRef: validationCommand.commandRef,
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
																	summary: "verified",
																}),
															},
														],
													},
												];
				return dryRunOpenRouterResponse(`response.d702.${transportCalls}`, output, undefined, {
					requestModel: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
					downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
				});
			},
		};
		let measurement = 0;
		const binding = createOpenRouterResponsesEmpiricalBinding({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			configurationRef: fixture.initialRequest.configurationRef,
			routeQualification,
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: "d702-wire-credential-placeholder",
			},
			transport,
			transportAdmission: { admit: () => true },
			monotonicMeasurement: { readMs: () => (measurement += 1) },
		});
		let capturedMutationFirst:
			| {
					readonly request: EmpiricalModelTurnRequestV1;
					readonly continuation: ClosedMutationFirstContinuationV1;
			  }
			| undefined;
		const forwardingMutationFirstPort: ClosedMutationFirstContinuationModelTurnPortV1 =
			Object.freeze({
				async invoke(
					request: EmpiricalModelTurnRequestV1,
					continuation: ClosedMutationFirstContinuationV1,
					signal: AbortSignal,
				) {
					capturedMutationFirst ??= { request, continuation };
					return binding.mutationFirstContinuationModelTurnPort.invoke(
						request,
						continuation,
						signal,
					);
				},
			});
		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: binding.modelTurnPort,
			continuationModelTurnPort: binding.continuationModelTurnPort,
			mutationFirstContinuationModelTurnPort: forwardingMutationFirstPort,
			protectionExecutor: binding.protectionExecutor,
			verifier: fixture.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: D695_NO_PROGRESS_CONTINUATION_POLICY,
			staleResultRecoveryPolicy: D702_STALE_RESULT_RECOVERY_POLICY,
			signal: new AbortController().signal,
		});
		expect(outcome).toMatchObject({ status: "completed", verifierVerdict: "passed" });
		expect(outcome.actionTrace.map((entry) => entry.toolRef)).toEqual([
			CLOSED_ACTOR_TOOL_REFS.readFile,
			CLOSED_ACTOR_TOOL_REFS.replaceExact,
			CLOSED_ACTOR_TOOL_REFS.workspaceDiff,
			CLOSED_ACTOR_TOOL_REFS.runCommand,
		]);
		expect(transportCalls).toBe(7);
		expect(
			sameClosedMutationFirstState(
				{ digest: "sha256:collision", canonicalBytes: encoder.encode("d702-left") },
				{ digest: "sha256:collision", canonicalBytes: encoder.encode("d702-right") },
			),
		).toBe(false);
		if (capturedMutationFirst === undefined) {
			throw new TypeError("D702 host did not issue mutation-first continuation");
		}
		await expect(
			binding.mutationFirstContinuationModelTurnPort.invoke(
				capturedMutationFirst.request,
				strictSnapshot(capturedMutationFirst.continuation),
				new AbortController().signal,
			),
		).rejects.toThrow("not issued by the closed host");
		await expect(
			binding.mutationFirstContinuationModelTurnPort.invoke(
				strictSnapshot({
					...capturedMutationFirst.request,
					stepIndex: capturedMutationFirst.request.stepIndex + 1,
				}),
				capturedMutationFirst.continuation,
				new AbortController().signal,
			),
		).rejects.toThrow("not issued by the closed host");
		expect(transportCalls).toBe(7);
	}, 30_000);

	it("lowers D702 named tool_choice with the Responses endpoint shape", async () => {
		const validationCommand = {
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/grep",
			argv: ["-q", "fixed", "README.md"],
		} as const;
		const fixture = await createClosedHostFixture(validationCommand);
		const routeQualification = simulatedRouteQualification(fixture, {
			maxRequests: 8,
			maxStepsPerRun: 8,
			maxInputTokens: 100_000,
			maxOutputTokens: 8_192,
		});
		let transportCalls = 0;
		const binding = createOpenRouterResponsesEmpiricalBinding({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			configurationRef: fixture.initialRequest.configurationRef,
			routeQualification,
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: "d702-responses-wire-placeholder",
			},
			transport: {
				async request(input) {
					transportCalls += 1;
					const body = JSON.parse(new TextDecoder().decode(input.body)) as {
						readonly tool_choice: { readonly type: string; readonly name: string };
						readonly tools: readonly { readonly name: string }[];
					};
					expect(body.tool_choice).toEqual({
						type: "function",
						name: body.tools[2]?.name,
					});
					writeFileSync(join(fixture.workspaceRoot, "README.md"), "d702-external-drift\n", {
						mode: 0o644,
					});
					return dryRunOpenRouterResponse("response.d702.responses", [
						{
							type: "function_call",
							status: "completed",
							call_id: "call.d702.responses.replace",
							name: body.tools[2]?.name,
							arguments: JSON.stringify({
								baseContentDigest: empiricalSha256(encoder.encode("broken-placeholder-value\n")),
								newText: "fixed",
								oldText: "broken-placeholder-value",
								path: "README.md",
							}),
						},
					]);
				},
			},
			transportAdmission: { admit: () => true },
			monotonicMeasurement: { readMs: () => transportCalls },
		});
		const basePort = scriptedPort(fixture, () => ({
			finishReason: "structured-output",
			structuredOutput: { kind: "model-turn-output-placeholder", summary: "early" },
		}));
		const continuationPort: ClosedContinuationModelTurnPortV1 = Object.freeze({
			async invoke(request: EmpiricalModelTurnRequestV1) {
				if (request.stepIndex !== 1) {
					return nonEvaluableOutcome(
						request,
						fixture.frozen,
						fixture.report,
						fixture.protectionExecutor,
						["d702-script-complete"],
						64,
					);
				}
				return completedOutcome(
					request,
					fixture.frozen,
					fixture.report,
					fixture.protectionExecutor,
					{
						finishReason: "tool-intents",
						toolIntents: [
							intent(20, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" }),
							intent(21, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
								baseContentDigest: empiricalSha256(encoder.encode("broken-placeholder-value\n")),
								newText: "fixed",
								oldText: "broken-placeholder-value",
								path: "README.md",
							}),
						],
					},
				);
			},
		});
		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			modelTurnPort: basePort,
			continuationModelTurnPort: continuationPort,
			mutationFirstContinuationModelTurnPort: binding.mutationFirstContinuationModelTurnPort,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: D695_NO_PROGRESS_CONTINUATION_POLICY,
			staleResultRecoveryPolicy: D702_STALE_RESULT_RECOVERY_POLICY,
			signal: new AbortController().signal,
		});
		expect(outcome).toMatchObject({
			status: "non-evaluable",
			toolActionCount: 0,
			verifierVerdict: null,
			issueCodes: ["no-progress-continuation-state-mismatch"],
		});
		expect(transportCalls).toBe(1);
	}, 30_000);

	it("stops D702 retry dispatch when the exact recovery workspace state drifts", async () => {
		const fixture = await createClosedHostFixture({
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/true",
			argv: [],
		});
		let recoveryInvocations = 0;
		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: scriptedPort(fixture, (request) =>
				request.stepIndex === 0
					? {
							finishReason: "tool-intents",
							toolIntents: [intent(0, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" })],
						}
					: {
							finishReason: "structured-output",
							structuredOutput: {
								kind: "model-turn-output-placeholder",
								summary: "premature",
							},
						},
			),
			continuationModelTurnPort: Object.freeze({
				async invoke(request: EmpiricalModelTurnRequestV1) {
					return completedOutcome(
						request,
						fixture.frozen,
						fixture.report,
						fixture.protectionExecutor,
						{
							finishReason: "tool-intents",
							toolIntents: [
								intent(20, CLOSED_ACTOR_TOOL_REFS.readFile, { path: "README.md" }),
								intent(21, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
									baseContentDigest: empiricalSha256(encoder.encode("broken-placeholder-value\n")),
									newText: "fixed",
									oldText: "broken-placeholder-value",
									path: "README.md",
								}),
							],
						},
					);
				},
			}),
			mutationFirstContinuationModelTurnPort: Object.freeze({
				async invoke(request: EmpiricalModelTurnRequestV1) {
					recoveryInvocations += 1;
					return nonEvaluableOutcome(
						request,
						fixture.frozen,
						fixture.report,
						fixture.protectionExecutor,
						["openrouter-error-type:provider_overloaded", "openrouter-http-status:503"],
						256,
					);
				},
			}),
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: D695_NO_PROGRESS_CONTINUATION_POLICY,
			staleResultRecoveryPolicy: D702_STALE_RESULT_RECOVERY_POLICY,
			retry: {
				maxAttemptsPerTurn: 2,
				retryDelayMs: () => 1,
				retryAdmissionIssueCodes: () => [],
				remainingElapsedMs: () => 10_000,
				wait: async () => {
					writeFileSync(join(fixture.workspaceRoot, "README.md"), "d702-retry-drift\n");
					return 1;
				},
			},
			signal: new AbortController().signal,
		});
		expect(outcome).toMatchObject({
			status: "non-evaluable",
			toolActionCount: 1,
			verifierVerdict: null,
			issueCodes: ["no-progress-continuation-state-mismatch"],
		});
		expect(recoveryInvocations).toBe(1);
	}, 30_000);

	it("qualifies and atomically persists D702 without provider or network calls", async () => {
		const validationCommand = {
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/grep",
			argv: ["-q", "fixed", "README.md"],
		} as const;
		const otherCommand = {
			commandRef: "actor.status",
			executable: "/usr/bin/git",
			argv: ["status", "--porcelain=v1"],
		} as const;
		const plan = strictSnapshot({
			readPaths: ["README.md"],
			writablePath: "README.md",
			initialContentDigest: empiricalSha256(encoder.encode("broken-placeholder-value\n")),
			initialOldText: "broken-placeholder-value",
			acceptedNewText: "fixed",
			rejectedNewText: "wrong",
			acceptedContentDigest: empiricalSha256(encoder.encode("fixed\n")),
			validationCommandRef: validationCommand.commandRef,
			otherCommandRef: otherCommand.commandRef,
		});
		const reports: D702CaseReportV1[] = [];
		for (const [index, caseRef] of D702_CASE_ORDER.entries()) {
			const genericFixture = index === 1 || index === 2;
			const sourceContent =
				index === 1
					? "generic-alpha-placeholder\n"
					: index === 2
						? "generic-beta-placeholder\n"
						: "broken-placeholder-value\n";
			const expectedContent =
				index === 1 ? "generic-alpha-fixed\n" : index === 2 ? "generic-beta-fixed\n" : "fixed\n";
			const caseValidationCommand = genericFixture
				? {
						...validationCommand,
						argv: ["-q", expectedContent.trim(), "README.md"],
					}
				: validationCommand;
			const fixture = await createClosedHostFixture(
				[caseValidationCommand, otherCommand],
				sourceContent,
				"gpt-5.6-sol-medium",
				"smoke",
				false,
				genericFixture ? `task.d702.generic-${index}` : "task.d702.historical-shaped",
				expectedContent,
			);
			const casePlan = genericFixture
				? strictSnapshot({
						...plan,
						initialContentDigest: empiricalSha256(encoder.encode(sourceContent)),
						initialOldText: sourceContent.trim(),
						acceptedNewText: expectedContent.trim(),
						acceptedContentDigest: empiricalSha256(encoder.encode(expectedContent)),
					})
				: plan;
			reports.push(
				await runD702OfflineCase({
					caseRef,
					host: {
						frozen: fixture.frozen,
						initialRequest: fixture.initialRequest,
						materialization: fixture.materialization,
						protectionExecutor: fixture.protectionExecutor,
						qualificationReport: fixture.report,
						taskProfile: fixture.taskProfile,
					},
					plan: casePlan,
					signal: new AbortController().signal,
				}),
			);
		}
		const qualification = createD702OfflineQualification(reports);
		expect(qualification).toMatchObject({
			qualified: true,
			providerCallCount: 0,
			networkCallCount: 0,
			chargedCostMicrousd: 0,
			causalAttribution: "undetermined",
			efficacyClaim: "none",
		});
		expect(validateD702OfflineQualification(qualification)).toEqual(qualification);
		expect(() =>
			createD702OfflineQualification(reports.map((report) => strictSnapshot(report))),
		).toThrow("closed-host-produced reports");
		const operatorRoot = temporaryRoot("d702-private");
		const privateParent = join(operatorRoot, ".private");
		const privateRoot = join(privateParent, "empirical-memory-rerun-avoidance");
		mkdirSync(privateParent, { mode: 0o700 });
		mkdirSync(privateRoot, { mode: 0o700 });
		chmodSync(privateRoot, 0o700);
		try {
			const protectionExecutor = createEmpiricalExactPrivateNeedleProtectionExecutor({
				policyRef: "policy.d702.private",
				policyRevision: "policy.d702.private.v1",
				protectedNeedleCapabilityRef: "capability.d702.private",
				protectedNeedleCapabilityRevision: "capability.d702.private.v1",
				protectedNeedles: ["D702_PRIVATE_SENTINEL_2026"],
			});
			const persisted = await persistD702OfflineQualification({
				privateRoot,
				generationRef: "d702-qualified",
				qualification,
				protectionExecutor,
			});
			expect(statSync(persisted.generationPath).mode & 0o777).toBe(0o700);
			for (const file of readdirSync(persisted.generationPath)) {
				expect(statSync(join(persisted.generationPath, file)).mode & 0o777).toBe(0o600);
				expect(readFileSync(join(persisted.generationPath, file), "utf8")).not.toContain(
					"D702_PRIVATE_SENTINEL_2026",
				);
			}
			await expect(
				persistD702OfflineQualification({
					privateRoot,
					generationRef: "d702-qualified",
					qualification,
					protectionExecutor,
				}),
			).rejects.toThrow("already exists");
			expect(
				readdirSync(privateRoot).filter((entry) => entry.startsWith(".d702-staging-")),
			).toEqual([]);
		} finally {
			rmSync(operatorRoot, { recursive: true, force: true });
		}
	}, 30_000);

	it("rejects accessor or widened D702 policy before model dispatch", async () => {
		const fixture = await createClosedHostFixture({
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/true",
			argv: [],
		});
		let getterHits = 0;
		let modelCalls = 0;
		const input = {
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: Object.freeze({
				async invoke() {
					modelCalls += 1;
					throw new TypeError("unexpected D702 model invocation");
				},
			}),
			continuationModelTurnPort: Object.freeze({ async invoke() {} }),
			mutationFirstContinuationModelTurnPort: Object.freeze({ async invoke() {} }),
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: D695_NO_PROGRESS_CONTINUATION_POLICY,
			signal: new AbortController().signal,
		} as unknown as ClosedTaskProfileHostRunInputV1;
		Object.defineProperty(input, "staleResultRecoveryPolicy", {
			enumerable: true,
			get() {
				getterHits += 1;
				return D702_STALE_RESULT_RECOVERY_POLICY;
			},
		});
		await expect(runClosedTaskProfileHost(input)).rejects.toThrow(
			"expected an own enumerable data property",
		);
		expect(getterHits).toBe(0);
		expect(modelCalls).toBe(0);

		const substitutedObjectivePolicy = strictSnapshot({
			...D693_ASSISTED_PROGRESS_POLICY,
			policyRevision: "decision.D693.substituted",
		});
		const substitutedNoProgressPolicy = strictSnapshot({
			...D695_NO_PROGRESS_CONTINUATION_POLICY,
			maxRetainedBytes: D695_NO_PROGRESS_CONTINUATION_POLICY.maxRetainedBytes - 1,
		});
		const policySubstitutions = [
			{
				objective: substitutedObjectivePolicy,
				noProgress: D695_NO_PROGRESS_CONTINUATION_POLICY,
				stale: strictSnapshot({
					...D702_STALE_RESULT_RECOVERY_POLICY,
					objectiveProgressPolicyDigest: empiricalStrictJsonDigest(substitutedObjectivePolicy),
				}),
			},
			{
				objective: D693_ASSISTED_PROGRESS_POLICY,
				noProgress: substitutedNoProgressPolicy,
				stale: strictSnapshot({
					...D702_STALE_RESULT_RECOVERY_POLICY,
					noProgressContinuationPolicyDigest: empiricalStrictJsonDigest(
						substitutedNoProgressPolicy,
					),
				}),
			},
			{
				objective: D693_ASSISTED_PROGRESS_POLICY,
				noProgress: D695_NO_PROGRESS_CONTINUATION_POLICY,
				stale: strictSnapshot({
					...D702_STALE_RESULT_RECOVERY_POLICY,
					policyRevision: "decision.D702.substituted",
				}),
			},
			{
				objective: D693_ASSISTED_PROGRESS_POLICY,
				noProgress: D695_NO_PROGRESS_CONTINUATION_POLICY,
				stale: strictSnapshot({
					...D702_STALE_RESULT_RECOVERY_POLICY,
					maxWorkspaceStateBytes: D702_STALE_RESULT_RECOVERY_POLICY.maxWorkspaceStateBytes - 1,
				}),
			},
		];
		for (const substitution of policySubstitutions) {
			const substitutedFixture = await createClosedHostFixture({
				commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
				executable: "/usr/bin/true",
				argv: [],
			});
			let substitutedModelCalls = 0;
			await expect(
				runClosedTaskProfileHost({
					frozen: substitutedFixture.frozen,
					qualificationReport: substitutedFixture.report,
					initialRequest: substitutedFixture.initialRequest,
					taskProfile: substitutedFixture.taskProfile,
					materialization: substitutedFixture.materialization,
					modelTurnPort: Object.freeze({
						async invoke() {
							substitutedModelCalls += 1;
							throw new TypeError("unexpected D702 substituted-policy dispatch");
						},
					}),
					continuationModelTurnPort: Object.freeze({
						async invoke() {
							throw new TypeError("unexpected D702 continuation dispatch");
						},
					}),
					mutationFirstContinuationModelTurnPort: Object.freeze({
						async invoke() {
							throw new TypeError("unexpected D702 mutation-first dispatch");
						},
					}),
					protectionExecutor: substitutedFixture.protectionExecutor,
					verifier: substitutedFixture.verifier,
					objectiveProgressPolicy: substitution.objective,
					noProgressContinuationPolicy: substitution.noProgress,
					staleResultRecoveryPolicy: substitution.stale,
					signal: new AbortController().signal,
				}),
			).rejects.toThrow("does not match D702");
			expect(substitutedModelCalls).toBe(0);
		}
	}, 30_000);

	it("persists one canonical material-free D695 no-network qualification atomically", async () => {
		const validationCommand = {
			commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
			executable: "/usr/bin/grep",
			argv: ["-q", "fixed", "README.md"],
		} as const;
		const otherCommand = {
			commandRef: "actor.status",
			executable: "/usr/bin/git",
			argv: ["status", "--porcelain=v1"],
		} as const;
		const fixture = await createClosedHostFixture([validationCommand, otherCommand]);
		const plan = strictSnapshot({
			readPaths: ["README.md"],
			writablePath: "README.md",
			initialContentDigest: empiricalSha256(encoder.encode("broken-placeholder-value\n")),
			initialOldText: "broken-placeholder-value",
			acceptedNewText: "fixed",
			rejectedNewText: "still-broken",
			acceptedContentDigest: empiricalSha256(encoder.encode("fixed\n")),
			validationCommandRef: validationCommand.commandRef,
			otherCommandRef: otherCommand.commandRef,
		});
		let forgedRootGetterHits = 0;
		let forgedCleanupHits = 0;
		const forgedWorkspace = { kind: fixture.materialization.workspace.kind } as Record<
			string,
			unknown
		>;
		Object.defineProperty(forgedWorkspace, "rootPathForHostRunner", {
			enumerable: true,
			get() {
				forgedRootGetterHits += 1;
				return () => fixture.workspaceRoot;
			},
		});
		await expect(
			runD695OfflineCase({
				caseRef: D695_CASE_ORDER[0],
				host: {
					frozen: fixture.frozen,
					qualificationReport: fixture.report,
					initialRequest: fixture.initialRequest,
					taskProfile: fixture.taskProfile,
					materialization: {
						workspace:
							forgedWorkspace as unknown as HistoryFreeSingleBaselineRepositoryMaterializationV1["workspace"],
						evidence: fixture.materialization.evidence,
						async cleanup() {
							forgedCleanupHits += 1;
						},
					},
					protectionExecutor: fixture.protectionExecutor,
				},
				plan,
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("trusted local single-baseline materialization");
		expect(forgedRootGetterHits).toBe(0);
		expect(forgedCleanupHits).toBe(0);
		const reports: Awaited<ReturnType<typeof runD695OfflineCase>>[] = [];
		for (const [index, caseRef] of D695_CASE_ORDER.entries()) {
			const materialization =
				index === 0
					? fixture.materialization
					: await fixture.prepareFreshMaterialization(new AbortController().signal);
			reports.push(
				await runD695OfflineCase({
					caseRef,
					host: {
						frozen: fixture.frozen,
						qualificationReport: fixture.report,
						initialRequest: fixture.initialRequest,
						taskProfile: fixture.taskProfile,
						materialization,
						protectionExecutor: fixture.protectionExecutor,
					},
					plan,
					signal: new AbortController().signal,
				}),
			);
		}
		expect(reports[3]).toMatchObject({
			caseRef: "safe-ordered-multiple-intent",
			hostStatus: "completed",
			verifierVerdict: "passed",
		});
		const qualification = createD695OfflineQualification(reports);
		expect(qualification).toMatchObject({
			qualified: true,
			feedbackRecoveryPassed: true,
			retainedResultsBound: true,
			repeatedInspectionStoppedBeforeExecution: true,
			multipleIntentStoppedBeforeExecution: true,
			safeOrderedMultipleIntentPassed: true,
			staleResultMultipleIntentStoppedBeforeExecution: true,
			mutationStateResetPassed: true,
			providerCallCount: 0,
			networkCallCount: 0,
			chargedCostMicrousd: 0,
			causalAttribution: "undetermined",
			efficacyClaim: "none",
		});
		expect(
			validateD695OfflineQualification(
				strictJsonCodec.decode(strictJsonCodec.encode(qualification)),
			),
		).toEqual(qualification);
		expect(() =>
			createD695OfflineQualification(reports.map((report) => strictSnapshot(report))),
		).toThrow("closed-host-produced reports");
		expect(() =>
			validateD695OfflineQualification({ ...qualification, efficacyClaim: "positive" }),
		).toThrow('expected "none"');

		const operatorRoot = temporaryRoot("d695-private");
		const privateParent = join(operatorRoot, ".private");
		const privateRoot = join(privateParent, "empirical-memory-rerun-avoidance");
		mkdirSync(privateParent, { mode: 0o700 });
		mkdirSync(privateRoot, { mode: 0o700 });
		chmodSync(privateRoot, 0o700);
		const persisted = await persistD695OfflineQualification({
			privateRoot,
			generationRef: "d695-no-progress-offline-v1",
			qualification,
			protectionExecutor: fixture.protectionExecutor,
		});
		expect(readdirSync(persisted.generationPath).sort()).toEqual([
			"generation.v1.json",
			"no-progress-continuation-qualification.v1.json",
		]);
		for (const file of readdirSync(persisted.generationPath)) {
			expect(statSync(join(persisted.generationPath, file)).mode & 0o777).toBe(0o600);
		}
		const serialized = JSON.stringify(
			JSON.parse(
				readFileSync(
					join(persisted.generationPath, "no-progress-continuation-qualification.v1.json"),
					"utf8",
				),
			),
		);
		expect(serialized).not.toContain("broken-placeholder-value");
		expect(serialized).not.toContain("fixed\n");
		await expect(
			persistD695OfflineQualification({
				privateRoot,
				generationRef: "d695-replay-forgery",
				qualification: validateD695OfflineQualification(
					strictJsonCodec.decode(strictJsonCodec.encode(qualification)),
				),
				protectionExecutor: fixture.protectionExecutor,
			}),
		).rejects.toThrow("same-process qualification");
		expect(() => statSync(join(privateRoot, "d695-replay-forgery"))).toThrow();

		const atomicRoot = temporaryRoot("d695-atomic");
		const stagingPath = join(atomicRoot, ".d695-staging-test");
		const finalPath = join(atomicRoot, "d695-final-test");
		mkdirSync(stagingPath, { mode: 0o700 });
		writeFileSync(join(stagingPath, "generation.v1.json"), "{}", { mode: 0o600 });
		let parentSyncCount = 0;
		await expect(
			commitD695PrivateGenerationAtomically(stagingPath, finalPath, atomicRoot, {
				rename: async (from, to) => {
					renameSync(from, to);
				},
				remove: async (path) => {
					rmSync(path, { recursive: true, force: true });
				},
				syncParent: async () => {
					parentSyncCount += 1;
					if (parentSyncCount === 1) throw new TypeError("injected D695 parent fsync failure");
				},
			}),
		).rejects.toThrow("injected D695 parent fsync failure");
		expect(parentSyncCount).toBe(2);
		expect(() => statSync(stagingPath)).toThrow();
		expect(() => statSync(finalPath)).toThrow();
	}, 30_000);

	it("fails a stale D682 exact-text proposal before mutation or verifier execution", async () => {
		const fixture = await createClosedHostFixture(
			undefined,
			undefined,
			"gpt-5.6-sol-medium",
			"smoke",
			true,
		);
		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: scriptedPort(fixture, () => ({
				finishReason: "tool-intents",
				toolIntents: [
					intent(0, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
						newText: "fixed",
						oldText: "stale-text-not-in-workspace",
						path: "README.md",
					}),
				],
			})),
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			signal: new AbortController().signal,
		});

		expect(outcome.status).toBe("non-evaluable");
		expect(outcome.issueCodes).toContain("exact-replacement-match-count-invalid");
		expect(outcome.toolActionCount).toBe(0);
		expect(outcome.workspaceChanged).toBeNull();
		expect(fixture.verifierCalls.count).toBe(0);
	});

	it("classifies the owned D682 per-run deadline separately from transport cancellation", async () => {
		const fixture = await createClosedHostFixture();
		const elapsed = new AbortController();
		let invocations = 0;
		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: {
				async invoke(request) {
					invocations += 1;
					elapsed.abort();
					return nonEvaluableOutcome(
						request,
						fixture.frozen,
						fixture.report,
						fixture.protectionExecutor,
						["openrouter-host-cancelled", "openrouter-unavailable-transport"],
						128,
					);
				},
			},
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			agentRunElapsedSignal: elapsed.signal,
			signal: elapsed.signal,
		});

		expect(invocations).toBe(1);
		expect(outcome.status).toBe("non-evaluable");
		expect(outcome.issueCodes).toEqual([
			"agent-run-elapsed-budget-exhausted",
			"model-turn-non-evaluable",
		]);
		expect(outcome.issueCodes).not.toContain("openrouter-unavailable-transport");
		expect(outcome.turnEvidence).toHaveLength(1);
		expect(outcome.turnEvidence[0]?.issueCodes).toEqual(["agent-run-elapsed-budget-exhausted"]);
	});

	it("accounts for a completed charged turn before classifying its owned elapsed deadline", async () => {
		const fixture = await createClosedHostFixture();
		const elapsed = new AbortController();
		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: {
				async invoke(request) {
					elapsed.abort();
					return completedOutcome(
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
			agentRunElapsedSignal: elapsed.signal,
			signal: elapsed.signal,
		});

		expect(outcome.status).toBe("non-evaluable");
		expect(outcome.issueCodes).toEqual(["agent-run-elapsed-budget-exhausted"]);
		expect(outcome.remoteRequests).toBe(1);
		expect(outcome.logicalStepCount).toBe(1);
		expect(outcome.attemptCount).toBe(1);
		expect(outcome.turnEvidence).toHaveLength(1);
		expect(outcome.turnEvidence[0]).toMatchObject({
			inputTokens: 10,
			outputTokens: 10,
			totalTokens: 20,
			requests: 1,
		});
		expect(fixture.verifierCalls.count).toBe(0);
	});

	it("accounts for a completed charged continuation before its owned elapsed deadline", async () => {
		const fixture = await createClosedHostFixture([
			{
				commandRef: D693_ASSISTED_PROGRESS_POLICY.validationCommandRef,
				executable: "/usr/bin/grep",
				argv: ["-q", "fixed", "README.md"],
			},
		]);
		const elapsed = new AbortController();
		const policy = strictSnapshot({
			schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.noProgressContinuationPolicy,
			policyRef: "no-progress.d695.elapsed-accounting",
			policyRevision: "decision.D695.2026-08-08.v1",
			maxRetainedToolResults: 16,
			maxRetainedBytes: 240_000,
			maxRejectedTerminals: 2,
			maxSemanticDuplicateRejections: 1,
			maxInspectionBatchesPerState: 16,
		}) satisfies ClosedNoProgressContinuationPolicyV1;
		let continuationInvocations = 0;
		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: scriptedPort(fixture, () => ({
				finishReason: "structured-output",
				structuredOutput: {
					kind: "model-turn-output-placeholder",
					summary: "premature",
				},
			})),
			continuationModelTurnPort: Object.freeze({
				async invoke(request: EmpiricalModelTurnRequestV1) {
					continuationInvocations += 1;
					elapsed.abort();
					return completedOutcome(
						request,
						fixture.frozen,
						fixture.report,
						fixture.protectionExecutor,
						{
							finishReason: "structured-output",
							structuredOutput: {
								kind: "model-turn-output-placeholder",
								summary: "still-premature",
							},
						},
					);
				},
			}),
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			objectiveProgressPolicy: D693_ASSISTED_PROGRESS_POLICY,
			noProgressContinuationPolicy: policy,
			agentRunElapsedSignal: elapsed.signal,
			signal: elapsed.signal,
		});

		expect(continuationInvocations).toBe(1);
		expect(outcome.status).toBe("non-evaluable");
		expect(outcome.issueCodes).toEqual(["agent-run-elapsed-budget-exhausted"]);
		expect(outcome.remoteRequests).toBe(2);
		expect(outcome.logicalStepCount).toBe(2);
		expect(outcome.attemptCount).toBe(2);
		expect(outcome.turnEvidence).toHaveLength(2);
		expect(outcome.turnEvidence.map((entry) => entry.requests)).toEqual([1, 1]);
		expect(outcome.turnEvidence.map((entry) => entry.inputTokens)).toEqual([10, 10]);
		expect(outcome.toolActionCount).toBe(0);
		expect(outcome.actionTrace).toEqual([]);
		expect(fixture.verifierCalls.count).toBe(0);
	});

	it("keeps owned elapsed cancellation ahead of cumulative output exhaustion after accounting", async () => {
		const fixture = await createClosedHostFixture();
		const elapsed = new AbortController();
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
				async invoke(request: EmpiricalModelTurnRequestV1) {
					invocations += 1;
					if (invocations === 1) {
						return nonEvaluableOutcome(
							request,
							fixture.frozen,
							fixture.report,
							fixture.protectionExecutor,
							["openrouter-error-type:provider_overloaded", "openrouter-http-status:503"],
							2_500,
						);
					}
					elapsed.abort();
					return completedOutcome(
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
			agentRunElapsedSignal: elapsed.signal,
			signal: elapsed.signal,
		});

		expect(invocations).toBe(2);
		expect(outcome.status).toBe("non-evaluable");
		expect(outcome.issueCodes).toEqual(["agent-run-elapsed-budget-exhausted"]);
		expect(outcome.remoteRequests).toBe(2);
		expect(outcome.attemptCount).toBe(2);
		expect(outcome.turnEvidence).toHaveLength(2);
		expect(outcome.hostOutputBytes).toBe(4_548);
		expect(fixture.verifierCalls.count).toBe(0);
	});

	it("keeps caller-first cancellation transport-owned after the elapsed signal follows", async () => {
		const fixture = await createClosedHostFixture();
		const caller = new AbortController();
		const elapsed = new AbortController();
		const signal = AbortSignal.any([caller.signal, elapsed.signal]);
		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: {
				async invoke(request) {
					caller.abort("caller-owned");
					elapsed.abort("elapsed-owned");
					return nonEvaluableOutcome(
						request,
						fixture.frozen,
						fixture.report,
						fixture.protectionExecutor,
						["openrouter-host-cancelled", "openrouter-unavailable-transport"],
						128,
					);
				},
			},
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			agentRunElapsedSignal: elapsed.signal,
			signal,
		});

		expect(signal.reason).toBe("caller-owned");
		expect(outcome.issueCodes).not.toContain("agent-run-elapsed-budget-exhausted");
		expect(outcome.issueCodes).toEqual([
			"model-turn-non-evaluable",
			"openrouter-host-cancelled",
			"openrouter-unavailable-transport",
		]);
	});

	it("composes the DeepSeek Chat wire with the real closed mutation path and verifier", async () => {
		const fixture = await createClosedHostFixture(undefined, undefined, "deepseek-v4-flash-high");
		const routeQualification = simulatedRouteQualification(fixture, {
			maxRequests: 8,
			maxStepsPerRun: 8,
			maxInputTokens: 600_000,
			maxOutputTokens: 49_152,
		});
		const baseContentDigest = empiricalSha256(encoder.encode("broken-placeholder-value\n"));
		const expectedToolChoices: unknown[] = ["required", "auto", "auto", "auto", "auto"];
		let transportCalls = 0;
		const transport: OpenRouterResponsesByteTransportV1 = {
			async request(input) {
				const callIndex = transportCalls;
				transportCalls += 1;
				const body = JSON.parse(new TextDecoder().decode(input.body)) as {
					readonly tool_choice: unknown;
					readonly tools: readonly {
						readonly function: { readonly name: string };
					}[];
				};
				expect(body.tool_choice).toEqual(expectedToolChoices[callIndex]);
				const toolNames = body.tools.map((tool) => tool.function.name);
				const output =
					callIndex === 0
						? [
								{
									type: "function_call",
									status: "completed",
									call_id: "call.deepseek.read",
									name: toolNames[0],
									arguments: JSON.stringify({ path: "README.md" }),
								},
							]
						: callIndex === 1
							? [
									{
										type: "function_call",
										status: "completed",
										call_id: "call.deepseek.replace",
										name: toolNames[2],
										arguments: JSON.stringify({
											baseContentDigest,
											newText: "fixed",
											oldText: "broken-placeholder-value",
											path: "README.md",
										}),
									},
								]
							: callIndex === 2
								? [
										{
											type: "function_call",
											status: "completed",
											call_id: "call.deepseek.diff",
											name: toolNames[3],
											arguments: "{}",
										},
									]
								: callIndex === 3
									? [
											{
												type: "function_call",
												status: "completed",
												call_id: "call.deepseek.command",
												name: toolNames[4],
												arguments: JSON.stringify({ commandRef: "actor.status" }),
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
															summary: "DeepSeek mutation path complete.",
														}),
													},
												],
											},
										];
				return dryRunOpenRouterResponse(
					`response.deepseek.mutation-path.${transportCalls}`,
					output,
					undefined,
					{
						requestModel: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
						downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
					},
				);
			},
		};
		let measurement = 0;
		const binding = createOpenRouterResponsesEmpiricalBinding({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			configurationRef: fixture.initialRequest.configurationRef,
			routeQualification,
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: "deepseek-dry-run-credential-placeholder",
			},
			transport,
			transportAdmission: { admit: () => true },
			monotonicMeasurement: { readMs: () => (measurement += 1) },
		});

		const outcome = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: binding.modelTurnPort,
			protectionExecutor: binding.protectionExecutor,
			verifier: fixture.verifier,
			signal: new AbortController().signal,
		});

		expect(transportCalls).toBe(5);
		expect(outcome).toMatchObject({
			status: "completed",
			logicalStepCount: 5,
			toolActionCount: 4,
			verifierVerdict: "passed",
			workspaceChanged: true,
			issueCodes: [],
		});
		expect(outcome.actionTrace.map((entry) => entry.toolRef)).toEqual([
			CLOSED_ACTOR_TOOL_REFS.readFile,
			CLOSED_ACTOR_TOOL_REFS.replaceExact,
			CLOSED_ACTOR_TOOL_REFS.workspaceDiff,
			CLOSED_ACTOR_TOOL_REFS.runCommand,
		]);
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

	it("accepts the exact DeepSeek V4 Flash 0731 DeepInfra route before transport", async () => {
		const fixture = await createClosedHostFixture(undefined, undefined, "deepseek-v4-flash-high");
		let transportCalls = 0;
		const artifactRoot = temporaryRoot("deepseek-route-accepted");
		const privateRoot = join(artifactRoot, ".private", "empirical-memory-rerun-avoidance");
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
			routeQualification: simulatedRouteQualification(fixture),
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: "openrouter-deepseek-secret-sentinel-0123456789",
			},
			transport: {
				request() {
					transportCalls += 1;
					throw new Error("simulated DeepSeek transport failure");
				},
			},
			monotonicMeasurement: { readMs: () => 0 },
			retryWait: immediateRetryWait,
			executionClass: "simulated-contract",
			privateRoot,
			generationRef: "deepseek-route-accepted-generation",
			signal: new AbortController().signal,
		});
		expect(transportCalls).toBe(1);
		expect(result.observation.cold.classification).toBe("non-evaluable");
		expect(result.observation.issueCodes).toContain("openrouter-unavailable-transport");
		expect(JSON.stringify(result)).not.toContain("openrouter-deepseek-secret-sentinel");
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

	it("rejects a GLM auto-tool profile before transport", async () => {
		const fixture = await createClosedHostFixture(undefined, undefined, "glm-5.2-high-auto");
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
					bearerToken: "openrouter-auto-tool-secret-sentinel-0123456789",
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
				privateRoot: temporaryRoot("auto-tool"),
				generationRef: "auto-tool-generation",
				signal: new AbortController().signal,
			}),
		).rejects.toThrow(/frozen exact route and pricing/);
		expect(transportCalls).toBe(0);
		await fixture.materialization.cleanup();
	});

	it("dry-runs injected OpenRouter bytes through host, verifier, canonical evidence, and atomic private persistence", async () => {
		const fixture = await createClosedHostFixture(
			undefined,
			undefined,
			"gpt-5.6-sol-medium",
			"smoke",
			true,
		);
		const credentialSentinel = "openrouter-dry-run-secret-sentinel-0123456789";
		const mechanicalGraph = graph();
		const workItems = mechanicalGraph.node<WorkItemProjection<Record<string, unknown>>>([], null, {
			name: "d682-integrated-work-items",
		});
		const workItemSeeds = mechanicalGraph.node<WorkItemSeed>([], null, {
			name: "d682-integrated-work-item-seeds",
		});
		const planProposals = mechanicalGraph.node<WorkItemEffectPlanProposed<Record<string, unknown>>>(
			[],
			null,
			{ name: "d682-integrated-plan-proposals" },
		);
		const effectRunCompletions = mechanicalGraph.node<D682EffectRunCompletionV1>([], null, {
			name: "d682-integrated-effect-run-completions",
		});
		const requestStatuses = mechanicalGraph.node<AgentRequestStatusChanged>([], null, {
			name: "d682-integrated-request-statuses",
		});
		const decisions = mechanicalGraph.node<AgentDecision>([], null, {
			name: "d682-integrated-decisions",
		});
		const actionKinds = [
			CLOSED_ACTOR_TOOL_REFS.readFile,
			CLOSED_ACTOR_TOOL_REFS.replaceExact,
			CLOSED_ACTOR_TOOL_REFS.workspaceDiff,
			CLOSED_ACTOR_TOOL_REFS.runCommand,
			"graphrefly.private-solution-eval.agent.final.v1",
		] as const;
		const mechanicalRecipe = createD682ExecutionQualifiedMechanicalRecipe(mechanicalGraph, {
			workItems,
			workItemSeeds,
			proposals: planProposals,
			effectRunCompletions,
			completionAdmission: createD682EffectRunCompletionAdmission(),
			allowedEffectKinds: actionKinds,
		});
		const completion = effectRunCompletionProjector(mechanicalGraph, {
			effectRuns: mechanicalRecipe.effectRuns.effectRuns,
			requestFacts: [mechanicalRecipe.requestFacts],
			requestStatuses: [requestStatuses],
			decisions: [decisions],
			now: () => 0,
		});
		const completedResults: EffectRunResult[] = [];
		completion.results.subscribe((message) => {
			if (message[0] === "DATA") completedResults.push(message[1] as EffectRunResult);
		});
		const issuedRequests: AgentRequestIssued[] = [];
		mechanicalRecipe.agentRequests.subscribe((message) => {
			if (message[0] === "DATA") issuedRequests.push(message[1] as AgentRequestIssued);
		});
		const mechanicalResultIssues: unknown[] = [];
		mechanicalRecipe.resultIssues.subscribe((message) => {
			if (message[0] === "DATA") mechanicalResultIssues.push(message[1]);
		});
		const mechanicalPlanResults: unknown[] = [];
		mechanicalRecipe.plan.results.subscribe((message) => {
			if (message[0] === "DATA") mechanicalPlanResults.push(message[1]);
		});
		const workItemId = "wi-d682-integrated-dry-run";
		workItemSeeds.down([["DATA", { kind: "work-item", workItemId }]]);
		workItems.down([
			[
				"DATA",
				{
					workItemId,
					summary: "D682 integrated no-network qualification",
					authoringRevision: 1,
					executionInputRevision: 1,
					lastEventId: "event-d682-integrated",
				},
			],
		]);
		planProposals.down([
			[
				"DATA",
				createD682SerialEffectPlanProposal({
					planId: "plan-d682-integrated",
					workItemId,
					executionInputRevision: 1,
					actions: actionKinds.map((effectKind) => ({
						memberId: effectKind.split(".").at(-2) ?? effectKind,
						effectKind,
						input: { effectKind },
					})),
				}),
			],
		]);
		expect(issuedRequests).toHaveLength(1);
		const completeMechanicalRequest = (
			request: AgentRequestIssued,
			ordinal: number,
			actualOutput: unknown,
		): void => {
			const decisionId = `d682-integrated-decision-${ordinal}`;
			const outcomeId = `d682-integrated-outcome-${ordinal}`;
			requestStatuses.down([
				[
					"DATA",
					{
						kind: "status",
						requestId: request.requestId,
						operationId: request.operationId,
						effectRunId: request.effectRunId,
						status: "completed",
					},
				],
			]);
			decisions.down([
				[
					"DATA",
					{
						kind: "final",
						decisionId,
						effectRunId: request.effectRunId,
						agentRunId: request.agentRunId ?? "d682-integrated-agent-run",
						source: { requestId: request.requestId, operationId: request.operationId, outcomeId },
						output: { kind: "d682-integrated-actual-host-result", value: actualOutput },
					},
				],
			]);
			const result = completedResults.at(-1);
			if (result === undefined || result.effectRunId !== request.effectRunId) {
				throw new TypeError("D682 integrated completion projector did not bind the host result");
			}
			effectRunCompletions.down([
				[
					"DATA",
					{
						kind: "d682-effect-run-completion",
						issuedRequest: request,
						decisionId,
						outcomeId,
						result,
					},
				],
			]);
		};
		let transportCalls = 0;
		let finalMechanicalCompletedBeforeTransportReturn = false;
		const transport: OpenRouterResponsesByteTransportV1 = {
			async request(input) {
				transportCalls += 1;
				const requestBody = JSON.parse(new TextDecoder().decode(input.body)) as {
					readonly input: string;
					readonly tools: readonly { readonly name: string }[];
				};
				if (transportCalls > 1) {
					const completedRequest = issuedRequests[transportCalls - 2];
					if (completedRequest === undefined) {
						throw new TypeError("D682 mechanical dependency did not release the expected request");
					}
					const userEnvelope = JSON.parse(requestBody.input) as {
						readonly priorToolResults: readonly {
							readonly toolCallRef: string;
							readonly result: unknown;
						}[];
					};
					const actualPriorResult = userEnvelope.priorToolResults.at(-1);
					if (actualPriorResult === undefined) {
						throw new TypeError("D682 integrated host did not carry its actual prior tool result");
					}
					completeMechanicalRequest(completedRequest, transportCalls - 1, actualPriorResult);
				}
				expect(issuedRequests).toHaveLength(Math.min(transportCalls, actionKinds.length));
				const currentEffectKind = issuedRequests.at(-1)?.input?.inputKind;
				expect(currentEffectKind).toBe(actionKinds[transportCalls - 1]);
				const toolCalls = new Map<
					string,
					{
						readonly toolIndex: number;
						readonly callRef: string;
						readonly arguments: Record<string, unknown>;
					}
				>([
					[actionKinds[0], { toolIndex: 0, callRef: "read", arguments: { path: "README.md" } }],
					[
						actionKinds[1],
						{
							toolIndex: 2,
							callRef: "replace-exact",
							arguments: {
								newText: "fixed",
								oldText: "broken-placeholder-value",
								path: "README.md",
							},
						},
					],
					[actionKinds[2], { toolIndex: 3, callRef: "diff", arguments: {} }],
					[
						actionKinds[3],
						{
							toolIndex: 4,
							callRef: "command",
							arguments: { commandRef: "actor.status" },
						},
					],
				]);
				const toolCall =
					currentEffectKind === undefined ? undefined : toolCalls.get(currentEffectKind);
				const finalStructuredOutput = {
					kind: "model-turn-output-placeholder",
					summary: "bounded-placeholder",
				};
				const output =
					toolCall === undefined
						? [
								{ type: "reasoning", summary: [] },
								{
									type: "message",
									role: "assistant",
									status: "completed",
									content: [
										{
											type: "output_text",
											text: JSON.stringify(finalStructuredOutput),
										},
									],
								},
							]
						: [
								{ type: "reasoning", summary: [] },
								{
									type: "function_call",
									status: "completed",
									call_id: `call.${toolCall.callRef}`,
									name: requestBody.tools[toolCall.toolIndex]?.name,
									arguments: JSON.stringify(toolCall.arguments),
								},
							];
				if (toolCall === undefined) {
					const finalRequest = issuedRequests.at(-1);
					if (finalRequest === undefined) throw new TypeError("D682 final request missing");
					completeMechanicalRequest(finalRequest, actionKinds.length, finalStructuredOutput);
					const mechanicalPlanResult = mechanicalPlanResults[0];
					if (
						mechanicalPlanResults.length !== 1 ||
						mechanicalPlanResult === null ||
						typeof mechanicalPlanResult !== "object" ||
						!("status" in mechanicalPlanResult) ||
						mechanicalPlanResult.status !== "succeeded"
					) {
						throw new TypeError("D682 plan did not succeed before the final transport returned");
					}
					finalMechanicalCompletedBeforeTransportReturn = true;
				}
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

		expect(transportCalls).toBe(5);
		expect(issuedRequests).toHaveLength(5);
		expect(finalMechanicalCompletedBeforeTransportReturn).toBe(true);
		expect(mechanicalPlanResults).toEqual([
			expect.objectContaining({ status: "succeeded", memberResults: expect.any(Array) }),
		]);
		expect(mechanicalResultIssues).toEqual([]);
		expect(result.observation).toMatchObject({
			executionClass: "simulated-contract",
			empiricalLiveEvidence: false,
			result: {
				classification: "complete",
				verifierStatus: "passed",
				requests: 5,
				steps: 5,
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
		const providerInputTokens = 500;
		const providerOutputTokens = 100;
		const providerCostMicrousd = calculateOpenRouterCostMicrousd(
			providerInputTokens,
			providerOutputTokens,
			{
				currency: "USD",
				inputMicrousdPerMillionTokens: result.observation.route.inputMicrousdPerMillionTokens,
				outputMicrousdPerMillionTokens: result.observation.route.outputMicrousdPerMillionTokens,
				pricingRevision: result.observation.route.pricingRevision,
				sourceUrl: result.observation.route.pricingSourceUrl,
			},
		);
		const providerReportedCostObservation = validateEmpiricalTrialBlockObservation({
			...result.observation,
			executionClass: "live-provider",
			empiricalLiveEvidence: true,
			result: {
				...result.observation.result,
				costBasis: "provider-usage",
				costMicrousd: providerCostMicrousd,
				reservedInputTokens: providerInputTokens,
				reservedOutputTokens: providerOutputTokens,
			},
			cold: {
				...result.observation.cold,
				costBasis: "provider-usage",
				costMicrousd: providerCostMicrousd,
				reservedInputTokens: providerInputTokens,
				reservedOutputTokens: providerOutputTokens,
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
		expect(providerReportedCostObservation.result.costMicrousd).toBe(providerCostMicrousd);
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

	it("dry-runs the D682 three-fixture serial qualification with one aggregate budget", async () => {
		const sourceValues = [
			"alpha broken-placeholder-value omega\n",
			"broken-placeholder-value follows a heading\n",
			"prefix\nbroken-placeholder-value\nsuffix\n",
		] as const;
		const replacementValues = [
			"alpha fixed omega",
			"fixed follows a heading",
			"prefix\nfixed\nsuffix",
		] as const;
		const fixtures: ClosedHostFixture[] = [];
		const expectedWorkspaceStateDigests: string[] = [];
		for (const [index, sourceContent] of sourceValues.entries()) {
			const baseFixture = await createClosedHostFixture(
				undefined,
				sourceContent,
				"deepseek-v4-flash-high",
				"calibration",
				true,
				`task.d682.mechanical.${index + 1}`,
				`${replacementValues[index]}\n`,
			);
			const oldText = index === 0 ? "alpha broken-placeholder-value omega" : sourceContent.trim();
			const structuredInput = createD682MechanicalActorInput({
				workItemRef: baseFixture.frozen.manifest.catalog.tasks[0]!.workItemRef,
				instructionRef: `instruction.d682.mechanical.${index + 1}`,
				readablePaths: baseFixture.taskProfile.workspaceRecipe.readableFiles,
				writablePaths: baseFixture.taskProfile.workspaceRecipe.writableFiles.map(
					(rule) => rule.path,
				),
				commandRefs: baseFixture.taskProfile.commandPolicy.commands.map(
					(command) => command.commandRef,
				),
				path: "README.md",
				oldText,
				newText: replacementValues[index]!,
			});
			const inputProtectionReceipt = executeEmpiricalProtection(baseFixture.protectionExecutor, {
				policyRef: baseFixture.initialRequest.protectionPolicyRef,
				policyRevision: baseFixture.initialRequest.protectionPolicyRevision,
				stage: "source-ingress",
				subject: structuredInput as unknown as EmpiricalModelTurnRequestV1["structuredInput"],
			}).receipt;
			const fixture: ClosedHostFixture = {
				...baseFixture,
				initialRequest: validateEmpiricalModelTurnRequest(
					{
						...baseFixture.initialRequest,
						structuredInput:
							structuredInput as unknown as EmpiricalModelTurnRequestV1["structuredInput"],
						structuredInputDigest: empiricalStrictJsonDigest(structuredInput),
						inputProtectionReceipt,
					},
					baseFixture.frozen,
					baseFixture.report,
				),
			};
			const offline = await runClosedTaskProfileHost({
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: fixture.materialization,
				modelTurnPort: scriptedPort(fixture, (request) => {
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
									intent(1, CLOSED_ACTOR_TOOL_REFS.replaceExact, {
										path: "README.md",
										oldText,
										newText: replacementValues[index],
									}),
								],
							};
						case 2:
							return {
								finishReason: "tool-intents",
								toolIntents: [intent(2, CLOSED_ACTOR_TOOL_REFS.workspaceDiff, {})],
							};
						case 3:
							return {
								finishReason: "tool-intents",
								toolIntents: [
									intent(3, CLOSED_ACTOR_TOOL_REFS.runCommand, {
										commandRef: "actor.status",
									}),
								],
							};
						default:
							return {
								finishReason: "structured-output",
								structuredOutput: {
									kind: "model-turn-output-placeholder",
									summary: "mechanical fixture complete",
								},
							};
					}
				}),
				protectionExecutor: fixture.protectionExecutor,
				verifier: fixture.verifier,
				signal: new AbortController().signal,
			});
			expect(offline).toMatchObject({ status: "completed", verifierVerdict: "passed" });
			expect(offline.workspaceStateDigest).toMatch(/^sha256:/);
			expectedWorkspaceStateDigests.push(offline.workspaceStateDigest!);
			fixtures.push(fixture);
		}
		const routes = fixtures.map((fixture) =>
			simulatedRouteQualification(fixture, {
				maxSmokeSpendMicrousd: D682_MECHANICAL_QUALIFICATION_MAX_COST_MICROUSD,
				maxRequests: 8,
				maxStepsPerRun: 8,
				maxInputTokens: 500_000,
				maxOutputTokens: 524_288,
				maxLatencyMs: 600_000,
			}),
		) as unknown as readonly [
			OpenRouterRouteQualificationV1,
			OpenRouterRouteQualificationV1,
			OpenRouterRouteQualificationV1,
		];
		const catalog = strictSnapshot({
			schemaVersion: D682_MECHANICAL_QUALIFICATION_CATALOG_SCHEMA,
			catalogRevision: "b112.d682.mechanical-fixtures.2026-08-05.v1",
			routeProfileDigest: d682MechanicalRouteProfileDigest(routes[0]),
			fixtures: fixtures.map((fixture, index) => {
				const task = fixture.frozen.manifest.catalog.tasks[0]!;
				return {
					fixtureRef: `b112.d682.mechanical-fixture.${index + 1}`,
					fixtureRevision: "b112.d682.mechanical-fixture.2026-08-05.v1",
					taskRef: task.taskRef,
					taskDigest: empiricalStrictJsonDigest(task),
					actorTreeDigest: task.actorTreeDigest,
					workItemDigest: task.workItemDigest,
					acceptanceDigest: task.acceptanceDigest,
					workspaceRecipeDigest: task.workspaceRecipeDigest,
					verifierProfileDigest: task.verifierProfileDigest,
					expectedWorkspaceStateDigest: expectedWorkspaceStateDigests[index]!,
				};
			}),
		}) as unknown as D682MechanicalQualificationCatalogV1;
		expect(() =>
			validateD682MechanicalQualificationCatalog({
				...catalog,
				rawProviderResponse: "private-material-must-not-survive",
			}),
		).toThrow(/unexpected keys/);
		expect(() =>
			validateD682MechanicalQualificationCatalog({
				...catalog,
				fixtures: catalog.fixtures.map((fixture, index) =>
					index === 0 ? { ...fixture, hiddenMaterial: "must-not-survive" } : fixture,
				),
			}),
		).toThrow(/unexpected keys/);
		const materializations = await Promise.all(
			fixtures.map((fixture) => fixture.prepareFreshMaterialization(new AbortController().signal)),
		);
		let transportCalls = 0;
		const transport: OpenRouterResponsesByteTransportV1 = {
			async request(input) {
				const fixtureIndex = Math.floor(transportCalls / 5);
				const stepIndex = transportCalls % 5;
				transportCalls += 1;
				const requestBody = JSON.parse(new TextDecoder().decode(input.body)) as {
					readonly tools: readonly { readonly function: { readonly name: string } }[];
					readonly messages: readonly { readonly role: string; readonly content: string }[];
				};
				if (stepIndex === 0) {
					const userMessage = requestBody.messages.find((message) => message.role === "user");
					const envelope = JSON.parse(userMessage?.content ?? "null") as {
						readonly structuredInput?: {
							readonly schemaVersion?: string;
							readonly pathMode?: string;
							readonly readablePaths?: readonly string[];
							readonly writablePaths?: readonly string[];
							readonly commandRefs?: readonly string[];
							readonly replacementProposal?: { readonly path?: string };
						};
					};
					expect(envelope.structuredInput).toMatchObject({
						schemaVersion: "graphrefly.private-solution-eval.d682-mechanical-actor-input.v1",
						pathMode: "workspace-relative",
						readablePaths: ["README.md"],
						writablePaths: ["README.md"],
						commandRefs: ["actor.status"],
						replacementProposal: { path: "README.md" },
					});
				}
				const functionCall = (
					toolIndex: number,
					callRef: string,
					argumentsValue: Record<string, unknown>,
				) => ({
					type: "function_call",
					status: "completed",
					call_id: `call.${fixtureIndex}.${callRef}`,
					name: requestBody.tools[toolIndex]?.function.name,
					arguments: JSON.stringify(argumentsValue),
				});
				const output =
					stepIndex === 0
						? [functionCall(0, "read", { path: "README.md" })]
						: stepIndex === 1
							? [
									functionCall(2, "replace", {
										path: "README.md",
										oldText:
											fixtureIndex === 0
												? "alpha broken-placeholder-value omega"
												: sourceValues[fixtureIndex]!.trim(),
										newText: replacementValues[fixtureIndex]!,
									}),
								]
							: stepIndex === 2
								? [functionCall(3, "diff", {})]
								: stepIndex === 3
									? [functionCall(4, "command", { commandRef: "actor.status" })]
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
															summary: "mechanical fixture complete",
														}),
													},
												],
											},
										];
				return dryRunOpenRouterResponse(
					`response.d682.${transportCalls}`,
					output,
					{ input_tokens: 100, output_tokens: 20, total_tokens: 120, cost: 0.000_012 },
					{
						requestModel: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
						downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
					},
				);
			},
		};
		const privateRoot = join(
			temporaryRoot("d682-mechanical-private"),
			".private",
			"empirical-memory-rerun-avoidance",
		);
		mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
		chmodSync(privateRoot, 0o700);
		let measurement = 0;
		let currentKeyReads = 0;
		const baseCredential = {
			credentialBindingRef: routes[0].sharedCapacityQualification.credentialBindingRef,
			credentialBindingRevision: routes[0].sharedCapacityQualification.credentialBindingRevision,
			bearerToken: "d682-mechanical-secret-sentinel-0123456789",
		};
		await expect(
			runLoadedOpenRouterD682MechanicalQualificationOperator({
				operatorInput: {
					catalog: validateD682MechanicalQualificationCatalog({
						...catalog,
						routeProfileDigest: empiricalSha256(encoder.encode("wrong-route-profile")),
					}),
					routeQualifications: routes,
					async prepareFixture() {
						throw new TypeError("route mismatch must fail before fixture preparation");
					},
					privateRoot,
					generationRef: "d682-route-mismatch-must-not-persist",
				},
				credential: baseCredential,
				transport,
				currentKeySpendAdmission: simulatedCurrentKeySpendAdmission(() => {
					throw new TypeError("route mismatch must fail before current-key admission");
				}),
				monotonicMeasurement: { readMs: () => (measurement += 1) },
				retryWait: immediateRetryWait,
				executionClass: "simulated-contract",
				signal: new AbortController().signal,
			}),
		).rejects.toThrow(/frozen route/);
		const mismatchedMaterialization = materializations[0]!;
		await expect(
			runLoadedOpenRouterD682MechanicalQualificationOperator({
				operatorInput: {
					catalog: validateD682MechanicalQualificationCatalog({
						...catalog,
						fixtures: catalog.fixtures.map((fixture, index) =>
							index === 0
								? {
										...fixture,
										workItemDigest: empiricalSha256(encoder.encode("wrong-work-item")),
									}
								: fixture,
						),
					}),
					routeQualifications: routes,
					async prepareFixture(fixtureIndex) {
						if (fixtureIndex !== 0) throw new TypeError("unexpected fixture preparation");
						const fixture = fixtures[0]!;
						return {
							host: {
								frozen: fixture.frozen,
								qualificationReport: fixture.report,
								initialRequest: fixture.initialRequest,
								taskProfile: fixture.taskProfile,
								materialization: mismatchedMaterialization,
								verifier: fixture.verifier,
							},
						};
					},
					privateRoot,
					generationRef: "d682-fixture-mismatch-must-not-persist",
				},
				credential: baseCredential,
				transport,
				currentKeySpendAdmission: simulatedCurrentKeySpendAdmission(() => {
					throw new TypeError("fixture mismatch must fail before current-key admission");
				}),
				monotonicMeasurement: { readMs: () => (measurement += 1) },
				retryWait: immediateRetryWait,
				executionClass: "simulated-contract",
				signal: new AbortController().signal,
			}),
		).rejects.toThrow(/preregistration/);
		materializations[0] = await fixtures[0]!.prepareFreshMaterialization(
			new AbortController().signal,
		);
		const result = await runLoadedOpenRouterD682MechanicalQualificationOperator({
			operatorInput: {
				catalog,
				routeQualifications: routes,
				async prepareFixture(fixtureIndex) {
					const fixture = fixtures[fixtureIndex]!;
					return {
						host: {
							frozen: fixture.frozen,
							qualificationReport: fixture.report,
							initialRequest: fixture.initialRequest,
							taskProfile: fixture.taskProfile,
							materialization: materializations[fixtureIndex]!,
							verifier: fixture.verifier,
						},
					};
				},
				privateRoot,
				generationRef: "d682-mechanical-dry-run-generation",
			},
			credential: baseCredential,
			transport,
			currentKeySpendAdmission: simulatedCurrentKeySpendAdmission(() => {
				currentKeyReads += 1;
			}),
			monotonicMeasurement: { readMs: () => (measurement += 1) },
			retryWait: immediateRetryWait,
			executionClass: "simulated-contract",
			signal: new AbortController().signal,
		});

		expect(result.observations.map((observation) => observation.issueCodes)).toEqual([[], [], []]);
		expect(transportCalls).toBe(15);
		expect(currentKeyReads).toBe(3);
		expect(result.scorecard).toMatchObject({
			status: "simulated-contract-passed",
			evidenceClass: "simulated-contract",
			empiricalLiveEvidence: false,
			efficacyClaim: "none",
			attemptedFixtures: 3,
			passedFixtures: 3,
			requests: 15,
			costMicrousd: 0,
			hardCapMicrousd: 500_000,
		});
		const repeatedScorecard = createD682MechanicalQualificationScorecard({
			catalog,
			observations: result.observations,
		});
		expect(strictJsonCodec.encode(repeatedScorecard)).toEqual(
			strictJsonCodec.encode(result.scorecard),
		);
		const withTrace = (
			observation: (typeof result.observations)[number],
			actionTrace: (typeof observation)["cold"]["actionTrace"],
			toolResultBindings: (typeof observation)["cold"]["toolResultBindings"],
		) =>
			strictSnapshot({
				...observation,
				cold: strictSnapshot({
					...observation.cold,
					actionTrace,
					actionTraceDigest: empiricalStrictJsonDigest(actionTrace),
					toolResultBindings,
				}),
			});
		const firstTrace = result.observations[0].cold.actionTrace;
		const firstBindings = result.observations[0].cold.toolResultBindings;
		const skippedCommand = withTrace(
			result.observations[0],
			firstTrace.slice(0, -1),
			firstBindings.slice(0, -1),
		);
		expect(
			createD682MechanicalQualificationScorecard({
				catalog,
				observations: [skippedCommand, result.observations[1], result.observations[2]],
			}),
		).toMatchObject({ status: "not-qualified", passedFixtures: 2 });
		const firstAction = firstTrace[0];
		const secondAction = firstTrace[1];
		if (firstAction === undefined || secondAction === undefined) {
			throw new TypeError("D682 dry-run action trace is incomplete");
		}
		const reorderedTrace = strictSnapshot([
			strictSnapshot({ ...firstAction, toolRef: secondAction.toolRef }),
			strictSnapshot({ ...secondAction, toolRef: firstAction.toolRef }),
			...firstTrace.slice(2),
		]);
		const firstBinding = firstBindings[0];
		const secondBinding = firstBindings[1];
		if (firstBinding === undefined || secondBinding === undefined) {
			throw new TypeError("D682 dry-run tool bindings are incomplete");
		}
		const reordered = withTrace(
			result.observations[0],
			reorderedTrace,
			strictSnapshot([
				strictSnapshot({ ...firstBinding, toolRef: secondBinding.toolRef }),
				strictSnapshot({ ...secondBinding, toolRef: firstBinding.toolRef }),
				...firstBindings.slice(2),
			]),
		);
		expect(
			createD682MechanicalQualificationScorecard({
				catalog,
				observations: [reordered, result.observations[1], result.observations[2]],
			}),
		).toMatchObject({ status: "not-qualified", passedFixtures: 2 });
		const generationFiles = readdirSync(result.persistence.generationPath).sort();
		expect(generationFiles).toEqual([
			"generation.v1.json",
			"mechanical-fixture-catalog.v1.json",
			"mechanical-observations.v1.json",
			"mechanical-scorecard.v1.json",
		]);
		for (const file of generationFiles) {
			expect(statSync(join(result.persistence.generationPath, file)).mode & 0o777).toBe(0o600);
			expect(readFileSync(join(result.persistence.generationPath, file), "utf8")).not.toContain(
				"d682-mechanical-secret-sentinel",
			);
		}

		const calibrationFixture = await createClosedHostFixture(
			undefined,
			undefined,
			"deepseek-v4-flash-high",
			"calibration",
		);
		const calibrationRoutes = d678SimulatedCalibrationQualifications(calibrationFixture);
		const guidancePrivateRoot = join(
			temporaryRoot("d688-guidance-private"),
			".private",
			"empirical-memory-rerun-avoidance",
		);
		mkdirSync(guidancePrivateRoot, { recursive: true, mode: 0o700 });
		let guidanceTransportCalls = 0;
		let freshQualificationCalls = 0;
		const guidanceActionReceipts: ClosedTaskProfileHostActionReceiptV1[] = [];
		const rawArgumentSentinel = "d688-raw-action-argument-sentinel";
		const guidanceResult = await runLoadedOpenRouterDeveloperGuidanceCalibration({
			operatorInput: {
				frozen: calibrationFixture.frozen,
				qualificationReport: calibrationFixture.report,
				routeQualifications: calibrationRoutes,
				privateRoot: guidancePrivateRoot,
				generationRef: "d688-no-network-preflight",
				async prepareTrialBlock(scheduled) {
					if (scheduled.blockOrdinal !== 1) {
						throw new TypeError("D688 bounded fixture prepares only its first source block");
					}
					return {
						host: {
							frozen: calibrationFixture.frozen,
							qualificationReport: calibrationFixture.report,
							initialRequest: calibrationFixture.initialRequest,
							taskProfile: calibrationFixture.taskProfile,
							materialization: calibrationFixture.materialization,
							verifier: calibrationFixture.verifier,
							actionReceiptObserver: {
								observerRef: "d688-no-network-action-receipts",
								observerRevision: "d688-no-network-action-receipts.v1",
								record(receipt) {
									guidanceActionReceipts.push(receipt);
								},
							},
						},
						prepareWarmHost: ({ signal }) => calibrationFixture.prepareFreshMaterialization(signal),
					};
				},
			},
			mechanicalGate: {
				catalog,
				observations: result.observations,
				scorecard: result.scorecard,
			},
			guidanceVerifier: {
				verifierRef: "d688-no-network-verifier",
				verifierRevision: "d688-no-network-verifier.v1",
				assess(input) {
					const receipts = guidanceActionReceipts.filter(
						(receipt) =>
							receipt.taskRef === input.taskId &&
							receipt.trialBlockRef === input.matchedBlockId &&
							receipt.trialStage === input.arm,
					);
					if (
						receipts.length !== input.actions.length ||
						receipts.some((receipt, index) => {
							const action = input.actions[index];
							return (
								action === undefined ||
								receipt.actionIndex !== action.actionIndex ||
								receipt.intentDigest !== action.intentDigest ||
								receipt.resultDigest !== action.resultDigest ||
								receipt.toolRef !== action.toolRef
							);
						})
					) {
						throw new TypeError("D688 dry-run receipts do not bind the source action trace");
					}
					return strictSnapshot({
						verifierRef: "d688-no-network-verifier",
						verifierRevision: "d688-no-network-verifier.v1",
						sourceObservationDigest: input.sourceObservationDigest,
						sourceRunDigest: input.sourceRunDigest,
						horizonStatus: "fully-observed" as const,
						nonEvaluableReason: null,
						coordinates: {
							repositoryScopeCorrect: null,
							targetFileCorrect: null,
							targetSymbolCorrect: null,
							targetTestCorrect: null,
							failureClassCorrect: null,
						},
						coordinateEvidenceDigest: null,
						actions: input.actions.map((action) => ({
							...action,
							valid: true,
							repeatedKnownFailureRoute: false,
							harmful: false,
							verifierProgressEvidenceDigest: null,
						})),
						finalTaskVerifierEvidenceDigest:
							input.finalTaskVerifierStatus === "passed" ||
							input.finalTaskVerifierStatus === "failed"
								? (input.finalTaskVerifierEvidenceDigests[0] ?? null)
								: null,
					});
				},
			},
			freshRouteQualification: {
				capabilityRef: "d688-no-network-fresh-zero-byok",
				capabilityRevision: "d688-no-network-fresh-zero-byok.v1",
				async qualify(input) {
					freshQualificationCalls += 1;
					return strictSnapshot({
						...input.preregisteredRoute,
						qualificationRef: `d688-no-network-fresh-route-${input.blockOrdinal}`,
						qualificationRevision: `d688-no-network-fresh-route.v${input.blockOrdinal}`,
						keySpendLimit: {
							...input.preregisteredRoute.keySpendLimit,
							qualificationRef: `d688-no-network-key-${input.blockOrdinal}`,
							qualificationRevision: `d688-no-network-key.v${input.blockOrdinal}`,
						},
						sharedCapacityQualification: {
							...input.preregisteredRoute.sharedCapacityQualification,
							qualificationRef: `d688-no-network-shared-${input.blockOrdinal}`,
							qualificationRevision: `d688-no-network-shared.v${input.blockOrdinal}`,
						},
					});
				},
			},
			credential: {
				credentialBindingRef:
					calibrationRoutes[0]!.sharedCapacityQualification.credentialBindingRef,
				credentialBindingRevision:
					calibrationRoutes[0]!.sharedCapacityQualification.credentialBindingRevision,
				bearerToken: "d688-no-network-secret-sentinel-0123456789",
			},
			transport: {
				async request(input) {
					guidanceTransportCalls += 1;
					const request = JSON.parse(new TextDecoder().decode(input.body)) as {
						readonly messages: readonly { readonly role: string; readonly content: string }[];
						readonly tools: readonly { readonly function: { readonly name: string } }[];
					};
					const userMessage = request.messages.find((message) => message.role === "user");
					if (userMessage === undefined) throw new TypeError("missing D688 dry-run user message");
					const envelope = JSON.parse(userMessage.content) as {
						readonly turn?: { readonly stepIndex?: number };
					};
					const stepIndex = envelope.turn?.stepIndex;
					if (typeof stepIndex !== "number") {
						throw new TypeError("missing D688 dry-run step index");
					}
					const searchToolName = request.tools[1]?.function.name;
					if (searchToolName === undefined) throw new TypeError("missing D688 search tool");
					const output =
						stepIndex === 0
							? [
									{
										type: "function_call",
										status: "completed",
										call_id: `call.d688.${guidanceTransportCalls}`,
										name: searchToolName,
										arguments: JSON.stringify({
											maxMatches: 1,
											path: "README.md",
											query: rawArgumentSentinel,
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
													summary: "bounded D688 no-network terminal",
												}),
											},
										],
									},
								];
					return dryRunOpenRouterResponse(
						`response.d688.${guidanceTransportCalls}`,
						output,
						{ input_tokens: 10, output_tokens: 10, total_tokens: 20, cost: 0.000_001 },
						{
							requestModel: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
							downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
						},
					);
				},
			},
			currentKeySpendAdmission: simulatedCurrentKeySpendAdmission(),
			monotonicMeasurement: { readMs: () => (measurement += 1) },
			retryWait: immediateRetryWait,
			executionClass: "simulated-contract",
			signal: new AbortController().signal,
		});
		expect(freshQualificationCalls).toBe(1);
		expect(guidanceTransportCalls).toBeGreaterThan(0);
		expect(guidanceActionReceipts).toHaveLength(6);
		expect(
			guidanceActionReceipts.every((receipt) =>
				JSON.stringify(receipt.arguments).includes(rawArgumentSentinel),
			),
		).toBe(true);
		expect(guidanceResult.guidanceObservations).toHaveLength(5);
		expect(
			guidanceResult.guidanceObservations.every(
				(observation) =>
					observation.evidence.validActionObserved &&
					observation.progress.actionsToFirstValidAction === 1,
			),
		).toBe(true);
		expect(guidanceResult.sourceScorecard).toMatchObject({ efficacyClaim: "none" });
		expect(guidanceResult.guidanceScorecard.efficacyClaim).toBe("none");
		expect(guidanceResult.recommendation.efficacyClaim).toBe("none");
		for (const file of readdirSync(guidanceResult.persistence.generationPath)) {
			expect(statSync(join(guidanceResult.persistence.generationPath, file)).mode & 0o777).toBe(
				0o600,
			);
			expect(
				readFileSync(join(guidanceResult.persistence.generationPath, file), "utf8"),
			).not.toContain("d688-no-network-secret-sentinel");
			expect(
				readFileSync(join(guidanceResult.persistence.generationPath, file), "utf8"),
			).not.toContain(rawArgumentSentinel);
		}
		const assessedActionCounts = guidanceResult.guidanceObservations.map((observation) => {
			const slot = guidanceResult.terminalSlots.find(
				(candidate) =>
					candidate.taskRef === observation.taskId &&
					candidate.observation?.trialBlockRef === observation.matchedBlockId,
			);
			const branch = slot?.observation?.warmBranches.find(
				(candidate) => candidate.branchKind === observation.arm,
			);
			return {
				observationId: observation.observationId,
				actionCount: branch?.run?.actionTrace.length ?? 0,
			};
		});
		await expect(
			persistPrivateDeveloperGuidanceCalibrationGeneration({
				privateRoot: guidancePrivateRoot,
				generationRef: "d688-no-network-preflight",
				frozen: calibrationFixture.frozen,
				qualificationReport: calibrationFixture.report,
				terminalSlots: guidanceResult.terminalSlots,
				sourceScorecard: guidanceResult.sourceScorecard,
				guidanceObservations: guidanceResult.guidanceObservations,
				guidanceScorecard: guidanceResult.guidanceScorecard,
				recommendation: guidanceResult.recommendation,
				expectedTaskIds: calibrationFixture.frozen.manifest.catalog.tasks.map(
					(task) => task.taskRef,
				) as [string, string, string, string, string],
				assessedActionCounts,
				protectionExecutor: calibrationFixture.protectionExecutor,
			}),
		).rejects.toThrow();
		expect(
			readdirSync(guidancePrivateRoot).filter((entry) => entry.startsWith(".staging-")),
		).toEqual([]);
	}, 60_000);

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
					readonly turn?: {
						readonly stepIndex?: number;
						readonly finalStep?: boolean;
					};
					readonly structuredInput?: {
						readonly memoryContext?: {
							readonly kind?: string;
							readonly revision?: string;
							readonly recordDigest?: string;
							readonly text?: string;
						};
					};
				};
				const turn = userEnvelope.turn;
				if (
					turn === undefined ||
					typeof turn.stepIndex !== "number" ||
					!Number.isSafeInteger(turn.stepIndex) ||
					typeof turn.finalStep !== "boolean"
				) {
					throw new TypeError("missing GLM Chat turn coordinates");
				}
				const memoryContext = userEnvelope.structuredInput?.memoryContext;
				const hasValidatedGenericMemory = validatesGenericMemory(
					memoryContext,
					expectedRelevantMemoryDigest,
				);
				const output = turn.finalStep
					? [
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
												expectedRelevantMemoryDigest === null
													? taskSpecificCorrectionSentinel
													: "Bounded matched-block completion.",
										}),
									},
								],
							},
						]
					: hasValidatedGenericMemory && !correctionIssued
						? [
								{
									type: "function_call",
									status: "completed",
									call_id: `call.matched-replace.${turn.stepIndex}`,
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
									type: "function_call",
									status: "completed",
									call_id: `call.matched-read.${transportCalls}`,
									name: requestBody.tools[0]?.function.name,
									arguments: JSON.stringify({ path: "README.md" }),
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
		const operatorSignal = new AbortController().signal;
		const warmPreparationSignals: AbortSignal[] = [];
		const prepareWarmHost = async (
			input: Parameters<
				NonNullable<Parameters<typeof runOpenRouterFirstTaskSmoke>[0]["prepareWarmHost"]>
			>[0],
		) => {
			warmPreparationSignals.push(input.signal);
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
			signal: operatorSignal,
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

		expect(transportCalls).toBe(48);
		for (const [wireIndex, wireBody] of wireBodies.entries()) {
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
			});
			expect(parsedWireBody).not.toHaveProperty("parallel_tool_calls");
			if (wireIndex % 8 === 7) {
				expect(parsedWireBody.response_format).toMatchObject({
					type: "json_schema",
					json_schema: { strict: true },
				});
			} else {
				expect(parsedWireBody).not.toHaveProperty("response_format");
			}
			expect(parsedWireBody).not.toHaveProperty("input");
			expect(parsedWireBody).not.toHaveProperty("instructions");
		}
		expect(result.admissionRejection).toBeNull();
		expect(warmPreparationSignals).toHaveLength(5);
		expect(warmPreparationSignals.every((signal) => signal === operatorSignal)).toBe(true);
		expect(fixture.verifierCalls.count).toBe(6);
		expect(result.observation).toMatchObject({
			rerunEligible: true,
			familyPassed: false,
			result: {
				classification: "complete",
				verifierStatus: "failed",
				coldRunsAttempted: 1,
				warmRunsAttempted: 5,
				requests: 48,
				steps: 48,
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
		expect(result.observation.cold.actionTrace).toHaveLength(7);
		expect(result.observation.warmBranches[0]?.run?.actionTrace).toHaveLength(7);
		const calibrationSource = validateEmpiricalCalibrationTrialBlockObservation({
			...result.observation,
			schemaVersion: EMPIRICAL_CALIBRATION_TRIAL_BLOCK_OBSERVATION_SCHEMA,
			claimBoundary: B112_CALIBRATION_EXPLORATORY_NO_EFFICACY_CLAIM,
			profile: "calibration",
			blockIndex: 1,
		});
		const sourceObservationDigest = empiricalStrictJsonDigest(calibrationSource);
		const sourceRunDigest = empiricalStrictJsonDigest(relevantRun);
		const guidanceVerifierRef = "guidance-verifier.d684";
		const guidanceVerifierRevision = "guidance-verifier.d684.v1";
		const guidanceCoordinates = {
			repositoryScopeCorrect: true,
			targetFileCorrect: true,
			targetSymbolCorrect: null,
			targetTestCorrect: true,
			failureClassCorrect: true,
		};
		const guidanceAssessment = {
			verifierRef: guidanceVerifierRef,
			verifierRevision: guidanceVerifierRevision,
			sourceObservationDigest,
			sourceRunDigest,
			horizonStatus: "progress-observed" as const,
			nonEvaluableReason: null,
			coordinates: guidanceCoordinates,
			coordinateEvidenceDigest: developerGuidanceCoordinateEvidenceDigest({
				verifierRef: guidanceVerifierRef,
				verifierRevision: guidanceVerifierRevision,
				sourceObservationDigest,
				sourceRunDigest,
				coordinates: guidanceCoordinates,
			}),
			actions: relevantRun.actionTrace.map((action, index) => ({
				actionIndex: index,
				intentDigest: action.intentDigest,
				resultDigest: action.resultDigest,
				toolRef: action.toolRef,
				valid: true,
				repeatedKnownFailureRoute: false,
				harmful: false,
				verifierProgressEvidenceDigest:
					index === relevantRun.actionTrace.length - 1
						? developerGuidanceActionProgressEvidenceDigest({
								verifierRef: guidanceVerifierRef,
								verifierRevision: guidanceVerifierRevision,
								sourceObservationDigest,
								sourceRunDigest,
								actionIndex: index,
								intentDigest: action.intentDigest,
								resultDigest: action.resultDigest,
								toolRef: action.toolRef,
							})
						: null,
			})),
			finalTaskVerifierEvidenceDigest: relevantRun.verifierEvidenceDigests[0] ?? null,
		};
		let invalidHorizonVerifierCalls = 0;
		expect(() =>
			createDeveloperGuidanceObservation({
				sourceObservation: calibrationSource,
				arm: "relevant-applied",
				observationId: "guidance.relevant.invalid-horizon",
				comparisonCoordinatesDigest: empiricalStrictJsonDigest({
					taskRef: calibrationSource.taskRef,
					manifestDigest: calibrationSource.manifestDigest,
				}),
				horizon: { maxRequests: 8, maxActions: 6 },
				verifier: {
					verifierRef: guidanceVerifierRef,
					verifierRevision: guidanceVerifierRevision,
					assess: () => {
						invalidHorizonVerifierCalls += 1;
						return guidanceAssessment;
					},
				},
			}),
		).toThrow(/source run exceeded its frozen horizon/);
		expect(invalidHorizonVerifierCalls).toBe(0);
		expect(() =>
			createDeveloperGuidanceObservation({
				sourceObservation: calibrationSource,
				arm: "relevant-applied",
				observationId: "guidance.relevant.oversized-assessment",
				comparisonCoordinatesDigest: empiricalStrictJsonDigest({
					taskRef: calibrationSource.taskRef,
					manifestDigest: calibrationSource.manifestDigest,
				}),
				horizon: { maxRequests: 8, maxActions: 8 },
				verifier: {
					verifierRef: guidanceVerifierRef,
					verifierRevision: guidanceVerifierRevision,
					assess: () => ({
						...guidanceAssessment,
						actions: [...guidanceAssessment.actions, guidanceAssessment.actions[0]],
					}),
				},
			}),
		).toThrow(/escaped its frozen action horizon/);
		const guidance = createDeveloperGuidanceObservation({
			sourceObservation: calibrationSource,
			arm: "relevant-applied",
			observationId: "guidance.relevant.block-1",
			comparisonCoordinatesDigest: empiricalStrictJsonDigest({
				taskRef: calibrationSource.taskRef,
				manifestDigest: calibrationSource.manifestDigest,
			}),
			horizon: { maxRequests: 8, maxActions: 8 },
			verifier: {
				verifierRef: guidanceVerifierRef,
				verifierRevision: guidanceVerifierRevision,
				assess: () => guidanceAssessment,
			},
		});
		expect(() =>
			createDeveloperGuidanceObservation({
				sourceObservation: calibrationSource,
				arm: "relevant-applied",
				observationId: "guidance.relevant.substituted",
				comparisonCoordinatesDigest: guidance.comparisonCoordinatesDigest,
				horizon: guidance.horizon,
				verifier: {
					verifierRef: guidanceVerifierRef,
					verifierRevision: guidanceVerifierRevision,
					assess: () => ({
						...guidanceAssessment,
						sourceRunDigest: `sha256:${"0".repeat(64)}`,
					}),
				},
			}),
		).toThrow(/source-bound|not bound to its source observation/);
		const finalProgressDigest = guidanceAssessment.actions.at(-1)?.verifierProgressEvidenceDigest;
		if (finalProgressDigest === undefined || finalProgressDigest === null) {
			throw new TypeError("guidance progress receipt is missing");
		}
		expect(() =>
			createDeveloperGuidanceObservation({
				sourceObservation: calibrationSource,
				arm: "relevant-applied",
				observationId: "guidance.relevant.early-progress-substitution",
				comparisonCoordinatesDigest: guidance.comparisonCoordinatesDigest,
				horizon: guidance.horizon,
				verifier: {
					verifierRef: guidanceVerifierRef,
					verifierRevision: guidanceVerifierRevision,
					assess: () => ({
						...guidanceAssessment,
						actions: guidanceAssessment.actions.map((action, index) => ({
							...action,
							verifierProgressEvidenceDigest: index === 0 ? finalProgressDigest : null,
						})),
					}),
				},
			}),
		).toThrow(/progress evidence is not action-bound/);
		expect(guidance).toMatchObject({
			arm: "relevant-applied",
			evaluable: true,
			finalTaskVerifierPassed: true,
			evidence: {
				sourceObservationDigest,
				sourceRunDigest,
				memoryDelivered: true,
				modelAttributedMemory: false,
				validActionObserved: true,
				verifierProgressObserved: true,
			},
		});
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
		expect(actorInputs).toHaveLength(48);
		expect(actorInputs.slice(0, 8).every((body) => !body.includes('"memoryContext"'))).toBe(true);
		expect(actorInputs.slice(8, 16).every((body) => body.includes('"memoryContext"'))).toBe(true);
		expect(actorInputs.slice(16).every((body) => !body.includes('"memoryContext"'))).toBe(true);
		expect(actorInputs[8]).toContain("Previous bounded action route");
		expect(actorInputs[8]).toContain(CLOSED_ACTOR_TOOL_REFS.readFile);
		expect(actorInputs[8]).not.toMatch(/managed-compute|tool-provider-run-admission/);
		expect(actorInputs[8]).not.toContain(taskSpecificCorrectionSentinel);
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
			async request(input) {
				boundedTransportCalls += 1;
				const requestBody = JSON.parse(new TextDecoder().decode(input.body)) as {
					readonly tools: readonly {
						readonly function: { readonly name: string };
					}[];
					readonly messages: readonly {
						readonly role: string;
						readonly content: string;
					}[];
				};
				const userMessage = requestBody.messages.find((message) => message.role === "user");
				if (userMessage === undefined) throw new TypeError("missing bounded GLM user message");
				const envelope = JSON.parse(userMessage.content) as {
					readonly turn?: { readonly finalStep?: boolean };
				};
				const output =
					envelope.turn?.finalStep === true
						? [
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
							]
						: [
								{
									type: "function_call",
									status: "completed",
									call_id: `call.bounded.${boundedTransportCalls}`,
									name: requestBody.tools[0]?.function.name,
									arguments: JSON.stringify({ path: "README.md" }),
								},
							];
				return dryRunOpenRouterResponse(
					`response.bounded.${boundedTransportCalls}`,
					output,
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
		expect(boundedTransportCalls).toBe(11);
		expect(preparationFailure.observation).toMatchObject({
			result: { classification: "incomplete", requests: 8, warmRunsAttempted: 0 },
		});
		expect(preparationFailure.observation.issueCodes).toContain("warm-host-preparation-failed");
	}, 60_000);

	it("lets the D716 Graph schedule all warm arms after a passing cold run", async () => {
		const fixture = await createClosedHostFixture(
			undefined,
			"broken-placeholder-value\n",
			"deepseek-v4-flash-high",
		);
		const failedCold = await runClosedTaskProfileHost({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			initialRequest: fixture.initialRequest,
			taskProfile: fixture.taskProfile,
			materialization: fixture.materialization,
			modelTurnPort: scriptedPort(fixture, () => ({
				finishReason: "structured-output",
				structuredOutput: {
					kind: "model-turn-output-placeholder",
					summary: "independent D716 arm definitions",
				},
			})),
			protectionExecutor: fixture.protectionExecutor,
			verifier: fixture.verifier,
			signal: new AbortController().signal,
		});
		expect(failedCold.verifierVerdict).toBe("failed");
		const warmReflection = prepareB112MatchedBlockReflection({
			coldRequest: fixture.initialRequest,
			coldOutcome: failedCold,
		});
		const coordinator = createD716GraphNativeSixArmCoordinator({
			qualificationDigest: D716_REQUIRED_D714_D715_QUALIFICATION_DIGEST,
			infrastructureEvidenceDigest: empiricalStrictJsonDigest({
				kind: "d716-simulated-infrastructure",
				taskRef: fixture.initialRequest.taskRef,
			}),
			warmReflection,
		});
		const graphNativeEvalAuthority = createD719GraphNativeEvalAuthority({ coordinator });
		let transportCalls = 0;
		let monotonicMs = 0;
		const baseContentDigest = empiricalSha256(encoder.encode("broken-placeholder-value\n"));
		const transport: OpenRouterResponsesByteTransportV1 = {
			async request(request) {
				transportCalls += 1;
				const body = JSON.parse(new TextDecoder().decode(request.body)) as {
					readonly messages: readonly { readonly role: string; readonly content: string }[];
					readonly tools: readonly { readonly function: { readonly name: string } }[];
				};
				const user = body.messages.find((message) => message.role === "user");
				if (user === undefined) throw new TypeError("D716 Chat fixture omitted the user turn");
				const envelope = JSON.parse(user.content) as {
					readonly turn: { readonly stepIndex: number; readonly finalStep: boolean };
				};
				const step = envelope.turn.stepIndex;
				const output = envelope.turn.finalStep
					? [
							{
								type: "message",
								role: "assistant",
								status: "completed",
								content: [
									{
										type: "output_text",
										text: JSON.stringify({
											kind: "model-turn-output-placeholder",
											summary: "D716 arm completed",
										}),
									},
								],
							},
						]
					: step === 0
						? [
								{
									type: "function_call",
									status: "completed",
									call_id: `call.d716.replace.${transportCalls}`,
									name: body.tools[2]?.function.name,
									arguments: JSON.stringify({
										baseContentDigest,
										newText: "fixed",
										oldText: "broken-placeholder-value",
										path: "README.md",
									}),
								},
							]
						: step === 1
							? [
									{
										type: "function_call",
										status: "completed",
										call_id: `call.d716.diff.${transportCalls}`,
										name: body.tools[3]?.function.name,
										arguments: "{}",
									},
								]
							: step === 2
								? [
										{
											type: "function_call",
											status: "completed",
											call_id: `call.d716.command.${transportCalls}`,
											name: body.tools[4]?.function.name,
											arguments: JSON.stringify({ commandRef: "actor.status" }),
										},
									]
								: [
										{
											type: "function_call",
											status: "completed",
											call_id: `call.d716.read.${transportCalls}`,
											name: body.tools[0]?.function.name,
											arguments: JSON.stringify({ path: "README.md" }),
										},
									];
				return dryRunOpenRouterResponse(`response.d716.${transportCalls}`, output, undefined, {
					requestModel: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
					downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
				});
			},
		};
		const matched = await runOpenRouterMatchedTrialBlock({
			host: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: await fixture.prepareFreshMaterialization(new AbortController().signal),
				verifier: fixture.verifier,
			},
			routeQualification: simulatedRouteQualification(fixture, {
				maxRequests: 48,
				maxStepsPerRun: 8,
			}),
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: "D716_SIMULATED_CREDENTIAL_SENTINEL",
			},
			transport,
			monotonicMeasurement: { readMs: () => (monotonicMs += 1) },
			executionClass: "simulated-contract",
			signal: new AbortController().signal,
			retryWait: immediateRetryWait,
			prepareWarmHost: ({ signal }) => fixture.prepareFreshMaterialization(signal),
			graphNativeSixArmCoordinator: coordinator,
			graphNativeEvalAuthority,
		});
		expect(matched.profile).toBe("smoke");
		expect(transportCalls).toBe(48);
		expect(matched.observation).toMatchObject({
			rerunEligible: false,
			cold: { verifierStatus: "passed" },
			result: { coldRunsAttempted: 1, warmRunsAttempted: 5 },
		});
		expect(matched.graphNativeCoordination).toMatchObject({
			coordinatorRevision: D716_GRAPH_NATIVE_COORDINATOR_REVISION,
			issuedArms: [
				"cold",
				"relevant-applied",
				"proposal-only",
				"admission-rejected",
				"irrelevant-applied",
				"wrong-scope-applied",
			],
			completedArms: [
				"cold",
				"relevant-applied",
				"proposal-only",
				"admission-rejected",
				"irrelevant-applied",
				"wrong-scope-applied",
			],
			maxActiveArms: 1,
			warmArmsIndependentOfCold: true,
			causalAttribution: "undetermined",
			efficacyClaim: "none",
		});
		expect(matched.graphNativeCoordination?.progress).toHaveLength(6);
		expect(matched.graphNativeCoordination?.progress.map((progress) => progress.phase)).toEqual(
			Array.from({ length: 6 }, () => "hidden-verifier-passed"),
		);
		const graphBudgetEvidence = validateD719GraphNativeBudgetEvidence(
			matched.graphNativeBudgetEvidence,
		);
		expect(graphBudgetEvidence).toMatchObject({
			authorityRevision: D719_GRAPH_NATIVE_EVAL_AUTHORITY_REVISION,
			exhausted: false,
			causalAttribution: "undetermined",
			efficacyClaim: "none",
		});
		expect(
			graphBudgetEvidence.decisions.filter((decision) => decision.kind === "transport-admission"),
		).toHaveLength(48);
		expect(graphBudgetEvidence.decisions.every((decision) => decision.reasons.length === 0)).toBe(
			true,
		);
		const boundaryCoordinator = createD716GraphNativeSixArmCoordinator({
			qualificationDigest: D716_REQUIRED_D714_D715_QUALIFICATION_DIGEST,
			infrastructureEvidenceDigest: empiricalStrictJsonDigest({
				kind: "d719-budget-boundary-fixture",
			}),
			warmReflection,
		});
		const boundaryAuthority = createD719GraphNativeEvalAuthority({
			coordinator: boundaryCoordinator,
		});
		let d719AccessorHits = 0;
		const accessorRequest = {};
		Object.defineProperty(accessorRequest, "input", {
			enumerable: true,
			get() {
				d719AccessorHits += 1;
				return { value: { arm: "cold" } };
			},
		});
		expect(() =>
			beginD719GraphNativeBudgetArm(boundaryAuthority, accessorRequest as never),
		).toThrow("exact active D716 arm request");
		expect(d719AccessorHits).toBe(0);
		beginD719GraphNativeBudgetArm(
			boundaryAuthority,
			takeNextD716GraphNativeArmRequest(boundaryCoordinator),
		);
		const boundaryDecision = decideD719GraphNativeBudget(boundaryAuthority, {
			kind: "transport-admission",
			requestRef: "d719.boundary.request",
			wireRequestBytes: 128,
			maxOutputTokens: 64,
			reservedInputTokens: 128,
			reservedCostMicrousd: 1,
			prospectiveInputTokens: 128,
			prospectiveOutputTokens: 64,
			prospectiveCostMicrousd: 1,
			state: {
				requests: 1,
				currentRunRequestCount: 1,
				requestAlreadySeen: false,
				pendingReservation: false,
				reservedInputTokens: 0,
				reservedOutputTokens: 0,
				reservedCostMicrousd: 0,
				latencyMs: 0,
			},
			limits: {
				maxRequests: 1,
				maxStepsPerRun: 8,
				maxCanonicalRequestBytes: 1_024,
				maxInputTokens: 1_024,
				maxOutputTokens: 1_024,
				maxCostMicrousd: 1_024,
				maxLatencyMs: 1_024,
				enforceElapsedAdmission: true,
			},
		});
		expect(boundaryDecision).toMatchObject({
			arm: "cold",
			admitted: false,
			exhausted: true,
			reasons: ["request-limit"],
		});
		const boundaryEvidence = validateD719GraphNativeBudgetEvidence(
			snapshotD719GraphNativeBudgetEvidence(boundaryAuthority),
		);
		expect(boundaryEvidence).toMatchObject({ exhausted: true });
		const forgedDecision = {
			...boundaryEvidence.decisions[0],
			reasons: [],
			exhausted: false,
			admitted: true,
		};
		const forgedMaterial = {
			...boundaryEvidence,
			decisions: [forgedDecision],
			exhausted: false,
		};
		const { evidenceDigest: _evidenceDigest, ...forgedWithoutDigest } = forgedMaterial;
		expect(() =>
			validateD719GraphNativeBudgetEvidence({
				...forgedWithoutDigest,
				evidenceDigest: empiricalStrictJsonDigest(forgedWithoutDigest),
			}),
		).toThrow("not the canonical Graph projection");
		expect(() =>
			decideD719GraphNativeBudget(boundaryAuthority, {
				kind: "elapsed-check",
				requestRef: "block",
				measuredElapsedMs: 0,
				deadlineSignalAborted: false,
				state: boundaryEvidence.facts[0]!.state,
				limits: { ...boundaryEvidence.facts[0]!.limits, maxRequests: 2 },
			}),
		).toThrow("budget limits drifted");
		expect(() =>
			decideD719GraphNativeBudget(boundaryAuthority, {
				kind: "elapsed-check",
				requestRef: "block",
				measuredElapsedMs: 0,
				deadlineSignalAborted: false,
				state: {
					requests: 0,
					currentRunRequestCount: 0,
					requestAlreadySeen: false,
					pendingReservation: false,
					reservedInputTokens: 0,
					reservedOutputTokens: 0,
					reservedCostMicrousd: 0,
					latencyMs: 0,
				},
				limits: {
					maxRequests: 1,
					maxStepsPerRun: 1,
					maxCanonicalRequestBytes: 1,
					maxInputTokens: 1,
					maxOutputTokens: 1,
					maxCostMicrousd: 1,
					maxLatencyMs: 1,
					enforceElapsedAdmission: true,
				},
				sequence: 99,
			} as never),
		).toThrow("provenance coordinates are Graph-owned");
		const qualification = createD716GraphNativeLiveQualification({
			result: matched,
			warmReflection,
		});
		expect(qualification.gates).toEqual({
			exactSixArmOrder: true,
			allSixArmsCompleted: true,
			warmArmsIndependentOfCold: true,
			oneActiveArm: true,
			workItemExecutionRecipeUsed: true,
			nonEvaluableColdStillAdvances: true,
			wrongProvenanceRejected: true,
			duplicateOrStaleCompletionRejected: true,
			accessorRejectedBeforeRead: true,
			failureFactsRemainMaterialFree: true,
			noNetwork: true,
			providerCallCount: 0,
			chargedCostMicrousd: 0,
		});
		let d717RetryInjected = false;
		const d717RetryingTransport: OpenRouterResponsesByteTransportV1 = {
			request(request) {
				if (!d717RetryInjected) {
					d717RetryInjected = true;
					return Promise.resolve({
						status: 429,
						body: encoder.encode(
							JSON.stringify({ error: { message: "bounded D717 injected untyped 429" } }),
						),
						retryAfterMs: 7_000,
					});
				}
				return transport.request(request);
			},
		};
		const d717RetryWait: OpenRouterFirstTaskRetryWaitCapabilityV1 = {
			async wait(request) {
				monotonicMs += request.delayMs;
			},
		};
		const d717 = await runD717GraphNativePreLiveBlock({
			d716Qualification: qualification,
			historicalBaseline: createD717InjectedHistoricalBaselineReceipt({
				sourceObservationDigest: D714_D713_SOURCE_OBSERVATION_DIGEST,
			}),
			warmReflection,
			block: {
				host: {
					frozen: fixture.frozen,
					qualificationReport: fixture.report,
					initialRequest: fixture.initialRequest,
					taskProfile: fixture.taskProfile,
					materialization: await fixture.prepareFreshMaterialization(new AbortController().signal),
					verifier: fixture.verifier,
				},
				routeQualification: liveRouteQualification(fixture, {
					maxRequests: 48,
					maxStepsPerRun: 8,
				}),
				credential: {
					credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
					credentialBindingRevision:
						fixture.frozen.manifest.policies.actorCredentialBindingRevision,
					bearerToken: "D717_INJECTED_CREDENTIAL_SENTINEL",
				},
				transport,
				monotonicMeasurement: { readMs: () => (monotonicMs += 1) },
				executionClass: "live-provider",
				signal: new AbortController().signal,
				retryWait: immediateRetryWait,
				untypedHttp429RetryPolicy: D710_UNTYPED_HTTP_429_RETRY_POLICY,
				prepareWarmHost: ({ signal }) => fixture.prepareFreshMaterialization(signal),
			},
		});
		expect(d717.observation).toMatchObject({
			executionClass: "live-provider",
			issuedArms: D716_GRAPH_NATIVE_ARM_ORDER,
			completedArms: D716_GRAPH_NATIVE_ARM_ORDER,
			transportCalls: 48,
			retryWaitCalls: 0,
			maximumConcurrentTransportCalls: 1,
			nextArmAuthority: "graph-only",
			callerRole: "execute-and-present-immutable-completion-fact",
			decisionEvidenceSource: "graph-projected-completion-facts",
			graphSelectedArmCount: 6,
			callerSelectedArmCount: 0,
			workspaceCleanupComplete: true,
			coldOutcomeCensoredWarmArms: false,
			causalAttribution: "undetermined",
			efficacyClaim: "none",
		});
		expect(d717.scorecard).toMatchObject({
			qualified: false,
			graphIntegrationQualified: true,
			historicalBaselineBytesQualified: false,
			completedArmCount: 6,
			firstHarnessFindingArm: null,
			harnessFindingCode: "no-harness-blocker-observed",
		});
		const d717Retry = await runD717GraphNativePreLiveBlock({
			d716Qualification: qualification,
			historicalBaseline: createD717InjectedHistoricalBaselineReceipt({
				sourceObservationDigest: D714_D713_SOURCE_OBSERVATION_DIGEST,
			}),
			warmReflection,
			block: {
				host: {
					frozen: fixture.frozen,
					qualificationReport: fixture.report,
					initialRequest: fixture.initialRequest,
					taskProfile: fixture.taskProfile,
					materialization: await fixture.prepareFreshMaterialization(new AbortController().signal),
					verifier: fixture.verifier,
				},
				routeQualification: liveRouteQualification(fixture, {
					maxRequests: 48,
					maxStepsPerRun: 8,
				}),
				credential: {
					credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
					credentialBindingRevision:
						fixture.frozen.manifest.policies.actorCredentialBindingRevision,
					bearerToken: "D717_RETRY_CREDENTIAL_SENTINEL",
				},
				transport: d717RetryingTransport,
				monotonicMeasurement: { readMs: () => (monotonicMs += 1) },
				executionClass: "live-provider",
				signal: new AbortController().signal,
				retryWait: d717RetryWait,
				untypedHttp429RetryPolicy: D710_UNTYPED_HTTP_429_RETRY_POLICY,
				prepareWarmHost: ({ signal }) => fixture.prepareFreshMaterialization(signal),
			},
		});
		expect(d717Retry.observation).toMatchObject({
			completedArms: D716_GRAPH_NATIVE_ARM_ORDER,
			retryWaitCalls: 1,
			maximumConcurrentTransportCalls: 1,
			workspaceCleanupComplete: true,
			coldOutcomeCensoredWarmArms: false,
			causalAttribution: "undetermined",
			efficacyClaim: "none",
		});
		expect(d717Retry.observation.transportCalls).toBe(d717Retry.observation.underlyingAttempts);
		expect(d717Retry.observation.graphRequests).toBe(d717Retry.observation.underlyingRequests);
		expect(JSON.stringify(d717Retry)).not.toContain("D717_RETRY_CREDENTIAL_SENTINEL");
		expect(d717Retry.scorecard.harnessFindingCode).toBe(
			"review-budget-admission-or-request-efficiency",
		);
		const d717PrivateRoot = join(temporaryRoot("d717-private"), ".private");
		const d717Persisted = await persistD717GraphNativePrivateGeneration({
			privateRoot: d717PrivateRoot,
			generationRef: "d717-injected-live-provider-full-six-arm",
			observation: d717.observation,
			scorecard: d717.scorecard,
		});
		for (const file of [
			"graph-native-prelive-observation.v1.json",
			"graph-native-prelive-scorecard.v1.json",
			"generation.v1.json",
		]) {
			expect(statSync(join(d717Persisted.generationPath, file)).mode & 0o777).toBe(0o600);
			expect(readFileSync(join(d717Persisted.generationPath, file), "utf8")).not.toContain(
				"D717_INJECTED_CREDENTIAL_SENTINEL",
			);
		}
		await expect(
			persistD717GraphNativePrivateGeneration({
				privateRoot: d717PrivateRoot,
				generationRef: "d717-injected-live-provider-full-six-arm",
				observation: d717.observation,
				scorecard: d717.scorecard,
			}),
		).rejects.toThrow(/same-process|already exists/);
		const forgedMaterialization = await fixture.prepareFreshMaterialization(
			new AbortController().signal,
		);
		try {
			await expect(
				runOpenRouterMatchedTrialBlock({
					host: {
						frozen: fixture.frozen,
						qualificationReport: fixture.report,
						initialRequest: fixture.initialRequest,
						taskProfile: fixture.taskProfile,
						materialization: forgedMaterialization,
						verifier: fixture.verifier,
					},
					routeQualification: liveRouteQualification(fixture),
					credential: {
						credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
						credentialBindingRevision:
							fixture.frozen.manifest.policies.actorCredentialBindingRevision,
						bearerToken: "D717_FORGED_CAPABILITY_SENTINEL",
					},
					transport,
					monotonicMeasurement: { readMs: () => (monotonicMs += 1) },
					executionClass: "live-provider",
					signal: new AbortController().signal,
					retryWait: immediateRetryWait,
					prepareWarmHost: ({ signal }) => fixture.prepareFreshMaterialization(signal),
					graphNativeSixArmCoordinator: createD716GraphNativeSixArmCoordinator({
						qualificationDigest: D716_REQUIRED_D714_D715_QUALIFICATION_DIGEST,
						infrastructureEvidenceDigest: empiricalStrictJsonDigest({ forged: true }),
						warmReflection,
					}),
					graphNativeLiveProviderCapability: {
						capabilityRevision: "d717.graph-native-live-provider-capability.v1",
					},
				}),
			).rejects.toThrow(/not constructed|does not bind/);
		} finally {
			await forgedMaterialization.cleanup();
		}
		const scorecard = createD716GraphNativeLiveScorecard(qualification);
		const d716PrivateRoot = join(temporaryRoot("d716-private"), ".private");
		const persisted = await persistD716GraphNativePrivateGeneration({
			privateRoot: d716PrivateRoot,
			generationRef: "d716-simulated-full-six-arm",
			qualification,
			scorecard,
		});
		for (const file of ["qualification.v1.json", "scorecard.v1.json", "generation.v1.json"]) {
			expect(statSync(join(persisted.generationPath, file)).mode & 0o777).toBe(0o600);
			expect(readFileSync(join(persisted.generationPath, file), "utf8")).not.toContain(
				"D716_SIMULATED_CREDENTIAL_SENTINEL",
			);
		}
		const failureCoordinator = createD716GraphNativeSixArmCoordinator({
			qualificationDigest: D716_REQUIRED_D714_D715_QUALIFICATION_DIGEST,
			infrastructureEvidenceDigest: empiricalStrictJsonDigest({
				kind: "d716-simulated-infrastructure",
				taskRef: fixture.initialRequest.taskRef,
				failurePath: true,
			}),
			warmReflection,
		});
		let failureTransportCalls = 0;
		const failureTransport: OpenRouterResponsesByteTransportV1 = {
			async request() {
				failureTransportCalls += 1;
				throw new TypeError("D716 injected simulated transport failure");
			},
		};
		const failureResult = await runOpenRouterMatchedTrialBlock({
			host: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: await fixture.prepareFreshMaterialization(new AbortController().signal),
				verifier: fixture.verifier,
			},
			routeQualification: simulatedRouteQualification(fixture, {
				maxRequests: 48,
				maxStepsPerRun: 8,
			}),
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: "D716_FAILURE_CREDENTIAL_SENTINEL",
			},
			transport: failureTransport,
			monotonicMeasurement: { readMs: () => (monotonicMs += 1) },
			executionClass: "simulated-contract",
			signal: new AbortController().signal,
			retryWait: immediateRetryWait,
			untypedHttp429RetryPolicy: D710_UNTYPED_HTTP_429_RETRY_POLICY,
			prepareWarmHost: async () => {
				throw new TypeError("D716 injected warm materialization failure");
			},
			graphNativeSixArmCoordinator: failureCoordinator,
		});
		expect(failureTransportCalls).toBe(1);
		expect(failureResult.observation.cold.classification).toBe("non-evaluable");
		expect(failureResult.graphNativeCoordination?.completedArms).toEqual(
			D716_GRAPH_NATIVE_ARM_ORDER,
		);
		expect(failureResult.graphNativeCoordination?.progress.slice(1)).toEqual(
			Array.from({ length: 5 }, () =>
				expect.objectContaining({
					phase: "none",
					stoppedReason: "warm-preparation-failed",
				}),
			),
		);
		expect(JSON.stringify(failureResult.graphNativeCoordination)).not.toContain(
			"D716_FAILURE_CREDENTIAL_SENTINEL",
		);
		const failureQualification = createD716GraphNativeLiveQualification({
			result: failureResult,
			warmReflection,
		});
		const d717Failure = await runD717GraphNativePreLiveBlock({
			d716Qualification: failureQualification,
			historicalBaseline: createD717InjectedHistoricalBaselineReceipt({
				sourceObservationDigest: D714_D713_SOURCE_OBSERVATION_DIGEST,
			}),
			warmReflection,
			block: {
				host: {
					frozen: fixture.frozen,
					qualificationReport: fixture.report,
					initialRequest: fixture.initialRequest,
					taskProfile: fixture.taskProfile,
					materialization: await fixture.prepareFreshMaterialization(new AbortController().signal),
					verifier: fixture.verifier,
				},
				routeQualification: liveRouteQualification(fixture, {
					maxRequests: 48,
					maxStepsPerRun: 8,
				}),
				credential: {
					credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
					credentialBindingRevision:
						fixture.frozen.manifest.policies.actorCredentialBindingRevision,
					bearerToken: "D717_FAILURE_CREDENTIAL_SENTINEL",
				},
				transport: failureTransport,
				monotonicMeasurement: { readMs: () => (monotonicMs += 1) },
				executionClass: "live-provider",
				signal: new AbortController().signal,
				retryWait: immediateRetryWait,
				untypedHttp429RetryPolicy: D710_UNTYPED_HTTP_429_RETRY_POLICY,
				prepareWarmHost: async () => {
					throw new TypeError("D717 injected warm materialization failure");
				},
			},
		});
		expect(d717Failure.observation).toMatchObject({
			completedArms: D716_GRAPH_NATIVE_ARM_ORDER,
			transportCalls: 1,
			underlyingWarmRunsAttempted: 0,
			workspaceCleanupComplete: true,
			workspaceResidueCount: 0,
			coldOutcomeCensoredWarmArms: false,
			causalAttribution: "undetermined",
			efficacyClaim: "none",
		});
		expect(d717Failure.observation.graphProgressPhases).toEqual(
			Array.from({ length: 6 }, () => "none"),
		);
		expect(JSON.stringify(d717Failure)).not.toContain("D717_FAILURE_CREDENTIAL_SENTINEL");
		expect(d717Failure.scorecard).toMatchObject({
			firstHarnessFindingArm: "cold",
			harnessFindingCode: "inspect-provider-or-pre-tool-failure",
		});
		const failureScorecard = createD716GraphNativeLiveScorecard(failureQualification);
		await expect(
			persistD716GraphNativePrivateGeneration({
				privateRoot: d716PrivateRoot,
				generationRef: "d716-simulated-full-six-arm",
				qualification: failureQualification,
				scorecard: failureScorecard,
			}),
		).rejects.toThrow("generation already exists");
		expect(readdirSync(d716PrivateRoot).some((entry) => entry.startsWith(".d716-staging-"))).toBe(
			false,
		);
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
			"openrouter-error-body-shape:json-object",
			"openrouter-error-code:invalid_prompt",
			"openrouter-error-media-class:json",
			"openrouter-error-recognized-code:present",
			"openrouter-error-recognized-type:absent",
			"openrouter-error-type:unrecognized",
			"openrouter-http-status:400",
			"openrouter-invalid-unsupported-response",
			"openrouter-retry-after-parse:unavailable",
			"openrouter-retry-after-presence:unavailable",
		]);
		expect(result.scorecard.issueCodes).toEqual(result.observation.issueCodes);
		for (const file of readdirSync(result.persistence.generationPath)) {
			expect(readFileSync(join(result.persistence.generationPath, file), "utf8")).not.toContain(
				rejectionCredentialSentinel,
			);
		}
	});

	it("persists a bounded GLM response diagnostic without raw tool-call material", async () => {
		const fixture = await createClosedHostFixture(undefined, undefined, "glm-5.2-high");
		const credentialSentinel = "openrouter-diagnostic-secret-0123456789";
		const rawProviderSentinel = "raw-provider-tool-call-must-not-persist";
		const privateRoot = join(
			temporaryRoot("provider-response-diagnostic"),
			".private",
			"empirical-memory-rerun-avoidance",
		);
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
				bearerToken: credentialSentinel,
			},
			transport: {
				request(input) {
					transportCalls += 1;
					const requestBody = JSON.parse(new TextDecoder().decode(input.body)) as {
						readonly tools: readonly {
							readonly function: { readonly name: string };
						}[];
					};
					const toolName = requestBody.tools[0]?.function.name;
					if (toolName === undefined) throw new TypeError("missing bounded GLM tool");
					return Promise.resolve(
						dryRunOpenRouterResponse(
							"response.bounded-diagnostic.1",
							[
								{
									type: "function_call",
									status: "completed",
									call_id: "call.bounded-diagnostic.1",
									name: toolName,
									arguments: JSON.stringify({ path: "README.md" }),
								},
								{
									type: "function_call",
									status: "completed",
									call_id: "call.bounded-diagnostic.2",
									name: rawProviderSentinel,
									arguments: JSON.stringify({ path: "README.md" }),
								},
							],
							undefined,
							{
								requestModel: OPENROUTER_GLM_5_2_REQUEST_MODEL,
								downstreamProviderName: OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME,
							},
						),
					);
				},
			},
			monotonicMeasurement: { readMs: () => 0 },
			retryWait: immediateRetryWait,
			executionClass: "live-provider",
			privateRoot,
			generationRef: "provider-response-diagnostic-generation",
			signal: new AbortController().signal,
		});
		expect(transportCalls).toBe(1);
		expect(result.observation).toMatchObject({
			result: { classification: "non-evaluable", requests: 1 },
		});
		expect(result.observation.issueCodes).toContain(
			OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.toolNameUnknown,
		);
		expect(result.scorecard.issueCodes).toEqual(result.observation.issueCodes);
		const persistedArtifacts = readdirSync(result.persistence.generationPath).map((file) =>
			readFileSync(join(result.persistence.generationPath, file), "utf8"),
		);
		expect(persistedArtifacts.join("\n")).toContain(
			OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.toolNameUnknown,
		);
		for (const persisted of persistedArtifacts) {
			expect(persisted).not.toContain(rawProviderSentinel);
			expect(persisted).not.toContain(credentialSentinel);
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
	}, 30_000);

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

	it("qualifies only a first untyped D710 429 and freezes Retry-After or the 60-second fallback", () => {
		const baseIssues = [
			"openrouter-error-body-shape:json-object",
			"openrouter-error-media-class:json",
			"openrouter-error-recognized-code:absent",
			"openrouter-error-recognized-type:absent",
			"openrouter-http-status:429",
			"openrouter-quota-rate-limit",
		] as const;
		const outcome = (retryIssues: readonly string[]) => ({
			status: "non-evaluable" as const,
			issueCodes: [...baseIssues, ...retryIssues].sort(),
		});
		expect(
			d710UntypedHttp429RetryDelayMs(
				outcome(["openrouter-retry-after-parse:absent", "openrouter-retry-after-presence:absent"]),
				1,
			),
		).toBe(60_000);
		expect(
			d710UntypedHttp429RetryDelayMs(
				outcome([
					"openrouter-retry-after-ms:7000",
					"openrouter-retry-after-parse:parsed",
					"openrouter-retry-after-presence:present",
				]),
				1,
			),
		).toBe(7_000);
		expect(
			d710UntypedHttp429RetryDelayMs(
				outcome([
					"openrouter-retry-after-parse:invalid",
					"openrouter-retry-after-presence:present",
				]),
				1,
			),
		).toBe(60_000);
		expect(
			d710UntypedHttp429RetryDelayMs(
				{
					...outcome([
						"openrouter-retry-after-parse:absent",
						"openrouter-retry-after-presence:absent",
					]),
					issueCodes: [
						...outcome([
							"openrouter-retry-after-parse:absent",
							"openrouter-retry-after-presence:absent",
						]).issueCodes,
						"openrouter-error-type:payment_required",
					],
				},
				1,
			),
		).toBeNull();
		expect(
			d710UntypedHttp429RetryDelayMs(
				outcome(["openrouter-retry-after-parse:absent", "openrouter-retry-after-presence:absent"]),
				2,
			),
		).toBeNull();

		let getterHits = 0;
		const accessorPolicy = Object.defineProperty(
			{ ...D710_UNTYPED_HTTP_429_RETRY_POLICY },
			"policyRevision",
			{
				enumerable: true,
				get() {
					getterHits += 1;
					return D710_UNTYPED_HTTP_429_RETRY_POLICY.policyRevision;
				},
			},
		);
		expect(() => validateD710UntypedHttp429RetryPolicy(accessorPolicy)).toThrow();
		expect(getterHits).toBe(0);
	});

	it("retries one exact DeepSeek untyped 429 through the shared ledger and stops a repeated untyped 429", async () => {
		const runCase = async (
			terminalRetryOutcome: "recover" | "double-recover" | "untyped-429" | "typed-503",
		) => {
			const fixture = await createClosedHostFixture(undefined, undefined, "deepseek-v4-flash-high");
			const route = simulatedRouteQualification(fixture, { maxLatencyMs: 180_000 });
			const routeIdentity = {
				requestModel: route.requestModel,
				downstreamProviderName: route.downstreamProviderName,
			};
			const baseContentDigest = empiricalSha256(encoder.encode("broken-placeholder-value\n"));
			const requestBodies: Uint8Array[] = [];
			const waits: number[] = [];
			let transportCalls = 0;
			let activeCalls = 0;
			let maximumActiveCalls = 0;
			let measurement = 0;
			const artifactRoot = temporaryRoot(`d710-untyped-${terminalRetryOutcome}`);
			const privateRoot = join(artifactRoot, ".private", "empirical-memory-rerun-avoidance");
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
				routeQualification: route,
				credential: {
					credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
					credentialBindingRevision:
						fixture.frozen.manifest.policies.actorCredentialBindingRevision,
					bearerToken: "d710-offline-secret-sentinel-0123456789",
				},
				transport: {
					async request(input) {
						activeCalls += 1;
						maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
						transportCalls += 1;
						requestBodies.push(input.body.slice());
						try {
							if (
								transportCalls === 1 ||
								(terminalRetryOutcome === "double-recover" && transportCalls === 3) ||
								(terminalRetryOutcome === "untyped-429" && transportCalls === 2)
							) {
								return {
									status: 429,
									body: encoder.encode(
										JSON.stringify({ error: { message: "bounded simulated untyped 429" } }),
									),
									retryAfterMs: 7_000,
									retryAfterDisposition: "parsed" as const,
								};
							}
							if (terminalRetryOutcome === "typed-503" && transportCalls === 2) {
								return {
									status: 503,
									body: encoder.encode(
										JSON.stringify({
											error: {
												code: "server_error",
												message: "bounded simulated typed 503",
												metadata: { error_type: "provider_overloaded" },
											},
										}),
									),
									retryAfterMs: 1_000,
								};
							}
							if (transportCalls >= 3) {
								return dryRunOpenRouterResponse(
									"response.d710.final",
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
														summary: "D710 offline retry recovered",
													}),
												},
											],
										},
									],
									undefined,
									routeIdentity,
								);
							}
							const wire = JSON.parse(new TextDecoder().decode(input.body)) as {
								readonly tools?: readonly {
									readonly function?: {
										readonly name?: string;
										readonly parameters?: {
											readonly properties?: Readonly<Record<string, unknown>>;
										};
									};
								}[];
							};
							const replaceTool = wire.tools?.find((tool) =>
								Object.hasOwn(tool.function?.parameters?.properties ?? {}, "oldText"),
							)?.function?.name;
							if (replaceTool === undefined) throw new TypeError("D710 replace tool is missing");
							return dryRunOpenRouterResponse(
								"response.d710.replace",
								[
									{
										type: "function_call",
										status: "completed",
										call_id: "call.d710.replace",
										name: replaceTool,
										arguments: JSON.stringify({
											baseContentDigest,
											newText: "fixed",
											oldText: "broken-placeholder-value",
											path: "README.md",
										}),
									},
								],
								undefined,
								routeIdentity,
							);
						} finally {
							activeCalls -= 1;
						}
					},
				},
				monotonicMeasurement: { readMs: () => measurement },
				retryWait: {
					async wait(input) {
						waits.push(input.delayMs);
						measurement += input.delayMs;
					},
				},
				untypedHttp429RetryPolicy: D710_UNTYPED_HTTP_429_RETRY_POLICY,
				executionClass: "simulated-contract",
				privateRoot,
				generationRef: `d710-untyped-${terminalRetryOutcome}-generation`,
				signal: new AbortController().signal,
			});
			return { maximumActiveCalls, requestBodies, result, transportCalls, waits };
		};

		const recovered = await runCase("recover");
		expect(recovered.transportCalls).toBe(3);
		expect(recovered.maximumActiveCalls).toBe(1);
		expect(recovered.waits).toEqual([7_000]);
		expect(recovered.requestBodies[0]).toEqual(recovered.requestBodies[1]);
		expect(recovered.result.observation.cold).toMatchObject({
			classification: "complete",
			requests: 3,
			attempts: 3,
			steps: 2,
			retryWaitMs: 7_000,
			verifierStatus: "passed",
		});

		const recoveredTwiceAcrossLogicalTurns = await runCase("double-recover");
		expect(recoveredTwiceAcrossLogicalTurns.transportCalls).toBe(4);
		expect(recoveredTwiceAcrossLogicalTurns.maximumActiveCalls).toBe(1);
		expect(recoveredTwiceAcrossLogicalTurns.waits).toEqual([7_000, 7_000]);
		expect(recoveredTwiceAcrossLogicalTurns.requestBodies[0]).toEqual(
			recoveredTwiceAcrossLogicalTurns.requestBodies[1],
		);
		expect(recoveredTwiceAcrossLogicalTurns.requestBodies[2]).toEqual(
			recoveredTwiceAcrossLogicalTurns.requestBodies[3],
		);
		expect(recoveredTwiceAcrossLogicalTurns.result.observation.cold).toMatchObject({
			classification: "complete",
			requests: 4,
			attempts: 4,
			steps: 2,
			retryWaitMs: 14_000,
			verifierStatus: "passed",
		});

		const repeated = await runCase("untyped-429");
		expect(repeated.transportCalls).toBe(2);
		expect(repeated.maximumActiveCalls).toBe(1);
		expect(repeated.waits).toEqual([7_000]);
		expect(repeated.requestBodies[0]).toEqual(repeated.requestBodies[1]);
		expect(repeated.result.observation.cold).toMatchObject({
			classification: "non-evaluable",
			requests: 2,
			attempts: 2,
			steps: 1,
			retryWaitMs: 7_000,
			verifierStatus: "not-run",
		});
		expect(repeated.result.observation.issueCodes).not.toContain("model-turn-retry-exhausted");

		const typedAfterD710 = await runCase("typed-503");
		expect(typedAfterD710.transportCalls).toBe(2);
		expect(typedAfterD710.waits).toEqual([7_000]);
		expect(typedAfterD710.result.observation.cold).toMatchObject({
			classification: "non-evaluable",
			requests: 2,
			attempts: 2,
			steps: 1,
			verifierStatus: "not-run",
		});
	}, 30_000);

	it("retries an exact request-phase socket failure once and retains the ambiguous first attempt", async () => {
		const fixture = await createClosedHostFixture();
		const requestBodies: Uint8Array[] = [];
		const waits: number[] = [];
		let transportCalls = 0;
		let measurement = 0;
		const artifactRoot = temporaryRoot("request-socket-retry-private-artifacts");
		const privateRoot = join(artifactRoot, ".private", "empirical-memory-rerun-avoidance");
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
			routeQualification: simulatedRouteQualification(fixture),
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: "openrouter-request-socket-secret-sentinel-0123456789",
			},
			transport: {
				async request(input) {
					transportCalls += 1;
					requestBodies.push(input.body.slice());
					throw createOpenRouterTransportFailure(
						"request",
						Object.assign(new Error("raw socket provider material"), {
							code: "UND_ERR_SOCKET",
						}),
					);
				},
			},
			monotonicMeasurement: { readMs: () => measurement },
			retryWait: {
				async wait(input) {
					waits.push(input.delayMs);
					measurement += input.delayMs;
				},
			},
			executionClass: "simulated-contract",
			privateRoot,
			generationRef: "request-socket-retry-dry-run-generation",
			signal: new AbortController().signal,
		});

		expect(transportCalls).toBe(2);
		expect(waits).toEqual([5_000]);
		expect(requestBodies[0]).toEqual(requestBodies[1]);
		expect(result.observation.cold).toMatchObject({
			classification: "non-evaluable",
			requests: 2,
			steps: 1,
			attempts: 2,
			retryWaitMs: 5_000,
		});
		expect(result.observation.issueCodes).not.toContain("model-turn-retry-exhausted");
		expect(JSON.stringify(result)).not.toContain("raw socket provider material");
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
	}, 30_000);

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

	it("routes a calibration slot through the shared injected transport and pre-admits remaining budget", async () => {
		const fixture = await createClosedHostFixture(
			undefined,
			undefined,
			"gpt-5.6-sol-medium",
			"calibration",
		);
		const task = fixture.frozen.manifest.catalog.tasks[0] as EmpiricalCampaignTaskV1;
		const configuration = fixture.frozen.manifest.modelConfigurations[0];
		if (configuration === undefined) throw new TypeError("missing calibration actor fixture");
		let transportCalls = 0;
		const runner = createOpenRouterCalibrationEmpiricalRunner(async (scheduled) => {
			expect(scheduled.trialBlockRef).toBe(fixture.initialRequest.trialBlockRef);
			return {
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
					bearerToken: "calibration-injected-transport-secret",
				},
				transport: {
					request() {
						transportCalls += 1;
						return Promise.resolve(
							dryRunOpenRouterResponse("response.calibration.shared-core", [
								{
									type: "message",
									role: "assistant",
									status: "completed",
									content: [
										{
											type: "output_text",
											text: JSON.stringify({
												kind: "model-turn-output-placeholder",
												summary: "calibration injected-transport dry run",
											}),
										},
									],
								},
							]),
						);
					},
				},
				monotonicMeasurement: { readMs: () => 0 },
				retryWait: immediateRetryWait,
				executionClass: "simulated-contract",
			};
		});
		const trialBlock = createB112CalibrationTrialBlockIdentity(fixture.frozen, task.taskRef, 1);
		const observation = validateB112CalibrationEmpiricalBlockResult(
			await runner({
				configurationRef: configuration.configurationRef,
				configurationDigest: empiricalStrictJsonDigest(configuration),
				task,
				taskDigest: empiricalStrictJsonDigest(task),
				blockIndex: 1,
				blockOrdinal: 1,
				...trialBlock,
				remainingBudget: {
					campaignRequests: 1,
					campaignCostMicrousd: 1_000_000,
					campaignElapsedMs: 600_000,
					taskRequests: 1,
					taskCostMicrousd: 1_000_000,
				},
				signal: new AbortController().signal,
			}),
		).observation;
		expect(transportCalls).toBe(1);
		expect(observation).toMatchObject({
			profile: "calibration",
			blockIndex: 1,
			trialBlockRef: trialBlock.trialBlockRef,
			result: { requests: 1 },
		});
	}, 60_000);

	it("rejects a calibration request before injected transport when campaign remainder is zero", async () => {
		const fixture = await createClosedHostFixture(
			undefined,
			undefined,
			"gpt-5.6-sol-medium",
			"calibration",
		);
		const task = fixture.frozen.manifest.catalog.tasks[0] as EmpiricalCampaignTaskV1;
		const configuration = fixture.frozen.manifest.modelConfigurations[0];
		if (configuration === undefined) throw new TypeError("missing calibration actor fixture");
		let transportCalls = 0;
		const runner = createOpenRouterCalibrationEmpiricalRunner(async () => ({
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
				bearerToken: "calibration-zero-remainder-secret",
			},
			transport: {
				request() {
					transportCalls += 1;
					throw new TypeError("zero remainder must reject before transport");
				},
			},
			monotonicMeasurement: { readMs: () => 0 },
			retryWait: immediateRetryWait,
			executionClass: "simulated-contract",
		}));
		const trialBlock = createB112CalibrationTrialBlockIdentity(fixture.frozen, task.taskRef, 1);
		const blockResult = validateB112CalibrationEmpiricalBlockResult(
			await runner({
				configurationRef: configuration.configurationRef,
				configurationDigest: empiricalStrictJsonDigest(configuration),
				task,
				taskDigest: empiricalStrictJsonDigest(task),
				blockIndex: 1,
				blockOrdinal: 1,
				...trialBlock,
				remainingBudget: {
					campaignRequests: 0,
					campaignCostMicrousd: 0,
					campaignElapsedMs: 0,
					taskRequests: 0,
					taskCostMicrousd: 0,
				},
				signal: new AbortController().signal,
			}),
		);
		const observation = blockResult.observation;
		expect(transportCalls).toBe(0);
		expect(observation).toMatchObject({
			profile: "calibration",
			result: { classification: "non-evaluable", requests: 0 },
		});
		expect(observation.issueCodes).toContain(B112_SMOKE_BUDGET_ISSUE_CODE);
		expect(blockResult.budgetExhaustionScope).toBe("campaign");
	}, 60_000);
});

describe("B112 D678-D679 package-private calibration operator", () => {
	it("accepts fifteen distinct fresh same-route attestations and rejects reuse or substitution", async () => {
		const fixture = await createClosedHostFixture(
			undefined,
			undefined,
			"deepseek-v4-flash-high",
			"calibration",
		);
		const rawRoutes = d678SimulatedCalibrationQualifications(fixture);
		const routes = validateD678CalibrationRouteQualifications({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			routeQualifications: rawRoutes,
		});
		const credential = {
			credentialBindingRef: rawRoutes[0]!.sharedCapacityQualification.credentialBindingRef,
			credentialBindingRevision:
				rawRoutes[0]!.sharedCapacityQualification.credentialBindingRevision,
			bearerToken: "d688-fresh-qualification-secret",
		};
		const seen = new Set<string>();
		const freshValues = routes.map(({ qualification: route }, index) =>
			strictSnapshot({
				...route,
				qualificationRef: `d688-fresh-${index + 1}`,
				qualificationRevision: `d688-fresh.v${index + 1}`,
				keySpendLimit: {
					...route.keySpendLimit,
					qualificationRef: `d688-fresh-key-${index + 1}`,
					qualificationRevision: `d688-fresh-key.v${index + 1}`,
				},
				sharedCapacityQualification: {
					...route.sharedCapacityQualification,
					qualificationRef: `d688-fresh-shared-${index + 1}`,
					qualificationRevision: `d688-fresh-shared.v${index + 1}`,
				},
			}),
		);
		for (const [index, fresh] of freshValues.entries()) {
			expect(
				validateOpenRouterCalibrationFreshRouteQualification(
					fresh,
					fixture.frozen,
					fixture.report,
					routes[index]!.qualification,
					credential,
					seen,
				).qualificationRevision,
			).toBe(`d688-fresh.v${index + 1}`);
		}
		expect(seen.size).toBe(15);
		expect(() =>
			validateOpenRouterCalibrationFreshRouteQualification(
				freshValues[0],
				fixture.frozen,
				fixture.report,
				routes[0]!.qualification,
				credential,
				seen,
			),
		).toThrow(/substituted or reused/);
		expect(() =>
			validateOpenRouterCalibrationFreshRouteQualification(
				{ ...freshValues[0], requestModel: "substituted/model" },
				fixture.frozen,
				fixture.report,
				routes[0]!.qualification,
				credential,
				new Set(),
			),
		).toThrow();
	}, 30_000);

	it("reads bounded current-key metadata and admits exact conservative microUSD", async () => {
		const secretSentinel = "d681-current-key-secret-sentinel";
		let requestUrl: string | URL | Request | null = null;
		let requestInit: RequestInit | undefined;
		const responseBody = JSON.stringify({
			data: {
				limit: 32,
				limit_remaining: 21.55725434,
				limit_reset: null,
				usage: 10.44274566,
				is_management_key: false,
				label: secretSentinel,
			},
		});
		const capability = createOpenRouterCurrentKeySpendAdmissionCapability({
			fetch: (async (url, init) => {
				requestUrl = url;
				requestInit = init;
				return new Response(responseBody, {
					status: 200,
					headers: { "content-length": String(encoder.encode(responseBody).byteLength) },
				});
			}) as typeof fetch,
		});
		const admitted = await capability.read({
			credential: {
				credentialBindingRef: "d681-credential",
				credentialBindingRevision: "d681-credential.v1",
				bearerToken: secretSentinel,
			},
			expectedLimitMicrousd: 32_000_000,
			requiredRemainingMicrousd: 18_000_000,
			signal: new AbortController().signal,
		});
		expect(requestUrl).toBe(OPENROUTER_CURRENT_KEY_ENDPOINT);
		expect(requestInit).toMatchObject({
			method: "GET",
			redirect: "error",
			cache: "no-store",
			credentials: "omit",
			referrerPolicy: "no-referrer",
		});
		expect(admitted).toMatchObject({
			limitMicrousd: 32_000_000,
			remainingMicrousd: 21_557_254,
			usageMicrousd: 10_442_746,
			limitReset: "none",
			isManagementKey: false,
		});
		expect(JSON.stringify(admitted)).not.toContain(secretSentinel);
	});

	it("fails closed on insufficient or oversized current-key metadata", async () => {
		const insufficient = createOpenRouterCurrentKeySpendAdmissionCapability({
			fetch: (async () =>
				new Response(
					JSON.stringify({
						data: {
							limit: 32,
							limit_remaining: 17.999999,
							limit_reset: null,
							usage: 14.000001,
							is_management_key: false,
						},
					}),
					{ status: 200 },
				)) as typeof fetch,
		});
		const input = {
			credential: {
				credentialBindingRef: "d681-credential",
				credentialBindingRevision: "d681-credential.v1",
				bearerToken: "d681-current-key-secret-sentinel",
			},
			expectedLimitMicrousd: 32_000_000,
			requiredRemainingMicrousd: 18_000_000,
			signal: new AbortController().signal,
		};
		await expect(insufficient.read(input)).rejects.toThrow(/failed spend admission/);

		const oversized = createOpenRouterCurrentKeySpendAdmissionCapability({
			fetch: (async () =>
				new Response("{}", {
					status: 200,
					headers: { "content-length": "16385" },
				})) as typeof fetch,
		});
		await expect(oversized.read(input)).rejects.toThrow(/byte bound/);
	});

	it("sanitizes a current-key response stream failure before it reaches diagnostics", async () => {
		const secretSentinel = "d681-stream-private-sentinel";
		const capability = createOpenRouterCurrentKeySpendAdmissionCapability({
			fetch: (async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.error(new TypeError(secretSentinel));
						},
					}),
					{ status: 200 },
				)) as typeof fetch,
		});
		let diagnostic = "";
		try {
			await capability.read({
				credential: {
					credentialBindingRef: "d681-credential",
					credentialBindingRevision: "d681-credential.v1",
					bearerToken: secretSentinel,
				},
				expectedLimitMicrousd: 32_000_000,
				requiredRemainingMicrousd: 18_000_000,
				signal: new AbortController().signal,
			});
		} catch (error) {
			diagnostic = String(error);
		}
		expect(diagnostic).toContain("response body was unreadable");
		expect(diagnostic).not.toContain(secretSentinel);
	});

	it("accepts every frozen aggregate request digest and rejects the next one", () => {
		const digests = Array.from({ length: B112_D678_BLOCK_MAX_REQUESTS }, (_, index) =>
			empiricalSha256(encoder.encode(`aggregate-route-evidence-${index}`)),
		).sort();
		expect(
			validateEmpiricalAggregateEvidenceDigestList(
				digests,
				"calibration.aggregateRouteEvidenceDigests",
				B112_D678_BLOCK_MAX_REQUESTS,
			),
		).toEqual(digests);
		expect(() =>
			validateEmpiricalAggregateEvidenceDigestList(
				[...digests, empiricalSha256(encoder.encode("aggregate-route-evidence-overflow"))].sort(),
				"calibration.aggregateRouteEvidenceDigests",
				B112_D678_BLOCK_MAX_REQUESTS,
			),
		).toThrow(/bounded item count/);
	});

	it("canonicalizes nested warm-arm issues before observation validation", () => {
		expect(
			canonicalMatchedWarmBranchIssueCodes(
				["warm-memory-lifecycle-issue", "shared-issue"],
				["tool-action-budget-exhausted", "shared-issue"],
			),
		).toEqual(["shared-issue", "tool-action-budget-exhausted", "warm-memory-lifecycle-issue"]);
	});

	it("runs the complete no-network outer chain and atomically persists sanitized evidence", async () => {
		const fixture = await createClosedHostFixture(
			undefined,
			undefined,
			"deepseek-v4-flash-high",
			"calibration",
		);
		const routeQualifications = d678SimulatedCalibrationQualifications(fixture);
		expect(
			validateD678CalibrationRouteQualifications({
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				routeQualifications,
			}),
		).toHaveLength(15);
		const privateParent = temporaryRoot("d678-private");
		const privateRoot = join(privateParent, ".private", "empirical-memory-rerun-avoidance");
		mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
		const secretSentinel = "d678-injected-transport-secret-sentinel";
		let prepareCalls = 0;
		let transportCalls = 0;
		let quotaAdmissionCalls = 0;
		let activeTransportCalls = 0;
		let maxActiveTransportCalls = 0;
		const decoder = new TextDecoder("utf-8", { fatal: true });
		const transport: OpenRouterResponsesByteTransportV1 = {
			async request(request) {
				activeTransportCalls += 1;
				maxActiveTransportCalls = Math.max(maxActiveTransportCalls, activeTransportCalls);
				transportCalls += 1;
				try {
					const wire = JSON.parse(decoder.decode(request.body)) as {
						readonly tools?: readonly {
							readonly function?: {
								readonly name?: string;
								readonly parameters?: { readonly properties?: Readonly<Record<string, unknown>> };
							};
						}[];
					};
					if (transportCalls === 1) {
						const replaceTool = wire.tools?.find((tool) =>
							Object.hasOwn(tool.function?.parameters?.properties ?? {}, "oldText"),
						);
						if (typeof replaceTool?.function?.name !== "string") {
							throw new TypeError("D678 fixture did not receive the closed replaceExact tool");
						}
						return dryRunOpenRouterResponse(
							"response.d678.replace",
							[
								{
									type: "function_call",
									call_id: "call.d678.replace",
									name: replaceTool.function.name,
									arguments: JSON.stringify({
										baseContentDigest: empiricalSha256(
											encoder.encode("broken-placeholder-value\n"),
										),
										newText: "fixed",
										oldText: "broken-placeholder-value",
										path: "README.md",
									}),
								},
							],
							{ input_tokens: 100, output_tokens: 20, total_tokens: 120, cost: 0.000_01 },
							{
								requestModel: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
								downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
							},
						);
					}
					return dryRunOpenRouterResponse(
						"response.d678.final",
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
											summary: "D678 injected-transport dry run completed",
										}),
									},
								],
							},
						],
						{ input_tokens: 100, output_tokens: 20, total_tokens: 120, cost: 0.000_01 },
						{
							requestModel: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
							downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
						},
					);
				} finally {
					activeTransportCalls -= 1;
				}
			},
		};
		const result = await runLoadedOpenRouterCalibrationOperator({
			operatorInput: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				routeQualifications,
				privateRoot,
				generationRef: "d678-no-network-preflight",
				async prepareTrialBlock(scheduled) {
					prepareCalls += 1;
					if (scheduled.blockOrdinal !== 1) {
						throw new TypeError("bounded fixture terminalizes after its first authoritative block");
					}
					return {
						host: {
							frozen: fixture.frozen,
							qualificationReport: fixture.report,
							initialRequest: fixture.initialRequest,
							taskProfile: fixture.taskProfile,
							materialization: fixture.materialization,
							verifier: fixture.verifier,
						},
						prepareWarmHost: ({ signal }) => fixture.prepareFreshMaterialization(signal),
					};
				},
			},
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: secretSentinel,
			},
			transport,
			currentKeySpendAdmission: simulatedCurrentKeySpendAdmission(() => {
				quotaAdmissionCalls += 1;
			}),
			monotonicMeasurement: { readMs: () => 0 },
			retryWait: immediateRetryWait,
			executionClass: "simulated-contract",
			signal: new AbortController().signal,
		});
		expect({ prepareCalls, quotaAdmissionCalls, transportCalls, maxActiveTransportCalls }).toEqual({
			prepareCalls: 2,
			quotaAdmissionCalls: 1,
			transportCalls: 2,
			maxActiveTransportCalls: 1,
		});
		expect(result.terminalSlots).toHaveLength(15);
		expect(result.scorecard).toMatchObject({
			profile: "calibration",
			evidenceClass: "simulated-contract",
			empiricalLiveEvidence: false,
			efficacyClaim: "none",
			attemptedBlocks: 1,
			status: "incomplete",
		});
		const persistedBytes = readdirSync(result.persistence.generationPath)
			.map((file) => readFileSync(join(result.persistence.generationPath, file), "utf8"))
			.join("\n");
		expect(persistedBytes).not.toContain(secretSentinel);
		for (const file of readdirSync(result.persistence.generationPath)) {
			expect(statSync(join(result.persistence.generationPath, file)).mode & 0o777).toBe(0o600);
		}
	}, 60_000);

	it("cleans prepared materialization when current-key admission fails before transport", async () => {
		const fixture = await createClosedHostFixture(
			undefined,
			undefined,
			"deepseek-v4-flash-high",
			"calibration",
		);
		const privateRoot = join(
			temporaryRoot("d681-admission-cleanup-private"),
			".private",
			"empirical-memory-rerun-avoidance",
		);
		mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
		let transportCalls = 0;
		const result = await runLoadedOpenRouterCalibrationOperator({
			operatorInput: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				routeQualifications: d678SimulatedCalibrationQualifications(fixture),
				privateRoot,
				generationRef: "d681-admission-cleanup",
				async prepareTrialBlock() {
					return {
						host: {
							frozen: fixture.frozen,
							qualificationReport: fixture.report,
							initialRequest: fixture.initialRequest,
							taskProfile: fixture.taskProfile,
							materialization: fixture.materialization,
							verifier: fixture.verifier,
						},
						prepareWarmHost: ({ signal }) => fixture.prepareFreshMaterialization(signal),
					};
				},
			},
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: "d681-admission-cleanup-secret",
			},
			transport: {
				async request() {
					transportCalls += 1;
					throw new TypeError("transport must not run after admission failure");
				},
			},
			currentKeySpendAdmission: {
				async read() {
					throw new TypeError("bounded current-key admission failure");
				},
			},
			monotonicMeasurement: { readMs: () => 0 },
			retryWait: immediateRetryWait,
			executionClass: "simulated-contract",
			signal: new AbortController().signal,
		});
		expect(transportCalls).toBe(0);
		expect(
			result.terminalSlots.every((slot) => slot.status === "not-attempted-preparation-failed"),
		).toBe(true);
		expect(() => statSync(fixture.workspaceRoot)).toThrow();
	}, 60_000);

	it("rejects a substituted qualification bundle before any transport call", async () => {
		const fixture = await createClosedHostFixture(
			undefined,
			undefined,
			"deepseek-v4-flash-high",
			"calibration",
		);
		const qualifications = [...d678SimulatedCalibrationQualifications(fixture)];
		qualifications[1] = qualifications[0] as OpenRouterRouteQualificationV1;
		expect(() =>
			validateD678CalibrationRouteQualifications({
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				routeQualifications: qualifications,
			}),
		).toThrow(/scheduled block|distinct per-block|does not match D678-D679/);
		await fixture.materialization.cleanup();
	});

	it("emits only allowlisted stage diagnostics for a live-path failure", async () => {
		const fixture = await createClosedHostFixture(
			undefined,
			undefined,
			"deepseek-v4-flash-high",
			"calibration",
		);
		const secretSentinel = "d678-diagnostic-secret-must-not-escape";
		let captured: unknown;
		try {
			await runLoadedOpenRouterCalibrationOperator({
				operatorInput: {
					frozen: fixture.frozen,
					qualificationReport: fixture.report,
					routeQualifications: d678SimulatedCalibrationQualifications(fixture),
					privateRoot: temporaryRoot("d678-diagnostic-private"),
					generationRef: "d678-diagnostic-generation",
					async prepareTrialBlock() {
						throw new DOMException(secretSentinel, "AbortError");
					},
				},
				credential: {
					credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
					credentialBindingRevision:
						fixture.frozen.manifest.policies.actorCredentialBindingRevision,
					bearerToken: secretSentinel,
				},
				transport: {
					async request() {
						throw new TypeError("unexpected diagnostic transport call");
					},
				},
				currentKeySpendAdmission: simulatedCurrentKeySpendAdmission(),
				monotonicMeasurement: { readMs: () => 0 },
				retryWait: immediateRetryWait,
				executionClass: "simulated-contract",
				signal: new AbortController().signal,
			});
		} catch (error) {
			captured = error;
		}
		const diagnostic = classifyOpenRouterCalibrationOperatorFailure(captured);
		expect(diagnostic).toEqual({
			issueCode: "openrouter-calibration-operator-failed",
			stage: "campaign",
			blockOrdinal: 1,
			causeClass: "abort",
			causeCode: "abort",
			causeDetailCode: "not-applicable",
		});
		expect(JSON.stringify(diagnostic)).not.toContain(secretSentinel);
		await fixture.materialization.cleanup();
	});

	it("classifies observation validation failures without exposing their detail", () => {
		const diagnostic = classifyOpenRouterCalibrationOperatorFailure(
			new TypeError(
				"trial observation cost does not match its frozen pricing: private detail must not escape",
			),
		);
		expect(diagnostic).toEqual({
			issueCode: "openrouter-calibration-operator-failed",
			stage: "operator-init",
			blockOrdinal: null,
			causeClass: "type-error",
			causeCode: "observation-schema-validation",
			causeDetailCode: "observation-cost",
		});
		expect(JSON.stringify(diagnostic)).not.toContain("private detail");
	});

	it("classifies campaign node-bound failures without exposing their path", () => {
		const diagnostic = classifyOpenRouterCalibrationOperatorFailure(
			new TypeError("B112 empirical campaign private.path: strict JSON node bound exceeded"),
		);
		expect(diagnostic).toEqual({
			issueCode: "openrouter-calibration-operator-failed",
			stage: "operator-init",
			blockOrdinal: null,
			causeClass: "type-error",
			causeCode: "campaign-schema-validation",
			causeDetailCode: "campaign-node-bound",
		});
		expect(JSON.stringify(diagnostic)).not.toContain("private.path");
	});

	it("bounds an always-tool-calling block and mechanically reaches the next slot", async () => {
		const fixture = await createClosedHostFixture(
			undefined,
			undefined,
			"deepseek-v4-flash-high",
			"calibration",
		);
		let prepareCalls = 0;
		let transportCalls = 0;
		const decoder = new TextDecoder("utf-8", { fatal: true });
		const privateParent = temporaryRoot("d678-always-tool-private");
		const privateRoot = join(privateParent, ".private", "empirical-memory-rerun-avoidance");
		mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
		const result = await runLoadedOpenRouterCalibrationOperator({
			operatorInput: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				routeQualifications: d678SimulatedCalibrationQualifications(fixture),
				privateRoot,
				generationRef: "d678-always-tool-generation",
				async prepareTrialBlock(scheduled) {
					prepareCalls += 1;
					if (scheduled.blockOrdinal !== 1) {
						throw new TypeError("bounded always-tool fixture stops after one block");
					}
					return {
						host: {
							frozen: fixture.frozen,
							qualificationReport: fixture.report,
							initialRequest: fixture.initialRequest,
							taskProfile: fixture.taskProfile,
							materialization: fixture.materialization,
							verifier: fixture.verifier,
						},
						prepareWarmHost: ({ signal }) => fixture.prepareFreshMaterialization(signal),
					};
				},
			},
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: "d678-always-tool-secret-sentinel",
			},
			transport: {
				async request(request) {
					transportCalls += 1;
					const wire = JSON.parse(decoder.decode(request.body)) as {
						readonly tools?: readonly {
							readonly function?: {
								readonly name?: string;
								readonly parameters?: {
									readonly properties?: Readonly<Record<string, unknown>>;
								};
							};
						}[];
					};
					const readTool = wire.tools?.find((tool) => {
						const properties = tool.function?.parameters?.properties ?? {};
						return Object.hasOwn(properties, "path") && !Object.hasOwn(properties, "oldText");
					});
					if (typeof readTool?.function?.name !== "string") {
						throw new TypeError("always-tool fixture did not receive the closed read tool");
					}
					return dryRunOpenRouterResponse(
						`response.d678.always-tool.${transportCalls}`,
						[
							{
								type: "function_call",
								call_id: `call.d678.always-tool.${transportCalls}`,
								name: readTool.function.name,
								arguments: JSON.stringify({ path: "README.md" }),
							},
						],
						{ input_tokens: 100, output_tokens: 20, total_tokens: 120, cost: 0.000_01 },
						{
							requestModel: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
							downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
						},
					);
				},
			},
			currentKeySpendAdmission: simulatedCurrentKeySpendAdmission(),
			monotonicMeasurement: { readMs: () => 0 },
			retryWait: immediateRetryWait,
			executionClass: "simulated-contract",
			signal: new AbortController().signal,
		});
		expect(prepareCalls).toBe(2);
		expect(transportCalls).toBeGreaterThan(0);
		expect(transportCalls).toBeLessThanOrEqual(B112_D678_BLOCK_MAX_REQUESTS);
		expect(result.scorecard).toMatchObject({
			attemptedBlocks: 1,
			status: "incomplete",
			efficacyClaim: "none",
		});
	}, 120_000);

	it("runs D691 cold plus five serial historical-transfer arms through observation and atomic private persistence", async () => {
		const credentialSentinel = "D691_PRIVATE_CREDENTIAL_SENTINEL_DO_NOT_PERSIST";
		const decoder = new TextDecoder("utf-8", { fatal: true });
		const fixture = await createClosedHostFixture(
			undefined,
			"broken-placeholder-value\n",
			"deepseek-v4-flash-high",
			"smoke",
			false,
			D690_TARGET_TASK_REF,
			"fixed\n",
		);
		const routeQualification = simulatedRouteQualification(fixture, {
			maxSmokeSpendMicrousd: D691_BUDGET.maxSpendMicrousd,
			maxRequests: D691_BUDGET.maxHttpAttempts,
			maxStepsPerRun: D691_BUDGET.maxStepsPerRun,
			maxCanonicalRequestBytes: D691_BUDGET.maxCanonicalRequestBytes,
			maxInputTokens: D691_BUDGET.maxInputTokens,
			maxOutputTokens: D691_BUDGET.maxOutputTokens,
			maxLatencyMs: D691_BUDGET.maxElapsedMs,
		});
		let transportCalls = 0;
		let activeRequests = 0;
		let maximumConcurrentRequests = 0;
		const wireBodies: string[] = [];
		const transport: OpenRouterResponsesByteTransportV1 = {
			async request(request) {
				activeRequests += 1;
				maximumConcurrentRequests = Math.max(maximumConcurrentRequests, activeRequests);
				try {
					transportCalls += 1;
					if (transportCalls > 12) throw new TypeError("unexpected D691 dry-run request");
					const wireText = decoder.decode(request.body);
					wireBodies.push(wireText);
					const wire = JSON.parse(wireText) as {
						readonly model?: string;
						readonly messages?: readonly { readonly role?: string; readonly content?: string }[];
						readonly tools?: readonly {
							readonly function?: {
								readonly name?: string;
								readonly parameters?: { readonly properties?: Readonly<Record<string, unknown>> };
							};
						}[];
					};
					if (wire.model !== OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL) {
						throw new TypeError("unexpected D691 dry-run model");
					}
					const user = [...(wire.messages ?? [])]
						.reverse()
						.find((message) => message.role === "user");
					if (typeof user?.content !== "string") throw new TypeError("missing D691 user envelope");
					const envelope = JSON.parse(user.content) as {
						readonly turn?: { readonly stepIndex?: number };
						readonly structuredInput?: { readonly memoryContext?: unknown };
					};
					const stepIndex = envelope.turn?.stepIndex ?? -1;
					const memoryDelivered = envelope.structuredInput?.memoryContext !== undefined;
					const toolBy = (key: string, excluded?: string) =>
						wire.tools?.find((tool) => {
							const properties = tool.function?.parameters?.properties ?? {};
							return (
								Object.hasOwn(properties, key) &&
								(excluded === undefined || !Object.hasOwn(properties, excluded))
							);
						})?.function?.name;
					if (stepIndex === 0) {
						const toolName = memoryDelivered ? toolBy("oldText") : toolBy("path", "oldText");
						if (typeof toolName !== "string")
							throw new TypeError("missing D691 closed tool mapping");
						return dryRunOpenRouterResponse(
							`response.d691.${transportCalls}`,
							[
								{
									type: "function_call",
									call_id: `call.d691.${transportCalls}`,
									name: toolName,
									arguments: JSON.stringify(
										memoryDelivered
											? {
													path: "README.md",
													baseContentDigest: empiricalSha256(
														encoder.encode("broken-placeholder-value\n"),
													),
													oldText: "broken-placeholder-value",
													newText: "fixed",
												}
											: { path: "README.md" },
									),
								},
							],
							{ input_tokens: 100, output_tokens: 20, total_tokens: 120, cost: 0.000_01 },
							{
								requestModel: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
								downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
							},
						);
					}
					return dryRunOpenRouterResponse(
						`response.d691.${transportCalls}`,
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
											summary: "D691 bounded dry-run completion.",
										}),
									},
								],
							},
						],
						{ input_tokens: 100, output_tokens: 20, total_tokens: 120, cost: 0.000_01 },
						{
							requestModel: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
							downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
						},
					);
				} finally {
					activeRequests -= 1;
				}
			},
		};
		let measurement = 0;
		const result = await runD691HistoricalTransferBlock({
			d690OfflineEvidence: d690OfflineEvidenceFixture(),
			block: {
				host: {
					frozen: fixture.frozen,
					qualificationReport: fixture.report,
					initialRequest: fixture.initialRequest,
					taskProfile: fixture.taskProfile,
					materialization: fixture.materialization,
					verifier: fixture.verifier,
				},
				prepareWarmHost: ({ signal }) => fixture.prepareFreshMaterialization(signal),
				routeQualification,
				credential: {
					credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
					credentialBindingRevision:
						fixture.frozen.manifest.policies.actorCredentialBindingRevision,
					bearerToken: credentialSentinel,
				},
				transport,
				monotonicMeasurement: { readMs: () => (measurement += 1) },
				retryWait: immediateRetryWait,
				executionClass: "simulated-contract",
				signal: new AbortController().signal,
			},
		});

		expect(transportCalls).toBe(12);
		expect(maximumConcurrentRequests).toBe(1);
		expect(result.admissionRejection).toBeNull();
		expect(result.observation).toMatchObject({
			efficacyClaim: "none",
			positiveExploratoryTransferPattern: true,
			relevantActionTraceBoundToMemory: true,
		});
		expect(result.scorecard).toMatchObject({
			status: "complete-positive-exploratory-signal",
			efficacyClaim: "none",
			positiveExploratoryTransferPatterns: 1,
		});
		expect(createD691Scorecard(result.observation)).toEqual(result.scorecard);
		const { observationDigest: ignoredObservationDigest, ...forgedMaterial } = {
			...result.observation,
			positiveExploratoryTransferPattern: false,
		};
		void ignoredObservationDigest;
		const forgedObservation = strictSnapshot({
			...forgedMaterial,
			observationDigest: empiricalStrictJsonDigest(forgedMaterial),
		});
		expect(() => createD691Scorecard(forgedObservation as typeof result.observation)).toThrow(
			"positiveExploratoryTransferPattern",
		);
		const relevant = result.observation.underlying.warmBranches[0];
		if (relevant?.lifecycle === null || relevant === undefined) {
			throw new TypeError("D691 relevant lifecycle fixture missing");
		}
		const unmatchedLifecycle = strictSnapshot({
			...relevant.lifecycle,
			caseConforms: false,
			stagePredicates: {
				...relevant.lifecycle.stagePredicates,
				same_work_item_input: false,
			},
		});
		const unmatchedUnderlying = strictSnapshot({
			...result.observation.underlying,
			familyPassed: false,
			warmBranches: [
				strictSnapshot({ ...relevant, lifecycle: unmatchedLifecycle }),
				...result.observation.underlying.warmBranches.slice(1),
			],
		});
		const {
			observationDigest: ignoredUnmatchedObservationDigest,
			...unmatchedObservationWithoutDigest
		} = {
			...result.observation,
			underlying: unmatchedUnderlying,
			underlyingObservationDigest: empiricalStrictJsonDigest(unmatchedUnderlying),
		};
		void ignoredUnmatchedObservationDigest;
		const unmatchedMaterial = strictSnapshot(unmatchedObservationWithoutDigest);
		const unmatchedObservation = strictSnapshot({
			...unmatchedMaterial,
			observationDigest: empiricalStrictJsonDigest(unmatchedMaterial),
		});
		expect(() => createD691Scorecard(unmatchedObservation as typeof result.observation)).toThrow(
			"matched cold-failure transfer block",
		);
		const serialized = JSON.stringify({
			observation: result.observation,
			scorecard: result.scorecard,
		});
		expect(serialized).not.toContain(credentialSentinel);
		expect(wireBodies.some((body) => body.includes("producer"))).toBe(true);

		const privateRoot = D691_PRIVATE_PERSISTENCE_ROOT;
		const generationRef = `d691-dry-run-test-${process.pid}-${Date.now()}`;
		const generationRoot = join(privateRoot, generationRef);
		temporaryRoots.push(generationRoot);
		const persistenceProtection = createEmpiricalExactPrivateNeedleProtectionExecutor({
			policyRef: fixture.initialRequest.protectionPolicyRef,
			policyRevision: fixture.initialRequest.protectionPolicyRevision,
			protectedNeedleCapabilityRef: "protected-needles.d691.persistence-test",
			protectedNeedleCapabilityRevision: "protected-needles.d691.persistence-test.v1",
			protectedNeedles: [credentialSentinel],
		});
		const persisted = await persistD691PrivateGeneration({
			privateRoot,
			generationRef,
			observation: result.observation,
			scorecard: result.scorecard,
			protectionExecutor: persistenceProtection,
		});
		expect(persisted.observationDigest).toBe(result.observation.observationDigest);
		for (const file of readdirSync(generationRoot)) {
			const path = join(generationRoot, file);
			expect(statSync(path).mode & 0o777).toBe(0o600);
			expect(readFileSync(path, "utf8")).not.toContain(credentialSentinel);
		}
		await expect(
			persistD691PrivateGeneration({
				privateRoot,
				generationRef,
				observation: result.observation,
				scorecard: result.scorecard,
				protectionExecutor: persistenceProtection,
			}),
		).rejects.toThrow();
		let forgedProtectionCalls = 0;
		const forgedGenerationRef = `d691-forged-protection-${process.pid}-${Date.now()}`;
		const forgedGenerationRoot = join(privateRoot, forgedGenerationRef);
		temporaryRoots.push(forgedGenerationRoot);
		await expect(
			persistD691PrivateGeneration({
				privateRoot,
				generationRef: forgedGenerationRef,
				observation: result.observation,
				scorecard: result.scorecard,
				protectionExecutor: {
					policyRef: fixture.initialRequest.protectionPolicyRef,
					policyRevision: fixture.initialRequest.protectionPolicyRevision,
					inspect() {
						forgedProtectionCalls += 1;
						return { disposition: "allowed" as const, issueCodes: [] };
					},
				} as unknown as EmpiricalExactPrivateNeedleProtectionExecutorV1,
			}),
		).rejects.toThrow("constructed exact private-needle executor");
		expect(forgedProtectionCalls).toBe(0);
		expect(readdirSync(privateRoot)).not.toContain(forgedGenerationRef);
		expect(readdirSync(privateRoot).filter((name) => name.startsWith(".d691-staging-"))).toEqual(
			[],
		);
	}, 120_000);

	it("bounds D691 bad loops and fails an unexpected transport request without retry or live evidence", async () => {
		const makeFixture = () =>
			createClosedHostFixture(
				undefined,
				"broken-placeholder-value\n",
				"deepseek-v4-flash-high",
				"smoke",
				false,
				D690_TARGET_TASK_REF,
				"fixed\n",
			);
		const route = (fixture: ClosedHostFixture) =>
			simulatedRouteQualification(fixture, {
				maxSmokeSpendMicrousd: D691_BUDGET.maxSpendMicrousd,
				maxRequests: D691_BUDGET.maxHttpAttempts,
				maxStepsPerRun: D691_BUDGET.maxStepsPerRun,
				maxCanonicalRequestBytes: D691_BUDGET.maxCanonicalRequestBytes,
				maxInputTokens: D691_BUDGET.maxInputTokens,
				maxOutputTokens: D691_BUDGET.maxOutputTokens,
				maxLatencyMs: D691_BUDGET.maxElapsedMs,
			});
		const block = (fixture: ClosedHostFixture, transport: OpenRouterResponsesByteTransportV1) => ({
			host: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: fixture.materialization,
				verifier: fixture.verifier,
			},
			prepareWarmHost: ({ signal }: { readonly signal: AbortSignal }) =>
				fixture.prepareFreshMaterialization(signal),
			routeQualification: route(fixture),
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: "d691-bounded-private-secret",
			},
			transport,
			monotonicMeasurement: { readMs: () => 0 },
			retryWait: immediateRetryWait,
			executionClass: "simulated-contract" as const,
			signal: new AbortController().signal,
		});

		const loopingFixture = await makeFixture();
		let loopCalls = 0;
		const loopResult = await runD691HistoricalTransferBlock({
			d690OfflineEvidence: d690OfflineEvidenceFixture(),
			block: block(loopingFixture, {
				async request(request) {
					loopCalls += 1;
					const wire = JSON.parse(new TextDecoder().decode(request.body)) as {
						readonly tools?: readonly {
							readonly function?: {
								readonly name?: string;
								readonly parameters?: { readonly properties?: Readonly<Record<string, unknown>> };
							};
						}[];
					};
					const readTool = wire.tools?.find((tool) => {
						const properties = tool.function?.parameters?.properties ?? {};
						return Object.hasOwn(properties, "path") && !Object.hasOwn(properties, "oldText");
					})?.function?.name;
					if (typeof readTool !== "string") throw new TypeError("unexpected D691 tool catalog");
					return dryRunOpenRouterResponse(
						`response.d691.loop.${loopCalls}`,
						[
							{
								type: "function_call",
								call_id: `call.d691.loop.${loopCalls}`,
								name: readTool,
								arguments: JSON.stringify({ path: "README.md" }),
							},
						],
						{ input_tokens: 100, output_tokens: 20, total_tokens: 120, cost: 0.000_01 },
						{
							requestModel: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
							downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
						},
					);
				},
			}),
		});
		expect(loopCalls).toBe(D691_BUDGET.maxStepsPerRun);
		expect(loopResult.observation.underlying.result).toMatchObject({
			classification: "non-evaluable",
			requests: D691_BUDGET.maxStepsPerRun,
			attempts: D691_BUDGET.maxStepsPerRun,
			costMicrousd: 0,
		});
		expect(loopResult.observation.underlying.empiricalLiveEvidence).toBe(false);
		expect(loopResult.scorecard.status).toBe("incomplete");

		const rejectedFixture = await makeFixture();
		let rejectedCalls = 0;
		const rejected = await runD691HistoricalTransferBlock({
			d690OfflineEvidence: d690OfflineEvidenceFixture(),
			block: block(rejectedFixture, {
				async request() {
					rejectedCalls += 1;
					throw new TypeError("unexpected injected transport request");
				},
			}),
		});
		expect(rejectedCalls).toBe(1);
		expect(rejected.observation.underlying.result).toMatchObject({
			classification: "non-evaluable",
			requests: 1,
			attempts: 1,
		});
		expect(rejected.observation.underlying.cold.retryWaitTrace).toEqual([]);
		expect(rejected.observation.underlying.warmBranches).toHaveLength(5);
		expect(rejected.observation.underlying.warmBranches.every((branch) => !branch.attempted)).toBe(
			true,
		);
	}, 120_000);

	it("rejects forged live D690 receipts and nested block accessors before byte transport", async () => {
		const fixture = await createClosedHostFixture(
			undefined,
			"broken-placeholder-value\n",
			"deepseek-v4-flash-high",
			"smoke",
			false,
			D690_TARGET_TASK_REF,
			"fixed\n",
		);
		let transportCalls = 0;
		const routeQualification = liveRouteQualification(fixture, {
			maxSmokeSpendMicrousd: D691_BUDGET.maxSpendMicrousd,
			maxRequests: D691_BUDGET.maxHttpAttempts,
			maxStepsPerRun: D691_BUDGET.maxStepsPerRun,
			maxCanonicalRequestBytes: D691_BUDGET.maxCanonicalRequestBytes,
			maxInputTokens: D691_BUDGET.maxInputTokens,
			maxOutputTokens: D691_BUDGET.maxOutputTokens,
			maxLatencyMs: D691_BUDGET.maxElapsedMs,
		});
		const baseBlock = {
			host: {
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				initialRequest: fixture.initialRequest,
				taskProfile: fixture.taskProfile,
				materialization: fixture.materialization,
				verifier: fixture.verifier,
			},
			prepareWarmHost: ({ signal }: { readonly signal: AbortSignal }) =>
				fixture.prepareFreshMaterialization(signal),
			routeQualification,
			credential: {
				credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: fixture.frozen.manifest.policies.actorCredentialBindingRevision,
				bearerToken: "d691-forged-receipt-secret",
			},
			transport: {
				async request() {
					transportCalls += 1;
					throw new TypeError("forged D690 receipt reached transport");
				},
			},
			monotonicMeasurement: { readMs: () => 0 },
			retryWait: immediateRetryWait,
			executionClass: "live-provider" as const,
			signal: new AbortController().signal,
		};
		await expect(
			runD691HistoricalTransferBlock({
				d690OfflineEvidence: d690OfflineEvidenceFixture(),
				block: baseBlock,
			}),
		).rejects.toThrow("exact qualified D690 evidence receipt");
		expect(transportCalls).toBe(0);

		let routeGetterHits = 0;
		const accessorBlock = Object.defineProperty({ ...baseBlock }, "routeQualification", {
			enumerable: true,
			get() {
				routeGetterHits += 1;
				return routeQualification;
			},
		});
		await expect(
			runD691HistoricalTransferBlock({
				d690OfflineEvidence: d690OfflineEvidenceFixture(),
				block: accessorBlock as unknown as typeof baseBlock,
			}),
		).rejects.toThrow("expected an own data property");
		expect(routeGetterHits).toBe(0);
		expect(transportCalls).toBe(0);
	}, 120_000);

	it("marks the six-arm block incomplete when aggregate monotonic time is exhausted", async () => {
		const fixture = await createClosedHostFixture(
			undefined,
			"broken-placeholder-value\n",
			"deepseek-v4-flash-high",
			"smoke",
			false,
			D690_TARGET_TASK_REF,
			"fixed\n",
		);
		let now = 0;
		let calls = 0;
		const result = await runD691HistoricalTransferBlock({
			d690OfflineEvidence: d690OfflineEvidenceFixture(),
			block: {
				host: {
					frozen: fixture.frozen,
					qualificationReport: fixture.report,
					initialRequest: fixture.initialRequest,
					taskProfile: fixture.taskProfile,
					materialization: fixture.materialization,
					verifier: fixture.verifier,
				},
				prepareWarmHost: ({ signal }) => fixture.prepareFreshMaterialization(signal),
				routeQualification: simulatedRouteQualification(fixture, {
					maxSmokeSpendMicrousd: D691_BUDGET.maxSpendMicrousd,
					maxRequests: D691_BUDGET.maxHttpAttempts,
					maxStepsPerRun: D691_BUDGET.maxStepsPerRun,
					maxCanonicalRequestBytes: D691_BUDGET.maxCanonicalRequestBytes,
					maxInputTokens: D691_BUDGET.maxInputTokens,
					maxOutputTokens: D691_BUDGET.maxOutputTokens,
					maxLatencyMs: D691_BUDGET.maxElapsedMs,
				}),
				credential: {
					credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
					credentialBindingRevision:
						fixture.frozen.manifest.policies.actorCredentialBindingRevision,
					bearerToken: "d691-elapsed-secret",
				},
				transport: {
					async request() {
						calls += 1;
						now = D691_BUDGET.maxElapsedMs;
						return dryRunOpenRouterResponse(
							"response.d691.elapsed",
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
												summary: "D691 elapsed preparation fixture.",
											}),
										},
									],
								},
							],
							{ input_tokens: 10, output_tokens: 1, total_tokens: 11, cost: 0 },
							{
								requestModel: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
								downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
							},
						);
					},
				},
				monotonicMeasurement: { readMs: () => now },
				retryWait: immediateRetryWait,
				executionClass: "simulated-contract",
				signal: new AbortController().signal,
			},
		});
		expect(calls).toBe(1);
		expect(result.observation.underlying.warmBranches.every((branch) => !branch.attempted)).toBe(
			true,
		);
		expect(result.scorecard.status).toBe("incomplete");
	}, 120_000);

	it("cleans a prepared D691 warm workspace when aggregate time crosses before host handoff", async () => {
		const fixture = await createClosedHostFixture(
			undefined,
			"broken-placeholder-value\n",
			"deepseek-v4-flash-high",
			"smoke",
			false,
			D690_TARGET_TASK_REF,
			"fixed\n",
		);
		let now = 0;
		let cleanupCalls = 0;
		let prepareCalls = 0;
		let transportCalls = 0;
		const result = await runD691HistoricalTransferBlock({
			d690OfflineEvidence: d690OfflineEvidenceFixture(),
			block: {
				host: {
					frozen: fixture.frozen,
					qualificationReport: fixture.report,
					initialRequest: fixture.initialRequest,
					taskProfile: fixture.taskProfile,
					materialization: fixture.materialization,
					verifier: fixture.verifier,
				},
				prepareWarmHost: async ({ signal }) => {
					prepareCalls += 1;
					const prepared = await fixture.prepareFreshMaterialization(signal);
					now = D691_BUDGET.maxElapsedMs;
					return Object.freeze({
						...prepared,
						async cleanup() {
							cleanupCalls += 1;
							await prepared.cleanup();
						},
					});
				},
				routeQualification: simulatedRouteQualification(fixture, {
					maxSmokeSpendMicrousd: D691_BUDGET.maxSpendMicrousd,
					maxRequests: D691_BUDGET.maxHttpAttempts,
					maxStepsPerRun: D691_BUDGET.maxStepsPerRun,
					maxCanonicalRequestBytes: D691_BUDGET.maxCanonicalRequestBytes,
					maxInputTokens: D691_BUDGET.maxInputTokens,
					maxOutputTokens: D691_BUDGET.maxOutputTokens,
					maxLatencyMs: D691_BUDGET.maxElapsedMs,
				}),
				credential: {
					credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
					credentialBindingRevision:
						fixture.frozen.manifest.policies.actorCredentialBindingRevision,
					bearerToken: "d691-preparation-elapsed-secret",
				},
				transport: {
					async request(request) {
						transportCalls += 1;
						const wire = JSON.parse(new TextDecoder().decode(request.body)) as {
							readonly messages?: readonly { readonly role?: string; readonly content?: string }[];
							readonly tools?: readonly {
								readonly function?: {
									readonly name?: string;
									readonly parameters?: {
										readonly properties?: Readonly<Record<string, unknown>>;
									};
								};
							}[];
						};
						const user = [...(wire.messages ?? [])]
							.reverse()
							.find((message) => message.role === "user");
						const envelope = JSON.parse(user?.content ?? "null") as {
							readonly turn?: { readonly stepIndex?: number };
						};
						if (envelope.turn?.stepIndex === 0) {
							const readTool = wire.tools?.find((tool) => {
								const properties = tool.function?.parameters?.properties ?? {};
								return Object.hasOwn(properties, "path") && !Object.hasOwn(properties, "oldText");
							})?.function?.name;
							if (typeof readTool !== "string") throw new TypeError("D691 read tool missing");
							return dryRunOpenRouterResponse(
								"response.d691.preparation-elapsed.read",
								[
									{
										type: "function_call",
										call_id: "call.d691.preparation-elapsed.read",
										name: readTool,
										arguments: JSON.stringify({ path: "README.md" }),
									},
								],
								{ input_tokens: 10, output_tokens: 1, total_tokens: 11, cost: 0 },
								{
									requestModel: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
									downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
								},
							);
						}
						return dryRunOpenRouterResponse(
							"response.d691.preparation-elapsed",
							[
								{
									type: "message",
									content: [
										{
											type: "output_text",
											text: JSON.stringify({
												kind: "model-turn-output-placeholder",
												summary: "D691 elapsed preparation fixture.",
											}),
										},
									],
								},
							],
							{ input_tokens: 10, output_tokens: 1, total_tokens: 11, cost: 0 },
							{
								requestModel: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
								downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
							},
						);
					},
				},
				monotonicMeasurement: { readMs: () => now },
				retryWait: immediateRetryWait,
				executionClass: "simulated-contract",
				signal: new AbortController().signal,
			},
		});
		expect(transportCalls).toBe(2);
		expect(prepareCalls).toBe(1);
		expect(cleanupCalls).toBe(1);
		expect(result.observation.underlying.warmBranches[0]).toMatchObject({
			attempted: false,
			issueCodes: expect.arrayContaining([B112_SMOKE_BUDGET_ISSUE_CODE]),
		});
		expect(result.scorecard.status).toBe("incomplete");
	}, 120_000);

	it("rejects a completed final D691 arm when aggregate time crosses before aggregation", async () => {
		const fixture = await createClosedHostFixture(
			undefined,
			"broken-placeholder-value\n",
			"deepseek-v4-flash-high",
			"smoke",
			false,
			D690_TARGET_TASK_REF,
			"fixed\n",
		);
		let now = 0;
		let transportCalls = 0;
		const result = await runD691HistoricalTransferBlock({
			d690OfflineEvidence: d690OfflineEvidenceFixture(),
			block: {
				host: {
					frozen: fixture.frozen,
					qualificationReport: fixture.report,
					initialRequest: fixture.initialRequest,
					taskProfile: fixture.taskProfile,
					materialization: fixture.materialization,
					verifier: fixture.verifier,
				},
				prepareWarmHost: ({ signal }) => fixture.prepareFreshMaterialization(signal),
				routeQualification: simulatedRouteQualification(fixture, {
					maxSmokeSpendMicrousd: D691_BUDGET.maxSpendMicrousd,
					maxRequests: D691_BUDGET.maxHttpAttempts,
					maxStepsPerRun: D691_BUDGET.maxStepsPerRun,
					maxCanonicalRequestBytes: D691_BUDGET.maxCanonicalRequestBytes,
					maxInputTokens: D691_BUDGET.maxInputTokens,
					maxOutputTokens: D691_BUDGET.maxOutputTokens,
					maxLatencyMs: D691_BUDGET.maxElapsedMs,
				}),
				credential: {
					credentialBindingRef: fixture.frozen.manifest.policies.actorCredentialBindingRef,
					credentialBindingRevision:
						fixture.frozen.manifest.policies.actorCredentialBindingRevision,
					bearerToken: "d691-final-elapsed-secret",
				},
				transport: {
					async request(request) {
						transportCalls += 1;
						const wire = JSON.parse(new TextDecoder().decode(request.body)) as {
							readonly messages?: readonly { readonly role?: string; readonly content?: string }[];
							readonly tools?: readonly {
								readonly function?: {
									readonly name?: string;
									readonly parameters?: {
										readonly properties?: Readonly<Record<string, unknown>>;
									};
								};
							}[];
						};
						const user = [...(wire.messages ?? [])]
							.reverse()
							.find((message) => message.role === "user");
						const envelope = JSON.parse(user?.content ?? "null") as {
							readonly turn?: { readonly stepIndex?: number };
						};
						if (envelope.turn?.stepIndex === 0) {
							const readTool = wire.tools?.find((tool) => {
								const properties = tool.function?.parameters?.properties ?? {};
								return Object.hasOwn(properties, "path") && !Object.hasOwn(properties, "oldText");
							})?.function?.name;
							if (typeof readTool !== "string") throw new TypeError("D691 read tool missing");
							return dryRunOpenRouterResponse(
								`response.d691.final-elapsed.read.${transportCalls}`,
								[
									{
										type: "function_call",
										call_id: `call.d691.final-elapsed.read.${transportCalls}`,
										name: readTool,
										arguments: JSON.stringify({ path: "README.md" }),
									},
								],
								{ input_tokens: 10, output_tokens: 1, total_tokens: 11, cost: 0 },
								{
									requestModel: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
									downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
								},
							);
						}
						if (transportCalls === 12) now = D691_BUDGET.maxElapsedMs;
						return dryRunOpenRouterResponse(
							`response.d691.final-elapsed.${transportCalls}`,
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
												summary: "D691 elapsed final-arm fixture.",
											}),
										},
									],
								},
							],
							{ input_tokens: 10, output_tokens: 1, total_tokens: 11, cost: 0 },
							{
								requestModel: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
								downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
							},
						);
					},
				},
				monotonicMeasurement: { readMs: () => now },
				retryWait: immediateRetryWait,
				executionClass: "simulated-contract",
				signal: new AbortController().signal,
			},
		});
		expect(transportCalls).toBe(12);
		expect(result.observation.underlying.warmBranches[4]?.run).toMatchObject({
			classification: "non-evaluable",
			verifierStatus: "not-run",
			issueCodes: expect.arrayContaining([B112_SMOKE_BUDGET_ISSUE_CODE]),
		});
		expect(result.scorecard.status).toBe("incomplete");
	}, 120_000);
});
