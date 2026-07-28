import { describe, expect, it } from "vitest";
import {
	empiricalStrictJsonDigest,
	strictSnapshot,
} from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	EMPIRICAL_MODEL_EXECUTION_SCHEMAS,
	type EmpiricalModelTurnOutcomeV1,
	MAX_EMPIRICAL_MODEL_TURN_OUTCOME_BYTES,
	MAX_EMPIRICAL_MODEL_TURN_REQUEST_BYTES,
	validateEmpiricalModelTurnOutcome,
	validateEmpiricalModelTurnOutcomeBytes,
	validateEmpiricalModelTurnRequest,
	validateEmpiricalModelTurnRequestBytes,
} from "../../evals/empirical-memory-rerun-avoidance/model-execution.js";
import {
	assertEmpiricalStrictJsonShapeMatch,
	validateEmpiricalStrictJsonShape,
} from "../../evals/empirical-memory-rerun-avoidance/strict-json-shape.js";
import { strictJsonCodec } from "../json/codec.js";
import { empiricalFixtureDigest } from "./eval-support/empirical-memory-rerun-avoidance/fixtures.js";
import {
	buildEmpiricalModelTurnAuthorityFixture,
	buildEmpiricalModelTurnOutcomeFixture,
	buildEmpiricalModelTurnRequestFixture,
	DeterministicEmpiricalModelTurnFake,
	type EmpiricalModelTurnAuthorityFixture,
} from "./eval-support/empirical-memory-rerun-avoidance/model-execution-fixtures.js";

function validateRequest(value: unknown, authority: EmpiricalModelTurnAuthorityFixture) {
	return validateEmpiricalModelTurnRequest(value, authority.frozen, authority.qualificationReport);
}

function validateOutcome(
	value: unknown,
	request: ReturnType<typeof buildEmpiricalModelTurnRequestFixture>,
	authority: EmpiricalModelTurnAuthorityFixture,
) {
	return validateEmpiricalModelTurnOutcome(
		value,
		request,
		authority.frozen,
		authority.qualificationReport,
	);
}

function rebindEgress(
	outcome: EmpiricalModelTurnOutcomeV1,
	patch: Partial<EmpiricalModelTurnOutcomeV1>,
): EmpiricalModelTurnOutcomeV1 {
	const merged = { ...outcome, ...patch };
	const subjectDigest = empiricalStrictJsonDigest({
		evidenceRefs: merged.evidenceRefs,
		issueCodes: merged.issueCodes,
		structuredOutput: merged.structuredOutput,
		toolIntents: merged.toolIntents,
	});
	return {
		...merged,
		protectionReceipt: {
			...merged.protectionReceipt,
			subjectDigest,
		},
	};
}

describe("B112.6.2 private one-turn semantic model port (D652-D653)", () => {
	it("binds one canonical request to a qualified frozen manifest and protected input", () => {
		const authority = buildEmpiricalModelTurnAuthorityFixture();
		const request = buildEmpiricalModelTurnRequestFixture(authority);
		expect(request).toMatchObject({
			schemaVersion: EMPIRICAL_MODEL_EXECUTION_SCHEMAS.request,
			manifestDigest: authority.frozen.manifestDigest,
			trialStage: "cold",
			stepIndex: 0,
			role: "actor",
			credentialBindingRef: "actor-credential-binding-placeholder",
			inputProtectionReceipt: {
				stage: "source-ingress",
				disposition: "allowed",
			},
			availableTools: [{ toolRef: "tool-placeholder", inputSchema: expect.any(Object) }],
			outputSchema: { schemaRef: "actor-turn-output-placeholder", schema: expect.any(Object) },
		});
		expect(request.structuredInputDigest).toBe(empiricalStrictJsonDigest(request.structuredInput));
		expect(Object.isFrozen(request.outputSchema.schema)).toBe(true);
		const bytes = strictJsonCodec.encode(request);
		expect(
			validateEmpiricalModelTurnRequestBytes(
				bytes,
				authority.frozen,
				authority.qualificationReport,
			),
		).toEqual(request);
		expect(() =>
			validateEmpiricalModelTurnRequestBytes(
				new TextEncoder().encode(`${new TextDecoder().decode(bytes)}\n`),
				authority.frozen,
				authority.qualificationReport,
			),
		).toThrow(/not canonical|canonical stable JSON/);
		expect(() =>
			validateRequest(
				{ ...request, manifestDigest: empiricalFixtureDigest("other-manifest") },
				authority,
			),
		).toThrow(/manifestDigest.*does not match/);
	});

	it("rejects schema substitution and validates structured output against the frozen shape", () => {
		const authority = buildEmpiricalModelTurnAuthorityFixture();
		const request = buildEmpiricalModelTurnRequestFixture(authority);
		const changedShape = {
			kind: "object",
			properties: [],
			additionalProperties: false,
		} as const;
		expect(() =>
			validateRequest(
				{
					...request,
					outputSchema: {
						...request.outputSchema,
						schema: changedShape,
						schemaDigest: empiricalStrictJsonDigest(changedShape),
					},
				},
				authority,
			),
		).toThrow(/outputSchema.*does not match the frozen schema catalog/);

		const outcome = buildEmpiricalModelTurnOutcomeFixture(request, authority);
		const invalidOutput = strictSnapshot({ kind: "missing-summary" });
		expect(() =>
			validateOutcome(
				rebindEgress(outcome, {
					structuredOutput: invalidOutput,
					structuredOutputDigest: empiricalStrictJsonDigest(invalidOutput),
				}),
				request,
				authority,
			),
		).toThrow(/summary.*required property is missing/);
	});

	it("validates tool intents against declared schemas and protects host tool results", () => {
		const authority = buildEmpiricalModelTurnAuthorityFixture();
		const request = buildEmpiricalModelTurnRequestFixture(authority);
		const outcome = buildEmpiricalModelTurnOutcomeFixture(request, authority);
		const argumentsValue = { commandRef: "command-placeholder", args: ["--check"] };
		const toolIntent = {
			toolCallRef: "tool-call-placeholder",
			toolRef: request.availableTools[0]?.toolRef,
			argumentsDigest: empiricalStrictJsonDigest(argumentsValue),
			arguments: argumentsValue,
		};
		const intentsOutcome = rebindEgress(outcome, {
			finishReason: "tool-intents",
			structuredOutput: null,
			structuredOutputDigest: null,
			toolIntents: [toolIntent],
		});
		expect(validateOutcome(intentsOutcome, request, authority).toolIntents).toHaveLength(1);
		expect(() =>
			validateOutcome(
				rebindEgress(intentsOutcome, {
					toolIntents: [
						{
							...toolIntent,
							arguments: null,
							argumentsDigest: empiricalStrictJsonDigest(null),
						},
					],
				}),
				request,
				authority,
			),
		).toThrow(/arguments.*expected object/);
		expect(() =>
			validateOutcome(
				rebindEgress(intentsOutcome, {
					toolIntents: [{ ...toolIntent, argumentsDigest: empiricalFixtureDigest("wrong") }],
				}),
				request,
				authority,
			),
		).toThrow(/argumentsDigest.*does not match/);

		const resultValue = { exitCode: 0, summaryRef: "tool-result-placeholder" };
		const resultDigest = empiricalStrictJsonDigest(resultValue);
		const toolResult = {
			toolCallRef: "tool-call-placeholder",
			toolRef: request.availableTools[0]?.toolRef,
			resultDigest,
			result: resultValue,
			protectionReceipt: {
				policyRef: request.protectionPolicyRef,
				policyRevision: request.protectionPolicyRevision,
				stage: "tool-ingress",
				subjectDigest: resultDigest,
				receiptRef: "tool-result-protection-placeholder",
				receiptDigest: empiricalFixtureDigest("tool-result-protection-placeholder"),
				disposition: "allowed",
			},
		};
		const next = validateRequest(
			{
				...request,
				requestRef: "model-turn-request-placeholder-step-1",
				stepIndex: 1,
				priorToolResults: [toolResult],
			},
			authority,
		);
		expect(next.priorToolResults).toHaveLength(1);
		expect(() =>
			validateRequest(
				{
					...next,
					priorToolResults: [
						{
							...toolResult,
							protectionReceipt: {
								...toolResult.protectionReceipt,
								stage: "source-ingress",
							},
						},
					],
				},
				authority,
			),
		).toThrow(/expected policy, stage, subject, and disposition/);
	});

	it("distinguishes zero-call and one-call non-evaluable usage from completed usage", () => {
		const authority = buildEmpiricalModelTurnAuthorityFixture();
		const request = buildEmpiricalModelTurnRequestFixture(authority);
		const completed = buildEmpiricalModelTurnOutcomeFixture(request, authority);
		const preflight = rebindEgress(completed, {
			status: "non-evaluable",
			finishReason: null,
			structuredOutput: null,
			structuredOutputDigest: null,
			toolIntents: [],
			usage: {
				...completed.usage,
				inputTokens: null,
				outputTokens: null,
				totalTokens: null,
				requests: 0,
				hostOutputBytes: 0,
			},
			issueCodes: ["unsupported-capability"],
		});
		expect(validateOutcome(preflight, request, authority).usage.requests).toBe(0);
		const postAttempt = rebindEgress(preflight, {
			usage: { ...preflight.usage, requests: 1 },
			issueCodes: ["provider-unavailable"],
		});
		expect(validateOutcome(postAttempt, request, authority).usage.requests).toBe(1);
		expect(() =>
			validateOutcome(
				{ ...completed, usage: { ...completed.usage, requests: 0 } },
				request,
				authority,
			),
		).toThrow(/completed outcomes require one remote provider request/);
		expect(() =>
			validateOutcome(
				{
					...completed,
					usage: {
						...completed.usage,
						inputTokens: null,
						outputTokens: null,
						totalTokens: null,
					},
				},
				request,
				authority,
			),
		).toThrow(/completed measured-token outcomes require all token counts/);
	});

	it("keeps host-measured byte accounting separate from unavailable token counts", () => {
		const authority = buildEmpiricalModelTurnAuthorityFixture("host-measured");
		const request = buildEmpiricalModelTurnRequestFixture(authority);
		const completed = buildEmpiricalModelTurnOutcomeFixture(request, authority);
		expect(completed.usage).toMatchObject({
			source: "host-measured",
			inputTokens: null,
			outputTokens: null,
			totalTokens: null,
			requests: 1,
			hostInputBytes: 1_024,
			hostOutputBytes: 512,
		});
		expect(() =>
			validateOutcome(
				{
					...completed,
					usage: {
						...completed.usage,
						inputTokens: 100,
						outputTokens: 20,
						totalTokens: 120,
					},
				},
				request,
				authority,
			),
		).toThrow(/host-measured usage requires null token counts/);
	});

	it("enforces frozen step/request limits and canonical output budgets", () => {
		const authority = buildEmpiricalModelTurnAuthorityFixture();
		const request = buildEmpiricalModelTurnRequestFixture(authority);
		expect(validateRequest({ ...request, stepIndex: 3 }, authority).stepIndex).toBe(3);
		expect(() => validateRequest({ ...request, stepIndex: 4 }, authority)).toThrow(
			/stepIndex.*below frozen turn limit 4/,
		);
		const oneByteRequest = validateRequest(
			{
				...request,
				remainingTurnBudget: {
					...request.remainingTurnBudget,
					maxOutputBytes: 1,
				},
			},
			authority,
		);
		const outcome = buildEmpiricalModelTurnOutcomeFixture(request, authority);
		expect(() =>
			validateOutcome(
				{
					...outcome,
					requestDigest: empiricalStrictJsonDigest(oneByteRequest),
				},
				oneByteRequest,
				authority,
			),
		).toThrow(/canonical selected payload exceeds/);
		expect(() =>
			validateOutcome(
				{ ...outcome, usage: { ...outcome.usage, hostOutputBytes: 0 } },
				request,
				authority,
			),
		).toThrow(/cannot be smaller than canonical selected payload/);
	});

	it("rejects malformed, cyclic, deep, sparse, node-heavy, and over-byte requests", () => {
		const authority = buildEmpiricalModelTurnAuthorityFixture();
		const request = buildEmpiricalModelTurnRequestFixture(authority);
		expect(() => validateRequest({ ...request, retry: 1 }, authority)).toThrow(
			/request.*unexpected keys/,
		);
		let structuralGetterInvoked = false;
		const structuralGetterRequest = { ...request };
		Object.defineProperty(structuralGetterRequest, "requestRef", {
			enumerable: true,
			get() {
				structuralGetterInvoked = true;
				return request.requestRef;
			},
		});
		expect(() => validateRequest(structuralGetterRequest, authority)).toThrow(
			/expected an own data property/,
		);
		expect(structuralGetterInvoked).toBe(false);
		let structuralArrayGetterInvoked = false;
		const structuralTools: unknown[] = [];
		Object.defineProperty(structuralTools, "0", {
			enumerable: true,
			get() {
				structuralArrayGetterInvoked = true;
				return request.availableTools[0];
			},
		});
		expect(() =>
			validateRequest({ ...request, availableTools: structuralTools }, authority),
		).toThrow(/expected an own data property/);
		expect(structuralArrayGetterInvoked).toBe(false);
		expect(() =>
			validateRequest({ ...request, availableTools: new Array(4_294_967_295) }, authority),
		).toThrow(/expected a dense array/);
		const cycle: { self?: unknown } = {};
		cycle.self = cycle;
		expect(() => validateRequest({ ...request, structuredInput: cycle }, authority)).toThrow(
			/cyclic strict JSON/,
		);
		let deep: unknown = null;
		for (let index = 0; index < 14; index += 1) deep = [deep];
		expect(() => validateRequest({ ...request, structuredInput: deep }, authority)).toThrow(
			/depth limit/,
		);
		expect(() => validateRequest({ ...request, structuredInput: new Array(1) }, authority)).toThrow(
			/sparse arrays are forbidden/,
		);
		let accessorInvoked = false;
		const accessorArray: unknown[] = [];
		Object.defineProperty(accessorArray, "0", {
			enumerable: true,
			get() {
				accessorInvoked = true;
				return null;
			},
		});
		expect(() =>
			validateRequest({ ...request, structuredInput: accessorArray }, authority),
		).toThrow(/accessors are forbidden/);
		expect(accessorInvoked).toBe(false);
		const annotatedArray: unknown[] = [];
		Object.defineProperty(annotatedArray, "annotation", {
			enumerable: true,
			value: null,
		});
		expect(() =>
			validateRequest({ ...request, structuredInput: annotatedArray }, authority),
		).toThrow(/non-index array properties are forbidden/);
		const optionalPrototypeProperty = validateEmpiricalStrictJsonShape({
			kind: "object",
			properties: [
				{
					name: "toString",
					required: false,
					shape: { kind: "string", minLength: 0, maxLength: 16, enum: null },
				},
			],
			additionalProperties: false,
		});
		expect(() =>
			assertEmpiricalStrictJsonShapeMatch({}, optionalPrototypeProperty, "prototype-property"),
		).not.toThrow();
		const requiredPrototypeProperty = validateEmpiricalStrictJsonShape({
			kind: "object",
			properties: [
				{
					name: "toString",
					required: true,
					shape: { kind: "string", minLength: 0, maxLength: 16, enum: null },
				},
			],
			additionalProperties: false,
		});
		expect(() =>
			assertEmpiricalStrictJsonShapeMatch({}, requiredPrototypeProperty, "prototype-property"),
		).toThrow(/required property is missing/);
		const nodeHeavy = Array.from({ length: 256 }, () => Array.from({ length: 16 }, () => null));
		expect(() => validateRequest({ ...request, structuredInput: nodeHeavy }, authority)).toThrow(
			/node limit/,
		);
		expect(() =>
			validateEmpiricalModelTurnRequestBytes(
				new Uint8Array(MAX_EMPIRICAL_MODEL_TURN_REQUEST_BYTES + 1),
				authority.frozen,
				authority.qualificationReport,
			),
		).toThrow(/exceeds 262144 canonical bytes/);
	});

	it("rejects non-canonical or over-byte outcomes and mismatched egress receipts", () => {
		const authority = buildEmpiricalModelTurnAuthorityFixture();
		const request = buildEmpiricalModelTurnRequestFixture(authority);
		const outcome = buildEmpiricalModelTurnOutcomeFixture(request, authority);
		const bytes = strictJsonCodec.encode(outcome);
		expect(
			validateEmpiricalModelTurnOutcomeBytes(
				bytes,
				request,
				authority.frozen,
				authority.qualificationReport,
			),
		).toEqual(outcome);
		expect(() =>
			validateEmpiricalModelTurnOutcomeBytes(
				new TextEncoder().encode(`${new TextDecoder().decode(bytes)}\n`),
				request,
				authority.frozen,
				authority.qualificationReport,
			),
		).toThrow(/not canonical|canonical stable JSON/);
		expect(() =>
			validateEmpiricalModelTurnOutcomeBytes(
				new Uint8Array(MAX_EMPIRICAL_MODEL_TURN_OUTCOME_BYTES + 1),
				request,
				authority.frozen,
				authority.qualificationReport,
			),
		).toThrow(/exceeds 262144 canonical bytes/);
		expect(() =>
			validateOutcome(
				{
					...outcome,
					protectionReceipt: {
						...outcome.protectionReceipt,
						subjectDigest: empiricalFixtureDigest("other-egress"),
					},
				},
				request,
				authority,
			),
		).toThrow(/expected policy, stage, subject, and disposition/);
	});

	it("uses a deterministic fake with explicit credential capability and host cancellation", async () => {
		const authority = buildEmpiricalModelTurnAuthorityFixture();
		const request = buildEmpiricalModelTurnRequestFixture(authority);
		const outcome = buildEmpiricalModelTurnOutcomeFixture(request, authority);
		const fake = new DeterministicEmpiricalModelTurnFake(
			{
				credentialBindingRef: request.credentialBindingRef,
				credentialBindingRevision: request.credentialBindingRevision,
			},
			authority,
			request,
			outcome,
		);
		const controller = new AbortController();
		await expect(fake.invoke(request, controller.signal)).resolves.toEqual(outcome);
		await expect(fake.invoke(request, controller.signal)).resolves.toEqual(outcome);
		await expect(
			fake.invoke(
				validateRequest({ ...request, requestRef: "unexpected-model-turn-request" }, authority),
				controller.signal,
			),
		).rejects.toThrow(/unexpected request/);
		const cancelled = new AbortController();
		cancelled.abort();
		await expect(fake.invoke(request, cancelled.signal)).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(
			() =>
				new DeterministicEmpiricalModelTurnFake(
					{
						credentialBindingRef: "different-credential-binding",
						credentialBindingRevision: request.credentialBindingRevision,
					},
					authority,
					request,
					outcome,
				),
		).toThrow(/credential capability does not match/);
	});
});
