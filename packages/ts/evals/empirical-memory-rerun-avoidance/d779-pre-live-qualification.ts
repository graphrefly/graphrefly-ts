import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	appendD723ToolResult,
	type D723OpenRouterConversationV1,
	type D723RawToolIntentV1,
} from "./d723-openrouter-graph-turn.js";
import { D733_DEEPSEEK_V4_FLASH_0731_PROFILE } from "./d733-coordinates.js";
import {
	createD733GraphNativeRouteAdmission,
	createD733RouteAccessProjection,
	createD733RouteEligibility,
} from "./d733-graph-native-route-profile.js";
import type { D719RetryReason } from "./d767-clean-graph-ledger.js";
import {
	createD726ArmLocalTerminalProviderPolicy,
	createD761GraphPublicSemanticValidationPolicy,
} from "./d767-graph-native-effect-runtime.js";
import {
	type D771CanonicalGraphEvidenceV1,
	deriveD771CanonicalGraphEvidence,
} from "./d771-graph-completion-memory-insight.js";
import { validateD776RouteEvidence as validateD779RouteEvidence } from "./d776-provider-result-route-authority.js";
import type {
	D778TaskExposureFactV1,
	D778ToolRejectionFactV1,
} from "./d778-graph-task-tool-authority.js";
import { createD778GraphTaskEnvelope } from "./d778-graph-task-tool-authority.js";
import { createD779CallerExecutor, runD779GraphNativeEvalCore } from "./d779-graph-native-eval.js";
import {
	D779_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD779Implementation,
} from "./d779-implementation-manifest.js";
import {
	createD779ProviderResultEnvelope,
	executeD779ToolBoundary,
	invokeD779AdmittedRouteTurnWithState,
	replaceD779ProviderExecutionForQualification,
} from "./d779-provider-capable-composition.js";

export const D779_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d779.inspection-phase-lowering-qualification.v1" as const;
export const D779_GENERATION_SCHEMA =
	"graphrefly.b112.d779.inspection-phase-lowering-generation.v1" as const;
export const D779_BUNDLE_SCHEMA =
	"graphrefly.b112.d779.inspection-phase-lowering-bundle.v1" as const;
export const D779_PERSISTENCE_SCHEMA =
	"graphrefly.b112.d779.inspection-phase-lowering-persistence.v1" as const;
export const D779_GENERATION_REF = "d779-inspection-phase-lowering-no-network-v1" as const;

const LIMITS = Object.freeze({
	maxRequests: 128,
	maxRetryWaits: 12,
	maxCostMicrousd: 6_000_000,
	maxElapsedMs: 7_200_000,
});
const CEILINGS = Object.freeze({
	routeDigest: empiricalStrictJsonDigest({ d779: "injected-no-network-route" }),
	providerMaxCostMicrousd: 50_000,
	providerMaxElapsedMs: 60_000,
	localEffectMaxElapsedMs: 60_000,
});
const SOURCE_DIGEST = empiricalStrictJsonDigest({
	decisionRef: "decision.D779.2026-08-13.v1",
	baseline: "consumed-d778-complete-task-tool-qualification",
	executionClass: "simulated-contract",
});
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const admittedBaselines = new WeakSet<object>();
const constructedBundles = new WeakSet<object>();
const D775_BASELINE_ARTIFACT_SHA256 =
	"sha256:bab5ac3f4f2fbd72b3ab2e2639b6604a1971c877f2f50b9066cf033e3b894ea0" as const;
const D775_BASELINE_BUNDLE_DIGEST =
	"sha256:ae897c69fe4ccd2374c99a5ff2279f0e19c1a5d8525035c60a419a563aaff213" as const;
const D775_BASELINE_GRAPH_EVIDENCE_DIGEST =
	"sha256:1e8f161bbcf9614bd645200fc115878a9765dc6ea5385120257215868f62bfbb" as const;
const D775_BASELINE_ROUTE_EVIDENCE_DIGEST =
	"sha256:9e788a4ce7a6f75a9da2d851a5ab392079c91d1430671c6666e25e653afc43bd" as const;

export interface D779QualificationBundleV1 {
	readonly schemaVersion: typeof D779_BUNDLE_SCHEMA;
	readonly executionClass: "simulated-contract";
	readonly graphEvidence: D771CanonicalGraphEvidenceV1;
	readonly routeEvidence: ReturnType<typeof validateD779RouteEvidence>;
	readonly taskExposureFacts: readonly D778TaskExposureFactV1[];
	readonly toolRejectionFacts: readonly D778ToolRejectionFactV1[];
	readonly wrongToolGraphEvidence: D771CanonicalGraphEvidenceV1;
	readonly wrongToolRouteEvidence: ReturnType<typeof validateD779RouteEvidence>;
	readonly omissionGraphEvidence: D771CanonicalGraphEvidenceV1;
	readonly omissionRouteEvidence: ReturnType<typeof validateD779RouteEvidence>;
	readonly terminalHttpGraphEvidence: D771CanonicalGraphEvidenceV1;
	readonly terminalHttpRouteEvidence: ReturnType<typeof validateD779RouteEvidence>;
	readonly hiddenFailureGraphEvidence: D771CanonicalGraphEvidenceV1;
	readonly hiddenFailureRouteEvidence: ReturnType<typeof validateD779RouteEvidence>;
	readonly toolRejectionGraphEvidence: D771CanonicalGraphEvidenceV1;
	readonly toolRejectionRouteEvidence: ReturnType<typeof validateD779RouteEvidence>;
	readonly diagnosticToolRejectionFacts: readonly D778ToolRejectionFactV1[];
	readonly qualification: Readonly<Record<string, unknown>>;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly bundleDigest: string;
}

export interface D779ConsumedD775BaselineV1 {
	readonly schemaVersion: "graphrefly.b112.d779.consumed-d775-baseline.v1";
	readonly basis: "real-artifact" | "injected-test";
	readonly artifactSha256: typeof D775_BASELINE_ARTIFACT_SHA256;
	readonly bundleDigest: typeof D775_BASELINE_BUNDLE_DIGEST;
	readonly graphEvidenceDigest: typeof D775_BASELINE_GRAPH_EVIDENCE_DIGEST;
	readonly routeEvidenceDigest: typeof D775_BASELINE_ROUTE_EVIDENCE_DIGEST;
	readonly disposition: "qualified";
	readonly receiptDigest: string;
}

export interface D779PersistenceReceiptV1 {
	readonly schemaVersion: typeof D779_PERSISTENCE_SCHEMA;
	readonly generationRef: typeof D779_GENERATION_REF;
	readonly baselineBasis: "real-artifact" | "injected-test";
	readonly bundleDigest: string;
	readonly bundleArtifactDigest: string;
	readonly commitMarkerDigest: string;
	readonly persistenceDigest: string;
}

type RetryReason = Exclude<D719RetryReason, "none">;

function baselineMaterial(basis: "real-artifact" | "injected-test") {
	return strictSnapshot({
		schemaVersion: "graphrefly.b112.d779.consumed-d775-baseline.v1" as const,
		basis,
		artifactSha256: D775_BASELINE_ARTIFACT_SHA256,
		bundleDigest: D775_BASELINE_BUNDLE_DIGEST,
		graphEvidenceDigest: D775_BASELINE_GRAPH_EVIDENCE_DIGEST,
		routeEvidenceDigest: D775_BASELINE_ROUTE_EVIDENCE_DIGEST,
		disposition: "qualified" as const,
	});
}

function validateBaseline(value: unknown): D779ConsumedD775BaselineV1 {
	const candidate = record(value, "d779.baseline");
	exactKeys(
		candidate,
		[
			"artifactSha256",
			"basis",
			"bundleDigest",
			"disposition",
			"graphEvidenceDigest",
			"receiptDigest",
			"routeEvidenceDigest",
			"schemaVersion",
		],
		"d779.baseline",
	);
	if (candidate.basis !== "real-artifact" && candidate.basis !== "injected-test")
		throw new TypeError("D779 baseline basis drifted");
	const material = baselineMaterial(candidate.basis);
	for (const key of Object.keys(material))
		literal(
			candidate[key],
			(material as Readonly<Record<string, string>>)[key]!,
			`d779.baseline.${key}`,
		);
	if (candidate.receiptDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D779 baseline receipt digest drifted");
	return strictSnapshot(candidate) as unknown as D779ConsumedD775BaselineV1;
}

export function admitD779ConsumedD775Baseline(bytes: Uint8Array): D779ConsumedD775BaselineV1 {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 16 * 1_048_576)
		throw new TypeError("D779 D778 baseline bytes are outside the bound");
	literal(empiricalSha256(bytes), D775_BASELINE_ARTIFACT_SHA256, "d779.baseline.sha256");
	const bundle = record(strictJsonCodec.decode(bytes), "d779.baseline.bundle");
	literal(bundle.bundleDigest, D775_BASELINE_BUNDLE_DIGEST, "d779.baseline.bundle.digest");
	const d776Bundle = record(bundle.d776Bundle, "d779.baseline.bundle.d776Bundle");
	const graphEvidence = record(d776Bundle.graphEvidence, "d779.baseline.bundle.graphEvidence");
	const routeEvidence = record(d776Bundle.routeEvidence, "d779.baseline.bundle.routeEvidence");
	literal(
		graphEvidence.evidenceDigest,
		D775_BASELINE_GRAPH_EVIDENCE_DIGEST,
		"d779.baseline.graph.digest",
	);
	literal(
		routeEvidence.evidenceDigest,
		D775_BASELINE_ROUTE_EVIDENCE_DIGEST,
		"d779.baseline.route.digest",
	);
	const material = baselineMaterial("real-artifact");
	const receipt = Object.freeze({
		...material,
		receiptDigest: empiricalStrictJsonDigest(material),
	});
	admittedBaselines.add(receipt);
	return receipt;
}

export function createD779InjectedBaselineForTest(): D779ConsumedD775BaselineV1 {
	const material = baselineMaterial("injected-test");
	const receipt = Object.freeze({
		...material,
		receiptDigest: empiricalStrictJsonDigest(material),
	});
	admittedBaselines.add(receipt);
	return receipt;
}

export const admitD779ConsumedD778Baseline = admitD779ConsumedD775Baseline;

function routeAdmission() {
	const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
	return createD733GraphNativeRouteAdmission({
		profile,
		access: createD733RouteAccessProjection({
			profile,
			observationRevision: "d779.injected-no-network.v1",
			allowedModels: [profile.requestModel],
			allowedProviders: [profile.providerName],
		}),
		eligibility: createD733RouteEligibility({
			profile,
			responseBytes: encoder.encode(
				JSON.stringify({
					data: {
						id: profile.requestModel,
						endpoints: [
							{
								name: `${profile.providerName} | ${profile.selectedEndpointModel}`,
								provider_name: profile.providerName,
								tag: profile.providerTag,
								quantization: profile.quantization,
								model: profile.selectedEndpointModel,
								supported_parameters: ["reasoning", "tool_choice", "tools"],
								pricing: {
									prompt: profile.pricing.promptUsdPerToken,
									completion: profile.pricing.completionUsdPerToken,
									input_cache_read: profile.pricing.cacheReadUsdPerToken,
								},
							},
						],
					},
				}),
			),
		}),
	});
}

async function runInjectedSixArms(
	mode:
		| "positive"
		| "wrong-inspection-tool"
		| "proposal-omission"
		| "terminal-http"
		| "hidden-failure"
		| "tool-rejection" = "positive",
) {
	const workspaces = new Map<number, string>();
	const conversations = new Map<number, D723OpenRouterConversationV1>();
	const rawIntents = new Map<number, Map<string, D723RawToolIntentV1>>();
	const semanticAttempts = new Map<number, number>();
	const hiddenAttempts = new Map<number, number>();
	const retryReasons = new Map<number, RetryReason>([
		[0, "d710-untyped-http-429"],
		[1, "d671-rate-limit-exceeded"],
		[2, "d675-und-err-socket"],
		[3, "d710-untyped-http-429"],
		[4, "d671-rate-limit-exceeded"],
		[5, "d675-und-err-socket"],
	]);
	const retried = new Set<number>();
	const retryBodies = new Map<string, Uint8Array>();
	let active = 0;
	let maxActive = 0;
	let providerCalls = 0;
	let retryWaits = 0;
	let negativeInjected = false;
	const rejectedRuns = new Set<number>();
	const executor = createD779CallerExecutor(async ({ admission, effectRequest, request }) => {
		active += 1;
		maxActive = Math.max(maxActive, active);
		if (active !== 1) throw new TypeError("D779 observed parallel effects");
		try {
			if (effectRequest.effectKind === "materialization") {
				const workspace = empiricalStrictJsonDigest({
					d779: "workspace",
					run: effectRequest.runSequence,
				});
				workspaces.set(effectRequest.runSequence, workspace);
				return createD779ProviderResultEnvelope({
					effectRequest,
					routeProposal: null,
					execution: {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "materialization",
							status: "ready",
							workspaceStateDigest: workspace,
							evidenceDigest: empiricalStrictJsonDigest({ d779: "materialized", effectRequest }),
						},
					},
				});
			}
			const workspace = workspaces.get(effectRequest.runSequence);
			if (effectRequest.effectKind === "provider-request") {
				if (workspace === undefined) throw new TypeError("D779 provider workspace is missing");
				const retryReason = retryReasons.get(effectRequest.runSequence);
				const injectRetry =
					retryReason !== undefined &&
					(effectRequest.runSequence < 3
						? effectRequest.completionContext === undefined
						: effectRequest.completionContext?.nextRequiredPhase === "inspection") &&
					effectRequest.attemptOrdinal === 1 &&
					!retried.has(effectRequest.runSequence);
				if (injectRetry) retried.add(effectRequest.runSequence);
				const routeTurn = await invokeD779AdmittedRouteTurnWithState({
					arm: request.payload!.arm,
					effectRequest: effectRequest as never,
					admission,
					credential: {
						bearerToken: "not-a-live-d779-credential",
						credentialBindingRef: "d779.injected-no-network",
						credentialBindingRevision: "v1",
					},
					signal: new AbortController().signal,
					monotonicNowMs: () => providerCalls,
					routeAdmission: routeAdmission(),
					...(conversations.has(effectRequest.runSequence)
						? { conversation: conversations.get(effectRequest.runSequence)! }
						: {}),
					transport: {
						async request(request) {
							providerCalls += 1;
							const priorBody = retryBodies.get(effectRequest.logicalRequestDigest);
							if (priorBody === undefined)
								retryBodies.set(effectRequest.logicalRequestDigest, request.body.slice());
							else if (!sameBytes(priorBody, request.body))
								throw new TypeError("D779 same-request retry wire body drifted");
							if (injectRetry)
								return {
									status: retryReason === "d710-untyped-http-429" ? 429 : 503,
									retryAfterMs: retryReason === "d710-untyped-http-429" ? 60_000 : 7_000,
									body: encoder.encode(
										retryReason !== "d710-untyped-http-429"
											? '{"error":{"type":"rate_limit_exceeded","code":"rate_limit_exceeded"}}'
											: '{"error":{"message":"bounded untyped 429"}}',
									),
								};
							if (
								mode === "terminal-http" &&
								effectRequest.runSequence === 0 &&
								!negativeInjected
							) {
								negativeInjected = true;
								return {
									status: 400,
									retryAfterMs: null,
									body: encoder.encode('{"error":{"type":"invalid_request_error"}}'),
								};
							}
							const body = record(JSON.parse(decoder.decode(request.body)), "d779.injected.body");
							const choice = body.tool_choice;
							let toolName: string | null = null;
							if (choice !== "none") {
								if (choice === "required" || choice === "auto") toolName = "read_file";
								else
									toolName = record(record(choice, "d779.choice").function, "d779.choice.fn")
										.name as string;
							}
							const injectWrongTool =
								mode === "wrong-inspection-tool" &&
								effectRequest.runSequence === 0 &&
								effectRequest.completionContext?.nextRequiredPhase === "inspection" &&
								toolName === "read_file" &&
								!negativeInjected;
							if (injectWrongTool) {
								negativeInjected = true;
								toolName = "workspace_diff";
							}
							const calls =
								effectRequest.completionContext === undefined && toolName !== null
									? ["workspace_diff"]
									: toolName === null
										? []
										: [toolName];
							return {
								status: 200,
								retryAfterMs: null,
								body: encoder.encode(
									JSON.stringify({
										id: `d779-${providerCalls}`,
										usage: { prompt_tokens: 1, completion_tokens: 1 },
										choices: [
											calls.length === 0
												? { finish_reason: "stop", message: { content: "{}" } }
												: {
														finish_reason: "tool_calls",
														message: {
															content: null,
															tool_calls: calls.map((name, index) => ({
																id: `d779-${providerCalls}-${index}`,
																type: "function",
																function: {
																	name,
																	arguments: JSON.stringify(
																		name === "read_file"
																			? { path: "fixture.ts" }
																			: name === "replace_exact"
																				? {
																						path: "fixture.ts",
																						oldText: "before",
																						newText: "after",
																					}
																				: {},
																	),
																},
															})),
														},
													},
										],
										openrouter_metadata: {
											endpoints: {
												available: [
													{
														provider: D733_DEEPSEEK_V4_FLASH_0731_PROFILE.providerName,
														model: D733_DEEPSEEK_V4_FLASH_0731_PROFILE.selectedEndpointModel,
														selected: true,
													},
												],
											},
										},
									}),
								),
							};
						},
					},
				});
				conversations.set(effectRequest.runSequence, routeTurn.conversation);
				const runIntents = rawIntents.get(effectRequest.runSequence) ?? new Map();
				for (const intent of routeTurn.rawToolIntents) runIntents.set(intent.intentDigest, intent);
				rawIntents.set(effectRequest.runSequence, runIntents);
				const envelope = routeTurn.envelope;
				if (
					injectRetry &&
					retryReason === "d675-und-err-socket" &&
					envelope.routeProposal !== null &&
					envelope.execution.result.effectKind === "provider-request"
				)
					return replaceD779ProviderExecutionForQualification({
						envelope,
						effectRequest,
						admission,
						execution: {
							...envelope.execution,
							result: {
								...envelope.execution.result,
								status: "retryable-failure",
								toolIntents: Object.freeze([]),
								failureDiscriminator: "d675-und-err-socket",
								retryAfterMs: null,
								evidenceDigest: empiricalStrictJsonDigest({
									d779: "injected-d675-result",
									request: effectRequest.requestDigest,
								}),
							},
						},
					});
				if (
					mode === "proposal-omission" &&
					effectRequest.runSequence === 0 &&
					effectRequest.attemptOrdinal === 1 &&
					!negativeInjected
				) {
					negativeInjected = true;
					return Object.freeze({
						...envelope,
						taskWireReceiptPresent: false,
						envelopeDigest: empiricalStrictJsonDigest({
							...envelope,
							taskWireReceiptPresent: false,
							envelopeDigest: undefined,
						}),
					});
				}
				return envelope;
			}
			if (effectRequest.effectKind === "retry-wait") {
				retryWaits += 1;
				return createD779ProviderResultEnvelope({
					effectRequest,
					routeProposal: null,
					execution: {
						actualCostMicrousd: 0,
						actualElapsedMs: effectRequest.retryAfterMs ?? 60_000,
						result: {
							effectKind: "retry-wait",
							status: "completed",
							evidenceDigest: empiricalStrictJsonDigest({ d779: "retry-wait", effectRequest }),
						},
					},
				});
			}
			if (effectRequest.effectKind === "tool-action") {
				if (workspace === undefined || effectRequest.toolIntent === null)
					throw new TypeError("D779 tool workspace is missing");
				if (
					mode === "tool-rejection" &&
					effectRequest.runSequence < 5 &&
					!rejectedRuns.has(effectRequest.runSequence)
				) {
					rejectedRuns.add(effectRequest.runSequence);
					negativeInjected = true;
					const messages = [
						"D779 malformed tool arguments: bounded fixture",
						"D779 unexpected tool arguments: bounded fixture",
						"D779 read path is not allowed",
						"D779 exact replacement is not uniquely applicable",
						"D779 focused validation failed",
					] as const;
					return executeD779ToolBoundary({
						input: { admission, effectRequest, request },
						execute: async () => {
							throw new TypeError(messages[effectRequest.runSequence]);
						},
						snapshotWorkspaceState: async () => workspace,
						elapsedOnRejectionMs: () => 1,
					});
				}
				const after =
					effectRequest.toolIntent.toolRef === "replace-exact"
						? empiricalStrictJsonDigest({
								workspace,
								mutation: effectRequest.toolIntent.intentDigest,
							})
						: workspace;
				workspaces.set(effectRequest.runSequence, after);
				const rawIntent = rawIntents
					.get(effectRequest.runSequence)
					?.get(effectRequest.toolIntent.intentDigest);
				const conversation = conversations.get(effectRequest.runSequence);
				if (rawIntent === undefined || conversation === undefined)
					throw new TypeError("D779 tool result lacks its transient provider conversation");
				rawIntents.get(effectRequest.runSequence)!.delete(effectRequest.toolIntent.intentDigest);
				conversations.set(
					effectRequest.runSequence,
					appendD723ToolResult(conversation, rawIntent, {
						status: "succeeded",
						resultDigest: empiricalStrictJsonDigest({ effectRequest, after }),
					}),
				);
				return createD779ProviderResultEnvelope({
					effectRequest,
					routeProposal: null,
					execution: {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "tool-action",
							toolRef: effectRequest.toolIntent.toolRef,
							intentDigest: effectRequest.toolIntent.intentDigest,
							status: "succeeded",
							nonEmptyDiff: effectRequest.toolIntent.toolRef === "workspace-diff",
							workspaceStateBeforeDigest: workspace,
							workspaceStateAfterDigest: after,
							evidenceDigest: empiricalStrictJsonDigest({ d779: "tool", effectRequest }),
						},
					},
				});
			}
			if (effectRequest.effectKind === "public-semantic-validation") {
				if (workspace === undefined) throw new TypeError("D779 semantic workspace is missing");
				const attempt = (semanticAttempts.get(effectRequest.runSequence) ?? 0) + 1;
				semanticAttempts.set(effectRequest.runSequence, attempt);
				return createD779ProviderResultEnvelope({
					effectRequest,
					routeProposal: null,
					execution: {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "public-semantic-validation",
							status: attempt === 1 ? "failed" : "passed",
							criterionFailures:
								attempt === 1
									? Object.freeze(["canonical-provenance-not-admitted" as const])
									: Object.freeze([]),
							workspaceStateDigest: workspace,
							evidenceDigest: empiricalStrictJsonDigest({
								d779: "semantic",
								attempt,
								effectRequest,
							}),
						},
					},
				});
			}
			if (effectRequest.effectKind === "hidden-verifier") {
				if (workspace === undefined) throw new TypeError("D779 hidden workspace is missing");
				const hiddenAttempt = (hiddenAttempts.get(effectRequest.runSequence) ?? 0) + 1;
				hiddenAttempts.set(effectRequest.runSequence, hiddenAttempt);
				const injectedFailure =
					mode === "hidden-failure" && effectRequest.runSequence === 0 && hiddenAttempt === 1;
				if (injectedFailure) negativeInjected = true;
				return createD779ProviderResultEnvelope({
					effectRequest,
					routeProposal: null,
					execution: {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "hidden-verifier",
							status: injectedFailure ? "failed" : "passed",
							workspaceStateDigest: workspace,
							evidenceDigest: empiricalStrictJsonDigest({ d779: "hidden", effectRequest }),
						},
					},
				});
			}
			workspaces.delete(effectRequest.runSequence);
			conversations.delete(effectRequest.runSequence);
			rawIntents.delete(effectRequest.runSequence);
			return createD779ProviderResultEnvelope({
				effectRequest,
				routeProposal: null,
				execution: {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "cleanup",
						status: "succeeded",
						evidenceDigest: empiricalStrictJsonDigest({ d779: "cleanup", effectRequest }),
					},
				},
			});
		} finally {
			active -= 1;
		}
	});
	const policy = createD761GraphPublicSemanticValidationPolicy();
	const terminalPolicy = createD726ArmLocalTerminalProviderPolicy();
	const core = await runD779GraphNativeEvalCore({
		sourceDigest: SOURCE_DIGEST,
		budgetLimits: LIMITS,
		effectCeilings: CEILINGS,
		executor,
		objectivePhaseRecoveryPolicy: policy,
		armLocalTerminalPolicy: terminalPolicy,
		signal: AbortSignal.timeout(60_000),
	});
	const graphEvidence = deriveD771CanonicalGraphEvidence(
		core.ledger,
		core.effectRuns,
		terminalPolicy,
		policy,
	);
	const providerFacts = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.request.effectKind === "provider-request" &&
			fact.result.effectKind === "provider-request" &&
			fact.result.failureProvenance !== "executor-failure"
				? [fact as unknown as Readonly<Record<string, unknown>>]
				: [],
		),
	);
	const routeEvidence = validateD779RouteEvidence(
		core.routeEvidence,
		providerFacts,
		CEILINGS,
		graphEvidence.ledger.effectReconciliations,
	);
	if (
		workspaces.size !== 0 ||
		maxActive !== 1 ||
		(mode === "positive" && (retried.size !== 6 || retryWaits !== 6)) ||
		(mode !== "positive" && !negativeInjected) ||
		graphEvidence.ledger.completedArms.length !== 6 ||
		graphEvidence.runStatus !== "complete" ||
		!routeEvidence.coverageComplete
	)
		throw new TypeError(
			`D779 injected six-arm operational qualification drifted: ${JSON.stringify({
				workspaceResidueCount: workspaces.size,
				maxActive,
				retried: retried.size,
				retryWaits,
				completedArms: graphEvidence.ledger.completedArms.length,
				runStatus: graphEvidence.runStatus,
				routeCoverage: routeEvidence.coverageComplete,
				providerResultCount: routeEvidence.providerResultCount,
				routeFactCount: routeEvidence.facts.length,
				routePhases: routeEvidence.facts.map((fact) => ({
					run: fact.runSequence,
					phase: fact.nextRequiredPhase,
					disposition: fact.requiredDisposition,
				})),
				runs: graphEvidence.effectRuns.map((run) =>
					run.facts.flatMap((fact) =>
						fact.kind === "graph-effect-result-admitted"
							? [
									fact.result.effectKind === "tool-action"
										? `tool:${fact.result.toolRef}:${fact.result.status}`
										: fact.result.effectKind === "provider-request" &&
												fact.result.status === "terminal-failure"
											? `provider-request:terminal-failure:${fact.result.failureProvenance ?? "none"}:${fact.result.executorFailureClassification ?? "none"}`
											: `${fact.result.effectKind}:${fact.result.status}`,
								]
							: [],
					),
				),
			})}`,
		);
	return Object.freeze({
		graphEvidence,
		routeEvidence,
		taskExposureFacts: core.taskExposureFacts,
		toolRejectionFacts: core.toolRejectionFacts,
		providerCalls,
		retryWaits,
		maxActive,
	});
}

function assertFailureProvenanceSeparated(
	graph: D771CanonicalGraphEvidenceV1,
	expected: "http-terminal" | "hidden-verifier",
): void {
	const results = graph.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" ? [fact.result] : [],
		),
	);
	if (expected === "http-terminal") {
		const terminal = results.filter(
			(result) =>
				result.effectKind === "provider-request" &&
				result.status === "terminal-failure" &&
				result.failureProvenance === "http-terminal",
		);
		if (
			terminal.length !== 1 ||
			terminal.some(
				(result) =>
					result.effectKind !== "provider-request" || result.executorFailureClassification !== null,
			)
		)
			throw new TypeError("D779 terminal HTTP provenance drifted");
		return;
	}
	if (
		!results.some(
			(result) => result.effectKind === "hidden-verifier" && result.status === "failed",
		) ||
		results.some(
			(result) =>
				result.effectKind === "provider-request" && result.failureProvenance === "executor-failure",
		)
	)
		throw new TypeError("D779 hidden-verifier failure provenance drifted");
}

function assertLifecycle(graph: D771CanonicalGraphEvidenceV1): void {
	if (graph.effectRuns.length !== 6) throw new TypeError("D779 qualification requires six runs");
	for (const [index, run] of graph.effectRuns.entries()) {
		const results = run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" ? [fact.result] : [],
		);
		const semantics = results.filter(
			(result) => result.effectKind === "public-semantic-validation",
		);
		const tools = results.flatMap((result) =>
			result.effectKind === "tool-action" ? [result.toolRef] : [],
		);
		const hidden = results.filter((result) => result.effectKind === "hidden-verifier");
		if (
			semantics.length !== 2 ||
			semantics[0]?.status !== "failed" ||
			semantics[1]?.status !== "passed" ||
			tools.filter((tool) => tool === "read-file").length !== 1 ||
			tools.filter((tool) => tool === "replace-exact").length !== 2 ||
			tools.filter((tool) => tool === "workspace-diff").length !== 2 ||
			tools.filter((tool) => tool === "focused-validation").length !== 2 ||
			hidden.length !== 1 ||
			hidden[0]?.status !== "passed" ||
			results.at(-1)?.effectKind !== "cleanup" ||
			results.at(-1)?.status !== "succeeded"
		)
			throw new TypeError(`D779 run ${index} lifecycle drifted`);
	}
}

function assertInspectionRecoveryLifecycle(graph: D771CanonicalGraphEvidenceV1): void {
	for (const [runIndex, run] of graph.effectRuns.entries()) {
		const facts = run.facts.filter((fact) => fact.kind === "graph-effect-result-admitted");
		const rejectedIndex = facts.findIndex(
			(fact) =>
				fact.request.effectKind === "provider-request" &&
				fact.request.completionContext === undefined &&
				fact.result.effectKind === "provider-request" &&
				fact.result.status === "tool-intents" &&
				fact.result.toolIntents.length === 1 &&
				fact.result.toolIntents[0]?.toolRef === "workspace-diff",
		);
		const inspectionIndex = facts.findIndex(
			(fact, index) =>
				index > rejectedIndex &&
				fact.request.effectKind === "provider-request" &&
				fact.request.completionContext?.nextRequiredPhase === "inspection" &&
				fact.result.effectKind === "provider-request" &&
				fact.result.status === "tool-intents" &&
				fact.result.toolIntents.length === 1 &&
				fact.result.toolIntents[0]?.toolRef === "read-file",
		);
		const readIndex = facts.findIndex(
			(fact, index) =>
				index > inspectionIndex &&
				fact.result.effectKind === "tool-action" &&
				fact.result.toolRef === "read-file" &&
				fact.result.status === "succeeded",
		);
		const between = facts.slice(rejectedIndex + 1, inspectionIndex);
		const rejectedBatchExecuted = between.some((fact) => fact.result.effectKind === "tool-action");
		const unexpectedIntermediate = between.some(
			(fact) =>
				!(
					(fact.result.effectKind === "provider-request" &&
						fact.result.status === "retryable-failure") ||
					(fact.result.effectKind === "retry-wait" && fact.result.status === "completed")
				),
		);
		if (
			rejectedIndex < 0 ||
			inspectionIndex <= rejectedIndex ||
			readIndex !== inspectionIndex + 1 ||
			rejectedBatchExecuted ||
			unexpectedIntermediate
		)
			throw new TypeError(`D779 run ${runIndex} inspection recovery lifecycle drifted`);
	}
}

function deriveRetryCoverage(graph: D771CanonicalGraphEvidenceV1): readonly string[] {
	return Object.freeze(
		graph.effectRuns
			.flatMap((run) =>
				run.facts.flatMap((fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.result.effectKind === "provider-request" &&
					fact.result.status === "retryable-failure"
						? [fact.result.failureDiscriminator]
						: [],
				),
			)
			.sort(),
	);
}

function assertRetryCoverage(graph: D771CanonicalGraphEvidenceV1): void {
	const expected = [
		"d671-provider-overloaded",
		"d671-provider-overloaded",
		"d675-und-err-socket",
		"d675-und-err-socket",
		"d710-untyped-http-429",
		"d710-untyped-http-429",
	].sort();
	if (JSON.stringify(deriveRetryCoverage(graph)) !== JSON.stringify(expected))
		throw new TypeError(
			`D779 retry policy coverage drifted: ${JSON.stringify(deriveRetryCoverage(graph))}`,
		);
}

function assertCanonicalRouteRetryIdentity(
	routeEvidence: ReturnType<typeof validateD779RouteEvidence>,
): void {
	const groups = new Map<string, (typeof routeEvidence.facts)[number][]>();
	for (const fact of routeEvidence.facts) {
		const group = groups.get(fact.logicalRequestDigest) ?? [];
		group.push(fact);
		groups.set(fact.logicalRequestDigest, group);
	}
	const retried = [...groups.values()].filter((facts) => facts.length > 1);
	if (retried.length !== 6) throw new TypeError("D779 canonical route retry coverage drifted");
	for (const facts of retried) {
		if (facts.length !== 2 || facts[0]!.attemptOrdinal !== 1 || facts[1]!.attemptOrdinal !== 2)
			throw new TypeError("D779 canonical route retry ordinals drifted");
		for (const key of [
			"inputBodyDigest",
			"loweredBodyDigest",
			"modelVisibleMessagesDigest",
			"contextDigest",
			"requiredDisposition",
			"requiredToolName",
		] as const)
			if (facts[0]![key] !== facts[1]![key])
				throw new TypeError(`D779 canonical same-request retry ${key} drifted`);
	}
}

function assertWrongToolRejected(graph: D771CanonicalGraphEvidenceV1): void {
	const run = graph.effectRuns[0];
	if (run === undefined) throw new TypeError("D779 wrong-tool run is missing");
	const facts = run.facts.flatMap((fact) =>
		fact.kind === "graph-effect-result-admitted" ? [fact] : [],
	);
	const providerFacts = facts.filter(
		(fact) =>
			fact.result.effectKind === "provider-request" && fact.result.status === "tool-intents",
	);
	const cleanupIndex = facts.findIndex((fact) => fact.result.effectKind === "cleanup");
	const toolFacts = facts.filter((fact) => fact.result.effectKind === "tool-action");
	if (
		providerFacts.length !== 2 ||
		providerFacts[0]?.request.completionContext !== undefined ||
		providerFacts[1]?.request.completionContext?.nextRequiredPhase !== "inspection" ||
		cleanupIndex < 0 ||
		toolFacts.length !== 0 ||
		!graph.ledger.findings.some(
			(finding) => finding.code === "arm-policy-violated" && finding.runSequence === 0,
		)
	)
		throw new TypeError("D779 wrong inspection tool was not rejected before side effects");
}

function assertProposalOmissionSeparated(graph: D771CanonicalGraphEvidenceV1): void {
	const firstProvider = graph.effectRuns[0]?.facts.find(
		(fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.request.effectKind === "provider-request",
	);
	if (
		firstProvider?.kind !== "graph-effect-result-admitted" ||
		firstProvider.result.effectKind !== "provider-request" ||
		firstProvider.result.failureProvenance !== "executor-failure" ||
		firstProvider.result.executorFailureClassification !== "executor-threw"
	)
		throw new TypeError("D779 proposal omission did not remain executor-failure provenance");
}

export async function runD779InjectedNoNetworkQualification(
	baselineValue: D779ConsumedD775BaselineV1,
): Promise<D779QualificationBundleV1> {
	if (!admittedBaselines.has(baselineValue as object))
		throw new TypeError("D779 baseline capability is forged or replayed");
	admittedBaselines.delete(baselineValue as object);
	const baseline = validateBaseline(baselineValue);
	if ((await measureD779Implementation()) !== D779_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D779 implementation manifest validation failed");
	const run = await runInjectedSixArms();
	const wrongTool = await runInjectedSixArms("wrong-inspection-tool");
	const omission = await runInjectedSixArms("proposal-omission");
	const terminalHttp = await runInjectedSixArms("terminal-http");
	const hiddenFailure = await runInjectedSixArms("hidden-failure");
	const toolRejection = await runInjectedSixArms("tool-rejection");
	assertLifecycle(run.graphEvidence);
	assertInspectionRecoveryLifecycle(run.graphEvidence);
	assertRetryCoverage(run.graphEvidence);
	assertCanonicalRouteRetryIdentity(run.routeEvidence);
	assertWrongToolRejected(wrongTool.graphEvidence);
	assertProposalOmissionSeparated(omission.graphEvidence);
	assertFailureProvenanceSeparated(terminalHttp.graphEvidence, "http-terminal");
	assertFailureProvenanceSeparated(hiddenFailure.graphEvidence, "hidden-verifier");
	const rejectionCauses = toolRejection.toolRejectionFacts.map((fact) => fact.causeCode).sort();
	if (
		JSON.stringify(rejectionCauses) !==
		JSON.stringify(
			[
				"exact-replacement-not-applicable",
				"focused-validation-failed",
				"malformed-arguments",
				"path-not-allowed",
				"unexpected-arguments",
			].sort(),
		)
	)
		throw new TypeError("D779 real tool-rejection mapping coverage drifted");
	const routePhases = run.routeEvidence.facts.map((fact) => fact.nextRequiredPhase);
	for (const phase of [
		"inspection",
		"exact-mutation",
		"workspace-diff",
		"focused-validation",
		"hidden-verifier",
	] as const)
		if (!routePhases.includes(phase)) throw new TypeError(`D779 phase ${phase} was not qualified`);
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D779_QUALIFICATION_SCHEMA,
		decisionRef: "decision.D779.2026-08-13.v1",
		baselineDisposition: "consumed-d775-partial-canonical-graph-evidence",
		baselineBasis: baseline.basis,
		baselineArtifactSha256: baseline.artifactSha256,
		baselineBundleDigest: baseline.bundleDigest,
		baselineGraphEvidenceDigest: baseline.graphEvidenceDigest,
		baselineRouteEvidenceDigest: baseline.routeEvidenceDigest,
		implementationManifestDigest: D779_IMPLEMENTATION_MANIFEST_DIGEST,
		graphEvidenceDigest: run.graphEvidence.evidenceDigest,
		routeEvidenceDigest: run.routeEvidence.evidenceDigest,
		completedArms: 6,
		providerCalls: run.providerCalls,
		retryWaits: run.retryWaits,
		maxActiveEffects: run.maxActive,
		providerRouteBijection: true,
		allCorrectionPhasesLowered: true,
		adapterSideLedgerCount: 0,
		taskExposureFactCount: run.taskExposureFacts.length,
		toolRejectionFactCount: run.toolRejectionFacts.length,
		diagnosticToolRejectionFactCount: toolRejection.toolRejectionFacts.length,
		credentialReads: 0,
		controlPlaneCalls: 0,
		providerNetworkCalls: 0,
		workspaceResidueCount: 0,
		wrongToolRejectedPreSideEffect: true,
		proposalOmissionSeparatedAsExecutorFailure: true,
		terminalHttpProvenanceSeparated: true,
		hiddenVerifierFailureProvenanceSeparated: true,
	});
	const qualification = strictSnapshot({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: D779_GENERATION_SCHEMA,
		generationRef: D779_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		graphEvidenceDigest: run.graphEvidence.evidenceDigest,
		routeEvidenceDigest: run.routeEvidence.evidenceDigest,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D779_BUNDLE_SCHEMA,
		executionClass: "simulated-contract" as const,
		graphEvidence: run.graphEvidence,
		routeEvidence: run.routeEvidence,
		taskExposureFacts: run.taskExposureFacts,
		toolRejectionFacts: run.toolRejectionFacts,
		wrongToolGraphEvidence: wrongTool.graphEvidence,
		wrongToolRouteEvidence: wrongTool.routeEvidence,
		omissionGraphEvidence: omission.graphEvidence,
		omissionRouteEvidence: omission.routeEvidence,
		terminalHttpGraphEvidence: terminalHttp.graphEvidence,
		terminalHttpRouteEvidence: terminalHttp.routeEvidence,
		hiddenFailureGraphEvidence: hiddenFailure.graphEvidence,
		hiddenFailureRouteEvidence: hiddenFailure.routeEvidence,
		toolRejectionGraphEvidence: toolRejection.graphEvidence,
		toolRejectionRouteEvidence: toolRejection.routeEvidence,
		diagnosticToolRejectionFacts: toolRejection.toolRejectionFacts,
		qualification,
		generation,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const bundle = Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
	constructedBundles.add(bundle);
	return bundle;
}

export function validateD779QualificationBundle(value: unknown): D779QualificationBundleV1 {
	const candidate = record(value, "d779.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"causalAttribution",
			"efficacyClaim",
			"executionClass",
			"generation",
			"graphEvidence",
			"omissionGraphEvidence",
			"omissionRouteEvidence",
			"terminalHttpGraphEvidence",
			"terminalHttpRouteEvidence",
			"hiddenFailureGraphEvidence",
			"hiddenFailureRouteEvidence",
			"toolRejectionGraphEvidence",
			"toolRejectionRouteEvidence",
			"diagnosticToolRejectionFacts",
			"qualification",
			"routeEvidence",
			"schemaVersion",
			"taskExposureFacts",
			"toolRejectionFacts",
			"wrongToolGraphEvidence",
			"wrongToolRouteEvidence",
		],
		"d779.bundle",
	);
	literal(candidate.schemaVersion, D779_BUNDLE_SCHEMA, "d779.bundle.schemaVersion");
	literal(candidate.executionClass, "simulated-contract", "d779.bundle.executionClass");
	literal(candidate.causalAttribution, "undetermined", "d779.bundle.causalAttribution");
	literal(candidate.efficacyClaim, "none", "d779.bundle.efficacyClaim");
	const graphCandidate = record(candidate.graphEvidence, "d779.bundle.graphEvidence");
	const graph = deriveD771CanonicalGraphEvidence(
		graphCandidate.ledger as never,
		graphCandidate.effectRuns as never,
		createD726ArmLocalTerminalProviderPolicy(),
		createD761GraphPublicSemanticValidationPolicy(),
	);
	if (graph.evidenceDigest !== graphCandidate.evidenceDigest)
		throw new TypeError("D779 canonical Graph replay drifted");
	assertLifecycle(graph);
	assertInspectionRecoveryLifecycle(graph);
	assertRetryCoverage(graph);
	const providerFacts = graph.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.request.effectKind === "provider-request" &&
			fact.result.effectKind === "provider-request" &&
			fact.result.failureProvenance !== "executor-failure"
				? [fact as unknown as Readonly<Record<string, unknown>>]
				: [],
		),
	);
	const routeEvidence = validateD779RouteEvidence(
		candidate.routeEvidence,
		providerFacts,
		CEILINGS,
		graph.ledger.effectReconciliations,
	);
	assertCanonicalRouteRetryIdentity(routeEvidence);
	const taskExposureFacts = Array.isArray(candidate.taskExposureFacts)
		? candidate.taskExposureFacts
		: (() => {
				throw new TypeError("D779 task exposure facts are not an array");
			})();
	if (taskExposureFacts.length !== providerFacts.length || taskExposureFacts.length > 128)
		throw new TypeError("D779 task exposure/provider-result bijection drifted");
	const taskKeys = taskExposureFacts.map((value, index) => {
		const fact = record(value, `d779.taskExposureFacts[${index}]`);
		exactKeys(
			fact,
			[
				"admissionDigest",
				"arm",
				"envelopeDigest",
				"factDigest",
				"modelVisibleMessagesDigest",
				"reconciliationDigest",
				"requestDigest",
				"resultFactDigest",
				"runSequence",
				"schemaVersion",
			],
			`d779.taskExposureFacts[${index}]`,
		);
		const { factDigest, ...material } = fact;
		if (factDigest !== empiricalStrictJsonDigest(material))
			throw new TypeError("D779 task exposure fact digest drifted");
		const routeMatches = routeEvidence.facts.filter(
			(route) =>
				route.requestDigest === fact.requestDigest &&
				route.admissionDigest === fact.admissionDigest &&
				route.resultFactDigest === fact.resultFactDigest &&
				route.reconciliationDigest === fact.reconciliationDigest,
		);
		if (routeMatches.length !== 1)
			throw new TypeError("D779 task exposure fact is not exact for its Graph provider effect");
		const providerMatches = graph.effectRuns.flatMap((run) =>
			run.facts.flatMap((resultFact) =>
				resultFact.kind === "graph-effect-result-admitted" &&
				resultFact.request.requestDigest === fact.requestDigest &&
				resultFact.admissionDigest === fact.admissionDigest &&
				resultFact.factDigest === fact.resultFactDigest
					? [resultFact]
					: [],
			),
		);
		if (providerMatches.length !== 1)
			throw new TypeError("D779 task exposure fact lacks one Graph provider result");
		const run = graph.ledger.issuedRequests.find(
			(issued) =>
				empiricalStrictJsonDigest(issued) === providerMatches[0]!.request.issuedRequestDigest,
		);
		if (run?.payload === undefined)
			throw new TypeError("D779 task exposure fact lacks one Graph run request");
		const expectedEnvelope = createD778GraphTaskEnvelope({
			arm: run.payload.arm,
			effectRequest: providerMatches[0]!.request,
		});
		if (
			fact.envelopeDigest !== expectedEnvelope.envelopeDigest ||
			fact.arm !== expectedEnvelope.arm ||
			fact.runSequence !== expectedEnvelope.runSequence ||
			fact.modelVisibleMessagesDigest !== routeMatches[0]!.modelVisibleMessagesDigest
		)
			throw new TypeError("D779 task exposure envelope/wire projection drifted");
		return `${fact.requestDigest}:${fact.admissionDigest}:${fact.resultFactDigest}`;
	});
	if (new Set(taskKeys).size !== taskKeys.length)
		throw new TypeError("D779 task exposure fact replayed");
	if (!Array.isArray(candidate.toolRejectionFacts) || candidate.toolRejectionFacts.length !== 0)
		throw new TypeError("D779 main positive run unexpectedly contains tool rejection facts");
	const replayNegative = (graphValue: unknown, path: string) => {
		const graphRecord = record(graphValue, path);
		const replayed = deriveD771CanonicalGraphEvidence(
			graphRecord.ledger as never,
			graphRecord.effectRuns as never,
			createD726ArmLocalTerminalProviderPolicy(),
			createD761GraphPublicSemanticValidationPolicy(),
		);
		if (replayed.evidenceDigest !== graphRecord.evidenceDigest)
			throw new TypeError(`${path} canonical replay drifted`);
		return replayed;
	};
	const factsFor = (value: D771CanonicalGraphEvidenceV1) =>
		value.effectRuns.flatMap((run) =>
			run.facts.flatMap((fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.request.effectKind === "provider-request" &&
				fact.result.effectKind === "provider-request" &&
				fact.result.failureProvenance !== "executor-failure"
					? [fact as unknown as Readonly<Record<string, unknown>>]
					: [],
			),
		);
	const wrongToolGraph = replayNegative(
		candidate.wrongToolGraphEvidence,
		"d779.bundle.wrongToolGraphEvidence",
	);
	assertWrongToolRejected(wrongToolGraph);
	validateD779RouteEvidence(
		candidate.wrongToolRouteEvidence,
		factsFor(wrongToolGraph),
		CEILINGS,
		wrongToolGraph.ledger.effectReconciliations,
	);
	const terminalHttpGraph = replayNegative(
		candidate.terminalHttpGraphEvidence,
		"d779.bundle.terminalHttpGraphEvidence",
	);
	assertFailureProvenanceSeparated(terminalHttpGraph, "http-terminal");
	validateD779RouteEvidence(
		candidate.terminalHttpRouteEvidence,
		factsFor(terminalHttpGraph),
		CEILINGS,
		terminalHttpGraph.ledger.effectReconciliations,
	);
	const hiddenFailureGraph = replayNegative(
		candidate.hiddenFailureGraphEvidence,
		"d779.bundle.hiddenFailureGraphEvidence",
	);
	assertFailureProvenanceSeparated(hiddenFailureGraph, "hidden-verifier");
	validateD779RouteEvidence(
		candidate.hiddenFailureRouteEvidence,
		factsFor(hiddenFailureGraph),
		CEILINGS,
		hiddenFailureGraph.ledger.effectReconciliations,
	);
	const toolRejectionGraph = replayNegative(
		candidate.toolRejectionGraphEvidence,
		"d779.bundle.toolRejectionGraphEvidence",
	);
	validateD779RouteEvidence(
		candidate.toolRejectionRouteEvidence,
		factsFor(toolRejectionGraph),
		CEILINGS,
		toolRejectionGraph.ledger.effectReconciliations,
	);
	if (!Array.isArray(candidate.diagnosticToolRejectionFacts))
		throw new TypeError("D779 diagnostic tool rejection facts are not an array");
	const diagnosticFacts = candidate.diagnosticToolRejectionFacts.map((value, index) => {
		const fact = record(value, `d779.diagnosticToolRejectionFacts[${index}]`);
		exactKeys(
			fact,
			[
				"admissionDigest",
				"causeCode",
				"factDigest",
				"reconciliationDigest",
				"requestDigest",
				"resultFactDigest",
				"runSequence",
				"schemaVersion",
				"toolRef",
				"workspaceStateAfterDigest",
				"workspaceStateBeforeDigest",
			],
			`d779.diagnosticToolRejectionFacts[${index}]`,
		);
		const { factDigest, ...material } = fact;
		if (
			factDigest !== empiricalStrictJsonDigest(material) ||
			fact.workspaceStateBeforeDigest !== fact.workspaceStateAfterDigest
		)
			throw new TypeError("D779 diagnostic tool rejection fact drifted");
		const results = toolRejectionGraph.effectRuns.flatMap((run) =>
			run.facts.filter(
				(resultFact) =>
					resultFact.kind === "graph-effect-result-admitted" &&
					resultFact.request.requestDigest === fact.requestDigest &&
					resultFact.admissionDigest === fact.admissionDigest &&
					resultFact.factDigest === fact.resultFactDigest &&
					resultFact.result.effectKind === "tool-action" &&
					resultFact.result.status === "failed",
			),
		);
		const reconciliations = toolRejectionGraph.ledger.effectReconciliations.filter(
			(reconciliation) =>
				reconciliation.admissionDigest === fact.admissionDigest &&
				reconciliation.reconciliationDigest === fact.reconciliationDigest,
		);
		if (results.length !== 1 || reconciliations.length !== 1)
			throw new TypeError("D779 diagnostic fact is not exact for its Graph tool effect");
		const resultFact = results[0]!;
		if (
			resultFact.kind !== "graph-effect-result-admitted" ||
			resultFact.result.effectKind !== "tool-action" ||
			resultFact.result.toolRef !== fact.toolRef ||
			resultFact.result.workspaceStateBeforeDigest !== fact.workspaceStateBeforeDigest ||
			resultFact.result.workspaceStateAfterDigest !== fact.workspaceStateAfterDigest
		)
			throw new TypeError("D779 diagnostic fact tool/workspace binding drifted");
		return fact;
	});
	const causes = diagnosticFacts.map((fact) => fact.causeCode).sort();
	if (
		diagnosticFacts.length !== 5 ||
		new Set(diagnosticFacts.map((fact) => fact.requestDigest)).size !== 5 ||
		JSON.stringify(causes) !==
			JSON.stringify(
				[
					"exact-replacement-not-applicable",
					"focused-validation-failed",
					"malformed-arguments",
					"path-not-allowed",
					"unexpected-arguments",
				].sort(),
			)
	)
		throw new TypeError("D779 diagnostic tool rejection coverage drifted");
	const omissionGraph = replayNegative(
		candidate.omissionGraphEvidence,
		"d779.bundle.omissionGraphEvidence",
	);
	assertProposalOmissionSeparated(omissionGraph);
	validateD779RouteEvidence(
		candidate.omissionRouteEvidence,
		factsFor(omissionGraph),
		CEILINGS,
		omissionGraph.ledger.effectReconciliations,
	);
	const qualification = record(candidate.qualification, "d779.bundle.qualification");
	exactKeys(
		qualification,
		[
			"adapterSideLedgerCount",
			"allCorrectionPhasesLowered",
			"baselineArtifactSha256",
			"baselineBasis",
			"baselineBundleDigest",
			"baselineDisposition",
			"baselineGraphEvidenceDigest",
			"baselineRouteEvidenceDigest",
			"completedArms",
			"controlPlaneCalls",
			"credentialReads",
			"decisionRef",
			"diagnosticToolRejectionFactCount",
			"graphEvidenceDigest",
			"implementationManifestDigest",
			"maxActiveEffects",
			"providerCalls",
			"providerNetworkCalls",
			"providerRouteBijection",
			"proposalOmissionSeparatedAsExecutorFailure",
			"terminalHttpProvenanceSeparated",
			"hiddenVerifierFailureProvenanceSeparated",
			"qualificationDigest",
			"retryWaits",
			"routeEvidenceDigest",
			"schemaVersion",
			"taskExposureFactCount",
			"toolRejectionFactCount",
			"workspaceResidueCount",
			"wrongToolRejectedPreSideEffect",
		],
		"d779.bundle.qualification",
	);
	const retryWaitCount = graph.effectRuns.reduce(
		(total, run) =>
			total +
			run.facts.filter(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.result.effectKind === "retry-wait" &&
					fact.result.status === "completed",
			).length,
		0,
	);
	if (
		(qualification.baselineBasis !== "real-artifact" &&
			qualification.baselineBasis !== "injected-test") ||
		qualification.baselineArtifactSha256 !== D775_BASELINE_ARTIFACT_SHA256 ||
		qualification.baselineBundleDigest !== D775_BASELINE_BUNDLE_DIGEST ||
		qualification.baselineGraphEvidenceDigest !== D775_BASELINE_GRAPH_EVIDENCE_DIGEST ||
		qualification.baselineRouteEvidenceDigest !== D775_BASELINE_ROUTE_EVIDENCE_DIGEST ||
		qualification.graphEvidenceDigest !== graph.evidenceDigest ||
		qualification.implementationManifestDigest !== D779_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.routeEvidenceDigest !== routeEvidence.evidenceDigest ||
		qualification.completedArms !== 6 ||
		qualification.providerCalls !== routeEvidence.facts.length ||
		qualification.retryWaits !== retryWaitCount ||
		qualification.maxActiveEffects !== 1 ||
		qualification.providerRouteBijection !== true ||
		qualification.proposalOmissionSeparatedAsExecutorFailure !== true ||
		qualification.terminalHttpProvenanceSeparated !== true ||
		qualification.hiddenVerifierFailureProvenanceSeparated !== true ||
		qualification.wrongToolRejectedPreSideEffect !== true ||
		qualification.allCorrectionPhasesLowered !== true ||
		qualification.adapterSideLedgerCount !== 0 ||
		qualification.taskExposureFactCount !== providerFacts.length ||
		qualification.toolRejectionFactCount !== 0 ||
		qualification.diagnosticToolRejectionFactCount !== 5 ||
		qualification.credentialReads !== 0 ||
		qualification.controlPlaneCalls !== 0 ||
		qualification.providerNetworkCalls !== 0 ||
		qualification.workspaceResidueCount !== 0
	)
		throw new TypeError("D779 qualification projection drifted");
	const { qualificationDigest, ...qualificationMaterial } = qualification;
	if (qualificationDigest !== empiricalStrictJsonDigest(qualificationMaterial))
		throw new TypeError("D779 qualification digest drifted");
	const generation = record(candidate.generation, "d779.bundle.generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"graphEvidenceDigest",
			"qualificationDigest",
			"routeEvidenceDigest",
			"schemaVersion",
		],
		"d779.bundle.generation",
	);
	if (
		generation.generationRef !== D779_GENERATION_REF ||
		generation.qualificationDigest !== qualificationDigest ||
		generation.graphEvidenceDigest !== graph.evidenceDigest ||
		generation.routeEvidenceDigest !== routeEvidence.evidenceDigest ||
		generation.causalAttribution !== "undetermined" ||
		generation.efficacyClaim !== "none"
	)
		throw new TypeError("D779 generation binding drifted");
	const { generationDigest, ...generationMaterial } = generation;
	if (generationDigest !== empiricalStrictJsonDigest(generationMaterial))
		throw new TypeError("D779 generation digest drifted");
	const { bundleDigest, ...bundleMaterial } = candidate;
	if (bundleDigest !== empiricalStrictJsonDigest(bundleMaterial))
		throw new TypeError("D779 bundle digest drifted");
	return strictSnapshot(candidate) as unknown as D779QualificationBundleV1;
}

async function assertPrivateRoot(path: string) {
	const canonical = resolve(path);
	const stat = await lstat(canonical);
	if (
		!stat.isDirectory() ||
		(stat.mode & 0o777) !== 0o700 ||
		(await realpath(canonical)) !== canonical
	)
		throw new TypeError("D779 private root must be a canonical 0700 directory");
	return canonical;
}

async function writePrivateFile(path: string, bytes: Uint8Array): Promise<void> {
	const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
		const stat = await handle.stat();
		if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600)
			throw new TypeError("D779 private artifact identity drifted");
	} finally {
		await handle.close();
	}
}

async function syncDir(path: string): Promise<void> {
	const handle = await open(path, constants.O_RDONLY);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function persistBundle(
	inputValue: {
		readonly privateRoot: string;
		readonly bundle: D779QualificationBundleV1;
	},
	options: {
		readonly allowInjected: boolean;
		readonly faultStage?: "after-claim" | "after-write" | "after-rename" | "after-marker";
	},
): Promise<D779PersistenceReceiptV1> {
	const input = record(inputValue, "d779.persist");
	exactKeys(input, ["bundle", "privateRoot"], "d779.persist");
	const bundle = validateD779QualificationBundle(input.bundle);
	const baselineBasis = record(bundle.qualification, "d779.persist.qualification").baselineBasis as
		| "real-artifact"
		| "injected-test";
	if (!options.allowInjected && baselineBasis !== "real-artifact")
		throw new TypeError("D779 production persistence rejects injected baseline evidence");
	const root = await assertPrivateRoot(input.privateRoot as string);
	const rootStat = await lstat(root);
	const rootIdentity = { dev: rootStat.dev, ino: rootStat.ino };
	const parentHandle = await open(root, constants.O_RDONLY | constants.O_NOFOLLOW);
	const parentHandleStat = await parentHandle.stat().catch(async (error) => {
		await parentHandle.close().catch(() => undefined);
		throw error;
	});
	if (
		parentHandleStat.dev !== rootIdentity.dev ||
		parentHandleStat.ino !== rootIdentity.ino ||
		!parentHandleStat.isDirectory() ||
		(parentHandleStat.mode & 0o777) !== 0o700
	) {
		await parentHandle.close();
		throw new TypeError("D779 private root changed before stable-handle acquisition");
	}
	const finalRoot = join(root, D779_GENERATION_REF);
	const stagingRoot = join(root, `.d779-${randomUUID()}.tmp`);
	let finalIdentity: Readonly<{ dev: number | bigint; ino: number | bigint }> | null = null;
	let stagingIdentity: Readonly<{ dev: number | bigint; ino: number | bigint }> | null = null;
	let finalHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactsHandle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		await mkdir(finalRoot, { mode: 0o700 });
		const finalStat = await lstat(finalRoot);
		finalIdentity = { dev: finalStat.dev, ino: finalStat.ino };
		finalHandle = await open(finalRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
		const stableFinal = await finalHandle.stat();
		if (stableFinal.dev !== finalIdentity.dev || stableFinal.ino !== finalIdentity.ino)
			throw new TypeError("D779 final claim changed before stable-handle acquisition");
		if (options.faultStage === "after-claim")
			throw new TypeError("D779 injected after-claim fault");
		await mkdir(stagingRoot, { mode: 0o700 });
		const stagingStat = await lstat(stagingRoot);
		stagingIdentity = { dev: stagingStat.dev, ino: stagingStat.ino };
		const bundleBytes = strictJsonCodec.encode(bundle);
		await writePrivateFile(join(stagingRoot, "bundle.v1.json"), bundleBytes);
		await syncDir(stagingRoot);
		if (options.faultStage === "after-write")
			throw new TypeError("D779 injected after-write fault");
		await rename(stagingRoot, join(finalRoot, "artifacts"));
		const artifactsRoot = join(finalRoot, "artifacts");
		artifactsHandle = await open(artifactsRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
		const stableArtifacts = await artifactsHandle.stat();
		if (
			stableArtifacts.dev !== stagingIdentity.dev ||
			stableArtifacts.ino !== stagingIdentity.ino ||
			!stableArtifacts.isDirectory() ||
			(stableArtifacts.mode & 0o777) !== 0o700
		)
			throw new TypeError("D779 committed artifacts identity drifted");
		stagingIdentity = null;
		if (options.faultStage === "after-rename")
			throw new TypeError("D779 injected after-rename fault");
		const markerMaterial = strictSnapshot({
			generationRef: D779_GENERATION_REF,
			bundleDigest: bundle.bundleDigest,
			bundleArtifactDigest: empiricalSha256(bundleBytes),
		});
		const marker = strictSnapshot({
			...markerMaterial,
			commitMarkerDigest: empiricalStrictJsonDigest(markerMaterial),
		});
		const markerBytes = strictJsonCodec.encode(marker);
		await writePrivateFile(join(finalRoot, "commit.v1.json"), markerBytes);
		if (options.faultStage === "after-marker")
			throw new TypeError("D779 injected after-marker fault");
		await finalHandle.sync();
		await parentHandle.sync();
		const persistedBundle = await open(
			join(finalRoot, "artifacts", "bundle.v1.json"),
			constants.O_RDONLY | constants.O_NOFOLLOW,
		);
		try {
			const bytes = await persistedBundle.readFile();
			if (!sameBytes(bytes, bundleBytes)) throw new TypeError("D779 final bundle readback drifted");
		} finally {
			await persistedBundle.close();
		}
		const persistedMarker = await open(
			join(finalRoot, "commit.v1.json"),
			constants.O_RDONLY | constants.O_NOFOLLOW,
		);
		try {
			const bytes = await persistedMarker.readFile();
			if (!sameBytes(bytes, markerBytes))
				throw new TypeError("D779 commit marker readback drifted");
		} finally {
			await persistedMarker.close();
		}
		const rebound = await lstat(finalRoot);
		const reboundRoot = await lstat(root);
		const reboundArtifacts = await lstat(join(finalRoot, "artifacts"));
		const stableFinalAfter = await finalHandle.stat();
		const stableArtifactsAfter = await artifactsHandle.stat();
		if (
			reboundRoot.dev !== rootIdentity.dev ||
			reboundRoot.ino !== rootIdentity.ino ||
			rebound.dev !== finalIdentity.dev ||
			rebound.ino !== finalIdentity.ino ||
			reboundArtifacts.dev !== stableArtifacts.dev ||
			reboundArtifacts.ino !== stableArtifacts.ino ||
			stableFinalAfter.dev !== finalIdentity.dev ||
			stableFinalAfter.ino !== finalIdentity.ino ||
			stableArtifactsAfter.dev !== stableArtifacts.dev ||
			stableArtifactsAfter.ino !== stableArtifacts.ino ||
			!rebound.isDirectory() ||
			(rebound.mode & 0o777) !== 0o700 ||
			(await realpath(finalRoot)) !== finalRoot
		)
			throw new TypeError("D779 final generation identity drifted");
		const closeResults = await Promise.allSettled([
			artifactsHandle.close(),
			finalHandle.close(),
			parentHandle.close(),
		]);
		artifactsHandle = null;
		finalHandle = null;
		const closeErrors = closeResults.filter(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		if (closeErrors.length > 0)
			throw new AggregateError(
				closeErrors.map((result) => result.reason),
				"D779 stable persistence handle close failed",
			);
		const receiptMaterial = strictSnapshot({
			schemaVersion: D779_PERSISTENCE_SCHEMA,
			generationRef: D779_GENERATION_REF,
			baselineBasis,
			bundleDigest: bundle.bundleDigest,
			bundleArtifactDigest: marker.bundleArtifactDigest,
			commitMarkerDigest: marker.commitMarkerDigest,
		});
		return Object.freeze({
			...receiptMaterial,
			persistenceDigest: empiricalStrictJsonDigest(receiptMaterial),
		});
	} catch (error) {
		const cleanupErrors: unknown[] = [];
		for (const handle of [artifactsHandle, finalHandle])
			if (handle !== null)
				await handle.close().catch((cleanupError) => cleanupErrors.push(cleanupError));
		if (stagingIdentity !== null) {
			const current = await lstat(stagingRoot).catch(() => null);
			if (
				current !== null &&
				current.dev === stagingIdentity.dev &&
				current.ino === stagingIdentity.ino
			)
				await rm(stagingRoot, { recursive: true, force: true }).catch((cleanupError) =>
					cleanupErrors.push(cleanupError),
				);
		}
		if (finalIdentity !== null) {
			const current = await lstat(finalRoot).catch(() => null);
			if (
				current !== null &&
				current.dev === finalIdentity.dev &&
				current.ino === finalIdentity.ino
			) {
				const tombstone = join(root, `.d779-cleanup-${randomUUID()}.tmp`);
				await rename(finalRoot, tombstone).catch((cleanupError) =>
					cleanupErrors.push(cleanupError),
				);
				const moved = await lstat(tombstone).catch(() => null);
				if (moved !== null && moved.dev === finalIdentity.dev && moved.ino === finalIdentity.ino)
					await rm(tombstone, { recursive: true, force: true }).catch((cleanupError) =>
						cleanupErrors.push(cleanupError),
					);
				else if (moved !== null)
					cleanupErrors.push(new TypeError("D779 cleanup tombstone identity drifted"));
			}
		}
		await parentHandle.close().catch(() => undefined);
		if (cleanupErrors.length > 0)
			throw new AggregateError([error, ...cleanupErrors], "D779 persistence and cleanup failed");
		throw error;
	}
}

export async function persistD779QualificationBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D779QualificationBundleV1;
}): Promise<D779PersistenceReceiptV1> {
	if (!constructedBundles.has(inputValue.bundle as object))
		throw new TypeError("D779 production bundle is forged or replayed");
	constructedBundles.delete(inputValue.bundle as object);
	return persistBundle(inputValue, { allowInjected: false });
}

export async function persistD779InjectedBundleForTest(
	inputValue: {
		readonly privateRoot: string;
		readonly bundle: D779QualificationBundleV1;
	},
	faultStage?: "after-claim" | "after-write" | "after-rename" | "after-marker",
): Promise<D779PersistenceReceiptV1> {
	return persistBundle(inputValue, {
		allowInjected: true,
		...(faultStage === undefined ? {} : { faultStage }),
	});
}
