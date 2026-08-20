import { empiricalStrictJsonDigest, record, strictSnapshot } from "./canonical.js";
import {
	type CurrentGraphOpenRouterAdapterOptionsV1,
	createCurrentGraphOpenRouterExecutor,
} from "./d8-current-openrouter-adapter.js";
import {
	type D34ProjectedProposalV1,
	lowerD34RetainedSpanChatBody,
	projectD34RetainedSpanChatResponse,
} from "./d34-retained-span-chat-wire.js";
import {
	type D34AdmittedEffectV1,
	type D34NewTextProposalResultV1,
	type D34RetainedSpanAuthorityV1,
	takeD34AdmittedEffect,
} from "./d34-retained-span-mutation-authority.js";

export const D35_DECISION_REF = "graphrefly-ts:D35" as const;
export const D35_ADAPTER_REVISION =
	"graphrefly-ts.d35.retained-span-real-provider-composition.v1" as const;
export const D35_MAX_PROVIDER_BYTES = 2 * 1_048_576;

export interface D35RetainedSpanRealProviderOptionsV1
	extends Omit<CurrentGraphOpenRouterAdapterOptionsV1, "fetchImpl"> {
	readonly authority: D34RetainedSpanAuthorityV1;
	readonly fetchImpl: typeof fetch;
}

export interface D35RetainedSpanRealProviderExecutorV1 {
	readonly executeNext: () => Promise<Readonly<{
		admitted: D34AdmittedEffectV1;
		result: unknown;
	}> | null>;
	readonly dispose: () => Promise<void>;
}

interface ActiveRetainedRequest {
	readonly admitted: D34AdmittedEffectV1;
	projection: D34ProjectedProposalV1 | null;
}

interface PendingRetainedMutation {
	readonly newText: string;
}

function bodyBytes(value: unknown): Uint8Array {
	if (typeof value === "string") return Buffer.from(value, "utf8");
	if (value instanceof Uint8Array) return new Uint8Array(value);
	throw new TypeError("D35 provider request body is not bounded bytes");
}

async function projectSuccessfulResponse(
	response: Response,
	active: ActiveRetainedRequest,
): Promise<Response> {
	if (!response.ok) return response;
	const declared = response.headers.get("content-length");
	if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > D35_MAX_PROVIDER_BYTES))
		throw new TypeError("D35 provider response exceeded its declared bound");
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > D35_MAX_PROVIDER_BYTES)
		throw new TypeError("D35 provider response exceeded its byte bound");
	const directive = active.admitted.retainedSpanDirective;
	if (directive === null) throw new TypeError("D35 retained-span directive is missing");
	active.projection = projectD34RetainedSpanChatResponse({ responseBytes: bytes, directive });
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
	} catch (error) {
		throw new TypeError("D35 provider response is not JSON", { cause: error });
	}
	const root = record(value, "D35 provider response");
	if (!Array.isArray(root.choices) || root.choices.length !== 1)
		throw new TypeError("D35 provider response choices drifted");
	record(record(root.choices[0], "D35 provider response choice").message, "D35 response message");
	const usage = record(root.usage, "D35 provider response usage");
	const promptTokens = usage.prompt_tokens;
	const completionTokens = usage.completion_tokens;
	const details = record(usage.prompt_tokens_details, "D35 provider response usage details");
	const cachedTokens = details.cached_tokens;
	if (
		!Number.isSafeInteger(promptTokens) ||
		(promptTokens as number) < 0 ||
		!Number.isSafeInteger(completionTokens) ||
		(completionTokens as number) < 0 ||
		!Number.isSafeInteger(cachedTokens) ||
		(cachedTokens as number) < 0 ||
		(cachedTokens as number) > (promptTokens as number)
	)
		throw new TypeError("D35 provider response usage drifted");
	const compatibility = strictSnapshot({
		choices: [
			{
				message: {
					role: "assistant" as const,
					content: null,
					tool_calls: [
						{
							id: "d35-mechanical-projection",
							type: "function" as const,
							function: {
								name: "replace_exact",
								arguments: JSON.stringify({
									path: "src/current.ts",
									oldText: "d35-mechanical-placeholder-old",
									newText: "d35-mechanical-placeholder-new",
								}),
							},
						},
					],
				},
			},
		],
		usage: {
			prompt_tokens: promptTokens as number,
			completion_tokens: completionTokens as number,
			prompt_tokens_details: { cached_tokens: cachedTokens as number },
		},
	});
	const compatibilityBytes = Buffer.from(JSON.stringify(compatibility), "utf8");
	if (compatibilityBytes.byteLength > D35_MAX_PROVIDER_BYTES)
		throw new TypeError("D35 compatibility response exceeded its byte bound");
	const headers = new Headers(response.headers);
	headers.delete("content-length");
	return new Response(compatibilityBytes, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export function createD35RetainedSpanRealProviderExecutor(
	options: D35RetainedSpanRealProviderOptionsV1,
): D35RetainedSpanRealProviderExecutorV1 {
	const { authority, fetchImpl, ...baseOptions } = options;
	let active: ActiveRetainedRequest | null = null;
	let pendingMutation: PendingRetainedMutation | null = null;
	let executing = false;
	const retryBodies = new Map<string, Uint8Array>();
	const discardedRejectedTranscripts = new Set<string>();
	const base = createCurrentGraphOpenRouterExecutor({
		...baseOptions,
		fetchImpl: async (url, init) => {
			const current = active;
			if (current === null) return fetchImpl(url, init);
			const request = current.admitted.effect.effect.request;
			const directive = current.admitted.retainedSpanDirective;
			if (
				request.effectKind !== "provider-request" ||
				request.logicalRequestDigest === null ||
				directive === null
			)
				throw new TypeError("D35 active retained provider request drifted");
			const lowered = lowerD34RetainedSpanChatBody({
				bodyBytes: bodyBytes(init?.body),
				directive,
			});
			const prior = retryBodies.get(request.logicalRequestDigest);
			if (prior !== undefined && !Buffer.from(prior).equals(Buffer.from(lowered.bytes)))
				throw new TypeError("D35 retained-span retry wire bytes drifted");
			retryBodies.set(request.logicalRequestDigest, lowered.bytes);
			const response = await fetchImpl(url, { ...init, body: lowered.bytes });
			return projectSuccessfulResponse(response, current);
		},
	});
	return Object.freeze({
		async executeNext() {
			if (executing) throw new TypeError("D35 observed parallel admitted effects");
			const admitted = takeD34AdmittedEffect(authority);
			if (admitted === null) return null;
			executing = true;
			const request = admitted.effect.effect.request;
			try {
				if (admitted.retainedSpanDirective !== null) {
					const logicalRequestDigest = request.logicalRequestDigest;
					if (logicalRequestDigest === null)
						throw new TypeError("D35 retained logical request digest is missing");
					if (!discardedRejectedTranscripts.has(logicalRequestDigest)) {
						base.discardRejectedUnchangedReplacementTranscript(admitted.effect.effect);
						discardedRejectedTranscripts.add(logicalRequestDigest);
					}
				}
				if (
					request.effectKind === "tool-action" &&
					request.toolRef === "replace-exact" &&
					pendingMutation !== null
				) {
					base.admitGraphAuthoredRetainedMutation(admitted.effect.effect, {
						toolName: "propose_replacement_text",
						newText: pendingMutation.newText,
					});
					pendingMutation = null;
				} else if (
					request.effectKind === "tool-action" &&
					request.toolRef === "workspace-diff" &&
					pendingMutation === null
				) {
					base.admitGraphAuthoredToolCalls(admitted.effect.effect, [
						"workspace-diff",
						"focused-validation",
					]);
				} else if (pendingMutation !== null) {
					throw new TypeError("D35 retained mutation was not the next Graph-admitted effect");
				}
				active = admitted.retainedSpanDirective === null ? null : { admitted, projection: null };
				const baseResult = await base.execute(admitted.effect.effect);
				if (active === null || baseResult.effectKind !== "provider-request")
					return Object.freeze({ admitted, result: baseResult });
				if (baseResult.status !== "completed")
					return Object.freeze({ admitted, result: baseResult });
				const projection = active.projection;
				if (projection === null)
					throw new TypeError("D35 retained-span response projection is missing");
				base.discardMechanicalProviderToolCalls(admitted.effect.effect, ["replace-exact"]);
				pendingMutation =
					projection.proposalCount === 1 ? { newText: projection.newTextProposals[0]! } : null;
				const result: D34NewTextProposalResultV1 = Object.freeze({
					effectKind: "provider-request",
					status: "completed",
					newTextProposals: projection.newTextProposals,
					usage: baseResult.usage,
					evidenceDigest: empiricalStrictJsonDigest({
						revision: D35_ADAPTER_REVISION,
						requestDigest: request.requestDigest,
						directiveDigest: admitted.retainedSpanDirective?.directiveDigest,
						providerEvidenceDigest: baseResult.evidenceDigest,
						projectionDigest: projection.projectionDigest,
					}),
				});
				return Object.freeze({ admitted, result });
			} finally {
				active = null;
				executing = false;
			}
		},
		async dispose() {
			if (executing) throw new TypeError("D35 cannot dispose an active effect");
			active = null;
			pendingMutation = null;
			retryBodies.clear();
			discardedRejectedTranscripts.clear();
			await base.dispose();
		},
	});
}
