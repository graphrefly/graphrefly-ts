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
	createD728PersistenceFaultForTest,
	persistD728LiveBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d728-atomic-persistence.js";
import { D728_GENERATION_REF } from "../../evals/empirical-memory-rerun-avoidance/d728-coordinates.js";
import {
	runD728InjectedNoNetworkQualification,
	validateD728LiveBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d728-graph-native-live.js";
import {
	createD726ExecutorFailureProviderTurn,
	createD726ProviderAdapter,
	createD726ProviderTurn,
} from "../../evals/empirical-memory-rerun-avoidance/d728-provider-block-core.js";
import {
	acquireD728SingleUseDispatchClaimAtRoot,
	consumeD728DispatchClaimForExecution,
	consumeD728ExecutionAuthority,
} from "../../evals/empirical-memory-rerun-avoidance/d728-single-use-dispatch-claim.js";
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
			bearerToken: "not-a-live-d728-test-credential",
			credentialBindingRef: "d728.test",
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
			const workspace = sha(`d728-workspace-${effectRequest.runSequence}`);
			workspaces.set(effectRequest.runSequence, workspace);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "materialization",
					status: "ready",
					workspaceStateDigest: workspace,
					evidenceDigest: sha(`d728-materialization-${effectRequest.runSequence}`),
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
						bearerToken: "not-a-live-d728-test-credential",
						credentialBindingRef: "d728.test",
						credentialBindingRevision: "v1",
					},
					transport: {
						async request() {
							calls += 1;
							const toolCalls = scripted.toolIntents.map((intent, index) => ({
								id: `d728-tool-${calls}-${index}`,
								type: "function",
								function: { name: names[intent.toolRef], arguments: "{}" },
							}));
							return {
								status: 200,
								body: new TextEncoder().encode(
									JSON.stringify({
										id: `d728-response-${calls}`,
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
														model: "deepseek/deepseek-v4-flash-20260731",
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
					taskStatement: "D728 injected six-arm qualification",
					conversation: { messages: [] },
					signal: input.signal ?? new AbortController().signal,
					monotonicNowMs: () => calls,
				}),
			);
		},
		async retryWait() {
			throw new TypeError("D728 happy path cannot retry");
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
					evidenceDigest: sha(`d728-tool-${effectRequest.effectSequence}`),
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
					evidenceDigest: sha(`d728-verifier-${effectRequest.runSequence}`),
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
					evidenceDigest: sha(`d728-cleanup-${effectRequest.runSequence}`),
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
					workspaceStateDigest: sha(`d728-failure-workspace-${effectRequest.runSequence}`),
					evidenceDigest: sha(`d728-failure-materialization-${effectRequest.runSequence}`),
				},
			};
		},
		async providerRequest({ effectRequest }) {
			calls += 1;
			return createD726ExecutorFailureProviderTurn({
				classification: "transport-failure",
				evidenceDigest: sha(`d728-transport-${effectRequest.requestDigest}`),
			});
		},
		async retryWait() {
			throw new TypeError("D728 executor failure cannot retry");
		},
		async toolAction() {
			throw new TypeError("D728 executor failure cannot use tools");
		},
		async hiddenVerifier() {
			throw new TypeError("D728 executor failure cannot verify");
		},
		async cleanup({ effectRequest }) {
			workspaces.delete(effectRequest.runSequence);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup",
					status: "succeeded",
					evidenceDigest: sha(`d728-failure-cleanup-${effectRequest.runSequence}`),
				},
			};
		},
	});
	return { adapter, calls: () => calls, workspaces };
}

describe("D728 failure-safe Graph-native live replacement", () => {
	it("keeps the durable dispatch authority fixed-root and single-use", async () => {
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d728-claim-"));
		await chmod(root, 0o700);
		try {
			const claim = await acquireD728SingleUseDispatchClaimAtRoot(await realpath(root), {
				d728PreLiveBundleDigest: sha("prelive"),
				pricingReadDigest: sha("pricing"),
				zeroByokObservationDigest: sha("zero-byok"),
			});
			const authority = await consumeD728DispatchClaimForExecution({
				claim,
				currentKeyAdmission: await currentKeyAdmission(),
			});
			expect(consumeD728ExecutionAuthority(authority).scope).toBe("injected-test-root");
			expect(() => consumeD728ExecutionAuthority(authority)).toThrow(/single-use/);
			await expect(
				acquireD728SingleUseDispatchClaimAtRoot(await realpath(root), {
					d728PreLiveBundleDigest: sha("prelive"),
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
		const bundle = await runD728InjectedNoNetworkQualification({
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
		expect(validateD728LiveBundle(bundle).bundleDigest).toBe(bundle.bundleDigest);
	});

	it("persists executor provenance only as partial failure while still cleaning all arms", async () => {
		const fixture = executorFailureAdapter();
		const bundle = await runD728InjectedNoNetworkQualification({
			adapter: fixture.adapter,
			providerTransportCalls: fixture.calls,
			signal: new AbortController().signal,
		});
		expect(bundle.disposition).toBe("partial-failure");
		expect(bundle.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(bundle.terminalHttpGraphEvidence.facts).toEqual([]);
		expect(bundle.executorFailureFacts).toHaveLength(6);
		expect(fixture.workspaces.size).toBe(0);
		expect(bundle.generation.schemaVersion).toBe(
			"graphrefly.b112.d728.partial-graph-failure-generation.v1",
		);
	});

	it("rejects coordinated outer-digest tampering", async () => {
		const fixture = executorFailureAdapter();
		const bundle = await runD728InjectedNoNetworkQualification({
			adapter: fixture.adapter,
			providerTransportCalls: fixture.calls,
			signal: new AbortController().signal,
		});
		expect(() =>
			validateD728LiveBundle({
				...bundle,
				disposition: "success",
				bundleDigest: empiricalStrictJsonDigest({ forged: true }),
			}),
		).toThrow();
	});

	it("publishes exactly one atomic success-or-failure generation and cleans injected failures", async () => {
		for (const stage of ["after-write", "after-rename"] as const) {
			const root = await mkdtemp(join(tmpdir(), `graphrefly-d728-persist-${stage}-`));
			await chmod(root, 0o700);
			try {
				const fixture = executorFailureAdapter();
				const bundle = await runD728InjectedNoNetworkQualification({
					adapter: fixture.adapter,
					providerTransportCalls: fixture.calls,
					signal: new AbortController().signal,
				});
				await expect(
					persistD728LiveBundle({
						privateRoot: await realpath(root),
						bundle,
						fault: createD728PersistenceFaultForTest(stage),
					}),
				).rejects.toThrow(/injected/);
				await expect(lstat(join(root, D728_GENERATION_REF))).rejects.toMatchObject({
					code: "ENOENT",
				});
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		}
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d728-persist-success-"));
		await chmod(root, 0o700);
		try {
			const fixture = executorFailureAdapter();
			const bundle = await runD728InjectedNoNetworkQualification({
				adapter: fixture.adapter,
				providerTransportCalls: fixture.calls,
				signal: new AbortController().signal,
			});
			const receipt = await persistD728LiveBundle({
				privateRoot: await realpath(root),
				bundle,
			});
			expect(receipt.disposition).toBe("partial-failure");
			expect(
				receipt.artifactDigests.some((entry) => entry.name === "success-generation.v1.json"),
			).toBe(false);
			await expect(
				persistD728LiveBundle({
					privateRoot: await realpath(root),
					bundle,
				}),
			).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);
});
