import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	persistCurrentGraphLiveBundle,
	persistCurrentGraphLivePreexecutionFailure,
	runCurrentGraphLiveMeasurement,
	validateCurrentGraphLiveBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d8-current-live.js";
import {
	acquireCurrentGraphLiveDispatchClaimAtRootForTest,
	consumeCurrentGraphLiveDispatchClaim,
} from "../../evals/empirical-memory-rerun-avoidance/d8-current-live-claim.js";
import {
	CURRENT_GRAPH_LIVE_D6_QUALIFICATION_ARTIFACT_DIGEST,
	CURRENT_GRAPH_LIVE_GENERATION_REF,
	CURRENT_GRAPH_LIVE_PRICING_SOURCE,
	CURRENT_GRAPH_LIVE_PROVIDER_NAME,
	CURRENT_GRAPH_LIVE_PROVIDER_TAG,
	CURRENT_GRAPH_LIVE_QUANTIZATION,
	CURRENT_GRAPH_LIVE_READABLE_FILES,
	CURRENT_GRAPH_LIVE_REQUEST_MODEL,
	CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
} from "../../evals/empirical-memory-rerun-avoidance/d8-current-live-coordinates.js";
import {
	admitCurrentGraphLiveZeroByok,
	composeCurrentGraphLivePreclaim,
	readCurrentGraphLiveOfficialPricing,
} from "../../evals/empirical-memory-rerun-avoidance/d8-current-live-preflight.js";
import {
	CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
	CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
	createCurrentGraphOpenRouterExecutor,
} from "../../evals/empirical-memory-rerun-avoidance/d8-current-openrouter-adapter.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "../../evals/empirical-memory-rerun-avoidance/openrouter-current-key-spend-admission.js";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function pricingResponse() {
	const response = new Response(
		JSON.stringify({
			data: {
				id: CURRENT_GRAPH_LIVE_REQUEST_MODEL,
				endpoints: [
					{
						provider_name: CURRENT_GRAPH_LIVE_PROVIDER_NAME,
						tag: CURRENT_GRAPH_LIVE_PROVIDER_TAG,
						quantization: CURRENT_GRAPH_LIVE_QUANTIZATION,
						model: CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
						supported_parameters: ["max_tokens", "reasoning", "tool_choice", "tools"],
						pricing: {
							prompt: "0.00000008",
							completion: "0.00000018",
							input_cache_read: "0.000000016",
						},
					},
				],
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
	Object.defineProperty(response, "url", { value: CURRENT_GRAPH_LIVE_PRICING_SOURCE });
	return response;
}

describe("graphrefly-ts:D8 Graph-native live composition", () => {
	it("preserves the same-process constructed bundle identity through live persistence wiring", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const runnerSource = await readFile(
			join(repositoryRoot, "packages/ts/evals/empirical-memory-rerun-avoidance/run-d8-live.ts"),
			"utf8",
		);
		expect(runnerSource).toContain(
			"const constructedBundle = await runCurrentGraphLiveMeasurement({",
		);
		expect(runnerSource).toContain(
			"const bundle = validateCurrentGraphLiveBundle(constructedBundle);",
		);
		expect(runnerSource).toContain("bundle: constructedBundle,");
	});

	it("runs the admitted six-arm path through the real adapter with injected no-network transport", async () => {
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d8-"));
		roots.push(root);
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const credential = {
			bearerToken: "sk-or-v1-test-current-graph-live-key-xyz",
			credentialBindingRef: "openrouter.local-eval-2" as const,
			credentialBindingRevision: "2026-08-14.v1" as const,
		};
		const nowMs = Date.now();
		const pricing = await readCurrentGraphLiveOfficialPricing({
			fetch: async () => pricingResponse(),
			nowMs: () => nowMs,
		});
		const zeroByokBytes = Buffer.from(
			JSON.stringify({
				schemaVersion: "graphrefly-ts.d8.current-graph-live-zero-byok-observation.v1",
				decisionRef: "graphrefly-ts:D8",
				decisionRevision: "2026-08-15.v1",
				workspaceName: "GraphReFly",
				workspaceSlug: "graph-re-fly",
				keyName: "Local Eval 2",
				keyVisiblePrefix: credential.bearerToken.slice(0, 12),
				keyVisibleSuffix: credential.bearerToken.slice(-3),
				byokCredentialCount: 0,
				allowedModels: [CURRENT_GRAPH_LIVE_REQUEST_MODEL],
				allowedProviders: [CURRENT_GRAPH_LIVE_PROVIDER_NAME],
				observedAt: new Date(nowMs).toISOString(),
				source: "openrouter-browser-settings",
			}),
		);
		const zeroByok = admitCurrentGraphLiveZeroByok({ bytes: zeroByokBytes, credential, nowMs });
		const preclaim = composeCurrentGraphLivePreclaim({
			pricingObservation: pricing,
			zeroByokObservation: zeroByok,
			credential,
		});
		const implementationManifestDigest = empiricalStrictJsonDigest({ fixture: "d8-injected-v1" });
		const privateRoot = join(root, "private");
		await mkdir(privateRoot, { mode: 0o700 });
		const claim = await acquireCurrentGraphLiveDispatchClaimAtRootForTest(
			await realpath(privateRoot),
			{
				preclaim,
				implementationManifestDigest,
				qualificationArtifactDigest: empiricalStrictJsonDigest({ injected: "d8" }),
				qualificationDigest: empiricalStrictJsonDigest({ injected: "d8-qualification" }),
			},
		);
		const admission = await createOpenRouterCurrentKeySpendAdmissionCapability({
			fetch: async () =>
				new Response(
					JSON.stringify({
						data: {
							limit: 32,
							limit_remaining: 31,
							usage: 1,
							limit_reset: null,
							is_management_key: false,
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		}).read({
			credential,
			expectedLimitMicrousd: 32_000_000,
			requiredRemainingMicrousd: 6_000_000,
			signal: new AbortController().signal,
		});
		const executionAuthority = await consumeCurrentGraphLiveDispatchClaim({
			claim,
			currentKeyAdmission: admission,
			allowInjectedTestScope: true,
		});
		let active = 0;
		let maxActive = 0;
		let providerCalls = 0;
		let retryInjected = false;
		const fetchImpl: typeof fetch = async (_url, init) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			providerCalls += 1;
			try {
				const body = JSON.parse(Buffer.from(init?.body as Uint8Array).toString("utf8"));
				if (!retryInjected) {
					retryInjected = true;
					return new Response(JSON.stringify({ error: { message: "bounded" } }), {
						status: 429,
						headers: { "content-type": "application/json", "retry-after": "0" },
					});
				}
				const hasReadResult = body.messages.some(
					(message: { role?: string; content?: string }) =>
						message.role === "tool" && message.content?.includes("function admittedEnvelope"),
				);
				const calls = hasReadResult
					? [
							{
								id: `replace-${providerCalls}`,
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
							{
								id: `diff-${providerCalls}`,
								type: "function",
								function: { name: "workspace_diff", arguments: "{}" },
							},
							{
								id: `validate-${providerCalls}`,
								type: "function",
								function: { name: "focused_validation", arguments: "{}" },
							},
						]
					: CURRENT_GRAPH_LIVE_READABLE_FILES.map((path, index) => ({
							id: `read-${providerCalls}-${index}`,
							type: "function",
							function: { name: "read_file", arguments: JSON.stringify({ path }) },
						}));
				return new Response(
					JSON.stringify({
						choices: [{ message: { role: "assistant", content: null, tool_calls: calls } }],
						usage: {
							prompt_tokens: 100,
							completion_tokens: 20,
							prompt_tokens_details: { cached_tokens: 0 },
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			} finally {
				active -= 1;
			}
		};
		const baseExecutor = createCurrentGraphOpenRouterExecutor({
			repositoryRoot,
			materializationRoot: join(root, "workspaces"),
			credential,
			fetchImpl,
			sleep: async () => undefined,
		});
		let debugError: unknown;
		const executor = {
			async execute(effect: Parameters<typeof baseExecutor.execute>[0]) {
				try {
					return await baseExecutor.execute(effect);
				} catch (error) {
					debugError = error;
					throw error;
				}
			},
			dispose: () => baseExecutor.dispose(),
		};
		const constructedBundle = await runCurrentGraphLiveMeasurement({
			executionAuthority,
			executionClass: "injected-no-network",
			executor,
			implementationManifestDigest,
			d6QualificationArtifactDigest: CURRENT_GRAPH_LIVE_D6_QUALIFICATION_ARTIFACT_DIGEST,
			pricingObservationDigest: pricing.observationDigest,
			zeroByokObservationDigest: zeroByok.observationDigest,
		});
		const bundle = validateCurrentGraphLiveBundle(constructedBundle);
		expect(
			bundle.disposition,
			JSON.stringify({
				terminal: bundle.terminalReceipt,
				partial: bundle.partialGraphEvidence,
				debugError: debugError instanceof Error ? debugError.message : null,
			}),
		).toBe("success");
		expect(bundle.graphEvidence?.workflowEvidence.runs).toHaveLength(6);
		expect(
			bundle.graphEvidence?.workflowEvidence.runs.every((run) => run.cleanupStatus === "completed"),
		).toBe(true);
		expect(bundle.graphEvidence?.budget.retryWaits).toBe(1);
		expect(maxActive).toBe(1);
		expect(providerCalls).toBeGreaterThanOrEqual(13);
		expect(
			await readFile(
				join(repositoryRoot, "packages/ts/src/executors/managed-cloud-postgresql.ts"),
				"utf8",
			),
		).toContain(CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK);
		const persistenceRoot = join(root, "persistence");
		await mkdir(persistenceRoot, { mode: 0o700 });
		const receipt = await persistCurrentGraphLiveBundle({
			privateRoot: await realpath(persistenceRoot),
			bundle: constructedBundle,
		});
		expect(receipt.disposition).toBe("success");
		expect(
			await readFile(
				join(persistenceRoot, CURRENT_GRAPH_LIVE_GENERATION_REF, "artifacts", "generation.v1.json"),
			),
		).not.toHaveLength(0);
	}, 300_000);

	it("admits executor failure as partial Graph evidence and never publishes success generation", async () => {
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d8-failure-"));
		roots.push(root);
		const credential = {
			bearerToken: "sk-or-v1-test-current-graph-live-failure-xyz",
			credentialBindingRef: "openrouter.local-eval-2" as const,
			credentialBindingRevision: "2026-08-14.v1" as const,
		};
		const nowMs = Date.now();
		const pricing = await readCurrentGraphLiveOfficialPricing({
			fetch: async () => pricingResponse(),
			nowMs: () => nowMs,
		});
		const zeroByok = admitCurrentGraphLiveZeroByok({
			bytes: Buffer.from(
				JSON.stringify({
					schemaVersion: "graphrefly-ts.d8.current-graph-live-zero-byok-observation.v1",
					decisionRef: "graphrefly-ts:D8",
					decisionRevision: "2026-08-15.v1",
					workspaceName: "GraphReFly",
					workspaceSlug: "graph-re-fly",
					keyName: "Local Eval 2",
					keyVisiblePrefix: credential.bearerToken.slice(0, 12),
					keyVisibleSuffix: credential.bearerToken.slice(-3),
					byokCredentialCount: 0,
					allowedModels: [CURRENT_GRAPH_LIVE_REQUEST_MODEL],
					allowedProviders: [CURRENT_GRAPH_LIVE_PROVIDER_NAME],
					observedAt: new Date(nowMs).toISOString(),
					source: "openrouter-browser-settings",
				}),
			),
			credential,
			nowMs,
		});
		const preclaim = composeCurrentGraphLivePreclaim({
			pricingObservation: pricing,
			zeroByokObservation: zeroByok,
			credential,
		});
		const privateRoot = join(root, "private");
		await mkdir(privateRoot, { mode: 0o700 });
		const implementationManifestDigest = empiricalStrictJsonDigest({ fixture: "d8-failure" });
		const claim = await acquireCurrentGraphLiveDispatchClaimAtRootForTest(
			await realpath(privateRoot),
			{
				preclaim,
				implementationManifestDigest,
				qualificationArtifactDigest: empiricalStrictJsonDigest({ injected: "failure" }),
				qualificationDigest: empiricalStrictJsonDigest({ injected: "failure-qualification" }),
			},
		);
		const admission = await createOpenRouterCurrentKeySpendAdmissionCapability({
			fetch: async () =>
				new Response(
					JSON.stringify({
						data: {
							limit: 32,
							limit_remaining: 31,
							usage: 1,
							limit_reset: null,
							is_management_key: false,
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		}).read({
			credential,
			expectedLimitMicrousd: 32_000_000,
			requiredRemainingMicrousd: 6_000_000,
			signal: new AbortController().signal,
		});
		const executionAuthority = await consumeCurrentGraphLiveDispatchClaim({
			claim,
			currentKeyAdmission: admission,
			allowInjectedTestScope: true,
		});
		const constructedBundle = await runCurrentGraphLiveMeasurement({
			executionAuthority,
			executionClass: "injected-no-network",
			executor: {
				execute: async () => {
					throw new Error("injected executor failure");
				},
				dispose: async () => undefined,
			},
			implementationManifestDigest,
			d6QualificationArtifactDigest: CURRENT_GRAPH_LIVE_D6_QUALIFICATION_ARTIFACT_DIGEST,
			pricingObservationDigest: pricing.observationDigest,
			zeroByokObservationDigest: zeroByok.observationDigest,
		});
		const bundle = validateCurrentGraphLiveBundle(constructedBundle);
		expect(bundle.disposition).toBe("partial-failure");
		expect(bundle.generation).toBeNull();
		expect(bundle.terminalReceipt.failureCode).toBe("executor-boundary-failed");
		const persistence = await persistCurrentGraphLiveBundle({
			privateRoot: await realpath(privateRoot),
			bundle: constructedBundle,
		});
		expect(persistence.disposition).toBe("partial-failure");
		await expect(
			readFile(
				join(privateRoot, CURRENT_GRAPH_LIVE_GENERATION_REF, "artifacts", "generation.v1.json"),
			),
		).rejects.toMatchObject({ code: "ENOENT" });
	}, 60_000);

	it("atomically persists a current-key failure after claim without a success generation", async () => {
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d8-current-key-failure-"));
		roots.push(root);
		const privateRoot = join(root, "private");
		await mkdir(privateRoot, { mode: 0o700 });
		const credential = {
			bearerToken: "sk-or-v1-test-current-graph-live-key-failure-xyz",
			credentialBindingRef: "openrouter.local-eval-2" as const,
			credentialBindingRevision: "2026-08-14.v1" as const,
		};
		const nowMs = Date.now();
		const pricing = await readCurrentGraphLiveOfficialPricing({
			fetch: async () => pricingResponse(),
			nowMs: () => nowMs,
		});
		const zeroByok = admitCurrentGraphLiveZeroByok({
			bytes: Buffer.from(
				JSON.stringify({
					schemaVersion: "graphrefly-ts.d8.current-graph-live-zero-byok-observation.v1",
					decisionRef: "graphrefly-ts:D8",
					decisionRevision: "2026-08-15.v1",
					workspaceName: "GraphReFly",
					workspaceSlug: "graph-re-fly",
					keyName: "Local Eval 2",
					keyVisiblePrefix: credential.bearerToken.slice(0, 12),
					keyVisibleSuffix: credential.bearerToken.slice(-3),
					byokCredentialCount: 0,
					allowedModels: [CURRENT_GRAPH_LIVE_REQUEST_MODEL],
					allowedProviders: [CURRENT_GRAPH_LIVE_PROVIDER_NAME],
					observedAt: new Date(nowMs).toISOString(),
					source: "openrouter-browser-settings",
				}),
			),
			credential,
			nowMs,
		});
		const preclaim = composeCurrentGraphLivePreclaim({
			pricingObservation: pricing,
			zeroByokObservation: zeroByok,
			credential,
		});
		const implementationManifestDigest = empiricalStrictJsonDigest({
			fixture: "d8-current-key-failure",
		});
		const claim = await acquireCurrentGraphLiveDispatchClaimAtRootForTest(
			await realpath(privateRoot),
			{
				preclaim,
				implementationManifestDigest,
				qualificationArtifactDigest: empiricalStrictJsonDigest({ injected: "failure" }),
				qualificationDigest: empiricalStrictJsonDigest({ injected: "failure-qualification" }),
			},
		);
		const persistence = await persistCurrentGraphLivePreexecutionFailure({
			privateRoot: await realpath(privateRoot),
			claim,
			implementationManifestDigest,
			pricingObservationDigest: pricing.observationDigest,
			zeroByokObservationDigest: zeroByok.observationDigest,
			allowInjectedTestScope: true,
		});
		expect(persistence.disposition).toBe("partial-failure");
		expect(
			await readFile(
				join(
					privateRoot,
					CURRENT_GRAPH_LIVE_GENERATION_REF,
					"artifacts",
					"preexecution-failure.v1.json",
				),
			),
		).not.toHaveLength(0);
		await expect(
			readFile(
				join(privateRoot, CURRENT_GRAPH_LIVE_GENERATION_REF, "artifacts", "generation.v1.json"),
			),
		).rejects.toMatchObject({ code: "ENOENT" });
	}, 60_000);
});
