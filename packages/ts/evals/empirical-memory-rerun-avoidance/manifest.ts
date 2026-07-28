import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	assertCanonicalBytes,
	boolean,
	commitSha,
	coordinate,
	deepFreeze,
	denseUniqueStrings,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	fail,
	httpsEndpoint,
	literal,
	oneOf,
	optionalFiniteNumber,
	optionalSafeInteger,
	record,
	safeInteger,
	strictSnapshot,
	string,
} from "./canonical.js";
import {
	EMPIRICAL_MEMORY_RERUN_AVOIDANCE_SCHEMAS,
	type EmpiricalCampaignAggregationV1,
	type EmpiricalCampaignBudgetsV1,
	type EmpiricalCampaignManifestV1,
	type EmpiricalCampaignPolicyCoordinatesV1,
	type EmpiricalCampaignTaskV1,
	type EmpiricalModelCapabilitiesV1,
	type EmpiricalModelConfigurationV1,
	type EmpiricalModelSettingsV1,
	type EmpiricalOptionalRolePolicyV1,
	type EmpiricalTaskCatalogV1,
	type EmpiricalTrialPlanV1,
} from "./contracts.js";
import { validateEmpiricalSchemaCatalog } from "./strict-json-shape.js";

export const MAX_EMPIRICAL_CAMPAIGN_MANIFEST_BYTES = 256 * 1024;

const MANIFEST_KEYS = Object.freeze([
	"aggregation",
	"budgets",
	"campaignRef",
	"catalog",
	"familyRef",
	"lane",
	"modelConfigurations",
	"policies",
	"qualification",
	"schemaCatalog",
	"schemaVersion",
	"trialPlan",
]);

const TASK_KEYS = Object.freeze([
	"acceptanceDigest",
	"actorTreeDigest",
	"allowedCommandPolicyRef",
	"allowedCommandPolicyRevision",
	"allowedCommandPolicyDigest",
	"environmentDigest",
	"environmentRef",
	"environmentRevision",
	"evalScopeDigest",
	"originalCommitSha",
	"originalTreeDigest",
	"overlayDigest",
	"repositoryRef",
	"sourceStratum",
	"taskRef",
	"toolchainDigest",
	"toolchainRevision",
	"verifierProfileRef",
	"verifierProfileRevision",
	"verifierProfileDigest",
	"worldDigest",
	"worldRevision",
	"workItemDigest",
	"workItemRef",
	"workspaceRecipeRef",
	"workspaceRecipeRevision",
	"workspaceRecipeDigest",
]);

const MODEL_CONFIGURATION_KEYS = Object.freeze([
	"adapterRevision",
	"bindingRevision",
	"capabilities",
	"configurationRef",
	"credentialPolicyRef",
	"credentialPolicyRevision",
	"endpoint",
	"endpointRevision",
	"model",
	"modelIdentityKind",
	"pricingRevision",
	"pricingScheduleRef",
	"promptRevision",
	"provider",
	"providerFamily",
	"role",
	"settings",
	"systemPromptRevision",
	"tokenizerRef",
	"tokenizerRevision",
	"usageSource",
]);

const REQUIRED_BRANCHES = Object.freeze([
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
]);

function validateBranchOrder(value: unknown, path: string) {
	const branchOrder = denseUniqueStrings(value, path, { min: 5, max: 5 });
	if (branchOrder.some((branch) => !REQUIRED_BRANCHES.includes(branch))) {
		fail(path, "expected the closed five-arm warm branch set");
	}
	return branchOrder as EmpiricalTrialPlanV1["branchOrder"];
}

function validateTask(value: unknown, path: string): EmpiricalCampaignTaskV1 {
	const task = record(value, path);
	exactKeys(task, TASK_KEYS, path);
	const sourceStratum = oneOf(
		task.sourceStratum,
		["historical-pre-fix", "held-out-overlay"],
		`${path}.sourceStratum`,
	);
	const overlayDigest =
		task.overlayDigest === null ? null : digest(task.overlayDigest, `${path}.overlayDigest`);
	if (sourceStratum === "historical-pre-fix" && overlayDigest !== null) {
		fail(`${path}.overlayDigest`, "historical task must not carry an overlay");
	}
	if (sourceStratum === "held-out-overlay" && overlayDigest === null) {
		fail(`${path}.overlayDigest`, "held-out task requires an overlay digest");
	}
	const originalTreeDigest = digest(task.originalTreeDigest, `${path}.originalTreeDigest`);
	const actorTreeDigest = digest(task.actorTreeDigest, `${path}.actorTreeDigest`);
	if (sourceStratum === "historical-pre-fix" && actorTreeDigest !== originalTreeDigest) {
		fail(`${path}.actorTreeDigest`, "historical task actor tree must equal the original tree");
	}
	if (sourceStratum === "held-out-overlay" && actorTreeDigest === originalTreeDigest) {
		fail(`${path}.actorTreeDigest`, "held-out overlay must produce a distinct actor tree");
	}
	return strictSnapshot({
		taskRef: coordinate(task.taskRef, `${path}.taskRef`),
		sourceStratum,
		repositoryRef: literal(task.repositoryRef, "graphrefly-ts", `${path}.repositoryRef`),
		originalCommitSha: commitSha(task.originalCommitSha, `${path}.originalCommitSha`),
		originalTreeDigest,
		actorTreeDigest,
		overlayDigest,
		worldDigest: digest(task.worldDigest, `${path}.worldDigest`),
		worldRevision: string(task.worldRevision, `${path}.worldRevision`),
		evalScopeDigest: digest(task.evalScopeDigest, `${path}.evalScopeDigest`),
		environmentRef: string(task.environmentRef, `${path}.environmentRef`),
		environmentRevision: string(task.environmentRevision, `${path}.environmentRevision`),
		environmentDigest: digest(task.environmentDigest, `${path}.environmentDigest`),
		toolchainRevision: string(task.toolchainRevision, `${path}.toolchainRevision`),
		toolchainDigest: digest(task.toolchainDigest, `${path}.toolchainDigest`),
		workItemRef: string(task.workItemRef, `${path}.workItemRef`),
		workItemDigest: digest(task.workItemDigest, `${path}.workItemDigest`),
		acceptanceDigest: digest(task.acceptanceDigest, `${path}.acceptanceDigest`),
		workspaceRecipeRef: string(task.workspaceRecipeRef, `${path}.workspaceRecipeRef`),
		workspaceRecipeRevision: string(
			task.workspaceRecipeRevision,
			`${path}.workspaceRecipeRevision`,
		),
		workspaceRecipeDigest: digest(task.workspaceRecipeDigest, `${path}.workspaceRecipeDigest`),
		allowedCommandPolicyRef: string(
			task.allowedCommandPolicyRef,
			`${path}.allowedCommandPolicyRef`,
		),
		allowedCommandPolicyRevision: string(
			task.allowedCommandPolicyRevision,
			`${path}.allowedCommandPolicyRevision`,
		),
		allowedCommandPolicyDigest: digest(
			task.allowedCommandPolicyDigest,
			`${path}.allowedCommandPolicyDigest`,
		),
		verifierProfileRef: coordinate(task.verifierProfileRef, `${path}.verifierProfileRef`),
		verifierProfileRevision: string(
			task.verifierProfileRevision,
			`${path}.verifierProfileRevision`,
		),
		verifierProfileDigest: digest(task.verifierProfileDigest, `${path}.verifierProfileDigest`),
	});
}

export function validateEmpiricalTaskCatalog(
	value: unknown,
	path = "manifest.catalog",
): EmpiricalTaskCatalogV1 {
	const catalog = record(value, path);
	exactKeys(catalog, ["taskCatalogRevision", "tasks"], path);
	const taskValues = array(catalog.tasks, `${path}.tasks`);
	if (taskValues.length !== 5) fail(`${path}.tasks`, "expected exactly five tasks");
	const tasks = taskValues.map((task, index) => validateTask(task, `${path}.tasks[${index}]`));
	if (new Set(tasks.map((task) => task.taskRef)).size !== tasks.length) {
		fail(`${path}.tasks`, "task refs must be unique");
	}
	const semanticTaskDigests = tasks.map((task) =>
		empiricalStrictJsonDigest({
			acceptanceDigest: task.acceptanceDigest,
			actorTreeDigest: task.actorTreeDigest,
			evalScopeDigest: task.evalScopeDigest,
			originalCommitSha: task.originalCommitSha,
			originalTreeDigest: task.originalTreeDigest,
			overlayDigest: task.overlayDigest,
			repositoryRef: task.repositoryRef,
			sourceStratum: task.sourceStratum,
			workItemDigest: task.workItemDigest,
			workItemRef: task.workItemRef,
			worldDigest: task.worldDigest,
			worldRevision: task.worldRevision,
		}),
	);
	if (new Set(semanticTaskDigests).size !== semanticTaskDigests.length) {
		fail(`${path}.tasks`, "semantic task identity must be unique");
	}
	if (tasks.filter((task) => task.sourceStratum === "historical-pre-fix").length !== 3) {
		fail(`${path}.tasks`, "expected exactly three historical pre-fix tasks");
	}
	if (tasks.filter((task) => task.sourceStratum === "held-out-overlay").length !== 2) {
		fail(`${path}.tasks`, "expected exactly two held-out overlay tasks");
	}
	return strictSnapshot({
		taskCatalogRevision: string(catalog.taskCatalogRevision, `${path}.taskCatalogRevision`),
		tasks,
	});
}

function validateTrialPlan(
	value: unknown,
	catalog: EmpiricalTaskCatalogV1,
	path: string,
): EmpiricalTrialPlanV1 {
	const trialPlan = record(value, path);
	const profile = oneOf(
		trialPlan.profile,
		["smoke", "calibration", "confirmatory"],
		`${path}.profile`,
	);
	const catalogRefs = catalog.tasks.map((task) => task.taskRef);
	const branchOrder = validateBranchOrder(trialPlan.branchOrder, `${path}.branchOrder`);
	const branchOrderMode = literal(trialPlan.branchOrderMode, "explicit", `${path}.branchOrderMode`);
	if (profile === "smoke") {
		exactKeys(
			trialPlan,
			["activeTaskRefs", "attemptedColdBlocksPerTask", "branchOrder", "branchOrderMode", "profile"],
			path,
		);
		const activeTaskRefs = denseUniqueStrings(trialPlan.activeTaskRefs, `${path}.activeTaskRefs`, {
			min: 1,
			max: 1,
		});
		if (!catalogRefs.includes(activeTaskRefs[0] as string)) {
			fail(`${path}.activeTaskRefs`, "smoke task is absent from the frozen catalog");
		}
		literal(trialPlan.attemptedColdBlocksPerTask, 1, `${path}.attemptedColdBlocksPerTask`);
		return strictSnapshot({
			profile,
			activeTaskRefs: [activeTaskRefs[0] as string] as const,
			attemptedColdBlocksPerTask: 1 as const,
			branchOrderMode,
			branchOrder,
		});
	}
	const activeTaskRefs = denseUniqueStrings(trialPlan.activeTaskRefs, `${path}.activeTaskRefs`, {
		min: 5,
		max: 5,
	});
	if (activeTaskRefs.some((ref, index) => ref !== catalogRefs[index])) {
		fail(`${path}.activeTaskRefs`, "must exactly match frozen catalog order");
	}
	if (profile === "calibration") {
		exactKeys(
			trialPlan,
			["activeTaskRefs", "attemptedColdBlocksPerTask", "branchOrder", "branchOrderMode", "profile"],
			path,
		);
		literal(trialPlan.attemptedColdBlocksPerTask, 3, `${path}.attemptedColdBlocksPerTask`);
		return strictSnapshot({
			profile,
			activeTaskRefs,
			attemptedColdBlocksPerTask: 3 as const,
			branchOrderMode,
			branchOrder,
		});
	}
	exactKeys(
		trialPlan,
		[
			"activeTaskRefs",
			"attemptedColdBlocksPerTask",
			"branchOrder",
			"branchOrderMode",
			"claimThresholdRevision",
			"preregistrationRef",
			"profile",
			"stoppingRuleRevision",
		],
		path,
	);
	return strictSnapshot({
		profile,
		activeTaskRefs,
		attemptedColdBlocksPerTask: safeInteger(
			trialPlan.attemptedColdBlocksPerTask,
			`${path}.attemptedColdBlocksPerTask`,
			{ min: 1, max: 10_000 },
		),
		preregistrationRef: string(trialPlan.preregistrationRef, `${path}.preregistrationRef`),
		claimThresholdRevision: string(
			trialPlan.claimThresholdRevision,
			`${path}.claimThresholdRevision`,
		),
		stoppingRuleRevision: string(trialPlan.stoppingRuleRevision, `${path}.stoppingRuleRevision`),
		branchOrderMode,
		branchOrder,
	});
}

function validateCapabilities(value: unknown, path: string): EmpiricalModelCapabilitiesV1 {
	const capabilities = record(value, path);
	exactKeys(
		capabilities,
		["providerUsage", "reasoningControl", "seed", "structuredOutput", "toolCalling"],
		path,
	);
	return strictSnapshot({
		toolCalling: boolean(capabilities.toolCalling, `${path}.toolCalling`),
		structuredOutput: boolean(capabilities.structuredOutput, `${path}.structuredOutput`),
		reasoningControl: boolean(capabilities.reasoningControl, `${path}.reasoningControl`),
		seed: boolean(capabilities.seed, `${path}.seed`),
		providerUsage: boolean(capabilities.providerUsage, `${path}.providerUsage`),
	});
}

function validateSettings(value: unknown, path: string): EmpiricalModelSettingsV1 {
	const settings = record(value, path);
	exactKeys(settings, ["output", "reasoning", "sampling", "tools"], path);
	const sampling = record(settings.sampling, `${path}.sampling`);
	exactKeys(sampling, ["seed", "temperature", "topP"], `${path}.sampling`);
	const reasoning = record(settings.reasoning, `${path}.reasoning`);
	exactKeys(reasoning, ["effort", "mode"], `${path}.reasoning`);
	const output = record(settings.output, `${path}.output`);
	exactKeys(
		output,
		["format", "maxOutputTokens", "schemaDigest", "schemaRef", "schemaRevision"],
		`${path}.output`,
	);
	const tools = record(settings.tools, `${path}.tools`);
	exactKeys(
		tools,
		["choice", "enabled", "maxSteps", "schemaRevision", "toolRefs", "toolSetDigest"],
		`${path}.tools`,
	);
	return strictSnapshot({
		sampling: {
			temperature: optionalFiniteNumber(sampling.temperature, `${path}.sampling.temperature`, {
				min: 0,
				max: 2,
			}),
			topP: optionalFiniteNumber(sampling.topP, `${path}.sampling.topP`, {
				min: 0,
				max: 1,
			}),
			seed: optionalSafeInteger(sampling.seed, `${path}.sampling.seed`, {
				min: 0,
			}),
		},
		reasoning: {
			mode: oneOf(reasoning.mode, ["none", "provider-native"], `${path}.reasoning.mode`),
			effort:
				reasoning.effort === null ? null : string(reasoning.effort, `${path}.reasoning.effort`),
		},
		output: {
			format: literal(output.format, "strict-json", `${path}.output.format`),
			schemaRef: coordinate(output.schemaRef, `${path}.output.schemaRef`),
			schemaRevision: string(output.schemaRevision, `${path}.output.schemaRevision`),
			schemaDigest: digest(output.schemaDigest, `${path}.output.schemaDigest`),
			maxOutputTokens: safeInteger(output.maxOutputTokens, `${path}.output.maxOutputTokens`, {
				min: 1,
				max: 1_000_000,
			}),
		},
		tools: {
			enabled: literal(tools.enabled, true, `${path}.tools.enabled`),
			schemaRevision: string(tools.schemaRevision, `${path}.tools.schemaRevision`),
			toolRefs: denseUniqueStrings(tools.toolRefs, `${path}.tools.toolRefs`, {
				min: 1,
				max: 64,
			}),
			toolSetDigest: digest(tools.toolSetDigest, `${path}.tools.toolSetDigest`),
			choice: oneOf(tools.choice, ["auto", "required"], `${path}.tools.choice`),
			maxSteps: safeInteger(tools.maxSteps, `${path}.tools.maxSteps`, {
				min: 1,
				max: 10_000,
			}),
		},
	});
}

function validateModelConfiguration(value: unknown, path: string): EmpiricalModelConfigurationV1 {
	const configuration = record(value, path);
	exactKeys(configuration, MODEL_CONFIGURATION_KEYS, path);
	const capabilities = validateCapabilities(configuration.capabilities, `${path}.capabilities`);
	const settings = validateSettings(configuration.settings, `${path}.settings`);
	const usageSource = oneOf(
		configuration.usageSource,
		["provider-reported", "provider-count-endpoint", "adapter-estimated", "host-measured"],
		`${path}.usageSource`,
	);
	const tokenizerRef =
		configuration.tokenizerRef === null
			? null
			: string(configuration.tokenizerRef, `${path}.tokenizerRef`);
	const tokenizerRevision =
		configuration.tokenizerRevision === null
			? null
			: string(configuration.tokenizerRevision, `${path}.tokenizerRevision`);
	if ((tokenizerRef === null) !== (tokenizerRevision === null)) {
		fail(`${path}.tokenizerRevision`, "tokenizer ref and revision must be present together");
	}
	if (!capabilities.toolCalling) fail(`${path}.capabilities.toolCalling`, "tools are required");
	if (!capabilities.structuredOutput) {
		fail(`${path}.capabilities.structuredOutput`, "strict output schema is required");
	}
	if (!capabilities.reasoningControl) {
		if (settings.reasoning.mode !== "none" || settings.reasoning.effort !== null) {
			fail(`${path}.settings.reasoning`, "unsupported reasoning controls must be disabled");
		}
	}
	if (settings.reasoning.mode === "none" && settings.reasoning.effort !== null) {
		fail(`${path}.settings.reasoning.effort`, "must be null when reasoning mode is none");
	}
	if (settings.reasoning.mode === "provider-native" && settings.reasoning.effort === null) {
		fail(`${path}.settings.reasoning.effort`, "is required for provider-native reasoning");
	}
	if (!capabilities.seed && settings.sampling.seed !== null) {
		fail(`${path}.settings.sampling.seed`, "unsupported seed must be null");
	}
	if (usageSource === "provider-reported" && !capabilities.providerUsage) {
		fail(`${path}.usageSource`, "provider-reported usage requires providerUsage capability");
	}
	if (usageSource === "adapter-estimated" && tokenizerRef === null) {
		fail(`${path}.tokenizerRef`, "adapter-estimated usage requires tokenizer coordinates");
	}
	return strictSnapshot({
		configurationRef: string(configuration.configurationRef, `${path}.configurationRef`),
		role: oneOf(
			configuration.role,
			["actor", "auxiliary-judge", "semantic-redactor"],
			`${path}.role`,
		),
		providerFamily: string(configuration.providerFamily, `${path}.providerFamily`),
		provider: string(configuration.provider, `${path}.provider`),
		model: string(configuration.model, `${path}.model`),
		modelIdentityKind: oneOf(
			configuration.modelIdentityKind,
			["exact-snapshot", "alias-disclosed"],
			`${path}.modelIdentityKind`,
		),
		endpoint: httpsEndpoint(configuration.endpoint, `${path}.endpoint`),
		endpointRevision: string(configuration.endpointRevision, `${path}.endpointRevision`),
		adapterRevision: string(configuration.adapterRevision, `${path}.adapterRevision`),
		bindingRevision: string(configuration.bindingRevision, `${path}.bindingRevision`),
		promptRevision: string(configuration.promptRevision, `${path}.promptRevision`),
		systemPromptRevision: string(
			configuration.systemPromptRevision,
			`${path}.systemPromptRevision`,
		),
		capabilities,
		settings,
		usageSource,
		tokenizerRef,
		tokenizerRevision,
		pricingRevision: string(configuration.pricingRevision, `${path}.pricingRevision`),
		pricingScheduleRef: string(configuration.pricingScheduleRef, `${path}.pricingScheduleRef`),
		credentialPolicyRef: string(configuration.credentialPolicyRef, `${path}.credentialPolicyRef`),
		credentialPolicyRevision: string(
			configuration.credentialPolicyRevision,
			`${path}.credentialPolicyRevision`,
		),
	});
}

function validateOptionalRolePolicy(value: unknown, path: string): EmpiricalOptionalRolePolicyV1 {
	const role = record(value, path);
	exactKeys(
		role,
		[
			"configurationRef",
			"credentialBindingRef",
			"credentialBindingRevision",
			"enabled",
			"inputAuthorityRef",
			"inputAuthorityRevision",
			"policyRef",
			"policyRevision",
			"tracePolicyRef",
			"tracePolicyRevision",
		],
		path,
	);
	const enabled = boolean(role.enabled, `${path}.enabled`);
	const optionalCoordinate = (key: string): string | null =>
		role[key] === null ? null : string(role[key], `${path}.${key}`);
	const configurationRef = optionalCoordinate("configurationRef");
	const policyRef = optionalCoordinate("policyRef");
	const policyRevision = optionalCoordinate("policyRevision");
	const credentialBindingRef = optionalCoordinate("credentialBindingRef");
	const credentialBindingRevision = optionalCoordinate("credentialBindingRevision");
	const tracePolicyRef = optionalCoordinate("tracePolicyRef");
	const tracePolicyRevision = optionalCoordinate("tracePolicyRevision");
	const inputAuthorityRef = optionalCoordinate("inputAuthorityRef");
	const inputAuthorityRevision = optionalCoordinate("inputAuthorityRevision");
	const coordinates = [
		configurationRef,
		policyRef,
		policyRevision,
		credentialBindingRef,
		credentialBindingRevision,
		tracePolicyRef,
		tracePolicyRevision,
		inputAuthorityRef,
		inputAuthorityRevision,
	];
	if (enabled && coordinates.some((coordinate) => coordinate === null)) {
		fail(path, "enabled role requires complete isolated coordinates");
	}
	if (!enabled && coordinates.some((coordinate) => coordinate !== null)) {
		fail(path, "disabled role coordinates must be null");
	}
	return strictSnapshot({
		enabled,
		configurationRef,
		policyRef,
		policyRevision,
		credentialBindingRef,
		credentialBindingRevision,
		tracePolicyRef,
		tracePolicyRevision,
		inputAuthorityRef,
		inputAuthorityRevision,
	});
}

function validatePolicies(value: unknown, path: string): EmpiricalCampaignPolicyCoordinatesV1 {
	const policies = record(value, path);
	const keys = [
		"actorPolicyRef",
		"actorPolicyRevision",
		"actorCredentialBindingRef",
		"actorCredentialBindingRevision",
		"actorInputAuthorityRef",
		"actorInputAuthorityRevision",
		"actorTracePolicyRef",
		"actorTracePolicyRevision",
		"artifactPolicyRef",
		"artifactPolicyRevision",
		"auxiliaryJudge",
		"executorRevision",
		"mapperRevision",
		"plannerRevision",
		"protectionPolicyRef",
		"protectionPolicyRevision",
		"rawArtifactPersistence",
		"reflectorRevision",
		"repositoryEvidenceInclusion",
		"semanticRedactor",
	];
	exactKeys(policies, keys, path);
	return strictSnapshot({
		plannerRevision: string(policies.plannerRevision, `${path}.plannerRevision`),
		executorRevision: string(policies.executorRevision, `${path}.executorRevision`),
		reflectorRevision: string(policies.reflectorRevision, `${path}.reflectorRevision`),
		mapperRevision: string(policies.mapperRevision, `${path}.mapperRevision`),
		protectionPolicyRef: string(policies.protectionPolicyRef, `${path}.protectionPolicyRef`),
		protectionPolicyRevision: string(
			policies.protectionPolicyRevision,
			`${path}.protectionPolicyRevision`,
		),
		artifactPolicyRef: string(policies.artifactPolicyRef, `${path}.artifactPolicyRef`),
		artifactPolicyRevision: string(
			policies.artifactPolicyRevision,
			`${path}.artifactPolicyRevision`,
		),
		rawArtifactPersistence: literal(
			policies.rawArtifactPersistence,
			"disabled",
			`${path}.rawArtifactPersistence`,
		),
		repositoryEvidenceInclusion: literal(
			policies.repositoryEvidenceInclusion,
			"not-approved",
			`${path}.repositoryEvidenceInclusion`,
		),
		actorPolicyRef: string(policies.actorPolicyRef, `${path}.actorPolicyRef`),
		actorPolicyRevision: string(policies.actorPolicyRevision, `${path}.actorPolicyRevision`),
		actorCredentialBindingRef: string(
			policies.actorCredentialBindingRef,
			`${path}.actorCredentialBindingRef`,
		),
		actorCredentialBindingRevision: string(
			policies.actorCredentialBindingRevision,
			`${path}.actorCredentialBindingRevision`,
		),
		actorTracePolicyRef: string(policies.actorTracePolicyRef, `${path}.actorTracePolicyRef`),
		actorTracePolicyRevision: string(
			policies.actorTracePolicyRevision,
			`${path}.actorTracePolicyRevision`,
		),
		actorInputAuthorityRef: string(
			policies.actorInputAuthorityRef,
			`${path}.actorInputAuthorityRef`,
		),
		actorInputAuthorityRevision: string(
			policies.actorInputAuthorityRevision,
			`${path}.actorInputAuthorityRevision`,
		),
		auxiliaryJudge: validateOptionalRolePolicy(policies.auxiliaryJudge, `${path}.auxiliaryJudge`),
		semanticRedactor: validateOptionalRolePolicy(
			policies.semanticRedactor,
			`${path}.semanticRedactor`,
		),
	});
}

function validateBudgets(value: unknown, path: string): EmpiricalCampaignBudgetsV1 {
	const budgets = record(value, path);
	exactKeys(budgets, ["agentRun", "campaign", "taskModel"], path);
	const campaign = record(budgets.campaign, `${path}.campaign`);
	exactKeys(campaign, ["maxCostMicrousd", "maxElapsedMs", "maxRequests"], `${path}.campaign`);
	const taskModel = record(budgets.taskModel, `${path}.taskModel`);
	exactKeys(
		taskModel,
		["maxAttemptedColdBlocks", "maxCostMicrousd", "maxRequests"],
		`${path}.taskModel`,
	);
	const agentRun = record(budgets.agentRun, `${path}.agentRun`);
	exactKeys(
		agentRun,
		["maxElapsedMs", "maxOutputBytes", "maxRequests", "maxSteps"],
		`${path}.agentRun`,
	);
	return strictSnapshot({
		campaign: {
			maxRequests: safeInteger(campaign.maxRequests, `${path}.campaign.maxRequests`, {
				min: 1,
			}),
			maxCostMicrousd: safeInteger(campaign.maxCostMicrousd, `${path}.campaign.maxCostMicrousd`, {
				min: 1,
			}),
			maxElapsedMs: safeInteger(campaign.maxElapsedMs, `${path}.campaign.maxElapsedMs`, {
				min: 1,
			}),
		},
		taskModel: {
			maxAttemptedColdBlocks: safeInteger(
				taskModel.maxAttemptedColdBlocks,
				`${path}.taskModel.maxAttemptedColdBlocks`,
				{ min: 1 },
			),
			maxRequests: safeInteger(taskModel.maxRequests, `${path}.taskModel.maxRequests`, {
				min: 1,
			}),
			maxCostMicrousd: safeInteger(taskModel.maxCostMicrousd, `${path}.taskModel.maxCostMicrousd`, {
				min: 1,
			}),
		},
		agentRun: {
			maxSteps: safeInteger(agentRun.maxSteps, `${path}.agentRun.maxSteps`, {
				min: 1,
			}),
			maxRequests: safeInteger(agentRun.maxRequests, `${path}.agentRun.maxRequests`, {
				min: 1,
			}),
			maxElapsedMs: safeInteger(agentRun.maxElapsedMs, `${path}.agentRun.maxElapsedMs`, {
				min: 1,
			}),
			maxOutputBytes: safeInteger(agentRun.maxOutputBytes, `${path}.agentRun.maxOutputBytes`, {
				min: 1,
			}),
		},
	});
}

function validateAggregation(value: unknown, path: string): EmpiricalCampaignAggregationV1 {
	const aggregation = record(value, path);
	exactKeys(
		aggregation,
		[
			"aggregationRevision",
			"aggregationSeed",
			"clusterUnit",
			"confidenceLevel",
			"intervalRevision",
		],
		path,
	);
	return strictSnapshot({
		aggregationRevision: string(aggregation.aggregationRevision, `${path}.aggregationRevision`),
		intervalRevision: string(aggregation.intervalRevision, `${path}.intervalRevision`),
		aggregationSeed: string(aggregation.aggregationSeed, `${path}.aggregationSeed`),
		clusterUnit: literal(aggregation.clusterUnit, "task", `${path}.clusterUnit`),
		confidenceLevel: literal(aggregation.confidenceLevel, 0.95, `${path}.confidenceLevel`),
	});
}

function validateQualification(value: unknown, path: string) {
	const qualification = record(value, path);
	exactKeys(qualification, ["qualificationRevision", "reportDigest", "taskCatalogDigest"], path);
	return strictSnapshot({
		qualificationRevision: string(
			qualification.qualificationRevision,
			`${path}.qualificationRevision`,
		),
		taskCatalogDigest: digest(qualification.taskCatalogDigest, `${path}.taskCatalogDigest`),
		reportDigest: digest(qualification.reportDigest, `${path}.reportDigest`),
	});
}

export function validateEmpiricalCampaignManifest(value: unknown): EmpiricalCampaignManifestV1 {
	const manifest = record(value, "manifest");
	exactKeys(manifest, MANIFEST_KEYS, "manifest");
	literal(
		manifest.schemaVersion,
		EMPIRICAL_MEMORY_RERUN_AVOIDANCE_SCHEMAS.campaignManifest,
		"manifest.schemaVersion",
	);
	const catalog = validateEmpiricalTaskCatalog(manifest.catalog);
	const trialPlan = validateTrialPlan(manifest.trialPlan, catalog, "manifest.trialPlan");
	const schemaCatalog = validateEmpiricalSchemaCatalog(manifest.schemaCatalog);
	const modelValues = array(manifest.modelConfigurations, "manifest.modelConfigurations");
	if (modelValues.length < 1 || modelValues.length > 4) {
		fail("manifest.modelConfigurations", "expected between one and four focused configurations");
	}
	const modelConfigurations = modelValues.map((configuration, index) =>
		validateModelConfiguration(configuration, `manifest.modelConfigurations[${index}]`),
	);
	const selectedToolRefs = new Set<string>();
	const selectedOutputRefs = new Set<string>();
	for (const configuration of modelConfigurations) {
		if (configuration.settings.tools.schemaRevision !== schemaCatalog.catalogRevision) {
			fail(
				"manifest.modelConfigurations",
				"tool schema revision must equal the frozen schema catalog revision",
			);
		}
		const selectedTools = configuration.settings.tools.toolRefs.map((toolRef) => {
			const tool = schemaCatalog.tools.find((entry) => entry.toolRef === toolRef);
			if (tool === undefined) {
				return fail("manifest.modelConfigurations", `unknown tool schema ref ${toolRef}`);
			}
			selectedToolRefs.add(toolRef);
			return tool;
		});
		if (configuration.settings.tools.toolSetDigest !== empiricalStrictJsonDigest(selectedTools)) {
			fail("manifest.modelConfigurations", "toolSetDigest does not match selected schema entries");
		}
		const output = schemaCatalog.outputs.find(
			(entry) => entry.schemaRef === configuration.settings.output.schemaRef,
		);
		if (output === undefined) {
			fail("manifest.modelConfigurations", "selected output schema is missing from the catalog");
		}
		selectedOutputRefs.add(output.schemaRef);
		if (
			output.role !== configuration.role ||
			output.schemaRevision !== configuration.settings.output.schemaRevision ||
			output.schemaDigest !== configuration.settings.output.schemaDigest
		) {
			fail(
				"manifest.modelConfigurations",
				"selected output schema does not match role, revision, and digest",
			);
		}
	}
	if (
		selectedToolRefs.size !== schemaCatalog.tools.length ||
		selectedOutputRefs.size !== schemaCatalog.outputs.length
	) {
		fail(
			"manifest.schemaCatalog",
			"every schema catalog entry must be selected by a configuration",
		);
	}
	if (
		new Set(modelConfigurations.map((configuration) => configuration.configurationRef)).size !==
		modelConfigurations.length
	) {
		fail("manifest.modelConfigurations", "configuration refs must be unique");
	}
	const modelCoordinateDigests = modelConfigurations.map((configuration) =>
		empiricalStrictJsonDigest({ ...configuration, configurationRef: "" }),
	);
	if (new Set(modelCoordinateDigests).size !== modelCoordinateDigests.length) {
		fail("manifest.modelConfigurations", "model coordinates must be unique beyond their refs");
	}
	const actorConfigurations = modelConfigurations.filter(
		(configuration) => configuration.role === "actor",
	);
	if (actorConfigurations.length === 0) {
		fail("manifest.modelConfigurations", "requires at least one actor configuration");
	}
	const providerCoordinates = new Set(
		modelConfigurations.map((configuration) =>
			empiricalStrictJsonDigest({
				adapterRevision: configuration.adapterRevision,
				bindingRevision: configuration.bindingRevision,
				endpoint: configuration.endpoint,
				endpointRevision: configuration.endpointRevision,
				provider: configuration.provider,
				providerFamily: configuration.providerFamily,
			}),
		),
	);
	if (providerCoordinates.size !== 1) {
		fail("manifest.modelConfigurations", "the first empirical round permits exactly one provider");
	}
	const policies = validatePolicies(manifest.policies, "manifest.policies");
	const enabledRoleConfigurations: EmpiricalModelConfigurationV1[] = [];
	for (const [role, rolePolicy] of [
		["auxiliary-judge", policies.auxiliaryJudge],
		["semantic-redactor", policies.semanticRedactor],
	] as const) {
		const matching = modelConfigurations.filter((configuration) => configuration.role === role);
		if (rolePolicy.enabled) {
			if (matching.length !== 1 || matching[0]?.configurationRef !== rolePolicy.configurationRef) {
				fail(
					`manifest.policies.${role === "auxiliary-judge" ? "auxiliaryJudge" : "semanticRedactor"}`,
					"enabled role must bind one matching focused configuration",
				);
			}
			enabledRoleConfigurations.push(matching[0] as EmpiricalModelConfigurationV1);
		} else if (matching.length !== 0) {
			fail("manifest.modelConfigurations", `disabled ${role} role has a configuration`);
		}
	}
	const actorCredentialPolicies = new Set(
		actorConfigurations.map((configuration) =>
			empiricalStrictJsonDigest([
				configuration.credentialPolicyRef,
				configuration.credentialPolicyRevision,
			]),
		),
	);
	for (const configuration of enabledRoleConfigurations) {
		const credentialPolicyCoordinate = empiricalStrictJsonDigest([
			configuration.credentialPolicyRef,
			configuration.credentialPolicyRevision,
		]);
		if (actorCredentialPolicies.has(credentialPolicyCoordinate)) {
			fail(
				"manifest.modelConfigurations",
				"auxiliary role credential policy must be isolated from actor configurations",
			);
		}
	}
	for (let left = 0; left < enabledRoleConfigurations.length; left += 1) {
		for (let right = left + 1; right < enabledRoleConfigurations.length; right += 1) {
			const leftConfiguration = enabledRoleConfigurations[left] as EmpiricalModelConfigurationV1;
			const rightConfiguration = enabledRoleConfigurations[right] as EmpiricalModelConfigurationV1;
			if (
				leftConfiguration.credentialPolicyRef === rightConfiguration.credentialPolicyRef &&
				leftConfiguration.credentialPolicyRevision === rightConfiguration.credentialPolicyRevision
			) {
				fail(
					"manifest.modelConfigurations",
					"auxiliary role credential policies must be isolated from each other",
				);
			}
		}
	}
	const enabledRolePolicies: Array<{
		role: string;
		policy: string;
		credentialBinding: string;
		tracePolicy: string;
		inputAuthority: string;
	}> = [
		{
			role: "actor",
			policy: empiricalStrictJsonDigest([policies.actorPolicyRef, policies.actorPolicyRevision]),
			credentialBinding: empiricalStrictJsonDigest([
				policies.actorCredentialBindingRef,
				policies.actorCredentialBindingRevision,
			]),
			tracePolicy: empiricalStrictJsonDigest([
				policies.actorTracePolicyRef,
				policies.actorTracePolicyRevision,
			]),
			inputAuthority: empiricalStrictJsonDigest([
				policies.actorInputAuthorityRef,
				policies.actorInputAuthorityRevision,
			]),
		},
	];
	for (const [role, policy] of [
		["auxiliary-judge", policies.auxiliaryJudge],
		["semantic-redactor", policies.semanticRedactor],
	] as const) {
		if (!policy.enabled) continue;
		enabledRolePolicies.push({
			role,
			policy: empiricalStrictJsonDigest([policy.policyRef, policy.policyRevision]),
			credentialBinding: empiricalStrictJsonDigest([
				policy.credentialBindingRef,
				policy.credentialBindingRevision,
			]),
			tracePolicy: empiricalStrictJsonDigest([policy.tracePolicyRef, policy.tracePolicyRevision]),
			inputAuthority: empiricalStrictJsonDigest([
				policy.inputAuthorityRef,
				policy.inputAuthorityRevision,
			]),
		});
	}
	for (const field of ["policy", "credentialBinding", "tracePolicy", "inputAuthority"] as const) {
		const coordinates = enabledRolePolicies.map((role) => role[field]);
		if (new Set(coordinates).size !== coordinates.length) {
			fail("manifest.policies", `${field} coordinates must be isolated across enabled roles`);
		}
	}
	const qualification = validateQualification(manifest.qualification, "manifest.qualification");
	if (qualification.taskCatalogDigest !== empiricalStrictJsonDigest(catalog)) {
		fail("manifest.qualification.taskCatalogDigest", "does not match manifest catalog");
	}
	const budgets = validateBudgets(manifest.budgets, "manifest.budgets");
	for (const configuration of modelConfigurations) {
		if (configuration.settings.tools.maxSteps > budgets.agentRun.maxSteps) {
			fail(
				"manifest.modelConfigurations",
				"model tool maxSteps cannot exceed the agent-run maxSteps budget",
			);
		}
	}
	const activeTaskCount = trialPlan.activeTaskRefs.length;
	const blockCount = trialPlan.attemptedColdBlocksPerTask;
	const runCountPerTaskModel = blockCount * 6;
	const minimumTaskModelRequests = runCountPerTaskModel * budgets.agentRun.maxRequests;
	const minimumCampaignRequests =
		activeTaskCount * actorConfigurations.length * budgets.taskModel.maxRequests;
	const minimumCampaignCost =
		activeTaskCount * actorConfigurations.length * budgets.taskModel.maxCostMicrousd;
	if (
		!Number.isSafeInteger(minimumTaskModelRequests) ||
		!Number.isSafeInteger(minimumCampaignRequests) ||
		!Number.isSafeInteger(minimumCampaignCost)
	) {
		fail("manifest.budgets", "derived budget bounds exceed safe integers");
	}
	if (budgets.taskModel.maxAttemptedColdBlocks < blockCount) {
		fail(
			"manifest.budgets.taskModel.maxAttemptedColdBlocks",
			"is smaller than the frozen trial plan",
		);
	}
	if (budgets.taskModel.maxRequests < minimumTaskModelRequests) {
		fail(
			"manifest.budgets.taskModel.maxRequests",
			"cannot cover cold plus five warm arms at the agent-run request bound",
		);
	}
	if (budgets.campaign.maxRequests < minimumCampaignRequests) {
		fail("manifest.budgets.campaign.maxRequests", "cannot cover active task-model bounds");
	}
	if (budgets.campaign.maxCostMicrousd < minimumCampaignCost) {
		fail("manifest.budgets.campaign.maxCostMicrousd", "cannot cover active task-model bounds");
	}
	if (budgets.campaign.maxElapsedMs < budgets.agentRun.maxElapsedMs) {
		fail("manifest.budgets.campaign.maxElapsedMs", "is smaller than one agent-run bound");
	}
	return strictSnapshot({
		schemaVersion: EMPIRICAL_MEMORY_RERUN_AVOIDANCE_SCHEMAS.campaignManifest,
		campaignRef: string(manifest.campaignRef, "manifest.campaignRef"),
		familyRef: string(manifest.familyRef, "manifest.familyRef"),
		lane: literal(manifest.lane, "empirical-real-model", "manifest.lane"),
		catalog,
		qualification,
		trialPlan,
		schemaCatalog,
		modelConfigurations,
		policies,
		budgets,
		aggregation: validateAggregation(manifest.aggregation, "manifest.aggregation"),
	});
}

export function validateEmpiricalCampaignManifestBytes(
	bytes: Uint8Array,
): EmpiricalCampaignManifestV1 {
	if (bytes.byteLength === 0 || bytes.byteLength > MAX_EMPIRICAL_CAMPAIGN_MANIFEST_BYTES) {
		fail(
			"manifest",
			`expected between 1 and ${MAX_EMPIRICAL_CAMPAIGN_MANIFEST_BYTES} canonical bytes`,
		);
	}
	const decoded = strictJsonCodec.decode(bytes);
	assertCanonicalBytes(decoded, bytes, "manifest");
	return deepFreeze(validateEmpiricalCampaignManifest(decoded));
}
