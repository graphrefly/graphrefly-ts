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
import { createD776CallerExecutor, runD776GraphNativeEvalCore } from "./d776-graph-native-eval.js";
import {
	D776_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD776Implementation,
} from "./d776-implementation-manifest.js";
import {
	createD776ProviderResultEnvelope,
	invokeD776AdmittedRouteTurn,
	validateD776RouteEvidence,
} from "./d776-provider-result-route-authority.js";

export const D776_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d776.inspection-phase-lowering-qualification.v1" as const;
export const D776_GENERATION_SCHEMA =
	"graphrefly.b112.d776.inspection-phase-lowering-generation.v1" as const;
export const D776_BUNDLE_SCHEMA =
	"graphrefly.b112.d776.inspection-phase-lowering-bundle.v1" as const;
export const D776_PERSISTENCE_SCHEMA =
	"graphrefly.b112.d776.inspection-phase-lowering-persistence.v1" as const;
export const D776_GENERATION_REF = "d776-inspection-phase-lowering-no-network-v1" as const;

const LIMITS = Object.freeze({
	maxRequests: 128,
	maxRetryWaits: 12,
	maxCostMicrousd: 6_000_000,
	maxElapsedMs: 7_200_000,
});
const CEILINGS = Object.freeze({
	routeDigest: empiricalStrictJsonDigest({ d776: "injected-no-network-route" }),
	providerMaxCostMicrousd: 50_000,
	providerMaxElapsedMs: 60_000,
	localEffectMaxElapsedMs: 60_000,
});
const SOURCE_DIGEST = empiricalStrictJsonDigest({
	decisionRef: "decision.D776.2026-08-13.v1",
	baseline: "consumed-d775-partial-canonical-graph-evidence",
	executionClass: "simulated-contract",
});
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const D775_BASELINE_ARTIFACT_SHA256 =
	"sha256:84fdd2d586087c44beeacc252bff8b9d6fffa3ede5f732035bf0e7c09468ec8a" as const;
const D775_BASELINE_BUNDLE_DIGEST =
	"sha256:230d3d0d63131312dfffe75026361b8f4e02fc0ec26f0a87f03d8d0f821bb5eb" as const;
const D775_BASELINE_GRAPH_EVIDENCE_DIGEST =
	"sha256:d136636eb906ede1f8bcbc7de76fe52f80567f1f2c999d7ca3ff00e647af9b2b" as const;
const D775_BASELINE_ROUTE_EVIDENCE_DIGEST =
	"sha256:83aa7ac2122610e1786271283eb807dab76d5e15c14932c8f2f47f9dddceb084" as const;

export interface D776QualificationBundleV1 {
	readonly schemaVersion: typeof D776_BUNDLE_SCHEMA;
	readonly executionClass: "simulated-contract";
	readonly graphEvidence: D771CanonicalGraphEvidenceV1;
	readonly routeEvidence: ReturnType<typeof validateD776RouteEvidence>;
	readonly wrongToolGraphEvidence: D771CanonicalGraphEvidenceV1;
	readonly wrongToolRouteEvidence: ReturnType<typeof validateD776RouteEvidence>;
	readonly omissionGraphEvidence: D771CanonicalGraphEvidenceV1;
	readonly omissionRouteEvidence: ReturnType<typeof validateD776RouteEvidence>;
	readonly terminalHttpGraphEvidence: D771CanonicalGraphEvidenceV1;
	readonly terminalHttpRouteEvidence: ReturnType<typeof validateD776RouteEvidence>;
	readonly hiddenFailureGraphEvidence: D771CanonicalGraphEvidenceV1;
	readonly hiddenFailureRouteEvidence: ReturnType<typeof validateD776RouteEvidence>;
	readonly qualification: Readonly<Record<string, unknown>>;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly bundleDigest: string;
}

export interface D776ConsumedD775BaselineV1 {
	readonly schemaVersion: "graphrefly.b112.d776.consumed-d775-baseline.v1";
	readonly basis: "real-artifact" | "injected-test";
	readonly artifactSha256: typeof D775_BASELINE_ARTIFACT_SHA256;
	readonly bundleDigest: typeof D775_BASELINE_BUNDLE_DIGEST;
	readonly graphEvidenceDigest: typeof D775_BASELINE_GRAPH_EVIDENCE_DIGEST;
	readonly routeEvidenceDigest: typeof D775_BASELINE_ROUTE_EVIDENCE_DIGEST;
	readonly disposition: "partial-failure";
	readonly receiptDigest: string;
}

export interface D776PersistenceReceiptV1 {
	readonly schemaVersion: typeof D776_PERSISTENCE_SCHEMA;
	readonly generationRef: typeof D776_GENERATION_REF;
	readonly baselineBasis: "real-artifact" | "injected-test";
	readonly bundleDigest: string;
	readonly bundleArtifactDigest: string;
	readonly commitMarkerDigest: string;
	readonly persistenceDigest: string;
}

type RetryReason = Exclude<D719RetryReason, "none">;

function baselineMaterial(basis: "real-artifact" | "injected-test") {
	return strictSnapshot({
		schemaVersion: "graphrefly.b112.d776.consumed-d775-baseline.v1" as const,
		basis,
		artifactSha256: D775_BASELINE_ARTIFACT_SHA256,
		bundleDigest: D775_BASELINE_BUNDLE_DIGEST,
		graphEvidenceDigest: D775_BASELINE_GRAPH_EVIDENCE_DIGEST,
		routeEvidenceDigest: D775_BASELINE_ROUTE_EVIDENCE_DIGEST,
		disposition: "partial-failure" as const,
	});
}

function validateBaseline(value: unknown): D776ConsumedD775BaselineV1 {
	const candidate = record(value, "d776.baseline");
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
		"d776.baseline",
	);
	if (candidate.basis !== "real-artifact" && candidate.basis !== "injected-test")
		throw new TypeError("D776 baseline basis drifted");
	const material = baselineMaterial(candidate.basis);
	for (const key of Object.keys(material))
		literal(
			candidate[key],
			(material as Readonly<Record<string, string>>)[key]!,
			`d776.baseline.${key}`,
		);
	if (candidate.receiptDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D776 baseline receipt digest drifted");
	return strictSnapshot(candidate) as unknown as D776ConsumedD775BaselineV1;
}

export function admitD776ConsumedD775Baseline(bytes: Uint8Array): D776ConsumedD775BaselineV1 {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 16 * 1_048_576)
		throw new TypeError("D776 D775 baseline bytes are outside the bound");
	literal(empiricalSha256(bytes), D775_BASELINE_ARTIFACT_SHA256, "d776.baseline.sha256");
	const bundle = record(strictJsonCodec.decode(bytes), "d776.baseline.bundle");
	literal(bundle.disposition, "partial-failure", "d776.baseline.bundle.disposition");
	literal(bundle.bundleDigest, D775_BASELINE_BUNDLE_DIGEST, "d776.baseline.bundle.digest");
	const graphEvidence = record(bundle.graphEvidence, "d776.baseline.bundle.graphEvidence");
	const routeEvidence = record(bundle.routeEvidence, "d776.baseline.bundle.routeEvidence");
	literal(
		graphEvidence.evidenceDigest,
		D775_BASELINE_GRAPH_EVIDENCE_DIGEST,
		"d776.baseline.graph.digest",
	);
	literal(
		routeEvidence.evidenceDigest,
		D775_BASELINE_ROUTE_EVIDENCE_DIGEST,
		"d776.baseline.route.digest",
	);
	const material = baselineMaterial("real-artifact");
	return Object.freeze({ ...material, receiptDigest: empiricalStrictJsonDigest(material) });
}

export function createD776InjectedBaselineForTest(): D776ConsumedD775BaselineV1 {
	const material = baselineMaterial("injected-test");
	return Object.freeze({ ...material, receiptDigest: empiricalStrictJsonDigest(material) });
}

function routeAdmission() {
	const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
	return createD733GraphNativeRouteAdmission({
		profile,
		access: createD733RouteAccessProjection({
			profile,
			observationRevision: "d776.injected-no-network.v1",
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
		| "hidden-failure" = "positive",
) {
	const workspaces = new Map<number, string>();
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
	const executor = createD776CallerExecutor(async ({ admission, effectRequest }) => {
		active += 1;
		maxActive = Math.max(maxActive, active);
		if (active !== 1) throw new TypeError("D776 observed parallel effects");
		try {
			if (effectRequest.effectKind === "materialization") {
				const workspace = empiricalStrictJsonDigest({
					d776: "workspace",
					run: effectRequest.runSequence,
				});
				workspaces.set(effectRequest.runSequence, workspace);
				return createD776ProviderResultEnvelope({
					effectRequest,
					routeProposal: null,
					execution: {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "materialization",
							status: "ready",
							workspaceStateDigest: workspace,
							evidenceDigest: empiricalStrictJsonDigest({ d776: "materialized", effectRequest }),
						},
					},
				});
			}
			const workspace = workspaces.get(effectRequest.runSequence);
			if (effectRequest.effectKind === "provider-request") {
				if (workspace === undefined) throw new TypeError("D776 provider workspace is missing");
				const retryReason = retryReasons.get(effectRequest.runSequence);
				const injectRetry =
					retryReason !== undefined &&
					(effectRequest.runSequence < 3
						? effectRequest.completionContext === undefined
						: effectRequest.completionContext?.nextRequiredPhase === "inspection") &&
					effectRequest.attemptOrdinal === 1 &&
					!retried.has(effectRequest.runSequence);
				if (injectRetry) retried.add(effectRequest.runSequence);
				const envelope = await invokeD776AdmittedRouteTurn({
					effectRequest: effectRequest as never,
					admission,
					credential: {
						bearerToken: "not-a-live-d776-credential",
						credentialBindingRef: "d776.injected-no-network",
						credentialBindingRevision: "v1",
					},
					taskStatement: "D776 bounded injected repository repair",
					conversation: { messages: [] },
					signal: new AbortController().signal,
					monotonicNowMs: () => providerCalls,
					routeAdmission: routeAdmission(),
					transport: {
						async request(request) {
							providerCalls += 1;
							const priorBody = retryBodies.get(effectRequest.logicalRequestDigest);
							if (priorBody === undefined)
								retryBodies.set(effectRequest.logicalRequestDigest, request.body.slice());
							else if (!sameBytes(priorBody, request.body))
								throw new TypeError("D776 same-request retry wire body drifted");
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
							const body = record(JSON.parse(decoder.decode(request.body)), "d776.injected.body");
							const choice = body.tool_choice;
							let toolName: string | null = null;
							if (choice !== "none") {
								if (choice === "required" || choice === "auto") toolName = "read_file";
								else
									toolName = record(record(choice, "d776.choice").function, "d776.choice.fn")
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
										id: `d776-${providerCalls}`,
										usage: { prompt_tokens: 1, completion_tokens: 1 },
										choices: [
											calls.length === 0
												? { finish_reason: "stop", message: { content: "{}" } }
												: {
														finish_reason: "tool_calls",
														message: {
															content: null,
															tool_calls: calls.map((name, index) => ({
																id: `d776-${providerCalls}-${index}`,
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
				if (
					injectRetry &&
					retryReason === "d675-und-err-socket" &&
					envelope.routeProposal !== null &&
					envelope.execution.result.effectKind === "provider-request"
				)
					return createD776ProviderResultEnvelope({
						effectRequest,
						routeProposal: envelope.routeProposal,
						execution: {
							...envelope.execution,
							result: {
								...envelope.execution.result,
								status: "retryable-failure",
								toolIntents: Object.freeze([]),
								failureDiscriminator: "d675-und-err-socket",
								retryAfterMs: null,
								evidenceDigest: empiricalStrictJsonDigest({
									d776: "injected-d675-result",
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
					return createD776ProviderResultEnvelope({
						effectRequest,
						routeProposal: null,
						execution: envelope.execution,
					});
				}
				return envelope;
			}
			if (effectRequest.effectKind === "retry-wait") {
				retryWaits += 1;
				return createD776ProviderResultEnvelope({
					effectRequest,
					routeProposal: null,
					execution: {
						actualCostMicrousd: 0,
						actualElapsedMs: effectRequest.retryAfterMs ?? 60_000,
						result: {
							effectKind: "retry-wait",
							status: "completed",
							evidenceDigest: empiricalStrictJsonDigest({ d776: "retry-wait", effectRequest }),
						},
					},
				});
			}
			if (effectRequest.effectKind === "tool-action") {
				if (workspace === undefined || effectRequest.toolIntent === null)
					throw new TypeError("D776 tool workspace is missing");
				const after =
					effectRequest.toolIntent.toolRef === "replace-exact"
						? empiricalStrictJsonDigest({
								workspace,
								mutation: effectRequest.toolIntent.intentDigest,
							})
						: workspace;
				workspaces.set(effectRequest.runSequence, after);
				return createD776ProviderResultEnvelope({
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
							evidenceDigest: empiricalStrictJsonDigest({ d776: "tool", effectRequest }),
						},
					},
				});
			}
			if (effectRequest.effectKind === "public-semantic-validation") {
				if (workspace === undefined) throw new TypeError("D776 semantic workspace is missing");
				const attempt = (semanticAttempts.get(effectRequest.runSequence) ?? 0) + 1;
				semanticAttempts.set(effectRequest.runSequence, attempt);
				return createD776ProviderResultEnvelope({
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
								d776: "semantic",
								attempt,
								effectRequest,
							}),
						},
					},
				});
			}
			if (effectRequest.effectKind === "hidden-verifier") {
				if (workspace === undefined) throw new TypeError("D776 hidden workspace is missing");
				const hiddenAttempt = (hiddenAttempts.get(effectRequest.runSequence) ?? 0) + 1;
				hiddenAttempts.set(effectRequest.runSequence, hiddenAttempt);
				const injectedFailure =
					mode === "hidden-failure" && effectRequest.runSequence === 0 && hiddenAttempt === 1;
				if (injectedFailure) negativeInjected = true;
				return createD776ProviderResultEnvelope({
					effectRequest,
					routeProposal: null,
					execution: {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "hidden-verifier",
							status: injectedFailure ? "failed" : "passed",
							workspaceStateDigest: workspace,
							evidenceDigest: empiricalStrictJsonDigest({ d776: "hidden", effectRequest }),
						},
					},
				});
			}
			workspaces.delete(effectRequest.runSequence);
			return createD776ProviderResultEnvelope({
				effectRequest,
				routeProposal: null,
				execution: {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "cleanup",
						status: "succeeded",
						evidenceDigest: empiricalStrictJsonDigest({ d776: "cleanup", effectRequest }),
					},
				},
			});
		} finally {
			active -= 1;
		}
	});
	const policy = createD761GraphPublicSemanticValidationPolicy();
	const terminalPolicy = createD726ArmLocalTerminalProviderPolicy();
	const core = await runD776GraphNativeEvalCore({
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
	const routeEvidence = validateD776RouteEvidence(
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
			`D776 injected six-arm operational qualification drifted: ${JSON.stringify({
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
	return Object.freeze({ graphEvidence, routeEvidence, providerCalls, retryWaits, maxActive });
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
			throw new TypeError("D776 terminal HTTP provenance drifted");
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
		throw new TypeError("D776 hidden-verifier failure provenance drifted");
}

function assertLifecycle(graph: D771CanonicalGraphEvidenceV1): void {
	if (graph.effectRuns.length !== 6) throw new TypeError("D776 qualification requires six runs");
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
			throw new TypeError(`D776 run ${index} lifecycle drifted`);
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
			throw new TypeError(`D776 run ${runIndex} inspection recovery lifecycle drifted`);
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
			`D776 retry policy coverage drifted: ${JSON.stringify(deriveRetryCoverage(graph))}`,
		);
}

function assertWrongToolRejected(graph: D771CanonicalGraphEvidenceV1): void {
	const run = graph.effectRuns[0];
	if (run === undefined) throw new TypeError("D776 wrong-tool run is missing");
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
		throw new TypeError("D776 wrong inspection tool was not rejected before side effects");
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
		throw new TypeError("D776 proposal omission did not remain executor-failure provenance");
}

export async function runD776InjectedNoNetworkQualification(
	baselineValue: D776ConsumedD775BaselineV1,
): Promise<D776QualificationBundleV1> {
	const baseline = validateBaseline(baselineValue);
	if ((await measureD776Implementation()) !== D776_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D776 implementation manifest validation failed");
	const run = await runInjectedSixArms();
	const wrongTool = await runInjectedSixArms("wrong-inspection-tool");
	const omission = await runInjectedSixArms("proposal-omission");
	const terminalHttp = await runInjectedSixArms("terminal-http");
	const hiddenFailure = await runInjectedSixArms("hidden-failure");
	assertLifecycle(run.graphEvidence);
	assertInspectionRecoveryLifecycle(run.graphEvidence);
	assertRetryCoverage(run.graphEvidence);
	assertWrongToolRejected(wrongTool.graphEvidence);
	assertProposalOmissionSeparated(omission.graphEvidence);
	assertFailureProvenanceSeparated(terminalHttp.graphEvidence, "http-terminal");
	assertFailureProvenanceSeparated(hiddenFailure.graphEvidence, "hidden-verifier");
	const routePhases = run.routeEvidence.facts.map((fact) => fact.nextRequiredPhase);
	for (const phase of [
		"inspection",
		"exact-mutation",
		"workspace-diff",
		"focused-validation",
		"hidden-verifier",
	] as const)
		if (!routePhases.includes(phase)) throw new TypeError(`D776 phase ${phase} was not qualified`);
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D776_QUALIFICATION_SCHEMA,
		decisionRef: "decision.D776.2026-08-13.v1",
		baselineDisposition: "consumed-d775-partial-canonical-graph-evidence",
		baselineBasis: baseline.basis,
		baselineArtifactSha256: baseline.artifactSha256,
		baselineBundleDigest: baseline.bundleDigest,
		baselineGraphEvidenceDigest: baseline.graphEvidenceDigest,
		baselineRouteEvidenceDigest: baseline.routeEvidenceDigest,
		implementationManifestDigest: D776_IMPLEMENTATION_MANIFEST_DIGEST,
		graphEvidenceDigest: run.graphEvidence.evidenceDigest,
		routeEvidenceDigest: run.routeEvidence.evidenceDigest,
		completedArms: 6,
		providerCalls: run.providerCalls,
		retryWaits: run.retryWaits,
		maxActiveEffects: run.maxActive,
		providerRouteBijection: true,
		allCorrectionPhasesLowered: true,
		adapterSideLedgerCount: 0,
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
		schemaVersion: D776_GENERATION_SCHEMA,
		generationRef: D776_GENERATION_REF,
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
		schemaVersion: D776_BUNDLE_SCHEMA,
		executionClass: "simulated-contract" as const,
		graphEvidence: run.graphEvidence,
		routeEvidence: run.routeEvidence,
		wrongToolGraphEvidence: wrongTool.graphEvidence,
		wrongToolRouteEvidence: wrongTool.routeEvidence,
		omissionGraphEvidence: omission.graphEvidence,
		omissionRouteEvidence: omission.routeEvidence,
		terminalHttpGraphEvidence: terminalHttp.graphEvidence,
		terminalHttpRouteEvidence: terminalHttp.routeEvidence,
		hiddenFailureGraphEvidence: hiddenFailure.graphEvidence,
		hiddenFailureRouteEvidence: hiddenFailure.routeEvidence,
		qualification,
		generation,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const bundle = Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
	return bundle;
}

export function validateD776QualificationBundle(value: unknown): D776QualificationBundleV1 {
	const candidate = record(value, "d776.bundle");
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
			"qualification",
			"routeEvidence",
			"schemaVersion",
			"wrongToolGraphEvidence",
			"wrongToolRouteEvidence",
		],
		"d776.bundle",
	);
	literal(candidate.schemaVersion, D776_BUNDLE_SCHEMA, "d776.bundle.schemaVersion");
	literal(candidate.executionClass, "simulated-contract", "d776.bundle.executionClass");
	literal(candidate.causalAttribution, "undetermined", "d776.bundle.causalAttribution");
	literal(candidate.efficacyClaim, "none", "d776.bundle.efficacyClaim");
	const graphCandidate = record(candidate.graphEvidence, "d776.bundle.graphEvidence");
	const graph = deriveD771CanonicalGraphEvidence(
		graphCandidate.ledger as never,
		graphCandidate.effectRuns as never,
		createD726ArmLocalTerminalProviderPolicy(),
		createD761GraphPublicSemanticValidationPolicy(),
	);
	if (graph.evidenceDigest !== graphCandidate.evidenceDigest)
		throw new TypeError("D776 canonical Graph replay drifted");
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
	const routeEvidence = validateD776RouteEvidence(
		candidate.routeEvidence,
		providerFacts,
		CEILINGS,
		graph.ledger.effectReconciliations,
	);
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
		"d776.bundle.wrongToolGraphEvidence",
	);
	assertWrongToolRejected(wrongToolGraph);
	validateD776RouteEvidence(
		candidate.wrongToolRouteEvidence,
		factsFor(wrongToolGraph),
		CEILINGS,
		wrongToolGraph.ledger.effectReconciliations,
	);
	const terminalHttpGraph = replayNegative(
		candidate.terminalHttpGraphEvidence,
		"d776.bundle.terminalHttpGraphEvidence",
	);
	assertFailureProvenanceSeparated(terminalHttpGraph, "http-terminal");
	validateD776RouteEvidence(
		candidate.terminalHttpRouteEvidence,
		factsFor(terminalHttpGraph),
		CEILINGS,
		terminalHttpGraph.ledger.effectReconciliations,
	);
	const hiddenFailureGraph = replayNegative(
		candidate.hiddenFailureGraphEvidence,
		"d776.bundle.hiddenFailureGraphEvidence",
	);
	assertFailureProvenanceSeparated(hiddenFailureGraph, "hidden-verifier");
	validateD776RouteEvidence(
		candidate.hiddenFailureRouteEvidence,
		factsFor(hiddenFailureGraph),
		CEILINGS,
		hiddenFailureGraph.ledger.effectReconciliations,
	);
	const omissionGraph = replayNegative(
		candidate.omissionGraphEvidence,
		"d776.bundle.omissionGraphEvidence",
	);
	assertProposalOmissionSeparated(omissionGraph);
	validateD776RouteEvidence(
		candidate.omissionRouteEvidence,
		factsFor(omissionGraph),
		CEILINGS,
		omissionGraph.ledger.effectReconciliations,
	);
	const qualification = record(candidate.qualification, "d776.bundle.qualification");
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
			"workspaceResidueCount",
			"wrongToolRejectedPreSideEffect",
		],
		"d776.bundle.qualification",
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
		qualification.implementationManifestDigest !== D776_IMPLEMENTATION_MANIFEST_DIGEST ||
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
		qualification.credentialReads !== 0 ||
		qualification.controlPlaneCalls !== 0 ||
		qualification.providerNetworkCalls !== 0 ||
		qualification.workspaceResidueCount !== 0
	)
		throw new TypeError("D776 qualification projection drifted");
	const { qualificationDigest, ...qualificationMaterial } = qualification;
	if (qualificationDigest !== empiricalStrictJsonDigest(qualificationMaterial))
		throw new TypeError("D776 qualification digest drifted");
	const generation = record(candidate.generation, "d776.bundle.generation");
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
		"d776.bundle.generation",
	);
	if (
		generation.generationRef !== D776_GENERATION_REF ||
		generation.qualificationDigest !== qualificationDigest ||
		generation.graphEvidenceDigest !== graph.evidenceDigest ||
		generation.routeEvidenceDigest !== routeEvidence.evidenceDigest ||
		generation.causalAttribution !== "undetermined" ||
		generation.efficacyClaim !== "none"
	)
		throw new TypeError("D776 generation binding drifted");
	const { generationDigest, ...generationMaterial } = generation;
	if (generationDigest !== empiricalStrictJsonDigest(generationMaterial))
		throw new TypeError("D776 generation digest drifted");
	const { bundleDigest, ...bundleMaterial } = candidate;
	if (bundleDigest !== empiricalStrictJsonDigest(bundleMaterial))
		throw new TypeError("D776 bundle digest drifted");
	return strictSnapshot(candidate) as unknown as D776QualificationBundleV1;
}

async function assertPrivateRoot(path: string) {
	const canonical = resolve(path);
	const stat = await lstat(canonical);
	if (
		!stat.isDirectory() ||
		(stat.mode & 0o777) !== 0o700 ||
		(await realpath(canonical)) !== canonical
	)
		throw new TypeError("D776 private root must be a canonical 0700 directory");
	return canonical;
}

async function writePrivateFile(path: string, bytes: Uint8Array): Promise<void> {
	const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
		const stat = await handle.stat();
		if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600)
			throw new TypeError("D776 private artifact identity drifted");
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
		readonly bundle: D776QualificationBundleV1;
	},
	options: {
		readonly allowInjected: boolean;
		readonly faultStage?: "after-claim" | "after-write" | "after-rename" | "after-marker";
	},
): Promise<D776PersistenceReceiptV1> {
	const input = record(inputValue, "d776.persist");
	exactKeys(input, ["bundle", "privateRoot"], "d776.persist");
	const bundle = validateD776QualificationBundle(input.bundle);
	const baselineBasis = record(bundle.qualification, "d776.persist.qualification").baselineBasis as
		| "real-artifact"
		| "injected-test";
	if (!options.allowInjected && baselineBasis !== "real-artifact")
		throw new TypeError("D776 production persistence rejects injected baseline evidence");
	const root = await assertPrivateRoot(input.privateRoot as string);
	const finalRoot = join(root, D776_GENERATION_REF);
	const stagingRoot = join(root, `.d776-${randomUUID()}.tmp`);
	let finalIdentity: Readonly<{ dev: number | bigint; ino: number | bigint }> | null = null;
	let stagingIdentity: Readonly<{ dev: number | bigint; ino: number | bigint }> | null = null;
	try {
		await mkdir(finalRoot, { mode: 0o700 });
		const finalStat = await lstat(finalRoot);
		finalIdentity = { dev: finalStat.dev, ino: finalStat.ino };
		if (options.faultStage === "after-claim")
			throw new TypeError("D776 injected after-claim fault");
		await mkdir(stagingRoot, { mode: 0o700 });
		const stagingStat = await lstat(stagingRoot);
		stagingIdentity = { dev: stagingStat.dev, ino: stagingStat.ino };
		const bundleBytes = strictJsonCodec.encode(bundle);
		await writePrivateFile(join(stagingRoot, "bundle.v1.json"), bundleBytes);
		await syncDir(stagingRoot);
		if (options.faultStage === "after-write")
			throw new TypeError("D776 injected after-write fault");
		await rename(stagingRoot, join(finalRoot, "artifacts"));
		stagingIdentity = null;
		if (options.faultStage === "after-rename")
			throw new TypeError("D776 injected after-rename fault");
		const markerMaterial = strictSnapshot({
			generationRef: D776_GENERATION_REF,
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
			throw new TypeError("D776 injected after-marker fault");
		await syncDir(finalRoot);
		await syncDir(root);
		const persistedBundle = await open(
			join(finalRoot, "artifacts", "bundle.v1.json"),
			constants.O_RDONLY | constants.O_NOFOLLOW,
		);
		try {
			const bytes = await persistedBundle.readFile();
			if (!sameBytes(bytes, bundleBytes)) throw new TypeError("D776 final bundle readback drifted");
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
				throw new TypeError("D776 commit marker readback drifted");
		} finally {
			await persistedMarker.close();
		}
		const rebound = await lstat(finalRoot);
		if (
			rebound.dev !== finalIdentity.dev ||
			rebound.ino !== finalIdentity.ino ||
			!rebound.isDirectory() ||
			(rebound.mode & 0o777) !== 0o700 ||
			(await realpath(finalRoot)) !== finalRoot
		)
			throw new TypeError("D776 final generation identity drifted");
		const receiptMaterial = strictSnapshot({
			schemaVersion: D776_PERSISTENCE_SCHEMA,
			generationRef: D776_GENERATION_REF,
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
				const tombstone = join(root, `.d776-cleanup-${randomUUID()}.tmp`);
				await rename(finalRoot, tombstone).catch((cleanupError) =>
					cleanupErrors.push(cleanupError),
				);
				const moved = await lstat(tombstone).catch(() => null);
				if (moved !== null && moved.dev === finalIdentity.dev && moved.ino === finalIdentity.ino)
					await rm(tombstone, { recursive: true, force: true }).catch((cleanupError) =>
						cleanupErrors.push(cleanupError),
					);
				else if (moved !== null)
					cleanupErrors.push(new TypeError("D776 cleanup tombstone identity drifted"));
			}
		}
		if (cleanupErrors.length > 0)
			throw new AggregateError([error, ...cleanupErrors], "D776 persistence and cleanup failed");
		throw error;
	}
}

export async function persistD776QualificationBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D776QualificationBundleV1;
}): Promise<D776PersistenceReceiptV1> {
	return persistBundle(inputValue, { allowInjected: false });
}

export async function persistD776InjectedBundleForTest(
	inputValue: {
		readonly privateRoot: string;
		readonly bundle: D776QualificationBundleV1;
	},
	faultStage?: "after-claim" | "after-write" | "after-rename" | "after-marker",
): Promise<D776PersistenceReceiptV1> {
	return persistBundle(inputValue, {
		allowInjected: true,
		...(faultStage === undefined ? {} : { faultStage }),
	});
}
