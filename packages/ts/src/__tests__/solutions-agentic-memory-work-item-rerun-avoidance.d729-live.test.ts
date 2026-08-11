import { chmod, lstat, mkdtemp, realpath, rm } from "node:fs/promises";
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
	createD729PersistenceFaultForTest,
	persistD729LiveBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d729-atomic-persistence.js";
import {
	D729_CACHE_READ_MICROUSD_PER_MILLION_TOKENS,
	D729_GENERATION_REF,
	D729_INPUT_MICROUSD_PER_MILLION_TOKENS,
	D729_MODEL_SLUG,
	D729_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	D729_PRICING_SOURCE,
	D729_PROVIDER_TAG,
	D729_SELECTED_ENDPOINT_MODEL,
} from "../../evals/empirical-memory-rerun-avoidance/d729-coordinates.js";
import {
	runD729InjectedNoNetworkQualification,
	validateD729LiveBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d729-graph-native-live.js";
import {
	createD726ProviderAdapter,
	createD726ProviderTurn,
	createD729SanitizedExecutorFailureProviderTurn,
} from "../../evals/empirical-memory-rerun-avoidance/d729-provider-block-core.js";
import {
	acquireD729SingleUseDispatchClaimAtRoot,
	consumeD729DispatchClaimForExecution,
	consumeD729ExecutionAuthority,
} from "../../evals/empirical-memory-rerun-avoidance/d729-single-use-dispatch-claim.js";
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
			bearerToken: "not-a-live-d729-test-credential",
			credentialBindingRef: "d729.test",
			credentialBindingRevision: "v1",
		},
		expectedLimitMicrousd: 32_000_000,
		requiredRemainingMicrousd: 6_000_000,
		signal: new AbortController().signal,
	});
}

function successfulAdapter() {
	const workspaces = new Map<number, string>();
	const model = createD722InjectedModelFixture();
	let calls = 0;
	const adapter = createD726ProviderAdapter({
		executionClass: "injected-no-network",
		async materialization({ effectRequest }) {
			const workspace = sha(`d729-workspace-${effectRequest.runSequence}`);
			workspaces.set(effectRequest.runSequence, workspace);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "materialization",
					status: "ready",
					workspaceStateDigest: workspace,
					evidenceDigest: sha(`d729-materialization-${effectRequest.runSequence}`),
				},
			};
		},
		async providerRequest(input) {
			const scripted = await invokeD722InjectedModelFixture(model, input.effectRequest);
			const names = {
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
						bearerToken: "not-a-live-d729-test-credential",
						credentialBindingRef: "d729.test",
						credentialBindingRevision: "v1",
					},
					transport: {
						async request(request) {
							calls += 1;
							const body = JSON.parse(new TextDecoder().decode(request.body));
							expect(body.model).toBe("deepseek/deepseek-v4-flash");
							expect(body.provider).toEqual({
								order: ["deepinfra/fp4"],
								only: ["deepinfra/fp4"],
								allow_fallbacks: false,
								require_parameters: true,
							});
							const toolCalls = scripted.toolIntents.map((intent, index) => ({
								id: `d729-tool-${calls}-${index}`,
								type: "function",
								function: { name: names[intent.toolRef], arguments: "{}" },
							}));
							return {
								status: 200,
								body: new TextEncoder().encode(
									JSON.stringify({
										id: `d729-response-${calls}`,
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
								retryAfterDisposition: "absent" as const,
							};
						},
					},
					taskStatement: "D729 injected six-arm qualification",
					conversation: { messages: [] },
					signal: input.signal ?? new AbortController().signal,
					monotonicNowMs: () => calls,
				}),
			);
		},
		async retryWait() {
			throw new TypeError("D729 happy path cannot retry");
		},
		async toolAction({ effectRequest }) {
			const intent = effectRequest.toolIntent!;
			const before = workspaces.get(effectRequest.runSequence)!;
			const after =
				intent.toolRef === "replace-exact" ? sha(`${before}:${intent.intentDigest}`) : before;
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
					evidenceDigest: sha(`d729-tool-${effectRequest.effectSequence}`),
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
					workspaceStateDigest: workspaces.get(effectRequest.runSequence)!,
					evidenceDigest: sha(`d729-verifier-${effectRequest.runSequence}`),
				},
			};
		},
		async cleanup({ effectRequest }) {
			workspaces.delete(effectRequest.runSequence);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup",
					status: "succeeded",
					evidenceDigest: sha(`d729-cleanup-${effectRequest.runSequence}`),
				},
			};
		},
	});
	return { adapter, calls: () => calls, workspaces };
}

function executorFailureAdapter() {
	const workspaces = new Set<number>();
	let calls = 0;
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
					workspaceStateDigest: sha(`d729-failure-workspace-${effectRequest.runSequence}`),
					evidenceDigest: sha(`d729-failure-materialization-${effectRequest.runSequence}`),
				},
			};
		},
		async providerRequest({ effectRequest }) {
			calls += 1;
			return createD729SanitizedExecutorFailureProviderTurn(
				new TypeError("D723 provider returned an invalid choice count"),
				effectRequest.requestDigest,
			);
		},
		async retryWait() {
			throw new TypeError("D729 executor failure cannot retry");
		},
		async toolAction() {
			throw new TypeError("D729 executor failure cannot use tools");
		},
		async hiddenVerifier() {
			throw new TypeError("D729 executor failure cannot verify");
		},
		async cleanup({ effectRequest }) {
			workspaces.delete(effectRequest.runSequence);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup",
					status: "succeeded",
					evidenceDigest: sha(`d729-failure-cleanup-${effectRequest.runSequence}`),
				},
			};
		},
	});
	return { adapter, calls: () => calls, workspaces };
}

describe("D729 failure-safe Graph-native live replacement", () => {
	it("freezes the current OpenRouter alias, exact DeepInfra endpoint and current prices", () => {
		expect(D729_MODEL_SLUG).toBe("deepseek/deepseek-v4-flash");
		expect(D729_SELECTED_ENDPOINT_MODEL).toBe("deepseek/deepseek-v4-flash-20260423");
		expect(D729_PROVIDER_TAG).toBe("deepinfra/fp4");
		expect(D729_PRICING_SOURCE).toBe(
			"https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash/endpoints",
		);
		expect(D729_INPUT_MICROUSD_PER_MILLION_TOKENS).toBe(90_000);
		expect(D729_OUTPUT_MICROUSD_PER_MILLION_TOKENS).toBe(180_000);
		expect(D729_CACHE_READ_MICROUSD_PER_MILLION_TOKENS).toBe(18_000);
	});

	it("keeps the durable dispatch authority fixed-root and single-use", async () => {
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d729-claim-"));
		await chmod(root, 0o700);
		try {
			const claim = await acquireD729SingleUseDispatchClaimAtRoot(await realpath(root), {
				d729PreLiveBundleDigest: sha("prelive"),
				pricingReadDigest: sha("pricing"),
				zeroByokObservationDigest: sha("zero-byok"),
			});
			const authority = await consumeD729DispatchClaimForExecution({
				claim,
				currentKeyAdmission: await currentKeyAdmission(),
			});
			expect(consumeD729ExecutionAuthority(authority).scope).toBe("injected-test-root");
			expect(() => consumeD729ExecutionAuthority(authority)).toThrow(/single-use/);
			await expect(
				acquireD729SingleUseDispatchClaimAtRoot(await realpath(root), {
					d729PreLiveBundleDigest: sha("prelive"),
					pricingReadDigest: sha("pricing"),
					zeroByokObservationDigest: sha("zero-byok"),
				}),
			).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("qualifies a complete six-arm success from canonical Graph facts", async () => {
		const fixture = successfulAdapter();
		const bundle = await runD729InjectedNoNetworkQualification({
			adapter: fixture.adapter,
			providerTransportCalls: fixture.calls,
			signal: new AbortController().signal,
		});
		expect(bundle.disposition).toBe("success");
		expect(bundle.graphEvidence.runStatus).toBe("complete");
		expect(bundle.terminalHttpGraphEvidence.facts).toEqual([]);
		expect(
			bundle.graphEvidence.ledger.findings.some(
				(finding) => finding.code === "full-task-completed",
			),
		).toBe(true);
		expect(bundle.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(bundle.executorFailureFacts).toEqual([]);
		expect(fixture.workspaces.size).toBe(0);
		expect(validateD729LiveBundle(bundle).bundleDigest).toBe(bundle.bundleDigest);
	});

	it("persists executor provenance only as partial failure while still cleaning all arms", async () => {
		const fixture = executorFailureAdapter();
		const bundle = await runD729InjectedNoNetworkQualification({
			adapter: fixture.adapter,
			providerTransportCalls: fixture.calls,
			signal: new AbortController().signal,
		});
		expect(bundle.disposition).toBe("partial-failure");
		expect(bundle.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(bundle.terminalHttpGraphEvidence.facts).toEqual([]);
		expect(bundle.executorFailureFacts).toHaveLength(6);
		expect(bundle.executorFailureFacts.map((fact) => fact.classification)).toEqual([
			...Array(5).fill("response-decode-failure"),
			"graph-admission-denied",
		]);
		expect(fixture.workspaces.size).toBe(0);
		expect(bundle.generation.schemaVersion).toBe(
			"graphrefly.b112.d729.partial-graph-failure-generation.v1",
		);
	});

	it("rejects coordinated outer-digest tampering", async () => {
		const fixture = executorFailureAdapter();
		const bundle = await runD729InjectedNoNetworkQualification({
			adapter: fixture.adapter,
			providerTransportCalls: fixture.calls,
			signal: new AbortController().signal,
		});
		expect(() =>
			validateD729LiveBundle({
				...bundle,
				disposition: "success",
				bundleDigest: empiricalStrictJsonDigest({ forged: true }),
			}),
		).toThrow();
	});

	it("publishes exactly one atomic success-or-failure generation and cleans injected failures", async () => {
		for (const stage of ["after-write", "after-rename"] as const) {
			const root = await mkdtemp(join(tmpdir(), `graphrefly-d729-persist-${stage}-`));
			await chmod(root, 0o700);
			try {
				const fixture = executorFailureAdapter();
				const bundle = await runD729InjectedNoNetworkQualification({
					adapter: fixture.adapter,
					providerTransportCalls: fixture.calls,
					signal: new AbortController().signal,
				});
				await expect(
					persistD729LiveBundle({
						privateRoot: await realpath(root),
						bundle,
						fault: createD729PersistenceFaultForTest(stage),
					}),
				).rejects.toThrow(/injected/);
				await expect(lstat(join(root, D729_GENERATION_REF))).rejects.toMatchObject({
					code: "ENOENT",
				});
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		}
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d729-persist-success-"));
		await chmod(root, 0o700);
		try {
			const fixture = executorFailureAdapter();
			const bundle = await runD729InjectedNoNetworkQualification({
				adapter: fixture.adapter,
				providerTransportCalls: fixture.calls,
				signal: new AbortController().signal,
			});
			const receipt = await persistD729LiveBundle({
				privateRoot: await realpath(root),
				bundle,
			});
			expect(receipt.disposition).toBe("partial-failure");
			expect(
				receipt.artifactDigests.some((entry) => entry.name === "success-generation.v1.json"),
			).toBe(false);
			await expect(
				persistD729LiveBundle({
					privateRoot: await realpath(root),
					bundle,
				}),
			).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);
});
