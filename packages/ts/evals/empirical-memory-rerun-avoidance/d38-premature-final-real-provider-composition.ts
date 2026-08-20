import { empiricalStrictJsonDigest, record } from "./canonical.js";
import {
	type CurrentGraphOpenRouterAdapterOptionsV1,
	createCurrentGraphOpenRouterExecutor,
} from "./d8-current-openrouter-adapter.js";
import {
	type D34ProjectedProposalV1,
	lowerD34RetainedSpanChatBody,
	projectD34RetainedSpanChatResponse,
} from "./d34-retained-span-chat-wire.js";
import type {
	D34AdmittedEffectV1,
	D34NewTextProposalResultV1,
	D34RetainedSpanAuthorityV1,
} from "./d34-retained-span-mutation-authority.js";

export const D38_DECISION_REF = "graphrefly-ts:D38" as const;
export const D38_ADAPTER_REVISION =
	"graphrefly-ts.d38.premature-final-real-provider-composition.v1" as const;
export const D38_MAX_PROVIDER_BYTES = 2 * 1_048_576;

export interface D38PrematureFinalRealProviderOptionsV1
	extends Omit<CurrentGraphOpenRouterAdapterOptionsV1, "fetchImpl"> {
	readonly authority: D34RetainedSpanAuthorityV1;
	readonly fetchImpl: typeof fetch;
}

export interface D38PrematureFinalRealProviderExecutorV1 {
	readonly execute: (admitted: D34AdmittedEffectV1) => Promise<
		Readonly<{
			admitted: D34AdmittedEffectV1;
			result: unknown;
		}>
	>;
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
	throw new TypeError("D38 provider request body is not bounded bytes");
}

async function projectSuccessfulResponse(
	response: Response,
	active: ActiveRetainedRequest,
): Promise<Response> {
	if (!response.ok) return response;
	const declared = response.headers.get("content-length");
	if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > D38_MAX_PROVIDER_BYTES))
		throw new TypeError("D38 provider response exceeded its declared bound");
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > D38_MAX_PROVIDER_BYTES)
		throw new TypeError("D38 provider response exceeded its byte bound");
	const passThrough = () => {
		const headers = new Headers(response.headers);
		headers.delete("content-length");
		return new Response(bytes, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	};
	const directive = active.admitted.retainedSpanDirective;
	if (directive === null) throw new TypeError("D38 retained-span directive is missing");
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
	} catch {
		return passThrough();
	}
	let root: Record<string, unknown>;
	let message: Record<string, unknown>;
	try {
		root = record(value, "D38 provider response");
		if (!Array.isArray(root.choices) || root.choices.length !== 1) return passThrough();
		message = record(
			record(root.choices[0], "D38 provider response choice").message,
			"D38 response message",
		);
	} catch {
		return passThrough();
	}
	const calls = message.tool_calls;
	if (
		message.role === "assistant" &&
		(calls === undefined || (Array.isArray(calls) && calls.length === 0)) &&
		typeof message.content === "string" &&
		Buffer.byteLength(message.content, "utf8") <= 262_144
	) {
		return passThrough();
	}
	if (message.role !== "assistant" || !Array.isArray(calls) || calls.length === 0)
		return passThrough();
	try {
		for (const [index, value] of calls.entries()) {
			const call = record(value, `D38 response tool_calls[${index}]`);
			if (
				typeof call.id !== "string" ||
				call.id.length === 0 ||
				Buffer.byteLength(call.id, "utf8") > 256 ||
				call.type !== "function"
			)
				return passThrough();
			record(call.function, `D38 response tool_calls[${index}].function`);
		}
	} catch {
		return passThrough();
	}
	try {
		active.projection = projectD34RetainedSpanChatResponse({ responseBytes: bytes, directive });
	} catch {
		return passThrough();
	}
	const compatibility = {
		choices: [
			{
				message: {
					role: "assistant" as const,
					content: null,
					tool_calls: [
						{
							id: "d38-mechanical-projection",
							type: "function" as const,
							function: {
								name: "replace_exact",
								arguments: JSON.stringify({
									path: "src/current.ts",
									oldText: "d38-mechanical-placeholder-old",
									newText: "d38-mechanical-placeholder-new",
								}),
							},
						},
					],
				},
			},
		],
		...(Object.hasOwn(root, "usage") ? { usage: root.usage } : {}),
	};
	const compatibilityBytes = Buffer.from(JSON.stringify(compatibility), "utf8");
	if (compatibilityBytes.byteLength > D38_MAX_PROVIDER_BYTES)
		throw new TypeError("D38 compatibility response exceeded its byte bound");
	const headers = new Headers(response.headers);
	headers.delete("content-length");
	return new Response(compatibilityBytes, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export function createD38PrematureFinalRealProviderExecutor(
	options: D38PrematureFinalRealProviderOptionsV1,
): D38PrematureFinalRealProviderExecutorV1 {
	const { authority, fetchImpl, ...baseOptions } = options;
	void authority;
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
				throw new TypeError("D38 active retained provider request drifted");
			const lowered = lowerD34RetainedSpanChatBody({
				bodyBytes: bodyBytes(init?.body),
				directive,
			});
			const prior = retryBodies.get(request.logicalRequestDigest);
			if (prior !== undefined && !Buffer.from(prior).equals(Buffer.from(lowered.bytes)))
				throw new TypeError("D38 retained-span retry wire bytes drifted");
			retryBodies.set(request.logicalRequestDigest, lowered.bytes);
			const response = await fetchImpl(url, { ...init, body: lowered.bytes });
			return projectSuccessfulResponse(response, current);
		},
	});
	return Object.freeze({
		async execute(admitted: D34AdmittedEffectV1) {
			if (executing) throw new TypeError("D38 observed parallel admitted effects");
			executing = true;
			const request = admitted.effect.effect.request;
			try {
				if (admitted.retainedSpanDirective !== null) {
					const logicalRequestDigest = request.logicalRequestDigest;
					if (logicalRequestDigest === null)
						throw new TypeError("D38 retained logical request digest is missing");
					const retainedSpanDigest = admitted.retainedSpanDirective.spanFactDigest;
					if (!discardedRejectedTranscripts.has(retainedSpanDigest)) {
						base.discardRejectedUnchangedReplacementTranscript(admitted.effect.effect);
						discardedRejectedTranscripts.add(retainedSpanDigest);
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
					throw new TypeError("D38 retained mutation was not the next Graph-admitted effect");
				}
				active = admitted.retainedSpanDirective === null ? null : { admitted, projection: null };
				const baseResult = await base.execute(admitted.effect.effect);
				if (active === null || baseResult.effectKind !== "provider-request")
					return Object.freeze({ admitted, result: baseResult });
				if (baseResult.status !== "completed")
					return Object.freeze({ admitted, result: baseResult });
				const projection = active.projection;
				if (projection === null) {
					base.discardMechanicalProviderToolCalls(
						admitted.effect.effect,
						baseResult.toolCalls.map((call) => call.toolRef),
					);
					return Object.freeze({
						admitted,
						result: Object.freeze({
							effectKind: "provider-request" as const,
							status: "failed" as const,
							toolCalls: [] as const,
							failureCode: "provider-failed" as const,
							retryProposal: null,
							usage: baseResult.usage,
							evidenceDigest: empiricalStrictJsonDigest({
								revision: D38_ADAPTER_REVISION,
								requestDigest: request.requestDigest,
								providerEvidenceDigest: baseResult.evidenceDigest,
								disposition: "retained-span-proposal-malformed",
							}),
						}),
					});
				}
				base.discardMechanicalProviderToolCalls(admitted.effect.effect, ["replace-exact"]);
				pendingMutation =
					projection.proposalCount === 1 ? { newText: projection.newTextProposals[0]! } : null;
				const result: D34NewTextProposalResultV1 = Object.freeze({
					effectKind: "provider-request",
					status: "completed",
					newTextProposals: projection.newTextProposals,
					usage: baseResult.usage,
					evidenceDigest: empiricalStrictJsonDigest({
						revision: D38_ADAPTER_REVISION,
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
			if (executing) throw new TypeError("D38 cannot dispose an active effect");
			active = null;
			pendingMutation = null;
			retryBodies.clear();
			discardedRejectedTranscripts.clear();
			await base.dispose();
		},
	});
}
