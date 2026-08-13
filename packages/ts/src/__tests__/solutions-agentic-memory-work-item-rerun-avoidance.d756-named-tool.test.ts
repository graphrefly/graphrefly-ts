import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	createD748GraphForwardPhaseContinuationPolicy,
	createD759GraphHiddenVerifierCorrectionPolicy,
	D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA,
} from "../../evals/empirical-memory-rerun-avoidance/d722-graph-native-effect-runtime.js";
import { D733_DEEPSEEK_V4_FLASH_0731_PROFILE } from "../../evals/empirical-memory-rerun-avoidance/d733-coordinates.js";
import {
	createD733GraphNativeRouteAdmission,
	createD733RouteAccessProjection,
	createD733RouteEligibility,
} from "../../evals/empirical-memory-rerun-avoidance/d733-graph-native-route-profile.js";
import { runD734RouteProfileSixArmLiveIntegration } from "../../evals/empirical-memory-rerun-avoidance/d734-route-profile-provider-integration.js";
import {
	createD756GraphNamedToolTransport,
	createD756RouteBoundProviderAdapter,
	deriveD756GraphToolDirective,
} from "../../evals/empirical-memory-rerun-avoidance/d756-graph-named-tool-continuation.js";
import { measureD756Implementation } from "../../evals/empirical-memory-rerun-avoidance/d756-implementation-manifest.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sha = (value: unknown) => empiricalStrictJsonDigest(value);

function routeAdmission() {
	const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
	return createD733GraphNativeRouteAdmission({
		profile,
		access: createD733RouteAccessProjection({
			profile,
			observationRevision: "d756.injected-access.v1",
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

describe("D756 Graph named-tool lowering", () => {
	it("binds the exact implementation and Graph baseline before qualification", async () => {
		expect(await measureD756Implementation()).toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	it("rejects disposition drift, accessors, and transport replay without raw material evidence", async () => {
		const contextMaterial = {
			schemaVersion: "graphrefly.b112.d748.forward-phase-completion-context.v1" as const,
			reason: "objective-phase-advanced" as const,
			runSequence: 0,
			issuedRequestDigest: sha("issued"),
			rejectedRequestDigest: sha("rejected"),
			workspaceStateDigest: sha("workspace"),
			nextRequiredPhase: "workspace-diff" as const,
			missingObjectivePhases: ["workspace-diff", "focused-validation"] as const,
			evidenceFreshnessRefs: [sha("result"), sha("fact")] as const,
			requiredDisposition: "tool-intents" as const,
			remainingEffectFacts: 10,
			remainingCompletionContexts: 2,
			remainingAdmittedBounds: {
				requests: 10,
				retryWaits: 1,
				costMicrousd: 100,
				elapsedMs: 100,
			},
			budgetProjectionDigest: sha("budget"),
		};
		const context = {
			...contextMaterial,
			contextDigest: sha(contextMaterial),
		};
		const effectRequest = {
			kind: "graph-effect-request" as const,
			runSequence: 0,
			issuedRequestDigest: sha("issued-request"),
			effectSequence: 1,
			effectKind: "provider-request" as const,
			logicalRequestDigest: sha("logical-request"),
			attemptOrdinal: 1,
			retryReason: "none" as const,
			retryAfterMs: null,
			toolIntent: null,
			phaseBefore: "exact-mutation" as const,
			workspaceStateDigest: context.workspaceStateDigest,
			completionContext: context,
			requestDigest: sha("request"),
		};
		const directive = deriveD756GraphToolDirective(effectRequest);
		expect(directive).toMatchObject({
			nextRequiredPhase: "workspace-diff",
			requiredToolRef: "workspace-diff",
		});
		expect(Object.keys(directive ?? {}).sort()).toEqual([
			"contextDigest",
			"directiveDigest",
			"nextRequiredPhase",
			"requiredDisposition",
			"requiredToolRef",
			"revision",
		]);
		const { contextDigest: _contextDigest, ...contextWithoutDigest } = context;
		const mismatchedMaterial = {
			...contextWithoutDigest,
			nextRequiredPhase: "hidden-verifier" as const,
		};
		expect(() =>
			deriveD756GraphToolDirective({
				...effectRequest,
				completionContext: {
					...mismatchedMaterial,
					contextDigest: sha(mismatchedMaterial),
				},
			}),
		).toThrow(/disposition/);
		let getterHits = 0;
		expect(() =>
			deriveD756GraphToolDirective({
				...effectRequest,
				get completionContext() {
					getterHits += 1;
					return context;
				},
			}),
		).toThrow(/own data/);
		expect(getterHits).toBe(0);

		let underlyingCalls = 0;
		const wireBodies: Uint8Array[] = [];
		const transport = createD756GraphNamedToolTransport({
			effectRequest,
			transport: {
				async request(input) {
					underlyingCalls += 1;
					wireBodies.push(input.body.slice());
					return { status: 200, retryAfterMs: null, body: encoder.encode("{}") };
				},
			},
		});
		const request = {
			endpoint: "https://example.invalid",
			method: "POST" as const,
			authorizationBearer: "not-a-live-credential",
			contentType: "application/json",
			xOpenRouterMetadata: "enabled" as const,
			body: encoder.encode(
				JSON.stringify({
					model: "model",
					provider: {},
					messages: [],
					tools: [
						{
							type: "function",
							function: { name: "workspace_diff", parameters: {} },
						},
					],
					tool_choice: "required",
					reasoning: { effort: "high" },
					stream: false,
				}),
			),
			maxResponseBytes: 1024,
			signal: new AbortController().signal,
		};
		await transport.request(request);
		await expect(transport.request(request)).rejects.toThrow(/more than once/);
		expect(underlyingCalls).toBe(1);
		const retryTransport = createD756GraphNamedToolTransport({
			effectRequest: { ...effectRequest, attemptOrdinal: 2, retryReason: "d671-rate-limit" },
			transport: {
				async request(input) {
					wireBodies.push(input.body.slice());
					return { status: 200, retryAfterMs: null, body: encoder.encode("{}") };
				},
			},
		});
		await retryTransport.request(request);
		expect(wireBodies).toHaveLength(2);
		expect(wireBodies[1]).toEqual(wireBodies[0]);
	});

	it("runs all six arms from Graph phase directives through the real route-bound adapter seam", async () => {
		const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
		const admission = routeAdmission();
		const workspaceByRun = new Map<number, string>();
		const toolChoices: unknown[] = [];
		let providerCalls = 0;
		let active = 0;
		let maxActive = 0;
		const enter = () => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			if (active !== 1) throw new TypeError("D756 injected executor observed parallel effects");
		};
		const leave = () => {
			active -= 1;
		};
		const adapter = createD756RouteBoundProviderAdapter({
			routeAdmission: admission,
			executionClass: "live-provider",
			async materialization(input) {
				enter();
				try {
					const workspace = sha({ d756Workspace: input.effectRequest.runSequence, revision: 0 });
					workspaceByRun.set(input.effectRequest.runSequence, workspace);
					return {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "materialization",
							status: "ready",
							workspaceStateDigest: workspace,
							evidenceDigest: sha({ materialized: input.effectRequest.runSequence }),
						},
					};
				} finally {
					leave();
				}
			},
			async providerRequestInput(input) {
				return {
					credential: {
						bearerToken: "not-a-live-d756-test-credential",
						credentialBindingRef: "d756.injected",
						credentialBindingRevision: "v1",
					},
					transport: {
						async request(request: { body: Uint8Array }) {
							enter();
							try {
								providerCalls += 1;
								const body = JSON.parse(decoder.decode(request.body)) as {
									tool_choice: "auto" | "none" | { type: "function"; function: { name: string } };
								};
								toolChoices.push(body.tool_choice);
								const name =
									body.tool_choice === "auto"
										? "read_file"
										: body.tool_choice === "none"
											? null
											: body.tool_choice.function.name;
								const toolCalls =
									name === null
										? []
										: [
												{
													id: `d756-${providerCalls}`,
													type: "function",
													function: {
														name,
														arguments:
															name === "read_file"
																? JSON.stringify({ path: "fixture.ts" })
																: name === "replace_exact"
																	? JSON.stringify({
																			path: "fixture.ts",
																			oldText: "before",
																			newText: "after",
																		})
																	: "{}",
													},
												},
											];
								return {
									status: 200,
									retryAfterMs: null,
									body: encoder.encode(
										JSON.stringify({
											id: `d756-response-${providerCalls}`,
											usage: { prompt_tokens: 1, completion_tokens: 1 },
											choices: [
												name === null
													? { finish_reason: "stop", message: { content: "{}" } }
													: {
															finish_reason: "tool_calls",
															message: { content: null, tool_calls: toolCalls },
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
							} finally {
								leave();
							}
						},
					},
					taskStatement: "D756 injected Graph named-tool repair",
					conversation: { messages: [] },
					signal: input.signal ?? new AbortController().signal,
					monotonicNowMs: () => providerCalls,
					routeAdmission: admission,
				};
			},
			async retryWait() {
				throw new TypeError("D756 injected success path cannot retry");
			},
			async toolAction(input) {
				enter();
				try {
					const before = workspaceByRun.get(input.effectRequest.runSequence);
					if (before === undefined || input.effectRequest.toolIntent === null)
						throw new TypeError("D756 injected tool state is missing");
					const after =
						input.effectRequest.toolIntent.toolRef === "replace-exact"
							? sha({ before, mutation: input.effectRequest.toolIntent.intentDigest })
							: before;
					workspaceByRun.set(input.effectRequest.runSequence, after);
					return {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "tool-action",
							toolRef: input.effectRequest.toolIntent.toolRef,
							intentDigest: input.effectRequest.toolIntent.intentDigest,
							status: "succeeded",
							nonEmptyDiff: input.effectRequest.toolIntent.toolRef === "workspace-diff",
							workspaceStateBeforeDigest: before,
							workspaceStateAfterDigest: after,
							evidenceDigest: sha({ tool: input.effectRequest.toolIntent.intentDigest }),
						},
					};
				} finally {
					leave();
				}
			},
			async hiddenVerifier(input) {
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "hidden-verifier",
						status: "passed",
						workspaceStateDigest: input.effectRequest.workspaceStateDigest!,
						evidenceDigest: sha({ verifier: input.effectRequest.runSequence }),
					},
				};
			},
			async cleanup(input) {
				workspaceByRun.delete(input.effectRequest.runSequence);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "cleanup",
						status: "succeeded",
						evidenceDigest: sha({ cleanup: input.effectRequest.runSequence }),
					},
				};
			},
		});
		const result = await runD734RouteProfileSixArmLiveIntegration({
			sourceDigest: sha({ d756: "full-six-arm" }),
			adapter,
			objectivePhaseRecoveryPolicy: createD748GraphForwardPhaseContinuationPolicy(),
			signal: AbortSignal.timeout(30_000),
		});
		expect(result.run.graphEvidence.runStatus).toBe("complete");
		expect(result.run.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(result.run.graphEvidence.effectRuns).toHaveLength(6);
		expect(result.run.graphEvidence.completionContexts).toHaveLength(24);
		expect(providerCalls).toBe(30);
		expect(maxActive).toBe(1);
		expect(workspaceByRun.size).toBe(0);
		expect(
			toolChoices.filter(
				(choice) =>
					typeof choice === "object" &&
					choice !== null &&
					JSON.stringify(choice).includes("workspace_diff"),
			),
		).toHaveLength(6);
		expect(toolChoices.filter((choice) => choice === "none")).toHaveLength(6);
	}, 30_000);

	it("corrects one hidden-verifier failure per arm with exact named mutation and retry identity", async () => {
		const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
		const admission = routeAdmission();
		const workspaceByRun = new Map<number, string>();
		const verifierAttemptsByRun = new Map<number, number>();
		const wireByLogicalRequest = new Map<string, Uint8Array>();
		const toolChoices: unknown[] = [];
		let providerCalls = 0;
		let retryWaits = 0;
		let correctionRetryInjected = false;
		let active = 0;
		let maxActive = 0;
		const enter = () => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			if (active !== 1) throw new TypeError("D759 injected executor observed parallel effects");
		};
		const leave = () => {
			active -= 1;
		};
		const adapter = createD756RouteBoundProviderAdapter({
			routeAdmission: admission,
			executionClass: "live-provider",
			async materialization(input) {
				enter();
				try {
					const workspace = sha({ d759Workspace: input.effectRequest.runSequence, revision: 0 });
					workspaceByRun.set(input.effectRequest.runSequence, workspace);
					return {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "materialization",
							status: "ready",
							workspaceStateDigest: workspace,
							evidenceDigest: sha({ d759Materialized: input.effectRequest.runSequence }),
						},
					};
				} finally {
					leave();
				}
			},
			async providerRequestInput(input) {
				return {
					credential: {
						bearerToken: "not-a-live-d759-test-credential",
						credentialBindingRef: "d759.injected",
						credentialBindingRevision: "v1",
					},
					transport: {
						async request(request: { body: Uint8Array }) {
							enter();
							try {
								providerCalls += 1;
								const bytes = request.body.slice();
								const logical = input.effectRequest.logicalRequestDigest;
								const prior = wireByLogicalRequest.get(logical);
								if (prior === undefined) wireByLogicalRequest.set(logical, bytes);
								else expect(bytes).toEqual(prior);
								const body = JSON.parse(decoder.decode(bytes)) as {
									tool_choice: "auto" | "none" | { type: "function"; function: { name: string } };
								};
								toolChoices.push(body.tool_choice);
								if (
									!correctionRetryInjected &&
									input.effectRequest.completionContext?.schemaVersion ===
										D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA
								) {
									correctionRetryInjected = true;
									return {
										status: 429,
										retryAfterMs: null,
										retryAfterDisposition: "absent" as const,
										body: encoder.encode('{"error":{"message":"bounded retry"}}'),
									};
								}
								const name =
									body.tool_choice === "auto"
										? "read_file"
										: body.tool_choice === "none"
											? null
											: body.tool_choice.function.name;
								const args =
									name === "read_file"
										? { path: "fixture.ts" }
										: name === "replace_exact"
											? { path: "fixture.ts", oldText: "before", newText: "after" }
											: {};
								const toolCalls =
									name === null
										? []
										: [
												{
													id: `d759-${providerCalls}`,
													type: "function",
													function: { name, arguments: JSON.stringify(args) },
												},
											];
								return {
									status: 200,
									retryAfterMs: null,
									body: encoder.encode(
										JSON.stringify({
											id: `d759-response-${providerCalls}`,
											usage: { prompt_tokens: 1, completion_tokens: 1 },
											choices: [
												name === null
													? { finish_reason: "stop", message: { content: "{}" } }
													: {
															finish_reason: "tool_calls",
															message: { content: null, tool_calls: toolCalls },
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
							} finally {
								leave();
							}
						},
					},
					taskStatement: "D759 injected hidden-verifier correction",
					conversation: { messages: [] },
					signal: input.signal ?? new AbortController().signal,
					monotonicNowMs: () => providerCalls,
					routeAdmission: admission,
				};
			},
			async retryWait(input) {
				enter();
				try {
					retryWaits += 1;
					return {
						actualCostMicrousd: 0,
						actualElapsedMs: input.effectRequest.retryAfterMs ?? 60_000,
						result: {
							effectKind: "retry-wait",
							status: "completed",
							evidenceDigest: sha({ d759Retry: input.effectRequest.logicalRequestDigest }),
						},
					};
				} finally {
					leave();
				}
			},
			async toolAction(input) {
				enter();
				try {
					const before = workspaceByRun.get(input.effectRequest.runSequence);
					const intent = input.effectRequest.toolIntent;
					if (before === undefined || intent === null)
						throw new TypeError("D759 injected tool state is missing");
					const after =
						intent.toolRef === "replace-exact"
							? sha({ before, mutation: intent.intentDigest })
							: before;
					workspaceByRun.set(input.effectRequest.runSequence, after);
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
							evidenceDigest: sha({ d759Tool: intent.intentDigest }),
						},
					};
				} finally {
					leave();
				}
			},
			async hiddenVerifier(input) {
				enter();
				try {
					const attempts = (verifierAttemptsByRun.get(input.effectRequest.runSequence) ?? 0) + 1;
					verifierAttemptsByRun.set(input.effectRequest.runSequence, attempts);
					return {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "hidden-verifier",
							status: attempts === 1 ? ("failed" as const) : ("passed" as const),
							workspaceStateDigest: input.effectRequest.workspaceStateDigest!,
							evidenceDigest: sha({ d759Verifier: input.effectRequest.runSequence, attempts }),
						},
					};
				} finally {
					leave();
				}
			},
			async cleanup(input) {
				enter();
				try {
					workspaceByRun.delete(input.effectRequest.runSequence);
					return {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "cleanup",
							status: "succeeded",
							evidenceDigest: sha({ d759Cleanup: input.effectRequest.runSequence }),
						},
					};
				} finally {
					leave();
				}
			},
		});
		const result = await runD734RouteProfileSixArmLiveIntegration({
			sourceDigest: sha({ d759: "full-six-arm-correction" }),
			adapter,
			objectivePhaseRecoveryPolicy: createD759GraphHiddenVerifierCorrectionPolicy(),
			signal: AbortSignal.timeout(30_000),
		});
		expect(result.run.graphEvidence.runStatus).toBe("complete");
		expect(result.run.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(result.run.graphEvidence.effectRuns).toHaveLength(6);
		expect(result.run.graphEvidence.completionContexts).toHaveLength(48);
		expect(result.run.usage.requests).toBe(55);
		expect(providerCalls).toBe(55);
		expect(retryWaits).toBe(1);
		expect(maxActive).toBe(1);
		expect(workspaceByRun.size).toBe(0);
		for (const run of result.run.graphEvidence.effectRuns) {
			const correctionContexts = result.run.graphEvidence.completionContexts.filter(
				(context) =>
					context.runSequence === run.runSequence && context.reason === "hidden-verifier-failed",
			);
			expect(correctionContexts).toHaveLength(1);
			expect(correctionContexts[0]).toMatchObject({
				schemaVersion: D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA,
				nextRequiredPhase: "exact-mutation",
				requiredDisposition: "tool-intents",
			});
			expect(
				run.facts
					.filter((fact) => fact.result.effectKind === "hidden-verifier")
					.map((fact) => fact.result.status),
			).toEqual(["failed", "passed"]);
		}
		expect(
			toolChoices.filter(
				(choice) =>
					typeof choice === "object" &&
					choice !== null &&
					JSON.stringify(choice).includes("replace_exact"),
			),
		).toHaveLength(13);
	}, 30_000);
});
