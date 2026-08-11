import { chmod, lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { invokeD725OpenRouterGraphTurn } from "../../evals/empirical-memory-rerun-avoidance/d725-terminal-http-real-provider.js";
import {
	createD726ExecutorFailureProviderTurn,
	createD726ProviderAdapter,
	createD726ProviderTurn,
} from "../../evals/empirical-memory-rerun-avoidance/d726-graph-native-live.js";
import {
	createD727PersistenceFault,
	D727_GENERATION_REF,
	persistD727PartialFailureBundle,
	runD727InjectedNoNetworkQualification,
	validateD727PartialFailureBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d727-executor-failure-pre-live.js";

const sha = (label: string) => empiricalStrictJsonDigest({ label });

function executorFailureAdapter(
	classification:
		| "executor-threw"
		| "transport-failure"
		| "route-evidence-failure"
		| "response-decode-failure",
) {
	const workspaces = new Set<number>();
	let providerCalls = 0;
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
					workspaceStateDigest: sha(`d727-workspace-${effectRequest.runSequence}`),
					evidenceDigest: sha(`d727-materialization-${effectRequest.runSequence}`),
				},
			};
		},
		async providerRequest({ effectRequest }) {
			providerCalls += 1;
			return createD726ExecutorFailureProviderTurn({
				classification,
				evidenceDigest: sha(`d727-${classification}-${effectRequest.requestDigest}`),
			});
		},
		async retryWait() {
			throw new TypeError("D727 executor failure cannot retry");
		},
		async toolAction() {
			throw new TypeError("D727 executor failure cannot execute tools");
		},
		async hiddenVerifier() {
			throw new TypeError("D727 executor failure cannot verify");
		},
		async cleanup({ effectRequest }) {
			workspaces.delete(effectRequest.runSequence);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup",
					status: "succeeded",
					evidenceDigest: sha(`d727-cleanup-${effectRequest.runSequence}`),
				},
			};
		},
	});
	return { adapter, workspaces, providerCalls: () => providerCalls };
}

function thrownExecutorAdapter(cleanupStatus: "succeeded" | "failed" = "succeeded") {
	const workspaces = new Set<number>();
	let providerCalls = 0;
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
					workspaceStateDigest: sha(`d727-throw-workspace-${effectRequest.runSequence}`),
					evidenceDigest: sha(`d727-throw-materialization-${effectRequest.runSequence}`),
				},
			};
		},
		async providerRequest() {
			providerCalls += 1;
			throw new Error("injected D727 provider executor throw");
		},
		async retryWait() {
			throw new TypeError("D727 thrown executor cannot retry");
		},
		async toolAction() {
			throw new TypeError("D727 thrown executor cannot execute tools");
		},
		async hiddenVerifier() {
			throw new TypeError("D727 thrown executor cannot verify");
		},
		async cleanup({ effectRequest }) {
			workspaces.delete(effectRequest.runSequence);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup",
					status: cleanupStatus,
					evidenceDigest: sha(`d727-throw-cleanup-${cleanupStatus}-${effectRequest.runSequence}`),
				},
			};
		},
	});
	return { adapter, workspaces, providerCalls: () => providerCalls };
}

async function qualified(
	classification:
		| "executor-threw"
		| "transport-failure"
		| "route-evidence-failure"
		| "response-decode-failure" = "executor-threw",
) {
	const fixture = executorFailureAdapter(classification);
	const bundle = await runD727InjectedNoNetworkQualification({
		adapter: fixture.adapter,
		signal: new AbortController().signal,
	});
	return { ...fixture, bundle };
}

function terminalHttpAdapter(mode: "terminal-400" | "untyped-429-then-400") {
	const workspaces = new Set<number>();
	const attempts = new Map<number, number>();
	let transportCalls = 0;
	let retryWaitCalls = 0;
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
					workspaceStateDigest: sha(`d727-http-workspace-${effectRequest.runSequence}`),
					evidenceDigest: sha(`d727-http-materialization-${effectRequest.runSequence}`),
				},
			};
		},
		async providerRequest({ effectRequest, signal }) {
			const attempt = (attempts.get(effectRequest.runSequence) ?? 0) + 1;
			attempts.set(effectRequest.runSequence, attempt);
			return createD726ProviderTurn(
				await invokeD725OpenRouterGraphTurn({
					effectRequest,
					credential: {
						bearerToken: "not-a-live-d727-test-credential",
						credentialBindingRef: "d727.injected",
						credentialBindingRevision: "v1",
					},
					transport: {
						async request() {
							transportCalls += 1;
							const retryable = mode === "untyped-429-then-400" && attempt === 1;
							return {
								status: retryable ? 429 : 400,
								body: new TextEncoder().encode(
									retryable
										? "rate limited"
										: JSON.stringify({ error: { code: "invalid_request" } }),
								),
								retryAfterMs: null,
								retryAfterDisposition: "absent" as const,
							};
						},
					},
					taskStatement: "D727 injected terminal provenance qualification",
					conversation: { messages: [] },
					signal: signal ?? new AbortController().signal,
					monotonicNowMs: () => transportCalls,
				}),
			);
		},
		async retryWait({ effectRequest }) {
			retryWaitCalls += 1;
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: effectRequest.retryAfterMs ?? 60_000,
				result: {
					effectKind: "retry-wait",
					status: "completed",
					evidenceDigest: sha(`d727-retry-wait-${effectRequest.effectSequence}`),
				},
			};
		},
		async toolAction() {
			throw new TypeError("D727 terminal HTTP cannot execute tools");
		},
		async hiddenVerifier() {
			throw new TypeError("D727 terminal HTTP cannot verify");
		},
		async cleanup({ effectRequest }) {
			workspaces.delete(effectRequest.runSequence);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup",
					status: "succeeded",
					evidenceDigest: sha(`d727-http-cleanup-${effectRequest.runSequence}`),
				},
			};
		},
	});
	return {
		adapter,
		workspaces,
		transportCalls: () => transportCalls,
		retryWaitCalls: () => retryWaitCalls,
	};
}

describe("D727 executor-failure provenance and partial evidence", () => {
	it.each([
		"executor-threw",
		"transport-failure",
		"route-evidence-failure",
		"response-decode-failure",
	] as const)("admits %s as Graph executor failure without D724 evidence", async (classification) => {
		const result = await qualified(classification);
		expect(result.providerCalls()).toBeGreaterThan(0);
		expect(result.workspaces.size).toBe(0);
		const providerExecutorFailures = result.bundle.executorFailureFacts.filter(
			(fact) => fact.classification === classification,
		);
		const admissionFailures = result.bundle.executorFailureFacts.filter(
			(fact) => fact.classification === "graph-admission-denied",
		);
		expect(providerExecutorFailures).toHaveLength(result.providerCalls());
		expect(admissionFailures).toHaveLength(1);
		expect(result.bundle.terminalHttpGraphEvidence.facts).toEqual([]);
		expect(result.bundle.terminalReceipt.status).toBe("partial-failure");
		expect(validateD727PartialFailureBundle(result.bundle).bundleDigest).toBe(
			result.bundle.bundleDigest,
		);
	});

	it("rejects substituted executor provenance during canonical replay", async () => {
		const { bundle } = await qualified("transport-failure");
		const forged = structuredClone(bundle) as Record<string, unknown>;
		const facts = forged.executorFailureFacts as Record<string, unknown>[];
		facts[0] = { ...facts[0], classification: "response-decode-failure" };
		expect(() => validateD727PartialFailureBundle(forged)).toThrow();
	});

	it.each([
		"succeeded",
		"failed",
	] as const)("converts a thrown provider executor into Graph provenance and records %s cleanup", async (cleanupStatus) => {
		const fixture = thrownExecutorAdapter(cleanupStatus);
		const bundle = await runD727InjectedNoNetworkQualification({
			adapter: fixture.adapter,
			signal: new AbortController().signal,
		});
		expect(fixture.providerCalls()).toBeGreaterThan(0);
		expect(fixture.workspaces.size).toBe(0);
		expect(
			bundle.executorFailureFacts.some((fact) => fact.classification === "executor-threw"),
		).toBe(true);
		expect(bundle.cleanupFacts.every((fact) => fact.status === cleanupStatus)).toBe(true);
		expect(bundle.terminalHttpGraphEvidence.facts).toEqual([]);
	}, 30_000);

	it.each([
		["terminal-400", 6, 0],
		["untyped-429-then-400", 12, 6],
	] as const)(
		"keeps %s HTTP provenance separate and retry accounting Graph-visible",
		async (mode, expectedTransportCalls, expectedRetryWaitCalls) => {
			const fixture = terminalHttpAdapter(mode);
			const bundle = await runD727InjectedNoNetworkQualification({
				adapter: fixture.adapter,
				signal: new AbortController().signal,
			});
			expect(fixture.transportCalls()).toBe(expectedTransportCalls);
			expect(fixture.retryWaitCalls()).toBe(expectedRetryWaitCalls);
			expect(fixture.workspaces.size).toBe(0);
			expect(bundle.executorFailureFacts).toEqual([]);
			expect(bundle.terminalHttpGraphEvidence.facts).toHaveLength(6);
			expect(validateD727PartialFailureBundle(bundle).bundleDigest).toBe(bundle.bundleDigest);
		},
		30_000,
	);

	it("persists only a partial-failure bundle and rejects replay", async () => {
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d727-persist-"));
		await chmod(root, 0o700);
		const canonicalRoot = await realpath(root);
		try {
			const { bundle } = await qualified();
			const receipt = await persistD727PartialFailureBundle({
				privateRoot: canonicalRoot,
				bundle,
			});
			expect(receipt.generationRef).toBe(D727_GENERATION_REF);
			expect(receipt.artifactDigests).toHaveLength(4);
			const finalRoot = join(root, D727_GENERATION_REF);
			expect((await lstat(finalRoot)).isDirectory()).toBe(true);
			expect((await lstat(join(finalRoot, "commit.v1.json"))).mode & 0o777).toBe(0o600);
			for (const name of [
				"graph-evidence.v1.json",
				"executor-failure-facts.v1.json",
				"terminal-receipt.v1.json",
				"partial-failure-bundle.v1.json",
			])
				expect((await lstat(join(finalRoot, "artifacts", name))).mode & 0o777).toBe(0o600);
			await expect(
				persistD727PartialFailureBundle({ privateRoot: canonicalRoot, bundle }),
			).rejects.toThrow();
			const second = await qualified("transport-failure");
			await expect(
				persistD727PartialFailureBundle({
					privateRoot: canonicalRoot,
					bundle: second.bundle,
				}),
			).rejects.toThrow(/already exists/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);

	it.each([
		"after-write",
		"after-rename",
	] as const)("cleans exact persistence residue after %s failure", async (stage) => {
		const root = await mkdtemp(join(tmpdir(), `graphrefly-d727-${stage}-`));
		await chmod(root, 0o700);
		const canonicalRoot = await realpath(root);
		try {
			const { bundle } = await qualified();
			await expect(
				persistD727PartialFailureBundle({
					privateRoot: canonicalRoot,
					bundle,
					fault: createD727PersistenceFault(stage),
				}),
			).rejects.toThrow();
			await expect(lstat(join(root, D727_GENERATION_REF))).rejects.toMatchObject({
				code: "ENOENT",
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);

	it("keeps canonical evidence material-free", async () => {
		const { bundle } = await qualified("route-evidence-failure");
		const encoded = JSON.stringify(bundle);
		expect(encoded).not.toContain("OPENROUTER_API_KEY");
		expect(encoded).not.toContain("Bearer ");
		expect(encoded).not.toContain("rawBody");
		expect(encoded).not.toContain("toolArguments");
	});
});
