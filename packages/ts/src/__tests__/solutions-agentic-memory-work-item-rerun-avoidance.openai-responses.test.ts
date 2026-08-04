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
	createOpenAIResponsesEmpiricalBinding,
	MAX_OPENAI_RESPONSES_RESPONSE_BYTES,
	OPENAI_RESPONSES_ADAPTER_REVISION,
	OPENAI_RESPONSES_BINDING_REVISION,
	OPENAI_RESPONSES_ENDPOINT,
	OPENAI_RESPONSES_ENDPOINT_REVISION,
	OPENAI_RESPONSES_ISSUE_CODES,
	OPENAI_RESPONSES_MODEL,
	OPENAI_RESPONSES_PROMPT_REVISION,
	OPENAI_RESPONSES_SYSTEM_PROMPT_REVISION,
	type OpenAIResponsesByteTransportV1,
	type OpenAIResponsesEmpiricalBindingV1,
	type OpenAIResponsesTransportRequestV1,
} from "../../evals/empirical-memory-rerun-avoidance/openai-responses-model-turn.js";
import { freezeEmpiricalCampaignManifest } from "../../evals/empirical-memory-rerun-avoidance/qualification.js";
import { strictJsonCodec } from "../json/codec.js";
import { buildEmpiricalCampaignFixture } from "./eval-support/empirical-memory-rerun-avoidance/fixtures.js";
import {
	buildEmpiricalModelTurnRequestFixture,
	type EmpiricalModelTurnAuthorityFixture,
} from "./eval-support/empirical-memory-rerun-avoidance/model-execution-fixtures.js";

const bearerToken = "openai-bearer-placeholder-0123456789";
const responseEncoder = new TextEncoder();

interface OpenAIAuthorityFixture extends EmpiricalModelTurnAuthorityFixture {
	readonly manifest: EmpiricalCampaignManifestV1;
}

function openAIManifest(
	base: EmpiricalCampaignManifestV1,
	shapeOverride?: EmpiricalStrictJsonShapeV1,
): EmpiricalCampaignManifestV1 {
	const baseConfiguration = base.modelConfigurations[0];
	const baseOutput = base.schemaCatalog.outputs[0];
	if (baseConfiguration === undefined || baseOutput === undefined) {
		throw new TypeError("OpenAI test fixture requires one configuration and output schema");
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
		providerFamily: "openai",
		provider: "openai",
		model: OPENAI_RESPONSES_MODEL,
		modelIdentityKind: "alias-disclosed" as const,
		endpoint: OPENAI_RESPONSES_ENDPOINT,
		endpointRevision: OPENAI_RESPONSES_ENDPOINT_REVISION,
		adapterRevision: OPENAI_RESPONSES_ADAPTER_REVISION,
		bindingRevision: OPENAI_RESPONSES_BINDING_REVISION,
		promptRevision: OPENAI_RESPONSES_PROMPT_REVISION,
		systemPromptRevision: OPENAI_RESPONSES_SYSTEM_PROMPT_REVISION,
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
	};
	return strictSnapshot({
		...base,
		schemaCatalog,
		modelConfigurations: [configuration],
	});
}

function buildAuthority(shapeOverride?: EmpiricalStrictJsonShapeV1): OpenAIAuthorityFixture {
	const campaign = buildEmpiricalCampaignFixture();
	const manifest = openAIManifest(campaign.manifest, shapeOverride);
	return Object.freeze({
		manifest,
		frozen: freezeEmpiricalCampaignManifest(manifest, campaign.report),
		qualificationReport: campaign.report,
	});
}

function responseBytes(value: unknown): Uint8Array {
	return responseEncoder.encode(JSON.stringify(value));
}

function completedResponse(
	output: readonly unknown[],
	overrides: Record<string, unknown> = {},
): Uint8Array {
	return responseBytes({
		id: "resp_placeholder_01",
		object: "response",
		status: "completed",
		model: OPENAI_RESPONSES_MODEL,
		output,
		usage: {
			input_tokens: 100,
			output_tokens: 20,
			total_tokens: 120,
		},
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
	readonly binding: OpenAIResponsesEmpiricalBindingV1;
	readonly request: EmpiricalModelTurnRequestV1;
	readonly transport: ReturnType<typeof vi.fn<OpenAIResponsesByteTransportV1["request"]>>;
} {
	const transport = vi.fn<OpenAIResponsesByteTransportV1["request"]>(() =>
		Promise.resolve({ status: 200, body: response }),
	);
	let measurementIndex = 0;
	const measurements = [1_000, 1_025];
	const binding = createOpenAIResponsesEmpiricalBinding({
		frozen: authority.frozen,
		qualificationReport: authority.qualificationReport,
		configurationRef: authority.manifest.modelConfigurations[0]?.configurationRef as string,
		credential: {
			credentialBindingRef: authority.manifest.policies.actorCredentialBindingRef,
			credentialBindingRevision: authority.manifest.policies.actorCredentialBindingRevision,
			bearerToken: credentialToken,
		},
		transport: { request: transport },
		monotonicMeasurement: {
			readMs() {
				const value = measurements[measurementIndex];
				measurementIndex += 1;
				return value ?? 1_025;
			},
		},
	});
	const request = buildEmpiricalModelTurnRequestFixture(authority);
	return { binding, request, transport };
}

function rebindInput(
	request: EmpiricalModelTurnRequestV1,
	authority: OpenAIAuthorityFixture,
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
	authority: OpenAIAuthorityFixture,
	binding: OpenAIResponsesEmpiricalBindingV1,
): EmpiricalModelTurnRequestV1 {
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
					toolRef: "tool-placeholder",
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

describe("B112 D657 package-private OpenAI Responses binding", () => {
	it("sends one canonical stateless Responses request and validates protected structured output", async () => {
		const { binding, request, transport } = createHarness();
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
		const sent = transport.mock.calls[0]?.[0] as OpenAIResponsesTransportRequestV1;
		expect(sent).toMatchObject({
			endpoint: OPENAI_RESPONSES_ENDPOINT,
			method: "POST",
			authorizationBearer: bearerToken,
			contentType: "application/json",
			maxResponseBytes: MAX_OPENAI_RESPONSES_RESPONSE_BYTES,
		});
		const body = strictJsonCodec.decode(sent.body) as Record<string, unknown>;
		expect(body).toMatchObject({
			model: OPENAI_RESPONSES_MODEL,
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
			schemaVersion: "graphrefly.private-solution-eval.openai-user-envelope.v1",
			structuredInput: request.structuredInput,
			priorToolResults: [],
		});
		expect(binding.protectionExecutor).toMatchObject({
			protectedNeedleCapabilityRef: request.credentialBindingRef,
			protectedNeedleCapabilityRevision: request.credentialBindingRevision,
		});
		serializedWithoutCredential({ binding, outcome, body });
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

	it("lowers protected prior tool results into the stateless user envelope", async () => {
		const authority = buildAuthority();
		const harness = createHarness(authority);
		const request = withPriorToolResult(harness.request, authority, harness.binding);
		await harness.binding.modelTurnPort.invoke(request, new AbortController().signal);

		const sent = harness.transport.mock.calls[0]?.[0] as OpenAIResponsesTransportRequestV1;
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
				OPENAI_RESPONSES_ISSUE_CODES.invalidResponse,
				OPENAI_RESPONSES_ISSUE_CODES.rejected,
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
			issueCodes: [OPENAI_RESPONSES_ISSUE_CODES.invalidResponse],
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
			issueCodes: [OPENAI_RESPONSES_ISSUE_CODES.invalidResponse],
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
			[401, OPENAI_RESPONSES_ISSUE_CODES.authenticationPermission],
			[403, OPENAI_RESPONSES_ISSUE_CODES.authenticationPermission],
			[429, OPENAI_RESPONSES_ISSUE_CODES.quotaRateLimit],
			[408, OPENAI_RESPONSES_ISSUE_CODES.unavailableTransport],
			[503, OPENAI_RESPONSES_ISSUE_CODES.unavailableTransport],
			[400, OPENAI_RESPONSES_ISSUE_CODES.rejected],
		] as const;
		for (const [status, issueCode] of statuses) {
			const rawBody = `raw-provider-error-${bearerToken}`;
			const { binding, request, transport } = createHarness(
				buildAuthority(),
				responseEncoder.encode(rawBody),
			);
			transport.mockResolvedValueOnce({ status, body: responseEncoder.encode(rawBody) });
			const outcome = await binding.modelTurnPort.invoke(request, new AbortController().signal);
			expect(outcome.issueCodes).toEqual([issueCode]);
			expect(outcome.usage.requests).toBe(1);
			serializedWithoutCredential(outcome);
			expect(JSON.stringify(outcome)).not.toContain("raw-provider-error");
		}

		const { binding, request, transport } = createHarness();
		transport.mockRejectedValueOnce(new Error(`transport-${bearerToken}`));
		const outcome = await binding.modelTurnPort.invoke(request, new AbortController().signal);
		expect(outcome.issueCodes).toEqual([OPENAI_RESPONSES_ISSUE_CODES.unavailableTransport]);
		expect(outcome.usage.requests).toBe(1);
		serializedWithoutCredential(outcome);
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
			issueCodes: [OPENAI_RESPONSES_ISSUE_CODES.requestProtectionBlocked],
			usage: { requests: 0, hostOutputBytes: 0 },
		});
		expect(harness.transport).not.toHaveBeenCalled();
		serializedWithoutCredential(outcome);
	});

	it("protects the raw nested envelope before JSON string escaping", async () => {
		const escapedBearerToken = 'openai-"bearer\\placeholder-0123456789';
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

		expect(outcome.issueCodes).toEqual([OPENAI_RESPONSES_ISSUE_CODES.requestProtectionBlocked]);
		expect(outcome.usage.requests).toBe(0);
		expect(harness.transport).not.toHaveBeenCalled();
		expect(JSON.stringify(outcome)).not.toContain(escapedBearerToken);
	});

	it("binds blocked model candidates only by D655 digest provenance", async () => {
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
		expect(optionalOutcome.issueCodes).toEqual([OPENAI_RESPONSES_ISSUE_CODES.rejected]);
		expect(optionalOutcome.usage.requests).toBe(0);
		expect(optionalHarness.transport).not.toHaveBeenCalled();

		const oversizedHarness = createHarness();
		const oversizedBody = new Uint8Array(MAX_OPENAI_RESPONSES_RESPONSE_BYTES + 1);
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
		expect(oversizedOutcome.issueCodes).toEqual([OPENAI_RESPONSES_ISSUE_CODES.invalidResponse]);
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
		expect(exoticOutcome.issueCodes).toEqual([OPENAI_RESPONSES_ISSUE_CODES.invalidResponse]);

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
		expect(shadowedOutcome.issueCodes).toEqual([OPENAI_RESPONSES_ISSUE_CODES.invalidResponse]);
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
			createOpenAIResponsesEmpiricalBinding({
				frozen: authority.frozen as FrozenEmpiricalCampaignManifestV1,
				qualificationReport: authority.qualificationReport as EmpiricalTaskQualificationReportV1,
				configurationRef: authority.manifest.modelConfigurations[0]?.configurationRef as string,
				credential: credential as never,
				transport: { request: vi.fn() },
				monotonicMeasurement: { readMs: () => 0 },
			}),
		).toThrow("invalid OpenAI Responses binding configuration");
		expect(getter).not.toHaveBeenCalled();
		expect(() =>
			createOpenAIResponsesEmpiricalBinding({
				frozen: authority.frozen,
				qualificationReport: authority.qualificationReport,
				configurationRef: authority.manifest.modelConfigurations[0]?.configurationRef as string,
				credential: {
					credentialBindingRef: authority.manifest.policies.actorCredentialBindingRef,
					credentialBindingRevision: authority.manifest.policies.actorCredentialBindingRevision,
					bearerToken: "short",
				},
				transport: { request: vi.fn() },
				monotonicMeasurement: { readMs: () => 0 },
			}),
		).toThrow("invalid OpenAI Responses binding configuration");
	});
});
