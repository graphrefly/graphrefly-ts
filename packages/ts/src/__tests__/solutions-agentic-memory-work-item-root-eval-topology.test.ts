import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
} from "../../evals/graph-native-rerun-avoidance/canonical.js";
import { createCurrentExactModelHarnessProfileInput } from "../../evals/graph-native-rerun-avoidance/current-exact-profile.js";
import {
	assertRootEvalOutcomeReceipt,
	createRootEvalTopology,
	type EvalAdmittedEffect,
	type EvalAdmittedToolEffect,
	type EvalBillingObservationEffect,
	type EvalBillingObservationOutcome,
	type EvalBudgetState,
	type EvalCleanupFact,
	type EvalEffectActivitySnapshot,
	type EvalEffectClassActivitySnapshot,
	type EvalEffectOutcome,
	type EvalExecutableEffect,
	type EvalExecutorOutcome,
	type EvalObservation,
	type EvalProviderOutcome,
	evalVerificationTerminalReason,
	evalWorkItemPlanAuthorityDigest,
	materialFreeObservationValue,
	persistRootEvalRunAtomically,
	ROOT_EVAL_CALLER_SAFETY_LEASE_MS,
	ROOT_EVAL_DEFAULT_EFFECT_TIMEOUT_MS,
	ROOT_EVAL_GRAPH_DRAIN_RESERVE_MS,
	ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS,
	ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
	runRootEval,
	validateEvalEffectProposalAgainstWorkItemPlan,
} from "../../evals/graph-native-rerun-avoidance/eval-topology.js";
import {
	assertRootEvalTopologyContract,
	ROOT_EVAL_CRITICAL_EDGES,
	ROOT_EVAL_REQUIRED_NODES,
} from "../../evals/graph-native-rerun-avoidance/eval-topology-contract.js";
import {
	buildRootEvalGeneratedArtifactBytes,
	ROOT_EVAL_GENERATED_ARTIFACT_PATHS,
} from "../../evals/graph-native-rerun-avoidance/generate-root-eval-artifacts.js";
import { HARNESS_ARMS } from "../../evals/graph-native-rerun-avoidance/harness-campaign-policy.js";
import {
	CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
	CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
	CURRENT_QUALIFICATION_DIGEST,
	measureCurrentImplementation,
	measureCurrentImplementationInputs,
} from "../../evals/graph-native-rerun-avoidance/implementation-manifest.js";
import {
	rootEvalPrecredentialStagePlan,
	runRootEvalPrecredentialStagePlan,
} from "../../evals/graph-native-rerun-avoidance/precredential-stage-coordinator.js";
import { ROOT_EVAL_LIVE_DECISION_REF } from "../../evals/graph-native-rerun-avoidance/root-eval-live.js";
import {
	ROOT_EVAL_LIVE_CLAIM_REF,
	ROOT_EVAL_LIVE_CLAIM_SCHEMA,
	ROOT_EVAL_LIVE_EVIDENCE_SCHEMA,
	ROOT_EVAL_LIVE_GENERATION_REF,
	ROOT_EVAL_LIVE_PRECLAIM_FAILURE_SCHEMA,
	ROOT_EVAL_LIVE_PRECREDENTIAL_GATE_RECEIPT_SCHEMA,
} from "../../evals/graph-native-rerun-avoidance/root-eval-live-authority.js";
import {
	ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT,
	ROOT_EVAL_LIVE_QUALIFICATION,
} from "../../evals/graph-native-rerun-avoidance/root-eval-live-qualification.js";
import {
	ROOT_EVAL_DEVELOPMENT_TASKS,
	ROOT_EVAL_HELD_OUT_SEAL_DIGEST,
} from "../../evals/graph-native-rerun-avoidance/root-eval-task.js";
import {
	ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT,
	ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT_DIGEST,
	ROOT_EVAL_TOPOLOGY_QUALIFICATION,
} from "../../evals/graph-native-rerun-avoidance/root-eval-topology-qualification.js";
import type { DescribeSnapshot } from "../graph/describe.js";

const createTopology = (
	options: Omit<Parameters<typeof createRootEvalTopology>[0], "profileInput"> = {},
) =>
	createRootEvalTopology({
		profileInput: createCurrentExactModelHarnessProfileInput(),
		currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
		...options,
	});

function outcome(
	effect: EvalAdmittedToolEffect,
	patch: Partial<EvalEffectOutcome> = {},
): EvalEffectOutcome {
	const payload = effect.providerAdmission.request.payload as
		| {
				readonly memoryExposureCount?: number;
				readonly memoryProvenance?: string;
		  }
		| undefined;
	const passed =
		effect.workItemRole === "source" || payload?.memoryProvenance === "relevant-applied";
	const expectedDigest =
		effect.workItemRole === "source"
			? ROOT_EVAL_DEVELOPMENT_TASKS[effect.replicate - 1]!.sourceVerifierEvidenceDigest
			: empiricalStrictJsonDigest({
					kind: "expected-eval-result",
					replicate: effect.replicate,
					arm: effect.arm,
					attempt: effect.attempt,
				});
	const evidence: EvalEffectOutcome["evidence"] = Object.freeze({
		expectedDigest,
		actualDigest: empiricalStrictJsonDigest({
			kind: "actual-control-result",
			replicate: effect.replicate,
			arm: effect.arm,
		}),
		diff: passed ? "scoped-change" : "no-change",
		cleanupCompleted: true,
		publicSemantic: passed ? "equivalent" : "different",
		hiddenVerifier: passed ? "pass" : "fail",
	});
	return Object.freeze({
		kind: "eval-effect-outcome",
		admission: effect,
		executionId: effect.executionId,
		admissionId: effect.providerAdmission.admissionId,
		toolAdmissionId: effect.toolAdmissionId,
		operationId: effect.providerAdmission.operationId,
		argumentsDigest: effect.argumentsDigest,
		effectRunId: effect.effectRunId,
		workItemId: effect.workItemId,
		workItemRole: effect.workItemRole,
		replicate: effect.replicate,
		arm: effect.arm,
		attempt: effect.attempt,
		status: "completed",
		costMicrousd: 0,
		elapsedMs: effect.replicate * 10 + effect.attempt,
		resultDigest: empiricalStrictJsonDigest({
			kind: "no-network-eval-result",
			replicate: effect.replicate,
			arm: effect.arm,
			attempt: effect.attempt,
		}),
		evidence,
		...patch,
	});
}

function providerOutcome(
	effect: EvalAdmittedEffect,
	patch: Partial<EvalProviderOutcome> = {},
): EvalProviderOutcome {
	const tool = Object.freeze({
		toolRef: "graphrefly.eval.exact-tool.v1" as const,
		path: "packages/ts/src/executors/managed-cloud-postgresql.ts",
		oldText: "old",
		newText: "new",
	});
	return Object.freeze({
		kind: "eval-provider-outcome" as const,
		admission: effect,
		admissionId: effect.admissionId,
		executionId: effect.executionId,
		operationId: effect.operationId,
		effectRunId: effect.effectRunId,
		workItemId: effect.workItemId,
		workItemRole: effect.workItemRole,
		replicate: effect.replicate,
		arm: effect.arm,
		attempt: effect.attempt,
		status: "tool-proposed" as const,
		reason: "tool-proposed" as const,
		dispatchAttempted: true,
		costMicrousd: 10,
		costEvidence: "provider-reported" as const,
		pricingRoundingAllowanceMicrousd: 0,
		elapsedMs: effect.replicate * 10 + effect.attempt,
		resultDigest: empiricalStrictJsonDigest({
			kind: "no-network-provider-result",
			executionId: effect.executionId,
		}),
		retryAfterMs: 0,
		cleanupCompleted: false,
		toolProposal: Object.freeze({
			...tool,
			argumentsDigest: empiricalStrictJsonDigest(tool),
		}),
		...patch,
	});
}

function twoPhaseExecutor(
	input: {
		readonly onProvider?: (
			effect: EvalAdmittedEffect,
		) => EvalProviderOutcome | Promise<EvalProviderOutcome>;
		readonly onTool?: (
			effect: EvalAdmittedToolEffect,
		) => EvalEffectOutcome | Promise<EvalEffectOutcome>;
		readonly onBilling?: (
			effect: EvalBillingObservationEffect,
		) => EvalBillingObservationOutcome | Promise<EvalBillingObservationOutcome>;
	} = {},
): (effect: EvalExecutableEffect) => Promise<EvalExecutorOutcome> {
	return async (effect) => {
		if (effect.kind === "eval-admitted-effect")
			return await (input.onProvider?.(effect) ?? providerOutcome(effect));
		if (effect.kind === "eval-admitted-tool-effect")
			return await (input.onTool?.(effect) ?? outcome(effect));
		if (effect.kind === "eval-admitted-billing-observation") {
			if (input.onBilling !== undefined) return await input.onBilling(effect);
			const before = effect.currentKeyBefore;
			const currentKeyAfter = Object.freeze({
				...before,
				remainingMicrousd: before.remainingMicrousd - effect.accountedUpperBoundMicrousd,
				usageMicrousd: before.usageMicrousd + effect.accountedUpperBoundMicrousd,
				admissionDigest: empiricalStrictJsonDigest({
					kind: "no-network-current-key-observation",
					executionId: effect.executionId,
				}),
			});
			return Object.freeze({
				kind: "eval-billing-observation-outcome" as const,
				admission: effect,
				executionId: effect.executionId,
				observation: effect.observation,
				status: "completed" as const,
				currentKeyAfter,
				resultDigest: empiricalStrictJsonDigest(currentKeyAfter),
			});
		}
		return Object.freeze({
			kind: "eval-retry-delay-outcome" as const,
			admission: effect,
			executionId: effect.executionId,
			elapsedMs: effect.delayMs,
			status: "completed" as const,
			resultDigest: empiricalStrictJsonDigest({
				kind: "no-network-retry-delay",
				executionId: effect.executionId,
			}),
		});
	};
}

function billingOutcome(
	effect: EvalBillingObservationEffect,
	currentKeyAfter: EvalBillingObservationOutcome["currentKeyAfter"],
): EvalBillingObservationOutcome {
	return Object.freeze({
		kind: "eval-billing-observation-outcome" as const,
		admission: effect,
		executionId: effect.executionId,
		observation: effect.observation,
		status: currentKeyAfter === null ? ("failed" as const) : ("completed" as const),
		currentKeyAfter,
		resultDigest: empiricalStrictJsonDigest({
			kind: "test-billing-observation",
			executionId: effect.executionId,
			currentKeyAfter,
		}),
	});
}

function clone(snapshot: DescribeSnapshot): DescribeSnapshot {
	return structuredClone(snapshot);
}

describe("D140-qualified D122 one-root verification diagnostics", () => {
	it("executes mutation-sensitive D138 stage plans without post-receipt long gates", async () => {
		const cases = [
			["--prepare-browser", ["long-gates", "bounded-currentness", "persist-receipt"]],
			["--qualify-private-inputs", ["bounded-currentness", "private-input-admission"]],
			[
				"--execute-live",
				[
					"bounded-currentness",
					"private-input-admission",
					"control-plane-admission",
					"claim",
					"campaign",
				],
			],
		] as const;
		for (const [mode, expected] of cases) {
			const trace: string[] = [];
			expect(rootEvalPrecredentialStagePlan(mode)).toEqual(expected);
			await expect(
				runRootEvalPrecredentialStagePlan({
					mode,
					run: async (stage) => {
						trace.push(stage);
					},
				}),
			).resolves.toEqual(expected);
			expect(trace).toEqual(expected);
		}
		expect(rootEvalPrecredentialStagePlan("--qualify-private-inputs")).not.toContain("long-gates");
		expect(rootEvalPrecredentialStagePlan("--execute-live")).not.toContain("long-gates");
	});
	it("exposes raw material-free describe JSON and the executable real-solution contract", () => {
		const topology = createTopology();
		const raw = topology.graph.describe();
		const report = assertRootEvalTopologyContract(raw);

		expect(report).toMatchObject({
			rootGraphs: 1,
			mounts: 0,
			treatment: "relevant-applied",
			controls: [
				"cold",
				"proposal-only",
				"admission-rejected",
				"irrelevant-applied",
				"wrong-scope-applied",
			],
		});
		expect(JSON.parse(JSON.stringify(raw))).toEqual(raw);
		expect(raw.subgraphs ?? []).toEqual([]);
		expect(
			raw.nodes.find((node) => node.id === "eval/work-item/attempt-resource-plan")?.meta,
		).toMatchObject({
			timeoutAuthority: "work-item-effect-plan",
			effectTimeoutMs: ROOT_EVAL_DEFAULT_EFFECT_TIMEOUT_MS,
		});
		expect(raw.nodes.find((node) => node.id === "eval/billing/reconciliation")?.meta).toEqual({
			efficacyAuthority: false,
			materialFree: true,
			terminalAuditDependency: true,
		});
		expect(raw.nodes.find((node) => node.id === "eval/findings/efficacy")?.meta).toEqual({
			billingAuditAffectsConclusion: false,
			semanticAuthority: "verification-diagnostics-stage-counts",
		});
		expect(raw.nodes.find((node) => node.id === "eval/verification/diagnostics")?.meta).toEqual({
			domainAuthority: "graph-state",
			materialFree: true,
			terminalReasonPrecedence: [
				"cleanup-incomplete",
				"provider-failed",
				"exact-tool-failed",
				"no-change",
				"wrong-scope",
				"public-semantic-failed",
				"hidden-verifier-failed",
				"passed",
			],
		});
		expect(
			raw.nodes.find((node) => node.id === "eval/campaign/replicate-controller")?.meta,
		).toMatchObject({
			sourceFailurePolicy: "fail-closed-dependency-closure",
			adaptiveRetryMayRebind: false,
		});
		expect(raw.nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ factory: "workItemExecutionRequestFacts" }),
				expect.objectContaining({ factory: "agenticWorkItemMemoryBridge" }),
				expect.objectContaining({ factory: "agenticMemoryRecordAdmission" }),
				expect.objectContaining({ factory: "agenticMemoryRecordApplication" }),
				expect.objectContaining({ factory: "agenticMemoryRecordUseGate" }),
				expect.objectContaining({ factory: "agenticMemoryProjection" }),
			]),
		);
	});

	it("fails closed inside the root Graph instead of composing a simulated or stale profile", () => {
		const exact = createCurrentExactModelHarnessProfileInput();
		expect(() =>
			createRootEvalTopology({
				profileInput: {
					...exact,
					currentImplementationManifestDigest: `sha256:${"0".repeat(64)}`,
				},
				currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
			}),
		).toThrow(/manifest is not current/u);
		const { qualificationDigest: _qualificationDigest, ...qualificationMaterial } =
			exact.qualifications[0]!;
		const forgedQualificationMaterial = {
			...qualificationMaterial,
			qualificationRef: "profile-qualification.caller-minted",
		};
		expect(() =>
			createRootEvalTopology({
				profileInput: {
					...exact,
					qualifications: [
						{
							...forgedQualificationMaterial,
							qualificationDigest: empiricalStrictJsonDigest(forgedQualificationMaterial),
						},
					],
				},
				currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
			}),
		).toThrow(/not the exact no-network-qualified tuple/u);
		expect(() => createRootEvalTopology({} as never)).toThrow();
	});

	it("settles campaign start immediately and exhausts the Graph elapsed budget at the exact boundary", () => {
		vi.useFakeTimers();
		try {
			const topology = createTopology();
			const states: EvalObservation["elapsedBudget"][] = [];
			const timerMessageTypes: string[] = [];
			const stopTimer = topology.nodes.elapsedBudgetTimerSource.subscribe((message) => {
				timerMessageTypes.push(message[0]);
			});
			const stop = topology.nodes.elapsedBudget.subscribe((message) => {
				if (message[0] === "DATA") states.push(message[1] as EvalObservation["elapsedBudget"]);
			});
			topology.inputs.start.down([
				[
					"DATA",
					Object.freeze({
						kind: "eval-campaign-start" as const,
						campaignRef: topology.campaignRef,
					}),
				],
			]);
			expect(timerMessageTypes).toContain("RESOLVED");
			expect(timerMessageTypes).not.toContain("DATA");
			expect(states.at(-1)).toMatchObject({
				state: "armed",
				nowMs: 0,
				limitMs: ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS,
				drainReserveMs: ROOT_EVAL_GRAPH_DRAIN_RESERVE_MS,
				callerSafetyLeaseMs: ROOT_EVAL_CALLER_SAFETY_LEASE_MS,
				stoppingReason: "none",
			});
			expect(ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS + ROOT_EVAL_GRAPH_DRAIN_RESERVE_MS).toBe(
				ROOT_EVAL_CALLER_SAFETY_LEASE_MS,
			);
			vi.advanceTimersByTime(ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS - 1);
			expect(states.some((state) => state.state === "exhausted")).toBe(false);
			vi.advanceTimersByTime(1);
			expect(states.at(-1)).toMatchObject({
				state: "exhausted",
				nowMs: ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS,
				stoppingReason: "elapsed-budget-exhausted",
			});
			expect(timerMessageTypes).toContain("DATA");
			topology.inputs.start.down([
				[
					"DATA",
					Object.freeze({
						kind: "eval-campaign-start" as const,
						campaignRef: topology.campaignRef,
					}),
				],
			]);
			expect(states.at(-1)?.state).toBe("exhausted");
			stopTimer();
			stop();
		} finally {
			vi.useRealTimers();
		}
	});

	it("rejects elapsed timer-source semantic metadata drift", () => {
		const raw = structuredClone(createTopology().graph.describe());
		const timer = raw.nodes.find((node) => node.id === "eval/time/elapsed-budget/timer-source");
		if (timer === undefined) throw new Error("elapsed timer source missing from test topology");
		for (const [key, replacement] of [
			["delayMs", 1],
			["startWaveSettlement", "deferred"],
			["boundaryEmission", "same-wave"],
			["asyncPool", false],
			["pausable", true],
		] as const) {
			const mutation = structuredClone(raw);
			const mutatedTimer = mutation.nodes.find(
				(node) => node.id === "eval/time/elapsed-budget/timer-source",
			)!;
			mutatedTimer.meta = { ...mutatedTimer.meta, [key]: replacement };
			expect(() => assertRootEvalTopologyContract(mutation), key).toThrow(
				/elapsed timer-source semantics drift/u,
			);
		}
	});

	it("rejects source rebinding or a weakened dependency-closed failure policy", () => {
		const raw = structuredClone(createTopology().graph.describe());
		for (const [key, replacement] of [
			["sourceFailurePolicy", "own-source-only"],
			["adaptiveRetryMayRebind", true],
		] as const) {
			const mutation = structuredClone(raw);
			const controller = mutation.nodes.find(
				(node) => node.id === "eval/campaign/replicate-controller",
			);
			if (controller === undefined)
				throw new Error("replicate controller missing from test topology");
			controller.meta = { ...controller.meta, [key]: replacement };
			expect(() => assertRootEvalTopologyContract(mutation), key).toThrow(
				/sealed source fail-closed policy drift/u,
			);
		}
	});

	it("cancels the Graph elapsed timer when an early campaign finding settles", async () => {
		vi.useFakeTimers();
		try {
			let settled = false;
			const resultPromise = runRootEval(createTopology(), twoPhaseExecutor()).then((result) => {
				settled = true;
				return result;
			});
			for (let turn = 0; turn < 256 && !settled; turn += 1)
				await vi.advanceTimersToNextTimerAsync();
			expect(settled).toBe(true);
			const result = await resultPromise;
			expect(result.finding.stoppingReason).toBe("campaign-complete");
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps duplicate campaign start timer cleanup attached to the Graph lifecycle", async () => {
		vi.useFakeTimers();
		try {
			const topology = createTopology();
			let settled = false;
			const resultPromise = runRootEval(topology, twoPhaseExecutor()).then((result) => {
				settled = true;
				return result;
			});
			const start = Object.freeze({
				kind: "eval-campaign-start" as const,
				campaignRef: topology.campaignRef,
			});
			topology.inputs.start.down([["DATA", start]]);
			for (let turn = 0; turn < 256 && !settled; turn += 1)
				await vi.advanceTimersToNextTimerAsync();
			expect(settled).toBe(true);
			expect((await resultPromise).finding.stoppingReason).toBe("campaign-complete");
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("closes new provider admission at elapsed exhaustion and drains admitted tool cleanup", async () => {
		vi.useFakeTimers();
		try {
			const topology = createTopology();
			const elapsedStates: EvalObservation["elapsedBudget"][] = [];
			const stopElapsed = topology.nodes.elapsedBudget.subscribe((message) => {
				if (message[0] === "DATA")
					elapsedStates.push(message[1] as EvalObservation["elapsedBudget"]);
			});
			const providerReleases: Array<() => void> = [];
			const providerExecutionIds: string[] = [];
			let toolExecutions = 0;
			let stoppedError: unknown;
			let stopped = false;
			const running = runRootEval(topology, async (effect) => {
				if (effect.kind === "eval-admitted-effect") {
					providerExecutionIds.push(effect.executionId);
					return await new Promise<EvalProviderOutcome>((resolve) => {
						providerReleases.push(() => resolve(providerOutcome(effect)));
					});
				}
				if (effect.kind === "eval-admitted-tool-effect") {
					toolExecutions += 1;
					return outcome(effect);
				}
				throw new Error(`unexpected elapsed-drain effect ${effect.kind}`);
			}).catch((error: unknown) => {
				stoppedError = error;
				stopped = true;
			});
			for (let turn = 0; turn < 8 && providerExecutionIds.length < 2; turn += 1)
				await vi.advanceTimersToNextTimerAsync();
			expect(providerExecutionIds).toHaveLength(2);
			vi.advanceTimersByTime(ROOT_EVAL_GRAPH_ELAPSED_ADMISSION_BUDGET_MS);
			expect(elapsedStates.at(-1)?.state).toBe("exhausted");
			expect(stopped).toBe(false);
			for (const release of providerReleases) release();
			for (let turn = 0; turn < 32 && !stopped; turn += 1) await vi.advanceTimersByTimeAsync(0);
			await running;
			expect(stoppedError).toMatchObject({
				message: "root eval stopped: elapsed-budget-exhausted",
			});
			expect(providerExecutionIds).toHaveLength(2);
			expect(toolExecutions).toBe(0);
			stopElapsed();
		} finally {
			vi.useRealTimers();
		}
	});

	it("freezes D145 development qualification over the open D145 umbrella authority", async () => {
		expect(await measureCurrentImplementation()).toBe(CURRENT_IMPLEMENTATION_MANIFEST_DIGEST);
		const implementationInputs = await measureCurrentImplementationInputs();
		for (const required of [
			"runtime/packages/ts/src/graph/index.ts",
			"runtime/packages/ts/src/solutions/work-item/index.ts",
			"runtime/packages/ts/src/solutions/agentic-memory/index.ts",
			"runtime/packages/ts/src/solutions/agentic-work-item-memory-application/index.ts",
			"toolchain/pnpm-lock.yaml",
		] as const)
			expect(implementationInputs[required], required).toMatch(/^sha256:[0-9a-f]{64}$/u);
		expect(ROOT_EVAL_LIVE_DECISION_REF).toBe("graphrefly-ts:D145");
		expect(ROOT_EVAL_LIVE_GENERATION_REF).toBe("root-eval-development-2026-08-27-d145-v1");
		expect(ROOT_EVAL_LIVE_CLAIM_REF).toBe("root-eval-development-claim-2026-08-27-d145-v1");
		expect(ROOT_EVAL_LIVE_CLAIM_SCHEMA).toBe("graphrefly-ts.root-eval-live-claim.v20");
		expect(ROOT_EVAL_LIVE_EVIDENCE_SCHEMA).toBe("graphrefly-ts.root-eval-live-evidence.v23");
		expect(ROOT_EVAL_LIVE_PRECLAIM_FAILURE_SCHEMA).toBe(
			"graphrefly-ts.root-eval-live-preclaim-failure.v20",
		);
		expect(ROOT_EVAL_LIVE_PRECREDENTIAL_GATE_RECEIPT_SCHEMA).toBe(
			"graphrefly-ts.root-eval-live-precredential-gates.v5",
		);
		expect(ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT.schemaVersion).toBe(
			"graphrefly-ts.root-eval-live-no-network-qa.v37",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.schemaVersion).toBe(
			"graphrefly-ts.root-eval-live-qualification.v37",
		);
		expect(ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT.schemaVersion).toBe(
			"graphrefly-ts.root-eval-topology-no-network-qa.v30",
		);
		expect(ROOT_EVAL_TOPOLOGY_QUALIFICATION.schemaVersion).toBe(
			"graphrefly-ts.root-eval-topology-qualification.v30",
		);
		expect(ROOT_EVAL_LIVE_GENERATION_REF).not.toContain("d116");
		expect(ROOT_EVAL_LIVE_CLAIM_REF).not.toContain("d116");
		expect(ROOT_EVAL_LIVE_GENERATION_REF).not.toContain("d121");
		expect(ROOT_EVAL_LIVE_CLAIM_REF).not.toContain("d121");
		expect(ROOT_EVAL_LIVE_GENERATION_REF).not.toContain("d118");
		expect(ROOT_EVAL_LIVE_CLAIM_REF).not.toContain("d118");
		expect(ROOT_EVAL_LIVE_GENERATION_REF).not.toContain("d111");
		expect(ROOT_EVAL_LIVE_CLAIM_REF).not.toContain("d111");
		expect(ROOT_EVAL_LIVE_GENERATION_REF).not.toContain("d103");
		expect(ROOT_EVAL_LIVE_CLAIM_REF).not.toContain("d103");
		expect(ROOT_EVAL_LIVE_GENERATION_REF).not.toContain("d78");
		expect(ROOT_EVAL_LIVE_CLAIM_REF).not.toContain("d78");
		expect(ROOT_EVAL_LIVE_GENERATION_REF).not.toContain("d80");
		expect(ROOT_EVAL_LIVE_CLAIM_REF).not.toContain("d80");
		expect(ROOT_EVAL_LIVE_GENERATION_REF).not.toContain("d83");
		expect(ROOT_EVAL_LIVE_CLAIM_REF).not.toContain("d83");
		expect(ROOT_EVAL_LIVE_GENERATION_REF).not.toContain("d85");
		expect(ROOT_EVAL_LIVE_CLAIM_REF).not.toContain("d85");
		expect(ROOT_EVAL_LIVE_GENERATION_REF).not.toContain("d90");
		expect(ROOT_EVAL_LIVE_CLAIM_REF).not.toContain("d90");
		expect(ROOT_EVAL_LIVE_GENERATION_REF).not.toContain("d92");
		expect(ROOT_EVAL_LIVE_CLAIM_REF).not.toContain("d92");
		expect(ROOT_EVAL_LIVE_GENERATION_REF).not.toContain("d94");
		expect(ROOT_EVAL_LIVE_CLAIM_REF).not.toContain("d94");
		expect(ROOT_EVAL_LIVE_GENERATION_REF).not.toContain("d99");
		expect(ROOT_EVAL_LIVE_CLAIM_REF).not.toContain("d99");
		expect(ROOT_EVAL_LIVE_GENERATION_REF).not.toContain("d109");
		expect(ROOT_EVAL_LIVE_CLAIM_REF).not.toContain("d109");
		expect(ROOT_EVAL_LIVE_QUALIFICATION.implementationApprovalRef).toBe("graphrefly-ts:D88");
		expect(ROOT_EVAL_LIVE_QUALIFICATION.retirementRef).toBe("graphrefly-ts:D86");
		expect(ROOT_EVAL_LIVE_QUALIFICATION.implementationReceiptRef).toBe("graphrefly-ts:D89");
		expect(ROOT_EVAL_LIVE_QUALIFICATION.earlierConsumedLiveExecutionApprovalRef).toBe(
			"graphrefly-ts:D90",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.effectLivenessIncidentClosureRef).toBe("graphrefly-ts:D91");
		expect(ROOT_EVAL_LIVE_QUALIFICATION.previousConsumedLiveExecutionApprovalRef).toBe(
			"graphrefly-ts:D92",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.responseHorizonIncidentClosureRef).toBe(
			"graphrefly-ts:D93",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.decisionRef).toBe("graphrefly-ts:D145");
		expect(ROOT_EVAL_LIVE_QUALIFICATION.implementationExecutionApprovalRef).toBe(
			"graphrefly-ts:D145",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.efficacyBillingSeparationDecisionRef).toBe(
			"graphrefly-ts:D113",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.historicalBillingReconciliationDecisionRef).toBe(
			"graphrefly-ts:D105",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.historicalBillingReconciliationExecutionApprovalRef).toBe(
			"graphrefly-ts:D106",
		);
		expect(
			ROOT_EVAL_LIVE_QUALIFICATION.historicalBillingReconciliationImplementationReceiptRef,
		).toBe("graphrefly-ts:D108");
		expect(ROOT_EVAL_LIVE_QUALIFICATION.lastConsumedBeforeD99LiveExecutionApprovalRef).toBe(
			"graphrefly-ts:D94",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.responseAndSpendImplementationReceiptRef).toBe(
			"graphrefly-ts:D98",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.lastConsumedBeforeD103LiveExecutionApprovalRef).toBe(
			"graphrefly-ts:D99",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.callerSettlementIncidentClosureRef).toBe(
			"graphrefly-ts:D100",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.callerSettlementImplementationReceiptRef).toBe(
			"graphrefly-ts:D102",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.lastConsumedBeforeD109LiveExecutionApprovalRef).toBe(
			"graphrefly-ts:D103",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.lastConsumedBeforeD109LiveExecutionCloseoutRef).toBe(
			"graphrefly-ts:D104",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.lastConsumedBeforeD111LiveExecutionApprovalRef).toBe(
			"graphrefly-ts:D109",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.lastConsumedBeforeD111LiveExecutionCloseoutRef).toBe(
			"graphrefly-ts:D110",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.lastConsumedLiveExecutionApprovalRef).toBe(
			"graphrefly-ts:D111",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.lastConsumedLiveExecutionCloseoutRef).toBe(
			"graphrefly-ts:D112",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.efficacyBillingSeparationImplementationReceiptRef).toBe(
			"graphrefly-ts:D115",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.verificationDiagnosticsImplementationReceiptRef).toBe(
			"graphrefly-ts:D120",
		);
		expect(ROOT_EVAL_LIVE_QUALIFICATION.currentLiveExecutionApprovalRef).toBe("graphrefly-ts:D145");
		expect(ROOT_EVAL_LIVE_QUALIFICATION).toMatchObject({
			mostRecentSuccessfulCanonicalLiveExecutionApprovalRef: "graphrefly-ts:D116",
			mostRecentSuccessfulCanonicalLiveExecutionCloseoutRef: "graphrefly-ts:D117",
			d121ConsumedLiveExecutionApprovalRef: "graphrefly-ts:D121",
			d121LivenessIncidentRepairRef: "graphrefly-ts:D122",
			d122ImplementationReceiptRef: "graphrefly-ts:D124",
			mostRecentConsumedLiveExecutionApprovalRef: "graphrefly-ts:D125",
			mostRecentConsumedLiveExecutionCloseoutRef: "graphrefly-ts:D126",
			adaptiveProviderCapacityDecisionRef: "graphrefly-ts:D127",
			adaptiveProviderCapacityExecutionApprovalRef: "graphrefly-ts:D128",
			elapsedAdmissionBudgetDecisionRef: "graphrefly-ts:D129",
			elapsedAdmissionBudgetExecutionApprovalRef: "graphrefly-ts:D130",
			nonBlockingElapsedTimerDecisionRef: "graphrefly-ts:D131",
			nonBlockingElapsedTimerExecutionApprovalRef: "graphrefly-ts:D132",
			graphElapsedAdaptiveImplementationReceiptRef: "graphrefly-ts:D133",
			d136ZeroChargeCloseoutRef: "graphrefly-ts:D137",
			precredentialGateChronologyExecutionApprovalRef: "graphrefly-ts:D138",
			currentLiveExecutionApprovalClosed: false,
			callerHorizonDecisionRequired: false,
			status: "qualified-no-network-d145-development-confirmatory-authority",
		});
		expect(ROOT_EVAL_TOPOLOGY_QUALIFICATION).toMatchObject({
			decisionRef: "graphrefly-ts:D145",
			executionApprovalRef: "graphrefly-ts:D145",
			efficacyBillingSeparationDecisionRef: "graphrefly-ts:D113",
			efficacyBillingSeparationExecutionApprovalRef: "graphrefly-ts:D114",
			efficacyBillingSeparationImplementationReceiptRef: "graphrefly-ts:D115",
			historicalBillingReconciliationDecisionRef: "graphrefly-ts:D105",
			historicalBillingReconciliationExecutionApprovalRef: "graphrefly-ts:D106",
			historicalBillingReconciliationImplementationReceiptRef: "graphrefly-ts:D108",
			implementationReceiptRef: "graphrefly-ts:D98",
			lastConsumedBeforeD103LiveExecutionApprovalRef: "graphrefly-ts:D99",
			callerSettlementRepairRef: "graphrefly-ts:D100",
			callerSettlementExecutionApprovalRef: "graphrefly-ts:D101",
			callerSettlementImplementationReceiptRef: "graphrefly-ts:D102",
			lastConsumedBeforeD109LiveExecutionApprovalRef: "graphrefly-ts:D103",
			lastConsumedBeforeD109LiveExecutionCloseoutRef: "graphrefly-ts:D104",
			lastConsumedBeforeD111LiveExecutionApprovalRef: "graphrefly-ts:D109",
			lastConsumedBeforeD111LiveExecutionCloseoutRef: "graphrefly-ts:D110",
			lastConsumedLiveExecutionApprovalRef: "graphrefly-ts:D111",
			lastConsumedLiveExecutionCloseoutRef: "graphrefly-ts:D112",
			verificationDiagnosticsImplementationReceiptRef: "graphrefly-ts:D120",
			currentLiveExecutionApprovalRef: "graphrefly-ts:D145",
			mostRecentSuccessfulCanonicalLiveExecutionApprovalRef: "graphrefly-ts:D116",
			mostRecentSuccessfulCanonicalLiveExecutionCloseoutRef: "graphrefly-ts:D117",
			d121ConsumedLiveExecutionApprovalRef: "graphrefly-ts:D121",
			d121LivenessIncidentRepairRef: "graphrefly-ts:D122",
			d122ImplementationReceiptRef: "graphrefly-ts:D124",
			mostRecentConsumedLiveExecutionApprovalRef: "graphrefly-ts:D125",
			mostRecentConsumedLiveExecutionCloseoutRef: "graphrefly-ts:D126",
			adaptiveProviderCapacityDecisionRef: "graphrefly-ts:D127",
			adaptiveProviderCapacityExecutionApprovalRef: "graphrefly-ts:D128",
			elapsedAdmissionBudgetDecisionRef: "graphrefly-ts:D129",
			elapsedAdmissionBudgetExecutionApprovalRef: "graphrefly-ts:D130",
			nonBlockingElapsedTimerDecisionRef: "graphrefly-ts:D131",
			nonBlockingElapsedTimerExecutionApprovalRef: "graphrefly-ts:D132",
			graphElapsedAdaptiveImplementationReceiptRef: "graphrefly-ts:D133",
			d136ZeroChargeCloseoutRef: "graphrefly-ts:D137",
			precredentialGateChronologyExecutionApprovalRef: "graphrefly-ts:D138",
			currentLiveExecutionApprovalClosed: false,
			callerHorizonDecisionRequired: false,
			status: "qualified-no-network-d145-development-confirmatory-authority",
		});
		expect(CURRENT_QUALIFICATION_ARTIFACT_DIGEST).toBe(
			ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT_DIGEST,
		);
		expect(CURRENT_QUALIFICATION_DIGEST).toBe(ROOT_EVAL_TOPOLOGY_QUALIFICATION.qualificationDigest);
		expect(ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT).toMatchObject({
			providerNetworkAccessed: false,
			credentialAccessed: false,
			liveEvaluationExecuted: false,
		});
		const source = readFileSync(
			new URL("../../evals/graph-native-rerun-avoidance/eval-topology.ts", import.meta.url),
			"utf8",
		);
		expect(source).not.toMatch(/WeakMap|applyFact|imperativeQueue|pendingEffectsQueue/u);
		const liveEntry = readFileSync(
			new URL("../../evals/graph-native-rerun-avoidance/run-live-campaign.ts", import.meta.url),
			"utf8",
		);
		expect(liveEntry).toMatch(
			/ROOT_EVAL_LIVE_MOST_RECENT_SUCCESSFUL_CANONICAL_APPROVAL[^;]+"graphrefly-ts:D116"/su,
		);
		expect(liveEntry).toMatch(
			/ROOT_EVAL_LIVE_MOST_RECENT_SUCCESSFUL_CANONICAL_CLOSEOUT[^;]+"graphrefly-ts:D117"/su,
		);
		expect(liveEntry).toMatch(/ROOT_EVAL_LIVE_CONSUMED_D121_APPROVAL = "graphrefly-ts:D121"/u);
		expect(liveEntry).toMatch(/ROOT_EVAL_LIVE_D121_REPAIR_RECEIPT = "graphrefly-ts:D124"/u);
		expect(liveEntry).toMatch(/ROOT_EVAL_LIVE_EXECUTION_APPROVAL = "graphrefly-ts:D145"/u);
		expect(liveEntry).toMatch(
			/join\(operatorRoot, `current-\$\{ROOT_EVAL_LIVE_GENERATION_REF\}`\)/u,
		);
		expect(liveEntry).toMatch(
			/taskKind:\s*String\(ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE\) === "development"\s*\? "development-transfer"\s*:\s*"confirmatory-transfer"/u,
		);
		expect(liveEntry).toMatch(
			/diagnosticMode:\s*String\(ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE\) === "development"\s*\? "development-private"\s*:\s*"none"/u,
		);
		expect(liveEntry).not.toMatch(/GRAPHREFLY_EVAL_PRIVATE_ROOT/u);
		expect(liveEntry).not.toMatch(/GRAPHREFLY_EVAL_CREDENTIAL_PATH/u);
		expect(liveEntry).not.toMatch(/GRAPHREFLY_EVAL_ZERO_BYOK_PATH/u);
		expect(liveEntry).toMatch(/qualifyRootEvalLivePrivateInputPreflight/u);
		expect(liveEntry).toMatch(/qualifyRootEvalLivePrivateInputs/u);
		expect(liveEntry).toContain("runRootEvalPrecredentialStagePlan({");
		expect(liveEntry).toContain('mode === "--qualify-private-inputs"');
		expect(liveEntry.indexOf('mode === "--qualify-private-inputs"')).toBeLessThan(
			liveEntry.indexOf("acquisition = await acquireRootEvalLiveClaim"),
		);
		expect(liveEntry).toMatch(/stage === "long-gates"[\s\S]+runPrecredentialGates\(\)/u);
		expect(liveEntry).toMatch(
			/stage === "bounded-currentness"[\s\S]+assertBoundedCurrentness\(\)/u,
		);
		expect(liveEntry).toMatch(
			/stage === "persist-receipt"[\s\S]+persistRootEvalLivePrecredentialGateReceipt/u,
		);
		expect(liveEntry).toMatch(
			/async function assertBoundedCurrentness\(\): Promise<RootEvalLiveBoundedCurrentness>[\s\S]+measureCurrentImplementation\(\)[\s\S]+checkRootEvalGeneratedArtifactSnapshot\(\)[\s\S]+runGit\(\["rev-parse", "HEAD"\]\)[\s\S]+"diff", "HEAD"/u,
		);
		expect(liveEntry).toContain('"open-by-graphrefly-ts:D145" as const');
		expect(liveEntry).toMatch(/acquisition = await acquireRootEvalLiveClaim/u);
		expect(liveEntry).toMatch(/createRootEvalLiveExecutor/u);
		expect(liveEntry).toMatch(
			/runRootEval\(topology, executor!\.execute, \{ signal: callerCancellation\.signal \}\)/u,
		);
		expect(liveEntry).toMatch(/onDeadline: \(error\) => callerCancellation\.abort\(error\)/u);
		expect(liveEntry).not.toMatch(/await runRootEval\(/u);
		expect(liveEntry.indexOf("acquisition = await acquireRootEvalLiveClaim")).toBeLessThan(
			liveEntry.indexOf("await executeClaimedCampaign"),
		);
		expect(liveEntry).not.toMatch(/root-eval-live-2026-08-23-d94|current-live-d94/u);
		const liveRuntime = readFileSync(
			new URL("../../evals/graph-native-rerun-avoidance/root-eval-live.ts", import.meta.url),
			"utf8",
		);
		expect(liveRuntime).not.toMatch(/root-eval-d116-(provider|tool|cleanup|retry)/u);
		expect(liveRuntime).toMatch(/\.d145-provider-dispatches/u);
		expect(liveRuntime).not.toMatch(/\.d125-provider-dispatches/u);
		expect(liveRuntime).not.toMatch(/\.d121-provider-dispatches/u);
		const liveAuthority = readFileSync(
			new URL(
				"../../evals/graph-native-rerun-avoidance/root-eval-live-authority.ts",
				import.meta.url,
			),
			"utf8",
		);
		expect(liveAuthority).toContain("2026-08-26.d145.v1");
		expect(liveAuthority).not.toContain("2026-08-26.d125.v1");
		expect(liveAuthority).not.toContain("2026-08-25.d121.v1");
		const liveBootstrap = readFileSync(
			new URL(
				"../../evals/graph-native-rerun-avoidance/run-live-campaign-bootstrap.mjs",
				import.meta.url,
			),
			"utf8",
		);
		for (const requiredGate of [
			'"test"',
			'"lint"',
			'"build"',
			"federation.mjs",
			"dashboard/build.mjs",
			"generate-root-eval-artifacts.ts",
			'"diff", "--check"',
		] as const)
			expect(liveEntry).toContain(requiredGate);
		expect(liveEntry).toContain("runRootEvalPrecredentialStagePlan({");
		expect(liveBootstrap).toContain("createRootEvalPrecredentialEnvironment(process.env)");
		const precredentialEnvironmentModule = await import(
			new URL(
				"../../evals/graph-native-rerun-avoidance/precredential-environment.mjs",
				import.meta.url,
			).href
		);
		expect(
			precredentialEnvironmentModule.createRootEvalPrecredentialEnvironment({
				PATH: "/usr/bin",
				HOME: "/tmp/operator-home",
				OPENROUTER_API_KEY: "must-not-cross-precredential-boundary",
				FIREWORKS_API_KEY: "must-not-cross-precredential-boundary",
				NPM_TOKEN: "must-not-cross-precredential-boundary",
				HTTPS_PROXY: "http://must-not-cross-precredential-boundary.invalid",
				NODE_USE_ENV_PROXY: "1",
				NODE_EXTRA_CA_CERTS: "/tmp/untrusted-ca.pem",
				NODE_TLS_REJECT_UNAUTHORIZED: "0",
				GIT_DIR: "/tmp/alternate-git-dir",
				GIT_WORK_TREE: "/tmp/alternate-git-work-tree",
				GRAPHREFLY_EVAL_PRIVATE_ROOT: "/tmp/alternate-single-use-root",
				GRAPHREFLY_EVAL_CREDENTIAL_PATH: "/tmp/alternate-credential",
				GRAPHREFLY_EVAL_ZERO_BYOK_PATH: "/tmp/alternate-observation",
			}),
		).toEqual({
			PATH: "/usr/bin",
			HOME: "/tmp/operator-home",
			GRAPHREFLY_D145_ISOLATED_LIVE_CHILD: "1",
		});
		const packageJson = JSON.parse(
			readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"),
		) as { scripts: Record<string, string> };
		expect(packageJson.scripts["eval:root:private-inputs"]).toBe(
			"node packages/ts/evals/graph-native-rerun-avoidance/run-live-campaign-bootstrap.mjs --qualify-private-inputs",
		);
		const evalDirectory = new URL("../../evals/graph-native-rerun-avoidance/", import.meta.url);
		expect(readdirSync(evalDirectory)).not.toContain("qualify-live-private-inputs.ts");
		const remainingSources = readdirSync(evalDirectory)
			.filter((name) => name.endsWith(".ts"))
			.map((name) => readFileSync(new URL(name, evalDirectory), "utf8"))
			.join("\n");
		expect(remainingSources).not.toMatch(/WeakMap|applyFact|pendingEffectsQueue/u);
		expect(readdirSync(evalDirectory)).not.toEqual(
			expect.arrayContaining([
				"graph-harness-authority.ts",
				"graph-tool-authority.ts",
				"replicated-campaign-authority.ts",
				"live-campaign-authority.ts",
			]),
		);
	});

	it("reproduces raw describe, raw graph.observe envelopes, and the derived run summary", async () => {
		const generated = await buildRootEvalGeneratedArtifactBytes();
		for (const key of Object.keys(
			ROOT_EVAL_GENERATED_ARTIFACT_PATHS,
		) as (keyof typeof generated)[]) {
			expect(readFileSync(ROOT_EVAL_GENERATED_ARTIFACT_PATHS[key], "utf8"), key).toBe(
				generated[key],
			);
		}
		const events = generated.observeEvents
			.trimEnd()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		const observationPaths = [
			"eval/observation/provider-effect-activity",
			"eval/observation/tool-effect-activity",
			"eval/observation/retry-effect-activity",
			"eval/observation/billing-effect-activity",
			"eval/observation/effect-activity",
			"eval/observation",
		] as const;
		expect(events.length).toBeGreaterThan(0);
		for (const [index, event] of events.entries()) {
			expect(Object.keys(event).sort(), `event ${index}`).toEqual(["msg", "path", "seq", "tier"]);
			expect(observationPaths).toContain(event.path);
			expect(event.seq).toEqual(expect.any(Number));
			if (index > 0) expect(event.seq).toBeGreaterThan(events[index - 1]?.seq as number);
		}
		expect(new Set(events.map((event) => event.path))).toEqual(new Set(observationPaths));
		const canonicalObservations = events.flatMap((event) => {
			if (event.path !== "eval/observation" || !Array.isArray(event.msg)) return [];
			return event.msg[0] === "DATA" ? [event.msg[1] as EvalObservation] : [];
		});
		for (const [index, observation] of canonicalObservations.entries()) {
			const settled = Object.values(observation.providerOutcomeReasonCounts).reduce(
				(total, count) => total + count,
				0,
			);
			expect(
				observation.providerCapacity.admittedProposalCount,
				`canonical observation ${index} admitted stable cut`,
			).toBe(observation.admittedAttempts);
			expect(
				observation.providerCapacity.settledProposalCount,
				`canonical observation ${index} settled stable cut`,
			).toBe(settled);
			expect(
				observation.providerCapacity.pendingRetryProposalCount,
				`canonical observation ${index} retry stable cut`,
			).toBe(observation.pendingRetryProposalCount);
		}
		const activityValues = events.flatMap((event) => {
			if (event.path !== "eval/observation/effect-activity" || !Array.isArray(event.msg)) return [];
			return event.msg[0] === "DATA"
				? [event.msg[1] as { readonly activeAdmittedEffects: number }]
				: [];
		});
		expect(Math.max(...activityValues.map((value) => value.activeAdmittedEffects))).toBeGreaterThan(
			0,
		);
		const terminal = [...events]
			.reverse()
			.find(
				(event) =>
					event.path === "eval/observation" &&
					Array.isArray(event.msg) &&
					event.msg[0] === "DATA" &&
					(event.msg[1] as { readonly finding?: string } | undefined)?.finding !== "pending",
			);
		expect(terminal).toBeDefined();
		const summary = JSON.parse(generated.runSummary) as Record<string, unknown>;
		expect(summary).toMatchObject({
			format: "graphrefly.rootEvalRunSummary",
			version: 1,
			authority: "derived-no-network-qa",
			peakConcurrentEffects: 2,
			executedAdmissionCount: 36,
		});
		const qualification = JSON.parse(generated.qualification) as Record<string, unknown>;
		expect(qualification).toMatchObject({
			measuredImplementationManifestDigest: CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
			evidenceDigests: {
				describe: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
				observeEvents: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
				runSummary: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
				explanatoryMermaid: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
			},
			evidenceBindingDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
		});
		const artifactSet = JSON.parse(generated.artifactSet) as Record<string, unknown>;
		expect(artifactSet).toMatchObject({
			format: "graphrefly.rootEvalArtifactSet",
			version: 1,
			publication: "commit-marker-written-last",
			implementationManifestDigest: CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
			files: {
				"root-eval-describe.json": expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
				"root-eval-observe-events.jsonl": expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
				"root-eval-run-summary.json": expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
				"root-eval-topology-qualification.json": expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
				"root-eval-topology.mmd": expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
			},
		});
		expect(empiricalSha256(Buffer.from(generated.d124Describe))).toBe(
			"sha256:91fc8d290eeecb70d281a86fcc3dc2437d6840e9fbaa88b20184d04757ffda54",
		);
		expect(empiricalSha256(Buffer.from(generated.d124ObserveEvents))).toBe(
			"sha256:fb5600fa171f3e5cf5a69432595ab6282433501680d71d247193327bb1338e94",
		);
		expect(empiricalSha256(Buffer.from(generated.d124RunSummary))).toBe(
			"sha256:38c2a81c0dedb762bb53ab31f9f5531758f711a0d3f2f8695e4fb2eb59096d9b",
		);
		expect(empiricalSha256(Buffer.from(generated.d124Mermaid))).toBe(
			"sha256:193f393ee67f8259bdc678ed182070d70108779598312498154a960ea4e9200a",
		);
		expect(JSON.parse(generated.d124TopologyQualification)).toMatchObject({
			artifactDigest: "sha256:a5dfafaca9437a317c82433e3de528fcc6d32805210329ab37bf167497d7200e",
			qualification: {
				qualificationDigest:
					"sha256:422491364a267407ea4f837e77b4c942122da658f1d9b633ae65dd1862279493",
				currentLiveExecutionApprovalRef: null,
			},
			measuredImplementationManifestDigest:
				"sha256:2bf1f7b4fa15262f09fdadc491af567d455d4dea81e28478db7223fb22556e0e",
		});
		expect(JSON.parse(generated.d124LiveQualification)).toMatchObject({
			artifactDigest: "sha256:90fdba7d97a6cd4e353cefe6f762ea114d92b2f1b6cdc23e4451f44656cefcfa",
			qualification: {
				qualificationDigest:
					"sha256:b6d49961927d36d18153d32c673414bf9488edaa3fe8f96d9294f2e9efacc3a4",
				currentLiveExecutionApprovalRef: null,
			},
		});
		expect(generated.describe + generated.observeEvents + generated.runSummary).not.toMatch(
			/api[_-]?key|authorization|private-marker/iu,
		);
	});

	it("rejects forged admission coordinates and invalid accounting before cleanup", async () => {
		for (const patch of [
			{ workItemId: "forged/replicate-5/wrong-scope-applied", arm: "wrong-scope-applied" as const },
			{ costMicrousd: -1 },
			{ costMicrousd: 1 },
		] as readonly Record<string, unknown>[]) {
			let checked = false;
			await runRootEval(
				createTopology(),
				twoPhaseExecutor({
					onTool(effect) {
						if (!checked) {
							checked = true;
							expect(() =>
								assertRootEvalOutcomeReceipt(outcome(effect, patch as Partial<EvalEffectOutcome>)),
							).toThrow(/admission receipt/u);
						}
						return outcome(effect);
					},
				}),
			);
			expect(checked).toBe(true);
		}
		expect(Object.keys(createTopology().inputs)).toEqual(["start"]);
	});

	it("does not expose the raw outcome input and rejects a structural-clone receipt", async () => {
		await expect(
			runRootEval(
				createTopology(),
				twoPhaseExecutor({
					onTool(effect) {
						const base = outcome(effect);
						if (effect.replicate !== 1 || effect.arm !== "relevant-applied") return base;
						return { ...base, admission: { ...effect } };
					},
				}),
			),
		).rejects.toThrow(/receipt identity/u);
	});

	it("rejects provider status and material-free reason drift", async () => {
		await expect(
			runRootEval(
				createTopology(),
				twoPhaseExecutor({
					onProvider(effect) {
						return providerOutcome(effect, { reason: "response-json-invalid" });
					},
				}),
			),
		).rejects.toThrow(/Graph admission receipt/u);
		await expect(
			runRootEval(
				createTopology(),
				twoPhaseExecutor({
					onProvider(effect) {
						return providerOutcome(effect, { pricingRoundingAllowanceMicrousd: 4 });
					},
				}),
			),
		).rejects.toThrow(/Graph admission receipt/u);
	});

	it("drains every concurrently admitted effect before rejecting an invalid receipt", async () => {
		let delayedCompleted = 0;
		await expect(
			runRootEval(
				createTopology(),
				twoPhaseExecutor({
					async onProvider(effect) {
						if (effect.arm === "cold")
							return providerOutcome(effect, { admission: Object.freeze({ ...effect }) });
						await new Promise<void>((resolve) => setTimeout(resolve, 20));
						delayedCompleted += 1;
						return providerOutcome(effect);
					},
				}),
			),
		).rejects.toThrow(/receipt identity/u);
		expect(delayedCompleted).toBe(6);
	});

	it("fails closed for every removed or replaced required solution/node identity", () => {
		const raw = createTopology().graph.describe();
		for (const id of Object.keys(ROOT_EVAL_REQUIRED_NODES)) {
			const changed = clone(raw);
			changed.nodes = changed.nodes.filter((node) => node.id !== id);
			expect(() => assertRootEvalTopologyContract(changed), id).toThrow(/topology contract/u);
		}
		for (const id of Object.keys(ROOT_EVAL_REQUIRED_NODES)) {
			const changed = clone(raw);
			const node = changed.nodes.find((candidate) => candidate.id === id);
			if (node === undefined) throw new Error(`missing fixture node ${id}`);
			node.factory = "simulatedEvalFallback";
			expect(() => assertRootEvalTopologyContract(changed), id).toThrow(/identity drift/u);
		}
	});

	it("fails closed for every critical edge, arm-order drift, or hidden Graph", () => {
		const raw = createTopology().graph.describe();
		for (const id of new Set(ROOT_EVAL_CRITICAL_EDGES.flat())) {
			const changed = clone(raw);
			changed.nodes = changed.nodes.filter((node) => node.id !== id);
			expect(() => assertRootEvalTopologyContract(changed), id).toThrow(
				/missing critical node endpoint|missing node/u,
			);
		}
		for (const [from, to] of ROOT_EVAL_CRITICAL_EDGES) {
			const changed = clone(raw);
			changed.edges = changed.edges.filter((edge) => edge.from !== from || edge.to !== to);
			expect(() => assertRootEvalTopologyContract(changed), `${from} -> ${to}`).toThrow(
				/missing critical edge/u,
			);
		}
		const reordered = clone(raw);
		const start = reordered.nodes.find((node) => node.id === "eval/campaign/start");
		if (start?.meta === undefined) throw new Error("missing start metadata");
		start.meta.armOrder = [...HARNESS_ARMS].reverse();
		expect(() => assertRootEvalTopologyContract(reordered)).toThrow(/arm canonical order/u);
		const mounted = clone(raw);
		mounted.subgraphs = [clone(raw)];
		expect(() => assertRootEvalTopologyContract(mounted)).toThrow(/hidden or mounted Graph/u);
		const duplicatedLifecycle = clone(raw);
		const admission = duplicatedLifecycle.nodes.find(
			(node) => node.factory === "agenticMemoryRecordAdmission",
		);
		if (admission === undefined) throw new Error("missing memory admission fixture node");
		duplicatedLifecycle.nodes.push({ ...admission, id: `${admission.id}/duplicate` });
		expect(() => assertRootEvalTopologyContract(duplicatedLifecycle)).toThrow(
			/fixed memory lifecycle duplicated/u,
		);
		const correlatedMemoryDrift = clone(raw);
		const correlatedMemory = correlatedMemoryDrift.nodes.find(
			(node) => node.id === "eval/memory/correlated-six-arm-data",
		);
		if (correlatedMemory?.meta === undefined)
			throw new Error("missing correlated memory fixture node");
		correlatedMemory.meta.lifecycleCardinality = "six-lifecycles";
		expect(() => assertRootEvalTopologyContract(correlatedMemoryDrift)).toThrow(
			/one-lifecycle six-DATA/u,
		);
		const timeoutDrift = clone(raw);
		const plan = timeoutDrift.nodes.find(
			(node) => node.id === "eval/work-item/attempt-resource-plan",
		);
		if (plan?.meta === undefined) throw new Error("missing Work Item plan metadata");
		delete plan.meta.effectTimeoutMs;
		expect(() => assertRootEvalTopologyContract(timeoutDrift)).toThrow(/timeout authority/u);
		const timeoutValueDrift = clone(raw);
		const changedPlan = timeoutValueDrift.nodes.find(
			(node) => node.id === "eval/work-item/attempt-resource-plan",
		);
		if (changedPlan?.meta === undefined) throw new Error("missing Work Item plan metadata");
		changedPlan.meta.effectTimeoutMs = 299_999;
		expect(() => assertRootEvalTopologyContract(timeoutValueDrift)).toThrow(/timeout authority/u);
		for (const [field, value] of [
			["capacityPolicy", "fixed"],
			["initialMaxConcurrentEffects", 6],
			["rateLimitedMaxConcurrentEffects", 2],
			["cooldownReadiness", "caller-timer"],
			["proposalOrder", "replicate-attempt-fixed-arm"],
		] as const) {
			const capacityDrift = clone(raw);
			const admission = capacityDrift.nodes.find(
				(node) => node.id === "eval/provider/graph-admission-and-budget",
			);
			if (admission?.meta === undefined) throw new Error("missing provider admission metadata");
			admission.meta[field] = value;
			expect(() => assertRootEvalTopologyContract(capacityDrift), field).toThrow(
				/adaptive provider capacity policy/u,
			);
		}
		const reboundDrift = clone(raw);
		const capacity = reboundDrift.nodes.find(
			(node) => node.id === "eval/provider/adaptive-capacity-state",
		);
		if (capacity?.meta === undefined) throw new Error("missing provider capacity metadata");
		capacity.meta.rebound = true;
		expect(() => assertRootEvalTopologyContract(reboundDrift)).toThrow(
			/adaptive provider capacity state/u,
		);
	});

	it("makes the Work Item plan DATA load-bearing for provider proposal and admission", () => {
		const workItemId = "campaign/replicate-1/cold";
		const plan = {
			planId: `${workItemId}/plan`,
			workItemId,
			executionInputRevision: 1,
			joinPolicy: "all-required",
			members: [
				{
					memberId: "provider-and-exact-tool",
					effectKind: "eval-provider-tool-effect",
					required: true,
					limits: { maxRequests: 1, maxSteps: 1, timeoutMs: 1_234 },
				},
			],
		} as never;
		const proposal = {
			workItemId,
			workItemPlanId: `${workItemId}/plan`,
			workItemPlanDigest: evalWorkItemPlanAuthorityDigest(plan),
			timeoutMs: 1_234,
		};
		expect(() => validateEvalEffectProposalAgainstWorkItemPlan(proposal, plan)).not.toThrow();
		const changedPlan = structuredClone(plan) as {
			members: [{ limits: { timeoutMs: number } }];
		};
		changedPlan.members[0].limits.timeoutMs = 1_233;
		expect(() =>
			validateEvalEffectProposalAgainstWorkItemPlan(proposal, changedPlan as never),
		).toThrow(/Work Item plan authority/u);
		for (const changedAuthority of [
			{ ...structuredClone(plan), metadata: { revision: 2 } },
			{ ...structuredClone(plan), limits: { timeoutMs: 1_234 } },
			{ ...structuredClone(plan), policyRefs: [{ kind: "policy", id: "changed" }] },
			{ ...structuredClone(plan), sourceRefs: [{ kind: "source", id: "changed" }] },
			{
				...structuredClone(plan),
				members: [{ ...structuredClone(plan).members[0], goal: { kind: "changed" } }],
			},
			{
				...structuredClone(plan),
				members: [
					{
						...structuredClone(plan).members[0],
						policyRefs: [{ kind: "policy", id: "changed" }],
					},
				],
			},
			{
				...structuredClone(plan),
				members: [
					{
						...structuredClone(plan).members[0],
						sourceRefs: [{ kind: "source", id: "changed" }],
					},
				],
			},
		] as const)
			expect(() =>
				validateEvalEffectProposalAgainstWorkItemPlan(proposal, changedAuthority as never),
			).toThrow(/Work Item plan authority/u);
		let getterExecuted = false;
		const accessorPlan = structuredClone(plan);
		Object.defineProperty(accessorPlan, "metadata", {
			enumerable: true,
			get() {
				getterExecuted = true;
				return { changed: true };
			},
		});
		expect(() => evalWorkItemPlanAuthorityDigest(accessorPlan as never)).toThrow(/descriptor/u);
		expect(getterExecuted).toBe(false);
		const nonEnumerablePlan = structuredClone(plan);
		Object.defineProperty(nonEnumerablePlan, "metadata", {
			value: { changed: true },
			enumerable: false,
		});
		expect(() => evalWorkItemPlanAuthorityDigest(nonEnumerablePlan as never)).toThrow(
			/non-enumerable descriptor/u,
		);
		const protoKeyPlan = structuredClone(plan);
		Object.defineProperty(protoKeyPlan, "__proto__", {
			value: { changed: true },
			enumerable: true,
		});
		expect(() =>
			validateEvalEffectProposalAgainstWorkItemPlan(proposal, protoKeyPlan as never),
		).toThrow(/Work Item plan authority/u);
		const customArrayPlan = structuredClone(plan);
		Object.defineProperty(customArrayPlan.members, "authority", {
			value: "changed",
			enumerable: true,
		});
		expect(() => evalWorkItemPlanAuthorityDigest(customArrayPlan as never)).toThrow(
			/custom array authority/u,
		);
	});

	it("runs five ordered replicates with six concurrent WorkItems and two provider slots", async () => {
		const topology = createTopology({ effectTimeoutMs: 1_234 });
		const startsByReplicate = new Map<number, string[]>();
		const exposureCounts = new Map<string, number>();
		const admittedTimeouts: number[] = [];
		const admittedPlanIds: string[] = [];
		const admittedPlanDigests: string[] = [];
		const result = await runRootEval(
			topology,
			twoPhaseExecutor({
				async onProvider(effect) {
					admittedTimeouts.push(effect.timeoutMs);
					admittedPlanIds.push(effect.workItemPlanId);
					admittedPlanDigests.push(effect.workItemPlanDigest);
					if (effect.workItemRole === "target") {
						const starts = startsByReplicate.get(effect.replicate) ?? [];
						starts.push(effect.arm);
						startsByReplicate.set(effect.replicate, starts);
						exposureCounts.set(
							`${effect.replicate}:${effect.arm}`,
							Number(
								(effect.request.payload as { memoryExposureCount?: number } | undefined)
									?.memoryExposureCount,
							),
						);
					}
					await Promise.resolve();
					return providerOutcome(effect);
				},
			}),
		);

		expect(result.peakConcurrentEffects).toBe(2);
		expect(result.executedAdmissionIds).toHaveLength(35);
		expect(admittedTimeouts).toEqual(Array.from({ length: 35 }, () => 1_234));
		expect(new Set(admittedPlanIds).size).toBe(35);
		expect(admittedPlanDigests).toHaveLength(35);
		expect(admittedPlanDigests.every((digest) => /^sha256:[0-9a-f]{64}$/u.test(digest))).toBe(true);
		expect([...startsByReplicate.keys()]).toEqual([1, 2, 3, 4, 5]);
		for (const starts of startsByReplicate.values()) expect(starts).toEqual(HARNESS_ARMS);
		for (let replicate = 1; replicate <= 5; replicate += 1) {
			for (const arm of HARNESS_ARMS)
				expect(exposureCounts.get(`${replicate}:${arm}`), `${replicate}:${arm}`).toBe(
					arm === "relevant-applied" || arm === "irrelevant-applied" ? 1 : 0,
				);
		}
		expect(result.finding).toMatchObject({
			replicateCount: 5,
			completedWorkItems: 30,
			finding: "positive-differential",
			stoppingReason: "campaign-complete",
			passCounts: {
				cold: 0,
				"relevant-applied": 5,
				"proposal-only": 0,
				"admission-rejected": 0,
				"irrelevant-applied": 0,
				"wrong-scope-applied": 0,
			},
		});
		const observations = result.observations
			.map(materialFreeObservationValue)
			.filter((value) => value !== undefined);
		expect(observations.length).toBeGreaterThan(1);
		expect(Math.max(...observations.map((value) => value.activeProviderEffects))).toBeGreaterThan(
			0,
		);
		expect(
			Math.min(...observations.map((value) => value.verificationDiagnostics.completedWorkItems)),
		).toBeLessThan(30);
		expect(new Set(observations.map((value) => value.replicate))).toEqual(new Set([1, 2, 3, 4, 5]));
		for (let index = 1; index < observations.length; index += 1)
			expect(
				observations[index]!.verificationDiagnostics.completedWorkItems,
			).toBeGreaterThanOrEqual(observations[index - 1]!.verificationDiagnostics.completedWorkItems);
		expect(observations.at(-1)).toMatchObject({
			topologyRevision: "graphrefly-ts.root-eval-topology.v13",
			armOrder: HARNESS_ARMS,
			memoryProvenance: {
				cold: "none",
				"relevant-applied": "relevant-applied",
				"proposal-only": "proposal-only",
				"admission-rejected": "admission-rejected",
				"irrelevant-applied": "irrelevant-applied",
				"wrong-scope-applied": "wrong-scope-applied",
			},
			completedArms: 6,
			activeProviderEffects: 0,
			activeToolEffects: 0,
			activeRetryEffects: 0,
			activeBillingEffects: 0,
			activeAdmittedEffects: 0,
			stoppingReason: "campaign-complete",
			finding: "positive-differential",
		});
		expect(JSON.stringify(observations)).not.toMatch(/api[_-]?key|authorization|private-marker/iu);
	});

	it("runs one five-replicate development generation with Graph-owned qualification and partition state", async () => {
		const partitionLedgerDigest = empiricalStrictJsonDigest({ kind: "d145-development-ledger" });
		const topology = createTopology({
			campaignRef: "root-eval-development-test",
			campaignPurpose: "development",
			taskSetRef: ROOT_EVAL_DEVELOPMENT_TASKS[0]!.taskSetRef,
			generationRef: "root-eval-development-test-v1",
			replicateCount: 5,
			heldOutSealDigest: ROOT_EVAL_HELD_OUT_SEAL_DIGEST,
			budgetPartition: "development-usd-6",
			partitionHardCapMicrousd: 6_000_000,
			partitionSpentBeforeMicrousd: 125_000,
			partitionLedgerDigest,
			developmentQualificationStreakBefore: 1,
			maxCostMicrousd: 5_875_000,
		});
		const description = topology.graph.describe();
		expect(description.nodes.filter((node) => node.name === "eval/campaign/contract")).toHaveLength(
			1,
		);
		expect(description.nodes.some((node) => node.name === "eval/development/qualification")).toBe(
			true,
		);
		const result = await runRootEval(topology, twoPhaseExecutor());
		expect(result.executedAdmissionIds).toHaveLength(35);
		expect(result.finding).toMatchObject({
			replicateCount: 5,
			completedWorkItems: 30,
			finding: "positive-differential",
			passCounts: { "relevant-applied": 5 },
		});
		const terminal = result.observations
			.map(materialFreeObservationValue)
			.filter((value) => value !== undefined)
			.at(-1)!;
		expect(terminal).toMatchObject({
			campaignPurpose: "development",
			taskSetRef: ROOT_EVAL_DEVELOPMENT_TASKS[0]!.taskSetRef,
			replicateCount: 5,
			heldOutSealDigest: ROOT_EVAL_HELD_OUT_SEAL_DIGEST,
			budgetPartition: "development-usd-6",
			partitionHardCapMicrousd: 6_000_000,
			partitionSpentBeforeMicrousd: 125_000,
			partitionLedgerDigest,
			developmentQualification: {
				status: "qualified",
				generationQualified: true,
				consecutiveQualifyingGenerations: 2,
				heldOutEligible: true,
			},
		});
		expect(() =>
			createTopology({
				campaignPurpose: "confirmatory",
				replicateCount: 5,
				budgetPartition: "confirmatory-usd-6",
				developmentQualificationStreakBefore: 1,
			}),
		).toThrow(/development qualification authority/u);
		expect(() =>
			createTopology({
				campaignPurpose: "development",
				replicateCount: 5,
				budgetPartition: "development-usd-6",
				partitionHardCapMicrousd: 6_000_000,
				partitionSpentBeforeMicrousd: 5_900_000,
				maxCostMicrousd: 100_001,
			}),
		).toThrow(/partition remainder/u);
	});

	it("counts only currently executing provider effects across a synchronous replicate barrier", async () => {
		const result = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				async onProvider(effect) {
					if (effect.arm !== "wrong-scope-applied") return providerOutcome(effect);
					await new Promise<void>((resolve) => setTimeout(resolve, 20));
					return providerOutcome(effect, {
						status: "failed",
						reason: "executor-failed",
						cleanupCompleted: true,
						toolProposal: null,
					});
				},
			}),
		);
		expect(result.executedAdmissionIds).toHaveLength(35);
		expect(result.peakConcurrentEffects).toBe(2);
		expect(result.finding.providerOutcomeReasonCounts).toMatchObject({
			"tool-proposed": 30,
			"executor-failed": 5,
		});
	});

	it("observes an explicit empty retry lifecycle on the no-retry path", async () => {
		const topology = createTopology();
		const retrySnapshots: (readonly EvalExecutableEffect[])[] = [];
		const stop = topology.nodes.retryActiveEffects.subscribe((message) => {
			if (message[0] === "DATA") retrySnapshots.push(message[1] as readonly EvalExecutableEffect[]);
		});
		const result = await runRootEval(topology, twoPhaseExecutor());
		stop();
		expect(retrySnapshots.length).toBeGreaterThan(0);
		expect(retrySnapshots.every((snapshot) => snapshot.length === 0)).toBe(true);
		expect(
			result.observations
				.map(materialFreeObservationValue)
				.filter((value) => value !== undefined)
				.every((value) => value.activeRetryEffects === 0),
		).toBe(true);
	});

	it("keeps provider, exact-tool, retry-delay, and billing admissions active until settlement", async () => {
		const topology = createTopology();
		const latestByKind = new Map<EvalExecutableEffect["kind"], Set<string>>();
		const observedKinds = new Set<EvalExecutableEffect["kind"]>();
		const seenActiveIds = new Set<string>();
		const executedEffectIds = new Set<string>();
		const inactiveBeforeDelay: string[] = [];
		const inactiveAfterDelay: string[] = [];
		const admittedRetryAttempts: number[] = [];
		const effectActivitySnapshots: EvalEffectActivitySnapshot[] = [];
		const retryActivityCounts: number[] = [];
		const recordActive = (message: readonly unknown[], kind: EvalExecutableEffect["kind"]) => {
			if (message[0] !== "DATA") return;
			const effects = message[1] as readonly EvalExecutableEffect[];
			latestByKind.set(kind, new Set(effects.map((effect) => effect.executionId)));
			for (const effect of effects) {
				observedKinds.add(effect.kind);
				seenActiveIds.add(effect.executionId);
			}
		};
		const stops = [
			topology.nodes.retryActivity.subscribe((message) => {
				if (message[0] === "DATA")
					retryActivityCounts.push((message[1] as EvalEffectClassActivitySnapshot).activeEffects);
			}),
			topology.nodes.effectActivity.subscribe((message) => {
				if (message[0] === "DATA")
					effectActivitySnapshots.push(message[1] as EvalEffectActivitySnapshot);
			}),
			topology.nodes.budgets.subscribe((message) => {
				if (message[0] === "DATA")
					admittedRetryAttempts.push((message[1] as EvalBudgetState).admittedRetryAttempts);
			}),
			topology.nodes.campaignActiveEffects.subscribe((message) =>
				recordActive(message, "eval-admitted-effect"),
			),
			topology.nodes.toolActiveEffects.subscribe((message) =>
				recordActive(message, "eval-admitted-tool-effect"),
			),
			topology.nodes.retryActiveEffects.subscribe((message) =>
				recordActive(message, "eval-admitted-retry-delay"),
			),
			topology.nodes.billingActiveEffects.subscribe((message) =>
				recordActive(message, "eval-admitted-billing-observation"),
			),
		];
		const base = twoPhaseExecutor({
			onProvider(effect) {
				if (effect.replicate === 3 && effect.arm === "cold" && effect.attempt === 1)
					return providerOutcome(effect, {
						status: "retryable",
						reason: "http-429-retryable",
						retryAfterMs: 1,
						cleanupCompleted: true,
						toolProposal: null,
					});
				return providerOutcome(effect);
			},
		});
		const result = await runRootEval(topology, async (effect) => {
			executedEffectIds.add(effect.executionId);
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			if (!latestByKind.get(effect.kind)?.has(effect.executionId))
				inactiveBeforeDelay.push(effect.executionId);
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
			if (!latestByKind.get(effect.kind)?.has(effect.executionId))
				inactiveAfterDelay.push(effect.executionId);
			return await base(effect);
		});
		for (const stop of stops) stop();
		expect(observedKinds).toEqual(
			new Set([
				"eval-admitted-effect",
				"eval-admitted-tool-effect",
				"eval-admitted-retry-delay",
				"eval-admitted-billing-observation",
			]),
		);
		expect([...seenActiveIds].sort()).toEqual([...executedEffectIds].sort());
		expect(inactiveBeforeDelay).toEqual([]);
		expect(inactiveAfterDelay).toEqual([]);
		expect([...latestByKind.values()].every((effects) => effects.size === 0)).toBe(true);
		expect(result.finding.admittedAttempts).toBe(36);
		expect(Math.max(...admittedRetryAttempts)).toBe(1);
		const firstAdmittedRetry = admittedRetryAttempts.indexOf(1);
		expect(firstAdmittedRetry).toBeGreaterThanOrEqual(0);
		expect(admittedRetryAttempts.slice(firstAdmittedRetry).every((count) => count === 1)).toBe(
			true,
		);
		const observations = result.observations
			.map(materialFreeObservationValue)
			.filter((value) => value !== undefined);
		for (const field of [
			"activeRetryEffects",
			"activeProviderEffects",
			"activeToolEffects",
			"activeBillingEffects",
		] as const)
			expect(Math.max(...observations.map((value) => value[field])), field).toBeGreaterThan(0);
		for (const field of [
			"activeProviderEffects",
			"activeToolEffects",
			"activeRetryEffects",
			"activeBillingEffects",
		] as const)
			expect(
				Math.max(...effectActivitySnapshots.map((value) => value[field])),
				`effectActivity.${field}`,
			).toBeGreaterThan(0);
		const retryActivatedAt = retryActivityCounts.indexOf(1);
		const retrySettledOffset = retryActivityCounts.slice(retryActivatedAt + 1).indexOf(0);
		const retrySettledAt = retrySettledOffset < 0 ? -1 : retryActivatedAt + retrySettledOffset + 1;
		expect(retryActivatedAt).toBeGreaterThanOrEqual(0);
		expect(retrySettledAt).toBeGreaterThan(retryActivatedAt);
		expect(retryActivityCounts.slice(retrySettledAt).every((count) => count === 0)).toBe(true);
		expect(observations.at(-1)?.activeRetryEffects).toBe(0);
		expect(
			observations.every(
				(value) =>
					value.activeProviderEffects ===
					value.admittedAttempts -
						Object.values(value.providerOutcomeReasonCounts).reduce(
							(total, count) => total + count,
							0,
						),
			),
		).toBe(true);
		expect(
			observations.every((value) => {
				const retryableReasons =
					value.providerOutcomeReasonCounts["transport-retryable"] +
					value.providerOutcomeReasonCounts["http-429-retryable"];
				return value.activeRetryEffects === retryableReasons - value.admittedRetryAttempts;
			}),
		).toBe(true);
		expect(
			observations.every(
				(value) =>
					value.activeAdmittedEffects ===
					value.activeProviderEffects +
						value.activeToolEffects +
						value.activeRetryEffects +
						value.activeBillingEffects,
			),
		).toBe(true);
		expect(observations.every((value) => value.activeAdmittedEffects <= HARNESS_ARMS.length)).toBe(
			true,
		);
		expect(
			effectActivitySnapshots.every(
				(value) =>
					value.activeAdmittedEffects <= HARNESS_ARMS.length &&
					value.activeProviderEffects <= HARNESS_ARMS.length &&
					value.activeToolEffects <= HARNESS_ARMS.length &&
					value.activeRetryEffects <= HARNESS_ARMS.length &&
					value.activeBillingEffects <= 1,
			),
		).toBe(true);
	});

	it("fails closed when the Graph terminal lifecycle consistency path errors", async () => {
		const topology = createTopology();
		const base = twoPhaseExecutor();
		let releaseExecutor!: () => void;
		const executorGate = new Promise<void>((resolve) => {
			releaseExecutor = resolve;
		});
		const run = runRootEval(topology, async (effect) => {
			await executorGate;
			return base(effect);
		});
		topology.nodes.terminalLifecycleConsistency.down([
			["ERROR", new TypeError("root eval terminal lifecycle consistency drifted")],
		]);
		releaseExecutor();
		await expect(run).rejects.toThrow(/terminal lifecycle consistency drifted/u);
	});

	it("keeps billing observation, bounded quiescence, and reconciliation inside the root Graph", async () => {
		const observed: EvalBillingObservationEffect[] = [];
		const result = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onBilling(effect) {
					observed.push(effect);
					const delta = effect.observation < 3 ? 0 : effect.accountedUpperBoundMicrousd;
					const material = {
						...effect.currentKeyBefore,
						remainingMicrousd: effect.currentKeyBefore.remainingMicrousd - delta,
						usageMicrousd: effect.currentKeyBefore.usageMicrousd + delta,
					};
					return billingOutcome(effect, {
						...material,
						admissionDigest: empiricalStrictJsonDigest(material),
					});
				},
			}),
		);
		expect(observed.map((effect) => effect.observation)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(observed.map((effect) => effect.delayMs)).toEqual([
			0, 2_000, 2_000, 2_000, 2_000, 2_000,
		]);
		expect(observed.every((effect) => effect.providerCallCount === 35)).toBe(true);
		expect(result.finding).toMatchObject({
			providerCallCount: 35,
			providerReportedMicrousd: 350,
			accountedUpperBoundMicrousd: 350,
			reconciledBilledMicrousd: 350,
			billingDisposition: "reconciled",
			stoppingReason: "campaign-complete",
		});
	});

	it("reconciles the D103-shaped 23 microusd differential only through the exact D105 certificate", async () => {
		const run = async (certifiedOutcomes: number) =>
			await runRootEval(
				createTopology({ reservationMicrousd: 3_000 }),
				twoPhaseExecutor({
					onProvider(effect) {
						if (effect.workItemRole === "source")
							return providerOutcome(effect, { costMicrousd: 0 });
						const ordinal =
							(effect.replicate - 1) * HARNESS_ARMS.length + HARNESS_ARMS.indexOf(effect.arm);
						return providerOutcome(effect, {
							costMicrousd: ordinal < 24 ? 2_843 : 2_842,
							pricingRoundingAllowanceMicrousd: ordinal < certifiedOutcomes ? 1 : 0,
						});
					},
					onBilling(effect) {
						const delta = 85_261;
						const material = {
							...effect.currentKeyBefore,
							remainingMicrousd: effect.currentKeyBefore.remainingMicrousd - delta,
							usageMicrousd: effect.currentKeyBefore.usageMicrousd + delta,
						};
						return billingOutcome(effect, {
							...material,
							admissionDigest: empiricalStrictJsonDigest(material),
						});
					},
				}),
			);

		const certified = await run(30);
		expect(certified.finding).toMatchObject({
			providerReportedMicrousd: 85_284,
			pricingRoundingAllowanceMicrousd: 30,
			providerReportedLowerBoundMicrousd: 85_254,
			observedBilledMicrousd: 85_261,
			billingObservationCount: 4,
			billingStableIntervals: 3,
			reconciledBilledMicrousd: 85_261,
			billingDisposition: "reconciled",
			stoppingReason: "campaign-complete",
		});

		const underCertified = await run(22);
		expect(underCertified.finding).toMatchObject({
			providerReportedMicrousd: 85_284,
			pricingRoundingAllowanceMicrousd: 22,
			providerReportedLowerBoundMicrousd: 85_262,
			observedBilledMicrousd: 85_261,
			billingDisposition: "rejected",
			finding: "positive-differential",
			stoppingReason: "campaign-complete",
		});
	});

	it("counts explicit provider dispatches independently from admitted attempts and cost", async () => {
		const zeroCostDispatched = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onProvider: (effect) => providerOutcome(effect, { costMicrousd: 0 }),
			}),
		);
		expect(zeroCostDispatched.finding).toMatchObject({
			admittedAttempts: 35,
			providerCallCount: 35,
			providerReportedMicrousd: 0,
		});

		const onePreDispatchFailure = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onProvider: (effect) =>
					providerOutcome(
						effect,
						effect.replicate === 1 && effect.arm === "cold" ? { dispatchAttempted: false } : {},
					),
			}),
		);
		expect(onePreDispatchFailure.finding).toMatchObject({
			admittedAttempts: 35,
			providerCallCount: 34,
			providerReportedMicrousd: 350,
		});
	});

	it("keeps a positive efficacy finding when the Graph-native billing audit rejects identity drift", async () => {
		const result = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onBilling(effect) {
					const material = {
						...effect.currentKeyBefore,
						keyBindingDigest: empiricalStrictJsonDigest("drifted-key-binding"),
						remainingMicrousd:
							effect.currentKeyBefore.remainingMicrousd - effect.accountedUpperBoundMicrousd,
						usageMicrousd:
							effect.currentKeyBefore.usageMicrousd + effect.accountedUpperBoundMicrousd,
					};
					return billingOutcome(effect, {
						...material,
						admissionDigest: empiricalStrictJsonDigest(material),
					});
				},
			}),
		);
		expect(result.finding).toMatchObject({
			finding: "positive-differential",
			billingDisposition: "rejected",
			stoppingReason: "campaign-complete",
		});
	});

	it("does not fabricate efficacy when the Graph-native billing audit rejects", async () => {
		const result = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onProvider(effect) {
					if (effect.workItemRole === "source") return providerOutcome(effect);
					return providerOutcome(effect, {
						status: "failed",
						reason: "executor-failed",
						cleanupCompleted: true,
						toolProposal: null,
					});
				},
				onBilling(effect) {
					const material = {
						...effect.currentKeyBefore,
						keyBindingDigest: empiricalStrictJsonDigest("drifted-key-binding"),
						remainingMicrousd:
							effect.currentKeyBefore.remainingMicrousd - effect.accountedUpperBoundMicrousd,
						usageMicrousd:
							effect.currentKeyBefore.usageMicrousd + effect.accountedUpperBoundMicrousd,
					};
					return billingOutcome(effect, {
						...material,
						admissionDigest: empiricalStrictJsonDigest(material),
					});
				},
			}),
		);
		expect(result.finding).toMatchObject({
			passCounts: {
				cold: 0,
				"relevant-applied": 0,
				"proposal-only": 0,
				"admission-rejected": 0,
				"irrelevant-applied": 0,
				"wrong-scope-applied": 0,
			},
			finding: "no-positive-differential",
			billingDisposition: "rejected",
			stoppingReason: "campaign-complete",
		});
	});

	it("correlates one bounded retry without creating a second WorkItem", async () => {
		let attemptOne: EvalAdmittedEffect | undefined;
		let attemptTwo: EvalAdmittedEffect | undefined;
		const result = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onProvider(effect) {
					if (effect.replicate === 1 && effect.arm === "cold" && effect.attempt === 1) {
						attemptOne = effect;
						return providerOutcome(effect, {
							status: "retryable",
							reason: "http-429-retryable",
							retryAfterMs: 5_000,
							cleanupCompleted: true,
							toolProposal: null,
						});
					}
					if (effect.replicate === 1 && effect.arm === "cold" && effect.attempt === 2)
						attemptTwo = effect;
					return providerOutcome(effect);
				},
			}),
		);

		expect(result.executedAdmissionIds).toHaveLength(36);
		expect(result.executedAdmissionIds.filter((id) => id.includes("/cold/")).length).toBe(6);
		expect(result.finding.completedWorkItems).toBe(30);
		expect(result.finding.providerOutcomeReasonCounts).toMatchObject({
			"tool-proposed": 35,
			"http-429-retryable": 1,
		});
		expect(attemptOne).toBeDefined();
		expect(attemptTwo).toBeDefined();
		for (const key of [
			"providerRef",
			"providerModelRef",
			"endpointProtocol",
			"proposalEncoding",
			"responseContractRevision",
			"profileResolutionDigest",
			"workItemId",
			"workItemPlanId",
			"workItemPlanDigest",
		] as const)
			expect(attemptTwo?.[key], key).toEqual(attemptOne?.[key]);
		for (const key of [
			"effectRunId",
			"requestKind",
			"required",
			"input",
			"payload",
			"sourceRefs",
			"metadata",
		] as const)
			expect(attemptTwo!.request[key], `request.${key}`).toEqual(attemptOne!.request[key]);
	});

	it("fails closed when a transport failure is mislabeled as retryable", async () => {
		await expect(
			runRootEval(
				createTopology(),
				twoPhaseExecutor({
					onProvider(effect) {
						if (effect.replicate === 1 && effect.arm === "cold")
							return providerOutcome(effect, {
								status: "retryable",
								reason: "transport-retryable",
								retryAfterMs: 5_000,
								cleanupCompleted: true,
								toolProposal: null,
							});
						return providerOutcome(effect);
					},
				}),
			),
		).rejects.toThrow(/provider outcome does not exactly match its Graph admission receipt/u);
	});

	it("conserves one full six-arm retryable replicate through attempt-two admission", async () => {
		const executed: EvalExecutableEffect[] = [];
		const base = twoPhaseExecutor({
			onProvider(effect) {
				if (effect.workItemRole === "target" && effect.replicate === 1 && effect.attempt === 1) {
					return providerOutcome(effect, {
						status: "retryable",
						reason: "http-429-retryable",
						retryAfterMs: 60_000,
						cleanupCompleted: true,
						toolProposal: null,
					});
				}
				return providerOutcome(effect);
			},
		});
		const result = await runRootEval(createTopology(), async (effect) => {
			executed.push(effect);
			return await base(effect);
		});

		expect(result.executedAdmissionIds).toHaveLength(41);
		expect(result.finding.completedWorkItems).toBe(30);
		expect(result.finding.admittedAttempts).toBe(41);
		expect(result.finding.providerOutcomeReasonCounts).toMatchObject({
			"http-429-retryable": 6,
			"tool-proposed": 35,
		});
		const providerAdmissionOrder = executed.flatMap((effect) =>
			effect.kind === "eval-admitted-effect" && effect.workItemRole === "target"
				? [`${effect.arm}/attempt-${effect.attempt}`]
				: [],
		);
		expect(providerAdmissionOrder.slice(0, 5)).toEqual([
			"cold/attempt-1",
			"relevant-applied/attempt-1",
			"cold/attempt-2",
			"relevant-applied/attempt-2",
			"proposal-only/attempt-1",
		]);
		for (const arm of HARNESS_ARMS)
			expect(
				result.executedAdmissionIds.filter(
					(id) => id.includes(`/replicate-1/${arm}/`) && id.includes("/attempt-2/"),
				),
			).toHaveLength(1);
		const capacitySnapshots = result.observations.map(
			(event) => (event.msg[1] as EvalObservation).providerCapacity,
		);
		expect(capacitySnapshots.some((snapshot) => snapshot.mode === "cooldown")).toBe(true);
		expect(capacitySnapshots.at(-1)).toMatchObject({
			mode: "rate-limited-serial",
			maxConcurrentEffects: 1,
			proposalCount: 41,
			pendingProposalCount: 0,
			admittedProposalCount: 41,
			settledProposalCount: 41,
			rejectedProposalCount: 0,
			cooldownOutstandingReadinessCount: 0,
			rateLimitFeedbackCount: 6,
		});
	});

	it("conserves six retry proposals across both initial-slot completion orders", async () => {
		const initialArms = HARNESS_ARMS.slice(0, 2);
		for (const order of [initialArms, [...initialArms].reverse()] as const) {
			const releases = new Map<
				(typeof HARNESS_ARMS)[number],
				Readonly<{
					readonly effect: EvalAdmittedEffect;
					readonly release: (value: EvalProviderOutcome | PromiseLike<EvalProviderOutcome>) => void;
				}>
			>();
			const base = twoPhaseExecutor({
				onProvider(effect) {
					if (effect.workItemRole === "source") return providerOutcome(effect);
					if (effect.replicate !== 1 || effect.attempt !== 1) return providerOutcome(effect);
					if (!initialArms.includes(effect.arm))
						return providerOutcome(effect, {
							status: "retryable",
							reason: "http-429-retryable",
							retryAfterMs: 60_000,
							cleanupCompleted: true,
							toolProposal: null,
						});
					return new Promise<EvalProviderOutcome>((resolve) => {
						releases.set(effect.arm, Object.freeze({ effect, release: resolve }));
					});
				},
			});
			const running = runRootEval(createTopology(), base);
			while (releases.size < initialArms.length)
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
			for (const arm of order) {
				const entry = releases.get(arm);
				if (entry === undefined) throw new Error(`missing retry release for ${arm}`);
				entry.release(
					providerOutcome(entry.effect, {
						status: "retryable",
						reason: "http-429-retryable",
						retryAfterMs: 60_000,
						cleanupCompleted: true,
						toolProposal: null,
					}),
				);
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
			}
			const result = await running;
			expect(result.finding).toMatchObject({
				admittedAttempts: 41,
				completedWorkItems: 30,
			});
			expect(result.observations.at(-1)?.msg[1]).toMatchObject({
				retryProposalCount: 6,
				pendingRetryProposalCount: 0,
				admittedRetryAttempts: 6,
				settledRetryAttemptCount: 6,
			});
		}
	}, 15_000);

	it("fails closed when Graph-visible cooldown readiness fails", async () => {
		const base = twoPhaseExecutor({
			onProvider(effect) {
				if (effect.replicate === 1 && effect.arm === "cold" && effect.attempt === 1)
					return providerOutcome(effect, {
						status: "retryable",
						reason: "http-429-retryable",
						retryAfterMs: 60_000,
						cleanupCompleted: true,
						toolProposal: null,
					});
				return providerOutcome(effect);
			},
		});
		await expect(
			runRootEval(createTopology(), async (effect) => {
				if (effect.kind !== "eval-admitted-retry-delay") return await base(effect);
				return Object.freeze({
					kind: "eval-retry-delay-outcome" as const,
					admission: effect,
					executionId: effect.executionId,
					elapsedMs: effect.delayMs,
					status: "failed" as const,
					resultDigest: empiricalStrictJsonDigest({
						kind: "failed-no-network-cooldown",
						executionId: effect.executionId,
					}),
				});
			}),
		).rejects.toThrow(/retry delay failed closed/u);
	});

	it("cancels an active cooldown without admitting background provider work", async () => {
		const controller = new AbortController();
		let releaseDelay: (() => void) | undefined;
		let signalDelayStarted: (() => void) | undefined;
		const delayStarted = new Promise<void>((resolve) => {
			signalDelayStarted = resolve;
		});
		const providerExecutions: EvalAdmittedEffect[] = [];
		const base = twoPhaseExecutor({
			onProvider(effect) {
				providerExecutions.push(effect);
				if (effect.replicate === 1 && effect.arm === "cold" && effect.attempt === 1)
					return providerOutcome(effect, {
						status: "retryable",
						reason: "http-429-retryable",
						retryAfterMs: 60_000,
						cleanupCompleted: true,
						toolProposal: null,
					});
				return providerOutcome(effect);
			},
		});
		const running = runRootEval(
			createTopology(),
			async (effect) => {
				if (effect.kind !== "eval-admitted-retry-delay") return await base(effect);
				signalDelayStarted?.();
				await new Promise<void>((resolve) => {
					releaseDelay = resolve;
				});
				return Object.freeze({
					kind: "eval-retry-delay-outcome" as const,
					admission: effect,
					executionId: effect.executionId,
					elapsedMs: effect.delayMs,
					status: "completed" as const,
					resultDigest: empiricalStrictJsonDigest({
						kind: "cancelled-no-network-cooldown",
						executionId: effect.executionId,
					}),
				});
			},
			{ signal: controller.signal },
		);
		await delayStarted;
		controller.abort(new Error("cancelled during cooldown"));
		releaseDelay?.();
		await expect(running).rejects.toThrow(/cancelled during cooldown/u);
		expect(providerExecutions.every((effect) => effect.attempt === 1)).toBe(true);
		expect(
			providerExecutions.filter((effect) => effect.workItemRole === "target").length,
		).toBeLessThanOrEqual(2);
	});

	it("fails closed when the bounded second provider attempt requests another retry", async () => {
		const executed: EvalExecutableEffect[] = [];
		const executor = twoPhaseExecutor({
			onProvider(effect) {
				if (effect.replicate === 1 && effect.arm === "cold")
					return providerOutcome(effect, {
						status: "retryable",
						reason: "http-429-retryable",
						retryAfterMs: 5_000,
						cleanupCompleted: true,
						toolProposal: null,
					});
				return providerOutcome(effect);
			},
		});

		await expect(
			runRootEval(createTopology(), async (effect) => {
				executed.push(effect);
				return executor(effect);
			}),
		).rejects.toThrow(/second eval attempt cannot request another retry/u);
		expect(executed.filter((effect) => effect.kind === "eval-admitted-retry-delay")).toHaveLength(
			1,
		);
		expect(
			executed
				.filter(
					(effect) =>
						effect.kind === "eval-admitted-effect" &&
						effect.replicate === 1 &&
						effect.arm === "cold",
				)
				.map((effect) => effect.attempt),
		).toEqual([1, 2]);
	});

	it("cleans up failed effects and keeps the finding deterministic across completion order", async () => {
		const run = async (reverse: boolean) =>
			runRootEval(
				createTopology(),
				twoPhaseExecutor({
					async onTool(effect) {
						await new Promise<void>((resolve) =>
							setTimeout(
								resolve,
								reverse
									? HARNESS_ARMS.length - HARNESS_ARMS.indexOf(effect.arm)
									: HARNESS_ARMS.indexOf(effect.arm),
							),
						);
						return outcome(
							effect,
							effect.replicate === 3 && effect.arm === "cold" ? { status: "failed" } : {},
						);
					},
				}),
			);
		const [forward, reverse] = await Promise.all([run(false), run(true)]);
		expect(forward.finding).toEqual(reverse.finding);
		expect(forward.finding.completedWorkItems).toBe(30);
	});

	it("reaches a terminal finding when every Fireworks response exhausts its output ceiling", async () => {
		const topology = createTopology({
			maxCostMicrousd: 6_000_000,
			reservationMicrousd: 200_000,
		});
		const result = await Promise.race([
			runRootEval(
				topology,
				twoPhaseExecutor({
					onProvider: (effect) =>
						effect.workItemRole === "source"
							? providerOutcome(effect)
							: providerOutcome(effect, {
									status: "failed",
									reason: "response-output-truncated",
									costMicrousd: 11_000,
									cleanupCompleted: true,
									toolProposal: null,
								}),
				}),
			),
			new Promise<never>((_resolve, reject) =>
				setTimeout(() => reject(new Error("all-truncated topology did not settle")), 1_000),
			),
		]);

		expect(result.finding).toMatchObject({
			completedWorkItems: 30,
			finding: "no-positive-differential",
			providerOutcomeReasonCounts: { "response-output-truncated": 30, "tool-proposed": 5 },
			stoppingReason: "campaign-complete",
		});
	});

	it("makes diff, public semantic, hidden verifier, and executor failure load-bearing", async () => {
		const behaviorallyEquivalentAlternative = await runRootEval(
			createTopology(),
			twoPhaseExecutor(),
		);
		expect(behaviorallyEquivalentAlternative.finding).toMatchObject({
			finding: "positive-differential",
			passCounts: { "relevant-applied": 5 },
			verificationDiagnostics: {
				stageCounts: { "relevant-applied": { passed: 5 } },
				terminalReasonCounts: { "relevant-applied": { passed: 5 } },
			},
		});

		const noDiff = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onTool(effect) {
					const base = outcome(effect);
					if (effect.arm !== "relevant-applied") return base;
					return outcome(effect, { evidence: { ...base.evidence, diff: "no-change" } });
				},
			}),
		);
		expect(noDiff.finding).toMatchObject({
			finding: "no-positive-differential",
			passCounts: { "relevant-applied": 0 },
			verificationDiagnostics: {
				stageCounts: { "relevant-applied": { scopedChange: 0, passed: 0 } },
				terminalReasonCounts: { "relevant-applied": { "no-change": 5 } },
			},
		});

		const semanticFailure = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onTool(effect) {
					const base = outcome(effect);
					if (effect.arm !== "relevant-applied") return base;
					return outcome(effect, {
						evidence: { ...base.evidence, publicSemantic: "different" },
					});
				},
			}),
		);
		expect(semanticFailure.finding).toMatchObject({
			completedWorkItems: 30,
			finding: "no-positive-differential",
			passCounts: { "relevant-applied": 0 },
			verificationDiagnostics: {
				terminalReasonCounts: {
					"relevant-applied": { "public-semantic-failed": 5 },
				},
			},
		});
		const hiddenFailure = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onTool(effect) {
					const base = outcome(effect);
					if (effect.arm !== "relevant-applied") return base;
					return outcome(effect, {
						evidence: { ...base.evidence, hiddenVerifier: "fail" },
					});
				},
			}),
		);
		expect(hiddenFailure.finding).toMatchObject({
			finding: "no-positive-differential",
			passCounts: { "relevant-applied": 0 },
			verificationDiagnostics: {
				terminalReasonCounts: {
					"relevant-applied": { "hidden-verifier-failed": 5 },
				},
			},
		});

		const providerFailure = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onProvider(effect) {
					if (effect.arm !== "relevant-applied") return providerOutcome(effect);
					return providerOutcome(effect, {
						status: "failed",
						reason: "response-json-invalid",
						cleanupCompleted: true,
						toolProposal: null,
					});
				},
			}),
		);
		expect(providerFailure.finding.verificationDiagnostics).toMatchObject({
			stageCounts: { "relevant-applied": { exactToolAdmitted: 0, passed: 0 } },
			terminalReasonCounts: { "relevant-applied": { "provider-failed": 5 } },
		});

		const successLookingExactToolFailure = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onTool(effect) {
					const base = outcome(effect);
					if (effect.arm !== "relevant-applied") return base;
					return outcome(effect, { status: "failed", evidence: { ...base.evidence } });
				},
			}),
		);
		expect(successLookingExactToolFailure.finding.verificationDiagnostics).toMatchObject({
			stageCounts: {
				"relevant-applied": {
					exactToolAdmitted: 5,
					scopedChange: 0,
					publicSemanticPassed: 0,
					hiddenVerifierPassed: 0,
					passed: 0,
				},
			},
			terminalReasonCounts: { "relevant-applied": { "exact-tool-failed": 5 } },
		});
		const exactToolFailurePrecedesNoChange = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onTool(effect) {
					const base = outcome(effect);
					if (effect.arm !== "relevant-applied") return base;
					return outcome(effect, {
						status: "failed",
						evidence: { ...base.evidence, diff: "no-change" },
					});
				},
			}),
		);
		expect(exactToolFailurePrecedesNoChange.finding.verificationDiagnostics).toMatchObject({
			terminalReasonCounts: {
				"relevant-applied": { "exact-tool-failed": 5, "no-change": 0 },
			},
		});

		expect(
			evalVerificationTerminalReason({
				status: "failed",
				toolAdmissionId: null,
				evidence: {
					cleanupCompleted: false,
					diff: "no-change",
					publicSemantic: "different",
					hiddenVerifier: "fail",
				},
			} as EvalEffectOutcome),
		).toBe("cleanup-incomplete");

		const wrongScope = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onTool(effect) {
					const base = outcome(effect);
					if (effect.arm !== "relevant-applied") return base;
					return outcome(effect, { evidence: { ...base.evidence, diff: "wrong-scope" } });
				},
			}),
		);
		expect(wrongScope.finding.verificationDiagnostics).toMatchObject({
			stageCounts: { "relevant-applied": { scopedChange: 0, passed: 0 } },
			terminalReasonCounts: { "relevant-applied": { "wrong-scope": 5 } },
		});

		const wrongScopePrecedesPublicSemantic = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onTool(effect) {
					const base = outcome(effect);
					if (effect.arm !== "relevant-applied") return base;
					return outcome(effect, {
						evidence: {
							...base.evidence,
							diff: "wrong-scope",
							publicSemantic: "different",
							hiddenVerifier: "fail",
						},
					});
				},
			}),
		);
		expect(wrongScopePrecedesPublicSemantic.finding.verificationDiagnostics).toMatchObject({
			terminalReasonCounts: {
				"relevant-applied": {
					"wrong-scope": 5,
					"public-semantic-failed": 0,
					"hidden-verifier-failed": 0,
				},
			},
		});

		const publicSemanticPrecedesHiddenVerifier = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onTool(effect) {
					const base = outcome(effect);
					if (effect.arm !== "relevant-applied") return base;
					return outcome(effect, {
						evidence: {
							...base.evidence,
							publicSemantic: "different",
							hiddenVerifier: "fail",
						},
					});
				},
			}),
		);
		expect(publicSemanticPrecedesHiddenVerifier.finding.verificationDiagnostics).toMatchObject({
			terminalReasonCounts: {
				"relevant-applied": {
					"public-semantic-failed": 5,
					"hidden-verifier-failed": 0,
				},
			},
		});

		const cleanupPrecedence = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onTool(effect) {
					const base = outcome(effect);
					if (effect.replicate !== 1 || effect.arm !== "relevant-applied") return base;
					return outcome(effect, {
						status: "failed",
						evidence: { ...base.evidence, cleanupCompleted: false },
					});
				},
			}),
		);
		expect(cleanupPrecedence.finding.verificationDiagnostics).toMatchObject({
			stageCounts: {
				"relevant-applied": {
					scopedChange: 4,
					publicSemanticPassed: 4,
					hiddenVerifierPassed: 4,
					cleanupCompleted: 4,
					passed: 4,
				},
			},
			terminalReasonCounts: {
				"relevant-applied": { "cleanup-incomplete": 1, "exact-tool-failed": 0, passed: 4 },
			},
		});

		const executorFailure = await runRootEval(
			createTopology(),
			twoPhaseExecutor({
				onTool(effect) {
					if (effect.replicate === 1 && effect.arm === "relevant-applied")
						throw new Error("injected executor failure");
					return outcome(effect);
				},
			}),
		);
		expect(executorFailure.finding).toMatchObject({
			completedWorkItems: 30,
			passCounts: { "relevant-applied": 4 },
			verificationDiagnostics: {
				terminalReasonCounts: { "relevant-applied": { "cleanup-incomplete": 1, passed: 4 } },
			},
		});
	}, 15_000);

	it("excludes technical failures only as whole matched replicates and becomes inconclusive below four", async () => {
		const runWithTechnicalReplicates = async (technicalReplicates: ReadonlySet<number>) =>
			await runRootEval(
				createTopology(),
				twoPhaseExecutor({
					onProvider(effect) {
						if (effect.workItemRole === "source" || !technicalReplicates.has(effect.replicate))
							return providerOutcome(effect);
						return providerOutcome(effect, {
							status: "failed",
							reason: "http-failed",
							cleanupCompleted: true,
							toolProposal: null,
						});
					},
				}),
			);
		const oneExcluded = await runWithTechnicalReplicates(new Set([5]));
		expect(oneExcluded.finding).toMatchObject({
			finding: "positive-differential",
			evaluableReplicates: 4,
			excludedTechnicalReplicates: [5],
			sourceTechnicalExcludedReplicates: [],
			matchedRelevantOverColdWins: 4,
			passCounts: { "relevant-applied": 4, cold: 0 },
		});
		const twoExcluded = await runWithTechnicalReplicates(new Set([4, 5]));
		expect(twoExcluded.finding).toMatchObject({
			finding: "operationally-inconclusive",
			evaluableReplicates: 3,
			excludedTechnicalReplicates: [4, 5],
			sourceTechnicalExcludedReplicates: [],
			matchedRelevantOverColdWins: 3,
		});
	});

	it("continues unaffected replicates after a source technical exclusion without simulating target cleanup", async () => {
		const targetEffects: EvalExecutableEffect[] = [];
		const topology = createTopology();
		const debugEvents: { path: string; type: string; value?: unknown }[] = [];
		const stopDebug = topology.graph
			.observe()
			.subscribe((event) =>
				debugEvents.push({ path: event.path, type: event.msg[0], value: event.msg[1] }),
			);
		const controller = new AbortController();
		const debugTimer = setTimeout(() => controller.abort(new Error("debug-timeout")), 1_500);
		let result: Awaited<ReturnType<typeof topology.runAdmittedEffects>>;
		try {
			result = await topology.runAdmittedEffects(
				twoPhaseExecutor({
					onProvider(effect) {
						if (effect.workItemRole === "target") targetEffects.push(effect);
						if (effect.workItemRole !== "source" || effect.replicate !== 2)
							return providerOutcome(effect);
						return providerOutcome(effect, {
							status: "failed",
							reason: "transport-failed",
							cleanupCompleted: true,
							toolProposal: null,
						});
					},
				}),
				{ signal: controller.signal },
			);
		} catch (error) {
			const counts = Object.fromEntries(
				[
					"eval/provider/result-admission",
					"eval/provider/failed-result-admission",
					"eval/tool/exact-admission",
					"eval/source-work-item/terminal-fact",
					"eval/source-work-item/outcome-evidence-verification",
					"eval/source-work-item/memory-handoff-candidate",
					"eval/source-work-item/memory-handoff-decision",
					"eval/source-work-item/memory-handoff/correlation",
					"eval/source-work-item/memory-handoff/admitted",
					"eval/source-work-item/memory-handoff/accepted",
					"eval/source-work-item/memory-handoff/release-controller",
					"eval/source-work-item/memory-handoff/rejected",
					"eval/campaign/replicate-controller",
					"eval/campaign/state",
				].map((path) => [
					path,
					debugEvents.filter((event) => event.path === path && event.type === "DATA").length,
				]),
			);
			const lastBudget = debugEvents
				.filter((event) => event.path === "eval/budget/state" && event.type === "DATA")
				.at(-1)?.value;
			const errors = debugEvents.filter((event) => event.type === "ERROR");
			const traces = debugEvents
				.filter((event) =>
					[
						"eval/source-work-item/outcome-evidence-verification",
						"eval/campaign/replicate-controller",
						"eval/campaign/replicate-batches",
						"eval/memory/six-arm-batch-candidate",
						"eval/memory/six-arm-source-readiness-decision",
						"eval/provider/result-admission",
						"eval/provider/failed-result-admission",
						"eval/tool/exact-admission",
						"eval/source-work-item/terminal-outcomes",
						"eval/source-work-item/reconciliation",
						"eval/budget/state",
						"eval/executor/provider-effect-lifecycle-registry",
					].includes(event.path),
				)
				.map((event) => `${event.path}:${event.type}`)
				.slice(-80);
			const lastByPath = new Map<string, string>();
			for (const event of debugEvents) lastByPath.set(event.path, event.type);
			const unresolved = [...lastByPath]
				.filter(([, type]) => type === "DIRTY")
				.map(([path]) => path);
			throw new Error(
				`${String(error)} ${JSON.stringify({ counts, lastBudget, errors, traces, unresolved })}`,
			);
		} finally {
			clearTimeout(debugTimer);
			stopDebug();
		}
		expect(targetEffects).toHaveLength(18);
		expect(targetEffects.some((effect) => effect.replicate === 1 || effect.replicate === 2)).toBe(
			false,
		);
		expect(result.finding).toMatchObject({
			completedWorkItems: 18,
			evaluableReplicates: 3,
			excludedTechnicalReplicates: [1, 2],
			sourceTechnicalExcludedReplicates: [1, 2],
			finding: "operationally-inconclusive",
		});
		for (const arm of HARNESS_ARMS)
			expect(result.finding.verificationDiagnostics.stageCounts[arm].completedWorkItems).toBe(3);
	});

	it("enforces attempt and cost budget ceilings independently and validates all budget inputs", async () => {
		for (const { options, expectedPeak } of [
			{
				options: { maxAttempts: 5, maxCostMicrousd: 6_000_000, reservationMicrousd: 1_000 },
				expectedPeak: 2,
			},
			{
				options: { maxAttempts: 60, maxCostMicrousd: 500, reservationMicrousd: 1_000 },
				expectedPeak: 0,
			},
		]) {
			const topology = createTopology(options);
			const activeSnapshots: number[] = [];
			let started = 0;
			let completed = 0;
			const base = twoPhaseExecutor();
			topology.nodes.budgets.subscribe((message) => {
				if (message[0] === "DATA")
					activeSnapshots.push((message[1] as { readonly activeEffects: number }).activeEffects);
			});
			await expect(
				runRootEval(topology, async (effect) => {
					started += 1;
					const result = await base(effect);
					completed += 1;
					return result;
				}),
			).rejects.toThrow(/budget-exhausted/u);
			expect(Math.max(...activeSnapshots)).toBe(expectedPeak);
			expect(activeSnapshots.at(-1)).toBe(0);
			expect(completed).toBe(started);
		}
		const overReservationTopology = createTopology({
			maxCostMicrousd: 1_000,
			reservationMicrousd: 100,
		});
		const reportedCosts: number[] = [];
		overReservationTopology.nodes.budgets.subscribe((message) => {
			if (message[0] === "DATA")
				reportedCosts.push((message[1] as EvalBudgetState).providerReportedMicrousd);
		});
		await expect(
			runRootEval(
				overReservationTopology,
				twoPhaseExecutor({
					onProvider(effect) {
						if (effect.workItemRole === "source") return providerOutcome(effect);
						return providerOutcome(effect, {
							status: "failed",
							reason: "http-failed",
							costMicrousd: 1_200,
							costEvidence: "provider-reported",
							cleanupCompleted: true,
							toolProposal: null,
						});
					},
				}),
			),
		).rejects.toThrow(/budget-exhausted/u);
		expect(Math.max(...reportedCosts)).toBeGreaterThanOrEqual(1_200);
		for (const options of [
			{ maxAttempts: 0 },
			{ maxCostMicrousd: Number.NaN },
			{ reservationMicrousd: -1 },
			{ effectTimeoutMs: 0 },
			{ effectTimeoutMs: 300_001 },
		])
			expect(() => createTopology(options)).toThrow(
				/positive safe integer|bounded positive|partition budget authority/u,
			);
	});

	it("deduplicates identical cleanup replay and rejects contradictory replay", () => {
		const topology = createTopology();
		const diagnostics: unknown[] = [];
		const stop = topology.nodes.verificationDiagnostics.subscribe((message) => {
			if (message[0] === "DATA") diagnostics.push(message[1]);
		});
		topology.inputs.start.down([
			["DATA", { kind: "eval-campaign-start", campaignRef: topology.campaignRef }],
		]);
		const fact: EvalCleanupFact = Object.freeze({
			kind: "eval-cleanup-complete",
			workItemId: `${topology.campaignRef}/replicate-1/cold`,
			replicate: 1,
			arm: "cold",
			exactToolAdmitted: true,
			scopedChange: false,
			publicSemanticPassed: false,
			hiddenVerifierPassed: false,
			cleanupCompleted: true,
			passed: false,
			terminalReason: "no-change",
			resultDigest: empiricalStrictJsonDigest({ result: "cold" }),
		});
		topology.nodes.cleanup.down([["DATA", fact]]);
		const afterFirst = diagnostics.length;
		topology.nodes.cleanup.down([["DATA", fact]]);
		expect(diagnostics).toHaveLength(afterFirst);
		expect(() =>
			topology.nodes.cleanup.down([
				[
					"DATA",
					{
						...fact,
						resultDigest: empiricalStrictJsonDigest({ result: "contradiction" }),
					},
				],
			]),
		).toThrow(/contradictory cleanup/u);
		stop();
	});

	it("persists idempotently and rejects replay/state drift through the atomic store boundary", async () => {
		const result = await runRootEval(createTopology(), twoPhaseExecutor());
		const records = new Map<string, Awaited<ReturnType<typeof persistRootEvalRunAtomically>>>();
		const store = {
			read: async (key: string) => records.get(key),
			commitIfAbsent: async (
				key: string,
				next: Awaited<ReturnType<typeof persistRootEvalRunAtomically>>,
			) => {
				if (records.has(key)) return "exists" as const;
				records.set(key, next);
				return "committed" as const;
			},
		};
		const record = await persistRootEvalRunAtomically(store, result);
		expect(await persistRootEvalRunAtomically(store, result)).toEqual(record);
		expect(records.size).toBe(1);
		expect(record.recordDigest).toMatch(/^sha256:/u);
		expect(Object.isFrozen(record)).toBe(true);
		const emptyStore = () => ({
			read: async () => undefined,
			commitIfAbsent: async () => "committed" as const,
		});
		await expect(
			persistRootEvalRunAtomically(emptyStore(), {
				...result,
				finding: {
					...result.finding,
					passCounts: { ...result.finding.passCounts, "relevant-applied": 0 },
					finding: "no-positive-differential",
				},
			}),
		).rejects.toThrow(/pass counts drifted/u);
		const terminalIndex = result.observations.length - 1;
		const terminalEvent = result.observations[terminalIndex]!;
		const terminalValue = terminalEvent.msg[1] as NonNullable<
			ReturnType<typeof materialFreeObservationValue>
		>;
		const observationsWithTerminal = (value: typeof terminalValue) =>
			Object.freeze(
				result.observations.map((event, index) =>
					index === terminalIndex
						? { ...terminalEvent, msg: ["DATA" as const, value] as const }
						: event,
				),
			);
		await expect(
			persistRootEvalRunAtomically(emptyStore(), {
				...result,
				observations: Object.freeze(
					result.observations.map((event, index) =>
						index === terminalIndex
							? {
									...terminalEvent,
									msg: [
										"DATA" as const,
										{
											...terminalValue,
											billingObservationCount: terminalValue.billingObservationCount + 1,
										},
									] as const,
								}
							: event,
					),
				),
			}),
		).rejects.toThrow(/terminal observation drifted/u);
		await expect(
			persistRootEvalRunAtomically(emptyStore(), {
				...result,
				observations: Object.freeze(
					result.observations.map((event, index) => (index === 0 ? { ...event, tier: 2 } : event)),
				),
			}),
		).rejects.toThrow(/tier/u);
		const progressIndex = result.observations.findIndex(
			(event) => materialFreeObservationValue(event) !== undefined,
		);
		const progressEvent = result.observations[progressIndex]!;
		const progressValue = materialFreeObservationValue(progressEvent)!;
		await expect(
			persistRootEvalRunAtomically(emptyStore(), {
				...result,
				observations: Object.freeze(
					result.observations.map((event, index) =>
						index === progressIndex
							? {
									...progressEvent,
									msg: [
										"DATA" as const,
										{
											...progressValue,
											activeProviderEffects: HARNESS_ARMS.length + 1,
											activeAdmittedEffects: HARNESS_ARMS.length + 1,
										},
									] as const,
								}
							: event,
					),
				),
			}),
		).rejects.toThrow(/activeProviderEffects/u);

		const impossibleDiagnostics = {
			...result.finding.verificationDiagnostics,
			stageCounts: {
				...result.finding.verificationDiagnostics.stageCounts,
				"relevant-applied": {
					...result.finding.verificationDiagnostics.stageCounts["relevant-applied"],
					exactToolAdmitted: 4,
					scopedChange: 1,
					publicSemanticPassed: 0,
					hiddenVerifierPassed: 0,
					cleanupCompleted: 4,
					passed: 0,
				},
			},
			terminalReasonCounts: {
				...result.finding.verificationDiagnostics.terminalReasonCounts,
				"relevant-applied": {
					...result.finding.verificationDiagnostics.terminalReasonCounts["relevant-applied"],
					"cleanup-incomplete": 1,
					"exact-tool-failed": 4,
					passed: 0,
				},
			},
		};
		const impossibleFinding = {
			...result.finding,
			passCounts: { ...result.finding.passCounts, "relevant-applied": 0 },
			verificationDiagnostics: impossibleDiagnostics,
			finding: "no-positive-differential" as const,
		};
		await expect(
			persistRootEvalRunAtomically(emptyStore(), {
				...result,
				finding: impossibleFinding,
				observations: Object.freeze([
					{
						...terminalEvent,
						msg: [
							"DATA",
							{
								...terminalValue,
								verificationDiagnostics: impossibleDiagnostics,
								finding: "no-positive-differential",
							},
						] as const,
					},
				]),
			}),
		).rejects.toThrow(/reason.stage matrix/u);

		await expect(
			persistRootEvalRunAtomically(emptyStore(), {
				...result,
				finding: {
					...result.finding,
					accountedUpperBoundMicrousd: result.finding.accountedUpperBoundMicrousd + 1,
				},
				observations: observationsWithTerminal({
					...terminalValue,
					accountedUpperBoundMicrousd: terminalValue.accountedUpperBoundMicrousd + 1,
				}),
			}),
		).rejects.toThrow(/arithmetic/u);

		const terminalOnlyDiagnostics = {
			...terminalValue.verificationDiagnostics,
			stageCounts: {
				...terminalValue.verificationDiagnostics.stageCounts,
				"relevant-applied": {
					...terminalValue.verificationDiagnostics.stageCounts["relevant-applied"],
					hiddenVerifierPassed: 4,
					passed: 4,
				},
			},
			terminalReasonCounts: {
				...terminalValue.verificationDiagnostics.terminalReasonCounts,
				"relevant-applied": {
					...terminalValue.verificationDiagnostics.terminalReasonCounts["relevant-applied"],
					"hidden-verifier-failed": 1,
					passed: 4,
				},
			},
		};
		await expect(
			persistRootEvalRunAtomically(emptyStore(), {
				...result,
				observations: Object.freeze([
					{
						...terminalEvent,
						msg: [
							"DATA",
							{
								...terminalValue,
								verificationDiagnostics: terminalOnlyDiagnostics,
							},
						] as const,
					},
				]),
			}),
		).rejects.toThrow(/progress stream was truncated/u);

		const priorEvent = result.observations.at(-2)!;
		const duplicateEvent = { ...priorEvent, seq: terminalEvent.seq };
		await expect(
			persistRootEvalRunAtomically(emptyStore(), {
				...result,
				observations: Object.freeze([
					...result.observations.slice(0, -1),
					duplicateEvent,
					{ ...terminalEvent, seq: terminalEvent.seq + 1 },
				]),
			}),
		).rejects.toThrow(/distinctness/u);
		records.set(record.recordId, {
			...record,
			finding: { ...record.finding, finding: "no-positive-differential" },
		});
		await expect(persistRootEvalRunAtomically(store, result)).rejects.toThrow(/state drift/u);
		records.set(record.recordId, { ...record, recordDigest: "sha256:drift" });
		await expect(persistRootEvalRunAtomically(store, result)).rejects.toThrow(/state drift/u);
	});
});
