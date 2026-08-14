import { chmod, lstat, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	admitCurrentGraphProviderEffectResult,
	CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE,
	CURRENT_GRAPH_PROVIDER_INJECTED_TASK,
	CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
	createCurrentGraphProviderAuthority,
	takeCurrentGraphProviderEffect,
	validateCurrentGraphProviderEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/current-graph-native-provider-authority.js";
import {
	CURRENT_GRAPH_PROVIDER_IMPLEMENTATION_MANIFEST_DIGEST,
	measureCurrentGraphProviderImplementation,
} from "../../evals/empirical-memory-rerun-avoidance/current-graph-native-provider-implementation-manifest.js";
import {
	createCurrentGraphProviderInjectedBaselineForTest,
	createCurrentGraphProviderPersistenceFaultForTest,
	persistCurrentGraphProviderInjectedTestBundleForTest,
	persistCurrentGraphProviderQualificationBundle,
	runCurrentGraphProviderNoNetworkQualification,
	validateCurrentGraphProviderQualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/current-graph-native-provider-qualification.js";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function privateRoot() {
	const root = await mkdtemp(join(tmpdir(), "graphrefly-current-d2-"));
	await chmod(root, 0o700);
	const canonical = await realpath(root);
	roots.push(canonical);
	return canonical;
}

function digest(value: unknown) {
	return empiricalStrictJsonDigest(value);
}

describe("graphrefly-ts:D2 current Graph-native provider architecture", () => {
	it("qualifies six serial arms with Graph-owned retry, usage and material-free evidence", async () => {
		let networkCalls = 0;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			networkCalls += 1;
			throw new TypeError("network forbidden by current D2 qualification");
		}) as typeof fetch;
		try {
			const bundle = validateCurrentGraphProviderQualificationBundle(
				await runCurrentGraphProviderNoNetworkQualification({
					d1Baseline: createCurrentGraphProviderInjectedBaselineForTest(),
				}),
			);
			expect(networkCalls).toBe(0);
			expect(bundle.mainGraphEvidence.workflowEvidence.runs).toHaveLength(6);
			expect(
				bundle.mainGraphEvidence.workflowEvidence.runs.every((run) => run.status === "completed"),
			).toBe(true);
			expect(bundle.mainGraphEvidence.budget.retryWaits).toBe(1);
			expect(bundle.mainGraphEvidence.budget.providerAttempts).toBe(
				bundle.qualification.providerAttemptCount,
			);
			expect(bundle.qualification).toMatchObject({
				baselineBasis: "injected-test",
				maxActiveEffects: 1,
				adapterEvidenceLedgerPresent: false,
				materialFreeCanonicalProjection: true,
				networkCalls: 0,
				causalAttribution: "undetermined",
				efficacyClaim: "none",
			});
			const serialized = JSON.stringify(bundle);
			for (const forbidden of [
				"OPENROUTER_API_KEY",
				"old-value",
				"new-value",
				"systemInstruction",
				"taskStatement",
				"allowedWorkspacePath",
			])
				expect(serialized).not.toContain(forbidden);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("rejects accessors, request replay and oversized runtime tool arguments before Graph admission", () => {
		const authority = createCurrentGraphProviderAuthority({
			limits: CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
			routeProfile: CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE,
			taskProfile: CURRENT_GRAPH_PROVIDER_INJECTED_TASK,
		});
		const materialization = takeCurrentGraphProviderEffect(authority)!;
		expect(() =>
			admitCurrentGraphProviderEffectResult(authority, materialization.request.requestDigest, {
				effectKind: "materialization",
				status: "completed",
				get workspaceStateDigest() {
					throw new Error("accessor invoked");
				},
				evidenceDigest: digest("accessor"),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			}),
		).toThrow(/own data property/);
		admitCurrentGraphProviderEffectResult(authority, materialization.request.requestDigest, {
			effectKind: "materialization",
			status: "completed",
			workspaceStateDigest: digest("workspace"),
			evidenceDigest: digest("materialized"),
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		});
		expect(() =>
			admitCurrentGraphProviderEffectResult(authority, materialization.request.requestDigest, {
				effectKind: "materialization",
				status: "completed",
				workspaceStateDigest: digest("workspace"),
				evidenceDigest: digest("replay"),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			}),
		).toThrow(/does not match|kind drifted/);
		const provider = takeCurrentGraphProviderEffect(authority)!;
		expect(provider.request.effectKind).toBe("provider-request");
		expect(() =>
			admitCurrentGraphProviderEffectResult(authority, provider.request.requestDigest, {
				effectKind: "provider-request",
				status: "completed",
				toolCalls: [
					{
						toolRef: "replace-exact",
						path: "src/current.ts",
						oldText: "x".repeat(32_769),
						newText: "y",
					},
				],
				failureCode: null,
				retryProposal: null,
				usage: {
					requests: 1,
					inputTokens: 1,
					outputTokens: 1,
					cacheReadTokens: 0,
					actualCostMicrousd: 1,
					actualElapsedMs: 1,
					costBasis: "reported",
				},
				evidenceDigest: digest("oversized"),
			}),
		).toThrow(/byte bound/);
	});

	it("canonical replay rejects coordinated fact substitution", async () => {
		const bundle = await runCurrentGraphProviderNoNetworkQualification({
			d1Baseline: createCurrentGraphProviderInjectedBaselineForTest(),
		});
		const evidence = structuredClone(bundle.mainGraphEvidence);
		const first = evidence.facts[0]!;
		const altered = {
			...first,
			request: { ...first.request, toolArgumentsBytes: first.request.toolArgumentsBytes + 1 },
		};
		const alteredMaterial = { ...altered };
		delete (alteredMaterial as { factDigest?: string }).factDigest;
		(evidence.facts as unknown as Record<number, unknown>)[0] = {
			...altered,
			factDigest: digest(alteredMaterial),
		};
		const evidenceMaterial = { ...evidence };
		delete (evidenceMaterial as { evidenceDigest?: string }).evidenceDigest;
		evidence.evidenceDigest = digest(evidenceMaterial);
		expect(() => validateCurrentGraphProviderEvidence(evidence)).toThrow();
	});

	it("reconciles two fully reserved attempts before releasing the workflow provider fact", () => {
		const authority = createCurrentGraphProviderAuthority({
			limits: CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
			routeProfile: CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE,
			taskProfile: CURRENT_GRAPH_PROVIDER_INJECTED_TASK,
		});
		const materialization = takeCurrentGraphProviderEffect(authority)!;
		admitCurrentGraphProviderEffectResult(authority, materialization.request.requestDigest, {
			effectKind: "materialization",
			status: "completed",
			workspaceStateDigest: digest("fully-reserved-workspace"),
			evidenceDigest: digest("fully-reserved-materialization"),
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		});
		const first = takeCurrentGraphProviderEffect(authority)!;
		const retryAfterMs = 1;
		const proposalMaterial = {
			retryClass: "retryable-transient" as const,
			retryAfterMs,
			requestDigest: first.request.requestDigest,
			logicalRequestDigest: first.request.logicalRequestDigest,
		};
		admitCurrentGraphProviderEffectResult(authority, first.request.requestDigest, {
			effectKind: "provider-request",
			status: "failed",
			toolCalls: [],
			failureCode: "retryable-transient",
			retryProposal: {
				retryClass: "retryable-transient",
				retryAfterMs,
				proposalDigest: digest(proposalMaterial),
			},
			usage: {
				requests: 1,
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				actualCostMicrousd: 100_000,
				actualElapsedMs: 60_000,
				costBasis: "conservative-reservation",
			},
			evidenceDigest: digest("fully-reserved-first"),
		});
		const wait = takeCurrentGraphProviderEffect(authority)!;
		admitCurrentGraphProviderEffectResult(authority, wait.request.requestDigest, {
			effectKind: "retry-wait",
			status: "completed",
			actualElapsedMs: 1,
			evidenceDigest: digest("fully-reserved-wait"),
		});
		const second = takeCurrentGraphProviderEffect(authority)!;
		admitCurrentGraphProviderEffectResult(authority, second.request.requestDigest, {
			effectKind: "provider-request",
			status: "completed",
			toolCalls: [{ toolRef: "read-file", path: "src/current.ts" }],
			failureCode: null,
			retryProposal: null,
			usage: {
				requests: 1,
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				actualCostMicrousd: 100_000,
				actualElapsedMs: 60_000,
				costBasis: "conservative-reservation",
			},
			evidenceDigest: digest("fully-reserved-second"),
		});
		expect(takeCurrentGraphProviderEffect(authority)?.request).toMatchObject({
			effectKind: "tool-action",
			toolRef: "read-file",
		});
	});

	it("keeps injected qualification distinct from production persistence and cleans every injected fault", async () => {
		const productionRoot = await privateRoot();
		const productionBundle = await runCurrentGraphProviderNoNetworkQualification({
			d1Baseline: createCurrentGraphProviderInjectedBaselineForTest(),
		});
		await expect(
			persistCurrentGraphProviderQualificationBundle({
				privateRoot: productionRoot,
				bundle: productionBundle,
			}),
		).rejects.toThrow(/exact D1 artifact/);
		for (const stage of ["after-claim", "after-write", "after-rename", "after-marker"] as const) {
			const root = await privateRoot();
			const bundle = await runCurrentGraphProviderNoNetworkQualification({
				d1Baseline: createCurrentGraphProviderInjectedBaselineForTest(),
			});
			await expect(
				persistCurrentGraphProviderInjectedTestBundleForTest({
					privateRoot: root,
					bundle,
					fault: createCurrentGraphProviderPersistenceFaultForTest(stage),
				}),
			).rejects.toThrow(/injected/);
			expect(await readdir(root)).toEqual([]);
		}
		const root = await privateRoot();
		const bundle = await runCurrentGraphProviderNoNetworkQualification({
			d1Baseline: createCurrentGraphProviderInjectedBaselineForTest(),
		});
		const receipt = await persistCurrentGraphProviderInjectedTestBundleForTest({
			privateRoot: root,
			bundle,
		});
		expect((await lstat(receipt.finalRoot)).mode & 0o777).toBe(0o700);
		expect(receipt.generationRef).toContain("injected-test");
	}, 30_000);

	it("binds qualification to the frozen D2 implementation manifest", async () => {
		expect(await measureCurrentGraphProviderImplementation()).toBe(
			CURRENT_GRAPH_PROVIDER_IMPLEMENTATION_MANIFEST_DIGEST,
		);
	});
});
