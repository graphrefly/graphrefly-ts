import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256, exactKeys, strictSnapshot } from "./canonical.js";
import {
	admitD45ProviderWire,
	type D45AdmittedEffectV1,
	type D45GraphToolAuthorityV1,
	type D45ProviderMaterialV1,
	type D45ProviderProposalResultInputV1,
	type D45ToolArgumentsV1,
	D52_REPLACE_TEXT_MAX_BYTES,
	readD45ProviderMaterial,
} from "./graph-tool-authority.js";

export const D45_CHAT_ADAPTER_REVISION = "graphrefly-ts.d60.mechanical-chat-adapter.v4" as const;

export interface D45LoweredChatWireV1 {
	readonly adapterRevision: typeof D45_CHAT_ADAPTER_REVISION;
	readonly logicalRequestDigest: string;
	readonly body: string;
	readonly wireDigest: string;
}

export interface D45ChatPricingV1 {
	readonly inputMicrousdPerMillionTokens: number;
	readonly outputMicrousdPerMillionTokens: number;
	readonly cacheReadMicrousdPerMillionTokens: number;
}

const MAX_CHAT_RESPONSE_BYTES = 2 * 1024 * 1024;

function ownString(value: unknown, key: string): string | null {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
		? descriptor.value
		: null;
}

/** Maps only D675's exact pre-response socket class to a retry proposal. */
export function classifyD45ChatTransportFailure(input: {
	readonly error: unknown;
	readonly elapsedMs: number;
	readonly wireDigest: string;
}): D45ProviderProposalResultInputV1 {
	const cause =
		input.error !== null && typeof input.error === "object"
			? Object.getOwnPropertyDescriptor(input.error, "cause")?.value
			: null;
	const code = ownString(cause, "code") ?? ownString(input.error, "code");
	const d675 = code === "UND_ERR_SOCKET";
	const abort =
		(typeof DOMException !== "undefined" &&
			input.error instanceof DOMException &&
			input.error.name === "AbortError") ||
		ownString(input.error, "name") === "AbortError";
	const recognizedTransport =
		d675 ||
		abort ||
		code === "ECONNRESET" ||
		code === "ENOTFOUND" ||
		code === "EAI_AGAIN" ||
		code === "ETIMEDOUT" ||
		code === "UND_ERR_CONNECT_TIMEOUT" ||
		code === "UND_ERR_HEADERS_TIMEOUT" ||
		code === "UND_ERR_BODY_TIMEOUT";
	if (!recognizedTransport)
		return classifyD45ChatExecutorFailure({
			elapsedMs: input.elapsedMs,
			wireDigest: input.wireDigest,
		});
	return Object.freeze({
		effectKind: "provider-proposal",
		outcome: d675 ? "retryable-provider-failure" : "transport-failed",
		elapsedMs: input.elapsedMs,
		costMicrousd: 0,
		usage: null,
		wireDigest: input.wireDigest,
		retryClass: d675 ? "D675" : null,
		responseRejectionCode: null,
		proposal: null,
	});
}

/** Contains an unclassified post-wire boundary exception without retaining its material. */
export function classifyD45ChatExecutorFailure(input: {
	readonly elapsedMs: number;
	readonly wireDigest: string;
}): D45ProviderProposalResultInputV1 {
	return Object.freeze({
		effectKind: "provider-proposal",
		outcome: "executor-failed",
		elapsedMs: input.elapsedMs,
		costMicrousd: 0,
		usage: null,
		wireDigest: input.wireDigest,
		retryClass: null,
		responseRejectionCode: null,
		proposal: null,
	});
}

function object(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${path} must be an object`);
	return value as Record<string, unknown>;
}

function nonnegativeInteger(value: unknown, path: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0)
		throw new TypeError(`${path} must be a nonnegative safe integer`);
	return value as number;
}

function requiredString(value: Record<string, unknown>, key: string, path: string): string {
	const candidate = value[key];
	if (typeof candidate !== "string") throw new TypeError(`${path}.${key} must be a string`);
	return candidate;
}

function providerCodes(value: unknown): readonly string[] {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
	const root = value as Record<string, unknown>;
	const result: string[] = [];
	for (const item of [root, root.error]) {
		if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
		const candidate = item as Record<string, unknown>;
		for (const code of [candidate.type, candidate.code])
			if (typeof code === "string" && code.length > 0) result.push(code);
	}
	return Object.freeze(result);
}

/** Mechanically turns one bounded raw Chat response into a proposal result; Graph still admits it. */
export interface D45ChatProviderResponseInputV1 {
	readonly responseContractRevision: string;
	readonly status: number;
	readonly bytes: Uint8Array;
	readonly elapsedMs: number;
	readonly wireDigest: string;
	readonly pricing: D45ChatPricingV1;
}

function parseD45ChatProviderResponseUnchecked(
	input: D45ChatProviderResponseInputV1,
): D45ProviderProposalResultInputV1 {
	if (input.bytes.byteLength > MAX_CHAT_RESPONSE_BYTES)
		return responseSchemaRejection(input, "response-byte-bound");
	if (!Number.isSafeInteger(input.status) || input.status < 100 || input.status > 599)
		return responseSchemaRejection(input, "response-status-invalid");
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
	} catch {
		return responseSchemaRejection(input, "response-utf8-invalid");
	}
	let decoded: unknown;
	try {
		decoded = JSON.parse(text);
	} catch {
		if (input.status >= 200 && input.status < 300)
			return responseSchemaRejection(input, "response-json-invalid");
		decoded = null;
	}
	if (input.status < 200 || input.status >= 300) {
		const codes = providerCodes(decoded);
		const untyped429 = input.status === 429 && codes.length === 0;
		const d671 =
			(input.status === 429 && codes.includes("rate_limit_exceeded")) ||
			(input.status === 503 && codes.includes("provider_overloaded"));
		return Object.freeze({
			effectKind: "provider-proposal",
			outcome: untyped429 || d671 ? "retryable-provider-failure" : "provider-rejected",
			elapsedMs: input.elapsedMs,
			costMicrousd: 0,
			usage: null,
			wireDigest: input.wireDigest,
			retryClass: untyped429 ? "D710" : d671 ? "D671" : null,
			responseRejectionCode: null,
			proposal: null,
		});
	}
	let root: Record<string, unknown>;
	try {
		root = object(decoded, "D45 Chat response");
	} catch {
		return responseSchemaRejection(input, "response-root-shape");
	}
	let usage: Record<string, unknown>;
	try {
		usage = object(root.usage, "D45 Chat usage");
	} catch {
		return responseSchemaRejection(input, "response-usage-shape");
	}
	let inputTokens: number;
	let outputTokens: number;
	try {
		inputTokens = nonnegativeInteger(usage.prompt_tokens, "D45 Chat prompt_tokens");
		outputTokens = nonnegativeInteger(usage.completion_tokens, "D45 Chat completion_tokens");
	} catch {
		return responseSchemaRejection(input, "response-token-invalid");
	}
	const details = usage.prompt_tokens_details === undefined ? {} : usage.prompt_tokens_details;
	let cacheReadTokens: number;
	try {
		const cacheDetails = object(details, "D45 Chat prompt token details");
		cacheReadTokens = nonnegativeInteger(cacheDetails.cached_tokens ?? 0, "D45 Chat cached_tokens");
		if (cacheReadTokens > inputTokens) throw new TypeError("D45 Chat cached tokens exceeded input");
	} catch {
		return responseSchemaRejection(input, "response-cache-token-invalid");
	}
	const noncacheInputTokens = inputTokens - cacheReadTokens;
	const costMicrousd = Math.ceil(
		(noncacheInputTokens * input.pricing.inputMicrousdPerMillionTokens +
			outputTokens * input.pricing.outputMicrousdPerMillionTokens +
			cacheReadTokens * input.pricing.cacheReadMicrousdPerMillionTokens) /
			1_000_000,
	);
	try {
		const choices = root.choices;
		if (!Array.isArray(choices) || choices.length !== 1)
			throw new TypeError("D45 Chat response must contain exactly one choice");
		const choice = object(choices[0], "D45 Chat choice");
		const finishReason = choice.finish_reason;
		const message = object(choice.message, "D45 Chat assistant message");
		const rawCalls = message.tool_calls;
		if (finishReason === "length")
			return Object.freeze({
				effectKind: "provider-proposal",
				outcome: "length",
				elapsedMs: input.elapsedMs,
				costMicrousd,
				usage: { inputTokens, outputTokens, cacheReadTokens },
				wireDigest: input.wireDigest,
				retryClass: null,
				responseRejectionCode: null,
				proposal: null,
			});
		if (!Array.isArray(rawCalls) || rawCalls.length === 0)
			return Object.freeze({
				effectKind: "provider-proposal",
				outcome: "premature-final",
				elapsedMs: input.elapsedMs,
				costMicrousd,
				usage: { inputTokens, outputTokens, cacheReadTokens },
				wireDigest: input.wireDigest,
				retryClass: null,
				responseRejectionCode: null,
				proposal: null,
			});
		const toolCalls = rawCalls.map((raw, index) => {
			const call = object(raw, `D45 Chat tool call[${index}]`);
			const fn = object(call.function, `D45 Chat tool call[${index}].function`);
			if (typeof fn.name !== "string" || typeof fn.arguments !== "string")
				throw new TypeError("D45 Chat tool call omitted bounded function coordinates");
			if (Buffer.byteLength(fn.arguments, "utf8") > 131_072)
				throw new TypeError("D45 Chat tool arguments exceeded their wire bound");
			const argumentPath = `D45 Chat tool call[${index}].arguments`;
			const args = object(JSON.parse(fn.arguments), argumentPath);
			const path = requiredString(args, "path", argumentPath);
			if (fn.name === "read_file") {
				exactKeys(args, ["path"], argumentPath);
				return { toolRef: "read-file" as const, path };
			}
			if (fn.name === "replace_exact") {
				exactKeys(args, ["newText", "oldText", "path"], argumentPath);
				return {
					toolRef: "replace-exact" as const,
					path,
					oldText: requiredString(args, "oldText", argumentPath),
					newText: requiredString(args, "newText", argumentPath),
				};
			}
			exactKeys(args, ["path"], argumentPath);
			return { toolRef: fn.name, path } as unknown;
		});
		return Object.freeze({
			effectKind: "provider-proposal",
			outcome: "success",
			elapsedMs: input.elapsedMs,
			costMicrousd,
			usage: { inputTokens, outputTokens, cacheReadTokens },
			wireDigest: input.wireDigest,
			retryClass: null,
			responseRejectionCode: null,
			proposal: { toolCalls: toolCalls as unknown as readonly D45ToolArgumentsV1[] },
		});
	} catch {
		return responseSchemaRejection(
			input,
			"response-tool-envelope-invalid",
			{ inputTokens, outputTokens, cacheReadTokens },
			costMicrousd,
		);
	}
}

function responseSchemaRejection(
	input: D45ChatProviderResponseInputV1,
	responseRejectionCode: NonNullable<D45ProviderProposalResultInputV1["responseRejectionCode"]>,
	usage: D45ProviderProposalResultInputV1["usage"] = null,
	costMicrousd = 0,
): D45ProviderProposalResultInputV1 {
	return Object.freeze({
		effectKind: "provider-proposal",
		outcome: "schema-rejected",
		elapsedMs: input.elapsedMs,
		costMicrousd,
		usage,
		wireDigest: input.wireDigest,
		retryClass: null,
		responseRejectionCode,
		proposal: null,
	});
}

export function parseD45ChatProviderResponse(
	input: D45ChatProviderResponseInputV1,
): D45ProviderProposalResultInputV1 {
	if (input.responseContractRevision !== "bounded-chat-response.v1")
		throw new TypeError("chat response contract revision is not admitted");
	return parseD45ChatProviderResponseUnchecked(input);
}

function readTool(readablePaths: readonly string[]) {
	return Object.freeze({
		type: "function" as const,
		function: Object.freeze({
			name: "read_file",
			description: "Read one allowlisted UTF-8 workspace file before proposing a mutation.",
			parameters: Object.freeze({
				type: "object" as const,
				additionalProperties: false as const,
				required: Object.freeze(["path"]),
				properties: Object.freeze({
					path: Object.freeze({ type: "string" as const, enum: Object.freeze([...readablePaths]) }),
				}),
			}),
		}),
	});
}

function replaceTool(writablePath: string) {
	return Object.freeze({
		type: "function" as const,
		function: Object.freeze({
			name: "replace_exact",
			description: "Replace exactly one current occurrence in the single writable file.",
			parameters: Object.freeze({
				type: "object" as const,
				additionalProperties: false as const,
				required: Object.freeze(["path", "oldText", "newText"]),
				properties: Object.freeze({
					path: Object.freeze({ type: "string" as const, enum: Object.freeze([writablePath]) }),
					oldText: Object.freeze({
						type: "string" as const,
						minLength: 1,
						maxLength: D52_REPLACE_TEXT_MAX_BYTES,
					}),
					newText: Object.freeze({
						type: "string" as const,
						maxLength: D52_REPLACE_TEXT_MAX_BYTES,
					}),
				}),
			}),
		}),
	});
}

function retainedContext(
	reads: readonly Readonly<{ readonly path: string; readonly content: string }>[],
): string {
	if (reads.length === 0) return "";
	return reads
		.map(
			({ path, content }) =>
				`\n\n<graph-admitted-read path=${JSON.stringify(path)}>\n${content}\n</graph-admitted-read>`,
		)
		.join("");
}

function graphCorrectionInstruction(context: D45ProviderMaterialV1["correctionContext"]): string {
	if (context === null) return "Graph admitted no additional public correction evidence.";
	if (context.kind === "focused-validation")
		return `Graph admitted focused validation outcome=${context.causeCode}; repair the candidate so repository TypeScript validation passes.`;
	return `Graph admitted public semantic observations: ${context.observations
		.map(
			({ criterion, scenarioRef, passed, causeCode }) =>
				`${criterion}:${scenarioRef}=${passed ? "passed" : `failed(${causeCode})`}`,
		)
		.join(", ")}. Repair only the failed public scenarios while preserving the passed scenarios.`;
}

const MUTATION_PROPOSAL_CONTRACT =
	"Return exactly one named replace_exact tool call with exactly the keys path, oldText, and newText; do not emit a final answer or any additional tool call. oldText and newText must be byte-different. Keep oldText and newText at or below 512 UTF-8 bytes each, keep newText at most 128 UTF-8 bytes longer than oldText, and quote only the smallest unique contiguous local span. Do not replace an entire function or file." as const;

function graphIntentInstruction(
	material: D45ProviderMaterialV1,
	phase: "inspection" | "mutation",
): string {
	const { intent } = material;
	const phaseContract = phase === "mutation" ? `${MUTATION_PROPOSAL_CONTRACT} ` : "";
	if (intent === "phase-correction")
		return `${phaseContract}Graph rejected the previous phase response. Return exactly one named tool call now; do not emit a final answer or additional tool calls.`;
	if (intent === "fresh-mutation")
		return `${phaseContract}Graph rejected the previous exact replacement against current workspace state. Use the retained fresh sources and propose one different, unique exact replacement.`;
	if (intent === "semantic-correction")
		return `${phaseContract}Graph validation rejected the current workspace. ${graphCorrectionInstruction(material.correctionContext)} Inspect the retained current sources and propose one different smallest exact replacement.`;
	if (intent === "reinspection")
		return `${phaseContract}Graph requires one fresh read of the writable file before another mutation.`;
	return `${phaseContract}Graph admitted the initial phase effect.`;
}

export function lowerD45ProviderEffect(
	authority: D45GraphToolAuthorityV1,
	effect: D45AdmittedEffectV1,
): D45LoweredChatWireV1 {
	if (
		effect.effectKind !== "provider-proposal" ||
		(effect.phase !== "inspection" && effect.phase !== "mutation") ||
		effect.maxOutputTokens === null ||
		effect.endpointProtocol !== "chat-completions" ||
		effect.responseContractRevision !== "bounded-chat-response.v1"
	)
		throw new TypeError("D45 Chat adapter requires one admitted provider proposal effect");
	const material = readD45ProviderMaterial(authority, effect);
	const toolName = effect.phase === "inspection" ? "read_file" : "replace_exact";
	const retainedPaths = new Set(material.retainedReads.map(({ path }) => path));
	const readablePaths =
		retainedPaths.size < material.readablePaths.length
			? material.readablePaths.filter((path) => !retainedPaths.has(path))
			: [material.writablePath];
	const tool =
		effect.phase === "inspection" ? readTool(readablePaths) : replaceTool(material.writablePath);
	const toolChoice =
		effect.namedToolChoiceEncoding === "function-object"
			? Object.freeze({ type: "function" as const, function: Object.freeze({ name: toolName }) })
			: toolName;
	const body = strictSnapshot({
		model: effect.modelRef,
		messages: [
			{ role: "system", content: material.systemInstruction },
			{
				role: "user",
				content: `${material.taskStatement}\n\n${material.armContext}${retainedContext(material.retainedReads)}`,
			},
			{
				role: "system",
				content: `Graph admission requires phase=${effect.phase}; return only the named ${toolName} tool proposal. ${graphIntentInstruction(material, effect.phase)}`,
			},
		],
		tools: [tool],
		tool_choice: toolChoice,
		max_tokens: effect.maxOutputTokens,
		reasoning: { effort: effect.reasoningEffort },
		provider: {
			order: [effect.providerRef],
			only: [effect.providerRef],
			allow_fallbacks: false,
			require_parameters: effect.requireParameters,
		},
	});
	const bytes = strictJsonCodec.encode(body);
	const wireDigest = empiricalSha256(bytes);
	admitD45ProviderWire(authority, effect, wireDigest);
	return Object.freeze({
		adapterRevision: D45_CHAT_ADAPTER_REVISION,
		logicalRequestDigest: effect.logicalRequestDigest,
		body: new TextDecoder().decode(bytes),
		wireDigest,
	});
}
