import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256, strictSnapshot } from "./canonical.js";
import {
	admitD45ProviderWire,
	type D45AdmittedEffectV1,
	type D45GraphToolAuthorityV1,
	type D45ProviderProposalResultInputV1,
	type D45ToolArgumentsV1,
	readD45ProviderMaterial,
} from "./d45-graph-tool-authority.js";

export const D45_CHAT_ADAPTER_REVISION = "graphrefly-ts.d45.mechanical-chat-adapter.v1" as const;

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

function explicitProviderCode(value: unknown): boolean {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const root = value as Record<string, unknown>;
	for (const item of [root, root.error]) {
		if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
		const candidate = item as Record<string, unknown>;
		if (
			(typeof candidate.type === "string" && candidate.type.length > 0) ||
			(typeof candidate.code === "string" && candidate.code.length > 0)
		)
			return true;
	}
	return false;
}

/** Mechanically turns one bounded raw Chat response into a proposal result; Graph still admits it. */
export function parseD45ChatProviderResponse(input: {
	readonly status: number;
	readonly bytes: Uint8Array;
	readonly elapsedMs: number;
	readonly wireDigest: string;
	readonly pricing: D45ChatPricingV1;
}): D45ProviderProposalResultInputV1 {
	if (input.bytes.byteLength > MAX_CHAT_RESPONSE_BYTES)
		throw new TypeError("D45 Chat response exceeded its byte bound");
	if (!Number.isSafeInteger(input.status) || input.status < 100 || input.status > 599)
		throw new TypeError("D45 Chat status is invalid");
	const text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
	let decoded: unknown;
	try {
		decoded = JSON.parse(text);
	} catch {
		decoded = null;
	}
	if (input.status < 200 || input.status >= 300) {
		const untyped429 = input.status === 429 && !explicitProviderCode(decoded);
		const boundedRetryStatus = [408, 502, 503, 504].includes(input.status);
		return Object.freeze({
			effectKind: "provider-proposal",
			outcome:
				untyped429 || boundedRetryStatus ? "retryable-provider-failure" : "provider-rejected",
			elapsedMs: input.elapsedMs,
			costMicrousd: 0,
			usage: null,
			wireDigest: input.wireDigest,
			retryClass: untyped429 ? "D710" : boundedRetryStatus ? "D671" : null,
			proposal: null,
		});
	}
	const root = object(decoded, "D45 Chat response");
	const usage = object(root.usage, "D45 Chat usage");
	const inputTokens = nonnegativeInteger(usage.prompt_tokens, "D45 Chat prompt_tokens");
	const outputTokens = nonnegativeInteger(usage.completion_tokens, "D45 Chat completion_tokens");
	const details =
		usage.prompt_tokens_details === undefined
			? {}
			: object(usage.prompt_tokens_details, "D45 Chat prompt token details");
	const cacheReadTokens = nonnegativeInteger(details.cached_tokens ?? 0, "D45 Chat cached_tokens");
	if (cacheReadTokens > inputTokens) throw new TypeError("D45 Chat cached tokens exceeded input");
	const noncacheInputTokens = inputTokens - cacheReadTokens;
	const costMicrousd = Math.ceil(
		(noncacheInputTokens * input.pricing.inputMicrousdPerMillionTokens +
			outputTokens * input.pricing.outputMicrousdPerMillionTokens +
			cacheReadTokens * input.pricing.cacheReadMicrousdPerMillionTokens) /
			1_000_000,
	);
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
			proposal: null,
		});
	if (rawCalls.length > 4) throw new TypeError("D45 Chat tool call count exceeded its wire bound");
	const toolCalls = rawCalls.map((raw, index) => {
		const call = object(raw, `D45 Chat tool call[${index}]`);
		const fn = object(call.function, `D45 Chat tool call[${index}].function`);
		if (typeof fn.name !== "string" || typeof fn.arguments !== "string")
			throw new TypeError("D45 Chat tool call omitted bounded function coordinates");
		if (Buffer.byteLength(fn.arguments, "utf8") > 131_072)
			throw new TypeError("D45 Chat tool arguments exceeded their wire bound");
		const args = object(JSON.parse(fn.arguments), `D45 Chat tool call[${index}].arguments`);
		return fn.name === "read_file"
			? { toolRef: "read-file" as const, path: args.path }
			: fn.name === "replace_exact"
				? {
						toolRef: "replace-exact" as const,
						path: args.path,
						oldText: args.oldText,
						newText: args.newText,
					}
				: ({ toolRef: fn.name, path: args.path } as unknown);
	});
	return Object.freeze({
		effectKind: "provider-proposal",
		outcome: "success",
		elapsedMs: input.elapsedMs,
		costMicrousd,
		usage: { inputTokens, outputTokens, cacheReadTokens },
		wireDigest: input.wireDigest,
		retryClass: null,
		proposal: { toolCalls: toolCalls as unknown as readonly D45ToolArgumentsV1[] },
	});
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
					oldText: Object.freeze({ type: "string" as const, minLength: 1, maxLength: 32_768 }),
					newText: Object.freeze({ type: "string" as const, maxLength: 32_768 }),
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

export function lowerD45ProviderEffect(
	authority: D45GraphToolAuthorityV1,
	effect: D45AdmittedEffectV1,
): D45LoweredChatWireV1 {
	if (
		effect.effectKind !== "provider-proposal" ||
		(effect.phase !== "inspection" && effect.phase !== "mutation") ||
		effect.maxOutputTokens === null ||
		effect.endpointProtocol !== "chat-completions"
	)
		throw new TypeError("D45 Chat adapter requires one admitted provider proposal effect");
	const material = readD45ProviderMaterial(authority, effect);
	const toolName = effect.phase === "inspection" ? "read_file" : "replace_exact";
	const tool =
		effect.phase === "inspection"
			? readTool(material.readablePaths)
			: replaceTool(material.writablePath);
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
				content: `Graph admission requires phase=${effect.phase}; return only the named ${toolName} tool proposal.`,
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
