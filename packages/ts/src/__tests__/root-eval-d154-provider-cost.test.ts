import { describe, expect, it } from "vitest";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
} from "../../evals/graph-native-rerun-avoidance/canonical.js";
import type { EvalAdmittedEffect } from "../../evals/graph-native-rerun-avoidance/eval-topology.js";
import {
	nonbillableCostEvidence,
	nonbillableHttpResultDigest,
	validateNonbillableCostEvidence,
} from "../../evals/graph-native-rerun-avoidance/provider-cost-evidence.js";
import { parseRootEvalLiveProviderResponse } from "../../evals/graph-native-rerun-avoidance/root-eval-live.js";

const reservationMicrousd = 200_000;
// This unit fixture supplies only parser coordinates; Graph admission validation has separate coverage.
const admission = {
	admissionId: "d154-cost-test/dispatch-1/admission",
	receiptDigest: empiricalStrictJsonDigest("d154-cost-test-admission"),
	providerRef: "fireworks",
	providerModelRef: "deepseek/deepseek-v4-flash-0731",
	endpointProtocol: "chat-completions",
	maxOutputTokens: 4_096,
	reasoningEffort: "low",
} as EvalAdmittedEffect;

function request() {
	return {
		model: admission.providerModelRef,
		messages: [
			{ role: "system", content: "Bounded test instruction." },
			{ role: "user", content: "Bounded test input." },
		],
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "exact_replacement_proposal",
				strict: true,
				schema: {
					type: "object",
					additionalProperties: false,
					required: ["path", "oldText", "newText"],
					properties: {
						path: { type: "string", enum: ["src/test.ts"] },
						oldText: { type: "string", minLength: 1, maxLength: 32_768 },
						newText: { type: "string", maxLength: 32_768 },
					},
				},
			},
		},
		max_tokens: admission.maxOutputTokens,
		reasoning: { effort: admission.reasoningEffort },
		provider: {
			order: ["fireworks"],
			only: ["fireworks"],
			allow_fallbacks: false,
			require_parameters: true,
			data_collection: "deny",
			zdr: true,
		},
	};
}

function response(): Record<string, unknown> {
	return {
		error: {
			code: 429,
			message: "Provider returned a rate-limit error",
			metadata: {
				raw: "The upstream provider is temporarily rate-limited. Please try again later.",
				provider_name: "Fireworks",
				is_byok: false,
				provider_error_code: "rate_limit_exceeded",
				limit_source: "upstream_provider_shared_pool",
				remedy_hint: "Retry after cooldown.",
			},
		},
		user_id: "test-user",
	};
}

function metadata(value: Record<string, unknown>): Record<string, unknown> {
	return (value.error as { metadata: Record<string, unknown> }).metadata;
}

function parse(body = response(), wire = JSON.stringify(request()), status = 429) {
	return parseRootEvalLiveProviderResponse({
		status,
		bytes: new TextEncoder().encode(JSON.stringify(body)),
		retryAfter: null,
		pricing: {
			inputMicrousdPerMillionTokens: 220_000,
			outputMicrousdPerMillionTokens: 660_000,
			cacheReadMicrousdPerMillionTokens: 7_000,
		},
		reservationMicrousd,
		nonbillableContext: { admission, requestBody: wire },
	});
}

describe("D154 exact policy-qualified provider cost evidence", () => {
	it("binds qualified zero separately to exact request, response, receipt and result", () => {
		const body = response();
		const wire = JSON.stringify(request());
		const result = parse(body, wire);
		expect(result.costMicrousd).toBe(0);
		expect(result.costEvidence).toBe("policy-qualified-nonbillable");
		expect(result.nonbillableEvidence?.requestDigest).toBe(empiricalSha256(wire));
		expect(result.nonbillableEvidence?.responseDigest).toBe(empiricalSha256(JSON.stringify(body)));
		expect(
			validateNonbillableCostEvidence(result.nonbillableEvidence, admission, result.resultDigest),
		).toEqual(result.nonbillableEvidence);
	});

	it("rejects a self-consistent proof paired with another response or admission", () => {
		const result = parse();
		const proof = result.nonbillableEvidence!;
		expect(() =>
			validateNonbillableCostEvidence(
				proof,
				admission,
				nonbillableHttpResultDigest(empiricalSha256("different response")),
			),
		).toThrow(/binding/);
		expect(() =>
			validateNonbillableCostEvidence(
				proof,
				{ ...admission, receiptDigest: empiricalStrictJsonDigest("different admission") },
				result.resultDigest,
			),
		).toThrow(/binding/);
		const { evidenceDigest: _ignored, ...material } = proof;
		const rebound = nonbillableCostEvidence({
			...material,
			responseDigest: empiricalSha256("different response"),
		});
		expect(() => validateNonbillableCostEvidence(rebound, admission, result.resultDigest)).toThrow(
			/binding/,
		);
		expect(() =>
			validateNonbillableCostEvidence(
				{ ...proof, requestDigest: empiricalSha256("different request") },
				admission,
				result.resultDigest,
			),
		).toThrow(/binding/);
	});

	it.each([
		0, 0.012345,
	])("reported usage.cost %s takes precedence over policy-derived zero", (cost) => {
		const result = parse({ ...response(), usage: { cost } });
		expect(result.costEvidence).toBe("provider-reported");
		expect(result.costMicrousd).toBe(Math.ceil(cost * 1_000_000));
		expect(result.nonbillableEvidence).toBeUndefined();
	});

	it.each([
		null,
		{},
		{ cost: "0" },
		{ cost: -1 },
	])("malformed usage %j cannot release its reserve", (usage) => {
		const result = parse({ ...response(), usage });
		expect(result.costEvidence).toBe("reservation-upper-bound");
		expect(result.costMicrousd).toBe(reservationMicrousd);
	});

	it.each([
		{ usage: { cost: 0.1 } },
		JSON.stringify({ error: { message: "rate limited" }, usage: { cost: 0.1 } }),
		JSON.stringify({ error: { message: "rate limited", usage: { cost: 0.1 } } }),
		JSON.stringify({ error: { message: "rate limited", param: { choices: [{}] } } }),
		JSON.stringify({ error: { message: 'rate limited; "usage": {"cost": 1}' } }),
		'{"error":{"message":"rate limited","message":"again"}}',
		'{"error":',
		"upstream rate limit; usage.cost = 1; usage: 1",
		'upstream rate limit; {"choices":[{}]}',
		JSON.stringify([{ error: "rate limited" }]),
		42,
		null,
		"",
		"x".repeat(65_537),
	])("contradictory, malformed or untyped raw %j retains the reserve", (raw) => {
		const body = response();
		metadata(body).raw = raw;
		const result = parse(body);
		expect(result.costEvidence).toBe("reservation-upper-bound");
		expect(result.costMicrousd).toBe(reservationMicrousd);
		expect(result.nonbillableEvidence).toBeUndefined();
	});

	it("accepts bounded unique-key JSON containing only a typed upstream rate-limit error", () => {
		const body = response();
		metadata(body).raw = JSON.stringify({
			error: { code: 429, message: "Too many requests", type: "rate_limit_exceeded", param: null },
			request_id: "bounded-request-id",
		});
		expect(parse(body).costEvidence).toBe("policy-qualified-nonbillable");
	});

	it.each([
		(body: Record<string, unknown>) => {
			metadata(body).is_byok = true;
		},
		(body: Record<string, unknown>) => {
			metadata(body).provider_name = "Other";
		},
		(body: Record<string, unknown>) => {
			metadata(body).limit_source = "unknown";
		},
		(body: Record<string, unknown>) => {
			metadata(body).provider_error_code = {};
		},
		(body: Record<string, unknown>) => {
			metadata(body).remedy_hint = [];
		},
		(body: Record<string, unknown>) => {
			body.user_id = { choices: [{}] };
		},
		(body: Record<string, unknown>) => {
			body.choices = [];
		},
		(body: Record<string, unknown>) => {
			(body.error as Record<string, unknown>).code = 503;
		},
	])("rejects altered response authority or shape %#", (mutate) => {
		const body = response();
		mutate(body);
		expect(parse(body).costEvidence).toBe("reservation-upper-bound");
	});

	it.each([
		(wire: ReturnType<typeof request>) => {
			Object.assign(wire, { plugins: [{ id: "web" }] });
		},
		(wire: ReturnType<typeof request>) => {
			wire.provider.allow_fallbacks = true;
		},
		(wire: ReturnType<typeof request>) => {
			wire.provider.only = ["other"];
		},
		(wire: ReturnType<typeof request>) => {
			wire.reasoning.effort = "high";
		},
		(wire: ReturnType<typeof request>) => {
			Object.assign(wire.reasoning, { plugins: [] });
		},
		(wire: ReturnType<typeof request>) => {
			wire.max_tokens += 1;
		},
		(wire: ReturnType<typeof request>) => {
			wire.messages[0]!.role = "user";
		},
		(wire: ReturnType<typeof request>) => {
			wire.response_format.json_schema.strict = false;
		},
		(wire: ReturnType<typeof request>) => {
			Object.assign(wire.response_format.json_schema.schema, { $ref: "https://invalid.invalid" });
		},
	])("rejects changed request cost/route/schema coordinates %#", (mutate) => {
		const wire = request();
		mutate(wire);
		expect(parse(response(), JSON.stringify(wire)).costEvidence).toBe("reservation-upper-bound");
	});

	it("rejects duplicate request keys and non-429 HTTP status", () => {
		const wire = JSON.stringify(request()).replace('{"model":', '{"model":"other","model":');
		expect(parse(response(), wire).costEvidence).toBe("reservation-upper-bound");
		expect(parse(response(), JSON.stringify(request()), 503).costEvidence).toBe(
			"reservation-upper-bound",
		);
	});
});
