import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm, rmdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	digest,
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
import { readD734RouteBoundProviderTurn } from "./d734-route-profile-provider-integration.js";
import { D761_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST } from "./d761-public-semantic-validation-qualification.js";
import {
	createD726ArmLocalTerminalProviderPolicy,
	createD761GraphPublicSemanticValidationPolicy,
} from "./d767-graph-native-effect-runtime.js";
import { runD722GraphNativeEvalCore } from "./d767-graph-native-eval.js";
import {
	D771_ARM_AWARE_GATE_PROJECTION_REVISION,
	D771_QUALIFICATION_SOURCE_DIGEST,
	deriveD771ModelExposure,
	evaluateD771ArmAwarePositiveGate,
} from "./d771-arm-aware-positive-gate.js";
import {
	createD771GraphAdmittedCallerExecutor,
	D771_CRITERION_NAMED_TOOL_LOWERING_REVISION,
	type D771CriterionLoweringProposalV1,
	invokeD771RouteBoundOpenRouterTurn,
	takeD771CriterionLoweringProposal,
} from "./d771-criterion-continuation-lowering.js";
import { deriveD771CanonicalGraphEvidence } from "./d771-graph-completion-memory-insight.js";
import {
	D771_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD771Implementation,
} from "./d771-implementation-manifest.js";
import {
	admitD771CriterionLowering,
	createD771LoweringEvidenceAuthority,
	snapshotD771LoweringGraphEvidence,
	validateD771LoweringGraphEvidence,
} from "./d771-lowering-evidence-authority.js";

export const D771_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d771.criterion-lowering-arm-gate-qualification.v1" as const;
export const D771_GENERATION_SCHEMA =
	"graphrefly.b112.d771.criterion-lowering-arm-gate-generation.v1" as const;
export const D771_BUNDLE_SCHEMA =
	"graphrefly.b112.d771.criterion-lowering-arm-gate-bundle.v1" as const;
export const D771_GENERATION_REF = "d771-criterion-lowering-arm-gate-no-network-v1" as const;
export const D771_PERSISTENCE_SCHEMA =
	"graphrefly.b112.d771.criterion-lowering-arm-gate-persistence.v1" as const;

const LIMITS = Object.freeze({
	maxRequests: 128,
	maxRetryWaits: 12,
	maxCostMicrousd: 6_000_000,
	maxElapsedMs: 7_200_000,
});
const CEILINGS = Object.freeze({
	routeDigest: empiricalStrictJsonDigest({ d771: "injected-no-network-route" }),
	providerMaxCostMicrousd: 50_000,
	providerMaxElapsedMs: 60_000,
	localEffectMaxElapsedMs: 60_000,
});
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const bundles = new WeakSet<object>();
const persistenceFaults = new WeakMap<object, "after-write" | "after-rename">();

export interface D771QualificationBundleV1 {
	readonly schemaVersion: typeof D771_BUNDLE_SCHEMA;
	readonly executionClass: "simulated-contract";
	readonly graphEvidence: ReturnType<typeof deriveD771CanonicalGraphEvidence>;
	readonly retryGraphEvidence: ReturnType<typeof deriveD771CanonicalGraphEvidence>;
	readonly loweringGraphEvidence: ReturnType<typeof snapshotD771LoweringGraphEvidence>;
	readonly gate: ReturnType<typeof evaluateD771ArmAwarePositiveGate>;
	readonly qualification: Readonly<Record<string, unknown>>;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly bundleDigest: string;
}

export interface D771PersistenceReceiptV1 {
	readonly schemaVersion: typeof D771_PERSISTENCE_SCHEMA;
	readonly generationRef: typeof D771_GENERATION_REF;
	readonly bundleDigest: string;
	readonly persistenceDigest: string;
}

function routeAdmission() {
	const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
	return createD733GraphNativeRouteAdmission({
		profile,
		access: createD733RouteAccessProjection({
			profile,
			observationRevision: "d771.injected-no-network.v1",
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

async function runInjectedSixArm(injectCriterionRetry: boolean) {
	const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
	const admission = routeAdmission();
	const workspaces = new Map<number, string>();
	const semanticAttempts = new Map<number, number>();
	const wireBodies = new Map<string, Uint8Array>();
	const criterionLoweringProposals: D771CriterionLoweringProposalV1[] = [];
	let providerCalls = 0;
	let retryWaits = 0;
	let active = 0;
	let maxActive = 0;
	let retriedCriterionLogical: string | null = null;
	let retriedInitialLogical: string | null = null;
	let conversationSubstitutionRejected = false;
	let routeDirectiveReplayRejected = false;
	let rejectedTransportCalls = 0;
	const hiddenStatusByRun = new Map<number, "failed" | "passed">([
		[0, "failed"],
		[2, "passed"],
		[3, "failed"],
		[5, "failed"],
		[7, "failed"],
		[9, "failed"],
	]);
	const recoveryRuns = new Set([1, 4, 6, 8, 10]);
	const enter = () => {
		active += 1;
		maxActive = Math.max(maxActive, active);
		if (active !== 1) throw new TypeError("D771 observed parallel effects");
	};
	const leave = () => {
		active -= 1;
	};
	const executor = createD771GraphAdmittedCallerExecutor({
		budgetLimits: LIMITS,
		async execute({ criterionRouteDirective, effectRequest, request }) {
			enter();
			try {
				const arm = request.input?.value?.arm;
				if (arm === undefined) throw new TypeError("D771 Graph arm coordinate is missing");
				if (effectRequest.effectKind === "materialization") {
					const workspace = empiricalStrictJsonDigest({
						d771: "workspace",
						run: effectRequest.runSequence,
					});
					workspaces.set(effectRequest.runSequence, workspace);
					return {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "materialization" as const,
							status: "ready" as const,
							workspaceStateDigest: workspace,
							evidenceDigest: empiricalStrictJsonDigest({ d771: "materialized", effectRequest }),
						},
					};
				}
				const workspace = workspaces.get(effectRequest.runSequence);
				if (effectRequest.effectKind === "provider-request") {
					if (workspace === undefined) throw new TypeError("D771 provider workspace is missing");
					const exposure = deriveD771ModelExposure(arm, effectRequest);
					const commonTurnInput = {
						effectRequest: effectRequest as never,
						...(criterionRouteDirective === null
							? {}
							: { graphDirective: criterionRouteDirective }),
						credential: {
							bearerToken: "not-a-live-d771-credential",
							credentialBindingRef: "d771.injected-no-network",
							credentialBindingRevision: "v1",
						},
						conversation: exposure.conversation,
						signal: new AbortController().signal,
						monotonicNowMs: () => providerCalls,
						routeAdmission: admission,
					};
					if (!conversationSubstitutionRejected) {
						try {
							await invokeD771RouteBoundOpenRouterTurn({
								...commonTurnInput,
								conversation: { messages: [{ role: "user", content: "substituted" }] },
								taskStatement: exposure.taskStatement,
								transport: {
									async request() {
										rejectedTransportCalls += 1;
										throw new TypeError("D771 substituted conversation reached transport");
									},
								},
							});
						} catch {
							conversationSubstitutionRejected = true;
						}
					}
					const capability = await invokeD771RouteBoundOpenRouterTurn({
						...commonTurnInput,
						transport: {
							async request(request) {
								providerCalls += 1;
								if (
									injectCriterionRetry &&
									retriedInitialLogical === null &&
									effectRequest.attemptOrdinal === 1 &&
									effectRequest.completionContext === undefined
								) {
									retriedInitialLogical = effectRequest.logicalRequestDigest;
									return {
										status: 429,
										retryAfterMs: null,
										body: encoder.encode('{"error":{"message":"bounded initial retry"}}'),
									};
								}
								if (recoveryRuns.has(effectRequest.runSequence))
									return {
										status: 200,
										retryAfterMs: null,
										body: encoder.encode(
											JSON.stringify({
												id: `d771-recovery-${providerCalls}`,
												usage: { prompt_tokens: 1, completion_tokens: 1 },
												choices: [{ finish_reason: "stop", message: { content: "{}" } }],
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
									};
								const bodyBytes = request.body.slice();
								const body = JSON.parse(decoder.decode(bodyBytes)) as {
									tool_choice: "auto" | "none" | { type: "function"; function: { name: string } };
								};
								const name =
									effectRequest.phaseBefore === "focused-validation-passed" &&
									effectRequest.completionContext === undefined
										? null
										: body.tool_choice === "auto"
											? "read_file"
											: body.tool_choice === "none"
												? null
												: body.tool_choice.function.name;
								const isCriterionContinuation =
									effectRequest.completionContext?.reason === "public-semantic-validation-failed";
								if (isCriterionContinuation) {
									if (name !== "replace_exact")
										throw new TypeError(
											"D771 criterion continuation was not lowered to replace_exact",
										);
									const first = wireBodies.get(effectRequest.logicalRequestDigest);
									if (first === undefined)
										wireBodies.set(effectRequest.logicalRequestDigest, bodyBytes);
									else if (!sameBytes(first, bodyBytes))
										throw new TypeError("D771 criterion retry wire body drifted");
									if (
										injectCriterionRetry &&
										retriedCriterionLogical === null &&
										effectRequest.attemptOrdinal === 1
									) {
										retriedCriterionLogical = effectRequest.logicalRequestDigest;
										return {
											status: 429,
											retryAfterMs: null,
											body: encoder.encode('{"error":{"message":"bounded injected retry"}}'),
										};
									}
								}
								const args =
									name === "read_file"
										? { path: "fixture.ts" }
										: name === "replace_exact"
											? { path: "fixture.ts", oldText: "before", newText: "after" }
											: {};
								const toolCalls =
									name === null
										? []
										: isCriterionContinuation
											? [
													{
														id: `d771-${providerCalls}-mutation`,
														type: "function",
														function: {
															name: "replace_exact",
															arguments: JSON.stringify({
																path: "fixture.ts",
																oldText: "before",
																newText: "after",
															}),
														},
													},
													{
														id: `d771-${providerCalls}-diff`,
														type: "function",
														function: { name: "workspace_diff", arguments: "{}" },
													},
													{
														id: `d771-${providerCalls}-validation`,
														type: "function",
														function: { name: "focused_validation", arguments: "{}" },
													},
												]
											: name === "read_file" && effectRequest.completionContext === undefined
												? [
														{
															id: `d771-${providerCalls}-read`,
															type: "function",
															function: {
																name: "read_file",
																arguments: JSON.stringify({ path: "fixture.ts" }),
															},
														},
														{
															id: `d771-${providerCalls}-mutation`,
															type: "function",
															function: {
																name: "replace_exact",
																arguments: JSON.stringify({
																	path: "fixture.ts",
																	oldText: "before",
																	newText: "after",
																}),
															},
														},
														{
															id: `d771-${providerCalls}-diff`,
															type: "function",
															function: { name: "workspace_diff", arguments: "{}" },
														},
														{
															id: `d771-${providerCalls}-validation`,
															type: "function",
															function: { name: "focused_validation", arguments: "{}" },
														},
													]
												: [
														{
															id: `d771-${providerCalls}`,
															type: "function",
															function: { name, arguments: JSON.stringify(args) },
														},
													];
								return {
									status: 200,
									retryAfterMs: null,
									body: encoder.encode(
										JSON.stringify({
											id: `d771-response-${providerCalls}`,
											usage: { prompt_tokens: 1, completion_tokens: 1 },
											choices: [
												name === null
													? { finish_reason: "stop", message: { content: "{}" } }
													: {
															finish_reason: "tool_calls",
															message: {
																content: null,
																tool_calls: toolCalls,
															},
														},
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
								};
							},
						},
						taskStatement: exposure.taskStatement,
					});
					if (!routeDirectiveReplayRejected) {
						try {
							await invokeD771RouteBoundOpenRouterTurn({
								...commonTurnInput,
								taskStatement: exposure.taskStatement,
								transport: {
									async request() {
										rejectedTransportCalls += 1;
										throw new TypeError("D771 replayed directive reached transport");
									},
								},
							});
						} catch {
							routeDirectiveReplayRejected = true;
						}
					}
					const loweringProposal = takeD771CriterionLoweringProposal(effectRequest);
					if (loweringProposal !== null) criterionLoweringProposals.push(loweringProposal);
					const turn = readD734RouteBoundProviderTurn(capability).turn;
					return {
						result: turn.result,
						actualCostMicrousd: 1,
						actualElapsedMs: 1,
					};
				}
				if (effectRequest.effectKind === "retry-wait") {
					retryWaits += 1;
					return {
						actualCostMicrousd: 0,
						actualElapsedMs: effectRequest.retryAfterMs ?? 60_000,
						result: {
							effectKind: "retry-wait" as const,
							status: "completed" as const,
							evidenceDigest: empiricalStrictJsonDigest({ d771: "wait", effectRequest }),
						},
					};
				}
				if (effectRequest.effectKind === "tool-action") {
					if (workspace === undefined || effectRequest.toolIntent === null)
						throw new TypeError("D771 tool workspace is missing");
					const after =
						effectRequest.toolIntent.toolRef === "replace-exact"
							? empiricalStrictJsonDigest({
									workspace,
									mutation: effectRequest.toolIntent.intentDigest,
								})
							: workspace;
					workspaces.set(effectRequest.runSequence, after);
					return {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "tool-action" as const,
							toolRef: effectRequest.toolIntent.toolRef,
							intentDigest: effectRequest.toolIntent.intentDigest,
							status: "succeeded" as const,
							nonEmptyDiff: effectRequest.toolIntent.toolRef === "workspace-diff",
							workspaceStateBeforeDigest: workspace,
							workspaceStateAfterDigest: after,
							evidenceDigest: empiricalStrictJsonDigest({ d771: "tool", effectRequest }),
						},
					};
				}
				if (effectRequest.effectKind === "public-semantic-validation") {
					if (workspace === undefined) throw new TypeError("D771 semantic workspace is missing");
					const attempt = (semanticAttempts.get(effectRequest.runSequence) ?? 0) + 1;
					semanticAttempts.set(effectRequest.runSequence, attempt);
					return {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "public-semantic-validation" as const,
							status: attempt === 1 ? ("failed" as const) : ("passed" as const),
							criterionFailures:
								attempt === 1
									? Object.freeze(["canonical-provenance-not-admitted" as const])
									: Object.freeze([]),
							workspaceStateDigest: workspace,
							evidenceDigest: empiricalStrictJsonDigest({
								d771: "semantic",
								attempt,
								effectRequest,
							}),
						},
					};
				}
				if (effectRequest.effectKind === "hidden-verifier") {
					if (workspace === undefined) throw new TypeError("D771 hidden workspace is missing");
					const hiddenStatus = hiddenStatusByRun.get(effectRequest.runSequence);
					if (hiddenStatus === undefined)
						throw new TypeError("D771 hidden verifier appeared outside the frozen run horizon");
					return {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "hidden-verifier" as const,
							status: hiddenStatus,
							workspaceStateDigest: workspace,
							evidenceDigest: empiricalStrictJsonDigest({ d771: "hidden", effectRequest }),
						},
					};
				}
				workspaces.delete(effectRequest.runSequence);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "cleanup" as const,
						status: "succeeded" as const,
						evidenceDigest: empiricalStrictJsonDigest({ d771: "cleanup", effectRequest }),
					},
				};
			} finally {
				leave();
			}
		},
	});
	const policy = createD761GraphPublicSemanticValidationPolicy();
	const terminalPolicy = createD726ArmLocalTerminalProviderPolicy();
	const core = await runD722GraphNativeEvalCore({
		sourceDigest: D771_QUALIFICATION_SOURCE_DIGEST,
		budgetLimits: LIMITS,
		effectCeilings: CEILINGS,
		executor,
		objectivePhaseRecoveryPolicy: policy,
		armLocalTerminalPolicy: terminalPolicy,
		signal: AbortSignal.timeout(30_000),
	});
	const graphEvidence = deriveD771CanonicalGraphEvidence(
		core.ledger,
		core.effectRuns,
		terminalPolicy,
		policy,
	);
	if (
		workspaces.size !== 0 ||
		maxActive !== 1 ||
		(injectCriterionRetry
			? retriedCriterionLogical === null || retriedInitialLogical === null
			: retriedCriterionLogical !== null || retriedInitialLogical !== null) ||
		!conversationSubstitutionRejected ||
		!routeDirectiveReplayRejected ||
		rejectedTransportCalls !== 0
	)
		throw new TypeError("D771 injected operational qualification drifted");
	if (injectCriterionRetry) {
		const retryFacts = criterionLoweringProposals.filter(
			(proposal) => proposal.logicalRequestDigest === retriedCriterionLogical,
		);
		if (
			retryFacts.length !== 2 ||
			retryFacts[0]?.attemptOrdinal !== 1 ||
			retryFacts[1]?.attemptOrdinal !== 2 ||
			retryFacts[0].requestDigest === retryFacts[1].requestDigest ||
			retryFacts[0].contextDigest !== retryFacts[1].contextDigest ||
			retryFacts[0].loweredBodyDigest !== retryFacts[1].loweredBodyDigest
		)
			throw new TypeError("D771 criterion retry identity drifted");
		const initialRetryFacts = criterionLoweringProposals.filter(
			(proposal) => proposal.logicalRequestDigest === retriedInitialLogical,
		);
		if (
			initialRetryFacts.length !== 2 ||
			initialRetryFacts[0]?.attemptOrdinal !== 1 ||
			initialRetryFacts[1]?.attemptOrdinal !== 2 ||
			initialRetryFacts[0].requestDigest === initialRetryFacts[1].requestDigest ||
			initialRetryFacts[0].contextDigest !== initialRetryFacts[1].contextDigest ||
			initialRetryFacts[0].loweredBodyDigest !== initialRetryFacts[1].loweredBodyDigest
		)
			throw new TypeError("D771 context-free retry identity drifted");
	}
	return Object.freeze({
		graphEvidence,
		providerCalls,
		retryWaits,
		criterionLoweringProposals: Object.freeze(criterionLoweringProposals),
		maxActive,
		workspaceResidueCount: workspaces.size,
	});
}

export async function runD771InjectedNoNetworkQualification(): Promise<D771QualificationBundleV1> {
	if ((await measureD771Implementation()) !== D771_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D771 implementation manifest validation failed");
	const run = await runInjectedSixArm(false);
	const retryRun = await runInjectedSixArm(true);
	const loweringAuthority = createD771LoweringEvidenceAuthority();
	for (const proposal of run.criterionLoweringProposals)
		admitD771CriterionLowering(loweringAuthority, proposal, run.graphEvidence);
	for (const proposal of retryRun.criterionLoweringProposals)
		admitD771CriterionLowering(loweringAuthority, proposal, retryRun.graphEvidence);
	const loweringGraphEvidence = snapshotD771LoweringGraphEvidence(loweringAuthority);
	validateD771LoweringGraphEvidence(loweringGraphEvidence, [
		run.graphEvidence,
		retryRun.graphEvidence,
	]);
	const gate = evaluateD771ArmAwarePositiveGate(run.graphEvidence, loweringGraphEvidence);
	const mainProviderAttempts = run.graphEvidence.effectRuns.reduce(
		(count, effectRun) =>
			count +
			effectRun.facts.filter(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.request.effectKind === "provider-request",
			).length,
		0,
	);
	const retryProviderAttempts = retryRun.graphEvidence.effectRuns.reduce(
		(count, effectRun) =>
			count +
			effectRun.facts.filter(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.request.effectKind === "provider-request",
			).length,
		0,
	);
	if (
		!gate.passed ||
		run.retryWaits !== 0 ||
		run.criterionLoweringProposals.length !== mainProviderAttempts ||
		retryRun.retryWaits !== 2 ||
		retryRun.criterionLoweringProposals.length !== retryProviderAttempts
	)
		throw new TypeError("D771 injected mechanism qualification failed");
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D771_QUALIFICATION_SCHEMA,
		decisionRef: "decision.D771",
		decisionRevision: "2026-08-13.v1",
		baselineD768GraphEvidenceDigest:
			"sha256:3e898e0cb00d94dc0e030a6c8447e838440beac3b80cb8ea932d70ba828c5bd6",
		baselineD767ArtifactSha256:
			"sha256:b770dba74ecf4940c322f5b34cccae5dec4c14155c79be65e50f89185507042c",
		baselineD768BundleArtifactSha256:
			"sha256:952eb36b889c7dac583bb8575b52943fd3dc43bd5d01401609e9364c793d66f8",
		baselineD768BundleDigest:
			"sha256:9b16bffe83d8b151de19b66d1838b19d99d5cc64121f10da422ca7e83119185b",
		implementationManifestDigest: D771_IMPLEMENTATION_MANIFEST_DIGEST,
		loweringRevision: D771_CRITERION_NAMED_TOOL_LOWERING_REVISION,
		gateProjectionRevision: D771_ARM_AWARE_GATE_PROJECTION_REVISION,
		gateDefinitionDigest: D761_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
		graphEvidenceDigest: run.graphEvidence.evidenceDigest,
		retryGraphEvidenceDigest: retryRun.graphEvidence.evidenceDigest,
		loweringGraphEvidenceDigest: loweringGraphEvidence.evidenceDigest,
		gateProjectionDigest: gate.projectionDigest,
		providerNetworkCalls: 0,
		materialFree: true,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = Object.freeze({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: D771_GENERATION_SCHEMA,
		generationRef: D771_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		implementationManifestDigest: D771_IMPLEMENTATION_MANIFEST_DIGEST,
		graphEvidenceDigest: run.graphEvidence.evidenceDigest,
		retryGraphEvidenceDigest: retryRun.graphEvidence.evidenceDigest,
		loweringGraphEvidenceDigest: loweringGraphEvidence.evidenceDigest,
		gateProjectionDigest: gate.projectionDigest,
		providerNetworkCalls: 0,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = Object.freeze({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D771_BUNDLE_SCHEMA,
		executionClass: "simulated-contract" as const,
		graphEvidence: run.graphEvidence,
		retryGraphEvidence: retryRun.graphEvidence,
		loweringGraphEvidence,
		gate,
		qualification,
		generation,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const bundle = Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
	if ((await measureD771Implementation()) !== D771_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D771 implementation changed during qualification");
	bundles.add(bundle);
	return bundle;
}

function replayD771GraphEvidence(value: unknown, path: string) {
	const candidate = record(value, path);
	const policy = createD761GraphPublicSemanticValidationPolicy();
	const terminalPolicy = createD726ArmLocalTerminalProviderPolicy();
	const replay = deriveD771CanonicalGraphEvidence(
		candidate.ledger as never,
		candidate.effectRuns as never,
		terminalPolicy,
		policy,
	);
	literal(candidate.evidenceDigest, replay.evidenceDigest, `${path}.evidenceDigest`);
	literal(
		empiricalStrictJsonDigest(candidate),
		empiricalStrictJsonDigest(replay),
		`${path}.canonicalReplay`,
	);
	return replay;
}

export function validateD771QualificationBundle(value: unknown): D771QualificationBundleV1 {
	const candidate = record(value, "d771.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"causalAttribution",
			"efficacyClaim",
			"executionClass",
			"gate",
			"generation",
			"graphEvidence",
			"loweringGraphEvidence",
			"qualification",
			"retryGraphEvidence",
			"schemaVersion",
		],
		"d771.bundle",
	);
	literal(candidate.schemaVersion, D771_BUNDLE_SCHEMA, "d771.bundle.schemaVersion");
	literal(candidate.executionClass, "simulated-contract", "d771.bundle.executionClass");
	literal(candidate.causalAttribution, "undetermined", "d771.bundle.causalAttribution");
	literal(candidate.efficacyClaim, "none", "d771.bundle.efficacyClaim");
	const graph = replayD771GraphEvidence(candidate.graphEvidence, "d771.graphEvidence");
	const retryGraph = replayD771GraphEvidence(
		candidate.retryGraphEvidence,
		"d771.retryGraphEvidence",
	);
	const loweringGraph = validateD771LoweringGraphEvidence(candidate.loweringGraphEvidence, [
		graph,
		retryGraph,
	]);
	const gate = evaluateD771ArmAwarePositiveGate(graph, loweringGraph);
	literal(gate.passed, true, "d771.gate.passed");
	const gateCandidate = record(candidate.gate, "d771.gate");
	literal(gateCandidate.projectionDigest, gate.projectionDigest, "d771.gate.projectionDigest");
	literal(empiricalStrictJsonDigest(gateCandidate), empiricalStrictJsonDigest(gate), "d771.gate");
	const qualification = record(candidate.qualification, "d771.qualification");
	exactKeys(
		qualification,
		[
			"baselineD767ArtifactSha256",
			"baselineD768BundleArtifactSha256",
			"baselineD768BundleDigest",
			"baselineD768GraphEvidenceDigest",
			"causalAttribution",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"gateDefinitionDigest",
			"gateProjectionDigest",
			"gateProjectionRevision",
			"graphEvidenceDigest",
			"implementationManifestDigest",
			"loweringRevision",
			"loweringGraphEvidenceDigest",
			"materialFree",
			"providerNetworkCalls",
			"qualificationDigest",
			"retryGraphEvidenceDigest",
			"schemaVersion",
		],
		"d771.qualification",
	);
	literal(
		qualification.schemaVersion,
		D771_QUALIFICATION_SCHEMA,
		"d771.qualification.schemaVersion",
	);
	literal(qualification.decisionRef, "decision.D771", "d771.qualification.decisionRef");
	literal(qualification.decisionRevision, "2026-08-13.v1", "d771.qualification.decisionRevision");
	literal(
		qualification.baselineD768GraphEvidenceDigest,
		"sha256:3e898e0cb00d94dc0e030a6c8447e838440beac3b80cb8ea932d70ba828c5bd6",
		"d771.qualification.baselineD768GraphEvidenceDigest",
	);
	literal(
		qualification.baselineD767ArtifactSha256,
		"sha256:b770dba74ecf4940c322f5b34cccae5dec4c14155c79be65e50f89185507042c",
		"d771.qualification.baselineD767ArtifactSha256",
	);
	literal(
		qualification.baselineD768BundleArtifactSha256,
		"sha256:952eb36b889c7dac583bb8575b52943fd3dc43bd5d01401609e9364c793d66f8",
		"d771.qualification.baselineD768BundleArtifactSha256",
	);
	literal(
		qualification.baselineD768BundleDigest,
		"sha256:9b16bffe83d8b151de19b66d1838b19d99d5cc64121f10da422ca7e83119185b",
		"d771.qualification.baselineD768BundleDigest",
	);
	literal(
		qualification.implementationManifestDigest,
		D771_IMPLEMENTATION_MANIFEST_DIGEST,
		"d771.qualification.implementationManifestDigest",
	);
	literal(
		qualification.loweringRevision,
		D771_CRITERION_NAMED_TOOL_LOWERING_REVISION,
		"d771.qualification.loweringRevision",
	);
	literal(
		qualification.gateProjectionRevision,
		D771_ARM_AWARE_GATE_PROJECTION_REVISION,
		"d771.qualification.gateProjectionRevision",
	);
	literal(
		qualification.gateDefinitionDigest,
		D761_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
		"d771.qualification.gateDefinitionDigest",
	);
	literal(
		qualification.graphEvidenceDigest,
		graph.evidenceDigest,
		"d771.qualification.graphEvidenceDigest",
	);
	literal(
		qualification.retryGraphEvidenceDigest,
		retryGraph.evidenceDigest,
		"d771.qualification.retryGraphEvidenceDigest",
	);
	literal(
		qualification.loweringGraphEvidenceDigest,
		loweringGraph.evidenceDigest,
		"d771.qualification.loweringGraphEvidenceDigest",
	);
	literal(
		qualification.gateProjectionDigest,
		gate.projectionDigest,
		"d771.qualification.gateProjectionDigest",
	);
	literal(qualification.providerNetworkCalls, 0, "d771.qualification.providerNetworkCalls");
	literal(qualification.materialFree, true, "d771.qualification.materialFree");
	literal(qualification.causalAttribution, "undetermined", "d771.qualification.causalAttribution");
	literal(qualification.efficacyClaim, "none", "d771.qualification.efficacyClaim");
	const { qualificationDigest, ...qualificationMaterial } = qualification;
	digest(qualificationDigest, "d771.qualification.qualificationDigest");
	literal(
		qualificationDigest,
		empiricalStrictJsonDigest(qualificationMaterial),
		"d771.qualification.qualificationDigest",
	);
	const generation = record(candidate.generation, "d771.generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"gateProjectionDigest",
			"generationDigest",
			"generationRef",
			"graphEvidenceDigest",
			"implementationManifestDigest",
			"loweringGraphEvidenceDigest",
			"providerNetworkCalls",
			"qualificationDigest",
			"retryGraphEvidenceDigest",
			"schemaVersion",
		],
		"d771.generation",
	);
	literal(generation.schemaVersion, D771_GENERATION_SCHEMA, "d771.generation.schemaVersion");
	literal(generation.generationRef, D771_GENERATION_REF, "d771.generation.generationRef");
	literal(
		generation.qualificationDigest,
		qualificationDigest as string,
		"d771.generation.qualificationDigest",
	);
	literal(
		generation.implementationManifestDigest,
		D771_IMPLEMENTATION_MANIFEST_DIGEST,
		"d771.generation.implementationManifestDigest",
	);
	literal(
		generation.graphEvidenceDigest,
		graph.evidenceDigest,
		"d771.generation.graphEvidenceDigest",
	);
	literal(
		generation.retryGraphEvidenceDigest,
		retryGraph.evidenceDigest,
		"d771.generation.retryGraphEvidenceDigest",
	);
	literal(
		generation.loweringGraphEvidenceDigest,
		loweringGraph.evidenceDigest,
		"d771.generation.loweringGraphEvidenceDigest",
	);
	literal(
		generation.gateProjectionDigest,
		gate.projectionDigest,
		"d771.generation.gateProjectionDigest",
	);
	literal(generation.providerNetworkCalls, 0, "d771.generation.providerNetworkCalls");
	literal(generation.causalAttribution, "undetermined", "d771.generation.causalAttribution");
	literal(generation.efficacyClaim, "none", "d771.generation.efficacyClaim");
	const { generationDigest, ...generationMaterial } = generation;
	digest(generationDigest, "d771.generation.generationDigest");
	literal(
		generationDigest,
		empiricalStrictJsonDigest(generationMaterial),
		"d771.generation.generationDigest",
	);
	const { bundleDigest, ...material } = candidate;
	digest(bundleDigest, "d771.bundle.bundleDigest");
	literal(bundleDigest, empiricalStrictJsonDigest(material), "d771.bundle.bundleDigest");
	return strictSnapshot(candidate) as unknown as D771QualificationBundleV1;
}

export function createD771PersistenceFaultForTest(stage: "after-write" | "after-rename"): object {
	if (stage !== "after-write" && stage !== "after-rename")
		throw new TypeError("D771 persistence fault stage is invalid");
	const fault = Object.freeze({ revision: "graphrefly.b112.d771.persistence-fault.v1" });
	persistenceFaults.set(fault, stage);
	return fault;
}

async function assertDirectory(path: string, mode: number) {
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== mode)
		throw new TypeError("D771 private directory identity drifted");
}

type D771DirectoryIdentity = { readonly dev: number; readonly ino: number };

async function assertOwnedDirectory(path: string, identity: D771DirectoryIdentity, mode = 0o700) {
	const metadata = await lstat(path);
	if (
		!metadata.isDirectory() ||
		metadata.isSymbolicLink() ||
		(metadata.mode & 0o777) !== mode ||
		metadata.nlink < 1 ||
		metadata.dev !== identity.dev ||
		metadata.ino !== identity.ino ||
		(await realpath(path)) !== path
	)
		throw new TypeError("D771 owned directory identity drifted");
}

export async function persistD771QualificationBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D771QualificationBundleV1;
	readonly fault?: object;
}): Promise<D771PersistenceReceiptV1> {
	const input = record(inputValue, "d771.persistenceInput");
	exactKeys(
		input,
		["bundle", "privateRoot", ...(Object.hasOwn(input, "fault") ? ["fault" as const] : [])],
		"d771.persistenceInput",
	);
	const originalBundle = input.bundle as object;
	if (!bundles.has(originalBundle))
		throw new TypeError("D771 persistence requires a same-process constructed bundle");
	bundles.delete(originalBundle);
	const bundle = validateD771QualificationBundle(input.bundle);
	const root = await realpath(input.privateRoot as string);
	if (root !== resolve(input.privateRoot as string))
		throw new TypeError("D771 private root must be canonical");
	await assertDirectory(root, 0o700);
	let fault: "after-write" | "after-rename" | undefined;
	if (Object.hasOwn(input, "fault")) {
		fault = persistenceFaults.get(input.fault as object);
		if (fault === undefined) throw new TypeError("D771 persistence fault is forged or replayed");
		persistenceFaults.delete(input.fault as object);
	}
	const claim = join(root, `.CLAIM-${D771_GENERATION_REF}`);
	const staging = join(root, `.TMP-${D771_GENERATION_REF}-${randomUUID()}`);
	const final = join(root, D771_GENERATION_REF);
	const parentHandle = await open(
		root,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	let claimIdentity: D771DirectoryIdentity | null = null;
	let stagingIdentity: D771DirectoryIdentity | null = null;
	let finalIdentity: D771DirectoryIdentity | null = null;
	let renamed = false;
	try {
		const parentStatus = await parentHandle.stat();
		const parentIdentity = { dev: parentStatus.dev, ino: parentStatus.ino };
		await assertOwnedDirectory(root, parentIdentity);
		await mkdir(claim, { recursive: false, mode: 0o700 });
		const claimHandle = await open(
			claim,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			const status = await claimHandle.stat();
			claimIdentity = { dev: status.dev, ino: status.ino };
			await claimHandle.sync();
			await assertOwnedDirectory(claim, claimIdentity);
		} finally {
			await claimHandle.close();
		}
		await parentHandle.sync();
		await mkdir(staging, { recursive: false, mode: 0o700 });
		const stagingHandle = await open(
			staging,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			const status = await stagingHandle.stat();
			stagingIdentity = { dev: status.dev, ino: status.ino };
			await assertOwnedDirectory(staging, stagingIdentity);
		} finally {
			await stagingHandle.close();
		}
		const artifacts = join(staging, "artifacts");
		await mkdir(artifacts, { recursive: false, mode: 0o700 });
		const files = [
			["graph-evidence.v1.json", bundle.graphEvidence],
			["retry-graph-evidence.v1.json", bundle.retryGraphEvidence],
			["lowering-graph-evidence.v1.json", bundle.loweringGraphEvidence],
			["qualification.v1.json", bundle.qualification],
			["generation.v1.json", bundle.generation],
			["bundle.v1.json", bundle],
		] as const;
		for (const [name, value] of files) {
			const bytes = strictJsonCodec.encode(value);
			const handle = await open(
				join(artifacts, name),
				constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
				0o600,
			);
			try {
				await handle.writeFile(bytes);
				await handle.sync();
				const metadata = await handle.stat();
				if (!metadata.isFile() || metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600)
					throw new TypeError("D771 private artifact identity drifted");
			} finally {
				await handle.close();
			}
		}
		const artifactsHandle = await open(
			artifacts,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			await artifactsHandle.sync();
		} finally {
			await artifactsHandle.close();
		}
		if (fault === "after-write") throw new TypeError("D771 injected after-write failure");
		await assertOwnedDirectory(root, parentIdentity);
		await assertOwnedDirectory(claim, claimIdentity);
		await assertOwnedDirectory(staging, stagingIdentity);
		await rename(staging, final);
		renamed = true;
		finalIdentity = stagingIdentity;
		if (fault === "after-rename") throw new TypeError("D771 injected after-rename failure");
		const finalHandle = await open(
			final,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			await finalHandle.sync();
			await parentHandle.sync();
			const stable = await finalHandle.stat();
			if (stable.dev !== finalIdentity.dev || stable.ino !== finalIdentity.ino)
				throw new TypeError("D771 final handle identity drifted");
			await assertOwnedDirectory(final, finalIdentity);
			for (const [name, value] of files) {
				const bytes = strictJsonCodec.encode(value);
				const handle = await open(
					join(final, "artifacts", name),
					constants.O_RDONLY | constants.O_NOFOLLOW,
				);
				try {
					const metadata = await handle.stat();
					if (
						!metadata.isFile() ||
						metadata.nlink !== 1 ||
						(metadata.mode & 0o777) !== 0o600 ||
						!sameBytes(new Uint8Array(await handle.readFile()), bytes)
					)
						throw new TypeError("D771 final artifact readback drifted");
				} finally {
					await handle.close();
				}
			}
			await assertOwnedDirectory(final, finalIdentity);
			await assertOwnedDirectory(root, parentIdentity);
		} finally {
			await finalHandle.close();
		}
		await rmdir(claim);
		claimIdentity = null;
		await parentHandle.sync();
		const material = strictSnapshot({
			schemaVersion: D771_PERSISTENCE_SCHEMA,
			generationRef: D771_GENERATION_REF,
			bundleDigest: bundle.bundleDigest,
		});
		return Object.freeze({ ...material, persistenceDigest: empiricalStrictJsonDigest(material) });
	} catch (error) {
		const removeOwned = async (path: string, identity: D771DirectoryIdentity) => {
			await assertOwnedDirectory(path, identity);
			const tombstone = join(root, `.D771-TOMBSTONE-${randomUUID()}`);
			await rename(path, tombstone);
			const moved = await lstat(tombstone);
			if (moved.dev !== identity.dev || moved.ino !== identity.ino)
				throw new TypeError("D771 cleanup tombstone ownership drifted");
			await rm(tombstone, { recursive: true, force: true });
			await parentHandle.sync();
		};
		if (renamed && finalIdentity !== null) await removeOwned(final, finalIdentity);
		else if (stagingIdentity !== null) await removeOwned(staging, stagingIdentity);
		if (claimIdentity !== null) {
			await assertOwnedDirectory(claim, claimIdentity);
			await rmdir(claim);
			await parentHandle.sync();
		}
		throw error;
	} finally {
		await Promise.allSettled([parentHandle.close()]);
	}
}
