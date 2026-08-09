import { describe, expect, it, vi } from "vitest";
import {
	empiricalStrictJsonDigest,
	strictSnapshot,
} from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	CLOSED_ACTOR_TOOL_REFS,
	CLOSED_TASK_PROFILE_HOST_SCHEMAS,
	type ClosedHostContinuationV1,
	D682_HOST_DERIVED_REPLACE_SCHEMA_REVISION,
} from "../../evals/empirical-memory-rerun-avoidance/closed-task-profile-host.js";
import type {
	EmpiricalCampaignManifestV1,
	EmpiricalStrictJsonShapeV1,
	EmpiricalTaskQualificationReportV1,
	FrozenEmpiricalCampaignManifestV1,
} from "../../evals/empirical-memory-rerun-avoidance/contracts.js";
import { createD682MechanicalActorInput } from "../../evals/empirical-memory-rerun-avoidance/d682-mechanical-qualification.js";
import {
	EMPIRICAL_MODEL_EGRESS_BLOCKED_SUBJECT_EVIDENCE_KIND,
	EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES,
	type EmpiricalModelTurnRequestV1,
	executeEmpiricalProtection,
	validateEmpiricalModelTurnRequest,
} from "../../evals/empirical-memory-rerun-avoidance/model-execution.js";
import { runOpenRouterFirstTaskCapabilityProbe } from "../../evals/empirical-memory-rerun-avoidance/openrouter-first-task-capability-probe.js";
import { runLoadedOpenRouterFirstTaskCapabilityProbeOperator } from "../../evals/empirical-memory-rerun-avoidance/openrouter-first-task-capability-probe-operator.js";
import {
	type OpenRouterFirstTaskSmokeOperatorInputV1,
	runLoadedOpenRouterFirstTaskSmokeOperator,
	runWithOpenRouterSmokeInitialMaterializationOwnership,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-first-task-smoke-operator.js";
import {
	createOpenRouterResponsesEmpiricalBinding,
	MAX_OPENROUTER_RESPONSES_RESPONSE_BYTES,
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
	OPENROUTER_RESPONSES_DOWNSTREAM_PROVIDER,
	OPENROUTER_RESPONSES_ENDPOINT,
	OPENROUTER_RESPONSES_ENDPOINT_REVISION,
	OPENROUTER_RESPONSES_ISSUE_CODES,
	OPENROUTER_RESPONSES_MODEL,
	OPENROUTER_RESPONSES_PROMPT_REVISION,
	OPENROUTER_RESPONSES_SYSTEM_PROMPT_REVISION,
	OPENROUTER_SHARED_CAPACITY_QUALIFICATION_SCHEMA,
	type OpenRouterResponsesByteTransportV1,
	type OpenRouterResponsesEmpiricalBindingV1,
	type OpenRouterResponsesTransportRequestV1,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-responses-model-turn.js";
import {
	OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
	OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
	OPENROUTER_DEEPSEEK_V4_FLASH_SELECTED_MODEL,
	OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_GLM_5_2_DEEPINFRA_DOWNSTREAM_PROVIDER_NAME as OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_GLM_5_2_DEEPINFRA_DOWNSTREAM_PROVIDER_SLUG as OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_GLM_5_2_DEEPINFRA_INPUT_MICROUSD_PER_MILLION_TOKENS as OPENROUTER_GLM_5_2_INPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_GLM_5_2_DEEPINFRA_OUTPUT_MICROUSD_PER_MILLION_TOKENS as OPENROUTER_GLM_5_2_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_GLM_5_2_DEEPINFRA_PRICING_REVISION as OPENROUTER_GLM_5_2_PRICING_REVISION,
	OPENROUTER_GLM_5_2_DEEPINFRA_PRICING_SOURCE as OPENROUTER_GLM_5_2_PRICING_SOURCE,
	OPENROUTER_GLM_5_2_REQUEST_MODEL,
	OPENROUTER_OFFICIAL_PRICING_REVISION,
	OPENROUTER_OFFICIAL_PRICING_SOURCE,
	OPENROUTER_ROUTE_EVIDENCE_SCHEMA_REVISION,
	OPENROUTER_ROUTE_QUALIFICATION_SCHEMA,
	type OpenRouterRouteQualificationV1,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-route-qualification.js";
import { createOpenRouterTransportFailure } from "../../evals/empirical-memory-rerun-avoidance/openrouter-transport-failure.js";
import { freezeEmpiricalCampaignManifest } from "../../evals/empirical-memory-rerun-avoidance/qualification.js";
import { strictJsonCodec } from "../json/codec.js";
import { buildEmpiricalCampaignFixture } from "./eval-support/empirical-memory-rerun-avoidance/fixtures.js";
import {
	buildEmpiricalModelTurnRequestFixture,
	type EmpiricalModelTurnAuthorityFixture,
} from "./eval-support/empirical-memory-rerun-avoidance/model-execution-fixtures.js";

const bearerToken = "openrouter-bearer-placeholder-0123456789";
const responseEncoder = new TextEncoder();

function d682ActorInput(): EmpiricalModelTurnRequestV1["structuredInput"] {
	const input = createD682MechanicalActorInput({
		workItemRef: "work-item-d682-fixture",
		instructionRef: "instruction-d682-fixture",
		readablePaths: ["README.md"],
		writablePaths: ["README.md"],
		commandRefs: ["actor.status"],
		path: "README.md",
		oldText: "broken-placeholder-value",
		newText: "fixed",
	});
	return strictJsonCodec.decode(
		strictJsonCodec.encode(input),
	) as EmpiricalModelTurnRequestV1["structuredInput"];
}

interface OpenRouterAuthorityFixture extends EmpiricalModelTurnAuthorityFixture {
	readonly manifest: EmpiricalCampaignManifestV1;
}

function sharedCapacityQualification(authority: OpenRouterAuthorityFixture) {
	return {
		schemaVersion: OPENROUTER_SHARED_CAPACITY_QUALIFICATION_SCHEMA,
		qualificationRef: "shared-capacity-qualification-placeholder",
		qualificationRevision: "shared-capacity-qualification-revision-placeholder",
		credentialBindingRef: authority.manifest.policies.actorCredentialBindingRef,
		credentialBindingRevision: authority.manifest.policies.actorCredentialBindingRevision,
		workspaceRef: "openrouter-workspace-placeholder",
		workspaceRevision: "openrouter-workspace-revision-placeholder",
		capacityMode: "openrouter-shared-only" as const,
		qualified: true as const,
		byokCredentialCount: 0 as const,
	} as const;
}

function routeQualification(authority: OpenRouterAuthorityFixture): OpenRouterRouteQualificationV1 {
	const configuration = authority.manifest.modelConfigurations[0];
	if (configuration === undefined) throw new TypeError("missing OpenRouter configuration");
	const request = buildEmpiricalModelTurnRequestFixture(authority);
	return {
		schemaVersion: OPENROUTER_ROUTE_QUALIFICATION_SCHEMA,
		qualificationRef: "openrouter-route-qualification-placeholder",
		qualificationRevision: "openrouter-route-qualification-revision-placeholder",
		dispatchMode: "simulated" as const,
		campaignRef: authority.manifest.campaignRef,
		manifestDigest: authority.frozen.manifestDigest,
		trialBlockRef: request.trialBlockRef,
		trialBlockDigest: request.trialBlockDigest,
		configurationRef: configuration.configurationRef,
		configurationDigest: empiricalStrictJsonDigest(configuration),
		requestModel: configuration.model,
		modelIdentityKind: configuration.modelIdentityKind,
		downstreamProviderSlug: OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_SLUG,
		downstreamProviderName: OPENROUTER_RESPONSES_DOWNSTREAM_PROVIDER,
		endpoint: configuration.endpoint as OpenRouterRouteQualificationV1["endpoint"],
		endpointRevision: configuration.endpointRevision,
		adapterRevision: configuration.adapterRevision,
		bindingRevision: configuration.bindingRevision,
		capabilitiesDigest: empiricalStrictJsonDigest(configuration.capabilities),
		settingsDigest: empiricalStrictJsonDigest(configuration.settings),
		usageSource: configuration.usageSource,
		usageRevision: "openrouter-provider-usage-placeholder",
		routeEvidenceSchemaRevision: OPENROUTER_ROUTE_EVIDENCE_SCHEMA_REVISION,
		pricing: {
			sourceUrl: OPENROUTER_OFFICIAL_PRICING_SOURCE,
			pricingRevision: OPENROUTER_OFFICIAL_PRICING_REVISION,
			currency: "USD" as const,
			inputMicrousdPerMillionTokens: 6_250_000,
			outputMicrousdPerMillionTokens: 30_000_000,
		},
		budget: {
			approvalRef: "simulated-budget-approval-placeholder",
			approvalRevision: "simulated-budget-approval-revision-placeholder",
			maxSmokeSpendMicrousd: 1_000_000,
			maxRequests: 24,
			maxStepsPerRun: 8,
			maxCanonicalRequestBytes: 262_144,
			maxInputTokens: 100_000,
			maxOutputTokens: 49_152,
			maxLatencyMs: 600_000,
			reservationRevision: "canonical-byte-upper-bound-reservation-v1",
			inputTokensPerCanonicalByteUpperBound: 1 as const,
			fixedInputTokenOverheadPerRequest: 4_096,
		},
		keySpendLimit: {
			qualificationRef: "simulated-key-limit-qualification-placeholder",
			qualificationRevision: "simulated-key-limit-revision-placeholder",
			readOnlyQualified: false,
			limitReset: "none" as const,
			limitMicrousd: 1_000_000,
			remainingMicrousd: 1_000_000,
			credentialBindingRef: authority.manifest.policies.actorCredentialBindingRef,
			credentialBindingRevision: authority.manifest.policies.actorCredentialBindingRevision,
			workspaceRef: "openrouter-workspace-placeholder",
			workspaceRevision: "openrouter-workspace-revision-placeholder",
		},
		sharedCapacityQualification: sharedCapacityQualification(authority),
	} as const;
}

function openRouterManifest(
	base: EmpiricalCampaignManifestV1,
	shapeOverride?: EmpiricalStrictJsonShapeV1,
): EmpiricalCampaignManifestV1 {
	const baseConfiguration = base.modelConfigurations[0];
	const baseOutput = base.schemaCatalog.outputs[0];
	if (baseConfiguration === undefined || baseOutput === undefined) {
		throw new TypeError("OpenRouter test fixture requires one configuration and output schema");
	}
	const output =
		shapeOverride === undefined
			? baseOutput
			: {
					...baseOutput,
					schema: shapeOverride,
					schemaDigest: empiricalStrictJsonDigest(shapeOverride),
				};
	const schemaCatalog = {
		...base.schemaCatalog,
		outputs: [output],
	};
	const configuration = {
		...baseConfiguration,
		providerFamily: "openrouter",
		provider: "openrouter",
		model: OPENROUTER_RESPONSES_MODEL,
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
			output: {
				...baseConfiguration.settings.output,
				schemaRef: output.schemaRef,
				schemaRevision: output.schemaRevision,
				schemaDigest: output.schemaDigest,
			},
		},
		usageSource: "provider-reported" as const,
		pricingRevision: OPENROUTER_OFFICIAL_PRICING_REVISION,
		pricingScheduleRef: OPENROUTER_OFFICIAL_PRICING_SOURCE,
	};
	return strictSnapshot({
		...base,
		schemaCatalog,
		modelConfigurations: [configuration],
	});
}

function buildAuthority(shapeOverride?: EmpiricalStrictJsonShapeV1): OpenRouterAuthorityFixture {
	const campaign = buildEmpiricalCampaignFixture();
	const manifest = openRouterManifest(campaign.manifest, shapeOverride);
	return Object.freeze({
		manifest,
		frozen: freezeEmpiricalCampaignManifest(manifest, campaign.report),
		qualificationReport: campaign.report,
	});
}

function buildGlmAuthority(): OpenRouterAuthorityFixture {
	const campaign = buildEmpiricalCampaignFixture();
	const base = openRouterManifest(campaign.manifest);
	const baseConfiguration = base.modelConfigurations[0];
	if (baseConfiguration === undefined) {
		throw new TypeError("GLM OpenRouter fixture requires one configuration");
	}
	const configuration = strictSnapshot({
		...baseConfiguration,
		configurationRef: "actor.openrouter.z-ai.glm-5.2",
		model: OPENROUTER_GLM_5_2_REQUEST_MODEL,
		endpoint: OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
		endpointRevision: OPENROUTER_CHAT_COMPLETIONS_ENDPOINT_REVISION,
		adapterRevision: OPENROUTER_CHAT_COMPLETIONS_ADAPTER_REVISION,
		bindingRevision: OPENROUTER_CHAT_COMPLETIONS_BINDING_REVISION,
		promptRevision: OPENROUTER_CHAT_COMPLETIONS_PROMPT_REVISION,
		systemPromptRevision: OPENROUTER_CHAT_COMPLETIONS_SYSTEM_PROMPT_REVISION,
		settings: {
			...baseConfiguration.settings,
			reasoning: { mode: "provider-native" as const, effort: "high" },
			tools: {
				...baseConfiguration.settings.tools,
				choice: "required" as const,
			},
		},
		pricingRevision: OPENROUTER_GLM_5_2_PRICING_REVISION,
		pricingScheduleRef: OPENROUTER_GLM_5_2_PRICING_SOURCE,
	});
	const manifest = strictSnapshot({
		...base,
		campaignRef: "b112-openrouter-z-ai-glm-5.2-smoke-fixture",
		modelConfigurations: [configuration],
	});
	return Object.freeze({
		manifest,
		frozen: freezeEmpiricalCampaignManifest(manifest, campaign.report),
		qualificationReport: campaign.report,
	});
}

function glmRouteQualification(
	authority: OpenRouterAuthorityFixture,
): OpenRouterRouteQualificationV1 {
	const base = routeQualification(authority);
	return strictSnapshot({
		...base,
		downstreamProviderSlug: OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_SLUG,
		downstreamProviderName: OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME,
		pricing: {
			sourceUrl: OPENROUTER_GLM_5_2_PRICING_SOURCE,
			pricingRevision: OPENROUTER_GLM_5_2_PRICING_REVISION,
			currency: "USD" as const,
			inputMicrousdPerMillionTokens: OPENROUTER_GLM_5_2_INPUT_MICROUSD_PER_MILLION_TOKENS,
			outputMicrousdPerMillionTokens: OPENROUTER_GLM_5_2_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
		},
	});
}

function buildDeepSeekAuthority(
	closedTools = false,
	hostDerivedReplace = false,
	substitutedHostDerivedReplace = false,
): OpenRouterAuthorityFixture {
	const campaign = buildEmpiricalCampaignFixture();
	const base = openRouterManifest(campaign.manifest);
	const baseConfiguration = base.modelConfigurations[0];
	if (baseConfiguration === undefined) {
		throw new TypeError("DeepSeek OpenRouter fixture requires one configuration");
	}
	const stringShape = (enumValues: readonly string[] | null = null) => ({
		kind: "string" as const,
		minLength: 1,
		maxLength: 32_768,
		enum: enumValues,
	});
	const replacementStringShape = {
		kind: "string" as const,
		minLength: 0,
		maxLength: 32_768,
		enum: null,
	};
	const integerShape = {
		kind: "integer" as const,
		minimum: 1,
		maximum: hostDerivedReplace ? 32 : 4_096,
	};
	const objectShape = (
		properties: readonly {
			readonly name: string;
			readonly required: boolean;
			readonly shape: EmpiricalStrictJsonShapeV1;
		}[],
	): EmpiricalStrictJsonShapeV1 => ({ kind: "object", properties, additionalProperties: false });
	const closedToolInputs = new Map<string, EmpiricalStrictJsonShapeV1>([
		[
			CLOSED_ACTOR_TOOL_REFS.readFile,
			objectShape([
				{
					name: "path",
					required: true,
					shape: stringShape(hostDerivedReplace ? ["README.md"] : null),
				},
			]),
		],
		[
			CLOSED_ACTOR_TOOL_REFS.searchLiteral,
			objectShape([
				{ name: "maxMatches", required: true, shape: integerShape },
				{
					name: "path",
					required: true,
					shape: stringShape(hostDerivedReplace ? ["README.md"] : null),
				},
				{ name: "query", required: true, shape: stringShape() },
			]),
		],
		[
			CLOSED_ACTOR_TOOL_REFS.replaceExact,
			objectShape([
				...(hostDerivedReplace
					? substitutedHostDerivedReplace
						? [{ name: "baseContentDigest", required: false, shape: stringShape() }]
						: []
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
					shape: stringShape(hostDerivedReplace ? ["README.md"] : null),
				},
			]),
		],
		[CLOSED_ACTOR_TOOL_REFS.workspaceDiff, objectShape([])],
		[
			CLOSED_ACTOR_TOOL_REFS.runCommand,
			objectShape([
				{
					name: "commandRef",
					required: true,
					shape: stringShape(hostDerivedReplace ? ["actor.status"] : null),
				},
			]),
		],
	]);
	const tools = closedTools
		? Object.values(CLOSED_ACTOR_TOOL_REFS).map((toolRef) => {
				const inputSchema = closedToolInputs.get(toolRef);
				if (inputSchema === undefined) throw new TypeError(`missing closed schema for ${toolRef}`);
				return strictSnapshot({
					toolRef,
					schemaRevision: hostDerivedReplace
						? D682_HOST_DERIVED_REPLACE_SCHEMA_REVISION
						: "closed-task-tools.d659.v1",
					inputSchema,
					inputSchemaDigest: empiricalStrictJsonDigest(inputSchema),
				});
			})
		: base.schemaCatalog.tools;
	const configuration = strictSnapshot({
		...baseConfiguration,
		configurationRef: "actor.openrouter.deepseek.deepseek-v4-flash",
		model: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
		endpoint: OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
		endpointRevision: OPENROUTER_CHAT_COMPLETIONS_ENDPOINT_REVISION,
		adapterRevision: OPENROUTER_CHAT_COMPLETIONS_ADAPTER_REVISION,
		bindingRevision: OPENROUTER_CHAT_COMPLETIONS_BINDING_REVISION,
		promptRevision: OPENROUTER_CHAT_COMPLETIONS_PROMPT_REVISION,
		systemPromptRevision: OPENROUTER_DEEPSEEK_CHAT_COMPLETIONS_SYSTEM_PROMPT_REVISION,
		settings: {
			...baseConfiguration.settings,
			reasoning: { mode: "provider-native" as const, effort: "high" },
			tools: {
				...baseConfiguration.settings.tools,
				schemaRevision: hostDerivedReplace
					? D682_HOST_DERIVED_REPLACE_SCHEMA_REVISION
					: baseConfiguration.settings.tools.schemaRevision,
				toolRefs: tools.map((tool) => tool.toolRef),
				toolSetDigest: empiricalStrictJsonDigest(tools),
				choice: "required" as const,
			},
		},
		pricingRevision: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
		pricingScheduleRef: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
	});
	const manifest = strictSnapshot({
		...base,
		campaignRef: "b112-openrouter-deepseek-v4-flash-smoke-fixture",
		schemaCatalog: {
			...base.schemaCatalog,
			catalogRevision: hostDerivedReplace
				? D682_HOST_DERIVED_REPLACE_SCHEMA_REVISION
				: base.schemaCatalog.catalogRevision,
			tools,
		},
		modelConfigurations: [configuration],
	});
	return Object.freeze({
		manifest,
		frozen: freezeEmpiricalCampaignManifest(manifest, campaign.report),
		qualificationReport: campaign.report,
	});
}

function deepSeekRouteQualification(
	authority: OpenRouterAuthorityFixture,
): OpenRouterRouteQualificationV1 {
	const base = routeQualification(authority);
	return strictSnapshot({
		...base,
		downstreamProviderSlug: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG,
		downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
		pricing: {
			sourceUrl: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
			pricingRevision: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
			currency: "USD" as const,
			inputMicrousdPerMillionTokens: OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
			outputMicrousdPerMillionTokens:
				OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
		},
	});
}

function buildDottedToolAuthority(): OpenRouterAuthorityFixture {
	const campaign = buildEmpiricalCampaignFixture();
	const base = openRouterManifest(campaign.manifest);
	const baseTool = base.schemaCatalog.tools[0];
	const baseOutput = base.schemaCatalog.outputs[0];
	const baseConfiguration = base.modelConfigurations[0];
	if (baseTool === undefined || baseOutput === undefined || baseConfiguration === undefined) {
		throw new TypeError("OpenRouter dotted-tool fixture requires one tool and configuration");
	}
	const tool = {
		...baseTool,
		toolRef: "graphrefly.private-solution-eval.workspace.read-file.v1",
	};
	const output = {
		...baseOutput,
		schemaRef: "graphrefly.private-solution-eval.actor-output.v1",
	};
	const configuration = {
		...baseConfiguration,
		settings: {
			...baseConfiguration.settings,
			tools: {
				...baseConfiguration.settings.tools,
				toolRefs: [tool.toolRef],
				toolSetDigest: empiricalStrictJsonDigest([tool]),
			},
			output: {
				...baseConfiguration.settings.output,
				schemaRef: output.schemaRef,
				schemaRevision: output.schemaRevision,
				schemaDigest: output.schemaDigest,
			},
		},
	};
	const manifest = strictSnapshot({
		...base,
		schemaCatalog: { ...base.schemaCatalog, outputs: [output], tools: [tool] },
		modelConfigurations: [configuration],
	});
	return Object.freeze({
		manifest,
		frozen: freezeEmpiricalCampaignManifest(manifest, campaign.report),
		qualificationReport: campaign.report,
	});
}

function responseBytes(value: unknown): Uint8Array {
	return responseEncoder.encode(JSON.stringify(value));
}

const OPENROUTER_RESPONSES_CANONICAL_MODEL = `${OPENROUTER_RESPONSES_MODEL}-20260709`;

function directRouteMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		requested: OPENROUTER_RESPONSES_MODEL,
		strategy: "direct",
		region: "region-placeholder",
		summary: "available=1, selected=OpenAI",
		attempt: 1,
		is_byok: false,
		endpoints: {
			total: 3,
			available: [
				{
					provider: OPENROUTER_RESPONSES_DOWNSTREAM_PROVIDER,
					model: OPENROUTER_RESPONSES_CANONICAL_MODEL,
					selected: true,
				},
			],
		},
		attempts: [
			{
				provider: OPENROUTER_RESPONSES_DOWNSTREAM_PROVIDER,
				model: OPENROUTER_RESPONSES_CANONICAL_MODEL,
				status: 200,
			},
		],
		pipeline: [],
		...overrides,
	};
}

function glmDirectRouteMetadata(): Record<string, unknown> {
	return {
		requested: OPENROUTER_GLM_5_2_REQUEST_MODEL,
		strategy: "direct",
		attempt: 1,
		is_byok: false,
		endpoints: {
			total: 1,
			available: [
				{
					provider: OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME,
					model: `${OPENROUTER_GLM_5_2_REQUEST_MODEL}-20260616`,
					selected: true,
				},
			],
		},
		attempts: [
			{
				provider: OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME,
				model: `${OPENROUTER_GLM_5_2_REQUEST_MODEL}-20260616`,
				status: 200,
			},
		],
		pipeline: [],
	};
}

function deepSeekChatResponse(input: {
	readonly id: string;
	readonly finishReason: "stop" | "tool_calls";
	readonly message: unknown;
}): Uint8Array {
	return responseBytes({
		id: input.id,
		object: "chat.completion",
		model: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
		choices: [{ index: 0, finish_reason: input.finishReason, message: input.message }],
		usage: { prompt_tokens: 120, completion_tokens: 24, total_tokens: 144, cost: 0.000_015_12 },
		openrouter_metadata: {
			requested: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
			strategy: "direct",
			attempt: 1,
			is_byok: false,
			endpoints: {
				total: 11,
				available: [
					{
						provider: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
						model: OPENROUTER_DEEPSEEK_V4_FLASH_SELECTED_MODEL,
						selected: true,
					},
				],
			},
			region: "SJC",
			summary: "available=1, selected=DeepInfra",
		},
	});
}

function completedResponse(
	output: readonly unknown[],
	overrides: Record<string, unknown> = {},
): Uint8Array {
	return responseBytes({
		id: "resp_placeholder_01",
		object: "response",
		status: "completed",
		model: OPENROUTER_RESPONSES_MODEL,
		output,
		usage: {
			input_tokens: 100,
			output_tokens: 20,
			total_tokens: 120,
			cost: 0.001_225,
		},
		openrouter_metadata: directRouteMetadata(),
		...overrides,
	});
}

function messageOutput(value: unknown): readonly unknown[] {
	return [
		{ type: "reasoning", summary: [] },
		{
			type: "message",
			role: "assistant",
			status: "completed",
			content: [{ type: "output_text", text: JSON.stringify(value) }],
		},
	];
}

function createHarness(
	authority = buildAuthority(),
	response = completedResponse(
		messageOutput({ kind: "model-turn-output-placeholder", summary: "bounded-placeholder" }),
	),
	credentialToken = bearerToken,
	route: OpenRouterRouteQualificationV1 = routeQualification(authority),
	measurements: readonly number[] = [1_000, 1_025],
): {
	readonly binding: OpenRouterResponsesEmpiricalBindingV1;
	readonly request: EmpiricalModelTurnRequestV1;
	readonly transport: ReturnType<typeof vi.fn<OpenRouterResponsesByteTransportV1["request"]>>;
	readonly admission: ReturnType<
		typeof vi.fn<
			(input: {
				readonly requestRef: string;
				readonly wireRequestBytes: number;
				readonly maxOutputTokens: number;
			}) => boolean
		>
	>;
} {
	const transport = vi.fn<OpenRouterResponsesByteTransportV1["request"]>(() =>
		Promise.resolve({ status: 200, body: response, retryAfterMs: null }),
	);
	const admission = vi.fn(() => true);
	let measurementIndex = 0;
	const binding = createOpenRouterResponsesEmpiricalBinding({
		frozen: authority.frozen,
		qualificationReport: authority.qualificationReport,
		configurationRef: authority.manifest.modelConfigurations[0]?.configurationRef as string,
		routeQualification: route,
		credential: {
			credentialBindingRef: authority.manifest.policies.actorCredentialBindingRef,
			credentialBindingRevision: authority.manifest.policies.actorCredentialBindingRevision,
			bearerToken: credentialToken,
		},
		transport: { request: transport },
		transportAdmission: { admit: admission },
		monotonicMeasurement: {
			readMs() {
				const value = measurements[measurementIndex];
				measurementIndex += 1;
				return value ?? measurements.at(-1) ?? 0;
			},
		},
	});
	const request = buildEmpiricalModelTurnRequestFixture(authority);
	return { admission, binding, request, transport };
}

function rebindInput(
	request: EmpiricalModelTurnRequestV1,
	authority: OpenRouterAuthorityFixture,
	structuredInput: EmpiricalModelTurnRequestV1["structuredInput"],
	inspect: () => { readonly disposition: "allowed" | "blocked" } = () => ({
		disposition: "allowed",
	}),
): EmpiricalModelTurnRequestV1 {
	const structuredInputDigest = empiricalStrictJsonDigest(structuredInput);
	const inputProtectionReceipt = executeEmpiricalProtection(
		{ inspect },
		{
			policyRef: request.protectionPolicyRef,
			policyRevision: request.protectionPolicyRevision,
			stage: "source-ingress",
			subject: structuredInput,
		},
	).receipt;
	return validateEmpiricalModelTurnRequest(
		{
			...request,
			structuredInput,
			structuredInputDigest,
			inputProtectionReceipt,
		},
		authority.frozen,
		authority.qualificationReport,
	);
}

function withPriorToolResult(
	request: EmpiricalModelTurnRequestV1,
	authority: OpenRouterAuthorityFixture,
	binding: OpenRouterResponsesEmpiricalBindingV1,
): EmpiricalModelTurnRequestV1 {
	const toolRef = request.availableTools[0]?.toolRef;
	if (toolRef === undefined) throw new TypeError("prior-tool fixture requires one tool");
	const result = strictSnapshot({ status: "bounded-placeholder" });
	const resultDigest = empiricalStrictJsonDigest(result);
	const protectionReceipt = executeEmpiricalProtection(binding.protectionExecutor, {
		policyRef: request.protectionPolicyRef,
		policyRevision: request.protectionPolicyRevision,
		stage: "tool-ingress",
		subject: result,
	}).receipt;
	return validateEmpiricalModelTurnRequest(
		{
			...request,
			priorToolResults: [
				{
					toolCallRef: "call_prior_placeholder",
					toolRef,
					resultDigest,
					result,
					protectionReceipt,
				},
			],
		},
		authority.frozen,
		authority.qualificationReport,
	);
}

function withPriorToolResultValue(
	request: EmpiricalModelTurnRequestV1,
	authority: OpenRouterAuthorityFixture,
	binding: OpenRouterResponsesEmpiricalBindingV1,
	input: {
		readonly toolRef: string;
		readonly result: EmpiricalModelTurnRequestV1["priorToolResults"][number]["result"];
	},
): EmpiricalModelTurnRequestV1 {
	const resultDigest = empiricalStrictJsonDigest(input.result);
	const protectionReceipt = executeEmpiricalProtection(binding.protectionExecutor, {
		policyRef: request.protectionPolicyRef,
		policyRevision: request.protectionPolicyRevision,
		stage: "tool-ingress",
		subject: input.result,
	}).receipt;
	return validateEmpiricalModelTurnRequest(
		{
			...request,
			priorToolResults: [
				{
					toolCallRef: "call_prior_bounded_result",
					toolRef: input.toolRef,
					resultDigest,
					result: input.result,
					protectionReceipt,
				},
			],
		},
		authority.frozen,
		authority.qualificationReport,
	);
}

function serializedWithoutCredential(value: unknown): string {
	const serialized = JSON.stringify(value);
	expect(serialized).not.toContain(bearerToken);
	return serialized;
}

describe("B112 D669-qualified package-private OpenRouter Responses binding", () => {
	it("sends one canonical stateless Responses request and validates protected structured output", async () => {
		const { admission, binding, request, transport } = createHarness();
		const outcome = await binding.modelTurnPort.invoke(request, new AbortController().signal);

		expect(outcome).toMatchObject({
			status: "completed",
			finishReason: "structured-output",
			structuredOutput: {
				kind: "model-turn-output-placeholder",
				summary: "bounded-placeholder",
			},
			toolIntents: [],
			usage: {
				source: "provider-reported",
				inputTokens: 100,
				outputTokens: 20,
				totalTokens: 120,
				providerCostMicrousd: 1_225,
				requests: 1,
			},
			latencyMs: 25,
			issueCodes: [],
		});
		expect(outcome.protectionReceipt.disposition).toBe("allowed");
		expect(transport).toHaveBeenCalledTimes(1);
		const sent = transport.mock.calls[0]?.[0] as OpenRouterResponsesTransportRequestV1;
		expect(admission).toHaveBeenCalledWith({
			requestRef: request.requestRef,
			wireRequestBytes: sent.body.byteLength,
			maxOutputTokens: request.remainingTurnBudget.maxOutputTokens,
		});
		expect(sent).toMatchObject({
			endpoint: OPENROUTER_RESPONSES_ENDPOINT,
			method: "POST",
			authorizationBearer: bearerToken,
			contentType: "application/json",
			xOpenRouterMetadata: "enabled",
			maxResponseBytes: MAX_OPENROUTER_RESPONSES_RESPONSE_BYTES,
		});
		const body = strictJsonCodec.decode(sent.body) as Record<string, unknown>;
		expect(body).toMatchObject({
			model: OPENROUTER_RESPONSES_MODEL,
			provider: {
				order: ["openai"],
				only: ["openai"],
				allow_fallbacks: false,
				require_parameters: true,
			},
			store: false,
			background: false,
			stream: false,
			truncation: "disabled",
			service_tier: "default",
			reasoning: { effort: "medium" },
			tool_choice: "auto",
		});
		expect(body).not.toHaveProperty("parallel_tool_calls");
		expect(body).not.toHaveProperty("previous_response_id");
		expect(body).not.toHaveProperty("conversation");
		expect(body).not.toHaveProperty("temperature");
		expect(body).not.toHaveProperty("top_p");
		expect(body).not.toHaveProperty("seed");
		expect(body).not.toHaveProperty("timeout");
		expect(body).not.toHaveProperty("retry");
		expect(body).not.toHaveProperty("models");
		expect(body).not.toHaveProperty("route");
		expect(body).not.toHaveProperty("plugins");
		expect(body).not.toHaveProperty("transforms");
		expect(body.text).toMatchObject({
			format: {
				type: "json_schema",
				strict: true,
				schema: {
					type: "object",
					required: ["kind", "summary"],
					additionalProperties: false,
				},
			},
		});
		const envelope = JSON.parse(body.input as string) as Record<string, unknown>;
		expect(envelope).toMatchObject({
			schemaVersion: "graphrefly.private-solution-eval.openrouter-user-envelope.v2",
			turn: {
				stepIndex: request.stepIndex,
				maxSteps: 4,
				finalStep: false,
			},
			structuredInput: request.structuredInput,
			priorToolResults: [],
		});
		expect(binding.protectionExecutor).toMatchObject({
			protectedNeedleCapabilityRef: request.credentialBindingRef,
			protectedNeedleCapabilityRevision: request.credentialBindingRevision,
		});
		serializedWithoutCredential({ binding, outcome, body });
	});

	it("derives the exact GLM 5.2 high request and DeepInfra route from frozen D673/D674 coordinates", async () => {
		const authority = buildGlmAuthority();
		const route = glmRouteQualification(authority);
		const response = responseBytes({
			id: "chatcmpl_glm_placeholder_01",
			object: "chat.completion",
			model: OPENROUTER_GLM_5_2_REQUEST_MODEL,
			choices: [
				{
					index: 0,
					finish_reason: "stop",
					message: {
						role: "assistant",
						content: JSON.stringify({
							kind: "model-turn-output-placeholder",
							summary: "bounded-glm-placeholder",
						}),
					},
				},
			],
			usage: {
				prompt_tokens: 100,
				completion_tokens: 20,
				completion_tokens_details: { reasoning_tokens: 12 },
				total_tokens: 120,
				cost: 0.000_085,
			},
			openrouter_metadata: {
				requested: OPENROUTER_GLM_5_2_REQUEST_MODEL,
				strategy: "direct",
				attempt: 1,
				is_byok: false,
				endpoints: {
					total: 1,
					available: [
						{
							provider: OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME,
							model: `${OPENROUTER_GLM_5_2_REQUEST_MODEL}-20260616`,
							selected: true,
						},
					],
				},
				attempts: [
					{
						provider: OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME,
						model: `${OPENROUTER_GLM_5_2_REQUEST_MODEL}-20260616`,
						status: 200,
					},
				],
				pipeline: [],
			},
		});
		const { binding, request, transport } = createHarness(authority, response, bearerToken, route);

		const outcome = await binding.modelTurnPort.invoke(request, new AbortController().signal);

		expect(outcome).toMatchObject({
			status: "non-evaluable",
			finishReason: null,
			structuredOutput: null,
			toolIntents: [],
			usage: {
				inputTokens: 100,
				outputTokens: 20,
				totalTokens: 120,
				requests: 1,
				providerCostMicrousd: 85,
			},
			issueCodes: [
				OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
				OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.nonFinalDirectOutput,
			],
		});
		expect(transport).toHaveBeenCalledTimes(1);
		const sent = transport.mock.calls[0]?.[0] as OpenRouterResponsesTransportRequestV1;
		const body = strictJsonCodec.decode(sent.body) as Record<string, unknown>;
		expect(body).toMatchObject({
			model: OPENROUTER_GLM_5_2_REQUEST_MODEL,
			provider: {
				order: [OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_SLUG],
				only: [OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_SLUG],
				allow_fallbacks: false,
				require_parameters: true,
			},
			messages: [{ role: "system" }, { role: "user" }],
			max_tokens: request.remainingTurnBudget.maxOutputTokens,
			reasoning: { effort: "high" },
			tool_choice: "required",
		});
		expect(body).not.toHaveProperty("response_format");
		const messages = body.messages as readonly {
			readonly role: string;
			readonly content: string;
		}[];
		expect(messages[0]?.content).toContain(
			"When turn.finalStep is false, call one or more declared function tools for distinct actions and do not return the final response",
		);
		expect(messages[0]?.content).toContain(
			"Never repeat a semantically equivalent tool call when its result is already present in priorToolResults",
		);
		expect(messages[0]?.content).toContain(
			"The host executes tool calls serially and returns every result in a later turn",
		);
		expect(messages[0]?.content).toContain(
			"When turn.finalStep is true, do not call a tool; return the final response",
		);
		expect(sent.endpoint).toBe(OPENROUTER_CHAT_COMPLETIONS_ENDPOINT);
		expect(body).not.toHaveProperty("instructions");
		expect(body).not.toHaveProperty("input");
		expect(body).not.toHaveProperty("text");
		expect(body).not.toHaveProperty("max_output_tokens");
		expect(body).not.toHaveProperty("store");
		expect(body).not.toHaveProperty("background");
		expect(body).not.toHaveProperty("truncation");
		expect(body).not.toHaveProperty("service_tier");
		expect(body).not.toHaveProperty("parallel_tool_calls");
		expect(body).not.toHaveProperty("models");
		expect(body).not.toHaveProperty("plugins");
		expect(body).not.toHaveProperty("transforms");
		serializedWithoutCredential({ body, outcome, route });

		const laterHarness = createHarness(authority, response, bearerToken, route);
		const laterRequest = validateEmpiricalModelTurnRequest(
			{
				...withPriorToolResult(laterHarness.request, authority, laterHarness.binding),
				requestRef: "glm-required-choice-after-tool-result",
				stepIndex: 1,
			},
			authority.frozen,
			authority.qualificationReport,
		);
		const laterOutcome = await laterHarness.binding.modelTurnPort.invoke(
			laterRequest,
			new AbortController().signal,
		);
		expect(laterOutcome.issueCodes).toEqual([
			OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
			OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.nonFinalDirectOutput,
		]);
		const laterSent = laterHarness.transport.mock
			.calls[0]?.[0] as OpenRouterResponsesTransportRequestV1;
		expect(strictJsonCodec.decode(laterSent.body)).toMatchObject({ tool_choice: "required" });
	});

	it("treats GLM reasoning tokens as bounded auxiliary metadata independent of completion usage", async () => {
		const authority = buildGlmAuthority();
		const route = glmRouteQualification(authority);
		const response = responseBytes({
			id: "chatcmpl_glm_usage_placeholder_01",
			object: "chat.completion",
			model: OPENROUTER_GLM_5_2_REQUEST_MODEL,
			choices: [
				{
					index: 0,
					finish_reason: "stop",
					message: {
						role: "assistant",
						content: JSON.stringify({
							kind: "model-turn-output-placeholder",
							summary: "bounded-glm-placeholder",
						}),
					},
				},
			],
			usage: {
				prompt_tokens: 2,
				completion_tokens: 4,
				completion_tokens_details: { reasoning_tokens: 5 },
				total_tokens: 6,
				cost: 0.000_006,
			},
			openrouter_metadata: {
				requested: OPENROUTER_GLM_5_2_REQUEST_MODEL,
				strategy: "direct",
				attempt: 1,
				is_byok: false,
				endpoints: {
					total: 1,
					available: [
						{
							provider: OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME,
							model: `${OPENROUTER_GLM_5_2_REQUEST_MODEL}-20260616`,
							selected: true,
						},
					],
				},
				attempts: [
					{
						provider: OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME,
						model: `${OPENROUTER_GLM_5_2_REQUEST_MODEL}-20260616`,
						status: 200,
					},
				],
				pipeline: [],
			},
		});
		const harness = createHarness(authority, response, bearerToken, route);

		const outcome = await harness.binding.modelTurnPort.invoke(
			harness.request,
			new AbortController().signal,
		);

		expect(outcome).toMatchObject({
			status: "non-evaluable",
			usage: {
				inputTokens: 2,
				outputTokens: 4,
				totalTokens: 6,
				requests: 1,
				providerCostMicrousd: 6,
			},
			issueCodes: [
				OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
				OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.nonFinalDirectOutput,
			],
		});
		expect(harness.transport).toHaveBeenCalledTimes(1);
		serializedWithoutCredential({ outcome, route });
	});

	it("emits bounded allowlisted Chat usage subtypes while retaining validated partial accounting", async () => {
		const authority = buildGlmAuthority();
		const route = glmRouteQualification(authority);
		const fixtures = [
			{
				usage: null,
				diagnostic: OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.usageEnvelopeInvalid,
				expectedUsage: {
					inputTokens: null,
					outputTokens: null,
					totalTokens: null,
					providerCostMicrousd: null,
				},
			},
			{
				usage: {
					prompt_tokens: "invalid",
					completion_tokens: 4,
					total_tokens: 6,
					cost: 0.000_006,
				},
				diagnostic: OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.usagePromptTokensInvalid,
				expectedUsage: {
					inputTokens: null,
					outputTokens: null,
					totalTokens: null,
					providerCostMicrousd: null,
				},
			},
			{
				usage: {
					prompt_tokens: 2,
					completion_tokens: "invalid",
					total_tokens: 6,
					cost: 0.000_006,
				},
				diagnostic: OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.usageCompletionTokensInvalid,
				expectedUsage: {
					inputTokens: 2,
					outputTokens: null,
					totalTokens: null,
					providerCostMicrousd: null,
				},
			},
			{
				usage: {
					prompt_tokens: 2,
					completion_tokens: 4,
					total_tokens: "invalid",
					cost: 0.000_006,
				},
				diagnostic: OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.usageTotalTokensInvalid,
				expectedUsage: {
					inputTokens: 2,
					outputTokens: 4,
					totalTokens: null,
					providerCostMicrousd: null,
				},
			},
			{
				usage: {
					prompt_tokens: 2,
					completion_tokens: 4,
					total_tokens: 6,
					cost: "invalid",
				},
				diagnostic: OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.usageCostInvalid,
				expectedUsage: {
					inputTokens: 2,
					outputTokens: 4,
					totalTokens: 6,
					providerCostMicrousd: null,
				},
			},
			{
				usage: {
					prompt_tokens: 2,
					completion_tokens: 4,
					total_tokens: 7,
					cost: 0.000_006,
				},
				diagnostic: OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.usageTotalTokensMismatch,
				expectedUsage: {
					inputTokens: 2,
					outputTokens: 4,
					totalTokens: 7,
					providerCostMicrousd: 6,
				},
			},
			{
				usage: {
					prompt_tokens: 2,
					completion_tokens: 4,
					total_tokens: 6,
					cost: 0.000_006,
					completion_tokens_details: "invalid",
				},
				diagnostic: OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.usageReasoningDetailsInvalid,
				expectedUsage: {
					inputTokens: 2,
					outputTokens: 4,
					totalTokens: 6,
					providerCostMicrousd: 6,
				},
			},
			{
				usage: {
					prompt_tokens: 2,
					completion_tokens: 4,
					total_tokens: 6,
					cost: 0.000_006,
					completion_tokens_details: { reasoning_tokens: "invalid" },
				},
				diagnostic: OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.usageReasoningTokensInvalid,
				expectedUsage: {
					inputTokens: 2,
					outputTokens: 4,
					totalTokens: 6,
					providerCostMicrousd: 6,
				},
			},
		] as const;

		for (const [index, fixture] of fixtures.entries()) {
			const response = responseBytes({
				id: `chatcmpl_glm_usage_failure_placeholder_${index}`,
				object: "chat.completion",
				model: OPENROUTER_GLM_5_2_REQUEST_MODEL,
				choices: [],
				usage: fixture.usage,
				openrouter_metadata: glmDirectRouteMetadata(),
			});
			const harness = createHarness(authority, response, bearerToken, route);

			const outcome = await harness.binding.modelTurnPort.invoke(
				harness.request,
				new AbortController().signal,
			);

			expect(outcome).toMatchObject({
				status: "non-evaluable",
				usage: { ...fixture.expectedUsage, requests: 1 },
				issueCodes: [
					OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
					OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.usageInvalid,
					fixture.diagnostic,
				],
			});
			expect(harness.transport).toHaveBeenCalledTimes(1);
			serializedWithoutCredential({ outcome, route });
		}
	});

	it("maps one GLM Chat tool call and emits only bounded diagnostics for rejected calls", async () => {
		const authority = buildGlmAuthority();
		const route = glmRouteQualification(authority);
		const request = buildEmpiricalModelTurnRequestFixture(authority);
		const toolRef = request.availableTools[0]?.toolRef;
		if (toolRef === undefined) throw new TypeError("GLM tool fixture requires one tool");
		const toolCall = {
			id: "call_glm_placeholder_01",
			type: "function",
			function: {
				name: toolRef,
				arguments: JSON.stringify({
					commandRef: "command-placeholder",
					args: [],
				}),
			},
		};
		const response = responseBytes({
			id: "chatcmpl_glm_tool_placeholder_01",
			object: "chat.completion",
			model: OPENROUTER_GLM_5_2_REQUEST_MODEL,
			choices: [
				{
					index: 0,
					finish_reason: "tool_calls",
					message: {
						role: "assistant",
						content: null,
						tool_calls: [toolCall],
					},
				},
			],
			usage: {
				prompt_tokens: 120,
				completion_tokens: 24,
				total_tokens: 144,
				cost: 0.000_102,
			},
			openrouter_metadata: {
				requested: OPENROUTER_GLM_5_2_REQUEST_MODEL,
				strategy: "direct",
				attempt: 1,
				is_byok: false,
				endpoints: {
					total: 1,
					available: [
						{
							provider: OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME,
							model: `${OPENROUTER_GLM_5_2_REQUEST_MODEL}-20260616`,
							selected: true,
						},
					],
				},
				attempts: [
					{
						provider: OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME,
						model: `${OPENROUTER_GLM_5_2_REQUEST_MODEL}-20260616`,
						status: 200,
					},
				],
				pipeline: [],
			},
		});
		const harness = createHarness(authority, response, bearerToken, route);

		const outcome = await harness.binding.modelTurnPort.invoke(
			harness.request,
			new AbortController().signal,
		);

		expect(outcome).toMatchObject({
			status: "completed",
			finishReason: "tool-intents",
			structuredOutput: null,
			toolIntents: [
				{
					toolCallRef: "call_glm_placeholder_01",
					toolRef,
					arguments: {
						commandRef: "command-placeholder",
						args: [],
					},
				},
			],
			usage: {
				inputTokens: 120,
				outputTokens: 24,
				totalTokens: 144,
				providerCostMicrousd: 102,
				requests: 1,
			},
			issueCodes: [],
		});
		const sent = harness.transport.mock.calls[0]?.[0] as OpenRouterResponsesTransportRequestV1;
		const body = strictJsonCodec.decode(sent.body) as Record<string, unknown>;
		expect(body.tools).toEqual([
			{
				type: "function",
				function: expect.objectContaining({
					name: toolRef,
					strict: true,
					parameters: expect.any(Object),
				}),
			},
		]);
		expect(body).not.toHaveProperty("parallel_tool_calls");
		serializedWithoutCredential({ body, outcome, route });

		const duplicateResponse = JSON.parse(new TextDecoder().decode(response)) as Record<
			string,
			unknown
		>;
		const multipleToolHarness = createHarness(
			authority,
			responseBytes({
				...duplicateResponse,
				id: "chatcmpl_glm_multiple_tools_placeholder_01",
				choices: [
					{
						index: 0,
						finish_reason: "tool_calls",
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								toolCall,
								{
									...toolCall,
									id: "call_glm_placeholder_02",
								},
							],
						},
					},
				],
			}),
			bearerToken,
			route,
		);
		const multipleToolOutcome = await multipleToolHarness.binding.modelTurnPort.invoke(
			multipleToolHarness.request,
			new AbortController().signal,
		);
		expect(multipleToolOutcome).toMatchObject({
			status: "completed",
			finishReason: "tool-intents",
			structuredOutput: null,
			toolIntents: [
				expect.objectContaining({ toolCallRef: "call_glm_placeholder_01", toolRef }),
				expect.objectContaining({ toolCallRef: "call_glm_placeholder_02", toolRef }),
			],
			usage: {
				inputTokens: 120,
				outputTokens: 24,
				totalTokens: 144,
				providerCostMicrousd: 102,
				requests: 1,
			},
			issueCodes: [],
		});
		expect(multipleToolHarness.transport).toHaveBeenCalledTimes(1);

		const boundedToolCalls = Array.from({ length: 64 }, (_, index) => ({
			...toolCall,
			id: `call_glm_boundary_${String(index).padStart(2, "0")}`,
		}));
		const boundaryHarness = (count: 64 | 65) =>
			createHarness(
				authority,
				responseBytes({
					...duplicateResponse,
					id: `chatcmpl_glm_${count}_tools_placeholder_01`,
					choices: [
						{
							index: 0,
							finish_reason: "tool_calls",
							message: {
								role: "assistant",
								content: null,
								tool_calls:
									count === 64
										? boundedToolCalls
										: [...boundedToolCalls, { ...toolCall, id: "call_glm_boundary_64" }],
							},
						},
					],
				}),
				bearerToken,
				route,
			);
		const maximumHarness = boundaryHarness(64);
		const maximumOutcome = await maximumHarness.binding.modelTurnPort.invoke(
			maximumHarness.request,
			new AbortController().signal,
		);
		expect(maximumOutcome).toMatchObject({
			status: "completed",
			finishReason: "tool-intents",
			toolIntents: expect.arrayContaining([
				expect.objectContaining({ toolCallRef: "call_glm_boundary_00" }),
				expect.objectContaining({ toolCallRef: "call_glm_boundary_63" }),
			]),
			issueCodes: [],
		});
		expect(maximumOutcome.toolIntents).toHaveLength(64);
		expect(maximumHarness.transport).toHaveBeenCalledTimes(1);

		const overflowHarness = boundaryHarness(65);
		const overflowOutcome = await overflowHarness.binding.modelTurnPort.invoke(
			overflowHarness.request,
			new AbortController().signal,
		);
		expect(overflowOutcome).toMatchObject({
			status: "non-evaluable",
			toolIntents: [],
			issueCodes: [
				OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
				OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.postParseValidationFailed,
				OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.outcomeValidationFailed,
			],
		});
		expect(overflowHarness.transport).toHaveBeenCalledTimes(1);

		const duplicateCallHarness = createHarness(
			authority,
			responseBytes({
				...duplicateResponse,
				id: "chatcmpl_glm_duplicate_call_placeholder_01",
				choices: [
					{
						index: 0,
						finish_reason: "tool_calls",
						message: {
							role: "assistant",
							content: null,
							tool_calls: [toolCall, toolCall],
						},
					},
				],
			}),
			bearerToken,
			route,
		);
		const duplicateCallOutcome = await duplicateCallHarness.binding.modelTurnPort.invoke(
			duplicateCallHarness.request,
			new AbortController().signal,
		);
		expect(duplicateCallOutcome).toMatchObject({
			status: "non-evaluable",
			toolIntents: [],
			issueCodes: [
				OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
				OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.postParseValidationFailed,
				OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.outcomeValidationFailed,
			],
		});
		expect(duplicateCallHarness.transport).toHaveBeenCalledTimes(1);

		const outputBudgetHarness = createHarness(authority, response, bearerToken, route);
		const outputBudgetRequest = {
			...outputBudgetHarness.request,
			remainingTurnBudget: {
				...outputBudgetHarness.request.remainingTurnBudget,
				maxOutputBytes: 1,
			},
		};
		const outputBudgetOutcome = await outputBudgetHarness.binding.modelTurnPort.invoke(
			outputBudgetRequest,
			new AbortController().signal,
		);
		expect(outputBudgetOutcome).toMatchObject({
			status: "non-evaluable",
			toolIntents: [],
			usage: { requests: 1, hostOutputBytes: 0 },
			issueCodes: [
				OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
				OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.outputByteBudgetExceeded,
			],
		});
		expect(outputBudgetHarness.transport).toHaveBeenCalledTimes(1);

		const outputTokenBudgetHarness = createHarness(authority, response, bearerToken, route);
		const outputTokenBudgetRequest = {
			...outputTokenBudgetHarness.request,
			remainingTurnBudget: {
				...outputTokenBudgetHarness.request.remainingTurnBudget,
				maxOutputTokens: 1,
			},
		};
		const outputTokenBudgetOutcome = await outputTokenBudgetHarness.binding.modelTurnPort.invoke(
			outputTokenBudgetRequest,
			new AbortController().signal,
		);
		expect(outputTokenBudgetOutcome).toMatchObject({
			status: "non-evaluable",
			toolIntents: [],
			usage: { requests: 1, outputTokens: null },
			issueCodes: [
				OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
				OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.outputTokenBudgetExceeded,
			],
		});
		expect(outputTokenBudgetHarness.transport).toHaveBeenCalledTimes(1);

		const rawDiagnosticSentinel = "raw-provider-diagnostic-must-not-survive";
		const diagnosticCases = [
			{
				id: "zero-tool-calls",
				finishReason: "tool_calls",
				message: { role: "assistant", content: null, tool_calls: [] },
				expected: OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.toolCallCountZero,
			},
			{
				id: "malformed-tool-call",
				finishReason: "tool_calls",
				message: {
					role: "assistant",
					content: null,
					tool_calls: [{ ...toolCall, type: "unsupported" }],
				},
				expected: OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.toolCallMalformed,
			},
			{
				id: "multiple-with-malformed-second-call",
				finishReason: "tool_calls",
				message: {
					role: "assistant",
					content: null,
					tool_calls: [
						toolCall,
						{ ...toolCall, id: "call_glm_placeholder_02", type: "unsupported" },
					],
				},
				expected: OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.toolCallMalformed,
			},
			{
				id: "unknown-tool-name",
				finishReason: "tool_calls",
				message: {
					role: "assistant",
					content: null,
					tool_calls: [
						{
							...toolCall,
							function: { ...toolCall.function, name: rawDiagnosticSentinel },
						},
					],
				},
				expected: OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.toolNameUnknown,
			},
			{
				id: "invalid-tool-call-id",
				finishReason: "tool_calls",
				message: {
					role: "assistant",
					content: null,
					tool_calls: [{ ...toolCall, id: "invalid tool call id" }],
				},
				expected: OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.toolCallIdInvalid,
			},
			{
				id: "invalid-tool-arguments",
				finishReason: "tool_calls",
				message: {
					role: "assistant",
					content: null,
					tool_calls: [
						{
							...toolCall,
							function: {
								...toolCall.function,
								arguments: `{"sentinel":"${rawDiagnosticSentinel}"`,
							},
						},
					],
				},
				expected: OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.toolArgumentsInvalid,
			},
			{
				id: "invalid-finish-reason",
				finishReason: "length",
				message: { role: "assistant", content: null, tool_calls: [toolCall] },
				expected: OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.finishReasonInvalid,
			},
			{
				id: "finish-content-conflict",
				finishReason: "tool_calls",
				message: { role: "assistant", content: rawDiagnosticSentinel, tool_calls: [toolCall] },
				expected: OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.finishContentConflict,
			},
		] as const;
		for (const diagnosticCase of diagnosticCases) {
			const diagnosticHarness = createHarness(
				authority,
				responseBytes({
					...duplicateResponse,
					id: `chatcmpl_glm_${diagnosticCase.id}_placeholder`,
					choices: [
						{
							index: 0,
							finish_reason: diagnosticCase.finishReason,
							message: diagnosticCase.message,
						},
					],
				}),
				bearerToken,
				route,
			);
			const diagnosticOutcome = await diagnosticHarness.binding.modelTurnPort.invoke(
				diagnosticHarness.request,
				new AbortController().signal,
			);
			expect(diagnosticOutcome).toMatchObject({
				status: "non-evaluable",
				finishReason: null,
				structuredOutput: null,
				toolIntents: [],
				usage: {
					inputTokens: 120,
					outputTokens: 24,
					totalTokens: 144,
					providerCostMicrousd: 102,
					requests: 1,
				},
				issueCodes: [OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse, diagnosticCase.expected],
			});
			expect(diagnosticHarness.transport).toHaveBeenCalledTimes(1);
			expect(JSON.stringify(diagnosticOutcome)).not.toContain(rawDiagnosticSentinel);
		}
	}, 15_000);

	it("maps the frozen DeepSeek V4 Flash high route through the existing Chat binding", async () => {
		const authority = buildDeepSeekAuthority();
		const route = deepSeekRouteQualification(authority);
		const request = buildEmpiricalModelTurnRequestFixture(authority);
		const toolRef = request.availableTools[0]?.toolRef;
		if (toolRef === undefined) throw new TypeError("DeepSeek tool fixture requires one tool");
		const auxiliaryContent = "bounded DeepSeek tool-call preface";
		const harness = createHarness(
			authority,
			responseBytes({
				id: "chatcmpl_deepseek_tool_placeholder_01",
				object: "chat.completion",
				model: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
				choices: [
					{
						index: 0,
						finish_reason: "tool_calls",
						message: {
							role: "assistant",
							content: auxiliaryContent,
							tool_calls: [
								{
									id: "call_deepseek_placeholder_01",
									type: "function",
									function: {
										name: toolRef,
										arguments: JSON.stringify({
											commandRef: "command-placeholder",
											args: [],
										}),
									},
								},
							],
						},
					},
				],
				usage: {
					prompt_tokens: 120,
					completion_tokens: 24,
					total_tokens: 144,
					cost: 0.000_015_12,
				},
				openrouter_metadata: {
					requested: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
					strategy: "direct",
					attempt: 1,
					is_byok: false,
					endpoints: {
						total: 11,
						available: [
							{
								provider: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
								model: OPENROUTER_DEEPSEEK_V4_FLASH_SELECTED_MODEL,
								selected: true,
							},
						],
					},
					region: "SJC",
					summary: "available=1, selected=DeepInfra",
				},
			}),
			bearerToken,
			route,
		);

		const outcome = await harness.binding.modelTurnPort.invoke(
			harness.request,
			new AbortController().signal,
		);

		expect(outcome).toMatchObject({
			status: "completed",
			finishReason: "tool-intents",
			toolIntents: [
				expect.objectContaining({ toolCallRef: "call_deepseek_placeholder_01", toolRef }),
			],
			usage: {
				inputTokens: 120,
				outputTokens: 24,
				totalTokens: 144,
				providerCostMicrousd: 16,
				requests: 1,
			},
			issueCodes: [],
		});
		const sent = harness.transport.mock.calls[0]?.[0] as OpenRouterResponsesTransportRequestV1;
		const body = strictJsonCodec.decode(sent.body) as Record<string, unknown>;
		expect(body).toMatchObject({
			model: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
			provider: {
				order: [OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG],
				only: [OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG],
				allow_fallbacks: false,
				require_parameters: true,
			},
			reasoning: { effort: "high" },
			tool_choice: "required",
		});
		expect(body).not.toHaveProperty("response_format");
		expect(body).not.toHaveProperty("parallel_tool_calls");
		expect(JSON.stringify(outcome)).not.toContain(auxiliaryContent);
		serializedWithoutCredential({ body, outcome, route });
	});

	it("protects and bounds discarded DeepSeek tool-call auxiliary content", async () => {
		const authority = buildDeepSeekAuthority();
		const route = deepSeekRouteQualification(authority);
		const request = buildEmpiricalModelTurnRequestFixture(authority);
		const toolRef = request.availableTools[0]?.toolRef;
		if (toolRef === undefined) throw new TypeError("DeepSeek tool fixture requires one tool");
		const message = (content: unknown) => ({
			role: "assistant",
			content,
			tool_calls: [
				{
					id: "call_deepseek_auxiliary_content_01",
					type: "function",
					function: {
						name: toolRef,
						arguments: JSON.stringify({ commandRef: "command-placeholder", args: [] }),
					},
				},
			],
		});

		const secretHarness = createHarness(
			authority,
			deepSeekChatResponse({
				id: "chatcmpl_deepseek_auxiliary_secret_01",
				finishReason: "tool_calls",
				message: message(`prefix-${bearerToken}-suffix`),
			}),
			bearerToken,
			route,
		);
		const secretOutcome = await secretHarness.binding.modelTurnPort.invoke(
			secretHarness.request,
			new AbortController().signal,
		);
		expect(secretOutcome).toMatchObject({
			status: "non-evaluable",
			issueCodes: [EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.blocked],
			structuredOutput: null,
			toolIntents: [],
			protectionReceipt: { disposition: "blocked" },
		});
		serializedWithoutCredential(secretOutcome);

		for (const [id, content] of [
			["oversized", "x".repeat(32_769)],
			["non-string", [{ type: "text", text: "unsupported" }]],
		] as const) {
			const harness = createHarness(
				authority,
				deepSeekChatResponse({
					id: `chatcmpl_deepseek_auxiliary_${id}_01`,
					finishReason: "tool_calls",
					message: message(content),
				}),
				bearerToken,
				route,
			);
			const outcome = await harness.binding.modelTurnPort.invoke(
				harness.request,
				new AbortController().signal,
			);
			expect(outcome).toMatchObject({
				status: "non-evaluable",
				issueCodes: [
					OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
					OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.messageInvalid,
				],
				structuredOutput: null,
				toolIntents: [],
			});
		}
	});

	it("accepts an early strict DeepSeek completion before the hard turn ceiling", async () => {
		const authority = buildDeepSeekAuthority();
		const route = deepSeekRouteQualification(authority);
		const harness = createHarness(
			authority,
			responseBytes({
				id: "chatcmpl_deepseek_early_final_01",
				object: "chat.completion",
				model: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
				choices: [
					{
						index: 0,
						finish_reason: "stop",
						message: {
							role: "assistant",
							content: JSON.stringify({
								kind: "model-turn-output-placeholder",
								summary: "bounded-deepseek-early-final",
							}),
						},
					},
				],
				usage: { prompt_tokens: 120, completion_tokens: 24, total_tokens: 144, cost: 0.000_015_12 },
				openrouter_metadata: {
					requested: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
					strategy: "direct",
					attempt: 1,
					is_byok: false,
					endpoints: {
						total: 11,
						available: [
							{
								provider: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
								model: OPENROUTER_DEEPSEEK_V4_FLASH_SELECTED_MODEL,
								selected: true,
							},
						],
					},
					region: "SJC",
					summary: "available=1, selected=DeepInfra",
				},
			}),
			bearerToken,
			route,
		);
		const request = validateEmpiricalModelTurnRequest(
			{
				...withPriorToolResult(harness.request, authority, harness.binding),
				requestRef: "deepseek-early-final-after-tool-result",
				stepIndex: 1,
			},
			authority.frozen,
			authority.qualificationReport,
		);

		const outcome = await harness.binding.modelTurnPort.invoke(
			request,
			new AbortController().signal,
		);

		expect(request.stepIndex).toBe(1);
		expect(outcome).toMatchObject({
			status: "completed",
			finishReason: "structured-output",
			structuredOutput: {
				kind: "model-turn-output-placeholder",
				summary: "bounded-deepseek-early-final",
			},
			issueCodes: [],
		});
		const sent = harness.transport.mock.calls[0]?.[0] as OpenRouterResponsesTransportRequestV1;
		expect(strictJsonCodec.decode(sent.body)).toMatchObject({ tool_choice: "auto" });
		expect(strictJsonCodec.decode(sent.body)).toMatchObject({
			response_format: { json_schema: { strict: true } },
		});
	});

	it("keeps DeepSeek early-final JSON and schema diagnostics bounded and distinct", async () => {
		const authority = buildDeepSeekAuthority();
		const route = deepSeekRouteQualification(authority);
		const invoke = async (content: string) => {
			const harness = createHarness(
				authority,
				deepSeekChatResponse({
					id: "chatcmpl_deepseek_invalid_early_final_01",
					finishReason: "stop",
					message: { role: "assistant", content },
				}),
				bearerToken,
				route,
			);
			const request = validateEmpiricalModelTurnRequest(
				{
					...withPriorToolResult(harness.request, authority, harness.binding),
					requestRef: "deepseek-invalid-early-final",
					stepIndex: 1,
				},
				authority.frozen,
				authority.qualificationReport,
			);
			return harness.binding.modelTurnPort.invoke(request, new AbortController().signal);
		};

		const invalidJson = await invoke("not-json");
		expect(invalidJson.issueCodes).toEqual([
			OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
			OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.postParseValidationFailed,
			OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.outputJsonInvalid,
		]);

		const schemaMismatch = await invoke(JSON.stringify({ summary: "missing-kind" }));
		expect(schemaMismatch.issueCodes).toEqual([
			OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
			OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.postParseValidationFailed,
			OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.outcomeValidationFailed,
		]);
	});

	it("requires another exact D682 tool after host progress is not terminal", async () => {
		const authority = buildDeepSeekAuthority(true, true);
		const route = deepSeekRouteQualification(authority);
		const harness = createHarness(
			authority,
			deepSeekChatResponse({
				id: "chatcmpl_deepseek_d682_premature_final_01",
				finishReason: "stop",
				message: {
					role: "assistant",
					content: JSON.stringify({
						kind: "model-turn-output-placeholder",
						summary: "premature-d682-final",
					}),
				},
			}),
			bearerToken,
			route,
		);
		const rebound = rebindInput(harness.request, authority, d682ActorInput());
		const request = validateEmpiricalModelTurnRequest(
			{
				...withPriorToolResultValue(rebound, authority, harness.binding, {
					toolRef: CLOSED_ACTOR_TOOL_REFS.readFile,
					result: strictSnapshot({
						kind: "read-file",
						progress: {
							remainingSteps: 6,
							remainingActions: 7,
							mutationObserved: false,
							diffObserved: false,
							commandObserved: false,
						},
					}),
				}),
				requestRef: "deepseek-d682-premature-final",
				stepIndex: 1,
			},
			authority.frozen,
			authority.qualificationReport,
		);

		const outcome = await harness.binding.modelTurnPort.invoke(
			request,
			new AbortController().signal,
		);

		expect(outcome).toMatchObject({
			status: "non-evaluable",
			issueCodes: [
				OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
				OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.nonFinalDirectOutput,
			],
		});
		const sent = harness.transport.mock.calls[0]?.[0] as OpenRouterResponsesTransportRequestV1;
		const body = strictJsonCodec.decode(sent.body);
		expect(body).toMatchObject({ tool_choice: "required" });
		expect(body).not.toHaveProperty("response_format");
	});

	it("mechanically closes exact D682 tools after host-derived terminal progress", async () => {
		const authority = buildDeepSeekAuthority(true, true);
		const route = deepSeekRouteQualification(authority);
		const harness = createHarness(
			authority,
			deepSeekChatResponse({
				id: "chatcmpl_deepseek_d682_terminal_final_01",
				finishReason: "stop",
				message: {
					role: "assistant",
					content: JSON.stringify({
						kind: "model-turn-output-placeholder",
						summary: "bounded-d682-terminal-final",
					}),
				},
			}),
			bearerToken,
			route,
		);
		const rebound = rebindInput(harness.request, authority, d682ActorInput());
		const request = validateEmpiricalModelTurnRequest(
			{
				...withPriorToolResultValue(rebound, authority, harness.binding, {
					toolRef: CLOSED_ACTOR_TOOL_REFS.runCommand,
					result: strictSnapshot({
						kind: "run-command",
						progress: {
							remainingSteps: 4,
							remainingActions: 12,
							mutationObserved: true,
							diffObserved: true,
							commandObserved: true,
						},
					}),
				}),
				requestRef: "deepseek-d682-terminal-final",
				stepIndex: 2,
			},
			authority.frozen,
			authority.qualificationReport,
		);

		const outcome = await harness.binding.modelTurnPort.invoke(
			request,
			new AbortController().signal,
		);

		expect(outcome).toMatchObject({ status: "completed", finishReason: "structured-output" });
		const sent = harness.transport.mock.calls[0]?.[0] as OpenRouterResponsesTransportRequestV1;
		expect(strictJsonCodec.decode(sent.body)).toMatchObject({
			tool_choice: "none",
			response_format: { json_schema: { strict: true } },
		});
	});

	it("rejects a tool call after exact D682 host-derived terminal progress", async () => {
		const authority = buildDeepSeekAuthority(true, true);
		const route = deepSeekRouteQualification(authority);
		const harness = createHarness(
			authority,
			deepSeekChatResponse({
				id: "chatcmpl_deepseek_d682_terminal_tool_01",
				finishReason: "tool_calls",
				message: {
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call_deepseek_d682_terminal_tool_01",
							type: "function",
							function: {
								name: "workspace_read_file",
								arguments: JSON.stringify({ path: "README.md" }),
							},
						},
					],
				},
			}),
			bearerToken,
			route,
		);
		const rebound = rebindInput(harness.request, authority, d682ActorInput());
		const request = validateEmpiricalModelTurnRequest(
			{
				...withPriorToolResultValue(rebound, authority, harness.binding, {
					toolRef: CLOSED_ACTOR_TOOL_REFS.runCommand,
					result: strictSnapshot({
						kind: "run-command",
						progress: {
							remainingSteps: 4,
							remainingActions: 12,
							mutationObserved: true,
							diffObserved: true,
							commandObserved: true,
						},
					}),
				}),
				requestRef: "deepseek-d682-terminal-tool",
				stepIndex: 2,
			},
			authority.frozen,
			authority.qualificationReport,
		);

		const outcome = await harness.binding.modelTurnPort.invoke(
			request,
			new AbortController().signal,
		);

		expect(outcome).toMatchObject({
			status: "non-evaluable",
			issueCodes: [
				OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
				OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.terminalReadyToolCall,
			],
		});
	});

	it("does not close tools for a non-D682 progress-shaped result", async () => {
		const authority = buildDeepSeekAuthority();
		const route = deepSeekRouteQualification(authority);
		const harness = createHarness(authority, undefined, bearerToken, route);
		const toolRef = harness.request.availableTools[0]?.toolRef;
		if (toolRef === undefined) throw new TypeError("DeepSeek progress fixture requires one tool");
		const request = validateEmpiricalModelTurnRequest(
			{
				...withPriorToolResultValue(harness.request, authority, harness.binding, {
					toolRef,
					result: strictSnapshot({
						progress: {
							remainingSteps: 1,
							remainingActions: 1,
							mutationObserved: true,
							diffObserved: true,
							commandObserved: true,
						},
					}),
				}),
				requestRef: "deepseek-non-d682-progress-shaped",
				stepIndex: 1,
			},
			authority.frozen,
			authority.qualificationReport,
		);

		await harness.binding.modelTurnPort.invoke(request, new AbortController().signal);

		const sent = harness.transport.mock.calls[0]?.[0] as OpenRouterResponsesTransportRequestV1;
		expect(strictJsonCodec.decode(sent.body)).toMatchObject({ tool_choice: "auto" });
	});

	it("rejects a direct DeepSeek completion before any tool result", async () => {
		const authority = buildDeepSeekAuthority();
		const route = deepSeekRouteQualification(authority);
		const harness = createHarness(
			authority,
			deepSeekChatResponse({
				id: "chatcmpl_deepseek_initial_direct_01",
				finishReason: "stop",
				message: {
					role: "assistant",
					content: JSON.stringify({
						kind: "model-turn-output-placeholder",
						summary: "invalid-initial-direct-output",
					}),
				},
			}),
			bearerToken,
			route,
		);

		const outcome = await harness.binding.modelTurnPort.invoke(
			harness.request,
			new AbortController().signal,
		);

		expect(outcome.issueCodes).toEqual([
			OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
			OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.nonFinalDirectOutput,
		]);
		const sent = harness.transport.mock.calls[0]?.[0] as OpenRouterResponsesTransportRequestV1;
		expect(strictJsonCodec.decode(sent.body)).toMatchObject({ tool_choice: "required" });
	});

	it("sends none and rejects a DeepSeek tool call on the hard-final turn", async () => {
		const authority = buildDeepSeekAuthority();
		const route = deepSeekRouteQualification(authority);
		const toolRef = authority.manifest.schemaCatalog.tools[0]?.toolRef;
		const configurationMaxSteps =
			authority.manifest.modelConfigurations[0]?.settings.tools.maxSteps;
		if (toolRef === undefined || configurationMaxSteps === undefined) {
			throw new TypeError("DeepSeek hard-final fixture requires a tool and maxSteps");
		}
		const maxSteps = Math.min(
			configurationMaxSteps,
			authority.manifest.budgets.agentRun.maxSteps,
			authority.manifest.budgets.agentRun.maxRequests,
			route.budget.maxStepsPerRun,
			route.budget.maxRequests,
			256,
		);
		const harness = createHarness(
			authority,
			deepSeekChatResponse({
				id: "chatcmpl_deepseek_hard_final_tool_01",
				finishReason: "tool_calls",
				message: {
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call_deepseek_hard_final_01",
							type: "function",
							function: { name: toolRef, arguments: "{}" },
						},
					],
				},
			}),
			bearerToken,
			route,
		);
		const request = validateEmpiricalModelTurnRequest(
			{
				...harness.request,
				requestRef: "deepseek-hard-final-tool-call",
				stepIndex: maxSteps - 1,
			},
			authority.frozen,
			authority.qualificationReport,
		);

		const outcome = await harness.binding.modelTurnPort.invoke(
			request,
			new AbortController().signal,
		);

		expect(outcome.issueCodes).toEqual([
			OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
			OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.finalToolCall,
		]);
		const sent = harness.transport.mock.calls[0]?.[0] as OpenRouterResponsesTransportRequestV1;
		expect(strictJsonCodec.decode(sent.body)).toMatchObject({
			tool_choice: "none",
			response_format: { json_schema: { strict: true } },
		});
	});

	it("lowers every closed D659 tool to a semantic Chat name and description", async () => {
		const authority = buildDeepSeekAuthority(true);
		const route = deepSeekRouteQualification(authority);
		const harness = createHarness(authority, undefined, bearerToken, route);
		let replaceProviderName = "";
		harness.transport.mockImplementationOnce((input) => {
			const body = strictJsonCodec.decode(input.body) as {
				readonly tools: readonly {
					readonly function: {
						readonly name: string;
						readonly description: string;
					};
				}[];
			};
			const functions = body.tools.map((tool) => tool.function);
			expect(functions.map((fn) => fn.name)).toEqual([
				"workspace_read_file",
				"workspace_search_literal",
				"workspace_replace_exact",
				"workspace_diff",
				"workspace_run_command_ref",
			]);
			expect(functions.every((fn) => fn.description.length > 20)).toBe(true);
			replaceProviderName = functions[2]?.name ?? "";
			return Promise.resolve({
				status: 200,
				retryAfterMs: null,
				body: responseBytes({
					id: "chatcmpl_deepseek_semantic_tools_01",
					object: "chat.completion",
					model: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
					choices: [
						{
							index: 0,
							finish_reason: "tool_calls",
							message: {
								role: "assistant",
								content: null,
								tool_calls: [
									{
										id: "call_deepseek_replace_01",
										type: "function",
										function: {
											name: replaceProviderName,
											arguments: JSON.stringify({
												baseContentDigest: `sha256:${"0".repeat(64)}`,
												newText: "new",
												oldText: "old",
												path: "packages/ts/src/example.ts",
											}),
										},
									},
								],
							},
						},
					],
					usage: {
						prompt_tokens: 120,
						completion_tokens: 24,
						total_tokens: 144,
						cost: 0.000_015_12,
					},
					openrouter_metadata: {
						requested: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
						strategy: "direct",
						attempt: 1,
						is_byok: false,
						endpoints: {
							total: 11,
							available: [
								{
									provider: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
									model: OPENROUTER_DEEPSEEK_V4_FLASH_SELECTED_MODEL,
									selected: true,
								},
							],
						},
						region: "SJC",
						summary: "available=1, selected=DeepInfra",
					},
				}),
			});
		});

		const outcome = await harness.binding.modelTurnPort.invoke(
			harness.request,
			new AbortController().signal,
		);

		expect(outcome).toMatchObject({
			status: "completed",
			finishReason: "tool-intents",
			toolIntents: [
				{
					toolCallRef: "call_deepseek_replace_01",
					toolRef: CLOSED_ACTOR_TOOL_REFS.replaceExact,
				},
			],
		});
	});

	it("keeps the D682 host-derived mutation description aligned with its exact declared arguments", async () => {
		const authority = buildDeepSeekAuthority(true, true);
		const route = deepSeekRouteQualification(authority);
		const harness = createHarness(authority, undefined, bearerToken, route);
		const request = rebindInput(harness.request, authority, d682ActorInput());
		harness.transport.mockImplementationOnce((input) => {
			const body = strictJsonCodec.decode(input.body) as {
				readonly messages: readonly { readonly role: string; readonly content: string }[];
				readonly tools: readonly {
					readonly function: {
						readonly name: string;
						readonly description: string;
						readonly parameters: {
							readonly properties: Readonly<Record<string, unknown>>;
							readonly required: readonly string[];
						};
					};
				}[];
			};
			const replace = body.tools.find(
				(tool) => tool.function.name === "workspace_replace_exact",
			)?.function;
			const system = body.messages.find((message) => message.role === "system")?.content;
			expect(replace?.parameters.required).toEqual(["newText", "oldText", "path"]);
			expect(replace?.parameters.properties).not.toHaveProperty("baseContentDigest");
			expect(replace?.description).toContain("sealed host binds the current file digest");
			expect(replace?.description).not.toContain("baseContentDigest");
			expect(system).toContain("Use only argument fields declared by each tool schema");
			expect(system).not.toContain("baseContentDigest");
			return Promise.resolve({
				status: 200,
				retryAfterMs: null,
				body: deepSeekChatResponse({
					id: "chatcmpl_deepseek_d682_contract_01",
					finishReason: "tool_calls",
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_deepseek_d682_read_01",
								type: "function",
								function: {
									name: "workspace_read_file",
									arguments: JSON.stringify({ path: "README.md" }),
								},
							},
						],
					},
				}),
			});
		});

		const outcome = await harness.binding.modelTurnPort.invoke(
			request,
			new AbortController().signal,
		);

		expect(outcome).toMatchObject({
			status: "completed",
			finishReason: "tool-intents",
			toolIntents: [{ toolRef: CLOSED_ACTOR_TOOL_REFS.readFile }],
		});
	});

	it("does not grant D682 host-derived semantics to a substituted optional digest schema", async () => {
		const authority = buildDeepSeekAuthority(true, true, true);
		const route = deepSeekRouteQualification(authority);
		const harness = createHarness(authority, undefined, bearerToken, route);
		const request = rebindInput(harness.request, authority, d682ActorInput());
		await expect(
			harness.binding.modelTurnPort.invoke(request, new AbortController().signal),
		).resolves.toMatchObject({
			status: "non-evaluable",
			issueCodes: ["openrouter-request-rejected"],
		});
		expect(harness.transport).not.toHaveBeenCalled();
	});

	it("keeps the D674 multi-intent capability probe to one simulated request and no efficacy evidence", async () => {
		const authority = buildGlmAuthority();
		const route = glmRouteQualification(authority);
		const request = buildEmpiricalModelTurnRequestFixture(authority);
		const toolRef = request.availableTools[0]?.toolRef;
		if (toolRef === undefined) throw new TypeError("GLM capability probe requires one tool");
		const response = responseBytes({
			id: "chatcmpl_glm_probe_placeholder_01",
			object: "chat.completion",
			model: OPENROUTER_GLM_5_2_REQUEST_MODEL,
			choices: [
				{
					index: 0,
					finish_reason: "tool_calls",
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_glm_probe_placeholder_01",
								type: "function",
								function: {
									name: toolRef,
									arguments: JSON.stringify({
										commandRef: "command-placeholder",
										args: [],
									}),
								},
							},
							{
								id: "call_glm_probe_placeholder_02",
								type: "function",
								function: {
									name: toolRef,
									arguments: JSON.stringify({
										commandRef: "command-placeholder",
										args: [],
									}),
								},
							},
						],
					},
				},
			],
			usage: {
				prompt_tokens: 120,
				completion_tokens: 24,
				total_tokens: 144,
				cost: 0.000_102,
			},
			openrouter_metadata: {
				requested: OPENROUTER_GLM_5_2_REQUEST_MODEL,
				strategy: "direct",
				attempt: 1,
				is_byok: false,
				endpoints: {
					total: 1,
					available: [
						{
							provider: OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME,
							model: `${OPENROUTER_GLM_5_2_REQUEST_MODEL}-20260616`,
							selected: true,
						},
					],
				},
				attempts: [
					{
						provider: OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME,
						model: `${OPENROUTER_GLM_5_2_REQUEST_MODEL}-20260616`,
						status: 200,
					},
				],
				pipeline: [],
			},
		});
		const transport = vi.fn<OpenRouterResponsesByteTransportV1["request"]>(() =>
			Promise.resolve({ status: 200, body: response, retryAfterMs: null }),
		);
		let measurementIndex = 0;
		const result = await runOpenRouterFirstTaskCapabilityProbe({
			frozen: authority.frozen,
			qualificationReport: authority.qualificationReport,
			request,
			routeQualification: route,
			credential: {
				credentialBindingRef: authority.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: authority.manifest.policies.actorCredentialBindingRevision,
				bearerToken,
			},
			transport: { request: transport },
			monotonicMeasurement: {
				readMs() {
					measurementIndex += 1;
					return measurementIndex === 1 ? 1_000 : 1_025;
				},
			},
			executionClass: "simulated-contract",
			signal: new AbortController().signal,
		});

		expect(result).toEqual({
			schemaVersion: "graphrefly.private-solution-eval.openrouter-capability-probe.v1",
			capable: true,
			executionClass: "simulated-contract",
			evidenceClass: "mechanical-capability-only",
			efficacyClaim: "none",
			status: "completed",
			finishReason: "tool-intents",
			toolIntentCount: 2,
			requests: 1,
			providerCostMicrousd: 102,
			issueCodes: [],
		});
		expect(transport).toHaveBeenCalledTimes(1);
		serializedWithoutCredential({ result, route });
	});

	it("rejects a non-first, final-step, or pricing-source-substituted D674 probe before transport", async () => {
		const authority = buildGlmAuthority();
		const route = glmRouteQualification(authority);
		const request = buildEmpiricalModelTurnRequestFixture(authority);
		const transport = vi.fn<OpenRouterResponsesByteTransportV1["request"]>(() => {
			throw new Error("transport must not run");
		});
		const baseInput = {
			frozen: authority.frozen,
			qualificationReport: authority.qualificationReport,
			request,
			routeQualification: route,
			credential: {
				credentialBindingRef: authority.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: authority.manifest.policies.actorCredentialBindingRevision,
				bearerToken,
			},
			transport: { request: transport },
			monotonicMeasurement: { readMs: () => 0 },
			executionClass: "simulated-contract" as const,
			signal: new AbortController().signal,
		};
		const secondTaskRef = authority.frozen.manifest.catalog.tasks[1]?.taskRef;
		if (secondTaskRef === undefined) throw new TypeError("missing second D674 fixture task");
		await expect(
			runOpenRouterFirstTaskCapabilityProbe({
				...baseInput,
				request: strictSnapshot({ ...request, taskRef: secondTaskRef }),
			}),
		).rejects.toThrow(/frozen D674 coordinates/);
		await expect(
			runOpenRouterFirstTaskCapabilityProbe({
				...baseInput,
				routeQualification: strictSnapshot({
					...route,
					budget: { ...route.budget, maxRequests: 1, maxStepsPerRun: 1 },
				}),
			}),
		).rejects.toThrow(/frozen D674 coordinates/);
		await expect(
			runOpenRouterFirstTaskCapabilityProbe({
				...baseInput,
				routeQualification: strictSnapshot({
					...route,
					pricing: { ...route.pricing, sourceUrl: "https://example.invalid/pricing" },
				}),
			}),
		).rejects.toThrow(/frozen D674 coordinates/);
		expect(transport).not.toHaveBeenCalled();
	});

	it("cleans a loaded capability-probe workspace when pre-transport validation fails", async () => {
		const cleanup = vi.fn(() => Promise.resolve());
		const operatorInput = {
			privateRoot: "/operator-private/substituted",
			host: { materialization: { cleanup } },
		} as unknown as OpenRouterFirstTaskSmokeOperatorInputV1;
		await expect(
			runLoadedOpenRouterFirstTaskCapabilityProbeOperator({
				operatorInput,
				privateRoot: "/operator-private/expected",
				environment: {},
				fetch: globalThis.fetch,
				monotonicNowMs: () => 0,
			}),
		).rejects.toThrow(/changed private artifact ownership/);
		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	it("cleans a loaded smoke workspace when pre-transport validation fails", async () => {
		const cleanup = vi.fn(() => Promise.resolve());
		const operatorInput = {
			privateRoot: "/operator-private/substituted",
			host: { materialization: { cleanup } },
		} as unknown as OpenRouterFirstTaskSmokeOperatorInputV1;
		await expect(
			runLoadedOpenRouterFirstTaskSmokeOperator({
				operatorInput,
				privateRoot: "/operator-private/expected",
				environment: {},
				fetch: globalThis.fetch,
				monotonicNowMs: () => 0,
			}),
		).rejects.toThrow(/changed private artifact ownership/);
		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	it("cleans exactly once when the smoke execution rejects before or after host cleanup", async () => {
		const preHostCleanup = vi.fn(() => Promise.resolve());
		await expect(
			runWithOpenRouterSmokeInitialMaterializationOwnership({
				cleanup: preHostCleanup,
				execute: async () => {
					throw new TypeError("pre-host rejection");
				},
			}),
		).rejects.toThrow(/pre-host rejection/);
		expect(preHostCleanup).toHaveBeenCalledTimes(1);

		const postHostCleanup = vi.fn(() => Promise.resolve());
		await expect(
			runWithOpenRouterSmokeInitialMaterializationOwnership({
				cleanup: postHostCleanup,
				execute: async (cleanupOnce) => {
					await cleanupOnce();
					throw new TypeError("post-host rejection");
				},
			}),
		).rejects.toThrow(/post-host rejection/);
		expect(postHostCleanup).toHaveBeenCalledTimes(1);

		const throwingCleanup = vi.fn(() => {
			throw new TypeError("synchronous cleanup failure");
		});
		await expect(
			runWithOpenRouterSmokeInitialMaterializationOwnership({
				cleanup: throwingCleanup,
				execute: async (cleanupOnce) => {
					try {
						await cleanupOnce();
					} catch {}
					throw new TypeError("post-host rejection");
				},
			}),
		).rejects.toThrow(/workspace cleanup failed/);
		expect(throwingCleanup).toHaveBeenCalledTimes(1);
	});

	it("lowers the frozen final turn coordinate and requires final structured output", async () => {
		const authority = buildAuthority();
		const baseRoute = routeQualification(authority);
		const route = strictSnapshot({
			...baseRoute,
			budget: {
				...baseRoute.budget,
				maxRequests: 2,
				maxStepsPerRun: 2,
			},
		});
		const harness = createHarness(authority, undefined, bearerToken, route);
		const configurationMaxSteps =
			authority.manifest.modelConfigurations[0]?.settings.tools.maxSteps;
		if (configurationMaxSteps === undefined) throw new TypeError("missing OpenRouter maxSteps");
		const maxSteps = Math.min(
			configurationMaxSteps,
			authority.manifest.budgets.agentRun.maxSteps,
			authority.manifest.budgets.agentRun.maxRequests,
			route.budget.maxStepsPerRun,
			route.budget.maxRequests,
			256,
		);
		const finalRequest = validateEmpiricalModelTurnRequest(
			{
				...harness.request,
				stepIndex: maxSteps - 1,
			},
			authority.frozen,
			authority.qualificationReport,
		);

		await harness.binding.modelTurnPort.invoke(finalRequest, new AbortController().signal);

		expect(harness.transport).toHaveBeenCalledTimes(1);
		const sent = harness.transport.mock.calls[0]?.[0] as OpenRouterResponsesTransportRequestV1;
		const body = strictJsonCodec.decode(sent.body) as Record<string, unknown>;
		const envelope = JSON.parse(body.input as string) as Record<string, unknown>;
		expect(envelope).toMatchObject({
			turn: {
				stepIndex: maxSteps - 1,
				maxSteps,
				finalStep: true,
			},
		});
		expect(body.instructions).toContain(
			"When turn.finalStep is true, do not call a tool; return the final response",
		);
		expect(body.tool_choice).toBe("none");
	});

	it("fails closed before transport outside a stricter qualified route turn limit", async () => {
		const authority = buildAuthority();
		const baseRoute = routeQualification(authority);
		const route = strictSnapshot({
			...baseRoute,
			budget: {
				...baseRoute.budget,
				maxRequests: 2,
				maxStepsPerRun: 2,
			},
		});
		const harness = createHarness(authority, undefined, bearerToken, route);
		const outOfRouteRequest = validateEmpiricalModelTurnRequest(
			{
				...harness.request,
				stepIndex: 2,
			},
			authority.frozen,
			authority.qualificationReport,
		);

		const outcome = await harness.binding.modelTurnPort.invoke(
			outOfRouteRequest,
			new AbortController().signal,
		);

		expect(outcome).toMatchObject({
			status: "non-evaluable",
			usage: { requests: 0 },
			issueCodes: [OPENROUTER_RESPONSES_ISSUE_CODES.rejected],
		});
		expect(harness.admission).not.toHaveBeenCalled();
		expect(harness.transport).not.toHaveBeenCalled();
	});

	it("rejects a provider tool call on the frozen final turn", async () => {
		const authority = buildAuthority();
		const baseRoute = routeQualification(authority);
		const route = strictSnapshot({
			...baseRoute,
			budget: {
				...baseRoute.budget,
				maxRequests: 1,
				maxStepsPerRun: 1,
			},
		});
		const response = completedResponse([
			{
				type: "function_call",
				status: "completed",
				call_id: "call_forbidden_final_placeholder",
				name: "tool-placeholder",
				arguments: JSON.stringify({ commandRef: "command-placeholder", args: [] }),
			},
		]);
		const harness = createHarness(authority, response, bearerToken, route);

		const outcome = await harness.binding.modelTurnPort.invoke(
			harness.request,
			new AbortController().signal,
		);

		expect(outcome).toMatchObject({
			status: "non-evaluable",
			finishReason: null,
			toolIntents: [],
			usage: {
				requests: 1,
				inputTokens: 100,
				outputTokens: 20,
				totalTokens: 120,
				providerCostMicrousd: 1_225,
			},
			issueCodes: [OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse],
		});
		expect(outcome.evidenceRefs).toHaveLength(1);
		expect(outcome.evidenceRefs[0]?.kind).toBe("openrouter-response-summary");
		expect(harness.transport).toHaveBeenCalledTimes(1);
	});

	it("protects forbidden final-turn tool material before sanitizing the outcome", async () => {
		const authority = buildAuthority();
		const baseRoute = routeQualification(authority);
		const route = strictSnapshot({
			...baseRoute,
			budget: {
				...baseRoute.budget,
				maxRequests: 1,
				maxStepsPerRun: 1,
			},
		});
		const response = completedResponse([
			{
				type: "function_call",
				status: "completed",
				call_id: "call_protected_final_placeholder",
				name: "tool-placeholder",
				arguments: JSON.stringify({ commandRef: bearerToken, args: [] }),
			},
		]);
		const harness = createHarness(authority, response, bearerToken, route);

		const outcome = await harness.binding.modelTurnPort.invoke(
			harness.request,
			new AbortController().signal,
		);

		expect(outcome).toMatchObject({
			status: "non-evaluable",
			finishReason: null,
			toolIntents: [],
			usage: { requests: 1, providerCostMicrousd: 1_225 },
			issueCodes: [EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.blocked],
			protectionReceipt: { disposition: "blocked" },
		});
		expect(outcome.evidenceRefs).toEqual([
			{
				kind: EMPIRICAL_MODEL_EGRESS_BLOCKED_SUBJECT_EVIDENCE_KIND,
				id: "model-egress-blocked-subject",
				digest: outcome.protectionReceipt.subjectDigest,
			},
		]);
		serializedWithoutCredential(outcome);
	});

	it("normalizes over-budget usage before rejecting a final-turn tool call", async () => {
		const authority = buildAuthority();
		const baseRoute = routeQualification(authority);
		const route = strictSnapshot({
			...baseRoute,
			budget: {
				...baseRoute.budget,
				maxRequests: 1,
				maxStepsPerRun: 1,
			},
		});
		const response = completedResponse(
			[
				{
					type: "function_call",
					status: "completed",
					call_id: "call_over_budget_final_placeholder",
					name: "tool-placeholder",
					arguments: JSON.stringify({ commandRef: "command-placeholder", args: [] }),
				},
			],
			{
				usage: {
					input_tokens: 100,
					output_tokens: 9_999_999,
					total_tokens: 10_000_099,
					cost: 0.001_225,
				},
			},
		);
		const harness = createHarness(authority, response, bearerToken, route);

		const outcome = await harness.binding.modelTurnPort.invoke(
			harness.request,
			new AbortController().signal,
		);

		expect(outcome).toMatchObject({
			status: "non-evaluable",
			usage: {
				requests: 1,
				inputTokens: 100,
				outputTokens: null,
				totalTokens: 10_000_099,
				providerCostMicrousd: 1_225,
			},
			issueCodes: [OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse],
		});
		expect(outcome.evidenceRefs).toHaveLength(1);
	});

	it("fails closed before transport when the actual wire body is not admitted", async () => {
		const harness = createHarness();
		harness.admission.mockReturnValue(false);
		const outcome = await harness.binding.modelTurnPort.invoke(
			harness.request,
			new AbortController().signal,
		);
		expect(outcome.issueCodes).toEqual([
			OPENROUTER_RESPONSES_ISSUE_CODES.transportAdmissionRejected,
		]);
		expect(outcome.usage.requests).toBe(0);
		expect(harness.admission.mock.calls[0]?.[0].wireRequestBytes).not.toBe(
			strictJsonCodec.encode(harness.request).byteLength,
		);
		expect(harness.transport).not.toHaveBeenCalled();

		const truthyHarness = createHarness();
		truthyHarness.admission.mockReturnValue("yes" as never);
		const truthyOutcome = await truthyHarness.binding.modelTurnPort.invoke(
			truthyHarness.request,
			new AbortController().signal,
		);
		expect(truthyOutcome.issueCodes).toEqual([
			OPENROUTER_RESPONSES_ISSUE_CODES.transportAdmissionRejected,
		]);
		expect(truthyOutcome.usage.requests).toBe(0);
		expect(truthyHarness.transport).not.toHaveBeenCalled();
	});

	it("requires direct shared-capacity OpenAI routing evidence without fallback or pipeline stages", async () => {
		const metadataWithOptionalAttempts = directRouteMetadata();
		delete metadataWithOptionalAttempts.attempts;
		const optionalAttemptsResponse = completedResponse(
			messageOutput({
				kind: "model-turn-output-placeholder",
				summary: "bounded-placeholder",
			}),
			{ openrouter_metadata: metadataWithOptionalAttempts },
		);
		const optionalAttemptsHarness = createHarness(buildAuthority(), optionalAttemptsResponse);
		await expect(
			optionalAttemptsHarness.binding.modelTurnPort.invoke(
				optionalAttemptsHarness.request,
				new AbortController().signal,
			),
		).resolves.toMatchObject({ status: "completed", issueCodes: [] });

		const mismatches = [
			{ openrouter_metadata: undefined },
			{ openrouter_metadata: directRouteMetadata({ requested: "openai/other-model" }) },
			{ openrouter_metadata: directRouteMetadata({ strategy: "fallback" }) },
			{ openrouter_metadata: directRouteMetadata({ attempt: 2 }) },
			{ openrouter_metadata: directRouteMetadata({ is_byok: true }) },
			{ openrouter_metadata: directRouteMetadata({ fallback_used: true }) },
			{
				openrouter_metadata: directRouteMetadata({
					endpoints: {
						total: 2,
						available: [
							{
								provider: OPENROUTER_RESPONSES_DOWNSTREAM_PROVIDER,
								model: OPENROUTER_RESPONSES_CANONICAL_MODEL,
								selected: true,
							},
							{
								provider: OPENROUTER_RESPONSES_DOWNSTREAM_PROVIDER,
								model: OPENROUTER_RESPONSES_CANONICAL_MODEL,
								selected: true,
							},
						],
					},
				}),
			},
			{
				openrouter_metadata: directRouteMetadata({
					endpoints: {
						total: 1,
						available: [
							{
								provider: "DifferentProvider",
								model: OPENROUTER_RESPONSES_MODEL,
								selected: true,
							},
						],
					},
				}),
			},
			{
				openrouter_metadata: directRouteMetadata({
					endpoints: {
						total: 3,
						available: [
							{
								provider: OPENROUTER_RESPONSES_DOWNSTREAM_PROVIDER,
								model: `${OPENROUTER_RESPONSES_MODEL}-other`,
								selected: true,
							},
						],
					},
				}),
			},
			{
				openrouter_metadata: directRouteMetadata({
					attempts: [
						{
							provider: OPENROUTER_RESPONSES_DOWNSTREAM_PROVIDER,
							model: OPENROUTER_RESPONSES_CANONICAL_MODEL,
							status: 503,
						},
					],
				}),
			},
			{
				openrouter_metadata: directRouteMetadata({
					pipeline: [{ type: "response_healing", name: "response-healing" }],
				}),
			},
		];
		for (const overrides of mismatches) {
			const response = completedResponse(
				messageOutput({
					kind: "model-turn-output-placeholder",
					summary: "bounded-placeholder",
				}),
				overrides,
			);
			const { binding, request } = createHarness(buildAuthority(), response);
			const outcome = await binding.modelTurnPort.invoke(request, new AbortController().signal);
			expect(outcome).toMatchObject({
				status: "non-evaluable",
				finishReason: null,
				usage: { requests: 1 },
			});
			expect([
				OPENROUTER_RESPONSES_ISSUE_CODES.routingMismatch,
				OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
			]).toContain(outcome.issueCodes[0]);
			serializedWithoutCredential(outcome);
		}
	}, 10_000);

	it("maps declared function calls without owning the tool loop", async () => {
		const response = completedResponse([
			{ type: "reasoning", summary: [] },
			{
				type: "function_call",
				status: "completed",
				call_id: "call_placeholder_01",
				name: "tool-placeholder",
				arguments: JSON.stringify({ commandRef: "command-placeholder", args: [] }),
			},
		]);
		const { binding, request, transport } = createHarness(buildAuthority(), response);
		const outcome = await binding.modelTurnPort.invoke(request, new AbortController().signal);

		expect(outcome).toMatchObject({
			status: "completed",
			finishReason: "tool-intents",
			structuredOutput: null,
			toolIntents: [
				{
					toolCallRef: "call_placeholder_01",
					toolRef: "tool-placeholder",
					arguments: { commandRef: "command-placeholder", args: [] },
				},
			],
		});
		expect(transport).toHaveBeenCalledTimes(1);
	});

	it("maps dotted D659 tool refs to collision-checked provider names and reverses them", async () => {
		const authority = buildDottedToolAuthority();
		const harness = createHarness(authority);
		let providerToolName = "";
		let providerOutputName = "";
		harness.transport.mockImplementationOnce((input) => {
			const body = strictJsonCodec.decode(input.body) as {
				readonly text: { readonly format: { readonly name: string } };
				readonly tools: readonly { readonly name: string }[];
			};
			providerToolName = body.tools[0]?.name ?? "";
			providerOutputName = body.text.format.name;
			return Promise.resolve({
				status: 200,
				body: completedResponse([
					{
						type: "function_call",
						status: "completed",
						call_id: "call_dotted_placeholder",
						name: providerToolName,
						arguments: JSON.stringify({
							commandRef: "command-placeholder",
							args: [],
						}),
					},
				]),
				retryAfterMs: null,
			});
		});
		const outcome = await harness.binding.modelTurnPort.invoke(
			harness.request,
			new AbortController().signal,
		);

		expect(providerToolName).toMatch(/^grf_tool_0_[a-f0-9]{24}$/);
		expect(providerToolName).not.toContain(".");
		expect(providerOutputName).toMatch(/^grf_output_[a-f0-9]{24}$/);
		expect(providerOutputName).not.toContain(".");
		expect(outcome).toMatchObject({
			status: "completed",
			finishReason: "tool-intents",
			toolIntents: [
				{
					toolCallRef: "call_dotted_placeholder",
					toolRef: "graphrefly.private-solution-eval.workspace.read-file.v1",
				},
			],
		});
	});

	it("lowers protected prior tool results into the stateless user envelope", async () => {
		const authority = buildAuthority();
		const harness = createHarness(authority);
		const request = withPriorToolResult(harness.request, authority, harness.binding);
		await harness.binding.modelTurnPort.invoke(request, new AbortController().signal);

		const sent = harness.transport.mock.calls[0]?.[0] as OpenRouterResponsesTransportRequestV1;
		const body = strictJsonCodec.decode(sent.body) as Record<string, unknown>;
		const envelope = JSON.parse(body.input as string) as Record<string, unknown>;
		expect(envelope.priorToolResults).toEqual([
			{
				toolCallRef: "call_prior_placeholder",
				toolRef: "tool-placeholder",
				result: { status: "bounded-placeholder" },
			},
		]);
		expect(body).not.toHaveProperty("previous_response_id");
		expect(body).not.toHaveProperty("function_call_output");

		const dottedAuthority = buildDottedToolAuthority();
		const dottedHarness = createHarness(dottedAuthority);
		const dottedRequest = withPriorToolResult(
			dottedHarness.request,
			dottedAuthority,
			dottedHarness.binding,
		);
		await dottedHarness.binding.modelTurnPort.invoke(dottedRequest, new AbortController().signal);
		const dottedSent = dottedHarness.transport.mock.calls[0]?.[0] as
			| OpenRouterResponsesTransportRequestV1
			| undefined;
		const dottedBody = strictJsonCodec.decode(dottedSent?.body ?? new Uint8Array()) as {
			readonly input: string;
			readonly tools: readonly { readonly name: string }[];
		};
		const dottedEnvelope = JSON.parse(dottedBody.input) as {
			readonly priorToolResults: readonly { readonly toolRef: string }[];
		};
		expect(dottedEnvelope.priorToolResults[0]?.toolRef).toBe(dottedBody.tools[0]?.name);
		expect(dottedEnvelope.priorToolResults[0]?.toolRef).toMatch(/^grf_tool_0_[a-f0-9]{24}$/);
	});

	it("rejects caller-authored D695 continuation capsules before transport", async () => {
		const authority = buildAuthority();
		const harness = createHarness(authority);
		const request = withPriorToolResult(harness.request, authority, harness.binding);
		const continuation = strictSnapshot({
			schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.hostContinuation,
			policyRef: "no-progress.d695.historical-transfer",
			policyRevision: "decision.D695.2026-08-08.v1",
			reason: "premature-structured-output",
			requiredDisposition: "tool-intents",
			missingObjectivePhases: ["exact-mutation", "workspace-diff", "focused-validation"],
			rejectedTerminalCount: 1,
			remainingSteps: 6,
			remainingActions: 31,
			retainedToolResultCount: request.priorToolResults.length,
			retainedToolResultsDigest: empiricalStrictJsonDigest(request.priorToolResults),
			workspaceStateDigest: empiricalStrictJsonDigest({ workspace: "frozen" }),
		}) satisfies ClosedHostContinuationV1;
		await expect(
			harness.binding.continuationModelTurnPort.invoke(
				request,
				continuation,
				new AbortController().signal,
			),
		).rejects.toThrow("not issued by the closed host");
		expect(harness.transport).not.toHaveBeenCalled();
	});

	it("fails closed on ambiguous, malformed, refusal, mismatched, or schema-invalid responses", async () => {
		const cases = [
			completedResponse([
				...messageOutput({
					kind: "model-turn-output-placeholder",
					summary: "bounded-placeholder",
				}),
				{
					type: "function_call",
					status: "completed",
					call_id: "call_placeholder_01",
					name: "tool-placeholder",
					arguments: "{}",
				},
			]),
			completedResponse([
				...messageOutput({
					kind: "model-turn-output-placeholder",
					summary: "bounded-placeholder",
				}),
				{
					type: "message",
					role: "assistant",
					status: "completed",
					content: [
						{
							type: "output_text",
							text: JSON.stringify({
								kind: "model-turn-output-placeholder",
								summary: "second-placeholder",
							}),
						},
					],
				},
				{
					type: "function_call",
					status: "completed",
					call_id: "call_placeholder_02",
					name: "tool-placeholder",
					arguments: "{}",
				},
			]),
			completedResponse([
				...messageOutput({
					kind: "model-turn-output-placeholder",
					summary: "bounded-placeholder",
				}),
				{ type: "message", role: "assistant", status: "completed", content: [] },
			]),
			completedResponse([
				{
					type: "function_call",
					status: "completed",
					call_id: "call_placeholder_03",
					name: "tool-placeholder",
					arguments: JSON.stringify({ commandRef: "command-placeholder", args: [] }),
				},
				{ type: "message", role: "assistant", status: "completed", content: [] },
			]),
			responseEncoder.encode(
				'{"id":"resp_placeholder_01","id":"duplicate","object":"response","status":"completed","model":"gpt-5.6-sol","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}',
			),
			completedResponse([
				{
					type: "message",
					role: "assistant",
					status: "completed",
					content: [{ type: "refusal", refusal: "bounded-placeholder" }],
				},
			]),
			completedResponse(messageOutput({ kind: "unexpected", summary: 1 }), {
				model: "different-model-placeholder",
			}),
			completedResponse(messageOutput({ kind: "unexpected", summary: 1 })),
			completedResponse(messageOutput({ kind: "model-turn-output-placeholder", summary: "ok" }), {
				usage: { input_tokens: 1, output_tokens: 1 },
			}),
			completedResponse(messageOutput({ kind: "model-turn-output-placeholder", summary: "ok" }), {
				usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
			}),
			completedResponse(messageOutput({ kind: "model-turn-output-placeholder", summary: "ok" }), {
				usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, cost: "0.1" },
			}),
			completedResponse(messageOutput({ kind: "model-turn-output-placeholder", summary: "ok" }), {
				usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, cost: -1 },
			}),
		];
		for (const response of cases) {
			const { binding, request, transport } = createHarness(buildAuthority(), response);
			const outcome = await binding.modelTurnPort.invoke(request, new AbortController().signal);
			expect(outcome.status).toBe("non-evaluable");
			expect(outcome.finishReason).toBeNull();
			expect(outcome.structuredOutput).toBeNull();
			expect(outcome.toolIntents).toEqual([]);
			expect(outcome.issueCodes).toHaveLength(1);
			expect([
				OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
				OPENROUTER_RESPONSES_ISSUE_CODES.rejected,
			]).toContain(outcome.issueCodes[0]);
			expect(transport).toHaveBeenCalledTimes(1);
			serializedWithoutCredential(outcome);
		}
	}, 10_000);

	it("preserves known provider token usage when D653 rejects candidate semantics", async () => {
		const response = completedResponse(messageOutput({ kind: "unexpected", summary: 1 }));
		const { binding, request } = createHarness(buildAuthority(), response);
		const outcome = await binding.modelTurnPort.invoke(request, new AbortController().signal);

		expect(outcome).toMatchObject({
			status: "non-evaluable",
			issueCodes: [OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse],
			usage: {
				requests: 1,
				inputTokens: 100,
				outputTokens: 20,
				totalTokens: 120,
				hostOutputBytes: 0,
			},
		});
	});

	it("sanitizes an over-budget provider output-token count without rejecting the outcome", async () => {
		const response = completedResponse(
			messageOutput({
				kind: "model-turn-output-placeholder",
				summary: "bounded-placeholder",
			}),
			{
				usage: {
					input_tokens: 100,
					output_tokens: 2_049,
					total_tokens: 2_149,
					cost: 0.062_095,
				},
			},
		);
		const { binding, request } = createHarness(buildAuthority(), response);
		const outcome = await binding.modelTurnPort.invoke(request, new AbortController().signal);

		expect(request.remainingTurnBudget.maxOutputTokens).toBe(2_048);
		expect(outcome).toMatchObject({
			status: "non-evaluable",
			issueCodes: [OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse],
			usage: {
				requests: 1,
				inputTokens: 100,
				outputTokens: null,
				totalTokens: 2_149,
			},
		});
	});

	it("keeps provider failure classes distinct and drops raw bodies and thrown values", async () => {
		const statuses = [
			[401, OPENROUTER_RESPONSES_ISSUE_CODES.authenticationPermission],
			[402, OPENROUTER_RESPONSES_ISSUE_CODES.quotaRateLimit],
			[403, OPENROUTER_RESPONSES_ISSUE_CODES.authenticationPermission],
			[429, OPENROUTER_RESPONSES_ISSUE_CODES.quotaRateLimit],
			[408, OPENROUTER_RESPONSES_ISSUE_CODES.unavailableTransport],
			[502, OPENROUTER_RESPONSES_ISSUE_CODES.unavailableTransport],
			[503, OPENROUTER_RESPONSES_ISSUE_CODES.unavailableTransport],
			[400, OPENROUTER_RESPONSES_ISSUE_CODES.rejected],
		] as const;
		for (const [status, issueCode] of statuses) {
			const rawBody = `raw-provider-error-${bearerToken}`;
			const { binding, request, transport } = createHarness(
				buildAuthority(),
				responseEncoder.encode(rawBody),
			);
			transport.mockResolvedValueOnce({
				status,
				body: responseEncoder.encode(rawBody),
				retryAfterMs: null,
			});
			const outcome = await binding.modelTurnPort.invoke(request, new AbortController().signal);
			expect(outcome.issueCodes).toEqual([issueCode, `openrouter-http-status:${status}`]);
			expect(outcome.usage.requests).toBe(1);
			serializedWithoutCredential(outcome);
			expect(JSON.stringify(outcome)).not.toContain("raw-provider-error");
		}

		const { binding, request, transport } = createHarness();
		transport.mockRejectedValueOnce(new Error(`transport-${bearerToken}`));
		const outcome = await binding.modelTurnPort.invoke(request, new AbortController().signal);
		expect(outcome.issueCodes).toEqual([OPENROUTER_RESPONSES_ISSUE_CODES.unavailableTransport]);
		expect(outcome.usage.requests).toBe(1);
		expect(outcome.latencyMs).toBe(25);
		serializedWithoutCredential(outcome);

		const diagnosticHarness = createHarness();
		diagnosticHarness.transport.mockRejectedValueOnce(
			createOpenRouterTransportFailure(
				"response-body",
				Object.assign(new Error(`raw response body ${bearerToken}`), { code: "ECONNRESET" }),
			),
		);
		const diagnosticOutcome = await diagnosticHarness.binding.modelTurnPort.invoke(
			diagnosticHarness.request,
			new AbortController().signal,
		);
		expect(diagnosticOutcome.issueCodes).toEqual([
			OPENROUTER_RESPONSES_ISSUE_CODES.unavailableTransport,
			"openrouter-transport-phase:response-body",
			"openrouter-transport-cause:econnreset",
		]);
		expect(diagnosticOutcome.latencyMs).toBe(25);
		serializedWithoutCredential(diagnosticOutcome);
		expect(JSON.stringify(diagnosticOutcome)).not.toContain("raw response body");

		const invalidMeasurementHarness = createHarness(
			buildAuthority(),
			undefined,
			undefined,
			undefined,
			[1_000, 999],
		);
		invalidMeasurementHarness.transport.mockRejectedValueOnce(new Error("transport failure"));
		const invalidMeasurementOutcome = await invalidMeasurementHarness.binding.modelTurnPort.invoke(
			invalidMeasurementHarness.request,
			new AbortController().signal,
		);
		expect(invalidMeasurementOutcome).toMatchObject({
			status: "non-evaluable",
			latencyMs: 0,
			issueCodes: [OPENROUTER_RESPONSES_ISSUE_CODES.measurementInvalid],
			usage: { requests: 1 },
		});
	});

	it("records only bounded allowlisted provider rejection diagnostics", async () => {
		const typedFailures = [
			["authentication", OPENROUTER_RESPONSES_ISSUE_CODES.authenticationPermission],
			["payment_required", OPENROUTER_RESPONSES_ISSUE_CODES.quotaRateLimit],
			["provider_overloaded", OPENROUTER_RESPONSES_ISSUE_CODES.unavailableTransport],
			["invalid_request", OPENROUTER_RESPONSES_ISSUE_CODES.rejected],
			["unknown-type", OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse],
			[bearerToken, OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse],
		] as const;
		for (const [errorType, issueCode] of typedFailures) {
			const typedHarness = createHarness();
			typedHarness.transport.mockResolvedValueOnce({
				status: 500,
				body: responseBytes({
					status: "failed",
					error: { code: "server_error", message: `raw-${bearerToken}` },
					error_type: errorType,
				}),
				retryAfterMs: null,
			});
			const typedOutcome = await typedHarness.binding.modelTurnPort.invoke(
				typedHarness.request,
				new AbortController().signal,
			);
			const errorTypeDiagnostic =
				errorType === "unknown-type" || errorType === bearerToken
					? "openrouter-error-type:unrecognized"
					: `openrouter-error-type:${errorType}`;
			expect(typedOutcome.issueCodes).toEqual([
				issueCode,
				"openrouter-http-status:500",
				errorTypeDiagnostic,
				"openrouter-error-code:server_error",
			]);
			serializedWithoutCredential(typedOutcome);
		}

		const chatRateLimitHarness = createHarness();
		chatRateLimitHarness.transport.mockResolvedValueOnce({
			status: 429,
			body: responseBytes({
				error: {
					code: "rate_limit_exceeded",
					message: `raw-${bearerToken}`,
					metadata: { error_type: "rate_limit_exceeded" },
				},
			}),
			retryAfterMs: 7_000,
		});
		const chatRateLimitOutcome = await chatRateLimitHarness.binding.modelTurnPort.invoke(
			chatRateLimitHarness.request,
			new AbortController().signal,
		);
		expect(chatRateLimitOutcome.issueCodes).toEqual([
			OPENROUTER_RESPONSES_ISSUE_CODES.quotaRateLimit,
			"openrouter-http-status:429",
			"openrouter-error-type:rate_limit_exceeded",
			"openrouter-error-code:rate_limit_exceeded",
			"openrouter-retry-after-ms:7000",
		]);
		serializedWithoutCredential(chatRateLimitOutcome);

		const nativeCodeHarness = createHarness();
		nativeCodeHarness.transport.mockResolvedValueOnce({
			status: 400,
			body: responseBytes({
				error: { code: "invalid_prompt", message: `raw-${bearerToken}` },
				metadata: null,
			}),
			retryAfterMs: null,
		});
		const nativeCodeOutcome = await nativeCodeHarness.binding.modelTurnPort.invoke(
			nativeCodeHarness.request,
			new AbortController().signal,
		);
		expect(nativeCodeOutcome.issueCodes).toEqual([
			OPENROUTER_RESPONSES_ISSUE_CODES.rejected,
			"openrouter-http-status:400",
			"openrouter-error-code:invalid_prompt",
		]);
		serializedWithoutCredential(nativeCodeOutcome);
	});

	it("does not reflect an unknown native code or malformed response bytes", async () => {
		const unknownCodeHarness = createHarness();
		unknownCodeHarness.transport.mockResolvedValueOnce({
			status: 400,
			body: responseBytes({
				error: { code: bearerToken, message: `raw-${bearerToken}` },
			}),
			retryAfterMs: null,
		});
		const unknownCodeOutcome = await unknownCodeHarness.binding.modelTurnPort.invoke(
			unknownCodeHarness.request,
			new AbortController().signal,
		);
		expect(unknownCodeOutcome.issueCodes).toEqual([
			OPENROUTER_RESPONSES_ISSUE_CODES.rejected,
			"openrouter-http-status:400",
			"openrouter-error-code:unrecognized",
		]);
		serializedWithoutCredential(unknownCodeOutcome);

		const malformedUtf8Harness = createHarness();
		malformedUtf8Harness.transport.mockResolvedValueOnce({
			status: 422,
			body: new Uint8Array([0xc3, 0x28]),
			retryAfterMs: null,
		});
		const malformedUtf8Outcome = await malformedUtf8Harness.binding.modelTurnPort.invoke(
			malformedUtf8Harness.request,
			new AbortController().signal,
		);
		expect(malformedUtf8Outcome.issueCodes).toEqual([
			OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
			"openrouter-http-status:422",
		]);
		serializedWithoutCredential(malformedUtf8Outcome);
	});

	it("blocks forged credential-bearing request material before transport", async () => {
		const authority = buildAuthority();
		const harness = createHarness(authority);
		const request = rebindInput(harness.request, authority, strictSnapshot({ value: bearerToken }));
		const outcome = await harness.binding.modelTurnPort.invoke(
			request,
			new AbortController().signal,
		);

		expect(outcome).toMatchObject({
			status: "non-evaluable",
			issueCodes: [OPENROUTER_RESPONSES_ISSUE_CODES.requestProtectionBlocked],
			usage: { requests: 0, hostOutputBytes: 0 },
		});
		expect(harness.transport).not.toHaveBeenCalled();
		serializedWithoutCredential(outcome);
	});

	it("protects the raw nested envelope before JSON string escaping", async () => {
		const escapedBearerToken = 'openrouter-"bearer\\placeholder-0123456789';
		const authority = buildAuthority();
		const harness = createHarness(
			authority,
			completedResponse(
				messageOutput({
					kind: "model-turn-output-placeholder",
					summary: "bounded-placeholder",
				}),
			),
			escapedBearerToken,
		);
		const request = rebindInput(
			harness.request,
			authority,
			strictSnapshot({ value: escapedBearerToken }),
		);
		const outcome = await harness.binding.modelTurnPort.invoke(
			request,
			new AbortController().signal,
		);

		expect(outcome.issueCodes).toEqual([OPENROUTER_RESPONSES_ISSUE_CODES.requestProtectionBlocked]);
		expect(outcome.usage.requests).toBe(0);
		expect(harness.transport).not.toHaveBeenCalled();
		expect(JSON.stringify(outcome)).not.toContain(escapedBearerToken);
	});

	it("binds blocked model candidates only by D655 digest provenance", async () => {
		const responseIdHarness = createHarness(
			buildAuthority(),
			completedResponse(
				messageOutput({
					kind: "model-turn-output-placeholder",
					summary: "bounded-placeholder",
				}),
				{ id: bearerToken },
			),
		);
		const responseIdOutcome = await responseIdHarness.binding.modelTurnPort.invoke(
			responseIdHarness.request,
			new AbortController().signal,
		);
		expect(responseIdOutcome).toMatchObject({
			status: "non-evaluable",
			issueCodes: [EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.blocked],
			protectionReceipt: { disposition: "blocked" },
		});
		serializedWithoutCredential(responseIdOutcome);

		const response = completedResponse(
			messageOutput({
				kind: "model-turn-output-placeholder",
				summary: `prefix-${bearerToken}-suffix`,
			}),
		);
		const { binding, request } = createHarness(buildAuthority(), response);
		const outcome = await binding.modelTurnPort.invoke(request, new AbortController().signal);

		expect(outcome).toMatchObject({
			status: "non-evaluable",
			issueCodes: [EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.blocked],
			structuredOutput: null,
			toolIntents: [],
			protectionReceipt: { disposition: "blocked" },
		});
		expect(outcome.evidenceRefs).toHaveLength(1);
		expect(outcome.evidenceRefs[0]?.kind).toBe(
			EMPIRICAL_MODEL_EGRESS_BLOCKED_SUBJECT_EVIDENCE_KIND,
		);
		expect(outcome.evidenceRefs[0]?.digest).toBe(outcome.protectionReceipt.subjectDigest);
		serializedWithoutCredential(outcome);

		const largeArgument = "x".repeat(20_000);
		const overBudgetResponse = completedResponse(
			Array.from({ length: 4 }, (_, index) => ({
				type: "function_call",
				status: "completed",
				call_id: `call_over_budget_${index}`,
				name: "tool-placeholder",
				arguments: JSON.stringify({
					commandRef: `${bearerToken}-${index}`,
					args: [largeArgument],
				}),
			})),
			{
				usage: {
					input_tokens: 100,
					output_tokens: 2_049,
					total_tokens: 2_149,
					cost: 0.062_095,
				},
			},
		);
		const overBudgetHarness = createHarness(buildAuthority(), overBudgetResponse);
		const overBudgetOutcome = await overBudgetHarness.binding.modelTurnPort.invoke(
			overBudgetHarness.request,
			new AbortController().signal,
		);
		expect(overBudgetOutcome).toMatchObject({
			status: "non-evaluable",
			issueCodes: [EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.blocked],
			protectionReceipt: { disposition: "blocked" },
			usage: {
				requests: 1,
				inputTokens: 100,
				outputTokens: null,
				totalTokens: 2_149,
				hostOutputBytes: 0,
			},
		});
		expect(overBudgetOutcome.evidenceRefs[0]?.digest).toBe(
			overBudgetOutcome.protectionReceipt.subjectDigest,
		);
		serializedWithoutCredential(overBudgetOutcome);
	});

	it("rejects unsupported schema lowering and oversized responses before accepting output", async () => {
		const optionalShape = strictSnapshot({
			kind: "object",
			properties: [
				{
					name: "optional",
					required: false,
					shape: { kind: "string", minLength: 1, maxLength: 10, enum: null },
				},
			],
			additionalProperties: false,
		} as const);
		const optionalHarness = createHarness(buildAuthority(optionalShape));
		const optionalOutcome = await optionalHarness.binding.modelTurnPort.invoke(
			optionalHarness.request,
			new AbortController().signal,
		);
		expect(optionalOutcome.issueCodes).toEqual([OPENROUTER_RESPONSES_ISSUE_CODES.rejected]);
		expect(optionalOutcome.usage.requests).toBe(0);
		expect(optionalHarness.transport).not.toHaveBeenCalled();

		const oversizedHarness = createHarness();
		const oversizedBody = new Uint8Array(MAX_OPENROUTER_RESPONSES_RESPONSE_BYTES + 1);
		const sliceSpy = vi.fn(() => new Uint8Array());
		Object.defineProperty(oversizedBody, "slice", {
			configurable: true,
			value: sliceSpy,
		});
		oversizedHarness.transport.mockResolvedValueOnce({
			status: 200,
			body: oversizedBody,
			retryAfterMs: null,
		});
		const oversizedOutcome = await oversizedHarness.binding.modelTurnPort.invoke(
			oversizedHarness.request,
			new AbortController().signal,
		);
		expect(oversizedOutcome.issueCodes).toEqual([OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse]);
		expect(oversizedOutcome.usage.requests).toBe(1);
		expect(sliceSpy).not.toHaveBeenCalled();

		class ExoticResponseBytes extends Uint8Array {}
		const exoticHarness = createHarness();
		exoticHarness.transport.mockResolvedValueOnce({
			status: 200,
			body: new ExoticResponseBytes(16),
			retryAfterMs: null,
		});
		const exoticOutcome = await exoticHarness.binding.modelTurnPort.invoke(
			exoticHarness.request,
			new AbortController().signal,
		);
		expect(exoticOutcome.issueCodes).toEqual([OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse]);

		const shadowedHarness = createHarness();
		const shadowedBody = new Uint8Array(16);
		const byteLengthGetter = vi.fn(() => 1);
		Object.defineProperty(shadowedBody, "byteLength", {
			configurable: true,
			get: byteLengthGetter,
		});
		shadowedHarness.transport.mockResolvedValueOnce({
			status: 200,
			body: shadowedBody,
			retryAfterMs: null,
		});
		const shadowedOutcome = await shadowedHarness.binding.modelTurnPort.invoke(
			shadowedHarness.request,
			new AbortController().signal,
		);
		expect(shadowedOutcome.issueCodes).toEqual([OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse]);
		expect(byteLengthGetter).not.toHaveBeenCalled();
	});

	it("keeps host cancellation and credential construction explicit and material-free", async () => {
		const harness = createHarness();
		const controller = new AbortController();
		controller.abort();
		await expect(
			harness.binding.modelTurnPort.invoke(harness.request, controller.signal),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(harness.transport).not.toHaveBeenCalled();

		const timeoutHarness = createHarness();
		const timeoutController = new AbortController();
		timeoutHarness.transport.mockImplementationOnce(() => {
			timeoutController.abort();
			return Promise.reject(new DOMException("provider timeout", "AbortError"));
		});
		const timeoutOutcome = await timeoutHarness.binding.modelTurnPort.invoke(
			timeoutHarness.request,
			timeoutController.signal,
		);
		expect(timeoutOutcome).toMatchObject({
			status: "non-evaluable",
			latencyMs: 25,
			issueCodes: [
				OPENROUTER_RESPONSES_ISSUE_CODES.unavailableTransport,
				OPENROUTER_RESPONSES_ISSUE_CODES.hostCancelled,
			],
			usage: { requests: 1 },
		});

		const resolvedAfterAbortHarness = createHarness();
		const resolvedAfterAbortController = new AbortController();
		resolvedAfterAbortHarness.transport.mockImplementationOnce(() => {
			resolvedAfterAbortController.abort();
			return Promise.resolve({
				status: 200,
				body: completedResponse(
					messageOutput({
						kind: "model-turn-output-placeholder",
						summary: "must-not-be-observed",
					}),
				),
				retryAfterMs: null,
			});
		});
		const resolvedAfterAbortOutcome = await resolvedAfterAbortHarness.binding.modelTurnPort.invoke(
			resolvedAfterAbortHarness.request,
			resolvedAfterAbortController.signal,
		);
		expect(resolvedAfterAbortOutcome).toMatchObject({
			status: "non-evaluable",
			latencyMs: 25,
			issueCodes: [
				OPENROUTER_RESPONSES_ISSUE_CODES.unavailableTransport,
				OPENROUTER_RESPONSES_ISSUE_CODES.hostCancelled,
			],
			usage: { requests: 1 },
		});

		const invalidMeasurementHarness = createHarness(
			buildAuthority(),
			undefined,
			undefined,
			undefined,
			[1_000, 999],
		);
		const invalidMeasurementController = new AbortController();
		invalidMeasurementHarness.transport.mockImplementationOnce(() => {
			invalidMeasurementController.abort();
			return Promise.reject(new DOMException("provider timeout", "AbortError"));
		});
		const invalidMeasurementOutcome = await invalidMeasurementHarness.binding.modelTurnPort.invoke(
			invalidMeasurementHarness.request,
			invalidMeasurementController.signal,
		);
		expect(invalidMeasurementOutcome).toMatchObject({
			status: "non-evaluable",
			latencyMs: 0,
			issueCodes: [
				OPENROUTER_RESPONSES_ISSUE_CODES.unavailableTransport,
				OPENROUTER_RESPONSES_ISSUE_CODES.hostCancelled,
				OPENROUTER_RESPONSES_ISSUE_CODES.measurementInvalid,
			],
			usage: { requests: 1 },
		});

		const authority = buildAuthority();
		const getter = vi.fn(() => bearerToken);
		const credential = Object.defineProperty(
			{
				credentialBindingRef: authority.manifest.policies.actorCredentialBindingRef,
				credentialBindingRevision: authority.manifest.policies.actorCredentialBindingRevision,
			},
			"bearerToken",
			{ enumerable: true, get: getter },
		);
		expect(() =>
			createOpenRouterResponsesEmpiricalBinding({
				frozen: authority.frozen as FrozenEmpiricalCampaignManifestV1,
				qualificationReport: authority.qualificationReport as EmpiricalTaskQualificationReportV1,
				configurationRef: authority.manifest.modelConfigurations[0]?.configurationRef as string,
				routeQualification: routeQualification(authority),
				credential: credential as never,
				transport: { request: vi.fn() },
				transportAdmission: { admit: () => true },
				monotonicMeasurement: { readMs: () => 0 },
			}),
		).toThrow("invalid OpenRouter Responses binding configuration");
		expect(getter).not.toHaveBeenCalled();
		expect(() =>
			createOpenRouterResponsesEmpiricalBinding({
				frozen: authority.frozen,
				qualificationReport: authority.qualificationReport,
				configurationRef: authority.manifest.modelConfigurations[0]?.configurationRef as string,
				routeQualification: routeQualification(authority),
				credential: {
					credentialBindingRef: authority.manifest.policies.actorCredentialBindingRef,
					credentialBindingRevision: authority.manifest.policies.actorCredentialBindingRevision,
					bearerToken: "short",
				},
				transport: { request: vi.fn() },
				transportAdmission: { admit: () => true },
				monotonicMeasurement: { readMs: () => 0 },
			}),
		).toThrow("invalid OpenRouter Responses binding configuration");

		expect(() =>
			createOpenRouterResponsesEmpiricalBinding({
				frozen: authority.frozen,
				qualificationReport: authority.qualificationReport,
				configurationRef: authority.manifest.modelConfigurations[0]?.configurationRef as string,
				routeQualification: {
					...routeQualification(authority),
					sharedCapacityQualification: {
						...sharedCapacityQualification(authority),
						byokCredentialCount: 1,
					} as never,
				},
				credential: {
					credentialBindingRef: authority.manifest.policies.actorCredentialBindingRef,
					credentialBindingRevision: authority.manifest.policies.actorCredentialBindingRevision,
					bearerToken,
				},
				transport: { request: vi.fn() },
				transportAdmission: { admit: () => true },
				monotonicMeasurement: { readMs: () => 0 },
			}),
		).toThrow("invalid OpenRouter Responses binding configuration");

		for (const substitutedRoute of [
			{
				...routeQualification(authority),
				campaignRef: "substituted-campaign",
			},
			{
				...routeQualification(authority),
				keySpendLimit: {
					...routeQualification(authority).keySpendLimit,
					workspaceRef: "substituted-workspace",
				},
			},
		]) {
			expect(() =>
				createOpenRouterResponsesEmpiricalBinding({
					frozen: authority.frozen,
					qualificationReport: authority.qualificationReport,
					configurationRef: authority.manifest.modelConfigurations[0]?.configurationRef as string,
					routeQualification: substitutedRoute,
					credential: {
						credentialBindingRef: authority.manifest.policies.actorCredentialBindingRef,
						credentialBindingRevision: authority.manifest.policies.actorCredentialBindingRevision,
						bearerToken,
					},
					transport: { request: vi.fn() },
					transportAdmission: { admit: () => true },
					monotonicMeasurement: { readMs: () => 0 },
				}),
			).toThrow("invalid OpenRouter Responses binding configuration");
		}
	});
});
