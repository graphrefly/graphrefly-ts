import { describe, expect, it, vi } from "vitest";
import {
	empiricalStrictJsonDigest,
	strictSnapshot,
} from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import type {
	EmpiricalCampaignManifestV1,
	EmpiricalStrictJsonShapeV1,
	EmpiricalTaskQualificationReportV1,
	FrozenEmpiricalCampaignManifestV1,
} from "../../evals/empirical-memory-rerun-avoidance/contracts.js";
import {
	EMPIRICAL_MODEL_EGRESS_BLOCKED_SUBJECT_EVIDENCE_KIND,
	EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES,
	type EmpiricalModelTurnRequestV1,
	executeEmpiricalProtection,
	validateEmpiricalModelTurnRequest,
} from "../../evals/empirical-memory-rerun-avoidance/model-execution.js";
import {
	createOpenRouterResponsesEmpiricalBinding,
	MAX_OPENROUTER_RESPONSES_RESPONSE_BYTES,
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
	OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_OFFICIAL_PRICING_REVISION,
	OPENROUTER_OFFICIAL_PRICING_SOURCE,
	OPENROUTER_ROUTE_EVIDENCE_SCHEMA_REVISION,
	OPENROUTER_ROUTE_QUALIFICATION_SCHEMA,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-route-qualification.js";
import { freezeEmpiricalCampaignManifest } from "../../evals/empirical-memory-rerun-avoidance/qualification.js";
import { strictJsonCodec } from "../json/codec.js";
import { buildEmpiricalCampaignFixture } from "./eval-support/empirical-memory-rerun-avoidance/fixtures.js";
import {
	buildEmpiricalModelTurnRequestFixture,
	type EmpiricalModelTurnAuthorityFixture,
} from "./eval-support/empirical-memory-rerun-avoidance/model-execution-fixtures.js";

const bearerToken = "openrouter-bearer-placeholder-0123456789";
const responseEncoder = new TextEncoder();

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

function routeQualification(authority: OpenRouterAuthorityFixture) {
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
		endpoint: OPENROUTER_RESPONSES_ENDPOINT,
		endpointRevision: OPENROUTER_RESPONSES_ENDPOINT_REVISION,
		adapterRevision: OPENROUTER_RESPONSES_ADAPTER_REVISION,
		bindingRevision: OPENROUTER_RESPONSES_BINDING_REVISION,
		capabilitiesDigest: empiricalStrictJsonDigest(configuration.capabilities),
		settingsDigest: empiricalStrictJsonDigest(configuration.settings),
		usageSource: configuration.usageSource,
		usageRevision: "openrouter-provider-usage-placeholder",
		routeEvidenceSchemaRevision: OPENROUTER_ROUTE_EVIDENCE_SCHEMA_REVISION,
		pricing: {
			sourceUrl: OPENROUTER_OFFICIAL_PRICING_SOURCE,
			pricingRevision: OPENROUTER_OFFICIAL_PRICING_REVISION,
			currency: "USD" as const,
			inputMicrousdPerMillionTokens: 5_000_000,
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

function directRouteMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		requested: OPENROUTER_RESPONSES_MODEL,
		strategy: "direct",
		region: "region-placeholder",
		summary: "available=1, selected=OpenAI",
		attempt: 1,
		is_byok: false,
		endpoints: {
			total: 1,
			available: [
				{
					provider: OPENROUTER_RESPONSES_DOWNSTREAM_PROVIDER,
					model: OPENROUTER_RESPONSES_MODEL,
					selected: true,
				},
			],
		},
		attempts: [
			{
				provider: OPENROUTER_RESPONSES_DOWNSTREAM_PROVIDER,
				model: OPENROUTER_RESPONSES_MODEL,
				status: 200,
			},
		],
		pipeline: [],
		...overrides,
	};
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
		Promise.resolve({ status: 200, body: response }),
	);
	const admission = vi.fn(() => true);
	let measurementIndex = 0;
	const measurements = [1_000, 1_025];
	const binding = createOpenRouterResponsesEmpiricalBinding({
		frozen: authority.frozen,
		qualificationReport: authority.qualificationReport,
		configurationRef: authority.manifest.modelConfigurations[0]?.configurationRef as string,
		routeQualification: routeQualification(authority),
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
				return value ?? 1_025;
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
			parallel_tool_calls: false,
			reasoning: { effort: "medium" },
			tool_choice: "auto",
		});
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
			schemaVersion: "graphrefly.private-solution-eval.openrouter-user-envelope.v1",
			structuredInput: request.structuredInput,
			priorToolResults: [],
		});
		expect(binding.protectionExecutor).toMatchObject({
			protectedNeedleCapabilityRef: request.credentialBindingRef,
			protectedNeedleCapabilityRevision: request.credentialBindingRevision,
		});
		serializedWithoutCredential({ binding, outcome, body });
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
					attempts: [
						{
							provider: OPENROUTER_RESPONSES_DOWNSTREAM_PROVIDER,
							model: OPENROUTER_RESPONSES_MODEL,
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
	});

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
	});

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
			transport.mockResolvedValueOnce({ status, body: responseEncoder.encode(rawBody) });
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
		serializedWithoutCredential(outcome);
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

		const nativeCodeHarness = createHarness();
		nativeCodeHarness.transport.mockResolvedValueOnce({
			status: 400,
			body: responseBytes({
				error: { code: "invalid_prompt", message: `raw-${bearerToken}` },
				metadata: null,
			}),
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
			issueCodes: [OPENROUTER_RESPONSES_ISSUE_CODES.unavailableTransport],
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
