import type { StrictJsonValue } from "../../src/json/codec.js";
import {
	array,
	empiricalStrictJsonDigest,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import type {
	D720EffectResultV1,
	D720GraphEffectRequestV1,
	D720ToolRef,
} from "./d722-graph-native-effect-runtime.js";
import type {
	OpenRouterResponsesByteTransportV1,
	OpenRouterResponsesCredentialCapabilityV1,
} from "./openrouter-responses-model-turn.js";
import {
	OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
	OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
	OPENROUTER_DEEPSEEK_V4_FLASH_SELECTED_MODEL,
} from "./openrouter-route-qualification.js";

export const D723_OPENROUTER_GRAPH_TURN_REVISION =
	"graphrefly.b112.d723.openrouter-graph-turn.v1" as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
export const D739_MAX_OPENROUTER_CHAT_REQUEST_BYTES = 1_048_576;
const TOOL_NAMES = Object.freeze({
	"read-file": "read_file",
	"search-repository": "search_repository",
	"replace-exact": "replace_exact",
	"workspace-diff": "workspace_diff",
	"focused-validation": "focused_validation",
} satisfies Record<D720ToolRef, string>);
const TOOL_REFS = new Map(
	Object.entries(TOOL_NAMES).map(([ref, name]) => [name, ref as D720ToolRef]),
);

export interface D723RawToolIntentV1 {
	readonly toolCallRef: string;
	readonly toolRef: D720ToolRef;
	readonly intentDigest: string;
	readonly arguments: StrictJsonValue;
}

export interface D723OpenRouterConversationV1 {
	readonly messages: readonly StrictJsonValue[];
}

export interface D723OpenRouterTurnV1 {
	readonly result: D720EffectResultV1;
	readonly actualCostMicrousd: number;
	readonly actualElapsedMs: number;
	readonly conversation: D723OpenRouterConversationV1;
	readonly rawToolIntents: readonly D723RawToolIntentV1[];
}

function tools(): readonly StrictJsonValue[] {
	const schemas: Record<D720ToolRef, StrictJsonValue> = {
		"read-file": {
			type: "function",
			function: {
				name: TOOL_NAMES["read-file"],
				description: "Read one allowed repository file.",
				parameters: {
					type: "object",
					additionalProperties: false,
					required: ["path"],
					properties: { path: { type: "string" } },
				},
			},
		},
		"search-repository": {
			type: "function",
			function: {
				name: TOOL_NAMES["search-repository"],
				description: "Search allowed repository files for an exact bounded query.",
				parameters: {
					type: "object",
					additionalProperties: false,
					required: ["query"],
					properties: { query: { type: "string" } },
				},
			},
		},
		"replace-exact": {
			type: "function",
			function: {
				name: TOOL_NAMES["replace-exact"],
				description: "Replace one unique exact string in the allowed writable file.",
				parameters: {
					type: "object",
					additionalProperties: false,
					required: ["path", "oldText", "newText"],
					properties: {
						path: { type: "string" },
						oldText: { type: "string" },
						newText: { type: "string" },
					},
				},
			},
		},
		"workspace-diff": {
			type: "function",
			function: {
				name: TOOL_NAMES["workspace-diff"],
				description: "Inspect the current bounded workspace diff.",
				parameters: { type: "object", additionalProperties: false, properties: {} },
			},
		},
		"focused-validation": {
			type: "function",
			function: {
				name: TOOL_NAMES["focused-validation"],
				description: "Run the frozen focused validation after the latest mutation and diff.",
				parameters: { type: "object", additionalProperties: false, properties: {} },
			},
		},
	};
	return Object.freeze(Object.values(schemas));
}

function parseJsonBytes(bytes: Uint8Array, path: string): Record<string, unknown> {
	if (bytes.byteLength === 0 || bytes.byteLength > 1_048_576)
		throw new TypeError(`${path} bytes are outside the bound`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(decoder.decode(bytes));
	} catch {
		throw new TypeError(`${path} is not UTF-8 JSON`);
	}
	return record(parsed, path);
}

function retryFailure(
	request: D720GraphEffectRequestV1,
	status: number,
	retryAfterMs: number | null,
	body: Uint8Array,
): D720EffectResultV1 {
	let discriminator: D720EffectResultV1 extends infer _ ? string : never;
	if (status === 429) {
		let typed = false;
		try {
			const root = parseJsonBytes(body, "d723.http429");
			const error =
				typeof root.error === "object" && root.error !== null
					? record(root.error, "d723.http429.error")
					: null;
			typed = typeof error?.type === "string" || typeof error?.code === "string";
		} catch {
			typed = false;
		}
		discriminator = typed ? "d671-rate-limit-exceeded" : "d710-untyped-http-429";
	} else if (status === 502 || status === 503 || status === 504) {
		discriminator = "d671-provider-overloaded";
	} else {
		return Object.freeze({
			effectKind: "provider-request",
			status: "terminal-failure",
			toolIntents: Object.freeze([]),
			failureDiscriminator: "none",
			retryAfterMs: null,
			workspaceStateDigest: request.workspaceStateDigest!,
			evidenceDigest: empiricalStrictJsonDigest({
				status,
				responseDigest: empiricalStrictJsonDigest([...body]),
			}),
		});
	}
	return Object.freeze({
		effectKind: "provider-request",
		status: "retryable-failure",
		toolIntents: Object.freeze([]),
		failureDiscriminator: discriminator as
			| "d671-rate-limit-exceeded"
			| "d671-provider-overloaded"
			| "d710-untyped-http-429",
		retryAfterMs,
		workspaceStateDigest: request.workspaceStateDigest!,
		evidenceDigest: empiricalStrictJsonDigest({
			status,
			retryAfterMs,
			bodyDigest: empiricalStrictJsonDigest([...body]),
		}),
	});
}

export async function invokeD723OpenRouterGraphTurn(input: {
	readonly effectRequest: D720GraphEffectRequestV1;
	readonly credential: OpenRouterResponsesCredentialCapabilityV1;
	readonly transport: OpenRouterResponsesByteTransportV1;
	readonly taskStatement: string;
	readonly conversation: D723OpenRouterConversationV1;
	readonly signal: AbortSignal;
	readonly monotonicNowMs: () => number;
}): Promise<D723OpenRouterTurnV1> {
	if (
		input.effectRequest.effectKind !== "provider-request" ||
		input.effectRequest.workspaceStateDigest === null
	)
		throw new TypeError("D723 OpenRouter turn requires a Graph-admitted provider request");
	if (
		typeof input.taskStatement !== "string" ||
		input.taskStatement.length < 1 ||
		input.taskStatement.length > 32_768
	)
		throw new TypeError("D723 task statement is outside the bound");
	if (!(input.signal instanceof AbortSignal))
		throw new TypeError("D723 provider signal is invalid");
	input.signal.throwIfAborted();
	const priorMessages = array(input.conversation.messages, "d723.conversation.messages");
	if (priorMessages.length > 128) throw new TypeError("D723 conversation message bound exceeded");
	const messages: StrictJsonValue[] =
		priorMessages.length === 0
			? [
					{
						role: "system",
						content:
							"You are the actor in a closed repository repair. Use only the supplied tools. Inspect first, make the smallest exact change, inspect the diff, run focused validation, and only then return a short JSON object. Never invent tool results.",
					},
					{
						role: "user",
						content: JSON.stringify({
							task: input.taskStatement,
							graphRun: {
								runSequence: input.effectRequest.runSequence,
								issuedRequestDigest: input.effectRequest.issuedRequestDigest,
							},
						}),
					},
				]
			: [...(priorMessages as readonly StrictJsonValue[])];
	if (input.effectRequest.completionContext !== undefined) {
		messages.push({
			role: "user",
			content: JSON.stringify({ graphCompletionContext: input.effectRequest.completionContext }),
		});
	}
	const bodyValue = strictSnapshot({
		model: OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
		provider: {
			order: [OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG],
			only: [OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG],
			allow_fallbacks: false,
			require_parameters: true,
		},
		messages,
		tools: tools(),
		tool_choice: input.effectRequest.completionContext === undefined ? "auto" : "required",
		reasoning: { effort: "high" },
		stream: false,
	});
	const body = encoder.encode(JSON.stringify(bodyValue));
	if (body.byteLength > D739_MAX_OPENROUTER_CHAT_REQUEST_BYTES)
		throw new TypeError("D723 provider request exceeds the wire bound");
	const started = input.monotonicNowMs();
	let response: Awaited<ReturnType<OpenRouterResponsesByteTransportV1["request"]>>;
	try {
		response = await input.transport.request({
			endpoint: OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
			method: "POST",
			authorizationBearer: input.credential.bearerToken,
			contentType: "application/json",
			xOpenRouterMetadata: "enabled",
			body,
			maxResponseBytes: 1_048_576,
			signal: input.signal,
		});
	} catch (error) {
		const name = error instanceof Error ? error.name : "unknown";
		const message = error instanceof Error ? error.message : "unknown";
		if (/socket|UND_ERR_SOCKET/i.test(`${name}:${message}`)) {
			const result: D720EffectResultV1 = Object.freeze({
				effectKind: "provider-request",
				status: "retryable-failure",
				toolIntents: Object.freeze([]),
				failureDiscriminator: "d675-und-err-socket",
				retryAfterMs: null,
				workspaceStateDigest: input.effectRequest.workspaceStateDigest,
				evidenceDigest: empiricalStrictJsonDigest({ name, message: "bounded-socket-failure" }),
			});
			return Object.freeze({
				result,
				actualCostMicrousd: 0,
				actualElapsedMs: Math.max(0, Math.ceil(input.monotonicNowMs() - started)),
				conversation: input.conversation,
				rawToolIntents: Object.freeze([]),
			});
		}
		throw error;
	}
	const elapsed = safeInteger(
		Math.max(0, Math.ceil(input.monotonicNowMs() - started)),
		"d723.elapsed",
		{ max: 7_200_000 },
	);
	if (response.status !== 200) {
		return Object.freeze({
			result: retryFailure(
				input.effectRequest,
				response.status,
				response.retryAfterMs,
				response.body,
			),
			actualCostMicrousd: 0,
			actualElapsedMs: elapsed,
			conversation: input.conversation,
			rawToolIntents: Object.freeze([]),
		});
	}
	const root = parseJsonBytes(response.body, "d723.providerResponse");
	const usage = record(root.usage, "d723.providerResponse.usage");
	const promptTokens = safeInteger(usage.prompt_tokens, "d723.usage.promptTokens", {
		max: 40_000_000,
	});
	const completionTokens = safeInteger(usage.completion_tokens, "d723.usage.completionTokens", {
		max: 12_582_912,
	});
	const cost =
		typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0
			? safeInteger(Math.ceil(usage.cost * 1_000_000), "d723.usage.cost", { max: 6_000_000 })
			: Math.ceil(promptTokens * 0.08 + completionTokens * 0.18);
	const choices = array(root.choices, "d723.providerResponse.choices");
	if (choices.length !== 1) throw new TypeError("D723 provider returned an invalid choice count");
	const choice = record(choices[0], "d723.providerResponse.choice");
	const message = record(choice.message, "d723.providerResponse.message");
	const finishReason = choice.finish_reason;
	const nextMessages = [...messages];
	const rawToolIntents: D723RawToolIntentV1[] = [];
	if (finishReason === "tool_calls") {
		const calls = array(message.tool_calls, "d723.providerResponse.toolCalls");
		if (calls.length < 1 || calls.length > 32)
			throw new TypeError("D723 tool-call count is invalid");
		for (const [index, rawCall] of calls.entries()) {
			const call = record(rawCall, `d723.providerResponse.toolCalls[${index}]`);
			const fn = record(call.function, `d723.providerResponse.toolCalls[${index}].function`);
			if (
				typeof call.id !== "string" ||
				call.id.length < 1 ||
				call.id.length > 256 ||
				typeof fn.name !== "string" ||
				typeof fn.arguments !== "string" ||
				fn.arguments.length > 65_536
			)
				throw new TypeError("D723 provider tool call is outside the bound");
			const toolRef = TOOL_REFS.get(fn.name);
			if (toolRef === undefined) throw new TypeError("D723 provider selected an unknown tool");
			let args: unknown;
			try {
				args = JSON.parse(fn.arguments);
			} catch {
				throw new TypeError("D723 tool arguments are not JSON");
			}
			const argumentsValue = strictSnapshot(args) as StrictJsonValue;
			const intentDigest = empiricalStrictJsonDigest({
				toolCallRef: call.id,
				toolRef,
				arguments: argumentsValue,
			});
			rawToolIntents.push(
				Object.freeze({ toolCallRef: call.id, toolRef, intentDigest, arguments: argumentsValue }),
			);
		}
		nextMessages.push(
			strictSnapshot({ role: "assistant", content: null, tool_calls: calls }) as StrictJsonValue,
		);
	} else if (finishReason === "stop") {
		nextMessages.push(
			strictSnapshot({
				role: "assistant",
				content: typeof message.content === "string" ? message.content.slice(0, 32_768) : "",
			}) as StrictJsonValue,
		);
	} else {
		throw new TypeError("D723 provider finish reason is invalid");
	}
	const routeEvidence = record(
		root.openrouter_metadata,
		"d723.providerResponse.openrouterMetadata",
	);
	const available = array(
		record(routeEvidence.endpoints, "d723.providerResponse.endpoints").available,
		"d723.providerResponse.availableEndpoints",
	);
	if (
		!available.some((entry) => {
			const endpoint = record(entry, "d723.providerResponse.endpoint");
			return (
				endpoint.provider === OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME &&
				endpoint.model === OPENROUTER_DEEPSEEK_V4_FLASH_SELECTED_MODEL &&
				endpoint.selected === true
			);
		})
	)
		throw new TypeError("D723 provider route evidence drifted");
	const result: D720EffectResultV1 = Object.freeze({
		effectKind: "provider-request",
		status: rawToolIntents.length > 0 ? "tool-intents" : "structured-final",
		toolIntents: Object.freeze(
			rawToolIntents.map(({ toolRef, intentDigest }) => Object.freeze({ toolRef, intentDigest })),
		),
		failureDiscriminator: "none",
		retryAfterMs: null,
		workspaceStateDigest: input.effectRequest.workspaceStateDigest,
		evidenceDigest: empiricalStrictJsonDigest({
			requestDigest: input.effectRequest.requestDigest,
			responseId: root.id,
			usage: { promptTokens, completionTokens, cost },
			routeDigest: empiricalStrictJsonDigest(routeEvidence),
		}),
	});
	return Object.freeze({
		result,
		actualCostMicrousd: cost,
		actualElapsedMs: elapsed,
		conversation: Object.freeze({ messages: Object.freeze(nextMessages) }),
		rawToolIntents: Object.freeze(rawToolIntents),
	});
}

export function appendD723ToolResult(
	conversation: D723OpenRouterConversationV1,
	intent: D723RawToolIntentV1,
	result: StrictJsonValue,
): D723OpenRouterConversationV1 {
	const messages = array(
		conversation.messages,
		"d723.conversation.messages",
	) as readonly StrictJsonValue[];
	return Object.freeze({
		messages: Object.freeze([
			...messages,
			strictSnapshot({
				role: "tool",
				tool_call_id: intent.toolCallRef,
				content: JSON.stringify(result),
			}) as StrictJsonValue,
		]),
	});
}
