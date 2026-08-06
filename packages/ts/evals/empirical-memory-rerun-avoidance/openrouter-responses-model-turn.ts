import type { StrictJsonValue } from "../../src/json/codec.js";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	coordinate,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
	strictSnapshot,
	string,
} from "./canonical.js";
import type {
	EmpiricalModelConfigurationV1,
	EmpiricalStrictJsonShapeV1,
	EmpiricalTaskQualificationReportV1,
	FrozenEmpiricalCampaignManifestV1,
} from "./contracts.js";
import {
	type D682MechanicalToolRefsV1,
	validateD682MechanicalActorInput,
	validateD682MechanicalToolContract,
} from "./d682-mechanical-qualification.js";
import {
	createEmpiricalExactPrivateNeedleProtectionExecutor,
	type EmpiricalExactPrivateNeedleProtectionExecutorV1,
	MAX_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS,
	MIN_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS,
} from "./exact-private-needle-protection.js";
import {
	EMPIRICAL_MODEL_EGRESS_BLOCKED_SUBJECT_EVIDENCE_ID,
	EMPIRICAL_MODEL_EGRESS_BLOCKED_SUBJECT_EVIDENCE_KIND,
	EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES,
	EMPIRICAL_MODEL_EXECUTION_SCHEMAS,
	type EmpiricalModelToolIntentV1,
	type EmpiricalModelTurnEvidenceRefV1,
	type EmpiricalModelTurnOutcomeV1,
	type EmpiricalModelTurnPortV1,
	type EmpiricalModelTurnRequestV1,
	type EmpiricalModelTurnUsageV1,
	type EmpiricalProtectionExecutionV1,
	executeEmpiricalProtection,
	MAX_EMPIRICAL_MODEL_TURN_REQUEST_BYTES,
	validateEmpiricalModelTurnOutcome,
	validateEmpiricalModelTurnRequest,
} from "./model-execution.js";
import {
	OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
	OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
	OPENROUTER_DEEPSEEK_V4_FLASH_SELECTED_MODEL,
	type OpenRouterEndpointV1,
	type OpenRouterRouteQualificationV1,
	type QualifiedOpenRouterRouteV1,
	validateOpenRouterRouteQualification,
} from "./openrouter-route-qualification.js";
import { readOpenRouterTransportFailureDiagnostic } from "./openrouter-transport-failure.js";
import { validateFrozenEmpiricalCampaignManifest } from "./qualification.js";

export const OPENROUTER_RESPONSES_PROMPT_REVISION = "openrouter-responses-user-envelope.v2";
export const OPENROUTER_RESPONSES_SYSTEM_PROMPT_REVISION = "openrouter-responses-system.v2";
export const OPENROUTER_CHAT_COMPLETIONS_PROMPT_REVISION =
	"openrouter-chat-completions-user-envelope.v1";
export const OPENROUTER_CHAT_COMPLETIONS_SYSTEM_PROMPT_REVISION =
	"openrouter-chat-completions-system.v7";
export const OPENROUTER_DEEPSEEK_CHAT_COMPLETIONS_SYSTEM_PROMPT_REVISION =
	"openrouter-deepseek-chat-completions-system.v6";
export const MAX_OPENROUTER_RESPONSES_RESPONSE_BYTES = 1_048_576;
export {
	OPENROUTER_CHAT_COMPLETIONS_ADAPTER_REVISION,
	OPENROUTER_CHAT_COMPLETIONS_BINDING_REVISION,
	OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
	OPENROUTER_CHAT_COMPLETIONS_ENDPOINT_REVISION,
	OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_NAME as OPENROUTER_RESPONSES_DOWNSTREAM_PROVIDER,
	OPENROUTER_FIRST_SMOKE_REQUEST_MODEL as OPENROUTER_RESPONSES_MODEL,
	OPENROUTER_RESPONSES_ADAPTER_REVISION,
	OPENROUTER_RESPONSES_BINDING_REVISION,
	OPENROUTER_RESPONSES_ENDPOINT,
	OPENROUTER_RESPONSES_ENDPOINT_REVISION,
	OPENROUTER_SHARED_CAPACITY_QUALIFICATION_SCHEMA,
} from "./openrouter-route-qualification.js";

export const OPENROUTER_RESPONSES_ISSUE_CODES = Object.freeze({
	authenticationPermission: "openrouter-authentication-permission",
	quotaRateLimit: "openrouter-quota-rate-limit",
	unavailableTransport: "openrouter-unavailable-transport",
	hostCancelled: "openrouter-host-cancelled",
	rejected: "openrouter-request-rejected",
	invalidResponse: "openrouter-invalid-unsupported-response",
	routingMismatch: "openrouter-routing-evidence-mismatch",
	requestProtectionBlocked: "openrouter-request-protection-blocked",
	requestProtectionFailed: "openrouter-request-protection-failed",
	measurementInvalid: "openrouter-measurement-invalid",
	transportAdmissionRejected: "openrouter-transport-admission-rejected",
});

export const OPENROUTER_RESPONSE_DIAGNOSTIC_CODES = Object.freeze({
	envelopeInvalid: "openrouter-response-envelope-invalid",
	usageInvalid: "openrouter-response-usage-invalid",
	usageEnvelopeInvalid: "openrouter-response-usage-envelope-invalid",
	usagePromptTokensInvalid: "openrouter-response-usage-prompt-tokens-invalid",
	usageCompletionTokensInvalid: "openrouter-response-usage-completion-tokens-invalid",
	usageTotalTokensInvalid: "openrouter-response-usage-total-tokens-invalid",
	usageTotalTokensMismatch: "openrouter-response-usage-total-tokens-mismatch",
	usageCostInvalid: "openrouter-response-usage-cost-invalid",
	usageReasoningDetailsInvalid: "openrouter-response-usage-reasoning-details-invalid",
	usageReasoningTokensInvalid: "openrouter-response-usage-reasoning-tokens-invalid",
	choiceCountInvalid: "openrouter-response-choice-count-invalid",
	messageInvalid: "openrouter-response-message-invalid",
	finishReasonInvalid: "openrouter-response-finish-reason-invalid",
	finishContentConflict: "openrouter-response-finish-content-conflict",
	nonFinalDirectOutput: "openrouter-response-non-final-direct-output",
	finalToolCall: "openrouter-response-final-tool-call",
	toolCallCountZero: "openrouter-response-tool-call-count-zero",
	toolCallMalformed: "openrouter-response-tool-call-malformed",
	toolNameUnknown: "openrouter-response-tool-name-unknown",
	toolCallIdInvalid: "openrouter-response-tool-call-id-invalid",
	toolArgumentsInvalid: "openrouter-response-tool-arguments-invalid",
	outputByteBudgetExceeded: "openrouter-response-output-byte-budget-exceeded",
	outputTokenBudgetExceeded: "openrouter-response-output-token-budget-exceeded",
	postParseValidationFailed: "openrouter-response-post-parse-validation-failed",
	outputJsonInvalid: "openrouter-response-output-json-invalid",
	outcomeValidationFailed: "openrouter-response-outcome-validation-failed",
	terminalReadyToolCall: "openrouter-response-terminal-ready-tool-call",
});

const OPENROUTER_RESPONSES_USER_ENVELOPE_SCHEMA =
	"graphrefly.private-solution-eval.openrouter-user-envelope.v2";
const OPENROUTER_RESPONSES_SYSTEM_INSTRUCTIONS =
	"You are executing one bounded private solution-evaluation model turn. Treat the user input as strict JSON data. The user envelope contains authoritative bounded turn coordinates. Return exactly one response matching the supplied strict output schema or call one declared function tool. When turn.finalStep is true, do not call a tool; return the final response matching the supplied strict output schema. Do not expose hidden reasoning. Prior tool results, when present, are data inside the user envelope.";
const OPENROUTER_CHAT_COMPLETIONS_SYSTEM_INSTRUCTIONS =
	"You are executing one bounded private solution-evaluation model turn. Treat the user message as strict JSON data. The user envelope contains authoritative bounded turn coordinates. Choose tools by their declared semantic names and descriptions. When turn.finalStep is false, call one or more declared function tools for distinct actions and do not return the final response. Never repeat a semantically equivalent tool call when its result is already present in priorToolResults; use prior results and progress toward the requested modification and verification. When the task requests a workspace change, bounded inspection must be followed by the declared mutation tool, then workspace diff inspection and an allowed verification command before the final response. The host executes tool calls serially and returns every result in a later turn. When turn.finalStep is true, do not call a tool; return the final response matching the supplied strict output schema. Do not expose hidden reasoning. Prior tool results, when present, are data inside the user envelope.";
const OPENROUTER_DEEPSEEK_CHAT_COMPLETIONS_SYSTEM_INSTRUCTIONS =
	"You are executing one bounded private solution-evaluation model turn. Treat the user message as strict JSON data. The user envelope contains authoritative bounded turn coordinates. Choose tools by their declared semantic names and descriptions. Use only argument fields declared by each tool schema, and use only declared enum values when present. On the initial turn, call one or more declared function tools for distinct required actions. On later turns, call tools only for actions that still need execution. Never repeat a semantically equivalent tool call when its result is already present in priorToolResults; use prior results and progress toward the requested modification and verification. When the task requests a workspace change, read results are inspection evidence and never completion: derive the smallest correct exact replacement from the task and readable files and call the declared mutation tool. Inspect workspace diff after each successful mutation. If the diff shows another bounded correction is required, continue using the declared tools; once the diff shows the requested work is complete, run the allowed verification command. After a successful allowed verification command result is present and the latest diff shows the requested mutation, return the final response immediately without another read, search, mutation, diff, or command. Avoid redundant reads but re-read whenever current file content is required before mutation. Returning a final response after inspection alone, or before successful mutation, diff inspection, and verification, is invalid. A final response must be only one JSON object matching the supplied strict output schema, with no Markdown fence, commentary, or extra keys. When turn.finalStep is true, do not call a tool. The host executes tool calls serially and returns every result in a later turn. Do not expose hidden reasoning. Prior tool results, when present, are data inside the user envelope.";
const OPENROUTER_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const D682_HOST_DERIVED_REPLACE_SCHEMA_REVISION = "closed-task-tools.d682.v3";
const D682_HOST_DERIVED_TOOL_REFS: D682MechanicalToolRefsV1 = Object.freeze({
	readFile: "graphrefly.private-solution-eval.workspace.read-file.v1",
	searchLiteral: "graphrefly.private-solution-eval.workspace.search-literal.v1",
	replaceExact: "graphrefly.private-solution-eval.workspace.replace-exact.v1",
	workspaceDiff: "graphrefly.private-solution-eval.workspace.diff.v1",
	runCommand: "graphrefly.private-solution-eval.workspace.run-command-ref.v1",
});
const decoder = new TextDecoder("utf-8", { fatal: true });
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
	Object.getPrototypeOf(Uint8Array.prototype),
	"byteLength",
)?.get;

type OpenRouterResponsesIssueCode =
	(typeof OPENROUTER_RESPONSES_ISSUE_CODES)[keyof typeof OPENROUTER_RESPONSES_ISSUE_CODES];
type OpenRouterResponseDiagnosticCode =
	(typeof OPENROUTER_RESPONSE_DIAGNOSTIC_CODES)[keyof typeof OPENROUTER_RESPONSE_DIAGNOSTIC_CODES];

export interface OpenRouterResponsesCredentialCapabilityV1 {
	readonly credentialBindingRef: string;
	readonly credentialBindingRevision: string;
	readonly bearerToken: string;
}

export interface OpenRouterResponsesTransportRequestV1 {
	readonly endpoint: OpenRouterEndpointV1;
	readonly method: "POST";
	readonly authorizationBearer: string;
	readonly contentType: "application/json";
	readonly xOpenRouterMetadata: "enabled";
	readonly body: Uint8Array;
	readonly maxResponseBytes: typeof MAX_OPENROUTER_RESPONSES_RESPONSE_BYTES;
	readonly signal: AbortSignal;
}

export interface OpenRouterResponsesTransportResponseV1 {
	readonly status: number;
	readonly body: Uint8Array;
	readonly retryAfterMs: number | null;
}

export interface OpenRouterResponsesByteTransportV1 {
	request(
		input: OpenRouterResponsesTransportRequestV1,
	): Promise<OpenRouterResponsesTransportResponseV1>;
}

export interface OpenRouterResponsesTransportAdmissionV1 {
	admit(input: {
		readonly requestRef: string;
		readonly wireRequestBytes: number;
		readonly maxOutputTokens: number;
	}): boolean;
}

export interface OpenRouterResponsesMonotonicMeasurementV1 {
	readMs(): number;
}

export interface OpenRouterResponsesEmpiricalBindingConfigV1 {
	readonly frozen: FrozenEmpiricalCampaignManifestV1;
	readonly qualificationReport: EmpiricalTaskQualificationReportV1;
	readonly configurationRef: string;
	readonly routeQualification: OpenRouterRouteQualificationV1;
	readonly credential: OpenRouterResponsesCredentialCapabilityV1;
	readonly transport: OpenRouterResponsesByteTransportV1;
	readonly transportAdmission: OpenRouterResponsesTransportAdmissionV1;
	readonly monotonicMeasurement: OpenRouterResponsesMonotonicMeasurementV1;
}

export interface OpenRouterResponsesEmpiricalBindingV1 {
	readonly modelTurnPort: EmpiricalModelTurnPortV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
	readonly configurationRef: string;
	readonly routeQualificationDigest: string;
	readonly credentialBindingRef: string;
	readonly credentialBindingRevision: string;
}

interface ValidatedBindingConfig {
	readonly frozen: FrozenEmpiricalCampaignManifestV1;
	readonly qualificationReport: EmpiricalTaskQualificationReportV1;
	readonly configuration: EmpiricalModelConfigurationV1;
	readonly route: QualifiedOpenRouterRouteV1;
	readonly credentialBindingRef: string;
	readonly credentialBindingRevision: string;
	readonly bearerToken: string;
	readonly transportRequest: OpenRouterResponsesByteTransportV1["request"];
	readonly admitTransport: OpenRouterResponsesTransportAdmissionV1["admit"];
	readonly readMs: OpenRouterResponsesMonotonicMeasurementV1["readMs"];
}

type RuntimeBindingConfig = ValidatedBindingConfig & {
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
};

interface ParsedCandidate {
	readonly structuredOutput: StrictJsonValue | null;
	readonly toolIntents: readonly EmpiricalModelToolIntentV1[];
	readonly finishReason: "structured-output" | "tool-intents";
	readonly usage: {
		readonly inputTokens: number;
		readonly outputTokens: number;
		readonly totalTokens: number;
		readonly providerCostMicrousd: number;
	};
	readonly responseId: string;
	readonly routeEvidence: StrictJsonValue;
	readonly rawProtectionSubject: StrictJsonValue;
}

interface ProviderUsageAccounting {
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
	readonly totalTokens: number | null;
	readonly providerCostMicrousd: number | null;
}

interface PreparedOpenRouterRequest {
	readonly body: Uint8Array;
	readonly userEnvelope: StrictJsonValue;
	readonly finalStep: boolean;
	readonly terminalReady: boolean;
	readonly toolContinuationRequired: boolean;
}

interface OpenRouterToolBinding {
	readonly providerName: string;
	readonly description: string | null;
	readonly tool: EmpiricalModelTurnRequestV1["availableTools"][number];
}

const CHAT_CLOSED_TOOL_SEMANTICS = new Map<
	string,
	{ readonly name: string; readonly description: string }
>([
	[
		"graphrefly.private-solution-eval.workspace.read-file.v1",
		{
			name: "workspace_read_file",
			description:
				"Read one allowed workspace file. Returns its bounded content and contentDigest for later exact mutation.",
		},
	],
	[
		"graphrefly.private-solution-eval.workspace.search-literal.v1",
		{
			name: "workspace_search_literal",
			description:
				"Find bounded literal matches in one allowed readable workspace file without changing it.",
		},
	],
	[
		"graphrefly.private-solution-eval.workspace.replace-exact.v1",
		{
			name: "workspace_replace_exact",
			description:
				"Modify one allowed writable file by replacing exactly one oldText occurrence. Use the latest read-file contentDigest as baseContentDigest.",
		},
	],
	[
		"graphrefly.private-solution-eval.workspace.diff.v1",
		{
			name: "workspace_diff",
			description:
				"Required immediately after a successful mutation and before further inspection or final output. Inspect the current bounded workspace diff.",
		},
	],
	[
		"graphrefly.private-solution-eval.workspace.run-command-ref.v1",
		{
			name: "workspace_run_command_ref",
			description:
				"Required after workspace diff and before final output for a workspace-change task. Run one preregistered verification command using an allowed commandRef from the task input.",
		},
	],
]);

function chatClosedToolDescription(
	tool: EmpiricalModelTurnRequestV1["availableTools"][number],
	fallback: string,
	exactD682HostDerivedToolSet: boolean,
): string {
	if (tool.toolRef !== "graphrefly.private-solution-eval.workspace.replace-exact.v1") {
		return fallback;
	}
	const isExactD682HostDerivedSchema =
		exactD682HostDerivedToolSet &&
		tool.schemaRevision === D682_HOST_DERIVED_REPLACE_SCHEMA_REVISION &&
		tool.inputSchemaDigest === empiricalStrictJsonDigest(tool.inputSchema) &&
		tool.inputSchema.kind === "object" &&
		tool.inputSchema.additionalProperties === false &&
		tool.inputSchema.properties.length === 3 &&
		tool.inputSchema.properties.every(
			(property, index) =>
				property.required &&
				property.shape.kind === "string" &&
				property.name === ["newText", "oldText", "path"][index],
		);
	return isExactD682HostDerivedSchema
		? "Modify one allowed writable file by replacing exactly one oldText occurrence. Provide exactly path, oldText, and newText; the sealed host binds the current file digest immediately before execution."
		: fallback;
}

function validateD682HostDerivedProviderToolSet(
	tools: EmpiricalModelTurnRequestV1["availableTools"],
	structuredInput: EmpiricalModelTurnRequestV1["structuredInput"],
): boolean {
	const d682Tools = tools.filter(
		(tool) => tool.schemaRevision === D682_HOST_DERIVED_REPLACE_SCHEMA_REVISION,
	);
	if (d682Tools.length === 0) return false;
	try {
		const searchSchema = d682Tools.find(
			(tool) => tool.toolRef === D682_HOST_DERIVED_TOOL_REFS.searchLiteral,
		)?.inputSchema;
		if (searchSchema?.kind !== "object") throw new TypeError("D682 search schema is missing");
		const maxMatchesShape = searchSchema.properties.find(
			(property) => property.name === "maxMatches",
		)?.shape;
		if (maxMatchesShape?.kind !== "integer") {
			throw new TypeError("D682 search maximum is missing");
		}
		const maxSearchMatches = safeInteger(
			maxMatchesShape.maximum,
			"openrouter.d682.maxSearchMatches",
			{ min: 1, max: 4_096 },
		);
		validateD682MechanicalToolContract({
			tools,
			actorInput: validateD682MechanicalActorInput(structuredInput),
			toolRefs: D682_HOST_DERIVED_TOOL_REFS,
			schemaRevision: D682_HOST_DERIVED_REPLACE_SCHEMA_REVISION,
			maxSearchMatches,
		});
		return true;
	} catch {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.rejected);
	}
}

function d682TerminalReady(request: EmpiricalModelTurnRequestV1): boolean {
	const latest = request.priorToolResults.at(-1);
	if (latest === undefined) return false;
	try {
		const result = record(latest.result, "openrouter.d682.latestToolResult");
		const progress = record(result.progress, "openrouter.d682.latestToolResult.progress");
		exactKeys(
			progress,
			["commandObserved", "diffObserved", "mutationObserved", "remainingActions", "remainingSteps"],
			"openrouter.d682.latestToolResult.progress",
		);
		if (
			typeof progress.commandObserved !== "boolean" ||
			typeof progress.diffObserved !== "boolean" ||
			typeof progress.mutationObserved !== "boolean"
		) {
			throw new TypeError("D682 progress flags must be booleans");
		}
		safeInteger(progress.remainingActions, "openrouter.d682.progress.remainingActions", {
			min: 0,
			max: 256,
		});
		safeInteger(progress.remainingSteps, "openrouter.d682.progress.remainingSteps", {
			min: 0,
			max: 256,
		});
		return progress.commandObserved && progress.diffObserved && progress.mutationObserved;
	} catch {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.rejected);
	}
}

class BindingFailure extends Error {
	readonly issueCode: OpenRouterResponsesIssueCode;
	readonly diagnosticCode: OpenRouterResponseDiagnosticCode | null;
	readonly detailDiagnosticCode: OpenRouterResponseDiagnosticCode | null;
	readonly providerUsage: ProviderUsageAccounting | null;

	constructor(
		issueCode: OpenRouterResponsesIssueCode,
		diagnosticCode: OpenRouterResponseDiagnosticCode | null = null,
		providerUsage: ProviderUsageAccounting | null = null,
		detailDiagnosticCode: OpenRouterResponseDiagnosticCode | null = null,
	) {
		super(issueCode);
		this.name = "BindingFailure";
		this.issueCode = issueCode;
		this.diagnosticCode = diagnosticCode;
		this.detailDiagnosticCode = detailDiagnosticCode;
		this.providerUsage = providerUsage;
	}
}

function invalidResponse(
	diagnosticCode: OpenRouterResponseDiagnosticCode,
	providerUsage: ProviderUsageAccounting | null = null,
	detailDiagnosticCode: OpenRouterResponseDiagnosticCode | null = null,
): never {
	throw new BindingFailure(
		OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
		diagnosticCode,
		providerUsage,
		detailDiagnosticCode,
	);
}

function invalidUsage(
	detailDiagnosticCode: OpenRouterResponseDiagnosticCode,
	providerUsage: ProviderUsageAccounting | null = null,
): never {
	return invalidResponse(
		OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.usageInvalid,
		providerUsage,
		detailDiagnosticCode,
	);
}

function withInvalidUsageDiagnostic<T>(
	detailDiagnosticCode: OpenRouterResponseDiagnosticCode,
	run: () => T,
	providerUsage: ProviderUsageAccounting | null = null,
): T {
	try {
		return run();
	} catch {
		return invalidUsage(detailDiagnosticCode, providerUsage);
	}
}

function withInvalidResponseDiagnostic<T>(
	diagnosticCode: OpenRouterResponseDiagnosticCode,
	run: () => T,
	providerUsage: ProviderUsageAccounting | null = null,
): T {
	try {
		return run();
	} catch (error) {
		if (
			error instanceof BindingFailure &&
			error.issueCode !== OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse
		) {
			throw error;
		}
		return invalidResponse(diagnosticCode, providerUsage);
	}
}

function bindingFailureIssueCodes(
	error: unknown,
	fallbackDiagnosticCode: OpenRouterResponseDiagnosticCode,
): readonly string[] {
	if (!(error instanceof BindingFailure)) {
		return [OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse, fallbackDiagnosticCode];
	}
	return error.diagnosticCode === null
		? [error.issueCode]
		: [
				error.issueCode,
				error.diagnosticCode,
				...(error.detailDiagnosticCode === null ? [] : [error.detailDiagnosticCode]),
			];
}

function transportFailureIssueCodes(error: unknown, signal: AbortSignal): readonly string[] {
	if (signal.aborted) {
		return [
			OPENROUTER_RESPONSES_ISSUE_CODES.unavailableTransport,
			OPENROUTER_RESPONSES_ISSUE_CODES.hostCancelled,
		];
	}
	const diagnostic = readOpenRouterTransportFailureDiagnostic(error);
	return diagnostic === null
		? [OPENROUTER_RESPONSES_ISSUE_CODES.unavailableTransport]
		: [
				OPENROUTER_RESPONSES_ISSUE_CODES.unavailableTransport,
				`openrouter-transport-phase:${diagnostic.phase}`,
				`openrouter-transport-cause:${diagnostic.causeCode}`,
			];
}

function measuredTransportFailureOutcome(
	config: RuntimeBindingConfig,
	request: EmpiricalModelTurnRequestV1,
	issues: readonly string[],
	startedAtMs: number,
	hostInputBytes: number,
): EmpiricalModelTurnOutcomeV1 {
	try {
		return failureOutcome(
			config,
			request,
			issues,
			1,
			hostInputBytes,
			elapsedMeasurementMs(config.readMs, startedAtMs),
		);
	} catch {
		return failureOutcome(
			config,
			request,
			[...issues, OPENROUTER_RESPONSES_ISSUE_CODES.measurementInvalid],
			1,
			hostInputBytes,
			0,
		);
	}
}

function ownFunction<T extends (...args: never[]) => unknown>(
	value: unknown,
	key: string,
	path: string,
): T {
	const capability = record(value, path);
	exactKeys(capability, [key], path);
	const descriptor = Object.getOwnPropertyDescriptor(capability, key);
	if (descriptor === undefined || "get" in descriptor || "set" in descriptor) {
		throw new TypeError(`${path}.${key} must be an own data property`);
	}
	if (typeof descriptor.value !== "function") {
		throw new TypeError(`${path}.${key} must be a function`);
	}
	return descriptor.value as T;
}

function validateBearerToken(value: unknown): string {
	if (
		typeof value !== "string" ||
		value.length < MIN_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS ||
		value.length > MAX_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS
	) {
		throw new TypeError("invalid bearer credential");
	}
	return value;
}

function assertOpenRouterName(value: string): string {
	if (!OPENROUTER_NAME.test(value))
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.rejected);
	return value;
}

function providerToolBindings(
	tools: EmpiricalModelTurnRequestV1["availableTools"],
	endpoint: OpenRouterEndpointV1,
	structuredInput: EmpiricalModelTurnRequestV1["structuredInput"],
): readonly OpenRouterToolBinding[] {
	const exactD682HostDerivedToolSet =
		endpoint === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT
			? validateD682HostDerivedProviderToolSet(tools, structuredInput)
			: false;
	const bindings = tools.map((tool, index) => {
		const chatSemantic =
			endpoint === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT
				? CHAT_CLOSED_TOOL_SEMANTICS.get(tool.toolRef)
				: undefined;
		const providerName =
			chatSemantic?.name ??
			(OPENROUTER_NAME.test(tool.toolRef)
				? tool.toolRef
				: `grf_tool_${index}_${empiricalStrictJsonDigest({
						toolRef: tool.toolRef,
						schemaRevision: tool.schemaRevision,
						inputSchemaDigest: tool.inputSchemaDigest,
					}).slice("sha256:".length, "sha256:".length + 24)}`);
		return {
			providerName: assertOpenRouterName(providerName),
			description:
				chatSemantic === undefined
					? null
					: chatClosedToolDescription(tool, chatSemantic.description, exactD682HostDerivedToolSet),
			tool,
		};
	});
	if (new Set(bindings.map((binding) => binding.providerName)).size !== bindings.length) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.rejected);
	}
	return bindings;
}

function providerOutputName(output: EmpiricalModelTurnRequestV1["outputSchema"]): string {
	return assertOpenRouterName(
		OPENROUTER_NAME.test(output.schemaRef)
			? output.schemaRef
			: `grf_output_${empiricalStrictJsonDigest({
					schemaRef: output.schemaRef,
					schemaRevision: output.schemaRevision,
					schemaDigest: output.schemaDigest,
				}).slice("sha256:".length, "sha256:".length + 24)}`,
	);
}

function assertOpenRouterConfiguration(configuration: EmpiricalModelConfigurationV1): void {
	const chatCompletions = configuration.endpoint === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT;
	const deepSeekChatCompletions =
		chatCompletions && configuration.model === OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL;
	const expected = {
		providerFamily: "openrouter",
		provider: "openrouter",
		promptRevision: chatCompletions
			? OPENROUTER_CHAT_COMPLETIONS_PROMPT_REVISION
			: OPENROUTER_RESPONSES_PROMPT_REVISION,
		systemPromptRevision: chatCompletions
			? deepSeekChatCompletions
				? OPENROUTER_DEEPSEEK_CHAT_COMPLETIONS_SYSTEM_PROMPT_REVISION
				: OPENROUTER_CHAT_COMPLETIONS_SYSTEM_PROMPT_REVISION
			: OPENROUTER_RESPONSES_SYSTEM_PROMPT_REVISION,
	} as const;
	for (const [key, expectedValue] of Object.entries(expected)) {
		if (configuration[key as keyof EmpiricalModelConfigurationV1] !== expectedValue) {
			throw new TypeError(`configuration.${key} does not match D669`);
		}
	}
	const reasoningEffort = configuration.settings.reasoning.effort;
	if (
		configuration.capabilities.toolCalling !== true ||
		configuration.capabilities.structuredOutput !== true ||
		configuration.capabilities.reasoningControl !== true ||
		configuration.capabilities.seed !== false ||
		configuration.capabilities.providerUsage !== true ||
		configuration.settings.sampling.temperature !== null ||
		configuration.settings.sampling.topP !== null ||
		configuration.settings.sampling.seed !== null ||
		configuration.settings.reasoning.mode !== "provider-native" ||
		(reasoningEffort !== "medium" && reasoningEffort !== "high") ||
		configuration.settings.output.format !== "strict-json" ||
		configuration.settings.tools.enabled !== true
	) {
		throw new TypeError("configuration capabilities/settings do not match D669");
	}
}

function validateBindingConfig(
	value: OpenRouterResponsesEmpiricalBindingConfigV1,
): ValidatedBindingConfig {
	const config = record(value, "binding");
	exactKeys(
		config,
		[
			"configurationRef",
			"credential",
			"frozen",
			"monotonicMeasurement",
			"qualificationReport",
			"routeQualification",
			"transport",
			"transportAdmission",
		],
		"binding",
	);
	const frozen = validateFrozenEmpiricalCampaignManifest(
		config.frozen as FrozenEmpiricalCampaignManifestV1,
		config.qualificationReport as EmpiricalTaskQualificationReportV1,
	);
	const qualificationReport = config.qualificationReport as EmpiricalTaskQualificationReportV1;
	const configurationRef = coordinate(config.configurationRef, "binding.configurationRef");
	const configuration = frozen.manifest.modelConfigurations.find(
		(entry) => entry.configurationRef === configurationRef,
	);
	if (configuration === undefined) throw new TypeError("binding configuration is not frozen");
	assertOpenRouterConfiguration(configuration);

	const credential = record(config.credential, "binding.credential");
	exactKeys(
		credential,
		["bearerToken", "credentialBindingRef", "credentialBindingRevision"],
		"binding.credential",
	);
	const credentialBindingRef = coordinate(
		credential.credentialBindingRef,
		"binding.credential.credentialBindingRef",
	);
	const credentialBindingRevision = coordinate(
		credential.credentialBindingRevision,
		"binding.credential.credentialBindingRevision",
	);
	const bearerToken = validateBearerToken(credential.bearerToken);
	const route = validateOpenRouterRouteQualification(
		config.routeQualification,
		configuration,
		credentialBindingRef,
		credentialBindingRevision,
		frozen.manifest.campaignRef,
		frozen.manifestDigest,
	);
	let expectedCredentialBindingRef: string | null;
	let expectedCredentialBindingRevision: string | null;
	if (configuration.role === "actor") {
		expectedCredentialBindingRef = frozen.manifest.policies.actorCredentialBindingRef;
		expectedCredentialBindingRevision = frozen.manifest.policies.actorCredentialBindingRevision;
	} else {
		const rolePolicy =
			configuration.role === "auxiliary-judge"
				? frozen.manifest.policies.auxiliaryJudge
				: frozen.manifest.policies.semanticRedactor;
		expectedCredentialBindingRef = rolePolicy.credentialBindingRef;
		expectedCredentialBindingRevision = rolePolicy.credentialBindingRevision;
	}
	if (
		expectedCredentialBindingRef !== credentialBindingRef ||
		expectedCredentialBindingRevision !== credentialBindingRevision
	) {
		throw new TypeError("credential capability does not match the frozen role policy");
	}

	const transportRequest = ownFunction<OpenRouterResponsesByteTransportV1["request"]>(
		config.transport,
		"request",
		"binding.transport",
	);
	const admitTransport = ownFunction<OpenRouterResponsesTransportAdmissionV1["admit"]>(
		config.transportAdmission,
		"admit",
		"binding.transportAdmission",
	);
	const readMs = ownFunction<OpenRouterResponsesMonotonicMeasurementV1["readMs"]>(
		config.monotonicMeasurement,
		"readMs",
		"binding.monotonicMeasurement",
	);
	return {
		frozen,
		qualificationReport,
		configuration,
		route,
		credentialBindingRef,
		credentialBindingRevision,
		bearerToken,
		transportRequest,
		admitTransport,
		readMs,
	};
}

function lowerShape(shape: EmpiricalStrictJsonShapeV1): StrictJsonValue {
	if (shape.kind === "null" || shape.kind === "boolean") return { type: shape.kind };
	if (shape.kind === "number" || shape.kind === "integer") {
		return {
			type: shape.kind,
			...(shape.minimum === null ? {} : { minimum: shape.minimum }),
			...(shape.maximum === null ? {} : { maximum: shape.maximum }),
		};
	}
	if (shape.kind === "string") {
		return {
			type: "string",
			minLength: shape.minLength,
			maxLength: shape.maxLength,
			...(shape.enum === null ? {} : { enum: shape.enum }),
		};
	}
	if (shape.kind === "array") {
		return {
			type: "array",
			items: lowerShape(shape.items),
			minItems: shape.minItems,
			maxItems: shape.maxItems,
		};
	}
	if (shape.kind === "one-of") {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.rejected);
	}
	if (shape.kind !== "object") {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.rejected);
	}
	const properties: Record<string, StrictJsonValue> = {};
	const required: string[] = [];
	for (const property of shape.properties) {
		if (!property.required) throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.rejected);
		properties[property.name] = lowerShape(property.shape);
		required.push(property.name);
	}
	return {
		type: "object",
		properties,
		required,
		additionalProperties: false,
	};
}

function requestBody(
	request: EmpiricalModelTurnRequestV1,
	configuration: EmpiricalModelConfigurationV1,
	route: OpenRouterRouteQualificationV1,
	maxSteps: number,
): PreparedOpenRouterRequest {
	safeInteger(maxSteps, "openrouter.turn.maxSteps", { min: 1, max: 256 });
	if (request.stepIndex >= maxSteps) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.rejected);
	}
	const finalStep = request.stepIndex + 1 === maxSteps;
	const deepSeekEarlyCompletion =
		route.endpoint === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT &&
		route.requestModel === OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL;
	const toolBindings = providerToolBindings(
		request.availableTools,
		route.endpoint,
		request.structuredInput,
	);
	const providerNameByToolRef = new Map(
		toolBindings.map((binding) => [binding.tool.toolRef, binding.providerName]),
	);
	const priorToolResults = request.priorToolResults.map((result) => {
		const providerName = providerNameByToolRef.get(result.toolRef);
		if (providerName === undefined) {
			throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.rejected);
		}
		return {
			toolCallRef: result.toolCallRef,
			toolRef: providerName,
			result: result.result,
		};
	});
	const exactD682HostDerivedToolSet = deepSeekEarlyCompletion
		? validateD682HostDerivedProviderToolSet(request.availableTools, request.structuredInput)
		: false;
	const terminalReady = exactD682HostDerivedToolSet ? d682TerminalReady(request) : false;
	const toolContinuationRequired = exactD682HostDerivedToolSet && !finalStep && !terminalReady;
	const userEnvelope = strictSnapshot({
		schemaVersion: OPENROUTER_RESPONSES_USER_ENVELOPE_SCHEMA,
		turn: {
			stepIndex: request.stepIndex,
			maxSteps,
			finalStep,
		},
		structuredInput: request.structuredInput,
		priorToolResults,
	});
	const provider = {
		order: [route.downstreamProviderSlug],
		only: [route.downstreamProviderSlug],
		allow_fallbacks: false,
		require_parameters: true,
	};
	const toolChoice =
		request.availableTools.length === 0 || finalStep || terminalReady
			? "none"
			: toolContinuationRequired
				? "required"
				: deepSeekEarlyCompletion && request.priorToolResults.length > 0
					? "auto"
					: configuration.settings.tools.choice;
	const outputName = providerOutputName(request.outputSchema);
	const outputShape = lowerShape(request.outputSchema.schema);
	const encodedEnvelope = decoder.decode(strictJsonCodec.encode(userEnvelope));
	const body =
		route.endpoint === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT
			? {
					model: route.requestModel,
					provider,
					messages: [
						{
							role: "system",
							content: deepSeekEarlyCompletion
								? OPENROUTER_DEEPSEEK_CHAT_COMPLETIONS_SYSTEM_INSTRUCTIONS
								: OPENROUTER_CHAT_COMPLETIONS_SYSTEM_INSTRUCTIONS,
						},
						{ role: "user", content: encodedEnvelope },
					],
					stream: false,
					max_tokens: request.remainingTurnBudget.maxOutputTokens,
					reasoning: { effort: configuration.settings.reasoning.effort },
					...(finalStep ||
					terminalReady ||
					(deepSeekEarlyCompletion &&
						!exactD682HostDerivedToolSet &&
						request.priorToolResults.length > 0)
						? {
								response_format: {
									type: "json_schema",
									json_schema: {
										name: outputName,
										strict: true,
										schema: outputShape,
									},
								},
							}
						: {}),
					tools: toolBindings.map(({ providerName, description, tool }) => ({
						type: "function",
						function: {
							name: providerName,
							...(description === null ? {} : { description }),
							strict: true,
							parameters: lowerShape(tool.inputSchema),
						},
					})),
					tool_choice: toolChoice,
				}
			: {
					model: route.requestModel,
					provider,
					instructions: OPENROUTER_RESPONSES_SYSTEM_INSTRUCTIONS,
					input: encodedEnvelope,
					store: false,
					background: false,
					stream: false,
					truncation: "disabled",
					service_tier: "default",
					max_output_tokens: request.remainingTurnBudget.maxOutputTokens,
					reasoning: { effort: configuration.settings.reasoning.effort },
					text: {
						format: {
							type: "json_schema",
							name: outputName,
							strict: true,
							schema: outputShape,
						},
					},
					tools: toolBindings.map(({ providerName, tool }) => ({
						type: "function",
						name: providerName,
						strict: true,
						parameters: lowerShape(tool.inputSchema),
					})),
					tool_choice: toolChoice,
				};
	const bytes = strictJsonCodec.encode(body);
	if (bytes.byteLength > MAX_EMPIRICAL_MODEL_TURN_REQUEST_BYTES) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.rejected);
	}
	return { body: bytes, userEnvelope, finalStep, terminalReady, toolContinuationRequired };
}

function assertNoDuplicateJsonObjectKeys(text: string): void {
	let index = 0;
	const fail = (): never => {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
	};
	const skipWhitespace = (): void => {
		while (/\s/.test(text[index] ?? "")) index += 1;
	};
	const readString = (): string => {
		const start = index;
		index += 1;
		while (index < text.length) {
			const character = text[index];
			if (character === '"') {
				index += 1;
				try {
					return JSON.parse(text.slice(start, index)) as string;
				} catch {
					return fail();
				}
			}
			if (character === "\\") index += 1;
			index += 1;
		}
		return fail();
	};
	const consume = (literal: string): void => {
		if (text.slice(index, index + literal.length) !== literal) fail();
		index += literal.length;
	};
	const parseValue = (path: string): void => {
		skipWhitespace();
		const character = text[index];
		if (character === "{") {
			parseObject(path);
			return;
		}
		if (character === "[") {
			parseArray(path);
			return;
		}
		if (character === '"') {
			readString();
			return;
		}
		if (character === "t") {
			consume("true");
			return;
		}
		if (character === "f") {
			consume("false");
			return;
		}
		if (character === "n") {
			consume("null");
			return;
		}
		if (character === "-" || (character !== undefined && character >= "0" && character <= "9")) {
			const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(index));
			const numberText = match?.[0];
			if (numberText === undefined) {
				throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
			}
			index += numberText.length;
			return;
		}
		fail();
	};
	const parseObject = (path: string): void => {
		const keys = new Set<string>();
		index += 1;
		skipWhitespace();
		if (text[index] === "}") {
			index += 1;
			return;
		}
		while (index < text.length) {
			skipWhitespace();
			if (text[index] !== '"') fail();
			const key = readString();
			if (keys.has(key)) fail();
			keys.add(key);
			skipWhitespace();
			if (text[index] !== ":") fail();
			index += 1;
			parseValue(`${path}.${key}`);
			skipWhitespace();
			if (text[index] === ",") {
				index += 1;
				continue;
			}
			if (text[index] === "}") {
				index += 1;
				return;
			}
			fail();
		}
		fail();
	};
	const parseArray = (path: string): void => {
		index += 1;
		skipWhitespace();
		if (text[index] === "]") {
			index += 1;
			return;
		}
		let item = 0;
		while (index < text.length) {
			parseValue(`${path}[${item}]`);
			item += 1;
			skipWhitespace();
			if (text[index] === ",") {
				index += 1;
				continue;
			}
			if (text[index] === "]") {
				index += 1;
				return;
			}
			fail();
		}
		fail();
	};
	parseValue("$");
	skipWhitespace();
	if (index !== text.length) fail();
}

function parseStrictJsonText(text: string): StrictJsonValue {
	assertNoDuplicateJsonObjectKeys(text);
	try {
		return strictSnapshot(JSON.parse(text) as StrictJsonValue);
	} catch {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
	}
}

function boundedProviderString(value: unknown, maxLength = 32_768): string {
	try {
		return string(value, "provider.response", maxLength);
	} catch {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
	}
}

function providerRecord(value: unknown): Record<string, unknown> {
	try {
		return record(value, "provider.response");
	} catch {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
	}
}

function providerArray(value: unknown): readonly unknown[] {
	try {
		return array(value, "provider.response");
	} catch {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
	}
}

function providerTokenCount(value: unknown): number {
	try {
		return safeInteger(value, "provider.response.usage", { max: 1_000_000_000 });
	} catch {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
	}
}

function providerCostMicrousd(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
	}
	const roundedUpMicrousd = Math.ceil(value * 1_000_000);
	if (!Number.isSafeInteger(roundedUpMicrousd) || roundedUpMicrousd > 1_000_000_000_000) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
	}
	return roundedUpMicrousd;
}

function routeRecord(value: unknown): Record<string, unknown> {
	try {
		return record(value, "provider.response.openrouter_metadata");
	} catch {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.routingMismatch);
	}
}

function routeArray(value: unknown): readonly unknown[] {
	try {
		return array(value, "provider.response.openrouter_metadata");
	} catch {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.routingMismatch);
	}
}

function assertClosedRouteKeys(
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[] = [],
): void {
	const allowed = new Set([...required, ...optional]);
	const keys = Object.keys(value);
	if (required.some((key) => !Object.hasOwn(value, key)) || keys.some((key) => !allowed.has(key))) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.routingMismatch);
	}
}

function selectedRouteModel(value: unknown, route: OpenRouterRouteQualificationV1): string {
	if (typeof value !== "string" || value.length > 512) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.routingMismatch);
	}
	if (value === route.requestModel) return value;
	if (
		route.requestModel === OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL &&
		value === OPENROUTER_DEEPSEEK_V4_FLASH_SELECTED_MODEL
	) {
		return value;
	}
	if (
		route.modelIdentityKind !== "alias-disclosed" ||
		!value.startsWith(`${route.requestModel}-`) ||
		!/^\d{8}$/.test(value.slice(route.requestModel.length + 1))
	) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.routingMismatch);
	}
	return value;
}

function validateDirectRouteEvidence(
	root: Record<string, unknown>,
	route: OpenRouterRouteQualificationV1,
): StrictJsonValue {
	const metadata = routeRecord(root.openrouter_metadata);
	assertClosedRouteKeys(
		metadata,
		["attempt", "endpoints", "is_byok", "requested", "strategy"],
		["attempts", "pipeline", "region", "summary"],
	);
	if (
		metadata.requested !== route.requestModel ||
		metadata.strategy !== "direct" ||
		metadata.attempt !== 1 ||
		metadata.is_byok !== false
	) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.routingMismatch);
	}
	if (
		(metadata.region !== undefined &&
			metadata.region !== null &&
			(typeof metadata.region !== "string" || metadata.region.length > 256)) ||
		(metadata.summary !== undefined &&
			(typeof metadata.summary !== "string" || metadata.summary.length > 1_024))
	) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.routingMismatch);
	}
	const endpoints = routeRecord(metadata.endpoints);
	assertClosedRouteKeys(endpoints, ["available", "total"]);
	if (
		!Number.isSafeInteger(endpoints.total) ||
		(endpoints.total as number) < 1 ||
		(endpoints.total as number) > 1_024
	) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.routingMismatch);
	}
	const available = routeArray(endpoints.available);
	if (available.length !== 1) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.routingMismatch);
	}
	const selected = routeRecord(available[0]);
	assertClosedRouteKeys(selected, ["model", "provider", "selected"]);
	const selectedModel = selectedRouteModel(selected.model, route);
	if (selected.provider !== route.downstreamProviderName || selected.selected !== true) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.routingMismatch);
	}
	if (metadata.attempts !== undefined) {
		const attempts = routeArray(metadata.attempts);
		if (attempts.length !== 1) {
			throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.routingMismatch);
		}
		const attempt = routeRecord(attempts[0]);
		assertClosedRouteKeys(attempt, ["model", "provider", "status"]);
		const attemptModel = selectedRouteModel(attempt.model, route);
		if (
			attempt.provider !== route.downstreamProviderName ||
			attemptModel !== selectedModel ||
			attempt.status !== 200
		) {
			throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.routingMismatch);
		}
	}
	if (metadata.pipeline !== undefined && routeArray(metadata.pipeline).length !== 0) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.routingMismatch);
	}
	return strictSnapshot({
		requested: route.requestModel,
		strategy: "direct",
		attempt: 1,
		isByok: false,
		selectedProvider: route.downstreamProviderName,
		selectedModel,
	});
}

function parseResponsesCandidate(
	bytes: Uint8Array,
	request: EmpiricalModelTurnRequestV1,
	route: OpenRouterRouteQualificationV1,
): ParsedCandidate {
	let text: string;
	try {
		text = decoder.decode(bytes);
	} catch {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
	}
	const root = providerRecord(parseStrictJsonText(text));
	if (root.object !== "response" || root.status !== "completed") {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.rejected);
	}
	if (root.model !== route.requestModel) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
	}
	const routeEvidence = validateDirectRouteEvidence(root, route);
	const responseId = boundedProviderString(root.id, 256);
	const usageRecord = providerRecord(root.usage);
	const usage = {
		inputTokens: providerTokenCount(usageRecord.input_tokens),
		outputTokens: providerTokenCount(usageRecord.output_tokens),
		totalTokens: providerTokenCount(usageRecord.total_tokens),
		providerCostMicrousd: providerCostMicrousd(usageRecord.cost),
	};
	let messageItemCount = 0;
	const messageTexts: string[] = [];
	const rawCalls: { callId: string; name: string; argumentsText: string }[] = [];
	for (const outputItem of providerArray(root.output)) {
		const item = providerRecord(outputItem);
		if (item.type === "reasoning") continue;
		if (item.type === "message") {
			messageItemCount += 1;
			if (item.role !== "assistant" || item.status !== "completed") {
				throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
			}
			for (const contentItem of providerArray(item.content)) {
				const content = providerRecord(contentItem);
				if (content.type === "refusal") {
					throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.rejected);
				}
				if (content.type !== "output_text") {
					throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
				}
				messageTexts.push(boundedProviderString(content.text));
			}
			continue;
		}
		if (item.type === "function_call") {
			if (item.status !== undefined && item.status !== "completed") {
				throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
			}
			rawCalls.push({
				callId: boundedProviderString(item.call_id, 256),
				name: boundedProviderString(item.name, 64),
				argumentsText: boundedProviderString(item.arguments),
			});
			continue;
		}
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
	}
	const structuredOutputCandidate =
		messageItemCount === 1 && messageTexts.length === 1 && rawCalls.length === 0;
	const toolIntentCandidate =
		messageItemCount === 0 && messageTexts.length === 0 && rawCalls.length > 0;
	if (!structuredOutputCandidate && !toolIntentCandidate) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
	}
	if (structuredOutputCandidate) {
		const outputText = messageTexts[0] as string;
		return {
			structuredOutput: parseStrictJsonText(outputText),
			toolIntents: [],
			finishReason: "structured-output",
			usage,
			responseId,
			routeEvidence,
			rawProtectionSubject: {
				kind: "openrouter-output-text",
				responseId,
				text: outputText,
			},
		};
	}
	const toolsByProviderName = new Map(
		providerToolBindings(request.availableTools, route.endpoint, request.structuredInput).map(
			(binding) => [binding.providerName, binding.tool],
		),
	);
	const toolIntents = rawCalls.map((call) => {
		const tool = toolsByProviderName.get(call.name);
		if (tool === undefined) {
			throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
		}
		let toolCallRef: string;
		try {
			toolCallRef = coordinate(call.callId, "provider.response.call_id");
		} catch {
			throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
		}
		const argumentsValue = parseStrictJsonText(call.argumentsText);
		return {
			toolCallRef,
			toolRef: tool.toolRef,
			argumentsDigest: empiricalStrictJsonDigest(argumentsValue),
			arguments: argumentsValue,
		};
	});
	return {
		structuredOutput: null,
		toolIntents,
		finishReason: "tool-intents",
		usage,
		responseId,
		routeEvidence,
		rawProtectionSubject: {
			kind: "openrouter-function-calls",
			responseId,
			calls: rawCalls.map((call) => ({
				callId: call.callId,
				name: call.name,
				arguments: call.argumentsText,
			})),
		},
	};
}

function parseChatCompletionsCandidate(
	bytes: Uint8Array,
	request: EmpiricalModelTurnRequestV1,
	route: OpenRouterRouteQualificationV1,
): ParsedCandidate {
	let text: string;
	try {
		text = decoder.decode(bytes);
	} catch {
		return invalidResponse(OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.envelopeInvalid);
	}
	const root = withInvalidResponseDiagnostic(
		OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.envelopeInvalid,
		() => providerRecord(parseStrictJsonText(text)),
	);
	if (root.object !== "chat.completion" || root.model !== route.requestModel) {
		return invalidResponse(OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.envelopeInvalid);
	}
	const routeEvidence = validateDirectRouteEvidence(root, route);
	const responseId = withInvalidResponseDiagnostic(
		OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.envelopeInvalid,
		() => boundedProviderString(root.id, 256),
	);
	const usageRecord = withInvalidUsageDiagnostic(
		OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.usageEnvelopeInvalid,
		() => providerRecord(root.usage),
	);
	const inputTokens = withInvalidUsageDiagnostic(
		OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.usagePromptTokensInvalid,
		() => providerTokenCount(usageRecord.prompt_tokens),
	);
	const inputUsage: ProviderUsageAccounting = {
		inputTokens,
		outputTokens: null,
		totalTokens: null,
		providerCostMicrousd: null,
	};
	const outputTokens = withInvalidUsageDiagnostic(
		OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.usageCompletionTokensInvalid,
		() => providerTokenCount(usageRecord.completion_tokens),
		inputUsage,
	);
	const outputUsage: ProviderUsageAccounting = {
		...inputUsage,
		outputTokens,
	};
	const totalTokens = withInvalidUsageDiagnostic(
		OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.usageTotalTokensInvalid,
		() => providerTokenCount(usageRecord.total_tokens),
		outputUsage,
	);
	const tokenUsage: ProviderUsageAccounting = {
		...outputUsage,
		totalTokens,
	};
	const providerCost = withInvalidUsageDiagnostic(
		OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.usageCostInvalid,
		() => providerCostMicrousd(usageRecord.cost),
		tokenUsage,
	);
	const usage = {
		inputTokens,
		outputTokens,
		totalTokens,
		providerCostMicrousd: providerCost,
	};
	if (inputTokens + outputTokens !== totalTokens) {
		return invalidUsage(OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.usageTotalTokensMismatch, usage);
	}
	const completionTokenDetails = usageRecord.completion_tokens_details;
	if (completionTokenDetails !== undefined && completionTokenDetails !== null) {
		const details = withInvalidUsageDiagnostic(
			OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.usageReasoningDetailsInvalid,
			() => providerRecord(completionTokenDetails),
			usage,
		);
		if (details.reasoning_tokens !== undefined) {
			withInvalidUsageDiagnostic(
				OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.usageReasoningTokensInvalid,
				() => providerTokenCount(details.reasoning_tokens),
				usage,
			);
		}
	}
	const choices = withInvalidResponseDiagnostic(
		OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.choiceCountInvalid,
		() => providerArray(root.choices),
		usage,
	);
	if (choices.length !== 1) {
		return invalidResponse(OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.choiceCountInvalid, usage);
	}
	const choice = withInvalidResponseDiagnostic(
		OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.messageInvalid,
		() => providerRecord(choices[0]),
		usage,
	);
	if (choice.index !== 0) {
		return invalidResponse(OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.messageInvalid, usage);
	}
	const message = withInvalidResponseDiagnostic(
		OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.messageInvalid,
		() => providerRecord(choice.message),
		usage,
	);
	if (message.role !== "assistant") {
		return invalidResponse(OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.messageInvalid, usage);
	}
	if (message.refusal !== undefined && message.refusal !== null) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.rejected, null, usage);
	}
	if (choice.finish_reason === "stop") {
		const toolCalls =
			message.tool_calls === undefined
				? []
				: withInvalidResponseDiagnostic(
						OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.finishContentConflict,
						() => providerArray(message.tool_calls),
						usage,
					);
		if (toolCalls.length !== 0) {
			return invalidResponse(OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.finishContentConflict, usage);
		}
		const outputText = withInvalidResponseDiagnostic(
			OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.messageInvalid,
			() => boundedProviderString(message.content),
			usage,
		);
		let structuredOutput: StrictJsonValue;
		try {
			structuredOutput = parseStrictJsonText(outputText);
		} catch {
			return invalidResponse(
				OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.postParseValidationFailed,
				usage,
				OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.outputJsonInvalid,
			);
		}
		return {
			structuredOutput,
			toolIntents: [],
			finishReason: "structured-output",
			usage,
			responseId,
			routeEvidence,
			rawProtectionSubject: {
				kind: "openrouter-output-text",
				responseId,
				text: outputText,
			},
		};
	}
	if (choice.finish_reason !== "tool_calls") {
		return invalidResponse(OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.finishReasonInvalid, usage);
	}
	const auxiliaryToolCallContent =
		message.content === null || message.content === ""
			? null
			: route.requestModel === OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL
				? withInvalidResponseDiagnostic(
						OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.messageInvalid,
						() => boundedProviderString(message.content),
						usage,
					)
				: null;
	if (
		message.content !== null &&
		message.content !== "" &&
		route.requestModel !== OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL
	) {
		return invalidResponse(OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.finishContentConflict, usage);
	}
	const rawCallValues = withInvalidResponseDiagnostic(
		OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.toolCallMalformed,
		() => providerArray(message.tool_calls),
		usage,
	);
	if (rawCallValues.length === 0) {
		return invalidResponse(OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.toolCallCountZero, usage);
	}
	const rawCalls = withInvalidResponseDiagnostic(
		OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.toolCallMalformed,
		() =>
			rawCallValues.map((callValue) => {
				const call = providerRecord(callValue);
				const fn = providerRecord(call.function);
				if (call.type !== "function") {
					return invalidResponse(OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.toolCallMalformed);
				}
				return {
					callId: boundedProviderString(call.id, 256),
					name: boundedProviderString(fn.name, 64),
					argumentsText: boundedProviderString(fn.arguments),
				};
			}),
		usage,
	);
	const toolsByProviderName = new Map(
		providerToolBindings(request.availableTools, route.endpoint, request.structuredInput).map(
			(binding) => [binding.providerName, binding.tool],
		),
	);
	const toolIntents = rawCalls.map((call) => {
		const tool = toolsByProviderName.get(call.name);
		if (tool === undefined) {
			return invalidResponse(OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.toolNameUnknown, usage);
		}
		let toolCallRef: string;
		try {
			toolCallRef = coordinate(call.callId, "provider.response.call_id");
		} catch {
			return invalidResponse(OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.toolCallIdInvalid, usage);
		}
		const argumentsValue = withInvalidResponseDiagnostic(
			OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.toolArgumentsInvalid,
			() => parseStrictJsonText(call.argumentsText),
			usage,
		);
		return {
			toolCallRef,
			toolRef: tool.toolRef,
			argumentsDigest: empiricalStrictJsonDigest(argumentsValue),
			arguments: argumentsValue,
		};
	});
	return {
		structuredOutput: null,
		toolIntents,
		finishReason: "tool-intents",
		usage,
		responseId,
		routeEvidence,
		rawProtectionSubject: {
			kind: "openrouter-function-calls",
			responseId,
			...(auxiliaryToolCallContent === null ? {} : { auxiliaryContent: auxiliaryToolCallContent }),
			calls: rawCalls.map((call) => ({
				callId: call.callId,
				name: call.name,
				arguments: call.argumentsText,
			})),
		},
	};
}

function parseCandidate(
	bytes: Uint8Array,
	request: EmpiricalModelTurnRequestV1,
	route: OpenRouterRouteQualificationV1,
): ParsedCandidate {
	return route.endpoint === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT
		? parseChatCompletionsCandidate(bytes, request, route)
		: parseResponsesCandidate(bytes, request, route);
}

function issueForStatus(status: number): OpenRouterResponsesIssueCode {
	if (status === 401 || status === 403)
		return OPENROUTER_RESPONSES_ISSUE_CODES.authenticationPermission;
	if (status === 402 || status === 429) return OPENROUTER_RESPONSES_ISSUE_CODES.quotaRateLimit;
	if (status === 408 || status === 409 || status >= 500) {
		return OPENROUTER_RESPONSES_ISSUE_CODES.unavailableTransport;
	}
	return OPENROUTER_RESPONSES_ISSUE_CODES.rejected;
}

function diagnosticHttpStatus(status: number): string {
	return `openrouter-http-status:${status}`;
}

function diagnosticErrorType(errorType: string): string {
	switch (errorType) {
		case "authentication":
		case "permission_denied":
		case "payment_required":
		case "rate_limit_exceeded":
		case "provider_overloaded":
		case "provider_unavailable":
		case "timeout":
		case "server":
		case "context_length_exceeded":
		case "content_policy_violation":
		case "invalid_prompt":
		case "invalid_request":
		case "not_found":
		case "payload_too_large":
		case "precondition_failed":
		case "refusal":
		case "unmapped":
		case "unprocessable":
			return `openrouter-error-type:${errorType}`;
		default:
			return "openrouter-error-type:unrecognized";
	}
}

function diagnosticErrorCode(root: Record<string, unknown>): string | null {
	if (root.error === undefined) return null;
	let code: unknown;
	try {
		code = providerRecord(root.error).code;
	} catch {
		return "openrouter-error-code:unrecognized";
	}
	if (code === undefined || typeof code === "number") return null;
	if (typeof code !== "string") return "openrouter-error-code:unrecognized";
	switch (code) {
		case "image_content_policy_violation":
		case "invalid_prompt":
		case "rate_limit_exceeded":
		case "server_error":
			return `openrouter-error-code:${code}`;
		default:
			return "openrouter-error-code:unrecognized";
	}
}

function errorTypeFromResponse(root: Record<string, unknown>): unknown {
	if (root.error_type !== undefined) return root.error_type;
	if (root.error === undefined) return undefined;
	const error = providerRecord(root.error);
	if (error.metadata === undefined) return undefined;
	return providerRecord(error.metadata).error_type;
}

function issuesForErrorResponse(
	status: number,
	bytes: Uint8Array,
	retryAfterMs: number | null,
): readonly string[] {
	const statusDiagnostic = diagnosticHttpStatus(status);
	const retryAfterDiagnostic =
		retryAfterMs === null ? [] : [`openrouter-retry-after-ms:${retryAfterMs}`];
	let text: string;
	try {
		text = decoder.decode(bytes);
	} catch {
		return [
			OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
			statusDiagnostic,
			...retryAfterDiagnostic,
		];
	}
	if (!text.trimStart().startsWith("{")) {
		return [issueForStatus(status), statusDiagnostic, ...retryAfterDiagnostic];
	}
	let errorType: string;
	let errorCodeDiagnostic: string | null;
	try {
		const root = providerRecord(parseStrictJsonText(text));
		errorCodeDiagnostic = diagnosticErrorCode(root);
		const rawErrorType = errorTypeFromResponse(root);
		if (rawErrorType === undefined) {
			return [
				issueForStatus(status),
				statusDiagnostic,
				...(errorCodeDiagnostic === null ? [] : [errorCodeDiagnostic]),
				...retryAfterDiagnostic,
			];
		}
		errorType = boundedProviderString(rawErrorType, 64);
	} catch {
		return [
			OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
			statusDiagnostic,
			...retryAfterDiagnostic,
		];
	}
	let issueCode: OpenRouterResponsesIssueCode;
	if (errorType === "authentication" || errorType === "permission_denied") {
		issueCode = OPENROUTER_RESPONSES_ISSUE_CODES.authenticationPermission;
	} else if (errorType === "payment_required" || errorType === "rate_limit_exceeded") {
		issueCode = OPENROUTER_RESPONSES_ISSUE_CODES.quotaRateLimit;
	} else if (
		errorType === "provider_overloaded" ||
		errorType === "provider_unavailable" ||
		errorType === "timeout" ||
		errorType === "server"
	) {
		issueCode = OPENROUTER_RESPONSES_ISSUE_CODES.unavailableTransport;
	} else if (
		errorType === "context_length_exceeded" ||
		errorType === "content_policy_violation" ||
		errorType === "invalid_prompt" ||
		errorType === "invalid_request" ||
		errorType === "not_found" ||
		errorType === "payload_too_large" ||
		errorType === "precondition_failed" ||
		errorType === "refusal" ||
		errorType === "unmapped" ||
		errorType === "unprocessable"
	) {
		issueCode = OPENROUTER_RESPONSES_ISSUE_CODES.rejected;
	} else {
		issueCode = OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse;
	}
	return [
		issueCode,
		statusDiagnostic,
		diagnosticErrorType(errorType),
		...(errorCodeDiagnostic === null ? [] : [errorCodeDiagnostic]),
		...retryAfterDiagnostic,
	];
}

function readMeasurement(readMs: OpenRouterResponsesMonotonicMeasurementV1["readMs"]): number {
	const value = readMs();
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.measurementInvalid);
	}
	return value;
}

function elapsedMeasurementMs(
	readMs: OpenRouterResponsesMonotonicMeasurementV1["readMs"],
	startedAtMs: number,
): number {
	const finishedAtMs = readMeasurement(readMs);
	if (finishedAtMs < startedAtMs || finishedAtMs - startedAtMs > 86_400_000) {
		throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.measurementInvalid);
	}
	return finishedAtMs - startedAtMs;
}

function usage(
	request: EmpiricalModelTurnRequestV1,
	requests: 0 | 1,
	hostInputBytes: number,
	hostOutputBytes: number,
	providerUsage: ProviderUsageAccounting | null,
): EmpiricalModelTurnUsageV1 {
	return {
		source: request.usageSource,
		inputTokens: providerUsage?.inputTokens ?? null,
		outputTokens: providerUsage?.outputTokens ?? null,
		totalTokens: providerUsage?.totalTokens ?? null,
		providerCostMicrousd: providerUsage?.providerCostMicrousd ?? null,
		requests,
		hostInputBytes,
		hostOutputBytes,
	};
}

function validateOutcome(
	config: ValidatedBindingConfig,
	request: EmpiricalModelTurnRequestV1,
	value: unknown,
): EmpiricalModelTurnOutcomeV1 {
	return validateEmpiricalModelTurnOutcome(
		value,
		request,
		config.frozen,
		config.qualificationReport,
	);
}

function blockedCandidateOutcome(
	config: RuntimeBindingConfig,
	request: EmpiricalModelTurnRequestV1,
	protection: EmpiricalProtectionExecutionV1,
	turnUsage: EmpiricalModelTurnUsageV1,
	latencyMs: number,
): EmpiricalModelTurnOutcomeV1 {
	const issueCode =
		protection.issueCode === EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.failed
			? EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.failed
			: EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.blocked;
	return validateOutcome(config, request, {
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
		usage: turnUsage,
		latencyMs,
		issueCodes: [issueCode],
		evidenceRefs: [
			{
				kind: EMPIRICAL_MODEL_EGRESS_BLOCKED_SUBJECT_EVIDENCE_KIND,
				id: EMPIRICAL_MODEL_EGRESS_BLOCKED_SUBJECT_EVIDENCE_ID,
				digest: protection.subjectDigest,
			},
		],
		protectionReceipt: protection.receipt,
	});
}

function allowedOutcome(
	config: RuntimeBindingConfig,
	request: EmpiricalModelTurnRequestV1,
	input: {
		readonly status: "completed" | "non-evaluable";
		readonly finishReason: "structured-output" | "tool-intents" | null;
		readonly structuredOutput: StrictJsonValue | null;
		readonly toolIntents: readonly EmpiricalModelToolIntentV1[];
		readonly turnUsage: EmpiricalModelTurnUsageV1;
		readonly latencyMs: number;
		readonly issueCodes: readonly string[];
		readonly evidenceRefs: readonly EmpiricalModelTurnEvidenceRefV1[];
	},
): EmpiricalModelTurnOutcomeV1 {
	const egressMaterial = strictSnapshot({
		evidenceRefs: input.evidenceRefs.map((ref) => ({
			kind: ref.kind,
			id: ref.id,
			digest: ref.digest,
		})),
		issueCodes: [...input.issueCodes],
		structuredOutput: input.structuredOutput,
		toolIntents: input.toolIntents.map((intent) => ({
			toolCallRef: intent.toolCallRef,
			toolRef: intent.toolRef,
			argumentsDigest: intent.argumentsDigest,
			arguments: intent.arguments,
		})),
	});
	const protection = executeEmpiricalProtection(config.protectionExecutor, {
		policyRef: request.protectionPolicyRef,
		policyRevision: request.protectionPolicyRevision,
		stage: "model-egress",
		subject: egressMaterial,
	});
	if (protection.receipt.disposition === "blocked") {
		return blockedCandidateOutcome(config, request, protection, input.turnUsage, input.latencyMs);
	}
	return validateOutcome(config, request, {
		schemaVersion: EMPIRICAL_MODEL_EXECUTION_SCHEMAS.outcome,
		requestRef: request.requestRef,
		requestDigest: empiricalStrictJsonDigest(request),
		configurationRef: request.configurationRef,
		configurationDigest: request.configurationDigest,
		role: request.role,
		status: input.status,
		finishReason: input.finishReason,
		outputSchemaDigest: request.outputSchema.schemaDigest,
		structuredOutput: input.structuredOutput,
		structuredOutputDigest:
			input.structuredOutput === null ? null : empiricalStrictJsonDigest(input.structuredOutput),
		toolIntents: input.toolIntents,
		usage: input.turnUsage,
		latencyMs: input.latencyMs,
		issueCodes: input.issueCodes,
		evidenceRefs: input.evidenceRefs,
		protectionReceipt: protection.receipt,
	});
}

function failureOutcome(
	config: RuntimeBindingConfig,
	request: EmpiricalModelTurnRequestV1,
	issues: OpenRouterResponsesIssueCode | readonly string[],
	requests: 0 | 1,
	hostInputBytes: number,
	latencyMs: number,
	providerUsage: ProviderUsageAccounting | null = null,
): EmpiricalModelTurnOutcomeV1 {
	return allowedOutcome(config, request, {
		status: "non-evaluable",
		finishReason: null,
		structuredOutput: null,
		toolIntents: [],
		turnUsage: usage(request, requests, hostInputBytes, 0, providerUsage),
		latencyMs,
		issueCodes: typeof issues === "string" ? [issues] : issues,
		evidenceRefs: [],
	});
}

async function invokeOpenRouterResponses(
	config: RuntimeBindingConfig,
	requestValue: EmpiricalModelTurnRequestV1,
	signal: AbortSignal,
): Promise<EmpiricalModelTurnOutcomeV1> {
	if (signal.aborted) {
		throw new DOMException("model turn cancelled by host", "AbortError");
	}
	const request = validateEmpiricalModelTurnRequest(
		requestValue,
		config.frozen,
		config.qualificationReport,
	);
	if (
		request.campaignRef !== config.route.qualification.campaignRef ||
		request.manifestDigest !== config.route.qualification.manifestDigest ||
		request.trialBlockRef !== config.route.qualification.trialBlockRef ||
		request.trialBlockDigest !== config.route.qualification.trialBlockDigest ||
		request.configurationRef !== config.configuration.configurationRef ||
		request.credentialBindingRef !== config.credentialBindingRef ||
		request.credentialBindingRevision !== config.credentialBindingRevision
	) {
		throw new TypeError("OpenRouter Responses binding request coordinates do not match");
	}

	let preparedRequest: PreparedOpenRouterRequest;
	try {
		const agentRunBudget = config.frozen.manifest.budgets.agentRun;
		const maxSteps = Math.min(
			config.configuration.settings.tools.maxSteps,
			agentRunBudget.maxSteps,
			agentRunBudget.maxRequests,
			config.route.qualification.budget.maxStepsPerRun,
			config.route.qualification.budget.maxRequests,
			256,
		);
		preparedRequest = requestBody(
			request,
			config.configuration,
			config.route.qualification,
			maxSteps,
		);
	} catch (error) {
		const issueCode =
			error instanceof BindingFailure ? error.issueCode : OPENROUTER_RESPONSES_ISSUE_CODES.rejected;
		return failureOutcome(config, request, issueCode, 0, 0, 0);
	}
	const body = preparedRequest.body;
	const envelopeProtection = executeEmpiricalProtection(config.protectionExecutor, {
		policyRef: request.protectionPolicyRef,
		policyRevision: request.protectionPolicyRevision,
		stage: "source-ingress",
		subject: preparedRequest.userEnvelope,
	});
	if (envelopeProtection.receipt.disposition === "blocked") {
		return failureOutcome(
			config,
			request,
			envelopeProtection.issueCode === EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.failed
				? OPENROUTER_RESPONSES_ISSUE_CODES.requestProtectionFailed
				: OPENROUTER_RESPONSES_ISSUE_CODES.requestProtectionBlocked,
			0,
			body.byteLength,
			0,
		);
	}
	const decodedBody = strictJsonCodec.decode(body) as StrictJsonValue;
	const requestProtection = executeEmpiricalProtection(config.protectionExecutor, {
		policyRef: request.protectionPolicyRef,
		policyRevision: request.protectionPolicyRevision,
		stage: "source-ingress",
		subject: decodedBody,
	});
	if (requestProtection.receipt.disposition === "blocked") {
		return failureOutcome(
			config,
			request,
			requestProtection.issueCode === EMPIRICAL_MODEL_EGRESS_PROTECTION_ISSUE_CODES.failed
				? OPENROUTER_RESPONSES_ISSUE_CODES.requestProtectionFailed
				: OPENROUTER_RESPONSES_ISSUE_CODES.requestProtectionBlocked,
			0,
			body.byteLength,
			0,
		);
	}
	let admitted = false;
	try {
		admitted =
			config.admitTransport({
				requestRef: request.requestRef,
				wireRequestBytes: body.byteLength,
				maxOutputTokens: request.remainingTurnBudget.maxOutputTokens,
			}) === true;
	} catch {
		admitted = false;
	}
	if (!admitted) {
		return failureOutcome(
			config,
			request,
			OPENROUTER_RESPONSES_ISSUE_CODES.transportAdmissionRejected,
			0,
			body.byteLength,
			0,
		);
	}

	let startedAtMs: number;
	try {
		startedAtMs = readMeasurement(config.readMs);
	} catch {
		return failureOutcome(
			config,
			request,
			OPENROUTER_RESPONSES_ISSUE_CODES.measurementInvalid,
			0,
			body.byteLength,
			0,
		);
	}
	let transportResponse: OpenRouterResponsesTransportResponseV1;
	try {
		transportResponse = await config.transportRequest({
			endpoint: config.route.qualification.endpoint,
			method: "POST",
			authorizationBearer: config.bearerToken,
			contentType: "application/json",
			xOpenRouterMetadata: "enabled",
			body: body.slice(),
			maxResponseBytes: MAX_OPENROUTER_RESPONSES_RESPONSE_BYTES,
			signal,
		});
	} catch (error) {
		const issues = transportFailureIssueCodes(error, signal);
		if (signal.aborted) {
			return measuredTransportFailureOutcome(config, request, issues, startedAtMs, body.byteLength);
		}
		try {
			return failureOutcome(
				config,
				request,
				issues,
				1,
				body.byteLength,
				elapsedMeasurementMs(config.readMs, startedAtMs),
			);
		} catch {
			return failureOutcome(
				config,
				request,
				OPENROUTER_RESPONSES_ISSUE_CODES.measurementInvalid,
				1,
				body.byteLength,
				0,
			);
		}
	}
	if (signal.aborted) {
		return measuredTransportFailureOutcome(
			config,
			request,
			[
				OPENROUTER_RESPONSES_ISSUE_CODES.unavailableTransport,
				OPENROUTER_RESPONSES_ISSUE_CODES.hostCancelled,
			],
			startedAtMs,
			body.byteLength,
		);
	}

	let latencyMs = 0;
	try {
		latencyMs = elapsedMeasurementMs(config.readMs, startedAtMs);
	} catch {
		return failureOutcome(
			config,
			request,
			OPENROUTER_RESPONSES_ISSUE_CODES.measurementInvalid,
			1,
			body.byteLength,
			0,
		);
	}

	let response: OpenRouterResponsesTransportResponseV1;
	try {
		const raw = record(transportResponse, "provider.transport.response");
		exactKeys(raw, ["body", "retryAfterMs", "status"], "provider.transport.response");
		const status = safeInteger(raw.status, "provider.transport.response.status", {
			min: 100,
			max: 599,
		});
		const retryAfterMs =
			raw.retryAfterMs === null
				? null
				: safeInteger(raw.retryAfterMs, "provider.transport.response.retryAfterMs", {
						min: 1,
						max: 600_000,
					});
		if (!(raw.body instanceof Uint8Array)) throw new TypeError("response body must be bytes");
		if (
			typedArrayByteLengthGetter === undefined ||
			Object.getPrototypeOf(raw.body) !== Uint8Array.prototype ||
			Object.hasOwn(raw.body, "byteLength")
		) {
			throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
		}
		const responseByteLength = typedArrayByteLengthGetter.call(raw.body) as number;
		if (responseByteLength > MAX_OPENROUTER_RESPONSES_RESPONSE_BYTES) {
			throw new BindingFailure(OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse);
		}
		const responseBody = new Uint8Array(responseByteLength);
		Uint8Array.prototype.set.call(responseBody, raw.body);
		response = {
			status,
			body: responseBody,
			retryAfterMs,
		};
	} catch {
		return failureOutcome(
			config,
			request,
			OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
			1,
			body.byteLength,
			latencyMs,
		);
	}
	if (response.status < 200 || response.status >= 300) {
		return failureOutcome(
			config,
			request,
			issuesForErrorResponse(response.status, response.body, response.retryAfterMs),
			1,
			body.byteLength,
			latencyMs,
		);
	}
	if (response.status !== 200) {
		return failureOutcome(
			config,
			request,
			OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
			1,
			body.byteLength,
			latencyMs,
		);
	}

	let candidate: ParsedCandidate;
	try {
		candidate = parseCandidate(response.body, request, config.route.qualification);
	} catch (error) {
		return failureOutcome(
			config,
			request,
			config.route.qualification.endpoint === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT
				? bindingFailureIssueCodes(error, OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.envelopeInvalid)
				: error instanceof BindingFailure
					? error.issueCode
					: OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
			1,
			body.byteLength,
			latencyMs,
			error instanceof BindingFailure ? error.providerUsage : null,
		);
	}
	let rawProtection: EmpiricalProtectionExecutionV1;
	try {
		rawProtection = executeEmpiricalProtection(config.protectionExecutor, {
			policyRef: request.protectionPolicyRef,
			policyRevision: request.protectionPolicyRevision,
			stage: "model-egress",
			subject: candidate.rawProtectionSubject,
		});
	} catch {
		return failureOutcome(
			config,
			request,
			OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
			1,
			body.byteLength,
			latencyMs,
		);
	}
	const selectedPayload =
		candidate.finishReason === "structured-output"
			? candidate.structuredOutput
			: candidate.toolIntents;
	const selectedBytes = strictJsonCodec.encode(selectedPayload).byteLength;
	const providerUsage: ProviderUsageAccounting =
		candidate.usage.outputTokens > request.remainingTurnBudget.maxOutputTokens
			? {
					inputTokens: candidate.usage.inputTokens,
					outputTokens: null,
					totalTokens: candidate.usage.totalTokens,
					providerCostMicrousd: candidate.usage.providerCostMicrousd,
				}
			: candidate.usage;
	const turnUsage = usage(
		request,
		1,
		body.byteLength,
		selectedBytes > request.remainingTurnBudget.maxOutputBytes ? 0 : selectedBytes,
		providerUsage,
	);
	if (rawProtection.receipt.disposition === "blocked") {
		return blockedCandidateOutcome(config, request, rawProtection, turnUsage, latencyMs);
	}
	const evidenceRefs = [
		{
			kind: "openrouter-response-summary",
			id: candidate.responseId,
			digest: empiricalStrictJsonDigest({
				responseId: candidate.responseId,
				model: config.route.qualification.requestModel,
				status: "completed",
				usage: candidate.usage,
				finishReason: candidate.finishReason,
				route: candidate.routeEvidence,
				routeQualificationDigest: config.route.qualificationDigest,
			}),
		},
	];
	const deepSeekToolRequired =
		config.route.qualification.requestModel === OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL &&
		((request.priorToolResults.length === 0 && !preparedRequest.finalStep) ||
			preparedRequest.toolContinuationRequired);
	const terminalReadyToolCall =
		preparedRequest.terminalReady && candidate.finishReason === "tool-intents";
	const chatTurnContractViolated =
		config.route.qualification.endpoint === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT &&
		(terminalReadyToolCall ||
			(!preparedRequest.finalStep &&
				candidate.finishReason !== "tool-intents" &&
				(config.route.qualification.requestModel !== OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL ||
					deepSeekToolRequired)));
	const chatTurnContractDiagnostic =
		config.route.qualification.endpoint !== OPENROUTER_CHAT_COMPLETIONS_ENDPOINT
			? null
			: terminalReadyToolCall
				? OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.terminalReadyToolCall
				: preparedRequest.finalStep && candidate.finishReason === "tool-intents"
					? OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.finalToolCall
					: (config.route.qualification.requestModel !==
								OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL ||
								deepSeekToolRequired) &&
							!preparedRequest.finalStep &&
							candidate.finishReason !== "tool-intents"
						? OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.nonFinalDirectOutput
						: null;
	const outputBudgetDiagnostic =
		config.route.qualification.endpoint !== OPENROUTER_CHAT_COMPLETIONS_ENDPOINT
			? null
			: selectedBytes > request.remainingTurnBudget.maxOutputBytes
				? OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.outputByteBudgetExceeded
				: candidate.usage.outputTokens > request.remainingTurnBudget.maxOutputTokens
					? OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.outputTokenBudgetExceeded
					: null;
	if (outputBudgetDiagnostic !== null) {
		return allowedOutcome(config, request, {
			status: "non-evaluable",
			finishReason: null,
			structuredOutput: null,
			toolIntents: [],
			turnUsage: usage(request, 1, body.byteLength, 0, providerUsage),
			latencyMs,
			issueCodes: [
				OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
				...(chatTurnContractDiagnostic === null ? [] : [chatTurnContractDiagnostic]),
				outputBudgetDiagnostic,
			],
			evidenceRefs,
		});
	}
	const chatTurnContractIssues =
		chatTurnContractDiagnostic === null
			? [OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse]
			: [OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse, chatTurnContractDiagnostic];
	if (
		(preparedRequest.finalStep && candidate.finishReason === "tool-intents") ||
		terminalReadyToolCall ||
		chatTurnContractViolated
	) {
		try {
			return allowedOutcome(config, request, {
				status: "non-evaluable",
				finishReason: null,
				structuredOutput: null,
				toolIntents: [],
				turnUsage: usage(request, 1, body.byteLength, 0, providerUsage),
				latencyMs,
				issueCodes: chatTurnContractIssues,
				evidenceRefs,
			});
		} catch {
			return failureOutcome(
				config,
				request,
				chatTurnContractIssues,
				1,
				body.byteLength,
				latencyMs,
				providerUsage,
			);
		}
	}
	try {
		return allowedOutcome(config, request, {
			status: "completed",
			finishReason: candidate.finishReason,
			structuredOutput: candidate.structuredOutput,
			toolIntents: candidate.toolIntents,
			turnUsage,
			latencyMs,
			issueCodes: [],
			evidenceRefs,
		});
	} catch {
		return failureOutcome(
			config,
			request,
			config.route.qualification.endpoint === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT
				? [
						OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
						OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.postParseValidationFailed,
						OPENROUTER_RESPONSE_DIAGNOSTIC_CODES.outcomeValidationFailed,
					]
				: OPENROUTER_RESPONSES_ISSUE_CODES.invalidResponse,
			1,
			body.byteLength,
			latencyMs,
			providerUsage,
		);
	}
}

/**
 * Package-private D669-qualified OpenRouter Responses binding for exactly one
 * D652 model turn. The returned D656 executor is constructed from the same
 * explicit bearer credential used by the focused transport boundary.
 */
export function createOpenRouterResponsesEmpiricalBinding(
	value: OpenRouterResponsesEmpiricalBindingConfigV1,
): OpenRouterResponsesEmpiricalBindingV1 {
	let config: ValidatedBindingConfig;
	try {
		config = validateBindingConfig(value);
	} catch {
		throw new TypeError("invalid OpenRouter Responses binding configuration");
	}
	const protectionExecutor = createEmpiricalExactPrivateNeedleProtectionExecutor({
		policyRef: config.frozen.manifest.policies.protectionPolicyRef,
		policyRevision: config.frozen.manifest.policies.protectionPolicyRevision,
		protectedNeedleCapabilityRef: config.credentialBindingRef,
		protectedNeedleCapabilityRevision: config.credentialBindingRevision,
		protectedNeedles: [config.bearerToken],
	});
	const invocationConfig = Object.freeze({ ...config, protectionExecutor });
	const modelTurnPort = Object.freeze({
		invoke(request: EmpiricalModelTurnRequestV1, signal: AbortSignal) {
			return invokeOpenRouterResponses(invocationConfig, request, signal);
		},
	}) satisfies EmpiricalModelTurnPortV1;
	return Object.freeze({
		modelTurnPort,
		protectionExecutor,
		configurationRef: config.configuration.configurationRef,
		routeQualificationDigest: config.route.qualificationDigest,
		credentialBindingRef: config.credentialBindingRef,
		credentialBindingRevision: config.credentialBindingRevision,
	});
}
