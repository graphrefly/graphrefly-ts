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
	OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_FIRST_SMOKE_REQUEST_MODEL,
	OPENROUTER_OFFICIAL_PRICING_REVISION,
	OPENROUTER_OFFICIAL_PRICING_SOURCE,
	OPENROUTER_ROUTE_EVIDENCE_SCHEMA_REVISION,
	OPENROUTER_ROUTE_QUALIFICATION_SCHEMA,
	OPENROUTER_SHARED_CAPACITY_QUALIFICATION_SCHEMA,
	type OpenRouterRouteQualificationV1,
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
		providerFamily: "openrouter",
		provider: "openrouter",
		model: OPENROUTER_FIRST_SMOKE_REQUEST_MODEL,
		modelIdentityKind: "alias-disclosed" as const,
		endpoint: OPENROUTER_RESPONSES_ENDPOINT,
		endpointRevision: OPENROUTER_RESPONSES_ENDPOINT_REVISION,
		adapterRevision: OPENROUTER_RESPONSES_ADAPTER_REVISION,
		bindingRevision: OPENROUTER_RESPONSES_BINDING_REVISION,
		promptRevision: OPENROUTER_RESPONSES_PROMPT_REVISION,
		systemPromptRevision: OPENROUTER_RESPONSES_SYSTEM_PROMPT_REVISION,
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
			reasoning: { mode: "provider-native" as const, effort: "medium" },
			tools: {
				...baseConfiguration.settings.tools,
				schemaRevision: schemaCatalog.catalogRevision,
				toolRefs: schemaCatalog.tools.map((tool) => tool.toolRef),
				toolSetDigest: empiricalStrictJsonDigest(schemaCatalog.tools),
				maxSteps: 8,
			},
		},
		usageSource: "provider-reported" as const,
		pricingRevision: OPENROUTER_OFFICIAL_PRICING_REVISION,
		pricingScheduleRef: OPENROUTER_OFFICIAL_PRICING_SOURCE,
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

function simulatedRouteQualification(
	fixture: ClosedHostFixture,
	budgetOverrides: Readonly<Record<string, number>> = {},
): OpenRouterRouteQualificationV1 {
	const configuration = fixture.frozen.manifest.modelConfigurations[0];
	if (configuration === undefined) throw new Error("missing smoke configuration");
	const credentialBindingRef = fixture.frozen.manifest.policies.actorCredentialBindingRef;
	const credentialBindingRevision = fixture.frozen.manifest.policies.actorCredentialBindingRevision;
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
		requestModel: OPENROUTER_FIRST_SMOKE_REQUEST_MODEL,
		modelIdentityKind: configuration.modelIdentityKind,
		downstreamProviderSlug: OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_SLUG,
		downstreamProviderName: OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_NAME,
		endpoint: OPENROUTER_RESPONSES_ENDPOINT,
		endpointRevision: OPENROUTER_RESPONSES_ENDPOINT_REVISION,
		adapterRevision: OPENROUTER_RESPONSES_ADAPTER_REVISION,
		bindingRevision: OPENROUTER_RESPONSES_BINDING_REVISION,
		capabilitiesDigest: empiricalStrictJsonDigest(configuration.capabilities),
		settingsDigest: empiricalStrictJsonDigest(configuration.settings),
		usageSource: configuration.usageSource,
		usageRevision: "openrouter-provider-usage-2026-07-29.v1",
		routeEvidenceSchemaRevision: OPENROUTER_ROUTE_EVIDENCE_SCHEMA_REVISION,
		pricing: {
			sourceUrl: OPENROUTER_OFFICIAL_PRICING_SOURCE,
			pricingRevision: OPENROUTER_OFFICIAL_PRICING_REVISION,
			currency: "USD" as const,
			inputMicrousdPerMillionTokens: 5_000_000,
			outputMicrousdPerMillionTokens: 30_000_000,
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

function dryRunOpenRouterResponse(
	id: string,
	output: readonly unknown[],
	usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
): { readonly status: 200; readonly body: Uint8Array } {
	return {
		status: 200,
		body: encoder.encode(
			JSON.stringify({
				id,
				object: "response",
				status: "completed",
				model: OPENROUTER_FIRST_SMOKE_REQUEST_MODEL,
				output,
				usage,
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
				costMicrousd: 99_585,
				costBasis: "conservative-reservation",
				reservedInputTokens: 7_629,
				reservedOutputTokens: 2_048,
			},
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
			costMicrousd: 99_585,
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
		).toThrow(/exceeds or mismatches/);
		expect(() =>
			validateEmpiricalCampaignScorecard({
				...preDispatchScorecard,
				inputTokens: 1,
				outputTokens: 1,
				totalTokens: 2,
				costBasis: "provider-usage",
			}),
		).toThrow(/evidence and cost provenance/);
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
				costMicrousd: 99_585,
				costBasis: "conservative-reservation",
				reservedInputTokens: 7_629,
				reservedOutputTokens: 2_048,
			},
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
		).toThrow(/required frozen evidence/);
		const overrunObservation = {
			...result.observation,
			executionClass: "live-provider" as const,
			empiricalLiveEvidence: true,
			result: {
				...result.observation.result,
				classification: "non-evaluable" as const,
				verifierStatus: "not-run" as const,
				inputTokens: result.observation.route.maxInputTokens + 1,
				outputTokens: result.observation.route.maxOutputTokens + 1,
				costMicrousd: result.observation.route.maxSmokeSpendMicrousd + 1,
				costBasis: "provider-usage" as const,
			},
			issueCodes: ["smoke-budget-exhausted"],
		};
		expect(validateEmpiricalTrialBlockObservation(overrunObservation).result.costBasis).toBe(
			"provider-usage",
		);
		expect(() =>
			validateEmpiricalTrialBlockObservation({
				...overrunObservation,
				routeEvidenceDigests: [],
				protectionReceiptDigests: [],
			}),
		).toThrow(/required frozen evidence/);
		const persistedFiles = readdirSync(result.persistence.generationPath).sort();
		expect(persistedFiles).toEqual([
			"campaign-scorecard.v1.json",
			"generation.v1.json",
			"trial-block-observation.v1.json",
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
			routeQualification: simulatedRouteQualification(fixture),
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
			executionClass: "simulated-contract",
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
				join(result.persistence.generationPath, "trial-block-observation.v1.json"),
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
			routeQualification: simulatedRouteQualification(fixture),
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
					});
				},
			},
			monotonicMeasurement: { readMs: () => 0 },
			executionClass: "simulated-contract",
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
			routeQualification: simulatedRouteQualification(fixture),
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
			executionClass: "simulated-contract",
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
				join(result.persistence.generationPath, "trial-block-observation.v1.json"),
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
			routeQualification: simulatedRouteQualification(fixture),
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
							{ input_tokens: 100_001, output_tokens: 20, total_tokens: 100_021 },
						),
					);
				},
			},
			monotonicMeasurement: { readMs: () => 0 },
			executionClass: "simulated-contract",
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
			},
		});
		expect(result.observation.issueCodes).toContain(B112_SMOKE_BUDGET_ISSUE_CODE);
		expect(result.observation.routeEvidenceDigests).toHaveLength(1);
		expect(result.scorecard.status).toBe("non-evaluable");
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

		const loopBound = await runBoundedCase("request-step", { maxRequests: 2 }, 2);
		expect(loopBound.observation.result).toMatchObject({ requests: 2, steps: 3 });

		const stepBound = await runBoundedCase("step", {}, 8, "agent-step-budget-exhausted");
		expect(stepBound.observation.result).toMatchObject({ requests: 8, steps: 8 });

		const costBound = await runBoundedCase("cost", { maxSmokeSpendMicrousd: 1 }, 0);
		expect(costBound.observation.result).toMatchObject({ requests: 0, steps: 1 });
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
