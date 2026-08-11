import { lstat, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import type { D720ToolIntentV1 } from "../../evals/empirical-memory-rerun-avoidance/d720-graph-native-effect-runtime.js";
import {
	createD720SimulatedCallerExecutor,
	persistD720GraphNativeEvalBundle,
	runD720GraphNativeEval,
	validateD720GraphNativeEvalBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d720-graph-native-eval.js";
import { strictJsonCodec } from "../json/codec.js";

const sourceDigest = empiricalStrictJsonDigest({ fixture: "d720-full-graph-native" });
const routeDigest = empiricalStrictJsonDigest({ route: "injected-provider/no-network" });
const budgetLimits = Object.freeze({
	maxRequests: 64,
	maxRetryWaits: 16,
	maxCostMicrousd: 100_000,
	maxElapsedMs: 2_000_000,
});
const effectCeilings = Object.freeze({
	routeDigest,
	providerMaxCostMicrousd: 1_000,
	providerMaxElapsedMs: 30_000,
	localEffectMaxElapsedMs: 120_000,
});

function evidence(value: unknown): string {
	return empiricalStrictJsonDigest(value);
}

function canonicalToolIntents(runSequence: number): readonly D720ToolIntentV1[] {
	return Object.freeze(
		(["read-file", "replace-exact", "workspace-diff", "focused-validation"] as const).map(
			(toolRef, index) =>
				Object.freeze({
					toolRef,
					intentDigest: evidence({ runSequence, toolRef, index }),
				}),
		),
	);
}

function completeExecutor(input?: {
	readonly retryFirstProvider?: boolean;
	readonly verifierStatus?: "passed" | "failed";
	readonly cleanupStatus?: "succeeded" | "failed";
	readonly throwToolRef?: D720ToolIntentV1["toolRef"];
	readonly abortOnEffectKind?: "materialization" | "provider-request" | "cleanup";
	readonly abortController?: AbortController;
	readonly primaryInspectionOnly?: boolean;
	readonly failMaterialization?: boolean;
	readonly driftToolRef?: D720ToolIntentV1["toolRef"];
	readonly alwaysRetryReason?:
		| "d671-provider-overloaded"
		| "d675-und-err-socket"
		| "d710-untyped-http-429";
}) {
	const failedLogicalRequests = new Set<string>();
	const workspaceStates = new Map<number, string>();
	let active = 0;
	let maxActive = 0;
	let calls = 0;
	const executor = createD720SimulatedCallerExecutor(async ({ effectRequest }) => {
		active += 1;
		maxActive = Math.max(maxActive, active);
		calls += 1;
		try {
			const common = { actualCostMicrousd: 0, actualElapsedMs: 1 };
			if (effectRequest.effectKind === input?.abortOnEffectKind) input.abortController?.abort();
			if (effectRequest.effectKind === "materialization") {
				const status = input?.failMaterialization === true ? "failed" : "ready";
				const workspaceStateDigest =
					status === "ready"
						? evidence({ runSequence: effectRequest.runSequence, workspace: "baseline" })
						: null;
				if (workspaceStateDigest !== null)
					workspaceStates.set(effectRequest.runSequence, workspaceStateDigest);
				return {
					...common,
					result: {
						effectKind: "materialization" as const,
						status,
						workspaceStateDigest,
						evidenceDigest: evidence({ effectRequest, status }),
					},
				};
			}
			if (effectRequest.effectKind === "provider-request") {
				if (input?.alwaysRetryReason !== undefined) {
					return {
						actualCostMicrousd: 7,
						actualElapsedMs: 2,
						result: {
							effectKind: "provider-request" as const,
							status: "retryable-failure" as const,
							toolIntents: Object.freeze([]),
							failureDiscriminator: input.alwaysRetryReason,
							retryAfterMs: null,
							workspaceStateDigest: workspaceStates.get(effectRequest.runSequence)!,
							evidenceDigest: evidence({ effectRequest, status: input.alwaysRetryReason }),
						},
					};
				}
				if (
					input?.retryFirstProvider === true &&
					effectRequest.attemptOrdinal === 1 &&
					!failedLogicalRequests.has(effectRequest.logicalRequestDigest)
				) {
					failedLogicalRequests.add(effectRequest.logicalRequestDigest);
					return {
						actualCostMicrousd: 7,
						actualElapsedMs: 2,
						result: {
							effectKind: "provider-request" as const,
							status: "retryable-failure" as const,
							toolIntents: Object.freeze([]),
							failureDiscriminator: "d710-untyped-http-429" as const,
							retryAfterMs: null,
							workspaceStateDigest: workspaceStates.get(effectRequest.runSequence)!,
							evidenceDigest: evidence({ effectRequest, status: "untyped-429" }),
						},
					};
				}
				const firstTurn = effectRequest.phaseBefore === "none";
				const primaryInspectionOnly =
					input?.primaryInspectionOnly === true && effectRequest.runSequence % 2 === 0;
				return {
					actualCostMicrousd: 11,
					actualElapsedMs: 3,
					result: {
						effectKind: "provider-request" as const,
						status: firstTurn ? ("tool-intents" as const) : ("structured-final" as const),
						toolIntents: firstTurn
							? primaryInspectionOnly
								? Object.freeze([canonicalToolIntents(effectRequest.runSequence)[0]!])
								: canonicalToolIntents(effectRequest.runSequence)
							: Object.freeze([]),
						failureDiscriminator: "none" as const,
						retryAfterMs: null,
						workspaceStateDigest: workspaceStates.get(effectRequest.runSequence)!,
						evidenceDigest: evidence({ effectRequest, status: firstTurn ? "tools" : "final" }),
					},
				};
			}
			if (effectRequest.effectKind === "retry-wait") {
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 60_000,
					result: {
						effectKind: "retry-wait" as const,
						status: "completed" as const,
						evidenceDigest: evidence({ effectRequest, status: "waited" }),
					},
				};
			}
			if (effectRequest.effectKind === "tool-action") {
				const toolIntent = effectRequest.toolIntent;
				if (toolIntent === null) throw new Error("missing tool intent");
				if (toolIntent.toolRef === input?.throwToolRef) throw new Error("injected tool failure");
				const workspaceStateBeforeDigest = workspaceStates.get(effectRequest.runSequence)!;
				const workspaceStateAfterDigest =
					toolIntent.toolRef === "replace-exact"
						? evidence({ workspaceStateBeforeDigest, mutation: toolIntent.intentDigest })
						: toolIntent.toolRef === input?.driftToolRef
							? evidence({ workspaceStateBeforeDigest, unexpectedDrift: toolIntent.intentDigest })
							: workspaceStateBeforeDigest;
				workspaceStates.set(effectRequest.runSequence, workspaceStateAfterDigest);
				return {
					...common,
					result: {
						effectKind: "tool-action" as const,
						toolRef: toolIntent.toolRef,
						intentDigest: toolIntent.intentDigest,
						status: "succeeded" as const,
						nonEmptyDiff: toolIntent.toolRef === "workspace-diff",
						workspaceStateBeforeDigest,
						workspaceStateAfterDigest,
						evidenceDigest: evidence({ effectRequest, status: "tool-succeeded" }),
					},
				};
			}
			if (effectRequest.effectKind === "hidden-verifier") {
				const status = input?.verifierStatus ?? "passed";
				return {
					...common,
					result: {
						effectKind: "hidden-verifier" as const,
						status,
						workspaceStateDigest: workspaceStates.get(effectRequest.runSequence)!,
						evidenceDigest: evidence({ effectRequest, status }),
					},
				};
			}
			const status = input?.cleanupStatus ?? "succeeded";
			return {
				...common,
				result: {
					effectKind: "cleanup" as const,
					status,
					evidenceDigest: evidence({ effectRequest, status }),
				},
			};
		} finally {
			active -= 1;
		}
	});
	return { executor, calls: () => calls, maxActive: () => maxActive };
}

describe("D720 full Graph-native eval replacement", () => {
	it("runs all six arms through Graph-issued effects with no legacy observation stack", async () => {
		const fixture = completeExecutor();
		const bundle = await runD720GraphNativeEval({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			executor: fixture.executor,
		});
		const validated = validateD720GraphNativeEvalBundle(bundle);
		expect(validated.runStatus).toBe("complete");
		expect(validated.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(validated.graphEvidence.effectRuns).toHaveLength(6);
		expect(validated.graphEvidence.effectRuns.every((run) => run.facts.length === 9)).toBe(true);
		expect(validated.graphEvidence.ledger.effectProposals).toHaveLength(54);
		expect(validated.graphEvidence.ledger.effectAdmissions.every((fact) => fact.admitted)).toBe(
			true,
		);
		expect(fixture.calls()).toBe(54);
		expect(fixture.maxActive()).toBe(1);
		expect("observation" in validated).toBe(false);
		expect("scorecard" in validated).toBe(false);
		expect("generation" in validated).toBe(false);
	});

	it("keeps provider retry and wait admission in the same Graph ledger", async () => {
		const fixture = completeExecutor({ retryFirstProvider: true });
		const bundle = await runD720GraphNativeEval({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			executor: fixture.executor,
		});
		expect(bundle.runStatus).toBe("complete");
		expect(
			bundle.graphEvidence.ledger.effectProposals.filter(
				(fact) => fact.effectKind === "retry-wait",
			),
		).toHaveLength(12);
		expect(
			bundle.graphEvidence.ledger.effectReconciliations.filter(
				(fact) => fact.outcome === "retryable-failure",
			),
		).toHaveLength(12);
		expect(
			bundle.graphEvidence.ledger.decisions.every((decision) => decision.retryWithinBound),
		).toBe(true);
	});

	it("freezes the D671/D675/D710 retry cardinalities in Graph decisions", async () => {
		for (const [reason, expectedAttempts, expectedWaits] of [
			["d671-provider-overloaded", 3, 2],
			["d675-und-err-socket", 2, 1],
			["d710-untyped-http-429", 2, 1],
		] as const) {
			const bundle = await runD720GraphNativeEval({
				sourceDigest,
				budgetLimits,
				effectCeilings,
				executor: completeExecutor({ alwaysRetryReason: reason }).executor,
			});
			expect(bundle.runStatus).toBe("stopped");
			expect(
				bundle.graphEvidence.ledger.effectProposals.filter(
					(proposal) => proposal.effectKind === "provider-request",
				),
			).toHaveLength(expectedAttempts);
			expect(
				bundle.graphEvidence.ledger.effectProposals.filter(
					(proposal) => proposal.effectKind === "retry-wait",
				),
			).toHaveLength(expectedWaits);
		}
	});

	it("derives verifier failure and cleanup failure from admitted effect facts", async () => {
		const verifier = await runD720GraphNativeEval({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			executor: completeExecutor({ verifierStatus: "failed" }).executor,
		});
		expect(verifier.graphEvidence.findings[0]?.code).toBe("hidden-verifier-failed");
		expect(verifier.graphEvidence.ledger.completedArms).toHaveLength(6);

		const cleanup = await runD720GraphNativeEval({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			executor: completeExecutor({ cleanupStatus: "failed" }).executor,
		});
		expect(cleanup.runStatus).toBe("stopped");
		expect(cleanup.graphEvidence.findings[0]?.code).toBe("cleanup-failed");
	});

	it("lets Graph recover each incomplete primary run before releasing the next arm", async () => {
		const bundle = await runD720GraphNativeEval({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			executor: completeExecutor({ primaryInspectionOnly: true }).executor,
		});
		expect(bundle.runStatus).toBe("complete");
		expect(bundle.graphEvidence.ledger.issuedRequests).toHaveLength(12);
		expect(bundle.graphEvidence.effectRuns).toHaveLength(12);
		expect(bundle.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(
			bundle.graphEvidence.ledger.decisions.filter(
				(decision) => decision.disposition === "recover-current",
			),
		).toHaveLength(6);
		expect(
			bundle.graphEvidence.findings.filter(
				(finding) => finding.code === "objective-progress-missing",
			),
		).toHaveLength(6);
	});

	it("does not execute provider/tool/verifier after materialization failure and still cleans up", async () => {
		const fixture = completeExecutor({ failMaterialization: true });
		const bundle = await runD720GraphNativeEval({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			executor: fixture.executor,
		});
		expect(bundle.runStatus).toBe("stopped");
		expect(bundle.graphEvidence.findings[0]?.code).toBe("materialization-failed");
		expect(
			bundle.graphEvidence.effectRuns[0]?.facts.flatMap((fact) =>
				fact.kind === "graph-effect-result-admitted" ? [fact.result.effectKind] : [],
			),
		).toEqual(["materialization", "cleanup"]);
		expect(fixture.calls()).toBe(2);
	});

	it("stops from Graph budget denial and records executor failure only after cleanup", async () => {
		const budget = await runD720GraphNativeEval({
			sourceDigest,
			budgetLimits: { ...budgetLimits, maxRequests: 1 },
			effectCeilings,
			executor: completeExecutor().executor,
		});
		expect(budget.runStatus).toBe("stopped");
		expect(budget.graphEvidence.findings[0]?.code).toBe("budget-exhausted");
		expect(budget.graphEvidence.effectRuns[0]?.facts.at(-1)?.kind).toBe(
			"graph-effect-result-admitted",
		);
		expect(
			budget.graphEvidence.ledger.effectAdmissions.some(
				(admission) => !admission.admitted && admission.budgetReasons.includes("request-limit"),
			),
		).toBe(true);

		const thrown = await runD720GraphNativeEval({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			executor: completeExecutor({ throwToolRef: "replace-exact" }).executor,
		});
		expect(thrown.runStatus).toBe("stopped");
		expect(thrown.graphEvidence.findings[0]?.code).toBe("executor-failed");
		expect(thrown.graphEvidence.effectRuns[0]?.facts.at(-1)?.kind).toBe(
			"graph-effect-result-admitted",
		);
		expect(
			thrown.graphEvidence.ledger.effectReconciliations.some(
				(reconciliation) => reconciliation.basis === "conservative-reservation",
			),
		).toBe(true);
	});

	it("records pre-effect and post-effect cancellation as Graph evidence", async () => {
		const before = new AbortController();
		before.abort();
		const pre = await runD720GraphNativeEval({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			executor: completeExecutor().executor,
			signal: before.signal,
		});
		expect(pre.runStatus).toBe("stopped");
		expect(pre.graphEvidence.findings[0]?.code).toBe("cancelled");
		expect(pre.graphEvidence.effectRuns[0]?.runtimeStatus).toBe("cancelled");
		expect(pre.graphEvidence.effectRuns[0]?.facts).toHaveLength(1);
		expect(pre.graphEvidence.effectRuns[0]?.facts[0]?.kind).toBe("graph-cancellation-admitted");

		const during = new AbortController();
		const post = await runD720GraphNativeEval({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			executor: completeExecutor({
				abortOnEffectKind: "provider-request",
				abortController: during,
			}).executor,
			signal: during.signal,
		});
		expect(post.graphEvidence.findings[0]?.code).toBe("cancelled");
		expect(post.graphEvidence.ledger.effectReconciliations).toHaveLength(3);
		expect(post.graphEvidence.effectRuns[0]?.facts).toHaveLength(4);

		const duringCleanup = new AbortController();
		const terminal = await runD720GraphNativeEval({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			executor: completeExecutor({
				abortOnEffectKind: "cleanup",
				abortController: duringCleanup,
			}).executor,
			signal: duringCleanup.signal,
		});
		expect(terminal.graphEvidence.findings[0]?.code).toBe("cancelled");
		expect(terminal.graphEvidence.effectRuns[0]?.facts.at(-1)?.kind).toBe(
			"graph-cancellation-admitted",
		);

		const failedCleanupAbort = new AbortController();
		const cleanupFailureWins = await runD720GraphNativeEval({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			executor: completeExecutor({
				abortOnEffectKind: "cleanup",
				abortController: failedCleanupAbort,
				cleanupStatus: "failed",
			}).executor,
			signal: failedCleanupAbort.signal,
		});
		expect(cleanupFailureWins.graphEvidence.findings[0]?.code).toBe("cleanup-failed");
	});

	it("fails closed on workspace-state drift and accessor-authored executor output", async () => {
		const drifted = await runD720GraphNativeEval({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			executor: completeExecutor({ driftToolRef: "read-file" }).executor,
		});
		expect(drifted.graphEvidence.findings[0]?.code).toBe("executor-failed");
		expect(
			drifted.graphEvidence.effectRuns[0]?.facts.some(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.result.effectKind === "hidden-verifier",
			),
		).toBe(false);

		let getterHits = 0;
		const accessorExecutor = createD720SimulatedCallerExecutor(async ({ effectRequest }) => {
			if (effectRequest.effectKind === "cleanup") {
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "cleanup" as const,
						status: "succeeded" as const,
						evidenceDigest: evidence({ cleanup: true }),
					},
				};
			}
			return Object.defineProperty({ actualCostMicrousd: 0, actualElapsedMs: 1 }, "result", {
				enumerable: true,
				get() {
					getterHits += 1;
					return null;
				},
			}) as never;
		});
		const accessor = await runD720GraphNativeEval({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			executor: accessorExecutor,
		});
		expect(getterHits).toBe(0);
		expect(accessor.graphEvidence.findings[0]?.code).toBe("materialization-failed");
	});

	it("validates executor semantics before reconciliation and rejects out-of-order tools", async () => {
		const baseline = evidence({ workspace: "validation-order" });
		const invalidResult = createD720SimulatedCallerExecutor(async ({ effectRequest }) => {
			if (effectRequest.effectKind === "materialization")
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "materialization" as const,
						status: "ready" as const,
						workspaceStateDigest: baseline,
						evidenceDigest: evidence({ effectRequest, ready: true }),
					},
				};
			if (effectRequest.effectKind === "provider-request")
				return {
					actualCostMicrousd: 1,
					actualElapsedMs: 1,
					result: {
						effectKind: "provider-request" as const,
						status: "structured-final" as const,
						toolIntents: Object.freeze([]),
						failureDiscriminator: "none" as const,
						retryAfterMs: null,
						workspaceStateDigest: evidence({ stale: true }),
						evidenceDigest: evidence({ effectRequest, invalid: true }),
					},
				};
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup" as const,
					status: "succeeded" as const,
					evidenceDigest: evidence({ effectRequest, cleanup: true }),
				},
			};
		});
		const invalid = await runD720GraphNativeEval({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			executor: invalidResult,
		});
		const providerReconciliation = invalid.graphEvidence.ledger.effectReconciliations.find(
			(reconciliation) =>
				invalid.graphEvidence.ledger.effectProposals.find(
					(proposal) => proposal.effectSequence === reconciliation.effectSequence,
				)?.effectKind === "provider-request",
		);
		expect(providerReconciliation?.basis).toBe("conservative-reservation");
		expect(providerReconciliation?.actualCostMicrousd).toBe(effectCeilings.providerMaxCostMicrousd);

		let toolCalls = 0;
		const outOfOrder = createD720SimulatedCallerExecutor(async ({ effectRequest }) => {
			const common = { actualCostMicrousd: 0, actualElapsedMs: 1 };
			if (effectRequest.effectKind === "materialization")
				return {
					...common,
					result: {
						effectKind: "materialization" as const,
						status: "ready" as const,
						workspaceStateDigest: baseline,
						evidenceDigest: evidence({ effectRequest }),
					},
				};
			if (effectRequest.effectKind === "provider-request")
				return {
					...common,
					result: {
						effectKind: "provider-request" as const,
						status: "tool-intents" as const,
						toolIntents: Object.freeze([
							{ toolRef: "workspace-diff" as const, intentDigest: evidence({ outOfOrder: true }) },
						]),
						failureDiscriminator: "none" as const,
						retryAfterMs: null,
						workspaceStateDigest: baseline,
						evidenceDigest: evidence({ effectRequest }),
					},
				};
			if (effectRequest.effectKind === "tool-action") toolCalls += 1;
			return {
				...common,
				result: {
					effectKind: "cleanup" as const,
					status: "succeeded" as const,
					evidenceDigest: evidence({ effectRequest }),
				},
			};
		});
		const ordered = await runD720GraphNativeEval({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			executor: outOfOrder,
		});
		expect(toolCalls).toBe(0);
		expect(ordered.graphEvidence.findings[0]?.code).toBe("executor-failed");
	});

	it("gives duplicate tool intents unique admissions and Graph-stops at the effect bound", async () => {
		const baseline = evidence({ workspace: "duplicate-tools" });
		const duplicateIntent = Object.freeze({
			toolRef: "read-file" as const,
			intentDigest: evidence({ duplicate: true }),
		});
		const boundAbort = new AbortController();
		const duplicateExecutor = createD720SimulatedCallerExecutor(async ({ effectRequest }) => {
			const common = { actualCostMicrousd: 0, actualElapsedMs: 1 };
			if (effectRequest.effectKind === "materialization")
				return {
					...common,
					result: {
						effectKind: "materialization" as const,
						status: "ready" as const,
						workspaceStateDigest: baseline,
						evidenceDigest: evidence({ effectRequest }),
					},
				};
			if (effectRequest.effectKind === "provider-request")
				return {
					...common,
					result: {
						effectKind: "provider-request" as const,
						status: "tool-intents" as const,
						toolIntents: Object.freeze([duplicateIntent, duplicateIntent]),
						failureDiscriminator: "none" as const,
						retryAfterMs: null,
						workspaceStateDigest: baseline,
						evidenceDigest: evidence({ effectRequest }),
					},
				};
			if (effectRequest.effectKind === "tool-action")
				return {
					...common,
					result: {
						effectKind: "tool-action" as const,
						toolRef: "read-file" as const,
						intentDigest: duplicateIntent.intentDigest,
						status: "succeeded" as const,
						nonEmptyDiff: false,
						workspaceStateBeforeDigest: baseline,
						workspaceStateAfterDigest: baseline,
						evidenceDigest: evidence({ effectRequest }),
					},
				};
			boundAbort.abort();
			return {
				...common,
				result: {
					effectKind: "cleanup" as const,
					status: "succeeded" as const,
					evidenceDigest: evidence({ effectRequest }),
				},
			};
		});
		const bounded = await runD720GraphNativeEval({
			sourceDigest,
			budgetLimits: { ...budgetLimits, maxRequests: 1_000 },
			effectCeilings,
			executor: duplicateExecutor,
			signal: boundAbort.signal,
		});
		expect(bounded.runStatus).toBe("stopped");
		expect(
			bounded.graphEvidence.effectRuns[0]?.facts.some(
				(fact) => fact.kind === "graph-effect-bound-exhausted",
			),
		).toBe(true);
		expect(bounded.graphEvidence.effectRuns[0]?.facts).toHaveLength(512);
		expect(bounded.graphEvidence.effectRuns[0]?.facts.at(-1)?.kind).toBe(
			"graph-cancellation-admitted",
		);
	});

	it("rejects forged effect evidence and executor capabilities", async () => {
		const bundle = await runD720GraphNativeEval({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			executor: completeExecutor().executor,
		});
		const first = bundle.graphEvidence.effectRuns[0];
		if (first === undefined) throw new Error("missing effect evidence");
		const forged = {
			...bundle,
			graphEvidence: {
				...bundle.graphEvidence,
				effectRuns: [
					{
						...first,
						facts: first.facts.map((fact, index) =>
							index === 0 ? { ...fact, resultDigest: evidence({ forged: true }) } : fact,
						),
					},
					...bundle.graphEvidence.effectRuns.slice(1),
				],
			},
		};
		expect(() => validateD720GraphNativeEvalBundle(forged)).toThrow();
		await expect(
			runD720GraphNativeEval({
				sourceDigest,
				budgetLimits,
				effectCeilings,
				executor: Object.freeze({ revision: "graphrefly.b112.d720.caller-executor.v2" }),
			}),
		).rejects.toThrow(/not constructed/);
	});

	it("persists only canonical Graph ledger, effect evidence, findings and bundle", async () => {
		const privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d720-v2-")));
		try {
			const bundle = await runD720GraphNativeEval({
				sourceDigest,
				budgetLimits,
				effectCeilings,
				executor: completeExecutor().executor,
			});
			const receipt = await persistD720GraphNativeEvalBundle({
				privateRoot,
				bundleRef: "d720-full-graph-native",
				bundle,
			});
			expect(receipt.graphEvidenceArtifactDigest).toMatch(/^sha256:/);
			const finalRoot = join(privateRoot, "d720-full-graph-native");
			expect((await readdir(finalRoot)).sort()).toEqual(["artifacts", "commit.v2.json"]);
			expect((await lstat(join(finalRoot, "commit.v2.json"))).mode & 0o777).toBe(0o600);
			const names = await readdir(join(finalRoot, "artifacts"));
			expect(names.sort()).toEqual([
				"eval-bundle.v2.json",
				"graph-evidence.v2.json",
				"harness-findings.v2.json",
			]);
			for (const name of names) {
				expect((await lstat(join(finalRoot, "artifacts", name))).mode & 0o777).toBe(0o600);
			}
			const persisted = strictJsonCodec.decode(
				await readFile(join(finalRoot, "artifacts", "eval-bundle.v2.json")),
			);
			expect(validateD720GraphNativeEvalBundle(persisted).bundleDigest).toBe(bundle.bundleDigest);
			await expect(
				persistD720GraphNativeEvalBundle({
					privateRoot,
					bundleRef: "d720-full-graph-native",
					bundle,
				}),
			).rejects.toThrow(/already exists/);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	});
});
