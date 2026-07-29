import { describe, expect, it } from "vitest";
import {
	empiricalStrictJsonDigest,
	strictSnapshot,
} from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	EMPIRICAL_MODEL_EGRESS_BLOCKED_SUBJECT_EVIDENCE_ID,
	EMPIRICAL_MODEL_EGRESS_BLOCKED_SUBJECT_EVIDENCE_KIND,
	EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES,
	EMPIRICAL_MODEL_EXECUTION_SCHEMAS,
	type EmpiricalModelTurnOutcomeV1,
	type EmpiricalProtectionExecutorV1,
	executeEmpiricalProtection,
	MAX_EMPIRICAL_MODEL_TURN_OUTCOME_BYTES,
	MAX_EMPIRICAL_MODEL_TURN_REQUEST_BYTES,
	MAX_EMPIRICAL_PROTECTION_SUBJECT_BYTES,
	validateEmpiricalModelTurnOutcome,
	validateEmpiricalModelTurnOutcomeBytes,
	validateEmpiricalModelTurnRequest,
	validateEmpiricalModelTurnRequestBytes,
} from "../../evals/empirical-memory-rerun-avoidance/model-execution.js";
import {
	assertEmpiricalStrictJsonShapeMatch,
	validateEmpiricalStrictJsonShape,
} from "../../evals/empirical-memory-rerun-avoidance/strict-json-shape.js";
import type { StrictJsonValue } from "../json/codec.js";
import { strictJsonCodec } from "../json/codec.js";
import { empiricalFixtureDigest } from "./eval-support/empirical-memory-rerun-avoidance/fixtures.js";
import {
	buildEmpiricalModelTurnAuthorityFixture,
	buildEmpiricalModelTurnOutcomeFixture,
	buildEmpiricalModelTurnRequestFixture,
	DeterministicEmpiricalModelTurnScript,
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
	const egressMaterial = strictSnapshot({
		evidenceRefs: merged.evidenceRefs,
		issueCodes: merged.issueCodes,
		structuredOutput: merged.structuredOutput,
		toolIntents: merged.toolIntents,
	}) as unknown as StrictJsonValue;
	const protectionReceipt = executeEmpiricalProtection(protectionExecutor("allowed"), {
		policyRef: merged.protectionReceipt.policyRef,
		policyRevision: merged.protectionReceipt.policyRevision,
		stage: "model-egress",
		subject: egressMaterial,
	}).receipt;
	return {
		...merged,
		protectionReceipt,
	};
}

function protectionExecutor(disposition: "allowed" | "blocked"): EmpiricalProtectionExecutorV1 {
	return {
		inspect() {
			return { disposition };
		},
	};
}

describe("B112.6.2-B112.6.3 private model turn and protection execution (D652-D655)", () => {
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
		expect(() =>
			validateRequest(
				{
					...request,
					inputProtectionReceipt: {
						...request.inputProtectionReceipt,
						receiptRef: "forged-source-ingress-receipt",
					},
				},
				authority,
			),
		).toThrow(/allowed receipt does not match its canonical provenance/);
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
		const resultProtectionReceipt = executeEmpiricalProtection(protectionExecutor("allowed"), {
			policyRef: request.protectionPolicyRef,
			policyRevision: request.protectionPolicyRevision,
			stage: "tool-ingress",
			subject: resultValue,
		}).receipt;
		const toolResult = {
			toolCallRef: "tool-call-placeholder",
			toolRef: request.availableTools[0]?.toolRef,
			resultDigest,
			result: resultValue,
			protectionReceipt: resultProtectionReceipt,
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
		const largeResultValue = { content: "x".repeat(77_194) };
		const largeResultDigest = empiricalStrictJsonDigest(largeResultValue);
		const largeResultReceipt = executeEmpiricalProtection(protectionExecutor("allowed"), {
			policyRef: request.protectionPolicyRef,
			policyRevision: request.protectionPolicyRevision,
			stage: "tool-ingress",
			subject: largeResultValue,
		}).receipt;
		expect(
			validateRequest(
				{
					...next,
					priorToolResults: [
						{
							...toolResult,
							result: largeResultValue,
							resultDigest: largeResultDigest,
							protectionReceipt: largeResultReceipt,
						},
					],
				},
				authority,
			).priorToolResults[0]?.resultDigest,
		).toBe(largeResultDigest);
		expect(() =>
			validateRequest(
				{
					...next,
					priorToolResults: [
						{
							...toolResult,
							protectionReceipt: {
								...toolResult.protectionReceipt,
								receiptDigest: empiricalFixtureDigest("forged-tool-receipt"),
							},
						},
					],
				},
				authority,
			),
		).toThrow(/allowed receipt does not match its canonical provenance/);
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
				{
					...preflight,
					usage: { ...preflight.usage, providerCostMicrousd: 1 },
				},
				request,
				authority,
			),
		).toThrow(/zero-request outcomes cannot carry provider usage/);
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

	it("binds blocked model egress to one candidate digest without publishing the candidate", () => {
		const authority = buildEmpiricalModelTurnAuthorityFixture();
		const request = buildEmpiricalModelTurnRequestFixture(authority);
		const completed = buildEmpiricalModelTurnOutcomeFixture(request, authority);
		const candidate = strictSnapshot({
			kind: "model-turn-output-placeholder",
			summary: "blocked-candidate-placeholder",
		});
		const protection = executeEmpiricalProtection(protectionExecutor("blocked"), {
			policyRef: request.protectionPolicyRef,
			policyRevision: request.protectionPolicyRevision,
			stage: "model-egress",
			subject: candidate,
		});
		const blocked = {
			...completed,
			status: "non-evaluable",
			finishReason: null,
			structuredOutput: null,
			structuredOutputDigest: null,
			toolIntents: [],
			issueCodes: [EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.blocked],
			evidenceRefs: [
				{
					kind: EMPIRICAL_MODEL_EGRESS_BLOCKED_SUBJECT_EVIDENCE_KIND,
					id: EMPIRICAL_MODEL_EGRESS_BLOCKED_SUBJECT_EVIDENCE_ID,
					digest: protection.subjectDigest,
				},
			],
			protectionReceipt: protection.receipt,
		} as const;
		const validated = validateOutcome(blocked, request, authority);
		expect(validated).toMatchObject({
			status: "non-evaluable",
			structuredOutput: null,
			toolIntents: [],
			protectionReceipt: {
				disposition: "blocked",
				subjectDigest: empiricalStrictJsonDigest(candidate),
			},
		});
		expect(JSON.stringify(validated)).not.toContain("blocked-candidate-placeholder");

		expect(() => validateOutcome({ ...blocked, evidenceRefs: [] }, request, authority)).toThrow(
			/exactly one model-egress-blocked-subject/,
		);
		expect(() =>
			validateOutcome(
				{
					...blocked,
					evidenceRefs: [
						...blocked.evidenceRefs,
						{
							kind: "provider-response-summary",
							id: "unexpected-extra-evidence",
							digest: empiricalFixtureDigest("unexpected-extra-evidence"),
						},
					],
				},
				request,
				authority,
			),
		).toThrow(/exactly one model-egress-blocked-subject/);
		expect(() =>
			validateOutcome(
				{
					...blocked,
					protectionReceipt: {
						...blocked.protectionReceipt,
						subjectDigest: empiricalFixtureDigest("different-blocked-candidate"),
					},
				},
				request,
				authority,
			),
		).toThrow(/expected policy, stage, subject, and disposition/);
		expect(() =>
			validateOutcome(
				{
					...blocked,
					issueCodes: ["provider-unavailable"],
				},
				request,
				authority,
			),
		).toThrow(/requires exactly one protection classification/);
		expect(() =>
			validateOutcome(
				{
					...blocked,
					issueCodes: [
						EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.blocked,
						"raw-candidate-secret",
					],
				},
				request,
				authority,
			),
		).toThrow(/requires exactly one protection classification/);
		expect(() =>
			validateOutcome(
				{
					...blocked,
					evidenceRefs: [
						{
							...blocked.evidenceRefs[0],
							id: "raw-candidate-secret",
						},
					],
				},
				request,
				authority,
			),
		).toThrow(/fixed blocked-subject evidence id/);
		expect(() =>
			validateOutcome(
				{
					...blocked,
					protectionReceipt: {
						...blocked.protectionReceipt,
						receiptRef: "raw-candidate-secret",
					},
				},
				request,
				authority,
			),
		).toThrow(/classification does not match receipt provenance/);
		expect(() =>
			validateOutcome(
				{
					...blocked,
					issueCodes: [EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.failed],
				},
				request,
				authority,
			),
		).toThrow(/classification does not match receipt provenance/);
		expect(() =>
			validateOutcome(
				{
					...blocked,
					issueCodes: [
						EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.blocked,
						EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.failed,
					],
				},
				request,
				authority,
			),
		).toThrow(/requires exactly one protection classification/);
		expect(() =>
			validateOutcome(
				{
					...blocked,
					usage: {
						...blocked.usage,
						inputTokens: null,
						outputTokens: null,
						totalTokens: null,
						requests: 0,
						hostOutputBytes: 0,
					},
				},
				request,
				authority,
			),
		).toThrow(/blocked model egress requires one remote provider request/);

		const failedProtection = executeEmpiricalProtection(
			{
				inspect() {
					throw new Error("unprocessed-protection-error");
				},
			},
			{
				policyRef: request.protectionPolicyRef,
				policyRevision: request.protectionPolicyRevision,
				stage: "model-egress",
				subject: candidate,
			},
		);
		const failedOutcome = {
			...blocked,
			issueCodes: [EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.failed],
			evidenceRefs: [
				{
					...blocked.evidenceRefs[0],
					digest: failedProtection.subjectDigest,
				},
			],
			protectionReceipt: failedProtection.receipt,
		};
		expect(validateOutcome(failedOutcome, request, authority).issueCodes).toEqual([
			EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.failed,
		]);
		expect(() =>
			validateOutcome(
				{
					...failedOutcome,
					issueCodes: [EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.blocked],
				},
				request,
				authority,
			),
		).toThrow(/classification does not match receipt provenance/);
	});

	it("keeps allowed failure egress separate and fails closed on protection implementation errors", () => {
		const authority = buildEmpiricalModelTurnAuthorityFixture();
		const request = buildEmpiricalModelTurnRequestFixture(authority);
		const completed = buildEmpiricalModelTurnOutcomeFixture(request, authority);
		const sanitizedFailure = rebindEgress(completed, {
			status: "non-evaluable",
			finishReason: null,
			structuredOutput: null,
			structuredOutputDigest: null,
			toolIntents: [],
			issueCodes: ["provider-unavailable"],
		});
		expect(
			validateOutcome(sanitizedFailure, request, authority).protectionReceipt.disposition,
		).toBe("allowed");
		expect(() =>
			validateOutcome(
				{
					...sanitizedFailure,
					evidenceRefs: [
						{
							kind: EMPIRICAL_MODEL_EGRESS_BLOCKED_SUBJECT_EVIDENCE_KIND,
							id: "invalid-blocked-subject-placeholder",
							digest: empiricalFixtureDigest("invalid-blocked-subject-placeholder"),
						},
					],
				},
				request,
				authority,
			),
		).toThrow(/allowed model egress cannot carry/);

		const rawErrorMarker = "raw-provider-error-must-not-persist";
		const failed = executeEmpiricalProtection(
			{
				inspect() {
					throw new Error(rawErrorMarker);
				},
			},
			{
				policyRef: request.protectionPolicyRef,
				policyRevision: request.protectionPolicyRevision,
				stage: "model-egress",
				subject: { candidateRef: "candidate-placeholder" },
			},
		);
		expect(failed).toMatchObject({
			issueCode: EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.failed,
			receipt: { disposition: "blocked" },
		});
		expect(JSON.stringify(failed)).not.toContain(rawErrorMarker);
		expect(
			executeEmpiricalProtection(
				{
					inspect() {
						throw new Error(rawErrorMarker);
					},
				},
				{
					policyRef: request.protectionPolicyRef,
					policyRevision: request.protectionPolicyRevision,
					stage: "model-egress",
					subject: { candidateRef: "candidate-placeholder" },
				},
			),
		).toEqual(failed);

		const untrustedReceiptMarker = "raw-candidate-secret";
		const malformed = executeEmpiricalProtection(
			{
				inspect() {
					return {
						disposition: "blocked",
						receiptRef: untrustedReceiptMarker,
					} as unknown as { readonly disposition: "blocked" };
				},
			},
			{
				policyRef: request.protectionPolicyRef,
				policyRevision: request.protectionPolicyRevision,
				stage: "model-egress",
				subject: { candidateRef: "candidate-placeholder" },
			},
		);
		expect(malformed.issueCode).toBe(EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.failed);
		expect(JSON.stringify(malformed)).not.toContain(untrustedReceiptMarker);

		for (const stage of ["source-ingress", "tool-ingress", "model-egress"] as const) {
			const allowed = executeEmpiricalProtection(protectionExecutor("allowed"), {
				policyRef: request.protectionPolicyRef,
				policyRevision: request.protectionPolicyRevision,
				stage,
				subject: { stage },
			});
			expect(allowed).toMatchObject({
				issueCode: null,
				receipt: { stage, disposition: "allowed", subjectDigest: allowed.subjectDigest },
			});
		}
		const largeToolResult = executeEmpiricalProtection(protectionExecutor("allowed"), {
			policyRef: request.protectionPolicyRef,
			policyRevision: request.protectionPolicyRevision,
			stage: "tool-ingress",
			subject: { content: "x".repeat(77_194) },
		});
		expect(largeToolResult).toMatchObject({
			issueCode: null,
			receipt: { disposition: "allowed" },
		});
		expect(() =>
			executeEmpiricalProtection(protectionExecutor("allowed"), {
				policyRef: request.protectionPolicyRef,
				policyRevision: request.protectionPolicyRevision,
				stage: "tool-ingress",
				subject: { content: "x".repeat(MAX_EMPIRICAL_PROTECTION_SUBJECT_BYTES) },
			}),
		).toThrow(/exceeds 262144 canonical bytes/);

		let getterInvoked = false;
		const hostileInput = {
			policyRef: request.protectionPolicyRef,
			policyRevision: request.protectionPolicyRevision,
			stage: "model-egress",
			subject: { candidateRef: "candidate-placeholder" },
		};
		Object.defineProperty(hostileInput, "subject", {
			enumerable: true,
			get() {
				getterInvoked = true;
				return { candidateRef: "hostile-candidate-placeholder" };
			},
		});
		expect(() =>
			executeEmpiricalProtection(
				protectionExecutor("allowed"),
				hostileInput as unknown as Parameters<typeof executeEmpiricalProtection>[1],
			),
		).toThrow(/expected an own data property/);
		expect(getterInvoked).toBe(false);
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
		expect(() =>
			validateOutcome(
				{
					...outcome,
					protectionReceipt: {
						...outcome.protectionReceipt,
						receiptRef: "forged-model-egress-receipt",
					},
				},
				request,
				authority,
			),
		).toThrow(/allowed receipt does not match its canonical provenance/);
	});

	it("strictly replays a finite deterministic script without network, fallback, or hidden retries", async () => {
		const authority = buildEmpiricalModelTurnAuthorityFixture();
		const firstRequest = buildEmpiricalModelTurnRequestFixture(authority);
		const firstOutcome = buildEmpiricalModelTurnOutcomeFixture(firstRequest, authority);
		const secondRequest = validateRequest(
			{
				...firstRequest,
				requestRef: "model-turn-request-placeholder-step-1",
				stepIndex: 1,
			},
			authority,
		);
		const secondOutcome = buildEmpiricalModelTurnOutcomeFixture(secondRequest, authority);
		const script = new DeterministicEmpiricalModelTurnScript(
			{
				credentialBindingRef: firstRequest.credentialBindingRef,
				credentialBindingRevision: firstRequest.credentialBindingRevision,
			},
			authority,
			[
				{ request: firstRequest, outcome: firstOutcome },
				{ request: secondRequest, outcome: secondOutcome },
			],
		);
		const controller = new AbortController();
		await expect(script.invoke(firstRequest, controller.signal)).resolves.toEqual(firstOutcome);
		await expect(
			script.invoke(
				validateRequest(
					{ ...secondRequest, requestRef: "unexpected-model-turn-request" },
					authority,
				),
				controller.signal,
			),
		).rejects.toThrow(/unexpected request/);
		expect(script.observations).toEqual([
			{
				attemptIndex: 0,
				scriptIndex: 0,
				requestRef: firstRequest.requestRef,
				requestDigest: empiricalStrictJsonDigest(firstRequest),
				stepIndex: 0,
				outcomeStatus: "completed",
			},
		]);
		expect(Object.isFrozen(script.observations)).toBe(true);
		const cancelled = new AbortController();
		cancelled.abort();
		await expect(script.invoke(secondRequest, cancelled.signal)).rejects.toMatchObject({
			name: "AbortError",
		});
		await expect(script.invoke(secondRequest, controller.signal)).resolves.toEqual(secondOutcome);
		await expect(script.invoke(secondRequest, controller.signal)).rejects.toThrow(
			/frozen attempt budget/,
		);
		expect(script.observations).toEqual([
			{
				attemptIndex: 0,
				scriptIndex: 0,
				requestRef: firstRequest.requestRef,
				requestDigest: empiricalStrictJsonDigest(firstRequest),
				stepIndex: 0,
				outcomeStatus: "completed",
			},
			{
				attemptIndex: 3,
				scriptIndex: 1,
				requestRef: secondRequest.requestRef,
				requestDigest: empiricalStrictJsonDigest(secondRequest),
				stepIndex: 1,
				outcomeStatus: "completed",
			},
		]);
		expect(script.attemptCount).toBe(authority.frozen.manifest.budgets.agentRun.maxRequests);
		expect(firstOutcome.usage.requests).toBe(1);
		expect(
			() =>
				new DeterministicEmpiricalModelTurnScript(
					{
						credentialBindingRef: "different-credential-binding",
						credentialBindingRevision: firstRequest.credentialBindingRevision,
					},
					authority,
					[{ request: firstRequest, outcome: firstOutcome }],
				),
		).toThrow(/credential capability does not match/);
		expect(
			() =>
				new DeterministicEmpiricalModelTurnScript(
					{
						credentialBindingRef: firstRequest.credentialBindingRef,
						credentialBindingRevision: firstRequest.credentialBindingRevision,
					},
					authority,
					Array.from(
						{ length: authority.frozen.manifest.budgets.agentRun.maxRequests + 1 },
						() => ({ request: firstRequest, outcome: firstOutcome }),
					),
				),
		).toThrow(/exceeds the frozen agent-run request budget/);
		expect(
			() =>
				new DeterministicEmpiricalModelTurnScript(
					{
						credentialBindingRef: firstRequest.credentialBindingRef,
						credentialBindingRevision: firstRequest.credentialBindingRevision,
					},
					authority,
					new Array(1),
				),
		).toThrow(/dense semantic replay script/);
		const boundedMisses = new DeterministicEmpiricalModelTurnScript(
			{
				credentialBindingRef: firstRequest.credentialBindingRef,
				credentialBindingRevision: firstRequest.credentialBindingRevision,
			},
			authority,
			[{ request: firstRequest, outcome: firstOutcome }],
		);
		const unexpectedRequest = validateRequest(
			{ ...firstRequest, requestRef: "bounded-unexpected-model-turn-request" },
			authority,
		);
		for (
			let attempt = 0;
			attempt < authority.frozen.manifest.budgets.agentRun.maxRequests;
			attempt += 1
		) {
			await expect(boundedMisses.invoke(unexpectedRequest, controller.signal)).rejects.toThrow(
				/unexpected request/,
			);
		}
		await expect(boundedMisses.invoke(firstRequest, controller.signal)).rejects.toThrow(
			/frozen attempt budget/,
		);
		expect(boundedMisses.attemptCount).toBe(authority.frozen.manifest.budgets.agentRun.maxRequests);
		expect(boundedMisses.observations).toEqual([]);
	});
});
