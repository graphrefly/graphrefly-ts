import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	createD722InjectedModelFixture,
	invokeD722InjectedModelFixture,
} from "../../evals/empirical-memory-rerun-avoidance/d722-injected-model-fixture.js";
import { invokeD725OpenRouterGraphTurn } from "../../evals/empirical-memory-rerun-avoidance/d725-terminal-http-real-provider.js";
import {
	createD726ProviderAdapter,
	createD726ProviderTurn,
	runD726InjectedNoNetworkQualification,
} from "../../evals/empirical-memory-rerun-avoidance/d726-graph-native-live.js";
import {
	acquireD726SingleUseDispatchClaimAtRoot,
	consumeD726DispatchClaimForExecution,
	consumeD726ExecutionAuthority,
} from "../../evals/empirical-memory-rerun-avoidance/d726-single-use-dispatch-claim.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "../../evals/empirical-memory-rerun-avoidance/openrouter-current-key-spend-admission.js";

const sha = (label: string) => empiricalStrictJsonDigest({ label });

async function currentKeyAdmission() {
	return createOpenRouterCurrentKeySpendAdmissionCapability({
		async fetch() {
			return new Response(
				JSON.stringify({
					data: {
						limit: 32,
						limit_remaining: 20,
						usage: 12,
						limit_reset: null,
						is_management_key: false,
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		},
	}).read({
		credential: {
			bearerToken: "not-a-live-D726-test-credential",
			credentialBindingRef: "d726.test",
			credentialBindingRevision: "v1",
		},
		expectedLimitMicrousd: 32_000_000,
		requiredRemainingMicrousd: 6_000_000,
		signal: new AbortController().signal,
	});
}

describe("D726 Graph-native terminal HTTP live replacement", () => {
	it("makes its durable claim and execution authority single-use", async () => {
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d726-claim-"));
		await chmod(root, 0o700);
		const canonicalRoot = await realpath(root);
		try {
			const claim = await acquireD726SingleUseDispatchClaimAtRoot(canonicalRoot, {
				pricingReadDigest: sha("pricing"),
				zeroByokObservationDigest: sha("zero-byok"),
			});
			const authority = await consumeD726DispatchClaimForExecution({
				claim,
				currentKeyAdmission: await currentKeyAdmission(),
			});
			expect(consumeD726ExecutionAuthority(authority).claim.claimDigest).toBe(claim.claimDigest);
			expect(() => consumeD726ExecutionAuthority(authority)).toThrow(/single-use/);
			await expect(
				acquireD726SingleUseDispatchClaimAtRoot(canonicalRoot, {
					pricingReadDigest: sha("pricing"),
					zeroByokObservationDigest: sha("zero-byok"),
				}),
			).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("runs all six arms serially and derives the live bundle from Graph evidence", async () => {
		let transportCalls = 0;
		{
			const workspaceByRun = new Map<number, string>();
			const model = createD722InjectedModelFixture();
			const adapter = createD726ProviderAdapter({
				executionClass: "injected-no-network",
				async materialization({ effectRequest }) {
					const workspace = sha(`workspace-${effectRequest.runSequence}`);
					workspaceByRun.set(effectRequest.runSequence, workspace);
					return {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "materialization",
							status: "ready",
							workspaceStateDigest: workspace,
							evidenceDigest: sha(`materialization-${effectRequest.runSequence}`),
						},
					};
				},
				async providerRequest(input) {
					const scripted = await invokeD722InjectedModelFixture(model, input.effectRequest);
					const toolNames = {
						"read-file": "read_file",
						"search-repository": "search_repository",
						"replace-exact": "replace_exact",
						"workspace-diff": "workspace_diff",
						"focused-validation": "focused_validation",
					} as const;
					return createD726ProviderTurn(
						await invokeD725OpenRouterGraphTurn({
							effectRequest: input.effectRequest,
							credential: {
								bearerToken: "not-a-live-D726-test-credential",
								credentialBindingRef: "d726.test",
								credentialBindingRevision: "v1",
							},
							transport: {
								async request() {
									transportCalls += 1;
									const toolCalls = scripted.toolIntents.map((intent, index) => ({
										id: `d726-tool-${transportCalls}-${index}`,
										type: "function",
										function: { name: toolNames[intent.toolRef], arguments: "{}" },
									}));
									return {
										status: 200,
										body: new TextEncoder().encode(
											JSON.stringify({
												id: `d726-response-${transportCalls}`,
												usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.000001 },
												choices: [
													toolCalls.length > 0
														? {
																finish_reason: "tool_calls",
																message: { content: null, tool_calls: toolCalls },
															}
														: { finish_reason: "stop", message: { content: "done" } },
												],
												openrouter_metadata: {
													endpoints: {
														available: [
															{
																provider: "DeepInfra",
																model: "deepseek/deepseek-v4-flash-20260423",
																selected: true,
															},
														],
													},
												},
											}),
										),
										retryAfterMs: null,
										retryAfterDisposition: "absent",
									};
								},
							},
							taskStatement: "D726 injected six-arm qualification",
							conversation: { messages: [] },
							signal: input.signal ?? new AbortController().signal,
							monotonicNowMs: () => transportCalls,
						}),
					);
				},
				async retryWait() {
					throw new TypeError("D726 terminal test cannot retry");
				},
				async toolAction({ effectRequest }) {
					const intent = effectRequest.toolIntent!;
					const before = workspaceByRun.get(effectRequest.runSequence)!;
					const after =
						intent.toolRef === "replace-exact" ? sha(`${before}:${intent.intentDigest}`) : before;
					workspaceByRun.set(effectRequest.runSequence, after);
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
							evidenceDigest: sha(`tool-${effectRequest.effectSequence}`),
						},
					};
				},
				async hiddenVerifier({ effectRequest }) {
					return {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "hidden-verifier",
							status: "passed",
							workspaceStateDigest: workspaceByRun.get(effectRequest.runSequence)!,
							evidenceDigest: sha(`verifier-${effectRequest.runSequence}`),
						},
					};
				},
				async cleanup({ effectRequest }) {
					workspaceByRun.delete(effectRequest.runSequence);
					return {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "cleanup",
							status: "succeeded",
							evidenceDigest: sha(`cleanup-${effectRequest.runSequence}`),
						},
					};
				},
			});
			const bundle = await runD726InjectedNoNetworkQualification({
				sourceDigest: sha("source"),
				adapter,
				signal: new AbortController().signal,
			});
			expect(bundle.graphEvidence.ledger.completedArms).toHaveLength(6);
			expect(bundle.terminalHttpGraphEvidence.facts).toEqual([]);
			expect(transportCalls).toBeGreaterThanOrEqual(6);
			expect(workspaceByRun.size).toBe(0);
		}
	});

	it("keeps later arms admitted after an arm-local terminal HTTP failure", async () => {
		let transportCalls = 0;
		const workspaces = new Set<number>();
		const adapter = createD726ProviderAdapter({
			executionClass: "injected-no-network",
			async materialization({ effectRequest }) {
				workspaces.add(effectRequest.runSequence);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "materialization",
						status: "ready",
						workspaceStateDigest: sha(`terminal-workspace-${effectRequest.runSequence}`),
						evidenceDigest: sha(`terminal-materialization-${effectRequest.runSequence}`),
					},
				};
			},
			async providerRequest({ effectRequest, signal }) {
				return createD726ProviderTurn(
					await invokeD725OpenRouterGraphTurn({
						effectRequest,
						credential: {
							bearerToken: "not-a-live-D726-test-credential",
							credentialBindingRef: "d726.test",
							credentialBindingRevision: "v1",
						},
						transport: {
							async request() {
								transportCalls += 1;
								return {
									status: 400,
									body: new TextEncoder().encode(
										JSON.stringify({ error: { code: "invalid_request" } }),
									),
									retryAfterMs: null,
									retryAfterDisposition: "absent",
								};
							},
						},
						taskStatement: "D726 injected terminal arm-local qualification",
						conversation: { messages: [] },
						signal: signal ?? new AbortController().signal,
						monotonicNowMs: () => transportCalls,
					}),
				);
			},
			async retryWait() {
				throw new TypeError("D726 terminal HTTP must not retry");
			},
			async toolAction() {
				throw new TypeError("D726 terminal HTTP must not execute a tool");
			},
			async hiddenVerifier() {
				throw new TypeError("D726 terminal HTTP must not invoke the verifier");
			},
			async cleanup({ effectRequest }) {
				workspaces.delete(effectRequest.runSequence);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "cleanup",
						status: "succeeded",
						evidenceDigest: sha(`terminal-cleanup-${effectRequest.runSequence}`),
					},
				};
			},
		});
		const result = await runD726InjectedNoNetworkQualification({
			sourceDigest: sha("terminal-source"),
			adapter,
			signal: new AbortController().signal,
		});
		expect(result.terminalHttpGraphEvidence.facts).toHaveLength(6);
		expect(transportCalls).toBe(6);
		expect(result.graphEvidence.ledger.decisions).toHaveLength(6);
		expect(
			result.graphEvidence.ledger.decisions.every(
				(decision) => decision.disposition === "admit-next",
			),
		).toBe(true);
		expect(workspaces.size).toBe(0);
	});
});
