import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
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
	consumeD723AdapterReceipt,
	createD723RealProviderAdapter,
	runD723RealProviderAdapter,
} from "../../evals/empirical-memory-rerun-avoidance/d723-graph-native-real-provider.js";
import {
	acquireD723SingleUseDispatchClaimAtRoot,
	consumeD723DispatchClaimForExecution,
	consumeD723ExecutionAuthority,
} from "../../evals/empirical-memory-rerun-avoidance/d723-single-use-dispatch-claim.js";

const evidence = (value: unknown) => empiricalStrictJsonDigest(value);

function fixtureAdapter() {
	const workspaces = new Map<number, string>();
	const model = createD722InjectedModelFixture();
	return createD723RealProviderAdapter({
		executionClass: "injected-no-network",
		async materialization({ effectRequest }) {
			const workspace = evidence({ run: effectRequest.runSequence, state: "base" });
			workspaces.set(effectRequest.runSequence, workspace);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "materialization",
					status: "ready",
					workspaceStateDigest: workspace,
					evidenceDigest: evidence({ effectRequest, ready: true }),
				},
			};
		},
		async providerRequest(input) {
			return {
				actualCostMicrousd: 1,
				actualElapsedMs: 1,
				result: await invokeD722InjectedModelFixture(model, input.effectRequest),
			};
		},
		async retryWait({ effectRequest }) {
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: effectRequest.retryAfterMs ?? 60_000,
				result: {
					effectKind: "retry-wait",
					status: "completed",
					evidenceDigest: evidence({ effectRequest, waited: true }),
				},
			};
		},
		async toolAction({ effectRequest }) {
			const intent = effectRequest.toolIntent!;
			const before = workspaces.get(effectRequest.runSequence)!;
			const after =
				intent.toolRef === "replace-exact"
					? evidence({ before, intent: intent.intentDigest })
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
					evidenceDigest: evidence({ effectRequest, succeeded: true }),
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
					evidenceDigest: evidence({ effectRequest, passed: true }),
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
					evidenceDigest: evidence({ effectRequest, cleaned: true }),
				},
			};
		},
	});
}

describe("D723 Graph-native real-provider adapter boundary", () => {
	it("runs the injected six-arm adapter with Graph-only admissions and reconciliation", async () => {
		const run = await runD723RealProviderAdapter({
			sourceDigest: evidence({ fixture: "d723" }),
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
				routeDigest: evidence({ route: "d723-injected" }),
			},
			adapter: fixtureAdapter(),
		});
		const summary = consumeD723AdapterReceipt(run.receipt, run.core);
		expect(run.core.ledger.completedArms).toHaveLength(6);
		expect(run.core.effectRuns).toHaveLength(6);
		expect(summary.executionClass).toBe("injected-no-network");
		expect(summary.maxActiveInvocations).toBe(1);
		expect(summary.graphAdmittedEffectCount).toBe(summary.graphReconciledEffectCount);
	});

	it("rejects caller accessors before any Graph execution", () => {
		let hits = 0;
		expect(() =>
			createD723RealProviderAdapter({
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

	it("permits exactly one durable cross-process-shaped dispatch consumption", async () => {
		const container = await mkdtemp(join(tmpdir(), "graphrefly-d723-claim-test-"));
		const privateRoot = join(container, "private");
		await import("node:fs/promises").then(({ mkdir }) => mkdir(privateRoot, { mode: 0o700 }));
		await chmod(privateRoot, 0o700);
		try {
			const canonicalPrivateRoot = await realpath(privateRoot);
			const claim = await acquireD723SingleUseDispatchClaimAtRoot(canonicalPrivateRoot);
			await expect(
				acquireD723SingleUseDispatchClaimAtRoot(canonicalPrivateRoot),
			).rejects.toMatchObject({
				code: "EEXIST",
			});
			const authority = await consumeD723DispatchClaimForExecution({
				claim,
				currentKeyAdmissionDigest: evidence({ currentKey: "qualified" }),
				remainingMicrousd: 32_000_000,
			});
			consumeD723ExecutionAuthority(authority);
			await expect(
				consumeD723DispatchClaimForExecution({
					claim,
					currentKeyAdmissionDigest: evidence({ currentKey: "qualified" }),
					remainingMicrousd: 32_000_000,
				}),
			).rejects.toThrow(/not fresh/);
		} finally {
			await rm(container, { recursive: true, force: true });
		}
	});
});
