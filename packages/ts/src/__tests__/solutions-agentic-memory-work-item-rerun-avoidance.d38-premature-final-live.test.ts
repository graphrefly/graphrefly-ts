import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	empiricalStrictJsonDigest,
	strictSnapshot,
} from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	CURRENT_GRAPH_LIVE_LIMITS,
	CURRENT_GRAPH_LIVE_READABLE_FILES,
	CURRENT_GRAPH_LIVE_ROUTE,
} from "../../evals/empirical-memory-rerun-avoidance/d8-current-live-coordinates.js";
import {
	CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
	CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
} from "../../evals/empirical-memory-rerun-avoidance/d8-current-openrouter-adapter.js";
import { D21_TASK_PROFILE } from "../../evals/empirical-memory-rerun-avoidance/d21-current-efficacy-recovery-authority.js";
import {
	admitD34EffectResult,
	createD34RetainedSpanAuthority,
	takeD34AdmittedEffect,
} from "../../evals/empirical-memory-rerun-avoidance/d34-retained-span-mutation-authority.js";
import { createD35RetainedSpanRealProviderExecutor } from "../../evals/empirical-memory-rerun-avoidance/d35-retained-span-real-provider-composition.js";
import { validateD38LiveBundle } from "../../evals/empirical-memory-rerun-avoidance/d38-premature-final-live.js";
import { D38_REPAIRED_LIVE_LIMITS } from "../../evals/empirical-memory-rerun-avoidance/d38-premature-final-live-coordinates.js";
import {
	D38_IMPLEMENTATION_MANIFEST,
	D38_IMPLEMENTATION_MANIFEST_DIGEST,
} from "../../evals/empirical-memory-rerun-avoidance/d38-premature-final-live-implementation-manifest.js";
import {
	createD38QualificationInjectedBaselineForTest,
	createD39InjectedD38V5BaselineForTest,
	persistD38Qualification,
	runD38InjectedNoNetworkQualification,
	validateD38QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d38-premature-final-live-qualification.js";
import { createD38PrematureFinalRealProviderExecutor } from "../../evals/empirical-memory-rerun-avoidance/d38-premature-final-real-provider-composition.js";

describe("graphrefly-ts:D38 premature-final live replacement", () => {
	it("uses the frozen D13 120s deadline for every D38 provider effect", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d38-phase-deadline-"));
		const authority = createD34RetainedSpanAuthority({
			limits: D38_REPAIRED_LIVE_LIMITS,
			routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
			taskProfile: D21_TASK_PROFILE,
		});
		const executor = createD38PrematureFinalRealProviderExecutor({
			authority,
			repositoryRoot,
			materializationRoot: join(root, "workspaces"),
			credential: {
				bearerToken: "injected",
				credentialBindingRef: "openrouter.local-eval-2",
				credentialBindingRevision: "2026-08-14.v1",
			},
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									role: "assistant",
									content: null,
									tool_calls: CURRENT_GRAPH_LIVE_READABLE_FILES.map((path, index) => ({
										id: `read-${index}`,
										type: "function",
										function: { name: "read_file", arguments: JSON.stringify({ path }) },
									})),
								},
							},
						],
						usage: {
							prompt_tokens: 100,
							completion_tokens: 20,
							prompt_tokens_details: { cached_tokens: 0 },
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		});
		try {
			const materialization = takeD34AdmittedEffect(authority);
			if (materialization === null) throw new TypeError("missing materialization");
			const materialized = await executor.execute(materialization);
			admitD34EffectResult(authority, materialized.admitted, materialized.result);

			const inspection = takeD34AdmittedEffect(authority);
			if (inspection === null) throw new TypeError("missing inspection provider request");
			expect(inspection.effect.effect.request.reservation.maxElapsedMs).toBe(120_000);
			const inspected = await executor.execute(inspection);
			admitD34EffectResult(authority, inspected.admitted, inspected.result);

			for (let index = 0; index < CURRENT_GRAPH_LIVE_READABLE_FILES.length; index += 1) {
				const read = takeD34AdmittedEffect(authority);
				if (read === null) throw new TypeError("missing admitted read");
				const result = await executor.execute(read);
				admitD34EffectResult(authority, result.admitted, result.result);
			}

			const mutation = takeD34AdmittedEffect(authority);
			if (mutation === null) throw new TypeError("missing mutation provider request");
			expect(mutation.effect.effect.request.phaseBefore).not.toBe("none");
			expect(mutation.effect.effect.request.reservation.maxElapsedMs).toBe(120_000);
		} finally {
			await executor.dispose();
			await rm(root, { recursive: true, force: true });
		}
	}, 120_000);

	it("returns response-body failures to Graph with conservative reservation accounting", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d38-body-failure-"));
		const authority = createD34RetainedSpanAuthority({
			limits: D38_REPAIRED_LIVE_LIMITS,
			routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
			taskProfile: D21_TASK_PROFILE,
		});
		const executor = createD38PrematureFinalRealProviderExecutor({
			authority,
			repositoryRoot,
			materializationRoot: join(root, "workspaces"),
			credential: {
				bearerToken: "injected",
				credentialBindingRef: "openrouter.local-eval-2",
				credentialBindingRevision: "2026-08-14.v1",
			},
			fetchImpl: async () =>
				new Response(
					new ReadableStream({
						pull(controller) {
							controller.error(new DOMException("bounded injected body failure", "AbortError"));
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		});
		try {
			const materialization = takeD34AdmittedEffect(authority);
			if (materialization === null) throw new TypeError("missing materialization");
			const materialized = await executor.execute(materialization);
			admitD34EffectResult(authority, materialized.admitted, materialized.result);

			const provider = takeD34AdmittedEffect(authority);
			if (provider === null) throw new TypeError("missing provider request");
			const execution = await executor.execute(provider);
			const result = execution.result as {
				readonly status: string;
				readonly failureCode: string;
				readonly usage: {
					readonly requests: number;
					readonly actualCostMicrousd: number;
					readonly costBasis: string;
				};
			};
			expect(result.status).toBe("failed");
			expect(result.failureCode).toBe("provider-failed");
			expect(result.usage).toMatchObject({
				requests: 1,
				actualCostMicrousd: provider.effect.effect.request.reservation.maxCostMicrousd,
				costBasis: "conservative-reservation",
			});
			admitD34EffectResult(authority, execution.admitted, execution.result);
			const cleanup = takeD34AdmittedEffect(authority);
			expect(cleanup?.effect.effect.request.effectKind).toBe("cleanup");
		} finally {
			await executor.dispose();
			await rm(root, { recursive: true, force: true });
		}
	}, 120_000);

	it("classifies a post-inspection structured final without losing its boundary cause", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d38-structured-final-"));
		let calls = 0;
		const authority = createD34RetainedSpanAuthority({
			limits: CURRENT_GRAPH_LIVE_LIMITS,
			routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
			taskProfile: D21_TASK_PROFILE,
		});
		const executor = createD35RetainedSpanRealProviderExecutor({
			authority,
			repositoryRoot,
			materializationRoot: join(root, "workspaces"),
			credential: {
				bearerToken: "injected",
				credentialBindingRef: "openrouter.local-eval-2",
				credentialBindingRevision: "2026-08-14.v1",
			},
			fetchImpl: async () => {
				calls += 1;
				return new Response(
					JSON.stringify({
						choices: [
							{
								message:
									calls === 1
										? {
												role: "assistant",
												content: null,
												tool_calls: CURRENT_GRAPH_LIVE_READABLE_FILES.map((path, index) => ({
													id: `read-${index}`,
													type: "function",
													function: { name: "read_file", arguments: JSON.stringify({ path }) },
												})),
											}
										: calls === 2
											? { role: "assistant", content: "The task is complete." }
											: {
													role: "assistant",
													content: null,
													tool_calls: [
														{
															id: "replacement",
															type: "function",
															function: {
																name: "replace_exact",
																arguments: JSON.stringify({
																	path: "packages/ts/src/executors/managed-cloud-postgresql.ts",
																	oldText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
																	newText: CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
																}),
															},
														},
													],
												},
							},
						],
						usage: {
							prompt_tokens: 100,
							completion_tokens: 20,
							prompt_tokens_details: { cached_tokens: 0 },
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		});
		try {
			let observed: unknown = null;
			for (let index = 0; index < 8; index += 1) {
				try {
					const execution = await executor.executeNext();
					if (execution === null) break;
					admitD34EffectResult(authority, execution.admitted, execution.result);
				} catch (error) {
					observed = error;
					break;
				}
			}
			expect(calls).toBe(3);
			expect(observed).toBeNull();
		} finally {
			await executor.dispose();
			await rm(root, { recursive: true, force: true });
		}
	}, 120_000);

	it("accounts a successful response without valid usage conservatively and stops the arm", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d38-missing-usage-"));
		const authority = createD34RetainedSpanAuthority({
			limits: CURRENT_GRAPH_LIVE_LIMITS,
			routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
			taskProfile: D21_TASK_PROFILE,
		});
		const executor = createD35RetainedSpanRealProviderExecutor({
			authority,
			repositoryRoot,
			materializationRoot: join(root, "workspaces"),
			credential: {
				bearerToken: "injected",
				credentialBindingRef: "openrouter.local-eval-2",
				credentialBindingRevision: "2026-08-14.v1",
			},
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						choices: [{ message: { role: "assistant", content: "bounded final" } }],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		});
		try {
			const materialization = await executor.executeNext();
			if (materialization === null) throw new TypeError("missing D38 materialization");
			admitD34EffectResult(authority, materialization.admitted, materialization.result);
			const provider = await executor.executeNext();
			if (provider === null) throw new TypeError("missing D38 provider effect");
			const result = provider.result as {
				readonly status: string;
				readonly failureCode: string;
				readonly usage: { readonly actualCostMicrousd: number; readonly costBasis: string };
			};
			expect(result.status).toBe("failed");
			expect(result.failureCode).toBe("provider-failed");
			expect(result.usage.costBasis).toBe("conservative-reservation");
			expect(result.usage.actualCostMicrousd).toBe(
				CURRENT_GRAPH_LIVE_LIMITS.providerMaxCostMicrousd,
			);
			admitD34EffectResult(authority, provider.admitted, provider.result);
			const cleanup = await executor.executeNext();
			if (cleanup === null) throw new TypeError("missing D38 cleanup");
			admitD34EffectResult(authority, cleanup.admitted, cleanup.result);
		} finally {
			await executor.dispose();
			await rm(root, { recursive: true, force: true });
		}
	}, 120_000);

	it.each([
		"missing-usage",
		"malformed-proposal",
		"malformed-envelope",
		"invalid-json",
		"invalid-json-429",
		"invalid-json-503",
	] as const)("returns a retained-span %s response to Graph for bounded failure accounting", async (mode) => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const root = await mkdtemp(join(tmpdir(), `graphrefly-d38-retained-${mode}-`));
		let calls = 0;
		let failedResult:
			| {
					readonly effectKind: string;
					readonly status: string;
					readonly failureCode: string;
					readonly usage: { readonly costBasis: string };
			  }
			| undefined;
		let cleanupSeen = false;
		let retryWaitSeen = false;
		const usage = {
			prompt_tokens: 100,
			completion_tokens: 20,
			prompt_tokens_details: { cached_tokens: 0 },
		};
		const response = (toolCalls: readonly unknown[], includeUsage = true) =>
			new Response(
				JSON.stringify({
					choices: [{ message: { role: "assistant", content: null, tool_calls: toolCalls } }],
					...(includeUsage ? { usage } : {}),
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		const authority = createD34RetainedSpanAuthority({
			limits: CURRENT_GRAPH_LIVE_LIMITS,
			routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
			taskProfile: D21_TASK_PROFILE,
		});
		const executor = createD35RetainedSpanRealProviderExecutor({
			authority,
			repositoryRoot,
			materializationRoot: join(root, "workspaces"),
			credential: {
				bearerToken: "injected",
				credentialBindingRef: "openrouter.local-eval-2",
				credentialBindingRevision: "2026-08-14.v1",
			},
			fetchImpl: async () => {
				calls += 1;
				if (calls === 1 || calls === 3)
					return response(
						CURRENT_GRAPH_LIVE_READABLE_FILES.map((path, index) => ({
							id: `read-${calls}-${index}`,
							type: "function",
							function: { name: "read_file", arguments: JSON.stringify({ path }) },
						})),
					);
				if (calls === 2)
					return response([
						{
							id: "unchanged",
							type: "function",
							function: {
								name: "replace_exact",
								arguments: JSON.stringify({
									path: "packages/ts/src/executors/managed-cloud-postgresql.ts",
									oldText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
									newText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
								}),
							},
						},
					]);
				if (calls === 5 && (mode === "invalid-json-429" || mode === "invalid-json-503"))
					return response([
						{
							id: "retry-proposal",
							type: "function",
							function: {
								name: "propose_replacement_text",
								arguments: JSON.stringify({
									newText: CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
								}),
							},
						},
					]);
				if (calls !== 4) throw new TypeError("unexpected retained-span provider call");
				if (mode === "invalid-json-429" || mode === "invalid-json-503")
					return new Response("{not-json", {
						status: mode === "invalid-json-429" ? 429 : 503,
						headers: {
							"content-type": "application/json",
							"retry-after": "0",
						},
					});
				if (mode === "invalid-json")
					return new Response("{not-json", {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				if (mode === "malformed-envelope")
					return new Response(
						JSON.stringify({
							choices: [
								{
									message: {
										role: "tool",
										content: null,
										tool_calls: [
											{
												type: "function",
												function: {
													name: "propose_replacement_text",
													arguments: JSON.stringify({
														newText: CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
													}),
												},
											},
										],
									},
								},
							],
							usage,
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				return response(
					[
						{
							id: "proposal",
							type: "function",
							function: {
								name: "propose_replacement_text",
								arguments:
									mode === "missing-usage"
										? JSON.stringify({ newText: CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK })
										: JSON.stringify({ wrong: "shape" }),
							},
						},
					],
					mode !== "missing-usage",
				);
			},
		});
		try {
			for (let index = 0; index < 24; index += 1) {
				const execution = await executor.executeNext();
				if (execution === null) break;
				const result = execution.result as {
					readonly effectKind: string;
					readonly status: string;
					readonly failureCode: string;
					readonly usage: { readonly costBasis: string };
				};
				if (result.effectKind === "provider-request" && result.status === "failed")
					failedResult = result;
				if (result.effectKind === "retry-wait") retryWaitSeen = true;
				if (result.effectKind === "cleanup") cleanupSeen = true;
				admitD34EffectResult(authority, execution.admitted, execution.result);
				if (cleanupSeen) break;
				if (
					calls === 5 &&
					result.effectKind === "provider-request" &&
					result.status === "completed"
				)
					break;
			}
			const retryMode = mode === "invalid-json-429" || mode === "invalid-json-503";
			expect(calls).toBe(retryMode ? 5 : 4);
			expect(failedResult).toMatchObject({
				effectKind: "provider-request",
				status: "failed",
				failureCode: retryMode ? "retryable-transient" : "provider-failed",
				usage: {
					costBasis:
						mode === "missing-usage" || mode.startsWith("invalid-json")
							? "conservative-reservation"
							: "reported",
				},
			});
			expect(retryWaitSeen).toBe(retryMode);
			expect(cleanupSeen).toBe(!retryMode);
		} finally {
			await executor.dispose();
			await rm(root, { recursive: true, force: true });
		}
	}, 120_000);

	it("binds the current D38 implementation manifest", () => {
		expect(empiricalStrictJsonDigest(D38_IMPLEMENTATION_MANIFEST)).toBe(
			D38_IMPLEMENTATION_MANIFEST_DIGEST,
		);
	});

	it("qualifies six serial arms, retained retry identity, cleanup and partial persistence offline", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d38-test-"));
		const materializationRoot = join(root, "workspaces");
		try {
			const constructed = await runD38InjectedNoNetworkQualification({
				baseline: createD38QualificationInjectedBaselineForTest(),
				baselineBasis: "injected-test",
				replacementBaseline: createD39InjectedD38V5BaselineForTest(),
				repositoryRoot,
				materializationRoot,
			});
			const bundle = validateD38QualificationBundle(constructed);
			expect(bundle.qualification.exactSixArmsCompleted).toBe(true);
			expect(bundle.qualification.providerTransportCalls).toBe(31);
			expect(bundle.qualification.retainedSpanTransportCalls).toBe(7);
			expect(bundle.qualification.prematureFinalRecoveryCount).toBe(6);
			expect(bundle.qualification.retryWaitCount).toBe(1);
			expect(bundle.qualification.maxActiveTransport).toBe(1);
			expect(bundle.qualification.providerNetworkCalls).toBe(0);
			expect(bundle.qualification.partialFailurePersistencePassed).toBe(true);
			expect(bundle.qualification.workspaceResidueCount).toBe(0);
			expect(bundle.mainBundle.gate.evaluated).toBe(false);
			expect(bundle.mainBundle.efficacyClaim).toBe("none");
			const serialized = JSON.stringify(bundle);
			expect(serialized).not.toContain(CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK);
			expect(serialized).not.toContain(CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK);
			await expect(
				persistD38Qualification({ privateRoot: join(root, "private"), bundle: constructed }),
			).rejects.toThrow("requires consumed D37 and D38-v5 bytes");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 120_000);

	it("rejects a redigested live-gate substitution", () => {
		const forgedGateBase = strictSnapshot({
			schemaVersion: "graphrefly-ts.d39.positive-differential-gate.v1",
			definitionDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
			evaluated: true,
			passed: true,
			failureCodes: [],
		});
		const forged = {
			schemaVersion: "graphrefly-ts.d38.premature-final-live-bundle.v1",
			decisionRef: "graphrefly-ts:D38",
			executionClass: "live-provider",
			disposition: "partial-failure",
			coordinatesDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
			implementationManifestDigest: D38_IMPLEMENTATION_MANIFEST_DIGEST,
			gate: { ...forgedGateBase, gateDigest: empiricalStrictJsonDigest(forgedGateBase) },
		};
		expect(() => validateD38LiveBundle(forged)).toThrow();
	});
});
