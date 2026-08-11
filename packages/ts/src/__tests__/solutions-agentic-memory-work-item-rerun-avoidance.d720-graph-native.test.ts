import { chmod, lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	empiricalStrictJsonDigest,
	strictSnapshot,
} from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	admitD719CleanGraphArmResult,
	createD719CleanEffectController,
	createD719CleanGraphLedger,
	D719_CLEAN_GRAPH_ARM_ORDER,
	reconcileD719CleanGraphEffect,
	requestD719CleanGraphEffect,
	takeNextD719CleanGraphRequest,
} from "../../evals/empirical-memory-rerun-avoidance/d719-clean-graph-ledger.js";
import {
	createD720SimulatedCallerExecutor,
	persistD720GraphNativeEvalBundle,
	runD720GraphNativeEval,
	validateD720GraphNativeEvalBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d720-graph-native-eval.js";

const SOURCE_DIGEST = empiricalStrictJsonDigest({ fixture: "d720-clean-graph-native" });
const BUDGET_LIMITS = Object.freeze({
	maxRequests: 100,
	maxRetryWaits: 10,
	maxCostMicrousd: 10_000,
	maxElapsedMs: 100_000,
});

function callerResult(
	phase:
		| "inspection"
		| "exact-mutation"
		| "workspace-diff"
		| "focused-validation-attempted"
		| "focused-validation-passed"
		| "hidden-verifier-attempted"
		| "hidden-verifier-passed",
	overrides: {
		readonly cancelled?: boolean;
		readonly cleanupFailed?: boolean;
		readonly materializationFailed?: boolean;
	} = {},
) {
	const ordinal = [
		"inspection",
		"exact-mutation",
		"workspace-diff",
		"focused-validation-attempted",
		"focused-validation-passed",
		"hidden-verifier-attempted",
		"hidden-verifier-passed",
	].indexOf(phase);
	return Object.freeze({
		materialization: Object.freeze({
			status: overrides.materializationFailed ? ("failed" as const) : ("ready" as const),
			evidenceDigest: empiricalStrictJsonDigest({ phase, materialization: true }),
		}),
		execution: Object.freeze({
			traceComplete: true,
			inspectionObserved: ordinal >= 0,
			contentChangingMutationObserved: ordinal >= 1,
			nonEmptyDiffAfterLatestMutation: ordinal >= 2,
			focusedValidationAttempted: ordinal >= 3,
			focusedValidationPassed: ordinal >= 4,
			hiddenVerifierAttempted: ordinal >= 5,
			hiddenVerifierPassed: ordinal >= 6,
			cancelled: overrides.cancelled ?? false,
		}),
		cleanup: Object.freeze({
			status: overrides.cleanupFailed ? ("failed" as const) : ("succeeded" as const),
			evidenceDigest: empiricalStrictJsonDigest({ phase, cleanup: true }),
		}),
	});
}

function performProviderEffect(
	effects: Parameters<typeof requestD719CleanGraphEffect>[0],
	input: { readonly cost?: number; readonly elapsed?: number; readonly logical?: string } = {},
) {
	const cost = input.cost ?? 25;
	const elapsed = input.elapsed ?? 100;
	const admission = requestD719CleanGraphEffect(effects, {
		effectKind: "provider-request",
		logicalRequestDigest: empiricalStrictJsonDigest({ logical: input.logical ?? "primary" }),
		routeDigest: empiricalStrictJsonDigest({ route: "simulated" }),
		attemptOrdinal: 1,
		retryReason: "none",
		retryAfterMs: null,
		maxCostMicrousd: cost,
		maxElapsedMs: elapsed,
	});
	if (admission.admitted) {
		reconcileD719CleanGraphEffect(effects, admission, {
			actualCostMicrousd: cost,
			actualElapsedMs: elapsed,
			outcome: "completed",
		});
	}
	return admission;
}

describe("D720 clean Graph-native eval", () => {
	it("uses Graph admission for all six arms and emits no legacy observation stack", async () => {
		const invoked: string[] = [];
		let active = 0;
		let maxActive = 0;
		const primaryPhases = [
			"inspection",
			"hidden-verifier-passed",
			"exact-mutation",
			"workspace-diff",
			"focused-validation-attempted",
			"hidden-verifier-attempted",
		] as const;
		const executor = createD720SimulatedCallerExecutor(async ({ effects, request }) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			const arm = request.input?.value?.arm;
			const sequence = request.input?.value?.armSequence;
			const runKind = request.input?.value?.runKind;
			expect(arm).toBe(D719_CLEAN_GRAPH_ARM_ORDER[sequence ?? 0]);
			invoked.push(`${arm}:${runKind}`);
			performProviderEffect(effects, { logical: `${arm}:${runKind}` });
			active -= 1;
			return callerResult(
				runKind === "recovery"
					? "hidden-verifier-passed"
					: (primaryPhases[sequence ?? 0] ?? "inspection"),
			);
		});

		const bundle = await runD720GraphNativeEval({
			sourceDigest: SOURCE_DIGEST,
			budgetLimits: BUDGET_LIMITS,
			executor,
		});
		const validated = validateD720GraphNativeEvalBundle(bundle);

		expect(invoked).toEqual([
			"cold:primary",
			"cold:recovery",
			"relevant-applied:primary",
			"proposal-only:primary",
			"proposal-only:recovery",
			"admission-rejected:primary",
			"admission-rejected:recovery",
			"irrelevant-applied:primary",
			"irrelevant-applied:recovery",
			"wrong-scope-applied:primary",
			"wrong-scope-applied:recovery",
		]);
		expect(maxActive).toBe(1);
		expect(validated.runStatus).toBe("complete");
		expect(
			validated.graphEvidence.issuedRequests
				.filter((request) => request.input?.value?.runKind === "primary")
				.map((request) => request.input?.value?.arm),
		).toEqual(D719_CLEAN_GRAPH_ARM_ORDER);
		expect(validated.graphEvidence.completedArms).toEqual(D719_CLEAN_GRAPH_ARM_ORDER);
		expect(validated.graphEvidence.decisions[0]?.nextRequiredPhase).toBe("exact-mutation");
		expect(validated.graphEvidence.decisions[1]?.fullTaskCompleted).toBe(true);
		expect(validated.graphEvidence.effectReconciliations).toHaveLength(11);
		expect(validated.graphEvidence.maxActiveArms).toBe(1);
		expect(validated.causalAttribution).toBe("undetermined");
		expect(validated.efficacyClaim).toBe("none");
		for (const forbidden of ["observation", "scorecard", "generation"]) {
			expect(Object.hasOwn(validated, forbidden)).toBe(false);
		}
	});

	it("lets Graph stop on budget and cleanup facts without caller-selected arm control", async () => {
		const budgetArms: string[] = [];
		const budgetBundle = await runD720GraphNativeEval({
			sourceDigest: SOURCE_DIGEST,
			budgetLimits: BUDGET_LIMITS,
			executor: createD720SimulatedCallerExecutor(async ({ effects, request }) => {
				budgetArms.push(request.input?.value?.arm ?? "missing");
				const admission = performProviderEffect(effects, {
					cost: BUDGET_LIMITS.maxCostMicrousd + 1,
				});
				expect(admission.admitted).toBe(false);
				return callerResult("inspection");
			}),
		});
		expect(budgetArms).toEqual(["cold"]);
		expect(budgetBundle.runStatus).toBe("stopped");
		expect(budgetBundle.graphEvidence.decisions[0]?.stoppedReason).toBe("budget-exhausted");
		expect(budgetBundle.graphEvidence.decisions[0]?.budgetReasons).toEqual(["cost-limit"]);
		expect(budgetBundle.graphEvidence.findings[0]?.code).toBe("budget-exhausted");

		const cumulativeArms: string[] = [];
		const cumulativeBundle = await runD720GraphNativeEval({
			sourceDigest: SOURCE_DIGEST,
			budgetLimits: { ...BUDGET_LIMITS, maxCostMicrousd: 40 },
			executor: createD720SimulatedCallerExecutor(async ({ effects, request }) => {
				cumulativeArms.push(request.input?.value?.arm ?? "missing");
				performProviderEffect(effects);
				return callerResult("inspection");
			}),
		});
		expect(cumulativeArms).toEqual(["cold", "cold"]);
		expect(cumulativeBundle.graphEvidence.decisions[1]?.budgetState.costMicrousd).toBe(25);
		expect(cumulativeBundle.graphEvidence.decisions[1]?.budgetReasons).toEqual(["cost-limit"]);

		const cleanupBundle = await runD720GraphNativeEval({
			sourceDigest: SOURCE_DIGEST,
			budgetLimits: BUDGET_LIMITS,
			executor: createD720SimulatedCallerExecutor(async ({ effects }) => {
				performProviderEffect(effects);
				return callerResult("workspace-diff", { cleanupFailed: true });
			}),
		});
		expect(cleanupBundle.graphEvidence.completedArms).toEqual([]);
		expect(cleanupBundle.graphEvidence.decisions[0]?.stoppedReason).toBe(
			"workspace-cleanup-failed",
		);
		expect(cleanupBundle.graphEvidence.findings[0]?.code).toBe("cleanup-failed");
	});

	it("rejects stale AgentRequest provenance before admitting caller evidence", () => {
		const ledger = createD719CleanGraphLedger({
			sourceDigest: SOURCE_DIGEST,
			budgetLimits: BUDGET_LIMITS,
		});
		const request = takeNextD719CleanGraphRequest(ledger);
		expect(request).not.toBeNull();
		const clone = strictSnapshot(request);
		expect(() =>
			admitD719CleanGraphArmResult(ledger, clone as never, callerResult("inspection")),
		).toThrow(/exact active AgentRequest/);
		const effects = createD719CleanEffectController(ledger, request as never);
		performProviderEffect(effects);
		expect(
			admitD719CleanGraphArmResult(ledger, request as never, callerResult("inspection")).arm,
		).toBe("cold");
	});

	it("makes retry admission and executor failures Graph-visible before stopping", async () => {
		const retryBundle = await runD720GraphNativeEval({
			sourceDigest: SOURCE_DIGEST,
			budgetLimits: BUDGET_LIMITS,
			executor: createD720SimulatedCallerExecutor(async ({ effects }) => {
				const logicalRequestDigest = empiricalStrictJsonDigest({ logical: "retry-case" });
				const routeDigest = empiricalStrictJsonDigest({ route: "simulated" });
				const first = requestD719CleanGraphEffect(effects, {
					effectKind: "provider-request",
					logicalRequestDigest,
					routeDigest,
					attemptOrdinal: 1,
					retryReason: "none",
					retryAfterMs: null,
					maxCostMicrousd: 10,
					maxElapsedMs: 50,
				});
				reconcileD719CleanGraphEffect(effects, first, {
					actualCostMicrousd: 10,
					actualElapsedMs: 50,
					outcome: "failed",
					failureDiscriminator: "d671-provider-overloaded",
				});
				const wait = requestD719CleanGraphEffect(effects, {
					effectKind: "retry-wait",
					logicalRequestDigest,
					routeDigest,
					attemptOrdinal: 2,
					retryReason: "d671-provider-overloaded",
					retryAfterMs: null,
					maxCostMicrousd: 0,
					maxElapsedMs: 5_000,
				});
				reconcileD719CleanGraphEffect(effects, wait, {
					actualCostMicrousd: 0,
					actualElapsedMs: 5_000,
					outcome: "completed",
				});
				const second = requestD719CleanGraphEffect(effects, {
					effectKind: "provider-request",
					logicalRequestDigest,
					routeDigest,
					attemptOrdinal: 2,
					retryReason: "d671-provider-overloaded",
					retryAfterMs: null,
					maxCostMicrousd: 10,
					maxElapsedMs: 50,
				});
				reconcileD719CleanGraphEffect(effects, second, {
					actualCostMicrousd: 10,
					actualElapsedMs: 50,
					outcome: "completed",
				});
				return callerResult("hidden-verifier-passed");
			}),
		});
		expect(
			retryBundle.graphEvidence.effectAdmissions.slice(0, 3).map((fact) => fact.admitted),
		).toEqual([true, true, true]);
		expect(retryBundle.graphEvidence.decisions[0]?.budgetState).toMatchObject({
			requests: 2,
			retryWaits: 1,
		});

		const failureBundle = await runD720GraphNativeEval({
			sourceDigest: SOURCE_DIGEST,
			budgetLimits: BUDGET_LIMITS,
			executor: createD720SimulatedCallerExecutor(async ({ effects }) => {
				const admission = requestD719CleanGraphEffect(effects, {
					effectKind: "provider-request",
					logicalRequestDigest: empiricalStrictJsonDigest({ logical: "throw" }),
					routeDigest: empiricalStrictJsonDigest({ route: "simulated" }),
					attemptOrdinal: 1,
					retryReason: "none",
					retryAfterMs: null,
					maxCostMicrousd: 50,
					maxElapsedMs: 100,
				});
				expect(admission.admitted).toBe(true);
				throw new Error("private executor detail must not persist");
			}),
		});
		expect(failureBundle.runStatus).toBe("stopped");
		expect(failureBundle.graphEvidence.facts[0]?.kind).toBe("arm-executor-failed");
		expect(failureBundle.graphEvidence.decisions[0]?.stoppedReason).toBe("executor-failed");
		expect(failureBundle.graphEvidence.effectReconciliations[0]?.basis).toBe(
			"conservative-reservation",
		);
		expect(JSON.stringify(failureBundle)).not.toContain("private executor detail");
	});

	it("does not call a stopped sixth-arm run complete", async () => {
		const bundle = await runD720GraphNativeEval({
			sourceDigest: SOURCE_DIGEST,
			budgetLimits: BUDGET_LIMITS,
			executor: createD720SimulatedCallerExecutor(async ({ effects, request }) => {
				performProviderEffect(effects, { logical: request.input?.value?.arm });
				return callerResult("hidden-verifier-passed", {
					cleanupFailed: request.input?.value?.arm === "wrong-scope-applied",
				});
			}),
		});
		expect(bundle.graphEvidence.facts).toHaveLength(6);
		expect(bundle.graphEvidence.completedArms).toHaveLength(5);
		expect(bundle.runStatus).toBe("stopped");
		expect(bundle.graphEvidence.decisions.at(-1)?.stoppedReason).toBe("workspace-cleanup-failed");
	});

	it("does not borrow retry authority across Graph-issued arm requests", async () => {
		const logicalRequestDigest = empiricalStrictJsonDigest({ logical: "cross-arm" });
		const routeDigest = empiricalStrictJsonDigest({ route: "simulated" });
		const bundle = await runD720GraphNativeEval({
			sourceDigest: SOURCE_DIGEST,
			budgetLimits: BUDGET_LIMITS,
			executor: createD720SimulatedCallerExecutor(async ({ effects, request }) => {
				if (request.input?.value?.arm === "cold") {
					const first = requestD719CleanGraphEffect(effects, {
						effectKind: "provider-request",
						logicalRequestDigest,
						routeDigest,
						attemptOrdinal: 1,
						retryReason: "none",
						retryAfterMs: null,
						maxCostMicrousd: 10,
						maxElapsedMs: 10,
					});
					reconcileD719CleanGraphEffect(effects, first, {
						actualCostMicrousd: 10,
						actualElapsedMs: 10,
						outcome: "failed",
						failureDiscriminator: "d671-provider-overloaded",
					});
				} else {
					const borrowed = requestD719CleanGraphEffect(effects, {
						effectKind: "retry-wait",
						logicalRequestDigest,
						routeDigest,
						attemptOrdinal: 2,
						retryReason: "d671-provider-overloaded",
						retryAfterMs: null,
						maxCostMicrousd: 0,
						maxElapsedMs: 10,
					});
					expect(borrowed.admitted).toBe(false);
				}
				return callerResult("hidden-verifier-passed");
			}),
		});
		expect(bundle.graphEvidence.completedArms).toEqual(["cold"]);
		expect(bundle.graphEvidence.decisions[1]?.stoppedReason).toBe("retry-denied");
	});

	it("enforces D675/D710 attempt and wait ceilings in Graph admission", async () => {
		const d710 = await runD720GraphNativeEval({
			sourceDigest: SOURCE_DIGEST,
			budgetLimits: BUDGET_LIMITS,
			executor: createD720SimulatedCallerExecutor(async ({ effects }) => {
				const logicalRequestDigest = empiricalStrictJsonDigest({ logical: "d710" });
				const routeDigest = empiricalStrictJsonDigest({ route: "simulated" });
				const first = requestD719CleanGraphEffect(effects, {
					effectKind: "provider-request",
					logicalRequestDigest,
					routeDigest,
					attemptOrdinal: 1,
					retryReason: "none",
					retryAfterMs: null,
					maxCostMicrousd: 1,
					maxElapsedMs: 1,
				});
				reconcileD719CleanGraphEffect(effects, first, {
					actualCostMicrousd: 1,
					actualElapsedMs: 1,
					outcome: "failed",
					failureDiscriminator: "d710-untyped-http-429",
				});
				const tooShort = requestD719CleanGraphEffect(effects, {
					effectKind: "retry-wait",
					logicalRequestDigest,
					routeDigest,
					attemptOrdinal: 2,
					retryReason: "d710-untyped-http-429",
					retryAfterMs: null,
					maxCostMicrousd: 0,
					maxElapsedMs: 59_999,
				});
				expect(tooShort.admitted).toBe(false);
				return callerResult("hidden-verifier-passed");
			}),
		});
		expect(d710.graphEvidence.decisions[0]?.stoppedReason).toBe("retry-denied");

		const d675 = await runD720GraphNativeEval({
			sourceDigest: SOURCE_DIGEST,
			budgetLimits: BUDGET_LIMITS,
			executor: createD720SimulatedCallerExecutor(async ({ effects }) => {
				const logicalRequestDigest = empiricalStrictJsonDigest({ logical: "d675" });
				const routeDigest = empiricalStrictJsonDigest({ route: "simulated" });
				const first = requestD719CleanGraphEffect(effects, {
					effectKind: "provider-request",
					logicalRequestDigest,
					routeDigest,
					attemptOrdinal: 1,
					retryReason: "none",
					retryAfterMs: null,
					maxCostMicrousd: 1,
					maxElapsedMs: 1,
				});
				reconcileD719CleanGraphEffect(effects, first, {
					actualCostMicrousd: 1,
					actualElapsedMs: 1,
					outcome: "failed",
					failureDiscriminator: "d675-und-err-socket",
				});
				const wait = requestD719CleanGraphEffect(effects, {
					effectKind: "retry-wait",
					logicalRequestDigest,
					routeDigest,
					attemptOrdinal: 2,
					retryReason: "d675-und-err-socket",
					retryAfterMs: null,
					maxCostMicrousd: 0,
					maxElapsedMs: 0,
				});
				reconcileD719CleanGraphEffect(effects, wait, {
					actualCostMicrousd: 0,
					actualElapsedMs: 0,
					outcome: "completed",
				});
				const second = requestD719CleanGraphEffect(effects, {
					effectKind: "provider-request",
					logicalRequestDigest,
					routeDigest,
					attemptOrdinal: 2,
					retryReason: "d675-und-err-socket",
					retryAfterMs: null,
					maxCostMicrousd: 1,
					maxElapsedMs: 1,
				});
				reconcileD719CleanGraphEffect(effects, second, {
					actualCostMicrousd: 1,
					actualElapsedMs: 1,
					outcome: "failed",
					failureDiscriminator: "d675-und-err-socket",
				});
				const forbiddenThird = requestD719CleanGraphEffect(effects, {
					effectKind: "retry-wait",
					logicalRequestDigest,
					routeDigest,
					attemptOrdinal: 3,
					retryReason: "d675-und-err-socket",
					retryAfterMs: null,
					maxCostMicrousd: 0,
					maxElapsedMs: 0,
				});
				expect(forbiddenThird.admitted).toBe(false);
				return callerResult("hidden-verifier-passed");
			}),
		});
		expect(d675.graphEvidence.decisions[0]?.stoppedReason).toBe("retry-denied");
	});

	it("admits cancellation before executor effects and records measured reservation overruns", async () => {
		const controller = new AbortController();
		controller.abort();
		let invocations = 0;
		const cancelled = await runD720GraphNativeEval({
			sourceDigest: SOURCE_DIGEST,
			budgetLimits: BUDGET_LIMITS,
			signal: controller.signal,
			executor: createD720SimulatedCallerExecutor(async () => {
				invocations += 1;
				return callerResult("hidden-verifier-passed");
			}),
		});
		expect(invocations).toBe(0);
		expect(cancelled.graphEvidence.facts[0]?.kind).toBe("arm-execution-cancelled");
		expect(cancelled.graphEvidence.decisions[0]?.stoppedReason).toBe("cancelled");
		const duringController = new AbortController();
		const cancelledDuringResolution = await runD720GraphNativeEval({
			sourceDigest: SOURCE_DIGEST,
			budgetLimits: BUDGET_LIMITS,
			signal: duringController.signal,
			executor: createD720SimulatedCallerExecutor(async () => {
				duringController.abort();
				return callerResult("hidden-verifier-passed");
			}),
		});
		expect(cancelledDuringResolution.graphEvidence.facts[0]?.kind).toBe("arm-execution-cancelled");
		expect(cancelledDuringResolution.graphEvidence.completedArms).toEqual([]);

		const overrun = await runD720GraphNativeEval({
			sourceDigest: SOURCE_DIGEST,
			budgetLimits: BUDGET_LIMITS,
			executor: createD720SimulatedCallerExecutor(async ({ effects }) => {
				const admission = requestD719CleanGraphEffect(effects, {
					effectKind: "provider-request",
					logicalRequestDigest: empiricalStrictJsonDigest({ logical: "overrun" }),
					routeDigest: empiricalStrictJsonDigest({ route: "simulated" }),
					attemptOrdinal: 1,
					retryReason: "none",
					retryAfterMs: null,
					maxCostMicrousd: 1,
					maxElapsedMs: 1,
				});
				reconcileD719CleanGraphEffect(effects, admission, {
					actualCostMicrousd: 5,
					actualElapsedMs: 8,
					outcome: "completed",
				});
				return callerResult("hidden-verifier-passed");
			}),
		});
		expect(overrun.graphEvidence.effectReconciliations[0]).toMatchObject({
			actualCostMicrousd: 5,
			actualElapsedMs: 8,
			reservationExceeded: true,
		});
		expect(overrun.graphEvidence.decisions[0]?.stoppedReason).toBe("budget-exhausted");
	});

	it("persists only Graph evidence/findings/bundle atomically as 0600 artifacts", async () => {
		const privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d720-private-")));
		await chmod(privateRoot, 0o700);
		try {
			const bundle = await runD720GraphNativeEval({
				sourceDigest: SOURCE_DIGEST,
				budgetLimits: BUDGET_LIMITS,
				executor: createD720SimulatedCallerExecutor(async ({ effects }) => {
					performProviderEffect(effects);
					return callerResult("hidden-verifier-passed");
				}),
			});
			const receipt = await persistD720GraphNativeEvalBundle({
				privateRoot,
				bundleRef: "d720-six-arm-no-network",
				bundle,
			});
			const root = join(privateRoot, "d720-six-arm-no-network");
			const artifactsRoot = join(root, "artifacts");
			const names = ["eval-bundle.v1.json", "graph-evidence.v1.json", "harness-findings.v1.json"];
			for (const name of names) {
				expect((await lstat(join(artifactsRoot, name))).mode & 0o777).toBe(0o600);
			}
			expect((await lstat(join(root, "commit.v1.json"))).mode & 0o777).toBe(0o600);
			const serialized = await readFile(join(artifactsRoot, "eval-bundle.v1.json"), "utf8");
			expect(serialized).not.toContain("observation");
			expect(serialized).not.toContain("scorecard");
			expect(serialized).not.toContain("generation");
			expect(receipt.bundleDigest).toBe(bundle.bundleDigest);
			await expect(
				persistD720GraphNativeEvalBundle({
					privateRoot,
					bundleRef: "d720-six-arm-no-network",
					bundle,
				}),
			).rejects.toThrow(/already exists/);
			expect((await lstat(root)).isDirectory()).toBe(true);
			const contenders = await Promise.allSettled([
				persistD720GraphNativeEvalBundle({
					privateRoot,
					bundleRef: "d720-concurrent-claim",
					bundle,
				}),
				persistD720GraphNativeEvalBundle({
					privateRoot,
					bundleRef: "d720-concurrent-claim",
					bundle,
				}),
			]);
			expect(contenders.filter((result) => result.status === "fulfilled")).toHaveLength(1);
			expect(contenders.filter((result) => result.status === "rejected")).toHaveLength(1);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	});

	it("rejects legacy-shaped or accessor-authored bundles", async () => {
		const bundle = await runD720GraphNativeEval({
			sourceDigest: SOURCE_DIGEST,
			budgetLimits: BUDGET_LIMITS,
			executor: createD720SimulatedCallerExecutor(async ({ effects }) => {
				performProviderEffect(effects);
				return callerResult("hidden-verifier-passed");
			}),
		});
		expect(() => validateD720GraphNativeEvalBundle({ ...bundle, observation: {} })).toThrow(
			/unexpected keys/,
		);
		let getterHits = 0;
		const accessor = Object.defineProperty({}, "schemaVersion", {
			enumerable: true,
			get() {
				getterHits += 1;
				return bundle.schemaVersion;
			},
		});
		expect(() => validateD720GraphNativeEvalBundle(accessor)).toThrow(/own data property/);
		expect(getterHits).toBe(0);
	});
});
