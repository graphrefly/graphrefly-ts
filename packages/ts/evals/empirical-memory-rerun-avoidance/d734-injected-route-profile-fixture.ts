import type { StrictJsonValue } from "../../src/json/codec.js";
import { empiricalStrictJsonDigest } from "./canonical.js";
import type {
	D720EffectResultV1,
	D720GraphEffectRequestV1,
	D720ToolRef,
} from "./d722-graph-native-effect-runtime.js";
import type { D720CallerEffectExecutionInputV2 } from "./d722-graph-native-eval.js";
import {
	createD722InjectedModelFixture,
	invokeD722InjectedModelFixture,
} from "./d722-injected-model-fixture.js";
import type {
	D733GraphNativeRouteAdmissionV1,
	D733GraphNativeRouteProfileV1,
} from "./d733-graph-native-route-profile.js";
import {
	createD734RouteBoundProviderAdapter,
	type D734RouteBoundProviderAdapterV1,
	invokeD734RouteBoundOpenRouterTurn,
} from "./d734-route-profile-provider-integration.js";
import type { OpenRouterResponsesTransportResponseV1 } from "./openrouter-responses-model-turn.js";

const encoder = new TextEncoder();
const toolNames: Readonly<Record<D720ToolRef, string>> = Object.freeze({
	"read-file": "read_file",
	"search-repository": "search_repository",
	"replace-exact": "replace_exact",
	"workspace-diff": "workspace_diff",
	"focused-validation": "focused_validation",
});

const digest = (value: unknown): string => empiricalStrictJsonDigest(value);

function argumentsFor(toolRef: D720ToolRef): StrictJsonValue {
	switch (toolRef) {
		case "read-file":
			return { path: "fixture.ts" };
		case "search-repository":
			return { query: "fixture" };
		case "replace-exact":
			return { path: "fixture.ts", oldText: "before", newText: "after" };
		case "workspace-diff":
		case "focused-validation":
			return {};
	}
}

function successfulResponse(
	profile: D733GraphNativeRouteProfileV1,
	request: D720GraphEffectRequestV1,
	result: D720EffectResultV1,
): OpenRouterResponsesTransportResponseV1 {
	if (result.effectKind !== "provider-request")
		throw new TypeError("D734 injected model returned a non-provider result");
	const toolCalls = result.toolIntents.map((intent, index) => ({
		id: `d734-${request.runSequence}-${request.effectSequence}-${index}`,
		type: "function",
		function: {
			name: toolNames[intent.toolRef],
			arguments: JSON.stringify(argumentsFor(intent.toolRef)),
		},
	}));
	return Object.freeze({
		status: 200,
		retryAfterMs: null,
		body: encoder.encode(
			JSON.stringify({
				id: `d734-response-${request.runSequence}-${request.effectSequence}`,
				usage: { prompt_tokens: 17, completion_tokens: 11 },
				choices: [
					toolCalls.length > 0
						? { finish_reason: "tool_calls", message: { content: null, tool_calls: toolCalls } }
						: { finish_reason: "stop", message: { content: '{"completed":true}' } },
				],
				openrouter_metadata: {
					endpoints: {
						available: [
							{
								provider: profile.providerName,
								model: profile.selectedEndpointModel,
								selected: true,
							},
						],
					},
				},
			}),
		),
	});
}

function retryResponse(
	request: D720GraphEffectRequestV1,
	result: Extract<D720EffectResultV1, { effectKind: "provider-request" }>,
): OpenRouterResponsesTransportResponseV1 {
	switch (result.failureDiscriminator) {
		case "d671-rate-limit-exceeded":
			return Object.freeze({
				status: 429,
				retryAfterMs: 7_000,
				retryAfterDisposition: "parsed" as const,
				body: encoder.encode('{"error":{"type":"rate_limit_exceeded"}}'),
			});
		case "d671-provider-overloaded":
			return Object.freeze({
				status: 503,
				retryAfterMs: 7_000,
				retryAfterDisposition: "parsed" as const,
				body: encoder.encode('{"error":{"type":"provider_overloaded"}}'),
			});
		case "d710-untyped-http-429":
			return Object.freeze({
				status: 429,
				retryAfterMs: null,
				retryAfterDisposition: "absent" as const,
				body: encoder.encode('{"error":{"message":"bounded retry"}}'),
			});
		case "d675-und-err-socket":
			throw new Error(`UND_ERR_SOCKET:d734-injected-${request.runSequence}`);
		default:
			throw new TypeError("D734 injected retry discriminator is invalid");
	}
}

export interface D734InjectedRouteProfileFixtureV1 {
	readonly adapter: D734RouteBoundProviderAdapterV1;
	readonly providerCalls: () => number;
	readonly networkCalls: () => 0;
	readonly maxActiveInvocations: () => 0 | 1;
	readonly activeWorkspaceCount: () => number;
	readonly capturedWireBodies: () => readonly Uint8Array[];
}

export function createD734InjectedRouteProfileFixture(inputValue: {
	readonly profile: D733GraphNativeRouteProfileV1;
	readonly routeAdmission: D733GraphNativeRouteAdmissionV1;
	readonly executionClass?: "injected-no-network" | "live-provider";
	readonly objectivePhaseViolationBeforeMutation?: boolean;
	readonly objectivePhaseViolationAfterInspectionPrefix?: boolean;
	readonly inspectionSaturationBeforeMutation?: boolean;
	readonly inspectionOverflowBeforeMutation?: boolean;
	readonly wrongRecoveryFirstTool?: boolean;
	readonly armLocalToolRejectionAfterMutation?: boolean;
	readonly armLocalOutOfOrderAfterMutation?: boolean;
	readonly providerTurnLoopAfterInspection?: boolean;
	readonly phaseScopedObjectiveRecovery?: boolean;
	readonly repeatedPhaseScopedRecovery?: boolean;
}): D734InjectedRouteProfileFixtureV1 {
	const profile = inputValue.profile;
	const model = createD722InjectedModelFixture();
	const workspaces = new Map<number, string>();
	const wireBodies: Uint8Array[] = [];
	const providerTurnsByRun = new Map<number, number>();
	const mutatedRuns = new Set<number>();
	const rejectedToolRuns = new Set<number>();
	let providerCalls = 0;
	let active = 0;
	let maxActive: 0 | 1 = 0;
	const enter = (): void => {
		if (active !== 0) throw new TypeError("D734 injected fixture observed parallel effects");
		active = 1;
		maxActive = 1;
	};
	const leave = (): void => {
		active = 0;
	};
	const phaseRecoveryResult = (request: D720GraphEffectRequestV1): D720EffectResultV1 => {
		const turn = (providerTurnsByRun.get(request.runSequence) ?? 0) + 1;
		providerTurnsByRun.set(request.runSequence, turn);
		const toolRefs: readonly D720ToolRef[] = inputValue.providerTurnLoopAfterInspection
			? turn === 1
				? ["read-file"]
				: ["replace-exact"]
			: inputValue.phaseScopedObjectiveRecovery || inputValue.repeatedPhaseScopedRecovery
				? request.completionContext === undefined
					? request.phaseBefore === "none"
						? ["read-file", "read-file", "read-file", "read-file"]
						: request.phaseBefore === "inspection"
							? ["search-repository", "search-repository"]
							: request.phaseBefore === "exact-mutation"
								? ["focused-validation"]
								: request.phaseBefore === "workspace-diff"
									? inputValue.repeatedPhaseScopedRecovery
										? ["replace-exact"]
										: []
									: []
					: [
							request.completionContext.nextRequiredPhase === "inspection"
								? "read-file"
								: request.completionContext.nextRequiredPhase === "exact-mutation"
									? "replace-exact"
									: request.completionContext.nextRequiredPhase === "workspace-diff"
										? "workspace-diff"
										: "focused-validation",
						]
				: inputValue.armLocalOutOfOrderAfterMutation
					? turn === 1
						? ["read-file"]
						: request.completionContext?.reason === "objective-phase-policy-violation"
							? ["replace-exact"]
							: turn === 2
								? ["workspace-diff"]
								: ["focused-validation"]
					: inputValue.inspectionSaturationBeforeMutation ||
							inputValue.inspectionOverflowBeforeMutation
						? turn === 1
							? ["read-file", "read-file", "read-file", "read-file"]
							: turn === 2
								? inputValue.inspectionOverflowBeforeMutation
									? ["search-repository", "search-repository", "search-repository"]
									: ["search-repository", "search-repository"]
								: request.completionContext?.reason === "objective-phase-policy-violation"
									? inputValue.wrongRecoveryFirstTool
										? ["search-repository"]
										: inputValue.armLocalToolRejectionAfterMutation
											? ["replace-exact"]
											: ["replace-exact", "workspace-diff", "focused-validation"]
									: inputValue.armLocalToolRejectionAfterMutation && turn === 4
										? ["read-file"]
										: []
						: turn === 1
							? ["read-file"]
							: request.completionContext?.reason === "objective-phase-policy-violation"
								? ["replace-exact", "workspace-diff", "focused-validation"]
								: turn === 2
									? inputValue.objectivePhaseViolationAfterInspectionPrefix
										? ["search-repository", "workspace-diff"]
										: ["workspace-diff", "focused-validation"]
									: [];
		return Object.freeze({
			effectKind: "provider-request" as const,
			status: toolRefs.length === 0 ? ("structured-final" as const) : ("tool-intents" as const),
			toolIntents: Object.freeze(
				toolRefs.map((toolRef, index) =>
					Object.freeze({
						toolRef,
						intentDigest: digest({ run: request.runSequence, turn, index, toolRef }),
					}),
				),
			),
			failureDiscriminator: "none" as const,
			retryAfterMs: null,
			workspaceStateDigest: request.workspaceStateDigest!,
			evidenceDigest: digest({ run: request.runSequence, turn, toolRefs }),
		});
	};
	const adapter = createD734RouteBoundProviderAdapter({
		...(inputValue.executionClass === undefined
			? {}
			: { executionClass: inputValue.executionClass }),
		routeAdmission: inputValue.routeAdmission,
		async materialization({ effectRequest }) {
			enter();
			try {
				const workspace = digest({ d734: "workspace", run: effectRequest.runSequence });
				workspaces.set(effectRequest.runSequence, workspace);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "materialization",
						status: "ready",
						workspaceStateDigest: workspace,
						evidenceDigest: digest({ effectRequest, materialized: true }),
					},
				};
			} finally {
				leave();
			}
		},
		async providerRequest(executionInput: Readonly<D720CallerEffectExecutionInputV2>) {
			enter();
			try {
				return await invokeD734RouteBoundOpenRouterTurn({
					effectRequest: executionInput.effectRequest,
					credential: {
						bearerToken: "not-a-live-d734-injected-credential",
						credentialBindingRef: "d734.injected-no-network",
						credentialBindingRevision: "v1",
					},
					transport: {
						async request(request) {
							providerCalls += 1;
							wireBodies.push(new Uint8Array(request.body));
							const result =
								inputValue.objectivePhaseViolationBeforeMutation ||
								inputValue.phaseScopedObjectiveRecovery ||
								inputValue.repeatedPhaseScopedRecovery ||
								inputValue.armLocalOutOfOrderAfterMutation ||
								inputValue.providerTurnLoopAfterInspection ||
								inputValue.inspectionSaturationBeforeMutation ||
								inputValue.inspectionOverflowBeforeMutation
									? phaseRecoveryResult(executionInput.effectRequest)
									: await invokeD722InjectedModelFixture(model, executionInput.effectRequest);
							return result.effectKind === "provider-request" &&
								result.status === "retryable-failure"
								? retryResponse(executionInput.effectRequest, result)
								: successfulResponse(profile, executionInput.effectRequest, result);
						},
					},
					taskStatement: "D734 injected six-arm route-profile qualification",
					conversation: { messages: [] },
					signal: executionInput.signal ?? new AbortController().signal,
					monotonicNowMs: () => providerCalls,
					routeAdmission: inputValue.routeAdmission,
				});
			} finally {
				leave();
			}
		},
		async retryWait({ effectRequest }) {
			enter();
			try {
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: effectRequest.retryAfterMs ?? 60_000,
					result: {
						effectKind: "retry-wait",
						status: "completed",
						evidenceDigest: digest({ effectRequest, waited: true }),
					},
				};
			} finally {
				leave();
			}
		},
		async toolAction({ effectRequest }) {
			enter();
			try {
				const intent = effectRequest.toolIntent;
				if (intent === null) throw new TypeError("D734 tool action omitted its intent");
				const before = workspaces.get(effectRequest.runSequence);
				if (before === undefined) throw new TypeError("D734 tool action omitted its workspace");
				if (
					inputValue.armLocalToolRejectionAfterMutation &&
					intent.toolRef === "read-file" &&
					mutatedRuns.has(effectRequest.runSequence) &&
					!rejectedToolRuns.has(effectRequest.runSequence)
				) {
					rejectedToolRuns.add(effectRequest.runSequence);
					return {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "tool-action" as const,
							toolRef: intent.toolRef,
							intentDigest: intent.intentDigest,
							status: "failed" as const,
							nonEmptyDiff: false,
							workspaceStateBeforeDigest: before,
							workspaceStateAfterDigest: before,
							evidenceDigest: digest({ effectRequest, boundedToolRejection: true }),
						},
					};
				}
				const after =
					intent.toolRef === "replace-exact"
						? digest({ before, mutation: intent.intentDigest })
						: before;
				if (intent.toolRef === "replace-exact") mutatedRuns.add(effectRequest.runSequence);
				workspaces.set(effectRequest.runSequence, after);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "tool-action",
						toolRef: intent.toolRef,
						intentDigest: intent.intentDigest,
						status: "succeeded",
						nonEmptyDiff: intent.toolRef === "workspace-diff",
						workspaceStateBeforeDigest: before,
						workspaceStateAfterDigest: after,
						evidenceDigest: digest({ effectRequest, succeeded: true }),
					},
				};
			} finally {
				leave();
			}
		},
		async hiddenVerifier({ effectRequest }) {
			enter();
			try {
				const workspace = workspaces.get(effectRequest.runSequence);
				if (workspace === undefined) throw new TypeError("D734 verifier omitted its workspace");
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "hidden-verifier",
						status: "passed",
						workspaceStateDigest: workspace,
						evidenceDigest: digest({ effectRequest, passed: true }),
					},
				};
			} finally {
				leave();
			}
		},
		async cleanup({ effectRequest }) {
			enter();
			try {
				workspaces.delete(effectRequest.runSequence);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "cleanup",
						status: "succeeded",
						evidenceDigest: digest({ effectRequest, cleaned: true }),
					},
				};
			} finally {
				leave();
			}
		},
	});
	return Object.freeze({
		adapter,
		providerCalls: () => providerCalls,
		networkCalls: () => 0 as const,
		maxActiveInvocations: () => maxActive,
		activeWorkspaceCount: () => workspaces.size,
		capturedWireBodies: () => Object.freeze(wireBodies.map((body) => new Uint8Array(body))),
	});
}
