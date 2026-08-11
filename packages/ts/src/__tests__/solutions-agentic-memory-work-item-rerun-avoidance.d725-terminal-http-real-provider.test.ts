import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import type { D720CallerEffectExecutionInputV2 } from "../../evals/empirical-memory-rerun-avoidance/d722-graph-native-eval.js";
import {
	createD722InjectedModelFixture,
	invokeD722InjectedModelFixture,
} from "../../evals/empirical-memory-rerun-avoidance/d722-injected-model-fixture.js";
import {
	D725_IMPLEMENTATION_MANIFEST_DIGEST,
	validateD725ImplementationSourceBytes,
} from "../../evals/empirical-memory-rerun-avoidance/d725-implementation-manifest.js";
import { runD725InjectedNoNetworkQualification } from "../../evals/empirical-memory-rerun-avoidance/d725-injected-no-network-qualification.js";
import {
	createD725PersistenceFault,
	persistD725PreLiveBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d725-pre-live-persistence.js";
import {
	consumeD725AdapterReceipt,
	createD725InjectedNoNetworkTurn,
	createD725RealProviderAdapter,
	invokeD725OpenRouterGraphTurn,
	runD725RealProviderAdapter,
	validateD725PreLiveBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d725-terminal-http-real-provider.js";

const digest = (value: unknown) => empiricalStrictJsonDigest(value);
const encoder = new TextEncoder();

function budget() {
	return {
		budgetLimits: {
			maxRequests: 96,
			maxRetryWaits: 12,
			maxCostMicrousd: 6_000_000,
			maxElapsedMs: 7_200_000,
		},
		effectCeilings: {
			providerMaxCostMicrousd: 50_000,
			providerMaxElapsedMs: 120_000,
			localEffectMaxElapsedMs: 60_000,
			routeDigest: digest({ route: "d725-injected" }),
		},
	};
}

function fullSixArmAdapter() {
	const workspaces = new Map<number, string>();
	const model = createD722InjectedModelFixture();
	return createD725RealProviderAdapter({
		executionClass: "injected-no-network",
		async materialization({ effectRequest }) {
			const workspace = digest({ run: effectRequest.runSequence, state: "base" });
			workspaces.set(effectRequest.runSequence, workspace);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "materialization",
					status: "ready",
					workspaceStateDigest: workspace,
					evidenceDigest: digest({ effectRequest, ready: true }),
				},
			};
		},
		async providerRequest(input) {
			return createD725InjectedNoNetworkTurn({
				actualCostMicrousd: 1,
				actualElapsedMs: 1,
				result: await invokeD722InjectedModelFixture(model, input.effectRequest),
			});
		},
		async retryWait({ effectRequest }) {
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: effectRequest.retryAfterMs ?? 60_000,
				result: {
					effectKind: "retry-wait",
					status: "completed",
					evidenceDigest: digest({ effectRequest, waited: true }),
				},
			};
		},
		async toolAction({ effectRequest }) {
			const intent = effectRequest.toolIntent!;
			const before = workspaces.get(effectRequest.runSequence)!;
			const after =
				intent.toolRef === "replace-exact"
					? digest({ before, intent: intent.intentDigest })
					: before;
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
		},
		async hiddenVerifier({ effectRequest }) {
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "hidden-verifier",
					status: "passed",
					workspaceStateDigest: workspaces.get(effectRequest.runSequence)!,
					evidenceDigest: digest({ effectRequest, passed: true }),
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
					evidenceDigest: digest({ effectRequest, cleaned: true }),
				},
			};
		},
	});
}

function terminalAdapter() {
	const workspace = digest({ workspace: "d725-terminal" });
	return createD725RealProviderAdapter({
		executionClass: "injected-no-network",
		async materialization({ effectRequest }) {
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "materialization",
					status: "ready",
					workspaceStateDigest: workspace,
					evidenceDigest: digest({ effectRequest, ready: true }),
				},
			};
		},
		async providerRequest({ effectRequest, signal }) {
			return invokeD725OpenRouterGraphTurn({
				effectRequest,
				credential: {
					credentialBindingRef: "d725.injected",
					credentialBindingRevision: "v1",
					bearerToken: "not-a-live-credential",
				},
				transport: {
					async request() {
						return {
							status: 400,
							body: encoder.encode(
								JSON.stringify({ error: { code: "invalid_request", message: "secret" } }),
							),
							retryAfterMs: null,
							retryAfterDisposition: "absent",
						};
					},
				},
				taskStatement: "Injected terminal HTTP qualification",
				conversation: { messages: [] },
				signal: signal ?? new AbortController().signal,
				monotonicNowMs: () => 1,
			});
		},
		async retryWait() {
			throw new Error("unreachable retry");
		},
		async toolAction() {
			throw new Error("unreachable tool");
		},
		async hiddenVerifier() {
			throw new Error("unreachable verifier");
		},
		async cleanup({ effectRequest }) {
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup",
					status: "succeeded",
					evidenceDigest: digest({ effectRequest, cleaned: true }),
				},
			};
		},
	});
}

async function qualifiedBundle() {
	return runD725InjectedNoNetworkQualification();
}

describe("D725 terminal HTTP real-provider pre-live integration", () => {
	it("binds the exact decision-bearing implementation sources", async () => {
		const root = new URL("../../evals/empirical-memory-rerun-avoidance/", import.meta.url);
		const sources = {
			terminalHttpRealProvider: new Uint8Array(
				await readFile(new URL("d725-terminal-http-real-provider.ts", root)),
			),
			preLivePersistence: new Uint8Array(
				await readFile(new URL("d725-pre-live-persistence.ts", root)),
			),
			injectedNoNetworkQualification: new Uint8Array(
				await readFile(new URL("d725-injected-no-network-qualification.ts", root)),
			),
			terminalHttpEvidence: new Uint8Array(
				await readFile(new URL("d724-terminal-http-evidence.ts", root)),
			),
			underlyingOpenRouterTurn: new Uint8Array(
				await readFile(new URL("d723-openrouter-graph-turn.ts", root)),
			),
			underlyingRealProviderAdapter: new Uint8Array(
				await readFile(new URL("d723-graph-native-real-provider.ts", root)),
			),
		};
		expect(validateD725ImplementationSourceBytes(sources)).toBe(
			D725_IMPLEMENTATION_MANIFEST_DIGEST,
		);
		const substituted = new Uint8Array(sources.terminalHttpEvidence);
		substituted[0] ^= 1;
		expect(() =>
			validateD725ImplementationSourceBytes({ ...sources, terminalHttpEvidence: substituted }),
		).toThrow(/source drifted/);
	});

	it("constructs the canonical injected no-network six-arm qualification", async () => {
		const bundle = await runD725InjectedNoNetworkQualification();
		expect(bundle.qualification.operational).toMatchObject({
			executionClass: "injected-no-network",
			terminalHttpAdmissionCount: 0,
			graphRetryWaitCount: 6,
			exactTerminalHttpCoverage: true,
		});
		expect(bundle.qualification.terminalProbeGraphEvidence.facts).toHaveLength(1);
		validateD725PreLiveBundle(bundle);
	});

	it("runs all six arms with Graph-only effect accounting and no surplus terminal facts", async () => {
		const sourceDigest = D725_IMPLEMENTATION_MANIFEST_DIGEST;
		const run = await runD725RealProviderAdapter({
			sourceDigest,
			...budget(),
			adapter: fullSixArmAdapter(),
		});
		const operational = consumeD725AdapterReceipt(run.receipt, run);
		expect(run.core.ledger.completedArms).toHaveLength(6);
		expect(operational).toMatchObject({
			executionClass: "injected-no-network",
			terminalProviderResultCount: 0,
			terminalHttpAdmissionCount: 0,
			exactTerminalHttpCoverage: true,
			maxActiveInvocations: 1,
		});
		expect(run.terminalHttpGraphEvidence.facts).toEqual([]);
	});

	it("admits one sanitized non-retryable HTTP fact bound to the exact Graph effect", async () => {
		const run = await runD725RealProviderAdapter({
			sourceDigest: digest({ fixture: "d725-terminal" }),
			...budget(),
			adapter: terminalAdapter(),
		});
		const operational = consumeD725AdapterReceipt(run.receipt, run);
		expect(operational.terminalProviderResultCount).toBe(1);
		expect(operational.terminalHttpAdmissionCount).toBe(1);
		expect(run.terminalHttpGraphEvidence.facts[0]?.terminalHttpEvidence).toMatchObject({
			httpStatus: 400,
			bodyShape: "error-envelope",
			recognizedCodePresent: true,
		});
		expect(JSON.stringify(run.terminalHttpGraphEvidence)).not.toContain("secret");
	});

	it("rejects omitted or rebound terminal facts against the exact canonical run", async () => {
		const omittedRun = await runD725RealProviderAdapter({
			sourceDigest: digest({ fixture: "d725-omitted" }),
			...budget(),
			adapter: terminalAdapter(),
		});
		const omittedMaterial = {
			schemaVersion: "graphrefly.b112.d724.terminal-http-graph-evidence.v1" as const,
			facts: [],
		};
		expect(() =>
			consumeD725AdapterReceipt(omittedRun.receipt, {
				core: omittedRun.core,
				terminalHttpGraphEvidence: {
					...omittedMaterial,
					evidenceDigest: digest(omittedMaterial),
				},
			}),
		).toThrow(/incomplete or surplus/);

		const reboundRun = await runD725RealProviderAdapter({
			sourceDigest: digest({ fixture: "d725-rebound" }),
			...budget(),
			adapter: terminalAdapter(),
		});
		const original = reboundRun.terminalHttpGraphEvidence.facts[0]!;
		const admissionMaterial = {
			schemaVersion: original.schemaVersion,
			effectRequestDigest: digest({ substituted: "request" }),
			effectAdmissionDigest: original.effectAdmissionDigest,
			providerResultDigest: original.providerResultDigest,
			terminalHttpEvidence: original.terminalHttpEvidence,
		};
		const reboundFact = { ...admissionMaterial, admissionDigest: digest(admissionMaterial) };
		const reboundMaterial = {
			schemaVersion: reboundRun.terminalHttpGraphEvidence.schemaVersion,
			facts: [reboundFact],
		};
		expect(() =>
			consumeD725AdapterReceipt(reboundRun.receipt, {
				core: reboundRun.core,
				terminalHttpGraphEvidence: {
					...reboundMaterial,
					evidenceDigest: digest(reboundMaterial),
				},
			}),
		).toThrow(/binding drifted/);
	});

	it("does not admit retryable HTTP attempts as terminal findings", async () => {
		const effectRequest = {
			kind: "graph-effect-request" as const,
			runSequence: 0,
			issuedRequestDigest: digest({ issued: 1 }),
			effectSequence: 1,
			effectKind: "provider-request" as const,
			logicalRequestDigest: digest({ logical: 1 }),
			attemptOrdinal: 1,
			retryReason: "none" as const,
			retryAfterMs: null,
			toolIntent: null,
			phaseBefore: "materialized" as const,
			workspaceStateDigest: digest({ workspace: 1 }),
			requestDigest: digest({ request: 1 }),
		};
		const turn = await invokeD725OpenRouterGraphTurn({
			effectRequest,
			credential: {
				credentialBindingRef: "d725.injected",
				credentialBindingRevision: "v1",
				bearerToken: "not-a-live-credential",
			},
			transport: {
				async request() {
					return {
						status: 429,
						body: encoder.encode("rate limited"),
						retryAfterMs: null,
						retryAfterDisposition: "absent",
					};
				},
			},
			taskStatement: "Injected retry qualification",
			conversation: { messages: [] },
			signal: new AbortController().signal,
			monotonicNowMs: () => 1,
		});
		expect(turn.result).toMatchObject({
			status: "retryable-failure",
			failureDiscriminator: "d710-untyped-http-429",
		});
		expect(turn.terminalHttpEvidence).toBeNull();
	});

	it("rejects caller accessors and unconstructed provider turns before Graph evidence", async () => {
		let hits = 0;
		expect(() =>
			createD725RealProviderAdapter({
				executionClass: "injected-no-network",
				get materialization() {
					hits += 1;
					return async (_input: D720CallerEffectExecutionInputV2) => {
						throw new Error("unreachable");
					};
				},
				providerRequest: async () => Promise.reject(new Error("unreachable")),
				retryWait: async () => Promise.reject(new Error("unreachable")),
				toolAction: async () => Promise.reject(new Error("unreachable")),
				hiddenVerifier: async () => Promise.reject(new Error("unreachable")),
				cleanup: async () => Promise.reject(new Error("unreachable")),
			}),
		).toThrow(/own data property/);
		expect(hits).toBe(0);
	});

	it("rejects accessor and oversized transport responses before material can be admitted", async () => {
		const effectRequest = {
			kind: "graph-effect-request" as const,
			runSequence: 0,
			issuedRequestDigest: digest({ issued: "bounds" }),
			effectSequence: 1,
			effectKind: "provider-request" as const,
			logicalRequestDigest: digest({ logical: "bounds" }),
			attemptOrdinal: 1,
			retryReason: "none" as const,
			retryAfterMs: null,
			toolIntent: null,
			phaseBefore: "materialized" as const,
			workspaceStateDigest: digest({ workspace: "bounds" }),
			requestDigest: digest({ request: "bounds" }),
		};
		const base = {
			effectRequest,
			credential: {
				credentialBindingRef: "d725.injected",
				credentialBindingRevision: "v1",
				bearerToken: "not-a-live-credential",
			},
			taskStatement: "Injected response boundary qualification",
			conversation: { messages: [] },
			signal: new AbortController().signal,
			monotonicNowMs: () => 1,
		};
		let hits = 0;
		await expect(
			invokeD725OpenRouterGraphTurn({
				...base,
				transport: {
					async request() {
						const response: Record<string, unknown> = {
							body: encoder.encode("failure"),
							retryAfterMs: null,
						};
						Object.defineProperty(response, "status", {
							enumerable: true,
							get() {
								hits += 1;
								return 400;
							},
						});
						return response as never;
					},
				},
			}),
		).rejects.toThrow();
		expect(hits).toBe(0);
		await expect(
			invokeD725OpenRouterGraphTurn({
				...base,
				transport: {
					async request() {
						return {
							status: 400,
							body: new Uint8Array(1_048_577),
							retryAfterMs: null,
						};
					},
				},
			}),
		).rejects.toThrow(/exceeds the bound/);
	});

	it("persists one 0700/0600 canonical generation and rejects duplicate commit", async () => {
		const container = await mkdtemp(join(tmpdir(), "graphrefly-d725-persist-"));
		const privateRoot = join(container, "private");
		await mkdir(privateRoot, { mode: 0o700 });
		await chmod(privateRoot, 0o700);
		try {
			const bundle = await qualifiedBundle();
			const receipt = await persistD725PreLiveBundle({
				privateRoot: await realpath(privateRoot),
				bundle,
			});
			expect(receipt.bundleDigest).toBe(bundle.bundleDigest);
			const root = join(privateRoot, "d725-terminal-http-real-provider-pre-live-v1");
			expect((await lstat(root)).mode & 0o777).toBe(0o700);
			expect((await lstat(join(root, "commit.v1.json"))).mode & 0o777).toBe(0o600);
			await expect(
				persistD725PreLiveBundle({ privateRoot: await realpath(privateRoot), bundle }),
			).rejects.toThrow(/already exists/);
		} finally {
			await rm(container, { recursive: true, force: true });
		}
	});

	it("removes the exact owned claim after injected pre/post-commit failures", async () => {
		for (const stage of ["after-claim", "after-artifacts-rename"] as const) {
			const container = await mkdtemp(join(tmpdir(), `graphrefly-d725-${stage}-`));
			const privateRoot = join(container, "private");
			await mkdir(privateRoot, { mode: 0o700 });
			await chmod(privateRoot, 0o700);
			try {
				await expect(
					persistD725PreLiveBundle({
						privateRoot: await realpath(privateRoot),
						bundle: await qualifiedBundle(),
						fault: createD725PersistenceFault(stage),
					}),
				).rejects.toThrow(/injected/);
				await expect(
					lstat(join(privateRoot, "d725-terminal-http-real-provider-pre-live-v1")),
				).rejects.toMatchObject({ code: "ENOENT" });
			} finally {
				await rm(container, { recursive: true, force: true });
			}
		}
	}, 30_000);
});
