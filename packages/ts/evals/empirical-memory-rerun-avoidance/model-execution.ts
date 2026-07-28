import type { StrictJsonValue } from "../../src/json/codec.js";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	assertCanonicalBytes,
	coordinate,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	fail,
	literal,
	oneOf,
	optionalSafeInteger,
	record,
	safeInteger,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import type {
	EmpiricalCampaignManifestV1,
	EmpiricalOptionalRolePolicyV1,
	EmpiricalOutputSchemaCatalogEntryV1,
	EmpiricalTaskQualificationReportV1,
	EmpiricalToolSchemaCatalogEntryV1,
	EmpiricalUsageSource,
	EmpiricalWarmBranchKind,
	FrozenEmpiricalCampaignManifestV1,
} from "./contracts.js";
import { validateFrozenEmpiricalCampaignManifest } from "./qualification.js";
import {
	assertEmpiricalStrictJsonShapeMatch,
	validateEmpiricalOutputSchemaCatalogEntry,
	validateEmpiricalToolSchemaCatalogEntry,
} from "./strict-json-shape.js";

export const EMPIRICAL_MODEL_EXECUTION_SCHEMAS = Object.freeze({
	request: "graphrefly.private-solution-eval.empirical-model-turn-request.v1",
	outcome: "graphrefly.private-solution-eval.empirical-model-turn-outcome.v1",
});

export const MAX_EMPIRICAL_MODEL_TURN_REQUEST_BYTES = 262_144;
export const MAX_EMPIRICAL_MODEL_TURN_OUTCOME_BYTES = 262_144;
export const MAX_EMPIRICAL_PROTECTION_SUBJECT_BYTES = 262_144;
export const EMPIRICAL_MODEL_EGRESS_BLOCKED_SUBJECT_EVIDENCE_KIND = "model-egress-blocked-subject";
export const EMPIRICAL_MODEL_EGRESS_BLOCKED_SUBJECT_EVIDENCE_ID = "model-egress-blocked-subject";
export const EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES = Object.freeze({
	blocked: "model-egress-protection-blocked",
	failed: "model-egress-protection-failed",
});

const MODEL_ROLES = Object.freeze(["actor", "auxiliary-judge", "semantic-redactor"] as const);
const TRIAL_STAGES = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);
const USAGE_SOURCES = Object.freeze([
	"provider-reported",
	"provider-count-endpoint",
	"adapter-estimated",
	"host-measured",
] as const);
const PROTECTION_STAGES = Object.freeze([
	"source-ingress",
	"tool-ingress",
	"model-egress",
] as const);
const MAX_STRICT_JSON_DEPTH = 12;
const MAX_STRICT_JSON_NODES = 4_096;
const MAX_STRICT_JSON_COLLECTION_ENTRIES = 256;
const MAX_STRICT_JSON_STRING_LENGTH = 32_768;

export type EmpiricalModelRoleV1 = (typeof MODEL_ROLES)[number];
export type EmpiricalModelTrialStageV1 = "cold" | EmpiricalWarmBranchKind;
export type EmpiricalProtectionStageV1 = (typeof PROTECTION_STAGES)[number];

export interface EmpiricalProtectionReceiptV1 {
	readonly policyRef: string;
	readonly policyRevision: string;
	readonly stage: EmpiricalProtectionStageV1;
	readonly subjectDigest: string;
	readonly receiptRef: string;
	readonly receiptDigest: string;
	readonly disposition: "allowed" | "blocked";
}

export interface EmpiricalProtectionExecutionInputV1 {
	readonly policyRef: string;
	readonly policyRevision: string;
	readonly stage: EmpiricalProtectionStageV1;
	readonly subject: StrictJsonValue;
}

/**
 * Private synchronous local-first D655 protection capability.
 *
 * Implementations inspect only the supplied bounded canonical subject and
 * return one closed disposition. The trusted wrapper emits bounded
 * material-free receipt coordinates. Implementations own no network,
 * persistence, retry, timer, provider selection, durable receipt, or Graph
 * topology.
 */
export interface EmpiricalProtectionExecutorV1 {
	inspect(input: EmpiricalProtectionExecutionInputV1): {
		readonly disposition: "allowed" | "blocked";
	};
}

export interface EmpiricalProtectionExecutionV1 {
	readonly subjectDigest: string;
	readonly receipt: EmpiricalProtectionReceiptV1;
	readonly issueCode: typeof EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.failed | null;
}

export type EmpiricalModelToolSchemaV1 = EmpiricalToolSchemaCatalogEntryV1;
export type EmpiricalModelOutputSchemaV1 = EmpiricalOutputSchemaCatalogEntryV1;

export interface EmpiricalModelToolResultV1 {
	readonly toolCallRef: string;
	readonly toolRef: string;
	readonly resultDigest: string;
	readonly result: StrictJsonValue;
	readonly protectionReceipt: EmpiricalProtectionReceiptV1;
}

export interface EmpiricalModelTurnRequestV1 {
	readonly schemaVersion: typeof EMPIRICAL_MODEL_EXECUTION_SCHEMAS.request;
	readonly requestRef: string;
	readonly manifestDigest: string;
	readonly campaignRef: string;
	readonly taskRef: string;
	readonly taskDigest: string;
	readonly trialBlockRef: string;
	readonly trialBlockDigest: string;
	readonly trialStage: EmpiricalModelTrialStageV1;
	readonly stepIndex: number;
	readonly configurationRef: string;
	readonly configurationDigest: string;
	readonly role: EmpiricalModelRoleV1;
	readonly credentialBindingRef: string;
	readonly credentialBindingRevision: string;
	readonly inputAuthorityRef: string;
	readonly inputAuthorityRevision: string;
	readonly protectionPolicyRef: string;
	readonly protectionPolicyRevision: string;
	readonly usageSource: EmpiricalUsageSource;
	readonly structuredInput: StrictJsonValue;
	readonly structuredInputDigest: string;
	readonly inputProtectionReceipt: EmpiricalProtectionReceiptV1;
	readonly priorToolResults: readonly EmpiricalModelToolResultV1[];
	readonly toolSetRevision: string;
	readonly toolSetDigest: string;
	readonly availableTools: readonly EmpiricalModelToolSchemaV1[];
	readonly outputSchema: EmpiricalModelOutputSchemaV1;
	readonly remainingTurnBudget: {
		readonly maxOutputTokens: number;
		readonly maxOutputBytes: number;
	};
}

export interface EmpiricalModelToolIntentV1 {
	readonly toolCallRef: string;
	readonly toolRef: string;
	readonly argumentsDigest: string;
	readonly arguments: StrictJsonValue;
}

export interface EmpiricalModelTurnUsageV1 {
	readonly source: EmpiricalUsageSource;
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
	readonly totalTokens: number | null;
	readonly requests: 0 | 1;
	readonly hostInputBytes: number;
	readonly hostOutputBytes: number;
}

export interface EmpiricalModelTurnEvidenceRefV1 {
	readonly kind: string;
	readonly id: string;
	readonly digest: string;
}

export interface EmpiricalModelTurnOutcomeV1 {
	readonly schemaVersion: typeof EMPIRICAL_MODEL_EXECUTION_SCHEMAS.outcome;
	readonly requestRef: string;
	readonly requestDigest: string;
	readonly configurationRef: string;
	readonly configurationDigest: string;
	readonly role: EmpiricalModelRoleV1;
	readonly status: "completed" | "non-evaluable";
	readonly finishReason: "structured-output" | "tool-intents" | null;
	readonly outputSchemaDigest: string;
	readonly structuredOutput: StrictJsonValue | null;
	readonly structuredOutputDigest: string | null;
	readonly toolIntents: readonly EmpiricalModelToolIntentV1[];
	readonly usage: EmpiricalModelTurnUsageV1;
	readonly latencyMs: number;
	readonly issueCodes: readonly string[];
	readonly evidenceRefs: readonly EmpiricalModelTurnEvidenceRefV1[];
	readonly protectionReceipt: EmpiricalProtectionReceiptV1;
}

/**
 * Private B112/D652-D653 provider-neutral boundary for exactly one model turn.
 * The host owns the agent/tool loop, budgets, timeout policy, tool execution,
 * persistence, retries, fallback, worktrees, verification, and later calls.
 */
export interface EmpiricalModelTurnPortV1 {
	invoke(
		request: EmpiricalModelTurnRequestV1,
		signal: AbortSignal,
	): Promise<EmpiricalModelTurnOutcomeV1>;
}

const REQUEST_KEYS = Object.freeze([
	"availableTools",
	"campaignRef",
	"configurationDigest",
	"configurationRef",
	"credentialBindingRef",
	"credentialBindingRevision",
	"inputAuthorityRef",
	"inputAuthorityRevision",
	"inputProtectionReceipt",
	"manifestDigest",
	"outputSchema",
	"priorToolResults",
	"protectionPolicyRef",
	"protectionPolicyRevision",
	"remainingTurnBudget",
	"requestRef",
	"role",
	"schemaVersion",
	"stepIndex",
	"structuredInput",
	"structuredInputDigest",
	"taskDigest",
	"taskRef",
	"toolSetDigest",
	"toolSetRevision",
	"trialBlockDigest",
	"trialBlockRef",
	"trialStage",
	"usageSource",
]);
const OUTCOME_KEYS = Object.freeze([
	"configurationDigest",
	"configurationRef",
	"evidenceRefs",
	"finishReason",
	"issueCodes",
	"latencyMs",
	"outputSchemaDigest",
	"protectionReceipt",
	"requestDigest",
	"requestRef",
	"role",
	"schemaVersion",
	"status",
	"structuredOutput",
	"structuredOutputDigest",
	"toolIntents",
	"usage",
]);

function boundedStrictJson(value: unknown, path: string): StrictJsonValue {
	const seen = new Set<object>();
	let nodes = 0;
	const visit = (current: unknown, currentPath: string, depth: number): void => {
		nodes += 1;
		if (nodes > MAX_STRICT_JSON_NODES) fail(path, "exceeds the bounded strict-JSON node limit");
		if (depth > MAX_STRICT_JSON_DEPTH) fail(currentPath, "exceeds the strict-JSON depth limit");
		if (
			current === null ||
			typeof current === "boolean" ||
			(typeof current === "number" && Number.isFinite(current) && !Object.is(current, -0))
		) {
			return;
		}
		if (typeof current === "string") {
			if (current.length > MAX_STRICT_JSON_STRING_LENGTH) {
				fail(currentPath, "exceeds the strict-JSON string limit");
			}
			return;
		}
		if (typeof current !== "object") fail(currentPath, "expected strict JSON data");
		if (seen.has(current)) fail(currentPath, "cyclic strict JSON is forbidden");
		seen.add(current);
		try {
			if (Array.isArray(current)) {
				if (current.length > MAX_STRICT_JSON_COLLECTION_ENTRIES) {
					fail(currentPath, "exceeds the strict-JSON array entry limit");
				}
				if (Object.getOwnPropertySymbols(current).length > 0) {
					fail(currentPath, "symbol-keyed array properties are forbidden in strict JSON");
				}
				for (const key of Object.getOwnPropertyNames(current)) {
					if (key === "length") continue;
					const index =
						/^(0|[1-9]\d*)$/.test(key) && Number.isSafeInteger(Number(key)) ? Number(key) : -1;
					if (index < 0 || index >= current.length) {
						fail(`${currentPath}.${key}`, "non-index array properties are forbidden");
					}
				}
				for (let index = 0; index < current.length; index += 1) {
					const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
					if (descriptor === undefined) {
						fail(`${currentPath}[${index}]`, "sparse arrays are forbidden in strict JSON");
					}
					if ("get" in descriptor || "set" in descriptor) {
						fail(`${currentPath}[${index}]`, "accessors are forbidden in strict JSON");
					}
					if (!descriptor.enumerable) {
						fail(`${currentPath}[${index}]`, "array entries must be enumerable");
					}
					visit(descriptor.value, `${currentPath}[${index}]`, depth + 1);
				}
				return;
			}
			const prototype = Object.getPrototypeOf(current);
			if (prototype !== Object.prototype && prototype !== null) {
				fail(currentPath, "expected a plain strict-JSON object");
			}
			const keys = Object.keys(current);
			if (keys.length > MAX_STRICT_JSON_COLLECTION_ENTRIES) {
				fail(currentPath, "exceeds the strict-JSON object entry limit");
			}
			for (const key of keys) {
				if (key.length === 0 || key.length > 256) {
					fail(currentPath, "contains an invalid object key");
				}
				const descriptor = Object.getOwnPropertyDescriptor(current, key);
				if (descriptor === undefined || "get" in descriptor || "set" in descriptor) {
					fail(`${currentPath}.${key}`, "accessors are forbidden in strict JSON");
				}
				visit(descriptor.value, `${currentPath}.${key}`, depth + 1);
			}
		} finally {
			seen.delete(current);
		}
	};
	visit(value, path, 0);
	return strictSnapshot(value as StrictJsonValue);
}

interface ExpectedProtection {
	readonly policyRef: string;
	readonly policyRevision: string;
	readonly stage: EmpiricalProtectionStageV1;
	readonly subjectDigest: string;
	readonly disposition?: "allowed" | "blocked";
}

function validateProtectionReceipt(
	value: unknown,
	path: string,
	expected: ExpectedProtection,
): EmpiricalProtectionReceiptV1 {
	const receipt = record(value, path);
	exactKeys(
		receipt,
		[
			"disposition",
			"policyRef",
			"policyRevision",
			"receiptDigest",
			"receiptRef",
			"stage",
			"subjectDigest",
		],
		path,
	);
	const validated = strictSnapshot({
		policyRef: coordinate(receipt.policyRef, `${path}.policyRef`),
		policyRevision: coordinate(receipt.policyRevision, `${path}.policyRevision`),
		stage: oneOf(receipt.stage, PROTECTION_STAGES, `${path}.stage`),
		subjectDigest: digest(receipt.subjectDigest, `${path}.subjectDigest`),
		receiptRef: coordinate(receipt.receiptRef, `${path}.receiptRef`),
		receiptDigest: digest(receipt.receiptDigest, `${path}.receiptDigest`),
		disposition: oneOf(receipt.disposition, ["allowed", "blocked"] as const, `${path}.disposition`),
	});
	if (
		validated.policyRef !== expected.policyRef ||
		validated.policyRevision !== expected.policyRevision ||
		validated.stage !== expected.stage ||
		validated.subjectDigest !== expected.subjectDigest ||
		(expected.disposition !== undefined && validated.disposition !== expected.disposition)
	) {
		fail(path, "does not match the expected policy, stage, subject, and disposition");
	}
	if (
		expected.disposition === "allowed" &&
		!sameProtectionReceipt(
			validated,
			canonicalProtectionReceipt(
				{
					policyRef: expected.policyRef,
					policyRevision: expected.policyRevision,
					stage: expected.stage,
				},
				expected.subjectDigest,
				"allowed",
			),
		)
	) {
		fail(path, "allowed receipt does not match its canonical provenance");
	}
	return validated;
}

function canonicalProtectionReceipt(
	input: Omit<EmpiricalProtectionExecutionInputV1, "subject">,
	subjectDigest: string,
	disposition: "allowed" | "blocked",
): EmpiricalProtectionReceiptV1 {
	const receiptRef = `protection:${input.stage}:${disposition}:${subjectDigest.slice("sha256:".length)}`;
	const receiptMaterial = strictSnapshot({
		policyRef: input.policyRef,
		policyRevision: input.policyRevision,
		stage: input.stage,
		subjectDigest,
		receiptRef,
		disposition,
	});
	return strictSnapshot({
		...receiptMaterial,
		receiptDigest: empiricalStrictJsonDigest(receiptMaterial),
	});
}

function failedProtectionReceipt(
	input: Omit<EmpiricalProtectionExecutionInputV1, "subject">,
	subjectDigest: string,
): EmpiricalProtectionReceiptV1 {
	const receiptRef = `protection-failed:${input.stage}:${subjectDigest.slice("sha256:".length)}`;
	const receiptMaterial = strictSnapshot({
		policyRef: input.policyRef,
		policyRevision: input.policyRevision,
		stage: input.stage,
		subjectDigest,
		receiptRef,
		disposition: "blocked" as const,
	});
	return strictSnapshot({
		...receiptMaterial,
		receiptDigest: empiricalStrictJsonDigest(receiptMaterial),
	});
}

function sameProtectionReceipt(
	left: EmpiricalProtectionReceiptV1,
	right: EmpiricalProtectionReceiptV1,
): boolean {
	return sameBytes(strictJsonCodec.encode(left), strictJsonCodec.encode(right));
}

/**
 * Runs one bounded synchronous protection inspection. Implementation failures
 * discard the thrown value and become a deterministic blocked receipt without
 * persisting raw error or subject material.
 */
export function executeEmpiricalProtection(
	executor: EmpiricalProtectionExecutorV1,
	input: EmpiricalProtectionExecutionInputV1,
): EmpiricalProtectionExecutionV1 {
	const rawInput = record(input, "protection");
	exactKeys(rawInput, ["policyRef", "policyRevision", "stage", "subject"], "protection");
	const policyRef = coordinate(rawInput.policyRef, "protection.policyRef");
	const policyRevision = coordinate(rawInput.policyRevision, "protection.policyRevision");
	const stage = oneOf(rawInput.stage, PROTECTION_STAGES, "protection.stage");
	const subject = boundedStrictJson(rawInput.subject, "protection.subject");
	if (strictJsonCodec.encode(subject).byteLength > MAX_EMPIRICAL_PROTECTION_SUBJECT_BYTES) {
		fail("protection.subject", `exceeds ${MAX_EMPIRICAL_PROTECTION_SUBJECT_BYTES} canonical bytes`);
	}
	const subjectDigest = empiricalStrictJsonDigest(subject);
	try {
		const rawInspection = record(
			executor.inspect({ policyRef, policyRevision, stage, subject }),
			"protection.inspection",
		);
		exactKeys(rawInspection, ["disposition"], "protection.inspection");
		const disposition = oneOf(
			rawInspection.disposition,
			["allowed", "blocked"] as const,
			"protection.inspection.disposition",
		);
		const receipt = validateProtectionReceipt(
			canonicalProtectionReceipt({ policyRef, policyRevision, stage }, subjectDigest, disposition),
			"protection.receipt",
			{
				policyRef,
				policyRevision,
				stage,
				subjectDigest,
				disposition,
			},
		);
		return strictSnapshot({ subjectDigest, receipt, issueCode: null });
	} catch {
		return strictSnapshot({
			subjectDigest,
			receipt: failedProtectionReceipt({ policyRef, policyRevision, stage }, subjectDigest),
			issueCode: EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.failed,
		});
	}
}

function validateToolSchemas(value: unknown): readonly EmpiricalModelToolSchemaV1[] {
	const tools = array(value, "request.availableTools");
	if (tools.length === 0 || tools.length > 64) {
		fail("request.availableTools", "expected between 1 and 64 declared tools");
	}
	const validated = tools.map((entry, index) =>
		validateEmpiricalToolSchemaCatalogEntry(entry, `request.availableTools[${index}]`),
	);
	if (new Set(validated.map((tool) => tool.toolRef)).size !== validated.length) {
		fail("request.availableTools", "toolRef values must be unique");
	}
	return strictSnapshot(validated);
}

function validateToolResults(
	value: unknown,
	availableToolRefs: ReadonlySet<string>,
	protectionPolicyRef: string,
	protectionPolicyRevision: string,
): readonly EmpiricalModelToolResultV1[] {
	const results = array(value, "request.priorToolResults");
	if (results.length > 64) fail("request.priorToolResults", "expected at most 64 entries");
	const validated = results.map((entry, index) => {
		const path = `request.priorToolResults[${index}]`;
		const result = record(entry, path);
		exactKeys(
			result,
			["protectionReceipt", "result", "resultDigest", "toolCallRef", "toolRef"],
			path,
		);
		const toolRef = coordinate(result.toolRef, `${path}.toolRef`);
		if (!availableToolRefs.has(toolRef)) {
			fail(`${path}.toolRef`, "is not declared by availableTools");
		}
		const resultValue = boundedStrictJson(result.result, `${path}.result`);
		const resultDigest = digest(result.resultDigest, `${path}.resultDigest`);
		if (resultDigest !== empiricalStrictJsonDigest(resultValue)) {
			fail(`${path}.resultDigest`, "does not match result");
		}
		const protectionReceipt = validateProtectionReceipt(
			result.protectionReceipt,
			`${path}.protectionReceipt`,
			{
				policyRef: protectionPolicyRef,
				policyRevision: protectionPolicyRevision,
				stage: "tool-ingress",
				subjectDigest: resultDigest,
				disposition: "allowed",
			},
		);
		return {
			toolCallRef: coordinate(result.toolCallRef, `${path}.toolCallRef`),
			toolRef,
			resultDigest,
			result: resultValue,
			protectionReceipt,
		};
	});
	if (new Set(validated.map((result) => result.toolCallRef)).size !== validated.length) {
		fail("request.priorToolResults", "toolCallRef values must be unique");
	}
	return strictSnapshot(validated);
}

function assertEncodedSize(value: unknown, maxBytes: number, path: string): void {
	const byteLength = strictJsonCodec.encode(value).byteLength;
	if (byteLength > maxBytes) fail(path, `exceeds ${maxBytes} canonical bytes`);
}

export function validateEmpiricalModelTurnRequest(
	value: unknown,
	frozen: FrozenEmpiricalCampaignManifestV1,
	qualificationReport: EmpiricalTaskQualificationReportV1,
): EmpiricalModelTurnRequestV1 {
	const validatedFrozen = validateFrozenEmpiricalCampaignManifest(frozen, qualificationReport);
	const manifest = validatedFrozen.manifest;
	const request = record(value, "request");
	exactKeys(request, REQUEST_KEYS, "request");
	literal(
		request.schemaVersion,
		EMPIRICAL_MODEL_EXECUTION_SCHEMAS.request,
		"request.schemaVersion",
	);
	const availableTools = validateToolSchemas(request.availableTools);
	const outputSchema = validateEmpiricalOutputSchemaCatalogEntry(
		request.outputSchema,
		"request.outputSchema",
	);
	const protectionPolicyRef = coordinate(
		request.protectionPolicyRef,
		"request.protectionPolicyRef",
	);
	const protectionPolicyRevision = coordinate(
		request.protectionPolicyRevision,
		"request.protectionPolicyRevision",
	);
	const structuredInput = boundedStrictJson(request.structuredInput, "request.structuredInput");
	const structuredInputDigest = digest(
		request.structuredInputDigest,
		"request.structuredInputDigest",
	);
	if (structuredInputDigest !== empiricalStrictJsonDigest(structuredInput)) {
		fail("request.structuredInputDigest", "does not match structuredInput");
	}
	const inputProtectionReceipt = validateProtectionReceipt(
		request.inputProtectionReceipt,
		"request.inputProtectionReceipt",
		{
			policyRef: protectionPolicyRef,
			policyRevision: protectionPolicyRevision,
			stage: "source-ingress",
			subjectDigest: structuredInputDigest,
			disposition: "allowed",
		},
	);
	const priorToolResults = validateToolResults(
		request.priorToolResults,
		new Set(availableTools.map((tool) => tool.toolRef)),
		protectionPolicyRef,
		protectionPolicyRevision,
	);
	const budget = record(request.remainingTurnBudget, "request.remainingTurnBudget");
	exactKeys(budget, ["maxOutputBytes", "maxOutputTokens"], "request.remainingTurnBudget");
	const validated = {
		schemaVersion: EMPIRICAL_MODEL_EXECUTION_SCHEMAS.request,
		requestRef: coordinate(request.requestRef, "request.requestRef"),
		manifestDigest: digest(request.manifestDigest, "request.manifestDigest"),
		campaignRef: coordinate(request.campaignRef, "request.campaignRef"),
		taskRef: coordinate(request.taskRef, "request.taskRef"),
		taskDigest: digest(request.taskDigest, "request.taskDigest"),
		trialBlockRef: coordinate(request.trialBlockRef, "request.trialBlockRef"),
		trialBlockDigest: digest(request.trialBlockDigest, "request.trialBlockDigest"),
		trialStage: oneOf(request.trialStage, TRIAL_STAGES, "request.trialStage"),
		stepIndex: safeInteger(request.stepIndex, "request.stepIndex", { max: 255 }),
		configurationRef: coordinate(request.configurationRef, "request.configurationRef"),
		configurationDigest: digest(request.configurationDigest, "request.configurationDigest"),
		role: oneOf(request.role, MODEL_ROLES, "request.role"),
		credentialBindingRef: coordinate(request.credentialBindingRef, "request.credentialBindingRef"),
		credentialBindingRevision: coordinate(
			request.credentialBindingRevision,
			"request.credentialBindingRevision",
		),
		inputAuthorityRef: coordinate(request.inputAuthorityRef, "request.inputAuthorityRef"),
		inputAuthorityRevision: coordinate(
			request.inputAuthorityRevision,
			"request.inputAuthorityRevision",
		),
		protectionPolicyRef,
		protectionPolicyRevision,
		usageSource: oneOf(request.usageSource, USAGE_SOURCES, "request.usageSource"),
		structuredInput,
		structuredInputDigest,
		inputProtectionReceipt,
		priorToolResults,
		toolSetRevision: coordinate(request.toolSetRevision, "request.toolSetRevision"),
		toolSetDigest: digest(request.toolSetDigest, "request.toolSetDigest"),
		availableTools,
		outputSchema,
		remainingTurnBudget: {
			maxOutputTokens: safeInteger(
				budget.maxOutputTokens,
				"request.remainingTurnBudget.maxOutputTokens",
				{ min: 1, max: 10_000_000 },
			),
			maxOutputBytes: safeInteger(
				budget.maxOutputBytes,
				"request.remainingTurnBudget.maxOutputBytes",
				{ min: 1, max: 16_777_216 },
			),
		},
	} satisfies EmpiricalModelTurnRequestV1;
	const task = manifest.catalog.tasks.find((entry) => entry.taskRef === validated.taskRef);
	if (task === undefined) fail("request.taskRef", "is not present in the frozen campaign manifest");
	if (!manifest.trialPlan.activeTaskRefs.includes(validated.taskRef)) {
		fail("request.taskRef", "is not active in the frozen campaign manifest");
	}
	const configuration = manifest.modelConfigurations.find(
		(entry) => entry.configurationRef === validated.configurationRef,
	);
	if (configuration === undefined) {
		fail("request.configurationRef", "is not present in the frozen campaign manifest");
	}
	const rolePolicy = modelRolePolicy(manifest, validated.role);
	if (validated.manifestDigest !== validatedFrozen.manifestDigest) {
		fail("request.manifestDigest", "does not match the frozen campaign manifest");
	}
	if (validated.campaignRef !== manifest.campaignRef) {
		fail("request.campaignRef", "does not match the frozen campaign manifest");
	}
	if (validated.taskDigest !== empiricalStrictJsonDigest(task)) {
		fail("request.taskDigest", "does not match the manifest task");
	}
	if (validated.configurationDigest !== empiricalStrictJsonDigest(configuration)) {
		fail("request.configurationDigest", "does not match the manifest configuration");
	}
	if (validated.role !== configuration.role) {
		fail("request.role", "does not match the manifest configuration");
	}
	if (
		validated.credentialBindingRef !== rolePolicy.credentialBindingRef ||
		validated.credentialBindingRevision !== rolePolicy.credentialBindingRevision
	) {
		fail("request.credentialBindingRef", "does not match the manifest role policy");
	}
	if (
		validated.inputAuthorityRef !== rolePolicy.inputAuthorityRef ||
		validated.inputAuthorityRevision !== rolePolicy.inputAuthorityRevision
	) {
		fail("request.inputAuthorityRef", "does not match the manifest role policy");
	}
	if (
		validated.protectionPolicyRef !== manifest.policies.protectionPolicyRef ||
		validated.protectionPolicyRevision !== manifest.policies.protectionPolicyRevision
	) {
		fail("request.protectionPolicyRef", "does not match the frozen campaign manifest");
	}
	if (validated.usageSource !== configuration.usageSource) {
		fail("request.usageSource", "does not match the manifest configuration");
	}
	if (
		validated.toolSetRevision !== configuration.settings.tools.schemaRevision ||
		validated.toolSetDigest !== configuration.settings.tools.toolSetDigest
	) {
		fail("request.toolSetDigest", "does not match the manifest configuration");
	}
	const selectedTools = configuration.settings.tools.toolRefs.map(
		(toolRef) =>
			manifest.schemaCatalog.tools.find((entry) => entry.toolRef === toolRef) ??
			fail("request.availableTools", `missing frozen tool schema ${toolRef}`),
	);
	if (
		!sameBytes(
			strictJsonCodec.encode(validated.availableTools),
			strictJsonCodec.encode(selectedTools),
		)
	) {
		fail("request.availableTools", "do not match the frozen schema catalog selection");
	}
	const selectedOutput =
		manifest.schemaCatalog.outputs.find(
			(entry) => entry.schemaRef === configuration.settings.output.schemaRef,
		) ?? fail("request.outputSchema", "missing frozen output schema");
	if (
		!sameBytes(
			strictJsonCodec.encode(validated.outputSchema),
			strictJsonCodec.encode(selectedOutput),
		)
	) {
		fail("request.outputSchema", "does not match the frozen schema catalog selection");
	}
	const maximumStepExclusive = Math.min(
		configuration.settings.tools.maxSteps,
		manifest.budgets.agentRun.maxSteps,
		manifest.budgets.agentRun.maxRequests,
	);
	if (validated.stepIndex >= maximumStepExclusive) {
		fail("request.stepIndex", `must be below frozen turn limit ${maximumStepExclusive}`);
	}
	if (
		validated.remainingTurnBudget.maxOutputTokens > configuration.settings.output.maxOutputTokens
	) {
		fail("request.remainingTurnBudget.maxOutputTokens", "exceeds the manifest configuration");
	}
	if (validated.remainingTurnBudget.maxOutputBytes > manifest.budgets.agentRun.maxOutputBytes) {
		fail("request.remainingTurnBudget.maxOutputBytes", "exceeds the manifest agent-run budget");
	}
	assertEncodedSize(validated, MAX_EMPIRICAL_MODEL_TURN_REQUEST_BYTES, "request");
	return strictSnapshot(validated);
}

export function validateEmpiricalModelTurnRequestBytes(
	bytes: Uint8Array,
	frozen: FrozenEmpiricalCampaignManifestV1,
	qualificationReport: EmpiricalTaskQualificationReportV1,
): EmpiricalModelTurnRequestV1 {
	if (bytes.byteLength > MAX_EMPIRICAL_MODEL_TURN_REQUEST_BYTES) {
		fail("request", `exceeds ${MAX_EMPIRICAL_MODEL_TURN_REQUEST_BYTES} canonical bytes`);
	}
	const decoded = strictJsonCodec.decode(bytes);
	assertCanonicalBytes(decoded, bytes, "request");
	return validateEmpiricalModelTurnRequest(decoded, frozen, qualificationReport);
}

function modelRolePolicy(
	manifest: EmpiricalCampaignManifestV1,
	role: EmpiricalModelRoleV1,
): {
	readonly credentialBindingRef: string;
	readonly credentialBindingRevision: string;
	readonly inputAuthorityRef: string;
	readonly inputAuthorityRevision: string;
} {
	if (role === "actor") {
		return {
			credentialBindingRef: manifest.policies.actorCredentialBindingRef,
			credentialBindingRevision: manifest.policies.actorCredentialBindingRevision,
			inputAuthorityRef: manifest.policies.actorInputAuthorityRef,
			inputAuthorityRevision: manifest.policies.actorInputAuthorityRevision,
		};
	}
	const optional: EmpiricalOptionalRolePolicyV1 =
		role === "auxiliary-judge"
			? manifest.policies.auxiliaryJudge
			: manifest.policies.semanticRedactor;
	if (
		!optional.enabled ||
		optional.credentialBindingRef === null ||
		optional.credentialBindingRevision === null ||
		optional.inputAuthorityRef === null ||
		optional.inputAuthorityRevision === null
	) {
		return fail("request.role", "is disabled by the frozen campaign manifest");
	}
	return {
		credentialBindingRef: optional.credentialBindingRef,
		credentialBindingRevision: optional.credentialBindingRevision,
		inputAuthorityRef: optional.inputAuthorityRef,
		inputAuthorityRevision: optional.inputAuthorityRevision,
	};
}

function validateToolIntents(
	value: unknown,
	availableTools: readonly EmpiricalModelToolSchemaV1[],
): readonly EmpiricalModelToolIntentV1[] {
	const intents = array(value, "outcome.toolIntents");
	if (intents.length > 64) fail("outcome.toolIntents", "expected at most 64 entries");
	const validated = intents.map((entry, index) => {
		const path = `outcome.toolIntents[${index}]`;
		const intent = record(entry, path);
		exactKeys(intent, ["arguments", "argumentsDigest", "toolCallRef", "toolRef"], path);
		const toolRef = coordinate(intent.toolRef, `${path}.toolRef`);
		const tool =
			availableTools.find((candidate) => candidate.toolRef === toolRef) ??
			fail(`${path}.toolRef`, "is not declared by the request");
		const argumentsValue = boundedStrictJson(intent.arguments, `${path}.arguments`);
		const argumentsDigest = digest(intent.argumentsDigest, `${path}.argumentsDigest`);
		if (argumentsDigest !== empiricalStrictJsonDigest(argumentsValue)) {
			fail(`${path}.argumentsDigest`, "does not match arguments");
		}
		assertEmpiricalStrictJsonShapeMatch(argumentsValue, tool.inputSchema, `${path}.arguments`);
		return {
			toolCallRef: coordinate(intent.toolCallRef, `${path}.toolCallRef`),
			toolRef,
			argumentsDigest,
			arguments: argumentsValue,
		};
	});
	if (new Set(validated.map((intent) => intent.toolCallRef)).size !== validated.length) {
		fail("outcome.toolIntents", "toolCallRef values must be unique");
	}
	return strictSnapshot(validated);
}

function validateUsage(value: unknown): EmpiricalModelTurnUsageV1 {
	const usage = record(value, "outcome.usage");
	exactKeys(
		usage,
		[
			"hostInputBytes",
			"hostOutputBytes",
			"inputTokens",
			"outputTokens",
			"requests",
			"source",
			"totalTokens",
		],
		"outcome.usage",
	);
	const requests = safeInteger(usage.requests, "outcome.usage.requests", { max: 1 }) as 0 | 1;
	return strictSnapshot({
		source: oneOf(usage.source, USAGE_SOURCES, "outcome.usage.source"),
		inputTokens: optionalSafeInteger(usage.inputTokens, "outcome.usage.inputTokens", {
			max: 1_000_000_000,
		}),
		outputTokens: optionalSafeInteger(usage.outputTokens, "outcome.usage.outputTokens", {
			max: 1_000_000_000,
		}),
		totalTokens: optionalSafeInteger(usage.totalTokens, "outcome.usage.totalTokens", {
			max: 1_000_000_000,
		}),
		requests,
		hostInputBytes: safeInteger(usage.hostInputBytes, "outcome.usage.hostInputBytes", {
			max: 16_777_216,
		}),
		hostOutputBytes: safeInteger(usage.hostOutputBytes, "outcome.usage.hostOutputBytes", {
			max: 16_777_216,
		}),
	});
}

function validateIssueCodes(value: unknown): readonly string[] {
	const issues = array(value, "outcome.issueCodes");
	if (issues.length > 32) fail("outcome.issueCodes", "expected at most 32 entries");
	const validated = issues.map((issue, index) => coordinate(issue, `outcome.issueCodes[${index}]`));
	if (new Set(validated).size !== validated.length) {
		fail("outcome.issueCodes", "issue codes must be unique");
	}
	return strictSnapshot(validated);
}

function validateEvidenceRefs(value: unknown): readonly EmpiricalModelTurnEvidenceRefV1[] {
	const refs = array(value, "outcome.evidenceRefs");
	if (refs.length > 32) fail("outcome.evidenceRefs", "expected at most 32 entries");
	const validated = refs.map((entry, index) => {
		const path = `outcome.evidenceRefs[${index}]`;
		const ref = record(entry, path);
		exactKeys(ref, ["digest", "id", "kind"], path);
		return {
			kind: coordinate(ref.kind, `${path}.kind`),
			id: coordinate(ref.id, `${path}.id`),
			digest: digest(ref.digest, `${path}.digest`),
		};
	});
	const identities = validated.map((ref) => `${ref.kind}\u0000${ref.id}`);
	if (new Set(identities).size !== identities.length) {
		fail("outcome.evidenceRefs", "evidence identities must be unique");
	}
	return strictSnapshot(validated);
}

export function validateEmpiricalModelTurnOutcome(
	value: unknown,
	request: EmpiricalModelTurnRequestV1,
	frozen: FrozenEmpiricalCampaignManifestV1,
	qualificationReport: EmpiricalTaskQualificationReportV1,
): EmpiricalModelTurnOutcomeV1 {
	const validatedRequest = validateEmpiricalModelTurnRequest(request, frozen, qualificationReport);
	const outcome = record(value, "outcome");
	exactKeys(outcome, OUTCOME_KEYS, "outcome");
	literal(
		outcome.schemaVersion,
		EMPIRICAL_MODEL_EXECUTION_SCHEMAS.outcome,
		"outcome.schemaVersion",
	);
	const requestRef = coordinate(outcome.requestRef, "outcome.requestRef");
	if (requestRef !== validatedRequest.requestRef) {
		fail("outcome.requestRef", "does not match request");
	}
	const requestDigest = digest(outcome.requestDigest, "outcome.requestDigest");
	if (requestDigest !== empiricalStrictJsonDigest(validatedRequest)) {
		fail("outcome.requestDigest", "does not match request");
	}
	const configurationRef = coordinate(outcome.configurationRef, "outcome.configurationRef");
	if (configurationRef !== validatedRequest.configurationRef) {
		fail("outcome.configurationRef", "does not match request");
	}
	const configurationDigest = digest(outcome.configurationDigest, "outcome.configurationDigest");
	if (configurationDigest !== validatedRequest.configurationDigest) {
		fail("outcome.configurationDigest", "does not match request");
	}
	const role = oneOf(outcome.role, MODEL_ROLES, "outcome.role");
	if (role !== validatedRequest.role) fail("outcome.role", "does not match request");
	const status = oneOf(outcome.status, ["completed", "non-evaluable"] as const, "outcome.status");
	const finishReason =
		outcome.finishReason === null
			? null
			: oneOf(
					outcome.finishReason,
					["structured-output", "tool-intents"] as const,
					"outcome.finishReason",
				);
	const outputSchemaDigest = digest(outcome.outputSchemaDigest, "outcome.outputSchemaDigest");
	if (outputSchemaDigest !== validatedRequest.outputSchema.schemaDigest) {
		fail("outcome.outputSchemaDigest", "does not match the request output schema");
	}
	const structuredOutput =
		outcome.structuredOutput === null
			? null
			: boundedStrictJson(outcome.structuredOutput, "outcome.structuredOutput");
	const structuredOutputDigest =
		outcome.structuredOutputDigest === null
			? null
			: digest(outcome.structuredOutputDigest, "outcome.structuredOutputDigest");
	if (
		(structuredOutput === null && structuredOutputDigest !== null) ||
		(structuredOutput !== null &&
			structuredOutputDigest !== empiricalStrictJsonDigest(structuredOutput))
	) {
		fail("outcome.structuredOutputDigest", "does not match structuredOutput");
	}
	const toolIntents = validateToolIntents(outcome.toolIntents, validatedRequest.availableTools);
	const usage = validateUsage(outcome.usage);
	if (usage.source !== validatedRequest.usageSource) {
		fail("outcome.usage.source", "does not match the request configuration");
	}
	const issueCodes = validateIssueCodes(outcome.issueCodes);
	const evidenceRefs = validateEvidenceRefs(outcome.evidenceRefs);

	if (status === "completed") {
		if (issueCodes.length !== 0) {
			fail("outcome.issueCodes", "completed outcomes cannot carry issues");
		}
		if (usage.requests !== 1) {
			fail("outcome.usage.requests", "completed outcomes require one remote provider request");
		}
		if (finishReason === "structured-output") {
			if (structuredOutput === null || toolIntents.length !== 0) {
				fail("outcome", "structured-output completion requires output and no tool intents");
			}
			assertEmpiricalStrictJsonShapeMatch(
				structuredOutput,
				validatedRequest.outputSchema.schema,
				"outcome.structuredOutput",
			);
		} else if (finishReason === "tool-intents") {
			if (structuredOutput !== null || toolIntents.length === 0) {
				fail("outcome", "tool-intents completion requires intents and no structured output");
			}
		} else {
			fail("outcome.finishReason", "completed outcomes require a finish reason");
		}
		if (
			usage.source !== "host-measured" &&
			(usage.inputTokens === null || usage.outputTokens === null || usage.totalTokens === null)
		) {
			fail("outcome.usage", "completed measured-token outcomes require all token counts");
		}
	} else {
		if (finishReason !== null || structuredOutput !== null || toolIntents.length !== 0) {
			fail("outcome", "non-evaluable outcomes cannot carry model output or tool intents");
		}
		if (issueCodes.length === 0) {
			fail("outcome.issueCodes", "non-evaluable outcomes require at least one issue");
		}
	}
	if (
		usage.source === "host-measured" &&
		(usage.inputTokens !== null || usage.outputTokens !== null || usage.totalTokens !== null)
	) {
		fail("outcome.usage", "host-measured usage requires null token counts");
	}
	if (
		usage.requests === 0 &&
		(usage.inputTokens !== null ||
			usage.outputTokens !== null ||
			usage.totalTokens !== null ||
			usage.hostOutputBytes !== 0)
	) {
		fail("outcome.usage", "zero-request outcomes cannot carry provider usage or output bytes");
	}

	const egressMaterial = strictSnapshot({
		evidenceRefs,
		issueCodes,
		structuredOutput,
		toolIntents,
	});
	const blockedSubjectRefs = evidenceRefs.filter(
		(ref) => ref.kind === EMPIRICAL_MODEL_EGRESS_BLOCKED_SUBJECT_EVIDENCE_KIND,
	);
	const rawProtectionReceipt = record(outcome.protectionReceipt, "outcome.protectionReceipt");
	const protectionDisposition = oneOf(
		rawProtectionReceipt.disposition,
		["allowed", "blocked"] as const,
		"outcome.protectionReceipt.disposition",
	);
	let expectedProtectionSubjectDigest = empiricalStrictJsonDigest(egressMaterial);
	let protectionIssueCode:
		| (typeof EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES)[keyof typeof EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES]
		| null = null;
	if (protectionDisposition === "blocked") {
		if (status !== "non-evaluable") {
			fail("outcome.protectionReceipt", "blocked model egress must be non-evaluable");
		}
		if (usage.requests !== 1) {
			fail("outcome.usage.requests", "blocked model egress requires one remote provider request");
		}
		if (blockedSubjectRefs.length !== 1 || evidenceRefs.length !== 1) {
			fail(
				"outcome.evidenceRefs",
				"blocked model egress requires exactly one model-egress-blocked-subject evidence ref in total",
			);
		}
		if (blockedSubjectRefs[0]?.id !== EMPIRICAL_MODEL_EGRESS_BLOCKED_SUBJECT_EVIDENCE_ID) {
			fail(
				"outcome.evidenceRefs",
				"blocked model egress requires the fixed blocked-subject evidence id",
			);
		}
		const protectionIssueCodes = issueCodes.filter(
			(issue) =>
				issue === EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.blocked ||
				issue === EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.failed,
		);
		if (protectionIssueCodes.length !== 1 || issueCodes.length !== 1) {
			fail(
				"outcome.issueCodes",
				"blocked model egress requires exactly one protection classification in total",
			);
		}
		protectionIssueCode = protectionIssueCodes[0] as NonNullable<typeof protectionIssueCode>;
		expectedProtectionSubjectDigest =
			blockedSubjectRefs[0]?.digest ??
			fail("outcome.evidenceRefs", "missing blocked-subject evidence digest");
	} else {
		if (blockedSubjectRefs.length !== 0) {
			fail(
				"outcome.evidenceRefs",
				"allowed model egress cannot carry model-egress-blocked-subject evidence",
			);
		}
		if (
			issueCodes.includes(EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.blocked) ||
			issueCodes.includes(EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.failed)
		) {
			fail(
				"outcome.issueCodes",
				"allowed model egress cannot carry a protection failure classification",
			);
		}
	}
	const protectionReceipt = validateProtectionReceipt(
		rawProtectionReceipt,
		"outcome.protectionReceipt",
		{
			policyRef: validatedRequest.protectionPolicyRef,
			policyRevision: validatedRequest.protectionPolicyRevision,
			stage: "model-egress",
			subjectDigest: expectedProtectionSubjectDigest,
			disposition: protectionDisposition,
		},
	);
	if (protectionDisposition === "blocked") {
		const receiptCoordinates = {
			policyRef: validatedRequest.protectionPolicyRef,
			policyRevision: validatedRequest.protectionPolicyRevision,
			stage: "model-egress" as const,
		};
		const expectedReceipt =
			protectionIssueCode === EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.failed
				? failedProtectionReceipt(receiptCoordinates, expectedProtectionSubjectDigest)
				: canonicalProtectionReceipt(
						receiptCoordinates,
						expectedProtectionSubjectDigest,
						"blocked",
					);
		if (!sameProtectionReceipt(protectionReceipt, expectedReceipt)) {
			fail(
				"outcome.protectionReceipt",
				"protection classification does not match receipt provenance",
			);
		}
	}
	const latencyMs = safeInteger(outcome.latencyMs, "outcome.latencyMs", {
		max: 86_400_000,
	});
	const validated = {
		schemaVersion: EMPIRICAL_MODEL_EXECUTION_SCHEMAS.outcome,
		requestRef,
		requestDigest,
		configurationRef,
		configurationDigest,
		role,
		status,
		finishReason,
		outputSchemaDigest,
		structuredOutput,
		structuredOutputDigest,
		toolIntents,
		usage,
		latencyMs,
		issueCodes,
		evidenceRefs,
		protectionReceipt,
	} satisfies EmpiricalModelTurnOutcomeV1;
	assertEncodedSize(validated, MAX_EMPIRICAL_MODEL_TURN_OUTCOME_BYTES, "outcome");
	const selectedPayload =
		finishReason === "structured-output"
			? structuredOutput
			: finishReason === "tool-intents"
				? toolIntents
				: null;
	const canonicalPayloadBytes =
		selectedPayload === null ? 0 : strictJsonCodec.encode(selectedPayload).byteLength;
	if (canonicalPayloadBytes > validatedRequest.remainingTurnBudget.maxOutputBytes) {
		fail("outcome", "canonical selected payload exceeds the remaining output-byte budget");
	}
	if (usage.hostOutputBytes > validatedRequest.remainingTurnBudget.maxOutputBytes) {
		fail("outcome.usage.hostOutputBytes", "exceeds the remaining output-byte budget");
	}
	if (status === "completed" && usage.hostOutputBytes < canonicalPayloadBytes) {
		fail("outcome.usage.hostOutputBytes", "cannot be smaller than canonical selected payload");
	}
	if (
		usage.outputTokens !== null &&
		usage.outputTokens > validatedRequest.remainingTurnBudget.maxOutputTokens
	) {
		fail("outcome.usage.outputTokens", "exceeds the remaining output-token budget");
	}
	return strictSnapshot(validated);
}

export function validateEmpiricalModelTurnOutcomeBytes(
	bytes: Uint8Array,
	request: EmpiricalModelTurnRequestV1,
	frozen: FrozenEmpiricalCampaignManifestV1,
	qualificationReport: EmpiricalTaskQualificationReportV1,
): EmpiricalModelTurnOutcomeV1 {
	if (bytes.byteLength > MAX_EMPIRICAL_MODEL_TURN_OUTCOME_BYTES) {
		fail("outcome", `exceeds ${MAX_EMPIRICAL_MODEL_TURN_OUTCOME_BYTES} canonical bytes`);
	}
	const decoded = strictJsonCodec.decode(bytes);
	assertCanonicalBytes(decoded, bytes, "outcome");
	return validateEmpiricalModelTurnOutcome(decoded, request, frozen, qualificationReport);
}
